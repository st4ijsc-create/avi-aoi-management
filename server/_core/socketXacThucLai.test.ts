/**
 * socketXacThucLai.test.ts — ★★★ F5-nhanh: handler socket NHẠY CẢM không tin vai chụp lúc handshake.
 *
 * LỖI ĐƯỢC GHIM: `socket.data.user` là ẢNH CHỤP ở handshake; trước bản vá `admin:approve_registration` (đúc khoá API máy) và
 * `admin:reject_registration` đọc vai từ bản chụp ⇒ admin bị HẠ vai / tài khoản bị TẮT / phiên bị THU HỒI vẫn duyệt được máy và
 * nhận khoá, tới khi socket rớt.
 *
 * ★ Harness như socketPhongQuyen.test.ts: socket.io THẬT trên 127.0.0.1 cổng 0, `initializeSocket` THẬT, handshake THẬT (sdk giả
 *   trả BẢN CHỤP theo cookie `phien=<id>`), handler THẬT. KHÔNG CSDL: "DB" là hai bảng trong bộ nhớ đưa qua seam
 *   `__datBoDocChuTheChoTest` (người dùng theo id, sổ phiên theo vé `app_session_id`). Đổi vai / tắt / thu hồi = sửa bảng đó SAU
 *   handshake — đúng hình dạng lỗ: bản chụp vẫn là admin, DB thì không.
 * ★ Mọi ca âm tính có ĐỐI CHỨNG DƯƠNG trong cùng ca: một socket admin còn hiệu lực duyệt/từ chối được ĐÚNG lượt đăng ký mà socket
 *   bị chặn vừa thử (chứng minh lượt bị chặn không có tác dụng phụ và đường duyệt vẫn sống).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

// ── BẢN CHỤP handshake theo cookie `phien=<id>` (sdk.authenticateRequest giả). Cả hai đều là admin LÚC NỐI. ──
const CHUP: Record<number, { id: number; role: string; name: string }> = {
  1: { id: 1, role: "admin", name: "admin-se-bi-ha" },
  2: { id: 2, role: "admin", name: "admin-doi-chung" },
  // polish — non-admin được cấp quyền machine_registration (chỉ có tác dụng khi MACHINE_APPROVE_RBAC_OPEN_ENABLED=true)
  3: { id: 3, role: "engineer", name: "registrar-engineer" },
  // review fix (Minor 3) — operator: bản chụp KHÔNG đủ quyền ⇒ tiền lọc từ chối, 0 câu DB
  4: { id: 4, role: "operator", name: "operator-dashboard" },
};
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      return m ? (CHUP[Number(m[1])] ?? null) : null;
    }),
  },
}));
vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return { ...goc, getDb: vi.fn(async () => null) };
});

// ── "DB" có thẩm quyền mà bộ xác thực lại đọc (mặc định trong mã: db.getUserById / db.getSessionByToken — ca (U7) đo dây nối đó). ──
type HangNguoi = {
  id: number; role: string; isActive: boolean | null; name: string;
  passwordChangedAt?: Date | string | null; passwordInvalidBefore?: Date | string | null;
};
type HangPhien = { userId: number; isActive: boolean | null; expiresAt: Date | null };
let NGUOI_DB: Record<number, HangNguoi> = {};
let PHIEN_DB: Record<string, HangPhien> = {};
const NEM_KHI_DOC_NGUOI = new Set<number>();
let nemKhiDocPhien = false;
let nemKhiTraPhamViDuyet = false; // F5-nhanh — seam phạm vi duyệt ném
function datLaiDb() {
  NGUOI_DB = {
    1: { id: 1, role: "admin", isActive: true, name: "admin-se-bi-ha" },
    2: { id: 2, role: "admin", isActive: true, name: "admin-doi-chung" },
    3: { id: 3, role: "engineer", isActive: true, name: "registrar-engineer", passwordChangedAt: null, passwordInvalidBefore: null },
    4: { id: 4, role: "operator", isActive: true, name: "operator-dashboard" },
  };
  PHIEN_DB = {
    "ve-1a": { userId: 1, isActive: true, expiresAt: null },
    "ve-1b": { userId: 1, isActive: true, expiresAt: null },
    "ve-2": { userId: 2, isActive: true, expiresAt: null },
    "ve-3": { userId: 3, isActive: true, expiresAt: null },
    "ve-4": { userId: 4, isActive: true, expiresAt: null },
  };
  NEM_KHI_DOC_NGUOI.clear();
  nemKhiDocPhien = false;
  nemKhiTraPhamViDuyet = false;
}
datLaiDb();

const MAY_THEO_MA: Record<string, { id: number; code: string }> = { "MA-A": { id: 101, code: "MA-A" }, "MB-B": { id: 202, code: "MB-B" } };
/** Máy đang online (kho hiện diện giả): một máy mỗi nhà máy. */
const ONLINE = [
  { machineId: 101, machineCode: "MA-A", socketId: "sa", ipAddress: "10.0.0.1", lastHeartbeat: Date.now() },
  { machineId: 202, machineCode: "MB-B", socketId: "sb", ipAddress: "10.0.0.2", lastHeartbeat: Date.now() },
];
/** F5-nhanh (phạm vi duyệt) — máy 202 thuộc nhà máy B; registrar 3 chỉ có máy 101 + MAY (42) ở nhà máy A. */
const MAY_B = { id: 202, code: "MB-B", name: "May B", machineType: "AOI", apiKey: null, isActive: true, stationId: 9, registrationStatus: "pending", syncMode: "realtime", serialNumber: null, firmwareVersion: null };
const PHAM_VI_MAY_REG3 = [101, 42];
const MAY = { id: 42, code: "M-42", name: "May 42", machineType: "AOI", apiKey: null, isActive: true, stationId: null, registrationStatus: "pending", syncMode: "realtime", serialNumber: null, firmwareVersion: null };
const updateMachine = vi.fn(async (..._a: any[]) => undefined);
const getUserById = vi.fn(async (id: number) => (NGUOI_DB[id] ? { ...NGUOI_DB[id] } : undefined));
const getSessionByToken = vi.fn(async (ve: string) => (PHIEN_DB[ve] ? { ...PHIEN_DB[ve] } : undefined));
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getMachineById: vi.fn(async (id: number) => (id === MAY.id ? { ...MAY } : id === MAY_B.id ? { ...MAY_B } : undefined)),
  // review fix — đăng ký chờ (mã tự khai) ánh xạ về máy trong DB: MA-A ở nhà máy A (id 101), MB-B ở nhà máy B (id 202)
  getMachineByCode: vi.fn(async (code: string) => MAY_THEO_MA[code]),
  updateMachine: (...a: any[]) => (updateMachine as any)(...a),
  getLineByStationId: vi.fn(async () => undefined),
  getUnreadNotificationCount: vi.fn(async () => 0),
  createNotification: vi.fn(),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  getUserById: (...a: any[]) => (getUserById as any)(...a),
  getSessionByToken: (...a: any[]) => (getSessionByToken as any)(...a),
  getDb: vi.fn(async () => null),
}));

// ── Đúc khoá: đếm lượt gọi (đây là TÁC DỤNG mà lỗ cho kẻ bị hạ vai). ──
const issueMachineKey = vi.fn(async (o: { machineId: number; createdBy?: number | null }) => ({
  id: 1, machineId: o.machineId, keyPrefix: "mk_abc123", plaintextKey: "mk_" + "ab".repeat(24),
}));
vi.mock("../services/machineAuthService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/machineAuthService")>()),
  issueMachineKey: (...a: any[]) => (issueMachineKey as any)(...a),
}));

// polish — nhánh cờ RBAC mở của duocQuanLyDangKyMay hỏi checkPermission: user 3 CÓ machine_registration, mọi người khác KHÔNG.
vi.mock("./accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accessControl")>()),
  checkPermission: vi.fn(async (uid: number, vai: string, mod: string) => vai === "admin" || (uid === 3 && mod === "machine_registration")), // admin qua như checkPermission thật
}));

vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: vi.fn(async () => undefined),
    setOffline: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    listOnline: vi.fn(async () => ONLINE.map((e) => ({ ...e }))),
    listOnlineCodes: vi.fn(async () => ONLINE.map((e) => e.machineCode)),
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
let xtl: typeof import("./socketXacThucLai");
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const ENV_KHOA = ["SOCKET_MACHINE_AUTH_MODE", "MACHINE_APPROVE_RBAC_OPEN_ENABLED"] as const;
const ENV_GOC: Record<string, string | undefined> = Object.fromEntries(ENV_KHOA.map((k) => [k, process.env[k]]));
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bộ đọc tiêm: đọc hai bảng trong bộ nhớ (đổi SAU handshake = đổi "DB"). */
const BO_DOC = {
  docNguoiDung: async (id: number) => {
    if (NEM_KHI_DOC_NGUOI.has(id)) throw new Error("db nac (gia lap)");
    return NGUOI_DB[id] ? { ...NGUOI_DB[id] } : undefined;
  },
  docPhien: async (ve: string) => {
    if (nemKhiDocPhien) throw new Error("db nac (gia lap)");
    return PHIEN_DB[ve] ? { ...PHIEN_DB[ve] } : undefined;
  },
};

function ketNoi(opts: { may?: boolean; phien?: number; ve?: string }): Promise<ClientSocket> {
  const cookie = opts.phien != null ? `phien=${opts.phien}${opts.ve ? `; app_session_id=${opts.ve}` : ""}` : undefined;
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: opts.may ? { clientType: "machine" } : {},
    extraHeaders: cookie ? { cookie } : {},
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}
function ghiNhan(c: ClientSocket, evt: string): unknown[] {
  const arr: unknown[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}
const tuChoiLog = () =>
  (console.warn as any).mock.calls.map((a: unknown[]) => a.map(String).join(" ")).filter((s: string) => /TU CHOI/.test(s));

/** Một máy vô danh gửi `machine:register` ⇒ một lượt đăng ký chờ duyệt (khoá = socket id của máy). */
async function dangKyMoi(code: string) {
  const may = await ketNoi({ may: true });
  const ack = new Promise((r) => may.once("machine:register_ack", r));
  may.emit("machine:register", { code, name: code, type: "AOI" });
  await ack;
  return { may, duyet: ghiNhan(may, "machine:registration_approved"), tuChoi: ghiNhan(may, "machine:registration_rejected") };
}

/** Kẻ bị chặn gửi approve ⇒ KHÔNG đúc khoá, KHÔNG ghi DB, KHÔNG approve_success / approve_error, máy KHÔNG nhận khoá, có log TỪ CHỐI. */
async function duyetBiChan(ke: ClientSocket, dk: Awaited<ReturnType<typeof dangKyMoi>>, lyDo: string) {
  const ok = ghiNhan(ke, "admin:approve_success");
  const loi = ghiNhan(ke, "admin:approve_error");
  ke.emit("admin:approve_registration", { socketId: dk.may.id, machineId: MAY.id });
  await vi.waitFor(() =>
    expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("admin:approve_registration") && s.includes(lyDo))).toBe(true),
  );
  await cho(100);
  expect(issueMachineKey).not.toHaveBeenCalled();
  expect(updateMachine).not.toHaveBeenCalled();
  expect(ok).toEqual([]);
  expect(loi).toEqual([]);
  expect(dk.duyet).toEqual([]);
}

/** Đối chứng: socket admin CÒN hiệu lực duyệt ĐÚNG lượt đăng ký ấy ⇒ đúc đúng MỘT khoá, người tạo khoá = chủ thể ĐỌC LẠI. */
async function duyetDoiChung(ad: ClientSocket, dk: Awaited<ReturnType<typeof dangKyMoi>>, nguoiTao: number) {
  const ok = new Promise<any>((r) => ad.once("admin:approve_success", r));
  ad.emit("admin:approve_registration", { socketId: dk.may.id, machineId: MAY.id });
  const ket = await ok;
  expect(ket.apiKey).toBeTruthy();
  expect(issueMachineKey).toHaveBeenCalledTimes(1);
  expect(issueMachineKey.mock.calls[0][0]).toMatchObject({ machineId: MAY.id, createdBy: nguoiTao });
  expect(updateMachine).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(dk.duyet.length).toBe(1));
}

beforeAll(async () => {
  for (const k of ENV_KHOA) delete process.env[k]; // mặc định trong mã: enforce (đúc mk_), cờ RBAC mở TẮT (approve = role admin)
  socketMod = await import("./socket");
  // Phạm vi (seam của db/hierarchy): admin ⇒ null (toàn quyền); registrar 3 ⇒ nhà máy A (id 1) / máy 101; mọi người khác ⇒ rỗng.
  (await import("./socketPhongQuyen")).__datCongPhamViChoTest({
    trongPhamVi: async () => true,
    idsTrongPhamVi: async (cap, pv) => (pv.userRole === "admin" ? null : pv.userId === 3 ? (cap === "machine" ? [101] : cap === "factory" ? [1] : []) : []),
  });
  xtl = await import("./socketXacThucLai");
  // F5-nhanh — seam của hàm phạm vi duyệt/từ chối (cùng phạm vi với seam phòng ở trên): registrar 3 ⇒ máy 101 + 42; khác ⇒ rỗng.
  (await import("./phamViDuyetMay")).__datBoTraPhamViDuyetMayChoTest(async (cap, pv) => {
    if (nemKhiTraPhamViDuyet) throw new Error("db nac (gia lap)");
    if (pv.userId === 3) return cap === "machine" ? PHAM_VI_MAY_REG3 : [1];
    return [];
  });
  xtl.__datBoDocChuTheChoTest(BO_DOC);
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
  xtl.__datBoDocChuTheChoTest(null);
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
  datLaiDb();
  xtl.__datBoDocChuTheChoTest(BO_DOC);
});
afterEach(async () => {
  while (clients.length) clients.pop()!.disconnect();
  await cho(30);
  warnSpy.mockClear();
  updateMachine.mockClear();
  issueMachineKey.mockClear();
  getUserById.mockClear();
  getSessionByToken.mockClear();
});

describe("★★★ F5-nhanh S1 — admin bị HẠ vai sau handshake", () => {
  it("(S1a) hạ vai admin → engineer trong DB ⇒ admin:approve_registration BỊ TỪ CHỐI, không đúc khoá; đối chứng: admin còn vai duyệt được đúng lượt ấy", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const dk = await dangKyMoi("S1A");
    NGUOI_DB[1].role = "engineer"; // bản chụp handshake của socket `ke` VẪN là admin
    await duyetBiChan(ke, dk, "khong du quyen duyet dang ky may");
    await duyetDoiChung(ad, dk, 2);
  });

  it("(S1b) hạ vai ⇒ admin:reject_registration BỊ TỪ CHỐI (đăng ký không đổi); đối chứng: admin còn vai từ chối được", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const dk = await dangKyMoi("S1B");
    NGUOI_DB[1].role = "user";
    ke.emit("admin:reject_registration", { socketId: dk.may.id, reason: "ke bi ha vai" });
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("admin:reject_registration"))).toBe(true),
    );
    await cho(100);
    expect(dk.tuChoi).toEqual([]);
    ad.emit("admin:reject_registration", { socketId: dk.may.id, reason: "doi chung" });
    await vi.waitFor(() => expect(dk.tuChoi.length).toBe(1));
    expect((dk.tuChoi[0] as { reason: string }).reason).toBe("doi chung");
  });

  it("(S1c) đối chứng chiều ngược: vai trong DB VẪN admin ⇒ chính socket ấy duyệt được (bộ xác thực lại không chặn oan)", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const dk = await dangKyMoi("S1C");
    await duyetDoiChung(ke, dk, 1);
  });
});

describe("★★★ F5-nhanh S2 — tài khoản bị TẮT / phiên bị THU HỒI / hết hạn sau handshake", () => {
  it("(S2a) isActive=false (vai vẫn admin) ⇒ approve + reject BỊ TỪ CHỐI; đối chứng: admin khác duyệt được", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const dk = await dangKyMoi("S2A");
    NGUOI_DB[1].isActive = false;
    await duyetBiChan(ke, dk, "TAI_KHOAN_BI_TAT");
    ke.emit("admin:reject_registration", { socketId: dk.may.id, reason: "ke bi tat" });
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("admin:reject_registration") && s.includes("TAI_KHOAN_BI_TAT"))).toBe(true),
    );
    await cho(50);
    expect(dk.tuChoi).toEqual([]);
    await duyetDoiChung(ad, dk, 2);
  });

  it("(S2b) phiên của socket bị THU HỒI (isActive=false trong sổ) ⇒ BỊ TỪ CHỐI; đối chứng CÙNG người dùng, phiên KHÁC còn hiệu lực ⇒ duyệt được", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const cungNguoi = await ketNoi({ phien: 1, ve: "ve-1b" });
    const dk = await dangKyMoi("S2B");
    PHIEN_DB["ve-1a"].isActive = false;
    await duyetBiChan(ke, dk, "PHIEN_DA_THU_HOI");
    await duyetDoiChung(cungNguoi, dk, 1);
  });

  it("(S2c) phiên HẾT HẠN / hàng sổ phiên bị XOÁ ⇒ BỊ TỪ CHỐI; đối chứng: admin khác duyệt được", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ke2 = await ketNoi({ phien: 1, ve: "ve-1b" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const dk = await dangKyMoi("S2C");
    PHIEN_DB["ve-1a"].expiresAt = new Date(Date.now() - 1000);
    delete PHIEN_DB["ve-1b"];
    await duyetBiChan(ke, dk, "PHIEN_HET_HAN");
    await duyetBiChan(ke2, dk, "PHIEN_KHONG_CO_TRONG_SO");
    await duyetDoiChung(ad, dk, 2);
  });
});

describe("★★★ F5-nhanh S3 — lỗi tra cứu ⇒ CHẶN (fail-closed)", () => {
  it("(S3a) đọc người dùng NÉM ⇒ approve + reject BỊ TỪ CHỐI (LOI_TRA_CUU); đối chứng: admin khác (đọc được) duyệt được", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const dk = await dangKyMoi("S3A");
    NEM_KHI_DOC_NGUOI.add(1);
    await duyetBiChan(ke, dk, "LOI_TRA_CUU");
    ke.emit("admin:reject_registration", { socketId: dk.may.id, reason: "ke loi tra cuu" });
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("admin:reject_registration") && s.includes("LOI_TRA_CUU"))).toBe(true),
    );
    await cho(50);
    expect(dk.tuChoi).toEqual([]);
    await duyetDoiChung(ad, dk, 2);
  });

  it("(S3b) đọc sổ phiên NÉM ⇒ BỊ TỪ CHỐI; khi DB hồi lại ⇒ chính socket ấy duyệt được (đối chứng)", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const dk = await dangKyMoi("S3B");
    nemKhiDocPhien = true;
    await duyetBiChan(ke, dk, "LOI_TRA_CUU");
    nemKhiDocPhien = false;
    await duyetDoiChung(ke, dk, 1);
  });
});

describe("★★ F5-nhanh — hàm xacThucLaiChoThaoTacSocket (gọi thẳng)", () => {
  const sk = (data: unknown, cookie?: string) => ({ data, handshake: { headers: cookie ? { cookie } : {} } });
  const adminChup = { clientType: "browser", user: { id: 1, role: "admin" } };

  it("(U1) vai trả về là vai TRONG DB, không phải vai chụp", async () => {
    NGUOI_DB[1].role = "viewer";
    const kq = await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"));
    expect(kq).toEqual({ ok: true, data: { clientType: "browser", user: { id: 1, role: "viewer", name: "admin-se-bi-ha" } } });
  });

  it("(U2) socket máy / không danh tính ⇒ KHONG_PHAI_SOCKET_NGUOI_DUNG, không tra DB", async () => {
    const doc = vi.spyOn(BO_DOC, "docNguoiDung");
    try {
      expect(await xtl.xacThucLaiChoThaoTacSocket(sk({ clientType: "machine" }, "app_session_id=ve-1a"))).toEqual({ ok: false, lyDo: "KHONG_PHAI_SOCKET_NGUOI_DUNG" });
      expect(await xtl.xacThucLaiChoThaoTacSocket(sk({ clientType: "browser", user: { role: "admin" } }, "app_session_id=ve-1a"))).toEqual({ ok: false, lyDo: "KHONG_PHAI_SOCKET_NGUOI_DUNG" });
      expect(await xtl.xacThucLaiChoThaoTacSocket(sk(null))).toEqual({ ok: false, lyDo: "KHONG_PHAI_SOCKET_NGUOI_DUNG" });
      expect(doc).not.toHaveBeenCalled();
    } finally {
      doc.mockRestore();
    }
  });

  it("(U3) không có vé phiên trong cookie ⇒ KHONG_CO_VE_PHIEN", async () => {
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup))).toEqual({ ok: false, lyDo: "KHONG_CO_VE_PHIEN" });
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "phien=1"))).toEqual({ ok: false, lyDo: "KHONG_CO_VE_PHIEN" });
  });

  it("(U4) vé là phiên của NGƯỜI KHÁC ⇒ PHIEN_CUA_NGUOI_KHAC; người dùng không còn ⇒ KHONG_CO_NGUOI_DUNG", async () => {
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-2"))).toEqual({ ok: false, lyDo: "PHIEN_CUA_NGUOI_KHAC" });
    delete NGUOI_DB[1];
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"))).toEqual({ ok: false, lyDo: "KHONG_CO_NGUOI_DUNG" });
  });

  it("(U5) expiresAt không đọc được (Invalid Date) ⇒ PHIEN_HET_HAN (không rơi về cho qua)", async () => {
    PHIEN_DB["ve-1a"].expiresAt = "khong-phai-ngay" as unknown as Date;
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"))).toEqual({ ok: false, lyDo: "PHIEN_HET_HAN" });
  });

  it("(U6) bộ đọc trả Promise bị từ chối ở BẤT KỲ bên nào ⇒ LOI_TRA_CUU (không bao giờ ném ra handler)", async () => {
    NEM_KHI_DOC_NGUOI.add(1);
    await expect(xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"))).resolves.toEqual({ ok: false, lyDo: "LOI_TRA_CUU" });
  });

  it("(U7) bộ đọc MẶC ĐỊNH (seam null) đọc db.getUserById + db.getSessionByToken bằng ĐÚNG id chụp và vé cookie; DB vắng (undefined) ⇒ chặn", async () => {
    xtl.__datBoDocChuTheChoTest(null);
    NGUOI_DB[1].role = "engineer";
    const kq = await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"));
    expect(kq).toMatchObject({ ok: true, data: { user: { id: 1, role: "engineer" } } });
    expect(getUserById).toHaveBeenCalledWith(1);
    expect(getSessionByToken).toHaveBeenCalledWith("ve-1a");
    getUserById.mockImplementationOnce(async () => undefined); // getUserById trả undefined khi getDb() null
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adminChup, "app_session_id=ve-1a"))).toEqual({ ok: false, lyDo: "KHONG_CO_NGUOI_DUNG" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F5-nhanh polish — admin:join / admin:get_online_machines cũng xác thực lại; cổng buộc-đổi-mật-khẩu trong bộ xác thực lại
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function phongServer(c: ClientSocket): string[] {
  const sk = socketMod.getIO()!.sockets.sockets.get(c.id!);
  if (!sk) throw new Error(`không thấy socket server ${c.id}`);
  return [...sk.rooms].filter((r) => r !== c.id).sort();
}

describe("★★★ F5-nhanh polish P1 — admin:join với vai đọc lại", () => {
  it("(P1a) admin bị HẠ vai sau handshake ⇒ admin:join BỊ TỪ CHỐI: không vào phòng admin, không nhận danh sách chờ, không nhận yêu cầu đăng ký mới; đối chứng: admin còn vai vào được và nhận đúng danh sách ấy", async () => {
    const dk = await dangKyMoi("P1A");
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    NGUOI_DB[1].role = "engineer"; // bản chụp vẫn admin
    const choKe = ghiNhan(ke, "admin:pending_registrations");
    const yeuCauKe = ghiNhan(ke, "machine:registration_request");
    ke.emit("admin:join");
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("join admin"))).toBe(true),
    );
    // đối chứng: admin còn vai
    const choAd = new Promise<any[]>((r) => ad.once("admin:pending_registrations", r));
    ad.emit("admin:join");
    const ds = await choAd;
    expect(ds.some((x) => x.requestSocketId === dk.may.id)).toBe(true);
    expect(phongServer(ad)).toContain("admin");
    // một yêu cầu đăng ký MỚI phát vào phòng admin: ad nhận, ke không
    const yeuCauAd = new Promise((r) => ad.once("machine:registration_request", r));
    await dangKyMoi("P1A-2");
    await yeuCauAd;
    await cho(50);
    expect(phongServer(ke)).not.toContain("admin");
    expect(choKe).toEqual([]);
    expect(yeuCauKe).toEqual([]);
  });

  it("(P1b) phiên của socket bị THU HỒI ⇒ admin:join BỊ TỪ CHỐI (PHIEN_DA_THU_HOI); đối chứng: cùng người, phiên khác vào được", async () => {
    await dangKyMoi("P1B");
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const cungNguoi = await ketNoi({ phien: 1, ve: "ve-1b" });
    PHIEN_DB["ve-1a"].isActive = false;
    const choKe = ghiNhan(ke, "admin:pending_registrations");
    ke.emit("admin:join");
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("join admin") && s.includes("PHIEN_DA_THU_HOI"))).toBe(true),
    );
    const cho2 = new Promise((r) => cungNguoi.once("admin:pending_registrations", r));
    cungNguoi.emit("admin:join");
    await cho2;
    expect(phongServer(cungNguoi)).toContain("admin");
    expect(phongServer(ke)).not.toContain("admin");
    expect(choKe).toEqual([]);
  });
});

describe("★★ F5-nhanh polish P2 — admin:get_online_machines với vai đọc lại", () => {
  it("(P2) admin bị HẠ vai ⇒ không nhận machine:online_list (danh sách máy online MỌI nhà máy); đối chứng: admin còn vai nhận", async () => {
    const ke = await ketNoi({ phien: 1, ve: "ve-1a" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    NGUOI_DB[1].role = "viewer";
    const dsKe = ghiNhan(ke, "machine:online_list");
    ke.emit("admin:get_online_machines");
    await vi.waitFor(() =>
      expect(tuChoiLog().some((s: string) => s.includes(ke.id!) && s.includes("admin:get_online_machines"))).toBe(true),
    );
    const dsAd = new Promise((r) => ad.once("machine:online_list", r));
    ad.emit("admin:get_online_machines");
    await dsAd;
    await cho(50);
    expect(dsKe).toEqual([]);
  });
});

describe("★★★ F5-nhanh polish P3 — cổng BUỘC ĐỔI MẬT KHẨU trong bộ xác thực lại", () => {
  it("(P3) cờ RBAC mở: non-admin có quyền machine_registration nhưng bị BUỘC ĐỔI MẬT KHẨU sau handshake ⇒ approve BỊ TỪ CHỐI (PHAI_DOI_MAT_KHAU), không đúc khoá; đổi xong mật khẩu ⇒ CHÍNH socket ấy duyệt được (đối chứng)", async () => {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      const ke = await ketNoi({ phien: 3, ve: "ve-3" });
      const dk = await dangKyMoi("MA-A"); // F5-nhanh (a) review: đăng ký của registrar phải thuộc phạm vi (MA-A ⇒ máy 101 của A)
      NGUOI_DB[3].passwordInvalidBefore = new Date(Date.now() - 60_000); // quản trị thu hồi mật khẩu
      NGUOI_DB[3].passwordChangedAt = null;
      await duyetBiChan(ke, dk, "PHAI_DOI_MAT_KHAU");
      NGUOI_DB[3].passwordChangedAt = new Date(); // người dùng đã đổi SAU mốc thu hồi
      await duyetDoiChung(ke, dk, 3);
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  });

  const sk = (data: unknown, cookie?: string) => ({ data, handshake: { headers: cookie ? { cookie } : {} } });
  it("(U8) gọi thẳng: engineer bị buộc ⇒ PHAI_DOI_MAT_KHAU; admin cùng mốc ⇒ qua (vai miễn trừ — CÙNG luật handshake); mốc không đọc được ⇒ chặn", async () => {
    const eng = { clientType: "browser", user: { id: 3, role: "engineer" } };
    NGUOI_DB[3].passwordInvalidBefore = new Date(Date.now() - 60_000);
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(eng, "app_session_id=ve-3"))).toEqual({ ok: false, lyDo: "PHAI_DOI_MAT_KHAU" });
    NGUOI_DB[1].passwordInvalidBefore = new Date(Date.now() - 60_000);
    NGUOI_DB[1].passwordChangedAt = null;
    const adm = { clientType: "browser", user: { id: 1, role: "admin" } };
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(adm, "app_session_id=ve-1a"))).toMatchObject({ ok: true });
    NGUOI_DB[3].passwordInvalidBefore = "khong-phai-ngay";
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(eng, "app_session_id=ve-3"))).toEqual({ ok: false, lyDo: "PHAI_DOI_MAT_KHAU" });
    NGUOI_DB[3].passwordInvalidBefore = null; // chưa từng thu hồi ⇒ qua
    expect(await xtl.xacThucLaiChoThaoTacSocket(sk(eng, "app_session_id=ve-3"))).toMatchObject({ ok: true, data: { user: { role: "engineer" } } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F5-nhanh review fixes — lọc phạm vi nhà máy khi cờ RBAC mở; tiền lọc trong bộ nhớ (0 câu DB cho người không đủ quyền)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ F5-nhanh review R2 — cờ RBAC mở: người quản trị đăng ký KHÔNG phải admin chỉ thấy nhà máy của mình", () => {
  it("(R2a) registrar nhà máy A: admin:join chỉ nhận đăng ký chờ + máy đang nối của A; admin:get_online_machines chỉ mã máy của A; đối chứng: admin thấy cả A và B", async () => {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      const dkA = await dangKyMoi("MA-A");
      const dkB = await dangKyMoi("MB-B");
      const dkLa = await dangKyMoi("KHONG-CO-TRONG-DB"); // mã không khớp máy nào ⇒ không thuộc phạm vi nào
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });

      const choReg = new Promise<any[]>((r) => reg.once("admin:pending_registrations", r));
      const noiReg = new Promise<any[]>((r) => reg.once("admin:connected_machines", r));
      reg.emit("admin:join");
      const [dsReg, ketNoiReg] = await Promise.all([choReg, noiReg]);
      const idsReg = dsReg.map((x) => x.requestSocketId);
      expect(idsReg).toContain(dkA.may.id);
      expect(idsReg).not.toContain(dkB.may.id);
      expect(idsReg).not.toContain(dkLa.may.id);
      expect(ketNoiReg.map((m) => m.machineId)).toEqual([101]);
      const onlReg = new Promise<any>((r) => reg.once("machine:online_list", r));
      reg.emit("admin:get_online_machines");
      expect((await onlReg).machines).toEqual(["MA-A"]);

      // đối chứng: admin (phạm vi null) thấy TẤT CẢ
      const choAd = new Promise<any[]>((r) => ad.once("admin:pending_registrations", r));
      const noiAd = new Promise<any[]>((r) => ad.once("admin:connected_machines", r));
      ad.emit("admin:join");
      const [dsAd, ketNoiAd] = await Promise.all([choAd, noiAd]);
      expect(dsAd.map((x) => x.requestSocketId)).toEqual(expect.arrayContaining([dkA.may.id, dkB.may.id, dkLa.may.id]));
      expect(ketNoiAd.map((m) => m.machineId).sort()).toEqual([101, 202]);
      const onlAd = new Promise<any>((r) => ad.once("machine:online_list", r));
      ad.emit("admin:get_online_machines");
      expect([...(await onlAd).machines].sort()).toEqual(["MA-A", "MB-B"]);
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  });

  it("(R2b) tính phạm vi NÉM ⇒ registrar nhận danh sách RỖNG (fail-closed), không phải tất cả", async () => {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    const pq = await import("./socketPhongQuyen");
    try {
      await dangKyMoi("MA-A");
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      pq.__datCongPhamViChoTest({ trongPhamVi: async () => true, idsTrongPhamVi: async (_c, pv) => { if (pv.userRole === "admin") return null; throw new Error("db nac"); } });
      const onl = new Promise<any>((r) => reg.once("machine:online_list", r));
      reg.emit("admin:get_online_machines");
      expect((await onl).machines).toEqual([]);
      const cho = new Promise<any[]>((r) => reg.once("admin:pending_registrations", r));
      reg.emit("admin:join");
      expect(await cho).toEqual([]);
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
      pq.__datCongPhamViChoTest({
        trongPhamVi: async () => true,
        idsTrongPhamVi: async (cap, pv) => (pv.userRole === "admin" ? null : pv.userId === 3 ? (cap === "machine" ? [101] : cap === "factory" ? [1] : []) : []),
      });
    }
  });
});

describe("★★ F5-nhanh review R3 — tiền lọc trong bộ nhớ: bản chụp không đủ quyền ⇒ từ chối với 0 câu DB", () => {
  it("(R3) operator (Dashboard gửi admin:get_online_machines mỗi lần nối) ⇒ từ chối, KHÔNG đọc người dùng / sổ phiên; đối chứng: admin đọc đúng 1+1", async () => {
    const op = await ketNoi({ phien: 4, ve: "ve-4" });
    const ad = await ketNoi({ phien: 2, ve: "ve-2" });
    const docNguoi = vi.spyOn(BO_DOC, "docNguoiDung");
    const docPhien = vi.spyOn(BO_DOC, "docPhien");
    try {
      const dsOp = ghiNhan(op, "machine:online_list");
      op.emit("admin:get_online_machines");
      op.emit("admin:join");
      op.emit("admin:approve_registration", { socketId: "x", machineId: MAY.id });
      op.emit("admin:reject_registration", { socketId: "x", reason: "r" });
      await vi.waitFor(() =>
        expect(tuChoiLog().filter((s: string) => s.includes(op.id!) && s.includes("BAN_CHUP_KHONG_DU_QUYEN")).length).toBe(4),
      );
      expect(docNguoi).not.toHaveBeenCalled();
      expect(docPhien).not.toHaveBeenCalled();
      expect(dsOp).toEqual([]);
      const onl = new Promise((r) => ad.once("machine:online_list", r));
      ad.emit("admin:get_online_machines");
      await onl;
      expect(docNguoi).toHaveBeenCalledTimes(1);
      expect(docPhien).toHaveBeenCalledTimes(1);
    } finally {
      docNguoi.mockRestore();
      docPhien.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F5-nhanh — duyệt / từ chối kiểm PHẠM VI MÁY (kiemPhamViDuyetMay, cùng hàm với tRPC)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ F5-nhanh D — socket approve/reject kiểm phạm vi máy (cờ RBAC mở)", () => {
  async function voiCoMo<T>(f: () => Promise<T>): Promise<T> {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      return await f();
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  }

  it("(D1) registrar nhà máy A duyệt máy 202 của nhà máy B ⇒ CÙNG lời 'not found' như máy không có thật, không đọc máy, không đúc khoá, không ghi, đăng ký trả về sổ chờ; đối chứng: duyệt máy 42 của A ⇒ được", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const dk = await dangKyMoi("MA-A"); // đăng ký trong phạm vi A (máy 101) — ca này đo MÁY ĐÍCH ngoài phạm vi
      const loi = new Promise<any>((r) => reg.once("admin:approve_error", r));
      reg.emit("admin:approve_registration", { socketId: dk.may.id, machineId: MAY_B.id });
      const l1 = await loi;
      // máy KHÔNG có thật cho cùng lời (khuôn chung) — ngoài phạm vi ≡ không tồn tại
      const loi2 = new Promise<any>((r) => reg.once("admin:approve_error", r));
      reg.emit("admin:approve_registration", { socketId: dk.may.id, machineId: 987654 });
      const l2 = await loi2;
      expect(l1.message.replace(String(MAY_B.id), "N")).toBe(l2.message.replace("987654", "N"));
      const getMachineById = (await import("../db")).getMachineById as unknown as ReturnType<typeof vi.fn>;
      expect(getMachineById.mock.calls.some((c) => c[0] === MAY_B.id)).toBe(false);
      expect(issueMachineKey).not.toHaveBeenCalled();
      expect(updateMachine).not.toHaveBeenCalled();
      expect(dk.duyet).toEqual([]);
      await duyetDoiChung(reg, dk, 3); // đăng ký còn nguyên ⇒ duyệt máy 42 (trong phạm vi) được
    });
  });

  it("(D2) tra phạm vi LỖI ⇒ từ chối như không có máy, không đúc khoá; DB hồi ⇒ duyệt được", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const dk = await dangKyMoi("MA-A");
      nemKhiTraPhamViDuyet = true;
      const loi = new Promise<any>((r) => reg.once("admin:approve_error", r));
      reg.emit("admin:approve_registration", { socketId: dk.may.id, machineId: MAY.id });
      expect((await loi).message).toContain("not found");
      expect(issueMachineKey).not.toHaveBeenCalled();
      expect(updateMachine).not.toHaveBeenCalled();
      nemKhiTraPhamViDuyet = false;
      await duyetDoiChung(reg, dk, 3);
    });
  });

  it("(D3) registrar KHÔNG từ chối được đăng ký (cổng reject = admin) — đăng ký còn nguyên; admin (miễn phạm vi) từ chối được", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });
      const dk = await dangKyMoi("MB-B");
      reg.emit("admin:reject_registration", { socketId: dk.may.id, reason: "reg thu" });
      await vi.waitFor(() => expect(tuChoiLog().some((s: string) => s.includes(reg.id!) && s.includes("admin:reject_registration"))).toBe(true));
      await cho(50);
      expect(dk.tuChoi).toEqual([]);
      ad.emit("admin:reject_registration", { socketId: dk.may.id, reason: "admin" });
      await vi.waitFor(() => expect(dk.tuChoi.length).toBe(1));
    });
  });
});

describe("★★ F5-nhanh — kiemPhamViDuyetMay gọi thẳng (đường reject: đích suy từ mã tự khai)", () => {
  it("(K1) admin ⇒ miễn, KHÔNG gọi hàm suy đích; non-admin: đích A ⇒ qua, đích B ⇒ NGOAI_PHAM_VI, không suy được ⇒ KHONG_CO_MAY, không danh tính ⇒ chặn, lỗi ⇒ LOI_PHAM_VI", async () => {
    const pv = await import("./phamViDuyetMay");
    const suy = vi.fn(async () => MAY_B.id);
    expect(await pv.kiemPhamViDuyetMay({ userId: 2, userRole: "admin" }, suy)).toEqual({ ok: true });
    expect(suy).not.toHaveBeenCalled();
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, async () => 101)).toEqual({ ok: true });
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, suy)).toMatchObject({ ok: false, lyDo: "NGOAI_PHAM_VI" });
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, async () => undefined)).toMatchObject({ ok: false, lyDo: "KHONG_CO_MAY" });
    expect(await pv.kiemPhamViDuyetMay({ userRole: "engineer" }, 101)).toMatchObject({ ok: false, lyDo: "THIEU_DANH_TINH" });
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, 101, { stationId: 999 })).toMatchObject({ ok: false, cap: "station" });
    nemKhiTraPhamViDuyet = true;
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, 101)).toMatchObject({ ok: false, lyDo: "LOI_PHAM_VI" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F5-nhanh (a) review — đăng ký bị TIÊU THỤ phải trong phạm vi; phạm vi kiểm TRƯỚC khi rút sổ chờ; phát registration_request theo người nhận
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ F5-nhanh (a) review — đường gắn thiết bị nhà máy B vào máy của A", () => {
  async function voiCoMo<T>(f: () => Promise<T>): Promise<T> {
    process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED = "true";
    try {
      return await f();
    } finally {
      delete process.env.MACHINE_APPROVE_RBAC_OPEN_ENABLED;
    }
  }
  /** Danh sách chờ admin thấy (requestSocketId) — để biết đăng ký còn trong sổ hay đã bị rút. */
  async function soChoAdminThay(ad: ClientSocket): Promise<string[]> {
    const p = new Promise<any[]>((r) => ad.once("admin:pending_registrations", r));
    ad.emit("admin:join");
    return (await p).map((x) => x.requestSocketId);
  }

  it("(I1) registrar A duyệt ĐĂNG KÝ của thiết bị nhà máy B (mã MB-B) vào máy 42 CỦA A ⇒ CÙNG lời như đăng ký không tồn tại; không đúc khoá, không ghi; đăng ký B KHÔNG bị rút; đối chứng: đăng ký A (MA-A) vào máy 42 ⇒ được", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });
      const dkB = await dangKyMoi("MB-B");
      const loi = new Promise<any>((r) => reg.once("admin:approve_error", r));
      reg.emit("admin:approve_registration", { socketId: dkB.may.id, machineId: MAY.id });
      const l1 = await loi;
      const loi2 = new Promise<any>((r) => reg.once("admin:approve_error", r));
      reg.emit("admin:approve_registration", { socketId: "khong-ton-tai", machineId: MAY.id });
      expect(l1).toEqual(await loi2); // ngoài phạm vi ≡ không tồn tại
      expect(issueMachineKey).not.toHaveBeenCalled();
      expect(updateMachine).not.toHaveBeenCalled();
      expect(dkB.duyet).toEqual([]);
      expect(await soChoAdminThay(ad)).toContain(dkB.may.id); // KHÔNG bị tiêu thụ
      const dkA = await dangKyMoi("MA-A");
      await duyetDoiChung(reg, dkA, 3);
    });
  });

  it("(I2) Minor 1 — spam duyệt NGOÀI phạm vi (đăng ký B, hoặc máy đích B) KHÔNG BAO GIỜ rút đăng ký khỏi sổ chờ; admin vẫn duyệt được nó", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });
      const dkB = await dangKyMoi("MB-B");
      const dkA = await dangKyMoi("MA-A");
      // ⚠ TUẦN TỰ (chờ từng lời từ chối): gửi 10 gói SONG SONG làm vitest phục vụ module accessControl THẬT (không phải bản mock) cho các
      // import() động đồng thời đầu tiên — đo được 9/10 lượt "REAL". Đó là trò của thiết bị đo, không phải hành vi sản phẩm (sản phẩm luôn dùng bản thật).
      const loi: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        for (const goi of [{ socketId: dkB.may.id, machineId: MAY.id } /* đăng ký ngoài phạm vi */, { socketId: dkA.may.id, machineId: MAY_B.id } /* máy đích ngoài phạm vi */]) {
          const p = new Promise((r) => reg.once("admin:approve_error", r));
          reg.emit("admin:approve_registration", goi);
          loi.push(await p);
        }
      }
      expect(loi).toHaveLength(10);
      const so = await soChoAdminThay(ad);
      expect(so).toEqual(expect.arrayContaining([dkB.may.id, dkA.may.id]));
      expect(issueMachineKey).not.toHaveBeenCalled();
      await duyetDoiChung(ad, dkB, 2); // admin (miễn phạm vi) duyệt đúng đăng ký mà spam không rút được
    });
  });

  it("(A1) phát machine:registration_request theo NGƯỜI NHẬN: registrar A KHÔNG nhận yêu cầu của thiết bị B, nhận của A; admin nhận cả hai", async () => {
    await voiCoMo(async () => {
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });
      await soChoAdminThay(reg);
      await soChoAdminThay(ad);
      const yeuCauReg = ghiNhan(reg, "machine:registration_request");
      const yeuCauAd = ghiNhan(ad, "machine:registration_request");
      const dkB = await dangKyMoi("MB-B");
      const dkA = await dangKyMoi("MA-A");
      await vi.waitFor(() => expect(yeuCauAd.length).toBe(2));
      await vi.waitFor(() => expect(yeuCauReg.length).toBe(1));
      await cho(50);
      expect((yeuCauAd as any[]).map((x) => x.requestSocketId).sort()).toEqual([dkA.may.id, dkB.may.id].sort());
      expect((yeuCauReg as any[]).map((x) => x.requestSocketId)).toEqual([dkA.may.id]);
    });
  });

  it("(A2) phạm vi người nhận KHÔNG tính được ⇒ registrar không nhận gì (fail-closed); admin vẫn nhận", async () => {
    await voiCoMo(async () => {
      const pq = await import("./socketPhongQuyen");
      const reg = await ketNoi({ phien: 3, ve: "ve-3" });
      const ad = await ketNoi({ phien: 2, ve: "ve-2" });
      await soChoAdminThay(reg);
      await soChoAdminThay(ad);
      const yeuCauReg = ghiNhan(reg, "machine:registration_request");
      const yeuCauAd = ghiNhan(ad, "machine:registration_request");
      pq.__datCongPhamViChoTest({ trongPhamVi: async () => true, idsTrongPhamVi: async (_c, pv) => { if (pv.userRole === "admin") return null; throw new Error("db nac"); } });
      try {
        await dangKyMoi("MA-A");
        await vi.waitFor(() => expect(yeuCauAd.length).toBe(1));
        await cho(80);
        expect(yeuCauReg).toEqual([]);
      } finally {
        pq.__datCongPhamViChoTest({
          trongPhamVi: async () => true,
          idsTrongPhamVi: async (cap, pv) => (pv.userRole === "admin" ? null : pv.userId === 3 ? (cap === "machine" ? [101] : cap === "factory" ? [1] : []) : []),
        });
      }
    });
  });

  it("(K2) kiemPhamViDuyetMay với tuỳ chọn dangKy: mã B ⇒ cap 'dangKy'; mã A ⇒ qua; mã lạ ⇒ chặn; admin ⇒ miễn, KHÔNG tra mã", async () => {
    const pv = await import("./phamViDuyetMay");
    const getMachineByCode = (await import("../db")).getMachineByCode as unknown as ReturnType<typeof vi.fn>;
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, 42, { dangKy: { ma: "MB-B" } })).toMatchObject({ ok: false, cap: "dangKy" });
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, 42, { dangKy: { ma: "MA-A" } })).toEqual({ ok: true });
    expect(await pv.kiemPhamViDuyetMay({ userId: 3, userRole: "engineer" }, 42, { dangKy: { ma: "LA-HOAC" } })).toMatchObject({ ok: false, cap: "dangKy" });
    getMachineByCode.mockClear();
    expect(await pv.kiemPhamViDuyetMay({ userId: 2, userRole: "admin" }, 42, { dangKy: { ma: "MB-B" } })).toEqual({ ok: true });
    expect(getMachineByCode).not.toHaveBeenCalled();
  });
});
