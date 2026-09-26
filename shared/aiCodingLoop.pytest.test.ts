import { describe, it, expect } from "vitest";
import { docKetQuaTest } from "@shared/aiCodingLoop";

describe("docKetQuaTest — khuôn pytest (G5, audit 2026-09-21 · P7)", () => {
  it("★ chỉ PASS: '===== 3 passed in 0.12s ====='", () => {
    const r = docKetQuaTest("============ 3 passed in 0.12s ============", 0);
    expect(r).toEqual({ xanh: true, soDo: 0, soXanh: 3 });
  });
  it("★ có FAIL lẫn PASS", () => {
    const r = docKetQuaTest("======= 1 failed, 2 passed in 0.31s =======", 1);
    expect(r).toEqual({ xanh: false, soDo: 1, soXanh: 2 });
  });
  it("★ CHỈ fail (không ca nào xanh)", () => {
    const r = docKetQuaTest("======= 2 failed in 0.20s =======", 1);
    expect(r).toEqual({ xanh: false, soDo: 2, soXanh: 0 });
  });
  it("★ đầu ra pytest THẬT (đã đo sống)", () => {
    const that = `============================= test session starts =============================
platform win32 -- Python 3.14.6, pytest-9.1.1, pluggy-1.6.0
collected 3 items

sandbox-projects\python-demo\test_tinh.py ...                            [100%]

============================== 3 passed in 0.05s ==============================`;
    expect(docKetQuaTest(that, 0)).toEqual({ xanh: true, soDo: 0, soXanh: 3 });
  });
  it("★ KHÔNG phá ba khuôn cũ (dotnet · vitest · node --test)", () => {
    expect(docKetQuaTest("Failed: 2, Passed: 7", 1)).toEqual({ xanh: false, soDo: 2, soXanh: 7 });
    expect(docKetQuaTest("Tests  1 failed | 11 passed (12)", 1)).toEqual({ xanh: false, soDo: 1, soXanh: 11 });
    expect(docKetQuaTest("ℹ pass 5\nℹ fail 0", 0)).toEqual({ xanh: true, soDo: 0, soXanh: 5 });
  });
  it("★ đầu ra không nhận ra ⇒ null (CHẮC-MỚI-NÓI, không đoán mò)", () => {
    expect(docKetQuaTest("một khối chữ lạ", 0)).toEqual({ xanh: true, soDo: null, soXanh: null });
  });
});
