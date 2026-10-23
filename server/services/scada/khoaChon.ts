/**
 * SCADA R1a Task 6 (K6) - khoa chon (adapter, kenh) cho MOT nguoi, theo DB (`scada_khoa_chon`, PK (adapter_id, tag_key)).
 *
 * Muc dich: hai nguoi khong lenh cung mot kenh cung luc. `request()` (Task 8) giu khoa, `confirm()` (Task 9) kiem `conGiuKhoa`
 * roi nha; khoa het han CUNG luc voi TTL 60 s cua yeu cau (D4): `hetHanLuc` do nguoi goi truyen vao, la cung gia tri ghi vao yeu cau.
 *
 * QUYET DINH
 *  1. DONG HO: mot nguon duy nhat la DONG HO UNG DUNG. `now` la tham so (test xac dinh); khong truyen thi `new Date()` cua tien trinh.
 *     Khong bao gio dung `now()` cua DB, vi `expires_at` cung ghi tu dong ho ung dung (`hetHanLuc`); tron hai dong ho (lech dong ho
 *     app/DB) se lam khoa het han som/muon so voi yeu cau cung TTL. `now` di vao SQL nhu tham so da ep `::timestamptz`.
 *  2. NGUYEN TU: giu khoa la MOT cau lenh `INSERT … ON CONFLICT (adapter_id, tag_key) DO UPDATE … WHERE (het han HOAC cung nguoi)
 *     RETURNING`. Hai giao dich dua nhau tren cung mot khoa: PG lam giao dich thu hai CHO den khi giao dich thu nhat ket thuc, roi
 *     danh gia lai `WHERE` tren hang moi nhat da commit => khong co khoang "doc roi ghi" cho hai nguoi cung thang.
 *  3. DUA o nhanh THUA: sau khi upsert khong tra hang, ta DOC nguoi giu hien tai de bao. Giua hai cau lenh hang co the da het han,
 *     bi nha (`nhaKhoaChon`), hoac doi sang chinh nguoi goi. Khi do KHONG bao nguoi giu nao: thu lai upsert (toi da 3 lan tong cong).
 *     Chi tra `DANG_DUOC_CHON` khi vua DOC THAY mot hang CON HAN cua nguoi KHAC. Het luot ma van khong chot duoc (rat hiem: hang
 *     lien tuc bien doi) thi NEM LOI (fail-closed) thay vi bia nguoi giu. Doc nguoi giu nam trong cung `tx`/ket noi cua nguoi goi.
 */
import { and, eq, sql } from "drizzle-orm";
import { scadaKhoaChon } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** db drizzle da resolve HOAC mot transaction cua no (cung khuon `StopPinDb` o stopPin.ts). */
export type KhoaChonDb = Db | Tx;

export type KetQuaKhoa = { ok: true } | { ok: false; ma: "DANG_DUOC_CHON"; boiUserId: number; hetHanLuc: Date };

export type KhoaChonKey = { adapterId: number; tagKey: string };

/** So lan thu giu khoa toi da (1 lan dau + thu lai khi nguoi giu vua bien mat/het han giua upsert va doc). */
const SO_LAN_THU = 3;

const iso = (d: Date) => d.toISOString();

export async function giuKhoaChon(
  tx: KhoaChonDb,
  a: KhoaChonKey & { userId: number; requestId: string; hetHanLuc: Date },
  now: Date = new Date(),
): Promise<KetQuaKhoa> {
  const nowSql = sql`${iso(now)}::timestamptz`;
  for (let lan = 0; lan < SO_LAN_THU; lan++) {
    const duoc = await tx
      .insert(scadaKhoaChon)
      .values({ adapterId: a.adapterId, tagKey: a.tagKey, userId: a.userId, requestId: a.requestId, expiresAt: a.hetHanLuc })
      .onConflictDoUpdate({
        target: [scadaKhoaChon.adapterId, scadaKhoaChon.tagKey],
        set: { userId: a.userId, requestId: a.requestId, expiresAt: a.hetHanLuc },
        setWhere: sql`${scadaKhoaChon.expiresAt} <= ${nowSql} OR ${scadaKhoaChon.userId} = ${a.userId}`,
      })
      .returning({ adapterId: scadaKhoaChon.adapterId });
    if (duoc.length > 0) return { ok: true };

    const [giu] = await tx
      .select({ userId: scadaKhoaChon.userId, expiresAt: scadaKhoaChon.expiresAt })
      .from(scadaKhoaChon)
      .where(and(eq(scadaKhoaChon.adapterId, a.adapterId), eq(scadaKhoaChon.tagKey, a.tagKey)))
      .limit(1);
    // Chi bao khi THAY mot nguoi giu that su: khac nguoi goi va chua het han theo CUNG dong ho `now`.
    if (giu && giu.userId !== a.userId && giu.expiresAt.getTime() > now.getTime()) {
      return { ok: false, ma: "DANG_DUOC_CHON", boiUserId: giu.userId, hetHanLuc: giu.expiresAt };
    }
    // Hang vua het han / vua bi nha / vua thanh cua chinh ta: thu lai upsert.
  }
  throw new LoiKhoaChonTranhChap(`khoaChon: khong chot duoc khoa (${a.adapterId}, ${a.tagKey}) sau ${SO_LAN_THU} lan - hang bien doi lien tuc`);
}

/**
 * R1a Task 8 — lop co ma cho lan nem "het luot thu" o tren (message GIU NGUYEN VAN). `lenhHmi.yeuCauGhiTag` bat dung lop nay => dong
 * attempts KHOA_CHON_LOI + appError co ma (khong 500 tho); moi loi khac (DB …) van di tiep nhu loi ha tang.
 */
export class LoiKhoaChonTranhChap extends Error {
  readonly code = "KHOA_CHON_TRANH_CHAP" as const;
  constructor(message: string) {
    super(message);
    this.name = "LoiKhoaChonTranhChap";
  }
}

/** Nha khoa CHI KHI `request_id` con khop (yeu cau cu khong xoa khoa cua yeu cau moi cung nguoi). Khong co hang => khong lam gi. */
export async function nhaKhoaChon(tx: KhoaChonDb, a: KhoaChonKey & { requestId: string }): Promise<void> {
  await tx
    .delete(scadaKhoaChon)
    .where(and(eq(scadaKhoaChon.adapterId, a.adapterId), eq(scadaKhoaChon.tagKey, a.tagKey), eq(scadaKhoaChon.requestId, a.requestId)));
}

/** true CHI KHI hang khop `user_id` VA `request_id` VA `expires_at > now` (het han dung bang `now` => het). */
export async function conGiuKhoa(
  tx: KhoaChonDb,
  a: KhoaChonKey & { userId: number; requestId: string },
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await tx
    .select({ adapterId: scadaKhoaChon.adapterId })
    .from(scadaKhoaChon)
    .where(
      and(
        eq(scadaKhoaChon.adapterId, a.adapterId),
        eq(scadaKhoaChon.tagKey, a.tagKey),
        eq(scadaKhoaChon.userId, a.userId),
        eq(scadaKhoaChon.requestId, a.requestId),
        sql`${scadaKhoaChon.expiresAt} > ${iso(now)}::timestamptz`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
