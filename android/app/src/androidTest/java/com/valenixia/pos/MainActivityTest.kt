package com.valenixia.pos

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.Espresso.pressBack
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.hamcrest.CoreMatchers.containsString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class MainActivityTest {

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        prefs = context.getSharedPreferences("valenixia_prefs", Context.MODE_PRIVATE)
        prefs.edit().clear().apply()
    }

    @After
    fun tearDown() {
        prefs.edit().clear().apply()
        val logFile = File(context.getExternalFilesDir(null), "valenixia_crash.log")
        if (logFile.exists()) logFile.delete()
    }

    @Test
    fun testMainActivityLaunchesAndLoadsAssetHtml() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        onView(withClassName(containsString("WebView"))).check(matches(isDisplayed()))

        scenario.onActivity { activity ->
            // Assert local assets URL is loaded
            val webView = activity.findViewById<WebView>(activity.webView?.id ?: 0)
            assertTrue(webView.url?.startsWith("file:///android_asset/index.html") == true)
            // Assert vertical scroll bar is enabled
            assertTrue(webView.isVerticalScrollBarEnabled)
        }
    }

    @Test
    fun testOrientationIsLockedToPortrait() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            val requestedOrientation = activity.requestedOrientation
            // ActivityInfo.SCREEN_ORIENTATION_PORTRAIT is 1
            assertEquals(1, requestedOrientation)
        }
    }

    @Test
    fun testBackButtonTriggersExitConfirmation() {
        ActivityScenario.launch(MainActivity::class.java)
        pressBack()
        onView(withText("Exit Valenixia POS?")).check(matches(isDisplayed()))
        onView(withText("Exit")).check(matches(isDisplayed()))
        onView(withText("Cancel")).check(matches(isDisplayed()))
    }

    @Test
    fun testCrashLogRotationEnforced() {
        // Write a mock log file that is > 2MB
        val logFile = File(context.getExternalFilesDir(null), "valenixia_crash.log")
        if (logFile.exists()) logFile.delete()
        
        // Write 2.5 MB of mock crash logs
        val line = "1234567890 [CRASH] Thread=main\nStack trace line data\n"
        logFile.printWriter().use { out ->
            for (i in 0..50000) {
                out.println(line)
            }
        }
        assertTrue(logFile.length() > 2 * 1024 * 1024)

        // Launch activity to trigger rotateAndUploadCrashLogs()
        ActivityScenario.launch(MainActivity::class.java)
        
        // Wait a brief moment for background rotation thread to execute
        Thread.sleep(1500)
        
        // Assert log has been trimmed to under 1.5MB
        assertTrue(logFile.length() < 1.5 * 1024 * 1024)
    }
}
