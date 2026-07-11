package com.valenixia.pos

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class KeyStoreHelperTest {

    @Test
    fun testEncryptDecryptRoundTrip() {
        val originalText = "http://localhost:3000"
        val encrypted = KeyStoreHelper.encrypt(originalText)
        assertNotEquals(originalText, encrypted)
        assertTrue(encrypted.isNotEmpty())

        val decrypted = KeyStoreHelper.decrypt(encrypted)
        assertEquals(originalText, decrypted)
    }

    @Test
    fun testDecryptWithInvalidPayload() {
        val decrypted = KeyStoreHelper.decrypt("invalid-base64-payload")
        assertEquals("", decrypted)
    }

    @Test
    fun testDecryptWithShortPayload() {
        val decrypted = KeyStoreHelper.decrypt("aGVsbG8=") // Decodes but is too short for IV
        assertEquals("", decrypted)
    }

    @Test
    fun testKeyRotationSimulation() {
        val originalText = "http://192.168.1.100:3000"
        val encrypted = KeyStoreHelper.encrypt(originalText)

        // Delete the key from KeyStore to simulate key loss/rotation
        val keyStore = KeyStore.getInstance("AndroidKeyStore").also { it.load(null) }
        keyStore.deleteEntry("valenixia_prefs_key")

        // Decrypting the old encrypted string should now fail and return empty string
        val decryptedOld = KeyStoreHelper.decrypt(encrypted)
        assertEquals("", decryptedOld)

        // Generating a new encryption should succeed and decrypt with the new key
        val newEncrypted = KeyStoreHelper.encrypt(originalText)
        val decryptedNew = KeyStoreHelper.decrypt(newEncrypted)
        assertEquals(originalText, decryptedNew)
    }
}
