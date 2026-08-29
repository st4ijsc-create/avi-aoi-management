/**
 * Nhãn thẻ duyệt là HÀNG RÀO (spec §7): nó là thứ duy nhất nói cho người bấm biết byte sẽ rơi ở
 * MÁY CHỦ hay trên ĐĨA CỦA CHÍNH HỌ. Lưới khoá cả hai chiều — mỗi câu phải nói đúng nơi ghi của
 * mình VÀ không được mang chữ của chế độ kia.
 */
import { describe, it, expect } from "vitest";
import { nhanNguonTheDuyet, nhanNutGhi } from "./nhanTheDuyet";

describe("nhanNguonTheDuyet", () => {
  it("★★★ luôn có tiền tố chế độ", () => {
    expect(nhanNguonTheDuyet({ loai: "local", nhan: "d:\\SOURCES\\avi" })).toBe("LOCAL · d:\\SOURCES\\avi");
    expect(nhanNguonTheDuyet({ loai: "server", nhan: "Demo Csharp" })).toBe("SERVER · Demo Csharp");
  });

  it("★★★ KHÔNG nhân đôi tiền tố khi nhãn đã có sẵn (gopDanhSachDuAn đã gắn)", () => {
    expect(nhanNguonTheDuyet({ loai: "server", nhan: "SERVER · Demo Csharp" })).toBe("SERVER · Demo Csharp");
    expect(nhanNguonTheDuyet({ loai: "local", nhan: "LOCAL · d:\\ws" })).toBe("LOCAL · d:\\ws");
  });

  it("★★★ nhãn RỖNG vẫn ra một nhãn CÓ tiền tố (bịt nhánh rơi-về `\"workspace\"` trần)", () => {
    // `bangChat.cheDoHienTai()` rơi về nhãn "workspace" khi danh sách dự án rỗng. Một thẻ duyệt
    // không tiền tố là đúng thứ hàng rào này sinh ra để chặn.
    expect(nhanNguonTheDuyet({ loai: "local", nhan: "" })).toBe("LOCAL · workspace");
    expect(nhanNguonTheDuyet({ loai: "local", nhan: "   " })).toBe("LOCAL · workspace");
  });

  it("★★ nhãn của hai chế độ KHÔNG BAO GIỜ trùng nhau cho cùng một tên", () => {
    expect(nhanNguonTheDuyet({ loai: "local", nhan: "x" })).not.toBe(nhanNguonTheDuyet({ loai: "server", nhan: "x" }));
  });
});

describe("nhanNutGhi", () => {
  it("★★★ LOCAL nói ghi vào workspace, và KHÔNG được mang chữ SERVER", () => {
    const s = nhanNutGhi("local");
    expect(s).toContain("workspace");
    expect(s).not.toContain("SERVER");
  });

  it("★★★ SERVER nói ghi trên SERVER, và KHÔNG được hứa ghi vào workspace", () => {
    const s = nhanNutGhi("server");
    expect(s).toContain("SERVER");
    expect(s).not.toContain("workspace");
  });

  it("★★★ hai câu phải KHÁC NHAU (nếu trùng thì nhãn hết tác dụng phân biệt)", () => {
    expect(nhanNutGhi("local")).not.toBe(nhanNutGhi("server"));
  });
});
