/**
 * SECS/GEM Connectivity FRAMEWORK — connectivity registry.
 *
 * Mirrors server/services/ot/driverRegistry.ts: a name → factory map for SECS/GEM
 * connectivity entries. The framework registers a single "secsgem" entry whose
 * factory builds an HsmsClient + GemModel for a configured equipment. This is the
 * seam where a real, validated SECS library would later plug in.
 *
 * FLAG-GATED: isSecsGemEnabled() reads SECS_GEM_ENABLED (default OFF). No real
 * connection is ever opened unless the flag is true AND the caller supplies a
 * host/port. listConfigured()/the registry itself are always safe (no I/O).
 */
import { HsmsClient, type HsmsConfig } from "./hsmsClient";
import { GemModel, type GemConfig } from "./gemModel";

/** Master flag — default OFF. */
export function isSecsGemEnabled(): boolean {
  return process.env.SECS_GEM_ENABLED === "true";
}

/** Live-dispatch sub-flag — default OFF. Gates the inbound S5F1/S6F11 loop. */
export function isSecsGemLiveEnabled(): boolean {
  return process.env.SECS_GEM_LIVE_ENABLED === "true";
}

/** A built connectivity entry: an HSMS client + the GEM equipment model. */
export interface SecsGemConnector {
  readonly key: string;
  readonly hsms: HsmsClient;
  readonly gem: GemModel;
}

/** Factory: build a connector from HSMS + GEM config. Opens NOTHING (lazy). */
export type SecsGemFactory = (hsms: HsmsConfig, gem: GemConfig) => SecsGemConnector;

const registry = new Map<string, SecsGemFactory>();

/** Register a connectivity factory (overwrites if present). */
export function registerSecsGem(key: string, factory: SecsGemFactory): void {
  registry.set(key, factory);
}

/** Build a connector for a registered key. Throws if the key is unknown. */
export function createSecsGem(key: string, hsms: HsmsConfig, gem: GemConfig): SecsGemConnector {
  const factory = registry.get(key);
  if (!factory) throw new Error(`No SECS/GEM connector registered for key "${key}"`);
  return factory(hsms, gem);
}

/** List registered connectivity keys. */
export function listSecsGemKeys(): string[] {
  return [...registry.keys()];
}

/** Clear the registry — test-only. */
export function _clearSecsGemRegistry(): void {
  registry.clear();
}

/** The built-in skeleton connector factory. */
export const createSkeletonSecsGem: SecsGemFactory = (hsms, gem) => ({
  key: "secsgem",
  hsms: new HsmsClient(hsms),
  gem: new GemModel(gem),
});

/**
 * W2-C (doc 35 D7) + doc 37 P0-6 — HONEST health/status surface for SECS/GEM.
 *
 * `SECS_GEM_ENABLED` alone is still a CONNECT/TEST framework. doc 37 P0-6 adds an
 * OPTIONAL, separately-gated inbound message-dispatch loop (SECS_GEM_LIVE_ENABLED)
 * that decodes UNSOLICITED S5F1 alarms / S6F11 events and acks them; S5F1 alarms
 * reach the Andon board only when EQ_INTEG_ENABLED is ALSO on. This getter reports
 * both flags honestly rather than pretending: `mode` becomes "live-dispatch" only
 * when the live flag is on, and `liveIngest` reflects the actual (flag-derived)
 * capability — it is NOT faked. Still no S6F11→process_results DB writer is claimed
 * (that seam is left to the caller's onEvent sink). Safe (no I/O).
 */
export interface SecsGemHealth {
  /** Master flag state (SECS_GEM_ENABLED). */
  enabled: boolean;
  /** Live-dispatch sub-flag state (SECS_GEM_LIVE_ENABLED). */
  liveDispatchEnabled: boolean;
  /** "framework-only" (connect/probe skeleton) or "live-dispatch" (loop armed). */
  mode: "framework-only" | "live-dispatch";
  /**
   * Whether the live S5F1-alarm / S6F11-event dispatch loop is ENABLED by flags.
   * true ⇔ SECS_GEM_ENABLED && SECS_GEM_LIVE_ENABLED. NOTE: even when true, an S5F1
   * alarm only reaches the Andon path when EQ_INTEG_ENABLED is also on, and no
   * S6F11→DB writer is provided (events go to the caller's onEvent sink).
   */
  liveIngest: boolean;
  /** Registered connectivity keys (no I/O). */
  connectors: string[];
  /** Human-readable note for operators / health dashboards. */
  note: string;
}

/** Honest health snapshot for a SECS/GEM status endpoint / health card. No I/O. */
export function getSecsGemHealth(): SecsGemHealth {
  const live = isSecsGemEnabled() && isSecsGemLiveEnabled();
  return {
    enabled: isSecsGemEnabled(),
    liveDispatchEnabled: isSecsGemLiveEnabled(),
    mode: live ? "live-dispatch" : "framework-only",
    liveIngest: live,
    connectors: listSecsGemKeys(),
    note: live
      ? "Live-dispatch loop ARMED (SECS_GEM_LIVE_ENABLED): an established HSMS session " +
        "decodes UNSOLICITED S5F1 alarms (→ raiseFromGemAlarm/E1 taxonomy → Andon, only " +
        "when EQ_INTEG_ENABLED is also on) and S6F11 events (→ caller onEvent sink) and " +
        "acks S5F2/S6F12. Still MVP best-effort — NOT certified E30, no S6F11→DB writer, " +
        "no report-linking-aware decode; validate against real equipment."
      : "Connect/test framework only — HSMS Select/Linktest + on-demand S1F1/S1F13/S1F17 " +
        "probes. The inbound alarm/event dispatch loop is OFF (set SECS_GEM_LIVE_ENABLED=true " +
        "on top of SECS_GEM_ENABLED to arm it). With it off there is NO S6F11/S5F1 ingestion; " +
        "enabling SECS_GEM_ENABLED alone does NOT populate telemetry or alarms.",
  };
}
