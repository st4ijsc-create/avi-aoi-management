/**
 * SCADA R1b-2b-2b A — C2 fix round 4 (review fix 3 M1, điều phối 2026-11-01) — `edgeDeployment.getUnifiedFleetStatus` (adminProcedure).
 *
 * Trước: trả `deviceAdapters.adapters[*].endpoint` / `lastError` THÔ cho MỌI admin, kể cả admin KHÔNG có `machine_control.canEdit` (có thật khi bật
 * admin có phạm vi) — trái luật HAI điều kiện (admin|engineer VÀ canEdit) mà mọi bề mặt khác dùng. Nay che bằng CÙNG `redactAdapterRow` +
 * `maLoiAdapterCua` + `tamKhoaAdapter`, quyết bằng `chiTietKyThuatCua`.
 * Router tRPC THẬT (createCaller); chỉ thay ranh giới: dữ liệu fleet (fleetStatusService) và quyền (`checkPermission`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const tt = vi.hoisted(() => ({ coSua: true }));
vi.mock("../_core/accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_core/accessControl")>()),
  checkPermission: async (_id: number, _role: string, module: string, action: string) => module === "machine_control" && action === "canEdit" && tt.coSua,
}));
vi.mock("../services/fleetStatusService", () => ({
  getUnifiedFleetStatus: async () => ({
    generatedAt: "2026-11-01T00:00:00.000Z",
    deployments: {},
    edgeNodes: { total: 0 },
    deviceAdapters: {
      total: 2,
      enabled: 1,
      connected: 1,
      byProtocol: { modbus: 2 },
      byStatus: { error: 1, connected: 1 },
      adapters: [
        { id: 1, code: "AD-1", name: "AD-1", machineId: 3, protocol: "modbus", endpoint: "tcp://10.9.8.7:5020", status: "error", isEnabled: true, lastConnectedAt: null, lastError: "SENTINEL-10.9.8.7:5020-xyz ECONNREFUSED" },
        { id: 2, code: "AD-2", name: "AD-2", machineId: 3, protocol: "modbus", endpoint: "tcp://10.9.8.7:5021", status: "connected", isEnabled: false, lastConnectedAt: null, lastError: null },
      ],
    },
    summary: { totalEndpoints: 2, onlineEndpoints: 1, offlineEndpoints: 1 },
  }),
}));

import { edgeDeploymentRouter } from "./edgeDeploymentRouter";

const admin = () => edgeDeploymentRouter.createCaller({ user: { id: 1, role: "admin", name: "a", twoFactorEnabled: true } } as never);

describe("C2 fix 4 — getUnifiedFleetStatus che endpoint / lastError với admin KHÔNG có machine_control.canEdit", () => {
  beforeEach(() => {
    tt.coSua = true;
  });

  it("★★★ admin không canEdit (admin có phạm vi): không SENTINEL / 10.9.8.7 / :5020; endpoint null; lastError = MÃ; số tổng không đổi", async () => {
    // ở sản xuất: RBAC_SCOPED_ADMIN=true ⇒ admin không còn "god-mode", checkPermission đọc bảng permissions; ở đây ranh giới quyền trả false
    tt.coSua = false;
    const s = (await admin().getUnifiedFleetStatus()) as any;
    const t = JSON.stringify(s);
    expect(t).not.toMatch(/SENTINEL|10\.9\.8\.7|:5020/);
    expect(s.deviceAdapters.adapters[0]).toMatchObject({ id: 1, endpoint: null, connectionOptions: null, lastError: "ADAPTER_OFFLINE", maLoi: "ADAPTER_OFFLINE", tamKhoa: null });
    expect(s.deviceAdapters.adapters[1]).toMatchObject({ id: 2, endpoint: null, lastError: null, maLoi: null });
    expect(s.deviceAdapters).toMatchObject({ total: 2, enabled: 1, connected: 1 });
  });

  it("đối chứng: admin có canEdit ⇒ nguyên văn", async () => {
    const s = (await admin().getUnifiedFleetStatus()) as any;
    expect(s.deviceAdapters.adapters[0]).toMatchObject({ endpoint: "tcp://10.9.8.7:5020", lastError: "SENTINEL-10.9.8.7:5020-xyz ECONNREFUSED" });
  });
});
