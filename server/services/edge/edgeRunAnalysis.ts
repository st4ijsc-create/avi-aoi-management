/**
 * doc 81 Đợt 10 task B — CENTRAL's own reading of an edge run's definition, shared by the claim (run package), /authorize and
 * the report checks. Everything an edge sends is checked against what central derives HERE from the DB — never the reverse:
 *   • the machines of the definition (capabilities decide OT vs robot routing — foeStepClass.commandOf);
 *   • the adapter of an OT step — the SAME rule as foeEngine.withResolvedAdapter (explicit numeric args.adapterId, else the
 *     single ENABLED device_adapters row bound to the step's machine; zero / several ⇒ unresolved);
 *   • the command a step becomes (foeStepClass.buildEquipmentCommand, idempotency key `run<id>-<step>-a<attempt>`, as
 *     foeEngine.execCommand) and its binding hash (otActionBinding.otPayloadHash with tool foe.orchestration /
 *     robotPayloadHash of toRobotJob) — the hash the edge must quote and its verifier recomputes from the exact bytes;
 *   • the VERIFIED STOPs for the edge (robot abort; OT stop-typed step whose writes are exactly the adapter's stop pins —
 *     classifyOtStop over the enabled + writable stop-pin rows). The running-connection check of central's verifier is NOT
 *     applied here: central has no session for an edge-owned adapter; the edge compares the config's connection fingerprint
 *     before a pinned STOP (design §2.9). A pin read failure ⇒ `unsure` (never an exemption);
 *   • the prior picture of the run's step rows (Group C's edgePriorPictureOf — the engine's own priorStepsOf / abortSentOf).
 */
import { and, eq, inArray } from "drizzle-orm";
import { deviceAdapters, deviceTags, machines, orchestrationRunSteps } from "../../../drizzle/schema";
import { allStepsOf, buildEquipmentCommand, commandOf, isRobotKind, isRobotStopStep } from "../orchestration/foe/foeStepClass";
import type { MachineForValidation, WorkflowDefinition, WorkflowStep } from "../orchestration/foe/workflowModel";
import type { EquipmentCommand } from "../equipment/equipmentAdapter";
import { FOE_ENGINE_TOOL, otPayloadHash, robotPayloadHash } from "../ot/otActionBinding";
import { toRobotJob } from "../equipment/robotJobMapping";
import { isStopJob } from "../robot/stopJob";
import type { Db } from "./edgeCentralCommon";
import { edgePriorPictureOf } from "../orchestration/foe/foeRunStore";
import type { EdgePriorPicture, EdgeVerifiedStop } from "./edgeProtocol";

export type CommandStep = Extract<WorkflowStep, { type: "command" }>;

/** The engine's idempotency key of a command attempt (foeEngine.execCommand). */
export function edgeStepIdempotencyKey(runId: number, stepId: string, attempt: number): string {
  return `run${runId}-${stepId}-a${attempt}`;
}

export async function loadMachineMap(d: Db, def: Pick<WorkflowDefinition, "steps">): Promise<Map<number, MachineForValidation>> {
  const ids = [...new Set(allStepsOf(def?.steps).map((s) => (s as { machineId?: unknown }).machineId).filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0))];
  const map = new Map<number, MachineForValidation>();
  if (ids.length === 0) return map;
  const rows = await d.select({ id: machines.id, machineType: machines.machineType, capabilities: machines.capabilities }).from(machines).where(inArray(machines.id, ids));
  for (const m of rows) map.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
  return map;
}

/** foeEngine.withResolvedAdapter, reading the DB handle given (null ⇒ unresolved, never "adapter id = machine id"). */
export async function resolveOtAdapterId(d: Db, step: CommandStep): Promise<number | null> {
  const explicit = (step.args ?? {}).adapterId;
  if (typeof explicit === "number") return explicit;
  const rows = await d.select({ id: deviceAdapters.id }).from(deviceAdapters).where(and(eq(deviceAdapters.machineId, step.machineId), eq(deviceAdapters.isEnabled, true)));
  return rows.length === 1 ? rows[0].id : null;
}

export type RebuiltCommand =
  | { kind: "robot"; step: CommandStep; cmd: EquipmentCommand; robotId: number | null; jobType: string; params: Record<string, unknown>; payloadHash: string | null; isStop: boolean }
  | { kind: "ot"; step: CommandStep; cmd: EquipmentCommand; adapterId: number | null; machineId: number | null; commandType: string; writes: Array<{ tagKey: string; value: unknown }>; payloadHash: string | null; stopTyped: boolean };

/** The command central would send for this attempt (null: not a command step / machine / command unknown). */
export async function rebuildCommand(d: Db, step: WorkflowStep, machineMap: Map<number, MachineForValidation>, idempotencyKey: string): Promise<RebuiltCommand | null> {
  const c = commandOf(step, machineMap);
  if (!c) return null;
  const s = step as CommandStep;
  const raw = (s.args ?? {}) as Record<string, unknown>;
  const user = { id: 0, role: "system" };
  if (isRobotKind(c.cap.adapterKind)) {
    const cmd = buildEquipmentCommand(c.descriptor, c.cap, s.machineId, raw, idempotencyKey, user);
    const job = toRobotJob(cmd);
    const robotId = typeof cmd.robotId === "number" && Number.isInteger(cmd.robotId) && cmd.robotId > 0 ? cmd.robotId : null;
    return {
      kind: "robot",
      step: s,
      cmd,
      robotId,
      jobType: job.jobType,
      params: (job.params ?? {}) as Record<string, unknown>,
      payloadHash: robotId === null ? null : robotPayloadHash({ robotId, jobType: job.jobType, params: job.params ?? null }),
      isStop: isRobotStopStep(c) || isStopJob(job),
    };
  }
  const adapterId = await resolveOtAdapterId(d, s);
  const args = adapterId !== null && typeof raw.adapterId !== "number" ? { ...raw, adapterId } : raw;
  const cmd = buildEquipmentCommand(c.descriptor, c.cap, s.machineId, args, idempotencyKey, user);
  const writes = cmd.writes ?? [];
  const { isStopCommandType } = await import("../ot/commandDispatcher");
  return {
    kind: "ot",
    step: s,
    cmd,
    adapterId: typeof cmd.adapterId === "number" ? cmd.adapterId : null,
    machineId: cmd.machineId ?? null,
    commandType: cmd.name,
    writes,
    payloadHash:
      typeof cmd.adapterId === "number" ? otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: cmd.adapterId, machineId: cmd.machineId ?? null, commandType: cmd.name, writes }) : null,
    stopTyped: isStopCommandType(cmd.name),
  };
}

/** The hash of the command BODY an edge sent (the same canonical forms). */
export function requestPayloadHash(c: { kind: "ot"; adapterId: number; machineId: number | null; commandType: string; writes: Array<{ tagKey: string; value?: unknown }> } | { kind: "robot"; robotId: number; jobType: string; params: Record<string, unknown> }): string {
  return c.kind === "ot"
    ? otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: c.adapterId, machineId: c.machineId ?? null, commandType: c.commandType, writes: c.writes.map((w) => ({ tagKey: w.tagKey, value: w.value })) })
    : robotPayloadHash({ robotId: c.robotId, jobType: c.jobType, params: c.params ?? null });
}

/** The stop pins of adapters (the enabled + writable stop-pin rows — loadStopPins' rule). Read failure ⇒ throws. */
export async function stopPinsOf(d: Db, adapterIds: readonly number[]): Promise<Map<number, Array<{ tagKey: string; value: unknown }>>> {
  const out = new Map<number, Array<{ tagKey: string; value: unknown }>>();
  const ids = [...new Set(adapterIds)];
  if (ids.length === 0) return out;
  const { stopPinsFromTagRows } = await import("../ot/stopPin");
  const rows = await d
    .select({ adapterId: deviceTags.adapterId, tagKey: deviceTags.tagKey, dataType: deviceTags.dataType, stopValue: deviceTags.stopValue, writable: deviceTags.writable, isEnabled: deviceTags.isEnabled })
    .from(deviceTags)
    .where(and(inArray(deviceTags.adapterId, ids), eq(deviceTags.isEnabled, true), eq(deviceTags.writable, true)));
  for (const id of ids) {
    const mine = rows.filter((r) => r.adapterId === id).sort((a, b) => (a.tagKey < b.tagKey ? -1 : a.tagKey > b.tagKey ? 1 : 0));
    out.set(id, stopPinsFromTagRows(mine as never));
  }
  return out;
}

/** Is this rebuilt OT command a PINNED stop (classifyOtStop over the pins)? pins null ⇒ not pinned (fail-closed). */
export async function isPinnedOtStop(rb: Extract<RebuiltCommand, { kind: "ot" }>, pins: Array<{ tagKey: string; value: unknown }> | null): Promise<{ pinned: boolean; writes?: Array<{ tagKey: string; value: unknown }> }> {
  if (!rb.stopTyped) return { pinned: false };
  const { classifyOtStop } = await import("../ot/commandDispatcher");
  const c = classifyOtStop(rb.commandType, rb.writes, pins as never);
  return c.pinnedStop ? { pinned: true, writes: c.writes.map((w) => ({ tagKey: w.tagKey, value: w.value })) } : { pinned: false };
}

export interface EdgeStopAnalysis {
  verifiedStops: EdgeVerifiedStop[];
  stopsUnsure: string[];
  /** stepId → adapterId for every OT command step whose adapter resolves */
  resolvedAdapters: Array<{ stepId: string; adapterId: number }>;
  /** every device the definition's command steps target */
  robotIds: number[];
  adapterIds: number[];
  /** command steps whose bound device does not resolve — an OT step without an adapter, a robot step without a robot id, a
   *  command of an unknown machine / command (the edge cannot send them; the ownership checks refuse them — fail closed) */
  unresolved: string[];
}

/** The verified STOPs (for the edge), the resolved adapters and the devices of a definition. */
export async function analyseDefinition(d: Db, runId: number, def: Pick<WorkflowDefinition, "steps">, machineMap: Map<number, MachineForValidation>): Promise<EdgeStopAnalysis> {
  const out: EdgeStopAnalysis = { verifiedStops: [], stopsUnsure: [], resolvedAdapters: [], robotIds: [], adapterIds: [], unresolved: [] };
  const rebuilt: RebuiltCommand[] = [];
  for (const s of allStepsOf(def?.steps)) {
    const rb = await rebuildCommand(d, s, machineMap, edgeStepIdempotencyKey(runId, s.id, 1));
    if (rb) rebuilt.push(rb);
    else if (s.type === "command") out.unresolved.push(s.id);
  }
  let pins: Map<number, Array<{ tagKey: string; value: unknown }>> | null = null;
  const otAdapters = rebuilt.filter((r): r is Extract<RebuiltCommand, { kind: "ot" }> => r.kind === "ot" && r.adapterId !== null).map((r) => r.adapterId as number);
  try {
    pins = await stopPinsOf(d, otAdapters);
  } catch {
    pins = null;
  }
  for (const rb of rebuilt) {
    if (rb.kind === "robot") {
      if (rb.robotId !== null) out.robotIds.push(rb.robotId);
      else out.unresolved.push(rb.step.id);
      if (rb.isStop && rb.robotId !== null) out.verifiedStops.push({ kind: "robot", stepId: rb.step.id, robotId: rb.robotId });
      continue;
    }
    if (rb.adapterId === null) {
      out.unresolved.push(rb.step.id);
      continue;
    }
    out.adapterIds.push(rb.adapterId);
    out.resolvedAdapters.push({ stepId: rb.step.id, adapterId: rb.adapterId });
    if (!rb.stopTyped) continue;
    if (pins === null) {
      out.stopsUnsure.push(rb.step.id);
      continue;
    }
    const p = await isPinnedOtStop(rb, pins.get(rb.adapterId) ?? []);
    if (p.pinned && p.writes && p.writes.length > 0) out.verifiedStops.push({ kind: "ot", stepId: rb.step.id, adapterId: rb.adapterId, pins: p.writes });
  }
  out.robotIds = [...new Set(out.robotIds)].sort((a, b) => a - b);
  out.adapterIds = [...new Set(out.adapterIds)].sort((a, b) => a - b);
  return out;
}

/** The engine's prior picture (Group C: foeRunStore.edgePriorPictureOf — the same rows, the same rules as the central walk). */
export function priorPictureOf(rows: Parameters<typeof edgePriorPictureOf>[0]): EdgePriorPicture {
  return edgePriorPictureOf(rows);
}

export async function readPriorPicture(d: Db, runId: number): Promise<EdgePriorPicture> {
  const rows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
  return priorPictureOf(rows);
}
