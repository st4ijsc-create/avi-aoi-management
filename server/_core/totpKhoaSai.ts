/**
 * SCADA R1a Task 16 (điều phối 2026-10-24, mig 0432, fix round 1) — BỘ ĐẾM XÁC THỰC 2 LỚP SAI THEO NGƯỜI DÙNG.
 *
 *   · `totp`   : 5 lần thử trong 5 phút  ⇒ TOTP của người đó TẠM KHOÁ 5 phút (tính từ lần thử bắt đầu khoá).
 *   · `backup` : 10 lần thử trong 60 phút ⇒ mã dự phòng bị từ chối tới HẾT cửa sổ 60 phút ấy.
 *   Hai bộ đếm ĐỘC LẬP (hai hàng của cùng bảng, PK (user_id, loai)): khoá TOTP KHÔNG BAO GIỜ chặn mã dự phòng (lối thoát của người bị
 *   khoá), và sai mã dự phòng KHÔNG khoá TOTP.
 *
 * Vì sao: từ R1a, mã TOTP canh các lệnh tác động vật lý mức 4–5. Trước bản này mã sai chỉ bị chặn bởi bộ giới hạn chung `/api/`
 * (300 lần/phút/phiên) — và lô tRPC không có `maxBatchSize`, nên MỘT request HTTP mang được hàng trăm lượt đoán.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ FIX ROUND 1 — TÍNH TRƯỚC, KIỂM SAU ("charge before verify")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu ĐỌC khoá → kiểm mã → mới ĐẾM. Mọi lượt đọc thấy "chưa khoá" trước khi lần sai thứ 5 kịp ghi đều được kiểm (probe trên
 * `_test`: 30 mã sai + 1 mã đúng đồng thời ⇒ cả 30 được kiểm, mã đúng `hopLe:true`). Nay:
 *   1. `napLuotThu` = MỘT câu upsert nguyên tử TÍNH lượt thử (+1 theo luật cửa sổ/khoá) và trả trạng thái MỚI. Lượt thứ N đặt khoá
 *      ngay trong câu ấy và ghi `khoa_boi` = mã lượt thử của nó.
 *   2. `duocKiem`: lượt có số > N, hoặc đang khoá mà không phải chính nó đặt khoá ⇒ TỪ CHỐI, không kiểm, không tiêu mã. Postgres
 *      xếp hàng các câu upsert trên cùng hàng ⇒ mỗi cửa sổ có NHIỀU NHẤT N lượt được kiểm, bất kể bao nhiêu lượt đồng thời.
 *   3. Mã sai ⇒ không ghi gì thêm (đã tính). Lượt thứ N sai ⇒ khoá (đã đặt) ở lại + MỘT dòng audit bắt đầu khoá.
 *   4. Mã đúng ⇒ `xoaSauKhiDung`: MỘT câu DELETE chỉ khi không có khoá hiệu lực — hoặc khoá do CHÍNH lượt này đặt (lượt thứ N đúng
 *      được gỡ khoá của mình: 4 sai + 1 đúng không bị khoá). Khoá do lượt KHÁC đặt trong lúc ấy ⇒ `conLaiMs > 0` ⇒ người gọi trả
 *      TẠM KHOÁ (mã đã tiêu — chấp nhận được).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHỐT KHÁC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   · LƯU TRỮ: CHỈ DB. Không RAM, không Redis (hai nguồn có thể lệch nhau).
 *   · MỘT ĐỒNG HỒ: mọi phép so đọc `now()` của Postgres — cùng quyết định với sổ `totp_consumed` (xem `dongHoSo()` ở totpOnce.ts).
 *   · RESET CỬA SỔ (fix round 1, CRITICAL 2): CHỈ khi `(khoa_den IS NULL AND cua_so_bat_dau <= now()-cửa sổ) OR (khoa_den IS NOT NULL
 *     AND khoa_den <= now())`. Một khoá ĐANG hiệu lực không bao giờ bị một lần thử xoá/kéo dài/rút ngắn, dù cửa sổ đã cũ.
 *   · FAIL-CLOSED: mọi hàm ghi/đọc ở đây NÉM khi không hỏi được DB (kể cả `getDb()` = null) ⇒ người gọi từ chối
 *     (`TOTP_KHONG_KIEM_DUOC`). KHÔNG BAO GIỜ rơi về "không giới hạn".
 *   · KHÔNG LỘ ĐẾM: không hàm nào trả "còn N lần" ra ngoài lớp này; người gọi chỉ nhận "đang khoá + còn bao lâu".
 *   · AUDIT (`recordAuditEvent` → `control_audit_log`): ĐÚNG MỘT dòng cho lượt bắt đầu khoá (`<loai>.tam_khoa`); từ chối khi đang
 *     khoá: NHIỀU NHẤT 1 dòng / (người, loại) / phút (`<loai>.tu_choi_dang_khoa`, mang `soLanTuChoiTrongKhoa`) để lô tRPC không xả
 *     ngập sổ hash-chain; admin mở khoá (`totp.mo_khoa`, kèm lý do, CÙNG giao dịch với lượt xoá cả hai hàng). Không bao giờ ghi mã.
 *
 * ⚠ Mọi câu dùng `sql` thô cho mệnh đề WHERE (không `eq()`/`and()`): `server/routers/totpReplay.test.ts` mock `eq`/`and` của
 *   `drizzle-orm` — bài học đã trả giá ở `donSo` (totpOnce.ts). Một mảnh `sql` thô không phụ thuộc file test nào mock gì.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appError, readAppErrorMeta, type AppErrorParams } from "./appError";
import { biet0432Thieu } from "./kiemSchemaR1a";

/** TOTP — số lần thử tối đa trong một cửa sổ; lượt thứ này sai ⇒ khoá. */
export const SO_LAN_SAI_TOI_DA = 5;
/** TOTP — độ dài cửa sổ đếm (ms), tính từ lần thử ĐẦU TIÊN của cửa sổ. */
export const CUA_SO_SAI_MS = 300_000;
/** TOTP — thời gian khoá (ms), tính từ lượt thử bắt đầu khoá. Cũng là giá trị DỰ PHÒNG khi thiếu `conLaiMs` (minor 7). */
export const THOI_GIAN_KHOA_MS = 300_000;
/** Mã dự phòng — số lần thử tối đa trong một cửa sổ. */
export const MA_DU_PHONG_SO_LAN_TOI_DA = 10;
/** Mã dự phòng — cửa sổ 60 phút; khoá kéo tới HẾT cửa sổ ("phần còn lại của giờ ấy"). */
export const MA_DU_PHONG_CUA_SO_MS = 3_600_000;
/** Audit "từ chối khi đang khoá": nhiều nhất một dòng mỗi khoảng này cho mỗi (người, loại). */
export const AUDIT_TU_CHOI_MOI_MS = 60_000;

export type LoaiBoDem = "totp" | "backup";

interface CauHinhBoDem {
  toiDa: number;
  cuaSoMs: number;
  /** `tu_luc_khoa`: khoá = now() + `khoaMs`. `het_cua_so`: khoá = cua_so_bat_dau + cuaSoMs. */
  khoa: { kieu: "tu_luc_khoa"; ms: number } | { kieu: "het_cua_so" };
}

export const CAU_HINH_BO_DEM: Readonly<Record<LoaiBoDem, CauHinhBoDem>> = Object.freeze({
  totp: { toiDa: SO_LAN_SAI_TOI_DA, cuaSoMs: CUA_SO_SAI_MS, khoa: { kieu: "tu_luc_khoa", ms: THOI_GIAN_KHOA_MS } },
  backup: { toiDa: MA_DU_PHONG_SO_LAN_TOI_DA, cuaSoMs: MA_DU_PHONG_CUA_SO_MS, khoa: { kieu: "het_cua_so" } },
});

const TEN_AUDIT: Readonly<Record<LoaiBoDem, { batDau: string; tuChoi: string; nhan: string }>> = Object.freeze({
  totp: { batDau: "totp.tam_khoa", tuChoi: "totp.tu_choi_dang_khoa", nhan: "TOTP" },
  backup: { batDau: "ma_du_phong.tam_khoa", tuChoi: "ma_du_phong.tu_choi_dang_khoa", nhan: "Mã dự phòng" },
});

/** Lỗi của bộ đếm — người gọi đọc là "KHÔNG BIẾT" ⇒ từ chối. */
export class LoiBoDemTotp extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoiBoDemTotp";
  }
}

/**
 * kiem-dinh P1-6 — câu nguyên nhân cho log khi bộ đếm hỏng (⇒ `TOTP_KHONG_KIEM_DUOC`): lỗi postgres 42P01 (bảng không tồn tại) / 42703 (cột
 * không tồn tại) ở bất kỳ tầng `cause` nào, hoặc tiến trình đã thấy thiếu 0432 lúc khởi động (`kiemSchemaR1a`) ⇒ gọi đích danh
 * "thiếu migration 0432". Lỗi khác ⇒ chỉ thông điệp gốc. UI giữ câu chung ("lỗi hệ thống").
 */
export function nguyenNhanBoDemHong(e: unknown): string {
  const goc = (e as Error)?.message ?? String(e);
  let thieuBang = false;
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (code === "42P01" || code === "42703") thieuBang = true;
  }
  return thieuBang || biet0432Thieu()
    ? `${goc} — NGUYÊN NHÂN: thiếu migration 0432 (bảng totp_khoa_sai / cột loai): chạy scripts/apply-migration-0432.mjs`
    : goc;
}

async function layDbBatBuoc() {
  const { getDb } = await import("../db/connection");
  const db = await getDb();
  if (!db) throw new LoiBoDemTotp("Không có kết nối DB ⇒ bộ đếm xác thực 2 lớp sai không hỏi được.");
  return db;
}

async function bang() {
  return (await import("../../drizzle/schema/auth")).totpKhoaSai;
}

function boc(e: unknown, viec: string): LoiBoDemTotp {
  if (e instanceof LoiBoDemTotp) return e;
  return new LoiBoDemTotp(`${viec} hỏng: ${(e as Error)?.message ?? String(e)}`, { cause: e });
}

/** `khoa_den − now()` theo ms, ≥ 0; 0 khi không khoá. Chỉ dùng trong câu có bảng `totp_khoa_sai`. */
function conLaiMsSql(t: Awaited<ReturnType<typeof bang>>) {
  return sql<number>`(CASE WHEN ${t.khoaDen} IS NULL OR ${t.khoaDen} <= now() THEN 0
    ELSE CEIL(EXTRACT(EPOCH FROM (${t.khoaDen} - now())) * 1000) END)::int`.mapWith(Number);
}

/** Mệnh đề WHERE của một (người, loại). */
function cuaNguoi(t: Awaited<ReturnType<typeof bang>>, userId: number, loai: LoaiBoDem) {
  return sql`${t.userId} = ${userId} AND ${t.loai} = ${loai}`;
}

/** Mã của MỘT lượt thử (uuid) — ghi vào `khoa_boi` nếu lượt này đặt khoá. Không phải dấu `luot` của sổ chống phát lại. */
export function maLuotThuMoi(): string {
  return randomUUID();
}

export interface KetQuaNapLuot {
  /** Số lượt đã tính trong cửa sổ SAU câu ghi — CHỈ dùng nội bộ (`duocKiem`), không bao giờ ra ngoài. */
  readonly soLan: number;
  /** Khoá còn bao lâu sau câu ghi (0 = không khoá). */
  readonly conLaiMs: number;
  /** Chính lượt này vừa đặt khoá (lượt thứ N). */
  readonly vuaKhoa: boolean;
}

/**
 * BƯỚC 1 — TÍNH một lượt thử TRƯỚC khi kiểm mã: MỘT câu upsert nguyên tử (`ON CONFLICT DO UPDATE` khoá hàng ⇒ các lượt đồng thời
 * xếp hàng, mỗi lượt thấy một số khác nhau):
 *   · chưa có hàng ⇒ `so_lan_sai = 1`, `cua_so_bat_dau = now()`;
 *   · RESET (không khoá + cửa sổ quá hạn, hoặc khoá đã hết) ⇒ `so_lan_sai = 1`, cửa sổ mới, xoá khoá + bộ đếm từ chối;
 *   · còn lại ⇒ `so_lan_sai + 1`; vừa chạm N mà chưa khoá ⇒ đặt `khoa_den` + `khoa_boi = luotThu`. Khoá đang hiệu lực giữ nguyên.
 * Ném `LoiBoDemTotp` khi không ghi được.
 */
export async function napLuotThu(userId: number, loai: LoaiBoDem, luotThu: string): Promise<KetQuaNapLuot> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const ch = CAU_HINH_BO_DEM[loai];
    const cuaSoGiay = ch.cuaSoMs / 1000;
    // Khoá MỚI tính từ mốc cửa sổ `cuaSo` (sql) — theo kiểu của loại.
    const khoaTu = (cuaSo: ReturnType<typeof sql>) =>
      ch.khoa.kieu === "tu_luc_khoa"
        ? sql`(now() + make_interval(secs => ${ch.khoa.ms / 1000}))`
        : sql`(${cuaSo} + make_interval(secs => ${cuaSoGiay}))`;
    // ⚠ `${t.<cot>}` trong nhánh DO UPDATE render thành `"totp_khoa_sai"."<cot>"` = hàng ĐANG CÓ (cùng quy ước với totp_consumed).
    const reset = sql`((${t.khoaDen} IS NULL AND ${t.cuaSoBatDau} <= now() - make_interval(secs => ${cuaSoGiay}))
      OR (${t.khoaDen} IS NOT NULL AND ${t.khoaDen} <= now()))`;
    const datKhoaGio = sql`(${t.khoaDen} IS NULL AND ${t.soLanSai} + 1 >= ${ch.toiDa})`;
    const motLaDu = ch.toiDa <= 1; // lượt ĐẦU đã chạm ngưỡng (không phải hôm nay) — hằng số là nguồn sự thật duy nhất
    const rows = await db
      .insert(t)
      .values({
        userId,
        loai,
        soLanSai: 1,
        cuaSoBatDau: sql`now()`,
        khoaDen: motLaDu ? khoaTu(sql`now()`) : null,
        khoaBoi: motLaDu ? luotThu : null,
        tuChoiDem: 0,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [t.userId, t.loai],
        set: {
          soLanSai: sql`CASE WHEN ${reset} THEN 1 ELSE ${t.soLanSai} + 1 END`,
          cuaSoBatDau: sql`CASE WHEN ${reset} THEN now() ELSE ${t.cuaSoBatDau} END`,
          khoaDen: sql`CASE
            WHEN ${reset} THEN ${motLaDu ? khoaTu(sql`now()`) : sql`NULL`}
            WHEN ${datKhoaGio} THEN ${khoaTu(sql`${t.cuaSoBatDau}`)}
            ELSE ${t.khoaDen} END`,
          khoaBoi: sql`CASE
            WHEN ${reset} THEN ${motLaDu ? sql`${luotThu}` : sql`NULL`}
            WHEN ${datKhoaGio} THEN ${luotThu}
            ELSE ${t.khoaBoi} END`,
          tuChoiDem: sql`CASE WHEN ${reset} THEN 0 ELSE ${t.tuChoiDem} END`,
          tuChoiAuditLuc: sql`CASE WHEN ${reset} THEN NULL ELSE ${t.tuChoiAuditLuc} END`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        soLan: t.soLanSai,
        conLaiMs: conLaiMsSql(t),
        vuaKhoa: sql<boolean>`(${t.khoaBoi} IS NOT NULL AND ${t.khoaBoi} = ${luotThu} AND ${t.khoaDen} > now())`,
      });
    const r = rows[0];
    if (!r) throw new LoiBoDemTotp("Upsert bộ đếm không trả hàng.");
    return { soLan: Number(r.soLan), conLaiMs: Math.max(0, Number(r.conLaiMs ?? 0)), vuaKhoa: r.vuaKhoa === true };
  } catch (e) {
    throw boc(e, `Tính lượt thử (${loai})`);
  }
}

/**
 * BƯỚC 2 — lượt đã tính có được KIỂM mã không? Có ⇔ số lượt ≤ N **và** (không khoá **hoặc** chính lượt này đặt khoá).
 * Không ⇒ người gọi từ chối `TẠM KHOÁ` mà không kiểm, không tiêu mã.
 */
export function duocKiem(r: KetQuaNapLuot, loai: LoaiBoDem): boolean {
  if (r.soLan > CAU_HINH_BO_DEM[loai].toiDa) return false;
  return r.conLaiMs <= 0 || r.vuaKhoa;
}

/**
 * BƯỚC 4 — mã ĐÚNG ⇒ xoá hàng, MỘT câu: chỉ khi không có khoá hiệu lực hoặc khoá do CHÍNH lượt này đặt. Không xoá được ⇒ đọc lại:
 * còn khoá (do lượt khác đặt trong lúc kiểm) ⇒ trả `conLaiMs > 0`; hàng đã biến mất (lượt đúng khác / admin) ⇒ 0.
 * Ném `LoiBoDemTotp` khi không ghi/đọc được.
 */
export async function xoaSauKhiDung(userId: number, loai: LoaiBoDem, luotThu: string): Promise<{ conLaiMs: number }> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const xoa = await db
      .delete(t)
      .where(sql`${cuaNguoi(t, userId, loai)} AND (${t.khoaDen} IS NULL OR ${t.khoaDen} <= now() OR ${t.khoaBoi} = ${luotThu})`)
      .returning({ userId: t.userId });
    if (xoa.length > 0) return { conLaiMs: 0 };
    const con = await db.select({ conLaiMs: conLaiMsSql(t) }).from(t).where(cuaNguoi(t, userId, loai));
    return { conLaiMs: Math.max(0, Number(con[0]?.conLaiMs ?? 0)) };
  } catch (e) {
    throw boc(e, `Xoá bộ đếm sau mã đúng (${loai})`);
  }
}

/** Chỉ dùng trong lưới / admin: đọc khoá hiện tại (không tính lượt). */
export async function docKhoa(userId: number, loai: LoaiBoDem): Promise<{ conLaiMs: number }> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const rows = await db.select({ conLaiMs: conLaiMsSql(t) }).from(t).where(cuaNguoi(t, userId, loai));
    return { conLaiMs: Math.max(0, Number(rows[0]?.conLaiMs ?? 0)) };
  } catch (e) {
    throw boc(e, `Đọc khoá (${loai})`);
  }
}

/**
 * Audit lượt BẮT ĐẦU khoá (lượt thứ N đã được kiểm và SAI). Gọi đúng một lần mỗi khoá — chỉ lượt có `vuaKhoa`.
 * KHÔNG ném: lượt đã bị từ chối nên audit hỏng không đổi được phán quyết — nhưng KÊU TO. Không bao giờ nhận/ghi mã.
 */
export async function ghiAuditBatDauKhoa(
  userId: number,
  loai: LoaiBoDem,
  thongTin: { conLaiMs: number; nguyenNhan?: "ma_sai" | "phat_lai" },
): Promise<void> {
  const ch = CAU_HINH_BO_DEM[loai];
  try {
    const db = await layDbBatBuoc();
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    await recordAuditEvent(db, {
      entityType: "user",
      entityId: userId,
      action: TEN_AUDIT[loai].batDau,
      actorId: userId,
      after: {
        loai,
        conLaiMs: thongTin.conLaiMs,
        soLanToiDa: ch.toiDa,
        cuaSoMs: ch.cuaSoMs,
        ...(thongTin.nguyenNhan ? { nguyenNhan: thongTin.nguyenNhan } : {}),
      },
      reason: `${TEN_AUDIT[loai].nhan} tạm khoá: ${ch.toiDa} lần thử trong ${ch.cuaSoMs / 60_000} phút`,
    });
  } catch (e) {
    console.error(
      `[TotpKhoaSai] KHÔNG ghi được audit ${TEN_AUDIT[loai].batDau} cho user ${userId} (${(e as Error)?.message ?? String(e)}). ` +
        `Lượt xác minh vẫn bị TỪ CHỐI; kiểm bảng control_audit_log.`,
    );
  }
}

/**
 * Ghi nhận một lượt bị TỪ CHỐI vì đang khoá (minor 5): MỘT câu UPDATE cộng `tu_choi_dem` và — nếu dòng audit cuối đã quá
 * `AUDIT_TU_CHOI_MOI_MS` — dời mốc audit về `now()`. Chỉ lượt dời được mốc mới ghi một dòng audit, mang số lần bị từ chối TRONG lần
 * khoá này (cộng dồn) ⇒ nhiều nhất 1 dòng / (người, loại) / phút dù lô tRPC gửi hàng trăm lượt. KHÔNG ném (đã từ chối rồi).
 */
export async function ghiTuChoiDangKhoa(userId: number, loai: LoaiBoDem, conLaiMs: number): Promise<void> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const giay = AUDIT_TU_CHOI_MOI_MS / 1000;
    const den = sql`(${t.tuChoiAuditLuc} IS NULL OR ${t.tuChoiAuditLuc} <= now() - make_interval(secs => ${giay}))`;
    const rows = await db
      .update(t)
      .set({
        tuChoiDem: sql`${t.tuChoiDem} + 1`,
        tuChoiAuditLuc: sql`CASE WHEN ${den} THEN now() ELSE ${t.tuChoiAuditLuc} END`,
      })
      .where(cuaNguoi(t, userId, loai))
      .returning({ dem: t.tuChoiDem, phaiGhi: sql<boolean>`(${t.tuChoiAuditLuc} = now())` });
    const r = rows[0];
    if (!r || r.phaiGhi !== true) return;
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    await recordAuditEvent(db, {
      entityType: "user",
      entityId: userId,
      action: TEN_AUDIT[loai].tuChoi,
      actorId: userId,
      after: { loai, conLaiMs, soLanTuChoiTrongKhoa: Number(r.dem), gopMoiMs: AUDIT_TU_CHOI_MOI_MS },
      reason: `Từ chối ${TEN_AUDIT[loai].nhan}: đang tạm khoá do nhập sai nhiều lần (tối đa 1 dòng/phút, số lần mang trong after)`,
    });
  } catch (e) {
    console.error(
      `[TotpKhoaSai] KHÔNG ghi được audit ${TEN_AUDIT[loai].tuChoi} cho user ${userId} (${(e as Error)?.message ?? String(e)}). ` +
        `Lượt xác minh vẫn bị TỪ CHỐI.`,
    );
  }
}

/**
 * Admin mở khoá: xoá CẢ HAI hàng (`totp` + `backup`) của `userId` + một dòng audit `totp.mo_khoa` (kèm `lyDo`) trong CÙNG giao dịch
 * — audit hỏng ⇒ lượt xoá hoàn tác. Trả `daMoKhoa` = có hàng nào bị xoá (không lộ đếm).
 */
export async function moKhoaTotpCuaNguoiDung(args: { userId: number; actorId: number; lyDo: string }): Promise<{ daMoKhoa: boolean }> {
  const db = await layDbBatBuoc();
  const t = await bang();
  const { recordAuditEvent } = await import("../services/audit/controlAuditService");
  return db.transaction(async (tx) => {
    const xoa = await tx
      .delete(t)
      .where(sql`${t.userId} = ${args.userId}`)
      .returning({ loai: t.loai, dangKhoa: sql<boolean>`(${t.khoaDen} IS NOT NULL AND ${t.khoaDen} > now())` });
    const truoc = Object.fromEntries(xoa.map((x) => [x.loai, { dangKhoa: !!x.dangKhoa }]));
    await recordAuditEvent(tx, {
      entityType: "user",
      entityId: args.userId,
      action: "totp.mo_khoa",
      actorId: args.actorId,
      before: { boDem: truoc },
      after: { boDem: {} },
      reason: args.lyDo,
    });
    return { daMoKhoa: xoa.length > 0 };
  });
}

/** Số phút còn lại để HIỂN THỊ (làm tròn LÊN, tối thiểu 1). Thiếu/không hợp lệ ⇒ `THOI_GIAN_KHOA_MS` (minor 7: một dự phòng). */
export function phutConLai(conLaiMs?: number | null): number {
  const ms = typeof conLaiMs === "number" && Number.isFinite(conLaiMs) && conLaiMs > 0 ? conLaiMs : THOI_GIAN_KHOA_MS;
  return Math.max(1, Math.ceil(ms / 60_000));
}

type KetQuaCoMa = { ma?: "TOTP_TAM_KHOA" | "TOTP_KHONG_KIEM_DUOC"; conLaiMs?: number };

/**
 * Kết quả của `verifyTotpOnce`/`verifyFreshTotp` ⇒ lỗi tRPC có mã riêng cho người gọi, hoặc `null` (kết quả thường: mã sai/phát lại
 * vẫn đi đường lỗi CŨ của từng người gọi). `them` = tham số thêm của người gọi (vd. `{ ma, level }` của SCADA).
 *   · `TOTP_TAM_KHOA`        ⇒ TOO_MANY_REQUESTS, params `{ remainingMinutes }` (KHÔNG có số lần sai);
 *   · `TOTP_KHONG_KIEM_DUOC` ⇒ SERVICE_UNAVAILABLE, không params riêng.
 */
export function loiTotpKhoa(kq: KetQuaCoMa, them?: AppErrorParams) {
  if (kq.ma === "TOTP_TAM_KHOA") {
    const phut = phutConLai(kq.conLaiMs);
    return appError(
      "TOO_MANY_REQUESTS",
      "TOTP_TAM_KHOA",
      { ...(them ?? {}), remainingMinutes: phut },
      `Xác thực hai lớp đang tạm khoá do nhập sai nhiều lần — thử lại sau ${phut} phút.`,
    );
  }
  if (kq.ma === "TOTP_KHONG_KIEM_DUOC") return loiKhongKiemDuoc(them);
  return null;
}

function loiKhongKiemDuoc(them?: AppErrorParams) {
  return appError(
    "SERVICE_UNAVAILABLE",
    "TOTP_KHONG_KIEM_DUOC",
    them,
    "Không kiểm được mã xác thực hai lớp lúc này (lỗi hệ thống) — thử lại sau.",
  );
}

/**
 * Dạng dùng tại chỗ cho các thủ tục tRPC: `kiemKhoaTotp(await verifyTotpOnce({…})).hopLe` — NÉM `loiTotpKhoa(kq)` khi bộ đếm từ
 * chối, không thì trả nguyên `kq`.
 * ⚠ Hình dạng `f(await verifyTotpOnce(…)).hopLe` là CỐ Ý: lưới AST `hoTuyenSongSong` (hoXacThucScan.phepKiemTrong) nhận ra
 *   `dung:verifyTotpOnce` qua lời gọi lồng, và bỏ qua `f` vì nó là một mắt chuỗi (`.hopLe`) — nên hai tuyến song song dùng cùng
 *   hình dạng thì chữ ký phép kiểm của chúng KHÔNG đổi so với trước Task 16.
 */
export function kiemKhoaTotp<T extends KetQuaCoMa>(kq: T): T {
  const loi = loiTotpKhoa(kq);
  if (loi) throw loi;
  return kq;
}

/** Mã dự phòng đang tạm khoá ⇒ TOO_MANY_REQUESTS `MA_DU_PHONG_TAM_KHOA { remainingMinutes }` (không số lần). */
export function loiMaDuPhongTamKhoa(conLaiMs?: number) {
  const phut = phutConLai(conLaiMs);
  return appError(
    "TOO_MANY_REQUESTS",
    "MA_DU_PHONG_TAM_KHOA",
    { remainingMinutes: phut },
    `Mã dự phòng đang tạm khoá do nhập sai nhiều lần — thử lại sau ${phut} phút.`,
  );
}

/** Lỗi của bộ đếm ở đường mã dự phòng là `MA_DU_PHONG_TAM_KHOA` / `TOTP_KHONG_KIEM_DUOC`? (cho đường REST đăng nhập.) */
export function laLoiBoDemMaDuPhong(e: unknown): { ma: "MA_DU_PHONG_TAM_KHOA"; remainingMinutes: number } | { ma: "TOTP_KHONG_KIEM_DUOC" } | null {
  const m = readAppErrorMeta(e);
  if (m?.appCode === "MA_DU_PHONG_TAM_KHOA") return { ma: "MA_DU_PHONG_TAM_KHOA", remainingMinutes: Number(m.appParams?.remainingMinutes ?? phutConLai()) };
  if (m?.appCode === "TOTP_KHONG_KIEM_DUOC") return { ma: "TOTP_KHONG_KIEM_DUOC" };
  return null;
}

/**
 * Bọc phép đối chiếu MÃ DỰ PHÒNG bằng bộ đếm `backup` — tính TRƯỚC, kiểm SAU, cùng luật với TOTP. Dùng bởi `db.verifyBackupCode`
 * (người tiêu duy nhất), nên mọi bên gọi (đăng nhập REST, `twoFactor.disable`/`verify`) dùng chung.
 *   · bị từ chối (quá N / đang khoá) ⇒ NÉM `MA_DU_PHONG_TAM_KHOA` (không đối chiếu, không tiêu mã);
 *   · bộ đếm hỏng ⇒ NÉM `TOTP_KHONG_KIEM_DUOC` (fail-closed);
 *   · `kiem()` sai ⇒ `false` — lượt thứ N sai thì NÉM `MA_DU_PHONG_TAM_KHOA` + một dòng audit bắt đầu khoá;
 *   · `kiem()` đúng (đã tiêu mã) ⇒ xoá hàng; khoá do lượt khác đặt trong lúc ấy ⇒ NÉM `MA_DU_PHONG_TAM_KHOA`.
 * ⚠ KHÔNG đọc/chạm hàng `totp`: khoá TOTP không bao giờ chặn mã dự phòng.
 */
export async function kiemMaDuPhongCoBoDem(userId: number, kiem: () => Promise<boolean>): Promise<boolean> {
  const luotThu = maLuotThuMoi();
  let nap: KetQuaNapLuot;
  try {
    nap = await napLuotThu(userId, "backup", luotThu);
  } catch (e) {
    console.error(`[TotpKhoaSai] bộ đếm MÃ DỰ PHÒNG không ghi được (${nguyenNhanBoDemHong(e)}) ⇒ TỪ CHỐI (fail-closed).`);
    throw loiKhongKiemDuoc();
  }
  if (!duocKiem(nap, "backup")) {
    await ghiTuChoiDangKhoa(userId, "backup", nap.conLaiMs);
    throw loiMaDuPhongTamKhoa(nap.conLaiMs);
  }
  const dung = await kiem();
  if (!dung) {
    if (nap.vuaKhoa) {
      await ghiAuditBatDauKhoa(userId, "backup", { conLaiMs: nap.conLaiMs, nguyenNhan: "ma_sai" });
      throw loiMaDuPhongTamKhoa(nap.conLaiMs);
    }
    return false;
  }
  let xoa: { conLaiMs: number };
  try {
    xoa = await xoaSauKhiDung(userId, "backup", luotThu);
  } catch (e) {
    console.error(`[TotpKhoaSai] bộ đếm MÃ DỰ PHÒNG không xoá được sau mã đúng (${nguyenNhanBoDemHong(e)}) ⇒ TỪ CHỐI.`);
    throw loiKhongKiemDuoc();
  }
  if (xoa.conLaiMs > 0) throw loiMaDuPhongTamKhoa(xoa.conLaiMs);
  return true;
}
