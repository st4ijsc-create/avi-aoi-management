/**
 * Vendor-agnostic VISION / INSPECTION ADAPTER registry.
 *
 * Mirrors the OT driver registry (server/services/ot/driverRegistry.ts): a
 * Map<vendorKey → factory> populated at module load (see ./index.ts side-effect).
 * Each adapter parses a vendor-specific raw payload and `normalize()`s it into the
 * CANONICAL inspection shape (== machineApiRouter.submitInspection input), so any
 * third-party inspection system (Cognex, Keyence, Koh Young, TRI, Omron, generic …)
 * can feed the platform WITHOUT the proprietary ZIP format.
 *
 * Fail-safe + typed: `getVisionAdapter` throws a clear Error for an unknown vendor;
 * `normalize` implementations validate/throw on bad payloads (never crash silently).
 * `_clearRegistry` is test-only.
 */

/** Canonical OK / NG / NTF result used across the platform. */
export type CanonicalResult = "OK" | "NG" | "NTF";

/** Defect severity vocabulary accepted by submitInspection. */
export type CanonicalDefectSeverity = "critical" | "major" | "minor" | "cosmetic";

/**
 * One measurement point in the canonical shape. Field names + types MATCH the
 * `measurements[]` element of machineApiRouter.submitInspection so the normalized
 * payload can be handed to the existing persistence path unchanged.
 *
 * 3D / solder / x-ray values (valueZ … valueThickness) are OPTIONAL — adapters only
 * populate the ones the vendor reports. Defect mapping uses defectCatalogCode +
 * defectSeverity (the platform resolves the code → defect_catalog.id on ingest).
 */
export interface CanonicalMeasurement {
  pointCode?: string;
  pointId?: string;
  measuredValue?: number | string;
  result: CanonicalResult;
  remark?: string;
  imageBase64?: string;
  // ── extended 3D / SPI / x-ray values (all optional) ──
  valueZ?: number | string;
  valueHeight?: number | string;
  valueArea?: number | string;
  valueVolume?: number | string;
  valueVoidPct?: number | string;
  valueCoplanarity?: number | string;
  valueWarpage?: number | string;
  valueOffsetX?: number | string;
  valueOffsetY?: number | string;
  valueTilt?: number | string;
  valueThickness?: number | string;
  // ── defect mapping ──
  defectCatalogCode?: string;
  defectSeverity?: CanonicalDefectSeverity;
}

/**
 * Canonical inspection — the exact input contract of submitInspection (machine
 * identity + product + result + measurements[]). Adapters MUST normalize INTO this.
 */
export interface CanonicalInspection {
  machineCode?: string;
  apiKey?: string;
  serialNumber: string;
  productModel?: string;
  batchNumber?: string;
  cycleTime?: number;
  overallResult: CanonicalResult;
  inspectionTime?: string;
  companyCode?: string;
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stageCode?: string;
  productionOrderCode?: string;
  operatorId?: string;
  measurements: CanonicalMeasurement[];
}

/**
 * Context passed to `normalize` — lets the caller inject the machine identity when
 * the raw vendor payload does not carry it (e.g. machineCode supplied by the router
 * from a QR/NFC scan or an explicit argument). Adapters should prefer ctx.machineCode
 * over any value embedded in the payload when ctx provides one.
 */
export interface VisionNormalizeContext {
  /** Machine code to stamp onto the canonical inspection (overrides payload). */
  machineCode?: string;
  /** Optional API key alternative to machineCode. */
  apiKey?: string;
}

/**
 * A vision adapter: turns ONE vendor-specific raw payload into ONE canonical
 * inspection. Implementations must be pure + fail-safe (throw a typed Error on a
 * malformed payload; never return a half-built object).
 */
export interface VisionAdapter {
  /** Stable vendor key (e.g. "generic-json", "koh-young"). */
  readonly vendorKey: string;
  /** Human-readable label for UI / listing. */
  readonly label: string;
  /** Parse + map a raw vendor payload into the canonical inspection shape. */
  normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection;
}

/** Factory producing a fresh adapter instance (mirrors OtDriverFactory). */
export type VisionAdapterFactory = () => VisionAdapter;

const registry = new Map<string, VisionAdapterFactory>();

/** Register a factory for a vendor key (overwrites if already present). */
export function registerVisionAdapter(vendorKey: string, factory: VisionAdapterFactory): void {
  registry.set(vendorKey, factory);
}

/** Resolve + instantiate an adapter. Throws a clear Error if the vendor is unknown. */
export function getVisionAdapter(vendorKey: string): VisionAdapter {
  const factory = registry.get(vendorKey);
  if (!factory) {
    throw new Error(`No vision adapter registered for vendor "${vendorKey}"`);
  }
  return factory();
}

/** List registered adapters (vendorKey + label) for UI / discovery. */
export function listVisionAdapters(): Array<{ vendorKey: string; label: string }> {
  return [...registry.entries()].map(([vendorKey, factory]) => {
    let label = vendorKey;
    try {
      label = factory().label;
    } catch {
      /* a broken factory must not break listing */
    }
    return { vendorKey, label };
  });
}

/** Clear the registry — test-only (mirrors OT `_clearRegistry`). */
export function _clearRegistry(): void {
  registry.clear();
}

// ── small shared helpers for adapters (kept here so every adapter maps consistently) ──

/** Coerce a vendor judged/result token into the canonical OK | NG | NTF. */
export function toCanonicalResult(raw: unknown): CanonicalResult {
  if (typeof raw === "boolean") return raw ? "OK" : "NG";
  if (typeof raw === "number") return raw === 0 ? "OK" : "NG"; // 0 = pass (common SPI convention)
  const s = String(raw ?? "").trim().toUpperCase();
  if (["OK", "PASS", "GOOD", "ACCEPT", "ACCEPTED", "TRUE", "1"].includes(s)) return "OK";
  if (["NTF", "RETEST", "REVIEW", "UNKNOWN"].includes(s)) return "NTF";
  // Anything else (NG, FAIL, REJECT, DEFECT, FALSE, 0-as-string-here …) → NG
  return "NG";
}

/** Map a vendor severity token onto the canonical severity vocabulary, or undefined. */
export function toCanonicalSeverity(raw: unknown): CanonicalDefectSeverity | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (["critical", "crit", "fatal", "high"].includes(s)) return "critical";
  if (["major", "med", "medium"].includes(s)) return "major";
  if (["minor", "low"].includes(s)) return "minor";
  if (["cosmetic", "info", "trivial"].includes(s)) return "cosmetic";
  return undefined;
}

/** Number passthrough that drops null/undefined/NaN (keeps optional fields clean). */
export function numOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
