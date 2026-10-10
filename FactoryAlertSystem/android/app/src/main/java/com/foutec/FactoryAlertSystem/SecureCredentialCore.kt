package com.foutec.FactoryAlertSystem

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Logic of SecureCredentialModule WITHOUT Android types, so it can be checked on a plain JVM
 * (android/app/src/test/.../SecureCredentialCoreCheck.kt). doc 81 Đợt 5 G1 + G fix 1 (review finding 3).
 *
 * Recovery rules:
 *   · set:    the key is missing/unreadable, or encryption with it fails (invalidated / unusable alias) ⇒ delete the
 *             alias, create a new key and retry ONCE. A second failure is reported (never "saved").
 *   · get:    no entry ⇒ null. Entry present but the key is gone/unreadable, the entry is malformed, or decryption
 *             fails (key lost after a restore / data wipe) ⇒ the undecryptable entry is DELETED and null returned
 *             (fail-closed: "no password"; the next set starts clean).
 *   · remove: delete the entry; when no entry is left, delete the key as well (Clear leaves nothing behind).
 * Every storage access may throw; the module wraps each call and maps errors to promise rejections.
 */
class SecureCredentialCore(
    private val keys: KeyStorage,
    private val store: EntryStorage,
    private val encode: (ByteArray) -> String,
    private val decode: (String) -> ByteArray,
) {
    interface KeyStorage {
        /** The existing key, null when there is none. May throw when the key store is unusable. */
        fun existing(): SecretKey?
        fun create(): SecretKey
        fun delete()
    }

    interface EntryStorage {
        fun get(name: String): String?
        /** false ⇔ the write was not persisted. */
        fun put(name: String, value: String): Boolean
        fun remove(name: String): Boolean
        fun isEmpty(): Boolean
    }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
    }

    class WriteFailed : Exception("write failed")

    private fun keyOrNull(): SecretKey? =
        try {
            keys.existing()
        } catch (e: Exception) {
            null
        }

    private fun encrypt(key: SecretKey, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return encode(cipher.iv) + ":" + encode(ct)
    }

    fun set(name: String, value: String) {
        val packed =
            try {
                encrypt(keyOrNull() ?: keys.create(), value)
            } catch (e: Exception) {
                // invalidated / unusable alias (KeyPermanentlyInvalidatedException, UnrecoverableKeyException,
                // ProviderException from the Keystore…) ⇒ start over with a fresh key, once
                keys.delete()
                encrypt(keys.create(), value)
            }
        if (!store.put(name, packed)) throw WriteFailed()
    }

    fun get(name: String): String? {
        val packed = store.get(name) ?: return null
        val key = keyOrNull()
        if (key == null) {
            store.remove(name)
            return null
        }
        return try {
            val parts = packed.split(":")
            require(parts.size == 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, decode(parts[0])))
            String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8)
        } catch (e: Exception) {
            store.remove(name)
            null
        }
    }

    fun remove(name: String) {
        if (!store.remove(name)) throw WriteFailed()
        if (store.isEmpty()) {
            try {
                keys.delete()
            } catch (e: Exception) {
                // the entry is gone already; a key that cannot be deleted is replaced on the next set if unusable
            }
        }
    }
}
