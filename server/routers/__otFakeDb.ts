/**
 * Sprint G2.2a — minimal in-memory fake of the drizzle query builder, just enough
 * for the deviceAdapter / machineRecipe / commandLog router tests. NOT a general
 * drizzle emulator: it supports the exact chains those routers use
 * (select/from/where/orderBy/limit/groupBy/leftJoin, insert/values/returning,
 * update/set/where/returning, delete/where/returning, transaction).
 *
 * It operates on the REAL drizzle table objects (keyed by getTableName) and the
 * REAL column objects (read via .name). Tests mock drizzle's eq/and/gte/desc to the
 * predicate builders below so WHERE/ORDER are evaluated as JS over stored rows.
 */
export type Row = Record<string, any>;
type Cond = (row: Row) => boolean;
type Col = { name: string };
type OrderRef = { name: string; dir: "asc" | "desc" };

export function makeEq(col: Col, value: unknown): Cond {
  return (row: Row) => row[col.name] === value;
}
export function makeGte(col: Col, value: any): Cond {
  return (row: Row) => row[col.name] >= value;
}
export function makeAnd(...conds: (Cond | undefined)[]): Cond {
  const list = conds.filter(Boolean) as Cond[];
  return (row: Row) => list.every((c) => c(row));
}
export function makeDesc(col: Col): OrderRef {
  return { name: col.name, dir: "desc" };
}

let seq = 1;
export function resetSeq() { seq = 1; }

const NAME_SYM = Symbol.for("drizzle:Name");
function keyOf(t: any): string {
  return t[NAME_SYM];
}

/**
 * One unique keyset. `where`, when present, models a PARTIAL unique index
 * (e.g. Postgres `WHERE "productModelId" IS NULL`) — a conflict on this keyset
 * only applies to rows for which `where(row)` is true (checked on BOTH the
 * candidate row and the existing row, matching Postgres's own semantics: the
 * index simply does not contain rows outside its predicate). Plain `string[]`
 * entries (legacy shape, still accepted by setUnique) mean "always applies".
 */
type UniqueKeyset = { keys: string[]; where?: (row: Row) => boolean };

export class FakeDb {
  store = new Map<string, Row[]>();
  private uniqueKeys = new Map<string, UniqueKeyset[]>();

  private rows(t: any): Row[] {
    const k = keyOf(t);
    let arr = this.store.get(k);
    if (!arr) { arr = []; this.store.set(k, arr); }
    return arr;
  }

  seed(t: any, rows: Row[]) {
    this.store.set(keyOf(t), rows.map((r) => ({ ...r })));
  }
  /**
   * Register unique keysets for `t`. Accepts the legacy `string[][]` shape
   * (each entry an unconditioned composite key) AND/OR `{keys, where}` entries
   * for a PARTIAL unique index — pass either shape per-entry, mixed freely.
   */
  setUnique(t: any, keys: (string[] | UniqueKeyset)[]) {
    const normalized = keys.map((k) => (Array.isArray(k) ? { keys: k } : k));
    this.uniqueKeys.set(keyOf(t), normalized);
  }

  select(_projection?: Record<string, any>) {
    const self = this;
    let table: any;
    let cond: Cond | undefined;
    let order: OrderRef | undefined;
    let lim: number | undefined;
    const builder: any = {
      from(t: any) { table = t; return builder; },
      leftJoin(_t: any, _on: any) { return builder; },
      where(c?: Cond) { cond = c; return builder; },
      groupBy(..._cols: any[]) { return builder; },
      orderBy(...o: any[]) { if (o[0] && typeof o[0] === "object" && "dir" in o[0]) order = o[0]; return builder; },
      limit(n: number) { lim = n; return builder; },
      then(resolve: (v: Row[]) => any, reject?: (e: any) => any) {
        return Promise.resolve(self.run(table, cond, order, lim)).then(resolve, reject);
      },
    };
    return builder;
  }

  private run(table: any, cond: Cond | undefined, order: OrderRef | undefined, lim: number | undefined): Row[] {
    let rows = this.rows(table).filter((r) => (cond ? cond(r) : true)).map((r) => ({ ...r }));
    if (order) {
      rows.sort((a, b) => {
        const av = a[order.name]; const bv = b[order.name];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.dir === "desc" ? -cmp : cmp;
      });
    }
    if (lim != null) rows = rows.slice(0, lim);
    return rows;
  }

  insert(table: any) {
    const self = this;
    return {
      values(vals: Row | Row[]) {
        const arr = Array.isArray(vals) ? vals : [vals];
        // Insertion is DEFERRED to returning()/then() so an optional onConflictDoUpdate()
        // can change the semantics from "throw on conflict" to "update the existing row".
        let conflictSet: Row | null = null;
        let done: Row[] | null = null;
        const finalize = () => {
          if (done) return done;
          done = arr.map((v) => {
            const base: Row = { createdAt: new Date(), updatedAt: new Date(), ...v };
            const existing = self.findConflict(table, base);
            if (existing) {
              if (conflictSet) {
                // onConflictDoUpdate → patch the existing row, do NOT insert a new one.
                Object.assign(existing, conflictSet, { updatedAt: new Date() });
                return { ...existing };
              }
              self.checkUnique(table, base); // no handler → throw 23505 as before
            }
            const row: Row = { id: seq++, ...base };
            self.rows(table).push(row);
            return { ...row };
          });
          return done;
        };
        const builder: any = {
          onConflictDoUpdate(cfg: { target?: any; set?: Row }) {
            conflictSet = cfg?.set ?? {};
            return builder;
          },
          returning() { return Promise.resolve(finalize()); },
          then(resolve: any, reject: any) { return Promise.resolve(finalize()).then(resolve, reject); },
        };
        return builder;
      },
    };
  }

  /** First existing row that collides with `row` on any registered unique keyset, or null. */
  private findConflict(table: any, row: Row): Row | null {
    const keysets = this.uniqueKeys.get(keyOf(table));
    if (!keysets) return null;
    for (const { keys, where } of keysets) {
      if (where && !where(row)) continue; // candidate row falls outside this partial index
      const hit = this.rows(table).find((r) => (!where || where(r)) && keys.every((k) => r[k] === row[k]));
      if (hit) return hit;
    }
    return null;
  }

  private checkUnique(table: any, row: Row) {
    const keysets = this.uniqueKeys.get(keyOf(table));
    if (!keysets) return;
    for (const { keys, where } of keysets) {
      if (where && !where(row)) continue;
      const dup = this.rows(table).some((r) => (!where || where(r)) && keys.every((k) => r[k] === row[k]));
      if (dup) {
        const err: any = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
    }
  }

  update(table: any) {
    const self = this;
    let patch: Row = {};
    const b: any = {
      set(p: Row) { patch = p; return b; },
      where(cond?: Cond) {
        const matched = self.rows(table).filter((r) => (cond ? cond(r) : true));
        for (const r of matched) Object.assign(r, patch);
        const result = matched.map((r) => ({ ...r }));
        return {
          returning() { return Promise.resolve(result); },
          then(resolve: any, reject: any) { return Promise.resolve(result).then(resolve, reject); },
        };
      },
    };
    return b;
  }

  delete(table: any) {
    const self = this;
    return {
      where(cond?: Cond) {
        const arr = self.rows(table);
        const removed: Row[] = [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (!cond || cond(arr[i])) { removed.push({ ...arr[i] }); arr.splice(i, 1); }
        }
        removed.reverse();
        return {
          returning() { return Promise.resolve(removed); },
          then(resolve: any, reject: any) { return Promise.resolve(removed).then(resolve, reject); },
        };
      },
    };
  }

  async transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
