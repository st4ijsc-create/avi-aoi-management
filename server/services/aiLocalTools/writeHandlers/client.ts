/**
 * AI Local Tools — Client-side directive tools (GĐ3a Mục 5)
 *
 *   navigate     {route}          → FE wouter setLocation(route)
 *   prefill_form {route, values}  → FE navigates + publishes values for the page
 *
 * These do NOT mutate the DB and do NOT go through the HITL write flow. The
 * server only validates the route against a whitelist (derived from App.tsx
 * <Route> paths) and emits a `client_action` StreamEvent; the FE executes it.
 * Only the viewer's existing access applies (route guards stay on the client).
 */

import { z } from "zod";
import {
  registerTool,
  type ClientActionDirective,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";

// Whitelist of navigable routes (mirrors App.tsx <Route path=...>). Parametrized
// routes (e.g. /inspection/:id) are intentionally excluded — only static targets
// are allowed for AI navigation.
export const ALLOWED_CLIENT_ROUTES: readonly string[] = [
  "/", "/dashboard", "/history", "/products", "/reports", "/alerts", "/users",
  "/production-orders", "/machine-status", "/sessions", "/spc-analysis",
  "/category-analytics", "/oee-dashboard", "/mqtt-dashboard", "/mqtt-alerts",
  "/mqtt-ng-rate", "/predictive-alerts", "/quality-gates", "/pdf-reports",
  "/report-builder", "/production-dashboard", "/drill-down", "/audit-logs",
  "/monitoring-setting", "/analytics-setting", "/admin-setting", "/datasettings",
  "/machine-health", "/defect-heatmap", "/defect-prediction",
  "/root-cause-analysis", "/pareto-analysis", "/correlation-analysis",
  "/ai-chat", "/ai-hub", "/ai-inspection-analytics", "/ai-models", "/ai-settings",
] as const;

function isAllowedRoute(route: string): boolean {
  return ALLOWED_CLIENT_ROUTES.includes(route);
}

// ── navigate ─────────────────────────────────────────────────────────────────

const navigateParams = z
  .object({
    route: z.string().min(1).max(200),
  })
  .strict();

type NavigateParams = z.infer<typeof navigateParams>;

function summarizeNavigate(p: NavigateParams, lang: ToolLang): string {
  switch (lang) {
    case "en":
      return `Open page: ${p.route}.`;
    case "zh":
      return `打开页面：${p.route}。`;
    case "vi":
    default:
      return `Mở trang: ${p.route}.`;
  }
}

export const navigateTool: Tool<NavigateParams, never> = {
  name: "navigate",
  description:
    "Điều hướng người dùng tới một trang trong hệ thống (CLIENT-ACTION, không ghi DB). " +
    "Chỉ chấp nhận route nằm trong danh sách cho phép.",
  parameters: navigateParams,
  triggers: ["mở trang", "đi tới", "chuyển tới trang", "navigate to", "open page", "打开页面"],
  kind: "client",
  summarize: summarizeNavigate,
  buildClientAction: (p, ctx): ClientActionDirective | null => {
    if (!isAllowedRoute(p.route)) return null;
    return { action: "navigate", route: p.route, message: summarizeNavigate(p, ctx.lang) };
  },
};

registerTool(navigateTool);

// ── prefill_form ─────────────────────────────────────────────────────────────

const prefillParams = z
  .object({
    route: z.string().min(1).max(200),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

type PrefillParams = z.infer<typeof prefillParams>;

function summarizePrefill(p: PrefillParams, lang: ToolLang): string {
  const keys = Object.keys(p.values).join(", ");
  switch (lang) {
    case "en":
      return `Open ${p.route} and prefill: ${keys}.`;
    case "zh":
      return `打开 ${p.route} 并预填：${keys}。`;
    case "vi":
    default:
      return `Mở ${p.route} và điền sẵn: ${keys}.`;
  }
}

export const prefillFormTool: Tool<PrefillParams, never> = {
  name: "prefill_form",
  description:
    "Mở một trang và điền sẵn các trường biểu mẫu (CLIENT-ACTION, không ghi DB). " +
    "Chỉ chấp nhận route nằm trong danh sách cho phép; người dùng vẫn phải tự lưu.",
  parameters: prefillParams,
  triggers: ["điền sẵn", "điền form", "prefill", "fill form", "预填"],
  kind: "client",
  summarize: summarizePrefill,
  buildClientAction: (p, ctx): ClientActionDirective | null => {
    if (!isAllowedRoute(p.route)) return null;
    return { action: "prefill_form", route: p.route, values: p.values, message: summarizePrefill(p, ctx.lang) };
  },
};

registerTool(prefillFormTool);
