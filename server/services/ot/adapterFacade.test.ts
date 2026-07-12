/**
 * doc 44 W2-A3 — G1.1 adapter facade tests.
 *
 * Proves (in-memory tables + REAL commandDispatcher — same harness as
 * commandDispatcher.correlation.test.ts; NO live DB):
 *   - executeCommand fallback (verb 'tag.write') goes THROUGH dispatch() — the
 *     one-door: a commandLog ledger row is written and driver.writeTags is NEVER
 *     called by the facade itself (mode gate OFF ⇒ simulated ⇒ zero writes).
 *   - dispatcher gates APPLY through the facade (tag not writable → ack rejected
 *     reason TAG_NOT_WRITABLE — impossible if the facade bypassed the dispatcher).
 *   - control ON → the write reaches the driver VIA the dispatcher (ledger row
 *     'acked'), ack maps to 'done'.
 *   - verb ≠ 'tag.write' → ack rejected reason UNSUPPORTED, dispatcher untouched.
 *   - bad args / bad issued_by → INVALID_ARGS, dispatcher untouched.
 *   - idempotency: same idempotency_key twice → cached ack, ONE ledger row.
 *   - driver implementing executeCommand/describe/getSafetyStatus → delegated.
 *   - describe fallback: capabilityModel (machineType) + device_tags rows
 *     (direction/deadband/sampling_ms carried).
 *   - getSafetyStatus fallback: flag OFF → UNKNOWN 'none' (honest); enabled +
 *     clean read → OK; active safety flag → BLOCKED; all reads failing → UNKNOWN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;

// ── In-memory tables ──────────────────────────────────────────────────────────
const pending = new Map<string, Row>();
const adapters: Row[] = [];
const tags: Row[] = [];
const machineRows: Row[] = [];
const cmdLog: Row[] = [];
let cmdSeq = 1;

function reset() {
  pending.clear();
  adapters.length = 0;
  tags.length = 0;
  machineRows.length = 0;
  cmdLog.length = 0;
  cmdSeq = 1;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}

function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(pending.values());
    case "device_adapters": return adapters;
    case "device_tags": return tags;
    case "machines": return machineRows;
    case "command_log": return cmdLog;
    default: return [];
  }
}

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: any) => ({
        // Thenable (await-able) AND .limit()-able — the facade awaits the bare
        // where() for device_tags; the dispatcher always chains .limit(1).
        where: (pred: any) => {
          const rows = tableFor(table).filter((r) => matches(r, pred));
          return {
            limit: async (n?: number) => rows.slice(0, n ?? 1),
            then: (onF: any, onR: any) => Promise.resolve(rows.slice()).then(onF, onR),
          };
        },
      }),
    }),
    insert: (table: any) => ({
      values: (vals: Row) => ({
        returning: async (_sel?: any) => {
          if (table.__table === "command_log") {
            const row = { id: cmdSeq++, ...vals };
            cmdLog.push(row);
            return [{ id: row.id }];
          }
          return [{ id: cmdSeq++ }];
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

vi.mock("../../../drizzle/schema", () => ({
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
  deviceAdapters: { __table: "device_adapters", id: { __name: "id" }, machineId: { __name: "machineId" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", id: { __name: "id" }, adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, dataType: { __name: "dataType" }, scale: { __name: "scale" }, offset: { __name: "offset" } },
  machines: { __table: "machines", id: { __name: "id" } },
  commandLog: { __table: "command_log", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" }, status: { __name: "status" } },
  interlockRules: { __table: "interlock_rules", id: { __name: "id" } },
  interlockEvents: { __table: "interlock_events", id: { __name: "id" } },
}));

vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { INTERLOCK_AUTO_BLOCK: "interlock_auto_block" },
  createAuditContext: (x: any) => x,
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));

vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));

// ── otManager — a swappable "active driver" (the facade + dispatcher share it) ─
const writeTagsSpy = vi.fn(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
let currentDriver: any;
vi.mock("./otManager", () => ({
  getActiveDriver: vi.fn(() => currentDriver),
}));

// ── safety-PLC adapter (dynamic-imported by the facade) ───────────────────────
let plcEnabled = false;
let plcConfigs: Row[] = [];
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => plcEnabled,
  listPlcConfigs: async () => plcConfigs,
  backendForConfig: (cfg: any) => ({
    kind: "sim" as const,
    read: async () => {
      if (cfg.__throw) throw new Error("unreachable");
      return cfg.__status ?? {};
    },
    label: () => "sim",
  }),
  statusToFindings: (status: Record<string, unknown>) =>
    Object.keys(status)
      .filter((k) => status[k] === true)
      .map((flag) => ({ flag, eventType: "estop", note: "" })),
}));

import { createAdapterFacade, dispatchResultToAck, parseIssuedBy } from "./adapterFacade";
import type { CanonicalCommand } from "./otDriver";

const baseCmd = (over: Partial<CanonicalCommand> = {}): CanonicalCommand => ({
  command_id: "cmd-1",
  asset_id: "urn:asset:10",
  verb: "tag.write",
  args: { tag: "cmd_start", value: true },
  issued_by: 1,
  idempotency_key: "idem-1",
  ...over,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  process.env.OT_CONTROL_ENABLED = "false";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.UNS_CMD_ACK_ENABLED;
  plcEnabled = false;
  plcConfigs = [];
  writeTagsSpy.mockImplementation(async (writes: any[]) => writes.map((w) => ({ tagKey: w.tagKey, ok: true })));
  // Default: a plain driver WITHOUT the 3 optional methods (fallbacks engage).
  currentDriver = {
    isConnected: () => true,
    writeTags: (...a: any[]) => (writeTagsSpy as any)(...a),
    readTags: vi.fn(async () => []),
  };
  adapters.push({ id: 10, machineId: 5, code: "A10", isEnabled: true });
  machineRows.push({ id: 5, machineType: "AUTOMATION", capabilities: null });
  tags.push({
    id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", dataType: "bool",
    scale: "1", offset: "0", writable: true, isEnabled: true, unit: null, deadband: null, samplingMs: null,
  });
});

describe("G1.1 — executeCommand fallback goes THROUGH the dispatcher (no backdoor)", () => {
  it("verb tag.write + mode gate OFF → ledger row 'simulated', ack done/SIMULATED, driver.writeTags NEVER called", async () => {
    const facade = createAdapterFacade({ adapterId: 10, machineId: 5 });
    const ack = await facade.executeCommand(baseCmd());
    expect(ack.status).toBe("done");
    expect(ack.reason).toBe("SIMULATED");
    expect(ack.command_id).toBe("cmd-1");
    expect(typeof ack.ts).toBe("string");
    // One-door proof: the dispatcher wrote its append-only ledger row…
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].status).toBe("simulated");
    expect(cmdLog[0].commandType).toBe("tag.write");
    expect(cmdLog[0].idempotencyKey).toContain("idem-1");
    // …and the facade never touched the device directly.
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("dispatcher gates APPLY: tag not writable → ack rejected TAG_NOT_WRITABLE", async () => {
    tags[0].writable = false;
    const facade = createAdapterFacade({ adapterId: 10 });
    const ack = await facade.executeCommand(baseCmd());
    expect(ack.status).toBe("rejected");
    expect(ack.reason).toBe("TAG_NOT_WRITABLE");
    expect(writeTagsSpy).not.toHaveBeenCalled();
    expect(cmdLog[0].status).toBe("rejected");
  });

  it("control ON → write reaches the driver VIA the dispatcher; ack 'done', ledger 'acked'", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    const facade = createAdapterFacade({ adapterId: 10, machineId: 5 });
    const ack = await facade.executeCommand(baseCmd({ correlation_id: "corr-f1", deadline_ms: 2000 }));
    expect(ack.status).toBe("done");
    expect(writeTagsSpy).toHaveBeenCalledTimes(1);
    expect(cmdLog).toHaveLength(1);
    expect(cmdLog[0].status).toBe("acked");
    // G1.7 context flows through the facade unchanged.
    expect(cmdLog[0].correlationId).toBe("corr-f1");
    expect(cmdLog[0].deadlineMs).toBe(2000);
  });

  it("verb ≠ tag.write → rejected UNSUPPORTED; dispatcher untouched (no ledger row)", async () => {
    const facade = createAdapterFacade({ adapterId: 10 });
    const ack = await facade.executeCommand(baseCmd({ verb: "start" }));
    expect(ack.status).toBe("rejected");
    expect(ack.reason).toBe("UNSUPPORTED");
    expect(cmdLog).toHaveLength(0);
    expect(writeTagsSpy).not.toHaveBeenCalled();
  });

  it("missing args.tag / args.value → rejected INVALID_ARGS; dispatcher untouched", async () => {
    const facade = createAdapterFacade({ adapterId: 10 });
    const a1 = await facade.executeCommand(baseCmd({ args: { value: 1 } }));
    const a2 = await facade.executeCommand(baseCmd({ args: { tag: "cmd_start" } }));
    expect(a1.status).toBe("rejected");
    expect(a1.reason).toBe("INVALID_ARGS");
    expect(a2.status).toBe("rejected");
    expect(a2.reason).toBe("INVALID_ARGS");
    expect(cmdLog).toHaveLength(0);
  });

  it("bad issued_by (non-numeric / non-positive) → rejected INVALID_ARGS", async () => {
    const facade = createAdapterFacade({ adapterId: 10 });
    const ack = await facade.executeCommand(baseCmd({ issued_by: "operator-7" }));
    expect(ack.status).toBe("rejected");
    expect(ack.reason).toBe("INVALID_ARGS");
    expect(cmdLog).toHaveLength(0);
    expect(parseIssuedBy("42")).toBe(42);
    expect(parseIssuedBy(0)).toBeNull();
    expect(parseIssuedBy(-3)).toBeNull();
    expect(parseIssuedBy("abc")).toBeNull();
  });

  it("idempotency: same idempotency_key twice → cached ack, ONE ledger row (spec §13.2)", async () => {
    const facade = createAdapterFacade({ adapterId: 10 });
    const a1 = await facade.executeCommand(baseCmd());
    const a2 = await facade.executeCommand(baseCmd({ command_id: "cmd-2" }));
    expect(a1.status).toBe("done");
    expect(a2.status).toBe("done");
    expect(a2.command_id).toBe("cmd-2");
    expect(cmdLog).toHaveLength(1);
  });

  it("driver implementing executeCommand → delegated (dispatcher untouched)", async () => {
    const delegated = vi.fn(async (cmd: CanonicalCommand) => ({
      command_id: cmd.command_id, status: "done" as const, ts: new Date().toISOString(),
    }));
    currentDriver = { ...currentDriver, executeCommand: delegated };
    const facade = createAdapterFacade({ adapterId: 10 });
    const ack = await facade.executeCommand(baseCmd({ verb: "start" }));
    expect(delegated).toHaveBeenCalledTimes(1);
    expect(ack.status).toBe("done");
    expect(cmdLog).toHaveLength(0);
  });
});

describe("G1.1 — dispatchResultToAck mapping (pure)", () => {
  const cmd = baseCmd();
  const mk = (status: any, reason?: string) =>
    dispatchResultToAck(cmd, { ok: false, simulated: false, status, reason, results: [], commandLogIds: [] });
  it("maps every terminal DispatchStatus onto the §13.1 ack state machine", () => {
    expect(mk("rejected", "BUSY")).toMatchObject({ status: "rejected", reason: "BUSY" });
    expect(mk("failed", "ADAPTER_OFFLINE")).toMatchObject({ status: "failed", reason: "ADAPTER_OFFLINE" });
    expect(mk("timeout")).toMatchObject({ status: "failed", reason: "TIMEOUT" });
    expect(mk("sent")).toMatchObject({ status: "executing" });
    expect(mk("simulated")).toMatchObject({ status: "done", reason: "SIMULATED" });
    expect(mk("acked")).toMatchObject({ status: "done" });
    expect(mk("acked_verified")).toMatchObject({ status: "done" });
    expect(mk("acked_unverified")).toMatchObject({ status: "done" });
  });
});

describe("G1.1 — describe fallback (capabilityModel + device_tags)", () => {
  it("builds AssetDescriptor from the machine's capability profile + tag rows", async () => {
    tags.push({
      id: 101, adapterId: 10, tagKey: "temp", address: "DB1.DBD0", dataType: "float",
      scale: "1", offset: "0", writable: false, isEnabled: true, unit: "degC", deadband: 0.5, samplingMs: 1000,
    });
    tags.push({ // disabled — must be EXCLUDED
      id: 102, adapterId: 10, tagKey: "hidden", address: "x", dataType: "int",
      scale: "1", offset: "0", writable: false, isEnabled: false, unit: null, deadband: null, samplingMs: null,
    });
    const facade = createAdapterFacade({ adapterId: 10 });
    const d = await facade.describe();
    expect(d.class).toBe("AUTOMATION");
    // AUTOMATION profile carries the canonical verbs incl. read_tag/write_tag.
    expect(d.capabilities).toContain("start");
    expect(d.capabilities).toContain("write_tag");
    expect(d.tags.map((t) => t.tag_id).sort()).toEqual(["cmd_start", "temp"]);
    const temp = d.tags.find((t) => t.tag_id === "temp")!;
    expect(temp).toMatchObject({
      datatype: "float", unit: "degC", direction: "read", source_address: "DB1.DBD0",
      deadband: 0.5, sampling_ms: 1000,
    });
    const cmdStart = d.tags.find((t) => t.tag_id === "cmd_start")!;
    expect(cmdStart.direction).toBe("read_write");
    expect(cmdStart.deadband).toBeUndefined();
  });

  it("no machine attached → honest fallback profile, tags still listed", async () => {
    adapters[0].machineId = null;
    const facade = createAdapterFacade({ adapterId: 10 });
    const d = await facade.describe();
    expect(d.class).toBe("AUTOMATION"); // capabilityModel fallback class
    expect(d.tags).toHaveLength(1);
  });

  it("driver implementing describe → delegated", async () => {
    const delegated = vi.fn(async () => ({ class: "ROBOT", capabilities: ["move"], tags: [] }));
    currentDriver = { ...currentDriver, describe: delegated };
    const facade = createAdapterFacade({ adapterId: 10 });
    const d = await facade.describe();
    expect(delegated).toHaveBeenCalledTimes(1);
    expect(d.class).toBe("ROBOT");
  });
});

describe("G1.1 — getSafetyStatus fallback (READ-ONLY, honest)", () => {
  it("SAFETY_PLC_ADAPTER off → {state:'UNKNOWN', source:'none'}", async () => {
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(s.state).toBe("UNKNOWN");
    expect(s.source).toBe("none");
  });

  it("enabled + clean PLC read → OK (source safety_plc)", async () => {
    plcEnabled = true;
    plcConfigs = [{ code: "PLC1", __status: {} }];
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(s.state).toBe("OK");
    expect(s.source).toBe("safety_plc");
  });

  it("active safety flag (estop) → BLOCKED with the PLC named in source", async () => {
    plcEnabled = true;
    plcConfigs = [{ code: "PLC1", __status: { estop: true } }];
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(s.state).toBe("BLOCKED");
    expect(s.source).toBe("safety_plc:PLC1");
  });

  it("every configured read failing → UNKNOWN (never fabricates OK)", async () => {
    plcEnabled = true;
    plcConfigs = [{ code: "PLC1", __throw: true }];
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(s.state).toBe("UNKNOWN");
  });

  it("enabled but zero configs → UNKNOWN 'none'", async () => {
    plcEnabled = true;
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(s.state).toBe("UNKNOWN");
    expect(s.source).toBe("none");
  });

  it("driver implementing getSafetyStatus → delegated", async () => {
    const delegated = vi.fn(async () => ({ state: "OK" as const, source: "driver", ts: new Date().toISOString() }));
    currentDriver = { ...currentDriver, getSafetyStatus: delegated };
    const facade = createAdapterFacade({ adapterId: 10 });
    const s = await facade.getSafetyStatus();
    expect(delegated).toHaveBeenCalledTimes(1);
    expect(s.source).toBe("driver");
  });
});
