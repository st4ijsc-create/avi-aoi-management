/**
 * Infrastructure coordinator — SYNAPSE §5.4.3 (doc 33 §3.6 / H4 Traffic).
 *
 * Elevators, doors, and charging stations are EXCLUSIVE resources negotiated by a 3-step
 * protocol: request(ETA) → grant(deadline) → occupy → release. A grant that isn't occupied by
 * its deadline is revoked (so a stuck robot doesn't hold a lift forever). Pure state machine;
 * time is injected (deterministic). Additive (flag TRAFFIC_SPACETIME).
 */

export type InfraKind = "elevator" | "door" | "charging" | "dock";
export type GrantState = "idle" | "granted" | "occupied";

export interface InfraResource {
  id: string;
  kind: InfraKind;
  state: GrantState;
  /** Robot currently holding the grant/occupancy, if any. */
  holder: string | null;
  /** Deadline (epoch ms) by which a grant must be occupied, else revoked. */
  grantDeadline: number | null;
}

export interface RequestResult {
  ok: boolean;
  state: GrantState;
  /** Deadline the robot must occupy by (when granted). */
  deadline?: number;
  reason?: string;
}

/** Coordinates a set of exclusive infra resources. */
export class InfraCoordinator {
  private resources = new Map<string, InfraResource>();

  constructor(private readonly grantTtlMs = 30_000) {}

  register(id: string, kind: InfraKind): void {
    this.resources.set(id, { id, kind, state: "idle", holder: null, grantDeadline: null });
  }

  get(id: string): InfraResource | undefined {
    const r = this.resources.get(id);
    return r ? { ...r } : undefined;
  }

  /** Step 1+2: request → grant if free. `eta` is informational (queueing hint). */
  request(id: string, robotId: string, nowTs: number, _eta?: number): RequestResult {
    const r = this.resources.get(id);
    if (!r) return { ok: false, state: "idle", reason: "unknown resource" };
    this.reap(r, nowTs); // revoke an expired grant first
    if (r.state === "idle") {
      r.state = "granted";
      r.holder = robotId;
      r.grantDeadline = nowTs + this.grantTtlMs;
      return { ok: true, state: "granted", deadline: r.grantDeadline };
    }
    if (r.holder === robotId) {
      return { ok: true, state: r.state, deadline: r.grantDeadline ?? undefined };
    }
    return { ok: false, state: r.state, reason: `held by ${r.holder}` };
  }

  /** Step 3: occupy a granted resource (the robot physically entered). */
  occupy(id: string, robotId: string, nowTs: number): RequestResult {
    const r = this.resources.get(id);
    if (!r) return { ok: false, state: "idle", reason: "unknown resource" };
    this.reap(r, nowTs);
    if (r.holder !== robotId || r.state === "idle") {
      return { ok: false, state: r.state, reason: "no grant to occupy" };
    }
    r.state = "occupied";
    r.grantDeadline = null; // occupancy has no TTL; released explicitly
    return { ok: true, state: "occupied" };
  }

  /** Release (grant or occupancy) → resource returns to idle. */
  release(id: string, robotId: string): RequestResult {
    const r = this.resources.get(id);
    if (!r) return { ok: false, state: "idle", reason: "unknown resource" };
    if (r.holder !== robotId) return { ok: false, state: r.state, reason: "not the holder" };
    r.state = "idle";
    r.holder = null;
    r.grantDeadline = null;
    return { ok: true, state: "idle" };
  }

  /** Revoke an expired grant (granted-but-not-occupied past its deadline). */
  private reap(r: InfraResource, nowTs: number): void {
    if (r.state === "granted" && r.grantDeadline != null && nowTs > r.grantDeadline) {
      r.state = "idle";
      r.holder = null;
      r.grantDeadline = null;
    }
  }

  /** Sweep all resources for expired grants (call periodically). Returns count revoked. */
  reapExpired(nowTs: number): number {
    let revoked = 0;
    for (const r of this.resources.values()) {
      const before = r.state;
      this.reap(r, nowTs);
      if (before === "granted" && r.state === "idle") revoked++;
    }
    return revoked;
  }

  list(): InfraResource[] {
    return [...this.resources.values()].map((r) => ({ ...r }));
  }
}
