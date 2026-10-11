/**
 * doc 81 Đợt 7 task J1 — TLS for the BUILT-IN (aedes) MQTT broker.
 *
 * Until Đợt 7 the tablet ↔ built-in broker link was plaintext (TCP 1883 / ws 8883): the device password of
 * Đợt 5 G1 crossed the LAN in clear. From Đợt 7 the broker also listens MQTT over TLS (MQTTS, `MQTT_TLS_PORT`,
 * default 8884) — ON BY DEFAULT whenever the broker runs:
 *   · a site certificate is GENERATED on first start (ECDSA P-256, self-signed) and stored OUTSIDE git, in
 *     `MQTT_TLS_DIR` (default `<cwd>/data/mqtt-tls/`, ignored by `/data/` in .gitignore), file mode 0600;
 *   · tablets (app ≥ 1.0.18) PIN its SHA-256 fingerprint — the admin screen shows it (Connectivity → Devices),
 *     the technician types it next to the device password. A self-signed certificate is safe ONLY because of
 *     that pin: there is no CA, so there is nothing to bypass.
 *   · an operator-provided certificate (`MQTT_TLS_CERT` + `MQTT_TLS_KEY`, both PEM paths) still wins — its
 *     fingerprint is shown the same way.
 *
 * Fail-closed decisions (L-7: every "cannot decide" names its outcome):
 *   · stored file unreadable / corrupt / key ≠ certificate ⇒ the TLS listener does NOT start, the admin screen
 *     shows the error, and the file is NEVER overwritten (a silently regenerated certificate would change the
 *     fingerprint and lock out every pinned tablet with "certificate changed" — or worse, train technicians to
 *     accept new fingerprints). The operator moves the file away to regenerate on purpose.
 *   · only one of MQTT_TLS_CERT / MQTT_TLS_KEY set ⇒ no TLS listener (operator intent unclear), error shown.
 *   · two processes generating at once ⇒ exactly one file wins (exclusive hard-link), the loser loads it.
 *   · TLS disabled only by an EXPLICIT `MQTT_TLS_ENABLED=false|0|off|no`; unset or a typo ⇒ ON.
 *
 * The plaintext listeners (TCP + WS) stay open until migration is done — owner decision 2026-10-11. They can
 * be closed with `MQTT_PLAIN_ENABLED=false|0|off|no` once every tablet runs over TLS; unset or a typo ⇒ open
 * (unchanged behaviour). This module only decides; mqttService.ts binds the sockets.
 *
 * Hand-rolled DER (no node-forge / openssl dependency, same approach as security/x509Mint.ts, but ECDSA P-256:
 * Android's TLS stack does not offer Ed25519 server certificates).
 */
import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── flags ─────────────────────────────────────────────────────────────────────
const OFF_VALUES = new Set(["false", "0", "off", "no"]);

function isExplicitlyOff(v: string | undefined): boolean {
  return v !== undefined && OFF_VALUES.has(v.trim().toLowerCase());
}

/** MQTTS listener of the built-in broker: ON unless explicitly turned off. */
export function mqttTlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isExplicitlyOff(env.MQTT_TLS_ENABLED);
}

/** Plaintext TCP + WS listeners: open (unchanged) unless explicitly turned off after the TLS migration. */
export function mqttPlainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isExplicitlyOff(env.MQTT_PLAIN_ENABLED);
}

/** Where the generated site certificate lives (outside git). */
export function mqttTlsDir(env: NodeJS.ProcessEnv = process.env): string {
  const d = (env.MQTT_TLS_DIR || "").trim();
  return d ? path.resolve(d) : path.resolve(process.cwd(), "data", "mqtt-tls");
}

export const SITE_TLS_FILE_NAME = "broker-tls.pem";

// ── ASN.1 DER ─────────────────────────────────────────────────────────────────
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts));
function oid(dotted: string): Buffer {
  const p = dotted.split(".").map(Number);
  const out: number[] = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i];
    const chunk = [v & 0x7f];
    for (v >>= 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function derTime(d: Date): Buffer {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const y = d.getUTCFullYear();
  // RFC 5280 §4.1.2.5: UTCTime through 2049, GeneralizedTime from 2050.
  return y < 2050 ? tlv(0x17, Buffer.from(`${p(y % 100)}${body}`, "ascii")) : tlv(0x18, Buffer.from(`${p(y, 4)}${body}`, "ascii"));
}
function nameCN(cn: string): Buffer {
  return seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn, "utf8")))));
}
function ext(id: string, critical: boolean, value: Buffer): Buffer {
  return critical ? seq(oid(id), tlv(0x01, Buffer.from([0xff])), tlv(0x04, value)) : seq(oid(id), tlv(0x04, value));
}
const ECDSA_SHA256 = seq(oid("1.2.840.10045.4.3.2"));

function pemBlock(label: string, der: Buffer): string {
  const b64 = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/**
 * A self-signed ECDSA P-256 server certificate (X.509 v3): basicConstraints cA:FALSE, keyUsage
 * digitalSignature, extKeyUsage serverAuth. Clients trust it by FINGERPRINT pin, not by name or CA.
 */
export function mintSiteBrokerCertificate(opts: { commonName: string; days: number; now?: Date }): { keyPem: string; certPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = opts.now ?? new Date();
  const notBefore = new Date(now.getTime() - 86_400_000); // 1 day of clock-skew slack
  const notAfter = new Date(now.getTime() + opts.days * 86_400_000);
  const serial = randomBytes(16);
  serial[0] &= 0x7f; // positive INTEGER
  if (serial[0] === 0) serial[0] = 0x01; // minimal encoding without a leading zero byte
  const extensions = tlv(
    0xa3,
    seq(
      ext("2.5.29.19", true, seq()), // basicConstraints: cA FALSE
      ext("2.5.29.15", true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature
      ext("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
    ),
  );
  const name = nameCN(opts.commonName);
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([0x02]))), // version v3
    tlv(0x02, serial),
    ECDSA_SHA256,
    name,
    seq(derTime(notBefore), derTime(notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }) as Buffer,
    extensions,
  );
  const signature = sign("sha256", tbs, privateKey); // DER ECDSA-Sig-Value
  const certDer = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certPem: pemBlock("CERTIFICATE", certDer),
  };
}

// ── load / create ─────────────────────────────────────────────────────────────
export class BrokerTlsError extends Error {
  constructor(
    readonly code: "TLS_FILE_UNREADABLE" | "TLS_FILE_CORRUPT" | "TLS_KEY_MISMATCH" | "TLS_CONFIG_INCOMPLETE" | "TLS_WRITE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "BrokerTlsError";
  }
}

export interface BrokerTlsMaterial {
  keyPem: string;
  certPem: string;
  /** SHA-256 of the certificate DER, `AB:CD:…` (64 hex digits, colon-separated) — what tablets pin. */
  fingerprintSha256: string;
  notAfter: string;
  source: "generated" | "configured";
  /** true when this call created the site certificate. */
  created: boolean;
  file: string;
}

const KEY_RE = /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:EC |RSA )?PRIVATE KEY-----/;
const CERT_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/** Parse + cross-check a key/certificate pair. Throws BrokerTlsError (never returns a half-valid pair). */
export function parseBrokerTlsPair(keyText: string, certText: string, where: string): { keyPem: string; certPem: string; cert: X509Certificate } {
  const keyPem = keyText.match(KEY_RE)?.[0];
  const certPem = certText.match(CERT_RE)?.[0];
  if (!keyPem || !certPem) throw new BrokerTlsError("TLS_FILE_CORRUPT", `${where}: missing PEM private key or certificate`);
  let cert: X509Certificate;
  let key;
  try {
    key = createPrivateKey(keyPem);
    cert = new X509Certificate(certPem);
  } catch (e) {
    throw new BrokerTlsError("TLS_FILE_CORRUPT", `${where}: ${(e as Error)?.message ?? "unparseable PEM"}`);
  }
  if (!cert.checkPrivateKey(key)) throw new BrokerTlsError("TLS_KEY_MISMATCH", `${where}: the private key does not match the certificate`);
  return { keyPem: `${keyPem}\n`, certPem: `${certPem}\n`, cert };
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new BrokerTlsError("TLS_FILE_UNREADABLE", `${file}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
  }
}

function materialFrom(pair: { keyPem: string; certPem: string; cert: X509Certificate }, source: BrokerTlsMaterial["source"], created: boolean, file: string): BrokerTlsMaterial {
  return {
    keyPem: pair.keyPem,
    certPem: pair.certPem,
    fingerprintSha256: pair.cert.fingerprint256.toUpperCase(),
    notAfter: new Date(pair.cert.validTo).toISOString(),
    source,
    created,
    file,
  };
}

/** Operator-provided certificate (MQTT_TLS_CERT + MQTT_TLS_KEY). */
export function loadConfiguredBrokerTls(certPath: string, keyPath: string): BrokerTlsMaterial {
  const pair = parseBrokerTlsPair(readText(keyPath), readText(certPath), certPath);
  return materialFrom(pair, "configured", false, certPath);
}

/**
 * The site certificate in `dir`: loaded when present, generated ONLY when the file does not exist. A present
 * but bad file throws (never overwritten). Generation is exclusive: written to a private temp file, then
 * hard-linked to the final name (EEXIST ⇒ another process won ⇒ load its file).
 */
export function loadOrCreateSiteBrokerTls(opts: { dir: string; commonName?: string; days?: number; now?: Date }): BrokerTlsMaterial {
  const file = path.join(opts.dir, SITE_TLS_FILE_NAME);
  if (fs.existsSync(file)) {
    const text = readText(file);
    return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
  }
  const { keyPem, certPem } = mintSiteBrokerCertificate({
    commonName: opts.commonName ?? `AVI-AOI built-in MQTT broker (${os.hostname()})`,
    days: opts.days ?? 7300, // ~20 years: the pin, not the date, is the trust decision
    now: opts.now,
  });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, keyPem + certPem, { mode: 0o600, flag: "wx" });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      const text = readText(file); // lost the race — the winner's certificate is the site certificate
      return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
    }
  } catch (e) {
    if (e instanceof BrokerTlsError) throw e;
    throw new BrokerTlsError("TLS_WRITE_FAILED", `${file}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
  const text = readText(file);
  return materialFrom(parseBrokerTlsPair(text, text, file), "generated", true, file);
}

/**
 * Resolve the TLS material the listener should use, per env. Throws BrokerTlsError when it cannot decide
 * safely (caller: do not start the TLS listener, show the error).
 */
export function resolveBrokerTls(env: NodeJS.ProcessEnv = process.env): BrokerTlsMaterial {
  const cert = (env.MQTT_TLS_CERT || "").trim();
  const key = (env.MQTT_TLS_KEY || "").trim();
  if (cert || key) {
    if (!cert || !key) {
      throw new BrokerTlsError("TLS_CONFIG_INCOMPLETE", "MQTT_TLS_CERT and MQTT_TLS_KEY must both be set (or neither, to use the generated site certificate)");
    }
    return loadConfiguredBrokerTls(cert, key);
  }
  return loadOrCreateSiteBrokerTls({ dir: mqttTlsDir(env) });
}

// ── status shown to the admin ────────────────────────────────────────────────
export interface MqttBrokerTlsStatus {
  /** MQTTS listener wanted (MQTT_TLS_ENABLED not explicitly off). */
  enabled: boolean;
  listening: boolean;
  port: number | null;
  fingerprintSha256: string | null;
  source: BrokerTlsMaterial["source"] | null;
  notAfter: string | null;
  /** BrokerTlsError code, or the listen error code (EADDRINUSE…); null when fine. */
  error: string | null;
  plainEnabled: boolean;
}
