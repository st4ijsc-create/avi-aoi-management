/**
 * ★ Đợt 10.3 — OpenAI Chat Completions (`fetch` qua `MangNgoai`, không SDK) + bản TƯƠNG THÍCH OpenAI (vLLM / LM Studio / Ollama …:
 * `endpoint` của khoá + `/chat/completions`). Khoá ở header `Authorization: Bearer`.
 */
import { LoiNgoai } from "../loi";
import type { KetQuaNhaCungCap, NhaCungCapAi, TinNhanNgoai, YeuCauNhaCungCap } from "./kieu";
import { coToolGoc, lichSuXenKe, loiHttp, so } from "./chung";

export const URL_OPENAI = "https://api.openai.com/v1/chat/completions";

/**
 * (H3.3b) tin dạng GỐC: assistant mang `tool_calls` (id của bộ chuyển, `arguments` JSON của tham số ĐÃ CHE), kết quả là `role: "tool"` +
 * `tool_call_id`; tin tool KHÔNG có id (lịch sử cũ) vẫn thành user "Kết quả công cụ …" như đường chữ. Không gộp tin cùng vai (OpenAI nhận).
 */
function tinGoc(tinNhan: readonly TinNhanNgoai[]): unknown[] {
  const system = tinNhan.filter((m) => m.vaiTro === "system").map((m) => m.noiDung).join("\n\n");
  const ra: unknown[] = system ? [{ role: "system", content: system }] : [];
  for (const m of tinNhan) {
    if (m.vaiTro === "system") continue;
    if (m.vaiTro === "tool") {
      ra.push(m.idGoiTool !== undefined ? { role: "tool", tool_call_id: m.idGoiTool, content: m.noiDung } : { role: "user", content: `Kết quả công cụ ${m.tenTool ?? ""}:\n${m.noiDung}` });
    } else if (m.vaiTro === "assistant" && m.goiTool?.length) {
      ra.push({
        role: "assistant",
        content: m.noiDung || null,
        tool_calls: m.goiTool.map((g) => ({ id: g.id, type: "function", function: { name: g.ten, arguments: JSON.stringify(g.thamSo ?? {}) } })),
      });
    } else ra.push({ role: m.vaiTro, content: m.noiDung });
  }
  return ra;
}

function thanYeuCau(yc: YeuCauNhaCungCap, tuongThich: boolean): Record<string, unknown> {
  const tinNhan = (): unknown[] => {
    if (coToolGoc(yc.tinNhan)) return tinGoc(yc.tinNhan);
    const { system, ds } = lichSuXenKe(yc.tinNhan);
    return [...(system ? [{ role: "system", content: system }] : []), ...ds.map((m) => ({ role: m.vai, content: m.chu }))];
  };
  return {
    model: yc.model,
    messages: tinNhan(),
    // OpenAI mới dùng `max_completion_tokens` (và một số model không nhận `temperature`); máy chủ tương thích dùng `max_tokens`.
    ...(tuongThich ? { max_tokens: yc.maxTokens, temperature: yc.nhietDo } : { max_completion_tokens: yc.maxTokens }),
    ...(yc.congCu?.length ? { tools: yc.congCu.map((c) => ({ type: "function", function: { name: c.ten, description: c.moTa, parameters: c.schema } })) } : {}),
  };
}

function docKetQua(json: unknown): KetQuaNhaCungCap {
  const j = json as { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  const msg = j?.choices?.[0]?.message;
  return {
    noiDung: typeof msg?.content === "string" ? msg.content : "",
    toolCalls: (msg?.tool_calls ?? []).map((c) => {
      let thamSo: unknown = {};
      try {
        thamSo = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments) : (c.function?.arguments ?? {});
      } catch {
        thamSo = { __khongParse: String(c.function?.arguments ?? "").slice(0, 200) };
      }
      return { ten: String(c.function?.name ?? ""), thamSo };
    }),
    tokenVao: so(j?.usage?.prompt_tokens),
    tokenRa: so(j?.usage?.completion_tokens),
  };
}

export const openai: NhaCungCapAi = {
  ma: "openai",
  async goi(yc, layKhoa, mang) {
    const body = JSON.stringify(thanYeuCau(yc, false));
    const r = await mang.goiJson(URL_OPENAI, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await layKhoa()}` }, body });
    if (r.status >= 400) throw loiHttp(r.status, r.json, r.retryAfterMs, r.requestId);
    return { ...docKetQua(r.json), ...(r.requestId ? { requestId: r.requestId } : {}) };
  },
};

export const openaiTuongThich: NhaCungCapAi = {
  ma: "openai_compat",
  async goi(yc, layKhoa, mang, ngu) {
    if (!ngu.endpoint) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "thieu-endpoint", { chuaGui: true });
    const url = `${ngu.endpoint.replace(/\/+$/, "")}/chat/completions`;
    const body = JSON.stringify(thanYeuCau(yc, true));
    const r = await mang.goiJson(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await layKhoa()}` }, body });
    if (r.status >= 400) throw loiHttp(r.status, r.json, r.retryAfterMs, r.requestId);
    return { ...docKetQua(r.json), ...(r.requestId ? { requestId: r.requestId } : {}) };
  },
};
