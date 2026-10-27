/**
 * ★ Đợt 10.3 — PHẠM VI + AUDIT dùng chung cho thủ tục quản trị khoá / cấu hình AI ngoài (`aiNgoaiRouter`) và thủ tục khoá cũ
 * (`aiSettingsRouter.*ApiKey` — bảng `ai_api_keys` nay mang khoá AI ngoài thật theo nhà máy, rà kiem-dinh Task 7 F1).
 *   • danh tính LUÔN từ `ctx` (`phamViCua`), không từ input; ngoài phạm vi ≡ không tồn tại (NOT_FOUND);
 *   • khoá không nhà máy (legacy) chỉ phạm vi toàn quyền thấy / đụng được;
 *   • thao tác an ninh ⇒ audit CÙNG GIAO DỊCH (`logCrudOperationInTx` — ghi audit lỗi ⇒ rollback, không đổi khoá; F4);
 *   • đuôi khoá chỉ lộ khi khoá dài (≥ 20 ký tự) — khoá ngắn (token vLLM 8 ký tự) ⇒ "••••" (F2).
 */
import { eq } from "drizzle-orm";
import { appError } from "../_core/appError";
import { phamViCua } from "./_phamViNguoiXem";
import { getDb } from "../db/connection";
import { aiApiKeys } from "../../drizzle/schema/ai";
import { decryptSecret } from "../services/security/secretBox";
import { nhaMayChoPhep, nhaMayHopLe } from "../services/flow/phamViLuong";
import { logCrudOperationInTx, type AuditLogEntry } from "../services/auditTrailService";

type Ctx = Parameters<typeof phamViCua>[0] & { user: { id: number; name?: string | null } };

export const khongCoKhoa = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiNgoaiKhoa" }, "not found");

export async function dbHoacLoi() {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  return db;
}

/** Nhà máy nằm trong phạm vi người gọi (danh tính từ `ctx`). */
export async function nhaMayNgoaiTrongPhamVi(ctx: Parameters<typeof phamViCua>[0], factoryId: number | null | undefined): Promise<boolean> {
  return typeof factoryId === "number" && nhaMayHopLe(factoryId, await nhaMayChoPhep(phamViCua(ctx)));
}

/** Hàng khoá theo id trong phạm vi (khoá không nhà máy ⇒ chỉ phạm vi toàn quyền); ngoài phạm vi / không có ⇒ NOT_FOUND. */
export async function khoaApiTrongPhamVi(ctx: Parameters<typeof phamViCua>[0], id: number) {
  const db = await dbHoacLoi();
  const [k] = await db.select().from(aiApiKeys).where(eq(aiApiKeys.id, id)).limit(1);
  if (!k || !nhaMayHopLe(k.factoryId, await nhaMayChoPhep(phamViCua(ctx)))) throw khongCoKhoa();
  return { db, k };
}

/** Bộ lọc danh sách khoá theo phạm vi người gọi. */
export async function locKhoaApiTrongPhamVi(ctx: Parameters<typeof phamViCua>[0]): Promise<(k: { factoryId: number | null }) => boolean> {
  const cho = await nhaMayChoPhep(phamViCua(ctx));
  return (k) => nhaMayHopLe(k.factoryId, cho);
}

export const DUOI_KHOA_TOI_THIEU = 20;
/** Đuôi 4 ký tự CHỈ khi khoá dài ≥ 20; ngắn hơn ⇒ "••••". */
export function cuoi4AnToan(khoa: string | null | undefined): string | null {
  if (!khoa) return null;
  return khoa.length >= DUOI_KHOA_TOI_THIEU ? khoa.slice(-4) : "••••";
}
export function cuoi4CuaBanMa(ma: string | null | undefined): string | null {
  return cuoi4AnToan(decryptSecret(ma ?? null));
}

/** Audit CÙNG giao dịch — lỗi ghi ⇒ ném ⇒ giao dịch rollback. */
export async function auditTrongGiaoDich(tx: { insert: (...a: any[]) => any }, ctx: Ctx, entry: AuditLogEntry): Promise<void> {
  await logCrudOperationInTx(tx, { userId: ctx.user.id, userName: ctx.user.name ?? null, source: "trpc" }, entry);
}

/** Mã lỗi PostgreSQL của lỗi ràng buộc (drizzle bọc lỗi postgres.js trong `cause`). */
const MA_RANG_BUOC = new Set(["23514", "23505", "23503", "23502", "22001", "22003"]);
export function maLoiPg(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}

/**
 * ★ 10.4 (luong-ui báo) — giao dịch ghi của thủ tục AI ngoài: lỗi RÀNG BUỘC CSDL (CHECK / UNIQUE / FK / NOT NULL / tràn độ dài) ⇒
 * BAD_REQUEST sạch `du-lieu-vi-pham-rang-buoc` — KHÔNG để lỗi thô "Failed query: insert into …" (lộ câu SQL + tham số) tới client.
 */
export async function giaoDichNgoai<T>(db: Awaited<ReturnType<typeof dbHoacLoi>>, fn: Parameters<Awaited<ReturnType<typeof dbHoacLoi>>["transaction"]>[0] extends (tx: infer X) => unknown ? (tx: X) => Promise<T> : never): Promise<T> {
  try {
    return (await db.transaction(fn as never)) as T;
  } catch (e) {
    const ma = maLoiPg(e);
    if (ma && MA_RANG_BUOC.has(ma)) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiGhi", reason: "du-lieu-vi-pham-rang-buoc" }, `dữ liệu vi phạm ràng buộc (${ma})`);
    throw e;
  }
}
