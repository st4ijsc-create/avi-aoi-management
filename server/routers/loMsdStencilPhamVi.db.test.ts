/**
 * CỔNG CSDL THẬT — lô L6a-4 (rà bảo mật tRPC, 2026-10-25): ĐỌC của msd (listActive · expiringSoon) và stencil (status · listUsage) theo PHẠM VI người dùng.
 * Luật (dieu-phoi duyệt 2026-10-25): nhật ký theo máy ⇒ machineId ∈ phạm vi thì thấy; machineId NULL (cuộn / tủ khô / khuôn trong kho, không gắn máy) ⇒ thấy với mọi người có quyền module;
 * dụng cụ (tools) theo MÃ nhà máy — người ngoài phạm vi KHÔNG thấy trạng thái khuôn và KHÔNG cộng dồn được nhật ký in của nó. Admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";

const RUN = `l6m${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { msd: any; stencil: any };
let cA: C, cAdm: C, cRong: C;
let toolA = 0, toolB = 0, logA = 0, logB = 0, logAtrenB = 0, logBkhongMay = 0;
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [m, s] = await Promise.all([
    import("./msdRouter").then((x) => x.msdRouter.createCaller(ctx)),
    import("./stencilRouter").then((x) => x.stencilRouter.createCaller(ctx)),
  ]);
  return { msd: m, stencil: s };
};

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6m", [], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const old = new Date(Date.now() - 2000 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const lay = (rows: any[]) => Number(rows[0].id);
  // msd: một cuộn gắn máy A, một gắn máy B, một không gắn máy — cả ba đã quá hạn sàn (MSL 3 = 168 h)
  for (const [ten, mid] of [["A", H.A.mid], ["B", H.B.mid], ["K", null]] as const) {
    await H.dung(sql`INSERT INTO msd_exposure_logs ("componentCode", "reelId", "mslLevel", "removedFromDryAt", "machineId") VALUES (${RUN + "-" + ten}, ${RUN + "-" + ten}, '3', ${old}::timestamp, ${mid})`);
  }
  // stencil: hai dụng cụ theo mã nhà máy; nhật ký in
  toolA = lay(await H.dung(sql`INSERT INTO tools (code, name, type, "factoryCode", "lifeLimit", "lifeUsed") VALUES (${RUN + "-TA"}, ${RUN + "-TA"}, 'stencil', ${H.A.code}, 1000, 0) RETURNING id`));
  toolB = lay(await H.dung(sql`INSERT INTO tools (code, name, type, "factoryCode", "lifeLimit", "lifeUsed") VALUES (${RUN + "-TB"}, ${RUN + "-TB"}, 'stencil', ${H.B.code}, 1000, 0) RETURNING id`));
  logA = lay(await H.dung(sql`INSERT INTO stencil_usage_logs ("stencilToolId", "printCount", "machineId", notes) VALUES (${toolA}, 10, ${H.A.mid}, ${RUN})  RETURNING id`));
  logB = lay(await H.dung(sql`INSERT INTO stencil_usage_logs ("stencilToolId", "printCount", "machineId", notes) VALUES (${toolB}, 20, ${H.B.mid}, ${RUN}) RETURNING id`));
  // dụng cụ A nhưng nhật ký in trên máy B (khuôn luân chuyển) — A không được thấy dòng của máy B; dòng không gắn máy thì thấy
  logAtrenB = lay(await H.dung(sql`INSERT INTO stencil_usage_logs ("stencilToolId", "printCount", "machineId", notes) VALUES (${toolA}, 5, ${H.B.mid}, ${RUN}) RETURNING id`));
  await H.dung(sql`INSERT INTO stencil_usage_logs ("stencilToolId", "printCount", "machineId", notes) VALUES (${toolA}, 1, NULL, ${RUN})`);
  // nhật ký KHÔNG gắn máy của dụng cụ nhà máy B — "chung" về máy nhưng dụng cụ thuộc B ⇒ A vẫn không được thấy / cộng dồn
  logBkhongMay = lay(await H.dung(sql`INSERT INTO stencil_usage_logs ("stencilToolId", "printCount", "machineId", notes) VALUES (${toolB}, 3, NULL, ${RUN}) RETURNING id`));
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  for (const q of [
    `DELETE FROM stencil_usage_logs WHERE notes = '${RUN}'`,
    `DELETE FROM tools WHERE code LIKE '${RUN}%'`,
    `DELETE FROM msd_exposure_logs WHERE "componentCode" LIKE '${RUN}%'`,
  ]) await qChuTest(q).catch(() => undefined);
  await H.don();
});

const reels = (rows: { componentCode: string }[]) => rows.map((r) => r.componentCode.slice(RUN.length + 1)).filter((x) => ["A", "B", "K"].includes(x)).sort();

describe("★★★ msd — ĐỌC theo phạm vi", () => {
  it("listActive — A thấy cuộn máy A + cuộn không gắn máy, KHÔNG thấy cuộn máy B; admin thấy cả ba; không gán nhà máy chỉ thấy cuộn chung", async () => {
    expect(reels(await cA.msd.listActive())).toEqual(["A", "K"]);
    expect(reels(await cAdm.msd.listActive())).toEqual(["A", "B", "K"]);
    expect(reels(await cRong.msd.listActive())).toEqual(["K"]);
  });
  it("expiringSoon — cùng luật", async () => {
    expect(reels(await cA.msd.expiringSoon())).toEqual(["A", "K"]);
    expect(reels(await cAdm.msd.expiringSoon())).toEqual(["A", "B", "K"]);
    expect(reels(await cRong.msd.expiringSoon())).toEqual(["K"]);
  });
});

describe("★★★ stencil — ĐỌC theo phạm vi", () => {
  it("status — dụng cụ nhà máy B: A thấy trạng thái RỖNG (không tên khuôn, không tổng số lần in); dụng cụ A: tổng chỉ gồm nhật ký máy A + chung (10 + 1)", async () => {
    const b = await cA.stencil.status({ stencilToolId: toolB });
    expect(b.code).toBeNull();
    expect(b.accruedPrints).toBe(0);
    expect((await cAdm.stencil.status({ stencilToolId: toolB })).accruedPrints).toBe(23);
    expect((await cA.stencil.status({ stencilToolId: toolA })).accruedPrints).toBe(11); // 10 (máy A) + 1 (chung); dòng 5 trên máy B bị loại
    expect((await cAdm.stencil.status({ stencilToolId: toolA })).accruedPrints).toBe(16);
  });
  it("listUsage — dụng cụ B ⇒ rỗng cho A; dụng cụ A: không có dòng của máy B; admin thấy hết", async () => {
    expect(await cA.stencil.listUsage({ stencilToolId: toolB })).toEqual([]);
    expect((await cAdm.stencil.listUsage({ stencilToolId: toolB })).map((r: { id: number }) => r.id)).toEqual(expect.arrayContaining([logB, logBkhongMay]));
    const a = (await cA.stencil.listUsage({ stencilToolId: toolA })).map((r: { id: number }) => r.id);
    expect(a).toContain(logA);
    expect(a).not.toContain(logAtrenB);
    expect((await cAdm.stencil.listUsage({ stencilToolId: toolA })).map((r: { id: number }) => r.id)).toContain(logAtrenB);
    expect((await cRong.stencil.listUsage({ stencilToolId: toolA })).map((r: { id: number }) => r.id)).not.toContain(logA);
  });
});
