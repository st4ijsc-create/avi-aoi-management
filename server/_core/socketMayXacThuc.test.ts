/**
 * socketMayXacThuc.test.ts — ★★★ doc 81 Đợt 1B Task 9 (gộp Đợt 1 Task 10): SOCKET MÁY KHÔNG CÒN VÔ DANH.
 *
 * LỖI ĐƯỢC GHIM (BE3 §L4b, đo sống): `SOCKET_MACHINE_AUTH_MODE` vắng trong `.env` ⇒ mặc định `off` ⇒
 * `machine:confirm_mapping` KHÔNG kiểm gì: 1.000 socket vô danh vào phòng `machine:17119`, nhận 100 %
 * telemetry, đánh dấu máy online; bão 1.000 sự kiện ⇒ 1.000 INSERT, pool DB bão hoà, ingest treo 18,3 s.
 *
 * ★ Harness Đợt 0 (như socketPhongQuyen.test.ts): socket.io THẬT trên 127.0.0.1 cổng 0, `initializeSocket`
 *   THẬT, handshake THẬT, phòng THẬT, `emitTelemetrySamples` THẬT. Không nối :3000 / broker / DB dev.
 * ★ INSERT được đếm bằng spy `db.createMachineStatusLog` (hàm DUY NHẤT ghi `machine_status_logs` trên đường
 *   socket); DB tra cứu đếm bằng spy `getMachineById`/`getMachineByCode`.
 * ★ Khoá `mk_` đi qua `authenticateMachine` THẬT: bảng `api_keys` giả trả hàng khi tham số WHERE bằng
 *   SHA-256 của khoá — tính ĐỘC LẬP bằng node:crypto trong tệp này (không gọi hashMachineKey của sản phẩm).
 * ★ Mọi ca âm tính có đối chứng dương trong cùng ca (một socket hợp lệ NHẬN cùng gói).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { PgDialect } from "drizzle-orm/pg-core";

// ── Người dùng giả theo cookie `phien=<id>` (handshake trình duyệt THẬT gọi sdk.authenticateRequest). ──
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      return m && Number(m[1]) === 1 ? { id: 1, role: "admin", name: "admin" } : null;
    }),
  },
}));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return { ...goc, getDb: vi.fn(async () => null) };
});

// ── Máy + khoá. Khoá mk_ là CHUỖI CỐ ĐỊNH; băm bằng node:crypto ở đây (oracle độc lập). ──
const K_17119 = "mk_live_" + "a1".repeat(24);
const K_200 = "mk_live_" + "b2".repeat(24);
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const MAY: Record<number, any> = {
  17119: { id: 17119, code: "M-17119", name: "May 17119", machineType: "AOI", apiKey: null, isActive: true, stationId: null, registrationStatus: "approved", syncMode: "realtime" },
  200: { id: 200, code: "M-200", name: "May 200", machineType: "AOI", apiKey: null, isActive: true, stationId: null, registrationStatus: "approved", syncMode: "realtime" },
  // Máy còn khoá dùng chung plaintext (chưa xoay) — chịu MACHINE_SHARED_KEY_ALLOWED (mặc định deny).
  300: { id: 300, code: "M-300", name: "May 300", machineType: "AOI", apiKey: "mach_legacy_300", isActive: true, stationId: null, registrationStatus: "approved", syncMode: "realtime" },
  // Máy NGỪNG hoạt động còn khoá plaintext — fix round 1 mục 6 (đường từng-sự-kiện phải kiểm isActive).
  301: { id: 301, code: "M-301", name: "May 301", machineType: "AOI", apiKey: "mach_inactive_301", isActive: false, stationId: null, registrationStatus: "approved", syncMode: "realtime" },
  // Máy chờ onboarding qua socket (register → approve) — fix round 1 mục 2 (R18).
  500: { id: 500, code: "M-500", name: "May 500", machineType: "AOI", apiKey: null, isActive: true, stationId: null, registrationStatus: "pending", syncMode: "realtime", serialNumber: null, firmwareVersion: null },
};
const BANG_KHOA: any[] = [
  { id: 5, machineId: 17119, keyHash: sha256(K_17119), isActive: true, revokedAt: null, expiresAt: null, scopes: [] },
  { id: 6, machineId: 200, keyHash: sha256(K_200), isActive: true, revokedAt: null, expiresAt: null, scopes: [] },
];
const dialect = new PgDialect();
const dbKhoaGia = {
  select: () => ({
    from: () => ({
      where: (cond: any) => ({
        limit: async () => {
          const { params } = dialect.sqlToQuery(cond);
          return BANG_KHOA.filter((r) => r.keyHash === params[0]);
        },
      }),
    }),
  }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  // issueMachineKey THẬT ghi vào đây (fix round 1 mục 2): lưu đúng HÀNG sản phẩm đưa xuống.
  insert: () => ({
    values: (v: any) => ({
      returning: async () => {
        const row = { id: 1000 + BANG_KHOA.length, revokedAt: null, lastUsedAt: null, createdAt: new Date(), ...v };
        BANG_KHOA.push(row);
        return [row];
      },
    }),
  }),
};

const createMachineStatusLog = vi.fn(async (_x: any) => undefined);
/** final wave (item 6) — auditTrailService.logCrudOperation ghi qua db.createAuditLog: đếm + soi nội dung ở đây. */
const createAuditLog = vi.fn(async (_x: any) => ({ id: 1 }));
const updateMachine = vi.fn(async (..._a: any[]) => undefined);
const getMachineById = vi.fn(async (id: number) => (MAY[id] ? { ...MAY[id] } : undefined));
const getMachineByCode = vi.fn(async (code: string) => {
  const m = Object.values(MAY).find((x: any) => x.code === code && x.isActive);
  return m ? { ...m } : undefined;
});
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: (...a: any[]) => (createMachineStatusLog as any)(...a),
  createAuditLog: (...a: any[]) => (createAuditLog as any)(...a),
  getMachineById: (...a: any[]) => (getMachineById as any)(...a),
  getMachineByCode: (...a: any[]) => (getMachineByCode as any)(...a),
  getMachineByApiKey: vi.fn(async (k: string) => Object.values(MAY).find((x: any) => x.apiKey === k)),
  updateMachine: (...a: any[]) => (updateMachine as any)(...a),
  getLineByStationId: vi.fn(async () => undefined),
  getUnreadNotificationCount: vi.fn(async () => 0),
  createNotification: vi.fn(),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  getDb: vi.fn(async () => dbKhoaGia),
}));

const setOnline = vi.fn(async (_x: any) => undefined);
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: (...a: any[]) => (setOnline as any)(...a),
    setOffline: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    listOnline: vi.fn(async () => []),
    listOnlineCodes: vi.fn(async () => []),
  }),
}));
vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./eventBus", () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), publish: vi.fn(), subscribe: vi.fn(() => () => {}) },
  EventTypes: {},
}));
vi.mock("../services/ecosystem/ecosystemEvents", () => ({ toEcosystemEvent: () => null, isAlertKind: () => false }));
vi.mock("../services/stateStore/stateStore", () => ({ stateStoreEnabled: () => false }));
vi.mock("../services/stateStore/ingest", () => ({
  stateStoreOnMachineStatus: vi.fn(),
  stateStoreOnMachineSocketDisconnect: vi.fn(),
  trackMachineSocket: vi.fn(),
}));
vi.mock("../services/stateStore/unsStreamGateway", () => ({ registerUnsStreamHandlers: vi.fn() }));
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../db/reportAggregators", () => ({ resolveTenantFactoryScope: vi.fn(async () => ({ factoryIds: null })) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

type SocketMod = typeof import("./socket");
let socketMod: SocketMod;
let authMod: typeof import("./socketMachineAuth");
let rlMod: typeof import("./socketMachineRateLimit");
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const ENV_KHOA = [
  "SOCKET_MACHINE_AUTH_MODE",
  "MACHINE_SHARED_KEY_ALLOWED",
  "SOCKET_MACHINE_EVENT_RATE_PER_SOCKET",
  "SOCKET_MACHINE_EVENT_RATE_PER_IP",
  "MACHINE_CRED_MK_ONLY_ENABLED",
] as const;
const ENV_GOC: Record<string, string | undefined> = Object.fromEntries(ENV_KHOA.map((k) => [k, process.env[k]]));

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Hạn giờ TƯỜNG MINH — treo phải thành một khẳng định đỏ, không phải vitest timeout. */
function trongHan<T>(p: Promise<T>, ms: number, nhan: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`QUA HAN ${ms}ms: ${nhan}`)), ms)),
  ]);
}

function ketNoi(opts: { auth?: Record<string, unknown>; phien?: number }): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: opts.auth ?? {},
    extraHeaders: opts.phien != null ? { cookie: `phien=${opts.phien}` } : {},
  });
  clients.push(c);
  return trongHan(
    new Promise((resolve, reject) => {
      c.once("connect", () => resolve(c));
      c.once("connect_error", (e) => reject(e));
    }),
    3000,
    "ket noi socket",
  );
}
const mayVoDanh = () => ketNoi({ auth: { clientType: "machine" } });
const mayCoKhoa = (machineCode: string, apiKey: string) => ketNoi({ auth: { clientType: "machine", machineCode, apiKey } });

function phongCua(c: ClientSocket): string[] {
  const sk = socketMod.getIO()!.sockets.sockets.get(c.id!);
  if (!sk) throw new Error(`không thấy socket server ${c.id}`);
  return [...sk.rooms].filter((r) => r !== c.id).sort();
}
function ghiNhan(c: ClientSocket, evt: string): any[] {
  const arr: any[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}
function mauTelemetry(machineId: number) {
  return {
    machineId, deviceId: null, protocol: "test", metric: "temp", numValue: 42, textValue: null,
    boolValue: null, unit: "C", quality: "good", ts: new Date().toISOString(),
  } as any;
}
const insertCho = (machineId: number) => createMachineStatusLog.mock.calls.filter((c) => c[0]?.machineId === machineId).length;
const onlineCho = (machineId: number) => setOnline.mock.calls.filter((c) => c[0]?.machineId === machineId).length;

/** Quan sát viên admin (trình duyệt): ở `global` + `admin` để thấy machine:connected / status_update. */
async function quanSatVien() {
  const ad = await ketNoi({ phien: 1 });
  ad.emit("subscribe", {});
  ad.emit("admin:join");
  await vi.waitFor(() => expect(phongCua(ad)).toEqual(["admin", "global"]), { timeout: 2000 });
  return { ad, ketNoiMay: ghiNhan(ad, "machine:connected"), capNhat: ghiNhan(ad, "machine:status_update") };
}

beforeAll(async () => {
  for (const k of ENV_KHOA) delete process.env[k]; // MẶC ĐỊNH TRONG MÃ — đúng như .env hiện tại (vắng cờ)
  socketMod = await import("./socket");
  authMod = await import("./socketMachineAuth");
  rlMod = await import("./socketMachineRateLimit");
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  await import("../services/notificationService");
  await cho(50);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => socketMod.getIO()!.close(() => r()));
  for (const [k, v] of Object.entries(ENV_GOC)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, "warn");
});
beforeEach(() => {
  for (const k of ENV_KHOA) delete process.env[k];
  (rlMod as any)?._resetGioiHanSuKienMay?.();
  authMod._resetSocketMachineAuthState();
});
afterEach(async () => {
  while (clients.length) clients.pop()!.disconnect();
  await cho(30); // để disconnect server-side chạy xong trước ca sau
  warnSpy.mockClear();
  createMachineStatusLog.mockClear();
  updateMachine.mockClear();
  getMachineById.mockClear();
  getMachineByCode.mockClear();
  setOnline.mockClear();
});

describe("★★★ Task 9 — mặc định trong mã là enforce (R6), .env vắng cờ", () => {
  it("(0) env vắng ⇒ enforce; giá trị gõ sai ⇒ vẫn enforce (không mở cửa im lặng); `off` đặt được qua env", () => {
    expect(authMod.socketMachineAuthMode()).toBe("enforce");
    process.env.SOCKET_MACHINE_AUTH_MODE = "enforced";
    expect(authMod.socketMachineAuthMode()).toBe("enforce");
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    expect(authMod.socketMachineAuthMode()).toBe("off");
  });

  it("(1) ★ socket VÔ DANH gửi confirm_mapping ⇒ KHÔNG vào machine:17119, KHÔNG nhận telemetry, KHÔNG INSERT, KHÔNG online, nhận machine:auth_error; đối chứng: máy 200 có khoá NHẬN telemetry của nó", async () => {
    const { ketNoiMay, capNhat } = await quanSatVien();
    const b = await mayCoKhoa("M-200", K_200);
    b.emit("machine:confirm_mapping", {});
    await vi.waitFor(() => expect(phongCua(b)).toEqual(["machine:200"]), { timeout: 2000 });

    const voDanh = await mayVoDanh();
    const loi = ghiNhan(voDanh, "machine:auth_error");
    const telVoDanh = ghiNhan(voDanh, "telemetry:sample");
    const telB = ghiNhan(b, "telemetry:sample");
    voDanh.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: "bat-ky" });
    voDanh.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119" }); // không apiKey
    await vi.waitFor(() => expect(loi.length).toBe(2), { timeout: 2000 });
    expect(loi[0]).toMatchObject({ event: "machine:confirm_mapping", code: "MACHINE_SOCKET_UNAUTHORIZED" });
    expect(phongCua(voDanh)).toEqual([]);

    socketMod.emitTelemetrySamples([mauTelemetry(17119), mauTelemetry(200)]);
    await vi.waitFor(() => expect(telB.length).toBe(1), { timeout: 2000 });
    await cho(100);
    expect(telVoDanh).toEqual([]);
    expect(insertCho(17119)).toBe(0);
    expect(onlineCho(17119)).toBe(0);
    expect(ketNoiMay.filter((g) => g.machineId === 17119)).toEqual([]);

    // heartbeat vô danh ⇒ lỗi, không phát status_update
    voDanh.emit("machine:heartbeat", { machineId: 17119, status: "running" });
    await vi.waitFor(() => expect(loi.length).toBe(3), { timeout: 2000 });
    expect(loi[2]).toMatchObject({ event: "machine:heartbeat" });
    await cho(100);
    expect(capNhat.filter((g) => g.machineId === 17119)).toEqual([]);
  });

  it("(2) ★ khoá mk_ ĐÚNG trong handshake ⇒ như cũ: vào machine:17119, nhận telemetry, 1 INSERT, online (mã máy lấy từ DB), heartbeat phát status_update", async () => {
    const { ketNoiMay, capNhat } = await quanSatVien();
    const may = await mayCoKhoa("M-17119", K_17119);
    const tel = ghiNhan(may, "telemetry:sample");
    const loi = ghiNhan(may, "machine:auth_error");
    may.emit("machine:confirm_mapping", { machineCode: "GIA-MAO" }); // payload machineCode KHÔNG được tin
    await vi.waitFor(() => expect(phongCua(may)).toEqual(["machine:17119"]), { timeout: 2000 });
    await vi.waitFor(() => expect(ketNoiMay.length).toBe(1), { timeout: 2000 });
    expect(ketNoiMay[0]).toMatchObject({ machineId: 17119, machineCode: "M-17119" });
    expect(insertCho(17119)).toBe(1);
    expect(setOnline).toHaveBeenCalledWith(expect.objectContaining({ machineId: 17119, machineCode: "M-17119" }));

    socketMod.emitTelemetrySamples([mauTelemetry(17119)]);
    await vi.waitFor(() => expect(tel.length).toBe(1), { timeout: 2000 });

    may.emit("machine:heartbeat", { status: "running" });
    await vi.waitFor(() => expect(capNhat.filter((g) => g.machineId === 17119).length).toBe(1), { timeout: 2000 });
    expect(loi).toEqual([]);
  });

  it("(3) giao thức TỪNG SỰ KIỆN (không khoá ở handshake, apiKey trong payload — dạng scripts/test_machine_websocket.py) với mk_ đúng ⇒ vẫn chạy như cũ", async () => {
    const { capNhat } = await quanSatVien();
    const may = await mayVoDanh();
    may.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    await vi.waitFor(() => expect(phongCua(may)).toEqual(["machine:17119"]), { timeout: 2000 });
    expect(insertCho(17119)).toBe(1);
    may.emit("machine:heartbeat", { machineId: 17119, status: "running" });
    await vi.waitFor(() => expect(capNhat.filter((g) => g.machineId === 17119).length).toBe(1), { timeout: 2000 });
  });

  it("(4) ★ khoá SAI ⇒ bị từ chối: handshake sai khoá / khoá của máy khác / mã máy lạ / mã không kèm khoá ⇒ connect_error; từng-sự-kiện sai khoá ⇒ auth_error, không phòng, không INSERT", async () => {
    await expect(mayCoKhoa("M-17119", "mk_live_" + "00".repeat(24))).rejects.toThrow(/MACHINE_UNAUTHORIZED/);
    await expect(mayCoKhoa("M-17119", K_200)).rejects.toThrow(/MACHINE_UNAUTHORIZED/);
    await expect(mayCoKhoa("KHONG-CO", K_17119)).rejects.toThrow(/MACHINE_UNAUTHORIZED/);
    await expect(ketNoi({ auth: { clientType: "machine", machineCode: "M-17119" } })).rejects.toThrow(/MACHINE_UNAUTHORIZED/);
    // đối chứng: cùng harness, khoá đúng thì vào được
    const dung = await mayCoKhoa("M-17119", K_17119);
    expect(dung.connected).toBe(true);

    const may = await mayVoDanh();
    const loi = ghiNhan(may, "machine:auth_error");
    may.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: K_200 });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 2000 });
    expect(phongCua(may)).toEqual([]);
    expect(insertCho(17119)).toBe(0);
  });

  it("(5) ★ id trong payload KHÔNG được tin: socket đã gắn máy 200 gửi confirm_mapping/heartbeat/sync_started cho 17119 (kể cả kèm khoá đúng của 17119) ⇒ từ chối, không phòng/INSERT/updateMachine cho 17119", async () => {
    const { capNhat } = await quanSatVien();
    const b = await mayCoKhoa("M-200", K_200);
    const loi = ghiNhan(b, "machine:auth_error");
    const syncLoi = ghiNhan(b, "machine:sync_error");
    b.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    b.emit("machine:heartbeat", { machineId: 17119, status: "running" });
    b.emit("machine:sync_started", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    await vi.waitFor(() => expect(loi.length).toBe(2), { timeout: 2000 });
    await vi.waitFor(() => expect(syncLoi.length).toBe(1), { timeout: 2000 });
    expect(phongCua(b)).not.toContain("machine:17119");
    expect(insertCho(17119)).toBe(0);
    expect(updateMachine.mock.calls.filter((c) => c[0] === 17119)).toEqual([]);
    expect(capNhat.filter((g) => g.machineId === 17119)).toEqual([]);
    // đối chứng: CHÍNH socket đó, cho CHÍNH máy của nó ⇒ đi qua
    b.emit("machine:confirm_mapping", { machineId: 200 });
    await vi.waitFor(() => expect(phongCua(b)).toEqual(["machine:200"]), { timeout: 2000 });
  });

  it("(6) sync_started: vô danh sai khoá ⇒ sync_error, không updateMachine, không phòng; socket đã gắn ⇒ sync_confirmed + updateMachine ĐÚNG máy đã gắn", async () => {
    const voDanh = await mayVoDanh();
    const loi = new Promise((r) => voDanh.once("machine:sync_error", r));
    voDanh.emit("machine:sync_started", { machineId: 17119, machineCode: "M-17119", apiKey: "sai" });
    await trongHan(loi, 2000, "sync_error");
    expect(updateMachine).not.toHaveBeenCalled();
    expect(phongCua(voDanh)).toEqual([]);

    const may = await mayCoKhoa("M-17119", K_17119);
    const ok = new Promise((r) => may.once("machine:sync_confirmed", r));
    may.emit("machine:sync_started", {});
    await trongHan(ok, 2000, "sync_confirmed");
    expect(updateMachine).toHaveBeenCalledWith(17119, expect.objectContaining({ syncMode: "online" }));
    expect(phongCua(may)).toEqual(["machine:17119"]);
  });

  it("(7) khoá dùng chung plaintext `machines.apiKey` đi qua CÙNG decideSharedMachineKey: mặc định deny ⇒ từ chối; MACHINE_SHARED_KEY_ALLOWED=true ⇒ nhận", async () => {
    await expect(mayCoKhoa("M-300", "mach_legacy_300")).rejects.toThrow(/MACHINE_UNAUTHORIZED/);
    const voDanh = await mayVoDanh();
    const loi = ghiNhan(voDanh, "machine:auth_error");
    voDanh.emit("machine:confirm_mapping", { machineId: 300, machineCode: "M-300", apiKey: "mach_legacy_300" });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 2000 });
    expect(insertCho(300)).toBe(0);

    process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
    const may = await mayCoKhoa("M-300", "mach_legacy_300");
    may.emit("machine:confirm_mapping", {});
    await vi.waitFor(() => expect(phongCua(may)).toEqual(["machine:300"]), { timeout: 2000 });
    expect(insertCho(300)).toBe(1);
  });
});

describe("★★ Task 9 — một socket = một máy", () => {
  it("(7b) socket CHƯA gắn gửi liền hai confirm_mapping với khoá đúng của HAI máy (xác thực chạy song song) ⇒ chỉ MỘT máy được gắn/vào phòng; lượt kia bị từ chối", async () => {
    const s = await mayVoDanh();
    const loi = ghiNhan(s, "machine:auth_error");
    s.emit("machine:confirm_mapping", { machineId: 200, machineCode: "M-200", apiKey: K_200 });
    s.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 2000 });
    await cho(100);
    const phong = phongCua(s);
    expect(phong).toHaveLength(1);
    expect(insertCho(200) + insertCho(17119)).toBe(1);
  });
});

describe("★★ Task 9 — `off` qua env = lối thoát, hành vi CŨ", () => {
  it("(8) SOCKET_MACHINE_AUTH_MODE=off ⇒ vô danh confirm_mapping VÀO phòng, NHẬN telemetry, INSERT, online (y như trước); handshake khoá sai vẫn nối (trường auth bị bỏ qua như cũ)", async () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    const voDanh = await mayVoDanh();
    const tel = ghiNhan(voDanh, "telemetry:sample");
    voDanh.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: "bat-ky" });
    await vi.waitFor(() => expect(phongCua(voDanh)).toEqual(["machine:17119"]), { timeout: 2000 });
    expect(insertCho(17119)).toBe(1);
    expect(onlineCho(17119)).toBe(1);
    socketMod.emitTelemetrySamples([mauTelemetry(17119)]);
    await vi.waitFor(() => expect(tel.length).toBe(1), { timeout: 2000 });
    const saiKhoa = await mayCoKhoa("M-17119", "sai");
    expect(saiKhoa.connected).toBe(true);
    expect(getMachineByCode).not.toHaveBeenCalled(); // off: handshake không tra DB
  });
});

describe("★★★ Task 9 — giới hạn tần suất machine:* (bão 1.000 sự kiện)", () => {
  /** Trần INSERT của xô token: dung lượng + nạp trong thời gian bão. */
  const tran = (L: number, ms: number) => L + Math.ceil((L * ms) / 1000);

  it("(9) ★ bão 1.000 confirm_mapping từ MỘT socket ĐÃ xác thực ⇒ INSERT ≤ trần xô (không phải 1.000); phần bị bỏ được ĐẾM; log GỘP", async () => {
    const L = rlMod.gioiHanSuKienMayMoiSocket();
    expect(L).toBe(10);
    const may = await mayCoKhoa("M-17119", K_17119);
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) may.emit("machine:confirm_mapping", {});
    // Mọi gói được xử lý = hoặc INSERT (đường gắn sẵn là đồng bộ) hoặc bị bỏ-và-đếm.
    // Mỗi gói ĐƯỢC xử lý làm mới presence (setOnline); gói bị bỏ được đếm. Fix round 1 mục 4: socket đã map
    // cùng máy ⇒ KHÔNG INSERT lặp ⇒ đúng 1 INSERT cho cả cơn bão.
    await vi.waitFor(() => expect(onlineCho(17119) + rlMod.thongKeGioiHanSuKienMay().boQua).toBe(1000), { timeout: 5000 });
    const ms = Date.now() - t0;
    const n = onlineCho(17119);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(tran(L, ms));
    expect(insertCho(17119)).toBe(1);
    expect(rlMod.thongKeGioiHanSuKienMay().boQuaTheoSocket).toBe(1000 - n);
    const dongLog = warnSpy.mock.calls.map((a: unknown[]) => a.map(String).join(" ")).filter((s: string) => /GIOI HAN machine/.test(s));
    expect(dongLog.length).toBeGreaterThanOrEqual(1);
    expect(dongLog.length).toBeLessThanOrEqual(1 + Math.floor(ms / 10_000));
    expect(dongLog.join("\n")).not.toContain(K_17119);
  });

  it("(10) ★ bão 1.000 confirm_mapping VÔ DANH (khoá rác) ⇒ 0 INSERT, và số lượt TRA DB bị chặn ở trần xô", async () => {
    const L = rlMod.gioiHanSuKienMayMoiSocket();
    const voDanh = await mayVoDanh();
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) voDanh.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119", apiKey: "rac" });
    await vi.waitFor(() => expect(getMachineById.mock.calls.length + rlMod.thongKeGioiHanSuKienMay().boQua).toBe(1000), { timeout: 5000 });
    const ms = Date.now() - t0;
    await cho(100);
    expect(insertCho(17119)).toBe(0);
    expect(getMachineById.mock.calls.length).toBeLessThanOrEqual(tran(L, ms));
  });

  it("(11) ★ lớp IP: 12 socket (mode off) mỗi socket 9 gói (DƯỚI ngưỡng socket) = 108 gói ⇒ INSERT ≤ trần xô IP", async () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    const LIP = rlMod.gioiHanSuKienMayMoiIp();
    expect(LIP).toBe(50);
    const ss: ClientSocket[] = [];
    for (let i = 0; i < 12; i++) ss.push(await mayVoDanh());
    const t0 = Date.now();
    for (const s of ss) for (let i = 0; i < 9; i++) s.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119" });
    await vi.waitFor(() => expect(insertCho(17119) + rlMod.thongKeGioiHanSuKienMay().boQua).toBe(108), { timeout: 5000 });
    const ms = Date.now() - t0;
    expect(insertCho(17119)).toBeLessThanOrEqual(tran(LIP, ms));
    expect(rlMod.thongKeGioiHanSuKienMay().boQuaTheoIp).toBeGreaterThan(0);
    expect(rlMod.thongKeGioiHanSuKienMay().boQuaTheoSocket).toBe(0);
  });

  it("(12) mode off vẫn có giới hạn: bão 1.000 confirm_mapping vô danh ⇒ INSERT ≤ trần (kịch bản đo BE3 §L4b)", async () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    const L = rlMod.gioiHanSuKienMayMoiSocket();
    const voDanh = await mayVoDanh();
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) voDanh.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "M-17119" });
    await vi.waitFor(() => expect(insertCho(17119) + rlMod.thongKeGioiHanSuKienMay().boQua).toBe(1000), { timeout: 5000 });
    expect(insertCho(17119)).toBeLessThanOrEqual(tran(L, Date.now() - t0));
  });

  it("(13) handshake có khoá: 80 lần nối khoá sai liên tiếp từ một IP ⇒ số lượt tra DB ≤ trần xô IP (vòng nối-lại không thành bão truy vấn)", async () => {
    const LIP = rlMod.gioiHanSuKienMayMoiIp();
    const t0 = Date.now();
    const kq = await Promise.allSettled(Array.from({ length: 80 }, () => mayCoKhoa("M-17119", "sai")));
    const ms = Date.now() - t0;
    expect(kq.every((k) => k.status === "rejected")).toBe(true);
    expect(getMachineByCode.mock.calls.length).toBeLessThanOrEqual(tran(LIP, ms));
    expect(rlMod.thongKeGioiHanSuKienMay().boQuaTheoHandshake).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Fix round 1 (FIX_BASE 9f4f96151)
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ Fix round 1 — danh tính phát đi, onboarding mk_, ma, lặp, xô IP, isActive, sổ mismatch", () => {
  it("(F1) ★ sync_started từ socket gắn M-200 kèm machineCode 'M-17119' ⇒ admin/global chỉ thấy M-200 (không bao giờ M-17119/undefined)", async () => {
    const { ad } = await quanSatVien();
    const syncStatus = ghiNhan(ad, "machine:sync_status");
    const statusChange = ghiNhan(ad, "machine:status_change");
    const b = await mayCoKhoa("M-200", K_200);
    const ok = new Promise((r) => b.once("machine:sync_confirmed", r));
    b.emit("machine:sync_started", { machineCode: "M-17119" });
    await trongHan(ok, 2000, "sync_confirmed");
    const ok2 = new Promise((r) => b.once("machine:sync_confirmed", r));
    b.emit("machine:sync_started", {});
    await trongHan(ok2, 2000, "sync_confirmed 2");
    await vi.waitFor(() => expect(syncStatus.length).toBe(2), { timeout: 2000 });
    await vi.waitFor(() => expect(statusChange.filter((g) => g.status === "syncing").length).toBe(2), { timeout: 2000 });
    for (const g of syncStatus) expect(g).toMatchObject({ machineId: 200, machineCode: "M-200" });
    for (const g of statusChange.filter((x) => x.status === "syncing")) expect(g.machineCode).toBe("M-200");
    expect(JSON.stringify([syncStatus, statusChange])).not.toContain("M-17119");
  });

  it("(F2) ★ R18 — register → admin duyệt ⇒ máy nhận khoá mk_ (hiện MỘT lần, băm-lưu, không plaintext trong DB/log) ⇒ nối lại bằng khoá đó dưới enforce ⇒ ONLINE", async () => {
    const logSpy = vi.spyOn(console, "log");
    const errSpy = vi.spyOn(console, "error");
    try {
      const may = await mayVoDanh();
      const ack = new Promise((r) => may.once("machine:register_ack", r));
      may.emit("machine:register", { code: "NEW-500", name: "moi", type: "AOI", serialNumber: "SN-500" });
      await trongHan(ack, 2000, "register_ack");
      const duyet = new Promise<any>((r) => may.once("machine:registration_approved", r));
      const ad = await ketNoi({ phien: 1 });
      const okAd = new Promise<any>((r) => ad.once("admin:approve_success", r));
      ad.emit("admin:approve_registration", { socketId: may.id, machineId: 500 });
      const [goiMay, goiAd] = await trongHan(Promise.all([duyet, okAd]), 3000, "approve");
      const khoa: string = goiMay.apiKey;
      expect(khoa).toMatch(/^mk_[0-9a-f]{48}$/);
      expect(goiAd.apiKey).toBe(khoa); // hiện cho admin đúng một lần (như cách mach_ được giao)
      // băm-lưu: hàng api_keys mới gắn máy 500 mang SHA-256 (tính độc lập ở đây), không chứa plaintext
      const hang = BANG_KHOA.find((r) => r.machineId === 500);
      expect(hang?.keyHash).toBe(sha256(khoa));
      expect(JSON.stringify(hang)).not.toContain(khoa);
      // machines.apiKey KHÔNG bị ghi plaintext
      const capNhat = updateMachine.mock.calls.filter((c) => c[0] === 500);
      expect(capNhat).toHaveLength(1);
      expect(capNhat[0][1]).toMatchObject({ registrationStatus: "approved" });
      expect(capNhat[0][1]).not.toHaveProperty("apiKey");
      // không log khoá
      const moiLog = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String).join("\n");
      expect(moiLog).not.toContain(khoa);
      // final wave (item 6) — CÙNG vết kiểm toán như tRPC machine.approve (hierarchyRouters): action
      // machine.approve, actor = NGƯỜI DUYỆT (phiên 1), keyPrefix + keyId + credentialIssued; KHÔNG khoá.
      const vet = createAuditLog.mock.calls.map((c) => c[0]).filter((e) => e?.action === "machine.approve" && e?.entityId === 500);
      expect(vet).toHaveLength(1);
      expect(vet[0]).toMatchObject({ userId: 1, entityType: "machine", entityId: 500, status: "success" });
      expect(vet[0].details?.metadata).toMatchObject({ via: "socket", credentialIssued: true, keyPrefix: hang!.keyPrefix, keyId: hang!.id });
      expect(JSON.stringify(vet[0])).not.toContain(khoa);

      // Nối lại bằng khoá được giao, xác thực ở handshake, dưới enforce mặc định ⇒ online.
      const lai = await mayCoKhoa("M-500", khoa);
      lai.emit("machine:confirm_mapping", {});
      await vi.waitFor(() => expect(phongCua(lai)).toEqual(["machine:500"]), { timeout: 2000 });
      expect(insertCho(500)).toBeGreaterThanOrEqual(1);
      expect(onlineCho(500)).toBe(1);
      // Giao thức cũ từng-sự-kiện (scripts/test_machine_websocket.py): chính socket đăng ký gửi khoá trong payload ⇒ cũng được.
      may.emit("machine:confirm_mapping", { machineId: 500, machineCode: "NEW-500", apiKey: khoa });
      await vi.waitFor(() => expect(phongCua(may)).toEqual(["machine:500"]), { timeout: 2000 });
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("(F2b) mode off qua env ⇒ duyệt giữ hành vi cũ (khoá mach_ ghi vào machines.apiKey), không đúc mk_; log KHÔNG mang 10 ký tự đầu của khoá; vẫn có vết kiểm toán", async () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    createAuditLog.mockClear();
    const logSpy = vi.spyOn(console, "log");
    try {
      const soKhoaTruoc = BANG_KHOA.length;
      const may = await mayVoDanh();
      const ack = new Promise((r) => may.once("machine:register_ack", r));
      may.emit("machine:register", { code: "OFF-500", name: "off", type: "AOI" });
      await trongHan(ack, 2000, "register_ack");
      const duyet = new Promise<any>((r) => may.once("machine:registration_approved", r));
      const ad = await ketNoi({ phien: 1 });
      ad.emit("admin:approve_registration", { socketId: may.id, machineId: 500 });
      const goi = await trongHan(duyet, 3000, "approve off");
      expect(goi.apiKey).toMatch(/^mach_/);
      expect(updateMachine.mock.calls.find((c) => c[0] === 500)?.[1]).toMatchObject({ apiKey: goi.apiKey });
      expect(BANG_KHOA.length).toBe(soKhoaTruoc);
      // final wave (item 6, ràng buộc chung 11) — trước đây log `(API Key: ${apiKey.substring(0, 10)}...)`.
      const moiLog = logSpy.mock.calls.flat().map(String).join("\n");
      expect(moiLog).not.toContain(String(goi.apiKey).substring(0, 10));
      const vet = createAuditLog.mock.calls.map((c) => c[0]).filter((e) => e?.action === "machine.approve" && e?.entityId === 500);
      expect(vet).toHaveLength(1);
      expect(vet[0].details?.metadata).toMatchObject({ via: "socket", mkOnly: false, credentialIssued: true });
      expect(JSON.stringify(vet[0])).not.toContain(goi.apiKey);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("(F2c) ★ hai lượt duyệt ĐỒNG THỜI cùng một đăng ký ⇒ đúng MỘT khoá mk_ được đúc, MỘT registration_approved, lượt kia nhận approve_error, MỘT vết kiểm toán", async () => {
    createAuditLog.mockClear();
    const soKhoaTruoc = BANG_KHOA.length;
    const may = await mayVoDanh();
    const ack = new Promise((r) => may.once("machine:register_ack", r));
    may.emit("machine:register", { code: "DUP-500", name: "dup", type: "AOI" });
    await trongHan(ack, 2000, "register_ack");
    const duyetGoi = ghiNhan(may, "machine:registration_approved");
    const ad = await ketNoi({ phien: 1 });
    const okGoi = ghiNhan(ad, "admin:approve_success");
    const loiGoi = ghiNhan(ad, "admin:approve_error");
    // Hai gói liền nhau trên cùng socket admin: handler thứ hai bắt đầu khi handler thứ nhất còn
    // đang await (getMachineById / issueMachineKey) — trước bản vá cả hai đều thấy đăng ký còn pending.
    ad.emit("admin:approve_registration", { socketId: may.id, machineId: 500 });
    ad.emit("admin:approve_registration", { socketId: may.id, machineId: 500 });
    await vi.waitFor(() => expect(okGoi.length + loiGoi.length).toBe(2), { timeout: 3000 });
    await cho(300); // không còn gói muộn
    expect(okGoi).toHaveLength(1);
    expect(loiGoi).toHaveLength(1);
    expect(duyetGoi).toHaveLength(1);
    expect(BANG_KHOA.length).toBe(soKhoaTruoc + 1);
    expect(createAuditLog.mock.calls.map((c) => c[0]).filter((e) => e?.action === "machine.approve")).toHaveLength(1);
  });

  it("(F3) ★ sync_started từng-sự-kiện, socket NGẮT trong lúc chờ xác thực ⇒ không online ma, không updateMachine, không INSERT", async () => {
    const may = await mayVoDanh();
    getMachineById.mockImplementationOnce(async (id: number) => {
      await cho(300);
      return MAY[id] ? { ...MAY[id] } : undefined;
    });
    may.emit("machine:sync_started", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    await vi.waitFor(() => expect(getMachineById).toHaveBeenCalled(), { timeout: 2000 });
    may.disconnect();
    await cho(600);
    expect(onlineCho(17119)).toBe(0);
    expect(updateMachine).not.toHaveBeenCalled();
    expect(insertCho(17119)).toBe(0);
    // đối chứng: không ngắt ⇒ online
    const may2 = await mayVoDanh();
    const ok = new Promise((r) => may2.once("machine:sync_confirmed", r));
    may2.emit("machine:sync_started", { machineId: 17119, machineCode: "M-17119", apiKey: K_17119 });
    await trongHan(ok, 2000, "sync_confirmed");
    expect(onlineCho(17119)).toBe(1);
  });

  it("(F4) ★ confirm_mapping LẶP trên socket đã map cùng máy ⇒ đúng MỘT INSERT (vẫn làm mới presence); socket KHÁC map cùng máy ⇒ INSERT mới", async () => {
    const may = await mayCoKhoa("M-17119", K_17119);
    for (let i = 0; i < 5; i++) may.emit("machine:confirm_mapping", {});
    await vi.waitFor(() => expect(onlineCho(17119)).toBe(5), { timeout: 2000 });
    expect(insertCho(17119)).toBe(1);
    const may2 = await mayCoKhoa("M-17119", K_17119);
    may2.emit("machine:confirm_mapping", {});
    await vi.waitFor(() => expect(onlineCho(17119)).toBe(6), { timeout: 2000 });
    expect(insertCho(17119)).toBe(2);
  });

  it("(F5) ★ bão VÔ DANH cùng IP (10 socket × 10 gói, vắt cạn xô IP vô danh) KHÔNG làm rơi confirm_mapping của socket ĐÃ gắn", async () => {
    // Xô IP 2/giây ⇒ nạp 1 token mỗi 500 ms: đủ chậm để xô còn CẠN khi gói của socket đã gắn tới (với 50/giây
    // xô tự nạp trong lúc waitFor và ca này xanh cả trên bản chưa vá — đo được ở RED lần đầu).
    process.env.SOCKET_MACHINE_EVENT_RATE_PER_IP = "2";
    const gan = await mayCoKhoa("M-200", K_200);
    const vd: ClientSocket[] = [];
    for (let i = 0; i < 10; i++) vd.push(await mayVoDanh());
    const loi: any[] = [];
    for (const s of vd) s.on("machine:auth_error", (g: any) => loi.push(g));
    for (const s of vd) for (let i = 0; i < 10; i++) s.emit("machine:heartbeat", { machineId: 17119, status: "x" });
    await vi.waitFor(() => expect(loi.length + rlMod.thongKeGioiHanSuKienMay().boQua).toBe(100), { timeout: 3000 });
    expect(rlMod.thongKeGioiHanSuKienMay().boQuaTheoIp).toBeGreaterThan(0); // xô IP vô danh thật sự cạn
    gan.emit("machine:confirm_mapping", {});
    await vi.waitFor(() => expect(phongCua(gan)).toEqual(["machine:200"]), { timeout: 2000 });
  });

  it("(F6) ★ đường từng-sự-kiện kiểm isActive: máy NGỪNG (khoá plaintext, MACHINE_SHARED_KEY_ALLOWED=true) ⇒ từ chối; đối chứng máy đang chạy ⇒ nhận", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
    const s = await mayVoDanh();
    const loi = ghiNhan(s, "machine:auth_error");
    s.emit("machine:confirm_mapping", { machineId: 301, machineCode: "M-301", apiKey: "mach_inactive_301" });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 2000 });
    expect(insertCho(301)).toBe(0);
    expect(phongCua(s)).toEqual([]);
    const s2 = await mayVoDanh();
    s2.emit("machine:confirm_mapping", { machineId: 300, machineCode: "M-300", apiKey: "mach_legacy_300" });
    await vi.waitFor(() => expect(phongCua(s2)).toEqual(["machine:300"]), { timeout: 2000 });
  });

  it("(F7) sổ mismatch KHÔNG ghi mã máy do client tự khai (confirm_mapping + sync_started)", async () => {
    const s = await mayVoDanh();
    const loi = ghiNhan(s, "machine:auth_error");
    const syncLoi = ghiNhan(s, "machine:sync_error");
    s.emit("machine:confirm_mapping", { machineId: 999999, machineCode: "GIA-MAO-XYZ", apiKey: "rac" });
    s.emit("machine:confirm_mapping", { machineId: 17119, machineCode: "GIA-MAO-ABC", apiKey: "rac" });
    s.emit("machine:sync_started", { machineId: 999998, machineCode: "GIA-MAO-SYNC", apiKey: "rac" });
    await vi.waitFor(() => expect(loi.length).toBe(2), { timeout: 2000 });
    await vi.waitFor(() => expect(syncLoi.length).toBe(1), { timeout: 2000 });
    const rows = authMod.getSocketMachineAuthMismatches();
    expect(JSON.stringify(rows)).not.toContain("GIA-MAO");
    expect(rows.find((r) => r.event === "machine:confirm_mapping" && r.machineId === 17119)?.machineCode).toBe("M-17119");
  });
});
