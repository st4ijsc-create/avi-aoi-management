/**
 * ★ Đợt 10.3 — phần dùng chung của các bản cài nhà cung cấp: lỗi HTTP ⇒ `LoiNgoai` (thông điệp THÔ — cổng che bằng `cheChuoi` trước
 * khi ném / ghi), số token, lịch sử chữ (công cụ cũ đã là dòng chữ — giới hạn đã ghi: model ngoài KHÔNG thấy tool_use gốc).
 */
import { LoiNgoai, requestIdHopLe, type PhanLoaiLoiNgoai } from "../loi";
import type { GoiToolNgoai, TinNhanNgoai } from "./kieu";

/** Trường lỗi của ba họ API (OpenAI `error.code/type`, Anthropic `error.type`, Gemini `error.status`) gộp thành chữ thường để so khớp. */
function dauHieu(json: unknown): { thongDiep: string; ma: string } {
  const j = json as { error?: { message?: unknown; type?: unknown; code?: unknown; status?: unknown } | string; message?: unknown; type?: unknown } | null;
  const e = j?.error;
  const thongDiep = typeof e === "string" ? e : String(e?.message ?? j?.message ?? "");
  const ma = typeof e === "object" && e ? [e.code, e.type, e.status].filter((x) => typeof x === "string").join(" ") : String(j?.type ?? "");
  return { thongDiep, ma: ma.toLowerCase() };
}

/**
 * Chữ chỉ dùng khi MÃ không nói rõ. ⚠ Không có `billing` đứng riêng: 429 RPM/TPM THẬT của OpenAI (code `rate_limit_exceeded`) kết thúc bằng
 * "…adding a payment method … /account/billing" (rà kiem-dinh H3.1) — đó là RATE_LIMIT.
 */
const RE_QUOTA = /credit balance is too low|exceeded your current quota/i;
/** Gemini `RESOURCE_EXHAUSTED` dùng chung cho hạn mức NGÀY (QUOTA) và theo PHÚT / tầng miễn phí (RATE_LIMIT). */
const RE_GEMINI_NGAY = /per ?day|perday|requests_per_day|_daily/i;
const RE_TRAN_NGU_CANH = /context_length_exceeded|context length|context window|prompt is too long|maximum context|too many tokens|exceeds the maximum number of tokens|input is too long/i;

/**
 * ★ Đợt 12 H3.1 — phân loại lỗi HTTP của nhà cung cấp (thuần, ổn định theo MÃ trước, chữ sau). Chỉ RATE_LIMIT / SERVER được thử lại;
 * 429 `insufficient_quota` là QUOTA (KHÔNG thử lại — trước H3.1 ta thử lại và giữ chỗ ngân sách thêm một lần).
 */
export function phanLoaiHttp(status: number, json: unknown): PhanLoaiLoiNgoai {
  const { thongDiep, ma } = dauHieu(json);
  const chu = `${ma} ${thongDiep}`;
  // MÃ trước: hết hạn mức tường minh ⇒ QUOTA; giới hạn tốc độ tường minh ⇒ RATE_LIMIT (dù thông điệp nhắc billing / quota)
  if (ma.includes("insufficient_quota")) return "QUOTA";
  if (ma.includes("rate_limit")) return status >= 500 ? "SERVER" : "RATE_LIMIT";
  if (ma.includes("resource_exhausted")) return RE_GEMINI_NGAY.test(thongDiep) ? "QUOTA" : "RATE_LIMIT";
  if (RE_QUOTA.test(chu)) return "QUOTA";
  if ((status === 400 || status === 413 || status === 422) && RE_TRAN_NGU_CANH.test(chu)) return "CONTEXT_WINDOW_EXCEEDED";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408) return "TIMEOUT";
  if (status >= 500) return "SERVER";
  return "CLIENT";
}

export function loiHttp(status: number, json: unknown, choMs?: number, requestId?: string): LoiNgoai {
  const { thongDiep } = dauHieu(json);
  const phanLoai = phanLoaiHttp(status, json);
  const thuLai = phanLoai === "RATE_LIMIT" || phanLoai === "SERVER" || phanLoai === "TIMEOUT";
  return new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `${status} ${thongDiep}`.slice(0, 800), {
    thuLai,
    phanLoai,
    ...(choMs !== undefined ? { choMs } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  });
}

/** (H3.3a) tiêu đề id yêu cầu của ba họ API, theo thứ tự: Anthropic `request-id`, OpenAI / tương thích `x-request-id`, Gemini `x-goog-request-id`. */
export const TIEU_DE_REQUEST_ID = ["request-id", "x-request-id", "x-goog-request-id"] as const;

/** (H3.3a) id yêu cầu từ tiêu đề phản hồi: tiêu đề CÓ MẶT đầu tiên quyết định; giá trị sai bộ ký tự ⇒ `undefined` (không lấy tiêu đề sau). */
export function docRequestId(lay: (ten: string) => string | null | undefined): string | undefined {
  for (const t of TIEU_DE_REQUEST_ID) {
    const v = lay(t);
    if (typeof v === "string" && v !== "") return requestIdHopLe(v);
  }
  return undefined;
}

/** `Retry-After` (giây hoặc ngày HTTP) ⇒ ms; rác / âm / quá khứ ⇒ `undefined`. `bayGio` để lưới cố định đồng hồ. */
export function docRetryAfter(giaTri: string | null | undefined, bayGio: number = Date.now()): number | undefined {
  if (typeof giaTri !== "string" || giaTri.trim() === "") return undefined;
  const s = giaTri.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  const ms = t - bayGio;
  return ms > 0 ? ms : undefined;
}

export const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** (H3.3b) lời gọi tool gốc ⇒ dòng chữ — CÙNG khuôn `tinGoiTool` của bộ chuyển agent khi cờ tắt (đường chữ của Gemini khi cờ bật). */
export function chuGoiTool(g: GoiToolNgoai): string {
  return `[gọi công cụ ${g.ten} ${JSON.stringify(g.thamSo ?? {}).slice(0, 400)}]`;
}

/** (H3.3b) yêu cầu có khối tool GỐC (chỉ khi cờ `AI_NGOAI_TOOL_GOC` bật ở bộ chuyển) ⇒ bản cài dùng định dạng gốc của họ API. */
export function coToolGoc(tinNhan: readonly TinNhanNgoai[]): boolean {
  return tinNhan.some((m) => (m.goiTool?.length ?? 0) > 0 || m.idGoiTool !== undefined);
}

/**
 * System gộp; còn lại user / assistant xen kẽ (tin `tool` thành user "Kết quả công cụ …"); hai tin cùng vai liền nhau thì nối.
 * (H3.3b) `goiTool` (nếu có) thành dòng chữ `chuGoiTool` sau nội dung — đường chữ không mất lời gọi.
 */
export function lichSuXenKe(tinNhan: readonly TinNhanNgoai[]): { system: string; ds: Array<{ vai: "user" | "assistant"; chu: string }> } {
  const system = tinNhan.filter((m) => m.vaiTro === "system").map((m) => m.noiDung).join("\n\n");
  const ds: Array<{ vai: "user" | "assistant"; chu: string }> = [];
  for (const m of tinNhan) {
    if (m.vaiTro === "system") continue;
    const vai = m.vaiTro === "assistant" ? "assistant" : "user";
    const chu =
      m.vaiTro === "tool"
        ? `Kết quả công cụ ${m.tenTool ?? ""}:\n${m.noiDung}`
        : m.goiTool?.length
          ? [m.noiDung, ...m.goiTool.map(chuGoiTool)].filter(Boolean).join("\n")
          : m.noiDung;
    const cuoi = ds[ds.length - 1];
    if (cuoi && cuoi.vai === vai) cuoi.chu += `\n\n${chu}`;
    else ds.push({ vai, chu });
  }
  if (!ds.length || ds[0]!.vai !== "user") ds.unshift({ vai: "user", chu: "(bắt đầu)" });
  return { system, ds };
}
