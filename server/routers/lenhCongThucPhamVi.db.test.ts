/**
 * ★★★ Phạm vi nhà máy cho ba bề mặt còn lại cùng lớp "adapterId/machineId từ client" (rà bảo mật 2026-10-24, dieu-phoi giao):
 *   · `commandLog.*` — sổ LỆNH ghi xuống máy (kể cả lệnh của nhà máy khác khi lọc adapterId tuỳ chọn / không lọc);
 *   · `machineRecipe` — `recipes.deploy|rollback` (đổi công thức đang chạy của MỘT MÁY + ghi ledger + bóng cấu hình đồng bộ/MQTT retained tới máy đó), `changeover.*`, `deployments.list`, `machines.list`, `recipes.getActive`;
 *   · `safety.sourceHealth` (safetyRouter:464) — XÁC NHẬN đã có phạm vi (assertSourceHealthTargetInScope) tương đương bộ phân giải chung.
 * Test trên CSDL `_test` THẬT (khuôn adapterPhamVi.db.test.ts): hai nhà máy A/B, người dùng nhà máy B, admin toàn quyền. Ngoài phạm vi ≡ NOT_FOUND; danh sách chỉ trả mục trong phạm vi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `lcp${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, n: 0 };
const lenh = { a: 0, b: 0, n: 0 }; // command_log: A, B, adapter không gắn máy
const congThuc = { a: 0, b: 0 }; // machine_recipes (draft, gắn máy)
const yc = { a: 0 };
const dep = { a: 0, b: 0 }; // recipe_deployments // changeover_requests ở máy A
const factories: string[] = [];

type R = {
  commandLog: any;
  machineRecipe: any;
  safety: any;
};
let userB!: R;
let admin!: R;
let rt: { commandLogRouter: any; machineRecipeRouter: any; safetyRouter: any };

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
  return { fid: Number(f.id), mid: Number(m.id), code };
}
async function seedAdapter(code: string, machineId: number | null): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  return Number(r.id);
}
async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<{ r: R; id: number }> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "lcp", ts: RUN, ten: `LCP ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    for (const [cat, mod] of [
      ["machine_control", "machine_control"],
      ["machine_monitoring", "machine_status"],
    ] as const) {
      await dung(
        sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`,
      );
    }
  }
  const ctx = { user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never;
  return {
    id: u.id,
    r: {
      commandLog: rt.commandLogRouter.createCaller(ctx),
      machineRecipe: rt.machineRecipeRouter.createCaller(ctx),
      safety: rt.safetyRouter.createCaller(ctx),
    },
  };
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

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  rt = {
    commandLogRouter: (await import("./commandLogRouter")).commandLogRouter,
    machineRecipeRouter: (await import("./machineRecipeRouter")).machineRecipeRouter,
    safetyRouter: (await import("./safetyRouter")).safetyRouter,
  };
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(`${RUN}-a`, A.mid);
  ad.b = await seedAdapter(`${RUN}-b`, B.mid);
  ad.n = await seedAdapter(`${RUN}-n`, null);
  const ub = await seedNguoi("ub", "engineer", [B.code]);
  userB = ub.r;
  admin = (await seedNguoi("ad", "admin", [])).r;
  for (const [k, adId, mId] of [
    ["a", ad.a, A.mid],
    ["b", ad.b, B.mid],
    ["n", ad.n, null],
  ] as const) {
    const [l] = await dung(sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedBy", "confirmedBy", status, "triggerKind")
      VALUES (${adId}, ${mId}, ${"tk-" + k}, 'write_tag', ${ub.id}, ${ub.id}, 'rejected', 'hitl') RETURNING id`);
    lenh[k] = Number(l.id);
  }
  for (const [k, mId] of [
    ["a", A.mid],
    ["b", B.mid],
  ] as const) {
    const [r] = await dung(sql`INSERT INTO machine_recipes ("machineId", code, name, version, payload, status, "createdBy")
      VALUES (${mId}, ${RUN + "-rc-" + k}, ${"rc " + k}, 1, '{}'::jsonb, 'draft', ${ub.id}) RETURNING id`);
    congThuc[k] = Number(r.id);
  }
  for (const [k, mId] of [["a", A.mid], ["b", B.mid]] as const) {
    const [d] = await dung(sql`INSERT INTO recipe_deployments ("recipeId", "machineId", "deployedBy", status) VALUES (${congThuc[k]}, ${mId}, ${ub.id}, 'deployed') RETURNING id`);
    dep[k] = Number(d.id);
  }
  const [q] = await dung(sql`INSERT INTO changeover_requests ("machineId", "recipeId", "requestedBy") VALUES (${A.mid}, ${congThuc.a}, ${ub.id}) RETURNING id`);
  yc.a = Number(q.id);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM changeover_requests WHERE "machineId" IN (${A?.mid ?? -1}, ${B?.mid ?? -1})`).catch(() => undefined);
  await dung(sql`DELETE FROM recipe_deployments WHERE "machineId" IN (${A?.mid ?? -1}, ${B?.mid ?? -1})`).catch(() => undefined);
  await dung(sql`DELETE FROM machine_recipes WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM command_log WHERE "adapterId" IN (${ad.a}, ${ad.b}, ${ad.n})`).catch(() => undefined);
  await dung(sql`DELETE FROM device_adapters WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  for (const t of ["machines", "stations", "production_lines", "workshops", "factories"]) {
    await dung(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
});

describe("★★★ commandLog — sổ lệnh chỉ của nhà máy mình", () => {
  it("list (không lọc) ⇒ CHỈ lệnh của máy/adapter trong phạm vi; không có lệnh của A, không có lệnh adapter vô chủ", async () => {
    const ids = (await userB.commandLog.list({ limit: 500 })).map((r: { id: number }) => r.id);
    expect(ids).toContain(lenh.b);
    expect(ids).not.toContain(lenh.a);
    expect(ids).not.toContain(lenh.n);
  });
  it("list({adapterId của A}) / list({machineId của A}) ⇒ KHÔNG trả hàng nào của A", async () => {
    expect(await maLoi(() => userB.commandLog.list({ adapterId: ad.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.commandLog.list({ machineId: A.mid }))).toBe("NOT_FOUND");
  });
  it("get(lệnh của A) ⇒ NOT_FOUND; get(lệnh của B) ⇒ thấy", async () => {
    expect(await maLoi(() => userB.commandLog.get({ id: lenh.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.commandLog.get({ id: lenh.n }))).toBe("NOT_FOUND");
    expect((await userB.commandLog.get({ id: lenh.b })).id).toBe(lenh.b);
  });
  it("stats / avgDurations chỉ đếm lệnh trong phạm vi (không cộng lệnh nhà máy khác)", async () => {
    const tong = (r: { byStatus: Array<{ count: number }> }) => r.byStatus.reduce((a, x) => a + x.count, 0);
    const b = await userB.commandLog.stats({ sinceHours: 24 });
    expect(tong(b)).toBe(1); // đúng 1 lệnh của máy B; KHÔNG cộng lệnh A / adapter vô chủ
    // admin + adapter A (tập nhỏ — truy vấn "intent mở" toàn bảng quá chậm trên _test, nợ hiệu năng có sẵn): thấy lệnh của A
    expect(tong(await admin.commandLog.stats({ sinceHours: 24, adapterId: ad.a }))).toBe(1);
    expect(await userB.commandLog.stats({ sinceHours: 24, adapterId: ad.a })).toEqual({ byStatus: [], byTrigger: [], intents: { total: 0, open: 0 } });
  });
  it("đối chứng DƯƠNG: admin thấy lệnh của A, B và adapter vô chủ", async () => {
    const ids = (await admin.commandLog.list({ limit: 500 })).map((r: { id: number }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([lenh.a, lenh.b, lenh.n]));
    expect((await admin.commandLog.get({ id: lenh.a })).id).toBe(lenh.a);
  });
});

describe("★★★ machineRecipe — đổi công thức của máy nhà máy khác", () => {
  it("recipes.deploy(máy của A) ⇒ NOT_FOUND và KHÔNG có hàng ledger; deploy với adapterId của A trên máy của B ⇒ NOT_FOUND", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM recipe_deployments WHERE "machineId" IN (${A.mid}, ${B.mid})`);
    expect(await maLoi(() => userB.machineRecipe.recipes.deploy({ recipeId: congThuc.a, machineId: A.mid }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.machineRecipe.recipes.deploy({ recipeId: congThuc.b, machineId: B.mid, adapterId: ad.a }))).toBe("NOT_FOUND");
    expect(await dem(sql`SELECT count(*)::int AS n FROM recipe_deployments WHERE "machineId" IN (${A.mid}, ${B.mid})`)).toBe(truoc);
  });
  it("đối chứng DƯƠNG: deploy trên máy của CHÍNH B qua được cổng phạm vi (bị chặn muộn hơn vì công thức còn 'draft', KHÔNG phải NOT_FOUND phạm vi)", async () => {
    const m = await maLoi(() => userB.machineRecipe.recipes.deploy({ recipeId: congThuc.b, machineId: B.mid, adapterId: ad.b }));
    expect(m).not.toBe("NOT_FOUND");
    expect(m).not.toBeNull(); // công thức chưa duyệt ⇒ từ chối (PRECONDITION_FAILED/BAD_REQUEST)
  });
  it("recipes.rollback(máy của A) ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => userB.machineRecipe.recipes.rollback({ machineId: A.mid }))).toBe("NOT_FOUND");
  });
  it("recipes.getActive(máy của A) ⇒ NOT_FOUND; deployments.list chỉ hàng của máy trong phạm vi; machines.list chỉ máy trong phạm vi", async () => {
    expect(await maLoi(() => userB.machineRecipe.recipes.getActive({ machineId: A.mid, code: `${RUN}-rc-a` }))).toBe("NOT_FOUND");
    const may = (await userB.machineRecipe.machines.list()).map((m: { id: number }) => m.id);
    expect(may).toContain(B.mid);
    expect(may).not.toContain(A.mid);
    expect(await maLoi(() => userB.machineRecipe.deployments.list({ machineId: A.mid }))).toBe("NOT_FOUND");
    const ds = (await userB.machineRecipe.deployments.list({ limit: 500 })).map((d: { id: number }) => d.id);
    expect(ds).toContain(dep.b);
    expect(ds).not.toContain(dep.a);
  });
  it("changeover: request / recipeOptions (máy của A) ⇒ NOT_FOUND; approve / reject (yêu cầu của máy A) ⇒ NOT_FOUND; list không có yêu cầu của A", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM changeover_requests WHERE "machineId" = ${A.mid}`);
    expect(await maLoi(() => userB.machineRecipe.changeover.request({ machineId: A.mid, recipeId: congThuc.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.machineRecipe.changeover.recipeOptions({ machineId: A.mid }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.machineRecipe.changeover.approve({ id: yc.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.machineRecipe.changeover.reject({ id: yc.a, note: "ngoai pham vi" }))).toBe("NOT_FOUND");
    expect(await dem(sql`SELECT count(*)::int AS n FROM changeover_requests WHERE "machineId" = ${A.mid}`)).toBe(truoc);
    expect((await dung(sql`SELECT status FROM changeover_requests WHERE id = ${yc.a}`))[0].status).toBe("pending");
    const ids = (await userB.machineRecipe.changeover.list({})).map((r: { id: number }) => r.id);
    expect(ids).not.toContain(yc.a);
  });
  it("đối chứng DƯƠNG: B tạo yêu cầu đổi model trên máy của CHÍNH mình; admin thấy cả hai", async () => {
    const r = await userB.machineRecipe.changeover.request({ machineId: B.mid, recipeId: congThuc.b });
    expect(r.machineId).toBe(B.mid);
    expect((await userB.machineRecipe.changeover.recipeOptions({ machineId: B.mid })).length).toBeGreaterThanOrEqual(0);
    const ids = (await admin.machineRecipe.changeover.list({})).map((x: { id: number }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([yc.a, r.id]));
    const may = (await admin.machineRecipe.machines.list()).map((m: { id: number }) => m.id);
    expect(may).toEqual(expect.arrayContaining([A.mid, B.mid]));
  });
});

describe("★★ safety.sourceHealth (safetyRouter:464) — XÁC NHẬN đã có phạm vi tương đương bộ phân giải chung", () => {
  it("target.adapterId / machineId ngoài phạm vi ⇒ NOT_FOUND; adapter vô chủ ⇒ NOT_FOUND; target trong phạm vi / không target ⇒ qua; admin qua", async () => {
    expect(await maLoi(() => userB.safety.sourceHealth({ target: { adapterId: ad.a } }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.safety.sourceHealth({ target: { machineId: A.mid } }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.safety.sourceHealth({ target: { adapterId: ad.n } }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.safety.sourceHealth({ target: { adapterId: ad.b } }))).toBeNull();
    expect(await maLoi(() => userB.safety.sourceHealth())).toBeNull();
    expect(await maLoi(() => admin.safety.sourceHealth({ target: { adapterId: ad.a } }))).toBeNull();
    // tương đương: cùng phán quyết với bộ phân giải chung
    const { adapterTrongPhamVi } = await import("./_adapterPhamVi");
    const [u] = await dung(sql`SELECT id, role FROM users WHERE username = ${`lcp_ub_${RUN}`}`);
    expect(await maLoi(() => adapterTrongPhamVi({ user: { id: u.id, role: u.role } }, ad.a))).toBe("NOT_FOUND");
    expect(await maLoi(() => adapterTrongPhamVi({ user: { id: u.id, role: u.role } }, ad.n))).toBe("NOT_FOUND");
    expect(await maLoi(() => adapterTrongPhamVi({ user: { id: u.id, role: u.role } }, ad.b))).toBeNull();
  });
});
