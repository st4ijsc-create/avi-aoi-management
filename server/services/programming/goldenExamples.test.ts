/**
 * Doc 80 · Task 10 · D3 (AI-04 / AI-05) — ĐẦU RA SẠCH: header few-shot / `_safety_note` KHÔNG được
 * đi vào prompt, và nếu model vẫn chép chúng vào mã trả về thì hậu kiểm gỡ ra.
 *
 * Đo trước (phụ lục A §2 #3): 11/11 đầu ra mã có dòng `SAFETY:` hoặc header golden chép nguyên văn;
 * 2 JSON (IR/POU) vỡ vì dòng chú thích nằm trong JSON.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  loadGoldenExamples,
  selectGoldenExamples,
  formatGoldenExamplesForPrompt,
  locHeaderGolden,
  goHeaderGoldenKhoiMa,
  _clearGoldenCache,
} from "./goldenExamples";

const DIR = path.join(process.cwd(), "knowledge/golden-code");
const doc = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

beforeEach(() => {
  delete process.env.GOLDEN_CODE_DIR;
  _clearGoldenCache();
});

describe("locHeaderGolden — lọc header/_safety_note của golden TRƯỚC khi đưa vào prompt", () => {
  it("ST (* SAFETY: … *) ⇒ bị gỡ, thân chương trình giữ nguyên", () => {
    const out = locHeaderGolden(doc("iec61131-st/moving-average.st"));
    expect(out).not.toMatch(/SAFETY:|golden/i);
    expect(out).toMatch(/^PROGRAM MovingAverage/m);
    expect(out).toMatch(/END_PROGRAM/);
  });

  it("LD // SAFETY … ⇒ gỡ ĐOẠN header, GIỮ đoạn mô tả cú pháp DSL", () => {
    const out = locHeaderGolden(doc("iec61131-ld/conveyor-sealin.ld"));
    expect(out).not.toMatch(/SAFETY:|AI-assisted/);
    expect(out).toMatch(/Textual ladder DSL/);
    expect(out).toMatch(/ConveyorRun := \(StartPB OR ConveyorRun\)/);
  });

  it("ZBasic / TM / MELSEC ' SAFETY … ⇒ gỡ", () => {
    for (const f of ["zmotion-basic/axis-absolute-move.bas", "robot-tm/pick-place-job.tmscript", "mitsubishi-engineering/injection-recipe.dev"]) {
      const out = locHeaderGolden(doc(f));
      expect(out, f).not.toMatch(/SAFETY:|AI-assisted golden/);
      expect(out.trim().length, f).toBeGreaterThan(20);
    }
  });

  it("IR JSON `_safety_note` ⇒ gỡ và JSON VẪN hợp lệ", () => {
    for (const f of ["ir-flow/pick-and-place.ir.json", "ir-flow/palletize-loop.ir.json"]) {
      const out = locHeaderGolden(doc(f));
      expect(out, f).not.toMatch(/_safety_note/);
      const j = JSON.parse(out);
      expect(Array.isArray(j.blocks), f).toBe(true);
    }
  });

  it("khối few-shot đưa vào prompt KHÔNG còn 'SAFETY:' / '_safety_note' cho mọi golden Tier-A", () => {
    const all = loadGoldenExamples().filter((e) => e.kind && e.code.trim());
    expect(all.length).toBeGreaterThan(5);
    const block = formatGoldenExamplesForPrompt(all);
    expect(block).not.toMatch(/SAFETY:|_safety_note|AI-assisted golden/);
  });

  it("ví dụ ÂM (tag safety-lint-unsafe) KHÔNG bao giờ được chọn làm few-shot", () => {
    for (const kind of ["iec61131-st", "robot-tm"]) {
      for (const tags of [[], ["unbounded-loop", "safety-lint", "conveyor"], ["motion-envelope"]]) {
        const sel = selectGoldenExamples({ kind, tags, limit: 6 });
        expect(sel.some((e) => e.tags.includes("safety-lint-unsafe")), `${kind} ${tags}`).toBe(false);
      }
    }
  });
});

describe("goHeaderGoldenKhoiMa — hậu kiểm gỡ header golden bị model chép vào mã trả về", () => {
  it("gỡ khối (* SAFETY: AI-assisted golden … *) chép từ few-shot + dòng SAFETY cuối khối", () => {
    const header = doc("iec61131-st/moving-average.st").split("*)")[0] + "*)";
    const code = `${header}\n\nPROGRAM Conveyor\nVAR\n  Run : BOOL;\nEND_VAR\nRun := TRUE;\nEND_PROGRAM\n(* SAFETY: simulate and test before running on a device. *)`;
    const out = goHeaderGoldenKhoiMa(code);
    expect(out).not.toMatch(/SAFETY:|golden/i);
    expect(out).toBe("PROGRAM Conveyor\nVAR\n  Run : BOOL;\nEND_VAR\nRun := TRUE;\nEND_PROGRAM");
  });

  it("gỡ // SAFETY: simulate … ở dạng chú thích dòng (LD / JSON)", () => {
    expect(goHeaderGoldenKhoiMa("Y0 := X0 AND NOT X1\n// SAFETY: simulate and test before running on a device.")).toBe("Y0 := X0 AND NOT X1");
    const json = '{\n  "flow_id": "f",\n  "blocks": []\n}\n// SAFETY: simulate and test before running on a device.';
    expect(JSON.parse(goHeaderGoldenKhoiMa(json)).flow_id).toBe("f");
  });

  it("gỡ khoá `_safety_note` khỏi JSON trả về (JSON vẫn hợp lệ)", () => {
    const j = JSON.stringify({ _safety_note: "AI-assisted golden example…", flow_id: "x", version: 1, blocks: [] }, null, 2);
    const out = goHeaderGoldenKhoiMa(j);
    expect(out).not.toMatch(/_safety_note/);
    expect(JSON.parse(out)).toEqual({ flow_id: "x", version: 1, blocks: [] });
  });

  it("KHÔNG đụng chú thích của NGƯỜI DÙNG (kể cả chú thích có chữ SAFETY) — mã sạch giữ nguyên từng byte", () => {
    const code = "(* SAFETY: guard must be closed before start - plant rule 4.2 *)\nPROGRAM P\nVAR\n  x : BOOL; (* flag *)\nEND_VAR\nx := TRUE;\nEND_PROGRAM";
    expect(goHeaderGoldenKhoiMa(code)).toBe(code);
  });
});
