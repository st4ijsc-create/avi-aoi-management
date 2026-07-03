/**
 * TRI (Test Research, Inc.) AOI / SPI vision adapter — representative 3D result mapping.
 *
 * TRI's electronics-inspection line (TR7700 SII 3D SPI, TR7500 SIII 3D AOI, TR7007 AXI) inspects
 * per-pad / per-component "inspection windows" and, for 3D SPI, reports solder-paste volume /
 * height / area (% of nominal and absolute), plus X/Y offset and bridging. Results are exported
 * via TRI's TRcustomer/SPC/database interface in a site-configured layout; we CANNOT ship the
 * proprietary TRI SDK, so below is a REASONABLE REPRESENTATIVE shape modelled on that documented
 * 3D-window vocabulary. Adjust the key names to your exported schema — the canonical mapping is
 * unchanged.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST THE REAL SDK / TRI export before production.
 * Exact field names + units (%, µm, µm³) come from your TRI recipe's result-output configuration.
 *
 * ASSUMED VENDOR SCHEMA:
 * {
 *   "boardId": "BRD-55",                // panel/board serial → serialNumber (also "panelId"/"boardBarcode"/"serial")
 *   "program": "TRI_SPI_Top",           // recipe → productModel (also "recipe"/"programName")
 *   "lotId": "L-3",                     // → batchNumber (also "lot")
 *   "verdict": "PASS" | "FAIL",         // overall (also "judgement"; 0=PASS accepted); derived if absent
 *   "inspectedAt": "2026-07-02T...",    // optional ISO time
 *   "machineType": "SPI" | "AOI" | "AXI",// optional; informational (kept in remark)
 *   "windows": [                         // per-pad/component inspection windows (also "pads"/"results")
 *     {
 *       "windowId": "C10.1",            // → pointCode (also "padId"/"ref")
 *       "judgement": "PASS" | "FAIL",   // window pass/fail → result (also "result"; 0=PASS)
 *       "volumePercent": 88.0,          // solder volume vs nominal (%) → measuredValue + valueVolume
 *       "heightMicron": 95.0,           // paste height (µm)            → valueHeight
 *       "areaPercent": 92.0,            // area vs nominal (%)          → valueArea
 *       "offsetX": -2.0,                // X offset (µm/px)             → valueOffsetX
 *       "offsetY": 1.5,                 // Y offset (µm/px)             → valueOffsetY
 *       "coplanarityMicron": 3.0,       // optional coplanarity (µm)    → valueCoplanarity
 *       "voidPercent": 2.4,             // optional void (%)            → valueVoidPct
 *       "bridge": false,                // optional bridging flag (kept in remark)
 *       "defect": "INSUFFICIENT",       // optional defect code         → defectCatalogCode
 *       "defectClass": "major",         // optional severity            → defectSeverity
 *       "image": "http://.../c10.jpg"   // optional window image        → imageBase64 (url passthrough)
 *     }
 *   ]
 * }
 *
 * 3D MAPPING (the point of this adapter, like Koh Young): volumePercent → measuredValue AND
 * valueVolume; heightMicron → valueHeight; areaPercent → valueArea; offsets → valueOffsetX/Y;
 * coplanarity/void → their canonical columns. A `bridge:true` flag + machineType are folded into
 * the point remark for traceability.
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

interface TriWindow {
  windowId?: string;
  padId?: string;
  ref?: string;
  judgement?: unknown;
  result?: unknown;
  volumePercent?: number | string;
  volumeMicronCube?: number | string;
  heightMicron?: number | string;
  areaPercent?: number | string;
  offsetX?: number | string;
  offsetY?: number | string;
  coplanarityMicron?: number | string;
  voidPercent?: number | string;
  bridge?: unknown;
  defect?: string;
  defectClass?: string;
  remark?: string;
  image?: string;
  imageBase64?: string;
}

interface TriPayload {
  boardId?: string;
  panelId?: string;
  boardBarcode?: string;
  serial?: string;
  serialNumber?: string;
  program?: string;
  recipe?: string;
  programName?: string;
  productModel?: string;
  lotId?: string;
  lot?: string;
  batchNumber?: string;
  machineCode?: string;
  machineId?: string;
  apiKey?: string;
  verdict?: unknown;
  judgement?: unknown;
  overallResult?: unknown;
  inspectedAt?: string;
  inspectionTime?: string;
  cycleTime?: number;
  machineType?: string;
  windows?: TriWindow[];
  pads?: TriWindow[];
  results?: TriWindow[];
}

function asObject(raw: unknown): TriPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tri: payload must be a JSON object");
  }
  return raw as TriPayload;
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createTriAdapter(): VisionAdapter {
  return {
    vendorKey: "tri",
    label: "TRI AOI/SPI (3D)",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const p = asObject(rawPayload);

      const serialNumber = (p.boardId ?? p.panelId ?? p.boardBarcode ?? p.serial ?? p.serialNumber ?? "")
        .toString()
        .trim();
      if (!serialNumber) {
        throw new Error("tri: board id ('boardId'/'panelId'/'boardBarcode') is required");
      }

      const windows = p.windows ?? p.pads ?? p.results ?? [];
      if (!Array.isArray(windows)) {
        throw new Error("tri: 'windows' must be an array");
      }
      const machineType = p.machineType ? String(p.machineType).trim() : undefined;

      const measurements: CanonicalMeasurement[] = windows.map((w, i) => {
        if (!w || typeof w !== "object") {
          throw new Error(`tri: windows[${i}] must be an object`);
        }
        const pointCode = (w.windowId ?? w.padId ?? w.ref ?? "").toString().trim() || undefined;
        const judged = w.judgement !== undefined ? w.judgement : w.result;

        const remarkParts: string[] = [];
        if (w.remark) remarkParts.push(String(w.remark));
        if (machineType) remarkParts.push(`type:${machineType}`);
        if (w.bridge === true || String(w.bridge).toLowerCase() === "true") remarkParts.push("bridge");

        const m: CanonicalMeasurement = {
          pointCode,
          result: toCanonicalResult(judged),
          // Headline SPI metric = solder volume vs nominal (%).
          measuredValue: numOrUndefined(w.volumePercent),
          // ── 3D solder-paste fields ──
          valueVolume: numOrUndefined(w.volumePercent),
          valueHeight: numOrUndefined(w.heightMicron),
          valueArea: numOrUndefined(w.areaPercent),
          valueCoplanarity: numOrUndefined(w.coplanarityMicron),
          valueOffsetX: numOrUndefined(w.offsetX),
          valueOffsetY: numOrUndefined(w.offsetY),
          valueVoidPct: numOrUndefined(w.voidPercent),
          remark: remarkParts.length ? remarkParts.join("; ") : undefined,
        };
        if (w.defect) m.defectCatalogCode = String(w.defect).trim();
        const sev = toCanonicalSeverity(w.defectClass);
        if (sev) m.defectSeverity = sev;
        const img = w.imageBase64 ?? w.image;
        if (img) m.imageBase64 = img;
        return m;
      });

      const overallRaw = p.overallResult ?? p.verdict ?? p.judgement;
      const overallResult =
        overallRaw !== undefined ? toCanonicalResult(overallRaw) : deriveOverall(measurements);

      return {
        machineCode: ctx?.machineCode ?? p.machineCode ?? p.machineId,
        apiKey: ctx?.apiKey ?? p.apiKey,
        serialNumber,
        productModel: p.program ?? p.recipe ?? p.programName ?? p.productModel,
        batchNumber: p.lotId ?? p.lot ?? p.batchNumber,
        cycleTime: typeof p.cycleTime === "number" ? p.cycleTime : undefined,
        overallResult,
        inspectionTime: p.inspectedAt ?? p.inspectionTime,
        measurements,
      };
    },
  };
}
