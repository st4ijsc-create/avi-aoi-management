import { beforeEach, describe, expect, it } from "vitest";
import { __resetMeasureLockForTests, measureWindowDepth, withMeasureWindow } from "./vramMeasureLock";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("withMeasureWindow", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });

  it("hai luot KHONG bao gio chong nhau", async () => {
    const nhatKy: string[] = [];
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => {
      nhatKy.push("A vao");
      await new Promise<void>((r) => { moKhoaA = r; });
      nhatKy.push("A ra");
      return "a";
    });
    await tick();
    const b = withMeasureWindow(async () => { nhatKy.push("B vao"); return "b"; });
    await tick();
    expect(nhatKy).toEqual(["A vao"]); // B con xep hang
    moKhoaA();
    await Promise.all([a, b]);
    expect(nhatKy).toEqual(["A vao", "A ra", "B vao"]);
  });

  it("bao dat do duoc khi khong tranh chap", async () => {
    const r = await withMeasureWindow(async () => 7);
    expect(r).toEqual({ value: 7, measurable: true });
  });

  it("het ngan sach cho thi VAN CHAY, chi mat phep do", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    const b = await withMeasureWindow(async () => "b", 0);
    expect(b).toEqual({ value: "b", measurable: false });
    moKhoaA();
    await a;
  });

  it("ham nem VAN nha khoa — khong khoa chet", async () => {
    await expect(withMeasureWindow(async () => { throw new Error("vo"); })).rejects.toThrow("vo");
    expect(measureWindowDepth()).toBe(0);
    const r = await withMeasureWindow(async () => "sau do");
    expect(r.measurable).toBe(true);
  });

  it("luot chay khong do KHONG giu khoa cua nguoi khac", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    await withMeasureWindow(async () => "b", 0);   // bo qua khoa
    await tick();
    expect(measureWindowDepth()).toBe(1);          // van chi co A giu
    moKhoaA();
    await a;
  });
});
