/**
 * CỔNG CSDL THẬT — lô L6a-5 (rà bảo mật tRPC, 2026-10-25): NCR + ECN theo PHẠM VI người dùng — ĐỌC lẫn GHI (dieu-phoi duyệt (a)+(b)+(c)).
 * Trước: create KHÔNG ghi factoryId ⇒ mọi phiếu NULL ⇒ người nhà máy A đọc / chuyển trạng thái phiếu NCR, ECN của MỌI nhà máy.
 * Nay: GHI suy nhà máy (NCR: từ máy của lần kiểm liên kết; ECN: theo khai / nhà máy duy nhất; sản phẩm đính kèm theo luật sản phẩm); người hẹp không xác định được ⇒ BAD_REQUEST;
 * ĐỌC: factoryId ∈ phạm vi (NULL chỉ toàn quyền); ngoài phạm vi ≡ không tồn tại.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l6n${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { ncr: any; ecn: any };
let cA: C, cAdm: C, cRong: C, cHai: C;
let pmA = 0, pmB = 0, ncrB = 0, ecnB = 0, ncrA = 0, ecnA = 0, ncrNull = 0, ecnNull = 0;
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [n, e] = await Promise.all([
    import("./ncrRouter").then((x) => x.ncrRouter.createCaller(ctx)),
    import("./ecnRouter").then((x) => x.ecnRouter.createCaller(ctx)),
  ]);
  return { ncr: n, ecn: e };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    const p = (meta?.appParams ?? {}) as { entity?: string; field?: string };
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${p.entity ?? p.field ?? ""}`;
  }
}

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6n", [["machine_control", "machine_control"]], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const d = H.dung;
  pmA = (await d(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PMA"}, ${RUN}) RETURNING id`))[0].id;
  pmB = (await d(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PMB"}, ${RUN}) RETURNING id`))[0].id;
  for (const [nm, pm] of [[H.A, pmA], [H.B, pmB]] as const) {
    await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode") VALUES (${nm.mid}, ${pm}, ${nm.code + "-P2"}, 'OK', 'OK', now(), ${nm.code})`);
  }
  // người có HAI nhà máy (A + B) và người không phạm vi
  const hai = await taoNguoiDungTest("hai", "supervisor", { tienTo: "l6n", ts: RUN, ten: "l6n hai" });
  await d(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${hai.id}, ${H.A.code}), (${hai.id}, ${H.B.code})`);
  await d(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${hai.id}, 'machine_control'::permissioncategoryenum, 'machine_control', true, true, true, true)`);
  // phiếu có sẵn của nhà máy B và phiếu NULL (do admin)
  ncrB = (await d(sql`INSERT INTO nonconformance_reports ("ncrKey", source, "raisedBy", status, "factoryId") VALUES (${RUN + "-NB"}, 'audit', ${H.B.userId}, 'open', ${H.B.fid}) RETURNING id`))[0].id;
  ncrNull = (await d(sql`INSERT INTO nonconformance_reports ("ncrKey", source, "raisedBy", status) VALUES (${RUN + "-NN"}, 'audit', ${H.B.userId}, 'open') RETURNING id`))[0].id;
  ecnB = (await d(sql`INSERT INTO engineering_changes ("ecnKey", title, "changeType", "requestedBy", status, "factoryId") VALUES (${RUN + "-EB"}, 'b', 'document', ${H.B.userId}, 'draft', ${H.B.fid}) RETURNING id`))[0].id;
  ecnNull = (await d(sql`INSERT INTO engineering_changes ("ecnKey", title, "changeType", "requestedBy", status) VALUES (${RUN + "-EN"}, 'n', 'document', ${H.B.userId}, 'draft') RETURNING id`))[0].id;
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
  cHai = await caller({ id: hai.id, role: "supervisor", name: "l6n hai" });
}, 300_000);

afterAll(async () => {
  if (!H) return;
  for (const q of [
    `DELETE FROM nonconformance_reports WHERE "ncrKey" LIKE '${RUN}%'`,
    `DELETE FROM engineering_change_items WHERE "ecnId" IN (SELECT id FROM engineering_changes WHERE "ecnKey" LIKE '${RUN}%')`,
    `DELETE FROM engineering_changes WHERE "ecnKey" LIKE '${RUN}%'`,
  ]) await qChuTest(q).catch(() => undefined);
  await H.don();
});

describe("★★★ NCR — GHI suy nhà máy · ĐỌC theo phạm vi", () => {
  it("create — lần kiểm liên kết của A ⇒ factoryId = A; lần kiểm của B ⇒ NOT_FOUND 'inspection'; không liên kết ⇒ nhà máy duy nhất của người gọi", async () => {
    const a = await cA.ncr.create({ source: "audit", ncrKey: RUN + "-1", linkedInspectionId: H.A.insp });
    ncrA = a.id;
    expect(a.factoryId).toBe(H.A.fid);
    expect(await loi(() => cA.ncr.create({ source: "audit", ncrKey: RUN + "-2", linkedInspectionId: H.B.insp }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await loi(() => cA.ncr.create({ source: "audit", ncrKey: RUN + "-3", linkedInspectionId: 2147483000 }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect((await cA.ncr.create({ source: "audit", ncrKey: RUN + "-4" })).factoryId).toBe(H.A.fid);
  });
  it("create — người có HAI nhà máy không nêu gì ⇒ BAD_REQUEST factoryId; nêu B ⇒ B; nêu nhà máy lạ ⇒ NOT_FOUND 'factory'; admin để trống ⇒ NULL", async () => {
    expect(await loi(() => cHai.ncr.create({ source: "audit", ncrKey: RUN + "-5" }))).toBe("BAD_REQUEST:FIELD_REQUIRED:factoryId");
    expect((await cHai.ncr.create({ source: "audit", ncrKey: RUN + "-6", factoryId: H.B.fid })).factoryId).toBe(H.B.fid);
    expect(await loi(() => cHai.ncr.create({ source: "audit", ncrKey: RUN + "-7", factoryId: 2147483000 }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:factory");
    expect((await cAdm.ncr.create({ source: "audit", ncrKey: RUN + "-8" })).factoryId).toBeNull();
    expect(await loi(() => cRong.ncr.create({ source: "audit", ncrKey: RUN + "-9" }))).toBe("BAD_REQUEST:FIELD_REQUIRED:factoryId");
  });
  it("list / getById — A thấy phiếu A, KHÔNG thấy phiếu B / NULL; getById ngoài phạm vi ≡ id không có thật; admin thấy hết", async () => {
    const ids = (rows: { id: number }[]) => rows.map((r) => r.id);
    const a = ids(await cA.ncr.list({ limit: 500 }));
    expect(a).toContain(ncrA);
    expect(a).not.toContain(ncrB);
    expect(a).not.toContain(ncrNull);
    const adm = ids(await cAdm.ncr.list({ limit: 500 }));
    for (const x of [ncrA, ncrB, ncrNull]) expect(adm).toContain(x);
    expect(ids(await cRong.ncr.list({ limit: 500 }))).not.toContain(ncrA);
    const khong = await loi(() => cA.ncr.getById({ id: 2147483000 }));
    expect(khong).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ncr");
    expect(await loi(() => cA.ncr.getById({ id: ncrB }))).toBe(khong);
    expect(await loi(() => cA.ncr.getById({ id: ncrNull }))).toBe(khong);
    expect(await loi(() => cAdm.ncr.getById({ id: ncrNull }))).toBeNull();
  });
  it("transition — phiếu B ngoài phạm vi ⇒ NOT_FOUND; phiếu A chuyển được", async () => {
    expect(await loi(() => cA.ncr.transition({ id: ncrB, action: "review" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ncr");
    expect(await loi(() => cA.ncr.transition({ id: ncrNull, action: "review" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ncr");
    expect(await loi(() => cA.ncr.transition({ id: ncrA, action: "review" }))).toBeNull();
  });
});

describe("★★★ ECN — GHI suy nhà máy · ĐỌC theo phạm vi", () => {
  it("create — sản phẩm của B ⇒ NOT_FOUND 'productModel'; sản phẩm của A ⇒ factoryId = A; hai nhà máy không nêu ⇒ BAD_REQUEST; admin để trống ⇒ NULL", async () => {
    expect(await loi(() => cA.ecn.create({ title: "x", changeType: "document", ecnKey: RUN + "-E1", productModelId: pmB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productModel");
    const a = await cA.ecn.create({ title: "a", changeType: "document", ecnKey: RUN + "-E2", productModelId: pmA });
    ecnA = a.id;
    expect(a.factoryId).toBe(H.A.fid);
    expect(await loi(() => cHai.ecn.create({ title: "h", changeType: "document", ecnKey: RUN + "-E3" }))).toBe("BAD_REQUEST:FIELD_REQUIRED:factoryId");
    expect((await cHai.ecn.create({ title: "h", changeType: "document", ecnKey: RUN + "-E4", factoryId: H.A.fid })).factoryId).toBe(H.A.fid);
    expect((await cAdm.ecn.create({ title: "ad", changeType: "document", ecnKey: RUN + "-E5" })).factoryId).toBeNull();
  });
  it("list / getById / getItems — ngoài phạm vi ≡ không tồn tại / rỗng; admin thấy hết", async () => {
    const ids = (rows: { id: number }[]) => rows.map((r) => r.id);
    const a = ids(await cA.ecn.list({ limit: 500 }));
    expect(a).toContain(ecnA);
    expect(a).not.toContain(ecnB);
    expect(a).not.toContain(ecnNull);
    const adm = ids(await cAdm.ecn.list({ limit: 500 }));
    for (const x of [ecnA, ecnB, ecnNull]) expect(adm).toContain(x);
    const khong = await loi(() => cA.ecn.getById({ id: 2147483000 }));
    expect(khong).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ecn");
    expect(await loi(() => cA.ecn.getById({ id: ecnB }))).toBe(khong);
    expect(await loi(() => cA.ecn.getById({ id: ecnNull }))).toBe(khong);
    await H.dung(sql`INSERT INTO engineering_change_items ("ecnId", "entityType", action) VALUES (${ecnB}, 'bom', 'modify')`);
    expect(await cA.ecn.getItems({ ecnId: ecnB })).toEqual([]);
    expect((await cAdm.ecn.getItems({ ecnId: ecnB })).length).toBe(1);
  });
  it("★★★ ECN NULL nhà máy nhưng GẮN SẢN PHẨM (backfill không suy được — sản phẩm đa nhà máy): theo luật sản phẩm L3 — sản phẩm của A ⇒ A thấy; sản phẩm của B ⇒ A không thấy", async () => {
    const eA = (await H.dung(sql`INSERT INTO engineering_changes ("ecnKey", title, "changeType", "requestedBy", status, "productModelId") VALUES (${RUN + "-EPA"}, 'pa', 'product', ${H.B.userId}, 'draft', ${pmA}) RETURNING id`))[0].id;
    const eB = (await H.dung(sql`INSERT INTO engineering_changes ("ecnKey", title, "changeType", "requestedBy", status, "productModelId") VALUES (${RUN + "-EPB"}, 'pb', 'product', ${H.B.userId}, 'draft', ${pmB}) RETURNING id`))[0].id;
    const ids = (rows: { id: number }[]) => rows.map((r) => r.id);
    const a = ids(await cA.ecn.list({ limit: 500 }));
    expect(a).toContain(eA);
    expect(a).not.toContain(eB);
    expect(a).not.toContain(ecnNull); // NULL không sản phẩm vẫn chỉ toàn quyền
    expect(await loi(() => cA.ecn.getById({ id: eA }))).toBeNull();
    expect(await loi(() => cA.ecn.getById({ id: eB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ecn");
    expect(await loi(() => cA.ecn.transition({ id: eB, action: "submit" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ecn");
    expect(await loi(() => cA.ecn.transition({ id: eA, action: "submit" }))).toBeNull();
    const adm = ids(await cAdm.ecn.list({ limit: 500 }));
    expect(adm).toContain(eA);
    expect(adm).toContain(eB);
    expect(ids(await cRong.ecn.list({ limit: 500 }))).not.toContain(eA);
  });
  it("transition — phiếu B / NULL ngoài phạm vi ⇒ NOT_FOUND; phiếu A chuyển được", async () => {
    expect(await loi(() => cA.ecn.transition({ id: ecnB, action: "submit" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ecn");
    expect(await loi(() => cA.ecn.transition({ id: ecnNull, action: "submit" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ecn");
    expect(await loi(() => cA.ecn.transition({ id: ecnA, action: "submit" }))).toBeNull();
  });
});
