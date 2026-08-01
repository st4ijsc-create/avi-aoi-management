/**
 * TEST-ONLY helper (doc 44 W6-5) — a minimal drizzle-shaped fake DB for the
 * enterprise-integration connector tests. NOT imported by any production code.
 *
 * The fake ignores predicates and returns per-table queued select results (FIFO),
 * while recording every insert/update/delete so a test can assert what was written.
 * Used with REAL drizzle-orm operators + REAL schema objects (only ../../db/connection
 * getDb is mocked to return makeFakeDb()), so no schema/operator mocking is needed.
 */

export interface FakeDbState {
  /** Per-table FIFO of select results (keyed by the drizzle table object). */
  selectByTable: Map<unknown, unknown[][]>;
  inserts: Array<{ table: unknown; values: unknown }>;
  updates: Array<{ table: unknown; values: unknown }>;
  deletes: Array<{ table: unknown }>;
  nextId: number;
  /** When set, the NEXT insert throws this (e.g. simulate a unique-violation). */
  nextInsertError: Error | null;
}

export const fakeDbState: FakeDbState = {
  selectByTable: new Map(),
  inserts: [],
  updates: [],
  deletes: [],
  nextId: 1,
  nextInsertError: null,
};

export function resetFakeDb(): void {
  fakeDbState.selectByTable = new Map();
  fakeDbState.inserts = [];
  fakeDbState.updates = [];
  fakeDbState.deletes = [];
  fakeDbState.nextId = 1;
  fakeDbState.nextInsertError = null;
}

/** Queue a select RESULT for the next select on `table` (FIFO). */
export function queueSelect(table: unknown, rows: unknown[]): void {
  const q = fakeDbState.selectByTable.get(table) ?? [];
  q.push(rows);
  fakeDbState.selectByTable.set(table, q);
}

/** Make the next insert throw (simulate a duplicate-key / unique violation). */
export function failNextInsert(message = "duplicate key value violates unique constraint"): void {
  fakeDbState.nextInsertError = new Error(message);
}

function takeSelect(table: unknown): unknown[] {
  const q = fakeDbState.selectByTable.get(table);
  if (q && q.length) return q.shift() as unknown[];
  return [];
}

export function makeFakeDb(): any {
  function chainFor(table: unknown): any {
    const chain: any = {
      from: (t: unknown) => chainFor(t),
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(takeSelect(table)).then(res, rej),
    };
    return chain;
  }

  return {
    select: (_cols?: unknown) => chainFor(undefined),
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        if (fakeDbState.nextInsertError) {
          const err = fakeDbState.nextInsertError;
          fakeDbState.nextInsertError = null;
          throw err;
        }
        fakeDbState.inserts.push({ table, values: vals });
        const arr = Array.isArray(vals) ? vals : [vals];
        const ret = arr.map(() => ({ id: fakeDbState.nextId++ }));
        return {
          returning: async (_cols?: unknown) => ret,
          then: (res: (v: unknown) => unknown) => res(undefined),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: unknown) => ({
        where: async () => {
          fakeDbState.updates.push({ table, values: vals });
          return undefined;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        fakeDbState.deletes.push({ table });
        return undefined;
      },
    }),
  };
}
