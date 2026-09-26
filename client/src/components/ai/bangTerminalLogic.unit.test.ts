/** ★ F5 — lưới lọc lịch sử lệnh. Luật đắt nhất: exit 0 mà test đỏ vẫn là ĐỎ; exit null không phải xanh. */
import { describe, it, expect } from "vitest";
import { demKetCuc, locLuotLenh, luotLenhDo, luotLenhXanh } from "./bangTerminalLogic";

const ok = { exitCode: 0, timedOut: false, ketQua: null };
const okTest = { exitCode: 0, timedOut: false, ketQua: { xanh: true } };
const exit1 = { exitCode: 1, timedOut: false, ketQua: null };
const hetGio = { exitCode: null, timedOut: true, ketQua: null };
const exit0TestDo = { exitCode: 0, timedOut: false, ketQua: { xanh: false } };
const dangChay = { exitCode: null, timedOut: false, ketQua: null };

describe("luotLenhDo / luotLenhXanh", () => {
  it("★★★ exit 0 nhưng test ĐỎ ⇒ ĐỎ (tác nhân nói xanh mà test đỏ là trượt)", () => {
    expect(luotLenhDo(exit0TestDo)).toBe(true);
    expect(luotLenhXanh(exit0TestDo)).toBe(false);
  });
  it("hết giờ / exit ≠ 0 ⇒ đỏ; exit 0 (± test xanh) ⇒ xanh", () => {
    expect(luotLenhDo(hetGio)).toBe(true);
    expect(luotLenhDo(exit1)).toBe(true);
    expect(luotLenhXanh(ok)).toBe(true);
    expect(luotLenhXanh(okTest)).toBe(true);
  });
  it("★ exit null (đang chạy) KHÔNG phải xanh và không phải đỏ", () => {
    expect(luotLenhXanh(dangChay)).toBe(false);
    expect(luotLenhDo(dangChay)).toBe(false);
  });
});

describe("locLuotLenh / demKetCuc", () => {
  const ds = [ok, exit1, hetGio, exit0TestDo, okTest, dangChay];
  it("tat-ca giữ nguyên (bản sao), do/xanh lọc đúng", () => {
    expect(locLuotLenh(ds, "tat-ca")).toHaveLength(6);
    expect(locLuotLenh(ds, "tat-ca")).not.toBe(ds);
    expect(locLuotLenh(ds, "do")).toEqual([exit1, hetGio, exit0TestDo]);
    expect(locLuotLenh(ds, "xanh")).toEqual([ok, okTest]);
  });
  it("đếm: đỏ 3 · xanh 2 · một lượt đang chạy không thuộc bên nào", () => {
    expect(demKetCuc(ds)).toEqual({ do: 3, xanh: 2 });
  });
});
