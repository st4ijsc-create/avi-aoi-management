/**
 * ★ Đợt 10.3 — đọc CẤU HÌNH AI ngoài theo nhà máy (`ai_ngoai_nha_may`, mig 0414) + DANH MỤC model ngoài (`ai_ngoai_model`). Mọi hàm đọc
 * LÚC GỌI (không đệm) — tắt ở màn quản trị có hiệu lực ngay lượt kế. Ghi (admin, audit cũ/mới) ở Task 8.
 */
import { sql, type SQL } from "drizzle-orm";
import type { TranNhaMay } from "./tranChiPhi";

export interface DbDoc {
  execute(q: SQL): Promise<unknown>;
}

const hang = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
const soHoacNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface CauHinhNhaMay extends TranNhaMay {
  factoryId: number;
  batNgoai: boolean;
  choDuLieuVanHanh: boolean;
  luuNguyenVan: boolean;
  hanGiuNgay: number;
  /** ★ 0418 — trần byte KẾT QUẢ TOOL / số tệp đọc gửi ra ngoài mỗi run (vòng tool L3 dùng). */
  tranByteDocLuot?: number;
  tranTepDocLuot?: number;
}

export interface ModelNgoai {
  id: number;
  factoryId: number;
  nhaCungCap: string;
  model: string;
  nhan: string;
  keyId: number;
  giaVaoUsdTrieu: number | null;
  giaRaUsdTrieu: number | null;
  tranTokenLuot: number | null;
  batModel: boolean;
}

/** `AI_NGOAI_ENABLED` đọc LÚC GỌI; chỉ đúng chuỗi "true" mới bật. */
export function ngoaiBatTheoEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_NGOAI_ENABLED === "true";
}

export async function layCauHinhNhaMay(db: DbDoc, factoryId: number): Promise<CauHinhNhaMay | null> {
  const [r] = hang(await db.execute(sql`SELECT * FROM ai_ngoai_nha_may WHERE "factoryId" = ${factoryId}`));
  if (!r) return null;
  return {
    factoryId,
    batNgoai: r.batNgoai === true,
    choDuLieuVanHanh: r.choDuLieuVanHanh === true,
    luuNguyenVan: r.luuNguyenVan === true,
    hanGiuNgay: Number(r.hanGiuNgay),
    tranTokenNgay: soHoacNull(r.tranTokenNgay),
    tranTienNgayUsd: soHoacNull(r.tranTienNgayUsd),
    tranTokenNguoiNgay: soHoacNull(r.tranTokenNguoiNgay),
    tranTokenLuongNgay: soHoacNull(r.tranTokenLuongNgay),
    tranTokenLuot: soHoacNull(r.tranTokenLuot),
    tranLanPhut: Number(r.tranLanPhut),
    // ★ 10.4b L0a' (0418) — trần mỗi RUN
    tranTienLuotUsd: soHoacNull(r.tranTienLuotUsd),
    tranVongLuot: r.tranVongLuot === undefined || r.tranVongLuot === null ? null : Number(r.tranVongLuot),
    tranByteDocLuot: Number(r.tranByteDocLuot ?? 262_144),
    tranTepDocLuot: Number(r.tranTepDocLuot ?? 50),
  };
}

function docModel(r: Record<string, unknown>): ModelNgoai {
  return {
    id: Number(r.id),
    factoryId: Number(r.factoryId),
    nhaCungCap: String(r.nhaCungCap),
    model: String(r.model),
    nhan: String(r.nhan),
    keyId: Number(r.keyId),
    giaVaoUsdTrieu: soHoacNull(r.giaVaoUsdTrieu),
    giaRaUsdTrieu: soHoacNull(r.giaRaUsdTrieu),
    tranTokenLuot: soHoacNull(r.tranTokenLuot),
    batModel: r.batModel === true,
  };
}

export async function layModelNgoai(db: DbDoc, factoryId: number, nhaCungCap: string, model: string): Promise<ModelNgoai | null> {
  const [r] = hang(await db.execute(sql`SELECT * FROM ai_ngoai_model WHERE "factoryId" = ${factoryId} AND "nhaCungCap" = ${nhaCungCap} AND model = ${model}`));
  return r ? docModel(r) : null;
}

/**
 * Model ngoài DÙNG ĐƯỢC của nhà máy (cờ env bật + nhà máy bật + model bật) — nguồn của danh mục 10.1 (`NguonModelNgoai`).
 * null / cờ tắt / nhà máy tắt / DB lỗi ⇒ `[]`.
 */
export async function layModelDaBat(db: DbDoc | null, factoryId: number | null, env: NodeJS.ProcessEnv = process.env): Promise<Array<{ nhaCungCap: string; model: string; nhan: string }>> {
  if (!db || factoryId === null || !ngoaiBatTheoEnv(env)) return [];
  try {
    const cfg = await layCauHinhNhaMay(db, factoryId);
    if (!cfg?.batNgoai) return [];
    const ds = hang(await db.execute(sql`SELECT * FROM ai_ngoai_model WHERE "factoryId" = ${factoryId} AND "batModel" ORDER BY "nhaCungCap", model`));
    return ds.map(docModel).map((m) => ({ nhaCungCap: m.nhaCungCap, model: m.model, nhan: m.nhan }));
  } catch {
    return [];
  }
}
