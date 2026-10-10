package com.foutec.FactoryAlertSystem

import android.content.Context
import android.os.Build
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
 * G fix 1/2/3 — logic nằm ở SecureCredentialCore (kiểm được trên JVM); module này chỉ nối Keystore + SharedPreferences
 * và bọc MỌI truy cập trong try:
 *   · ĐỌC KHÔNG BAO GIỜ XOÁ mục (trên Android "khoá vắng" không phải bằng chứng: keystore2/legacy nuốt lỗi bận/binder
 *     thành "vắng"); lỗi ⇒ E_SECURE_UNAVAILABLE (tạm thời) hoặc E_SECURE_REENTRY (hỏng chắc chắn / 5 lần liền) —
 *     Cài đặt hiện "nhập lại mật khẩu"; người dùng quyết, không xoá ngầm;
 *   · API 31+: tra khoá bằng getKey (null CHỈ khi KEY_NOT_FOUND, lỗi khác ném) thay vì getEntry (nuốt lỗi);
 *   · lưu không bao giờ phá mật khẩu cũ còn tốt (chỉ sinh lại khoá khi không còn gì để mất);
 *   · Xoá (removeItem) ⇒ xoá mục + bộ đếm; hết mục ⇒ xoá luôn khoá.
 * JS: src/services/secureCredentialStore.ts (thiếu module này ⇒ JS từ chối lưu, không rơi về AsyncStorage).
 */
class SecureCredentialModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "factory_alert_secure_credential_v1"
        private const val PREFS = "factory_alert_secure_credential"
        private const val PREFS_FAILURES = "factory_alert_secure_credential_failures"
        private const val MAX_KEY_LEN = 128
        private const val MAX_VALUE_LEN = 4096
    }

    override fun getName(): String = "SecureCredentialModule"

    private val keyStorage = object : SecureCredentialCore.KeyStorage {
        private fun ks() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

        override fun existing(): SecretKey? =
            if (Build.VERSION.SDK_INT >= 31) {
                // keystore2: getKey returns null ONLY for KEY_NOT_FOUND and throws on every other error.
                ks().getKey(KEY_ALIAS, null) as? SecretKey
            } else {
                // legacy: may report "absent" on a binder error — the core never deletes on absence alone.
                (ks().getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            }

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

        override fun count(): Int = prefs().all.size
    }

    private val failureCounter = object : SecureCredentialCore.FailureCounter {
        private fun prefs() = reactApplicationContext.getSharedPreferences(PREFS_FAILURES, Context.MODE_PRIVATE)

        override fun get(name: String): Int = prefs().getInt(name, 0)

        override fun set(name: String, n: Int) {
            prefs().edit().putInt(name, n).commit()
        }
    }

    private val core = SecureCredentialCore(
        keyStorage,
        entryStorage,
        failureCounter,
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
        } catch (e: SecureCredentialCore.NeedsReentry) {
            promise.reject("E_SECURE_REENTRY", "stored password unreadable — re-enter it in Settings")
        } catch (e: SecureCredentialCore.Unavailable) {
            // transient: the stored password is KEPT; JS treats this read as "no password this time" and retries next connect
            promise.reject("E_SECURE_UNAVAILABLE", "secure storage temporarily unavailable — retry")
        } catch (e: Exception) {
            // SharedPreferences itself unreadable ⇒ report it (JS maps any rejection to "no password").
            promise.reject("E_SECURE_READ", e.javaClass.simpleName)
        }
    }

    /** "none" | "ok" | "unavailable" | "reentry" — never the value; does not count as a read attempt. */
    @ReactMethod
    fun getStatus(key: String?, promise: Promise) {
        if (!validKey(key)) {
            promise.reject("E_SECURE_ARG", "invalid key")
            return
        }
        try {
            promise.resolve(
                when (core.status(key!!)) {
                    SecureCredentialCore.Status.NONE -> "none"
                    SecureCredentialCore.Status.OK -> "ok"
                    SecureCredentialCore.Status.UNAVAILABLE -> "unavailable"
                    SecureCredentialCore.Status.NEEDS_REENTRY -> "reentry"
                },
            )
        } catch (e: Exception) {
            promise.resolve("unavailable")
        }
    }

    /** final wave P-G2 — the value for Settings WITHOUT counting a failed read; null = none / not readable right now. */
    @ReactMethod
    fun peekItem(key: String?, promise: Promise) {
        if (!validKey(key)) {
            promise.reject("E_SECURE_ARG", "invalid key")
            return
        }
        try {
            promise.resolve(core.peek(key!!))
        } catch (e: Exception) {
            promise.resolve(null)
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
