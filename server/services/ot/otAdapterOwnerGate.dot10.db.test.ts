/**
 * doc 81 Đợt 10 task D fix review 3 — scan #73: the reservation-time adapter owner check (otAdapterOwnerGate) on `_test` as avi_app.
 *   • central-owned ⇒ null; edge-owned ⇒ ADAPTER_OWNED_BY_EDGE (rolled back);
 *   • L-7: a PINNED stop is never gated — null, and the DB is not even read;
 *   • the read holds the adapter row FOR SHARE: an ownership change (UPDATE of the row) from another connection WAITS for the
 *     reservation transaction (committed fixture, removed afterwards).
 */
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { getDb } from "../../db/connection";
import { adapterOwnedByEdge, adapterOwnedByEdgeInTx, ADAPTER_OWNED_BY_EDGE } from "./otAdapterOwnerGate";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10G-${Date.now()}`;
class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const one = async (tx: any, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as Array<Record<string, any>>)[0];
const made = { adapters: [] as number[], nodes: [] as number[] };

describe.skipIf(!onTest)("scan #73 — adapter owner check at reservation (_test)", () => {
  afterAll(async () => {
    const raw = postgres(DB_URL, { max: 1 });
    try {
      for (const a of made.adapters) await raw`DELETE FROM device_adapters WHERE id = ${a}`;
      for (const n of made.nodes) await raw`DELETE FROM edge_nodes WHERE id = ${n}`;
    } finally {
      await raw.end();
    }
  });

  it("★ central-owned ⇒ null; edge-owned ⇒ ADAPTER_OWNED_BY_EDGE; edge-owned + PINNED stop ⇒ null without any read (L-7)", async () => {
    await inRolledBackTx(async (tx) => {
      const node = (await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-n`}, 'n', 'offline') RETURNING id`)).id as number;
      const ad = (await one(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${`${TAG}-a`}, 'a', 'stub', 'stub://t') RETURNING id`)).id as number;
      expect(await adapterOwnedByEdgeInTx(tx, ad)).toBeNull();
      await tx.execute(sql`UPDATE device_adapters SET "edgeNodeId" = ${node} WHERE id = ${ad}`);
      expect(await adapterOwnedByEdgeInTx(tx, ad)).toMatchObject({ code: ADAPTER_OWNED_BY_EDGE, edgeNodeId: node });
      expect(await adapterOwnedByEdgeInTx(tx, ad, { pinnedStop: false })).toMatchObject({ code: ADAPTER_OWNED_BY_EDGE });
      let reads = 0;
      const spy = { execute: async (q: unknown) => (reads++, tx.execute(q)), transaction: (fn: any) => (reads++, tx.transaction(fn)) };
      expect(await adapterOwnedByEdgeInTx(spy, ad, { pinnedStop: true })).toBeNull();
      expect(reads).toBe(0);
    });
  });

  it("★ the row is held FOR SHARE: an ownership change from another connection waits for the reservation transaction", async () => {
    const raw = postgres(DB_URL, { max: 1 });
    try {
      const [n] = await raw`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-n2`}, 'n', 'offline') RETURNING id`;
      made.nodes.push(Number(n.id));
      const [a] = await raw`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${`${TAG}-a2`}, 'a', 'stub', 'stub://t') RETURNING id`;
      made.adapters.push(Number(a.id));
      let blockedCode: string | null = null;
      await inRolledBackTx(async (tx) => {
        expect(await adapterOwnedByEdgeInTx(tx, Number(a.id))).toBeNull(); // central-owned, row now share-locked
        try {
          await raw.begin(async (t) => {
            await t`SET LOCAL lock_timeout = '300ms'`;
            await t`UPDATE device_adapters SET "edgeNodeId" = ${n.id} WHERE id = ${a.id}`;
          });
        } catch (e) {
          blockedCode = String((e as { code?: string }).code);
        }
      });
      expect(blockedCode).toBe("55P03"); // lock_not_available: the owner change waited on the reservation
      const [after] = await raw`SELECT "edgeNodeId" FROM device_adapters WHERE id = ${a.id}`;
      expect(after.edgeNodeId).toBeNull();
    } finally {
      await raw.end();
    }
  });

  it("★ R1b-1 T10 — chủ edge trả kèm MÃ edge (edge_nodes.code); bản không giao dịch (adapterOwnedByEdge) đọc cùng kết quả mà KHÔNG khoá hàng", async () => {
    const raw = postgres(DB_URL, { max: 1 });
    try {
      const [n] = await raw`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-n3`}, 'n', 'offline') RETURNING id`;
      made.nodes.push(Number(n.id));
      const [a] = await raw`INSERT INTO device_adapters (code, name, protocol, endpoint, "edgeNodeId") VALUES (${`${TAG}-a3`}, 'a', 'stub', 'stub://t', ${n.id}) RETURNING id`;
      made.adapters.push(Number(a.id));
      const [trong] = await raw`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${`${TAG}-a4`}, 'a', 'stub', 'stub://t') RETURNING id`;
      made.adapters.push(Number(trong.id));
      const d = (await getDb())!;
      expect(await adapterOwnedByEdgeInTx(d, Number(a.id))).toMatchObject({ code: ADAPTER_OWNED_BY_EDGE, edgeNodeId: Number(n.id), edgeCode: `${TAG}-n3` });
      expect(await adapterOwnedByEdge(d, Number(a.id))).toMatchObject({ code: ADAPTER_OWNED_BY_EDGE, edgeNodeId: Number(n.id), edgeCode: `${TAG}-n3` });
      expect(await adapterOwnedByEdge(d, Number(trong.id))).toBeNull();
      expect(await adapterOwnedByEdge(d, 2_000_000_000)).toBeNull(); // không có hàng ⇒ null
      // không khoá: trong một giao dịch đọc xong, giao dịch khác ĐỔI chủ adapter ngay (không chờ)
      await inRolledBackTx(async (tx) => {
        expect(await adapterOwnedByEdge(tx, Number(trong.id))).toBeNull();
        await raw.begin(async (t) => {
          await t`SET LOCAL lock_timeout = '300ms'`;
          await t`UPDATE device_adapters SET "edgeNodeId" = ${n.id} WHERE id = ${trong.id}`;
          await t`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${trong.id}`;
        });
      });
    } finally {
      await raw.end();
    }
  });
});
