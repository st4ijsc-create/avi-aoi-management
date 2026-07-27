/**
 * Wave 1 — bộ đề chuẩn cho 4 specialist agent.
 *
 * Chấm 3 tiêu chí, mỗi tiêu chí 0/1, điểm bài = trung bình:
 *   1. Đúng nguyên nhân — đạt >= 60% số rootCauseKeywords.
 *   2. Đúng chỗ        — nêu >= 1 file trong mustMentionFiles.
 *   3. Đúng hướng sửa  — chứa >= 1 fixDirectionKeywords.
 *
 * CHẠY THỦ CÔNG (mỗi lượt gọi model 30B mất vài phút — KHÔNG đưa vào CI):
 *   npm run eval:specialist
 */
export const ROOT_CAUSE_THRESHOLD = 0.6;

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

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CASES_DIR = path.join(process.cwd(), "scripts", "ai-eval", "specialist-cases");
const OUT_DIR = path.join(process.cwd(), "knowledge", "eval");

async function main() {
  // import động: hai module này kéo theo engine GGUF, không nạp khi chỉ chạy test hàm chấm.
  const { runSpecialistAgent } = await import("../../server/services/aiSpecialistAgentService.ts");
  const { gatherRepoContext } = await import("../../server/services/ai/repoContextService.ts");

  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"));
  const results = [];

  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8"));
    try {
      const repoContext = await gatherRepoContext({ files: c.files, objective: c.objective });
      const run = await runSpecialistAgent({
        agentId: c.agentId, objective: c.objective, files: c.files, repoContext, language: "vi",
      });
      const score = scoreCase(run.output, c.expected);
      results.push({ id: c.id, title: c.title, ...score });
      console.log(`${score.total === 1 ? "✔" : score.total === 0 ? "✘" : "~"} ${c.id}  total=${score.total}  (rootCause=${score.rootCause} location=${score.location} fix=${score.fixDirection})`);
    } catch (err) {
      // Một ca lỗi model KHÔNG được làm hỏng cả lượt chạy.
      results.push({ id: c.id, title: c.title, rootCause: 0, location: 0, fixDirection: 0, total: 0, error: String(err?.message ?? err) });
      console.log(`✘ ${c.id}  total=0  (lỗi: ${err?.message ?? err})`);
    }
  }

  const avg = results.length
    ? Number((results.reduce((a, r) => a + r.total, 0) / results.length).toFixed(3))
    : 0;
  console.log(`\nĐiểm trung bình: ${avg}  (${results.length} ca)`);
  console.log(`Ngưỡng quyết định mức B: >= 0.6`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `specialist-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ average: avg, results }, null, 2));
  console.log(`Đã lưu: ${outFile}`);
}

// Chỉ chạy CLI khi gọi trực tiếp — import từ test sẽ KHÔNG kích hoạt phần này.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
