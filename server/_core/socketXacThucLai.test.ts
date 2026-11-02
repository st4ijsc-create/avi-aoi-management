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
type HangNguoi = { id: number; role: string; isActive: boolean | null; name: string };
type HangPhien = { userId: number; isActive: boolean | null; expiresAt: Date | null };
let NGUOI_DB: Record<number, HangNguoi> = {};
let PHIEN_DB: Record<string, HangPhien> = {};
const NEM_KHI_DOC_NGUOI = new Set<number>();
let nemKhiDocPhien = false;
function datLaiDb() {
  NGUOI_DB = {
    1: { id: 1, role: "admin", isActive: true, name: "admin-se-bi-ha" },
    2: { id: 2, role: "admin", isActive: true, name: "admin-doi-chung" },
  };
  PHIEN_DB = {
    "ve-1a": { userId: 1, isActive: true, expiresAt: null },
    "ve-1b": { userId: 1, isActive: true, expiresAt: null },
    "ve-2": { userId: 2, isActive: true, expiresAt: null },
  };
  NEM_KHI_DOC_NGUOI.clear();
  nemKhiDocPhien = false;
}
datLaiDb();

const MAY = { id: 42, code: "M-42", name: "May 42", machineType: "AOI", apiKey: null, isActive: true, stationId: null, registrationStatus: "pending", syncMode: "realtime", serialNumber: null, firmwareVersion: null };
const updateMachine = vi.fn(async (..._a: any[]) => undefined);
const getUserById = vi.fn(async (id: number) => (NGUOI_DB[id] ? { ...NGUOI_DB[id] } : undefined));
const getSessionByToken = vi.fn(async (ve: string) => (PHIEN_DB[ve] ? { ...PHIEN_DB[ve] } : undefined));
vi.mock("../db", () => ({
  updateMachineHeartbeat: vi.fn(async () => undefined),
  createMachineStatusLog: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getMachineById: vi.fn(async (id: number) => (id === MAY.id ? { ...MAY } : undefined)),
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
  (await import("./socketPhongQuyen")).__datCongPhamViChoTest({ trongPhamVi: async () => true, idsTrongPhamVi: async () => null });
  xtl = await import("./socketXacThucLai");
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
