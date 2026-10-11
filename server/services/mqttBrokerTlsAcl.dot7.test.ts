/**
 * doc 81 Đợt 7 task J fix 1/2/3 (rulings R-7-a, R-7-b) — the built-in broker's TLS key material on WINDOWS.
 *   · allow-list by FULL SID (server account incl. LocalService / NetworkService / RID-500, SYSTEM, Administrators) for
 *     the owner and EVERY allow ACE; the DACL must be protected;
 *   · exposed (null DACL / stranger ACE) ⇒ DACL rebuilt AND refused, a ROTATE-REQUIRED marker keeps refusing on every
 *     later start; foreign owner / hard link / reparse point ⇒ refused and never touched;
 *   · first start builds the key in a staging folder locked down and verified EMPTY, then renamed into place;
 *   · the key file is checked through its own handle and read from that handle;
 *   · every Windows call is async with a timeout.
 * Oracles independent of the product code: PowerShell Get-Acl (SIDs) and `fsutil`-free link counts via Node fstat;
 * hand-written reports for the strict parser. Real-ACL cases run only on win32 (this process is not elevated — a REAL
 * foreign owner cannot be produced, that case uses a fake). Temp dirs only — never the repo's data/.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import {
  BrokerTlsError,
  type DescriptorFacts,
  type FileFacts,
  type KeyFileAcl,
  ROTATE_MARKER,
  SITE_TLS_FILE_NAME,
  aclTimeoutMs,
  classifyFacts,
  loadConfiguredBrokerTls,
  loadOrCreateSiteBrokerTls,
  mintSiteBrokerCertificate,
  parseFactsReport,
  resolveBrokerTls,
  runBounded,
  windowsKeyFileAcl,
} from "./mqttBrokerTls";

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-jacl-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) {
    if (process.platform === "win32") {
      try { execFileSync("icacls", [d, "/reset", "/T", "/C", "/Q"], { stdio: "ignore", windowsHide: true }); } catch { /* best effort */ }
    }
    fs.rmSync(d, { recursive: true, force: true });
  }
});
const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterAll(() => errSpy.mockRestore());

const ME = "S-1-5-21-1393689357-3042344854-1725742880-1000";
const OTHER = "S-1-5-21-1393689357-3042344854-1725742880-1002";
const SY = "S-1-5-18";
const BA = "S-1-5-32-544";
const ALLOWED = new Set([ME, SY, BA]);
const okFacts = (over: Partial<DescriptorFacts> = {}): DescriptorFacts => ({
  owner: ME, protectedDacl: true, daclPresent: true, pathAttributes: 16,
  aces: [{ type: "AccessAllowed", sid: ME }, { type: "AccessAllowed", sid: SY }, { type: "AccessAllowed", sid: BA }],
  ...over,
});
const okFile = (content: Buffer, over: Partial<FileFacts> = {}): FileFacts => ({ ...okFacts({ pathAttributes: 32 }), links: 1, attributes: 32, content, ...over });
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
}

describe("parseFactsReport — strict", () => {
  const FILE = `OWNER=${ME}\nPROTECTED=1\nDACL=present\nACE=AccessAllowed|${SY}\nACE=AccessDenied|S-1-5-32-545\nPATHATTRS=32\nLINKS=1\nATTRS=32\nCONTENT=aGk=`;
  it("a well-formed file report (CRLF too) and a folder report", () => {
    const f = parseFactsReport(FILE.replace(/\n/g, "\r\n"), "file") as FileFacts;
    expect(f).toEqual({ owner: ME, protectedDacl: true, daclPresent: true, pathAttributes: 32, links: 1, attributes: 32, content: Buffer.from("hi"),
      aces: [{ type: "AccessAllowed", sid: SY }, { type: "AccessDenied", sid: "S-1-5-32-545" }] });
    expect(parseFactsReport(`OWNER=${ME}\nPROTECTED=0\nDACL=null\nPATHATTRS=16`, "dir")).toEqual({ owner: ME, protectedDacl: false, daclPresent: false, aces: [], pathAttributes: 16 });
  });
  it("anything off ⇒ throws", () => {
    for (const bad of [
      FILE.replace("OWNER=" + ME, "OWNER=SY"), // alias, not a SID
      FILE.replace("PROTECTED=1", "PROTECTED=yes"),
      FILE.replace("DACL=present", "DACL=null"), // ACEs with a null DACL
      FILE.replace(`ACE=AccessAllowed|${SY}`, "ACE=AccessAllowed|BU"),
      FILE.replace("LINKS=1\n", ""),
      FILE + "\nLINKS=1", // duplicate
      FILE + "\nEXTRA=1",
      FILE.replace("CONTENT=aGk=", "CONTENT=not base64!"),
      FILE + "\ngarbage line",
      "",
    ]) {
      expect(() => parseFactsReport(bad, "file"), bad.slice(-40)).toThrow();
    }
    expect(() => parseFactsReport(FILE, "dir")).toThrow(); // file-only keys in a folder report
  });
});

describe("classifyFacts — allow-list by full SID", () => {
  const c = Buffer.from("x");
  it("ok / reparse / hard link / foreign owner / exposed / unverified / unprotected", () => {
    expect(classifyFacts(okFile(c), ALLOWED)).toBe("ok");
    expect(classifyFacts(okFile(c, { pathAttributes: 32 | 0x400 }), ALLOWED)).toBe("reparse");
    expect(classifyFacts(okFile(c, { attributes: 0x400 }), ALLOWED)).toBe("reparse");
    expect(classifyFacts(okFile(c, { links: 2 }), ALLOWED)).toBe("hardlink");
    expect(classifyFacts(okFile(c, { owner: OTHER }), ALLOWED)).toBe("foreign-owner");
    expect(classifyFacts(okFacts({ daclPresent: false, aces: [] }), ALLOWED)).toBe("exposed"); // null DACL
    for (const s of [OTHER, "S-1-2-0", "S-1-5-113", "S-1-5-21-1-2-3-513", "S-1-5-11", "S-1-5-32-545", "S-1-1-0"]) {
      expect(classifyFacts(okFacts({ aces: [...okFacts().aces, { type: "AccessAllowed", sid: s }] }), ALLOWED), s).toBe("exposed");
      expect(classifyFacts(okFacts({ aces: [...okFacts().aces, { type: "AccessDenied", sid: s }] }), ALLOWED), s).toBe("ok");
    }
    expect(classifyFacts(okFacts({ aces: [...okFacts().aces, { type: "AccessAllowedCallback", sid: SY }] }), ALLOWED)).toBe("unverified");
    expect(classifyFacts(okFacts({ aces: [...okFacts().aces, { type: "AccessAllowedObject", sid: "?" }] }), ALLOWED)).toBe("unverified");
    expect(classifyFacts(okFacts({ protectedDacl: false }), ALLOWED)).toBe("unprotected");
  });
  it("F3 — LocalService / NetworkService / built-in Administrator as the server account match by SID", () => {
    for (const svc of ["S-1-5-19", "S-1-5-20", "S-1-5-21-1393689357-3042344854-1725742880-500"]) {
      const allowed = new Set([svc, SY, BA]);
      const f = okFacts({ owner: svc, aces: [{ type: "AccessAllowed", sid: svc }, { type: "AccessAllowed", sid: SY }] });
      expect(classifyFacts(f, allowed), svc).toBe("ok");
      expect(classifyFacts(f, ALLOWED), svc).toBe("foreign-owner");
    }
  });
});

/** Fake Windows layer over REAL files: facts per path (default ok), content read from disk, rebuild ⇒ ok. */
function fakeAcl(over: Record<string, Partial<FileFacts>> = {}, o: { onRebuild?: (t: string) => void; rebuildThrows?: boolean } = {}) {
  const facts = new Map(Object.entries(over));
  const calls = { rebuilt: [] as string[], read: [] as string[] };
  const acl: KeyFileAcl = {
    allowedSids: async () => [ME, SY, BA],
    inspectDir: async (d) => ({ ...okFacts(), ...(facts.get(d) ?? {}) }),
    inspectAndReadFile: async (f) => {
      calls.read.push(f);
      return { ...okFile(fs.readFileSync(f)), ...(facts.get(f) ?? {}) } as FileFacts;
    },
    createPrivateDir: async (d) => {
      calls.rebuilt.push(`create:${d}`);
      fs.mkdirSync(d);
      o.onRebuild?.(d);
    },
    rebuild: async (t) => {
      calls.rebuilt.push(t);
      if (o.rebuildThrows) throw new Error("denied");
      o.onRebuild?.(t);
      const prev = facts.get(t);
      if (prev && prev.owner === undefined) facts.delete(t);
      else if (prev) facts.set(t, { owner: prev.owner });
    },
  };
  return { acl, calls, facts };
}
function siteWithKey(): { dir: string; file: string; pem: string } {
  const dir = path.join(tempDir(), "mqtt-tls");
  fs.mkdirSync(dir);
  const p = mintSiteBrokerCertificate({ commonName: "SITE", days: 30 });
  const file = path.join(dir, SITE_TLS_FILE_NAME);
  fs.writeFileSync(file, p.keyPem + p.certPem);
  return { dir, file, pem: p.keyPem + p.certPem };
}

describe("existing material (fake Windows layer)", () => {
  it("★ F1 an EXPOSED key is locked down and STILL refused; a marker keeps refusing on every later start", async () => {
    const { dir, file, pem } = siteWithKey();
    const f = fakeAcl({ [file]: { aces: [...okFacts().aces, { type: "AccessAllowed", sid: "S-1-5-11" }] } });
    errSpy.mockClear();
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_EXPOSED");
    expect(f.calls.rebuilt).toEqual([file]);
    expect(errSpy.mock.calls.some((c) => /key may be exposed: ROTATE/.test(String(c[0])))).toBe(true);
    expect(fs.existsSync(path.join(dir, ROTATE_MARKER))).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(pem); // not adopted, not replaced
    // the DACL is clean now, but the key is never used again until rotated
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir, acl: fakeAcl().acl }))).toBe("TLS_KEY_EXPOSED");
    // rotation per DEPLOY_LAN_GUIDE: move the folder away ⇒ a NEW key
    fs.renameSync(dir, `${dir}.revoked`);
    const fresh = await loadOrCreateSiteBrokerTls({ dir, acl: fakeAcl().acl });
    expect(fresh.created).toBe(true);
  });

  it("★ F1 an exposed FOLDER (stranger ACE) ⇒ folder locked down + marker + refused, the key is not even read", async () => {
    const { dir } = siteWithKey();
    const f = fakeAcl({ [dir]: { aces: [...okFacts().aces, { type: "AccessAllowed", sid: "S-1-5-11" }] } });
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_EXPOSED");
    expect(f.calls.rebuilt).toEqual([dir]);
    expect(f.calls.read).toEqual([]);
    expect(fs.existsSync(path.join(dir, ROTATE_MARKER))).toBe(true);
  });

  it("null DACL ⇒ exposed; unprotected / unverified ⇒ locked down and refused for THIS start only (no marker)", async () => {
    const a = siteWithKey();
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: a.dir, acl: fakeAcl({ [a.file]: { daclPresent: false, aces: [] } }).acl }))).toBe("TLS_KEY_EXPOSED");
    const b = siteWithKey();
    const fb = fakeAcl({ [b.file]: { protectedDacl: false } });
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: b.dir, acl: fb.acl }))).toBe("TLS_KEY_ACL_UNPROTECTED");
    expect(fb.calls.rebuilt).toEqual([b.file]);
    expect(fs.existsSync(path.join(b.dir, ROTATE_MARKER))).toBe(false);
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: b.dir, acl: fb.acl }))).toBe("ok"); // now protected
    const c = siteWithKey();
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: c.dir, acl: fakeAcl({ [c.file]: { aces: [{ type: "AccessAllowedCallback", sid: SY }] } }).acl }))).toBe("TLS_KEY_ACL_UNVERIFIED");
  });

  it("★ F2 hard link / reparse point / foreign owner ⇒ refused and NEVER rebuilt (a rebuild would hit the link target)", async () => {
    for (const [over, code] of [
      [{ links: 2 }, "TLS_KEY_LINKED"],
      [{ pathAttributes: 32 | 0x400 }, "TLS_KEY_LINKED"],
      [{ owner: OTHER }, "TLS_KEY_OWNER_FOREIGN"],
      [{ owner: OTHER, aces: [{ type: "AccessAllowed", sid: "S-1-5-11" }] }, "TLS_KEY_OWNER_FOREIGN"],
    ] as const) {
      const s = siteWithKey();
      const f = fakeAcl({ [s.file]: over as Partial<FileFacts> });
      expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: s.dir, acl: f.acl })), JSON.stringify(over)).toBe(code);
      expect(f.calls.rebuilt).toEqual([]);
      expect(fs.existsSync(path.join(s.dir, ROTATE_MARKER))).toBe(false);
    }
    const s = siteWithKey();
    const f = fakeAcl({ [s.dir]: { owner: OTHER } });
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir: s.dir, acl: f.acl }))).toBe("TLS_KEY_OWNER_FOREIGN");
    expect(f.calls).toEqual({ rebuilt: [], read: [] });
  });

  it("the key bytes used are the ones read through the checked handle (not a second read by path)", async () => {
    const { dir, file } = siteWithKey();
    const other = mintSiteBrokerCertificate({ commonName: "VIA-HANDLE", days: 30 });
    const f = fakeAcl({ [file]: { content: Buffer.from(other.keyPem + other.certPem) } });
    const m = await loadOrCreateSiteBrokerTls({ dir, acl: f.acl });
    expect(m.certPem.trim()).toBe(other.certPem.trim());
  });
});

describe("first start (fake Windows layer)", () => {
  it("staging folder: created WITH its DACL, verified empty, key file locked down while EMPTY, then renamed into place", async () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    const seen: Array<{ t: string; size: number }> = [];
    const f = fakeAcl({}, { onRebuild: (t) => seen.push({ t, size: fs.statSync(t).isDirectory() ? -1 : fs.statSync(t).size }) });
    const m = await loadOrCreateSiteBrokerTls({ dir, acl: f.acl });
    expect(m.created).toBe(true);
    expect(m.file).toBe(path.join(dir, SITE_TLS_FILE_NAME));
    expect(f.calls.rebuilt[0]).toMatch(/^create:.*mqtt-tls\.\d+\.[0-9a-f]+\.new$/);
    expect(seen[0].t).toMatch(/mqtt-tls\.\d+\.[0-9a-f]+\.new$/);
    expect(seen[0].size).toBe(-1);
    expect(seen[1].t).toBe(path.join(seen[0].t, SITE_TLS_FILE_NAME));
    expect(seen[1].size).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([SITE_TLS_FILE_NAME]);
    expect(fs.readdirSync(path.dirname(dir))).toEqual(["mqtt-tls"]); // no staging left
  });

  it("★ F2 something found in the new folder before the key is written ⇒ TLS_KEY_DIR_NOT_EMPTY, nothing put in place", async () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    const f = fakeAcl({}, { onRebuild: (t) => { if (t.endsWith(".new")) fs.writeFileSync(path.join(t, SITE_TLS_FILE_NAME), "planted"); } });
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_DIR_NOT_EMPTY");
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readdirSync(path.dirname(dir))).toEqual([]);
  });

  it("the folder appears meanwhile: a foreign one is refused; one of ours with a valid key is used (no second key)", async () => {
    const parent = tempDir();
    const dir = path.join(parent, "mqtt-tls");
    const realRename = fs.renameSync;
    const winner = mintSiteBrokerCertificate({ commonName: "WINNER", days: 30 });
    let spy = vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, SITE_TLS_FILE_NAME), winner.keyPem + winner.certPem);
      return realRename(a, b);
    });
    try {
      expect(await codeOf(loadOrCreateSiteBrokerTls({ dir, acl: fakeAcl({ [dir]: { owner: OTHER } }).acl }))).toBe("TLS_KEY_OWNER_FOREIGN");
    } finally { spy.mockRestore(); }
    fs.rmSync(dir, { recursive: true, force: true });
    spy = vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, SITE_TLS_FILE_NAME), winner.keyPem + winner.certPem);
      return realRename(a, b);
    });
    try {
      const m = await loadOrCreateSiteBrokerTls({ dir, acl: fakeAcl().acl });
      expect(m.created).toBe(false);
      expect(m.certPem.trim()).toBe(winner.certPem.trim());
      expect(fs.readdirSync(parent)).toEqual(["mqtt-tls"]);
    } finally { spy.mockRestore(); }
  });
});

describe("operator material (fake Windows layer)", () => {
  function operator() {
    const dir = tempDir();
    const p = mintSiteBrokerCertificate({ commonName: "OP", days: 30 });
    const c = path.join(dir, "c.pem");
    const k = path.join(dir, "k.pem");
    fs.writeFileSync(c, p.certPem);
    fs.writeFileSync(k, p.keyPem);
    return { dir, c, k };
  }
  it("exposed key ⇒ rebuilt + refused + <key>.ROTATE-REQUIRED; foreign-owned cert ⇒ refused; exposed folder ⇒ refused but NOT modified", async () => {
    const a = operator();
    const fa = fakeAcl({ [a.k]: { aces: [...okFacts().aces, { type: "AccessAllowed", sid: "S-1-5-11" }] } });
    expect(await codeOf(loadConfiguredBrokerTls(a.c, a.k, fa.acl))).toBe("TLS_KEY_EXPOSED");
    expect(fa.calls.rebuilt).toEqual([a.k]);
    expect(fs.existsSync(`${a.k}.${ROTATE_MARKER}`)).toBe(true);
    expect(await codeOf(loadConfiguredBrokerTls(a.c, a.k, fakeAcl().acl))).toBe("TLS_KEY_EXPOSED"); // until rotated
    const b = operator();
    expect(await codeOf(loadConfiguredBrokerTls(b.c, b.k, fakeAcl({ [b.c]: { owner: OTHER } }).acl))).toBe("TLS_KEY_OWNER_FOREIGN");
    const c = operator();
    const fc = fakeAcl({ [c.dir]: { aces: [...okFacts().aces, { type: "AccessAllowed", sid: "S-1-5-11" }] } });
    expect(await codeOf(loadConfiguredBrokerTls(c.c, c.k, fc.acl))).toBe("TLS_KEY_EXPOSED");
    expect(fc.calls).toEqual({ rebuilt: [], read: [] });
    const d = operator();
    expect(await codeOf(resolveBrokerTls({ MQTT_TLS_CERT: d.c, MQTT_TLS_KEY: d.k }, fakeAcl({ [d.dir]: { protectedDacl: false } }).acl))).toBe("ok");
  });
});

describe("F5 — bounded, asynchronous helper calls", () => {
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

// ── real Windows ──────────────────────────────────────────────────────────────────────────────────────────────
function realDescriptor(p: string): { owner: string; sids: string[]; protectedAcl: boolean } {
  const ps =
    "$a = Get-Acl -LiteralPath $env:J_PATH; Write-Output ('P=' + $a.AreAccessRulesProtected); " +
    "Write-Output ('O=' + $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); " +
    "$a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { Write-Output ('S=' + $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) }";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, env: { ...process.env, J_PATH: p } });
  return { protectedAcl: /P=True/.test(out), owner: out.match(/^O=(\S+)/m)?.[1] ?? "", sids: [...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1]) };
}
function mySid(): string {
  const out = execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  return out.match(/"(S-1-[0-9-]+)"\s*$/m)![1];
}
function expectPrivate(p: string) {
  const a = realDescriptor(p);
  const allowed = [mySid(), SY, BA];
  expect(a.protectedAcl, `${p}: protected`).toBe(true);
  expect(allowed, `${p}: owner`).toContain(a.owner);
  expect(new Set(a.sids)).toEqual(new Set(allowed));
}
function setSddl(p: string, sddl: string) {
  const ps =
    "$i = Get-Item -LiteralPath $env:J_PATH -Force; $s = New-Object System.Security.AccessControl.FileSecurity; " +
    "$s.SetSecurityDescriptorSddlForm($env:J_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); $i.SetAccessControl($s)";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true, env: { ...process.env, J_PATH: p, J_SDDL: sddl } });
}

/** A site folder + key as a PREVIOUS start of this server left them: both locked down for real. */
async function realSiteWithKey() {
  const s = siteWithKey();
  await windowsKeyFileAcl.rebuild(s.dir, true);
  await windowsKeyFileAcl.rebuild(s.file, false);
  return s;
}

describe.runIf(process.platform === "win32")("Windows — REAL descriptors and links, checked with Get-Acl / fstat", () => {
  it("first start under a parent granting Users + Authenticated Users: folder + key protected, allow-list only, single link, no staging left", async () => {
    const parent = tempDir();
    execFileSync("icacls", [parent, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)", "*S-1-5-11:(OI)(CI)(M)"], { stdio: "ignore", windowsHide: true });
    const dir = path.join(parent, "mqtt-tls");
    expect((await loadOrCreateSiteBrokerTls({ dir })).created).toBe(true);
    expectPrivate(dir);
    expectPrivate(path.join(dir, SITE_TLS_FILE_NAME));
    expect(fs.statSync(path.join(dir, SITE_TLS_FILE_NAME)).nlink).toBe(1);
    expect(fs.readdirSync(parent)).toEqual(["mqtt-tls"]);
    expect((await loadOrCreateSiteBrokerTls({ dir })).created).toBe(false); // second start uses it
  }, 120_000);

  it("★ F1 a key of ours granted to LOCAL / Local account / Everyone / Users ⇒ locked down, REFUSED, marker written", async () => {
    const { dir, file } = await realSiteWithKey();
    expect((await loadOrCreateSiteBrokerTls({ dir })).created).toBe(false); // the untouched key is fine
    execFileSync("icacls", [file, "/grant", "*S-1-2-0:(R)", "*S-1-5-113:(R)", "*S-1-1-0:(R)", "*S-1-5-32-545:(R)"], { stdio: "ignore", windowsHide: true });
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir }))).toBe("TLS_KEY_EXPOSED");
    expectPrivate(file); // locked down
    expect(fs.existsSync(path.join(dir, ROTATE_MARKER))).toBe(true);
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir }))).toBe("TLS_KEY_EXPOSED"); // still refused
  }, 120_000);

  it("a REAL null DACL ⇒ TLS_KEY_EXPOSED", async () => {
    const { dir, file } = await realSiteWithKey();
    setSddl(file, "D:NO_ACCESS_CONTROL");
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir }))).toBe("TLS_KEY_EXPOSED");
  }, 120_000);

  it("★ F2 REAL hard link: broker-tls.pem hard-linked to an attacker-written file elsewhere ⇒ TLS_KEY_LINKED, the target's DACL untouched", async () => {
    const { dir, file } = await realSiteWithKey();
    const attacker = mintSiteBrokerCertificate({ commonName: "ATTACKER", days: 30 });
    const outside = path.join(path.dirname(dir), "ot-store-forward.jsonl");
    fs.writeFileSync(outside, `{"x":1}\n${attacker.keyPem}${attacker.certPem}`);
    execFileSync("icacls", [outside, "/grant", "*S-1-5-11:(M)"], { stdio: "ignore", windowsHide: true });
    const before = realDescriptor(outside);
    fs.unlinkSync(file);
    fs.linkSync(outside, file);
    expect(fs.statSync(file).nlink).toBe(2);
    expect(await codeOf(loadOrCreateSiteBrokerTls({ dir }))).toBe("TLS_KEY_LINKED");
    expect(realDescriptor(outside)).toEqual(before); // never rebuilt through the link
  }, 120_000);

  it("★ F2 REAL first-start race: a concurrent process hard-links a planted file into every new folder it sees ⇒ never adopted", async () => {
    const parent = tempDir();
    const attacker = mintSiteBrokerCertificate({ commonName: "RACER", days: 30 });
    const bait = path.join(parent, "bait.jsonl");
    fs.writeFileSync(bait, attacker.keyPem + attacker.certPem);
    // the racer polls the parent and links the bait into any folder that appears (before it is locked down)
    const racer = spawn(process.execPath, ["-e", `
      const fs=require("fs"),path=require("path");const parent=${JSON.stringify(parent)},bait=${JSON.stringify(bait)};
      const end=Date.now()+15000;const done=new Set();
      (function loop(){ for(const n of fs.readdirSync(parent)){ const p=path.join(parent,n);
        if(!done.has(p)&&fs.statSync(p).isDirectory()){ done.add(p); try{ fs.linkSync(bait,path.join(p,"broker-tls.pem")); process.stdout.write("LINKED "+n+"\\n"); }catch(e){ process.stdout.write("DENIED "+n+" "+e.code+"\\n"); } } }
        if(Date.now()<end) setImmediate(loop); })();`], { stdio: ["ignore", "pipe", "ignore"] });
    let racerOut = "";
    racer.stdout!.on("data", (d) => { racerOut += d; });
    await new Promise((r) => setTimeout(r, 300)); // racer is polling
    const dir = path.join(parent, "mqtt-tls");
    const res = await loadOrCreateSiteBrokerTls({ dir }).then((m) => ({ ok: true as const, m }), (e) => ({ ok: false as const, code: (e as BrokerTlsError).code }));
    racer.kill();
    // The racer runs as THIS account (no second account in the lab), i.e. an ALLOWED SID — the private-from-birth DACL
    // cannot stop it, so the empty-check must: the planted link is found and refused, never adopted.
    const LINE = attacker.certPem.split(String.fromCharCode(10))[1];
    if (res.ok) {
      expect(res.m.certPem).not.toContain(LINE);
      expect(fs.statSync(path.join(dir, SITE_TLS_FILE_NAME)).nlink).toBe(1);
      expectPrivate(path.join(dir, SITE_TLS_FILE_NAME));
    } else {
      expect(["TLS_KEY_DIR_NOT_EMPTY", "TLS_KEY_LINKED"]).toContain(res.code);
      expect(fs.existsSync(dir)).toBe(false); // nothing put in place
    }
    expect(racerOut).toMatch(/(LINKED|DENIED) mqtt-tls\.\d+\.[0-9a-f]+\.new/); // it did see and attack the staging folder
    expect(fs.statSync(bait).nlink).toBeGreaterThanOrEqual(1);
    expect(racerOut.length).toBeGreaterThan(0); // the racer really saw (and attacked) the new folder
  }, 120_000);

  it("the real Windows layer runs asynchronously (event loop keeps ticking during Get-Acl)", async () => {
    let ticks = 0;
    const t = setInterval(() => ticks++, 10);
    try {
      await windowsKeyFileAcl.inspectDir(tempDir());
    } finally { clearInterval(t); }
    expect(ticks).toBeGreaterThan(3);
  }, 60_000);
});
