/**
 * Schema registry + BACKWARD-compat gate — SYNAPSE §5.6.4 / §9.1 (doc 33 §3.5 / F7 · H5).
 *
 * "Đổi schema UNS gây vỡ hàng loạt" is a top risk. This registry versions named JSON-Schemas
 * (REST payloads + Sparkplug/UNS payloads) and provides a BACKWARD-compatibility gate: a new
 * version is only accepted if it does NOT break existing consumers (additive-only). CI runs the
 * gate so a breaking change is caught before merge (a topic must bump to …/v2 instead)
 * (scripts/contracts-compat-check.mjs — keep its re-implemented gate in sync with this file).
 *
 * The compat core is pure + fail-safe. A JSON-Schema here is a plain object
 * ({type, properties, required, ...}).
 *
 * doc 44 Batch W0-E (gap G2.5) — the registry is no longer memory-only:
 *   • contracts/canonical/*.schema.json (Git) is the as-code source of truth (LDS-L1 contracts)
 *   • `contract_schemas` (migration 0248) persists the version lineage per subject
 *   • `initContractRegistry()` (flag CONTRACT_REGISTRY_PERSIST_ENABLED, default OFF) loads the
 *     persisted lineage then seeds/updates from the canonical files — every seed goes through
 *     `registerSchema`, i.e. through the BACKWARD gate
 *   • `validateMessage(subject, payload)` is the validation SEAM for ingest (telemetryBus /
 *     mqttService wire it in a LATER batch — nothing is enforced here)
 */

import fs from "node:fs";
import path from "node:path";

// No cycle: jsonSchemaValidator imports only the `JsonSchema` TYPE from this module.
import { validateAgainstSchema } from "./jsonSchemaValidator";

export type JsonSchema = Record<string, unknown>;

export interface SchemaVersion {
  name: string;
  version: number;
  schema: JsonSchema;
}

export interface CompatResult {
  compatible: boolean;
  breaking: string[];
  warnings: string[];
}

function props(s: JsonSchema): Record<string, JsonSchema> {
  const p = s.properties;
  return p && typeof p === "object" ? (p as Record<string, JsonSchema>) : {};
}
function requiredSet(s: JsonSchema): Set<string> {
  return new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
}

/**
 * Is `next` BACKWARD-compatible with `prev`? Additive-only is safe; removals / type changes /
 * new-required / shrunk enums are breaking. Conservative (favours safety).
 */
export function checkBackwardCompat(prev: JsonSchema, next: JsonSchema): CompatResult {
  const breaking: string[] = [];
  const warnings: string[] = [];

  if (prev.type && next.type && prev.type !== next.type) {
    breaking.push(`root type changed ${String(prev.type)} → ${String(next.type)}`);
  }

  const pProps = props(prev);
  const nProps = props(next);
  const pReq = requiredSet(prev);
  const nReq = requiredSet(next);

  // Removed properties that existed before → breaking (consumers may read them).
  for (const key of Object.keys(pProps)) {
    if (!(key in nProps)) {
      breaking.push(`property "${key}" removed`);
      continue;
    }
    const a = pProps[key];
    const b = nProps[key];
    if (a.type && b.type && a.type !== b.type) {
      breaking.push(`property "${key}" type changed ${String(a.type)} → ${String(b.type)}`);
    }
    // Enum shrunk → breaking (a previously-valid value is now rejected).
    if (Array.isArray(a.enum)) {
      const bEnum = Array.isArray(b.enum) ? (b.enum as unknown[]) : null;
      if (!bEnum) warnings.push(`property "${key}" dropped its enum constraint`);
      else {
        for (const v of a.enum as unknown[]) {
          if (!bEnum.includes(v)) breaking.push(`property "${key}" enum value ${JSON.stringify(v)} removed`);
        }
      }
    }
  }

  // Newly-required field (not required before) → breaking for producers of input.
  for (const key of nReq) {
    if (!pReq.has(key)) breaking.push(`property "${key}" became required`);
  }
  // Added optional properties → safe (informational).
  for (const key of Object.keys(nProps)) {
    if (!(key in pProps)) warnings.push(`property "${key}" added (optional — safe)`);
  }

  return { compatible: breaking.length === 0, breaking, warnings };
}

const registry = new Map<string, SchemaVersion[]>();

export class SchemaCompatError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly breaking: string[],
  ) {
    super(`Schema "${schemaName}" breaking change rejected: ${breaking.join("; ")}`);
    this.name = "SchemaCompatError";
  }
}

/**
 * Register a schema version. If a prior version exists, the new schema MUST be backward-compatible
 * (else SchemaCompatError). `allowBreaking:true` is only for an intentional new major (…/v2).
 */
export function registerSchema(name: string, schema: JsonSchema, opts: { allowBreaking?: boolean } = {}): SchemaVersion {
  const versions = registry.get(name) ?? [];
  const prev = versions[versions.length - 1];
  if (prev && !opts.allowBreaking) {
    const res = checkBackwardCompat(prev.schema, schema);
    if (!res.compatible) throw new SchemaCompatError(name, res.breaking);
  }
  const version = (prev?.version ?? 0) + 1;
  const entry: SchemaVersion = { name, version, schema };
  registry.set(name, [...versions, entry]);
  return entry;
}

export function getLatestSchema(name: string): SchemaVersion | undefined {
  const v = registry.get(name);
  return v ? v[v.length - 1] : undefined;
}

export function listSchemas(): { name: string; latestVersion: number; versions: number }[] {
  return [...registry.entries()].map(([name, v]) => ({
    name,
    latestVersion: v[v.length - 1].version,
    versions: v.length,
  }));
}

export function _clearSchemaRegistry(): void {
  registry.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// doc 44 Batch W0-E (gap G2.5) — persistence + canonical seed + validation seam
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hydrate one persisted version into the in-memory registry WITHOUT the compat gate — rows in
 * `contract_schemas` already passed the gate when they were registered/persisted. Keeps the
 * per-subject list sorted by version and de-duplicates (idempotent re-load).
 */
function hydrateSchema(name: string, version: number, schema: JsonSchema): void {
  const versions = registry.get(name) ?? [];
  if (versions.some((v) => v.version === version)) return;
  registry.set(
    name,
    [...versions, { name, version, schema }].sort((a, b) => a.version - b.version),
  );
}

/** Metadata persisted alongside a schema version (governance handles). */
export interface PersistMeta {
  schemaRef?: string;
  owner?: string;
  compatibility?: "BACKWARD" | "NONE";
}

/**
 * Load the persisted registry (status='active' rows) into memory. Fail-safe: no DB → 0 (the
 * in-memory registry keeps working exactly as before). Returns the number of rows hydrated.
 */
export async function loadRegistryFromDb(): Promise<number> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return 0;
  const { contractSchemas } = await import("../../../drizzle/schema/contracts");
  const { eq, asc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(contractSchemas)
    .where(eq(contractSchemas.status, "active"))
    .orderBy(asc(contractSchemas.subject), asc(contractSchemas.version));
  let hydrated = 0;
  for (const row of rows) {
    if (row.schemaJson && typeof row.schemaJson === "object") {
      hydrateSchema(row.subject, row.version, row.schemaJson as JsonSchema);
      hydrated++;
    }
  }
  return hydrated;
}

/**
 * Persist one registered version to `contract_schemas`. ON CONFLICT (subject, version) DO
 * NOTHING → idempotent across restarts / concurrent instances. Fail-safe: no DB → false.
 */
export async function persistSchema(entry: SchemaVersion, meta: PersistMeta = {}): Promise<boolean> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return false;
  const { contractSchemas } = await import("../../../drizzle/schema/contracts");
  await db
    .insert(contractSchemas)
    .values({
      subject: entry.name,
      version: entry.version,
      compatibility: meta.compatibility ?? "BACKWARD",
      schemaJson: entry.schema,
      schemaRef: meta.schemaRef,
      status: "active",
      owner: meta.owner,
    })
    .onConflictDoNothing();
  return true;
}

/** Default location of the as-code canonical contracts (repo root — server runs from there). */
export const CANONICAL_CONTRACTS_DIR = path.resolve(process.cwd(), "contracts", "canonical");

/** Outcome per canonical file during a seed pass. */
export interface SeedResult {
  file: string;
  subject: string;
  action: "registered" | "unchanged" | "error";
  version?: number;
  error?: string;
}

/** Subject for a canonical file: explicit `x-subject` wins, else derived from the filename. */
function subjectOf(fileName: string, doc: JsonSchema): string {
  const explicit = doc["x-subject"];
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return `canonical/${fileName.replace(/\.schema\.json$/i, "").replace(/\.json$/i, "")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * Seed/refresh the registry from contracts/canonical/*.json. Each changed file goes through
 * `registerSchema` — i.e. through the BACKWARD gate: a breaking canonical edit is REJECTED
 * (recorded as an error result, never crashes boot) — CI catches it earlier via
 * scripts/contracts-compat-check.mjs. Unchanged files are skipped; changed-but-compatible files
 * become the next version (and are persisted when `persist` is on and a DB is available).
 */
export async function seedCanonicalSchemas(
  opts: { dir?: string; persist?: boolean } = {},
): Promise<SeedResult[]> {
  const dir = opts.dir ?? CANONICAL_CONTRACTS_DIR;
  const results: SeedResult[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return results; // no canonical dir → nothing to seed (fail-safe)
  }
  for (const file of files) {
    let subject = "";
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as JsonSchema;
      subject = subjectOf(file, doc);
      const latest = getLatestSchema(subject);
      if (latest && stableStringify(latest.schema) === stableStringify(doc)) {
        results.push({ file, subject, action: "unchanged", version: latest.version });
        continue;
      }
      const entry = registerSchema(subject, doc); // ← BACKWARD gate
      if (opts.persist) {
        await persistSchema(entry, { schemaRef: `contracts/canonical/${file}`, owner: "platform" });
      }
      results.push({ file, subject, action: "registered", version: entry.version });
    } catch (err) {
      results.push({
        file,
        subject,
        action: "error",
        // data-raw-ok: kết quả nạp SCHEMA hợp đồng theo từng FILE — người đọc là kỹ sư
        // đang sửa chính file đó; câu generic sẽ không nói được file nào sai ở đâu.
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Is registry persistence + boot seed enabled? Default OFF (doc 44 batch rule). */
export function contractRegistryPersistEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTRACT_REGISTRY_PERSIST_ENABLED === "true" || env.CONTRACT_REGISTRY_PERSIST_ENABLED === "1";
}

/**
 * Boot entry — wire ONE line into server/_core (owned by another batch):
 *   `void initContractRegistry();`
 * Flag-gated (CONTRACT_REGISTRY_PERSIST_ENABLED, default OFF → no-op) and fail-safe: any
 * load/seed error is logged, never thrown — the registry falls back to memory-only behaviour.
 */
export async function initContractRegistry(): Promise<{
  enabled: boolean;
  loaded: number;
  seeded: SeedResult[];
}> {
  if (!contractRegistryPersistEnabled()) return { enabled: false, loaded: 0, seeded: [] };
  try {
    const loaded = await loadRegistryFromDb();
    const seeded = await seedCanonicalSchemas({ persist: true });
    const errors = seeded.filter((s) => s.action === "error");
    console.log(
      `[ContractRegistry] loaded ${loaded} persisted version(s); seed: ` +
        `${seeded.filter((s) => s.action === "registered").length} registered, ` +
        `${seeded.filter((s) => s.action === "unchanged").length} unchanged, ${errors.length} error(s)`,
    );
    for (const e of errors) console.error(`[ContractRegistry] seed error ${e.file}: ${e.error}`);
    return { enabled: true, loaded, seeded };
  } catch (err) {
    console.error("[ContractRegistry] init failed (registry stays memory-only):", err instanceof Error ? err.message : err);
    return { enabled: true, loaded: 0, seeded: [] };
  }
}

/**
 * Validation SEAM (doc 44 G2.5) — NOT yet enforced anywhere. A later batch wires this into
 * telemetryBus/mqttService ingest. Validates against the LATEST registered version for the
 * subject (in-memory — call loadRegistryFromDb/initContractRegistry first at boot). No schema
 * registered for the subject → `valid: true` (open until a contract exists; enforcement policy
 * is the caller's concern).
 */
export function validateMessage(subject: string, payload: unknown): { valid: boolean; errors?: string[] } {
  const latest = getLatestSchema(subject);
  if (!latest) return { valid: true };
  const errors = validateAgainstSchema(latest.schema, payload);
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
