/**
 * ★ Đợt 10.3 — Google Gemini `generateContent` (`fetch` qua `MangNgoai`, không SDK). Khoá ở header `x-goog-api-key` — KHÔNG để trong
 * URL. Tên model vào ĐƯỜNG DẪN ⇒ `kiemTenModelDuongDan` (rà kiem-dinh mục 11: `..`, `?`, `#`, `%2f`, `/` ⇒ từ chối).
 */
import { LoiNgoai } from "../loi";
import type { NhaCungCapAi } from "./kieu";
import { lichSuXenKe, loiHttp, so } from "./chung";

export const GOC_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

export function kiemTenModelDuongDan(m: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(m) || m.includes("..")) throw new LoiNgoai("NGOAI_MODEL_KHONG_HOP_LE", "", { chuaGui: true });
  return encodeURIComponent(m);
}

/** Gemini nhận một TẬP CON JSON schema (không `additionalProperties`). */
function schemaGemini(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(schemaGemini);
  if (s === null || typeof s !== "object") return s;
  return Object.fromEntries(Object.entries(s as Record<string, unknown>).filter(([k]) => k !== "additionalProperties").map(([k, v]) => [k, schemaGemini(v)]));
}

export const gemini: NhaCungCapAi = {
  ma: "gemini",
  async goi(yc, layKhoa, mang) {
    const url = `${GOC_GEMINI}/${kiemTenModelDuongDan(yc.model)}:generateContent`;
    const { system, ds } = lichSuXenKe(yc.tinNhan);
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: ds.map((m) => ({ role: m.vai === "assistant" ? "model" : "user", parts: [{ text: m.chu }] })),
      generationConfig: { maxOutputTokens: yc.maxTokens, temperature: yc.nhietDo },
      ...(yc.congCu?.length ? { tools: [{ functionDeclarations: yc.congCu.map((c) => ({ name: c.ten, description: c.moTa, parameters: schemaGemini(c.schema) })) }] } : {}),
    };
    const r = await mang.goiJson(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": await layKhoa() }, body: JSON.stringify(body) });
    if (r.status >= 400) throw loiHttp(r.status, r.json);
    const j = r.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: unknown; args?: unknown } }> } }>; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } };
    const parts = j?.candidates?.[0]?.content?.parts ?? [];
    return {
      noiDung: parts.map((p) => p.text ?? "").join(""),
      toolCalls: parts.filter((p) => p.functionCall).map((p) => ({ ten: String(p.functionCall!.name ?? ""), thamSo: p.functionCall!.args ?? {} })),
      tokenVao: so(j?.usageMetadata?.promptTokenCount),
      tokenRa: so(j?.usageMetadata?.candidatesTokenCount),
    };
  },
};
