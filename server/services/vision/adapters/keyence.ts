/**
 * Keyence CV-X / XG-X vision adapter — representative 2D checker-result mapping.
 *
 * Keyence image systems (CV-X series controllers, XG-X programmable vision) run a "program"
 * made of tools/checkers (area, edge, blob, position, OCR, appearance) and emit an overall
 * OK/NG "total judgement" plus a per-tool judgement + measured value. The controller exports
 * this over PLC-link / Ethernet / FTP in a site-configured layout; we CANNOT ship the
 * proprietary Keyence SDK, so below is a REASONABLE REPRESENTATIVE shape modelled on that
 * documented tool/judgement vocabulary. Adjust the key names to your controller's output map —
 * the canonical mapping is unchanged.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST THE REAL SDK / controller output map
 * before production. Keyence's exact field names + numbering come from your program's
 * result-output configuration.
 *
 * ASSUMED VENDOR SCHEMA:
 * {
 *   "program": "CVX_Prog_3",            // → productModel (also "programName"/"programNo")
 *   "workId": "WK-100",                 // workpiece id → serialNumber (also "workpieceId"/"serial"/"barcode")
 *   "totalJudge": "OK" | "NG",          // overall (also "judge"/"judgement"; 0=OK convention accepted); derived if absent
 *   "time": "2026-07-02T...",           // optional ISO time (also "inspectedAt")
 *   "tools": [                           // per-tool / per-checker (also "checkers"/"results")
 *     {
 *       "toolNo": 12,                   // tool number → pointCode "T12" (also "no")
 *       "toolName": "Area_Top",         // → pointCode when present (preferred over toolNo)
 *       "judge": "OK" | "NG",           // tool judgement → result (also "result"; 0=OK)
 *       "measured": 1024.5,             // measured value → measuredValue (also "value"/"measuredValue")
 *       "lower": 900,                   // optional spec lower (kept in remark)
 *       "upper": 1100,                  // optional spec upper (kept in remark)
 *       "defectName": "SCRATCH",        // optional defect code → defectCatalogCode (also "defect")
 *       "level": "minor",              // optional severity → defectSeverity (also "severity")
 *       "image": "http://.../t12.jpg"   // optional tool image → imageBase64 (url passthrough)
 *     }
 *   ]
 * }
 *
 * Keyence tool outputs are 2D (a measured value + judgement); the 3D canonical fields stay
 * unset. `measured` → measuredValue; toolName (else "T"+toolNo) → pointCode. When lower/upper
 * spec limits are present they are folded into the point remark for traceability.
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

interface KeyenceTool {
  toolNo?: number | string;
  no?: number | string;
  toolName?: string;
  judge?: unknown;
  result?: unknown;
  measured?: number | string;
  value?: number | string;
  measuredValue?: number | string;
  lower?: number | string;
  upper?: number | string;
  defectName?: string;
  defect?: string;
  level?: string;
  severity?: string;
  remark?: string;
  image?: string;
  imageBase64?: string;
}

interface KeyencePayload {
  program?: string;
  programName?: string;
  programNo?: string | number;
  productModel?: string;
  workId?: string;
  workpieceId?: string;
  serial?: string;
  serialNumber?: string;
  barcode?: string;
  machineCode?: string;
  machineId?: string;
  apiKey?: string;
  totalJudge?: unknown;
  judge?: unknown;
  judgement?: unknown;
  overallResult?: unknown;
  time?: string;
  inspectedAt?: string;
  inspectionTime?: string;
  cycleTime?: number;
  tools?: KeyenceTool[];
  checkers?: KeyenceTool[];
  results?: KeyenceTool[];
}

function asObject(raw: unknown): KeyencePayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("keyence: payload must be a JSON object");
  }
  return raw as KeyencePayload;
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createKeyenceAdapter(): VisionAdapter {
  return {
    vendorKey: "keyence",
    label: "Keyence CV-X / XG-X (2D)",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const p = asObject(rawPayload);

      const serialNumber = (p.workId ?? p.workpieceId ?? p.serial ?? p.serialNumber ?? p.barcode ?? "")
        .toString()
        .trim();
      if (!serialNumber) {
        throw new Error("keyence: workpiece id ('workId'/'workpieceId'/'serial') is required");
      }

      const tools = p.tools ?? p.checkers ?? p.results ?? [];
      if (!Array.isArray(tools)) {
        throw new Error("keyence: 'tools' must be an array");
      }

      const measurements: CanonicalMeasurement[] = tools.map((t, i) => {
        if (!t || typeof t !== "object") {
          throw new Error(`keyence: tools[${i}] must be an object`);
        }
        const toolNo = t.toolNo ?? t.no;
        const pointCode =
          (t.toolName ?? "").toString().trim() ||
          (toNoLabel(toolNo)) ||
          undefined;
        const judged = t.judge !== undefined ? t.judge : t.result;

        let remark = t.remark;
        const lo = numOrUndefined(t.lower);
        const hi = numOrUndefined(t.upper);
        if (lo !== undefined || hi !== undefined) {
          const spec = `spec[${lo ?? "-"}..${hi ?? "-"}]`;
          remark = remark ? `${remark}; ${spec}` : spec;
        }

        const m: CanonicalMeasurement = {
          pointCode,
          result: toCanonicalResult(judged),
          measuredValue: numOrUndefined(t.measured ?? t.value ?? t.measuredValue),
          remark,
        };
        const defect = t.defectName ?? t.defect;
        if (defect) m.defectCatalogCode = String(defect).trim();
        const sev = toCanonicalSeverity(t.level ?? t.severity);
        if (sev) m.defectSeverity = sev;
        const img = t.imageBase64 ?? t.image;
        if (img) m.imageBase64 = img;
        return m;
      });

      const overallRaw = p.overallResult ?? p.totalJudge ?? p.judge ?? p.judgement;
      const overallResult =
        overallRaw !== undefined ? toCanonicalResult(overallRaw) : deriveOverall(measurements);

      return {
        machineCode: ctx?.machineCode ?? p.machineCode ?? p.machineId,
        apiKey: ctx?.apiKey ?? p.apiKey,
        serialNumber,
        productModel: p.program ?? p.programName ?? (p.programNo != null ? String(p.programNo) : undefined) ?? p.productModel,
        cycleTime: typeof p.cycleTime === "number" ? p.cycleTime : undefined,
        overallResult,
        inspectionTime: p.time ?? p.inspectedAt ?? p.inspectionTime,
        measurements,
      };
    },
  };
}

/** "T"+number label for a Keyence tool number (e.g. 12 → "T12"), or undefined. */
function toNoLabel(no: number | string | undefined): string | undefined {
  if (no === undefined || no === null || no === "") return undefined;
  return `T${String(no).trim()}`;
}
