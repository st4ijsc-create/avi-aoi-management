/**
 * doc 81 Đợt 7 task J redesign (round 4) — the server's READ-ONLY verification of admin-provisioned TLS material on REAL
 * Windows descriptors (mqttBrokerTls.ts `windowsInspector`).
 *
 * The files are laid out here exactly as scripts/provision-mqtt-tls.ps1 leaves them (protected DACL: SYSTEM + Administrators
 * full, the server account read) — then each refusal is produced for real: a foreign allow ACE, an unprotected (inheriting)
 * DACL, a NULL DACL, a hard link, no read access for the server account. Oracles independent of the product code: PowerShell
 * Get-Acl (SIDs), Node `fs.statSync().nlink`, directory listings + mtimes (the server must not write anything).
 *
 * Limits of this lab (reported, not hidden): the process is NOT elevated and the machine has ONE account — a REAL foreign
 * OWNER cannot be produced (owner facts are covered with injected descriptors in mqttBrokerTls.dot7.test.ts), and a FILE
 * symlink / reparse point needs SeCreateSymbolicLinkPrivilege (the case runs when it can be created, else it reports why).
 * Temp dirs only — never the repo's data/, never ProgramData.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { generateEd25519, mintEd25519Cert } from "./security/x509Mint";
import { BrokerTlsError, TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME, resolveBrokerTls, windowsInspector } from "./mqttBrokerTls";

const WIN = process.platform === "win32";
const SY = "S-1-5-18";
const BA = "S-1-5-32-544";
const PS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j4w-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) {
    if (WIN) { try { execFileSync("icacls", [d, "/reset", "/T", "/C", "/Q"], { stdio: "ignore", windowsHide: true }); } catch { /* best effort */ } }
    fs.rmSync(d, { recursive: true, force: true });
  }
});
const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterAll(() => errSpy.mockRestore());

function fingerprintFromPem(text: string): string {
  const b64 = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase().match(/../g)!.join(":");
}
function pair(cn = "J4W") {
  const kp = generateEd25519();
  const m = mintEd25519Cert({ subjectCN: cn, issuerCN: cn, isCa: false, days: 365, signingKey: kp.privateKey, subjectSpkiDer: kp.publicKey.export({ type: "spki", format: "der" }) as Buffer });
  return { keyPem: kp.privateKeyPem, certPem: m.pem };
}
function ps(script: string, env: Record<string, string>): string {
  return execFileSync(PS, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });
}
function mySid(): string {
  const out = execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  return out.match(/"(S-1-[0-9-]+)"\s*$/m)![1];
}
/** Independent oracle: owner + allow SIDs + protection via Get-Acl, translated to SIDs. */
function realDescriptor(p: string): { owner: string; sids: string[]; protectedAcl: boolean } {
  const out = ps(
    "$a = Get-Acl -LiteralPath $env:J_PATH; Write-Output ('P=' + $a.AreAccessRulesProtected); " +
    "Write-Output ('O=' + $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); " +
    "$a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { Write-Output ('S=' + $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) }",
    { J_PATH: p },
  );
  return { protectedAcl: /P=True/.test(out), owner: out.match(/^O=(\S+)/m)?.[1] ?? "", sids: [...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1]) };
}
function setSddl(p: string, sddl: string) {
  ps(
    "$i = Get-Item -LiteralPath $env:J_PATH -Force; $s = New-Object System.Security.AccessControl.FileSecurity; " +
    "$s.SetSecurityDescriptorSddlForm($env:J_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); $i.SetAccessControl($s)",
    { J_PATH: p, J_SDDL: sddl },
  );
}
/** The DACL the provisioning script applies to each file: SYSTEM + Administrators full, the server account READ. */
function provisionedDacl(serverSid: string): string {
  return `D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;${serverSid})`;
}
/** Files + DACLs exactly as the script leaves them for a server running as THIS account (owner = this account, allowed). */
function provisioned(p = pair()) {
  const dir = path.join(tempDir(), "mqtt-tls");
  fs.mkdirSync(dir);
  const certPath = path.join(dir, TLS_CERT_FILE_NAME);
  const keyPath = path.join(dir, TLS_KEY_FILE_NAME);
  fs.writeFileSync(certPath, p.certPem);
  fs.writeFileSync(keyPath, p.keyPem);
  const me = mySid();
  setSddl(certPath, provisionedDacl(me));
  setSddl(keyPath, provisionedDacl(me));
  return { dir, certPath, keyPath, env: { MQTT_TLS_CERT: certPath, MQTT_TLS_KEY: keyPath }, ...p };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
}
function snapshot(dir: string): string {
  return fs.readdirSync(dir).sort().map((n) => { const st = fs.statSync(path.join(dir, n)); return `${n}:${st.size}:${st.mtimeMs}:${st.nlink}`; }).join("|");
}

describe.runIf(WIN)("Windows — REAL descriptors, checked with Get-Acl / fstat; the server never writes", () => {
  it("as provisioned (protected, SY/BA full, server read, owner allowed) ⇒ accepted; fingerprint exact; nothing written", async () => {
    const p = provisioned();
    const d = realDescriptor(p.keyPath);
    expect(d.protectedAcl).toBe(true);
    expect(new Set(d.sids)).toEqual(new Set([SY, BA, mySid()]));
    const before = snapshot(p.dir);
    const m = await resolveBrokerTls(p.env, windowsInspector);
    expect(m.fingerprintSha256).toBe(fingerprintFromPem(p.certPem));
    expect(m.certPath).toBe(p.certPath);
    expect(snapshot(p.dir)).toBe(before);
    expect(realDescriptor(p.keyPath)).toEqual(d); // untouched
  }, 60_000);

  it("a stranger allow ACE on the KEY (Users / LOCAL / Local account / Everyone) ⇒ TLS_KEY_ACL_OPEN; the DACL is NOT repaired (read-only server)", async () => {
    const p = provisioned();
    execFileSync("icacls", [p.keyPath, "/grant", "*S-1-5-32-545:(R)"], { stdio: "ignore", windowsHide: true });
    const widened = realDescriptor(p.keyPath);
    expect(widened.sids).toContain("S-1-5-32-545");
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_ACL_OPEN");
    expect(realDescriptor(p.keyPath)).toEqual(widened); // no "repair": the admin re-provisions
    for (const sid of ["S-1-2-0", "S-1-5-113", "S-1-1-0"]) {
      const q = provisioned();
      execFileSync("icacls", [q.keyPath, "/grant", `*${sid}:(R)`], { stdio: "ignore", windowsHide: true });
      expect(await codeOf(resolveBrokerTls(q.env, windowsInspector)), sid).toBe("TLS_KEY_ACL_OPEN");
    }
  }, 120_000);

  it("a stranger allow ACE on the CERTIFICATE alone ⇒ refused too (same rule for both files)", async () => {
    const p = provisioned();
    execFileSync("icacls", [p.certPath, "/grant", "*S-1-5-11:(R)"], { stdio: "ignore", windowsHide: true });
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_ACL_OPEN");
  }, 60_000);

  it("an UNPROTECTED DACL (inheritance on, inheriting only allowed SIDs) ⇒ TLS_KEY_ACL_UNPROTECTED", async () => {
    const p = provisioned();
    // the folder gets a protected allow-list DACL; the key then inherits from it (allowed SIDs only) ⇒ unprotected
    ps(
      "$i = Get-Item -LiteralPath $env:J_PATH -Force; $s = New-Object System.Security.AccessControl.DirectorySecurity; " +
      "$s.SetSecurityDescriptorSddlForm($env:J_SDDL, [System.Security.AccessControl.AccessControlSections]::Access); $i.SetAccessControl($s)",
      { J_PATH: p.dir, J_SDDL: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FR;;;${mySid()})` },
    );
    execFileSync("icacls", [p.keyPath, "/inheritance:e"], { stdio: "ignore", windowsHide: true });
    const d = realDescriptor(p.keyPath);
    expect(d.protectedAcl).toBe(false);
    expect(new Set(d.sids)).toEqual(new Set([SY, BA, mySid()]));
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_ACL_UNPROTECTED");
  }, 60_000);

  it("a REAL null DACL ⇒ TLS_KEY_ACL_OPEN", async () => {
    const p = provisioned();
    setSddl(p.keyPath, "D:NO_ACCESS_CONTROL");
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_ACL_OPEN");
  }, 60_000);

  it("a REAL hard link: broker.key linked to a file an attacker could write elsewhere ⇒ TLS_KEY_LINKED, nothing touched", async () => {
    const p = provisioned();
    const attacker = pair("ATTACKER");
    const outside = path.join(path.dirname(p.dir), "ot-store-forward.jsonl");
    fs.writeFileSync(outside, `{"x":1}\n${attacker.keyPem}`);
    execFileSync("icacls", [outside, "/grant", "*S-1-5-11:(M)"], { stdio: "ignore", windowsHide: true });
    const outsideBefore = realDescriptor(outside);
    fs.unlinkSync(p.keyPath);
    fs.linkSync(outside, p.keyPath);
    expect(fs.statSync(p.keyPath).nlink).toBe(2);
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_LINKED");
    expect(realDescriptor(outside)).toEqual(outsideBefore);
    expect(fs.readFileSync(outside, "utf8")).toContain(attacker.keyPem.trim());
  }, 60_000);

  it("a reparse point in place of the key ⇒ TLS_KEY_LINKED (runs only when this account may create file symlinks)", async (ctx) => {
    const p = provisioned();
    const real = `${p.keyPath}.real`;
    fs.renameSync(p.keyPath, real);
    try {
      fs.symlinkSync(real, p.keyPath, "file");
    } catch (e) {
      fs.renameSync(real, p.keyPath);
      console.warn(`[J4 test] file symlink not creatable here (${(e as NodeJS.ErrnoException).code}) — reparse-point case covered by injected facts only`);
      ctx.skip();
      return;
    }
    expect(await codeOf(resolveBrokerTls(p.env, windowsInspector))).toBe("TLS_KEY_LINKED");
  }, 60_000);

  it("the server account has NO read access (DACL = SYSTEM + Administrators only) ⇒ TLS_FILE_UNREADABLE naming the account", async () => {
    const p = provisioned();
    setSddl(p.keyPath, "D:PAI(A;;FA;;;SY)(A;;FA;;;BA)");
    let err: BrokerTlsError | null = null;
    try { await resolveBrokerTls(p.env, windowsInspector); } catch (e) { err = e as BrokerTlsError; }
    expect(err?.code).toBe("TLS_FILE_UNREADABLE");
    expect(err?.message).toContain(mySid());
  }, 60_000);

  it("the Windows inspector runs asynchronously (event loop keeps ticking during the handle inspection)", async () => {
    const p = provisioned();
    let ticks = 0;
    const t = setInterval(() => ticks++, 10);
    try {
      await windowsInspector.inspectAndReadFile(p.keyPath);
    } finally { clearInterval(t); }
    expect(ticks).toBeGreaterThan(3);
  }, 60_000);
});
