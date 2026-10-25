/**
 * W17b — phạm vi trạm của luật cảnh báo MQTT (THUẦN). Mỗi trạm được đúng MỘT luật cho mỗi khoá (ruleType, categoryId); đường nhanh khi không có luật nhà máy.
 */
import { describe, expect, it } from "vitest";
import { dieuKienTram, hangKetQua, phanPhamViTram } from "./mqttAlertPhamVi";

const L = (id: number, ruleType: string, factoryId: number | null = null, categoryId: number | null = null) => ({ id, ruleType, factoryId, categoryId });

describe("phanPhamViTram", () => {
  it("★ ĐƯỜNG NHANH: không có luật nhà máy ⇒ map rỗng (mọi luật chạy truy vấn như trước)", () => {
    expect(phanPhamViTram([L(1, "LATENCY_THRESHOLD"), L(2, "MESSAGE_FAILURE_RATE"), L(3, "BROKER_DISCONNECT")]).size).toBe(0);
  });
  it("luật nhà máy A cùng khoá ⇒ A chỉ trạm A; luật mặc định loại trừ A; khoá khác không bị ảnh hưởng", () => {
    const m = phanPhamViTram([L(1, "LATENCY_THRESHOLD"), L(2, "LATENCY_THRESHOLD", 7), L(3, "MESSAGE_FAILURE_RATE")]);
    expect(m.get(2)).toEqual({ gom: 7 });
    expect(m.get(1)).toEqual({ loaiTru: [7] });
    expect(m.has(3)).toBe(false);
  });
  it("hai nhà máy cùng ghi đè ⇒ luật mặc định loại trừ cả hai (sắp xếp, không trùng)", () => {
    const m = phanPhamViTram([L(1, "THROUGHPUT_LOW"), L(2, "THROUGHPUT_LOW", 9), L(3, "THROUGHPUT_LOW", 4), L(4, "THROUGHPUT_LOW", 4)]);
    expect(m.get(1)).toEqual({ loaiTru: [4, 9] });
  });
  it("khoá gồm categoryId: luật nhà máy cho danh mục 5 không ghi đè luật mặc định danh mục khác", () => {
    const m = phanPhamViTram([L(1, "LATENCY_THRESHOLD", null, 5), L(2, "LATENCY_THRESHOLD", 7, 5), L(3, "LATENCY_THRESHOLD", null, null)]);
    expect(m.get(1)).toEqual({ loaiTru: [7] });
    expect(m.has(3)).toBe(false);
  });
  it("BROKER_DISCONNECT / CLIENT_OFFLINE không có phạm vi trạm (kể cả khi có hàng gắn nhà máy do gieo tay)", () => {
    const m = phanPhamViTram([L(1, "BROKER_DISCONNECT"), L(2, "BROKER_DISCONNECT", 7), L(3, "CLIENT_OFFLINE"), L(4, "CLIENT_OFFLINE", 7)]);
    expect(m.size).toBe(0);
  });
});

describe("dieuKienTram / hangKetQua", () => {
  it("không phạm vi ⇒ không điều kiện; có ⇒ SQL", () => {
    expect(dieuKienTram(undefined)).toBeUndefined();
    expect(dieuKienTram({ gom: 1 })).toBeDefined();
    expect(dieuKienTram({ loaiTru: [1, 2] })).toBeDefined();
    expect(dieuKienTram({ loaiTru: [] })).toBeUndefined();
  });
  it("hangKetQua nhận cả mảng (postgres-js) lẫn { rows } (node-pg) — bản cũ chỉ đọc .rows nên mọi số đo MQTT luôn bằng 0", () => {
    expect(hangKetQua([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(hangKetQua({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(hangKetQua(null)).toEqual([]);
  });
});
