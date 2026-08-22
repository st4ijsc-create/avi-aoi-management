/**
 * WS-2 — Machine-facing edge endpoints auth tests (via tRPC caller).
 *
 *   - checkModelVersion / getModelPackage with an invalid apiKey → UNAUTHORIZED
 *   - getModelPackage for a deployment NOT owned by the machine → FORBIDDEN
 *
 * Mocks the `./db` barrel (getMachineByApiKey etc.) and `./db/aiAdvanced`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// ── Xác thực: KHAI BÁO TƯỜNG MINH, không mượn mặc định ───────────────────────────
// Các ca trong file này đo LOGIC INGEST (gate, phân loại lỗi, phạm vi ghi…), không đo
// xác thực. Từ 2026-08-22 (mig 0334) hai đường yếu mặc định `deny`, nên nền mà chúng
// vẫn ngầm dựa vào không còn nữa.
//
// ⚠ Một bộ test mượn mặc định ngầm là một bộ test sẽ NÓI DỐI vào ngày mặc định đổi:
// nó đỏ vì một lý do hoàn toàn khác thứ nó đang canh, và người đọc kết quả sẽ đi sửa
// nhầm chỗ. Khai ra đây thì mỗi file tự nói mình đang đứng trên nền nào.
//
// Đường MẠNH (khoá `mk_` riêng từng máy) có test riêng, KHÔNG bị nới ở đây:
//   server/routers/machineApiBatchIngest.test.ts
process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
process.env.MACHINE_CODE_ONLY_ALLOWED = "true";

vi.mock("./db", () => ({
  getMachineByApiKey: vi.fn(),
  getMachineByCode: vi.fn(),
  updateMachineHeartbeat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./db/aiAdvanced");
// Keep the service layer out of these auth-focused tests.
vi.mock("./services/aiEdgeEnhanced", () => ({
  confirmDeployment: vi.fn(),
  recordEdgeHeartbeat: vi.fn(),
  syncEdgeResults: vi.fn(),
}));

import { appRouter } from "./routers";
import * as db from "./db";
import * as aiAdvancedDb from "./db/aiAdvanced";
import type { TrpcContext } from "./_core/context";

function anonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("machineApi edge endpoints — auth", () => {
  it("checkModelVersion with invalid apiKey → UNAUTHORIZED", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.machineApi.checkModelVersion({ apiKey: "bad-key" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("getModelPackage with invalid apiKey → UNAUTHORIZED", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.machineApi.getModelPackage({ apiKey: "bad-key", deploymentId: 1 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("getModelPackage for a deployment owned by another machine → FORBIDDEN", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue({ id: 7, code: "MACH-A" });
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      id: 1, machineId: 99, deviceId: "MACH-B",
      packageKey: "k", packageHash: "h", status: "READY",
    });
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.machineApi.getModelPackage({ apiKey: "key-A", deploymentId: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getModelPackage returns proxy downloadUrl (never a raw storage URL) for owner", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue({ id: 7, code: "MACH-A" });
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      id: 1, machineId: 7, deviceId: "MACH-A", modelId: 10, modelVersion: "v1",
      packageKey: "models/edge-packages/10/v1.pkg", packageHash: "abc",
      packageSize: 123, packageVersion: "v1", status: "READY", deployConfig: { runtime: "ONNX" },
    });
    (aiAdvancedDb.updateEdgeDeployment as any).mockResolvedValue({});
    (aiAdvancedDb.getEdgeDeployments as any).mockResolvedValue([]);
    (aiAdvancedDb.getEdgeDeploymentsByDevice as any).mockResolvedValue([]);

    const caller = appRouter.createCaller(anonCtx());
    const r = await caller.machineApi.getModelPackage({ apiKey: "key-A", deploymentId: 1 });
    expect(r.downloadUrl).toBe("/api/edge/download/1");
    expect(r.packageHash).toBe("abc");
    // Must NOT leak the storage key/url directly.
    expect(JSON.stringify(r)).not.toContain("models/edge-packages");
  });
});
