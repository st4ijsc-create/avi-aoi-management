/**
 * doc 81 Đợt 10 task A — scripts/edge-signing-key.ts (fix scan 2, ruling R-10-c): TRUST COMES FROM THE KEY FILES. The private
 * key goes only to `<dir>/<kid>.pem` (new, 0600; never printed, never in the DB); keyring.json holds status / root / version;
 * generate / rotate / pin read and write ONLY the files; the DB table is a MIRROR written with the owner connection, and a row
 * PLANTED there is flagged by `list` and never pinned or published.
 * DB cases run on `_test` with an OWNER connection inside a transaction that is ROLLED BACK.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { edgeAuthSigningKeys } from "../server/services/edge/edgeControlSchema";
import { EdgeTrustStore, buildEdgeKeysetFromKeyring, generateEdgeSigningKey, loadEdgeSigningKey, readEdgeKeyring, signEdgeObject, verifyEdgeObject } from "../server/services/edge/edgeSigning";
import { runEdgeSigningKeyCli } from "./edge-signing-key";

const root = mkdtempSync(path.join(tmpdir(), "edge-signing-key-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const f = (n: string) => path.join(root, n);

function io() {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, io: { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l), env: {} as NodeJS.ProcessEnv } };
}

describe("edge-signing-key — arguments (no DB, no files touched)", () => {
  it("refuses bad usage", async () => {
    const deps = { mirrorDb: null };
    for (const [argv, code] of [
      [[], 2],
      [["bogus"], 2],
      [["generate", "--by", "me"], 2], // no --dir
      [["generate", "--dir", f("a")], 2], // no --by
      [["rotate", "--dir", f("a"), "--by", "me"], 2],
      [["rotate", "--dir", f("a"), "--activate", "k", "--retire", "k", "--by", "me"], 2],
      [["generate", "--dir", f("a"), "--by", "me", "--private-key", "x"], 2],
      [["pin", "--dir", f("a")], 2],
      [["list", "--dir", f("nope")], 1], // no keyring
    ] as Array<[string[], number]>) {
      const t = io();
      expect(await runEdgeSigningKeyCli(argv, t.io, deps), argv.join(" ")).toBe(code);
    }
    expect(existsSync(f("a"))).toBe(false);
    writeFileSync(f("exists.json"), "keep");
    expect(await runEdgeSigningKeyCli(["pin", "--dir", f("a"), "--out", f("exists.json")], io().io, deps)).toBe(1);
    expect(readFileSync(f("exists.json"), "utf8")).toBe("keep");
  });
});

describe("edge-signing-key — files are the source of trust (no DB)", () => {
  it("root → next → activate → retire; root never retired; pin from the files; private key never printed; mirror failure never changes the files", async () => {
    const dir = f("ring1");
    const deps = { mirrorDb: null };
    const g = io();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--by", "admin.test"], g.io, deps)).toBe(0);
    expect(g.lines.join("\n")).not.toMatch(/PRIVATE/);
    expect(g.errs.join("\n")).toMatch(/WARNING: no mirror DB/);
    let kr = readEdgeKeyring(dir);
    const rootKey = kr.keys[0];
    expect(rootKey).toMatchObject({ root: true, status: "active" });
    if (process.platform !== "win32") expect(statSync(path.join(dir, `${rootKey.kid}.pem`)).mode & 0o777).toBe(0o600);
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--by", "admin.test"], io().io, deps)).toBe(0);
    kr = readEdgeKeyring(dir);
    const k2 = kr.keys[1];
    expect(k2).toMatchObject({ root: false, status: "next" });
    expect(kr.version).toBe(2);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k2.kid, "--by", "admin.test"], io().io, deps)).toBe(0);
    const v3 = readEdgeKeyring(dir).version;
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--activate", k2.kid, "--by", "admin.test"], io().io, deps)).toBe(1); // not next any more
    expect(readEdgeKeyring(dir).version).toBe(v3);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--retire", rootKey.kid, "--by", "admin.test"], io().io, deps)).toBe(1);
    // the published keyset is derived from the files; an edge pinned on the root accepts it via the root, then the new signer
    const signer2 = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${k2.kid}.pem`) })!;
    const ks = buildEdgeKeysetFromKeyring(readEdgeKeyring(dir), signer2, { retiredGraceMs: 40_000 });
    expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin1.json")], io().io, deps)).toBe(0);
    const pin = JSON.parse(readFileSync(f("pin1.json"), "utf8"));
    expect(pin.keys.map((k: { kid: string }) => k.kid)).toEqual([rootKey.kid]);
    const store = EdgeTrustStore.fromPinned(pin, { nodeId: 1 });
    const rootSigner = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${rootKey.kid}.pem`) })!;
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", ks, rootSigner)).ok).toBe(true);
    expect(verifyEdgeObject(signEdgeObject("cmd", { kind: "stop" }, signer2), "cmd", store).ok).toBe(true);
    expect(await runEdgeSigningKeyCli(["rotate", "--dir", dir, "--retire", k2.kid, "--by", "admin.test"], io().io, deps)).toBe(0);
    expect(readEdgeKeyring(dir).keys.find((k) => k.kid === k2.kid)).toMatchObject({ status: "retired" });
    // a failing mirror never changes the files
    const failing = { mirrorDb: { insert: () => ({ values: () => ({ onConflictDoNothing: async () => { throw new Error("db down"); } }) }), select: () => ({ from: async () => [] }) } };
    const fx = io();
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--by", "admin.test"], fx.io, failing)).toBe(0);
    expect(fx.errs.join("\n")).toMatch(/WARNING: mirror not updated/);
    expect(readEdgeKeyring(dir).keys).toHaveLength(3);
  });

  it("★ a tampered keyring (a key entry without its private key file) is refused by every command", async () => {
    const dir = f("ring2");
    expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--by", "admin.test"], io().io, { mirrorDb: null })).toBe(0);
    const planted = generateEdgeSigningKey().key;
    const raw = JSON.parse(readFileSync(path.join(dir, "keyring.json"), "utf8"));
    raw.keys.push({ kid: planted.kid, publicKeyPem: planted.publicKeyPem, status: "active", notBefore: Date.now(), retiredAt: null, root: false });
    chmodSync(path.join(dir, "keyring.json"), 0o600);
    writeFileSync(path.join(dir, "keyring.json"), JSON.stringify(raw));
    for (const argv of [["list", "--dir", dir], ["pin", "--dir", dir, "--out", f("pin2.json")], ["generate", "--dir", dir, "--by", "x"]]) {
      const t = io();
      expect(await runEdgeSigningKeyCli(argv, t.io, { mirrorDb: null }), argv[0]).toBe(1);
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
        const deps = { mirrorDb: tx };
        expect(await runEdgeSigningKeyCli(["generate", "--dir", dir, "--by", "admin.test"], io().io, deps)).toBe(0);
        const rootKid = readEdgeKeyring(dir).keys[0].kid;
        seen.mirrored = (await tx.select().from(edgeAuthSigningKeys)).some((r) => r.kid === rootKid);
        // an attacker with DB write plants an "active" key in the mirror
        const planted = generateEdgeSigningKey().key;
        await tx.insert(edgeAuthSigningKeys).values({ kid: planted.kid, publicKeyPem: planted.publicKeyPem, status: "active", createdBy: "attacker" });
        const l = io();
        expect(await runEdgeSigningKeyCli(["list", "--dir", dir], l.io, deps)).toBe(0);
        seen.listOut = l.lines.join("\n");
        expect(await runEdgeSigningKeyCli(["pin", "--dir", dir, "--out", f("pin3.json")], io().io, deps)).toBe(0);
        const pin = JSON.parse(readFileSync(f("pin3.json"), "utf8"));
        seen.pinKids = pin.keys.map((k: { kid: string }) => k.kid);
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
    expect(seen.listOut).toContain(`MIRROR-ONLY (untrusted, ignored): ${seen.planted}`);
    expect(seen.pinKids).toEqual([seen.root]);
    expect(seen.publishedKids).toEqual([seen.root]);
    expect(seen.plantedVerifies).toBe(false);
  }, 60_000);
});
