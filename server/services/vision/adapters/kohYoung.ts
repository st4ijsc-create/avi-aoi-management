/**
 * Koh Young SPI / AOI vision adapter — demonstrates 3D (solder-paste) field mapping.
 *
 * Koh Young 3D SPI machines (Zenith / aSPIre families) export per-pad solder-paste
 * measurements: volume, height, area, plus offset & shape/coplanarity. We CANNOT ship
 * the proprietary KSMART SDK, so below is a REASONABLE REPRESENTATIVE shape modelled on
 * the documented SPI measurement vocabulary. Adjust field names here if a specific site
 * exports slightly different keys — the canonical mapping stays the same.
 *
 * ASSUMED VENDOR SCHEMA:
 * {
 *   "machineId": "KY-SPI-3",            // optional; ctx.machineCode wins if provided
 *   "barcode": "PNL-0099",             // panel/board serial (also accepts "panelId"/"serial")
 *   "recipe": "BoardX-Top",            // → productModel
 *   "lot": "LOT-77",                   // → batchNumber
 *   "judgement": "PASS" | "FAIL",      // overall (0/1 also accepted); derived if absent
 *   "inspectedAt": "2026-06-28T...",   // optional ISO time
 *   "pads": [
 *     {
 *       "padId": "R12.1",              // → pointCode
 *       "result": "PASS" | "FAIL" | 0, // pad pass/fail
 *       // 3D solder-paste metrics (units as exported by the machine):
 *       "volumePct": 98.4,             // volume vs nominal (%) → measuredValue + valueVolume
 *       "heightUm": 112.0,             // paste height (µm)     → valueHeight
 *       "areaPct": 101.2,              // area vs nominal (%)    → valueArea
 *       "coplanarityUm": 4.5,          // coplanarity (µm)       → valueCoplanarity
 *       "offsetXUm": -3.2,             // X offset (µm)          → valueOffsetX
 *       "offsetYUm": 1.1,              // Y offset (µm)          → valueOffsetY
 *       "warpageUm": 2.0,              // optional               → valueWarpage
 *       "tiltDeg": 0.4,                // optional               → valueTilt
 *       "voidPct": 1.5,                // optional void %        → valueVoidPct
 *       "defectCode": "INSUFFICIENT",  // optional defect catalog code → defectCatalogCode
 *       "defectLevel": "major",        // optional severity      → defectSeverity
 *       "imageUrl": "http://.../R12.jpg" // optional pad image  → imageBase64 (url passthrough)
 *     }
 *   ]
 * }
 *
 * 3D MAPPING (the point of this adapter): volumePct → measuredValue AND valueVolume
 * (so dashboards that read measuredValue and 3D-aware views both work); heightUm →
 * valueHeight; areaPct → valueArea; coplanarityUm → valueCoplanarity; offsets → valueOffsetX/Y;
 * warpage/tilt/void → their canonical columns. Defect code + level map to the defect fields.
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

interface KyPad {
  padId?: string;
  point?: string;
  result?: unknown;
  volumePct?: number | string;
  heightUm?: number | string;
  areaPct?: number | string;
  coplanarityUm?: number | string;
  offsetXUm?: number | string;
  offsetYUm?: number | string;
  warpageUm?: number | string;
  tiltDeg?: number | string;
  voidPct?: number | string;
  defectCode?: string;
  defectLevel?: string;
  imageUrl?: string;
  imageBase64?: string;
}

interface KyPayload {
  machineId?: string;
  machineCode?: string;
  apiKey?: string;
  barcode?: string;
  panelId?: string;
  serial?: string;
  recipe?: string;
  productModel?: string;
  lot?: string;
  batchNumber?: string;
  judgement?: unknown;
  overallResult?: unknown;
  inspectedAt?: string;
  inspectionTime?: string;
  cycleTime?: number;
  pads?: KyPad[];
}

function asObject(raw: unknown): KyPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("kohYoung: payload must be a JSON object");
  }
  return raw as KyPayload;
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createKohYoungAdapter(): VisionAdapter {
  return {
    vendorKey: "koh-young",
    label: "Koh Young SPI/AOI (3D)",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const p = asObject(rawPayload);

      const serialNumber = (p.barcode ?? p.panelId ?? p.serial ?? "").toString().trim();
      if (!serialNumber) {
        throw new Error("kohYoung: 'barcode' (panel serial) is required");
      }

      const pads = p.pads ?? [];
      if (!Array.isArray(pads)) {
        throw new Error("kohYoung: 'pads' must be an array");
      }

      const measurements: CanonicalMeasurement[] = pads.map((pad, i) => {
        if (!pad || typeof pad !== "object") {
          throw new Error(`kohYoung: pads[${i}] must be an object`);
        }
        const pointCode = (pad.padId ?? pad.point ?? "").toString().trim() || undefined;

        const m: CanonicalMeasurement = {
          pointCode,
          result: toCanonicalResult(pad.result),
          // Primary headline metric for SPI = solder volume vs nominal (%).
          measuredValue: numOrUndefined(pad.volumePct),
          // ── 3D solder-paste fields ──
          valueVolume: numOrUndefined(pad.volumePct),
          valueHeight: numOrUndefined(pad.heightUm),
          valueArea: numOrUndefined(pad.areaPct),
          valueCoplanarity: numOrUndefined(pad.coplanarityUm),
          valueOffsetX: numOrUndefined(pad.offsetXUm),
          valueOffsetY: numOrUndefined(pad.offsetYUm),
          valueWarpage: numOrUndefined(pad.warpageUm),
          valueTilt: numOrUndefined(pad.tiltDeg),
          valueVoidPct: numOrUndefined(pad.voidPct),
        };
        if (pad.defectCode) m.defectCatalogCode = String(pad.defectCode).trim();
        const sev = toCanonicalSeverity(pad.defectLevel);
        if (sev) m.defectSeverity = sev;
        const img = pad.imageBase64 ?? pad.imageUrl;
        if (img) m.imageBase64 = img;
        return m;
      });

      const overallRaw = p.overallResult ?? p.judgement;
      const overallResult =
        overallRaw !== undefined ? toCanonicalResult(overallRaw) : deriveOverall(measurements);

      return {
        machineCode: ctx?.machineCode ?? p.machineCode ?? p.machineId,
        apiKey: ctx?.apiKey ?? p.apiKey,
        serialNumber,
        productModel: p.recipe ?? p.productModel,
        batchNumber: p.lot ?? p.batchNumber,
        cycleTime: typeof p.cycleTime === "number" ? p.cycleTime : undefined,
        overallResult,
        inspectionTime: p.inspectedAt ?? p.inspectionTime,
        measurements,
      };
    },
  };
}
