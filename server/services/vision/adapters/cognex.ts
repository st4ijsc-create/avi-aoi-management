/**
 * Cognex In-Sight / VisionPro vision adapter — representative 2D job-result mapping.
 *
 * Cognex machine vision (In-Sight smart cameras + VisionPro/ViDi PC software) does NOT emit
 * one universal wire format: In-Sight exports spreadsheet cell values (Native Mode / FTP /
 * TCP), VisionPro returns a "job result" with per-tool outputs, and ViDi/Deep Learning tools
 * emit scores/labels. We CANNOT ship the proprietary In-Sight/VisionPro SDK, so below is a
 * REASONABLE REPRESENTATIVE "job result" shape modelled on the documented tool-result
 * vocabulary (a job with a Pass/Fail status and per-tool results carrying a score + optional
 * alignment X/Y/angle). Adjust the key names here to match a specific site's exported schema —
 * the canonical mapping stays the same.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST THE REAL SDK before production. The exact
 * field names/units come from your In-Sight spreadsheet layout or VisionPro job configuration.
 *
 * ASSUMED VENDOR SCHEMA:
 * {
 *   "job": "InSight_TopCam_A",          // → productModel (also "jobName"/"program")
 *   "id": "SN-778",                     // part/board id → serialNumber (also "partId"/"barcode"/"serial")
 *   "status": "Pass" | "Fail",          // overall (also boolean "pass"; 0/1 accepted); derived if absent
 *   "timestamp": "2026-07-02T...",      // optional ISO time (also "inspectedAt")
 *   "cycleTimeMs": 42,                  // optional; ms → seconds
 *   "results": [                         // per-tool / per-feature (also "tools")
 *     {
 *       "tool": "PatMax_1",             // tool/feature name → pointCode (also "toolName"/"name")
 *       "pass": true,                   // tool pass/fail → result (also "status"/"result"/0/1)
 *       "score": 95.2,                  // match/quality score → measuredValue (also "value")
 *       "offsetX": -3.1,                // optional alignment X (px/mm) → valueOffsetX
 *       "offsetY": 0.8,                 // optional alignment Y        → valueOffsetY
 *       "angle": 1.2,                   // optional alignment angle    → valueTilt
 *       "defect": "MISSING_COMPONENT",  // optional defect code        → defectCatalogCode
 *       "severity": "major",            // optional severity           → defectSeverity
 *       "image": "http://.../t1.jpg"    // optional tool image         → imageBase64 (url passthrough)
 *     }
 *   ]
 * }
 *
 * Cognex results are typically 2D (match score + alignment offsets); no solder-paste volume,
 * so the 3D canonical fields stay unset. `score` maps to BOTH measuredValue and is left as the
 * headline number; alignment offsets map to valueOffsetX/Y and angle → valueTilt.
 */
import {
  type VisionAdapter,
  type CanonicalInspection,
  type CanonicalMeasurement,
  type VisionNormalizeContext,
  toCanonicalResult,
  toCanonicalSeverity,
  numOrUndefined,
} from "../visionAdapterRegistry";

interface CognexTool {
  tool?: string;
  toolName?: string;
  name?: string;
  pass?: unknown;
  status?: unknown;
  result?: unknown;
  score?: number | string;
  value?: number | string;
  offsetX?: number | string;
  offsetY?: number | string;
  angle?: number | string;
  defect?: string;
  severity?: string;
  remark?: string;
  image?: string;
  imageBase64?: string;
}

interface CognexPayload {
  job?: string;
  jobName?: string;
  program?: string;
  productModel?: string;
  id?: string;
  partId?: string;
  barcode?: string;
  serial?: string;
  serialNumber?: string;
  machineCode?: string;
  machineId?: string;
  apiKey?: string;
  status?: unknown;
  pass?: unknown;
  overallResult?: unknown;
  timestamp?: string;
  inspectedAt?: string;
  inspectionTime?: string;
  cycleTimeMs?: number;
  cycleTime?: number;
  results?: CognexTool[];
  tools?: CognexTool[];
}

function asObject(raw: unknown): CognexPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("cognex: payload must be a JSON object");
  }
  return raw as CognexPayload;
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createCognexAdapter(): VisionAdapter {
  return {
    vendorKey: "cognex",
    label: "Cognex In-Sight / VisionPro (2D)",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const p = asObject(rawPayload);

      const serialNumber = (p.id ?? p.partId ?? p.barcode ?? p.serial ?? p.serialNumber ?? "")
        .toString()
        .trim();
      if (!serialNumber) {
        throw new Error("cognex: part id ('id'/'partId'/'barcode') is required");
      }

      const tools = p.results ?? p.tools ?? [];
      if (!Array.isArray(tools)) {
        throw new Error("cognex: 'results' must be an array");
      }

      const measurements: CanonicalMeasurement[] = tools.map((t, i) => {
        if (!t || typeof t !== "object") {
          throw new Error(`cognex: results[${i}] must be an object`);
        }
        const pointCode = (t.tool ?? t.toolName ?? t.name ?? "").toString().trim() || undefined;
        const judged = t.pass !== undefined ? t.pass : t.status !== undefined ? t.status : t.result;

        const m: CanonicalMeasurement = {
          pointCode,
          result: toCanonicalResult(judged),
          measuredValue: numOrUndefined(t.score ?? t.value),
          valueOffsetX: numOrUndefined(t.offsetX),
          valueOffsetY: numOrUndefined(t.offsetY),
          valueTilt: numOrUndefined(t.angle),
          remark: t.remark,
        };
        if (t.defect) m.defectCatalogCode = String(t.defect).trim();
        const sev = toCanonicalSeverity(t.severity);
        if (sev) m.defectSeverity = sev;
        const img = t.imageBase64 ?? t.image;
        if (img) m.imageBase64 = img;
        return m;
      });

      const overallRaw = p.overallResult ?? p.status ?? p.pass;
      const overallResult =
        overallRaw !== undefined ? toCanonicalResult(overallRaw) : deriveOverall(measurements);

      const cycleTime =
        typeof p.cycleTime === "number"
          ? p.cycleTime
          : typeof p.cycleTimeMs === "number"
            ? p.cycleTimeMs / 1000
            : undefined;

      return {
        machineCode: ctx?.machineCode ?? p.machineCode ?? p.machineId,
        apiKey: ctx?.apiKey ?? p.apiKey,
        serialNumber,
        productModel: p.job ?? p.jobName ?? p.program ?? p.productModel,
        cycleTime,
        overallResult,
        inspectionTime: p.timestamp ?? p.inspectedAt ?? p.inspectionTime,
        measurements,
      };
    },
  };
}
