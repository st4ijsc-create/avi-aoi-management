/**
 * doc 81 Đợt 7 task K2 — the revoke script and the read-only list, proven on `_test` with FIXTURE keys.
 *
 * The real scripts are spawned (node scripts/revoke-machine-keys.mjs / list-test-machine-keys.mjs) with the child's
 * DATABASE_URL and TEST_DATABASE_URL both pointing at the `_test` DB that vitest.setup.ts forced — the dev DB is never
 * reachable from this file. Outcome checks go through the app's own authenticateMachine (a revoked key is refused).
 *
 * Contract measured:
 *   • refuses without an explicit --list file, without exactly one target flag, with a missing/invalid list (exit 2);
 *   • dry run by default (READ ONLY, rolled back);
 *   • ONE transaction: one bad row (wrong machine code, unknown id, non-machine key) ⇒ exit 3 and NOTHING changes;
 *   • --confirm: listed keys inactive + revokedAt (an already-revoked key keeps its stamp), unlisted keys untouched, no
 *     row deleted, one audit row, re-run is a no-op;
 *   • neither script prints/writes key material.
 * Fix round 1 (review #1/#5/#6): only REVOKE-classified machines (file `proposed` column AND in-transaction re-classification
 * of the DB machine code), --confirm bound to the list's sha256, --dev-only = exactly `aoi_management`, no audit row for a
 * no-op re-run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { classifyMachineCode, parseRevokeList } from "./lib/machineKeyRevoke.mjs";
import { authenticateMachine, _resetMachineAuthState } from "../server/services/machineAuthService";

const ROOT = path.resolve(__dirname, "..");
const TEST_URL = process.env.DATABASE_URL!; // forced to <db>_test by vitest.setup.ts
const STAMP = `${Date.now()}`;
const sql = postgres(TEST_URL, { max: 2, onnotice: () => {} });
const tmp = mkdtempSync(path.join(tmpdir(), "dot7-k2-"));

type Key = { id: number; plaintext: string; hash: string; prefix: string };
let qaMachine: { id: number; code: string };
let otherMachine: { id: number; code: string };
let askMachine: { id: number; code: string };
const k: Record<string, Key> = {};
let nonMachineKeyId: number;

function hash(p: string) {
  return createHash("sha256").update(p, "utf8").digest("hex");
}
async function mkMachine(code: string) {
  const [r] = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
    VALUES (1, ${code}, ${"K2 fixture " + code}, 'AVI', true) RETURNING id`;
  return { id: r.id as number, code };
}
async function mkKey(machineId: number | null, name: string, revoked = false): Promise<Key> {
  const plaintext = `mk_${randomBytes(24).toString("hex")}`;
  const [r] = await sql`
    INSERT INTO api_keys (name, "keyHash", "keyPrefix", scopes, "isActive", "machineId", "revokedAt")
    VALUES (${name}, ${hash(plaintext)}, ${plaintext.slice(0, 9)}, ${sql.json(["ingest:write", "equipment:read", "edge:sync"])},
            ${!revoked}, ${machineId}, ${revoked ? sql`(now() AT TIME ZONE 'UTC') - interval '1 day'` : null})
    RETURNING id`;
  return { id: r.id as number, plaintext, hash: hash(plaintext), prefix: plaintext.slice(0, 9) };
}
async function state(ids: number[]) {
  const rows = await sql`
    SELECT id, "isActive" AS active, to_char("revokedAt", 'YYYY-MM-DD HH24:MI:SS.US') AS revoked_at
      FROM api_keys WHERE id IN ${sql(ids)} ORDER BY id`;
  return Object.fromEntries(rows.map((r) => [r.id, { active: r.active, revokedAt: r.revoked_at }]));
}
function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
/** --confirm args bound to the file's sha256 (fix round 1). */
function confirmArgs(f: string) {
  return ["--list", f, "--confirm", "--sha256", createHash("sha256").update(readFileSync(f, "utf8"), "utf8").digest("hex")];
}
function listFile(name: string, rows: Array<[number | string, string]>, header = "key_id,machine_code") {
  const p = path.join(tmp, name);
  writeFileSync(p, [header, ...rows.map(([a, b]) => `${a},${b}`)].join("\n") + "\n");
  return p;
}

beforeAll(async () => {
  _resetMachineAuthState();
  qaMachine = await mkMachine(`QATD-Z-K2-${STAMP}`);
  otherMachine = await mkMachine(`K2KEEP-${STAMP}`);
  askMachine = await mkMachine(`SIM-L9-K2-${STAMP}`); // classifies SIM-LINE / ASK
  k.a = await mkKey(qaMachine.id, `k2-a-${STAMP}`);
  k.b = await mkKey(qaMachine.id, `k2-b-${STAMP}`);
  k.old = await mkKey(qaMachine.id, `k2-old-${STAMP}`, true); // already revoked yesterday
  k.bystander = await mkKey(qaMachine.id, `k2-bystander-${STAMP}`); // same machine, NOT listed
  k.other = await mkKey(otherMachine.id, `k2-other-${STAMP}`);
  k.ask = await mkKey(askMachine.id, `k2-ask-${STAMP}`);
  const nm = await mkKey(null, `k2-nonmachine-${STAMP}`);
  nonMachineKeyId = nm.id;
});

afterAll(async () => {
  const ids = [...Object.values(k).map((x) => x.id), nonMachineKeyId].filter(Boolean);
  if (ids.length) await sql`DELETE FROM api_keys WHERE id IN ${sql(ids)}`;
  const ms = [qaMachine?.id, otherMachine?.id, askMachine?.id].filter(Boolean) as number[];
  if (ms.length) await sql`DELETE FROM machines WHERE id IN ${sql(ms)}`;
  await sql.end({ timeout: 5 });
  rmSync(tmp, { recursive: true, force: true });
});

describe("K2 — classification and list parsing (pure)", () => {
  it("owner-named groups are REVOKE, sim lines are ASK, anything else KEEP", () => {
    expect(classifyMachineCode("FUYU-F-T1-L1-M1").proposed).toBe("REVOKE");
    expect(classifyMachineCode("QATD-B-T4-X2-L4-M15").proposed).toBe("REVOKE");
    expect(classifyMachineCode("T12-SHOT-MC-x").proposed).toBe("REVOKE");
    expect(classifyMachineCode("SIM-L1-AOI").proposed).toBe("ASK");
    expect(classifyMachineCode("ESP32-ENV-01").proposed).toBe("ASK");
    expect(classifyMachineCode("AOI-LINE-01")).toMatchObject({ group: "OTHER", proposed: "KEEP" });
    expect(classifyMachineCode("XQATD-A-1").proposed).toBe("KEEP"); // anchored — no substring guessing
  });

  it("the list parser refuses duplicates, bad ids, empty lists and a missing header", () => {
    expect(parseRevokeList("key_id,machine_code\n5,A\n5,A\n").errors.join()).toMatch(/twice/);
    expect(parseRevokeList("key_id,machine_code\n-1,A\n").errors.join()).toMatch(/positive integer/);
    expect(parseRevokeList("key_id,machine_code\n").errors.join()).toMatch(/no key rows/);
    expect(parseRevokeList("id,code\n5,A\n").errors.join()).toMatch(/header/);
    expect(parseRevokeList('group,key_id,machine_code\nX,7,"QATD-A-1"\n')).toEqual({
      entries: [{ keyId: 7, machineCode: "QATD-A-1" }],
      errors: [],
    });
  });
});

describe("K2 — revoke-machine-keys.mjs on _test (fixture keys)", () => {
  it("refuses without an explicit list file / target flag / valid list — and changes nothing", async () => {
    const before = await state([k.a.id, k.b.id]);
    const good = listFile("good0.csv", [[k.a.id, qaMachine.code]]);
    const noList = run("revoke-machine-keys.mjs", ["--test-only", "--confirm"]);
    expect(noList.code).toBe(2);
    expect(noList.out).toMatch(/explicit --list/);
    const noTarget = run("revoke-machine-keys.mjs", confirmArgs(good));
    expect(noTarget.code).toBe(2);
    const missing = run("revoke-machine-keys.mjs", ["--test-only", "--list", path.join(tmp, "nope.csv"), "--confirm"]);
    // fix round 1: --confirm without --sha256, or with a hash of another file ⇒ refused before any connection
    const noSha = run("revoke-machine-keys.mjs", ["--test-only", "--list", good, "--confirm"]);
    expect(noSha.code).toBe(2);
    expect(noSha.out).toMatch(/--confirm needs --sha256/);
    const badSha = run("revoke-machine-keys.mjs", ["--test-only", "--list", good, "--confirm", "--sha256", "0".repeat(64)]);
    expect(badSha.code).toBe(2);
    expect(badSha.out).toMatch(/does not match the list file/);
    expect(missing.code).toBe(2);
    const dup = listFile("dup.csv", [[k.a.id, qaMachine.code], [k.a.id, qaMachine.code]]);
    expect(run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(dup)]).code).toBe(2);
    // --dev-only that resolves to a *_test DB is refused too (the target flag must mean what it says)
    const devToTest = run("revoke-machine-keys.mjs", ["--dev-only", ...confirmArgs(good)]);
    expect(devToTest.code).toBe(3);
    expect(devToTest.out).toMatch(/expected exactly "aoi_management"/); // fix round 1 (#5): exact name, not "not *_test"
    // …and a --dev-only that resolves to a database that is neither *_test nor aoi_management (the server's own
    // `postgres` maintenance DB — NOT dev; the script only runs SELECT current_database() there and rolls back) is refused.
    const other = new URL(TEST_URL);
    other.pathname = "/postgres";
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "revoke-machine-keys.mjs"), "--dev-only", ...confirmArgs(good)], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: other.toString(), TEST_DATABASE_URL: TEST_URL },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(3);
    expect(r.stderr).toMatch(/--dev-only resolved to "postgres", expected exactly "aoi_management"/);
    expect(await state([k.a.id, k.b.id])).toEqual(before);
  });

  it("dry run by default: reports, changes nothing", async () => {
    const before = await state([k.a.id, k.b.id, k.old.id]);
    const f = listFile("dry.csv", [[k.a.id, qaMachine.code], [k.b.id, qaMachine.code], [k.old.id, qaMachine.code]]);
    const r = run("revoke-machine-keys.mjs", ["--test-only", "--list", f]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/would_revoke=2 already_revoked=1/);
    const sha = createHash("sha256").update(readFileSync(f, "utf8"), "utf8").digest("hex");
    expect(r.out).toContain(`list_sha256=${sha}`); // fix round 1: the owner approves THIS hash
    expect(await state([k.a.id, k.b.id, k.old.id])).toEqual(before);
  });

  it("ONE transaction: a single wrong machine code / unknown id / non-machine key ⇒ exit 3 and NOTHING revoked", async () => {
    const before = await state([k.a.id, k.b.id]);
    const wrongCode = listFile("wrong.csv", [[k.a.id, qaMachine.code], [k.other.id, qaMachine.code]]);
    const r1 = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(wrongCode)]);
    expect(r1.code, r1.out).toBe(3);
    expect(r1.out).toMatch(new RegExp(`key ${k.other.id}: list says machine`));
    const unknown = listFile("unknown.csv", [[k.a.id, qaMachine.code], [2_000_000_000, qaMachine.code]]);
    expect(run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(unknown)]).code).toBe(3);
    const nonMachine = listFile("nonmachine.csv", [[k.b.id, qaMachine.code], [nonMachineKeyId, qaMachine.code]]);
    const r3 = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(nonMachine)]);
    expect(r3.code).toBe(3);
    expect(r3.out).toMatch(/not a machine key/);
    expect(await state([k.a.id, k.b.id])).toEqual(before);
    const ok = await authenticateMachine({ apiKey: k.a.plaintext, scope: "ingest:write" });
    expect(ok.keyId).toBe(k.a.id);
  });

  it("--confirm revokes exactly the listed keys (never deletes), keeps old stamps, audits once; re-run is a no-op", async () => {
    const [{ n: rowsBefore }] = await sql`SELECT count(*)::int AS n FROM api_keys WHERE "machineId" = ${qaMachine.id}`;
    const oldBefore = (await state([k.old.id]))[k.old.id];
    const fname = `approved-${STAMP}.csv`;
    const f = listFile(fname, [[k.a.id, qaMachine.code], [k.b.id, qaMachine.code], [k.old.id, qaMachine.code]]);
    const r = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(f)]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/COMMITTED: listed=3 revoked=2 already_revoked=1/);

    const s = await state([k.a.id, k.b.id, k.old.id, k.bystander.id, k.other.id]);
    expect(s[k.a.id].active).toBe(false);
    expect(s[k.a.id].revokedAt).not.toBeNull();
    expect(s[k.b.id].active).toBe(false);
    expect(s[k.old.id]).toEqual(oldBefore); // already revoked ⇒ untouched (stamp kept)
    expect(s[k.bystander.id]).toEqual({ active: true, revokedAt: null }); // same machine, not listed
    expect(s[k.other.id]).toEqual({ active: true, revokedAt: null });
    const [{ n: rowsAfter }] = await sql`SELECT count(*)::int AS n FROM api_keys WHERE "machineId" = ${qaMachine.id}`;
    expect(rowsAfter).toBe(rowsBefore); // nothing deleted

    // outcome: the app refuses the revoked key, still accepts the bystander
    await expect(authenticateMachine({ apiKey: k.a.plaintext, scope: "ingest:write" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const ok = await authenticateMachine({ apiKey: k.bystander.plaintext, scope: "ingest:write" });
    expect(ok.keyId).toBe(k.bystander.id);

    const audits = await sql`
      SELECT details FROM audit_logs WHERE action = 'machine.key.revoke.bulk' AND "entityName" = ${fname}`;
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].details as string)).toMatchObject({ alreadyRevoked: [k.old.id], listed: 3 });

    expect(JSON.parse(audits[0].details as string).revoked).toEqual([k.a.id, k.b.id].sort((x, y) => x - y));

    const again = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(f)]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toMatch(/revoked=0 already_revoked=3/);
    // fix round 1 (#6): a no-op re-run writes NO second audit row
    const audits2 = await sql`SELECT id FROM audit_logs WHERE action = 'machine.key.revoke.bulk' AND "entityName" = ${fname}`;
    expect(audits2).toHaveLength(1);
  });

  it("fix round 1 (#1): a file with ANY non-REVOKE `proposed` row (the full listing) is refused whole — nothing changes", async () => {
    const before = await state([k.bystander.id, k.ask.id, k.other.id]);
    const header = "group,proposed,machine_code,key_id";
    const full = path.join(tmp, "full-listing.csv");
    writeFileSync(
      full,
      [header, `QATD,REVOKE,${qaMachine.code},${k.bystander.id}`, `SIM-LINE,ASK,${askMachine.code},${k.ask.id}`].join("\n") + "\n",
    );
    for (const args of [["--list", full], confirmArgs(full)]) {
      const r = run("revoke-machine-keys.mjs", ["--test-only", ...args]);
      expect(r.code, r.out).toBe(2);
      expect(r.out).toMatch(new RegExp(`key_id ${k.ask.id} is proposed "ASK", not REVOKE`));
    }
    const keepRow = path.join(tmp, "keep-row.csv");
    writeFileSync(keepRow, [header, `OTHER,KEEP,${otherMachine.code},${k.other.id}`].join("\n") + "\n");
    expect(run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(keepRow)]).code).toBe(2);
    // a listing-shaped file whose rows are ALL REVOKE is accepted (dry run)
    const onlyRevoke = path.join(tmp, "only-revoke.csv");
    writeFileSync(onlyRevoke, [header, `QATD,REVOKE,${qaMachine.code},${k.bystander.id}`].join("\n") + "\n");
    const ok = run("revoke-machine-keys.mjs", ["--test-only", "--list", onlyRevoke]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/would_revoke=1/);
    expect(await state([k.bystander.id, k.ask.id, k.other.id])).toEqual(before);
  });

  it("fix round 1 (#1): the DB machine code is re-classified in the transaction — an ASK or KEEP machine ⇒ exit 3, nothing revoked", async () => {
    const before = await state([k.bystander.id, k.ask.id, k.other.id]);
    // a plain key_id,machine_code list (no proposed column) naming an ASK machine next to a valid REVOKE one
    const askList = listFile("ask.csv", [[k.bystander.id, qaMachine.code], [k.ask.id, askMachine.code]]);
    const r1 = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(askList)]);
    expect(r1.code, r1.out).toBe(3);
    expect(r1.out).toMatch(new RegExp(`key ${k.ask.id}: machine "${askMachine.code}" classifies as SIM-LINE/ASK, not REVOKE`));
    const keepList = listFile("keep.csv", [[k.other.id, otherMachine.code]]);
    const r2 = run("revoke-machine-keys.mjs", ["--test-only", ...confirmArgs(keepList)]);
    expect(r2.code, r2.out).toBe(3);
    expect(r2.out).toMatch(/classifies as OTHER\/KEEP, not REVOKE/);
    expect(await state([k.bystander.id, k.ask.id, k.other.id])).toEqual(before);
  });

  it("the scripts never DELETE a key", () => {
    for (const f of ["scripts/revoke-machine-keys.mjs", "scripts/lib/machineKeyRevoke.mjs"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8")).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });
});

describe("K2 — list-test-machine-keys.mjs on _test (READ ONLY)", () => {
  it("lists the fixture keys with group/proposal, writes the revoke list, and no key material", () => {
    const out = path.join(tmp, "keys.csv");
    const rl = path.join(tmp, "revoke-list.csv");
    const r = run("list-test-machine-keys.mjs", ["--test-only", "--out", out, "--revoke-list-out", rl]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/READ ONLY, rolled back/);
    const csv = readFileSync(out, "utf8");
    const line = (id: number) => csv.split("\n").find((l) => l.split(",")[5] === String(id)) ?? "";
    expect(line(k.bystander.id)).toMatch(new RegExp(`^QATD,REVOKE,${qaMachine.code},`));
    expect(line(k.other.id)).toMatch(new RegExp(`^OTHER,KEEP,${otherMachine.code},`));
    expect(line(k.ask.id)).toMatch(new RegExp(`^SIM-LINE,ASK,${askMachine.code},`));
    expect(line(k.old.id)).toMatch(/^QATD,NONE \(already inactive\),/);
    const revokeList = readFileSync(rl, "utf8");
    expect(revokeList.split("\n")[0]).toBe("key_id,machine_code");
    expect(revokeList).toContain(`${k.bystander.id},${qaMachine.code}`);
    expect(revokeList).not.toContain(`${k.other.id},`);
    expect(revokeList).not.toContain(`${k.ask.id},`);
    for (const x of Object.values(k)) {
      for (const secret of [x.plaintext, x.hash, x.prefix]) {
        expect(csv.includes(secret)).toBe(false);
        expect(r.out.includes(secret)).toBe(false);
      }
    }
  });
});
