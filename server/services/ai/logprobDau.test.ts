/**
 * Độ tin cậy nhãn từ logprob (lô độ-tin-cậy `ai.phan-loai`): tính ĐÚNG như phép đo trên bộ vàng (gộp top-N theo tiền tố nhãn),
 * null khi không có logprobs, token mơ hồ làm điểm THẤP đi (an toàn), chuẩn hoá phản hồi llama-server.
 */
import { describe, expect, it } from "vitest";
import { chuanHoaLogprobDau, tinCayNhan, SO_TOKEN_DAU_GIU, type LogprobToken } from "./logprobDau";

const NHAN = ["dien", "co-khi", "plc-phan-mem", "vat-tu-khac"];
const tk = (token: string, p: number, top: Array<[string, number]> = [[token, p]]): LogprobToken => ({
  token,
  logprob: Math.log(p),
  top: top.map(([t, q]) => ({ token: t, logprob: Math.log(q) })),
});

describe("tinCayNhan", () => {
  it("★ gộp xác suất top-N theo TIỀN TỐ của nhãn (token là mảnh từ): 'elec' 0,6 + ' elect' 0,3 + 'mech' 0,08 ⇒ dien 0,9", () => {
    const nhan = ["electrical", "mechanical"];
    const lp = [tk("elec", 0.6, [["elec", 0.6], [" elect", 0.3], ["mech", 0.08]])];
    expect(tinCayNhan(lp, "electrical", nhan)).toBeCloseTo(0.9, 6);
    expect(tinCayNhan(lp, "mechanical", nhan)).toBeCloseTo(0.08, 6);
  });

  it("nhãn của bộ vàng: lượt sai #47 (dien 0,32 / vat-tu-khac 0,31) ⇒ điểm thấp; lượt chắc (0,999) ⇒ cao", () => {
    const sai = [tk("dien", 0.32, [["dien", 0.32], ["vat", 0.31], ["co", 0.2], ["plc", 0.1]])];
    expect(tinCayNhan(sai, "dien", NHAN)).toBeCloseTo(0.32, 6);
    expect(tinCayNhan(sai, "vat-tu-khac", NHAN)).toBeCloseTo(0.31, 6);
    const chac = [tk("co", 0.999, [["co", 0.999], ["dien", 0.0005]])];
    expect(tinCayNhan(chac, "co-khi", NHAN)).toBeGreaterThan(0.99);
  });

  it("bỏ qua token mở đầu chỉ là khoảng trắng / nháy / dấu", () => {
    const lp = [tk(' "', 0.99), tk("dien", 0.8, [["dien", 0.8], ["co", 0.1]])];
    expect(tinCayNhan(lp, "dien", NHAN)).toBeCloseTo(0.8, 6);
  });

  it("★ token khớp MƠ HỒ (tiền tố chung của hai nhãn) không tính cho nhãn nào ⇒ điểm chỉ THẤP đi", () => {
    const lp = [tk("c", 0.9, [["c", 0.9]])]; // 'c' là tiền tố của "co-khi" và (không) — thêm nhãn cùng tiền tố
    expect(tinCayNhan(lp, "co-khi", ["co-khi", "cam-bien"])).toBe(0);
    expect(tinCayNhan(lp, "co-khi", NHAN)).toBeCloseTo(0.9, 6); // chỉ MỘT nhãn bắt đầu bằng 'c' ⇒ rõ ràng
  });

  it("★ KHÔNG bịa số: không có logprobs ⇒ null (undefined / [] / chỉ token nháy)", () => {
    expect(tinCayNhan(undefined, "dien", NHAN)).toBeNull();
    expect(tinCayNhan(null, "dien", NHAN)).toBeNull();
    expect(tinCayNhan([], "dien", NHAN)).toBeNull();
    expect(tinCayNhan([tk(" ", 0.9), tk('"', 0.9)], "dien", NHAN)).toBeNull();
  });

  it("nhãn không thuộc danh sách (hoặc null) ⇒ 0; tổng bị kẹp ≤ 1", () => {
    const lp = [tk("dien", 0.9)];
    expect(tinCayNhan(lp, "linh-tinh", NHAN)).toBe(0);
    expect(tinCayNhan(lp, null, NHAN)).toBe(0);
    expect(tinCayNhan([tk("dien", 0.9, [["dien", 0.9], [" dien", 0.9]])], "dien", NHAN)).toBe(1);
  });

  it("hoa/thường: nhãn 'Dien' khớp token 'dien'", () => {
    expect(tinCayNhan([tk("Dien", 0.7)], "dien", ["dien", "co-khi"])).toBeCloseTo(0.7, 6);
  });
});

describe("chuanHoaLogprobDau", () => {
  const phanHoi = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ token: `t${i}`, logprob: -0.1, bytes: [1], top_logprobs: [{ token: `t${i}`, logprob: -0.1 }, { token: "x", logprob: -3 }] }));
  it("giữ ≤ SO_TOKEN_DAU_GIU token đầu, kèm top", () => {
    const ra = chuanHoaLogprobDau(phanHoi(30))!;
    expect(ra).toHaveLength(SO_TOKEN_DAU_GIU);
    expect(ra[0]).toEqual({ token: "t0", logprob: -0.1, top: [{ token: "t0", logprob: -0.1 }, { token: "x", logprob: -3 }] });
  });
  it("dạng lạ ⇒ undefined (không bịa)", () => {
    expect(chuanHoaLogprobDau(undefined)).toBeUndefined();
    expect(chuanHoaLogprobDau(null)).toBeUndefined();
    expect(chuanHoaLogprobDau([])).toBeUndefined();
    expect(chuanHoaLogprobDau([{ token: 5, logprob: -1 }])).toBeUndefined();
    expect(chuanHoaLogprobDau([{ token: "a", logprob: "x" }])).toBeUndefined();
    expect(chuanHoaLogprobDau([{ token: "a", logprob: Number.NaN }])).toBeUndefined();
  });
  it("top_logprobs vắng/lỗi ⇒ top rỗng (tinCayNhan dùng chính token)", () => {
    expect(chuanHoaLogprobDau([{ token: "a", logprob: -1 }])).toEqual([{ token: "a", logprob: -1, top: [] }]);
  });
});

describe("biểu thức ngưỡng của mẫu #5 (null-an-toàn: null / thiếu không bao giờ ≥ ngưỡng)", () => {
  it("tinCay ≥ 0,7 ⇒ nhãn; thấp / null / vắng ⇒ 'khac'", async () => {
    const { danhGiaThamSo } = await import("../../../shared/flow/bieuThuc");
    const bt = '{{ $json.tinCay != null && $json.tinCay >= 0.7 ? $json.nhan : "khac" }}';
    const ev = (json: Record<string, unknown>) => danhGiaThamSo(bt, { json } as never);
    expect(ev({ nhan: "dien", tinCay: 0.95 })).toBe("dien");
    expect(ev({ nhan: "dien", tinCay: 0.7 })).toBe("dien");
    expect(ev({ nhan: "dien", tinCay: 0.69 })).toBe("khac");
    expect(ev({ nhan: "dien", tinCay: null })).toBe("khac");
    expect(ev({ nhan: "dien" })).toBe("khac");
  });
});
