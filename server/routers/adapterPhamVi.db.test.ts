/**
 * ★★★ Phạm vi nhà máy của các thủ tục tRPC nhận `adapterId` / `id` tag / `id` mapping / `recordId` từ client (rà bảo mật 2026-10-24, scada-master phát hiện, đã đọc mã xác nhận):
 * `commissioning.list|status`, `deviceAdapter.tags.listByAdapter`, `unsMapping.get|list` đọc dữ liệu adapter KHÔNG lọc phạm vi — người dùng nhà máy B đọc được dữ liệu adapter của nhà máy A.
 * Cùng lớp lỗi: các thủ tục GHI/ĐỌC khác khoá theo adapter ở `deviceAdapter` · `commissioning` · `unsMapping` · `mappingAsCode`.
 *
 * Test trên CSDL `_test` THẬT (khuôn `scadaDiagRouter.db.test.ts`): phạm vi do `idsTrongPhamVi` THẬT đọc `user_factory_assignments`; quyền do `checkPermission` THẬT; người dùng qua `taoNguoiDungTest`.
 * Hai nhà máy A/B (mỗi nơi một máy + một adapter), một adapter KHÔNG gắn máy. Luật: ngoài phạm vi ≡ KHÔNG TỒN TẠI (cùng NOT_FOUND); danh sách chỉ trả mục trong phạm vi; adapter không gắn máy chỉ
 * phạm vi toàn quyền (admin) thấy; admin giữ nguyên. Ghi: không thủ tục nào ghi/xoá được hàng của nhà máy khác (kiểm trạng thái DB sau lượt gọi).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `apv${process.pid}${Date.now().toString(36)}`;

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
const maAd = { a: `${RUN}-a`, b: `${RUN}-b`, n: `${RUN}-n` };
const tag = { a: 0, b: 0 };
const ghi = { a: 0, b: 0 }; // commissioning_records
const map = { a: 0, b: 0 }; // uns_tag_mappings
const factories: string[] = [];

type Routers = {
  deviceAdapter: ReturnType<typeof import("./deviceAdapterRouter").deviceAdapterRouter.createCaller>;
  commissioning: ReturnType<typeof import("./commissioningRouter").commissioningRouter.createCaller>;
  unsMapping: ReturnType<typeof import("./unsMappingRouter").unsMappingRouter.createCaller>;
  mappingAsCode: ReturnType<typeof import("./mappingAsCodeRouter").mappingAsCodeRouter.createCaller>;
};
let userA!: Routers;
let userB!: Routers;
let admin!: Routers;
let rt: {
  deviceAdapterRouter: typeof import("./deviceAdapterRouter").deviceAdapterRouter;
  commissioningRouter: typeof import("./commissioningRouter").commissioningRouter;
  unsMappingRouter: typeof import("./unsMappingRouter").unsMappingRouter;
  mappingAsCodeRouter: typeof import("./mappingAsCodeRouter").mappingAsCodeRouter;
};

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

async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<Routers> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "apv", ts: RUN, ten: `APV ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`,
    );
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'admin', 'admin_system', true, true, true, true)`,
    );
  }
  const ctx = { user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never;
  return {
    deviceAdapter: rt.deviceAdapterRouter.createCaller(ctx),
    commissioning: rt.commissioningRouter.createCaller(ctx),
    unsMapping: rt.unsMappingRouter.createCaller(ctx),
    mappingAsCode: rt.mappingAsCodeRouter.createCaller(ctx),
  };
}

/** Mã lỗi tRPC của lượt gọi, hoặc `null` nếu KHÔNG ném. */
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
    deviceAdapterRouter: (await import("./deviceAdapterRouter")).deviceAdapterRouter,
    commissioningRouter: (await import("./commissioningRouter")).commissioningRouter,
    unsMappingRouter: (await import("./unsMappingRouter")).unsMappingRouter,
    mappingAsCodeRouter: (await import("./mappingAsCodeRouter")).mappingAsCodeRouter,
  };
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(maAd.a, A.mid);
  ad.b = await seedAdapter(maAd.b, B.mid);
  ad.n = await seedAdapter(maAd.n, null);
  userA = await seedNguoi("ua", "engineer", [A.code]);
  userB = await seedNguoi("ub", "engineer", [B.code]);
  admin = await seedNguoi("ad", "admin", []);
  const [uA] = await dung(sql`SELECT id FROM users WHERE username = ${`apv_ua_${RUN}`}`);
  for (const k of ["a", "b"] as const) {
    const adId = ad[k];
    const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${adId}, ${"t-" + k}, ${"40001"}, 'float', false, true) RETURNING id`);
    tag[k] = Number(t.id);
    const [r] = await dung(sql`INSERT INTO commissioning_records ("adapterId", status, "fatReference", "signedBy") VALUES (${adId}, 'active', ${"FAT-" + k + RUN}, ${uA.id}) RETURNING id`);
    ghi[k] = Number(r.id);
    const [m] = await dung(sql`INSERT INTO uns_tag_mappings ("adapterId", tag, "unsTopic", enabled) VALUES (${adId}, ${"t-" + k}, ${"uns/" + RUN + "/" + k}, true) RETURNING id`);
    map[k] = Number(m.id);
  }
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const ids = [ad.a, ad.b, ad.n].filter(Boolean);
  if (ids.length) {
    const ds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM uns_tag_mappings WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM commissioning_records WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM device_adapters WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
});

describe("★★★ ĐỌC dữ liệu adapter — nhà máy B KHÔNG đọc được adapter của nhà máy A (ngoài phạm vi ≡ NOT_FOUND)", () => {
  it("§0 đối chứng DƯƠNG: người dùng nhà máy A đọc được adapter của CHÍNH mình ở mọi thủ tục đọc", async () => {
    expect((await userA.commissioning.list({ adapterId: ad.a })).map((r) => r.id)).toEqual([ghi.a]);
    expect((await userA.commissioning.status({ adapterId: ad.a })).adapterId).toBe(ad.a);
    expect((await userA.deviceAdapter.tags.listByAdapter({ adapterId: ad.a })).map((t) => t.id)).toEqual([tag.a]);
    expect((await userA.deviceAdapter.get({ id: ad.a })).id).toBe(ad.a);
    expect((await userA.unsMapping.get({ id: map.a })).id).toBe(map.a);
    expect((await userA.unsMapping.list({ adapterId: ad.a })).map((m) => m.id)).toEqual([map.a]);
    expect((await userA.mappingAsCode.exportOne({ adapterCode: maAd.a })).adapterId).toBe(ad.a);
  });

  it("commissioning.list ngoài phạm vi ⇒ NOT_FOUND (trước vá: trả sổ ký của nhà máy A)", async () => {
    expect(await maLoi(() => userB.commissioning.list({ adapterId: ad.a }))).toBe("NOT_FOUND");
  });
  it("commissioning.status ngoài phạm vi ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => userB.commissioning.status({ adapterId: ad.a }))).toBe("NOT_FOUND");
  });
  it("deviceAdapter.tags.listByAdapter ngoài phạm vi ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => userB.deviceAdapter.tags.listByAdapter({ adapterId: ad.a }))).toBe("NOT_FOUND");
  });
  it("unsMapping.get ngoài phạm vi ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => userB.unsMapping.get({ id: map.a }))).toBe("NOT_FOUND");
  });
  it("unsMapping.list({adapterId của A}) ngoài phạm vi ⇒ NOT_FOUND", async () => {
    expect(await maLoi(() => userB.unsMapping.list({ adapterId: ad.a }))).toBe("NOT_FOUND");
  });
  it("unsMapping.list() không lọc ⇒ CHỈ mapping của adapter trong phạm vi (không có của A, không có của adapter không gắn máy)", async () => {
    const ids = (await userB.unsMapping.list()).map((m) => m.id);
    expect(ids).toContain(map.b);
    expect(ids).not.toContain(map.a);
  });
  it("deviceAdapter.get / list: adapter của A và adapter KHÔNG gắn máy vô hình với B", async () => {
    expect(await maLoi(() => userB.deviceAdapter.get({ id: ad.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.get({ id: ad.n }))).toBe("NOT_FOUND");
    const ids = (await userB.deviceAdapter.list()).map((r) => r.id);
    expect(ids).toContain(ad.b);
    expect(ids).not.toContain(ad.a);
    expect(ids).not.toContain(ad.n);
  });
  it("mappingAsCode.exportOne / preview ngoài phạm vi ⇒ NOT_FOUND (không lộ cấu hình adapter A)", async () => {
    expect(await maLoi(() => userB.mappingAsCode.exportOne({ adapterCode: maAd.a }))).toBe("NOT_FOUND");
    const yamlA = `adapter: ${maAd.a}\nversion: 1\ntags: []\nuns_mappings: []\n`;
    const yamlB = `adapter: ${maAd.b}\nversion: 1\ntags: []\nuns_mappings: []\n`;
    expect(await maLoi(() => userB.mappingAsCode.preview({ yaml: yamlA, prune: false }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.mappingAsCode.preview({ yaml: yamlB, prune: false })), "đối chứng dương: adapter của chính B").toBeNull();
  });
  it("admin (toàn quyền) giữ nguyên: thấy cả A, B và adapter không gắn máy", async () => {
    expect(await maLoi(() => admin.commissioning.list({ adapterId: ad.a }))).toBeNull();
    expect(await maLoi(() => admin.deviceAdapter.tags.listByAdapter({ adapterId: ad.b }))).toBeNull();
    expect((await admin.deviceAdapter.get({ id: ad.n })).id).toBe(ad.n);
    const ids = (await admin.unsMapping.list()).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([map.a, map.b]));
    const ds = (await admin.deviceAdapter.list()).map((r) => r.id);
    expect(ds).toEqual(expect.arrayContaining([ad.a, ad.b, ad.n]));
  });
});

describe("★★★ GHI — nhà máy B KHÔNG ghi/xoá được hàng của nhà máy A (kiểm trạng thái DB, không chỉ mã lỗi)", () => {
  it("commissioning.create(adapter của A) ⇒ NOT_FOUND và KHÔNG sinh bản ký nào (ký = cấp quyền ghi thật xuống máy)", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM commissioning_records WHERE "adapterId" = ${ad.a}`);
    expect(await maLoi(() => userB.commissioning.create({ adapterId: ad.a, fatReference: "X" }))).toBe("NOT_FOUND");
    expect(await dem(sql`SELECT count(*)::int AS n FROM commissioning_records WHERE "adapterId" = ${ad.a}`)).toBe(truoc);
  });
  it("commissioning.revoke(bản ký của A) ⇒ NOT_FOUND và bản ký vẫn 'active'", async () => {
    expect(await maLoi(() => userB.commissioning.revoke({ recordId: ghi.a, reason: "thử" }))).toBe("NOT_FOUND");
    expect((await dung(sql`SELECT status FROM commissioning_records WHERE id = ${ghi.a}`))[0].status).toBe("active");
  });
  it("deviceAdapter.update / delete / testConnection(adapter của A) ⇒ NOT_FOUND, adapter A nguyên vẹn", async () => {
    expect(await maLoi(() => userB.deviceAdapter.update({ id: ad.a, name: "bị sửa" } as never))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.delete({ id: ad.a }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.testConnection({ id: ad.a }))).toBe("NOT_FOUND");
    const [r] = await dung(sql`SELECT name FROM device_adapters WHERE id = ${ad.a}`);
    expect(r.name).toBe(maAd.a);
  });
  it("deviceAdapter.create với máy của nhà máy A (hoặc không gắn máy) bởi B ⇒ bị từ chối, không sinh adapter", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM device_adapters WHERE code LIKE ${RUN + "%"}`);
    const goc = { protocol: "stub", endpoint: "stub://x", pollIntervalMs: 500, isEnabled: false } as const;
    expect(await maLoi(() => userB.deviceAdapter.create({ ...goc, code: `${RUN}-moi1`, name: "n", machineId: A.mid } as never))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.create({ ...goc, code: `${RUN}-moi2`, name: "n" } as never))).not.toBeNull();
    expect(await dem(sql`SELECT count(*)::int AS n FROM device_adapters WHERE code LIKE ${RUN + "%"}`)).toBe(truoc);
  });
  it("deviceAdapter.update chuyển adapter của CHÍNH B sang máy của A ⇒ bị từ chối, machineId không đổi", async () => {
    expect(await maLoi(() => userB.deviceAdapter.update({ id: ad.b, machineId: A.mid } as never))).toBe("NOT_FOUND");
    expect((await dung(sql`SELECT "machineId" FROM device_adapters WHERE id = ${ad.b}`))[0].machineId).toBe(B.mid);
  });
  it("deviceAdapter.tags.create / update / delete (tag của A) ⇒ NOT_FOUND, tag nguyên vẹn", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${ad.a}`);
    expect(await maLoi(() => userB.deviceAdapter.tags.create({ adapterId: ad.a, tagKey: "moi", address: "1", dataType: "float" } as never))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.tags.update({ id: tag.a, unit: "bị sửa" } as never))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.deviceAdapter.tags.delete({ id: tag.a }))).toBe("NOT_FOUND");
    expect(await dem(sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${ad.a}`)).toBe(truoc);
    expect((await dung(sql`SELECT unit FROM device_tags WHERE id = ${tag.a}`))[0].unit).toBeNull();
  });
  it("unsMapping.create / update / delete (adapter hoặc mapping của A) ⇒ NOT_FOUND, mapping nguyên vẹn", async () => {
    const truoc = await dem(sql`SELECT count(*)::int AS n FROM uns_tag_mappings WHERE "adapterId" = ${ad.a}`);
    expect(await maLoi(() => userB.unsMapping.create({ adapterId: ad.a, tag: "moi", unsTopic: "uns/x", enabled: true }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.unsMapping.update({ id: map.a, unsTopic: "uns/bi-sua" }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userB.unsMapping.delete({ id: map.a }))).toBe("NOT_FOUND");
    expect(await dem(sql`SELECT count(*)::int AS n FROM uns_tag_mappings WHERE "adapterId" = ${ad.a}`)).toBe(truoc);
    expect((await dung(sql`SELECT "unsTopic" FROM uns_tag_mappings WHERE id = ${map.a}`))[0].unsTopic).toBe(`uns/${RUN}/a`);
  });
  it("đối chứng DƯƠNG ghi: người dùng nhà máy B ghi được trên adapter của CHÍNH mình (không vá quá tay)", async () => {
    const t = await userB.deviceAdapter.tags.create({ adapterId: ad.b, tagKey: "moi-b", address: "2", dataType: "float" } as never);
    expect(t.adapterId).toBe(ad.b);
    expect(await maLoi(() => userB.deviceAdapter.tags.update({ id: t.id, unit: "A" } as never))).toBeNull();
    expect(await maLoi(() => userB.deviceAdapter.tags.delete({ id: t.id }))).toBeNull();
    const m = await userB.unsMapping.create({ adapterId: ad.b, tag: "moi-b", unsTopic: "uns/b/moi", enabled: true });
    expect(await maLoi(() => userB.unsMapping.update({ id: m.id, unsTopic: "uns/b/sua" }))).toBeNull();
    expect(await maLoi(() => userB.unsMapping.delete({ id: m.id }))).toBeNull();
    const k = await userB.commissioning.create({ adapterId: ad.b, fatReference: "FAT-B2" });
    expect(await maLoi(() => userB.commissioning.revoke({ recordId: k.id, reason: "xong" }))).toBeNull();
  });
});

describe("★★ Bộ phân giải chung `_adapterPhamVi` + chuyển tag sang adapter ngoài phạm vi", () => {
  it("deviceAdapter.tags.update của B KHÔNG chuyển được tag của B sang adapter của A (đổi adapterId trong bản vá)", async () => {
    const t = await userB.deviceAdapter.tags.create({ adapterId: ad.b, tagKey: "chuyen-b", address: "9", dataType: "float" } as never);
    expect(await maLoi(() => userB.deviceAdapter.tags.update({ id: t.id, adapterId: ad.a } as never))).toBe("NOT_FOUND");
    expect((await dung(sql`SELECT "adapterId" FROM device_tags WHERE id = ${t.id}`))[0].adapterId).toBe(ad.b);
    await userB.deviceAdapter.tags.delete({ id: t.id });
  });

  it("maAdapterTrongPhamVi / idsAdapterTrongPhamVi: B chỉ thấy adapter của B; admin ⇒ null (toàn quyền)", async () => {
    const { maAdapterTrongPhamVi, idsAdapterTrongPhamVi } = await import("./_adapterPhamVi");
    const uB = (await dung(sql`SELECT id, role FROM users WHERE username = ${`apv_ub_${RUN}`}`))[0];
    const uAd = (await dung(sql`SELECT id, role FROM users WHERE username = ${`apv_ad_${RUN}`}`))[0];
    const ma = await maAdapterTrongPhamVi({ user: { id: uB.id, role: uB.role } });
    expect(ma && [...ma].includes(maAd.b)).toBe(true);
    expect(ma && [...ma].includes(maAd.a)).toBe(false);
    expect(ma && [...ma].includes(maAd.n)).toBe(false);
    const ids = await idsAdapterTrongPhamVi({ user: { id: uB.id, role: uB.role } });
    expect(ids && ids.has(ad.b) && !ids.has(ad.a) && !ids.has(ad.n)).toBe(true);
    expect(await maAdapterTrongPhamVi({ user: { id: uAd.id, role: uAd.role } })).toBeNull();
    expect(await idsAdapterTrongPhamVi({ user: { id: uAd.id, role: uAd.role } })).toBeNull();
  });
});
