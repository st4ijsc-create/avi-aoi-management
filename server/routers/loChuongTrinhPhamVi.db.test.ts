/**
 * CỔNG CSDL THẬT — lô L3 (rà bảo mật tRPC, 2026-10-25): programming (dự án · phiên bản · build · deploy · symbol) · ir · inspectionProgram · sop theo PHẠM VI người dùng.
 *
 * Lỗ: tài khoản gán nhà máy A đọc mã nguồn PLC/robot/IR của nhà máy B, tạo phiên bản/build/mô phỏng/deploy, duyệt-từ chối-rollback deploy, xoá dự án của B; đường deploy chỉ kiểm phạm vi khi người gọi
 * TỰ gửi `expectedProjectId`; chương trình kiểm tra và SOP của nhà máy khác đọc/sửa/phát hành được.
 * Luật: dự án thấy được ⇔ factoryId ∈ phạm vi, hoặc (chưa gắn nhà máy) thiết bị ∈ phạm vi; phiên bản/build/deploy/symbol thừa hưởng phạm vi dự án. Ngoài phạm vi ≡ không tồn tại.
 * Quyết chủ dự án (2026-10-25): bản chương trình kiểm tra cấp SẢN PHẨM và SOP không gắn trạm = dùng chung — mọi người ĐỌC, chỉ phạm vi TOÀN QUYỀN soạn/duyệt/phát hành/sửa/xoá.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

process.env.DPC_IR_V2_ENABLED = "true";
process.env.DPC_STREAMING_ENABLED = "true";

const RUN = `l3${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const lay = async (q: ReturnType<typeof sql>) => (await dung(q))[0];

interface Nm { projMit: number; relReleased: number; fid: number; mid: number; lid: number; sid: number; code: string; proj: number; projDev: number; art: number; build: number; dep: number; sym: number; irProj: number; irArt: number; rel: number; relPend: number; sop: number; ex: number; userId: number }
let A!: Nm;
let B!: Nm;
let orphanProj = 0;
let productId = 0;
let relProduct = 0;
let relProductPend = 0;
let sopShared = 0;
let exLineB = 0;
let exNoneOther = 0;
let exNoneMine = 0;
const uids: number[] = [];
let uA: any, uAdmin: any, uRong: any;
type C = { programming: any; ir: any; inspectionProgram: any; sop: any };

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
    const pr = (meta?.appParams ?? {}) as { entity?: string; operation?: string; field?: string; action?: string };
    return `${x.code ?? "?"}:${meta?.appCode ?? "?"}:${pr.entity ?? pr.operation ?? pr.field ?? pr.action ?? ""}`;
  }
}
const khong = "NOT_FOUND:ENTITY_NOT_FOUND:";
const FLOW = JSON.stringify({ flow_id: "f", target_device_type: "generic", version: 1, blocks: [{ type: "wait", ms: 10 }] });

async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "supervisor", { tienTo: "l3", ts: RUN, ten: `L3 ${ten}` });
  uids.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  // dự án gắn nhà máy · dự án CHƯA gắn nhà máy nhưng gắn thiết bị (máy) · dự án IR
  const [p] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId", "deviceId") VALUES (${code + "-P"}, ${"P" + ten}, 'stub', ${f.id}, ${m.id}) RETURNING id`);
  const [pd] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId", "deviceId") VALUES (${code + "-PD"}, ${"PD" + ten}, 'stub', NULL, ${m.id}) RETURNING id`);
  const [ip] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId", "deviceId") VALUES (${code + "-IR"}, ${"IR" + ten}, 'ir-flow', ${f.id}, ${m.id}) RETURNING id`);
  const [ad] = await dung(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId") VALUES (${code + "-AD"}, ${code}, 'stub', 'x://', ${m.id}) RETURNING id`);
  const [pm] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId", "deviceId") VALUES (${code + "-PM"}, ${"PM" + ten}, 'mitsubishi-engineering', NULL, ${ad.id}) RETURNING id`);
  const [a] = await dung(sql`INSERT INTO program_artifacts ("projectId", branch, version, kind, language, content, "contentHash", status) VALUES (${p.id}, 'main', 1, 'stub', 'txt', ${"src-" + ten}, ${"h" + ten}, 'draft') RETURNING id`);
  const [ia] = await dung(sql`INSERT INTO program_artifacts ("projectId", branch, version, kind, language, content, "contentHash", status) VALUES (${ip.id}, 'main', 1, 'ir-flow', 'ir-json', ${FLOW}, ${"hi" + ten}, 'draft') RETURNING id`);
  const [b] = await dung(sql`INSERT INTO program_builds ("artifactId", "adapterKind", status, ok) VALUES (${a.id}, 'stub', 'ok', true) RETURNING id`);
  const [d] = await dung(sql`INSERT INTO program_deployments ("buildId", "projectId", "deviceId", stage, status, "idempotencyKey") VALUES (${b.id}, ${p.id}, ${m.id}, 'production', 'awaiting_approval', ${code + "-idem"}) RETURNING id`);
  // một lần deploy ĐÃ HOÀN TẤT (ma trận máy × phiên bản chỉ tính deployed/verified)
  await dung(sql`INSERT INTO program_deployments ("buildId", "projectId", "deviceId", stage, status, "idempotencyKey") VALUES (${b.id}, ${p.id}, ${m.id}, 'staging', 'verified', ${code + "-idem2"})`);
  const [sy] = await dung(sql`INSERT INTO program_symbols ("projectId", name) VALUES (${p.id}, ${"sym-" + ten}) RETURNING id`);
  // chương trình kiểm tra gắn máy (nháp + chờ duyệt)
  const [r] = await dung(sql`INSERT INTO inspection_program_releases ("productModelId", "machineId", version, status, snapshot, checksum) VALUES (${productId}, ${m.id}, ${ten === "A" ? 1 : 2}, 'draft', '[]'::jsonb, ${"c" + ten}) RETURNING id`);
  const [rp] = await dung(sql`INSERT INTO inspection_program_releases ("productModelId", "machineId", version, status, snapshot, checksum) VALUES (${productId}, ${m.id}, ${ten === "A" ? 3 : 4}, 'pending_approval', '[]'::jsonb, ${"cp" + ten}) RETURNING id`);
  // SOP gắn trạm + một lượt thực thi ở trạm
  const [so] = await dung(sql`INSERT INTO sops (code, title, station_id, status, version) VALUES (${code + "-SOP"}, ${"SOP " + ten}, ${s.id}, 'active', 1) RETURNING id`);
  await dung(sql`INSERT INTO sop_steps (sop_id, step_no, text) VALUES (${so.id}, 1, 'b1')`);
  const [e] = await dung(sql`INSERT INTO sop_executions (sop_id, station_id, operator_id, status) VALUES (${so.id}, ${s.id}, ${u.id}, 'in_progress') RETURNING id`);
  const [rr] = await dung(sql`INSERT INTO inspection_program_releases ("productModelId", "machineId", version, status, snapshot, checksum) VALUES (${productId}, ${m.id}, ${ten === "A" ? 7 : 8}, 'released', '[]'::jsonb, ${"cr" + ten}) RETURNING id`);
  return { projMit: pm.id, relReleased: rr.id, fid: f.id, mid: m.id, lid: l.id, sid: s.id, code, proj: p.id, projDev: pd.id, art: a.id, build: b.id, dep: d.id, sym: sy.id, irProj: ip.id, irArt: ia.id, rel: r.id, relPend: rp.id, sop: so.id, ex: e.id, userId: u.id };
}

const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [p, i, ip, s] = await Promise.all([
    import("./programmingRouter").then((m) => m.programmingRouter.createCaller(ctx)),
    import("./irRouter").then((m) => m.irRouter.createCaller(ctx)),
    import("./inspectionProgramRouter").then((m) => m.inspectionProgramRouter.createCaller(ctx)),
    import("./sopRouter").then((m) => m.sopRouter.createCaller(ctx)),
  ]);
  return { programming: p, ir: i, inspectionProgram: ip, sop: s };
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const [pm] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PM"}, ${RUN + "-PM"}) RETURNING id`);
  productId = pm.id;
  A = await seed("A");
  B = await seed("B");
  // dự án mồ côi (không nhà máy, không thiết bị) · bản chương trình cấp SẢN PHẨM · SOP dùng chung · các lượt thực thi đặc biệt
  orphanProj = (await dung(sql`INSERT INTO program_projects (code, name, kind) VALUES (${RUN + "-ORPH"}, ${"orph"}, 'stub') RETURNING id`))[0].id;
  relProduct = (await dung(sql`INSERT INTO inspection_program_releases ("productModelId", "machineId", version, status, snapshot, checksum) VALUES (${productId}, NULL, 5, 'released', '[]'::jsonb, 'cp0') RETURNING id`))[0].id;
  relProductPend = (await dung(sql`INSERT INTO inspection_program_releases ("productModelId", "machineId", version, status, snapshot, checksum) VALUES (${productId}, NULL, 6, 'pending_approval', '[]'::jsonb, 'cp1') RETURNING id`))[0].id;
  sopShared = (await dung(sql`INSERT INTO sops (code, title, station_id, status, version) VALUES (${RUN + "-SHARED"}, 'SOP chung', NULL, 'draft', 1) RETURNING id`))[0].id;
  await dung(sql`INSERT INTO sop_steps (sop_id, step_no, text) VALUES (${sopShared}, 1, 'b1')`);
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l3", ts: RUN, ten: "L3 ad" });
  const ur = await taoNguoiDungTest("ur", "supervisor", { tienTo: "l3", ts: RUN, ten: "L3 ur" });
  uids.push(ad.id, ur.id);
  exLineB = (await dung(sql`INSERT INTO sop_executions (sop_id, line_id, operator_id, status) VALUES (${B.sop}, ${B.lid}, ${ad.id}, 'in_progress') RETURNING id`))[0].id;
  exNoneOther = (await dung(sql`INSERT INTO sop_executions (sop_id, operator_id, status) VALUES (${A.sop}, ${ad.id}, 'in_progress') RETURNING id`))[0].id;
  await dung(sql`INSERT INTO sop_executions (sop_id, operator_id, status) VALUES (${B.sop}, ${A.userId}, 'in_progress')`);
  exNoneMine = (await dung(sql`INSERT INTO sop_executions (sop_id, operator_id, status) VALUES (${A.sop}, ${A.userId}, 'in_progress') RETURNING id`))[0].id;
  for (const uid of [A.userId, B.userId, ur.id]) {
    for (const mod of ["machine_status", "machine_control", "settings_products"]) {
      await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, ${mod === "settings_products" ? "settings" : mod === "machine_status" ? "machine_monitoring" : mod}::permissioncategoryenum, ${mod}, true, true, true, true)`);
    }
  }
  uA = await caller({ id: A.userId, role: "supervisor", name: "L3 A" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "L3 ad" });
  uRong = await caller({ id: ur.id, role: "supervisor", name: "L3 ur" });
}, 240_000);

afterAll(async () => {
  if (!db) return;
  const k = (s: string) => s.replace(/'/g, "''");
  const like = `'${k(RUN)}%'`;
  const stmts = [
    `DELETE FROM program_sim_runs WHERE "buildId" IN (SELECT b.id FROM program_builds b JOIN program_artifacts a ON a.id = b."artifactId" JOIN program_projects p ON p.id = a."projectId" WHERE p.code LIKE ${like})`,
    `DELETE FROM program_deployments WHERE "projectId" IN (SELECT id FROM program_projects WHERE code LIKE ${like})`,
    `DELETE FROM program_builds WHERE "artifactId" IN (SELECT a.id FROM program_artifacts a JOIN program_projects p ON p.id = a."projectId" WHERE p.code LIKE ${like})`,
    `DELETE FROM program_artifacts WHERE "projectId" IN (SELECT id FROM program_projects WHERE code LIKE ${like})`,
    `DELETE FROM program_symbols WHERE "projectId" IN (SELECT id FROM program_projects WHERE code LIKE ${like})`,
    `DELETE FROM program_projects WHERE code LIKE ${like}`,
    `DELETE FROM device_adapters WHERE code LIKE ${like}`,
    `DELETE FROM inspection_program_releases WHERE "productModelId" IN (SELECT id FROM product_models WHERE code LIKE ${like})`,
    `DELETE FROM product_models WHERE code LIKE ${like}`,
    `DELETE FROM sop_executions WHERE sop_id IN (SELECT id FROM sops WHERE code LIKE ${like})`,
    `DELETE FROM sop_steps WHERE sop_id IN (SELECT id FROM sops WHERE code LIKE ${like} OR code LIKE ${like})`,
    `DELETE FROM sops WHERE code LIKE ${like}`,
    `DELETE FROM audit_logs WHERE "entityName" LIKE ${like}`,
    `DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`,
    ...["machines", "stations", "production_lines", "workshops", "factories"].map((t) => `DELETE FROM ${t} WHERE code LIKE ${like}`),
  ];
  for (const s of stmts) { try { await qChu(s); } catch { /* dọn best-effort */ } }
});

describe("★★★ programming — dự án / phiên bản / build / deploy / symbol của nhà máy khác", () => {
  it("listProjects — chỉ dự án của A (gắn nhà máy A, hoặc chưa gắn nhưng thiết bị ∈ A); dự án mồ côi chỉ toàn quyền", async () => {
    const u: C = uA;
    const ids = (await u.programming.listProjects({ limit: 500 })).map((p: { id: number }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([A.proj, A.projDev, A.irProj, A.projMit]));
    for (const x of [B.proj, B.projDev, B.irProj, B.projMit, orphanProj]) expect(ids).not.toContain(x);
    const ad = (await uAdmin.programming.listProjects({ limit: 500 })).map((p: { id: number }) => p.id);
    expect(ad).toEqual(expect.arrayContaining([A.proj, B.proj, B.projDev, orphanProj]));
    expect((await uRong.programming.listProjects({ limit: 500 })).map((p: { id: number }) => p.id)).not.toContain(A.proj);
  });
  it("getProject / getArtifact — dự án-phiên bản của B ⇒ NOT_FOUND; danh sách theo id ⇒ rỗng", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.programming.getProject({ id: B.proj }))).toBe(khong + "programmingProject");
    expect(await chiTiet(() => u.programming.getProject({ id: B.projDev }))).toBe(khong + "programmingProject");
    expect(await chiTiet(() => u.programming.getProject({ id: orphanProj }))).toBe(khong + "programmingProject");
    expect(await chiTiet(() => u.programming.getProject({ id: A.proj }))).toBeNull();
    expect(await chiTiet(() => u.programming.getProject({ id: A.projDev }))).toBeNull();
    expect(await chiTiet(() => u.programming.getArtifact({ id: B.art }))).toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.programming.getArtifact({ id: A.art }))).toBeNull();
    expect(await u.programming.listArtifacts({ projectId: B.proj })).toEqual([]);
    expect((await u.programming.listArtifacts({ projectId: A.proj })).length).toBe(1);
    expect(await u.programming.listBuilds({ artifactId: B.art })).toEqual([]);
    expect((await u.programming.listBuilds({ artifactId: A.art })).length).toBe(1);
    expect(await u.programming.listDeployments({ projectId: B.proj })).toEqual([]);
    expect((await u.programming.listDeployments({ projectId: A.proj })).length).toBe(2);
    expect(await u.programming.listSymbols({ projectId: B.proj })).toEqual([]);
    expect((await u.programming.listSymbols({ projectId: A.proj })).length).toBe(1);
  });
  it("listDeployApprovals / fleetVersionMatrix — chỉ deploy của dự án A", async () => {
    const u: C = uA;
    const ch = (await u.programming.listDeployApprovals()).map((x: { deployment: { id: number } }) => x.deployment.id);
    expect(ch).toContain(A.dep);
    expect(ch).not.toContain(B.dep);
    const mt = await u.programming.fleetVersionMatrix();
    const dv = mt.map((r: { deviceId: number }) => r.deviceId);
    expect(dv).toContain(A.mid);
    expect(dv).not.toContain(B.mid);
    expect(await u.programming.fleetVersionMatrix({ projectId: B.proj })).toEqual([]);
    const adm = (await uAdmin.programming.fleetVersionMatrix()).map((r: { deviceId: number }) => r.deviceId);
    expect(adm).toEqual(expect.arrayContaining([A.mid, B.mid]));
  });
  it("GHI dự án — createProject (thiết bị B / đóng dấu nhà máy A), updateProject / deleteProject (B) ⇒ NOT_FOUND và B nguyên vẹn", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.programming.createProject({ code: RUN + "-X1", name: "x", kind: "stub", deviceId: B.mid }))).toBe(khong + "machine");
    expect((await dung(sql`SELECT id FROM program_projects WHERE code = ${RUN + "-X1"}`)).length).toBe(0);
    const tao = await u.programming.createProject({ code: RUN + "-X2", name: "x2", kind: "stub", deviceId: A.mid });
    expect(tao.factoryId).toBe(A.fid); // đóng dấu nhà máy của người dùng
    expect(await chiTiet(() => u.programming.updateProject({ id: B.proj, name: "bi-sua" }))).toBe(khong + "programmingProject");
    expect((await lay(sql`SELECT name FROM program_projects WHERE id = ${B.proj}`)).name).toBe("PB");
    expect(await chiTiet(() => u.programming.updateProject({ id: A.proj, deviceId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.programming.deleteProject({ id: B.proj }))).toBe(khong + "programmingProject");
    expect((await dung(sql`SELECT id FROM program_projects WHERE id = ${B.proj}`)).length).toBe(1);
    expect((await dung(sql`SELECT id FROM program_artifacts WHERE "projectId" = ${B.proj}`)).length).toBe(1);
    expect(await chiTiet(() => u.programming.deleteProject({ id: tao.id }))).toBeNull();
  });
  it("GHI phiên bản / build — createArtifact · validate · review · requestVersionReview · buildArtifact · simulateBuild trên B ⇒ NOT_FOUND, không ghi", async () => {
    const u: C = uA;
    const nArt = (await dung(sql`SELECT count(*)::int AS n FROM program_artifacts WHERE "projectId" = ${B.proj}`))[0].n;
    expect(await chiTiet(() => u.programming.createArtifact({ projectId: B.proj, language: "txt", content: "x" }))).toBe(khong + "programmingProject");
    expect((await dung(sql`SELECT count(*)::int AS n FROM program_artifacts WHERE "projectId" = ${B.proj}`))[0].n).toBe(nArt);
    expect(await chiTiet(() => u.programming.validateArtifact({ artifactId: B.art }))).toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.programming.reviewArtifact({ artifactId: B.art, decision: "approved" }))).toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.programming.requestVersionReview({ artifactId: B.art }))).toBe(khong + "programmingArtifact");
    const nBuild = (await dung(sql`SELECT count(*)::int AS n FROM program_builds WHERE "artifactId" = ${B.art}`))[0].n;
    expect(await chiTiet(() => u.programming.buildArtifact({ artifactId: B.art }))).toBe(khong + "programmingArtifact");
    expect((await dung(sql`SELECT count(*)::int AS n FROM program_builds WHERE "artifactId" = ${B.art}`))[0].n).toBe(nBuild);
    expect(await chiTiet(() => u.programming.simulateBuild({ buildId: B.build, scenario: {} }))).toBe(khong + "programBuild");
    // đối chứng: phiên bản/build của A đi qua cổng phạm vi (lỗi muộn hơn nếu có không phải 'không tồn tại')
    expect(await chiTiet(() => u.programming.validateArtifact({ artifactId: A.art }))).not.toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.programming.createArtifact({ projectId: A.proj, language: "txt", content: "moi" }))).toBeNull();
  });
  it("GHI symbol — upsertSymbol (B) ⇒ NOT_FOUND; deleteSymbol (B) không xoá; startWatch (B) ⇒ NOT_FOUND", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.programming.upsertSymbol({ projectId: B.proj, name: "x" }))).toBe(khong + "programmingProject");
    await u.programming.deleteSymbol({ id: B.sym });
    expect((await dung(sql`SELECT id FROM program_symbols WHERE id = ${B.sym}`)).length).toBe(1);
    expect(await chiTiet(() => u.programming.startWatch({ projectId: B.proj, symbols: ["a"] }))).toBe(khong + "programmingProject");
    // stopWatch: người ngoài phạm vi KHÔNG dừng được phiên theo dõi của dự án A
    const { getEngineeringStreamManager } = await import("../services/programming/engineeringStream");
    const started = await u.programming.startWatch({ projectId: A.proj, symbols: ["a"] });
    expect(started.started).toBe(true);
    const phien = () => getEngineeringStreamManager().activeSessions().map((s: { sessionId: string }) => s.sessionId);
    expect(phien()).toContain(`proj-${A.proj}`);
    await (uRong as C).programming.stopWatch({ projectId: A.proj });
    expect(phien()).toContain(`proj-${A.proj}`);
    await u.programming.stopWatch({ projectId: A.proj });
    expect(phien()).not.toContain(`proj-${A.proj}`);
    expect(await chiTiet(() => u.programming.upsertSymbol({ projectId: A.proj, name: "mới" }))).toBeNull();
    await u.programming.deleteSymbol({ id: A.sym });
    expect((await dung(sql`SELECT id FROM program_symbols WHERE id = ${A.sym}`)).length).toBe(0);
  });
  it("★★★ ĐƯỜNG DEPLOY — KHÔNG có expectedProjectId vẫn bị chặn phạm vi: deployBuild / requestDeployApproval / deployToFleet (build B hoặc thiết bị B) ⇒ NOT_FOUND, không tạo hàng deploy", async () => {
    const u: C = uA;
    const nDep = (await dung(sql`SELECT count(*)::int AS n FROM program_deployments WHERE "buildId" IN (${B.build}, ${A.build})`))[0].n;
    const base = { stage: "staging" as const, idempotencyKey: RUN + "-k1", actionId: RUN + "-act", totpCode: "000000" };
    expect(await chiTiet(() => u.programming.deployBuild({ ...base, buildId: B.build }))).toBe(khong + "programBuild");
    expect(await chiTiet(() => u.programming.deployBuild({ ...base, buildId: A.build, deviceId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.programming.requestDeployApproval({ buildId: B.build, idempotencyKey: RUN + "-k2", reason: "x" }))).toBe(khong + "programBuild");
    expect(await chiTiet(() => u.programming.requestDeployApproval({ buildId: A.build, idempotencyKey: RUN + "-k3", deviceId: B.mid, reason: "x" }))).toBe(khong + "machine");
    const fleet = { stage: "staging" as const, strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: true }, idempotencyKeyPrefix: RUN + "-f", actionId: RUN + "-fa", totpCode: "000000" };
    expect(await chiTiet(() => u.programming.deployToFleet({ ...fleet, buildId: B.build, deviceIds: [A.mid] }))).toBe(khong + "programBuild");
    expect(await chiTiet(() => u.programming.deployToFleet({ ...fleet, buildId: A.build, deviceIds: [A.mid, B.mid] }))).toBe(khong + "machine");
    expect((await dung(sql`SELECT count(*)::int AS n FROM program_deployments WHERE "buildId" IN (${B.build}, ${A.build})`))[0].n).toBe(nDep);
  });
  it("GHI deploy — rejectDeployment / approveDeployment / rollbackDeployment (deploy B) ⇒ NOT_FOUND programDeployment, B nguyên vẹn", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.programming.rejectDeployment({ deploymentId: B.dep, reason: "x" }))).toBe(khong + "programDeployment");
    expect(await chiTiet(() => u.programming.approveDeployment({ deploymentId: B.dep, totpCode: "000000" }))).toBe(khong + "programDeployment");
    expect(await chiTiet(() => u.programming.rollbackDeployment({ deploymentId: B.dep, idempotencyKey: RUN + "-rb", actionId: RUN + "-rba", totpCode: "000000" }))).toBe(khong + "programDeployment");
    expect((await lay(sql`SELECT status FROM program_deployments WHERE id = ${B.dep}`)).status).toBe("awaiting_approval");
    expect(await chiTiet(() => u.programming.rejectDeployment({ deploymentId: A.dep, reason: "x" }))).toBeNull();
    expect((await lay(sql`SELECT status FROM program_deployments WHERE id = ${A.dep}`)).status).toBe("rejected");
  });
});

describe("★★★ ir — luồng IR của dự án nhà máy khác", () => {
  it("listFlows / getFlow / diffVersions / mergeVersions — chỉ flow của A; flow B ⇒ NOT_FOUND", async () => {
    const u: C = uA;
    const ids = (await u.ir.listFlows({ limit: 500 })).map((f: { id: number }) => f.id);
    expect(ids).toContain(A.irArt);
    expect(ids).not.toContain(B.irArt);
    expect(await chiTiet(() => u.ir.getFlow({ artifactId: B.irArt }))).toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.ir.getFlow({ artifactId: A.irArt }))).toBeNull();
    expect(await chiTiet(() => u.ir.diffVersions({ beforeArtifactId: A.irArt, afterArtifactId: B.irArt }))).toBe(khong + "programmingArtifact");
    expect(await chiTiet(() => u.ir.diffVersions({ beforeArtifactId: A.irArt, afterArtifactId: A.irArt }))).toBeNull();
    expect(await chiTiet(() => u.ir.mergeVersions({ baseArtifactId: A.irArt, oursArtifactId: A.irArt, theirsArtifactId: B.irArt }))).toBe(khong + "programmingArtifact");
    expect((await uAdmin.ir.listFlows({ limit: 500 })).map((f: { id: number }) => f.id)).toEqual(expect.arrayContaining([A.irArt, B.irArt]));
  });
  it("GHI — saveFlow (dự án B) / requestBuild (flow B) ⇒ NOT_FOUND, không ghi", async () => {
    const u: C = uA;
    const flow = JSON.parse(FLOW);
    const n = (await dung(sql`SELECT count(*)::int AS n FROM program_artifacts WHERE "projectId" = ${B.irProj}`))[0].n;
    expect(await chiTiet(() => u.ir.saveFlow({ projectId: B.irProj, flow }))).toBe(khong + "programmingProject");
    expect((await dung(sql`SELECT count(*)::int AS n FROM program_artifacts WHERE "projectId" = ${B.irProj}`))[0].n).toBe(n);
    const nb = (await dung(sql`SELECT count(*)::int AS n FROM program_builds WHERE "artifactId" = ${B.irArt}`))[0].n;
    expect(await chiTiet(() => u.ir.requestBuild({ artifactId: B.irArt }))).toBe(khong + "programmingArtifact");
    expect((await dung(sql`SELECT count(*)::int AS n FROM program_builds WHERE "artifactId" = ${B.irArt}`))[0].n).toBe(nb);
    expect(await chiTiet(() => u.ir.saveFlow({ projectId: A.irProj, flow }))).toBeNull();
  });
});

describe("★★★ inspectionProgram — gắn máy theo phạm vi; cấp SẢN PHẨM đọc chung, ghi chỉ toàn quyền", () => {
  it("list / get / getActive / compare — bản máy B ẩn; bản cấp sản phẩm thấy; máy B ⇒ rơi về bản sản phẩm", async () => {
    const u: C = uA;
    const ids = (await u.inspectionProgram.list({ productModelId: productId })).map((r: { id: number }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([A.rel, A.relPend, relProduct, relProductPend]));
    for (const x of [B.rel, B.relPend]) expect(ids).not.toContain(x);
    expect(await chiTiet(() => u.inspectionProgram.get({ id: B.rel }))).toBe(khong + "programRelease");
    expect(await chiTiet(() => u.inspectionProgram.get({ id: A.rel }))).toBeNull();
    expect(await chiTiet(() => u.inspectionProgram.get({ id: relProduct }))).toBeNull();
    const act = await u.inspectionProgram.getActive({ productModelId: productId, machineId: B.mid });
    expect(act?.id).toBe(relProduct); // máy B có bản released RIÊNG (B.relReleased) nhưng A không được thấy
    expect((await uAdmin.inspectionProgram.getActive({ productModelId: productId, machineId: B.mid }))?.id).toBe(B.relReleased);
    expect((await u.inspectionProgram.getActive({ productModelId: productId, machineId: A.mid }))?.id).toBe(A.relReleased);
    expect(await chiTiet(() => u.inspectionProgram.compare({ aId: A.rel, bId: B.rel }))).toBe(khong + "programRelease");
    expect((await uAdmin.inspectionProgram.list({ productModelId: productId })).map((r: { id: number }) => r.id)).toEqual(expect.arrayContaining([A.rel, B.rel]));
  });
  it("GHI — createDraft (máy B ⇒ NOT_FOUND machine; cấp sản phẩm ⇒ FORBIDDEN); submit/approve/reject/release bản B ⇒ NOT_FOUND, bản sản phẩm ⇒ FORBIDDEN; bản A chạy được", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.inspectionProgram.createDraft({ productModelId: productId, machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.inspectionProgram.createDraft({ productModelId: productId }))).toBe("FORBIDDEN:PERMISSION_DENIED:manageProductWideProgramRelease");
    expect(await chiTiet(() => u.inspectionProgram.submit({ releaseId: B.rel }))).toBe(khong + "programRelease");
    expect((await lay(sql`SELECT status FROM inspection_program_releases WHERE id = ${B.rel}`)).status).toBe("draft");
    expect(await chiTiet(() => u.inspectionProgram.approve({ releaseId: B.relPend }))).toBe(khong + "programRelease");
    expect(await chiTiet(() => u.inspectionProgram.reject({ releaseId: B.relPend, reason: "x" }))).toBe(khong + "programRelease");
    expect(await chiTiet(() => u.inspectionProgram.release({ releaseId: B.relPend }))).toBe(khong + "programRelease");
    expect((await lay(sql`SELECT status FROM inspection_program_releases WHERE id = ${B.relPend}`)).status).toBe("pending_approval");
    for (const f of ["approve", "reject", "release"] as const) {
      expect(await chiTiet(() => (u.inspectionProgram as any)[f]({ releaseId: relProductPend, reason: "x" })), f).toBe("FORBIDDEN:PERMISSION_DENIED:manageProductWideProgramRelease");
    }
    expect(await chiTiet(() => u.inspectionProgram.submit({ releaseId: relProductPend }))).toBe("FORBIDDEN:PERMISSION_DENIED:manageProductWideProgramRelease");
    expect((await lay(sql`SELECT status FROM inspection_program_releases WHERE id = ${relProductPend}`)).status).toBe("pending_approval");
    expect(await chiTiet(() => u.inspectionProgram.submit({ releaseId: A.rel }))).toBeNull();
    expect((await lay(sql`SELECT status FROM inspection_program_releases WHERE id = ${A.rel}`)).status).toBe("pending_approval");
    // toàn quyền vẫn làm được trên bản sản phẩm-cấp
    expect(await chiTiet(() => uAdmin.inspectionProgram.reject({ releaseId: relProductPend, reason: "đối chứng" }))).toBeNull();
  });
});

describe("★★★ sop — gắn trạm theo phạm vi; không gắn trạm = dùng chung (đọc chung, ghi toàn quyền)", () => {
  it("list / get / resolveActive — SOP trạm B ẩn; SOP dùng chung thấy; trạm B không kéo SOP của B", async () => {
    const u: C = uA;
    const ids = (await u.sop.list({ limit: 500 })).map((s: { id: number }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([A.sop, sopShared]));
    expect(ids).not.toContain(B.sop);
    expect(await u.sop.get({ id: B.sop })).toBeNull();
    expect((await u.sop.get({ id: A.sop }))?.id).toBe(A.sop);
    expect((await u.sop.get({ id: sopShared }))?.id).toBe(sopShared);
    expect((await u.sop.resolveActive({ stationId: A.sid }))?.id).toBe(A.sop);
    const rb = await u.sop.resolveActive({ stationId: B.sid });
    expect(rb?.id).not.toBe(B.sop);
    expect((await uAdmin.sop.resolveActive({ stationId: B.sid }))?.id).toBe(B.sop);
  });
  it("executions / execution — theo trạm, dây chuyền, hoặc chính người vận hành", async () => {
    const u: C = uA;
    expect((await u.sop.executions({ sopId: B.sop })).length).toBe(0); // kể cả lượt do CHÍNH người gọi tạo dưới SOP của B (exMineOnB)
    const eA = (await u.sop.executions({ sopId: A.sop })).map((e: { id: number }) => e.id);
    expect(eA).toContain(A.ex);
    expect(eA).toContain(exNoneMine);
    expect(eA).not.toContain(exNoneOther);
    expect(await u.sop.execution({ id: A.ex })).not.toBeNull();
    expect(await u.sop.execution({ id: exNoneMine })).not.toBeNull();
    expect(await u.sop.execution({ id: B.ex })).toBeNull();
    expect(await u.sop.execution({ id: exLineB })).toBeNull();
    expect(await u.sop.execution({ id: exNoneOther })).toBeNull();
    expect(await uAdmin.sop.execution({ id: exLineB })).not.toBeNull();
  });
  it("GHI định nghĩa — create (trạm B ⇒ NOT_FOUND, không trạm ⇒ FORBIDDEN); update/replaceSteps/setStatus/clone/delete SOP B ⇒ như không tồn tại; SOP dùng chung ⇒ FORBIDDEN", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.sop.create({ code: RUN + "-N1", title: "t", stationId: B.sid }))).toBe(khong + "station");
    expect(await chiTiet(() => u.sop.create({ code: RUN + "-N2", title: "t" }))).toBe("FORBIDDEN:PERMISSION_DENIED:authorSharedSop");
    expect((await dung(sql`SELECT id FROM sops WHERE code IN (${RUN + "-N1"}, ${RUN + "-N2"})`)).length).toBe(0);
    const taoA = await u.sop.create({ code: RUN + "-N3", title: "t", stationId: A.sid });
    expect(taoA.stationId).toBe(A.sid);
    expect(await u.sop.update({ id: B.sop, title: "bi-sua" })).toBeNull();
    expect((await lay(sql`SELECT title FROM sops WHERE id = ${B.sop}`)).title).toBe("SOP B");
    expect(await chiTiet(() => u.sop.update({ id: A.sop, stationId: B.sid }))).toBe(khong + "station");
    expect(await chiTiet(() => u.sop.update({ id: A.sop, stationId: null }))).toBe("FORBIDDEN:PERMISSION_DENIED:authorSharedSop");
    expect(await chiTiet(() => u.sop.replaceSteps({ sopId: B.sop, steps: [] }))).toBe(khong + "sop");
    expect((await dung(sql`SELECT id FROM sop_steps WHERE sop_id = ${B.sop}`)).length).toBe(1);
    expect(await u.sop.setStatus({ id: B.sop, status: "retired" })).toBeNull();
    expect((await lay(sql`SELECT status FROM sops WHERE id = ${B.sop}`)).status).toBe("active");
    expect(await u.sop.cloneNewVersion({ sopId: B.sop })).toBeNull();
    expect(await u.sop.delete({ id: B.sop })).toEqual({ ok: false, code: "NOT_FOUND" });
    for (const f of [
      () => u.sop.update({ id: sopShared, title: "x" }),
      () => u.sop.replaceSteps({ sopId: sopShared, steps: [] }),
      () => u.sop.setStatus({ id: sopShared, status: "active" }),
      () => u.sop.delete({ id: sopShared }),
    ]) expect(await chiTiet(f)).toBe("FORBIDDEN:PERMISSION_DENIED:authorSharedSop");
    expect((await dung(sql`SELECT id FROM sops WHERE id = ${sopShared}`)).length).toBe(1);
    expect(await u.sop.delete({ id: taoA.id })).toEqual({ ok: true });
    // toàn quyền sửa được SOP dùng chung
    expect(await chiTiet(() => uAdmin.sop.update({ id: sopShared, title: "chung-sửa" }))).toBeNull();
  });
  it("GHI thực thi — startExecution (SOP B / trạm B / dây chuyền B) ⇒ NOT_FOUND; confirmStep/finish/abandon lượt B ⇒ NOT_FOUND và không đổi; lượt A chạy được", async () => {
    const u: C = uA;
    const n = (await dung(sql`SELECT count(*)::int AS n FROM sop_executions`))[0].n;
    expect(await chiTiet(() => u.sop.startExecution({ sopId: B.sop }))).toBe(khong + "sop");
    expect(await chiTiet(() => u.sop.startExecution({ sopId: A.sop, stationId: B.sid }))).toBe(khong + "station");
    expect(await chiTiet(() => u.sop.startExecution({ sopId: A.sop, lineId: B.lid }))).toBe(khong + "line");
    expect((await dung(sql`SELECT count(*)::int AS n FROM sop_executions`))[0].n).toBe(n);
    expect(await u.sop.confirmStep({ executionId: B.ex, stepNo: 1 })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await u.sop.finishExecution({ executionId: B.ex })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await u.sop.abandonExecution({ executionId: B.ex })).toBeNull();
    expect((await lay(sql`SELECT status FROM sop_executions WHERE id = ${B.ex}`)).status).toBe("in_progress");
    expect((await u.sop.startExecution({ sopId: A.sop, stationId: A.sid })).stationId).toBe(A.sid);
    expect(await u.sop.confirmStep({ executionId: A.ex, stepNo: 1 })).toMatchObject({ ok: true });
    expect(await u.sop.abandonExecution({ executionId: A.ex })).not.toBeNull();
  });
});

describe("đối chứng DƯƠNG (admin) + phạm vi rỗng", () => {
  it("admin thấy/ghi cả B; người không gán nhà máy ⇒ rỗng / NOT_FOUND", async () => {
    const ad: C = uAdmin;
    expect(await chiTiet(() => ad.programming.getProject({ id: B.proj }))).toBeNull();
    expect(await chiTiet(() => ad.programming.getArtifact({ id: B.art }))).toBeNull();
    expect((await ad.sop.get({ id: B.sop }))?.id).toBe(B.sop);
    expect(await chiTiet(() => ad.inspectionProgram.get({ id: B.rel }))).toBeNull();
    const r: C = uRong;
    expect(await chiTiet(() => r.programming.getProject({ id: A.proj }))).toBe(khong + "programmingProject");
    expect(await r.programming.listArtifacts({ projectId: A.proj })).toEqual([]);
    expect(await r.ir.listFlows({ limit: 500 }).then((x: Array<{ id: number }>) => x.map((f) => f.id))).not.toContain(A.irArt);
    expect(await r.sop.get({ id: A.sop })).toBeNull();
    expect((await r.sop.get({ id: sopShared }))?.id).toBe(sopShared); // dùng chung: đọc được
    expect(await chiTiet(() => r.inspectionProgram.get({ id: A.rel }))).toBe(khong + "programRelease");
    expect(await chiTiet(() => r.inspectionProgram.get({ id: relProduct }))).toBeNull();
  });
});
