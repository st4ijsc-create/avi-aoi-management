/**
 * ★ R1b-2b-2b C6 fix round 1 — CỬA SỔ 1 GIỜ của trần mở khoá (`moKhoaTotpCuaNguoiDung`) đúng ở MỌI múi giờ phiên, trên `_test` THẬT.
 *
 * `control_audit_log."createdAt"` là `timestamp` NAIVE `DEFAULT now()` (mig 0166 — §0 đo lại trên CSDL). Lỗi có thể có: giờ tường lưu theo
 * TimeZone phiên GHI, so với giờ tường phiên ĐỌC ⇒ lệch đúng độ chênh hai múi (7 h với Asia/Ho_Chi_Minh). Lưới này:
 *   · chạy hàm thật dưới HAI phiên postgres riêng (`connection.TimeZone` = UTC / Asia/Ho_Chi_Minh), tiến trình Node ép TZ = Asia/Ho_Chi_Minh;
 *   · cấy dòng audit CŨ bằng INSERT có `createdAt` TƯỜNG MINH (bảng WORM chỉ chặn UPDATE/DELETE; §0 chứng minh không trigger nào ép now()),
 *     mốc tính bằng `now() AT TIME ZONE 'UTC'` NGAY TRONG SQL — không giá trị giờ nào đi qua JS (lớp lỗi postgres.js −7 h);
 *   · oracle: 59 phút ⇒ ĐẾM, 61 phút ⇒ KHÔNG đếm; dòng `totp.mo_khoa` do hàm ghi mang giờ tường UTC ở cả hai phiên.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

vi.hoisted(() => {
  process.env.TZ = "Asia/Ho_Chi_Minh"; // máy chạy ở UTC+7 (tất định, không phụ thuộc máy CI)
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db/connection", async (orig) => {
  const actual = await orig<typeof import("../db/connection")>();
  return { ...actual, getDb: async () => h.db, getReadDb: async () => h.db };
});

import { moKhoaTotpCuaNguoiDung, MO_KHOA_TOI_DA_MOI_GIO, MO_KHOA_CUA_SO_MS, AUDIT_VUOT_TRAN_MO_KHOA_MOI_MS } from "./totpKhoaSai";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { __resetSoTotpChoTest } from "./totpOnce";

const DB_URL = process.env.DATABASE_URL!;
const RUN = `c6w${process.pid}${Date.now().toString(36)}`;
type Phien = "UTC" | "VN";
const TZ_PHIEN: Record<Phien, string> = { UTC: "UTC", VN: "Asia/Ho_Chi_Minh" };
let goc: ReturnType<typeof postgres>;
const ket: Partial<Record<Phien, ReturnType<typeof postgres>>> = {};
const ids: number[] = [];

function dung(p: Phien) {
  h.db = drizzle(ket[p]!);
}
async function nguoi(tag: string) {
  const u = await taoNguoiDungTest(tag, "operator", { tienTo: "c6w", ts: RUN, ten: `C6w ${tag}` });
  ids.push(u.id);
  return u.id;
}
/** Cấy MỘT dòng audit cũ `phut` phút (giờ tường UTC — quy ước cột naive của repo), tính trong SQL. */
async function cay(userId: number, action: string, phut: number, entityType = "user") {
  await goc`INSERT INTO control_audit_log ("entityType", "entityId", action, "actorId", reason, "createdAt")
    VALUES (${entityType}, ${String(userId)}, ${action}, NULL, 'C6 fix1 dong cay',
            (now() AT TIME ZONE 'UTC') - make_interval(mins => ${phut}))`;
}
async function so(userId: number, action: string): Promise<number> {
  const [r] = await goc`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(userId)} AND action = ${action}`;
  return Number(r.n);
}
const mo = (userId: number, lyDo = "C6 fix1 cua so") => moKhoaTotpCuaNguoiDung({ userId, actorId: ids[0] ?? 1, lyDo });

beforeAll(async () => {
  goc = postgres(DB_URL, { max: 2, onnotice: () => {} });
  for (const p of ["UTC", "VN"] as const) ket[p] = postgres(DB_URL, { max: 4, onnotice: () => {}, connection: { TimeZone: TZ_PHIEN[p] } });
  dung("VN");
});
afterAll(async () => {
  dung("VN");
  if (ids.length) await __resetSoTotpChoTest(ids);
  await goc.end({ timeout: 5 });
  for (const c of Object.values(ket)) await c!.end({ timeout: 5 });
});

describe("§0 hình dạng cột + thiết bị đo (đo, không giả định)", () => {
  it("createdAt = timestamp NAIVE DEFAULT now(); KHÔNG trigger người dùng trên control_audit_log; INSERT createdAt tường minh được giữ nguyên", async () => {
    const [c] = await goc`SELECT data_type, column_default FROM information_schema.columns
      WHERE table_name = 'control_audit_log' AND column_name = 'createdAt'`;
    expect(c).toEqual({ data_type: "timestamp without time zone", column_default: "now()" });
    const [t] = await goc`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'control_audit_log'::regclass AND NOT tgisinternal`;
    expect(Number(t.n)).toBe(0);
    const u = await nguoi("schema");
    await cay(u, "c6.thiet_bi_do", 61);
    const [r] = await goc`SELECT round(EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - "createdAt")) / 60)::int AS phut
      FROM control_audit_log WHERE "entityId" = ${String(u)} AND action = 'c6.thiet_bi_do'`;
    expect(r.phut).toBe(61);
  });
  it("hai phiên thật có TimeZone khác nhau; tiến trình Node ở UTC+7", async () => {
    const [a] = await ket.UTC!`SHOW TimeZone`;
    const [b] = await ket.VN!`SHOW TimeZone`;
    expect([a.TimeZone, b.TimeZone]).toEqual(["UTC", "Asia/Ho_Chi_Minh"]);
    expect(new Date().getTimezoneOffset()).toBe(-420);
    expect(MO_KHOA_CUA_SO_MS).toBe(3_600_000);
    expect(MO_KHOA_TOI_DA_MOI_GIO).toBe(3);
  });
});

describe.each(["UTC", "VN"] as const)("§1 cửa sổ 1 giờ — phiên %s", (p) => {
  it("dòng mo_khoa do hàm ghi mang GIỜ TƯỜNG UTC (không phải giờ phiên)", async () => {
    dung(p);
    const u = await nguoi(`ghi${p}`);
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: false });
    const [r] = await goc`SELECT abs(EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - "createdAt")))::int AS lech
      FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(u)} AND action = 'totp.mo_khoa'`;
    expect(r.lech, "lệch so với giờ tường UTC (giây)").toBeLessThan(60);
  });

  it("2 dòng 10 phút + 1 dòng 59 phút ⇒ ĐẾM đủ 3 ⇒ vượt trần, không xoá", async () => {
    dung(p);
    const u = await nguoi(`w59${p}`);
    await cay(u, "totp.mo_khoa", 10);
    await cay(u, "totp.mo_khoa", 10);
    await cay(u, "totp.mo_khoa", 59);
    await goc`INSERT INTO totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau, khoa_den) VALUES (${u}, 'totp', 5, now(), now() + interval '4 minutes')`;
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: true });
    const [k] = await goc`SELECT count(*)::int AS n FROM totp_khoa_sai WHERE user_id = ${u}`;
    expect(Number(k.n)).toBe(1);
  });

  it("2 dòng 10 phút + 1 dòng 61 phút ⇒ dòng 61 phút KHÔNG đếm ⇒ mở khoá được", async () => {
    dung(p);
    const u = await nguoi(`w61${p}`);
    await cay(u, "totp.mo_khoa", 10);
    await cay(u, "totp.mo_khoa", 10);
    await cay(u, "totp.mo_khoa", 61);
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: false });
  });
});

describe("§2 cái gì được đếm (phiên VN)", () => {
  it("lượt mở khoá KHÔNG có hàng nào (daMoKhoa:false) VẪN tốn một lượt: 3 lượt rỗng ⇒ lượt 4 vượt trần", async () => {
    dung("VN");
    const u = await nguoi("rong");
    for (let i = 0; i < MO_KHOA_TOI_DA_MOI_GIO; i++) expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: false });
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: true });
    expect(await so(u, "totp.mo_khoa")).toBe(MO_KHOA_TOI_DA_MOI_GIO);
  });

  it("CHỈ đếm action 'totp.mo_khoa' của entityType 'user' + đúng id: vuot_tran / tam_khoa / entityType khác / id khác KHÔNG đếm", async () => {
    dung("VN");
    const u = await nguoi("loc");
    const khac = await nguoi("locKhac");
    for (let i = 0; i < 3; i++) {
      await cay(u, "totp.mo_khoa_vuot_tran", 5 + i);
      await cay(u, "totp.tam_khoa", 5 + i);
      await cay(u, "totp.mo_khoa", 5 + i, "machine");
      await cay(khac, "totp.mo_khoa", 5 + i);
    }
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: false });
    expect(await mo(khac)).toEqual({ daMoKhoa: false, vuotTran: true });
  });
});

describe(`§3 audit vượt trần gộp ≤ 1 dòng / ${AUDIT_VUOT_TRAN_MO_KHOA_MOI_MS / 1000} s / người đích (phiên VN)`, () => {
  it("dòng vuot_tran cũ 2 phút ⇒ lượt từ chối mới GHI 1 dòng; lượt từ chối ngay sau KHÔNG ghi thêm", async () => {
    dung("VN");
    const u = await nguoi("gop");
    for (let i = 0; i < 3; i++) await cay(u, "totp.mo_khoa", 30);
    await cay(u, "totp.mo_khoa_vuot_tran", 2);
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: true });
    expect(await so(u, "totp.mo_khoa_vuot_tran")).toBe(2);
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: true });
    expect(await mo(u)).toEqual({ daMoKhoa: false, vuotTran: true });
    expect(await so(u, "totp.mo_khoa_vuot_tran")).toBe(2);
    expect(await so(u, "totp.mo_khoa"), "lượt vượt trần không ghi mo_khoa").toBe(3);
  });
});
