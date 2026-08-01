// Schema domain: Policy Store — policy-as-code definitions + immutable decision log
// (doc 44 Batch W3-A1, gaps G3.11 + G3.13). SYNAPSE Tầng 3 §11 (Policy Engine),
// §12.3 (PolicyDecision), §13.3 (Policy API).
//
// ════════════════════════════════════════════════════════════════════════════
// policy_definitions — versioned guardrail rules. Source of truth is Git
//   (contracts/policies/*.policy.yaml); the boot loader (policyStore.ts,
//   POLICY_STORE_ENABLED default OFF) syncs Git → DB by (policy_id, version):
//   file version < max DB version → skip + warn (DB governance wins), equal →
//   idempotent content upsert, greater → new version row. `source` records
//   provenance: 'git' (as-code) vs 'db' (edited via a governance workflow).
//   Effect/status are app-validated text (repo convention, no pg enum — mirrors
//   0226/0248/0252 reasoning). Conditions = the policyEngine PolicyCondition[]
//   JSON ({path, op, value}); patterns are glob-ish ("ot.command.*").
//
// policy_decision_log — APPEND-ONLY audit (spec §11.2 "Audit bất biến"): the
//   application code has NO update/delete path for this table (inserts only).
//   DENY / require-approval decisions are ALWAYS logged; PERMIT is logged when
//   the action is inside the POLICY_DEFAULT_DENY_ACTIONS group or when
//   POLICY_AUDIT_PERMIT_ALL=true (spec wants every PERMIT — the gate keeps a
//   chatty transition phase from flooding the DB). context_summary holds a
//   REDACTED shallow summary — NEVER secrets/credentials (see
//   policyStore.summarizeContext).
// Migration: drizzle/0256_policy_store.sql.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, text, timestamp, jsonb, real, index, uniqueIndex } from "drizzle-orm/pg-core";

/** App-validated policy effects (matches policyEngine.PolicyEffect). */
export const POLICY_DEFINITION_EFFECTS = ["allow", "deny", "require_approval"] as const;
export type PolicyDefinitionEffect = (typeof POLICY_DEFINITION_EFFECTS)[number];

/** App-validated definition statuses. */
export const POLICY_DEFINITION_STATUSES = ["active", "disabled"] as const;
export type PolicyDefinitionStatus = (typeof POLICY_DEFINITION_STATUSES)[number];

/** Where a definition row came from. */
export const POLICY_DEFINITION_SOURCES = ["git", "db"] as const;
export type PolicyDefinitionSource = (typeof POLICY_DEFINITION_SOURCES)[number];

/** Serialized policyEngine.PolicyCondition. */
export interface PolicyConditionJson {
  path: string;
  op: string;
  value?: unknown;
}

export const policyDefinitions = pgTable(
  "policy_definitions",
  {
    id: serial("id").primaryKey(),
    /** Stable rule identity (e.g. "deny-skip-aoi-class3"); versioned rows share it. */
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    effect: text("effect").$type<PolicyDefinitionEffect>().notNull(),
    /** Glob-ish action pattern ("ot.command.*"); no `*` → exact match. */
    actionPattern: text("action_pattern"),
    /** Glob-ish resource pattern; NULL → any resource. */
    resourcePattern: text("resource_pattern"),
    /** policyEngine PolicyCondition[] (AND-ed). */
    conditions: jsonb("conditions").$type<PolicyConditionJson[]>().default([]).notNull(),
    /** Higher evaluates first within the same effect class. */
    priority: integer("priority").default(0).notNull(),
    status: text("status").$type<PolicyDefinitionStatus>().default("active").notNull(),
    source: text("source").$type<PolicyDefinitionSource>().default("git").notNull(),
    /** Human reason surfaced to the operator + audit (legacy Policy.reason). */
    description: text("description"),
    /** users.id of the last editor (NULL for the Git sync loader). */
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_policy_definitions_policy_version").on(t.policyId, t.version),
    index("idx_policy_definitions_status").on(t.status),
  ],
);

export const policyDecisionLog = pgTable(
  "policy_decision_log",
  {
    id: serial("id").primaryKey(),
    /** Caller-supplied correlation (spec §12.3 request_id); NULL when absent. */
    requestId: text("request_id"),
    subject: text("subject"),
    action: text("action").notNull(),
    resource: text("resource"),
    /** 'PERMIT' | 'DENY' (spec §11.2). */
    decision: text("decision").notNull(),
    reasonCode: text("reason_code").notNull(),
    /** policy_definitions.policy_id that determined the decision; NULL = group default. */
    policyRef: text("policy_ref"),
    obligations: jsonb("obligations").$type<string[]>().default([]).notNull(),
    latencyMs: real("latency_ms"),
    /** REDACTED shallow context summary — never secrets (policyStore.summarizeContext). */
    contextSummary: jsonb("context_summary").$type<Record<string, unknown>>(),
    ts: timestamp("ts").defaultNow().notNull(),
  },
  (t) => [
    index("idx_policy_decision_log_ts").on(t.ts),
    index("idx_policy_decision_log_action").on(t.action),
    index("idx_policy_decision_log_decision").on(t.decision),
  ],
);

export type PolicyDefinition = typeof policyDefinitions.$inferSelect;
export type InsertPolicyDefinition = typeof policyDefinitions.$inferInsert;
export type PolicyDecisionLogRow = typeof policyDecisionLog.$inferSelect;
export type InsertPolicyDecisionLogRow = typeof policyDecisionLog.$inferInsert;
