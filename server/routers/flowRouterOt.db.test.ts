/**
 * ★★★ Đợt 8.5 — QUYỀN BẬT luồng hạng `ot` = admin + 2FA mới (`flow.batLuongOt` trên `deployProcedure`), CSDL `_test`, sàn
 * quyền THẬT của tRPC (`createCaller`, giấy phép tắt):
 *   • kỹ sư bị từ chối (trước OTP) · admin chưa bật 2FA bị từ chối · thiếu/sai OTP (step-up bật) bị từ chối · admin + OTP được;
 *   • `datPhienBanHoatDong(bat)` và `chayTay` không còn là đường vòng cho phiên bản `ot` (kể cả admin);
 *   • sau khi bật: chạy ⇒ đề xuất mô phỏng ⇒ `flow.duyet` ⇒ "đã duyệt (mô phỏng) — không gửi", `command_log` đứng yên.
 * OTP: `verifyTotpOnce` + `get2FAStatus` được giả (mã đúng = "135790") — lưới này canh DÂY NỐI của sàn; bản thân phép verify
 * có lưới riêng (`deployStepUpFreshness`, `totpReplay`).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
  process.env.AUDIT_ALL_MUTATIONS = "false";
});
vi.mock("../_core/totpOnce", async (orig) => ({
  ...(await orig<typeof import("../_core/totpOnce")>()),
  verifyTotpOnce: vi.fn(async ({ token }: { token: string }) => ({ hopLe: token === "135790", phatLai: false })),
}));
vi.mock("../db", async (orig) => ({
  ...(await orig<typeof import("../db")>()),
  get2FAStatus: vi.fn(async () => ({ twoFactorEnabled: true, twoFactorSecret: "GIA" })),
}));
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../drizzle/schema";
import { chayMotMuc } from "../services/flow/dongCo";
import { readAppErrorMeta } from "../_core/appError";
import { flowRouter } from "./flowRouter";

const TT = "t85rt";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });

let uid = 0;
let uid2 = 0;
const goi = (role: string, twoFactorEnabled = true) =>
  flowRouter.createCaller({ user: { id: uid, role, twoFactorEnabled }, sessionToken: `phien-${role}-${twoFactorEnabled}-${Math.random()}` } as never);
const ma = (e: unknown) => (readAppErrorMeta(e) as { appCode?: string; appParams?: Record<string, unknown> } | null) ?? {};
const loi = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

const luongOt = {
  id: `${TT}-ot`, name: "đề xuất stop", version: 1,
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "ot.de-xuat-lenh", { may: 7, lenh: "stop" }), nut("ok", "du-lieu.dat", { truong: { xong: true } })],
  connections: [noi("t", "main", "d"), noi("d", "dong-y", "ok")],
};
const luongThuan = { id: `${TT}-thuan`, name: "thuần", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] };

let fidOt = 0;
const MA_NM_OT = `${TT}F`;
beforeAll(async () => {
  const db0 = (await getDb())!;
  const [fa] = (await db0.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${MA_NM_OT}, ${"T85 " + MA_NM_OT}, true) RETURNING id`)) as unknown as { id: number }[];
  fidOt = fa.id;
  const [uMoi] = (await db0.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-nd-" + Date.now().toString(36)}, ${TT + "_nd_" + Date.now().toString(36)}, ${"người gọi"}, ${"password"}, ${"admin"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid = uMoi.id;
  await db0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${MA_NM_OT})`);
  // H2: người duyệt khác người bật (admin `uid`) — người thứ hai cùng nhà máy của test.
  const [uid2Moi] = (await db0.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-d2-" + Date.now().toString(36)}, ${TT + "_d2_" + Date.now().toString(36)}, ${"người duyệt d2"}, ${"password"}, ${"supervisor"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid2 = uid2Moi.id;
  await db0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid2}, ${MA_NM_OT})`);
});
afterEach(() => {
  delete process.env.ACTUATION_STEPUP_2FA;
});
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${uid} AND "factoryCode" = ${MA_NM_OT}`);
  await db.execute(sql`DELETE FROM factories WHERE id = ${fidOt}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
});

async function chayHet() {
  for (let i = 0; i < 100 && (await chayMotMuc("w-85rt", undefined, TT)); i++);
}
const demCmd = async () => ((await (await getDb())!.execute(sql`SELECT count(*)::int AS n FROM command_log`)) as unknown as { n: number }[])[0].n;
const trangThaiLuong = async (id: string) => (await (await getDb())!.select().from(aiFlows).where(eq(aiFlows.id, id)))[0];

describe("★★★ Đợt 8.5 — bật luồng hạng `ot` = admin + 2FA mới", () => {
  let version = 0;
  beforeAll(async () => {
    const r = await goi("engineer").luu({ definition: luongOt });
    expect(r.hang).toBe("ot");
    version = r.version;
  });

  it("datPhienBanHoatDong(bat) KHÔNG mở được luồng ot — kể cả admin; chayTay phiên bản ot chưa bật ⇒ từ chối mọi vai", async () => {
    for (const vai of ["engineer", "admin"]) {
      const e = await loi(goi(vai).datPhienBanHoatDong({ flowId: luongOt.id, version, bat: true }));
      expect((e as { code?: string })?.code, vai).toBe("FORBIDDEN");
      const c = await loi(goi(vai).chayTay({ flowId: luongOt.id, version }));
      expect((c as { code?: string })?.code, vai).toBe("FORBIDDEN");
    }
    expect((await trangThaiLuong(luongOt.id)).enabled).toBe(false);
  });

  it("kỹ sư (đã bật 2FA, kèm OTP đúng) ⇒ từ chối ở cổng vai, TRƯỚC khi đụng OTP", async () => {
    process.env.ACTUATION_STEPUP_2FA = "true";
    const e = await loi(goi("engineer").batLuongOt({ flowId: luongOt.id, version, totpCode: "135790" }));
    expect((e as { code?: string })?.code).toBe("FORBIDDEN");
    expect(ma(e).appCode).toBe("PERMISSION_DENIED");
    for (const vai of ["supervisor", "viewer", "operator"]) {
      expect(((await loi(goi(vai).batLuongOt({ flowId: luongOt.id, version, totpCode: "135790" }))) as { code?: string })?.code, vai).toBe("FORBIDDEN");
    }
  });

  it("admin CHƯA bật 2FA ⇒ từ chối (TWO_FACTOR_NOT_SET_UP)", async () => {
    const e = await loi(goi("admin", false).batLuongOt({ flowId: luongOt.id, version, totpCode: "135790" }));
    expect((e as { code?: string })?.code).toBe("FORBIDDEN");
    expect(ma(e).appCode).toBe("TWO_FACTOR_NOT_SET_UP");
  });

  it("admin 2FA nhưng OTP sai / thiếu (step-up bật) ⇒ từ chối ở cổng OTP", async () => {
    process.env.ACTUATION_STEPUP_2FA = "true";
    const sai = await loi(goi("admin").batLuongOt({ flowId: luongOt.id, version, totpCode: "000000" }));
    expect(ma(sai)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    const thieu = await loi(goi("admin").batLuongOt({ flowId: luongOt.id, version } as never));
    expect(ma(thieu)).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "twoFactorCode" } });
    expect((await trangThaiLuong(luongOt.id)).enabled).toBe(false);
  });

  it("batLuongOt chỉ dành cho hạng ot (luồng thuần ⇒ BAD_REQUEST trước OTP)", async () => {
    const r = await goi("engineer").luu({ definition: luongThuan });
    const e = await loi(goi("admin").batLuongOt({ flowId: luongThuan.id, version: r.version, totpCode: "135790" }));
    expect((e as { code?: string })?.code).toBe("BAD_REQUEST");
  });

  it("★ admin + 2FA + OTP mới ⇒ bật; chạy ⇒ đề xuất mô phỏng ⇒ duyệt ⇒ 'không gửi'; command_log đứng yên", async () => {
    process.env.ACTUATION_STEPUP_2FA = "true";
    const kq = await goi("admin").batLuongOt({ flowId: luongOt.id, version, totpCode: "135790" });
    expect(kq).toMatchObject({ flowId: luongOt.id, version, bat: true, hang: "ot" });
    expect(await trangThaiLuong(luongOt.id)).toMatchObject({ enabled: true, activeVersion: version });

    const cmd0 = await demCmd();
    await expect(goi("engineer").chayTay({ flowId: luongOt.id })).rejects.toMatchObject({ code: "FORBIDDEN" }); // Đợt 9 (L3): hạng ot đã bật vẫn chỉ admin chạy tay
    const { runId } = await goi("admin").chayTay({ flowId: luongOt.id });
    await chayHet();
    const cho = (await goi("viewer").danhSachCho()).find((x) => x.runId === runId);
    expect(cho).toMatchObject({ nodeId: "d", vaiTroDuyet: "supervisor" });
    expect(cho!.tieuDe).toMatch(/MÔ PHỎNG/);
    await flowRouter.createCaller({ user: { id: uid2, role: "supervisor", twoFactorEnabled: true } } as never).duyet({ runId, nodeId: "d", dongY: true });
    await chayHet();
    const b = (await (await getDb())!.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, runId))).find((x) => x.nodeId === "ok")!;
    const item = (b.output as { main: { json: Record<string, unknown> }[] }).main[0].json;
    expect(item).toMatchObject({ ketQua: "da-de-xuat", muc: 1, moPhong: true, thucThi: { daGui: false, trangThai: "da-duyet-mo-phong" } });
    expect(await demCmd()).toBe(cmd0);
  });
});
