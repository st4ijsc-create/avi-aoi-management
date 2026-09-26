/**
 * doc 56 nhóm C — /api/v1 ingest RESULT + TELEMETRY tests.
 *
 * Covers the two NEW ingest surfaces added alongside inspection:
 *   • POST /api/v1/ingest/process-result — reuses machineApi.submitProcessResult
 *     (mocked), 201 envelope, machine-principal machineCode adoption, honest error
 *     statuses (doc 81 Đợt 1B Task 8: data 400 · 429 + Retry-After · DB 503).
 *   • POST /api/v1/ingest/telemetry — versioned alias of POST /api/ot/ingest,
 *     funnels into ingestTelemetryDetailed (mocked) with normalized CanonicalSample[],
 *     202 when every sample is stored; 207/400/503 otherwise (Task 8).
 *   • openapi.json exposes both new paths + their component schemas.
 *
 * Runs against a real Express app on an ephemeral port using global `fetch`
 * (mirrors apiV1.test.ts — supertest is not a dependency here).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted so they exist when the module factories run) ──────────────
const h = vi.hoisted(() => ({
  submitProcessResultMock: vi.fn(async (_input: Record<string, unknown>) => ({ success: true, processResultId: 999 })),
  submitInspectionMock: vi.fn(async () => ({ success: true, inspectionId: 123 })),
  ingestTelemetryMock: vi.fn(async (samples: unknown[]) => ({
    received: samples.length,
    accepted: samples.length,
    rejected: [] as Array<{ index: number; reason: string }>,
  })),
  // Lỗi mà thủ tục tRPC THẬT (dưới) sẽ ném — để lỗi tới route đúng hình dạng tRPC bọc ra.
  loiThuTuc: null as unknown,
}));

// doc 81 Đợt 1B Task 8 — "MACHINE_KEY" là khoá plaintext `machines.apiKey`; nay /api/v1 tôn trọng
// MACHINE_SHARED_KEY_ALLOWED (mặc định "deny"). Tệp này đo ingest cho máy-principal nên mở cờ.
process.env.MACHINE_SHARED_KEY_ALLOWED = "true";

// Master key validation: accept only "MASTER" in tests.
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// DB layer the router/auth depend on.
const MACHINE = {
  id: 1,
  code: "AOI-01",
  name: "AOI One",
  machineType: "AOI",
  operationStatus: "running",
  capabilities: null,
  stationId: 5,
  apiKey: "MACHINE_KEY",
};
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null), // no api_keys table in test → only master/machine paths
  getMachineById: vi.fn(async (id: number) => (id === 1 ? MACHINE : undefined)),
  getMachines: vi.fn(async () => [MACHINE]),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? MACHINE : undefined)),
}));

// Ingest reuses the tRPC callers (process-result + inspection).
vi.mock("../../routers", () => ({
  appRouter: {
    createCaller: () => ({
      machineApi: {
        submitProcessResult: h.submitProcessResultMock,
        submitInspection: h.submitInspectionMock,
      },
    }),
  },
}));
vi.mock("../../_core/context", () => ({ createContext: vi.fn(async () => ({})) }));

// Telemetry alias funnels into the unified bus (mocked — no DB touched).
vi.mock("../../services/telemetryBus", () => ({
  ingestTelemetryDetailed: h.ingestTelemetryMock,
}));

import { createV1Router } from "./router";
import { initTRPC } from "@trpc/server";
import { appError } from "../../_core/appError";
import { DbUnavailableError } from "../../_core/dbErrors";

/**
 * Oracle ĐỘC LẬP cho hình dạng lỗi: một router tRPC THẬT (initTRPC) có thủ tục ném `h.loiThuTuc`.
 * `createCaller` của tRPC tự bọc lỗi (lỗi thường ⇒ TRPCError INTERNAL_SERVER_ERROR, cause = gốc) —
 * y như `appRouter.createCaller(ctx).machineApi.submitProcessResult` ở production.
 */
const tt = initTRPC.create();
const thuTucThat = tt.router({
  p: tt.procedure.mutation(() => {
    throw h.loiThuTuc;
  }),
});
const goiThuTucThat = () => thuTucThat.createCaller({}).p();

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, init?: RequestInit & { key?: string }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.key) headers["authorization"] = `Bearer ${init.key}`;
  return fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
}

const VALID_PROCESS = {
  schemaVersion: "1.0",
  machineCode: "AOI-01",
  serialNumber: "SN-2002",
  stepType: "press-fit",
  result: "pass",
  ts: "2026-07-17T08:00:00+07:00",
  metrics: [{ name: "force", value: 1220.5, unit: "N" }],
};

describe("/api/v1/ingest/process-result", () => {
  it("no key → 401 envelope", async () => {
    const res = await call("/api/v1/ingest/process-result", { method: "POST", body: JSON.stringify(VALID_PROCESS) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthorized");
  });

  it("reuses submitProcessResult (mocked) → 201", async () => {
    h.submitProcessResultMock.mockClear();
    const res = await call("/api/v1/ingest/process-result", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify(VALID_PROCESS),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.processResultId).toBe(999);
    expect(h.submitProcessResultMock).toHaveBeenCalledTimes(1);
  });

  it("machine-credential caller adopts its machineCode when the body omits it", async () => {
    h.submitProcessResultMock.mockClear();
    const { machineCode, ...noCode } = VALID_PROCESS;
    const res = await call("/api/v1/ingest/process-result", {
      key: "MACHINE_KEY", // resolves to a machine principal (scope ingest:write, name = AOI-01)
      method: "POST",
      body: JSON.stringify(noCode),
    });
    expect(res.status).toBe(201);
    const arg = h.submitProcessResultMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.machineCode).toBe("AOI-01");
  });

  // doc 81 Đợt 1B Task 8 — ca cũ ném `new Error("boom")` TRẦN và khẳng định 400. Ở production lỗi
  // không tới route ở dạng ấy: caller tRPC bọc lỗi thường thành INTERNAL_SERVER_ERROR (DB sập, mất
  // kết nối…) — và gộp nó thành 400 chính là lỗi đã đo (SDK vứt bản ghi). Nay mọi ca đi qua thủ tục
  // tRPC THẬT để lỗi mang đúng hình dạng production.
  async function guiVoiLoi(loi: unknown) {
    h.loiThuTuc = loi;
    h.submitProcessResultMock.mockImplementationOnce(goiThuTucThat as never);
    const res = await call("/api/v1/ingest/process-result", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify(VALID_PROCESS),
    });
    return { res, body: await res.json() };
  }

  it("lỗi DỮ LIỆU (BAD_REQUEST) → 400 ingest_failed", async () => {
    const { res, body } = await guiVoiLoi(
      appError("BAD_REQUEST", "INVALID_VALUE", { field: "stepType" }, "boom: bad payload"),
    );
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("ingest_failed");
    expect(body.error.message).toContain("boom");
  });

  it("★ DB sập (DbUnavailableError qua tRPC ⇒ INTERNAL_SERVER_ERROR) → 503, không phải 400", async () => {
    const { res, body } = await guiVoiLoi(new DbUnavailableError());
    expect(res.status).toBe(503);
    expect(body.error.code).toBe("ingest_unavailable");
  });

  it("lỗi thường không phân loại (mất kết nối…) → 503", async () => {
    const { res } = await guiVoiLoi(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { code: "ECONNREFUSED" }),
    );
    expect(res.status).toBe(503);
  });

  it("Postgres từ chối DỮ LIỆU (SQLSTATE 22001 ở cause) → 400 (gửi lại vô ích)", async () => {
    const { res } = await guiVoiLoi(Object.assign(new Error("value too long"), { code: "22001" }));
    expect(res.status).toBe(400);
  });

  it("★ quá tần suất (TOO_MANY_REQUESTS) → 429 + Retry-After", async () => {
    const { res, body } = await guiVoiLoi(
      appError("TOO_MANY_REQUESTS", "RATE_LIMITED", undefined, "Ingest rate limit exceeded"),
    );
    expect(res.status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("UNAUTHORIZED → 401, FORBIDDEN → 403 (không còn giả làm lỗi dữ liệu)", async () => {
    const r401 = await guiVoiLoi(appError("UNAUTHORIZED", "MACHINE_CREDENTIAL_INVALID", undefined, "Invalid API key"));
    expect(r401.res.status).toBe(401);
    const r403 = await guiVoiLoi(appError("FORBIDDEN", "PERMISSION_DENIED", { action: "machineScope" }, "no scope"));
    expect(r403.res.status).toBe(403);
  });

  it("★ khoá máy (AOI-01) khai machineCode của máy KHÁC → 403, submitProcessResult KHÔNG được gọi", async () => {
    h.submitProcessResultMock.mockClear();
    const res = await call("/api/v1/ingest/process-result", {
      key: "MACHINE_KEY",
      method: "POST",
      body: JSON.stringify({ ...VALID_PROCESS, machineCode: "SCRW-SIM-01" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("machine_mismatch");
    expect(h.submitProcessResultMock).not.toHaveBeenCalled();
  });
});

describe("/api/v1/ingest/inspection — mã HTTP đúng nghĩa + ràng buộc (doc 81 Đợt 1B Task 8)", () => {
  it("★ DB sập → 503 (trước: 400 ⇒ SDK vứt bản ghi)", async () => {
    h.loiThuTuc = new DbUnavailableError();
    h.submitInspectionMock.mockImplementationOnce(goiThuTucThat as never);
    const res = await call("/api/v1/ingest/inspection", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ serialNumber: "SN-1", overallResult: "OK", measurements: [] }),
    });
    expect(res.status).toBe(503);
  });

  it("★ khoá máy AOI-01 khai machineCode khác → 403, submitInspection KHÔNG được gọi", async () => {
    h.submitInspectionMock.mockClear();
    const res = await call("/api/v1/ingest/inspection", {
      key: "MACHINE_KEY",
      method: "POST",
      body: JSON.stringify({ machineCode: "AOI-99", serialNumber: "SN-1", overallResult: "OK", measurements: [] }),
    });
    expect(res.status).toBe(403);
    expect(h.submitInspectionMock).not.toHaveBeenCalled();
  });

  it("khoá máy AOI-01 khai CHÍNH mã mình → 201 (đường hợp lệ không bị chặn oan)", async () => {
    const res = await call("/api/v1/ingest/inspection", {
      key: "MACHINE_KEY",
      method: "POST",
      body: JSON.stringify({ machineCode: "AOI-01", serialNumber: "SN-1", overallResult: "OK", measurements: [] }),
    });
    expect(res.status).toBe(201);
  });
});

describe("/api/v1/ingest/telemetry (alias of POST /api/ot/ingest)", () => {
  it("normalizes samples into the unified bus → 202", async () => {
    h.ingestTelemetryMock.mockClear();
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({
        samples: [
          { deviceId: "dev-9", metric: "temperature", value: 42.5, unit: "C", protocol: "modbus", quality: "good" },
          { metric: "pressure", value: 1.2, protocol: "WEIRD" }, // unknown protocol → normalized to "other"
        ],
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.received).toBe(2);
    expect(body.data.accepted).toBe(2);
    expect(h.ingestTelemetryMock).toHaveBeenCalledTimes(1);
    const samples = h.ingestTelemetryMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(samples[0].metric).toBe("temperature");
    expect(samples[0].protocol).toBe("modbus");
    expect(samples[0].deviceId).toBe("dev-9");
    expect(samples[1].protocol).toBe("other"); // normalized
    expect(samples[1].quality).toBe("good"); // defaulted
  });

  it("accepts a bare array body too", async () => {
    h.ingestTelemetryMock.mockClear();
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify([{ metric: "rpm", value: 3000, protocol: "opcua" }]),
    });
    expect(res.status).toBe(202);
    expect(h.ingestTelemetryMock).toHaveBeenCalledTimes(1);
  });

  it("★ khoá máy AOI-01 (id 1) gửi mẫu machineId = 2 → 403, bus KHÔNG được gọi", async () => {
    h.ingestTelemetryMock.mockClear();
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MACHINE_KEY",
      method: "POST",
      body: JSON.stringify({ samples: [{ machineId: 2, metric: "t", value: 1 }] }),
    });
    expect(res.status).toBe(403);
    expect(h.ingestTelemetryMock).not.toHaveBeenCalled();
  });

  it("khoá máy AOI-01 gửi deviceId = chính mã mình → 202 {accepted, received, machine}", async () => {
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MACHINE_KEY",
      method: "POST",
      body: JSON.stringify({ samples: [{ deviceId: "AOI-01", metric: "t", value: 1 }] }),
    });
    expect(res.status).toBe(202);
    expect((await res.json()).data).toEqual({ accepted: 1, received: 1, machine: "AOI-01" });
  });

  it("★ lưu một phần → 207 kèm rejected[] (không bao giờ 2xx ok:true khi accepted < received)", async () => {
    h.ingestTelemetryMock.mockResolvedValueOnce({ received: 2, accepted: 1, rejected: [{ index: 0, reason: "invalid_ts" }] });
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ samples: [{ metric: "a", value: 1 }, { metric: "b", value: 2 }] }),
    });
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("partial");
    expect(body.error.details.rejected).toEqual([{ index: 0, reason: "invalid_ts" }]);
  });

  it("★ không mẫu nào lưu vì DB → 503; không mẫu nào lưu vì dữ liệu → 400", async () => {
    h.ingestTelemetryMock.mockResolvedValueOnce({ received: 1, accepted: 0, rejected: [{ index: 0, reason: "db_error" }] });
    const r1 = await call("/api/v1/ingest/telemetry", { key: "MASTER", method: "POST", body: JSON.stringify([{ metric: "a", value: 1 }]) });
    expect(r1.status).toBe(503);
    h.ingestTelemetryMock.mockResolvedValueOnce({ received: 1, accepted: 0, rejected: [{ index: 0, reason: "invalid_ts" }] });
    const r2 = await call("/api/v1/ingest/telemetry", { key: "MASTER", method: "POST", body: JSON.stringify([{ metric: "a", value: 1 }]) });
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe("all_rejected");
  });

  it("empty samples → 400 bad_request", async () => {
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ samples: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });
});

describe("/api/v1/openapi.json exposes the new ingest paths", () => {
  it("documents process-result + telemetry with their component schemas", async () => {
    const res = await call("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths["/api/v1/ingest/process-result"].post).toBeTruthy();
    expect(spec.paths["/api/v1/ingest/telemetry"].post).toBeTruthy();
    expect(spec.components.schemas.ProcessResultIngest).toBeTruthy();
    expect(spec.components.schemas.TelemetryIngest).toBeTruthy();
    expect(spec.components.schemas.TelemetrySample).toBeTruthy();
  });
});
