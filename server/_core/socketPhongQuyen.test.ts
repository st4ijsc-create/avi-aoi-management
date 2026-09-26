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
  // Task 11 — non-admin được cấp permission bit machine_registration (chỉ có tác dụng khi
  // MACHINE_APPROVE_RBAC_OPEN_ENABLED=true; mặc định cờ tắt nên user này KHÔNG khác gì user 8).
  11: { id: 11, role: "user", name: "registrar-co-quyen-machine_registration" },
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
  // Task 11 — hàng quyền machine_registration (chỉ đọc khi cờ MACHINE_APPROVE_RBAC_OPEN_ENABLED=true).
  { userId: 11, moduleName: "machine_registration", canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, expiresAt: null },
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
const ENV_GOC = {
  SOCKET_MACHINE_AUTH_MODE: process.env.SOCKET_MACHINE_AUTH_MODE,
  RBAC_SCOPED_ADMIN: process.env.RBAC_SCOPED_ADMIN,
  MACHINE_APPROVE_RBAC_OPEN_ENABLED: process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED,
};

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
  delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED; // Task 11 — mặc định TẮT (admin:* mirror role admin)
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

  it("(6) admin:join — máy vẫn KHÔNG vào phòng admin (Task 7, không đổi); Task 11: operator KHÔNG có quyền quản trị đăng ký máy ⇒ TỪ CHỐI, không nhận pending; admin (positive control) ⇒ vào & nhận pending", async () => {
    const may = await ketNoi({ may: true });
    const nd8 = await ketNoi({ phien: 8 }); // operator — không role admin, không hàng quyền machine_registration
    const ad = await ketNoi({ phien: 1 }); // admin — positive control CÙNG test
    const mayPending = ghiNhan(may, "admin:pending_registrations");
    const nd8Pending = ghiNhan(nd8, "admin:pending_registrations");
    const adPending = ghiNhan(ad, "admin:pending_registrations");
    may.emit("admin:join");
    nd8.emit("admin:join");
    ad.emit("admin:join");
    await vi.waitFor(() => expect(adPending.length).toBe(1));
    await cho(100);
    expect(phongCua(ad)).toContain("admin");
    expect(phongCua(may)).not.toContain("admin");
    expect(phongCua(nd8)).not.toContain("admin");
    expect(mayPending).toEqual([]);
    expect(nd8Pending).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && s.includes("admin"))).toBe(true));
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd8.id!) && s.includes("admin"))).toBe(true));
  });

  it("(6b) admin:get_online_machines — operator KHÔNG có quyền ⇒ TỪ CHỐI, không nhận danh sách; admin (positive control) ⇒ nhận", async () => {
    const nd8 = await ketNoi({ phien: 8 });
    const ad = await ketNoi({ phien: 1 });
    const nd8List = ghiNhan(nd8, "machine:online_list");
    const adList = ghiNhan(ad, "machine:online_list");
    nd8.emit("admin:get_online_machines");
    ad.emit("admin:get_online_machines");
    await vi.waitFor(() => expect(adList.length).toBe(1));
    await cho(100);
    expect(nd8List).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd8.id!) && s.includes("admin:get_online_machines"))).toBe(true));
  });

  it("(7) admin:approve_registration — máy tự duyệt chính nó BỊ TỪ CHỐI (Task 7); Task 11: operator (không quyền) CÙNG lượt đăng ký cũng BỊ TỪ CHỐI (không ghi DB, không apiKey, không cả nhánh 'not found'); admin (positive control) DUYỆT ĐƯỢC", async () => {
    const may = await ketNoi({ may: true });
    const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
    may.emit("machine:register", { code: "ROGUE", name: "rogue", type: "AOI" });
    await ackDangKy;

    // (7a) máy vô danh tự duyệt chính nó — vẫn từ chối như Task 7 (không phải socket người dùng).
    const duyetMay = ghiNhan(may, "machine:registration_approved");
    const okMay = ghiNhan(may, "admin:approve_success");
    may.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    await cho(150);
    expect(updateMachine).not.toHaveBeenCalled();
    expect(duyetMay).toEqual([]);
    expect(okMay).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(may.id!) && s.includes("admin:approve_registration"))).toBe(true));

    // (7b) Task 11 — operator trình duyệt đã đăng nhập, KHÔNG role admin, KHÔNG hàng quyền
    // machine_registration ⇒ từ chối ở CỔNG QUYỀN, trước khi chạm pendingRegistrations: không
    // updateMachine, không admin:approve_success, và KHÔNG CẢ admin:approve_error ("not found") —
    // chứng minh cổng chặn TRƯỚC mọi tác dụng phụ, đăng ký ROGUE vẫn còn nguyên cho (7c).
    const nd8 = await ketNoi({ phien: 8 });
    const okNd8 = ghiNhan(nd8, "admin:approve_success");
    const loiNd8 = ghiNhan(nd8, "admin:approve_error");
    nd8.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    await cho(150);
    expect(updateMachine).not.toHaveBeenCalled();
    expect(okNd8).toEqual([]);
    expect(loiNd8).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd8.id!) && s.includes("admin:approve_registration"))).toBe(true));

    // (7c) positive control CÙNG test — admin duyệt được ĐÚNG lượt đăng ký còn nguyên từ (7b).
    const ad = await ketNoi({ phien: 1 });
    const okAd = new Promise<any>((r) => ad.once("admin:approve_success", r));
    ad.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    const ket = await okAd;
    expect(updateMachine).toHaveBeenCalledTimes(1);
    expect(updateMachine).toHaveBeenCalledWith(MAY.id, expect.objectContaining({ registrationStatus: "approved" }));
    expect(ket.apiKey).toBeTruthy();
  });

  it("(7d) admin:reject_registration — operator (không role admin) BỊ TỪ CHỐI, đăng ký KHÔNG bị đổi trạng thái; admin (positive control) TỪ CHỐI ĐƯỢC (mirror machine.reject = adminProcedure THẲNG, không qua cờ)", async () => {
    const may = await ketNoi({ may: true });
    const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
    may.emit("machine:register", { code: "ROGUE-REJECT", name: "rogue2", type: "AOI" });
    await ackDangKy;
    const biTuChoiO = new Promise((r) => may.once("machine:registration_rejected", r));

    const nd8 = await ketNoi({ phien: 8 });
    nd8.emit("admin:reject_registration", { socketId: may.id, reason: "operator thu" });
    await cho(150);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd8.id!) && s.includes("admin:reject_registration"))).toBe(true));

    const ad = await ketNoi({ phien: 1 });
    ad.emit("admin:reject_registration", { socketId: may.id, reason: "admin tu choi" });
    const goi = (await biTuChoiO) as { reason: string };
    expect(goi.reason).toBe("admin tu choi"); // KHÔNG phải lượt của operator ⇒ chứng minh lượt operator không có tác dụng
  });

  it("(7f) admin:reject_registration KHÔNG đọc cờ MACHINE_APPROVE_RBAC_OPEN_ENABLED — non-admin có hàng quyền machine_registration/canEdit=true (đủ để approve khi cờ bật, xem 7e) VẪN bị từ chối reject, vì tRPC machine.reject là adminProcedure THẲNG", async () => {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      const may = await ketNoi({ may: true });
      const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
      may.emit("machine:register", { code: "ROGUE-REJECT-FLAG", name: "rogue4", type: "AOI" });
      await ackDangKy;

      const nd11 = await ketNoi({ phien: 11 }); // canEdit=true trên machine_registration, KHÔNG phải admin
      nd11.emit("admin:reject_registration", { socketId: may.id, reason: "nd11 thu" });
      await cho(150);
      await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd11.id!) && s.includes("admin:reject_registration"))).toBe(true));

      // Đối chứng: admin vẫn reject được đúng đăng ký (còn nguyên vì nd11 không có tác dụng).
      const biTuChoi = new Promise((r) => may.once("machine:registration_rejected", r));
      const ad = await ketNoi({ phien: 1 });
      ad.emit("admin:reject_registration", { socketId: may.id, reason: "admin thu that" });
      const goi = (await biTuChoi) as { reason: string };
      expect(goi.reason).toBe("admin thu that");
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  });

  it("(7e) cờ MACHINE_APPROVE_RBAC_OPEN_ENABLED=true — admin:approve_registration đi qua checkPermission THẬT trên module machine_registration: non-admin CÓ hàng quyền canEdit ⇒ duyệt được; operator KHÔNG hàng quyền ⇒ vẫn từ chối dù cờ bật", async () => {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      const may = await ketNoi({ may: true });
      const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
      may.emit("machine:register", { code: "ROGUE-FLAG", name: "rogue3", type: "AOI" });
      await ackDangKy;

      // operator (user 8) vẫn không có hàng quyền machine_registration ⇒ từ chối dù cờ bật.
      const nd8 = await ketNoi({ phien: 8 });
      const okNd8 = ghiNhan(nd8, "admin:approve_success");
      nd8.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
      await cho(150);
      expect(updateMachine).not.toHaveBeenCalled();
      expect(okNd8).toEqual([]);
      expect(cacLanHoiQuyen).toContainEqual([8, "machine_registration"]);

      // user 11 — non-admin, CÓ hàng quyền machine_registration/canEdit=true ⇒ duyệt được.
      const nd11 = await ketNoi({ phien: 11 });
      const okNd11 = new Promise<any>((r) => nd11.once("admin:approve_success", r));
      nd11.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
      const ket = await okNd11;
      expect(updateMachine).toHaveBeenCalledTimes(1);
      expect(ket.apiKey).toBeTruthy();
      expect(cacLanHoiQuyen).toContainEqual([11, "machine_registration"]);
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  });

  it("(7g) cờ TẮT (mặc định) — user 11 dù CÓ hàng quyền machine_registration/canEdit=true (đủ để duyệt khi cờ BẬT, xem 7e) VẪN bị từ chối admin:join/admin:approve_registration, vì cờ tắt mirror ĐÚNG machineRegistrationGate: chỉ role admin, bỏ qua permission bit", async () => {
    expect(process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED).toBeUndefined(); // đảm bảo đang ở mặc định
    const nd11Join = await ketNoi({ phien: 11 });
    const pendingNd11 = ghiNhan(nd11Join, "admin:pending_registrations");
    nd11Join.emit("admin:join");
    await cho(150);
    expect(phongCua(nd11Join)).not.toContain("admin");
    expect(pendingNd11).toEqual([]);
    await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(nd11Join.id!) && s.includes("admin"))).toBe(true));

    const may = await ketNoi({ may: true });
    const ackDangKy = new Promise((r) => may.once("machine:register_ack", r));
    may.emit("machine:register", { code: "ROGUE-FLAGOFF", name: "rogue5", type: "AOI" });
    await ackDangKy;
    const nd11Approve = await ketNoi({ phien: 11 });
    const okNd11 = ghiNhan(nd11Approve, "admin:approve_success");
    nd11Approve.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    await cho(150);
    expect(updateMachine).not.toHaveBeenCalled();
    expect(okNd11).toEqual([]);
  });

  it("(7h) log từ chối admin:approve_registration ép kiểu/escape payload — socketId/machineId cố tình chứa ký tự xuống dòng + văn bản GIẢ DẠNG log khác KHÔNG tạo được dòng log riêng (chống giả dòng log)", async () => {
    const nd8 = await ketNoi({ phien: 8 });
    const socketIdAcY = 'X\n[Socket.io] FAKE admin:approve_success machineId=999 apiKey=STOLEN-KEY';
    nd8.emit("admin:approve_registration", { socketId: socketIdAcY, machineId: "khong-phai-so" as any });
    await cho(150);
    const dong = await vi.waitFor(() => {
      const d = tuChoiLog().find((s: string) => s.includes(nd8.id!) && s.includes("admin:approve_registration"));
      expect(d).toBeDefined();
      return d!;
    });
    // Ép kiểu đúng: Number("khong-phai-so") ⇒ NaN (không phải chuỗi lọt nguyên văn vào log).
    expect(dong).toContain("machineId=NaN");
    // Escape đúng: JSON.stringify biến ký tự xuống dòng thật thành hai ký tự "\n" trong chuỗi —
    // toàn bộ dòng log vẫn nằm trên MỘT dòng vật lý, "dòng log giả" không tách ra được.
    expect(dong).toContain(JSON.stringify(socketIdAcY));
    expect(dong.split("\n")).toHaveLength(1);
    expect(updateMachine).not.toHaveBeenCalled();
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
    // Task 11 — admin:join giờ đòi quyền quản trị đăng ký máy (mirror machine.listPending); dùng
    // socket admin (phien 1) làm người quan sát phòng admin/global — không đổi ý nghĩa của ca này
    // (luồng máy confirm_mapping/heartbeat), chỉ đổi observer cho khớp cổng mới.
    const nd = await ketNoi({ phien: 1 });
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
