/**
 * socketPhongQuyen.test.ts — ★★★ PLT-01 (doc 80 Phụ lục F §6, Task 7 Đợt 0): PHÂN QUYỀN VÀO PHÒNG SOCKET.
 *
 * LỖI ĐƯỢC GHIM (đo sống bởi auditor): handshake `auth.clientType:"machine"` bỏ qua kiểm cookie
 * (thiết kế: máy xác thực TỪNG SỰ KIỆN bằng apiKey) — nhưng chính socket vô danh đó vẫn gửi được
 * `engineering:subscribe` / `subscribe {...}` / `admin:join` và vào phòng KHÔNG kiểm quyền ⇒ nhận
 * giá trị PLC live, sự kiện an toàn, telemetry, danh sách máy chờ đăng ký.
 *
 * ★ ĐO BẰNG socket.io THẬT (server + client trong tiến trình, cổng 0): `initializeSocket` THẬT, handshake
 *   THẬT, phòng THẬT, `emitEngineeringSamples` THẬT. Không phải bản sao biểu thức (G20).
 * ★ Kiểm quyền dùng `checkPermission` THẬT (accessControl + alias machine_monitoring→machine_status).
 *   Chỉ cạnh DB (`getDb`) được thay bằng bảng `permissions` giả ĐỌC THAM SỐ câu WHERE thật do drizzle
 *   sinh ra (userId, moduleName) — không mock `accessControl` (TST-02).
 * ★ Mỗi ca âm tính có đối chứng DƯƠNG trong cùng ca (một socket được phép NHẬN cùng gói), để "không
 *   nhận gì" không thể xanh vì bộ phát hỏng.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { PgDialect } from "drizzle-orm/pg-core";

// ── Người dùng giả theo cookie `phien=<id>` (handshake THẬT gọi sdk.authenticateRequest). ──
const NGUOI_DUNG: Record<number, { id: number; role: string; name: string }> = {
  1: { id: 1, role: "admin", name: "admin" },
  7: { id: 7, role: "user", name: "engineer-co-quyen" },
  8: { id: 8, role: "user", name: "operator-khong-hang-quyen" },
  9: { id: 9, role: "user", name: "operator-hang-quyen-false" },
  10: { id: 10, role: "user", name: "engineer-co-quyen-db-cham" },
};
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      return m ? (NGUOI_DUNG[Number(m[1])] ?? null) : null;
    }),
  },
}));

// ── Bảng `permissions` giả: đọc THAM SỐ của câu WHERE thật (userId, moduleName). ──
const HANG_QUYEN = [
  { userId: 7, moduleName: "machine_status", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, expiresAt: null },
  { userId: 9, moduleName: "machine_status", canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, expiresAt: null },
  { userId: 10, moduleName: "machine_status", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, expiresAt: null },
];
/** userId có câu hỏi quyền CHẬM (mô phỏng DB chậm) — để đo cuộc đua subscribe→unsubscribe. */
const HOI_CHAM_MS: Record<number, number> = { 10: 200 };
const cacLanHoiQuyen: Array<unknown[]> = [];
const dialect = new PgDialect();
const dbQuyenGia = {
  select: () => ({
    from: () => ({
      where: (cond: any) => ({
        limit: async () => {
          const { params } = dialect.sqlToQuery(cond);
          cacLanHoiQuyen.push(params);
          const [userId, moduleName] = params as [number, string];
          if (HOI_CHAM_MS[userId]) await new Promise((r) => setTimeout(r, HOI_CHAM_MS[userId]));
          return HANG_QUYEN.filter((h) => h.userId === userId && h.moduleName === moduleName);
        },
      }),
    }),
  }),
};
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return { ...goc, getDb: vi.fn(async () => dbQuyenGia) };
});

// ── Cạnh DB của socket.ts / notificationService: chỉ những hàm luồng máy chạm tới. ──
const MAY = { id: 42, code: "M-42", name: "May 42", machineType: "AOI", apiKey: "k-dung", stationId: null, registrationStatus: "approved", syncMode: "realtime", serialNumber: null, firmwareVersion: null };
const updateMachine = vi.fn(async () => undefined);
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: vi.fn(async () => undefined),
  getMachineById: vi.fn(async (id: number) => (id === MAY.id ? { ...MAY } : undefined)),
  updateMachine: (...a: any[]) => (updateMachine as any)(...a),
  getLineByStationId: vi.fn(async () => undefined),
  getUnreadNotificationCount: vi.fn(async () => 0),
  createNotification: vi.fn(),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  getDb: vi.fn(async () => null),
}));

// ── Mọi cạnh hạ tầng khác: rỗng/tắt (tệp này đo PHÂN QUYỀN PHÒNG). ──
vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: vi.fn(async () => undefined),
    setOffline: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    listOnline: vi.fn(async () => []),
    listOnlineCodes: vi.fn(async () => []),
  }),
}));
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
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const ENV_GOC = { SOCKET_MACHINE_AUTH_MODE: process.env.SOCKET_MACHINE_AUTH_MODE, RBAC_SCOPED_ADMIN: process.env.RBAC_SCOPED_ADMIN };

function ketNoi(opts: { may?: boolean; phien?: number }): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: opts.may ? { clientType: "machine" } : {},
    extraHeaders: opts.phien != null ? { cookie: `phien=${opts.phien}` } : {},
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}

/** Phòng mà socket phía SERVER đang ở (trừ phòng riêng = chính socket.id). */
function phongCua(c: ClientSocket): string[] {
  const sk = socketMod.getIO()!.sockets.sockets.get(c.id!);
  if (!sk) throw new Error(`không thấy socket server ${c.id}`);
  return [...sk.rooms].filter((r) => r !== c.id).sort();
}

/** Ghi lại mọi gói một client nhận (theo tên sự kiện). */
function ghiNhan(c: ClientSocket, evt: string): unknown[] {
  const arr: unknown[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}

const tuChoiLog = () =>
  (console.warn as any).mock.calls.map((a: unknown[]) => a.map(String).join(" ")).filter((s: string) => /TU CHOI/.test(s));

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  delete process.env.SOCKET_MACHINE_AUTH_MODE; // luồng máy ở chế độ mặc định `off` (hợp đồng doc 56 giữ nguyên)
  delete process.env.RBAC_SCOPED_ADMIN;
  socketMod = await import("./socket");
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // initNotificationService được nạp bằng import động — chờ nó đăng ký `connection`.
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
afterEach(() => {
  warnSpy.mockClear();
  cacLanHoiQuyen.length = 0;
  updateMachine.mockClear();
  while (clients.length) clients.pop()!.disconnect();
});

describe("★★★ PLT-01 — thiết bị đo tự canh", () => {
  it("(0) không cookie ⇒ handshake TỪ CHỐI; không cookie + clientType machine ⇒ KẾT NỐI (tái hiện phép thử của auditor)", async () => {
    await expect(ketNoi({})).rejects.toThrow(/UNAUTHORIZED/);
    const may = await ketNoi({ may: true });
    expect(may.connected).toBe(true);
    const nd = await ketNoi({ phien: 7 });
    expect(nd.connected).toBe(true);
  });
});

describe("★★★ PLT-01 — engineering:subscribe", () => {
  it("(1) socket máy KHÔNG cookie gửi engineering:subscribe ⇒ không vào phòng, KHÔNG nhận engineering:samples (đối chứng: user có quyền NHẬN), có log từ chối", async () => {
    const may = await ketNoi({ may: true });
    const nd = await ketNoi({ phien: 7 });
    const mayNhan = ghiNhan(may, "engineering:samples");
    const ndNhan = ghiNhan(nd, "engineering:samples");
    may.emit("engineering:subscribe", { machineId: 5 });
    nd.emit("engineering:subscribe", { machineId: 5 });
    await vi.waitFor(() => expect(phongCua(nd)).toContain("engineering:5"));
    await cho(100);
    expect(phongCua(may)).not.toContain("engineering:5");

    socketMod.emitEngineeringSamples(5, [{ symbol: "D100", value: 1234, ts: Date.now() }]);
    await vi.waitFor(() => expect(ndNhan.length).toBe(1));
    await cho(100);
    expect(mayNhan).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && s.includes("engineering:5"))).toBe(true));
  });

  it("(2) user trình duyệt KHÔNG có hàng quyền ⇒ bị từ chối (checkPermission thật hỏi machine_status), không nhận mẫu", async () => {
    const nd8 = await ketNoi({ phien: 8 });
    const nd7 = await ketNoi({ phien: 7 });
    const nhan8 = ghiNhan(nd8, "engineering:samples");
    const nhan7 = ghiNhan(nd7, "engineering:samples");
    nd8.emit("engineering:subscribe", { machineId: 6 });
    nd7.emit("engineering:subscribe", { machineId: 6 });
    await vi.waitFor(() => expect(phongCua(nd7)).toContain("engineering:6"));
    await cho(100);
    expect(phongCua(nd8)).not.toContain("engineering:6");

    socketMod.emitEngineeringSamples(6, [{ symbol: "M0", value: true, ts: Date.now() }]);
    await vi.waitFor(() => expect(nhan7.length).toBe(1));
    await cho(100);
    expect(nhan8).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd8.id!) && s.includes("engineering:6"))).toBe(true));
    // Kiểm quyền đi qua alias THẬT machine_monitoring → machine_status, đúng userId.
    expect(cacLanHoiQuyen).toContainEqual([8, "machine_status"]);
    expect(cacLanHoiQuyen).toContainEqual([7, "machine_status"]);
  });

  it("(3) user có hàng quyền canView=false ⇒ từ chối; admin (checkPermission thật: admin qua) ⇒ nhận", async () => {
    const nd9 = await ketNoi({ phien: 9 });
    const ad = await ketNoi({ phien: 1 });
    const nhan9 = ghiNhan(nd9, "engineering:samples");
    const nhanAd = ghiNhan(ad, "engineering:samples");
    nd9.emit("engineering:subscribe", { machineId: 7 });
    ad.emit("engineering:subscribe", { machineId: 7 });
    await vi.waitFor(() => expect(phongCua(ad)).toContain("engineering:7"));
    await cho(100);
    expect(phongCua(nd9)).not.toContain("engineering:7");
    socketMod.emitEngineeringSamples(7, [{ symbol: "X", value: 0, ts: Date.now() }]);
    await vi.waitFor(() => expect(nhanAd.length).toBe(1));
    await cho(100);
    expect(nhan9).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd9.id!))).toBe(true));
  });

  it("(4) user có quyền: engineering:unsubscribe vẫn rời phòng (hành vi cũ)", async () => {
    const nd = await ketNoi({ phien: 7 });
    nd.emit("engineering:subscribe", { machineId: 8 });
    await vi.waitFor(() => expect(phongCua(nd)).toContain("engineering:8"));
    nd.emit("engineering:unsubscribe", { machineId: 8 });
    await vi.waitFor(() => expect(phongCua(nd)).not.toContain("engineering:8"));
  });

  it("(4b) DB kiểm quyền CHẬM: subscribe rồi unsubscribe NGAY ⇒ lượt kiểm muộn KHÔNG join lại phòng đã rời", async () => {
    const nd = await ketNoi({ phien: 10 });
    nd.emit("engineering:subscribe", { machineId: 9 });
    nd.emit("engineering:unsubscribe", { machineId: 9 });
    await vi.waitFor(() => expect(cacLanHoiQuyen).toContainEqual([10, "machine_status"]));
    await cho(HOI_CHAM_MS[10] + 150);
    expect(phongCua(nd)).not.toContain("engineering:9");
    // Đối chứng: subscribe không kèm unsubscribe ⇒ vào được (quyền có thật, chỉ chậm).
    nd.emit("engineering:subscribe", { machineId: 9 });
    await vi.waitFor(() => expect(phongCua(nd)).toContain("engineering:9"), { timeout: 2000 });
  });
});

describe("★★★ PLT-01 — subscribe chung / admin / user room", () => {
  const MOI_KHOA = {
    factoryId: 1, workshopId: 2, machineId: 3, lineId: 4, twinFactoryId: 1,
    deviceStreamId: "robot:1", robotId: 5, siteCode: "HN", sitesGlobal: true, telemetryAll: true, aiAgents: true,
  };
  const PHONG_TRINH_DUYET = [
    "ai:agents", "device:robot:1", "factory:1", "global", "line:4", "machine:3",
    "robot:5", "site:HN", "sites:global", "telemetry:all", "twin:1", "workshop:2",
  ].sort();

  it("(5) socket máy gửi subscribe với MỌI khoá ⇒ KHÔNG vào phòng nào (kể cả global), có log; user trình duyệt cùng gói ⇒ vào đủ 12 phòng (hành vi cũ)", async () => {
    const may = await ketNoi({ may: true });
    const nd = await ketNoi({ phien: 8 }); // user KHÔNG có quyền engineering: subscribe chung không đổi
    may.emit("subscribe", MOI_KHOA);
    nd.emit("subscribe", MOI_KHOA);
    await vi.waitFor(() => expect(phongCua(nd)).toEqual(PHONG_TRINH_DUYET));
    await cho(50);
    expect(phongCua(may)).toEqual([]);

    // Đối chứng bằng gói thật: phát vào `global` ⇒ user nhận, máy không.
    const mayNhan = ghiNhan(may, "inspection:alert");
    const ndNhan = ghiNhan(nd, "inspection:alert");
    socketMod.emitInspectionAlert({ type: "NG_ALERT", machineId: 999, machineName: "x", machineCode: "x", timestamp: new Date(), message: "m" });
    await vi.waitFor(() => expect(ndNhan.length).toBe(1));
    await cho(100);
    expect(mayNhan).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && /subscribe/.test(s))).toBe(true));
  });

  it("(6) socket máy gửi admin:join ⇒ KHÔNG vào phòng admin, không nhận pending registrations; user trình duyệt ⇒ vào (hành vi cũ)", async () => {
    const may = await ketNoi({ may: true });
    const nd = await ketNoi({ phien: 8 });
    const mayPending = ghiNhan(may, "admin:pending_registrations");
    const ndPending = ghiNhan(nd, "admin:pending_registrations");
    may.emit("admin:join");
    nd.emit("admin:join");
    await vi.waitFor(() => expect(ndPending.length).toBe(1));
    await cho(100);
    expect(phongCua(nd)).toContain("admin");
    expect(phongCua(may)).not.toContain("admin");
    expect(mayPending).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && s.includes("admin"))).toBe(true));
  });

  it("(7) socket máy tự duyệt đăng ký của chính nó (admin:approve_registration) ⇒ BỊ TỪ CHỐI: không ghi DB, không nhận apiKey", async () => {
    const may = await ketNoi({ may: true });
    const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
    may.emit("machine:register", { code: "ROGUE", name: "rogue", type: "AOI" });
    await ackDangKy;
    const duyet = ghiNhan(may, "machine:registration_approved");
    const ok = ghiNhan(may, "admin:approve_success");
    may.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    await cho(150);
    expect(updateMachine).not.toHaveBeenCalled();
    expect(duyet).toEqual([]);
    expect(ok).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && s.includes("admin:approve_registration"))).toBe(true));
  });

  it("(8) auth:user — socket máy không vào được user:<id>; user trình duyệt chỉ vào phòng CỦA MÌNH", async () => {
    const may = await ketNoi({ may: true });
    const nd = await ketNoi({ phien: 7 });
    may.emit("auth:user", 7);
    nd.emit("auth:user", 8); // phòng của người khác
    nd.emit("auth:user", 7); // phòng của mình
    await vi.waitFor(() => expect(phongCua(nd)).toContain("user:7"));
    await cho(100);
    expect(phongCua(nd)).not.toContain("user:8");
    expect(phongCua(may)).not.toContain("user:7");
    await vi.waitFor(() => expect(tuChoiLog().filter((s: string) => s.includes("user:")).length).toBeGreaterThanOrEqual(2));
  });
});

describe("★★★ PLT-01 — luồng máy hợp lệ KHÔNG đổi (SOCKET_MACHINE_AUTH_MODE=off mặc định)", () => {
  it("(9) confirm_mapping ⇒ máy vào machine:<id> và NHẬN inspection:alert của mình; heartbeat ⇒ user trong global nhận machine:status_update; admin nhận machine:connected", async () => {
    const nd = await ketNoi({ phien: 7 });
    nd.emit("subscribe", {});
    nd.emit("admin:join");
    await vi.waitFor(() => expect(phongCua(nd)).toEqual(["admin", "global"]));
    const ketNoiMay = ghiNhan(nd, "machine:connected");
    const capNhat = ghiNhan(nd, "machine:status_update");

    const may = await ketNoi({ may: true });
    may.emit("machine:confirm_mapping", { machineId: MAY.id, machineCode: MAY.code, apiKey: "bat-ky" });
    await vi.waitFor(() => expect(phongCua(may)).toEqual([`machine:${MAY.id}`]));
    await vi.waitFor(() => expect(ketNoiMay.length).toBe(1));

    const alertMay = ghiNhan(may, "inspection:alert");
    socketMod.emitInspectionAlert({ type: "NG_ALERT", machineId: MAY.id, machineName: MAY.name, machineCode: MAY.code, timestamp: new Date(), message: "m" });
    await vi.waitFor(() => expect(alertMay.length).toBe(1));

    may.emit("machine:heartbeat", { machineId: MAY.id, status: "running" });
    await vi.waitFor(() => expect(capNhat.length).toBe(1));
    expect(tuChoiLog()).toEqual([]);
  });

  it("(10) sync_started đúng apiKey ⇒ sync_confirmed + vào machine:<id>; sai apiKey ⇒ sync_error (không đổi)", async () => {
    const may = await ketNoi({ may: true });
    const loi = new Promise((r) => may.once("machine:sync_error", r));
    may.emit("machine:sync_started", { machineId: MAY.id, machineCode: MAY.code, apiKey: "sai" });
    await loi;
    expect(phongCua(may)).toEqual([]);
    const ok = new Promise((r) => may.once("machine:sync_confirmed", r));
    may.emit("machine:sync_started", { machineId: MAY.id, machineCode: MAY.code, apiKey: MAY.apiKey });
    await ok;
    expect(phongCua(may)).toEqual([`machine:${MAY.id}`]);
    expect(tuChoiLog()).toEqual([]);
  });
});
