/**
 * ★★★ Lô W19 — BẰNG CHỨNG cho các miễn trừ "sở hữu theo NGƯỜI DÙNG" còn nợ-bằng-chứng (phamViBangChung): hội thoại AI (aiChat), bình luận lô huấn luyện, báo cáo tuỳ biến (reportBuilder).
 * Người B (cùng vai) gọi bằng id tài nguyên của A ⇒ dữ liệu A KHÔNG đổi; đối chứng: chủ gọi được.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw28${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const ctx = (u: { id: number; name: string }) => ({ user: { id: u.id, role: "supervisor", name: u.name, openId: u.name, twoFactorEnabled: true } }) as never;
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
let A!: { id: number; name: string };
let B!: { id: number; name: string };
const ids: Record<string, number> = {};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw28", ts: RUN, ten: "PW28 ua" });
  B = await taoNguoiDungTest("ub", "supervisor", { tienTo: "pw28", ts: RUN, ten: "PW28 ub" });
  ids.conv = Number((await one(sql`INSERT INTO ai_chat_conversations ("userId", title) VALUES (${A.id}, ${RUN + "-conv"}) RETURNING id`)).id);
  ids.msg = Number((await one(sql`INSERT INTO ai_chat_messages ("conversationId", role, content) VALUES (${ids.conv}, 'user', ${RUN + "-m"}) RETURNING id`)).id);
  ids.bl = Number((await one(sql`INSERT INTO training_batch_comments ("batchId", "userId", content) VALUES (${RUN + "-lo"}, ${A.id}, ${RUN + "-c"}) RETURNING id`)).id);
  ids.rp = Number((await one(sql`INSERT INTO report_templates (name, code, "templateType", sections, "createdBy") VALUES (${RUN + "-rp"}, ${RUN + "-rp"}, 'CUSTOM', '{}'::json, ${A.id}) RETURNING id`)).id);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM ai_chat_messages WHERE "conversationId" = ${ids.conv}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_chat_conversations WHERE title LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM training_batch_comments WHERE "batchId" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM report_templates WHERE name LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("sở hữu theo người dùng — hội thoại AI · bình luận · báo cáo", () => {
  it("aiChat: B sửa / xoá hội thoại, xoá tin nhắn, lưu tin nhắn stream vào hội thoại của A ⇒ NOT_FOUND, dữ liệu A không đổi; A sửa được", async () => {
    const { aiChatRouter } = await import("./aiChatRouter");
    const b = aiChatRouter.createCaller(ctx(B));
    const l = [
      await maLoi(() => b.updateConversation({ id: ids.conv, title: `${RUN}-hack` })),
      await maLoi(() => b.deleteConversation({ id: ids.conv })),
      await maLoi(() => b.deleteMessage({ messageId: ids.msg, conversationId: ids.conv })),
      await maLoi(() => b.saveStreamedMessage({ conversationId: ids.conv, userMessage: "x", assistantMessage: "y" })),
    ];
    expect(l).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_chat_conversations WHERE id = ${ids.conv} AND title = ${RUN + "-conv"}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_chat_messages WHERE "conversationId" = ${ids.conv}`)).toBe(1);
    expect(await maLoi(() => aiChatRouter.createCaller(ctx(A)).updateConversation({ id: ids.conv, title: `${RUN}-conv2` }))).toBeNull();
  });
  it("trainingBatchComments: B sửa / xoá bình luận của A ⇒ FORBIDDEN, bình luận còn nguyên; A sửa được", async () => {
    const { trainingBatchCommentsRouter } = await import("./trainingBatchCommentsRouter");
    const b = trainingBatchCommentsRouter.createCaller(ctx(B));
    expect(await maLoi(() => b.updateComment({ commentId: ids.bl, content: "hack" }))).toBe("FORBIDDEN");
    expect(await maLoi(() => b.deleteComment({ commentId: ids.bl }))).toBe("FORBIDDEN");
    expect(await so(sql`SELECT count(*)::int AS n FROM training_batch_comments WHERE id = ${ids.bl} AND content = ${RUN + "-c"}`)).toBe(1);
    expect(await maLoi(() => trainingBatchCommentsRouter.createCaller(ctx(A)).updateComment({ commentId: ids.bl, content: `${RUN}-c2` }))).toBeNull();
  });
  it("reportBuilder.update: B sửa báo cáo của A ⇒ FORBIDDEN, báo cáo nguyên; save ghi người tạo (người tạo sửa / xoá được, người khác FORBIDDEN)", async () => {
    const { reportBuilderRouter } = await import("./reportBuilderRouter");
    const b = reportBuilderRouter.createCaller(ctx(B));
    const dinhNghia = { name: `${RUN}-hack`, widgets: [], isPublic: false } as never;
    expect(await maLoi(() => b.update({ id: ids.rp, data: dinhNghia }))).toBe("FORBIDDEN");
    expect(await so(sql`SELECT count(*)::int AS n FROM report_templates WHERE id = ${ids.rp} AND name = ${RUN + "-rp"}`)).toBe(1);
    // W19c — save GHI người tạo: B sửa / xoá báo cáo của CHÍNH MÌNH được; A (người khác) ⇒ FORBIDDEN, báo cáo nguyên
    const moi = (await b.save({ ...(dinhNghia as object), name: `${RUN}-moi` } as never)) as { id: number };
    expect(await so(sql`SELECT count(*)::int AS n FROM report_templates WHERE id = ${moi.id} AND "createdBy" = ${B.id}`)).toBe(1);
    const a2 = reportBuilderRouter.createCaller(ctx(A));
    expect(await maLoi(() => a2.update({ id: moi.id, data: { ...(dinhNghia as object), name: `${RUN}-hackA` } as never }))).toBe("FORBIDDEN");
    expect(await maLoi(() => a2.delete(moi.id))).toBe("FORBIDDEN");
    expect(await maLoi(() => b.update({ id: moi.id, data: { ...(dinhNghia as object), name: `${RUN}-moi2` } as never }))).toBeNull();
    expect(await maLoi(() => b.delete(moi.id))).toBeNull();
    expect(await so(sql`SELECT count(*)::int AS n FROM report_templates WHERE id = ${moi.id} AND "isActive" = true`)).toBe(0); // xoá mềm
  });
  it("aiCopilot.cancelAction: B huỷ hành động chờ duyệt của A ⇒ 'Người dùng không khớp', trạng thái nguyên; A huỷ được", async () => {
    const id = `${RUN}-act`;
    await dung(sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "idempotencyKey", "expiresAt", status)
      VALUES (${id}, 'set_yield_threshold', '{}'::json, ${A.id}, 'supervisor', 's', ${id}, now() + interval '1 day', 'proposed')`);
    const { aiCopilotRouter } = await import("./aiCopilotRouter");
    const kq = await aiCopilotRouter.createCaller(ctx(B)).cancelAction({ actionId: id });
    expect(kq).toMatchObject({ ok: false, status: "invalid" });
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id = ${id} AND status = 'proposed'`)).toBe(1);
    expect(await aiCopilotRouter.createCaller(ctx(A)).cancelAction({ actionId: id })).toMatchObject({ ok: true, status: "cancelled" });
    await dung(sql`DELETE FROM ai_pending_actions WHERE id = ${id}`);
  });
});
