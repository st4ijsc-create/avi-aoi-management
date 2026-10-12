/**
 * doc 81 Đợt 10 task A — scripts/edge-signing-key.ts: the private key goes ONLY to a new 0600 file (never printed, never in
 * the DB); public keys + endorsements go to edge_auth_signing_keys; genesis root / next / activate / retire / pin.
 * DB cases run on `_test` inside a transaction that is ROLLED BACK (the CLI takes the transaction as its db).
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../server/db/connection";
import { edgeAuthSigningKeys } from "../server/services/edge/edgeControlSchema";
import { EdgeTrustStore, buildEdgeKeyset, edgeSigningKeyFromPem, parseEdgeKeyset, verifyEdgeKeyEndorsement } from "../server/services/edge/edgeSigning";
import { runEdgeSigningKeyCli } from "./edge-signing-key";

const dir = mkdtempSync(path.join(tmpdir(), "edge-signing-key-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const f = (n: string) => path.join(dir, n);

function io() {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, io: { out: (l: string) => lines.push(l), err: (l: string) => errs.push(l), env: {} as NodeJS.ProcessEnv } };
}

describe("edge-signing-key — arguments (no DB touched)", () => {
  it("refuses bad usage before any DB / file work", async () => {
    const noDb = { db: { select: () => { throw new Error("DB must not be touched"); } } };
    for (const [argv, code] of [
      [[], 2],
      [["bogus"], 2],
      [["generate", "--out", f("x.pem")], 2], // no --by
      [["generate", "--by", "me"], 2], // no --out
      [["rotate", "--by", "me"], 2],
      [["rotate", "--activate", "k", "--retire", "k", "--by", "me"], 2],
      [["generate", "--out", f("y.pem"), "--by", "me", "--private-key", "x"], 2],
      [["pin"], 2],
    ] as Array<[string[], number]>) {
      const t = io();
      expect(await runEdgeSigningKeyCli(argv, t.io, noDb), argv.join(" ")).toBe(code);
    }
    writeFileSync(f("exists.pem"), "keep");
    const t = io();
    expect(await runEdgeSigningKeyCli(["generate", "--out", f("exists.pem"), "--by", "me"], t.io, noDb)).toBe(1);
    expect(readFileSync(f("exists.pem"), "utf8")).toBe("keep");
  });
});

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
class Rollback extends Error {}

describe.skipIf(!onTest)("edge-signing-key — lifecycle on _test (rolled back)", () => {
  it("genesis → next (endorsed) → activate → retire; root never retired; pin; private key never in the DB or on stdout", async () => {
    const d = (await getDb())!;
    const seen: Record<string, unknown> = {};
    try {
      await d.transaction(async (tx) => {
        // start from a clean key table inside this transaction (other rows are retired here and restored by the rollback)
        await tx.execute(sql`UPDATE edge_auth_signing_keys SET status = 'retired', "retiredAt" = now() WHERE status <> 'retired'`);
        const deps = { db: tx };
        const g = io();
        seen.genesis = await runEdgeSigningKeyCli(["generate", "--out", f("k1.pem"), "--by", "admin.test"], g.io, deps);
        seen.genesisOut = g.lines.join("\n");
        const k1 = edgeSigningKeyFromPem(readFileSync(f("k1.pem"), "utf8"));
        if (process.platform !== "win32") seen.mode = statSync(f("k1.pem")).mode & 0o777;
        const n0 = io();
        seen.nextNoEndorser = await runEdgeSigningKeyCli(["generate", "--out", f("k2.pem"), "--by", "admin.test"], n0.io, deps);
        seen.k2FileAfterRefusal = existsSync(f("k2.pem"));
        const n1 = io();
        seen.next = await runEdgeSigningKeyCli(["generate", "--out", f("k2.pem"), "--by", "admin.test", "--endorser-file", f("k1.pem")], n1.io, deps);
        const k2 = edgeSigningKeyFromPem(readFileSync(f("k2.pem"), "utf8"));
        const rows1 = await tx.select().from(edgeAuthSigningKeys);
        const r1 = rows1.find((r) => r.kid === k1.kid)!;
        const r2 = rows1.find((r) => r.kid === k2.kid)!;
        seen.r1 = { status: r1.status, endorsedByKid: r1.endorsedByKid };
        seen.r2 = { status: r2.status, endorsedByKid: r2.endorsedByKid, endorsementVerifies: verifyEdgeKeyEndorsement(r2, r1.publicKeyPem) };
        seen.privateInDb = JSON.stringify(rows1).includes("PRIVATE KEY");
        const a = io();
        seen.activate = await runEdgeSigningKeyCli(["rotate", "--activate", k2.kid, "--by", "admin.test"], a.io, deps);
        const built = buildEdgeKeyset(await tx.select().from(edgeAuthSigningKeys), k2, { version: 2, retiredGraceMs: 40_000 });
        seen.built = { root: built.rootKid === k1.kid, kids: built.keyset.keys.map((k) => k.kid).sort() };
        const rr = io();
        seen.retireRoot = await runEdgeSigningKeyCli(["rotate", "--retire", k1.kid, "--by", "admin.test"], rr.io, deps);
        const p = io();
        seen.pin = await runEdgeSigningKeyCli(["pin", "--out", f("edge-keyset.json"), "--by", "admin.test"], p.io, deps);
        const pin = JSON.parse(readFileSync(f("edge-keyset.json"), "utf8"));
        seen.pinParsed = parseEdgeKeyset(pin).ok && pin.keys.length === 1 && pin.keys[0].kid === k1.kid;
        seen.storeFromPin = EdgeTrustStore.fromPinned(pin, { nodeId: 1 }).version;
        const r = io();
        seen.retire2 = await runEdgeSigningKeyCli(["rotate", "--retire", k2.kid, "--by", "admin.test"], r.io, deps);
        const l = io();
        seen.list = await runEdgeSigningKeyCli(["list"], l.io, deps);
        seen.listOut = l.lines.join("\n");
        const [after2] = (await tx.select().from(edgeAuthSigningKeys)).filter((x) => x.kid === k2.kid);
        seen.after2 = { status: after2.status, retired: after2.retiredAt !== null };
        // a RETIRED key cannot endorse a new one
        const re = io();
        seen.retiredEndorser = await runEdgeSigningKeyCli(["generate", "--out", f("k3r.pem"), "--by", "admin.test", "--endorser-file", f("k2.pem")], re.io, deps);
        seen.k3rLeft = existsSync(f("k3r.pem"));
        // a failed DB insert (with a valid, active endorser) leaves no key file behind
        const failing = { db: { select: tx.select.bind(tx), insert: () => ({ values: async () => { throw new Error("db down"); } }) } };
        const fx = io();
        seen.failedInsert = await runEdgeSigningKeyCli(["generate", "--out", f("k3.pem"), "--by", "admin.test", "--endorser-file", f("k1.pem")], fx.io, failing);
        seen.failedInsertMsg = fx.errs.join("\n");
        seen.k3Left = existsSync(f("k3.pem"));
        // a `next` row whose endorsement does not verify is never activated
        const k4 = edgeSigningKeyFromPem((await import("../server/services/edge/edgeSigning")).generateEdgeSigningKey().privateKeyPem);
        const bogusSig = (await import("../server/services/edge/edgeSigning")).endorseEdgeKey(k2, { kid: k4.kid, publicKeyPem: k4.publicKeyPem, notBefore: new Date() });
        await tx.insert(edgeAuthSigningKeys).values({ kid: k4.kid, publicKeyPem: k4.publicKeyPem, status: "next", createdBy: "admin.test", endorsedByKid: k1.kid, endorsementSig: bogusSig });
        const bad = io();
        seen.activateBadEndorsement = await runEdgeSigningKeyCli(["rotate", "--activate", k4.kid, "--by", "admin.test"], bad.io, deps);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(seen).toMatchObject({
      genesis: 0,
      nextNoEndorser: 2,
      k2FileAfterRefusal: false,
      next: 0,
      r1: { status: "active", endorsedByKid: null },
      r2: { status: "next", endorsementVerifies: true },
      privateInDb: false,
      activate: 0,
      built: { root: true },
      retireRoot: 1,
      pin: 0,
      pinParsed: true,
      storeFromPin: 1,
      retire2: 0,
      list: 0,
      after2: { status: "retired", retired: true },
      retiredEndorser: 1,
      k3rLeft: false,
      failedInsert: 1,
      failedInsertMsg: expect.stringContaining("could not be recorded"),
      k3Left: false,
      activateBadEndorsement: 1,
    });
    expect((seen.built as { kids: string[] }).kids).toHaveLength(2);
    expect(seen.genesisOut).not.toMatch(/PRIVATE/);
    expect(seen.listOut).toMatch(/ROOT \(genesis\)/);
    if (process.platform !== "win32") expect(seen.mode).toBe(0o600);
  }, 60_000);
});
