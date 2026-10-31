/**
 * ★ Đợt 10.3 — phần dùng chung của các bản cài nhà cung cấp: lỗi HTTP ⇒ `LoiNgoai` (thông điệp THÔ — cổng che bằng `cheChuoi` trước
 * khi ném / ghi), số token, lịch sử chữ (công cụ cũ đã là dòng chữ — giới hạn đã ghi: model ngoài KHÔNG thấy tool_use gốc).
 */
import { LoiNgoai, type PhanLoaiLoiNgoai } from "../loi";
import type { TinNhanNgoai } from "./kieu";

/** Trường lỗi của ba họ API (OpenAI `error.code/type`, Anthropic `error.type`, Gemini `error.status`) gộp thành chữ thường để so khớp. */
function dauHieu(json: unknown): { thongDiep: string; ma: string } {
  const j = json as { error?: { message?: unknown; type?: unknown; code?: unknown; status?: unknown } | string; message?: unknown; type?: unknown } | null;
  const e = j?.error;
  const thongDiep = typeof e === "string" ? e : String(e?.message ?? j?.message ?? "");
  const ma = typeof e === "object" && e ? [e.code, e.type, e.status].filter((x) => typeof x === "string").join(" ") : String(j?.type ?? "");
  return { thongDiep, ma: ma.toLowerCase() };
}

const RE_QUOTA = /insufficient_quota|billing|credit balance|exceeded your current quota|quota.*(exhausted|exceeded).*(plan|billing)/i;
const RE_TRAN_NGU_CANH = /context_length_exceeded|context length|context window|prompt is too long|maximum context|too many tokens|exceeds the maximum number of tokens|input is too long/i;

/**
 * ★ Đợt 12 H3.1 — phân loại lỗi HTTP của nhà cung cấp (thuần, ổn định theo MÃ trước, chữ sau). Chỉ RATE_LIMIT / SERVER được thử lại;
 * 429 `insufficient_quota` là QUOTA (KHÔNG thử lại — trước H3.1 ta thử lại và giữ chỗ ngân sách thêm một lần).
 */
export function phanLoaiHttp(status: number, json: unknown): PhanLoaiLoiNgoai {
  const { thongDiep, ma } = dauHieu(json);
  const chu = `${ma} ${thongDiep}`;
  if (RE_QUOTA.test(chu)) return "QUOTA";
  if ((status === 400 || status === 413 || status === 422) && RE_TRAN_NGU_CANH.test(chu)) return "CONTEXT_WINDOW_EXCEEDED";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408) return "TIMEOUT";
  if (status >= 500) return "SERVER";
  return "CLIENT";
}

export function loiHttp(status: number, json: unknown, choMs?: number): LoiNgoai {
  const { thongDiep } = dauHieu(json);
  const phanLoai = phanLoaiHttp(status, json);
  const thuLai = phanLoai === "RATE_LIMIT" || phanLoai === "SERVER" || phanLoai === "TIMEOUT";
  return new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `${status} ${thongDiep}`.slice(0, 800), { thuLai, phanLoai, ...(choMs !== undefined ? { choMs } : {}) });
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

/** System gộp; còn lại user / assistant xen kẽ (tin `tool` thành user "Kết quả công cụ …"); hai tin cùng vai liền nhau thì nối. */
export function lichSuXenKe(tinNhan: readonly TinNhanNgoai[]): { system: string; ds: Array<{ vai: "user" | "assistant"; chu: string }> } {
  const system = tinNhan.filter((m) => m.vaiTro === "system").map((m) => m.noiDung).join("\n\n");
  const ds: Array<{ vai: "user" | "assistant"; chu: string }> = [];
  for (const m of tinNhan) {
    if (m.vaiTro === "system") continue;
    const vai = m.vaiTro === "assistant" ? "assistant" : "user";
    const chu = m.vaiTro === "tool" ? `Kết quả công cụ ${m.tenTool ?? ""}:\n${m.noiDung}` : m.noiDung;
    const cuoi = ds[ds.length - 1];
    if (cuoi && cuoi.vai === vai) cuoi.chu += `\n\n${chu}`;
    else ds.push({ vai, chu });
  }
  if (!ds.length || ds[0]!.vai !== "user") ds.unshift({ vai: "user", chu: "(bắt đầu)" });
  return { system, ds };
}
