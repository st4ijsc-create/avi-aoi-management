/**
 * doc 81 Đợt 10 task D — what the EDGE device front ends (otEdgeDispatch / robotEdgeDispatch) need from the edge runtime
 * (group E), as ONE injected object. No database anywhere: the signed config snapshot, the journal and the trust inputs.
 *
 * Wiring (group E, at edge boot, after the first verified config): installEdgeDeviceRuntime({...}). It also installs the
 * safety-PLC config-source seams (safetyPlcAdapter / safetyTarget) so the safety preflight reads the snapshot's configs, never
 * the DB. Until it is installed: a non-STOP edge command is refused; a robot STOP is still sent (L-7); a pinned OT STOP needs
 * the snapshot's pins, so it cannot be recognised before the first config (it is then refused, like any unverified write).
 */
import type { EdgeConfigSnapshot, EdgeEventRecord, EdgeRunReportRecord } from "./edgeProtocol";
import type { EdgeAuthorizationDeps } from "./edgeAuthorizationVerifier";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type EdgeDeviceRunRecord = DistributiveOmit<EdgeRunReportRecord, "seq">;
export type EdgeDeviceEventRecord = DistributiveOmit<EdgeEventRecord, "seq">;

/**
 * The journal surface the front ends use — a structural subset of group E's EdgeJournal (edgeJournal.ts), so the journal
 * instance itself is passed. consumeAuthorization is the write-ahead of single use: it must be durable (fsync) BEFORE it
 * resolves ok; only then is the command sent. STOP records are bounded by the journal (L-7) and never awaited past it.
 */
export interface EdgeDispatchJournal {
  consumeAuthorization(c: { jti: string; runId: number; claimSeq: number; stepId: string; attempt: number }): Promise<{ ok: true } | { ok: false; reason: string }>;
  isJtiConsumed(jti: string): boolean;
  /** may a NEW non-STOP actuation start (false when full / unhealthy / closed)? absent ⇒ true */
  admitNonStop?(): boolean;
  appendRun(runId: number, claimSeq: number, rec: EdgeDeviceRunRecord, opts?: { stop?: boolean }): Promise<unknown>;
  appendEvent(rec: EdgeDeviceEventRecord, opts?: { stop?: boolean }): Promise<unknown>;
}

export interface EdgeDeviceRuntime {
  nodeId: number;
  /** the current VERIFIED config snapshot (null before the first one) */
  config(): EdgeConfigSnapshot | null;
  journal: EdgeDispatchJournal;
  /** the trust inputs; null ⇒ keyset / credential unknown ⇒ every NON-STOP command is refused */
  auth(): EdgeAuthorizationDeps | null;
  /** the edge's own env mode (the stricter of this and central's signed `mode` applies) — default OT_/ROBOT_CONTROL_ENABLED */
  otControlEnabled?(): boolean;
  robotControlEnabled?(): boolean;
}

let installed: EdgeDeviceRuntime | null = null;

/** Install the edge device runtime (edge process only) and point the safety-PLC config sources at its snapshot. */
export async function installEdgeDeviceRuntime(rt: EdgeDeviceRuntime): Promise<void> {
  installed = rt;
  const [{ setPlcConfigSource }, { setSafetyTargetSource }] = await Promise.all([import("../safety/plc/safetyPlcAdapter"), import("../ot/safetyTarget")]);
  // the snapshot ships only the configs central resolved as guarding the node's owned targets (edgeConfigCentral); the target
  // is not re-resolved on the edge (no DB) ⇒ null ⇒ EVERY shipped config applies to every command of this node (never fewer).
  setPlcConfigSource(() => (rt.config()?.safetyPlcConfigs ?? []).map((c) => c.config as never));
  setSafetyTargetSource(async () => null);
}

/** The installed runtime (null on central / before the edge's first config). */
export function edgeDeviceRuntime(): EdgeDeviceRuntime | null {
  return installed;
}

/** Test seam. */
export async function _resetEdgeDeviceRuntimeForTests(): Promise<void> {
  installed = null;
  const [{ setPlcConfigSource }, { setSafetyTargetSource }] = await Promise.all([import("../safety/plc/safetyPlcAdapter"), import("../ot/safetyTarget")]);
  setPlcConfigSource(null);
  setSafetyTargetSource(null);
}

export const envOtControlEnabled = (): boolean => process.env.OT_CONTROL_ENABLED === "true";
export const envRobotControlEnabled = (): boolean => process.env.ROBOT_CONTROL_ENABLED === "true";
