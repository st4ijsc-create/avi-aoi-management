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
import { Agent, fetch as fetchUndici } from "undici";

/**
 * ★ Đợt 9 (2026-10-22, A/B /v1 lần 7: "TypeError: fetch failed" ở lượt > 300 s) — `fetch` của Node có `headersTimeout`
 * 300 s: lượt /v1 KHÔNG stream chỉ gửi header khi xong (27B nghĩ 16k + 2 vòng sửa vượt 300 s) ⇒ client tự cắt. Đường /v1
 * dùng undici riêng, KHÔNG trần header/body — trần thật là của SERVER (AI_KHE_NANG_INFER_TIMEOUT_MS).
 */
const KHONG_TRAN = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

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

  /**
   * ★ Đợt 9 — trục H qua cổng OpenAI `/v1/chat/completions` của server SẢN PHẨM (`<base>`), token NGƯỜI DÙNG `o.v1Token`,
   * `model` = vai trò (mặc định `code.plc` — định tuyến vai trò + vòng kiểm biên dịch ST nếu cờ bật). Không stream (nội dung
   * trả về là bản CUỐI). Giữ mọi header `x-st4i-*` (vd `x-st4i-bien-dich`) để báo cáo đọc được server đã làm gì.
   */
  async function chatV1(sys, user, { tatKiem = false } = {}) {
    const t0 = Date.now();
    const res = await fetchUndici(`${base}/v1/chat/completions`, {
      dispatcher: KHONG_TRAN,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.v1Token ?? ""}` },
      body: JSON.stringify({
        model: o.v1Model ?? "code.plc",
        messages: [...(sys ? [{ role: "system", content: sys }] : []), { role: "user", content: user }],
        ...kwargs(), ...sampling(), max_tokens: o.maxTokens, stream: false,
        // opt-out của client cho vòng kiểm biên dịch ST (server: `nenKiemBienDichV1`) — nhánh "off" của A/B trên CÙNG server
        ...(tatKiem ? { st4i_kiem_bien_dich: false } : {}),
      }),
    });
    const hdr = {};
    for (const [k, v] of res.headers) if (k.startsWith("x-st4i-")) hdr[k] = v;
    if (!res.ok) return { text: "", err: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, totalMs: Date.now() - t0, cut: false, hdr };
    const j = await res.json();
    const u = j.usage ?? {};
    const finish = j.choices?.[0]?.finish_reason ?? null;
    return { text: j.choices?.[0]?.message?.content ?? "", totalMs: Date.now() - t0, promptTok: u.prompt_tokens ?? null,
      genTok: u.completion_tokens ?? null, finish, cut: finish === "length", hdr, requestId: j.id ?? null };
  }

  /**
   * ★ Đợt 9 (2026-10-23) — `tatKiem` ⇒ `context.kiemBienDichST:false` (nhánh "tắt" của A/B vòng kiểm biên dịch ST trên CÙNG server);
   * `done.kiemBienDichST` của server ⇒ `kiemBienDich` (kiểm nhánh). undici KHÔNG trần: lượt dài (27B nghĩ + vòng sửa) không bị client
   * tự cắt — trần thật là của server.
   */
  async function chatPipeline(cauHoi, { tatKiem = false } = {}) {
    const t0 = Date.now();
    let tFirst = null;
    let kiemBienDich = null;
    const res = await fetchUndici(`${base}/api/ai/local-kb/stream`, {
      dispatcher: KHONG_TRAN,
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: o.cookie ?? "" },
      body: JSON.stringify({ question: cauHoi, topK: 5, history: [], userRole: "admin",
        context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo", ...(o.cheDoNghi ? { cheDoNghi: o.cheDoNghi } : {}),
          ...(tatKiem ? { kiemBienDichST: false } : {}) } }),
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
        if (ev.type === "done" && typeof ev.kiemBienDichST === "string") kiemBienDich = ev.kiemBienDichST;
      }
    }
    return { text, ttftMs: tFirst, totalMs: Date.now() - t0, evs, cut: evs.some((e) => /\((length|max_tokens)\)/i.test(e)), kiemBienDich };
  }

  /**
   * Cổng sức khoẻ: llama-server (+ server sản phẩm nếu dùng pipeline). Hỏng ⇒ exit 2 (mặc định), hoặc `thoat: false` ⇒
   * trả `false` để người gọi GHI phần đã đo rồi mới thoát (★ Đợt 9 — sự cố 2026-10-21: :8091 bị giết ở lượt 68/72, cổng
   * exit TRƯỚC khi ghi báo cáo ⇒ mất cả 68 lượt hợp lệ).
   */
  async function kiemSong(luc, { pipeline = false, thoat = true } = {}) {
    const thu = async (url, ten) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status >= 500 || (url.endsWith("/health") && r.status !== 200)) throw new Error(`HTTP ${r.status}`);
        return true;
      } catch (e) {
        console.error(`\n⛔ VỨT KẾT QUẢ: ${ten} KHÔNG khoẻ ${luc} (${e?.message ?? e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
        if (thoat) process.exit(2);
        return false;
      }
    };
    const u = new URL(rawUrl);
    if (!(await thu(u.port === "11434" ? `${u.origin}/api/tags` : `${u.origin}/health`, `llama-server ${u.origin}`))) return false;
    if (pipeline && !(await thu(`${base}/`, `server ${base}`))) return false;
    return true;
  }

  /** ★ Đợt 9 — model llama-server ĐANG chạy (`/v1/models`), basename; `null` = không đọc được. */
  async function modelDangChay() {
    try {
      const u = new URL(rawUrl);
      const j = await (await fetch(`${u.origin}/v1/models`, { signal: AbortSignal.timeout(5000) })).json();
      const id = String(j?.data?.[0]?.id ?? "");
      return id ? id.split(/[\\/]/).pop() : null;
    } catch {
      return null;
    }
  }

  return { chatRaw, chatRawTin, hoanThanhRaw, chatPipeline, chatV1, kiemSong, modelDangChay };
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
