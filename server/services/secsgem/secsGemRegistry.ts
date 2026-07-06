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
 * W2-C (doc 35 D7) — HONEST health/status surface for SECS/GEM.
 *
 * `SECS_GEM_ENABLED` can be true, but this module is a CONNECT/TEST framework with NO
 * live message-dispatch loop and NO alarm/data ingestion (no S6F11/CEID→DB, no S5 alarm
 * capture). This getter makes that explicit so operators are NOT misled that enabling the
 * flag ingests data. It fakes no capability: `liveIngest` is hard-false and `mode` is
 * "framework-only". Safe (no I/O) — mirror of storeForward.getStatus()/ot health getters.
 */
export interface SecsGemHealth {
  /** Master flag state (SECS_GEM_ENABLED). */
  enabled: boolean;
  /** Always "framework-only" — a connect/probe skeleton, not a production driver. */
  mode: "framework-only";
  /**
   * Hard-false: there is NO background loop consuming S6F11 events / S5 alarms into the
   * DB. Enabling the flag permits on-demand connect/Select/Linktest/probe ONLY.
   */
  liveIngest: false;
  /** Registered connectivity keys (no I/O). */
  connectors: string[];
  /** Human-readable note for operators / health dashboards. */
  note: string;
}

/** Honest health snapshot for a SECS/GEM status endpoint / health card. No I/O. */
export function getSecsGemHealth(): SecsGemHealth {
  return {
    enabled: isSecsGemEnabled(),
    mode: "framework-only",
    liveIngest: false,
    connectors: listSecsGemKeys(),
    note:
      "Connect/test framework only — HSMS Select/Linktest + on-demand S1F1/S1F13/S1F17 " +
      "probes. There is NO live alarm/data ingestion (no S6F11/CEID→DB, no S5 alarms). " +
      "Enabling SECS_GEM_ENABLED does NOT populate telemetry or alarms; a real, validated " +
      "SECS driver is required for production data collection.",
  };
}
