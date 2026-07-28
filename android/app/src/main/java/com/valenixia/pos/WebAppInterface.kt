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

    @JavascriptInterface
    fun pbkdf2(passphrase: String, saltBase64: String, iterations: Int, keyLen: Int): String {
        return try {
            val salt = android.util.Base64.decode(saltBase64, android.util.Base64.NO_WRAP)
            val spec = javax.crypto.spec.PBEKeySpec(passphrase.toCharArray(), salt, iterations, if (keyLen <= 64) keyLen * 8 else keyLen)
            val factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val secretKey = factory.generateSecret(spec)
            android.util.Base64.encodeToString(secretKey.encoded, android.util.Base64.NO_WRAP)
        } catch (e: Exception) {
            android.util.Log.e("WebAppInterface", "pbkdf2 error: ${e.message}")
            ""
        }
    }
}
