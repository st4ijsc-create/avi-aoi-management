/**
 * SCADA R1b-2b-1 Task 1 (mục 59; điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C11 / C16; Review Focus 1) — người vận hành có quyền
 * dừng, ĐANG BỊ BUỘC ĐỔI MẬT KHẨU, vẫn tới được STOP: `scadaCommands.mayDungKhanCap` (thủ tục đọc tối thiểu, phần tử thứ hai của tập miễn
 * cổng) + `scadaCommands.dungMay`; MỌI thủ tục khác vẫn `MUST_CHANGE_PASSWORD`. CSDL `_test` THẬT, gọi qua `appRouter` (đường THẬT mà cổng
 * nhìn thấy trong `path`), `dispatch()` THẬT → StubDriver (RAM).
 *
 * Khuôn cờ buộc đổi: `scadaCommandsRouter.dungMay.hanTruocGui.r1b2.db.test.ts` (hai mốc trên hàng users). Ba nhà máy: A (người dùng tệp),
 * B (không gán — máy B không bao giờ hiện), C (201 máy có adapter — điều kiện 6). `OT_CONTROL_ENABLED` / `SCADA_COMMANDS_ENABLED` CHỈ trong
 * tiến trình; AI_OT_CONTROL_ENABLED không đụng. Đồng hồ thật, mỗi ca < 10 s.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2bt1${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  /** ms chờ trước idsTrongPhamVi thật (ca hạn 3 s của thân) */
  phamViCho: 0,
  /** fix round 1 (I1) — adapter có lượt kiểm chủ edge (bước 2 của khảo sát) TREO `treoMs` ms; 0 = không treo */
  treoAdapter: 0,
  treoMs: 0,
  /** fix round 1 (I1) — đo số lượt kiểm adapter đồng thời (mỗi lượt giữ `dongThoiGiuMs` ms) */
  doDongThoi: false,
  dongThoiGiuMs: 0,
  dangChay: 0,
  dongThoiMax: 0,
  /** fix round 2 (N1) — TẬP adapter treo `treoMs` (cùng lúc nhiều adapter) */
  treoTap: new Set<number>(),
  /** fix round 2 (N1) — đếm MỌI lượt kiểm chủ edge đang chạy (mọi lượt gọi cộng lại) + đỉnh + tổng số lượt bắt đầu */
  edgeDangChay: 0,
  edgeDinh: 0,
  edgeSoGoi: 0,
  /** fix round 2 (N1 b) — số lượt so vân tay kết nối (bước 3 của kiểm adapter) theo adapter */
  vanTayGoi: new Map<number, number>(),
  /** fix round 2 (N2) — ms trễ mọi SELECT … FROM device_adapters (đọc chung của khảo sát); 0 = không trễ */
  docChungCho: 0,
  bangAdapter: null as unknown,
}));

const cho = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
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

// fix round 1 (I1) — callee THẬT của khảo sát khả năng dừng (bước 2, mỗi adapter có ghim) bọc chờ: treo một adapter / đo đồng thời
vi.mock("../services/ot/otAdapterOwnerGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/otAdapterOwnerGate")>();
  return {
    ...real,
    adapterOwnedByEdge: (async (...a: Parameters<typeof real.adapterOwnedByEdge>) => {
      H.edgeSoGoi++;
      H.edgeDangChay++;
      H.edgeDinh = Math.max(H.edgeDinh, H.edgeDangChay);
      try {
        if (H.treoMs > 0 && ((H.treoAdapter !== 0 && a[1] === H.treoAdapter) || H.treoTap.has(a[1]))) await cho(H.treoMs);
        if (H.doDongThoi) {
          H.dangChay++;
          H.dongThoiMax = Math.max(H.dongThoiMax, H.dangChay);
          try {
            await cho(H.dongThoiGiuMs);
          } finally {
            H.dangChay--;
          }
        }
        return await real.adapterOwnedByEdge(...a);
      } finally {
        H.edgeDangChay--;
      }
    }) as typeof real.adapterOwnedByEdge,
  };
});

// fix round 2 (N1 b) — bước 3 THẬT của kiểm adapter (so vân tay kết nối): đếm theo adapter (việc bị bỏ rơi sau hạn KHÔNG được chạy bước này)
vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    runningConnectionMatchesAdapterRow: (async (...a: Parameters<typeof real.runningConnectionMatchesAdapterRow>) => {
      H.vanTayGoi.set(a[1], (H.vanTayGoi.get(a[1]) ?? 0) + 1);
      return real.runningConnectionMatchesAdapterRow(...a);
    }) as typeof real.runningConnectionMatchesAdapterRow,
  };
});

// fix round 2 (N2) — DB "chậm-mà-sống" CHỈ ở đọc chung của khảo sát: mọi SELECT … FROM device_adapters trễ H.docChungCho ms (getDb THẬT bọc
// proxy; danh sách máy FROM machines không trễ). Không nới mã sản phẩm.
vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  const treHoan = (q: any): any =>
    new Proxy(q, {
      get(t, p) {
        if (p === "then") return (ok?: any, err?: any) => cho(H.docChungCho).then(() => t.then(ok, err));
        const v = Reflect.get(t, p, t);
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => {
          const r = v.apply(t, a);
          return r === t ? treHoan(t) : r && typeof r.then === "function" ? treHoan(r) : r;
        };
      },
    });
  const boc = (d: any) =>
    new Proxy(d, {
      get(t, p) {
        if (p === "select" && H.docChungCho > 0) {
          return (...a: unknown[]) => {
            const b = t.select(...a);
            return new Proxy(b, {
              get(bt, bp) {
                if (bp === "from") return (bang: unknown) => (bang === H.bangAdapter ? treHoan(bt.from(bang)) : bt.from(bang));
                const v = Reflect.get(bt, bp, bt);
                return typeof v === "function" ? v.bind(bt) : v;
              },
            });
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
      { code: "R1B2BT1-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
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

vi.mock("../services/robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { adapterTargetFingerprint } from "../services/ot/adapterTarget";
import { deviceAdapters } from "../../drizzle/schema";
import {
  _kheKhaoSatDungKhanCapChoTest,
  DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP,
  HAN_DANH_SACH_DUNG_KHAN_CAP_MS,
  HAN_KHAO_SAT_DUNG_KHAN_CAP_MS,
  TRAN_MAY_DUNG_KHAN_CAP,
} from "../services/scada/mayDungKhanCap";
import { TRAN_MAY_DUNG_KHAN_CAP as TRAN_SHARED } from "@shared/dungKhanCap";

class StubGhi extends StubDriver {
  ghi: Array<Array<{ tagKey: string; value: unknown }>> = [];
  override async writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>) {
    this.ghi.push(writes.map((w) => ({ tagKey: w.tagKey, value: w.value })));
    return super.writeTags(writes);
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Goc = ReturnType<(typeof import("../routers"))["appRouter"]["createCaller"]>;

let db: Db;
const fx = { fA: "", fB: "", fC: "", fD: "", fE: "", sA: 0, mA1: 0, mA2: 0, mA3: 0, mA4: 0, mB: 0, a1: 0, a2: 0, a4d: 0, a4m: 0, aB: 0 };
let stubA1: StubGhi;
let stubA4: StubGhi;
const userIds: number[] = [];
type Vai = "op" | "viewer" | "opKhongSua" | "opC" | "opD" | "opE";
const goc: Record<Vai, { id: number; caller: Goc }> = {} as never;
/** fix round 1 — nhà máy D: số máy có adapter BẬT + ghim (đo giới hạn đồng thời của khảo sát) */
const SO_MAY_D = 40;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}
async function seedNhaMay(code: string): Promise<number> {
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${"Chuyen " + code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  return Number(s.id);
}
async function seedMay(sid: number, ma: string, ten: string): Promise<number> {
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sid}, ${RUN + ma}, ${ten}, 'AOI', true) RETURNING id`);
  return Number(m.id);
}
async function seedAdapter(mid: number, ma: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "lastError")
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, true, 'disabled', ${"LOI-BI-MAT-" + ma}) RETURNING id`);
  return Number(r.id);
}
/** tag ghim DỪNG (bool true) mức tác động 1 — đúng thứ STOP HMI gửi */
async function seedGhim(adapterId: number, key: string): Promise<void> {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
    VALUES (${adapterId}, ${key}, ${"M." + key}, 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1)`);
}
/** `n` máy ở trạm `sid`, mã `${RUN}${tienTo}001…`, mỗi máy MỘT adapter (bật/tắt); `ghim` ⇒ mỗi adapter một tag ghim DỪNG mức 1 */
async function seedNhieuMay(sid: number, tienTo: string, n: number, o: { bat: boolean; ghim: boolean }): Promise<void> {
  await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
    SELECT ${sid}, ${RUN + tienTo} || lpad(g::text, 3, '0'), 'May ' || ${tienTo.toUpperCase()} || ' ' || g, 'AOI', true FROM generate_series(1, ${n}) g`);
  await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    SELECT m.id, ${RUN + "-a" + tienTo} || m.id, ${RUN + "-a" + tienTo} || m.id, 'stub', 'stub://' || m.id, 60000, ${o.bat}, 'disabled'
    FROM machines m WHERE m."stationId" = ${sid}`);
  if (o.ghim) {
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, stop_value, stop_pinned_by, stop_pinned_at, actuation_level)
      SELECT a.id, 'stop_cmd', 'M.stop_cmd', 'bool', true, true, 'input_output'::scada_channel_kind, 'true'::jsonb, '1', now(), 1
      FROM device_adapters a WHERE a.code LIKE ${RUN + "-a" + tienTo + "%"}`);
  }
}
async function ganStub(adapterId: number, ma: string): Promise<StubGhi> {
  const s = new StubGhi();
  await s.connect({ endpoint: `stub://${RUN}-${ma}` } as never);
  H.drivers.set(adapterId, s);
  const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${adapterId}`);
  H.fingerprints.set(
    adapterId,
    adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
  );
  return s;
}
async function seedNguoi(tag: string, role: "operator" | "viewer", nhaMay: string, canEdit: boolean) {
  const u = await taoNguoiDungTest(tag, role, { tienTo: "r1b2bt1", ts: RUN, ten: `R1B2B T1 ${tag}` });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${nhaMay})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${canEdit})`);
  const { appRouter } = await import("../routers");
  return { id: u.id, caller: appRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: false } } as never) };
}
/** hai mốc trên hàng users (khuôn buocDoiMatKhau.test.ts): thu hồi SAU lượt đổi gần nhất ⇒ phải đổi */
const datCo = (uid: number, bat: boolean) =>
  bat
    ? dung(sql`UPDATE users SET "passwordChangedAt" = now() - interval '1 minute', "passwordInvalidBefore" = now() WHERE id = ${uid}`)
    : dung(sql`UPDATE users SET "passwordChangedAt" = now(), "passwordInvalidBefore" = NULL WHERE id = ${uid}`);

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
async function mocAudit(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0)::bigint AS m FROM control_audit_log`);
  return Number(r.m);
}

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
  H.bangAdapter = deviceAdapters;

  fx.fA = `${RUN}a`;
  fx.fB = `${RUN}b`;
  fx.fC = `${RUN}c`;
  fx.fD = `${RUN}d`;
  fx.fE = `${RUN}e`;
  fx.sA = await seedNhaMay(fx.fA);
  const sB = await seedNhaMay(fx.fB);
  const sC = await seedNhaMay(fx.fC);
  const sD = await seedNhaMay(fx.fD);
  const sE = await seedNhaMay(fx.fE);
  // A: mA1 có adapter ghim DỪNG, driver sống ⇒ "du"; mA2 có adapter KHÔNG ghim (coDung false, 0 adapter) ⇒ "khong_toi"
  fx.mA1 = await seedMay(fx.sA, "m1", "May T1-1");
  fx.mA2 = await seedMay(fx.sA, "m2", "May T1-2");
  fx.a1 = await seedAdapter(fx.mA1, "a1");
  await seedGhim(fx.a1, "stop_cmd");
  fx.a2 = await seedAdapter(fx.mA2, "a2");
  // fix round 1 (M6) — mA3: KHÔNG adapter, CHỈ kênh chế độ (nhánh thứ hai của vị từ "có nối"; kênh trỏ adapter của mA2) ⇒ "khong_toi"
  fx.mA3 = await seedMay(fx.sA, "m3", "May T1-3");
  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${fx.mA3}, ${fx.a2}, 'che_do', '2'::jsonb, 1)`);
  // fix round 1 (M4 b) — mA4: HAI adapter ghim: a4d driver sống (duoc) + a4m không driver (mat_ket_noi) ⇒ "mot_phan"
  fx.mA4 = await seedMay(fx.sA, "m4", "May T1-4");
  fx.a4d = await seedAdapter(fx.mA4, "a4d");
  fx.a4m = await seedAdapter(fx.mA4, "a4m");
  await seedGhim(fx.a4d, "stop_cmd");
  await seedGhim(fx.a4m, "stop_cmd");
  // B: máy có adapter ghim — KHÔNG được hiện cho người nhà máy A
  fx.mB = await seedMay(sB, "mB", "May T1-B");
  fx.aB = await seedAdapter(fx.mB, "aB");
  await seedGhim(fx.aB, "stop_cmd");
  // C: TRẦN + 3 = 203 máy (fix round 1 M1 — bỏ hẳn LIMIT phải lộ), mỗi máy MỘT adapter TẮT (khảo sát không gọi gì theo adapter) — điều kiện 6
  await seedNhieuMay(sC, "c", TRAN_MAY_DUNG_KHAN_CAP + 3, { bat: false, ghim: false });
  // D: 40 máy, mỗi máy MỘT adapter BẬT có ghim, không driver (mat_ket_noi) — đo giới hạn đồng thời của khảo sát (I1)
  await seedNhieuMay(sD, "d", SO_MAY_D, { bat: true, ghim: true });
  // E: ĐÚNG TRẦN = 200 máy (fix round 1 M2 — biCat false đúng ở biên)
  await seedNhieuMay(sE, "e", TRAN_MAY_DUNG_KHAN_CAP, { bat: false, ghim: false });

  stubA1 = await ganStub(fx.a1, "a1");
  stubA4 = await ganStub(fx.a4d, "a4d");

  goc.op = await seedNguoi("op", "operator", fx.fA, true);
  // viewer CÓ machine_control.canEdit ⇒ thứ chặn là SÀN VAI mức 1 (đột biến "bỏ kiemCongVaiTro" làm ca viewer đỏ)
  goc.viewer = await seedNguoi("viewer", "viewer", fx.fA, true);
  goc.opKhongSua = await seedNguoi("opks", "operator", fx.fA, false);
  goc.opC = await seedNguoi("opC", "operator", fx.fC, true);
  goc.opD = await seedNguoi("opD", "operator", fx.fD, true);
  goc.opE = await seedNguoi("opE", "operator", fx.fE, true);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const s of [stubA1, stubA4]) {
    try {
      await s?.disconnect();
    } catch {
      /* bỏ qua */
    }
  }
  if (!db) return;
  try {
    await cho(500);
    for (const id of userIds) {
      await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
      await dung(sql`DELETE FROM permissions WHERE "userId" = ${id}`);
    }
    if (fx.mA3) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${fx.mA3}`);
    await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id IN (SELECT id FROM device_adapters WHERE code LIKE ${RUN + "-%"})`);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (SELECT id FROM device_adapters WHERE code LIKE ${RUN + "-%"})`);
    await dung(sql`DELETE FROM device_adapters WHERE code LIKE ${RUN + "-%"}`);
    await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`);
    for (const c of [fx.fA, fx.fB, fx.fC, fx.fD, fx.fE].filter(Boolean)) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${c}`);
      await dung(sql`DELETE FROM stations WHERE code = ${c}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${c}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${c}`);
      await dung(sql`DELETE FROM factories WHERE code = ${c}`);
    }
  } catch (e) {
    console.warn("[r1b2bt1] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

const datLaiH = () => {
  H.phamViCho = 0;
  H.treoAdapter = 0;
  H.treoMs = 0;
  H.doDongThoi = false;
  H.dongThoiGiuMs = 0;
  H.dangChay = 0;
  H.dongThoiMax = 0;
  H.treoTap.clear();
  H.edgeDinh = H.edgeDangChay;
  H.vanTayGoi.clear();
  H.docChungCho = 0;
};
/** chờ (có hạn) tới khi mọi khe khảo sát dùng chung được trả (việc bị bỏ rơi đã THẬT xong) */
async function choKheTrong(): Promise<void> {
  await vi.waitFor(
    () => {
      if (_kheKhaoSatDungKhanCapChoTest().dangGiu !== 0) throw new Error("còn khe đang giữ");
    },
    { timeout: 6_000, interval: 50 },
  );
}
beforeEach(async () => {
  // cô lập: việc khảo sát bị bỏ rơi của ca TRƯỚC (kể cả ca đỏ dừng giữa chừng) phải trả khe dùng chung trước khi ca này chạy
  await choKheTrong();
  datLaiH();
});
afterEach(async () => {
  datLaiH();
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  for (const k of ["op", "viewer", "opKhongSua", "opC", "opD", "opE"] as const) if (goc[k]) await datCo(goc[k].id, false);
});

/** Sáu trường của hợp đồng tối thiểu (ruling C16 + điều phối M4 b) — sắp xếp để so tập khoá. */
const KHOA_HOP_DONG = ["chuyen", "coDung", "machineId", "soAdapter", "ten", "tongHop"];

describe("★★★ mục 59 — operator ĐANG BỊ BUỘC ĐỔI MẬT KHẨU tới được STOP; mọi thủ tục khác vẫn bị chặn", () => {
  it("cầu chì — cờ bật thật trong DB (phaiDoiMatKhau đọc MỚI)", async () => {
    const { phaiDoiMatKhau } = await import("../db");
    await datCo(goc.op.id, true);
    expect(await phaiDoiMatKhau(goc.op.id)).toBe(true);
    await datCo(goc.op.id, false);
    expect(await phaiDoiMatKhau(goc.op.id)).toBe(false);
  });

  it("★★★ cờ BẬT ⇒ mayDungKhanCap trả ĐÚNG máy của A (không máy B), có coDung / soAdapter; JSON KHÔNG lộ adapter / endpoint / lastError / ghim", async () => {
    await datCo(goc.op.id, true);
    const kq = await goc.op.caller.scadaCommands.mayDungKhanCap();
    expect(kq.biCat).toBe(false);
    // mA3 (chỉ kênh chế độ, không adapter) CÓ trong danh sách — nhánh thứ hai của vị từ "có nối" (fix round 1 M6)
    expect(kq.may.map((m) => m.machineId)).toEqual([fx.mA1, fx.mA2, fx.mA3, fx.mA4]);
    const chuyen = `Chuyen ${fx.fA}`;
    expect(kq.may[0]).toEqual({ machineId: fx.mA1, ten: `${RUN}m1 · May T1-1`, chuyen, coDung: true, soAdapter: 1, tongHop: "du" });
    expect(kq.may[1]).toEqual({ machineId: fx.mA2, ten: `${RUN}m2 · May T1-2`, chuyen, coDung: false, soAdapter: 0, tongHop: "khong_toi" });
    expect(kq.may[2]).toEqual({ machineId: fx.mA3, ten: `${RUN}m3 · May T1-3`, chuyen, coDung: false, soAdapter: 0, tongHop: "khong_toi" });
    expect(kq.may[3]).toEqual({ machineId: fx.mA4, ten: `${RUN}m4 · May T1-4`, chuyen, coDung: true, soAdapter: 2, tongHop: "mot_phan" });
    for (const m of kq.may) expect(Object.keys(m).sort()).toEqual(KHOA_HOP_DONG);
    expect(Object.keys(kq).sort()).toEqual(["biCat", "may"]);
    // ruling C16 + Q1: không mã adapter / edgeCode / tagKey / endpoint / lastError / stopValue / giá trị ghim
    const json = JSON.stringify(kq);
    for (const cam of [`${RUN}-a1`, `${RUN}-a2`, `${RUN}-a4d`, `${RUN}-a4m`, "stub://", "mat_ket_noi", "duoc\"", "LOI-BI-MAT", "stop_cmd", "endpoint", "lastError", "stopValue", "edgeCode", "adapters", "khaNangDung", "ghimBoQua", "tagKey"]) {
      expect(json, `JSON lộ "${cam}"`).not.toContain(cam);
    }
    expect(json).not.toContain(String(fx.mB));
  }, 10_000);

  it("★★★ CÙNG người, cờ BẬT ⇒ dungMay máy A acked_verified + ĐÚNG MỘT audit 'scada_hmi_stop_buoc_doi_mat_khau' (hồi quy)", async () => {
    await datCo(goc.op.id, true);
    const am = await mocAudit();
    const ghiTruoc = stubA1.ghi.length;
    const crid = crypto.randomUUID();
    const kq = await goc.op.caller.scadaCommands.dungMay({ machineId: fx.mA1, clientRequestId: crid });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: fx.a1, status: "acked_verified", ok: true });
    expect(stubA1.ghi.length).toBe(ghiTruoc + 1);
    const docAudit = async () =>
      ((await dung(sql`SELECT "entityType", "entityId", "afterJson" FROM control_audit_log
        WHERE id > ${am} AND action = 'scada_hmi_stop_buoc_doi_mat_khau' AND "actorId" = ${goc.op.id} ORDER BY id`)) as Array<{ entityType: string; entityId: string; afterJson: any }>).filter(
        (r) => r.afterJson?.clientRequestId === crid,
      );
    await vi.waitFor(
      async () => {
        if ((await docAudit()).length < 1) throw new Error("audit chưa ghi");
      },
      { timeout: 5_000, interval: 50 },
    );
    await cho(200);
    const rows = await docAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "machine", entityId: String(fx.mA1) });
  }, 10_000);

  it("★★★ CÙNG người, cờ BẬT ⇒ thủ tục KHÁC vẫn FORBIDDEN / MUST_CHANGE_PASSWORD: scadaKenh.cheDo.danhSach (đọc), scadaKenh.danhSach (đọc), scadaCommands.request (ghi)", async () => {
    await datCo(goc.op.id, true);
    expect(await loiCua(goc.op.caller.scadaKenh.cheDo.danhSach())).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    expect(await loiCua(goc.op.caller.scadaKenh.danhSach({ adapterId: fx.a1 }))).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    expect(
      await loiCua(goc.op.caller.scadaCommands.request({ adapterId: fx.a1, tagKey: "stop_cmd", value: true, lyDo: "thu cong doi mat khau", clientRequestId: crypto.randomUUID() } as never)),
    ).toMatchObject({ code: "FORBIDDEN", appCode: "MUST_CHANGE_PASSWORD" });
    // đối chứng trong cùng ca: thủ tục miễn vẫn đi qua
    expect((await goc.op.caller.scadaCommands.mayDungKhanCap()).may).toHaveLength(4);
  }, 10_000);

  it("★★★ đối chứng — người KHÔNG cờ ⇒ CÙNG danh sách", async () => {
    await datCo(goc.op.id, true);
    const coCo = await goc.op.caller.scadaCommands.mayDungKhanCap();
    await datCo(goc.op.id, false);
    const khongCo = await goc.op.caller.scadaCommands.mayDungKhanCap();
    expect(khongCo).toEqual(coCo);
  }, 10_000);
});

describe("★★★ chỉ người CÓ QUYỀN DỪNG thấy máy (sàn vai mức 1 + machine_control.canEdit) — không ném, rỗng", () => {
  it("★★★ viewer (có canEdit) cờ BẬT ⇒ rỗng", async () => {
    await datCo(goc.viewer.id, true);
    expect(await goc.viewer.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);

  it("★★ operator THIẾU machine_control.canEdit ⇒ rỗng (cờ bật và không cờ)", async () => {
    await datCo(goc.opKhongSua.id, true);
    expect(await goc.opKhongSua.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
    await datCo(goc.opKhongSua.id, false);
    expect(await goc.opKhongSua.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);

  it("★★ SCADA_COMMANDS_ENABLED tắt ⇒ rỗng", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    expect(await goc.op.caller.scadaCommands.mayDungKhanCap()).toEqual({ may: [], biCat: false });
  }, 10_000);
});

describe("★★★ điều kiện 6 / ruling C6 — danh sách bị CẮT: TRẦN + 1 hàng + biCat", () => {
  it("★★ hằng TRẦN có MỘT chủ (shared/dungKhanCap.ts) — máy chủ dùng lại đúng hằng ấy (fix round 1 M3)", () => {
    expect(TRAN_SHARED).toBe(200);
    expect(TRAN_MAY_DUNG_KHAN_CAP).toBe(TRAN_SHARED);
  });

  it(`★★★ ${TRAN_MAY_DUNG_KHAN_CAP + 3} máy có nối trong phạm vi ⇒ trả ĐÚNG ${TRAN_MAY_DUNG_KHAN_CAP + 1} hàng (bỏ LIMIT phải lộ — M1), biCat = true, thứ tự mã máy`, async () => {
    await datCo(goc.opC.id, true);
    const kq = await goc.opC.caller.scadaCommands.mayDungKhanCap();
    expect(kq.may).toHaveLength(TRAN_MAY_DUNG_KHAN_CAP + 1);
    expect(kq.biCat).toBe(true);
    expect(kq.may[0].ten).toBe(`${RUN}c001 · May C 1`);
    expect(kq.may[TRAN_MAY_DUNG_KHAN_CAP].ten).toBe(`${RUN}c201 · May C 201`);
    // adapter TẮT ⇒ không adapter nào nhận STOP HMI
    expect(kq.may.every((m) => m.coDung === false && m.soAdapter === 0 && m.tongHop === "khong_toi")).toBe(true);
  }, 10_000);

  it(`★★★ ĐÚNG ${TRAN_MAY_DUNG_KHAN_CAP} máy ⇒ ${TRAN_MAY_DUNG_KHAN_CAP} hàng, biCat = false (biên — M2)`, async () => {
    await datCo(goc.opE.id, true);
    const kq = await goc.opE.caller.scadaCommands.mayDungKhanCap();
    expect(kq.may).toHaveLength(TRAN_MAY_DUNG_KHAN_CAP);
    expect(kq.biCat).toBe(false);
    expect(kq.may[TRAN_MAY_DUNG_KHAN_CAP - 1].ten).toBe(`${RUN}e200 · May E 200`);
  }, 10_000);
});

describe("★★★ điều phối M4 (b) — gợi ý tongHop từ CÙNG khảo sát: du / mot_phan / khong_toi / khong_ro", () => {
  it("★★★ du (driver sống) · mot_phan (một adapter mất kết nối) · khong_toi (chưa ghim / không adapter) — xem ca JSON; ở đây: MÔ PHỎNG ⇒ KHÔNG tới", async () => {
    // OT control tắt (chỉ trong tiến trình) ⇒ adapter sống thành `mo_phong` (writeSimulated) ⇒ KHÔNG tới thiết bị thật
    vi.stubEnv("OT_CONTROL_ENABLED", "false");
    const kq = await goc.op.caller.scadaCommands.mayDungKhanCap();
    const theo = new Map(kq.may.map((m) => [m.machineId, m]));
    expect(theo.get(fx.mA1)).toMatchObject({ coDung: true, soAdapter: 1, tongHop: "khong_toi" });
    // mA4: a4d mô phỏng + a4m mất kết nối ⇒ không adapter nào tới ⇒ khong_toi (không phải mot_phan)
    expect(theo.get(fx.mA4)).toMatchObject({ coDung: true, soAdapter: 2, tongHop: "khong_toi" });
  }, 10_000);

  it(`★★★ I1 — MỘT adapter treo lúc khảo sát ⇒ danh sách VẪN về < ${HAN_DANH_SACH_DUNG_KHAN_CAP_MS} ms, đủ mọi máy; máy treo coDung/soAdapter null + tongHop khong_ro (KHÔNG BAO GIỜ du); máy khác giữ kết luận`, async () => {
    expect(HAN_KHAO_SAT_DUNG_KHAN_CAP_MS).toBe(1500);
    H.treoAdapter = fx.a1;
    H.treoMs = 3_500;
    await datCo(goc.op.id, true);
    const batDau = Date.now();
    const kq = await goc.op.caller.scadaCommands.mayDungKhanCap();
    const troi = Date.now() - batDau;
    expect(troi).toBeGreaterThanOrEqual(HAN_KHAO_SAT_DUNG_KHAN_CAP_MS - 50);
    expect(troi).toBeLessThan(HAN_DANH_SACH_DUNG_KHAN_CAP_MS);
    expect(kq.may.map((m) => m.machineId)).toEqual([fx.mA1, fx.mA2, fx.mA3, fx.mA4]);
    expect(kq.may[0]).toMatchObject({ machineId: fx.mA1, coDung: null, soAdapter: null, tongHop: "khong_ro" });
    expect(kq.may[1]).toMatchObject({ tongHop: "khong_toi", coDung: false });
    expect(kq.may[3]).toMatchObject({ tongHop: "mot_phan", coDung: true, soAdapter: 2 });
    // lượt bị bỏ rơi chạy xong trước ca kế (không truy vấn rơi vào lúc dọn): khe dùng chung được trả khi việc THẬT xong
    await choKheTrong();
    // fix round 2 (N1 b) — việc bị bỏ rơi của a1 (driver sống, OT bật) xong truy vấn 1 SAU hạn ⇒ KHÔNG chạy bước 3 (so vân tay)
    expect(H.vanTayGoi.get(fx.a1) ?? 0).toBe(0);
    // đối chứng: a4d (không treo) chạy đủ bước 3 trong hạn
    expect(H.vanTayGoi.get(fx.a4d) ?? 0).toBe(1);
  }, 10_000);

  it(`★★★ N1 — khe khảo sát DÙNG CHUNG giữa các lượt gọi: hai lượt ĐỒNG THỜI + adapter treo ⇒ tổng việc khảo sát đang chạy ≤ ${DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP}; lượt thứ ba (khe còn bị việc bỏ rơi giữ) về NGAY, mọi máy khong_ro, 0 việc mới`, async () => {
    const idsD = ((await dung(sql`SELECT id FROM device_adapters WHERE code LIKE ${RUN + "-ad%"}`)) as Array<{ id: number }>).map((r) => Number(r.id));
    expect(idsD).toHaveLength(SO_MAY_D);
    for (const id of idsD) H.treoTap.add(id);
    H.treoMs = 3_000;
    const khe = _kheKhaoSatDungKhanCapChoTest();
    expect(khe.dangGiu).toBe(0);
    khe.datLaiCao();
    H.edgeDinh = 0;
    // bước 1 — hai lượt ĐỒNG THỜI
    const [k1, k2] = await Promise.all([goc.opD.caller.scadaCommands.mayDungKhanCap(), goc.opD.caller.scadaCommands.mayDungKhanCap()]);
    for (const kq of [k1, k2]) {
      expect(kq.may).toHaveLength(SO_MAY_D);
      expect(kq.may.every((m) => m.coDung === null && m.soAdapter === null && m.tongHop === "khong_ro")).toBe(true);
    }
    // oracle ĐỘC LẬP (đếm ở callee thật, không đọc bộ đếm của sản phẩm) đứng TRƯỚC
    expect(H.edgeDinh, "tổng lượt kiểm chủ edge đang chạy của CẢ HAI lượt gọi").toBeLessThanOrEqual(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP);
    expect(H.edgeDinh).toBeGreaterThan(1);
    const sau1 = _kheKhaoSatDungKhanCapChoTest();
    // bước 2 — lượt thứ ba trong lúc khe còn bị giữ: không xếp hàng, không việc mới
    const goiTruoc = H.edgeSoGoi;
    const batDau = Date.now();
    const k3 = await goc.opD.caller.scadaCommands.mayDungKhanCap();
    const troi = Date.now() - batDau;
    expect(troi).toBeLessThan(700);
    expect(k3.may).toHaveLength(SO_MAY_D);
    expect(k3.may.every((m) => m.coDung === null && m.soAdapter === null && m.tongHop === "khong_ro")).toBe(true);
    expect(H.edgeSoGoi - goiTruoc).toBe(0);
    // bộ đếm khe của sản phẩm (chỉ test): đã được dùng, không vượt trần, việc bị bỏ rơi giữ khe tới khi THẬT xong
    expect(sau1.cao, "khe dùng chung phải được dùng (cầu chì của bộ đếm)").toBeGreaterThan(0);
    expect(sau1.dangGiu, "việc bị bỏ rơi vẫn giữ khe tới khi THẬT xong").toBeGreaterThan(0);
    expect(_kheKhaoSatDungKhanCapChoTest().cao).toBeLessThanOrEqual(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP);
    await choKheTrong();
  }, 10_000);

  it("★★★ N2 — ĐỌC CHUNG (adapter / ghim) chậm quá hạn con ⇒ danh sách VẪN về < 3000 ms, đủ mọi máy, MỌI máy null / null / khong_ro", async () => {
    H.docChungCho = 3_500;
    await datCo(goc.op.id, true);
    const batDau = Date.now();
    const kq = await goc.op.caller.scadaCommands.mayDungKhanCap();
    const troi = Date.now() - batDau;
    expect(troi).toBeGreaterThanOrEqual(HAN_KHAO_SAT_DUNG_KHAN_CAP_MS - 50);
    expect(troi).toBeLessThan(HAN_DANH_SACH_DUNG_KHAN_CAP_MS);
    expect(kq.may.map((m) => m.machineId)).toEqual([fx.mA1, fx.mA2, fx.mA3, fx.mA4]);
    for (const m of kq.may) expect(m).toMatchObject({ coDung: null, soAdapter: null, tongHop: "khong_ro" });
    await choKheTrong();
    H.docChungCho = 0;
  }, 10_000);

  it(`★★ I1 — khảo sát kiểm tối đa ${DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP} adapter đồng thời (${SO_MAY_D} adapter có ghim)`, async () => {
    expect(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP).toBe(8); // final fix I-1 (2026-10-27): 16 → 8 — ngân sách pool chung với sổ treo T9 (nganSachPoolStop.test.ts)
    H.doDongThoi = true;
    H.dongThoiGiuMs = 40;
    const kq = await goc.opD.caller.scadaCommands.mayDungKhanCap();
    expect(kq.may).toHaveLength(SO_MAY_D);
    // không driver ⇒ mất kết nối ⇒ không tới; mọi máy đã kết luận (không máy nào "khong_ro")
    expect(kq.may.every((m) => m.tongHop === "khong_toi" && m.soAdapter === 1)).toBe(true);
    expect(H.dongThoiMax).toBeGreaterThan(1);
    expect(H.dongThoiMax).toBeLessThanOrEqual(DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP);
  }, 10_000);
});

describe("★★ hạn 3 s trên THÂN (ruling C16)", () => {
  it(`phạm vi chờ 3500 ms ⇒ SERVICE_UNAVAILABLE / OPERATION_FAILED {operation: mayDungKhanCap} sau ~${HAN_DANH_SACH_DUNG_KHAN_CAP_MS} ms`, async () => {
    expect(HAN_DANH_SACH_DUNG_KHAN_CAP_MS).toBe(3000);
    H.phamViCho = 3_500;
    const batDau = Date.now();
    const e = await loiCua(goc.op.caller.scadaCommands.mayDungKhanCap());
    const troi = Date.now() - batDau;
    expect(e).toEqual({ code: "SERVICE_UNAVAILABLE", appCode: "OPERATION_FAILED", appParams: { operation: "mayDungKhanCap" } });
    expect(troi).toBeGreaterThanOrEqual(HAN_DANH_SACH_DUNG_KHAN_CAP_MS - 50);
    expect(troi).toBeLessThan(HAN_DANH_SACH_DUNG_KHAN_CAP_MS + 800);
    await cho(700); // lượt phạm vi bị bỏ rơi chạy xong trước ca kế
  }, 10_000);
});
