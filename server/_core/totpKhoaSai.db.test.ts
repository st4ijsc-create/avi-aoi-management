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

/** Chỗ cấy LỖI DB vào đúng một bước của bộ đếm (tính lượt / xoá sau mã đúng) — hàm thật chạy ở mọi lượt khác. */
const H = vi.hoisted(() => ({ hong: null as null | "nap" | "xoa", truocXoa: null as null | (() => Promise<void>) }));
vi.mock("./totpKhoaSai", async (orig) => {
  const real = await orig<typeof import("./totpKhoaSai")>();
  const boc =
    <A extends unknown[], R>(buoc: "nap" | "xoa", f: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (H.hong === buoc) throw new Error(`probe: DB của bộ đếm hỏng ở bước ${buoc} (connection terminated)`);
      return f(...a);
    };
  return {
    ...real,
    napLuotThu: boc("nap", real.napLuotThu),
    xoaSauKhiDung: async (...a: Parameters<typeof real.xoaSauKhiDung>) => {
      const f = H.truocXoa;
      if (f) {
        H.truocXoa = null;
        await f();
      }
      return boc("xoa", real.xoaSauKhiDung)(...a);
    },
  };
});

import { getDb } from "../db/connection";
import { verifyTotpOnce, __resetSoTotpChoTest } from "./totpOnce";
import {
  SO_LAN_SAI_TOI_DA,
  CUA_SO_SAI_MS,
  THOI_GIAN_KHOA_MS,
  MA_DU_PHONG_SO_LAN_TOI_DA,
  MA_DU_PHONG_CUA_SO_MS,
  AUDIT_TU_CHOI_MOI_MS,
  napLuotThu,
} from "./totpKhoaSai";
import { kiemXacThucTheoMuc } from "./xacThucTheoMuc";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA, quayVongMaDuPhong, verifyBackupCode } from "../db/auth";

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
  return hangLoai(userId, "totp");
}
async function hangLoai(userId: number, loai: "totp" | "backup") {
  const r = await dung(sql`SELECT so_lan_sai AS n, khoa_den IS NOT NULL AS khoa, (khoa_den > now()) AS dang_khoa, khoa_den::text AS den
    FROM totp_khoa_sai WHERE user_id = ${userId} AND loai = ${loai}`);
  return r[0] as { n: number; khoa: boolean; dang_khoa: boolean; den: string | null } | undefined;
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
    // mã dự phòng do lưới này cấp (quayVongMaDuPhong) — dọn TRƯỚC helper người dùng (FK backup_codes → users)
    await dung(sql`DELETE FROM backup_codes WHERE "userId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
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
    // fix round 1 — TÍNH TRƯỚC, KIỂM SAU: lượt bị từ chối vẫn được tính (6), khoá KHÔNG đổi.
    expect(await hang(u.id)).toMatchObject({ n: 6, dang_khoa: true });
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
  it("lỗi tính lượt (upsert bước 1) ⇒ mã ĐÚNG bị từ chối, không kiểm, không tiêu mã", async () => {
    const u = await nguoiMoi("hongDoc");
    const m = maDung();
    H.hong = "nap";
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

  it("lỗi DB THẬT (không giả lập): userId ngoài dải integer ⇒ câu tính lượt ném 22003 ⇒ TOTP_KHONG_KIEM_DUOC", async () => {
    const m = maDung();
    const r = await verifyTotpOnce({ userId: 3_000_000_000, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(r).toEqual({ hopLe: false, phatLai: false, ma: "TOTP_KHONG_KIEM_DUOC" });
  });

  it("lỗi tính lượt với mã SAI ⇒ TOTP_KHONG_KIEM_DUOC (không rơi về 'mã sai' như chưa có bộ đếm)", async () => {
    const u = await nguoiMoi("hongGhi");
    H.hong = "nap";
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
  it("5 sai ⇒ 1 dòng 'totp.tam_khoa'; 3 lần thử khi đang khoá trong 1 phút ⇒ 1 dòng 'totp.tu_choi_dang_khoa' (gộp, mang số lần); qua 1 phút ⇒ thêm 1 dòng; không dòng nào mang mã", async () => {
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
    // fix round 1 (minor 5) — nhiều nhất 1 dòng / người / phút cho lượt bị từ chối khi đang khoá.
    expect(await soAudit(u.id, "totp.tu_choi_dang_khoa")).toBe(1);
    expect(await soAudit(u.id, "totp.tam_khoa"), "lần thử khi khoá không đẻ thêm dòng 'bắt đầu khoá'").toBe(1);
    await dung(sql`UPDATE totp_khoa_sai SET tu_choi_audit_luc = tu_choi_audit_luc - make_interval(secs => ${AUDIT_TU_CHOI_MOI_MS / 1000 + 1})
      WHERE user_id = ${u.id} AND loai = 'totp'`);
    const m4 = maDung();
    maDaGui.push(m4.token);
    await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m4.token, nowMs: m4.nowMs });
    expect(await soAudit(u.id, "totp.tu_choi_dang_khoa"), "qua 1 phút ⇒ một dòng mới").toBe(2);
    const tuChoi = (await auditCua(u.id)).filter((x) => x.action === "totp.tu_choi_dang_khoa");
    expect(tuChoi.map((x) => x.afterJson?.soLanTuChoiTrongKhoa), "dòng audit mang số lần bị từ chối (cộng dồn trong lần khoá)").toEqual([1, 4]);
    const rows = await auditCua(u.id);
    const json = JSON.stringify(rows);
    for (const c of maDaGui) expect(json, `audit không được chứa mã ${c}`).not.toContain(c);
    expect(json).not.toContain(SECRET);
    for (const r of rows) expect(r.actorId).toBe(u.id);
  });
});

describe("§1b fix round 1 — TÍNH TRƯỚC, KIỂM SAU (CRITICAL 1) + reset không xoá khoá đang hiệu lực (CRITICAL 2)", () => {
  it("probe 30 sai + 1 dung dong thoi: mã ĐÚNG bị TỪ CHỐI, NHIỀU NHẤT 5 lượt tới speakeasy, mã đúng không bị tiêu", async () => {
    const u = await nguoiMoi("probe30");
    const t = Math.floor(Date.now() / 1000);
    const dung3 = new Set([-30, 0, 30].map((d) => speakeasy.totp({ secret: SECRET, encoding: "base32", time: t + d })));
    const sai30: string[] = [];
    for (let i = 0; sai30.length < 30; i++) {
      const c = String(100000 + ((i * 7919 + 12345) % 900000));
      if (!dung3.has(c)) sai30.push(c);
    }
    const maThat = speakeasy.totp({ secret: SECRET, encoding: "base32", time: t });
    const spy = vi.spyOn(speakeasy.totp, "verify");
    let soLuotKiem = -1;
    let kq: Awaited<ReturnType<typeof verifyTotpOnce>>[];
    try {
      // MỘT đợt song song (như một lô tRPC N lượt chạy bằng Promise.all), mã đúng ở CUỐI lô — đúng hình dạng probe của review.
      kq = await Promise.all([...sai30, maThat].map((token) => verifyTotpOnce({ userId: u.id, secret: SECRET, token })));
    } finally {
      soLuotKiem = spy.mock.calls.length;
      spy.mockRestore();
    }
    expect(soLuotKiem, "số lượt THẬT SỰ được kiểm bởi speakeasy trong cả đợt").toBeLessThanOrEqual(SO_LAN_SAI_TOI_DA);
    const dungKq = kq[30];
    expect(dungKq.hopLe, `mã đúng giữa đợt dò phải bị TỪ CHỐI: ${JSON.stringify(dungKq)}`).toBe(false);
    expect(dungKq.ma).toBe("TOTP_TAM_KHOA");
    expect(kq.filter((r) => r.hopLe)).toHaveLength(0);
    expect(await hang(u.id)).toMatchObject({ n: 31, dang_khoa: true });
    const [tieu] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${u.id}`);
    expect(Number(tieu.n), "mã đúng không được kiểm ⇒ không bị tiêu").toBe(0);
    expect(await soAudit(u.id, "totp.tam_khoa"), "ĐÚNG MỘT dòng bắt đầu khoá").toBe(1);
    expect(await soAudit(u.id, "totp.tu_choi_dang_khoa"), "từ chối trong đợt: gộp ≤ 1 dòng / phút").toBe(1);
  });

  it("khoá ĐANG hiệu lực + cửa sổ đã cũ (> 5 phút) ⇒ một lần thử nữa KHÔNG xoá/đổi khoá", async () => {
    const u = await nguoiMoi("khoaCuaSoCu");
    await dung(sql`INSERT INTO totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau, khoa_den, khoa_boi)
      VALUES (${u.id}, 'totp', 5, now() - interval '6 minutes', now() + interval '4 minutes', 'luot-khac')`);
    const truoc = await hang(u.id);
    const r = await sai(u.id);
    expect(r.ma).toBe("TOTP_TAM_KHOA");
    const sau = await hang(u.id);
    expect(sau?.dang_khoa, "khoá vẫn hiệu lực").toBe(true);
    expect(sau?.den, "khoa_den KHÔNG đổi").toBe(truoc?.den);
    const nap = await napLuotThu(u.id, "totp", "luot-tiep");
    expect(nap.conLaiMs).toBeGreaterThan(0);
    expect((await hang(u.id))?.den).toBe(truoc?.den);
    const m = maDung();
    expect((await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).ma, "mã đúng vẫn bị khoá").toBe("TOTP_TAM_KHOA");
  });

  it("lượt thứ 5 (lượt đặt khoá) mà ĐÚNG ⇒ gỡ được khoá của chính nó, không audit khoá", async () => {
    const u = await nguoiMoi("lanNamDung");
    for (let i = 0; i < 4; i++) await sai(u.id);
    const m = maDung();
    expect(await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs })).toEqual({ hopLe: true, phatLai: false });
    expect(await hang(u.id)).toBeUndefined();
    expect(await soAudit(u.id, "totp.tam_khoa"), "lượt thứ 5 đúng ⇒ không có khoá nào để audit").toBe(0);
  });

  it("mã ĐÚNG đã qua bước tính nhưng một lượt KHÁC đặt khoá trong lúc kiểm ⇒ TOTP_TAM_KHOA (mã đã tiêu), khoá còn nguyên", async () => {
    const u = await nguoiMoi("khoaGiuaChung");
    for (let i = 0; i < 3; i++) await sai(u.id);
    const m = maDung();
    // Lượt đúng là lượt thứ 4 (không đặt khoá). Giữa bước tính và bước xoá của nó, một lượt KHÁC (thứ 5, sai) đặt khoá — cấy đúng
    // vào chỗ ấy bằng móc `H.truocXoa` (chạy MỘT lần ngay trước `xoaSauKhiDung` thật).
    H.truocXoa = async () => {
      await dung(sql`UPDATE totp_khoa_sai SET so_lan_sai = 5, khoa_den = now() + interval '5 minutes', khoa_boi = 'luot-khac' WHERE user_id = ${u.id} AND loai = 'totp'`);
    };
    const r = await verifyTotpOnce({ userId: u.id, secret: SECRET, token: m.token, nowMs: m.nowMs });
    expect(H.truocXoa, "móc đã chạy").toBeNull();
    expect(r).toMatchObject({ hopLe: false, ma: "TOTP_TAM_KHOA" });
    expect((await hang(u.id))?.dang_khoa, "khoá do lượt khác đặt KHÔNG bị lượt đúng xoá ngầm").toBe(true);
  });
});

describe("§1c fix round 1 — bộ đếm MÃ DỰ PHÒNG riêng (IMPORTANT 4): 10 lần / 60 phút, độc lập với TOTP", () => {
  const saiDp = (i: number) => `SAI${String(i).padStart(4, "0")}X`; // 8 ký tự, không phải 6 số, không khớp mã nào
  const loiCua = async (p: Promise<unknown>) => {
    try {
      return { ok: await p, code: undefined as string | undefined, appCode: undefined as string | undefined, appParams: {} as Record<string, unknown> };
    } catch (e) {
      const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
      return { ok: undefined, code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams ?? {} };
    }
  };
  const daDung = async (userId: number) =>
    Number((await dung(sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${userId} AND "isUsed" = true`))[0].n);

  it("10 mã dự phòng sai ⇒ lượt 10 báo MA_DU_PHONG_TAM_KHOA; lượt 11 với mã ĐÚNG bị từ chối, KHÔNG bị tiêu; hết cửa sổ 60 phút ⇒ qua", async () => {
    const u = await nguoiMoi("dpKhoa");
    const ma = await quayVongMaDuPhong(u.id);
    for (let i = 1; i < MA_DU_PHONG_SO_LAN_TOI_DA; i++) expect(await verifyBackupCode(u.id, saiDp(i)), `lần sai ${i}`).toBe(false);
    const l10 = await loiCua(verifyBackupCode(u.id, saiDp(10)));
    expect(l10).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(Object.keys(l10.appParams)).toEqual(["remainingMinutes"]);
    const l11 = await loiCua(verifyBackupCode(u.id, ma[0]));
    expect(l11).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(await daDung(u.id), "mã đúng lúc đang khoá KHÔNG bị tiêu").toBe(0);
    expect(await soAudit(u.id, "ma_du_phong.tam_khoa")).toBe(1);
    expect(await hang(u.id), "sai mã dự phòng KHÔNG chạm bộ đếm TOTP").toBeUndefined();
    await troi(u.id, MA_DU_PHONG_CUA_SO_MS + 1_000);
    expect(await verifyBackupCode(u.id, ma[0])).toBe(true);
    expect(await hangLoai(u.id, "backup")).toBeUndefined();
  }, 120_000);

  it("khoá TOTP KHÔNG chặn mã dự phòng (lối thoát); khoá mã dự phòng KHÔNG khoá TOTP", async () => {
    const u = await nguoiMoi("dpDocLap");
    const ma = await quayVongMaDuPhong(u.id);
    for (let i = 0; i < 5; i++) await sai(u.id);
    expect((await hang(u.id))?.dang_khoa).toBe(true);
    expect(await verifyBackupCode(u.id, ma[0]), "TOTP đang khoá, mã dự phòng vẫn qua").toBe(true);
    expect((await hang(u.id))?.dang_khoa, "mã dự phòng đúng không gỡ khoá TOTP").toBe(true);

    const v = await nguoiMoi("dpDocLap2");
    await quayVongMaDuPhong(v.id);
    for (let i = 1; i <= MA_DU_PHONG_SO_LAN_TOI_DA; i++) await loiCua(verifyBackupCode(v.id, saiDp(i)));
    expect((await hangLoai(v.id, "backup"))?.dang_khoa).toBe(true);
    const m = maDung();
    expect(await verifyTotpOnce({ userId: v.id, secret: SECRET, token: m.token, nowMs: m.nowMs }), "mã dự phòng khoá, TOTP vẫn qua").toEqual({ hopLe: true, phatLai: false });
    expect((await hangLoai(v.id, "backup"))?.dang_khoa, "TOTP đúng không gỡ khoá mã dự phòng").toBe(true);
  }, 120_000);

  it("đồng thời: 20 mã dự phòng sai + 1 đúng ⇒ mã đúng bị từ chối, không tiêu; NHIỀU NHẤT 10 lượt được đối chiếu", async () => {
    const u = await nguoiMoi("dpDongThoi");
    const ma = await quayVongMaDuPhong(u.id);
    const kq = await Promise.allSettled([...Array.from({ length: 20 }, (_, i) => saiDp(i)), ma[0]].map((c) => verifyBackupCode(u.id, c)));
    // bị từ chối TRƯỚC đối chiếu ⇒ NÉM; lượt 10 sai (đặt khoá) cũng ném SAU đối chiếu ⇒ fulfilled = đã đối chiếu, ≤ 9
    const daDoiChieu = kq.filter((r) => r.status === "fulfilled").length;
    expect(daDoiChieu).toBeLessThanOrEqual(MA_DU_PHONG_SO_LAN_TOI_DA);
    expect(kq[20].status, "mã đúng cuối đợt bị từ chối").toBe("rejected");
    for (const r of kq) if (r.status === "rejected") expect((r.reason as { cause?: { appCode?: string } }).cause?.appCode).toBe("MA_DU_PHONG_TAM_KHOA");
    expect(await daDung(u.id)).toBe(0);
    expect(await hangLoai(u.id, "backup")).toMatchObject({ n: 21, dang_khoa: true });
    expect(await soAudit(u.id, "ma_du_phong.tam_khoa")).toBe(1);
  }, 120_000);

  it("các lần sai cách nhau quá 60 phút ⇒ không khoá (cửa sổ reset)", async () => {
    const u = await nguoiMoi("dpRaiRac");
    await quayVongMaDuPhong(u.id);
    for (let i = 1; i <= 9; i++) expect(await verifyBackupCode(u.id, saiDp(i))).toBe(false);
    await troi(u.id, MA_DU_PHONG_CUA_SO_MS + 1_000);
    for (let i = 10; i <= 15; i++) expect(await verifyBackupCode(u.id, saiDp(i))).toBe(false);
    expect(await hangLoai(u.id, "backup")).toMatchObject({ n: 6, khoa: false });
  }, 120_000);

  it("bộ đếm mã dự phòng hỏng (lỗi DB THẬT: userId ngoài dải) ⇒ NÉM TOTP_KHONG_KIEM_DUOC (fail-closed)", async () => {
    const l = await loiCua(verifyBackupCode(3_000_000_000, saiDp(1)));
    expect(l).toMatchObject({ code: "SERVICE_UNAVAILABLE", appCode: "TOTP_KHONG_KIEM_DUOC" });
  });

  it("twoFactor.verify: mã dự phòng sai ×10 ⇒ MA_DU_PHONG_TAM_KHOA {remainingMinutes}; mã 6 số sai KHÔNG tốn ngân sách mã dự phòng", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("dpTrpc");
    await setup2FA(u.id, SECRET);
    await enable2FA(u.id);
    await quayVongMaDuPhong(u.id);
    const caller = twoFactorRouter.createCaller({ user: { id: u.id, role: u.role, name: u.name, twoFactorEnabled: true } } as never);
    await loiCua(caller.verify({ code: maSai() }));
    expect(await hangLoai(u.id, "backup"), "mã 6 số không tới bộ đếm mã dự phòng").toBeUndefined();
    for (let i = 1; i < MA_DU_PHONG_SO_LAN_TOI_DA; i++) expect(await loiCua(caller.verify({ code: saiDp(i) }))).toMatchObject({ appCode: "INVALID_VALUE" });
    const l = await loiCua(caller.verify({ code: saiDp(10) }));
    expect(l).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(Object.keys(l.appParams)).toEqual(["remainingMinutes"]);
    expect(Number(l.appParams.remainingMinutes)).toBeGreaterThan(50);
  }, 120_000);
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
    H.hong = "nap";
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

  it("fix round 1 (CRITICAL 3) — admin tự mở khoá CHÍNH MÌNH ⇒ FORBIDDEN, hàng còn nguyên, không audit", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const admin = await nguoiMoi("moKhoaTuMinh", "admin");
    for (let i = 0; i < 5; i++) await sai(admin.id);
    const caller = twoFactorRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: true } } as never);
    await expect(caller.moKhoaTotp({ userId: admin.id, lyDo: "tự mở cho chính mình" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { appCode: "PERMISSION_DENIED", appParams: { reason: "totpSelfUnlock" } },
    });
    expect((await hang(admin.id))?.dang_khoa).toBe(true);
    expect(await soAudit(admin.id, "totp.mo_khoa")).toBe(0);
  });

  it("admin mở khoá xoá CẢ HAI bộ đếm (totp + mã dự phòng)", async () => {
    const { twoFactorRouter } = await import("../routers/twoFactorRouter");
    const u = await nguoiMoi("moKhoaHai");
    const admin = await nguoiMoi("moKhoaHaiAdmin", "admin");
    await dung(sql`INSERT INTO totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau, khoa_den) VALUES
      (${u.id}, 'totp', 5, now(), now() + interval '4 minutes'), (${u.id}, 'backup', 10, now(), now() + interval '50 minutes')`);
    const caller = twoFactorRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: true } } as never);
    expect(await caller.moKhoaTotp({ userId: u.id, lyDo: "mở cả hai bộ đếm" })).toEqual({ success: true, daMoKhoa: true });
    expect(await hangLoai(u.id, "totp")).toBeUndefined();
    expect(await hangLoai(u.id, "backup")).toBeUndefined();
    const row = (await auditCua(u.id)).find((x) => x.action === "totp.mo_khoa");
    expect(row?.beforeJson).toEqual({ boDem: { totp: { dangKhoa: true }, backup: { dangKhoa: true } } });
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
