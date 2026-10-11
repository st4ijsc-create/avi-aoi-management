/**
 * doc 81 Đợt 7 task J1 — TLS for the BUILT-IN (aedes) MQTT broker.
 *
 * Until Đợt 7 the tablet ↔ built-in broker link was plaintext (TCP 1883 / ws 8883): the device password of
 * Đợt 5 G1 crossed the LAN in clear. From Đợt 7 the broker also listens MQTT over TLS (MQTTS, `MQTT_TLS_PORT`,
 * default 8884) — ON BY DEFAULT whenever the broker runs:
 *   · a site certificate is GENERATED on first start (ECDSA P-256, self-signed) and stored OUTSIDE git, in
 *     `MQTT_TLS_DIR` (default `<cwd>/data/mqtt-tls/`, ignored by `/data/` in .gitignore). POSIX: file mode 0600 /
 *     dir 0700. WINDOWS (fix 1 — `mode` does nothing on NTFS; `data/` inherits Users / Authenticated Users): the
 *     directory and the file get an explicit ACL — inheritance removed, access ONLY for the server's own account,
 *     SYSTEM and Administrators (icacls, argument array, no shell) — set on the empty file BEFORE the key is written;
 *     at every start the ACL of the directory and of the key file is checked: readable by Users / Authenticated
 *     Users / Everyone… ⇒ error logged, repaired; still open, or the ACL cannot be read ⇒ the TLS listener does NOT
 *     start (fail closed; the plaintext listeners are unaffected). The same check covers MQTT_TLS_KEY.
 *   · the certificate names the host (subjectAltName: hostname, localhost, 127.0.0.1 and the LAN IPv4 addresses at
 *     generation time) so a client that validates normally can also use it; an EXISTING certificate is never
 *     regenerated to add them (that would change the fingerprint) — see DEPLOY_LAN_GUIDE for deliberate rotation;
 *   · leftover `broker-tls.pem.*.tmp` files (a crash between write and link) are swept at start;
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
import { execFileSync } from "node:child_process";
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
export interface SubjectAltNames {
  dns: string[];
  ips: string[];
}

/** subjectAltName GeneralNames: dNSName [2] IA5String, iPAddress [7] 4-byte OCTET STRING (IPv4 only). */
function sanValue(san: SubjectAltNames): Buffer {
  const names: Buffer[] = [];
  for (const d of san.dns) names.push(tlv(0x82, Buffer.from(d, "ascii")));
  for (const ip of san.ips) names.push(tlv(0x87, Buffer.from(ip.split(".").map(Number))));
  return seq(...names);
}

const DNS_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** The names this host answers to right now: hostname + localhost, 127.0.0.1 + every non-internal IPv4. */
export function siteSubjectAltNames(): SubjectAltNames {
  const dns = new Set<string>(["localhost"]);
  const host = os.hostname().trim();
  if (DNS_NAME_RE.test(host)) dns.add(host.toLowerCase());
  const ips = new Set<string>(["127.0.0.1"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a && a.family === "IPv4" && !a.internal && IPV4_RE.test(a.address)) ips.add(a.address);
    }
  }
  return { dns: [...dns], ips: [...ips] };
}

export function mintSiteBrokerCertificate(opts: { commonName: string; days: number; now?: Date; subjectAltNames?: SubjectAltNames }): { keyPem: string; certPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = opts.now ?? new Date();
  const notBefore = new Date(now.getTime() - 86_400_000); // 1 day of clock-skew slack
  const notAfter = new Date(now.getTime() + opts.days * 86_400_000);
  const serial = randomBytes(16);
  serial[0] &= 0x7f; // positive INTEGER
  if (serial[0] === 0) serial[0] = 0x01; // minimal encoding without a leading zero byte
  const san = opts.subjectAltNames && (opts.subjectAltNames.dns.length || opts.subjectAltNames.ips.length)
    ? {
        dns: opts.subjectAltNames.dns.filter((d) => DNS_NAME_RE.test(d)),
        ips: opts.subjectAltNames.ips.filter((ip) => IPV4_RE.test(ip)),
      }
    : null;
  const extensions = tlv(
    0xa3,
    seq(
      ext("2.5.29.19", true, seq()), // basicConstraints: cA FALSE
      ext("2.5.29.15", true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature
      ext("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
      ...(san ? [ext("2.5.29.17", false, sanValue(san))] : []), // subjectAltName (fix 1)
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
    readonly code:
      | "TLS_FILE_UNREADABLE"
      | "TLS_FILE_CORRUPT"
      | "TLS_KEY_MISMATCH"
      | "TLS_CONFIG_INCOMPLETE"
      | "TLS_WRITE_FAILED"
      | "TLS_KEY_ACL_OPEN"
      | "TLS_KEY_ACL_UNVERIFIED",
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

// ── Windows ACL of the private key (fix 1) ──────────────────────────────────
/**
 * Who may read the private key. POSIX keeps file modes (0600/0700) and passes `null`. On Windows the default is
 * {@link windowsKeyFileAcl}; tests inject a fake.
 */
export interface KeyFileAcl {
  /** true when anyone beyond the server account / SYSTEM / Administrators is granted access. Throws when unreadable. */
  isOpen(target: string): boolean;
  /** Remove inheritance and grant ONLY the server account, SYSTEM, Administrators. Throws on failure. */
  restrict(target: string, isDir: boolean): void;
}

/** Trustees that make a key readable by ordinary local users (SDDL aliases and their SIDs). */
const BROAD_TRUSTEES = new Set([
  "WD", "S-1-1-0", // Everyone
  "AU", "S-1-5-11", // Authenticated Users
  "BU", "S-1-5-32-545", // BUILTIN\Users
  "BG", "S-1-5-32-546", // Guests
  "IU", "S-1-5-4", // Interactive
  "AN", "S-1-5-7", // Anonymous
  "NU", "S-1-5-2", // Network
]);
/** Broad SIDs removed explicitly after /inheritance:r (an explicit grant to them would survive it). */
const BROAD_SIDS = ["S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-32-546", "S-1-5-4", "S-1-5-7", "S-1-5-2"];

/** Does this SDDL (from `icacls /save`) grant access to a broad trustee? Allow ACEs only; deny ACEs never open. */
export function sddlGrantsBroadAccess(sddl: string): boolean {
  const dacl = sddl.match(/D:[^(]*((?:\([^)]*\))*)/)?.[1] ?? "";
  for (const m of dacl.matchAll(/\(([^)]*)\)/g)) {
    const f = m[1].split(";");
    if (f.length >= 6 && (f[0] === "A" || f[0] === "OA") && BROAD_TRUSTEES.has(f[5].toUpperCase())) return true;
  }
  return false;
}

function sys32(exe: string): string {
  return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", exe);
}

let cachedSid: string | null = null;
/** SID of the account this server runs as (`whoami /user`), e.g. S-1-5-18 when it runs as LocalSystem. */
function currentAccountSid(): string {
  if (cachedSid) return cachedSid;
  const out = execFileSync(sys32("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = out.match(/"(S-1-[0-9-]+)"\s*$/m)?.[1];
  if (!sid) throw new Error("cannot determine the server account SID");
  cachedSid = sid;
  return sid;
}

/** icacls-based implementation (absolute System32 paths, argument arrays — never a shell). */
export const windowsKeyFileAcl: KeyFileAcl = {
  isOpen(target) {
    const out = path.join(os.tmpdir(), `mqtt-tls-acl-${process.pid}-${randomBytes(4).toString("hex")}.txt`);
    try {
      execFileSync(sys32("icacls.exe"), [target, "/save", out], { windowsHide: true, stdio: "ignore" });
      const sddl = fs.readFileSync(out).toString("utf16le");
      if (!/D:/.test(sddl)) throw new Error("icacls /save produced no DACL");
      return sddlGrantsBroadAccess(sddl);
    } finally {
      try { fs.unlinkSync(out); } catch { /* not written */ }
    }
  },
  restrict(target, isDir) {
    const perm = isDir ? "(OI)(CI)(F)" : "(F)";
    const icacls = sys32("icacls.exe");
    execFileSync(icacls, [target, "/inheritance:r", "/grant:r", `*${currentAccountSid()}:${perm}`, `*S-1-5-18:${perm}`, `*S-1-5-32-544:${perm}`], { windowsHide: true, stdio: "ignore" });
    execFileSync(icacls, [target, "/remove:g", ...BROAD_SIDS.map((x) => `*${x}`)], { windowsHide: true, stdio: "ignore" });
  },
};

export function defaultKeyFileAcl(platform: NodeJS.Platform = process.platform): KeyFileAcl | null {
  return platform === "win32" ? windowsKeyFileAcl : null;
}

/**
 * Make sure only the server account / SYSTEM / Administrators can access `target`. Already private ⇒ nothing.
 * Open ⇒ error logged, repaired, re-checked. Still open ⇒ TLS_KEY_ACL_OPEN; ACL unreadable ⇒ TLS_KEY_ACL_UNVERIFIED
 * (fail closed: the caller starts no TLS listener).
 */
export function ensurePrivate(acl: KeyFileAcl | null, target: string, isDir: boolean): void {
  if (!acl) return;
  let open: boolean;
  try {
    open = acl.isOpen(target);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `${target}: cannot read its access list (${(e as Error)?.message ?? e})`);
  }
  if (!open) return;
  console.error(
    `[MQTT] ${isDir ? "Directory" : "Private key file"} ${target} is readable by ordinary local users ` +
      "(Users / Authenticated Users / Everyone) — restricting it to the server account, SYSTEM and Administrators.",
  );
  try {
    acl.restrict(target, isDir);
    open = acl.isOpen(target);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: readable by ordinary local users and could not be restricted (${(e as Error)?.message ?? e})`);
  }
  if (open) throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: still readable by ordinary local users after restricting it`);
}

/**
 * For what THIS process creates (the directory, the empty key file): ALWAYS remove inheritance and grant only the
 * server account / SYSTEM / Administrators — an inherited-private ACL would silently widen if the parent later
 * grants Users — then verify. Failure ⇒ TLS_KEY_ACL_OPEN / TLS_KEY_ACL_UNVERIFIED (fail closed).
 */
function makePrivate(acl: KeyFileAcl | null, target: string, isDir: boolean): void {
  if (!acl) return;
  try {
    acl.restrict(target, isDir);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: could not restrict its access list (${(e as Error)?.message ?? e})`);
  }
  ensurePrivate(acl, target, isDir);
}

/** Operator-provided certificate (MQTT_TLS_CERT + MQTT_TLS_KEY). The key file gets the same ACL check (Windows). */
export function loadConfiguredBrokerTls(certPath: string, keyPath: string, acl: KeyFileAcl | null = defaultKeyFileAcl()): BrokerTlsMaterial {
  const pair = parseBrokerTlsPair(readText(keyPath), readText(certPath), certPath);
  ensurePrivate(acl, keyPath, false);
  return materialFrom(pair, "configured", false, certPath);
}

/** fix 1 — a crash between writing the temp key file and linking it leaves `broker-tls.pem.<pid>.<rand>.tmp`. */
function sweepTempKeyFiles(dir: string): void {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (n.startsWith(`${SITE_TLS_FILE_NAME}.`) && n.endsWith(".tmp")) {
      try { fs.unlinkSync(path.join(dir, n)); } catch { /* another process is mid-write or it is gone */ }
    }
  }
}

/**
 * The site certificate in `dir`: loaded when present, generated ONLY when the file does not exist. A present
 * but bad file throws (never overwritten). Generation is exclusive: written to a private temp file, then
 * hard-linked to the final name (EEXIST ⇒ another process won ⇒ load its file).
 */
export function loadOrCreateSiteBrokerTls(opts: {
  dir: string;
  commonName?: string;
  days?: number;
  now?: Date;
  subjectAltNames?: SubjectAltNames;
  /** Windows ACL handling (default per platform; null = POSIX modes only). */
  acl?: KeyFileAcl | null;
}): BrokerTlsMaterial {
  const acl = opts.acl === undefined ? defaultKeyFileAcl() : opts.acl;
  const file = path.join(opts.dir, SITE_TLS_FILE_NAME);
  sweepTempKeyFiles(opts.dir);
  if (fs.existsSync(file)) {
    const text = readText(file);
    const material = materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
    ensurePrivate(acl, opts.dir, true);
    ensurePrivate(acl, file, false);
    return material;
  }
  const { keyPem, certPem } = mintSiteBrokerCertificate({
    commonName: opts.commonName ?? `AVI-AOI built-in MQTT broker (${os.hostname()})`,
    days: opts.days ?? 7300, // ~20 years: the pin, not the date, is the trust decision
    now: opts.now,
    subjectAltNames: opts.subjectAltNames ?? siteSubjectAltNames(),
  });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
    makePrivate(acl, opts.dir, true);
    // Windows: the EMPTY file is made private first, the key is written only afterwards (no readable window).
    fs.writeFileSync(tmp, "", { mode: 0o600, flag: "wx" });
    makePrivate(acl, tmp, false);
    fs.writeFileSync(tmp, keyPem + certPem, { flag: "r+" });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      const text = readText(file); // lost the race — the winner's certificate is the site certificate
      const won = materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
      ensurePrivate(acl, file, false);
      return won;
    }
  } catch (e) {
    if (e instanceof BrokerTlsError) throw e;
    throw new BrokerTlsError("TLS_WRITE_FAILED", `${file}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
  const text = readText(file);
  const material = materialFrom(parseBrokerTlsPair(text, text, file), "generated", true, file);
  ensurePrivate(acl, file, false); // the hard link shares the temp file's ACL — verified, not assumed
  return material;
}

/**
 * Resolve the TLS material the listener should use, per env. Throws BrokerTlsError when it cannot decide
 * safely (caller: do not start the TLS listener, show the error).
 */
export function resolveBrokerTls(env: NodeJS.ProcessEnv = process.env, acl: KeyFileAcl | null = defaultKeyFileAcl()): BrokerTlsMaterial {
  const cert = (env.MQTT_TLS_CERT || "").trim();
  const key = (env.MQTT_TLS_KEY || "").trim();
  if (cert || key) {
    if (!cert || !key) {
      throw new BrokerTlsError("TLS_CONFIG_INCOMPLETE", "MQTT_TLS_CERT and MQTT_TLS_KEY must both be set (or neither, to use the generated site certificate)");
    }
    return loadConfiguredBrokerTls(cert, key, acl);
  }
  return loadOrCreateSiteBrokerTls({ dir: mqttTlsDir(env), acl });
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
