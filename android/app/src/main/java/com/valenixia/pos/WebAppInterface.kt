package com.valenixia.pos

import android.webkit.JavascriptInterface

class WebAppInterface(private val activity: MainActivity) {
    @JavascriptInterface
    fun printBluetooth(payload: String) {
        activity.printBluetoothNative(payload)
    }
}
