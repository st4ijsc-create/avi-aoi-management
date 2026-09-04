/**
 * ★★★ B2 (spec "lọc theo hãng đã có sẵn", `task-v7-report.md`) — lưới RIÊNG cho vị từ THUẦN
 * `detectProgrammingVendors` (`aiLocalKnowledgeService.ts`, cạnh `retrieveProgrammingKnowledgeForVscode`).
 * KHÔNG mock gì — hàm không đọc đĩa, không gọi GPU, chỉ so khớp chuỗi.
 *
 * ★★★ TRỌNG TÂM CỦA LƯỚI NÀY LÀ CA ÂM TÍNH, không phải ca dương tính. Dự án đã bị cắn BỐN lần vì
 * khớp từ khoá quá lỏng (OEE `performance`/`quality`, `yield` = từ khoá JS, gộp dấu "kỹ"↔"kỳ", văn
 * bản giáo cụ khớp nhầm intent) — §B dưới đây là lần thứ năm phải KHÔNG xảy ra: "Delta" là từ tiếng
 * Anh thông dụng (delta = độ chênh) VÀ là định danh JS/TS cực phổ biến.
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: đổi `DELTA_PROPER_NOUN_RE`/`DELTA_WORD_RE` sang so khớp KHÔNG phân biệt
 *   hoa/thường mà bỏ luôn điều kiện ngữ cảnh (b) ⇒ toàn bộ §B phải chuyển ĐỎ (nhận nhầm "delta" biến
 *   JS thành hãng Delta).
 */
import { describe, it, expect } from "vitest";
import { detectProgrammingVendors } from "./aiLocalKnowledgeService";

describe("§A — năm hãng hiếm nghĩa: khớp nguyên từ, không cần ngữ cảnh", () => {
  it.each([
    ["Omron PLC báo lỗi CP1E thì tra ở đâu?", "omron"],
    ["Cách đọc thanh ghi Fanuc qua KAREL", "fanuc"],
    ["Zmotion ZBasic MOVE command cú pháp thế nào?", "zmotion"],
    ["Z-Motion controller trục X không chạy", "zmotion"],
    ["Mitsubishi MELSERVO J4 mã lỗi tra ở đâu?", "mitsubishi"],
    ["mitsubishi melsec iq-r lập trình PLC", "mitsubishi"], // không phân biệt hoa/thường
  ])("%s ⇒ nhận %s", (question, expected) => {
    expect(detectProgrammingVendors(question)).toEqual([expected]);
  });

  it.each([
    ["hỏi movel command trên Universal Robots thế nào?", "universal-robots"],
    ["universal robots polyscope cài đặt ra sao", "universal-robots"],
    ["UR5e teach pendant lỗi E-stop", "universal-robots"],
    ["URScript movej syntax", "universal-robots"],
  ])("%s ⇒ nhận %s", (question, expected) => {
    expect(detectProgrammingVendors(question)).toEqual([expected]);
  });

  it("KHÔNG khớp 'UR' đứng một mình (2 ký tự, quá dễ trùng)", () => {
    expect(detectProgrammingVendors("UR cần xác nhận trước khi ghi đè")).toEqual([]);
  });

  it("câu hỏi KHÔNG nêu hãng nào ⇒ mảng rỗng", () => {
    expect(detectProgrammingVendors("làm sao đọc file config JSON trong Node.js?")).toEqual([]);
    expect(detectProgrammingVendors("")).toEqual([]);
  });
});

describe("§B — ★★★ 'Delta' NGUY HIỂM NHẤT: ca ÂM TÍNH bắt buộc (từ khoá JS/toán học thông dụng)", () => {
  it("`const delta = t1 - t0;` ⇒ KHÔNG được nhận là hãng Delta", () => {
    expect(detectProgrammingVendors("const delta = t1 - t0;")).toEqual([]);
  });

  it("`deltaTime` (camelCase, không có ranh giới từ) ⇒ KHÔNG được nhận", () => {
    expect(detectProgrammingVendors("cập nhật deltaTime mỗi frame trong game loop")).toEqual([]);
  });

  it("`deltaX`/`deltaY` (camelCase khác) ⇒ KHÔNG được nhận", () => {
    expect(detectProgrammingVendors("tính deltaX và deltaY giữa hai điểm chạm")).toEqual([]);
  });

  it("'độ chênh delta giữa hai lần đo' (tiếng Việt, không ngữ cảnh thiết bị) ⇒ KHÔNG được nhận", () => {
    expect(detectProgrammingVendors("độ chênh delta giữa hai lần đo là bao nhiêu?")).toEqual([]);
  });

  it("'delta encoding' (thuật ngữ nén dữ liệu thông dụng, không ngữ cảnh PLC) ⇒ KHÔNG được nhận", () => {
    expect(detectProgrammingVendors("delta encoding hoạt động thế nào trong git?")).toEqual([]);
  });

  it("'delta time' viết rời (không ngữ cảnh thiết bị) ⇒ KHÔNG được nhận", () => {
    expect(detectProgrammingVendors("delta time trong vật lý game là gì?")).toEqual([]);
  });
});

describe("§C — 'Delta' hãng THẬT: hai đường nhận diện đều phải hoạt động", () => {
  it("(a) viết hoa đúng tên riêng 'Delta' (không cần ngữ cảnh thiết bị đi kèm)", () => {
    expect(detectProgrammingVendors("Delta AS300 đọc thanh ghi Modbus thế nào?")).toEqual(["delta"]);
  });

  it("(a) 'Delta' đứng đầu câu, viết hoa tự nhiên theo văn phạm", () => {
    expect(detectProgrammingVendors("Delta có hỗ trợ Modbus TCP không?")).toEqual(["delta"]);
  });

  it("(b) 'delta' viết thường + ngữ cảnh PLC ⇒ vẫn nhận (câu hỏi Việt hoá thường không viết hoa)", () => {
    expect(detectProgrammingVendors("tôi cần tài liệu delta plc lập trình")).toEqual(["delta"]);
  });

  it("(b) 'delta' viết thường + 'servo' ⇒ nhận", () => {
    expect(detectProgrammingVendors("delta servo ASDA-A2 báo lỗi AL013")).toEqual(["delta"]);
  });

  it("(b) 'DELTA' viết hoa toàn bộ (không phải tên riêng đúng chuẩn) + 'inverter' ⇒ vẫn nhận nhờ ngữ cảnh", () => {
    expect(detectProgrammingVendors("DELTA inverter VFD-EL báo lỗi quá dòng")).toEqual(["delta"]);
  });

  it("(b) 'biến tần' (tiếng Việt) làm tín hiệu ngữ cảnh", () => {
    expect(detectProgrammingVendors("delta biến tần báo lỗi OC là gì?")).toEqual(["delta"]);
  });
});

describe("§D — nhiều hãng cùng nêu tên trong một câu (đầu vào cho B3)", () => {
  it("so sánh Delta và Mitsubishi ⇒ nhận CẢ HAI slug", () => {
    const r = detectProgrammingVendors("So sánh Delta PLC và Mitsubishi PLC, cái nào rẻ hơn?");
    expect(r.sort()).toEqual(["delta", "mitsubishi"]);
  });

  it("ba hãng cùng lúc ⇒ nhận đủ ba", () => {
    const r = detectProgrammingVendors("Omron, Fanuc và Zmotion khác nhau thế nào về motion control?");
    expect(r.sort()).toEqual(["fanuc", "omron", "zmotion"]);
  });
});
