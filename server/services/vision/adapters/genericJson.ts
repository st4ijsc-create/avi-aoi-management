/**
 * Generic JSON vision adapter — the simplest onboarding path.
 *
 * VENDOR SCHEMA (the contract a third party emits; no proprietary SDK required):
 * {
 *   "machineCode": "AOI-01",            // optional if router supplies ctx.machineCode
 *   "serial": "SN12345",               // required (also accepts "serialNumber")
 *   "product": "BoardX",               // optional product model code
 *   "batch": "B-2026-06",              // optional
 *   "result": "OK" | "NG" | "NTF",     // optional overall; derived from points if absent
 *   "time": "2026-06-28T10:00:00Z",    // optional ISO inspection time
 *   "cycleTime": 12.5,                 // optional seconds
 *   "results": [
 *     {
 *       "point": "MP001",              // point code (also accepts "pointCode")
 *       "value": 0.42,                 // measured value (number or string)
 *       "judged": "OK" | true | 0,     // pass/fail token (see toCanonicalResult)
 *       "image": "data:image/png;...", // optional base64 / data-URL / http url
 *       "defect": "SOLDER_BRIDGE",     // optional defect catalog code
 *       "severity": "major"            // optional severity
 *     }
 *   ]
 * }
 *
 * Mapping: result→overallResult/result, value→measuredValue, image→imageBase64,
 * defect→defectCatalogCode, severity→defectSeverity. Overall result, when omitted,
 * is derived (any NG → NG; else any NTF → NTF; else OK).
 */
import {
  type VisionAdapter,
  type CanonicalInspection,
  type CanonicalMeasurement,
  type VisionNormalizeContext,
  toCanonicalResult,
  toCanonicalSeverity,
} from "../visionAdapterRegistry";

interface GenericPoint {
  point?: string;
  pointCode?: string;
  value?: number | string;
  judged?: unknown;
  result?: unknown;
  image?: string;
  defect?: string;
  severity?: string;
  remark?: string;
}

interface GenericPayload {
  machineCode?: string;
  apiKey?: string;
  serial?: string;
  serialNumber?: string;
  product?: string;
  productModel?: string;
  batch?: string;
  batchNumber?: string;
  result?: unknown;
  overallResult?: unknown;
  time?: string;
  inspectionTime?: string;
  cycleTime?: number;
  results?: GenericPoint[];
  measurements?: GenericPoint[];
}

function asObject(raw: unknown): GenericPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("genericJson: payload must be a JSON object");
  }
  return raw as GenericPayload;
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createGenericJsonAdapter(): VisionAdapter {
  return {
    vendorKey: "generic-json",
    label: "Generic JSON",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const p = asObject(rawPayload);

      const serialNumber = (p.serial ?? p.serialNumber ?? "").toString().trim();
      if (!serialNumber) {
        throw new Error("genericJson: 'serial' (serial number) is required");
      }

      const rawPoints = p.results ?? p.measurements ?? [];
      if (!Array.isArray(rawPoints)) {
        throw new Error("genericJson: 'results' must be an array");
      }

      const measurements: CanonicalMeasurement[] = rawPoints.map((pt, i) => {
        if (!pt || typeof pt !== "object") {
          throw new Error(`genericJson: results[${i}] must be an object`);
        }
        const pointCode = (pt.point ?? pt.pointCode ?? "").toString().trim() || undefined;
        const judged = pt.judged !== undefined ? pt.judged : pt.result;
        const m: CanonicalMeasurement = {
          pointCode,
          measuredValue: pt.value,
          result: toCanonicalResult(judged),
          remark: pt.remark,
        };
        if (pt.image) m.imageBase64 = pt.image;
        if (pt.defect) m.defectCatalogCode = String(pt.defect).trim();
        const sev = toCanonicalSeverity(pt.severity);
        if (sev) m.defectSeverity = sev;
        return m;
      });

      const overallRaw = p.overallResult ?? p.result;
      const overallResult =
        overallRaw !== undefined ? toCanonicalResult(overallRaw) : deriveOverall(measurements);

      return {
        machineCode: ctx?.machineCode ?? p.machineCode,
        apiKey: ctx?.apiKey ?? p.apiKey,
        serialNumber,
        productModel: p.product ?? p.productModel,
        batchNumber: p.batch ?? p.batchNumber,
        cycleTime: typeof p.cycleTime === "number" ? p.cycleTime : undefined,
        overallResult,
        inspectionTime: p.time ?? p.inspectionTime,
        measurements,
      };
    },
  };
}
