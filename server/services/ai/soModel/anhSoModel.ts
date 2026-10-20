/**
 * ★★ Đợt 7.0 — ẢNH CHỤP sổ model trong bộ nhớ. Module LÁ, THUẦN (không I/O, không import CSDL) ⇒ `modelResolver`
 * (vốn phải import được từ mọi nơi, kể cả `aiModelRouter`) đọc được đồng bộ. Bộ nạp từ CSDL ở `napSoModel.ts`.
 *
 * Ảnh rỗng (`taiLuc === 0`: CSDL chưa lên, bảng chưa áp) là trạng thái HỢP LỆ: bộ định tuyến rơi về `VAI_TRO_GOC`
 * + `.env` — đúng hành vi trước Đợt 7.
 */
import type { EnvKeyModel } from "../../../../shared/aiRoles";

export type SlotClass = "nang" | "nho" | "sidecar";
export type PhamViGan = "global" | "tenant" | "project" | "flow";
export type CheDoGan = "active" | "shadow" | "thu";

export interface ProfileTrongAnh {
  artifactFile: string;
  slotClass: SlotClass;
  artifactStatus: string;
  license: string;
  enabled: boolean;
}

export interface GanTrongAnh {
  roleId: string;
  scopeKind: PhamViGan;
  scopeId: string | null;
  profileId: string | null;
  envKey: EnvKeyModel | null;
  fallback: string[];
  mode: CheDoGan;
}

export interface AnhSoModel {
  /** `Date.now()` của lần nạp thành công; 0 = chưa nạp lần nào. */
  taiLuc: number;
  vaiTro: Map<string, { envKey: EnvKeyModel; taskKind: string }>;
  profile: Map<string, ProfileTrongAnh>;
  gan: GanTrongAnh[];
}

export const ANH_RONG: AnhSoModel = Object.freeze({
  taiLuc: 0,
  vaiTro: new Map(),
  profile: new Map(),
  gan: [],
}) as AnhSoModel;

let anhHienTai: AnhSoModel = ANH_RONG;

/** Đồng bộ, không ném. */
export function layAnhSoModel(): AnhSoModel {
  return anhHienTai;
}

/** Chỉ bộ nạp (`napSoModel.ts`) và lưới gọi. */
export function datAnhSoModel(anh: AnhSoModel): void {
  anhHienTai = anh;
}
