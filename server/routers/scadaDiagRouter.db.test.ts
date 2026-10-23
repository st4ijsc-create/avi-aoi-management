/**
 * SCADA R0 Task 10 — API M10 `scadaDiag` trên CSDL `_test` THẬT + otManager THẬT (nhánh legacy) + StubDriver THẬT.
 *
 * Phạm vi do `idsTrongPhamVi` THẬT đọc `user_factory_assignments`; quyền do `checkPermission` THẬT đọc `permissions`; người dùng qua
 * `taoNguoiDungTest`. Hai nhà máy A/B, mỗi nơi một adapter stub ĐANG CHẠY (loader thật lọc theo hàng của tệp này), một adapter KHÔNG gắn
 * máy (Review Focus #1) và một adapter do EDGE sở hữu (DB `status='error'`). `ingest` giả chỉ chuyển mẫu OT vào bộ đệm giá trị hiện tại
 * (`napTuOt`) — không ghi `ot_telemetry` (mẫu thô cho `mauTho` chèn thẳng bằng SQL).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r0t10${process.pid}${Date.now().toString(36)}`;
const myIds = new Set<number>();

vi.mock("../services/ot/ingest", () => ({
  ingestSample: async (a: { adapterId: number; machineId: number | null }, s: unknown) => {
    (await import("../services/scada/boDemHienTai")).napTuOt(a, [s as never]);
  },
  ingestSamples: async (a: { adapterId: number; machineId: number | null }, s: unknown[]) => {
    (await import("../services/scada/boDemHienTai")).napTuOt(a, s as never);
  },
}));
// Chỉ "stub" chạy thật; hàng của suite khác nhận driver giả (loader thật dựng driver cho MỌI hàng bật trước khi lọc).
vi.mock("../services/ot/driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/driverRegistry")>();
  const { createStubDriver } = await import("../services/ot/drivers/stubDriver");
  const gia = { protocol: "stub", isConnected: () => false } as never;
  return { ...real, createDriver: (p: string) => (p === "stub" ? createStubDriver() : gia) };
});
vi.mock("../services/ot/deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/deviceAdapter")>();
  return {
    ...real,
    loadEnabledAdapters: async () => (await real.loadEnabledAdapters()).filter((a) => myIds.has(a.adapterId)),
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaDiagRouter").scadaDiagRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaDiagRouter: Router;
let ot: typeof import("../services/ot/otManager");
let tt: typeof import("../services/ot/trangThaiAdapter");

interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, n: 0, e: 0 };
const ma = { a: `${RUN}-a`, b: `${RUN}-b`, n: `${RUN}-n`, e: `${RUN}-e` };
let edgeNodeId = 0;
const factories: string[] = [];

let viewerA!: Caller;
let operatorA!: Caller;
let engA!: Caller;
let admin!: Caller;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

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

async function seedAdapter(code: string, machineId: number | null, isEnabled: boolean, status = "disabled"): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, ${isEnabled}, ${status}) RETURNING id`);
  return Number(r.id);
}

async function seedNguoi(
  ten: string,
  role: "viewer" | "operator" | "engineer" | "admin",
  factoryCodes: string[],
  quyenDieuKhien: boolean,
): Promise<Caller> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r0t10", ts: RUN, ten: `R0T10 ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
    if (quyenDieuKhien) {
      await dung(
        sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`,
      );
    }
  }
  return scadaDiagRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never);
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; message?: string; appCode?: string }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function soAudit(adapterId: number, action: string): Promise<number> {
  const [r] = await dung(
    sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'device_adapter' AND "entityId" = ${String(adapterId)} AND action = ${action}`,
  );
  return Number(r.n);
}

const dongCua = async (c: Caller, id: number) => (await c.danhSach()).find((r) => r.adapterId === id);

beforeAll(async () => {
  vi.stubEnv("OT_GATEWAY_ENABLED", "true");
  vi.stubEnv("OT_CONN_HA_ENABLED", "false");
  vi.stubEnv("OT_LEGACY_RECONNECT_MS", "500");
  vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
  vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("SCADA_LAB_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaDiagRouter } = await import("./scadaDiagRouter"));
  ot = await import("../services/ot/otManager");
  tt = await import("../services/ot/trangThaiAdapter");

  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(ma.a, A.mid, true);
  ad.b = await seedAdapter(ma.b, B.mid, true);
  ad.n = await seedAdapter(ma.n, null, false); // KHÔNG gắn máy
  ad.e = await seedAdapter(ma.e, A.mid, false, "error"); // sẽ do edge sở hữu
  await dung(sql`UPDATE device_adapters SET "lastError" = 'ETIMEDOUT cũ', "lastErrorAt" = now() WHERE id = ${ad.e}`);
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r0t10 edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.e}`);
  for (const [id, keys] of [
    [ad.a, ["t1", "t2"]],
    [ad.b, ["t1"]],
  ] as const) {
    for (const k of keys) {
      await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", "isEnabled") VALUES (${id}, ${k}, ${"addr-" + k}, 'float', true)`);
    }
  }
  myIds.add(ad.a);
  myIds.add(ad.b);

  viewerA = await seedNguoi("va", "viewer", [A.code], false);
  operatorA = await seedNguoi("oa", "operator", [A.code], true);
  engA = await seedNguoi("ea", "engineer", [A.code], true);
  admin = await seedNguoi("ad", "admin", [], false);

  expect(await ot.startOt()).toBe(true);
  await vi.waitFor(
    () => {
      expect(tt.layTrangThaiAdapter(ad.a)?.tt).toBe("connected");
      expect(tt.layTrangThaiAdapter(ad.b)?.tt).toBe("connected");
    },
    { timeout: 10_000, interval: 100 },
  );
}, 60_000);

afterAll(async () => {
  try {
    await ot?.stopOt();
  } catch {
    /* bỏ qua */
  }
  vi.unstubAllEnvs();
  if (!db) return;
  try {
    const ids = [...Object.values(ad).filter(Boolean), -1];
    await dung(sql`DELETE FROM ot_telemetry WHERE "deviceId" = ${ma.a}`);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    if (ad.e) await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.e}`);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
    for (const code of factories) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
      await dung(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung(sql`DELETE FROM factories WHERE code = ${code}`);
    }
  } catch (e) {
    console.warn("[r0t10] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("scadaDiag.danhSach — phạm vi nhà máy", () => {
  it("viewer nhà máy A chỉ thấy adapter gắn máy của A (không B, không adapter KHÔNG gắn máy)", async () => {
    const ds = await viewerA.danhSach();
    const cua = ds.filter((r) => Object.values(ad).includes(r.adapterId)).map((r) => r.adapterId).sort();
    expect(cua).toEqual([ad.a, ad.e].sort());
    // mọi dòng (kể cả hàng của suite khác) phải thuộc máy của A — không dòng machineId null nào lọt
    for (const r of ds) expect(r.machineId).toBe(A.mid);
    const a = ds.find((r) => r.adapterId === ad.a)!;
    expect(a).toMatchObject({ code: ma.a, protocol: "stub", endpoint: `stub://${ma.a}`, soHuu: { loai: "trung_tam" }, trangThai: "connected", pollMs: 500 });
    expect(a.tu).toEqual(expect.any(String));
  });

  it("admin (phạm vi toàn quyền) thấy cả bốn, gồm adapter KHÔNG gắn máy", async () => {
    const ds = await admin.danhSach();
    const cua = ds.filter((r) => Object.values(ad).includes(r.adapterId)).map((r) => r.adapterId).sort();
    expect(cua).toEqual(Object.values(ad).sort());
    expect(ds.find((r) => r.adapterId === ad.n)).toMatchObject({ machineId: null, trangThai: "disabled" });
  });
});

describe("Review Focus #1 — adapter KHÔNG gắn máy / ngoài phạm vi / không tồn tại: cùng MỘT lỗi", () => {
  it("viewer A gọi tagCuaAdapter / mauTho cho adapter không gắn máy, adapter B, id không tồn tại ⇒ NOT_FOUND giống hệt nhau", async () => {
    const khongTonTai = await loiCua(viewerA.tagCuaAdapter({ adapterId: 2_000_000_000 }));
    expect(khongTonTai.code).toBe("NOT_FOUND");
    for (const id of [ad.n, ad.b]) {
      expect(await loiCua(viewerA.tagCuaAdapter({ adapterId: id }))).toEqual(khongTonTai);
      expect(await loiCua(viewerA.mauTho({ adapterId: id, tagKey: "t1" }))).toEqual(khongTonTai);
    }
    // đối chứng dương: cùng thủ tục, phạm vi toàn quyền ⇒ qua
    await expect(admin.tagCuaAdapter({ adapterId: ad.n })).resolves.toEqual([]);
    await expect(admin.tagCuaAdapter({ adapterId: ad.b })).resolves.toHaveLength(1);
  });
});

describe("scadaDiag.ketNoiLai", () => {
  it("operator / viewer ⇒ FORBIDDEN; engineer A với adapter B / không gắn máy ⇒ NOT_FOUND; lý do ngắn ⇒ BAD_REQUEST; edge ⇒ từ chối", async () => {
    const truoc = await soAudit(ad.a, "scada_ket_noi_lai");
    expect((await loiCua(operatorA.ketNoiLai({ adapterId: ad.a, lyDo: "thử nối lại" }))).code).toBe("FORBIDDEN");
    expect((await loiCua(viewerA.ketNoiLai({ adapterId: ad.a, lyDo: "thử nối lại" }))).code).toBe("FORBIDDEN");
    expect((await loiCua(engA.ketNoiLai({ adapterId: ad.b, lyDo: "thử nối lại" }))).code).toBe("NOT_FOUND");
    expect((await loiCua(engA.ketNoiLai({ adapterId: ad.n, lyDo: "thử nối lại" }))).code).toBe("NOT_FOUND");
    expect((await loiCua(engA.ketNoiLai({ adapterId: ad.a, lyDo: "abc" }))).code).toBe("BAD_REQUEST");
    expect((await loiCua(engA.ketNoiLai({ adapterId: ad.e, lyDo: "thử nối lại" }))).code).toBe("PRECONDITION_FAILED");
    expect(await soAudit(ad.a, "scada_ket_noi_lai")).toBe(truoc);
    expect(await soAudit(ad.e, "scada_ket_noi_lai")).toBe(0);
  });

  it("engineer A với adapter A ⇒ phiên được làm mới + ĐÚNG MỘT dòng audit (lý do, người làm)", async () => {
    const truoc = await soAudit(ad.a, "scada_ket_noi_lai");
    const kq = await engA.ketNoiLai({ adapterId: ad.a, lyDo: "kỹ sư thử nối lại" });
    expect(kq).toMatchObject({ reset: true, via: "legacy" });
    expect(await soAudit(ad.a, "scada_ket_noi_lai")).toBe(truoc + 1);
    const [dong] = await dung(
      sql`SELECT reason, "actorId" FROM control_audit_log WHERE "entityType" = 'device_adapter' AND "entityId" = ${String(ad.a)} AND action = 'scada_ket_noi_lai' ORDER BY id DESC LIMIT 1`,
    );
    expect(dong.reason).toBe("kỹ sư thử nối lại");
    expect(dong.actorId).toEqual(expect.any(Number));
    await vi.waitFor(() => expect(tt.layTrangThaiAdapter(ad.a)?.tt).toBe("connected"), { timeout: 5_000, interval: 100 });
  });
});

describe("scadaDiag.datLoiStub (Lab)", () => {
  it("cờ SCADA_LAB_ENABLED tắt ⇒ lỗi, không đổi gì", async () => {
    vi.stubEnv("SCADA_LAB_ENABLED", "false");
    const e = await loiCua(engA.datLoiStub({ adapterId: ad.a, loi: { matKetNoi: true } }));
    expect(e.appCode).toBe("FEATURE_DISABLED");
    expect((await dongCua(engA, ad.a))?.trangThai).toBe("connected");
  });

  it("cờ bật ⇒ stub mất kết nối và ≤ 5 s danhSach báo 'lost'; tag thành 'xấu'; gỡ lỗi ⇒ connected lại", async () => {
    vi.stubEnv("SCADA_LAB_ENABLED", "true");
    try {
      expect((await loiCua(operatorA.datLoiStub({ adapterId: ad.a, loi: { matKetNoi: true } }))).code).toBe("FORBIDDEN");
      expect((await loiCua(engA.datLoiStub({ adapterId: ad.b, loi: { matKetNoi: true } }))).code).toBe("NOT_FOUND");
      const truoc = await soAudit(ad.a, "scada_dat_loi_stub");
      const t0 = Date.now();
      await expect(engA.datLoiStub({ adapterId: ad.a, loi: { matKetNoi: true } })).resolves.toMatchObject({ apDung: true });
      await vi.waitFor(async () => expect((await dongCua(viewerA, ad.a))?.trangThai).toBe("lost"), { timeout: 5_000, interval: 100 });
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
      const r = (await dongCua(viewerA, ad.a))!;
      expect(r.soLanMat).toBeGreaterThanOrEqual(1);
      expect(r.loi).toEqual(expect.any(String));
      await vi.waitFor(async () => expect((await dongCua(viewerA, ad.a))?.tag).toMatchObject({ xau: 2, tot: 0 }), { timeout: 5_000, interval: 100 });
      // adapter B không bị đụng
      expect((await dongCua(admin, ad.b))?.trangThai).toBe("connected");

      await expect(engA.datLoiStub({ adapterId: ad.a, loi: {} })).resolves.toMatchObject({ apDung: true });
      await vi.waitFor(async () => expect((await dongCua(viewerA, ad.a))?.trangThai).toBe("connected"), { timeout: 5_000, interval: 100 });
      expect(await soAudit(ad.a, "scada_dat_loi_stub")).toBe(truoc + 2);
    } finally {
      vi.stubEnv("SCADA_LAB_ENABLED", "false");
    }
  });
});

describe("scadaDiag.tagCuaAdapter / mauTho", () => {
  it("tagCuaAdapter: mỗi tag bật có địa chỉ, giá trị hiện tại, tuổi và bộ đếm 1 h", async () => {
    await vi.waitFor(
      async () => {
        const tags = await viewerA.tagCuaAdapter({ adapterId: ad.a });
        expect(tags.map((t) => t.tagKey)).toEqual(["t1", "t2"]);
        for (const t of tags) {
          expect(t).toMatchObject({ address: `addr-${t.tagKey}`, q: "good", stale: false });
          expect(typeof t.v).toBe("number");
          expect(t.ageMs).toBeGreaterThanOrEqual(0);
          expect(t.boDem.request).toBeGreaterThan(0);
          expect(t.boDem.good).toBeGreaterThan(0);
        }
      },
      { timeout: 5_000, interval: 100 },
    );
  });

  it("mauTho trả ≤ 100 hàng thô, MỚI NHẤT trước, kèm chất lượng / statusCode", async () => {
    const goc = Date.now() - 600_000;
    for (let i = 0; i < 120; i++) {
      const q = i % 10 === 0 ? "bad" : "good";
      const meta = q === "bad" ? { adapterId: ad.a, tagKey: "mt", statusCode: "comm_lost" } : { adapterId: ad.a, tagKey: "mt" };
      await dung(sql`INSERT INTO ot_telemetry (ts, "machineId", "deviceId", protocol, metric, "numValue", quality, meta)
        VALUES (${new Date(goc + i * 1000).toISOString()}::timestamptz, ${A.mid}, ${ma.a}, 'other', 'mt', ${i}, ${q}, ${JSON.stringify(meta)}::jsonb)`);
    }
    const rows = await viewerA.mauTho({ adapterId: ad.a, tagKey: "mt" });
    expect(rows).toHaveLength(100);
    expect(rows[0]).toMatchObject({ giaTri: 119, quality: "good", statusCode: null });
    expect(rows[99].giaTri).toBe(20);
    for (let i = 1; i < rows.length; i++) expect(Date.parse(rows[i - 1].ts)).toBeGreaterThan(Date.parse(rows[i].ts));
    expect(rows.find((r) => r.giaTri === 110)).toMatchObject({ quality: "bad", statusCode: "comm_lost" });
  });
});

describe("adapter do EDGE sở hữu", () => {
  it("trangThai 'edge_chua_co_so_lieu' + soHuu edge — kể cả khi DB status='error' và RAM báo 'lost'", async () => {
    const r1 = (await dongCua(viewerA, ad.e))!;
    expect(r1).toMatchObject({ trangThai: "edge_chua_co_so_lieu", soHuu: { loai: "edge", edgeNodeId, edgeCode: `${RUN}-en` } });
    tt.baoTrangThaiAdapter({ adapterId: ad.e, code: ma.e, machineId: A.mid, protocol: "stub", tags: [] }, "lost", "rác RAM");
    const r2 = (await dongCua(admin, ad.e))!;
    expect(r2.trangThai).toBe("edge_chua_co_so_lieu");
    expect(r2.trangThai).not.toBe("lost");
  });

  it("tamTat adapter edge ⇒ từ chối, không ghi audit, không tắt hàng", async () => {
    expect((await loiCua(engA.tamTat({ adapterId: ad.e, lyDo: "thử tắt edge" }))).code).toBe("PRECONDITION_FAILED");
    expect(await soAudit(ad.e, "scada_tam_tat")).toBe(0);
  });
});

describe("scadaDiag.tamTat", () => {
  it("operator ⇒ FORBIDDEN; engineer A với adapter B ⇒ NOT_FOUND", async () => {
    expect((await loiCua(operatorA.tamTat({ adapterId: ad.a, lyDo: "tắt thử nghiệm" }))).code).toBe("FORBIDDEN");
    expect((await loiCua(engA.tamTat({ adapterId: ad.b, lyDo: "tắt thử nghiệm" }))).code).toBe("NOT_FOUND");
    const [b] = await dung(sql`SELECT "isEnabled" FROM device_adapters WHERE id = ${ad.b}`);
    expect(b.isEnabled).toBe(true);
  });

  it("engineer A tắt adapter A ⇒ isEnabled=false, gỡ khỏi OT, trạng thái 'disabled', bộ đếm 1 h GIỮ NGUYÊN, 1 dòng audit", async () => {
    const truoc = (await dongCua(viewerA, ad.a))!;
    expect(truoc.boDem1h.request).toBeGreaterThan(0);
    const kq = await engA.tamTat({ adapterId: ad.a, lyDo: "tạm tắt để bảo trì" });
    expect(kq).toMatchObject({ daGo: true });
    const [r] = await dung(sql`SELECT "isEnabled" FROM device_adapters WHERE id = ${ad.a}`);
    expect(r.isEnabled).toBe(false);
    expect(ot.getOtAdapterStatus(ad.a)).toBeUndefined();
    const sau = (await dongCua(viewerA, ad.a))!;
    expect(sau.trangThai).toBe("disabled");
    expect(sau.boDem1h.request).toBeGreaterThanOrEqual(truoc.boDem1h.request);
    expect(await soAudit(ad.a, "scada_tam_tat")).toBe(1);
  });
});
