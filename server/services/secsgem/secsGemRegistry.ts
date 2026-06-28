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
