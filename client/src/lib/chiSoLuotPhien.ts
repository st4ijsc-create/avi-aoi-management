/**
 * Đợt 10.4 (T4b) — chỉ số của một lượt TRỢ LÝ trong phiên đã LƯU (`ai_coding_sessions.turns`) cho nút kiểm định: phiên lưu = `locLuot(transcript)` (chiếu
 * dùng chung với máy chủ; cắt PHẦN ĐẦU khi vượt trần số lượt/byte) ⇒ chỉ số lưu = chỉ số trong transcript trừ phần bị cắt. Không phải lượt trợ lý /
 * đã bị cắt khỏi bản lưu ⇒ `null` (nút vô hiệu — không bao giờ đoán chỉ số).
 */
import { locLuot } from "@shared/aiCodingSession";

export function chiSoLuotPhien(transcript: ReadonlyArray<{ role: string; content: string }>, i: number): number | null {
  const sach = locLuot(transcript);
  const cat = transcript.length - sach.length;
  const idx = i - cat;
  if (idx < 0 || idx >= sach.length) return null;
  return sach[idx]!.role === "assistant" ? idx : null;
}
