/**
 * Doc 56 Đ1 (nhóm B) — submitProcessResult / submitProcessResultBatch tests.
 *
 * The generic PROCESS FEED ("ST4I Standard Process Feed v1"): a machine-credential,
 * durable, idempotent path for the OUTCOME of any automation cycle. This drives the
 * REAL tRPC router + the REAL processResultService ledger against a mocked `../db`
 * that reproduces the semantics that matter:
 *   • api_keys lookup empty ⇒ auth falls through to shared-key / machineCode,
 *   • process_step_types lookup (stepType vocabulary validation),
 *   • the process_idempotency_keys CLAIM/BACK-FILL protocol (exactly-once), keyed
 *     (machineId, idempotencyKey) — a retry resolves to the ORIGINAL row,
 *   • the plain process_results insert (no-key path) + genealogy append.
 *
 * Covered: submit 200 (machineCode + shared key) when the flag is ON; retry with the
 * SAME idempotencyKey ⇒ exactly ONE row; batch per-item isolation (one item's
 * failure never fails the batch); naive `ts` rejected (API-10); flag OFF ⇒
 * PRECONDITION_FAILED; unknown stepType in log mode ⇒ still written + warned;
 * enforce mode ⇒ rejected; transient DB failure + store-forward ⇒ ACK queued.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// ── Mock the DB barrel: auth lookups + the idempotency ledger + inserts ──────
vi.mock("../db", () => {
  // drizzle stamps the table name on an internal Symbol; read it to route calls.
  const nameOf = (table: unknown): string => {
    if (!table) return "";
    const sym = Object.getOwnPropertySymbols(table as object).find((s) => String(s).includes("Name"));
    return sym ? String((table as Record<symbol, unknown>)[sym]) : "";
  };

  const state = {
    /** process_step_types lookup returns a row when true (known stepType). */
    stepTypeKnown: true,
    /** "machineId|idempotencyKey" → resultId (null while the claim is unresolved). */
    ledger: new Map<string, number | null>(),
    /** The last ledger key touched by an insert — the following select/update target it. */
    lastLedgerKey: null as string | null,
    /** Count of REAL process_results rows inserted (both the tx path and the plain path). */
    processInserts: 0,
    nextResultId: 5000,
    /** insertProcessResult throws this when set (transient DB-down simulation). */
    insertThrows: null as Error | null,
  };

  const makeRunner = () => ({
    insert: (table: unknown) => {
      const t = nameOf(table);
      return {
        values: (data: any) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (t === "process_idempotency_keys") {
                const k = `${data.machineId}|${data.idempotencyKey}`;
                state.lastLedgerKey = k;
                if (state.ledger.has(k)) return []; // PK conflict → claim LOST
                state.ledger.set(k, null); // claim WON
                return [{ machineId: data.machineId }];
              }
              return [];
            },
          }),
          returning: async () => {
            if (t === "process_results") {
              state.processInserts += 1;
              return [{ id: state.nextResultId++ }];
            }
            return [];
          },
        }),
      };
    },
    select: (_proj?: unknown) => ({
      from: (table: unknown) => {
        const t = nameOf(table);
        return {
          where: () => ({
            limit: async () => {
              if (t === "process_idempotency_keys") {
                const k = state.lastLedgerKey;
                return k && state.ledger.has(k) ? [{ resultId: state.ledger.get(k) ?? null }] : [];
              }
              if (t === "process_step_types") {
                return state.stepTypeKnown ? [{ code: "known" }] : [];
              }
              return []; // api_keys (auth) → empty ⇒ fall through to shared/machineCode
            },
            orderBy: () => ({ limit: async () => [] }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (data: any) => ({
        where: async () => {
          if (nameOf(table) === "process_idempotency_keys" && state.lastLedgerKey != null) {
            state.ledger.set(state.lastLedgerKey, data?.resultId ?? null);
          }
        },
      }),
    }),
  });

  const fakeDb = {
    ...makeRunner(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeRunner()),
  };

  return {
    __state: state,
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    insertProcessResult: vi.fn(async (_row: any) => {
      if (state.insertThrows) throw state.insertThrows;
      state.processInserts += 1;
      return state.nextResultId++;
    }),
    appendGenealogyChainRow: vi.fn(async (builder: any) => {
      const r = typeof builder === "function" ? builder("genesis-hash") : {};
      return { id: 1, prevHash: r.prevHash ?? "genesis-hash", currHash: r.currHash ?? "curr-hash" };
    }),
  };
});

// Inspection-path side-effect surfaces the router imports at load time (unused here).
vi.mock("../_core/socket", () => ({
  emitNGAlert: vi.fn(),
  emitYieldWarning: vi.fn(),
  emitDashboardUpdate: vi.fn(),
}));
vi.mock("../services/mqttService", () => ({
  publishNGAlert: vi.fn(async () => undefined),
  publishPointsConfigChanged: vi.fn(async () => undefined),
}));
vi.mock("../services/integration/outboxProducers", () => ({
  publishToOutbox: vi.fn(),
}));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import { _resetMachineAuthState } from "../services/machineAuthService";
import { _resetProcessStoreForward } from "../services/process/processStoreForward";
import type { TrpcContext } from "../_core/context";

type MockState = {
  stepTypeKnown: boolean;
  ledger: Map<string, number | null>;
  lastLedgerKey: string | null;
  processInserts: number;
  nextResultId: number;
  insertThrows: Error | null;
};
const state = (db as unknown as { __state: MockState }).__state;

const MACHINE = { id: 5, code: "SCREW-01", name: "Screwdriver 01", stationId: 1, isActive: true };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    machineCode: "SCREW-01",
    serialNumber: "SN-PR-1",
    stepType: "screw_tightening",
    result: "pass" as const,
    ts: "2026-07-15T08:00:00+07:00",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.PROCESS_RESULT_INGEST_ENABLED = "true"; // ON for most tests; individual tests flip OFF
  process.env.PROCESS_STORE_FORWARD_ENABLED = "false";
  delete process.env.PROCESS_ATTR_VALIDATE_MODE; // default off
  delete process.env.PROCESS_WAVEFORM_MAX_BYTES;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.MACHINE_INGEST_BATCH_CONCURRENCY;
  // Hermetic WAL file (only touched when store-forward is ON in one test).
  process.env.PROCESS_STORE_FORWARD_FILE = path.join(os.tmpdir(), `proc-sf-${process.pid}-${Date.now()}.jsonl`);

  vi.clearAllMocks();
  _resetMachineAuthState();
  _resetProcessStoreForward();
  state.stepTypeKnown = true;
  state.ledger.clear();
  state.lastLedgerKey = null;
  state.processInserts = 0;
  state.nextResultId = 5000;
  state.insertThrows = null;

  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
});

afterEach(() => {
  _resetProcessStoreForward();
});

describe("submitProcessResult — machine-credential ingest (doc 56 Đ1 nhóm B)", () => {
  it("cờ ON: submit qua machineCode → success + processResultId, ghi 1 row", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitProcessResult(envelope());
    expect(res.success).toBe(true);
    expect(typeof (res as { processResultId: number }).processResultId).toBe("number");
    expect(state.processInserts).toBe(1);
    expect(db.updateMachineHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("cờ ON: submit qua shared apiKey cũng success", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitProcessResult(
      envelope({ machineCode: undefined, apiKey: "SHARED-KEY" }),
    );
    expect(res.success).toBe(true);
    expect(state.processInserts).toBe(1);
  });

  it("★ retry cùng idempotencyKey → 1 row duy nhất, lần 2 duplicate + cùng id", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const body = envelope({ idempotencyKey: "cycle-uuid-0001-abcd" });

    const first = await caller.submitProcessResult(body);
    const second = await caller.submitProcessResult(body); // machine ACK-timeout retry

    // Exactly ONE process_results row inserted despite two submits.
    expect(state.processInserts).toBe(1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect((first as { duplicate?: boolean }).duplicate).toBeUndefined();
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);
    expect((second as { processResultId: number }).processResultId).toBe(
      (first as { processResultId: number }).processResultId,
    );
    // The duplicate short-circuits BEFORE the genealogy append (no chain fork).
    expect(db.appendGenealogyChainRow).toHaveBeenCalledTimes(1);
  });

  it("idempotencyKey KHÁC nhau → 2 row (chống-trùng không chặn nhầm cycle thật)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitProcessResult(envelope({ idempotencyKey: "cycle-aaaa-0001" }));
    await caller.submitProcessResult(envelope({ serialNumber: "SN-PR-2", idempotencyKey: "cycle-bbbb-0002" }));
    expect(state.processInserts).toBe(2);
  });

  it("cờ OFF → PRECONDITION_FAILED, KHÔNG chạm DB", async () => {
    process.env.PROCESS_RESULT_INGEST_ENABLED = "false";
    const caller = machineApiRouter.createCaller(ctx());
    await expect(caller.submitProcessResult(envelope())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(state.processInserts).toBe(0);
    expect(db.updateMachineHeartbeat).not.toHaveBeenCalled();
  });

  it("ts naive (không offset) → BAD_REQUEST (API-10), KHÔNG ghi", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitProcessResult(envelope({ ts: "2026-07-15T08:00:00" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.processInserts).toBe(0);
  });

  it("không gửi ts → server đóng dấu, timeSource='server', vẫn ghi", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitProcessResult(envelope({ ts: undefined }));
    expect(res.success).toBe(true);
    expect(state.processInserts).toBe(1);
  });

  it("metrics envelope [{name,value,lsl,usl}] được nhận (map ở service, không nổ)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitProcessResult(
      envelope({
        metrics: [
          { name: "torque", value: 1.23, unit: "Nm", lsl: 1.0, usl: 1.5, nominal: 1.25 },
          { name: "angle", value: 380 },
        ],
      }),
    );
    expect(res.success).toBe(true);
    expect(state.processInserts).toBe(1);
  });
});

describe("submitProcessResult — stepType vocabulary (PROCESS_ATTR_VALIDATE_MODE)", () => {
  it("stepType lạ + mode=log → VẪN ghi + cảnh báo", async () => {
    process.env.PROCESS_ATTR_VALIDATE_MODE = "log";
    state.stepTypeKnown = false; // process_step_types lookup returns []
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitProcessResult(envelope({ stepType: "unknown_step_xyz" }));

    expect(res.success).toBe(true);
    expect(state.processInserts).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stepType lạ + mode=enforce → BAD_REQUEST, KHÔNG ghi", async () => {
    process.env.PROCESS_ATTR_VALIDATE_MODE = "enforce";
    state.stepTypeKnown = false;
    const caller = machineApiRouter.createCaller(ctx());

    await expect(
      caller.submitProcessResult(envelope({ stepType: "unknown_step_xyz" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.processInserts).toBe(0);
  });

  it("stepType hợp lệ + mode=enforce → ghi bình thường", async () => {
    process.env.PROCESS_ATTR_VALIDATE_MODE = "enforce";
    state.stepTypeKnown = true;
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitProcessResult(envelope());
    expect(res.success).toBe(true);
    expect(state.processInserts).toBe(1);
  });
});

describe("submitProcessResult — durability (PROCESS_STORE_FORWARD_ENABLED)", () => {
  it("lỗi DB thoáng qua + store-forward ON → ACK queued (không mất cycle)", async () => {
    process.env.PROCESS_STORE_FORWARD_ENABLED = "true";
    state.insertThrows = new Error("db connection lost"); // transient
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitProcessResult(envelope());

    expect(res.success).toBe(true);
    expect((res as { queued?: boolean }).queued).toBe(true);
    expect((res as { submissionId?: string }).submissionId).toBeTruthy();
    expect((res as { processResultId: number | null }).processResultId).toBeNull();
  });

  it("lỗi DB thoáng qua + store-forward OFF → NỔ lỗi (không nuốt)", async () => {
    state.insertThrows = new Error("db connection lost");
    const caller = machineApiRouter.createCaller(ctx());
    await expect(caller.submitProcessResult(envelope())).rejects.toThrow(/db connection lost/);
  });
});

describe("submitProcessResultBatch — per-item isolation + idempotency", () => {
  it("batch 3 (good / lỗi-waveform / good) → 2 succeeded, 1 failed, KHÔNG kéo cả batch", async () => {
    process.env.PROCESS_WAVEFORM_MAX_BYTES = "10"; // tiny cap → the waveform item fails
    process.env.MACHINE_INGEST_BATCH_CONCURRENCY = "1"; // deterministic order
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitProcessResultBatch({
      machineCode: "SCREW-01",
      results: [
        envelope({ serialNumber: "B-1" }),
        envelope({ serialNumber: "B-2", waveforms: [{ name: "w", samples: [[0, 0], [1, 1]] }] }),
        envelope({ serialNumber: "B-3" }),
      ],
    });

    expect(res.submitted).toBe(3);
    expect(res.results[0]).toMatchObject({ index: 0, success: true });
    expect(res.results[1]).toMatchObject({ index: 1, success: false });
    expect(res.results[1].error).toBeTruthy();
    expect(res.results[2]).toMatchObject({ index: 2, success: true });
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    // Only the two good cycles reached the DB.
    expect(state.processInserts).toBe(2);
    // ONE heartbeat for the whole batch (not one per item).
    expect(db.updateMachineHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("batch giữ idempotency: cùng idempotencyKey ở 2 batch → chỉ 1 row", async () => {
    process.env.MACHINE_INGEST_BATCH_CONCURRENCY = "1";
    const caller = machineApiRouter.createCaller(ctx());
    const item = envelope({ serialNumber: "B-DUP", idempotencyKey: "batch-cycle-0001" });

    const first = await caller.submitProcessResultBatch({ machineCode: "SCREW-01", results: [item] });
    expect(first.succeeded).toBe(1);
    expect(state.processInserts).toBe(1);

    const second = await caller.submitProcessResultBatch({ machineCode: "SCREW-01", results: [item] });
    expect(second.results[0]).toMatchObject({ success: true, duplicate: true });
    expect(second.duplicates).toBe(1);
    // Still exactly one row across both batches.
    expect(state.processInserts).toBe(1);
  });

  it("batch rate-limit charged PER item: limit=2, 4 item → 2 OK, 2 rateLimited", async () => {
    process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "2";
    process.env.MACHINE_INGEST_BATCH_CONCURRENCY = "1";
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitProcessResultBatch({
      machineCode: "SCREW-01",
      results: [
        envelope({ serialNumber: "R-1" }),
        envelope({ serialNumber: "R-2" }),
        envelope({ serialNumber: "R-3" }),
        envelope({ serialNumber: "R-4" }),
      ],
    });

    expect(res.results[0].success).toBe(true);
    expect(res.results[1].success).toBe(true);
    expect(res.results[2]).toMatchObject({ success: false, rateLimited: true });
    expect(res.results[3]).toMatchObject({ success: false, rateLimited: true });
    expect(res.succeeded).toBe(2);
    expect(state.processInserts).toBe(2);
  });

  it("cờ OFF → batch cũng PRECONDITION_FAILED", async () => {
    process.env.PROCESS_RESULT_INGEST_ENABLED = "false";
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitProcessResultBatch({ machineCode: "SCREW-01", results: [envelope()] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("empty batch bị zod từ chối (min 1)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitProcessResultBatch({ machineCode: "SCREW-01", results: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
