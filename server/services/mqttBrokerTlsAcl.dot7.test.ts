/**
 * doc 81 Đợt 7 task J fix 1 — the built-in broker's private key on WINDOWS (the production host): `mode 0o600` does
 * nothing on NTFS, so the directory and the key file get an explicit ACL (no inheritance; only the server account,
 * SYSTEM, Administrators), an open existing key is repaired, and an unrepairable / unreadable one refuses TLS.
 *
 * Oracles independent of the product code:
 *   · the REAL ACL read back with PowerShell `Get-Acl` (identities translated to SIDs, so it does not depend on the
 *     Windows display language) — not with the module's own icacls/SDDL parser;
 *   · the SDDL parser itself is checked against strings captured from this host's `icacls /save`.
 * Real-ACL cases run only on win32; the fail-closed cases use an injected fake ACL and run everywhere.
 * Temp dirs only (os.tmpdir) — never the repo's data/ dir.
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
  loadConfiguredBrokerTls,
  loadOrCreateSiteBrokerTls,
  mintSiteBrokerCertificate,
  resolveBrokerTls,
  sddlGrantsBroadAccess,
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

const BROAD = ["S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-32-546", "S-1-5-4", "S-1-5-7", "S-1-5-2"];

/** Independent oracle: SIDs granted on `p` + whether inheritance is blocked, via PowerShell Get-Acl. */
function realAcl(p: string): { sids: string[]; protectedAcl: boolean } {
  const ps =
    `$a = Get-Acl -LiteralPath '${p.replace(/'/g, "''")}'; ` +
    `$s = $a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }; ` +
    `Write-Output ('P=' + $a.AreAccessRulesProtected); $s | ForEach-Object { Write-Output ('S=' + $_) }`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true });
  return {
    protectedAcl: /P=True/.test(out),
    sids: [...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1]),
  };
}
function mySid(): string {
  const out = execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  return out.match(/"(S-1-[0-9-]+)"\s*$/m)![1];
}
function expectPrivate(p: string) {
  const a = realAcl(p);
  expect(a.protectedAcl, `${p}: inheritance must be removed`).toBe(true);
  expect(a.sids.filter((s) => BROAD.includes(s)), `${p}: broad trustees`).toEqual([]);
  expect(new Set(a.sids)).toEqual(new Set([mySid(), "S-1-5-18", "S-1-5-32-544"]));
}
const codeOf = (fn: () => unknown): string => {
  try { fn(); return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
};

describe("sddlGrantsBroadAccess — SDDL captured from this host's icacls /save", () => {
  it("D:\\SOURCES\\…\\data (inherits Users + Authenticated Users) ⇒ open; a private file ⇒ closed", () => {
    expect(sddlGrantsBroadAccess("D:(A;ID;FA;;;BA)(A;OICIIOID;GA;;;BA)(A;ID;FA;;;SY)(A;OICIIOID;GA;;;SY)(A;ID;0x1301bf;;;AU)(A;OICIIOID;SDGXGWGR;;;AU)(A;ID;0x1200a9;;;BU)(A;OICIIOID;GXGR;;;BU)")).toBe(true);
    expect(sddlGrantsBroadAccess("D:(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;S-1-5-21-1393689357-3042344854-1725742880-1000)")).toBe(false);
    expect(sddlGrantsBroadAccess("D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;S-1-5-32-545)")).toBe(true); // SID form
    expect(sddlGrantsBroadAccess("D:PAI(A;;FA;;;SY)(A;;GR;;;WD)")).toBe(true); // Everyone
    // each broad trustee ALONE opens the key (alias and SID forms)
    for (const t of ["AU", "S-1-5-11", "BU", "S-1-5-32-545", "WD", "S-1-1-0", "BG", "IU", "AN", "NU"]) {
      expect(sddlGrantsBroadAccess(`D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;${t})`), t).toBe(true);
    }
    expect(sddlGrantsBroadAccess("D:PAI(D;;FA;;;BU)(A;;FA;;;SY)")).toBe(false); // a DENY to Users does not open
    expect(sddlGrantsBroadAccess("O:BAG:SYD:PAI(A;;FA;;;SY)S:AI(AU;SA;FA;;;WD)")).toBe(false); // audit ACE (SACL) ignored
  });
});

describe("fail closed (fake ACL, every platform)", () => {
  const pair = () => mintSiteBrokerCertificate({ commonName: "ACL", days: 30 });
  function fake(o: { open: boolean; fixes: boolean; readThrows?: boolean; restrictThrows?: boolean }): KeyFileAcl & { restricted: string[] } {
    let open = o.open;
    const restricted: string[] = [];
    return {
      restricted,
      isOpen: () => {
        if (o.readThrows) throw new Error("icacls missing");
        return open;
      },
      restrict: (t) => {
        restricted.push(t);
        if (o.restrictThrows) throw new Error("access denied");
        if (o.fixes) open = false;
      },
    };
  }
  function withFile() {
    const dir = tempDir();
    const p = pair();
    fs.writeFileSync(path.join(dir, SITE_TLS_FILE_NAME), p.keyPem + p.certPem);
    return dir;
  }

  it("existing key open + repair works ⇒ loads, error logged, both dir and file restricted", () => {
    const dir = withFile();
    const acl = fake({ open: true, fixes: true });
    errSpy.mockClear();
    expect(loadOrCreateSiteBrokerTls({ dir, acl }).fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(acl.restricted).toEqual([dir]); // first fix made it private; file then reads private in this fake
    expect(errSpy.mock.calls.some((c) => /readable by ordinary local users/.test(String(c[0])))).toBe(true);
  });

  it("existing key open + repair has no effect ⇒ TLS_KEY_ACL_OPEN; repair throws ⇒ TLS_KEY_ACL_OPEN; ACL unreadable ⇒ TLS_KEY_ACL_UNVERIFIED", () => {
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir: withFile(), acl: fake({ open: true, fixes: false }) }))).toBe("TLS_KEY_ACL_OPEN");
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir: withFile(), acl: fake({ open: true, fixes: false, restrictThrows: true }) }))).toBe("TLS_KEY_ACL_OPEN");
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir: withFile(), acl: fake({ open: false, fixes: false, readThrows: true }) }))).toBe("TLS_KEY_ACL_UNVERIFIED");
  });

  it("generation whose ACL cannot be made private ⇒ refused and NO key left on disk", () => {
    const dir = tempDir();
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir, acl: fake({ open: true, fixes: false, restrictThrows: true }) }))).toBe("TLS_KEY_ACL_OPEN");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("generation ALWAYS restricts the directory and the empty file before the key is written", () => {
    const dir = tempDir();
    const seen: Array<{ t: string; size: number }> = [];
    const acl: KeyFileAcl = {
      isOpen: () => false,
      restrict: (t) => seen.push({ t, size: fs.statSync(t).isDirectory() ? -1 : fs.statSync(t).size }),
    };
    loadOrCreateSiteBrokerTls({ dir, acl });
    expect(seen[0]).toEqual({ t: dir, size: -1 });
    expect(seen[1].t).toMatch(/broker-tls\.pem\.\d+\.[0-9a-f]+\.tmp$/);
    expect(seen[1].size).toBe(0); // restricted while still EMPTY
  });

  it("operator key (MQTT_TLS_KEY) gets the same check", () => {
    const dir = tempDir();
    const p = pair();
    fs.writeFileSync(path.join(dir, "c.pem"), p.certPem);
    fs.writeFileSync(path.join(dir, "k.pem"), p.keyPem);
    expect(codeOf(() => loadConfiguredBrokerTls(path.join(dir, "c.pem"), path.join(dir, "k.pem"), fake({ open: true, fixes: false })))).toBe("TLS_KEY_ACL_OPEN");
    expect(codeOf(() => resolveBrokerTls({ MQTT_TLS_CERT: path.join(dir, "c.pem"), MQTT_TLS_KEY: path.join(dir, "k.pem") }, fake({ open: false, fixes: false })))).toBe("ok");
  });

  it("POSIX (acl null) keeps the file modes path unchanged", () => {
    expect(codeOf(() => loadOrCreateSiteBrokerTls({ dir: tempDir(), acl: null }))).toBe("ok");
  });
});

describe.runIf(process.platform === "win32")("Windows — REAL ACLs (icacls), checked with Get-Acl", () => {
  it("a generated site certificate: dir + key file private, inheritance removed; the module's own check agrees", () => {
    const parent = tempDir();
    // make the parent look like D:\SOURCES\…\data: Users + Authenticated Users inherited by everything below
    execFileSync("icacls", [parent, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)", "*S-1-5-11:(OI)(CI)(M)"], { stdio: "ignore", windowsHide: true });
    const dir = path.join(parent, "mqtt-tls");
    const m = loadOrCreateSiteBrokerTls({ dir });
    expect(m.created).toBe(true);
    expectPrivate(dir);
    expectPrivate(path.join(dir, SITE_TLS_FILE_NAME));
    expect(windowsKeyFileAcl.isOpen(path.join(dir, SITE_TLS_FILE_NAME))).toBe(false);
    expect(windowsKeyFileAcl.isOpen(parent)).toBe(true);
  }, 60_000);

  it("an EXISTING key readable by Users / Authenticated Users / Everyone ⇒ error logged, repaired at start, then loads", () => {
    const dir = tempDir();
    const p = mintSiteBrokerCertificate({ commonName: "OPEN", days: 30 });
    const file = path.join(dir, SITE_TLS_FILE_NAME);
    fs.writeFileSync(file, p.keyPem + p.certPem);
    execFileSync("icacls", [file, "/grant", "*S-1-5-32-545:(R)", "*S-1-5-11:(R)", "*S-1-1-0:(R)"], { stdio: "ignore", windowsHide: true });
    expect(realAcl(file).sids).toEqual(expect.arrayContaining(["S-1-5-32-545", "S-1-5-11", "S-1-1-0"]));
    errSpy.mockClear();
    const m = loadOrCreateSiteBrokerTls({ dir });
    expect(m.created).toBe(false);
    expectPrivate(file);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes(file))).toBe(true);
  }, 60_000);
});
