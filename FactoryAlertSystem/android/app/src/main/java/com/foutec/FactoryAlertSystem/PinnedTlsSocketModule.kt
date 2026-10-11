package com.foutec.FactoryAlertSystem

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLSocket

/**
 * PinnedTlsSocket — a TCP+TLS socket for MQTT whose server certificate is pinned by SHA-256 fingerprint
 * (doc 81 Đợt 7 task J2). All trust logic is in [PinnedTlsCore]; this class only bridges it to JS:
 *   connect(id, host, port, pinSha256, timeoutMs) → event {id, type:"connect"} ONLY after the handshake succeeded
 *     with the pinned certificate; otherwise {type:"error", code:"CERT_CHANGED"|"TLS_ERROR"|…} then {type:"close"};
 *   write(id, base64) → refused (error NOT_VERIFIED + close) unless the pinned handshake completed — so nothing,
 *     in particular the CONNECT carrying the device password, can leave before the certificate is verified;
 *   data arrives as {type:"data", data:<base64>}; close(id) closes.
 * Events go to JS as "PinnedTlsSocketEvent" (DeviceEventEmitter). JS side: src/services/pinnedTlsSocket.ts.
 */
class PinnedTlsSocketModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val EVENT = "PinnedTlsSocketEvent"
        private const val READ_BUF = 16 * 1024
    }

    private class Conn(val id: Int) {
        @Volatile var socket: SSLSocket? = null
        val closed = AtomicBoolean(false)
        val closeEmitted = AtomicBoolean(false)
        val writer: ExecutorService = Executors.newSingleThreadExecutor()
    }

    private val conns = ConcurrentHashMap<Int, Conn>()

    override fun getName(): String = "PinnedTlsSocket"

    private fun emit(id: Int, type: String, fill: (com.facebook.react.bridge.WritableMap) -> Unit = {}) {
        try {
            val m = Arguments.createMap()
            m.putInt("id", id)
            m.putString("type", type)
            fill(m)
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT, m)
        } catch (_: Exception) {
            // JS context gone (app reloading) — nothing to tell.
        }
    }

    private fun emitError(c: Conn, e: Throwable?, codeOverride: String? = null) {
        val code = codeOverride ?: PinnedTlsCore.errorCode(e)
        // Message is a fixed text per code: never echo server-controlled strings.
        emit(c.id, "error") {
            it.putString("code", code)
            it.putString("message", if (code == CertificateChangedException.CODE) "broker certificate changed" else code)
        }
    }

    private fun finish(c: Conn, hadError: Boolean) {
        c.closed.set(true)
        try { c.socket?.close() } catch (_: Exception) {}
        c.socket = null
        c.writer.shutdown()
        conns.remove(c.id, c)
        if (c.closeEmitted.compareAndSet(false, true)) emit(c.id, "close") { it.putBoolean("hadError", hadError) }
    }

    @ReactMethod
    fun connect(id: Int, host: String, port: Int, pinSha256: String, timeoutMs: Int) {
        val c = Conn(id)
        conns.put(id, c)?.let { finish(it, false) }
        Thread({
            var hadError = false
            try {
                val s = PinnedTlsCore.open(host, port, pinSha256, if (timeoutMs > 0) timeoutMs else 30_000)
                if (c.closed.get()) {
                    try { s.close() } catch (_: Exception) {}
                    return@Thread
                }
                c.socket = s
                emit(id, "connect")
                val input = s.inputStream
                val buf = ByteArray(READ_BUF)
                while (!c.closed.get()) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (n > 0) {
                        val b64 = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                        emit(id, "data") { it.putString("data", b64) }
                    }
                }
            } catch (e: Throwable) {
                if (!c.closed.get()) {
                    hadError = true
                    emitError(c, e)
                }
            } finally {
                finish(c, hadError)
            }
        }, "PinnedTls-$id").start()
    }

    @ReactMethod
    fun write(id: Int, base64: String) {
        val c = conns[id] ?: return
        val s = c.socket
        if (s == null || c.closed.get()) {
            // Fail closed: a write before the pinned handshake completed is a bug upstream — drop it and close.
            emitError(c, null, "NOT_VERIFIED")
            finish(c, true)
            return
        }
        try {
            c.writer.execute {
                try {
                    val out = s.outputStream
                    out.write(Base64.decode(base64, Base64.NO_WRAP))
                    out.flush()
                } catch (e: Throwable) {
                    if (!c.closed.get()) {
                        emitError(c, e)
                        finish(c, true)
                    }
                }
            }
        } catch (_: Exception) {
            // executor already shut down: the connection is closing
        }
    }

    @ReactMethod
    fun close(id: Int) {
        val c = conns[id] ?: return
        finish(c, false)
    }

    // NativeEventEmitter contract (RN ≥ 0.65); events are delivered through DeviceEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun invalidate() {
        for (c in conns.values) finish(c, false)
        super.invalidate()
    }
}
