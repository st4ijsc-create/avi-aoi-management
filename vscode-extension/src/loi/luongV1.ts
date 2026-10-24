/**
 * ★★★ ĐỢT 4B — bộ đọc luồng SSE của `/v1/chat/completions` (THUẦN, khuôn OpenAI chunk).
 *
 * Gom: `delta.content` ⇒ chữ · `delta.reasoning_content` ⇒ suy luận · `delta.tool_calls` ⇒ tool call ghép theo
 * `index` (mảnh đầu mang id+name, mảnh sau nối `arguments`) · `usage` (khi máy chủ có trả) · `finish_reason`.
 * Lỗi: chunk có `error` (khung lỗi giữa luồng của cổng — `finish_reason:"error"` hoặc khung `{error}` của nhánh catch)
 * ⇒ ghi nhận `loi`; mọi chữ/suy luận SAU lỗi bị bỏ (thuộc về lượt hỏng).
 *
 * ★ Máy chủ 126de672b (4B-server): xin `stream_options.include_usage` ⇒ chunk CUỐI `choices: []` + `usage` (prompt/
 *   completion/`completion_tokens_details.reasoning_tokens`), sau finish và trước `[DONE]`. Máy chủ cũ không gửi ⇒ `usage`
 *   vắng và lõi agent tự ước lượng (khai rõ là ước lượng).
 */
import type { WireToolCall } from "../../../shared/agentCore/index";

/** Dấu lỗi máy chủ gắn khi model phát tool call TRONG suy luận (`aiLlamaServerClient.ts`). */
export const DAU_TOOL_CALL_TRONG_SUY_LUAN = "TOOL_CALL_TRONG_SUY_LUAN";

export type ManhDoc =
  | { loai: "chu"; noiDung: string }
  | { loai: "nghi"; noiDung: string };

export interface TrangThaiLuongV1 {
  toolCalls: Map<number, { id: string; name: string; args: string }>;
  usage?: { vao: number; ra: number; nghi?: number };
  ketThuc: boolean;
  finishReason?: string;
  loi?: string;
  /** `error.code` của khung lỗi (nếu máy chủ có gửi) — vd `tool_call_in_reasoning`. */
  maLoi?: string;
}

export function trangThaiLuongMoi(): TrangThaiLuongV1 {
  return { toolCalls: new Map(), ketThuc: false };
}

const so = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Áp MỘT sự kiện JSON đã tách; trả các mảnh chữ/suy luận cần phát ngay. */
export function apSuKienV1(tt: TrangThaiLuongV1, sk: Record<string, unknown>): ManhDoc[] {
  const ra: ManhDoc[] = [];
  const loiTop = sk.error as { message?: unknown } | undefined;
  if (loiTop && typeof loiTop === "object") {
    tt.loi ??= typeof loiTop.message === "string" ? loiTop.message : "lỗi sinh chữ không rõ";
    const ma = (loiTop as { code?: unknown }).code;
    if (typeof ma === "string" && ma) tt.maLoi ??= ma;
    return ra;
  }
  const u = sk.usage as Record<string, unknown> | undefined;
  if (u && typeof u === "object") {
    const vao = so(u.prompt_tokens);
    const raTok = so(u.completion_tokens);
    if (vao !== undefined || raTok !== undefined) {
      const nghi = so((u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
      tt.usage = { vao: vao ?? 0, ra: raTok ?? 0, ...(nghi !== undefined ? { nghi } : {}) };
    }
  }
  const choices = Array.isArray(sk.choices) ? sk.choices : [];
  const c = choices[0] as Record<string, unknown> | undefined;
  if (!c) return ra;
  if (tt.loi) return ra; // sau lỗi: không phát gì nữa
  const delta = (c.delta ?? c.message ?? {}) as Record<string, unknown>;
  if (typeof delta.content === "string" && delta.content) ra.push({ loai: "chu", noiDung: delta.content });
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) ra.push({ loai: "nghi", noiDung: delta.reasoning_content });
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls.forEach((t0, k) => {
      const t = (t0 ?? {}) as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const idx = typeof t.index === "number" ? t.index : k;
      const cu = tt.toolCalls.get(idx) ?? { id: "", name: "", args: "" };
      if (typeof t.id === "string" && t.id) cu.id = t.id;
      if (typeof t.function?.name === "string" && t.function.name) cu.name = t.function.name;
      const a = t.function?.arguments;
      if (typeof a === "string") cu.args += a;
      else if (a && typeof a === "object") cu.args += JSON.stringify(a);
      tt.toolCalls.set(idx, cu);
    });
  }
  if (typeof c.finish_reason === "string" && c.finish_reason) {
    tt.finishReason = c.finish_reason;
    if (c.finish_reason === "error") {
      const e = (sk.error ?? c.error) as { message?: unknown } | undefined;
      tt.loi ??= typeof e?.message === "string" ? e.message : "lỗi sinh chữ không rõ";
    }
  }
  return ra;
}

export function toolCallsCuoi(tt: TrangThaiLuongV1): WireToolCall[] {
  return [...tt.toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, t]) => t.name)
    .map(([i, t]) => ({ id: t.id || `call_${i}`, type: "function" as const, function: { name: t.name, arguments: t.args } }));
}

export function laLoiToolCallTrongSuyLuan(thongDiep: string | undefined): boolean {
  return !!thongDiep && thongDiep.includes(DAU_TOOL_CALL_TRONG_SUY_LUAN);
}

/** Dấu G5-D ca (B) trong thông điệp máy chủ (`aiLlamaServerClient.DAU_G5D`) — máy chủ CŨ chưa gửi `error.code`. */
export const DAU_G5D = "TỪ CHỐI TRUNG THỰC (G5-D";
export type LoiSuyLuanV1 = "tool_call_in_reasoning" | "reasoning_without_content";

/**
 * ★★★ Đợt 4 (V-dot4-1/2) — lỗi "model trả lời vào KÊNH SUY LUẬN, content rỗng" mà hỏi lại nghĩ TẮT chữa được.
 * Ưu tiên `error.code` của máy chủ mới (`server/routes/openaiGateway.ts` `maLoiSuyLuanV1`); máy chủ cũ ⇒ dấu chuỗi.
 * `null` = lớp khác (không hỏi lại).
 */
export function phanLoaiLoiSuyLuan(thongDiep: string | undefined, ma: string | undefined): LoiSuyLuanV1 | null {
  if (ma === "tool_call_in_reasoning" || ma === "reasoning_without_content") return ma;
  if (laLoiToolCallTrongSuyLuan(thongDiep)) return "tool_call_in_reasoning";
  if (thongDiep && thongDiep.includes(DAU_G5D)) return "reasoning_without_content";
  return null;
}

export const LOI_ANH_V1: Record<string, (chiTiet: string) => string> = {
  IMAGE_KHONG_HO_TRO: () =>
    "Máy chủ AI chưa bật đọc ảnh — sẽ có sau khi llama-server khởi động lại. Gửi lại không kèm ảnh, hoặc thử lại sau khi máy chủ khởi động lại model.",
  ANH_QUA_LON: () => "Ảnh quá lớn (tối đa 6 MB mỗi ảnh, 12 MB mỗi lượt).",
  QUA_NHIEU_ANH: () => "Quá nhiều ảnh (tối đa 4 ảnh mỗi lượt, tính cả lịch sử).",
  ANH_SAI_DINH_DANG: () => "Ảnh không đúng định dạng (chỉ nhận PNG/JPEG/WebP).",
  NOI_DUNG_KHONG_HO_TRO: () => "Nội dung đính kèm không được hỗ trợ.",
};

/** Thông điệp tiếng Việt cho lỗi HTTP của cổng `/v1` — nói ĐÚNG việc phải làm. */
export function moTaLoiHttpV1(status: number, than: unknown, retryAfter?: string | null): { thongDiep: string; ma: string; tamThoi: boolean } {
  const e = (than && typeof than === "object" ? (than as { error?: unknown }).error : undefined) as
    | { message?: unknown; code?: unknown }
    | string
    | undefined;
  const code = typeof e === "object" && typeof e?.code === "string" ? e.code : typeof e === "string" ? e : "";
  const msg = typeof e === "object" && typeof e?.message === "string" ? e.message : "";
  const chiTiet = [code, msg].filter(Boolean).join(": ");
  if (status === 401) {
    return {
      ma: "TOKEN_401",
      tamThoi: false,
      thongDiep:
        `Token cổng /v1 bị từ chối (401${chiTiet ? ` — ${chiTiet}` : ""}): chưa có, hết hạn hoặc đã thu hồi. ` +
        `Chạy lệnh "AI Local: Đăng nhập AI Local (device flow)" để lấy token mới.`,
    };
  }
  if (status === 403) {
    const goiY =
      code === "insufficient_scope"
        ? "token thiếu phạm vi 'chat' — đăng nhập lại để xin token mới"
        : code === "password_change_required"
          ? "tài khoản phải đổi mật khẩu trên web trước"
          : code === "account_disabled"
            ? "tài khoản đã bị khoá"
            : "tài khoản không còn quyền AI hoặc giấy phép module AI chưa bật";
    return { ma: "TOKEN_403", tamThoi: false, thongDiep: `Máy chủ từ chối (403${chiTiet ? ` — ${chiTiet}` : ""}): ${goiY}.` };
  }
  if (status === 429) {
    const giay = retryAfter && /^\d+$/.test(retryAfter) ? ` Thử lại sau ~${retryAfter} giây.` : "";
    const loai = code === "quota_exceeded" ? "hết hạn mức token" : "vượt trần số lượt/phút của token";
    return { ma: "GIOI_HAN_429", tamThoi: false, thongDiep: `Máy chủ chặn tạm (429 — ${loai}).${giay}` };
  }
  // ★ 0.3.2 — mã lỗi ẢNH của /v1 (do-model): nói ĐÚNG việc phải làm bằng tiếng Việt, không thử lại im lặng. Đứng TRƯỚC nhánh "tool" (thông điệp tiếng Anh có thể chứa chữ khác).
  if (code in LOI_ANH_V1) {
    return { ma: code, tamThoi: false, thongDiep: LOI_ANH_V1[code]!(chiTiet) };
  }
  if (status === 400 && /native|tool/i.test(code + msg)) {
    return {
      ma: "TOOL_CALL_TAT",
      tamThoi: false,
      thongDiep: `Máy chủ chưa nhận tool-calling gốc trên /v1 (400 — ${chiTiet}). Quản trị phải bật cờ tool-calling của cổng /v1.`,
    };
  }
  if (status === 404) {
    return { ma: "V1_404", tamThoi: false, thongDiep: "Máy chủ không có /v1/chat/completions (cổng OpenAI chưa bật — OPENAI_GATEWAY_ENABLED)." };
  }
  if (status >= 500) return { ma: `HTTP_${status}`, tamThoi: true, thongDiep: `Máy chủ lỗi ${status}${chiTiet ? ` — ${chiTiet}` : ""}.` };
  return { ma: `HTTP_${status}`, tamThoi: false, thongDiep: `Máy chủ trả ${status}${chiTiet ? ` — ${chiTiet}` : ""}.` };
}
