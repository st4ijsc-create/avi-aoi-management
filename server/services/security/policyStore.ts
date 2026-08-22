/**
 * Policy Store — policy-as-code Git→DB sync + snapshot + append-only decision log.
 * doc 44 Batch W3-A1 (gaps G3.11 + G3.13). SYNAPSE Tầng 3 §11 (Policy Engine),
 * §11.2 ("As-code & versioned" + "Audit bất biến"), §12.3 (PolicyDecision).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Source of truth is Git: contracts/policies/*.policy.yaml (reviewed, tested,
 * versioned). At boot, initPolicyStore() (flag POLICY_STORE_ENABLED, default
 * OFF → total no-op, current behaviour unchanged):
 *   1. syncs the as-code files into policy_definitions by (policy_id, version)
 *      — file version < max DB version → SKIP + warn (DB governance wins),
 *      equal → idempotent content upsert, greater → new version row;
 *   2. loads the ACTIVE rules into an in-memory snapshot the evaluator reads
 *      SYNCHRONOUSLY (the command gate is sync — no await on the hot path).
 *      Staleness > 30 s triggers a BACKGROUND refresh (TTL invalidation);
 *      until the first load completes the evaluator falls back to
 *      DEFAULT_POLICIES — never a policy vacuum.
 *
 * DECISION LOG (append-only): writePolicyDecisionLog INSERTs only — this module
 * (and the whole codebase) has NO update/delete path for policy_decision_log.
 * Writes are fire-and-forget + fail-safe (a missing table warns once, never
 * throws into the command path). Gating (which PERMITs get logged) lives in
 * policyEvaluate.ts; context summaries are REDACTED here (never secrets).
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import { DbUnavailableError } from "../../_core/dbErrors";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { desc, eq, and, gte, lte } from "drizzle-orm";

import { getDb } from "../../db/connection";
import {
  policyDefinitions,
  policyDecisionLog,
  POLICY_DEFINITION_EFFECTS,
  POLICY_DEFINITION_STATUSES,
  type PolicyDefinition,
  type PolicyDefinitionEffect,
  type PolicyDefinitionStatus,
  type PolicyConditionJson,
} from "../../../drizzle/schema";
import { DEFAULT_POLICIES, type PolicyRule, type PolicyCondition, type CompareOp } from "./policyEngine";

// ── flags ─────────────────────────────────────────────────────────────────────

/** Policy store (DB-backed rules + Git sync) — default OFF, fully non-breaking. */
export function policyStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.POLICY_STORE_ENABLED === "true" || env.POLICY_STORE_ENABLED === "1";
}

/** Log EVERY PERMIT (not just default-deny-group ones) — default OFF (DB volume). */
export function policyAuditPermitAll(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.POLICY_AUDIT_PERMIT_ALL === "true" || env.POLICY_AUDIT_PERMIT_ALL === "1";
}

// ── as-code definitions (contracts/policies/*.policy.yaml) ───────────────────

export const POLICY_CONTRACTS_DIR = path.resolve(process.cwd(), "contracts", "policies");

const VALID_OPS: ReadonlySet<string> = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "exists", "truthy",
] satisfies CompareOp[]);

/** One parsed + validated as-code policy definition (mirrors the table shape). */
export interface PolicyFileDef {
  policyId: string;
  version: number;
  effect: PolicyDefinitionEffect;
  actionPattern: string | null;
  resourcePattern: string | null;
  conditions: PolicyConditionJson[];
  priority: number;
  status: PolicyDefinitionStatus;
  description: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse ONE YAML file (single- or multi-document) into validated definitions.
 * Exported for tests. Throws with the offending file/field on invalid structure.
 */
export function parsePolicyDefinitionsYaml(yamlText: string, fileName: string): PolicyFileDef[] {
  const docs = parseAllDocuments(yamlText);
  const out: PolicyFileDef[] = [];
  for (const doc of docs) {
    if (doc.errors?.length) {
      throw new Error(`Policy definition ${fileName}: YAML parse error — ${doc.errors[0].message}`);
    }
    const raw = doc.toJS() as unknown;
    if (raw == null) continue; // empty document (e.g. trailing ---)
    if (!isPlainObject(raw)) throw new Error(`Policy definition ${fileName}: each document must be a mapping`);
    const where = `Policy definition ${fileName}${typeof raw.policy_id === "string" ? ` (${raw.policy_id})` : ""}`;
    if (typeof raw.policy_id !== "string" || raw.policy_id.trim() === "") {
      throw new Error(`${where}: "policy_id" is required (non-empty string)`);
    }
    if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
      throw new Error(`${where}: "version" is required (integer ≥ 1)`);
    }
    if (typeof raw.effect !== "string" || !(POLICY_DEFINITION_EFFECTS as readonly string[]).includes(raw.effect)) {
      throw new Error(`${where}: "effect" must be one of ${POLICY_DEFINITION_EFFECTS.join("|")}`);
    }
    const actionPattern =
      raw.action_pattern == null
        ? null
        : typeof raw.action_pattern === "string" && raw.action_pattern.trim() !== ""
          ? raw.action_pattern.trim()
          : (() => {
              throw new Error(`${where}: "action_pattern" must be a non-empty string when present`);
            })();
    const resourcePattern =
      raw.resource_pattern == null
        ? null
        : typeof raw.resource_pattern === "string" && raw.resource_pattern.trim() !== ""
          ? raw.resource_pattern.trim()
          : (() => {
              throw new Error(`${where}: "resource_pattern" must be a non-empty string when present`);
            })();
    let conditions: PolicyConditionJson[] = [];
    if (raw.conditions != null) {
      if (!Array.isArray(raw.conditions)) throw new Error(`${where}: "conditions" must be an array`);
      conditions = raw.conditions.map((c, idx) => {
        if (!isPlainObject(c) || typeof c.path !== "string" || c.path.trim() === "") {
          throw new Error(`${where}: conditions[${idx}] must have a non-empty string "path"`);
        }
        if (typeof c.op !== "string" || !VALID_OPS.has(c.op)) {
          throw new Error(`${where}: conditions[${idx}].op must be one of ${[...VALID_OPS].join("|")}`);
        }
        return { path: c.path.trim(), op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) };
      });
    }
    // Guardrail mirror of policyEngine.ruleMatches: a deny/require_approval rule
    // with NO conditions never matches — reject it as-code so a reviewer sees it.
    if (conditions.length === 0 && raw.effect !== "allow") {
      throw new Error(`${where}: a "${raw.effect}" policy requires at least one condition (empty never matches)`);
    }
    if (conditions.length === 0 && raw.effect === "allow" && !actionPattern) {
      throw new Error(`${where}: an unconditioned allow policy must be action-scoped ("action_pattern")`);
    }
    const priority =
      raw.priority == null
        ? 0
        : typeof raw.priority === "number" && Number.isInteger(raw.priority)
          ? raw.priority
          : (() => {
              throw new Error(`${where}: "priority" must be an integer when present`);
            })();
    const status =
      raw.status == null
        ? "active"
        : typeof raw.status === "string" && (POLICY_DEFINITION_STATUSES as readonly string[]).includes(raw.status)
          ? (raw.status as PolicyDefinitionStatus)
          : (() => {
              throw new Error(`${where}: "status" must be one of ${POLICY_DEFINITION_STATUSES.join("|")}`);
            })();
    out.push({
      policyId: raw.policy_id.trim(),
      version: raw.version,
      effect: raw.effect as PolicyDefinitionEffect,
      actionPattern,
      resourcePattern,
      conditions,
      priority,
      status,
      description: typeof raw.description === "string" ? raw.description.trim() : null,
    });
  }
  return out;
}

/** Load + validate every *.policy.yaml in `dir` (duplicate policy_id within Git → error). */
export function loadPolicyFiles(dir: string = POLICY_CONTRACTS_DIR): PolicyFileDef[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".policy.yaml") || f.endsWith(".policy.yml"))
    .sort();
  const out: PolicyFileDef[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const def of parsePolicyDefinitionsYaml(fs.readFileSync(path.join(dir, file), "utf8"), file)) {
      const key = `${def.policyId}@${def.version}`;
      if (seen.has(key)) throw new Error(`Policy "${key}" defined more than once (duplicate in ${file})`);
      seen.add(key);
      out.push(def);
    }
  }
  return out;
}

// ── Git → DB sync ─────────────────────────────────────────────────────────────

export interface PolicySyncResult {
  policyId: string;
  version: number;
  action: "inserted" | "updated" | "unchanged" | "skipped_older" | "error";
  detail?: string;
}

/** Stable content fingerprint for the equal-version upsert (order-fixed fields). */
function contentKey(d: {
  effect: string;
  actionPattern: string | null;
  resourcePattern: string | null;
  conditions: PolicyConditionJson[];
  priority: number;
  status: string;
  description: string | null;
}): string {
  return JSON.stringify([d.effect, d.actionPattern, d.resourcePattern, d.conditions, d.priority, d.status, d.description]);
}

function rowContentKey(row: PolicyDefinition): string {
  return contentKey({
    effect: row.effect,
    actionPattern: row.actionPattern ?? null,
    resourcePattern: row.resourcePattern ?? null,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    priority: row.priority ?? 0,
    status: row.status,
    description: row.description ?? null,
  });
}

/**
 * Sync as-code files → policy_definitions. Upsert key = (policy_id, version):
 *   • policy_id unknown OR file version > max DB version → INSERT (source 'git')
 *   • file version < max DB version → SKIP + warn (DB governance is ahead)
 *   • file version == max DB version → content-compare → UPDATE or unchanged.
 * Never throws for a single bad file/row — returns per-definition results.
 */
export async function syncPoliciesFromFiles(opts: { dir?: string } = {}): Promise<PolicySyncResult[]> {
  const results: PolicySyncResult[] = [];
  let defs: PolicyFileDef[];
  try {
    defs = loadPolicyFiles(opts.dir);
  } catch (err) {
    // data-raw-ok: lỗi ĐỌC/PHÂN TÍCH tệp chính sách trên đĩa (YAML hỏng, thiếu tệp).
    // `policyId: "(load)"` cho thấy đây là sự cố tầng TỆP, không phải một chính sách cụ
    // thể. Người sửa là quản trị đang biên tập chính tệp đó.
    return [{ policyId: "(load)", version: 0, action: "error", detail: err instanceof Error ? err.message : String(err) }];
  }
  if (defs.length === 0) return results;

  const db = await getDb();
  if (!db) {
    return defs.map((d) => ({ policyId: d.policyId, version: d.version, action: "error" as const, detail: "db unavailable" }));
  }
  let existing: PolicyDefinition[];
  try {
    existing = (await db.select().from(policyDefinitions)) as PolicyDefinition[];
  } catch (err) {
    const detail = `policy_definitions read failed (is migration 0256 applied?): ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[policy] ${detail}`);
    return defs.map((d) => ({ policyId: d.policyId, version: d.version, action: "error" as const, detail }));
  }

  for (const def of defs) {
    try {
      const rows = existing.filter((r) => r.policyId === def.policyId);
      const maxVersion = rows.reduce((m, r) => Math.max(m, r.version), 0);
      if (rows.length === 0 || def.version > maxVersion) {
        await db.insert(policyDefinitions).values({
          policyId: def.policyId,
          version: def.version,
          effect: def.effect,
          actionPattern: def.actionPattern,
          resourcePattern: def.resourcePattern,
          conditions: def.conditions,
          priority: def.priority,
          status: def.status,
          source: "git",
          description: def.description,
        });
        results.push({ policyId: def.policyId, version: def.version, action: "inserted" });
      } else if (def.version < maxVersion) {
        const detail = `as-code version ${def.version} < DB version ${maxVersion} — DB governance is ahead; file NOT applied`;
        console.warn(`[policy] sync skip "${def.policyId}": ${detail}`);
        results.push({ policyId: def.policyId, version: def.version, action: "skipped_older", detail });
      } else {
        const same = rows.find((r) => r.version === def.version);
        if (same && rowContentKey(same) === contentKey(def)) {
          results.push({ policyId: def.policyId, version: def.version, action: "unchanged" });
        } else {
          await db
            .update(policyDefinitions)
            .set({
              effect: def.effect,
              actionPattern: def.actionPattern,
              resourcePattern: def.resourcePattern,
              conditions: def.conditions,
              priority: def.priority,
              status: def.status,
              source: "git",
              description: def.description,
              updatedAt: new Date(),
            })
            .where(and(eq(policyDefinitions.policyId, def.policyId), eq(policyDefinitions.version, def.version)));
          results.push({ policyId: def.policyId, version: def.version, action: "updated" });
        }
      }
    } catch (err) {
      results.push({
        policyId: def.policyId,
        version: def.version,
        action: "error",
        // data-raw-ok: kết quả nạp MỘT tệp chính sách; quản trị đang biên tập chính tệp đó cần
        // biết dòng nào sai.
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ── DB → engine rules ─────────────────────────────────────────────────────────

/** Map active DB rows → engine PolicyRule[] (highest version per policy_id wins). */
export function rowsToRules(rows: readonly PolicyDefinition[]): PolicyRule[] {
  const latest = new Map<string, PolicyDefinition>();
  for (const row of rows) {
    if (row.status !== "active") continue;
    const cur = latest.get(row.policyId);
    if (!cur || row.version > cur.version) latest.set(row.policyId, row);
  }
  return [...latest.values()].map((row) => ({
    id: row.policyId,
    effect: row.effect,
    conditions: (Array.isArray(row.conditions) ? row.conditions : []) as PolicyCondition[],
    reason: row.description ?? row.policyId,
    version: String(row.version),
    actionPattern: row.actionPattern ?? null,
    resourcePattern: row.resourcePattern ?? null,
    priority: row.priority ?? 0,
    enabled: true,
  }));
}

/** Read the active rule set from the DB (throws on DB errors — callers decide). */
export async function loadPoliciesFromDb(): Promise<PolicyRule[]> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const rows = (await db.select().from(policyDefinitions)) as PolicyDefinition[];
  return rowsToRules(rows);
}

// ── synchronous snapshot (the evaluator's read path) ─────────────────────────

const SNAPSHOT_TTL_MS = 30_000;

let snapshot: { rules: PolicyRule[]; loadedAt: number } | null = null;
let refreshing = false;

/** Await-able refresh (boot + tests). Fail-safe: keeps the old snapshot on error. */
export async function refreshPolicySnapshot(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const rules = await loadPoliciesFromDb();
    snapshot = { rules, loadedAt: Date.now() };
  } catch (err) {
    console.warn("[policy] snapshot refresh failed (keeping previous):", err instanceof Error ? err.message : String(err));
  } finally {
    refreshing = false;
  }
}

/**
 * The evaluator's SYNCHRONOUS rule source. Store OFF → null (caller falls back
 * to DEFAULT_POLICIES — behaviour unchanged). Store ON → last-loaded snapshot;
 * staleness > 30 s fires a BACKGROUND refresh (TTL invalidation) and serves the
 * stale rules meanwhile; before the first load completes → null (fallback).
 */
export function getPolicySnapshotSync(): readonly PolicyRule[] | null {
  if (!policyStoreEnabled()) return null;
  if (!snapshot || Date.now() - snapshot.loadedAt > SNAPSHOT_TTL_MS) void refreshPolicySnapshot();
  return snapshot ? snapshot.rules : null;
}

// ── boot init (parent wires: await initPolicyStore() in server/_core/index.ts) ─

/**
 * Boot-time init: flag OFF → total no-op. ON → Git→DB sync, then load the
 * snapshot. Never throws into startup.
 */
export async function initPolicyStore(): Promise<{ enabled: boolean; synced: PolicySyncResult[]; loaded: number }> {
  if (!policyStoreEnabled()) return { enabled: false, synced: [], loaded: 0 };
  let synced: PolicySyncResult[] = [];
  try {
    synced = await syncPoliciesFromFiles();
  } catch (err) {
    console.error("[policy] as-code sync failed:", err instanceof Error ? err.message : String(err));
  }
  await refreshPolicySnapshot();
  const loaded = snapshot?.rules.length ?? 0;
  console.log(
    `[policy] store enabled — ${loaded} active rule(s) loaded ` +
      `(sync: ${synced.filter((s) => s.action === "inserted").length} inserted, ` +
      `${synced.filter((s) => s.action === "updated").length} updated, ` +
      `${synced.filter((s) => s.action === "unchanged").length} unchanged, ` +
      `${synced.filter((s) => s.action === "skipped_older").length} skipped, ` +
      `${synced.filter((s) => s.action === "error").length} error).`,
  );
  return { enabled: true, synced, loaded };
}

// ── append-only decision log ──────────────────────────────────────────────────

const SECRET_KEY_RX = /pass(word)?|secret|token|credential|api[-_]?key|private|auth/i;

function summarizeValue(v: unknown, depth: number): unknown {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 128 ? `${v.slice(0, 128)}…` : v;
  if (Array.isArray(v)) return `[array:${v.length}]`;
  if (typeof v === "object") {
    if (depth <= 0) return "[object]";
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (n >= 24) {
        out["…"] = "truncated";
        break;
      }
      n += 1;
      out[k] = SECRET_KEY_RX.test(k) ? "[redacted]" : summarizeValue(val, depth - 1);
    }
    return out;
  }
  return `[${typeof v}]`;
}

/** REDACTED shallow context summary — secret-looking keys masked, depth-limited. */
export function summarizeContext(ctx: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!ctx || typeof ctx !== "object") return null;
  return summarizeValue(ctx, 2) as Record<string, unknown>;
}

export interface DecisionLogEntry {
  requestId?: string | null;
  subject?: string | null;
  action: string;
  resource?: string | null;
  decision: "PERMIT" | "DENY";
  reasonCode: string;
  policyRef?: string | null;
  obligations: string[];
  latencyMs?: number | null;
  /** RAW context — redacted here before persistence. */
  context?: Record<string, unknown> | null;
}

const pendingWrites = new Set<Promise<unknown>>();
let warnedWriteFailure = false;

/**
 * APPEND-ONLY write (INSERT only — no update/delete path exists for this table).
 * Fire-and-forget + fail-safe: never throws, never blocks the command path.
 */
export function writePolicyDecisionLog(entry: DecisionLogEntry): void {
  const p = (async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(policyDecisionLog).values({
      requestId: entry.requestId ?? null,
      subject: entry.subject ?? null,
      action: entry.action,
      resource: entry.resource ?? null,
      decision: entry.decision,
      reasonCode: entry.reasonCode,
      policyRef: entry.policyRef ?? null,
      obligations: entry.obligations,
      latencyMs: entry.latencyMs ?? null,
      contextSummary: summarizeContext(entry.context),
    });
  })().catch((err) => {
    if (!warnedWriteFailure) {
      warnedWriteFailure = true;
      console.warn(
        "[policy] decision-log write failed (is migration 0256_policy_store applied?):",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
  pendingWrites.add(p);
  void p.finally(() => pendingWrites.delete(p));
}

/** Await all in-flight decision-log writes (tests / graceful shutdown). */
export async function flushPolicyDecisionLog(): Promise<void> {
  await Promise.allSettled([...pendingWrites]);
}

// ── read surfaces for the REST API (server/api/v1/policy.ts) ─────────────────

export interface PolicyListing {
  policy_id: string;
  version: number;
  effect: string;
  action_pattern: string | null;
  resource_pattern: string | null;
  conditions: PolicyConditionJson[];
  priority: number;
  status: string;
  source: string;
  description: string | null;
  updated_at?: string;
}

/**
 * List policies for GET /v1/policy/policies. Store ON → every DB row (all
 * versions/statuses — governance view). Store OFF → the built-in
 * DEFAULT_POLICIES presented in the same shape (source "builtin").
 */
export async function listStoredPolicies(): Promise<{ storeEnabled: boolean; policies: PolicyListing[] }> {
  if (policyStoreEnabled()) {
    const db = await getDb();
    if (!db) return { storeEnabled: true, policies: [] };
    const rows = (await db.select().from(policyDefinitions)) as PolicyDefinition[];
    return {
      storeEnabled: true,
      policies: rows.map((r) => ({
        policy_id: r.policyId,
        version: r.version,
        effect: r.effect,
        action_pattern: r.actionPattern ?? null,
        resource_pattern: r.resourcePattern ?? null,
        conditions: Array.isArray(r.conditions) ? r.conditions : [],
        priority: r.priority ?? 0,
        status: r.status,
        source: r.source,
        description: r.description ?? null,
        updated_at: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
      })),
    };
  }
  return {
    storeEnabled: false,
    policies: DEFAULT_POLICIES.map((p) => ({
      policy_id: p.id,
      version: 1,
      effect: p.effect,
      action_pattern: p.actions?.join(",") ?? null,
      resource_pattern: null,
      conditions: p.conditions as PolicyConditionJson[],
      priority: 0,
      status: p.enabled === false ? "disabled" : "active",
      source: "builtin",
      description: p.reason,
    })),
  };
}

export interface DecisionLogFilters {
  subject?: string;
  action?: string;
  decision?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Query the immutable decision log (newest first) for GET /v1/policy/audit. */
export async function queryDecisionLog(filters: DecisionLogFilters): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const conds = [];
  if (filters.subject) conds.push(eq(policyDecisionLog.subject, filters.subject));
  if (filters.action) conds.push(eq(policyDecisionLog.action, filters.action));
  if (filters.decision) conds.push(eq(policyDecisionLog.decision, filters.decision));
  if (filters.from) conds.push(gte(policyDecisionLog.ts, filters.from));
  if (filters.to) conds.push(lte(policyDecisionLog.ts, filters.to));
  const limit = Math.min(Math.max(1, Math.trunc(filters.limit ?? 100)), 500);
  const base = db.select().from(policyDecisionLog);
  const rows = await (conds.length > 0 ? base.where(and(...conds)) : base).orderBy(desc(policyDecisionLog.ts)).limit(limit);
  return rows as Array<Record<string, unknown>>;
}

// ── test seam ─────────────────────────────────────────────────────────────────

/** Reset module state (tests). */
export function _resetPolicyStoreForTests(): void {
  snapshot = null;
  refreshing = false;
  warnedWriteFailure = false;
  pendingWrites.clear();
}
