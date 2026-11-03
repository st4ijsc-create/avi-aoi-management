/** ★ Đợt 10.3 — Anthropic Messages API (`fetch` qua `MangNgoai`, không SDK). Khoá ở header `x-api-key`. */
import type { NhaCungCapAi, TinNhanNgoai } from "./kieu";
import { coToolGoc, lichSuXenKe, loiHttp, so } from "./chung";

export const URL_ANTHROPIC = "https://api.anthropic.com/v1/messages";

type KhoiAnthropic = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "tool_result"; tool_use_id: string; content: string };

/**
 * (H3.3b) tin dạng GỐC: assistant ⇒ khối `text` + `tool_use{id,name,input}` (tham số ĐÃ CHE); kết quả có id ⇒ `tool_result` trong tin USER
 * ngay sau; tin cùng vai liền nhau GỘP khối (Anthropic đòi xen kẽ), trong tin user `tool_result` đứng TRƯỚC chữ; tin đầu phải là user;
 * không khối chữ rỗng. Tin tool không id (lịch sử cũ) ⇒ khối chữ "Kết quả công cụ …" như đường chữ.
 */
function tinGoc(tinNhan: readonly TinNhanNgoai[]): Array<{ role: "user" | "assistant"; content: KhoiAnthropic[] }> {
  const ds: Array<{ role: "user" | "assistant"; content: KhoiAnthropic[] }> = [];
  for (const m of tinNhan) {
    if (m.vaiTro === "system") continue;
    const role: "user" | "assistant" = m.vaiTro === "assistant" ? "assistant" : "user";
    const khoi: KhoiAnthropic[] = [];
    if (m.vaiTro === "tool") {
      if (m.idGoiTool !== undefined) khoi.push({ type: "tool_result", tool_use_id: m.idGoiTool, content: m.noiDung });
      else khoi.push({ type: "text", text: `Kết quả công cụ ${m.tenTool ?? ""}:\n${m.noiDung}` });
    } else {
      if (m.noiDung) khoi.push({ type: "text", text: m.noiDung });
      for (const g of m.goiTool ?? []) khoi.push({ type: "tool_use", id: g.id, name: g.ten, input: g.thamSo ?? {} });
    }
    if (!khoi.length) continue;
    const cuoi = ds[ds.length - 1];
    if (cuoi && cuoi.role === role) cuoi.content.push(...khoi);
    else ds.push({ role, content: khoi });
  }
  for (const t of ds) if (t.role === "user") t.content.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"));
  if (!ds.length || ds[0]!.role !== "user") ds.unshift({ role: "user", content: [{ type: "text", text: "(bắt đầu)" }] });
  return ds;
}

export const anthropic: NhaCungCapAi = {
  ma: "anthropic",
  async goi(yc, layKhoa, mang) {
    const { system, ds } = lichSuXenKe(yc.tinNhan);
    const goc = coToolGoc(yc.tinNhan);
    const body = {
      model: yc.model,
      max_tokens: yc.maxTokens,
      temperature: yc.nhietDo,
      ...(system ? { system } : {}),
      messages: goc ? tinGoc(yc.tinNhan) : ds.map((m) => ({ role: m.vai, content: m.chu })),
      ...(yc.congCu?.length ? { tools: yc.congCu.map((c) => ({ name: c.ten, description: c.moTa, input_schema: c.schema })) } : {}),
    };
    const khoa = await layKhoa();
    const r = await mang.goiJson(URL_ANTHROPIC, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": khoa, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (r.status >= 400) throw loiHttp(r.status, r.json, r.retryAfterMs, r.requestId);
    const j = r.json as { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    const khoi = Array.isArray(j?.content) ? j.content : [];
    return {
      noiDung: khoi.filter((k) => k.type === "text").map((k) => k.text ?? "").join(""),
      toolCalls: khoi.filter((k) => k.type === "tool_use").map((k) => ({ ten: String(k.name ?? ""), thamSo: k.input ?? {} })),
      tokenVao: so(j?.usage?.input_tokens),
      tokenRa: so(j?.usage?.output_tokens),
      ...(r.requestId ? { requestId: r.requestId } : {}),
    };
  },
};
