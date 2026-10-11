/**
 * doc 81 Đợt 7 task J redesign (round 4, owner decision 2026-10-11) — the built-in broker's TLS material is PROVISIONED
 * by an administrator (scripts/provision-mqtt-tls.ps1) and the server ONLY READS + VERIFIES it (mqttBrokerTls.ts).
 *
 * Oracles independent of the product code:
 *   · the fingerprint is recomputed here from the PEM text (base64 → DER → sha256), not read from the module;
 *   · the material is exercised by a REAL TLS handshake (node:tls on 127.0.0.1:0) trusting the server ONLY by that pin;
 *   · "the server never writes" is checked on fs spies AND on directory listings + mtimes;
 *   · test certificates come from security/x509Mint (an existing product module) — this module has NO generation code.
 * Facts about owner / DACL / links are INJECTED here (fake inspector); the real Windows descriptors are exercised in
 * mqttBrokerTlsWindows.dot7.test.ts. Temp dirs only — never the repo's data/, never ProgramData.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createHash, X509Certificate } from "node:crypto";
import { generateEd25519, mintEd25519Cert } from "./security/x509Mint";
import {
  BrokerTlsError,
  type DirFacts,
  type FileFacts,
  InspectError,
  type KeyFileInspector,
  PROVISION_SCRIPT,
  TLS_CERT_FILE_NAME,
  TLS_KEY_FILE_NAME,
  aclTimeoutMs,
  classifyFacts,
  defaultMqttTlsDir,
  legacySiteMaterialNotice,
  makePosixInspector,
  mqttPlainEnabled,
  mqttTlsEnabled,
  mqttTlsPaths,
  parseFactsReport,
  resolveBrokerTls,
  runBounded,
} from "./mqttBrokerTls";

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j4-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
afterAll(() => { errSpy.mockRestore(); warnSpy.mockRestore(); });

/** Independent fingerprint: SHA-256 over the DER inside the first CERTIFICATE block, `AB:CD:…`. */
function fingerprintFromPem(text: string): string {
  const b64 = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase().match(/../g)!.join(":");
}

/** A self-signed leaf minted by the EXISTING product module (Ed25519 — fine for node↔node handshakes). */
function pair(cn = "J4"): { keyPem: string; certPem: string } {
  const kp = generateEd25519();
  const m = mintEd25519Cert({
    subjectCN: cn, issuerCN: cn, isCa: false, days: 365, signingKey: kp.privateKey,
    subjectSpkiDer: kp.publicKey.export({ type: "spki", format: "der" }) as Buffer,
  });
  return { keyPem: kp.privateKeyPem, certPem: m.pem };
}

/** Files as the provisioning script leaves them (content only — the facts are injected). */
function provisioned(p = pair()): { dir: string; certPath: string; keyPath: string; env: NodeJS.ProcessEnv } & typeof p {
  const dir = path.join(tempDir(), "mqtt-tls");
  fs.mkdirSync(dir);
  const certPath = path.join(dir, TLS_CERT_FILE_NAME);
  const keyPath = path.join(dir, TLS_KEY_FILE_NAME);
  fs.writeFileSync(certPath, p.certPem);
  fs.writeFileSync(keyPath, p.keyPem);
  return { dir, certPath, keyPath, env: { MQTT_TLS_CERT: certPath, MQTT_TLS_KEY: keyPath }, ...p };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Real handshake; the client accepts the server ONLY if its leaf fingerprint equals `pin`. */
async function handshake(keyPem: string, certPem: string, pin: string): Promise<{ ok: boolean; err?: string; echoed?: string }> {
  const server = tls.createServer({ key: keyPem, cert: certPem }, (s) => s.pipe(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    return await withTimeout(new Promise((resolve) => {
      const c = tls.connect({
        host: "127.0.0.1", port, ca: certPem,
        checkServerIdentity: (_h, cert) => (cert.fingerprint256 === pin ? undefined : new Error("PIN_MISMATCH")),
      });
      c.once("secureConnect", () => { c.write("ping"); c.once("data", (d) => { c.end(); resolve({ ok: true, echoed: d.toString() }); }); });
      c.once("error", (e) => resolve({ ok: false, err: e.message }));
    }), 8000, "handshake");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const ME = "S-1-5-21-1393689357-3042344854-1725742880-1000";
const OTHER = "S-1-5-21-1393689357-3042344854-1725742880-1002";
const SY = "S-1-5-18";
const BA = "S-1-5-32-544";
const ALLOWED = new Set([ME, SY, BA]);
const okAces = () => [{ type: "AccessAllowed", principal: SY }, { type: "AccessAllowed", principal: BA }, { type: "AccessAllowed", principal: ME }];
const okFile = (content: Buffer, over: Partial<FileFacts> = {}): FileFacts => ({
  owner: BA, daclPresent: true, protectedDacl: true, aces: okAces(), link: false, links: 1, content, ...over,
});

/** Fake inspector over REAL files: default facts = exactly what the provisioning script produces; content from disk. */
function fakeInspector(over: Record<string, Partial<FileFacts>> = {}, o: { allowed?: string[]; dirs?: Record<string, Partial<DirFacts>> } = {}) {
  const calls = { read: [] as string[], dirs: [] as string[] };
  const inspector: KeyFileInspector = {
    allowedPrincipals: async () => o.allowed ?? [ME, SY, BA],
    inspectAndReadFile: async (f) => {
      calls.read.push(f);
      return { ...okFile(fs.readFileSync(f)), ...(over[f] ?? {}) };
    },
    ...(o.dirs
      ? { inspectDir: async (d: string) => { calls.dirs.push(d); return { owner: BA, daclPresent: true, protectedDacl: true, aces: okAces(), link: false, ...(o.dirs![d] ?? {}) }; } }
      : {}),
  };
  return { inspector, calls };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
}

/** Every fs write primitive the module could reach — none may be called while resolving. */
const WRITE_FNS = ["writeFileSync", "writeSync", "appendFileSync", "mkdirSync", "mkdtempSync", "renameSync", "linkSync", "symlinkSync", "rmSync", "rmdirSync", "unlinkSync", "chmodSync", "chownSync", "copyFileSync", "utimesSync", "truncateSync"] as const;
function spyWrites() {
  const spies = WRITE_FNS.map((n) => vi.spyOn(fs, n as never));
  const openSpy = vi.spyOn(fs, "openSync");
  return {
    assertNone() {
      for (const s of spies) expect(s, (s as { getMockName?: () => string }).getMockName?.()).not.toHaveBeenCalled();
      for (const c of openSpy.mock.calls) {
        const flags = c[1];
        if (typeof flags === "string") expect(flags).toMatch(/^rs?$/);
        else if (typeof flags === "number") expect(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)).toBe(0);
      }
    },
    restore() { for (const s of spies) s.mockRestore(); openSpy.mockRestore(); },
  };
}
function snapshot(dir: string): string {
  return fs.readdirSync(dir).sort().map((n) => { const st = fs.statSync(path.join(dir, n)); return `${n}:${st.size}:${st.mtimeMs}`; }).join("|");
}

afterEach(() => { errSpy.mockClear(); warnSpy.mockClear(); });

describe("flags — TLS on unless EXPLICITLY off; plaintext open unless EXPLICITLY off (unchanged)", () => {
  it("MQTT_TLS_ENABLED / MQTT_PLAIN_ENABLED", () => {
    expect(mqttTlsEnabled({})).toBe(true);
    for (const v of ["false", "0", "off", "no", " OFF ", "False"]) expect(mqttTlsEnabled({ MQTT_TLS_ENABLED: v })).toBe(false);
    for (const v of ["true", "1", "flase", "", "yes"]) expect(mqttTlsEnabled({ MQTT_TLS_ENABLED: v })).toBe(true);
    expect(mqttPlainEnabled({})).toBe(true);
    for (const v of ["false", "0", "off", "no"]) expect(mqttPlainEnabled({ MQTT_PLAIN_ENABLED: v })).toBe(false);
    for (const v of ["true", "typo", ""]) expect(mqttPlainEnabled({ MQTT_PLAIN_ENABLED: v })).toBe(true);
  });
});

describe("paths — admin-provisioned location, default under ProgramData (win32) / /etc (posix); NEVER under the repo", () => {
  it("defaults: %ProgramData%\\avi-aoi\\mqtt-tls\\broker.crt|.key on win32, /etc/avi-aoi/mqtt-tls on posix", () => {
    expect(defaultMqttTlsDir({ ProgramData: "D:\\PD" }, "win32")).toBe(path.win32.join("D:\\PD", "avi-aoi", "mqtt-tls"));
    expect(defaultMqttTlsDir({}, "win32")).toBe(path.win32.join("C:\\ProgramData", "avi-aoi", "mqtt-tls"));
    expect(defaultMqttTlsDir({ ProgramData: "D:\\PD" }, "linux")).toBe("/etc/avi-aoi/mqtt-tls");
    const p = mqttTlsPaths({ ProgramData: "D:\\PD" }, "win32");
    expect(p).toEqual({ certPath: "D:\\PD\\avi-aoi\\mqtt-tls\\broker.crt", keyPath: "D:\\PD\\avi-aoi\\mqtt-tls\\broker.key", source: "default" });
    expect(mqttTlsPaths({}, "linux")).toEqual({ certPath: "/etc/avi-aoi/mqtt-tls/broker.crt", keyPath: "/etc/avi-aoi/mqtt-tls/broker.key", source: "default" });
    // the default never points into the working directory (the old data/mqtt-tls was the whole problem)
    for (const pl of ["win32", "linux"] as const) expect(defaultMqttTlsDir({}, pl).toLowerCase()).not.toContain(process.cwd().toLowerCase());
  });
  it("MQTT_TLS_CERT + MQTT_TLS_KEY ⇒ those (resolved), source configured; only one ⇒ TLS_CONFIG_INCOMPLETE", () => {
    const p = mqttTlsPaths({ MQTT_TLS_CERT: " ./c.pem ", MQTT_TLS_KEY: "k.pem" });
    expect(p).toEqual({ certPath: path.resolve("./c.pem"), keyPath: path.resolve("k.pem"), source: "configured" });
    for (const env of [{ MQTT_TLS_CERT: "/x.pem" }, { MQTT_TLS_KEY: "/k.pem" }]) {
      expect(() => mqttTlsPaths(env)).toThrow(BrokerTlsError);
      try { mqttTlsPaths(env); } catch (e) { expect((e as BrokerTlsError).code).toBe("TLS_CONFIG_INCOMPLETE"); }
    }
  });
  it("legacy data/mqtt-tls or MQTT_TLS_DIR ⇒ a notice that it is IGNORED and how to migrate; otherwise null", () => {
    const cwd = tempDir();
    expect(legacySiteMaterialNotice({}, cwd)).toBeNull();
    const n1 = legacySiteMaterialNotice({ MQTT_TLS_DIR: "D:\\somewhere" }, cwd)!;
    expect(n1).toMatch(/MQTT_TLS_DIR/);
    expect(n1).toMatch(/ignored/i);
    expect(n1).toContain(PROVISION_SCRIPT);
    fs.mkdirSync(path.join(cwd, "data", "mqtt-tls"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "data", "mqtt-tls", "broker-tls.pem"), "old");
    const n2 = legacySiteMaterialNotice({}, cwd)!;
    expect(n2).toContain(path.join(cwd, "data", "mqtt-tls"));
    expect(n2).toMatch(/ignored/i);
    expect(n2).toMatch(/fingerprint/i); // migrating means a NEW fingerprint ⇒ tablets re-pin
    expect(n2).toContain(PROVISION_SCRIPT);
  });
});

describe("resolveBrokerTls — reads + verifies, never writes", () => {
  it("not provisioned (no files) ⇒ TLS_NOT_PROVISIONED naming the script and the expected path; the inspector is never asked", async () => {
    const dir = tempDir();
    const env = { MQTT_TLS_CERT: path.join(dir, TLS_CERT_FILE_NAME), MQTT_TLS_KEY: path.join(dir, TLS_KEY_FILE_NAME) };
    const f = fakeInspector();
    let err: BrokerTlsError | null = null;
    try { await resolveBrokerTls(env, f.inspector); } catch (e) { err = e as BrokerTlsError; }
    expect(err?.code).toBe("TLS_NOT_PROVISIONED");
    expect(err?.message).toContain(PROVISION_SCRIPT);
    expect(err?.message).toContain(env.MQTT_TLS_KEY);
    expect(f.calls.read).toEqual([]);
    // key present but certificate missing (half-provisioned) ⇒ still "not provisioned"
    fs.writeFileSync(env.MQTT_TLS_KEY, pair().keyPem);
    expect(await codeOf(resolveBrokerTls(env, fakeInspector().inspector))).toBe("TLS_NOT_PROVISIONED");
    expect(fs.readdirSync(dir)).toEqual([TLS_KEY_FILE_NAME]); // nothing created
  });

  it("provisioned + facts as the script leaves them ⇒ material with the EXACT fingerprint; a real pinned handshake works", async () => {
    const p = provisioned();
    const f = fakeInspector();
    const w = spyWrites();
    const before = snapshot(p.dir);
    let m;
    try { m = await resolveBrokerTls(p.env, f.inspector); w.assertNone(); } finally { w.restore(); }
    expect(snapshot(p.dir)).toBe(before);
    expect(m.source).toBe("configured");
    expect(m.certPath).toBe(p.certPath);
    expect(m.keyPath).toBe(p.keyPath);
    expect(m.fingerprintSha256).toBe(fingerprintFromPem(p.certPem));
    expect(m.fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(m.notAfter).toBe(new Date(new X509Certificate(p.certPem).validTo).toISOString());
    expect(f.calls.read.sort()).toEqual([p.certPath, p.keyPath].sort());
    expect(await handshake(m.keyPem, m.certPem, m.fingerprintSha256)).toEqual({ ok: true, echoed: "ping" });
    const other = pair("OTHER");
    expect((await handshake(m.keyPem, m.certPem, fingerprintFromPem(other.certPem))).err).toContain("PIN_MISMATCH");
  });

  it("the bytes used are the ones read through the checked handle, not a second read by path", async () => {
    const p = provisioned();
    const other = pair("VIA-HANDLE");
    const f = fakeInspector({ [p.keyPath]: { content: Buffer.from(other.keyPem) }, [p.certPath]: { content: Buffer.from(other.certPem) } });
    const m = await resolveBrokerTls(p.env, f.inspector);
    expect(m.fingerprintSha256).toBe(fingerprintFromPem(other.certPem));
    expect(fs.readFileSync(p.certPath, "utf8")).toBe(p.certPem); // disk untouched
  });

  it("corrupt / mismatched / unreadable / unverifiable ⇒ the matching code, files untouched", async () => {
    const a = provisioned();
    fs.writeFileSync(a.keyPath, "garbage");
    expect(await codeOf(resolveBrokerTls(a.env, fakeInspector().inspector))).toBe("TLS_FILE_CORRUPT");
    expect(fs.readFileSync(a.keyPath, "utf8")).toBe("garbage");
    const b = provisioned();
    fs.writeFileSync(b.keyPath, pair("B").keyPem);
    expect(await codeOf(resolveBrokerTls(b.env, fakeInspector().inspector))).toBe("TLS_KEY_MISMATCH");
    const c = provisioned();
    const unreadable: KeyFileInspector = { allowedPrincipals: async () => [ME, SY, BA], inspectAndReadFile: async () => { throw new InspectError("unreadable", "Access to the path is denied"); } };
    expect(await codeOf(resolveBrokerTls(c.env, unreadable))).toBe("TLS_FILE_UNREADABLE");
    const unverified: KeyFileInspector = { allowedPrincipals: async () => [ME, SY, BA], inspectAndReadFile: async () => { throw new Error("powershell.exe failed: 1"); } };
    expect(await codeOf(resolveBrokerTls(c.env, unverified))).toBe("TLS_KEY_ACL_UNVERIFIED");
    const noAccount: KeyFileInspector = { allowedPrincipals: async () => { throw new Error("whoami failed"); }, inspectAndReadFile: async () => okFile(Buffer.alloc(0)) };
    expect(await codeOf(resolveBrokerTls(c.env, noAccount))).toBe("TLS_KEY_ACL_UNVERIFIED");
    // a symlink in place of the key (lstat, before any handle is opened) ⇒ LINKED
    const d = provisioned();
    const real = `${d.keyPath}.real`;
    fs.renameSync(d.keyPath, real);
    try { fs.symlinkSync(real, d.keyPath, "file"); } catch { fs.renameSync(real, d.keyPath); return; } // no symlink privilege here: covered by injected facts below
    const fd = fakeInspector();
    expect(await codeOf(resolveBrokerTls(d.env, fd.inspector))).toBe("TLS_KEY_LINKED");
    expect(fd.calls.read).toEqual([]);
  });

  it("every security verdict on the KEY or the CERTIFICATE refuses with its code, logs once, and NOTHING is written or repaired", async () => {
    const cases: Array<[Partial<FileFacts>, string]> = [
      [{ link: true }, "TLS_KEY_LINKED"],
      [{ links: 2 }, "TLS_KEY_LINKED"],
      [{ owner: OTHER }, "TLS_KEY_OWNER_FOREIGN"],
      [{ owner: OTHER, aces: [{ type: "AccessAllowed", principal: "S-1-5-11" }] }, "TLS_KEY_OWNER_FOREIGN"],
      [{ daclPresent: false, aces: [] }, "TLS_KEY_ACL_OPEN"],
      [{ aces: [...okAces(), { type: "AccessAllowed", principal: "S-1-5-11" }] }, "TLS_KEY_ACL_OPEN"],
      [{ aces: [...okAces(), { type: "AccessAllowed", principal: OTHER }] }, "TLS_KEY_ACL_OPEN"],
      [{ aces: [...okAces(), { type: "AccessAllowedCallback", principal: SY }] }, "TLS_KEY_ACL_UNVERIFIED"],
      [{ aces: [...okAces(), { type: "AccessAllowedObject", principal: "?" }] }, "TLS_KEY_ACL_UNVERIFIED"],
      [{ protectedDacl: false }, "TLS_KEY_ACL_UNPROTECTED"],
    ];
    for (const target of ["key", "cert"] as const) {
      for (const [over, code] of cases) {
        const p = provisioned();
        const file = target === "key" ? p.keyPath : p.certPath;
        const f = fakeInspector({ [file]: over });
        const w = spyWrites();
        const before = snapshot(p.dir);
        errSpy.mockClear();
        try {
          expect(await codeOf(resolveBrokerTls(p.env, f.inspector)), `${target} ${JSON.stringify(over)}`).toBe(code);
          w.assertNone();
        } finally { w.restore(); }
        expect(snapshot(p.dir)).toBe(before);
        expect(errSpy.mock.calls.filter((c) => /MQTTS NOT started/.test(String(c[0]))).length, "one refusal line").toBe(1);
        expect(String(errSpy.mock.calls[0][0])).toContain(file);
      }
    }
    // a denied ACE for a stranger is harmless ⇒ ok
    const p = provisioned();
    expect(await codeOf(resolveBrokerTls(p.env, fakeInspector({ [p.keyPath]: { aces: [...okAces(), { type: "AccessDenied", principal: "S-1-5-11" }] } }).inspector))).toBe("ok");
  });

  it("posix-style folder facts (inspectDir present): a group/other-writable or foreign-owned folder refuses", async () => {
    const p = provisioned();
    const ok = fakeInspector({}, { dirs: {} });
    expect(await codeOf(resolveBrokerTls(p.env, ok.inspector))).toBe("ok");
    expect(ok.calls.dirs).toEqual([p.dir]);
    expect(await codeOf(resolveBrokerTls(p.env, fakeInspector({}, { dirs: { [p.dir]: { owner: OTHER } } }).inspector))).toBe("TLS_KEY_OWNER_FOREIGN");
    expect(await codeOf(resolveBrokerTls(p.env, fakeInspector({}, { dirs: { [p.dir]: { aces: [...okAces(), { type: "AccessAllowed", principal: "other" }] } } }).inspector))).toBe("TLS_KEY_ACL_OPEN");
  });

  it("an expired certificate is still served (the PIN is the trust decision) with a warning", async () => {
    const kp = generateEd25519();
    const m = mintEd25519Cert({ subjectCN: "OLD", issuerCN: "OLD", isCa: false, days: 1, signingKey: kp.privateKey, subjectSpkiDer: kp.publicKey.export({ type: "spki", format: "der" }) as Buffer, notBefore: new Date(Date.now() - 10 * 86_400_000) });
    const p = provisioned({ keyPem: kp.privateKeyPem, certPem: m.pem });
    expect(await codeOf(resolveBrokerTls(p.env, fakeInspector().inspector))).toBe("ok");
    expect(warnSpy.mock.calls.some((c) => /expired/i.test(String(c[0])))).toBe(true);
  });
});

describe("classifyFacts — one allow-list classifier for both platforms", () => {
  const c = Buffer.from("x");
  it("verdict order: link, hard link, foreign owner, open (null DACL / stranger allow), unverified, unprotected, ok", () => {
    expect(classifyFacts(okFile(c), ALLOWED)).toBe("ok");
    expect(classifyFacts(okFile(c, { link: true, owner: OTHER }), ALLOWED)).toBe("link");
    expect(classifyFacts(okFile(c, { links: 2, owner: OTHER }), ALLOWED)).toBe("link");
    expect(classifyFacts(okFile(c, { owner: OTHER, daclPresent: false }), ALLOWED)).toBe("foreign-owner");
    expect(classifyFacts(okFile(c, { daclPresent: false, aces: [] }), ALLOWED)).toBe("open");
    for (const s of [OTHER, "S-1-2-0", "S-1-5-113", "S-1-5-21-1-2-3-513", "S-1-5-11", "S-1-5-32-545", "S-1-1-0", "gid:1000", "other"]) {
      expect(classifyFacts(okFile(c, { aces: [...okAces(), { type: "AccessAllowed", principal: s }] }), ALLOWED), s).toBe("open");
      expect(classifyFacts(okFile(c, { aces: [...okAces(), { type: "AccessDenied", principal: s }] }), ALLOWED), s).toBe("ok");
    }
    expect(classifyFacts(okFile(c, { aces: [...okAces(), { type: "AccessAllowedCallback", principal: SY }] }), ALLOWED)).toBe("unverified");
    expect(classifyFacts(okFile(c, { aces: [{ type: "AccessAllowedObject", principal: "?" }] }), ALLOWED)).toBe("unverified");
    expect(classifyFacts(okFile(c, { protectedDacl: false }), ALLOWED)).toBe("unprotected");
    // an "open" verdict wins over "unverified" (exposure is the graver fact)
    expect(classifyFacts(okFile(c, { aces: [{ type: "AccessAllowed", principal: OTHER }, { type: "Weird", principal: SY }] }), ALLOWED)).toBe("open");
  });
  it("the server account may be LocalService / NetworkService / the built-in Administrator (full SIDs), and the owner may be SYSTEM or Administrators", () => {
    for (const svc of ["S-1-5-19", "S-1-5-20", "S-1-5-21-1393689357-3042344854-1725742880-500"]) {
      const allowed = new Set([svc, SY, BA]);
      const f = okFile(c, { owner: BA, aces: [{ type: "AccessAllowed", principal: svc }, { type: "AccessAllowed", principal: SY }, { type: "AccessAllowed", principal: BA }] });
      expect(classifyFacts(f, allowed), svc).toBe("ok");
      expect(classifyFacts(f, ALLOWED), svc).toBe("open");
    }
    expect(classifyFacts(okFile(c, { owner: SY }), ALLOWED)).toBe("ok");
    expect(classifyFacts(okFile(c, { owner: ME }), ALLOWED)).toBe("ok");
  });
});

describe("parseFactsReport — STRICT reader of the Windows helper's report (one handle: facts + bytes)", () => {
  const FILE = `OWNER=${BA}\nPROTECTED=1\nDACL=present\nACE=AccessAllowed|${SY}\nACE=AccessDenied|S-1-5-32-545\nPATHATTRS=32\nLINKS=1\nATTRS=32\nCONTENT=aGk=`;
  it("a well-formed report (CRLF too) ⇒ platform-neutral facts; reparse attribute on the path OR the handle ⇒ link", () => {
    expect(parseFactsReport(FILE.replace(/\n/g, "\r\n"))).toEqual({
      owner: BA, protectedDacl: true, daclPresent: true, link: false, links: 1, content: Buffer.from("hi"),
      aces: [{ type: "AccessAllowed", principal: SY }, { type: "AccessDenied", principal: "S-1-5-32-545" }],
    });
    expect(parseFactsReport(FILE.replace("PATHATTRS=32", "PATHATTRS=1056")).link).toBe(true);
    expect(parseFactsReport(FILE.replace("ATTRS=32", "ATTRS=1056")).link).toBe(true);
    expect(parseFactsReport(FILE.replace("DACL=present\n", "DACL=null\n").replace(/ACE=.*\n/g, "")).daclPresent).toBe(false);
  });
  it("OPENFAILED ⇒ InspectError(unreadable) carrying the reason; anything else off ⇒ throws (⇒ unverified)", () => {
    expect(() => parseFactsReport("OPENFAILED=Access to the path is denied.")).toThrow(InspectError);
    try { parseFactsReport("OPENFAILED=Access to the path is denied."); } catch (e) { expect((e as InspectError).kind).toBe("unreadable"); expect((e as Error).message).toContain("denied"); }
    for (const bad of [
      FILE.replace(`OWNER=${BA}`, "OWNER=BA"), // alias, not a SID
      FILE.replace("PROTECTED=1", "PROTECTED=yes"),
      FILE.replace("DACL=present", "DACL=null"), // ACEs with a null DACL
      FILE.replace(`ACE=AccessAllowed|${SY}`, "ACE=AccessAllowed|BU"),
      FILE.replace("LINKS=1\n", ""),
      FILE + "\nLINKS=1", // duplicate
      FILE + "\nEXTRA=1",
      FILE.replace("CONTENT=aGk=", "CONTENT=not base64!"),
      FILE + "\ngarbage line",
      FILE + "\nOPENFAILED=x", // mixed report
      "",
    ]) {
      expect(() => parseFactsReport(bad), bad.slice(-40)).toThrow();
      try { parseFactsReport(bad); } catch (e) { expect(e instanceof InspectError && (e as InspectError).kind === "unreadable", bad.slice(-40)).toBe(false); }
    }
  });
});

describe("makePosixInspector — owner uid, mode bits as ACEs, O_NOFOLLOW, nlink, bytes from the fd (injected deps)", () => {
  function deps(st: Partial<{ uid: number; gid: number; mode: number; nlink: number; isFile: boolean }>, o: { openErr?: string; content?: string; dir?: Partial<{ uid: number; mode: number; isSymlink: boolean }> } = {}) {
    const calls = { opened: [] as number[], closed: [] as number[], readFrom: [] as number[], lstat: [] as string[] };
    const stat = { uid: 1000, gid: 1000, mode: 0o100600, nlink: 1, isFile: true, ...st };
    const d = { uid: 0, mode: 0o040755, isSymlink: false, ...(o.dir ?? {}) };
    return {
      calls,
      deps: {
        getuid: () => 1000,
        openSync: (_p: string, flags: number) => { calls.opened.push(flags); if (o.openErr) { const e = new Error(o.openErr) as NodeJS.ErrnoException; e.code = o.openErr; throw e; } return 7; },
        fstatSync: () => ({ uid: stat.uid, gid: stat.gid, mode: stat.mode, nlink: stat.nlink, isFile: () => stat.isFile, size: Buffer.byteLength(o.content ?? "pem") }),
        readFileSync: (fd: number) => { calls.readFrom.push(fd); return Buffer.from(o.content ?? "pem"); },
        closeSync: (fd: number) => { calls.closed.push(fd); },
        lstatSync: (p: string) => { calls.lstat.push(p); return { uid: d.uid, gid: 0, mode: d.mode, isSymbolicLink: () => d.isSymlink, isDirectory: () => true }; },
      },
    };
  }
  it("0600 own file ⇒ owner uid:1000, a single own ACE, nlink 1, content from the fd; the fd is opened O_NOFOLLOW and closed", async () => {
    const d = deps({});
    const ins = makePosixInspector(d.deps as never);
    expect(await ins.allowedPrincipals()).toEqual(["uid:1000", "uid:0"]);
    const f = await ins.inspectAndReadFile("/etc/avi-aoi/mqtt-tls/broker.key");
    expect(f).toEqual({ owner: "uid:1000", daclPresent: true, protectedDacl: true, aces: [{ type: "AccessAllowed", principal: "uid:1000" }], link: false, links: 1, content: Buffer.from("pem") });
    expect(d.calls.opened[0] & 0x20000 /* O_NOFOLLOW on linux */).toBeTruthy();
    expect(d.calls.readFrom).toEqual([7]);
    expect(d.calls.closed).toEqual([7]);
    expect(classifyFacts(f, new Set(await ins.allowedPrincipals()))).toBe("ok");
  });
  it("group / other bits become stranger allow ACEs (⇒ open); root-owned 0400 is fine; nlink 2 and non-regular files are links; ELOOP ⇒ link", async () => {
    const allowed = new Set(["uid:1000", "uid:0"]);
    expect(classifyFacts(await makePosixInspector(deps({ mode: 0o100640 }).deps as never).inspectAndReadFile("k"), allowed)).toBe("open");
    expect(classifyFacts(await makePosixInspector(deps({ mode: 0o100604 }).deps as never).inspectAndReadFile("k"), allowed)).toBe("open");
    expect((await makePosixInspector(deps({ mode: 0o100666, gid: 5 }).deps as never).inspectAndReadFile("k")).aces).toEqual([
      { type: "AccessAllowed", principal: "uid:1000" }, { type: "AccessAllowed", principal: "gid:5" }, { type: "AccessAllowed", principal: "other" },
    ]);
    expect(classifyFacts(await makePosixInspector(deps({ uid: 0, mode: 0o100400 }).deps as never).inspectAndReadFile("k"), allowed)).toBe("ok");
    expect(classifyFacts(await makePosixInspector(deps({ uid: 33 }).deps as never).inspectAndReadFile("k"), allowed)).toBe("foreign-owner");
    expect(classifyFacts(await makePosixInspector(deps({ nlink: 2 }).deps as never).inspectAndReadFile("k"), allowed)).toBe("link");
    expect(classifyFacts(await makePosixInspector(deps({ isFile: false }).deps as never).inspectAndReadFile("k"), allowed)).toBe("link");
    expect((await makePosixInspector(deps({}, { openErr: "ELOOP" }).deps as never).inspectAndReadFile("k")).link).toBe(true);
    await expect(makePosixInspector(deps({}, { openErr: "EACCES" }).deps as never).inspectAndReadFile("k")).rejects.toMatchObject({ kind: "unreadable" });
  });
  it("folder facts: only WRITE bits for group/other count as stranger ACEs (0755 root is fine, 0775/0777 are not); a symlinked folder is a link", async () => {
    const allowed = new Set(["uid:1000", "uid:0"]);
    const at = async (dir: Partial<{ uid: number; mode: number; isSymlink: boolean }>) => classifyFacts({ ...(await makePosixInspector(deps({}, { dir }).deps as never).inspectDir!("/etc/avi-aoi/mqtt-tls")), links: 1, content: Buffer.alloc(0) }, allowed);
    expect(await at({ uid: 0, mode: 0o040755 })).toBe("ok");
    expect(await at({ uid: 1000, mode: 0o040700 })).toBe("ok");
    expect(await at({ uid: 0, mode: 0o040775 })).toBe("open");
    expect(await at({ uid: 0, mode: 0o040757 })).toBe("open");
    expect(await at({ uid: 33, mode: 0o040700 })).toBe("foreign-owner");
    expect(await at({ uid: 0, mode: 0o040755, isSymlink: true })).toBe("link");
  });
});

describe("bounded, asynchronous helper calls (unchanged from fix 3)", () => {
  it("timeout parsing: default 10 s, bounded 1–60 s", () => {
    expect(aclTimeoutMs({})).toBe(10_000);
    expect(aclTimeoutMs({ MQTT_TLS_ACL_TIMEOUT_MS: "2500" })).toBe(2500);
    expect(aclTimeoutMs({ MQTT_TLS_ACL_TIMEOUT_MS: "5" })).toBe(10_000);
    expect(aclTimeoutMs({ MQTT_TLS_ACL_TIMEOUT_MS: "x" })).toBe(10_000);
  });
  it.runIf(process.platform === "win32")("a hung helper is killed at the timeout and the event loop keeps running meanwhile", async () => {
    const saved = process.env.MQTT_TLS_ACL_TIMEOUT_MS;
    process.env.MQTT_TLS_ACL_TIMEOUT_MS = "1000";
    let ticks = 0;
    const t = setInterval(() => ticks++, 20);
    const t0 = Date.now();
    try {
      await expect(runBounded(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), ["-n", "8", "127.0.0.1"])).rejects.toThrow(/timed out after 1000 ms/);
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(ticks).toBeGreaterThan(10);
    } finally {
      clearInterval(t);
      if (saved === undefined) delete process.env.MQTT_TLS_ACL_TIMEOUT_MS; else process.env.MQTT_TLS_ACL_TIMEOUT_MS = saved;
    }
  }, 20_000);
});
