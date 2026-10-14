/**
 * doc 81 Đợt 12 task N fix 1 (review I-1, ruling R-12-d) — QUIESCING: a robot SESSION being taken down on the edge.
 *
 * The edge quiesces a robot that left the node or whose settings changed: lock → STOP → detach. A CONFIRMED STOP clears a motion
 * lock that is not an operator hold, so between the STOP and the re-lock a signed run motion could pass the edge gate. The
 * quiesce therefore marks the session (its driver instance) quiescing BEFORE the STOP is sent:
 *   • the edge motion path (robotEdgeDispatch) refuses every non-STOP job while it is set (ROBOT_QUIESCING);
 *   • a STOP never clears it, nor does a signed clear of the old session's lock;
 *   • it ends only when the session is detached (robotManager.detachRobot) — a re-attach builds a NEW session (new driver)
 *     without it, whose own lock (seeded from the journal) needs its own fresh signed clear.
 * Never gates a STOP (L-7). Keyed by the driver object (weak): a dropped session takes its state with it.
 */
const quiescing = new WeakMap<object, { since: string; why: string }>();

/** Mark this session (driver instance) quiescing. Synchronous; the first cause is kept. */
export function markSessionQuiescing(driver: object, why: string): void {
  if (!quiescing.has(driver)) quiescing.set(driver, { since: new Date().toISOString(), why: String(why).slice(0, 300) });
}
/** The quiescing state of this session (driver instance), or null. */
export function sessionQuiescing(driver: object | null | undefined): { since: string; why: string } | null {
  return driver ? (quiescing.get(driver) ?? null) : null;
}
/** The session is gone (detached): its quiescing state ends with it. */
export function endSessionQuiescing(driver: object): void {
  quiescing.delete(driver);
}
