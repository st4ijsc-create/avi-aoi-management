package com.foutec.FactoryAlertSystem

import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64

/**
 * doc 81 Đợt 7 J2 — plain-JVM check of PinnedTlsCore (no JUnit in this Gradle project).
 *
 * Part 1 (always): fingerprint normalisation, constant-time match, the trust manager accepts ONLY the pinned leaf.
 * Part 2 (when run by the driver `android/app/src/test/pinned-tls-check-driver.mts`, args: tlsPort pinA pinB plainPort
 * certPemFile): REAL TLS handshakes against a Node TLS echo server presenting the broker's own kind of site
 * certificate (minted by server/services/mqttBrokerTls.ts): right pin ⇒ echo; another pin ⇒ CERT_CHANGED before any
 * byte is written; a plaintext server ⇒ failure, never a plaintext fallback. The driver independently counts what
 * the servers received. Prints "ALL n CHECKS PASSED" and exits 0; any failure prints "FAILED: …" and exits 1.
 */
private var passed = 0

private fun check(name: String, ok: Boolean) {
    if (!ok) {
        println("FAILED: $name")
        kotlin.system.exitProcess(1)
    }
    passed++
}

private fun expectThrows(name: String, block: () -> Unit): Throwable {
    try {
        block()
    } catch (t: Throwable) {
        passed++
        return t
    }
    println("FAILED: $name (no exception)")
    kotlin.system.exitProcess(1)
}

private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it.toInt() and 0xff) }

private fun loadCert(pemFile: String): X509Certificate {
    val text = java.io.File(pemFile).readText()
    val b64 = Regex("-----BEGIN CERTIFICATE-----([\\s\\S]+?)-----END CERTIFICATE-----").find(text)!!.groupValues[1].replace(Regex("\\s"), "")
    return CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(b64))) as X509Certificate
}

fun main(args: Array<String>) {
    // ── Part 1 ───────────────────────────────────────────────────────────────────────────────────────────────
    val hex = "3a9f00112233445566778899aabbccddeeff0123456789abcdef1032547698ba"
    check("normalise lower hex", PinnedTlsCore.normalizeFingerprint(hex) == hex)
    check("normalise AB:CD form", PinnedTlsCore.normalizeFingerprint(hex.uppercase().chunked(2).joinToString(":")) == hex)
    check("normalise spaces/newline", PinnedTlsCore.normalizeFingerprint(" " + hex.chunked(8).joinToString(" ") + "\n") == hex)
    check("63 digits ⇒ null", PinnedTlsCore.normalizeFingerprint(hex.dropLast(1)) == null)
    check("65 digits ⇒ null", PinnedTlsCore.normalizeFingerprint(hex + "0") == null)
    check("non-hex ⇒ null", PinnedTlsCore.normalizeFingerprint(hex.dropLast(1) + "g") == null)
    check("empty / null ⇒ null", PinnedTlsCore.normalizeFingerprint("") == null && PinnedTlsCore.normalizeFingerprint(null) == null)
    check("SHA-1 length (40) ⇒ null", PinnedTlsCore.normalizeFingerprint("a".repeat(40)) == null)

    val der = "certificate-der-bytes".toByteArray()
    check("matches own sha256", PinnedTlsCore.matches(der, sha(der)))
    check("matches with AB:CD pin", PinnedTlsCore.matches(der, sha(der).uppercase().chunked(2).joinToString(":")))
    check("other bytes ⇒ no match", !PinnedTlsCore.matches("other".toByteArray(), sha(der)))
    check("null / empty der ⇒ no match", !PinnedTlsCore.matches(null, sha(der)) && !PinnedTlsCore.matches(ByteArray(0), sha(der)))
    check("malformed pin ⇒ no match", !PinnedTlsCore.matches(der, "xyz"))

    expectThrows("trust manager with a malformed pin") { PinnedTrustManager("not-a-fingerprint") }
    check("errorCode BAD_PIN", PinnedTlsCore.errorCode(BadPinException()) == "BAD_PIN")
    check("errorCode CERT_CHANGED through a wrapper", PinnedTlsCore.errorCode(javax.net.ssl.SSLHandshakeException("x").apply { initCause(CertificateChangedException("ab")) }) == "CERT_CHANGED")
    check("errorCode CERT_CHANGED from message only", PinnedTlsCore.errorCode(javax.net.ssl.SSLHandshakeException("java.security.cert.CertificateException: CERT_CHANGED")) == "CERT_CHANGED")
    check("errorCode TLS_ERROR", PinnedTlsCore.errorCode(javax.net.ssl.SSLException("handshake_failure")) == "TLS_ERROR")
    check("errorCode ETIMEDOUT", PinnedTlsCore.errorCode(java.net.SocketTimeoutException()) == "ETIMEDOUT")

    if (args.size < 5) {
        println("ALL $passed CHECKS PASSED (part 1 only — run the driver for the real-handshake part)")
        return
    }

    // ── Part 2: real TLS ─────────────────────────────────────────────────────────────────────────────────────
    val tlsPort = args[0].toInt()
    val pinA = args[1]
    val pinB = args[2]
    val plainPort = args[3].toInt()
    val certA = loadCert(args[4])

    val tmA = PinnedTrustManager(pinA)
    tmA.checkServerTrusted(arrayOf(certA), "ECDHE_ECDSA"); passed++ // must not throw
    val tmB = PinnedTrustManager(pinB)
    val e0 = expectThrows("trust manager refuses another certificate") { tmB.checkServerTrusted(arrayOf(certA), "ECDHE_ECDSA") }
    check("refusal is CertificateChangedException carrying the presented fingerprint", e0 is CertificateChangedException && e0.presentedSha256 == sha(certA.encoded))
    expectThrows("empty chain refused") { tmA.checkServerTrusted(arrayOf(), "ECDHE_ECDSA") }
    expectThrows("client certificates refused") { tmA.checkClientTrusted(arrayOf(certA), "RSA") }
    check("no accepted issuers advertised", tmA.acceptedIssuers.isEmpty())

    // right pin ⇒ handshake, echo
    val s = PinnedTlsCore.open("127.0.0.1", tlsPort, pinA, 5000)
    s.outputStream.write("ping-from-jvm".toByteArray())
    s.outputStream.flush()
    val buf = ByteArray(64)
    var got = ""
    while (got.length < "ping-from-jvm".length) {
        val n = s.inputStream.read(buf)
        if (n < 0) break
        got += String(buf, 0, n)
    }
    s.close()
    check("pinned handshake + echo", got == "ping-from-jvm")

    // right pin in AB:CD upper-case form
    val s2 = PinnedTlsCore.open("127.0.0.1", tlsPort, pinA.uppercase().chunked(2).joinToString(":"), 5000)
    s2.close(); passed++

    // another pin ⇒ CERT_CHANGED, no socket returned (so nothing can be written)
    val e1 = expectThrows("another pin refused") { PinnedTlsCore.open("127.0.0.1", tlsPort, pinB, 5000) }
    check("another pin ⇒ CERT_CHANGED (got ${PinnedTlsCore.errorCode(e1)}: $e1)", PinnedTlsCore.errorCode(e1) == "CERT_CHANGED")

    // malformed pin ⇒ refused before connecting
    val e2 = expectThrows("malformed pin refused") { PinnedTlsCore.open("127.0.0.1", tlsPort, "zz", 5000) }
    check("malformed pin ⇒ BAD_PIN", PinnedTlsCore.errorCode(e2) == "BAD_PIN")

    // a plaintext server ⇒ failure (never a plaintext fallback)
    val e3 = expectThrows("plaintext server refused") { PinnedTlsCore.open("127.0.0.1", plainPort, pinA, 3000) }
    val c3 = PinnedTlsCore.errorCode(e3)
    check("plaintext server ⇒ TLS_ERROR/ETIMEDOUT/CONNECT_ERROR (got $c3)", c3 == "TLS_ERROR" || c3 == "ETIMEDOUT" || c3 == "CONNECT_ERROR")
    check("CertificateException is the refusal type", CertificateChangedException("x") is CertificateException)

    println("ALL $passed CHECKS PASSED")
}
