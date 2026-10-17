/**
 * shared/agentCore — KIỂU dùng chung của lõi agent (thiết kế: docs/superpowers/specs/2026-10-14-ai-local-dot1-loi-agent-design.md §3).
 *
 * THUẦN: tệp này (và cả thư mục, trừ *.test.ts) không import `server/`, `client/`, `vscode`, `node:*`, không đọc env/đĩa/mạng.
 * Lưới `thuan.test.ts` canh bất biến đó.
 */

// ─── Khuôn dây OpenAI (tool-calling gốc) ──────────────────────────────────────────────────────
//
// ⚠ PHẢI TƯƠNG THÍCH khuôn dây của `server/services/ai/nativeToolCalls.ts` (`WireToolCall`/`WireTool`).
// Định nghĩa lại ở đây vì lõi phải thuần (không import server/). Hai bên cùng hình dạng OpenAI, nên TypeScript
// gán qua lại được theo cấu trúc; nếu một bên đổi hình, lưới `congCu.test.ts` (gán chéo kiểu với WireTool của server) sẽ đỏ lúc kiểm kiểu.

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface WireTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ─── Chế độ / tin nhắn / tool ───────────────────────────────────────────────────────────────────

/**
 * hoi     : chỉ tool đọc + todo_write; tool ghi/lệnh bị từ chối (model được báo).
 * sua     : ghi + lệnh đều chờ người duyệt (HITL từng lượt).
 * tu-dong : ghi/lệnh trong danh sách trắng tự chạy SAU checkpoint; chỉ cho dự án được phép tự ghi (Q1).
 */
export type CheDoAgent = "hoi" | "sua" | "tu-dong";

export type NgonNgu = "vi" | "en" | "zh";

export interface TinNhan {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LoiGoiTool {
  id: string;
  ten: string;
  thamSo: Record<string, unknown>;
}

export interface ThayDoiTep {
  duong: string;
  loai: "tao" | "sua" | "xoa" | "doi-ten";
  tuDuong?: string;
  bamSau?: string | null;
}

export interface KetQuaTool {
  /** Văn bản đưa lại model (đã cắt + che), LUÔN có. Lõi cắt thêm đầu+đuôi theo `kyTuQuanSatToiDa`. */
  choModel: string;
  ok: boolean;
  /** Mã lỗi/từ chối máy đọc được (BASE_MISMATCH, BI_BAC, …). `MENH_LENH_TRONG_DU_LIEU` ⇒ vòng dừng. */
  ma?: string;
  /** Dữ liệu cho UI (diff, đầu ra lệnh) — không vào model. */
  hienThi?: unknown;
  /** Tệp đã đổi (cho checkpoint/hoàn tác/UI). */
  thayDoi?: ThayDoiTep[];
}

/** Mã kết quả tool khiến vòng dừng với lý do `menh-lenh-trong-du-lieu` (bộ thực thi quét `scanUntrustedContent` mức high). */
export const MA_MENH_LENH_TRONG_DU_LIEU = "MENH_LENH_TRONG_DU_LIEU";

/** Đề xuất chờ người duyệt (bộ thực thi điền; lõi chỉ chuyển tiếp qua sự kiện `can-duyet`). */
export interface DeXuatDuyet {
  ten: string;
  thamSo: Record<string, unknown>;
  moTa?: string;
  pendingActionId?: string | number;
  xemTruoc?: unknown;
}

export interface ViecKeHoach {
  noiDung: string;
  trangThai: "cho" | "dang-lam" | "xong";
}

export type LyDoDung =
  | "hoan-thanh"
  | "het-luot"
  | "het-gio"
  | "het-token"
  | "huy"
  | "lap-lai"
  | "menh-lenh-trong-du-lieu"
  | "loi-model";

/** Phạm vi một ghi chú trí nhớ (tool `remember`, Đợt 2). Bảng `ai_coding_lessons` khoá (người × dự án) — xem README. */
export type PhamViNho = "project" | "user";

export type SuKienAgent =
  | { loai: "bat-dau"; runId: string; cheDo: CheDoAgent }
  | { loai: "chu"; noiDung: string }
  | { loai: "nghi"; noiDung: string }
  | { loai: "goi-tool"; goi: LoiGoiTool; luot: number }
  | { loai: "ket-qua-tool"; id: string; ten: string; ok: boolean; tomTat: string; ma?: string; hienThi?: unknown }
  | { loai: "can-duyet"; id: string; deXuat: DeXuatDuyet }
  | { loai: "da-duyet" | "bi-bac"; id: string; lyDo?: string }
  | { loai: "ke-hoach"; viec: ViecKeHoach[] }
  /**
   * (Đợt 2) model gọi `remember` ⇒ bộ thực thi phát ĐỀ XUẤT; KHÔNG GHI gì. Chỉ người bấm "Nhớ" (tRPC
   * `aiAgent.nhoDeXuat`) mới ghi — ở MỌI chế độ, kể cả `tu-dong`. `note` đã làm sạch (một dòng, che bí mật).
   */
  | { loai: "de-xuat-nho"; id: string; note: string; scope: PhamViNho }
  | { loai: "checkpoint"; checkpointId: string; tep: string[] }
  | { loai: "usage"; vao: number; ra: number; nghi?: number; ctxPhanTram?: number }
  | { loai: "dang-cho-model"; phiaTruoc: number }
  | { loai: "xong"; lyDo: LyDoDung; tomTat?: string }
  | { loai: "loi"; ma: string; thongDiep: string };

// ─── Hợp đồng với model và bộ thực thi ─────────────────────────────────────────────────────────

export type ManhModel =
  | { loai: "chu" | "nghi"; noiDung: string }
  /** (mở rộng so với spec) model đang xếp hàng — lõi phát lại thành `dang-cho-model`. */
  | { loai: "cho"; phiaTruoc: number }
  | { loai: "xong"; toolCalls: WireToolCall[]; usage?: { vao: number; ra: number; nghi?: number } };

export interface GoiModel {
  (vao: { tinNhan: TinNhan[]; congCu: WireTool[]; signal: AbortSignal }): AsyncIterable<ManhModel>;
}

export interface NguCanhThucThi {
  cheDo: CheDoAgent;
  runId: string;
  luot: number;
  signal: AbortSignal;
  phat: (e: SuKienAgent) => void;
}

export interface BoThucThi {
  /** Bộ tool phơi cho model theo chế độ (lõi tự thêm `todo_write` nếu thiếu — nó xử lý trong vòng). */
  congCu(cheDo: CheDoAgent): WireTool[];
  chay(goi: LoiGoiTool, ctx: NguCanhThucThi): Promise<KetQuaTool>;
}

export interface GioiHanVong {
  soLuotToiDa: number;
  msToiDa: number;
  tokenRaToiDa: number;
  kyTuQuanSatToiDa: number;
  /** (mở rộng so với spec) ngân sách ngữ cảnh tính bằng token — nén khi > 70 %. Mặc định 65 536 (Q5: 1 × 64k). */
  nganSachNguCanhToken: number;
}

export const GIOI_HAN_MAC_DINH: GioiHanVong = {
  soLuotToiDa: 30,
  msToiDa: 20 * 60 * 1000,
  tokenRaToiDa: 120_000,
  kyTuQuanSatToiDa: 12_000,
  nganSachNguCanhToken: 65_536,
};

/**
 * Lỗi model có đánh dấu `tamThoi` (mạng chập chờn, 503 đang nạp, …) ⇒ vòng thử lại TỐI ĐA 1 lần cho lượt đó.
 * Bộ gọi model có thể ném lớp này hoặc bất kỳ lỗi nào có thuộc tính `tamThoi === true`.
 */
export class LoiModel extends Error {
  readonly tamThoi: boolean;
  readonly ma: string;
  constructor(thongDiep: string, opts: { tamThoi?: boolean; ma?: string } = {}) {
    super(thongDiep);
    this.name = "LoiModel";
    this.tamThoi = opts.tamThoi === true;
    this.ma = opts.ma ?? (this.tamThoi ? "MODEL_TAM_THOI" : "MODEL_LOI");
  }
}

export function laLoiTamThoi(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { tamThoi?: unknown }).tamThoi === true;
}
