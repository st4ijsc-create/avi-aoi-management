/**
 * Doc 24 / Wave-4 — AOI-F: Quality → Control Proposal service (close the QUALITY loop).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT: when the AI quality gate flags a gated NG (or a confirmed anomaly), this
 * service DRAFTS a TYPED control proposal and emits it THROUGH the EXISTING
 * human-in-the-loop write flow — it NEVER writes to a device and NEVER touches
 * the command dispatcher's gates.
 *
 *   • reject_divert       — divert the failed unit off the line.
 *   • spi_printer_offset  — a stencil-printer X/Y correction computed from a
 *                           measured SPI paste volume/position trend (run-to-run
 *                           control, damped + clamped).
 *
 * HOW IT STAYS SAFE (the emission path — NOTHING here bypasses a gate):
 *   1. buildControlProposals() is PURE — it only produces data objects
 *      (target machine/tag, computed value, provenance, risk level). No I/O.
 *   2. proposeControlFromVerdict() calls ONLY aiCopilotActions.proposeAction —
 *      the SAME propose-only entry the AI Copilot & auto-proposer use. This
 *      records a `proposed` ai_pending_actions row (dry-run preview, RBAC gate
 *      #1, TTL, token bound to userId). It NEVER confirms, NEVER executes, NEVER
 *      calls tool.execute() or the dispatcher.
 *   3. A human later confirms via the EXISTING aiCopilot.confirmAction, which
 *      re-checks RBAC (gate #2) and runs the write-tool's execute() → which
 *      routes through commandDispatcher.dispatch() with triggeredBy.kind='hitl'.
 *      That inherits — UNCHANGED — the interlock/allowlist/mode gate, the C2
 *      commissioning gate, and the append-only command_log.
 *
 * ADVISORY BY DEFAULT: the whole emission is gated behind VISION_CONTROL_ENABLED
 * (default OFF ⇒ today's behaviour: the quality gate only records + optionally
 * alerts, NO proposal). Even ON, a confirmed proposal actuates for real ONLY when
 * the target adapter is COMMISSIONED (C2) AND OT_CONTROL_ENABLED — otherwise the
 * dispatcher records it `simulated`. PRECEDENCE (composes with the dispatcher):
 *      VISION_CONTROL_ENABLED   → may a proposal be created at all?
 *      OT_CONTROL_ENABLED       → may a confirmed write reach a driver?
 *      OT_COMMISSIONING (C2)    → not-commissioned ⇒ simulated regardless of the above.
 *   A proposal on an uncommissioned adapter therefore stays SIMULATED end-to-end.
 *
 * MIGRATION: NONE. This reuses ai_pending_actions (the existing HITL proposal
 * store). No 0162 table is needed — the proposal IS an ai_pending_action.
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { Tool, ToolLang } from "./aiLocalTools/toolRegistry";

// ─── Flag ────────────────────────────────────────────────────────────────────

/**
 * Master flag for the quality→control loop. Default OFF (advisory-only): when
 * unset/anything-but-"true", NO proposal is emitted and the quality gate behaves
 * exactly as before. Read at RUNTIME so ops/tests can toggle it.
 */
export function isVisionControlEnabled(): boolean {
  return process.env.VISION_CONTROL_ENABLED === "true";
}

function maxProposalsPerRun(): number {
  const v = Number(process.env.VISION_CONTROL_MAX_PER_RUN);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ControlProposalKind = "reject_divert" | "spi_printer_offset";
export type RiskLevel = "low" | "medium" | "high";

/** Honest provenance carried on every proposal (and into the ai_pending_actions row). */
export interface ControlProvenance {
  inspectionId: number | null;
  machineId: number | null;
  productModelId: number | null;
  modelId: number | null;
  modelVersion: string | null;
  confidence: number | null;
  decision: string;
  topLabel: string | null;
  source: "quality_gate" | "anomaly";
}

/** A single typed control proposal (a DATA object — nothing is actuated here). */
export interface ControlProposal {
  kind: ControlProposalKind;
  /** Registered write-tool this proposal is emitted through (HITL). */
  tool: string;
  /** Args stored in the ai_pending_actions row (the ONLY source of truth at execute). */
  args: Record<string, unknown>;
  /** The value(s) the confirmed write would send (for the confirm card / audit). */
  computedValue: unknown;
  riskLevel: RiskLevel;
  provenance: ControlProvenance;
  rationale: string;
}

// ─── Deterministic SPI printer-offset computation (PURE) ────────────────────────

/** One SPI sample: measured paste-deposit offset from pad centre (µm) + optional volume%. */
export interface SpiTrendSample {
  inspectionId?: number | null;
  /** Measured deposit offset from pad centre in +X (µm). */
  offsetXUm: number;
  /** Measured deposit offset from pad centre in +Y (µm). */
  offsetYUm: number;
  /** Measured solder-paste volume as a % of nominal (optional, informational). */
  volumePct?: number | null;
}

export interface SpiOffsetOptions {
  /** Closed-loop damping 0..1 (fraction of the mean drift corrected). Default 0.5. */
  gain?: number;
  /** Max single-step correction magnitude (µm) — safety clamp. Default 50. */
  maxStepUm?: number;
  /** Deadband (µm): mean drift within this on BOTH axes ⇒ no correction worth proposing. Default 5. */
  deadbandUm?: number;
  /** Only the most-recent `window` samples are used. Default 20 (capped at 50). */
  window?: number;
  /** Decimal places the correction is rounded to (determinism). Default 1. */
  roundDp?: number;
}

export interface SpiOffsetResult {
  /** Stencil-printer X correction to apply (µm) — opposite sign to the measured drift. */
  offsetXUm: number;
  /** Stencil-printer Y correction to apply (µm). */
  offsetYUm: number;
  samplesUsed: number;
  meanOffsetXUm: number;
  meanOffsetYUm: number;
  meanVolumePct: number | null;
  gain: number;
  maxStepUm: number;
  deadbandUm: number;
  /** true ⇒ drift is within the deadband on both axes → NOT worth a correction. */
  withinDeadband: boolean;
  /** true ⇒ the raw correction was clamped to ±maxStepUm on at least one axis. */
  clamped: boolean;
}

function roundTo(n: number, dp: number): number {
  const f = Math.pow(10, Math.max(0, Math.trunc(dp)));
  // Guard -0 so equality tests are stable.
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * computeSpiPrinterOffset — DETERMINISTIC run-to-run printer correction from a
 * measured SPI position trend.
 *
 * Correction = -gain × mean(measured offset), clamped to ±maxStepUm, rounded.
 * The negative sign re-centres the deposit (correct OPPOSITE to the drift); the
 * gain damps the loop to avoid over-correction/oscillation; the clamp is a hard
 * safety bound; the deadband suppresses noise-level corrections.
 *
 * PURE + deterministic: identical input ⇒ identical output (no time/random/I/O).
 */
export function computeSpiPrinterOffset(
  trend: SpiTrendSample[],
  opts: SpiOffsetOptions = {},
): SpiOffsetResult {
  const gain = Number.isFinite(opts.gain) && (opts.gain as number) >= 0 ? (opts.gain as number) : 0.5;
  const maxStepUm = Number.isFinite(opts.maxStepUm) && (opts.maxStepUm as number) > 0 ? (opts.maxStepUm as number) : 50;
  const deadbandUm = Number.isFinite(opts.deadbandUm) && (opts.deadbandUm as number) >= 0 ? (opts.deadbandUm as number) : 5;
  const window = Number.isFinite(opts.window) && (opts.window as number) > 0 ? Math.min(50, Math.trunc(opts.window as number)) : 20;
  const roundDp = Number.isFinite(opts.roundDp) && (opts.roundDp as number) >= 0 ? Math.trunc(opts.roundDp as number) : 1;

  // Keep only finite samples; take the most-recent `window` (trend is oldest→newest).
  const clean = trend.filter((s) => s && Number.isFinite(s.offsetXUm) && Number.isFinite(s.offsetYUm));
  const used = clean.slice(Math.max(0, clean.length - window));
  const n = used.length;

  if (n === 0) {
    return {
      offsetXUm: 0, offsetYUm: 0, samplesUsed: 0,
      meanOffsetXUm: 0, meanOffsetYUm: 0, meanVolumePct: null,
      gain, maxStepUm, deadbandUm, withinDeadband: true, clamped: false,
    };
  }

  let sx = 0, sy = 0, vSum = 0, vCount = 0;
  for (const s of used) {
    sx += s.offsetXUm;
    sy += s.offsetYUm;
    if (s.volumePct != null && Number.isFinite(s.volumePct)) { vSum += s.volumePct; vCount++; }
  }
  const meanX = sx / n;
  const meanY = sy / n;

  const rawX = -gain * meanX;
  const rawY = -gain * meanY;
  const clX = clamp(rawX, -maxStepUm, maxStepUm);
  const clY = clamp(rawY, -maxStepUm, maxStepUm);
  const clamped = clX !== rawX || clY !== rawY;

  return {
    offsetXUm: roundTo(clX, roundDp),
    offsetYUm: roundTo(clY, roundDp),
    samplesUsed: n,
    meanOffsetXUm: roundTo(meanX, roundDp),
    meanOffsetYUm: roundTo(meanY, roundDp),
    meanVolumePct: vCount > 0 ? roundTo(vSum / vCount, roundDp) : null,
    gain, maxStepUm, deadbandUm,
    withinDeadband: Math.abs(meanX) <= deadbandUm && Math.abs(meanY) <= deadbandUm,
    clamped,
  };
}

// ─── Proposal builder (PURE) ────────────────────────────────────────────────────

export interface BuildProposalsInput {
  verdict: {
    decision: string;               // e.g. "AUTO_NG"
    confidence: number | null;      // 0..1 classifier confidence; null for anomaly (no classifier conf)
    topLabel?: string | null;
    source?: "quality_gate" | "anomaly";
  };
  inspectionId: number | null;
  machineId: number | null;
  productModelId?: number | null;
  modelId?: number | null;
  modelVersion?: string | null;
  /** Optional SPI position/volume trend → enables an spi_printer_offset proposal. */
  spiTrend?: SpiTrendSample[];
  spiOpts?: SpiOffsetOptions;
}

/** A gated NG verdict OR a confirmed anomaly — the only cases that yield a proposal. */
export function isGatedNgOrAnomaly(decision: string, source?: string): boolean {
  const d = (decision ?? "").toUpperCase();
  return d === "AUTO_NG" || d === "NG" || source === "anomaly" || d.includes("ANOMALY");
}

/**
 * buildControlProposals — PURE: turn a gated verdict (+ optional SPI trend) into
 * zero or more TYPED proposals. No I/O, deterministic.
 *
 *   • reject_divert    — always for a gated NG/anomaly WITH a machine target.
 *   • spi_printer_offset — only when an SPI trend is supplied AND the computed
 *     correction escapes the deadband (i.e. a real, non-noise drift to correct).
 */
export function buildControlProposals(input: BuildProposalsInput): ControlProposal[] {
  const { verdict, machineId } = input;
  const source = verdict.source ?? "quality_gate";

  if (!isGatedNgOrAnomaly(verdict.decision, source)) return [];
  if (machineId == null) return []; // no controllable target → advisory-only

  const provenance: ControlProvenance = {
    inspectionId: input.inspectionId ?? null,
    machineId,
    productModelId: input.productModelId ?? null,
    modelId: input.modelId ?? null,
    modelVersion: input.modelVersion ?? null,
    confidence: Number.isFinite(verdict.confidence) ? (verdict.confidence as number) : null,
    decision: verdict.decision,
    topLabel: verdict.topLabel ?? null,
    source,
  };

  const proposals: ControlProposal[] = [];

  // (1) reject_divert — remove the failed unit from the line.
  {
    const unitRef = input.inspectionId != null ? String(input.inspectionId) : undefined;
    proposals.push({
      kind: "reject_divert",
      tool: "reject_divert",
      args: {
        machineId,
        ...(unitRef ? { unitRef } : {}),
        provenance,
      },
      computedValue: true,
      // Removing a bad part is inherently defensive, but it IS a physical divert.
      riskLevel: "medium",
      provenance,
      rationale:
        `Quality gate flagged ${verdict.decision}` +
        (verdict.topLabel ? ` ("${verdict.topLabel}")` : "") +
        ` at ${(provenance.confidence != null ? (provenance.confidence * 100).toFixed(1) + "%" : "n/a")} confidence` +
        ` — propose diverting the failed unit off the line (requires your confirmation).`,
    });
  }

  // (2) spi_printer_offset — only with a real, out-of-deadband measured drift.
  if (input.spiTrend && input.spiTrend.length > 0) {
    const offset = computeSpiPrinterOffset(input.spiTrend, input.spiOpts);
    if (offset.samplesUsed > 0 && !offset.withinDeadband) {
      proposals.push({
        kind: "spi_printer_offset",
        tool: "spi_printer_offset",
        args: {
          machineId,
          offsetXUm: offset.offsetXUm,
          offsetYUm: offset.offsetYUm,
          provenance,
        },
        computedValue: { offsetXUm: offset.offsetXUm, offsetYUm: offset.offsetYUm },
        riskLevel: "medium",
        provenance,
        rationale:
          `SPI trend over ${offset.samplesUsed} sample(s) shows a mean deposit drift of ` +
          `(${offset.meanOffsetXUm}, ${offset.meanOffsetYUm}) µm` +
          (offset.meanVolumePct != null ? `, mean volume ${offset.meanVolumePct}%` : "") +
          ` — propose a damped stencil-printer correction of (${offset.offsetXUm}, ${offset.offsetYUm}) µm ` +
          `(gain ${offset.gain}, clamped ±${offset.maxStepUm} µm). Requires your confirmation.`,
      });
    }
  }

  return proposals;
}

// ─── Impure orchestration: emit proposals THROUGH the HITL propose flow ─────────

export interface CopilotTargetUser {
  id: number;
  role: string;
  name?: string | null;
}

/** Injectable seams (default to the real DB/HITL implementations). */
export interface ProposeControlDeps {
  /** PROPOSE-ONLY entry (never confirm/execute). Defaults to aiCopilotActions.proposeAction. */
  propose?: (
    tool: Tool<any, any>,
    args: Record<string, unknown>,
    ctx: { user: CopilotTargetUser; lang: ToolLang },
  ) => Promise<{ ok: boolean; pendingAction?: { actionId?: string } | null; denied?: boolean; reason?: string }>;
  /** Resolve the users who should receive a proposal (hold the tool's RBAC in the factory). */
  findTargets?: (
    factoryCode: string | null,
    perm: { module: string; action: string },
    cap: number,
  ) => Promise<CopilotTargetUser[]>;
  /** Resolve a registered write-tool by name (defaults to the tool registry). */
  getToolByName?: (name: string) => Tool<any, any> | undefined;
  /** Resolve the factory code for a machine (for user targeting). */
  resolveFactory?: (machineId: number) => Promise<string | null>;
}

export interface ControlProposeResult {
  proposed: number;
  skippedReason?: string;
  /** ai_pending_actions ids created (for observability / tests). */
  actionIds: string[];
  /** The typed proposals that were built (regardless of how many were emitted). */
  proposals: ControlProposal[];
}

/**
 * proposeControlFromVerdict — the flag-gated, PROPOSE-ONLY pipeline. Builds typed
 * proposals from a verdict and lands each in the responsible users' inbox as an
 * ai_pending_actions row. It NEVER confirms/executes and NEVER touches a driver.
 *
 * SAFETY INVARIANT (ABSOLUTE): the ONLY write-path call this makes is `propose`
 * (aiCopilotActions.proposeAction). Everything downstream (confirm → execute →
 * dispatch) is a SEPARATE, human-triggered step that re-checks every gate.
 */
export async function proposeControlFromVerdict(
  input: BuildProposalsInput,
  deps: ProposeControlDeps = {},
  lang: ToolLang = "vi",
): Promise<ControlProposeResult> {
  if (!isVisionControlEnabled()) {
    return { proposed: 0, skippedReason: "DISABLED", actionIds: [], proposals: [] };
  }

  const proposals = buildControlProposals(input);
  if (proposals.length === 0) {
    return { proposed: 0, skippedReason: "NO_PROPOSAL", actionIds: [], proposals };
  }
  if (input.machineId == null) {
    return { proposed: 0, skippedReason: "NO_MACHINE", actionIds: [], proposals };
  }

  const propose = deps.propose ?? (await defaultPropose());
  const getToolByName = deps.getToolByName ?? (await defaultGetTool());
  const findTargets = deps.findTargets ?? defaultFindTargets;
  const resolveFactory = deps.resolveFactory ?? defaultResolveFactory;

  const factoryCode = await resolveFactory(input.machineId).catch(() => null);
  const cap = maxProposalsPerRun();
  const actionIds: string[] = [];

  for (const proposal of proposals) {
    if (actionIds.length >= cap) break;
    const tool = getToolByName(proposal.tool);
    if (!tool || tool.kind !== "write" || !tool.requiredPermission) {
      console.warn(`[qualityControlProposer] tool "${proposal.tool}" unavailable — skipped`);
      continue;
    }

    let targets: CopilotTargetUser[];
    try {
      targets = await findTargets(factoryCode, tool.requiredPermission, cap);
    } catch (err) {
      console.warn(`[qualityControlProposer] findTargets failed: ${(err as Error)?.message ?? err}`);
      targets = [];
    }
    if (targets.length === 0) continue;

    for (const user of targets) {
      if (actionIds.length >= cap) break;
      try {
        // HITL: PROPOSE ONLY. Never confirm/execute. RBAC gate #1 is inside propose.
        const res = await propose(tool, proposal.args, { user, lang });
        if (res.ok && res.pendingAction?.actionId) actionIds.push(res.pendingAction.actionId);
        else if (res.ok) actionIds.push("(created)"); // propose ok but id shape differs (test doubles)
      } catch (err) {
        console.warn(`[qualityControlProposer] propose failed: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  return {
    proposed: actionIds.length,
    skippedReason: actionIds.length === 0 ? "NO_TARGETS_OR_PROPOSE_FAILED" : undefined,
    actionIds,
    proposals,
  };
}

/**
 * proposeControlForInspection — convenience the quality gate calls: look up the
 * inspection's machine/product, then propose. Best-effort + fail-safe (returns a
 * skipped result on any error; NEVER throws into the gate pipeline).
 */
export async function proposeControlForInspection(
  inspectionId: number,
  verdict: BuildProposalsInput["verdict"],
  opts?: {
    modelId?: number | null;
    modelVersion?: string | null;
    spiTrend?: SpiTrendSample[];
    spiOpts?: SpiOffsetOptions;
    deps?: ProposeControlDeps;
    lang?: ToolLang;
  },
): Promise<ControlProposeResult> {
  try {
    if (!isVisionControlEnabled()) {
      return { proposed: 0, skippedReason: "DISABLED", actionIds: [], proposals: [] };
    }
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return { proposed: 0, skippedReason: "DB_UNAVAILABLE", actionIds: [], proposals: [] };
    const { eq } = await import("drizzle-orm");
    const { productInspections } = await import("../../drizzle/schema");
    const [insp] = await db
      .select({ machineId: productInspections.machineId, productModelId: productInspections.productModelId })
      .from(productInspections)
      .where(eq(productInspections.id, inspectionId))
      .limit(1);

    return await proposeControlFromVerdict(
      {
        verdict,
        inspectionId,
        machineId: insp?.machineId ?? null,
        productModelId: insp?.productModelId ?? null,
        modelId: opts?.modelId ?? null,
        modelVersion: opts?.modelVersion ?? null,
        spiTrend: opts?.spiTrend,
        spiOpts: opts?.spiOpts,
      },
      opts?.deps ?? {},
      opts?.lang ?? "vi",
    );
  } catch (err) {
    console.warn(`[qualityControlProposer] proposeControlForInspection failed: ${(err as Error)?.message ?? err}`);
    return { proposed: 0, skippedReason: "ERROR", actionIds: [], proposals: [] };
  }
}

// ─── Default (production) dependency implementations ───────────────────────────

async function defaultPropose() {
  const { proposeAction } = await import("./aiCopilotActions");
  return (tool: Tool<any, any>, args: Record<string, unknown>, ctx: { user: CopilotTargetUser; lang: ToolLang }) =>
    proposeAction(tool, args, ctx as any) as any;
}

async function defaultGetTool() {
  // Ensure the vision-control write-tools are registered (side-effect, idempotent).
  await import("./aiLocalTools/writeHandlers/visionControl").catch(() => undefined);
  const { getTool } = await import("./aiLocalTools/toolRegistry");
  return (name: string) => getTool(name);
}

/**
 * Resolve the factory.code for a machine id via the ISA-95 hierarchy chain.
 * Fail-safe: null on any error (targeting then falls back to unscoped).
 */
async function defaultResolveFactory(machineId: number): Promise<string | null> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return null;
    const { eq } = await import("drizzle-orm");
    const { machines, stations, productionLines, workshops, factories } = await import("../../drizzle/schema");
    const [row] = await db
      .select({ factoryCode: factories.code })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .innerJoin(factories, eq(workshops.factoryId, factories.id))
      .where(eq(machines.id, machineId))
      .limit(1);
    return row?.factoryCode ?? null;
  } catch {
    return null;
  }
}

/**
 * Find users who HOLD the tool's permission and are responsible for the factory.
 * Mirrors aiAutoProposer.findResponsibleUsers (role maintenance/supervisor,
 * factory-scoped, RBAC-checked). Fail-safe → [] on any error.
 */
async function defaultFindTargets(
  factoryCode: string | null,
  perm: { module: string; action: string },
  cap: number,
): Promise<CopilotTargetUser[]> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return [];
    const { inArray, eq, and } = await import("drizzle-orm");
    const { users, userFactoryAssignments } = await import("../../drizzle/schema");
    const { checkPermission } = await import("../_core/accessControl");

    const targetRoles = ["maintenance", "supervisor"];
    const candidates = await db
      .select({ id: users.id, role: users.role, name: users.name })
      .from(users)
      .where(and(inArray(users.role, targetRoles as any), eq(users.isActive, true)));

    let scoped = candidates;
    if (factoryCode) {
      const assigns = await db
        .select({ userId: userFactoryAssignments.userId })
        .from(userFactoryAssignments)
        .where(eq(userFactoryAssignments.factoryCode, factoryCode));
      const ids = new Set(assigns.map((a) => a.userId));
      scoped = candidates.filter((u) => ids.has(u.id));
    }

    const permitted: CopilotTargetUser[] = [];
    for (const u of scoped) {
      if (permitted.length >= cap) break;
      try {
        const ok = await checkPermission(u.id, String(u.role), perm.module, perm.action as any);
        if (ok) permitted.push({ id: u.id, role: String(u.role), name: u.name });
      } catch {
        /* skip on permission error */
      }
    }
    return permitted;
  } catch (err) {
    console.warn(`[qualityControlProposer] defaultFindTargets failed: ${(err as Error)?.message ?? err}`);
    return [];
  }
}
