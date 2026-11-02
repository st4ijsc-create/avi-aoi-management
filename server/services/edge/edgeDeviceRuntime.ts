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
  /**
   * R1b-2b-2a A2(o) — central announced a NEWER config than the verified one (pull / heartbeat configVersion) and no refresh has
   * adopted it yet ⇒ the staleness; null ⇔ not stale as far as this edge knows. Absent ⇒ never stale. Central unreachable keeps it
   * (fail-closed: every non-STOP stays refused until a refresh succeeds; STOPs still go).
   */
  configStale?(): EdgeConfigStaleness | null;
  /** A2(o) — ask for a config refresh now (single-flight, bounded; never throws, never awaited by a dispatch) */
  requestConfigRefresh?(): void;
}

/** R1b-2b-2a A2(o) — what the edge knows about its config being stale (EdgeConfigSource.staleness). */
export interface EdgeConfigStaleness {
  /** the newest configVersion central announced */
  centralVersion: number;
  /** the verified config's version here */
  localVersion: number;
  /** wall ms when this edge first saw central announce a newer version (still not adopted) */
  sinceMs: number;
  /** the verified config's issuedAt (central's wall clock) — its age = now − this; null before any config */
  configIssuedAt: number | null;
}

/** A2(o) — refusal reasons of edgeNonStopConfigGate (the dispatch result's `reason`). */
export const EDGE_SAFETY_CONFIG_MISSING = "SAFETY_CONFIG_MISSING" as const;
export const EDGE_CONFIG_STALE = "CONFIG_STALE" as const;

const secondsAgo = (at: number | null | undefined, now: number): string => (typeof at === "number" && Number.isFinite(at) ? `${Math.max(0, Math.round((now - at) / 1000))} s ago` : "at an unknown time");

/**
 * R1b-2b-2a A2(o) — THE config gate of every NON-STOP edge write (OT and robot motion: otEdgeDispatch / robotEdgeDispatch call
 * this one helper, after the authorisation is verified and BEFORE any preflight / slot / consume — a refused jti is never burnt):
 *   1. central announced a newer config this edge has not adopted (rt.configStale) ⇒ CONFIG_STALE (its age and since when);
 *   2. a safety-PLC config the authorisation was SIGNED for is absent from the verified snapshot ⇒ SAFETY_CONFIG_MISSING — the
 *      edge's preflight reads only the shipped configs, so a guarding PLC it does not have would never be consulted (another
 *      PLC reading clean would vouch "OK" for it).
 * Either refusal journals an anomaly saying WHY (code EDGE_CONFIG_STALE / EDGE_SAFETY_CONFIG_MISSING, the versions and the
 * config's age) and asks for a refresh. null ⇔ go on. A pinned STOP / robot abort never calls this (L-7).
 */
export function edgeNonStopConfigGate(
  rt: EdgeDeviceRuntime,
  cfg: EdgeConfigSnapshot,
  signedSafetyConfigIds: readonly number[],
  ctx: { target: string; runId: number | null },
  now: number = Date.now(),
): { reason: typeof EDGE_SAFETY_CONFIG_MISSING | typeof EDGE_CONFIG_STALE; detail: string } | null {
  let stale: EdgeConfigStaleness | null;
  let staleDetail: string | null = null;
  try {
    stale = rt.configStale ? rt.configStale() : null;
  } catch (err) {
    stale = null;
    staleDetail = `the config's staleness could not be read (${String((err as Error)?.message ?? err).slice(0, 120)})`;
  }
  if (stale) {
    staleDetail = `central announced config v${stale.centralVersion} ${secondsAgo(stale.sinceMs, now)}; this edge still holds v${stale.localVersion} (issued ${secondsAgo(stale.configIssuedAt, now)})`;
  }
  let refusal: { reason: typeof EDGE_SAFETY_CONFIG_MISSING | typeof EDGE_CONFIG_STALE; code: string; detail: string } | null = null;
  if (staleDetail !== null) {
    refusal = { reason: EDGE_CONFIG_STALE, code: "EDGE_CONFIG_STALE", detail: `${staleDetail} — non-STOP writes are refused until the refresh succeeds (STOPs still go)` };
  } else {
    const shipped = new Set(cfg.safetyPlcConfigs.map((c) => c.id));
    const missing = [...new Set(signedSafetyConfigIds)].filter((id) => !shipped.has(id)).sort((a, b) => a - b);
    if (missing.length > 0) {
      refusal = {
        reason: EDGE_SAFETY_CONFIG_MISSING,
        code: "EDGE_SAFETY_CONFIG_MISSING",
        detail: `signed safety-PLC config(s) ${missing.slice(0, 16).map((x) => `#${x}`).join(", ")}${missing.length > 16 ? ` (+${missing.length - 16})` : ""} absent from the verified config v${cfg.configVersion} (issued ${secondsAgo(cfg.issuedAt, now)}) — the preflight could not consult them; refused, a refresh is requested`,
      };
    }
  }
  if (!refusal) return null;
  const { code, detail } = refusal;
  void Promise.resolve()
    .then(() => rt.journal.appendEvent({ kind: "anomaly", code, runId: ctx.runId, detail: `${ctx.target}: ${detail}`.slice(0, 1000), at: now }))
    .catch(() => undefined);
  try {
    rt.requestConfigRefresh?.();
  } catch {
    /* a refresh request never changes the refusal */
  }
  return { reason: refusal.reason, detail };
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
