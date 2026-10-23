import { describe, expect, it } from "vitest";
import { VAI_TRO_GOC, coYDinhHoacMa, laTenLogicCu, laTenVaiTro, vaiTroTuCauHoiTuDong, vaiTroTuTinHieu, vaiTroVanHanh } from "./aiRoles";

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

// Câu tự viết cho lưới (KHÔNG lấy từ bộ mù 5 — bộ đó chưa ai đọc; cũng không chép nguyên câu DEV-4).
describe("★ Đợt 9 (2026-10-23, DEV-4) — 'soạn', tài liệu sau hai chấm, mẫu, 'bước nào', câu vận hành theo thiết bị, mã dán", () => {
  it("'soạn' + miền mã ⇒ có ý định mã; 'soạn báo cáo' (không miền mã) ⇒ KHÔNG", () => {
    // chỉ "soạn" mang nghĩa sản phẩm mã ở hai câu này (không "chương trình/hàm/script/khối…")
    expect(coYDinhHoacMa("Soạn giúp FB TON trễ 3 giây cho van xả")).toBe(true);
    expect(coYDinhHoacMa("soan file docker-compose cho redis va postgres")).toBe(true);
    expect(coYDinhHoacMa("Soạn giúp báo cáo tổng kết ca đêm gửi quản đốc")).toBe(false);
  });
  it("trích có tài liệu DÁN sau dấu hai chấm / vào MẪU ⇒ extract", () => {
    expect(vaiTroTuCauHoiTuDong("lay danh sach thiet bi can bao tri tu tin nhan cua to truong: may nen khi 2 (xong), bom nuoc 1 (chua), quat hut 4 (chua)")?.vaiTro).toBe("extract");
    expect(vaiTroTuCauHoiTuDong("Điền vào mẫu gồm người báo, thời gian, mô tả lỗi: anh Nam báo lúc 14h máy dán nhãn 2 kẹt cuộn liên tục")?.vaiTro).toBe("extract");
  });
  it("'theo những bước nào' (khái niệm) ⇒ chat; có thiết bị + 'đang' thì không kết luận chat", () => {
    expect(vaiTroTuCauHoiTuDong("Thông thường lập kế hoạch bảo trì phòng ngừa theo những bước nào?")?.vaiTro).toBe("chat");
  });
  it("★★ thiết bị cụ thể + dấu hiện trạng/thời điểm, không ý định mã ⇒ chat.ops", () => {
    expect(vaiTroVanHanh("vi sao may in kem PRT-03 dang bao loi ap suat")?.vaiTro).toBe("chat.ops");
    expect(vaiTroVanHanh("lần gần nhất lò 2 được vệ sinh là ngày nào")?.vaiTro).toBe("chat.ops");
    expect(vaiTroTuCauHoiTuDong("lan cuoi line 4 dung may la luc may gio")?.vaiTro).toBe("chat.ops");
  });
  it("★ vận hành: KHÔNG kết luận khi thiếu thiết bị, thiếu dấu thời điểm, hoặc có ý định viết mã", () => {
    expect(vaiTroVanHanh("máy in kem hoạt động thế nào")).toBeNull(); // không mã thiết bị
    expect(vaiTroVanHanh("SPI-02 là loại máy gì")).toBeNull(); // không dấu hiện trạng/thời điểm
    expect(vaiTroVanHanh("viết ST lưu thời điểm lần cuối máy 3 báo động")).toBeNull(); // ý định mã
    expect(vaiTroTuCauHoiTuDong("viết ST lưu thời điểm lần cuối máy 3 báo động")?.vaiTro).toBe("code.plc");
  });
  it("câu hỏi khái niệm có MÃ DÁN (:= / END_IF) ⇒ KHÔNG kết luận chat", () => {
    // không "đoạn này/code sau" (RE_KEM_MA) — chỉ MÃ DÁN chặn kết luận "chat"
    expect(vaiTroTuCauHoiTuDong("Giải thích giúp mình: IF Start THEN Motor := TRUE; END_IF;")?.vaiTro).not.toBe("chat");
  });
});

describe("★ Đợt 9 (2026-10-23) — hỏi khái niệm KHÔNG DẤU ('cai nao', 'the nao', 'nen dung')", () => {
  it("không dấu ⇒ chat; có thiết bị + 'dang' ⇒ không kết luận chat", () => {
    expect(vaiTroTuCauHoiTuDong("profinet voi ethercat cai nao on dinh hon cho robot")?.vaiTro).toBe("chat");
    expect(vaiTroTuCauHoiTuDong("bo dem cao toc hoat dong the nao")?.vaiTro).toBe("chat");
    expect(vaiTroTuCauHoiTuDong("cai nao trong 2 may AOI-03 va AOI-04 dang loi")?.vaiTro).not.toBe("chat");
  });
});
