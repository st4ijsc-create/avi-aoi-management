import { describe, expect, it } from "vitest";

import { docHopDaVe, docHopDaVeTru, ghiHopDaVe, xoaHopDaVe } from "./hopDaVe";

const H = (trai: number, tren: number) => ({ trai, phai: trai + 10, tren, duoi: tren + 5 });

describe("hopDaVe — sổ hộp đã vẽ dùng chung theo canvas (Đợt 47 N5)", () => {
  it("chưa ai ghi ⇒ [] (không undefined)", () => {
    const cv = {};
    expect(docHopDaVe(cv, "badge")).toEqual([]);
    expect(docHopDaVeTru(cv, "nhan")).toEqual([]);
  });

  it("ghi rồi đọc lại đúng lớp; lớp khác không thấy", () => {
    const cv = {};
    ghiHopDaVe(cv, "badge", [H(0, 0), H(20, 0)]);
    expect(docHopDaVe(cv, "badge")).toHaveLength(2);
    expect(docHopDaVe(cv, "nhan")).toEqual([]);
  });

  it("docHopDaVeTru gộp mọi lớp trừ lớp đang hỏi", () => {
    const cv = {};
    ghiHopDaVe(cv, "badge", [H(0, 0)]);
    ghiHopDaVe(cv, "chip", [H(50, 50), H(70, 50)]);
    ghiHopDaVe(cv, "nhan", [H(90, 90)]);
    expect(docHopDaVeTru(cv, "nhan")).toHaveLength(3);
    expect(docHopDaVeTru(cv, "badge")).toHaveLength(3);
    expect(docHopDaVeTru(cv, "khac")).toHaveLength(4);
  });

  it("ghi lần sau THAY THẾ lần trước (không cộng dồn qua các khung)", () => {
    const cv = {};
    ghiHopDaVe(cv, "badge", [H(0, 0), H(20, 0), H(40, 0)]);
    ghiHopDaVe(cv, "badge", [H(0, 0)]);
    expect(docHopDaVe(cv, "badge")).toHaveLength(1);
    ghiHopDaVe(cv, "badge", []);
    expect(docHopDaVe(cv, "badge")).toEqual([]);
  });

  it("hai canvas là hai sổ rời", () => {
    const a = {};
    const b = {};
    ghiHopDaVe(a, "badge", [H(0, 0)]);
    expect(docHopDaVe(b, "badge")).toEqual([]);
  });

  it("xoaHopDaVe gỡ đóng góp của một lớp", () => {
    const cv = {};
    ghiHopDaVe(cv, "badge", [H(0, 0)]);
    xoaHopDaVe(cv, "badge");
    expect(docHopDaVe(cv, "badge")).toEqual([]);
    // xoá lớp chưa từng ghi / canvas chưa từng có sổ: không ném
    expect(() => xoaHopDaVe({}, "x")).not.toThrow();
  });
});
