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
  /** Mã lỗi/từ chối máy đọc được (BASE_MISMATCH, BI_BAC, …). (`MENH_LENH_TRONG_DU_LIEU`: xem hằng số — KHÔNG còn dừng vòng.) */
  ma?: string;
  /**
   * Kết quả mang câu DẠNG MỆNH LỆNH nhắm vào trợ lý (bộ thực thi quét, vd `scanUntrustedContent` mức high). KHÔNG dừng
   * vòng: lõi thêm một dòng cảnh báo trước `choModel`, phát `canh-bao-du-lieu`, ghi nguồn vào trạng thái lượt (thẻ duyệt
   * sau mang cờ) và — ở `tu-dong` — HẠ tự trị cho phần còn lại của lượt. `choModel` vẫn là DỮ LIỆU đã làm sạch.
   */
  dangNgo?: NoiDungDangNgo;
  /** Dữ liệu cho UI (diff, đầu ra lệnh) — không vào model. */
  hienThi?: unknown;
  /** Tệp đã đổi (cho checkpoint/hoàn tác/UI). */
  thayDoi?: ThayDoiTep[];
}

/** Nguồn + nhãn mẫu của một kết quả tool đáng ngờ. `nguon` rỗng ⇒ lõi tự đặt theo lời gọi (`nhanNguonGoi`). */
export interface NoiDungDangNgo {
  nguon?: string;
  mau: string[];
}

/**
 * Mã kết quả tool của bộ thực thi ĐỜI CŨ cho dữ liệu mang mệnh lệnh. Chính sách phân bậc (2026-10-17): lõi KHÔNG còn
 * dừng vòng vì mã này — coi như `dangNgo` (cảnh báo + cờ thẻ duyệt + hạ tự trị ở `tu-dong`). Bộ thực thi mới dùng
 * `KetQuaTool.dangNgo`; hằng số giữ làm TÍN HIỆU tương thích.
 */
export const MA_MENH_LENH_TRONG_DU_LIEU = "MENH_LENH_TRONG_DU_LIEU";

/** Đề xuất chờ người duyệt (bộ thực thi điền; lõi chỉ chuyển tiếp qua sự kiện `can-duyet`). */
export interface DeXuatDuyet {
  ten: string;
  thamSo: Record<string, unknown>;
  moTa?: string;
  pendingActionId?: string | number;
  xemTruoc?: unknown;
  /** Lượt chạy đã đọc nội dung đáng ngờ từ các nguồn này TRƯỚC thẻ duyệt — người duyệt phải thấy. */
  nguonDangNgo?: string[];
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
  /**
   * ⚠ KHÔNG CÒN được vòng dùng (chính sách phân bậc 2026-10-17: dữ liệu mang mệnh lệnh ⇒ cảnh báo / cờ thẻ duyệt / hạ
   * tự trị, không dừng). Giữ trong kiểu cho tương thích bản ghi `ai_agent_runs` cũ và UI phát lại.
   */
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
  /** Một kết quả tool chứa câu dạng mệnh lệnh — chỉ là DỮ LIỆU; vòng KHÔNG dừng (mọi chế độ). */
  | { loai: "canh-bao-du-lieu"; id: string; ten: string; nguon: string; mau: string[] }
  /** `tu-dong` bị HẠ tự trị cho phần còn lại của lượt (mọi ghi/lệnh sau đó cần người duyệt). Phát MỘT lần mỗi lượt. */
  | { loai: "ha-tu-tri"; lyDo: "noi-dung-dang-ngo"; nguon: string; mau: string[] }
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
  | {
      loai: "xong";
      toolCalls: WireToolCall[];
      usage?: { vao: number; ra: number; nghi?: number };
      /**
       * Lượt bị CẮT ở trần token ra (engine báo `finish_reason:"length"`). Có tool call ⇒ tham số có thể DỞ dù trông hợp
       * lệ (JSON đủ ngoặc nhưng nội dung tệp cụt) ⇒ lõi KHÔNG thực thi lời gọi nào của lượt đó. Vắng = không bị cắt.
       */
      biCat?: boolean;
    };

export interface GoiModel {
  (vao: { tinNhan: TinNhan[]; congCu: WireTool[]; signal: AbortSignal }): AsyncIterable<ManhModel>;
}

export interface NguCanhThucThi {
  cheDo: CheDoAgent;
  runId: string;
  luot: number;
  signal: AbortSignal;
  phat: (e: SuKienAgent) => void;
  /**
   * Nguồn (tệp/tool) đáng ngờ lượt này đã đọc, theo thứ tự. Bộ thực thi gắn vào MỌI thẻ duyệt (`DeXuatDuyet.nguonDangNgo`).
   * Lõi chỉ MANG trạng thái — bộ thực thi nên hợp thêm nguồn nó tự phát hiện.
   */
  nguonDangNgo?: readonly string[];
  /**
   * `tu-dong` đã bị HẠ tự trị (không bao giờ nâng lại trong lượt). Bộ thực thi PHẢI coi mọi ghi/lệnh như `sua` (qua
   * người duyệt) — đây là nơi THI HÀNH; `cheDo` vẫn giữ "tu-dong" (bộ tool không đổi).
   */
  haTuTri?: boolean;
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
