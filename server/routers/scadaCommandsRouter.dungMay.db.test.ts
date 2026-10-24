/**
 * SCADA R1b-1 Task 2 — `scadaCommands.dungMay` (STOP HMI MỘT bước) trên CSDL `_test` THẬT. Review Focus 1–3.
 *
 * Đường ghi THẬT tới thiết bị: router tRPC THẬT → `lenhHmi.dungMayHmi` → `dispatch()` THẬT (cổng binding requireBoundAction, cổng kênh
 * sớm 3b, cổng chế độ 3c — luôn chạy cho `hmi.*`, cờ SCADA_CONG_CHE_DO_ENABLED để TẮT để chứng minh điều đó —, phân loại STOP ghim 5a-stop
 * gồm `canonicalisePinnedStop` + dấu vân tay kết nối THẬT `runningConnectionMatchesAdapterRow`, đặt chỗ ghi trước, đọc lại bắt buộc) →
 * StubDriver THẬT (RAM) cho từng adapter của tệp.
 *
 * Giả đúng ba chỗ hạ tầng (khuôn R1a T9 / T15):
 *   • `getActiveDriver` / `getActiveConnectionFingerprint` (otManager): adapter của tệp ⇒ StubDriver + dấu vân tay TÍNH bằng
 *     `adapterTargetFingerprint` của CHÍNH hàng device_adapters (như otManager làm lúc nối) ⇒ STOP ghim THẬT, không nới dispatcher.
 *     Adapter edge: KHÔNG driver (trung tâm không giữ phiên) ⇒ dispatcher định tuyến sang node edge.
 *   • nguồn safety-PLC (facade THẬT, PLC giả đọc sạch — khuôn dot1b); `H.estop` ⇒ PLC báo E-STOP (BLOCKED) để chứng minh STOP ghim bỏ preflight.
 *   • `raiseCriticalStopAlert` + `sendCentralAdapterStop` (đường edge) ghi lại, không gửi thật.
 * `dispatch` được BỌC để đếm / chụp đầu vào (gọi xuyên mã thật). `OT_CONTROL_ENABLED=true` CHỈ trong tiến trình (D9).
 *
 * Oracle độc lập với mã sản phẩm: giá trị StubDriver NHẬN (theo adapter), hàng `command_log` theo actionId, `scada_command_attempts` theo
 * người dùng tệp, `ai_pending_actions` tool hmi.stop, `control_audit_log` action scada_hmi_stop.
 * `command_log` / `scada_command_attempts` / `control_audit_log` là WORM: hàng của tệp ở lại (đúng thiết kế).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1b2${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  dispatchInputs: [] as Array<Record<string, unknown>>,
  estop: false,
  alerts: [] as Array<{ kind: string; message: string }>,
  fallback: [] as number[],
  /** fix round 1 — audit TREO (mô phỏng khoá advisory chuỗi băm không hạn khi SEC_PLATFORM bật) */
  auditTreo: false,
  /** fix round 2 — isCommissioned NÉM (lỗi đọc khi khảo sát) */
  commNem: false,
  /** fix round 2 — hàng đợi edge từ chối ⇒ nhánh STOP dự phòng của trung tâm */
  enqueueNem: false,
  /** fix round 3 — đọc "node edge tới được không" TREO + đếm số lượt hỏi */
  reachTreo: false,
  reachCalls: 0,
  /** fix round 3 — khảo sát trả lỗi chung (loiKhaoSat) cho mọi máy */
  khaoSatHong: false,
}));

vi.mock("../services/scada/khaNangDung", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/khaNangDung")>();
  return {
    ...real,
    khaoSatKhaNangDungNhieu: (async (...a: Parameters<typeof real.khaoSatKhaNangDungNhieu>) => {
      if (!H.khaoSatHong) return real.khaoSatKhaNangDungNhieu(...a);
      return new Map(a[1].map((m) => [m, { machineId: m, adapters: [], tongHop: "khong" as const, loiKhaoSat: true as const }]));
    }) as typeof real.khaoSatKhaNangDungNhieu,
  };
});

vi.mock("../services/ot/commissioningService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commissioningService")>();
  return {
    ...real,
    isCommissioned: (async (...a: Parameters<typeof real.isCommissioned>) => {
      if (H.commNem) throw new Error("r1b2: isCommissioned ném (mô phỏng lỗi đọc)");
      return real.isCommissioned(...a);
    }) as typeof real.isCommissioned,
  };
});

vi.mock("../services/edge/edgeNodeCommands", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/edge/edgeNodeCommands")>();
  return {
    ...real,
    enqueueEdgeDeviceRequest: (async (...a: Parameters<typeof real.enqueueEdgeDeviceRequest>) => {
      if (H.enqueueNem) throw new Error("r1b2: edge queue refused (simulated)");
      return real.enqueueEdgeDeviceRequest(...a);
    }) as typeof real.enqueueEdgeDeviceRequest,
    edgeNodeReachability: ((...a: Parameters<typeof real.edgeNodeReachability>) => {
      H.reachCalls += 1;
      return H.reachTreo ? new Promise<never>(() => undefined) : real.edgeNodeReachability(...a);
    }) as typeof real.edgeNodeReachability,
  };
});

vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...real,
    recordAuditEvent: ((...a: Parameters<typeof real.recordAuditEvent>) =>
      H.auditTreo && (a[1] as { action?: string }).action === "scada_hmi_stop"
        ? new Promise<never>(() => undefined)
        : real.recordAuditEvent(...a)) as typeof real.recordAuditEvent,
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
      { code: "R1B2-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } },
    ],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: H.estop }),
      readChecked: async () => ({ status: { estop: H.estop }, unreadable: [] }),
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

vi.mock("../services/robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; message: string }) => {
    H.alerts.push(a);
  },
}));
vi.mock("../services/robot/deviceOwnershipService", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async (adapterId: number) => {
      H.fallback.push(adapterId);
      return { ok: true, sent: "sent" as const, detail: "recorded" };
    },
  };
});

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async (...a: Parameters<typeof real.dispatch>) => {
      H.dispatchInputs.push(a[0] as unknown as Record<string, unknown>);
      return real.dispatch(...a);
    },
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { StubDriver } from "../services/ot/drivers/stubDriver";
import { adapterTargetFingerprint } from "../services/ot/adapterTarget";
import { confirmAction } from "../services/aiCopilotActions";
import { getTool } from "../services/aiLocalTools/toolRegistry";

/** StubDriver THẬT + ghi lại MỌI lô ghi nó nhận. */
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

type May = { fid: number; mid: number; code: string };
const may: Record<"R" | "L" | "E" | "N" | "X", May> = {} as never;
/** adapter: R (REMOTE), R2 (bật, không ghim), Rtat (TẮT, có ghim), L (LOCAL), E (edge), N (không ghim) */
const ad: Record<"R" | "R2" | "Rtat" | "L" | "E" | "N", number> = {} as never;
const stub: Record<"R" | "L", StubGhi> = {} as never;
let edgeNodeId = 0;
const factories: string[] = [];
const userIds: number[] = [];
const nguoi: Record<string, { id: number; role: string; caller: Caller }> = {};

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

/** Một nhà máy (factory → workshop → line → station) + máy đầu tiên; `seedMayThem` thêm máy trên CÙNG trạm. */
async function seedNhaMay(ten: string): Promise<May & { sid: number }> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  factories.push(code);
  const m = await seedMayThem(Number(s.id), code, ten);
  return { ...m, fid: Number(f.id), sid: Number(s.id) };
}
const mayCodes: string[] = [];
async function seedMayThem(sid: number, factoryCode: string, ten: string): Promise<May> {
  const code = `${RUN}${ten}`;
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sid}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`,
  );
  mayCodes.push(code);
  return { fid: 0, mid: Number(m.id), code: factoryCode };
}

async function seedAdapter(mid: number, ma: string, o: { isEnabled?: boolean } = {}): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, 'stub', ${`stub://${RUN}-${ma}`}, 60000, ${o.isEnabled ?? true}, 'disabled') RETURNING id`);
  return Number(r.id);
}

/** Tag ghi được; `stop` ⇒ ghim DỪNG (jsonb); `dai` ⇒ khai dải kênh (để chứng minh STOP ghim được miễn dải). */
async function seedTag(
  adapterId: number,
  key: string,
  o: { dataType: "bool" | "float" | "int"; stop?: unknown; dai?: [number, number]; kind?: string; writable?: boolean },
) {
  const stop = o.stop === undefined ? null : JSON.stringify(o.stop);
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, write_min, write_max,
      stop_value, stop_pinned_by, stop_pinned_at)
    VALUES (${adapterId}, ${key}, ${"M." + key}, ${o.dataType}, ${o.writable ?? true}, true, ${o.kind ?? "input_output"}::scada_channel_kind,
      ${o.dai ? o.dai[0] : null}, ${o.dai ? o.dai[1] : null}, ${stop}::jsonb, ${stop === null ? null : "1"}, ${stop === null ? null : sql`now()`})`);
}

async function seedNguoi(ten: string, role: "operator" | "viewer" | "engineer", factoryCode: string, twoFactorEnabled: boolean) {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1b2", ts: RUN, ten: `R1B2 ${ten}` });
  userIds.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${factoryCode})`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${role !== "viewer"})`,
  );
  nguoi[ten] = { id: u.id, role, caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled } } as never) };
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
const mauOt = (tagKey: string, value: number) => ({ tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() });

async function moc(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}
type DongThu = { request_id: string | null; adapter_id: number | null; stage: string; outcome: string; reason_code: string | null; command_log_ids: number[] | null; requested_value: unknown };
/** R1b-1 T7 — cột ly_do (mig 0433) sau mốc. */
async function lyDoSau(m: number, userId: number): Promise<Array<string | null>> {
  return ((await dung(sql`SELECT ly_do FROM scada_command_attempts WHERE id > ${m} AND user_id = ${userId} ORDER BY id`)) as Array<{ ly_do: string | null }>).map((r) => r.ly_do);
}
async function thuSau(m: number, userId: number): Promise<DongThu[]> {
  return (await dung(sql`SELECT request_id, adapter_id, stage, outcome, reason_code, command_log_ids, requested_value
    FROM scada_command_attempts WHERE id > ${m} AND user_id = ${userId} ORDER BY id`)) as DongThu[];
}
async function dongLenh(actionId: string): Promise<Array<{ status: string; tagKey: string; requestedValue: unknown; ledger: string | null; errorText: string | null }>> {
  return (await dung(sql`SELECT status::text AS status, "tagKey", "requestedValue", "ackValue"->>'ledger' AS ledger, "errorText"
    FROM command_log WHERE "actionId" = ${actionId} ORDER BY id`)) as never;
}
async function dongChoHmiStop(actionId: string) {
  const [r] = await dung(sql`SELECT tool, status::text AS status, "userId", "idempotencyKey", "expiresAt", "createdAt" FROM ai_pending_actions WHERE id = ${actionId}`);
  return r as { tool: string; status: string; userId: number; idempotencyKey: string; expiresAt: Date; createdAt: Date } | undefined;
}
async function auditSau(idMoc: number, machineId: number) {
  return (await dung(sql`SELECT "entityType", "entityId", action, "actorId", "afterJson", reason FROM control_audit_log
    WHERE id > ${idMoc} AND action = 'scada_hmi_stop' AND "entityId" = ${String(machineId)} ORDER BY id`)) as Array<{
    entityType: string;
    entityId: string;
    action: string;
    actorId: number;
    afterJson: any;
    reason: string;
  }>;
}
/**
 * fix round 1 — audit là fire-and-forget: chờ (có hạn) hàng audit CỦA lần bấm này (theo clientRequestId — audit của lần bấm trước có thể
 * ghi muộn hơn mốc). Trả mọi hàng của lần bấm đó (đúng MỘT mong đợi).
 */
async function choAudit(idMoc: number, machineId: number, clientRequestId: string) {
  let rows: Awaited<ReturnType<typeof auditSau>> = [];
  await vi.waitFor(
    async () => {
      rows = (await auditSau(idMoc, machineId)).filter((r) => r.afterJson?.clientRequestId === clientRequestId);
      if (rows.length < 1) throw new Error("audit chưa ghi");
    },
    { timeout: 5_000, interval: 50 },
  );
  return rows;
}
async function mocAudit(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM control_audit_log`);
  return Number(r.m);
}

const GHIM_R = [
  { tagKey: "speed_sp", value: 0 },
  { tagKey: "stop_cmd", value: true },
];

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "true");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
  vi.stubEnv("OT_READBACK_ENABLED", "false"); // dungMay vẫn đọc lại (docLai bat_buoc)
  vi.stubEnv("OT_CMD_SERIALIZE_ENABLED", "false");
  vi.stubEnv("SEC_PLATFORM", "false");
  vi.stubEnv("UNS_CMD_ACK_ENABLED", "false");
  vi.stubEnv("SCADA_CONG_CHE_DO_ENABLED", "false"); // cổng chế độ 3c vẫn chạy cho hmi.* (không nhờ cờ)
  vi.stubEnv("EDGE_RUNTIME_ENABLED", "true");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));
  boDem = await import("../services/scada/boDemHienTai");

  // R/L/E/N cùng MỘT nhà máy (phạm vi người dùng A); X ở nhà máy khác
  const nmA = await seedNhaMay("r");
  may.R = nmA;
  may.L = await seedMayThem(nmA.sid, nmA.code, "l");
  may.E = await seedMayThem(nmA.sid, nmA.code, "e");
  may.N = await seedMayThem(nmA.sid, nmA.code, "n");
  may.X = await seedNhaMay("x");

  ad.R = await seedAdapter(may.R.mid, "r");
  ad.R2 = await seedAdapter(may.R.mid, "r2");
  ad.Rtat = await seedAdapter(may.R.mid, "rtat", { isEnabled: false });
  ad.L = await seedAdapter(may.L.mid, "l");
  ad.E = await seedAdapter(may.E.mid, "e");
  ad.N = await seedAdapter(may.N.mid, "n");

  // R: kênh chế độ (REMOTE), hai ghim (speed_sp có DẢI 10..300 mà ghim 0 nằm NGOÀI dải — STOP ghim được miễn dải), một tag KHÔNG ghim
  await seedTag(ad.R, "che_do", { dataType: "int", kind: "input", writable: false });
  await seedTag(ad.R, "speed_sp", { dataType: "float", stop: 0, dai: [10, 300] });
  await seedTag(ad.R, "stop_cmd", { dataType: "bool", stop: true });
  await seedTag(ad.R, "sp", { dataType: "float" });
  await seedTag(ad.R2, "sp2", { dataType: "float" }); // adapter bật, không ghim ⇒ không gửi
  await seedTag(ad.Rtat, "stop_cmd", { dataType: "bool", stop: true }); // adapter TẮT ⇒ không gửi
  // L: kênh chế độ khai nhưng giá trị ≠ REMOTE ⇒ LOCAL khac_remote
  await seedTag(ad.L, "che_do", { dataType: "int", kind: "input", writable: false });
  await seedTag(ad.L, "stop_cmd", { dataType: "bool", stop: true });
  await seedTag(ad.L, "sp", { dataType: "float" });
  // E: do edge sở hữu, có ghim
  await seedTag(ad.E, "stop_cmd", { dataType: "bool", stop: true });
  // N: không ghim
  await seedTag(ad.N, "sp", { dataType: "float" });

  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${may.R.mid}, ${ad.R}, 'che_do', '2'::jsonb, 1)`);
  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${may.L.mid}, ${ad.L}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(ad.R, { pollMs: 60_000, coDeadband: false, machineId: may.R.mid, code: `${RUN}-r` });
  boDem.napTuOt({ adapterId: ad.R, machineId: may.R.mid }, [mauOt("che_do", 2)]);
  boDem.datThongTinAdapter(ad.L, { pollMs: 60_000, coDeadband: false, machineId: may.L.mid, code: `${RUN}-l` });
  boDem.napTuOt({ adapterId: ad.L, machineId: may.L.mid }, [mauOt("che_do", 1)]);

  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r1b2 edge', 'online') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.E}`);

  // StubDriver + dấu vân tay kết nối = CHÍNH hàng adapter (như otManager tính khi nối) ⇒ STOP ghim thật ở 5a-stop
  for (const k of ["R", "L"] as const) {
    stub[k] = new StubGhi();
    await stub[k].connect({ endpoint: `stub://${RUN}-${k}` } as never);
    H.drivers.set(ad[k], stub[k]);
    const [row] = await dung(sql`SELECT protocol, endpoint, "machineId", "connectionOptions" FROM device_adapters WHERE id = ${ad[k]}`);
    H.fingerprints.set(
      ad[k],
      adapterTargetFingerprint({ protocol: row.protocol, endpoint: row.endpoint, machineId: row.machineId ?? null, connectionOptions: row.connectionOptions ?? null }),
    );
  }

  await seedNguoi("opA", "operator", may.R.code, false); // operator CHƯA có 2FA
  await seedNguoi("opA2", "operator", may.R.code, true);
  await seedNguoi("opB", "operator", may.R.code, true);
  await seedNguoi("viewerA", "viewer", may.R.code, false);
  await seedNguoi("viewerX", "viewer", may.X.code, false);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const k of ["R", "L"] as const) {
    try {
      boDem?.xoaAdapter(ad[k]);
      await stub[k]?.disconnect();
    } catch {
      /* bỏ qua */
    }
  }
  if (!db) return;
  try {
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool LIKE 'hmi.%'`);
    const ids = Object.values(ad).filter(Boolean);
    for (const id of ids) {
      await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${id}`);
      // một thiết bị còn STOP chưa ack không xoá được (0374 R-10-i) ⇒ ack qua hàm có canh gác (khuôn __edgeCentralKit.dot10 teardown)
      await dung(sql`SELECT public.edge_stop_ack_edge(q.id, q."edgeNodeId", q."robotId", q."adapterId", q."ownerEpoch", 'done', false, NULL)
        FROM robot_motion_lock_requests q WHERE q."adapterId" = ${id} AND q."ackedAt" IS NULL AND q.kind = 'stop'`).catch((e) =>
        console.warn("[r1b2] ack STOP edge:", (e as Error).message, String((e as { cause?: unknown }).cause ?? "")),
      );
    }
    for (const k of ["R", "L"] as const) if (may[k]) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${may[k].mid}`);
    for (const id of ids) {
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
    for (const code of mayCodes) await dung(sql`DELETE FROM machines WHERE code = ${code}`);
    for (const code of factories) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
      await dung(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung(sql`DELETE FROM factories WHERE code = ${code}`);
    }
  } catch (e) {
    console.warn("[r1b2] dọn dữ liệu:", (e as Error).message, String((e as { cause?: unknown }).cause ?? ""));
  }
}, 120_000);

beforeEach(() => {
  H.estop = false;
  H.alerts.length = 0;
  H.fallback.length = 0;
});

/** Lô ghi CUỐI mà stub nhận, sắp theo tagKey (oracle: đúng các giá trị ghim, không gì khác). */
const loCuoi = (k: "R" | "L") => [...(stub[k].ghi.at(-1) ?? [])].sort((a, b) => a.tagKey.localeCompare(b.tagKey));

describe("dungMay — máy REMOTE: gửi ĐÚNG giá trị ghim tới mọi adapter BẬT có ghim", () => {
  it("★ acked_verified; driver nhận đúng {speed_sp: 0, stop_cmd: true} (ghim 0 NGOÀI dải 10..300 vẫn gửi); tag không ghim / adapter tắt / adapter không ghim: không gửi", async () => {
    const ghiTruoc = stub.R.ghi.length;
    const m = await moc();
    const kq = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1); // chỉ ad.R — R2 không ghim, Rtat tắt
    const r = kq.ketQua[0];
    expect(r).toMatchObject({ adapterId: ad.R, status: "acked_verified", ok: true, simulated: false });
    expect(r.edgeStopRequest).toBeUndefined();
    expect(r.writes).toEqual(GHIM_R);
    expect(stub.R.ghi.length - ghiTruoc).toBe(1);
    expect(loCuoi("R")).toEqual(GHIM_R);

    const inp = H.dispatchInputs.at(-1)!;
    expect(inp).toMatchObject({ adapterId: ad.R, machineId: may.R.mid, commandType: "stop", docLai: "bat_buoc" });
    expect(inp.triggeredBy).toMatchObject({ kind: "hitl", tool: "hmi.stop", confirmedBy: nguoi.opA2.id, requestedBy: nguoi.opA2.id, requireBoundAction: true });
    const actionId = (inp.triggeredBy as { actionId: string }).actionId;
    expect(inp.idempotencyKey).toBe(`hmistop:${actionId}`);

    // ledger: STOP ghim THẬT (5a-stop: canonicalise + vân tay kết nối) — ackValue.pinnedStop
    const dong = await dongLenh(actionId);
    expect(dong.map((x) => [x.ledger, x.status])).toEqual([
      ["intent", "sent"],
      ["intent", "sent"],
      ["result", "acked_verified"],
      ["result", "acked_verified"],
    ]);
    const [pin] = await dung(sql`SELECT bool_and(("ackValue"->>'pinnedStop')::boolean) AS p FROM command_log WHERE "actionId" = ${actionId}`);
    expect(pin.p).toBe(true);

    const cho = await dongChoHmiStop(actionId);
    expect(cho).toMatchObject({ tool: "hmi.stop", status: "executed", userId: nguoi.opA2.id });
    expect(cho!.idempotencyKey).toMatch(new RegExp(`^hmistop:${nguoi.opA2.id}:[0-9a-f-]{36}:${ad.R}$`));
    expect(new Date(cho!.expiresAt).getTime() - new Date(cho!.createdAt).getTime()).toBeLessThanOrEqual(31_000);

    const thu = await thuSau(m, nguoi.opA2.id);
    expect(thu).toHaveLength(1);
    expect(thu[0]).toMatchObject({ request_id: actionId, adapter_id: ad.R, stage: "dispatch", outcome: "dispatched", reason_code: null, requested_value: GHIM_R });
    expect(thu[0].command_log_ids?.length).toBe(2);
    // R1b-1 T7 — không gõ lý do ⇒ câu hệ thống mô tả kết cục
    expect(await lyDoSau(m, nguoi.opA2.id)).toEqual(["STOP: acked_verified"]);
  });

  it("★ safety PLC báo E-STOP (BLOCKED) ⇒ STOP ghim VẪN gửi (bỏ preflight) — đối chứng cho bố trí safety nằm TRONG vòng", async () => {
    H.estop = true;
    const kq = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.R, status: "acked_verified", ok: true });
    expect(loCuoi("R")).toEqual(GHIM_R);
  });
});

describe("Review Focus 1 — LOCAL / khoá chọn của người khác / chưa 2FA: VẪN gửi", () => {
  it("★ máy LOCAL (khac_remote) ⇒ gửi, KHÔNG MODE_LOCAL; driver nhận đúng ghim", async () => {
    const ghiTruoc = stub.L.ghi.length;
    const kq = await nguoi.opA2.caller.dungMay({ machineId: may.L.mid, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0].reason).not.toBe("MODE_LOCAL");
    expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.L, status: "acked_verified", ok: true, simulated: false });
    expect(stub.L.ghi.length - ghiTruoc).toBe(1);
    expect(loCuoi("L")).toEqual([{ tagKey: "stop_cmd", value: true }]);
  });

  it("★ người khác (opB) đang giữ khoá chọn tag stop_cmd ⇒ vẫn gửi; khoá của opB giữ nguyên", async () => {
    const reqB = uuid();
    await dung(sql`INSERT INTO scada_khoa_chon (adapter_id, tag_key, user_id, request_id, expires_at)
      VALUES (${ad.L}, 'stop_cmd', ${nguoi.opB.id}, ${reqB}, now() + interval '60 seconds')
      ON CONFLICT (adapter_id, tag_key) DO UPDATE SET user_id = EXCLUDED.user_id, request_id = EXCLUDED.request_id, expires_at = EXCLUDED.expires_at`);
    const kq = await nguoi.opA2.caller.dungMay({ machineId: may.L.mid, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.L, status: "acked_verified", ok: true });
    expect(loCuoi("L")).toEqual([{ tagKey: "stop_cmd", value: true }]);
    const [k] = await dung(sql`SELECT user_id, request_id FROM scada_khoa_chon WHERE adapter_id = ${ad.L} AND tag_key = 'stop_cmd'`);
    expect(k).toMatchObject({ user_id: nguoi.opB.id, request_id: reqB });
  });

  it("★ operator CHƯA đăng ký 2FA ⇒ vẫn gửi (mức 1)", async () => {
    const kq = await nguoi.opA.caller.dungMay({ machineId: may.L.mid, clientRequestId: uuid() });
    expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.L, status: "acked_verified", ok: true });
  });

  it("lyDo TUỲ CHỌN: có lyDo ⇒ vẫn gửi, lyDo vào audit", async () => {
    const a = await mocAudit();
    const crid = uuid();
    const m = await moc();
    const kq = await nguoi.opA.caller.dungMay({ machineId: may.L.mid, lyDo: "ket phoi o bang tai", clientRequestId: crid });
    expect(kq.ketQua[0].ok).toBe(true);
    // R1b-1 T7 — có gõ lý do ⇒ ly_do của dòng attempts chính là lý do đó
    expect(await lyDoSau(m, nguoi.opA.id)).toEqual(["ket phoi o bang tai"]);
    const [au] = await choAudit(a, may.L.mid, crid);
    expect(au.reason).toBe("ket phoi o bang tai");
  });
});

describe("Review Focus 2 — adapter do edge sở hữu", () => {
  it("★ máy edge ⇒ dispatcher định tuyến STOP sang node edge: edgeStopRequest, có hàng yêu cầu stop xếp hàng; không bị từ chối MODE_LOCAL", async () => {
    (await import("../services/edge/edgeNodeCommands")).noteEdgeNodePull(edgeNodeId);
    const kq = await nguoi.opA2.caller.dungMay({ machineId: may.E.mid, clientRequestId: uuid() });
    expect(kq.ketQua).toHaveLength(1);
    expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.E, edgeStopRequest: true, reason: "ADAPTER_OWNED_BY_EDGE", ok: false });
    expect(kq.ketQua[0].reason).not.toBe("MODE_LOCAL");
    const [row] = await dung(sql`SELECT kind, "edgeNodeId" FROM robot_motion_lock_requests WHERE "adapterId" = ${ad.E} ORDER BY id DESC LIMIT 1`);
    expect(row).toMatchObject({ kind: "stop", edgeNodeId });
    // fix round 1 (minor 4) — STOP đã xếp hàng cho edge ⇒ dòng chờ 'executed' (không 'bi_tu_choi_ghi') + chi tiết edge trong resultJson
    const actionId = (H.dispatchInputs.at(-1)!.triggeredBy as { actionId: string }).actionId;
    const [cho] = await dung(sql`SELECT status::text AS status, "resultJson" FROM ai_pending_actions WHERE id = ${actionId}`);
    expect(cho.status).toBe("executed");
    expect(cho.resultJson).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: { edgeNodeId } });
  });
});

describe("Review Focus 3 — bấm hai lần / hai người cùng lúc: cả hai GỬI", () => {
  it("★ hai lần liên tiếp (2 clientRequestId) ⇒ hai lần ghi tới thiết bị, hai dòng chờ, không DA_XU_LY", async () => {
    const ghiTruoc = stub.R.ghi.length;
    const k1 = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() });
    const k2 = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() });
    for (const k of [k1, k2]) expect(k.ketQua[0]).toMatchObject({ status: "acked_verified", ok: true });
    expect(stub.R.ghi.length - ghiTruoc).toBe(2);
  });

  it("★ hai người SONG SONG ⇒ cả hai gửi", async () => {
    const ghiTruoc = stub.R.ghi.length;
    const [a, b] = await Promise.all([
      nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() }),
      nguoi.opB.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() }),
    ]);
    for (const k of [a, b]) expect(k.ketQua[0]).toMatchObject({ adapterId: ad.R, ok: true, status: "acked_verified" });
    expect(stub.R.ghi.length - ghiTruoc).toBe(2);
  });

  it("gửi lại CÙNG clientRequestId (client thử lại) ⇒ VẪN gửi, không lỗi trùng khoá", async () => {
    const id = uuid();
    const ghiTruoc = stub.R.ghi.length;
    await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: id });
    const lai = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: id });
    expect(lai.ketQua[0]).toMatchObject({ ok: true, status: "acked_verified" });
    expect(stub.R.ghi.length - ghiTruoc).toBe(2);
  });
});

describe("từ chối", () => {
  it("★ máy không ghim ⇒ CHUA_GHIM_STOP (SCADA_STOP_NOT_PINNED) + ĐÚNG 1 dòng attempts; không dispatch", async () => {
    const m = await moc();
    const dTruoc = H.dispatchInputs.length;
    const loi = await loiCua(nguoi.opA2.caller.dungMay({ machineId: may.N.mid, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } });
    const thu = await thuSau(m, nguoi.opA2.id);
    expect(thu).toHaveLength(1);
    expect(thu[0]).toMatchObject({ stage: "dispatch", outcome: "rejected", reason_code: "CHUA_GHIM_STOP", adapter_id: null });
    expect((await lyDoSau(m, nguoi.opA2.id))[0]).toContain("E-STOP");
    expect(H.dispatchInputs.length - dTruoc).toBe(0);
  });

  it("★ viewer ngoài phạm vi ⇒ CÙNG NOT_FOUND như máy không tồn tại", async () => {
    const ngoai = await loiCua(nguoi.viewerX.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() }));
    const khong = await loiCua(nguoi.opA2.caller.dungMay({ machineId: 2_000_000_000, clientRequestId: uuid() }));
    expect(ngoai).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "machine", ma: "NOT_FOUND" } });
    expect(ngoai).toEqual(khong);
  });

  it("viewer TRONG phạm vi ⇒ ROLE_FLOOR (dưới sàn mức 1), không dispatch", async () => {
    const dTruoc = H.dispatchInputs.length;
    const loi = await loiCua(nguoi.viewerA.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", appParams: { ma: "ROLE_FLOOR", level: 1 } });
    expect(H.dispatchInputs.length - dTruoc).toBe(0);
  });
});

describe("R1b-1 T7 fix round 1 — NUL trong lyDo của dungMay (I-1)", () => {
  // Phán quyết bộ điều khiển (rà soát lại T7 vòng 1): STOP KHÔNG BAO GIỜ bị từ chối vì chữ lý do — router không BAD_REQUEST
  // trên NUL / ký tự điều khiển / >300 ký tự; service lọc + cắt (catLyDo) rồi đi tiếp tới cổng thật.
  it("router: lyDo chứa NUL / dài 400 ký tự ⇒ KHÔNG BAD_REQUEST — tới cổng thật (máy chưa ghim ⇒ CHUA_GHIM_STOP có mã); ly_do đã lọc + cắt 300", async () => {
    const m = await moc();
    const loi = await loiCua(nguoi.opA2.caller.dungMay({ machineId: may.N.mid, lyDo: "ab\u0000cd", clientRequestId: uuid() }));
    expect(loi).toMatchObject({ code: "PRECONDITION_FAILED", appParams: { ma: "CHUA_GHIM_STOP" } });
    const loi2 = await loiCua(nguoi.opA2.caller.dungMay({ machineId: may.N.mid, lyDo: "x".repeat(400), clientRequestId: uuid() }));
    expect(loi2).toMatchObject({ code: "PRECONDITION_FAILED", appParams: { ma: "CHUA_GHIM_STOP" } });
    const ly = await lyDoSau(m, nguoi.opA2.id);
    expect(ly).toHaveLength(2);
    expect(ly[0]).toBe("abcd");
    expect(ly[1]).toHaveLength(300);
  });
  it("service (qua mặt zod): lyDo có NUL + máy chưa ghim ⇒ từ chối CHUA_GHIM_STOP có mã; dòng attempts ghi ly_do đã LỌC NUL", async () => {
    const { dungMayHmi } = await import("../services/scada/lenhHmi");
    const m = await moc();
    const kq = await dungMayHmi(
      { user: { id: nguoi.opA2.id, role: "operator", twoFactorEnabled: true } },
      { userId: nguoi.opA2.id, userRole: "operator" },
      { machineId: may.N.mid, lyDo: "ket\u0000 bang tai", clientRequestId: uuid() },
    );
    expect(kq).toMatchObject({ ok: false, tuChoi: { ma: "CHUA_GHIM_STOP" } });
    expect(await lyDoSau(m, nguoi.opA2.id)).toEqual(["ket bang tai"]);
  });
});

describe("AI không bao giờ đi đường hmi.stop", () => {
  it("★ aiCopilot.confirmAction trên một dòng hmi.stop ⇒ not_found như mọi hmi.*; trạng thái giữ nguyên; tool không có trong registry AI", async () => {
    expect(getTool("hmi.stop")).toBeUndefined();
    const id = uuid();
    await dung(sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, status, "idempotencyKey", "expiresAt")
      VALUES (${id}, 'hmi.stop', ${JSON.stringify({ adapterId: ad.R, machineId: may.R.mid, commandType: "stop", writes: GHIM_R })}::json,
        ${nguoi.opA2.id}, 'operator', 'r1b2 hmi.stop', 'confirmed', ${`${RUN}:ai:${id}`}, now() + interval '30 seconds')`);
    const kq = await confirmAction(id, id, { id: nguoi.opA2.id, role: "operator", name: "R1B2" } as never, "vi");
    expect(kq).toMatchObject({ ok: false, status: "not_found" });
    expect((await dongChoHmiStop(id))?.status).toBe("confirmed");
  });
});

describe("audit bắt buộc — MỘT recordAuditEvent mỗi lần bấm", () => {
  it("★ ai bấm, máy, từng adapter + giá trị ghim đã gửi + kết quả (status, edgeStopRequest)", async () => {
    const a = await mocAudit();
    const crid = uuid();
    const kq = await nguoi.opA.caller.dungMay({ machineId: may.R.mid, clientRequestId: crid });
    const rows = await choAudit(a, may.R.mid, crid);
    expect(rows).toHaveLength(1);
    const au = rows[0];
    expect(au).toMatchObject({ entityType: "machine", entityId: String(may.R.mid), action: "scada_hmi_stop", actorId: nguoi.opA.id, reason: "HMI DỪNG MÁY" });
    expect(au.afterJson).toMatchObject({
      ketCuc: "DA_GUI",
      nguoiBam: { userId: nguoi.opA.id, role: "operator" },
      machineId: may.R.mid,
      machineCode: may.R.code,
      adapters: [
        {
          adapterId: ad.R,
          ghimDaGui: GHIM_R,
          status: "acked_verified",
          ok: true,
          simulated: false,
          edgeStopRequest: false,
          commandLogIds: kq.ketQua[0].commandLogIds,
        },
      ],
    });
  });

  it("máy edge ⇒ audit ghi edgeStopRequest true; máy không ghim ⇒ audit ketCuc CHUA_GHIM_STOP, adapters rỗng", async () => {
    (await import("../services/edge/edgeNodeCommands")).noteEdgeNodePull(edgeNodeId);
    const a = await mocAudit();
    const c1 = uuid();
    await nguoi.opA2.caller.dungMay({ machineId: may.E.mid, clientRequestId: c1 });
    const [e] = await choAudit(a, may.E.mid, c1);
    expect(e.afterJson.adapters).toEqual([expect.objectContaining({ adapterId: ad.E, edgeStopRequest: true, ghimDaGui: [{ tagKey: "stop_cmd", value: true }] })]);
    const c2 = uuid();
    await loiCua(nguoi.opA2.caller.dungMay({ machineId: may.N.mid, clientRequestId: c2 }));
    const [n] = await choAudit(a, may.N.mid, c2);
    expect(n.afterJson).toMatchObject({ ketCuc: "CHUA_GHIM_STOP", adapters: [] });
  });
});

describe("scadaKenh.cheDo.danhSach — cờ coGhimStop cho cảnh báo cấp máy", () => {
  it("★ R/L/E có ghim (R: 1 adapter — adapter tắt không tính), N không ghim", async () => {
    const { scadaKenhRouter } = await import("./scadaKenhRouter");
    const c = scadaKenhRouter.createCaller({ user: { id: nguoi.opA2.id, role: "operator", name: "x", twoFactorEnabled: true } } as never);
    const rows = (await c.cheDo.danhSach()) as Array<{ machineId: number; coGhimStop: boolean; soAdapterGhimStop: number }>;
    const theo = (id: number) => rows.find((r) => r.machineId === id);
    expect(theo(may.R.mid)).toMatchObject({ coGhimStop: true, soAdapterGhimStop: 1 });
    expect(theo(may.L.mid)).toMatchObject({ coGhimStop: true, soAdapterGhimStop: 1 });
    expect(theo(may.E.mid)).toMatchObject({ coGhimStop: true, soAdapterGhimStop: 1 });
    expect(theo(may.N.mid)).toMatchObject({ coGhimStop: false, soAdapterGhimStop: 0 });
  });
});

describe("fix round 1 (important 2) — audit treo KHÔNG giữ kết quả STOP", () => {
  it("★ recordAuditEvent không bao giờ trả lời ⇒ dungMay vẫn trả kết quả ngay (< 3 s), STOP đã tới thiết bị", async () => {
    H.auditTreo = true;
    try {
      const ghiTruoc = stub.R.ghi.length;
      const t0 = Date.now();
      const kq = await nguoi.opA2.caller.dungMay({ machineId: may.R.mid, clientRequestId: uuid() });
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.R, status: "acked_verified", ok: true });
      expect(stub.R.ghi.length - ghiTruoc).toBe(1);
      // máy không ghim: lời từ chối cũng không chờ sổ
      const t1 = Date.now();
      const loi = await loiCua(nguoi.opA2.caller.dungMay({ machineId: may.N.mid, clientRequestId: uuid() }));
      expect(Date.now() - t1).toBeLessThan(3_000);
      expect(loi.appCode).toBe("SCADA_STOP_NOT_PINNED");
    } finally {
      H.auditTreo = false;
    }
  });
});

describe("fix round 1 — khảo sát khả năng dừng (khaoSatKhaNangDung, MỘT kết luận / adapter theo thứ tự dispatchCore)", () => {
  const ks = async (machineId: number) => (await import("../services/scada/khaNangDung")).khaoSatKhaNangDung(db, machineId);

  it("★ duoc: driver + vân tay khớp + OT bật + (không đòi nghiệm thu) ⇒ duoc; tongHop của máy R: 'mot_phan' (R2 bật mà chưa ghim)", async () => {
    const k = await ks(may.R.mid);
    expect(k.adapters.map((a) => [a.adapterId, a.trangThai, a.lyDo ?? null])).toEqual([
      [ad.R, "duoc", null],
      [ad.R2, "chua_ghim", null],
    ]); // Rtat (tắt) không có mặt
    expect(k.tongHop).toBe("mot_phan");
    expect((await ks(may.L.mid)).tongHop).toBe("duoc");
  });

  it("★ chua_ghim: máy N ⇒ mọi adapter chua_ghim, tongHop 'khong'", async () => {
    const k = await ks(may.N.mid);
    expect(k.adapters).toEqual([{ adapterId: ad.N, code: `${RUN}-n`, trangThai: "chua_ghim" }]);
    expect(k.tongHop).toBe("khong");
  });

  it("★ qua_edge (fix round 2): adapter do edge sở hữu ⇒ qua_edge + mã node + tới được; KHÔNG tính là duoc (tongHop 'khong'); node không liên lạc được ⇒ edgeToiDuoc false", async () => {
    const ec = await import("../services/edge/edgeNodeCommands");
    ec.noteEdgeNodePull(edgeNodeId);
    const k = await ks(may.E.mid);
    expect(k.adapters).toEqual([{ adapterId: ad.E, code: `${RUN}-e`, trangThai: "qua_edge", edgeCode: `${RUN}-en`, edgeToiDuoc: true }]);
    expect(k.tongHop).toBe("khong");
    ec.__resetEdgeNodePullsForTests(); // không lượt kéo, heartbeat NULL ⇒ không tới được
    expect((await ks(may.E.mid)).adapters[0]).toMatchObject({ trangThai: "qua_edge", edgeToiDuoc: false });
  });

  it("★ ghim_cu: vân tay kết nối ĐANG CHẠY khác hàng adapter (sửa adapter chưa nối lại) ⇒ ghim_cu (CHỈ vân tay cũ); không driver ⇒ mat_ket_noi (fix round 2)", async () => {
    const that = H.fingerprints.get(ad.L)!;
    H.fingerprints.set(ad.L, "van-tay-cua-thiet-bi-cu");
    try {
      expect((await ks(may.L.mid)).adapters[0]).toEqual({ adapterId: ad.L, code: `${RUN}-l`, trangThai: "ghim_cu" });
    } finally {
      H.fingerprints.set(ad.L, that);
    }
    const drv = H.drivers.get(ad.L);
    H.drivers.delete(ad.L);
    try {
      const k = await ks(may.L.mid);
      expect(k.adapters[0]).toEqual({ adapterId: ad.L, code: `${RUN}-l`, trangThai: "mat_ket_noi" });
      expect(k.tongHop).toBe("khong");
    } finally {
      H.drivers.set(ad.L, drv);
    }
  });

  it("★ mo_phong: OT_CONTROL tắt ⇒ 'ot_control_tat'; đòi nghiệm thu mà adapter chưa có bản ký ⇒ 'chua_nghiem_thu'; có bản ký ⇒ duoc", async () => {
    vi.stubEnv("OT_CONTROL_ENABLED", "false");
    try {
      expect((await ks(may.L.mid)).adapters[0]).toMatchObject({ trangThai: "mo_phong", lyDo: "ot_control_tat" });
    } finally {
      vi.stubEnv("OT_CONTROL_ENABLED", "true");
    }
    vi.stubEnv("OT_COMMISSIONING_REQUIRED", "true");
    try {
      expect((await ks(may.L.mid)).adapters[0]).toMatchObject({ trangThai: "mo_phong", lyDo: "chua_nghiem_thu" });
      await dung(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${ad.L}, 'active', 1, ${RUN})`);
      expect((await ks(may.L.mid)).adapters[0]).toMatchObject({ trangThai: "duoc" });
    } finally {
      vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
      await dung(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${ad.L}`).catch(() => undefined);
    }
  });

  it("★ khaNangDung có trong hàng scadaKenh.cheDo.danhSach (cùng hàm)", async () => {
    const { scadaKenhRouter } = await import("./scadaKenhRouter");
    const c = scadaKenhRouter.createCaller({ user: { id: nguoi.opA2.id, role: "operator", name: "x", twoFactorEnabled: true } } as never);
    const rows = (await c.cheDo.danhSach()) as Array<{ machineId: number; khaNangDung: { tongHop: string; adapters: Array<{ trangThai: string }> } }>;
    const r = rows.find((x) => x.machineId === may.R.mid)!;
    expect(r.khaNangDung).toEqual(await ks(may.R.mid));
    expect(rows.find((x) => x.machineId === may.N.mid)!.khaNangDung.tongHop).toBe("khong");
  });
});

describe("fix round 2 — khảo sát không bao giờ làm hỏng danh sách; nhánh STOP dự phòng khi edge không nhận", () => {
  const kn = () => import("../services/scada/khaNangDung");

  it("★ khong_kiem_duoc: isCommissioned NÉM ⇒ adapter đó khong_kiem_duoc (KHÔNG duoc), cheDo.danhSach vẫn trả đủ máy", async () => {
    vi.stubEnv("OT_COMMISSIONING_REQUIRED", "true");
    H.commNem = true;
    try {
      const k = await (await kn()).khaoSatKhaNangDung(db, may.L.mid);
      expect(k.adapters).toEqual([{ adapterId: ad.L, code: `${RUN}-l`, trangThai: "khong_kiem_duoc" }]);
      expect(k.tongHop).toBe("khong");
      const { scadaKenhRouter } = await import("./scadaKenhRouter");
      const c = scadaKenhRouter.createCaller({ user: { id: nguoi.opA2.id, role: "operator", name: "x", twoFactorEnabled: true } } as never);
      const rows = (await c.cheDo.danhSach()) as Array<{ machineId: number; khaNangDung: { adapters: Array<{ trangThai: string }> } }>;
      expect(rows.find((r) => r.machineId === may.L.mid)!.khaNangDung.adapters[0].trangThai).toBe("khong_kiem_duoc");
      expect(rows.find((r) => r.machineId === may.N.mid)!.khaNangDung.adapters[0].trangThai).toBe("chua_ghim"); // không ghim ⇒ không đọc nghiệm thu
    } finally {
      H.commNem = false;
      vi.stubEnv("OT_COMMISSIONING_REQUIRED", "false");
    }
  });

  it("★ lỗi đọc CHUNG (adapter/ghim) ⇒ mọi máy loiKhaoSat, adapters rỗng, tongHop 'khong' — không ném", async () => {
    const hong = { execute: async () => Promise.reject(new Error("db down")), select: () => { throw new Error("db down"); } } as never;
    const m = await (await kn()).khaoSatKhaNangDungNhieu(hong, [may.R.mid, may.L.mid]);
    expect([...m.values()]).toEqual([
      { machineId: may.R.mid, adapters: [], tongHop: "khong", loiKhaoSat: true },
      { machineId: may.L.mid, adapters: [], tongHop: "khong", loiKhaoSat: true },
    ]);
  });

  it("★ edge không nhận hàng đợi ⇒ STOP dự phòng của trung tâm ĐÃ gửi ⇒ dòng chờ 'executed' + centralFallbackStop trong resultJson; kết quả centralFallbackSent", async () => {
    H.enqueueNem = true;
    try {
      const kq = await nguoi.opA2.caller.dungMay({ machineId: may.E.mid, clientRequestId: uuid() });
      expect(kq.ketQua[0]).toMatchObject({ adapterId: ad.E, reason: "ADAPTER_OWNED_BY_EDGE", centralFallbackSent: true, ok: false });
      expect(kq.ketQua[0].edgeStopRequest).toBeUndefined();
      expect(H.fallback).toContain(ad.E);
      const actionId = (H.dispatchInputs.at(-1)!.triggeredBy as { actionId: string }).actionId;
      const [cho] = await dung(sql`SELECT status::text AS status, "resultJson" FROM ai_pending_actions WHERE id = ${actionId}`);
      expect(cho.status).toBe("executed");
      expect(cho.resultJson).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", centralFallbackStop: { sent: true } });
    } finally {
      H.enqueueNem = false;
    }
  });
});

describe("fix round 3 — hạn đọc node edge, bộ nhớ đệm theo lượt, khảo sát lỗi ⇒ KHÔNG BIẾT (null)", () => {
  const kn = () => import("../services/scada/khaNangDung");

  it("★ đọc 'node edge tới được không' TREO ⇒ khảo sát vẫn trả nhanh (< 3 s), qua_edge + edgeToiDuoc false (cảnh báo); cheDo.danhSach không treo", async () => {
    H.reachTreo = true;
    try {
      const t0 = Date.now();
      const k = await (await kn()).khaoSatKhaNangDung(db, may.E.mid);
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(k.adapters[0]).toMatchObject({ adapterId: ad.E, trangThai: "qua_edge", edgeToiDuoc: false });
      const { scadaKenhRouter } = await import("./scadaKenhRouter");
      const c = scadaKenhRouter.createCaller({ user: { id: nguoi.opA2.id, role: "operator", name: "x", twoFactorEnabled: true } } as never);
      const t1 = Date.now();
      await c.cheDo.danhSach();
      expect(Date.now() - t1).toBeLessThan(3_000);
    } finally {
      H.reachTreo = false;
    }
  });

  it("★ hai adapter cùng node edge ⇒ MỘT lượt hỏi trong một lần khảo sát", async () => {
    const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "edgeNodeId")
      VALUES (${may.E.mid}, ${`${RUN}-e2`}, ${`${RUN}-e2`}, 'stub', ${`stub://${RUN}-e2`}, 60000, true, 'disabled', ${edgeNodeId}) RETURNING id`);
    const e2 = Number(r.id);
    try {
      await seedTag(e2, "stop_cmd", { dataType: "bool", stop: true });
      const truoc = H.reachCalls;
      const k = await (await kn()).khaoSatKhaNangDung(db, may.E.mid);
      expect(k.adapters.map((a) => a.trangThai)).toEqual(["qua_edge", "qua_edge"]);
      expect(H.reachCalls - truoc).toBe(1);
    } finally {
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${e2}`);
      await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${e2}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${e2}`);
    }
  });

  it("★ khảo sát LỖI ⇒ cheDo.danhSach: coGhimStop null + soAdapterGhimStop null (KHÔNG 'chưa ghim' / 0), khaNangDung.loiKhaoSat", async () => {
    H.khaoSatHong = true;
    try {
      const { scadaKenhRouter } = await import("./scadaKenhRouter");
      const c = scadaKenhRouter.createCaller({ user: { id: nguoi.opA2.id, role: "operator", name: "x", twoFactorEnabled: true } } as never);
      const rows = (await c.cheDo.danhSach()) as Array<{ machineId: number; coGhimStop: boolean | null; soAdapterGhimStop: number | null; khaNangDung: { loiKhaoSat?: boolean } }>;
      const r = rows.find((x) => x.machineId === may.R.mid)!;
      expect(r).toMatchObject({ coGhimStop: null, soAdapterGhimStop: null, khaNangDung: { loiKhaoSat: true } });
    } finally {
      H.khaoSatHong = false;
    }
  });
});
