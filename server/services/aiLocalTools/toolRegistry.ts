/**
 * AI Local Tools — Tool Registry
 *
 * Read-only DB query tools that can be called by the local AI assistant
 * to answer questions that need real-time data (today stats, lot status,
 * machine status, defect trends).
 *
 * Design principles:
 * - Tools are READ-ONLY. No INSERT/UPDATE/DELETE allowed.
 * - All tools use Drizzle ORM (parameterized queries) to avoid SQL injection.
 * - Tools return structured ToolResult that the frontend can render as cards.
 */

import { z } from "zod";
import type { AuditChangeField } from "../auditTrailService";

export type ToolResultType =
  | "today_stats"
  | "lot_status"
  | "machine_status"
  | "defect_trend"
  | "top_defects"
  | "factory_stats"
  | "ng_compare"
  | "oee"
  | "model_metrics"
  | "action_result"
  // ── Sprint F6 — line-monitoring read + insight tools (additive) ──
  | "process_result"
  | "process_metric_trend"
  | "line_balance"
  | "throughput"
  | "palletizer_status"
  | "ot_telemetry"
  | "line_insight"
  | "correlation_insight"
  // ── Phase B4 — Management/Analytics read tools (additive) ──
  | "analytics_oee"
  | "analytics_pareto"
  | "analytics_heatmap"
  | "analytics_yield"
  | "analytics_spc"
  | "analytics_pdm_forecast"
  | "analytics_forecast"
  // ── Phase P2 (group A) — high-priority READ tools (additive) ──
  | "work_order_list"
  | "alert_list"
  | "spec_limits"
  | "recipe_list"
  // ── Phase P2 (groups B & C) — additional READ tools (additive) ──
  | "product_list"
  | "rca_history"
  | "user_list"
  | "api_key_list"
  | "change_history"
  | "machine_health"
  // ── Phase P2 (group D) — anomalies, genealogy, energy, routing (additive) ──
  | "anomaly_list"
  | "genealogy_trace"
  | "energy_metrics"
  | "routing_steps"
  // ── doc 56 Đ6 — device-standardization persona tools (process + drift + SPC + fleet) ──
  | "device_health"
  | "fleet_process_summary"
  // ── Pha 4 Task 4 (VRAM) — ảnh chụp trạng thái bộ điều phối VRAM cho AI Agent ──
  | "vram_state";

export interface ToolResult<T = unknown> {
  type: ToolResultType;
  title: string;
  data: T;
  /** Compact text representation (for LLM context injection). */
  textSummary: string;
  /** Optional human-readable note for empty / error cases. */
  note?: string;
}

// ─── GĐ2: write-action descriptor support ──────────────────────────────────

/** Language union shared with the KB service (vi/en/zh). */
export type ToolLang = "vi" | "en" | "zh";

/** RBAC requirement for a write tool. Maps to checkPermission(module, action). */
export interface ToolPermission {
  module: string;
  action: "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport";
}

/**
 * Execution context threaded from the API layer down to a write tool's
 * preview()/execute(). `user` is the REAL authenticated session user (never
 * trusted from the client body). `req` carries request metadata for audit.
 */
export interface ToolExecContext {
  user: { id: number; role: string; name?: string | null };
  lang: ToolLang;
  req?: { ip?: string; headers?: Record<string, any>; socket?: { remoteAddress?: string } };
  /**
   * Sprint F4a — id of the confirmed ai_pending_actions row, threaded ONLY at
   * execute() time (confirmAction). Lets a write-tool pass it to the
   * commandDispatcher for defense-in-depth (re-verify the HITL action is
   * confirmed + owned). Additive/optional — read tools and propose() ignore it.
   */
  actionId?: string;
}

/** Result of a tool's execute() — reuses ToolResult shape for rendering. */
export type ToolExecuteResult = ToolResult;

/**
 * GĐ3a Mục 5 — Client-side directive (navigate / prefill_form). Produced by a
 * 'client' tool's buildClientAction(); forwarded to the FE via the
 * `client_action` StreamEvent. NEVER touches the DB and does NOT go through the
 * HITL write flow (only the viewer's permission applies, implicitly).
 */
export interface ClientActionDirective {
  /** 'navigate' → setLocation(route); 'prefill_form' → publish values for route. */
  action: "navigate" | "prefill_form";
  /** Whitelisted route (validated server-side against ALLOWED_CLIENT_ROUTES). */
  route: string;
  /** Field values to prefill (prefill_form only). */
  values?: Record<string, unknown>;
  /** Localized human-readable confirmation message. */
  message: string;
  /**
   * doc69 G2-7 — true when this directive was ATTACHED by the assistant to ground
   * a how-to answer (server/services/aiOperationalGrounding.ts), as opposed to an
   * explicit user command ("mở trang X" → the navigate/prefill_form tools above).
   * Undefined/false for every existing explicit-command directive (byte-identical
   * behavior preserved). The FE must NOT auto-navigate when this is true — render
   * a tappable "Mở màn X" button instead, since the user didn't ask to leave the
   * answer they're reading.
   */
  suggested?: boolean;
}

/**
 * Dry-run preview of a write action. Computed BEFORE any DB mutation so the
 * user can confirm. `changes` reuses the audit AuditChangeField (before/after).
 */
export interface ActionPreview {
  entityType: string;
  entityId?: number;
  entityName?: string;
  changes: AuditChangeField[];
  warnings: string[];
  humanSummary: string;
}

export interface Tool<TParams = unknown, TData = unknown> {
  name: string;
  description: string;
  /** Zod schema for params (used to validate args from intent classifier). */
  parameters: z.ZodType<TParams>;
  /**
   * Read tool handler — executes a read-only query and returns a ToolResult.
   * OPTIONAL for write tools (they use preview/execute instead). GĐ1 read
   * tools always provide this and are unchanged.
   */
  handler?: (params: TParams) => Promise<ToolResult<TData>>;
  /** Vietnamese trigger keywords for fast heuristic intent matching. */
  triggers: string[];

  // ── GĐ2 OPTIONAL fields (read tools omit them → default kind 'read') ──
  /**
   * 'read' (default) runs immediately; 'write' goes through HITL confirm;
   * 'client' (GĐ3a Mục 5) emits a client_action directive (navigate/prefill) —
   * no DB mutation, no HITL.
   */
  kind?: "read" | "write" | "client";
  /** RBAC gate checked before propose AND before execute (write tools). */
  requiredPermission?: ToolPermission;
  /** Human-readable confirm summary (vi/en/zh). */
  summarize?: (params: TParams, lang: ToolLang) => string;
  /** Dry-run: read current state, compute before/after changes. NO DB write. */
  preview?: (params: TParams, ctx: ToolExecContext) => Promise<ActionPreview>;
  /** Apply the mutation. Only called after confirm. Uses ctx.user.id for audit. */
  execute?: (params: TParams, ctx: ToolExecContext) => Promise<ToolExecuteResult>;
  /**
   * GĐ3a Mục 5 — 'client' tools: build the FE directive (navigate/prefill).
   * Validates route whitelist; returns null when the route is not allowed.
   */
  buildClientAction?: (params: TParams, ctx: ToolExecContext) => ClientActionDirective | null;
}

/** True when the tool is a client-side directive tool (navigate/prefill). */
export function isClientTool(tool: Tool<any, any> | undefined | null): boolean {
  return !!tool && tool.kind === "client";
}

/** True when the tool is a write-action requiring HITL confirm. */
export function isWriteTool(tool: Tool<any, any> | undefined | null): boolean {
  return !!tool && tool.kind === "write";
}

/**
 * Assert a write tool is fully wired (preview + execute + permission). Throws
 * a descriptive error otherwise so a half-defined write tool fails loudly
 * rather than silently mutating without a preview/RBAC gate.
 */
export function assertExecutable(tool: Tool<any, any>): void {
  if (!isWriteTool(tool)) return;
  const missing: string[] = [];
  if (typeof tool.preview !== "function") missing.push("preview");
  if (typeof tool.execute !== "function") missing.push("execute");
  if (!tool.requiredPermission) missing.push("requiredPermission");
  if (typeof tool.summarize !== "function") missing.push("summarize");
  if (missing.length) {
    throw new Error(`Write tool "${tool.name}" is missing: ${missing.join(", ")}`);
  }
}

const _registry = new Map<string, Tool<any, any>>();

export function registerTool<TParams, TData>(tool: Tool<TParams, TData>): void {
  _registry.set(tool.name, tool as Tool<any, any>);
}

export function getTool(name: string): Tool<any, any> | undefined {
  return _registry.get(name);
}

export function listTools(): Tool<any, any>[] {
  return Array.from(_registry.values());
}

export function clearRegistry(): void {
  _registry.clear();
}
