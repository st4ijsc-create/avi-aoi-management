/**
 * ★ PDCA trợ lý vận hành vòng 9 (2026-09-24) — DỊCH CÂU HỎI VIỆT SANG ANH ĐỂ TRUY HỒI.
 *
 * Tài liệu miền viết nửa Anh nửa Việt ("Refresh: 1 phút", "E031 | Clamp error | … air pressure", "Scrap Rate"). Câu hỏi
 * tiếng Việt thuần ("tự làm mới", "cơ cấu kẹp", "phế phẩm") không có từ nào trùng ⇒ điểm từ khoá 0, cosine trung bình ⇒ đoạn
 * đáp án rơi khỏi top‑20 (đo: 6/12 câu giữ lại, TQ02, T17, T79), và cổng lạc đề (độ phủ từ) chặn nhầm câu có tài liệu (T58).
 * Bảng thuật ngữ ĐÀO từ tài liệu đo được là vô dụng (417 cặp nhiễu, 0/19 thuật ngữ cần có) ⇒ dùng model dịch cả câu.
 *
 * Người gọi chấm điểm bằng MAX(câu gốc, bản dịch) cho cả cosine lẫn từ khoá ⇒ bản dịch chỉ NÂNG được đoạn khớp tiếng Anh,
 * không kéo điểm câu gốc xuống. Module này là phần THUẦN (khi nào dịch, lệnh, đọc kết quả); lời gọi model ở service.
 */

const CO_DAU_VIET = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const TRAN_DAI = 300;

/** Chỉ dịch câu tiếng Việt CÓ DẤU, không rỗng, không quá dài. */
export function canDich(question: string, language: string): boolean {
  const q = String(question ?? "").trim();
  return language === "vi" && q.length > 0 && q.length <= TRAN_DAI && CO_DAU_VIET.test(q);
}

export function lenhDich(question: string): { he: string; nd: string } {
  return {
    he: "You translate Vietnamese questions about factory inspection (AOI) software into concise English. Output ONLY the English question, one line.",
    nd: `Translate to English. Keep codes, identifiers and English words unchanged.\n\n${question}`,
  };
}

/** Bản dịch dùng được, hoặc `null` (rỗng, còn dấu tiếng Việt, quá dài) — `null` ⇒ người gọi truy hồi như cũ. */
export function docBanDich(text: string | null | undefined): string | null {
  const dong = String(text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!dong) return null;
  const t = dong.replace(/^(?:english|translation)\s*:\s*/i, "").replace(/^["'“]|["'”]$/g, "").trim();
  if (!t || t.length > TRAN_DAI || CO_DAU_VIET.test(t)) return null;
  return t;
}

export const dichTruyVanBat = (): boolean => process.env.AI_KB_DICH_TRUY_VAN !== "0";
