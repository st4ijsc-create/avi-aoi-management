/**
 * ★★★ 2026-08-23 · UX LÔ 1 (A2/B3) — LƯỚI CHO **DẤU MÁY-ĐỌC-ĐƯỢC** trong `preview.warnings`.
 *
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC:
 *   • `docMaChan` đọc dấu ở GIỮA câu (bỏ neo `^`)          ⇒ §1 ĐỎ (ca "ngoặc vuông trong văn xuôi")
 *   • `docMaChan` nhận mã chữ thường/mã ngắn               ⇒ §1 ĐỎ (mã phải VIẾT HOA ≥3 ký tự)
 *   • `timMaChan` trả mã cho một danh sách KHÔNG có dấu    ⇒ §2 ĐỎ (nút Xác nhận bị khoá oan)
 *   • `docDanhSachLenh` nhận một câu thường                ⇒ §3 ĐỎ (mọi cảnh báo bị gấp mất)
 *   • vòng ghi→đọc lệch nhau (đổi khuôn một phía)          ⇒ §1/§3 ĐỎ (round-trip)
 */
import { describe, it, expect } from "vitest";
import {
  danhDauDanhSachLenh,
  danhDauMaChan,
  docDanhSachLenh,
  docMaChan,
  NHAN_DANH_SACH_LENH,
  timMaChan,
} from "./aiCodingTuChoi";

describe("§1 — dấu mã-chặn: GHI rồi ĐỌC lại phải ra đúng mã (round-trip)", () => {
  it("★★★ round-trip: danhDauMaChan → docMaChan trả đúng mã, nguyên văn câu vẫn còn", () => {
    const cau = danhDauMaChan("CMD_METACHAR", 'Lệnh chứa ký tự KHÔNG nằm trong tập cho phép (ký tự "à").');
    expect(docMaChan(cau)).toBe("CMD_METACHAR");
    expect(cau).toContain("Lệnh chứa ký tự");
  });

  it("★★★ CA ÂM — cặp ngoặc vuông trong VĂN XUÔI không bị đọc nhầm thành lệnh chặn nút", () => {
    for (const w of [
      "Xem thêm [1] trong tài liệu.",
      "[xem thêm] ở cuối trang",
      "[cmd_metachar] chữ thường không phải mã",
      "[AB] mã quá ngắn",
      "Thư mục chạy: D:\\SOURCES\\x [ghi chú]",
    ]) {
      expect(docMaChan(w), w).toBeNull();
    }
  });

  it("★★ đầu vào méo (không phải chuỗi) ⇒ null, không ném — thẻ duyệt không được chết vì một cảnh báo hỏng", () => {
    for (const xau of [null, undefined, 42, {}, ["[CMD_X] a"]]) {
      expect(docMaChan(xau)).toBeNull();
    }
  });
});

describe("§2 — timMaChan trên CẢ danh sách cảnh báo", () => {
  it("★★★ danh sách có MỘT dấu giữa các câu thường ⇒ trả đúng mã ấy", () => {
    const warnings = [
      "Thư mục chạy: D:\\x",
      danhDauMaChan("CMD_NOT_ALLOWED", 'Lệnh "abc" KHÔNG nằm trong danh sách TRẮNG.'),
      "Hạn giờ 20000 ms.",
    ];
    expect(timMaChan(warnings)).toBe("CMD_NOT_ALLOWED");
  });

  it("★★★ CA ÂM (chống khoá nút oan) — cảnh báo THÔNG TIN thuần (ghi đè/tệp sạch/hạn giờ) ⇒ null", () => {
    expect(
      timMaChan([
        "⚠⚠ LỆNH NÀY GHI ĐÈ TỆP MÃ NGUỒN dưới \"D:\\x\" — nó sửa và LƯU ĐÈ tại chỗ.",
        "Tệp SẠCH (không có thay đổi chưa commit).",
        "Hạn giờ 180000 ms — quá hạn thì CẢ CÂY tiến trình con bị giết.",
      ]),
    ).toBeNull();
    expect(timMaChan([])).toBeNull();
    expect(timMaChan("không phải mảng")).toBeNull();
  });
});

describe("§3 — dấu danh-sách-lệnh (B3): gấp được, mở ra còn NGUYÊN từng dòng", () => {
  const DONG = [
    "• npm run check — Kiểm kiểu toàn bộ mã sản phẩm",
    "• dotnet format <đường-dẫn> ⚠ GHI ĐÈ TỆP MÃ NGUỒN — định dạng lại",
  ];

  it("★★★ round-trip: danhDauDanhSachLenh → docDanhSachLenh trả đúng từng dòng, đúng thứ tự", () => {
    const w = danhDauDanhSachLenh(DONG);
    expect(w.startsWith(NHAN_DANH_SACH_LENH)).toBe(true);
    expect(docDanhSachLenh(w)).toEqual(DONG);
  });

  it("★★★ CA ÂM — câu cảnh báo thường (kể cả câu có chữ DANH_SACH_LENH ở giữa) KHÔNG bị gấp", () => {
    expect(docDanhSachLenh("Hạn giờ 20000 ms")).toBeNull();
    expect(docDanhSachLenh(`Câu nhắc tới ${NHAN_DANH_SACH_LENH} ở giữa`)).toBeNull();
    expect(docDanhSachLenh(NHAN_DANH_SACH_LENH)).toBeNull(); // thiếu xuống dòng ⇒ không có ruột
    expect(docDanhSachLenh(undefined)).toBeNull();
  });
});
