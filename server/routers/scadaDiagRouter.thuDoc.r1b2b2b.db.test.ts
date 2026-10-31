/**
 * SCADA R1b-2b-2b A C4 (mục 5) — HỢP ĐỒNG `scadaDiag.thuDocDiaChi` (Lab "thử đọc một địa chỉ") trên CSDL `_test` THẬT.
 *
 * Thật: phạm vi (`idsTrongPhamVi` đọc `user_factory_assignments`), quyền (`checkPermission` đọc `permissions`), sở hữu edge (`device_adapters."edgeNodeId"`),
 * audit (`recordAuditEvent` thật ghi `control_audit_log` — bọc `importOriginal` chỉ để GHI THỨ TỰ / ép ném), trạng thái adapter RAM (`trangThaiAdapter`).
 * Giả: `getActiveDriver` (otManager) trả StubDriver THẬT đã connect cho adapter của tệp, bọc spy ghi thứ tự `docLab` / `readTags` / `writeTags` / `connect`;
 * `resetAdapterSession` chỉ ghi sổ (Lab không bao giờ được gọi nó). Không startOt, không thiết bị thật. AUTH_2FA_BAT_BUOC=1 (bắt buộc) trong tiến trình.
 * Ràng buộc kiem-dinh KD-2bA 4.1 (không 2FA), 4.3 (không lệch trạng thái), 4.4 (1 lượt đang bay / adapter), 4.5 (audit kết quả nền), 4.6 (làm sạch),
 * 4.7 (thứ tự cổng) + Review Focus 3.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `c4lab${process.pid}${Date.now().toString(36)}`;
const H = vi.hoisted(() => ({
  log: [] as string[],
  drivers: new Map<number, unknown>(),
  nemAudit: null as string | null,
}));

vi.mock("../services/ot/otManager", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/otManager")>();
  return {
    ...real,
    getActiveDriver: (adapterId: number) => {
      H.log.push(`getActiveDriver:${adapterId}`);
      return H.drivers.get(adapterId) as ReturnType<typeof real.getActiveDriver>;
    },
    resetAdapterSession: async (...args: Parameters<typeof real.resetAdapterSession>) => {
      H.log.push(`resetAdapterSession:${args[0]}`);
      return { reset: false, error: "test" } as unknown as Awaited<ReturnType<typeof real.resetAdapterSession>>;
    },
  };
});
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...real,
    recordAuditEvent: async (...args: Parameters<typeof real.recordAuditEvent>) => {
      const e = args[1];
      H.log.push(`audit:${e.action}:${e.entityId}`);
      if (H.nemAudit === e.action) throw new Error(`audit ép ném (${e.action})`);
      const row = await real.recordAuditEvent(...args);
      H.log.push(`audit-ok:${e.action}:${e.entityId}:${row?.id}`);
      return row;
    },
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { batDauDoLag } from "../testing/doLagBucleSuKien";
import type { OtSample, OtTagAddress } from "../services/ot/otDriver";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaDiagRouter").scadaDiagRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaDiagRouter: Router;
let mod: typeof import("./scadaDiagRouter");
let td: typeof import("../services/ot/thuDocDiaChi");
let tt: typeof import("../services/ot/trangThaiAdapter");
let bd: typeof import("../services/ot/boDemTruyenThong");

interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, off: 0, e: 0, s7a: 0, s7b: 0, s7e: 0, h: 0, n: 0, x: 0 };
let edgeNodeId = 0;
const factories: string[] = [];
const stubs = new Map<number, StubDriver>();

let engA!: Caller;
let engA2!: Caller;
let engKhong2fa!: Caller;
let engKhongSua!: Caller;
let opA!: Caller;
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

async function seedAdapter(ten: string, machineId: number | null, protocol = "stub"): Promise<number> {
  const code = `${RUN}-${ten}`;
  const endpoint = protocol === "stub" ? `stub://${code}` : "10.0.0.5:102";
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, ${protocol}, ${endpoint}, 500, true, 'connected') RETURNING id`);
  return Number(r.id);
}

async function seedNguoi(
  ten: string,
  role: "operator" | "engineer" | "admin",
  factoryCodes: string[],
  quyenSua: boolean,
  twoFactorEnabled = true,
): Promise<Caller> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "c4lab", ts: RUN, ten: `C4 Lab ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${quyenSua})`,
    );
  }
  return scadaDiagRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled } } as never);
}

/** StubDriver THẬT đã connect, bọc spy: mọi lời gọi I/O ghi vào H.log theo thứ tự. */
async function driverSpy(adapterId: number): Promise<StubDriver> {
  const d = new StubDriver();
  await d.connect({ endpoint: `stub://${RUN}-spy-${adapterId}`, timeoutMs: 1000 } as never);
  for (const ten of ["docLab", "readTags", "writeTags", "connect", "disconnect"] as const) {
    const goc = (d as any)[ten].bind(d);
    (d as any)[ten] = (...args: unknown[]) => {
      H.log.push(`${ten}:${adapterId}`);
      return goc(...args);
    };
  }
  stubs.set(adapterId, d);
  H.drivers.set(adapterId, d);
  return d;
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; params?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, params: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function soAudit(adapterId: number, action: string): Promise<number> {
  const [r] = await dung(
    sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'device_adapter' AND "entityId" = ${String(adapterId)} AND action = ${action}`,
  );
  return Number(r.n);
}

const dem = (pre: string) => H.log.filter((x) => x.startsWith(pre)).length;
const goi = (c: Caller, adapterId: number, address = "40001", dataType: "bool" | "int" | "float" | "string" = "int") =>
  c.thuDocDiaChi({ adapterId, address, dataType, lyDo: "kiểm tra địa chỉ Lab" });

beforeAll(async () => {
  vi.stubEnv("AUTH_2FA_BAT_BUOC", "1");
  vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
  vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  mod = await import("./scadaDiagRouter");
  scadaDiagRouter = mod.scadaDiagRouter;
  td = await import("../services/ot/thuDocDiaChi");
  tt = await import("../services/ot/trangThaiAdapter");
  bd = await import("../services/ot/boDemTruyenThong");

  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter("a", A.mid);
  ad.b = await seedAdapter("b", B.mid);
  ad.off = await seedAdapter("off", A.mid); // không có driver đang chạy
  ad.e = await seedAdapter("e", A.mid); // do edge sở hữu
  ad.s7a = await seedAdapter("s7a", A.mid, "s7");
  ad.s7b = await seedAdapter("s7b", B.mid, "s7");
  ad.s7e = await seedAdapter("s7e", A.mid, "s7"); // s7 + edge
  ad.h = await seedAdapter("h", A.mid); // driver treo / ném
  ad.n = await seedAdapter("n", null); // không gắn máy
  ad.x = await seedAdapter("x", A.mid); // riêng cho ca 4.3 / trần
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'c4 edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id IN (${ad.e}, ${ad.s7e})`);
  for (const id of [ad.a, ad.b, ad.e, ad.n, ad.x]) await driverSpy(id);
  // edge / s7 không bao giờ tới bước driver — vẫn cắm driver để cổng SAI THỨ TỰ lộ ra (đọc được ⇒ test đỏ)
  for (const id of [ad.s7a, ad.s7b, ad.s7e]) await driverSpy(id);

  engA = await seedNguoi("ea", "engineer", [A.code], true);
  engA2 = await seedNguoi("ea2", "engineer", [A.code], true);
  engKhong2fa = await seedNguoi("en2", "engineer", [A.code], true, false);
  engKhongSua = await seedNguoi("eks", "engineer", [A.code], false);
  opA = await seedNguoi("oa", "operator", [A.code], true);
  admin = await seedNguoi("ad", "admin", [], false);
}, 60_000);

beforeEach(() => {
  td._datLaiThuDocChoTest();
  H.nemAudit = null;
  for (const s of stubs.values()) s.simDatLoi({ giaTri: { __lab__: 42 } });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const s of stubs.values()) await s.disconnect().catch(() => undefined);
  if (!db) return;
  try {
    const ids = [...Object.values(ad).filter(Boolean), -1];
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
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
    console.warn("[c4lab] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("Review Focus 3 — kỹ sư đọc một địa chỉ qua phiên ĐANG CHẠY", () => {
  it("★ stub đang chạy: good + giá trị stub; đúng 1 docLab, 0 readTags / writeTags / connect / resetAdapterSession; audit Ý ĐỊNH (lyDo) ghi TRƯỚC lượt đọc", async () => {
    H.log.length = 0;
    const truoc = await soAudit(ad.a, "scada_thu_doc_dia_chi");
    const kq = await goi(engA, ad.a);
    expect(kq).toMatchObject({ quality: "good", raw: 42, giaTri: 42, statusCode: null, reason: null });
    expect(kq.ms).toEqual(expect.any(Number));
    expect(dem(`docLab:${ad.a}`)).toBe(1);
    for (const p of ["readTags:", "writeTags:", "connect:", "resetAdapterSession:"]) expect(dem(p), p).toBe(0);
    expect(H.log).toContain(`getActiveDriver:${ad.a}`);
    expect(await soAudit(ad.a, "scada_thu_doc_dia_chi")).toBe(truoc + 1);
    const iAudit = H.log.findIndex((x) => x.startsWith(`audit-ok:scada_thu_doc_dia_chi:${ad.a}:`));
    const iDoc = H.log.indexOf(`docLab:${ad.a}`);
    expect(iAudit).toBeGreaterThanOrEqual(0);
    expect(iAudit, "audit ý định phải XONG trước lúc gọi driver").toBeLessThan(iDoc);
    const [row] = await dung(sql`SELECT reason, "afterJson" AS after, "actorId" FROM control_audit_log WHERE "entityId" = ${String(ad.a)} AND action = 'scada_thu_doc_dia_chi' ORDER BY id DESC LIMIT 1`);
    expect(row.reason).toBe("kiểm tra địa chỉ Lab");
    expect(row.after).toEqual({ address: "40001", dataType: "int", maLuot: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it("★ audit Ý ĐỊNH ném ⇒ lỗi, KHÔNG đọc (docLab 0) — và lượt ấy không giữ chỗ / không đếm (gọi lại ngay được)", async () => {
    H.log.length = 0;
    H.nemAudit = "scada_thu_doc_dia_chi";
    await expect(goi(engA, ad.a)).rejects.toThrow(/audit ép ném/);
    expect(dem("docLab:")).toBe(0);
    H.nemAudit = null;
    await expect(goi(engA, ad.a)).resolves.toMatchObject({ quality: "good" });
  });

  it("adapter nhà máy B ⇒ NOT_FOUND {entity: adapter}, 0 audit, 0 đọc; adapter KHÔNG gắn máy: chỉ admin (toàn quyền) đọc được", async () => {
    H.log.length = 0;
    const truoc = await soAudit(ad.b, "scada_thu_doc_dia_chi");
    const e = await loiCua(goi(engA, ad.b));
    expect(e).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", params: { entity: "adapter" } });
    expect(await loiCua(goi(engA, 2_000_000_000))).toEqual(e); // y hệt "không tồn tại"
    expect(await loiCua(goi(engA, ad.n))).toEqual(e);
    expect(await soAudit(ad.b, "scada_thu_doc_dia_chi")).toBe(truoc);
    expect(dem("docLab:")).toBe(0);
    await expect(goi(admin, ad.n)).resolves.toMatchObject({ quality: "good", giaTri: 42 });
  });

  it("adapter edge ⇒ adapterOwnedByEdge; adapter không chạy ⇒ adapterNotRunning; giao thức ngoài tập ⇒ protocolNotSupported — 0 đọc, 0 audit", async () => {
    H.log.length = 0;
    const a0 = (await soAudit(ad.e, "scada_thu_doc_dia_chi")) + (await soAudit(ad.off, "scada_thu_doc_dia_chi")) + (await soAudit(ad.s7a, "scada_thu_doc_dia_chi"));
    expect(await loiCua(goi(engA, ad.e))).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "OPERATION_FAILED", params: { operation: "scadaLabRead", reason: "adapterOwnedByEdge" } });
    expect(await loiCua(goi(engA, ad.off))).toMatchObject({ code: "PRECONDITION_FAILED", params: { operation: "scadaLabRead", reason: "adapterNotRunning" } });
    expect(await loiCua(goi(engA, ad.s7a))).toMatchObject({ code: "BAD_REQUEST", params: { operation: "scadaLabRead", reason: "protocolNotSupported" } });
    expect(dem("docLab:")).toBe(0);
    const a1 = (await soAudit(ad.e, "scada_thu_doc_dia_chi")) + (await soAudit(ad.off, "scada_thu_doc_dia_chi")) + (await soAudit(ad.s7a, "scada_thu_doc_dia_chi"));
    expect(a1).toBe(a0);
  });
});

describe("KD-2bA 4.1 — chuỗi thủ tục: vai admin|engineer + MOD_OT_CONTROL + machine_control.canEdit, KHÔNG 2FA", () => {
  it("★ engineer CHƯA bật 2FA (2FA bắt buộc đang BẬT) ĐƯỢC đọc; đối chứng: ketNoiLai (kySuProcedure) từ chối CÙNG người ⇒ TWO_FACTOR_NOT_SET_UP", async () => {
    await expect(goi(engKhong2fa, ad.a)).resolves.toMatchObject({ quality: "good", giaTri: 42 });
    expect(await loiCua(engKhong2fa.ketNoiLai({ adapterId: ad.a, lyDo: "đối chứng 2FA" }))).toMatchObject({ code: "FORBIDDEN", appCode: "TWO_FACTOR_NOT_SET_UP" });
  });
  it("operator (dù có canEdit) ⇒ FORBIDDEN (sàn vai); engineer THIẾU canEdit ⇒ FORBIDDEN; cả hai 0 đọc", async () => {
    H.log.length = 0;
    expect((await loiCua(goi(opA, ad.a))).code).toBe("FORBIDDEN");
    expect((await loiCua(goi(engKhongSua, ad.a))).code).toBe("FORBIDDEN");
    expect(dem("docLab:")).toBe(0);
  });
  it("input .strict(): khoá lạ / NUL / dataType lạ / lyDo < 5 ⇒ BAD_REQUEST trước mọi cổng", async () => {
    for (const x of [
      { adapterId: ad.a, address: "40001", dataType: "int", lyDo: "đủ dài lý do", scale: 2 },
      { adapterId: ad.a, address: "400\u000001", dataType: "int", lyDo: "đủ dài lý do" },
      { adapterId: ad.a, address: "40001", dataType: "json", lyDo: "đủ dài lý do" },
      { adapterId: ad.a, address: "40001", dataType: "int", lyDo: "ngắn" },
    ]) {
      expect((await loiCua(engA.thuDocDiaChi(x as never))).code).toBe("BAD_REQUEST");
    }
  });
});

describe("KD-2bA 4.7 — thứ tự cổng: phạm vi → edge → giao thức → trần → driver → audit", () => {
  it("★ hai adapter s7 (giao thức bị LOẠI): ngoài phạm vi ⇒ NOT_FOUND; trong phạm vi ⇒ protocolNotSupported; s7 + edge ⇒ adapterOwnedByEdge", async () => {
    expect(await loiCua(goi(engA, ad.s7b))).toMatchObject({ code: "NOT_FOUND", params: { entity: "adapter" } });
    expect(await loiCua(goi(engA, ad.s7a))).toMatchObject({ params: { reason: "protocolNotSupported" } });
    expect(await loiCua(goi(engA, ad.s7e))).toMatchObject({ params: { reason: "adapterOwnedByEdge" } });
  });
  it("trần đứng TRƯỚC driver: đủ trần ⇒ rateLimited dù adapter không chạy; giao thức đứng TRƯỚC trần: s7 ⇒ protocolNotSupported dù đủ trần", async () => {
    for (let i = 0; i < 10; i++) await goi(engA, ad.x);
    expect(await loiCua(goi(engA, ad.off))).toMatchObject({ code: "TOO_MANY_REQUESTS", params: { reason: "rateLimited" } });
    expect(await loiCua(goi(engA, ad.s7a))).toMatchObject({ params: { reason: "protocolNotSupported" } });
  });
});

describe("Trần — 10 lượt / phút / người (chỉ lượt được NHẬN) + 1 lượt đang bay / adapter (KD-2bA 4.4)", () => {
  it("★ lượt 11 trong 60 s ⇒ TOO_MANY_REQUESTS rateLimited, 0 audit cho lượt ấy; người khác không bị ảnh hưởng", async () => {
    for (let i = 0; i < 10; i++) await expect(goi(engA, ad.x)).resolves.toMatchObject({ quality: "good" });
    const truoc = await soAudit(ad.x, "scada_thu_doc_dia_chi");
    H.log.length = 0;
    expect(await loiCua(goi(engA, ad.x))).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "OPERATION_FAILED", params: { operation: "scadaLabRead", reason: "rateLimited" } });
    expect(await soAudit(ad.x, "scada_thu_doc_dia_chi")).toBe(truoc);
    expect(dem("docLab:")).toBe(0);
    await expect(goi(engA2, ad.x)).resolves.toMatchObject({ quality: "good" });
  });

  it("★ chỉ lượt được NHẬN mới đếm: 12 lượt bị từ chối SAU khi giữ chỗ (adapterNotRunning / audit ném) không ăn trần — 10 lượt thật vẫn qua", async () => {
    for (let i = 0; i < 6; i++) expect((await loiCua(goi(engA, ad.off))).params?.reason).toBe("adapterNotRunning");
    H.nemAudit = "scada_thu_doc_dia_chi";
    for (let i = 0; i < 6; i++) await expect(goi(engA, ad.x)).rejects.toThrow(/audit ép ném/);
    H.nemAudit = null;
    for (let i = 0; i < 10; i++) await expect(goi(engA, ad.x)).resolves.toMatchObject({ quality: "good" });
    expect((await loiCua(goi(engA, ad.x))).params?.reason).toBe("rateLimited");
  });

  it("★ driver TREO ⇒ {bad, timeout} trong < 3000 + 300 + lag; chỗ của adapter GIỮ tới khi lượt đọc THẬT xong (lượt hai ⇒ scadaLabDangBan, không đếm); xong ⇒ đọc lại được", async () => {
    let nha!: () => void;
    const treo = new Promise<void>((r) => (nha = r));
    let soGoi = 0;
    H.drivers.set(ad.h, {
      protocol: "stub",
      isConnected: () => true,
      docLab: async (tags: OtTagAddress[]): Promise<OtSample[]> => {
        soGoi += 1;
        await treo;
        return tags.map((t) => ({ tagKey: t.tagKey, raw: 1, value: 1, quality: "good" as const, timestamp: new Date() }));
      },
      readTags: async () => {
        throw new Error("Lab không được gọi readTags");
      },
      writeTags: async () => {
        throw new Error("Lab không được gọi writeTags");
      },
    });
    const lag = batDauDoLag();
    const t0 = Date.now();
    const p1 = goi(engA, ad.h);
    await vi.waitFor(() => expect(soGoi).toBe(1), { timeout: 2000, interval: 5 });
    expect(await loiCua(goi(engA2, ad.h))).toMatchObject({ code: "CONFLICT", params: { operation: "scadaLabRead", reason: "scadaLabDangBan" } });
    const kq = await p1;
    const troi = Date.now() - t0;
    expect(kq).toMatchObject({ quality: "bad", reason: "timeout", raw: null, giaTri: null });
    expect(troi).toBeGreaterThanOrEqual(mod.HAN_THU_DOC_DIA_CHI_MS - 50);
    expect(troi).toBeLessThan(mod.HAN_THU_DOC_DIA_CHI_MS + 300 + (await lag.dung(200)));
    // người gọi đã nhận timeout, lượt đọc THẬT vẫn bay ⇒ vẫn bận
    expect(await loiCua(goi(engA2, ad.h))).toMatchObject({ code: "CONFLICT", params: { reason: "scadaLabDangBan" } });
    expect(soGoi).toBe(1);
    nha();
    await vi.waitFor(() => expect(td.trangThaiThuDoc().adapterDangDoc).not.toContain(ad.h), { timeout: 2000, interval: 5 });
    await expect(goi(engA2, ad.h)).resolves.toMatchObject({ quality: "good", giaTri: 1 });
    // engA2: 2 lượt bận không đếm ⇒ 1 lượt được nhận; engA: 1
    for (let i = 0; i < 9; i++) await goi(engA2, ad.x);
    expect((await loiCua(goi(engA2, ad.x))).params?.reason).toBe("rateLimited");
  }, 15_000);
});

describe("KD-2bA 4.3 — Lab không làm lệch trạng thái dùng chung", () => {
  it("★ poll đang HỎNG (adapter 'lost' + stub lastError), Lab đọc OK ⇒ trạng thái adapter / health() / bộ đếm 1 h KHÔNG đổi", async () => {
    const s = stubs.get(ad.x)!;
    // poll hỏng: một lần đọc lỗi của driver (lastError) + trạng thái adapter RAM 'lost'
    s.simDatLoi({ treo: true });
    (s as any).timeoutMs = 20;
    await s.readTags([{ tagKey: "t1", address: "x", dataType: "int" }]);
    s.simDatLoi({ giaTri: { __lab__: 42 } });
    tt.baoTrangThaiAdapter({ adapterId: ad.x, code: `${RUN}-x`, machineId: A.mid, protocol: "stub", tags: [] } as never, "lost", "poll timeout");
    const trangThaiTruoc = JSON.stringify(tt.layTrangThaiAdapter(ad.x));
    const healthTruoc = JSON.stringify(await s.health());
    const boDemTruoc = JSON.stringify(bd.layBoDem(ad.x));
    expect(JSON.parse(healthTruoc).lastError).toBeTruthy();
    const kq = await goi(engA, ad.x);
    expect(kq).toMatchObject({ quality: "good", giaTri: 42 });
    expect(JSON.stringify(tt.layTrangThaiAdapter(ad.x))).toBe(trangThaiTruoc);
    expect(JSON.stringify(await s.health())).toBe(healthTruoc);
    expect(JSON.stringify(bd.layBoDem(ad.x))).toBe(boDemTruoc);
  });
});

describe("KD-2bA 4.5 — audit KẾT QUẢ sau lượt đọc (nền, có trần; không giá trị thô)", () => {
  it("★ có dòng scada_thu_doc_dia_chi_ket_qua (SAU dòng ý định, cùng maLuot): quality / ms / statusCode / reason — KHÔNG raw / giaTri", async () => {
    const kq = await goi(engA, ad.a);
    const [yDinh] = await dung(
      sql`SELECT id, "afterJson"->>'maLuot' AS "maLuot" FROM control_audit_log WHERE "entityId" = ${String(ad.a)} AND action = 'scada_thu_doc_dia_chi' ORDER BY id DESC LIMIT 1`,
    );
    let row: any;
    await vi.waitFor(
      async () => {
        [row] = await dung(
          sql`SELECT "afterJson" AS after, reason FROM control_audit_log WHERE "entityId" = ${String(ad.a)} AND action = 'scada_thu_doc_dia_chi_ket_qua' AND "afterJson"->>'maLuot' = ${yDinh.maLuot} AND id > ${yDinh.id}`,
        );
        expect(row).toBeDefined();
      },
      { timeout: 3000, interval: 20 },
    );
    expect(row.reason).toBeNull();
    expect(row.after).toEqual({ quality: "good", ms: kq.ms, statusCode: null, reason: null, maLuot: yDinh.maLuot });
    expect(Object.keys(row.after).sort()).toEqual(["maLuot", "ms", "quality", "reason", "statusCode"]); // không raw / giaTri
  });
  it("★ ghi audit kết quả HỎNG ⇒ kết quả trả KHÔNG đổi (good 42), lỗi được đếm / log", async () => {
    const loiTruoc = td.trangThaiThuDoc().soKetQuaLoi;
    H.nemAudit = "scada_thu_doc_dia_chi_ket_qua";
    await expect(goi(engA, ad.a)).resolves.toMatchObject({ quality: "good", raw: 42, giaTri: 42, reason: null });
    await vi.waitFor(() => expect(td.trangThaiThuDoc().soKetQuaLoi).toBe(loiTruoc + 1), { timeout: 2000, interval: 10 });
  });
});

describe("KD-2bA 4.6 — reason của driver: cắt ≤ 256 + làm sạch (không stack / host:port / đường dẫn)", () => {
  it("★ driver ném 'connect ECONNREFUSED 10.0.0.5:502' + stack ⇒ reason 'connect ECONNREFUSED <host>' (trả lời VÀ audit kết quả)", async () => {
    H.drivers.set(ad.h, {
      protocol: "stub",
      isConnected: () => true,
      docLab: async () => {
        const e = new Error("connect ECONNREFUSED 10.0.0.5:502");
        e.stack = `Error: connect ECONNREFUSED 10.0.0.5:502\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)\n    at D:\\SOURCES\\x\\y.js:1:1`;
        throw e;
      },
    });
    const kq = await goi(engA, ad.h);
    expect(kq).toMatchObject({ quality: "bad", raw: null, giaTri: null, reason: "connect ECONNREFUSED <host>" });
    await vi.waitFor(
      async () => {
        const [row] = await dung(sql`SELECT "afterJson" AS after FROM control_audit_log WHERE "entityId" = ${String(ad.h)} AND action = 'scada_thu_doc_dia_chi_ket_qua' ORDER BY id DESC LIMIT 1`);
        expect(row?.after?.reason).toBe("connect ECONNREFUSED <host>");
        expect(JSON.stringify(row.after)).not.toMatch(/10\.0\.0\.5|502|TCPConnectWrap|SOURCES/);
      },
      { timeout: 3000, interval: 20 },
    );
  });
  it("statusCode của mẫu được làm sạch + cắt; chuỗi giá trị cắt 256", async () => {
    H.drivers.set(ad.h, {
      protocol: "stub",
      isConnected: () => true,
      docLab: async (tags: OtTagAddress[]) =>
        tags.map((t) => ({ tagKey: t.tagKey, raw: "x".repeat(400), value: "y".repeat(400), quality: "uncertain" as const, timestamp: new Date(), statusCode: `read ECONNRESET plc.local:4840 ${"z".repeat(400)}`, reason: "device_error" as const })),
    });
    const kq = await goi(engA, ad.h, "40001", "string");
    expect(kq.quality).toBe("uncertain");
    expect((kq.raw as string).length).toBe(256);
    expect((kq.giaTri as string).length).toBe(256);
    expect(kq.statusCode!.length).toBeLessThanOrEqual(256);
    expect(kq.statusCode).toMatch(/^read ECONNRESET <host> z+/);
    expect(kq.reason).toBe("device_error");
  });
});

describe("HỢP ĐỒNG — hằng xuất cho B-T9", () => {
  it("HAN 3000 ms · TRAN 10 / phút · GIAO_THUC_THU_DOC = { stub, modbus, opcua }", () => {
    expect(mod.HAN_THU_DOC_DIA_CHI_MS).toBe(3000);
    expect(mod.TRAN_THU_DOC_MOI_PHUT).toBe(10);
    expect([...mod.GIAO_THUC_THU_DOC].sort()).toEqual(["modbus", "opcua", "stub"]);
  });
});
