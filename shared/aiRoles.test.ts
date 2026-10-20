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
