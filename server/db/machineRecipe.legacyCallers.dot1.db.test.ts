/**
 * doc 81 Đợt 1C Task 2 — quyết định chủ dự án 2026-09-27 ("CÓ"): áp cổng recipe CHẶT cho ba caller
 * mà Đợt 1 Task 9 (ruling R-T9a) còn để ở `"legacyApprovedOnly"`:
 *   • recipeSetService.distributeRecipeSet (phân phối recipe set),
 *   • recipeVersioningService.recordLoad(deploy:true) (equipmentIntegration.recordRecipeLoad),
 *   • machineRecipe changeover.approve.
 * Cả ba nay đi `deployRecipe(…, "strict")` = cổng phát hành chung `assertRecipeReleasable` dưới khoá
 * mã: phải đã duyệt · không archived (đây là thăng hạng TIẾN, không phải rollback) · đúng loại máy
 * nếu biết.
 *
 * Tên tệp giữ nguyên (lịch sử Đợt 1). Đổi kỳ vọng so với bản Đợt 1 (ghim hành vi CŨ):
 *   1. recipe set ghim v1 đã bị THAY: trước ⇒ 'deployed' + v1 active lại; NAY ⇒ mục 'failed',
 *      reason `recipeArchived`, hint `updateSetToCurrentVersion`, currentVersion = 2; v1 vẫn archived,
 *      v2 vẫn active, set KHÔNG khoá, tuyến KHÔNG nhận ref.
 *   2. recordLoad(deploy:true) bản archived / recipe AOI lên máy SPI: trước ⇒ nạp được; NAY ⇒
 *      PRECONDITION_FAILED (recipeArchived / recipeMachineTypeMismatch), 0 deployment, 0 sự kiện load.
 *      Bản chưa duyệt: trước ⇒ `Error` thường mang câu Việt cũ; NAY ⇒ PRECONDITION_FAILED
 *      recipeNotApproved.
 *   3. changeover.approve bản archived: trước ⇒ duyệt + deploy; NAY ⇒ PRECONDITION_FAILED, reason
 *      recipeArchived, operation approveChangeoverRequest, yêu cầu vẫn 'pending'. Bản chưa duyệt:
 *      trước ⇒ BAD_REQUEST câu cũ; NAY ⇒ PRECONDITION_FAILED recipeNotApproved.
 * Mỗi caller cũng có ca HỢP LỆ (đã duyệt, đúng loại máy, không archived) ⇒ vẫn chạy (không chặn oan).
 *
 * CSDL THẬT (`_test`), deploy/ledger thật. lineStateRepo mock trong bộ nhớ (chỉ bảng set/tuyến).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

// ── lineStateRepo trong bộ nhớ (chỉ bảng recipe set / tuyến — ngoài phạm vi phép đo) ──────────
const h = vi.hoisted(() => ({
  sets: new Map<number, any>(),
  items: new Map<number, any[]>(),
  lineId: 0,
  lineRef: null as string | null,
  sql: null as any,
}));
vi.mock("../services/lineController/lineStateRepo", () => ({
  isDbAvailable: vi.fn(async () => true),
  getRecipeSetById: vi.fn(async (id: number) => h.sets.get(id) ?? null),
  getLineRow: vi.fn(async (id: number) => (id === h.lineId ? { id, code: `L${id}`, name: "line" } : null)),
  ensureLineState: vi.fn(async (id: number) => ({ lineId: id, state: "idle", recipeSetRef: null, activeOrderId: null, taktTargetS: null })),
  updateLineContext: vi.fn(async (lineId: number, patch: any) => {
    h.lineRef = patch.recipeSetRef ?? h.lineRef;
    return { lineId, state: "idle", ...patch };
  }),
  lockRecipeSet: vi.fn(async (id: number, lockedBy: string) => {
    const s = h.sets.get(id);
    Object.assign(s, { locked: true, lockedBy, status: "active" });
    return { ...s };
  }),
  // item → đọc recipe THẬT từ catalog (mã/phiên bản/trạng thái)
  listRecipeSetItems: vi.fn(async (setId: number) => {
    const out: any[] = [];
    for (const it of h.items.get(setId) ?? []) {
      const [r] = await h.sql`SELECT code, version, status FROM machine_recipes WHERE id = ${it.machineRecipeId}`;
      out.push({ id: it.id, recipeSetId: setId, stationId: null, machineId: it.machineId, required: true, machineRecipeId: it.machineRecipeId,
        recipeCode: r.code, recipeVersion: r.version, recipeStatus: r.status, machineCode: `M${it.machineId}`, machineName: "m" });
    }
    return out;
  }),
}));

const DB_URL = process.env.DATABASE_URL;
const RUN = `t2c${Date.now().toString(36)}`;
const U_AUTHOR = 990_921_001;
const U_APPROVER = 990_921_002;
const U_DEPLOYER = 990_921_003;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, mAoi: 0, mSpi: 0 };
let seq = 0;
let setSeq = 0;
const newCode = () => `${RUN}-${++seq}`;

type Router = typeof import("../routers/machineRecipeRouter").machineRecipeRouter;
let caller: ReturnType<Router["createCaller"]>;

async function mkRecipe(code: string, version: number, o: { status?: string; approved?: boolean; machineType?: string | null } = {}) {
  const r = await sql`
    INSERT INTO machine_recipes (code, name, version, payload, checksum, status, "createdBy", "approvedBy", "approvedAt", "machineType")
    VALUES (${code}, ${"T2C " + code}, ${version}, ${sql.json({ v: version })}, ${"cs" + version}, ${o.status ?? "draft"},
            ${U_AUTHOR}, ${o.approved ? U_APPROVER : null}, ${o.approved ? new Date() : null}, ${o.machineType ?? null})
    RETURNING id`;
  return Number((r[0] as { id: number }).id);
}
async function statusOf(id: number) {
  const r = await sql`SELECT status FROM machine_recipes WHERE id = ${id}`;
  return (r[0] as { status: string }).status;
}
async function deploymentsOf(recipeId: number) {
  const r = await sql`SELECT count(*)::int AS n FROM recipe_deployments WHERE "recipeId" = ${recipeId}`;
  return (r[0] as { n: number }).n;
}
async function loadEventsOf(recipeId: number) {
  const r = await sql`SELECT count(*)::int AS n FROM recipe_load_log WHERE "recipeId" = ${recipeId} AND action = 'load'`;
  return (r[0] as { n: number }).n;
}
function mkSet(code: string, items: Array<{ machineId: number; machineRecipeId: number }>) {
  const id = ++setSeq;
  h.sets.set(id, { id, code: `${code}-SET${id}`, version: 1, locked: false, status: "draft" });
  h.items.set(id, items.map((it, i) => ({ id: id * 100 + i, ...it })));
  return id;
}
async function newChangeover(machineId: number, recipeId: number) {
  const [req] = await sql`INSERT INTO changeover_requests ("machineId", "recipeId", "requestedBy") VALUES (${machineId}, ${recipeId}, ${U_AUTHOR}) RETURNING id`;
  return Number((req as { id: number }).id);
}
async function changeoverStatus(id: number) {
  const r = await sql`SELECT status FROM changeover_requests WHERE id = ${id}`;
  return (r[0] as { status: string }).status;
}

describe.skipIf(!DB_URL)("Đợt 1C Task 2 — cổng recipe CHẶT cho recipe set / recordLoad / changeover.approve (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    h.sql = sql;
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T2C factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T2C ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T2C line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T2C station') RETURNING id`);
    ids.mAoi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MA-" + RUN}, 'T2C AOI', 'AOI', true) RETURNING id`);
    ids.mSpi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MS-" + RUN}, 'T2C SPI', 'SPI', true) RETURNING id`);
    h.lineId = ids.line;
    process.env.EQ_INTEG_ENABLED = "true";
    const { machineRecipeRouter } = await import("../routers/machineRecipeRouter");
    caller = machineRecipeRouter.createCaller({
      user: { id: U_DEPLOYER, role: "admin", name: "t2c-deployer", twoFactorEnabled: true },
    } as never);
  });

  afterAll(async () => {
    if (!sql) return;
    const like = `${RUN}-%`;
    await sql`DELETE FROM changeover_requests WHERE "machineId" IN (${ids.mAoi}, ${ids.mSpi})`;
    await sql`DELETE FROM recipe_load_log WHERE "recipeCode" LIKE ${like}`.catch(() => undefined);
    await sql`DELETE FROM recipe_deployments WHERE "machineId" IN (${ids.mAoi}, ${ids.mSpi})`;
    await sql`DELETE FROM machine_recipes WHERE code LIKE ${like}`;
    await sql`DELETE FROM machines WHERE id IN (${ids.mAoi}, ${ids.mSpi})`;
    await sql`DELETE FROM stations WHERE id = ${ids.station}`;
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql.end({ timeout: 5 });
  });

  // ── recipe set ─────────────────────────────────────────────────────────────────────────────
  it("★★★ recipe set ghim v1 đã bị THAY (archived) ⇒ mục bị TỪ CHỐI: reason recipeArchived + gợi ý cập nhật sang v2; v1 KHÔNG active lại, set KHÔNG khoá", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: true });
    const v2 = await mkRecipe(code, 2, { approved: true });
    await caller.recipes.deploy({ recipeId: v1, machineId: ids.mAoi });
    await caller.recipes.deploy({ recipeId: v2, machineId: ids.mAoi }); // v1 → archived (bị thay)
    expect(await statusOf(v1)).toBe("archived");
    const setId = mkSet(code, [{ machineId: ids.mAoi, machineRecipeId: v1 }]);
    const depBefore = await deploymentsOf(v1);
    h.lineRef = null;

    const { distributeRecipeSet } = await import("../services/lineController/recipeSetService");
    const res = (await distributeRecipeSet(ids.line, setId, { actorId: U_DEPLOYER, actor: "t2c" })) as any;
    expect(res.ok).toBe(true);
    const item = res.results[0];
    expect(item.status, JSON.stringify(item)).toBe("failed");
    expect(item.reason).toBe("recipeArchived");
    expect(item.hint).toBe("updateSetToCurrentVersion");
    expect(item.currentVersion).toBe(2);
    expect(typeof item.error).toBe("string");
    expect(item.error.length).toBeGreaterThan(0);
    expect(res.confirmed).toBe(false);
    expect(res.locked).toBe(false);
    expect(h.sets.get(setId).locked).toBe(false);
    expect(h.lineRef).toBeNull();
    expect(await statusOf(v1)).toBe("archived");
    expect(await statusOf(v2)).toBe("active");
    expect(await deploymentsOf(v1)).toBe(depBefore);
  });

  it("★★★ recipe set: mục sai loại máy (AOI lên SPI) bị từ chối recipeMachineTypeMismatch (không gợi ý đổi phiên bản); mục HỢP LỆ cùng set vẫn nạp", async () => {
    const okCode = newCode();
    const good = await mkRecipe(okCode, 1, { approved: true, machineType: "AOI" });
    const badCode = newCode();
    const wrongType = await mkRecipe(badCode, 1, { approved: true, machineType: "AOI" });
    const setId = mkSet(okCode, [
      { machineId: ids.mAoi, machineRecipeId: good },
      { machineId: ids.mSpi, machineRecipeId: wrongType },
    ]);
    const { distributeRecipeSet } = await import("../services/lineController/recipeSetService");
    const res = (await distributeRecipeSet(ids.line, setId, { actorId: U_DEPLOYER, actor: "t2c" })) as any;
    const byMachine = new Map<number, any>(res.results.map((r: any) => [r.machineId, r]));
    expect(byMachine.get(ids.mAoi).status, JSON.stringify(byMachine.get(ids.mAoi))).toBe("deployed");
    expect(await statusOf(good)).toBe("active");
    const bad = byMachine.get(ids.mSpi);
    expect(bad.status).toBe("failed");
    expect(bad.reason).toBe("recipeMachineTypeMismatch");
    expect(bad.hint).toBeUndefined();
    expect(await statusOf(wrongType)).toBe("draft");
    expect(res.confirmed).toBe(false);
  });

  it("★★ recipe set HỢP LỆ (đã duyệt, đúng loại máy, draft) ⇒ nạp + xác nhận + khoá như trước (không chặn oan)", async () => {
    const code = newCode();
    const v = await mkRecipe(code, 1, { approved: true, machineType: "SPI" });
    const setId = mkSet(code, [{ machineId: ids.mSpi, machineRecipeId: v }]);
    const { distributeRecipeSet } = await import("../services/lineController/recipeSetService");
    const res = (await distributeRecipeSet(ids.line, setId, { actorId: U_DEPLOYER, actor: "t2c" })) as any;
    expect(res.results[0].status, JSON.stringify(res.results[0])).toBe("deployed");
    expect(res.results[0].reason).toBeUndefined();
    expect(res.confirmed).toBe(true);
    expect(res.locked).toBe(true);
    expect(await statusOf(v)).toBe("active");
  });

  // ── recordLoad(deploy:true) ────────────────────────────────────────────────────────────────
  it("★★★ recordLoad(deploy:true): bản đã RÚT (archived) ⇒ PRECONDITION_FAILED recipeArchived; AOI lên SPI ⇒ recipeMachineTypeMismatch; chưa duyệt ⇒ recipeNotApproved — 0 deployment, 0 sự kiện load", async () => {
    const { recordLoad } = await import("../services/equipment/recipeVersioningService");
    const cases: Array<{ id: number; machineId: number; reason: string }> = [
      { id: await mkRecipe(newCode(), 1, { status: "archived", approved: true }), machineId: ids.mAoi, reason: "recipeArchived" },
      { id: await mkRecipe(newCode(), 1, { approved: true, machineType: "AOI" }), machineId: ids.mSpi, reason: "recipeMachineTypeMismatch" },
      { id: await mkRecipe(newCode(), 1, { approved: false }), machineId: ids.mAoi, reason: "recipeNotApproved" },
    ];
    for (const c of cases) {
      const err = await recordLoad({ recipeId: c.id, machineId: c.machineId, performedBy: U_DEPLOYER, deploy: true }).catch((e) => e);
      expect((err as { code?: string }).code, `${c.reason}: ${String(err)}`).toBe("PRECONDITION_FAILED");
      expect((err as any).cause?.appParams?.reason).toBe(c.reason);
      expect(await deploymentsOf(c.id)).toBe(0);
      expect(await loadEventsOf(c.id)).toBe(0);
    }
  });

  it("★★ recordLoad(deploy:true) HỢP LỆ ⇒ deployment + sự kiện load; recordLoad(deploy:false) bản archived vẫn ghi phả hệ như cũ (không phải đường deploy)", async () => {
    const { recordLoad } = await import("../services/equipment/recipeVersioningService");
    const ok = await mkRecipe(newCode(), 1, { approved: true, machineType: "AOI" });
    const a = await recordLoad({ recipeId: ok, machineId: ids.mAoi, performedBy: U_DEPLOYER, deploy: true });
    expect(a.deploymentId).not.toBeNull();
    expect(await statusOf(ok)).toBe("active");
    const archived = await mkRecipe(newCode(), 1, { status: "archived", approved: true });
    const b = await recordLoad({ recipeId: archived, machineId: ids.mAoi, performedBy: U_DEPLOYER, deploy: false });
    expect(b.deploymentId).toBeNull();
    expect(await loadEventsOf(archived)).toBe(1);
  });

  // ── changeover.approve ─────────────────────────────────────────────────────────────────────
  it("★★★ changeover.approve: bản đã RÚT / sai loại máy / chưa duyệt ⇒ PRECONDITION_FAILED mang reason (operation approveChangeoverRequest), yêu cầu vẫn pending, 0 deployment", async () => {
    const cases: Array<{ id: number; machineId: number; reason: string }> = [
      { id: await mkRecipe(newCode(), 1, { status: "archived", approved: true, machineType: "AOI" }), machineId: ids.mAoi, reason: "recipeArchived" },
      { id: await mkRecipe(newCode(), 1, { approved: true, machineType: "AOI" }), machineId: ids.mSpi, reason: "recipeMachineTypeMismatch" },
      { id: await mkRecipe(newCode(), 1, { approved: false }), machineId: ids.mAoi, reason: "recipeNotApproved" },
    ];
    for (const c of cases) {
      const reqId = await newChangeover(c.machineId, c.id);
      const err = await caller.changeover.approve({ id: reqId }).catch((e) => e);
      expect((err as { code?: string }).code, `${c.reason}: ${String(err)}`).toBe("PRECONDITION_FAILED");
      expect((err as any).cause?.appCode).toBe("OPERATION_FAILED");
      expect((err as any).cause?.appParams).toMatchObject({ operation: "approveChangeoverRequest", reason: c.reason });
      expect(await changeoverStatus(reqId)).toBe("pending");
      expect(await deploymentsOf(c.id)).toBe(0);
    }
  });

  it("★★ changeover.approve HỢP LỆ ⇒ approved + deployment (không chặn oan)", async () => {
    const v = await mkRecipe(newCode(), 1, { approved: true, machineType: "SPI" });
    const reqId = await newChangeover(ids.mSpi, v);
    const ok = await caller.changeover.approve({ id: reqId });
    expect(ok.request.status).toBe("approved");
    expect(ok.deployment.recipeId).toBe(v);
    expect(await statusOf(v)).toBe("active");
  });
});
