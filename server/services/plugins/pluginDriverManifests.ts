/**
 * Plugin device-connector manifests carrying a SIDECAR command — doc 37 P0-4 (SYNAPSE ADR-008).
 *
 * The manifest registry (pluginRegistry) catalogues pure metadata; the shared PluginManifest
 * contract deliberately has NO runtime "how to spawn" field. This module bridges that gap for the
 * OUT-OF-PROCESS device-connector case: it parses operator-declared plugin drivers from the
 * `PLUGIN_DRIVERS` env (a JSON array) into `PluginDriverManifest` = a valid PluginManifest PLUS a
 * `sidecar` command + the `SignedPlugin` fields the spawn-time signature gate needs.
 *
 * This is the "thêm hãng = 1 plugin" surface: declaring one JSON entry (id/protocol/command)
 * registers a whole new OT driver when PLUGIN_DRIVERS_ENABLED is on — no change to the OT core.
 * Pure parsing (no I/O beyond reading env); invalid entries are skipped with a warning, never throw.
 */
import type { PluginManifest } from "@shared/plugin/manifest";
import type { SignedPlugin } from "./sidecar/pluginSignature";

/** A device-connector manifest that additionally knows how to spawn its sidecar. */
export interface PluginDriverManifest extends PluginManifest {
  kind: "device-connector";
  /** The out-of-process command the bridge supervises + speaks JSON-lines RPC to. */
  sidecar: { command: string; args: string[] };
  /** Identity/version/artifact-hash (+ optional signature) the spawn-time gate verifies. */
  signed: SignedPlugin;
}

/** Type guard: a catalogued manifest that carries a runnable sidecar command. */
export function hasSidecar(m: PluginManifest): m is PluginDriverManifest {
  const s = (m as Partial<PluginDriverManifest>).sidecar;
  return !!s && typeof s.command === "string" && s.command.length > 0;
}

/**
 * Parse `PLUGIN_DRIVERS` (JSON array) into driver manifests. Each entry needs at least
 * `{ id, protocol, command }`; optional `name, version, apiVersion, args, description,
 * artifactSha256, signature, signaturePresent`. Malformed JSON / entries are skipped (warn), so a
 * single bad line never blocks the rest. Returns [] when the env is unset/empty.
 */
export function parsePluginDriverManifests(env: NodeJS.ProcessEnv = process.env): PluginDriverManifest[] {
  const raw = env.PLUGIN_DRIVERS;
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[plugins] PLUGIN_DRIVERS is not valid JSON — ignoring: ${(e as Error).message}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn("[plugins] PLUGIN_DRIVERS must be a JSON array — ignoring");
    return [];
  }

  const out: PluginDriverManifest[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const protocol = typeof e.protocol === "string" ? e.protocol.trim() : "";
    const command = typeof e.command === "string" ? e.command.trim() : "";
    if (!id || !protocol || !command) {
      console.warn(`[plugins] PLUGIN_DRIVERS entry skipped (need id, protocol, command): ${JSON.stringify(e)}`);
      continue;
    }
    const args = Array.isArray(e.args)
      ? e.args.map((a) => String(a))
      : typeof e.args === "string"
        ? e.args.split(" ").filter(Boolean)
        : [];
    const version = typeof e.version === "string" ? e.version : "1.0.0";
    const signature = typeof e.signature === "string" && e.signature.length > 0 ? e.signature : undefined;

    out.push({
      id,
      name: typeof e.name === "string" && e.name ? e.name : id,
      version,
      apiVersion: typeof e.apiVersion === "string" && e.apiVersion ? e.apiVersion : "^1.0",
      kind: "device-connector",
      protocols: [protocol],
      // A declared signature (or explicit flag) marks the artifact as signed for the catalogue
      // apiVersion/signature gate; the REAL cryptographic check happens at spawn time.
      signaturePresent: signature != null ? true : Boolean(e.signaturePresent),
      description:
        typeof e.description === "string" && e.description
          ? e.description
          : `Plugin device-connector "${id}" (protocol ${protocol}) via out-of-process sidecar`,
      sidecar: { command, args },
      signed: {
        pluginId: id,
        version,
        artifactSha256: typeof e.artifactSha256 === "string" ? e.artifactSha256 : "",
        signature,
      },
    });
  }
  return out;
}
