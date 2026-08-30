/**
 * LƯỚI thân yêu cầu SSE. Bất biến sống còn: chế độ LOCAL PHẢI gửi codingMode:false và KHÔNG gửi
 * projectId — vì mã nằm trên máy dev, bật tool server chỉ khiến model đọc nhầm repo của server
 * rồi trả lời tự tin mà sai. Ngược lại chế độ SERVER phải có đủ cặp (codingMode:true + projectId),
 * thiếu projectId thì server im lặng rơi về dự án mặc định — sai mà không báo.
 *
 * ★★★ ĐỢT D.1 (LỖI 1) — vì `codingMode:false` khiến máy chủ KHÔNG dạy giao thức `avi-tool` cho
 * LOCAL (đo Task 6: 0/11 lượt), CHÍNH `dungYeuCauStream` phải tự chèn văn bản dạy đó vào MỌI câu
 * hỏi LOCAL — xem `dayGiaoThucDoc.ts`. Nhóm ca cuối tệp canh bất biến MỚI này.
 */
import { describe, it, expect } from "vitest";
import { dungYeuCauStream } from "./yeuCau";
import { dungVanBanDayGiaoThucDoc, nhacLaiCuoiCauHoi } from "./dayGiaoThucDoc";

const CHUNG = { cauHoi: "Hàm Divide sai chỗ nào?", nguCanh: "--- TỆP ---\nCODE\n", lichSu: [], ngonNgu: "vi", vaiTro: "engineer" };

describe("dungYeuCauStream", () => {
  it("★★★ LOCAL: codingMode=false và KHÔNG có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "d:/du-an" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(false);
    expect("projectId" in ctx).toBe(false);
  });

  it("★★★ SERVER: codingMode=true VÀ có projectId", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" } });
    const ctx = t.context as Record<string, unknown>;
    expect(ctx.codingMode).toBe(true);
    expect(ctx.projectId).toBe("csharp");
  });

  it("★★★ ngữ cảnh đứng TRƯỚC câu hỏi trong `question`", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    expect(q.indexOf("--- TỆP ---")).toBeLessThan(q.indexOf("Hàm Divide sai chỗ nào?"));
  });

  it("★★ ngữ cảnh RỖNG, chế độ LOCAL ⇒ question là (giáo thức dạy avi-tool + câu hỏi), KHÔNG có khung ngữ cảnh trống", () => {
    // ★★★ ĐỢT D.1 — trước đây `question === "Hàm Divide sai chỗ nào?"` NGUYÊN VĂN (không tiền tố).
    // Nay LOCAL luôn được dạy giao thức (LỖI 1), kể cả khi không có ngữ cảnh mã đính kèm — chỉ
    // riêng KHUNG NGỮ CẢNH (nhãn "--- NGUỒN ..."/"--- TỆP ..." trống) là thứ vẫn phải vắng mặt.
    const t = dungYeuCauStream({ ...CHUNG, nguCanh: "", cheDo: { loai: "local", nhan: "x" } });
    expect(t.question).toBe(
      `${dungVanBanDayGiaoThucDoc()}\n\nHàm Divide sai chỗ nào?${nhacLaiCuoiCauHoi()}`,
    );
    expect(String(t.question)).not.toContain("--- NGUỒN");
  });

  it("★★ route khai đúng nguồn gọi để server phân biệt với web", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    expect((t.context as Record<string, unknown>).route).toBe("vscode");
  });

  it("★★ lịch sử đi nguyên vẹn", () => {
    const ls = [{ role: "user" as const, content: "trước đó" }];
    const t = dungYeuCauStream({ ...CHUNG, lichSu: ls, cheDo: { loai: "local", nhan: "x" } });
    expect(t.history).toEqual(ls);
  });

  it("★★★ I5: chế độ LOCAL — question nêu rõ mã đính kèm đọc từ máy LOCAL", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "d:/du-an" } });
    const q = String(t.question);
    expect(q).toContain("LOCAL");
    expect(q).toContain("d:/du-an");
  });

  it("★★★ I5: chế độ SERVER — question phân biệt được nguồn mã dán (LOCAL) với dự án SERVER (cây khác)", () => {
    const t = dungYeuCauStream({
      ...CHUNG,
      cheDo: { loai: "server", projectId: "csharp", nhan: "Demo Csharp" },
    });
    const q = String(t.question);
    expect(q).toContain("LOCAL");
    expect(q).toContain("Demo Csharp");
    expect(q).toContain("KHÔNG PHẢI"); // hai nguồn phải được nói RÕ là khác nhau, không chỉ liệt kê tên
  });

  it("★★ I5: ngữ cảnh RỖNG ⇒ KHÔNG dán nhãn nguồn thừa (không đẻ khung trống)", () => {
    const t = dungYeuCauStream({ ...CHUNG, nguCanh: "", cheDo: { loai: "server", projectId: "c", nhan: "Demo" } });
    expect(t.question).toBe("Hàm Divide sai chỗ nào?");
  });
});

describe("dungYeuCauStream — ĐỢT D.1 (LỖI 1): LOCAL tự dạy giao thức avi-tool", () => {
  it("★★★ LOCAL ⇒ question chứa NGUYÊN VĂN văn bản dạy giao thức, đứng TRƯỚC cả ngữ cảnh lẫn câu hỏi", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    const giaoThuc = dungVanBanDayGiaoThucDoc();
    expect(q.startsWith(giaoThuc)).toBe(true);
    expect(q.indexOf(giaoThuc)).toBeLessThan(q.indexOf("--- TỆP ---"));
    expect(q.indexOf("--- TỆP ---")).toBeLessThan(q.indexOf("Hàm Divide sai chỗ nào?"));
  });

  it("★★★ SERVER ⇒ KHÔNG dạy giao thức avi-tool (server có vòng tool riêng, chạy trên hộp cát máy chủ)", () => {
    // Đối chứng bắt buộc: dạy avi-tool cho SERVER là dạy một giao thức không ai đọc (server không
    // parse khối này — chỉ extension LOCAL mới parse). Một bản vá vô tình chèn cho CẢ hai chế độ
    // sẽ làm ca này đỏ.
    const t = dungYeuCauStream({
      ...CHUNG,
      cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" },
    });
    expect(String(t.question)).not.toContain(dungVanBanDayGiaoThucDoc());
  });

  it("★★ LOCAL, có lịch sử hội thoại ⇒ vẫn dạy lại giao thức ở MỌI lượt (không chỉ lượt đầu)", () => {
    // Mỗi lượt hỏi dựng MỘT `question` độc lập gửi lên máy chủ — máy chủ không "nhớ" đã dạy ở lượt
    // trước (lịch sử `history` không mang theo hướng dẫn hệ thống). Không dạy lại ở lượt sau tái
    // tạo đúng lỗ 0% đo được nếu ai đó "tối ưu" bằng cách chỉ dạy lượt đầu.
    const ls = [{ role: "user" as const, content: "câu trước" }, { role: "assistant" as const, content: "trả lời trước" }];
    const t = dungYeuCauStream({ ...CHUNG, lichSu: ls, cheDo: { loai: "local", nhan: "x" } });
    expect(String(t.question)).toContain(dungVanBanDayGiaoThucDoc());
  });

  /**
   * ★★★ VÒNG ĐO LẠI THỨ NHẤT — đo LIVE (11 câu Step 2) ngay sau khi có `dungVanBanDayGiaoThucDoc`
   * NHƯNG chưa có `nhacLaiCuoiCauHoi`: 1/11 đúng cú pháp, 10/11 model trả nguyên văn câu mẫu của
   * luật "NGUYÊN TẮC TRẢ LỜI" ("Tôi không có thông tin chính xác..."). Ba ca dưới đây canh bản vá
   * thứ hai: nhắc lại NGẮN ở CUỐI `question`, gần điểm model sinh chữ nhất.
   */
  it("★★★ LOCAL ⇒ question KẾT THÚC bằng câu nhắc lại (gần điểm sinh chữ nhất — vị trí có trọng số cao hơn)", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    expect(q.endsWith(nhacLaiCuoiCauHoi())).toBe(true);
    // Và câu hỏi GỐC phải đứng NGAY TRƯỚC câu nhắc — không có gì chen giữa làm loãng liên kết.
    expect(q.indexOf("Hàm Divide sai chỗ nào?") + "Hàm Divide sai chỗ nào?".length).toBe(
      q.indexOf(nhacLaiCuoiCauHoi()),
    );
  });

  it("★★ SERVER ⇒ KHÔNG có câu nhắc lại cuối (cùng lý do không dạy giao thức đầu prompt)", () => {
    const t = dungYeuCauStream({
      ...CHUNG,
      cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" },
    });
    expect(String(t.question)).not.toContain(nhacLaiCuoiCauHoi());
  });

  it("★ câu nhắc lại KHÔNG chép tay cú pháp hàng rào — dùng ĐÚNG NHAN_HANG_RAO", () => {
    // Chống-trôi: câu nhắc và văn bản dạy đầy đủ đều phải nhắc tới ĐÚNG một nhãn hàng rào.
    const nhac = nhacLaiCuoiCauHoi();
    expect(nhac).toContain("```avi-tool```");
  });
});

describe("dungYeuCauStream — H3(b) (review toàn nhánh 2026-08-30): `laCmdK` tắt giao thức dạy-đọc", () => {
  /**
   * Cmd+K mang giao thức RIÊNG của nó ngay trong `cauHoi` (`de_xuat_sua_doan` + `dongDau`/
   * `dongCuoi` cố định, xem `loi/cauHoiSuaChon.ts`). Giao thức dạy-đọc (ba tool ĐỌC) chèn CẠNH nó
   * làm model có hai chỉ dẫn cạnh tranh; trước bản vá, `laCmdK` chưa tồn tại nên LOCAL luôn bị dạy
   * bất kể nguồn gốc câu hỏi.
   */
  it("★★★ LOCAL + laCmdK:true ⇒ KHÔNG có văn bản dạy giao thức đọc lẫn câu nhắc cuối", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" }, laCmdK: true });
    const q = String(t.question);
    expect(q).not.toContain(dungVanBanDayGiaoThucDoc());
    expect(q).not.toContain(nhacLaiCuoiCauHoi());
    // ⚠ CHỐNG TỰ THOẢ: câu hỏi GỐC + ngữ cảnh vẫn phải còn nguyên — không phải cả `question` bị
    // xoá sạch, chỉ riêng phần dạy giao thức đọc mới vắng mặt.
    expect(q).toContain("Hàm Divide sai chỗ nào?");
    expect(q).toContain("--- TỆP ---");
  });

  it("★★ NHÁNH KIA: LOCAL + laCmdK KHÔNG đặt (mặc định) ⇒ vẫn dạy giao thức đọc như cũ", () => {
    const t = dungYeuCauStream({ ...CHUNG, cheDo: { loai: "local", nhan: "x" } });
    const q = String(t.question);
    expect(q).toContain(dungVanBanDayGiaoThucDoc());
    expect(q).toContain(nhacLaiCuoiCauHoi());
  });

  it("★ SERVER + laCmdK:true ⇒ vẫn KHÔNG dạy giao thức đọc (cùng lý do không dạy cho SERVER)", () => {
    // Đối chứng: `laCmdK` không được BẬT LẠI thứ mà chế độ SERVER đã tắt vì lý do khác.
    const t = dungYeuCauStream({
      ...CHUNG,
      cheDo: { loai: "server", projectId: "csharp", nhan: "Demo" },
      laCmdK: true,
    });
    expect(String(t.question)).not.toContain(dungVanBanDayGiaoThucDoc());
  });
});
