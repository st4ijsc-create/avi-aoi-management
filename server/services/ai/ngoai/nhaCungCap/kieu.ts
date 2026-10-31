/**
 * ★ Đợt 10.3 — hợp đồng giữa CỔNG (`congNgoai.ts`) và từng NHÀ CUNG CẤP (Anthropic / OpenAI / Gemini / tương thích OpenAI; nhà cung cấp
 * GIẢ cho lưới). Nhà cung cấp chỉ nhận yêu cầu ĐÃ CHE; khoá chỉ qua THUNK `layKhoa()` gọi ngay trước khi gửi; mạng chỉ qua `MangNgoai`
 * (chính sách URL / ghim IP / trần — Task 9). Không SDK.
 */
import type { NhaCungCapNgoai } from "../../chonModel/kieu";

export interface TinNhanNgoai {
  vaiTro: "system" | "user" | "assistant" | "tool";
  noiDung: string;
  tenTool?: string;
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
}

/** Mạng ra ngoài DUY NHẤT của nhà cung cấp (bản thật ở `mangNgoai.ts`, Task 9). */
export interface MangNgoai {
  /** `retryAfterMs` (H3.1): tiêu đề `Retry-After` đã đổi ra ms khi nhà cung cấp gửi. */
  goiJson(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<{ status: number; json: unknown; retryAfterMs?: number }>;
}

export interface NhaCungCapAi {
  ma: NhaCungCapNgoai;
  goi(yc: YeuCauNhaCungCap, layKhoa: () => Promise<string>, mang: MangNgoai, ngu: { endpoint: string | null }): Promise<KetQuaNhaCungCap>;
}
