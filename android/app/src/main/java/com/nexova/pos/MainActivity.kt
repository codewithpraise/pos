package com.nexova.pos

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
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

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences
    private var serverUrl: String = ""
    private var discoveryThread: Thread? = null
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Request runtime permissions for Camera and Microphone
        val neededPerms = arrayOf(
            android.Manifest.permission.CAMERA,
            android.Manifest.permission.RECORD_AUDIO
        )
        val missing = neededPerms.filter {
            androidx.core.content.ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            androidx.core.app.ActivityCompat.requestPermissions(this, missing.toTypedArray(), 101)
        }

        prefs = getSharedPreferences("nexova_prefs", Context.MODE_PRIVATE)
        serverUrl = prefs.getString("server_url", "") ?: ""

        if (serverUrl.isNotEmpty()) {
            showWebView(serverUrl)
        } else {
            showServerSetup()
            startMulticastListener { discoveredUrl ->
                Toast.makeText(this, "Discovered Nexova Server: $discoveredUrl", Toast.LENGTH_LONG).show()
                prefs.edit().putString("server_url", discoveredUrl).apply()
                serverUrl = discoveredUrl
                stopMulticastListener()
                showWebView(discoveredUrl)
            }
        }
    }

    override fun onDestroy() {
        stopMulticastListener()
        super.onDestroy()
    }

    private fun startMulticastListener(onDiscovered: (String) -> Unit) {
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
        multicastLock = wifi?.createMulticastLock("NexovaDiscoveryLock")?.apply {
            setReferenceCounted(true)
            acquire()
        }

        discoveryThread = Thread {
            var socket: java.net.MulticastSocket? = null
            try {
                val group = java.net.InetAddress.getByName("239.255.255.250")
                socket = java.net.MulticastSocket(1900)
                socket.joinGroup(group)

                val buffer = ByteArray(256)
                while (!Thread.currentThread().isInterrupted) {
                    val packet = java.net.DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val message = String(packet.data, 0, packet.length).trim()
                    
                    if (message.startsWith("NEXOVA-POS-DISCOVERY:")) {
                        val parts = message.split(":")
                        if (parts.size >= 3) {
                            val ip = parts[1]
                            val port = parts[2]
                            val discoveredUrl = "http://$ip:$port"
                            
                            runOnUiThread {
                                onDiscovered(discoveredUrl)
                            }
                            break
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("NexovaPOS", "Multicast receiver error: ${e.message}")
            } finally {
                try {
                    socket?.leaveGroup(java.net.InetAddress.getByName("239.255.255.250"))
                    socket?.close()
                } catch (e: Exception) {}
                try {
                    if (multicastLock?.isHeld == true) {
                        multicastLock?.release()
                    }
                } catch (e: Exception) {}
            }
        }
        discoveryThread?.start()
    }

    private fun stopMulticastListener() {
        discoveryThread?.interrupt()
        discoveryThread = null
    }

    // ─── Server Setup Screen ─────────────────────────────────────────────────

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
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                    android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
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
            setPadding(0, 0, 0, 0)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 128
            )
            lp.topMargin = 32
            layoutParams = lp
        }

        val localBtn = Button(this).apply {
            text = "START FRESH (RUN LOCALLY)"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF1F1F2E.toInt())
            letterSpacing = 0.1f
            setPadding(0, 0, 0, 0)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 128
            )
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

            Thread {
                val reachable = isPortOpen(ip, port.toIntOrNull() ?: 3000, 3000)
                runOnUiThread {
                    if (reachable) {
                        val url = "http://$ip:$port"
                        prefs.edit()
                            .putString("server_url", url)
                            .putString("last_ip", ip)
                            .putString("last_port", port)
                            .apply()
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
            }.start()
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

    // ─── WebView POS Screen ──────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWebView(url: String) {
        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                allowFileAccessFromFileURLs = true
                allowUniversalAccessFromFileURLs = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                // Enable Service Workers for offline PWA functionality
                // Modern Android WebViews manage internal cache storage automatically.
            }

            addJavascriptInterface(object {
                @android.webkit.JavascriptInterface
                fun setServerUrl(url: String) {
                    runOnUiThread {
                        prefs.edit().putString("server_url", url).apply()
                        serverUrl = url
                        Toast.makeText(this@MainActivity, "Server connection updated: $url", Toast.LENGTH_SHORT).show()
                    }
                }
            }, "AndroidPOS")

            // Allow geolocation and Camera/Mic permissions
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        request.grant(request.resources)
                    }
                }

                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: GeolocationPermissions.Callback
                ) {
                    callback.invoke(origin, true, false)
                }

                override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                    android.util.Log.d("NexovaPOS", "[${msg.messageLevel()}] ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    // Show reconnect UI if the server is unreachable
                    if (request?.isForMainFrame == true) {
                        runOnUiThread { showReconnectScreen() }
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val reqUrl = request?.url?.toString() ?: return false
                    if (reqUrl.startsWith("file:///android_asset/")) {
                        return false
                    }
                    // Keep navigation inside WebView for same-origin
                    return !reqUrl.startsWith("http://${getServerHost()}")
                }

                private fun getServerHost(): String {
                    return try {
                        java.net.URL(serverUrl).host + ":" + (java.net.URL(serverUrl).port)
                    } catch (e: Exception) { "" }
                }
            }
        }

        setContentView(webView)
        webView.loadUrl(url)
    }

    private fun showReconnectScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0A0A0F.toInt())
            setPadding(64, 120, 64, 64)
            gravity = android.view.Gravity.CENTER
        }

        val icon = TextView(this).apply {
            text = "!"
            textSize = 48f
            setTextColor(0xFFF59E0B.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "Server Unreachable"
            textSize = 20f
            setTextColor(0xFFFFFFFF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER
            setPadding(0, 16, 0, 8)
        }
        val body = TextView(this).apply {
            text = "Cannot connect to $serverUrl\nEnsure the POS server is running."
            textSize = 13f
            setTextColor(0xFF888899.toInt())
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 40)
        }

        val retryBtn = Button(this).apply {
            text = "RETRY"
            textSize = 13f
            setTextColor(0xFF0A0A0F.toInt())
            setBackgroundColor(0xFF10B981.toInt())
            val lp = LinearLayout.LayoutParams(480, 112)
            layoutParams = lp
        }
        val changeBtn = Button(this).apply {
            text = "CHANGE SERVER"
            textSize = 12f
            setTextColor(0xFF10B981.toInt())
            setBackgroundColor(0x00000000)
            val lp = LinearLayout.LayoutParams(480, 96)
            lp.topMargin = 12
            layoutParams = lp
        }

        retryBtn.setOnClickListener { showWebView(serverUrl) }
        changeBtn.setOnClickListener {
            prefs.edit().remove("server_url").apply()
            showServerSetup()
        }

        root.addView(icon)
        root.addView(title)
        root.addView(body)
        root.addView(retryBtn)
        root.addView(changeBtn)
        setContentView(root)
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    private fun isPortOpen(host: String, port: Int, timeoutMs: Int): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
                true
            }
        } catch (e: Exception) {
            false
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && ::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
