/**
 * A2 test fix (R1) — the seq_conflict audit count of a node is EXACT (entityType/entityId), not a substring of the details text.
 * Real `_test` DB, one transaction that is always ROLLED BACK (no explicit ids; no DELETE/TRUNCATE).
 *   • "before" control: the OLD substring query counts 2 for node X (Y's row holds X's digits inside its hashes / stream);
 *   • the helper counts exactly 1 for X, 1 for Y, 0 for an unrelated node.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { countSeqConflictsOfNode } from "./__edgeAuditDem.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const ROLLBACK = Symbol("rollback");
let pg: ReturnType<typeof postgres>;

beforeAll(() => {
  expect(new URL(DB_URL).pathname).toBe("/aoi_management_test");
  pg = postgres(DB_URL, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await pg.end();
});

type Tx = postgres.TransactionSql;
async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await pg
    .begin(async (tx) => {
      out = await fn(tx);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}

describe("count of seq_conflict audit rows of one node", () => {
  it("exact by node: the substring query counts the OTHER node's row too, the helper does not", async () => {
    // ids from a non-small space (no Date.now() % N, no random + small base)
    const x = 880_000_000 + (Date.now() % 1_000_000_007);
    const y = x + 1;
    const unrelated = x + 2;
    const row = (node: number, details: Record<string, unknown>) =>
      JSON.stringify({ nodeId: node, credentialId: 1, anomaly: "seq_conflict", epoch: "ab", seq: 1, ...details });
    const r = await inRolledBackTx(async (tx) => {
      await tx`INSERT INTO audit_logs (action, "entityType", "entityId", "userName", details, status) VALUES ('EDGE_ANOMALY', 'edge_node', ${x}, 'edge:ZS-X', ${row(x, {})}, 'failure')`;
      // Y: a DIFFERENT node whose stream and hashes contain X's digits
      await tx`INSERT INTO audit_logs (action, "entityType", "entityId", "userName", details, status) VALUES ('EDGE_ANOMALY', 'edge_node', ${y}, 'edge:ZS-Y', ${row(y, { stream: `run:${x}:1`, storedHash: `${x}aa`, receivedHash: `bb${x}` })}, 'failure')`;
      const old = async (n: number) => Number((await tx`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE '%EDGE_ANOMALY%' AND details::text LIKE '%seq_conflict%' AND "createdAt" > now() - interval '30 minutes' AND details::text LIKE ${`%${n}%`}`)[0].n);
      return {
        oldX: await old(x),
        newX: await countSeqConflictsOfNode(tx, x),
        newXWindow: await countSeqConflictsOfNode(tx, x, 30),
        newY: await countSeqConflictsOfNode(tx, y),
        newU: await countSeqConflictsOfNode(tx, unrelated),
      };
    });
    expect(r.oldX).toBe(2); // the "before" control: the false red
    expect(r.newX).toBe(1);
    expect(r.newXWindow).toBe(1);
    expect(r.newY).toBe(1);
    expect(r.newU).toBe(0);
  });
});
