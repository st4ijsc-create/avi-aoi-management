/**
 * Phase 4 WS4.2 — AI insights router (read + acknowledge/dismiss).
 * Advisory data produced by the AI orchestration watcher. No action execution here.
 */
import { sql } from "drizzle-orm";
import type { CoDanhTinh } from "./_phamViNguoiXem";
import { ghiViTri } from "./_viTriPhamVi";
import { idsMayTrongPhamVi } from "./_adapterPhamVi";
import { z } from "zod";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { aiInsights } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

/** Insight gắn một máy (machineCode) thì máy đó phải trong phạm vi người gọi; insight không gắn máy là chung. Ngoài phạm vi ≡ "Insight not found". */
async function insightGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [r] = await d.select({ m: aiInsights.machineCode }).from(aiInsights).where(eq(aiInsights.id, id)).limit(1);
  if (!r || r.m == null) return; // không có hàng: để thân thủ tục xử như trước; insight chung: giữ nguyên
  try {
    const rows = (await d.execute(sql`SELECT id FROM machines WHERE code = ${r.m} LIMIT 1`)) as unknown as Array<{ id: number }>;
    if (rows.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "insight" }, "none");
    await ghiViTri(ctx, { machineId: Number(rows[0]!.id) });
  } catch {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "insight" }, "Insight not found");
  }
}

export const aiInsightRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["new", "acknowledged", "dismissed"]).optional(),
      machineCode: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [];
      // phạm vi người dùng (L6b 2026-10-25): insight theo máy (mã máy) ⇒ máy trong phạm vi; không gắn máy ⇒ chung (khớp insightGhi)
      const idsMay = await idsMayTrongPhamVi(ctx);
      if (idsMay !== null) {
        conds.push(sql`(${aiInsights.machineCode} IS NULL OR ${aiInsights.machineCode} IN (SELECT code FROM machines WHERE id IN (${sql.join((idsMay.length > 0 ? idsMay : [-1]).map((x) => sql`${x}`), sql`, `)})))`);
      }
      if (input?.status) conds.push(eq(aiInsights.status, input.status));
      if (input?.machineCode) conds.push(eq(aiInsights.machineCode, input.machineCode));
      const where = conds.length ? and(...conds) : undefined;
      return db.select().from(aiInsights)
        .where(where)
        .orderBy(desc(aiInsights.createdAt))
        .limit(input?.limit ?? 50);
    }),

  setStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(["acknowledged", "dismissed", "new"]) }))
    .mutation(async ({ ctx, input }) => {
      await insightGhi(ctx, input.id); // phạm vi nhà máy (rà bảo mật 2026-10-25, lô W11b)
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [row] = await db.update(aiInsights)
        .set({ status: input.status, acknowledgedBy: ctx.user?.id ?? null })
        .where(eq(aiInsights.id, input.id))
        .returning();
      return row;
    }),
});
