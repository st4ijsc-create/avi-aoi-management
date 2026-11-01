/**
 * SCADA R1b-2a T5 (kiem-dinh M7, điều phối Q5) — `kiemTotpCauHinh` có HẠN: quá `HAN_TOTP_CAU_HINH_MS` ⇒ CONFLICT "thử lại". Đồng hồ GIẢ (phán quyết
 * K15) — không chờ thời gian thật. Từ R1b-2b-2a T5B lượt kiểm chạy NGOÀI mọi giao dịch (`chayGiaoDichTotpNgoai`, cuối tệp) — không còn là "kết nối
 * thứ hai trong giao dịch giữ khoá"; hạn giữ để trần độ trễ + mã lỗi như cũ.
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

import { HAN_TOTP_CAU_HINH_MS, chayGiaoDichTotpNgoai, kiemTotpCauHinh } from "./totpCauHinh";
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

describe("kiemTotpCauHinh — hạn của lượt kiểm TOTP (Q5; từ T5B chạy ngoài giao dịch)", () => {
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

/**
 * R1b-2b-2a T5B — `chayGiaoDichTotpNgoai`: giao dịch giữ khoá KHÔNG chạy lượt kiểm TOTP (pool) bên trong. Lượt 1 dừng ở cửa ⇒ rollback ⇒ kiểm
 * mã NGOÀI giao dịch ⇒ lượt 2 với cửa no-op. Thân giả ghi lại mỗi lượt (trong "giao dịch" hay không) để chứng minh kiểm mã KHÔNG nằm trong lượt nào.
 */
describe("chayGiaoDichTotpNgoai — kiểm TOTP ngoài giao dịch, hai lượt (T5B)", () => {
  function dung(o: { canMa: boolean; loiTruocCua?: unknown; xacMinh?: () => Promise<void> }) {
    const nhatKy: string[] = [];
    let trongTx = false;
    let luot = 0;
    const chay = async (cuaTotp: () => void) => {
      luot++;
      trongTx = true;
      nhatKy.push(`mo-tx-${luot}`);
      try {
        if (o.loiTruocCua) throw o.loiTruocCua;
        if (o.canMa) cuaTotp();
        nhatKy.push(`ghi-${luot}`);
        return `kq-${luot}`;
      } finally {
        trongTx = false;
        nhatKy.push(`dong-tx-${luot}`);
      }
    };
    const xacMinh = vi.fn(async () => {
      nhatKy.push(trongTx ? "XAC-MINH-TRONG-TX" : "xac-minh-ngoai-tx");
      await o.xacMinh?.();
    });
    return { chay, xacMinh, nhatKy };
  }

  it("không chạm cửa ⇒ MỘT lượt, không kiểm mã", async () => {
    const d = dung({ canMa: false });
    expect(await chayGiaoDichTotpNgoai(d.chay, d.xacMinh)).toBe("kq-1");
    expect(d.xacMinh).not.toHaveBeenCalled();
    expect(d.nhatKy).toEqual(["mo-tx-1", "ghi-1", "dong-tx-1"]);
  });

  it("★ chạm cửa ⇒ lượt 1 KHÔNG ghi (rollback) ⇒ kiểm mã NGOÀI giao dịch đúng MỘT lần ⇒ lượt 2 ghi", async () => {
    const d = dung({ canMa: true });
    expect(await chayGiaoDichTotpNgoai(d.chay, d.xacMinh)).toBe("kq-2");
    expect(d.xacMinh).toHaveBeenCalledTimes(1);
    expect(d.nhatKy).toEqual(["mo-tx-1", "dong-tx-1", "xac-minh-ngoai-tx", "mo-tx-2", "ghi-2", "dong-tx-2"]);
  });

  it("★ kiểm mã từ chối ⇒ đúng lỗi ấy, KHÔNG có lượt 2 (không ghi)", async () => {
    const loi = new Error("SCADA_CONFIG_TOTP_INVALID giả");
    const d = dung({ canMa: true, xacMinh: async () => Promise.reject(loi) });
    await expect(chayGiaoDichTotpNgoai(d.chay, d.xacMinh)).rejects.toBe(loi);
    expect(d.nhatKy).toEqual(["mo-tx-1", "dong-tx-1", "xac-minh-ngoai-tx"]);
  });

  it("★ lỗi đứng TRƯỚC cửa (phạm vi / NOT_FOUND / kiểm hợp lệ) ⇒ nguyên lỗi ấy, KHÔNG kiểm mã (mã không bị tiêu)", async () => {
    const loi = new Error("NOT_FOUND giả");
    const d = dung({ canMa: true, loiTruocCua: loi });
    await expect(chayGiaoDichTotpNgoai(d.chay, d.xacMinh)).rejects.toBe(loi);
    expect(d.xacMinh).not.toHaveBeenCalled();
  });

  it("thân bắt tín hiệu rồi ném lỗi KHÁC ⇒ vẫn đi đường kiểm mã (cửa đã chạm); thân NUỐT tín hiệu rồi chạy tiếp ⇒ INTERNAL kêu to, không bao giờ 'đã qua'", async () => {
    const xacMinh = vi.fn(async () => undefined);
    let luot = 0;
    const doiLoi = async (cuaTotp: () => void) => {
      luot++;
      try {
        cuaTotp();
      } catch {
        if (luot === 1) throw new Error("bọc lại");
      }
      return luot;
    };
    expect(await chayGiaoDichTotpNgoai(doiLoi, xacMinh)).toBe(2);
    expect(xacMinh).toHaveBeenCalledTimes(1);
    const nuot = async (cuaTotp: () => void) => {
      try {
        cuaTotp();
      } catch {
        /* nuốt */
      }
      return "da-ghi";
    };
    expect(await loiCua(chayGiaoDichTotpNgoai(nuot, xacMinh))).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      appCode: "OPERATION_FAILED",
      appParams: { operation: "scadaTotpCauHinh" },
    });
    expect(xacMinh).toHaveBeenCalledTimes(1);
  });

  // ─── T5B fix 1 — điều kiện dieu-phoi ───

  it("★ điều kiện 1: lượt 1 CẦN mã, lượt 2 (tính lại dưới khoá mới) KHÔNG cần ⇒ vẫn ghi; xác minh ĐÚNG MỘT lần; chỉ lượt 1 gọi cửa", async () => {
    const nhatKy: string[] = [];
    const goiCua: number[] = [];
    let luot = 0;
    const chay = async (cuaTotp: () => void) => {
      luot++;
      nhatKy.push(`mo-tx-${luot}`);
      try {
        const canMa = luot === 1; // dữ liệu đổi giữa hai lượt: luật thành nháp ⇒ không còn bảo vệ
        if (canMa) {
          goiCua.push(luot);
          cuaTotp();
        }
        nhatKy.push(`ghi-${luot}`);
        return `kq-${luot}`;
      } finally {
        nhatKy.push(`dong-tx-${luot}`);
      }
    };
    const xacMinh = vi.fn(async () => {
      nhatKy.push("xac-minh-ngoai-tx");
    });
    expect(await chayGiaoDichTotpNgoai(chay, xacMinh)).toBe("kq-2");
    expect(xacMinh).toHaveBeenCalledTimes(1);
    expect(goiCua).toEqual([1]);
    expect(nhatKy).toEqual(["mo-tx-1", "dong-tx-1", "xac-minh-ngoai-tx", "mo-tx-2", "ghi-2", "dong-tx-2"]);
  });

  it("★ điều kiện 1 (chiều ngược): lượt 1 KHÔNG cần mã ⇒ không có lượt 2, không xác minh, lỗi lượt 1 giữ NGUYÊN (chưa tiêu mã)", async () => {
    const xacMinh = vi.fn(async () => undefined);
    let luot = 0;
    expect(await chayGiaoDichTotpNgoai(async () => ++luot, xacMinh)).toBe(1);
    const goc = new Error("lỗi lượt 1 không cần mã");
    await expect(chayGiaoDichTotpNgoai(async () => Promise.reject(goc), xacMinh)).rejects.toBe(goc);
    expect(xacMinh).not.toHaveBeenCalled();
  });

  it("★ điều kiện 4: lượt 2 hỏng SAU khi mã đã tiêu ⇒ CONFLICT OPERATION_FAILED {scadaConfigTotp, scadaTotpDaDungDuLieuDoi, maGoc} — không bao giờ lỗi gốc / 'mã sai'", async () => {
    const { appError } = await import("../../_core/appError");
    const tests: Array<[unknown, string]> = [
      [appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "interlockRule" }, "x"), "ENTITY_NOT_FOUND"],
      [appError("BAD_REQUEST", "INVALID_VALUE", { field: "f", reason: "stopPinTagNotWritable" }, "x"), "stopPinTagNotWritable"],
      [Object.assign(new Error("tag_not_writable"), { name: "StopPinLoi", loai: "tag_not_writable" }), "tag_not_writable"],
      [Object.assign(new Error("deadlock"), { code: "40P01" }), "40P01"],
      ["chuỗi thô", "UNKNOWN"],
    ];
    for (const [goc, maGoc] of tests) {
      const xacMinh = vi.fn(async () => undefined);
      let luot = 0;
      const chay = async (cuaTotp: () => void) => {
        luot++;
        if (luot === 1) cuaTotp();
        throw goc;
      };
      expect(await loiCua(chayGiaoDichTotpNgoai(chay, xacMinh)), maGoc).toEqual({
        code: "CONFLICT",
        appCode: "OPERATION_FAILED",
        appParams: { operation: "scadaConfigTotp", reason: "scadaTotpDaDungDuLieuDoi", maGoc },
      });
      expect(xacMinh).toHaveBeenCalledTimes(1);
      expect(luot).toBe(2);
    }
  });
});
