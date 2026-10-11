/**
 * doc 81 Đợt 7 task J fix 1 + fix 2 (ruling R-7-a) — the built-in broker's private key on WINDOWS (production host).
 * ALLOW-LIST by SID: only the server account, SYSTEM and Administrators may OWN the folder / key / certificate or appear
 * in ANY allow ACE. Foreign owner ⇒ possibly planted ⇒ refused, never repaired. Other trustees with our own owner ⇒
 * DACL rebuilt from scratch. Null DACL / conditional / unknown ACE / unparseable / unreadable ⇒ unverified ⇒ no TLS.
 *
 * Oracles independent of the product code:
 *   · the REAL descriptor read back with PowerShell `Get-Acl` (identities translated to SIDs) — not via the module;
 *   · the strict SDDL parser is checked against strings captured from this host and hand-written adversarial ones.
 * Real-ACL cases run only on win32 (this process is NOT elevated, so a foreign OWNER cannot be produced for real — that
 * case uses an injected fake descriptor); everything else runs on every platform. Temp dirs only — never data/.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  BrokerTlsError,
  type KeyFileAcl,
  SITE_TLS_FILE_NAME,
  ensurePrivate,
  loadConfiguredBrokerTls,
  loadOrCreateSiteBrokerTls,
  mintSiteBrokerCertificate,
  parseSecurityDescriptor,
  resolveBrokerTls,
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
const OTHER_USER = "S-1-5-21-1393689357-3042344854-1725742880-1002";
const PRIVATE = (owner = ME) => `O:${owner}G:${ME}D:PAI(A;;FA;;;${ME})(A;;FA;;;SY)(A;;FA;;;BA)`;
const codeOf = (fn: () => unknown): string => {
  try { fn(); return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
};

/** Fake descriptor store: target → SDDL; rebuild writes the allow-list DACL (unless told to fail / leave a stranger). */
function fakeAcl(init: Record<string, string> = {}, o: { rebuildThrows?: boolean; rebuildLeaves?: string; readThrows?: boolean } = {}) {
  const map = new Map(Object.entries(init));
  const rebuilt: string[] = [];
  const acl: KeyFileAcl = {
    allowedSids: () => [ME, "S-1-5-18", "S-1-5-32-544"],
    readSddl: (t) => {
      if (o.readThrows) throw new Error("Get-Acl failed");
      return map.get(t) ?? PRIVATE();
    },
    rebuild: (t, isDir) => {
      rebuilt.push(`${t}${isDir ? " (dir)" : ""}`);
      if (o.rebuildThrows) throw new Error("access denied");
      const owner = parseSecurityDescriptor(map.get(t) ?? PRIVATE()).owner;
      map.set(t, o.rebuildLeaves ? `${PRIVATE(owner)}(A;;FR;;;${o.rebuildLeaves})` : PRIVATE(owner));
    },
  };
  return { acl, map, rebuilt };
}

describe("parseSecurityDescriptor — strict, fails on anything it cannot account for", () => {
  it("strings captured from this host's Get-Acl: owner + every allow trustee (SY/BA expanded, other aliases kept)", () => {
    expect(parseSecurityDescriptor(`O:${ME}G:${ME.replace(/1000$/, "513")}D:(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;${ME})`)).toEqual({
      owner: ME, allowTrustees: ["S-1-5-18", "S-1-5-32-544", ME],
    });
    const data = parseSecurityDescriptor("O:BAG:SYD:AI(A;ID;FA;;;BA)(A;OICIIOID;GA;;;BA)(A;ID;0x1301bf;;;AU)(A;OICIIOID;SDGXGWGR;;;AU)(A;ID;0x1200a9;;;BU)");
    expect(data.owner).toBe("S-1-5-32-544");
    expect(data.allowTrustees).toEqual(["S-1-5-32-544", "S-1-5-32-544", "AU", "AU", "BU"]);
    expect(parseSecurityDescriptor(`O:${ME}D:PAI(D;;FA;;;BU)(A;;FA;;;SY)`).allowTrustees).toEqual(["S-1-5-18"]); // deny never grants
  });

  it("unverifiable ⇒ throws: null DACL (no D:), NO_ACCESS_CONTROL, conditional/object/unknown ACE, malformed, stray text, no owner", () => {
    for (const bad of [
      `O:${ME}G:${ME}`, // Get-Acl .Sddl of a NULL DACL (seen on this host)
      `O:${ME}G:${ME}D:NO_ACCESS_CONTROL`,
      `O:${ME}D:PAINO_ACCESS_CONTROL`, // icacls /save form
      `O:${ME}D:PAI(XA;;FR;;;WD;(Member_of {SID(BA)}))(A;;FA;;;SY)`, // conditional ACE
      `O:${ME}D:PAI(A;;FA;;;SY)(XA;;FR;;;BU;(@User.x == 1))`,
      `O:${ME}D:PAI(OA;;RP;bf967a68-0de6-11d0-a285-00aa003049e2;;BU)`, // object ACE
      `O:${ME}D:PAI(ZZ;;FA;;;SY)`, // unknown type
      `O:${ME}D:PAI(A;;FA;;SY)`, // 5 fields
      `O:${ME}D:PAI(A;;FA;;;SY)junk`,
      `O:${ME}D:PAI(A;;FA;;;SY`,
      `O:${ME}D:QQ(A;;FA;;;SY)`, // unknown flags
      `G:${ME}D:PAI(A;;FA;;;SY)`, // no owner
      "",
    ]) {
      expect(() => parseSecurityDescriptor(bad), bad).toThrow();
    }
  });
});

describe("allow-list evaluation (fake descriptors, every platform)", () => {
  it("ANY trustee outside {server account, SYSTEM, Administrators} opens the key — and the DACL is REBUILT, not trimmed", () => {
    for (const stranger of [OTHER_USER, "S-1-2-0", "S-1-5-113", "S-1-5-21-1-2-3-513", "AU", "BU", "WD", "CO", "OW"]) {
      const f = fakeAcl({ "/k": `O:${ME}D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;${stranger})` });
      errSpy.mockClear();
      expect(codeOf(() => ensurePrivate(f.acl, "/k", false)), stranger).toBe("ok");
      expect(f.rebuilt).toEqual(["/k"]);
      expect(f.map.get("/k")).toBe(PRIVATE());
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes(stranger))).toBe(true);
    }
  });

  it("a rebuild that leaves a stranger ⇒ TLS_KEY_ACL_OPEN; rebuild fails ⇒ TLS_KEY_ACL_OPEN; unreadable / null DACL ⇒ TLS_KEY_ACL_UNVERIFIED", () => {
    const open = `O:${ME}D:PAI(A;;FR;;;S-1-2-0)`;
    expect(codeOf(() => ensurePrivate(fakeAcl({ "/k": open }, { rebuildLeaves: "S-1-5-113" }).acl, "/k", false))).toBe("TLS_KEY_ACL_OPEN");
    expect(codeOf(() => ensurePrivate(fakeAcl({ "/k": open }, { rebuildThrows: true }).acl, "/k", false))).toBe("TLS_KEY_ACL_OPEN");
    expect(codeOf(() => ensurePrivate(fakeAcl({}, { readThrows: true }).acl, "/k", false))).toBe("TLS_KEY_ACL_UNVERIFIED");
    expect(codeOf(() => ensurePrivate(fakeAcl({ "/k": `O:${ME}G:${ME}` }).acl, "/k", false))).toBe("TLS_KEY_ACL_UNVERIFIED");
  });

  it("★ foreign OWNER ⇒ TLS_KEY_OWNER_FOREIGN and NEVER repaired (even when its DACL looks private)", () => {
    for (const owner of [OTHER_USER, "S-1-5-11", "BU", "CO"]) {
      const f = fakeAcl({ "/k": `O:${owner}D:PAI(A;;FA;;;SY)(A;;FR;;;S-1-2-0)` });
      expect(codeOf(() => ensurePrivate(f.acl, "/k", false)), owner).toBe("TLS_KEY_OWNER_FOREIGN");
      expect(f.rebuilt).toEqual([]);
      const g = fakeAcl({ "/k": PRIVATE(owner) });
      expect(codeOf(() => ensurePrivate(g.acl, "/k", false)), owner).toBe("TLS_KEY_OWNER_FOREIGN");
    }
  });

  it("★ a key PLANTED in the folder before the first start ⇒ refused before it is read, nothing rebuilt on it", () => {
    const dir = tempDir();
    const p = mintSiteBrokerCertificate({ commonName: "ATTACKER", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, p.keyPem + p.certPem);
    const f = fakeAcl({ [file]: `O:${OTHER_USER}D:AI(A;ID;FA;;;${OTHER_USER})(A;ID;0x1301bf;;;AU)` });
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_OWNER_FOREIGN");
    expect(f.rebuilt.filter((t) => t.startsWith(file))).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe(p.keyPem + p.certPem); // never adopted, never touched
  });

  it("★ a pre-existing FOLDER with a foreign owner ⇒ refused, no key written into it", () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    fs.mkdirSync(dir);
    const f = fakeAcl({ [dir]: `O:${OTHER_USER}D:AI(A;OICIID;FA;;;${OTHER_USER})` });
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_OWNER_FOREIGN");
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(f.rebuilt).toEqual([]);
  });

  it("a file planted between our mkdir and our link (EEXIST) is verified like any existing one ⇒ refused", () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    const evil = mintSiteBrokerCertificate({ commonName: "RACE", days: 30 });
    const f = fakeAcl({ [file]: `O:${OTHER_USER}D:PAI(A;;FA;;;${OTHER_USER})` });
    const realLink = fs.linkSync;
    const spy = vi.spyOn(fs, "linkSync").mockImplementation((src, dst) => {
      fs.writeFileSync(file, evil.keyPem + evil.certPem);
      return realLink(src, dst);
    });
    try {
      expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir, acl: f.acl }))).toBe("TLS_KEY_OWNER_FOREIGN");
    } finally {
      spy.mockRestore();
    }
  });

  it("generation: folder created NON-recursively and rebuilt first; the EMPTY temp file rebuilt before the key is written", () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    const seen: Array<{ t: string; size: number }> = [];
    const f = fakeAcl();
    const acl: KeyFileAcl = { ...f.acl, rebuild: (t, d) => { seen.push({ t, size: fs.statSync(t).isDirectory() ? -1 : fs.statSync(t).size }); f.acl.rebuild(t, d); } };
    const m = loadOrCreateSiteBrokerTls({ dir, acl });
    expect(m.created).toBe(true);
    expect(seen[0]).toEqual({ t: dir, size: -1 });
    expect(seen[1].t).toMatch(/broker-tls\.pem\.\d+\.[0-9a-f]+\.tmp$/);
    expect(seen[1].size).toBe(0);
  });

  it("operator material: foreign-owned certificate ⇒ refused; key with a wide DACL ⇒ rebuilt; foreign-owned key ⇒ refused", () => {
    const dir = tempDir();
    const p = mintSiteBrokerCertificate({ commonName: "OP", days: 30 });
    const c = path.join(dir, "c.pem");
    const k = path.join(dir, "k.pem");
    fs.writeFileSync(c, p.certPem);
    fs.writeFileSync(k, p.keyPem);
    expect(codeOf(() => loadConfiguredBrokerTls(c, k, fakeAcl({ [c]: PRIVATE(OTHER_USER) }).acl))).toBe("TLS_KEY_OWNER_FOREIGN");
    expect(codeOf(() => loadConfiguredBrokerTls(c, k, fakeAcl({ [k]: PRIVATE(OTHER_USER) }).acl))).toBe("TLS_KEY_OWNER_FOREIGN");
    const wide = fakeAcl({ [k]: `O:${ME}D:PAI(A;;FR;;;S-1-2-0)` });
    expect(codeOf(() => resolveBrokerTls({ MQTT_TLS_CERT: c, MQTT_TLS_KEY: k }, wide.acl))).toBe("ok");
    expect(wide.rebuilt).toEqual([k]);
  });

  it("POSIX (acl null) keeps the file-mode path", () => {
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir: path.join(tempDir(), "x"), acl: null }))).toBe("ok");
  });
});

// ── real Windows ──────────────────────────────────────────────────────────────────────────────────────────────
function realDescriptor(p: string): { owner: string; sids: string[]; protectedAcl: boolean } {
  const ps =
    "$a = Get-Acl -LiteralPath $env:J_PATH; Write-Output ('P=' + $a.AreAccessRulesProtected); " +
    "Write-Output ('O=' + $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); " +
    "$a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { Write-Output ('S=' + $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) }";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, env: { ...process.env, J_PATH: p } });
  return {
    protectedAcl: /P=True/.test(out),
    owner: out.match(/^O=(\S+)/m)?.[1] ?? "",
    sids: [...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1]),
  };
}
function mySid(): string {
  const out = execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  return out.match(/"(S-1-[0-9-]+)"\s*$/m)![1];
}
function expectPrivate(p: string) {
  const a = realDescriptor(p);
  const allowed = [mySid(), "S-1-5-18", "S-1-5-32-544"];
  expect(a.protectedAcl, `${p}: inheritance must be removed`).toBe(true);
  expect(allowed, `${p}: owner`).toContain(a.owner);
  expect(new Set(a.sids)).toEqual(new Set(allowed));
}
function setSddl(p: string, sddl: string) {
  const ps =
    "$i = Get-Item -LiteralPath $env:J_PATH -Force; $s = New-Object System.Security.AccessControl.FileSecurity; " +
    "$s.SetSecurityDescriptorSddlForm($env:J_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); $i.SetAccessControl($s)";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true, env: { ...process.env, J_PATH: p, J_SDDL: sddl } });
}

describe.runIf(process.platform === "win32")("Windows — REAL descriptors, checked with Get-Acl", () => {
  it("generated under a parent granting Users + Authenticated Users: folder + key private, protected, owner allowed", () => {
    const parent = tempDir();
    execFileSync("icacls", [parent, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)", "*S-1-5-11:(OI)(CI)(M)"], { stdio: "ignore", windowsHide: true });
    const dir = path.join(parent, "mqtt-tls");
    expect(loadOrCreateSiteBrokerTls({ dir }).created).toBe(true);
    expectPrivate(dir);
    expectPrivate(path.join(dir, SITE_TLS_FILE_NAME));
    expect(fs.readdirSync(dir)).toEqual([SITE_TLS_FILE_NAME]);
  }, 120_000);

  it("an existing key of ours granted to LOCAL, Local account, Everyone, Users ⇒ DACL rebuilt from scratch at start", () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    fs.mkdirSync(dir);
    const p = mintSiteBrokerCertificate({ commonName: "OPEN", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, p.keyPem + p.certPem);
    execFileSync("icacls", [file, "/grant", "*S-1-2-0:(R)", "*S-1-5-113:(R)", "*S-1-1-0:(R)", "*S-1-5-32-545:(R)"], { stdio: "ignore", windowsHide: true });
    expect(realDescriptor(file).sids).toEqual(expect.arrayContaining(["S-1-2-0", "S-1-5-113", "S-1-1-0", "S-1-5-32-545"]));
    errSpy.mockClear();
    expect(loadOrCreateSiteBrokerTls({ dir }).created).toBe(false);
    expectPrivate(file);
    // the pre-existing folder inherits only allowed trustees here ⇒ allow-list satisfied (left as is, checked every start)
    const d = realDescriptor(dir);
    expect(d.sids.every((x) => [mySid(), "S-1-5-18", "S-1-5-32-544"].includes(x))).toBe(true);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes(file))).toBe(true);
  }, 120_000);

  it("a REAL null DACL on the key ⇒ TLS_KEY_ACL_UNVERIFIED (Get-Acl shows no D:), and the module reads it the same way", () => {
    const dir = path.join(tempDir(), "mqtt-tls");
    fs.mkdirSync(dir);
    const p = mintSiteBrokerCertificate({ commonName: "NULL", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, p.keyPem + p.certPem);
    setSddl(file, "D:NO_ACCESS_CONTROL");
    expect(windowsKeyFileAcl.readSddl(file)).not.toMatch(/D:\(/);
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir }))).toBe("TLS_KEY_ACL_UNVERIFIED");
    setSddl(file, `D:PAI(A;;FA;;;${mySid()})`); // let afterAll clean it
  }, 120_000);
});
