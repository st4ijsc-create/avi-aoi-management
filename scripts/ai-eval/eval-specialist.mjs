/**
 * Wave 1 — bộ đề chuẩn 8 bài từ bug thật (git history), chấm tự động.
 *
 * ─── NGỮ CẢNH LÀ MÃ **TRƯỚC KHI SỬA** (fix round 2 — CRITICAL) ────────────────
 * Trước bản này, CLI gọi `gatherRepoContext({ files: c.files })` trên CÂY HIỆN
 * TẠI, tức nạp nội dung ĐÃ SỬA của đúng những file chứa từ khoá chấm điểm. Đo
 * độc lập: **cả 8 ca đều có trần điểm 1.000 chỉ bằng trích xuất** — một câu trả
 * lời tóm tắt lại file được đưa là đủ 1.0, không cần chẩn đoán gì. Với ca
 * `w0-42p01-cause-walk` thì file `server/_core/dbErrors.ts` sau khi sửa còn có
 * hẳn doc-comment kể lại chính bug đó.
 *
 * Nay ngữ cảnh được dựng từ `git show <fixCommit>^:<path>` — **mã ngay trước
 * commit sửa**, tức bug còn nguyên. Model phải TỰ tìm ra lỗi thay vì tóm tắt
 * đáp án. Cùng giới hạn an toàn như `repoContextService`: cắt theo
 * `MAX_FILE_BYTES`/`MAX_TOTAL_BYTES` và chạy qua `redactSecretsOnly()`.
 *
 * File không tồn tại ở commit đó (mới được thêm bởi chính commit sửa) ⇒ ca đó
 * được **bỏ qua một cách trung thực** (`skipped: true` + lý do), KHÔNG bị tính
 * là 0 điểm im lặng.
 *
 * RAG và code-graph bị TẮT có chủ đích ở đây (khác đường chạy thật của
 * Studio): cả hai đều được đánh chỉ mục từ cây HIỆN TẠI (đã sửa), nên bật lên
 * là mở lại đúng lỗ rò mà bản này vá. Ngữ cảnh của bộ đề vì thế NGHÈO hơn ngữ
 * cảnh người dùng thật nhận được — điểm ở đây là cận DƯỚI.
 *
 * ─── CỔNG CHỐNG TÁI PHÁT ─────────────────────────────────────────────────────
 * `auditCaseLeakage(caseObj, gatheredText)` (hàm thuần, có test riêng) dò xem có
 * `rootCauseKeywords`/`fixDirectionKeywords` nào xuất hiện trong **toàn bộ phần
 * model nhìn thấy được** — objective + moduleName + danh sách file + nội dung
 * file đã nạp. Rò một từ khoá nào là điểm của ca đó vô nghĩa: CLI in cảnh báo
 * to và đánh dấu `trusted: false` trong báo cáo JSON, và ca đó bị loại khỏi
 * `trustedAverage` (con số dùng để quyết định).
 *
 * Vì cổng này, đáp án của mỗi ca được chọn từ **nội dung bản vá** (thứ CHƯA có
 * trong mã lỗi), không phải từ định danh có sẵn trong mã lỗi — một bản tóm tắt
 * file lỗi không thể chạm tới chúng. Vài ca vì thế đã bỏ bớt file khỏi `files`
 * (xem `notes` của từng ca) khi chính file đó viết sẵn đáp án ra.
 *
 * ─── PHẠM VI THẬT (không overclaim) ──────────────────────────────────────────
 * **Bộ đề CHỈ đo `backend-engineer`** — cả 8/8 ca đều dùng agentId đó, vì mọi
 * bug nguồn được chọn đều là lỗi backend. `frontend-engineer`/`data-analyst`/
 * `qa-optimizer` KHÔNG có ca nào. Điểm của bộ đề này đại diện cho **1 trong 4**
 * agent, không phải cho cả bộ tứ. Thêm ca cho 3 persona kia là fast-follow.
 *
 * Chấm 3 tiêu chí, mỗi tiêu chí 0/1, điểm bài = trung bình:
 *   1. Đúng nguyên nhân — đạt >= 60% số rootCauseKeywords.
 *   2. Đúng chỗ        — nêu >= 1 file trong mustMentionFiles.
 *   3. Đúng hướng sửa  — chứa >= 1 fixDirectionKeywords.
 *
 * GIỚI HẠN đã biết của tiêu chí (2) "Đúng chỗ": `runSpecialistAgent` (qua
 * `buildUserPrompt`) echo NGUYÊN VĂN danh sách `files` của case vào prompt
 * ("Related files: ..."), và `mustMentionFiles` luôn là tập con của `files`
 * — nên location=1 hầu như luôn đạt, kể cả khi model chỉ lặp lại đường dẫn
 * được cho mà không hề định vị lỗi. location KHÔNG chứng minh model tự tìm
 * ra vị trí lỗi; tín hiệu thật của bộ đề nằm ở rootCause + fixDirection.
 *
 * GIỚI HẠN của cách chấm bằng từ khoá: đây là **recall chuỗi con**, nên một câu
 * trả lời ĐÚNG nhưng diễn đạt khác từ khoá vẫn bị 0. Điểm vì thế là **cận
 * dưới**, đọc theo hướng "ít nhất bằng này", đừng đọc ngược lại.
 *
 * CHẠY THỦ CÔNG (mỗi lượt gọi model 30B mất vài phút — KHÔNG đưa vào CI):
 *   npm run eval:specialist
 */
export const ROOT_CAUSE_THRESHOLD = 0.6;

/** Cùng ngưỡng an toàn với server/services/ai/repoContextService.ts. */
export const MAX_FILE_BYTES = 65_536;
export const MAX_TOTAL_BYTES = 262_144;

/** Gộp toàn bộ đầu ra agent thành một chuỗi thường để dò từ khoá. */
export function flattenOutput(output) {
  return JSON.stringify(output ?? {}).toLowerCase();
}

export function scoreCase(output, expected) {
  const hay = flattenOutput(output);
  const rcKeys = expected.rootCauseKeywords ?? [];
  const hits = rcKeys.filter((k) => hay.includes(String(k).toLowerCase())).length;
  const rootCause = rcKeys.length === 0 ? 0 : hits / rcKeys.length >= ROOT_CAUSE_THRESHOLD ? 1 : 0;

  const files = expected.mustMentionFiles ?? [];
  const location = files.some((f) => hay.includes(String(f).toLowerCase())) ? 1 : 0;

  const fixKeys = expected.fixDirectionKeywords ?? [];
  const fixDirection = fixKeys.some((k) => hay.includes(String(k).toLowerCase())) ? 1 : 0;

  return {
    rootCause,
    location,
    fixDirection,
    total: Number(((rootCause + location + fixDirection) / 3).toFixed(3)),
  };
}

/**
 * Hàm thuần — gộp MỌI thứ model nhìn thấy được cho một ca: đề bài, tên module,
 * danh sách file (prompt echo nguyên văn) và ngữ cảnh mã đã nạp.
 */
export function caseVisibleText(caseObj, gatheredText = "") {
  return [
    caseObj?.objective ?? "",
    caseObj?.moduleName ?? "",
    ...(caseObj?.files ?? []),
    gatheredText ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

/**
 * Hàm thuần — CỔNG CHỐNG RÒ. Trả danh sách `rootCauseKeywords`/
 * `fixDirectionKeywords` xuất hiện sẵn trong phần model nhìn thấy được. Rỗng =
 * ca đáng tin. Khác rỗng = điểm của ca đó vô nghĩa (model chỉ cần chép lại).
 *
 * `mustMentionFiles` CỐ Ý không được kiểm: đường dẫn file bắt buộc phải nằm
 * trong prompt (đó là cách đề bài chỉ chỗ), giới hạn này đã ghi ở doc-header.
 */
export function auditCaseLeakage(caseObj, gatheredText) {
  const hay = caseVisibleText(caseObj, gatheredText);
  const keys = [
    ...(caseObj?.expected?.rootCauseKeywords ?? []),
    ...(caseObj?.expected?.fixDirectionKeywords ?? []),
  ];
  const leaked = [];
  for (const raw of keys) {
    const k = String(raw);
    const needle = k.toLowerCase();
    if (!needle) continue;
    if (hay.includes(needle) && !leaked.includes(k)) leaked.push(k);
  }
  return leaked;
}

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CASES_DIR = path.join(process.cwd(), "scripts", "ai-eval", "specialist-cases");
const OUT_DIR = path.join(process.cwd(), "knowledge", "eval");

/** Nội dung một file tại một revision. `null` = không tồn tại ở revision đó. */
function readFileAtRev(rev, relPath) {
  try {
    return execFileSync("git", ["show", `${rev}:${relPath}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Dựng ngữ cảnh (khuôn `RepoContextResult`) từ mã TRƯỚC khi sửa. `dependencies`
 * và `ragSnippets` cố ý để rỗng — xem doc-header.
 *
 * Export để kiểm chứng được ĐÚNG đường mã sẽ chạy thật (dò rò rỉ trên ngữ cảnh
 * thật) mà không phải gọi model.
 */
export function buildPreFixContext(c, redactSecretsOnly) {
  const rev = `${c.fixCommit}^`;
  const files = [];
  const skipped = [];
  let totalBytes = 0;

  for (const rel of c.files ?? []) {
    const raw = readFileAtRev(rev, rel);
    if (raw == null) {
      skipped.push({ path: rel, reason: "NOT_IN_PRE_FIX_TREE" });
      continue;
    }
    const budgetLeft = MAX_TOTAL_BYTES - totalBytes;
    if (budgetLeft <= 0) {
      skipped.push({ path: rel, reason: "BUDGET_EXCEEDED" });
      continue;
    }
    const limit = Math.min(MAX_FILE_BYTES, budgetLeft);
    const truncated = raw.length > limit;
    const sliced = truncated ? raw.slice(0, limit) : raw;
    const red = redactSecretsOnly(sliced);
    files.push({
      path: rel,
      content: red.text,
      bytes: Buffer.byteLength(raw, "utf8"),
      truncated,
      redacted: red.text !== sliced,
    });
    totalBytes += sliced.length;
  }

  return { files, skipped, dependencies: [], ragSnippets: [], totalBytes };
}

/** Chuỗi đại diện đúng phần ngữ cảnh mã sẽ đi vào prompt (để dò rò rỉ). */
export function gatheredTextOf(ctx) {
  return ctx.files.map((f) => `${f.path}\n${f.content}`).join("\n\n");
}

async function main() {
  // import động: hai module này kéo theo engine GGUF, không nạp khi chỉ chạy test hàm chấm.
  const { runSpecialistAgent } = await import("../../server/services/aiSpecialistAgentService.ts");
  const { redactSecretsOnly } = await import("../../server/services/ai/aiSafety.ts");

  const caseFiles = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();
  const results = [];

  for (const f of caseFiles) {
    const c = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8"));

    if (!c.fixCommit) {
      results.push({ id: c.id, title: c.title, skipped: true, reason: "NO_FIX_COMMIT" });
      console.log(`⤳ SKIP ${c.id}  (ca thiếu trường fixCommit — không dựng được ngữ cảnh trước-khi-sửa)`);
      continue;
    }

    const repoContext = buildPreFixContext(c, redactSecretsOnly);
    if (repoContext.files.length === 0) {
      const reason = `NO_PRE_FIX_CONTENT (${repoContext.skipped.map((s) => `${s.path}:${s.reason}`).join(", ") || "no files listed"})`;
      results.push({ id: c.id, title: c.title, skipped: true, reason });
      console.log(`⤳ SKIP ${c.id}  (không có nội dung tại ${c.fixCommit}^ — ${reason})`);
      continue;
    }

    const leakedKeywords = auditCaseLeakage(c, gatheredTextOf(repoContext));
    const trusted = leakedKeywords.length === 0;
    if (!trusted) {
      console.warn(
        `\n${"!".repeat(78)}\n` +
          `RÒ ĐÁP ÁN — ca "${c.id}" KHÔNG ĐÁNG TIN.\n` +
          `Các từ khoá sau đã có sẵn trong phần model nhìn thấy được: ${leakedKeywords.join(", ")}.\n` +
          `Model chỉ cần chép lại là đạt điểm ⇒ điểm của ca này VÔ NGHĨA, đã loại khỏi trustedAverage.\n` +
          `${"!".repeat(78)}\n`,
      );
    }

    try {
      const run = await runSpecialistAgent({
        agentId: c.agentId, objective: c.objective, files: c.files, repoContext, language: "vi",
      });
      const score = scoreCase(run.output, c.expected);
      results.push({ id: c.id, title: c.title, agentId: c.agentId, ...score, trusted, leakedKeywords });
      console.log(`${score.total === 1 ? "✔" : score.total === 0 ? "✘" : "~"} ${c.id}  total=${score.total}  (rootCause=${score.rootCause} location=${score.location} fix=${score.fixDirection})${trusted ? "" : "  [KHÔNG ĐÁNG TIN]"}`);
    } catch (err) {
      // Một ca lỗi model KHÔNG được làm hỏng cả lượt chạy.
      results.push({ id: c.id, title: c.title, agentId: c.agentId, rootCause: 0, location: 0, fixDirection: 0, total: 0, trusted, leakedKeywords, error: String(err?.message ?? err) });
      console.log(`✘ ${c.id}  total=0  (lỗi: ${err?.message ?? err})`);
    }
  }

  const scored = results.filter((r) => !r.skipped);
  const trustedScored = scored.filter((r) => r.trusted !== false);
  const mean = (arr) => (arr.length ? Number((arr.reduce((a, r) => a + r.total, 0) / arr.length).toFixed(3)) : 0);
  const average = mean(scored);
  const trustedAverage = mean(trustedScored);
  const agentCoverage = results.reduce((acc, r) => {
    const k = r.agentId ?? "(skipped)";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nĐiểm trung bình (mọi ca đã chấm): ${average}  (${scored.length} ca)`);
  console.log(`Điểm trung bình ĐÁNG TIN:         ${trustedAverage}  (${trustedScored.length} ca)  ← con số dùng để quyết định`);
  console.log(`Bỏ qua trung thực: ${results.length - scored.length} ca · Không đáng tin: ${scored.length - trustedScored.length} ca`);
  console.log(`Phủ agent: ${JSON.stringify(agentCoverage)}  (bộ đề hiện CHỈ đo backend-engineer)`);
  console.log(`Ngưỡng quyết định mức B: >= 0.6`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `specialist-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ contextMode: "pre-fix", average, trustedAverage, agentCoverage, results }, null, 2),
  );
  console.log(`Đã lưu: ${outFile}`);
}

// Chỉ chạy CLI khi gọi trực tiếp — import từ test sẽ KHÔNG kích hoạt phần này.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
