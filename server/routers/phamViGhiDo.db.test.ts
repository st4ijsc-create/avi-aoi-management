/**
 * ★★★ ĐO ĐỎ THẬT phạm vi GHI (kiểm định 2026-10-24) — thủ tục tRPC MUTATION nhận khoá định danh thực thể từ client
 * mà KHÔNG qua bộ phân giải phạm vi (xem `phamViGhiScan.ts` / `phamViGhiBaseline.ts`).
 *
 * Kịch bản: hai nhà máy A/B (mỗi nơi một máy), người dùng kỹ sư CHỈ được gán nhà máy A, có quyền module đủ
 * (machine_control / machine_monitoring) — gọi mutation lên thực thể của nhà máy B.
 *   • "đối chứng": ghi lên thực thể nhà máy A ⇒ phải được (chứng minh test không đỏ vì quyền/đầu vào sai).
 *   • "xuyên nhà máy": ghi lên thực thể nhà máy B ⇒ ĐÚNG phải bị từ chối + hàng B không đổi.
 *
 * `it.fails` giữ lưới XANH trong khi lỗ còn tồn tại; khi luong-ui vá xong test xuyên nhà máy sẽ "đạt" ⇒ `it.fails` ĐỎ
 * ⇒ buộc gỡ `fails` (và gỡ mục khỏi sổ nợ `phamViGhiBaseline`). Chạy `PHAMVI_GHI_DO=1` để thấy ĐỎ nguyên văn.
 *
 * CHỈ ĐO — không sửa mã sản phẩm. Dữ liệu dọn trong afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pgd${process.pid}${Date.now().toString(36)}`;
/** =1 ⇒ chạy các ca xuyên nhà máy như test thường (để thấy ĐỎ nguyên văn). Mặc định: `it.fails` (ghi nhận lỗ đã đo). */
const cross = process.env.PHAMVI_GHI_DO === "1" ? it : it.fails;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface NhaMay {
  fid: number;
  sid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
const recipeIds: number[] = [];
const zoneIds: number[] = [];

type Callers = {
  rec: ReturnType<typeof import("./machineRecipeRouter").machineRecipeRouter.createCaller>;
  onb: ReturnType<typeof import("./aoiOnboardingRouter").aoiOnboardingRouter.createCaller>;
  saf: ReturnType<typeof import("./safetyRouter").safetyRouter.createCaller>;
};
let userA!: Callers;
let rt: {
  machineRecipeRouter: typeof import("./machineRecipeRouter").machineRecipeRouter;
  aoiOnboardingRouter: typeof import("./aoiOnboardingRouter").aoiOnboardingRouter;
  safetyRouter: typeof import("./safetyRouter").safetyRouter;
};
const envCu = process.env.SAFETY_ZONE_SW_ENABLED;

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), sid: Number(s.id), mid: Number(m.id), code };
}

async function seedRecipe(ma: string, machineId: number): Promise<number> {
  const [r] = await dung(
    sql`INSERT INTO machine_recipes (code, name, version, payload, status, "machineId") VALUES (${ma}, ${ma}, 1, '{}'::jsonb, 'draft', ${machineId}) RETURNING id`,
  );
  recipeIds.push(Number(r.id));
  return Number(r.id);
}

async function seedZone(ma: string, stationId: number): Promise<number> {
  const [r] = await dung(
    sql`INSERT INTO safety_zones (code, name, "stationId", "stopDistanceMm") VALUES (${ma}, ${ma}, ${stationId}, 1000) RETURNING id`,
  );
  zoneIds.push(Number(r.id));
  return Number(r.id);
}

async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const dem = async (q: ReturnType<typeof sql>): Promise<number> => Number((await dung(q))[0]?.n ?? 0);

const snap = { step: 1, notes: "do-do-that" };

beforeAll(async () => {
  process.env.SAFETY_ZONE_SW_ENABLED = "true";
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  rt = {
    machineRecipeRouter: (await import("./machineRecipeRouter")).machineRecipeRouter,
    aoiOnboardingRouter: (await import("./aoiOnboardingRouter")).aoiOnboardingRouter,
    safetyRouter: (await import("./safetyRouter")).safetyRouter,
  };
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pgd", ts: RUN, ten: "PGD ua" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const cat of ["machine_control", "machine_monitoring"]) {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${resolvePermissionModule(cat)}, true, true, true, false)`,
    );
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  userA = {
    rec: rt.machineRecipeRouter.createCaller(ctx),
    onb: rt.aoiOnboardingRouter.createCaller(ctx),
    saf: rt.safetyRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (envCu === undefined) delete process.env.SAFETY_ZONE_SW_ENABLED;
  else process.env.SAFETY_ZONE_SW_ENABLED = envCu;
  if (!db) return;
  const ms = [A?.mid, B?.mid].filter(Boolean) as number[];
  if (recipeIds.length) await dung(sql`DELETE FROM machine_recipes WHERE id IN (${sql.join(recipeIds.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machine_recipes WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  if (zoneIds.length) await dung(sql`DELETE FROM safety_zones WHERE id IN (${sql.join(zoneIds.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM safety_zones WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  if (ms.length) await dung(sql`DELETE FROM aoi_commissioning_records WHERE "machineId" IN (${sql.join(ms.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("recipes.create — gắn công thức vào máy (machineId) nhà máy khác", () => {
  it("đối chứng: máy nhà máy A ⇒ tạo được", async () => {
    const r = await userA.rec.recipes.create({ code: `${RUN}-ca`, name: "ca", payload: {}, machineId: A.mid });
    expect(r).toBeTruthy();
  });
  cross("xuyên nhà máy: máy nhà máy B ⇒ phải bị từ chối, không có hàng nào gắn máy B", async () => {
    const loi = await maLoi(() => userA.rec.recipes.create({ code: `${RUN}-cb`, name: "cb", payload: {}, machineId: B.mid }));
    const hang = await dem(sql`SELECT count(*)::int AS n FROM machine_recipes WHERE "machineId" = ${B.mid} AND code = ${RUN + "-cb"}`);
    expect({ loi, hangGhiLenB: hang }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), hangGhiLenB: 0 });
  });
});

describe("recipes.archive / setGolden — lưu trữ / đánh dấu golden công thức của máy nhà máy khác", () => {
  it("đối chứng: công thức máy A ⇒ lưu trữ được", async () => {
    const id = await seedRecipe(`${RUN}-ra`, A.mid);
    await userA.rec.recipes.archive({ id });
    expect(await dem(sql`SELECT count(*)::int AS n FROM machine_recipes WHERE id = ${id} AND status = 'archived'`)).toBe(1);
  });
  cross("archive xuyên nhà máy: công thức máy B ⇒ phải bị từ chối, trạng thái vẫn 'draft'", async () => {
    const id = await seedRecipe(`${RUN}-rb`, B.mid);
    const loi = await maLoi(() => userA.rec.recipes.archive({ id }));
    const tt = (await dung(sql`SELECT status FROM machine_recipes WHERE id = ${id}`))[0]?.status;
    expect({ loi, trangThai: tt }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), trangThai: "draft" });
  });
  cross("setGolden xuyên nhà máy: công thức máy B ⇒ phải bị từ chối, isGolden vẫn false", async () => {
    const id = await seedRecipe(`${RUN}-rg`, B.mid);
    const loi = await maLoi(() => userA.rec.recipes.setGolden({ id, isGolden: true }));
    const g = (await dung(sql`SELECT "isGolden" FROM machine_recipes WHERE id = ${id}`))[0]?.isGolden;
    expect({ loi, isGolden: g }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), isGolden: false });
  });
});

describe("aoiOnboarding.saveDraft / deleteDraft — bản nháp nghiệm thu máy nhà máy khác", () => {
  it("đối chứng: máy A ⇒ lưu nháp được", async () => {
    await userA.onb.saveDraft({ machineId: A.mid, configSnapshot: snap });
    expect(await dem(sql`SELECT count(*)::int AS n FROM aoi_commissioning_records WHERE "machineId" = ${A.mid} AND status = 'draft'`)).toBe(1);
  });
  cross("saveDraft xuyên nhà máy: máy B ⇒ phải bị từ chối, không có bản nháp máy B", async () => {
    const loi = await maLoi(() => userA.onb.saveDraft({ machineId: B.mid, configSnapshot: snap }));
    const hang = await dem(sql`SELECT count(*)::int AS n FROM aoi_commissioning_records WHERE "machineId" = ${B.mid}`);
    expect({ loi, hangGhiLenB: hang }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), hangGhiLenB: 0 });
  });
  cross("deleteDraft xuyên nhà máy: nháp máy B ⇒ phải bị từ chối, nháp còn nguyên", async () => {
    await dung(sql`INSERT INTO aoi_commissioning_records ("machineId", status, "configSnapshot") VALUES (${B.mid}, 'draft', '{}'::jsonb)`);
    const loi = await maLoi(() => userA.onb.deleteDraft({ machineId: B.mid }));
    const con = await dem(sql`SELECT count(*)::int AS n FROM aoi_commissioning_records WHERE "machineId" = ${B.mid} AND status = 'draft'`);
    expect({ loi, nhapConLai: con }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), nhapConLai: 1 });
  });
});

describe("safety.updateZone — sửa vùng an toàn (ngưỡng dừng) của trạm nhà máy khác", () => {
  it("đối chứng: vùng trạm A ⇒ sửa được", async () => {
    const id = await seedZone(`${RUN}-za`, A.sid);
    await userA.saf.updateZone({ id, stopDistanceMm: 900 });
    expect((await dung(sql`SELECT "stopDistanceMm" AS v FROM safety_zones WHERE id = ${id}`))[0]?.v).toBe(900);
  });
  cross("xuyên nhà máy: vùng trạm B ⇒ phải bị từ chối, ngưỡng dừng vẫn 1000 mm", async () => {
    const id = await seedZone(`${RUN}-zb`, B.sid);
    const loi = await maLoi(() => userA.saf.updateZone({ id, stopDistanceMm: 600 }));
    const v = (await dung(sql`SELECT "stopDistanceMm" AS v FROM safety_zones WHERE id = ${id}`))[0]?.v;
    expect({ loi, stopDistanceMm: v }).toEqual({ loi: expect.stringMatching(/FORBIDDEN|NOT_FOUND/), stopDistanceMm: 1000 });
  });
});
