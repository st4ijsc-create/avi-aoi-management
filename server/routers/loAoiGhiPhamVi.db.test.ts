/**
 * CỔNG CSDL THẬT — lô L1b (rà bảo mật 2026-10-24): các thủ tục GHI / "đọc-như-ghi" trong CÙNG các router của L1
 * (inspection · measurementResult · annotation(+Template/History) · annotationComparison · aoiPackage) theo PHẠM VI người dùng,
 * cộng hai việc nhỏ: (1) path traversal ở aoiPackage.getImage = TỪ CHỐI (BAD_REQUEST), không cắt-rồi-tra; (2) ảnh đã đóng dấu tên người dùng
 * KHÔNG được phục vụ lại cho người khác từ bộ nhớ đệm.
 *
 * Luật: thao tác lên thực thể của máy ngoài phạm vi ≡ thực thể không tồn tại (NOT_FOUND cùng thực thể; hàng loạt thì BỎ id ngoài phạm vi,
 * dữ liệu của nhà máy khác KHÔNG đổi). Admin (toàn quyền) không đổi — đối chứng DƯƠNG ở cuối.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

// aoiPackageRouter đọc AOI_CACHE_DIR lúc nạp module ⇒ đặt trước import (xem aoiPackageBaLoToanVenBg87.test.ts).
const CACHE_TAM = vi.hoisted(() => {
  const p = require("node:path").join(require("node:os").tmpdir(), `l1b-aoi-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.AOI_CACHE_DIR = p;
  return p;
});

const RUN = `lb${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface Nm { fid: number; mid: number; code: string; pkgId: number; pkgCode: string; insp: number; insp2: number; mr: number; ann: number; hist: number; imgUrl: string; userId: number; user2Id: number }
let A!: Nm;
let B!: Nm;
let sessA = 0, sessB = 0, sessMix = 0, sessKhaiB = 0;
const uids: number[] = [];
let uA: any, uA2: any, uAdmin: any, uRong: any;
let tmplId = 0;
let LUU_TRU = "";
let taoBangMau = false;

/** Chạy SQL bằng chủ sở hữu `aoi` — CHỈ trên CSDL `_test` (setup ép DATABASE_URL về bản sao _test). */
async function qChu(q: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const u = new URL(process.env.DATABASE_URL!);
  if (!/_test$/.test(u.pathname.replace(/^\//, ""))) throw new Error("từ chối: không phải CSDL _test");
  u.username = "aoi";
  u.password = "aoi";
  const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try { await chu.unsafe(q); } finally { await chu.end({ timeout: 5 }); }
}
async function chiTiet(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const x = e as { code?: string };
    const meta = readAppErrorMeta(e);
    const pr = (meta?.appParams ?? {}) as { entity?: string; operation?: string; field?: string };
    return `${x.code ?? "?"}:${meta?.appCode ?? "?"}:${pr.entity ?? pr.operation ?? pr.field ?? ""}`;
  }
}
const lay = async (q: ReturnType<typeof sql>) => (await dung(q))[0];

async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "quality_inspector", { tienTo: "lb", ts: RUN, ten: `LB ${ten}` });
  const u2 = await taoNguoiDungTest(ten.toLowerCase() + "2", "quality_inspector", { tienTo: "lb", ts: RUN, ten: `LB ${ten} hai` });
  uids.push(u.id, u2.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u2.id}, ${code})`);
  const pkgCode = `${RUN}-PK${ten}`;
  const storageKey = `${RUN}-${ten}.zip`;
  const [pk] = await dung(sql`INSERT INTO inspection_packages ("machineId", "packageId", "machineCode", "serialNumber", "storageKey") VALUES (${m.id}, ${pkgCode}, ${code}, ${RUN + ten}, ${storageKey}) RETURNING id`);
  await dung(sql`INSERT INTO package_images ("packageId", "pointCode", "fileName") VALUES (${pk.id}, 'MP1', 'MP1.jpg')`);
  const ok = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'OK'`))[0].l;
  const ng = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'NG'`))[0].l;
  const mkInsp = async (suffix: string, tt: string) => {
    const [pi] = await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${m.id}, ${RUN + ten + suffix}, ${tt}, ${tt}, now()) RETURNING id`);
    return pi.id as number;
  };
  const insp = await mkInsp("", ng); // NG ⇒ confirmNTF hợp lệ
  const insp2 = await mkInsp("b", ok);
  const imgUrl = `/uploads/${RUN}-${ten}.jpg`;
  const [pd] = await dung(sql`SELECT id FROM measurement_point_defs LIMIT 1`);
  const [mr] = await dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "imageUrl", "measuredValue") VALUES (${insp}, ${pd.id}, ${ng}, ${imgUrl}, 1.5) RETURNING id`);
  const [an] = await dung(sql`INSERT INTO image_annotations ("inspectionId", "measurementResultId", "imageUrl", annotations) VALUES (${insp}, ${mr.id}, ${imgUrl}, ${JSON.stringify([{ id: "x", type: "rect", color: "red", text: RUN + ten }])}::json) RETURNING id`);
  const ct = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'changetypeenum' ORDER BY e.enumsortorder LIMIT 1`))[0].l;
  const [h] = await dung(sql`INSERT INTO annotation_history ("annotationId", "imageUrl", "versionNumber", annotations, "changeType", "changedBy", "changedByName") VALUES (${an.id}, ${imgUrl}, 1, ${JSON.stringify([{ id: "x", type: "rect", color: "red", text: RUN + ten }])}::json, ${ct}, ${u.id}, 'x') RETURNING id`);
  return { fid: f.id, mid: m.id, code, pkgId: pk.id, pkgCode, insp, insp2, mr: mr.id, ann: an.id, hist: h.id, imgUrl, userId: u.id, user2Id: u2.id };
}

const caller = async (u: { id: number; role: string; name: string }) => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [aoi, insp, mres, ann, tmpl, his, cmp] = await Promise.all([
    import("./aoiPackageRouter").then((m) => m.aoiPackageRouter.createCaller(ctx)),
    import("./inspectionRouters").then((m) => m.inspectionRouter.createCaller(ctx)),
    import("./inspectionRouters").then((m) => m.measurementResultRouter.createCaller(ctx)),
    import("./annotationRouters").then((m) => m.annotationRouter.createCaller(ctx)),
    import("./annotationRouters").then((m) => m.annotationTemplateRouter.createCaller(ctx)),
    import("./annotationRouters").then((m) => m.annotationHistoryRouter.createCaller(ctx)),
    import("./annotationComparisonRouter").then((m) => m.annotationComparisonRouter.createCaller(ctx)),
  ]);
  return { aoiPackage: aoi, inspection: insp, measurementResult: mres, annotation: ann, template: tmpl, history: his, annotationComparison: cmp };
};
type C = Awaited<ReturnType<typeof caller>>;

const hang = async (id: number) => lay(sql`SELECT "acknowledgedAt", notes, tags, "isArchived", "overallResult" FROM product_inspections WHERE id = ${id}`);
const khong = "NOT_FOUND:ENTITY_NOT_FOUND:";

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  process.env.INSPECTION_STORE_FORWARD_FILE = path.join(os.tmpdir(), `l1b-wal-${Date.now()}.jsonl`);
  A = await seed("A");
  B = await seed("B");
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "lb", ts: RUN, ten: "LB ad" });
  const ur = await taoNguoiDungTest("ur", "quality_inspector", { tienTo: "lb", ts: RUN, ten: "LB ur" });
  uids.push(ad.id, ur.id);
  uA = await caller({ id: A.userId, role: "quality_inspector", name: "LB A" });
  uA2 = await caller({ id: A.user2Id, role: "quality_inspector", name: "LB A hai" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "LB ad" });
  uRong = await caller({ id: ur.id, role: "quality_inspector", name: "LB ur" });
  const sess = async (ten: string, ids: number[], mid: number | null) =>
    (await dung(sql`INSERT INTO annotation_comparison_sessions (name, "inspectionIds", "machineId", "createdBy") VALUES (${RUN + ten}, ${JSON.stringify(ids)}::json, ${mid}, ${A.userId}) RETURNING id`))[0].id as number;
  sessA = await sess("sa", [A.insp, A.insp2], A.mid);
  sessB = await sess("sb", [B.insp, B.insp2], B.mid);
  sessMix = await sess("sm", [A.insp, B.insp], null);
  sessKhaiB = await sess("sk", [A.insp, A.insp2], B.mid);
  // ⚠ bảng annotation_templates KHÔNG có migration nào (mã tham chiếu nhưng không nơi nào tạo) ⇒ tạo tạm cho bài thử, gỡ ở afterAll nếu CHÍNH test này tạo.
  const coBang = (await dung(sql`SELECT to_regclass('public.annotation_templates') AS r`))[0].r;
  if (!coBang) {
    await qChu(`CREATE TABLE annotation_templates (id serial PRIMARY KEY, name varchar(255) NOT NULL, category varchar(64) NOT NULL, description text, annotations json NOT NULL, "previewUrl" text, "isSystem" boolean NOT NULL DEFAULT false, "createdBy" integer, "createdAt" timestamp NOT NULL DEFAULT now())`);
    await qChu(`GRANT ALL ON annotation_templates TO PUBLIC`);
    await qChu(`GRANT ALL ON SEQUENCE annotation_templates_id_seq TO PUBLIC`);
    taoBangMau = true;
  }
  // mẫu chú thích dùng chung (do A tạo)
  await uA.template.create({ name: RUN + "-tm", category: "custom", annotations: [{ id: "t", type: "rect", color: "blue" }] });
  tmplId = (await lay(sql`SELECT id FROM annotation_templates WHERE name = ${RUN + "-tm"}`)).id;
  // gói ZIP thật cho gói A (ảnh JPEG do sharp dựng) để thử đóng dấu + bộ nhớ đệm
  LUU_TRU = path.join(os.tmpdir(), `l1b-store-${Date.now()}`);
  await fsp.mkdir(LUU_TRU, { recursive: true });
  const sharp = (await import("sharp")).default;
  const jpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 200 } } }).jpeg().toBuffer();
  for (const n of [A, B]) {
    const zip = new JSZip();
    zip.file("images/MP1.jpg", jpg);
    await fsp.writeFile(path.join(LUU_TRU, `${RUN}-${n === A ? "A" : "B"}.zip`), await zip.generateAsync({ type: "nodebuffer" }));
  }
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = LUU_TRU;
  // dead-letter: một mục của máy A, một của máy B, một không mã máy
  const dl = (key: string, mc: string | undefined) => JSON.stringify({ key, deadAt: new Date().toISOString(), attempts: 3, error: "x", payload: { machineCode: mc, serialNumber: "S" } });
  await fsp.writeFile(`${process.env.INSPECTION_STORE_FORWARD_FILE!.replace(/\.jsonl$/, "")}.dead.jsonl`, [dl(RUN + "dA", A.code), dl(RUN + "dB", B.code), dl(RUN + "dN", undefined)].join("\n") + "\n");
}, 180_000);

afterAll(async () => {
  if (!db) return;
  await new Promise((r) => setTimeout(r, 500)); // processComparison nền của createSession
  const d = async (q: ReturnType<typeof sql>) => { try { await dung(q); } catch { /* dọn best-effort */ } };
  try {
    const { default: postgres } = await import("postgres");
    const u = new URL(process.env.DATABASE_URL!);
    u.username = "aoi";
    u.password = "aoi";
    const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await chu`DELETE FROM measurement_results WHERE "inspectionId" IN (SELECT id FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "%"})`;
    await chu`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "%"}`;
    await chu.end({ timeout: 5 });
  } catch { /* dọn best-effort */ }
  await d(sql`DELETE FROM annotation_comparison_sessions WHERE name LIKE ${RUN + "%"}`);
  await d(sql`DELETE FROM annotation_history WHERE "imageUrl" LIKE ${"/uploads/" + RUN + "%"}`);
  await d(sql`DELETE FROM image_annotations WHERE "imageUrl" LIKE ${"/uploads/" + RUN + "%"}`);
  await d(sql`DELETE FROM annotation_templates WHERE name LIKE ${RUN + "%"}`);
  if (taoBangMau) await qChu(`DROP TABLE IF EXISTS annotation_templates`).catch(() => undefined);
  await d(sql`DELETE FROM audit_logs WHERE "userId" IN (${sql.join(uids.map((x) => sql`${x}`), sql`, `)})`);
  await d(sql`DELETE FROM package_images WHERE "packageId" IN (SELECT id FROM inspection_packages WHERE "packageId" LIKE ${RUN + "%"})`);
  await d(sql`DELETE FROM inspection_packages WHERE "packageId" LIKE ${RUN + "%"}`);
  await d(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`);
  for (const t of ["machines", "stations", "production_lines", "workshops", "factories"]) await d(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${RUN + "%"}`);
  await fsp.rm(CACHE_TAM, { recursive: true, force: true }).catch(() => undefined);
  await fsp.rm(LUU_TRU, { recursive: true, force: true }).catch(() => undefined);
  delete process.env.AOI_CACHE_DIR;
  delete process.env.INSPECTION_STORE_FORWARD_FILE;
  delete process.env.LOCAL_STORAGE_DIR;
  delete process.env.STORAGE_MODE;
});

describe("★★★ inspection / measurementResult — GHI lên lần kiểm tra của nhà máy khác", () => {
  it("confirmNTF — lần kiểm tra B ⇒ NOT_FOUND inspection, B KHÔNG đổi; lần kiểm tra A hợp lệ", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.inspection.confirmNTF({ id: B.insp, reason: "x" }))).toBe(khong + "inspection");
    expect((await hang(B.insp)).overallResult).toBe("NG");
    expect(await chiTiet(() => u.inspection.confirmNTF({ id: A.insp, reason: "x" }))).toBeNull();
  });
  it("bulkAcknowledge / batchAcknowledge — id của B bị bỏ (notFoundCount), B không được xác nhận; A được", async () => {
    const u: C = uA;
    const r = await u.inspection.bulkAcknowledge({ ids: [A.insp, B.insp] });
    expect(r).toMatchObject({ acknowledgedCount: 1, notFoundCount: 1 });
    expect((await hang(A.insp)).acknowledgedAt).not.toBeNull();
    expect((await hang(B.insp)).acknowledgedAt).toBeNull();
    const r2 = await u.measurementResult.batchAcknowledge({ ids: [String(A.insp2), String(B.insp2)] });
    expect(r2.count).toBe(1);
    expect((await hang(A.insp2)).acknowledgedAt).not.toBeNull();
    expect((await hang(B.insp2)).acknowledgedAt).toBeNull();
  });
  it("batchAddNote / batchAddTag / batchArchive — chỉ A bị đổi, B nguyên vẹn", async () => {
    const u: C = uA;
    const ids = [String(A.insp), String(B.insp)];
    await u.measurementResult.batchAddNote({ ids, note: "ghi-chu-l1b" });
    await u.measurementResult.batchAddTag({ ids, tag: "tag-l1b" });
    await u.measurementResult.batchArchive({ ids });
    const a = await hang(A.insp);
    const b = await hang(B.insp);
    expect(a.notes).toContain("ghi-chu-l1b");
    expect(String(a.tags)).toContain("tag-l1b");
    expect(a.isArchived).toBe(true);
    expect(b.notes ?? "").not.toContain("ghi-chu-l1b");
    expect(String(b.tags ?? "")).not.toContain("tag-l1b");
    expect(b.isArchived).toBeFalsy();
  });
  it("updateRemark / correctResult / classifyDefect — kết quả đo của B ⇒ NOT_FOUND measurementResult, B nguyên vẹn; analyzeWithAI(B) ≡ id không tồn tại", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.measurementResult.updateRemark({ id: B.mr, remark: "bi-sua" }))).toBe(khong + "measurementResult");
    expect(await chiTiet(() => u.measurementResult.correctResult({ id: B.mr, result: "OK", reason: "x" }))).toBe(khong + "measurementResult");
    expect(await chiTiet(() => u.measurementResult.classifyDefect({ id: B.mr, defectCatalogId: null }))).toBe(khong + "measurementResult");
    const rowB = await lay(sql`SELECT remark, result FROM measurement_results WHERE id = ${B.mr}`);
    expect(rowB.remark ?? "").not.toContain("bi-sua");
    expect(rowB.result).toBe("NG");
    const ketQuaB = await chiTiet(() => u.measurementResult.analyzeWithAI({ id: B.mr }));
    const ketQuaKhong = await chiTiet(() => u.measurementResult.analyzeWithAI({ id: 2_000_000_000 }));
    expect(ketQuaB).toBe("BAD_REQUEST:ENTITY_NOT_FOUND:measurementResult");
    expect(ketQuaB).toBe(ketQuaKhong);
    // A: hợp lệ
    expect(await chiTiet(() => u.measurementResult.updateRemark({ id: A.mr, remark: "ok-a" }))).toBeNull();
    expect((await lay(sql`SELECT remark FROM measurement_results WHERE id = ${A.mr}`)).remark).toBe("ok-a");
  });
});

describe("★★★ annotation — GHI / xuất / nhập / lịch sử", () => {
  it("save — inspectionId của B, measurementResultId của B, hoặc thiếu cả hai ⇒ bị từ chối; inspectionId của A ghi được", async () => {
    const u: C = uA;
    const url = `/uploads/${RUN}-save.jpg`;
    const ann = [{ id: "s", type: "rectangle" as const, points: [{ x: 0, y: 0 }], color: "red", lineWidth: 1 }];
    expect(await chiTiet(() => u.annotation.save({ inspectionId: B.insp, imageUrl: url, annotations: ann }))).toBe(khong + "inspection");
    expect(await chiTiet(() => u.annotation.save({ measurementResultId: B.mr, imageUrl: url, annotations: ann }))).toBe(khong + "measurementResult");
    expect(await chiTiet(() => u.annotation.save({ imageUrl: url, annotations: ann }))).toBe("BAD_REQUEST:FIELD_REQUIRED:inspectionId");
    // kết quả đo KHÔNG tồn tại ≡ kết quả đo của B (cùng thực thể); khai inspectionId của A nhưng measurementResultId của B ⇒ không lách được
    expect(await chiTiet(() => u.annotation.save({ measurementResultId: 2_000_000_000, imageUrl: url, annotations: ann }))).toBe(khong + "measurementResult");
    expect(await chiTiet(() => u.annotation.save({ inspectionId: A.insp, measurementResultId: B.mr, imageUrl: url, annotations: ann }))).toBe(khong + "measurementResult");
    expect((await dung(sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${url}`)).length).toBe(0);
    expect(await chiTiet(() => u.annotation.save({ inspectionId: A.insp, imageUrl: url, annotations: ann }))).toBeNull();
    expect((await dung(sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${url}`)).length).toBe(1);
    // measurementResultId của A ⇒ inspectionId được SUY RA từ kết quả đo
    const url2 = `/uploads/${RUN}-save2.jpg`;
    expect(await chiTiet(() => u.annotation.save({ measurementResultId: A.mr, imageUrl: url2, annotations: ann }))).toBeNull();
    expect((await lay(sql`SELECT "inspectionId" FROM image_annotations WHERE "imageUrl" = ${url2}`)).inspectionId).toBe(A.insp);
  });
  it("delete / bulkDelete — chú thích của B ⇒ NOT_FOUND / không xoá; còn nguyên", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.annotation.delete({ id: B.ann }))).toBe(khong + "annotation");
    const r = await u.annotation.bulkDelete({ imageUrls: [B.imgUrl] });
    expect(r.deletedCount).toBe(0);
    expect((await dung(sql`SELECT id FROM image_annotations WHERE id = ${B.ann}`)).length).toBe(1);
    // chú thích của B do CHÍNH người A tạo (vd. đã đổi nhà máy): quyền sở hữu qua, phạm vi vẫn phải chặn bulkDelete
    const urlCheo = `/uploads/${RUN}-cheo.jpg`;
    const [cheo] = await dung(sql`INSERT INTO image_annotations ("inspectionId", "imageUrl", annotations, "createdBy") VALUES (${B.insp}, ${urlCheo}, '[]'::json, ${A.userId}) RETURNING id`);
    expect((await u.annotation.bulkDelete({ imageUrls: [urlCheo] })).deletedCount).toBe(0);
    expect((await dung(sql`SELECT id FROM image_annotations WHERE id = ${cheo.id}`)).length).toBe(1);
    // chú thích A (người tạo là NULL ⇒ không phải của A) vẫn qua cổng phạm vi: lỗi là quyền sở hữu, không phải "không tồn tại"
    expect(await chiTiet(() => u.annotation.delete({ id: A.ann }))).toContain("FORBIDDEN");
  });
  it("bulkApplyTemplate / copyAnnotations — không ghi lên ảnh của B (kể cả khi khai inspectionId của B)", async () => {
    const u: C = uA;
    const truoc = JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${B.ann}`)).annotations);
    const r = await u.annotation.bulkApplyTemplate({ templateId: tmplId, imageUrls: [B.imgUrl, `/uploads/${RUN}-moi-b.jpg`], inspectionIds: [B.insp, B.insp] });
    expect(r.appliedCount).toBe(0);
    expect(await chiTiet(() => u.annotation.copyAnnotations({ sourceImageUrl: B.imgUrl, targetImageUrls: [A.imgUrl] }))).toBe(khong + "annotation");
    const c = await u.annotation.copyAnnotations({ sourceImageUrl: A.imgUrl, targetImageUrls: [B.imgUrl, `/uploads/${RUN}-moi-b2.jpg`], targetInspectionIds: [B.insp, B.insp] });
    expect(c.copiedCount).toBe(0);
    expect(JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${B.ann}`)).annotations)).toBe(truoc);
    expect((await dung(sql`SELECT id FROM image_annotations WHERE "imageUrl" LIKE ${"/uploads/" + RUN + "-moi-b%"}`)).length).toBe(0);
    // A: tạo mới trên ảnh của A (inspectionId của A) được
    const ok = await u.annotation.bulkApplyTemplate({ templateId: tmplId, imageUrls: [`/uploads/${RUN}-moi-a.jpg`], inspectionIds: [A.insp] });
    expect(ok.appliedCount).toBe(1);
  });
  it("import — mục thay thế ảnh B bị bỏ, mục tạo mới gắn lần kiểm tra B bị bỏ; mục của A nhập được; export chỉ máy A", async () => {
    const u: C = uA;
    const truoc = JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${B.ann}`)).annotations);
    const data = JSON.stringify([
      { imageUrl: B.imgUrl, annotations: [{ id: "k", type: "rect" }] },
      { imageUrl: `/uploads/${RUN}-nhap-b.jpg`, inspectionId: B.insp, annotations: [{ id: "k", type: "rect" }] },
      { imageUrl: `/uploads/${RUN}-nhap-a.jpg`, inspectionId: A.insp, annotations: [{ id: "k", type: "rect" }] },
    ]);
    // cùng imageUrl có thêm một hàng của lần kiểm tra B: chế độ thay thế KHÔNG được đụng tới hàng ngoài phạm vi
    const [hangB] = await dung(sql`INSERT INTO image_annotations ("inspectionId", "imageUrl", annotations) VALUES (${B.insp}, ${A.imgUrl}, '[{"id":"giu"}]'::json) RETURNING id`);
    const r0 = await u.annotation.import({ data: JSON.stringify([{ imageUrl: A.imgUrl, annotations: [{ id: "moi" }] }]), format: "json", mode: "replace" });
    expect(r0.imported).toBe(1);
    expect(JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${hangB.id}`)).annotations)).toBe('[{"id":"giu"}]');
    expect(JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${A.ann}`)).annotations)).toContain("moi");
    const r = await u.annotation.import({ data, format: "json", mode: "replace" });
    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(2); // mục tạo mới gắn B + mục thay thế ảnh B (không thấy chú thích trong phạm vi, thiếu inspectionId)
    // mục thay thế ảnh B: coi như chưa có chú thích trong phạm vi ⇒ cần inspectionId (không có) ⇒ bỏ
    expect(JSON.stringify((await lay(sql`SELECT annotations FROM image_annotations WHERE id = ${B.ann}`)).annotations)).toBe(truoc);
    expect((await dung(sql`SELECT id FROM image_annotations WHERE "imageUrl" = ${`/uploads/${RUN}-nhap-b.jpg`}`)).length).toBe(0);
    const ex = await u.annotation.export({ format: "json" });
    const xs: Array<{ machineId: number }> = JSON.parse(ex.data);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => x.machineId === A.mid)).toBe(true);
    const exAd = await uAdmin.annotation.export({ format: "json" });
    expect((JSON.parse(exAd.data) as Array<{ machineId: number }>).some((x) => x.machineId === B.mid)).toBe(true);
  });
  it("annotationHistory — list/get/compare/rollback phiên bản của chú thích B ⇒ rỗng / NOT_FOUND; của A thấy", async () => {
    const u: C = uA;
    expect(await u.history.list({ imageUrl: B.imgUrl, limit: 10 })).toEqual([]);
    expect(await u.history.list({ annotationId: B.ann, limit: 10 })).toEqual([]);
    expect((await u.history.list({ annotationId: A.ann, limit: 10 })).length).toBe(1);
    expect(await chiTiet(() => u.history.get({ id: B.hist }))).toBe(khong + "annotationVersion");
    expect(await chiTiet(() => u.history.get({ id: A.hist }))).toBeNull();
    expect(await chiTiet(() => u.history.compare({ versionId1: A.hist, versionId2: B.hist }))).toBe(khong + "annotationVersion");
    expect(await chiTiet(() => u.history.rollback({ historyId: B.hist }))).toBe(khong + "annotationVersion");
    expect((await dung(sql`SELECT id FROM annotation_history WHERE "annotationId" = ${B.ann}`)).length).toBe(1);
    expect(await chiTiet(() => u.history.rollback({ historyId: A.hist }))).toBeNull();
  });
});

describe("★★★ annotationComparison — createSession / detectPatterns / generatePdfReport", () => {
  it("createSession — lần kiểm tra của B hoặc máy khai báo B ⇒ NOT_FOUND, không tạo phiên; hợp lệ thì tạo", async () => {
    const u: C = uA;
    const truoc = (await lay(sql`SELECT count(*)::int AS n FROM annotation_comparison_sessions WHERE name LIKE ${RUN + "%"}`)).n;
    expect(await chiTiet(() => u.annotationComparison.createSession({ name: RUN + "x1", inspectionIds: [A.insp, B.insp] }))).toBe(khong + "inspection");
    expect(await chiTiet(() => u.annotationComparison.createSession({ name: RUN + "x2", inspectionIds: [A.insp, A.insp2], machineId: B.mid }))).toBe(khong + "machine");
    expect((await lay(sql`SELECT count(*)::int AS n FROM annotation_comparison_sessions WHERE name LIKE ${RUN + "%"}`)).n).toBe(truoc);
    expect(await chiTiet(() => u.annotationComparison.createSession({ name: RUN + "x3", inspectionIds: [A.insp, A.insp2], machineId: A.mid }))).toBeNull();
  });
  it("detectPatterns — phiên B / TRỘN / khai báo máy B ⇒ NOT_FOUND comparisonSession, phiên không bị ghi; phiên A chạy được", async () => {
    const u: C = uA;
    for (const id of [sessB, sessMix, sessKhaiB]) {
      expect(await chiTiet(() => u.annotationComparison.detectPatterns({ sessionId: id })), `phiên ${id}`).toBe(khong + "comparisonSession");
      expect((await lay(sql`SELECT status FROM annotation_comparison_sessions WHERE id = ${id}`)).status).not.toBe("COMPLETED");
    }
    expect(await chiTiet(() => u.annotationComparison.detectPatterns({ sessionId: sessA }))).toBeNull();
  });
  it("generatePdfReport — lần kiểm tra của B ⇒ NOT_FOUND inspection (trước khi dựng PDF)", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.annotationComparison.generatePdfReport({ inspectionId1: A.insp, inspectionId2: B.insp }))).toBe(khong + "inspection");
  });
});

describe("★★★ aoiPackage — dead-letter theo phạm vi", () => {
  it("listDeadLetters / getDeadLetterDetail — chỉ mục của máy A (mục máy B và mục không mã máy ẩn với người dùng hẹp)", async () => {
    const u: C = uA;
    // cấp quyền admin_system/canView cho A để thử lớp PHẠM VI (người dùng tự dọn qua helper: bảng permissions)
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${A.userId}, 'admin', 'admin_system', true, false, false, false)`);
    const r = await u.aoiPackage.listDeadLetters({ offset: 0, limit: 50 });
    const keys = r.entries.map((e: { key: string }) => e.key);
    expect(keys).toContain(RUN + "dA");
    expect(keys).not.toContain(RUN + "dB");
    expect(keys).not.toContain(RUN + "dN");
    expect(r.total).toBe(1);
    expect(r.totalBytes).toBe(0);
    expect((await u.aoiPackage.getDeadLetterDetail({ key: RUN + "dA" }))?.key).toBe(RUN + "dA");
    expect(await u.aoiPackage.getDeadLetterDetail({ key: RUN + "dB" })).toBeNull();
    expect(await u.aoiPackage.getDeadLetterDetail({ key: RUN + "dN" })).toBeNull();
    const ad = await uAdmin.aoiPackage.listDeadLetters({ offset: 0, limit: 50 });
    expect(ad.entries.map((e: { key: string }) => e.key)).toEqual(expect.arrayContaining([RUN + "dA", RUN + "dB", RUN + "dN"]));
  });
});

describe("★★★ aoiPackage.getImage — path traversal TỪ CHỐI + ảnh đóng dấu không rò sang người khác", () => {
  it("tên có '..', đường dẫn tuyệt đối (POSIX / Windows / UNC / ổ đĩa), NUL ⇒ BAD_REQUEST:INVALID_VALUE:fileName (không cắt-rồi-tra)", async () => {
    const u: C = uA;
    for (const fileName of ["../../etc/passwd", "..\\..\\boot.ini", "a/../../b.jpg", "x/../../../y", "..", "/etc/passwd", "\\\\srv\\share\\x.jpg", "C:\\Windows\\win.ini", "C:/x.jpg", "MP1.jpg\0.png", "images/../MP1.jpg"]) {
      expect(await chiTiet(() => u.aoiPackage.getImage({ packageId: A.pkgCode, fileName })), JSON.stringify(fileName)).toBe("BAD_REQUEST:INVALID_VALUE:fileName");
    }
    expect(await chiTiet(() => u.aoiPackage.getImage({ packageId: A.pkgCode, pointCode: "../../../secret" }))).toBe("BAD_REQUEST:INVALID_VALUE:fileName");
    // tên hợp lệ KHÔNG bị chặn bởi bộ lọc
    expect(await chiTiet(() => u.aoiPackage.getImage({ packageId: A.pkgCode, fileName: "MP1.jpg" }))).toBeNull();
  });
  it("★★★ ảnh đã đóng dấu tên người A KHÔNG được phục vụ lại cho người dùng khác (khoá cache gồm danh tính watermark)", async () => {
    const u1: C = uA;
    const u2: C = uA2;
    const r1 = await u1.aoiPackage.getImage({ packageId: A.pkgCode, fileName: "MP1.jpg" });
    const r1b = await u1.aoiPackage.getImage({ packageId: A.pkgCode, fileName: "MP1.jpg" });
    const r2 = await u2.aoiPackage.getImage({ packageId: A.pkgCode, fileName: "MP1.jpg" });
    expect(r1b.fromCache).toBe(true);
    expect(r1b.imageBase64).toBe(r1.imageBase64); // cùng người ⇒ dùng lại bản đệm
    expect(r2.fromCache).toBe(false); // người khác ⇒ KHÔNG nhận bản đệm của người trước
    expect(r2.imageBase64).not.toBe(r1.imageBase64); // dấu tên khác ⇒ điểm ảnh khác
    const tep = (await fsp.readdir(path.join(CACHE_TAM, A.pkgCode))).filter((n) => n.startsWith("MP1.jpg.wm-"));
    expect(tep.length).toBe(2);
  });
});

describe("đối chứng DƯƠNG (admin) + phạm vi rỗng", () => {
  it("admin vẫn ghi được lên dữ liệu nhà máy B ở các thủ tục chính", async () => {
    const ad: C = uAdmin;
    expect(await chiTiet(() => ad.measurementResult.updateRemark({ id: B.mr, remark: "admin-sua" }))).toBeNull();
    expect((await lay(sql`SELECT remark FROM measurement_results WHERE id = ${B.mr}`)).remark).toBe("admin-sua");
    expect(await chiTiet(() => ad.annotationComparison.detectPatterns({ sessionId: sessB }))).toBeNull();
    expect(await chiTiet(() => ad.annotation.delete({ id: B.ann }))).toBeNull();
    expect((await ad.inspection.bulkAcknowledge({ ids: [B.insp, B.insp2] })).acknowledgedCount).toBe(2);
  });
  it("người dùng không gán nhà máy ⇒ mọi thao tác GHI lên dữ liệu A/B bị từ chối / không có tác dụng", async () => {
    const r: C = uRong;
    expect(await chiTiet(() => r.inspection.confirmNTF({ id: A.insp, reason: "x" }))).toBe(khong + "inspection");
    expect(await chiTiet(() => r.measurementResult.updateRemark({ id: A.mr, remark: "r" }))).toBe(khong + "measurementResult");
    expect((await r.measurementResult.batchAcknowledge({ ids: [String(A.insp2)] })).count).toBe(0);
    expect(await chiTiet(() => r.annotation.save({ inspectionId: A.insp, imageUrl: "/uploads/x.jpg", annotations: [] }))).toBe(khong + "inspection");
    expect(await chiTiet(() => r.annotationComparison.createSession({ name: RUN + "r", inspectionIds: [A.insp, A.insp2] }))).toBe(khong + "inspection");
  });
});
