/**
 * AI Action Inbox — unified, per-user "work that needs you" feed (push, 1-tap approve).
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§1, §3).
 *
 * GOAL: minimum user effort. The AI brings work TO the user; the user only
 * approves. This service AGGREGATES (read-only) three existing sources into one
 * severity-sorted feed scoped to the CURRENT user:
 *
 *   (a) PROPOSAL — pending HITL write-actions the auto-proposer (or chat) created
 *       FOR THIS user (ai_pending_actions where userId=me AND status='proposed'
 *       AND not expired). Carries the confirm token so the UI can 1-tap approve
 *       via the EXISTING aiCopilot.confirmAction route.
 *   (b) INSIGHT  — advisory ai_insights (RCA/next-step) relevant to my factory
 *       scope / machines, still 'new' (not acknowledged/dismissed).
 *   (c) ALERT    — top anomaly/PdM alerts for my machines (best-effort, optional).
 *
 * ⚠️ SAFETY: this service NEVER executes anything. Approve/confirm of a proposal
 * goes through the EXISTING aiCopilotActions.confirmAction (the UI calls it with
 * the token returned by list()). dismiss() only cancels a proposal (reuse the
 * HITL cancel flow) or marks an insight acknowledged — no tool ever runs here.
 *
 * FAIL-SAFE: a missing DB (or any source error) degrades to an empty feed, never
 * a throw. Respects tenant/role scope (admin sees all factories; others limited
 * to their userFactoryAssignments).
 */

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { getUserFactoryAssignments } from "../db/auth";
import {
  aiPendingActions,
  aiInsights,
  machines as machinesTable,
  stations,
  productionLines,
  workshops,
  factories,
} from "../../drizzle/schema";

export type InboxUser = { id: number; role: string; name?: string | null };

/** A machine in the user's scope, carrying both id (needed by readMachineStatuses) and
 *  code (needed by ai_insights.machineCode / display). `id` is nullable only to tolerate
 *  legacy callers/fixtures that resolved codes without ids — such rows are simply
 *  excluded from the alert source (no id ⇒ can't look up anomaly status). */
export interface ScopedMachine {
  id: number | null;
  code: string;
}

export type InboxItemType = "proposal" | "insight" | "alert";
export type InboxAction = "approve" | "dismiss" | "ask" | "view";
export type InboxSeverity = "critical" | "warning" | "info";

export interface InboxItem {
  /** Stable per-(type) id: proposal→action uuid; insight/alert→numeric id as string. */
  id: string;
  type: InboxItemType;
  severity: InboxSeverity;
  title: string;
  /** Concise body / summary line. */
  body: string;
  /** Supported 1-tap actions for this item. */
  actions: InboxAction[];
  /** Optional machine the item refers to (insight/alert). */
  machineCode?: string | null;
  createdAt: string; // ISO

  // ── proposal-only ──
  /** ai_pending_actions.id — also the confirm token (bound to userId). */
  actionId?: string;
  token?: string;
  tool?: string;
  expiresAt?: string; // ISO

  // ── insight/alert-only ──
  recommendation?: string | null;
}

export interface InboxListResult {
  items: InboxItem[];
}

// Severity ordering for the unified sort (higher = surfaced first).
const SEVERITY_RANK: Record<InboxSeverity, number> = { critical: 3, warning: 2, info: 1 };

function normSeverity(s: string | null | undefined): InboxSeverity {
  const v = (s ?? "").toLowerCase();
  if (v === "critical" || v === "error" || v === "high") return "critical";
  if (v === "warning" || v === "warn" || v === "medium") return "warning";
  return "info";
}

/**
 * Factory scope for the user. Admin → null (no restriction; sees everything).
 * Others → the set of factoryCodes from their assignments (possibly empty).
 */
async function factoryScope(user: InboxUser): Promise<string[] | null> {
  if (String(user.role) === "admin") return null; // unrestricted
  try {
    const assignments = await getUserFactoryAssignments(user.id);
    return assignments.map((a) => a.factoryCode).filter((c): c is string => !!c);
  } catch {
    return []; // fail-safe: no scope ⇒ no insights/alerts (proposals still per-user)
  }
}

/**
 * Resolve the machines (id + code) the user is allowed to see, derived from their
 * factory scope (machine → station → line → workshop → factory.code). Admin
 * (scope null) ⇒ null (no restriction). Empty scope ⇒ [] (sees no machines).
 * Best-effort: any error degrades to [] (insights/alerts simply hidden).
 *
 * `id` is carried alongside `code` so the anomaly-alert source (readMachineStatuses,
 * which is keyed by numeric machineId) can be queried without a second round-trip.
 */
async function machineScope(user: InboxUser, scope: string[] | null): Promise<ScopedMachine[] | null> {
  if (scope === null) return null; // admin: unrestricted
  if (scope.length === 0) return [];
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({ id: machinesTable.id, code: machinesTable.code })
      .from(machinesTable)
      .innerJoin(stations, eq(machinesTable.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .innerJoin(factories, eq(workshops.factoryId, factories.id))
      .where(inArray(factories.code, scope));
    return rows
      .filter((r) => !!r.code)
      .map((r) => ({ id: Number.isInteger(Number(r.id)) ? Number(r.id) : null, code: r.code as string }));
  } catch {
    return [];
  }
}

// ─── (a) Pending write-action proposals (per-user) ─────────────────────────────

async function listProposals(user: InboxUser, limit: number): Promise<InboxItem[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(aiPendingActions)
      .where(
        and(
          eq(aiPendingActions.userId, user.id),
          eq(aiPendingActions.status, "proposed"),
          gt(aiPendingActions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(aiPendingActions.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      type: "proposal" as const,
      // A proposed write-action that needs approval is always at least a warning.
      severity: "warning" as InboxSeverity,
      title: r.summary,
      body: r.summary,
      actions: ["approve", "dismiss", "ask"] as InboxAction[],
      actionId: r.id,
      token: r.id,
      tool: r.tool,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[aiActionInbox] listProposals failed:", (err as Error)?.message ?? err);
    return [];
  }
}

// ─── (b) Advisory insights (factory/machine scoped) ────────────────────────────

async function listInsights(machines: string[] | null, limit: number): Promise<InboxItem[]> {
  try {
    if (machines !== null && machines.length === 0) return []; // scoped user with no machines
    const db = await getDb();
    if (!db) return [];

    const conds = [eq(aiInsights.status, "new")];
    // Restrict to the user's machines (NULL machineCode insights are factory-wide
    // advisories → only admins, who pass machines===null, see them).
    if (machines !== null) conds.push(inArray(aiInsights.machineCode, machines));

    const rows = await db
      .select()
      .from(aiInsights)
      .where(and(...conds))
      .orderBy(desc(aiInsights.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: String(r.id),
      type: "insight" as const,
      severity: normSeverity(r.severity),
      title: r.title,
      body: r.body,
      actions: ["view", "dismiss", "ask"] as InboxAction[],
      machineCode: r.machineCode,
      recommendation: r.recommendation ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[aiActionInbox] listInsights failed:", (err as Error)?.message ?? err);
    return [];
  }
}

// ─── (c) Anomaly / PdM alerts for my machines (best-effort, optional) ──────────

/**
 * The REAL per-machine anomaly source: `readMachineStatuses` (server/routers/aiAnomalyRouter.ts),
 * the same plain, exported, non-tRPC function that backs the `aiAnomaly.latestForMachine` /
 * `aiAnomaly.machineStatuses` procedures AND that `aiTodayBriefing.ts`'s `recentAnomalies()`
 * already imports the exact same way (dynamic `import("../routers/aiAnomalyRouter")`, called with
 * `(ids, null)`). It reads the latest scored row per machine from
 * `ai_image_embeddings.metadata->'anomaly'` — never the dead `aiAnomalyDetection.latestForMachine`
 * this branch used to (mis)reference, which doesn't exist on that module.
 *
 * Fully fail-safe: any failure (import rejection, DB error — readMachineStatuses itself never
 * throws, but the dynamic import can) degrades to no anomaly alerts, never a throw.
 */
export async function listAlerts(machines: ScopedMachine[] | null, limit: number): Promise<InboxItem[]> {
  if (!machines || machines.length === 0) return [];
  const scoped = machines.filter((m): m is { id: number; code: string } => Number.isInteger(m.id)).slice(0, limit);
  if (scoped.length === 0) return [];
  try {
    const { readMachineStatuses } = await import("../routers/aiAnomalyRouter");
    const statuses = await readMachineStatuses(scoped.map((m) => m.id), null);

    const out: InboxItem[] = [];
    for (const m of scoped) {
      const a = statuses?.[m.id];
      if (!a || !a.isAnomaly) continue;
      const score = a.latestScore ?? 0;
      const sev: InboxSeverity = score >= 0.85 ? "critical" : "warning";
      const scoreStr = a.latestScore != null ? a.latestScore.toFixed(3) : "?";
      const thresholdStr = a.latestThreshold != null ? ` (ngưỡng ${a.latestThreshold.toFixed(3)})` : "";
      out.push({
        id: `anomaly:${m.code}`,
        type: "alert",
        severity: sev,
        title: `Bất thường trên máy ${m.code}`,
        body: `Phát hiện bất thường (score ${scoreStr}${thresholdStr}).`,
        actions: ["view", "dismiss", "ask"],
        machineCode: m.code,
        recommendation: null,
        createdAt: (a.latestAt ? new Date(a.latestAt) : new Date()).toISOString(),
      });
    }
    return out;
  } catch (err) {
    console.error("[aiActionInbox] listAlerts failed:", (err as Error)?.message ?? err);
    return [];
  }
}

/** Stable severity-then-recency sort of the unified feed. */
function sortFeed(items: InboxItem[]): InboxItem[] {
  return items.sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (s !== 0) return s;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * list — the unified, severity-sorted inbox for the CURRENT user.
 * Per-user proposals + factory/machine-scoped insights + optional anomaly alerts.
 */
export async function listInbox(user: InboxUser, opts?: { limit?: number }): Promise<InboxListResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));

  const scope = await factoryScope(user);
  const machines = await machineScope(user, scope);
  const machineCodes = machines === null ? null : machines.map((m) => m.code);

  const [proposals, insights, alerts] = await Promise.all([
    listProposals(user, limit),
    listInsights(machineCodes, limit),
    listAlerts(machines, Math.min(limit, 20)),
  ]);

  const items = sortFeed([...proposals, ...insights, ...alerts]).slice(0, limit);
  return { items };
}

/**
 * count — cheap actionable count for a nav badge. Counts unexpired per-user
 * proposals + 'new' insights in scope. Best-effort; 0 on any failure.
 */
export async function countInbox(user: InboxUser): Promise<{ count: number }> {
  try {
    const db = await getDb();
    if (!db) return { count: 0 };

    const proposalRows = await db
      .select({ id: aiPendingActions.id })
      .from(aiPendingActions)
      .where(
        and(
          eq(aiPendingActions.userId, user.id),
          eq(aiPendingActions.status, "proposed"),
          gt(aiPendingActions.expiresAt, new Date()),
        ),
      );
    let count = proposalRows.length;

    const scope = await factoryScope(user);
    const machines = await machineScope(user, scope);
    const machineCodes = machines === null ? null : machines.map((m) => m.code);
    if (!(machineCodes !== null && machineCodes.length === 0)) {
      const conds = [eq(aiInsights.status, "new")];
      if (machineCodes !== null) conds.push(inArray(aiInsights.machineCode, machineCodes));
      const insightRows = await db.select({ id: aiInsights.id }).from(aiInsights).where(and(...conds));
      count += insightRows.length;
    }

    return { count };
  } catch (err) {
    console.error("[aiActionInbox] countInbox failed:", (err as Error)?.message ?? err);
    return { count: 0 };
  }
}

export type DismissResult = { ok: boolean; type: InboxItemType; id: string; status: string; message?: string };

/**
 * dismiss — acknowledge an insight / cancel a proposal. NEVER executes a tool.
 *   - proposal → reuse the HITL cancel flow (owner-checked inside cancelAction).
 *   - insight  → set ai_insights.status='acknowledged' + acknowledgedBy=me.
 *   - alert    → transient (anomaly read) → no-op acknowledge (returns ok).
 */
export async function dismissInboxItem(
  user: InboxUser,
  type: InboxItemType,
  id: string,
  req?: { ip?: string; headers?: Record<string, any>; socket?: { remoteAddress?: string } },
): Promise<DismissResult> {
  if (type === "proposal") {
    try {
      const { cancelAction } = await import("./aiCopilotActions");
      const res = await cancelAction(id, { id: user.id, role: String(user.role), name: user.name ?? null }, req);
      return { ok: res.ok, type, id, status: res.status, message: res.message };
    } catch (err) {
      return { ok: false, type, id, status: "error", message: (err as Error)?.message };
    }
  }

  if (type === "insight") {
    try {
      const db = await getDb();
      if (!db) return { ok: false, type, id, status: "db_unavailable" };
      const numId = Number(id);
      if (!Number.isFinite(numId)) return { ok: false, type, id, status: "invalid" };

      // Scope guard: only acknowledge insights inside the user's machine scope.
      const scope = await factoryScope(user);
      const machines = await machineScope(user, scope);
      const [row] = await db.select().from(aiInsights).where(eq(aiInsights.id, numId)).limit(1);
      if (!row) return { ok: false, type, id, status: "not_found" };
      if (machines !== null && !(row.machineCode && machines.some((m) => m.code === row.machineCode))) {
        return { ok: false, type, id, status: "forbidden" };
      }

      await db
        .update(aiInsights)
        .set({ status: "acknowledged", acknowledgedBy: user.id })
        .where(eq(aiInsights.id, numId));
      return { ok: true, type, id, status: "acknowledged" };
    } catch (err) {
      return { ok: false, type, id, status: "error", message: (err as Error)?.message };
    }
  }

  // alert: transient — acknowledging is a client-side dismissal (nothing persisted).
  return { ok: true, type, id, status: "dismissed" };
}
