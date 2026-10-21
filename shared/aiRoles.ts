/**
 * ★★ Đợt 7.0 (2026-10-20) — TỪ VỰNG VAI TRÒ model. Spec: docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md §3.1.
 *
 * Bề mặt (Copilot, agent, Luồng AI, /v1) gọi model theo VAI TRÒ (`code.plc`, `extract`…), không theo tên tệp GGUF.
 * Tên tệp chỉ nằm trong sổ (`ai_model_*`, mig 0400). Module THUẦN — không I/O, dùng được ở client lẫn server.
 *
 * Mỗi vai trò gốc mang `envKey`: khoá `.env` mà gán seed "theo-env" đi theo ⇒ ngày đầu hành vi y nguyên `.env`
 * (tương đương bằng cấu trúc, không bằng bản chép giá trị — đổi model qua `doiModelLlamaServer` vẫn được theo kịp).
 */

export type EnvKeyModel =
  | "GGUF_DEFAULT_MODEL"
  | "GGUF_CODE_MODEL"
  | "GGUF_FAST_MODEL"
  | "GGUF_FIM_MODEL"
  | "GGUF_EMBED_MODEL"
  | "GGUF_VISION_MODEL"
  | "GGUF_RERANKER_MODEL";

/** Tầng của `modelResolver.resolveTaskModel` / `aiModelRouter` mà vai trò rơi về khi khoá env trống. */
export type TaskKindVaiTro = "chat" | "code" | "fast" | "fim" | "embed" | "vision";

export interface VaiTroGoc {
  id: string;
  moTa: string;
  envKey: EnvKeyModel;
  taskKind: TaskKindVaiTro;
}

export const VAI_TRO_GOC: readonly VaiTroGoc[] = [
  { id: "chat", moTa: "Hỏi đáp chung", envKey: "GGUF_DEFAULT_MODEL", taskKind: "chat" },
  { id: "chat.ops", moTa: "Câu vận hành ngắn (trợ lý nhà máy)", envKey: "GGUF_FAST_MODEL", taskKind: "fast" },
  { id: "code.software", moTa: "Lập trình phần mềm (TS/JS, C#, Python…)", envKey: "GGUF_CODE_MODEL", taskKind: "code" },
  { id: "code.plc", moTa: "Lập trình tự động hoá (IEC 61131-3 ST/SCL/IL)", envKey: "GGUF_CODE_MODEL", taskKind: "code" },
  { id: "extract", moTa: "Trích xuất có cấu trúc (JSON schema)", envKey: "GGUF_FAST_MODEL", taskKind: "fast" },
  { id: "classify", moTa: "Phân loại / gắn nhãn", envKey: "GGUF_FAST_MODEL", taskKind: "fast" },
  { id: "summarize", moTa: "Tóm tắt, viết báo cáo", envKey: "GGUF_DEFAULT_MODEL", taskKind: "chat" },
  { id: "vision", moTa: "Thị giác (ảnh lỗi, tài liệu)", envKey: "GGUF_VISION_MODEL", taskKind: "vision" },
  { id: "embed", moTa: "Nhúng văn bản", envKey: "GGUF_EMBED_MODEL", taskKind: "embed" },
  { id: "rerank", moTa: "Xếp hạng lại kết quả tra cứu", envKey: "GGUF_RERANKER_MODEL", taskKind: "embed" },
  { id: "fim", moTa: "Gợi ý mã tại chỗ (fill-in-the-middle)", envKey: "GGUF_FIM_MODEL", taskKind: "fim" },
];

const RE_VAI_TRO = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)?$/;

/** Hình dạng tên vai trò: `chu` hoặc `chu.phu` — chữ thường, không đường dẫn, không tên tệp. */
export function laTenVaiTro(s: unknown): s is string {
  return typeof s === "string" && s.length <= 48 && RE_VAI_TRO.test(s);
}

const TEN_LOGIC_CU: ReadonlySet<string> = new Set([
  "chat", "code", "coder", "fast", "fim", "infill", "embed", "embedding", "embeddings",
]);

/** Tên logic lịch sử của `/v1` — giữ NGUYÊN đường phân giải cũ trong `modelResolver`. */
export function laTenLogicCu(s: string): boolean {
  return TEN_LOGIC_CU.has(s);
}

const DUOI_PLC: ReadonlySet<string> = new Set([".st", ".scl", ".awl", ".il", ".iecst", ".pou"]);
const NGON_NGU_PLC: ReadonlySet<string> = new Set(["st", "iec-st", "structured-text", "scl", "il"]);
const DU_AN_PHAN_MEM: ReadonlySet<string> = new Set(["web", "dotnet", "python", "node"]);

export interface TinHieuVaiTro {
  loaiDuAn?: string;
  duoiTep?: string;
  ngonNgu?: string;
  /** Đợt 7.3 — chữ câu hỏi: ý định viết mã + từ khoá miền (`vaiTroTuCauHoi`), xét SAU ba tín hiệu trên. */
  cauHoi?: string;
}

/** Tầng 3 của bộ định tuyến: tín hiệu rẻ, giải thích được. Không khớp ⇒ `null` (KHÔNG đoán). */
export function vaiTroTuTinHieu(t: TinHieuVaiTro): { vaiTro: string; bangChung: string } | null {
  const loai = (t.loaiDuAn ?? "").trim().toLowerCase();
  if (loai === "plc") return { vaiTro: "code.plc", bangChung: "loại dự án plc" };
  const duoiTho = (t.duoiTep ?? "").trim().toLowerCase();
  if (duoiTho) {
    const duoi = duoiTho.startsWith(".") ? duoiTho : `.${duoiTho}`;
    if (DUOI_PLC.has(duoi)) return { vaiTro: "code.plc", bangChung: `đuôi tệp ${duoi}` };
  }
  const nn = (t.ngonNgu ?? "").trim().toLowerCase();
  if (NGON_NGU_PLC.has(nn)) return { vaiTro: "code.plc", bangChung: `ngôn ngữ ${nn}` };
  if (DU_AN_PHAN_MEM.has(loai)) return { vaiTro: "code.software", bangChung: `loại dự án ${loai}` };
  return t.cauHoi ? vaiTroTuCauHoi(t.cauHoi) : null;
}

// ── ★★ Đợt 7.3 — TÍN HIỆU CHỮ (tầng 3, tất định): ý định VIẾT/SỬA MÃ + từ khoá miền ─────────────────────────
// Chỉ kết luận khi có CẢ ý định mã lẫn từ khoá của ĐÚNG MỘT miền (PLC xor phần mềm) — câu hỏi khái niệm
// ("IEC 61131-3 gồm ngôn ngữ nào?") không có ý định mã ⇒ không kết luận, để tầng 4/5 lo.
const RE_Y_DINH_MA =
  /(^|[\s,.:;(])(viết|code|lập trình|sửa|chuyển|tạo|thêm|tối ưu|refactor|write|fix|implement|convert|debug)(?=$|[\s,.:;)])|lỗi biên dịch|báo lỗi E\d+|compile error/i;
// Viết tắt PHÂN BIỆT hoa thường ("ST", "TON" — không bắt "st"/"ton" trong chữ thường); cụm từ không phân biệt.
const RE_PLC_VIET_TAT = /\b(ST|SCL|PLC|FB|TON|TOF|CTU|CTD|R_TRIG|F_TRIG)\b/;
const RE_PLC_CUM = /\b(plc|codesys|twincat|tia portal|iec\s*61131(-3)?|structured text|function block|ladder)\b|khối chức năng/i;
const RE_PHAN_MEM =
  /\b(python|c#|java|javascript|typescript|react|vue|angular|sql|postgres|mysql|sqlite|rust|node(\.js)?|express|docker(file)?|powershell|bash|regex|api|wpf|fastapi|django|jest|vitest|pytest|html|css|\.net|kotlin|swift)\b|(^|\s)(C#|Go)(?=\s|$)/i;

/** "ngôn ngữ lập trình" là DANH TỪ, không phải ý định viết mã ("IEC 61131-3 gồm những ngôn ngữ lập trình nào?"). */
const boDanhTuMa = (cauHoi: string) => (cauHoi ?? "").replace(/ngôn ngữ lập trình/gi, "ngôn ngữ");

/** Tầng 3 — từ CHỮ của câu hỏi. Không chắc ⇒ `null`. */
export function vaiTroTuCauHoi(cauHoi: string): { vaiTro: string; bangChung: string } | null {
  const s = boDanhTuMa(cauHoi);
  if (!RE_Y_DINH_MA.test(s)) return null;
  const plc = RE_PLC_VIET_TAT.exec(s) ?? RE_PLC_CUM.exec(s);
  const pm = RE_PHAN_MEM.exec(s);
  if (plc && !pm) return { vaiTro: "code.plc", bangChung: `câu hỏi viết mã + "${plc[0].trim()}"` };
  if (pm && !plc) return { vaiTro: "code.software", bangChung: `câu hỏi viết mã + "${pm[0].trim()}"` };
  return null;
}

// ── ★★ Đợt 9 (2026-10-21) — TÍN HIỆU CHỮ THEO TÁC VỤ (tầng 3, tất định) cho bề mặt chọn TỰ ĐỘNG (`model: "auto"`) ──
// Đo mù 2026-10-21: `chat` 11/20 — câu KIẾN THỨC ngành bị tâm cụm code.plc/chat.ops hút (nhúng bắt CHỦ ĐỀ, không
// bắt Ý ĐỊNH). Ý định "tóm tắt / trích / hỏi khái niệm" lộ ra bằng chữ ⇒ xét bằng luật, rồi mới tới tầng 4.
// TÁCH khỏi `vaiTroTuCauHoi` có chủ ý: `vaiTroTuTinHieu` (bề mặt lập trình) chỉ được trả vai trò MÃ.
// Ranh giới chữ theo Unicode (`\b` của JS là ASCII — gãy giữa chữ có dấu).
const T = (s: string) => new RegExp(`(?<![\p{L}\p{N}])(?:${s})(?![\p{L}\p{N}])`, "iu");
const RE_TOM_TAT = T("tóm tắt|tom tat|tóm lại|tom lai|tổng kết|tong ket|rút gọn|rut gon|ý chính|y chinh|summari[sz]e|summary|tl;?dr|condense|key (?:points|findings)");
const RE_TONG_HOP = T("tổng hợp|tong hop");
const RE_TRICH = T("trích|trich|trích xuất|extract|parse");
const RE_LAY = T("lấy|lay|lọc|loc|tách|tach|rút|rut|điền|dien|pull|get");
const RE_TAI_LIEU_KEM = T("này|nay|sau|sau đây|dưới|duoi|dưới đây|đoạn văn|văn bản|this|following|below|attached");
const RE_DANG_CAU_TRUC = T("json|bảng|bang|danh sách|danh sach|các trường|cac truong|table|list|csv|fields?");
const RE_HOI_KHAI_NIEM = T(
  "là gì|la gi|là sao|khác nhau|khac nhau|khác gì|khác .{1,40} (?:thế nào|ra sao)|so sánh|so sanh|tại sao|tai sao|vì sao|vi sao|giải thích|giai thich|nguyên lý|nguyen ly|nguyên nhân|ưu điểm|nhược điểm|ý nghĩa|ảnh hưởng(?: \S+){0,6} (?:thế nào|ra sao)|gồm những|gồm gì|hoạt động (?:thế nào|ra sao)|khi nào nên|nên dùng|nên chọn|có nên|what is|what are|what's|why|explain|difference|how does|how do|should i|when to use",
);
// Câu hỏi SỐ LIỆU HIỆN TẠI của nhà máy (chat.ops) — có các dấu này thì KHÔNG kết luận "chat".
const RE_DAU_VAN_HANH = T(
  "hôm nay|hom nay|hôm qua|hom qua|hiện tại|hien tai|hiện (?:đang|nay|giờ|có)|đang|dang|ca này|ca nay|ca sáng|ca chiều|ca đêm|tuần này|tuan nay|tháng này|thang nay|line ?\d+|máy số ?\d+|today|yesterday|currently|right now|this (?:shift|week|month)",
);
// Câu đính kèm mã/tài liệu ("đoạn này", "code sau") — câu "tại sao…" về MÃ người dùng dán vào không phải hỏi khái niệm.
const RE_KEM_MA = T("đoạn (?:mã|code|st|này|sau|dưới)|code (?:này|sau|dưới)|chương trình này|this (?:code|snippet|function|rung)");

// Câu MỆNH LỆNH thao tác trên tài liệu ("Lấy danh sách… nêu trong thông báo") — không phải hỏi khái niệm.
const RE_MO_LENH = /^\s*(?:lấy|lay|liệt kê|liet ke|lọc|loc|tách|tach|điền|dien|chuyển|chuyen|list|pull|get)(?![\p{L}\p{N}])/iu;

/** Tầng 3 theo TÁC VỤ — `summarize` / `extract` / `chat` (khái niệm). Xét SAU `vaiTroTuCauHoi`. Không chắc ⇒ `null`. */
export function vaiTroTuTacVu(cauHoi: string): { vaiTro: string; bangChung: string } | null {
  const s = boDanhTuMa(cauHoi);
  const m = (re: RegExp) => re.exec(s)?.[0];
  const tomTat = m(RE_TOM_TAT) ?? (!RE_DAU_VAN_HANH.test(s) || RE_TAI_LIEU_KEM.test(s) ? m(RE_TONG_HOP) : undefined);
  const trich = m(RE_TRICH) ?? (RE_LAY.test(s) && RE_TAI_LIEU_KEM.test(s) && RE_DANG_CAU_TRUC.test(s) ? m(RE_LAY) : undefined);
  if (tomTat && !trich) return { vaiTro: "summarize", bangChung: `từ tác vụ "${tomTat}"` };
  if (trich && !tomTat) return { vaiTro: "extract", bangChung: `từ tác vụ "${trich}"` };
  if (tomTat || trich) return null;
  const hoi = m(RE_HOI_KHAI_NIEM);
  if (hoi && !RE_MO_LENH.test(s) && !RE_Y_DINH_MA.test(s) && !RE_DAU_VAN_HANH.test(s) && !RE_KEM_MA.test(s)) {
    return { vaiTro: "chat", bangChung: `hỏi khái niệm "${hoi}"` };
  }
  return null;
}

/** Tầng 3 đầy đủ cho chọn TỰ ĐỘNG: ý định mã (miền) trước, rồi tác vụ. */
export function vaiTroTuCauHoiTuDong(cauHoi: string): { vaiTro: string; bangChung: string } | null {
  return vaiTroTuCauHoi(cauHoi) ?? vaiTroTuTacVu(cauHoi);
}
