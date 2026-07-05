/**
 * Plugin-sidecar bootstrap — SYNAPSE §6.4.3 (doc 33 §11 · P4 completion).
 *
 * Starts a real out-of-process plugin under the supervisor at boot when PLUGIN_SIDECAR is on — the
 * "đăng ký supervisor vào bootstrap" item. Default OFF; also a no-op unless PLUGIN_SIDECAR_CMD names
 * a command to supervise (e.g. a compiled sampleSidecar.js, or a vendor connector). Non-breaking.
 */
import { PluginSupervisor, DEFAULT_RESTART_POLICY } from "./pluginSupervisor";
import { createNodeSpawner } from "./nodeSpawner";

let supervisor: PluginSupervisor | null = null;

export function pluginSidecarEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLUGIN_SIDECAR === "true" || env.PLUGIN_SIDECAR === "1";
}

/** Start supervising the configured sidecar. No-op when the flag is off or no command is set. */
export function startPluginSidecar(): void {
  if (supervisor || !pluginSidecarEnabled()) return;
  const command = process.env.PLUGIN_SIDECAR_CMD;
  if (!command) {
    console.log("[PluginSidecar] enabled but PLUGIN_SIDECAR_CMD unset — nothing to supervise");
    return;
  }
  const args = (process.env.PLUGIN_SIDECAR_ARGS ?? "").split(" ").filter(Boolean);
  supervisor = new PluginSupervisor(
    { pluginId: process.env.PLUGIN_SIDECAR_ID ?? "sidecar", command, args },
    {
      spawn: createNodeSpawner(),
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        if (typeof t.unref === "function") t.unref();
        return { cancel: () => clearTimeout(t) };
      },
      now: () => Date.now(),
      onIncident: (id, reason) => console.error(`[PluginSidecar] incident ${id}: ${reason}`),
    },
    DEFAULT_RESTART_POLICY,
  );
  supervisor.start();
  console.log(`[PluginSidecar] supervising ${command} ${args.join(" ")}`.trim());
}

export function stopPluginSidecar(): void {
  if (supervisor) {
    supervisor.stop();
    supervisor = null;
  }
}
