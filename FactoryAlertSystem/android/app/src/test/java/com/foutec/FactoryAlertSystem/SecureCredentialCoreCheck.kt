package com.foutec.FactoryAlertSystem

import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * doc 81 Đợt 5 G fix 1 (review finding 3) — plain-JVM check of SecureCredentialCore's recovery rules (no JUnit in this
 * Gradle project, no Android Keystore on a JVM): a software AES key stands in for the Keystore key, a HashMap for
 * SharedPreferences. Run (kotlinc 1.9 / kotlin-compiler-embeddable + JDK 17):
 *   kotlinc SecureCredentialCore.kt SecureCredentialCoreCheck.kt -d out && java -cp out:kotlin-stdlib.jar \
 *     com.foutec.FactoryAlertSystem.SecureCredentialCoreCheckKt     ⇒ prints "ALL n CHECKS PASSED", exit 0
 */
private class FakeKeys : SecureCredentialCore.KeyStorage {
    var key: SecretKey? = null
    var throwOnExisting = false
    var bogusNextCreates = 0
    var creates = 0
    var deletes = 0
    override fun existing(): SecretKey? {
        if (throwOnExisting) throw java.security.UnrecoverableKeyException("simulated")
        return key
    }
    override fun create(): SecretKey {
        creates++
        throwOnExisting = false
        key = if (bogusNextCreates > 0) {
            bogusNextCreates--
            SecretKeySpec(byteArrayOf(1, 2, 3), "AES") // unusable for AES ⇒ InvalidKeyException at init
        } else {
            KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        }
        return key!!
    }
    override fun delete() {
        deletes++
        key = null
    }
}

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
    return Triple(k, s, SecureCredentialCore(k, s, { enc.encodeToString(it) }, { dec.decode(it) }))
}

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
    run { // key lost (restore / data wipe) ⇒ entry dropped, null; next set works with a new key
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = null
        check(core.get("p") == null, "lost key ⇒ null")
        check(!s.map.containsKey("p"), "lost key ⇒ undecryptable entry deleted")
        core.set("p", pinned)
        check(core.get("p") == pinned, "set after loss works")
    }
    run { // different key (alias recreated elsewhere) ⇒ GCM tag fails ⇒ entry dropped
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        check(core.get("p") == null, "wrong key ⇒ null")
        check(!s.map.containsKey("p"), "wrong key ⇒ entry deleted")
    }
    run { // corrupt / pre-pin garbage entry ⇒ dropped
        val (_, s, core) = fresh()
        core.set("x", "keep-key-alive")
        s.map["p"] = "garbage-without-colon"
        check(core.get("p") == null, "malformed ⇒ null")
        check(!s.map.containsKey("p"), "malformed ⇒ deleted")
        s.map["p"] = "AAAA:BBBB"
        check(core.get("p") == null && !s.map.containsKey("p"), "bad ciphertext ⇒ null + deleted")
    }
    run { // unusable key on set ⇒ alias deleted, new key, ONE retry succeeds
        val (k, _, core) = fresh()
        k.bogusNextCreates = 1
        core.set("p", pinned)
        check(k.deletes == 1 && k.creates == 2, "recreated once (deletes=${k.deletes}, creates=${k.creates})")
        check(core.get("p") == pinned, "usable after recreation")
    }
    run { // key store throws on read ⇒ set recovers; get drops the entry
        val (k, s, core) = fresh()
        core.set("p", pinned)
        k.throwOnExisting = true
        check(core.get("p") == null && !s.map.containsKey("p"), "unreadable key store on get ⇒ null + deleted")
        k.throwOnExisting = true
        core.set("p", pinned)
        check(core.get("p") == pinned, "unreadable key store on set ⇒ recovered")
    }
    run { // second failure is reported, never "saved"
        val (k, s, core) = fresh()
        k.bogusNextCreates = 2
        check(throws { core.set("p", pinned) }, "two unusable keys ⇒ throws")
        check(!s.map.containsKey("p"), "nothing stored on failure")
    }
    run { // write not persisted ⇒ WriteFailed
        val (_, s, core) = fresh()
        s.failWrites = true
        check(throws { core.set("p", pinned) }, "put=false ⇒ throws")
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
