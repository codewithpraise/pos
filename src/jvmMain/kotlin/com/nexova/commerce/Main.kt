package com.nexova.commerce

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.WindowState
import androidx.compose.ui.window.singleWindowApplication
import androidx.compose.ui.awt.SwingPanel
import com.nexova.commerce.db.Database
import com.nexova.commerce.sync.SyncServer
import java.awt.BorderLayout
import javax.swing.JPanel
import javafx.application.Platform
import javafx.embed.swing.JFXPanel
import javafx.scene.Scene
import javafx.scene.web.WebView

@Composable
fun POSWebView(url: String, modifier: Modifier = Modifier) {
    SwingPanel(
        factory = {
            val panel = JPanel(BorderLayout())
            val jfxPanel = JFXPanel()
            panel.add(jfxPanel, BorderLayout.CENTER)
            
            Platform.runLater {
                val webView = WebView()
                val webEngine = webView.engine
                webEngine.isJavaScriptEnabled = true
                webEngine.load(url)
                
                val scene = Scene(webView)
                jfxPanel.scene = scene
            }
            panel
        },
        modifier = modifier.fillMaxSize()
    )
}

fun main() {
    println("================================================================")
    println("  NEXOVA COMMERCE ECOSYSTEM - BOOTING SHIFT NODE")
    println("================================================================")

    // 1. Initialize SQLite Database with Write-Ahead Logging (WAL)
    val terminalId = "terminal_pc_master"
    Database.initDatabase(terminalId)
    println("[Main] WAL SQLite database connection initialized successfully.")

    // 2. Start Ktor WebSocket & REST local sync server
    SyncServer.startServer(3000)

    // 3. Launch Native Jetpack Compose UI Desktop Frame
    singleWindowApplication(
        title = "Nexova Commerce - Kinetic Flight Deck POS",
        state = WindowState(size = DpSize(1200.dp, 800.dp))
    ) {
        var isServerReady by remember { mutableStateOf(false) }
        
        LaunchedEffect(Unit) {
            // Wait a brief moment for Ktor server to bind and serve static public files
            kotlinx.coroutines.delay(1000)
            isServerReady = true
        }
        
        if (isServerReady) {
            POSWebView("http://localhost:3000")
        } else {
            Box(
                modifier = Modifier.fillMaxSize().background(Color(0xFF050505)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color(0xFF10B981))
                    Spacer(Modifier.height(16.dp))
                    Text("Initializing Nexova Flight Deck...", color = Color(0xFF94A3B8), fontSize = 14.sp)
                }
            }
        }
    }
}
