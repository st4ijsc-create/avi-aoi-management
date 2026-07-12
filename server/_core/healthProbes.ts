/**
 * Liveness / readiness probes — doc 44 W6-4 (gap G5.25). SYNAPSE_Tang5 Ch.15.
 *
 * Splits the single legacy `/health` into the two Kubernetes/ArgoCD-standard probes a
 * shadow→canary rollout gates on:
 *
 *   • /livez  — LIVENESS: is the process up? Always 200 unless the event loop is dead.
 *               Must NOT check dependencies (a DB blip must not trigger a pod restart).
 *   • /readyz — READINESS: can this instance serve traffic? Checks DB (hard gate) +
 *               broker (informational). 503 until ready — the canary gate holds the new
 *               revision out of the rollout until it flips green.
 *
 * The checkers are injectable so the logic is unit-testable without a live DB/broker.
 */

export interface LivenessResult {
  status: "alive";
  uptimeSec: number;
  pid: number;
  ts: string;
}

export function livenessProbe(): LivenessResult {
  return {
    status: "alive",
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    ts: new Date().toISOString(),
  };
}

export interface ReadinessResult {
  status: "ready" | "not_ready";
  ready: boolean;
  checks: {
    db: "ok" | "down";
    broker: "ok" | "down" | "disabled";
  };
  ts: string;
}

export interface ReadinessDeps {
  /** Resolve true when the primary DB is reachable. */
  checkDb?: () => Promise<boolean>;
  /** Resolve broker state: true=up, false=down, null=intentionally disabled (not a gate). */
  checkBroker?: () => Promise<boolean | null>;
}

async function defaultCheckDb(): Promise<boolean> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    return Boolean(db);
  } catch {
    return false;
  }
}

async function defaultCheckBroker(): Promise<boolean | null> {
  try {
    const { isMqttRunning } = await import("../services/mqttService");
    return isMqttRunning();
  } catch {
    return null; // broker module unavailable → treat as disabled (not a readiness gate)
  }
}

/**
 * Readiness = DB reachable. Broker state is reported but does NOT gate readiness (the
 * MQTT broker may be intentionally off in some deployments). Never throws.
 */
export async function readinessProbe(deps: ReadinessDeps = {}): Promise<ReadinessResult> {
  const checkDb = deps.checkDb ?? defaultCheckDb;
  const checkBroker = deps.checkBroker ?? defaultCheckBroker;

  const [dbOk, brokerState] = await Promise.all([
    checkDb().catch(() => false),
    checkBroker().catch(() => null),
  ]);

  const broker = brokerState === null ? "disabled" : brokerState ? "ok" : "down";
  const ready = dbOk === true; // DB is the hard readiness gate
  return {
    status: ready ? "ready" : "not_ready",
    ready,
    checks: { db: dbOk ? "ok" : "down", broker },
    ts: new Date().toISOString(),
  };
}
