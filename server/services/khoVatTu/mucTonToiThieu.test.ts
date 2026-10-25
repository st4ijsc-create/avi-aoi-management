import { describe, expect, it } from "vitest";
import { mucTonToiThieu, nguongCanNhap } from "./mucTonToiThieu";

describe("mucTonToiThieu — 3 % số máy, làm tròn lên, tối thiểu 1; không rõ ⇒ 3", () => {
  it.each([
    [0, 3],
    [null, 3],
    [undefined, 3],
    [Number.NaN, 3],
    [-5, 3],
    [1, 1],
    [33, 1],
    [34, 2],
    [50, 2],
    [100, 3],
    [101, 4],
    [1000, 30],
  ])("%s máy ⇒ %s", (soMay, ky) => {
    expect(mucTonToiThieu(soMay as number | null | undefined)).toBe(ky);
  });
  it("nguongCanNhap = max(reorderLevel đã khai, mức tính): không hạ mức người dùng đã đặt", () => {
    expect(nguongCanNhap(5, 50)).toBe(5);
    expect(nguongCanNhap(0, 50)).toBe(2);
    expect(nguongCanNhap(1, 0)).toBe(3);
    expect(nguongCanNhap(10, 1000)).toBe(30);
  });
});
