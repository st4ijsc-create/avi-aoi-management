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
import { TEN_TOOL_MCP } from "./yeuCauMcp";
import { TEN_TOOL_DE_XUAT_NHO } from "./deXuatNho";

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

  it("★★★ PDCA vòng 3 — nhánh ghi đè THỨ HAI cho yêu cầu VIẾT MÃ MỚI (không cần đọc tệp)", () => {
    // ★★★ Đo LIVE (`pdca4-gta.cjs`, ablation bật/tắt TOÀN BỘ khối dạy): với teaching CŨ (chỉ có
    // nhánh ĐỌC), 0/3 câu "viết hàm mới" giao được mã — 1/3 lạc vào vòng đọc tìm một tệp KHÔNG TỒN
    // TẠI, 2/3 trả nguyên văn câu mẫu bị cấm vì điều kiện ghi-đè nhánh ĐỌC không khớp (không có tệp
    // nào để "cần nội dung"). Ca này khoá lại nhánh ghi đè THỨ HAI, riêng cho ca "viết mã mới, không
    // cần đọc tệp" — không được lẫn vào/thay thế nhánh ĐỌC ở trên.
    const v = dungVanBanDayGiaoThucDoc();
    expect(v).toContain("VIẾT MỘT ĐOẠN MÃ/HÀM HOÀN TOÀN MỚI");
    expect(v).toContain("viết THẲNG đoạn mã được yêu cầu");
    // Nhánh ĐỌC vẫn nguyên vẹn — đây là một câu THÊM, không phải câu THAY (★ khuôn "vá xong phải
    // kiểm NHÁNH KIA").
    expect(v).toContain("doc_tep");
    expect(v).toContain("CHỈ MỘT khối");
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

  it("★★★ PDCA vòng 3 — cũng nhắc lại nhánh \"viết mã MỚI\" ở CUỐI câu hỏi, cùng lý do trọng số vị trí", () => {
    // Đúng lý do đã đo cho nhánh ĐỌC (LỖI 1): một chỉ dẫn chỉ nằm ở ĐẦU prompt thua luật máy chủ ở
    // phần lớn lượt — nhánh "viết mã MỚI" (LỖ HỔNG THỨ HAI) cũng cần một bản nhắc NGẮN ở cuối, gần
    // điểm sinh chữ nhất, không chỉ dạy một lần ở đầu.
    const v = nhacLaiCuoiCauHoi();
    expect(v).toContain("viết mã MỚI");
    expect(v.length).toBeLessThan(300);
  });

  it("★ hàm THUẦN — gọi hai lần cho kết quả giống hệt nhau", () => {
    expect(nhacLaiCuoiCauHoi()).toBe(nhacLaiCuoiCauHoi());
  });
});

// ★★★ ĐỢT H / TASK H5 — H4 đo `de_xuat_nho`/`mcp_goi` (dạy Ở ĐẦU) bị bỏ qua 0/5 vì KHÔNG có bản
// nhắc lại ở CUỐI câu hỏi như ba tool đọc đã có. Nhóm ca dưới đây khoá lại phần mở rộng đó.
describe("nhacLaiCuoiCauHoi — ĐỢT H / TASK H5 (nhắc de_xuat_nho + mcp_goi ở cuối, CÓ ĐIỀU KIỆN)", () => {
  it("★★★ KHÔNG đối số (hoặc cả hai cờ tắt) ⇒ GIỐNG HỆT byte-đúng bản TRƯỚC H5 — đối chứng NHÁNH KIA bắt buộc cho B3 (không loãng giao thức ĐỌC đang chạy tốt)", () => {
    const truoc =
      "\n\n(Nhắc lại: nếu câu hỏi trên cần nội dung một tệp bạn chưa có, hãy phát khối ```" +
      NHAN_HANG_RAO +
      "``` như đã hướng dẫn; nếu câu hỏi là yêu cầu viết mã MỚI (không cần đọc tệp), hãy viết THẲNG " +
      "mã đó — cả hai ca ĐỪNG trả lời \"không có thông tin\".)";
    expect(nhacLaiCuoiCauHoi()).toBe(truoc);
    expect(nhacLaiCuoiCauHoi({})).toBe(truoc);
    expect(nhacLaiCuoiCauHoi({ coMcp: false, coBoNho: false })).toBe(truoc);
  });

  it("★★★ coMcp:true ⇒ thêm câu nhắc mcp_goi, dùng ĐÚNG TEN_TOOL_MCP thật (không chép tay)", () => {
    const v = nhacLaiCuoiCauHoi({ coMcp: true });
    expect(v).toContain(TEN_TOOL_MCP);
    expect(v).toContain("```" + NHAN_HANG_RAO + "```");
    // Nhánh ĐỌC vẫn còn nguyên — đây là câu THÊM, không phải câu THAY (khuôn PDCA vòng 3).
    expect(v).toContain("viết mã MỚI");
    // Chưa bật bộ nhớ ⇒ không có tên tool đề xuất nhớ.
    expect(v).not.toContain(TEN_TOOL_DE_XUAT_NHO);
  });

  it("★★★ coBoNho:true ⇒ thêm câu nhắc de_xuat_nho, dùng ĐÚNG TEN_TOOL_DE_XUAT_NHO thật (không chép tay)", () => {
    const v = nhacLaiCuoiCauHoi({ coBoNho: true });
    expect(v).toContain(TEN_TOOL_DE_XUAT_NHO);
    expect(v).toContain("```" + NHAN_HANG_RAO + "```");
    expect(v).not.toContain(TEN_TOOL_MCP);
  });

  it("★★ CẢ HAI bật ⇒ question chứa cả hai tên tool, không cái nào ghi đè cái nào", () => {
    const v = nhacLaiCuoiCauHoi({ coMcp: true, coBoNho: true });
    expect(v).toContain(TEN_TOOL_MCP);
    expect(v).toContain(TEN_TOOL_DE_XUAT_NHO);
  });

  it("★ chuỗi kết thúc bằng đúng MỘT dấu ) đóng, không lệch cặp ngoặc dù bật/tắt cờ nào", () => {
    for (const dv of [{}, { coMcp: true }, { coBoNho: true }, { coMcp: true, coBoNho: true }]) {
      const v = nhacLaiCuoiCauHoi(dv);
      expect(v.endsWith(")")).toBe(true);
      expect(v.startsWith("\n\n(")).toBe(true);
    }
  });

  it("★ hàm THUẦN với cùng tham số ⇒ kết quả giống hệt nhau", () => {
    expect(nhacLaiCuoiCauHoi({ coMcp: true, coBoNho: true })).toBe(nhacLaiCuoiCauHoi({ coMcp: true, coBoNho: true }));
  });
});
