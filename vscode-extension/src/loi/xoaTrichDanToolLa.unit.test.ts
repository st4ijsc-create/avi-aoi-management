/**
 * LƯỚI cho `vanBanKhongTrichDanToolLa` — PDCA vòng 4 (round 4, `pdca5-report.md`). Xem docblock
 * `xoaTrichDanToolLa.ts` cho bối cảnh đầy đủ (đo LIVE xác nhận vòng tool VẬN HÀNH của máy chủ chạy
 * NHẦM trên câu hỏi đã bọc giáo cụ avi-tool, dán trích dẫn tool THẬT-nhưng-KHÔNG-LIÊN-QUAN vào cuối
 * câu trả lời — 9/11 tác vụ vòng 3 dính, kể cả các tác vụ đang ĐẠT).
 */
import { describe, it, expect } from "vitest";
import { vanBanKhongTrichDanToolLa } from "./xoaTrichDanToolLa";

describe("vanBanKhongTrichDanToolLa", () => {
  it("★★★ văn bản KHÔNG có trích dẫn nào ⇒ null (giữ nguyên hành vi cũ)", () => {
    const v = "Hàm `tinhTonKhoConLai` tính tồn kho còn lại = tồn đầu kỳ + nhập - xuất.";
    expect(vanBanKhongTrichDanToolLa(v)).toBeNull();
  });

  it("★★★ dữ liệu THẬT T09 (`pdca4-T09-raw.json`) — dòng \"Nguồn số liệu: daily_statistics\" bị xoá, giữ nguyên phần văn xuôi", () => {
    // Trích NGUYÊN VĂN một đoạn của `vanBanCuoi` thật (rút gọn, giữ đúng mẫu dòng trích dẫn).
    const v =
      "Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại. Hàm `tinhLoiNhuanRongSauThue` không được đề cập trong bất kỳ ngữ cảnh nào được cung cấp.\n\n" +
      "_Nguồn số liệu: `daily_statistics` · 1 hàng_";
    const r = vanBanKhongTrichDanToolLa(v);
    expect(r).not.toBeNull();
    expect(r).not.toContain("Nguồn số liệu");
    expect(r).not.toContain("daily_statistics");
    expect(r).toContain("Tôi không có thông tin chính xác");
  });

  it("★★★ dữ liệu THẬT T03 (`pdca4-T03-raw.json`) — ghi chú \"Đa bước\" (get_ng_compare → read_file) bị xoá, KHÔNG đụng công thức đúng bên dưới", () => {
    const v =
      "Không thể xác định được tệp có hàm tính phí vận chuyển hay công thức tính phí.\n\n" +
      "<sub>Đa bước: 2 lượt gọi tool (get_ng_compare → read_file), 864 ms.</sub>\n" +
      "```ts\n" +
      "export function tinhPhiVanChuyen(khoiLuongKg: number): number {\n" +
      "  const phi = khoiLuongKg * 15000;\n" +
      "  return Math.max(phi, 20000);\n}\n```\n" +
      "_Nguồn số liệu: `daily_statistics` · 1 hàng_";
    const r = vanBanKhongTrichDanToolLa(v) as string;
    expect(r).not.toBeNull();
    expect(r).not.toContain("Đa bước");
    expect(r).not.toContain("get_ng_compare");
    expect(r).not.toContain("read_file");
    expect(r).not.toContain("Nguồn số liệu");
    // Nội dung THẬT (công thức đúng) phải còn nguyên — đây là phần người dùng cần.
    expect(r).toContain("tinhPhiVanChuyen");
    expect(r).toContain("15000");
  });

  it("★★ ba ngôn ngữ (EN/ZH) của cả hai mẫu đều bị xoá — không chỉ bản tiếng Việt", () => {
    const en =
      "The answer is 42.\n\n<sub>Multi-step: 2 tool calls (get_oee → get_today_stats), 500 ms.</sub>\n\n" +
      "_Data source: `oee_metrics` · 3 rows_";
    const rEn = vanBanKhongTrichDanToolLa(en);
    expect(rEn).not.toBeNull();
    expect(rEn).not.toContain("Multi-step");
    expect(rEn).not.toContain("Data source");
    expect(rEn).toContain("The answer is 42.");

    const zh = "答案是 42。\n\n<sub>多步：2 次工具调用（get_oee → get_today_stats），500 毫秒。</sub>\n\n_数据来源: `oee_metrics` · 3 行_";
    const rZh = vanBanKhongTrichDanToolLa(zh);
    expect(rZh).not.toBeNull();
    expect(rZh).not.toContain("多步");
    expect(rZh).not.toContain("数据来源");
    expect(rZh).toContain("答案是 42。");
  });

  it("★★ xoá xong để lại nhiều dòng trống liên tiếp ⇒ gộp gọn (không để lại ≥3 dòng trống)", () => {
    const v = "Trước.\n\n\n_Nguồn số liệu: `machines` · 1 hàng_\n\n\nSau.";
    const r = vanBanKhongTrichDanToolLa(v) as string;
    expect(r).not.toMatch(/\n\s*\n\s*\n/);
    expect(r).toContain("Trước.");
    expect(r).toContain("Sau.");
  });

  it("★ xoá xong KHÔNG còn văn xuôi nào (toàn bộ chỉ là trích dẫn) ⇒ câu dự phòng tiếng Việt, KHÔNG PHẢI chuỗi rỗng", () => {
    const v = "_Nguồn số liệu: `daily_statistics` · 1 hàng_";
    const r = vanBanKhongTrichDanToolLa(v);
    expect(r).not.toBeNull();
    expect(r).not.toBe("");
    expect(String(r).length).toBeGreaterThan(0);
    expect(r).not.toContain("Nguồn số liệu");
  });

  it("★★★ NHÁNH KIA — câu văn xuôi chỉ NHẮC ĐẾN chữ \"nguồn số liệu\"/\"data source\" theo văn phong khác ⇒ null (không đụng)", () => {
    // Không khớp mẫu CỐ ĐỊNH (thiếu dấu gạch dưới bọc, hoặc không nằm đầu dòng, hoặc thiếu dấu `:`
    // ngay sau nhãn) ⇒ đây là văn xuôi THẬT của model, không phải trích dẫn máy chủ dán vào.
    const v = "Bạn nên kiểm tra nguồn số liệu trước khi tin vào con số này — đây không phải một trích dẫn chính thức.";
    expect(vanBanKhongTrichDanToolLa(v)).toBeNull();
  });

  it("★★★ NHÁNH KIA — khối ```avi-tool``` hợp lệ KHÔNG bị đụng (đây là việc của `xoaRacGiaoThuc.ts`, không phải hàm này)", () => {
    const v = 'Cần đọc tệp:\n```avi-tool\n{"tool":"doc_tep","args":{"path":"a.ts"}}\n```\nXong.';
    expect(vanBanKhongTrichDanToolLa(v)).toBeNull();
  });

  it("★★★ NHÁNH KIA — cảnh báo AN TOÀN hợp lệ (`> ⚠ **Chưa lấy được số liệu sống**...`) KHÔNG bị đụng — đây là câu nói thật cần giữ, khác hẳn trích dẫn tool", () => {
    const v =
      "Câu trả lời dựa trên tài liệu.\n\n> ⚠ **Chưa lấy được số liệu sống** (lý do: `LLM_FETCH_ERROR`). Câu trả lời dưới đây chỉ dựa trên TÀI LIỆU — đừng đọc nó như tình trạng hiện trường.";
    expect(vanBanKhongTrichDanToolLa(v)).toBeNull();
  });

  it("★★ dòng trích dẫn KHÔNG nằm ở CUỐI câu (bị theo sau bởi văn xuôi khác) vẫn bị xoá đúng — không giả định vị trí cố định", () => {
    const v = "Đầu.\n\n_Nguồn số liệu: `product_inspections` · 10 hàng_\n\nCuối, vẫn còn nguyên.";
    const r = vanBanKhongTrichDanToolLa(v) as string;
    expect(r).not.toContain("Nguồn số liệu");
    expect(r).toContain("Đầu.");
    expect(r).toContain("Cuối, vẫn còn nguyên.");
  });
});
