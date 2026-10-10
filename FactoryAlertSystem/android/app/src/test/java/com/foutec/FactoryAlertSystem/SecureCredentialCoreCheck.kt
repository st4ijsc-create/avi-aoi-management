package com.foutec.FactoryAlertSystem

import java.security.InvalidKeyException
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * doc 81 Đợt 5 G fix 1/2/3 — plain-JVM check of SecureCredentialCore (no JUnit in this Gradle project, no Android
 * Keystore on a JVM): a software AES key stands in for the Keystore key, HashMaps for the two SharedPreferences files.
 *   · `looksAbsent` = the platform answers "absent" although the key is there (keystore2 getKeyMetadata / legacy
 *     contains swallowing a busy or binder error — re-review 2, R2-2);
 *   · `throwOnExisting` = the key store throws right now;
 *   · a "bogus" key (3-byte SecretKeySpec) makes Cipher.init throw InvalidKeyException — transient unless `permanent`
 *     (stand-in for KeyPermanentlyInvalidatedException, which only exists on Android).
 * The exact command (absolute paths) is in .superpowers/sdd/2026-10-10-engineering-control-dot5/group-G-report.md,
 * "Fix round 3". Prints "ALL n CHECKS PASSED" and exits 0; any failure prints "FAILED: …" and exits 1.
 */
private class FakeKeys : SecureCredentialCore.KeyStorage {
    var key: SecretKey? = null
    var looksAbsent = false
    var throwOnExisting = false
    var bogusNextCreates = 0
    var permanent = false
    var creates = 0
    var deletes = 0
    override fun existing(): SecretKey? {
        if (throwOnExisting) throw java.security.KeyStoreException("simulated: keystore busy")
        if (looksAbsent) return null
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
        if (key != null && !looksAbsent) deletes++ // Android: containsAlias guard (false when it "looks absent")
        if (!looksAbsent) key = null
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
    override fun count() = map.size
}

private class FakeCounter : SecureCredentialCore.FailureCounter {
    val map = HashMap<String, Int>()
    override fun get(name: String) = map[name] ?: 0
    override fun set(name: String, n: Int) { map[name] = n }
}

private var checks = 0
private fun check(cond: Boolean, what: String) {
    checks++
    if (!cond) {
        System.err.println("FAILED: $what")
        kotlin.system.exitProcess(1)
    }
}

private data class Rig(val k: FakeKeys, val s: FakeStore, val c: FakeCounter, val core: SecureCredentialCore)

private fun fresh(): Rig {
    val k = FakeKeys()
    val s = FakeStore()
    val c = FakeCounter()
    val enc = Base64.getEncoder()
    val dec = Base64.getDecoder()
    return Rig(k, s, c, SecureCredentialCore(k, s, c, { enc.encodeToString(it) }, { dec.decode(it) }, { e -> k.permanent && e is InvalidKeyException }))
}

private inline fun outcome(block: () -> Unit): String =
    try { block(); "ok" } catch (e: SecureCredentialCore.Unavailable) { "unavailable" } catch (e: SecureCredentialCore.NeedsReentry) { "reentry" } catch (e: Exception) { "error:" + e.javaClass.simpleName }

fun main() {
    val secret = "Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m"
    val pinned = """{"v":1,"password":"$secret","endpoint":{"host":"192.168.10.20","port":8883,"protocol":"ws","tls":false}}"""
    val N = SecureCredentialCore.REENTRY_AFTER

    run { // round trip, ciphertext only at rest, fresh IV per write
        val (_, s, _, core) = fresh()
        core.set("p", pinned)
        val first = s.map["p"]!!
        check(!first.contains(secret), "plaintext at rest")
        check(core.get("p") == pinned, "round trip")
        core.set("p", pinned)
        check(s.map["p"] != first, "same value re-encrypted with a new IV")
        check(core.get("missing") == null, "absent entry ⇒ null")
        check(core.status("p") == SecureCredentialCore.Status.OK && core.status("missing") == SecureCredentialCore.Status.NONE, "status OK / NONE")
    }

    // ── R2-2: the key LOOKS absent (platform swallowed a busy/binder error) ⇒ never delete, never re-key ─────────
    run {
        val (k, s, c, core) = fresh()
        core.set("p", pinned)
        val stored = s.map["p"]
        k.looksAbsent = true
        check(outcome { core.get("p") } == "unavailable", "looks absent on get ⇒ unavailable")
        check(s.map["p"] == stored, "looks absent on get ⇒ entry KEPT")
        val createsBefore = k.creates
        check(outcome { core.set("p", "new-value") } == "unavailable", "looks absent on set (entry stored) ⇒ unavailable")
        check(k.creates == createsBefore && s.map["p"] == stored, "looks absent on set ⇒ no re-key, entry untouched")
        k.looksAbsent = false
        check(core.get("p") == pinned && c.get("p") == 0, "keystore back ⇒ same password, counter reset")
    }
    run { // status never counts (Settings may poll it)
        val (k, _, c, core) = fresh()
        core.set("p", pinned)
        k.looksAbsent = true
        repeat(3 * N) { core.status("p") }
        check(c.get("p") == 0, "status does not count failures")
        check(core.status("p") == SecureCredentialCore.Status.UNAVAILABLE, "status UNAVAILABLE while the key looks absent")
    }

    // ── R2-3: persistent failure ⇒ "re-enter" after N in a row; definitive ⇒ at once; never deleted ─────────────
    run { // key really gone: N-1 reads unavailable, the N-th asks for re-entry; entry kept; re-entry then works
        val (k, s, _, core) = fresh()
        core.set("p", pinned)
        k.looksAbsent = true
        repeat(N - 1) { i -> check(outcome { core.get("p") } == "unavailable", "failure ${i + 1} < N ⇒ unavailable") }
        check(outcome { core.get("p") } == "reentry", "N-th consecutive failure ⇒ reentry")
        check(s.map.containsKey("p"), "reentry ⇒ entry still KEPT (no silent delete)")
        check(core.status("p") == SecureCredentialCore.Status.NEEDS_REENTRY, "status NEEDS_REENTRY")
        core.set("p", "re-entered") // user re-enters: the only, already-unreadable entry may be re-keyed
        k.looksAbsent = false
        check(core.get("p") == "re-entered" && core.status("p") == SecureCredentialCore.Status.OK, "re-entered password readable, status OK")
    }
    run { // a success in between resets the streak
        val (k, _, c, core) = fresh()
        core.set("p", pinned)
        k.looksAbsent = true
        repeat(N - 1) { core.status("p"); outcome { core.get("p") } }
        k.looksAbsent = false
        check(core.get("p") == pinned && c.get("p") == 0, "success resets the counter")
        k.looksAbsent = true
        check(outcome { core.get("p") } == "unavailable", "streak starts over after a success")
    }
    run { // AEADBadTag (wrong key) ⇒ reentry at once, entry kept, re-entry re-keys
        val (k, s, _, core) = fresh()
        core.set("p", pinned)
        k.key = real()
        check(outcome { core.get("p") } == "reentry" && s.map.containsKey("p"), "wrong key ⇒ reentry, entry KEPT")
        core.set("p", "re-entered")
        check(core.get("p") == "re-entered", "re-entry after AEAD failure works")
    }
    run { // malformed ⇒ reentry, kept
        val (_, s, _, core) = fresh()
        s.map["p"] = "garbage-without-colon"
        check(outcome { core.get("p") } == "reentry" && s.map["p"] == "garbage-without-colon", "no separator ⇒ reentry, KEPT")
        s.map["p"] = "@@@:###"
        check(outcome { core.get("p") } == "reentry" && s.map["p"] == "@@@:###", "not Base64 ⇒ reentry, KEPT")
    }
    run { // permanently invalidated key ⇒ reentry at once, kept
        val (k, s, _, core) = fresh()
        core.set("p", pinned)
        k.key = bogus(); k.permanent = true
        check(outcome { core.get("p") } == "reentry" && s.map.containsKey("p"), "permanently invalidated ⇒ reentry, KEPT")
    }
    run { // key store throws / transient cipher error ⇒ unavailable, kept, readable afterwards
        val (k, s, _, core) = fresh()
        core.set("p", pinned)
        val good = k.key
        k.throwOnExisting = true
        check(outcome { core.get("p") } == "unavailable" && s.map.containsKey("p"), "key store throws ⇒ unavailable, KEPT")
        k.throwOnExisting = false
        k.key = bogus()
        check(outcome { core.get("p") } == "unavailable" && s.map.containsKey("p"), "transient cipher error ⇒ unavailable, KEPT")
        k.key = good
        check(core.get("p") == pinned, "readable afterwards")
    }

    // ── N3: a failing save never destroys the old good password ───────────────────────────────────────────────
    run {
        val (k, _, _, core) = fresh()
        core.set("p", pinned)
        val good = k.key
        k.key = bogus()
        check(outcome { core.set("p", "new-value") } == "unavailable" && k.deletes == 0, "transient error on set ⇒ unavailable, alias NOT deleted")
        k.key = good
        check(core.get("p") == pinned, "old password still decrypts after a failed save")
        k.throwOnExisting = true
        check(outcome { core.set("p", "new-value") } == "unavailable", "key store throws on set ⇒ unavailable")
        k.throwOnExisting = false
        check(k.deletes == 0 && core.get("p") == pinned, "old password intact")
    }
    run { // nothing stored + unusable key ⇒ safe to re-key once ⇒ saved
        val (k, _, _, core) = fresh()
        k.key = bogus()
        core.set("p", pinned)
        check(core.get("p") == pinned, "empty store ⇒ re-keyed and saved")
    }
    run { // nothing stored + key looks absent ⇒ create ⇒ saved
        val (k, _, _, core) = fresh()
        core.set("p", pinned)
        core.remove("p")
        k.looksAbsent = true
        check(outcome { core.set("p", pinned) } == "ok", "empty store + looks absent ⇒ saved with a new key")
        k.looksAbsent = false
        check(core.get("p") == pinned, "readable")
    }
    run { // permanently invalidated key on set ⇒ re-key and save the new value
        val (k, _, _, core) = fresh()
        core.set("p", pinned)
        k.key = bogus(); k.permanent = true
        core.set("p", "new-value")
        k.permanent = false
        check(core.get("p") == "new-value", "permanent invalidation on set ⇒ re-keyed, new value readable")
    }
    run { // a second entry that may still be good blocks re-keying even if "p" needs re-entry
        val (k, s, _, core) = fresh()
        core.set("p", pinned)
        core.set("q", "other")
        k.looksAbsent = true
        repeat(N) { outcome { core.get("p") } }
        check(outcome { core.set("p", "re-entered") } == "unavailable" && s.map["q"] != null, "other entry present ⇒ no re-key")
        k.looksAbsent = false
        check(core.get("q") == "other", "other entry intact")
    }
    run { // re-key path fails as well ⇒ unavailable, nothing stored
        val (k, s, _, core) = fresh()
        k.key = bogus(); k.bogusNextCreates = 1
        check(outcome { core.set("p", pinned) } == "unavailable" && !s.map.containsKey("p"), "re-key fails too ⇒ unavailable, nothing stored")
    }
    run { // write not persisted ⇒ WriteFailed, previous value unchanged
        val (_, s, _, core) = fresh()
        core.set("p", pinned)
        s.failWrites = true
        check(outcome { core.set("p", "new-value") } == "error:WriteFailed", "put=false ⇒ WriteFailed")
        s.failWrites = false
        check(core.get("p") == pinned, "previous value unchanged after a failed write")
    }
    run { // Clear: entry + counter gone; last entry ⇒ key deleted too; another entry left ⇒ key kept
        val (k, s, c, core) = fresh()
        core.set("p", pinned)
        core.set("q", "other")
        c.set("p", 3)
        core.remove("p")
        check(!s.map.containsKey("p") && c.get("p") == 0 && k.key != null && k.deletes == 0, "other entry left ⇒ key kept, counter reset")
        core.remove("q")
        check(s.map.isEmpty() && k.key == null && k.deletes == 1, "last entry removed ⇒ key deleted")
        check(core.get("p") == null, "after Clear ⇒ null")
    }
    run { // final wave P-G2 — peek (Settings) never counts a failure and never deletes; a success resets the streak
        val (k, s, c, core) = fresh()
        core.set("p", pinned)
        check(core.peek("p") == pinned && core.peek("missing") == null, "peek reads the value / null when nothing is stored")
        k.looksAbsent = true
        repeat(3 * N) { core.peek("p") }
        check(core.peek("p") == null, "peek while unreadable ⇒ null")
        check(c.get("p") == 0 && s.map.containsKey("p"), "peek never counts a failure and never deletes")
        k.throwOnExisting = true
        check(core.peek("p") == null && c.get("p") == 0, "peek with the key store throwing ⇒ null, not counted")
        k.throwOnExisting = false
        repeat(N - 1) { outcome { core.get("p") } }
        check(c.get("p") == N - 1, "connect reads (get) still count")
        repeat(3 * N) { core.peek("p") }
        check(c.get("p") == N - 1 && core.status("p") == SecureCredentialCore.Status.UNAVAILABLE, "Settings visits do not push the streak to re-entry")
        k.looksAbsent = false
        check(core.peek("p") == pinned && c.get("p") == 0, "a successful peek resets the streak (the store is readable again)")
    }
    println("ALL $checks CHECKS PASSED")
}
