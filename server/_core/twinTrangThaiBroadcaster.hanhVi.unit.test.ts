/**
 * twinTrangThaiBroadcaster.hanhVi.unit.test.ts — ★ ĐỢT 40 (F): NHỊP `twin:trangThai` ĐO BẰNG HÀNH VI, KHÔNG BẰNG CHUỖI NGUỒN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG GHIM `SRC.toContain("intervalMs = 10000")`
 * ══════════════════════════════════════════════════════════════════════════════
 * Một ghim chuỗi xanh y hệt khi `setInterval(..., 5000)` được viết ở dòng dưới với tham số mặc định vẫn là 10000,
 * hoặc khi `phatTwinTrangThaiNgay` bị xoá khỏi handler `subscribe` mà chữ ký hàm còn nguyên. Nó đo CHỮ, không đo
 * NHỊP. Tệp này chạy `initializeSocket` THẬT với một `socket.io` giả (G20: import mã sản phẩm, không chép lại),
 * bấm đồng hồ giả và đếm `emit("twin:trangThai")` trên chính socket:
 *   (1) join phòng `twin:{id}` ⇒ MỘT gói ngay lập tức, TRƯỚC khi đồng hồ chạy (Đợt 38 Pareto #6);
 *   (2) t = 9 999 ms ⇒ vẫn 1 gói (nhịp KHÔNG ngắn hơn 10 s);
 *   (3) t = 10 000 ms ⇒ 2 gói; t = 20 000 ⇒ 3 gói (nhịp ĐÚNG 10 s, không dài hơn).
 * Đột biến bắt được: bỏ `void phatTwinTrangThaiNgay(...)` ⇒ (1) đỏ · đổi 10000 thành 5000/15000 ⇒ (2)/(3) đỏ.
 *
 * ★ Mọi thứ ngoài broadcaster (DB, Redis, presence, eventBus, state-store, notification) được mock RỖNG: tệp này
 *   đo đúng MỘT thứ — nhịp phát — không phải toàn bộ `socket.ts`. Hai broadcaster anh em (WIP 2 s, OEE) được
 *   DỪNG ngay sau khởi tạo để đồng hồ giả chỉ chạy một vòng lặp.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── socket.io giả: bắt handler `connection`, giữ phòng + socket như adapter thật. ──
type Handler = (...args: any[]) => unknown;
class FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake = { auth: {}, headers: {} as Record<string, string> };
  handlers = new Map<string, Handler>();
  emit = vi.fn();
  constructor(id: string, user: { id: number; role: string } | null, private server: FakeServer) {
    this.id = id;
    this.data = { user, clientType: user ? "browser" : "machine" };
    server.sockets.sockets.set(id, this);
  }
  on(evt: string, fn: Handler) {
    this.handlers.set(evt, fn);
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
  /** Gửi một sự kiện như client thật gửi. */
  gui(evt: string, ...args: unknown[]) {
    const h = this.handlers.get(evt);
    if (!h) throw new Error(`socket giả không có handler "${evt}"`);
    return h(...args);
  }
}
class FakeServer {
  static hienTai: FakeServer | null = null;
  handlers = new Map<string, Handler>();
  sockets = { adapter: { rooms: new Map<string, Set<string>>() }, sockets: new Map<string, FakeSocket>() };
  use = vi.fn();
  emit = vi.fn();
  to() {
    return { emit: vi.fn() };
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
  ketNoi(id: string, user: { id: number; role: string } | null): FakeSocket {
    const sk = new FakeSocket(id, user, this);
    const conn = this.handlers.get("connection");
    if (!conn) throw new Error("initializeSocket chưa đăng ký handler connection");
    conn(sk);
    return sk;
  }
}
vi.mock("socket.io", () => ({ Server: FakeServer }));

// ── Mọi cạnh khác của socket.ts: rỗng. ──
vi.mock("../db", () => ({}));
vi.mock("./sdk", () => ({ sdk: { authenticateRequest: vi.fn(async () => null) } }));
vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({ onConnect: vi.fn(), onDisconnect: vi.fn(), touch: vi.fn() }),
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
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

// ── Nguồn dữ liệu của gói + phạm vi người xem: đếm được, trả cố định. ──
const traTrangThaiHangLoat = vi.fn(async (_factoryId: number, _bayGio: number, _scope: unknown) => [
  { machineId: 14, trangThai: "idle", capNhatLuc: 1, doTuoiGiay: 1, isActive: true },
]);
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: (...a: any[]) => (traTrangThaiHangLoat as any)(...a) }));
const resolveTenantFactoryScope = vi.fn(async (_a: unknown) => ({ factoryIds: [1] as number[] | null }));
vi.mock("../db/reportAggregators", () => ({
  resolveTenantFactoryScope: (a: unknown) => resolveTenantFactoryScope(a),
}));

const ENV_GOC = process.env.TWIN_STREAM_ENABLED;

/** Số gói `twin:trangThai` một socket đã nhận. */
const soGoi = (sk: FakeSocket) => sk.emit.mock.calls.filter((c) => c[0] === "twin:trangThai").length;

describe("★★★ Đợt 40 (F) — nhịp phát `twin:trangThai`: ngay khi join + đúng mỗi 10 s (đồng hồ giả)", () => {
  let socketMod: typeof import("./socket");

  beforeEach(async () => {
    process.env.TWIN_STREAM_ENABLED = "true";
    vi.useFakeTimers();
    vi.resetModules();
    socketMod = await import("./socket");
    socketMod.initializeSocket({} as any);
    // Chỉ để lại đúng MỘT vòng lặp trên đồng hồ giả.
    socketMod.stopTwinBroadcaster();
    socketMod.stopOeeBroadcaster();
    traTrangThaiHangLoat.mockClear();
    resolveTenantFactoryScope.mockClear();
  });

  afterEach(() => {
    socketMod.stopTwinTrangThaiBroadcaster();
    vi.useRealTimers();
    process.env.TWIN_STREAM_ENABLED = ENV_GOC;
    FakeServer.hienTai = null;
  });

  it("thiết bị đo tự canh: `initializeSocket` thật đã đăng ký `connection` + handler `subscribe` trên socket", () => {
    const sv = FakeServer.hienTai!;
    expect(sv.handlers.has("connection")).toBe(true);
    const sk = sv.ketNoi("s1", { id: 51, role: "engineer" });
    expect(sk.handlers.has("subscribe")).toBe(true);
    expect(soGoi(sk)).toBe(0);
  });

  it("★★★ (1) join `twin:1` ⇒ MỘT gói NGAY, trước khi đồng hồ chạy — và gói mang dữ liệu của `traTrangThaiHangLoat`", async () => {
    const sk = FakeServer.hienTai!.ketNoi("s1", { id: 51, role: "engineer" });
    sk.gui("subscribe", { twinFactoryId: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeServer.hienTai!.sockets.adapter.rooms.get("twin:1")?.has("s1")).toBe(true);
    expect(soGoi(sk)).toBe(1);
    const goi = sk.emit.mock.calls.find((c) => c[0] === "twin:trangThai")![1];
    expect(goi.factoryId).toBe(1);
    expect(goi.tong).toBe(1);
    expect(goi.may[0].machineId).toBe(14);
    expect(traTrangThaiHangLoat).toHaveBeenCalledTimes(1);
  });

  it("★★★ (2)+(3) nhịp ĐÚNG 10 000 ms: 9 999 ⇒ vẫn 1 · 10 000 ⇒ 2 · 20 000 ⇒ 3 · 29 999 ⇒ vẫn 3", async () => {
    const sk = FakeServer.hienTai!.ketNoi("s1", { id: 51, role: "engineer" });
    sk.gui("subscribe", { twinFactoryId: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(soGoi(sk)).toBe(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(soGoi(sk), "9 999 ms: nhịp không được NGẮN hơn 10 s").toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(soGoi(sk), "10 000 ms: phải có gói thứ hai").toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(soGoi(sk), "20 000 ms: gói thứ ba").toBe(3);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(soGoi(sk), "29 999 ms: chưa tới gói thứ tư").toBe(3);
  });

  it("(−) đối chứng phạm vi: người NGOÀI phạm vi join ⇒ KHÔNG vào phòng, 0 gói — kể cả sau 10 s", async () => {
    resolveTenantFactoryScope.mockResolvedValueOnce({ factoryIds: [] });
    const sk = FakeServer.hienTai!.ketNoi("s2", { id: 48, role: "operator" });
    sk.gui("subscribe", { twinFactoryId: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeServer.hienTai!.sockets.adapter.rooms.get("twin:1")?.has("s2") ?? false).toBe(false);
    expect(soGoi(sk)).toBe(0);
  });

  it("(−) không ai trong phòng ⇒ vòng 10 s KHÔNG đọc DB (không tốn truy vấn khi không ai xem)", async () => {
    await vi.advanceTimersByTimeAsync(30_000);
    expect(traTrangThaiHangLoat).not.toHaveBeenCalled();
  });
});
