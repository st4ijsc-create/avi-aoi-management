/**
 * ★ Đợt 10.3 B2 — TRẦN CHI PHÍ ĐẶT-TRƯỚC NGUYÊN TỬ cho lời gọi AI ngoài. Giữ chỗ (token + tiền ước tính BI QUAN) TRƯỚC khi gọi, kết
 * toán SAU theo `usage` thật. Trần theo NHÀ MÁY TÍNH TRẦN (chủ dữ liệu) / ngày UTC+7 / người / luồng / lượt + số lần mỗi phút.
 *
 * Mỗi khoá: MỘT câu `INSERT … SELECT … WHERE ≤ trần ON CONFLICT DO UPDATE … WHERE ≤ trần RETURNING` (rà kiem-dinh mục 1 — nhánh CHÈN
 * cũng kiểm trần, cả token lẫn tiền). Mọi khoá trong MỘT giao dịch: một khoá vượt ⇒ ROLLBACK mọi khoá + `NGOAI_VUOT_TRAN`. Đồng thời:
 * khoá hàng của `ON CONFLICT` tuần tự hoá hai lượt sát trần ⇒ đúng một lượt qua. DB lỗi ⇒ `NGOAI_DEM_HONG` (không gọi).
 *
 * Hoàn chỗ (rà mục 8): `ketToan` chỉ trừ chênh khi nhà cung cấp trả `usage` hợp lệ; yêu cầu đã RỜI MÁY mà không có `usage` ⇒ giữ
 * nguyên ước tính. `huyGiuChuaGui` hoàn TOÀN BỘ — chỉ khi CHẮC CHẮN chưa gửi.
 * ⚠ Ước tính bi quan 2–4× với tiếng Anh / mã ⇒ trần "chặn sớm" — quản trị đặt trần có hệ số (README vận hành).
 */
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { LoiNgoai } from "./loi";

export interface TranNhaMay {
  tranTokenNgay: number | null;
  tranTienNgayUsd: number | null;
  tranTokenNguoiNgay: number | null;
  tranTokenLuongNgay: number | null;
  tranTokenLuot: number | null;
  tranLanPhut: number;
}

export interface YeuCauGiuCho {
  factoryId: number;
  userId: number | null;
  flowId: string | null;
  runId: string | null;
  tokenUoc: number;
  tienUocUsd: number | null;
}

export interface PhieuGiu {
  id: string;
  factoryId: number;
  ngay: string;
  phut: string;
  khoa: string[];
  tokenUoc: number;
  tienUocUsd: number;
}

/** Cơ sở dữ liệu tối thiểu: `transaction` + `execute` của drizzle (postgres-js). */
export interface DbDem {
  transaction<T>(f: (tx: { execute(q: SQL): Promise<unknown> }) => Promise<T>): Promise<T>;
  execute(q: SQL): Promise<unknown>;
}

const hang = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

/** Ngày lịch theo UTC+7 (YYYY-MM-DD). */
export function ngayUtc7(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Phút (UTC, giây = 0) cho bộ đếm số lần / phút. */
function phutCua(d: Date): string {
  const p = new Date(d.getTime());
  p.setUTCSeconds(0, 0);
  return p.toISOString();
}

/**
 * Ước tính token VÀO BI QUAN: số byte UTF-8 / 2 (≥ số token thật với mọi tokenizer đã biết, kể cả CJK / Việt có dấu ~1 token / 2–3 byte).
 */
export function uocTokenVao(yc: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(yc) ?? "", "utf8") / 2);
}

function cacKhoa(yc: YeuCauGiuCho, tran: TranNhaMay): Array<{ khoa: string; tranToken: number | null; tranTien: number | null }> {
  const ds: Array<{ khoa: string; tranToken: number | null; tranTien: number | null }> = [
    { khoa: "nha-may", tranToken: tran.tranTokenNgay, tranTien: tran.tranTienNgayUsd },
  ];
  if (yc.userId !== null) ds.push({ khoa: `nguoi:${yc.userId}`, tranToken: tran.tranTokenNguoiNgay, tranTien: null });
  if (yc.flowId !== null) ds.push({ khoa: `luong:${yc.flowId}`.slice(0, 80), tranToken: tran.tranTokenLuongNgay, tranTien: null });
  if (yc.runId !== null) ds.push({ khoa: `luot:${yc.runId}`.slice(0, 80), tranToken: tran.tranTokenLuot, tranTien: null });
  return ds;
}

/** Giữ chỗ nguyên tử cho mọi khoá + số lần / phút. */
export async function datTruoc(db: DbDem, yc: YeuCauGiuCho, tran: TranNhaMay, bayGio = new Date()): Promise<PhieuGiu> {
  const n = Math.max(0, Math.ceil(yc.tokenUoc));
  const tien = Math.max(0, yc.tienUocUsd ?? 0);
  // Lời gọi KHÔNG thuộc lượt chạy (chat / lập trình): trần lượt áp cho CHÍNH lời gọi.
  if (yc.runId === null && tran.tranTokenLuot !== null && n > tran.tranTokenLuot) throw new LoiNgoai("NGOAI_VUOT_TRAN", "luot");
  const ngay = ngayUtc7(bayGio);
  const phut = phutCua(bayGio);
  const khoa = cacKhoa(yc, tran);
  try {
    await db.transaction(async (tx) => {
      for (const k of khoa) {
        const r = await tx.execute(sql`
          INSERT INTO ai_ngoai_dem ("factoryId", ngay, khoa, "tokenGiu", "tienGiuUsd")
          SELECT ${yc.factoryId}, ${ngay}::date, ${k.khoa}, ${n}, ${tien}
          WHERE (${k.tranToken}::bigint IS NULL OR ${n} <= ${k.tranToken}::bigint)
            AND (${k.tranTien}::numeric IS NULL OR ${tien} <= ${k.tranTien}::numeric)
          ON CONFLICT ("factoryId", ngay, khoa) DO UPDATE
            SET "tokenGiu" = ai_ngoai_dem."tokenGiu" + EXCLUDED."tokenGiu",
                "tienGiuUsd" = ai_ngoai_dem."tienGiuUsd" + EXCLUDED."tienGiuUsd"
            WHERE (${k.tranToken}::bigint IS NULL OR ai_ngoai_dem."tokenGiu" + EXCLUDED."tokenGiu" <= ${k.tranToken}::bigint)
              AND (${k.tranTien}::numeric IS NULL OR ai_ngoai_dem."tienGiuUsd" + EXCLUDED."tienGiuUsd" <= ${k.tranTien}::numeric)
          RETURNING khoa`);
        if (hang(r).length !== 1) throw new LoiNgoai("NGOAI_VUOT_TRAN", k.khoa.split(":")[0]);
      }
      const r = await tx.execute(sql`
        INSERT INTO ai_ngoai_dem_phut ("factoryId", phut, so)
        SELECT ${yc.factoryId}, ${phut}::timestamptz, 1 WHERE 1 <= ${tran.tranLanPhut}
        ON CONFLICT ("factoryId", phut) DO UPDATE SET so = ai_ngoai_dem_phut.so + 1 WHERE ai_ngoai_dem_phut.so + 1 <= ${tran.tranLanPhut}
        RETURNING so`);
      if (hang(r).length !== 1) throw new LoiNgoai("NGOAI_VUOT_TRAN", "lan-phut");
    });
  } catch (e) {
    if (e instanceof LoiNgoai) throw e;
    throw new LoiNgoai("NGOAI_DEM_HONG");
  }
  return { id: randomUUID(), factoryId: yc.factoryId, ngay, phut, khoa: khoa.map((k) => k.khoa), tokenUoc: n, tienUocUsd: tien };
}

async function congVao(db: DbDem, phieu: PhieuGiu, deltaToken: number, deltaTien: number): Promise<void> {
  // ≤ 4 khoá ⇒ mỗi khoá một câu (không dựng mảng tham số — bài học Drizzle ANY-array).
  for (const khoa of phieu.khoa) {
    await db.execute(sql`
      UPDATE ai_ngoai_dem SET "tokenGiu" = GREATEST(0, "tokenGiu" + ${deltaToken}), "tienGiuUsd" = GREATEST(0, "tienGiuUsd" + ${deltaTien})
      WHERE "factoryId" = ${phieu.factoryId} AND ngay = ${phieu.ngay}::date AND khoa = ${khoa}`);
  }
}

/**
 * Kết toán theo `usage` thật. `thuc === null` (đã gửi nhưng không có usage: hết hạn, mất kết nối, 5xx sau gửi) ⇒ GIỮ ước tính.
 */
export async function ketToan(db: DbDem, phieu: PhieuGiu, thuc: { tokenVao: number; tokenRa: number; tienUsd: number | null } | null): Promise<void> {
  if (!thuc || !Number.isFinite(thuc.tokenVao) || !Number.isFinite(thuc.tokenRa) || thuc.tokenVao < 0 || thuc.tokenRa < 0) return;
  const deltaToken = Math.ceil(thuc.tokenVao + thuc.tokenRa) - phieu.tokenUoc;
  const deltaTien = thuc.tienUsd !== null && Number.isFinite(thuc.tienUsd) ? thuc.tienUsd - phieu.tienUocUsd : 0;
  if (deltaToken === 0 && deltaTien === 0) return;
  await congVao(db, phieu, deltaToken, deltaTien);
}

/** Hoàn TOÀN BỘ chỗ đã giữ — CHỈ khi chắc chắn yêu cầu chưa rời máy (lỗi trước `fetch`, sổ ý định lỗi, URL bị từ chối). */
export async function huyGiuChuaGui(db: DbDem, phieu: PhieuGiu): Promise<void> {
  await congVao(db, phieu, -phieu.tokenUoc, -phieu.tienUocUsd);
  await db.execute(sql`UPDATE ai_ngoai_dem_phut SET so = GREATEST(0, so - 1) WHERE "factoryId" = ${phieu.factoryId} AND phut = ${phieu.phut}::timestamptz`);
}

/** Dọn bộ đếm: ngày cũ hơn `giuNgay` (theo UTC+7), phút cũ hơn 1 giờ. Trả số hàng đã xoá. */
export async function donDemCu(db: DbDem, giuNgay = 90, bayGio = new Date()): Promise<number> {
  const moc = ngayUtc7(new Date(bayGio.getTime() - giuNgay * 86_400_000));
  const a = await db.execute(sql`DELETE FROM ai_ngoai_dem WHERE ngay < ${moc}::date RETURNING 1`);
  const b = await db.execute(sql`DELETE FROM ai_ngoai_dem_phut WHERE phut < ${new Date(bayGio.getTime() - 3600_000).toISOString()}::timestamptz RETURNING 1`);
  return hang(a).length + hang(b).length;
}

/**
 * ★ Đợt 10.4 (D6) — phần TRẦN NGÀY CÒN LẠI (đọc, tham khảo — KHÔNG giữ chỗ): nhà máy (token + USD) và người gọi (token). `null` = trần
 * đó chưa đặt. Đọc cùng bảng đếm `ai_ngoai_dem` với `datTruoc` (đã gồm chỗ đang giữ của lượt đang chạy).
 */
export async function docConLaiNgay(
  db: DbDem,
  factoryId: number,
  userId: number | null,
  tran: Pick<TranNhaMay, "tranTokenNgay" | "tranTienNgayUsd" | "tranTokenNguoiNgay">,
  bayGio = new Date(),
): Promise<{ nhaMay: { token: number | null; usd: number | null }; nguoi: { token: number | null } }> {
  const ngay = ngayUtc7(bayGio);
  const khoaNguoi = userId === null ? null : `nguoi:${userId}`;
  const r = hang(
    await db.execute(sql`SELECT khoa, "tokenGiu", "tienGiuUsd" FROM ai_ngoai_dem
      WHERE "factoryId" = ${factoryId} AND ngay = ${ngay}::date AND khoa IN ('nha-may', ${khoaNguoi ?? "nha-may"})`),
  ) as Array<{ khoa: string; tokenGiu: number | string; tienGiuUsd: number | string | null }>;
  const dong = (k: string) => r.find((x) => x.khoa === k);
  const conLai = (tran_: number | null, daDung: unknown) => (tran_ === null ? null : Math.max(0, tran_ - Number(daDung ?? 0)));
  const nm = dong("nha-may");
  const ng = khoaNguoi ? dong(khoaNguoi) : undefined;
  return {
    nhaMay: { token: conLai(tran.tranTokenNgay, nm?.tokenGiu), usd: conLai(tran.tranTienNgayUsd, nm?.tienGiuUsd) },
    nguoi: { token: userId === null ? null : conLai(tran.tranTokenNguoiNgay, ng?.tokenGiu) },
  };
}

/** Phần dành cho đầu ra tối thiểu khi trần LƯỢT phải co `maxTokens` lại — ít hơn ⇒ coi như vượt trần (không gọi để nhận câu cụt). */
export const RA_TOI_THIEU_KHI_CO = 256;

/**
 * ★ 10.4 (luong-ui / dieu-phoi) — trần MỖI LƯỢT (lời gọi không thuộc lượt chạy: `runId` null) áp cho TỔNG vào + ra. Trước đây cổng giữ
 * nguyên `maxTokens` rồi `datTruoc` từ chối khi vào + maxTokens > trần ⇒ model khai `tranTokenLuot` = maxTokens mặc định KHÔNG BAO GIỜ
 * gọi được. Nay: co `maxTokens` = min(maxTokens, trần − vào ước) — còn < `RA_TOI_THIEU_KHI_CO` ⇒ `NGOAI_VUOT_TRAN` "luot".
 * Hàm THUẦN dùng chung cho cổng (\`goiAiNgoai\`, sau bộ che) và xem trước (\`aiKiemDinh.xemTruoc\`) ⇒ hai bên không thể lệch luật.
 */
export function chotTranLuot(tokenVaoUoc: number, maxTokens: number, tranLuot: number | null, runId: string | null): number {
  if (runId !== null || tranLuot === null) return maxTokens;
  const con = tranLuot - Math.ceil(tokenVaoUoc);
  if (con < RA_TOI_THIEU_KHI_CO) throw new LoiNgoai("NGOAI_VUOT_TRAN", "luot");
  return Math.min(maxTokens, con);
}

/**
 * ★ 10.4 — XEM TRƯỚC trần NGÀY / PHÚT (chỉ ĐỌC, không giữ chỗ): CÙNG danh sách khoá (`cacKhoa`) + cùng phép so với \`datTruoc\`
 * (đã giữ + ước ≤ trần) + số lần / phút. Trả lý do đầu tiên vượt (\`nha-may\` | \`nguoi\` | \`luong\` | \`luot\` | \`lan-phut\`) hoặc null.
 * Tham khảo: giữa xem trước và gọi thật có thể có lượt khác giữ chỗ — \`datTruoc\` vẫn là rào nguyên tử.
 */
export async function xemTranNgay(db: DbDem, yc: YeuCauGiuCho, tran: TranNhaMay, bayGio = new Date()): Promise<string | null> {
  const n = Math.max(0, Math.ceil(yc.tokenUoc));
  const tien = Math.max(0, yc.tienUocUsd ?? 0);
  if (yc.runId === null && tran.tranTokenLuot !== null && n > tran.tranTokenLuot) return "luot";
  const ngay = ngayUtc7(bayGio);
  for (const k of cacKhoa(yc, tran)) {
    if (k.tranToken === null && k.tranTien === null) continue;
    const [h] = hang(await db.execute(sql`SELECT "tokenGiu", "tienGiuUsd" FROM ai_ngoai_dem WHERE "factoryId" = ${yc.factoryId} AND ngay = ${ngay}::date AND khoa = ${k.khoa}`));
    const daToken = Number(h?.tokenGiu ?? 0);
    const daTien = Number(h?.tienGiuUsd ?? 0);
    if ((k.tranToken !== null && daToken + n > k.tranToken) || (k.tranTien !== null && daTien + tien > k.tranTien)) return k.khoa.split(":")[0]!;
  }
  const [p] = hang(await db.execute(sql`SELECT so FROM ai_ngoai_dem_phut WHERE "factoryId" = ${yc.factoryId} AND phut = ${phutCua(bayGio)}::timestamptz`));
  if (Number(p?.so ?? 0) + 1 > tran.tranLanPhut) return "lan-phut";
  return null;
}
