/**
 * doc 81 Đợt 9 task S1/S5 — the operator CLI `scripts/edge-node-credential.ts` on the REAL `_test` DB: issue with `--out` writes
 * the secret ONLY to a new 0600 file (never to stdout, never over an existing file, no file left behind on a refusal); without
 * `--out` it is printed once; rotate / revoke / list follow the rows; a non-admin actor and bad arguments are refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { runEdgeCredentialCli } from "./edge-node-credential";

const DB_URL = process.env.DATABASE_URL;
const DAU = `S9CLI-${Date.now()}`;
const ids = { admin: 0, eng: 0, node: 0 };
let sql: ReturnType<typeof postgres>;
let dir = "";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe.skipIf(!DB_URL)("doc 81 Đợt 9 S1/S5 — edge node credential CLI (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    ids.admin = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${DAU + "-a"}, ${DAU + "-a"}, 'cli admin', 'admin', true) RETURNING id`)[0].id);
    ids.eng = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${DAU + "-e"}, ${DAU + "-e"}, 'cli eng', 'engineer', true) RETURNING id`)[0].id);
    ids.node = Number((await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${"N-" + DAU}, 'cli node', 'offline') RETURNING id`)[0].id);
    dir = mkdtempSync(path.join(os.tmpdir(), "s9-cli-"));
  }, 60_000);

  afterAll(async () => {
    if (ids.node) await sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`;
    await sql`DELETE FROM users WHERE id IN ${sql([ids.admin, ids.eng].filter(Boolean))}`.catch(() => undefined);
    await sql.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("★ bad arguments ⇒ 2; a non-admin actor ⇒ 1 and NO file is left behind", async () => {
    expect((await cli("issue")).code).toBe(2);
    expect((await cli("explode", "--node", `N-${DAU}`)).code).toBe(2);
    expect((await cli("issue", "--node", `N-${DAU}`, "--reason", "no actor")).code).toBe(2);
    const f = path.join(dir, "refused.cred");
    const r = await cli("issue", "--node", `N-${DAU}`, "--actor-user-id", String(ids.eng), "--reason", "engineer tries", "--out", f);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/notAdmin/);
    expect(existsSync(f)).toBe(false);
  });

  it("★ issue --out: the secret goes ONLY to the new file; stdout carries the prefix, never the secret; the DB holds its SHA-256", async () => {
    const f = path.join(dir, "node.cred");
    const r = await cli("issue", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "commission", "--out", f);
    expect(r.code).toBe(0);
    const token = readFileSync(f, "utf8").trim();
    expect(token).toMatch(/^edn_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(r.out).toContain(token.split(".")[0]);
    expect(r.out).not.toContain(token.split(".")[1]);
    const [row] = await sql`SELECT "secretHash" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    expect(row.secretHash).toBe(createHash("sha256").update(token).digest("hex"));
    // an EXISTING --out is refused before anything changes
    writeFileSync(path.join(dir, "exists.cred"), "keep me");
    const again = await cli("rotate", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "rotate", "--out", path.join(dir, "exists.cred"));
    expect(again.code).toBe(1);
    expect(readFileSync(path.join(dir, "exists.cred"), "utf8")).toBe("keep me");
    expect((await sql`SELECT "secretHash" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`)[0].secretHash).toBe(row.secretHash);
  });

  it("★ rotate without --out prints the new secret once; revoke; list shows no hash", async () => {
    const r = await cli("rotate", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "rotation");
    expect(r.code).toBe(0);
    const token = r.out.split("\n")[1];
    expect(token).toMatch(/^edn_[0-9a-f]{12}\./);
    expect((await cli("revoke", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "retire")).code).toBe(0);
    const l = await cli("list", "--node", `N-${DAU}`);
    expect(l.code).toBe(0);
    expect(l.out.split("\n").map((x) => x.split("\t")[2])).toEqual(["revoked", "revoked"]);
    expect(l.out).not.toMatch(/[0-9a-f]{64}/);
    expect((await cli("revoke", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "again")).code).toBe(1);
  });
});
