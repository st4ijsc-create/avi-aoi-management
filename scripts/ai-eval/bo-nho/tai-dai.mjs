// Tải đo BỘ NHỚ llama-server :8091 (Đợt 9, 2026-10-23/24). N lượt (argv[2], mặc định 20), prompt KHÁC NHAU ~40k ký tự ≈ 12k token
// mỗi lượt ⇒ mỗi lượt mới buộc server lưu prompt cache của lượt trước (nếu cache-ram > 0). Chỉ đo bộ nhớ — KHÔNG chấm gì.
//   Tải A (mặc định): nghĩ TẮT, max_tokens 200.   Tải B (DAI_RA=1): nghĩ BẬT, max_tokens 6000 (KV dài, đầu ra dài).
// Chạy từ gốc repo:  node scripts/ai-eval/bo-nho/tai-dai.mjs 20   |   DAI_RA=1 node scripts/ai-eval/bo-nho/tai-dai.mjs 10
import fs from "node:fs";
const nguon = ["docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md", "server/services/aiLocalKnowledgeService.ts", "server/services/aiGgufEngine.ts", "server/routes/openaiGateway.ts"]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n\n");
const N = Number(process.argv[2] ?? 20), DAI = 40_000;
for (let i = 0; i < N; i++) {
  const tu = (i * 37_000) % Math.max(1, nguon.length - DAI);
  const doan = `[lượt ${i}] ` + nguon.slice(tu, tu + DAI);
  const t0 = Date.now();
  const DAI_RA = process.env.DAI_RA === "1";
  const r = await fetch("http://127.0.0.1:8091/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: doan + (DAI_RA ? "\n\nPhân tích thật kỹ từng phần của đoạn trên rồi viết lại thành tài liệu chi tiết." : "\n\nTóm tắt đoạn trên trong 3 gạch đầu dòng.") }],
      max_tokens: DAI_RA ? 6000 : 200, temperature: 0.2, ...(DAI_RA ? {} : { chat_template_kwargs: { enable_thinking: false } }),
    }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`${new Date().toISOString().slice(11, 19)} lượt ${i}: HTTP ${r.status} prompt ${j.usage?.prompt_tokens ?? "?"} tok · ra ${j.usage?.completion_tokens ?? "?"} tok · ${Date.now() - t0} ms`);
  if (!r.ok) process.exit(2);
}
