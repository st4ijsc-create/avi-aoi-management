/**
 * SCADA R1b-1 Task 7 fix round 1 — `catLyDo` (I-1: NUL / ký tự điều khiển) và `ghiThuLenh` khi dòng tổng kết DIEU_TIET ném (I-2).
 * Thuần đơn vị: `d` là bộ ghi giả tiêm vào (không DB).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loi = vi.hoisted(() => vi.fn());
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: loi, debug: vi.fn() }, default: { error: loi } }));

import { catLyDo, ghiThuLenh } from "./lenhHmi";
import { __datLaiDieuTiet, nenGhiThuLenh } from "./dieuTietThuLenh";

describe("catLyDo — I-1", () => {
  it("bỏ NUL: 'ab\\u0000cdefg' ⇒ 'abcdefg'", () => {
    expect(catLyDo("ab\u0000cdefg")).toBe("abcdefg");
  });
  it("bỏ ký tự điều khiển C0 khác, GIỮ TAB / LF / CR", () => {
    expect(catLyDo("a\u0001b\u0008c\u000Bd\u000Ce\u000Ef\u001Fg")).toBe("abcdefg");
    expect(catLyDo("dong1\r\ndong2\tcot")).toBe("dong1\r\ndong2\tcot");
  });
  it("chỉ toàn ký tự điều khiển / khoảng trắng ⇒ NULL", () => {
    expect(catLyDo("\u0000\u0000")).toBeNull();
    expect(catLyDo(" \u0000 ")).toBeNull();
    expect(catLyDo(null)).toBeNull();
    expect(catLyDo(undefined)).toBeNull();
  });
  it("bỏ NUL TRƯỚC khi cắt 300: 299 ký tự + NUL + 10 ký tự ⇒ đúng 300 ký tự sạch", () => {
    const r = catLyDo("a".repeat(299) + "\u0000" + "b".repeat(10)) as string;
    expect(r).toHaveLength(300);
    expect(r.includes("\u0000")).toBe(false);
    expect(r.endsWith("ab")).toBe(true);
  });
});

describe("ghiThuLenh — dòng tổng kết DIEU_TIET ném (I-2)", () => {
  beforeEach(() => {
    __datLaiDieuTiet();
    loi.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    __datLaiDieuTiet();
  });

  function boGhi(nemKhiTongKet: boolean) {
    const ghi: Array<Record<string, unknown>> = [];
    const d = {
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          if (nemKhiTongKet && v.reasonCode === "DIEU_TIET") throw new Error("ghi tong ket hong (mo phong)");
          ghi.push(v);
        },
      }),
    };
    return { d: d as never, ghi };
  }

  const dong = { userId: 7, stage: "request" as const, outcome: "rejected" as const, reasonCode: "DA_XU_LY", lyDo: "ly do nguoi dung" };

  it("★ tổng kết ném ⇒ KHÔNG ném ra ngoài, dòng hiện tại VẪN được ghi, có log lỗi (không bí mật)", async () => {
    const { d, ghi } = boGhi(true);
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    for (let i = 0; i < 40; i++) await ghiThuLenh(d, dong); // 30 ghi + 10 gộp
    expect(ghi).toHaveLength(30);
    vi.setSystemTime(1_000_000 + 61_000);
    await expect(ghiThuLenh(d, dong)).resolves.toBeUndefined();
    expect(ghi).toHaveLength(31);
    expect(ghi.at(-1)).toMatchObject({ reasonCode: "DA_XU_LY", lyDo: "ly do nguoi dung", userId: 7 });
    expect(ghi.some((v) => v.reasonCode === "DIEU_TIET")).toBe(false);
    expect(loi).toHaveBeenCalledTimes(1);
    const [meta, msg] = loi.mock.calls[0];
    expect(meta).toMatchObject({ userId: 7, reasonCode: "DA_XU_LY", soLan: 10 });
    expect(String(msg)).toContain("DIEU_TIET");
    // cửa sổ mới đã mở (đếm 1): dòng kế tiếp ghi bình thường, không tổng kết lại
    await ghiThuLenh(d, dong);
    expect(ghi).toHaveLength(32);
    expect(loi).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: tổng kết KHÔNG ném ⇒ ghi tổng kết rồi dòng hiện tại, ly_do 'N lần {mã} bị gộp'", async () => {
    const { d, ghi } = boGhi(false);
    vi.useFakeTimers({ toFake: ["Date"], now: 2_000_000 });
    for (let i = 0; i < 40; i++) await ghiThuLenh(d, dong);
    vi.setSystemTime(2_000_000 + 61_000);
    await ghiThuLenh(d, dong);
    expect(ghi.slice(30).map((v) => [v.reasonCode, v.lyDo])).toEqual([
      ["DIEU_TIET", "10 lần DA_XU_LY bị gộp"],
      ["DA_XU_LY", "ly do nguoi dung"],
    ]);
    expect(loi).not.toHaveBeenCalled();
  });

  it("dòng HIỆN TẠI ném ⇒ vẫn ném ra như trước (nhật ký chính, giữ nguyên fail-closed của dòng confirmed trước dispatch)", async () => {
    const d = {
      insert: () => ({
        values: async () => {
          throw new Error("ghi chinh hong");
        },
      }),
    } as never;
    await expect(ghiThuLenh(d, { userId: 8, stage: "confirm", outcome: "confirmed", lyDo: "x" })).rejects.toThrow("ghi chinh hong");
  });

  it("mã không ồn không đi qua bộ điều tiết (nenGhiThuLenh không bị gọi cho MODE_LOCAL)", async () => {
    const { d, ghi } = boGhi(false);
    for (let i = 0; i < 50; i++) await ghiThuLenh(d, { userId: 9, stage: "request", outcome: "rejected", reasonCode: "MODE_LOCAL" });
    expect(ghi).toHaveLength(50);
    // khoá (9, MODE_LOCAL) chưa từng được mở ⇒ gọi trực tiếp lần đầu vẫn là {ghi:true} với đếm 1
    expect(nenGhiThuLenh(9, "MODE_LOCAL", 1)).toEqual({ ghi: true });
  });
});
