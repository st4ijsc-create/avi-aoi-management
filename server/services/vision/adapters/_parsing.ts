/**
 * Shared, dependency-light parsing helpers for vision adapters.
 *
 * Adapters accept BOTH pre-parsed objects (the hot-folder service may do file → object
 * parsing itself) AND raw file text (string). These helpers give every adapter the same
 * strict, tested primitives for the text case:
 *
 *   • parseCsv        — RFC-4180 subset (quotes, escaped quotes, CR/LF), pure, no deps.
 *   • csvRowsToObjects— header-row CSV → array of {column: value} records ("" dropped).
 *   • parseXmlDoc     — fast-xml-parser with the SAFE shared config (no attributes, no
 *                       entity expansion beyond built-ins, values kept as STRINGS so
 *                       serial numbers like "0012345" never lose leading zeros).
 *   • RFC3339_TZ_RE   — timestamp WITH mandatory UTC offset (doc 27 A2 lesson: offset-less
 *                       local times caused real +7h production incidents).
 *   • toTzAwareIso    — normalize common vendor "date + time" exports (e.g. "2026/07/04"
 *                       + "08:30:12", "2026-07-04 08:30:12") into RFC 3339 WITH an explicit
 *                       offset, appending the site-configured default offset when the
 *                       vendor file (as is typical) carries none.
 */
import { XMLParser } from "fast-xml-parser";

/** RFC 3339 timestamp with an EXPLICIT UTC offset ("Z" or ±hh:mm). Offset is mandatory. */
export const RFC3339_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse CSV text (RFC-4180 subset: `"` quoting, `""` escapes, LF or CRLF rows).
 * Returns rows of string cells. Empty lines are skipped. Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  // Strip a UTF-8 BOM if present (common from Windows machine exports).
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    // Skip fully-empty lines (e.g. trailing newline).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new Error("CSV: unterminated quoted cell");
  if (cell !== "" || row.length > 0) pushRow();
  return rows;
}

/**
 * Header-row CSV → array of records. Cell "" → the key is OMITTED (absent optional field).
 * Header cells are trimmed; duplicate header names keep the LAST occurrence.
 */
export function csvRowsToObjects(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((name, idx) => {
      const v = (cells[idx] ?? "").trim();
      if (name && v !== "") rec[name] = v;
    });
    return rec;
  });
}

/**
 * Parse an XML document with the shared safe config. `arrayTags` lists element names that
 * must ALWAYS come back as arrays (fast-xml-parser collapses single children to objects).
 * All leaf values stay STRINGS (parseTagValue:false) — callers coerce explicitly.
 */
export function parseXmlDoc(xmlText: string, arrayTags: readonly string[] = []): unknown {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => arrayTags.includes(name),
    processEntities: true,
  });
  return parser.parse(xmlText);
}

/**
 * Normalize a vendor local date(+time) export into RFC 3339 WITH an explicit offset.
 *
 * Accepts: "2026/07/04" | "2026-07-04" (+ separate "08:30:12"), or a single
 * "2026-07-04 08:30:12" / "2026-07-04T08:30:12" string. If the input already carries an
 * offset ("Z" / ±hh:mm) it is kept verbatim. Otherwise `defaultOffset` (site-configured,
 * e.g. "+07:00") is appended — NEVER emit an offset-less timestamp (doc 27 A2).
 * Returns undefined when the input cannot be normalized (representative vendor adapters
 * drop the timestamp rather than guess).
 */
export function toTzAwareIso(
  dateStr: string | undefined,
  timeStr: string | undefined,
  defaultOffset: string,
): string | undefined {
  let s = (dateStr ?? "").trim();
  if (!s) return undefined;
  if (timeStr && timeStr.trim()) s = `${s} ${timeStr.trim()}`;
  s = s.replace(/\//g, "-").replace(" ", "T");
  if (!/T/.test(s)) s = `${s}T00:00:00`;
  // Seconds optional in some exports → pad.
  s = s.replace(/T(\d{2}):(\d{2})($|(?=[Z+-]))/, "T$1:$2:00");
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    return RFC3339_TZ_RE.test(s) ? s : undefined;
  }
  const out = `${s}${defaultOffset}`;
  return RFC3339_TZ_RE.test(out) ? out : undefined;
}

/** Uppercase a free-text vendor defect token into a code-ish form: "Solder Bridge" → "SOLDER_BRIDGE". */
export function tokenizeDefect(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
