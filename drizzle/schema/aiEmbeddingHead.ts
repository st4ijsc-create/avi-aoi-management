// Schema domain: AOI-C — first-party embedding-head defect classifier (doc 24 Wave-3)
//                — flag AOI_DL_HEAD_ENABLED (default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// ai_embedding_datasets — an IMMUTABLE, content-addressed snapshot of the
// (embedding, label) pairs used to train a lightweight defect-classifier HEAD over
// frozen DINOv2 image embeddings (see server/services/ai/embeddingHeadTrainer.ts).
//
//   • The vectors are stored INLINE in `samples` (JSON) so the version is fully
//     self-contained + reproducible — it never re-reads ai_image_embeddings (which
//     may change), guaranteeing a training set that is frozen at snapshot time.
//   • `checksum` = sha256 over canonical sample content — the same labels+vectors
//     always yield the same checksum (reproducibility proof). The service NEVER
//     UPDATEs a row (append-only / immutable): a new label set = a NEW version.
//   • Reuses the EXISTING model-registry (ai_models / model_versions) for the
//     trained artifact + A/B + drift + rollback; this table only versions the DATA.
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror aiLoop/fieldHealth.
// RLS is wired inert-by-default (app_tenant_allows) in migration 0159.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/** One frozen training sample: an embedding vector + its label. */
export interface EmbeddingDatasetSampleRow {
  embeddingId: number | string | null;
  label: string;
  vector: number[];
}

export const aiEmbeddingDatasets = pgTable("ai_embedding_datasets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Soft FK → ai_models.id (the head model this dataset version trains). Nullable
  // because a dataset can be snapshotted before the head model row exists.
  modelId: integer("modelId"),
  // Optional scope of the label source.
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  // Stable, sorted class labels — class index = position (matches the head artifact).
  classLabels: jsonb("classLabels").$type<string[]>().notNull(),
  labelDistribution: jsonb("labelDistribution").$type<Record<string, number>>().notNull(),
  sampleCount: integer("sampleCount").default(0).notNull(),
  inputDim: integer("inputDim").default(0).notNull(),
  // Deterministic split seed + ratios (reproducible train/val/test).
  splitSeed: integer("splitSeed").default(1337).notNull(),
  splitConfig: jsonb("splitConfig").$type<{ train: number; validation: number; test: number }>(),
  // sha256 over canonical sample content — reproducibility / immutability proof.
  checksum: varchar("checksum", { length: 64 }).notNull(),
  // Frozen samples (vectors stored INLINE — self-contained, immutable).
  samples: jsonb("samples").$type<EmbeddingDatasetSampleRow[]>().notNull(),
  // Honest audit of rows dropped at assembly time.
  dropped: jsonb("dropped").$type<{ badVector: number; dimMismatch: number; noLabel: number; duplicate: number }>(),
  // Provenance tag of the label source(s).
  source: varchar("source", { length: 64 }).default("ai_image_embeddings+label_queue").notNull(),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_emb_dataset_model").on(table.modelId),
  index("idx_emb_dataset_checksum").on(table.checksum),
  index("idx_emb_dataset_created").on(table.createdAt),
]);

export type AiEmbeddingDataset = typeof aiEmbeddingDatasets.$inferSelect;
export type InsertAiEmbeddingDataset = typeof aiEmbeddingDatasets.$inferInsert;
