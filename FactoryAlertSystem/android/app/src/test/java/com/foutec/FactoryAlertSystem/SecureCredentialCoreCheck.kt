package com.foutec.FactoryAlertSystem

import java.security.InvalidKeyException
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * doc 81 Đợt 5 G fix 1/2 — plain-JVM check of SecureCredentialCore (no JUnit in this Gradle project, no Android
 * Keystore on a JVM): a software AES key stands in for the Keystore key, a HashMap for SharedPreferences.
 *   · a "bogus" key (3-byte SecretKeySpec) makes Cipher.init throw InvalidKeyException — a TRANSIENT error unless the
 *     test marks it permanent (stand-in for KeyPermanentlyInvalidatedException, which only exists on Android);
 *   · `throwOnExisting` simulates a key store that cannot be read right now (keystore2 busy / restarting).
 * Exact command used (Windows, Git Bash; jars from the Gradle cache — see group-G-report.md "Fix round 2"):
 *   java -cp "<kotlin-compiler-embeddable-1.9.22.jar;kotlin-stdlib-1.9.0.jar;kotlin-script-runtime;kotlin-reflect;
 *     kotlin-daemon-embeddable-1.9.22;trove4j;annotations-13.0;kotlinx-coroutines-core-jvm>" \
 *     org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
 *     -classpath kotlin-stdlib-1.9.0.jar -d out SecureCredentialCore.kt SecureCredentialCoreCheck.kt
 *   java -cp "out;kotlin-stdlib-1.9.0.jar" com.foutec.FactoryAlertSystem.SecureCredentialCoreCheckKt
 *   ⇒ prints "ALL n CHECKS PASSED", exit 0 (any failure: "FAILED: …", exit 1)
 */
private class FakeKeys : SecureCredentialCore.KeyStorage {
    var key: SecretKey? = null
    var throwOnExisting = false
    var bogusNextCreates = 0
    var permanent = false
    var creates = 0
    var deletes = 0
    override fun existing(): SecretKey? {
        if (throwOnExisting) throw java.security.KeyStoreException("simulated: keystore busy")
        return key
    }
    override fun create(): SecretKey {
        creates++
        key = if (bogusNextCreates > 0) {
            bogusNextCreates--
            bogus()
        } else {
            real()
        }
        return key!!
    }
    override fun delete() {
        if (key != null) deletes++ // counts real deletions only (Android: containsAlias guard)
        key = null
    }
}

private fun real(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
private fun bogus(): SecretKey = SecretKeySpec(byteArrayOf(1, 2, 3), "AES") // InvalidKeyException at Cipher.init

private class FakeStore : SecureCredentialCore.EntryStorage {
    val map = HashMap<String, String>()
    var failWrites = false
    override fun get(name: String) = map[name]
    override fun put(name: String, value: String): Boolean {
        if (failWrites) return false
        map[name] = value
        return true
    }
    override fun remove(name: String): Boolean {
        if (failWrites) return false
        map.remove(name)
        return true
    }
    override fun isEmpty() = map.isEmpty()
}

private var checks = 0
private fun check(cond: Boolean, what: String) {
    checks++
    if (!cond) {
        System.err.println("FAILED: $what")
        kotlin.system.exitProcess(1)
    }
}

private fun fresh(): Triple<FakeKeys, FakeStore, SecureCredentialCore> {
    val k = FakeKeys()
    val s = FakeStore()
    val enc = Base64.getEncoder()
    val dec = Base64.getDecoder()
    val core = SecureCredentialCore(k, s, { enc.encodeToString(it) }, { dec.decode(it) }, { e -> k.permanent && e is InvalidKeyException })
    return Triple(k, s, core)
}

private inline fun unavailable(block: () -> Unit): Boolean =
    try { block(); false } catch (e: SecureCredentialCore.Unavailable) { true }

private inline fun throws(block: () -> Unit): Boolean = try { block(); false } catch (e: Exception) { true }

fun main() {
    val secret = "Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m"
    val pinned = """{"v":1,"password":"$secret","endpoint":{"host":"192.168.10.20","port":8883,"protocol":"ws","tls":false}}"""

    run { // round trip, ciphertext only at rest, fresh IV per write
        val (_, s, core) = fresh()
        core.set("p", pinned)
        val first = s.map["p"]!!
        check(!first.contains(secret), "plaintext at rest")
        check(core.get("p") == pinned, "round trip")
        core.set("p", pinned)
        check(s.map["p"] != first, "same value re-encrypted with a new IV")
        check(core.get("missing") == null, "absent entry ⇒ null")
    }

    // ── DEFINITIVE ⇒ delete ────────────────────────────────────────────────────────────────────────────────────
    run { // alias absent (no throw) ⇒ entry dropped; next set works with a new key
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = null
        check(core.get("p") == null && !s.map.containsKey("p"), "alias absent ⇒ null + deleted")
        core.set("p", pinned)
        check(core.get("p") == pinned, "set after loss works")
    }
    run { // different key ⇒ AEADBadTagException ⇒ dropped
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = real()
        check(core.get("p") == null && !s.map.containsKey("p"), "wrong key (AEADBadTag) ⇒ null + deleted")
    }
    run { // malformed entries ⇒ dropped
        val (_, s, core) = fresh()
        core.set("x", "keep-key-alive")
        s.map["p"] = "garbage-without-colon"
        check(core.get("p") == null && !s.map.containsKey("p"), "no separator ⇒ deleted")
        s.map["p"] = "@@@:###"
        check(core.get("p") == null && !s.map.containsKey("p"), "not Base64 ⇒ deleted")
    }
    run { // permanently invalidated key on read ⇒ dropped
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = bogus(); k.permanent = true
        check(core.get("p") == null && !s.map.containsKey("p"), "permanently invalidated ⇒ null + deleted")
    }

    // ── N2: TRANSIENT ⇒ keep the good password ─────────────────────────────────────────────────────────────────
    run { // key store unreadable right now ⇒ Unavailable, entry KEPT, readable once the store recovers
        val (k, s, core) = fresh()
        core.set("p", pinned)
        val stored = s.map["p"]
        k.throwOnExisting = true
        check(unavailable { core.get("p") }, "unreadable key store on get ⇒ Unavailable")
        check(s.map["p"] == stored, "unreadable key store on get ⇒ entry KEPT")
        k.throwOnExisting = false
        check(core.get("p") == pinned, "store recovered ⇒ the same password is back")
    }
    run { // non-AEAD, non-permanent cipher error on read ⇒ Unavailable, entry KEPT
        val (k, s, core) = fresh()
        core.set("p", pinned)
        val good = k.key
        k.key = bogus()
        check(unavailable { core.get("p") }, "transient cipher error ⇒ Unavailable")
        check(s.map.containsKey("p"), "transient cipher error ⇒ entry KEPT")
        k.key = good
        check(core.get("p") == pinned, "after the transient error ⇒ readable")
    }

    // ── N3: a failing save never destroys the old good password ───────────────────────────────────────────────
    run { // transient encrypt failure while a password is stored ⇒ Unavailable, key not deleted, old value intact
        val (k, s, core) = fresh()
        core.set("p", pinned)
        val good = k.key
        k.key = bogus()
        check(unavailable { core.set("p", "new-value") }, "transient error on set ⇒ Unavailable")
        check(k.deletes == 0, "transient error on set ⇒ alias NOT deleted (deletes=${k.deletes})")
        k.key = good
        check(core.get("p") == pinned, "old password still decrypts after a failed save")
    }
    run { // key store unreadable on set ⇒ Unavailable, nothing touched
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.throwOnExisting = true
        check(unavailable { core.set("p", "new-value") }, "unreadable key store on set ⇒ Unavailable")
        k.throwOnExisting = false
        check(k.deletes == 0 && core.get("p") == pinned, "old password intact")
    }
    run { // nothing stored + unusable key ⇒ safe to re-key once ⇒ saved
        val (k, s, core) = fresh()
        k.key = bogus()
        core.set("p", pinned)
        check(k.deletes == 1 && core.get("p") == pinned, "empty store ⇒ re-keyed and saved")
    }
    run { // permanently invalidated key on set ⇒ old entries are dead anyway ⇒ re-key and save the new value
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = bogus(); k.permanent = true
        core.set("p", "new-value")
        k.permanent = false
        check(core.get("p") == "new-value", "permanent invalidation on set ⇒ re-keyed, new value readable")
    }
    run { // re-key path fails as well ⇒ Unavailable, nothing stored
        val (k, s, core) = fresh()
        k.key = bogus(); k.bogusNextCreates = 1
        check(unavailable { core.set("p", pinned) }, "re-key fails too ⇒ Unavailable")
        check(!s.map.containsKey("p"), "nothing stored on failure")
    }
    run { // write not persisted ⇒ WriteFailed, previous value unchanged
        val (_, s, core) = fresh()
        core.set("p", pinned)
        s.failWrites = true
        check(throws { core.set("p", "new-value") }, "put=false ⇒ throws")
        s.failWrites = false
        check(core.get("p") == pinned, "previous value unchanged after a failed write")
    }

    run { // Clear: entry gone; last entry ⇒ key deleted too; another entry left ⇒ key kept
        val (k, s, core) = fresh()
        core.set("p", pinned)
        core.set("q", "other")
        core.remove("p")
        check(!s.map.containsKey("p") && k.key != null && k.deletes == 0, "other entry left ⇒ key kept")
        core.remove("q")
        check(s.map.isEmpty() && k.key == null && k.deletes == 1, "last entry removed ⇒ key deleted")
        check(core.get("p") == null, "after Clear ⇒ null")
    }
    println("ALL $checks CHECKS PASSED")
}
