/**
 * AI RCA Copilot — LUỒNG ③ (doc 06): AI tự chẩn đoán lỗi → đề xuất cách sửa
 * quyết-định-sẵn; kỹ thuật chỉ duyệt (1 chạm). Lớp ĐIỀU PHỐI: gom các service
 * đã có thành một chẩn đoán xếp hạng; KHÔNG làm lại phân tích/model/graph.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY / HITL (tuyệt đối):
 *   - RCA chỉ ĐỀ XUẤT. WRITE fix → proposeAction (HITL propose→confirm). Không
 *     có code path nào ở đây tự confirm/execute. Args của fix luôn được validate
 *     trong bounds của tool (zod safeParse) trước khi đánh dấu "1-tap".
 *   - Fail-safe: mọi nguồn bằng chứng wrap try/catch → degrade trung thực. Thiếu
 *     dữ liệu/độ tin cậy thấp → hypotheses rỗng + ghi chú "cần người xem", KHÔNG
 *     bịa nguyên nhân hay fix ngoài bounds.
 *   - Flag AI_RCA_COPILOT_ENABLED (mặc định OFF) → runRca no-op trả về rỗng.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db/connection";
import { rootCauseAnalysis } from "../../drizzle/schema";
import { getTool, isWriteTool, type Tool, type ToolLang } from "./aiLocalTools/toolRegistry";
import { proposeAction, type CopilotUser } from "./aiCopilotActions";

// ─── Flag ────────────────────────────────────────────────────────────────────
export function isRcaCopilotEnabled(): boolean {
  return (process.env.AI_RCA_COPILOT_ENABLED ?? "false").toLowerCase() === "true";
}

// Minimum confidence for a hypothesis to be retained (below → drop as too weak).
const MIN_HYPOTHESIS_CONFIDENCE = Number(process.env.AI_RCA_MIN_CONFIDENCE ?? 0.2);
const MAX_HYPOTHESES = 3;

// ─── Public shapes ─────────────────────────────────────────────────────────────

export type RcaFixKind = "WRITE" | "MANUAL" | "INVESTIGATE";

export interface RcaRecommendedFix {
  kind: RcaFixKind;
  /** WRITE only — the write-tool name this fix maps to (must exist in registry). */
  tool?: string;
  /** WRITE only — validated args (within tool bounds) for proposeAction. */
  args?: Record<string, unknown>;
  /** MANUAL/INVESTIGATE — step-by-step guidance. */
  steps?: string[];
  rationale: string;
  /** True only when kind==='WRITE', the tool exists and args pass zod. */
  oneTap: boolean;
}

export interface RcaHypothesis {
  cause: string;
  confidence: number; // 0..1
  evidence: string[];
  recommendedFix: RcaRecommendedFix;
}

export interface EvidenceBundle {
  paretoTop: Array<{ category: string; count: number; percentage: number }>;
  spc: { cpk: number | null; outOfControlCount: number; violations: string[] } | null;
  anomaly: Record<string, unknown> | null;
  visionDescription: string | null;
  recentConfigChanges: Array<{ at: string; summary: string }>;
  similarIncidents: Array<{ title: string; sourcePath: string; score: number }>;
  causalText: string;
  notes: string[];
}

export interface RcaResult {
  ok: boolean;
  machineId?: number;
  defectType?: string;
  incidentId?: number;
  lang: ToolLang;
  evidence: EvidenceBundle;
  hypotheses: RcaHypothesis[];
  /** Honest-degrade flag: true when evidence/confidence insufficient. */
  needsHumanInvestigation: boolean;
  note?: string;
}

export interface RunRcaInput {
  machineId?: number;
  defectType?: string;
  incidentId?: number;
  lang?: ToolLang;
}

// ─── Empty / degrade helpers ───────────────────────────────────────────────────

function emptyEvidence(): EvidenceBundle {
  return {
    paretoTop: [],
    spc: null,
    anomaly: null,
    visionDescription: null,
    recentConfigChanges: [],
    similarIncidents: [],
    causalText: "",
    notes: [],
  };
}

function degradeResult(input: RunRcaInput, lang: ToolLang, evidence: EvidenceBundle, note: string): RcaResult {
  return {
    ok: true,
    machineId: input.machineId,
    defectType: input.defectType,
    incidentId: input.incidentId,
    lang,
    evidence,
    hypotheses: [],
    needsHumanInvestigation: true,
    note,
  };
}

// ─── Evidence gathering (each fail-safe / optional) ─────────────────────────────

async function gatherEvidence(input: RunRcaInput, lang: ToolLang): Promise<EvidenceBundle> {
  const bundle = emptyEvidence();
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30d window

  const [pareto, spc, anomaly, vision, audit, rag, causal] = await Promise.allSettled([
    // (a) Pareto top defects
    (async () => {
      const { paretoByDefectType } = await import("./paretoAnalysisService");
      const r = await paretoByDefectType({ startDate: start, endDate: now, machineId: input.machineId, limit: 5 });
      return r.items.slice(0, 5).map((i) => ({ category: i.category, count: i.count, percentage: i.percentage }));
    })(),
    // (b) SPC out-of-control + Cpk
    (async () => {
      const { getControlChart } = await import("./aiInspectionAnalytics");
      const chart = await getControlChart({ startDate: start, endDate: now, machineId: input.machineId }, "defectRate");
      return {
        cpk: chart.summary.cpk,
        outOfControlCount: chart.summary.outOfControlCount,
        violations: (chart.summary.spcViolations ?? []).map((v: any) => v.ruleName ?? String(v.ruleId ?? "")).filter(Boolean),
      };
    })(),
    // (c) anomaly status
    (async () => {
      if (input.machineId == null) return null;
      const { getAnomalyStats } = await import("./aiAnomalyDetection");
      return (await getAnomalyStats({ machineId: input.machineId })) as Record<string, unknown>;
    })(),
    // (d) vision description of a suspect image — optional; skipped when no image source.
    (async () => {
      // No deterministic suspect-image fetch wired here; left null unless a future
      // hook supplies a buffer. describeDefect requires a Buffer we don't fabricate.
      return null as string | null;
    })(),
    // (e) recent config changes from audit
    (async () => {
      return await fetchRecentConfigChanges(input.machineId, start);
    })(),
    // (f) similar past incidents via GraphRAG (reranker)
    (async () => {
      const { retrieveKnowledge } = await import("./aiLocalKnowledgeService");
      const q = [input.defectType, input.machineId ? `machine ${input.machineId}` : ""].filter(Boolean).join(" ") || "defect root cause";
      const r = await retrieveKnowledge(q, 5);
      return (r.citations ?? []).map((c: any) => ({ title: c.title, sourcePath: c.sourcePath, score: c.score }));
    })(),
    // causal-graph context (hybridDefectContext)
    (async () => {
      const { hybridDefectContext } = await import("./aiCausalGraph");
      const { retrieveKnowledge } = await import("./aiLocalKnowledgeService");
      const defectText = input.defectType ?? "defect";
      const machineText = input.machineId != null ? `machine ${input.machineId}` : null;
      const ctx = await hybridDefectContext(defectText, machineText, async (query) => {
        const r = await retrieveKnowledge(query, 5);
        return (r.citations ?? []).map((c: any) => ({ id: String(c.id), title: c.title, sourcePath: c.sourcePath, score: c.score, text: c.title }));
      });
      return ctx.causalText;
    })(),
  ]);

  if (pareto.status === "fulfilled") bundle.paretoTop = pareto.value;
  else bundle.notes.push("pareto_unavailable");
  if (spc.status === "fulfilled") bundle.spc = spc.value;
  else bundle.notes.push("spc_unavailable");
  if (anomaly.status === "fulfilled") bundle.anomaly = anomaly.value;
  else bundle.notes.push("anomaly_unavailable");
  if (vision.status === "fulfilled") bundle.visionDescription = vision.value;
  else bundle.notes.push("vision_unavailable");
  if (audit.status === "fulfilled") bundle.recentConfigChanges = audit.value;
  else bundle.notes.push("audit_unavailable");
  if (rag.status === "fulfilled") bundle.similarIncidents = rag.value;
  else bundle.notes.push("rag_unavailable");
  if (causal.status === "fulfilled") bundle.causalText = causal.value;
  else bundle.notes.push("causal_unavailable");

  return bundle;
}

/** READ-ONLY audit query for recent config changes touching this machine. Fail-safe. */
async function fetchRecentConfigChanges(
  machineId: number | undefined,
  since: Date,
): Promise<Array<{ at: string; summary: string }>> {
  try {
    const db = await getDb();
    if (!db) return [];
    const { auditLogs } = await import("../../drizzle/schema");
    const rows = await db
      .select()
      .from(auditLogs as any)
      .where(gte((auditLogs as any).createdAt, since) as any)
      .orderBy(desc((auditLogs as any).createdAt) as any)
      .limit(50);
    const out: Array<{ at: string; summary: string }> = [];
    for (const r of rows as any[]) {
      const action = String(r.action ?? "");
      if (!/config|threshold|param|spec|recipe|update|edit/i.test(action)) continue;
      // `details` is a JSON STRING (may carry metadata.machineId). Parse fail-safe.
      let meta: any = {};
      if (typeof r.details === "string" && r.details) {
        try { meta = JSON.parse(r.details); } catch { meta = {}; }
      } else if (r.details && typeof r.details === "object") {
        meta = r.details;
      }
      const mid = meta?.metadata?.machineId ?? meta?.machineId;
      // When the row carries a machineId that doesn't match, skip; else keep
      // (audit_logs has no top-level machineId column, so most rows are kept).
      if (machineId != null && mid != null && Number(mid) !== machineId) continue;
      out.push({ at: (r.createdAt ?? new Date()).toString(), summary: `${action} ${r.entityName ?? ""}`.trim() });
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Deep-model synthesis (GBNF JSON) ───────────────────────────────────────────

// JSON schema (GBNF grammar) constraining the model output.
const RCA_JSON_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cause: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "array", items: { type: "string" } },
          recommendedFix: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["WRITE", "MANUAL", "INVESTIGATE"] },
              tool: { type: "string" },
              args: { type: "object" },
              steps: { type: "array", items: { type: "string" } },
              rationale: { type: "string" },
            },
            required: ["kind", "rationale"],
          },
        },
        required: ["cause", "confidence", "evidence", "recommendedFix"],
      },
    },
  },
  required: ["hypotheses"],
} as const;

interface RawHypothesis {
  cause?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  recommendedFix?: {
    kind?: unknown;
    tool?: unknown;
    args?: unknown;
    steps?: unknown;
    rationale?: unknown;
  };
}

function buildEvidenceDigest(ev: EvidenceBundle): string {
  const lines: string[] = [];
  if (ev.paretoTop.length) lines.push(`Pareto top defects: ${ev.paretoTop.map((p) => `${p.category} (${p.count}, ${p.percentage.toFixed(1)}%)`).join("; ")}`);
  if (ev.spc) lines.push(`SPC: Cpk=${ev.spc.cpk ?? "n/a"}, out-of-control points=${ev.spc.outOfControlCount}, rules=[${ev.spc.violations.join(", ")}]`);
  if (ev.anomaly) lines.push(`Anomaly stats: ${JSON.stringify(ev.anomaly).slice(0, 400)}`);
  if (ev.visionDescription) lines.push(`Vision: ${ev.visionDescription}`);
  if (ev.recentConfigChanges.length) lines.push(`Recent config changes: ${ev.recentConfigChanges.map((c) => c.summary).join("; ")}`);
  if (ev.similarIncidents.length) lines.push(`Similar past incidents: ${ev.similarIncidents.map((s) => s.title).join("; ")}`);
  if (ev.causalText) lines.push(`Causal graph:\n${ev.causalText}`);
  return lines.join("\n");
}

/** True when there is enough signal to even attempt synthesis. */
function hasMeaningfulEvidence(ev: EvidenceBundle): boolean {
  return (
    ev.paretoTop.length > 0 ||
    (ev.spc != null && (ev.spc.outOfControlCount > 0 || ev.spc.cpk != null)) ||
    ev.anomaly != null ||
    ev.visionDescription != null ||
    ev.similarIncidents.length > 0 ||
    ev.causalText.length > 0
  );
}

async function synthesize(input: RunRcaInput, lang: ToolLang, ev: EvidenceBundle): Promise<RawHypothesis[]> {
  try {
    const { route } = await import("./aiModelRouter");
    const { generateJSON } = await import("./aiGgufEngine");
    const decision = route({ task: "rca", text: input.defectType ?? "rca" });

    const sys =
      "You are an SMT/AOI manufacturing root-cause analyst. Using ONLY the supplied evidence, " +
      "produce ranked hypotheses for the defect. NEVER invent evidence. If evidence is weak, " +
      "return fewer hypotheses with lower confidence. Output strictly the JSON schema. " +
      "recommendedFix.kind must be WRITE (maps to a known write-tool), MANUAL (hands-on steps), " +
      "or INVESTIGATE (more data needed). For WRITE, set tool + args only if you are confident.";
    const userPrompt =
      `Defect type: ${input.defectType ?? "(unspecified)"}\n` +
      `Machine: ${input.machineId ?? "(unspecified)"}\n\n` +
      `EVIDENCE:\n${buildEvidenceDigest(ev) || "(no quantitative evidence available)"}\n\n` +
      `Known write-tools you may reference for a WRITE fix: adjust_ng_threshold, configure_inspection_param, ` +
      `create_ng_threshold, update_product_quality_target, set_machine_param, acknowledge_machine_alarm, ` +
      `create_maintenance_workorder.\n` +
      `Return up to ${MAX_HYPOTHESES} hypotheses ranked by confidence (0..1, descending).`;

    const out = await generateJSON<{ hypotheses?: RawHypothesis[] }>(
      RCA_JSON_SCHEMA,
      {
        systemPrompt: sys,
        prompt: userPrompt,
        maxTokens: Math.min(decision.maxTokens, 1024),
        temperature: decision.temperature,
        contextSize: decision.contextSize,
      },
      decision.modelId,
    );
    return Array.isArray(out.data?.hypotheses) ? out.data.hypotheses : [];
  } catch (err) {
    console.warn("[aiRcaCopilot] synthesis failed:", err);
    return [];
  }
}

// ─── Pure rank/validate helper (exported for tests) ─────────────────────────────

/**
 * Normalize, validate and rank raw model hypotheses into safe RcaHypothesis[].
 *
 * - Clamps confidence to [0,1]; drops hypotheses below MIN_HYPOTHESIS_CONFIDENCE.
 * - For a WRITE fix: requires the tool to EXIST + be a write-tool + args pass the
 *   tool's zod schema (within bounds). Otherwise the fix is DOWNGRADED to MANUAL
 *   (if steps/rationale present) or INVESTIGATE — never a fabricated/out-of-bounds
 *   WRITE. oneTap is true ONLY for a fully validated WRITE.
 * - Sorts by confidence desc; returns top `max`.
 *
 * Pure: no DB, no I/O — `lookupTool` is injected (defaults to the live registry).
 */
export function rankAndValidateHypotheses(
  raw: RawHypothesis[],
  opts?: { max?: number; minConfidence?: number; lookupTool?: (name: string) => Tool<any, any> | undefined },
): RcaHypothesis[] {
  const max = opts?.max ?? MAX_HYPOTHESES;
  const minConf = opts?.minConfidence ?? MIN_HYPOTHESIS_CONFIDENCE;
  const lookup = opts?.lookupTool ?? getTool;

  const cleaned: RcaHypothesis[] = [];
  for (const h of raw ?? []) {
    const cause = typeof h?.cause === "string" ? h.cause.trim() : "";
    if (!cause) continue;
    let confidence = typeof h?.confidence === "number" && Number.isFinite(h.confidence) ? h.confidence : 0;
    confidence = Math.max(0, Math.min(1, confidence));
    if (confidence < minConf) continue;

    const evidence = Array.isArray(h?.evidence) ? h.evidence.filter((e): e is string => typeof e === "string") : [];
    const fix = normalizeFix(h?.recommendedFix, lookup);
    cleaned.push({ cause, confidence, evidence, recommendedFix: fix });
  }
  cleaned.sort((a, b) => b.confidence - a.confidence);
  return cleaned.slice(0, max);
}

function normalizeFix(
  raw: RawHypothesis["recommendedFix"],
  lookup: (name: string) => Tool<any, any> | undefined,
): RcaRecommendedFix {
  const rationale = typeof raw?.rationale === "string" && raw.rationale.trim() ? raw.rationale.trim() : "No rationale provided.";
  const steps = Array.isArray(raw?.steps) ? raw!.steps.filter((s): s is string => typeof s === "string") : undefined;
  const kindRaw = typeof raw?.kind === "string" ? raw.kind.toUpperCase() : "INVESTIGATE";

  if (kindRaw === "WRITE") {
    const toolName = typeof raw?.tool === "string" ? raw.tool : "";
    const tool = toolName ? lookup(toolName) : undefined;
    const args = raw?.args && typeof raw.args === "object" && !Array.isArray(raw.args) ? (raw.args as Record<string, unknown>) : undefined;

    if (tool && isWriteTool(tool) && args) {
      const parsed = (tool.parameters as z.ZodType<any>).safeParse(args);
      if (parsed.success) {
        // Fully validated, within-bounds WRITE → eligible for 1-tap propose.
        return { kind: "WRITE", tool: toolName, args: parsed.data as Record<string, unknown>, rationale, oneTap: true };
      }
    }
    // Tool missing / not a write tool / args out-of-bounds → DO NOT fabricate.
    // Downgrade to MANUAL if there is actionable guidance, else INVESTIGATE.
    if (steps && steps.length) return { kind: "MANUAL", steps, rationale, oneTap: false };
    return { kind: "INVESTIGATE", steps, rationale, oneTap: false };
  }

  if (kindRaw === "MANUAL") {
    return { kind: "MANUAL", steps, rationale, oneTap: false };
  }
  return { kind: "INVESTIGATE", steps, rationale, oneTap: false };
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

/** Run the full RCA pipeline. Fail-safe: NEVER throws. Flag-gated. */
export async function runRca(input: RunRcaInput): Promise<RcaResult> {
  const lang: ToolLang = input.lang ?? "vi";
  if (!isRcaCopilotEnabled()) {
    return { ...degradeResult(input, lang, emptyEvidence(), "AI_RCA_COPILOT_DISABLED"), ok: false };
  }
  try {
    const evidence = await gatherEvidence(input, lang);
    if (!hasMeaningfulEvidence(evidence)) {
      return degradeResult(input, lang, evidence, "INSUFFICIENT_EVIDENCE");
    }
    const raw = await synthesize(input, lang, evidence);
    const hypotheses = rankAndValidateHypotheses(raw);
    if (hypotheses.length === 0) {
      return degradeResult(input, lang, evidence, "NO_CONFIDENT_HYPOTHESIS");
    }
    return {
      ok: true,
      machineId: input.machineId,
      defectType: input.defectType,
      incidentId: input.incidentId,
      lang,
      evidence,
      hypotheses,
      needsHumanInvestigation: false,
    };
  } catch (err) {
    console.warn("[aiRcaCopilot] runRca failed:", err);
    return degradeResult(input, lang, emptyEvidence(), "RCA_ERROR");
  }
}

// ─── Persist ─────────────────────────────────────────────────────────────────────

export interface PersistRcaInput {
  result: RcaResult;
  requestedBy: number;
  requestedByName?: string | null;
}

/** Persist an RCA result into root_cause_analysis. Returns rcaId or null. Fail-safe. */
export async function persistRca(input: PersistRcaInput): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const { result } = input;
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const top = result.hypotheses[0];
    const topFactors = result.hypotheses.length
      ? result.hypotheses.map((h) => ({
          factor: h.cause,
          contribution: Math.round(h.confidence * 100),
          description: h.recommendedFix.rationale,
          trend: "stable" as const,
        }))
      : [{ factor: result.note ?? "needs_human_investigation", contribution: 0, description: "Insufficient evidence to diagnose with confidence.", trend: "stable" as const }];

    const aiInsights = {
      summary: top ? `Top cause: ${top.cause} (${Math.round(top.confidence * 100)}%).` : "Need human investigation — insufficient evidence.",
      rootCauses: result.hypotheses.map((h) => ({ cause: h.cause, probability: h.confidence, evidence: h.evidence.join("; ") })),
      recommendations: result.hypotheses.map((h) => ({
        action: h.recommendedFix.kind === "WRITE" ? `${h.recommendedFix.tool} ${JSON.stringify(h.recommendedFix.args ?? {})}` : (h.recommendedFix.steps?.join(" → ") ?? h.recommendedFix.rationale),
        priority: (h.confidence >= 0.7 ? "high" : h.confidence >= 0.4 ? "medium" : "low") as "high" | "medium" | "low",
        expectedImpact: h.recommendedFix.rationale,
      })),
      preventiveMeasures: [],
      // Structured RCA payload (full hypotheses incl. fix kind/tool/args/oneTap).
      rcaHypotheses: result.hypotheses,
      needsHumanInvestigation: result.needsHumanInvestigation,
    };

    const [row] = await db
      .insert(rootCauseAnalysis)
      .values({
        analysisType: "DEFECT_ANALYSIS",
        machineId: result.machineId ?? null,
        startDate: start,
        endDate: now,
        dataPointsAnalyzed: result.evidence.paretoTop.reduce((s, p) => s + p.count, 0),
        topFactors,
        aiInsights: aiInsights as any,
        status: "COMPLETED",
        requestedBy: input.requestedBy,
        requestedByName: input.requestedByName ?? null,
      } as any)
      .returning({ id: rootCauseAnalysis.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("[aiRcaCopilot] persistRca failed:", err);
    return null;
  }
}

/** Read recent persisted RCAs (optionally scoped to a machine). Fail-safe. */
export async function latestRca(machineId?: number, limit = 10) {
  try {
    const db = await getDb();
    if (!db) return [];
    const base = db.select().from(rootCauseAnalysis);
    const rows = machineId != null
      ? await base.where(eq(rootCauseAnalysis.machineId, machineId)).orderBy(desc(rootCauseAnalysis.createdAt)).limit(limit)
      : await base.orderBy(desc(rootCauseAnalysis.createdAt)).limit(limit);
    return rows;
  } catch (err) {
    console.warn("[aiRcaCopilot] latestRca failed:", err);
    return [];
  }
}

// ─── Propose the top fix (HITL — never auto-confirm) ─────────────────────────────

export interface ProposeTopFixResult {
  ok: boolean;
  /** Pending action id for the UI to confirm via aiCopilot.confirmAction. */
  actionId?: string;
  reason?: string;
  message?: string;
}

/**
 * If the top hypothesis fix is a validated WRITE (oneTap), propose it to the user
 * (HITL) so it lands in their inbox. NEVER confirms/executes. Reloads the RCA from
 * DB so args come from the persisted structured payload, not a client body.
 */
export async function proposeTopFix(rcaId: number, user: CopilotUser, lang: ToolLang = "vi"): Promise<ProposeTopFixResult> {
  try {
    const db = await getDb();
    if (!db) return { ok: false, reason: "DB_UNAVAILABLE" };
    const [row] = await db.select().from(rootCauseAnalysis).where(eq(rootCauseAnalysis.id, rcaId)).limit(1);
    if (!row) return { ok: false, reason: "NOT_FOUND" };

    const insights = row.aiInsights as any;
    const hyps: RcaHypothesis[] = Array.isArray(insights?.rcaHypotheses) ? insights.rcaHypotheses : [];
    const top = hyps[0];
    if (!top) return { ok: false, reason: "NO_HYPOTHESIS" };

    const fix = top.recommendedFix;
    if (fix.kind !== "WRITE" || !fix.oneTap || !fix.tool || !fix.args) {
      return { ok: false, reason: "FIX_NOT_ONE_TAP", message: "Top fix is manual/investigate — no 1-tap WRITE to propose." };
    }
    const tool = getTool(fix.tool);
    if (!tool || !isWriteTool(tool)) return { ok: false, reason: "TOOL_UNAVAILABLE" };

    // Re-validate args against current tool bounds (defense in depth).
    const parsed = (tool.parameters as z.ZodType<any>).safeParse(fix.args);
    if (!parsed.success) return { ok: false, reason: "ARGS_OUT_OF_BOUNDS" };

    const res = await proposeAction(tool, parsed.data as Record<string, unknown>, { user, lang });
    if (!res.ok || !res.pendingAction) {
      return { ok: false, reason: res.reason ?? "PROPOSE_FAILED", message: res.message };
    }
    return { ok: true, actionId: res.pendingAction.actionId };
  } catch (err) {
    console.warn("[aiRcaCopilot] proposeTopFix failed:", err);
    return { ok: false, reason: "ERROR" };
  }
}

// Input schema (exported for the router).
export const runRcaInputSchema = z
  .object({
    machineId: z.number().int().positive().optional(),
    defectType: z.string().min(1).max(256).optional(),
    incidentId: z.number().int().positive().optional(),
  })
  .strict();
