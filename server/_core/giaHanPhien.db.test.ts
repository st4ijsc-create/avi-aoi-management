/**
 * ★ Pha 0 P0-11 (2026-11-04) — gia hạn TẠI CHỖ trên `_test` (giao dịch HOÀN TÁC, không commit hàng nào):
 *   · `giaHanPhienTaiCho` đổi ĐÚNG `expiresAt`, `isActive` giữ true; hạn mới nhỏ hơn hạn hiện có ⇒ 0 hàng; phiên đã thu hồi ⇒ 0 hàng (không sống lại).
 *   · KHÔNG phát NOTIFY `socket_pham_vi` theo cấu tạo: trigger 0435 của user_sessions là `AFTER UPDATE OF "isActive"` (catalog) và lượt gia hạn
 *     không SET `isActive` (ghim nguồn ở hanPhien.p011.test.ts) ⇒ trigger không chạy ⇒ socket HMI không bị ngắt.
 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { userSessions } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { giaHanPhienTaiCho } from "../db/auth";

const ROLLBACK_GIA_HAN = new Error("rollback-gia-han-phien");
async function trongGiaoDichHoanTac<T>(f: (tx: any) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("cần CSDL _test");
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await f(tx);
      throw ROLLBACK_GIA_HAN;
    });
  } catch (e) {
    if (e !== ROLLBACK_GIA_HAN) throw e;
  }
  return out as T;
}
const hang = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? []));

describe("gia hạn phiên tại chỗ (DB _test, hoàn tác)", () => {
  it("★★★ đổi đúng expiresAt, isActive giữ; hạn nhỏ hơn ⇒ 0; phiên thu hồi ⇒ 0 (không sống lại)", async () => {
    const kq = await trongGiaoDichHoanTac(async (tx) => {
      const tag = `p011${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      const [u] = hang(await tx.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive") VALUES (${tag}, ${tag}, 'P011', 'password', 'operator', true) RETURNING id`));
      const tok = `tok-${tag}`;
      const bay = Date.now();
      // ghi / đọc qua drizzle (cùng đường kiểu timestamp với ứng dụng — tránh lệch giờ của câu thô)
      await tx.insert(userSessions).values({ userId: Number(u.id), sessionToken: tok, expiresAt: new Date(bay + 60 * 60 * 1000) });
      const doc = async () => (await tx.select({ isActive: userSessions.isActive, expiresAt: userSessions.expiresAt }).from(userSessions).where(eq(userSessions.sessionToken, tok)))[0];
      const truoc = await doc();
      const moi = new Date(new Date(truoc.expiresAt).getTime() + 11 * 60 * 60 * 1000);
      const n1 = await giaHanPhienTaiCho(tok, moi, tx);
      const sau = await doc();
      const nNho = await giaHanPhienTaiCho(tok, new Date(new Date(sau.expiresAt).getTime() - 1000), tx);
      await tx.update(userSessions).set({ isActive: false }).where(eq(userSessions.sessionToken, tok));
      const nThuHoi = await giaHanPhienTaiCho(tok, new Date(new Date(sau.expiresAt).getTime() + 60 * 60 * 1000), tx);
      const cuoi = await doc();
      return { n1, nNho, nThuHoi, truoc, sau, cuoi, moi };
    });
    expect(kq.n1).toBe(1);
    expect(kq.sau.isActive).toBe(true);
    expect(new Date(kq.sau.expiresAt).getTime() - new Date(kq.truoc.expiresAt).getTime()).toBe(11 * 60 * 60 * 1000);
    expect(kq.nNho).toBe(0);
    expect(kq.nThuHoi).toBe(0);
    expect(kq.cuoi.isActive).toBe(false);
    expect(new Date(kq.cuoi.expiresAt).getTime()).toBe(new Date(kq.sau.expiresAt).getTime());
  });

  it("★★★ trigger 0435 trên user_sessions chỉ bắn khi UPDATE CỘT isActive (gia hạn không SET cột ấy ⇒ không NOTIFY)", async () => {
    const db = await getDb();
    const r = hang(
      await db!.execute(sql`
        SELECT array_agg(a.attname::text ORDER BY a.attname) AS cot
        FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgname = 'trg_socket_pham_vi_sessions_upd' AND t.tgrelid = 'public.user_sessions'::regclass`),
    );
    expect(r[0]?.cot).toEqual(["isActive"]);
  });
});
