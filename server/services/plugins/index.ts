/**
 * Plugin subsystem entry — SYNAPSE ADR-008 (doc 33 F2). Register-and-go.
 *
 * Importing this module seeds the first-party plugin manifests into the registry. This is
 * pure metadata (no control path, no behavior change), so it is safe to load at boot. The
 * apiVersion gate runs on each registration; a manifest that fails is skipped with a warning
 * (bulk seed must not abort the rest).
 */
import { tryRegisterPlugin, listPlugins } from "./pluginRegistry";
import { buildOtConnectorManifests } from "./otConnectorManifests";

let seeded = false;

/** Seed built-in manifests once. Idempotent. Returns the number registered. */
export function seedBuiltinPlugins(): number {
  if (seeded) return listPlugins().length;
  seeded = true;
  for (const m of buildOtConnectorManifests()) {
    const res = tryRegisterPlugin(m);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[plugins] skipped seed manifest "${m.id}": ${res.errors.join("; ")}`);
    }
  }
  return listPlugins().length;
}

// Seed at import (metadata-only, non-breaking).
seedBuiltinPlugins();

export * from "./pluginRegistry";
export { zodToConfigForm } from "./configForm";
