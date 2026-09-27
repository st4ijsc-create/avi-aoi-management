/**
 * doc 80 Đợt 1 Task 7 (AI-02) — BỘ VÀNG Structured Text: đo validator THẬT bằng tệp viết TAY.
 *
 * Phụ lục A §1: validator cũ (đếm từ khoá `/gi`) cho chương trình RÁC `ok:true`, còn FB hợp lệ có
 * `VAR_INPUT` và chương trình có chú thích chứa chữ "if" thì `ok:false`. Bộ vàng ở `golden-st/`
 * ĐỘC LẬP với parser: mỗi tệp `.st` viết tay, phán quyết + dòng lỗi mong đợi viết tay trong
 * `golden-st/manifest.json`. Sửa parser KHÔNG được sửa manifest để xanh.
 *
 * Đo qua `Iec61131StAdapter.validate()` — đúng cửa mà Copilot / IDE / build / tool chat dùng —
 * không qua hàm nội bộ, để con số là con số của sản phẩm.
 *
 *   TPR = số chương trình CÀI LỖI bị từ chối / tổng số cài lỗi   (lớp dương = "có lỗi")
 *   TPR@dòng = bị từ chối VÀ có chẩn đoán lỗi đúng dòng viết tay
 *   TNR = số chương trình HỢP LỆ được nhận / tổng số hợp lệ
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Iec61131StAdapter } from "./iec61131Adapter";

interface Case { file: string; ok: boolean; errorLine?: number; why: string }
const DIR = path.join(__dirname, "golden-st");
const manifest = JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8")) as { cases: Case[] };
const adapter = new Iec61131StAdapter();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");
const validate = (content: string) => adapter.validate({ kind: "iec61131-st", language: "st", content });

describe("bộ vàng ST — kích thước tối thiểu theo brief (≥20 hợp lệ + ≥20 cài lỗi)", () => {
  it("manifest có ≥20 mỗi loại và mọi tệp tồn tại", () => {
    const valid = manifest.cases.filter((c) => c.ok);
    const invalid = manifest.cases.filter((c) => !c.ok);
    expect(valid.length).toBeGreaterThanOrEqual(20);
    expect(invalid.length).toBeGreaterThanOrEqual(20);
    for (const c of manifest.cases) expect(read(c.file).length).toBeGreaterThan(0);
    for (const c of invalid) expect(c.errorLine, c.file).toBeTypeOf("number");
  });
});

describe("ba mẫu thăm dò của phụ lục A (bắt buộc)", () => {
  it("garbage.st ⇒ LỖI (validator cũ: ok:true), có dòng + cột", async () => {
    const v = await validate(read("invalid/i01-probe-garbage.st"));
    expect(v.ok).toBe(false);
    const errs = v.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBeGreaterThan(0);
    for (const d of errs) {
      expect(d.line).toBeTypeOf("number");
      expect(d.col).toBeTypeOf("number");
    }
    // Mọi dòng hỏng của mẫu đều được nói ra: 2 (thiếu ';' trước END_VAR), 3 (thiếu ';'),
    // 4 ('b = FALSE'), 5 ('FOO BAR BAZ (((').
    const lines = new Set(errs.map((d) => d.line));
    for (const l of [2, 3, 4, 5]) expect(lines.has(l), `dòng ${l}`).toBe(true);
  });
  it("fb.st (FUNCTION_BLOCK có VAR_INPUT) ⇒ HỢP LỆ (validator cũ: Unbalanced VAR/END_VAR)", async () => {
    const v = await validate(read("valid/v01-probe-fb.st"));
    expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it("cmt.st (chú thích chứa 'if') ⇒ HỢP LỆ (validator cũ: Unbalanced IF/END_IF)", async () => {
    const v = await validate(read("valid/v02-probe-cmt.st"));
    expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(v.ok).toBe(true);
  });
});

describe("fix round 1 — chú thích lồng nhau nói ĐÚNG lý do", () => {
  it("i35: gợi ý 'lồng nhau không được hỗ trợ' tại '(*' bên trong, KHÔNG có 'Undeclared identifier' hệ quả", async () => {
    const v = await validate(read("invalid/i35-nested-comment.st"));
    expect(v.ok).toBe(false);
    const errs = v.diagnostics.filter((d) => d.severity === "error");
    expect(errs.map((d) => [d.code, d.line, d.col])).toEqual([["stNestedComment", 7, 4]]);
  });
});

describe("bộ vàng ST — TPR/TNR ≥ 95 %", () => {
  it("đo và in TPR / TPR@dòng / TNR", async () => {
    let tp = 0, tpLine = 0, tn = 0;
    const nPos = manifest.cases.filter((c) => !c.ok).length;
    const nNeg = manifest.cases.filter((c) => c.ok).length;
    const miss: string[] = [];
    for (const c of manifest.cases) {
      const v = await validate(read(c.file));
      const errs = v.diagnostics.filter((d) => d.severity === "error");
      if (c.ok) {
        if (v.ok) tn++;
        else miss.push(`FP ${c.file}: ${errs.map((d) => `L${d.line}:${d.col} ${d.message}`).join(" | ")}`);
      } else {
        if (!v.ok) tp++;
        else miss.push(`FN ${c.file}: ok:true`);
        if (!v.ok && errs.some((d) => d.line === c.errorLine)) tpLine++;
        else if (!v.ok) miss.push(`LINE ${c.file}: cần L${c.errorLine}, có ${errs.map((d) => `L${d.line}:${d.col} ${d.message}`).join(" | ")}`);
      }
    }
    const pct = (a: number, b: number) => `${a}/${b} = ${((100 * a) / b).toFixed(1)} %`;
    // In ra để báo cáo — đây là phép đo, không phải trang trí.
    console.log(`[bo-vang-ST] TPR ${pct(tp, nPos)} · TPR@dong ${pct(tpLine, nPos)} · TNR ${pct(tn, nNeg)}`);
    if (miss.length) console.log(`[bo-vang-ST] lệch:\n  ${miss.join("\n  ")}`);
    expect(tp / nPos).toBeGreaterThanOrEqual(0.95);
    expect(tpLine / nPos).toBeGreaterThanOrEqual(0.95);
    expect(tn / nNeg).toBeGreaterThanOrEqual(0.95);
  });

  // Từng ca một — để một ca đỏ chỉ đúng tên nó (phép đo tổng ở trên có thể xanh với 1 ca lệch).
  for (const c of manifest.cases) {
    it(`${c.ok ? "hợp lệ" : `cài lỗi L${c.errorLine}`} — ${c.file}`, async () => {
      const v = await validate(read(c.file));
      const errs = v.diagnostics.filter((d) => d.severity === "error");
      if (c.ok) {
        expect(errs.map((d) => `L${d.line}:${d.col} ${d.message}`)).toEqual([]);
      } else {
        expect(v.ok).toBe(false);
        expect(errs.map((d) => d.line), errs.map((d) => `L${d.line}:${d.col} ${d.message}`).join(" | ")).toContain(c.errorLine);
      }
    });
  }
});
