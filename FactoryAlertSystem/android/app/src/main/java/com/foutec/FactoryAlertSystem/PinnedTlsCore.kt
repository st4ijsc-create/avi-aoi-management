package com.foutec.FactoryAlertSystem

import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * doc 81 Đợt 7 task J2 — MQTT over TLS to the built-in broker, trusted by CERTIFICATE FINGERPRINT (pinning).
 *
 * The broker's site certificate is self-signed (server: server/services/mqttBrokerTls.ts). There is no CA to
 * validate it against, so the ONLY trust decision is: the leaf certificate the server presents must have exactly
 * the SHA-256 fingerprint the technician entered (shown on the admin screen). Anything else — another certificate,
 * no certificate, a malformed pin — is REFUSED during the handshake, before a single MQTT byte (the CONNECT that
 * carries the device password) can be written. There is NO "trust all" path and no hostname exemption to abuse:
 * the pin is stronger than a hostname check (it names one exact certificate).
 *
 * Android-free (plain javax.net.ssl) so it is checked on a plain JVM against a real TLS server
 * (android/app/src/test/.../PinnedTlsCoreCheck.kt). PinnedTlsSocketModule.kt only bridges it to React Native.
 */
object PinnedTlsCore {
    /** "AB:CD:…", "ab cd …", "abcd…" ⇒ 64 lowercase hex chars; anything that is not exactly one SHA-256 ⇒ null. */
    fun normalizeFingerprint(raw: String?): String? {
        if (raw == null) return null
        val hex = raw.filter { !it.isWhitespace() && it != ':' }.lowercase()
        if (hex.length != 64) return null
        if (hex.any { !(it in '0'..'9' || it in 'a'..'f') }) return null
        return hex
    }

    fun sha256Hex(der: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun hexToBytes(hex: String): ByteArray =
        ByteArray(hex.length / 2) { i -> hex.substring(2 * i, 2 * i + 2).toInt(16).toByte() }

    /** Constant-time: does this certificate DER hash to the (normalized) pin? */
    fun matches(leafDer: ByteArray?, pinHex: String): Boolean {
        if (leafDer == null || leafDer.isEmpty()) return false
        val pin = normalizeFingerprint(pinHex) ?: return false
        return MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(leafDer), hexToBytes(pin))
    }

    /** Error code for JS. CERT_CHANGED is recognised anywhere in the cause chain (Conscrypt wraps it). */
    fun errorCode(e: Throwable?): String {
        var c: Throwable? = e
        var depth = 0
        while (c != null && depth < 10) {
            if (c is CertificateChangedException || (c.message ?: "").contains(CertificateChangedException.CODE)) {
                return CertificateChangedException.CODE
            }
            c = c.cause
            depth++
        }
        return when (e) {
            is BadPinException -> "BAD_PIN"
            is SocketTimeoutException -> "ETIMEDOUT"
            is ConnectException -> "ECONNREFUSED"
            is SSLException -> "TLS_ERROR"
            else -> "CONNECT_ERROR"
        }
    }

    /**
     * Open a TCP connection, run the TLS handshake with [PinnedTrustManager], re-check the pin on the established
     * session, and only then return the socket. Throws on ANY failure (the socket is closed) — the caller never
     * gets a socket whose certificate was not the pinned one.
     */
    fun open(host: String, port: Int, pin: String, timeoutMs: Int): SSLSocket {
        val pinHex = normalizeFingerprint(pin) ?: throw BadPinException()
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(PinnedTrustManager(pinHex)), SecureRandom())
        val raw = Socket()
        try {
            raw.connect(InetSocketAddress(host, port), timeoutMs)
            raw.soTimeout = timeoutMs
        } catch (e: Exception) {
            try { raw.close() } catch (_: Exception) {}
            throw e
        }
        val ssl = ctx.socketFactory.createSocket(raw, host, port, true) as SSLSocket
        try {
            ssl.startHandshake()
            // Belt and braces: the session's peer leaf must be the pinned certificate too.
            val leaf = ssl.session.peerCertificates.firstOrNull() as? X509Certificate
            if (leaf == null || !matches(leaf.encoded, pinHex)) {
                throw CertificateChangedException(leaf?.encoded?.let { sha256Hex(it) })
            }
            ssl.soTimeout = 0 // MQTT keepalive governs liveness from here on
            return ssl
        } catch (e: Exception) {
            try { ssl.close() } catch (_: Exception) {}
            throw e
        }
    }
}

/** The broker presented a certificate whose fingerprint is not the pinned one. */
class CertificateChangedException(val presentedSha256: String?) : CertificateException(CODE) {
    companion object {
        const val CODE = "CERT_CHANGED"
    }
}

class BadPinException : IllegalArgumentException("BAD_PIN: the certificate fingerprint must be 64 hex digits (SHA-256)")

/**
 * Accepts exactly ONE server certificate: the one whose SHA-256 is [pinHex]. Not a CA validator and never a
 * trust-all: an empty chain, any other leaf, and every client-certificate check are refused.
 */
class PinnedTrustManager(pinHex: String) : X509TrustManager {
    private val pin: String = PinnedTlsCore.normalizeFingerprint(pinHex) ?: throw BadPinException()

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateChangedException(null)
        val der = leaf.encoded
        if (!PinnedTlsCore.matches(der, pin)) throw CertificateChangedException(PinnedTlsCore.sha256Hex(der))
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("client certificates are not accepted by this trust manager")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
