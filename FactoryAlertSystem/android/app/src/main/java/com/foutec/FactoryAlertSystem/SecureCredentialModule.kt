package com.foutec.FactoryAlertSystem

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * SecureCredentialModule — lưu bí mật nhỏ (mật khẩu MQTT của thiết bị) trong vùng an toàn của Android.
 *
 * doc 81 Đợt 5 task G1 (mục 4+9): admin xoay mật khẩu (`mqttClient.rotatePassword`) ⇒ mật khẩu hiện MỘT lần ⇒
 * kỹ thuật viên gõ vào Cài đặt của máy tính bảng. Mật khẩu KHÔNG được ghi AsyncStorage (văn bản thô):
 *   · khoá AES-256/GCM sinh và giữ TRONG Android Keystore (không xuất ra được, không đi theo bản sao lưu);
 *   · chỉ bản MÃ HOÁ (iv + ciphertext, Base64) nằm trong SharedPreferences riêng của app;
 *   · không giải mã được (khoá mất sau khi xoá dữ liệu/khôi phục) ⇒ trả null — KHÔNG đoán, KHÔNG rơi về thô.
 * JS: src/services/secureCredentialStore.ts (thiếu module này ⇒ JS từ chối lưu, không rơi về AsyncStorage).
 */
class SecureCredentialModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "factory_alert_secure_credential_v1"
        private const val PREFS = "factory_alert_secure_credential"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val MAX_KEY_LEN = 128
        private const val MAX_VALUE_LEN = 4096
    }

    override fun getName(): String = "SecureCredentialModule"

    private fun prefs() =
        reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun validKey(key: String?): Boolean =
        key != null && key.isNotEmpty() && key.length <= MAX_KEY_LEN

    @ReactMethod
    fun setItem(key: String?, value: String?, promise: Promise) {
        if (!validKey(key) || value == null || value.length > MAX_VALUE_LEN) {
            promise.reject("E_SECURE_ARG", "invalid key or value")
            return
        }
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(ct, Base64.NO_WRAP)
            // commit() (đồng bộ) — chỉ báo thành công khi đã ghi xuống đĩa.
            if (!prefs().edit().putString(key, packed).commit()) {
                promise.reject("E_SECURE_WRITE", "write failed")
                return
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_SECURE_CRYPTO", e.javaClass.simpleName)
        }
    }

    @ReactMethod
    fun getItem(key: String?, promise: Promise) {
        if (!validKey(key)) {
            promise.reject("E_SECURE_ARG", "invalid key")
            return
        }
        val packed = prefs().getString(key, null)
        if (packed == null) {
            promise.resolve(null)
            return
        }
        try {
            val parts = packed.split(":")
            if (parts.size != 2) {
                promise.resolve(null)
                return
            }
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            promise.resolve(String(cipher.doFinal(ct), Charsets.UTF_8))
        } catch (e: Exception) {
            // Khoá Keystore đã mất/đổi (khôi phục máy, xoá dữ liệu) ⇒ bản mã vô dụng: coi như CHƯA có.
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun removeItem(key: String?, promise: Promise) {
        if (!validKey(key)) {
            promise.reject("E_SECURE_ARG", "invalid key")
            return
        }
        if (!prefs().edit().remove(key).commit()) {
            promise.reject("E_SECURE_WRITE", "write failed")
            return
        }
        promise.resolve(true)
    }
}
