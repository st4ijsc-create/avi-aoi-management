/**
 * doc 81 Đợt 8 task Q2 (Đợt 7 re-review N1) — `provision-mqtt-tls.ps1 -Repair`: the folder is LOCKED FIRST (through a handle
 * that does not follow reparse points, its access list set without propagating to children), THEN its contents are re-checked,
 * THEN repaired — no junction-swap window; and -Repair refuses unexpected entries exactly like provisioning.
 *
 * Run for real (child powershell.exe) on SCRATCH folders under the temp folder only, through the gated `-TestUnelevated` mode
 * (AVI_MQTT_TLS_TEST=1) — never ProgramData, never data/. The race (another account planting a junction between the checks
 * and the lock) is reproduced with the script's own gated test hook (AVI_MQTT_TLS_TEST_PLANT_AT / _PLANT), inert outside that
 * mode. Oracles independent of the script: Get-Acl translated to SIDs (the junction TARGET's descriptor is compared before /
 * after), directory listings, exit codes. Q2_PROVISION_SCRIPT overrides the script path (RED runs / mutants on untracked copies).
 * What cannot be run here: the elevated path (owner O:BA through the handle) and a REAL second account (the planting runs as us).
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME } from "../server/services/mqttBrokerTls";

const WIN = process.platform === "win32";
const SCRIPT = process.env.Q2_PROVISION_SCRIPT ? path.resolve(process.env.Q2_PROVISION_SCRIPT) : path.resolve(__dirname, "provision-mqtt-tls.ps1");
const PS = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const SY = "S-1-5-18";
const BA = "S-1-5-32-544";
const USERS = "S-1-5-32-545";

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot8-q2-"));
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

type Run = { code: number | null; out: string; err: string };
function run(args: string[], env: Record<string, string | undefined> = {}): Run {
  const childEnv: Record<string, string | undefined> = { ...process.env, AVI_MQTT_TLS_TEST: "1", ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const r = spawnSync(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], { encoding: "utf8", windowsHide: true, timeout: 120_000, env: childEnv as NodeJS.ProcessEnv });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}
/** The full descriptor (owner, protection, every ACE as SDDL) — compared before / after to prove "nothing changed". */
function sddl(p: string): string {
  return ps("(Get-Acl -LiteralPath $env:Q2_PATH).Sddl", { Q2_PATH: p }).trim();
}
function allowSids(p: string): { protectedAcl: boolean; sids: Set<string> } {
  const out = ps(
    "$a = Get-Acl -LiteralPath $env:Q2_PATH; Write-Output ('P=' + $a.AreAccessRulesProtected); " +
      "$a.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { Write-Output ('S=' + $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) }",
    { Q2_PATH: p },
  );
  return { protectedAcl: /P=True/.test(out), sids: new Set([...out.matchAll(/^S=(\S+)/gm)].map((m) => m[1])) };
}
const junction = (link: string, target: string) => execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore", windowsHide: true });

describe.runIf(WIN)("provision-mqtt-tls.ps1 -Repair — lock first, then re-check (doc 81 Đợt 8 Q2)", () => {
  const me = WIN ? mySid() : "";

  /** A provisioned folder with one backup-* (via -Rotate) whose KEY is readable by Users (what -Repair exists for). */
  function exposedFolder(): { root: string; dir: string; key: string; backup: string } {
    const root = tempDir();
    const dir = path.join(root, "avi-aoi", "mqtt-tls");
    expect(run(["-ServerAccount", me, "-Dir", dir, "-TestUnelevated"]).code).toBe(0);
    expect(run(["-ServerAccount", me, "-Dir", dir, "-Rotate", "-TestUnelevated"]).code).toBe(0);
    const backup = fs.readdirSync(dir).find((n) => n.startsWith("backup-"))!;
    const key = path.join(dir, TLS_KEY_FILE_NAME);
    execFileSync("icacls", [key, "/grant", `*${USERS}:(R)`], { stdio: "ignore", windowsHide: true });
    expect(allowSids(key).sids.has(USERS)).toBe(true);
    return { root, dir, key, backup: path.join(dir, backup) };
  }
  const snapshot = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, sddl(p)]));

  const STRAYS: Array<[string, (f: ReturnType<typeof exposedFolder>) => void, RegExp]> = [
    ["a stray file", (f) => fs.writeFileSync(path.join(f.dir, "notes.txt"), "x"), /unexpected entry 'notes\.txt'/],
    ["a stray folder", (f) => fs.mkdirSync(path.join(f.dir, "other")), /unexpected entry 'other'/],
    ["a leftover staging-* (interrupted -Rotate)", (f) => fs.mkdirSync(path.join(f.dir, "staging-20000101-000000")), /interrupted -Rotate/],
    ["a sub-folder inside backup-*", (f) => fs.mkdirSync(path.join(f.backup, "nested")), /backup folder .* unexpected entry 'nested'/],
    ["another file inside backup-*", (f) => fs.writeFileSync(path.join(f.backup, "extra.txt"), "x"), /backup folder .* unexpected entry 'extra\.txt'/],
  ];
  for (const [label, plant, msg] of STRAYS) {
    it(`★ ${label} ⇒ refused (exit 3) BEFORE any change, the same rule as provisioning: every descriptor is unchanged`, () => {
      const f = exposedFolder();
      plant(f);
      const before = snapshot([f.dir, f.key, f.backup]);
      const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"]);
      expect(r.code, r.err + r.out).toBe(3);
      expect(r.err).toMatch(msg);
      expect(r.err).toMatch(/Nothing was changed/);
      expect(snapshot([f.dir, f.key, f.backup])).toEqual(before); // the folder is NOT locked either: nothing at all changed
      expect(allowSids(f.key).sids.has(USERS)).toBe(true);
    }, 300_000);
  }

  it("★ RACE: a junction planted in the folder AFTER the checks, BEFORE the lock ⇒ the folder is locked first, the re-check refuses (exit 3, says so); the junction's TARGET is untouched, nothing inside changed", () => {
    const f = exposedFolder();
    const target = path.join(f.root, "victim");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "victim.txt"), "v");
    const before = snapshot([target, path.join(target, "victim.txt"), f.key, f.backup]);
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"], {
      AVI_MQTT_TLS_TEST_PLANT_AT: "repair-before-lock",
      AVI_MQTT_TLS_TEST_PLANT: `planted|${target}`,
    });
    expect(fs.lstatSync(path.join(f.dir, "planted")).isSymbolicLink() || fs.existsSync(path.join(f.dir, "planted"))).toBe(true); // the hook did plant it
    expect(r.code, r.err + r.out).toBe(3);
    expect(r.err).toMatch(/unexpected entry 'planted'/);
    expect(r.err).toMatch(/itself was locked first .*nothing inside it was changed/);
    // the junction's target and the folder's contents: exactly as before
    expect(snapshot([target, path.join(target, "victim.txt"), f.key, f.backup])).toEqual(before);
    expect(allowSids(f.key).sids.has(USERS)).toBe(true);
    // the folder itself IS locked (protected, SY/BA/server only)
    const d = allowSids(f.dir);
    expect(d.protectedAcl).toBe(true);
    expect(d.sids).toEqual(new Set([SY, BA, me]));
  }, 300_000);

  it("★ RACE on the folder ITSELF: after the checks it is moved aside and a junction to another folder put in its place ⇒ the lock opens the junction itself (never its target) and refuses; the target is untouched", () => {
    const f = exposedFolder();
    const target = path.join(f.root, "victim3");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "victim.txt"), "v");
    const before = snapshot([target, path.join(target, "victim.txt")]);
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"], {
      AVI_MQTT_TLS_TEST_PLANT_AT: "repair-before-lock",
      AVI_MQTT_TLS_TEST_SWAP_DIR: target,
    });
    expect(fs.existsSync(`${f.dir}.moved`)).toBe(true); // the hook did swap it
    expect(r.code, r.err + r.out).toBe(3);
    expect(r.err).toMatch(/became a reparse point \(symlink\/junction\) after it was checked\. Nothing was changed/);
    expect(snapshot([target, path.join(target, "victim.txt")])).toEqual(before);
    expect(allowSids(path.join(`${f.dir}.moved`, TLS_KEY_FILE_NAME)).sids.has(USERS)).toBe(true); // the real folder: not touched either
    execFileSync("cmd", ["/c", "rmdir", f.dir], { stdio: "ignore", windowsHide: true }); // remove the junction only (never its target)
  }, 300_000);

  it("★ RACE inside an OPEN backup-*: a junction planted there after the checks ⇒ that backup-* is locked before its children are re-checked ⇒ refused; the target is untouched", () => {
    const f = exposedFolder();
    execFileSync("icacls", [f.backup, "/grant", `*${USERS}:(OI)(CI)(M)`], { stdio: "ignore", windowsHide: true }); // other accounts could write into it
    const target = path.join(f.root, "victim2");
    fs.mkdirSync(target);
    const before = snapshot([target, f.key]);
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"], {
      AVI_MQTT_TLS_TEST_PLANT_AT: "repair-before-lock",
      AVI_MQTT_TLS_TEST_PLANT: `${path.basename(f.backup)}\\planted|${target}`,
    });
    expect(r.code, r.err + r.out).toBe(3);
    expect(r.err).toMatch(/backup folder .* unexpected entry 'planted'/);
    expect(r.err).toMatch(/itself was locked first/);
    expect(snapshot([target, f.key])).toEqual(before);
    const b = allowSids(f.backup);
    expect(b.protectedAcl).toBe(true);
    expect(b.sids.has(USERS)).toBe(false); // the backup-* folder was locked (Users' write access gone)
  }, 300_000);

  it("control: the same folder without a planted entry ⇒ repaired (exit 0), Users gone from the key, the exposure is named", () => {
    const f = exposedFolder();
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"]);
    expect(r.code, r.err + r.out).toBe(0);
    expect(r.out).toMatch(/MQTT-TLS-KEY-WAS-EXPOSED-TO=S-1-5-32-545/);
    for (const p of [f.dir, f.key, f.backup, path.join(f.backup, TLS_KEY_FILE_NAME), path.join(f.dir, TLS_CERT_FILE_NAME)]) {
      const a = allowSids(p);
      expect(a.protectedAcl, p).toBe(true);
      expect(a.sids, p).toEqual(new Set([SY, BA, me]));
    }
  }, 300_000);

  it("an EMPTY backup-* folder (pair deleted by hand) is locked and repaired, not refused", () => {
    const f = exposedFolder();
    for (const n of fs.readdirSync(f.backup)) fs.unlinkSync(path.join(f.backup, n));
    execFileSync("icacls", [f.backup, "/grant", `*${USERS}:(OI)(CI)(R)`], { stdio: "ignore", windowsHide: true });
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"]);
    expect(r.code, r.err + r.out).toBe(0);
    expect(allowSids(f.backup).sids).toEqual(new Set([SY, BA, me]));
  }, 300_000);

  it("the plant hook is inert without its variables (an ordinary -Repair plants nothing)", () => {
    const f = exposedFolder();
    const r = run(["-ServerAccount", me, "-Dir", f.dir, "-Repair", "-TestUnelevated"], { AVI_MQTT_TLS_TEST_PLANT_AT: "repair-before-lock" });
    expect(r.code, r.err).toBe(0);
    expect(fs.readdirSync(f.dir).sort()).toEqual([path.basename(f.backup), TLS_CERT_FILE_NAME, TLS_KEY_FILE_NAME].sort());
  }, 300_000);
});
