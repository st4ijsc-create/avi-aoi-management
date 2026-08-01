/**
 * Space-time reservation engine — SYNAPSE §5.4.3 (doc 33 §3.6 / H4 Traffic).
 *
 * The current trafficManager uses a per-zone COUNT semaphore; SYNAPSE reserves space-time SLOTS:
 * a robot holds `(edgeId, [t_in, t_out])` intervals along its route, and a conflict is a
 * time-overlap (± a safety buffer) on the same edge/node. This is that interval engine — pure,
 * deterministic, testable. Additive (flag TRAFFIC_SPACETIME); the existing manager is untouched.
 */

export interface TimeInterval {
  /** Epoch ms (or a monotonic tick) the robot enters the edge. */
  start: number;
  /** Epoch ms it clears the edge. */
  end: number;
  robotId: string;
}

/** Two intervals overlap when expanded by `buffer` on each side. */
export function overlaps(a: TimeInterval, b: TimeInterval, buffer = 0): boolean {
  return a.start - buffer < b.end + buffer && b.start - buffer < a.end + buffer;
}

export interface ReserveResult {
  ok: boolean;
  /** The robot(s) whose reservation conflicts (empty when ok). */
  conflicts: string[];
}

/**
 * Reservation table: edgeId → sorted intervals. A robot reserves a chain of these along its
 * route; a conflicting slot is refused (the router then re-plans or waits). Default safety
 * buffer ±1.5s (SDD §5.4.3).
 */
export class SpaceTimeReservations {
  private table = new Map<string, TimeInterval[]>();

  constructor(private readonly bufferMs = 1500) {}

  /** Check (without reserving) which robots conflict with a proposed slot. */
  conflictsAt(edgeId: string, slot: TimeInterval): string[] {
    const existing = this.table.get(edgeId) ?? [];
    return existing.filter((iv) => iv.robotId !== slot.robotId && overlaps(iv, slot, this.bufferMs)).map((iv) => iv.robotId);
  }

  /** Reserve a slot on an edge. Refused (ok:false) if it conflicts with another robot. */
  reserve(edgeId: string, slot: TimeInterval): ReserveResult {
    const conflicts = this.conflictsAt(edgeId, slot);
    if (conflicts.length > 0) return { ok: false, conflicts };
    const list = this.table.get(edgeId) ?? [];
    list.push(slot);
    list.sort((a, b) => a.start - b.start);
    this.table.set(edgeId, list);
    return { ok: true, conflicts: [] };
  }

  /** Reserve an ordered chain of slots (a route). All-or-nothing: rolls back on first conflict. */
  reserveRoute(slots: Array<{ edgeId: string; slot: TimeInterval }>): ReserveResult {
    const done: Array<{ edgeId: string; slot: TimeInterval }> = [];
    for (const s of slots) {
      const r = this.reserve(s.edgeId, s.slot);
      if (!r.ok) {
        for (const d of done) this.releaseSlot(d.edgeId, d.slot);
        return r;
      }
      done.push(s);
    }
    return { ok: true, conflicts: [] };
  }

  /** Release one specific slot. */
  releaseSlot(edgeId: string, slot: TimeInterval): void {
    const list = this.table.get(edgeId);
    if (!list) return;
    const next = list.filter((iv) => !(iv.robotId === slot.robotId && iv.start === slot.start && iv.end === slot.end));
    if (next.length) this.table.set(edgeId, next);
    else this.table.delete(edgeId);
  }

  /** Release ALL reservations held by a robot (e.g. it arrived / failed). */
  releaseRobot(robotId: string): number {
    let removed = 0;
    for (const [edgeId, list] of this.table) {
      const next = list.filter((iv) => iv.robotId !== robotId);
      removed += list.length - next.length;
      if (next.length) this.table.set(edgeId, next);
      else this.table.delete(edgeId);
    }
    return removed;
  }

  /** Current reservations on an edge (sorted). */
  onEdge(edgeId: string): TimeInterval[] {
    return [...(this.table.get(edgeId) ?? [])];
  }

  /** Total active reservations (for metrics/tests). */
  size(): number {
    let n = 0;
    for (const list of this.table.values()) n += list.length;
    return n;
  }
}
