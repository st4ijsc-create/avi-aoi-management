package com.foutec.FactoryAlertSystem

import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Logic of SecureCredentialModule WITHOUT Android types, so it can be checked on a plain JVM
 * (android/app/src/test/.../SecureCredentialCoreCheck.kt). doc 81 Đợt 5 G1 + G fix 1/2/3.
 *
 * G fix 3 (re-review 2, R2-2/R2-3) — a stored password is NEVER deleted by a read. On Android "the key is absent" is
 * not proof (keystore2 `getKeyMetadata` and the legacy `contains` swallow busy/binder errors and answer "absent"), and
 * the definitive signals are not reliable either (keystore2 turns KeyPermanentlyInvalidatedException into a cause-less
 * UnrecoverableKeyException). So:
 *   · get: success ⇒ the password, failure counter reset. Any failure ⇒ the entry is KEPT and counted:
 *       – DEFINITIVE (entry malformed, AEADBadTagException, `isPermanentlyInvalid`) ⇒ marked "needs re-entry" at once;
 *       – anything else (key looks absent, key store throws, other cipher error) ⇒ +1; after [REENTRY_AFTER]
 *         consecutive failures ⇒ "needs re-entry".
 *     Thrown: [NeedsReentry] or [Unavailable]. The module maps both to "no password this time"; Settings shows
 *     "re-enter the password" for the first (R2-3) — the user decides, nothing is deleted silently.
 *   · set never destroys a good stored password (N3): it encrypts with the existing key and replaces the entry only
 *     after that succeeded. The key alias is re-created ONLY when nothing good can be lost — the store holds no entry,
 *     or the stored entry is already marked "needs re-entry" (the user is re-entering it), or the key is permanently
 *     invalidated. A key that merely LOOKS absent while an entry exists ⇒ [Unavailable], nothing touched.
 *   · status: the same read WITHOUT counting (for the Settings screen).
 *   · remove (Clear, an explicit user action): delete the entry and its counter; no entry left ⇒ delete the key too.
 */
class SecureCredentialCore(
    private val keys: KeyStorage,
    private val store: EntryStorage,
    private val failures: FailureCounter,
    private val encode: (ByteArray) -> String,
    private val decode: (String) -> ByteArray,
    private val isPermanentlyInvalid: (Throwable) -> Boolean,
) {
    interface KeyStorage {
        /** The key, or null when the platform says it is absent (NOT proof on Android). Throws when unreadable. */
        fun existing(): SecretKey?
        fun create(): SecretKey
        fun delete()
    }

    interface EntryStorage {
        fun get(name: String): String?
        /** false ⇔ the write was not persisted. */
        fun put(name: String, value: String): Boolean
        fun remove(name: String): Boolean
        /** Number of stored entries. */
        fun count(): Int
    }

    /** Consecutive failed reads per entry (non-secret metadata, kept apart from the entries). */
    interface FailureCounter {
        fun get(name: String): Int
        fun set(name: String, n: Int)
    }

    enum class Status { NONE, OK, UNAVAILABLE, NEEDS_REENTRY }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        /** Consecutive failed reads after which Settings asks to re-enter the password. */
        const val REENTRY_AFTER = 5
    }

    class WriteFailed : Exception("write failed")

    /** Transient failure — nothing was deleted; try again later. */
    class Unavailable(cause: Throwable?) : Exception("secure storage temporarily unavailable", cause)

    /** The stored password cannot be read (definitively, or [REENTRY_AFTER] times in a row) — ask the user. Kept. */
    class NeedsReentry(cause: Throwable?) : Exception("stored password unreadable — re-enter it", cause)

    private class Definitive(cause: Throwable?) : Exception(cause)

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

    private fun needsReentry(name: String): Boolean = failures.get(name) >= REENTRY_AFTER

    /** Decrypt without side effects. Throws [Definitive] or a transient exception. */
    private fun decryptOnce(packed: String): String {
        val parts = packed.split(":")
        val iv: ByteArray
        val ct: ByteArray
        try {
            require(parts.size == 2)
            iv = decode(parts[0])
            ct = decode(parts[1])
        } catch (e: IllegalArgumentException) {
            throw Definitive(e) // malformed
        }
        val key = keys.existing() ?: throw IllegalStateException("key looks absent") // transient on Android
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            return String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            if (e is AEADBadTagException || isPermanentlyInvalid(e)) throw Definitive(e)
            throw e
        }
    }

    /** null = nothing stored. Never deletes. Throws [Unavailable] or [NeedsReentry]. */
    fun get(name: String): String? {
        val packed = store.get(name) ?: return null
        return try {
            val v = decryptOnce(packed)
            if (failures.get(name) != 0) failures.set(name, 0)
            v
        } catch (e: Definitive) {
            failures.set(name, REENTRY_AFTER)
            throw NeedsReentry(e.cause)
        } catch (e: Exception) {
            val n = failures.get(name) + 1
            failures.set(name, n)
            if (n >= REENTRY_AFTER) throw NeedsReentry(e)
            throw Unavailable(e)
        }
    }

    /** For the Settings screen: like [get] but never counts and never returns the password. */
    fun status(name: String): Status {
        val packed = store.get(name) ?: return Status.NONE
        if (needsReentry(name)) return Status.NEEDS_REENTRY
        return try {
            decryptOnce(packed)
            Status.OK
        } catch (e: Definitive) {
            Status.NEEDS_REENTRY
        } catch (e: Exception) {
            Status.UNAVAILABLE
        }
    }

    fun set(name: String, value: String) {
        // Re-keying can only lose something when a stored entry might still be good.
        // (only when this entry is the ONLY one and already marked "needs re-entry" — or when nothing is stored)
        val n = store.count()
        val nothingToLose = n == 0 || (n == 1 && store.get(name) != null && needsReentry(name))
        val packed: String =
            try {
                val existing = keys.existing()
                when {
                    existing != null -> encrypt(existing, value)
                    nothingToLose -> encrypt(freshKey(), value)
                    else -> throw Unavailable(null) // key LOOKS absent while an entry exists: touch nothing
                }
            } catch (e: Unavailable) {
                throw e
            } catch (e: Exception) {
                if (nothingToLose || isPermanentlyInvalid(e)) {
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
        failures.set(name, 0)
    }

    fun remove(name: String) {
        if (!store.remove(name)) throw WriteFailed()
        failures.set(name, 0)
        if (store.count() == 0) {
            try {
                keys.delete()
            } catch (e: Exception) {
                // the entry is gone already; a stale key holds no secret
            }
        }
    }

}
