/**
 * socketXetLaiQuyen.test.ts — ★★★ F5 đầy đủ: socket ĐANG SỐNG mất cái người dùng đã mất (phạm vi / vai / phiên), mọi bản sao.
 *
 * ★ Harness như socketXacThucLai.test.ts / socketPhamViPhong.db.test.ts (phần server): socket.io THẬT trên 127.0.0.1 cổng 0,
 *   `initializeSocket` THẬT, handshake THẬT (sdk giả trả BẢN CHỤP theo cookie `phien=<id>`), handler THẬT. KHÔNG CSDL (không một hàng nào):
 *   phạm vi qua seam `__datCongPhamViChoTest` (bảng `PHAM` đổi được), người dùng + sổ phiên qua `__datBoDocChuTheChoTest`, quyền qua
 *   `__datBoDocQuyenChoTest`. NOTIFY giả lập bằng `nhanThongBaoPhamVi(raw)` — CHÍNH hàm mà bộ nghe kênh gọi (T8 đi qua bộ nghe thật với
 *   LISTEN giả).
 * ★ Mọi ca âm tính có ĐỐI CHỨNG DƯƠNG trong CÙNG ca: B (vẫn trong phạm vi) nhận cùng gói thăm dò / vẫn nối.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

// ── nhật ký THỨ TỰ: mọi lượt xoá bộ nhớ + mọi lượt ngắt phía server ghi vào đây (T6) ──
const NHAT_KY = vi.hoisted(() => [] as string[]);
// ── BẢN CHỤP handshake theo cookie `phien=<id>`; TAT = tài khoản bị tắt ⇒ handshake ném (như sdk thật) ──
const SDK = vi.hoisted(() => ({ chup: {} as Record<number, { id: number; role: string; name: string }>, tat: new Set<number>() }));
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      if (!m) return null;
      const id = Number(m[1]);
      if (SDK.tat.has(id)) throw new Error("ACCOUNT_DISABLED (gia lap)");
      return SDK.chup[id] ? { ...SDK.chup[id] } : null;
    }),
  },
}));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return { ...goc, getDb: vi.fn(async () => null) };
});
const MAY = { id: 42, code: "M-42", name: "May 42", machineType: "AOI", apiKey: "k", isActive: true, stationId: null, registrationStatus: "pending", syncMode: "realtime", serialNumber: null, firmwareVersion: null };
const MAY_THEO_MA: Record<string, { id: number; code: string }> = { "MA-A": { id: 101, code: "MA-A" }, "MB-B": { id: 202, code: "MB-B" } };
const MAY_THEO_ID: Record<number, any> = { 42: MAY, 101: { ...MAY, id: 101, code: "MA-A" }, 202: { ...MAY, id: 202, code: "MB-B" } };
let nemKhiTraMayTheoMa = false;
const issueMachineKey = vi.fn(async (o: { machineId: number; createdBy?: number | null }) => ({ id: 1, machineId: o.machineId, keyPrefix: "mk_abc123", plaintextKey: "mk_" + "ab".repeat(24) }));
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getMachineById: vi.fn(async (id: number) => (MAY_THEO_ID[id] ? { ...MAY_THEO_ID[id] } : undefined)),
  getMachineByCode: vi.fn(async (code: string) => {
    if (nemKhiTraMayTheoMa) throw new Error("db nac (gia lap)");
    return MAY_THEO_MA[code];
  }),
  updateMachine: vi.fn(async () => undefined),
  getLineByStationId: vi.fn(async () => undefined),
  getUnreadNotificationCount: vi.fn(async () => 0),
  createNotification: vi.fn(),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  getUserById: vi.fn(async () => undefined),
  getSessionByToken: vi.fn(async () => undefined),
  getDb: vi.fn(async () => null),
}));
vi.mock("../services/machineAuthService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/machineAuthService")>()),
  issueMachineKey: (...a: any[]) => (issueMachineKey as any)(...a),
}));
// ── NĂM bộ nhớ đệm theo người: spy ghi vào NHAT_KY (giữ bản gốc cho mọi export khác) ──
vi.mock("./accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accessControl")>()),
  checkPermission: vi.fn(async (uid: number, vai: string, mod: string) => vai === "admin" || (uid === 15 && mod === "machine_registration")),
  invalidateAssignmentCache: vi.fn((id: number) => void NHAT_KY.push(`xoa:assign:${id}`)),
  clearAssignmentCache: vi.fn(() => void NHAT_KY.push("xoaHet:assign")),
}));
vi.mock("../services/authSessionCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/authSessionCache")>()),
  invalidateAuthUser: vi.fn(async (id?: number) => void NHAT_KY.push(`xoa:auth:${id}`)),
  clearAuthSessionCache: vi.fn(async () => void NHAT_KY.push("xoaHet:auth")),
}));
vi.mock("../services/robot/robotStopAuthMemo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/robot/robotStopAuthMemo")>()),
  invalidateStopAuthForUser: vi.fn((id?: number) => void NHAT_KY.push(`xoa:stop:${id}`)),
  clearAllStopAuthMemo: vi.fn(() => void NHAT_KY.push("xoaHet:stop")),
}));
vi.mock("../services/aiAgentPhamVi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/aiAgentPhamVi")>()),
  xoaCachePhamViChu: vi.fn((id?: number) => void NHAT_KY.push(id === undefined ? "xoaHet:ai" : `xoa:ai:${id}`)),
}));
vi.mock("../routes/_congAnh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routes/_congAnh")>()),
  xoaNhoDemPhamViAnhCuaNguoi: vi.fn((id: number) => void NHAT_KY.push(`xoa:anh:${id}`)),
  xoaNhoDemPhamViAnh: vi.fn(() => void NHAT_KY.push("xoaHet:anh")),
}));
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
vi.mock("../services/ecosystem/ecosystemEvents", () => ({ toEcosystemEvent: () => null, isAlertKind: () => false, publishAnomalyDetected: vi.fn() }));
vi.mock("../services/stateStore/stateStore", () => ({ stateStoreEnabled: () => false }));
vi.mock("../services/stateStore/ingest", () => ({ stateStoreOnMachineStatus: vi.fn(), stateStoreOnMachineSocketDisconnect: vi.fn(), trackMachineSocket: vi.fn() }));
vi.mock("../services/stateStore/unsStreamGateway", () => ({ registerUnsStreamHandlers: vi.fn() }));
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../db/reportAggregators", () => ({ resolveTenantFactoryScope: vi.fn(async () => ({ factoryIds: null })) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

type SocketMod = typeof import("./socket");
let socketMod: SocketMod;
let xl: typeof import("./socketXetLaiQuyen");
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ENV_KHOA = ["SOCKET_MACHINE_AUTH_MODE", "MACHINE_APPROVE_RBAC_OPEN_ENABLED"] as const;
const ENV_GOC: Record<string, string | undefined> = Object.fromEntries(ENV_KHOA.map((k) => [k, process.env[k]]));

// ── "DB" (bộ nhớ): người dùng, sổ phiên theo vé, quyền, phạm vi nhà máy ──
type HangNguoi = { id: number; role: string; isActive: boolean | null; name: string; passwordChangedAt?: Date | null; passwordInvalidBefore?: Date | null };
type HangPhien = { id: number; userId: number; isActive: boolean | null; expiresAt: Date | null };
let NGUOI_DB: Record<number, HangNguoi> = {};
let PHIEN_DB: Record<string, HangPhien> = {};
let QUYEN_DB: Record<number, Array<{ moduleName: string; canView: boolean; expiresAt: Date | null }>> = {};
let PHAM: Record<number, number[]> = {};
let nemPhamViCho = new Set<number>();
/** Nhà máy → máy (cho phạm vi "machine"). */
const MAY_CUA_NHA_MAY: Record<number, number[]> = { 1: [101, 42], 2: [202] };
const A = 11, B = 12, AD = 13, H = 14, REG = 15;

function datLaiDb() {
  const nguoi = (id: number, role: string, name: string): HangNguoi => ({ id, role, isActive: true, name, passwordChangedAt: null, passwordInvalidBefore: null });
  NGUOI_DB = { [A]: nguoi(A, "engineer", "A"), [B]: nguoi(B, "engineer", "B"), [AD]: nguoi(AD, "admin", "AD"), [H]: nguoi(H, "admin", "H-se-bi-ha"), [REG]: nguoi(REG, "engineer", "registrar") };
  SDK.chup = Object.fromEntries(Object.values(NGUOI_DB).map((n) => [n.id, { id: n.id, role: n.role, name: n.name }]));
  SDK.tat.clear();
  PHIEN_DB = {
    "ve-11a": { id: 1101, userId: A, isActive: true, expiresAt: null },
    "ve-11b": { id: 1102, userId: A, isActive: true, expiresAt: null },
    "ve-11c": { id: 1103, userId: A, isActive: true, expiresAt: null },
    "ve-12": { id: 1201, userId: B, isActive: true, expiresAt: null },
    "ve-13": { id: 1301, userId: AD, isActive: true, expiresAt: null },
    "ve-14": { id: 1401, userId: H, isActive: true, expiresAt: null },
    "ve-15": { id: 1501, userId: REG, isActive: true, expiresAt: null },
  };
  QUYEN_DB = { [A]: [{ moduleName: "machine_status", canView: true, expiresAt: null }], [B]: [{ moduleName: "machine_status", canView: true, expiresAt: null }] };
  PHAM = { [A]: [1], [B]: [1], [REG]: [1] };
  nemPhamViCho = new Set();
  nemKhiTraMayTheoMa = false;
}
datLaiDb();

const CONG_PHAM_VI = {
  trongPhamVi: async (cap: string, id: number, pv: { userId: number; userRole: string }) => {
    const ids = await CONG_PHAM_VI.idsTrongPhamVi(cap === "factory" ? "factory" : "machine", pv);
    return ids === null || ids.includes(id);
  },
  idsTrongPhamVi: async (cap: string, pv: { userId: number; userRole: string }) => {
    if (nemPhamViCho.has(pv.userId)) throw new Error("db nac (gia lap)");
    if (pv.userRole === "admin") return null;
    const nm = PHAM[pv.userId] ?? [];
    if (cap === "factory") return [...nm];
    if (cap === "machine") return nm.flatMap((f) => MAY_CUA_NHA_MAY[f] ?? []);
    return [];
  },
};
const BO_DOC = {
  docNguoiDung: async (id: number) => (NGUOI_DB[id] ? { ...NGUOI_DB[id] } : undefined),
  docPhien: async (ve: string) => (PHIEN_DB[ve] ? { ...PHIEN_DB[ve] } : undefined),
};

/** Socket server ↔ id người dùng, để nhật ký ngắt biết của ai. */
function ketNoi(o: { phien?: number; ve?: string; may?: boolean }): Promise<ClientSocket> {
  const cookie = o.phien != null ? `phien=${o.phien}${o.ve ? `; app_session_id=${o.ve}` : ""}` : undefined;
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: o.may ? { clientType: "machine" } : {},
    extraHeaders: cookie ? { cookie } : {},
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}
function phongCua(c: ClientSocket): string[] {
  const sk = socketMod.getIO()!.sockets.sockets.get(c.id!);
  if (!sk) throw new Error(`không thấy socket server ${c.id}`);
  return [...sk.rooms].filter((r) => r !== c.id).sort();
}
const conSong = (c: ClientSocket) => socketMod.getIO()!.sockets.sockets.has(c.id ?? "?");
function ghiNhan(c: ClientSocket, evt: string): unknown[] {
  const arr: unknown[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}
function lyDoNgat(c: ClientSocket): Promise<string> {
  return new Promise((r) => c.once("disconnect", (ly) => r(String(ly))));
}
/** Nối + chờ đủ phòng phạm vi (tuDongVaoPhongPhamVi bất đồng bộ). */
async function noiSan(phien: number, ve: string, phongCan: string): Promise<ClientSocket> {
  const c = await ketNoi({ phien, ve });
  await vi.waitFor(() => expect(phongCua(c)).toContain(phongCan), { timeout: 3000 });
  return c;
}
async function thamDo(phong: string, nguoiNhan: ClientSocket[]): Promise<unknown[][]> {
  const g = nguoiNhan.map((c) => ghiNhan(c, "probe"));
  socketMod.getIO()!.to(phong).emit("probe", { phong });
  await cho(120);
  return g;
}

beforeAll(async () => {
  for (const k of ENV_KHOA) delete process.env[k];
  socketMod = await import("./socket");
  xl = await import("./socketXetLaiQuyen");
  (await import("./socketPhongQuyen")).__datCongPhamViChoTest(CONG_PHAM_VI as never);
  (await import("./socketXacThucLai")).__datBoDocChuTheChoTest(BO_DOC);
  xl.__datBoDocQuyenChoTest(async (id) => (QUYEN_DB[id] ?? []).map((q) => ({ ...q })));
  (await import("./phamViDuyetMay")).__datBoTraPhamViDuyetMayChoTest(async (cap, pv) => (cap === "machine" ? CONG_PHAM_VI.idsTrongPhamVi("machine", pv) : CONG_PHAM_VI.idsTrongPhamVi("factory", pv)) as never);
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  // nhật ký NGẮT phía server (để so thứ tự với lượt xoá bộ nhớ)
  socketMod.getIO()!.on("connection", (s) => {
    const uid = (s.data as any)?.user?.id;
    s.on("disconnect", (ly) => NHAT_KY.push(`ngat:${uid ?? "may"}:${ly}`));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  await import("../services/notificationService");
  await cho(50);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  (await import("./socketXacThucLai")).__datBoDocChuTheChoTest(null);
  (await import("./socketPhongQuyen")).__datCongPhamViChoTest(null);
  xl.__datBoDocQuyenChoTest(null);
  xl.__datCauHinhChoTest(null);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => socketMod.getIO()!.close(() => r()));
  for (const [k, v] of Object.entries(ENV_GOC)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  datLaiDb();
  xl.__datLaiChoTest();
  xl.__datCauHinhChoTest(null);
  NHAT_KY.length = 0;
  issueMachineKey.mockClear();
});
afterEach(async () => {
  while (clients.length) clients.pop()!.disconnect();
  await cho(40);
});

describe("★★★ phòng điều khiển lúc nối", () => {
  it("(R0) socket trình duyệt vào kiem:user:{id} + kiem:phien:{user_sessions.id}; vé KHÔNG nằm trong socket.data; socket máy không vào", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    expect(phongCua(a)).toEqual(expect.arrayContaining([`kiem:user:${A}`, "kiem:phien:1101"]));
    const sk = socketMod.getIO()!.sockets.sockets.get(a.id!)!;
    expect(JSON.stringify(sk.data)).not.toContain("ve-11a");
    expect((sk.data as any).khoaPhien).toBe(1101);
    const may = await ketNoi({ may: true });
    await cho(50);
    expect(phongCua(may).filter((p) => p.startsWith("kiem:"))).toEqual([]);
  });
});

describe("★★★ T1–T4 — thông báo ⇒ ngắt đúng người / đúng phiên", () => {
  it("(T1) gỡ phân công: A bị ngắt (io server disconnect); nối lại KHÔNG vào factory:1; thăm dò factory:1 tới B, không tới A", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const ngatA = lyDoNgat(a);
    PHAM[A] = [];
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [A] }));
    expect(await ngatA).toBe("io server disconnect");
    expect(conSong(b)).toBe(true);
    const a2 = await ketNoi({ phien: A, ve: "ve-11a" });
    await cho(150);
    expect(phongCua(a2)).not.toContain("factory:1");
    const [nhanA, nhanB] = await thamDo("factory:1", [a2, b]);
    expect(nhanB.length).toBe(1);
    expect(nhanA).toEqual([]);
  });

  it("(T2) hạ vai admin → engineer: socket cũ bị ngắt; nối lại KHÔNG ở scope:all, chỉ factory:2; thăm dò scope:all không tới; approve bị từ chối (đối chứng: admin khác duyệt được)", async () => {
    const h = await noiSan(H, "ve-14", "scope:all");
    const ad = await noiSan(AD, "ve-13", "scope:all");
    const ngat = lyDoNgat(h);
    NGUOI_DB[H].role = "engineer";
    SDK.chup[H].role = "engineer";
    PHAM[H] = [2];
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [H] }));
    expect(await ngat).toBe("io server disconnect");
    expect(conSong(h)).toBe(false);
    const h2 = await noiSan(H, "ve-14", "factory:2");
    expect(phongCua(h2)).not.toContain("scope:all");
    const [nhanH, nhanAd] = await thamDo("scope:all", [h2, ad]);
    expect(nhanAd.length).toBe(1);
    expect(nhanH).toEqual([]);
    // approve từ socket mới (bản chụp engineer) bị từ chối; admin còn vai duyệt được đúng lượt ấy
    const may = await ketNoi({ may: true });
    await new Promise((r) => { may.once("machine:register_ack", r); may.emit("machine:register", { code: "T2", name: "T2", type: "AOI" }); });
    const okH = ghiNhan(h2, "admin:approve_success");
    h2.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    await cho(150);
    expect(okH).toEqual([]);
    expect(issueMachineKey).not.toHaveBeenCalled();
    const ok = new Promise<any>((r) => ad.once("admin:approve_success", r));
    ad.emit("admin:approve_registration", { socketId: may.id, machineId: MAY.id });
    expect((await ok).apiKey).toBeTruthy();
    expect(issueMachineKey).toHaveBeenCalledTimes(1);
  });

  it("(T3) tắt tài khoản: A bị ngắt; nối lại nhận connect_error UNAUTHORIZED; thăm dò không tới A (đối chứng B nhận)", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const ngat = lyDoNgat(a);
    NGUOI_DB[A].isActive = false;
    SDK.tat.add(A);
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [A] }));
    expect(await ngat).toBe("io server disconnect");
    await expect(ketNoi({ phien: A, ve: "ve-11a" })).rejects.toMatchObject({ message: "UNAUTHORIZED" });
    const [nhanB] = await thamDo("factory:1", [b]);
    expect(nhanB.length).toBe(1);
  });

  it("(T4) theo phiên: {\"s\":1101} chỉ ngắt socket của phiên 1101; socket phiên 1102 của CÙNG người còn sống và nhận thăm dò", async () => {
    const s1 = await noiSan(A, "ve-11a", "factory:1");
    const s2 = await noiSan(A, "ve-11b", "factory:1");
    const ngat = lyDoNgat(s1);
    PHIEN_DB["ve-11a"].isActive = false;
    xl.nhanThongBaoPhamVi(JSON.stringify({ s: 1101, u: [A] }));
    expect(await ngat).toBe("io server disconnect");
    await cho(100);
    expect(conSong(s2)).toBe(true);
    const [nhan2] = await thamDo("factory:1", [s2]);
    expect(nhan2.length).toBe(1);
    // nối lại bằng vé đã thu hồi ⇒ sdk thật sẽ từ chối; ở đây chỉ đo phòng: không có kiem:phien:1101 nào còn sống
    expect(socketMod.getIO()!.of("/").adapter.rooms.get("kiem:phien:1101")?.size ?? 0).toBe(0);
  });

  it("(T4b) revokeAllSessions(A, trừ 1102) — một {\"s\"} cho MỖI phiên bị thu hồi ⇒ phiên 1101 + 1103 rớt; phiên GIỮ LẠI còn sống và nhận thăm dò", async () => {
    const s1 = await noiSan(A, "ve-11a", "factory:1");
    const s2 = await noiSan(A, "ve-11b", "factory:1");
    const s3 = await noiSan(A, "ve-11c", "factory:1");
    const n1 = lyDoNgat(s1);
    const n3 = lyDoNgat(s3);
    PHIEN_DB["ve-11a"].isActive = false;
    PHIEN_DB["ve-11c"].isActive = false;
    xl.nhanThongBaoPhamVi(JSON.stringify({ s: 1101, u: [A] }));
    xl.nhanThongBaoPhamVi(JSON.stringify({ s: 1103, u: [A] }));
    expect(await n1).toBe("io server disconnect");
    expect(await n3).toBe("io server disconnect");
    await xl.__choXongChoTest();
    await cho(80);
    expect(conSong(s2)).toBe(true);
    const [nhan2] = await thamDo("factory:1", [s2]);
    expect(nhan2.length).toBe(1);
  });

  it("(T4c) socket KHÔNG biết khoá phiên (đọc sổ lỗi lúc nối) ⇒ một {\"s\"} của người đó cũng ngắt nó (chiều ĐÓNG); socket người KHÁC còn sống", async () => {
    const goc = BO_DOC.docPhien;
    let lanDoc = 0;
    (BO_DOC as any).docPhien = async (ve: string) => {
      if (ve === "ve-11b" && lanDoc++ === 0) throw new Error("db nac luc handshake");
      return goc(ve);
    };
    try {
      const khongKhoa = await noiSan(A, "ve-11b", "factory:1");
      const b = await noiSan(B, "ve-12", "factory:1");
      expect(phongCua(khongKhoa).filter((p) => p.startsWith("kiem:phien:"))).toEqual([]);
      const ngat = lyDoNgat(khongKhoa);
      xl.nhanThongBaoPhamVi(JSON.stringify({ s: 1101, u: [A] }));
      expect(await ngat).toBe("io server disconnect");
      await cho(80);
      expect(conSong(b)).toBe(true);
    } finally {
      (BO_DOC as any).docPhien = goc;
    }
  });
});

describe("★★★ T5 / T8 — QUÉT (fail-closed, hạn thời gian, LISTEN phục hồi)", () => {
  it("(T5a) quét không thay đổi gì ⇒ KHÔNG ai bị ngắt (không ngắt oan)", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const ad = await noiSan(AD, "ve-13", "scope:all");
    await xl.yeuCauQuet("lưới");
    await cho(80);
    expect([a, b, ad].map(conSong)).toEqual([true, true, true]);
    expect(xl.thongKeXetLaiQuyen()).toMatchObject({ quetNgat: 0, quetLoi: 0 });
    expect(xl.thongKeXetLaiQuyen().quetSocket).toBeGreaterThanOrEqual(3);
  });

  it("(T5) đọc phạm vi NÉM trong lượt quét ⇒ A bị NGẮT (không giữ); đối chứng B còn sống", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const ngat = lyDoNgat(a);
    nemPhamViCho.add(A);
    await xl.yeuCauQuet("lưới");
    expect(await ngat).toBe("io server disconnect");
    expect(conSong(b)).toBe(true);
  });

  it("(T5b) thông báo bị MẤT: phân công / vai / phiên đổi thẳng trong DB, không NOTIFY ⇒ lượt quét ngắt đúng ba người; đối chứng B còn sống", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const h = await noiSan(H, "ve-14", "scope:all");
    const ad = await noiSan(AD, "ve-13", "scope:all");
    const b = await noiSan(B, "ve-12", "factory:1");
    PHAM[A] = [2]; // phạm vi đổi
    NGUOI_DB[H].role = "operator"; // vai đổi
    PHIEN_DB["ve-13"].isActive = false; // phiên bị thu hồi
    await xl.yeuCauQuet("lưới");
    await cho(80);
    expect([a, h, ad, b].map(conSong)).toEqual([false, false, false, true]);
  });

  it("(T5c) HẠN THỜI GIAN không có lượt ghi: quyền hết hạn / phiên hết hạn trong lúc nối ⇒ lượt quét định kỳ ngắt; đối chứng B còn sống", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const s = await noiSan(A, "ve-11b", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    QUYEN_DB[A] = [{ moduleName: "machine_status", canView: true, expiresAt: new Date(Date.now() - 1000) }]; // quyền vừa hết hạn
    await xl.yeuCauQuet("lưới");
    await cho(80);
    expect([a, s, b].map(conSong)).toEqual([false, false, true]);
    QUYEN_DB[A] = [{ moduleName: "machine_status", canView: true, expiresAt: null }];
    const a2 = await noiSan(A, "ve-11a", "factory:1");
    PHIEN_DB["ve-11a"].expiresAt = new Date(Date.now() - 1000); // phiên hết hạn
    await xl.yeuCauQuet("lưới");
    await cho(80);
    expect([a2, b].map(conSong)).toEqual([false, true]);
  });

  it("(T8) LISTEN rớt + tự LISTEN lại (thông báo trong khoảng trống MẤT) ⇒ onLost/onRecovered ⇒ QUÉT; tải trọng đi qua BỘ NGHE THẬT cũng ngắt", async () => {
    const lang: Array<{ fn: (p: string) => void; onlisten?: () => void }> = [];
    const kenh = await xl.batDauNgheSocketPhamVi({
      listenClient: () => ({
        listen: async (_ch: string, fn: (p: string) => void, onlisten?: () => void) => {
          lang.push({ fn, onlisten });
          onlisten?.();
          return { unlisten: async () => undefined };
        },
      }),
      notifyClient: () => ({ notify: async () => undefined }),
      pingMs: 3_600_000,
      alert: () => undefined,
    });
    try {
      const a = await noiSan(A, "ve-11a", "factory:1");
      const b = await noiSan(B, "ve-12", "factory:1");
      // (1) một tải trọng thật qua bộ nghe
      const ngatA = lyDoNgat(a);
      lang[0].fn(JSON.stringify({ u: [A] }));
      expect(await ngatA).toBe("io server disconnect");
      // (2) phiên của B bị thu hồi trong KHOẢNG TRỐNG (không NOTIFY nào tới) — LISTEN rớt rồi postgres.js tự LISTEN lại
      const ngatB = lyDoNgat(b);
      PHIEN_DB["ve-12"].isActive = false;
      const quetTruoc = xl.thongKeXetLaiQuyen().quet;
      lang[0].onlisten?.();
      expect(await ngatB).toBe("io server disconnect");
      expect(xl.thongKeXetLaiQuyen().quet).toBeGreaterThan(quetTruoc);
    } finally {
      await kenh.stop();
    }
  });
});

describe("★★★ T6 — THỨ TỰ: mọi lượt xoá bộ nhớ TRƯỚC lượt ngắt", () => {
  const NAM = ["assign", "auth", "stop", "ai", "anh"];
  it("(T6) {\"u\"} và {\"s\"}: năm bộ nhớ theo người của A được xoá TRƯỚC khi socket của A bị ngắt", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const ngat = lyDoNgat(a);
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [A] }));
    await ngat;
    await cho(50);
    const viTriNgat = NHAT_KY.findIndex((d) => d.startsWith(`ngat:${A}:`));
    expect(viTriNgat).toBeGreaterThan(0);
    for (const ten of NAM) {
      const i = NHAT_KY.indexOf(`xoa:${ten}:${A}`);
      expect(i, `xoa:${ten}`).toBeGreaterThanOrEqual(0);
      expect(i, `xoa:${ten} trước ngắt`).toBeLessThan(viTriNgat);
    }
    NHAT_KY.length = 0;
    const s2 = await noiSan(A, "ve-11b", "factory:1");
    const ngat2 = lyDoNgat(s2);
    xl.nhanThongBaoPhamVi(JSON.stringify({ s: 1102, u: [A] }));
    await ngat2;
    await cho(50);
    const n2 = NHAT_KY.findIndex((d) => d.startsWith(`ngat:${A}:`));
    for (const ten of NAM) expect(NHAT_KY.indexOf(`xoa:${ten}:${A}`), ten).toBeLessThan(n2);
    expect(NHAT_KY.indexOf(`xoa:assign:${A}`)).toBeGreaterThanOrEqual(0);
  });

  it("(T6b) một bộ nhớ NÉM khi xoá ⇒ vẫn ngắt A (và vẫn xoá các bộ còn lại)", async () => {
    const ac = await import("./accessControl");
    (ac.invalidateAssignmentCache as any).mockImplementationOnce(() => {
      throw new Error("bo nho hong");
    });
    const a = await noiSan(A, "ve-11a", "factory:1");
    const ngat = lyDoNgat(a);
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [A] }));
    expect(await ngat).toBe("io server disconnect");
    expect(NHAT_KY).toEqual(expect.arrayContaining([`xoa:auth:${A}`, `xoa:stop:${A}`, `xoa:ai:${A}`, `xoa:anh:${A}`]));
  });
});

describe("★★★ T7 — tải trọng HỎNG ⇒ \"all\" có giới hạn tần suất (fail-closed)", () => {
  it("(T7) hỏng ⇒ xoá hết bộ nhớ RỒI ngắt mọi socket trình duyệt; cụm 6 tải trọng hỏng trong cửa sổ ⇒ ĐÚNG MỘT lượt đuôi (không mất, không bão)", { timeout: 15_000 }, async () => {
    xl.__datCauHinhChoTest({ cuaSoAllMs: 1_500, treAllToiDaMs: 30 });
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const na = lyDoNgat(a);
    const nb = lyDoNgat(b);
    xl.nhanThongBaoPhamVi('{"x":1}');
    expect(await na).toBe("io server disconnect");
    expect(await nb).toBe("io server disconnect");
    const viTriNgat = NHAT_KY.findIndex((d) => d.startsWith("ngat:"));
    for (const ten of ["assign", "auth", "stop", "ai", "anh"]) expect(NHAT_KY.indexOf(`xoaHet:${ten}`), ten).toBeLessThan(viTriNgat);
    expect(xl.thongKeXetLaiQuyen()).toMatchObject({ hong: 1, allChay: 1 });
    // cụm trong cửa sổ
    const a2 = await noiSan(A, "ve-11a", "factory:1");
    for (const raw of ["khong json", "[]", '{"u":[0]}', '{"s":"1","u":[11]}', '{"all":2}', '{"u":[11],"token":"x"}']) xl.nhanThongBaoPhamVi(raw);
    await cho(100);
    expect(conSong(a2)).toBe(true); // còn trong cửa sổ: chưa chạy
    expect(xl.thongKeXetLaiQuyen().allChay).toBe(1);
    await vi.waitFor(() => expect(conSong(a2)).toBe(false), { timeout: 3000 });
    expect(xl.thongKeXetLaiQuyen()).toMatchObject({ hong: 7, allChay: 2 });
    await cho(1_600);
    expect(xl.thongKeXetLaiQuyen().allChay).toBe(2);
  });

  it("(T7b) {\"all\":1} hợp lệ (đổi factories.code) ⇒ cùng đường; socket MÁY không bị ngắt", async () => {
    xl.__datCauHinhChoTest({ cuaSoAllMs: 0, treAllToiDaMs: 0 });
    const a = await noiSan(A, "ve-11a", "factory:1");
    const may = await ketNoi({ may: true });
    const na = lyDoNgat(a);
    xl.nhanThongBaoPhamVi('{"all":1}');
    expect(await na).toBe("io server disconnect");
    await cho(80);
    expect(conSong(may)).toBe(true);
  });
});

describe("★★★ cụm lớn (ADDENDUM 1) — cleanupExpiredSessions có thể phát hàng nghìn {\"s\"} một lúc", () => {
  it("(K1) 5 000 {\"s\"} ⇒ xử lý theo lô có trần (≤ loMoiNhip mỗi nhịp, ≥ 10 nhịp); MỌI socket bị ảnh hưởng rớt, socket không bị ảnh hưởng còn sống + nhận thăm dò", async () => {
    // hai phiên bị ảnh hưởng nằm Ở GIỮA và CUỐI cụm; phiên 1102 của A + B không bị chạm
    const s1 = await noiSan(A, "ve-11a", "factory:1");
    const s3 = await noiSan(A, "ve-11c", "factory:1");
    const s2 = await noiSan(A, "ve-11b", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const n1 = lyDoNgat(s1);
    const n3 = lyDoNgat(s3);
    const N = 5_000;
    const bd = Date.now();
    for (let i = 0; i < N; i++) {
      const s = i === 2_500 ? 1101 : i === N - 1 ? 1103 : 900_000 + i;
      const u = s === 1101 || s === 1103 ? A : 500_000 + (i % 1_000);
      xl.nhanThongBaoPhamVi(JSON.stringify({ s, u: [u] }));
    }
    const msNhan = Date.now() - bd;
    await xl.__choXongChoTest();
    expect(await n1).toBe("io server disconnect");
    expect(await n3).toBe("io server disconnect");
    await cho(80);
    expect([s2, b].map(conSong)).toEqual([true, true]);
    const [nhan2, nhanB] = await thamDo("factory:1", [s2, b]);
    expect(nhan2.length).toBe(1);
    expect(nhanB.length).toBe(1);
    const tk = xl.thongKeXetLaiQuyen();
    expect(tk.phienXuLy).toBe(N);
    expect(tk.loLonNhat).toBeLessThanOrEqual(500);
    expect(tk.loXuLy).toBeGreaterThanOrEqual(10);
    expect(tk.tranHang).toBe(0);
    expect(msNhan, "nhận 5 000 tải trọng phải gần như tức thì (chỉ xếp hàng)").toBeLessThan(2_000);
  }, 30_000);

  it("(K1b) 5 000 {\"u\"} (ví dụ một lượt gán quyền hàng loạt) ⇒ cùng trần lô; người bị ảnh hưởng rớt, B còn sống", async () => {
    const a = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const na = lyDoNgat(a);
    for (let i = 0; i < 5_000; i++) xl.nhanThongBaoPhamVi(JSON.stringify({ u: [i === 4_999 ? A : 800_000 + i] }));
    await xl.__choXongChoTest();
    expect(await na).toBe("io server disconnect");
    await cho(80);
    expect(conSong(b)).toBe(true);
    const tk = xl.thongKeXetLaiQuyen();
    expect(tk.nguoiXuLy).toBe(5_000);
    expect(tk.loLonNhat).toBeLessThanOrEqual(500);
    expect(tk.loXuLy).toBeGreaterThanOrEqual(10);
  }, 30_000);

  it("(K2) hàng đợi VƯỢT TRẦN ⇒ bỏ hàng đợi và QUÉT (không mất sự kiện: phiên bị thu hồi vẫn rớt qua lượt quét); đối chứng B còn sống", async () => {
    xl.__datCauHinhChoTest({ tranHang: 100 });
    const s1 = await noiSan(A, "ve-11a", "factory:1");
    const b = await noiSan(B, "ve-12", "factory:1");
    const n1 = lyDoNgat(s1);
    PHIEN_DB["ve-11a"].isActive = false; // thông báo của nó sẽ nằm trong phần bị bỏ
    for (let i = 0; i < 150; i++) xl.nhanThongBaoPhamVi(JSON.stringify({ s: i === 50 ? 1101 : 700_000 + i, u: [i === 50 ? A : 600_000 + i] })); // 1101 nằm trong phần BỊ BỎ (tràn ở mục 101)
    expect(await n1).toBe("io server disconnect");
    await xl.__choXongChoTest();
    await cho(80);
    expect(conSong(b)).toBe(true);
    expect(xl.thongKeXetLaiQuyen().tranHang).toBeGreaterThanOrEqual(1);
    expect(xl.thongKeXetLaiQuyen().quet).toBeGreaterThanOrEqual(1);
  });
});

describe("★★★ T9 — sự kiện phòng `admin` theo phạm vi TỪNG người nhận (mục 5)", () => {
  async function voiCo<T>(env: Record<string, string>, f: () => Promise<T>): Promise<T> {
    const goc = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
      return await f();
    } finally {
      for (const [k, v] of Object.entries(goc)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
  async function vaoAdmin(c: ClientSocket): Promise<void> {
    const p = new Promise((r) => c.once("admin:pending_registrations", r));
    c.emit("admin:join");
    await p;
  }
  const ma = (xs: unknown[]) => (xs as any[]).map((x) => x.machineCode ?? x.machineId).sort();

  it("(T9) connected (kèm IP) / sync_status / disconnected / discovered: registrar nhà máy A chỉ nhận máy của A; admin nhận cả hai", async () => {
    await voiCo({ MACHINE_APPROVE_RBAC_OPEN_ENABLED: "true", SOCKET_MACHINE_AUTH_MODE: "off" }, async () => {
      const reg = await ketNoi({ phien: REG, ve: "ve-15" });
      const ad = await ketNoi({ phien: AD, ve: "ve-13" });
      await vaoAdmin(reg);
      await vaoAdmin(ad);
      const ev = ["machine:connected", "machine:sync_status", "machine:disconnected", "machine:discovered"];
      const nhanReg = Object.fromEntries(ev.map((e) => [e, ghiNhan(reg, e)]));
      const nhanAd = Object.fromEntries(ev.map((e) => [e, ghiNhan(ad, e)]));
      const mayA = await ketNoi({ may: true });
      const mayB = await ketNoi({ may: true });
      mayA.emit("machine:confirm_mapping", { machineId: 101, machineCode: "MA-A" });
      mayB.emit("machine:confirm_mapping", { machineId: 202, machineCode: "MB-B" });
      await vi.waitFor(() => expect(nhanAd["machine:connected"].length).toBe(2));
      mayA.emit("machine:sync_started", { machineId: 101, machineCode: "MA-A", apiKey: "k" });
      mayB.emit("machine:sync_started", { machineId: 202, machineCode: "MB-B", apiKey: "k" });
      await vi.waitFor(() => expect(nhanAd["machine:sync_status"].length).toBe(2));
      socketMod.autoDiscoverMachine("aoi/MA-A/inspection", { x: 1 });
      socketMod.autoDiscoverMachine("aoi/MB-B/inspection", { x: 1 });
      await vi.waitFor(() => expect(nhanAd["machine:discovered"].length).toBe(2));
      mayA.disconnect();
      mayB.disconnect();
      await vi.waitFor(() => expect(nhanAd["machine:disconnected"].length).toBe(2));
      await cho(120);
      for (const e of ev) {
        expect(ma(nhanAd[e]), `admin ${e}`).toEqual(e === "machine:discovered" ? ["MA-A", "MB-B"] : ["MA-A", "MB-B"]);
        expect(ma(nhanReg[e]), `registrar ${e}`).toEqual(["MA-A"]);
      }
    });
  });

  it("(T9b) tra máy của sự kiện LỖI ⇒ registrar không nhận; phạm vi người nhận lỗi LÚC JOIN ⇒ registrar không nhận gì; admin vẫn nhận", async () => {
    await voiCo({ MACHINE_APPROVE_RBAC_OPEN_ENABLED: "true", SOCKET_MACHINE_AUTH_MODE: "off" }, async () => {
      const reg = await ketNoi({ phien: REG, ve: "ve-15" });
      const ad = await ketNoi({ phien: AD, ve: "ve-13" });
      await vaoAdmin(reg);
      await vaoAdmin(ad);
      const nhanReg = ghiNhan(reg, "machine:discovered");
      const nhanAd = ghiNhan(ad, "machine:discovered");
      nemKhiTraMayTheoMa = true;
      socketMod.autoDiscoverMachine("aoi/MA-T9B/x", {}); // mã MỚI (bản đồ discovered giữ mã cũ ⇒ không phát lại)
      await vi.waitFor(() => expect(nhanAd.length).toBe(1));
      await cho(80);
      expect(nhanReg).toEqual([]);
      nemKhiTraMayTheoMa = false;
      // registrar thứ hai join khi phạm vi KHÔNG tính được ⇒ cache rỗng ⇒ không nhận sự kiện của chính nhà máy A
      nemPhamViCho.add(REG);
      const reg2 = await ketNoi({ phien: REG, ve: "ve-15" });
      await vaoAdmin(reg2);
      nemPhamViCho.delete(REG);
      const nhanReg2 = ghiNhan(reg2, "machine:connected");
      const nhanReg1 = ghiNhan(reg, "machine:connected");
      const mayA = await ketNoi({ may: true });
      mayA.emit("machine:confirm_mapping", { machineId: 101, machineCode: "MA-A" });
      await vi.waitFor(() => expect(nhanReg1.length).toBe(1)); // đối chứng: registrar có cache hợp lệ nhận
      await cho(80);
      expect(nhanReg2).toEqual([]);
    });
  });
});
