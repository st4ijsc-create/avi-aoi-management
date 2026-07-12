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
  type EndpointConfig,
  type BackoffConfig,
  type SupervisorStatus,
} from "./connectionSupervisor";

let running = false;
const active: Array<{ adapter: RuntimeAdapter; handle: OtSubscriptionHandle }> = [];
/** C3: one supervisor per adapter, populated ONLY when OT_CONN_HA_ENABLED. */
const supervisors = new Map<number, { supervisor: ConnectionSupervisor; adapter: RuntimeAdapter }>();

function flagEnabled(): boolean {
  return process.env.OT_GATEWAY_ENABLED === "true";
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
async function makeIngestSink(adapter: RuntimeAdapter): Promise<OnOtSample> {
  const mod = await import("./ingest");
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
  });
}

/**
 * Khởi động OT framework. Trả false nếu flag tắt hoặc không có adapter.
 */
export async function startOt(): Promise<boolean> {
  if (running) return true;
  if (!flagEnabled()) {
    console.log("[OT] disabled (set OT_GATEWAY_ENABLED=true to enable)");
    return false;
  }

  const { loadEnabledAdapters } = await import("./deviceAdapter");

  let adapters: RuntimeAdapter[] = [];
  try {
    adapters = await loadEnabledAdapters();
  } catch (err) {
    console.error("[OT] loadEnabledAdapters failed:", (err as Error)?.message || err);
    return false;
  }

  if (adapters.length === 0) {
    console.log("[OT] no enabled adapters — nothing to start");
    return false;
  }

  // ── C3 HA PATH — supervised connections (reconnect + failover). ─────────────
  if (isConnHaEnabled()) {
    for (const adapter of adapters) {
      try {
        const supervisor = await buildSupervisor(adapter);
        // start() never throws: a failed initial connect schedules a backoff retry
        // rather than crashing the host (preserves the fail-safe behaviour).
        await supervisor.start();
        supervisors.set(adapter.adapterId, { supervisor, adapter });
        const eps = adapter.backupConnection ? 2 : 1;
        console.log(
          `[OT] adapter "${adapter.code}" (${adapter.protocol}) supervised, ${adapter.tags.length} tag(s), ${eps} endpoint(s) — state=${supervisor.status().state}`,
        );
      } catch (err) {
        console.warn(`[OT] adapter "${adapter.code}" (${adapter.protocol}) supervisor skipped: ${(err as Error)?.message || err}`);
      }
    }
    running = true;
    console.log(`[OT] started (HA) — ${supervisors.size}/${adapters.length} adapter(s) supervised`);
    return true;
  }

  // ── LEGACY PATH (OT_CONN_HA_ENABLED off) — single endpoint, exactly as before.
  // R-2a: the ingest sink coalesces each poll tick into ONE multi-row insert when
  // OT_POLL_BATCH_ENABLED (default OFF) is on, while keeping driver.subscribe() intact.
  for (const adapter of adapters) {
    try {
      await adapter.driver.connect(adapter.connection);
      const sink = await makeIngestSink(adapter);
      const handle = await adapter.driver.subscribe(
        adapter.tags,
        sink,
        adapter.pollIntervalMs,
      );
      active.push({ adapter, handle });
      console.log(`[OT] adapter "${adapter.code}" (${adapter.protocol}) started, ${adapter.tags.length} tag(s)`);
    } catch (err) {
      // Protocol chưa triển khai hoặc kết nối lỗi → bỏ qua adapter này, không sập.
      console.warn(`[OT] adapter "${adapter.code}" (${adapter.protocol}) skipped: ${(err as Error)?.message || err}`);
      try {
        await adapter.driver.disconnect();
      } catch {
        // ignore
      }
    }
  }

  running = true;
  console.log(`[OT] started — ${active.length}/${adapters.length} adapter(s) active`);
  return true;
}

/**
 * Dừng OT framework: đóng mọi subscription + disconnect. An toàn gọi nhiều lần.
 */
export async function stopOt(): Promise<void> {
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
    try {
      await entry.handle.close();
    } catch {
      // ignore
    }
    try {
      await entry.adapter.driver.disconnect();
    } catch {
      // ignore
    }
  }
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
