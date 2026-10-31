/**
 * ★ Đợt 12 H3.2 (thiết kế `docs/superpowers/specs/2026-10-31-h3-2-mo-ta-khai-bao-model.md`, dieu-phoi duyệt 2026-10-31) — MÔ TẢ KHAI BÁO
 * mỗi model: "model này nói thế nào" (kênh nghĩ, tên trường ngân sách, ngữ cảnh, trần trả lời, kiểu gọi tool). DỮ LIỆU THUẦN — không import
 * máy chủ, không đọc env, không đường dẫn máy (điều kiện duyệt). Khớp basename từ dòng lệnh / env + đọc env nằm ở máy chủ.
 *
 * Bất biến: với Qwen3.6-35B-A3B (và mọi model KHÔNG khớp mô tả nào ⇒ `MO_TA_MAC_DINH`) byte gửi llama-server Y HỆT trước H3.2 — ảnh chụp
 * `server/services/aiLlamaServerClient.thanYeuCau.test.ts`. Đổi một giá trị ở đây = đổi byte gửi model ⇒ A/B ở cửa sổ GPU.
 * Census: các khoá `enable_thinking` / `preserve_thinking` / `thinking_budget_tokens` chỉ được viết ở tệp này (máy chủ dựng thân từ mô tả).
 */

export type KenhNghi =
  /** Model không có kênh nghĩ: KHÔNG gửi `chat_template_kwargs` / trường ngân sách nào. */
  | { kieu: "khong" }
  /** Template đọc `chat_template_kwargs` (họ Qwen3.x): `tat` khi tắt nghĩ, `giu` khi giữ suy luận trong lịch sử; `truongNganSach` = tên trường llama.cpp đọc. */
  | { kieu: "kwargs"; tat: Readonly<Record<string, unknown>>; giu?: Readonly<Record<string, unknown>>; truongNganSach?: "thinking_budget_tokens" };

export interface MoTaModel {
  id: string;
  /** Khớp basename GGUF (không đuôi `.gguf`, không thư mục). */
  khop: RegExp;
  nguCanh: { macDinh: number; toiDa: number };
  nghi: KenhNghi;
  /** Trần token sinh MỘT lượt của tác nhân (gồm nghĩ). */
  traLoiToiDa: number;
  goiTool: "native" | "native+vot-van-ban";
}

/**
 * Kênh nghĩ họ Qwen3.x trên llama.cpp b9814: `enable_thinking` + `preserve_thinking` qua `chat_template_kwargs`; ngân sách theo yêu cầu đọc ở
 * `thinking_budget_tokens` (`reasoning_budget_tokens` bị b9814 bỏ qua IM LẶNG — đo sống 2026-09-23, xem `aiLlamaServerClient.lapNganSachNghi`).
 */
export const TRUONG_NGAN_SACH_NGHI_B9814 = "thinking_budget_tokens" as const;
const NGHI_QWEN3: KenhNghi = Object.freeze({
  kieu: "kwargs",
  tat: Object.freeze({ enable_thinking: false }),
  giu: Object.freeze({ preserve_thinking: true }),
  truongNganSach: TRUONG_NGAN_SACH_NGHI_B9814,
}) as KenhNghi;

/** Model không khớp mô tả nào ⇒ ĐÚNG hành vi trước H3.2 (không đổi gì cho model lạ). */
export const MO_TA_MAC_DINH: MoTaModel = Object.freeze({
  id: "mac-dinh",
  khop: /^$/,
  nguCanh: Object.freeze({ macDinh: 65_536, toiDa: 65_536 }),
  nghi: NGHI_QWEN3,
  traLoiToiDa: 16_000,
  goiTool: "native+vot-van-ban",
}) as MoTaModel;

export const MO_TA_MODEL: readonly MoTaModel[] = Object.freeze([
  Object.freeze({
    id: "qwen3.6-35b-a3b",
    khop: /^Qwen3\.6-35B-A3B/i,
    nguCanh: Object.freeze({ macDinh: 65_536, toiDa: 262_144 }),
    nghi: NGHI_QWEN3,
    traLoiToiDa: 16_000,
    goiTool: "native+vot-van-ban",
  }),
  Object.freeze({
    id: "qwen3-4b",
    // (rà kiem-dinh) khớp CHẶT: biến thể VL / bản khác có ngữ cảnh + kênh nghĩ khác ⇒ rơi về mặc định (và /props quyết số nhỏ hơn)
    khop: /^Qwen3-4B-(Instruct|Thinking)-2507/i,
    nguCanh: Object.freeze({ macDinh: 32_768, toiDa: 32_768 }),
    nghi: NGHI_QWEN3,
    traLoiToiDa: 16_000,
    goiTool: "native+vot-van-ban",
  }),
  // model nhúng — không có kênh nghĩ (không bao giờ đi đường chat; khai để thân nào lỡ dựng cho nó KHÔNG mang cờ template lạ)
  Object.freeze({
    id: "mxbai-embed",
    khop: /^mxbai-embed/i,
    nguCanh: Object.freeze({ macDinh: 512, toiDa: 512 }),
    nghi: Object.freeze({ kieu: "khong" }) as KenhNghi,
    traLoiToiDa: 0,
    goiTool: "native",
  }),
]) as readonly MoTaModel[];

/** Basename (có thể kèm thư mục / đuôi `.gguf`) ⇒ mô tả; không khớp ⇒ `MO_TA_MAC_DINH`. Thuần. */
export function moTaCho(model: string | null | undefined): MoTaModel {
  const ten = String(model ?? "").split(/[\\/]/).pop()!.replace(/\.gguf$/i, "");
  if (!ten) return MO_TA_MAC_DINH;
  return MO_TA_MODEL.find((m) => m.khop.test(ten)) ?? MO_TA_MAC_DINH;
}
