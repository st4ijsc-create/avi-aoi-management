/**
 * socketPhamViSite.test.ts — ★★★ PV-socket-1 (2026-11-03): `site:update` (KPI + số cảnh báo theo SITE federation) chỉ tới người được
 * xem site ấy qua tRPC (`federationRouter`: `admin_system/canView` + `dieuKienTrang`), và F4: người dùng duy nhất còn lại của `global`
 * (`twin:update`) lọc theo phạm vi TỪNG người nhận.
 *
 * Lỗ L1 (pv-socket-kiem-ke §3): `site:{code}` / `sites:global` không cổng ⇒ mọi người đăng nhập (kể cả không admin_system, tập đoàn khác,
 * người không được xem site cục bộ) nhận yield / OEE / số cảnh báo của MỌI site.
 *
 * ★ Harness như socketXetLaiQuyen.test.ts: socket.io THẬT trên 127.0.0.1 cổng 0, `initializeSocket` THẬT, handshake THẬT (sdk giả trả bản
 *   chụp theo cookie `phien=<id>`), handler THẬT, `emitSiteUpdate` / `emitTwinUpdate` THẬT. KHÔNG CSDL (không một hàng nào — Part A của
 *   kiểm kê): quyền + mã tập đoàn của cổng federation qua seam `__datCongFederationChoTest`, phạm vi nhà máy qua `__datCongPhamViChoTest`,
 *   người dùng / phiên / quyền / tập đoàn của bộ xét lại qua seam của F5. NOTIFY giả lập bằng `nhanThongBaoPhamVi(raw)`.
 * ★ Part B (DB, ROLLBACK) BỎ có chủ ý: cổng dùng ĐÚNG hai bộ đọc có sẵn (`checkPermission` + `getUserAssignmentCodes`) mà
 *   `federationRouter` dùng (không bộ phân giải mới đọc DB) — logic quyết định đo qua seam ở đây.
 * ★ Mọi ca âm tính có ĐỐI CHỨNG DƯƠNG trong CÙNG ca.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

const SDK = vi.hoisted(() => ({ chup: {} as Record<number, { id: number; role: string; name: string }> }));
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      if (!m) return null;
      const id = Number(m[1]);
      return SDK.chup[id] ? { ...SDK.chup[id] } : null;
    }),
  },
}));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return { ...goc, getDb: vi.fn(async () => null) };
});
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getMachineById: vi.fn(async () => undefined),
  getMachineByCode: vi.fn(async () => undefined),
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
// Cổng federation đi qua seam (không qua accessControl); các bộ nhớ theo người mà {"u"} xoá: thay bằng hàm rỗng (tệp này đo PHÒNG).
vi.mock("./accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accessControl")>()),
  checkPermission: vi.fn(async (_uid: number, vai: string) => vai === "admin"),
  invalidateAssignmentCache: vi.fn(),
  clearAssignmentCache: vi.fn(),
}));
vi.mock("../services/authSessionCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/authSessionCache")>()),
  invalidateAuthUser: vi.fn(async () => undefined),
  clearAuthSessionCache: vi.fn(async () => undefined),
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
// F4 — bản đồ trạm → nhà máy THẬT hình dạng (Map): 501 → nhà máy 1, 502 → nhà máy 2, 503 → không rõ nhà máy (chỉ toàn quyền thấy).
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => new Map([[501, 1], [502, 2]])) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
const PHAM_TWIN = vi.hoisted(() => ({ ds: {} as Record<number, number[]> }));
vi.mock("../db/reportAggregators", () => ({
  resolveTenantFactoryScope: vi.fn(async (pv: { userId: number; userRole: string }) => ({ factoryIds: pv.userRole === "admin" ? null : [...(PHAM_TWIN.ds[pv.userId] ?? [])] })),
}));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

type SocketMod = typeof import("./socket");
let socketMod: SocketMod;
let xl: typeof import("./socketXetLaiQuyen");
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TWIN_GOC = process.env.TWIN_STREAM_ENABLED;

// ── người: A (tập đoàn C-A, có admin_system) · B (C-B, có) · OP (C-A, KHÔNG admin_system) · AD (admin) · Z (có quyền, 0 mã)
//    N (cổng NÉM) · W (một mã có ký tự điều khiển + mã chữ tự do VN.HCM) · S (cổng CHẬM) ──
const A = 21, B = 22, OP = 23, AD = 24, Z = 25, N = 26, W = 27, S = 28;
type HangNguoi = { id: number; role: string; isActive: boolean | null; name: string; passwordChangedAt?: Date | null; passwordInvalidBefore?: Date | null };
let NGUOI_DB: Record<number, HangNguoi> = {};
let PHIEN_DB: Record<string, { id: number; userId: number; isActive: boolean | null; expiresAt: Date | null }> = {};
let TAP_DOAN: Record<number, string[]> = {};
let QUYEN_FED = new Set<number>();
let PHAM: Record<number, number[]> = {};
let nemCongFed = new Set<number>();
let giayPhepFed = true;
let nemPhamViCho = new Set<number>();
const CHAM_FED_MS: Record<number, number> = { [S]: 200 };

function datLai() {
  const nguoi = (id: number, role: string, name: string): HangNguoi => ({ id, role, isActive: true, name, passwordChangedAt: null, passwordInvalidBefore: null });
  NGUOI_DB = {
    [A]: nguoi(A, "engineer", "A"), [B]: nguoi(B, "engineer", "B"), [OP]: nguoi(OP, "operator", "OP"), [AD]: nguoi(AD, "admin", "AD"),
    [Z]: nguoi(Z, "engineer", "Z"), [N]: nguoi(N, "engineer", "N"), [W]: nguoi(W, "engineer", "W"), [S]: nguoi(S, "engineer", "S"),
  };
  SDK.chup = Object.fromEntries(Object.values(NGUOI_DB).map((n) => [n.id, { id: n.id, role: n.role, name: n.name }]));
  PHIEN_DB = Object.fromEntries(Object.values(NGUOI_DB).map((n) => [`ve-${n.id}`, { id: n.id * 100, userId: n.id, isActive: true, expiresAt: null }]));
  TAP_DOAN = { [A]: ["C-A"], [B]: ["C-B"], [OP]: ["C-A"], [Z]: [], [N]: ["C-A"], [W]: ["xau\u0007ma", "VN.HCM"], [S]: ["C-A"] };
  QUYEN_FED = new Set([A, B, Z, N, W, S]); // OP KHÔNG có admin_system/canView; AD là admin
  PHAM = { [A]: [1], [B]: [2], [OP]: [1], [Z]: [], [N]: [1], [W]: [1], [S]: [1] };
  PHAM_TWIN.ds = PHAM;
  nemCongFed = new Set();
  giayPhepFed = true;
  nemPhamViCho = new Set();
}
datLai();

const CONG_FED = {
  coGiayPhep: async () => giayPhepFed,
  coQuyen: async (userId: number, role: string) => {
    if (nemCongFed.has(userId)) throw new Error("db nac (gia lap)");
    if (CHAM_FED_MS[userId]) await cho(CHAM_FED_MS[userId]);
    return role === "admin" || QUYEN_FED.has(userId);
  },
  maTapDoan: async (userId: number, role: string) => {
    if (nemCongFed.has(userId)) throw new Error("db nac (gia lap)");
    return { toanQuyen: role === "admin", corporateCodes: role === "admin" ? [] : [...(TAP_DOAN[userId] ?? [])] };
  },
};
const CONG_PHAM_VI = {
  trongPhamVi: async (_cap: string, id: number, pv: { userId: number; userRole: string }) => {
    const ids = await CONG_PHAM_VI.idsTrongPhamVi("factory", pv);
    return ids === null || ids.includes(id);
  },
  idsTrongPhamVi: async (_cap: string, pv: { userId: number; userRole: string }) => {
    if (nemPhamViCho.has(pv.userId)) throw new Error("db nac (gia lap)");
    return pv.userRole === "admin" ? null : [...(PHAM[pv.userId] ?? [])];
  },
};

function ketNoi(id: number): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: { cookie: `phien=${id}; app_session_id=ve-${id}` },
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
const phongSites = (c: ClientSocket) => phongCua(c).filter((p) => p.startsWith("site"));
const conSong = (c: ClientSocket) => socketMod.getIO()!.sockets.sockets.has(c.id ?? "?");
function ghiNhan(c: ClientSocket, evt: string): any[] {
  const arr: any[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}
/** Nối + chờ lượt tự vào phòng phạm vi xong (dấu vân tay phạm vi có mặt). */
async function noi(id: number): Promise<ClientSocket> {
  const c = await ketNoi(id);
  await vi.waitFor(() => expect((socketMod.getIO()!.sockets.sockets.get(c.id!)!.data as any).__daVaoPhongPhamVi).toBe(true), { timeout: 3000 });
  return c;
}

type Site = { siteCode: string; siteId: number; corporateCode: string | null; isLocal: boolean };
const SITE_A: Site = { siteCode: "SA", siteId: 1, corporateCode: "C-A", isLocal: false };
const SITE_B: Site = { siteCode: "SB", siteId: 2, corporateCode: "C-B", isLocal: false };
const SITE_L: Site = { siteCode: "SL", siteId: 3, corporateCode: "C-A", isLocal: true }; // site CỤC BỘ (lõi này) gắn mã C-A ⇒ vẫn chỉ toàn quyền
const SITE_N: Site = { siteCode: "SN", siteId: 4, corporateCode: null, isLocal: false }; // không mã tập đoàn ⇒ chỉ toàn quyền
const SITE_V: Site = { siteCode: "SV", siteId: 5, corporateCode: "VN.HCM", isLocal: false }; // fix round 1 m3: mã tập đoàn chữ tự do
const goi = (s: Site) => ({
  ...s, status: "active", freshness: "ok" as const, kpi: { yieldRate: 0.97, ngRate: 0.03, throughput: 1234, oee: 0.81 }, alerts: { open: 4, critical: 1 }, ts: Date.now(),
});
const ma = (arr: any[]) => arr.map((e) => e.siteCode).sort();

beforeAll(async () => {
  delete process.env.SOCKET_MACHINE_AUTH_MODE;
  socketMod = await import("./socket");
  xl = await import("./socketXetLaiQuyen");
  const pq = await import("./socketPhongQuyen");
  pq.__datCongPhamViChoTest(CONG_PHAM_VI as never);
  pq.__datCongFederationChoTest(CONG_FED);
  (await import("./socketXacThucLai")).__datBoDocChuTheChoTest({
    docNguoiDung: async (id: number) => (NGUOI_DB[id] ? { ...NGUOI_DB[id] } : undefined),
    docPhien: async (ve: string) => (PHIEN_DB[ve] ? { ...PHIEN_DB[ve] } : undefined),
  } as never);
  xl.__datBoDocQuyenChoTest(async (id) => (QUYEN_FED.has(id) ? [{ moduleName: "admin_system", canView: true, expiresAt: null }] : []) as never);
  xl.__datBoDocTapDoanChoTest(async (id, role) => (role === "admin" ? [] : [...(TAP_DOAN[id] ?? [])]));
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
  const pq = await import("./socketPhongQuyen");
  pq.__datCongPhamViChoTest(null);
  pq.__datCongFederationChoTest(null);
  (await import("./socketXacThucLai")).__datBoDocChuTheChoTest(null);
  xl.__datBoDocQuyenChoTest(null);
  xl.__datBoDocTapDoanChoTest(null);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => socketMod.getIO()!.close(() => r()));
  if (TWIN_GOC === undefined) delete process.env.TWIN_STREAM_ENABLED;
  else process.env.TWIN_STREAM_ENABLED = TWIN_GOC;
});

beforeEach(() => {
  datLai();
  xl.__datLaiChoTest();
  xl.__datCauHinhChoTest(null);
});
afterEach(async () => {
  while (clients.length) clients.pop()!.disconnect();
  await cho(40);
});

describe("★★★ F1 — phòng `site:{code}` không còn", () => {
  it("(1) subscribe {siteCode} ⇒ KHÔNG join gì, thăm dò `site:SA` không tới ai; đối chứng: CÙNG socket với {sitesGlobal} vào sites:corp:C-A và nhận site:update của SA (gói KHÔNG mang trường định tuyến)", async () => {
    const a = await noi(A);
    const thamDo = ghiNhan(a, "probe");
    const nhan = ghiNhan(a, "site:update");
    a.emit("subscribe", { siteCode: SITE_A.siteCode });
    await cho(200);
    expect(phongSites(a)).toEqual([]);
    socketMod.getIO()!.to(`site:${SITE_A.siteCode}`).emit("probe", 1);
    await cho(100);
    expect(thamDo).toEqual([]);
    a.emit("subscribe", { sitesGlobal: true, siteCode: SITE_A.siteCode });
    await vi.waitFor(() => expect(phongSites(a)).toEqual(["sites:corp:C-A"]), { timeout: 3000 });
    socketMod.emitSiteUpdate(goi(SITE_A));
    await vi.waitFor(() => expect(ma(nhan)).toEqual(["SA"]), { timeout: 3000 });
    expect(nhan[0]).not.toHaveProperty("corporateCode");
    expect(nhan[0]).not.toHaveProperty("isLocal");
    expect(nhan[0]).toMatchObject({ siteId: 1, kpi: { oee: 0.81 }, alerts: { open: 4, critical: 1 } });
  });
});

describe("★★★ F2 — `sites:all` / `sites:corp:{mã}`: mỗi người chỉ nhận site trong phạm vi tRPC của mình", () => {
  it("(2) A chỉ SA · B chỉ SB · OP (không admin_system) không gì · Z (0 mã) không gì · W (mã có ký tự điều khiển bị bỏ; VN.HCM giữ) chỉ SV · AD nhận SA SB SL SN SV đúng một lần mỗi site", async () => {
    const ds = await Promise.all([A, B, OP, AD, Z, W].map(noi));
    const [a, b, op, ad, z, w] = ds;
    const n = ds.map((c) => ghiNhan(c, "site:update"));
    for (const c of ds) c.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => {
      expect(phongSites(a)).toEqual(["sites:corp:C-A"]);
      expect(phongSites(b)).toEqual(["sites:corp:C-B"]);
      expect(phongSites(ad)).toEqual(["sites:all"]);
      expect(phongSites(w)).toEqual(["sites:corp:VN.HCM"]);
    }, { timeout: 3000 });
    await cho(150);
    expect(phongSites(op)).toEqual([]);
    expect(phongSites(z)).toEqual([]);
    for (const s of [SITE_A, SITE_B, SITE_L, SITE_N, SITE_V]) socketMod.emitSiteUpdate(goi(s));
    await vi.waitFor(() => expect(ma(n[3])).toEqual(["SA", "SB", "SL", "SN", "SV"]), { timeout: 3000 }); // đối chứng DƯƠNG: admin nhận tất (một lần mỗi site)
    await cho(200);
    expect(ma(n[0])).toEqual(["SA"]); // không SB (tập đoàn khác), không SL (site cục bộ), không SN (không mã)
    expect(ma(n[1])).toEqual(["SB"]);
    expect(n[2]).toEqual([]);
    expect(n[4]).toEqual([]);
    expect(ma(n[5])).toEqual(["SV"]);
    expect(n[3]).toHaveLength(5);
  });

  it("(3) cổng NÉM (DB lỗi) ⇒ không join + SUBSCRIBE_DENIED; không quyền / 0 mã ⇒ cũng SUBSCRIBE_DENIED; đối chứng: A vào và nhận, không lỗi", async () => {
    nemCongFed.add(N);
    const [nn, op, z, a] = await Promise.all([N, OP, Z, A].map(noi));
    const loi = [nn, op, z, a].map((c) => ghiNhan(c, "subscribe:error"));
    const nhanN = ghiNhan(nn, "site:update");
    const nhanA = ghiNhan(a, "site:update");
    for (const c of [nn, op, z, a]) c.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(loi.slice(0, 3).map((l) => l.length)).toEqual([1, 1, 1]), { timeout: 3000 });
    expect(loi[0][0]).toEqual({ code: "SUBSCRIBE_DENIED" });
    await vi.waitFor(() => expect(phongSites(a)).toEqual(["sites:corp:C-A"]), { timeout: 3000 });
    expect(phongSites(nn)).toEqual([]);
    socketMod.emitSiteUpdate(goi(SITE_A));
    await vi.waitFor(() => expect(nhanA).toHaveLength(1), { timeout: 3000 });
    await cho(100);
    expect(nhanN).toEqual([]);
    expect(loi[3]).toEqual([]);
  });

  it("(3c) fix round 1 m2 — KHÔNG có giấy phép MOD_FEDERATION ⇒ admin và A đều không vào + SUBSCRIBE_DENIED; đối chứng: giấy phép về ⇒ subscribe lại vào sites:all / sites:corp:C-A", async () => {
    giayPhepFed = false;
    const [ad, a] = await Promise.all([AD, A].map(noi));
    const loi = [ad, a].map((c) => ghiNhan(c, "subscribe:error"));
    for (const c of [ad, a]) c.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(loi.map((l) => l.length)).toEqual([1, 1]), { timeout: 3000 });
    expect([phongSites(ad), phongSites(a)]).toEqual([[], []]);
    giayPhepFed = true;
    for (const c of [ad, a]) c.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect([phongSites(ad), phongSites(a)]).toEqual([["sites:all"], ["sites:corp:C-A"]]), { timeout: 3000 });
  });

  it("(3b) unsubscribe {sitesGlobal}: rời phòng; cổng CHẬM + unsubscribe NGAY ⇒ kết quả muộn KHÔNG join; đối chứng: subscribe lại không unsubscribe ⇒ vào", async () => {
    const a = await noi(A);
    a.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(phongSites(a)).toEqual(["sites:corp:C-A"]), { timeout: 3000 });
    a.emit("unsubscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(phongSites(a)).toEqual([]), { timeout: 3000 });
    const s = await noi(S);
    s.emit("subscribe", { sitesGlobal: true });
    s.emit("unsubscribe", { sitesGlobal: true });
    await cho(CHAM_FED_MS[S] * 3 + 150);
    expect(phongSites(s)).toEqual([]);
    s.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(phongSites(s)).toEqual(["sites:corp:C-A"]), { timeout: 3000 });
  });
});

describe("★★★ F5 — phòng federation là phòng CÓ PHẠM VI: mất quyền / đổi tập đoàn ⇒ ra khỏi phòng", () => {
  it("(4) {\"u\":[A]} ⇒ socket của A ở sites:corp:C-A bị ngắt; nối lại sau khi gỡ mã ⇒ không vào; B còn sống và vẫn nhận SB", async () => {
    const [a, b] = await Promise.all([A, B].map(noi));
    for (const c of [a, b]) c.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect([phongSites(a), phongSites(b)]).toEqual([["sites:corp:C-A"], ["sites:corp:C-B"]]), { timeout: 3000 });
    const ngat = new Promise((r) => a.once("disconnect", r));
    TAP_DOAN[A] = [];
    xl.nhanThongBaoPhamVi(JSON.stringify({ u: [A] }));
    expect(await ngat).toBe("io server disconnect");
    const nhanB = ghiNhan(b, "site:update");
    socketMod.emitSiteUpdate(goi(SITE_B));
    await vi.waitFor(() => expect(nhanB).toHaveLength(1), { timeout: 3000 });
    expect(conSong(b)).toBe(true);
    const a2 = await noi(A);
    const loi = ghiNhan(a2, "subscribe:error");
    a2.emit("subscribe", { sitesGlobal: true });
    await vi.waitFor(() => expect(loi).toHaveLength(1), { timeout: 3000 });
    expect(phongSites(a2)).toEqual([]);
  });

  it("(4b) thu hồi admin_system KHÔNG NOTIFY ⇒ lượt quét ngắt A; socket CHƯA có dấu vân tay phạm vi nhưng ở sites:corp ⇒ lượt quét CHẶT ngắt; đối chứng B còn sống", async () => {
    const [a, b] = await Promise.all([A, B].map(noi));
    nemPhamViCho.add(W); // lượt tự vào phòng phạm vi của W lỗi lúc nối ⇒ không có dấu vân tay phạm vi
    const w = await ketNoi(W);
    await cho(150);
    nemPhamViCho.delete(W);
    expect((socketMod.getIO()!.sockets.sockets.get(w.id!)!.data as any).__daVaoPhongPhamVi).not.toBe(true);
    for (const c of [a, b]) c.emit("subscribe", { sitesGlobal: true });
    socketMod.getIO()!.sockets.sockets.get(w.id!)!.join("sites:corp:C-A"); // vd. subscribe trước khi lượt tự vào phòng xong
    await vi.waitFor(() => expect([phongSites(a), phongSites(b)]).toEqual([["sites:corp:C-A"], ["sites:corp:C-B"]]), { timeout: 3000 });
    QUYEN_FED.delete(A);
    await xl.yeuCauQuet("lưới PV-socket-1");
    await cho(100);
    expect([a, b, w].map(conSong)).toEqual([false, true, false]);
  });
});

describe("★★★ F4 — `twin:update`: `global` chỉ để LIỆT KÊ socket; trạm lọc theo phạm vi TỪNG người nhận", () => {
  it("(5) A (nhà máy 1) chỉ trạm 501 · B (nhà máy 2) chỉ 502 · Z (phạm vi rỗng) KHÔNG nhận gói nào · AD nhận cả 501 502 503", async () => {
    process.env.TWIN_STREAM_ENABLED = "true";
    try {
      const ds = await Promise.all([A, B, Z, AD].map(noi));
      for (const c of ds) c.emit("subscribe", {});
      await vi.waitFor(() => ds.forEach((c) => expect(phongCua(c)).toContain("global")), { timeout: 3000 });
      const n = ds.map((c) => ghiNhan(c, "twin:update"));
      socketMod.emitTwinUpdate({ stations: [{ stationId: 501, wipCount: 7 }, { stationId: 502, wipCount: 8 }, { stationId: 503, wipCount: 9 }], ts: Date.now() });
      await vi.waitFor(() => expect(n[3]).toHaveLength(1), { timeout: 3000 }); // đối chứng DƯƠNG
      await cho(150);
      const tram = (arr: any[]) => arr.map((g) => g.stations.map((s: any) => s.stationId));
      expect(tram(n[3])).toEqual([[501, 502, 503]]);
      expect(tram(n[0])).toEqual([[501]]);
      expect(tram(n[1])).toEqual([[502]]);
      expect(n[2]).toEqual([]);
    } finally {
      if (TWIN_GOC === undefined) delete process.env.TWIN_STREAM_ENABLED;
      else process.env.TWIN_STREAM_ENABLED = TWIN_GOC;
    }
  });
});
