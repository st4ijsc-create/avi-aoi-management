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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, auditCaseLeakage, caseVisibleText } from "./eval-specialist.mjs";

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

// ─── Cổng chống rò đáp án (fix round 2, CRITICAL) ────────────────────────────
//
// Vòng sửa trước áp luật chống-gian-lận lên SAI kho đối chiếu: chỉ chặn từ khoá
// trùng `objective` và TÊN file, trong khi sau Wave 1 prompt còn chứa NỘI DUNG
// file. Kết quả: cả 8 ca đều có trần điểm 1.000 chỉ bằng trích xuất. Bộ test
// dưới đây là lưới chặn tái phát cho đúng lớp lỗi đó.

const CASE = {
  id: "demo",
  objective: "Hàm listAlerts luôn trả mảng rỗng. Tìm nguyên nhân gốc và cách sửa.",
  moduleName: "ai-inbox",
  files: ["server/services/aiActionInbox.ts"],
  expected: {
    rootCauseKeywords: ["không tồn tại"],
    mustMentionFiles: ["server/services/aiActionInbox.ts"],
    fixDirectionKeywords: ["ScopedMachine", "hàm thật"],
  },
};

test("auditCaseLeakage: ngữ cảnh sạch ⇒ không rò gì", () => {
  assert.deepEqual(auditCaseLeakage(CASE, "export async function listAlerts() { return []; }"), []);
});

test("auditCaseLeakage: từ khoá nguyên nhân nằm sẵn trong NỘI DUNG file ⇒ bị bắt", () => {
  const leaked = auditCaseLeakage(CASE, "// hàm này không tồn tại trong module\nexport const x = 1;");
  assert.deepEqual(leaked, ["không tồn tại"]);
});

test("auditCaseLeakage: từ khoá hướng sửa nằm sẵn trong NỘI DUNG file ⇒ bị bắt", () => {
  const leaked = auditCaseLeakage(CASE, "export interface ScopedMachine { id: number }");
  assert.deepEqual(leaked, ["ScopedMachine"]);
});

test("auditCaseLeakage: rò qua chính đề bài (objective) — luật cũ vẫn phải giữ", () => {
  const c = { ...CASE, objective: `${CASE.objective} Ký hiệu được import không tồn tại.` };
  assert.deepEqual(auditCaseLeakage(c, ""), ["không tồn tại"]);
});

test("auditCaseLeakage: rò qua danh sách file (prompt echo nguyên văn 'Related files')", () => {
  const c = { ...CASE, files: ["server/services/ScopedMachine.ts"] };
  assert.deepEqual(auditCaseLeakage(c, ""), ["ScopedMachine"]);
});

test("auditCaseLeakage: so khớp KHÔNG phân biệt hoa thường (giống scoreCase)", () => {
  assert.deepEqual(auditCaseLeakage(CASE, "type SCOPEDMACHINE = never;"), ["ScopedMachine"]);
});

test("auditCaseLeakage: mustMentionFiles KHÔNG bị tính là rò (đường dẫn buộc phải có trong prompt)", () => {
  assert.deepEqual(auditCaseLeakage(CASE, "// server/services/aiActionInbox.ts"), []);
});

test("caseVisibleText gộp đủ đề bài + module + danh sách file + ngữ cảnh", () => {
  const txt = caseVisibleText(CASE, "NỘI DUNG FILE");
  for (const part of ["listalerts", "ai-inbox", "server/services/aiactioninbox.ts", "nội dung file"]) {
    assert.ok(txt.includes(part), `thiếu "${part}"`);
  }
});

// Lưới chặn tái phát trên CHÍNH 8 ca đang dùng: chạy được ở mọi nơi (không cần
// git, không cần model) vì chỉ đối chiếu đề bài + danh sách file. Phần nội dung
// file trước-khi-sửa được CLI kiểm thêm lúc chạy thật (`trusted: false`).
test("mọi ca trong specialist-cases: có fixCommit và không tự rò đáp án qua đề bài/danh sách file", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "specialist-cases");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "không tìm thấy ca nào");
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.match(String(c.fixCommit ?? ""), /^[0-9a-f]{7,40}$/, `${f}: thiếu/sai fixCommit`);
    assert.deepEqual(auditCaseLeakage(c, ""), [], `${f}: từ khoá chấm điểm rò qua đề bài/danh sách file`);
  }
});
