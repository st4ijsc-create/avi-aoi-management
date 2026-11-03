/**
 * ★ Đợt 10.3 — hợp đồng giữa CỔNG (`congNgoai.ts`) và từng NHÀ CUNG CẤP (Anthropic / OpenAI / Gemini / tương thích OpenAI; nhà cung cấp
 * GIẢ cho lưới). Nhà cung cấp chỉ nhận yêu cầu ĐÃ CHE; khoá chỉ qua THUNK `layKhoa()` gọi ngay trước khi gửi; mạng chỉ qua `MangNgoai`
 * (chính sách URL / ghim IP / trần — Task 9). Không SDK.
 */
import type { NhaCungCapNgoai } from "../../chonModel/kieu";

/** (H3.3b) một lời gọi tool của model ở lượt trước — `id` do CHÍNH bộ chuyển phát (`ID_GOI_TOOL_NGOAI`), `ten` thuộc tập đã cấp. */
export interface GoiToolNgoai {
  id: string;
  ten: string;
  thamSo: unknown;
}

/** (H3.3b) id lời gọi tool do bộ chuyển agent ngoài phát: `ngoai-<8 ký tự đầu runId>-<số>` — cũng là khuôn id Anthropic chấp nhận. */
export const ID_GOI_TOOL_NGOAI = /^ngoai-[0-9A-Za-z_-]{1,8}-\d{1,4}$/;

export interface TinNhanNgoai {
  vaiTro: "system" | "user" | "assistant" | "tool";
  noiDung: string;
  tenTool?: string;
  /**
   * (H3.3b, chỉ khi cờ `AI_NGOAI_TOOL_GOC` BẬT) — `assistant`: lời gọi tool dạng KHỐI GỐC; `tool`: id lời gọi mà kết quả này trả lời.
   * Vắng cả hai ⇒ nhà cung cấp dùng đường chữ cũ (`lichSuXenKe`) — byte gửi đi như trước H3.3b.
   */
  goiTool?: readonly GoiToolNgoai[];
  idGoiTool?: string;
}

export interface CongCuNgoai {
  ten: string;
  moTa: string;
  schema: unknown;
}

export interface YeuCauNhaCungCap {
  model: string;
  tinNhan: readonly TinNhanNgoai[];
  congCu?: CongCuNgoai[];
  maxTokens: number;
  nhietDo: number;
}

export interface KetQuaNhaCungCap {
  noiDung: string;
  toolCalls: Array<{ ten: string; thamSo: unknown }>;
  /** `null` = nhà cung cấp không trả usage (không hoàn chỗ). */
  tokenVao: number | null;
  tokenRa: number | null;
  /** (H3.3a) id yêu cầu của nhà cung cấp (tiêu đề phản hồi, đã kiểm bộ ký tự) — chỉ sổ / log máy chủ. */
  requestId?: string;
}

/** Mạng ra ngoài DUY NHẤT của nhà cung cấp (bản thật ở `mangNgoai.ts`, Task 9). */
export interface MangNgoai {
  /** `retryAfterMs` (H3.1): tiêu đề `Retry-After` đã đổi ra ms khi nhà cung cấp gửi. `requestId` (H3.3a): `docRequestId` của tiêu đề. */
  goiJson(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<{ status: number; json: unknown; retryAfterMs?: number; requestId?: string }>;
}

export interface NhaCungCapAi {
  ma: NhaCungCapNgoai;
  goi(yc: YeuCauNhaCungCap, layKhoa: () => Promise<string>, mang: MangNgoai, ngu: { endpoint: string | null }): Promise<KetQuaNhaCungCap>;
}
