/**
 * doc 81 Đợt 10 task A — scripts/edge-signing-key.ts (fix scan 2, ruling R-10-c): TRUST COMES FROM THE KEY FILES. The private
 * key goes only to `<dir>/<kid>.pem` (new, 0600; never printed, never in the DB); keyring.json holds status / root / version;
 * generate / rotate / pin read and write ONLY the files; the DB table is a MIRROR written with the owner connection, and a row
 * PLANTED there is flagged by `list` and never pinned or published.
 * fix review 1 (I7): every change is made by a PROVEN active admin (`--actor` + verifyCredentialAdmin, password / 2FA never on
 * argv) BEFORE any file is written; the actor is recorded in keyring.json history on generate AND rotate, and audited; `--by`
 * is refused. (M5): generate at the 16-key cap prunes the oldest long-retired keys, never the root / an active / a next key.
 * DB cases run on `_test` with an OWNER connection inside a transaction that is ROLLED BACK.
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { edgeAuthSigningKeys } from "../server/services/edge/edgeControlSchema";
import { EdgeTrustStore, buildEdgeKeysetFromKeyring, generateEdgeSigningKey, loadEdgeSigningKey, readEdgeKeyring, signEdgeObject, verifyEdgeObject } from "../server/services/edge/edgeSigning";
import { runEdgeSigningKeyCli, type SigningKeyAuditEntry, type SigningKeyCliDeps } from "./edge-signing-key";

const root = mkdtempSync(path.join(tmpdir(), "edge-signing-key-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const f = (n: string) => path.join(root, n);

const ADMIN = { userId: 41, name: "Admin Test" };
const PASSWORD = "correct horse";
/** A fake of verifyCredentialAdmin: only admin.test with the right password passes; every call is recorded. */
function deps(over: Partial<SigningKeyCliDeps> = {}) {
  const logins: Array<{ username: string; password: string | null; otp: string | null }> = [];
  const audits: SigningKeyAuditEntry[] = [];
  const d: SigningKeyCliDeps = {
    mirrorDb: null,
    verifyAdmin: async (l) => {
      logins.push(l);
      if (l.username !== "admin.test" || l.password !== PASSWORD) throw Object.assign(new Error("Admin login refused (invalidCredentials)."), { code: "notVerified" });
      return ADMIN;
    },
    audit: async (e) => {
      audits.push(e);
    },
    ...over,
  };
  return { d, logins, audits };
}
/** Đợt 10 F2 round 3 (N7): the admin secret is PIPED on stdin (line 1 password, line 2 code) or typed at a TTY prompt — never env */
function io(stdin: string | null = `${PASSWORD}\n`, env: NodeJS.ProcessEnv = {}) {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, io: { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l), env, readStdin: async () => stdin } };
}
const A = ["--actor", "admin.test"];

describe("edge-signing-key — arguments (no DB, no files touched)", () => {
  it("refuses bad usage", async () => {
    const { d } = deps();
    for (const [argv, code] of [
      [[], 2],
      [["bogus"], 2],
      [["generate", ...A], 2], // no --dir
      [["generate", "--dir", f("a")], 2], // no --actor
      [["rotate", "--dir", f("a"), ...A], 2],
      [["rotate", "--dir", f("a"), "--activate", "k", "--retire", "k", ...A], 2],
      [["generate", "--dir", f("a"), ...A, "--private-key", "x"], 2],
      [["pin", "--dir", f("a"), ...A], 2],
      [["pin", "--dir", f("a"), "--out", f("p.json")], 2], // pin writes a file: --actor required too
      [["generate", "--dir", f("a"), "--by", "me"], 2], // I7: free text refused
      [["generate", "--dir", f("a"), ...A, "--by", "me"], 2],
      [["generate", "--dir", f("a"), ...A, "--password", PASSWORD], 2], // never on argv
      [["generate", "--dir", f("a"), ...A, "--otp", "123456"], 2],
      // fix review 3 (R-10-aa N5): the `=` spellings are refused too — a secret never travels on argv
      [["generate", "--dir", f("a"), ...A, `--password=${PASSWORD}`], 2],
      [["generate", "--dir", f("a"), ...A, "--otp=123456"], 2],
      [["generate", "--dir", f("a"), ...A, "--by=me"], 2],
      [["generate", "--dir", f("a"), "--by=me"], 2],
      [["generate", "--dir", f("a"), ...A, "--PASSWORD=x"], 2],
      [["pin", "--dir", f("a"), "--out", f("p.json"), ...A, "--pass=x"], 2],
      [["list", "--dir", f("nope")], 1], // no keyring
    ] as Array<[string[], number]>) {
      const t = io();
      expect(await runEdgeSigningKeyCli(argv, t.io, d), argv.join(" ")).toBe(code);
    }
    expect(existsSync(f("a"))).toBe(false);
    writeFileSync(f("exists.json"), "keep");
    expect(await runEdgeSigningKeyCli(["pin", "--dir", f("a"), "--out", f("exists.json"), ...A], io().io, d)).toBe(1);
    expect(readFileSync(f("exists.json"), "utf8")).toBe("keep");
  });
});

describe("fix review 1 (I7) — the admin is PROVEN before any file write; the actor is recorded", () => {
  it("★ a refused login (wrong password / not an admin / no password at all) writes NOTHING: no directory, no key file, no keyring change", async () => {
    const dir = f("ring-refused");
    for (const [stdin, actor] of [
      ["wrong\n", "admin.test"],
      [`${PASSWORD}\n`, "someone.else"],
      [null, "admin.test"], // nothing piped and no terminal
    ] as Array<[string | null, string]>) {
      const t = io(stdin);
      expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--actor", actor], t.io, deps().d)).toBe(1);
      expect(t.errs.join("\n")).toMatch(/refused.*nothing was changed/);
    }
    expect(existsSync(dir)).toBe(false);
    // on an existing keyring: rotate / pin refused ⇒ keyring byte-identical, no pin file
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, deps().d)).toBe(0);
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, deps().d)).toBe(0);
    const before = readFileSync(path.join(dir, "keyring.json"), "utf8");
    const filesBefore = readdirSync(dir).sort();
    const next = readEdgeKeyring(dir).keys[1].kid;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", next, ...A], io("wrong\n").io, deps().d)).toBe(1);
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io("wrong\n").io, deps().d)).toBe(1);
    expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin-refused.json"), ...A], io("wrong\n").io, deps().d)).toBe(1);
    expect(readFileSync(path.join(dir, "keyring.json"), "utf8")).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(filesBefore);
    expect(existsSync(f("pin-refused.json"))).toBe(false);
    // a "proof" without a real user id is no proof (fail closed)
    const noUser = deps({ verifyAdmin: async () => ({ userId: 0, name: "ghost" }) });
    expect(await runEdgeSigningKeyCli(["generate", "--dir", f("ring-ghost"), ...A], io().io, noUser.d)).toBe(1);
    expect(existsSync(f("ring-ghost"))).toBe(false);
  });

  it("★ N7 (Đợt 10 F2 round 3): the secret comes from the hidden TTY prompt, else PIPED STDIN (line 1 password, line 2 2FA code) — never argv, never env", async () => {
    const dir = f("ring-prompt");
    const x = deps();
    const asked: string[] = [];
    const t = io(null);
    const viaPrompt = { ...t.io, promptSecret: async (label: string) => (asked.push(label), PASSWORD) };
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], viaPrompt, x.d)).toBe(0);
    expect(asked).toEqual(["password of admin.test: "]);
    expect(x.logins).toEqual([{ username: "admin.test", password: PASSWORD, otp: null }]);
    expect(t.lines[0]).toBe("admin verified: Admin Test (user 41)");
    const y = deps();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", f("ring-piped"), ...A], io(`${PASSWORD}\n654321\n`).io, y.d)).toBe(0);
    expect(y.logins).toEqual([{ username: "admin.test", password: PASSWORD, otp: "654321" }]);
  });

  it("★ N7: EDGE_SIGNING_ADMIN_PASSWORD / _OTP set ⇒ exit 2 (refused, not read), nothing proven, nothing written", async () => {
    for (const v of ["EDGE_SIGNING_ADMIN_PASSWORD", "EDGE_SIGNING_ADMIN_OTP"]) {
      const dir = f(`ring-env-${v}`);
      const x = deps();
      const t = io(`${PASSWORD}\n`, { [v]: PASSWORD });
      expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], t.io, x.d)).toBe(2);
      expect(t.errs.join("\n")).toMatch(new RegExp(`${v} is set`));
      expect(x.logins).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    }
  });

  it("★ keyring.json history names the PROVEN actor on generate AND rotate (activate / retire); every change is audited with it", async () => {
    const dir = f("ring-history");
    let clock = 1_790_000_000_000;
    const x = deps({ now: () => clock });
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, x.d)).toBe(0);
    clock += 1_000;
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, x.d)).toBe(0);
    const k2 = readEdgeKeyring(dir).keys[1].kid;
    const k1 = readEdgeKeyring(dir).keys[0].kid;
    clock += 1_000;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k2, ...A], io().io, x.d)).toBe(0);
    clock += 1_000;
    const k3gen = await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, x.d);
    expect(k3gen).toBe(0);
    const k3 = readEdgeKeyring(dir).keys[2].kid;
    clock += 1_000;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k3, ...A], io().io, x.d)).toBe(0);
    clock += 1_000;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--retire", k2, ...A], io().io, x.d)).toBe(0);
    const kr = readEdgeKeyring(dir);
    expect(kr.history).toEqual([
      { version: 1, action: "generate", kid: k1, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_000_000 },
      { version: 2, action: "generate", kid: k2, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_001_000 },
      { version: 3, action: "activate", kid: k2, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_002_000 },
      { version: 4, action: "generate", kid: k3, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_003_000 },
      { version: 5, action: "activate", kid: k3, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_004_000 },
      { version: 6, action: "retire", kid: k2, actorUserId: 41, actorName: "Admin Test", at: 1_790_000_005_000 },
    ]);
    expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin-hist.json"), ...A], io().io, x.d)).toBe(0);
    expect(x.audits.map((a) => [a.action, a.actor.userId, a.details.kid])).toEqual([
      ["EDGE_SIGNING_KEY_GENERATE", 41, k1],
      ["EDGE_SIGNING_KEY_GENERATE", 41, k2],
      ["EDGE_SIGNING_KEY_ACTIVATE", 41, k2],
      ["EDGE_SIGNING_KEY_GENERATE", 41, k3],
      ["EDGE_SIGNING_KEY_ACTIVATE", 41, k3],
      ["EDGE_SIGNING_KEY_RETIRE", 41, k2],
      ["EDGE_SIGNING_KEY_PIN", 41, k1],
    ]);
    // I5 — the pin records the keyring version at provisioning
    expect(JSON.parse(readFileSync(f("pin-hist.json"), "utf8")).keyset.version).toBe(6);
  });
});

describe("fix review 1 (M5) — generate at the 16-key cap", () => {
  it("★ prunes the OLDEST long-retired key (recorded in history), never the root / an active / a next key; refuses when none qualifies", async () => {
    const dir = f("ring-cap");
    const H = 3_600_000;
    let clock = 1_790_000_000_000;
    const x = deps({ now: () => clock });
    const run = async (...argv: string[]) => runEdgeSigningKeyCli([argv[0], "--dir", dir, ...argv.slice(1), ...A], io().io, x.d);
    expect(await run("generate")).toBe(0); // root
    const retiredOrder: string[] = [];
    for (let i = 0; i < 14; i++) {
      clock += 2 * H; // the oldest retired key ends up 28 h old, the youngest 2 h
      expect(await run("generate")).toBe(0);
      const kid = readEdgeKeyring(dir).keys.at(-1)!.kid;
      expect(await run("rotate", "--activate", kid)).toBe(0);
      if (i < 13) {
        expect(await run("rotate", "--retire", kid)).toBe(0);
        retiredOrder.push(kid);
      }
    }
    clock += 2 * H;
    expect(await run("generate")).toBe(0); // a next key: 16 keys now (root, 13 retired, 1 active, 1 next)
    let kr = readEdgeKeyring(dir);
    expect(kr.keys).toHaveLength(16);
    const live = kr.keys.filter((k) => k.status !== "retired").map((k) => k.kid);
    // the youngest retired key is < 24 h old, the oldest ones are older: the next generate prunes exactly the oldest one
    const t = io();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], t.io, x.d)).toBe(0);
    kr = readEdgeKeyring(dir);
    expect(kr.keys).toHaveLength(16);
    expect(kr.keys.some((k) => k.kid === retiredOrder[0])).toBe(false);
    for (const kid of live) expect(kr.keys.some((k) => k.kid === kid)).toBe(true);
    expect(kr.keys.filter((k) => k.root)).toHaveLength(1);
    expect(kr.history!.filter((h) => h.action === "prune").map((h) => h.kid)).toEqual([retiredOrder[0]]);
    expect(t.lines.join("\n")).toContain(`pruned retired key(s) ${retiredOrder[0]}`);
    // every remaining retired key retired < 24 h before "now" ⇒ refused, nothing written
    const near = deps({ now: () => kr.updatedAt });
    const pemsBefore = readdirSync(dir).filter((n) => n.endsWith(".pem")).length;
    const before = readFileSync(path.join(dir, "keyring.json"), "utf8");
    const r = io();
    const youngDir = dir;
    // make all retired keys young: fast-forward is impossible backwards, so check against a keyring whose retired keys are fresh
    const fresh = JSON.parse(before);
    fresh.keys = fresh.keys.map((k: { status: string; retiredAt: number | null }) => (k.status === "retired" ? { ...k, retiredAt: kr.updatedAt - H } : k));
    chmodSync(path.join(youngDir, "keyring.json"), 0o600);
    writeFileSync(path.join(youngDir, "keyring.json"), JSON.stringify(fresh));
    const freshText = readFileSync(path.join(youngDir, "keyring.json"), "utf8");
    expect(await runEdgeSigningKeyCli(["generate", "--dir", youngDir, ...A], r.io, near.d)).toBe(1);
    expect(r.errs.join("\n")).toMatch(/cap of 16 keys.*nothing was changed/);
    expect(readFileSync(path.join(youngDir, "keyring.json"), "utf8")).toBe(freshText);
    expect(readdirSync(dir).filter((n) => n.endsWith(".pem")).length).toBe(pemsBefore);
  }, 60_000);
});

describe("edge-signing-key — files are the source of trust (no DB)", () => {
  it("root → next → activate → retire; root never retired; pin from the files; private key never printed; mirror failure never changes the files", async () => {
    const dir = f("ring1");
    const { d } = deps();
    const g = io();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], g.io, d)).toBe(0);
    expect(g.lines.join("\n")).not.toMatch(/PRIVATE/);
    expect(g.errs.join("\n")).toMatch(/WARNING: no mirror DB/);
    let kr = readEdgeKeyring(dir);
    const rootKey = kr.keys[0];
    expect(rootKey).toMatchObject({ root: true, status: "active" });
    if (process.platform !== "win32") expect(statSync(path.join(dir, `${rootKey.kid}.pem`)).mode & 0o777).toBe(0o600);
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, d)).toBe(0);
    kr = readEdgeKeyring(dir);
    const k2 = kr.keys[1];
    expect(k2).toMatchObject({ root: false, status: "next" });
    expect(kr.version).toBe(2);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k2.kid, ...A], io().io, d)).toBe(0);
    const v3 = readEdgeKeyring(dir).version;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k2.kid, ...A], io().io, d)).toBe(1); // not next any more
    expect(readEdgeKeyring(dir).version).toBe(v3);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--retire", rootKey.kid, ...A], io().io, d)).toBe(1);
    // the published keyset is derived from the files; an edge pinned on the root accepts it via the root, then the new signer
    const signer2 = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${k2.kid}.pem`) })!;
    const ks = buildEdgeKeysetFromKeyring(readEdgeKeyring(dir), signer2, { retiredGraceMs: 40_000 });
    expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin1.json"), ...A], io().io, d)).toBe(0);
    const pin = JSON.parse(readFileSync(f("pin1.json"), "utf8"));
    expect(pin.keyset.keys.map((k: { kid: string }) => k.kid)).toEqual([rootKey.kid]);
    expect(pin.keyset.version).toBe(v3);
    const store = EdgeTrustStore.fromPinFile(f("pin1.json"), { nodeId: 1 });
    const rootSigner = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${rootKey.kid}.pem`) })!;
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", ks, rootSigner)).ok).toBe(true);
    expect(verifyEdgeObject(signEdgeObject("cmd", { kind: "stop" }, signer2), "cmd", store).ok).toBe(true);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--retire", k2.kid, ...A], io().io, d)).toBe(0);
    expect(readEdgeKeyring(dir).keys.find((k) => k.kid === k2.kid)).toMatchObject({ status: "retired" });
    // a failing mirror never changes the files
    const failing = deps({ mirrorDb: { insert: () => ({ values: () => ({ onConflictDoNothing: async () => { throw new Error("db down"); } }) }), select: () => ({ from: async () => [] }) } });
    const fx = io();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], fx.io, failing.d)).toBe(0);
    expect(fx.errs.join("\n")).toMatch(/WARNING: mirror not updated/);
    expect(readEdgeKeyring(dir).keys).toHaveLength(3);
  });

  it("★ a tampered keyring (a key entry without its private key file) is refused by every command", async () => {
    const dir = f("ring2");
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, deps().d)).toBe(0);
    const planted = generateEdgeSigningKey().key;
    const raw = JSON.parse(readFileSync(path.join(dir, "keyring.json"), "utf8"));
    raw.keys.push({ kid: planted.kid, publicKeyPem: planted.publicKeyPem, status: "active", notBefore: Date.now(), retiredAt: null, root: false });
    chmodSync(path.join(dir, "keyring.json"), 0o600);
    writeFileSync(path.join(dir, "keyring.json"), JSON.stringify(raw));
    for (const argv of [["list", "--dir", dir], ["pin", "--dir", dir, "--out", f("pin2.json"), ...A], ["generate", "--dir", dir, ...A]]) {
      const t = io();
      expect(await runEdgeSigningKeyCli(argv, t.io, deps().d), argv[0]).toBe(1);
      expect(t.errs.join("\n")).toMatch(/keyring refused/);
    }
    expect(existsSync(f("pin2.json"))).toBe(false);
  });
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
class Rollback extends Error {}

describe.skipIf(!onTest)("edge-signing-key — the DB is a MIRROR only (owner connection, rolled back)", () => {
  it("★ R-10-c: a key row PLANTED in the DB is flagged by list and is never pinned or published", async () => {
    const u = new URL(DB_URL);
    u.username = process.env.MIGRATION_DB_USER ?? "aoi";
    u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
    const client = postgres(u.toString(), { max: 1, onnotice: () => {} });
    const owner = drizzle(client);
    const seen: Record<string, unknown> = {};
    try {
      await owner.transaction(async (tx) => {
        const dir = f("ring3");
        const x = deps({ mirrorDb: tx, audit: null });
        expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, ...A], io().io, x.d)).toBe(0);
        const rootKid = readEdgeKeyring(dir).keys[0].kid;
        const [row] = (await tx.select().from(edgeAuthSigningKeys)).filter((r) => r.kid === rootKid);
        seen.mirrored = Boolean(row);
        seen.createdBy = row?.createdBy;
        // an attacker with DB write plants an "active" key in the mirror
        const planted = generateEdgeSigningKey().key;
        await tx.insert(edgeAuthSigningKeys).values({ kid: planted.kid, publicKeyPem: planted.publicKeyPem, status: "active", createdBy: "attacker" });
        const l = io();
        expect(await runEdgeSigningKeyCli(["list", "--dir", dir], l.io, x.d)).toBe(0);
        seen.listOut = l.lines.join("\n");
        expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin3.json"), ...A], io().io, x.d)).toBe(0);
        const pin = JSON.parse(readFileSync(f("pin3.json"), "utf8"));
        seen.pinKids = pin.keyset.keys.map((k: { kid: string }) => k.kid);
        const signer = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${rootKid}.pem`) })!;
        seen.publishedKids = buildEdgeKeysetFromKeyring(readEdgeKeyring(dir), signer, { retiredGraceMs: 40_000 }).keys.map((k) => k.kid);
        // an object signed by the planted key never verifies on an edge pinned from the files
        const store = EdgeTrustStore.fromPinned(pin, { nodeId: 1 });
        seen.plantedVerifies = verifyEdgeObject(signEdgeObject("cmd", { kind: "stop" }, planted), "cmd", store).ok;
        seen.planted = planted.kid;
        seen.root = rootKid;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    } finally {
      await client.end({ timeout: 5 });
    }
    expect(seen.mirrored).toBe(true);
    expect(seen.createdBy).toBe("user:41 Admin Test"); // I7 — the proven actor, not a free-text name
    expect(seen.listOut).toContain(`MIRROR-ONLY (untrusted, ignored): ${seen.planted}`);
    expect(seen.pinKids).toEqual([seen.root]);
    expect(seen.publishedKids).toEqual([seen.root]);
    expect(seen.plantedVerifies).toBe(false);
  }, 60_000);

  it("★ I7 wiring: without an injected verifier the REAL verifyCredentialAdmin runs (on _test) — an unknown admin is refused and nothing is written", async () => {
    const dir = f("ring-real");
    const t = io("definitely-not-a-password\n");
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--actor", `__dot10Afix_no_such_admin_${Date.now()}`], t.io, { mirrorDb: null, audit: null })).toBe(1);
    expect(t.errs.join("\n")).toMatch(/refused \((notVerified|dbUnavailable)\)/);
    expect(existsSync(dir)).toBe(false);
  }, 60_000);
});
