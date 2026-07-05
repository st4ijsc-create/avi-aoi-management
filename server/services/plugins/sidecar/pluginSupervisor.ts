/**
 * Out-of-process plugin supervisor (watchdog) — SYNAPSE §6.4.3 (doc 33 F3 · P4).
 *
 * Runs a plugin as a SEPARATE process (go-plugin model) and keeps it alive: crash → restart with
 * exponential backoff; too many crashes in a window → circuit-break (stop restarting, raise an
 * incident) so a broken plugin never loops nor drags down the Hub. The IPC wire is pluggable
 * (JSON-lines-over-stdio now; gRPC/unix-socket later) — the supervision logic is protocol-agnostic.
 *
 * The process spawner + scheduler are INJECTED so the watchdog/backoff logic is deterministically
 * testable without spawning real processes or real timers.
 */

export interface ChildHandle {
  pid?: number;
  kill(signal?: string): void;
  /** Register an exit callback (code = exit code or null on signal). */
  onExit(cb: (code: number | null) => void): void;
}

export type Spawner = (spec: { command: string; args: string[]; pluginId: string }) => ChildHandle;
export type Scheduler = (fn: () => void, ms: number) => { cancel(): void };

export interface RestartPolicy {
  baseMs: number;
  maxMs: number;
  factor: number;
  /** Circuit-break after this many restarts within `windowMs`. */
  maxRestartsInWindow: number;
  windowMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  maxRestartsInWindow: 5,
  windowMs: 60_000,
};

/** Exponential backoff (capped). Pure. attempt is 0-based. */
export function computeBackoffMs(attempt: number, p: RestartPolicy): number {
  return Math.min(p.maxMs, Math.round(p.baseMs * Math.pow(p.factor, Math.max(0, attempt))));
}

export interface RestartDecision {
  restart: boolean;
  delayMs: number;
  circuitOpen: boolean;
  reason: string;
}

/**
 * Decide whether to restart after an exit, and the backoff delay. Circuit-opens when restart
 * timestamps within the window exceed the threshold. Pure — caller passes recent restart times.
 */
export function decideRestart(
  exitCode: number | null,
  recentRestartTs: readonly number[],
  nowTs: number,
  policy: RestartPolicy,
): RestartDecision {
  if (exitCode === 0) return { restart: false, delayMs: 0, circuitOpen: false, reason: "clean exit (0)" };
  const inWindow = recentRestartTs.filter((t) => nowTs - t <= policy.windowMs);
  if (inWindow.length >= policy.maxRestartsInWindow) {
    return {
      restart: false,
      delayMs: 0,
      circuitOpen: true,
      reason: `circuit open: ${inWindow.length} restarts in ${policy.windowMs}ms — raising incident`,
    };
  }
  return {
    restart: true,
    delayMs: computeBackoffMs(inWindow.length, policy),
    circuitOpen: false,
    reason: `restart #${inWindow.length + 1} after crash (code ${exitCode})`,
  };
}

export interface SupervisorStatus {
  pluginId: string;
  running: boolean;
  restarts: number;
  circuitOpen: boolean;
  lastExitCode: number | null;
  pid?: number;
}

/** Supervises one plugin process. Deterministic via injected spawner + scheduler. */
export class PluginSupervisor {
  private child: ChildHandle | null = null;
  private restartTs: number[] = [];
  private circuitOpen = false;
  private lastExitCode: number | null = null;
  private stopped = false;

  constructor(
    private readonly spec: { pluginId: string; command: string; args: string[] },
    private readonly deps: { spawn: Spawner; schedule: Scheduler; now: () => number; onIncident?: (id: string, reason: string) => void },
    private readonly policy: RestartPolicy = DEFAULT_RESTART_POLICY,
  ) {}

  start(): void {
    this.stopped = false;
    this.spawnOnce();
  }

  private spawnOnce(): void {
    if (this.stopped || this.circuitOpen) return;
    const child = this.deps.spawn({ command: this.spec.command, args: this.spec.args, pluginId: this.spec.pluginId });
    this.child = child;
    child.onExit((code) => {
      this.lastExitCode = code;
      this.child = null;
      if (this.stopped) return;
      const now = this.deps.now();
      const decision = decideRestart(code, this.restartTs, now, this.policy);
      if (decision.circuitOpen) {
        this.circuitOpen = true;
        this.deps.onIncident?.(this.spec.pluginId, decision.reason);
        return;
      }
      if (decision.restart) {
        this.restartTs.push(now);
        this.deps.schedule(() => this.spawnOnce(), decision.delayMs);
      }
    });
  }

  /** Graceful stop (drain): no more restarts. */
  stop(signal = "SIGTERM"): void {
    this.stopped = true;
    this.child?.kill(signal);
    this.child = null;
  }

  getStatus(): SupervisorStatus {
    return {
      pluginId: this.spec.pluginId,
      running: this.child !== null,
      restarts: this.restartTs.length,
      circuitOpen: this.circuitOpen,
      lastExitCode: this.lastExitCode,
      pid: this.child?.pid,
    };
  }
}
