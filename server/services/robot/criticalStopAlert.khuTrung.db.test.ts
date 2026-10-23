/**
 * ★★ 2026-10-23 — KHỬ TRÙNG BỀN VỮNG của cảnh báo trạng thái (`raiseCriticalStopAlert({ khuTrungBenVung })`).
 *
 * Lỗ đo được: `checkEdgeOwnedFactoryDrift` chống lặp bằng một Set TRONG BỘ NHỚ ⇒ mỗi lần khởi động lại (instance e2e, restart production) nó rỗng và bắn LẠI
 * cùng một nhà máy-lệch cho MỌI quản trị viên / giám sát. Ở CSDL test: 1,8 triệu hàng `edge_owner_factory_drift` (329 người nhận × ~5.500 lần khởi động) ⇒ truy vấn đếm thông
 * báo treo 40–60 s, e2e quá hạn. Test này chứng minh: BOOT LẠI NHIỀU LẦN (mô phỏng: gọi lại với cùng khoá) KHÔNG nhân đôi số hàng; cảnh báo THEO LẦN xảy ra (khoá có `Date.now()`) KHÔNG
 * bị nuốt; cửa sổ hết hạn thì ghi lại; lỗi kiểm trùng ⇒ vẫn gửi (an toàn nghiêng về gửi).
 * CSDL `_test` THẬT; người nhận riêng tiền tố `ksat` (dọn sau).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../../db/connection";
import { __quenBoNhoKhuTrungChoTest, raiseCriticalStopAlert } from "./criticalStopAlert";

const TT = `ksat${Date.now().toString(36)}`;
let db!: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const users: number[] = [];

async function dem(userId: number, khoa: string): Promise<number> {
  const r = (await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${userId} AND metadata->>'dedupKey' = ${khoa}`)) as unknown as { n: number }[];
  return r[0].n;
}
async function demKind(userId: number, kind: string): Promise<number> {
  const r = (await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${userId} AND metadata->>'kind' = ${kind}`)) as unknown as { n: number }[];
  return r[0].n;
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  for (const ten of ["a", "b"]) {
    const [u] = (await db.execute(
      sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
          VALUES (${`${TT}-${ten}`}, ${`${TT}_${ten}`}, ${"KSAT " + ten}, 'password', 'admin', true, false, now()) RETURNING id`,
    )) as unknown as { id: number }[];
    users.push(Number(u.id));
  }
  // Khởi động nguội: lần gọi đầu nạp ecosystemEvents/notificationService (chậm khi máy bận) và có thể chạm trần 10 s của withDeadline — làm nóng TRƯỚC khi đo,
  // nếu không các lượt nền chưa xong của lần nguội chạy song song với lần đo và làm sai phép đếm.
  await raiseCriticalStopAlert({ kind: `${TT}_warm`, title: 'w', message: 'w', recipients: [users[0]], dedupKey: `${TT}:warm`, khuTrungBenVung: {} });
  await new Promise((r) => setTimeout(r, 1500));
}, 120_000);

afterAll(async () => {
  if (!db) return;
  if (users.length) {
    const u = sql.join(users.map((i) => sql`${i}`), sql`, `);
    await db.execute(sql`DELETE FROM notifications WHERE "userId" IN (${u})`);
    await db.execute(sql`DELETE FROM users WHERE id IN (${u})`).catch(() => undefined);
  }
}, 60_000);

const bao = (khoa: string, extra: Partial<Parameters<typeof raiseCriticalStopAlert>[0]> = {}) =>
  raiseCriticalStopAlert({ kind: `${TT}_drift`, title: "t", message: "m", recipients: users, dedupKey: khoa, entityType: "robot", entityId: 1, ...extra });

describe("khuTrungBenVung — boot lại KHÔNG nhân đôi số hàng", () => {
  it("bắn MƯỜI lần cùng khoá (mô phỏng mười lần khởi động: Set trong bộ nhớ rỗng mỗi lần) ⇒ mỗi người nhận ĐÚNG MỘT hàng", async () => {
    const khoa = `${TT}:drift:robot:1:`;
    for (let i = 0; i < 10; i++) {
      __quenBoNhoKhuTrungChoTest(); // KHỞI ĐỘNG LẠI: bộ nhớ trong tiến trình rỗng ⇒ chỉ khử trùng BỀN VỮNG (CSDL) còn tác dụng
      await bao(khoa, { khuTrungBenVung: {} });
    }
    for (const u of users) expect(await dem(u, khoa), `người nhận ${u}`).toBe(1);
  });

  it("KHÔNG có khuTrungBenVung (cảnh báo THEO LẦN, khoá có Date.now()) ⇒ mọi lần đều ghi — không bị nuốt", async () => {
    for (let i = 0; i < 3; i++) await bao(`${TT}:cannot_list:${Date.now()}:${i}`);
    for (const u of users) expect(await demKind(u, `${TT}_drift`)).toBeGreaterThanOrEqual(3);
    // và hàng của cảnh báo theo lần KHÔNG mang dedupKey trong metadata (không lẫn vào cơ chế khử trùng)
    const r = (await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${users[0]} AND metadata->>'dedupKey' LIKE ${`${TT}:cannot_list:%`}`)) as unknown as { n: number }[];
    expect(r[0].n).toBe(0);
  });

  it("khoá KHÁC ⇒ hàng mới (khử trùng theo (người nhận, khoá), không theo loại)", async () => {
    const k1 = `${TT}:drift:robot:2:`;
    const k2 = `${TT}:drift:robot:3:`;
    await bao(k1, { khuTrungBenVung: {} });
    await bao(k2, { khuTrungBenVung: {} });
    __quenBoNhoKhuTrungChoTest();
    await bao(k1, { khuTrungBenVung: {} });
    for (const u of users) {
      expect(await dem(u, k1)).toBe(1);
      expect(await dem(u, k2)).toBe(1);
    }
  });

  it("người nhận MỚI cùng khoá ⇒ chỉ người mới được ghi (người cũ giữ một hàng)", async () => {
    const khoa = `${TT}:drift:robot:4:`;
    await bao(khoa, { khuTrungBenVung: {}, recipients: [users[0]] });
    __quenBoNhoKhuTrungChoTest();
    await bao(khoa, { khuTrungBenVung: {}, recipients: users });
    expect(await dem(users[0], khoa)).toBe(1);
    expect(await dem(users[1], khoa)).toBe(1);
  });

  it("hết cửa sổ ⇒ ghi lại (cảnh báo còn hiệu lực sau 24 giờ phải nhắc lại); cửa sổ đổi được qua tham số", async () => {
    const khoa = `${TT}:drift:robot:5:`;
    await bao(khoa, { khuTrungBenVung: { windowMs: 30 } });
    await new Promise((r) => setTimeout(r, 120));
    await bao(khoa, { khuTrungBenVung: { windowMs: 30 } });
    expect(await dem(users[0], khoa)).toBe(2);
  });

  it("biến môi trường STOP_ALERT_DEDUP_WINDOW_MS đổi cửa sổ mặc định", async () => {
    const khoa = `${TT}:drift:robot:6:`;
    process.env.STOP_ALERT_DEDUP_WINDOW_MS = "30";
    try {
      await bao(khoa, { khuTrungBenVung: {} });
      await new Promise((r) => setTimeout(r, 120));
      await bao(khoa, { khuTrungBenVung: {} });
    } finally {
      delete process.env.STOP_ALERT_DEDUP_WINDOW_MS;
    }
    expect(await dem(users[0], khoa)).toBe(2);
  });

  it("kiểm trùng LỖI ⇒ vẫn GỬI (an toàn nghiêng về gửi, không nuốt cảnh báo)", async () => {
    const khoa = `${TT}:drift:robot:7:`;
    const spy = vi.spyOn(db, "selectDistinct").mockImplementation(() => {
      throw new Error("db boom");
    });
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await bao(khoa, { khuTrungBenVung: {} });
    } finally {
      spy.mockRestore();
      loi.mockRestore();
    }
    for (const u of users) expect(await dem(u, khoa)).toBe(1);
  });
});

describe("gốc: checkEdgeOwnedFactoryDrift dùng khử trùng bền vững", () => {
  it("lời gọi raiseCriticalStopAlert của quét lệch nhà máy mang khuTrungBenVung (nếu ai bỏ ⇒ mỗi lần boot lại nhân hàng)", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/robot/deviceOwnershipService.ts"), "utf8");
    const i = src.indexOf('kind: "edge_owner_factory_drift"');
    expect(i).toBeGreaterThan(0);
    const khoi = src.slice(i, i + 1600);
    expect(khoi).toMatch(/khuTrungBenVung:\s*\{/);
  });
});

describe("khử trùng bền vững — ca chạy CHỒNG (cùng tiến trình) không ghi hai hàng", () => {
  it("hai lượt gọi đồng thời cùng khoá ⇒ mỗi người nhận một hàng", async () => {
    const khoa = `${TT}:drift:robot:8:`;
    __quenBoNhoKhuTrungChoTest();
    await Promise.all([bao(khoa, { khuTrungBenVung: {} }), bao(khoa, { khuTrungBenVung: {} }), bao(khoa, { khuTrungBenVung: {} })]);
    for (const u of users) expect(await dem(u, khoa)).toBe(1);
  });
});
