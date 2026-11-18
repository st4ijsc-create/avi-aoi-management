import { describe, expect, it } from "vitest";
import { docTheViec } from "./theViec";

const the = (them: string) => `MÃ: TC-90
MỤC TIÊU: thử trần
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 15 phút, 8 vòng${them}`;

describe("khoá thẻ TRẦN … (HA-3)", () => {
  it("★★★ thẻ KHÔNG có khoá TRẦN ⇒ không có `tran`; chữ tự do '8 vòng' vẫn chỉ vào gioiHan.vong (không thành trần)", () => {
    const r = docTheViec(the(""));
    expect(r.ok && "tran" in r.the).toBe(false);
    expect(r.ok && r.the.gioiHan).toEqual({ giay: 900, vong: 8 });
  });
  it("★★★ ba khoá hợp lệ ⇒ the.tran đủ ba số", () => {
    const r = docTheViec(the("\nTRẦN LƯỢT MODEL: 60\nTRẦN PHÚT: 25\nTRẦN TOKEN RA: 90000"));
    expect(r.ok && r.the.tran).toEqual({ luotModel: 60, phut: 25, tokenRa: 90_000 });
  });
  it("★★ chỉ một khoá ⇒ chỉ khoá đó", () => {
    const r = docTheViec(the("\nTRẦN LƯỢT MODEL: 20"));
    expect(r.ok && r.the.tran).toEqual({ luotModel: 20 });
  });
  it("★★ thiếu dấu (TRAN LUOT MODEL), chữ thường, khoảng trắng thừa ⇒ vẫn nhận (chuẩn hoá khoá)", () => {
    const r = docTheViec(the("\ntran   luot model:   30  "));
    expect(r.ok && r.the.tran).toEqual({ luotModel: 30 });
  });
  it("★★★ khoá TRẦN không bị gộp vào khoá đứng trước: dòng sau GIỚI HẠN không làm đổi gioiHan", () => {
    const r = docTheViec(the("\nTRẦN LƯỢT MODEL: 20"));
    expect(r.ok && r.the.gioiHan).toEqual({ giay: 900, vong: 8 });
  });
  it.each([
    ["TRẦN LƯỢT MODEL: 0", "TRẦN LƯỢT MODEL"],
    ["TRẦN LƯỢT MODEL: 121", "TRẦN LƯỢT MODEL"],
    ["TRẦN LƯỢT MODEL: ba mươi", "TRẦN LƯỢT MODEL"],
    ["TRẦN LƯỢT MODEL: 30 lượt", "TRẦN LƯỢT MODEL"],
    ["TRẦN LƯỢT MODEL:", "TRẦN LƯỢT MODEL"],
    ["TRẦN PHÚT: 0", "TRẦN PHÚT"],
    ["TRẦN PHÚT: 121", "TRẦN PHÚT"],
    ["TRẦN TOKEN RA: 999", "TRẦN TOKEN RA"],
    ["TRẦN TOKEN RA: 400001", "TRẦN TOKEN RA"],
  ])("★★★ %s ⇒ THẺ LỖI (không âm thầm bỏ qua), nêu tên khoá", (dong, ten) => {
    const r = docTheViec(the(`\n${dong}`));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain(ten);
  });
  it("★★ khoá lặp ⇒ lấy khoá cuối (cùng quy tắc các khoá khác)", () => {
    const r = docTheViec(the("\nTRẦN LƯỢT MODEL: 20\nTRẦN LƯỢT MODEL: 40"));
    expect(r.ok && r.the.tran?.luotModel).toBe(40);
  });
});
