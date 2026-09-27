/**
 * doc 80 Đợt 1 Task 9 (§12 "Còn mở" — T3 "hai cổng duyệt recipe trùng") — MỘT cổng phát hành
 * recipe (`assertRecipeReleasable`) cho CẢ `/recipes` (deploy/rollback) và equipmentIntegration
 * (release/rollback), trên CSDL THẬT (`_test`).
 *
 * Trước vá (đo ở lần chạy RED):
 *   • `/recipes` rollback về bản CHƯA duyệt: KHÔNG kiểm (deployRecipe kiểm, rollbackRecipe gọi
 *     thẳng deployWithinTx) ⇒ bản chưa duyệt thành active.
 *   • deploy/release bản ĐÃ LƯU TRỮ được (RCP-05); deploy recipe AOI lên máy SPI được.
 *   • phép kiểm `approvedBy` đọc hàng TRƯỚC khi khoá mã ⇒ lưu trữ chen giữa lúc deploy xếp hàng
 *     sau khoá vẫn thành active.
 * Sau vá: một hàm, chạy trên hàng đọc DƯỚI `FOR UPDATE` của mã, PRECONDITION_FAILED +
 * OPERATION_FAILED(reason recipeNotApproved | recipeArchived | recipeMachineTypeMismatch).
 * Rollback về bản CŨ (đã bị thay ⇒ status 'archived') vẫn hợp lệ — xem docblock của cổng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `t9rcp${Date.now().toString(36)}`;
const U_AUTHOR = 990_910_001;
const U_APPROVER = 990_910_002;
const U_DEPLOYER = 990_910_003;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, mAoi: 0, mSpi: 0 };
let seq = 0;

type Router = typeof import("../routers/machineRecipeRouter").machineRecipeRouter;
let caller: ReturnType<Router["createCaller"]>;
let svc: typeof import("../services/equipment/recipeVersioningService");

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}
function reasonOf(e: unknown): unknown {
  return (e as { cause?: { appParams?: Record<string, unknown> } } | null)?.cause?.appParams?.reason;
}

async function mkRecipe(code: string, version: number, o: { status?: string; approved?: boolean; machineType?: string | null; machineId?: number | null } = {}) {
  const r = await sql`
    INSERT INTO machine_recipes (code, name, version, payload, checksum, status, "createdBy", "approvedBy", "approvedAt", "machineType", "machineId")
    VALUES (${code}, ${"T9 " + code}, ${version}, ${sql.json({ v: version })}, ${"cs" + version}, ${o.status ?? "draft"},
            ${U_AUTHOR}, ${o.approved ? U_APPROVER : null}, ${o.approved ? new Date() : null}, ${o.machineType ?? null}, ${o.machineId ?? null})
    RETURNING id`;
  return Number((r[0] as { id: number }).id);
}
const newCode = () => `${RUN}-${++seq}`;
async function statusOf(id: number) {
  const r = await sql`SELECT status FROM machine_recipes WHERE id = ${id}`;
  return (r[0] as { status: string }).status;
}
async function deploymentCount(machineId: number) {
  const r = await sql`SELECT count(*)::int AS n FROM recipe_deployments WHERE "machineId" = ${machineId}`;
  return (r[0] as { n: number }).n;
}

describe.skipIf(!DB_URL)("Task 9 — MỘT cổng phát hành recipe cho /recipes và equipmentIntegration (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T9 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T9 ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T9 line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T9 station') RETURNING id`);
    ids.mAoi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MA-" + RUN}, 'T9 AOI', 'AOI', true) RETURNING id`);
    ids.mSpi = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"MS-" + RUN}, 'T9 SPI', 'SPI', true) RETURNING id`);

    process.env.EQ_INTEG_ENABLED = "true";
    const { machineRecipeRouter } = await import("../routers/machineRecipeRouter");
    caller = machineRecipeRouter.createCaller({
      user: { id: U_DEPLOYER, role: "admin", name: "t9-deployer", twoFactorEnabled: true },
    } as never);
    svc = await import("../services/equipment/recipeVersioningService");
  }, 90_000);

  afterAll(async () => {
    if (!sql) return;
    const like = `${RUN}-%`;
    await sql`DELETE FROM recipe_load_log WHERE "recipeCode" LIKE ${like}`.catch(() => undefined);
    await sql`DELETE FROM recipe_deployments WHERE "machineId" IN (${ids.mAoi}, ${ids.mSpi})`;
    await sql`DELETE FROM machine_recipes WHERE code LIKE ${like}`;
    await sql`DELETE FROM machines WHERE id IN (${ids.mAoi}, ${ids.mSpi})`;
    await sql`DELETE FROM stations WHERE id = ${ids.station}`;
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql.end({ timeout: 5 });
  }, 90_000);

  // ── /recipes ────────────────────────────────────────────────────────────────
  it("★★★ /recipes rollback tới bản CHƯA duyệt ⇒ PRECONDITION_FAILED (recipeNotApproved), catalog + sổ triển khai KHÔNG đổi", async () => {
    const code = newCode();
    // v1: đang chạy trên máy nhưng CHƯA qua second-approver (đúng hình RCP-06 trên dữ liệu thật).
    const v1 = await mkRecipe(code, 1, { status: "active", approved: false });
    await sql`INSERT INTO recipe_deployments ("recipeId", "machineId", "deployedBy", status, "deployedAt") VALUES (${v1}, ${ids.mAoi}, ${U_DEPLOYER}, 'deployed', now() - interval '1 hour')`;
    const v2 = await mkRecipe(code, 2, { approved: true });
    const dep = await caller.recipes.deploy({ recipeId: v2, machineId: ids.mAoi });
    expect(dep.previousRecipeId).toBe(v1);
    const before = await deploymentCount(ids.mAoi);

    const err = await caller.recipes.rollback({ machineId: ids.mAoi }).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeNotApproved");
    expect(await statusOf(v2)).toBe("active");
    expect(await statusOf(v1)).toBe("archived");
    expect(await deploymentCount(ids.mAoi)).toBe(before);
  });

  it("/recipes rollback tới bản CŨ đã duyệt (đã bị thay ⇒ 'archived') vẫn đi được", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: true });
    const v2 = await mkRecipe(code, 2, { approved: true });
    await caller.recipes.deploy({ recipeId: v1, machineId: ids.mSpi });
    await caller.recipes.deploy({ recipeId: v2, machineId: ids.mSpi });
    expect(await statusOf(v1)).toBe("archived");
    const back = await caller.recipes.rollback({ machineId: ids.mSpi });
    expect(back.recipeId).toBe(v1);
    expect(await statusOf(v1)).toBe("active");
    expect(await statusOf(v2)).toBe("archived");
  });

  it("★★★ /recipes deploy bản ĐÃ LƯU TRỮ (đã duyệt) ⇒ PRECONDITION_FAILED (recipeArchived)", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { status: "archived", approved: true });
    const err = await caller.recipes.deploy({ recipeId: v1, machineId: ids.mAoi }).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeArchived");
    expect(await statusOf(v1)).toBe("archived");
  });

  it("/recipes deploy bản CHƯA duyệt ⇒ PRECONDITION_FAILED (recipeNotApproved) — cùng cổng", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: false });
    const err = await caller.recipes.deploy({ recipeId: v1, machineId: ids.mAoi }).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeNotApproved");
    expect(await statusOf(v1)).toBe("draft");
  });

  it("★★★ /recipes deploy recipe AOI lên máy SPI ⇒ PRECONDITION_FAILED (recipeMachineTypeMismatch); recipe KHÔNG khai loại ⇒ không kiểm được ⇒ đi", async () => {
    const code = newCode();
    const aoi = await mkRecipe(code, 1, { approved: true, machineType: "AOI" });
    const err = await caller.recipes.deploy({ recipeId: aoi, machineId: ids.mSpi }).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeMachineTypeMismatch");
    expect(await statusOf(aoi)).toBe("draft");
    // đúng loại ⇒ đi
    const ok = await caller.recipes.deploy({ recipeId: aoi, machineId: ids.mAoi });
    expect(ok.recipeId).toBe(aoi);
    // không khai loại ⇒ "nếu biết" không thoả ⇒ không chặn
    const untyped = await mkRecipe(newCode(), 1, { approved: true, machineType: null });
    expect((await caller.recipes.deploy({ recipeId: untyped, machineId: ids.mSpi })).recipeId).toBe(untyped);
  });

  it("★★★ race CƯỠNG BỨC: giao dịch ngoài giữ khoá hàng recipe và LƯU TRỮ nó trong lúc deploy xếp hàng sau khoá mã ⇒ cổng đọc DƯỚI khoá ⇒ PRECONDITION_FAILED, không thành active", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: true });
    const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      const holder = ext.begin(async (tx) => {
        await tx`SELECT id FROM machine_recipes WHERE id = ${v1} FOR UPDATE`;
        await tx`UPDATE machine_recipes SET status = 'archived', "updatedAt" = now() WHERE id = ${v1}`;
        locked();
        await gate;
      });
      await lockedP;
      const p = caller.recipes.deploy({ recipeId: v1, machineId: ids.mAoi }).catch((e) => e);
      await new Promise((r) => setTimeout(r, 400)); // deploy đã đọc (MVCC: còn draft) và đang chờ khoá mã
      release();
      await holder;
      const res = await p;
      expect(codeOf(res), `deploy lọt: ${JSON.stringify(res)}`).toBe("PRECONDITION_FAILED");
      expect(await statusOf(v1)).toBe("archived");
    } finally {
      await ext.end();
    }
  });

  // ── equipmentIntegration (recipeVersioningService) ───────────────────────────
  it("★★★ equipmentIntegration release bản ĐÃ LƯU TRỮ ⇒ PRECONDITION_FAILED (recipeArchived) — cùng cổng với /recipes", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { status: "archived", approved: true });
    const err = await svc.releaseVersion(v1, U_DEPLOYER).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeArchived");
    expect(await statusOf(v1)).toBe("archived");
  });

  it("equipmentIntegration release bản chưa duyệt ⇒ PRECONDITION_FAILED (recipeNotApproved); rollback về bản cũ ĐÃ duyệt vẫn đi", async () => {
    const code = newCode();
    const draft = await mkRecipe(code, 1, { approved: false });
    const err = await svc.releaseVersion(draft, U_DEPLOYER).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeNotApproved");

    const v2 = await mkRecipe(code, 2, { approved: true });
    const v3 = await mkRecipe(code, 3, { approved: true });
    await svc.releaseVersion(v2, U_DEPLOYER);
    await svc.releaseVersion(v3, U_DEPLOYER);
    expect(await statusOf(v2)).toBe("archived");
    const back = await svc.rollbackToVersion(v2, U_DEPLOYER);
    expect(back.recipe.id).toBe(v2);
    expect(await statusOf(v2)).toBe("active");
  });

  it("equipmentIntegration release recipe AOI gắn máy SPI ⇒ PRECONDITION_FAILED (recipeMachineTypeMismatch)", async () => {
    const code = newCode();
    const v1 = await mkRecipe(code, 1, { approved: true, machineType: "AOI", machineId: ids.mSpi });
    const err = await svc.releaseVersion(v1, U_DEPLOYER).catch((e) => e);
    expect(codeOf(err)).toBe("PRECONDITION_FAILED");
    expect(reasonOf(err)).toBe("recipeMachineTypeMismatch");
  });
});
