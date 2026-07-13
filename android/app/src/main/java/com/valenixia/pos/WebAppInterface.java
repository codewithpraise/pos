package com.valenixia.pos;

import android.webkit.JavascriptInterface;

public class WebAppInterface {
    private MainActivity activity;

    public WebAppInterface(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void printBluetooth(String payload) {
        // Expose printBluetooth to Javascript as required
        activity.printBluetoothNative(payload);
    }
}
