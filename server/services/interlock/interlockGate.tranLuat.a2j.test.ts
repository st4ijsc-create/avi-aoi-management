/**
 * SCADA R1b-2b-2a A2(j) — the interlock gate's rule read: narrowed in SQL to the rules aimed at the command, ordered, cap + 1 ⇒ fail-closed.
 *
 * Before A2(j): `SELECT * FROM interlock_rules WHERE enabled LIMIT 1000` (no ORDER BY) counted EVERY enabled rule of the database (unapproved, `alert`,
 * other adapters / machines / factories), then filtered in JS ⇒ past 1000 rows a rule aimed at the command could be left out and the command went
 * through (fail-open).
 *
 * This suite runs the REAL drizzle operators (no drizzle-orm mock) and a fake DB that APPLIES the real WHERE: the condition is rendered by drizzle's own
 * PgDialect and evaluated by a small three-valued-logic interpreter of exactly the SQL subset the gate emits (anything else throws — a new construct can
 * never be silently mis-evaluated). ORDER BY and LIMIT are honoured as given. The DB twin is interlockGate.tranLuat.a2j.db.test.ts.
 *   • J2 — the equivalence grid: for every (rule shape × command), "SQL-filtered then JS-filtered" == "JS-filtered over ALL rules", and the SQL set alone
 *     equals it too (no over-fetch ⇒ the cap counts only rules that can decide the command).
 *   • J1 (unit form) — 1001 enabled, approved, blocking rules aimed elsewhere + ONE violating targeted rule inserted last ⇒ blocked (base: let through).
 *   • J3 — cap reached ⇒ blocked + failClosed + vuotTran, nothing evaluated, the query ordered by id with LIMIT cap + 1, exactly ONE alert per target
 *     (dedup across calls; another target gets its own); cap not reached ⇒ evaluated normally, failClosed === false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { interlockRules, spcRuleViolations, type InterlockRule } from "../../../drizzle/schema";

const H = vi.hoisted(() => ({
  rules: [] as any[],
  spcCount: 0,
  observationReads: 0,
  limits: [] as number[],
  orderBys: [] as string[],
  admins: [101, 102] as number[],
}));

vi.mock("../robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: vi.fn(async () => undefined) }));

const dialect = new PgDialect();

// ── a three-valued-logic interpreter of the gate's SQL subset ───────────────────────────────────────────────────────────────────────────
type V = boolean | null | number | string;
type Tok = { k: "col"; table: string; col: string } | { k: "param"; i: number } | { k: "kw"; v: string } | { k: "p"; v: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === " ") {
      i++;
    } else if (c === "(" || c === ")" || c === "," || c === "=") {
      out.push({ k: "p", v: c });
      i++;
    } else if (c === "$") {
      const m = /^\$(\d+)/.exec(text.slice(i))!;
      out.push({ k: "param", i: Number(m[1]) - 1 });
      i += m[0].length;
    } else if (c === '"') {
      const m = /^"([^"]+)"\."([^"]+)"/.exec(text.slice(i));
      if (!m) throw new Error(`mini-SQL: unqualified identifier at ${i}: ${text.slice(i, i + 30)}`);
      out.push({ k: "col", table: m[1]!, col: m[2]! });
      i += m[0].length;
    } else {
      const m = /^[a-z]+/.exec(text.slice(i));
      if (!m || !["and", "or", "in", "is", "not", "null", "true", "false"].includes(m[0])) throw new Error(`mini-SQL: unknown token at ${i}: ${text.slice(i, i + 30)}`);
      out.push({ k: "kw", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

/** compile once (render + tokenize), evaluate per row */
function compileWhere(cond: SQL, table = "interlock_rules"): (row: Record<string, unknown>) => V {
  const q = dialect.sqlToQuery(cond);
  const toks = tokenize(q.sql);
  return (row) => evalToks(toks, q.params, row, table);
}
function evalWhere(cond: SQL, row: Record<string, unknown>, table = "interlock_rules"): V {
  return compileWhere(cond, table)(row);
}
function evalToks(toks: Tok[], params: unknown[], row: Record<string, unknown>, table: string): V {
  const q = { params };
  let pos = 0;
  const peek = () => toks[pos];
  const isKw = (v: string) => peek()?.k === "kw" && (peek() as { v: string }).v === v;
  const isP = (v: string) => peek()?.k === "p" && (peek() as { v: string }).v === v;
  const expectP = (v: string) => {
    if (!isP(v)) throw new Error(`mini-SQL: expected '${v}' at token ${pos}`);
    pos++;
  };
  const operand = (): V => {
    const t = toks[pos++];
    if (t?.k === "col") {
      if (t.table !== table) throw new Error(`mini-SQL: column of another table ${t.table}`);
      if (!(t.col in row)) throw new Error(`mini-SQL: unknown column ${t.col}`);
      return (row[t.col] ?? null) as V;
    }
    if (t?.k === "param") return q.params[t.i] as V;
    throw new Error(`mini-SQL: expected an operand at token ${pos - 1}`);
  };
  const and3 = (a: V, b: V): V => (a === false || b === false ? false : a === null || b === null ? null : true);
  const or3 = (a: V, b: V): V => (a === true || b === true ? true : a === null || b === null ? null : false);
  const eq3 = (a: V, b: V): V => (a === null || b === null ? null : a === b);
  const atom = (): V => {
    if (isP("(")) {
      pos++;
      const v = expr();
      expectP(")");
      return v;
    }
    if (isKw("true")) return pos++, true;
    if (isKw("false")) return pos++, false;
    if (isKw("not")) {
      pos++;
      const v = atom();
      return v === null ? null : !v;
    }
    const left = operand();
    if (isP("=")) {
      pos++;
      return eq3(left, operand());
    }
    if (isKw("in")) {
      pos++;
      expectP("(");
      let acc: V = false;
      for (;;) {
        acc = or3(acc, eq3(left, operand()));
        if (isP(",")) {
          pos++;
          continue;
        }
        break;
      }
      expectP(")");
      return acc;
    }
    if (isKw("is")) {
      pos++;
      const neg = isKw("not") ? (pos++, true) : false;
      if (!isKw("null")) throw new Error("mini-SQL: expected null");
      pos++;
      return neg ? left !== null : left === null;
    }
    throw new Error(`mini-SQL: unsupported predicate at token ${pos}`);
  };
  const andExpr = (): V => {
    let v = atom();
    while (isKw("and")) {
      pos++;
      v = and3(v, atom());
    }
    return v;
  };
  const expr = (): V => {
    let v = andExpr();
    while (isKw("or")) {
      pos++;
      v = or3(v, andExpr());
    }
    return v;
  };
  const v = expr();
  if (pos !== toks.length) throw new Error(`mini-SQL: trailing tokens from ${pos}`);
  return v;
}

// ── fake DB: applies the real WHERE / ORDER BY / LIMIT to H.rules ────────────────────────────────────────────────────────────────────────
function builderFor(table: unknown): any {
  let where: SQL | undefined;
  let ordered = false;
  let limit: number | undefined;
  const rows = () => {
    if (table === interlockRules) {
      const w = where ? compileWhere(where) : null;
      let r = H.rules.filter((x) => (w ? w(x) === true : true));
      if (ordered) r = [...r].sort((a, b) => a.id - b.id);
      return limit === undefined ? r : r.slice(0, limit);
    }
    if (table === spcRuleViolations) {
      H.observationReads++;
      return [{ c: H.spcCount }];
    }
    throw new Error("fake DB: unexpected table");
  };
  const b: any = {
    where: (w: SQL) => ((where = w), b),
    orderBy: (...o: SQL[]) => {
      H.orderBys.push(o.map((x) => dialect.sqlToQuery(x as SQL).sql).join(", "));
      ordered = true;
      return b;
    },
    limit: (n: number) => {
      H.limits.push(n);
      limit = n;
      return b;
    },
    then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve().then(rows).then(res, rej),
  };
  return b;
}
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: (t: unknown) => builderFor(t) }),
    execute: async () => H.admins.map((id) => ({ id })),
  })),
}));

import {
  dieuKienLuatUngVien,
  evaluateInterlockGate,
  laLuatChanNhamDung,
  khoaCanhBaoTranLuat,
  TRAN_LUAT_INTERLOCK,
  _datTranLuatInterlockChoTest,
  _quenCanhBaoTranLuatChoTest,
  type InterlockGateTarget,
} from "./interlockGate";
import { tapMayChoInterlock } from "./tapMayChoInterlock";
import { raiseCriticalStopAlert } from "../robot/criticalStopAlert";

const alertMock = raiseCriticalStopAlert as unknown as ReturnType<typeof vi.fn>;

/** a full interlock_rules row (every column the SQL may name), violating spc_violation rule by default (count >= 0 always met) */
function luat(id: number, over: Partial<InterlockRule> = {}): InterlockRule {
  return {
    id,
    name: `R${id}`,
    description: null,
    scope: "machine",
    lineId: null,
    stationId: null,
    machineId: 5,
    sourceType: "spc_violation",
    sourceKey: null,
    comparisonOperator: "gte",
    threshold: "0",
    windowSize: null,
    consecutiveCount: null,
    windowSeconds: 300,
    action: "stop_line",
    targetMachineId: null,
    targetAdapterId: null,
    commandTag: null,
    commandValue: null,
    requiresHumanConfirm: true,
    enabled: true,
    approvedBy: 42,
    approvedAt: new Date(),
    approvedDefHash: null,
    cooldownSeconds: 300,
    khiThieuDuLieu: "chan",
    lastFiredAt: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    ...over,
  } as InterlockRule;
}

beforeEach(() => {
  H.rules = [];
  H.spcCount = 0;
  H.observationReads = 0;
  H.limits = [];
  H.orderBys = [];
  alertMock.mockClear();
  _datTranLuatInterlockChoTest(null);
  _quenCanhBaoTranLuatChoTest();
});
afterEach(() => {
  _datTranLuatInterlockChoTest(null);
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("A2(j) J2 — SQL narrowing ≡ the gate's JS filter (equivalence grid)", () => {
  // rule shapes: every combination of the columns the filter reads
  const SHAPES: InterlockRule[] = [];
  let id = 1;
  for (const targetAdapterId of [null, 10, 11, -1])
    for (const targetMachineId of [null, 5, 7, 9])
      for (const commandTag of [null, "a", "b", "z", ""])
        for (const approvedBy of [null, 1])
          for (const action of ["alert", "stop_line", "block_downstream", "reduce_speed"] as const)
            for (const enabled of [true, false]) SHAPES.push(luat(id++, { targetAdapterId, targetMachineId, commandTag, approvedBy, action, enabled }));

  const MACHINES: Array<Pick<InterlockGateTarget, "machineId" | "machineIds">> = [
    {},
    { machineId: 5 },
    { machineIds: [5, 7] },
    { machineId: 9, machineIds: [7] },
    { machineId: null, machineIds: [] },
    { machineIds: tapMayChoInterlock(7, 5) },
    { machineIds: tapMayChoInterlock(null, 9) },
  ];
  const TAGS: string[][] = [[], ["a"], ["a", "b"], [""], ["z", "a"], ["q"]];
  const COMMANDS: InterlockGateTarget[] = [];
  for (const adapterId of [10, 11, -1, 12]) for (const m of MACHINES) for (const tagKeys of TAGS) COMMANDS.push({ adapterId, ...m, tagKeys });

  const ids = (rs: InterlockRule[]) => rs.map((r) => r.id).sort((a, b) => a - b);

  it("every (rule shape × command): SQL-then-JS == JS over ALL rules, and the SQL set alone == it (exact narrowing)", () => {
    expect(SHAPES.length).toBe(1280);
    expect(COMMANDS.length).toBe(168);
    const branchHits = { onlyAdapter: 0, onlyMachine: 0, onlyGlobalTag: 0 };
    for (const cmd of COMMANDS) {
      const where = compileWhere(dieuKienLuatUngVien(cmd));
      const sqlSet = SHAPES.filter((r) => where(r as unknown as Record<string, unknown>) === true);
      const jsAll = SHAPES.filter((r) => r.enabled && laLuatChanNhamDung(r, cmd));
      const label = JSON.stringify(cmd);
      expect(ids(sqlSet.filter((r) => laLuatChanNhamDung(r, cmd))), label).toEqual(ids(jsAll));
      expect(ids(sqlSet), `${label} (SQL alone)`).toEqual(ids(jsAll));
      for (const r of jsAll) {
        const tapMay = [cmd.machineId, ...(cmd.machineIds ?? [])];
        const a = r.targetAdapterId === cmd.adapterId;
        const m = r.targetMachineId != null && tapMay.includes(r.targetMachineId);
        const t = r.commandTag != null && cmd.tagKeys.includes(r.commandTag) && r.targetAdapterId == null;
        if (a && !m && !t) branchHits.onlyAdapter++;
        if (m && !a && !t) branchHits.onlyMachine++;
        if (t && !a && !m) branchHits.onlyGlobalTag++;
      }
    }
    // fuse: the grid really exercises every branch on its own (a branch dropped from the SQL would make one of these rules disappear)
    expect(branchHits.onlyAdapter).toBeGreaterThan(0);
    expect(branchHits.onlyMachine).toBeGreaterThan(0);
    expect(branchHits.onlyGlobalTag).toBeGreaterThan(0);
  });

  it("a rule with no target at all (no adapter, no machine, no tag) is decided by NO command — neither in SQL nor in JS", () => {
    const untargeted = SHAPES.filter((r) => r.targetAdapterId == null && r.targetMachineId == null && r.commandTag == null && r.enabled && r.approvedBy != null && r.action !== "alert");
    expect(untargeted.length).toBeGreaterThan(0);
    for (const cmd of COMMANDS) {
      const where = compileWhere(dieuKienLuatUngVien(cmd));
      for (const r of untargeted) {
        expect(laLuatChanNhamDung(r, cmd)).toBe(false);
        expect(where(r as unknown as Record<string, unknown>)).not.toBe(true);
      }
    }
  });

  it("the interpreter is not vacuous: it refuses SQL outside the gate's subset", () => {
    expect(() => tokenize('"interlock_rules"."id" > $1')).toThrow(/unknown token|expected/);
  });
});

describe("A2(j) J1 (unit form) — 1001 rules aimed elsewhere cannot hide a violating targeted rule", () => {
  it("1001 enabled + approved + stop_line rules on other machines, then ONE violating rule on the command's adapter inserted LAST ⇒ blocked (rule-caused, failClosed false)", async () => {
    for (let i = 1; i <= 1001; i++) H.rules.push(luat(i, { targetMachineId: 900_000 + i }));
    H.rules.push(luat(5000, { targetAdapterId: 10 }));
    const r = await evaluateInterlockGate({ adapterId: 10, machineIds: [5], tagKeys: ["cmd_start"] });
    expect(r).toEqual({ blocked: true, failClosed: false, violations: [{ ruleId: 5000, ruleName: "R5000", action: "stop_line" }] });
    expect(H.observationReads).toBe(1); // only the targeted rule was evaluated
  });

  it("the same through the machine set (rule only on the adapter's machine) and through a global tag key", async () => {
    for (let i = 1; i <= 1001; i++) H.rules.push(luat(i, { targetMachineId: 900_000 + i }));
    H.rules.push(luat(5001, { targetMachineId: 77 }));
    H.rules.push(luat(5002, { commandTag: "cmd_go" }));
    expect(await evaluateInterlockGate({ adapterId: 10, machineIds: tapMayChoInterlock(77, 5), tagKeys: ["x"] })).toMatchObject({ blocked: true, failClosed: false, violations: [{ ruleId: 5001 }] });
    expect(await evaluateInterlockGate({ adapterId: 10, machineIds: [5], tagKeys: ["cmd_go"] })).toMatchObject({ blocked: true, failClosed: false, violations: [{ ruleId: 5002 }] });
    expect(await evaluateInterlockGate({ adapterId: -1, machineId: 77, tagKeys: [] })).toMatchObject({ blocked: true, failClosed: false, violations: [{ ruleId: 5001 }] });
  });
});

describe("A2(j) J3 — cap + 1 ⇒ fail-closed + ONE deduped alert; never a partial set", () => {
  it("the cap is exported and is 1000", () => {
    expect(TRAN_LUAT_INTERLOCK).toBe(1000);
  });

  it("cap 3, 4 targeted (non-violating) rules ⇒ blocked + failClosed + vuotTran, NOTHING evaluated, query ORDER BY id LIMIT 4; one alert, dedupKey names the adapter", async () => {
    _datTranLuatInterlockChoTest(3);
    H.spcCount = 0;
    for (let i = 1; i <= 4; i++) H.rules.push(luat(i, { targetAdapterId: 10, threshold: "99" }));
    const r = await evaluateInterlockGate({ adapterId: 10, machineIds: [5], tagKeys: [] });
    expect(r).toEqual({ blocked: true, failClosed: true, violations: [], vuotTran: { tran: 3 } });
    expect(H.observationReads).toBe(0);
    expect(H.limits).toEqual([4]);
    expect(H.orderBys).toEqual(['"interlock_rules"."id" asc']);
    await flush();
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    const a = alertMock.mock.calls[0]![0] as { kind: string; dedupKey: string; recipients: number[]; khuTrungBenVung?: unknown; message: string };
    expect(a.kind).toBe("interlock_tran_luat");
    expect(a.dedupKey).toBe(khoaCanhBaoTranLuat({ adapterId: 10, machineIds: [5], tagKeys: [] }));
    expect(a.dedupKey).toContain("adapter:10");
    expect(a.recipients).toEqual([101, 102]);
    expect(a.khuTrungBenVung).toEqual({});
    expect(a.message).toContain("exceed 3");
  });

  it("dedup: the same target twice ⇒ still ONE alert; another adapter ⇒ its own; after a restart (in-process memory forgotten) ⇒ raised again with the durable 24 h dedup flag", async () => {
    _datTranLuatInterlockChoTest(3);
    for (let i = 1; i <= 4; i++) H.rules.push(luat(i, { targetAdapterId: 10 }));
    for (let i = 5; i <= 8; i++) H.rules.push(luat(i, { targetAdapterId: 11 }));
    const t10 = { adapterId: 10, machineIds: [5], tagKeys: [] };
    expect((await evaluateInterlockGate(t10)).vuotTran).toEqual({ tran: 3 });
    expect((await evaluateInterlockGate(t10)).vuotTran).toEqual({ tran: 3 });
    await flush();
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    expect((await evaluateInterlockGate({ adapterId: 11, machineIds: [5], tagKeys: [] })).vuotTran).toEqual({ tran: 3 });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(2));
    expect((alertMock.mock.calls[1]![0] as { dedupKey: string }).dedupKey).toContain("adapter:11");
    _quenCanhBaoTranLuatChoTest();
    await evaluateInterlockGate(t10);
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(3));
    expect((alertMock.mock.calls[2]![0] as { khuTrungBenVung?: unknown }).khuTrungBenVung).toEqual({});
  });

  it("exactly the cap (3 targeted rules, one violating) ⇒ evaluated normally: blocked by the rule, failClosed false, no vuotTran, no alert", async () => {
    _datTranLuatInterlockChoTest(3);
    H.rules.push(luat(1, { targetAdapterId: 10, threshold: "99" }));
    H.rules.push(luat(2, { targetAdapterId: 10, threshold: "99" }));
    H.rules.push(luat(3, { targetAdapterId: 10 }));
    // 50 rules aimed elsewhere do not count toward the cap
    for (let i = 10; i < 60; i++) H.rules.push(luat(i, { targetAdapterId: 99 }));
    const r = await evaluateInterlockGate({ adapterId: 10, machineIds: [5], tagKeys: [] });
    expect(r).toEqual({ blocked: true, failClosed: false, violations: [{ ruleId: 3, ruleName: "R3", action: "stop_line" }] });
    expect(H.observationReads).toBe(3);
    await flush();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("A2(l) robot target (adapterId -1, machines of the robot's place, robotId separately): the alert names the ROBOT id, never one of its machines", async () => {
    _datTranLuatInterlockChoTest(1);
    H.rules.push(luat(1, { targetMachineId: 4242 }), luat(2, { targetMachineId: 4243 }));
    expect((await evaluateInterlockGate({ adapterId: -1, machineIds: [4242, 4243], tagKeys: [], robotId: 7 })).vuotTran).toEqual({ tran: 1 });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    const a = alertMock.mock.calls[0]![0] as { dedupKey: string; source: string; entityType: string; entityId: unknown; title: string; message: string };
    expect(a.dedupKey).toBe("interlock_tran_luat:adapter:-1:may:4242,4243:robot:7");
    expect(a).toMatchObject({ source: "robot", entityType: "robot", entityId: 7 });
    expect(a.title).toContain("robot 7");
    expect(a.title).not.toContain("4242");
    expect(a.message).toContain("(machines 4242, 4243)");
    // two robots on the same line share the machine set — each gets its own alert
    expect((await evaluateInterlockGate({ adapterId: -1, machineIds: [4242, 4243], tagKeys: [], robotId: 8 })).vuotTran).toEqual({ tran: 1 });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(2));
    expect((alertMock.mock.calls[1]![0] as { entityId: unknown }).entityId).toBe(8);
  });
});
