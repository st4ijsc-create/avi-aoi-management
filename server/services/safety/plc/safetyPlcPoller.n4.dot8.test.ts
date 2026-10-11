/**
 * doc 81 Đợt 8 task N4 — END TO END against an in-process Modbus TCP server (modbus-serial ServerTCP, 127.0.0.1, port 0)
 * and the sim backend:
 *   PLC coils ─► real ModbusDriver ─► adapter OtReadSafetyPlcBackend ─► background poller ─► safetyAuditService
 *   (device-ingest door) ─► realtime emit ─► event bus ─► orchestration rulesEngine ─► REAL notificationService.
 * Only the storage seams are faked: the safety_events INSERT, the notification rows / preference reads (server/db), the
 * audit trail. Recipient 5 has opted out of EVERYTHING (in-app off, all types off, permanent quiet hours); recipient 6
 * has no preferences (default delivery).
 *
 * Shown: a REAL trip (e-stop pressed / guard tripped) reaches the opted-out recipient (safety-critical bypass, marker set);
 * a released / offline event, a sim trip and USER-RECORDED events (safety.recordEvent's shape, the user-triggered
 * readSafetyPlc incl. an injected status) do NOT; a re-trip inside the P-F4 window is DOWNGRADED (recipient 6 still gets
 * it), never dropped; the PLC sees ZERO writes; stop() ends all reads.
 * Hangs are bounded by explicit waits; every server/poller is closed in afterEach/afterAll.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

const S = vi.hoisted(() => ({
  nextId: 52_000,
  emitted: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  prefReads: [] as number[],
}));
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: S.nextId++, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v }],
      }),
    }),
  })),
}));
vi.mock("../../../_core/socket", async () => {
  const { eventBus, EventTypes } = await import("../../../_core/eventBus");
  return {
    // the real emitSafetyEvent's first line (no socket.io server in a test)
    emitSafetyEvent: vi.fn((e: Record<string, unknown>) => {
      S.emitted.push(e);
      eventBus.publish(EventTypes.SAFETY_EVENT, e, "socket");
    }),
  };
});
const OPTED_OUT = { inAppEnabled: false, inAppAlerts: false, inAppReports: false, inAppSystem: false, quietHoursEnabled: true, quietHoursStart: "00:00", quietHoursEnd: "00:00" };
vi.mock("../../../db", () => ({
  createNotification: vi.fn(async (row: Record<string, unknown>) => {
    S.created.push(row);
    return { id: S.created.length };
  }),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(async (userId: number) => {
    S.prefReads.push(userId);
    return userId === 5 ? OPTED_OUT : null;
  }),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));
vi.mock("../../auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

import * as ModbusSerialNs from "modbus-serial";
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import "../../ot"; // registers the real modbus / opcua drivers (production side effect)
import "../../notificationService"; // warm the module graph (concurrent first dynamic imports stall under vitest)
import "../../auditTrailService";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { readAndRecord, SimSafetyPlcBackend } from "./safetyPlcAdapter";
import { record } from "../safetyAuditService";
import { startOrchestration, stopOrchestration } from "../../orchestration/rulesEngine";
import { _resetSafetyCriticalDedupForTests } from "../../notificationService";
import { _resetTrustedSafetyMarksForTests } from "../trustedSafetyOrigin";
import { plcTrustDigest } from "./safetyPlcTrust";

/**
 * N fix 1 (I1) — the maker-checker approvals of this test: configId → the digest a SECOND person approved. The poller asks
 * through its isTrustApproved seam; the comparison uses the REAL digest function (the DB row lookup is covered by
 * safetyPlcTrust.fix1.dot8.db.test.ts on the real _test DB).
 */
const APPROVED = new Map<number, string>();
const approve = (c: SafetyPlcConfig) => APPROVED.set(c.id, plcTrustDigest(c));

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(10);
  }
  return true;
}

/** Spec-written fake PLC: coils held by the TEST; every write / read is counted. */
interface FakePlc {
  port: number;
  coils: Map<number, boolean>;
  reads: number;
  writes: number;
  close(): Promise<void>;
}
async function startPlc(): Promise<FakePlc> {
  const plc = { coils: new Map<number, boolean>(), reads: 0, writes: 0 } as FakePlc;
  const vector = {
    getCoil: (addr: number) => {
      plc.reads += 1;
      return plc.coils.get(addr) ?? false;
    },
    getDiscreteInput: () => false,
    getHoldingRegister: () => 0,
    getInputRegister: () => 0,
    setCoil: () => {
      plc.writes += 1;
    },
    setRegister: () => {
      plc.writes += 1;
    },
  };
  // modbus-serial does `options.port || 502` ⇒ a numeric 0 would bind 502; the string "0" asks the OS for a free port.
  const srv = new ServerTCP(vector, { host: "127.0.0.1", port: "0", unitID: 1 });
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  plc.port = srv._server.address().port;
  plc.close = () =>
    new Promise<void>((resolve) => {
      for (const s of srv.socks?.keys?.() ?? []) (s as { destroy: () => void }).destroy();
      srv.close(() => resolve());
    });
  return plc;
}

function realCfg(port: number, over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
  return {
    id: 801,
    code: "N4-PLC",
    name: "N4 Pilz on 127.0.0.1",
    vendor: "pilz",
    backend: "modbus",
    endpoint: `tcp://127.0.0.1:${port}`,
    // coil N is address "coil:N" (1-based) ⇒ server address N-1
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, pollIntervalMs: 250 },
    robotId: 41,
    stationId: null,
    lineId: null,
    enabled: true,
    notes: null,
    scope: null,
    corporateCode: null,
    factoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SafetyPlcConfig;
}

const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED", "ORCHESTRATION_ENABLED", "ORCH_NOTIFY_USER_IDS", "SAFETY_PLC_POLL_READ_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};
let plc: FakePlc;
let poller: SafetyPlcPoller | null = null;
const quiet: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  plc = await startPlc();
  expect(plc.port).toBeGreaterThan(0);
  expect(plc.port).not.toBe(502);
});
afterAll(async () => {
  await plc.close();
});
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, {
    SAFETY_PLC_POLLER_ENABLED: "true",
    SAFETY_PLC_ADAPTER_ENABLED: "true",
    SAFETY_AUDIT_ENABLED: "true",
    ORCHESTRATION_ENABLED: "true",
    ORCH_NOTIFY_USER_IDS: "5,6",
    SAFETY_PLC_POLL_READ_TIMEOUT_MS: "1000",
  });
  S.emitted.length = 0;
  S.created.length = 0;
  S.prefReads.length = 0;
  plc.coils.clear();
  plc.writes = 0;
  _resetSafetyCriticalDedupForTests();
  _resetTrustedSafetyMarksForTests();
  APPROVED.clear();
  for (const m of ["warn", "log"] as const) quiet.push(vi.spyOn(console, m).mockImplementation(() => undefined));
  startOrchestration();
});
afterEach(async () => {
  if (poller) await poller.stop();
  poller = null;
  stopOrchestration();
  while (quiet.length) quiet.pop()!.mockRestore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  expect(plc.writes, "L-7: the poller never writes to the PLC").toBe(0);
});

/** Notices delivered (created) for a user, for one safety event type. */
const delivered = (userId: number, type: string) => S.created.filter((r) => r.userId === userId && String(r.message).includes(`: ${type} at`));
const ev = (type: string) => S.emitted.filter((e) => e.eventType === type);

function startPoller(cfgs: SafetyPlcConfig[]) {
  // every other dep = production default (real backends, real audit service, real doors)
  poller = new SafetyPlcPoller({ loadConfigs: async () => cfgs, isTrustApproved: async (c) => APPROVED.get(c.id) === plcTrustDigest(c), leader: { acquire: async () => true, held: async () => true, release: async () => undefined } });
  expect(poller.start()).toBe(true);
  return poller;
}

describe("doc 81 Đợt 8 N4 — real Modbus PLC on 127.0.0.1:0 ⇒ trusted device-ingest events", () => {
  it("★ e-stop PRESSED reaches the OPTED-OUT recipient (bypass, marker); released does not; zero writes", async () => {
    approve(realCfg(plc.port));
    startPoller([realCfg(plc.port)]);
    expect(await until(() => plc.reads >= 2, 3000), "poller never read the PLC").toBe(true);
    expect(S.emitted, "a clear PLC produces no event").toEqual([]);

    plc.coils.set(0, true); // e-stop pressed
    expect(await until(() => delivered(5, "estop").length === 1 && delivered(6, "estop").length === 1, 4000), "estop notice not delivered").toBe(true);
    expect(ev("estop")).toHaveLength(1);
    expect(ev("estop")[0]).toMatchObject({ robotId: 41, detectedBy: "plc", handledBy: "advisory", outcome: "logged_only" });
    expect(delivered(5, "estop")[0].metadata).toMatchObject({ safetyCritical: true });
    expect(S.prefReads.filter((u) => u === 5), "a safety-critical notice must not even read the opt-outs").toEqual([]);

    await sleep(800); // held ⇒ several polls, no new event
    expect(ev("estop")).toHaveLength(1);

    plc.coils.set(0, false); // released
    expect(await until(() => ev("estop_released").length === 1 && S.prefReads.includes(5), 4000)).toBe(true);
    await sleep(100);
    expect(delivered(5, "estop_released"), "released is a NORMAL notice ⇒ the opted-out recipient gets nothing").toEqual([]);
    expect(delivered(6, "estop_released")).toHaveLength(1);
  });

  it("★ guard / light curtain TRIPPED ⇒ bypass too (another type, its own budget)", async () => {
    approve(realCfg(plc.port));
    startPoller([realCfg(plc.port)]);
    expect(await until(() => plc.reads >= 2, 3000)).toBe(true);
    plc.coils.set(0, true);
    plc.coils.set(1, true);
    expect(await until(() => delivered(5, "estop").length === 1 && delivered(5, "zone_intrusion").length === 1, 4000)).toBe(true);
    expect(delivered(5, "zone_intrusion")[0].metadata).toMatchObject({ safetyCritical: true });
  });

  it("P-F4 + throttle: a re-trip inside the window is DOWNGRADED, never dropped (recipient 6 gets both, recipient 5 only the first)", async () => {
    approve(realCfg(plc.port));
    startPoller([realCfg(plc.port)]);
    expect(await until(() => plc.reads >= 2, 3000)).toBe(true);
    plc.coils.set(0, true);
    expect(await until(() => delivered(6, "estop").length === 1, 4000)).toBe(true);
    plc.coils.set(0, false);
    expect(await until(() => ev("estop_released").length === 1, 4000)).toBe(true);
    plc.coils.set(0, true); // re-trip < 10 s later
    expect(await until(() => ev("estop").length === 2 && delivered(6, "estop").length === 2, 4000)).toBe(true);
    await sleep(100);
    expect(delivered(5, "estop"), "second bypass inside SAFETY_CRITICAL_RATE_MS ⇒ normal ⇒ opted-out user's preference applies").toHaveLength(1);
    expect(delivered(6, "estop")[1].metadata ?? {}).not.toMatchObject({ safetyCritical: true });
  });

  it("PLC goes away ⇒ ONE 'plc_offline' (normal notice), and NO 'estop_released' for an e-stop that was pressed", async () => {
    const other = await startPlc();
    try {
      startPoller([realCfg(other.port, { id: 802, code: "N4-GONE" })]);
      expect(await until(() => other.reads >= 2, 3000)).toBe(true);
      other.coils.set(0, true);
      expect(await until(() => ev("estop").length === 1, 4000)).toBe(true);
      await other.close();
      expect(await until(() => ev("plc_offline").length === 1, 5000), "no offline event").toBe(true);
      await sleep(1500);
      expect(ev("plc_offline")).toHaveLength(1);
      expect(ev("estop_released")).toEqual([]);
      expect(delivered(5, "plc_offline")).toEqual([]);
      expect(delivered(6, "plc_offline")).toHaveLength(1);
    } finally {
      await other.close().catch(() => undefined);
      expect(other.writes).toBe(0);
    }
  });

  it("stop() ⇒ the PLC is not read any more", async () => {
    startPoller([realCfg(plc.port)]);
    expect(await until(() => plc.reads >= 3, 3000)).toBe(true);
    await poller!.stop();
    const n = plc.reads;
    await sleep(800);
    expect(plc.reads).toBe(n);
  });
});

describe("doc 81 Đợt 8 N fix 1 (I1) — maker-checker: a REAL PLC trip bypasses only while its config is approved", () => {
  it("★ never approved ⇒ the real trip is recorded but NOT delivered to the opted-out recipient", async () => {
    startPoller([realCfg(plc.port)]);
    expect(await until(() => plc.reads >= 2, 3000)).toBe(true);
    plc.coils.set(0, true);
    expect(await until(() => delivered(6, "estop").length === 1 && S.prefReads.includes(5), 4000)).toBe(true);
    await sleep(100);
    expect(ev("estop")).toHaveLength(1);
    expect(delivered(5, "estop")).toEqual([]);
  });

  it("★ approved, then EDITED (binding changed ⇒ new digest, not re-approved) ⇒ the next trip no longer bypasses", async () => {
    const cfgs = [realCfg(plc.port)];
    approve(cfgs[0]);
    startPoller(cfgs);
    expect(await until(() => plc.reads >= 2, 3000)).toBe(true);
    plc.coils.set(0, true);
    expect(await until(() => delivered(5, "estop").length === 1, 4000)).toBe(true);
    plc.coils.set(0, false);
    expect(await until(() => ev("estop_released").length === 1, 4000)).toBe(true);
    cfgs[0] = { ...cfgs[0], robotId: 42 }; // an edit the second person has not seen
    await poller!.refreshConfigs();
    _resetSafetyCriticalDedupForTests(); // the next trip is outside every P-F4 window: only the approval decides
    plc.coils.set(0, true);
    expect(await until(() => delivered(6, "estop").length === 2, 4000)).toBe(true);
    await sleep(100);
    expect(delivered(5, "estop")).toHaveLength(1);
  });
});

describe("doc 81 Đợt 8 N4 — sim and USER-RECORDED events never take the bypass", () => {
  it("sim backend e-stop (poller) ⇒ event recorded, NOT delivered to the opted-out recipient", async () => {
    startPoller([realCfg(0, { id: 803, code: "N4-SIM", backend: "sim", endpoint: null, statusMap: { simScript: [{}, { estop: true }], pollIntervalMs: 250 } })]);
    expect(await until(() => ev("estop").length >= 1 && S.prefReads.includes(5), 3000)).toBe(true);
    await sleep(100);
    expect(ev("estop")[0].detectedBy).toBe("sim");
    expect(delivered(5, "estop")).toEqual([]);
    expect(delivered(6, "estop").length).toBeGreaterThanOrEqual(1);
  });

  it("★ safety.recordEvent's shape (a user says: PLC e-stop, stopped) ⇒ NOT delivered to the opted-out recipient", async () => {
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "operator", outcome: "stopped", robotId: 41, notes: "user says the PLC tripped" });
    expect(await until(() => delivered(6, "estop").length === 1, 3000)).toBe(true);
    await sleep(100);
    expect(delivered(5, "estop")).toEqual([]);
  });

  it("★ the user-triggered readSafetyPlc — on the REAL PLC, and with an injected sim status — ⇒ NOT delivered to the opted-out recipient", async () => {
    plc.coils.set(0, true);
    const real = await readAndRecord(realCfg(plc.port)); // what safety.readSafetyPlc runs for this config
    expect(real.findings.map((f) => f.eventType)).toEqual(["estop"]);
    expect(await until(() => delivered(6, "estop").length === 1, 3000)).toBe(true);
    const injected = await readAndRecord(realCfg(plc.port), new SimSafetyPlcBackend([{ estop: true, zoneOccupied: true }])); // simStatus
    expect(injected.findings.map((f) => f.eventType)).toEqual(["estop", "zone_intrusion"]);
    expect(await until(() => delivered(6, "zone_intrusion").length === 1, 3000)).toBe(true);
    await sleep(100);
    expect(delivered(5, "estop")).toEqual([]);
    expect(delivered(5, "zone_intrusion")).toEqual([]);
  });
});
