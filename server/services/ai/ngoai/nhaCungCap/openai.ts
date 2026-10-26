/**
 * ★ Đợt 10.3 — OpenAI Chat Completions (`fetch` qua `MangNgoai`, không SDK) + bản TƯƠNG THÍCH OpenAI (vLLM / LM Studio / Ollama …:
 * `endpoint` của khoá + `/chat/completions`). Khoá ở header `Authorization: Bearer`.
 */
import { LoiNgoai } from "../loi";
import type { KetQuaNhaCungCap, NhaCungCapAi, YeuCauNhaCungCap } from "./kieu";
import { lichSuXenKe, loiHttp, so } from "./chung";

export const URL_OPENAI = "https://api.openai.com/v1/chat/completions";

function thanYeuCau(yc: YeuCauNhaCungCap, tuongThich: boolean): Record<string, unknown> {
  const { system, ds } = lichSuXenKe(yc.tinNhan);
  return {
    model: yc.model,
    messages: [...(system ? [{ role: "system", content: system }] : []), ...ds.map((m) => ({ role: m.vai, content: m.chu }))],
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
    if (r.status >= 400) throw loiHttp(r.status, r.json);
    return docKetQua(r.json);
  },
};

export const openaiTuongThich: NhaCungCapAi = {
  ma: "openai_compat",
  async goi(yc, layKhoa, mang, ngu) {
    if (!ngu.endpoint) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "thieu-endpoint", { chuaGui: true });
    const url = `${ngu.endpoint.replace(/\/+$/, "")}/chat/completions`;
    const body = JSON.stringify(thanYeuCau(yc, true));
    const r = await mang.goiJson(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await layKhoa()}` }, body });
    if (r.status >= 400) throw loiHttp(r.status, r.json);
    return docKetQua(r.json);
  },
};
