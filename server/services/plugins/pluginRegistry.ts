/**
 * Plugin registry (Hub side) — SYNAPSE ADR-008 (doc 33 §3.2 / F2).
 *
 * Register-and-go registry of plugin MANIFESTS, mirroring the data-driven pattern of
 * ot/driverRegistry & module-registry. On registration the Hub runs the `apiVersion`
 * compatibility GATE (SYNAPSE §6.4.4): a manifest whose range excludes the current
 * Plugin API is REJECTED with a clear reason — never "run blind".
 *
 * F2 is in-process & non-breaking: this catalogues manifests + drives the auto-generated
 * setup form + a CI conformance gate. It does NOT change how existing adapters run.
 * Out-of-process isolation + signing enforcement come in F3+.
 */
import {
  validateManifest,
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginKind,
} from "@shared/plugin/manifest";

const registry = new Map<string, PluginManifest>();

export class PluginRejectedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly reasons: string[],
  ) {
    super(`Plugin "${pluginId}" rejected: ${reasons.join("; ")}`);
    this.name = "PluginRejectedError";
  }
}

/**
 * Register (or replace) a plugin manifest. Throws PluginRejectedError if the manifest fails
 * validation or the apiVersion gate. `requireSignature` defaults to production.
 */
export function registerPlugin(
  manifest: PluginManifest,
  opts: { requireSignature?: boolean } = {},
): void {
  const requireSignature = opts.requireSignature ?? process.env.NODE_ENV === "production";
  const res = validateManifest(manifest, { current: PLUGIN_API_VERSION, requireSignature });
  if (!res.ok) throw new PluginRejectedError(manifest?.id ?? "(unknown)", res.errors);
  registry.set(manifest.id, manifest);
}

/**
 * Try to register; returns the validation result instead of throwing (for bulk/seed loads
 * where one bad plugin must not abort the rest).
 */
export function tryRegisterPlugin(
  manifest: PluginManifest,
  opts: { requireSignature?: boolean } = {},
): { ok: boolean; errors: string[] } {
  const requireSignature = opts.requireSignature ?? process.env.NODE_ENV === "production";
  const res = validateManifest(manifest, { current: PLUGIN_API_VERSION, requireSignature });
  if (res.ok) registry.set(manifest.id, manifest);
  return res;
}

export function getPlugin(id: string): PluginManifest | undefined {
  return registry.get(id);
}

export function listPlugins(): PluginManifest[] {
  return [...registry.values()];
}

export function listPluginsByKind(kind: PluginKind): PluginManifest[] {
  return [...registry.values()].filter((m) => m.kind === kind);
}

/** Test-only: clear the registry. */
export function _clearPluginRegistry(): void {
  registry.clear();
}
