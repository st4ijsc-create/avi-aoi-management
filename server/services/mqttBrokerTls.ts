/**
 * doc 81 Đợt 7 task J1 — TLS for the BUILT-IN (aedes) MQTT broker.
 *
 * Until Đợt 7 the tablet ↔ built-in broker link was plaintext (TCP 1883 / ws 8883): the device password of
 * Đợt 5 G1 crossed the LAN in clear. From Đợt 7 the broker also listens MQTT over TLS (MQTTS, `MQTT_TLS_PORT`,
 * default 8884) — ON BY DEFAULT whenever the broker runs:
 *   · a site certificate is GENERATED on first start (ECDSA P-256, self-signed) and stored OUTSIDE git, in
 *     `MQTT_TLS_DIR` (default `<cwd>/data/mqtt-tls/`, ignored by `/data/` in .gitignore). POSIX: file mode 0600 /
 *     dir 0700. WINDOWS (fix 1/2, ruling R-7-a — `mode` does nothing on NTFS; `data/` gives Authenticated Users
 *     Modify): ALLOW-LIST by SID — only the server's own account, SYSTEM and Administrators may OWN the folder / key /
 *     certificate or appear in ANY allow ACE. The folder is created non-recursively and its DACL is REPLACED (no
 *     inheritance, allow-list only) before any file is written; the empty key file likewise before the key is written.
 *     At every start the full descriptor (Get-Acl .Sddl, strict parser) of the folder and the key is checked:
 *     foreign owner ⇒ possibly PLANTED ⇒ refused, never adopted or repaired; other trustees with our own owner ⇒
 *     logged, DACL rebuilt from scratch, re-checked; null DACL / conditional or unknown ACE / unparseable or
 *     unreadable descriptor ⇒ unverified. Any of these ⇒ the TLS listener does NOT start (plaintext unaffected).
 *     MQTT_TLS_KEY / MQTT_TLS_CERT get the same owner check (and the key the DACL check).
 *   · the certificate names the host (subjectAltName: hostname, localhost, 127.0.0.1 and the LAN IPv4 addresses at
 *     generation time) so a client that validates normally can also use it; an EXISTING certificate is never
 *     regenerated to add them (that would change the fingerprint) — see DEPLOY_LAN_GUIDE for deliberate rotation;
 *   · leftover `broker-tls.pem.*.tmp` files (a crash between write and link) OLDER than 10 minutes are swept at start
 *     (a younger one may belong to a concurrent starter);
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
      | "TLS_KEY_ACL_UNVERIFIED"
      | "TLS_KEY_OWNER_FOREIGN",
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

// ── Windows security descriptor of the private key (fix 1 + fix 2, ruling R-7-a) ─────────────
/**
 * Who owns / may access the key material. POSIX keeps file modes (0600/0700) and passes `null`. On Windows the
 * default is {@link windowsKeyFileAcl}; tests inject a fake. ALLOW-LIST semantics (R-7-a): only the server's own
 * account, SYSTEM (S-1-5-18) and Administrators (S-1-5-32-544) may own the folder / key / certificate or appear in
 * ANY allow ACE. Everything else — another SID, a null DACL, a conditional / object / unknown ACE, a descriptor that
 * cannot be read or fully parsed — is refused (fail closed).
 */
export interface KeyFileAcl {
  /** SIDs allowed to own the key material and to appear in its DACL. */
  allowedSids(): string[];
  /** Full security descriptor as SDDL ("O:…G:…D:…"). Throws when it cannot be read. */
  readSddl(target: string): string;
  /** REPLACE the whole DACL with exactly the allowed set (protected: no inheritance). Throws on failure. */
  rebuild(target: string, isDir: boolean): void;
}

const SID_ALIAS: Record<string, string> = { SY: "S-1-5-18", BA: "S-1-5-32-544" };
const SID_RE = /^S-1-\d+(?:-\d+)+$/;

export interface ParsedDescriptor {
  /** Owner SID (aliases SY/BA expanded; any other alias kept as written ⇒ never allowed). */
  owner: string;
  /** Trustee of every ALLOW ACE (type A), aliases SY/BA expanded. Deny ACEs never grant and are not listed. */
  allowTrustees: string[];
}

export class SddlUnverifiable extends Error {}

function normTrustee(t: string): string {
  const u = t.trim().toUpperCase();
  return SID_ALIAS[u] ?? u;
}

/**
 * STRICT parser for the SDDL of a file/folder. Throws SddlUnverifiable for anything it cannot account for
 * completely: no owner, no DACL (a null DACL = Everyone full control), NO_ACCESS_CONTROL, unknown DACL flags,
 * stray text, unbalanced parentheses, a conditional ACE (nested parentheses), an ACE type other than A/D
 * (object, callback, conditional, mandatory-label, unknown) or a malformed ACE.
 */
export function parseSecurityDescriptor(sddl: string): ParsedDescriptor {
  const s = String(sddl ?? "").trim();
  // split into top-level components O: G: D: S: (only at depth 0)
  const parts: Record<string, string> = {};
  let i = 0;
  let depth = 0;
  let key: string | null = null;
  let start = 0;
  const flush = (end: number) => {
    if (key) {
      if (key in parts) throw new SddlUnverifiable(`duplicate ${key}: component`);
      parts[key] = s.slice(start, end);
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth < 0) throw new SddlUnverifiable("unbalanced parentheses");
    } else if (depth === 0 && /[OGDS]/.test(c) && s[i + 1] === ":" && (i === 0 || key !== null)) {
      // a component starts here only if the previous one can end here (SIDs/flags never contain ':')
      flush(i);
      key = c;
      start = i + 2;
      i += 2;
      continue;
    } else if (key === null) {
      throw new SddlUnverifiable("descriptor does not start with a component");
    }
    i++;
  }
  if (depth !== 0) throw new SddlUnverifiable("unbalanced parentheses");
  flush(s.length);

  const owner = parts.O;
  if (!owner) throw new SddlUnverifiable("no owner");
  const dacl = parts.D;
  if (dacl === undefined) throw new SddlUnverifiable("no DACL (a null DACL grants Everyone full control)");
  const firstAce = dacl.indexOf("(");
  const flags = firstAce < 0 ? dacl : dacl.slice(0, firstAce);
  if (/NO_ACCESS_CONTROL/i.test(flags)) throw new SddlUnverifiable("NO_ACCESS_CONTROL (null DACL)");
  if (!/^(?:P|AI|AR)*$/.test(flags)) throw new SddlUnverifiable(`unknown DACL flags "${flags}"`);
  const aceText = firstAce < 0 ? "" : dacl.slice(firstAce);
  const allowTrustees: string[] = [];
  let rest = aceText;
  while (rest.length) {
    const m = rest.match(/^\(([^()]*)\)/);
    if (!m) throw new SddlUnverifiable("unparseable or conditional ACE");
    const f = m[1].split(";");
    if (f.length !== 6) throw new SddlUnverifiable(`malformed ACE "${m[1]}"`);
    const type = f[0].toUpperCase();
    const trustee = normTrustee(f[5]);
    if (!trustee) throw new SddlUnverifiable(`ACE without trustee "${m[1]}"`);
    if (type === "A") allowTrustees.push(trustee);
    else if (type !== "D") throw new SddlUnverifiable(`ACE type "${f[0]}" not accepted`);
    rest = rest.slice(m[0].length);
  }
  return { owner: normTrustee(owner), allowTrustees };
}

function sys32(...p: string[]): string {
  return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", ...p);
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

/**
 * PowerShell scripts are CONSTANT strings; the path and the SDDL travel in environment variables of the child
 * process (never interpolated into a command line, never through a shell). `-NoProfile -NonInteractive`.
 */
const PS_READ = "$ErrorActionPreference='Stop'; (Get-Acl -LiteralPath $env:MQTT_TLS_ACL_PATH).Sddl";
const PS_REBUILD =
  "$ErrorActionPreference='Stop'; $p=$env:MQTT_TLS_ACL_PATH; $i=Get-Item -LiteralPath $p -Force; " +
  "if ($i -is [System.IO.DirectoryInfo]) { $s=New-Object System.Security.AccessControl.DirectorySecurity } " +
  "else { $s=New-Object System.Security.AccessControl.FileSecurity }; " +
  "$s.SetSecurityDescriptorSddlForm($env:MQTT_TLS_ACL_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); " +
  "$i.SetAccessControl($s)";

function powershell(script: string, env: Record<string, string>): string {
  return execFileSync(sys32("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Windows implementation: Get-Acl (.Sddl) to read; a whole new DACL via SetAccessControl to rebuild. */
export const windowsKeyFileAcl: KeyFileAcl = {
  allowedSids: () => [currentAccountSid(), "S-1-5-18", "S-1-5-32-544"],
  readSddl(target) {
    return powershell(PS_READ, { MQTT_TLS_ACL_PATH: target }).trim();
  },
  rebuild(target, isDir) {
    const inh = isDir ? "OICI" : "";
    const sddl = `D:PAI(A;${inh};FA;;;${currentAccountSid()})(A;${inh};FA;;;SY)(A;${inh};FA;;;BA)`;
    powershell(PS_REBUILD, { MQTT_TLS_ACL_PATH: target, MQTT_TLS_ACL_SDDL: sddl });
  },
};

export function defaultKeyFileAcl(platform: NodeJS.Platform = process.platform): KeyFileAcl | null {
  return platform === "win32" ? windowsKeyFileAcl : null;
}

type Inspection = { ownerOk: boolean; private: boolean; owner: string; strangers: string[] };

function inspect(acl: KeyFileAcl, target: string): Inspection {
  let d: ParsedDescriptor;
  let allowed: Set<string>;
  try {
    allowed = new Set(acl.allowedSids().map(normTrustee));
    d = parseSecurityDescriptor(acl.readSddl(target));
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `${target}: cannot verify its owner/access list (${(e as Error)?.message ?? e})`);
  }
  const strangers = [...new Set(d.allowTrustees.filter((t) => !allowed.has(t)))];
  return { ownerOk: allowed.has(d.owner) && SID_RE.test(d.owner), private: strangers.length === 0, owner: d.owner, strangers };
}

/**
 * The owner MUST be the server account / SYSTEM / Administrators — otherwise the material may have been PLANTED
 * (data/ lets Authenticated Users create files): refuse (TLS_KEY_OWNER_FOREIGN), never adopt, never "repair" it.
 * Owner fine but other trustees present ⇒ error logged, DACL rebuilt from scratch (only if `repair`), re-checked;
 * still open ⇒ TLS_KEY_ACL_OPEN. Descriptor unreadable / not fully parseable ⇒ TLS_KEY_ACL_UNVERIFIED.
 */
export function ensurePrivate(acl: KeyFileAcl | null, target: string, isDir: boolean, repair = true): void {
  if (!acl) return;
  const first = inspect(acl, target);
  if (!first.ownerOk) {
    console.error(`[MQTT] ${target} is owned by ${first.owner}, not by the server account / SYSTEM / Administrators — possibly planted; MQTTS NOT started.`);
    throw new BrokerTlsError("TLS_KEY_OWNER_FOREIGN", `${target}: owned by ${first.owner} (not the server account / SYSTEM / Administrators)`);
  }
  if (first.private) return;
  if (!repair) throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: also accessible to ${first.strangers.join(", ")}`);
  console.error(
    `[MQTT] ${isDir ? "Directory" : "Key file"} ${target} is accessible to ${first.strangers.join(", ")} — rebuilding its ` +
      "access list: server account, SYSTEM, Administrators only.",
  );
  try {
    acl.rebuild(target, isDir);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: could not rebuild its access list (${(e as Error)?.message ?? e})`);
  }
  const again = inspect(acl, target);
  if (!again.ownerOk || !again.private) {
    throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: still accessible to ${again.strangers.join(", ") || "a foreign owner"} after rebuilding`);
  }
}

/** For what THIS process created: ALWAYS rebuild the DACL (no inheritance, allow-list only), then verify incl. owner. */
function makePrivate(acl: KeyFileAcl | null, target: string, isDir: boolean): void {
  if (!acl) return;
  try {
    acl.rebuild(target, isDir);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${target}: could not set its access list (${(e as Error)?.message ?? e})`);
  }
  ensurePrivate(acl, target, isDir, false);
}

/**
 * Operator-provided certificate (MQTT_TLS_CERT + MQTT_TLS_KEY). Windows: both files must be owned by the server
 * account / SYSTEM / Administrators; the KEY must also be private (rebuilt when only its DACL is too wide).
 */
export function loadConfiguredBrokerTls(certPath: string, keyPath: string, acl: KeyFileAcl | null = defaultKeyFileAcl()): BrokerTlsMaterial {
  const keyText = readText(keyPath); // missing/unreadable ⇒ TLS_FILE_UNREADABLE (clearer than "cannot verify")
  const certText = readText(certPath);
  ensurePrivate(acl, keyPath, false);
  if (acl && !inspect(acl, certPath).ownerOk) {
    throw new BrokerTlsError("TLS_KEY_OWNER_FOREIGN", `${certPath}: certificate owned by a foreign account`);
  }
  const pair = parseBrokerTlsPair(keyText, certText, certPath);
  return materialFrom(pair, "configured", false, certPath);
}

/** A temp key file older than this is a crash leftover; younger ones may belong to a concurrent starter (fix 2, N3). */
export const TEMP_KEY_SWEEP_AGE_MS = 10 * 60_000;

/** fix 1/2 — remove `broker-tls.pem.<pid>.<rand>.tmp` crash leftovers, but only those older than TEMP_KEY_SWEEP_AGE_MS. */
function sweepTempKeyFiles(dir: string, now = Date.now()): void {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!(n.startsWith(`${SITE_TLS_FILE_NAME}.`) && n.endsWith(".tmp"))) continue;
    const p = path.join(dir, n);
    try {
      if (now - fs.statSync(p).mtimeMs >= TEMP_KEY_SWEEP_AGE_MS) fs.unlinkSync(p);
    } catch { /* gone, or another process is handling it */ }
  }
}

/**
 * The site certificate in `dir`: loaded when present, generated ONLY when the file does not exist. A present
 * but bad file throws (never overwritten). The folder is created NON-recursively and made private before any file
 * is written; a pre-existing folder (or file) must be owned by the server account / SYSTEM / Administrators.
 * Generation is exclusive: written to a private temp file, then hard-linked to the final name (EEXIST ⇒ another
 * process — or a planter — got there first ⇒ that file is verified like any existing one).
 */
export function loadOrCreateSiteBrokerTls(opts: {
  dir: string;
  commonName?: string;
  days?: number;
  now?: Date;
  subjectAltNames?: SubjectAltNames;
  /** Windows security handling (default per platform; null = POSIX modes only). */
  acl?: KeyFileAcl | null;
}): BrokerTlsMaterial {
  const acl = opts.acl === undefined ? defaultKeyFileAcl() : opts.acl;
  const file = path.join(opts.dir, SITE_TLS_FILE_NAME);
  let createdDir = false;
  try {
    fs.mkdirSync(path.dirname(opts.dir), { recursive: true });
    fs.mkdirSync(opts.dir, { mode: 0o700 }); // NON-recursive: tells us whether THIS process created it
    createdDir = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") {
      throw new BrokerTlsError("TLS_WRITE_FAILED", `${opts.dir}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
    }
  }
  if (createdDir) makePrivate(acl, opts.dir, true);
  else ensurePrivate(acl, opts.dir, true); // pre-existing folder: foreign owner ⇒ refuse; wide DACL ⇒ rebuilt
  sweepTempKeyFiles(opts.dir);

  if (fs.existsSync(file)) {
    ensurePrivate(acl, file, false); // planted (foreign owner) ⇒ refused BEFORE it is even read
    const text = readText(file);
    return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
  }
  const { keyPem, certPem } = mintSiteBrokerCertificate({
    commonName: opts.commonName ?? `AVI-AOI built-in MQTT broker (${os.hostname()})`,
    days: opts.days ?? 7300, // ~20 years: the pin, not the date, is the trust decision
    now: opts.now,
    subjectAltNames: opts.subjectAltNames ?? siteSubjectAltNames(),
  });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    // Windows: the EMPTY file is made private first, the key is written only afterwards (no readable window).
    fs.writeFileSync(tmp, "", { mode: 0o600, flag: "wx" });
    makePrivate(acl, tmp, false);
    fs.writeFileSync(tmp, keyPem + certPem, { flag: "r+" });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // lost the race (or a file was planted meanwhile): verify it exactly like an existing one
      ensurePrivate(acl, file, false);
      const text = readText(file);
      return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
    }
  } catch (e) {
    if (e instanceof BrokerTlsError) throw e;
    throw new BrokerTlsError("TLS_WRITE_FAILED", `${file}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
  ensurePrivate(acl, file, false, false); // the hard link shares the temp file's descriptor — verified, not assumed
  const text = readText(file);
  return materialFrom(parseBrokerTlsPair(text, text, file), "generated", true, file);
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
