/**
 * ST4I Standard Inspection Feed adapter — the NORMATIVE reference implementation of
 * docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md (spec_version 1).
 *
 * Unlike the vendor adapters in this directory (representative shapes pending real sample
 * files), THIS adapter is not a placeholder: the spec is published by us, custom machine
 * vendors (doc 27 §11 decision #3) build to it, and this implementation defines conformance.
 * The golden fixtures in __fixtures__/st4i-standard/ are the compliance suite.
 *
 * INPUT (rawPayload):
 *   • object  — a parsed spec document (JSON shape). The hot-folder service may parse
 *               file → object itself and hand the object here.
 *   • string  — raw file text of ANY of the three encodings; sniffed by first significant
 *               character / magic line: "{" → JSON, "<" → XML, "#ST4I-INSPECTION" → CSV.
 *
 * VALIDATION (spec §8, strict — the whole document is rejected on any violation):
 *   • spec_version must be 1 (unsupported versions rejected with a clear error, never guessed);
 *   • required header fields; serial_number/machine_code/program_name non-empty;
 *   • timestamps RFC 3339 WITH mandatory UTC offset (doc 27 A2 lesson) and finished ≥ started;
 *   • result tokens exactly OK|NG|NTF; header result OK ⇒ no NG measurement;
 *   • numbers finite; bbox integers with w,h ≥ 1; severity/type vocabularies;
 *   • unknown fields NEVER fail validation (additive-only versioning) — they are preserved
 *     losslessly into rawExtras.
 *
 * MAPPING (spec §9): lossless into CanonicalInspection — natively-mapped fields go to their
 * canonical columns (incl. defectBboxX/Y/W/H + values_3d → value*, and — since doc 29 /
 * migration 0192 (W8-B) — header panel_id/board_index → canonical panelId/boardIndex,
 * persisted by submitInspection). Everything else (unit/lsl/usl/nominal/type,
 * program_version, attachments, extra, unknown fields) is carried in rawExtras (panel
 * fields are ALSO copied there for losslessness) and summarized into remark where useful.
 */
import { z } from "zod";
import {
  type VisionAdapter,
  type CanonicalInspection,
  type CanonicalMeasurement,
  type CanonicalResult,
  type VisionNormalizeContext,
} from "../visionAdapterRegistry";
import { RFC3339_TZ_RE, parseCsv, parseXmlDoc } from "./_parsing";

export const ST4I_SPEC_VERSION = 1;
const CSV_MAGIC = "#ST4I-INSPECTION";

// ── spec field vocabulary (used to split known fields from additive extras) ──────────────
const TOP_KEYS = ["spec_version", "header", "measurements", "attachments"] as const;
const HEADER_KEYS = [
  "machine_code", "serial_number", "program_name", "program_version", "lot_code",
  "panel_id", "board_index", "operator_id", "started_at", "finished_at",
  "cycle_time_sec", "result",
] as const;
const MEASUREMENT_KEYS = [
  "point_name", "type", "value", "unit", "lsl", "usl", "nominal", "result",
  "defect_code", "severity", "bbox_px", "image_ref", "values_3d", "remark", "extra",
] as const;
/** Fixed CSV `M,` row column order (spec §4.2) — 27 data columns after the record tag. */
export const CSV_MEASUREMENT_COLUMNS = [
  "point_name", "type", "value", "unit", "lsl", "usl", "nominal", "result",
  "defect_code", "severity", "bbox_x", "bbox_y", "bbox_w", "bbox_h", "image_ref", "remark",
  "height_um", "area_pct", "volume_pct", "void_pct", "coplanarity_um", "warpage_um",
  "offset_x_um", "offset_y_um", "tilt_deg", "thickness_um", "z_um",
] as const;
const VALUES_3D_KEYS = [
  "height_um", "area_pct", "volume_pct", "void_pct", "coplanarity_um", "warpage_um",
  "offset_x_um", "offset_y_um", "tilt_deg", "thickness_um", "z_um",
] as const;

// ── zod schema (spec §8) ──────────────────────────────────────────────────────────────────
// CSV/XML deliver every scalar as a string → numeric fields coerce explicitly; a
// non-numeric string still fails with a type error (strict, no silent drop).
const coercedNumber = (base: z.ZodNumber) =>
  z.preprocess((v) => {
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, base);

const finiteNum = coercedNumber(z.number().finite());
const nonNegInt = coercedNumber(z.number().int().min(0));
const posInt = coercedNumber(z.number().int().min(1));

const resultEnum = z.enum(["OK", "NG", "NTF"]);
const severityEnum = z.enum(["critical", "major", "minor", "cosmetic"]);
const tzTimestamp = z
  .string()
  .regex(RFC3339_TZ_RE, "must be RFC 3339 with an explicit UTC offset (e.g. 2026-07-04T08:30:00+07:00)");
const nonEmpty = (max: number) =>
  z.string().max(max).transform((s) => s.trim()).refine((s) => s.length > 0, "must be non-empty");

const bboxSchema = z.object({
  x: nonNegInt,
  y: nonNegInt,
  w: posInt,
  h: posInt,
});

const values3dSchema = z.object(
  Object.fromEntries(VALUES_3D_KEYS.map((k) => [k, finiteNum.optional()])) as Record<
    (typeof VALUES_3D_KEYS)[number],
    z.ZodOptional<typeof finiteNum>
  >,
);

const headerSchema = z.object({
  machine_code: nonEmpty(50),
  serial_number: nonEmpty(100),
  program_name: nonEmpty(100),
  program_version: z.string().max(50).optional(),
  lot_code: z.string().max(50).optional(),
  panel_id: z.string().max(100).optional(),
  board_index: posInt.optional(),
  operator_id: z.string().max(50).optional(),
  started_at: tzTimestamp,
  finished_at: tzTimestamp,
  cycle_time_sec: coercedNumber(z.number().finite().min(0)).optional(),
  result: resultEnum,
});

const measurementSchema = z.object({
  point_name: nonEmpty(100),
  type: z.string().regex(/^[a-z][a-z0-9_]*$/, "type must be a lowercase token").optional(),
  value: finiteNum.optional(),
  unit: z.string().max(20).optional(),
  lsl: finiteNum.optional(),
  usl: finiteNum.optional(),
  nominal: finiteNum.optional(),
  result: resultEnum,
  defect_code: z.string().max(50).optional(),
  severity: severityEnum.optional(),
  bbox_px: bboxSchema.optional(),
  image_ref: z.string().max(255).optional(),
  values_3d: values3dSchema.optional(),
  remark: z.string().max(500).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const attachmentsSchema = z.object({
  image_dir: z.string().optional(),
  images: z.array(z.string()).optional(),
});

const documentSchema = z
  .object({
    header: headerSchema,
    measurements: z.array(measurementSchema),
    attachments: attachmentsSchema.optional(),
  })
  .superRefine((doc, ctx) => {
    const started = Date.parse(doc.header.started_at);
    const finished = Date.parse(doc.header.finished_at);
    if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) {
      ctx.addIssue({
        code: "custom",
        path: ["header", "finished_at"],
        message: "finished_at must be >= started_at",
      });
    }
    if (doc.header.result === "OK" && doc.measurements.some((m) => m.result === "NG")) {
      ctx.addIssue({
        code: "custom",
        path: ["header", "result"],
        message: "header result OK contradicts an NG measurement (spec §8 rule 5)",
      });
    }
  });

// ── helpers ───────────────────────────────────────────────────────────────────────────────
function fail(message: string): never {
  throw new Error(`st4iStandard: ${message}`);
}

/** Split an object into { known, extras } by a list of known key names. */
function splitExtras(
  obj: Record<string, unknown>,
  knownKeys: readonly string[],
): { known: Record<string, unknown>; extras: Record<string, unknown> } {
  const known: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if ((knownKeys as readonly string[]).includes(k)) known[k] = v;
    else extras[k] = v;
  }
  return { known, extras };
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${what} must be an object`);
  return v as Record<string, unknown>;
}

/** Recursively drop empty-string values (XML `<x/>` / blank-cell artifacts). */
function dropEmptyStrings(value: unknown): unknown {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (Array.isArray(value)) return value.map(dropEmptyStrings);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const dv = dropEmptyStrings(v);
      if (dv !== undefined) out[k] = dv;
    }
    return out;
  }
  return value;
}

// ── encoding decoders → JSON-shaped spec document ─────────────────────────────────────────
function decodeCsv(text: string): Record<string, unknown> {
  const rows = parseCsv(text);
  if (rows.length === 0) fail("CSV document is empty");
  const [magic, version] = rows[0];
  if ((magic ?? "").trim() !== CSV_MAGIC) {
    fail(`CSV line 1 must be "${CSV_MAGIC},<spec_version>" (got "${rows[0].join(",")}")`);
  }
  const header: Record<string, unknown> = {};
  const measurements: Array<Record<string, unknown>> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const tag = (row[0] ?? "").trim();
    if (tag === "H") {
      if (row.length < 3) fail(`CSV row ${r + 1}: H rows are "H,<field>,<value>"`);
      const key = row[1].trim();
      const value = row.slice(2).join(",").trim(); // tolerate unquoted commas in the value
      if (key && value !== "") header[key] = value;
    } else if (tag === "M") {
      const cells = row.slice(1);
      if (cells.length > CSV_MEASUREMENT_COLUMNS.length) {
        fail(`CSV row ${r + 1}: M row has ${cells.length} data columns (max ${CSV_MEASUREMENT_COLUMNS.length})`);
      }
      const flat: Record<string, string> = {};
      cells.forEach((cell, idx) => {
        const v = cell.trim();
        if (v !== "") flat[CSV_MEASUREMENT_COLUMNS[idx]] = v;
      });
      const m: Record<string, unknown> = {};
      for (const k of MEASUREMENT_KEYS) {
        if (k in flat) m[k] = flat[k];
      }
      const bbox: Record<string, string> = {};
      if (flat.bbox_x !== undefined) bbox.x = flat.bbox_x;
      if (flat.bbox_y !== undefined) bbox.y = flat.bbox_y;
      if (flat.bbox_w !== undefined) bbox.w = flat.bbox_w;
      if (flat.bbox_h !== undefined) bbox.h = flat.bbox_h;
      if (Object.keys(bbox).length > 0) m.bbox_px = bbox;
      const v3d: Record<string, string> = {};
      for (const k of VALUES_3D_KEYS) {
        if (flat[k] !== undefined) v3d[k] = flat[k];
      }
      if (Object.keys(v3d).length > 0) m.values_3d = v3d;
      measurements.push(m);
    } else {
      fail(`CSV row ${r + 1}: unknown record tag "${tag}" (expected H or M)`);
    }
  }
  return { spec_version: (version ?? "").trim(), header, measurements };
}

function decodeXml(text: string): Record<string, unknown> {
  if (/<!DOCTYPE/i.test(text)) fail("XML documents with a DOCTYPE are rejected (spec §8 rule 11)");
  let tree: unknown;
  try {
    tree = parseXmlDoc(text, ["measurement"]);
  } catch (e) {
    fail(`XML parse error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const root = (tree as Record<string, unknown> | null)?.["st4i_inspection"];
  if (!root || typeof root !== "object") fail("XML root element must be <st4i_inspection>");
  const doc = { ...(root as Record<string, unknown>) };
  // <measurements><measurement/>…</measurements> → measurements array; <measurements/> → [].
  const wrap = doc.measurements;
  if (wrap === undefined || wrap === "") {
    doc.measurements = [];
  } else if (wrap && typeof wrap === "object" && !Array.isArray(wrap)) {
    const inner = (wrap as Record<string, unknown>).measurement;
    doc.measurements = inner === undefined ? [] : Array.isArray(inner) ? inner : [inner];
  }
  return doc;
}

function decodeText(text: string): Record<string, unknown> {
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart();
  if (head.startsWith("{")) {
    try {
      return asRecord(JSON.parse(text), "JSON document");
    } catch (e) {
      fail(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (head.startsWith("<")) return decodeXml(text);
  if (head.startsWith(CSV_MAGIC)) return decodeCsv(text);
  fail(`cannot detect encoding — expected JSON ("{"), XML ("<") or CSV magic "${CSV_MAGIC}"`);
}

// ── adapter ───────────────────────────────────────────────────────────────────────────────
export function createSt4iStandardAdapter(): VisionAdapter {
  return {
    vendorKey: "st4i-standard",
    label: "ST4I Standard Inspection Feed v1 (JSON/CSV/XML)",
    normalize(rawPayload: unknown, ctx?: VisionNormalizeContext): CanonicalInspection {
      // 1) Get the JSON-shaped document (accept parsed object OR raw file text).
      let rawDoc: Record<string, unknown>;
      if (typeof rawPayload === "string") {
        rawDoc = decodeText(rawPayload);
      } else if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
        const o = rawPayload as Record<string, unknown>;
        // Tolerate a pre-parsed XML tree (hot-folder may parse XML itself).
        rawDoc = "st4i_inspection" in o && !("header" in o)
          ? (() => {
              const inner = o["st4i_inspection"];
              return asRecord(inner, "st4i_inspection");
            })()
          : o;
      } else {
        fail("payload must be a spec document object or raw file text (string)");
      }
      rawDoc = asRecord(dropEmptyStrings(rawDoc), "document");

      // 2) Version gate — explicit, never guessed.
      const versionRaw = rawDoc.spec_version;
      if (versionRaw === undefined) fail("spec_version is required");
      const version = Number(versionRaw);
      if (version !== ST4I_SPEC_VERSION) {
        fail(`unsupported spec_version "${String(versionRaw)}" (supported: ${ST4I_SPEC_VERSION})`);
      }

      // 3) Split additive extras BEFORE validation (unknown fields must never fail — §8 rule 9).
      const { known: knownTop, extras: docExtras } = splitExtras(rawDoc, TOP_KEYS);
      const headerRaw = asRecord(knownTop.header ?? fail("header is required"), "header");
      const { known: headerKnown, extras: headerExtras } = splitExtras(headerRaw, HEADER_KEYS);
      if (!Array.isArray(knownTop.measurements)) fail("measurements must be an array");
      const measurementExtras: Array<Record<string, unknown>> = [];
      const measurementsKnown = (knownTop.measurements as unknown[]).map((m, i) => {
        const rec = asRecord(m, `measurements[${i}]`);
        const { known, extras } = splitExtras(rec, MEASUREMENT_KEYS);
        measurementExtras.push(extras);
        return known;
      });

      // 4) Strict validation (spec §8).
      const parsed = documentSchema.safeParse({
        header: headerKnown,
        measurements: measurementsKnown,
        attachments: knownTop.attachments,
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        fail(`invalid document at ${first.path.join(".") || "(root)"}: ${first.message}`);
      }
      const doc = parsed.data;
      const h = doc.header;

      // 5) Map losslessly to the canonical inspection (spec §9).
      const startedMs = Date.parse(h.started_at);
      const finishedMs = Date.parse(h.finished_at);
      const cycleTime =
        h.cycle_time_sec !== undefined
          ? h.cycle_time_sec
          : Math.round((finishedMs - startedMs)) / 1000;

      const measurements: CanonicalMeasurement[] = doc.measurements.map((m, i) => {
        const remarkParts: string[] = [];
        if (m.remark) remarkParts.push(m.remark);
        if (m.lsl !== undefined || m.usl !== undefined) {
          remarkParts.push(`spec[${m.lsl ?? "-"}..${m.usl ?? "-"}]`);
        }
        if (m.nominal !== undefined) remarkParts.push(`nominal=${m.nominal}`);
        if (m.unit) remarkParts.push(`unit=${m.unit}`);

        const out: CanonicalMeasurement = {
          pointCode: m.point_name,
          measuredValue: m.value,
          result: m.result as CanonicalResult,
          remark: remarkParts.length > 0 ? remarkParts.join("; ") : undefined,
        };
        if (m.image_ref) out.imageBase64 = m.image_ref;
        if (m.defect_code) out.defectCatalogCode = m.defect_code.trim();
        if (m.severity) out.defectSeverity = m.severity;
        if (m.bbox_px) {
          out.defectBboxX = m.bbox_px.x;
          out.defectBboxY = m.bbox_px.y;
          out.defectBboxW = m.bbox_px.w;
          out.defectBboxH = m.bbox_px.h;
        }
        const v3 = m.values_3d;
        if (v3) {
          out.valueHeight = v3.height_um;
          out.valueArea = v3.area_pct;
          out.valueVolume = v3.volume_pct;
          out.valueVoidPct = v3.void_pct;
          out.valueCoplanarity = v3.coplanarity_um;
          out.valueWarpage = v3.warpage_um;
          out.valueOffsetX = v3.offset_x_um;
          out.valueOffsetY = v3.offset_y_um;
          out.valueTilt = v3.tilt_deg;
          out.valueThickness = v3.thickness_um;
          out.valueZ = v3.z_um;
        }
        const extras: Record<string, unknown> = {};
        if (m.type !== undefined) extras.type = m.type;
        if (m.unit !== undefined) extras.unit = m.unit;
        if (m.lsl !== undefined) extras.lsl = m.lsl;
        if (m.usl !== undefined) extras.usl = m.usl;
        if (m.nominal !== undefined) extras.nominal = m.nominal;
        if (m.extra !== undefined) extras.extra = m.extra;
        if (Object.keys(measurementExtras[i]).length > 0) extras.unknown_fields = measurementExtras[i];
        if (Object.keys(extras).length > 0) out.rawExtras = extras;
        return out;
      });

      const rawExtras: Record<string, unknown> = { spec_version: ST4I_SPEC_VERSION, started_at: h.started_at };
      if (h.program_version !== undefined) rawExtras.program_version = h.program_version;
      if (h.panel_id !== undefined) rawExtras.panel_id = h.panel_id;
      if (h.board_index !== undefined) rawExtras.board_index = h.board_index;
      if (doc.attachments !== undefined) rawExtras.attachments = doc.attachments;
      if (Object.keys(headerExtras).length > 0) rawExtras.header_unknown_fields = headerExtras;
      if (Object.keys(docExtras).length > 0) rawExtras.document_unknown_fields = docExtras;

      return {
        machineCode: ctx?.machineCode ?? h.machine_code,
        apiKey: ctx?.apiKey,
        serialNumber: h.serial_number,
        productModel: h.program_name,
        batchNumber: h.lot_code,
        cycleTime,
        overallResult: h.result as CanonicalResult,
        inspectionTime: h.finished_at,
        operatorId: h.operator_id,
        // W8-B (doc 29 §2.3): panel context is now a NATIVE canonical field —
        // submitInspection persists it (0192). Copies stay in rawExtras (lossless).
        panelId: h.panel_id,
        boardIndex: h.board_index,
        measurements,
        rawExtras,
      };
    },
  };
}
