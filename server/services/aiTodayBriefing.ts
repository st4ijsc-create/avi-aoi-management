/**
 * AI "Today" Briefing — role-aware, zero-click personalized summary on login.
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§2).
 *
 * GOAL: minimum user effort. The moment a user logs in they SEE a small,
 * personalized, severity-aware summary — NO navigation, NO query. This service
 * COMPOSES (read-only) the EXISTING analytics/PdM/anomaly sources into one
 * typed, role-routed object + a localized one-line headline.
 *
 *   - maintenance/technician → machines needing attention (high PdM risk /
 *     recent anomaly), open proposals count, top actions.
 *   - operator               → my line status (yield, NG count), active alerts,
 *     anomaly machines (assigned scope).
 *   - supervisor/manager/admin → exception-first shift KPIs (OEE, yield, NG
 *     rate, throughput), exceptions, top defect, PdM-risk count.
 *   - quality_inspector/engineer     → yield/NG-rate/top-defect (defect/SPC focus;
 *     W0-E: engineer/kỹ thuật reuses this instead of falling through to viewer).
 *   - viewer/user             → the same sensible read-only subset.
 *
 * PRINCIPLES (match aiActionInbox / aiExecutiveReport):
 *  - ADDITIVE + FAIL-SAFE: every section is wrapped; a failing source → that
 *    section is omitted/empty + a soft warning. NEVER throws (runs every login).
 *  - CHEAP: bounded queries (machine cap, short window), services called directly
 *    (not through the tool layer).
 *  - SCOPE + ROLE aware: admin sees all factories; others limited to their
 *    userFactoryAssignments (same scoping model as aiActionInbox).
 *  - i18n: vi primary; headline localized for vi/en/zh.
 */

import { getUserFactoryAssignments } from "../db/auth";

// ─── Public types ──────────────────────────────────────────────────────────────

export type BriefingRole =
  | "maintenance"
  | "operator"
  | "manager"
  | "quality"
  | "viewer";

export type BriefingLang = "vi" | "en" | "zh";
export type BriefingSeverity = "critical" | "warning" | "info" | "ok";

export type BriefingUser = { id: number; role: string; name?: string | null };

/** A "needs attention" row — machine-anchored, deep-linkable from the UI. */
export interface AttentionRow {
  machineCode: string;
  /** Localized one-line reason. */
  reason: string;
  severity: BriefingSeverity;
  /** PdM failure risk 0-100 (when the row originates from PdM). */
  pdmRisk?: number;
  /** Recent anomaly score 0-1 (when the row originates from anomaly). */
  anomaly?: number;
}

export interface MaintenancePayload {
  machinesNeedingAttention: AttentionRow[];
  openProposals: number;
  topActions: string[];
}

export interface OperatorPayload {
  myLineStatus: { yield: number | null; ngCount: number };
  activeAlerts: AttentionRow[];
  anomalyMachines: AttentionRow[];
}

export interface ManagerPayload {
  shiftKpis: { oee: number | null; yield: number | null; ngRate: number | null; throughput: number };
  exceptions: AttentionRow[];
  topDefect: { type: string; count: number; percentage: number } | null;
  pdmRiskCount: number;
}

export interface QualityPayload {
  yield: number | null;
  ngRate: number | null;
  ngCount: number;
  topDefect: { type: string; count: number; percentage: number } | null;
}

export type BriefingPayload =
  | ({ role: "maintenance" } & MaintenancePayload)
  | ({ role: "operator" } & OperatorPayload)
  | ({ role: "manager" } & ManagerPayload)
  | ({ role: "quality" | "viewer" } & QualityPayload);

export interface TodayBriefing {
  role: BriefingRole;
  lang: BriefingLang;
  /** Overall severity (drives the card accent + the headline tone). */
  severity: BriefingSeverity;
  /** Localized one-line summary — shown big, glanceable. */
  headline: string;
  /** The role-specific structured payload. */
  payload: BriefingPayload;
  /** Soft, non-fatal source failures (transparency; never a crash). */
  warnings: string[];
  generatedAt: string;
}

// ─── Config (bounded / cheap) ──────────────────────────────────────────────────

const MAX_MACHINES = Number(process.env.TODAY_BRIEFING_MAX_MACHINES || "30");
const PDM_RISK_ALERT = Number(process.env.PM_RISK_THRESHOLD ?? 60);
const WINDOW_DAYS = Number(process.env.TODAY_BRIEFING_WINDOW_DAYS || "1");
const MAX_ATTENTION_ROWS = 3;

// ─── Role mapping ──────────────────────────────────────────────────────────────

/** Collapse the app's 8 roles into the 4 briefing variants. */
export function briefingRoleOf(role: string): BriefingRole {
  switch (String(role)) {
    case "maintenance":
      return "maintenance";
    case "operator":
      return "operator";
    case "supervisor":
    case "admin":
      return "manager";
    case "quality_inspector":
      return "quality";
    // W0-E (doc69 wave0 activation) — engineer (kỹ thuật, roleEnum "engineer": the
    // automation-programming / process engineer) previously fell through to the
    // generic viewer briefing. The quality/defect briefing (yield · NG · SPC top
    // defect) is the useful analytical summary for this persona — reuse it as-is
    // rather than inventing a new payload type.
    case "engineer":
      return "quality";
    default:
      return "viewer"; // viewer / user / unknown → read-only subset
  }
}

const SEVERITY_RANK: Record<BriefingSeverity, number> = { critical: 3, warning: 2, info: 1, ok: 0 };
function maxSeverity(a: BriefingSeverity, b: BriefingSeverity): BriefingSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// ─── Scope: machines (with hierarchy) visible to the user ──────────────────────

interface ScopedMachine {
  id: number;
  code: string;
  name: string | null;
  factoryCode: string | null;
}

/**
 * Resolve the active machines the user is allowed to see, bounded to MAX_MACHINES.
 * Admin → all; others → machines whose factory.code ∈ their assignments.
 * Best-effort: any error → [] (sections degrade to empty, never throw).
 */
async function scopedMachines(user: BriefingUser): Promise<ScopedMachine[]> {
  try {
    const { getMachinesWithHierarchy } = await import("../db/hierarchy");
    const rows = await getMachinesWithHierarchy();
    const isAdmin = String(user.role) === "admin";
    let allowed: Set<string> | null = null;
    if (!isAdmin) {
      const assignments = await getUserFactoryAssignments(user.id).catch(() => []);
      allowed = new Set(assignments.map((a) => a.factoryCode).filter((c): c is string => !!c));
    }
    const out: ScopedMachine[] = [];
    for (const r of rows) {
      const factoryCode = (r as any)?.factory?.code ?? null;
      if (allowed !== null && !(factoryCode && allowed.has(factoryCode))) continue;
      const m = (r as any)?.machine;
      if (!m?.id || !m?.code) continue;
      out.push({ id: m.id, code: m.code, name: m.name ?? null, factoryCode });
      if (out.length >= MAX_MACHINES) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Source: PdM risk for scoped machines (bounded) ────────────────────────────

interface PdmRow {
  machineCode: string;
  failureRisk: number;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  predictedTimeframe: string | null;
}

async function pdmRisks(machines: ScopedMachine[], warnings: string[]): Promise<PdmRow[]> {
  if (machines.length === 0) return [];
  try {
    const { computeFailureRisk } = await import("./predictiveMaintenanceService");
    const results = await Promise.all(
      machines.map(async (m) => {
        try {
          const r = await computeFailureRisk(m.id);
          return {
            machineCode: m.code,
            failureRisk: r.failureRisk,
            urgency: r.maintenanceUrgency,
            predictedTimeframe: r.predictedTimeframe,
          } as PdmRow;
        } catch {
          return null;
        }
      }),
    );
    return results
      .filter((r): r is PdmRow => !!r && r.failureRisk > 0)
      .sort((a, b) => b.failureRisk - a.failureRisk);
  } catch (err) {
    warnings.push(`pdm risk unavailable: ${String((err as any)?.message || err)}`);
    return [];
  }
}

// ─── Source: anomaly (best-effort, optional — never required) ──────────────────

interface AnomalyRow {
  machineCode: string;
  score: number;
}

/**
 * Recent anomalies for scoped machines, read from the REAL per-machine anomaly
 * status reader (`readMachineStatuses`, exported from the anomaly router — it reads
 * the latest scored row per machine from `ai_image_embeddings.metadata->'anomaly'`,
 * the same source the production dashboard batch query uses).
 *
 * Previously this called `getAnomalyStats` (a thin passthrough to `getBankStats`,
 * which returns `{totalVectors, distinctModelCodes, profiles}`) and read
 * `latestIsAnomaly`/`latestScore`/`maxScore` off the result — fields `getBankStats`
 * NEVER returns, so the anomaly section was dead code (could never surface a row).
 *
 * NEVER throws — any failure degrades to an empty list + a soft warning.
 */
async function recentAnomalies(machines: ScopedMachine[], warnings: string[]): Promise<AnomalyRow[]> {
  if (machines.length === 0) return [];
  try {
    const { readMachineStatuses } = await import("../routers/aiAnomalyRouter");
    const ids = machines.slice(0, MAX_MACHINES).map((m) => m.id);
    const statuses = await readMachineStatuses(ids, null);
    const codeById = new Map(machines.map((m) => [m.id, m.code] as const));

    const out: AnomalyRow[] = [];
    for (const [idStr, status] of Object.entries(statuses)) {
      if (!status?.isAnomaly) continue;
      const code = codeById.get(Number(idStr));
      if (!code) continue;
      const score = Number(status.latestScore ?? 0);
      if (Number.isFinite(score) && score > 0) {
        out.push({ machineCode: code, score });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  } catch (err) {
    warnings.push(`anomaly unavailable: ${String((err as any)?.message || err)}`);
    return [];
  }
}

// ─── Source: yield / NG over the briefing window (scope-filtered) ──────────────

interface YieldSummary {
  yieldRate: number | null;
  ngCount: number;
  total: number;
  ngRate: number | null;
}

async function yieldSummary(
  machines: ScopedMachine[],
  isAdmin: boolean,
  warnings: string[],
): Promise<YieldSummary> {
  const empty: YieldSummary = { yieldRate: null, ngCount: 0, total: 0, ngRate: null };
  try {
    const { getYieldTrendData } = await import("../db/statistics");
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - WINDOW_DAYS * 86400_000);

    // Admin (no scope): one factory-wide query. Scoped users: aggregate over their
    // machines (bounded by MAX_MACHINES) so the number reflects only their line(s).
    let rows: Array<{ totalCount: number; ngCount: number }> = [];
    if (isAdmin) {
      const r = await getYieldTrendData({ startDate, endDate, interval: "day" });
      rows = (r || []).map((x: any) => ({ totalCount: Number(x.totalCount) || 0, ngCount: Number(x.ngCount) || 0 }));
    } else {
      if (machines.length === 0) return empty;
      const per = await Promise.all(
        machines.map((m) =>
          getYieldTrendData({ startDate, endDate, machineId: m.id, interval: "day" }).catch(() => []),
        ),
      );
      rows = per.flat().map((x: any) => ({ totalCount: Number(x.totalCount) || 0, ngCount: Number(x.ngCount) || 0 }));
    }

    const total = rows.reduce((s, r) => s + r.totalCount, 0);
    const ngCount = rows.reduce((s, r) => s + r.ngCount, 0);
    if (total <= 0) return { yieldRate: null, ngCount, total: 0, ngRate: null };
    const ngRate = Math.round((ngCount / total) * 1000) / 10;
    const yieldRate = Math.round(((total - ngCount) / total) * 1000) / 10;
    return { yieldRate, ngCount, total, ngRate };
  } catch (err) {
    warnings.push(`yield unavailable: ${String((err as any)?.message || err)}`);
    return empty;
  }
}

// ─── Source: top defect (Pareto) ───────────────────────────────────────────────

async function topDefect(
  machines: ScopedMachine[],
  isAdmin: boolean,
  warnings: string[],
): Promise<{ type: string; count: number; percentage: number } | null> {
  try {
    const { paretoByDefectType } = await import("./paretoAnalysisService");
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - WINDOW_DAYS * 86400_000);
    // Scoped non-admin with a single machine can pass machineId; otherwise the
    // factory-wide Pareto is a fair, cheap proxy for "the shift's top defect".
    const machineId = !isAdmin && machines.length === 1 ? machines[0].id : undefined;
    const pareto = await paretoByDefectType({ startDate, endDate, machineId, limit: 1 });
    const top = pareto?.items?.[0];
    if (!top) return null;
    return { type: top.category, count: top.count, percentage: Math.round(top.percentage * 10) / 10 };
  } catch (err) {
    warnings.push(`top defect unavailable: ${String((err as any)?.message || err)}`);
    return null;
  }
}

// ─── Source: open proposals for this user (cheap, per-user) ────────────────────

async function openProposalsCount(user: BriefingUser, warnings: string[]): Promise<number> {
  try {
    const { countInbox } = await import("./aiActionInbox");
    const { count } = await countInbox({ id: user.id, role: String(user.role), name: user.name ?? null });
    return count;
  } catch (err) {
    warnings.push(`proposals unavailable: ${String((err as any)?.message || err)}`);
    return 0;
  }
}

// ─── Localization helpers ──────────────────────────────────────────────────────

function L(lang: BriefingLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

function pdmReason(row: PdmRow, lang: BriefingLang): string {
  const tf = row.predictedTimeframe ? ` (${row.predictedTimeframe})` : "";
  return L(
    lang,
    `Rủi ro hỏng ${row.failureRisk}%${tf}`,
    `Failure risk ${row.failureRisk}%${tf}`,
    `故障风险 ${row.failureRisk}%${tf}`,
  );
}

function anomalyReason(score: number, lang: BriefingLang): string {
  const pct = Math.round(score * 100);
  return L(lang, `Bất thường gần đây (${pct})`, `Recent anomaly (${pct})`, `近期异常 (${pct})`);
}

function severityOfRisk(risk: number): BriefingSeverity {
  if (risk >= 80) return "critical";
  if (risk >= PDM_RISK_ALERT) return "warning";
  return "info";
}

function severityOfAnomaly(score: number): BriefingSeverity {
  return score >= 0.85 ? "critical" : "warning";
}

/** Merge PdM + anomaly rows into a single severity-sorted attention list. */
function buildAttention(pdm: PdmRow[], anomaly: AnomalyRow[], lang: BriefingLang): AttentionRow[] {
  const byCode = new Map<string, AttentionRow>();
  for (const r of pdm) {
    if (r.failureRisk < PDM_RISK_ALERT) continue; // only what needs attention
    byCode.set(r.machineCode, {
      machineCode: r.machineCode,
      reason: pdmReason(r, lang),
      severity: severityOfRisk(r.failureRisk),
      pdmRisk: r.failureRisk,
    });
  }
  for (const a of anomaly) {
    const existing = byCode.get(a.machineCode);
    if (existing) {
      existing.anomaly = a.score;
      existing.severity = maxSeverity(existing.severity, severityOfAnomaly(a.score));
    } else {
      byCode.set(a.machineCode, {
        machineCode: a.machineCode,
        reason: anomalyReason(a.score, lang),
        severity: severityOfAnomaly(a.score),
        anomaly: a.score,
      });
    }
  }
  return Array.from(byCode.values()).sort((x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity]);
}

// ─── Public: build the role-aware briefing (NEVER throws) ──────────────────────

export async function buildTodayBriefing(user: BriefingUser, lang: BriefingLang = "vi"): Promise<TodayBriefing> {
  const warnings: string[] = [];
  const role = briefingRoleOf(user.role);
  const isAdmin = String(user.role) === "admin";
  const generatedAt = new Date().toISOString();

  try {
    const machines = await scopedMachines(user);

    if (role === "maintenance") {
      const [pdm, anomaly, openProposals] = await Promise.all([
        pdmRisks(machines, warnings),
        recentAnomalies(machines, warnings),
        openProposalsCount(user, warnings),
      ]);
      const attention = buildAttention(pdm, anomaly, lang).slice(0, MAX_ATTENTION_ROWS);
      const severity: BriefingSeverity = attention[0]?.severity ?? "ok";
      const topActions = attention.map((a) =>
        L(
          lang,
          `Kiểm tra máy ${a.machineCode}: ${a.reason}`,
          `Inspect ${a.machineCode}: ${a.reason}`,
          `检查 ${a.machineCode}：${a.reason}`,
        ),
      );
      const headline =
        attention.length > 0
          ? L(
              lang,
              `${attention.length} máy cần chú ý hôm nay`,
              `${attention.length} machine(s) need attention today`,
              `今天有 ${attention.length} 台设备需要关注`,
            )
          : L(lang, "Mọi thứ ổn định ✓", "All clear ✓", "一切正常 ✓");
      return {
        role,
        lang,
        severity,
        headline,
        warnings,
        generatedAt,
        payload: { role: "maintenance", machinesNeedingAttention: attention, openProposals, topActions },
      };
    }

    if (role === "operator") {
      const [ys, pdm, anomaly] = await Promise.all([
        yieldSummary(machines, isAdmin, warnings),
        pdmRisks(machines, warnings),
        recentAnomalies(machines, warnings),
      ]);
      const attention = buildAttention(pdm, anomaly, lang);
      const activeAlerts = attention.slice(0, MAX_ATTENTION_ROWS);
      const anomalyMachines = attention.filter((a) => a.anomaly != null).slice(0, MAX_ATTENTION_ROWS);
      let severity: BriefingSeverity = activeAlerts[0]?.severity ?? "ok";
      if (ys.ngRate != null && ys.ngRate > 5) severity = maxSeverity(severity, "warning");
      const headline =
        activeAlerts.length > 0
          ? L(
              lang,
              `Dây chuyền của bạn: ${activeAlerts.length} cảnh báo cần xử lý`,
              `Your line: ${activeAlerts.length} alert(s) to handle`,
              `您的产线：${activeAlerts.length} 条警报待处理`,
            )
          : L(lang, "Dây chuyền ổn định ✓", "Your line is stable ✓", "产线运行稳定 ✓");
      return {
        role,
        lang,
        severity,
        headline,
        warnings,
        generatedAt,
        payload: {
          role: "operator",
          myLineStatus: { yield: ys.yieldRate, ngCount: ys.ngCount },
          activeAlerts,
          anomalyMachines,
        },
      };
    }

    if (role === "manager") {
      const [ys, pdm, defect, oee] = await Promise.all([
        yieldSummary(machines, isAdmin, warnings),
        pdmRisks(machines, warnings),
        topDefect(machines, isAdmin, warnings),
        avgOee(machines, isAdmin, warnings),
      ]);
      const pdmRiskCount = pdm.filter((r) => r.failureRisk >= PDM_RISK_ALERT).length;
      const exceptions = buildAttention(pdm, [], lang).slice(0, MAX_ATTENTION_ROWS);
      let severity: BriefingSeverity = exceptions[0]?.severity ?? "ok";
      if (ys.ngRate != null && ys.ngRate > 5) severity = maxSeverity(severity, "warning");
      const headline = buildManagerHeadline(ys, oee, defect, pdmRiskCount, lang);
      return {
        role,
        lang,
        severity,
        headline,
        warnings,
        generatedAt,
        payload: {
          role: "manager",
          shiftKpis: { oee, yield: ys.yieldRate, ngRate: ys.ngRate, throughput: ys.total },
          exceptions,
          topDefect: defect,
          pdmRiskCount,
        },
      };
    }

    // quality_inspector / viewer / user → read-only subset.
    const [ys, defect] = await Promise.all([
      yieldSummary(machines, isAdmin, warnings),
      topDefect(machines, isAdmin, warnings),
    ]);
    const severity: BriefingSeverity = ys.ngRate != null && ys.ngRate > 5 ? "warning" : "ok";
    const headline =
      ys.yieldRate != null
        ? L(
            lang,
            `Yield hôm nay ${ys.yieldRate}% · NG ${ys.ngCount}`,
            `Today's yield ${ys.yieldRate}% · NG ${ys.ngCount}`,
            `今日良率 ${ys.yieldRate}% · NG ${ys.ngCount}`,
          )
        : L(lang, "Chưa có dữ liệu hôm nay", "No data yet today", "今日暂无数据");
    return {
      role,
      lang,
      severity,
      headline,
      warnings,
      generatedAt,
      payload: {
        role: role === "quality" ? "quality" : "viewer",
        yield: ys.yieldRate,
        ngRate: ys.ngRate,
        ngCount: ys.ngCount,
        topDefect: defect,
      },
    };
  } catch (err) {
    // Absolute fail-safe: any unexpected error → empty viewer briefing, never throw.
    warnings.push(`briefing failed: ${String((err as any)?.message || err)}`);
    return {
      role: "viewer",
      lang,
      severity: "ok",
      headline: L(lang, "Chưa có dữ liệu hôm nay", "No data yet today", "今日暂无数据"),
      warnings,
      generatedAt,
      payload: { role: "viewer", yield: null, ngRate: null, ngCount: 0, topDefect: null },
    };
  }
}

// ─── Source: average OEE over scoped machines (manager only) ───────────────────

async function avgOee(machines: ScopedMachine[], isAdmin: boolean, warnings: string[]): Promise<number | null> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return null;
    const { oeeMetrics } = await import("../../drizzle/schema");
    const { and, gte, lte, inArray } = await import("drizzle-orm");
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - WINDOW_DAYS * 86400_000);

    const conds: any[] = [gte(oeeMetrics.timestamp, startDate), lte(oeeMetrics.timestamp, endDate)];
    if (!isAdmin) {
      const codes = machines.map((m) => m.code);
      if (codes.length === 0) return null;
      conds.push(inArray(oeeMetrics.machineCode, codes));
    }
    const rows = await db.select({ oee: oeeMetrics.oee }).from(oeeMetrics).where(and(...conds));
    if (!rows.length) return null;
    // oee column is integer percentage×100 → /100 to get %.
    const avg = rows.reduce((s, r) => s + Number(r.oee), 0) / rows.length / 100;
    return Math.round(avg * 10) / 10;
  } catch (err) {
    warnings.push(`oee unavailable: ${String((err as any)?.message || err)}`);
    return null;
  }
}

function buildManagerHeadline(
  ys: YieldSummary,
  oee: number | null,
  defect: { type: string; count: number } | null,
  pdmRiskCount: number,
  lang: BriefingLang,
): string {
  const parts: string[] = [];
  if (oee != null) parts.push(L(lang, `OEE ${oee}%`, `OEE ${oee}%`, `OEE ${oee}%`));
  if (ys.yieldRate != null) parts.push(L(lang, `Yield ${ys.yieldRate}%`, `Yield ${ys.yieldRate}%`, `良率 ${ys.yieldRate}%`));
  if (defect) parts.push(L(lang, `top lỗi "${defect.type}"`, `top defect "${defect.type}"`, `首要缺陷 "${defect.type}"`));
  if (pdmRiskCount > 0) {
    parts.push(
      L(
        lang,
        `${pdmRiskCount} rủi ro PdM`,
        `${pdmRiskCount} PdM risk(s)`,
        `${pdmRiskCount} 项 PdM 风险`,
      ),
    );
  }
  if (parts.length === 0) return L(lang, "Chưa có dữ liệu ca này", "No shift data yet", "本班次暂无数据");
  const prefix = L(lang, "Ca này: ", "This shift: ", "本班次：");
  return prefix + parts.join(", ");
}
