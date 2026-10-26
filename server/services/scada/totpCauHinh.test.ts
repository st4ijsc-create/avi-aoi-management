/**
 * SCADA R1b-2a T5 (kiem-dinh M7, điều phối Q5) — `kiemTotpCauHinh` có HẠN: lượt kiểm TOTP chạy trên kết nối THỨ HAI (bộ đếm sai phải commit kể
 * cả khi giao dịch cấu hình rollback — xem đầu `totpCauHinh.ts`), nên pool cạn không được làm giao dịch cấu hình (đang giữ khoá) treo vô hạn:
 * quá `HAN_TOTP_CAU_HINH_MS` ⇒ CONFLICT "thử lại". Đồng hồ GIẢ (phán quyết K15) — không chờ thời gian thật.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ kq: null as null | (() => Promise<unknown>) }));
vi.mock("../../_core/xacThucTheoMuc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../_core/xacThucTheoMuc")>();
  return {
    ...real,
    kiemXacThucTheoMuc: async (...args: Parameters<typeof real.kiemXacThucTheoMuc>) => (H.kq ? H.kq() : real.kiemXacThucTheoMuc(...args)),
  };
});

import { HAN_TOTP_CAU_HINH_MS, kiemTotpCauHinh } from "./totpCauHinh";
import { readAppErrorMeta } from "../../_core/appError";

const ctx = { user: { id: 1, role: "engineer", twoFactorEnabled: true } } as never;
const treo = () => new Promise<never>(() => undefined);

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: unknown }> {
  try {
    await p;
  } catch (e) {
    const m = readAppErrorMeta(e);
    return { code: (e as { code?: string }).code, appCode: m?.appCode, appParams: m?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thành công");
}

afterEach(() => {
  H.kq = null;
  vi.useRealTimers();
});

describe("kiemTotpCauHinh — hạn cho lượt kiểm trên kết nối thứ hai (Q5)", () => {
  it("hằng hạn = 3000 ms (điều phối Q5)", () => {
    expect(HAN_TOTP_CAU_HINH_MS).toBe(3000);
  });

  it("★ lượt kiểm TREO ⇒ đúng tại 3000 ms: CONFLICT OPERATION_FAILED {operation: scadaTotpCauHinh, reason: scadaKenhThuLai}; 2999 ms vẫn chờ", async () => {
    vi.useFakeTimers();
    H.kq = treo;
    let xong = false;
    const p = loiCua(kiemTotpCauHinh(ctx, "123456")).finally(() => {
      xong = true;
    });
    await vi.advanceTimersByTimeAsync(HAN_TOTP_CAU_HINH_MS - 1);
    expect(xong, "chưa tới hạn ⇒ chưa trả").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({
      code: "CONFLICT",
      appCode: "OPERATION_FAILED",
      appParams: { operation: "scadaTotpCauHinh", reason: "scadaKenhThuLai" },
    });
  });

  it("`hanMs` của bên gọi được tôn trọng (50 ms)", async () => {
    vi.useFakeTimers();
    H.kq = treo;
    const p = loiCua(kiemTotpCauHinh(ctx, "123456", { hanMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect((await p).code).toBe("CONFLICT");
  });

  it("kết quả về TRƯỚC hạn ⇒ ánh xạ như cũ (ok ⇒ không ném; TOTP_SAI ⇒ SCADA_CONFIG_TOTP_INVALID), không có lỗi hạn muộn", async () => {
    vi.useFakeTimers();
    H.kq = async () => ({ ok: true, cach: "moi_lan" });
    await expect(kiemTotpCauHinh(ctx, "123456")).resolves.toBeUndefined();
    H.kq = async () => ({ ok: false, ma: "TOTP_SAI" });
    expect(await loiCua(kiemTotpCauHinh(ctx, "000000"))).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID" });
    // hẹn giờ của hạn đã được dọn: chạy hết đồng hồ không sinh lỗi / rejection nào
    await vi.advanceTimersByTimeAsync(HAN_TOTP_CAU_HINH_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lượt kiểm bị bỏ rơi rồi THẤT BẠI sau hạn ⇒ không có rejection lơ lửng (unhandled)", async () => {
    vi.useFakeTimers();
    let tuChoi!: (e: unknown) => void;
    H.kq = () => new Promise((_r, rej) => (tuChoi = rej));
    const p = loiCua(kiemTotpCauHinh(ctx, "123456", { hanMs: 10 }));
    await vi.advanceTimersByTimeAsync(10);
    expect((await p).code).toBe("CONFLICT");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      tuChoi(new Error("pool đóng muộn"));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
