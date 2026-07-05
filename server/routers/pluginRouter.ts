/**
 * Plugin tRPC router — SYNAPSE ADR-008 (doc 33 F2). READ-ONLY.
 *
 * Exposes the plugin manifest catalogue + the Plugin API version so the Setup Wizard can
 * list available connectors and AUTO-GENERATE a config form from each manifest's JSON-Schema
 * (SYNAPSE §6.4.4). No mutations: plugins are installed via deployment/registry, not an API call.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { PLUGIN_API_VERSION, satisfiesApiVersion } from "@shared/plugin/manifest";
// Importing the subsystem seeds the first-party manifests (register-and-go).
import { listPlugins, getPlugin, listPluginsByKind } from "../services/plugins";

export const pluginRouter = router({
  /** Current Plugin API version the core implements. */
  apiVersion: protectedProcedure.query(() => ({ apiVersion: PLUGIN_API_VERSION })),

  /** All registered plugin manifests (summary; omit the verbose configSchema). */
  list: protectedProcedure.query(() =>
    listPlugins().map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      kind: m.kind,
      protocols: m.protocols ?? [],
      hasConfigSchema: !!m.configSchema,
      permissions: m.permissions ?? null,
      signaturePresent: !!m.signaturePresent,
      apiCompatible: satisfiesApiVersion(m.apiVersion, PLUGIN_API_VERSION),
      description: m.description ?? null,
    })),
  ),

  /** Manifests of a given kind (device-connector, robot-adapter, …). */
  listByKind: protectedProcedure
    .input(z.object({ kind: z.string().min(1) }))
    .query(({ input }) => listPluginsByKind(input.kind as never)),

  /** Full manifest incl. the JSON-Schema config surface — the wizard builds a form from this. */
  get: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) => {
    const m = getPlugin(input.id);
    if (!m) return { found: false as const, manifest: null, configSchema: null };
    return { found: true as const, manifest: m, configSchema: m.configSchema ?? null };
  }),
});
