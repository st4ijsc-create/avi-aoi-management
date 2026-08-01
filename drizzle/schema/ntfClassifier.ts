// Schema domain: ntf_classifier_models — W5-B1 (doc 44, gap G4.12).
//
// ════════════════════════════════════════════════════════════════════════════
// A TRAINED false-call (NTF) classifier over engineered tabular features (the 3
// heuristic NTF signals + defect-type + station one-hots). The model is a
// lightweight multinomial-logistic HEAD (reuses embeddingHeadTrainer) whose
// artifact — weights, feature vocab, standardization, temperature — is stored
// INLINE in `artifact` (JSON), so a version is fully self-contained + immutable
// and needs no fs. This is a DEDICATED table (NOT ai_models/model_versions)
// because the NTF classifier is a tabular model over harvested human verdicts,
// structurally unlike the image/embedding models in the vision registry —
// keeping it here avoids polluting that registry's UI/A-B/drift tooling.
//
// LIFECYCLE: append-only. A retrain inserts a NEW row (status 'candidate'); it is
// promoted to 'active' ONLY when its held-out TEST metric beats the heuristic
// baseline (quality gate). Activating a row retires the previously-active one.
// ntfPredictorService reads the single active row when NTF_CLASSIFIER_ENABLED is
// on and falls back to the heuristic otherwise. See:
//   server/services/ai/ntfClassifierService.ts  (train/eval/gate/serve)
//   drizzle/0263_ntf_classifier.sql
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const ntfClassifierModels = pgTable("ntf_classifier_models", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull(),
  // 'candidate' (trained, gate not passed / not promoted) | 'active' | 'retired'.
  status: varchar("status", { length: 20 }).default("candidate").notNull(),
  // Feature-extractor contract version — bumped when the feature set changes so a
  // stale artifact is never served against a newer feature vector (train/serve skew).
  featureSchema: varchar("featureSchema", { length: 32 }).notNull(),
  // Stable, sorted class labels — ["false_call","true_defect"].
  classLabels: jsonb("classLabels").$type<string[]>().notNull(),
  // Ordered feature names (parallel to the artifact head's inputDim).
  featureNames: jsonb("featureNames").$type<string[]>().notNull(),
  // The self-contained model artifact (head weights + vocab + standardization + temp).
  artifact: jsonb("artifact").$type<Record<string, unknown>>().notNull(),
  // sha256 over the training sample content (reproducibility / dedupe).
  datasetChecksum: varchar("datasetChecksum", { length: 64 }).notNull(),
  sampleCount: integer("sampleCount").default(0).notNull(),
  trainCount: integer("trainCount").default(0).notNull(),
  valCount: integer("valCount").default(0).notNull(),
  testCount: integer("testCount").default(0).notNull(),
  labelDistribution: jsonb("labelDistribution").$type<Record<string, number>>(),
  // REAL held-out TEST metrics (never fabricated).
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
  valMetrics: jsonb("valMetrics").$type<Record<string, unknown>>(),
  // The heuristic baseline evaluated on the SAME test split (the gate's baseline).
  baselineMetrics: jsonb("baselineMetrics").$type<Record<string, unknown>>(),
  // Quality-gate verdict (metric, delta, pass) — why this version was/ wasn't promoted.
  gate: jsonb("gate").$type<Record<string, unknown>>(),
  // G4.14 class-balance audit (mode + distribution before/after + weights).
  classBalance: jsonb("classBalance").$type<Record<string, unknown>>(),
  // Optional scope (null = global). Reserved for future per-machine models.
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  activatedAt: timestamp("activatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ntf_clf_status").on(table.status),
  index("idx_ntf_clf_created").on(table.createdAt),
  index("idx_ntf_clf_checksum").on(table.datasetChecksum),
]);

export type NtfClassifierModel = typeof ntfClassifierModels.$inferSelect;
export type InsertNtfClassifierModel = typeof ntfClassifierModels.$inferInsert;
