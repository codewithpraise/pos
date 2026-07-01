package com.nexova.pos

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private var webView: WebView? = null
    private lateinit var prefs: SharedPreferences
    private var serverUrl: String = ""
    private var discoveryThread: Thread? = null
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null

    // ============================================================
    // CRITICAL FIX: JavascriptInterface MUST be a named inner class.
    // Anonymous `object { }` in Kotlin does NOT expose @JavascriptInterface
    // methods to JavaScript -- they are silently stripped by the compiler.
    // This was the ROOT CAUSE of ALL crypto/PIN failures on mobile.
    // ============================================================
    inner class AndroidPOSBridge {

        @JavascriptInterface
        fun setServerUrl(url: String) {
            runOnUiThread {
                prefs.edit().putString("server_url", url).apply()
                serverUrl = url
                Toast.makeText(this@MainActivity, "Server updated: $url", Toast.LENGTH_SHORT).show()
            }
        }

        // PBKDF2-SHA256: mirrors Node.js crypto.pbkdf2 and client-db.js verifyPinClient.
        // Called when window.crypto.subtle is unavailable on HTTP (Android WebView on LAN).
        @JavascriptInterface
        fun pbkdf2(password: String, saltHex: String, iterations: Int, keyLen: Int): String {
            return try {
                val saltBytes = ByteArray(saltHex.length / 2)
                for (i in saltBytes.indices) {
                    saltBytes[i] = saltHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                }
                val spec = PBEKeySpec(password.toCharArray(), saltBytes, iterations, keyLen * 8)
                val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                val hash = factory.generateSecret(spec).encoded
                hash.joinToString("") { "%02x".format(it) }
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "pbkdf2 error: ${e.message}")
                ""
            }
        }

        @JavascriptInterface
        fun encryptAES(text: String, passphrase: String): String {
            return try {
                val salt = "nexova_salt".toByteArray()
                val spec = PBEKeySpec(passphrase.toCharArray(), salt, 600000, 256)
                val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                val secretKey = SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                val iv = ByteArray(12)
                SecureRandom().nextBytes(iv)
                cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
                val encrypted = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
                val combined = ByteArray(iv.size + encrypted.size)
                System.arraycopy(iv, 0, combined, 0, iv.size)
                System.arraycopy(encrypted, 0, combined, iv.size, encrypted.size)
                Base64.encodeToString(combined, Base64.NO_WRAP)
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "encryptAES error: ${e.message}")
                text
            }
        }

        @JavascriptInterface
        fun decryptAES(base64Ciphertext: String, passphrase: String): String {
            return try {
                val combined = Base64.decode(base64Ciphertext, Base64.NO_WRAP)
                val iv = combined.copyOfRange(0, 12)
                val encrypted = combined.copyOfRange(12, combined.size)
                val salt = "nexova_salt".toByteArray()
                val spec = PBEKeySpec(passphrase.toCharArray(), salt, 600000, 256)
                val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                val secretKey = SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
                String(cipher.doFinal(encrypted), Charsets.UTF_8)
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "decryptAES error: ${e.message}")
                base64Ciphertext
            }
        }

        @JavascriptInterface
        fun getServerUrl(): String = serverUrl
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("nexova_prefs", Context.MODE_PRIVATE)
        serverUrl = prefs.getString("server_url", "") ?: ""

        if (serverUrl.isNotEmpty()) {
            showWebView(serverUrl)
        } else {
            showServerSetup()
            startMulticastListener { discoveredUrl ->
                runOnUiThread {
                    Toast.makeText(this, "Nexova Server found: $discoveredUrl", Toast.LENGTH_LONG).show()
                    prefs.edit().putString("server_url", discoveredUrl).apply()
                    serverUrl = discoveredUrl
                    stopMulticastListener()
                    showWebView(discoveredUrl)
                }
            }
        }
    }

    override fun onDestroy() {
        stopMulticastListener()
        webView?.destroy()
        super.onDestroy()
    }

    private fun startMulticastListener(onDiscovered: (String) -> Unit) {
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
        multicastLock = wifi?.createMulticastLock("NexovaDiscoveryLock")?.apply {
            setReferenceCounted(true)
            acquire()
        }
        discoveryThread = thread(start = true) {
            var socket: java.net.MulticastSocket? = null
            try {
                val group = java.net.InetAddress.getByName("239.255.255.250")
                socket = java.net.MulticastSocket(1900)
                socket.soTimeout = 15000 // 15s hard timeout - protects battery life
                socket.joinGroup(group)
                val buffer = ByteArray(256)
                val packet = java.net.DatagramPacket(buffer, buffer.size)
                socket.receive(packet)
                val message = String(packet.data, 0, packet.length).trim()
                if (message.startsWith("NEXOVA-POS-DISCOVERY:")) {
                    val parts = message.split(":")
                    if (parts.size >= 3) {
                        onDiscovered("http://${parts[1]}:${parts[2]}")
                    }
                }
            } catch (e: java.net.SocketTimeoutException) {
                Log.w("NexovaPOS", "Discovery timed out after 15s.")
            } catch (e: Exception) {
                if (!Thread.currentThread().isInterrupted) {
                    Log.e("NexovaPOS", "Multicast error: ${e.message}")
                }
            } finally {
                try { socket?.leaveGroup(java.net.InetAddress.getByName("239.255.255.250")) } catch (e: Exception) {}
                try { socket?.close() } catch (e: Exception) {}
                try { if (multicastLock?.isHeld == true) multicastLock?.release() } catch (e: Exception) {}
            }
        }
    }

    private fun stopMulticastListener() {
        discoveryThread?.interrupt()
        discoveryThread = null
        try { if (multicastLock?.isHeld == true) multicastLock?.release() } catch (e: Exception) {}
    }

    private fun showServerSetup() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0A0A0F.toInt())
            setPadding(64, 120, 64, 64)
        }
        val title = TextView(this).apply {
            text = "NEXOVA POS"
            textSize = 28f
            setTextColor(0xFF10B981.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 8)
        }
        val subtitle = TextView(this).apply {
            text = "Connect to your local server"
            textSize = 13f
            setTextColor(0xFF888899.toInt())
            setPadding(0, 0, 0, 48)
        }
        val label = TextView(this).apply {
            text = "Server IP Address"
            textSize = 11f
            setTextColor(0xFF888899.toInt())
            letterSpacing = 0.1f
            setPadding(0, 0, 0, 8)
        }
        val ipInput = EditText(this).apply {
            hint = "192.168.x.x"
            setHintTextColor(0xFF444455.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 16f
            setBackgroundColor(0xFF121217.toInt())
            setPadding(24, 20, 24, 20)
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            val savedIp = prefs.getString("last_ip", "") ?: ""
            if (savedIp.isNotEmpty()) setText(savedIp)
        }
        val portLabel = TextView(this).apply {
            text = "Port (default: 3000)"
            textSize = 11f
            setTextColor(0xFF888899.toInt())
            letterSpacing = 0.1f
            setPadding(0, 24, 0, 8)
        }
        val portInput = EditText(this).apply {
            hint = "3000"
            setHintTextColor(0xFF444455.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 16f
            setBackgroundColor(0xFF121217.toInt())
            setPadding(24, 20, 24, 20)
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText(prefs.getString("last_port", "3000") ?: "3000")
        }
        val statusText = TextView(this).apply {
            textSize = 11f
            setTextColor(0xFF888899.toInt())
            setPadding(0, 16, 0, 0)
            visibility = View.GONE
        }
        val connectBtn = Button(this).apply {
            text = "CONNECT TO SERVER"
            textSize = 13f
            setTextColor(0xFF0A0A0F.toInt())
            setBackgroundColor(0xFF10B981.toInt())
            letterSpacing = 0.1f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 128)
            lp.topMargin = 32
            layoutParams = lp
        }
        val localBtn = Button(this).apply {
            text = "START FRESH (RUN LOCALLY)"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF1F1F2E.toInt())
            letterSpacing = 0.1f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 128)
            lp.topMargin = 16
            layoutParams = lp
        }
        connectBtn.setOnClickListener {
            val ip = ipInput.text.toString().trim()
            val port = portInput.text.toString().trim().ifEmpty { "3000" }
            if (ip.isEmpty()) {
                Toast.makeText(this@MainActivity, "Please enter a server IP address", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            statusText.visibility = View.VISIBLE
            statusText.setTextColor(0xFFAAAAAA.toInt())
            statusText.text = "Checking connection to $ip:$port..."
            connectBtn.isEnabled = false
            thread {
                val reachable = isPortOpen(ip, port.toIntOrNull() ?: 3000, 3000)
                runOnUiThread {
                    if (reachable) {
                        val url = "http://$ip:$port"
                        prefs.edit().putString("server_url", url).putString("last_ip", ip).putString("last_port", port).apply()
                        serverUrl = url
                        statusText.setTextColor(0xFF10B981.toInt())
                        statusText.text = "Connected! Loading POS..."
                        showWebView(url)
                    } else {
                        statusText.setTextColor(0xFFEF4444.toInt())
                        statusText.text = "Cannot reach $ip:$port. Ensure the server is running."
                        connectBtn.isEnabled = true
                    }
                }
            }
        }
        localBtn.setOnClickListener {
            val url = "file:///android_asset/index.html"
            prefs.edit().putString("server_url", url).apply()
            serverUrl = url
            showWebView(url)
        }
        root.addView(title)
        root.addView(subtitle)
        root.addView(label)
        root.addView(ipInput)
        root.addView(portLabel)
        root.addView(portInput)
        root.addView(connectBtn)
        root.addView(localBtn)
        root.addView(statusText)
        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun showWebView(url: String) {
        webView?.destroy()
        val wv = WebView(this)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            // FIX: Allow AudioContext without user gesture (fixes audio crash on PIN tap)
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        // Register the named-class bridge -- this is the critical fix
        wv.addJavascriptInterface(AndroidPOSBridge(), "AndroidPOS")

        wv.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, true, false)
            }
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                val msg = consoleMessage?.message() ?: return super.onConsoleMessage(consoleMessage)
                val level = consoleMessage.messageLevel()
                if (level == ConsoleMessage.MessageLevel.ERROR || level == ConsoleMessage.MessageLevel.WARNING) {
                    Log.w("NexovaWebConsole", "[${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}] $msg")
                }
                return true
            }
        }

        wv.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    Log.e("NexovaPOS", "Page load error: ${error?.description}")
                    runOnUiThread { showReconnectScreen() }
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val reqUrl = request?.url?.toString() ?: return false
                if (reqUrl.startsWith("file:///android_asset/")) return false
                return !reqUrl.startsWith("http://${getServerHost()}")
            }
            private fun getServerHost(): String {
                return try {
                    val parsed = java.net.URL(serverUrl)
                    val port = parsed.port
                    if (port == -1) parsed.host else "${parsed.host}:$port"
                } catch (e: Exception) { "" }
            }
        }

        webView = wv
        setContentView(wv)
        wv.loadUrl(url)
    }

    private fun showReconnectScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0A0A0F.toInt())
            setPadding(64, 120, 64, 64)
            gravity = android.view.Gravity.CENTER
        }
        val icon = TextView(this).apply {
            text = "!"; textSize = 48f; setTextColor(0xFFF59E0B.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "Server Unreachable"; textSize = 20f; setTextColor(0xFFFFFFFF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER; setPadding(0, 16, 0, 8)
        }
        val body = TextView(this).apply {
            text = "Cannot connect to $serverUrl\nEnsure the POS server is running."
            textSize = 13f; setTextColor(0xFF888899.toInt())
            gravity = android.view.Gravity.CENTER; setPadding(0, 0, 0, 40)
        }
        val retryBtn = Button(this).apply {
            text = "RETRY"; textSize = 13f; setTextColor(0xFF0A0A0F.toInt())
            setBackgroundColor(0xFF10B981.toInt())
            layoutParams = LinearLayout.LayoutParams(480, 112)
        }
        val changeBtn = Button(this).apply {
            text = "CHANGE SERVER"; textSize = 12f; setTextColor(0xFF10B981.toInt())
            setBackgroundColor(0x00000000)
            val lp = LinearLayout.LayoutParams(480, 96); lp.topMargin = 12; layoutParams = lp
        }
        retryBtn.setOnClickListener { showWebView(serverUrl) }
        changeBtn.setOnClickListener {
            prefs.edit().remove("server_url").apply()
            serverUrl = ""
            showServerSetup()
        }
        root.addView(icon); root.addView(title); root.addView(body)
        root.addView(retryBtn); root.addView(changeBtn)
        setContentView(root)
    }

    private fun isPortOpen(host: String, port: Int, timeoutMs: Int): Boolean {
        return try {
            Socket().use { socket -> socket.connect(InetSocketAddress(host, port), timeoutMs); true }
        } catch (e: Exception) { false }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            val wv = webView
            if (wv != null && wv.canGoBack()) { wv.goBack(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }
}