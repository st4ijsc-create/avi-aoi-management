/**
 * doc 24 Wave-3 / C3 — OT CONNECTION SUPERVISOR (reconnect + dual-endpoint failover).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM (the C3 audit gap): today `otManager` connects each adapter ONCE and
 * holds a single `active` entry. If the driver drops there is NO reconnect
 * supervisor and NO way to fail over to a backup endpoint — a device outage
 * silently ends telemetry for that adapter until a manual restart.
 *
 * FIX (additive, flag-gated by OT_CONN_HA_ENABLED, default OFF): wrap each
 * adapter's driver(s) in a supervisor that
 *   1) DETECTS a lost/unhealthy connection (health() polling + isConnected()),
 *   2) RECONNECTS with EXPONENTIAL BACKOFF + JITTER (bounded by a max delay),
 *   3) runs a per-adapter STATE MACHINE (connecting → connected ⇄ reconnecting
 *      → failed) with honest metrics + a status getter, and
 *   4) on recovery RE-SUBSCRIBES the monitored tags.
 *   5) DUAL-ENDPOINT FAILOVER: an adapter may declare a primary + secondary
 *      endpoint; on primary loss the supervisor PROMOTES the standby with ZERO
 *      backoff (immediate) so telemetry resumes within one cycle. Only ONE
 *      endpoint's driver is ever connected at a time (single-writer preserved):
 *      the newly-promoted driver is what `otManager.getActiveDriver` returns, so
 *      the command dispatcher resolves the current endpoint WITHOUT any change to
 *      its gates or its single-dispatch invariant.
 *
 * SAFETY / HONESTY:
 *   - Every driver call is wrapped; a driver fault NEVER throws to the host
 *     (preserves otManager's existing fail-safe-skip behaviour).
 *   - The supervisor produces NO data of its own; it only forwards samples the
 *     real driver delivered. Metrics count real events (attempts, reconnects,
 *     failovers, dropped detections) — never fabricated.
 *   - "hot-standby" here means the standby endpoint is PROMOTED IMMEDIATELY on
 *     failure (no backoff wait), NOT that a second live socket is held open — so
 *     device load is not doubled and single-writer semantics hold trivially.
 *
 * The OtDriver contract has no event channel, so disconnect DETECTION is by
 * polling isConnected()/health() on a bounded interval (drivers update their
 * health on read/write errors). This is cheap and deterministic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type {
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OnOtSample,
  OtProtocol,
  TuyChonVongPoll,
  SuKienDoc,
} from "./otDriver";
import { chatLuongLoiChung } from "./chatLuong";
import { khoangNoiLaiMs, laDocTot, taoDemTickHong, thoiGianOnDinhMs } from "./reconnectNhanh";
import { withDeadline } from "./drivers/boundedClose";

/**
 * doc 81 Đợt 1B Task 1 — hạn cho MỖI lời gọi hạ kết nối của driver (disconnect /
 * subscription.close) và cho TOÀN BỘ stop(). Supervisor không được phụ thuộc vào việc
 * mọi driver đều trả về: một driver treo không được kẹt vòng nối lại hay stop().
 */
export const DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS = 2500;

/**
 * doc 81 Đợt 1B Task 2 — hạn (ms) cho MỘT lần nối endpoint (connect + subscribe). Khớp
 * mặc định OT_ADAPTER_START_TIMEOUT_MS của otManager: một thiết bị im lặng không được giữ
 * vòng nối (và start()) lâu hơn hạn khởi động một adapter.
 */
export const DEFAULT_SUPERVISOR_CONNECT_TIMEOUT_MS = 10_000;
/**
 * doc 81 Đợt 1B Task 2 (Fix round 1) — biên cộng vào timeoutMs của endpoint: hạn một lần nối
 * endpoint = max(connectTimeoutMs, endpoint.timeoutMs + biên) — thiết bị chậm hợp lệ vẫn nối được.
 */
export const SUPERVISOR_CONNECT_GRACE_MS = 1000;

/** Lifecycle state of a supervised adapter connection. */
/**
 * doc 81 Đợt 1B final wave (item 4, F3 census) — lỗi nội bộ của supervisor có mã, thay cho
 * `throw new Error`: `no_endpoints` là tiền điều kiện lập trình của constructor (otManager /
 * test tự bắt); `connect_pending` là nhánh "lần connect trước còn treo" mà attemptCycle bắt để
 * ghi lastError + backoff. Không chỗ nào tới người dùng cuối; message giữ nguyên văn cho kỹ sư.
 */
export class ConnectionSupervisorError extends Error {
  readonly reasonCode: "no_endpoints" | "connect_pending";
  constructor(reasonCode: "no_endpoints" | "connect_pending", message: string) {
    super(message);
    this.name = "ConnectionSupervisorError";
    this.reasonCode = reasonCode;
  }
}

export type SupervisorState =
  | "idle" // constructed, start() not called yet
  | "connecting" // initial connect attempt in progress (never connected yet)
  | "connected" // an endpoint is connected + subscribed (active)
  | "reconnecting" // lost/attempting recovery (backoff wait or connect in progress)
  | "failed" // a full endpoint cycle failed; waiting on backoff to retry
  | "stopped"; // stop() called — terminal

/** One endpoint the supervisor may connect to (primary or hot-standby secondary). */
export interface EndpointConfig {
  label: "primary" | "secondary";
  connection: OtConnectionConfig;
}

/** Bounded exponential-backoff-with-jitter parameters. */
export interface BackoffConfig {
  /** Base delay for the first retry (ms). */
  initialMs: number;
  /** Hard cap on any single backoff delay (ms). */
  maxMs: number;
  /** Exponential multiplier per consecutive failure (>= 1). */
  factor: number;
  /** Jitter fraction 0..1: delay ∈ [raw·(1-jitter), raw]. 0 = deterministic. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  initialMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};

export interface SupervisorOptions {
  adapterId: number;
  code: string;
  protocol: OtProtocol;
  tags: OtTagAddress[];
  pollIntervalMs: number;
  /** 1 (primary only) or 2 (primary + secondary) endpoints, in preference order. */
  endpoints: EndpointConfig[];
  /** Factory for a fresh driver instance — ONE is created per endpoint up-front. */
  createDriver: () => OtDriver;
  /** Ingest callback (one per sample); forwarded exactly as the legacy path does. */
  onSample: OnOtSample;
  /** Health-poll interval (ms). Defaults to min(pollInterval, 2000), floored at 250. */
  healthIntervalMs?: number;
  /** Backoff parameters (defaults to DEFAULT_BACKOFF). */
  backoff?: Partial<BackoffConfig>;
  /**
   * doc 40 OT-F1 — số lần health()/probe báo NOT-connected LIÊN TIẾP trước khi coi là
   * mất kết nối (fallback cho driver KHÔNG expose event transport). Mặc định đọc
   * OT_LINKLOSS_FAIL_THRESHOLD (default 3), tối thiểu 1. Lưu ý: driver báo isConnected()
   * === false, hoặc health() NÉM lỗi, vẫn là tín hiệu CỨNG → mất kết nối NGAY (không đợi
   * ngưỡng) — ngưỡng chỉ áp cho tín hiệu MỀM (health trả {connected:false} không ném).
   */
  linkLossFailThreshold?: number;
  /**
   * doc 40 MON-F1 — machineId để đẩy sự kiện online/offline (adapter connected/
   * disconnected) sang machinePresenceService. Tuỳ chọn: khi otManager truyền vào,
   * mỗi lần vào/ra state 'connected' sẽ ghi machine_status_logs (chống trùng, gated
   * MACHINE_PRESENCE_ENABLED). Không truyền ⇒ chỉ nhánh sweep-telemetry ghi presence.
   */
  machineId?: number;
  /**
   * doc 81 Đợt 1B Task 1 — hạn (ms) cho mỗi driver.disconnect()/handle.close() và cho cả
   * stop(). Mặc định {@link DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS}. Hết hạn ⇒ bỏ đợi
   * (driver tự dọn transport của nó), supervisor đi tiếp.
   */
  disconnectTimeoutMs?: number;
  /**
   * doc 81 Đợt 1B Task 2 — hạn (ms) cho một lần connect + subscribe một endpoint. Mặc định
   * {@link DEFAULT_SUPERVISOR_CONNECT_TIMEOUT_MS}. Hết hạn ⇒ lần thử đó tính là thất bại
   * (đi endpoint kế / backoff); nếu connect rốt cuộc xong MUỘN, kết nối muộn bị hạ ngay.
   */
  connectTimeoutMs?: number;
  /**
   * SCADA R0 Task 5 (C1 ở supervisor, C3) — gọi (đồng bộ, sau khi trạng thái đã đổi) mỗi lần chuyển trạng thái THẬT, kèm
   * lỗi gần nhất (+ `statusCode` ngắn của lỗi đó theo chatLuongLoiChung khi có đối tượng lỗi; null = không biết). Callback ném ⇒
   * bị nuốt (không bao giờ ảnh hưởng vòng kết nối). `stopped` là trạng thái CUỐI: không bao giờ có chuyển tiếp rời nó.
   */
  onStateChange?: (prev: SupervisorState, next: SupervisorState, lastError: string | null, statusCode?: string | null) => void;
  /** SCADA R0 Task 6 — tham số thứ 4 của driver.subscribe() (hạn đọc + onTick). Không đặt ⇒ driver dùng mặc định. */
  tuyChon?: TuyChonVongPoll;
  /** SCADA R0 Task 6 (C8) — gọi sau MỖI lần thử nối một endpoint (ok = nối + subscribe thành công). Ném ⇒ bị nuốt. */
  onConnectAttempt?: (ok: boolean) => void;
  /**
   * SCADA R0 T12 (D1) — số tick poll HỎNG liên tiếp (laTickHong: timeout / comm_lost cả tick) của phiên ĐANG HOẠT ĐỘNG ⇒ coi như mất
   * liên kết (onActiveLost: `reconnecting` ⇒ host báo lost; hạ phiên; nối lại). Bắt liên kết TREO mà isConnected() không thấy. Không
   * đặt / ≤ 0 ⇒ tắt (hành vi cũ). Tick của phiên đã bị thay bị bỏ qua. Dạng hàm ⇒ đọc lại MỖI lần subscribe (host gắn cờ vào đây).
   */
  soTickHongDeMat?: number | (() => number);
  /**
   * SCADA R1b-1 T3 — đọc lúc subscribe MỖI phiên (host gắn cờ OT_CHAT_LUONG_V2_ENABLED vào đây): true ⇒ phiên đó "chờ đọc tốt" —
   * host chỉ coi adapter là `connected` sau tick ĐỌC TỐT đầu tiên của phiên (xem `dangChoDocTot()` / `onDocTotDauTien`). KHÔNG đổi
   * trạng thái supervisor: state vẫn 'connected' khi TCP + subscribe xong (getActiveDriver, D1, healthTick, presence giữ nguyên).
   * Không đặt / false ⇒ hành vi cũ.
   */
  choDocTotDauTien?: () => boolean;
  /**
   * SCADA R1b-1 T3 — tick đọc tốt (`laDocTot`) ĐẦU TIÊN của phiên đang hoạt động, khi phiên đó đang chờ và supervisor đang
   * 'connected'. Tick tốt về TRƯỚC khi phiên thành hoạt động (lần đọc đầu tức thì) không gọi hàm này: nó được ghi lại và
   * `dangChoDocTot()` trả false ngay khi supervisor vào 'connected'. Ném ⇒ bị nuốt.
   */
  onDocTotDauTien?: () => void;
}

/** Snapshot of a supervisor for an internal health getter (future health endpoint). */
export interface SupervisorStatus {
  adapterId: number;
  code: string;
  protocol: OtProtocol;
  state: SupervisorState;
  /** True iff the active endpoint's driver reports connected right now. */
  connected: boolean;
  /** The endpoint string currently active (or null if none connected). */
  activeEndpoint: string | null;
  /** Which declared endpoint is active. */
  activeLabel: "primary" | "secondary" | null;
  /** How many endpoints are configured (1 = no failover; 2 = dual-endpoint). */
  endpointCount: number;
  /** Successful reconnections since start (excludes the initial connect). */
  reconnects: number;
  /** Times the active endpoint changed to a DIFFERENT endpoint (promotions). */
  failovers: number;
  /** Cumulative connect() attempts (all endpoints, all cycles). */
  attempts: number;
  /** Consecutive fully-failed cycles (drives the current backoff exponent). */
  consecutiveFailures: number;
  /** Samples forwarded to ingest since start. */
  samplesForwarded: number;
  /** Last error text observed on a connect/health fault (or null). */
  lastError: string | null;
  /** ISO time the active endpoint last connected (or null). */
  lastConnectedAt: string | null;
  /** ISO time of the last state transition. */
  lastStateChangeAt: string | null;
}

/** A configured endpoint + its (reused-across-reconnects) driver instance. */
interface RuntimeEndpoint {
  label: "primary" | "secondary";
  connection: OtConnectionConfig;
  driver: OtDriver;
  /**
   * doc 81 Đợt 1B Task 2 — lần connect+subscribe đã quá hạn nhưng CHƯA settle. Khi còn khác
   * null, endpoint này không được connect lại (một driver không chịu hai connect chồng nhau);
   * lúc settle, kết nối muộn (nếu có) bị hạ rồi trường này về null.
   */
  pendingConnect: Promise<unknown> | null;
}

function errMsg(err: unknown): string {
  return (err as Error)?.message || String(err);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** doc 40 OT-F1 — ngưỡng số lần probe-mềm thất bại liên tiếp (env, default 3, min 1). */
function linkLossThresholdFromEnv(): number {
  const raw = Number(process.env.OT_LINKLOSS_FAIL_THRESHOLD);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
}

/**
 * Supervises ONE adapter connection: reconnect with backoff + dual-endpoint
 * failover + a state machine. All public methods are non-throwing.
 */
export class ConnectionSupervisor {
  private readonly adapterId: number;
  private readonly code: string;
  private readonly protocol: OtProtocol;
  private readonly tags: OtTagAddress[];
  private readonly pollIntervalMs: number;
  private readonly onSample: OnOtSample;
  private readonly healthIntervalMs: number;
  private readonly backoff: BackoffConfig;
  /** doc 40 OT-F1 — ngưỡng probe-mềm thất bại liên tiếp → coi mất kết nối. */
  private readonly linkLossThreshold: number;
  /** doc 40 MON-F1 — machineId (nếu có) để đẩy presence online/offline. */
  private readonly machineId: number | null;
  /** doc 81 Đợt 1B Task 1 — hạn cho mỗi lời gọi hạ kết nối + cho stop(). */
  private readonly disconnectTimeoutMs: number;
  /** doc 81 Đợt 1B Task 2 — hạn cho một lần connect + subscribe một endpoint. */
  private readonly connectTimeoutMs: number;

  private readonly endpoints: RuntimeEndpoint[];

  // ── mutable runtime state ──────────────────────────────────────────────────
  private state: SupervisorState = "idle";
  private activeIndex = -1; // index into endpoints of the connected endpoint (-1 = none)
  private activeHandle: OtSubscriptionHandle | null = null;

  private hasConnectedOnce = false;
  private cycleRunning = false;
  private stopped = false;
  /** doc 40 OT-F1 — đếm probe-mềm (health trả {connected:false}) thất bại liên tiếp. */
  private consecutiveProbeFailures = 0;
  /** doc 40 MON-F1 — presence đã đẩy gần nhất (chống đẩy trùng mỗi tick). */
  private lastPresenceOnline: boolean | null = null;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── honest metrics ─────────────────────────────────────────────────────────
  private attempts = 0;
  private reconnects = 0;
  private failovers = 0;
  private consecutiveFailures = 0;
  private samplesForwarded = 0;
  private lastError: string | null = null;
  /** statusCode ngắn (chatLuongLoiChung) của lỗi gần nhất khi có đối tượng lỗi; null = không biết (báo "comm_lost"). */
  private lastStatusCode: string | null = null;
  private lastConnectedAt: number | null = null;
  /** SCADA R0 — Date.now() lúc lần nối LẠI (không phải lần đầu) gần nhất thành công; null khi liên kết đã ổn định/chưa nối lại. */
  private reconnectedAt: number | null = null;
  private lastStateChangeAt: number = Date.now();
  private readonly onStateChange: SupervisorOptions["onStateChange"] | null;
  private readonly tuyChon: TuyChonVongPoll | undefined;
  private readonly onConnectAttempt: SupervisorOptions["onConnectAttempt"] | null;
  /** T12 D1 — ngưỡng tick hỏng liên tiếp (≤ 0 = tắt); hàm ⇒ đọc lại mỗi phiên. */
  private readonly soTickHongDeMat: number | (() => number);
  /** T12 D1 — số thứ tự phiên subscribe (tăng mỗi lần connectAndSubscribe) và phiên đang là activeHandle (0 = không có). */
  private demPhien = 0;
  private phienHoatDong = 0;
  /** R1b-1 T3 — phiên MỚI NHẤT có "chờ đọc tốt" (0 = phiên mới nhất không chờ) và phiên mới nhất đã có tick đọc tốt (0 = chưa). */
  private phienChoDocTot = 0;
  private phienDaDocTot = 0;
  private readonly choDocTotDauTien: (() => boolean) | null;
  private readonly onDocTotDauTien: (() => void) | null;

  constructor(opts: SupervisorOptions) {
    this.adapterId = opts.adapterId;
    this.code = opts.code;
    this.protocol = opts.protocol;
    this.tags = opts.tags;
    this.pollIntervalMs = opts.pollIntervalMs > 0 ? opts.pollIntervalMs : 5000;
    this.onSample = opts.onSample;
    this.backoff = {
      initialMs: opts.backoff?.initialMs ?? DEFAULT_BACKOFF.initialMs,
      maxMs: opts.backoff?.maxMs ?? DEFAULT_BACKOFF.maxMs,
      factor: opts.backoff?.factor ?? DEFAULT_BACKOFF.factor,
      jitter: clamp01(opts.backoff?.jitter ?? DEFAULT_BACKOFF.jitter),
    };
    // Health poll must be <= the poll interval so a loss is detected within one
    // cycle (the failover requirement); floored only to avoid a busy loop.
    const desiredHealth = opts.healthIntervalMs ?? Math.min(this.pollIntervalMs, 2000);
    this.healthIntervalMs = Math.max(20, Math.min(desiredHealth, this.pollIntervalMs));
    this.linkLossThreshold = Math.max(
      1,
      Math.floor(opts.linkLossFailThreshold ?? linkLossThresholdFromEnv()),
    );
    this.machineId = opts.machineId ?? null;
    this.onStateChange = opts.onStateChange ?? null;
    this.tuyChon = opts.tuyChon;
    this.onConnectAttempt = opts.onConnectAttempt ?? null;
    this.soTickHongDeMat = opts.soTickHongDeMat ?? 0;
    this.choDocTotDauTien = opts.choDocTotDauTien ?? null;
    this.onDocTotDauTien = opts.onDocTotDauTien ?? null;
    this.disconnectTimeoutMs =
      typeof opts.disconnectTimeoutMs === "number" && opts.disconnectTimeoutMs > 0
        ? opts.disconnectTimeoutMs
        : DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS;
    this.connectTimeoutMs =
      typeof opts.connectTimeoutMs === "number" && opts.connectTimeoutMs > 0
        ? opts.connectTimeoutMs
        : DEFAULT_SUPERVISOR_CONNECT_TIMEOUT_MS;

    if (!opts.endpoints || opts.endpoints.length === 0) {
      throw new ConnectionSupervisorError("no_endpoints", `ConnectionSupervisor "${opts.code}": at least one endpoint required`);
    }
    // ONE driver instance per endpoint, created up-front and REUSED across
    // reconnects (drivers create a fresh transport on each connect()).
    this.endpoints = opts.endpoints.map((e) => ({
      label: e.label,
      connection: e.connection,
      driver: opts.createDriver(),
      pendingConnect: null,
    }));
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Begin supervision: start the health loop and run the initial connect cycle
   * (primary first). Never throws — a failed initial connect schedules a retry.
   */
  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.startHealthLoop();
    await this.runReconnect(false);
  }

  /**
   * The currently-active connected driver, or undefined when not connected. This
   * is what otManager.getActiveDriver delegates to, so the command dispatcher
   * resolves the CURRENT endpoint. Returns undefined unless state==='connected'
   * AND the active driver still reports connected (dispatcher → ADAPTER_OFFLINE).
   */
  getActiveDriver(): OtDriver | undefined {
    if (this.state !== "connected") return undefined;
    const ep = this.endpoints[this.activeIndex];
    if (!ep) return undefined;
    try {
      return ep.driver.isConnected() ? ep.driver : undefined;
    } catch {
      return undefined;
    }
  }

  /** The endpoint string currently active (or undefined). */
  getActiveEndpoint(): string | undefined {
    const ep = this.endpoints[this.activeIndex];
    return ep?.connection.endpoint;
  }

  /** Non-throwing snapshot for a future health endpoint / UI. */
  status(): SupervisorStatus {
    const ep = this.endpoints[this.activeIndex];
    let connected = false;
    try {
      connected = this.state === "connected" && !!ep && ep.driver.isConnected();
    } catch {
      connected = false;
    }
    return {
      adapterId: this.adapterId,
      code: this.code,
      protocol: this.protocol,
      state: this.state,
      connected,
      activeEndpoint: ep?.connection.endpoint ?? null,
      activeLabel: ep?.label ?? null,
      endpointCount: this.endpoints.length,
      reconnects: this.reconnects,
      failovers: this.failovers,
      attempts: this.attempts,
      consecutiveFailures: this.consecutiveFailures,
      samplesForwarded: this.samplesForwarded,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt != null ? new Date(this.lastConnectedAt).toISOString() : null,
      lastStateChangeAt: new Date(this.lastStateChangeAt).toISOString(),
    };
  }

  /**
   * Stop supervision: clear timers, close the active subscription, and
   * disconnect every endpoint driver. Idempotent + non-throwing.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.setState("stopped");
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // doc 81 Đợt 1B Task 1 — cả stop() có MỘT hạn: đóng subscription + hạ mọi endpoint
    // SONG SONG, mỗi lời gọi tự có hạn; driver treo không giữ được stop().
    await this.bounded(
      (async () => {
        await this.closeActiveHandle();
        await Promise.all(this.endpoints.map((ep) => this.safeDisconnect(ep)));
      })(),
      "stop",
    );
    this.activeIndex = -1;
  }

  /**
   * doc 81 Đợt 4 Task B3 (QĐ-4b) — drop the ACTIVE endpoint's session and open a FRESH one on the SAME endpoint (the
   * driver object a STOP already resolved stays the one that gets the new session; no failover here — a failed reset
   * leaves failover to the normal retry loop). Used by the command dispatcher when a timed-out write is still pending
   * after its grace, so the next command (a STOP) never shares the session that write may still be using.
   * Single-flight with the reconnect loop: a cycle already running / not connected / stopped ⇒ false.
   * fix scan (1) — COOPERATIVE budget: every step (close + disconnect, then connect + subscribe) runs inside ONE budget
   * `budgetMs` (default resetBoundMs() = the endpoint's connect deadline), so when the budget is spent this call has
   * ITSELF given up — nothing it started keeps going and later replaces the session. A connect that lands after the
   * budget is never made active: connectAndSubscribe's late-connect reaper closes it (existing behaviour). Failure ⇒
   * 'failed' + the normal backoff retry. Never throws. true ⇔ a session opened by THIS call is connected.
   * RESIDUAL (fix round 1, review #5 — documented, not guarded): the disconnect step is BOUNDED, not cancelled. A driver
   * whose disconnect() hangs and completes only after the fresh connect could tear down the new session (driver-internal
   * state; a supervisor-side generation check cannot stop a driver from closing its own transport — that needs a
   * per-driver session epoch in every driver). The STOP on that session then FAILS visibly — through ITS OWN ledger row
   * (failed / timeout) and, while a stale-write risk is live, the read-only watch's "unreadable" critical alarm. (No
   * overlapRisk audit in this case: the reset itself had reported success.) Never silent. Same pattern as the existing
   * reconnect loop.
   */
  async resetSession(reason: string, budgetMs: number = this.resetBoundMs()): Promise<boolean> {
    if (this.stopped || this.cycleRunning || this.state !== "connected" || this.activeIndex < 0) return false;
    const idx = this.activeIndex;
    const ep = this.endpoints[idx];
    const end = Date.now() + Math.max(1, budgetMs);
    const left = (): number => end - Date.now();
    this.cycleRunning = true;
    try {
      this.lastError = reason;
      this.lastStatusCode = null;
      this.setState("reconnecting");
      const h = this.activeHandle;
      this.activeHandle = null;
      await this.boundedMs(
        (async () => {
          if (h) await h.close();
          await ep.driver.disconnect();
        })(),
        Math.min(this.disconnectTimeoutMs, Math.max(1, left())),
        "reset disconnect",
      );
      if (this.stopped || left() <= 0) {
        if (!this.stopped) this.failResetCycle(`session reset budget ${budgetMs}ms spent before reconnect`);
        return false;
      }
      this.attempts += 1;
      try {
        await this.connectAndSubscribe(ep, left());
      } catch (err) {
        this.failResetCycle(errMsg(err), chatLuongLoiChung(err).statusCode);
        void this.safeDisconnect(ep); // bounded on its own; never on the caller's budget
        return false;
      }
      if (this.stopped) {
        void this.closeActiveHandle().then(() => this.safeDisconnect(ep));
        return false;
      }
      this.activeIndex = idx;
      this.consecutiveFailures = 0;
      this.consecutiveProbeFailures = 0;
      this.lastError = null;
      this.lastConnectedAt = Date.now();
      this.reconnects += 1;
      this.hasConnectedOnce = true;
      this.setState("connected");
      return true;
    } catch {
      return false;
    } finally {
      this.cycleRunning = false;
    }
  }

  /** B3 — a reset that did not reconnect: honest state + the normal backoff retry (which may fail over). */
  private failResetCycle(error: string, statusCode: string | null = null): void {
    this.lastError = error;
    this.lastStatusCode = statusCode;
    this.consecutiveFailures += 1;
    this.setState("failed");
    this.scheduleRetry(this.nextBackoffDelay());
  }

  /**
   * doc 81 Đợt 4 Task B3 — the budget of resetSession() and the outer bound a caller puts on it: the connect deadline of
   * the active endpoint (the supervisor's connect timeout, raised for a slow endpoint exactly as connectAndSubscribe
   * does). resetSession spends at most this, all steps included.
   */
  resetBoundMs(): number {
    const ep = this.endpoints[this.activeIndex] ?? this.endpoints[0];
    return this.connectDeadlineFor(ep);
  }

  /** B3 — like bounded() with an explicit limit; never throws. */
  private async boundedMs(p: Promise<unknown>, ms: number, what: string): Promise<void> {
    try {
      await withDeadline(p, ms, `supervisor ${this.code} ${what}`);
    } catch (err) {
      this.lastError = errMsg(err);
    }
  }

  /** doc 81 Đợt 1B Task 1 — chờ p tối đa disconnectTimeoutMs; không bao giờ ném. */
  private async bounded(p: Promise<unknown>, what: string): Promise<void> {
    try {
      await withDeadline(p, this.disconnectTimeoutMs, `supervisor ${this.code} ${what}`);
    } catch (err) {
      this.lastError = errMsg(err);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private setState(next: SupervisorState): void {
    const prev = this.state;
    if (prev === next) return;
    // 'stopped' là trạng thái CUỐI: một vòng nối/reset đang dở khi stop() chạy không được kéo nó về 'failed'/'reconnecting'.
    if (prev === "stopped") return;
    this.state = next;
    this.lastStateChangeAt = Date.now();
    if (next === "connected") this.lastStatusCode = null;
    if (this.onStateChange) {
      try {
        this.onStateChange(prev, next, this.lastError, this.lastStatusCode);
      } catch {
        // callback của host không được làm hỏng vòng kết nối
      }
    }
    // doc 40 MON-F1 — đẩy presence CHỈ trên chuyển tiếp THẬT quanh 'connected':
    // (SCADA R1b-1 T3: presence GIỮ theo TCP — state supervisor — KHÔNG chờ lần đọc tốt đầu tiên như trạng thái adapter
    // `connected` (RAM/DB) của host khi OT_CHAT_LUONG_V2_ENABLED. Cố ý không đổi trong T3.)
    //   • vào 'connected'                → online
    //   • RỜI 'connected' sang state khác → offline
    // KHÔNG đẩy 'offline' cho idle→connecting→failed lúc mới khởi động (máy chưa từng
    // online). Chống trùng qua lastPresenceOnline; chỉ khi có machineId; không throw.
    if (this.machineId != null) {
      if (next === "connected" && this.lastPresenceOnline !== true) {
        this.lastPresenceOnline = true;
        void this.notifyPresence(true);
      } else if (prev === "connected" && next !== "connected" && this.lastPresenceOnline !== false) {
        this.lastPresenceOnline = false;
        void this.notifyPresence(false);
      }
    }
  }

  /**
   * doc 40 MON-F1 — đẩy 1 sự kiện presence sang machinePresenceService (best-effort).
   * Import động để tránh coupling load-order + để nhánh này là no-op khi service/DB vắng.
   * machinePresenceService tự gate MACHINE_PRESENCE_ENABLED + tự chống ghi trùng.
   */
  private async notifyPresence(online: boolean): Promise<void> {
    if (this.machineId == null) return;
    try {
      const mod = await import("../machinePresenceService");
      await mod.recordPresenceEvent(this.machineId, online, {
        source: `adapter:${this.code}`,
      });
    } catch {
      // never throw to the host from a presence push
    }
  }

  private startHealthLoop(): void {
    const timer = setInterval(() => {
      void this.healthTick();
    }, this.healthIntervalMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.healthTimer = timer;
  }

  /**
   * One health probe of the ACTIVE endpoint. Only acts while 'connected' — during
   * reconnecting/failed a backoff-scheduled cycle already owns recovery. Never throws.
   */
  private async healthTick(): Promise<void> {
    try {
      if (this.stopped || this.state !== "connected") return;
      const ep = this.endpoints[this.activeIndex];
      if (!ep) return;
      // Liên kết đã giữ vững đủ lâu sau lần nối ⇒ đợt mất kết thúc: bộ đếm thất bại về 0.
      if (this.lastConnectedAt != null && Date.now() - this.lastConnectedAt >= thoiGianOnDinhMs(this.pollIntervalMs)) {
        this.consecutiveFailures = 0;
        this.reconnectedAt = null;
      }

      // ── Tín hiệu CỨNG #1: driver báo isConnected()===false (event transport đã lật,
      // hoặc trạng thái lib thật đã đứt) → mất kết nối NGAY (không đợi ngưỡng). Đây là
      // đường doc 40 OT-F1: mọi driver nay lật connected=false khi rớt cáp giữa phiên.
      let reportedConnected: boolean;
      try {
        reportedConnected = ep.driver.isConnected();
      } catch {
        reportedConnected = false;
      }
      if (!reportedConnected) {
        this.consecutiveProbeFailures = 0;
        if (this.state === "connected") await this.onActiveLost("driver reported disconnected");
        return;
      }

      // ── Probe health(). NÉM lỗi = tín hiệu CỨNG #2 (I/O fault) → mất kết nối NGAY.
      let probeThrew = false;
      let probeConnected = true;
      try {
        const h = await ep.driver.health();
        probeConnected = h.connected !== false;
      } catch (err) {
        this.lastError = errMsg(err);
        this.lastStatusCode = chatLuongLoiChung(err).statusCode;
        probeThrew = true;
      }
      if (this.state !== "connected") return; // state có thể đã đổi trong lúc await
      if (probeThrew) {
        this.consecutiveProbeFailures = 0;
        await this.onActiveLost("health probe threw");
        return;
      }
      if (probeConnected) {
        this.consecutiveProbeFailures = 0;
        return;
      }

      // ── Tín hiệu MỀM: health() trả {connected:false} nhưng KHÔNG ném — fallback cho
      // driver không phân biệt rõ rớt-giữa-phiên. Đếm liên tiếp, chỉ coi mất kết nối khi
      // đạt ngưỡng OT_LINKLOSS_FAIL_THRESHOLD (đảm bảo đúng cả khi driver không expose event).
      this.consecutiveProbeFailures += 1;
      if (this.consecutiveProbeFailures >= this.linkLossThreshold) {
        this.consecutiveProbeFailures = 0;
        await this.onActiveLost(`health reported disconnected ${this.linkLossThreshold}x`);
      }
    } catch {
      // never throw to the host from a timer callback
    }
  }

  /** The active endpoint was detected down → promote standby / reconnect. */
  private async onActiveLost(reason?: string, statusCode?: string, haTransport = false): Promise<void> {
    if (this.stopped) return;
    if (reason) {
      this.lastError = reason;
      if (reason !== "health probe threw") this.lastStatusCode = null; // lỗi thật của probe đã ghi statusCode ngay trước đó
    }
    if (statusCode !== undefined) this.lastStatusCode = statusCode;
    // Liên kết vừa được nối LẠI mà rớt trước khi ổn định ⇒ tính là một lần thất bại và CHỜ theo backoff (không nối ngay, nếu không
    // vòng nối–rớt chạy mãi mỗi chu kỳ health). Liên kết ổn định (hoặc lần nối đầu) rớt ⇒ bộ đếm về 0, thử NGAY như trước.
    const khongOnDinh = this.reconnectedAt != null && Date.now() - this.reconnectedAt < thoiGianOnDinhMs(this.pollIntervalMs);
    if (khongOnDinh) this.consecutiveFailures += 1;
    else {
      this.consecutiveFailures = 0;
      this.reconnectedAt = null;
    }
    this.setState("reconnecting");
    const epMat = this.endpoints[this.activeIndex];
    await this.closeActiveHandle();
    // T12b fix round 1 — liên kết TREO (D1): driver vẫn tưởng còn nối (TCP nửa mở) ⇒ HẠ transport NGAY (có hạn), không để socket cũ
    // sống tới lần thử kế (backoff) hay bị bỏ rơi khi driver thay transport mà không đóng cái cũ (rò socket, phản hồi muộn).
    if (haTransport && epMat) await this.safeDisconnect(epMat);
    if (khongOnDinh) {
      this.scheduleRetry(this.nextBackoffDelay());
      return;
    }
    // preferOther=true → try the OTHER endpoint first (immediate hot-standby promote).
    await this.runReconnect(true);
  }

  /**
   * Run (at most) one reconnect cycle, then — if it failed — schedule the next
   * with exponential backoff. Single-flight (cycleRunning guard). Non-throwing.
   */
  private async runReconnect(preferOther: boolean): Promise<void> {
    if (this.stopped || this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      const ok = await this.attemptCycle(preferOther);
      if (!ok && !this.stopped) {
        this.scheduleRetry(this.nextBackoffDelay());
      }
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * Try to (re)connect+subscribe, walking endpoints in preference order. On the
   * FIRST success: mark it active, reset backoff, resume telemetry, and disconnect
   * the previously-active (different) endpoint to keep exactly one live connection.
   * On a full failure: bump consecutiveFailures + set 'failed'. Never throws.
   */
  private async attemptCycle(preferOther: boolean): Promise<boolean> {
    if (this.stopped) return false;
    const prevIndex = this.activeIndex;
    this.setState(this.hasConnectedOnce ? "reconnecting" : "connecting");

    for (const idx of this.tryOrder(preferOther)) {
      if (this.stopped) return false;
      const ep = this.endpoints[idx];
      this.attempts += 1;
      try {
        await this.connectAndSubscribe(ep);
        this.baoLanThu(true);
        // doc 81 Đợt 1B Task 1 — stop() đã chạy trong lúc connect: KHÔNG sống lại; hạ ngay
        // kết nối muộn này (không để poll/socket rò sau khi tiến trình đã yêu cầu dừng).
        if (this.stopped) {
          await this.closeActiveHandle();
          await this.safeDisconnect(ep);
          return false;
        }
        // ── success ──
        this.activeIndex = idx;
        // KHÔNG đặt consecutiveFailures = 0 ở đây: nối được rồi rớt ngay (thiết bị chấp nhận rồi đóng) phải làm backoff tích luỹ;
        // bộ đếm chỉ về 0 khi liên kết giữ vững ≥ thoiGianOnDinhMs (healthTick) hoặc khi một liên kết ổn định rớt (onActiveLost).
        this.consecutiveProbeFailures = 0; // doc 40 OT-F1 — reset đếm probe-mềm sau khi nối lại
        this.lastError = null;
        this.lastConnectedAt = Date.now();
        const wasConnected = this.hasConnectedOnce;
        if (wasConnected) {
          this.reconnects += 1;
          this.reconnectedAt = Date.now();
        }
        if (wasConnected && prevIndex >= 0 && prevIndex !== idx) {
          this.failovers += 1;
          // single-writer: drop the endpoint we just left (if still up).
          await this.safeDisconnect(this.endpoints[prevIndex]);
        }
        this.hasConnectedOnce = true;
        this.setState("connected");
        return true;
      } catch (err) {
        this.baoLanThu(false);
        this.lastError = errMsg(err);
        this.lastStatusCode = chatLuongLoiChung(err).statusCode;
        await this.safeDisconnect(ep);
        // try the next endpoint in this cycle
      }
    }

    // no endpoint connected this cycle
    this.consecutiveFailures += 1;
    this.setState("failed");
    return false;
  }

  /** SCADA R0 Task 6 (C8) — báo kết quả một lần thử nối; người nghe ném không ảnh hưởng vòng kết nối. */
  private baoLanThu(ok: boolean): void {
    try {
      this.onConnectAttempt?.(ok);
    } catch {
      // nuốt
    }
  }

  /** Endpoint indices to try: primary-first, or standby-first when promoting. */
  private tryOrder(preferOther: boolean): number[] {
    const n = this.endpoints.length;
    const all = Array.from({ length: n }, (_, i) => i);
    if (preferOther && n > 1) {
      const start = this.activeIndex >= 0 ? (this.activeIndex + 1) % n : 0;
      return [...all.slice(start), ...all.slice(0, start)];
    }
    return all;
  }

  /**
   * Connect an endpoint and subscribe its tags. Closes any prior active handle
   * first (the old endpoint is already down when we get here). Throws on any
   * connect/subscribe failure so attemptCycle can move to the next endpoint.
   */
  private async connectAndSubscribe(ep: RuntimeEndpoint, budgetMs?: number): Promise<void> {
    // doc 81 Đợt 1B Task 2 — lần connect trước (đã quá hạn) còn treo trên CHÍNH driver này:
    // không chồng connect thứ hai; tính lần này là thất bại, backoff sẽ thử lại sau.
    // doc 81 Đợt 4 Task B3 (fix scan 1) — `budgetMs` (session reset): the stale disconnect AND the connect share it.
    const t0 = Date.now();
    const deadlineMs = budgetMs ?? this.connectDeadlineFor(ep);
    if (ep.pendingConnect) {
      throw new ConnectionSupervisorError("connect_pending", `previous ${ep.label} connect still pending (timed out after ${deadlineMs}ms)`);
    }
    await this.closeActiveHandle();
    // Ensure a clean slate: a stale-but-"connected" driver is disconnected first.
    // doc 81 Đợt 1B Task 2 — có hạn (bounded không ném), không để disconnect treo giữ vòng nối.
    let staleConnected = false;
    try {
      staleConnected = ep.driver.isConnected();
    } catch {
      // ignore — connect() below establishes a fresh transport
    }
    if (staleConnected) {
      if (budgetMs == null) await this.safeDisconnect(ep);
      else await this.boundedMs(Promise.resolve().then(() => ep.driver.disconnect()), Math.min(this.disconnectTimeoutMs, Math.max(1, budgetMs)), "disconnect");
    }
    const connectMs = budgetMs == null ? deadlineMs : Math.max(1, deadlineMs - (Date.now() - t0));

    const phien = ++this.demPhien;
    const tuyChon = this.tuyChonChoPhien(phien);
    const work = (async (): Promise<OtSubscriptionHandle> => {
      await ep.driver.connect(ep.connection);
      try {
        return await ep.driver.subscribe(this.tags, this.wrappedOnSample, this.pollIntervalMs, tuyChon);
      } catch (err) {
        await this.safeDisconnect(ep);
        throw err;
      }
    })();

    // Cờ settle gắn TRƯỚC withDeadline ⇒ khi work reject đúng hạn, cờ đã bật lúc finally chạy.
    let workSettled = false;
    work.then(
      () => (workSettled = true),
      () => (workSettled = true),
    );
    let inTime = false;
    try {
      const handle = await withDeadline(work, connectMs, `supervisor ${this.code} ${ep.label} connect`);
      inTime = true;
      this.activeHandle = handle;
      this.phienHoatDong = phien;
    } finally {
      if (!inTime && !workSettled) this.reapLateConnect(ep, work);
    }
  }

  /**
   * SCADA R0 T12 (D1) — tuỳ chọn poll cho MỘT phiên: onTick của host + bộ đếm tick hỏng RIÊNG của phiên này. Tick hỏng thứ K chỉ tác
   * động khi phiên VẪN là phiên hoạt động và supervisor đang 'connected' (không chồng lên vòng nối/reset đang chạy).
   */
  private tuyChonChoPhien(phien: number): TuyChonVongPoll | undefined {
    let k = 0;
    try {
      const v = typeof this.soTickHongDeMat === "function" ? this.soTickHongDeMat() : this.soTickHongDeMat;
      k = typeof v === "number" && v > 0 ? v : 0;
    } catch {
      k = 0;
    }
    // R1b-1 T3 — phiên này có "chờ đọc tốt" không: đọc MỘT lần lúc subscribe (như soTickHongDeMat). Chỉ phiên MỚI NHẤT có thể thành
    // phiên hoạt động (connectAndSubscribe chạy tuần tự; phiên quá hạn bị reapLateConnect hạ) ⇒ một cặp số là đủ.
    let cho = false;
    try {
      cho = this.choDocTotDauTien?.() === true;
    } catch {
      cho = false;
    }
    this.phienChoDocTot = cho ? phien : 0;
    if (k <= 0 && !cho) return this.tuyChon;
    const hostOnTick = this.tuyChon?.onTick;
    const dem =
      k > 0
        ? taoDemTickHong(k, (e) => {
            if (this.stopped || this.cycleRunning || this.state !== "connected" || phien !== this.phienHoatDong) return;
            const sc = e.statusCode ?? (e.timeout ? "timeout" : "comm_lost");
            void this.onActiveLost(`poll: ${k} consecutive failed ticks (${sc})`, sc, true);
          })
        : null;
    return {
      ...this.tuyChon,
      onTick: (e) => {
        try {
          hostOnTick?.(e);
        } catch {
          // người nghe của host không được làm hỏng bộ đếm
        }
        if (cho) this.ghiNhanDocTot(phien, e);
        dem?.(e);
      },
    };
  }

  /**
   * R1b-1 T3 — tick của phiên `phien` (đang chờ đọc tốt). Đọc tốt đầu tiên của phiên MỚI NHẤT ⇒ ghi lại; nếu phiên đó đã là phiên hoạt
   * động và supervisor đang 'connected' ⇒ báo host (onDocTotDauTien). Tick của phiên cũ (đã bị thay) không ghi, không báo.
   */
  private ghiNhanDocTot(phien: number, e: SuKienDoc): void {
    if (phien !== this.demPhien || this.phienDaDocTot === phien || !laDocTot(e)) return;
    this.phienDaDocTot = phien;
    if (this.stopped || this.state !== "connected" || phien !== this.phienHoatDong) return; // vào 'connected' sau ⇒ dangChoDocTot() = false
    try {
      this.onDocTotDauTien?.();
    } catch {
      // người nghe của host không được làm hỏng vòng poll
    }
  }

  /**
   * R1b-1 T3 — phiên ĐANG hoạt động được mở với "chờ đọc tốt" và chưa có tick đọc tốt nào ⇒ host chưa được báo `connected`.
   * false khi không có phiên hoạt động hoặc phiên không chờ (cờ tắt lúc subscribe).
   */
  dangChoDocTot(): boolean {
    const p = this.phienHoatDong;
    return p !== 0 && this.phienChoDocTot === p && this.phienDaDocTot !== p;
  }

  /** Fix round 1 — hạn một lần nối endpoint: không ngắn hơn timeoutMs của chính endpoint + biên. */
  private connectDeadlineFor(ep: RuntimeEndpoint): number {
    const t = ep.connection.timeoutMs;
    return typeof t === "number" && Number.isFinite(t) && t > 0
      ? Math.max(this.connectTimeoutMs, t + SUPERVISOR_CONNECT_GRACE_MS)
      : this.connectTimeoutMs;
  }

  /**
   * doc 81 Đợt 1B Task 2 — connect+subscribe quá hạn và CÒN TREO. Đánh dấu endpoint bận; khi
   * rốt cuộc settle: kết nối muộn KHÔNG bao giờ thành kết nối hoạt động (mọi lần thử mới trên
   * endpoint này bị chặn trong lúc chờ) ⇒ đóng subscription + hạ driver, rồi giải phóng
   * endpoint. Không ném.
   */
  private reapLateConnect(ep: RuntimeEndpoint, work: Promise<OtSubscriptionHandle>): void {
    const tracker: Promise<void> = work
      .then(
        async (handle) => {
          await this.bounded(Promise.resolve().then(() => handle.close()), "late subscription close");
          await this.safeDisconnect(ep);
        },
        () => undefined, // connect muộn lỗi: driver tự dọn transport của nó
      )
      .finally(() => {
        if (ep.pendingConnect === tracker) ep.pendingConnect = null;
      });
    ep.pendingConnect = tracker;
  }

  /** Forward one sample to ingest; a callback fault never breaks the poll loop. */
  private readonly wrappedOnSample = async (sample: OtSample): Promise<void> => {
    try {
      await this.onSample(sample);
      this.samplesForwarded += 1;
    } catch {
      // swallow — one bad sample must not kill the subscription
    }
  };

  private async closeActiveHandle(): Promise<void> {
    this.phienHoatDong = 0;
    if (this.activeHandle) {
      const h = this.activeHandle;
      this.activeHandle = null;
      // doc 81 Đợt 1B Task 1 — có hạn: subscription treo không kẹt vòng nối lại/stop().
      await this.bounded(Promise.resolve().then(() => h.close()), "subscription close");
    }
  }

  private async safeDisconnect(ep: RuntimeEndpoint): Promise<void> {
    // doc 81 Đợt 1B Task 1 — có hạn: driver.disconnect() treo không kẹt supervisor.
    await this.bounded(Promise.resolve().then(() => ep.driver.disconnect()), "disconnect");
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const timer = setTimeout(() => {
      this.retryTimer = null;
      void this.runReconnect(true);
    }, delayMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.retryTimer = timer;
  }

  /** Exponential backoff with (equal-)jitter, bounded by maxMs. */
  private nextBackoffDelay(): number {
    // SCADA R0: 10 lần đầu của đợt mất nối lại nhanh (≤ max(poll, 500) ms), sau đó backoff lũy thừa như cũ (reconnectNhanh.ts).
    return khoangNoiLaiMs(this.consecutiveFailures, this.pollIntervalMs, (n) => this.expBackoffDelay(n));
  }

  private expBackoffDelay(failures: number): number {
    const { initialMs, maxMs, factor, jitter } = this.backoff;
    const exp = Math.max(0, failures - 1);
    const raw = Math.min(maxMs, initialMs * Math.pow(factor, exp));
    const fixed = raw * (1 - jitter);
    const rand = raw * jitter * Math.random();
    return Math.round(fixed + rand);
  }
}
