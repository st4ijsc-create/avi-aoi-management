/**
 * SCADA R1a Task 16 (điều phối 2026-10-24, mig 0432) — BỘ ĐẾM TOTP SAI THEO NGƯỜI DÙNG.
 *
 *   5 lần sai trong 5 phút ⇒ TOTP của người đó TẠM KHOÁ 5 phút. Đang khoá ⇒ MỌI lượt xác minh TOTP của người đó bị từ chối
 *   (kể cả mã ĐÚNG), mã không được kiểm và không bị tiêu.
 *
 * Vì sao: từ R1a, mã TOTP canh các lệnh tác động vật lý mức 4–5. Trước bản này mã sai chỉ bị chặn bởi bộ giới hạn chung `/api/`
 * (300 lần/phút/phiên) ⇒ không gian 10⁶ mã bị dò với tốc độ ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHỐT (brief Task 16 + điều phối)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   · NƠI ĐẶT: gọi từ `verifyTotpOnce` (totpOnce.ts) — chủ duy nhất của phép xác minh TOTP ⇒ đăng nhập 2FA, bật/tắt 2FA, step-up
 *     deploy/actuation, SCADA, CLI edge đều dùng chung một bộ đếm. File này KHÔNG gọi `speakeasy`.
 *   · LƯU TRỮ: CHỈ DB (`totp_khoa_sai`). Không RAM, không Redis (hai nguồn có thể lệch nhau). Upsert một câu ⇒ nguyên tử qua nhiều
 *     tiến trình và sống qua restart.
 *   · MỘT ĐỒNG HỒ: mọi phép so đọc `now()` của Postgres — cùng quyết định với sổ `totp_consumed` từ Pha 9 (hai đồng hồ dưới một bất
 *     biến là lớp lỗi đã trả giá). `nowMs` của người gọi không chạm được bộ đếm.
 *   · FAIL-CLOSED: mọi hàm ở đây NÉM khi không hỏi/ghi được DB (kể cả `getDb()` = null). `verifyTotpOnce` đọc lỗi ấy thành
 *     `TOTP_KHONG_KIEM_DUOC` — KHÔNG BAO GIỜ rơi về "không giới hạn".
 *   · KHÔNG LỘ ĐẾM: không hàm nào trả "còn N lần" ra ngoài lớp này; người gọi chỉ nhận "đang khoá + còn bao lâu".
 *   · AUDIT (`recordAuditEvent` → `control_audit_log`, WORM/hash-chain khi SEC_PLATFORM bật): lần sai THỨ 5 (`totp.tam_khoa`) và
 *     mỗi lần bị từ chối vì đang khoá (`totp.tu_choi_dang_khoa`); admin mở khoá (`totp.mo_khoa`, kèm lý do, CÙNG giao dịch với lượt
 *     xoá). Không bao giờ ghi mã.
 *
 * ⚠ Mọi câu dùng `sql` thô cho mệnh đề WHERE (không `eq()`/`and()`): `server/routers/totpReplay.test.ts` mock `eq`/`and` của
 *   `drizzle-orm` — bài học đã trả giá ở `donSo` (totpOnce.ts). Một mảnh `sql` thô không phụ thuộc file test nào mock gì.
 */
import { sql } from "drizzle-orm";
import { appError, type AppErrorParams } from "./appError";

/** Số lần sai tối đa trong một cửa sổ; đạt số này ⇒ khoá. */
export const SO_LAN_SAI_TOI_DA = 5;
/** Độ dài cửa sổ đếm (ms), tính từ lần sai ĐẦU TIÊN của cửa sổ. */
export const CUA_SO_SAI_MS = 300_000;
/** Thời gian khoá (ms), tính từ lần sai thứ `SO_LAN_SAI_TOI_DA`. */
export const THOI_GIAN_KHOA_MS = 300_000;

/** Lỗi của bộ đếm — người gọi (verifyTotpOnce) đọc là "KHÔNG BIẾT" ⇒ từ chối. */
export class LoiBoDemTotp extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoiBoDemTotp";
  }
}

async function layDbBatBuoc() {
  const { getDb } = await import("../db/connection");
  const db = await getDb();
  if (!db) throw new LoiBoDemTotp("Không có kết nối DB ⇒ bộ đếm TOTP sai không hỏi được.");
  return db;
}

async function bang() {
  return (await import("../../drizzle/schema/auth")).totpKhoaSai;
}

/** `khoa_den − now()` theo ms, ≥ 0; 0 khi không khoá. Chỉ dùng trong câu có bảng `totp_khoa_sai`. */
function conLaiMsSql(t: Awaited<ReturnType<typeof bang>>) {
  return sql<number>`(CASE WHEN ${t.khoaDen} IS NULL OR ${t.khoaDen} <= now() THEN 0
    ELSE CEIL(EXTRACT(EPOCH FROM (${t.khoaDen} - now())) * 1000) END)::int`.mapWith(Number);
}

/**
 * BƯỚC 1 — đọc khoá của `userId`. `conLaiMs > 0` ⇔ đang khoá. Ném `LoiBoDemTotp` khi không đọc được.
 */
export async function docKhoaTotp(userId: number): Promise<{ conLaiMs: number }> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const rows = await db
      .select({ conLaiMs: conLaiMsSql(t) })
      .from(t)
      .where(sql`${t.userId} = ${userId}`);
    return { conLaiMs: Math.max(0, Number(rows[0]?.conLaiMs ?? 0)) };
  } catch (e) {
    if (e instanceof LoiBoDemTotp) throw e;
    throw new LoiBoDemTotp(`Đọc bộ đếm TOTP sai hỏng: ${(e as Error)?.message ?? String(e)}`, { cause: e });
  }
}

/**
 * BƯỚC 3 — ghi MỘT lần sai, MỘT câu upsert nguyên tử (`ON CONFLICT DO UPDATE` khoá hàng ⇒ hai lượt đồng thời xếp hàng, đếm đúng 2):
 *   · chưa có hàng ⇒ `so_lan_sai = 1`, `cua_so_bat_dau = now()`;
 *   · cửa sổ đã quá `CUA_SO_SAI_MS` (hoặc khoá cũ đã hết) ⇒ RESET: `so_lan_sai = 1`, `cua_so_bat_dau = now()`, `khoa_den = NULL`;
 *   · còn trong cửa sổ ⇒ `so_lan_sai + 1`; vừa đạt `SO_LAN_SAI_TOI_DA` mà chưa khoá ⇒ `khoa_den = now() + THOI_GIAN_KHOA_MS`.
 *   ⚠ Một khoá ĐANG hiệu lực không bao giờ bị kéo dài hay rút ngắn ở đây (lượt lọt qua bước 1 trước khi khoá đặt xong chỉ cộng đếm).
 * Trả `soLanSai` SAU câu ghi (chỉ dùng NỘI BỘ để biết đúng lượt nào bắt đầu khoá — không bao giờ ra ngoài) và `conLaiMs`.
 */
export async function ghiLanSaiTotp(userId: number): Promise<{ soLanSai: number; conLaiMs: number }> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    const cuaSoGiay = CUA_SO_SAI_MS / 1000;
    const khoaGiay = THOI_GIAN_KHOA_MS / 1000;
    // ⚠ `${t.<cot>}` trong nhánh DO UPDATE render thành `"totp_khoa_sai"."<cot>"` = hàng ĐANG CÓ (cùng quy ước với totp_consumed).
    const reset = sql`(${t.cuaSoBatDau} <= now() - make_interval(secs => ${cuaSoGiay})
      OR (${t.khoaDen} IS NOT NULL AND ${t.khoaDen} <= now()))`;
    const rows = await db
      .insert(t)
      .values({
        userId,
        soLanSai: 1,
        cuaSoBatDau: sql`now()`,
        // Lần sai đầu tiên chỉ khoá nếu ngưỡng là 1 (không phải hôm nay) — viết ra để hằng số là nguồn sự thật duy nhất.
        khoaDen: SO_LAN_SAI_TOI_DA <= 1 ? sql`now() + make_interval(secs => ${khoaGiay})` : null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: t.userId,
        set: {
          soLanSai: sql`CASE WHEN ${reset} THEN 1 ELSE ${t.soLanSai} + 1 END`,
          cuaSoBatDau: sql`CASE WHEN ${reset} THEN now() ELSE ${t.cuaSoBatDau} END`,
          khoaDen: sql`CASE
            WHEN ${reset} THEN (CASE WHEN 1 >= ${SO_LAN_SAI_TOI_DA} THEN now() + make_interval(secs => ${khoaGiay}) ELSE NULL END)
            WHEN ${t.khoaDen} IS NULL AND ${t.soLanSai} + 1 >= ${SO_LAN_SAI_TOI_DA} THEN now() + make_interval(secs => ${khoaGiay})
            ELSE ${t.khoaDen} END`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ soLanSai: t.soLanSai, conLaiMs: conLaiMsSql(t) });
    const r = rows[0];
    if (!r) throw new LoiBoDemTotp("Upsert bộ đếm TOTP sai không trả hàng.");
    return { soLanSai: Number(r.soLanSai), conLaiMs: Math.max(0, Number(r.conLaiMs ?? 0)) };
  } catch (e) {
    if (e instanceof LoiBoDemTotp) throw e;
    throw new LoiBoDemTotp(`Ghi bộ đếm TOTP sai hỏng: ${(e as Error)?.message ?? String(e)}`, { cause: e });
  }
}

/**
 * BƯỚC 4 — mã ĐÚNG (người dùng không đang khoá) ⇒ xoá hàng. Điều kiện `khoa_den` ⇒ nếu một lượt sai đồng thời VỪA đặt khoá giữa
 * bước 1 và đây, khoá ấy KHÔNG bị lượt đúng này xoá ngầm (brief: "mã đúng, không đang khoá ⇒ xoá hàng").
 */
export async function xoaBoDemTotp(userId: number): Promise<void> {
  try {
    const db = await layDbBatBuoc();
    const t = await bang();
    await db.delete(t).where(sql`${t.userId} = ${userId} AND (${t.khoaDen} IS NULL OR ${t.khoaDen} <= now())`);
  } catch (e) {
    if (e instanceof LoiBoDemTotp) throw e;
    throw new LoiBoDemTotp(`Xoá bộ đếm TOTP sai hỏng: ${(e as Error)?.message ?? String(e)}`, { cause: e });
  }
}

export type SuKienKhoaTotp = "totp.tam_khoa" | "totp.tu_choi_dang_khoa";

/**
 * Audit một sự kiện của bộ đếm. KHÔNG ném: lượt xác minh đã bị TỪ CHỐI trước khi tới đây, nên audit hỏng không đổi được phán quyết
 * (không mở cửa nào) — nhưng KÊU TO để một sổ audit đang hỏng không im lặng. Không bao giờ nhận/ghi mã.
 */
export async function ghiAuditKhoaTotp(
  userId: number,
  action: SuKienKhoaTotp,
  thongTin: { conLaiMs: number; nguyenNhan?: "ma_sai" | "phat_lai" },
): Promise<void> {
  try {
    const db = await layDbBatBuoc();
    const { recordAuditEvent } = await import("../services/audit/controlAuditService");
    await recordAuditEvent(db, {
      entityType: "user",
      entityId: userId,
      action,
      actorId: userId,
      after: {
        conLaiMs: thongTin.conLaiMs,
        soLanSaiToiDa: SO_LAN_SAI_TOI_DA,
        cuaSoMs: CUA_SO_SAI_MS,
        thoiGianKhoaMs: THOI_GIAN_KHOA_MS,
        ...(thongTin.nguyenNhan ? { nguyenNhan: thongTin.nguyenNhan } : {}),
      },
      reason:
        action === "totp.tam_khoa"
          ? `TOTP tạm khoá: ${SO_LAN_SAI_TOI_DA} lần sai trong ${CUA_SO_SAI_MS / 60_000} phút`
          : "Từ chối xác minh TOTP: đang tạm khoá do nhập sai nhiều lần",
    });
  } catch (e) {
    console.error(
      `[TotpKhoaSai] KHÔNG ghi được audit ${action} cho user ${userId} (${(e as Error)?.message ?? String(e)}). ` +
        `Lượt xác minh vẫn bị TỪ CHỐI; kiểm bảng control_audit_log.`,
    );
  }
}

/**
 * Admin mở khoá: xoá hàng `totp_khoa_sai` của `userId` + một dòng audit `totp.mo_khoa` (kèm `lyDo`) trong CÙNG giao dịch — audit
 * hỏng ⇒ lượt xoá hoàn tác (không có mở khoá nào không để dấu). Trả `daMoKhoa` = có hàng bị xoá hay không (không lộ đếm).
 */
export async function moKhoaTotpCuaNguoiDung(args: { userId: number; actorId: number; lyDo: string }): Promise<{ daMoKhoa: boolean }> {
  const db = await layDbBatBuoc();
  const t = await bang();
  const { recordAuditEvent } = await import("../services/audit/controlAuditService");
  return db.transaction(async (tx) => {
    const xoa = await tx
      .delete(t)
      .where(sql`${t.userId} = ${args.userId}`)
      .returning({ dangKhoa: sql<boolean>`(${t.khoaDen} IS NOT NULL AND ${t.khoaDen} > now())` });
    await recordAuditEvent(tx, {
      entityType: "user",
      entityId: args.userId,
      action: "totp.mo_khoa",
      actorId: args.actorId,
      before: xoa[0] ? { coBoDem: true, dangKhoa: !!xoa[0].dangKhoa } : { coBoDem: false },
      after: { coBoDem: false },
      reason: args.lyDo,
    });
    return { daMoKhoa: xoa.length > 0 };
  });
}

/**
 * Dạng dùng tại chỗ cho các thủ tục tRPC: `kiemKhoaTotp(await verifyTotpOnce({…})).hopLe` — NÉM `loiTotpKhoa(kq)` khi bộ đếm từ
 * chối, không thì trả nguyên `kq`.
 * ⚠ Hình dạng `f(await verifyTotpOnce(…)).hopLe` là CỐ Ý: lưới AST `hoTuyenSongSong` (hoXacThucScan.phepKiemTrong) nhận ra
 *   `dung:verifyTotpOnce` qua lời gọi lồng, và bỏ qua `f` vì nó là một mắt chuỗi (`.hopLe`) — nên hai tuyến song song dùng cùng
 *   hình dạng thì chữ ký phép kiểm của chúng KHÔNG đổi so với trước Task 16.
 */
export function kiemKhoaTotp<T extends { ma?: "TOTP_TAM_KHOA" | "TOTP_KHONG_KIEM_DUOC"; conLaiMs?: number }>(kq: T): T {
  const loi = loiTotpKhoa(kq);
  if (loi) throw loi;
  return kq;
}

/** Số phút còn lại để HIỂN THỊ (làm tròn LÊN, tối thiểu 1). */
export function phutConLai(conLaiMs: number): number {
  return Math.max(1, Math.ceil(Math.max(0, conLaiMs) / 60_000));
}

/**
 * Kết quả của `verifyTotpOnce`/`verifyFreshTotp` ⇒ lỗi tRPC có mã riêng cho người gọi, hoặc `null` (kết quả thường: mã sai/phát lại
 * vẫn đi đường lỗi CŨ của từng người gọi). `them` = tham số thêm của người gọi (vd. `{ ma, level }` của SCADA).
 *   · `TOTP_TAM_KHOA`        ⇒ TOO_MANY_REQUESTS, params `{ remainingMinutes }` (KHÔNG có số lần sai);
 *   · `TOTP_KHONG_KIEM_DUOC` ⇒ SERVICE_UNAVAILABLE, không params riêng.
 */
export function loiTotpKhoa(
  kq: { ma?: "TOTP_TAM_KHOA" | "TOTP_KHONG_KIEM_DUOC"; conLaiMs?: number },
  them?: AppErrorParams,
) {
  if (kq.ma === "TOTP_TAM_KHOA") {
    const phut = phutConLai(kq.conLaiMs ?? THOI_GIAN_KHOA_MS);
    return appError(
      "TOO_MANY_REQUESTS",
      "TOTP_TAM_KHOA",
      { ...(them ?? {}), remainingMinutes: phut },
      `Xác thực hai lớp đang tạm khoá do nhập sai nhiều lần — thử lại sau ${phut} phút.`,
    );
  }
  if (kq.ma === "TOTP_KHONG_KIEM_DUOC") {
    return appError(
      "SERVICE_UNAVAILABLE",
      "TOTP_KHONG_KIEM_DUOC",
      them,
      "Không kiểm được mã xác thực hai lớp lúc này (lỗi hệ thống) — thử lại sau.",
    );
  }
  return null;
}
