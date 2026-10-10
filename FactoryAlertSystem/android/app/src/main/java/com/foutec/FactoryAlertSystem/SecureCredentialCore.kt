package com.foutec.FactoryAlertSystem

import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Logic of SecureCredentialModule WITHOUT Android types, so it can be checked on a plain JVM
 * (android/app/src/test/.../SecureCredentialCoreCheck.kt). doc 81 Đợt 5 G1 + G fix 1 (finding 3) + G fix 2 (N2/N3).
 *
 * A stored password is DELETED only on DEFINITIVE evidence that it can never be decrypted again (G fix 2, N2):
 *   · the key alias is absent (`existing()` returned null WITHOUT throwing);
 *   · the entry is malformed (not `iv:ct`, or not Base64);
 *   · decryption fails authentication (`AEADBadTagException` — wrong key / tampered entry);
 *   · the key is permanently invalidated (`isPermanentlyInvalid`, i.e. KeyPermanentlyInvalidatedException on Android).
 * Any OTHER error (key store busy or restarting after boot, binder error, ProviderException, "too many operations"…)
 * is TRANSIENT: the entry is kept and `Unavailable` is thrown — the caller reports "not readable now" and the next
 * connect simply reads again. After the passwordless flag flip, deleting a good password would lock the tablet out
 * until an admin rotates it on site.
 *
 * Saving never destroys a good stored password (G fix 2, N3):
 *   · normal case: encrypt with the existing key, then replace the entry only after the encryption succeeded
 *     (SharedPreferences commit replaces atomically; a failed commit leaves the old value);
 *   · the alias is re-created only when that cannot lose anything: the key is permanently invalidated (old entries are
 *     already dead), the alias is absent, or NO entry is stored at all;
 *   · any other failure while an entry is stored ⇒ `Unavailable`, key and old entry untouched.
 * remove: delete the entry; when no entry is left, delete the key as well (Clear leaves nothing behind).
 */
class SecureCredentialCore(
    private val keys: KeyStorage,
    private val store: EntryStorage,
    private val encode: (ByteArray) -> String,
    private val decode: (String) -> ByteArray,
    private val isPermanentlyInvalid: (Throwable) -> Boolean,
) {
    interface KeyStorage {
        /** The existing key, null when the alias is absent. Throws when the key store cannot be read right now. */
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

    /** Transient failure — nothing was deleted; try again later. */
    class Unavailable(cause: Throwable) : Exception("secure storage temporarily unavailable", cause)

    private fun encrypt(key: SecretKey, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return encode(cipher.iv) + ":" + encode(ct)
    }

    private fun freshKey(): SecretKey {
        try {
            keys.delete()
        } catch (e: Exception) {
            // creating over the alias replaces it anyway
        }
        return keys.create()
    }

    fun set(name: String, value: String) {
        val packed: String =
            try {
                val existing = keys.existing()
                if (existing == null) {
                    encrypt(freshKey(), value) // alias absent: no stored entry can be decrypted anyway
                } else {
                    encrypt(existing, value)
                }
            } catch (e: Exception) {
                if (isPermanentlyInvalid(e) || store.isEmpty()) {
                    // nothing good can be lost: old entries are dead (invalidated key) or there are none
                    try {
                        encrypt(freshKey(), value)
                    } catch (e2: Exception) {
                        throw Unavailable(e2)
                    }
                } else {
                    throw Unavailable(e) // keep the key and the stored password
                }
            }
        if (!store.put(name, packed)) throw WriteFailed()
    }

    /** null = nothing stored (or it was provably undecryptable and has been deleted). Throws [Unavailable]. */
    fun get(name: String): String? {
        val packed = store.get(name) ?: return null
        val parts = packed.split(":")
        val iv: ByteArray
        val ct: ByteArray
        try {
            require(parts.size == 2)
            iv = decode(parts[0])
            ct = decode(parts[1])
        } catch (e: IllegalArgumentException) {
            store.remove(name) // malformed: can never be decrypted
            return null
        }
        val key =
            try {
                keys.existing()
            } catch (e: Exception) {
                throw Unavailable(e) // key store not readable now ⇒ keep the entry
            }
        if (key == null) {
            store.remove(name) // alias absent: the entry's key is gone for good
            return null
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            if (e is AEADBadTagException || isPermanentlyInvalid(e)) {
                store.remove(name)
                null
            } else {
                throw Unavailable(e)
            }
        }
    }

    fun remove(name: String) {
        if (!store.remove(name)) throw WriteFailed()
        if (store.isEmpty()) {
            try {
                keys.delete()
            } catch (e: Exception) {
                // the entry is gone already; a stale key holds no secret
            }
        }
    }
}
