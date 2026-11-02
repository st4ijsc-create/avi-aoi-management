/**
 * `machine.approve` / `machine.reject` — ★★★ F5-nhanh: kiểm PHẠM VI MÁY (kiemPhamViDuyetMay, CÙNG hàm với socket).
 *
 * Lỗ được ghim (có từ trước F5-nhanh): `MACHINE_APPROVE_RBAC_OPEN_ENABLED=true` cho người KHÔNG phải admin có permission bit
 * `machine_registration` duyệt máy; trước bản vá thủ tục không kiểm phạm vi ⇒ người quản trị đăng ký của nhà máy A duyệt (và phát
 * giấy tờ / khoá) cho máy của nhà máy B, hoặc chuyển máy A sang trạm của nhà máy B qua `stationId`.
 *
 * Không CSDL: `../db` giả (như machineApproveGiayToImLang.test.ts) + seam `__datBoTraPhamViDuyetMayChoTest` thay bộ tra phạm vi.
 * Mọi ca âm tính có đối chứng dương (máy A của chính registrar duyệt được).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));
const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: logs, default: logs }));

const auth = vi.hoisted(() => ({
  issueFleetMachineKey: vi.fn(async (): Promise<any> => ({ id: 99, keyPrefix: "mk_abc123", plaintextKey: "mk_" + "0".repeat(48) })),
  issueMachineKey: vi.fn(async (): Promise<any> => ({ id: 1, keyPrefix: "mk_x", plaintextKey: "mk_x" })),
  isValidScopeGrant: vi.fn(() => true),
  machineCredMkOnlyEnabled: vi.fn(() => false),
}));
vi.mock("../services/machineAuthService", () => auth);

/** Máy A (nhà máy của registrar) và máy B (nhà máy khác). Trạm 41 thuộc A, trạm 90 thuộc B. */
const MAY_A = { id: 61, code: "AOI-A", name: "AOI A", stationId: 41, machineType: "AOI", registrationStatus: "pending", apiKey: null, isActive: true, lifecycleStatus: "active" };
const MAY_B = { id: 62, code: "AOI-B", name: "AOI B", stationId: 90, machineType: "AOI", registrationStatus: "pending", apiKey: null, isActive: true, lifecycleStatus: "active" };

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (..._a: any[]): Promise<any> => ({ id: 1 })),
  // thuTucGoc (trpc.ts) hỏi cổng buộc-đổi-mật-khẩu cho người KHÔNG phải admin
  phaiDoiMatKhau: vi.fn(async (): Promise<boolean> => false),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachineById: vi.fn(async (_id: number): Promise<any> => undefined),
  getMachineByCode: vi.fn(async (): Promise<any> => undefined),
  getStationById: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
  getLineByStationId: vi.fn(async (): Promise<any> => ({ id: 11, code: "L1", name: "Line 1" })),
  getWorkshopById: vi.fn(async (): Promise<any> => ({ id: 3, code: "W1" })),
  ensureIotVirtualStation: vi.fn(async (): Promise<any> => 41),
  approveMachine: vi.fn(async (..._a: any[]): Promise<any> => {}),
  rejectMachine: vi.fn(async (..._a: any[]): Promise<any> => {}),
  updateMachine: vi.fn(async (..._a: any[]): Promise<any> => {}),
  issueMachineClaimToken: vi.fn(async (): Promise<any> => ({
    token: "mct_" + "a".repeat(64), tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-09-19T10:15:00Z"),
  })),
}));
vi.mock("../db", () => dbm);

import { machineRouter } from "./hierarchyRouters";
import { __datBoTraPhamViDuyetMayChoTest } from "../_core/phamViDuyetMay";

const regCtx = { user: { id: 3, name: "Registrar A", role: "engineer" }, req: { headers: {} } } as any;
const adminCtx = { user: { id: 7, name: "Admin", role: "admin", twoFactorEnabled: true }, req: { headers: {} } } as any;

let nemPhamVi = false;
const traPhamVi = vi.fn(async (cap: "machine" | "station", pv: { userId: number; userRole: string }) => {
  if (nemPhamVi) throw new Error("db nac (gia lap)");
  if (pv.userId !== 3) return [];
  return cap === "machine" ? [MAY_A.id] : [41];
});

const coCu = process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  nemPhamVi = false;
  process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
  __datBoTraPhamViDuyetMayChoTest(traPhamVi);
  dbm.getMachineById.mockImplementation(async (id: number) => (id === MAY_A.id ? { ...MAY_A } : id === MAY_B.id ? { ...MAY_B } : undefined));
  dbm.issueMachineClaimToken.mockResolvedValue({
    token: "mct_" + "a".repeat(64), tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-09-19T10:15:00Z"),
  });
});
afterEach(() => {
  __datBoTraPhamViDuyetMayChoTest(null);
  if (coCu === undefined) delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
  else process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = coCu;
});

async function loiCua(p: Promise<unknown>): Promise<{ code: string; message: string; appCode?: unknown }> {
  try {
    await p;
  } catch (e: any) {
    return { code: e?.code, message: e?.message, appCode: e?.cause?.appCode ?? e?.data?.appCode ?? e?.appCode };
  }
  throw new Error("thủ tục KHÔNG ném — đáng lẽ phải từ chối");
}
function khongGhiGi() {
  expect(dbm.approveMachine).not.toHaveBeenCalled();
  expect(dbm.rejectMachine).not.toHaveBeenCalled();
  expect(dbm.updateMachine).not.toHaveBeenCalled();
  expect(dbm.issueMachineClaimToken).not.toHaveBeenCalled();
  expect(auth.issueFleetMachineKey).not.toHaveBeenCalled();
  expect(auth.issueMachineKey).not.toHaveBeenCalled();
}

describe("★★★ F5-nhanh — machine.approve kiểm phạm vi máy (cờ RBAC mở)", () => {
  it("(T1) registrar A duyệt máy B ⇒ CÙNG NOT_FOUND như máy không có thật; máy B không được đọc; không ghi, không giấy tờ. Đối chứng: duyệt máy A ⇒ được", async () => {
    const ngoai = await loiCua(machineRouter.createCaller(regCtx).approve({ id: MAY_B.id }));
    // ⚠ id không có thật nhưng TRONG "phạm vi" không thể có (registrar chỉ có máy A) ⇒ đo dạng lỗi của máy không có thật bằng admin
    const khongCo = await loiCua(machineRouter.createCaller(adminCtx).approve({ id: 999999 }));
    expect(ngoai).toEqual(khongCo);
    expect(ngoai.code).toBe("NOT_FOUND");
    expect(dbm.getMachineById.mock.calls.some((c) => c[0] === MAY_B.id)).toBe(false);
    khongGhiGi();

    const ok: any = await machineRouter.createCaller(regCtx).approve({ id: MAY_A.id });
    expect(ok).toBeTruthy();
    expect(dbm.approveMachine).toHaveBeenCalledTimes(1);
    expect(dbm.approveMachine.mock.calls[0][0]).toBe(MAY_A.id);
  });

  it("(T2) registrar A duyệt máy A nhưng chuyển sang trạm 90 của nhà máy B ⇒ NOT_FOUND station, không ghi; trạm 41 của A ⇒ được", async () => {
    const loi = await loiCua(machineRouter.createCaller(regCtx).approve({ id: MAY_A.id, stationId: 90 }));
    expect(loi.code).toBe("NOT_FOUND");
    expect(loi.message).toMatch(/station/i);
    khongGhiGi();
    await machineRouter.createCaller(regCtx).approve({ id: MAY_A.id, stationId: 41 });
    expect(dbm.approveMachine).toHaveBeenCalledTimes(1);
  });

  it("(T3) tra phạm vi LỖI ⇒ từ chối (NOT_FOUND), không ghi; hồi lại ⇒ được", async () => {
    nemPhamVi = true;
    const loi = await loiCua(machineRouter.createCaller(regCtx).approve({ id: MAY_A.id }));
    expect(loi.code).toBe("NOT_FOUND");
    khongGhiGi();
    nemPhamVi = false;
    await machineRouter.createCaller(regCtx).approve({ id: MAY_A.id });
    expect(dbm.approveMachine).toHaveBeenCalledTimes(1);
  });

  it("(T4) admin miễn: duyệt máy B được và KHÔNG tra phạm vi (0 câu)", async () => {
    await machineRouter.createCaller(adminCtx).approve({ id: MAY_B.id });
    expect(dbm.approveMachine).toHaveBeenCalledTimes(1);
    expect(traPhamVi).not.toHaveBeenCalled();
  });
});

describe("★★ F5-nhanh — machine.reject đi qua CÙNG hàm phạm vi", () => {
  it("(T5) registrar KHÔNG từ chối được máy B (adminProcedure chặn trước); admin (miễn phạm vi) từ chối được máy B, không tra phạm vi", async () => {
    await expect(machineRouter.createCaller(regCtx).reject({ id: MAY_B.id })).rejects.toThrow();
    expect(dbm.rejectMachine).not.toHaveBeenCalled();
    await machineRouter.createCaller(adminCtx).reject({ id: MAY_B.id, reason: "x" });
    expect(dbm.rejectMachine).toHaveBeenCalledWith(MAY_B.id, "x");
    expect(traPhamVi).not.toHaveBeenCalled();
  });
});
