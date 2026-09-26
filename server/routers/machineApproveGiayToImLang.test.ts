/**
 * `machine.approve` — KHI PHÁT GIẤY TỜ HỎNG THÌ PHẢI NÓI RA, KHÔNG ĐƯỢC IM LẶNG.
 *
 * ── Vì sao có tệp này ────────────────────────────────────────────────────────────────────────
 * Bước phát giấy tờ trong `machine.approve` cố ý là "best-effort": lượt duyệt đã commit trước
 * đó, nên ném lỗi sẽ báo *thất bại* cho một thao tác thực sự *thành công*. Lý lẽ ấy đúng và
 * bản vá KHÔNG đụng vào nó.
 *
 * Cái sai là **không ai biết chuyện đã xảy ra**: bản cũ vẫn trả `success: true` kèm
 * `message: "per-device key (mk_) issued (shown once)"` **ngay cả khi lượt đúc khoá vừa ném** —
 * một câu SAI nói thẳng vào mặt quản trị viên; và `apiKey: null` thì không phân biệt được
 * "đội máy này không dùng mk_" với "đúc hỏng".
 *
 * Đo được 2026-09-18 trên CSDL thật: **1.108 máy `approved` mà không MỘT giấy tờ nào** — trạng
 * thái ấy tồn tại được và sống rất lâu mà không cổng nào kêu.
 *
 * ── Vì sao lưới này biết KÊU ──────────────────────────────────────────────────────────────────
 * Bốn ca phủ CẢ HAI nhánh × CẢ HAI kết cục. Riêng hai ca "thành công" là **đối chứng dương**:
 * nếu ai đó vá bằng cách gán cứng `credentialIssued = false` thì chúng đỏ ngay. Một lưới chỉ
 * canh nhánh hỏng sẽ xanh cho cả bản vá rỗng lẫn bản vá kẹt-luôn-báo-lỗi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: logs, default: logs }));

const auth = vi.hoisted(() => ({
  issueFleetMachineKey: vi.fn(async (): Promise<any> => ({
    id: 99, keyPrefix: "mk_abc123", plaintextKey: "mk_" + "0".repeat(48),
  })),
  issueMachineKey: vi.fn(async (): Promise<any> => ({ id: 1, keyPrefix: "mk_x", plaintextKey: "mk_x" })),
  isValidScopeGrant: vi.fn(() => true),
  machineCredMkOnlyEnabled: vi.fn(() => false),
}));
vi.mock("../services/machineAuthService", () => auth);

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachineById: vi.fn(async (): Promise<any> => undefined),
  getMachineByCode: vi.fn(async (): Promise<any> => undefined),
  getStationById: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
  getLineByStationId: vi.fn(async (): Promise<any> => ({ id: 11, code: "L1", name: "Line 1" })),
  getWorkshopById: vi.fn(async (): Promise<any> => ({ id: 3, code: "W1" })),
  ensureIotVirtualStation: vi.fn(async (): Promise<any> => 41),
  approveMachine: vi.fn(async (): Promise<any> => {}),
  updateMachine: vi.fn(async (): Promise<any> => {}),
  issueMachineClaimToken: vi.fn(async (): Promise<any> => ({
    token: "mct_" + "a".repeat(64), tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-09-19T10:15:00Z"),
  })),
}));
vi.mock("../db", () => dbm);

import { machineRouter } from "./hierarchyRouters";

const adminCtx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: {} } } as any;

/** `ROBOT` → deviceClass `automation` (≠ aoi_avi) ⇒ rơi vào nhánh mk_ khi cờ bật. */
const MAY_MK = {
  id: 61, code: "ROB-01", name: "Robot 1", stationId: 41, machineType: "ROBOT",
  registrationStatus: "pending", apiKey: null, isActive: true, lifecycleStatus: "active",
};
/** `AOI` → deviceClass `aoi_avi` ⇒ LUÔN đi nhánh legacy `machines.apiKey` + claim token. */
const MAY_AOI = {
  id: 62, code: "AOI-02", name: "AOI 2", stationId: 41, machineType: "AOI",
  registrationStatus: "pending", apiKey: null, isActive: true, lifecycleStatus: "active",
};

/**
 * Phần `metadata` trong vết kiểm toán của chính hành động này.
 *
 * ⚠ `auditAction` (`hierarchyRouters.ts:111`) LỒNG mọi thứ xuống `details`, nên đọc
 *   `e.metadata` sẽ luôn ra `undefined` — và một lưới đọc sai đường sẽ ĐỎ trên một bản vá
 *   ĐÚNG. Đường này lấy từ hình dạng THẬT đã in ra, không phải từ suy đoán.
 */
function metaDuyet(): any {
  const e = dbm.createAuditLog.mock.calls
    .map((c) => c[0] as any)
    .find((x) => x?.action === "machine.approve");
  return e?.details?.metadata;
}

const moiTruongCu = process.env.MACHINE_CRED_MK_ONLY_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  auth.machineCredMkOnlyEnabled.mockReturnValue(false);
  auth.issueFleetMachineKey.mockResolvedValue({ id: 99, keyPrefix: "mk_abc123", plaintextKey: "mk_" + "0".repeat(48) });
  dbm.issueMachineClaimToken.mockResolvedValue({
    token: "mct_" + "a".repeat(64), tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-09-19T10:15:00Z"),
  });
});
afterEach(() => { process.env.MACHINE_CRED_MK_ONLY_ENABLED = moiTruongCu; });

describe("machine.approve — kết cục phát giấy tờ phải được KHAI BÁO", () => {
  it("★★★ đội mk_: đúc khoá NÉM ⇒ credentialIssued=false, message KHÔNG khai là đã cấp, log mức ERROR", async () => {
    auth.machineCredMkOnlyEnabled.mockReturnValue(true);
    dbm.getMachineById.mockResolvedValue(MAY_MK);
    auth.issueFleetMachineKey.mockRejectedValue(new Error("kho khoa tu choi"));

    const kq: any = await machineRouter.createCaller(adminCtx).approve({ id: MAY_MK.id });

    // Lượt duyệt VẪN thành công — bản vá không đụng vào hành vi ấy.
    expect(kq.success).toBe(true);
    expect(dbm.approveMachine).toHaveBeenCalled();

    // …nhưng kết cục thật phải hiện ra.
    expect(kq.credentialIssued).toBe(false);
    expect(kq.credentialError).toContain("kho khoa tu choi");
    expect(kq.apiKey).toBeNull();
    // Câu chữ KHÔNG được khẳng định đã cấp khoá.
    expect(kq.message).not.toMatch(/issued \(shown once\)/i);
    expect(kq.message).toMatch(/cannot authenticate/i);

    // ERROR, không phải WARN: máy rời khỏi đây không xác thực được bằng gì cả.
    expect(logs.error).toHaveBeenCalled();
    expect(metaDuyet()?.credentialIssued).toBe(false);
  });

  it("đối chứng dương — đội mk_: đúc khoá THÀNH CÔNG ⇒ credentialIssued=true, không log error", async () => {
    auth.machineCredMkOnlyEnabled.mockReturnValue(true);
    dbm.getMachineById.mockResolvedValue(MAY_MK);

    const kq: any = await machineRouter.createCaller(adminCtx).approve({ id: MAY_MK.id });

    expect(kq.credentialIssued).toBe(true);
    expect(kq.credentialError).toBeNull();
    expect(kq.apiKey).toMatch(/^mk_/);
    expect(kq.message).toMatch(/issued \(shown once\)/i);
    expect(logs.error).not.toHaveBeenCalled();
    expect(metaDuyet()?.credentialIssued).toBe(true);
  });

  it("★ đội AOI/AVI: claim token NÉM ⇒ máy VẪN có giấy tờ (machines.apiKey) ⇒ credentialIssued=true, log mức WARN", async () => {
    dbm.getMachineById.mockResolvedValue(MAY_AOI);
    dbm.issueMachineClaimToken.mockRejectedValue(new Error("het cho ghi token"));

    const kq: any = await machineRouter.createCaller(adminCtx).approve({ id: MAY_AOI.id });

    // Giấy tờ của đội này là `machines.apiKey`, đã được ghi TRƯỚC bước claim token.
    expect(kq.credentialIssued).toBe(true);
    expect(kq.apiKey).toMatch(/^mach_/);
    expect(kq.claimToken).toBeNull();
    // Nhưng chuyện claim token hỏng vẫn phải nói ra, không nuốt.
    expect(kq.message).toMatch(/claim token could not be issued/i);
    expect(kq.credentialError).toContain("het cho ghi token");
    // WARN chứ không ERROR — máy vẫn xác thực được.
    expect(logs.warn).toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
    expect(metaDuyet()?.claimTokenIssued).toBe(false);
  });

  it("đối chứng dương — đội AOI/AVI: claim token THÀNH CÔNG ⇒ câu chữ bình thường, vết kiểm toán có prefix", async () => {
    dbm.getMachineById.mockResolvedValue(MAY_AOI);

    const kq: any = await machineRouter.createCaller(adminCtx).approve({ id: MAY_AOI.id });

    expect(kq.credentialIssued).toBe(true);
    expect(kq.credentialError).toBeNull();
    expect(kq.claimToken).toMatch(/^mct_/);
    expect(kq.message).toBe("Machine approved and mapped");
    expect(metaDuyet()?.claimPrefix).toBe("mct_aaaaaa");
    expect(metaDuyet()?.credentialIssued).toBe(true);
  });

  it("vết kiểm toán LUÔN mang `credentialIssued`, kể cả khi đạt — vắng mặt là một nghĩa thứ hai", async () => {
    dbm.getMachineById.mockResolvedValue(MAY_AOI);
    await machineRouter.createCaller(adminCtx).approve({ id: MAY_AOI.id });
    expect(Object.keys(metaDuyet() ?? {})).toContain("credentialIssued");
  });
});
