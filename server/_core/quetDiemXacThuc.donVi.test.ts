/**
 * ★★★ F5-nhanh review (2026-11-02) — ĐƠN VỊ của hình dạng thứ ba trong `quetDiemXacThuc` (tra sổ phiên + lấy hàng `users`).
 *
 * Lỗ được ghim: hai lượt đọc tách vào hai closure (bảng bộ đọc `{ docNguoiDung: (id) => getUserById(id), docPhien: (ve) =>
 * getSessionByToken(ve) }`, như `socketXacThucLai.ts`) ⇒ "thân hàm gần nhất" của mỗi lượt chỉ có MỘT vế ⇒ 0 điểm ⇒ vô hình với cả ba
 * lượng từ ∀ (`thuHoiPhienMoiBeMat` · `taiKhoanBiTatMoiBeMat` · `buocDoiMatKhauMoiBeMat`). Đây là lưới hiệu chuẩn THUẦN AST, không CSDL.
 * Mỗi ca dương có đối chứng âm (hình dạng không được thành dương tính giả).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { quetDiemXacThuc } from "./quetDiemXacThuc";

const phien = (ma: string) => quetDiemXacThuc("tong-hop.ts", ma).filter((d) => d.loai === "phien");

describe("★★★ quetDiemXacThuc — đơn vị rộng của hình dạng tra-sổ + lấy-hàng", () => {
  it("(a) bảng bộ đọc: hai arrow là GIÁ TRỊ thuộc tính của MỘT object literal ⇒ 1 điểm; đối chứng: bảng chỉ có một vế ⇒ 0", () => {
    expect(phien(`const b = { u: (id) => db.getUserById(id), s: (t) => db.getSessionByToken(t) };`)).toHaveLength(1);
    expect(phien(`const b = { s: (t) => db.getSessionByToken(t), x: (id) => db.getMachineById(id) };`)).toHaveLength(0);
  });

  it("(b) phương thức của object literal ⇒ 1 điểm", () => {
    expect(phien(`const b = { u(id) { return db.getUserById(id); }, s(t) { return db.getSessionByToken(t); } };`)).toHaveLength(1);
  });

  it("(c) hai closure dưới CÙNG một hàm cấp đỉnh ⇒ 1 điểm; đối chứng: hai hàm cấp đỉnh RIÊNG ⇒ 0", () => {
    expect(
      phien(`async function f(t, id) { const a = async () => db.getSessionByToken(t); const b = async () => db.getUserById(id); return [await a(), await b()]; }`),
    ).toHaveLength(1);
    expect(phien(`async function f(t) { return db.getSessionByToken(t); }\nasync function g(id) { return db.getUserById(id); }`)).toHaveLength(0);
  });

  it("(d) KHÔNG dương tính giả: router({...}) với một thủ tục tra sổ phiên một mình cạnh thủ tục khác lấy hàng users ⇒ 0", () => {
    expect(
      phien(`export const r = router({
        current: p.query(async ({ ctx }) => db.getSessionByToken(ctx.sessionToken)),
        me: p.query(async ({ ctx }) => db.getUserById(ctx.user.id)),
      });`),
    ).toHaveLength(0);
  });

  it("(e) hình dạng cũ vẫn thấy (cùng thân hàm) ⇒ 1 điểm", () => {
    expect(phien(`async function f(t){ const p = await db.getSessionByToken(t); return getUserById(p.userId); }`)).toHaveLength(1);
  });

  it("(f) tệp THẬT server/_core/socketXacThucLai.ts nay là ĐÚNG 1 điểm `phien` (nó được miễn trừ có lý do ở ba lượng từ ∀)", () => {
    const duong = "server/_core/socketXacThucLai.ts";
    const diem = quetDiemXacThuc(duong, readFileSync(join(process.cwd(), duong), "utf8"));
    expect(diem.map((d) => d.loai)).toEqual(["phien"]);
    expect(diem[0]).toMatchObject({ tuTraSo: false, tuKiemTaiKhoan: false, tuCanh: false }); // tự kiểm theo cách riêng (fail-closed), không qua sdk
  });
});
