/**
 * Real child-process spawner for the plugin supervisor — SYNAPSE §6.4.3 (doc 33 §11 · P4 completion).
 *
 * Adapts Node's child_process.spawn to the supervisor's injected {@link Spawner} contract, and offers
 * spawnSidecarWithTransport() for callers that also want the JSON-lines request/response channel. This
 * is the concrete out-of-process wire; wrapping a vendor NATIVE DLL (FOCAS, robot SDK) inside such a
 * sidecar remains hardware-side, but the transport + supervision are fully software here.
 */
import { spawn } from "node:child_process";
import type { ChildHandle, Spawner } from "./pluginSupervisor";
import { StdioTransport } from "./stdioTransport";

interface SpawnSpec {
  command: string;
  args: string[];
}

function toHandle(cp: ReturnType<typeof spawn>): ChildHandle {
  const exitCbs: Array<(code: number | null) => void> = [];
  cp.on("exit", (code) => {
    for (const cb of exitCbs) cb(code);
  });
  cp.on("error", () => {
    // spawn error (e.g. ENOENT) surfaces as an exit so the supervisor's backoff engages
    for (const cb of exitCbs) cb(null);
  });
  cp.stderr?.on("data", (d) => {
    const line = String(d).trim();
    if (line) console.error(`[sidecar:${cp.pid ?? "?"}] ${line}`);
  });
  return {
    pid: cp.pid,
    kill: (signal) => {
      cp.kill(signal as NodeJS.Signals);
    },
    onExit: (cb) => exitCbs.push(cb),
  };
}

/** A supervisor-compatible spawner backed by real child processes. */
export function createNodeSpawner(): Spawner {
  return ({ command, args }) => toHandle(spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }));
}

/** Spawn a sidecar AND attach a JSON-lines transport for request/response over its stdio. */
export function spawnSidecarWithTransport(spec: SpawnSpec): { handle: ChildHandle; transport: StdioTransport } {
  const cp = spawn(spec.command, spec.args, { stdio: ["pipe", "pipe", "pipe"] });
  const handle = toHandle(cp);
  const transport = new StdioTransport(cp.stdin!, cp.stdout!);
  return { handle, transport };
}

/**
 * A supervisor-compatible spawner that ALSO wires a fresh JSON-lines transport on EVERY (re)spawn —
 * doc 37 P0-4. Lets a caller run a sidecar under {@link PluginSupervisor} (crash → backoff restart +
 * circuit-break) while still getting the request/response channel: each spawn (initial + every
 * watchdog restart) invokes `onSpawn(transport, handle)` so the caller can re-point its RPC at the
 * new process and re-issue its connect handshake. `transportOpts.timeoutMs` bounds each RPC frame.
 */
export function createSupervisedTransportSpawner(
  onSpawn: (transport: StdioTransport, handle: ChildHandle) => void,
  transportOpts: { timeoutMs?: number } = {},
): Spawner {
  return ({ command, args }) => {
    const cp = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const handle = toHandle(cp);
    const transport = new StdioTransport(cp.stdin!, cp.stdout!, transportOpts);
    onSpawn(transport, handle);
    return handle;
  };
}
