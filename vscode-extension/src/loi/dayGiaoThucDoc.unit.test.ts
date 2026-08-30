/**
 * LƯỚI văn bản dạy giao thức `avi-tool` (Đợt D.1, LỖI 1).
 *
 * Bài học đắt nhất mà tệp này phải canh: một văn bản dạy CHÉP TAY cú pháp hàng rào có thể trôi
 * khỏi parser thật (`tachKhoiAviTool`/`docYeuCauDoc`) mà không lỗi biên dịch nào bắt được — đó
 * đúng là LỖI 2 (hàng rào thụt lề) tái diễn dưới một hình dạng khác nếu ví dụ dạy dùng SAI cú
 * pháp. Ca ★★★ dưới đây đóng vòng lặp: dựng văn bản dạy → đưa qua ĐÚNG parser thật (`yeuCauDoc.ts`,
 * dùng chung `khoiAviTool.ts`) → khẳng định parser đọc được cả ba ví dụ. Một thay đổi vô tình làm
 * lệch cú pháp ví dụ (đổi nhãn hàng rào, đổi tên trường, quên `args`, …) sẽ làm CHÍNH ca này đỏ,
 * không phải chỉ một so khớp chuỗi hời hợt.
 */
import { describe, it, expect } from "vitest";
import { dungVanBanDayGiaoThucDoc, nhacLaiCuoiCauHoi } from "./dayGiaoThucDoc";
import { docYeuCauDoc } from "./yeuCauDoc";
import { NHAN_HANG_RAO } from "./khoiAviTool";

describe("dungVanBanDayGiaoThucDoc", () => {
  it("★★★ ba ví dụ dạy đều là hàng rào THẬT — ĐÚNG parser thật (`docYeuCauDoc`) đọc được cả ba, không lệch cú pháp", () => {
    // ★★★ Đây là hàng rào chống-trôi thật sự: không so khớp chuỗi, mà chạy văn bản dạy qua CHÍNH
    // đường dẫn model→parser sẽ dùng khi model bắt chước ví dụ này. Ví dụ dạy dùng SAI cú pháp
    // (nhãn hàng rào lệch, thiếu `args`, sai tên trường) sẽ làm ca này đỏ ngay tại đây.
    const ds = docYeuCauDoc(dungVanBanDayGiaoThucDoc());
    expect(ds).toEqual([
      { loai: "doc_tep", path: "<đường dẫn tệp>" },
      { loai: "liet_ke", path: "<đường dẫn thư mục>" },
      { loai: "grep", mau: "<mẫu cần tìm>", path: "<thư mục, tuỳ chọn>" },
    ]);
  });

  it("★★ nhãn hàng rào trong văn bản dạy đến từ ĐÚNG `NHAN_HANG_RAO` (`khoiAviTool.ts`) — không chép tay", () => {
    // Không kiểm chuỗi cứng "avi-tool" ở đây — kiểm đúng HẰNG SỐ mà parser thật dùng để dựng regex,
    // để đổi nhãn hàng rào ở MỘT chỗ (`khoiAviTool.ts`) tự động phản ánh vào ca này.
    const v = dungVanBanDayGiaoThucDoc();
    expect(v).toContain("```" + NHAN_HANG_RAO);
    expect((v.match(new RegExp("```" + NHAN_HANG_RAO, "g")) ?? []).length).toBe(3);
  });

  it("★★ dạy đủ BA tool đọc, mỗi lượt trả lời CHỈ MỘT khối", () => {
    const v = dungVanBanDayGiaoThucDoc();
    expect(v).toContain("doc_tep");
    expect(v).toContain("liet_ke");
    expect(v).toContain("grep");
    expect(v).toContain("CHỈ MỘT khối");
  });

  it("★ hàm THUẦN — gọi hai lần cho kết quả giống hệt nhau", () => {
    expect(dungVanBanDayGiaoThucDoc()).toBe(dungVanBanDayGiaoThucDoc());
  });

  it("★★★ nói THẲNG đang ghi đè luật \"NGUYÊN TẮC TRẢ LỜI\" của máy chủ — không chỉ dạy cú pháp suông", () => {
    // ★★★ Đo LIVE (vòng đo lại thứ nhất): dạy cú pháp SUÔNG (không nói tới luật đang cạnh tranh) chỉ
    // đạt 1/11 — model tuân luật "trả lời câu mẫu khi ngữ cảnh không khớp" của máy chủ ở 10/11 lượt.
    // Ca này khoá lại phần văn bản GIẢI QUYẾT đúng xung đột đó, để một bản "dọn dẹp câu chữ" sau này
    // không vô tình xoá mất đoạn ghi đè luật — thứ đã được ĐO LÀ CÓ TÁC DỤNG, không phải trang trí.
    const v = dungVanBanDayGiaoThucDoc();
    expect(v).toContain("Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại");
    expect(v).toContain("ĐỪNG trả lời");
  });
});

describe("nhacLaiCuoiCauHoi", () => {
  it("★★★ nhắc ĐÚNG nhãn hàng rào thật (NHAN_HANG_RAO), không chép tay", () => {
    const v = nhacLaiCuoiCauHoi();
    expect(v).toContain("```" + NHAN_HANG_RAO + "```");
  });

  it("★★ nhắc điều kiện kích hoạt, KHÔNG dạy lại toàn bộ cú pháp (tránh trùng lặp làm loãng cả hai)", () => {
    const v = nhacLaiCuoiCauHoi();
    // Không được chứa ví dụ JSON đầy đủ (đó là việc của `dungVanBanDayGiaoThucDoc`) — câu nhắc chỉ
    // là một câu văn ngắn.
    expect(v).not.toContain("doc_tep");
    expect(v.length).toBeLessThan(300);
  });

  it("★ hàm THUẦN — gọi hai lần cho kết quả giống hệt nhau", () => {
    expect(nhacLaiCuoiCauHoi()).toBe(nhacLaiCuoiCauHoi());
  });
});
