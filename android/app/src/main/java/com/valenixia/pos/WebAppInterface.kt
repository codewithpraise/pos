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
    fun pbkdf2(passphrase: String?, saltBase64: String?, iterations: Int, keyLen: Int): String {
        if (passphrase.isNullOrEmpty() || saltBase64.isNullOrEmpty()) return ""
        return try {
            val salt = try {
                if (saltBase64.matches(Regex("^[0-9a-fA-F]+$")) && saltBase64.length % 2 == 0) {
                    ByteArray(saltBase64.length / 2) { i ->
                        saltBase64.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                    }
                } else {
                    android.util.Base64.decode(saltBase64, android.util.Base64.NO_WRAP)
                }
            } catch (e: Exception) {
                saltBase64.toByteArray(Charsets.UTF_8)
            }
            val keyBitLen = if (keyLen <= 64) keyLen * 8 else keyLen
            val iter = if (iterations > 0) iterations else 100000
            val spec = javax.crypto.spec.PBEKeySpec(passphrase.toCharArray(), salt, iter, keyBitLen)
            val factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val secretKey = factory.generateSecret(spec)
            secretKey.encoded.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            android.util.Log.e("WebAppInterface", "pbkdf2 error: ${e.message}")
            ""
        }
    }
}
