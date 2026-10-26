/**
 * ★ Đợt 10.3 B3 — QUẢN TRỊ AI NGOÀI (`aiNgoai.*`): khoá theo nhà máy (tạo / xoay / thu hồi / danh sách). Chỉ admin, cổng giấy phép
 * MOD_AI, PHẠM VI NHÀ MÁY của người gọi (ngoài phạm vi ⇒ NOT_FOUND, không phân biệt với "không có"). Khoá KHÔNG BAO GIỜ trả về
 * (chỉ 4 ký tự cuối), không vào nhật ký / audit (audit ghi người + giá trị CŨ / MỚI dạng `cuoi4`). Chủ dự án tạo khoá ở màn quản trị —
 * không qua `.env`, không qua phiên Claude nào.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { appError } from "../_core/appError";
import { router, moduleGate } from "../_core/trpc";
import { adminProcedure as adminProcedureBase } from "./_shared";
import { phamViCua } from "./_phamViNguoiXem";
import { getDb } from "../db/connection";
import { aiApiKeys } from "../../drizzle/schema/ai";
import { encryptSecret, decryptSecret } from "../services/security/secretBox";
import { nhaMayChoPhep, nhaMayHopLe } from "../services/flow/phamViLuong";
import { logCrudOperation } from "../services/auditTrailService";
import { NHA_CUNG_CAP_NGOAI } from "../services/ai/chonModel/kieu";

const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));

const cuoi4 = (ma: string | null | undefined): string | null => {
  const k = decryptSecret(ma ?? null);
  return k ? k.slice(-4) : null;
};
const khongCo = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiNgoaiKhoa" }, "not found");
const dbHoacLoi = async () => {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  return db;
};
const auditCtx = (ctx: { user: { id: number; name?: string | null } }) => ({ userId: ctx.user.id, userName: ctx.user.name ?? null, source: "trpc" as const });

/** Nhà máy nằm trong phạm vi người gọi (danh tính từ `ctx` — không bao giờ từ input). */
async function nhaMayNgoaiTrongPhamVi(ctx: Parameters<typeof phamViCua>[0], factoryId: number | null | undefined): Promise<boolean> {
  return typeof factoryId === "number" && nhaMayHopLe(factoryId, await nhaMayChoPhep(phamViCua(ctx)));
}

/** Khoá trong phạm vi người gọi (ngoài phạm vi / không có ⇒ NOT_FOUND). */
async function khoaTrongPhamVi(ctx: Parameters<typeof phamViCua>[0], id: number) {
  const db = await dbHoacLoi();
  const [k] = await db.select().from(aiApiKeys).where(eq(aiApiKeys.id, id)).limit(1);
  if (!k || !(await nhaMayNgoaiTrongPhamVi(ctx, k.factoryId))) throw khongCo();
  return { db, k };
}

const KHOA_DANG = z.string().min(8).max(4096);

export const aiNgoaiRouter = router({
  /** Tạo khoá cho MỘT nhà máy trong phạm vi. Trả `{ id, cuoi4 }` — không bao giờ trả khoá. */
  taoKhoa: adminProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        nhaCungCap: z.enum(NHA_CUNG_CAP_NGOAI),
        ten: z.string().min(1).max(255),
        khoa: KHOA_DANG,
        endpoint: z.string().url().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCo();
      const db = await dbHoacLoi();
      const ma = encryptSecret(input.khoa);
      if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
      const [r] = await db
        .insert(aiApiKeys)
        .values({
          name: input.ten,
          provider: input.nhaCungCap,
          encryptedKey: ma,
          endpoint: input.nhaCungCap === "openai_compat" ? (input.endpoint ?? null) : null,
          status: "active",
          createdBy: ctx.user.id,
          factoryId: input.factoryId,
        })
        .returning({ id: aiApiKeys.id });
      const c4 = input.khoa.slice(-4);
      await logCrudOperation(auditCtx(ctx), {
        action: "create",
        entityType: "ai_ngoai_khoa",
        entityId: r!.id,
        entityName: input.ten,
        details: { operation: "CREATE", after: { factoryId: input.factoryId, nhaCungCap: input.nhaCungCap, cuoi4: c4, status: "active" } },
        status: "success",
      });
      return { id: r!.id, cuoi4: c4 };
    }),

  /** Xoay khoá: thay bản mã; lượt kế (kể cả lần thử lại đang dở) đọc khoá MỚI (thunk đọc tươi). */
  xoayKhoa: adminProcedure.input(z.object({ id: z.number().int().positive(), khoa: KHOA_DANG })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaTrongPhamVi(ctx, input.id);
    const ma = encryptSecret(input.khoa);
    if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
    await db.update(aiApiKeys).set({ encryptedKey: ma, updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
    const c4 = input.khoa.slice(-4);
    await logCrudOperation(auditCtx(ctx), {
      action: "update",
      entityType: "ai_ngoai_khoa",
      entityId: input.id,
      entityName: k.name,
      details: { operation: "XOAY", before: { cuoi4: cuoi4(k.encryptedKey) }, after: { cuoi4: c4 } },
      status: "success",
    });
    return { id: input.id, cuoi4: c4 };
  }),

  /** Thu hồi (inactive) — lượt kế bị từ chối `NGOAI_KHOA_KHONG_HOP_LE`. Không xoá (model ngoài còn trỏ tới — FK RESTRICT). */
  thuHoiKhoa: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaTrongPhamVi(ctx, input.id);
    await db.update(aiApiKeys).set({ status: "inactive", updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
    await logCrudOperation(auditCtx(ctx), {
      action: "update",
      entityType: "ai_ngoai_khoa",
      entityId: input.id,
      entityName: k.name,
      details: { operation: "THU_HOI", before: { status: k.status }, after: { status: "inactive" } },
      status: "success",
    });
    return { id: input.id, status: "inactive" as const };
  }),

  /** Danh sách khoá của MỘT nhà máy trong phạm vi — chỉ `cuoi4`. */
  dsKhoa: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCo();
    const db = await dbHoacLoi();
    const ds = await db.select().from(aiApiKeys).where(and(eq(aiApiKeys.factoryId, input.factoryId))).orderBy(desc(aiApiKeys.createdAt));
    return ds.map((k) => ({ id: k.id, ten: k.name, nhaCungCap: k.provider, status: k.status, cuoi4: cuoi4(k.encryptedKey) }));
  }),
});
