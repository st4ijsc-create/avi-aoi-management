package com.foutec.FactoryAlertSystem

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * SecureCredentialModule — lưu bí mật nhỏ (mật khẩu MQTT của thiết bị) trong vùng an toàn của Android.
 *
 * doc 81 Đợt 5 task G1 (mục 4+9): admin xoay mật khẩu (`mqttClient.rotatePassword`) ⇒ mật khẩu hiện MỘT lần ⇒
 * kỹ thuật viên gõ vào Cài đặt của máy tính bảng. Mật khẩu KHÔNG được ghi AsyncStorage (văn bản thô):
 *   · khoá AES-256/GCM sinh và giữ TRONG Android Keystore (không xuất ra được, không đi theo bản sao lưu);
 *   · chỉ bản MÃ HOÁ (iv + ciphertext, Base64) nằm trong SharedPreferences riêng của app.
 * G fix 1/2 — logic nằm ở SecureCredentialCore (kiểm được trên JVM); module này chỉ nối Keystore + SharedPreferences
 * và bọc MỌI truy cập trong try:
 *   · CHỈ xoá mục khi CHẮC CHẮN không bao giờ giải được nữa (alias vắng, mục hỏng dạng, AEADBadTagException,
 *     KeyPermanentlyInvalidatedException); lỗi khác (Keystore bận/khởi động lại…) ⇒ GIỮ mục, báo
 *     E_SECURE_UNAVAILABLE, lần connect sau đọc lại;
 *   · lưu không bao giờ phá mật khẩu cũ còn tốt (chỉ sinh lại khoá khi không còn gì để mất);
 *   · Xoá (removeItem) ⇒ xoá mục; hết mục ⇒ xoá luôn khoá.
 * JS: src/services/secureCredentialStore.ts (thiếu module này ⇒ JS từ chối lưu, không rơi về AsyncStorage).
 */
class SecureCredentialModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "factory_alert_secure_credential_v1"
        private const val PREFS = "factory_alert_secure_credential"
        private const val MAX_KEY_LEN = 128
        private const val MAX_VALUE_LEN = 4096
    }

    override fun getName(): String = "SecureCredentialModule"

    private val keyStorage = object : SecureCredentialCore.KeyStorage {
        private fun ks() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

        override fun existing(): SecretKey? =
            (ks().getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey

        override fun create(): SecretKey {
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

        override fun delete() {
            val ks = ks()
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS)
        }
    }

    private val entryStorage = object : SecureCredentialCore.EntryStorage {
        private fun prefs() = reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        override fun get(name: String): String? = prefs().getString(name, null)

        // commit() (đồng bộ) — chỉ báo thành công khi đã ghi xuống đĩa.
        override fun put(name: String, value: String): Boolean = prefs().edit().putString(name, value).commit()

        override fun remove(name: String): Boolean = prefs().edit().remove(name).commit()

        override fun isEmpty(): Boolean = prefs().all.isEmpty()
    }

    private val core = SecureCredentialCore(
        keyStorage,
        entryStorage,
        { b -> Base64.encodeToString(b, Base64.NO_WRAP) },
        { s -> Base64.decode(s, Base64.NO_WRAP) },
        { e -> e is KeyPermanentlyInvalidatedException || e.cause is KeyPermanentlyInvalidatedException },
    )

    private fun validKey(key: String?): Boolean =
        key != null && key.isNotEmpty() && key.length <= MAX_KEY_LEN

    @ReactMethod
    fun setItem(key: String?, value: String?, promise: Promise) {
        if (!validKey(key) || value == null || value.length > MAX_VALUE_LEN) {
            promise.reject("E_SECURE_ARG", "invalid key or value")
            return
        }
        try {
            core.set(key!!, value)
            promise.resolve(true)
        } catch (e: SecureCredentialCore.WriteFailed) {
            promise.reject("E_SECURE_WRITE", "write failed")
        } catch (e: SecureCredentialCore.Unavailable) {
            promise.reject("E_SECURE_UNAVAILABLE", "secure storage temporarily unavailable — retry")
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
        try {
            promise.resolve(core.get(key!!))
        } catch (e: SecureCredentialCore.Unavailable) {
            // transient: the stored password is KEPT; JS treats this read as "no password this time" and retries next connect
            promise.reject("E_SECURE_UNAVAILABLE", "secure storage temporarily unavailable — retry")
        } catch (e: Exception) {
            // SharedPreferences itself unreadable ⇒ report it (JS maps any rejection to "no password").
            promise.reject("E_SECURE_READ", e.javaClass.simpleName)
        }
    }

    @ReactMethod
    fun removeItem(key: String?, promise: Promise) {
        if (!validKey(key)) {
            promise.reject("E_SECURE_ARG", "invalid key")
            return
        }
        try {
            core.remove(key!!)
            promise.resolve(true)
        } catch (e: SecureCredentialCore.WriteFailed) {
            promise.reject("E_SECURE_WRITE", "write failed")
        } catch (e: Exception) {
            promise.reject("E_SECURE_WRITE", e.javaClass.simpleName)
        }
    }
}
