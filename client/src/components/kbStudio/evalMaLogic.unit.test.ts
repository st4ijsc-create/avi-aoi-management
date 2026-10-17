import { describe, expect, it } from "vitest";
import { conDangChay, dauChenh, docTongHop, kieuHuyHieu } from "./evalMaLogic";

describe("evalMaLogic", () => {
  const th = { n: 12, tat: { dat: 10, cut: 0 }, bat: { dat: 8, cut: 1 }, chenh: -2, nguongNhieu: 1, soLuotCoNguCanh: 9, ketLuan: "tut" };

  it("docTongHop đọc đúng hình dạng máy chủ; méo / kết luận lạ ⇒ null (không vẽ số giả)", () => {
    expect(docTongHop(th)).toMatchObject({ n: 12, chenh: -2, ketLuan: "tut", bat: { cut: 1 } });
    expect(docTongHop(null)).toBeNull();
    expect(docTongHop({ ...th, ketLuan: "ok" })).toBeNull();
    expect(docTongHop({ ...th, n: "12" })).toBeNull();
  });

  it("huy hiệu: tụt đỏ · nâng chính · trong nhiễu phụ · còn lại viền", () => {
    expect(kieuHuyHieu("tut")).toBe("destructive");
    expect(kieuHuyHieu("nang")).toBe("default");
    expect(kieuHuyHieu("trong-nhieu")).toBe("secondary");
    expect(kieuHuyHieu("khong-ap-dung")).toBe("outline");
    expect(kieuHuyHieu("khong-do-duoc")).toBe("outline");
  });

  it("dấu chênh + còn chạy", () => {
    expect([dauChenh(2), dauChenh(0), dauChenh(-1)]).toEqual(["+2", "0", "-1"]);
    expect(conDangChay([{ trangThai: "xong" }, { trangThai: "dang-chay" }])).toBe(true);
    expect(conDangChay([{ trangThai: "gian-doan" }])).toBe(false);
  });
});
