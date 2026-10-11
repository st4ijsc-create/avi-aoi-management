/**
 * doc 81 Đợt 7 task J redesign (round 4) — scripts/provision-mqtt-tls.ps1, the ADMIN-side provisioning of the built-in
 * broker's TLS material, run for real (child powershell.exe) on SCRATCH folders only — never ProgramData, never data/.
 *
 * This process is not elevated, so: the real refusal of an unelevated run is measured, and everything else runs under
 * `-TestUnelevated` (the current user stands in for Administrators). Oracles independent of the script: Node's crypto
 * (key ↔ certificate, SHA-256 fingerprint recomputed from the DER, SAN, curve/modulus), Get-Acl translated to SIDs,
 * `fs.statSync().nlink`, byte comparisons, and the SERVER's own read-only verifier + a real pinned TLS handshake.
 * What could NOT be run here (reported): the elevated path (owner = Administrators via `O:BA`) and a REAL foreign owner.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { BrokerTlsError, TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME, resolveBrokerTls, windowsInspector } from "../server/services/mqttBrokerTls";

const WIN = process.platform === "win32";
const SCRIPT = path.resolve(__dirname, "provision-mqtt-tls.ps1");
const PS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const SY = "S-1-5-18";
const BA = "S-1-5-32-544";

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j4p-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) {
    if (WIN) { try { execFileSync("icacls", [d, "/reset", "/T", "/C", "/Q"], { stdio: "ignore", windowsHide: true }); } catch { /* best effort */ } }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function ps(script: string, env: Record<string, string> = {}): string {
  return execFileSync(PS, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });
}
const mySid = (): string => ps("[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value").trim();
const elevated = (): boolean => /True/.test(ps("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"));

type Run = { code: number | null; out: string; err: string; vars: Record<string, string> };
function run(args: string[]): Run {
  const r = spawnSync(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const vars: Record<string, string> = {};
  for (const m of String(r.stdout).matchAll(/^(MQTT-TLS-[A-Z0-9-]+)=(.*)$/gm)) vars[m[1]] = m[2].trim();
  return { code: r.status, out: String(r.stdout), err: String(r.stderr), vars };
}
function realDescriptor(p: string): { owner: string; sids: string[]; protectedAcl: boolean } {
  const out = ps(
    "$a = Get-Acl -LiteralPath $env:J_PATH; Write-Output ('P=' + $a.AreAccessRulesProtected); " +
    "Write-Output ('O=' + $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); " +
    "$a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { Write-Output ('S=' + $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) }",
    { J_PATH: p },
  );
  return { protectedAcl: /P=True/.test(out), owner: out.match(/^O=(\S+)/m)?.[1] ?? "", sids: [...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1]) };
}
function fingerprintFromPem(text: string): string {
  const b64 = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase().match(/../g)!.join(":");
}
function expectProvisionedAcl(p: string, me: string) {
  const d = realDescriptor(p);
  expect(d.protectedAcl, `${p} protected`).toBe(true);
  expect(d.owner, `${p} owner`).toBe(me); // test mode: the current user created it (elevated: Administrators)
  expect(new Set(d.sids), `${p} allow SIDs`).toEqual(new Set([SY, BA, me]));
}
async function handshakeByPin(keyPem: string, certPem: string, pin: string): Promise<string> {
  const server = tls.createServer({ key: keyPem, cert: certPem }, (s) => s.end("hi"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    return await new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve("timeout"), 8000);
      const c = tls.connect({ host: "127.0.0.1", port, ca: certPem, checkServerIdentity: (_h, cert) => (cert.fingerprint256 === pin ? undefined : new Error("PIN_MISMATCH")) }, () => {
        c.on("data", (d) => { clearTimeout(t); resolve(`ok:${d}`); });
      });
      c.on("error", (e) => { clearTimeout(t); resolve(`err:${e.message}`); });
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return e instanceof BrokerTlsError ? e.code : `other:${(e as Error).message}`; }
}

describe.runIf(WIN)("provision-mqtt-tls.ps1 — admin-side provisioning (scratch folders, -TestUnelevated)", () => {
  const me = WIN ? mySid() : "";
  const isElevated = WIN ? elevated() : false;

  it.runIf(WIN && !isElevated)("NOT elevated ⇒ refused (exit 2) before anything is created", () => {
    const root = tempDir();
    const r = run(["-ServerAccount", me, "-Dir", path.join(root, "avi-aoi", "mqtt-tls")]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Administrator/);
    expect(fs.existsSync(path.join(root, "avi-aoi"))).toBe(false);
  }, 60_000);

  it("-ServerAccount missing or unresolvable ⇒ exit 6, nothing created", () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    expect(run(["-Dir", dir, "-TestUnelevated"]).code).toBe(6);
    const bad = run(["-ServerAccount", "no-such-account-j4-xyz", "-Dir", dir, "-TestUnelevated"]);
    expect(bad.code).toBe(6);
    expect(bad.err).toMatch(/cannot resolve/);
    expect(run(["-ServerAccount", me, "-Dir", dir, "-IpAddress", "999.1.1.1", "-TestUnelevated"]).code).toBe(6);
    expect(fs.existsSync(path.join(root, "avi-aoi"))).toBe(false);
  }, 120_000);

  it("★ provisions: protected folders + files (SY/BA full, server read), EC P-256, SAN, exact fingerprint; the SERVER accepts it and a pinned handshake works", async () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    const r = run(["-ServerAccount", me, "-Dir", dir, "-DnsName", "broker.plant.local", "-IpAddress", "10.9.8.7", "-TestUnelevated"]);
    expect(r.code, r.err + r.out).toBe(0);
    const certPath = path.join(dir, TLS_CERT_FILE_NAME);
    const keyPath = path.join(dir, TLS_KEY_FILE_NAME);
    expect(r.vars["MQTT-TLS-CERT"]).toBe(certPath);
    expect(r.vars["MQTT-TLS-KEY"]).toBe(keyPath);
    expect(fs.readdirSync(dir).sort()).toEqual([TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME]);
    expect(fs.readdirSync(path.join(root, "avi-aoi"))).toEqual(["mqtt-tls"]);
    // files: PEM, key ↔ cert, curve, SAN, validity, fingerprint recomputed independently == printed
    const keyPem = fs.readFileSync(keyPath, "utf8");
    const certPem = fs.readFileSync(certPath, "utf8");
    const key = createPrivateKey(keyPem);
    const x = new X509Certificate(certPem);
    expect(key.asymmetricKeyType).toBe("ec");
    expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(x.checkPrivateKey(key)).toBe(true);
    expect(x.ca).toBe(false);
    expect(x.keyUsage).toContain("1.3.6.1.5.5.7.3.1");
    expect(x.subjectAltName).toContain("DNS:localhost");
    expect(x.subjectAltName).toContain("DNS:broker.plant.local");
    expect(x.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(x.subjectAltName).toContain("IP Address:10.9.8.7");
    expect(x.subjectAltName!.toLowerCase()).toContain(`dns:${os.hostname().toLowerCase()}`);
    const years = (new Date(x.validTo).getTime() - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(19.9);
    expect(r.vars["MQTT-TLS-FINGERPRINT-SHA256"]).toBe(fingerprintFromPem(certPem));
    expect(r.vars["MQTT-TLS-NOT-AFTER"].slice(0, 10)).toBe(new Date(x.validTo).toISOString().slice(0, 10));
    // access lists: Get-Acl oracle + link counts
    for (const p of [path.join(root, "avi-aoi"), dir, certPath, keyPath]) expectProvisionedAcl(p, me);
    expect(fs.statSync(keyPath).nlink).toBe(1);
    expect(r.out).toMatch(/8884/); // firewall note
    // the server's own read-only verifier accepts exactly this layout, and tablets can pin the printed fingerprint
    const m = await resolveBrokerTls({ MQTT_TLS_CERT: certPath, MQTT_TLS_KEY: keyPath }, windowsInspector);
    expect(m.fingerprintSha256).toBe(r.vars["MQTT-TLS-FINGERPRINT-SHA256"]);
    expect(await handshakeByPin(m.keyPem, m.certPem, m.fingerprintSha256)).toBe("ok:hi");
    expect(await handshakeByPin(m.keyPem, m.certPem, "00:".repeat(31) + "00")).toContain("PIN_MISMATCH");
    // a second run without -Rotate refuses (exit 4) and changes nothing
    const again = run(["-ServerAccount", me, "-Dir", dir, "-TestUnelevated"]);
    expect(again.code).toBe(4);
    expect(fs.readFileSync(keyPath, "utf8")).toBe(keyPem);
    expect(fs.readFileSync(certPath, "utf8")).toBe(certPem);
    // -Rotate: old pair backed up (same ACL), new fingerprint, server accepts the new pair
    const rot = run(["-ServerAccount", me, "-Dir", dir, "-Rotate", "-TestUnelevated"]);
    expect(rot.code, rot.err).toBe(0);
    const backup = rot.vars["MQTT-TLS-BACKUP"];
    expect(backup).toMatch(/backup-\d{8}-\d{6}$/);
    expect(fs.readFileSync(path.join(backup, TLS_KEY_FILE_NAME), "utf8")).toBe(keyPem);
    expect(fs.readFileSync(path.join(backup, TLS_CERT_FILE_NAME), "utf8")).toBe(certPem);
    expectProvisionedAcl(backup, me);
    expectProvisionedAcl(path.join(backup, TLS_KEY_FILE_NAME), me);
    expect(rot.vars["MQTT-TLS-FINGERPRINT-SHA256"]).not.toBe(r.vars["MQTT-TLS-FINGERPRINT-SHA256"]);
    expect(fs.readdirSync(dir).sort()).toEqual([path.basename(backup), TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME].sort());
    const m2 = await resolveBrokerTls({ MQTT_TLS_CERT: certPath, MQTT_TLS_KEY: keyPath }, windowsInspector);
    expect(m2.fingerprintSha256).toBe(rot.vars["MQTT-TLS-FINGERPRINT-SHA256"]);
  }, 300_000);

  it("-Algorithm RSA ⇒ RSA-3072, accepted by the server", async () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    const r = run(["-ServerAccount", me, "-Dir", dir, "-Algorithm", "RSA", "-TestUnelevated"]);
    expect(r.code, r.err).toBe(0);
    const key = createPrivateKey(fs.readFileSync(path.join(dir, TLS_KEY_FILE_NAME), "utf8"));
    expect(key.asymmetricKeyType).toBe("rsa");
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(3072);
    const m = await resolveBrokerTls({ MQTT_TLS_CERT: path.join(dir, TLS_CERT_FILE_NAME), MQTT_TLS_KEY: path.join(dir, TLS_KEY_FILE_NAME) }, windowsInspector);
    expect(m.fingerprintSha256).toBe(r.vars["MQTT-TLS-FINGERPRINT-SHA256"]);
  }, 180_000);

  it("a pre-existing mqtt-tls folder that inherits its access list (not created by this script) ⇒ exit 3, nothing written", () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    fs.mkdirSync(dir, { recursive: true }); // plain folder: inherits the temp dir's ACL
    const r = run(["-ServerAccount", me, "-Dir", dir, "-TestUnelevated"]);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/inherits/);
    expect(fs.readdirSync(dir)).toEqual([]);
  }, 120_000);

  it("a pre-existing mqtt-tls folder that is PROTECTED but grants Users ⇒ exit 3 naming the stranger SID, nothing written", () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("icacls", [dir, "/inheritance:r", "/grant:r", `*${me}:(OI)(CI)(F)`, "*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)", "*S-1-5-32-545:(OI)(CI)(R)"], { stdio: "ignore", windowsHide: true });
    expect(realDescriptor(dir).protectedAcl).toBe(true);
    const r = run(["-ServerAccount", me, "-Dir", dir, "-TestUnelevated"]);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/grants access to S-1-5-32-545/);
    expect(fs.readdirSync(dir)).toEqual([]);
  }, 120_000);

  it("a pre-existing parent 'avi-aoi' owned by us but inheriting ⇒ tightened and provisioning proceeds; another parent name ⇒ warned, left alone", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "avi-aoi"));
    const r = run(["-ServerAccount", me, "-Dir", path.join(root, "avi-aoi", "mqtt-tls"), "-TestUnelevated"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Tightened the access list of the existing parent folder/);
    expectProvisionedAcl(path.join(root, "avi-aoi"), me);
    const other = tempDir();
    fs.mkdirSync(path.join(other, "certs"));
    const before = realDescriptor(path.join(other, "certs"));
    const r2 = run(["-ServerAccount", me, "-Dir", path.join(other, "certs", "mqtt-tls"), "-TestUnelevated"]);
    expect(r2.code, r2.err).toBe(0);
    expect(`${r2.out}\n${r2.err}`).toMatch(/not managed by this script/);
    expect(realDescriptor(path.join(other, "certs"))).toEqual(before);
    expectProvisionedAcl(path.join(other, "certs", "mqtt-tls"), me);
  }, 180_000);

  it("-Rotate refuses when the existing key has a second hard link or the folder holds a stray entry (exit 3): nothing moved, nothing written", async () => {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    expect(run(["-ServerAccount", me, "-Dir", dir, "-TestUnelevated"]).code).toBe(0);
    const keyPath = path.join(dir, TLS_KEY_FILE_NAME);
    const keyBefore = fs.readFileSync(keyPath, "utf8");
    // stray entry
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const stray = run(["-ServerAccount", me, "-Dir", dir, "-Rotate", "-TestUnelevated"]);
    expect(stray.code).toBe(3);
    expect(stray.err).toMatch(/unexpected entry/);
    fs.unlinkSync(path.join(dir, "notes.txt"));
    // hard link to the key from outside the folder
    fs.linkSync(keyPath, path.join(root, "copy.key"));
    expect(fs.statSync(keyPath).nlink).toBe(2);
    const linked = run(["-ServerAccount", me, "-Dir", dir, "-Rotate", "-TestUnelevated"]);
    expect(linked.code).toBe(3);
    expect(linked.err).toMatch(/hard links/);
    expect(fs.readdirSync(dir).sort()).toEqual([TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME]); // no backup folder, nothing replaced
    expect(fs.readFileSync(keyPath, "utf8")).toBe(keyBefore);
    expect(await codeOf(resolveBrokerTls({ MQTT_TLS_CERT: path.join(dir, TLS_CERT_FILE_NAME), MQTT_TLS_KEY: keyPath }, windowsInspector))).toBe("TLS_KEY_LINKED");
  }, 240_000);
});
