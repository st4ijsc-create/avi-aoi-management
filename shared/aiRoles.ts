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

/** Tầng 3 — từ CHỮ của câu hỏi. Không chắc ⇒ `null`. */
export function vaiTroTuCauHoi(cauHoi: string): { vaiTro: string; bangChung: string } | null {
  const s = cauHoi ?? "";
  if (!RE_Y_DINH_MA.test(s)) return null;
  const plc = RE_PLC_VIET_TAT.exec(s) ?? RE_PLC_CUM.exec(s);
  const pm = RE_PHAN_MEM.exec(s);
  if (plc && !pm) return { vaiTro: "code.plc", bangChung: `câu hỏi viết mã + "${plc[0].trim()}"` };
  if (pm && !plc) return { vaiTro: "code.software", bangChung: `câu hỏi viết mã + "${pm[0].trim()}"` };
  return null;
}
