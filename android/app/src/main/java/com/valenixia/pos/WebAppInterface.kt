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
}
