/**
 * doc 81 Đợt 7 task J1 — TLS for the BUILT-IN (aedes) MQTT broker.
 *
 * Until Đợt 7 the tablet ↔ built-in broker link was plaintext (TCP 1883 / ws 8883): the device password of
 * Đợt 5 G1 crossed the LAN in clear. From Đợt 7 the broker also listens MQTT over TLS (MQTTS, `MQTT_TLS_PORT`,
 * default 8884) — ON BY DEFAULT whenever the broker runs:
 *   · a site certificate is GENERATED on first start (ECDSA P-256, self-signed) and stored OUTSIDE git, in
 *     `MQTT_TLS_DIR` (default `<cwd>/data/mqtt-tls/`, ignored by `/data/` in .gitignore). POSIX: file mode 0600 /
 *     dir 0700. WINDOWS (fix 1/2/3, rulings R-7-a + R-7-b — `mode` does nothing on NTFS; `data/` gives Authenticated
 *     Users Modify): ALLOW-LIST by full SID — only the server's own account, SYSTEM and Administrators may OWN the folder
 *     / key / certificate or appear in ANY allow ACE, and the DACL must be PROTECTED. FIRST start: the key is built in a
 *     staging folder created non-recursively WITH its DACL (no window), verified EMPTY before the key is written, then renamed
 *     into place (no open window, nothing planted). EVERY start: the key file is opened ONCE and its owner, DACL, link
 *     count and reparse attribute are checked through that handle, and the bytes are read from that same handle.
 *     Foreign owner / hard link / reparse point ⇒ refused and NEVER touched or adopted. A NULL DACL or any stranger
 *     allow ACE ⇒ "key may be exposed": the DACL is rebuilt to stop further access and TLS is STILL refused — the key
 *     must be rotated (DEPLOY_LAN_GUIDE). Unverifiable / unprotected ⇒ locked down and refused for this start. All
 *     Windows calls are async with a timeout (a timeout ⇒ refuse); the plaintext listeners are never affected.
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
import { execFile } from "node:child_process";
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
      | "TLS_KEY_ACL_UNPROTECTED"
      | "TLS_KEY_OWNER_FOREIGN"
      | "TLS_KEY_EXPOSED"
      | "TLS_KEY_LINKED"
      | "TLS_KEY_DIR_NOT_EMPTY",
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

// ── Windows security of the key material (fix 1/2/3, rulings R-7-a + R-7-b) ──────────────────────────────────
/**
 * Owner / DACL / link facts of one object, as reported through ITS OWN HANDLE (files) or by path (folders).
 * Every SID is a full SID (no SDDL aliases — LocalService, NetworkService, the built-in Administrator all compare by
 * value). `aces` lists every DACL entry with its .NET AceType name; anything other than AccessAllowed/AccessDenied is
 * unverifiable.
 */
export interface DescriptorFacts {
  owner: string;
  protectedDacl: boolean;
  /** false = NULL DACL (Everyone full control). */
  daclPresent: boolean;
  aces: Array<{ type: string; sid: string }>;
  /** Win32 attributes of the PATH itself (not followed): 0x400 = reparse point (symlink, junction…). */
  pathAttributes: number;
}
export interface FileFacts extends DescriptorFacts {
  /** NumberOfLinks from the open handle — > 1 means a hard link elsewhere shares this file (and its DACL). */
  links: number;
  /** Win32 attributes from the open handle. */
  attributes: number;
  /** The bytes, read from the SAME handle that was checked (opened once, FileShare.Read: nobody writes meanwhile). */
  content: Buffer;
}

/**
 * Windows access to the key material. Every method is ASYNC with a timeout (fix 3, F5): a hang or timeout throws ⇒ the
 * caller refuses TLS; nothing here ever blocks the event loop. Tests inject a fake.
 */
export interface KeyFileAcl {
  /** Full SIDs allowed to own the key material and to appear in ANY allow ACE: the server account, SYSTEM, Administrators. */
  allowedSids(): Promise<string[]>;
  /** Facts of a FOLDER (by path; the path's own reparse attribute is reported, never followed for the descriptor). */
  inspectDir(dir: string): Promise<DescriptorFacts>;
  /** Open the FILE once, report its facts through that handle and its content from the same handle. */
  inspectAndReadFile(file: string): Promise<FileFacts>;
  /** REPLACE the whole DACL with exactly the allowed set (protected, no inheritance). */
  rebuild(target: string, isDir: boolean): Promise<void>;
  /**
   * Create a NEW folder whose protected allow-list DACL is set AT CREATION (CreateDirectory with a security descriptor):
   * there is no moment in which it inherits anything. Rejects if it cannot.
   */
  createPrivateDir(dir: string): Promise<void>;
}

const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const SID_RE = /^S-1-\d+(?:-\d+)+$/;
const ACE_TYPES_ACCEPTED = new Set(["AccessAllowed", "AccessDenied"]);
/** Largest key/certificate file we read (a PEM pair is ~1 KB). */
const MAX_TLS_FILE_BYTES = 64 * 1024;

/**
 * STRICT parser for the report lines the PowerShell helpers print (format below). Anything missing, duplicated,
 * malformed or unknown throws — the caller turns that into TLS_KEY_ACL_UNVERIFIED.
 */
export function parseFactsReport(text: string, kind: "dir" | "file"): DescriptorFacts | FileFacts {
  const one: Record<string, string> = {};
  const aces: Array<{ type: string; sid: string }> = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Z]+)=(.*)$/);
    if (!m) throw new Error(`unexpected report line "${line.slice(0, 80)}"`);
    if (m[1] === "ACE") {
      const a = m[2].match(/^([A-Za-z]+)\|(S-1-\d+(?:-\d+)+|\?)$/);
      if (!a) throw new Error(`malformed ACE line "${m[2].slice(0, 80)}"`);
      aces.push({ type: a[1], sid: a[2] });
    } else {
      if (m[1] in one) throw new Error(`duplicate ${m[1]}`);
      one[m[1]] = m[2];
    }
  }
  const need = kind === "file" ? ["OWNER", "PROTECTED", "DACL", "PATHATTRS", "LINKS", "ATTRS", "CONTENT"] : ["OWNER", "PROTECTED", "DACL", "PATHATTRS"];
  for (const k of need) if (!(k in one)) throw new Error(`report lacks ${k}`);
  for (const k of Object.keys(one)) if (!need.includes(k)) throw new Error(`unexpected ${k}`);
  if (!SID_RE.test(one.OWNER)) throw new Error("owner is not a SID");
  if (!/^[01]$/.test(one.PROTECTED)) throw new Error("bad PROTECTED");
  if (one.DACL !== "present" && one.DACL !== "null") throw new Error("bad DACL");
  if (one.DACL === "null" && aces.length) throw new Error("ACEs reported for a null DACL");
  const int = (k: string) => {
    if (!/^\d{1,10}$/.test(one[k])) throw new Error(`bad ${k}`);
    return Number(one[k]);
  };
  const facts: DescriptorFacts = {
    owner: one.OWNER,
    protectedDacl: one.PROTECTED === "1",
    daclPresent: one.DACL === "present",
    aces,
    pathAttributes: int("PATHATTRS"),
  };
  if (kind === "dir") return facts;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(one.CONTENT)) throw new Error("bad CONTENT");
  return { ...facts, links: int("LINKS"), attributes: int("ATTRS"), content: Buffer.from(one.CONTENT, "base64") };
}

export type MaterialVerdict = "ok" | "reparse" | "hardlink" | "foreign-owner" | "exposed" | "unverified" | "unprotected";

/**
 * What the facts mean (order matters): a reparse point or a second hard link is never touched; a foreign owner is
 * never adopted or repaired; a NULL DACL or any allow ACE for a SID outside the allow-list = EXPOSED (it may have been
 * read or written); an ACE type we cannot evaluate = unverified; an unprotected DACL = unprotected (inheritance could
 * widen it later).
 */
export function classifyFacts(f: DescriptorFacts | FileFacts, allowed: ReadonlySet<string>): MaterialVerdict {
  if ((f.pathAttributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) return "reparse";
  if ("attributes" in f && (f.attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) return "reparse";
  if ("links" in f && f.links !== 1) return "hardlink";
  if (!allowed.has(f.owner)) return "foreign-owner";
  if (!f.daclPresent) return "exposed";
  if (f.aces.some((a) => a.type === "AccessAllowed" && !allowed.has(a.sid))) return "exposed";
  if (f.aces.some((a) => !ACE_TYPES_ACCEPTED.has(a.type) || a.sid === "?")) return "unverified";
  if (!f.protectedDacl) return "unprotected";
  return "ok";
}

function sys32(...p: string[]): string {
  return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", ...p);
}

/** Per-call timeout for the Windows helpers (whoami / PowerShell). A timeout ⇒ refuse TLS. */
export function aclTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MQTT_TLS_ACL_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 && n <= 60_000 ? Math.floor(n) : 10_000;
}

/** Async execFile (no shell, absolute path) with a hard timeout; rejects on non-zero exit, kill or timeout. */
export function runBounded(file: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", windowsHide: true, timeout: aclTimeoutMs(), killSignal: "SIGKILL", maxBuffer: 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          reject(new Error(e.killed || e.signal ? `timed out after ${aclTimeoutMs()} ms` : `${path.basename(file)} failed: ${e.code ?? e.message}`));
        } else resolve(String(stdout));
      },
    );
  });
}

let cachedSid: Promise<string> | null = null;
/** SID of the account this server runs as (`whoami /user` reads the process token: S-1-5-18 / -19 / -20 / a user SID). */
function currentAccountSid(): Promise<string> {
  if (!cachedSid) {
    cachedSid = runBounded(sys32("whoami.exe"), ["/user", "/fo", "csv", "/nh"]).then((out) => {
      const sid = out.match(/"(S-1-[0-9-]+)"\s*$/m)?.[1];
      if (!sid) throw new Error("cannot determine the server account SID");
      return sid;
    });
    cachedSid.catch(() => { cachedSid = null; });
  }
  return cachedSid;
}

/**
 * PowerShell helpers: CONSTANT scripts, the path / SDDL in environment variables of the child (never on a command line,
 * never through a shell), `-NoProfile -NonInteractive`, `$ErrorActionPreference='Stop'` ⇒ any failure = non-zero exit.
 * The descriptor is converted to a RawSecurityDescriptor so every trustee is printed as a full SID with its AceType.
 */
const PS_REPORT_SD =
  "function Report($bin){ $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor -ArgumentList @($bin, 0); " +
  "'OWNER=' + $sd.Owner.Value; " +
  "'PROTECTED=' + [int](($sd.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0); " +
  "if ($sd.DiscretionaryAcl -eq $null) { 'DACL=null' } else { 'DACL=present'; foreach ($a in $sd.DiscretionaryAcl) { " +
  "if ($a -is [System.Security.AccessControl.KnownAce]) { 'ACE=' + $a.AceType + '|' + $a.SecurityIdentifier.Value } else { 'ACE=' + $a.AceType + '|?' } } } }; ";
const PS_INSPECT_DIR =
  "$ErrorActionPreference='Stop'; " + PS_REPORT_SD +
  "$p=$env:MQTT_TLS_ACL_PATH; $i=Get-Item -LiteralPath $p -Force; if (-not ($i -is [System.IO.DirectoryInfo])) { throw 'not a directory' }; " +
  "Report ((Get-Acl -LiteralPath $p).GetSecurityDescriptorBinaryForm()); 'PATHATTRS=' + [int]$i.Attributes";
const PS_INSPECT_READ_FILE =
  "$ErrorActionPreference='Stop'; " + PS_REPORT_SD +
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; " +
  "public static class MqttTlsJ7 { [StructLayout(LayoutKind.Sequential)] public struct BHFI { public uint Attributes; " +
  "public uint C1, C2, A1, A2, W1, W2; public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; " +
  "public uint IndexHigh; public uint IndexLow; } [DllImport(\"kernel32.dll\", SetLastError = true)] public static extern bool " +
  "GetFileInformationByHandle(SafeFileHandle h, out BHFI info); }'; " +
  "$p=$env:MQTT_TLS_ACL_PATH; $pa=[int](Get-Item -LiteralPath $p -Force).Attributes; " +
  "$fs=[System.IO.File]::Open($p, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); " +
  "try { $info=New-Object MqttTlsJ7+BHFI; if (-not [MqttTlsJ7]::GetFileInformationByHandle($fs.SafeFileHandle, [ref]$info)) { throw 'GetFileInformationByHandle failed' }; " +
  "Report ($fs.GetAccessControl().GetSecurityDescriptorBinaryForm()); 'PATHATTRS=' + $pa; 'LINKS=' + $info.Links; 'ATTRS=' + $info.Attributes; " +
  `$len=[int]$fs.Length; if ($len -gt ${MAX_TLS_FILE_BYTES}) { throw 'file too large' }; $buf=New-Object byte[] $len; $n=0; ` +
  "while ($n -lt $len) { $r=$fs.Read($buf, $n, $len - $n); if ($r -le 0) { break }; $n+=$r }; " +
  "'CONTENT=' + [Convert]::ToBase64String($buf, 0, $n) } finally { $fs.Dispose() }";
const PS_REBUILD =
  "$ErrorActionPreference='Stop'; $p=$env:MQTT_TLS_ACL_PATH; $i=Get-Item -LiteralPath $p -Force; " +
  "if ($i -is [System.IO.DirectoryInfo]) { $s=New-Object System.Security.AccessControl.DirectorySecurity } " +
  "else { $s=New-Object System.Security.AccessControl.FileSecurity }; " +
  "$s.SetSecurityDescriptorSddlForm($env:MQTT_TLS_ACL_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); " +
  "$i.SetAccessControl($s)";

const PS_CREATE_PRIVATE_DIR =
  "$ErrorActionPreference='Stop'; $p=$env:MQTT_TLS_ACL_PATH; if (Test-Path -LiteralPath $p) { throw 'already exists' }; " +
  "$s=New-Object System.Security.AccessControl.DirectorySecurity; " +
  "$s.SetSecurityDescriptorSddlForm($env:MQTT_TLS_ACL_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); " +
  "[void][System.IO.Directory]::CreateDirectory($p, $s)";

function powershell(script: string, env: Record<string, string>): Promise<string> {
  return runBounded(sys32("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], env);
}

/** Windows implementation (PowerShell + .NET; see the scripts above). */
export const windowsKeyFileAcl: KeyFileAcl = {
  allowedSids: async () => [await currentAccountSid(), "S-1-5-18", "S-1-5-32-544"],
  async inspectDir(dir) {
    return parseFactsReport(await powershell(PS_INSPECT_DIR, { MQTT_TLS_ACL_PATH: dir }), "dir");
  },
  async inspectAndReadFile(file) {
    return parseFactsReport(await powershell(PS_INSPECT_READ_FILE, { MQTT_TLS_ACL_PATH: file }), "file") as FileFacts;
  },
  async rebuild(target, isDir) {
    const inh = isDir ? "OICI" : "";
    const sid = await currentAccountSid();
    const sddl = `D:PAI(A;${inh};FA;;;${sid})(A;${inh};FA;;;SY)(A;${inh};FA;;;BA)`;
    await powershell(PS_REBUILD, { MQTT_TLS_ACL_PATH: target, MQTT_TLS_ACL_SDDL: sddl });
  },
  async createPrivateDir(dir) {
    const sid = await currentAccountSid();
    const sddl = `D:PAI(A;OICI;FA;;;${sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
    await powershell(PS_CREATE_PRIVATE_DIR, { MQTT_TLS_ACL_PATH: dir, MQTT_TLS_ACL_SDDL: sddl });
  },
};

export function defaultKeyFileAcl(platform: NodeJS.Platform = process.platform): KeyFileAcl | null {
  return platform === "win32" ? windowsKeyFileAcl : null;
}

const VERDICT_CODE: Record<Exclude<MaterialVerdict, "ok">, BrokerTlsError["code"]> = {
  reparse: "TLS_KEY_LINKED",
  hardlink: "TLS_KEY_LINKED",
  "foreign-owner": "TLS_KEY_OWNER_FOREIGN",
  exposed: "TLS_KEY_EXPOSED",
  unverified: "TLS_KEY_ACL_UNVERIFIED",
  unprotected: "TLS_KEY_ACL_UNPROTECTED",
};

/**
 * Enforce a verdict on EXISTING material (R-7-b). ok ⇒ return. reparse / hard link / foreign owner ⇒ refuse WITHOUT
 * touching it (a rebuild through a hard link would rewrite another file's DACL; a foreign object is never adopted).
 * exposed / unverified / unprotected with our own owner ⇒ the DACL is rebuilt to stop any further access, and TLS is
 * STILL refused — a key that strangers could read or write is never used again ("rotate"). `repair=false` (operator
 * folders) refuses without rebuilding.
 */
/**
 * R-7-b — "never use a key after repairing it", ACROSS restarts: once exposure was seen, a marker is written (after the
 * lock-down) and every later start refuses until the key is rotated. Site material: `<dir>/ROTATE-REQUIRED` (rotation =
 * move the whole folder away, restart). Operator key: `<MQTT_TLS_KEY>.ROTATE-REQUIRED` (rotation = new key, remove marker).
 */
export const ROTATE_MARKER = "ROTATE-REQUIRED";

function writeRotateMarker(markerPath: string, why: string): void {
  try {
    fs.writeFileSync(markerPath, `${new Date().toISOString()} ${why}
`, { flag: "a", mode: 0o600 });
  } catch (e) {
    console.error(`[MQTT] could not write ${markerPath} (${(e as Error)?.message ?? e}) — rotate the TLS key before the next start`);
  }
}

function refuseIfRotationPending(markerPath: string): void {
  if (fs.existsSync(markerPath)) {
    console.error(`[MQTT] ${markerPath} exists — the TLS key was found exposed earlier and has not been rotated. MQTTS NOT started.`);
    throw new BrokerTlsError("TLS_KEY_EXPOSED", `${markerPath}: key exposure recorded earlier — rotate the key`);
  }
}

async function enforce(
  acl: KeyFileAcl,
  target: string,
  isDir: boolean,
  verdict: MaterialVerdict,
  repair: boolean,
  markerPath?: string,
): Promise<void> {
  if (verdict === "ok") return;
  const code = VERDICT_CODE[verdict];
  const what = isDir ? "folder" : "file";
  if (verdict === "exposed") {
    console.error(`[MQTT] TLS ${what} ${target} was accessible to accounts outside the server account / SYSTEM / Administrators — the key may be exposed: ROTATE it (DEPLOY_LAN_GUIDE). MQTTS NOT started.`);
  } else {
    console.error(`[MQTT] TLS ${what} ${target}: ${verdict} — MQTTS NOT started.`);
  }
  const mayRebuild = repair && (verdict === "exposed" || verdict === "unverified" || verdict === "unprotected");
  if (mayRebuild) {
    try {
      await acl.rebuild(target, isDir);
    } catch (e) {
      console.error(`[MQTT] could not rebuild the access list of ${target}: ${(e as Error)?.message ?? e}`);
    }
  }
  if (verdict === "exposed" && markerPath) writeRotateMarker(markerPath, `exposed: ${target}`);
  throw new BrokerTlsError(code, `${target}: ${verdict}${verdict === "exposed" ? " — key may be exposed, rotate it" : ""}`);
}

async function allowedSet(acl: KeyFileAcl): Promise<Set<string>> {
  try {
    return new Set(await acl.allowedSids());
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `cannot determine the server account (${(e as Error)?.message ?? e})`);
  }
}

async function checkDir(acl: KeyFileAcl, allowed: Set<string>, dir: string, repair: boolean, markerPath?: string): Promise<void> {
  let facts: DescriptorFacts;
  try {
    facts = await acl.inspectDir(dir);
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `${dir}: cannot verify (${(e as Error)?.message ?? e})`);
  }
  await enforce(acl, dir, true, classifyFacts(facts, allowed), repair, markerPath);
}

/** Check a key/cert FILE through its own handle and return the bytes read from that handle. */
async function checkAndReadFile(acl: KeyFileAcl, allowed: Set<string>, file: string, repair: boolean, markerPath?: string): Promise<Buffer> {
  let facts: FileFacts;
  try {
    facts = await acl.inspectAndReadFile(file);
  } catch (e) {
    if ((e as Error)?.message?.includes("Could not find") || !fs.existsSync(file)) {
      throw new BrokerTlsError("TLS_FILE_UNREADABLE", `${file}: not found or not readable`);
    }
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `${file}: cannot verify (${(e as Error)?.message ?? e})`);
  }
  await enforce(acl, file, false, classifyFacts(facts, allowed), repair, markerPath);
  return facts.content;
}

/**
 * A NEW staging folder: created WITH its protected allow-list DACL (no open window), then verified (owner ours — a
 * pre-existing object with that random name would show a foreign owner — protected, allow-list) AND empty.
 */
async function createLockedDir(acl: KeyFileAcl, allowed: Set<string>, dir: string): Promise<void> {
  try {
    await acl.createPrivateDir(dir);
  } catch (e) {
    throw new BrokerTlsError("TLS_WRITE_FAILED", `${dir}: could not create the private folder (${(e as Error)?.message ?? e})`);
  }
  await checkDir(acl, allowed, dir, false);
  if (fs.readdirSync(dir).length !== 0) {
    throw new BrokerTlsError("TLS_KEY_DIR_NOT_EMPTY", `${dir}: something was created in the new folder before it was locked down — refusing`);
  }
}

/**
 * Operator-provided certificate (MQTT_TLS_CERT + MQTT_TLS_KEY). Windows: both FILES must pass every rule (owner,
 * allow-list, protected DACL, single link, no reparse) — an exposed one is locked down and refused; both FOLDERS must
 * be owned by an allowed account with no stranger allow ACE (refused, NOT modified: they are the operator's folders).
 */
export async function loadConfiguredBrokerTls(certPath: string, keyPath: string, acl: KeyFileAcl | null = defaultKeyFileAcl()): Promise<BrokerTlsMaterial> {
  if (!acl) {
    const pair = parseBrokerTlsPair(readText(keyPath), readText(certPath), certPath);
    return materialFrom(pair, "configured", false, certPath);
  }
  const allowed = await allowedSet(acl);
  for (const d of new Set([path.dirname(path.resolve(keyPath)), path.dirname(path.resolve(certPath))])) {
    let facts: DescriptorFacts;
    try {
      facts = await acl.inspectDir(d);
    } catch (e) {
      throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `${d}: cannot verify (${(e as Error)?.message ?? e})`);
    }
    const v = classifyFacts(facts, allowed);
    if (v !== "ok" && v !== "unprotected") await enforce(acl, d, true, v, false);
  }
  const marker = `${path.resolve(keyPath)}.${ROTATE_MARKER}`;
  refuseIfRotationPending(marker);
  const keyText = (await checkAndReadFile(acl, allowed, keyPath, true, marker)).toString("utf8");
  const certText = (await checkAndReadFile(acl, allowed, certPath, true, marker)).toString("utf8");
  return materialFrom(parseBrokerTlsPair(keyText, certText, certPath), "configured", false, certPath);
}

/** A leftover older than this is a crash leftover; a younger one may belong to a concurrent starter. */
export const TEMP_KEY_SWEEP_AGE_MS = 10 * 60_000;

/** Remove crash leftovers older than TEMP_KEY_SWEEP_AGE_MS: `broker-tls.pem.*.tmp` (≤ fix 2) and staging folders. */
function sweepLeftovers(dir: string, now = Date.now()): void {
  const parent = path.dirname(dir);
  const stagingPrefix = `${path.basename(dir)}.`;
  const zones: Array<[string, (n: string) => boolean]> = [
    [dir, (n) => n.startsWith(`${SITE_TLS_FILE_NAME}.`) && n.endsWith(".tmp")],
    [parent, (n) => n.startsWith(stagingPrefix) && n.endsWith(".new")],
  ];
  for (const [where, match] of zones) {
    let names: string[] = [];
    try { names = fs.readdirSync(where); } catch { continue; }
    for (const n of names) {
      if (!match(n)) continue;
      const p = path.join(where, n);
      try {
        const st = fs.lstatSync(p);
        if (now - st.mtimeMs >= TEMP_KEY_SWEEP_AGE_MS && !st.isSymbolicLink()) fs.rmSync(p, { recursive: true, force: true });
      } catch { /* gone, or another process is handling it */ }
    }
  }
}

/**
 * The site certificate in `dir`: loaded when present, generated ONLY when absent; a present but bad file is never
 * overwritten. Windows (R-7-a/R-7-b):
 *   · FIRST start: the key is generated inside a STAGING folder `<dir>.<pid>.<rand>.new` created non-recursively WITH
 *     its protected allow-list DACL (CreateDirectory + security descriptor — no window in which it inherits anything),
 *     verified (owner, DACL) and EMPTY before the key is written; the finished folder is then renamed into place. A
 *     folder that appears meanwhile (rename fails) is treated as existing.
 *   · EXISTING folder/file: checked through the file's own handle (owner, allow-list, protected DACL, single link, no
 *     reparse point) and read from that same handle. Anything exposed is locked down and REFUSED (rotate).
 */
export async function loadOrCreateSiteBrokerTls(opts: {
  dir: string;
  commonName?: string;
  days?: number;
  now?: Date;
  subjectAltNames?: SubjectAltNames;
  /** Windows security handling (default per platform; null = POSIX modes only). */
  acl?: KeyFileAcl | null;
}): Promise<BrokerTlsMaterial> {
  const acl = opts.acl === undefined ? defaultKeyFileAcl() : opts.acl;
  const dir = path.resolve(opts.dir);
  const file = path.join(dir, SITE_TLS_FILE_NAME);
  const mint = () =>
    mintSiteBrokerCertificate({
      commonName: opts.commonName ?? `AVI-AOI built-in MQTT broker (${os.hostname()})`,
      days: opts.days ?? 7300, // ~20 years: the pin, not the date, is the trust decision
      now: opts.now,
      subjectAltNames: opts.subjectAltNames ?? siteSubjectAltNames(),
    });
  if (!acl) return loadOrCreatePosix(dir, file, mint);

  const allowed = await allowedSet(acl);
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
  } catch (e) {
    throw new BrokerTlsError("TLS_WRITE_FAILED", `${path.dirname(dir)}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
  }
  sweepLeftovers(dir);

  if (!fs.existsSync(dir)) {
    // FIRST start: build everything in a private staging folder, then rename it into place.
    const staging = `${dir}.${process.pid}.${randomBytes(6).toString("hex")}.new`;
    try {
      await createLockedDir(acl, allowed, staging); // non-recursive, fresh random name, DACL set at creation
      const material = await writeNewKey(acl, allowed, path.join(staging, SITE_TLS_FILE_NAME), mint);
      try {
        fs.renameSync(staging, dir);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY" && code !== "EACCES") throw e;
        // another starter (or someone else) created <dir> meanwhile: verify it like any existing one below
        fs.rmSync(staging, { recursive: true, force: true });
        return loadExisting(acl, allowed, dir, file, mint);
      }
      return { ...material, file };
    } catch (e) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
      if (e instanceof BrokerTlsError) throw e;
      throw new BrokerTlsError("TLS_WRITE_FAILED", `${dir}: ${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}`);
    }
  }
  return loadExisting(acl, allowed, dir, file, mint);
}

async function loadExisting(acl: KeyFileAcl, allowed: Set<string>, dir: string, file: string, mint: () => { keyPem: string; certPem: string }): Promise<BrokerTlsMaterial> {
  const marker = path.join(dir, ROTATE_MARKER);
  // foreign owner / reparse ⇒ refused untouched; exposed ⇒ locked down + marker + refused
  await checkDir(acl, allowed, dir, true, marker);
  refuseIfRotationPending(marker);
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(file); } catch { st = null; }
  if (st) {
    const text = (await checkAndReadFile(acl, allowed, file, true, marker)).toString("utf8");
    return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
  }
  // a verified, private, protected folder without a key (e.g. moved away on purpose): generate inside it
  try {
    return await writeNewKey(acl, allowed, file, mint);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
      // a concurrent starter of ours won: verify and read its file
      const text = (await checkAndReadFile(acl, allowed, file, true)).toString("utf8");
      return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
    }
    throw e;
  }
}

/** Create the key file exclusively, make its DACL protected/allow-list BEFORE writing, write, then verify + read back. */
async function writeNewKey(acl: KeyFileAcl, allowed: Set<string>, file: string, mint: () => { keyPem: string; certPem: string }): Promise<BrokerTlsMaterial> {
  const { keyPem, certPem } = mint();
  const fd = fs.openSync(file, "wx", 0o600); // EEXIST propagates to the caller
  try {
    try {
      await acl.rebuild(file, false);
    } catch (e) {
      throw new BrokerTlsError("TLS_KEY_ACL_OPEN", `${file}: could not set its access list (${(e as Error)?.message ?? e})`);
    }
    fs.writeSync(fd, keyPem + certPem);
  } finally {
    fs.closeSync(fd);
  }
  const text = (await checkAndReadFile(acl, allowed, file, false)).toString("utf8");
  if (text !== keyPem + certPem) throw new BrokerTlsError("TLS_FILE_CORRUPT", `${file}: content changed while it was being created`);
  return materialFrom(parseBrokerTlsPair(text, text, file), "generated", true, file);
}

/** POSIX path (unchanged since J1): 0700 folder, 0600 file via an exclusive temp file + hard link. */
function loadOrCreatePosix(dir: string, file: string, mint: () => { keyPem: string; certPem: string }): BrokerTlsMaterial {
  sweepLeftovers(dir);
  if (fs.existsSync(file)) {
    const text = readText(file);
    return materialFrom(parseBrokerTlsPair(text, text, file), "generated", false, file);
  }
  const { keyPem, certPem } = mint();
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, keyPem + certPem, { mode: 0o600, flag: "wx" });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      const text = readText(file);
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
 * Resolve the TLS material the listener should use, per env. Rejects with BrokerTlsError when it cannot decide
 * safely (caller: do not start the TLS listener, show the error). Async: never blocks the event loop.
 */
export async function resolveBrokerTls(env: NodeJS.ProcessEnv = process.env, acl: KeyFileAcl | null = defaultKeyFileAcl()): Promise<BrokerTlsMaterial> {
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
