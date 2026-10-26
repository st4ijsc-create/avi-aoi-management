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
}

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
  /^(auto|vai-tro:[a-z][a-z0-9]*(\.[a-z0-9-]+)?|ho-so:[A-Za-z0-9._@-]{1,96}|ngoai:[a-z0-9-]{1,32}:[A-Za-z0-9._:-]{1,96})$/;
