/**
 * SCADA R1b-2a Task 4 fix round 1 (review I-1, I-2, M-3) — MỘT hạn cho CẢ request STOP HMI, qua CHUỖI THẬT:
 * createContext THẬT → `moduleProcedure("MOD_OT_CONTROL")` THẬT (cổng đổi mật khẩu `chanKhiPhaiDoiMatKhau` → requireUser → audit →
 * phạm vi tenant → cổng giấy phép `moduleGate`) → thân thủ tục (đứng thay handler: ghi lại lúc chạy + `ctx.hanChotStopHmi`).
 * Giả đúng các lượt đọc DB bị làm chậm: `sdk.authenticateRequest`, `phaiDoiMatKhau`, `getAllLicenses` (×2 / lượt), `getTenantScope`.
 * Đồng hồ GIẢ (K15): `troi(ms)` tiến từng 10 ms và nhường vòng sự kiện thật (setImmediate không bị giả) để import động trong middleware xong.
 * Pha handler (min(2 s, còn lại)) được đo đầu-cuối trên CSDL thật ở scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ matKhauMs: 0, giayPhepMs: 0, tenantMs: 0 }));
const choGia = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return {
    ...real,
    phaiDoiMatKhau: (async () => choGia(H.matKhauMs, false)) as typeof real.phaiDoiMatKhau,
    getAllLicenses: (async () => choGia(H.giayPhepMs, { licenses: [], total: 0 })) as unknown as typeof real.getAllLicenses,
  };
});
vi.mock("./accessControl", async (importOriginal) => {
  const real = await importOriginal<typeof import("./accessControl")>();
  return {
    ...real,
    getTenantScope: (async () => choGia(H.tenantMs, { bypass: false, corporateCodes: [], factoryCodes: ["F1"] })) as typeof real.getTenantScope,
  };
});

import { sdk } from "./sdk";
import { ENV } from "./env";
import { createContext, type TrpcContext } from "./context";
import { moduleProcedure, router } from "./trpc";
import {
  _datLaiDemStopQuaHanChoTest,
  CUA_SO_DEM_STOP_QUA_HAN_MS,
  demStopQuaHanKhongGhiSo,
  ghiNhanStopQuaHanKhongGhiSo,
  HAN_TONG_STOP_HMI_MS,
  HAN_XAC_THUC_STOP_HMI_MS,
  TRAN_DEM_STOP_QUA_HAN,
  trongHanYeuCauStopHmi,
} from "./hanStopHmi";
// nạp sẵn các module mà middleware import động (đồng hồ giả không đợi được nạp module lần đầu)
import "../db";
import "../db/tenantContext";
import "./accessControl";
import "../services/robot/robotStopAuthMemo";
import "../license/license-service";

const NGUOI = { id: 77, openId: "o-77", role: "operator", name: "Op", twoFactorEnabled: false } as unknown as NonNullable<TrpcContext["user"]>;
const req = { headers: { cookie: "app_session_id=abc" } } as never;
const info = (path: string) => ({ calls: [{ path }] }) as never;

const chay: Array<{ at: number; han: number | undefined }> = [];
const thuTuc = moduleProcedure("MOD_OT_CONTROL").mutation(({ ctx }) => {
  chay.push({ at: Date.now(), han: ctx.hanChotStopHmi });
  return "da_chay";
});
const appRouter = router({ scadaCommands: router({ dungMay: thuTuc, confirm: thuTuc }) });

/** tiến đồng hồ giả `ms` theo bước 10 ms, nhường vòng sự kiện THẬT mỗi bước */
async function troi(ms: number) {
  for (let t = 0; t < ms; t += 10) {
    await vi.advanceTimersByTimeAsync(Math.min(10, ms - t));
    await new Promise<void>((r) => setImmediate(r));
  }
}
function theoDoi<T>(p: Promise<T>) {
  const s: { xong: boolean; luc?: number; giaTri?: T; loi?: unknown } = { xong: false };
  p.then(
    (v) => Object.assign(s, { xong: true, luc: Date.now(), giaTri: v }),
    (e) => Object.assign(s, { xong: true, luc: Date.now(), loi: e }),
  );
  return s;
}
/** MỘT request: createContext → caller → thủ tục (đúng thứ tự adapter tRPC làm) */
async function goi(path: "scadaCommands.dungMay" | "scadaCommands.confirm") {
  const ctx = await createContext({ req, res: {} as never, info: info(path) });
  const c = appRouter.createCaller(ctx);
  return path === "scadaCommands.dungMay" ? c.scadaCommands.dungMay() : c.scadaCommands.confirm();
}
const appCua = (e: unknown) => {
  const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
  return { code: x?.code, appCode: x?.cause?.appCode, appParams: x?.cause?.appParams };
};

const envCu = { licenseModuleGate: ENV.licenseModuleGate, licenseBypass: ENV.licenseBypass };
beforeAll(() => {
  (ENV as { licenseModuleGate: boolean }).licenseModuleGate = true;
  (ENV as { licenseBypass: boolean }).licenseBypass = false;
});
afterAll(() => {
  (ENV as { licenseModuleGate: boolean }).licenseModuleGate = envCu.licenseModuleGate;
  (ENV as { licenseBypass: boolean }).licenseBypass = envCu.licenseBypass;
});
let t0 = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  t0 = Date.now();
  chay.length = 0;
  H.matKhauMs = 0;
  H.giayPhepMs = 0;
  H.tenantMs = 0;
  vi.stubEnv("TENANT_RLS_ENABLED", "false");
  _datLaiDemStopQuaHanChoTest();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hằng", () => {
  it("hạn tổng 2500 ms; trần xác thực 1500 ms", () => {
    expect(HAN_TONG_STOP_HMI_MS).toBe(2500);
    expect(HAN_XAC_THUC_STOP_HMI_MS).toBe(1500);
  });
});

describe("★ I-1 — MỘT hạn tổng 2,5 s cho request dungMay: xác thực + middleware cùng tiêu, hết hạn ⇒ từ chối 'dùng E-STOP cứng' ĐÚNG ≈ 2,5 s", () => {
  it("★ xác thực 1,2 s + cổng đổi mật khẩu 0,6 s + cổng giấy phép TREO ⇒ từ chối ở 2500 ms (không 3,5 s+); SERVICE_UNAVAILABLE + appCode; thủ tục KHÔNG chạy; đếm 'giay_phep'", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(1_200, NGUOI) as never);
    H.matKhauMs = 600;
    H.giayPhepMs = 60_000;
    const s = theoDoi(goi("scadaCommands.dungMay"));
    await troi(2_490);
    expect(s.xong).toBe(false);
    await troi(40);
    expect(s.xong).toBe(true);
    expect((s.luc ?? 0) - t0).toBeGreaterThanOrEqual(2_500);
    expect((s.luc ?? 0) - t0).toBeLessThanOrEqual(2_520);
    expect(appCua(s.loi)).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "truoc_gui" } });
    expect(chay).toHaveLength(0);
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ giay_phep: 1 });
  });

  it("★ xác thực 1,2 s + cổng đổi mật khẩu TREO ⇒ từ chối ở 2500 ms, pha xac_thuc (fail-closed: không cho qua khi chưa biết kết quả cổng); đếm 'cong_doi_mat_khau'", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(1_200, NGUOI) as never);
    H.matKhauMs = 60_000;
    const s = theoDoi(goi("scadaCommands.dungMay"));
    await troi(2_530);
    expect(s.xong).toBe(true);
    expect((s.luc ?? 0) - t0).toBeGreaterThanOrEqual(2_500);
    expect((s.luc ?? 0) - t0).toBeLessThanOrEqual(2_520);
    expect(appCua(s.loi).appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "xac_thuc" });
    expect(chay).toHaveLength(0);
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ cong_doi_mat_khau: 1 });
  });

  it("★ RLS bật: xác thực 1 s + mật khẩu 0,4 s + giấy phép 2×0,3 s + phạm vi tenant TREO ⇒ từ chối ở 2500 ms (KHÔNG rơi về next() không phạm vi); đếm 'pham_vi_tenant'", async () => {
    vi.stubEnv("TENANT_RLS_ENABLED", "true");
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(1_000, NGUOI) as never);
    H.matKhauMs = 400;
    H.giayPhepMs = 300;
    H.tenantMs = 60_000;
    const s = theoDoi(goi("scadaCommands.dungMay"));
    await troi(2_530);
    expect(s.xong).toBe(true);
    expect((s.luc ?? 0) - t0).toBeGreaterThanOrEqual(2_500);
    expect((s.luc ?? 0) - t0).toBeLessThanOrEqual(2_520);
    expect(appCua(s.loi).appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    expect(chay).toHaveLength(0);
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ pham_vi_tenant: 1 });
  });

  it("★ xác thực TREO ⇒ từ chối ở 1500 ms (min(1,5 s, còn lại)), pha xac_thuc; đếm 'xac_thuc'", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(60_000, NGUOI) as never);
    const s = theoDoi(goi("scadaCommands.dungMay"));
    await troi(1_530);
    expect(s.xong).toBe(true);
    expect((s.luc ?? 0) - t0).toBeGreaterThanOrEqual(1_500);
    expect((s.luc ?? 0) - t0).toBeLessThanOrEqual(1_520);
    expect(appCua(s.loi).appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "xac_thuc" });
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ xac_thuc: 1 });
  });

  it("★ mọi bước kịp (RLS bật: 1 s + 0,3 s + 2×0,2 s + 0,1 s) ⇒ thủ tục chạy ở 1800 ms với ctx.hanChotStopHmi = t0 + 2500 (handler dùng phần CÒN LẠI = 700 ms)", async () => {
    vi.stubEnv("TENANT_RLS_ENABLED", "true");
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(1_000, NGUOI) as never);
    H.matKhauMs = 300;
    H.giayPhepMs = 200;
    H.tenantMs = 100;
    const s = theoDoi(goi("scadaCommands.dungMay"));
    await troi(1_900);
    expect(s.loi).toBeUndefined();
    expect(s.giaTri).toBe("da_chay");
    expect(chay).toHaveLength(1);
    expect(chay[0].han).toBe(t0 + HAN_TONG_STOP_HMI_MS);
    expect(chay[0].at - t0).toBeGreaterThanOrEqual(1_800);
    expect(chay[0].at - t0).toBeLessThan(1_850);
    expect(demStopQuaHanKhongGhiSo().tong).toBe(0);
  });

  it("★ request KHÁC (scadaCommands.confirm) với cùng các bước chậm ⇒ KHÔNG hạn: chạy xong ở ~4,8 s, ctx không có hanChotStopHmi", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => choGia(2_000, NGUOI) as never);
    H.matKhauMs = 1_000;
    H.giayPhepMs = 900;
    const s = theoDoi(goi("scadaCommands.confirm"));
    await troi(4_700);
    expect(s.xong).toBe(false);
    await troi(200);
    expect(s.giaTri).toBe("da_chay");
    expect(chay[0].han).toBeUndefined();
    expect(demStopQuaHanKhongGhiSo().tong).toBe(0);
  });
});

describe("trongHanYeuCauStopHmi + bộ đếm (M-3)", () => {
  it("không có hạn ⇒ trả ĐÚNG promise gốc (mọi đường khác không đổi, không thêm nhịp)", async () => {
    const p = Promise.resolve(5);
    expect(trongHanYeuCauStopHmi(p, undefined, "db", "truoc_gui")).toBe(p);
  });
  it("lỗi của chính p đi nguyên, không đếm", async () => {
    const loi = new Error("db down");
    await expect(trongHanYeuCauStopHmi(Promise.reject(loi), Date.now() + 1_000, "db", "truoc_gui")).rejects.toBe(loi);
    expect(demStopQuaHanKhongGhiSo().tong).toBe(0);
  });
  it("bộ đếm: cửa sổ 24 h + trần TRAN_DEM_STOP_QUA_HAN; batDauLuc cho biết đếm từ khi nào (mất khi khởi động lại)", () => {
    const now = Date.now();
    ghiNhanStopQuaHanKhongGhiSo("db", now - CUA_SO_DEM_STOP_QUA_HAN_MS - 1);
    ghiNhanStopQuaHanKhongGhiSo("xac_thuc", now - 1_000);
    ghiNhanStopQuaHanKhongGhiSo("xac_thuc", now);
    expect(demStopQuaHanKhongGhiSo(now)).toMatchObject({ tong: 2, theoBuoc: { xac_thuc: 2 } });
    expect(typeof demStopQuaHanKhongGhiSo(now).batDauLuc).toBe("string");
    for (let i = 0; i < TRAN_DEM_STOP_QUA_HAN + 50; i++) ghiNhanStopQuaHanKhongGhiSo("db", now);
    expect(demStopQuaHanKhongGhiSo(now).tong).toBe(TRAN_DEM_STOP_QUA_HAN);
  });
});
