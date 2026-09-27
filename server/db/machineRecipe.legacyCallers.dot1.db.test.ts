/**
 * doc 80 Đợt 1 Task 9 fix round 1 — ruling R-T9a (ràng buộc chung 6: hành vi NGOÀI task giữ
 * byte-identical). Cổng phát hành chung (strict) chỉ dành cho `/recipes` deploy/rollback và
 * equipmentIntegration release/rollback. Ba caller ngoài task đi qua `deployRecipe(…,
 * "legacyApprovedOnly")` = ĐÚNG những gì deployRecipe đòi ở 4fb1ec1e7: chỉ `approvedBy`, lỗi là
 * `Error` thường với câu tiếng Việt cũ; bản ĐÃ LƯU TRỮ và recipe khác loại máy VẪN đi như trước.
 *
 * Mỗi caller một ca trên CSDL THẬT (`_test`), deploy/ledger thật:
 *   • recipeSetService.distributeRecipeSet — set ghim v1; v1 sau đó bị THAY (archived) bằng một
 *     deploy /recipes ⇒ phân phối set VẪN nạp lại v1 ('deployed', không 'failed').
 *     (lineStateRepo mock trong bộ nhớ — chỉ bảng set/tuyến; deploy + catalog là thật.)
 *   • recipeVersioningService.recordLoad(deploy:true) — bản archived + recipe AOI lên máy SPI vẫn
 *     nạp; bản chưa duyệt ⇒ đúng câu lỗi cũ.
 *   • changeover.approve — bản archived được duyệt đổi model; bản chưa duyệt ⇒ BAD_REQUEST mang
 *     đúng câu lỗi cũ.
 * Lần chạy RED (trên FIX_BASE 514c86de9, cổng strict áp cho mọi caller) ghi ở báo cáo Task 9.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const PRE_TASK_MSG = "Recipe chưa được trình duyệt (second-approver) — cần một người khác duyệt trước khi deploy.";

// ── lineStateRepo trong bộ nhớ (chỉ bảng recipe set / tuyến — ngoài phạm vi phép đo) ──────────
const h = vi.hoisted(() => ({
  sets: new Map<number, any>(),
  items: new Map<number, any[]>(),
  lineId: 0,
  sql: null as any,
}));
vi.mock("../services/lineController/lineStateRepo", () => ({
  isDbAvailable: vi.fn(async () => true),
  getRecipeSetById: vi.fn(async (id: number) => h.sets.get(id) ?? null),
  getLineRow: vi.fn(async (id: number) => (id === h.lineId ? { id, code: `L${id}`, name: "line" } : null)),
  ensureLineState: vi.fn(async (id: number) => ({ lineId: id, state: "idle", recipeSetRef: null, activeOrderId: null, taktTargetS: null })),
  updateLineContext: vi.fn(async (lineId: number, patch: any) => ({ lineId, state: "idle", ...patch })),
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
const RUN = `t9leg${Date.now().toString(36)}`;
const U_AUTHOR = 990_920_001;
const U_APPROVER = 990_920_002;
const U_DEPLOYER = 990_920_003;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, mAoi: 0, mSpi: 0 };
let seq = 0;
const newCode = () => `${RUN}-${++seq}`;

type Router = typeof import("../routers/machineRecipeRouter").machineRecipeRouter;
let caller: ReturnType<Router["createCaller"]>;

async function mkRecipe(code: string, version: number, o: { status?: string; approved?: boolean; machineType?: string | null } = {}) {
  const r = await sql`
    INSERT INTO machine_recipes (code, name, version, payload, checksum, status, "createdBy", "approvedBy", "approvedAt", "machineType")
    VALUES (${code}, ${"T9L " + code}, ${version}, ${sql.json({ v: version })}, ${"cs" + version}, ${o.status ?? "draft"},
            ${U_AUTHOR}, ${o.approved ? U_APPROVER : null}, ${o.approved ? new Date() : null}, ${o.machineType ?? null})
    RETURNING id`;
  return Number((r[0] as { id: number }).id);
}
async function statusOf(id: number) {
  const r = await sql`SELECT status FROM machine_recipes WHERE id = ${id}`;
  return (r[0] as { status: string }).status;
}

describe.skipIf(!DB_URL)("R-T9a — caller NGOÀI Task 9 giữ đúng cổng deploy trước task (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    h.sql = sql;
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T9L factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T9L ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T9L line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T9L station') RETURNING id`);
    ids.mAoi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MA-" + RUN}, 'T9L AOI', 'AOI', true) RETURNING id`);
    ids.mSpi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MS-" + RUN}, 'T9L SPI', 'SPI', true) RETURNING id`);
    h.lineId = ids.line;
    process.env.EQ_INTEG_ENABLED = "true";
    const { machineRecipeRouter } = await import("../routers/machineRecipeRouter");
    caller = machineRecipeRouter.createCaller({
      user: { id: U_DEPLOYER, role: "admin", name: "t9l-deployer", twoFactorEnabled: true },
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

  it("★★★ recipe set ghim v1; v1 sau đó bị THAY (archived) ⇒ phân phối set VẪN nạp lại v1 như trước task", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: true });
    const v2 = await mkRecipe(code, 2, { approved: true });
    h.sets.set(1, { id: 1, code: `${code}-SET`, version: 1, locked: false, status: "draft" });
    h.items.set(1, [{ id: 11, machineId: ids.mAoi, machineRecipeId: v1 }]);
    await caller.recipes.deploy({ recipeId: v1, machineId: ids.mAoi });
    await caller.recipes.deploy({ recipeId: v2, machineId: ids.mAoi }); // v1 → archived
    expect(await statusOf(v1)).toBe("archived");

    const { distributeRecipeSet } = await import("../services/lineController/recipeSetService");
    const res = (await distributeRecipeSet(ids.line, 1, { actorId: U_DEPLOYER, actor: "t9" })) as any;
    expect(res.ok).toBe(true);
    expect(res.results[0].status, JSON.stringify(res.results[0])).toBe("deployed");
    expect(await statusOf(v1)).toBe("active");
  });

  it("★★★ recordLoad(deploy:true): bản archived + recipe AOI lên máy SPI VẪN nạp; bản chưa duyệt ⇒ đúng câu lỗi CŨ", async () => {
    const { recordLoad } = await import("../services/equipment/recipeVersioningService");
    const archived = await mkRecipe(newCode(), 1, { status: "archived", approved: true });
    const a = await recordLoad({ recipeId: archived, machineId: ids.mAoi, performedBy: U_DEPLOYER, deploy: true });
    expect(a.deploymentId).not.toBeNull();
    const aoi = await mkRecipe(newCode(), 1, { approved: true, machineType: "AOI" });
    const b = await recordLoad({ recipeId: aoi, machineId: ids.mSpi, performedBy: U_DEPLOYER, deploy: true });
    expect(b.deploymentId).not.toBeNull();
    const draft = await mkRecipe(newCode(), 1, { approved: false });
    const err = await recordLoad({ recipeId: draft, machineId: ids.mAoi, performedBy: U_DEPLOYER, deploy: true }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBeUndefined(); // Error thường, không phải TRPCError
    expect((err as Error).message).toBe(PRE_TASK_MSG);
  });

  it("★★★ changeover.approve: bản archived được duyệt đổi model như trước; bản chưa duyệt ⇒ BAD_REQUEST mang đúng câu CŨ", async () => {
    const archived = await mkRecipe(newCode(), 1, { status: "archived", approved: true, machineType: "AOI" });
    const [req] = await sql`INSERT INTO changeover_requests ("machineId", "recipeId", "requestedBy") VALUES (${ids.mSpi}, ${archived}, ${U_AUTHOR}) RETURNING id`;
    const ok = await caller.changeover.approve({ id: Number((req as { id: number }).id) });
    expect(ok.request.status).toBe("approved");
    expect(ok.deployment.recipeId).toBe(archived);

    const draft = await mkRecipe(newCode(), 1, { approved: false });
    const [req2] = await sql`INSERT INTO changeover_requests ("machineId", "recipeId", "requestedBy") VALUES (${ids.mAoi}, ${draft}, ${U_AUTHOR}) RETURNING id`;
    const err = await caller.changeover.approve({ id: Number((req2 as { id: number }).id) }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("BAD_REQUEST");
    expect((err as Error).message).toBe(PRE_TASK_MSG);
  });
});
