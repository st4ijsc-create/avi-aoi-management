import { describe, expect, it } from "vitest";
import { VAI_TRO_GOC, laTenLogicCu, laTenVaiTro, vaiTroTuTinHieu } from "./aiRoles";

describe("aiRoles — từ vựng vai trò (Đợt 7.0)", () => {
  it("hình dạng tên vai trò", () => {
    expect(laTenVaiTro("code.plc")).toBe(true);
    expect(laTenVaiTro("chat")).toBe(true);
    expect(laTenVaiTro("chat.ops")).toBe(true);
    expect(laTenVaiTro("../x")).toBe(false);
    expect(laTenVaiTro("Code")).toBe(false);
    expect(laTenVaiTro("code.plc.x")).toBe(false);
    expect(laTenVaiTro("")).toBe(false);
    expect(laTenVaiTro(42)).toBe(false);
    expect(laTenVaiTro("Qwen3-4B-Instruct-2507-UD-Q4_K_XL")).toBe(false);
  });

  it("tên logic cũ của /v1 được nhận ra (để giữ nguyên hành vi)", () => {
    for (const t of ["chat", "code", "coder", "fast", "fim", "infill", "embed", "embedding", "embeddings"]) {
      expect(laTenLogicCu(t)).toBe(true);
    }
    expect(laTenLogicCu("code.plc")).toBe(false);
    expect(laTenLogicCu("extract")).toBe(false);
  });

  it("vai trò gốc: hợp lệ, không trùng, đủ 11", () => {
    const ids = VAI_TRO_GOC.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(11);
    for (const id of ids) expect(laTenVaiTro(id)).toBe(true);
    expect(VAI_TRO_GOC.find((v) => v.id === "code.plc")?.envKey).toBe("GGUF_CODE_MODEL");
  });

  it("tín hiệu tất định", () => {
    expect(vaiTroTuTinHieu({ duoiTep: ".SCL" })).toEqual({ vaiTro: "code.plc", bangChung: "đuôi tệp .scl" });
    expect(vaiTroTuTinHieu({ duoiTep: "st" })).toEqual({ vaiTro: "code.plc", bangChung: "đuôi tệp .st" });
    expect(vaiTroTuTinHieu({ loaiDuAn: "plc" })?.vaiTro).toBe("code.plc");
    expect(vaiTroTuTinHieu({ ngonNgu: "Structured-Text" })?.vaiTro).toBe("code.plc");
    expect(vaiTroTuTinHieu({ loaiDuAn: "dotnet" })?.vaiTro).toBe("code.software");
    expect(vaiTroTuTinHieu({ ngonNgu: "typescript" })).toBeNull();
    expect(vaiTroTuTinHieu({})).toBeNull();
  });
});

describe("vaiTroTuCauHoi — tín hiệu chữ tầng 3 (Đợt 7.3)", () => {
  it("ý định viết mã + từ khoá đúng MỘT miền", async () => {
    const { vaiTroTuCauHoi } = await import("./aiRoles");
    expect(vaiTroTuCauHoi("Viết function block ST cho băng tải")?.vaiTro).toBe("code.plc");
    expect(vaiTroTuCauHoi("Sửa lỗi TypeScript trong service")?.vaiTro).toBe("code.software");
    expect(vaiTroTuCauHoi("Viết hàm Go đọc cổng serial")?.vaiTro).toBe("code.software");
    expect(vaiTroTuCauHoi("Giải thích TON khác TOF thế nào")).toBeNull(); // không có ý định viết mã
    expect(vaiTroTuCauHoi("Viết code Python đọc dữ liệu từ PLC")).toBeNull(); // hai miền ⇒ không kết luận
    expect(vaiTroTuCauHoi("viết báo cáo về test hệ thống")).toBeNull(); // "test" không phải "ST"
  });
});

describe("vaiTroTuTacVu / vaiTroTuCauHoiTuDong — tín hiệu tác vụ tầng 3 (Đợt 9)", () => {
  it("tóm tắt / trích / hỏi khái niệm; câu vận hành và câu kèm mã KHÔNG thành chat", async () => {
    const { vaiTroTuTacVu, vaiTroTuCauHoiTuDong, vaiTroTuTinHieu } = await import("./aiRoles");
    expect(vaiTroTuTacVu("Tóm tắt biên bản họp này")?.vaiTro).toBe("summarize");
    expect(vaiTroTuTacVu("Trích mã lỗi từ log sau ra JSON")?.vaiTro).toBe("extract");
    expect(vaiTroTuTacVu("Lấy các trường khách hàng, số lượng từ email này ra bảng")?.vaiTro).toBe("extract");
    expect(vaiTroTuTacVu("TON khác TOF thế nào?")?.vaiTro).toBe("chat");
    expect(vaiTroTuTacVu("Hiện tượng tombstone là gì?")?.vaiTro).toBe("chat"); // "hiện tượng" không phải dấu vận hành
    expect(vaiTroTuTacVu("Tại sao line 3 dừng hôm nay?")).toBeNull(); // dấu vận hành ⇒ để tầng 4
    expect(vaiTroTuTacVu("Tại sao TON trong đoạn ST này không lên Q?")).toBeNull(); // kèm mã
    expect(vaiTroTuTacVu("Tóm tắt rồi trích mã lỗi từ báo cáo này")).toBeNull(); // hai tác vụ ⇒ không kết luận
    expect(vaiTroTuCauHoiTuDong("Chuẩn IEC 61131-3 gồm những ngôn ngữ lập trình nào?")?.vaiTro).toBe("chat");
    expect(vaiTroTuCauHoiTuDong("Viết FB ST cho băng tải")?.vaiTro).toBe("code.plc"); // ý định mã thắng
    // Bề mặt lập trình (`vaiTroTuTinHieu`) KHÔNG nhận vai trò tác vụ.
    expect(vaiTroTuTinHieu({ cauHoi: "Tóm tắt biên bản họp này" })).toBeNull();
  });
});

describe("★ Đợt 9 (a)(b) — cổng ý định mã + không dấu / đồng nghĩa + ranh giới Unicode", () => {
  it("coYDinhHoacMa: động từ (cả không dấu), mã dán, hoặc miền + sản phẩm mã; câu vận hành / dán log thì không", async () => {
    const { coYDinhHoacMa } = await import("./aiRoles");
    expect(coYDinhHoacMa("viet ham python tinh oee")).toBe(true);
    expect(coYDinhHoacMa("Đoạn này sai:\nIF a THEN b := 1; END_IF")).toBe(true);
    expect(coYDinhHoacMa("Làm giúp chương trình đèn giao thông bằng TON trên PLC")).toBe(true);
    expect(coYDinhHoacMa("Script bash nén thư mục ảnh")).toBe(true);
    expect(coYDinhHoacMa("may reflow 1 co dang bao dong ko")).toBe(false);
    expect(coYDinhHoacMa("Gói gọn email này: lô HB2610 bị trả về 37 bo do lệch U3")).toBe(false);
  });

  it("đồng nghĩa + không dấu của tóm tắt / trích", async () => {
    const { vaiTroTuTacVu } = await import("./aiRoles");
    expect(vaiTroTuTacVu("tom gon giup minh doan nay")?.vaiTro).toBe("summarize");
    expect(vaiTroTuTacVu("Recap this for the meeting")?.vaiTro).toBe("summarize");
    expect(vaiTroTuTacVu("Bóc tách ngày, ca, người trực từ lịch sau")?.vaiTro).toBe("extract");
  });

  it("ranh giới chữ là THẬT (bản cũ: `\p` trong template thành 'p'): 'tom tat' trong 'atom tat' không khớp; 'line 3' là dấu vận hành", async () => {
    const { vaiTroTuTacVu } = await import("./aiRoles");
    expect(vaiTroTuTacVu("cho tôi xem atom tatoo")).toBeNull();
    expect(vaiTroTuTacVu("Tại sao line 3 dừng?")).toBeNull(); // dấu vận hành "line 3" ⇒ không kết luận chat
  });
});
