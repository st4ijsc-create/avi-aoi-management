/**
 * ★ Đợt 10.1 (A1/A2) — kiểu dùng chung của "chọn model theo yêu cầu". Spec
 * `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §4.
 *
 * Mã chọn (`ma`): `auto` | `vai-tro:<id>` | `ho-so:<profileId>` | `ngoai:<nhaCungCap>:<model>`. KHÔNG còn tên tệp GGUF
 * trần — danh mục không bao giờ lộ đường dẫn / tên tệp / cổng (người dùng chọn theo VAI hoặc HỒ SƠ).
 */
import type { AnhSoModel } from "../soModel/anhSoModel";

export type LoaiMuc = "auto" | "vai-tro" | "ho-so" | "ngoai";
export type TrangThaiMuc = "san-sang" | "can-doi-khe" | "tat";

export interface MucModel {
  ma: string;
  loai: LoaiMuc;
  nhan: string;
  moTa: string;
  trangThai: TrangThaiMuc;
  /** Chỉ có khi `can-doi-khe` VÀ đã đo được (trung vị sự kiện `doi_khe`); vắng ⇒ UI ghi "chưa đo", không bịa số. */
  uocTinhDoiKheGiay?: number;
  nhaCungCap?: string;
  /**
   * ★ Đợt 10.4 (D7) — CHỈ mục `ngoai`: các bề mặt mà máy chủ cho dùng model ngoài này. Client lọc theo bề mặt; thiếu ⇒ [] (ẩn).
   * 10.4 = `BE_MAT_NGOAI_DUOC_DUNG` (luồng + kiểm định); 10.4b mở thêm chat / coding / agent bằng cách đổi hằng này.
   */
  duocDungO?: BeMatNgoai[];
}

export type BeMatNgoai = "luong" | "kiem-dinh" | "chat" | "coding" | "agent";
/** Bề mặt dùng được model ngoài ở 10.4 — nguồn DUY NHẤT (danh mục + thủ tục kiểm định đọc cùng hằng). */
// ★ 10.4b L1 — mở "chat" (/ai-chat + KB qua `routes/kbNgoai.ts`; chỉ nhà máy đã cho dữ liệu vận hành — Q-A chủ dự án). Rollback = bỏ "chat".
export const BE_MAT_NGOAI_DUOC_DUNG: readonly BeMatNgoai[] = ["luong", "kiem-dinh", "chat"];

/** 10.3 thay bằng `cauHinhNgoai.layModelDaBat`; 10.1 mặc định rỗng. */
export interface NguonModelNgoai {
  layModelDaBat(factoryId: number | null): Promise<Array<{ nhaCungCap: string; model: string; nhan: string }>>;
}

export const NGOAI_RONG: NguonModelNgoai = { layModelDaBat: async () => [] };

export interface PhuThuocDanhMuc {
  anh: AnhSoModel;
  /** Hồ sơ có ≥ 1 lượt đo (`ai_model_eval_runs`) — cùng điều kiện cổng gán `datGan` (CHUA_CO_DO). */
  hoSoCoDo: ReadonlySet<string>;
  /** Model khe nặng đang giữ thật (`nguCanhKhe().kheDangGiu`); null ⇒ so với `LLAMA_SERVER_MODEL`. */
  kheDangGiu: string | null;
  uocTinhDoiKheGiay: () => Promise<number | null>;
  ngoai: NguonModelNgoai;
  env?: NodeJS.ProcessEnv;
}

/**
 * Hình dạng hợp lệ của `chonModel` (parseContext + zod dùng chung). Khớp hình dạng CHƯA đủ: `ho-so:`/`ngoai:` còn phải
 * có trong danh mục lúc giải (`giaiChonModel`) — không tin regex.
 */
export const CHON_MODEL_RE =
  /^(auto|vai-tro:[a-z][a-z0-9]*(\.[a-z0-9-]+)?|ho-so:[A-Za-z0-9._@-]{1,96}|ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:-]{1,96})$/;

/**
 * ★ Đợt 10.3 — MỘT cách viết tên nhà cung cấp AI ngoài cho MỌI nơi (dieu-phoi 2026-10-26): enum `apikeyprovider` (mig 0413), CHECK
 * `ai_ngoai_model.nhaCungCap` (mig 0414), mã `ngoai:<ncc>:<model>`, i18n. Lưới `nhaCungCap.test.ts` canh SQL + enum drizzle khớp danh sách này.
 */
export const NHA_CUNG_CAP_NGOAI = ["anthropic", "openai", "gemini", "openai_compat"] as const;
export type NhaCungCapNgoai = (typeof NHA_CUNG_CAP_NGOAI)[number];
