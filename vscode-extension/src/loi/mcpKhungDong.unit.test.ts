/**
 * ★★★ ĐỢT H / TASK H2 / B2 — lưới BA HÌNH DẠNG kế hoạch đòi: cắt ngang giữa hai chunk · dòng rác ·
 * JSON hỏng — không hình dạng nào được làm sập phiên (ném lỗi ra khỏi hàm).
 */
import { describe, it, expect } from "vitest";
import { tachDongJsonRpc, dungDongYeuCauJsonRpc, dungDongThongBaoJsonRpc } from "./mcpKhungDong";

describe("tachDongJsonRpc", () => {
  it("★★★ một thông điệp trọn vẹn trong một chunk", () => {
    const r = tachDongJsonRpc("", `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`);
    expect(r.thongDiep.length).toBe(1);
    expect(r.thongDiep[0]!.id).toBe(1);
    expect(r.du).toBe("");
    expect(r.dongRac).toEqual([]);
  });

  it("★★★ THÔNG ĐIỆP BỊ CẮT NGANG GIỮA HAI CHUNK — ghép đúng ở lần gọi kế", () => {
    const goi = JSON.stringify({ jsonrpc: "2.0", id: 42, result: { ok: true } });
    const nuaDau = goi.slice(0, 10);
    const nuaSau = goi.slice(10);
    const b1 = tachDongJsonRpc("", nuaDau);
    expect(b1.thongDiep).toEqual([]);
    expect(b1.du).toBe(nuaDau);
    const b2 = tachDongJsonRpc(b1.du, `${nuaSau}\n`);
    expect(b2.thongDiep.length).toBe(1);
    expect(b2.thongDiep[0]!.id).toBe(42);
    expect((b2.thongDiep[0]!.result as { ok: boolean }).ok).toBe(true);
  });

  it("★★★ DÒNG RÁC (không phải JSON) — bỏ qua, KHÔNG ném, các dòng khác trong cùng chunk vẫn đọc được", () => {
    const chunk = `khong-phai-json\n${JSON.stringify({ jsonrpc: "2.0", id: 9, result: 1 })}\n`;
    expect(() => tachDongJsonRpc("", chunk)).not.toThrow();
    const r = tachDongJsonRpc("", chunk);
    expect(r.dongRac).toEqual(["khong-phai-json"]);
    expect(r.thongDiep.length).toBe(1);
    expect(r.thongDiep[0]!.id).toBe(9);
  });

  it("★★★ JSON HỎNG CÚ PHÁP (ngoặc thiếu) — bỏ qua đúng dòng đó, không mất các dòng hợp lệ khác", () => {
    const chunk = `{"id": 1, "result":\n${JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })}\n`;
    const r = tachDongJsonRpc("", chunk);
    expect(r.dongRac.length).toBe(1);
    expect(r.thongDiep.length).toBe(1);
    expect(r.thongDiep[0]!.id).toBe(2);
  });

  it("★★ JSON hợp lệ nhưng KHÔNG PHẢI object (null/số/chuỗi/mảng) ⇒ vào dòng rác, không coi là gói", () => {
    for (const v of ["null", "123", '"chuoi"', "[1,2,3]"]) {
      const r = tachDongJsonRpc("", `${v}\n`);
      expect(r.thongDiep, v).toEqual([]);
      expect(r.dongRac, v).toEqual([v]);
    }
  });

  it("★★ dòng trống bị bỏ qua lặng lẽ, không tính là rác", () => {
    const r = tachDongJsonRpc("", "\n\n\n");
    expect(r.thongDiep).toEqual([]);
    expect(r.dongRac).toEqual([]);
  });

  it("★★ CRLF (\\r\\n) được chấp nhận y hệt LF", () => {
    const r = tachDongJsonRpc("", `${JSON.stringify({ jsonrpc: "2.0", id: 5, result: {} })}\r\n`);
    expect(r.thongDiep.length).toBe(1);
    expect(r.thongDiep[0]!.id).toBe(5);
  });

  it("★★ nhiều thông điệp trong MỘT chunk, theo ĐÚNG thứ tự", () => {
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" });
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, result: "b" });
    const r = tachDongJsonRpc("", `${a}\n${b}\n`);
    expect(r.thongDiep.map((t) => t.id)).toEqual([1, 2]);
  });

  it("★★ phần dư sống sót qua NHIỀU lượt cắt ngang liên tiếp (chia làm ba mảnh)", () => {
    const goi = JSON.stringify({ jsonrpc: "2.0", id: 7, result: "xyz" });
    const p1 = goi.slice(0, 5);
    const p2 = goi.slice(5, 15);
    const p3 = goi.slice(15);
    const b1 = tachDongJsonRpc("", p1);
    const b2 = tachDongJsonRpc(b1.du, p2);
    expect(b2.thongDiep).toEqual([]);
    const b3 = tachDongJsonRpc(b2.du, `${p3}\n`);
    expect(b3.thongDiep.length).toBe(1);
    expect(b3.thongDiep[0]!.id).toBe(7);
  });
});

describe("dungDongYeuCauJsonRpc / dungDongThongBaoJsonRpc", () => {
  it("★★ yêu cầu có id, kết thúc bằng \\n, đúng một dòng", () => {
    const s = dungDongYeuCauJsonRpc(1, "initialize", { a: 1 });
    expect(s.endsWith("\n")).toBe(true);
    expect(s.slice(0, -1).includes("\n")).toBe(false);
    const obj = JSON.parse(s.trim());
    expect(obj).toEqual({ jsonrpc: "2.0", id: 1, method: "initialize", params: { a: 1 } });
  });

  it("★★ notification KHÔNG có trường id", () => {
    const s = dungDongThongBaoJsonRpc("notifications/initialized");
    const obj = JSON.parse(s.trim());
    expect("id" in obj).toBe(false);
    expect(obj.method).toBe("notifications/initialized");
  });
});
