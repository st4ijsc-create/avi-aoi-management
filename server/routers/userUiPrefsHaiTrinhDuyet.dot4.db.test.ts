/**
 * doc 81 Đợt 4 Task D1 — "sở thích đi theo TÀI KHOẢN qua hai trình duyệt": hai bản `createUiPrefsSync` (client/src/lib/
 * uiPrefsSync.ts) với HAI kho cục bộ TÁCH BIỆT, nói chuyện với MỘT server THẬT (`appRouter.createCaller` → router →
 * CSDL `_test`). Không mock router, không mock CSDL; oracle = hàng `user_settings.uiPrefs` đọc thẳng bằng SQL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { appRouter } from "../routers";
import { createUiPrefsSync, UI_PREFS_APPLIED_EVENT, type UiPrefsTransport } from "../../client/src/lib/uiPrefsSync";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D4D1B-${Date.now()}`;

let sql: ReturnType<typeof postgres>;
const fx = { a: 0, b: 0 };

type Caller = ReturnType<typeof appRouter.createCaller>;
const goi = (id: number): Caller => appRouter.createCaller({ user: { id, role: "engineer", name: "probe" } } as never);

async function hang(userId: number): Promise<Record<string, unknown> | null> {
  const r = await sql`SELECT "uiPrefs" AS p FROM user_settings WHERE "userId" = ${userId}`;
  if (!r.length) return null;
  const { __order: _bo, ...p } = r[0].p as Record<string, unknown>; // khoá nội bộ thứ tự dùng (fix 1 #5)
  return p;
}

/** Kho cục bộ trong bộ nhớ — "một trình duyệt". */
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
const transportOf = (c: Caller, uid: number): UiPrefsTransport => ({
  get: () => c.userSettingsRouter.getUiPrefs(),
  set: (patch) => c.userSettingsRouter.setUiPrefs({ patch, expectedUserId: uid }),
});

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task D1 — hai trình duyệt, một tài khoản (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const user = async (tag: string) =>
      Number(
        (
          await sql`INSERT INTO users ("openId", username, name, role, "isActive")
                    VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`${DAU} ${tag}`}, 'engineer', true) RETURNING id`
        )[0].id,
      );
    fx.a = await user("a");
    fx.b = await user("b");
  });

  afterAll(async () => {
    if (!sql) return;
    const uids = [fx.a, fx.b].filter(Boolean);
    if (uids.length) {
      await sql`DELETE FROM user_settings WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(uids)}`;
    }
    await sql.end();
  });

  it("★★ trình duyệt 1 đổi sở thích ⇒ trình duyệt 2 (máy mới, kho rỗng) nhận đúng lúc đăng nhập; đổi ngược ⇒ trình duyệt 1 nhận", async () => {
    const kH = `layoutKit:engineering:u${fx.a}:hpx`;
    const kB = `layoutKit:engineering:u${fx.a}:bottomCollapsed`;
    const kLabs = `layoutKit:nav-labs:u${fx.a}:show`;
    const c = goi(fx.a);

    // Trình duyệt 1: bật Labs + kéo panel + gập panel dưới (hook ghi localStorage rồi đánh dấu).
    const kho1 = new MemStorage();
    const b1 = createUiPrefsSync({ userId: fx.a, transport: transportOf(c, fx.a), storage: kho1, events: new EventTarget(), debounceMs: 5 });
    await b1.start();
    kho1.setItem(kLabs, "1");
    kho1.setItem(kH, JSON.stringify({ left: { px: 288, pct: 21 } }));
    kho1.setItem(kB, "1");
    for (const k of [kLabs, kH, kB]) b1.markDirty(k);
    await b1.flush();
    expect(await hang(fx.a)).toEqual({ showLabs: true, [kH]: { left: { px: 288, pct: 21 } }, [kB]: true });

    // Trình duyệt 2 (máy mới): đăng nhập ⇒ sở thích của TÀI KHOẢN áp vào kho của nó + báo hook đang mở.
    const kho2 = new MemStorage();
    const ev2 = new EventTarget();
    const daBao: string[][] = [];
    ev2.addEventListener(UI_PREFS_APPLIED_EVENT, (e) => daBao.push((e as CustomEvent<string[]>).detail));
    const b2 = createUiPrefsSync({ userId: fx.a, transport: transportOf(c, fx.a), storage: kho2, events: ev2, debounceMs: 5 });
    await b2.start();
    expect(kho2.getItem(kLabs)).toBe("1");
    expect(JSON.parse(kho2.getItem(kH)!)).toEqual({ left: { px: 288, pct: 21 } });
    expect(kho2.getItem(kB)).toBe("1");
    expect(daBao.flat().sort()).toEqual([kB, kH, kLabs].sort());

    // Trình duyệt 2 tắt Labs ⇒ trình duyệt 1 thấy ở lần đăng nhập sau (server thắng bản đệm cũ "1").
    kho2.setItem(kLabs, "0");
    b2.markDirty(kLabs);
    await b2.flush();
    const b1b = createUiPrefsSync({ userId: fx.a, transport: transportOf(c, fx.a), storage: kho1, events: null, debounceMs: 5 });
    await b1b.start();
    expect(kho1.getItem(kLabs)).toBe("0");
    for (const s of [b1, b2, b1b]) s.stop();
  });

  it("★ khoá CHỈ có ở máy này được đẩy lên MỘT lần lúc đăng nhập; khoá server có thì server thắng; khoá người khác không đi", async () => {
    const kOnly = `layoutKit:recipes:u${fx.b}:vpx`;
    const kServer = `layoutKit:ir-editor:u${fx.b}:hpx`;
    const serverVal = { left: { px: 260, pct: 20 }, right: { px: 380, pct: 25 } };
    await goi(fx.b).userSettingsRouter.setUiPrefs({ patch: { [kServer]: serverVal }, expectedUserId: fx.b });
    const kho = new MemStorage();
    kho.setItem(kOnly, JSON.stringify({ bottom: { px: 210, pct: 28 } }));
    kho.setItem(kServer, JSON.stringify({ left: { px: 299, pct: 23 } }));
    kho.setItem(`layoutKit:ide:u${fx.a}:hpx`, JSON.stringify(serverVal)); // của người khác ⇒ không đẩy
    let sets = 0;
    const t = transportOf(goi(fx.b), fx.b);
    const s = createUiPrefsSync({ userId: fx.b, transport: { get: t.get, set: (p) => (sets++, t.set(p)) }, storage: kho, events: null });
    await s.start();
    expect(sets).toBe(1);
    expect(await hang(fx.b)).toEqual({ [kServer]: serverVal, [kOnly]: { bottom: { px: 210, pct: 28 } } });
    expect(JSON.parse(kho.getItem(kServer)!)).toEqual(serverVal);
    expect(Object.keys((await hang(fx.a)) ?? {})).not.toContain(`layoutKit:ide:u${fx.a}:hpx`);
    s.stop();
  });
});
