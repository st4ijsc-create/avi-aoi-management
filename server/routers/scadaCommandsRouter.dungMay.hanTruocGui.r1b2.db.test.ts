/**
 * SCADA R1b-2a Task 4 (§10 mục 11, M-1; ruling K5/K6/K7, điều phối Q4; Review Focus 5) — HẠN THẬT cho pha TRƯỚC-GỬI của STOP HMI, trên
 * CSDL `_test` THẬT: router tRPC THẬT → `lenhHmi.dungMayHmi` → `dispatch()` THẬT → StubDriver THẬT (RAM).
 *
 * "DB chậm-mà-sống" được dựng bằng hai cách, KHÔNG nới mã sản phẩm:
 *   · `loadStopPinsHmi` (callee THẬT của dungMay — ruling K5) bọc chờ N ms rồi gọi bản thật (vi.mock importOriginal), theo adapter;
 *   · `checkPermission` (cổng vai, pha CHUNG) bọc chờ tương tự;
 *   · lượt chèn dòng chờ của MỘT adapter bị CHẶN THẬT ở Postgres: một giao dịch khác giữ (chưa commit) một hàng ai_pending_actions cùng
 *     `idempotencyKey` ⇒ INSERT của dungMay đợi khoá chỉ mục unique tới khi giao dịch kia rollback (3 s).
 *   · `dispatch` bọc chờ 2,5 s rồi gọi bản thật — chứng minh dispatch NGOÀI ngân sách (Q4: đã gửi thì không bao giờ từ chối vì hạn).
 * Đồng hồ THẬT (K15: mỗi ca < 10 s — ca dài nhất ~3 s; không có cờ opt-in vì không ca nào vượt trần).
 *
 * Oracle độc lập: lô ghi StubDriver NHẬN theo adapter, số lần dispatch theo adapter, `scada_command_attempts` (WORM) của người dùng tệp,
 * `control_audit_log` action scada_hmi_stop. `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9); AI_OT_CONTROL_ENABLED không đụng.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, count, eq, isNull, sql } from "drizzle-orm";

const RUN = `r1b2t4${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  dispatchInputs: [] as Array<{ adapterId: number; at: number }>,
  /** ms chờ trước khi gọi dispatch thật (0 = không chờ) */
  dispatchCho: 0,
  /** adapterId ⇒ ms chờ trước khi gọi loadStopPinsHmi thật */
  ghimCho: new Map<number, number>(),
  /** ms chờ trước checkPermission thật (0 = không chờ) */
  quyenCho: 0,
  /** fix round 1 — ms chờ trước idsTrongPhamVi thật (hết hạn TRƯỚC kiểm phạm vi ⇒ daXacMinhPhamVi false) */
  phamViCho: 0,
  /** fix round 1 (I-1) — ms chờ trước phaiDoiMatKhau thật (cổng đổi mật khẩu, middleware gốc) */
  matKhauCho: 0,
  /** final-fix M-1 — true ⇒ lượt chèn dòng scada_command_attempts mã STOP_QUA_HAN NÉM (giả reset kết nối); dòng khác đi thật */
  hongGhiQuaHan: false,
  /** bảng scada_command_attempts (gán ở beforeAll — so sánh danh tính trong proxy getDb) */
  bangThu: null as unknown,
}));

const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });

vi.mock("../services/ot/stopPin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/stopPin")>();
  return {
    ...real,
    loadStopPinsHmi: (async (...a: Parameters<typeof real.loadStopPinsHmi>) => {
      const ms = H.ghimCho.get(a[1]) ?? 0;
      if (ms > 0) await cho(ms);
      return real.loadStopPinsHmi(...a);
    }) as typeof real.loadStopPinsHmi,
  };
});

vi.mock("../_core/accessControl", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/accessControl")>();
  return {
    ...real,
    checkPermission: (async (...a: Parameters<typeof real.checkPermission>) => {
      if (H.quyenCho > 0) await cho(H.quyenCho);
      return real.checkPermission(...a);
    }) as typeof real.checkPermission,
  };
});

vi.mock("../db/hierarchy", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/hierarchy")>();
  return {
    ...real,
    idsTrongPhamVi: (async (...a: Parameters<typeof real.idsTrongPhamVi>) => {
      if (H.phamViCho > 0) await cho(H.phamViCho);
      return real.idsTrongPhamVi(...a);
    }) as typeof real.idsTrongPhamVi,
  };
});

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return {
    ...real,
    phaiDoiMatKhau: (async (...a: Parameters<typeof real.phaiDoiMatKhau>) => {
      if (H.matKhauCho > 0) await cho(H.matKhauCho);
      return real.phaiDoiMatKhau(...a);
    }) as typeof real.phaiDoiMatKhau,
  };
});

// final-fix M-1 — DB "sống nhưng ghi sổ hỏng": getDb THẬT bọc proxy; chỉ khi H.hongGhiQuaHan thì INSERT dòng attempts STOP_QUA_HAN ném.
vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  const boc = (d: any) =>
    new Proxy(d, {
      get(t, p) {
        if (p === "insert") {
          return (bang: unknown) => {
            const q = t.insert(bang);
            if (!H.hongGhiQuaHan || bang !== H.bangThu) return q;
            return {
              values: (v: { reasonCode?: string | null }) =>
                v?.reasonCode === "STOP_QUA_HAN" ? Promise.reject(new Error("ECONNRESET giả (final-fix M-1)")) : q.values(v),
            };
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === "function" && p !== "constructor" ? v.bind(t) : v;
      },
    });
  return {
    ...real,
    getDb: (async (...a: Parameters<typeof real.getDb>) => {
      const d = await real.getDb(...a);
      return d ? boc(d) : d;
    }) as typeof real.getDb,
  };
});

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      H.dispatchInputs.push({ adapterId: (a[0] as { adapterId: number }).adapterId, at: Date.now() });
      if (H.dispatchCho > 0) await cho(H.dispatchCho);
      return real.dispatch(...a);
    },
  };
});

vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return { ...real, getIO: () => ({ to: () => ({ emit: () => true }) }) as never };
});

vi.mock("../services/safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [
      { code: "R1B2T4-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

vi.mock("../services/ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});

vi.mock("../services/robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: async () => undefined }));

import { getDb } from "../db/connection";
import { aiPendingActions, scadaCommandAttempts } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { adapterTargetFingerprint } from "../services/ot/adapterTarget";
import { dieuKienThuStopQuaHan, HAN_TRUOC_GUI_STOP_HMI_MS, hanChotTruocGuiStopHmi, MA_STOP_QUA_HAN } from "../services/scada/lenhHmi";
import { sdk } from "../_core/sdk";
import { createContext } from "../_core/context";
import { _datLaiDemStopQuaHanChoTest, demStopQuaHanKhongGhiSo, HAN_TONG_STOP_HMI_MS } from "../_core/hanStopHmi";
import { batDauDoLag } from "../testing/doLagBucleSuKien";

class StubGhi extends StubDriver {
  ghi: Array<Array<{ tagKey: string; value: unknown }>> = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
let boDem: typeof import("../services/scada/boDemHienTai");

const fx = { fCode: "", sid: 0, m1: 0, m2: 0, a1: 0, a2a: 0, a2b: 0, fCodeB: "", mB: 0 };
const stub: Record<"a1" | "a2a" | "a2b", StubGhi> = {} as never;
const userIds: number[] = [];
let op: { id: number; caller: Caller };

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}
async function seedAdapter(mid: number, ma: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled') RETURNING id`);
  return Number(r.id);
}
/** tag ghim DỪNG (bool true) mức tác động 1 — đúng thứ STOP HMI gửi; `kenhCheDo` ⇒ tag kênh chế độ (int, chỉ đọc, không ghim) */
async function seedTag(adapterId: number, key: string, o: { kenhCheDo?: boolean } = {}): Promise<void> {
  if (o.kenhCheDo) {
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
      VALUES (${adapterId}, ${key}, ${"M." + key}, 'int', false, true, 'input'::scada_channel_kind)`);
    return;
  }
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
    VALUES (${adapterId}, ${key}, ${"M." + key}, 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
}

type Loi = { code?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}
const uuid = () => crypto.randomUUID();
async function moc(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}
async function mocAudit(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
  return Number(r.m);
}
type DongThu = { adapter_id: number | null; stage: string; outcome: string; reason_code: string | null; requested_value: any; ly_do: string | null };
async function thuSau(m: number): Promise<DongThu[]> {
  return (await dung(sql`SELECT adapter_id, stage, outcome, reason_code, requested_value, ly_do FROM scada_command_attempts
    WHERE id > ${m} AND user_id = ${op.id} ORDER BY id`)) as DongThu[];
}
/** dòng attempts ghi FIRE-AND-FORGET ⇒ chờ (có hạn) tới khi đủ `n` dòng STOP_QUA_HAN */
async function choThuQuaHan(m: number, n: number): Promise<DongThu[]> {
  let rows: DongThu[] = [];
  await vi.waitFor(
    async () => {
      rows = (await thuSau(m)).filter((r) => r.reason_code === MA_STOP_QUA_HAN);
      if (rows.length < n) throw new Error("attempts STOP_QUA_HAN chưa ghi");
    },
    { timeout: 5_000, interval: 50 },
  );
  return rows;
}
async function choAuditQuaHan(idMoc: number, machineId: number, clientRequestId: string, entityType: "machine" | "user" = "machine") {
  let rows: Array<{ afterJson: any; actorId: number }> = [];
  await vi.waitFor(
    async () => {
      rows = ((await dung(sql`SELECT "afterJson", "actorId" FROM control_audit_log WHERE id > ${idMoc} AND action = 'scada_hmi_stop'
        AND "entityType" = ${entityType} AND "entityId" = ${String(machineId)} ORDER BY id`)) as typeof rows).filter((r) => r.afterJson?.clientRequestId === clientRequestId);
      if (rows.length < 1) throw new Error("audit chưa ghi");
    },
    { timeout: 5_000, interval: 50 },
  );
  return rows;
}
const soDispatch = (adapterId: number, tu = 0) => H.dispatchInputs.slice(tu).filter((d) => d.adapterId === adapterId).length;

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
  vi.stubEnv("OT_READBACK_ENABLED", "false"); // dungMay vẫn đọc lại (docLai bat_buoc)
  vi.stubEnv("OT_CMD_SERIALIZE_ENABLED", "false");
  vi.stubEnv("SEC_PLATFORM", "false");
  vi.stubEnv("UNS_CMD_ACK_ENABLED", "false");
  vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));
  boDem = await import("../services/scada/boDemHienTai");

  const code = `${RUN}f`;
  fx.fCode = code;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  fx.sid = Number(s.id);
  const [m1] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + "m1"}, 'May T4-1', 'AOI', true) RETURNING id`);
  const [m2] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${fx.sid}, ${RUN + "m2"}, 'May T4-2', 'AOI', true) RETURNING id`);
  fx.m1 = Number(m1.id);
  fx.m2 = Number(m2.id);
  H.bangThu = scadaCommandAttempts;
  // final-fix M-3 — nhà máy B (người dùng tệp KHÔNG được gán): một máy, không adapter
  const codeB = `${RUN}b`;
  fx.fCodeB = codeB;
  const [fB] = await dung(sql`INSERT INTO factories (code, name) VALUES (${codeB}, ${codeB + " f"}) RETURNING id`);
  const [wB] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fB.id}, ${codeB}, ${codeB + " w"}) RETURNING id`);
  const [lB] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wB.id}, ${codeB}, ${codeB + " l"}) RETURNING id`);
  const [sB] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lB.id}, ${codeB}, ${codeB + " s"}) RETURNING id`);
  const [mB] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sB.id}, ${RUN + "mB"}, 'May T4-B', 'AOI', true) RETURNING id`);
  fx.mB = Number(mB.id);

  // M1: máy REMOTE (kênh chế độ khai, mẫu = giá trị REMOTE), MỘT adapter có ghim mức 1
  fx.a1 = await seedAdapter(fx.m1, "a1");
  await seedTag(fx.a1, "che_do", { kenhCheDo: true });
  await seedTag(fx.a1, "stop_cmd");
  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${fx.m1}, ${fx.a1}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(fx.a1, { pollMs: 60_000, coDeadband: false, machineId: fx.m1, code: `${RUN}-a1` });
  boDem.napTuOt({ adapterId: fx.a1, machineId: fx.m1 }, [{ tagKey: "che_do", raw: 2, value: 2, quality: "good" as const, timestamp: new Date() }]);
  // M2: HAI adapter, mỗi adapter một ghim mức 1
  fx.a2a = await seedAdapter(fx.m2, "a2a");
  fx.a2b = await seedAdapter(fx.m2, "a2b");
  await seedTag(fx.a2a, "stop_cmd");
  await seedTag(fx.a2b, "stop_cmd");

  for (const k of ["a1", "a2a", "a2b"] as const) {
    stub[k] = new StubGhi();
    await stub[k].connect({ endpoint: `stub://${RUN}-${k}` } as never);
    H.drivers.set(fx[k], stub[k]);
    const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${fx[k]}`);
    H.fingerprints.set(
      fx[k],
      adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
    );
  }

  const u = await taoNguoiDungTest("opT4", "operator", { tienTo: "r1b2t4", ts: RUN, ten: "R1B2 T4 op" });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  op = { id: u.id, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role: "operator", name: u.name, twoFactorEnabled: false } } as never) };
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const k of ["a1", "a2a", "a2b"] as const) {
    try {
      boDem?.xoaAdapter(fx[k]);
      await stub[k]?.disconnect();
    } catch {
      /* bỏ qua */
    }
  }
  if (!db) return;
  try {
    // chờ mọi truy vấn bị bỏ rơi (chạy nền sau hạn) xong trước khi dọn
    await cho(1_500);
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
    await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${fx.m1}`);
    for (const id of [fx.a1, fx.a2a, fx.a2b].filter(Boolean)) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM machines WHERE code IN (${RUN + "m1"}, ${RUN + "m2"}, ${RUN + "mB"})`);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${fx.fCode}`);
    for (const c of [fx.fCode, fx.fCodeB].filter(Boolean)) {
      await dung(sql`DELETE FROM stations WHERE code = ${c}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${c}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${c}`);
      await dung(sql`DELETE FROM factories WHERE code = ${c}`);
    }
  } catch (e) {
    console.warn("[r1b2t4] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

const datLaiH = () => {
  H.dispatchCho = 0;
  H.ghimCho.clear();
  H.quyenCho = 0;
  H.phamViCho = 0;
  H.matKhauCho = 0;
  H.hongGhiQuaHan = false;
};
beforeEach(datLaiH);
afterEach(() => {
  datLaiH();
  vi.restoreAllMocks();
});

describe("hằng + điều kiện đếm (posture T12)", () => {
  it("ngân sách trước-gửi = 2000 ms; mã = STOP_QUA_HAN", () => {
    expect(HAN_TRUOC_GUI_STOP_HMI_MS).toBe(2000);
    expect(MA_STOP_QUA_HAN).toBe("STOP_QUA_HAN");
  });
});

describe("Review Focus 5 — DB chậm-mà-sống TRƯỚC khi gửi ⇒ từ chối có mã 'dùng E-STOP cứng' trong ≤ 2,4 s, dispatch 0 lần", () => {
  it("★ loadStopPinsHmi chờ 3000 ms ⇒ TIMEOUT SCADA_STOP_PRECHECK_TIMEOUT {ma STOP_QUA_HAN, pha truoc_gui} < 2400 ms; dispatch 0; driver không nhận gì; ĐÚNG 1 dòng attempts (adapter NULL) + audit QUA_HAN", async () => {
    H.ghimCho.set(fx.a1, 3_000);
    const m = await moc();
    const am = await mocAudit();
    const [{ n: truoc }] = await db.select({ n: count() }).from(scadaCommandAttempts).where(and(dieuKienThuStopQuaHan(), isNull(scadaCommandAttempts.adapterId), eq(scadaCommandAttempts.userId, op.id)));
    const dTu = H.dispatchInputs.length;
    const ghiTruoc = stub.a1.ghi.length;
    const crid = uuid();
    const batDau = Date.now();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: crid }));
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "truoc_gui" } });
    expect(troi).toBeGreaterThanOrEqual(HAN_TRUOC_GUI_STOP_HMI_MS - 50);
    expect(troi).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS + 800);
    expect(soDispatch(fx.a1, dTu)).toBe(0);
    expect(stub.a1.ghi.length).toBe(ghiTruoc);

    const rows = await choThuQuaHan(m, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adapter_id: null, stage: "dispatch", outcome: "rejected", reason_code: "STOP_QUA_HAN" });
    expect(rows[0].requested_value).toMatchObject({ machineId: fx.m1, daXacMinhPhamVi: true, hanMs: 2000 });
    expect(rows[0].ly_do).toContain("E-STOP cứng");
    // điều kiện đếm xuất cho posture T12 thấy đúng dòng này
    const [{ n: sau }] = await db.select({ n: count() }).from(scadaCommandAttempts).where(and(dieuKienThuStopQuaHan(), isNull(scadaCommandAttempts.adapterId), eq(scadaCommandAttempts.userId, op.id)));
    expect(Number(sau) - Number(truoc)).toBe(1);

    const [au] = await choAuditQuaHan(am, fx.m1, crid);
    expect(au.actorId).toBe(op.id);
    expect(au.afterJson).toMatchObject({ ketCuc: "QUA_HAN", pha: "truoc_gui", machineId: fx.m1, daXacMinhPhamVi: true, hanMs: 2000 });
    // final-fix M-2 — buoc là LOẠI bước (tập đóng), mã adapter đi riêng
    expect(au.afterJson.buoc).toBe("adapter");
    expect(au.afterJson.adapters.map((x: { code: string }) => x.code)).toEqual([`${RUN}-a1`]);
    expect(rows[0].requested_value).toMatchObject({ buoc: "adapter", adapters: [`${RUN}-a1`] });
    // không dòng chờ hmi.stop nào được tạo (chưa tới bước đó)
    const cho_ = await dung(sql`SELECT id FROM ai_pending_actions WHERE "userId" = ${op.id} AND "previewJson"->>'clientRequestId' = ${crid}`);
    expect(cho_).toHaveLength(0);
  }, 10_000);

  it("★ pha CHUNG chậm (checkPermission của cổng vai chờ 3000 ms) ⇒ CÙNG từ chối truoc_gui < 2400 ms, dispatch 0, 1 dòng attempts bước 'vai_tro'", async () => {
    H.quyenCho = 3_000;
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const batDau = Date.now();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() }));
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "truoc_gui" } });
    expect(troi).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS + 800);
    expect(H.dispatchInputs.length - dTu).toBe(0);
    const rows = await choThuQuaHan(m, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adapter_id: null, reason_code: "STOP_QUA_HAN" });
    // M-2 — máy đã qua kiểm phạm vi trước khi hết hạn ở bước vai
    expect(rows[0].requested_value).toMatchObject({ machineId: fx.m1, buoc: "vai_tro", daXacMinhPhamVi: true });
  }, 10_000);

  it("đối chứng — DB nhanh ⇒ STOP đi như R1b-1: acked_verified, driver nhận stop_cmd=true, KHÔNG dòng STOP_QUA_HAN", async () => {
    const m = await moc();
    const ghiTruoc = stub.a1.ghi.length;
    const kq = await op.caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    expect(stub.a1.ghi.length - ghiTruoc).toBe(1);
    expect(stub.a1.ghi.at(-1)).toEqual([{ tagKey: "stop_cmd", value: true }]);
    await vi.waitFor(async () => expect((await thuSau(m)).some((r) => r.outcome === "dispatched")).toBe(true), { timeout: 3_000 });
    expect((await thuSau(m)).filter((r) => r.reason_code === MA_STOP_QUA_HAN)).toHaveLength(0);
  }, 10_000);
});

describe("Q4 — một khi dispatch() đã bắt đầu thì KHÔNG BAO GIỜ từ chối vì hạn", () => {
  it("★ dispatch chậm 2,5 s (quá ngân sách 2 s) ⇒ VẪN acked_verified, driver nhận ghim, không dòng STOP_QUA_HAN", async () => {
    H.dispatchCho = 2_500;
    const m = await moc();
    const ghiTruoc = stub.a1.ghi.length;
    const batDau = Date.now();
    const kq = await op.caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() });
    const troi = Date.now() - batDau;
    expect(troi).toBeGreaterThanOrEqual(2_500);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    expect(stub.a1.ghi.length - ghiTruoc).toBe(1);
    await cho(300);
    expect((await thuSau(m)).filter((r) => r.reason_code === MA_STOP_QUA_HAN)).toHaveLength(0);
  }, 10_000);
});

describe("ruling K6 — hết hạn ở MỘT adapter: adapter đó failed STOP_QUA_HAN, adapter khác VẪN gửi", () => {
  it("★ lượt chèn dòng chờ của A bị Postgres CHẶN 3 s (giao dịch khác giữ cùng idempotencyKey) ⇒ A failed STOP_QUA_HAN (dispatch 0), B acked_verified; 1 dòng attempts của A", async () => {
    const crid = uuid();
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const ghiA = stub.a2a.ghi.length;
    const ghiB = stub.a2b.ghi.length;
    let baoDaChen!: () => void;
    const daChen = new Promise<void>((r) => (baoDaChen = r));
    const giu = db
      .transaction(async (tx) => {
        await tx.insert(aiPendingActions).values({
          id: `${RUN}-giu-${crid}`,
          tool: "hmi.stop",
          argsJson: {},
          userId: op.id,
          userRole: "operator",
          summary: "r1b2t4 giữ khoá chỉ mục unique",
          status: "proposed",
          idempotencyKey: `hmistop:${op.id}:${crid}:${fx.a2a}`,
          expiresAt: new Date(Date.now() + 60_000),
        });
        baoDaChen();
        await cho(3_000);
        tx.rollback();
      })
      .catch(() => undefined);
    await daChen;

    const batDau = Date.now();
    const kq = await op.caller.dungMay({ machineId: fx.m2, clientRequestId: crid });
    const troi = Date.now() - batDau;
    expect(troi).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS + 800);
    const a = kq.ketQua.find((r) => r.adapterId === fx.a2a)!;
    const b = kq.ketQua.find((r) => r.adapterId === fx.a2b)!;
    expect(a).toMatchObject({ status: "failed", ok: false, reason: "STOP_QUA_HAN", writes: [{ tagKey: "stop_cmd", value: true }] });
    expect(b).toMatchObject({ status: "acked_verified", ok: true });
    expect(soDispatch(fx.a2a, dTu)).toBe(0);
    expect(soDispatch(fx.a2b, dTu)).toBe(1);
    expect(stub.a2a.ghi.length).toBe(ghiA);
    expect(stub.a2b.ghi.length - ghiB).toBe(1);
    const rows = await choThuQuaHan(m, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adapter_id: fx.a2a, reason_code: "STOP_QUA_HAN", outcome: "rejected" });
    await giu;
  }, 10_000);

  it("★ đọc ghim của A chờ 3 s ⇒ B gửi NGAY (đường ống riêng: dispatch của B < 1 s, không đợi A), A failed STOP_QUA_HAN; kết quả ok", async () => {
    H.ghimCho.set(fx.a2a, 3_000);
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const batDau = Date.now();
    const kq = await op.caller.dungMay({ machineId: fx.m2, clientRequestId: uuid() });
    const troi = Date.now() - batDau;
    expect(troi).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS + 800);
    expect(kq.ketQua.find((r) => r.adapterId === fx.a2a)).toMatchObject({ status: "failed", reason: "STOP_QUA_HAN", writes: [] });
    expect(kq.ketQua.find((r) => r.adapterId === fx.a2b)).toMatchObject({ status: "acked_verified", ok: true });
    const dB = H.dispatchInputs.slice(dTu).filter((d) => d.adapterId === fx.a2b);
    expect(dB).toHaveLength(1);
    expect(dB[0].at - batDau).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS - 300);
    expect(soDispatch(fx.a2a, dTu)).toBe(0);
    const rows = await choThuQuaHan(m, 1);
    expect(rows[0]).toMatchObject({ adapter_id: fx.a2a, reason_code: "STOP_QUA_HAN" });
    expect(await dung(sql`SELECT 1 FROM scada_command_attempts WHERE id > ${m} AND user_id = ${op.id} AND reason_code = 'STOP_QUA_HAN' AND adapter_id IS NULL`)).toHaveLength(0);
  }, 10_000);

  it("MỌI adapter có ghim đều hết hạn khi đọc ghim ⇒ từ chối CẢ lệnh (truoc_gui), dispatch 0, 1 dòng adapter NULL (không dòng theo adapter)", async () => {
    H.ghimCho.set(fx.a2a, 3_000);
    H.ghimCho.set(fx.a2b, 3_000);
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const batDau = Date.now();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.m2, clientRequestId: uuid() }));
    expect(Date.now() - batDau).toBeLessThan(HAN_TRUOC_GUI_STOP_HMI_MS + 800);
    expect(e.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    expect(e.appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "truoc_gui" });
    expect(H.dispatchInputs.length - dTu).toBe(0);
    const rows = await choThuQuaHan(m, 1);
    await cho(200);
    const tatCa = (await thuSau(m)).filter((r) => r.reason_code === MA_STOP_QUA_HAN);
    expect(tatCa).toHaveLength(1);
    expect(rows[0].adapter_id).toBeNull();
  }, 10_000);
});

describe("fix round 1 M-2 — machineId chưa qua kiểm phạm vi được đánh dấu", () => {
  it("hết hạn ở bước phạm vi (idsTrongPhamVi chờ 3 s) ⇒ requested_value + audit daXacMinhPhamVi FALSE, buoc pham_vi", async () => {
    H.phamViCho = 3_000;
    const m = await moc();
    const am = await mocAudit();
    const crid = uuid();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: crid }));
    expect(e.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    const rows = await choThuQuaHan(m, 1);
    expect(rows[0].requested_value).toMatchObject({ machineId: fx.m1, buoc: "pham_vi", daXacMinhPhamVi: false });
    // final-fix M-3 — chưa xác minh ⇒ audit gắn NGƯỜI BẤM, machineId chỉ trong payload (machineIdChuaXacMinh)
    const [au] = await choAuditQuaHan(am, op.id, crid, "user");
    expect(au.afterJson).toMatchObject({ daXacMinhPhamVi: false, machineCode: null, machineIdChuaXacMinh: fx.m1, chiAdminXem: true });
    expect(au.afterJson.machineId).toBeUndefined();
  }, 10_000);

  it("★ final-fix M-3 — người nhà máy A gửi machineId của máy nhà máy B, hết hạn TRƯỚC kiểm phạm vi ⇒ KHÔNG audit nào gắn máy B; dòng gắn người bấm, máy B chỉ trong payload", async () => {
    H.phamViCho = 3_000;
    const am = await mocAudit();
    const m = await moc();
    const crid = uuid();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.mB, clientRequestId: crid }));
    expect(e.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    const rows = await choThuQuaHan(m, 1);
    expect(rows[0].requested_value).toMatchObject({ machineId: fx.mB, buoc: "pham_vi", daXacMinhPhamVi: false });
    const [au] = await choAuditQuaHan(am, op.id, crid, "user");
    expect(au.actorId).toBe(op.id);
    expect(au.afterJson).toMatchObject({ ketCuc: "QUA_HAN", daXacMinhPhamVi: false, machineIdChuaXacMinh: fx.mB });
    // oracle: KHÔNG dòng audit nào (bất kỳ action) gắn thực thể máy B kể từ mốc
    await cho(300);
    const ganB = await dung(sql`SELECT id FROM control_audit_log WHERE id > ${am} AND "entityType" = 'machine' AND "entityId" = ${String(fx.mB)}`);
    expect(ganB).toHaveLength(0);
  }, 10_000);

  it("đối chứng M-3 — hết hạn SAU kiểm phạm vi (bước vai) ⇒ audit VẪN gắn máy (đã xác minh)", async () => {
    H.quyenCho = 3_000;
    const am = await mocAudit();
    const crid = uuid();
    await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: crid }));
    const [au] = await choAuditQuaHan(am, fx.m1, crid, "machine");
    expect(au.afterJson).toMatchObject({ daXacMinhPhamVi: true, machineId: fx.m1, buoc: "vai_tro" });
    expect(au.afterJson.machineIdChuaXacMinh).toBeUndefined();
  }, 10_000);
});

describe("★ final-fix M-1 — dòng từ chối STOP_QUA_HAN ghi sổ HỎNG ⇒ vẫn đếm (bộ nhớ, 'ghi_so_loi')", () => {
  it("từ chối CẢ lệnh (hết hạn ở bước vai), INSERT attempts ném ⇒ demStopQuaHanKhongGhiSo +1 'ghi_so_loi'; không dòng sổ", async () => {
    _datLaiDemStopQuaHanChoTest();
    H.quyenCho = 3_000;
    H.hongGhiQuaHan = true;
    const m = await moc();
    const e = await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() }));
    expect(e.appCode).toBe("SCADA_STOP_PRECHECK_TIMEOUT");
    await vi.waitFor(
      () => {
        if ((demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0) < 1) throw new Error("chưa đếm");
      },
      { timeout: 3_000, interval: 25 },
    );
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ ghi_so_loi: 1 });
    expect((await thuSau(m)).filter((r) => r.reason_code === MA_STOP_QUA_HAN)).toHaveLength(0);
  }, 10_000);

  it("từ chối THEO ADAPTER (a2a quá hạn đọc ghim, a2b đã gửi), INSERT attempts STOP_QUA_HAN ném ⇒ +1 'ghi_so_loi'; a2b vẫn gửi", async () => {
    _datLaiDemStopQuaHanChoTest();
    H.ghimCho.set(fx.a2a, 3_000);
    H.hongGhiQuaHan = true;
    const ghiTruoc = stub.a2b.ghi.length;
    const kq = await op.caller.dungMay({ machineId: fx.m2, clientRequestId: uuid() });
    expect(kq.ketQua.find((k) => k.adapterId === fx.a2a)).toMatchObject({ status: "failed", reason: MA_STOP_QUA_HAN });
    expect(stub.a2b.ghi.length).toBe(ghiTruoc + 1);
    await vi.waitFor(
      () => {
        if ((demStopQuaHanKhongGhiSo().theoBuoc.ghi_so_loi ?? 0) < 1) throw new Error("chưa đếm");
      },
      { timeout: 3_000, interval: 25 },
    );
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ ghi_so_loi: 1 });
  }, 10_000);

  it("đối chứng — ghi sổ THÀNH CÔNG ⇒ bộ đếm bộ nhớ KHÔNG tăng (không đếm đôi)", async () => {
    _datLaiDemStopQuaHanChoTest();
    H.quyenCho = 3_000;
    const m = await moc();
    await loiCua(op.caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() }));
    await choThuQuaHan(m, 1);
    expect(demStopQuaHanKhongGhiSo().tong).toBe(0);
  }, 10_000);
});

describe("★ fix round 1 I-1 — MỘT hạn TỔNG 2,5 s cho cả request (createContext THẬT → middleware THẬT → handler)", () => {
  /** một request như adapter tRPC làm: createContext (info = dungMay) rồi gọi thủ tục với ctx đó */
  async function guiRequest(crid: string) {
    const ctx = await createContext({ req: { headers: { cookie: "app_session_id=x" } } as never, res: {} as never, info: { calls: [{ path: "scadaCommands.dungMay" }] } as never });
    // T15 vòng sửa 1: qua một router tối thiểu `{ scadaCommands }` (đường THẬT `scadaCommands.dungMay`) — middleware phân biệt STOP với lượt gọi anh em theo `path` đầy đủ; caller của router con thấy "dungMay"
    const { router } = await import("../_core/trpc");
    return router({ scadaCommands: scadaCommandsRouter }).createCaller(ctx).scadaCommands.dungMay({ machineId: fx.m1, clientRequestId: crid });
  }
  const nguoiXacThuc = () => ({ id: op.id, openId: `${RUN}-op`, role: "operator", name: "R1B2 T4 op", twoFactorEnabled: false });

  it("hanChotTruocGuiStopHmi: min(2 s từ đầu handler, hạn tổng); vắng hạn tổng ⇒ 2 s", () => {
    expect(hanChotTruocGuiStopHmi(1_000)).toBe(3_000);
    expect(hanChotTruocGuiStopHmi(1_000, 1_700)).toBe(1_700);
    expect(hanChotTruocGuiStopHmi(1_000, 9_000)).toBe(3_000);
    expect(HAN_TONG_STOP_HMI_MS).toBe(2_500);
  });

  it("★ xác thực 1,2 s + cổng đổi mật khẩu 0,6 s + đọc ghim 3 s ⇒ từ chối ≈ 2,5 s từ đầu request (KHÔNG 1,2 + 0,6 + 2 = 3,8 s); handler chỉ có phần còn lại (hanMs ≈ 700)", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(1_200).then(() => nguoiXacThuc()) as never);
    H.matKhauCho = 600;
    H.ghimCho.set(fx.a1, 3_000);
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    const batDau = Date.now();
    const e = await loiCua(guiRequest(uuid()));
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "truoc_gui" } });
    expect(troi).toBeGreaterThanOrEqual(HAN_TONG_STOP_HMI_MS - 50);
    expect(troi).toBeLessThan(HAN_TONG_STOP_HMI_MS + 800);
    expect(soDispatch(fx.a1, dTu)).toBe(0);
    const rows = await choThuQuaHan(m, 1);
    expect(rows[0]).toMatchObject({ adapter_id: null, reason_code: "STOP_QUA_HAN" });
    expect(rows[0].requested_value.daXacMinhPhamVi).toBe(true);
    expect(rows[0].requested_value.hanMs).toBeGreaterThan(300);
    expect(rows[0].requested_value.hanMs).toBeLessThan(1_000);
  }, 10_000);

  it("★ xác thực 1,2 s + cổng đổi mật khẩu TREO ⇒ middleware từ chối ≈ 2,5 s, pha xac_thuc; handler KHÔNG chạy (0 dòng attempts) ⇒ đếm trong bộ nhớ +1 (M-3)", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(1_200).then(() => nguoiXacThuc()) as never);
    H.matKhauCho = 5_000;
    _datLaiDemStopQuaHanChoTest();
    const m = await moc();
    const batDau = Date.now();
    const e = await loiCua(guiRequest(uuid()));
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "xac_thuc" } });
    expect(troi).toBeGreaterThanOrEqual(HAN_TONG_STOP_HMI_MS - 50);
    expect(troi).toBeLessThan(HAN_TONG_STOP_HMI_MS + 800);
    expect(demStopQuaHanKhongGhiSo().theoBuoc).toEqual({ cong_doi_mat_khau: 1 });
    await cho(300);
    expect(await thuSau(m)).toHaveLength(0);
  }, 10_000);

  it("hạn tổng ĐÃ cạn qua router ⇒ middleware gốc (cổng đổi mật khẩu) từ chối trước, pha xac_thuc — fail-closed", async () => {
    const caller = scadaCommandsRouter.createCaller({ user: { id: op.id, role: "operator", name: "x", twoFactorEnabled: false }, hanChotStopHmi: Date.now() - 1 } as never);
    const e = await loiCua(caller.dungMay({ machineId: fx.m1, clientRequestId: uuid() }));
    expect(e.appParams).toEqual({ ma: "STOP_QUA_HAN", pha: "xac_thuc" });
  }, 10_000);

  it("handler nhận hạn tổng ĐÃ cạn (middleware vừa kịp) ⇒ từ chối ngay (buoc het_han_tong_truoc_handler), có dòng attempts, dispatch 0", async () => {
    const { dungMayHmi } = await import("../services/scada/lenhHmi");
    const m = await moc();
    const dTu = H.dispatchInputs.length;
    // R1b-2b-1 T9 (điều phối C14) — cận trên đồng hồ tường trả lại phần máy KHÔNG chạy tiến trình test (doLagBucleSuKien), chặn trên 800 ms (Windows: bộ đo
    // ghi ~68 % thời gian ngủ thành nới — đo ở soCoHan.r1b2b); đột biến vòng lặp bận 900 ms ⇒ đỏ
    const lag = batDauDoLag();
    const batDau = Date.now();
    const kq = await dungMayHmi({ user: { id: op.id, role: "operator", twoFactorEnabled: false } }, { userId: op.id, userRole: "operator" }, { machineId: fx.m1, clientRequestId: uuid() }, { hanChotYeuCau: Date.now() - 1 });
    const troi = Date.now() - batDau;
    // R1b-2b-2a T0 a (2026-10-27) — thao tác thật ~7 ms; trần nới 150 < 300 ⇒ trễ 800 ms (không chặn) và vòng bận 900 ms đều đỏ
    expect(troi).toBeLessThan(300 + (await lag.dung(150)));
    expect(kq).toMatchObject({ ok: false, tuChoi: { ma: "STOP_QUA_HAN", pha: "truoc_gui" } });
    expect(H.dispatchInputs.length - dTu).toBe(0);
    const rows = await choThuQuaHan(m, 1);
    expect(rows[0].requested_value).toMatchObject({ buoc: "het_han_tong_truoc_handler", daXacMinhPhamVi: false });
  }, 10_000);

  it("đối chứng — mọi bước kịp (xác thực 0,3 s) ⇒ STOP đi: acked_verified", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(() => cho(300).then(() => nguoiXacThuc()) as never);
    const kq = await guiRequest(uuid());
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
  }, 10_000);
});

// ═════════ final-fix (điều phối 2026-10-26) — miễn RIÊNG scadaCommands.dungMay khỏi cổng buộc đổi mật khẩu (STOP không bao giờ bị chặn) ═════════
describe("★★★ điều phối 2026-10-26 — người bị buộc đổi mật khẩu VẪN dừng được máy; thủ tục khác VẪN bị chặn; có audit", () => {
  /** hai mốc trên hàng users (khuôn buocDoiMatKhau.test.ts): thu hồi SAU lượt đổi gần nhất ⇒ phải đổi */
  const datCo = (bat: boolean) =>
    bat
      ? dung(sql`UPDATE users SET "passwordChangedAt" = now() - interval '1 minute', "passwordInvalidBefore" = now() WHERE id = ${op.id}`)
      : dung(sql`UPDATE users SET "passwordChangedAt" = now(), "passwordInvalidBefore" = NULL WHERE id = ${op.id}`);
  async function auditBuocDoi(idMoc: number): Promise<Array<{ entityType: string; entityId: string; actorId: number; afterJson: any }>> {
    return (await dung(sql`SELECT "entityType", "entityId", "actorId", "afterJson" FROM control_audit_log
      WHERE id > ${idMoc} AND action = 'scada_hmi_stop_buoc_doi_mat_khau' AND "actorId" = ${op.id} ORDER BY id`)) as never;
  }
  afterEach(async () => {
    await datCo(false);
  });
  /**
   * ⚠ Gọi qua `appRouter` (đường THẬT `scadaCommands.dungMay` mà cổng nhìn thấy trong `path`) — caller của router con thấy `path` = "dungMay"
   * và KHÔNG đo đúng tập miễn cổng.
   */
  let goc: ReturnType<(typeof import("../routers"))["appRouter"]["createCaller"]>;
  beforeAll(async () => {
    const { appRouter } = await import("../routers");
    goc = appRouter.createCaller({ user: { id: op.id, role: "operator", name: "R1B2 T4 op", twoFactorEnabled: false } } as never);
  }, 120_000);

  it("cầu chì — cờ bật thật trong DB (phaiDoiMatKhau đọc MỚI)", async () => {
    const { phaiDoiMatKhau } = await import("../db");
    await datCo(true);
    expect(await phaiDoiMatKhau(op.id)).toBe(true);
    await datCo(false);
    expect(await phaiDoiMatKhau(op.id)).toBe(false);
  });

  it("★ người bị buộc đổi mật khẩu bấm DỪNG MÁY ⇒ STOP ĐI (acked_verified, driver nhận ghim) + ĐÚNG MỘT audit 'STOP khi đang bị buộc đổi mật khẩu' gắn máy", async () => {
    await datCo(true);
    const am = await mocAudit();
    const ghiTruoc = stub.a1.ghi.length;
    const crid = uuid();
    const kq = await goc.scadaCommands.dungMay({ machineId: fx.m1, clientRequestId: crid });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    expect(stub.a1.ghi.length).toBe(ghiTruoc + 1);
    let rows: Awaited<ReturnType<typeof auditBuocDoi>> = [];
    await vi.waitFor(
      async () => {
        rows = (await auditBuocDoi(am)).filter((r) => r.afterJson?.clientRequestId === crid);
        if (rows.length < 1) throw new Error("audit chưa ghi");
      },
      { timeout: 5_000, interval: 50 },
    );
    await cho(200);
    rows = (await auditBuocDoi(am)).filter((r) => r.afterJson?.clientRequestId === crid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "machine", entityId: String(fx.m1), actorId: op.id });
    expect(rows[0].afterJson).toMatchObject({ suKien: "STOP khi đang bị buộc đổi mật khẩu", machineId: fx.m1, daXacMinhPhamVi: true, nguoiBam: { userId: op.id, role: "operator" } });
  }, 10_000);

  it("★ CÙNG người bị buộc đổi ⇒ thủ tục KHÁC (scadaCommands.request, scadaCommands.huy) VẪN MUST_CHANGE_PASSWORD — không mở thủ tục nào khác", async () => {
    await datCo(true);
    const e1 = await loiCua(goc.scadaCommands.request({ adapterId: fx.a1, tagKey: "stop_cmd", value: true, lyDo: "thu cong doi mat khau" } as never));
    expect(e1).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    const e2 = await loiCua(goc.scadaCommands.huy({ requestId: uuid() }));
    expect(e2).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    // và dungMay của CÙNG người, CÙNG lúc, đi qua cổng (đối chứng trong cùng ca)
    const kq = await goc.scadaCommands.dungMay({ machineId: fx.m1, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, ok: true });
  }, 10_000);

  it("★ người bị buộc đổi gửi máy NGOÀI phạm vi (nhà máy B) ⇒ VẪN NOT_FOUND (phạm vi vẫn đòi); audit gắn NGƯỜI BẤM, không gắn máy B", async () => {
    await datCo(true);
    const am = await mocAudit();
    const crid = uuid();
    const e = await loiCua(goc.scadaCommands.dungMay({ machineId: fx.mB, clientRequestId: crid }));
    expect(e.code).toBe("NOT_FOUND");
    let rows: Awaited<ReturnType<typeof auditBuocDoi>> = [];
    await vi.waitFor(
      async () => {
        rows = (await auditBuocDoi(am)).filter((r) => r.afterJson?.clientRequestId === crid);
        if (rows.length < 1) throw new Error("audit chưa ghi");
      },
      { timeout: 5_000, interval: 50 },
    );
    expect(rows[0]).toMatchObject({ entityType: "user", entityId: String(op.id) });
    expect(rows[0].afterJson).toMatchObject({ daXacMinhPhamVi: false, machineIdChuaXacMinh: fx.mB, ketCuc: "NOT_FOUND" });
    const ganB = await dung(sql`SELECT id FROM control_audit_log WHERE id > ${am} AND "entityType" = 'machine' AND "entityId" = ${String(fx.mB)}`);
    expect(ganB).toHaveLength(0);
  }, 10_000);

  it("đối chứng — người KHÔNG bị buộc đổi ⇒ STOP đi như cũ, KHÔNG audit 'buộc đổi mật khẩu'", async () => {
    await datCo(false);
    const am = await mocAudit();
    const kq = await goc.scadaCommands.dungMay({ machineId: fx.m1, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    await cho(300);
    expect(await auditBuocDoi(am)).toHaveLength(0);
  }, 10_000);
});
