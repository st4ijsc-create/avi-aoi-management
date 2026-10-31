/**
 * ★ Đợt 10.3 B2 — SỔ AI NGOÀI (`ai_external_calls`, WORM — mig 0415). Hàng Ý ĐỊNH ghi TRƯỚC lời gọi (ghi lỗi ⇒ cổng KHÔNG gọi), hàng
 * KẾT QUẢ ghi SAU (tối đa một cho mỗi ý định — chỉ mục duy nhất). Sổ chỉ giữ BĂM của nội dung ĐÃ che; nguyên văn ĐÃ che chỉ khi nhà máy
 * bật `luuNguyenVan`, ở bảng riêng có hạn giữ, đọc qua thủ tục admin có phạm vi + audit (Task 7–8).
 * Ý định mồ côi (không kết quả sau 30 phút — tiến trình chết giữa lời gọi) ⇒ `doiSoatYDinhMoCoi` ghi hàng kết quả `khong-ro` (CHÈN, không
 * sửa) và KHÔNG hoàn bộ đếm (yêu cầu có thể đã rời máy).
 */
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { LoiNgoai } from "./loi";
import type { MucDuLieu } from "./phanLoai";

export interface DbSo {
  execute(q: SQL): Promise<unknown>;
}

const hang = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

export interface HangYDinh {
  factoryId: number;
  nhaMayDuLieu: number[];
  userId: number | null;
  flowId: string | null;
  runId: string | null;
  tuDong: boolean;
  nhaCungCap: string;
  model: string;
  mucDich: string;
  mucDuLieu: MucDuLieu;
  soTruongDaChe: number;
  bamNoiDung: string;
}

export interface HangKetQua {
  tokenVao: number | null;
  tokenRa: number | null;
  chiPhiUocUsd: number | null;
  ketCuc: "ok" | "loi" | "tu-choi" | "khong-ro";
  maLoi?: string;
  /** ★ 10.4b L0a' (0417) — `bamCauTraLoi(noiDung)` của câu trả lời nhà cung cấp (chỉ hàng ok). */
  bamTraLoi?: string;
}

/**
 * ★ 10.4b L0a' — băm CÂU TRẢ LỜI để đối chiếu dấu nguồn: sha256 hex của chuỗi đã chuẩn hoá NFC + bỏ khoảng trắng đầu/cuối (client lưu
 * đúng chữ máy chủ phát; lệch chỉ ở khoảng trắng biên / dạng Unicode không làm mất dấu). Cùng hàm ở cổng (ghi) và khi lưu tin (so).
 */
export function bamCauTraLoi(s: string): string {
  return createHash("sha256").update(String(s ?? "").normalize("NFC").trim(), "utf8").digest("hex");
}

/** sha256 hex của bản ĐÃ che. */
export function bamNoiDung(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const cat = (s: string | null | undefined, n: number) => (s == null ? null : s.slice(0, n));

export async function ghiYDinh(db: DbSo, h: HangYDinh): Promise<number> {
  const r = hang(
    await db.execute(sql`
      INSERT INTO ai_external_calls ("factoryId", "nhaMayDuLieu", loai, "userId", "flowId", "runId", "tuDong", "nhaCungCap", model, "mucDich",
        "mucDuLieu", "soTruongDaChe", "bamNoiDung")
      VALUES (${h.factoryId}, ${sql.raw(`ARRAY[${h.nhaMayDuLieu.filter((x) => Number.isInteger(x)).join(",")}]::int[]`)}, 'y-dinh', ${h.userId},
        ${cat(h.flowId, 64)}, ${cat(h.runId, 64)}, ${h.tuDong}, ${cat(h.nhaCungCap, 16)}, ${cat(h.model, 96)}, ${cat(h.mucDich, 32)},
        ${h.mucDuLieu}, ${h.soTruongDaChe}, ${h.bamNoiDung})
      RETURNING id`),
  );
  const id = Number(r[0]?.id);
  if (!Number.isFinite(id)) throw new LoiNgoai("NGOAI_SO_HONG");
  return id;
}

/** Hàng kết quả; đã có (vd đối soát ghi `khong-ro` trước) ⇒ bỏ qua (WORM: không sửa). */
export async function ghiKetQua(db: DbSo, yDinhId: number, h: HangKetQua): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_external_calls ("factoryId", "nhaMayDuLieu", loai, "yDinhId", "userId", "flowId", "runId", "tuDong", "nhaCungCap", model, "mucDich",
      "tokenVao", "tokenRa", "chiPhiUocUsd", "ketCuc", "maLoi", "bamTraLoi")
    SELECT "factoryId", "nhaMayDuLieu", 'ket-qua', id, "userId", "flowId", "runId", "tuDong", "nhaCungCap", model, "mucDich",
      ${h.tokenVao}, ${h.tokenRa}, ${h.chiPhiUocUsd}, ${h.ketCuc}, ${cat(h.maLoi, 48)}, ${h.bamTraLoi ?? null}
    FROM ai_external_calls WHERE id = ${yDinhId} AND loai = 'y-dinh'
    ON CONFLICT ("yDinhId") WHERE loai = 'ket-qua' DO NOTHING`);
}

/** Lưu nội dung ĐÃ che khi nhà máy bật; hạn giữ `hanGiuNgay`. */
export async function luuNoiDungNeuBat(
  db: DbSo,
  callId: number,
  factoryId: number,
  noiDungDaChe: string,
  cauHinh: { luuNguyenVan: boolean; hanGiuNgay: number },
  bayGio = new Date(),
): Promise<boolean> {
  if (!cauHinh.luuNguyenVan) return false;
  const het = new Date(bayGio.getTime() + Math.min(365, Math.max(1, cauHinh.hanGiuNgay)) * 86_400_000).toISOString();
  await db.execute(sql`INSERT INTO ai_external_call_noi_dung ("callId", "factoryId", "noiDungDaChe", "hetHanLuc") VALUES (${callId}, ${factoryId}, ${noiDungDaChe}, ${het}::timestamptz)`);
  return true;
}

export async function xoaNoiDungHetHan(db: DbSo, bayGio = new Date()): Promise<number> {
  return hang(await db.execute(sql`DELETE FROM ai_external_call_noi_dung WHERE "hetHanLuc" <= ${bayGio.toISOString()}::timestamptz RETURNING 1`)).length;
}

/** Ý định không có kết quả sau `quaPhut` ⇒ hàng kết quả `khong-ro` (`maLoi = MO_COI`). Chạy lại không ghi trùng. */
export async function doiSoatYDinhMoCoi(db: DbSo, quaPhut = 30, bayGio = new Date()): Promise<number> {
  const moc = new Date(bayGio.getTime() - quaPhut * 60_000).toISOString();
  return hang(
    await db.execute(sql`
      INSERT INTO ai_external_calls ("factoryId", "nhaMayDuLieu", loai, "yDinhId", "userId", "flowId", "runId", "tuDong", "nhaCungCap", model, "mucDich",
        "ketCuc", "maLoi")
      SELECT y."factoryId", y."nhaMayDuLieu", 'ket-qua', y.id, y."userId", y."flowId", y."runId", y."tuDong", y."nhaCungCap", y.model, y."mucDich",
        'khong-ro', 'MO_COI'
      FROM ai_external_calls y
      WHERE y.loai = 'y-dinh' AND y."taoLuc" < ${moc}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM ai_external_calls k WHERE k.loai = 'ket-qua' AND k."yDinhId" = y.id)
      ON CONFLICT ("yDinhId") WHERE loai = 'ket-qua' DO NOTHING
      RETURNING id`),
  ).length;
}
