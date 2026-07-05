/**
 * I.C.T AOI vision adapter — representative AI-series CSV/JSON result mapping.
 *
 * I.C.T (Shenzhen I.C.T / Dongguan ICT) AI-series inline AOI machines (e.g. AI-5146,
 * AI-6146) export per-board results as CSV/XML files or a JSON push, with per-component
 * rows carrying designator, defect type and pixel location. We CANNOT ship the vendor
 * software, so below is a REASONABLE REPRESENTATIVE shape modelled on commonly seen
 * Chinese-AOI result exports.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST A REAL RESULT FILE FROM THE FACTORY'S
 * MACHINE before production (doc 27 C2). All field mapping lives in ICT_FIELD_MAP /
 * ICT_DEFECT_MAP below — adjust the aliases/tokens THERE when the real sample arrives,
 * then drop the file into __fixtures__/ict-aoi/ so the conformance test locks it in.
 * (If the machine can be reprogrammed, prefer pointing it at the ST4I Standard Inspection
 * Feed — doc 28 — which is the committed contract for custom machines.)
 *
 * ASSUMED VENDOR SCHEMA A (header-row CSV; one file = one board; row per component):
 *   Machine,SN,PCB_Code,Program,TestTime,Result,Designator,PartNo,DefectType,DefectCode,
 *   X,Y,W,H,ImagePath
 *   ICT-AI5146,SN-125,MB-X1,MB-X1-TOP-V2,2026-07-04 08:32:40,FAIL,R7,RC0402-102,Missing,
 *   E02,300,520,40,30,SN-125_R7.jpg
 *
 * ASSUMED VENDOR SCHEMA B (JSON push):
 *   { "machine": "ICT-AI5146", "sn": "SN-126", "pcb_code": "MB-X1",
 *     "program": "MB-X1-TOP-V2", "test_time": "2026-07-04 08:33:10", "result": "PASS",
 *     "components": [ { "designator": "R7", "part_no": "RC0402-102", "result": "OK",
 *                       "defect": "Missing", "defect_code": "E02", "x":1,"y":2,"w":3,"h":4,
 *                       "image": "SN-126_R7.jpg" } ] }
 *
 * INPUT accepted by normalize(): raw CSV text (string), array of CSV row objects,
 * { rows: [...] }, or the JSON push object (schema B).
 *
 * MAPPING: SN → serialNumber; Program → productModel; Machine → machineCode (ctx wins);
 * TestTime + DEFAULT_UTC_OFFSET → inspectionTime (offset-less local time — doc 27 A2);
 * Designator → pointCode; row/component Result → result (a row with a DefectType and no
 * explicit result is NG); DefectType → defectCatalogCode via ICT_DEFECT_MAP (IPC-aligned;
 * vendor code kept in rawExtras); X/Y/W/H px → defectBboxX/Y/W/H; ImagePath → imageBase64
 * (reference passthrough); PCB_Code/PartNo → rawExtras.
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
 * ── SINGLE ADJUSTMENT POINT #1: field aliases ───────────────────────────────────────────
 * canonical concept → accepted CSV column / JSON key names (case-insensitive, first match
 * wins). Adjust here when the real I.C.T export arrives.
 */
export const ICT_FIELD_MAP = {
  machine: ["Machine", "MachineName", "machine", "machine_code"],
  serial: ["SN", "Serial", "Barcode", "sn", "serial", "barcode"],
  pcbCode: ["PCB_Code", "PCBCode", "Board", "pcb_code"],
  program: ["Program", "ProgramName", "Job", "program"],
  testTime: ["TestTime", "Test_Time", "Time", "DateTime", "test_time"],
  boardResult: ["Result", "BoardResult", "FinalResult", "result"],
  designator: ["Designator", "RefDes", "Location", "Comp", "designator"],
  partNo: ["PartNo", "PartNumber", "part_no"],
  defect: ["DefectType", "Defect", "NGType", "defect", "defect_type"],
  defectCode: ["DefectCode", "NGCode", "defect_code"],
  pointResult: ["CompResult", "PointResult", "Judge", "result"],
  x: ["X", "x"],
  y: ["Y", "y"],
  w: ["W", "Width", "w"],
  h: ["H", "Height", "h"],
  image: ["ImagePath", "Image", "ImageFile", "image", "image_path"],
  /** JSON push component-array key aliases. */
  components: ["components", "Components", "comps", "defects"],
  /** I.C.T files carry local wall-clock time with NO offset → site default appended. */
  DEFAULT_UTC_OFFSET: "+07:00",
} as const;

/**
 * ── SINGLE ADJUSTMENT POINT #2: defect token → IPC-A-610 defect_catalog code ────────────
 * Matched on the tokenized DefectType (English tokens assumed; add the machine's actual
 * tokens — possibly Chinese — as keys when the real sample arrives). Unmapped tokens pass
 * through tokenized; original text kept in rawExtras.vendor_defect_name.
 */
export const ICT_DEFECT_MAP: Record<string, string> = {
  BRIDGE: "BRIDGING",
  BRIDGING: "BRIDGING",
  SHORT: "BRIDGING",
  MISSING: "MISSING_COMPONENT",
  LACK: "MISSING_COMPONENT",
  NO_PART: "MISSING_COMPONENT",
  WRONG: "WRONG_COMPONENT",
  WRONG_PART: "WRONG_COMPONENT",
  POLARITY: "REVERSE_POLARITY",
  REVERSE: "REVERSE_POLARITY",
  SHIFT: "COMPONENT_MISALIGNMENT",
  OFFSET: "COMPONENT_MISALIGNMENT",
  DEVIATION: "COMPONENT_MISALIGNMENT",
  SKEW: "SKEW",
  ROTATE: "SKEW",
  TOMBSTONE: "TOMBSTONING",
  STAND: "TOMBSTONING",
  SIDE_STAND: "BILLBOARDING",
  FLIP: "UPENDED",
  UPSIDE_DOWN: "UPENDED",
  LESS_TIN: "INSUFFICIENT_SOLDER",
  INSUFFICIENT: "INSUFFICIENT_SOLDER",
  MORE_TIN: "EXCESS_SOLDER",
  EXCESS: "EXCESS_SOLDER",
  TIN_BALL: "SOLDER_BALL",
  SOLDER_BALL: "SOLDER_BALL",
  COLD_SOLDER: "COLD_JOINT",
  EMPTY_SOLDER: "OPEN_CIRCUIT",
  LIFT_LEAD: "LIFTED_LEAD",
  LIFTED_LEAD: "LIFTED_LEAD",
  BENT_LEAD: "BENT_LEAD",
  DAMAGE: "DAMAGED_COMPONENT",
  BROKEN: "DAMAGED_COMPONENT",
  CRACK: "CRACKED_PACKAGE",
  SCRATCH: "SCRATCH",
  DIRTY: "CONTAMINATION_PARTICLE",
  FOREIGN: "CONTAMINATION_PARTICLE",
  OCR: "OCR_FAIL",
  CHAR_ERROR: "OCR_FAIL",
};

type Rec = Record<string, unknown>;

function pick(obj: Rec, aliases: readonly string[]): string | undefined {
  for (const a of aliases) {
    for (const key of Object.keys(obj)) {
      if (key.trim().toLowerCase() === a.toLowerCase()) {
        const v = obj[key];
        if (v === undefined || v === null) continue;
        const s = String(v).trim();
        if (s !== "") return s;
      }
    }
  }
  return undefined;
}

interface IctParsed {
  head: Rec;
  points: Rec[];
  /** true when points came from CSV rows (header info repeated per row). */
  fromRows: boolean;
}

function parsePayload(raw: unknown): IctParsed {
  if (typeof raw === "string") {
    const rows = csvRowsToObjects(parseCsv(raw)) as Rec[];
    if (rows.length === 0) throw new Error("ictAoi: CSV result file has no data rows");
    return { head: rows[0], points: rows, fromRows: true };
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new Error("ictAoi: row array is empty");
    return { head: raw[0] as Rec, points: raw as Rec[], fromRows: true };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Rec;
    if (Array.isArray(o.rows)) {
      const rows = o.rows as Rec[];
      if (rows.length === 0) throw new Error("ictAoi: rows array is empty");
      return { head: rows[0], points: rows, fromRows: true };
    }
    for (const key of ICT_FIELD_MAP.components) {
      const comps = o[key];
      if (Array.isArray(comps)) return { head: o, points: comps as Rec[], fromRows: false };
    }
    // JSON push with no component array → board-level-only result.
    return { head: o, points: [], fromRows: false };
  }
  throw new Error(
    "ictAoi: payload must be CSV text, an array of row objects, { rows: [...] }, or a JSON push object",
  );
}

function deriveOverall(measurements: CanonicalMeasurement[]): "OK" | "NG" | "NTF" {
  if (measurements.some((m) => m.result === "NG")) return "NG";
  if (measurements.some((m) => m.result === "NTF")) return "NTF";
  return "OK";
}

export function createIctAoiAdapter(): VisionAdapter {
  return {
    vendorKey: "ict-aoi",
    label: "I.C.T AI-series AOI (CSV/JSON result) — representative",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const { head, points, fromRows } = parsePayload(rawPayload);

      const serialNumber = pick(head, ICT_FIELD_MAP.serial) ?? "";
      if (!serialNumber) {
        throw new Error("ictAoi: board serial ('SN') is required (see ICT_FIELD_MAP.serial)");
      }

      const measurements: CanonicalMeasurement[] = points.map((row) => {
        const defectRaw = pick(row, ICT_FIELD_MAP.defect);
        // CSV rows reuse the "Result" column name for the BOARD verdict, so for row input
        // a per-point verdict comes from an explicit point-result column or the defect
        // presence; JSON components may carry their own "result".
        const explicit = fromRows
          ? pick(row, ICT_FIELD_MAP.pointResult.filter((a) => a.toLowerCase() !== "result"))
          : pick(row, ICT_FIELD_MAP.pointResult);
        const m: CanonicalMeasurement = {
          pointCode: pick(row, ICT_FIELD_MAP.designator),
          result: explicit ? toCanonicalResult(explicit) : defectRaw ? "NG" : "OK",
        };
        if (defectRaw) {
          const token = tokenizeDefect(defectRaw);
          m.defectCatalogCode = ICT_DEFECT_MAP[token] ?? token;
        }
        const x = numOrUndefined(pick(row, ICT_FIELD_MAP.x));
        const y = numOrUndefined(pick(row, ICT_FIELD_MAP.y));
        const w = numOrUndefined(pick(row, ICT_FIELD_MAP.w));
        const h = numOrUndefined(pick(row, ICT_FIELD_MAP.h));
        if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
          m.defectBboxX = x;
          m.defectBboxY = y;
          m.defectBboxW = w;
          m.defectBboxH = h;
        }
        const image = pick(row, ICT_FIELD_MAP.image);
        if (image) m.imageBase64 = image;

        const extras: Record<string, unknown> = {};
        const partNo = pick(row, ICT_FIELD_MAP.partNo);
        const vendorCode = pick(row, ICT_FIELD_MAP.defectCode);
        if (partNo) extras.part_no = partNo;
        if (vendorCode) extras.vendor_defect_code = vendorCode;
        if (defectRaw) extras.vendor_defect_name = defectRaw;
        if (Object.keys(extras).length > 0) m.rawExtras = extras;
        return m;
      });

      const boardResultRaw = pick(head, ICT_FIELD_MAP.boardResult);
      const overallResult = boardResultRaw
        ? toCanonicalResult(boardResultRaw)
        : deriveOverall(measurements);

      const inspectionTime = toTzAwareIso(
        pick(head, ICT_FIELD_MAP.testTime),
        undefined,
        ICT_FIELD_MAP.DEFAULT_UTC_OFFSET,
      );

      const pcbCode = pick(head, ICT_FIELD_MAP.pcbCode);
      return {
        machineCode: ctx?.machineCode ?? pick(head, ICT_FIELD_MAP.machine),
        apiKey: ctx?.apiKey,
        serialNumber,
        productModel: pick(head, ICT_FIELD_MAP.program) ?? pcbCode,
        overallResult,
        inspectionTime,
        measurements,
        rawExtras: {
          vendor: "ict",
          ...(pcbCode ? { pcb_code: pcbCode } : {}),
        },
      };
    },
  };
}
