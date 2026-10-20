/**
 * ★★ AI Local Đợt 7.0 (2026-10-20) — SỔ MODEL, migration `0400`. Spec:
 * docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md §3.3.
 *
 * ⚠ CHECK + UNIQUE một phần ở `drizzle/0400_ai_model_registry.sql` (gán trỏ ĐÚNG MỘT trong profileId|envKey; một gán còn
 *   hiệu lực cho mỗi (vai trò, phạm vi, chế độ); filePath ở gốc kho). Lịch sử gán: đặt `retiredAt`, không sửa tại chỗ.
 */
import { pgTable, varchar, text, integer, bigint, bigserial, numeric, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const aiModelArtifacts = pgTable("ai_model_artifacts", {
  id: varchar("id", { length: 96 }).primaryKey(),
  /** Tên tệp ở GỐC `GGUF_MODELS_DIR` (không thư mục). */
  filePath: varchar("filePath", { length: 260 }).notNull().unique(),
  sha256: varchar("sha256", { length: 64 }),
  family: varchar("family", { length: 48 }).notNull(),
  paramsTotalB: numeric("paramsTotalB"),
  paramsActiveB: numeric("paramsActiveB"),
  quant: varchar("quant", { length: 24 }),
  ctxNative: integer("ctxNative"),
  /** `unknown` ⇒ cấm gán active trỏ profile của artifact này. */
  license: varchar("license", { length: 48 }).notNull().default("unknown"),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  vramWeightsMb: integer("vramWeightsMb"),
  modalities: text("modalities").array().notNull().default(["text"]),
  /** `sinh-chu` | `nhung` | `xep-hang` | `chieu-thi-giac` */
  loai: varchar("loai", { length: 16 }).notNull().default("sinh-chu"),
  /** `available` | `missing` | `quarantined` */
  status: varchar("status", { length: 16 }).notNull().default("available"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const aiServingProfiles = pgTable("ai_serving_profiles", {
  id: varchar("id", { length: 96 }).primaryKey(),
  artifactId: varchar("artifactId", { length: 96 })
    .notNull()
    .references(() => aiModelArtifacts.id),
  /** `nang` (llama-server :8091, hoán đổi) | `nho` (trong tiến trình, thường trú) | `sidecar` */
  slotClass: varchar("slotClass", { length: 8 }).notNull(),
  ctx: integer("ctx").notNull(),
  serverArgs: jsonb("serverArgs").notNull().default({}),
  sampling: jsonb("sampling").notNull().default({}),
  /** `on` | `off` | `auto` */
  thinking: varchar("thinking", { length: 8 }).notNull().default("auto"),
  vramEstMb: integer("vramEstMb"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiRoles = pgTable("ai_roles", {
  id: varchar("id", { length: 48 }).primaryKey(),
  moTa: text("moTa").notNull(),
  evalSuite: varchar("evalSuite", { length: 64 }),
  examples: text("examples").array().notNull().default([]),
  envKey: varchar("envKey", { length: 32 }).notNull(),
  taskKind: varchar("taskKind", { length: 16 }).notNull(),
});

export const aiModelBindings = pgTable("ai_model_bindings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roleId: varchar("roleId", { length: 48 })
    .notNull()
    .references(() => aiRoles.id),
  /** `global` | `tenant` | `project` | `flow` */
  scopeKind: varchar("scopeKind", { length: 8 }).notNull(),
  scopeId: varchar("scopeId", { length: 64 }),
  profileId: varchar("profileId", { length: 96 }).references(() => aiServingProfiles.id),
  /** Gán THEO-ENV: tên khoá `.env` (vd `GGUF_CODE_MODEL`). Đúng một trong profileId|envKey. */
  envKey: varchar("envKey", { length: 32 }),
  fallback: text("fallback").array().notNull().default([]),
  evalRunId: bigint("evalRunId", { mode: "number" }),
  /** `active` | `shadow` | `thu` */
  mode: varchar("mode", { length: 8 }).notNull().default("active"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  retiredAt: timestamp("retiredAt"),
});

export const aiModelEvalRuns = pgTable(
  "ai_model_eval_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    profileId: varchar("profileId", { length: 96 }).notNull(),
    suite: varchar("suite", { length: 64 }).notNull(),
    nTasks: integer("nTasks"),
    nPass: integer("nPass"),
    nRuns: integer("nRuns"),
    p50Ms: integer("p50Ms"),
    p90Ms: integer("p90Ms"),
    detail: jsonb("detail"),
    gitSha: varchar("gitSha", { length: 40 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("ai_model_eval_runs_profile_idx").on(t.profileId, t.suite, t.createdAt)],
);

export type AiModelArtifact = typeof aiModelArtifacts.$inferSelect;
export type AiServingProfile = typeof aiServingProfiles.$inferSelect;
export type AiRole = typeof aiRoles.$inferSelect;
export type AiModelBinding = typeof aiModelBindings.$inferSelect;
export type AiModelEvalRun = typeof aiModelEvalRuns.$inferSelect;
