/**
 * doc 81 Đợt 1B Task 6 — shared helpers for the in-memory (mock-DB) commandDispatcher suites.
 *
 * The real-write path now runs a write-ahead reservation in a transaction (advisory lock →
 * re-probe → SELECT … FOR UPDATE + CAS on ai_pending_actions → INSERT intent rows). The legacy
 * suites' fake DB only knew select/limit + insert/returning; these helpers add exactly what the
 * reservation uses — `transaction`, `execute`, `update…set…where…returning`, an awaitable
 * `where()` with `.for()`, and `inArray`/`sql` in the drizzle-orm mock — with NO rollback or lock
 * semantics (those are proven on real Postgres in commandDispatcher.dot1b.db.test.ts).
 *
 * `boundPending()` builds a pending action the way the product creators do (same
 * otActionBinding helper), so a legacy test that expects a REAL write presents a bound,
 * confirmed action — the new contract — instead of the old unbound `{status, userId}` row.
 *
 * Not a test file (no `.test.ts` suffix ⇒ never collected by vitest).
 */
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";

export type Row = Record<string, any>;

/** drizzle-orm predicate builders understood by `matchesPred`. */
export const fakeOrm = {
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
  inArray: (col: any, vals: any[]) => ({ __k: col.__name, __v: vals, __op: "in" }),
  sql: (..._a: any[]) => ({ __sql: true }),
};

export function matchesPred(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matchesPred(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "in") return Array.isArray(pred.__v) && pred.__v.includes(row[pred.__k]);
  return true;
}

/**
 * The fake DB used by the legacy suites, now transaction-capable. `onInsert` keeps each
 * suite's own insert bookkeeping (command_log rows + id sequence).
 */
export function makeLedgerFakeDb(opts: {
  tableFor: (table: any) => Row[];
  onInsert: (table: any, vals: Row) => { id: number };
  matches?: (row: Row, pred: any) => boolean;
}) {
  const match = opts.matches ?? matchesPred;
  const db: any = {
    select: () => ({
      from: (table: any) => ({
        where: (pred: any) => {
          const rows = () => opts.tableFor(table).filter((r) => match(r, pred));
          return {
            limit: async (n = 1) => rows().slice(0, n),
            for: async (_mode: string) => rows(),
            then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: (table: any) => ({
      values: (vals: Row) => ({
        returning: async (_sel?: any) => [opts.onInsert(table, vals)],
      }),
    }),
    update: (table: any) => ({
      set: (vals: Row) => ({
        where: (pred: any) => ({
          returning: async (_sel?: any) => {
            const hit = opts.tableFor(table).filter((r) => match(r, pred));
            for (const r of hit) Object.assign(r, vals);
            return hit.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
    execute: async (_q: unknown) => [],
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  };
  return db;
}

/** A confirmed pending action BOUND to exactly `input`'s command (new contract). */
export function boundPending(
  id: string,
  input: {
    adapterId: number;
    machineId?: number | null;
    commandType: string;
    writes: ReadonlyArray<{ tagKey: string; value: unknown }>;
  },
  over: Partial<{ status: string; userId: number; tool: string; expiresAt: Date }> = {},
): Row {
  const tool = over.tool ?? TESTKIT_TOOL;
  return {
    id,
    tool,
    status: over.status ?? "confirmed",
    userId: over.userId ?? 1,
    expiresAt: over.expiresAt ?? new Date(Date.now() + 600_000),
    previewJson: withOtPayloadHash(
      null,
      otPayloadHash({
        tool,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        commandType: input.commandType,
        writes: input.writes,
      }),
    ),
  };
}

/** Tool name the legacy suites' HITL triggers claim (must match boundPending's default). */
export const TESTKIT_TOOL = "legacy_suite_tool";

/** command_log rows that are write-ahead INTENTS. */
export const isIntentRow = (r: Row): boolean => (r.ackValue as { ledger?: string } | undefined)?.ledger === "intent";
/** command_log rows that are NOT intents (results / rejections / simulated). */
export const resultRows = (rows: Row[]): Row[] => rows.filter((r) => !isIntentRow(r));
