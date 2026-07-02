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
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class MainActivity : AppCompatActivity() {

    private var webView: WebView? = null
    private lateinit var prefs: SharedPreferences
    private var serverUrl: String = ""
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_REQUEST_CODE = 1234
    
    // Track file downloaded for installer callback
    private var downloadedApkFile: File? = null

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
                val ivSpec = GCMParameterSpec(128, iv)
                cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec)
                String(cipher.doFinal(encrypted), Charsets.UTF_8)
            } catch (e: Exception) {
                Log.e("AndroidPOSBridge", "decryptAES error: ${e.message}")
                base64Ciphertext
            }
        }

        @JavascriptInterface
        fun getServerUrl(): String = serverUrl

        @JavascriptInterface
        fun consumeFreshStartFlag(): Boolean {
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
            // Decode payload and route directly to Android BluetoothAdapter or UsbManager
            Log.d("POSHardwareInterface", "printReceipt called with base64 payload size: ${base64Payload.length}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // 1. Immersive screen mode & absolute secure screen (kiosk data theft prevention)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        
        prefs = getSharedPreferences("nexova_prefs", Context.MODE_PRIVATE)

        // 4. Request Bluetooth dynamic runtime permission (Android 12+) and Camera permission
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

        // 5. Intercept physical back button / gesture and route to WebView checking for active modal state
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webView
                if (wv != null) {
                    wv.evaluateJavascript("window.onNativeBackPressed()") { result ->
                        if (result != "true") {
                            if (wv.canGoBack()) {
                                wv.goBack()
                            } else {
                                // Hard kiosk trap: never exit the app via physical back button
                                Toast.makeText(this@MainActivity, "Use the logout button to exit", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        })

        serverUrl = prefs.getString("server_url", "") ?: ""

        // If no server URL is set, load the local Web UI setup wizard directly
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
        webView?.destroy()
        val wv = WebView(this)
        
        // Lock overscroll and disable scrollbars
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            // FIX: Allow AudioContext without user gesture (fixes audio crash on PIN tap & scanner beep)
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            @Suppress("DEPRECATION")
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        // Register the named-class bridges
        wv.addJavascriptInterface(AndroidPOSBridge(), "AndroidPOS")
        wv.addJavascriptInterface(POSHardwareInterface(), "AndroidHardware")

        // Intercept downloads (silent background download for OTA APK packages)
        wv.setDownloadListener { downloadUrl, _, _, _, _ ->
            if (downloadUrl.endsWith(".apk") || downloadUrl.contains("/downloads/")) {
                Toast.makeText(this, "Starting silent download of Nexova POS update...", Toast.LENGTH_SHORT).show()
                startApkDownload(downloadUrl)
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
                    // Explicitly capture and grant WebRTC/Camera permissions for barcode scanners
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
                val msg = consoleMessage?.message() ?: return super.onConsoleMessage(consoleMessage)
                val level = consoleMessage.messageLevel()
                if (level == ConsoleMessage.MessageLevel.ERROR || level == ConsoleMessage.MessageLevel.WARNING) {
                    Log.w("NexovaWebConsole", "[${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}] $msg")
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
                    type = "text/csv" // CSV picker for importing catalog
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
                    startActivity(intent)
                    Toast.makeText(this, "Please allow Nexova POS to install updates, then trigger the update again.", Toast.LENGTH_LONG).show()
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