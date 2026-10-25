/**
 * CỔNG CSDL THẬT — lô L7 (rà bảo mật tRPC, 2026-10-25): bom.listDefinitions · getDefinition · getActiveForProduct (ĐỌC theo sản phẩm; GHI đã có ở W14) + field.deviceState (robot seed).
 * Luật: BOM của sản phẩm ngoài phạm vi ≡ không tồn tại (cùng luật GHI: sản phẩm trong phạm vi, hoặc sản phẩm NHÁP chưa gắn nhà máy nào); robot ngoài phạm vi ≡ NOT_FOUND; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l7${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
const Q: Array<[string, string]> = [["machine_monitoring", "machine_status"], ["mes_bom", "mes_bom"]];
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C;
const ad: Record<string, number> = {};
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return { bom: await mk("./bomRouter", "bomRouter"), fd: await mk("./fieldRouter", "fieldRouter") };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}

beforeAll(async () => {
  const sp = async (k: string) => dangKyModelSanPhamTest(await createProductModel({ code: `${RUN}-${k}`, name: `${RUN}${k}` } as never));
  H = await seedHaiNhaMayDo(RUN, "l7", Q, await sp("PM"), taoNguoiDungTest);
  const { A, B } = H;
  for (const [k, x] of [["A", A], ["B", B]] as const) {
    ad["p" + k] = await sp(k);
    // sản phẩm chỉ gắn nhà máy của k (một lần kiểm của máy k)
    await H.dung(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
      VALUES (${x.mid}, ${ad["p" + k]}, ${RUN + "sn" + k}, 'OK', 'OK', now(), ${x.code})`);
    const [r] = await H.dung(sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId") VALUES (${RUN + "rb" + k}, ${RUN + "rb" + k}, 'sim', 'x', ${x.lid}) RETURNING id`);
    ad["rb" + k] = r.id;
  }
  ad.pD = await sp("D"); // sản phẩm nháp: chưa gắn nhà máy nào
  for (const k of ["A", "B", "D"]) {
    const [b] = await H.dung(sql`INSERT INTO bom_definitions ("productModelId", code, status) VALUES (${ad["p" + k]}, ${RUN + "bom" + k}, 'active') RETURNING id`);
    ad["bom" + k] = b.id;
    await H.dung(sql`INSERT INTO bom_line_items ("bomId", "componentCode", "qtyPer") VALUES (${b.id}, ${RUN + "cp" + k}, 1)`);
  }
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM bom_line_items WHERE "componentCode" LIKE ${l}`,
    `DELETE FROM bom_definitions WHERE code LIKE ${l}`,
    `DELETE FROM robots WHERE code LIKE ${l}`,
    `DELETE FROM product_inspections WHERE "serialNumber" LIKE ${l}`,
  ]) await qChuTest(s).catch(() => undefined);
  await H.don();
});

describe("★★★ bom — đọc theo sản phẩm", () => {
  it("getDefinition: BOM sản phẩm gắn nhà máy B ẩn với A; BOM của A và BOM sản phẩm nháp thấy; admin thấy hết", async () => {
    expect((await cA.bom.getDefinition({ id: ad.bomA })).definition?.id).toBe(ad.bomA);
    expect((await cA.bom.getDefinition({ id: ad.bomA })).lineItems.length).toBe(1);
    expect((await cA.bom.getDefinition({ id: ad.bomD })).definition?.id).toBe(ad.bomD);
    expect(await cA.bom.getDefinition({ id: ad.bomB })).toEqual({ definition: null, lineItems: [] });
    expect((await cAdm.bom.getDefinition({ id: ad.bomB })).definition?.id).toBe(ad.bomB);
    expect((await cAdm.bom.getDefinition({ id: ad.bomB })).lineItems.length).toBe(1);
    expect((await cRong.bom.getDefinition({ id: ad.bomA })).definition).toBeNull();
  });
  it("listDefinitions / getActiveForProduct theo sản phẩm", async () => {
    expect((await cA.bom.listDefinitions({ productModelId: ad.pA })).length).toBe(1);
    expect(await cA.bom.listDefinitions({ productModelId: ad.pB })).toEqual([]);
    expect((await cAdm.bom.listDefinitions({ productModelId: ad.pB })).length).toBe(1);
    expect((await cA.bom.getActiveForProduct({ productModelId: ad.pA }))?.id).toBe(ad.bomA);
    expect(await cA.bom.getActiveForProduct({ productModelId: ad.pB })).toBeNull();
    expect((await cAdm.bom.getActiveForProduct({ productModelId: ad.pB }))?.id).toBe(ad.bomB);
  });
});

describe("★★★ field.deviceState — robot seed", () => {
  it("robot của chuyền B ⇒ NOT_FOUND với A (giống robot không tồn tại); robot của A đọc được; admin đọc được B", async () => {
    const khong = await loi(() => cA.fd.deviceState({ robotId: 2147483000 }));
    expect(khong?.startsWith("NOT_FOUND")).toBe(true);
    expect(await loi(() => cA.fd.deviceState({ robotId: ad.rbB }))).toBe(khong);
    expect(await loi(() => cA.fd.deviceState({ robotId: ad.rbA }))).toBeNull();
    expect((await cA.fd.deviceState({ robotId: ad.rbA })).robot.id).toBe(ad.rbA);
    expect(await loi(() => cAdm.fd.deviceState({ robotId: ad.rbB }))).toBeNull();
    expect(await loi(() => cRong.fd.deviceState({ robotId: ad.rbA }))).toBe(khong);
  });
});
