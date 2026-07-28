package com.valenixia.pos

import android.webkit.JavascriptInterface

class WebAppInterface(private val activity: MainActivity) {
    @JavascriptInterface
    fun printBluetooth(payload: String) {
        if (!activity.isCurrentOriginTrusted()) {
            android.util.Log.w("WebAppInterface", "printBluetooth rejected: untrusted origin")
            return
        }
        activity.printBluetoothNative(payload)
    }

    @JavascriptInterface
    fun consumeFreshStartFlag(): Boolean {
        return try {
            activity.consumeFreshStartFlagNative()
        } catch (e: Exception) {
            android.util.Log.e("WebAppInterface", "consumeFreshStartFlag error: ${e.message}")
            false
        }
    }

    @JavascriptInterface
    fun getAutoStartOnBoot(): Boolean {
        return try {
            activity.getAutoStartOnBootNative()
        } catch (e: Exception) {
            android.util.Log.e("WebAppInterface", "getAutoStartOnBoot error: ${e.message}")
            false
        }
    }
}
