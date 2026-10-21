/**
 * GỌI MODEL — dùng chung cho đường (a) và lát MultiPL-E. Ba cửa:
 *   chatRaw        POST <rawUrl> (/v1/chat/completions của llama-server) — trục M (model thuần)
 *   hoanThanhRaw   POST <origin>/v1/completions với `stop` — giao thức GỐC của MultiPL-E (hoàn thành tiền tố)
 *   chatPipeline   POST <base>/api/ai/local-kb/stream (codingMode) — trục H (đường sản phẩm), y như codegen-chay-duoc/run.mjs
 * Mỗi cửa trả { text, totalMs, genTok?, promptTok?, finish?, cut, err?, ttftMs?, evs? }. `cut` = chạm trần token
 * (finish_reason "length") — luật số 1: báo cụt, cụt ≠ 0 ⇒ số là chặn dưới.
 *
 * Tuỳ chọn (từ dòng lệnh): maxTokens · khongNghi (chat_template_kwargs.enable_thinking=false) · effort ·
 * sampling "hien-tai" (0,2/0,9 — như mọi báo cáo cũ) | "chinh-hang" (model card Qwen3.6) · model · rawUrl · base · cookie ·
 * cheDoNghi (pipeline).
 */
export function taoGoiModel(o) {
  const rawUrl = o.rawUrl ?? "http://127.0.0.1:8091/v1/chat/completions";
  const goc = new URL(rawUrl).origin;
  const base = (o.base ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

  const sampling = () => {
    if (o.sampling !== "chinh-hang") return { temperature: 0.2, top_p: 0.9 };
    return o.khongNghi
      ? { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1.0 }
      : { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1.0 };
  };
  const kwargs = () => {
    const kw = {};
    if (o.khongNghi) kw.enable_thinking = false;
    if (o.effort) kw.reasoning_effort = o.effort;
    return Object.keys(kw).length ? { chat_template_kwargs: kw } : {};
  };

  async function chatRaw(sys, user) {
    return chatRawTin([...(sys ? [{ role: "system", content: sys }] : []), { role: "user", content: user }]);
  }

  /** Như `chatRaw` nhưng nhận CẢ lịch sử hội thoại (vòng sửa theo lỗi biên dịch — `mot-luot.mjs --vong-sua`). */
  async function chatRawTin(messages) {
    const t0 = Date.now();
    const res = await fetch(rawUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(o.model ? { model: o.model } : {}),
        messages,
        ...kwargs(), ...sampling(), max_tokens: o.maxTokens, stream: false,
      }),
    });
    if (!res.ok) return { text: "", err: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, totalMs: Date.now() - t0, cut: false };
    const j = await res.json();
    const u = j.usage ?? {};
    const finish = j.choices?.[0]?.finish_reason ?? null;
    return { text: j.choices?.[0]?.message?.content ?? "", totalMs: Date.now() - t0, promptTok: u.prompt_tokens ?? null,
      genTok: u.completion_tokens ?? null, finish, cut: finish === "length" };
  }

  /** Hoàn thành tiền tố thô (không chat template) — model tiếp nối `prompt`, dừng ở `stop`. */
  async function hoanThanhRaw(prompt, stop) {
    const t0 = Date.now();
    const res = await fetch(`${goc}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(o.model ? { model: o.model } : {}), prompt, stop, ...sampling(), max_tokens: o.maxTokens, stream: false }),
    });
    if (!res.ok) return { text: "", err: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, totalMs: Date.now() - t0, cut: false };
    const j = await res.json();
    const u = j.usage ?? {};
    const finish = j.choices?.[0]?.finish_reason ?? null;
    let text = j.choices?.[0]?.text ?? "";
    // Phòng server không cắt ở stop: cắt ở lần xuất hiện ĐẦU TIÊN của bất kỳ stop nào (đúng giao thức MultiPL-E).
    for (const s of stop ?? []) { const i = text.indexOf(s); if (i >= 0) text = text.slice(0, i); }
    return { text, totalMs: Date.now() - t0, promptTok: u.prompt_tokens ?? null, genTok: u.completion_tokens ?? null, finish, cut: finish === "length" };
  }

  async function chatPipeline(cauHoi) {
    const t0 = Date.now();
    let tFirst = null;
    const res = await fetch(`${base}/api/ai/local-kb/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: o.cookie ?? "" },
      body: JSON.stringify({ question: cauHoi, topK: 5, history: [], userRole: "admin",
        context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo", ...(o.cheDoNghi ? { cheDoNghi: o.cheDoNghi } : {}) } }),
    });
    if (!res.ok) return { text: "", err: `HTTP ${res.status}`, totalMs: Date.now() - t0, cut: false };
    let text = "", buf = "";
    const dec = new TextDecoder();
    const evs = [];
    for await (const c of res.body) {
      buf += dec.decode(c, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const blk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = blk.match(/^data:\s*([\s\S]*)$/m);
        if (!m) continue;
        let ev;
        try { ev = JSON.parse(m[1]); } catch { continue; }
        if (ev.type === "token") { if (tFirst === null) tFirst = Date.now() - t0; text += ev.token ?? ""; }
        // Gương client: `done.answerRevised` ⇒ văn bản đã sửa tất định sau stream THAY văn bản tích luỹ.
        else if (ev.type === "done" && ev.answerRevised === true && typeof ev.answer === "string") { text = ev.answer; evs.push("done:revised"); }
        else evs.push(ev.type + (ev.stop ? `(${ev.stop})` : ""));
      }
    }
    return { text, ttftMs: tFirst, totalMs: Date.now() - t0, evs, cut: evs.some((e) => /\((length|max_tokens)\)/i.test(e)) };
  }

  /** Cổng sức khoẻ: llama-server (+ server sản phẩm nếu dùng pipeline). Hỏng ⇒ exit 2. */
  async function kiemSong(luc, { pipeline = false } = {}) {
    const thu = async (url, ten) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status >= 500 || (url.endsWith("/health") && r.status !== 200)) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        console.error(`\n⛔ VỨT KẾT QUẢ: ${ten} KHÔNG khoẻ ${luc} (${e?.message ?? e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
        process.exit(2);
      }
    };
    const u = new URL(rawUrl);
    await thu(u.port === "11434" ? `${u.origin}/api/tags` : `${u.origin}/health`, `llama-server ${u.origin}`);
    if (pipeline) await thu(`${base}/`, `server ${base}`);
  }

  return { chatRaw, chatRawTin, hoanThanhRaw, chatPipeline, kiemSong };
}

/** Đọc tuỳ chọn gọi model từ argv (cùng tên cờ với codegen-chay-duoc/run.mjs). */
export function tuyChonTuArgs(args, macDinhMaxTokens = 16000) {
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  return {
    rawUrl: arg("--raw-url", "http://127.0.0.1:8091/v1/chat/completions"),
    base: process.env.AI_EVAL_BASE || "http://127.0.0.1:3000",
    maxTokens: Number(arg("--max-tokens", macDinhMaxTokens)),
    khongNghi: args.includes("--khong-nghi"),
    effort: arg("--effort", null),
    sampling: arg("--sampling", "hien-tai"),
    model: arg("--model", null),
    cheDoNghi: arg("--che-do-nghi", null),
  };
}
