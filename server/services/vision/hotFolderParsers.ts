/**
 * Hot-folder file parsers + glob matching (doc 27 §3 gap C1 · W2-A).
 *
 * PURE helpers (no fs, no db) shared by hotFolderService (watch pipeline) and
 * hotFolderRouter.dryRun (wizard "test a sample file" endpoint):
 *
 *   • globToRegex(pattern)      — minimal, safe glob → RegExp (supports * ? and
 *     {a,b} alternation; case-insensitive because Windows/SMB names are).
 *   • detectFormat(fileName)    — csv | xml | json by extension (null = unsupported).
 *   • parseResultFile(name, s)  — text → structured payload for adapter.normalize():
 *       - .json → the parsed JSON document, passed to the adapter AS-IS.
 *       - .xml  → fast-xml-parser document (attributes kept, prefix "@_"), AS-IS.
 *       - .csv  → { fileName, format:"csv", rows, raw } where rows are
 *         header-keyed records (RFC-4180 parser below: quoted fields, escaped
 *         quotes, embedded commas/newlines, CRLF — dependency-free on purpose,
 *         mirroring the MTConnect client's tokenizer approach).
 *     CSV ENVELOPE CONTRACT: vendor adapters that consume CSV exports (Saki,
 *     Mirtec, I.C.T, st4i-standard …) should accept an object with `rows`
 *     (Array<Record<string,string>>) and may fall back to `raw` for non-tabular
 *     formats. JSON/XML adapters receive the parsed document directly.
 *
 * Fail-safe: every parser throws a descriptive Error on malformed input (the
 * caller moves the file to errorPath with a .reason.txt sidecar); never returns
 * a half-built payload.
 */
import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type HotFolderFormat = "csv" | "xml" | "json";

/** sha256 hex of raw content — the dedup/idempotency anchor. */
export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Convert a simple glob (*, ?, {a,b}) to a case-insensitive RegExp anchored to
 * the WHOLE file name. Everything else is escaped literally, so a hostile
 * pattern can not become a pathological regex (no nested quantifiers emitted).
 */
export function globToRegex(pattern: string): RegExp {
  const src = String(pattern ?? "").trim() || "*";
  let out = "";
  let inBrace = false;
  for (const ch of src) {
    if (ch === "*") out += "[^/\\\\]*";
    else if (ch === "?") out += "[^/\\\\]";
    else if (ch === "{" && !inBrace) { out += "(?:"; inBrace = true; }
    else if (ch === "}" && inBrace) { out += ")"; inBrace = false; }
    else if (ch === "," && inBrace) out += "|";
    else out += ch.replace(/[.+^$()[\]{}|\\]/g, "\\$&");
  }
  if (inBrace) out += ")"; // tolerate an unclosed brace rather than throw
  return new RegExp(`^${out}$`, "i");
}

/** True when fileName matches the config's glob filter (base name only). */
export function matchesPattern(fileName: string, pattern: string): boolean {
  return globToRegex(pattern).test(fileName);
}

/** csv | xml | json from the file extension; null = unsupported extension. */
export function detectFormat(fileName: string): HotFolderFormat | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(fileName ?? "").trim());
  const ext = m?.[1]?.toLowerCase();
  if (ext === "csv" || ext === "txt") return "csv"; // many AOI exports are .txt CSV
  if (ext === "xml") return "xml";
  if (ext === "json") return "json";
  return null;
}

/** CSV envelope handed to adapter.normalize() for tabular vendor exports. */
export interface CsvPayloadEnvelope {
  fileName: string;
  format: "csv";
  /** Header-keyed rows (header: true, empty lines skipped, values are strings). */
  rows: Array<Record<string, string>>;
  /** Raw text — fallback for adapters whose format is not strictly tabular. */
  raw: string;
}

export interface ParsedResultFile {
  format: HotFolderFormat;
  /** Payload in the shape adapter.normalize() expects (see module doc). */
  payload: unknown;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
});

/**
 * Parse a result file's TEXT into the adapter payload. Throws a descriptive
 * Error on malformed content (never returns a half-built object).
 */
export function parseResultFile(fileName: string, content: string): ParsedResultFile {
  const format = detectFormat(fileName);
  if (!format) {
    throw new Error(`Unsupported file extension for "${fileName}" (expected .csv/.txt/.xml/.json)`);
  }
  const text = content.replace(/^﻿/, ""); // strip UTF-8 BOM (common in vendor exports)
  if (!text.trim()) throw new Error(`File "${fileName}" is empty`);

  if (format === "json") {
    try {
      return { format, payload: JSON.parse(text) };
    } catch (err) {
      throw new Error(`Invalid JSON in "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (format === "xml") {
    const valid = XMLValidator.validate(text);
    if (valid !== true) {
      throw new Error(`Invalid XML in "${fileName}": ${valid.err?.msg ?? "malformed document"}`);
    }
    const doc = xmlParser.parse(text);
    if (!doc || typeof doc !== "object" || Object.keys(doc).length === 0) {
      throw new Error(`Invalid XML in "${fileName}": no root element`);
    }
    return { format, payload: doc };
  }

  // csv
  const rows = parseCsvRecords(text, fileName);
  const envelope: CsvPayloadEnvelope = {
    fileName,
    format: "csv",
    rows,
    raw: text,
  };
  return { format, payload: envelope };
}

// ── RFC-4180 CSV (dependency-free, quoted fields / escaped quotes / CRLF safe) ─

/** Tokenize CSV text into rows of cells. Throws on an unterminated quote. */
export function parseCsvCells(text: string, fileName = "file.csv"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { endCell(); i++; continue; }
    if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); i++; continue; }
    if (ch === "\n") { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (inQuotes) throw new Error(`Invalid CSV in "${fileName}": unterminated quoted field`);
  if (cell.length > 0 || row.length > 0) endRow();

  // Drop rows that are entirely empty (trailing newlines, blank separator lines).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Header-keyed records from CSV text (first non-empty row = header). */
export function parseCsvRecords(text: string, fileName = "file.csv"): Array<Record<string, string>> {
  const rows = parseCsvCells(text, fileName);
  if (rows.length === 0) throw new Error(`CSV "${fileName}" is empty`);
  const header = rows[0].map((h, idx) => h.trim() || `column${idx + 1}`);
  if (rows.length === 1) throw new Error(`CSV "${fileName}" has a header but no data rows`);
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => { rec[h] = (cells[idx] ?? "").trim(); });
    return rec;
  });
}
