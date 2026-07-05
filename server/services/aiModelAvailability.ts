/**
 * aiModelAvailability.ts — doc 27 Đợt 7 W7-D (gap V4): startup honesty for the
 * shipped model set.
 *
 * Reads models/manifest.json (the same manifest scripts/fetch-models.mjs
 * provisions from), checks every entry's file on disk (onnx entries under
 * models/, external-gguf entries at their env-configured paths), then:
 *
 *   1. logs ONE consolidated line — which models are present/missing and the
 *      embedding tier actually in effect (onnx / text-of-image / heuristic);
 *   2. upserts a db_feature_status row (feature 'ai_models') so the admin
 *      "DB & Ingest health" card (systemHealthRouter.dbIngestHealth →
 *      readDbFeatureStatus) surfaces model state next to the timescaledb /
 *      retention / integrity rows written by migrations 0172/0173/0180.
 *
 * NON-FATAL by design: no DB / no manifest / no models never blocks boot —
 * the runtime already degrades honestly tier-by-tier (aiImageEmbedding).
 */
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

interface ManifestEntry {
  name: string;
  kind?: string; // "onnx" (default) | "external-gguf"
  file?: string;
  required?: boolean;
  pathEnv?: string;
  extraPathEnvs?: string[];
  dirEnv?: string;
}

export interface ModelAvailabilityItem {
  name: string;
  kind: string;
  required: boolean;
  path: string | null;
  present: boolean;
}

export interface ModelAvailabilityReport {
  /** 'ok' — all required present; 'partial' — some; 'missing' — none of the required. */
  status: "ok" | "partial" | "missing";
  items: ModelAvailabilityItem[];
  /** Active embedding tier from getDinov2ModelHealth (null if probe failed). */
  embeddingTier: string | null;
  detail: string;
}

function manifestPath(): string {
  // AI_MODELS_MANIFEST_PATH: deployment/test override (default repo-relative).
  return process.env.AI_MODELS_MANIFEST_PATH
    ? path.resolve(process.env.AI_MODELS_MANIFEST_PATH)
    : path.resolve(process.cwd(), "models", "manifest.json");
}

function resolveExternal(entry: ManifestEntry): string | null {
  const raw = entry.pathEnv ? process.env[entry.pathEnv] : undefined;
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  const dir = entry.dirEnv ? process.env[entry.dirEnv] : undefined;
  return dir ? path.join(dir, raw) : path.resolve(process.cwd(), raw);
}

function exists(p: string | null): boolean {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Pure check (no DB, no log) — exported for tests. */
export async function checkModelAvailability(): Promise<ModelAvailabilityReport> {
  let entries: ManifestEntry[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
    entries = Array.isArray(manifest.models) ? manifest.models : [];
  } catch {
    // manifest absent/corrupt — report honestly below with zero entries
  }

  const items: ModelAvailabilityItem[] = entries.map((entry) => {
    if (entry.kind === "external-gguf") {
      const p = resolveExternal(entry);
      const extras = (entry.extraPathEnvs ?? [])
        .map((e) => process.env[e])
        .filter((v): v is string => !!v);
      const present = exists(p) && extras.every((x) => exists(x));
      return { name: entry.name, kind: entry.kind, required: !!entry.required, path: p, present };
    }
    const p = entry.file ? path.join(path.dirname(manifestPath()), entry.file) : null;
    return { name: entry.name, kind: entry.kind ?? "onnx", required: !!entry.required, path: p, present: exists(p) };
  });

  const required = items.filter((i) => i.required);
  const presentRequired = required.filter((i) => i.present);
  const status: ModelAvailabilityReport["status"] =
    required.length === 0 || presentRequired.length === required.length
      ? "ok"
      : presentRequired.length === 0
        ? "missing"
        : "partial";

  // Active embedding tier — same probe the health endpoint uses, so the log
  // line matches actual runtime behaviour. Dynamic import: keeps this module
  // free of onnxruntime/sharp when only the status is needed.
  let embeddingTier: string | null = null;
  try {
    const { getDinov2ModelHealth } = await import("./aiImageEmbedding");
    embeddingTier = (await getDinov2ModelHealth()).activeTier;
  } catch {
    embeddingTier = null;
  }

  const parts = items.map(
    (i) => `${i.name}=${i.present ? "present" : i.required ? "MISSING" : "absent(optional)"}`,
  );
  const detail =
    (entries.length === 0
      ? "models/manifest.json not readable — model set unknown; "
      : "") +
    parts.join("; ") +
    ` | embedding tier: ${embeddingTier ?? "unknown"}` +
    (status !== "ok" ? " | fetch: node scripts/fetch-models.mjs (models/README.md)" : "");

  return { status, items, embeddingTier, detail };
}

/**
 * Startup entry: ONE consolidated log line + db_feature_status upsert.
 * Never throws.
 */
export async function reportAiModelAvailability(): Promise<ModelAvailabilityReport | null> {
  try {
    const report = await checkModelAvailability();

    const logLine =
      `[AIModels] ${report.status.toUpperCase()} — ` +
      report.items
        .map((i) => `${i.name}: ${i.present ? "present" : i.required ? "MISSING" : "absent(optional)"}`)
        .join(" | ") +
      ` → embedding tier: ${report.embeddingTier ?? "unknown"}` +
      (report.status === "ok" ? "" : " — fetch: node scripts/fetch-models.mjs");
    if (report.status === "ok") console.log(logLine);
    else console.warn(logLine);

    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`
          INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
          VALUES ('ai_models', ${report.status}, ${report.detail}, now())
          ON CONFLICT ("feature")
          DO UPDATE SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now()
        `);
      }
    } catch (err) {
      // Table missing (migration 0172 not applied) or DB down — log already emitted.
      console.warn(
        "[AIModels] db_feature_status upsert skipped:",
        err instanceof Error ? err.message : err,
      );
    }

    return report;
  } catch (err) {
    console.warn("[AIModels] availability check failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
