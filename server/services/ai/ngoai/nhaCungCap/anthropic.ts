/** ★ Đợt 10.3 — Anthropic Messages API (`fetch` qua `MangNgoai`, không SDK). Khoá ở header `x-api-key`. */
import type { NhaCungCapAi } from "./kieu";
import { lichSuXenKe, loiHttp, so } from "./chung";

export const URL_ANTHROPIC = "https://api.anthropic.com/v1/messages";

export const anthropic: NhaCungCapAi = {
  ma: "anthropic",
  async goi(yc, layKhoa, mang) {
    const { system, ds } = lichSuXenKe(yc.tinNhan);
    const body = {
      model: yc.model,
      max_tokens: yc.maxTokens,
      temperature: yc.nhietDo,
      ...(system ? { system } : {}),
      messages: ds.map((m) => ({ role: m.vai, content: m.chu })),
      ...(yc.congCu?.length ? { tools: yc.congCu.map((c) => ({ name: c.ten, description: c.moTa, input_schema: c.schema })) } : {}),
    };
    const khoa = await layKhoa();
    const r = await mang.goiJson(URL_ANTHROPIC, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": khoa, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (r.status >= 400) throw loiHttp(r.status, r.json);
    const j = r.json as { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    const khoi = Array.isArray(j?.content) ? j.content : [];
    return {
      noiDung: khoi.filter((k) => k.type === "text").map((k) => k.text ?? "").join(""),
      toolCalls: khoi.filter((k) => k.type === "tool_use").map((k) => ({ ten: String(k.name ?? ""), thamSo: k.input ?? {} })),
      tokenVao: so(j?.usage?.input_tokens),
      tokenRa: so(j?.usage?.output_tokens),
    };
  },
};
