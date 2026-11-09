/**
 * A2(n) T7b-1d lượt sửa 1 (H29, dieu-phoi 09/11) — the one definition of the stop command types, in a module that imports nothing: whether a step is stop-typed is known with nothing loaded. A load of the dispatcher that hangs or fails
 * cannot turn a STOP into a non-STOP on an Abort's road. commandDispatcher exports it again, unchanged. moduleLaStopCensus holds this: no import here, no second list.
 * Task 2: the exemption is decided by DATA — classifyOtStop — and only for a stop that writes exactly the pinned (tagKey, value) pairs of the target adapter; the name only selects which commands are looked at.
 */
export function isStopCommandType(commandType: string): boolean {
  const t = String(commandType ?? "").trim().toLowerCase();
  return t === "stop" || t === "e_stop";
}
