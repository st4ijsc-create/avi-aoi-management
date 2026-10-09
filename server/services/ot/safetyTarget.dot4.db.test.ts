/**
 * doc 81 Đợt 4 Task A1 — safety-PLC config THEO ĐÍCH (ruling R-4-c). CSDL THẬT `_test`.
 *
 * Trước: getSafetyStatus đọc MỌI cấu hình bật ⇒ một PLC thật offline ở chuyền 2 chặn mọi lệnh thật ở
 * chuyền 1 (R-1C-b, "CÒN MỞ"). Nay: chỉ cấu hình của đích + cấu hình không gắn đích; đích không phân giải
 * được ⇒ MỌI cấu hình (fail-closed, không bao giờ ít hơn trước).
 *
 * Thật: hàng factories/workshops/production_lines/stations/machines/robots/device_adapters/safety_plc_configs
 * trong `_test`; `listPlcConfigs` THẬT (chỉ LỌC THÊM theo tiền tố mã của tệp này — `safety_plc_configs` của
 * `_test` dùng chung với tệp chạy song song); `backendForConfig` THẬT → ModbusDriver THẬT nói với một PLC an
 * toàn GIẢ trong tiến trình (`ServerTCP` của modbus-serial, 127.0.0.1 cổng 0, đóng ở afterAll). PLC "offline"
 * = cổng đã đóng (ECONNREFUSED). Robot: dispatchRobotJob THẬT, driver giả ĐẾM runJob (oracle).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import postgres from "postgres";
import * as ModbusSerialNs from "modbus-serial";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const h = vi.hoisted(() => ({
  dau: `D4A1-${Date.now()}`,
  readCodes: [] as string[],
  robots: new Map<number, unknown>(),
}));

vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    listPlcConfigs: async (f: Parameters<typeof orig.listPlcConfigs>[0]) =>
      (await orig.listPlcConfigs(f)).filter((c) => c.code.startsWith(h.dau)),
    backendForConfig: (cfg: Parameters<typeof orig.backendForConfig>[0]) => {
      h.readCodes.push(cfg.code);
      return orig.backendForConfig(cfg);
    },
  };
});
vi.mock("../robot/robotManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/robotManager")>();
  return {
    ...orig,
    getActiveRobot: (id: number) => (h.robots.has(id) ? { driver: h.robots.get(id) } : undefined),
  };
});

import { createAdapterFacade } from "./adapterFacade";
import { resolveSafetyTarget } from "./safetyTarget";
import { createModbusDriver } from "./drivers/modbusDriver";
import { registerDriver } from "./driverRegistry";
import { dispatchRobotJob } from "../robot/robotCommandDispatcher";
import { loadSafetySourceHealth } from "../safety/safetySourceHealth";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;
const DB_URL = process.env.DATABASE_URL;
const DAU = h.dau;
const OWNER = 990_840_101;
const UNKNOWN_MACHINE = 2_000_000_000;

async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what}: không trả về trong ${ms} ms (treo)`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line1: 0, line2: 0, st1: 0, st2: 0, m1: 0, m2: 0, adapter1: 0, r1: 0, rUnplaced: 0, rContra: 0, rLineOnly: 0 };
const pl = { port: 0, closed: 0, close: async () => undefined as unknown };
let seq = 0;

type Target = { robotId?: number; stationId?: number; lineId?: number; factoryId?: number };
const ESTOP = { estop: { address: "coil:1", dataType: "bool" } };
const clean = () => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${pl.port}`, statusMap: ESTOP });
const offline = () => ({ backend: "modbus", endpoint: `tcp://127.0.0.1:${pl.closed}`, statusMap: ESTOP });
const simEstop = () => ({ backend: "sim", endpoint: null, statusMap: { simScript: [{ estop: true }] } });

/** Insert configs for ONE case, run, delete. Returns codes in insertion order. */
async function withConfigs<T>(rows: Array<{ cfg: { backend: string; endpoint: string | null; statusMap: unknown }; t?: Target }>, fn: (codes: string[]) => Promise<T>): Promise<T> {
  const made: number[] = [];
  const codes: string[] = [];
  try {
    for (const r of rows) {
      const code = `${DAU}-${++seq}`;
      const [x] = await sql`
        INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, "robotId", "stationId", "lineId", "factoryId")
        VALUES (${code}, 'Đợt 4 A1', 'generic', ${r.cfg.backend}, ${r.cfg.endpoint}, ${sql.json(r.cfg.statusMap as never)}, true,
                ${r.t?.robotId ?? null}, ${r.t?.stationId ?? null}, ${r.t?.lineId ?? null}, ${r.t?.factoryId ?? null})
        RETURNING id`;
      made.push(Number(x.id));
      codes.push(code);
    }
    return await fn(codes);
  } finally {
    if (made.length) await sql`DELETE FROM safety_plc_configs WHERE id IN ${sql(made)}`;
  }
}

const real = (ctx: { adapterId?: number; machineId?: number | null; robotId?: number | null }) =>
  within(createAdapterFacade({ adapterId: ctx.adapterId ?? -1, machineId: ctx.machineId ?? null, robotId: ctx.robotId ?? null }).getSafetyStatus({ forRealActuation: true }), 20_000, "facade");
const legacy = (ctx: { adapterId?: number; machineId?: number | null; robotId?: number | null }) =>
  within(createAdapterFacade({ adapterId: ctx.adapterId ?? -1, machineId: ctx.machineId ?? null, robotId: ctx.robotId ?? null }).getSafetyStatus(), 20_000, "facade legacy");

let robotRuns = 0;
const fakeRobotDriver = {
  vendor: "sim",
  isConnected: () => true,
  runJob: async () => {
    robotRuns++;
    return { ok: true, status: "done", detail: { fake: true } };
  },
  abort: async () => undefined,
  health: async () => ({ vendor: "sim", connected: true }),
};

const ENV_KEYS = ["SAFETY_PLC_ADAPTER_ENABLED", "ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_SAFETY_PREFLIGHT_ENABLED", "ROBOT_CONTROL_TIMEOUT_MS", "SEC_PLATFORM", "FIELD_V2_ENABLED", "OT_CONTROL_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task A1 — safety-PLC config theo đích (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ DB dev
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("../safety/plc/safetyPlcAdapter");
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    registerDriver("modbus", createModbusDriver);

    pl.port = await freePort();
    pl.closed = await freePort();
    const vector = {
      getCoil: () => false,
      getDiscreteInput: () => false,
      getHoldingRegister: () => 0,
      getInputRegister: () => 0,
      setRegister: () => undefined,
      setCoil: () => undefined,
    };
    const srv = new ServerTCP(vector, { host: "127.0.0.1", port: pl.port, unitID: 1 });
    await new Promise<void>((resolve, reject) => {
      srv.once("initialized", () => resolve());
      srv.once("serverError", reject);
    });
    pl.close = () => new Promise<void>((resolve) => srv.close(() => resolve()));

    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + DAU}, 'A1 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + DAU}, 'A1 ws') RETURNING id`);
    ids.line1 = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L1-" + DAU}, 'A1 line 1') RETURNING id`);
    ids.line2 = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L2-" + DAU}, 'A1 line 2') RETURNING id`);
    ids.st1 = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line1}, ${"S1-" + DAU}, 'A1 st 1') RETURNING id`);
    ids.st2 = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line2}, ${"S2-" + DAU}, 'A1 st 2') RETURNING id`);
    ids.m1 = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st1}, ${"M1-" + DAU}, 'A1 m1', 'AOI', true) RETURNING id`);
    ids.m2 = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st2}, ${"M2-" + DAU}, 'A1 m2', 'AOI', true) RETURNING id`);
    ids.adapter1 = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${"A-" + DAU}, 'A1 adapter', 'stub', 'stub://a1', true, ${ids.m1}) RETURNING id`);
    const robot = (suffix: string, lineId: number | null, stationId: number | null) =>
      one(sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId", "stationId") VALUES (${`R${suffix}-${DAU}`}, 'A1 robot', 'sim', 'sim://a1', ${lineId}, ${stationId}) RETURNING id`);
    ids.r1 = await robot("1", ids.line1, ids.st1);
    ids.rUnplaced = await robot("U", null, null);
    ids.rContra = await robot("C", ids.line2, ids.st1); // trạm thuộc chuyền 1 nhưng robot khai chuyền 2
    ids.rLineOnly = await robot("L", ids.line1, null);
    h.robots.set(ids.r1, fakeRobotDriver);
  });

  afterAll(async () => {
    h.robots.clear();
    try {
      await pl.close();
    } catch {
      /* ignore */
    }
    if (sql) {
      const robots = [ids.r1, ids.rUnplaced, ids.rContra, ids.rLineOnly].filter(Boolean);
      await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${DAU + "%"}`;
      if (robots.length) {
        await sql`DELETE FROM robot_jobs WHERE "robotId" IN ${sql(robots)}`.catch(() => undefined);
        await sql`DELETE FROM robots WHERE id IN ${sql(robots)}`;
      }
      if (ids.adapter1) await sql`DELETE FROM device_adapters WHERE id = ${ids.adapter1}`;
      await sql`DELETE FROM machines WHERE id IN ${sql([ids.m1, ids.m2].filter(Boolean))}`;
      await sql`DELETE FROM stations WHERE id IN ${sql([ids.st1, ids.st2].filter(Boolean))}`;
      await sql`DELETE FROM production_lines WHERE id IN ${sql([ids.line1, ids.line2].filter(Boolean))}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
      const [left] = await sql`SELECT count(*)::int AS n FROM safety_plc_configs WHERE code LIKE ${DAU + "%"}`;
      expect(left.n).toBe(0);
      await sql.end();
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    h.readCodes.length = 0;
    robotRuns = 0;
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    for (const k of ["SEC_PLATFORM", "FIELD_V2_ENABLED", "ROBOT_SAFETY_PREFLIGHT_ENABLED"]) delete process.env[k];
  });

  // ── 0. bộ phân giải đích ─────────────────────────────────────────────────────────────
  it("resolveSafetyTarget: máy ⇒ trạm/chuyền/nhà máy; adapter ⇒ máy của nó; robot ⇒ chuyền/trạm; không phân giải được ⇒ null", async () => {
    expect(await resolveSafetyTarget({ machineId: ids.m1 })).toEqual({ robotId: null, machineId: ids.m1, stationId: ids.st1, lineId: ids.line1, factoryId: ids.factory });
    expect(await resolveSafetyTarget({ adapterId: ids.adapter1, machineId: null })).toEqual({ robotId: null, machineId: ids.m1, stationId: ids.st1, lineId: ids.line1, factoryId: ids.factory });
    expect(await resolveSafetyTarget({ adapterId: -1, robotId: ids.r1 })).toEqual({ robotId: ids.r1, machineId: null, stationId: ids.st1, lineId: ids.line1, factoryId: ids.factory });
    expect(await resolveSafetyTarget({ robotId: ids.rLineOnly })).toEqual({ robotId: ids.rLineOnly, machineId: null, stationId: null, lineId: ids.line1, factoryId: ids.factory });
    expect(await resolveSafetyTarget({ machineId: UNKNOWN_MACHINE })).toBeNull();
    expect(await resolveSafetyTarget({ robotId: ids.rUnplaced })).toBeNull();
    expect(await resolveSafetyTarget({ robotId: ids.rContra })).toBeNull();
    expect(await resolveSafetyTarget({ adapterId: -1, machineId: null, robotId: null })).toBeNull();
    expect(await resolveSafetyTarget({ machineId: ids.m1, robotId: ids.r1 })).toBeNull();
  });

  // ── 1. ca chính của brief ────────────────────────────────────────────────────────────
  it("★ PLC thật OFFLINE ở chuyền 2 KHÔNG chặn lệnh thật ở chuyền 1 (máy, adapter, robot); vẫn chặn chuyền 2", async () => {
    await withConfigs(
      [
        { cfg: clean(), t: { lineId: ids.line1, factoryId: ids.factory } },
        { cfg: offline(), t: { lineId: ids.line2, factoryId: ids.factory } },
      ],
      async ([c1, c2]) => {
        expect((await real({ machineId: ids.m1 })).state).toBe("OK");
        expect(h.readCodes).toEqual([c1]); // cấu hình chuyền 2 KHÔNG được đọc
        expect((await real({ adapterId: ids.adapter1, machineId: null })).state).toBe("OK");
        expect((await real({ robotId: ids.r1 })).state).toBe("OK");
        expect((await real({ machineId: ids.m2 })).state).toBe("UNKNOWN");
        h.readCodes.length = 0;
        await real({ machineId: ids.m2 });
        expect(h.readCodes).toEqual([c2]);
      },
    );
  });

  it("★ cấu hình KHÔNG gắn đích vẫn chặn MỌI đích (thật offline ⇒ UNKNOWN; SIM estop ⇒ BLOCKED cả đường cũ)", async () => {
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline() }], async () => {
      expect((await real({ machineId: ids.m1 })).state).toBe("UNKNOWN");
      expect((await real({ robotId: ids.r1 })).state).toBe("UNKNOWN");
      expect((await real({ machineId: ids.m2 })).state).toBe("UNKNOWN");
    });
    await withConfigs([{ cfg: simEstop() }], async () => {
      for (const ctx of [{ machineId: ids.m1 }, { machineId: ids.m2 }, { robotId: ids.r1 }]) {
        expect((await legacy(ctx)).state).toBe("BLOCKED");
        expect((await real(ctx)).state).toBe("BLOCKED");
      }
    });
  });

  it("★ đích KHÔNG phân giải được ⇒ MỌI cấu hình áp dụng (máy lạ, robot chưa đặt vị trí, robot vị trí mâu thuẫn, không đích)", async () => {
    await withConfigs(
      [
        { cfg: clean(), t: { lineId: ids.line1 } },
        { cfg: offline(), t: { lineId: ids.line2 } },
      ],
      async (codes) => {
        for (const ctx of [{ machineId: UNKNOWN_MACHINE }, { robotId: ids.rUnplaced }, { robotId: ids.rContra }, {}]) {
          h.readCodes.length = 0;
          expect((await real(ctx)).state).toBe("UNKNOWN");
          expect([...h.readCodes].sort()).toEqual([...codes].sort());
        }
      },
    );
    // đường cũ (cổng AI): SIM estop gắn chuyền 2 ⇒ đích lạ vẫn BLOCKED, máy chuyền 1 thì không.
    await withConfigs([{ cfg: simEstop(), t: { lineId: ids.line2 } }], async () => {
      expect((await legacy({ machineId: UNKNOWN_MACHINE })).state).toBe("BLOCKED");
      expect((await legacy({ machineId: ids.m1 })).state).toBe("UNKNOWN"); // 0 cấu hình áp dụng ⇒ UNKNOWN (không bịa OK)
      expect((await legacy({ machineId: ids.m2 })).state).toBe("BLOCKED");
    });
  });

  it("trạm / nhà máy / robot: cột cụ thể NHẤT quyết định; robot chỉ đặt ở chuyền ⇒ mọi cấu hình trạm áp dụng", async () => {
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline(), t: { stationId: ids.st2, lineId: ids.line2 } }], async () => {
      expect((await real({ machineId: ids.m1 })).state).toBe("OK");
      expect((await real({ machineId: ids.m2 })).state).toBe("UNKNOWN");
      expect((await real({ robotId: ids.rLineOnly })).state).toBe("UNKNOWN"); // trạm không loại trừ được
    });
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline(), t: { factoryId: ids.factory } }], async () => {
      expect((await real({ machineId: ids.m1 })).state).toBe("UNKNOWN");
      expect((await real({ robotId: ids.r1 })).state).toBe("UNKNOWN");
    });
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline(), t: { factoryId: ids.factory + 1_000_000 } }], async () => {
      expect((await real({ machineId: ids.m1 })).state).toBe("OK");
    });
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline(), t: { robotId: ids.r1, lineId: ids.line1 } }], async () => {
      expect((await real({ robotId: ids.r1 })).state).toBe("UNKNOWN");
      expect((await real({ machineId: ids.m1 })).state).toBe("OK"); // cấu hình của robot không phải của máy
    });
  });

  // ── 2. đường robot THẬT ──────────────────────────────────────────────────────────────
  it("★ dispatchRobotJob: robot chuyền 1 CHẠY khi PLC chuyền 2 offline (driver 1 lần); robot chuyền 2 không có ⇒ đích lạ vẫn chặn", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const run = (robotId: number) =>
      within(
        dispatchRobotJob({
          robotId,
          job: { jobType: "home", params: {} },
          triggerKind: "manual",
          requestedBy: OWNER,
          confirmedBy: OWNER,
          idempotencyKey: `${DAU}-rb-${++seq}`,
        }),
        20_000,
        "robot dispatch",
      );
    await withConfigs(
      [
        { cfg: clean(), t: { lineId: ids.line1 } },
        { cfg: offline(), t: { lineId: ids.line2 } },
      ],
      async () => {
        const ok = await run(ids.r1);
        expect(ok.status).not.toBe("rejected");
        expect(robotRuns).toBe(1);
      },
    );
    await withConfigs([{ cfg: clean(), t: { lineId: ids.line1 } }, { cfg: offline() }], async () => {
      const no = await run(ids.r1);
      expect(no.status).toBe("rejected");
      expect(no.error).toBe("SAFETY_UNKNOWN");
      expect(robotRuns).toBe(1); // không thêm lần nào
    });
  });

  // ── 3. bảng nguồn an toàn dự đoán bằng CÙNG bộ so khớp + CÙNG bộ phân giải ──────────
  it("★ loadSafetySourceHealth(viewer, đích) liệt kê ĐÚNG tập cấu hình cổng đọc cho đích đó", async () => {
    await withConfigs(
      [
        { cfg: clean(), t: { lineId: ids.line1, factoryId: ids.factory } },
        { cfg: offline(), t: { lineId: ids.line2, factoryId: ids.factory } },
        { cfg: offline(), t: { stationId: ids.st1, factoryId: ids.factory } },
      ],
      async () => {
        for (const ref of [{ machineId: ids.m1 }, { machineId: ids.m2 }, { robotId: ids.r1 }, { robotId: ids.rUnplaced }, { machineId: UNKNOWN_MACHINE }]) {
          h.readCodes.length = 0;
          await real(ref);
          const gate = [...h.readCodes].sort();
          const panel = await loadSafetySourceHealth({ userId: 1, userRole: "admin" }, { adapterId: -1, ...ref });
          const shown = panel.safetyPlc.configs.map((c) => c.code).filter((c) => c.startsWith(DAU)).sort();
          expect(shown).toEqual(gate);
        }
      },
    );
  });
});
