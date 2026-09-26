/**
 * Sprint F1.1 — OT manager: vòng đời start/stop của framework OT.
 *
 * No-op khi OT_GATEWAY_ENABLED !== "true". Khi bật: tải adapter, mỗi adapter
 * try/catch connect + subscribe(ingestSample). Protocol chưa triển khai (connect ném)
 * → log "skipped", KHÔNG sập tiến trình. stopOt đóng mọi handle + disconnect, idempotent.
 *
 * SONG SONG với opcuaGateway.ts cũ (không thay thế, không hồi quy AOI/MQTT).
 *
 * ─── doc 24 Wave-3 / C3 — CONNECTION HA / FAILOVER (additive, flag-gated) ─────
 * When OT_CONN_HA_ENABLED === "true", each adapter is supervised by a
 * ConnectionSupervisor (reconnect w/ exponential backoff + jitter, health state
 * machine, dual-endpoint hot-standby failover). getActiveDriver then resolves the
 * CURRENT active endpoint's driver so commandDispatcher (unchanged) writes to the
 * live connection. When the flag is OFF (the DEFAULT) the legacy single-endpoint
 * path below runs EXACTLY as before — no supervisor is created.
 */
import type { OtSubscriptionHandle, OtDriver, OtSample, OnOtSample, OtQuality } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";
import { createDriver } from "./driverRegistry";
import {
  ConnectionSupervisor,
  DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS,
  type EndpointConfig,
  type BackoffConfig,
  type SupervisorStatus,
} from "./connectionSupervisor";
import { withDeadline } from "./drivers/boundedClose";

let running = false;
/**
 * Adapter legacy ĐÃ TỪNG khởi động được (thứ tự khởi động). doc 81 Đợt 1B Task 2: `handle`
 * là null trong lúc adapter mất kết nối và đang được nối lại (xem LegacyEntry).
 */
const active: Array<{ adapter: RuntimeAdapter; handle: OtSubscriptionHandle | null }> = [];
/** C3: one supervisor per adapter, populated ONLY when OT_CONN_HA_ENABLED. */
const supervisors = new Map<number, { supervisor: ConnectionSupervisor; adapter: RuntimeAdapter }>();

function flagEnabled(): boolean {
  return process.env.OT_GATEWAY_ENABLED === "true";
}

// ─── doc 81 Đợt 1B Task 2 — khởi động KHÔNG BAO GIỜ treo boot ────────────────────
//
// BE1 §0 (3): `await startOt()` chạy trước `server.listen`; vòng khởi động adapter tuần tự,
// một Modbus trỏ cổng không ai nghe treo vô hạn ⇒ HTTP server không bao giờ listen. Nay:
//   • index.ts gọi startOt NỀN sau listen (backgroundStart.ts);
//   • mỗi adapter có hạn khởi động riêng OT_ADAPTER_START_TIMEOUT_MS (connect+subscribe),
//     quá hạn ⇒ 'error' và đi tiếp; kết nối muộn (nếu có) bị hạ, không rò;
//   • adapter khởi động SONG SONG có giới hạn (OT_ADAPTER_START_CONCURRENCY) — adapter chết
//     không chặn adapter khác;
//   • nhánh legacy có vòng NỐI LẠI (OT_LEGACY_RECONNECT_MS, backoff lũy thừa ≤ 60 s): adapter
//     mất kết nối hoặc khởi động lỗi được thử lại — BE1 đo "legacy 0 mẫu sau khi bật lại".

/** Hạn mặc định (ms) cho khởi động MỘT adapter (connect + subscribe). */
export const DEFAULT_OT_ADAPTER_START_TIMEOUT_MS = 10_000;
/** Biên (ms) cho dọn dẹp sau khi khởi động một adapter thất bại (disconnect có hạn). */
export const OT_ADAPTER_START_CLEANUP_GRACE_MS = 1_000;
/** Số adapter khởi động đồng thời tối đa (mặc định). */
export const DEFAULT_OT_ADAPTER_START_CONCURRENCY = 4;
/** Chu kỳ kiểm/nối lại mặc định của nhánh legacy (ms) — cũng là bước backoff đầu. */
export const DEFAULT_OT_LEGACY_RECONNECT_MS = 5_000;
/** Trần backoff nối lại của nhánh legacy (ms). */
export const OT_LEGACY_RECONNECT_MAX_MS = 60_000;

/** Hạn khởi động một adapter (env OT_ADAPTER_START_TIMEOUT_MS, đọc lúc gọi). */
export function adapterStartTimeoutMs(): number {
  return intEnv(process.env.OT_ADAPTER_START_TIMEOUT_MS, DEFAULT_OT_ADAPTER_START_TIMEOUT_MS);
}
/**
 * doc 81 Đợt 1B Task 2 (Fix round 1) — hạn HIỆU LỰC cho một adapter/endpoint: không bao giờ
 * ngắn hơn timeoutMs mà chính adapter cấu hình (+ biên), nếu không một thiết bị chậm hợp lệ
 * (timeoutMs > hạn env) sẽ không bao giờ nối được — mọi lần nối xong muộn đều bị hạ.
 */
export function effectiveAdapterStartTimeoutMs(...conns: Array<{ timeoutMs?: number } | undefined>): number {
  let ms = adapterStartTimeoutMs();
  for (const c of conns) {
    const t = c?.timeoutMs;
    if (typeof t === "number" && Number.isFinite(t) && t > 0) {
      ms = Math.max(ms, t + OT_ADAPTER_START_CLEANUP_GRACE_MS);
    }
  }
  return ms;
}
function adapterStartConcurrency(): number {
  return intEnv(process.env.OT_ADAPTER_START_CONCURRENCY, DEFAULT_OT_ADAPTER_START_CONCURRENCY);
}
function legacyReconnectMs(): number {
  return intEnv(process.env.OT_LEGACY_RECONNECT_MS, DEFAULT_OT_LEGACY_RECONNECT_MS);
}

/** Trạng thái vận hành của một adapter (cả hai nhánh). */
export type OtAdapterRunState = "starting" | "active" | "reconnecting" | "error";

export interface OtAdapterStatus {
  adapterId: number;
  code: string;
  protocol: string;
  mode: "legacy" | "ha";
  state: OtAdapterRunState;
  lastError: string | null;
  /** Số lần thử khởi động/nối (legacy) hoặc số lần connect (HA). */
  attempts: number;
}

/** Bản ghi runtime một adapter nhánh legacy. */
interface LegacyEntry {
  adapter: RuntimeAdapter;
  handle: OtSubscriptionHandle | null;
  state: OtAdapterRunState;
  lastError: string | null;
  attempts: number;
  /** Số lần khởi động/nối lại thất bại liên tiếp (lũy thừa backoff). */
  failures: number;
  nextRetryAt: number;
  /** Một lần khởi động đang chạy (kể cả đã quá hạn mà driver chưa settle) ⇒ không thử chồng. */
  inflight: boolean;
  /** Đã có mặt trong `active` chưa. */
  listed: boolean;
}

const legacy = new Map<number, LegacyEntry>();
let legacyTimer: ReturnType<typeof setInterval> | null = null;
/** Tăng mỗi lần stopOt: mọi công việc khởi động/nối lại của thế hệ cũ tự huỷ khi xong. */
let epoch = 0;
/** startOt đơn chuyến: gọi chồng trong lúc đang khởi động ⇒ nhận cùng promise. */
let startInFlight: Promise<boolean> | null = null;

function errText(err: unknown): string {
  return (err as Error)?.message || String(err);
}

/** Chờ fn() tối đa ms; không bao giờ ném. */
async function boundedQuiet(fn: () => unknown, ms: number, label: string): Promise<void> {
  try {
    await withDeadline(Promise.resolve().then(fn), ms, label);
  } catch {
    // hết hạn hoặc lỗi dọn dẹp — bỏ qua, không giữ vòng khởi động
  }
}

/** Chạy fn cho từng phần tử, tối đa `limit` cái đồng thời. fn không được ném. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Một lần khởi động CÓ HẠN của adapter legacy: connect + subscribe trong adapterStartTimeoutMs,
 * dọn dẹp (disconnect) trong OT_ADAPTER_START_CLEANUP_GRACE_MS. Không bao giờ ném; không bao
 * giờ chờ quá hạn + biên. Kết nối xong MUỘN sau hạn ⇒ bị hạ (đóng subscription + disconnect);
 * entry.inflight giữ tới lúc đó để vòng nối lại không connect chồng lên cùng driver.
 */
async function attemptLegacyStart(entry: LegacyEntry, myEpoch: number): Promise<boolean> {
  const { adapter } = entry;
  const timeoutMs = effectiveAdapterStartTimeoutMs(adapter.connection);
  entry.attempts += 1;
  entry.inflight = true;
  const work = (async (): Promise<OtSubscriptionHandle> => {
    await adapter.driver.connect(adapter.connection);
    const sink = await makeIngestSink(adapter);
    return adapter.driver.subscribe(adapter.tags, sink, adapter.pollIntervalMs);
  })();
  // Cờ settle gắn TRƯỚC withDeadline ⇒ khi work reject đúng hạn, cờ đã bật lúc catch chạy.
  let workSettled = false;
  work.then(
    () => (workSettled = true),
    () => (workSettled = true),
  );

  let handle: OtSubscriptionHandle;
  try {
    handle = await withDeadline(work, timeoutMs, `adapter "${adapter.code}" start`);
  } catch (err) {
    entry.lastError = errText(err);
    if (workSettled) {
      // Lỗi thường (vd ECONNREFUSED, protocol chưa triển khai): dọn như cũ nhưng có hạn.
      await boundedQuiet(() => adapter.driver.disconnect(), OT_ADAPTER_START_CLEANUP_GRACE_MS, "disconnect");
      entry.inflight = false;
    } else {
      // Quá hạn: hạ transport ngay (best-effort, không đợi) và hạ nốt kết nối muộn khi settle.
      void boundedQuiet(() => adapter.driver.disconnect(), DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS, "disconnect");
      void work
        .then(
          async (late) => {
            await boundedQuiet(() => late.close(), DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS, "late close");
            await boundedQuiet(
              () => adapter.driver.disconnect(),
              DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS,
              "late disconnect",
            );
          },
          () => undefined, // connect muộn lỗi: driver tự dọn transport của nó
        )
        .finally(() => {
          entry.inflight = false;
        });
    }
    return false;
  }

  entry.inflight = false;
  if (myEpoch !== epoch) {
    // stopOt đã chạy trong lúc khởi động: không sống lại, hạ ngay kết nối vừa có.
    await boundedQuiet(() => handle.close(), OT_ADAPTER_START_CLEANUP_GRACE_MS, "close");
    await boundedQuiet(() => adapter.driver.disconnect(), OT_ADAPTER_START_CLEANUP_GRACE_MS, "disconnect");
    return false;
  }
  entry.handle = handle;
  entry.state = "active";
  entry.lastError = null;
  entry.failures = 0;
  return true;
}

function listLegacyEntryIfNeeded(entry: LegacyEntry): void {
  if (!entry.listed) {
    entry.listed = true;
    active.push(entry);
  }
}

function legacyRetryDelay(failures: number): number {
  const base = legacyReconnectMs();
  return Math.min(OT_LEGACY_RECONNECT_MAX_MS, base * Math.pow(2, Math.max(0, failures - 1)));
}

/**
 * Một vòng kiểm của nhánh legacy: adapter 'active' mà driver báo mất kết nối ⇒ 'reconnecting'
 * (đóng poll cũ, hạ driver, có hạn); adapter 'error'/'reconnecting' tới hạn thử ⇒ thử khởi động
 * lại có hạn (không chờ trong tick). Log CHỈ ở chuyển trạng thái (mất kết nối / hồi phục),
 * không log mỗi lần thử lại thất bại.
 */
async function legacyTick(myEpoch: number): Promise<void> {
  for (const entry of legacy.values()) {
    if (myEpoch !== epoch) return;
    if (entry.inflight) continue;
    if (entry.state === "active") {
      let up = false;
      try {
        up = entry.adapter.driver.isConnected();
      } catch {
        up = false;
      }
      if (up) continue;
      entry.state = "reconnecting";
      entry.lastError = "driver reported disconnected";
      entry.failures = 0;
      entry.nextRetryAt = 0;
      console.warn(`[OT] adapter "${entry.adapter.code}" (${entry.adapter.protocol}) link lost — reconnecting`);
      const h = entry.handle;
      entry.handle = null;
      entry.inflight = true;
      if (h) await boundedQuiet(() => h.close(), OT_ADAPTER_START_CLEANUP_GRACE_MS, "close");
      await boundedQuiet(() => entry.adapter.driver.disconnect(), OT_ADAPTER_START_CLEANUP_GRACE_MS, "disconnect");
      entry.inflight = false;
      if (myEpoch !== epoch) return;
    }
    if (entry.state === "starting" || Date.now() < entry.nextRetryAt) continue;
    const prevState = entry.state;
    void attemptLegacyStart(entry, myEpoch).then((ok) => {
      if (myEpoch !== epoch) return;
      if (ok) {
        listLegacyEntryIfNeeded(entry);
        console.log(
          `[OT] adapter "${entry.adapter.code}" (${entry.adapter.protocol}) ${prevState === "error" ? "started" : "reconnected"}, ${entry.adapter.tags.length} tag(s)`,
        );
        return;
      }
      entry.state = prevState;
      entry.failures += 1;
      entry.nextRetryAt = Date.now() + legacyRetryDelay(entry.failures);
    });
  }
}

function startLegacyWatchdog(myEpoch: number): void {
  if (legacyTimer) clearInterval(legacyTimer);
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void legacyTick(myEpoch)
      .catch(() => undefined)
      .finally(() => {
        ticking = false;
      });
  }, legacyReconnectMs());
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  legacyTimer = timer;
}

/** C3 master flag — read at call time so tests/operators can toggle it. Default OFF. */
export function isConnHaEnabled(): boolean {
  return process.env.OT_CONN_HA_ENABLED === "true";
}

// ─── C3 config (env-driven; honest defaults) ─────────────────────────────────

function intEnv(v: string | undefined, def: number): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
function numEnv(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function haBackoffFromEnv(): BackoffConfig {
  const jRaw = Number(process.env.OT_CONN_HA_BACKOFF_JITTER);
  const jitter = Number.isFinite(jRaw) && jRaw >= 0 && jRaw <= 1 ? jRaw : 0.5;
  return {
    initialMs: intEnv(process.env.OT_CONN_HA_BACKOFF_MS, 500),
    maxMs: intEnv(process.env.OT_CONN_HA_BACKOFF_MAX_MS, 30_000),
    factor: numEnv(process.env.OT_CONN_HA_BACKOFF_FACTOR, 2),
    jitter,
  };
}

/** Health-poll interval: <= pollInterval so a drop is detected within one cycle. */
function haHealthIntervalMs(pollIntervalMs: number): number {
  const def = intEnv(process.env.OT_CONN_HA_HEALTH_INTERVAL_MS, 2000);
  const poll = pollIntervalMs > 0 ? pollIntervalMs : def;
  return Math.max(50, Math.min(poll, def));
}

/**
 * R-2a (doc 38 P0-D) — is per-tick write-coalescing engaged? Default OFF (opt-in via
 * OT_POLL_BATCH_ENABLED=true). When ON, an adapter's per-sample `onSample` callbacks
 * are coalesced into ONE `ingestSamples()` per poll tick (one multi-row insert instead
 * of one INSERT per tag), collapsing the write-amplification at the source. When OFF
 * the sink is the exact per-sample `ingestSample` path (unchanged). NOTE: the bus-level
 * ring buffer (TELEMETRY_BATCH_ENABLED) coalesces DB writes across ALL adapters even
 * with this flag OFF, so it is the primary throughput lever; this flag additionally
 * batches at the source (fewer bus calls + one UNS republish loop per tick).
 */
function batchPollEnabled(): boolean {
  return process.env.OT_POLL_BATCH_ENABLED === "true";
}

// ─── G1.4 (doc 44 W2-A3) — report-by-exception per tag (deadband + sampling) ───
//
// device_tags (mig 0253) mang 2 field nullable per-tag: `deadband` (numeric —
// chỉ forward khi |value − lastForwarded| ≥ deadband) và `samplingMs` (throttle —
// chỉ forward khi đã qua samplingMs từ lần forward trước). Bộ lọc nằm ở SINK
// (sau driver.subscribe, TRƯỚC ingest/bus) nên driver + đường push OPC-UA giữ
// nguyên. Cờ OT_TAG_DEADBAND_ENABLED (default OFF ⇒ pass-through, hành vi cũ
// byte-for-byte) đọc TẠI MỖI SAMPLE để operator/test bật-tắt runtime.
//
// LUÔN forward (bất kể deadband/sampling) khi: (1) giá trị ĐẦU TIÊN của tag,
// (2) quality ĐỔI so với lần forward trước, (3) giá trị KHÔNG phải number,
// (4) đã quá heartbeat (DEADBAND_HEARTBEAT_MS, default 60s) — giữ liveness để
// downstream (presence/last-seen) không tưởng tag chết. Tag không cấu hình
// deadband/samplingMs → forward mọi sample như cũ.

/** Cờ G1.4 — đọc tại call time (default OFF). */
export function tagDeadbandEnabled(): boolean {
  return process.env.OT_TAG_DEADBAND_ENABLED === "true";
}

/** Heartbeat liveness của bộ lọc deadband (default 60_000ms; env override). */
export const DEADBAND_HEARTBEAT_MS = 60_000;
export function deadbandHeartbeatMs(): number {
  return intEnv(process.env.DEADBAND_HEARTBEAT_MS, DEADBAND_HEARTBEAT_MS);
}

/** Trạng thái forward gần nhất của MỘT tag (in-memory, per sink/adapter). */
interface TagForwardState {
  lastForwardedAt: number;
  lastValue: number | string | boolean | null;
  lastQuality: OtQuality;
}

/** Đếm suppressed/forwarded per adapter (process-lifetime, expose qua stats). */
export interface DeadbandStats {
  adapterId: number;
  code: string;
  forwarded: number;
  suppressed: number;
}

const deadbandStats = new Map<number, DeadbandStats>();

function deadbandStatsFor(adapter: Pick<RuntimeAdapter, "adapterId" | "code">): DeadbandStats {
  let s = deadbandStats.get(adapter.adapterId);
  if (!s) {
    s = { adapterId: adapter.adapterId, code: adapter.code, forwarded: 0, suppressed: 0 };
    deadbandStats.set(adapter.adapterId, s);
  }
  return s;
}

/** Stats bộ lọc deadband của một adapter (undefined nếu chưa có sample nào). */
export function getDeadbandStats(adapterId: number): DeadbandStats | undefined {
  return deadbandStats.get(adapterId);
}

/** Stats bộ lọc deadband của mọi adapter (shallow copies). */
export function listDeadbandStats(): DeadbandStats[] {
  return [...deadbandStats.values()].map((s) => ({ ...s }));
}

/** Chỉ dùng trong test — reset bộ đếm suppressed/forwarded. */
export function _resetDeadbandStatsForTests(): void {
  deadbandStats.clear();
}

/**
 * PURE — quyết định forward/suppress cho MỘT sample. Tách riêng để test không cần
 * driver/DB. Trả true (forward) khi bất kỳ điều kiện LUÔN-forward nào đúng, hoặc
 * khi sample vượt cả sampling-throttle lẫn deadband đã cấu hình.
 */
export function shouldForwardSample(
  cfg: { deadband?: number; samplingMs?: number } | undefined,
  prev: TagForwardState | undefined,
  sample: Pick<OtSample, "value" | "quality">,
  nowMs: number,
  heartbeatMs: number,
): boolean {
  // (1) giá trị đầu tiên — luôn forward (khởi tạo trạng thái downstream).
  if (!prev) return true;
  // (2) quality đổi — luôn forward (good→bad/uncertain là tín hiệu quan trọng).
  if (sample.quality !== prev.lastQuality) return true;
  // (3) kiểu không phải number — deadband vô nghĩa; forward như cũ.
  if (typeof sample.value !== "number") return true;
  const elapsed = nowMs - prev.lastForwardedAt;
  // (4) heartbeat liveness — quá hạn (hoặc clock lùi bất thường) → forward.
  if (elapsed >= heartbeatMs || elapsed < 0) return true;
  // Tag không cấu hình lọc → hành vi cũ (forward mọi sample).
  const hasSampling = cfg?.samplingMs != null && Number.isFinite(cfg.samplingMs) && cfg.samplingMs > 0;
  const hasDeadband = cfg?.deadband != null && Number.isFinite(cfg.deadband) && cfg.deadband > 0;
  if (!hasSampling && !hasDeadband) return true;
  // (a) sampling throttle — chưa qua samplingMs từ lần forward trước → suppress.
  if (hasSampling && elapsed < (cfg!.samplingMs as number)) return false;
  // (b) deadband — |value − lastForwarded| < deadband → suppress. lastValue không
  //     phải number (kiểu vừa đổi) → không tính được delta → forward (fail-open).
  if (hasDeadband && typeof prev.lastValue === "number") {
    if (Math.abs(sample.value - prev.lastValue) < (cfg!.deadband as number)) return false;
  }
  return true;
}

/**
 * Bọc một ingest sink bằng bộ lọc report-by-exception per-tag. State per
 * adapter+tag sống trong closure (mỗi start/subscribe tạo sink mới → state mới).
 * Cờ OFF → gọi thẳng `next` (pass-through, không đếm, không giữ state).
 * Exported cho test (fake timers điều khiển Date.now()).
 */
export function makeDeadbandSink(adapter: RuntimeAdapter, next: OnOtSample): OnOtSample {
  const cfgByTag = new Map(adapter.tags.map((t) => [t.tagKey, t]));
  const state = new Map<string, TagForwardState>();
  return (sample: OtSample) => {
    if (!tagDeadbandEnabled()) return next(sample);
    const now = Date.now();
    const stats = deadbandStatsFor(adapter);
    const forward = shouldForwardSample(
      cfgByTag.get(sample.tagKey),
      state.get(sample.tagKey),
      sample,
      now,
      deadbandHeartbeatMs(),
    );
    if (!forward) {
      stats.suppressed += 1;
      return;
    }
    state.set(sample.tagKey, { lastForwardedAt: now, lastValue: sample.value, lastQuality: sample.quality });
    stats.forwarded += 1;
    return next(sample);
  };
}

/**
 * Build the ingest sink (an `OnOtSample`) for one adapter.
 *
 * The OtDriver contract delivers samples ONE AT A TIME via `onSample` (and the
 * OPC-UA monitored-item PUSH path also emits per-notification), so we keep
 * driver.subscribe() intact (never bypass it — that preserves the real-push option)
 * and coalesce at the SINK: each sample is pushed to a per-adapter buffer and, on the
 * FIRST push of a burst, a `setImmediate` flush is scheduled. Because every real
 * driver's poll tick delivers its whole `readTags()` array synchronously within one
 * event-loop turn (awaiting only microtasks between samples), the setImmediate
 * macrotask fires AFTER the entire tick is buffered → the whole tick is ingested in a
 * SINGLE `ingestSamples()` call. Bursts on the push path coalesce the same way.
 *
 * No sample loss: a scheduled flush always runs (setImmediate is queued before any
 * subsequent poll I/O), and handle.close()/stopOt only clear the driver's interval —
 * a pending setImmediate still fires and drains the final buffer. When batching is
 * OFF the sink is the exact legacy per-sample `ingestSample` call.
 */
/**
 * doc 81 Đợt 1B Task 2 — adapter nay khởi động SONG SONG nên nhiều makeIngestSink gọi cùng lúc:
 * dùng MỘT promise import chung (đo được: dưới vite-node, các import động chồng nhau của cùng
 * module có thể nhận bản khác nhau). Import lỗi ⇒ bỏ nhớ để lần sau thử lại.
 */
let ingestModule: Promise<typeof import("./ingest")> | null = null;
function loadIngest(): Promise<typeof import("./ingest")> {
  if (!ingestModule) {
    ingestModule = import("./ingest");
    ingestModule.catch(() => {
      ingestModule = null;
    });
  }
  return ingestModule;
}

async function makeIngestSink(adapter: RuntimeAdapter): Promise<OnOtSample> {
  const mod = await loadIngest();
  if (!batchPollEnabled()) {
    // Default path — per-sample ingest. Only `ingestSample` is touched (keeps strict
    // test mocks that stub only `ingestSample` working; `ingestSamples` is never read).
    // G1.4: bọc bộ lọc deadband/sampling (pass-through khi OT_TAG_DEADBAND_ENABLED off).
    return makeDeadbandSink(adapter, (sample: OtSample) => mod.ingestSample(adapter, sample));
  }
  const ingestSamples = mod.ingestSamples;
  let buf: OtSample[] = [];
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    if (buf.length === 0) return;
    const batch = buf;
    buf = [];
    // ingestSamples is itself fail-safe (bus never throws); .catch is defensive so a
    // rejected promise can never surface as an unhandled rejection.
    void ingestSamples(adapter, batch).catch((e) =>
      console.error(`[OT] batch ingest failed for "${adapter.code}":`, (e as Error)?.message ?? e),
    );
  };
  // G1.4: bộ lọc chạy TRƯỚC buffer per-tick — sample bị suppress không vào batch.
  return makeDeadbandSink(adapter, (sample: OtSample) => {
    buf.push(sample);
    if (!scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  });
}

/** Build a supervisor for one runtime adapter (primary + optional secondary). */
async function buildSupervisor(adapter: RuntimeAdapter): Promise<ConnectionSupervisor> {
  // Coalescing sink keeps the HA ingest path identical in shape to the legacy loop
  // (per-tick batch when OT_POLL_BATCH_ENABLED, else per-sample).
  const onSample = await makeIngestSink(adapter);
  const endpoints: EndpointConfig[] = [{ label: "primary", connection: adapter.connection }];
  if (adapter.backupConnection) {
    endpoints.push({ label: "secondary", connection: adapter.backupConnection });
  }
  return new ConnectionSupervisor({
    adapterId: adapter.adapterId,
    code: adapter.code,
    protocol: adapter.protocol,
    tags: adapter.tags,
    pollIntervalMs: adapter.pollIntervalMs,
    endpoints,
    machineId: adapter.machineId ?? undefined, // doc 40 MON-F1 — bật presence push online/offline từ supervisor
    createDriver: () => createDriver(adapter.protocol),
    onSample,
    healthIntervalMs: haHealthIntervalMs(adapter.pollIntervalMs),
    backoff: haBackoffFromEnv(),
    // doc 81 Đợt 1B Task 2 (R8) — một lần connect+subscribe không giữ quá hạn khởi động.
    // Fix round 1 — supervisor tự nâng hạn theo timeoutMs của từng endpoint (connectDeadlineFor).
    connectTimeoutMs: adapterStartTimeoutMs(),
  });
}

/**
 * Khởi động OT framework. Trả false nếu flag tắt hoặc không có adapter.
 *
 * doc 81 Đợt 1B Task 2 — mỗi adapter có hạn khởi động riêng (OT_ADAPTER_START_TIMEOUT_MS,
 * mặc định 10000) và các adapter khởi động song song có giới hạn, nên startOt trả về trong
 * khoảng ⌈n / concurrency⌉ × (hạn + biên dọn dẹp) — không bao giờ treo vì một thiết bị.
 * Gọi chồng trong lúc đang khởi động ⇒ nhận cùng promise (không khởi động hai lần).
 */
export async function startOt(): Promise<boolean> {
  if (running) return true;
  if (startInFlight) return startInFlight;
  const p = startOtOnce();
  startInFlight = p;
  try {
    return await p;
  } finally {
    if (startInFlight === p) startInFlight = null;
  }
}

async function startOtOnce(): Promise<boolean> {
  if (!flagEnabled()) {
    console.log("[OT] disabled (set OT_GATEWAY_ENABLED=true to enable)");
    return false;
  }
  const myEpoch = epoch;

  const { loadEnabledAdapters } = await import("./deviceAdapter");

  let adapters: RuntimeAdapter[] = [];
  try {
    adapters = await loadEnabledAdapters();
  } catch (err) {
    console.error("[OT] loadEnabledAdapters failed:", (err as Error)?.message || err);
    return false;
  }
  // Fix round 1 — stopOt (+ startOt mới) chạy trong lúc nạp: lượt cũ dừng NGAY, không ghi đè
  // entry/supervisor của thế hệ mới.
  if (myEpoch !== epoch) return false;

  if (adapters.length === 0) {
    console.log("[OT] no enabled adapters — nothing to start");
    return false;
  }

  const concurrency = adapterStartConcurrency();

  // ── C3 HA PATH — supervised connections (reconnect + failover). ─────────────
  if (isConnHaEnabled()) {
    await runWithConcurrency(adapters, concurrency, async (adapter) => {
      try {
        const supervisor = await buildSupervisor(adapter);
        // start() never throws: a failed initial connect schedules a backoff retry
        // rather than crashing the host (preserves the fail-safe behaviour).
        // doc 81 Đợt 1B Task 2 — lớp NGOÀI có hạn: supervisor đã tự giới hạn connect (R8),
        // nhưng otManager không phụ thuộc điều đó; quá hạn ⇒ supervisor tiếp tục thử NỀN.
        try {
          await withDeadline(
            supervisor.start(),
            effectiveAdapterStartTimeoutMs(adapter.connection, adapter.backupConnection) +
              OT_ADAPTER_START_CLEANUP_GRACE_MS,
            `adapter "${adapter.code}" supervisor start`,
          );
        } catch (err) {
          console.warn(
            `[OT] adapter "${adapter.code}" (${adapter.protocol}) start: ${errText(err)} — supervisor keeps retrying in background`,
          );
        }
        if (myEpoch !== epoch) {
          // stopOt chạy trong lúc khởi động: không đăng ký, hạ supervisor vừa dựng.
          await supervisor.stop().catch(() => undefined);
          return;
        }
        // Đăng ký NGAY (dispatcher thấy adapter đã nối trong lúc adapter khác còn khởi động).
        supervisors.set(adapter.adapterId, { supervisor, adapter });
        const eps = adapter.backupConnection ? 2 : 1;
        console.log(
          `[OT] adapter "${adapter.code}" (${adapter.protocol}) supervised, ${adapter.tags.length} tag(s), ${eps} endpoint(s) — state=${supervisor.status().state}`,
        );
      } catch (err) {
        console.warn(`[OT] adapter "${adapter.code}" (${adapter.protocol}) supervisor skipped: ${(err as Error)?.message || err}`);
      }
    });
    if (myEpoch !== epoch) return false;
    // Giữ thứ tự đăng ký theo thứ tự adapter (như vòng tuần tự cũ).
    for (const a of adapters) {
      const e = supervisors.get(a.adapterId);
      if (e) {
        supervisors.delete(a.adapterId);
        supervisors.set(a.adapterId, e);
      }
    }
    running = true;
    console.log(`[OT] started (HA) — ${supervisors.size}/${adapters.length} adapter(s) supervised`);
    return true;
  }

  // ── LEGACY PATH (OT_CONN_HA_ENABLED off) — single endpoint, no supervisor.
  // R-2a: the ingest sink coalesces each poll tick into ONE multi-row insert when
  // OT_POLL_BATCH_ENABLED (default OFF) is on, while keeping driver.subscribe() intact.
  // doc 81 Đợt 1B Task 2 — mỗi adapter có hạn, song song có giới hạn; adapter lỗi ⇒ 'error'
  // và vòng nối lại legacy thử lại (backoff) thay vì bỏ vĩnh viễn.
  const entries: LegacyEntry[] = adapters.map((adapter) => ({
    adapter,
    handle: null,
    state: "starting",
    lastError: null,
    attempts: 0,
    failures: 0,
    nextRetryAt: 0,
    inflight: false,
    listed: false,
  }));
  for (const e of entries) legacy.set(e.adapter.adapterId, e);

  await runWithConcurrency(entries, concurrency, async (entry) => {
    const { adapter } = entry;
    const ok = await attemptLegacyStart(entry, myEpoch);
    if (myEpoch !== epoch) return;
    if (ok) {
      // Đăng ký NGAY (dispatcher thấy adapter đã nối trong lúc adapter khác còn khởi động).
      listLegacyEntryIfNeeded(entry);
      console.log(`[OT] adapter "${adapter.code}" (${adapter.protocol}) started, ${adapter.tags.length} tag(s)`);
      return;
    }
    // Protocol chưa triển khai hoặc kết nối lỗi/quá hạn → adapter này 'error', không sập.
    entry.state = "error";
    entry.failures = 1;
    entry.nextRetryAt = Date.now() + legacyRetryDelay(1);
    console.warn(`[OT] adapter "${adapter.code}" (${adapter.protocol}) skipped: ${entry.lastError}`);
  });

  if (myEpoch !== epoch) return false;
  // Giữ thứ tự `active` theo thứ tự adapter (như vòng tuần tự cũ).
  const order = new Map(entries.map((e, i) => [e.adapter.adapterId, i]));
  active.sort((a, b) => (order.get(a.adapter.adapterId) ?? 0) - (order.get(b.adapter.adapterId) ?? 0));
  startLegacyWatchdog(myEpoch);

  running = true;
  console.log(`[OT] started — ${active.length}/${adapters.length} adapter(s) active`);
  return true;
}

/**
 * Dừng OT framework: đóng mọi subscription + disconnect. An toàn gọi nhiều lần.
 * doc 81 Đợt 1B Task 2 — mỗi lời gọi hạ kết nối có hạn; khởi động/nối lại đang chạy của thế
 * hệ cũ tự huỷ khi xong (epoch).
 */
export async function stopOt(): Promise<void> {
  epoch += 1;
  startInFlight = null;
  if (legacyTimer) {
    clearInterval(legacyTimer);
    legacyTimer = null;
  }
  // C3 supervisors first (each stop() is idempotent + non-throwing).
  for (const { supervisor } of supervisors.values()) {
    try {
      await supervisor.stop();
    } catch {
      // ignore
    }
  }
  supervisors.clear();

  while (active.length > 0) {
    const entry = active.pop()!;
    const h = entry.handle;
    entry.handle = null;
    if (h) await boundedQuiet(() => h.close(), DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS, "close");
    await boundedQuiet(() => entry.adapter.driver.disconnect(), DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS, "disconnect");
  }
  legacy.clear();
  running = false;
}

export function isOtRunning(): boolean {
  return running;
}

// ─── Sprint F4a — read-only accessors over the private `active` set ───────────
// Used by commandDispatcher to resolve a connected driver for an adapter. These
// expose NO mutation of the start/stop lifecycle; `active` stays private.
//
// C3: when HA is on and a supervisor exists for the adapter, these delegate to
// the supervisor so the CURRENT active endpoint (primary or promoted secondary)
// is resolved. The dispatcher's gates + single-dispatch invariant are untouched —
// it still calls getActiveDriver() and treats undefined as ADAPTER_OFFLINE.

/** The runtime adapter currently active for `adapterId`, or undefined. */
export function getActiveAdapter(adapterId: number): RuntimeAdapter | undefined {
  const sup = supervisors.get(adapterId);
  if (sup) return sup.adapter;
  return active.find((e) => e.adapter.adapterId === adapterId)?.adapter;
}

/**
 * The connected driver for `adapterId`. Returns undefined when the adapter is not
 * active or its driver is not currently connected (caller treats as ADAPTER_OFFLINE).
 */
export function getActiveDriver(adapterId: number): OtDriver | undefined {
  const sup = supervisors.get(adapterId);
  if (sup) return sup.supervisor.getActiveDriver();
  const entry = active.find((e) => e.adapter.adapterId === adapterId);
  if (!entry) return undefined;
  const driver = entry.adapter.driver;
  return driver.isConnected() ? driver : undefined;
}

/** Snapshot of the currently-active runtime adapters (shallow copy). */
export function listActiveAdapters(): RuntimeAdapter[] {
  if (supervisors.size > 0) {
    return [...supervisors.values()].map((e) => e.adapter);
  }
  return active.map((e) => e.adapter);
}

// ─── C3 — supervisor status getters (for a FUTURE health endpoint; no route) ──

/** Status snapshot for one supervised adapter, or undefined when not supervised. */
export function getSupervisorStatus(adapterId: number): SupervisorStatus | undefined {
  return supervisors.get(adapterId)?.supervisor.status();
}

/** Status snapshots for all supervised adapters (empty when HA off / none). */
export function listSupervisorStatuses(): SupervisorStatus[] {
  return [...supervisors.values()].map((e) => e.supervisor.status());
}

// ─── doc 81 Đợt 1B Task 2 — trạng thái từng adapter (cả legacy lẫn HA) ─────────

function haRunState(st: SupervisorStatus): OtAdapterRunState {
  switch (st.state) {
    case "connected":
      return "active";
    case "reconnecting":
      return "reconnecting";
    case "idle":
    case "connecting":
      return "starting";
    default:
      return "error"; // failed | stopped
  }
}

/** Trạng thái một adapter (undefined nếu OT không quản adapter này). */
export function getOtAdapterStatus(adapterId: number): OtAdapterStatus | undefined {
  const sup = supervisors.get(adapterId);
  if (sup) {
    const st = sup.supervisor.status();
    return {
      adapterId,
      code: st.code,
      protocol: st.protocol,
      mode: "ha",
      state: haRunState(st),
      lastError: st.lastError,
      attempts: st.attempts,
    };
  }
  const e = legacy.get(adapterId);
  if (!e) return undefined;
  return {
    adapterId,
    code: e.adapter.code,
    protocol: e.adapter.protocol,
    mode: "legacy",
    state: e.state,
    lastError: e.lastError,
    attempts: e.attempts,
  };
}

/** Trạng thái mọi adapter OT đang quản. */
export function listOtAdapterStatuses(): OtAdapterStatus[] {
  const ids = [...supervisors.keys(), ...legacy.keys()];
  return ids.map((id) => getOtAdapterStatus(id)).filter((x): x is OtAdapterStatus => !!x);
}
