// doc69 Wave 1 (w1-6) — objective quality benchmark for the 4 specialist agents.
//
// Unit-tests the PURE `scoreCase()` function exported from eval-specialist.mjs.
// scoreCase does NO I/O and never invokes a model — it just keyword-matches an
// already-produced agent `output` against an `expected` answer key. The CLI half
// of eval-specialist.mjs (which DOES call the real 30B model via
// runSpecialistAgent + gatherRepoContext) only runs under the
// `import.meta.url === pathToFileURL(process.argv[1]).href` guard, so importing
// scoreCase here does NOT spawn a model.
//
// Run: node scripts/ai-eval/eval-specialist.test.mjs
// (Not part of the vitest suite — vitest.config.ts only globs *.test.ts, so this
// uses node:test + node:assert/strict for a zero-config self-runnable test,
// mirroring scripts/ai-kb/check-kb-stale.test.mjs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCase } from "./eval-specialist.mjs";

const expected = {
  rootCauseKeywords: ["import", "undefined", "latestForMachine"],
  mustMentionFiles: ["server/services/aiActionInbox.ts"],
  fixDirectionKeywords: ["readMachineStatuses"],
};

test("đáp án hoàn hảo ⇒ 1.0", () => {
  const out = {
    summary: "Hàm import latestForMachine không tồn tại nên trả undefined.",
    diagnosis: "Lỗi ở server/services/aiActionInbox.ts",
    actionPlan: ["Dùng readMachineStatuses làm nguồn thật"],
  };
  const s = scoreCase(out, expected);
  assert.equal(s.rootCause, 1);
  assert.equal(s.location, 1);
  assert.equal(s.fixDirection, 1);
  assert.equal(s.total, 1);
});

test("thiếu hết ⇒ 0", () => {
  const s = scoreCase({ summary: "không liên quan" }, expected);
  assert.equal(s.total, 0);
});

test("nguyên nhân đạt ngưỡng 60% từ khoá ⇒ rootCause = 1", () => {
  const s = scoreCase({ summary: "import bị undefined" }, expected);
  assert.equal(s.rootCause, 1);
});

test("dưới ngưỡng 60% ⇒ rootCause = 0", () => {
  const s = scoreCase({ summary: "chỉ có import thôi" }, expected);
  assert.equal(s.rootCause, 0);
});
