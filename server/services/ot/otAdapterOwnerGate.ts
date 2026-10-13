/**
 * doc 81 Đợt 10 task D fix review 3 — security scan #73 on otManager.ts ("fail-open-state-drift"), the dispatcher half. Central's
 * OT dispatcher wrote through whatever session otManager held (getActiveDriver); nothing at COMMAND time asked who owns the adapter.
 * Between an ownership change committing (device_adapters."edgeNodeId" set, mig 0374) and central's NOTIFY / reconcile detaching
 * the session — a lost NOTIFY waits for the next reconcile — central kept writing to an EDGE-OWNED adapter. Closed at the write-ahead
 * reservation: in the SAME transaction, the adapter row is read `FOR SHARE` (an owner change — an UPDATE of that row — waits for
 * this transaction; one that committed first is seen here); owned by an edge node ⇒ ADAPTER_OWNED_BY_EDGE, nothing is written.
 *   • L-7: a PINNED stop (stopCls.pinnedStop — the verified stop) is never gated by this: no read, null.
 *   • A DB without 0374 (42703 / 42P01, savepoint-contained) has no edge owners ⇒ null (central unchanged).
 *   • Any other error is THROWN ⇒ the reservation fails ⇒ nothing is sent (fail-closed).
 *   • No adapter row ⇒ null (the dispatcher's own adapter read refuses a missing adapter before this).
 * Capability: a handle without `execute` (none in production) skips the read; the in-memory fakes of the legacy dispatcher suites
 * answer [] (central-owned) — they pass unchanged.
 */
import { sql } from "drizzle-orm";

export const ADAPTER_OWNED_BY_EDGE = "ADAPTER_OWNED_BY_EDGE" as const;
export type AdapterOwnerRefusal = { code: typeof ADAPTER_OWNED_BY_EDGE; detail: string; edgeNodeId: number };

type SqlTx = { execute: (q: unknown) => Promise<unknown>; transaction?: <T>(fn: (sp: SqlTx) => Promise<T>) => Promise<T> };
const firstRows = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? (r as Array<Record<string, unknown>>) : (((r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>);

export async function adapterOwnedByEdgeInTx(tx: unknown, adapterId: number, opts: { pinnedStop?: boolean } = {}): Promise<AdapterOwnerRefusal | null> {
  if (opts.pinnedStop === true) return null; // L-7 — the verified stop is never gated
  const t = tx as SqlTx;
  if (!t || typeof t.execute !== "function") return null;
  const read = async (h: SqlTx) => firstRows(await h.execute(sql`SELECT "edgeNodeId" FROM public.device_adapters WHERE id = ${adapterId} FOR SHARE`));
  let rows: Array<Record<string, unknown>>;
  try {
    // a savepoint keeps a "0374 missing" error from aborting the reservation transaction
    rows = typeof t.transaction === "function" ? await t.transaction((sp) => read(sp)) : await read(t);
  } catch (err) {
    const { isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
    if (isEdgeControlSchemaMissing(err)) return null;
    throw err;
  }
  const owner = rows[0]?.edgeNodeId;
  if (owner === null || owner === undefined) return null;
  const node = Number(owner);
  return { code: ADAPTER_OWNED_BY_EDGE, edgeNodeId: node, detail: `adapter ${adapterId} is owned by edge node ${node} — central does not write to it (the edge node is the only writer)` };
}
