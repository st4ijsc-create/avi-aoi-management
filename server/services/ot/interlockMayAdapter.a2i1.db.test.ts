/**
 * SCADA R1b-2b-2a A2(i)(1) (AN TOÀN, dieu-phoi 2026-11-02) — the interlock gate also checks the ADAPTER's real machine, not only the machine id the
 * caller passes.
 *
 * Gap (before A2(i)(1)): commandDispatcher's inline gate and its edge copy (edgeAuthorizeCentral.otGates) matched `targetMachineId` against the
 * CALLER's `machineId` only. An FOE step naming `args.adapterId` passes `step.machineId`, and that adapter may sit on ANOTHER machine (foeScope.ts,
 * R-4-d) ⇒ a rule aimed only at the adapter's real machine (no `targetAdapterId`, no `commandTag`) was skipped and the write reached that machine
 * while the rule was active.
 *
 * Ruling: match on the UNION {adapter's machine, caller's machine} (tapMayChoInterlock — stricter only); adapter on no machine ⇒ the caller's only;
 * a pinned STOP keeps today's behaviour exactly (a block is overridden, R-1D-c); the binding hash keeps the caller's machine; the edge path reads the
 * adapter's machine from the row it already reads and fails closed when that read fails.
 *
 * Cases: (a) rule ONLY on the adapter's machine + caller names another machine ⇒ INTERLOCK_BLOCKED, 0 packets (RED on the base 952534f3a);
 * (b) rule on the caller's machine ⇒ still blocked; (c) adapter on no machine ⇒ only the caller's machine matters; (d) pinned STOP + rule on the
 * adapter's machine ⇒ sent (+ interlockOverride R-1D-c), as on base; (e) the edge authorization gates for case (a) ⇒ gate "interlock";
 * (f) the edge adapter read fails (non-STOP) ⇒ fail-closed (the read error propagates; nothing is decided "with the caller's machine only").
 *
 * DB THẬT (`_test`): real dispatcher + real edge gates + FAKE driver counting `writeTags`; every write inside a transaction that is ROLLED BACK;
 * no explicit ids (command_log is WORM); machine ids are fake, out of every seeded range (no FK on device_adapters / interlock_rules machine columns);
 * tag keys are unique to this file (no seeded `commandTag` rule can match them).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
    listPlcConfigs: async () => [{ code: "A2I1-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
import type { OtWrite } from "./otDriver";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2I1-${Date.now()}`;
const OWNER = 990_912_301;
/** the adapter's REAL machine (device_adapters."machineId") */
const MAY_ADAPTER = 990_912_311;
/** the machine the caller names (an FOE step's `step.machineId`), NOT the adapter's */
const MAY_GOI = 990_912_312;
/** a machine neither side names */
const MAY_KHAC = 990_912_313;
const TAG = "a2i1_sp";
const TAG_STOP = "a2i1_stop";
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

/**
 * An enabled + approved gate rule (`stop_line`) aimed ONLY at machine `dich` (no targetAdapterId, no commandTag — the shape interlockRouter allows),
 * condition ALWAYS met: spc_violation count on that (fake) machine >= 0. Inside the rolled-back transaction only.
 */
async function taoLuatChiMay(tx: Tx, dich: number): Promise<number> {
  const [r] = await tx
    .insert(interlockRules)
    .values({
      name: `${DAU} rule machine ${dich}`,
      scope: "machine",
      machineId: dich,
      sourceType: "spc_violation",
      comparisonOperator: "gte",
      threshold: "0",
      action: "stop_line",
      targetMachineId: dich,
      targetAdapterId: null,
      commandTag: null,
      requiresHumanConfirm: true,
      enabled: true,
      approvedBy: OWNER,
      approvedAt: new Date(),
    })
    .returning({ id: interlockRules.id });
  return r!.id;
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

async function kiemChan(tx: Tx, r: DispatchResult, ruleId: number) {
  expect(chieu(r)).toEqual(CHAN);
  const hang = await hangCua(tx, r.commandLogIds);
  expect(hang).toHaveLength(1);
  expect(hang[0]!.status).toBe("rejected");
  expect(String(hang[0]!.errorText)).toContain(`INTERLOCK_BLOCKED: blocked by active interlock rule(s): #${ruleId}(stop_line)`);
}

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

/** `tx` whose read of `device_adapters` FAILS (every other read is the real one) — the edge adapter row cannot be read. */
function txAdapterHong(tx: Tx): Tx {
  return new Proxy(tx as object, {
    get(t, p, r) {
      if (p === "select") {
        return (...a: unknown[]) => {
          const b = (t as { select: (...x: unknown[]) => object }).select(...a);
          return new Proxy(b, {
            get(bt, bp) {
              if (bp === "from")
                return (tbl: unknown) => {
                  if (tbl === deviceAdapters) throw new Error("A2I1 adapter row read failed");
                  return (bt as { from: (x: unknown) => unknown }).from(tbl);
                };
              const v = Reflect.get(bt, bp);
              return typeof v === "function" ? v.bind(bt) : v;
            },
          });
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as Tx;
}

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED", "SCADA_CONG_CHE_DO_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(i)(1) — the interlock gate matches the ADAPTER's machine ∪ the caller's (DB thật, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
    await import("../robot/criticalStopAlert");
  }, 60_000);
  afterAll(() => {
    H.drivers.clear();
    H.fingerprints.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  });

  it("control: no rule on either machine ⇒ the write flies (1 packet) — the seeded _test rules do not touch this file's adapters / tags", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      expect(chieu(await guiHitl(tx, ad, MAY_GOI, GHI))).toEqual(BAY);
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ (a) rule ONLY on the adapter's real machine (no adapter, no tag), condition met; HITL command naming ANOTHER machine ⇒ INTERLOCK_BLOCKED, 0 packets", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      const ruleId = await taoLuatChiMay(tx, MAY_ADAPTER);
      const r = await guiHitl(tx, ad, MAY_GOI, GHI);
      await kiemChan(tx, r, ruleId);
      expect(d.soGhi).toBe(0);
    });
  }, 60_000);

  it("★ (b) rule on the CALLER's machine ⇒ still blocked (the adapter on another machine does not remove the caller's rules); a rule on a third machine ⇒ flies", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      const ruleId = await taoLuatChiMay(tx, MAY_GOI);
      await kiemChan(tx, await guiHitl(tx, ad, MAY_GOI, GHI), ruleId);
      expect(d.soGhi).toBe(0);
    });
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, MAY_ADAPTER);
      await taoLuatChiMay(tx, MAY_KHAC);
      expect(chieu(await guiHitl(tx, ad, MAY_GOI, GHI))).toEqual(BAY);
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ (c) adapter on NO machine ⇒ only the caller's machine matters: a rule on the caller's machine blocks; a rule on another machine does not", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, null);
      const ruleId = await taoLuatChiMay(tx, MAY_GOI);
      await kiemChan(tx, await guiHitl(tx, ad, MAY_GOI, GHI), ruleId);
      expect(d.soGhi).toBe(0);
    });
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d, null);
      await taoLuatChiMay(tx, MAY_ADAPTER);
      expect(chieu(await guiHitl(tx, ad, MAY_GOI, GHI))).toEqual(BAY);
      expect(d.soGhi).toBe(1);
    });
  }, 60_000);

  it("★ (d) pinned STOP on the adapter + an active rule on the adapter's machine ⇒ SENT (1 packet, acked) and recorded as interlockOverride R-1D-c — never refused; (d1) caller names the adapter's machine, (d2) caller names another machine", async () => {
    for (const mayGoi of [MAY_ADAPTER, MAY_GOI]) {
      await trongGiaoDich(async (tx) => {
        const d = driverGia();
        const ad = await taoAdapter(tx, d, MAY_ADAPTER);
        const ruleId = await taoLuatChiMay(tx, MAY_ADAPTER);
        const r = await guiHitl(tx, ad, mayGoi, STOP_GHIM, "stop");
        expect(chieu(r), `caller machine ${mayGoi}`).toEqual({ ok: true, simulated: false, status: "acked", reason: null, results: [{ tagKey: TAG_STOP, ok: true, status: "acked" }] });
        expect(d.soGhi).toBe(1);
        const ketQua = (await hangCua(tx, r.commandLogIds)).find((h) => h.status === "acked");
        expect(ketQua, "the acked result row").toBeTruthy();
        expect((ketQua!.ackValue as { pinnedStop?: unknown } | null)?.pinnedStop).toBe(true);
        expect((ketQua!.ackValue as { interlockOverride?: unknown } | null)?.interlockOverride, `caller machine ${mayGoi}`).toMatchObject({
          decision: "INTERLOCK_BLOCKED",
          failClosed: false,
          ruling: "R-1D-c",
          violations: [{ ruleId, action: "stop_line" }],
        });
      });
    }
  }, 60_000);

  it("★ (e) the EDGE authorization gates (otGates) for case (a) — FOE step on machine G naming the adapter of machine A, rule only on A ⇒ refused, gate \"interlock\"; the rule disabled ⇒ the interlock gate passes (otGates goes on to the node's factory ⇒ not_owned)", async () => {
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false"; // the interlock gate is what is measured here (central's preflight has its own suites)
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia(), MAY_ADAPTER);
      const ruleId = await taoLuatChiMay(tx, MAY_ADAPTER);
      const g = await otGates(tx as never, NODE_KHONG_CO, rbEdge(ad, MAY_GOI), 1);
      expect(g).toEqual({ gate: "interlock", detail: `interlock rule(s) #${ruleId}` });

      await tx.update(interlockRules).set({ enabled: false }).where(eq(interlockRules.id, ruleId));
      await expect(otGates(tx as never, NODE_KHONG_CO, rbEdge(ad, MAY_GOI), 1)).rejects.toThrow("not_owned");
    });
  }, 60_000);

  it("★ (f) the EDGE adapter row cannot be read (non-STOP), with a rule active on the adapter's machine ⇒ fail-closed: the read error propagates (authorizeForNode ⇒ 503, nothing signed) — never decided with the caller's machine only", async () => {
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    await trongGiaoDich(async (tx) => {
      const ad = await taoAdapter(tx, driverGia(), MAY_ADAPTER);
      await taoLuatChiMay(tx, MAY_ADAPTER);
      await expect(otGates(txAdapterHong(tx), NODE_KHONG_CO, rbEdge(ad, MAY_GOI), 1)).rejects.toThrow("A2I1 adapter row read failed");
    });
  }, 60_000);
});
