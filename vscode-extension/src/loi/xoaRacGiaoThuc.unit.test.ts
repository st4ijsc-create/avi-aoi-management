/**
 * LƯỚI cho `vanBanKhongRacGiaoThuc` — PDCA vòng 2 (round 2, `pdca3-report.md`). Xem docblock
 * `xoaRacGiaoThuc.ts` cho bối cảnh đầy đủ (chấm lại 11 tác vụ vòng 1 từ dữ liệu THÔ phát hiện 5/6
 * tác vụ ĐẠT đều lộ khối ```avi-tool``` ĐÃ THỰC THI, không riêng ca dở dang mà vòng trước đã vá).
 */
import { describe, it, expect } from "vitest";
import { vanBanKhongRacGiaoThuc } from "./xoaRacGiaoThuc";

describe("vanBanKhongRacGiaoThuc", () => {
  it("★★★ văn bản KHÔNG có khối nào ⇒ null (giữ nguyên hành vi cũ) — dữ liệu THẬT T05 (câu hỏi 1 vòng, sạch)", () => {
    // Nguyên văn câu trả lời T05 (`pdca1-t05-raw.json`) — tác vụ DUY NHẤT của vòng 1 vẫn ĐẠT sau khi
    // chấm lại vì KHÔNG hề dùng tool đọc, không có khối nào để lộ.
    const v =
      "(1) Tổng số mục được liệt kê: 2  \n(2) Danh sách đầy đủ:  \n" +
      "- `NGUONG_CANH_BAO_TON_KHO`: Ngưỡng cảnh báo tồn kho thấp.\n" +
      "- `tinhTonKhoConLai(...)`: Hàm tính tồn kho còn lại.";
    expect(vanBanKhongRacGiaoThuc(v)).toBeNull();
  });

  it("★★★ một khối avi-tool ĐÃ THỰC THI (không dở dang) nằm GIỮA câu trả lời ⇒ bị xoá, KHÔNG PHẢI null", () => {
    // Đúng hình dạng T01 (`pdca1-t01-raw.json`): khối đọc tệp ở đầu, rồi câu trả lời thật tiếp theo
    // liền mạch, KHÔNG dấu phân cách — đúng cách webview thật nối token giữa hai vòng.
    const v =
      "Cần đọc nội dung tệp `src/Inventory.ts`.\n\n" +
      '```avi-tool\n{"tool":"doc_tep","args":{"path":"src/Inventory.ts"}}\n```\n\n' +
      "Hàm `tinhTonKhoConLai` tính tồn kho còn lại = tồn đầu kỳ + nhập - xuất.";
    const r = vanBanKhongRacGiaoThuc(v);
    expect(r).not.toBeNull();
    expect(r).not.toContain("```");
    expect(r).not.toContain("avi-tool");
    expect(r).not.toContain('"tool":"doc_tep"');
    expect(r).toContain("Cần đọc nội dung tệp");
    expect(r).toContain("tồn đầu kỳ + nhập - xuất");
  });

  it("★★★ HAI khối đã thực thi ở hai vòng khác nhau, nối liền không dấu phân cách ⇒ cả hai bị xoá", () => {
    const v =
      'Vòng 1:\n```avi-tool\n{"tool":"doc_tep","args":{"path":"a.ts"}}\n```' +
      'Vòng 2:\n```avi-tool\n{"tool":"grep","args":{"mau":"x"}}\n```' +
      "Câu trả lời cuối cùng.";
    const r = vanBanKhongRacGiaoThuc(v);
    expect(r).not.toBeNull();
    expect(r).not.toContain("```");
    expect(r).not.toContain("avi-tool");
    expect(r).toContain("Vòng 1:");
    expect(r).toContain("Vòng 2:");
    expect(r).toContain("Câu trả lời cuối cùng.");
  });

  it("★★ xoá xong để lại nhiều dòng trống liên tiếp ⇒ gộp gọn (không để lại ≥3 dòng trống)", () => {
    const v = 'Trước.\n\n\n```avi-tool\n{"tool":"doc_tep","args":{"path":"a"}}\n```\n\n\nSau.';
    const r = vanBanKhongRacGiaoThuc(v) as string;
    expect(r).not.toMatch(/\n\s*\n\s*\n/);
    expect(r).toContain("Trước.");
    expect(r).toContain("Sau.");
  });

  it("★ xoá xong KHÔNG còn văn xuôi nào (toàn bộ chỉ là khối) ⇒ câu dự phòng tiếng Việt, KHÔNG PHẢI chuỗi rỗng", () => {
    const v = '```avi-tool\n{"tool":"doc_tep","args":{"path":"a"}}\n```';
    const r = vanBanKhongRacGiaoThuc(v);
    expect(r).not.toBeNull();
    expect(r).not.toBe("");
    expect(String(r).length).toBeGreaterThan(0);
    expect(r).not.toContain("```");
  });

  it("★★★ NHÁNH KIA — khối HỎNG cú pháp (minh hoạ \"điền vào chỗ trống\", không phải JSON hợp lệ) ⇒ null (không đụng gì)", () => {
    // Xem giải thích ở `khoiAviTool.unit.test.ts` — placeholder CÓ ngoặc kép (`"<đường dẫn tệp>"`)
    // vẫn là JSON hợp lệ, KHÔNG rơi vào nhánh này; ca thật sự hỏng là khi cú pháp minh hoạ không
    // đóng đúng (ví dụ `args` là "..." trần).
    const v = 'Cú pháp đọc tệp:\n```avi-tool\n{"tool": "<tên công cụ>", "args": {...}}\n```\nHết.';
    expect(vanBanKhongRacGiaoThuc(v)).toBeNull();
  });

  it("★★★ NHÁNH KIA — code fence KHÁC (```ts) ⇒ null — dữ liệu THẬT từ T01 (đoạn trích code)", () => {
    const v =
      "Trích nguyên văn code:\n```ts\n" +
      "tinhTonKhoConLai(tonDau: number, nhap: number, xuat: number): number {\n" +
      "  return tonDau + nhap - xuat;\n}\n```";
    expect(vanBanKhongRacGiaoThuc(v)).toBeNull();
  });

  it("★★★ NHÁNH KIA — văn xuôi chỉ NHẮC ĐẾN chữ \"avi-tool\" ⇒ null — dữ liệu THẬT từ T06", () => {
    const v = "Vui lòng sử dụng công cụ `avi-tool` để đọc nội dung tệp nếu cần.";
    expect(vanBanKhongRacGiaoThuc(v)).toBeNull();
  });

  it("★★ streaming — văn bản GHÉP từ nhiều mảnh nhỏ, hàng rào mở/đóng nằm ở hai mảnh khác nhau ⇒ vẫn xoá đúng SAU KHI ghép", () => {
    const manh = ["Đang xử lý.\n", "```avi-t", 'ool\n{"tool":"liet_ke",', '"args":{"path":"src"}}\n```', "\nXong việc."];
    const r = vanBanKhongRacGiaoThuc(manh.join(""));
    expect(r).not.toBeNull();
    expect(r).not.toContain("```");
    expect(r).toContain("Đang xử lý.");
    expect(r).toContain("Xong việc.");
  });
});
