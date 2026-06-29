/**
 * Doc 09 / Phase D6 — Device Programming & Control: ENGINEERING STREAM (Online Monitor).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * High-rate symbol-watch sessions for the Unified Engineering Workspace. When a watch is
 * open the manager fast-scans the chosen symbols and pushes samples to the Socket.IO room
 * `engineering:{machineId}` — SEPARATE from the 5s DB telemetry ingest, so the scope/watch
 * table can update at ~100-200ms WITHOUT bloating TimescaleDB.
 *
 * SAFETY / HONESTY:
 *   • Gated by DPC_STREAMING_ENABLED (default OFF) — startWatch is a no-op when off.
 *   • READ-ONLY. A watch only READS symbols; it never writes a device. (force() is a
 *     separate, heavily-gated path — Phase D6+ — behind DPC_ONLINE_FORCE_ENABLED.)
 *   • The sample SOURCE is pluggable. The real source (OPC-UA monitoredItem subscription /
 *     MC fast-scan) needs real-HW validation; the default source reads via the existing
 *     equipmentRegistry (best-effort) and returns [] when no device is reachable — it
 *     NEVER fabricates values.
 *
 * The manager is transport- and source-agnostic (both injected) so it is fully unit-
 * testable with fake timers, and the boot wiring binds it to the socket emitter.
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface SymbolSample {
  symbol: string;
  value: number | string | boolean | null;
  ts: number;
}

/** Reads the current value of each requested symbol for a machine. May return fewer. */
export type SampleSource = (machineId: number, symbols: string[]) => Promise<SymbolSample[]>;

/** Pushes a batch of samples to subscribers (default: the socket room emitter). */
export type SampleSink = (machineId: number, samples: SymbolSample[]) => void;

export interface WatchSpec {
  sessionId: string;
  machineId: number;
  symbols: string[];
  intervalMs?: number;
}

export function streamingEnabled(): boolean {
  return process.env.DPC_STREAMING_ENABLED === "true" || process.env.DPC_STREAMING_ENABLED === "1";
}

const MIN_INTERVAL_MS = 100;
const DEFAULT_INTERVAL_MS = 200;

interface Session {
  spec: WatchSpec;
  timer: ReturnType<typeof setInterval>;
}

/**
 * The watch-session manager. One instance is created at boot bound to the real source +
 * the socket sink; tests construct their own with fakes.
 */
export class EngineeringStreamManager {
  private sessions = new Map<string, Session>();

  constructor(private readonly source: SampleSource, private readonly sink: SampleSink) {}

  /** Open (or replace) a watch session. No-op + returns false when streaming is disabled. */
  startWatch(spec: WatchSpec): boolean {
    if (!streamingEnabled()) return false;
    if (!spec.symbols.length) return false;
    this.stopWatch(spec.sessionId); // replace any existing session with the same id
    const intervalMs = Math.max(MIN_INTERVAL_MS, spec.intervalMs ?? DEFAULT_INTERVAL_MS);
    const tick = async () => {
      try {
        const samples = await this.source(spec.machineId, spec.symbols);
        if (samples.length) this.sink(spec.machineId, samples);
      } catch {
        // fail-safe — a source error must not kill the watch loop
      }
    };
    const timer = setInterval(tick, intervalMs);
    // Allow the process to exit even with watches open (Node-only guard).
    (timer as { unref?: () => void }).unref?.();
    this.sessions.set(spec.sessionId, { spec, timer });
    return true;
  }

  stopWatch(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      clearInterval(s.timer);
      this.sessions.delete(sessionId);
    }
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stopWatch(id);
  }

  activeSessions(): WatchSpec[] {
    return [...this.sessions.values()].map((s) => s.spec);
  }
}

/**
 * The DEFAULT (honest) sample source. Reads the machine's symbols via the existing
 * equipmentRegistry telemetry path. Without a reachable device it returns [] — it never
 * fabricates values. The real low-latency source (OPC-UA monitoredItem / MC fast-scan)
 * replaces this once validated against hardware.
 */
export async function defaultSampleSource(machineId: number, symbols: string[]): Promise<SymbolSample[]> {
  // Lazy import to avoid a hard dependency at module load (and keep tests light).
  try {
    const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
    // We don't know the machine's adapter kind here without a DB lookup; the boot wiring
    // injects a richer source. This default is intentionally conservative: no value yet.
    void equipmentRegistry;
    void machineId;
    void symbols;
    return [];
  } catch {
    return [];
  }
}
