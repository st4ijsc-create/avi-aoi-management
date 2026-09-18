/**
 * socketNhipTimGhiDb.test.ts — ★★★ NHỊP TIM QUA SOCKET PHẢI BỀN HOÁ XUỐNG `machines.lastHeartbeat`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LỖI ĐƯỢC GHIM (xác minh hai lượt, hai người, trước khi có tệp này)
 * ══════════════════════════════════════════════════════════════════════════════
 * `socket.on("machine:heartbeat")` cập nhật ĐÚNG HAI chỗ: `connectedMachines` (Map TRONG RAM,
 * chết theo tiến trình) và `machinePresenceStore` (TTL, Redis/bộ nhớ). Nó KHÔNG BAO GIỜ chạm
 * cột `machines.lastHeartbeat`. Nhưng CẢ HAI nơi quyết định "máy còn sống hay `khong_ro`" đều
 * đọc đúng cột DB ấy:
 *   · `server/services/trangThaiMayTuoi.ts` — `NGUONG_TRANG_THAI_TUOI_MS` = 5 phút;
 *   · `client/src/components/twin3d/mauTrangThai.ts` — `NGUONG_CU_MS`, cùng 5 phút.
 * ⇒ một máy THẬT nối bằng socket.io và đập nhịp đều đặn vẫn hoá khối xám gạch chéo sau 5 phút.
 * Đường REST/tRPC không dính lỗi này: 23 chỗ trong `machineApiRouters`/`aoiPackageRouter`/
 * `aiEdgeEnhanced` đã gọi `db.updateMachineHeartbeat(...)` sau `authenticateMachine`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★ VÌ SAO ĐO BẰNG HÀNH VI, KHÔNG BẰNG CHUỖI NGUỒN
 * ══════════════════════════════════════════════════════════════════════════════
 * Một ghim `SRC.toContain("updateMachineHeartbeat")` xanh y hệt khi lời gọi nằm trong nhánh
 * CHẾT, khi nó bị hàng rào danh tính chặn, hoặc khi tiết lưu nuốt MỌI lượt ghi. Tệp này chạy
 * `initializeSocket` THẬT với một `socket.io` giả (G20: import mã sản phẩm, không chép lại
 * biểu thức), đăng ký máy bằng chính sự kiện `machine:confirm_mapping` thật, rồi đếm lời gọi
 * `db.updateMachineHeartbeat` trên đồng hồ giả.
 *
 * Cửa sổ tiết lưu KHÔNG được gõ tay vào tệp này: nó đọc `NGUONG_TIET_LUU_NHIP_TIM_SOCKET_MS`
 * ngay từ module sản phẩm (đổi hằng ⇒ lưới đi theo), và đối chiếu con số ấy với
 * `NGUONG_TRANG_THAI_TUOI_MS` thật — không phải một bản sao 300000 viết trong test.
 *
 * ĐỘT BIẾN bắt được (đã chạy): gỡ lời gọi `ghiNhipTimXuongDb(...)` khỏi handler ⇒ ca (1)(2)(3)
 * (4)(7)(8)(12) đỏ; gỡ `.catch(...)` ⇒ ca (7) đỏ; gỡ kiểm tra cửa sổ ⇒ ca (2) đỏ.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NGUONG_TRANG_THAI_TUOI_MS } from "../services/trangThaiMayTuoi";

// ── socket.io giả: giữ ĐÚNG ngữ nghĩa "nhiều listener trên cùng một sự kiện" của socket.io
//    (socket.ts đăng ký `machine:heartbeat` HAI lần: handler chính + hook state-store), và
//    ghi lại mọi `io.to(room).emit(...)` để đo phát sóng.
type Handler = (...args: any[]) => unknown;
class FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake = { auth: { clientType: "machine" }, headers: {} as Record<string, string>, address: "10.0.0.9" };
  handlers = new Map<string, Handler[]>();
  emit = vi.fn();
  constructor(id: string, private server: FakeServer) {
    this.id = id;
    this.data = { clientType: "machine" };
    server.sockets.sockets.set(id, this);
  }
  on(evt: string, fn: Handler) {
    const arr = this.handlers.get(evt) ?? [];
    arr.push(fn);
    this.handlers.set(evt, arr);
  }
  join(room: string) {
    const rooms = this.server.sockets.adapter.rooms;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room)!.add(this.id);
  }
  leave(room: string) {
    this.server.sockets.adapter.rooms.get(room)?.delete(this.id);
  }
  to() {
    return { emit: vi.fn() };
  }
  /** Gửi một sự kiện như client thật gửi — GỌI MỌI listener, đúng thứ tự đăng ký. */
  gui(evt: string, ...args: unknown[]) {
    const arr = this.handlers.get(evt);
    if (!arr?.length) throw new Error(`socket giả không có handler "${evt}"`);
    for (const h of arr) h(...args);
  }
}
class FakeServer {
  static hienTai: FakeServer | null = null;
  handlers = new Map<string, Handler>();
  sockets = { adapter: { rooms: new Map<string, Set<string>>() }, sockets: new Map<string, FakeSocket>() };
  /** Mọi `io.to(<phòng>).emit(<sự kiện>, <gói>)` — để đo phát sóng thật, không phải vi.fn rời. */
  phatTheoPhong: Array<{ room: string; evt: string; goi: unknown }> = [];
  use = vi.fn();
  emit = vi.fn();
  to(room: string) {
    return { emit: (evt: string, goi: unknown) => this.phatTheoPhong.push({ room, evt, goi }) };
  }
  in() {
    return { emit: vi.fn() };
  }
  on(evt: string, fn: Handler) {
    this.handlers.set(evt, fn);
  }
  constructor() {
    FakeServer.hienTai = this;
  }
  ketNoi(id: string): FakeSocket {
    const sk = new FakeSocket(id, this);
    const conn = this.handlers.get("connection");
    if (!conn) throw new Error("initializeSocket chưa đăng ký handler connection");
    conn(sk);
    return sk;
  }
}
vi.mock("socket.io", () => ({ Server: FakeServer }));

// ── Cạnh DB: CHỈ hai hàm mà đường nhịp tim chạm tới, đếm được. ──
const updateMachineHeartbeat = vi.fn(async (_id: number) => undefined as unknown);
const createMachineStatusLog = vi.fn(async (_x: unknown) => undefined);
vi.mock("../db", () => ({
  updateMachineHeartbeat: (...a: any[]) => (updateMachineHeartbeat as any)(...a),
  createMachineStatusLog: (...a: any[]) => (createMachineStatusLog as any)(...a),
  getMachineById: vi.fn(async () => undefined),
  getDb: vi.fn(async () => null),
}));

// ── Mọi cạnh khác của socket.ts: rỗng (tệp này đo ĐÚNG MỘT thứ). ──
const presenceRefresh = vi.fn(async (_x: unknown) => undefined);
vi.mock("./sdk", () => ({ sdk: { authenticateRequest: vi.fn(async () => null) } }));
vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: vi.fn(async () => undefined),
    setOffline: vi.fn(async () => undefined),
    refresh: (...a: any[]) => (presenceRefresh as any)(...a),
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
vi.mock("./socketMachineAuth", () => ({
  socketMachineAuthMode: () => "off",
  verifyMachineSocketAuth: vi.fn(async () => ({ ok: true })),
  recordSocketMachineAuthMismatch: vi.fn(),
}));
vi.mock("../services/notificationService", () => ({ initNotificationService: vi.fn() }));
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../db/reportAggregators", () => ({ resolveTenantFactoryScope: vi.fn(async () => ({ factoryIds: [] })) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

const ENV_GOC = process.env.SOCKET_HEARTBEAT_THROTTLE_MS;

describe("★★★ machine:heartbeat (socket) — BỀN HOÁ xuống machines.lastHeartbeat, có tiết lưu", () => {
  let socketMod: typeof import("./socket");
  /** Cửa sổ tiết lưu ĐỌC TỪ MÃ SẢN PHẨM — không gõ tay con số nào vào tệp test. */
  let W: number;

  /** Đăng ký một máy bằng chính sự kiện thật ⇒ nó vào `connectedMachines` với socketId này. */
  const dangKyMay = (sk: FakeSocket, machineId: number, code: string) =>
    sk.gui("machine:confirm_mapping", { machineId, machineCode: code, apiKey: "k" });

  const soLuotGhi = () => updateMachineHeartbeat.mock.calls.length;

  beforeEach(async () => {
    delete process.env.SOCKET_HEARTBEAT_THROTTLE_MS;
    vi.useFakeTimers();
    vi.resetModules();
    updateMachineHeartbeat.mockClear();
    updateMachineHeartbeat.mockImplementation(async (_id: number) => undefined);
    createMachineStatusLog.mockClear();
    presenceRefresh.mockClear();
    socketMod = await import("./socket");
    socketMod.initializeSocket({} as any);
    // Ba broadcaster anh em: dừng ngay để đồng hồ giả không kéo theo việc khác.
    socketMod.stopTwinBroadcaster();
    socketMod.stopOeeBroadcaster();
    socketMod.stopTwinTrangThaiBroadcaster();
    W = (socketMod as any).NGUONG_TIET_LUU_NHIP_TIM_SOCKET_MS;
  });

  afterEach(() => {
    socketMod.stopTwinBroadcaster();
    socketMod.stopOeeBroadcaster();
    socketMod.stopTwinTrangThaiBroadcaster();
    vi.useRealTimers();
    if (ENV_GOC === undefined) delete process.env.SOCKET_HEARTBEAT_THROTTLE_MS;
    else process.env.SOCKET_HEARTBEAT_THROTTLE_MS = ENV_GOC;
    FakeServer.hienTai = null;
  });

  it("(0) thiết bị đo tự canh: `initializeSocket` thật đăng ký `connection`, và socket có ĐÚNG 2 listener `machine:heartbeat`", () => {
    const sv = FakeServer.hienTai!;
    expect(sv.handlers.has("connection")).toBe(true);
    const sk = sv.ketNoi("s-may");
    // 2 = handler chính (dòng ~384) + hook state-store additive (dòng ~833). Nếu con số này đổi,
    // thứ tự đăng ký trong socket.ts đã đổi và mọi kết luận dưới đây phải đo lại.
    expect(sk.handlers.get("machine:heartbeat")?.length).toBe(2);
    expect(sk.handlers.get("machine:confirm_mapping")?.length).toBe(2);
    expect(soLuotGhi()).toBe(0);
  });

  it("(10) ngưỡng tiết lưu phải là số dương và NHỎ HƠN HẲN ngưỡng tươi 5 phút (tuổi xấu nhất ≤ 1/4 ngưỡng)", () => {
    expect(typeof W).toBe("number");
    expect(W).toBeGreaterThan(0);
    // Tuổi xấu nhất của `machines.lastHeartbeat` trên một máy KHOẺ = W + một chu kỳ nhịp.
    // Chu kỳ nhịp tham chiếu của repo: EDGE_HEARTBEAT_INTERVAL_MS / EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS = 30 000 ms.
    // Ràng buộc: tuổi xấu nhất ≤ 1/4 ngưỡng tươi ⇒ máy khoẻ không bao giờ rơi `khong_ro`.
    expect(W + 30_000).toBeLessThanOrEqual(NGUONG_TRANG_THAI_TUOI_MS / 4);
  });

  it("★ (1) máy ĐÃ đăng ký phát `machine:heartbeat` ⇒ ghi `updateMachineHeartbeat` ĐÚNG machineId", () => {
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    expect(soLuotGhi(), "đăng ký mapping KHÔNG được tự ghi nhịp tim").toBe(0);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(1);
    expect(updateMachineHeartbeat).toHaveBeenCalledWith(77);
  });

  it("★★ (2) BA nhịp LIÊN TIẾP trong cửa sổ tiết lưu ⇒ ĐÚNG MỘT lượt ghi (nửa dễ quên)", () => {
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    vi.advanceTimersByTime(Math.floor(W / 3));
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    vi.advanceTimersByTime(Math.floor(W / 3));
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi(), "3 nhịp trong cùng cửa sổ ⇒ chỉ MỘT lượt ghi DB").toBe(1);
    // …nhưng phát sóng realtime thì KHÔNG bị tiết lưu: 3 nhịp = 3 gói `machine:status_update`.
    const goi = FakeServer.hienTai!.phatTheoPhong.filter((p) => p.evt === "machine:status_update");
    expect(goi.length, "tiết lưu chỉ được chặn lượt GHI, không được chặn phát sóng").toBe(3);
    expect(presenceRefresh, "presence cũng KHÔNG bị tiết lưu").toHaveBeenCalledTimes(3);
  });

  it("★★ (3) hết cửa sổ ⇒ ghi lại lần nữa (biên chính xác: W−1 vẫn 1 lượt · W ⇒ 2 lượt)", () => {
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(1);
    vi.advanceTimersByTime(W - 1);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi(), `tại W−1 (${W - 1} ms) cửa sổ CHƯA hết`).toBe(1);
    vi.advanceTimersByTime(1);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi(), `tại W (${W} ms) phải ghi lượt thứ hai`).toBe(2);
    expect(updateMachineHeartbeat).toHaveBeenNthCalledWith(2, 77);
    // và cửa sổ mới bắt đầu lại từ lượt ghi thứ hai
    vi.advanceTimersByTime(W - 1);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(2);
  });

  it("(4) tiết lưu tính RIÊNG từng máy — máy B không bị máy A nuốt mất lượt ghi", () => {
    const a = FakeServer.hienTai!.ketNoi("s-a");
    const b = FakeServer.hienTai!.ketNoi("s-b");
    dangKyMay(a, 11, "M-11");
    dangKyMay(b, 22, "M-22");
    a.gui("machine:heartbeat", { machineId: 11, status: "running" });
    b.gui("machine:heartbeat", { machineId: 22, status: "running" });
    expect(soLuotGhi()).toBe(2);
    expect(updateMachineHeartbeat.mock.calls.map((c) => c[0])).toEqual([11, 22]);
  });

  it("★★★ (−5) ĐỐI CHỨNG ÂM: socket LẠ mạo danh machineId ⇒ KHÔNG ghi gì cả (hàng rào socket.ts:386 còn nguyên)", () => {
    const that = FakeServer.hienTai!.ketNoi("s-that");
    const la = FakeServer.hienTai!.ketNoi("s-la");
    dangKyMay(that, 77, "M-77"); // máy 77 thuộc về s-that
    la.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi(), "socket lạ mạo danh machineId ⇒ KHÔNG được ghi DB").toBe(0);
    expect(presenceRefresh).not.toHaveBeenCalled();
    expect(FakeServer.hienTai!.phatTheoPhong.filter((p) => p.evt === "machine:status_update").length).toBe(0);
    // ⚠ và phép đo này KHÔNG phải vì thiết bị đo chết: cùng harness, socket THẬT ghi được ngay.
    that.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(1);
  });

  it("(−6) machineId chưa đăng ký (không có trong connectedMachines) ⇒ KHÔNG ghi", () => {
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    sk.gui("machine:heartbeat", { machineId: 999, status: "running" });
    expect(soLuotGhi()).toBe(0);
  });

  it("★ (7) lượt ghi HỎNG (promise reject) ⇒ handler không ném, vẫn phát sóng, lỗi ĐƯỢC BẮT (có .catch)", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      updateMachineHeartbeat.mockImplementation(async () => {
        throw new Error("DB down");
      });
      const sk = FakeServer.hienTai!.ketNoi("s-may");
      dangKyMay(sk, 77, "M-77");
      expect(() => sk.gui("machine:heartbeat", { machineId: 77, status: "running" })).not.toThrow();
      expect(FakeServer.hienTai!.phatTheoPhong.filter((p) => p.evt === "machine:status_update").length).toBe(1);
      // ⚠ PHẢI await TRƯỚC khi gỡ spy: `.catch` chạy ở microtask sau lượt gọi đồng bộ — lượt viết
      // đầu của tệp này gỡ spy trong `finally` đồng bộ nên đo được chuỗi RỖNG (âm tính giả của
      // chính thiết bị đo, không phải của sản phẩm).
      await vi.advanceTimersByTimeAsync(0);
      // Bằng chứng `.catch` CÓ chạy (thiếu `.catch` ⇒ unhandled rejection, và không có dòng log này).
      expect(loi.mock.calls.flat().join(" ")).toMatch(/updateMachineHeartbeat/);
    } finally {
      loi.mockRestore();
    }
  });

  it("★ (8) lượt ghi ném ĐỒNG BỘ (hàm hỏng) ⇒ handler vẫn sống, vẫn phát sóng", () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      updateMachineHeartbeat.mockImplementation(() => {
        throw new Error("ném đồng bộ");
      });
      const sk = FakeServer.hienTai!.ketNoi("s-may");
      dangKyMay(sk, 77, "M-77");
      expect(() => sk.gui("machine:heartbeat", { machineId: 77, status: "running" })).not.toThrow();
      expect(FakeServer.hienTai!.phatTheoPhong.filter((p) => p.evt === "machine:status_update").length).toBe(1);
    } finally {
      loi.mockRestore();
    }
  });

  it("★ (9) KHÔNG CHẶN: lượt ghi treo vô hạn ⇒ `machine:status_update` vẫn phát NGAY trong cùng lượt gọi", () => {
    updateMachineHeartbeat.mockImplementation(() => new Promise<never>(() => {}) as any);
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    // KHÔNG await gì cả — nếu handler `await` lượt ghi thì gói này chưa tồn tại.
    expect(FakeServer.hienTai!.phatTheoPhong.filter((p) => p.evt === "machine:status_update").length).toBe(1);
    expect(soLuotGhi()).toBe(1);
  });

  it("(11) `SOCKET_HEARTBEAT_THROTTLE_MS` ghi đè cửa sổ (đọc lúc GỌI, không phải lúc nạp module)", () => {
    process.env.SOCKET_HEARTBEAT_THROTTLE_MS = "5000";
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    vi.advanceTimersByTime(4_999);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(1);
    vi.advanceTimersByTime(1);
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(2);
  });

  it("(12) máy NGẮT kết nối ⇒ sổ tiết lưu được giải phóng; nối lại là ghi ngay (không chờ hết cửa sổ)", () => {
    const sk = FakeServer.hienTai!.ketNoi("s-may");
    dangKyMay(sk, 77, "M-77");
    sk.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi()).toBe(1);
    sk.gui("disconnect");
    const sk2 = FakeServer.hienTai!.ketNoi("s-may-2");
    dangKyMay(sk2, 77, "M-77");
    sk2.gui("machine:heartbeat", { machineId: 77, status: "running" });
    expect(soLuotGhi(), "máy vừa nối lại phải được ghi ngay lượt nhịp đầu").toBe(2);
  });
});
