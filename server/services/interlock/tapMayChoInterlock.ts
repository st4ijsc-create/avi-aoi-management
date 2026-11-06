/**
 * SCADA R1b-2b-2a A2(i)(1) — THE set of machines whose `targetMachineId` interlock rules an OT write on an adapter must satisfy.
 *
 * Before A2(i)(1) the inline gate (commandDispatcher) and its edge copy (edgeAuthorizeCentral.otGates) matched `targetMachineId` against the CALLER's
 * `machineId` only. An FOE step naming `args.adapterId` passes `step.machineId`, and that adapter may sit on ANOTHER machine (foeScope.ts, R-4-d) ⇒ a
 * rule aimed only at the adapter's real machine (no `targetAdapterId`, no `commandTag` — a shape interlockRouter allows) was skipped and the write
 * reached that machine while the rule was active.
 *
 * Rule (coordinator, A2(i)(1)): the UNION {the adapter's own machine (`device_adapters."machineId"`), the caller's machine} — STRICTER ONLY, the same
 * rule the safety-PLC target set follows (safetyTarget.ts, R-4-d). The caller can only ADD rules, never remove the adapter's. Adapter on no machine
 * (NULL) ⇒ the caller's machine only (as before). Nulls dropped, de-duplicated, adapter's machine first.
 *
 * Pure, in its own module ON PURPOSE: many unit suites replace `./interlockGate` with a factory mock that would not carry this export. Both OT call
 * sites (commandDispatcher 5a-interlock, edgeAuthorizeCentral.otGates) call THIS function — pinned by tapMayChoInterlock.a2i1.test.ts (source scan).
 * NOT for the robot gate: a robot has no adapter — its set is the machines WHERE it is (tapMayChoRobot.ts, A2(l)); a robot id is never a machine id.
 * The HITL binding hash keeps the CALLER's machine (what the human confirmed) — this set is for rule matching only.
 */
export function tapMayChoInterlock(adapterMachineId: number | null | undefined, callerMachineId: number | null | undefined): number[] {
  const out: number[] = [];
  for (const m of [adapterMachineId, callerMachineId]) {
    if (typeof m === "number" && Number.isFinite(m) && !out.includes(m)) out.push(m);
  }
  return out;
}
