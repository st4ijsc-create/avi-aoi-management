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

  it("hàng CŨ (trước thước tập con) ⇒ tapCoDoan null, ketLuanToanBo = ketLuan, không đối chứng", () => {
    expect(docTongHop(th)).toMatchObject({ tapCoDoan: null, ketLuanToanBo: "tut", doiChung: false });
  });

  it("hàng MỚI ⇒ đọc thước tập con + kết luận thước toàn bộ + cờ đối chứng A/A; tập con méo ⇒ null (không vẽ số giả)", () => {
    const moi = {
      ...th,
      ketLuan: "khong-du-bai-co-doan",
      ketLuanToanBo: "tut",
      doiChung: true,
      tapCoDoan: { n: 2, soBai: 2, tat: { dat: 2 }, bat: { dat: 0 }, chenh: -2, nguongNhieu: 1 },
    };
    expect(docTongHop(moi)).toMatchObject({
      ketLuan: "khong-du-bai-co-doan",
      ketLuanToanBo: "tut",
      doiChung: true,
      tapCoDoan: { n: 2, soBai: 2, tat: 2, bat: 0, chenh: -2, nguongNhieu: 1 },
    });
    expect(docTongHop({ ...moi, tapCoDoan: { n: "2" } })?.tapCoDoan).toBeNull();
    expect(docTongHop({ ...moi, ketLuanToanBo: "la" })?.ketLuanToanBo).toBe("khong-du-bai-co-doan");
  });

  it("huy hiệu: tụt đỏ · nâng chính · trong nhiễu phụ · còn lại viền", () => {
    expect(kieuHuyHieu("tut")).toBe("destructive");
    expect(kieuHuyHieu("nang")).toBe("default");
    expect(kieuHuyHieu("trong-nhieu")).toBe("secondary");
    expect(kieuHuyHieu("khong-ap-dung")).toBe("outline");
    expect(kieuHuyHieu("khong-do-duoc")).toBe("outline");
    expect(kieuHuyHieu("khong-du-bai-co-doan")).toBe("outline");
  });

  it("dấu chênh + còn chạy", () => {
    expect([dauChenh(2), dauChenh(0), dauChenh(-1)]).toEqual(["+2", "0", "-1"]);
    expect(conDangChay([{ trangThai: "xong" }, { trangThai: "dang-chay" }])).toBe(true);
    expect(conDangChay([{ trangThai: "gian-doan" }])).toBe(false);
  });
});
