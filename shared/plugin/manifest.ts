/**
 * Plugin manifest contract — SYNAPSE ADR-008 §6.4 (doc 33 §3.2 / F2 · Plugin Manifest & SDK v1).
 *
 * The condition for being a "platform" (not project-integration software): new devices /
 * vendors / skills are added as PLUGINS declared by a manifest, never by editing the core.
 * The core knows only the CONTRACT here; a plugin's manifest is the single source of truth
 * the Hub uses to decide whether to LOAD or REJECT it.
 *
 * F2 scope (in-process, non-breaking): the manifest + a SemVer `apiVersion` compatibility
 * gate + a JSON-Schema config surface (auto-generated setup form). Out-of-process isolation
 * (gRPC sidecar), signing enforcement, and the marketplace are later phases (F3+).
 *
 * Pure module (no I/O). The Hub's registry lives in server/services/plugins/pluginRegistry.ts.
 */

/** The Plugin API version the core currently implements (major.minor). A manifest declares
 *  the range it is compatible with; the Hub refuses to load anything outside that range. */
export const PLUGIN_API_VERSION = "1.0";

/** The six extension points (SYNAPSE §6.4.2). */
export type PluginKind =
  | "device-connector" // new device/protocol (OPC UA, Modbus, SECS/GEM, vendor driver)
  | "robot-adapter" // new robot/fleet vendor (VDA 5050-like)
  | "skill" // new task skill for the Task Compiler
  | "enterprise-connector" // new MES/ERP/WMS behind an anti-corruption layer
  | "ai-model" // new predictive/optimization model
  | "ui-widget"; // vendor-specific screen/widget (R3+)

/** Minimal-privilege ACL: which UNS topic branches a plugin may publish/subscribe. */
export interface PluginPermissions {
  publish?: readonly string[];
  subscribe?: readonly string[];
}

export interface PluginManifest {
  /** Globally-unique plugin id, e.g. "vendor-acme-screwdriver". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Plugin's own version (SemVer, e.g. "1.4.2"). */
  version: string;
  /** Range of Plugin API versions this plugin is compatible with (e.g. "^1.0", ">=1.0 <2.0",
   *  "1.x", or exact "1.0"). The Hub REJECTS a manifest whose range excludes PLUGIN_API_VERSION. */
  apiVersion: string;
  /** Which extension point this plugin implements. */
  kind: PluginKind;
  /** Protocols/dialects the plugin speaks (informational; for device/robot connectors). */
  protocols?: readonly string[];
  /** JSON-Schema (draft) describing the plugin's config → the Setup Wizard auto-generates a
   *  form from this. Produce it from a Zod schema via configForm.ts `zodToConfigForm`. */
  configSchema?: Record<string, unknown>;
  /** Minimal-privilege topic ACL. */
  permissions?: PluginPermissions;
  /** Whether the plugin artifact carries a signature (enforced in production in a later phase). */
  signaturePresent?: boolean;
  /** One-line description. */
  description?: string;
}

/** Parsed major.minor. */
interface Ver {
  major: number;
  minor: number;
}

/** Parse "1", "1.0", "1.4.2" → {major, minor} (patch ignored for API-version purposes). */
export function parseVersion(v: string): Ver | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}

/** Is `v` a valid SemVer-ish version string (major[.minor[.patch]])? */
export function isVersion(v: string): boolean {
  return parseVersion(v) !== null;
}

function gte(a: Ver, b: Ver): boolean {
  return a.major > b.major || (a.major === b.major && a.minor >= b.minor);
}
function lt(a: Ver, b: Ver): boolean {
  return a.major < b.major || (a.major === b.major && a.minor < b.minor);
}

/**
 * Does the current Plugin API version satisfy a manifest's `apiVersion` range?
 * Supported forms:
 *   exact     "1.0"                → current == 1.0
 *   caret     "^1.0"               → >=1.0 and <2.0 (same major)
 *   wildcard  "1.x" | "1.*"        → same major, any minor
 *   range     ">=1.0 <2.0"         → each space-separated comparator holds (>= <= > < =)
 * Unparseable range → false (fail-closed: the Hub refuses rather than "runs blind").
 */
export function satisfiesApiVersion(range: string, current: string = PLUGIN_API_VERSION): boolean {
  const cur = parseVersion(current);
  if (!cur) return false;
  const r = range.trim();

  // wildcard "1.x" / "1.*"
  const wild = /^(\d+)\.(x|\*)$/i.exec(r);
  if (wild) return cur.major === Number(wild[1]);

  // caret "^1.0"
  if (r.startsWith("^")) {
    const base = parseVersion(r.slice(1));
    if (!base) return false;
    return cur.major === base.major && gte(cur, base);
  }

  // range with comparators ">=1.0 <2.0" (all must hold)
  if (/[<>=]/.test(r)) {
    const parts = r.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const cmp = /^(>=|<=|>|<|=)(\d+(?:\.\d+)?(?:\.\d+)?)$/.exec(p);
      if (!cmp) return false;
      const target = parseVersion(cmp[2]);
      if (!target) return false;
      const op = cmp[1];
      const ok =
        op === ">="
          ? gte(cur, target)
          : op === "<="
            ? gte(target, cur)
            : op === ">"
              ? gte(cur, target) && !(cur.major === target.major && cur.minor === target.minor)
              : op === "<"
                ? lt(cur, target)
                : /* "=" */ cur.major === target.major && cur.minor === target.minor;
      if (!ok) return false;
    }
    return true;
  }

  // exact "1.0"
  const exact = parseVersion(r);
  if (!exact) return false;
  return cur.major === exact.major && cur.minor === exact.minor;
}

const KINDS: readonly PluginKind[] = [
  "device-connector",
  "robot-adapter",
  "skill",
  "enterprise-connector",
  "ai-model",
  "ui-widget",
];

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a manifest against the contract + the current Plugin API. Pure, never throws.
 * `requireSignature` (production) additionally requires `signaturePresent`.
 */
export function validateManifest(
  m: Partial<PluginManifest> | null | undefined,
  opts: { current?: string; requireSignature?: boolean } = {},
): ManifestValidation {
  const errors: string[] = [];
  const current = opts.current ?? PLUGIN_API_VERSION;
  if (!m || typeof m !== "object") return { ok: false, errors: ["manifest is not an object"] };

  if (!m.id || !ID_RE.test(m.id)) errors.push("id missing or not kebab-case");
  if (!m.name) errors.push("name missing");
  if (!m.version || !isVersion(m.version)) errors.push("version missing or not SemVer");
  if (!m.kind || !KINDS.includes(m.kind)) errors.push("kind missing or invalid");
  if (!m.apiVersion) {
    errors.push("apiVersion range missing");
  } else if (!satisfiesApiVersion(m.apiVersion, current)) {
    errors.push(
      `apiVersion "${m.apiVersion}" incompatible with Plugin API ${current} (Hub refuses to load)`,
    );
  }
  if (m.configSchema !== undefined && (typeof m.configSchema !== "object" || m.configSchema === null)) {
    errors.push("configSchema must be a JSON-Schema object");
  }
  if (m.permissions) {
    for (const dir of ["publish", "subscribe"] as const) {
      const arr = m.permissions[dir];
      if (arr !== undefined && (!Array.isArray(arr) || arr.some((t) => typeof t !== "string"))) {
        errors.push(`permissions.${dir} must be a string[]`);
      }
    }
  }
  if (opts.requireSignature && !m.signaturePresent) {
    errors.push("signature required in production but manifest is unsigned");
  }
  return { ok: errors.length === 0, errors };
}
