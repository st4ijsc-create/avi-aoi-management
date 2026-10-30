/**
 * ★ Đợt 10.4b L0a' (kế hoạch v2.1 §2 D9, rà kiem-dinh M5 / 6b-4) — DẤU NGUỒN tin trả lời do model NGOÀI sinh.
 *
 * Kho chat do CLIENT ghi (`aiChat.saveStreamedMessage` nhận nguyên văn câu trả lời) ⇒ dấu nguồn KHÔNG BAO GIỜ là lời khai của client.
 * Máy chủ tự xác minh bằng sổ cổng (`ai_external_calls`, WORM): hàng kết quả `ok` của ĐÚNG người gọi, `bamTraLoi` = băm câu trả lời
 * client đem lưu (`bamCauTraLoi`, cùng hàm cổng dùng lúc ghi).
 *   • client gửi `ngoaiCallId` ⇒ kiểm ĐÚNG hàng đó; lệch người / không ok / băm lệch ⇒ `LoiNgoai("NGOAI_KHONG_TON_TAI", "dau-nguon-lech")`
 *     (thủ tục đổi thành BAD_REQUEST) — không âm thầm lưu như tin cục bộ;
 *   • không gửi ⇒ vẫn TỰ DÒ theo băm trong 24 giờ gần nhất của người đó (client quên / cố tình bỏ không rửa được dấu).
 * Giới hạn đã khai (dieu-phoi chấp nhận): sửa một ký tự rồi lưu ⇒ tin đó mất dấu từng tin, nhưng hội thoại vẫn mang `coLuotNgoai`
 * (máy chủ đặt lúc gọi khi request có conversationId) ⇒ lịch sử vẫn bị bọc UNTRUSTED.
 */
import { sql } from "drizzle-orm";
import { RE_NGUON_MODEL, type VetNgoaiLichSu } from "../../../../shared/ai/sinhChuNgoai";
import { LoiNgoai } from "./loi";
import { bamCauTraLoi } from "./soNgoai";

export interface DbDauNguon {
  execute(q: ReturnType<typeof sql>): Promise<unknown>;
}

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

/** Cửa sổ tự dò theo băm khi client không gửi `ngoaiCallId`. */
export const GIO_TU_DO_DAU_NGUON = 24;

export interface DauNguonDaXacMinh {
  nguonModel: string;
  callId: number;
}

function nguonModelCua(r: Record<string, unknown>): string | null {
  const s = `ngoai:${String(r.nhaCungCap ?? "")}:${String(r.model ?? "")}`;
  return RE_NGUON_MODEL.test(s) ? s : null;
}

/** Xác minh dấu nguồn của câu trả lời `traLoi` mà `userId` đem lưu. `null` = không phải câu trả lời của model ngoài (cục bộ). */
export async function xacMinhDauNguon(
  db: DbDauNguon,
  y: { userId: number; traLoi: string; ngoaiCallId?: number | null },
): Promise<DauNguonDaXacMinh | null> {
  const bam = bamCauTraLoi(y.traLoi);
  if (y.ngoaiCallId !== undefined && y.ngoaiCallId !== null) {
    const [r] = hang(
      await db.execute(sql`
        SELECT yd.id, yd."userId", yd."nhaCungCap", yd.model, kq."ketCuc", kq."bamTraLoi"
        FROM ai_external_calls yd JOIN ai_external_calls kq ON kq."yDinhId" = yd.id AND kq.loai = 'ket-qua'
        WHERE yd.id = ${y.ngoaiCallId} AND yd.loai = 'y-dinh'`),
    );
    const nguon = r ? nguonModelCua(r) : null;
    if (!r || Number(r.userId) !== y.userId || r.ketCuc !== "ok" || String(r.bamTraLoi ?? "") !== bam || !nguon) {
      throw new LoiNgoai("NGOAI_KHONG_TON_TAI", "dau-nguon-lech");
    }
    return { nguonModel: nguon, callId: Number(r.id) };
  }
  const [r] = hang(
    await db.execute(sql`
      SELECT yd.id, yd."nhaCungCap", yd.model
      FROM ai_external_calls kq JOIN ai_external_calls yd ON yd.id = kq."yDinhId" AND yd.loai = 'y-dinh'
      WHERE kq.loai = 'ket-qua' AND kq."ketCuc" = 'ok' AND kq."userId" = ${y.userId} AND kq."bamTraLoi" = ${bam}
        AND kq."taoLuc" > now() - make_interval(hours => ${GIO_TU_DO_DAU_NGUON})
      ORDER BY kq.id DESC LIMIT 1`),
  );
  const nguon = r ? nguonModelCua(r) : null;
  return r && nguon ? { nguonModel: nguon, callId: Number(r.id) } : null;
}

/** Vết hiển thị lịch sử theo `callId` (JOIN hàng kết quả) — một câu cho cả trang tin. */
/**
 * Phạm vi: CHỈ lượt của chính `userId` (người xem hội thoại) VÀ thuộc nhà máy trong phạm vi người xem (`nhaMay` từ bộ phân giải
 * `resolveTenantFactoryScope`; `null` = toàn quyền — admin không gắn nhà máy) — callId lạ của người khác / nhà máy khác không lộ vết.
 */
export async function vetNgoaiTheoCall(
  db: DbDauNguon,
  userId: number,
  nhaMay: readonly number[] | null,
  callIds: readonly number[],
): Promise<Map<number, VetNgoaiLichSu>> {
  const ra = new Map<number, VetNgoaiLichSu>();
  const ids = [...new Set(callIds.filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length || (nhaMay !== null && nhaMay.length === 0)) return ra;
  const locNhaMay = nhaMay === null ? sql`` : sql` AND yd."factoryId" IN (${sql.join(nhaMay.map((f) => sql`${f}`), sql`, `)})`;
  const rows = hang(
    await db.execute(sql`
      SELECT yd.id, yd."nhaCungCap", yd.model, kq."tokenVao", kq."tokenRa", kq."chiPhiUocUsd"
      FROM ai_external_calls yd JOIN ai_external_calls kq ON kq."yDinhId" = yd.id AND kq.loai = 'ket-qua'
      WHERE yd.loai = 'y-dinh' AND yd."userId" = ${userId}${locNhaMay} AND yd.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`),
  );
  const so = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const r of rows)
    ra.set(Number(r.id), { nhaCungCap: String(r.nhaCungCap), model: String(r.model), tokenVao: so(r.tokenVao), tokenRa: so(r.tokenRa), chiPhiUocUsd: so(r.chiPhiUocUsd) });
  return ra;
}

/**
 * ★ Đợt 10.4b L2 — dấu nguồn PHIÊN lập trình (`repoWorkspace.luuPhien`, turns do CLIENT ghi): `ngoaiCallIds` client gửi phải MỌI id là lượt
 * của CHÍNH người lưu, ketCuc ok, và băm câu trả lời khớp NGUYÊN VĂN một turn assistant trong `traLoi` ⇒ lệch một id ⇒ ném
 * `NGOAI_KHONG_TON_TAI` "dau-nguon-lech". Không gửi id ⇒ vẫn TỰ DÒ: có turn nào trùng băm lượt ngoài của chính người đó trong 24 h.
 * Trả `true` khi phiên có lượt ngoài (đặt `coLuotNgoai`).
 */
export async function xacMinhPhienCoLuotNgoai(db: DbDauNguon, y: { userId: number; traLoi: readonly string[]; ngoaiCallIds?: readonly number[] | null }): Promise<boolean> {
  const bam = [...new Set(y.traLoi.map((t) => bamCauTraLoi(t)))];
  const ids = [...new Set((y.ngoaiCallIds ?? []).filter((x) => Number.isInteger(x) && x > 0))];
  if (ids.length) {
    const rows = hang(
      await db.execute(sql`
        SELECT yd.id, yd."userId", kq."ketCuc", kq."bamTraLoi"
        FROM ai_external_calls yd JOIN ai_external_calls kq ON kq."yDinhId" = yd.id AND kq.loai = 'ket-qua'
        WHERE yd.loai = 'y-dinh' AND yd.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`),
    );
    const theoId = new Map(rows.map((r) => [Number(r.id), r]));
    for (const id of ids) {
      const r = theoId.get(id);
      if (!r || Number(r.userId) !== y.userId || r.ketCuc !== "ok" || !bam.includes(String(r.bamTraLoi ?? ""))) throw new LoiNgoai("NGOAI_KHONG_TON_TAI", "dau-nguon-lech");
    }
    return true;
  }
  if (!bam.length) return false;
  const [r] = hang(
    await db.execute(sql`
      SELECT 1 AS co FROM ai_external_calls kq
      WHERE kq.loai = 'ket-qua' AND kq."ketCuc" = 'ok' AND kq."userId" = ${y.userId}
        AND kq."taoLuc" > now() - make_interval(hours => ${GIO_TU_DO_DAU_NGUON})
        AND kq."bamTraLoi" IN (${sql.join(bam.map((b) => sql`${b}`), sql`, `)})
      LIMIT 1`),
  );
  return Boolean(r);
}
