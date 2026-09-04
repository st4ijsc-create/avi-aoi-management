/**
 * ★★★ B2 (spec "lọc theo hãng đã có sẵn", `task-v7-report.md`) — lưới RIÊNG cho vị từ
 * `detectProgrammingVendors` (`aiLocalKnowledgeService.ts`, cạnh `retrieveProgrammingKnowledgeForVscode`).
 *
 * ★ Sau phản hồi chủ dự án 2026-09-04: hàm KHÔNG còn "thuần tuyệt đối" — nó đọc danh sách hãng
 * ĐANG TỒN TẠI qua `getProgrammingKbVendorSlugs()` (`./aiProgrammingKnowledgeService`, nguồn thật
 * là `manifest.json`, KHÔNG phải một bảng chép tay có thể trôi khỏi corpus thật). Lưới này mock
 * NGUYÊN HÀM đó (trả về danh sách hãng CỐ ĐỊNH khớp `manifest.json` thật, 6 hãng) để §A-§D dưới
 * đây vẫn đo ĐÚNG MỘT ranh giới — luật NHẬN DIỆN (so khớp chuỗi) — không đo lại cách đọc manifest
 * (đã có lưới riêng: `aiProgrammingKnowledgeService.test.ts`, describe
 * "getProgrammingKbVendorSlugs"). §E/§F dưới đây MỚI là lưới cho chính việc "nguồn hãng đọc động".
 *
 * ★★★ TRỌNG TÂM CỦA §A-§D LÀ CA ÂM TÍNH, không phải ca dương tính. Dự án đã bị cắn BỐN lần vì
 * khớp từ khoá quá lỏng (OEE `performance`/`quality`, `yield` = từ khoá JS, gộp dấu "kỹ"↔"kỳ", văn
 * bản giáo cụ khớp nhầm intent) — §B dưới đây là lần thứ năm phải KHÔNG xảy ra: "Delta" là từ tiếng
 * Anh thông dụng (delta = độ chênh) VÀ là định danh JS/TS cực phổ biến.
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC (§A-§D): đổi `DELTA_PROPER_NOUN_RE`/`DELTA_WORD_RE` sang so khớp KHÔNG
 *   phân biệt hoa/thường mà bỏ luôn điều kiện ngữ cảnh (b) ⇒ toàn bộ §B phải chuyển ĐỎ.
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC (§E/§F) — xem docblock ngay trước mỗi describe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProgrammingKbVendorSlugs = vi.fn<() => string[]>();
vi.mock("./aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(),
  getProgrammingKbVendorSlugs: () => getProgrammingKbVendorSlugs(),
}));

import { detectProgrammingVendors } from "./aiLocalKnowledgeService";

// Khớp ĐÚNG `manifest.json` thật (`knowledge/programming/manifest.json`) tại thời điểm viết bản vá
// này — 6 hãng. §A-§D dùng danh sách này làm mặc định.
const REAL_SIX_VENDORS = ["delta", "fanuc", "mitsubishi", "omron", "universal-robots", "zmotion"];

beforeEach(() => {
  getProgrammingKbVendorSlugs.mockReset();
  getProgrammingKbVendorSlugs.mockReturnValue(REAL_SIX_VENDORS);
});

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

/**
 * ★★★ §E — phản hồi chủ dự án, yêu cầu #3: "một ca khẳng định MỌI vendor trong manifest.json đều
 * được detectProgrammingVendors nhận ra. Thêm một hãng giả vào manifest ⇒ nếu mã vẫn dùng bảng tay
 * thì ca này ĐỎ." Ở đây "thêm vào manifest" = đổi giá trị trả về MOCK của `getProgrammingKbVendorSlugs`
 * (đúng ranh giới lưới này đo — không đụng tệp thật, không đụng `aiProgrammingKnowledgeService.ts`).
 * Hãng giả KHÔNG có mặt trong `VENDOR_ALIAS_PATTERNS` (bảng làm-giàu tay) — chỉ `genericVendorRegex`
 * (suy trực tiếp từ slug) mới bắt được nó.
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC (chiều 1 — quay lại bảng tay): thay `getProgrammingKbVendorSlugs()` bên
 *   trong `detectProgrammingVendors` bằng một MẢNG HẰNG chỉ 6 slug cũ (bỏ qua danh sách động) ⇒ ca
 *   "hãng thứ bảy" dưới đây phải chuyển ĐỎ (không còn quét slug lạ). Output thật dán trong
 *   `task-v7-report.md`.
 */
describe("§E — hãng thứ bảy chỉ có trong manifest (KHÔNG có trong bảng alias tay) vẫn phải được nhận", () => {
  it("manifest thêm 'acme-robotics' ⇒ câu hỏi nhắc 'Acme Robotics' được nhận qua generic fallback", () => {
    getProgrammingKbVendorSlugs.mockReturnValue([...REAL_SIX_VENDORS, "acme-robotics"]);
    expect(detectProgrammingVendors("Acme Robotics teach pendant lỗi gì khi mất kết nối?")).toEqual(["acme-robotics"]);
  });

  it("cùng hãng giả, viết liền gạch ngang đúng slug ⇒ vẫn nhận", () => {
    getProgrammingKbVendorSlugs.mockReturnValue([...REAL_SIX_VENDORS, "acme-robotics"]);
    expect(detectProgrammingVendors("driver acme-robotics không load được")).toEqual(["acme-robotics"]);
  });

  it("hãng giả 'kuka' (một từ, không alias) ⇒ khớp nguyên từ qua generic fallback", () => {
    getProgrammingKbVendorSlugs.mockReturnValue([...REAL_SIX_VENDORS, "kuka"]);
    expect(detectProgrammingVendors("Kuka KRC4 báo lỗi E-stop là gì?")).toEqual(["kuka"]);
  });

  it("hãng giả KHÔNG được nhắc tới trong câu ⇒ vẫn KHÔNG nhận (không dương tính giả tràn lan)", () => {
    getProgrammingKbVendorSlugs.mockReturnValue([...REAL_SIX_VENDORS, "acme-robotics"]);
    expect(detectProgrammingVendors("Omron PLC báo lỗi CP1E thì tra ở đâu?")).toEqual(["omron"]);
  });
});

/**
 * ★★★ §F — phản hồi chủ dự án, yêu cầu #4: "manifest thiếu/hỏng ⇒ KHÔNG được ném lỗi, rơi về hành
 * vi an toàn (không lọc)." `getProgrammingKbVendorSlugs()` tự fail-safe về `[]` khi manifest hỏng
 * (lưới riêng, tầng đọc đĩa: `aiProgrammingKnowledgeService.test.ts`) — ở TẦNG NÀY (vị từ nhận
 * diện), mô phỏng đúng cái mảng rỗng đó và xác nhận `detectProgrammingVendors` KHÔNG throw, KHÔNG
 * đoán mò — trả `[]` cho MỌI câu hỏi, kể cả câu nêu tên một hãng CÓ THẬT bằng chữ.
 */
describe("§F — manifest rỗng/hỏng (giả lập qua mock) ⇒ KHÔNG throw, KHÔNG lọc — an toàn", () => {
  it("getProgrammingKbVendorSlugs() trả [] ⇒ mọi câu hỏi (kể cả nêu đúng tên hãng) đều nhận []", () => {
    getProgrammingKbVendorSlugs.mockReturnValue([]);
    expect(() => detectProgrammingVendors("Fanuc KAREL lỗi gì?")).not.toThrow();
    expect(detectProgrammingVendors("Fanuc KAREL lỗi gì?")).toEqual([]);
    expect(detectProgrammingVendors("Delta PLC ASDA servo báo lỗi")).toEqual([]);
    expect(detectProgrammingVendors("URScript movel syntax")).toEqual([]);
  });
});
