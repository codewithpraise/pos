package com.valenixia.pos;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        // Expose JavaScript Interfaces as required
        webView.addJavascriptInterface(new WebAppInterface(this), "Android");
    }

    public void printBluetoothNative(String payload) {
        // Bluetooth print native helper stub
    }
}
