/**
 * SCADA R1b-2b-2a A2(j) J1 — 1001 enabled rules aimed elsewhere cannot hide a violating rule aimed at the command (real `_test` DB, ROLLBACK).
 *
 * Base (before A2(j)): `SELECT * FROM interlock_rules WHERE enabled LIMIT 1000`, no ORDER BY, targeting in JS ⇒ with more than 1000 enabled rules in the
 * database the rule inserted LAST (physically after the others) is outside the 1000 returned ⇒ the command is let through. This file uses ONLY
 * `evaluateInterlockGate` (present on the base) so it can be run against the base gate to record RED.
 *
 * Every write is inside a transaction that is rolled back; no explicit ids; machine / adapter ids are fake (no FK on the interlock_rules target columns),
 * out of every seeded range; tag keys are unique to this file. Condition always met: spc_violation count on a fake machine >= 0.
 */
import { describe, it, expect, vi } from "vitest";

const H = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return { ...real, getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb, __realGetDb: real.getDb };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { interlockRules } from "../../../drizzle/schema";
import { evaluateInterlockGate } from "./interlockGate";

const DB_URL = process.env.DATABASE_URL ?? "";
const DAU = `A2J1-${Date.now()}`;
const OWNER = 990_913_301;
const ADAPTER = 2_000_913_001;
const MAY_ADAPTER = 990_913_311;
const MAY_GOI = 990_913_312;
const MAY_KHAC_GOC = 990_920_000;
const TAG = `a2j1_go_${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const base = (name: string, may: number) => ({
  name: `${DAU} ${name}`,
  scope: "machine" as const,
  machineId: may,
  sourceType: "spc_violation" as const,
  comparisonOperator: "gte" as const,
  threshold: "0",
  action: "stop_line" as const,
  requiresHumanConfirm: true,
  enabled: true,
  approvedBy: OWNER,
  approvedAt: new Date(),
});

/** 1001 enabled + approved + stop_line rules, each aimed at its own fake machine (never the command's) — inserted FIRST */
async function luatNhamCho(tx: Tx): Promise<void> {
  await tx.insert(interlockRules).values(Array.from({ length: 1001 }, (_, i) => ({ ...base(`elsewhere ${i}`, MAY_KHAC_GOC + i), targetMachineId: MAY_KHAC_GOC + i, targetAdapterId: null, commandTag: null })));
}

describe.skipIf(!/_test\b/.test(DB_URL))("A2(j) J1 — a targeted rule inserted after 1001 others still blocks (DB thật, ROLLBACK)", () => {
  const cases: Array<[string, { targetAdapterId: number | null; targetMachineId: number | null; commandTag: string | null }]> = [
    ["targetAdapterId", { targetAdapterId: ADAPTER, targetMachineId: null, commandTag: null }],
    ["targetMachineId = the adapter's machine (A2(i)(1) set)", { targetAdapterId: null, targetMachineId: MAY_ADAPTER, commandTag: null }],
    ["global commandTag", { targetAdapterId: null, targetMachineId: null, commandTag: TAG }],
  ];
  for (const [label, target] of cases) {
    it(`★ ${label}: 1001 rules aimed elsewhere, then ONE violating targeted rule (last) ⇒ blocked by THAT rule, failClosed false`, async () => {
      await trongGiaoDich(async (tx) => {
        await luatNhamCho(tx);
        const [r] = await tx.insert(interlockRules).values({ ...base(`target ${label}`, MAY_ADAPTER), ...target }).returning({ id: interlockRules.id });
        const g = await evaluateInterlockGate({ adapterId: ADAPTER, machineIds: [MAY_ADAPTER, MAY_GOI], tagKeys: [TAG] });
        expect(g.failClosed).toBe(false);
        expect(g.blocked).toBe(true);
        expect(g.violations.map((v) => v.ruleId)).toEqual([r!.id]);
      });
    }, 120_000);
  }
});
