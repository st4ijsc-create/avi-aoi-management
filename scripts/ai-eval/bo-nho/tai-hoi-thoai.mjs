// Tải HỘI THOẠI NHIỀU LƯỢT có tái dùng tiền tố (Đợt 9 (B) `--ctx-checkpoints`, 2026-10-24 — spec 2026-10-20 §6). Gửi thẳng :8091, chỉ HTTP.
// Mỗi vòng: pha DÀI = một cuộc --dai lượt LIÊN TIẾP, rồi pha XEN KẼ = --cuoc cuộc × --luot lượt. Mỗi cuộc một câu hệ thống ~1,5k token riêng;
// mỗi lượt thêm một đoạn mã ~2k ký tự + câu hỏi; lịch sử TÍCH LUỸ (gồm câu trả lời). Nghĩ tắt, ra ≤ 400. Ghi mỗi lượt: thời gian,
// `timings.prompt_n` (token prompt PHẢI xử lý lại — tái dùng được thì nhỏ), `prompt_ms`. Thử trên 35B: lượt liên tiếp cùng cuộc ⇒ prompt_n
// ~1,3k/3–4k (tái dùng); đổi cuộc ⇒ prompt_n = cả prompt (slot chỉ giữ một tiền tố).
//   node scripts/ai-eval/bo-nho/tai-hoi-thoai.mjs [--vong 2] [--dai 40] [--luot 6] [--cuoc 3] [--ra tep.jsonl]
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const VONG = Number(arg("vong", 2)), LUOT = Number(arg("luot", 6)), CUOC = Number(arg("cuoc", 3)), DAI = Number(arg("dai", 40)), RA = arg("ra", "");
const nguon = ["server/services/aiLocalKnowledgeService.ts", "server/services/aiGgufEngine.ts", "server/routes/openaiGateway.ts", "server/services/aiLlamaServerClient.ts"]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n\n");
const tai = "docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md";
const docs = fs.readFileSync(tai, "utf8");
const doan = (seed, dai) => { const tu = (seed * 7_919) % Math.max(1, nguon.length - dai); return nguon.slice(tu, tu + dai); };
let tongPromptN = 0, n = 0, loi = 0;
for (let v = 0; v < VONG; v++) {
  // Pha DÀI: MỘT cuộc DAI lượt LIÊN TIẾP (checkpoint tích luỹ tới trần N — hình dạng hội thoại dài 27B của sự cố 22:20), rồi pha XEN KẼ:
  // CUOC cuộc × LUOT lượt (đổi cuộc ⇒ slot mất tiền tố — đo giá đổi cuộc).
  const moi = (c) => { const tu = ((v * 10 + c) * 5_003) % Math.max(1, docs.length - 5000); return [{ role: "system", content: `Bạn là trợ lý lập trình của dự án (cuộc ${v}.${c}). Bối cảnh dự án:\n${docs.slice(tu, tu + 5000)}` }]; };
  const lich = [...Array.from({ length: DAI }, (_, l) => ({ pha: "dai", c: 9, l })), ...Array.from({ length: LUOT * CUOC }, (_, k) => ({ pha: "xen", c: k % CUOC, l: Math.floor(k / CUOC) }))];
  const hoiThoai = { 9: moi(9), ...Object.fromEntries(Array.from({ length: CUOC }, (_, c) => [c, moi(c)])) };
  for (const { pha, c, l } of lich) {
    {
      const ls = hoiThoai[c];
      ls.push({ role: "user", content: `Đoạn mã ${l}:\n${doan(v * 1000 + c * 100 + l, 2000)}\n\nĐoạn này làm gì? Một câu.` });
      const t0 = Date.now();
      const r = await fetch("http://127.0.0.1:8091/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: ls, max_tokens: 400, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } }),
      });
      const j = await r.json().catch(() => ({}));
      const ms = Date.now() - t0;
      const tl = j.choices?.[0]?.message?.content ?? "";
      ls.push({ role: "assistant", content: tl || "(rỗng)" });
      const pn = j.timings?.prompt_n, pms = j.timings?.prompt_ms;
      if (!r.ok) loi++;
      if (Number.isFinite(pn)) tongPromptN += pn;
      n++;
      const dong = { v, pha, l, c, http: r.status, ms, promptN: pn ?? null, promptMs: pms ? Math.round(pms) : null, vao: j.usage?.prompt_tokens ?? null };
      if (RA) fs.appendFileSync(RA, JSON.stringify(dong) + "\n");
      console.log(`${new Date().toISOString().slice(11, 19)} v${v} ${pha} l${l} c${c}: HTTP ${r.status} vào ${dong.vao} prompt_n ${pn} · ${ms} ms`);
      if (!r.ok) { console.log(JSON.stringify(j).slice(0, 300)); if (loi > 3) process.exit(2); }
    }
  }
}
console.log(`TONG: ${n} lượt · lỗi ${loi} · tổng prompt_n ${tongPromptN}`);
