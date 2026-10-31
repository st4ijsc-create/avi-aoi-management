/**
 * SCADA R1b-2b-2b Phần A — C2: hợp đồng `scadaDiag.tomTatTruyenThong` (chip "Truyền thông n/m") + che chi tiết kỹ thuật ở `scadaDiag.danhSach` (mục 6)
 * và ở `deviceAdapter.list|get` (`redactAdapterRow`, KD-2bA 2.1) + posture `tamKhoa` không bao giờ che (2.2).
 *
 * CSDL `_test` THẬT; phạm vi do `idsTrongPhamVi` THẬT; quyền do `checkPermission` THẬT (`permissions`). KHÔNG chạy OT ⇒ RAM trạng thái của các adapter
 * này rỗng, trạng thái hiển thị đi theo DB (`status`, `isEnabled`) qua CÙNG `trangThaiHienThi` với danhSach. Hai nhà máy A/B.
 * `../db` được bọc: khi `SPY.bat`, mỗi `select().from(bảng)` ghi tên bảng và mỗi `execute(sql)` ghi câu SQL (spy "không đọc device_tags").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `c2tt${process.pid}${Date.now().toString(36)}`;
const SPY = vi.hoisted(() => ({ bat: false, bang: [] as string[], sqlTho: [] as string[] }));
/** C2 fix 1 — supervisor HA giả (systemHealth.connectionSupervisors); phần còn lại của otManager là thật. */
const SUP = vi.hoisted(() => ({ ds: [] as Array<Record<string, unknown>> }));
/** C2 fix 2 — driver dò giả: `connect` ném lỗi socket mang host:port (như ECONNREFUSED thật) — chỉ cho giao thức modbus khi bật. */
const DO = vi.hoisted(() => ({ loi: null as string | null }));
vi.mock("../services/ot/driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/driverRegistry")>();
  return {
    ...real,
    createDriver: (p: string) => {
      if (p === "modbus" && DO.loi) {
        const loi = DO.loi;
        return { protocol: "modbus", isConnected: () => false, connect: async () => { throw new Error(loi); }, disconnect: async () => undefined } as never;
      }
      return real.createDriver(p as never);
    },
  };
});
vi.mock("../services/ot/otManager", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/otManager")>();
  return { ...real, listSupervisorStatuses: () => SUP.ds as never };
});

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  const { getTableName, is, Table } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const boc = <T extends object>(d: T): T =>
    new Proxy(d, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r);
        if (!SPY.bat) return v;
        if (p === "query") SPY.bang.push("<relational query>");
        if (typeof v !== "function") return v;
        if (p === "select" || p === "selectDistinct") {
          return (...a: unknown[]) => {
            const b = (v as (...x: unknown[]) => { from: (...x: unknown[]) => unknown }).apply(t, a);
            const from = b.from.bind(b);
            b.from = (tbl: unknown, ...rest: unknown[]) => {
              SPY.bang.push(is(tbl, Table) ? getTableName(tbl as never) : String(tbl));
              return from(tbl, ...rest);
            };
            return b;
          };
        }
        if (p === "execute") {
          return (q: unknown) => {
            try {
              SPY.sqlTho.push(dialect.sqlToQuery(q as never).sql);
            } catch {
              SPY.sqlTho.push(String(q));
            }
            return (v as (x: unknown) => unknown).call(t, q);
          };
        }
        return v;
      },
    });
  return { ...real, getDb: async () => {
    const d = await real.getDb();
    return d ? boc(d) : d;
  } };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DiagCaller = ReturnType<typeof import("./scadaDiagRouter").scadaDiagRouter.createCaller>;
type AdCaller = ReturnType<typeof import("./deviceAdapterRouter").deviceAdapterRouter.createCaller>;

let db: Db;
interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const adapterIds: number[] = [];
const factories: string[] = [];
let edgeNodeId = 0;
const ad = { conn: 0, cing: 0, lost: 0, tat: 0, edge: 0, bConn: 0, bLost: 0 };
const HOST_BI_MAT = "10.77.66.55";
const LOI_THO = `connect ECONNREFUSED ${HOST_BI_MAT}:502`;

type ShCaller = ReturnType<typeof import("./systemHealthRouter").systemHealthRouter.createCaller>;
type Nguoi = { diag: DiagCaller; ad: AdCaller; sh: ShCaller };
let viewerA!: Nguoi; // machine_monitoring.canView + machine_control.canView (không canEdit)
let operatorA!: Nguoi; // vai operator, CÓ machine_control.canEdit — vẫn bị che (vai ngoài admin/engineer)
let kySuKhongSuaA!: Nguoi; // vai engineer, machine_control.canView KHÔNG canEdit — vẫn bị che (thiếu canEdit)
let engA!: Nguoi;
let engB!: Nguoi;
let admin!: Nguoi;

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

async function seedAdapter(
  ten: string,
  machineId: number | null,
  o: { isEnabled: boolean; status: "disabled" | "connecting" | "connected" | "error"; protocol?: string; lastError?: string | null; ha?: boolean },
): Promise<number> {
  const code = `${RUN}-${ten}`;
  const protocol = o.protocol ?? "stub";
  const endpoint = protocol === "stub" ? `stub://${code}` : `tcp://${HOST_BI_MAT}:5007`;
  const opts = o.ha ? JSON.stringify({ ha: { secondaryEndpoint: `tcp://${HOST_BI_MAT}:5008` } }) : null;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "connectionOptions", "pollIntervalMs", "isEnabled", status, "lastError", "lastErrorAt")
    VALUES (${machineId}, ${code}, ${code}, ${protocol}::otprotocolenum, ${endpoint}, ${opts}::json, 60000, ${o.isEnabled}, ${o.status}::otadapterstatusenum,
            ${o.lastError ?? null}, ${o.lastError ? sql`now()` : null}) RETURNING id`);
  const id = Number(r.id);
  adapterIds.push(id);
  return id;
}

async function xoaAdapter(id: number): Promise<void> {
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${id}`);
  await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
}

async function seedNguoi(
  ten: string,
  role: "viewer" | "operator" | "engineer" | "admin",
  factoryCodes: string[],
  machineControl: "khong" | "xem" | "sua",
): Promise<Nguoi> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "c2tt", ts: RUN, ten: `C2TT ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
    if (machineControl !== "khong") {
      await dung(
        sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${machineControl === "sua"})`,
      );
    }
  }
  const ctx = { user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never;
  const { scadaDiagRouter } = await import("./scadaDiagRouter");
  const { deviceAdapterRouter } = await import("./deviceAdapterRouter");
  const { systemHealthRouter } = await import("./systemHealthRouter");
  return { diag: scadaDiagRouter.createCaller(ctx), ad: deviceAdapterRouter.createCaller(ctx), sh: systemHealthRouter.createCaller(ctx) };
}

const boTinhLuc = <T extends { tinhLuc: string }>(t: T) => {
  const { tinhLuc, ...rest } = t;
  return rest;
};

beforeAll(async () => {
  vi.stubEnv("OT_GATEWAY_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.conn = await seedAdapter("conn", A.mid, { isEnabled: true, status: "connected" });
  ad.cing = await seedAdapter("cing", A.mid, { isEnabled: true, status: "connecting" });
  ad.lost = await seedAdapter("lost", A.mid, { isEnabled: true, status: "error", lastError: LOI_THO, protocol: "modbus", ha: true });
  ad.tat = await seedAdapter("tat", A.mid, { isEnabled: false, status: "connected" }); // TẮT — không đếm dù DB nói connected
  ad.edge = await seedAdapter("edge", A.mid, { isEnabled: true, status: "error", lastError: LOI_THO });
  ad.bConn = await seedAdapter("bconn", B.mid, { isEnabled: true, status: "connected" });
  ad.bLost = await seedAdapter("blost", B.mid, { isEnabled: true, status: "error", lastError: LOI_THO });
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'c2tt edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.edge}`);
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", "isEnabled") VALUES (${ad.conn}, 't1', 'addr-t1', 'float', true)`);

  viewerA = await seedNguoi("va", "viewer", [A.code], "xem");
  operatorA = await seedNguoi("oa", "operator", [A.code], "sua");
  kySuKhongSuaA = await seedNguoi("ka", "engineer", [A.code], "xem");
  engA = await seedNguoi("ea", "engineer", [A.code], "sua");
  engB = await seedNguoi("eb", "engineer", [B.code], "sua");
  admin = await seedNguoi("ad", "admin", [], "khong");
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!db) return;
  try {
    const ids = [...adapterIds, -1];
    const ds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ds})`);
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id IN (${ds})`);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`);
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
    console.warn("[c2tt] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("scadaDiag.tomTatTruyenThong — đếm n/m theo phạm vi (HỢP ĐỒNG B-T7)", () => {
  it("kỹ sư A: 4 adapter A (connected / connecting / lost / TẮT) + 1 edge A + 2 adapter B ⇒ {ketNoi 1, dangNoi 1, mat 1, khac 0, tong 3, edge 1}", async () => {
    const t = await engA.diag.tomTatTruyenThong();
    expect(boTinhLuc(t)).toEqual({ ketNoi: 1, dangNoi: 1, mat: 1, khac: 0, tong: 3, edge: 1 });
    expect(new Date(t.tinhLuc).toISOString()).toBe(t.tinhLuc);
    // người giám sát cùng nhà máy: cùng con số (đếm không phải chi tiết kỹ thuật)
    expect(boTinhLuc(await viewerA.diag.tomTatTruyenThong())).toEqual(boTinhLuc(t));
  });

  it("kỹ sư B chỉ thấy hai adapter của B; admin (toàn quyền) đếm cả B và adapter KHÔNG gắn máy", async () => {
    expect(boTinhLuc(await engB.diag.tomTatTruyenThong())).toEqual({ ketNoi: 1, dangNoi: 0, mat: 1, khac: 0, tong: 2, edge: 0 });
    const truocAdmin = await admin.diag.tomTatTruyenThong();
    expect(truocAdmin.ketNoi).toBeGreaterThanOrEqual(2);
    expect(truocAdmin.mat).toBeGreaterThanOrEqual(2);
    const n = await seedAdapter("null", null, { isEnabled: true, status: "connected" });
    const bThem = await seedAdapter("bthem", B.mid, { isEnabled: true, status: "connecting" });
    try {
      const sauAdmin = await admin.diag.tomTatTruyenThong();
      expect(sauAdmin.ketNoi - truocAdmin.ketNoi).toBe(1); // adapter không gắn máy
      expect(sauAdmin.dangNoi - truocAdmin.dangNoi).toBe(1); // adapter B
      expect(sauAdmin.tong - truocAdmin.tong).toBe(2);
      expect(boTinhLuc(await engA.diag.tomTatTruyenThong())).toEqual({ ketNoi: 1, dangNoi: 1, mat: 1, khac: 0, tong: 3, edge: 1 });
    } finally {
      await xoaAdapter(n);
      await xoaAdapter(bThem);
    }
  });

  it("spy DB: tomTatTruyenThong KHÔNG truy vấn device_tags (đối chứng: danhSach thì có — spy bắt được)", async () => {
    SPY.bang.length = 0;
    SPY.sqlTho.length = 0;
    SPY.bat = true;
    try {
      await engA.diag.tomTatTruyenThong();
    } finally {
      SPY.bat = false;
    }
    const tomTatBang = [...SPY.bang];
    const tomTatSql = [...SPY.sqlTho];
    expect(tomTatBang).toContain("device_adapters");
    expect(tomTatBang).not.toContain("device_tags");
    expect(tomTatBang).not.toContain("<relational query>");
    for (const q of tomTatSql) expect(q).not.toMatch(/device_tags/);

    SPY.bang.length = 0;
    SPY.bat = true;
    try {
      await engA.diag.danhSach();
    } finally {
      SPY.bat = false;
    }
    expect(SPY.bang, "đối chứng: spy phải thấy device_tags của danhSach").toContain("device_tags");
  });
});

describe("scadaDiag.danhSach — endpoint / loi chỉ cho kỹ sư canEdit (mục 6, Review Focus #2)", () => {
  it("người dưới canEdit (viewer, operator CÓ canEdit, engineer KHÔNG canEdit) ⇒ endpoint === null && loi === null mọi hàng; mã lỗi đã làm sạch thay", async () => {
    for (const [ten, n] of [["viewer", viewerA], ["operator canEdit", operatorA], ["engineer không canEdit", kySuKhongSuaA]] as const) {
      const ds = await n.diag.danhSach();
      expect(ds.length, ten).toBeGreaterThanOrEqual(5);
      for (const h of ds) {
        expect(h.endpoint, `${ten} #${h.adapterId}`).toBeNull();
        expect(h.loi, `${ten} #${h.adapterId}`).toBeNull();
      }
      expect(JSON.stringify(ds), ten).not.toContain(HOST_BI_MAT);
      // vận hành vẫn biết "mất kết nối": mã nhóm, không host:port
      expect(ds.find((h) => h.adapterId === ad.lost)?.maLoi, ten).toBe("ADAPTER_OFFLINE");
      expect(ds.find((h) => h.adapterId === ad.conn)?.maLoi, ten).toBeNull();
    }
  });

  it("kỹ sư A (engineer + canEdit) và admin ⇒ endpoint / loi có giá trị thật", async () => {
    for (const n of [engA, admin]) {
      const ds = await n.diag.danhSach();
      const conn = ds.find((h) => h.adapterId === ad.conn)!;
      expect(conn.endpoint).toBe(`stub://${RUN}-conn`);
      const lost = ds.find((h) => h.adapterId === ad.lost)!;
      expect(lost.endpoint).toBe(`tcp://${HOST_BI_MAT}:5007`);
      expect(lost.loi).toBe(LOI_THO);
      expect(lost.maLoi).toBe("ADAPTER_OFFLINE");
    }
  });
});

describe("deviceAdapter.list / get — redactAdapterRow che endpoint / lastError / connectionOptions (KD-2bA 2.1)", () => {
  it("người dưới canEdit ⇒ endpoint null, connectionOptions null (ha.secondaryEndpoint), lastError = MÃ đã làm sạch; không host ở đâu cả", async () => {
    for (const [ten, n] of [["viewer", viewerA], ["operator canEdit", operatorA], ["engineer không canEdit", kySuKhongSuaA]] as const) {
      const ds = await n.ad.list();
      const cua = ds.filter((r) => adapterIds.includes(r.id));
      expect(cua.length, ten).toBeGreaterThanOrEqual(5);
      for (const r of ds) {
        expect(r.endpoint, ten).toBeNull();
        expect(r.connectionOptions, ten).toBeNull();
      }
      const lost = ds.find((r) => r.id === ad.lost)!;
      expect(lost.lastError, ten).toBe("ADAPTER_OFFLINE");
      expect(lost.maLoi, ten).toBe("ADAPTER_OFFLINE");
      expect(JSON.stringify(ds), ten).not.toContain(HOST_BI_MAT);
      const g = await n.ad.get({ id: ad.lost });
      expect(g.endpoint, ten).toBeNull();
      expect(g.lastError, ten).toBe("ADAPTER_OFFLINE");
      expect(g.connectionOptions, ten).toBeNull();
      expect(JSON.stringify(g), ten).not.toContain(HOST_BI_MAT);
    }
  });

  it("kỹ sư canEdit ⇒ endpoint / lastError / connectionOptions thật (bí mật vẫn che như trước)", async () => {
    const g = await engA.ad.get({ id: ad.lost });
    expect(g.endpoint).toBe(`tcp://${HOST_BI_MAT}:5007`);
    expect(g.lastError).toBe(LOI_THO);
    expect(g.maLoi).toBe("ADAPTER_OFFLINE");
    expect(g.connectionOptions).toEqual({ ha: { secondaryEndpoint: `tcp://${HOST_BI_MAT}:5008` } });
    expect((await engA.ad.list()).find((r) => r.id === ad.lost)?.endpoint).toBe(`tcp://${HOST_BI_MAT}:5007`);
  });
});

describe("tamKhoa (2.2) — posture MC tạm khoá: hiện với MỌI vai, kể cả vận hành; edge / không phải MC ⇒ null", () => {
  it("adapter MC trung tâm ⇒ {ma OT_MC_TAM_KHOA, lyDo errors.reason.otMcTamKhoa} ở danhSach + deviceAdapter.list/get cho viewer / operator / kỹ sư; MC edge ⇒ null", async () => {
    const mc = await seedAdapter("mc", A.mid, { isEnabled: false, status: "connected", protocol: "mitsubishi-mc" });
    const mcEdge = await seedAdapter("mcedge", A.mid, { isEnabled: false, status: "connected", protocol: "mitsubishi-mc" });
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${mcEdge}`);
    const khoa = { ma: "OT_MC_TAM_KHOA", lyDo: "errors.reason.otMcTamKhoa" };
    try {
      for (const [ten, n] of [["viewer", viewerA], ["operator", operatorA], ["kỹ sư", engA]] as const) {
        const ds = await n.diag.danhSach();
        expect(ds.find((h) => h.adapterId === mc)?.tamKhoa, `${ten} danhSach`).toEqual(khoa);
        expect(ds.find((h) => h.adapterId === mcEdge)?.tamKhoa, `${ten} danhSach edge`).toBeNull();
        expect(ds.find((h) => h.adapterId === ad.conn)?.tamKhoa, `${ten} danhSach stub`).toBeNull();
        const list = await n.ad.list();
        expect(list.find((r) => r.id === mc)?.tamKhoa, `${ten} list`).toEqual(khoa);
        expect(list.find((r) => r.id === mcEdge)?.tamKhoa, `${ten} list edge`).toBeNull();
        expect(list.find((r) => r.id === ad.conn)?.tamKhoa, `${ten} list stub`).toBeNull();
        expect((await n.ad.get({ id: mc })).tamKhoa, `${ten} get`).toEqual(khoa);
      }
      // khoá không đến từ lastError: hàng MC không có lỗi nào
      expect((await viewerA.ad.get({ id: mc })).lastError).toBeNull();
    } finally {
      await xoaAdapter(mc);
      await xoaAdapter(mcEdge);
    }
  });
});

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: unknown }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: unknown } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

describe("C2 fix 1 — deviceAdapter.update: chốt mất dữ liệu (người bị che không ghi endpoint / connectionOptions)", () => {
  it("operator CÓ canEdit (bị che): sửa tên / bật adapter ⇒ thành công (không hồi quy); gửi endpoint hoặc connectionOptions ⇒ FORBIDDEN chiTietKyThuatBiChe, hàng KHÔNG đổi", async () => {
    const id = await seedAdapter("upd", A.mid, { isEnabled: false, status: "disabled", protocol: "modbus", ha: true });
    const hang = async () => (await dung(sql`SELECT name, protocol, endpoint, "connectionOptions"::text AS co, "isEnabled", "updatedAt" FROM device_adapters WHERE id = ${id}`))[0];
    try {
      // không hồi quy: trường người bị che vẫn được sửa
      const r1 = await operatorA.ad.update({ id, name: `${RUN}-ten-moi` });
      expect(r1.name).toBe(`${RUN}-ten-moi`);
      expect(r1.endpoint).toBeNull(); // hàng trả về vẫn che
      const r2 = await operatorA.ad.update({ id, isEnabled: true, pollIntervalMs: 30000 });
      expect(r2.isEnabled).toBe(true);
      const truoc = await hang();
      expect(truoc.endpoint).toBe(`tcp://${HOST_BI_MAT}:5007`);
      // chốt: endpoint (kể cả cùng giá trị đã lưu) / connectionOptions (kể cả null) ⇒ FORBIDDEN trước mọi lượt ghi
      for (const patch of [
        { endpoint: "x" },
        { endpoint: `tcp://${HOST_BI_MAT}:5007` },
        { connectionOptions: null },
        { connectionOptions: {} },
        { name: "kem", endpoint: "tcp://h:1" },
        { protocol: "s7" }, // C2 fix 2 (review m3)
        { protocol: "modbus" }, // kể cả cùng giá trị đã lưu
        { name: "kem2", protocol: "opcua" },
      ]) {
        const e = await loiCua(operatorA.ad.update({ id, ...patch } as never));
        expect(e, JSON.stringify(patch)).toEqual({
          code: "FORBIDDEN",
          appCode: "OPERATION_FAILED",
          appParams: { operation: "deviceAdapterUpdate", reason: "chiTietKyThuatBiChe" },
        });
      }
      expect(await hang()).toEqual(truoc); // không đổi gì — kể cả name / updatedAt của lượt có "kem"
      // đối chứng: kỹ sư canEdit đổi endpoint được
      const r3 = await engA.ad.update({ id, endpoint: `tcp://${HOST_BI_MAT}:5017` });
      expect(r3.endpoint).toBe(`tcp://${HOST_BI_MAT}:5017`);
    } finally {
      await xoaAdapter(id);
    }
  });
});

describe("C2 fix 1 — systemHealth.connectionSupervisors: che activeEndpoint / lastError cùng luật", () => {
  it("người dưới canEdit ⇒ activeEndpoint null + lastError = MÃ; kỹ sư canEdit / admin ⇒ thật", async () => {
    const goc = { code: "x", protocol: "modbus", activeLabel: "primary", endpointCount: 2, reconnects: 1, failovers: 0, attempts: 3, consecutiveFailures: 1, samplesForwarded: 0, lastConnectedAt: null, lastStateChangeAt: null };
    SUP.ds = [
      { ...goc, adapterId: ad.lost, state: "reconnecting", connected: false, activeEndpoint: `tcp://${HOST_BI_MAT}:5007`, lastError: LOI_THO },
      { ...goc, adapterId: ad.conn, state: "connected", connected: true, activeEndpoint: `tcp://${HOST_BI_MAT}:5008`, lastError: null },
    ];
    try {
      for (const [ten, n] of [["viewer", viewerA], ["operator canEdit", operatorA], ["engineer không canEdit", kySuKhongSuaA]] as const) {
        const r = await n.sh.connectionSupervisors();
        expect(r.supervisors.map((x) => x.adapterId).sort(), ten).toEqual([ad.lost, ad.conn].sort());
        for (const x of r.supervisors) expect(x.activeEndpoint, ten).toBeNull();
        expect(r.supervisors.find((x) => x.adapterId === ad.lost)?.lastError, ten).toBe("ADAPTER_OFFLINE");
        expect(r.supervisors.find((x) => x.adapterId === ad.conn)?.lastError, ten).toBeNull();
        expect(JSON.stringify(r), ten).not.toContain(HOST_BI_MAT);
      }
      for (const n of [engA, admin]) {
        const r = await n.sh.connectionSupervisors();
        const lost = r.supervisors.find((x) => x.adapterId === ad.lost)!;
        expect(lost.activeEndpoint).toBe(`tcp://${HOST_BI_MAT}:5007`);
        expect(lost.lastError).toBe(LOI_THO);
      }
    } finally {
      SUP.ds = [];
    }
  });
});

describe("C2 fix 2 — deviceAdapter.testConnection({id}): văn bản lỗi driver (host:port) chỉ cho kỹ sư canEdit", () => {
  it("người dưới canEdit ⇒ ok:false + errorCode/errorParams, KHÔNG có khoá error, KHÔNG có '10.0.0.5' / ':502' ở đâu; kỹ sư canEdit / admin ⇒ văn bản đầy đủ; nhánh {protocol, endpoint} giữ văn bản", async () => {
    const LOI = "connect ECONNREFUSED 10.0.0.5:502";
    const id = await seedAdapter("probe", A.mid, { isEnabled: false, status: "disabled", protocol: "modbus" });
    DO.loi = LOI;
    try {
      for (const [ten, n] of [["viewer", viewerA], ["operator canEdit", operatorA], ["engineer không canEdit", kySuKhongSuaA]] as const) {
        const r = await n.ad.testConnection({ id });
        expect(r, ten).toMatchObject({ ok: false, errorCode: "DEVICE_UNREACHABLE", errorParams: { entity: "modbus" } });
        expect("error" in r, ten).toBe(false); // khoá vắng hẳn (không phải chuỗi rỗng / null)
        const j = JSON.stringify(r);
        expect(j, ten).not.toContain("10.0.0.5");
        expect(j, ten).not.toContain(":502");
        expect(j, ten).not.toContain(HOST_BI_MAT);
      }
      for (const n of [engA, admin]) {
        expect(await n.ad.testConnection({ id })).toMatchObject({ ok: false, errorCode: "DEVICE_UNREACHABLE", error: LOI });
      }
      // nhánh tự gõ: người gọi đã biết endpoint ⇒ văn bản thô được giữ (kể cả viewer)
      expect(await viewerA.ad.testConnection({ protocol: "modbus", endpoint: "tcp://10.0.0.5:502" })).toMatchObject({ ok: false, error: LOI });
    } finally {
      DO.loi = null;
      await xoaAdapter(id);
    }
  });
});
