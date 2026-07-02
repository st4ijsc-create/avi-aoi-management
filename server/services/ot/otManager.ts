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
import type { OtSubscriptionHandle, OtDriver, OtSample } from "./otDriver";
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

/** Build a supervisor for one runtime adapter (primary + optional secondary). */
function buildSupervisor(adapter: RuntimeAdapter): ConnectionSupervisor {
  // Lazy import keeps the ingest path identical to the legacy loop.
  const onSample = async (sample: OtSample): Promise<void> => {
    const { ingestSample } = await import("./ingest");
    await ingestSample(adapter, sample);
  };
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
        const supervisor = buildSupervisor(adapter);
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
  const { ingestSample } = await import("./ingest");
  for (const adapter of adapters) {
    try {
      await adapter.driver.connect(adapter.connection);
      const handle = await adapter.driver.subscribe(
        adapter.tags,
        (sample) => ingestSample(adapter, sample),
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
