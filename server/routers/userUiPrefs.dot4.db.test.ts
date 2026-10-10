/**
 * doc 81 Đợt 4 Task D1 — `userSettingsRouter.getUiPrefs / setUiPrefs` trên `user_settings.uiPrefs` (mig 0365).
 * CSDL THẬT `_test`, `appRouter.createCaller` THẬT.
 *
 * Đo: danh sách trắng (khoá lạ / khoá mang id người khác / giá trị sai ⇒ BAD_REQUEST, KHÔNG ghi gì — kể cả các khoá hợp
 * lệ đi cùng); gộp `||` nguyên tử (20 lượt ghi song song khoá khác nhau ⇒ đủ 20); trần 16 KB của TỔNG sau gộp; phạm vi
 * CHÍNH người gọi. "Đi theo tài khoản qua hai trình duyệt" (đồng bộ client): `userUiPrefsHaiTrinhDuyet.dot4.db.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { appRouter } from "../routers";
import { UI_PREFS_MAX_BYTES } from "@shared/uiPrefs";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D4D1-${Date.now()}`;

let sql: ReturnType<typeof postgres>;
const fx = { a: 0, b: 0, c: 0 };

type Caller = ReturnType<typeof appRouter.createCaller>;
const goi = (id: number): Caller => appRouter.createCaller({ user: { id, role: "engineer", name: "probe" } } as never);

type KetQua = { ok: true; data: unknown } | { ok: false; code: string; appCode: string | null; msg: string };
async function thu(p: Promise<unknown>): Promise<KetQua> {
  try {
    return { ok: true, data: await p };
  } catch (e: unknown) {
    const err = e as { code?: string; cause?: { appCode?: string }; message?: string };
    return { ok: false, code: err?.code ?? "?", appCode: err?.cause?.appCode ?? null, msg: String(err?.message ?? "") };
  }
}

/** Hàng thật trong CSDL (oracle độc lập với router), BỎ khoá nội bộ `__order` (thứ tự dùng gần đây — fix 1 #5). */
async function hang(userId: number): Promise<Record<string, unknown> | null> {
  const r = await sql`SELECT "uiPrefs" AS p FROM user_settings WHERE "userId" = ${userId}`;
  if (!r.length) return null;
  const { __order: _bo, ...p } = r[0].p as Record<string, unknown>;
  return p;
}
/** Ghi qua router, phiên = `uid` (fix 1 #1: `expectedUserId` bắt buộc, mặc định = chính người gọi). */
const ghi = (uid: number, patch: Record<string, unknown>, expectedUserId = uid) =>
  goi(uid).userSettingsRouter.setUiPrefs({ patch, expectedUserId });

const hpx = (left: number, right: number) => ({ left: { px: left, pct: 20 }, right: { px: right, pct: 25 } });

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task D1 — user_settings.uiPrefs (CSDL _test)", () => {
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
    fx.c = await user("c");
  });

  afterAll(async () => {
    if (!sql) return;
    const uids = [fx.a, fx.b, fx.c].filter(Boolean);
    if (uids.length) {
      await sql`DELETE FROM user_settings WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(uids)}`;
    }
    await sql.end();
  });

  it("người chưa có hàng ⇒ {} và available:true", async () => {
    expect(await goi(fx.a).userSettingsRouter.getUiPrefs()).toEqual({ prefs: {}, available: true, userId: fx.a });
  });

  it("★ ghi showLabs + kích thước panel của CHÍNH mình ⇒ đọc lại đúng, hàng CSDL đúng", async () => {
    const kH = `layoutKit:ir-editor:u${fx.a}:hpx`;
    const kV = `layoutKit:ir-editor:u${fx.a}:vpx`;
    const kB = `layoutKit:ir-editor:u${fx.a}:bottomCollapsed`;
    const patch = { showLabs: true, [kH]: hpx(260, 380), [kV]: { bottom: { px: 220, pct: 30.5 } }, [kB]: false };
    await ghi(fx.a, patch);
    expect(await hang(fx.a)).toEqual(patch);
    expect((await goi(fx.a).userSettingsRouter.getUiPrefs()).prefs).toEqual(patch);
  });

  it("★ gộp: khoá mới THÊM vào, khoá cũ cùng tên bị THAY, khoá khác GIỮ nguyên", async () => {
    const kH = `layoutKit:ir-editor:u${fx.a}:hpx`;
    const kH2 = `layoutKit:pou-studio:u${fx.a}:hpx`;
    await ghi(fx.a, { showLabs: false, [kH2]: { left: { px: 240, pct: 18 } } });
    const p = (await hang(fx.a))!;
    expect(p.showLabs).toBe(false);
    expect(p[kH2]).toEqual({ left: { px: 240, pct: 18 } });
    expect(p[kH]).toEqual(hpx(260, 380));
  });

  const TU_CHOI: Array<[string, (uid: number, other: number) => Record<string, unknown>]> = [
    ["khoá lạ", () => ({ theme: "dark" })],
    ["khoá lạ giống bố cục (part lạ)", (u) => ({ [`layoutKit:ide:u${u}:split`]: 30 })],
    ["khoá Labs cục bộ thay vì showLabs", (u) => ({ [`layoutKit:nav-labs:u${u}:show`]: true })],
    ["khoá bố cục mang id NGƯỜI KHÁC", (_u, o) => ({ [`layoutKit:ide:u${o}:hpx`]: hpx(250, 330) })],
    ["showLabs không phải boolean", () => ({ showLabs: "1" })],
    ["px âm", (u) => ({ [`layoutKit:ide:u${u}:hpx`]: { left: { px: -1, pct: 10 } } })],
    ["px quá trần", (u) => ({ [`layoutKit:ide:u${u}:hpx`]: { left: { px: 5000, pct: 10 } } })],
    ["pct > 100", (u) => ({ [`layoutKit:ide:u${u}:vpx`]: { bottom: { px: 200, pct: 101 } } })],
    ["khoá con lạ trong hpx", (u) => ({ [`layoutKit:ide:u${u}:hpx`]: { bottom: { px: 200, pct: 20 } } })],
    ["trường thừa trong kích thước", (u) => ({ [`layoutKit:ide:u${u}:hpx`]: { left: { px: 200, pct: 20, x: 1 } } })],
    ["bottomCollapsed là chuỗi", (u) => ({ [`layoutKit:ide:u${u}:bottomCollapsed`]: "1" })],
  ];
  for (const [ten, mk] of TU_CHOI) {
    it(`★ từ chối (${ten}) ⇒ BAD_REQUEST / INVALID_VALUE, KHÔNG ghi gì — kể cả khoá hợp lệ đi cùng`, async () => {
      const truoc = await hang(fx.a);
      const kem = `layoutKit:accomp:u${fx.a}:bottomCollapsed`; // khoá HỢP LỆ đi cùng
      const k = await thu(ghi(fx.a, { [kem]: true, ...mk(fx.a, fx.b) }));
      expect(k.ok).toBe(false);
      if (!k.ok) {
        expect(k.code).toBe("BAD_REQUEST");
        expect(k.appCode).toBe("INVALID_VALUE");
      }
      expect(await hang(fx.a)).toEqual(truoc);
      expect(truoc!.showLabs).toBe(false);
      expect(kem in truoc!).toBe(false); // khoá hợp lệ đi cùng KHÔNG được ghi
    });
  }

  it("★ khoá mang id người khác KHÔNG chạm hàng của người kia", async () => {
    await thu(ghi(fx.a, { [`layoutKit:ide:u${fx.b}:hpx`]: hpx(250, 330) }));
    expect(await hang(fx.b)).toBeNull();
  });

  it("★ phạm vi: B không thấy sở thích của A; B ghi không đổi hàng của A", async () => {
    const truocA = await hang(fx.a);
    expect((await goi(fx.b).userSettingsRouter.getUiPrefs()).prefs).toEqual({});
    await ghi(fx.b, { showLabs: true });
    expect(await hang(fx.b)).toEqual({ showLabs: true });
    expect(await hang(fx.a)).toEqual(truocA);
  });

  it("★ gộp NGUYÊN TỬ: 20 lượt ghi song song, mỗi lượt một khoá khác ⇒ đủ 20 khoá (không mất lượt nào)", async () => {
    const c = goi(fx.c);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => c.userSettingsRouter.setUiPrefs({ patch: { [`layoutKit:p${i}:u${fx.c}:hpx`]: hpx(240 + i, 320) }, expectedUserId: fx.c })),
    );
    const p = (await hang(fx.c))!;
    expect(Object.keys(p).filter((k) => k.startsWith("layoutKit:p")).length).toBe(20);
  });

  it(`★ trần ${UI_PREFS_MAX_BYTES} byte: một bản vá quá lớn ⇒ BAD_REQUEST, không ghi`, async () => {
    const truoc = await hang(fx.b);
    const patch: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) patch[`layoutKit:big-${i}:u${fx.b}:hpx`] = hpx(260, 380);
    expect(JSON.stringify(patch).length).toBeGreaterThan(UI_PREFS_MAX_BYTES);
    const k = await thu(ghi(fx.b, patch));
    expect(k.ok ? "ok" : k.code).toBe("BAD_REQUEST");
    expect(await hang(fx.b)).toEqual(truoc);
  });

  it(`★ fix 1 #5 — chạm trần ${UI_PREFS_MAX_BYTES} byte: khoá BỐ CỤC CŨ NHẤT bị bỏ để lượt ghi mới thành công; showLabs và khoá của chính bản vá KHÔNG bao giờ bị bỏ`, async () => {
    await sql`UPDATE user_settings SET "uiPrefs" = '{"showLabs": true}'::jsonb WHERE "userId" = ${fx.b}`;
    const key = (i: number) => `layoutKit:fill-${i}:u${fx.b}:hpx`;
    const daGhi: number[] = [];
    const daBo: string[] = [];
    let i = 0;
    for (let vong = 0; vong < 9; vong++) {
      const patch: Record<string, unknown> = {};
      for (let j = 0; j < 20; j++, i++) {
        patch[key(i)] = hpx(260, 380);
        daGhi.push(i);
      }
      const r = (await ghi(fx.b, patch)) as { evicted?: string[] };
      daBo.push(...(r.evicted ?? []));
      const [{ n }] = await sql`SELECT octet_length("uiPrefs"::text) AS n FROM user_settings WHERE "userId" = ${fx.b}`;
      expect(Number(n)).toBeLessThanOrEqual(UI_PREFS_MAX_BYTES);
      const p = (await hang(fx.b))!;
      for (const k of Object.keys(patch)) expect(p[k], `khoá vừa ghi ${k}`).toEqual(hpx(260, 380));
      expect(p.showLabs).toBe(true);
    }
    expect(daBo.length).toBeGreaterThan(0); // 180 khoá × ~100 byte > 16 KB ⇒ phải có khoá bị bỏ
    const p = (await hang(fx.b))!;
    const conLai = daGhi.filter((n) => key(n) in p);
    // Bị bỏ = ĐÚNG các khoá CŨ NHẤT (một tiền tố của thứ tự ghi), còn lại = một hậu tố liền mạch.
    expect(daBo).toEqual(daGhi.slice(0, daBo.length).map(key));
    expect(conLai).toEqual(daGhi.slice(daBo.length));
    // Dùng LẠI một khoá cũ còn sống ⇒ nó thành MỚI NHẤT, không bị bỏ ở lượt sau.
    const songCu = key(conLai[0]);
    await ghi(fx.b, { [songCu]: hpx(250, 370) });
    const r2 = (await ghi(fx.b, { [key(9999)]: hpx(260, 380) })) as { evicted?: string[] };
    expect(r2.evicted).not.toContain(songCu);
    expect((await hang(fx.b))![songCu]).toEqual(hpx(250, 370));
    await sql`UPDATE user_settings SET "uiPrefs" = '{"showLabs": true}'::jsonb WHERE "userId" = ${fx.b}`;
  });

  it("fix 1 #5 — trần đo bằng CSDL, không chỉ ước lượng JS: số mũ (1e-7 ⇒ jsonb in '0.0000001', DÀI hơn) vẫn được bỏ khoá đủ, không lượt nào hỏng", async () => {
    await sql`UPDATE user_settings SET "uiPrefs" = '{"showLabs": true}'::jsonb WHERE "userId" = ${fx.b}`;
    const v = { left: { px: 1, pct: 1e-7 }, right: { px: 2, pct: 3e-7 } };
    for (let vong = 0; vong < 12; vong++) {
      const patch: Record<string, unknown> = {};
      for (let j = 0; j < 20; j++) patch[`layoutKit:mu-${vong}-${j}:u${fx.b}:hpx`] = v;
      const k = await thu(ghi(fx.b, patch));
      expect(k.ok, `vòng ${vong}: ${k.ok ? "" : k.msg}`).toBe(true);
      const [{ n }] = await sql`SELECT octet_length("uiPrefs"::text) AS n FROM user_settings WHERE "userId" = ${fx.b}`;
      expect(Number(n)).toBeLessThanOrEqual(UI_PREFS_MAX_BYTES);
    }
    await sql`UPDATE user_settings SET "uiPrefs" = '{"showLabs": true}'::jsonb WHERE "userId" = ${fx.b}`;
  });

  it("★ fix 1 #1 — phiên khác người (expectedUserId ≠ người gọi) ⇒ CONFLICT, KHÔNG ghi gì; đọc trả userId của phiên", async () => {
    const truocA = await hang(fx.a);
    const truocB = await hang(fx.b);
    const k = await thu(ghi(fx.b, { showLabs: false }, fx.a)); // tab cũ tưởng là A, cookie là B
    expect(k.ok ? "ok" : `${k.code}/${k.appCode}`).toBe("CONFLICT/INVALID_VALUE");
    expect(await hang(fx.a)).toEqual(truocA);
    expect(await hang(fx.b)).toEqual(truocB);
    expect((await goi(fx.b).userSettingsRouter.getUiPrefs()).userId).toBe(fx.b);
  });

  it("★ fix 1 #8 — đọc BỎ khoá bố cục mang id người khác và khoá nội bộ (hàng sửa tay)", async () => {
    await sql`UPDATE user_settings SET "uiPrefs" = "uiPrefs" || ${sql.json({ [`layoutKit:ide:u${fx.a}:hpx`]: hpx(250, 330), __order: ["x"] } as never)}::jsonb
              WHERE "userId" = ${fx.b}`;
    const p = (await goi(fx.b).userSettingsRouter.getUiPrefs()).prefs;
    expect(Object.keys(p)).not.toContain(`layoutKit:ide:u${fx.a}:hpx`);
    expect(Object.keys(p)).not.toContain("__order");
    expect(p.showLabs).toBe(true);
  });
});
