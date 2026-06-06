/**
 * Sprint F1.1 — OT manager: vòng đời start/stop của framework OT.
 *
 * No-op khi OT_GATEWAY_ENABLED !== "true". Khi bật: tải adapter, mỗi adapter
 * try/catch connect + subscribe(ingestSample). Protocol chưa triển khai (connect ném)
 * → log "skipped", KHÔNG sập tiến trình. stopOt đóng mọi handle + disconnect, idempotent.
 *
 * SONG SONG với opcuaGateway.ts cũ (không thay thế, không hồi quy AOI/MQTT).
 */
import type { OtSubscriptionHandle, OtDriver } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";

let running = false;
const active: Array<{ adapter: RuntimeAdapter; handle: OtSubscriptionHandle }> = [];

function flagEnabled(): boolean {
  return process.env.OT_GATEWAY_ENABLED === "true";
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
  const { ingestSample } = await import("./ingest");

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

/** The runtime adapter currently active for `adapterId`, or undefined. */
export function getActiveAdapter(adapterId: number): RuntimeAdapter | undefined {
  return active.find((e) => e.adapter.adapterId === adapterId)?.adapter;
}

/**
 * The connected driver for `adapterId`. Returns undefined when the adapter is not
 * active or its driver is not currently connected (caller treats as ADAPTER_OFFLINE).
 */
export function getActiveDriver(adapterId: number): OtDriver | undefined {
  const entry = active.find((e) => e.adapter.adapterId === adapterId);
  if (!entry) return undefined;
  const driver = entry.adapter.driver;
  return driver.isConnected() ? driver : undefined;
}

/** Snapshot of the currently-active runtime adapters (shallow copy). */
export function listActiveAdapters(): RuntimeAdapter[] {
  return active.map((e) => e.adapter);
}
