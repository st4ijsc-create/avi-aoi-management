/**
 * SCADA R1a Task 16 — BỘ ĐẾM TOTP SAI theo người dùng, trên CSDL `_test` THẬT (mig 0432).
 *
 *   5 lần sai trong 5 phút ⇒ TOTP của người đó TẠM KHOÁ 5 phút. Bộ đếm sống trong `verifyTotpOnce` (mọi bên gọi dùng chung), chỉ ở
 *   DB (`totp_khoa_sai`), fail-closed (`TOTP_KHONG_KIEM_DUOC`). Audit lần sai thứ 5 + mỗi lần bị từ chối vì đang khoá, không ghi mã.
 *   Không lộ số lần sai còn lại. Admin mở khoá (`twoFactor.moKhoaTotp`) xoá hàng + audit trong CÙNG giao dịch.
 *
 * ⚠ "ĐỒNG HỒ GIẢ": bộ đếm đọc `now()` của Postgres (một đồng hồ — cùng quyết định với sổ `totp_consumed`, xem `dongHoSo()` ở totpOnce.ts), nên `nowMs` của
 *   người gọi KHÔNG chạm được nó. "Trôi 5 phút" = LÀM GIÀ HÀNG trong DB (`khoa_den`/`cua_so_bat_dau` lùi lại), đúng cách
 *   `totpLedgerDurable.test.ts` thử một mục sổ đã quá hạn. `nowMs` chỉ dùng để đúc mã ĐÚNG khác nhau ở các nhịp khác nhau.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import speakeasy from "speakeasy";
import { sql } from "drizzle-orm";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

/** Chỗ cấy LỖI DB vào đúng một bước của bộ đếm (đọc / ghi lần sai / xoá) — hàm thật chạy ở mọi lượt khác. */
const H = vi.hoisted(() => ({ hong: null as null | "doc" | "ghi" | "xoa" }));
vi.mock("./totpKhoaSai", async (orig) => {
  const real = await orig<typeof import("./totpKhoaSai")>();
  const boc =
    <A extends unknown[], R>(buoc: "doc" | "ghi" | "xoa", f: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (H.hong === buoc) throw new Error(`probe: DB của bộ đếm hỏng ở bước ${buoc} (connection terminated)`);
      return f(...a);
    };
  return {
    ...real,
    docKhoaTotp: boc("doc", real.docKhoaTotp),
    ghiLanSaiTotp: boc("ghi", real.ghiLanSaiTotp),
    xoaBoDemTotp: boc("xoa", real.xoaBoDemTotp),
  };
});

import { getDb } from "../db/connection";
import { verifyTotpOnce, __resetSoTotpChoTest } from "./totpOnce";
import { SO_LAN_SAI_TOI_DA, CUA_SO_SAI_MS, THOI_GIAN_KHOA_MS } from "./totpKhoaSai";
import { kiemXacThucTheoMuc } from "./xacThucTheoMuc";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const RUN = `t16${process.pid}${Date.now().toString(36)}`;

const SECRET = speakeasy.generateSecret({ length: 20 }).base32;
const SECRET_B = speakeasy.generateSecret({ length: 20 }).base32;
const ids: number[] = [];

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

/** Mã ĐÚNG ở một thời điểm `nowMs` (đi kèm `nowMs` cho verify). Mỗi `nowMs` cách nhau ≥ 90 s cho một mã chưa tiêu. */
let nhip = 0;
function maDung(secret = SECRET): { token: string; nowMs: number } {
  nhip += 1;
  const nowMs = Date.now() + nhip * 10 * 60_000; // mỗi lượt một nhịp xa ⇒ mã khác, không trùng sổ chống phát lại
  return { token: speakeasy.totp({ secret, encoding: "base32", time: Math.floor(nowMs / 1000) }), nowMs };
}
/** Mã SAI chắc chắn (không trùng mã của nhịp −1/0/+1 ở thời điểm thật). */
function maSai(secret = SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  const dung3 = new Set([-30, 0, 30].map((d) => speakeasy.totp({ secret, encoding: "base32", time: t + d })));
  for (let i = 0; ; i++) {
    const c = String(100000 + ((i * 7919 + 12345) % 900000));
    if (!dung3.has(c)) return c;
  }
}

async function nguoiMoi(tag: string, role: "admin" | "operator" | "engineer" = "engineer") {
  const u = await taoNguoiDungTest(`${tag}`, role, { tienTo: "t16", ts: RUN, ten: `T16 ${tag}` });
  ids.push(u.id);
  return u;
}
async function hang(userId: number) {
  const r = await dung(sql`SELECT so_lan_sai AS n, khoa_den IS NOT NULL AS khoa, (khoa_den > now()) AS dang_khoa FROM totp_khoa_sai WHERE user_id = ${userId}`);
  return r[0] as { n: number; khoa: boolean; dang_khoa: boolean } | undefined;
}
async function soAudit(userId: number, action: string): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(userId)} AND action = ${action}`);
  return Number(r.n);
}
async function auditCua(userId: number) {
  return dung(sql`SELECT action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(userId)} ORDER BY id`);
}
/** "Đồng hồ giả": dời mọi mốc của hàng lùi `ms` — tương đương `now()` tiến `ms`. */
async function troi(userId: number, ms: number) {
  await dung(sql`UPDATE totp_khoa_sai SET cua_so_bat_dau = cua_so_bat_dau - make_interval(secs => ${ms / 1000}),
    khoa_den = khoa_den - make_interval(secs => ${ms / 1000}) WHERE user_id = ${userId}`);
}
async function sai(userId: number, secret = SECRET) {
  return verifyTotpOnce({ userId, secret, token: maSai(secret) });
}

beforeAll(async () => {
  expect(process.env.ROLE ?? "", "sổ TOTP từ chối ROLE=worker theo thiết kế").not.toBe("worker");
  const d = await getDb();
  expect(d, "cần CSDL _test").toBeTruthy();
  db = d!;
});
afterAll(async () => {
  H.hong = null;
  if (ids.length) {
    await __resetSoTotpChoTest(ids); // totp_consumed + totp_khoa_sai của người test
    const [r] = await dung(sql`SELECT count(*)::int AS n FROM totp_khoa_sai WHERE user_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    expect(Number(r.n), "_test sạch: không còn hàng totp_khoa_sai của người test").toBe(0);
  }
});

describe("§0 hằng số (brief Task 16, nguyên văn)", () => {
  it("5 lần / 5 phút / khoá 5 phút", () => {
    expect([SO_LAN_SAI_TOI_DA, CUA_SO_SAI_MS, THOI_GIAN_KHOA_MS]).toEqual([5, 300_000, 300_000]);
  });
});

describe("§1 khoá sau 5 lần sai", () => {
  it("sai 5 lần ⇒ lần 6 với mã ĐÚNG bị TOTP_TAM_KHOA, mã KHÔNG bị tiêu", async () => {
    const u = await nguoiMoi("khoa5");
    for (let i = 1; i <= 4; i++) {
      const r = await sai(u.id);
      expect(r, `lần sai ${i}`).toEqual({ hopLe: false, phatLai: false });
    }
    const r5 = await sai(u.id);
    expect(r5.hopLe).toBe(false);
    expect(r5.ma).toBe("TOTP_TAM_KHOA");
    expect(r5.conLaiMs).toBeGreaterThan(THOI_GIAN_KHOA_MS - 30_000);
    expect(r5.conLaiMs).toBeLessThanOrEqual(THOI_GIAN_KHOA_MS);
    expect(await hang(u.id)).toMatchObject({ n: 5, dang_khoa: true });

    const dung6 = maDung();
    const r6 = await verifyTotpOnce({ userId: u.id, secret: SECRET, token: dung6.token, nowMs: dung6.nowMs });
    expect(r6).toMatchObject({ hopLe: false, phatLai: false, ma: "TOTP_TAM_KHOA" });
    expect(r6.conLaiMs).toBeGreaterThan(0);
    const [tieu] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${u.id}`);
    expect(Number(tieu.n), "đang khoá ⇒ không kiểm, không tiêu mã").toBe(0);
    expect((await hang(u.id))?.n, "lần bị từ chối vì khoá không cộng thêm").toBe(5);
  });

  it("hết 5 phút (đồng hồ giả) ⇒ mã đúng qua, hàng bị xoá", async () => {
    const u = await nguoiMoi("hetkhoa");
    for (let i = 0; i < 5; i++) await sai(u.id);
    expect((await hang(u.id))?.dang_khoa).toBe(true);
    await troi(u.id, THOI_GIAN_KHOA_MS + 1_000);
    expect((await hang(u.id))?.dang_khoa).toBe(false);
    const m = maDung();
    const r = await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(r).toEqual({ hopLe: true, phatLai: false });
    expect(await hang(u.id)).toBeUndefined();
  });

  it("hết khoá rồi sai tiếp ⇒ cửa sổ MỚI (đếm lại từ 1, không khoá ngay)", async () => {
    const u = await nguoiMoi("hetkhoasai");
    for (let i = 0; i < 5; i++) await sai(u.id);
    await troi(u.id, THOI_GIAN_KHOA_MS + 1_000);
    expect(await sai(u.id)).toEqual({ hopLe: false, phatLai: false });
    expect(await hang(u.id)).toMatchObject({ n: 1, khoa: false });
  });

  it("2 người dùng độc lập: A bị khoá, B vẫn qua", async () => {
    const a = await nguoiMoi("docLapA");
    const b = await nguoiMoi("docLapB");
    for (let i = 0; i < 5; i++) await sai(a.id);
    await sai(b.id, SECRET_B);
    const mb = maDung(SECRET_B);
    expect(await verifyTotpOnce({ userId: b.id, secret: SECRET_B, token: mb.token, nowMs: mb.nowMs })).toEqual({ hopLe: true, phatLai: false });
    expect(await hang(b.id)).toBeUndefined();
    const ma = maDung();
    expect((await verifyTotpOnce({ userId: a.id, secret: SECRET, token: ma.token, nowMs: ma.nowMs })).ma).toBe("TOTP_TAM_KHOA");
  });

  it("sai 4 lần rồi ĐÚNG ⇒ hàng bị xoá (lần sai sau đếm lại từ 1)", async () => {
    const u = await nguoiMoi("sai4dung");
    for (let i = 0; i < 4; i++) await sai(u.id);
    expect((await hang(u.id))?.n).toBe(4);
    const m = maDung();
    expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({ hopLe: true, phatLai: false });
    expect(await hang(u.id)).toBeUndefined();
    await sai(u.id);
    expect((await hang(u.id))?.n).toBe(1);
  });

  it("các lần sai cách nhau QUÁ 5 phút ⇒ không bao giờ khoá (cửa sổ reset)", async () => {
    const u = await nguoiMoi("raiRac");
    for (let i = 0; i < 8; i++) {
      const r = await sai(u.id);
      expect(r, `lần sai rải rác ${i + 1}`).toEqual({ hopLe: false, phatLai: false });
      await troi(u.id, CUA_SO_SAI_MS + 1_000);
    }
    expect(await hang(u.id)).toMatchObject({ n: 1, khoa: false });
  });

  it("4 sai ⇒ quá 5 phút ⇒ 4 sai nữa: vẫn không khoá (đếm lại trong cửa sổ mới)", async () => {
    const u = await nguoiMoi("haiCuaSo");
    for (let i = 0; i < 4; i++) await sai(u.id);
    await troi(u.id, CUA_SO_SAI_MS + 1_000);
    for (let i = 0; i < 4; i++) expect(await sai(u.id)).toEqual({ hopLe: false, phatLai: false });
    expect(await hang(u.id)).toMatchObject({ n: 4, khoa: false });
  });

  it("PHÁT LẠI một mã đã tiêu = một lần sai (QĐ T16: lượt phát lại là một lần thử SAI)", async () => {
    const u = await nguoiMoi("phatLai");
    const m = maDung();
    expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({ hopLe: true, phatLai: false });
    const lai = await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(lai).toEqual({ hopLe: false, phatLai: true });
    expect((await hang(u.id))?.n).toBe(1);
    for (let i = 0; i < 4; i++) await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(await hang(u.id)).toMatchObject({ n: 5, dang_khoa: true });
  });

  it("CÙNG lượt gọi (cùng `luot`) verify cùng mã nhiều lần KHÔNG phải phát lại ⇒ không đếm", async () => {
    const u = await nguoiMoi("cungLuot");
    const m = maDung();
    for (let i = 0; i < 3; i++) {
      expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs, luot: `${RUN}-luot` })).toEqual({ hopLe: true, phatLai: false });
    }
    expect(await hang(u.id)).toBeUndefined();
  });
});

describe("§2 đồng thời — upsert nguyên tử", () => {
  it("hai lần sai đồng thời ⇒ đếm ĐÚNG 2", async () => {
    const u = await nguoiMoi("dongThoi2");
    await Promise.all([sai(u.id), sai(u.id)]);
    expect((await hang(u.id))?.n).toBe(2);
  });

  it("sáu lần sai đồng thời ⇒ đếm 6, khoá, ĐÚNG MỘT dòng audit 'bắt đầu khoá'", async () => {
    const u = await nguoiMoi("dongThoi6");
    const kq = await Promise.all(Array.from({ length: 6 }, () => sai(u.id)));
    expect(await hang(u.id)).toMatchObject({ n: 6, dang_khoa: true });
    expect(kq.filter((r) => r.ma === "TOTP_TAM_KHOA").length).toBeGreaterThanOrEqual(2); // lần 5 và 6
    expect(await soAudit(u.id, "totp.tam_khoa")).toBe(1);
  });
});

describe("§3 fail-closed — lỗi DB của bộ đếm ⇒ TỪ CHỐI (TOTP_KHONG_KIEM_DUOC), không bao giờ 'không giới hạn'", () => {
  it("lỗi đọc khoá ⇒ mã ĐÚNG bị từ chối, không tiêu mã", async () => {
    const u = await nguoiMoi("hongDoc");
    const m = maDung();
    H.hong = "doc";
    try {
      expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({
        hopLe: false,
        phatLai: false,
        ma: "TOTP_KHONG_KIEM_DUOC",
      });
    } finally {
      H.hong = null;
    }
    const [tieu] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${u.id}`);
    expect(Number(tieu.n)).toBe(0);
  });

  it("lỗi DB THẬT (không giả lập): userId ngoài dải integer ⇒ câu đọc khoá ném 22003 ⇒ TOTP_KHONG_KIEM_DUOC", async () => {
    const m = maDung();
    const r = await verifyTotpOnce({ userId: 3_000_000_000, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(r).toEqual({ hopLe: false, phatLai: false, ma: "TOTP_KHONG_KIEM_DUOC" });
  });

  it("lỗi ghi lần sai ⇒ TOTP_KHONG_KIEM_DUOC (không rơi về 'mã sai' như chưa có bộ đếm)", async () => {
    const u = await nguoiMoi("hongGhi");
    H.hong = "ghi";
    try {
      expect(await sai(u.id)).toEqual({ hopLe: false, phatLai: false, ma: "TOTP_KHONG_KIEM_DUOC" });
    } finally {
      H.hong = null;
    }
  });

  it("lỗi xoá hàng khi mã đúng ⇒ TOTP_KHONG_KIEM_DUOC", async () => {
    const u = await nguoiMoi("hongXoa");
    await sai(u.id);
    const m = maDung();
    H.hong = "xoa";
    try {
      expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({
        hopLe: false,
        phatLai: false,
        ma: "TOTP_KHONG_KIEM_DUOC",
      });
    } finally {
      H.hong = null;
    }
  });
});

describe("§4 audit — lần sai thứ 5 + mỗi lần bị từ chối vì khoá; không ghi mã", () => {
  it("5 sai ⇒ 1 dòng 'totp.tam_khoa'; 3 lần thử khi đang khoá ⇒ 3 dòng 'totp.tu_choi_dang_khoa'; không dòng nào mang mã", async () => {
    const u = await nguoiMoi("audit");
    const maDaGui: string[] = [];
    for (let i = 0; i < 4; i++) {
      await sai(u.id);
      expect(await soAudit(u.id, "totp.tam_khoa"), "lần 1–4 không audit").toBe(0);
    }
    const c5 = maSai();
    maDaGui.push(c5);
    await verifyTotpOnce({ userId: u.id, secret: SECRET, token: c5 });
    expect(await soAudit(u.id, "totp.tam_khoa")).toBe(1);
    for (let i = 0; i < 3; i++) {
      const m = maDung();
      maDaGui.push(m.token);
      await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs });
    }
    expect(await soAudit(u.id, "totp.tu_choi_dang_khoa")).toBe(3);
    expect(await soAudit(u.id, "totp.tam_khoa"), "lần thử khi khoá không đẻ thêm dòng 'bắt đầu khoá'").toBe(1);
    const rows = await auditCua(u.id);
    const json = JSON.stringify(rows);
    for (const c of maDaGui) expect(json, `audit không được chứa mã ${c}`).not.toContain(c);
    expect(json).not.toContain(SECRET);
    for (const r of rows) expect(r.actorId).toBe(u.id);
  });
});

describe("§5 không lộ số lần sai còn lại", () => {
  it("kết quả verify chỉ mang hopLe/phatLai/ma/conLaiMs — không có ô đếm", async () => {
    const u = await nguoiMoi("khongLo");
    for (let i = 0; i < 6; i++) {
      const r = await sai(u.id);
      for (const k of Object.keys(r)) expect(["hopLe", "phatLai", "ma", "conLaiMs"]).toContain(k);
    }
  });

  it("lỗi tRPC (twoFactor.regenerateBackupCodes): mã sai ⇒ INVALID_VALUE{field}; tạm khoá ⇒ TOTP_TAM_KHOA{remainingMinutes}; không số lần", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("trpcLoi");
    await setup2FA(u.id, SECRET);
    await enable2FA(u.id);
    const caller = twoFactorRouter.createCaller({ user: { id: u.id, role: u.role, name: u.name, twoFactorEnabled: true } } as never);
    const loi = async (code: string) => {
      try {
        await caller.regenerateBackupCodes({ code });
      } catch (e) {
        const x = e as { code?: string; message: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
        return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams ?? {} };
      }
      throw new Error("mong đợi lỗi");
    };
    for (let i = 0; i < 4; i++) {
      const e = await loi(maSai());
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
      expect(Object.keys(e.appParams)).toEqual(["field"]);
      expect(e.message).not.toMatch(/\d/);
    }
    const e5 = await loi(maSai());
    expect(e5).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "TOTP_TAM_KHOA", appParams: { remainingMinutes: 5 } });
    expect(Object.keys(e5.appParams)).toEqual(["remainingMinutes"]);
    const e6 = await loi(maSai());
    expect(e6.appCode).toBe("TOTP_TAM_KHOA");
    expect(Object.keys(e6.appParams)).toEqual(["remainingMinutes"]);
    // Câu chỉ được nói "tạm khoá, thử lại sau N phút": không "còn N lần", không "N lần", không "attempts left/remaining".
    expect(e6.message).not.toMatch(/\d+\s*lần|còn\s*\d+|attempts?\s*(left|remaining)|remaining\s*attempts?|\d+\s*attempts?/i);
    expect(e6.message).toMatch(/thử lại sau \d+ phút/);
  });

  it("twoFactor.verify khi đang khoá: mã 6 số ĐÚNG ⇒ TOTP_TAM_KHOA (không rơi xuống nhánh mã dự phòng thành 'mã sai')", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("trpcVerify");
    await setup2FA(u.id, SECRET);
    await enable2FA(u.id);
    for (let i = 0; i < 5; i++) await sai(u.id);
    const caller = twoFactorRouter.createCaller({ user: { id: u.id, role: u.role, name: u.name, twoFactorEnabled: true } } as never);
    // Mã ĐÚNG ở đồng hồ THẬT (thủ tục không nhận `nowMs`) — chưa ai tiêu.
    const maThat = speakeasy.totp({ secret: SECRET, encoding: "base32" });
    await expect(caller.verify({ code: maThat })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", cause: { appCode: "TOTP_TAM_KHOA" } });
    const [tieu] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${u.id}`);
    expect(Number(tieu.n), "đang khoá ⇒ mã đúng không bị tiêu").toBe(0);
  });

  it("kiemXacThucTheoMuc (mức 5) khi đang khoá ⇒ { ok:false, ma:'TOTP_TAM_KHOA', conLaiMs }", async () => {
    const u = await nguoiMoi("theoMuc", "admin");
    await setup2FA(u.id, SECRET);
    await enable2FA(u.id);
    for (let i = 0; i < 5; i++) await sai(u.id);
    const kq = await kiemXacThucTheoMuc({ user: { id: u.id, role: "admin", twoFactorEnabled: true }, sessionToken: null }, 5, maSai());
    expect(kq).toMatchObject({ ok: false, ma: "TOTP_TAM_KHOA" });
    expect((kq as { conLaiMs: number }).conLaiMs).toBeGreaterThan(0);
    H.hong = "doc";
    try {
      expect(await kiemXacThucTheoMuc({ user: { id: u.id, role: "admin", twoFactorEnabled: true }, sessionToken: null }, 5, maSai())).toEqual({
        ok: false,
        ma: "TOTP_KHONG_KIEM_DUOC",
      });
    } finally {
      H.hong = null;
    }
  });
});

describe("§6 admin mở khoá — twoFactor.moKhoaTotp", () => {
  it("admin mở khoá ⇒ hàng bị xoá + đúng 1 dòng audit 'totp.mo_khoa' có lyDo; mã đúng qua ngay", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("moKhoaDich");
    const admin = await nguoiMoi("moKhoaAdmin", "admin");
    for (let i = 0; i < 5; i++) await sai(u.id);
    expect((await hang(u.id))?.dang_khoa).toBe(true);
    const caller = twoFactorRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: true } } as never);
    const r = await caller.moKhoaTotp({ userId: u.id, lyDo: "người dùng gọi hỗ trợ, đã xác minh" });
    expect(r).toEqual({ success: true, daMoKhoa: true });
    expect(await hang(u.id)).toBeUndefined();
    const rows = (await auditCua(u.id)).filter((x) => x.action === "totp.mo_khoa");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: admin.id, reason: "người dùng gọi hỗ trợ, đã xác minh" });
    const m = maDung();
    expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({ hopLe: true, phatLai: false });
  });

  it("người không phải admin ⇒ FORBIDDEN, hàng còn nguyên, không audit", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("moKhoaDich2");
    const op = await nguoiMoi("moKhoaOp", "operator");
    for (let i = 0; i < 5; i++) await sai(u.id);
    const caller = twoFactorRouter.createCaller({ user: { id: op.id, role: "operator", name: op.name, twoFactorEnabled: true } } as never);
    await expect(caller.moKhoaTotp({ userId: u.id, lyDo: "tự mở cho bạn" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await hang(u.id))?.dang_khoa).toBe(true);
    expect(await soAudit(u.id, "totp.mo_khoa")).toBe(0);
  });

  it("lyDo ngoài 5..300 ký tự ⇒ BAD_REQUEST, không xoá", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("moKhoaLyDo");
    const admin = await nguoiMoi("moKhoaAdmin2", "admin");
    await sai(u.id);
    const caller = twoFactorRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: true } } as never);
    await expect(caller.moKhoaTotp({ userId: u.id, lyDo: "abc" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.moKhoaTotp({ userId: u.id, lyDo: "x".repeat(301) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await hang(u.id))?.n).toBe(1);
  });
});
