/**
 * doc 81 Đợt 7 task J — TLS for the BUILT-IN (aedes) MQTT broker. REDESIGN (round 4, owner decision 2026-10-11).
 *
 * Until Đợt 7 the tablet ↔ built-in broker link was plaintext (TCP 1883 / ws 8883). From Đợt 7 the broker also listens
 * MQTT over TLS (MQTTS, `MQTT_TLS_PORT`, default 8884) — ON BY DEFAULT whenever the broker runs — and tablets (app ≥ 1.0.18)
 * PIN the certificate's SHA-256 fingerprint (shown on the admin card; the technician types it next to the device password).
 * A self-signed certificate is safe ONLY because of that pin: there is no CA, so there is nothing to bypass.
 *
 * WHO OWNS THE KEY — three fix rounds hardened a key the SERVER generated into `data/` (a folder every local user can
 * write to) and the scan found a new hole each time (ACL deny-list, no owner check, adopting an exposed key, a hard-link
 * race, a deletable ROTATE marker, link-following privileged writes). The owner decided: an ADMINISTRATOR provisions the
 * key with `scripts/provision-mqtt-tls.ps1` (elevated; protected folder, default `%ProgramData%\avi-aoi\mqtt-tls`; DACL
 * = SYSTEM + Administrators full control, the server account READ; files written with that DACL at creation), and this
 * module ONLY READS AND VERIFIES. It never generates, never repairs an ACL, never writes a marker, never writes anything.
 *
 * WHAT IS VERIFIED (every start, before the TLS listener binds):
 *   · Windows — each file (key AND certificate) is opened ONCE in a PowerShell helper and, through THAT handle, reports
 *     owner, DACL protection, every DACL entry (full SIDs), reparse attribute and hard-link count, then its bytes. Owner ∈
 *     {server account, SYSTEM, Administrators}; the DACL is protected (no inheritance); every ALLOW entry names one of
 *     those three; not a reparse point; exactly one link. The bytes used are the ones read from that same handle.
 *   · POSIX — `open(O_NOFOLLOW)`, then `fstat` on that fd: owner ∈ {server uid, root}; no group/other mode bits; regular
 *     file; nlink 1; bytes read from the fd. The folder: owner ∈ {server uid, root}, not writable by group/other, not a link.
 *   · Both — PEM parses and the private key matches the certificate.
 * ANY doubt ⇒ `BrokerTlsError` with a clear code and ONE log line ⇒ the TLS listener does not start. The plaintext
 * listeners and the rest of :3000 are unaffected. The server never "fixes" anything: the admin re-runs the script.
 * All Windows helper calls are asynchronous with a timeout (`MQTT_TLS_ACL_TIMEOUT_MS`); a timeout ⇒ refuse.
 *
 * Codes (L-7: every "cannot decide" names its outcome — always "no MQTTS this start"):
 *   TLS_CONFIG_INCOMPLETE  only one of MQTT_TLS_CERT / MQTT_TLS_KEY set
 *   TLS_NOT_PROVISIONED    a file does not exist — run the provisioning script
 *   TLS_FILE_UNREADABLE    exists but cannot be opened/read by the server account (DACL lacks it, sharing, I/O)
 *   TLS_FILE_CORRUPT       no PEM key/certificate inside            TLS_KEY_MISMATCH  key ≠ certificate
 *   TLS_KEY_OWNER_FOREIGN  owner outside the allow-list (possibly planted)
 *   TLS_KEY_ACL_OPEN       NULL DACL, or an allow entry for an account outside the allow-list (posix: group/other bits)
 *   TLS_KEY_ACL_UNPROTECTED  DACL inherits (not protected)           TLS_KEY_ACL_UNVERIFIED  cannot read/parse facts, timeout
 *   TLS_KEY_LINKED         reparse point / symlink / hard-link count ≠ 1 / not a regular file
 *
 * The OLD `data/mqtt-tls` folder and `MQTT_TLS_DIR` are IGNORED (never read, never deleted): the caller logs how to migrate
 * (provision with the script; the fingerprint changes ⇒ every tablet re-pins).
 *
 * The plaintext listeners (TCP + WS) stay open until migration is done — owner decision 2026-10-11. They can be closed
 * with `MQTT_PLAIN_ENABLED=false|0|off|no`; unset or a typo ⇒ open. This module only decides; mqttService.ts binds sockets.
 */
import { execFile } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import fs from "node:fs";
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

// ── where the admin-provisioned material lives ────────────────────────────────
export const TLS_CERT_FILE_NAME = "broker.crt";
export const TLS_KEY_FILE_NAME = "broker.key";
/** The elevated provisioning script (repo path) — named in every "not provisioned / migrate" message. */
export const PROVISION_SCRIPT = "scripts/provision-mqtt-tls.ps1";

/** Default folder: `%ProgramData%\avi-aoi\mqtt-tls` (win32) / `/etc/avi-aoi/mqtt-tls` (posix) — never under the repo. */
export function defaultMqttTlsDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return path.win32.join((env.ProgramData || "").trim() || "C:\\ProgramData", "avi-aoi", "mqtt-tls");
  return "/etc/avi-aoi/mqtt-tls";
}

export interface MqttTlsPaths {
  certPath: string;
  keyPath: string;
  /** "configured" = MQTT_TLS_CERT + MQTT_TLS_KEY; "default" = the ProgramData / etc location. */
  source: "configured" | "default";
}

/** Resolve the two file paths from env. Throws TLS_CONFIG_INCOMPLETE when only one of the two is set. */
export function mqttTlsPaths(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): MqttTlsPaths {
  const cert = (env.MQTT_TLS_CERT || "").trim();
  const key = (env.MQTT_TLS_KEY || "").trim();
  if (cert || key) {
    if (!cert || !key) {
      throw new BrokerTlsError("TLS_CONFIG_INCOMPLETE", "MQTT_TLS_CERT and MQTT_TLS_KEY must both be set (or neither, to use the default provisioned location)");
    }
    return { certPath: path.resolve(cert), keyPath: path.resolve(key), source: "configured" };
  }
  const p = platform === "win32" ? path.win32 : path.posix;
  const dir = defaultMqttTlsDir(env, platform);
  return { certPath: p.join(dir, TLS_CERT_FILE_NAME), keyPath: p.join(dir, TLS_KEY_FILE_NAME), source: "default" };
}

/**
 * The pre-redesign layout (server-generated `data/mqtt-tls/broker-tls.pem`, `MQTT_TLS_DIR`) is IGNORED — never read, never
 * removed. Returns one message to log when either is present, else null.
 */
export function legacySiteMaterialNotice(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
  const parts: string[] = [];
  if ((env.MQTT_TLS_DIR || "").trim()) parts.push("MQTT_TLS_DIR is set but no longer used (the server does not generate or store TLS material any more)");
  const legacyDir = path.join(cwd, "data", "mqtt-tls");
  if (fs.existsSync(legacyDir)) parts.push(`the old server-generated folder ${legacyDir} exists`);
  if (!parts.length) return null;
  return `[MQTT] ${parts.join("; ")} — IGNORED. Migrate: an administrator runs ${PROVISION_SCRIPT} (elevated) to provision the key under ` +
    `${defaultMqttTlsDir(env)}, restarts the server, then enters the NEW fingerprint on every tablet (the fingerprint changes); ` +
    "afterwards delete the old folder.";
}

// ── errors / material ──────────────────────────────────────────────────────────
export class BrokerTlsError extends Error {
  constructor(
    readonly code:
      | "TLS_CONFIG_INCOMPLETE"
      | "TLS_NOT_PROVISIONED"
      | "TLS_FILE_UNREADABLE"
      | "TLS_FILE_CORRUPT"
      | "TLS_KEY_MISMATCH"
      | "TLS_KEY_OWNER_FOREIGN"
      | "TLS_KEY_ACL_OPEN"
      | "TLS_KEY_ACL_UNPROTECTED"
      | "TLS_KEY_ACL_UNVERIFIED"
      | "TLS_KEY_LINKED",
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
  source: MqttTlsPaths["source"];
  certPath: string;
  keyPath: string;
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

// ── facts about a file, platform-neutral ───────────────────────────────────────
/**
 * What the verifier needs to know about one object, as reported through ITS OWN HANDLE. Principals are full Windows SIDs
 * (`S-1-5-…`) or posix `uid:N` / `gid:N` / `other`. `aces` lists every DACL entry with its type (`AccessAllowed`,
 * `AccessDenied`, or anything else = unverifiable); posix mode bits are rendered as allow entries.
 */
export interface DirFacts {
  owner: string;
  /** false = NULL DACL (Everyone full control). posix: always true. */
  daclPresent: boolean;
  /** Windows: the DACL does not inherit (P flag). posix: always true. */
  protectedDacl: boolean;
  aces: Array<{ type: string; principal: string }>;
  /** reparse point (symlink, junction…) / symlink / not a regular object. */
  link: boolean;
}
export interface FileFacts extends DirFacts {
  /** Hard-link count from the open handle — ≠ 1 means another name shares this file (and its DACL). */
  links: number;
  /** The bytes, read from the SAME handle that was inspected. */
  content: Buffer;
}

/** Thrown by an inspector: `unreadable` = the file could not be opened/read (⇒ TLS_FILE_UNREADABLE); anything else ⇒ unverified. */
export class InspectError extends Error {
  constructor(readonly kind: "unreadable" | "unverified", message: string) {
    super(message);
    this.name = "InspectError";
  }
}

/** Platform access to the files. Tests inject a fake. Every method is async; nothing here ever blocks the event loop. */
export interface KeyFileInspector {
  /** Principals allowed to OWN the files and to appear in ANY allow entry: the server account, SYSTEM/root, Administrators. */
  allowedPrincipals(): Promise<string[]>;
  /** Open the file ONCE, report its facts through that handle and its bytes from the same handle. */
  inspectAndReadFile(file: string): Promise<FileFacts>;
  /** Optional folder facts (posix: owner + write bits). When present, the folder holding each file is checked too. */
  inspectDir?(dir: string): Promise<DirFacts>;
}

export type MaterialVerdict = "ok" | "link" | "foreign-owner" | "open" | "unverified" | "unprotected";

const ACE_TYPES_ACCEPTED = new Set(["AccessAllowed", "AccessDenied"]);

/**
 * What the facts mean (order matters — the gravest, least repairable fact first): a link / second hard link is never
 * trusted; a foreign owner is never adopted; a NULL DACL or any allow entry for a principal outside the allow-list means
 * the key may have been read or written; an entry we cannot evaluate = unverified; an unprotected DACL could widen later.
 */
export function classifyFacts(f: DirFacts | FileFacts, allowed: ReadonlySet<string>): MaterialVerdict {
  if (f.link) return "link";
  if ("links" in f && f.links !== 1) return "link";
  if (!allowed.has(f.owner)) return "foreign-owner";
  if (!f.daclPresent) return "open";
  if (f.aces.some((a) => a.type === "AccessAllowed" && !allowed.has(a.principal))) return "open";
  if (f.aces.some((a) => !ACE_TYPES_ACCEPTED.has(a.type) || a.principal === "?")) return "unverified";
  if (!f.protectedDacl) return "unprotected";
  return "ok";
}

const VERDICT_CODE: Record<Exclude<MaterialVerdict, "ok">, BrokerTlsError["code"]> = {
  link: "TLS_KEY_LINKED",
  "foreign-owner": "TLS_KEY_OWNER_FOREIGN",
  open: "TLS_KEY_ACL_OPEN",
  unverified: "TLS_KEY_ACL_UNVERIFIED",
  unprotected: "TLS_KEY_ACL_UNPROTECTED",
};
const VERDICT_TEXT: Record<Exclude<MaterialVerdict, "ok">, string> = {
  link: "is a link / reparse point or has more than one hard link",
  "foreign-owner": "is owned by an account outside the server account / SYSTEM / Administrators (possibly planted)",
  open: "grants access to an account outside the server account / SYSTEM / Administrators (or has no access list) — the key may be exposed",
  unverified: "has an access list that cannot be evaluated",
  unprotected: "has an access list that inherits from its folder (not protected)",
};

// ── Windows inspector (PowerShell + .NET, one handle per file) ───────────────────
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const SID_RE = /^S-1-\d+(?:-\d+)+$/;
/** Largest key/certificate file we read (a PEM pair is ~1–3 KB). */
const MAX_TLS_FILE_BYTES = 64 * 1024;

/**
 * STRICT reader of the helper's report. `OPENFAILED=<reason>` alone ⇒ InspectError(unreadable). Anything missing,
 * duplicated, malformed, mixed or unknown ⇒ throws (the caller turns that into TLS_KEY_ACL_UNVERIFIED).
 */
export function parseFactsReport(text: string): FileFacts {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].startsWith("OPENFAILED=")) throw new InspectError("unreadable", lines[0].slice("OPENFAILED=".length) || "open failed");
  const one: Record<string, string> = {};
  const aces: Array<{ type: string; principal: string }> = [];
  const bad = (why: string) => new InspectError("unverified", `facts report: ${why}`);
  for (const line of lines) {
    const m = line.match(/^([A-Z]+)=(.*)$/);
    if (!m) throw bad(`unexpected line "${line.slice(0, 80)}"`);
    if (m[1] === "ACE") {
      const a = m[2].match(/^([A-Za-z]+)\|(S-1-\d+(?:-\d+)+|\?)$/);
      if (!a) throw bad(`malformed ACE "${m[2].slice(0, 80)}"`);
      aces.push({ type: a[1], principal: a[2] });
    } else {
      if (m[1] in one) throw bad(`duplicate ${m[1]}`);
      one[m[1]] = m[2];
    }
  }
  const need = ["OWNER", "PROTECTED", "DACL", "PATHATTRS", "LINKS", "ATTRS", "CONTENT"];
  for (const k of need) if (!(k in one)) throw bad(`lacks ${k}`);
  for (const k of Object.keys(one)) if (!need.includes(k)) throw bad(`unexpected ${k}`);
  if (!SID_RE.test(one.OWNER)) throw bad("owner is not a SID");
  if (!/^[01]$/.test(one.PROTECTED)) throw bad("bad PROTECTED");
  if (one.DACL !== "present" && one.DACL !== "null") throw bad("bad DACL");
  if (one.DACL === "null" && aces.length) throw bad("ACEs reported for a null DACL");
  const int = (k: string) => {
    if (!/^\d{1,10}$/.test(one[k])) throw bad(`bad ${k}`);
    return Number(one[k]);
  };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(one.CONTENT)) throw bad("bad CONTENT");
  const attrs = int("PATHATTRS") | int("ATTRS");
  return {
    owner: one.OWNER,
    protectedDacl: one.PROTECTED === "1",
    daclPresent: one.DACL === "present",
    aces,
    link: (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0,
    links: int("LINKS"),
    content: Buffer.from(one.CONTENT, "base64"),
  };
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
          reject(new InspectError("unverified", e.killed || e.signal ? `timed out after ${aclTimeoutMs()} ms` : `${path.basename(file)} failed: ${e.code ?? e.message}`));
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
      if (!sid) throw new InspectError("unverified", "cannot determine the server account SID");
      return sid;
    });
    cachedSid.catch(() => { cachedSid = null; });
  }
  return cachedSid;
}

/**
 * PowerShell helper: a CONSTANT script, the path in an environment variable of the child (never on a command line, never
 * through a shell), `-NoProfile -NonInteractive`, `$ErrorActionPreference='Stop'` ⇒ any failure = non-zero exit ⇒ unverified.
 * The file is opened ONCE (FileShare.Read: nobody writes meanwhile); owner/DACL come from the handle's security descriptor
 * (RawSecurityDescriptor ⇒ full SIDs, AceType names), link count + attributes from GetFileInformationByHandle on that
 * handle, and the bytes from the same handle. An open failure is reported as OPENFAILED (⇒ TLS_FILE_UNREADABLE).
 */
const PS_INSPECT_READ_FILE =
  "$ErrorActionPreference='Stop'; " +
  "function Report($bin){ $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor -ArgumentList @($bin, 0); " +
  "'OWNER=' + $sd.Owner.Value; " +
  "'PROTECTED=' + [int](($sd.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0); " +
  "if ($sd.DiscretionaryAcl -eq $null) { 'DACL=null' } else { 'DACL=present'; foreach ($a in $sd.DiscretionaryAcl) { " +
  "if ($a -is [System.Security.AccessControl.KnownAce]) { 'ACE=' + $a.AceType + '|' + $a.SecurityIdentifier.Value } else { 'ACE=' + $a.AceType + '|?' } } } }; " +
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; " +
  "public static class MqttTlsJ7 { [StructLayout(LayoutKind.Sequential)] public struct BHFI { public uint Attributes; " +
  "public uint C1, C2, A1, A2, W1, W2; public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; " +
  "public uint IndexHigh; public uint IndexLow; } [DllImport(\"kernel32.dll\", SetLastError = true)] public static extern bool " +
  "GetFileInformationByHandle(SafeFileHandle h, out BHFI info); }'; " +
  "$p=$env:MQTT_TLS_ACL_PATH; $pa=[int](Get-Item -LiteralPath $p -Force).Attributes; " +
  "try { $fs=[System.IO.File]::Open($p, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read) } " +
  "catch { 'OPENFAILED=' + $_.Exception.Message.Replace([char]10,' ').Replace([char]13,' '); exit 0 }; " +
  "try { $info=New-Object MqttTlsJ7+BHFI; if (-not [MqttTlsJ7]::GetFileInformationByHandle($fs.SafeFileHandle, [ref]$info)) { throw 'GetFileInformationByHandle failed' }; " +
  "Report ($fs.GetAccessControl().GetSecurityDescriptorBinaryForm()); 'PATHATTRS=' + $pa; 'LINKS=' + $info.Links; 'ATTRS=' + $info.Attributes; " +
  `$len=[int]$fs.Length; if ($len -gt ${MAX_TLS_FILE_BYTES}) { throw 'file too large' }; $buf=New-Object byte[] $len; $n=0; ` +
  "while ($n -lt $len) { $r=$fs.Read($buf, $n, $len - $n); if ($r -le 0) { break }; $n+=$r }; " +
  "'CONTENT=' + [Convert]::ToBase64String($buf, 0, $n) } finally { $fs.Dispose() }";

function powershell(script: string, env: Record<string, string>): Promise<string> {
  return runBounded(sys32("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], env);
}

/** Windows implementation (see PS_INSPECT_READ_FILE). No folder check: the owner/link/ACL facts of the file itself decide. */
export const windowsInspector: KeyFileInspector = {
  allowedPrincipals: async () => [await currentAccountSid(), "S-1-5-18", "S-1-5-32-544"],
  async inspectAndReadFile(file) {
    return parseFactsReport(await powershell(PS_INSPECT_READ_FILE, { MQTT_TLS_ACL_PATH: file }));
  },
};

// ── POSIX inspector (fd-based; deps injectable for tests) ───────────────────────
export interface PosixFsDeps {
  getuid: () => number;
  openSync: (p: string, flags: number) => number;
  fstatSync: (fd: number) => { uid: number; gid: number; mode: number; nlink: number; size: number; isFile(): boolean };
  readFileSync: (fd: number) => Buffer;
  closeSync: (fd: number) => void;
  lstatSync: (p: string) => { uid: number; gid: number; mode: number; isSymbolicLink(): boolean; isDirectory(): boolean };
}
const O_NOFOLLOW_FALLBACK = 0x20000; // linux value; node exposes fs.constants.O_NOFOLLOW on every posix platform

/** POSIX: open(O_NOFOLLOW) → fstat → read from that fd. Mode bits become allow entries (`gid:N` / `other`). */
export function makePosixInspector(deps: PosixFsDeps = {
  getuid: () => (process.getuid ? process.getuid() : -1),
  openSync: (p, flags) => fs.openSync(p, flags),
  fstatSync: (fd) => fs.fstatSync(fd),
  readFileSync: (fd) => fs.readFileSync(fd),
  closeSync: (fd) => fs.closeSync(fd),
  lstatSync: (p) => fs.lstatSync(p),
}): KeyFileInspector {
  const modeAces = (uid: number, gid: number, mode: number, bits: { group: number; other: number }) => {
    const aces = [{ type: "AccessAllowed", principal: `uid:${uid}` }];
    if (mode & bits.group) aces.push({ type: "AccessAllowed", principal: `gid:${gid}` });
    if (mode & bits.other) aces.push({ type: "AccessAllowed", principal: "other" });
    return aces;
  };
  return {
    allowedPrincipals: async () => [`uid:${deps.getuid()}`, "uid:0"],
    async inspectAndReadFile(file) {
      let fd: number;
      try {
        fd = deps.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? O_NOFOLLOW_FALLBACK));
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === "ELOOP") return { owner: "?", daclPresent: true, protectedDacl: true, aces: [], link: true, links: 1, content: Buffer.alloc(0) };
        throw new InspectError("unreadable", `${code ?? (e as Error)?.message}`);
      }
      try {
        const st = deps.fstatSync(fd);
        if (st.size > MAX_TLS_FILE_BYTES) throw new InspectError("unverified", "file too large");
        return {
          owner: `uid:${st.uid}`,
          daclPresent: true,
          protectedDacl: true,
          aces: modeAces(st.uid, st.gid, st.mode, { group: 0o070, other: 0o007 }), // ANY group/other bit on the key = exposed
          link: !st.isFile(),
          links: st.nlink,
          content: deps.readFileSync(fd),
        };
      } finally {
        deps.closeSync(fd);
      }
    },
    async inspectDir(dir) {
      const st = deps.lstatSync(dir);
      return {
        owner: `uid:${st.uid}`,
        daclPresent: true,
        protectedDacl: true,
        aces: modeAces(st.uid, st.gid, st.mode, { group: 0o020, other: 0o002 }), // only WRITE bits matter for the folder
        link: st.isSymbolicLink() || !st.isDirectory(),
      };
    },
  };
}

export function defaultInspector(platform: NodeJS.Platform = process.platform): KeyFileInspector {
  return platform === "win32" ? windowsInspector : makePosixInspector();
}

// ── verify + read ──────────────────────────────────────────────────────────────
function refuse(code: BrokerTlsError["code"], target: string, why: string): never {
  console.error(`[MQTT] TLS material ${target} ${why} — MQTTS NOT started (${code}). Fix it with ${PROVISION_SCRIPT} (run as Administrator), then restart the server.`);
  throw new BrokerTlsError(code, `${target}: ${why}`);
}

async function allowedSet(inspector: KeyFileInspector): Promise<Set<string>> {
  try {
    return new Set(await inspector.allowedPrincipals());
  } catch (e) {
    throw new BrokerTlsError("TLS_KEY_ACL_UNVERIFIED", `cannot determine the server account (${(e as Error)?.message ?? e})`);
  }
}

/** The file must EXIST as a regular (non-link) name before any handle is opened. Missing ⇒ not provisioned. */
function requirePresent(file: string, paths: MqttTlsPaths): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      refuse("TLS_NOT_PROVISIONED", file, `does not exist — provision the key and certificate (${paths.certPath}, ${paths.keyPath}) with ${PROVISION_SCRIPT}`);
    }
    refuse("TLS_FILE_UNREADABLE", file, `cannot be inspected (${code ?? (e as Error)?.message})`);
  }
  if (st.isSymbolicLink()) refuse("TLS_KEY_LINKED", file, VERDICT_TEXT.link);
}

/** Folder facts (only when the inspector reports them — posix): owner allowed, not writable by strangers, not a link. */
async function verifyDir(inspector: KeyFileInspector, allowed: Set<string>, dir: string): Promise<void> {
  if (!inspector.inspectDir) return;
  let d: DirFacts;
  try {
    d = await inspector.inspectDir(dir);
  } catch (e) {
    refuse("TLS_KEY_ACL_UNVERIFIED", `${dir} (folder)`, `cannot be inspected (${(e as Error)?.message ?? e})`);
  }
  const v = classifyFacts(d, allowed);
  if (v !== "ok") refuse(VERDICT_CODE[v], `${dir} (folder)`, VERDICT_TEXT[v]);
}

/** Open the file ONCE through the inspector, judge the facts seen on that handle, return the bytes read from it. */
async function verifiedRead(inspector: KeyFileInspector, allowed: Set<string>, file: string): Promise<Buffer> {
  let facts: FileFacts;
  try {
    facts = await inspector.inspectAndReadFile(file);
  } catch (e) {
    if (e instanceof InspectError && e.kind === "unreadable") {
      const who = [...allowed].find((p) => !/^(S-1-5-18|S-1-5-32-544|uid:0)$/.test(p)) ?? "the server account";
      refuse("TLS_FILE_UNREADABLE", file, `cannot be opened by the server account ${who} (${e.message}) — the access list must grant it READ`);
    }
    refuse("TLS_KEY_ACL_UNVERIFIED", file, `cannot be verified (${(e as Error)?.message ?? e})`);
  }
  const v = classifyFacts(facts, allowed);
  if (v !== "ok") refuse(VERDICT_CODE[v], file, VERDICT_TEXT[v]);
  return facts.content;
}

/**
 * Resolve the TLS material the listener should use, per env. Rejects with BrokerTlsError when it cannot decide safely
 * (caller: do not start the TLS listener, show the error). Reads only; never creates, repairs or deletes anything.
 */
export async function resolveBrokerTls(env: NodeJS.ProcessEnv = process.env, inspector: KeyFileInspector = defaultInspector()): Promise<BrokerTlsMaterial> {
  const paths = mqttTlsPaths(env);
  const allowed = await allowedSet(inspector);
  // order: both files must exist (else "not provisioned", nothing opened) → folders once each → each file via ONE handle
  requirePresent(paths.keyPath, paths);
  requirePresent(paths.certPath, paths);
  for (const dir of new Set([path.dirname(paths.keyPath), path.dirname(paths.certPath)])) await verifyDir(inspector, allowed, dir);
  const keyText = (await verifiedRead(inspector, allowed, paths.keyPath)).toString("utf8");
  const certText = (await verifiedRead(inspector, allowed, paths.certPath)).toString("utf8");
  const pair = parseBrokerTlsPair(keyText, certText, paths.certPath);
  const notAfter = new Date(pair.cert.validTo);
  if (notAfter.getTime() < Date.now()) {
    console.warn(`[MQTT] the provisioned TLS certificate ${paths.certPath} expired on ${notAfter.toISOString()} — still served (tablets trust the PIN, not the date); rotate it with ${PROVISION_SCRIPT} -Rotate when convenient`);
  }
  return {
    keyPem: pair.keyPem,
    certPem: pair.certPem,
    fingerprintSha256: pair.cert.fingerprint256.toUpperCase(),
    notAfter: notAfter.toISOString(),
    source: paths.source,
    certPath: paths.certPath,
    keyPath: paths.keyPath,
  };
}

// ── status shown to the admin ────────────────────────────────────────────────
export interface MqttBrokerTlsStatus {
  /** MQTTS listener wanted (MQTT_TLS_ENABLED not explicitly off). */
  enabled: boolean;
  listening: boolean;
  port: number | null;
  fingerprintSha256: string | null;
  source: MqttTlsPaths["source"] | null;
  notAfter: string | null;
  /** Where the server looks for the certificate (path only — the key is never exposed). */
  certPath: string | null;
  /** BrokerTlsError code, or the listen error code (EADDRINUSE…); null when fine. */
  error: string | null;
  plainEnabled: boolean;
}
