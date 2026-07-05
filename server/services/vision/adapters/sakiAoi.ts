/**
 * Saki AOI vision adapter — representative CSV result-file mapping (BF-series 2D/3D AOI).
 *
 * Saki self-programming AOI machines (BF-3Di / BF-3SE / 3Si families) typically export a
 * per-board CSV result file (one row per inspected component / defect) via the machine's
 * result-output / MIS interface. We CANNOT ship Saki's proprietary software, so below is a
 * REASONABLE REPRESENTATIVE column set modelled on commonly documented Saki result exports.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST A REAL RESULT FILE FROM THE FACTORY'S
 * MACHINE before production (doc 27 C2). All field mapping lives in SAKI_FIELD_MAP /
 * SAKI_DEFECT_MAP below — when the real sample file arrives, adjust the column aliases /
 * defect tokens THERE; nothing else changes. Then drop the real file into
 * __fixtures__/saki-aoi/ so the golden-file conformance test locks it in.
 *
 * ASSUMED VENDOR SCHEMA (header-row CSV; one file = one board; row per component):
 *   Date,Time,MachineName,JobName,BoardSerial,BoardResult,Lot,CircuitNo,PartsName,PartsNo,
 *   WindowNo,Algorithm,Judge,DefectName,X,Y,Width,Height,ImageFile
 *   2026/07/04,08:31:05,SAKI-BF3,MB-X1-TOP,SN-124,NG,LOT-77,1,R12,RC0402-103,12,Solder,NG,
 *   Insufficient,1120,2340,64,48,SN-124_R12.jpg
 *
 * INPUT accepted by normalize(): raw CSV text (string), an array of row objects (hot-folder
 * may parse CSV → objects itself), or { rows: [...] }.
 *
 * MAPPING: BoardSerial → serialNumber; JobName → productModel; Lot → batchNumber;
 * MachineName → machineCode (ctx wins); Date+Time + DEFAULT_UTC_OFFSET → inspectionTime
 * (Saki exports carry NO offset — doc 27 A2: never emit offset-less timestamps);
 * PartsName → pointCode; Judge → result; DefectName → defectCatalogCode via SAKI_DEFECT_MAP
 * (IPC-A-610-aligned); X/Y/Width/Height (px) → defectBboxX/Y/W/H; ImageFile → imageBase64
 * (reference passthrough); PartsNo/WindowNo/Algorithm/CircuitNo → rawExtras.
 */
import {
  type VisionAdapter,
  type CanonicalInspection,
  type CanonicalMeasurement,
  type VisionNormalizeContext,
  toCanonicalResult,
  numOrUndefined,
} from "../visionAdapterRegistry";
import { parseCsv, csvRowsToObjects, toTzAwareIso, tokenizeDefect } from "./_parsing";

/**
 * ── SINGLE ADJUSTMENT POINT #1: column aliases ──────────────────────────────────────────
 * canonical concept → list of column names accepted (first match wins, case-insensitive).
 * When the real Saki export arrives, add/replace aliases here.
 */
export const SAKI_FIELD_MAP = {
  date: ["Date", "InspectionDate"],
  time: ["Time", "InspectionTime"],
  machine: ["MachineName", "Machine", "M/C"],
  job: ["JobName", "Job", "Program", "ProgramName", "Model"],
  serial: ["BoardSerial", "Board S/N", "Barcode", "Serial", "SerialNo", "PCB S/N"],
  boardResult: ["BoardResult", "Board Result", "TotalJudge", "FinalResult"],
  lot: ["Lot", "LotNo", "LotName"],
  circuit: ["CircuitNo", "Circuit", "BlockNo"],
  designator: ["PartsName", "Parts", "Designator", "RefDes", "Location"],
  partNumber: ["PartsNo", "PartNo", "PartNumber"],
  window: ["WindowNo", "Window"],
  algorithm: ["Algorithm", "Algo", "InspectionItem"],
  judge: ["Judge", "Judgement", "Result"],
  defect: ["DefectName", "NG Name", "NGName", "Defect"],
  x: ["X", "PosX", "X(pix)"],
  y: ["Y", "PosY", "Y(pix)"],
  w: ["Width", "W", "SizeX"],
  h: ["Height", "H", "SizeY"],
  image: ["ImageFile", "Image", "ImagePath"],
  /** Saki files carry local wall-clock time with NO offset → site default appended. */
  DEFAULT_UTC_OFFSET: "+07:00",
} as const;

/**
 * ── SINGLE ADJUSTMENT POINT #2: defect token → IPC-A-610 defect_catalog code ────────────
 * Keys are matched case-insensitively on the tokenized defect name ("Solder Bridge" →
 * SOLDER_BRIDGE). Unmapped tokens pass through tokenized (soft catalog reference) and the
 * original text is kept in rawExtras.vendor_defect_name.
 */
export const SAKI_DEFECT_MAP: Record<string, string> = {
  BRIDGE: "BRIDGING",
  SOLDER_BRIDGE: "BRIDGING",
  SHORT: "BRIDGING",
  INSUFFICIENT: "INSUFFICIENT_SOLDER",
  INSUFFICIENT_SOLDER: "INSUFFICIENT_SOLDER",
  LESS_SOLDER: "INSUFFICIENT_SOLDER",
  EXCESS: "EXCESS_SOLDER",
  EXCESS_SOLDER: "EXCESS_SOLDER",
  MISSING: "MISSING_COMPONENT",
  NO_PART: "MISSING_COMPONENT",
  ABSENT: "MISSING_COMPONENT",
  WRONG_PART: "WRONG_COMPONENT",
  WRONG_COMPONENT: "WRONG_COMPONENT",
  REVERSE: "REVERSE_POLARITY",
  POLARITY: "REVERSE_POLARITY",
  SHIFT: "COMPONENT_MISALIGNMENT",
  MISALIGN: "COMPONENT_MISALIGNMENT",
  MISALIGNMENT: "COMPONENT_MISALIGNMENT",
  POSITION: "COMPONENT_MISALIGNMENT",
  SKEW: "SKEW",
  ROTATION: "SKEW",
  TOMBSTONE: "TOMBSTONING",
  MANHATTAN: "TOMBSTONING",
  BILLBOARD: "BILLBOARDING",
  UPSIDE_DOWN: "UPENDED",
  LIFTED_LEAD: "LIFTED_LEAD",
  LEAD_LIFT: "LIFTED_LEAD",
  BENT_LEAD: "BENT_LEAD",
  COLD_SOLDER: "COLD_JOINT",
  COLD_JOINT: "COLD_JOINT",
  SOLDER_BALL: "SOLDER_BALL",
  VOID: "VOID",
  DAMAGE: "DAMAGED_COMPONENT",
  DAMAGED: "DAMAGED_COMPONENT",
  SCRATCH: "SCRATCH",
  FOREIGN_MATERIAL: "CONTAMINATION_PARTICLE",
  DUST: "CONTAMINATION_PARTICLE",
  OCR: "OCR_FAIL",
  OCV: "OCR_FAIL",
};

type SakiRow = Record<string, string>;

function pick(row: SakiRow, aliases: readonly string[]): string | undefined {
  for (const a of aliases) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === a.toLowerCase()) {
        const v = row[key]?.toString().trim();
        if (v) return v;
      }
    }
  }
  return undefined;
}

function asRows(raw: unknown): SakiRow[] {
  if (typeof raw === "string") return csvRowsToObjects(parseCsv(raw)) as SakiRow[];
  if (Array.isArray(raw)) return raw as SakiRow[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows)) {
    return (raw as { rows: SakiRow[] }).rows;
  }
  throw new Error("sakiAoi: payload must be CSV text, an array of row objects, or { rows: [...] }");
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createSakiAoiAdapter(): VisionAdapter {
  return {
    vendorKey: "saki-aoi",
    label: "Saki AOI (BF-series, CSV result file) — representative",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const rows = asRows(rawPayload);
      if (rows.length === 0) throw new Error("sakiAoi: result file has no data rows");
      const first = rows[0];

      const serialNumber = pick(first, SAKI_FIELD_MAP.serial) ?? "";
      if (!serialNumber) {
        throw new Error("sakiAoi: board serial column is required (see SAKI_FIELD_MAP.serial)");
      }

      const measurements: CanonicalMeasurement[] = rows.map((row) => {
        const designator = pick(row, SAKI_FIELD_MAP.designator);
        const m: CanonicalMeasurement = {
          pointCode: designator,
          result: toCanonicalResult(pick(row, SAKI_FIELD_MAP.judge) ?? "OK"),
        };
        const defectRaw = pick(row, SAKI_FIELD_MAP.defect);
        if (defectRaw) {
          const token = tokenizeDefect(defectRaw);
          m.defectCatalogCode = SAKI_DEFECT_MAP[token] ?? token;
        }
        const x = numOrUndefined(pick(row, SAKI_FIELD_MAP.x));
        const y = numOrUndefined(pick(row, SAKI_FIELD_MAP.y));
        const w = numOrUndefined(pick(row, SAKI_FIELD_MAP.w));
        const h = numOrUndefined(pick(row, SAKI_FIELD_MAP.h));
        if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
          m.defectBboxX = x;
          m.defectBboxY = y;
          m.defectBboxW = w;
          m.defectBboxH = h;
        }
        const image = pick(row, SAKI_FIELD_MAP.image);
        if (image) m.imageBase64 = image;

        const algorithm = pick(row, SAKI_FIELD_MAP.algorithm);
        if (algorithm) m.remark = `algo:${algorithm}`;

        const extras: Record<string, unknown> = {};
        const partNumber = pick(row, SAKI_FIELD_MAP.partNumber);
        const windowNo = pick(row, SAKI_FIELD_MAP.window);
        const circuit = pick(row, SAKI_FIELD_MAP.circuit);
        if (partNumber) extras.part_number = partNumber;
        if (windowNo) extras.window_no = windowNo;
        if (circuit) extras.circuit_no = circuit;
        if (defectRaw) extras.vendor_defect_name = defectRaw;
        if (Object.keys(extras).length > 0) m.rawExtras = extras;
        return m;
      });

      const boardResultRaw = pick(first, SAKI_FIELD_MAP.boardResult);
      const overallResult = boardResultRaw
        ? toCanonicalResult(boardResultRaw)
        : deriveOverall(measurements);

      const inspectionTime = toTzAwareIso(
        pick(first, SAKI_FIELD_MAP.date),
        pick(first, SAKI_FIELD_MAP.time),
        SAKI_FIELD_MAP.DEFAULT_UTC_OFFSET,
      );

      const circuit = pick(first, SAKI_FIELD_MAP.circuit);
      return {
        machineCode: ctx?.machineCode ?? pick(first, SAKI_FIELD_MAP.machine),
        apiKey: ctx?.apiKey,
        serialNumber,
        productModel: pick(first, SAKI_FIELD_MAP.job),
        batchNumber: pick(first, SAKI_FIELD_MAP.lot),
        overallResult,
        inspectionTime,
        measurements,
        rawExtras: {
          vendor: "saki",
          ...(circuit ? { circuit_no: circuit } : {}),
        },
      };
    },
  };
}
