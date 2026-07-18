package com.valenixia.commerce.sync

import com.valenixia.commerce.db.CartItem
import com.valenixia.commerce.db.Database
import com.valenixia.commerce.crdt.SyncChange
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import io.ktor.server.auth.*
import io.ktor.server.auth.jwt.*
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.coroutines.channels.ClosedSendChannelException
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import io.ktor.server.http.content.staticFiles
import java.io.File
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import java.security.spec.KeySpec
import java.util.Base64
import java.security.SecureRandom

@Serializable
data class SyncDeltasMessage(
    val type: String,
    val nodeId: String,
    val changes: List<SyncChange>
)

@Serializable
data class LoginRequest(val pin: String)

@Serializable
data class BootstrapRequest(
    val storeName: String,
    val taxRate: Double,
    val adminPin: String,
    val syncPassphrase: String,
    val theme: String? = null
)

@Serializable
data class SpeechLogRequest(
    val id: String,
    val transactionId: String? = null,
    val duration: Long,
    val tag: String,
    val fillerWords: Int,
    val sentiment: String,
    val flagged: Boolean,
    val markers: List<String> = emptyList()
)

@Serializable
data class ResetRequest(val pin: String)

object SyncServer {
    private val sessions = Collections.newSetFromMap(ConcurrentHashMap<DefaultWebSocketServerSession, Boolean>())
    private val json = Json { ignoreUnknownKeys = true }
    var serverPort: Int = 3000

    @Volatile
    private var cachedKey: ByteArray? = null
    @Volatile
    private var cachedPassphraseHash: Int? = null

    fun deriveKey(passphrase: String): ByteArray {
        val currentHash = passphrase.hashCode()
        val existing = cachedKey
        if (existing != null && cachedPassphraseHash == currentHash) {
            return existing
        }
        var salt = Database.getPreference("sync_salt")
        if (salt == null || salt.isEmpty()) {
            val randomBytes = ByteArray(16)
            java.security.SecureRandom().nextBytes(randomBytes)
            salt = java.util.Base64.getEncoder().encodeToString(randomBytes)
            Database.setPreference("sync_salt", "STR", salt)
        }
        val spec = javax.xml.crypto.dsig.spec.HMACParameterSpec::class // just check import if needed, otherwise use full path
        val keySpec = javax.crypto.spec.PBEKeySpec(passphrase.toCharArray(), salt.toByteArray(), 100000, 256)
        val factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val key = factory.generateSecret(keySpec).encoded
        cachedKey = key
        cachedPassphraseHash = currentHash
        return key
    }

    fun decryptPayload(text: String, passphrase: String): String {
        val isEncrypted = !text.trim().startsWith("{")
        if (!isEncrypted) {
            return text
        }
        val buffer = Base64.getDecoder().decode(text)
        if (buffer.size < 12 + 16) {
            throw IllegalArgumentException("Ciphertext too short")
        }
        val iv = buffer.copyOfRange(0, 12)
        val ciphertextWithTag = buffer.copyOfRange(12, buffer.size)
        
        val keyBytes = deriveKey(passphrase)
        val secretKey = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        return String(cipher.doFinal(ciphertextWithTag), Charsets.UTF_8)
    }

    fun encryptPayload(jsonStr: String, passphrase: String?): String {
        if (passphrase == null || passphrase.isEmpty()) {
            return jsonStr
        }
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)
        
        val keyBytes = deriveKey(passphrase)
        val secretKey = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
        
        val ciphertextWithTag = cipher.doFinal(jsonStr.toByteArray(Charsets.UTF_8))
        
        val combined = ByteArray(iv.size + ciphertextWithTag.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertextWithTag, 0, combined, iv.size, ciphertextWithTag.size)
        return Base64.getEncoder().encodeToString(combined)
    }

    fun getJwtSecret(): String {
        // Read the passphrase via the AES-GCM encrypted getter — falls back to
        // legacy plaintext only when the ENC: prefix is absent (migration path).
        val passphrase = Database.getPreferenceEncrypted("sync_passphrase")
        if (passphrase == null || passphrase.isEmpty()) {
            // Never use a predictable fallback — a missing passphrase is a misconfiguration.
            // The server MUST be initialised with a sync passphrase before issuing JWT tokens.
            throw IllegalStateException(
                "[SyncServer] FATAL: sync_passphrase is not configured. " +
                "Cannot derive a secure JWT secret. " +
                "Run the onboarding wizard to set a sync passphrase before starting the sync server."
            )
        }
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(passphrase.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }

    fun generateToken(nodeId: String, role: String): String {
        val algorithm = Algorithm.HMAC256(getJwtSecret())
        // 30-day token lifetime — balanced between re-auth friction and stolen-token risk.
        // Terminals must re-register every 30 days (or on the next restart after expiry).
        return JWT.create()
            .withSubject(nodeId)
            .withClaim("role", role)
            .withExpiresAt(java.util.Date(System.currentTimeMillis() + 30L * 24 * 60 * 60 * 1000))
            .sign(algorithm)
    }

    fun verifyJwtToken(token: String): Map<String, String>? {
        return try {
            val algorithm = Algorithm.HMAC256(getJwtSecret())
            val verifier = JWT.require(algorithm).build()
            val jwt = verifier.verify(token)
            mapOf("sub" to (jwt.subject ?: ""), "role" to (jwt.getClaim("role").asString() ?: ""))
        } catch (e: Exception) {
            null
        }
    }

    fun startServer(port: Int = 3000) {
        serverPort = port
        
        try {
            val ips = mutableListOf<String>()
            val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr is java.net.Inet4Address) {
                        ips.add(addr.hostAddress)
                    }
                }
            }
            if (ips.isNotEmpty()) {
                NetworkDiscoveryHub.startLocalDiscoveryBroadcast(ips[0], port)
            }
        } catch (e: Exception) {
            println("[SyncServer] Multicast discovery failed to start: ${e.message}")
        }

        embeddedServer(Netty, port = port, host = "0.0.0.0") {
            install(WebSockets)
            install(Authentication) {
                jwt("auth-jwt") {
                    realm = "Access to Valenixia POS"
                    verifier(
                        com.auth0.jwt.JWT
                            .require(com.auth0.jwt.algorithms.Algorithm.HMAC256(getJwtSecret()))
                            .build()
                    )
                    validate { credential ->
                        val nodeId = credential.payload.subject
                        if (nodeId != null && Database.getDeviceStatus(nodeId) == "APPROVED") {
                            JWTPrincipal(credential.payload)
                        } else {
                            null
                        }
                    }
                }
            }
            
            routing {
                // Serve static client web assets for mobile register browsers
                staticFiles("/", File("public")) {
                    default("index.html")
                }

                get("/download") {
                    call.respondFile(File("public/download.html"))
                }

                get("/api/server-info") {
                    try {
                        val ips = mutableListOf<String>()
                        val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
                        while (interfaces.hasMoreElements()) {
                            val iface = interfaces.nextElement()
                            if (iface.isLoopback || !iface.isUp) continue
                            val addresses = iface.inetAddresses
                            while (addresses.hasMoreElements()) {
                                val addr = addresses.nextElement()
                                if (addr is java.net.Inet4Address) {
                                    ips.add(addr.hostAddress)
                                }
                            }
                        }
                        call.respondText(
                            """{"ips":[${ips.joinToString(",") { "\"$it\"" }}],"port":$serverPort}""",
                            io.ktor.http.ContentType.Application.Json
                        )
                    } catch (e: Exception) {
                        call.respondText(
                            """{"error":"${e.message}"}""",
                            io.ktor.http.ContentType.Application.Json,
                            io.ktor.http.HttpStatusCode.InternalServerError
                        )
                    }
                }

                // WebSocket sync channel
                webSocket("/") {
                    sessions.add(this)
                    println("[SyncServer] Mobile/Client node connected.")
                    
                    var authenticated = false
                    var wsNodeId: String? = null
                    var deviceRole: String? = null
                    
                    try {
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                val text = frame.readText()
                                
                                // Use encrypted getter — handles ENC: prefix and legacy plaintext
                                val passphrase = Database.getPreferenceEncrypted("sync_passphrase")
                                val decryptedText = try {
                                    if (passphrase != null && passphrase.isNotEmpty()) {
                                        decryptPayload(text, passphrase)
                                    } else {
                                        text
                                    }
                                } catch (e: Exception) {
                                    text
                                }
                                
                                println("[SyncServer] Received raw frame: $text")
                                println("[SyncServer] Decrypted frame: $decryptedText")
                                
                                if (!authenticated) {
                                    if (decryptedText.contains("\"type\":\"AUTH\"")) {
                                        val token = getJsonStringField(decryptedText, "token") ?: ""
                                        wsNodeId = getJsonStringField(decryptedText, "nodeId") ?: ""
                                        
                                        val claims = verifyJwtToken(token)
                                        if (claims != null && claims["sub"] == wsNodeId) {
                                            // Device approval is STRICTLY database-driven.
                                            // No hardcoded node IDs are permitted — every device must go
                                            // through the pending → approved workflow via the admin UI.
                                            // The only auto-approved node is the local master node itself.
                                            var status = Database.getDeviceStatus(wsNodeId!!)
                                            if (wsNodeId == Database.hlc.nodeId) {
                                                status = "APPROVED" // own node always approved
                                            }
                                            if (status == "APPROVED") {
                                                authenticated = true
                                                deviceRole = claims["role"]
                                                println("[SyncServer] Client node authenticated: $wsNodeId ($deviceRole)")
                                                
                                                // Send initial handshake
                                                val handshake = """{"type":"handshake","nodeId":"${Database.hlc.nodeId}","dbVersion":${Database.dbVersion},"hlc":"${Database.hlc.tick()}"}"""
                                                sendPayload(this, handshake)
                                            } else {
                                                sendPayload(this, """{"type":"device_rejected"}""")
                                                close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "Device is not approved."))
                                            }
                                        } else {
                                            println("[SyncServer] Authentication failed for node: $wsNodeId")
                                            sendPayload(this, """{"type":"unauthorized","error":"Authentication failed."}""")
                                            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "Authentication failed."))
                                        }
                                    } else if (decryptedText.contains("\"type\":\"REGISTER\"")) {
                                        wsNodeId = getJsonStringField(decryptedText, "nodeId") ?: ""
                                        val deviceName = getJsonStringField(decryptedText, "deviceName") ?: ""
                                        val userAgent = getJsonStringField(decryptedText, "userAgent") ?: ""
                                        
                                        // Device approval is STRICTLY database-driven.
                                        // Only the local master node is auto-approved.
                                        // All other devices (including web clients) must be explicitly
                                        // approved through the admin device management UI.
                                        var status = Database.getDeviceStatus(wsNodeId!!)
                                        if (wsNodeId == Database.hlc.nodeId) {
                                            status = "APPROVED" // own node always approved
                                        }
                                        if (status == "APPROVED") {
                                            authenticated = true
                                            // Role is MASTER only for the local node itself.
                                            deviceRole = if (wsNodeId == Database.hlc.nodeId) "MASTER" else "TERMINAL"
                                            val token = generateToken(wsNodeId!!, deviceRole)
                                            sendPayload(this, """{"type":"device_approved","token":"$token"}""")
                                            println("[SyncServer] Registered auto-approved node: $wsNodeId")
                                        } else if (status == "PENDING") {
                                            println("[SyncServer] Connection from pending node: $wsNodeId")
                                            sendPayload(this, """{"type":"device_pending","nodeId":"$wsNodeId"}""")
                                        } else {
                                            // New device registration
                                            println("[SyncServer] New device registration request from: $wsNodeId ($deviceName)")
                                            Database.addPendingDevice(wsNodeId!!, deviceName, userAgent)
                                            sendPayload(this, """{"type":"device_pending","nodeId":"$wsNodeId"}""")
                                            
                                            // Broadcast request to all approved Admin connections in real-time
                                            broadcast("""{"type":"device_request","nodeId":"$wsNodeId","deviceName":"$deviceName","userAgent":"$userAgent"}""")
                                        }
                                    } else {
                                        sendPayload(this, """{"type":"unauthorized","error":"Authentication required."}""")
                                        close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "Authentication required."))
                                    }
                                } else {
                                    handleSocketMessage(decryptedText, this)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        println("[SyncServer] WebSocket session closed: ${e.message}")
                    } finally {
                        sessions.remove(this)
                        println("[SyncServer] Client node disconnected.")
                    }
                }

                // Public REST API Endpoints
                // 1. Bootstrap
                post("/api/bootstrap") {
                    try {
                        val body = call.receiveText()
                        val req = json.decodeFromString<BootstrapRequest>(body)
                        val success = Database.bootstrap(
                            req.storeName,
                            req.taxRate,
                            req.adminPin,
                            req.syncPassphrase,
                            req.theme
                        )
                        if (success) {
                            call.respondText("""{"success":true}""", io.ktor.http.ContentType.Application.Json)
                        } else {
                            call.respondText("""{"error":"Failed to bootstrap network database"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                    }
                }

                // 1.c Fetch system initialization status (Public)
                get("/api/system/status") {
                    try {
                        val isInitialized = Database.isInitialized()
                        call.respondText("""{"isInitialized":$isInitialized}""", io.ktor.http.ContentType.Application.Json)
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                    }
                }

                // 1.d System Factory Reset (Loopback-only or authenticated ADMIN PIN)
                post("/api/system/reset") {
                    val host = call.request.local.remoteHost
                    val isLocal = host == "127.0.0.1" || host == "0:0:0:0:0:0:0:1" || host == "localhost"
                    
                    var authorized = isLocal
                    if (!authorized) {
                        try {
                            val body = call.receiveText()
                            val pin = getJsonStringField(body, "pin")
                            if (pin != null) {
                                val admin = Database.verifyEmployeePin(pin)
                                if (admin != null && admin.role == "ADMIN") {
                                    authorized = true
                                }
                            }
                        } catch (e: Exception) {
                            // Non-fatal
                        }
                    }

                    if (!authorized) {
                        call.respondText("""{"error":"Access denied: Loopback connection or Admin PIN required."}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                        return@post
                    }

                    try {
                        val success = Database.factoryReset()
                        if (success) {
                            broadcast("""{"type":"reset_trigger"}""")
                            call.respondText("""{"success":true,"message":"Server database factory reset completed successfully."}""", io.ktor.http.ContentType.Application.Json)
                        } else {
                            call.respondText("""{"error":"Factory reset failed"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                    }
                }

                // 1.e Device registration and auto-approval (Public)
                post("/api/devices/register") {
                    try {
                        val body = call.receiveText()
                        val nodeId = getJsonStringField(body, "nodeId") ?: ""
                        val deviceName = getJsonStringField(body, "deviceName") ?: "Desktop Register"
                        val userAgent = call.request.headers["User-Agent"] ?: "Unknown"

                        if (nodeId.isEmpty()) {
                            call.respondText("""{"error":"nodeId is required"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                            return@post
                        }

                        var status = Database.getDeviceStatus(nodeId)
                        // Only the local master node (matching Database.hlc.nodeId) is
                        // auto-approved.  ALL other clients — including web clients whose
                        // nodeId starts with 'web_client_' — must go through the admin
                        // pending → approved workflow.  Removing this bypass was
                        // security-critical: previously ANY device could claim a
                        // 'web_client_' prefix and receive an unconditional JWT.
                        if (nodeId == Database.hlc.nodeId) {
                            status = "APPROVED"
                        }

                        if (status == "APPROVED") {
                            val role = if (nodeId == Database.hlc.nodeId) "MASTER" else "TERMINAL"
                            val token = generateToken(nodeId, role)
                            
                            if (Database.getDeviceStatus(nodeId) == null) {
                                Database.addPendingDevice(nodeId, deviceName, userAgent)
                                Database.approveDevice(nodeId)
                            }
                            
                            call.respondText("""{"status":"APPROVED","token":"$token"}""", io.ktor.http.ContentType.Application.Json)
                        } else if (status == "PENDING") {
                            call.respondText("""{"status":"PENDING","nodeId":"$nodeId"}""", io.ktor.http.ContentType.Application.Json)
                        } else {
                            Database.addPendingDevice(nodeId, deviceName, userAgent)
                            call.respondText("""{"status":"PENDING","nodeId":"$nodeId"}""", io.ktor.http.ContentType.Application.Json)
                        }
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                    }
                }

                // 1.f Employee login — requires valid device JWT + enforces server-side PIN lockout
                post("/api/employee/login") {
                    // Derive a per-device lockout tag from the Authorization header so
                    // different approved devices have independent lockout counters.
                    val authHeader = call.request.headers["Authorization"]
                    val lockoutTag = if (authHeader != null && authHeader.startsWith("Bearer ")) {
                        "login:${authHeader.substring(7).take(32)}"
                    } else {
                        "login:unauthenticated"
                    }

                    var authenticated = false
                    if (authHeader != null && authHeader.startsWith("Bearer ")) {
                        val token = authHeader.substring(7)
                        val claims = verifyJwtToken(token)
                        if (claims != null && Database.getDeviceStatus(claims["sub"] ?: "") == "APPROVED") {
                            authenticated = true
                        }
                    }

                    if (!authenticated) {
                        call.respondText("""{"error":"Unauthorized: device token required"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Unauthorized)
                        return@post
                    }

                    try {
                        val body = call.receiveText()
                        val req = json.decodeFromString<LoginRequest>(body)
                        // Pass lockoutTag as sourceTag — verifyEmployeePin now owns the full
                        // lockout lifecycle (check → verify → record/clear).
                        // It returns null both on bad PIN AND when already locked out.
                        val employee = Database.verifyEmployeePin(req.pin, lockoutTag)
                        if (employee != null) {
                            call.respondText(json.encodeToString(employee), io.ktor.http.ContentType.Application.Json)
                        } else {
                            // Distinguish lockout from wrong PIN for the client message.
                            val lockedOut = Database.isLockedOut(lockoutTag)
                            val msg = if (lockedOut)
                                """{"error":"Too many failed PIN attempts. Please wait 15 minutes before trying again."}"""
                            else
                                """{"error":"Invalid PIN"}"""
                            val status = if (lockedOut)
                                io.ktor.http.HttpStatusCode.TooManyRequests
                            else
                                io.ktor.http.HttpStatusCode.Unauthorized
                            call.respondText(msg, io.ktor.http.ContentType.Application.Json, status)
                        }
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                    }
                }

                // 1.f END

                // 1.g Pairing token endpoints
                // POST /api/pairing/generate — authenticated MASTER only, issues a one-time
                // 5-minute QR-code token that a new device can redeem to auto-approve itself.
                authenticate("auth-jwt") {
                    post("/api/pairing/generate") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "ADMIN") {
                            call.respondText(
                                """{"error":"Forbidden: only MASTER or ADMIN may generate pairing tokens"}""",
                                io.ktor.http.ContentType.Application.Json,
                                io.ktor.http.HttpStatusCode.Forbidden
                            )
                            return@post
                        }
                        try {
                            val token = Database.generatePairingToken()
                            call.respondText(
                                """{"token":"$token","expiresInMs":300000}""",
                                io.ktor.http.ContentType.Application.Json
                            )
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }
                }

                // POST /api/pairing/consume — public endpoint (no JWT required).
                // A new device presents the one-time token and receives an approved JWT.
                post("/api/pairing/consume") {
                    try {
                        val body = call.receiveText()
                        val token = getJsonStringField(body, "token") ?: ""
                        val nodeId = getJsonStringField(body, "nodeId") ?: ""
                        val deviceName = getJsonStringField(body, "deviceName") ?: "Paired Device"
                        val userAgent = call.request.headers["User-Agent"] ?: "Unknown"

                        if (token.isEmpty() || nodeId.isEmpty()) {
                            call.respondText(
                                """{"error":"token and nodeId are required"}""",
                                io.ktor.http.ContentType.Application.Json,
                                io.ktor.http.HttpStatusCode.BadRequest
                            )
                            return@post
                        }

                        val valid = Database.consumePairingToken(token)
                        if (!valid) {
                            call.respondText(
                                """{"error":"Invalid, expired, or already-used pairing token"}""",
                                io.ktor.http.ContentType.Application.Json,
                                io.ktor.http.HttpStatusCode.Forbidden
                            )
                            return@post
                        }

                        // Register and auto-approve the device
                        if (Database.getDeviceStatus(nodeId) == null) {
                            Database.addPendingDevice(nodeId, deviceName, userAgent)
                        }
                        Database.approveDevice(nodeId)
                        val jwtToken = generateToken(nodeId, "TERMINAL")
                        broadcast("""{"type":"device_whitelist_changed"}""")
                        call.respondText(
                            """{"status":"APPROVED","token":"$jwtToken"}""",
                            io.ktor.http.ContentType.Application.Json
                        )
                    } catch (e: Exception) {
                        call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                    }
                }

                // Authenticated REST API Endpoints
                authenticate("auth-jwt") {
                    // 1. Catalog Lookup
                    get("/api/inventory") {
                        try {
                            val inventory = Database.getInventory()
                            call.respondText(json.encodeToString(inventory), io.ktor.http.ContentType.Application.Json)
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }

                    // 1.b Preferences Lookup
                    get("/api/preferences") {
                        try {
                            val preferences = Database.getPreferences()
                            call.respondText(json.encodeToString(preferences), io.ktor.http.ContentType.Application.Json)
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }

                    // 3. Transactions List
                    get("/api/transactions") {
                        try {
                            val transactions = Database.getTransactions(50)
                            call.respondText(json.encodeToString(transactions), io.ktor.http.ContentType.Application.Json)
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }

                    // 4. Speech Logs Recording
                    post("/api/speech-logs") {
                        try {
                            val body = call.receiveText()
                            val req = json.decodeFromString<SpeechLogRequest>(body)
                            val success = Database.addSpeechLog(
                                req.id,
                                req.transactionId,
                                req.duration,
                                req.tag,
                                req.fillerWords,
                                req.sentiment,
                                req.flagged,
                                json.encodeToString(req.markers)
                            )
                            if (success) {
                                call.respondText("""{"success":true}""", io.ktor.http.ContentType.Application.Json)
                            } else {
                                call.respondText("""{"error":"Failed to save speech log"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                            }
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                        }
                    }

                    // Whitelist management REST routes
                    get("/api/devices/pending") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "TERMINAL" && role != "ADMIN") {
                            call.respondText("""{"error":"Forbidden: requires Admin privileges"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            return@get
                        }
                        try {
                            val devices = Database.getPendingDevices()
                            call.respondText(json.encodeToString(devices), io.ktor.http.ContentType.Application.Json)
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }

                    get("/api/devices") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "TERMINAL" && role != "ADMIN") {
                            call.respondText("""{"error":"Forbidden: requires Admin privileges"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            return@get
                        }
                        try {
                            val devices = Database.getAllDevices()
                            call.respondText(json.encodeToString(devices), io.ktor.http.ContentType.Application.Json)
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                        }
                    }

                    post("/api/devices/approve") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "TERMINAL" && role != "ADMIN") {
                            call.respondText("""{"error":"Forbidden: requires Admin privileges"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            return@post
                        }
                        try {
                            val body = call.receiveText()
                            val nodeId = getJsonStringField(body, "nodeId") ?: ""
                            val success = Database.approveDevice(nodeId)
                            if (success) {
                                val token = generateToken(nodeId, "TERMINAL")
                                broadcast("""{"type":"device_whitelist_changed"}""")
                                call.respondText("""{"success":true,"token":"$token"}""", io.ktor.http.ContentType.Application.Json)
                            } else {
                                call.respondText("""{"error":"Failed to approve device"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                            }
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                        }
                    }

                    post("/api/devices/reject") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "TERMINAL" && role != "ADMIN") {
                            call.respondText("""{"error":"Forbidden: requires Admin privileges"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            return@post
                        }
                        try {
                            val body = call.receiveText()
                            val nodeId = getJsonStringField(body, "nodeId") ?: ""
                            val success = Database.rejectDevice(nodeId)
                            if (success) {
                                broadcast("""{"type":"device_whitelist_changed"}""")
                                call.respondText("""{"success":true}""", io.ktor.http.ContentType.Application.Json)
                            } else {
                                call.respondText("""{"error":"Failed to reject device"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.InternalServerError)
                            }
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                        }
                    }

                    // 6. Reset Database
                    post("/api/reset") {
                        val principal = call.principal<JWTPrincipal>()
                        val role = principal?.payload?.getClaim("role")?.asString()
                        if (role != "MASTER" && role != "TERMINAL" && role != "ADMIN") {
                            call.respondText("""{"error":"Forbidden: requires Admin privileges"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            return@post
                        }
                        try {
                            val body = call.receiveText()
                            val req = json.decodeFromString<ResetRequest>(body)
                            val success = Database.destructReset(req.pin)
                            if (success) {
                                broadcast("""{"type":"reset_trigger"}""")
                                call.respondText("""{"success":true}""", io.ktor.http.ContentType.Application.Json)
                            } else {
                                call.respondText("""{"error":"Admin verification failed"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.Forbidden)
                            }
                        } catch (e: Exception) {
                            call.respondText("""{"error":"${e.message}"}""", io.ktor.http.ContentType.Application.Json, io.ktor.http.HttpStatusCode.BadRequest)
                        }
                    }
                }
            }
        }.start(wait = false)
        println("[SyncServer] Ktor server and P2P WS socket hub fully bound to port $port.")
    }

    private suspend fun handleSocketMessage(text: String, session: DefaultWebSocketServerSession) {
        try {
            if (text.contains("\"type\":\"sync_deltas\"")) {
                val wrapper = json.decodeFromString<SyncDeltasMessage>(text)
                println("[SyncServer] Received ${wrapper.changes.size} deltas from client ${wrapper.nodeId}")
                val (applied, conflicts) = Database.applyRemoteChanges(wrapper.changes)
                if (applied > 0) {
                    broadcast(
                        """{"type":"broadcast_deltas","nodeId":"${wrapper.nodeId}","changes":${json.encodeToString(wrapper.changes)}}""",
                        skip = session
                    )
                }
            } else if (text.contains("\"type\":\"request_sync\"")) {
                val pattern = "\"sinceVersion\"\\s*:\\s*(\\d+)".toRegex()
                val match = pattern.find(text)
                val sinceVersion = match?.groupValues?.get(1)?.toLongOrNull() ?: 0L
                val changes = Database.getChangesSince(sinceVersion)
                val response = """{"type":"sync_response","changes":${json.encodeToString(changes)},"dbVersion":${Database.dbVersion}}"""
                sendPayload(session, response)
            } else if (text.contains("\"type\":\"ephemeral_broadcast\"")) {
                // Broadcast ephemeral message to other terminals
                broadcast(text, skip = session)
            }
        } catch (e: Exception) {
            println("[SyncServer] Error processing socket message: ${e.message}")
        }
    }

    private fun getJsonStringField(jsonStr: String, field: String): String? {
        val pattern = "\"$field\"\\s*:\\s*\"([^\"]+)\"".toRegex()
        val match = pattern.find(jsonStr)
        return match?.groupValues?.get(1)
    }

    suspend fun sendPayload(session: DefaultWebSocketServerSession, message: String) {
        // Use the encrypted passphrase getter — handles both legacy plaintext and ENC: prefix
        val passphrase = Database.getPreferenceEncrypted("sync_passphrase")
        val payload = encryptPayload(message, passphrase)
        session.send(Frame.Text(payload))
    }

    suspend fun broadcast(message: String, skip: DefaultWebSocketServerSession? = null) {
        sessions.forEach { session ->
            if (session != skip) {
                try {
                    sendPayload(session, message)
                } catch (e: ClosedSendChannelException) {
                    // Client closed connection
                }
            }
        }
    }
}

object NetworkDiscoveryHub {
    private const val MULTICAST_GROUP = "239.255.255.250"
    private const val DISCOVERY_PORT = 1900
    private var isBroadcasting = false
    private var socket: java.net.MulticastSocket? = null

    fun startLocalDiscoveryBroadcast(serverIpAddress: String, activePort: Int) {
        if (isBroadcasting) return
        isBroadcasting = true
        println("[Discovery] Starting local network multicast discovery hub on $serverIpAddress:$activePort...")

        kotlin.concurrent.thread(start = true, isDaemon = true, name = "ValenixiaDiscoveryBroadcast") {
            try {
                val groupTarget = java.net.InetAddress.getByName(MULTICAST_GROUP)
                val mSocket = java.net.MulticastSocket(DISCOVERY_PORT)
                socket = mSocket
                mSocket.joinGroup(groupTarget)

                val packetPayload = "VALENIXIA-POS-DISCOVERY:$serverIpAddress:$activePort"
                val bufferData = packetPayload.toByteArray()

                while (isBroadcasting) {
                    val packetStream = java.net.DatagramPacket(bufferData, bufferData.size, groupTarget, DISCOVERY_PORT)
                    mSocket.send(packetStream)
                    java.lang.Thread.sleep(4000)
                }
            } catch (e: Exception) {
                println("[Discovery] Multicast packet broadcast failed: ${e.message}")
            }
        }
    }

    fun terminateDiscoverySignal() {
        isBroadcasting = false
        try {
            socket?.close()
        } catch (e: Exception) { /* Context safety cleanup */ }
    }
}
