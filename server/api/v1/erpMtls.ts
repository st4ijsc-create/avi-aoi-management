/**
 * Automation Orchestration K0+-a (doc 16 §4 Khối 0 / doc 18 §6) — mTLS HONEST SEAM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * mTLS (mutual-TLS / client-certificate auth) is a TRANSPORT-LEVEL concern, NOT
 * something an Express app-layer middleware can genuinely enforce on its own. Real
 * mTLS requires the Node https server (or the reverse proxy / load balancer in
 * front of it) to be configured to REQUEST + VERIFY a client certificate:
 *
 *   • Node native:  https.createServer({ requestCert: true, rejectUnauthorized: true,
 *                     ca: [...trustedClientCAs] }, app)
 *   • Behind nginx: `ssl_verify_client on;` + `ssl_client_certificate <ca>.pem;`,
 *                   passing the verify result down as a header (e.g. X-SSL-Client-Verify).
 *
 * This module is an HONEST SEAM — it does NOT fabricate mTLS. When REQUIRE_CLIENT_CERT
 * is set, it checks whatever the TLS-terminating layer actually surfaced:
 *   • req.socket.getPeerCertificate() when Node itself terminated TLS with
 *     requestCert:true, OR
 *   • a trusted proxy verify header (X-SSL-Client-Verify: SUCCESS) when a reverse
 *     proxy terminated TLS.
 * If NEITHER is present, the request is DENIED (fail-closed) with a clear message
 * that mTLS is required but the transport did not present a verified client cert —
 * so a misconfiguration surfaces loudly instead of silently allowing plaintext.
 *
 * DEFAULT: REQUIRE_CLIENT_CERT unset/false → this middleware is a NO-OP passthrough.
 * It never manufactures a "verified" state; it only reads what the transport gave it.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Request, Response, NextFunction } from "express";
import type { TLSSocket } from "node:tls";
import { sendError } from "./envelope";

/** True when deployment demands a verified client certificate on inbound ERP calls. */
export function requireClientCert(): boolean {
  return process.env.REQUIRE_CLIENT_CERT === "true" || process.env.REQUIRE_CLIENT_CERT === "1";
}

/**
 * Was a verified client certificate presented by the transport? Reads ONLY what
 * the TLS-terminating layer surfaced — never synthesizes success. Returns:
 *   • true  — Node-terminated TLS presented an authorized peer cert, OR a trusted
 *             proxy header reports SUCCESS.
 *   • false — no verified client cert is visible at this layer.
 */
export function hasVerifiedClientCert(req: Request): boolean {
  // 1) Node itself terminated TLS with requestCert:true → the socket is a TLSSocket.
  const socket = req.socket as Partial<TLSSocket>;
  if (typeof socket?.getPeerCertificate === "function") {
    try {
      const cert = socket.getPeerCertificate();
      const authorized = (socket as TLSSocket).authorized === true;
      if (authorized && cert && Object.keys(cert).length > 0) return true;
    } catch {
      /* not a TLS socket / no peer cert */
    }
  }
  // 2) A reverse proxy terminated TLS and passed the verify result down. This header
  //    is only trustworthy if the proxy is trusted (deployment concern); documented.
  const proxyVerify = req.header("x-ssl-client-verify") || req.header("X-SSL-Client-Verify");
  if (proxyVerify && /^success$/i.test(proxyVerify.trim())) return true;
  return false;
}

/**
 * Express middleware: enforce mTLS ONLY when REQUIRE_CLIENT_CERT is set. Fail-closed
 * — if required but no verified cert is visible, deny (do not fabricate). NO-OP
 * (passthrough) by default so nothing changes unless a deployment opts in.
 */
export function mtlsGuard(req: Request, res: Response, next: NextFunction): void {
  if (!requireClientCert()) {
    next();
    return;
  }
  if (hasVerifiedClientCert(req)) {
    next();
    return;
  }
  sendError(
    res,
    496, // "No Cert" (nginx convention) — clear it's a client-cert failure.
    "client_cert_required",
    "REQUIRE_CLIENT_CERT is set but no verified client certificate was presented by the transport. Configure mTLS at the https server / reverse proxy (see server/api/v1/erpMtls.ts).",
  );
}
