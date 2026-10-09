/**
 * doc 81 Đợt 3b Task 3 — chuông thông báo đọc bảng `notifications` (router `notification.*` SẴN CÓ) trên CSDL `_test` THẬT.
 *
 * Review Focus #2:
 *   §1 người dùng CHỈ thấy thông báo của chính mình (list + unreadCount);
 *   §2 KHÔNG đánh dấu đã đọc được thông báo của người khác (markAsRead theo id lạ, markAllAsRead);
 *   §3 `actionUrl` không phải đường nội bộ tương đối ⇒ server trả `null` (không bao giờ được đi theo) — cả hàng ghi
 *      thẳng vào bảng (như router giao việc) lẫn hàng ghi qua `sendNotification` (lọc ngay khi ghi).
 * Người dùng gieo theo tiền tố RUN; dọn ở afterAll đúng các hàng của mình (notifications theo userId đã gieo).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t3b3_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const uid: Record<"alice" | "bob", number> = { alice: 0, bob: 0 };
const nid: Record<string, number> = {};

async function as(key: "alice" | "bob") {
  const { notificationRouter } = await import("./notificationRouters");
  return notificationRouter.createCaller({ user: { id: uid[key], role: "engineer", name: `${RUN} ${key}` } } as any);
}

async function mk(key: string, userId: number, actionUrl: string | null, isRead = false): Promise<number> {
  const [r] = await sql`INSERT INTO notifications ("userId", type, title, message, "actionUrl", "isRead", priority)
    VALUES (${userId}, 'INFO', ${`${RUN} ${key}`}, ${`msg ${key}`}, ${actionUrl}, ${isRead}, 'NORMAL') RETURNING id`;
  nid[key] = Number(r.id);
  return nid[key];
}
async function row(id: number) {
  const [r] = await sql`SELECT "userId", "isRead", "readAt", "actionUrl" FROM notifications WHERE id = ${id}`;
  return r;
}

describe.skipIf(!DB_URL)("notification.* — chuông thông báo (CSDL _test THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const [{ d }] = await sql`SELECT current_database() AS d`;
    if (!String(d).endsWith("_test")) throw new Error(`KHÔNG chạy ngoài _test (đang ở ${d})`);
    for (const key of ["alice", "bob"] as const) {
      const [r] = await sql`INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`${RUN}-${key}`}, ${`${RUN}-${key}`}, ${`${RUN} ${key}`}, 'engineer', true) RETURNING id`;
      uid[key] = Number(r.id);
    }
    await mk("aSafe", uid.alice, "/engineering-changes?flyout=ecn&flyoutId=12");
    await mk("aAbs", uid.alice, "https://evil.example/x");
    await mk("aProto", uid.alice, "//evil.example/x");
    await mk("aBackslash", uid.alice, "/\\evil.example");
    await mk("aNull", uid.alice, null);
    await mk("aOld", uid.alice, "/alerts", true);
    await mk("bSafe", uid.bob, "/recipes?filter=pending");
    await mk("bSafe2", uid.bob, "/alerts");
  });

  afterAll(async () => {
    if (!sql) return;
    const ids = Object.values(uid).filter(Boolean);
    if (ids.length) {
      await sql`DELETE FROM notifications WHERE "userId" IN ${sql(ids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`.catch(() => undefined);
    }
    await sql.end({ timeout: 5 });
  });

  describe("§1 chỉ của chính mình", () => {
    it("list trả ĐÚNG các hàng của người gọi (mới nhất trước), không một hàng nào của người khác", async () => {
      const a = await (await as("alice")).list({ limit: 50 });
      expect(a.every((n) => n.userId === uid.alice)).toBe(true);
      expect(new Set(a.map((n) => n.id))).toEqual(new Set([nid.aSafe, nid.aAbs, nid.aProto, nid.aBackslash, nid.aNull, nid.aOld]));
      const b = await (await as("bob")).list({ limit: 50 });
      expect(new Set(b.map((n) => n.id))).toEqual(new Set([nid.bSafe, nid.bSafe2]));
    });

    it("list tôn trọng limit", async () => {
      expect(await (await as("alice")).list({ limit: 2 })).toHaveLength(2);
    });

    it("unreadCount = số chưa đọc của chính mình, kiểu SỐ (postgres COUNT(*) là bigint ⇒ chuỗi nếu không ép)", async () => {
      const c = await (await as("alice")).unreadCount();
      expect(c).toBe(5);
      expect(await (await as("bob")).unreadCount()).toBe(2);
    });
  });

  describe("§3 actionUrl không nội bộ ⇒ null", () => {
    it("hàng ghi thẳng vào bảng: đường nội bộ giữ nguyên, URL tuyệt đối / '//' / '\\' ⇒ null", async () => {
      const a = await (await as("alice")).list({ limit: 50 });
      const by = new Map(a.map((n) => [n.id, n.actionUrl]));
      expect(by.get(nid.aSafe)).toBe("/engineering-changes?flyout=ecn&flyoutId=12");
      expect(by.get(nid.aAbs)).toBeNull();
      expect(by.get(nid.aProto)).toBeNull();
      expect(by.get(nid.aBackslash)).toBeNull();
      expect(by.get(nid.aNull)).toBeNull();
    });

    it("sendNotification lọc NGAY KHI GHI: URL ngoài ⇒ cột actionUrl null; đường nội bộ giữ", async () => {
      const { sendNotification } = await import("../services/notificationService");
      const bad = await sendNotification(uid.bob, { type: "INFO", title: `${RUN} sendBad`, message: "x", actionUrl: "https://evil.example" });
      const good = await sendNotification(uid.bob, { type: "INFO", title: `${RUN} sendGood`, message: "x", actionUrl: "/alerts?x=1" });
      expect(bad && good).toBeTruthy();
      expect((await row(bad!.id)).actionUrl).toBeNull();
      expect((await row(good!.id)).actionUrl).toBe("/alerts?x=1");
      nid.bSendBad = bad!.id;
      nid.bSendGood = good!.id;
    });
  });

  describe("§2 đánh dấu đã đọc chỉ của chính mình", () => {
    it("bob markAsRead(id của alice) ⇒ hàng của alice VẪN chưa đọc", async () => {
      await (await as("bob")).markAsRead({ id: nid.aSafe });
      const r = await row(nid.aSafe);
      expect(r.isRead).toBe(false);
      expect(r.readAt).toBeNull();
      expect(await (await as("alice")).unreadCount()).toBe(5);
    });

    it("alice markAsRead(của mình) ⇒ đã đọc + readAt; unreadCount giảm 1", async () => {
      await (await as("alice")).markAsRead({ id: nid.aSafe });
      const r = await row(nid.aSafe);
      expect(r.isRead).toBe(true);
      expect(r.readAt).not.toBeNull();
      expect(await (await as("alice")).unreadCount()).toBe(4);
    });

    it("bob markAllAsRead ⇒ chỉ hàng của bob; mọi hàng chưa đọc của alice giữ nguyên", async () => {
      await (await as("bob")).markAllAsRead();
      expect(await (await as("bob")).unreadCount()).toBe(0);
      for (const k of ["aAbs", "aProto", "aBackslash", "aNull"]) expect((await row(nid[k])).isRead).toBe(false);
      expect(await (await as("alice")).unreadCount()).toBe(4);
    });

    it("alice markAllAsRead ⇒ 0 chưa đọc", async () => {
      await (await as("alice")).markAllAsRead();
      expect(await (await as("alice")).unreadCount()).toBe(0);
    });
  });
});
