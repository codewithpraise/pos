package com.nexova.pos

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileOutputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

// ============================================================
// Android Keystore Helper – hardware-backed AES-GCM key management
// Generates and stores a 256-bit AES key in the hardware-backed
// Android Keystore under the alias "nexova_prefs_key".
// ============================================================
object KeyStoreHelper {
    private const val KEY_ALIAS = "nexova_prefs_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).also { it.load(null) }
        keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }
        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGen.init(spec)
        return keyGen.generateKey()
    }

    /** Encrypt a plaintext string using the Keystore key. Returns Base64-encoded "iv:ciphertext". */
    fun encrypt(plaintext: String): String {
        val key = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encrypted, 0, combined, iv.size, encrypted.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    /** Decrypt a Base64-encoded "iv+ciphertext" blob produced by encrypt(). Returns empty string on failure. */
    fun decrypt(encoded: String): String {
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size < 13) return ""
            val iv = combined.copyOfRange(0, 12)
            val ciphertext = combined.copyOfRange(12, combined.size)
            val key = getOrCreateSecretKey()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.e("KeyStoreHelper", "Decryption failed: ${e.message}")
            ""
        }
    }
}

class MainActivity : AppCompatActivity() {

    private var webView: WebView? = null
    private lateinit var prefs: SharedPreferences
    private var serverUrl: String = ""
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQUEST_CODE = 1234
    private val REQUEST_INSTALL_PACKAGES_CODE = 9999

    // Track file downloaded for installer callback
    private var downloadedApkFile: File? = null

    @Volatile
    private var currentLoadedUrl: String = ""

    private val keyCache = java.util.concurrent.ConcurrentHashMap<String, SecretKeySpec>()
    private var sessionSalt: ByteArray? = null

    private fun getSessionSalt(): ByteArray {
        var salt = sessionSalt
        if (salt == null) {
            salt = ByteArray(16)
            SecureRandom().nextBytes(salt)
            sessionSalt = salt
        }
        return salt
    }

    private fun getDerivedKey(passphrase: String, salt: ByteArray): SecretKeySpec {
        val saltHex = salt.joinToString("") { "%02x".format(it) }
        val cacheKey = "$passphrase:$saltHex"
        keyCache[cacheKey]?.let { return it }
        
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, 600000, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val secretKey = SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
        keyCache[cacheKey] = secretKey
        return secretKey
    }

    private fun isUrlAllowed(url: String): Boolean {
        val uri = Uri.parse(url)
        val scheme = uri.scheme ?: return false
        if (scheme == "https" || scheme == "file") return true
        if (scheme == "http") {
            val host = uri.host ?: return false
            if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true
            if (host.startsWith("192.168.") || host.startsWith("10.")) return true
            if (host.startsWith("172.")) {
                val parts = host.split(".")
                if (parts.size >= 2) {
                    val secondOctet = parts[1].toIntOrNull()
                    if (secondOctet != null && secondOctet in 16..31) return true
                }
            }
            return false
        }
        return false
    }

    private fun isCurrentOriginTrusted(): Boolean {
        val url = currentLoadedUrl
        if (url.startsWith("file:///android_asset/")) return true
        if (serverUrl.isNotEmpty() && url.startsWith(serverUrl)) {
            return isUrlAllowed(url)
        }
        return false
    }

    // ============================================================
    // CRITICAL FIX: JavascriptInterface MUST be a named inner class.
    // Anonymous `object { }` in Kotlin does NOT expose @JavascriptInterface
    // methods to JavaScript -- they are silently stripped by the compiler.
    // ============================================================
    inner class AndroidPOSBridge {

        @JavascriptInterface
        fun setServerUrl(url: String) {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "setServerUrl call rejected: untrusted origin.")
                return
            }
            runOnUiThread {
                try {
                    val encrypted = KeyStoreHelper.encrypt(url)
                    prefs.edit().putString("server_url_enc", encrypted).apply()
                } catch (e: Exception) {
                    Log.w("AndroidPOSBridge", "Keystore unavailable, falling back to plaintext: ${e.message}")
                    prefs.edit().putString("server_url", url).apply()
                }
                serverUrl = url
                Toast.makeText(this@MainActivity, "Server updated: $url", Toast.LENGTH_SHORT).show()
            }
        }

        // PBKDF2-SHA256: mirrors Node.js crypto.pbkdf2 and client-db.js verifyPinClient.
        @JavascriptInterface
        fun pbkdf2(password: String, saltHex: String, iterations: Int, keyLen: Int): String {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "pbkdf2 call rejected: untrusted origin.")
                return ""
            }
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
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "encryptAES call rejected: untrusted origin.")
                return ""
            }
            if (text.isEmpty() || passphrase.isEmpty()) return ""
            return try {
                val salt = getSessionSalt()
                val secretKey = getDerivedKey(passphrase, salt)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                val iv = ByteArray(12)
                SecureRandom().nextBytes(iv)
                cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
                val encrypted = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
                
                val combined = ByteArray(salt.size + iv.size + encrypted.size)
                System.arraycopy(salt, 0, combined, 0, salt.size)
                System.arraycopy(iv, 0, combined, salt.size, iv.size)
                System.arraycopy(encrypted, 0, combined, salt.size + iv.size, encrypted.size)
                
                Base64.encodeToString(combined, Base64.NO_WRAP)
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "encryptAES error: ${e.message}")
                ""
            }
        }

        @JavascriptInterface
        fun decryptAES(base64Ciphertext: String, passphrase: String): String {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "decryptAES call rejected: untrusted origin.")
                return ""
            }
            if (base64Ciphertext.isEmpty() || passphrase.isEmpty()) return ""
            return try {
                val combined = Base64.decode(base64Ciphertext, Base64.NO_WRAP)
                if (combined.size < 28) return ""
                
                val salt = combined.copyOfRange(0, 16)
                val iv = combined.copyOfRange(16, 28)
                val encrypted = combined.copyOfRange(28, combined.size)
                
                val secretKey = getDerivedKey(passphrase, salt)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                val ivSpec = GCMParameterSpec(128, iv)
                cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec)
                String(cipher.doFinal(encrypted), Charsets.UTF_8)
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "decryptAES error: ${e.message}")
                ""
            }
        }

        @JavascriptInterface
        fun getServerUrl(): String {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "getServerUrl call rejected: untrusted origin.")
                return ""
            }
            return serverUrl
        }

        @JavascriptInterface
        fun setAutoStartOnBoot(enabled: Boolean) {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "setAutoStartOnBoot call rejected: untrusted origin.")
                return
            }
            runOnUiThread {
                prefs.edit().putBoolean("auto_start_on_boot", enabled).apply()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    try {
                        val directContext = createDeviceProtectedStorageContext()
                        val directPrefs = directContext.getSharedPreferences("nexova_prefs", Context.MODE_PRIVATE)
                        directPrefs.edit().putBoolean("auto_start_on_boot", enabled).apply()
                    } catch (e: Exception) {
                        Log.e("AndroidPOSBridge", "Device protected storage write error: ${e.message}")
                    }
                }
                Toast.makeText(this@MainActivity, "Auto-start on boot: " + (if (enabled) "ENABLED" else "DISABLED"), Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun getAutoStartOnBoot(): Boolean {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "getAutoStartOnBoot call rejected: untrusted origin.")
                return false
            }
            return prefs.getBoolean("auto_start_on_boot", false)
        }

        @JavascriptInterface
        fun consumeFreshStartFlag(): Boolean {
            if (!isCurrentOriginTrusted()) {
                Log.w("AndroidPOSBridge", "consumeFreshStartFlag call rejected: untrusted origin.")
                return false
            }
            val fresh = prefs.getBoolean("fresh_start", false)
            if (fresh) {
                prefs.edit().putBoolean("fresh_start", false).apply()
            }
            return fresh
        }
    }

    inner class POSHardwareInterface {
        @JavascriptInterface
        fun printReceipt(base64Payload: String) {
            if (!isCurrentOriginTrusted()) {
                Log.w("POSHardwareInterface", "printReceipt call rejected: untrusted origin.")
                return
            }
            Log.d("POSHardwareInterface", "printReceipt called with base64 payload size: ${base64Payload.length}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        
        prefs = getSharedPreferences("nexova_prefs", Context.MODE_PRIVATE)

        val requiredPermissions = mutableListOf<String>()
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requiredPermissions.add(android.Manifest.permission.CAMERA)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requiredPermissions.add(android.Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requiredPermissions.add(android.Manifest.permission.BLUETOOTH_SCAN)
            }
        }
        if (requiredPermissions.isNotEmpty()) {
            requestPermissions(requiredPermissions.toTypedArray(), 100)
        }

        // Install uncaught exception handler — writes crash diagnostics to local file
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val crashLog = "${System.currentTimeMillis()} [CRASH] Thread=${thread.name}\n$sw\n"
                val logFile = File(getExternalFilesDir(null), "nexova_crash.log")
                logFile.appendText(crashLog)
                Log.e("NexovaCrash", crashLog)
            } catch (_: Exception) {}
            defaultHandler?.uncaughtException(thread, throwable)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webView
                if (wv != null) {
                    wv.evaluateJavascript("window.onNativeBackPressed()") { result ->
                        if (result != "true") {
                            if (wv.canGoBack()) {
                                wv.goBack()
                            } else {
                                Toast.makeText(this@MainActivity, "Use the logout button to exit", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        })

        serverUrl = try {
            val enc = prefs.getString("server_url_enc", null)
            if (!enc.isNullOrEmpty()) KeyStoreHelper.decrypt(enc).ifEmpty { prefs.getString("server_url", "") ?: "" }
            else prefs.getString("server_url", "") ?: ""
        } catch (e: Exception) {
            Log.w("MainActivity", "Keystore read failed, using plaintext fallback: ${e.message}")
            prefs.getString("server_url", "") ?: ""
        }

        if (serverUrl.isEmpty()) {
            serverUrl = "file:///android_asset/index.html"
        }
        showWebView(serverUrl)
    }

    override fun onDestroy() {
        webView?.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun showWebView(url: String) {
        if (!isUrlAllowed(url)) {
            Log.e("MainActivity", "Blocked attempt to load unsafe URL: $url")
            runOnUiThread { showReconnectScreen() }
            return
        }
        webView?.destroy()
        val wv = WebView(this)
        
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            @Suppress("DEPRECATION")
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        // Enable Google Safe Browsing on Android 8.0+ (API 26+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            wv.settings.safeBrowsingEnabled = true
        }

        wv.addJavascriptInterface(AndroidPOSBridge(), "AndroidPOS")
        wv.addJavascriptInterface(POSHardwareInterface(), "AndroidHardware")

        wv.setDownloadListener { downloadUrl, _, _, _, _ ->
            if (downloadUrl.endsWith(".apk") || downloadUrl.contains("/downloads/")) {
                if (!isCurrentOriginTrusted()) {
                    Log.w("MainActivity", "Blocked update download request from untrusted origin: $currentLoadedUrl")
                    return@setDownloadListener
                }
                androidx.appcompat.app.AlertDialog.Builder(this@MainActivity, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                    .setTitle("Software Update")
                    .setMessage("An update is available for Nexova POS. Do you want to download and install this update?")
                    .setPositiveButton("Download") { _, _ ->
                        Toast.makeText(this@MainActivity, "Downloading Nexova POS update...", Toast.LENGTH_SHORT).show()
                        startApkDownload(downloadUrl)
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                androidx.appcompat.app.AlertDialog.Builder(this@MainActivity, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                    .setTitle("Nexova POS")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                androidx.appcompat.app.AlertDialog.Builder(this@MainActivity, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                    .setTitle("Nexova POS")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView?,
                url: String?,
                message: String?,
                defaultValue: String?,
                result: JsPromptResult?
            ): Boolean {
                val input = android.widget.EditText(this@MainActivity).apply {
                    setText(defaultValue)
                }
                androidx.appcompat.app.AlertDialog.Builder(this@MainActivity, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                    .setTitle("Nexova POS")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton(android.R.string.ok) { _, _ ->
                        result?.confirm(input.text.toString())
                    }
                    .setNegativeButton(android.R.string.cancel) { _, _ ->
                        result?.cancel()
                    }
                    .setOnCancelListener { result?.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { 
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        request.grant(request.resources) 
                    }
                }
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, true, false)
            }
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    val msg = "${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}"
                    when (it.messageLevel()) {
                        ConsoleMessage.MessageLevel.ERROR -> Log.e("NexovaJS", msg)
                        ConsoleMessage.MessageLevel.WARNING -> Log.w("NexovaJS", msg)
                        else -> Log.d("NexovaJS", msg)
                    }
                }
                return true
            }
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                uploadMessage?.onReceiveValue(null)
                uploadMessage = filePathCallback
                
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "text/csv"
                }
                try {
                    startActivityForResult(
                        Intent.createChooser(intent, "Choose File"),
                        FILE_CHOOSER_REQUEST_CODE
                    )
                } catch (e: Exception) {
                    uploadMessage = null
                    Toast.makeText(this@MainActivity, "Cannot Open File Chooser", Toast.LENGTH_SHORT).show()
                    return false
                }
                return true
            }
        }

        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                currentLoadedUrl = url ?: ""
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    Log.e("NexovaPOS", "Page load error: ${error?.description}")
                    runOnUiThread { showReconnectScreen() }
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val reqUrl = request?.url?.toString() ?: return false
                if (!isUrlAllowed(reqUrl)) {
                    Log.w("MainActivity", "Blocked unsafe non-LAN cleartext URL: $reqUrl")
                    Toast.makeText(this@MainActivity, "Access to insecure link blocked", Toast.LENGTH_SHORT).show()
                    return true
                }
                if (reqUrl.startsWith("file:///android_asset/")) return false
                return !reqUrl.startsWith("http://${getServerHost()}")
            }
            private fun getServerHost(): String {
                return try {
                    val parsed = URL(serverUrl)
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
            showWebView("file:///android_asset/index.html")
        }
        root.addView(icon); root.addView(title); root.addView(body)
        root.addView(retryBtn); root.addView(changeBtn)
        setContentView(root)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE) {
            // Force WebView to release non-essential memory back to the OS
            webView?.evaluateJavascript("if(window.gc) window.gc();", null)
            System.gc()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (uploadMessage == null) return
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            uploadMessage?.onReceiveValue(result)
            uploadMessage = null
        } else if (requestCode == REQUEST_INSTALL_PACKAGES_CODE) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (packageManager.canRequestPackageInstalls()) {
                    downloadedApkFile?.let { file ->
                        executeApkInstall(file)
                    }
                } else {
                    Toast.makeText(this, "Update cancelled: installation permission denied.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // =========================================================================
    // SILENT DOWNLOADER & PKG INSTALLER (KIOSK SECURITY HARDENING)
    // =========================================================================
    private fun startApkDownload(urlStr: String) {
        kotlin.concurrent.thread {
            try {
                val url = URL(urlStr)
                val connection = url.openConnection() as HttpURLConnection
                connection.connect()

                val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                val file = File(dir, "update.apk")
                if (file.exists()) file.delete()

                val inputStream = connection.inputStream
                val outputStream = FileOutputStream(file)
                val buffer = ByteArray(4096)
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                }
                outputStream.close()
                inputStream.close()

                downloadedApkFile = file

                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Download complete. Preparing installation...", Toast.LENGTH_SHORT).show()
                    executeApkInstall(file)
                }
            } catch (e: Exception) {
                Log.e("MainActivity", "Download APK error: ${e.message}")
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Download failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun executeApkInstall(file: File) {
        // Android 8+ (Oreo) "Unknown Sources" dynamic check
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!packageManager.canRequestPackageInstalls()) {
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivityForResult(intent, REQUEST_INSTALL_PACKAGES_CODE)
                    Toast.makeText(this, "Please authorize Nexova POS to install updates.", Toast.LENGTH_LONG).show()
                    return
                } catch (e: Exception) {
                    Log.e("MainActivity", "Failed to start Unknown Apps setting: ${e.message}")
                }
            }
        }

        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                file
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(installIntent)
        } catch (e: Exception) {
            Log.e("MainActivity", "Install APK error: ${e.message}")
            Toast.makeText(this, "Installation failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}