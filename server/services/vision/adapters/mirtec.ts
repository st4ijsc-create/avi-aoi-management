/**
 * Mirtec AOI vision adapter — representative MV-series result-XML mapping.
 *
 * Mirtec MV-series machines (MV-3 / MV-6 / MV-9 OMNI families) publish per-board results
 * through the OMS / MIS interface, commonly as an XML (or delimited text) result file per
 * board with board info + a defect list. We CANNOT ship Mirtec's proprietary OMS SDK, so
 * below is a REASONABLE REPRESENTATIVE shape modelled on that documented vocabulary.
 *
 * ⚠ ASSUMED REPRESENTATIVE SHAPE — VALIDATE AGAINST A REAL RESULT FILE FROM THE FACTORY'S
 * MACHINE before production (doc 27 C2). All field mapping lives in MIRTEC_FIELD_MAP /
 * MIRTEC_DEFECT_MAP below — adjust element names / defect tokens THERE when the real sample
 * arrives, then drop the file into __fixtures__/mirtec/ so the conformance test locks it in.
 *
 * ASSUMED VENDOR SCHEMA (XML; also accepted as the equivalent parsed object):
 *   <MirtecResult>
 *     <BoardInfo>
 *       <Machine>MIRTEC-MV6</Machine> <Model>MB-X1</Model> <Barcode>SN-127</Barcode>
 *       <Lot>LOT-78</Lot> <StartTime>2026-07-04 08:34:00</StartTime>
 *       <EndTime>2026-07-04 08:34:09</EndTime> <Result>NG</Result>   (GOOD|PASS|NG|FAIL)
 *     </BoardInfo>
 *     <DefectList>
 *       <Defect>
 *         <Location>R12</Location> <PartName>RC0402-103</PartName>
 *         <DefectName>Tombstone</DefectName> <DefectCode>D021</DefectCode>
 *         <X>1120</X> <Y>2340</Y> <Width>64</Width> <Height>48</Height>
 *         <ImagePath>SN-127_R12.jpg</ImagePath> <Judge>NG</Judge>
 *       </Defect>
 *     </DefectList>
 *   </MirtecResult>
 *
 * NOTE (honest): Mirtec defect-list exports typically carry ONLY the flagged points — a
 * GOOD board yields an empty measurements array (board-level verdict only). That is
 * expected and handled downstream.
 *
 * MAPPING: Barcode → serialNumber; Model → productModel; Lot → batchNumber; Machine →
 * machineCode (ctx wins); EndTime + DEFAULT_UTC_OFFSET → inspectionTime (Mirtec exports
 * carry NO offset — doc 27 A2); (End−Start) → cycleTime; Location → pointCode; Judge →
 * result (defaults NG for a defect entry); DefectName → defectCatalogCode via
 * MIRTEC_DEFECT_MAP (IPC-A-610-aligned; vendor numeric DefectCode kept in rawExtras);
 * X/Y/Width/Height px → defectBboxX/Y/W/H; ImagePath → imageBase64 (reference passthrough).
 */
import {
  type VisionAdapter,
  type CanonicalInspection,
  type CanonicalMeasurement,
  type VisionNormalizeContext,
  toCanonicalResult,
  numOrUndefined,
} from "../visionAdapterRegistry";
import { parseXmlDoc, toTzAwareIso, tokenizeDefect } from "./_parsing";

/**
 * ── SINGLE ADJUSTMENT POINT #1: element aliases ─────────────────────────────────────────
 * canonical concept → accepted element names (first present wins, case-sensitive as
 * exported). Adjust here when the real OMS export arrives.
 */
export const MIRTEC_FIELD_MAP = {
  root: ["MirtecResult", "MIRTECResult", "InspectionResult"],
  boardInfo: ["BoardInfo", "Board"],
  defectList: ["DefectList", "Defects"],
  defectEntry: ["Defect", "DefectInfo"],
  machine: ["Machine", "MachineName", "EquipmentID"],
  model: ["Model", "ModelName", "JobName", "Program"],
  barcode: ["Barcode", "BoardBarcode", "Serial", "SerialNo"],
  lot: ["Lot", "LotName", "LotNo"],
  startTime: ["StartTime", "InspectStart"],
  endTime: ["EndTime", "InspectEnd", "InspectionTime"],
  boardResult: ["Result", "Judge", "FinalResult"],
  location: ["Location", "RefDes", "Designator", "CRD"],
  partName: ["PartName", "PartNo", "PartNumber"],
  defectName: ["DefectName", "NGName"],
  defectCode: ["DefectCode", "NGCode"],
  x: ["X", "PosX"],
  y: ["Y", "PosY"],
  w: ["Width", "SizeX"],
  h: ["Height", "SizeY"],
  image: ["ImagePath", "ImageFile", "Image"],
  judge: ["Judge", "Result"],
  /** Mirtec files carry local wall-clock time with NO offset → site default appended. */
  DEFAULT_UTC_OFFSET: "+07:00",
} as const;

/**
 * ── SINGLE ADJUSTMENT POINT #2: defect token → IPC-A-610 defect_catalog code ────────────
 * Matched on the tokenized DefectName. Unmapped tokens pass through tokenized; the original
 * name + vendor numeric code are preserved in rawExtras.
 */
export const MIRTEC_DEFECT_MAP: Record<string, string> = {
  BRIDGE: "BRIDGING",
  SOLDER_BRIDGE: "BRIDGING",
  SHORT: "BRIDGING",
  TOMBSTONE: "TOMBSTONING",
  BILLBOARD: "BILLBOARDING",
  MISSING: "MISSING_COMPONENT",
  NO_COMPONENT: "MISSING_COMPONENT",
  WRONG_PART: "WRONG_COMPONENT",
  WRONG_POLARITY: "REVERSE_POLARITY",
  REVERSE: "REVERSE_POLARITY",
  POLARITY: "REVERSE_POLARITY",
  SHIFT: "COMPONENT_MISALIGNMENT",
  MISALIGN: "COMPONENT_MISALIGNMENT",
  OFFSET: "COMPONENT_MISALIGNMENT",
  SKEW: "SKEW",
  UPSIDE_DOWN: "UPENDED",
  INSUFFICIENT_SOLDER: "INSUFFICIENT_SOLDER",
  INSUFFICIENT: "INSUFFICIENT_SOLDER",
  EXCESS_SOLDER: "EXCESS_SOLDER",
  SOLDER_BALL: "SOLDER_BALL",
  COLD_SOLDER: "COLD_JOINT",
  LIFTED_LEAD: "LIFTED_LEAD",
  BENT_LEAD: "BENT_LEAD",
  VOID: "VOID",
  DAMAGE: "DAMAGED_COMPONENT",
  DAMAGED: "DAMAGED_COMPONENT",
  CRACK: "CRACKED_PACKAGE",
  SCRATCH: "SCRATCH",
  FOREIGN_MATERIAL: "CONTAMINATION_PARTICLE",
  OCR: "OCR_FAIL",
  MARKING: "POOR_MARKING",
};

type Rec = Record<string, unknown>;

function pick(obj: Rec | undefined, aliases: readonly string[]): unknown {
  if (!obj) return undefined;
  for (const a of aliases) {
    if (obj[a] !== undefined && obj[a] !== "") return obj[a];
  }
  return undefined;
}

function pickStr(obj: Rec | undefined, aliases: readonly string[]): string | undefined {
  const v = pick(obj, aliases);
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function asDoc(raw: unknown): Rec {
  let tree: unknown = raw;
  if (typeof raw === "string") {
    if (/<!DOCTYPE/i.test(raw)) throw new Error("mirtec: XML documents with a DOCTYPE are rejected");
    tree = parseXmlDoc(raw, MIRTEC_FIELD_MAP.defectEntry);
  }
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
    throw new Error("mirtec: payload must be result XML text or the equivalent parsed object");
  }
  const o = tree as Rec;
  // Accept either the root wrapper or an already-unwrapped { BoardInfo, DefectList } object.
  const root = pick(o, MIRTEC_FIELD_MAP.root);
  if (root && typeof root === "object") return root as Rec;
  if (pick(o, MIRTEC_FIELD_MAP.boardInfo)) return o;
  throw new Error("mirtec: root element <MirtecResult> (or BoardInfo) not found");
}

function defectEntries(doc: Rec): Rec[] {
  const list = pick(doc, MIRTEC_FIELD_MAP.defectList);
  if (list === undefined || list === null || list === "") return [];
  if (Array.isArray(list)) return list as Rec[]; // pre-parsed object form: DefectList: [...]
  const entries = pick(list as Rec, MIRTEC_FIELD_MAP.defectEntry);
  if (entries === undefined || entries === "") return [];
  return Array.isArray(entries) ? (entries as Rec[]) : [entries as Rec];
}

export function createMirtecAdapter(): VisionAdapter {
  return {
    vendorKey: "mirtec",
    label: "Mirtec MV-series AOI (OMS result XML) — representative",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      const doc = asDoc(rawPayload);
      const board = pick(doc, MIRTEC_FIELD_MAP.boardInfo) as Rec | undefined;
      if (!board || typeof board !== "object") {
        throw new Error("mirtec: BoardInfo section is required");
      }

      const serialNumber = pickStr(board, MIRTEC_FIELD_MAP.barcode) ?? "";
      if (!serialNumber) {
        throw new Error("mirtec: board barcode is required (see MIRTEC_FIELD_MAP.barcode)");
      }

      const measurements: CanonicalMeasurement[] = defectEntries(doc).map((d, i) => {
        if (!d || typeof d !== "object") {
          throw new Error(`mirtec: DefectList entry ${i} must be an element/object`);
        }
        const m: CanonicalMeasurement = {
          pointCode: pickStr(d, MIRTEC_FIELD_MAP.location),
          // A defect entry without an explicit Judge is a flagged (NG) point.
          result: toCanonicalResult(pickStr(d, MIRTEC_FIELD_MAP.judge) ?? "NG"),
        };
        const defectName = pickStr(d, MIRTEC_FIELD_MAP.defectName);
        if (defectName) {
          const token = tokenizeDefect(defectName);
          m.defectCatalogCode = MIRTEC_DEFECT_MAP[token] ?? token;
        }
        const x = numOrUndefined(pickStr(d, MIRTEC_FIELD_MAP.x));
        const y = numOrUndefined(pickStr(d, MIRTEC_FIELD_MAP.y));
        const w = numOrUndefined(pickStr(d, MIRTEC_FIELD_MAP.w));
        const h = numOrUndefined(pickStr(d, MIRTEC_FIELD_MAP.h));
        if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
          m.defectBboxX = x;
          m.defectBboxY = y;
          m.defectBboxW = w;
          m.defectBboxH = h;
        }
        const image = pickStr(d, MIRTEC_FIELD_MAP.image);
        if (image) m.imageBase64 = image;

        const extras: Record<string, unknown> = {};
        const partName = pickStr(d, MIRTEC_FIELD_MAP.partName);
        const vendorCode = pickStr(d, MIRTEC_FIELD_MAP.defectCode);
        if (partName) extras.part_name = partName;
        if (vendorCode) extras.vendor_defect_code = vendorCode;
        if (defectName) extras.vendor_defect_name = defectName;
        if (Object.keys(extras).length > 0) m.rawExtras = extras;
        return m;
      });

      const offset = MIRTEC_FIELD_MAP.DEFAULT_UTC_OFFSET;
      const startIso = toTzAwareIso(pickStr(board, MIRTEC_FIELD_MAP.startTime), undefined, offset);
      const endIso = toTzAwareIso(pickStr(board, MIRTEC_FIELD_MAP.endTime), undefined, offset);
      let cycleTime: number | undefined;
      if (startIso && endIso) {
        const ms = Date.parse(endIso) - Date.parse(startIso);
        if (Number.isFinite(ms) && ms >= 0) cycleTime = ms / 1000;
      }

      const boardResultRaw = pickStr(board, MIRTEC_FIELD_MAP.boardResult);
      const overallResult = boardResultRaw
        ? toCanonicalResult(boardResultRaw)
        : measurements.some((m) => m.result === "NG")
          ? "NG"
          : "OK";

      return {
        machineCode: ctx?.machineCode ?? pickStr(board, MIRTEC_FIELD_MAP.machine),
        apiKey: ctx?.apiKey,
        serialNumber,
        productModel: pickStr(board, MIRTEC_FIELD_MAP.model),
        batchNumber: pickStr(board, MIRTEC_FIELD_MAP.lot),
        cycleTime,
        overallResult,
        inspectionTime: endIso,
        measurements,
        rawExtras: {
          vendor: "mirtec",
          ...(startIso ? { started_at: startIso } : {}),
        },
      };
    },
  };
}
