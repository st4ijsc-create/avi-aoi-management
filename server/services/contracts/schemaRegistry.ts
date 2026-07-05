/**
 * Schema registry + BACKWARD-compat gate — SYNAPSE §5.6.4 / §9.1 (doc 33 §3.5 / F7 · H5).
 *
 * "Đổi schema UNS gây vỡ hàng loạt" is a top risk. This registry versions named JSON-Schemas
 * (REST payloads + Sparkplug/UNS payloads) and provides a BACKWARD-compatibility gate: a new
 * version is only accepted if it does NOT break existing consumers (additive-only). CI runs the
 * gate so a breaking change is caught before merge (a topic must bump to …/v2 instead).
 *
 * Pure + fail-safe. A JSON-Schema here is a plain object ({type, properties, required, ...}).
 */

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
