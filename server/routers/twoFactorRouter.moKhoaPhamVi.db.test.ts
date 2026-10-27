/**
 * ★ R1b-2b-2b C6 (kiem-dinh KD-2bA) — `twoFactor.moKhoaTotp` theo PHẠM VI người gọi, chặn leo thang admin, trần theo người đích / giờ.
 * Trên CSDL `_test` THẬT: hai nhà máy, người dùng tạo bằng `taoNguoiDungTest`, gán nhà máy bằng `createFactoryAssignment` (hàng thật).
 *
 * ⚠ "ADMIN BỊ THU HẸP" KHÔNG TỒN TẠI theo mô hình hôm nay: `resolveTenantFactoryScope` trả `factoryIds: null` cho MỌI `role === "admin"`
 *   (tiền đề ghim ở `phamViGhiCensus` §5c). Để thử cổng ①② cho ngày phạm vi admin bị thu hẹp, lưới này bọc ĐÚNG MỘT chỗ: người có id trong
 *   `H.thuHep` được phân giải bằng bộ phân giải THẬT như một vai thường (tức theo hàng `user_factory_assignments` thật của họ). Mọi người
 *   khác — kể cả admin toàn hệ thống và MỌI người đích không trong `H.thuHep` — đi bộ phân giải nguyên bản. §4 chứng minh trạng thái hôm nay
 *   (admin có gán nhà máy A VẪN là toàn hệ thống) không qua lớp bọc nào.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

const H = vi.hoisted(() => ({ thuHep: new Set<number>() }));
vi.mock("../db/reportAggregators", async (orig) => {
  const real = await orig<typeof import("../db/reportAggregators")>();
  return {
    ...real,
    resolveTenantFactoryScope: (async (args, opts) => {
      const a = args as { userId?: number; userRole?: string } | undefined;
      if (a?.userId && H.thuHep.has(a.userId)) return real.resolveTenantFactoryScope({ userId: a.userId, userRole: "user" }, opts);
      return real.resolveTenantFactoryScope(args, opts);
    }) as typeof real.resolveTenantFactoryScope,
  };
});

import { getDb } from "../db/connection";
import { createFactoryAssignment } from "../db/auth";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { __resetSoTotpChoTest } from "../_core/totpOnce";
import { MO_KHOA_TOI_DA_MOI_GIO } from "../_core/totpKhoaSai";
import { twoFactorRouter } from "./twoFactorRouter";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const RUN = `c6${process.pid}${Date.now().toString(36)}`;
const DAU = `C6-${RUN}`;
const ids: number[] = [];
const ID_KHONG_TON_TAI = 2_000_000_000;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

type Role = "admin" | "operator" | "engineer";
async function nguoi(tag: string, role: Role, maNhaMay: string[] = [], thuHep = false) {
  const u = await taoNguoiDungTest(tag, role, { tienTo: "c6", ts: RUN, ten: `C6 ${tag}` });
  ids.push(u.id);
  for (const ma of maNhaMay) await createFactoryAssignment({ userId: u.id, factoryCode: ma });
  if (thuHep) H.thuHep.add(u.id);
  return u;
}
function goi(u: { id: number; name: string | null }) {
  return twoFactorRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
}
async function khoa(userId: number) {
  await dung(sql`INSERT INTO totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau, khoa_den) VALUES
    (${userId}, 'totp', 5, now(), now() + interval '4 minutes')
    ON CONFLICT (user_id, loai) DO UPDATE SET so_lan_sai = 5, cua_so_bat_dau = now(), khoa_den = now() + interval '4 minutes'`);
}
async function conKhoa(userId: number): Promise<boolean> {
  const r = await dung(sql`SELECT 1 FROM totp_khoa_sai WHERE user_id = ${userId} AND loai = 'totp' AND khoa_den > now()`);
  return r.length === 1;
}
async function soAudit(userId: number, action: string): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(userId)} AND action = ${action}`);
  return Number(r.n);
}
/** Hình dạng lỗi MÀ NGƯỜI GỌI THẤY: mã tRPC, câu, mã ứng dụng, tham số. */
async function loiCua(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: unknown } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong một lỗi, nhận thành công");
}

let A: string, B: string;
beforeAll(async () => {
  const d = await getDb();
  expect(d, "cần CSDL _test").toBeTruthy();
  db = d!;
  A = `${DAU}-A`;
  B = `${DAU}-B`;
  await dung(sql`INSERT INTO factories (code, name) VALUES (${A}, ${A}), (${B}, ${B})`);
  const [k] = await dung(sql`SELECT count(*)::int AS n FROM users WHERE id = ${ID_KHONG_TON_TAI}`);
  expect(Number(k.n), "id 'không tồn tại' phải thật sự không tồn tại").toBe(0);
});
afterAll(async () => {
  H.thuHep.clear();
  if (ids.length) await __resetSoTotpChoTest(ids); // totp_consumed + totp_khoa_sai của người test
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${DAU + "%"}`);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
});

describe("§1 phạm vi người đích (cổng ①)", () => {
  it("admin nhà máy A + người đích nhà máy B ⇒ NOT_FOUND GIỐNG HỆT id không tồn tại; hàng còn nguyên; không audit thành công", async () => {
    const adminA = await nguoi("adminA1", "admin", [A], true);
    const opB = await nguoi("opB1", "operator", [B]);
    await khoa(opB.id);
    const ngoai = await loiCua(goi(adminA).moKhoaTotp({ userId: opB.id, lyDo: "thử mở khoá người nhà máy khác" }));
    const khong = await loiCua(goi(adminA).moKhoaTotp({ userId: ID_KHONG_TON_TAI, lyDo: "thử mở khoá người nhà máy khác" }));
    expect(ngoai).toEqual({ code: "NOT_FOUND", message: "User not found", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "user" } });
    expect(ngoai).toEqual(khong);
    expect(await conKhoa(opB.id), "hàng totp_khoa_sai KHÔNG bị xoá").toBe(true);
    expect(await soAudit(opB.id, "totp.mo_khoa")).toBe(0);
  });

  it("người đích CHƯA gán nhà máy nào ⇒ ngoài phạm vi admin bị thu hẹp ⇒ NOT_FOUND, hàng còn", async () => {
    const adminA = await nguoi("adminA2", "admin", [A], true);
    const opTrong = await nguoi("opNone", "operator", []);
    await khoa(opTrong.id);
    expect(await loiCua(goi(adminA).moKhoaTotp({ userId: opTrong.id, lyDo: "người chưa gán nhà máy" }))).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND" });
    expect(await conKhoa(opTrong.id)).toBe(true);
  });

  it("CÙNG nhà máy ⇒ mở khoá: hàng bị xoá, đúng 1 dòng audit totp.mo_khoa mang lyDo; phản hồi không mang số đếm", async () => {
    const adminA = await nguoi("adminA3", "admin", [A], true);
    const opA = await nguoi("opA3", "operator", [A]);
    await khoa(opA.id);
    const r = await goi(adminA).moKhoaTotp({ userId: opA.id, lyDo: "cùng nhà máy, đã xác minh" });
    expect(r).toEqual({ success: true, daMoKhoa: true });
    expect(await conKhoa(opA.id)).toBe(false);
    expect(await soAudit(opA.id, "totp.mo_khoa")).toBe(1);
    const [row] = await dung(sql`SELECT "actorId", reason FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(opA.id)} AND action = 'totp.mo_khoa'`);
    expect(row).toMatchObject({ actorId: adminA.id, reason: "cùng nhà máy, đã xác minh" });
  });
});

describe("§2 không leo thang (cổng ②)", () => {
  it("admin nhà máy A → admin TOÀN HỆ THỐNG ⇒ NOT_FOUND giống id không tồn tại; hàng còn", async () => {
    const adminA = await nguoi("adminA4", "admin", [A], true);
    const toan = await nguoi("adminToan4", "admin", [A]); // gán A nhưng KHÔNG thu hẹp ⇒ toàn hệ thống (mô hình hôm nay)
    await khoa(toan.id);
    const e = await loiCua(goi(adminA).moKhoaTotp({ userId: toan.id, lyDo: "leo thang lên admin toàn hệ" }));
    expect(e).toEqual(await loiCua(goi(adminA).moKhoaTotp({ userId: ID_KHONG_TON_TAI, lyDo: "leo thang lên admin toàn hệ" })));
    expect(e.code).toBe("NOT_FOUND");
    expect(await conKhoa(toan.id)).toBe(true);
    expect(await soAudit(toan.id, "totp.mo_khoa")).toBe(0);
  });

  it("admin nhà máy A → admin TẦM RỘNG HƠN (A+B) ⇒ NOT_FOUND; admin cùng tầm (A) ⇒ được", async () => {
    const adminA = await nguoi("adminA5", "admin", [A], true);
    const rong = await nguoi("adminAB5", "admin", [A, B], true);
    const ngang = await nguoi("adminA5b", "admin", [A], true);
    await khoa(rong.id);
    await khoa(ngang.id);
    expect(await loiCua(goi(adminA).moKhoaTotp({ userId: rong.id, lyDo: "admin tầm rộng hơn" }))).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND" });
    expect(await conKhoa(rong.id)).toBe(true);
    expect(await goi(adminA).moKhoaTotp({ userId: ngang.id, lyDo: "admin cùng tầm" })).toEqual({ success: true, daMoKhoa: true });
    expect(await conKhoa(ngang.id)).toBe(false);
  });
});

describe("§3 admin toàn hệ thống được miễn", () => {
  it("admin toàn hệ thống mở khoá người nhà máy B và admin tầm rộng (A+B)", async () => {
    const toan = await nguoi("adminToan6", "admin");
    const opB = await nguoi("opB6", "operator", [B]);
    const rong = await nguoi("adminAB6", "admin", [A, B], true);
    await khoa(opB.id);
    await khoa(rong.id);
    expect(await goi(toan).moKhoaTotp({ userId: opB.id, lyDo: "toàn hệ thống, khác nhà máy" })).toEqual({ success: true, daMoKhoa: true });
    expect(await goi(toan).moKhoaTotp({ userId: rong.id, lyDo: "toàn hệ thống mở admin nhà máy" })).toEqual({ success: true, daMoKhoa: true });
    expect(await conKhoa(opB.id)).toBe(false);
    expect(await conKhoa(rong.id)).toBe(false);
  });
});

describe("§4 trạng thái HÔM NAY (không lớp bọc): mọi admin là toàn hệ thống", () => {
  it("admin có gán nhà máy A (không thu hẹp) vẫn mở khoá được người nhà máy B — đúng tiền đề phamViGhiCensus §5c", async () => {
    const adminGanA = await nguoi("adminGanA7", "admin", [A]);
    const opB = await nguoi("opB7", "operator", [B]);
    await khoa(opB.id);
    expect(await goi(adminGanA).moKhoaTotp({ userId: opB.id, lyDo: "mô hình hôm nay: admin toàn hệ" })).toEqual({ success: true, daMoKhoa: true });
  });
});

describe(`§5 trần ${MO_KHOA_TOI_DA_MOI_GIO} lượt / người đích / giờ (cổng ③)`, () => {
  it("lượt thứ N+1 trong giờ ⇒ TOO_MANY_REQUESTS RATE_LIMITED, KHÔNG xoá; trần theo NGƯỜI ĐÍCH (admin khác cũng bị), người đích khác không ảnh hưởng", async () => {
    expect(MO_KHOA_TOI_DA_MOI_GIO).toBe(3);
    const ad1 = await nguoi("adminCap1", "admin");
    const ad2 = await nguoi("adminCap2", "admin");
    const dich = await nguoi("opCap", "operator", [A]);
    const khac = await nguoi("opCapKhac", "operator", [A]);
    for (let i = 0; i < MO_KHOA_TOI_DA_MOI_GIO; i++) {
      await khoa(dich.id);
      expect(await goi(ad1).moKhoaTotp({ userId: dich.id, lyDo: `mở lần ${i + 1}` })).toEqual({ success: true, daMoKhoa: true });
    }
    await khoa(dich.id);
    const e = await loiCua(goi(ad1).moKhoaTotp({ userId: dich.id, lyDo: "mở lần thứ tư" }));
    expect(e).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "RATE_LIMITED" });
    expect(await conKhoa(dich.id), "lượt vượt trần KHÔNG xoá bộ đếm").toBe(true);
    expect(await loiCua(goi(ad2).moKhoaTotp({ userId: dich.id, lyDo: "admin khác thử" }))).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "RATE_LIMITED" });
    expect(await conKhoa(dich.id)).toBe(true);
    expect(await soAudit(dich.id, "totp.mo_khoa")).toBe(MO_KHOA_TOI_DA_MOI_GIO);
    expect(await soAudit(dich.id, "totp.mo_khoa_vuot_tran"), "từ chối vì trần được audit, gộp ≤ 1 dòng/phút").toBe(1);
    await khoa(khac.id);
    expect(await goi(ad1).moKhoaTotp({ userId: khac.id, lyDo: "người đích khác" })).toEqual({ success: true, daMoKhoa: true });
  });

  it("đồng thời: 6 lượt cùng lúc trên một người đích ⇒ ĐÚNG 3 qua, 3 RATE_LIMITED (khoá tư vấn theo người đích)", async () => {
    const ad = await nguoi("adminDongThoi", "admin");
    const dich = await nguoi("opDongThoi", "operator", [A]);
    await khoa(dich.id);
    const kq = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => goi(ad).moKhoaTotp({ userId: dich.id, lyDo: `đồng thời ${i}` })));
    const qua = kq.filter((k) => k.status === "fulfilled").length;
    const tuChoi = kq.filter((k) => k.status === "rejected" && (k.reason as { cause?: { appCode?: string } })?.cause?.appCode === "RATE_LIMITED").length;
    expect({ qua, tuChoi }).toEqual({ qua: MO_KHOA_TOI_DA_MOI_GIO, tuChoi: 6 - MO_KHOA_TOI_DA_MOI_GIO });
    expect(await soAudit(dich.id, "totp.mo_khoa")).toBe(MO_KHOA_TOI_DA_MOI_GIO);
  });
});

describe("§6 giữ nguyên điều đã đúng", () => {
  it("tự mở khoá chính mình vẫn FORBIDDEN totpSelfUnlock (cả admin bị thu hẹp lẫn toàn hệ), hàng còn, không audit", async () => {
    const adminA = await nguoi("adminTuMinhA", "admin", [A], true);
    const toan = await nguoi("adminTuMinh", "admin");
    for (const u of [adminA, toan]) {
      await khoa(u.id);
      expect(await loiCua(goi(u).moKhoaTotp({ userId: u.id, lyDo: "tự mở cho chính mình" }))).toMatchObject({
        code: "FORBIDDEN",
        appCode: "PERMISSION_DENIED",
        appParams: { reason: "totpSelfUnlock" },
      });
      expect(await conKhoa(u.id)).toBe(true);
      expect(await soAudit(u.id, "totp.mo_khoa")).toBe(0);
    }
  });
});
