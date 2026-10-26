/**
 * ★ Đợt 10.3 B3 — QUẢN TRỊ AI NGOÀI (`aiNgoai.*`): khoá theo nhà máy (tạo / xoay / thu hồi / danh sách). Chỉ admin, cổng giấy phép
 * MOD_AI, PHẠM VI NHÀ MÁY của người gọi (ngoài phạm vi ⇒ NOT_FOUND, không phân biệt với "không có"). Khoá KHÔNG BAO GIỜ trả về
 * (chỉ đuôi 4 ký tự khi khoá dài — `cuoi4AnToan`), không vào nhật ký; audit ghi người + giá trị CŨ / MỚI CÙNG GIAO DỊCH (audit lỗi ⇒
 * không đổi). Endpoint (tương thích OpenAI) kiểm TĨNH lúc lưu (`kiemEndpointLuu`). Chủ dự án tạo khoá ở màn quản trị — không qua
 * `.env`, không qua phiên Claude nào.
 */
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { appError } from "../_core/appError";
import { router, moduleGate } from "../_core/trpc";
import { adminProcedure as adminProcedureBase } from "./_shared";
import { aiApiKeys } from "../../drizzle/schema/ai";
import { encryptSecret } from "../services/security/secretBox";
import { NHA_CUNG_CAP_NGOAI } from "../services/ai/chonModel/kieu";
import { kiemEndpointLuu } from "../services/ai/ngoai/urlNgoai";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import { auditTrongGiaoDich, cuoi4AnToan, cuoi4CuaBanMa, dbHoacLoi, khoaApiTrongPhamVi, khongCoKhoa, nhaMayNgoaiTrongPhamVi } from "./_aiNgoaiPhamVi";

const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
const KHOA_DANG = z.string().min(8).max(4096);

/** `host:cổng` nội bộ đã khai của nhà máy (cho kiểm endpoint lúc lưu). */
async function hostNoiBoCua(db: Awaited<ReturnType<typeof dbHoacLoi>>, factoryId: number): Promise<Set<string>> {
  const r = (await db.execute(sql`SELECT "hostCong" FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${factoryId}`)) as unknown as Array<{ hostCong: string }>;
  return new Set((Array.isArray(r) ? r : []).map((x) => x.hostCong));
}

function loiUrl(e: unknown): never {
  if (e instanceof LoiNgoai) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiEndpoint", reason: e.chiTiet ?? e.ma }, "endpoint không hợp lệ");
  throw e;
}

export const aiNgoaiRouter = router({
  /** Tạo khoá cho MỘT nhà máy trong phạm vi. Trả `{ id, cuoi4 }` — không bao giờ trả khoá. */
  taoKhoa: adminProcedure
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        nhaCungCap: z.enum(NHA_CUNG_CAP_NGOAI),
        ten: z.string().min(1).max(255),
        khoa: KHOA_DANG,
        endpoint: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
      const db = await dbHoacLoi();
      let endpoint: string | null = null;
      if (input.nhaCungCap === "openai_compat") {
        if (!input.endpoint) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "aiNgoaiEndpoint", reason: "thieu-endpoint" }, "cần endpoint");
        try {
          endpoint = kiemEndpointLuu(input.endpoint, await hostNoiBoCua(db, input.factoryId));
        } catch (e) {
          loiUrl(e);
        }
      }
      const ma = encryptSecret(input.khoa);
      if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
      const c4 = cuoi4AnToan(input.khoa);
      const id = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(aiApiKeys)
          .values({ name: input.ten, provider: input.nhaCungCap, encryptedKey: ma, endpoint, status: "active", createdBy: ctx.user.id, factoryId: input.factoryId })
          .returning({ id: aiApiKeys.id });
        await auditTrongGiaoDich(tx, ctx, {
          action: "create",
          entityType: "ai_ngoai_khoa",
          entityId: r!.id,
          entityName: input.ten,
          details: { operation: "CREATE", after: { factoryId: input.factoryId, nhaCungCap: input.nhaCungCap, cuoi4: c4, doDai: input.khoa.length, endpoint, status: "active" } },
          status: "success",
        });
        return r!.id;
      });
      return { id, cuoi4: c4 };
    }),

  /** Xoay khoá: thay bản mã; lượt kế (kể cả lần thử lại đang dở) đọc khoá MỚI (thunk đọc tươi). Không đổi trạng thái. */
  xoayKhoa: adminProcedure.input(z.object({ id: z.number().int().positive(), khoa: KHOA_DANG })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaApiTrongPhamVi(ctx, input.id);
    if (k.factoryId === null) throw khongCoKhoa();
    const ma = encryptSecret(input.khoa);
    if (!ma) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "encryptApiKey" }, "encrypt failed");
    const c4 = cuoi4AnToan(input.khoa);
    await db.transaction(async (tx) => {
      await tx.update(aiApiKeys).set({ encryptedKey: ma, updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
      await auditTrongGiaoDich(tx, ctx, {
        action: "update",
        entityType: "ai_ngoai_khoa",
        entityId: input.id,
        entityName: k.name,
        details: { operation: "XOAY", before: { cuoi4: cuoi4CuaBanMa(k.encryptedKey), status: k.status }, after: { cuoi4: c4, doDai: input.khoa.length, status: k.status } },
        status: "success",
      });
    });
    return { id: input.id, cuoi4: c4 };
  }),

  /** Thu hồi (inactive) — lượt kế bị từ chối `NGOAI_KHOA_KHONG_HOP_LE`. Không xoá (model ngoài còn trỏ tới — FK RESTRICT). */
  thuHoiKhoa: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { db, k } = await khoaApiTrongPhamVi(ctx, input.id);
    if (k.factoryId === null) throw khongCoKhoa();
    await db.transaction(async (tx) => {
      await tx.update(aiApiKeys).set({ status: "inactive", updatedAt: new Date() }).where(eq(aiApiKeys.id, input.id));
      await auditTrongGiaoDich(tx, ctx, {
        action: "update",
        entityType: "ai_ngoai_khoa",
        entityId: input.id,
        entityName: k.name,
        details: { operation: "THU_HOI", before: { status: k.status }, after: { status: "inactive" } },
        status: "success",
      });
    });
    return { id: input.id, status: "inactive" as const };
  }),

  /** Danh sách khoá của MỘT nhà máy trong phạm vi — chỉ đuôi an toàn. */
  dsKhoa: adminProcedure.input(z.object({ factoryId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    if (!(await nhaMayNgoaiTrongPhamVi(ctx, input.factoryId))) throw khongCoKhoa();
    const db = await dbHoacLoi();
    const ds = await db.select().from(aiApiKeys).where(eq(aiApiKeys.factoryId, input.factoryId)).orderBy(desc(aiApiKeys.createdAt));
    return ds.map((k) => ({ id: k.id, ten: k.name, nhaCungCap: k.provider, status: k.status, cuoi4: cuoi4CuaBanMa(k.encryptedKey), capNhatLuc: k.updatedAt }));
  }),
});
