/**
 * AI Playbook Loader (Sprint G2.3b) — load + validate STATIC playbooks (SOPs)
 * authored as YAML in knowledge/workflows/*.playbook.yaml.
 *
 * WHY STATIC: a playbook is a deterministic, human-authored plan. It is SAFER
 * than an LLM-generated plan because every step is fixed and reviewed. The
 * loader only PARSES + VALIDATES; it performs NO DB write and NO tool execution.
 *
 * Validation at load time (a playbook that fails is logged + SKIPPED, never
 * crashes the process):
 *   - zod schema (id, title{vi,en,zh}, steps[]);
 *   - a `tool` step must name a REGISTERED tool whose kind matches the step
 *     type (tool→write, navigate/prefill→client);
 *   - requiredPermission.action must be a valid permission action;
 *   - a navigate/prefill `route` must be in ALLOWED_CLIENT_ROUTES (warn-only if
 *     that whitelist cannot be resolved).
 *
 * Cache: parsed playbooks are held in RAM; reloadPlaybooks() rescans the dir.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { getTool, isWriteTool, isClientTool } from "./aiLocalTools/toolRegistry";
import { ALLOWED_CLIENT_ROUTES } from "./aiLocalTools/writeHandlers/client";
import { logger } from "../logger";

// ─── Public types ───────────────────────────────────────────────────────────

export type PlaybookStepType = "guidance" | "navigate" | "prefill" | "tool" | "confirm" | "branch";
export type PermissionAction = "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport";

export interface LocalizedText {
  vi: string;
  en: string;
  zh: string;
}

export interface PlaybookPermission {
  module: string;
  action: PermissionAction;
}

export interface PlaybookBranchOption {
  /** Stable key for the branch option (e.g. "false_call"). */
  key: string;
  text: LocalizedText;
}

export interface PlaybookStep {
  type: PlaybookStepType;
  text: LocalizedText;
  /** tool steps only — a registered write tool name. */
  tool?: string;
  /** tool steps — template args interpolated from ctx at engine time. */
  argsTemplate?: Record<string, unknown>;
  /** navigate/prefill steps — a whitelisted client route. */
  route?: string;
  /** prefill steps — template values interpolated from ctx. */
  valuesTemplate?: Record<string, unknown>;
  /** branch steps — deterministic options the user picks from. */
  branch?: PlaybookBranchOption[];
}

export interface Playbook {
  id: string;
  title: LocalizedText;
  /** Optional category tag for grouping in the UI. */
  category?: string;
  requiredPermission?: PlaybookPermission;
  steps: PlaybookStep[];
}

// ─── zod schema (raw YAML shape) ──────────────────────────────────────────────

const PERMISSION_ACTIONS = ["canView", "canCreate", "canEdit", "canDelete", "canExport"] as const;

const localizedSchema = z
  .object({
    vi: z.string().min(1),
    en: z.string().min(1),
    zh: z.string().min(1),
  })
  .strict();

const permissionSchema = z
  .object({
    module: z.string().min(1).max(120),
    action: z.enum(PERMISSION_ACTIONS),
  })
  .strict();

const branchOptionSchema = z
  .object({
    key: z.string().min(1).max(64),
    text: localizedSchema,
  })
  .strict();

const stepSchema = z
  .object({
    type: z.enum(["guidance", "navigate", "prefill", "tool", "confirm", "branch"]),
    text: localizedSchema,
    tool: z.string().min(1).max(120).optional(),
    argsTemplate: z.record(z.string(), z.unknown()).optional(),
    route: z.string().min(1).max(200).optional(),
    valuesTemplate: z.record(z.string(), z.unknown()).optional(),
    branch: z.array(branchOptionSchema).min(1).optional(),
  })
  .strict();

const playbookSchema = z
  .object({
    id: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/i, "id chỉ gồm chữ/số/gạch nối"),
    title: localizedSchema,
    category: z.string().min(1).max(120).optional(),
    requiredPermission: permissionSchema.optional(),
    steps: z.array(stepSchema).min(1).max(20),
  })
  .strict();

// ─── Cross-validation against the live registry / route whitelist ─────────────

function routeWhitelist(): readonly string[] | null {
  return Array.isArray(ALLOWED_CLIENT_ROUTES) ? ALLOWED_CLIENT_ROUTES : null;
}

/**
 * Validate a parsed playbook against the live tool registry + route whitelist.
 * Returns a list of error strings (empty ⇒ valid).
 */
export function validatePlaybookSemantics(pb: Playbook): string[] {
  const errors: string[] = [];
  const whitelist = routeWhitelist();

  pb.steps.forEach((step, i) => {
    const at = `step[${i}] (${step.type})`;

    if (step.type === "tool") {
      if (!step.tool) {
        errors.push(`${at}: thiếu 'tool'.`);
        return;
      }
      const tool = getTool(step.tool);
      if (!tool) {
        errors.push(`${at}: tool "${step.tool}" chưa đăng ký trong registry.`);
        return;
      }
      if (!isWriteTool(tool)) {
        errors.push(`${at}: tool "${step.tool}" không phải write-tool (kind=${tool.kind ?? "read"}).`);
      }
    } else if (step.type === "navigate" || step.type === "prefill") {
      if (!step.route) {
        errors.push(`${at}: thiếu 'route'.`);
        return;
      }
      if (whitelist) {
        if (!whitelist.includes(step.route)) {
          errors.push(`${at}: route "${step.route}" ngoài whitelist ALLOWED_CLIENT_ROUTES.`);
        }
      } else {
        logger.warn(`[playbook] ${pb.id} ${at}: không xác định được whitelist route — bỏ qua kiểm tra route.`);
      }
    } else if (step.type === "branch") {
      if (!step.branch || step.branch.length === 0) {
        errors.push(`${at}: branch cần ít nhất một lựa chọn.`);
      }
    }
  });

  return errors;
}

// ─── Loading + cache ──────────────────────────────────────────────────────────

function workflowsDir(): string {
  // server/services/aiPlaybookLoader.ts → repo root → knowledge/workflows
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../knowledge/workflows");
}

let _cache: Playbook[] | null = null;

/**
 * Parse + validate every *.playbook.yaml in knowledge/workflows. Invalid
 * playbooks are logged and skipped — the loader never throws on bad content.
 */
export function loadPlaybooks(): Playbook[] {
  const dir = workflowsDir();
  const out: Playbook[] = [];
  const seen = new Set<string>();

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".playbook.yaml"));
  } catch (err) {
    logger.warn(`[playbook] không đọc được thư mục ${dir}: ${(err as Error).message}`);
    return [];
  }

  for (const file of files.sort()) {
    const full = path.join(dir, file);
    let rawText: string;
    try {
      rawText = readFileSync(full, "utf8");
    } catch (err) {
      logger.error(`[playbook] đọc file lỗi ${file}: ${(err as Error).message}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(rawText);
    } catch (err) {
      logger.error(`[playbook] YAML lỗi ${file}: ${(err as Error).message}`);
      continue;
    }

    const schemaResult = playbookSchema.safeParse(parsed);
    if (!schemaResult.success) {
      logger.error(`[playbook] schema lỗi ${file}: ${schemaResult.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      continue;
    }

    const pb = schemaResult.data as Playbook;

    if (seen.has(pb.id)) {
      logger.error(`[playbook] id trùng "${pb.id}" (${file}) — bỏ qua.`);
      continue;
    }

    const semErrors = validatePlaybookSemantics(pb);
    if (semErrors.length) {
      logger.error(`[playbook] kiểm tra ngữ nghĩa lỗi ${file}: ${semErrors.join("; ")}`);
      continue;
    }

    seen.add(pb.id);
    out.push(pb);
  }

  return out;
}

/** Get the cached playbooks (loads on first access). */
export function getPlaybooks(): Playbook[] {
  if (_cache === null) _cache = loadPlaybooks();
  return _cache;
}

/** Look up one playbook by id (from cache). */
export function getPlaybookById(id: string): Playbook | undefined {
  return getPlaybooks().find((p) => p.id === id);
}

/** Force a rescan of knowledge/workflows; returns the fresh list. */
export function reloadPlaybooks(): Playbook[] {
  _cache = loadPlaybooks();
  return _cache;
}

/** Test helper: replace the in-RAM cache with an explicit list (no disk read). */
export function __setPlaybookCacheForTest(list: Playbook[] | null): void {
  _cache = list;
}
