/**
 * SCADA R1b-2b-2a A2(j) — the interlock gate's narrowed, capped rule read on the REAL `_test` DB (ROLLBACK; harness of interlockMayAdapter.a2i1).
 *   • J2 (DB twin of the unit grid): rule shapes inserted in the transaction × commands — the REAL Postgres result of `dieuKienLuatUngVien` (enum cast,
 *     varchar IN, NULL semantics) restricted to this file's rows == the gate's JS filter over the same rows.
 *   • J3 (callers): the cap reached (seam lowers it to 2, three rules aimed at the adapter) ⇒ a PINNED OT STOP is still SENT (1 packet, acked) with
 *     `interlockOverride.failClosed === true` and the cap named (R-1D-c); a non-STOP ⇒ INTERLOCK_BLOCKED, 0 packets, refusal text names the cap; the
 *     edge otGates ⇒ gate "interlock" naming the cap.
 * Every write inside a transaction that is rolled back; no explicit ids (command_log is WORM); fake machine ids; tag keys unique to this file.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
// safety preflight reads a fake "real" safety PLC, estop=false (same mock as khoaBatBuoc.a2a / khoaTuChoiTruocBuoc2.a2g) — unmocked ⇒ SAFETY_UNKNOWN
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "A2J3-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});
vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, interlockRules } from "../../../drizzle/schema";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch, type DispatchResult, type DispatchInput } from "./commandDispatcher";
import { otGates } from "../edge/edgeAuthorizeCentral";
import { dieuKienLuatUngVien, laLuatChanNhamDung, _datTranLuatInterlockChoTest, type InterlockGateTarget } from "../interlock/interlockGate";
import type { OtWrite } from "./otDriver";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2J3-${Date.now()}`;
const OWNER = 990_914_301;
/** the adapter's REAL machine (device_adapters."machineId") */
const MAY_ADAPTER = 990_914_311;
/** the machine the caller names (an FOE step's `step.machineId`), NOT the adapter's */
const MAY_GOI = 990_914_312;
/** a machine neither side names */
const MAY_KHAC = 990_914_313;
const TAG = "a2j3_sp";
const TAG_STOP = "a2j3_stop";
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
type W = Array<{ tagKey: string; value: unknown }>;

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

function driverGia() {
  const d = {
    protocol: "modbus",
    soGhi: 0,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGhi += 1;
      return ws.map((w) => ({ tagKey: w.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  return d;
}

/** modbus adapter on machine `may` (null = on no machine): ordinary writable tag TAG + PINNED stop tag TAG_STOP (stopValue 0); its own fake driver. */
async function taoAdapter(tx: Tx, d: unknown, may: number | null): Promise<number> {
  // fixed TEST-NET address (RFC 5737): fake driver, the endpoint is never connected
  const endpoint = "tcp://192.0.2.21:502";
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${randomUUID()}`, name: `${DAU} adapter`, protocol: "modbus", endpoint, isEnabled: true, machineId: may }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: TAG, address: "40001", dataType: "int", writable: true },
    { adapterId, tagKey: TAG_STOP, address: "40002", dataType: "int", writable: true, stopValue: 0 as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: may, connectionOptions: null }));
  return adapterId;
}

/** HITL authority (confirmed, owner OWNER) bound to the command AS THE CALLER SENDS IT — the binding hash carries the CALLER's machine. */
async function taoHanhDong(tx: Tx, adapterId: number, mayGoi: number | null, writes: W, commandType: string): Promise<string> {
  const actionId = `${DAU}-act-${randomUUID()}`;
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: mayGoi, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return actionId;
}

/** A bound HITL command on adapter `ad` naming machine `mayGoi` (FOE-style: a machine that need not be the adapter's). */
async function guiHitl(tx: Tx, ad: number, mayGoi: number | null, writes: W, commandType = "set_param"): Promise<DispatchResult> {
  const actionId = await taoHanhDong(tx, ad, mayGoi, writes, commandType);
  const input = {
    adapterId: ad,
    machineId: mayGoi ?? undefined,
    commandType,
    writes,
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: `${DAU}-k-${randomUUID()}`,
  } as DispatchInput;
  return dispatch(input);
}

const chieu = (r: DispatchResult) => ({ ok: r.ok, simulated: r.simulated, status: r.status, reason: r.reason ?? null, results: r.results.map((x) => ({ tagKey: x.tagKey, ok: x.ok, status: x.status })) });
const hangCua = async (tx: Tx, ids: number[]) => (ids.length ? tx.select().from(commandLog).where(inArray(commandLog.id, ids)) : []);
const GHI: W = [{ tagKey: TAG, value: 7 }];
const STOP_GHIM: W = [{ tagKey: TAG_STOP, value: 0 }];
const CHAN = { ok: false, simulated: false, status: "rejected", reason: "INTERLOCK_BLOCKED", results: [{ tagKey: TAG, ok: false, status: "rejected" }] };
const BAY = { ok: true, simulated: false, status: "acked", reason: null, results: [{ tagKey: TAG, ok: true, status: "acked" }] };

/** The edge's rebuilt OT command for an FOE step `{ machineId: mayGoi, args.adapterId: ad }` (edgeRunAnalysis.rebuildCommand's shape). */
function rbEdge(ad: number, mayGoi: number) {
  const writes = [{ tagKey: TAG, value: 7 }];
  return {
    kind: "ot" as const,
    step: { id: "a2i1", type: "command", machineId: mayGoi, command: "write_tag", args: { adapterId: ad, tagKey: TAG, value: 7 } } as never,
    cmd: {} as never,
    adapterId: ad,
    machineId: mayGoi,
    commandType: "write_tag",
    writes,
    payloadHash: otPayloadHash({ tool: "foe_engine", adapterId: ad, machineId: mayGoi, commandType: "write_tag", writes }),
    stopTyped: false,
  };
}
/** a node id no edge node has (otGates only reaches the node after the interlock gate: its factory placement ⇒ `not_owned`) */
const NODE_KHONG_CO = 2_147_483_001;

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED", "SCADA_CONG_CHE_DO_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};


describe.skipIf(!DB_URL)("A2(j) J2 (DB) + J3 — narrowed rule read and the cap on the real database (ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  }, 60_000);
  afterAll(() => {
    _datTranLuatInterlockChoTest(null);
    H.drivers.clear();
    H.fingerprints.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    _datTranLuatInterlockChoTest(null);
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  });

  it("★ J2 (DB): every inserted rule shape × command — Postgres(dieuKienLuatUngVien) ∩ this file's rows == the JS filter over them", async () => {
    const A1 = 2_000_914_001;
    const A2 = 2_000_914_002;
    const T1 = `a2j3_t1_${Date.now()}`;
    const T2 = `a2j3_t2_${Date.now()}`;
    await trongGiaoDich(async (tx) => {
      const vals = [];
      for (const targetAdapterId of [null, A1, A2])
        for (const targetMachineId of [null, MAY_ADAPTER, MAY_GOI])
          for (const commandTag of [null, T1, T2])
            for (const approvedBy of [null, OWNER])
              for (const action of ["alert", "stop_line", "reduce_speed"] as const)
                for (const enabled of [true, false])
                  vals.push({ name: `${DAU} j2`, scope: "machine" as const, machineId: MAY_KHAC, sourceType: "spc_violation" as const, comparisonOperator: "gte" as const, threshold: "0", action, targetAdapterId, targetMachineId, commandTag, requiresHumanConfirm: true, enabled, approvedBy });
      const rows = await tx.insert(interlockRules).values(vals).returning();
      expect(rows).toHaveLength(324);
      const ids = rows.map((r) => r.id);
      const cmds: InterlockGateTarget[] = [];
      for (const adapterId of [A1, A2, -1])
        for (const m of [{}, { machineId: MAY_ADAPTER }, { machineIds: [MAY_ADAPTER, MAY_GOI] }, { machineId: null, machineIds: [] as number[] }])
          for (const tagKeys of [[], [T1], [T1, T2], ["nope"]]) cmds.push({ adapterId, ...m, tagKeys });
      let matched = 0;
      for (const cmd of cmds) {
        const got = (await tx.select({ id: interlockRules.id }).from(interlockRules).where(and(dieuKienLuatUngVien(cmd), inArray(interlockRules.id, ids)))).map((r) => r.id).sort((a, b) => a - b);
        const want = rows.filter((r) => r.enabled && laLuatChanNhamDung(r, cmd)).map((r) => r.id).sort((a, b) => a - b);
        expect(got, JSON.stringify(cmd)).toEqual(want);
        matched += want.length;
      }
      expect(matched).toBeGreaterThan(0);
    });
  }, 120_000);

  const taoLuatAdapter = async (tx: Tx, ad: number, n: number) => {
    for (let i = 0; i < n; i++) {
      await tx.insert(interlockRules).values({ name: `${DAU} cap ${i}`, scope: "machine", machineId: MAY_KHAC, sourceType: "spc_violation", comparisonOperator: "gte", threshold: "999999", action: "stop_line", targetAdapterId: ad, targetMachineId: null, commandTag: null, requiresHumanConfirm: true, enabled: true, approvedBy: OWNER, approvedAt: new Date() });
    }
  };

  it("★ J3: cap reached (cap 2, 3 rules on the adapter) ⇒ pinned STOP SENT + interlockOverride failClosed true naming the cap (R-1D-c); non-STOP ⇒ INTERLOCK_BLOCKED, 0 packets, cap named", async () => {
    _datTranLuatInterlockChoTest(2);
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      await taoLuatAdapter(tx, ad, 3);
      const r = await guiHitl(tx, ad, MAY_ADAPTER, STOP_GHIM, "stop");
      expect(chieu(r)).toEqual({ ok: true, simulated: false, status: "acked", reason: null, results: [{ tagKey: TAG_STOP, ok: true, status: "acked" }] });
      expect(d.soGhi).toBe(1);
      const ketQua = (await hangCua(tx, r.commandLogIds)).find((h) => h.status === "acked");
      expect((ketQua!.ackValue as { interlockOverride?: unknown } | null)?.interlockOverride).toMatchObject({ decision: "INTERLOCK_BLOCKED", failClosed: true, ruling: "R-1D-c", violations: [] });
      expect(String((ketQua!.ackValue as { interlockOverride?: { detail?: unknown } }).interlockOverride?.detail)).toContain("exceeds 2 rules");

      const r2 = await guiHitl(tx, ad, MAY_ADAPTER, GHI);
      expect(chieu(r2)).toEqual(CHAN);
      expect(d.soGhi).toBe(1);
      const hang = await hangCua(tx, r2.commandLogIds);
      expect(String(hang[0]!.errorText)).toContain("interlock rule set for this target exceeds 2 rules — fail-closed");
    });
  }, 60_000);

  it("★ J3: cap NOT reached (cap 3, 3 non-violating rules) ⇒ the write flies (rules evaluated, none met)", async () => {
    _datTranLuatInterlockChoTest(3);
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      await taoLuatAdapter(tx, ad, 3);
      expect(chieu(await guiHitl(tx, ad, MAY_ADAPTER, GHI))).toEqual(BAY);
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ J3: the edge otGates with the cap reached ⇒ gate \"interlock\" naming the cap", async () => {
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    _datTranLuatInterlockChoTest(2);
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia(), MAY_ADAPTER);
      await taoLuatAdapter(tx, ad, 3);
      expect(await otGates(tx as never, NODE_KHONG_CO, rbEdge(ad, MAY_GOI), 1)).toEqual({ gate: "interlock", detail: "interlock rule set for this target exceeds 2 rules — fail-closed" });
    });
  }, 60_000);
});
