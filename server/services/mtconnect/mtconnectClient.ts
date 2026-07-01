/**
 * MTConnect client — fetch + parse an MTConnect Agent's HTTP/XML endpoints.
 *
 * MTConnect (ANSI/MTC1.4) is the open standard for CNC / machine tools. An Agent
 * exposes three read-only HTTP endpoints returning XML:
 *   - /probe   → MTConnectDevices: the device model (Device → DataItems, each with
 *                an id / type / subType / category SAMPLE|EVENT|CONDITION).
 *   - /current → MTConnectStreams: the latest value of every DataItem.
 *   - /sample  → MTConnectStreams: a window of historical values.
 *
 * This module is ADDITIVE and FAIL-SAFE: every network/parse error is logged and
 * surfaced as `null` / `[]` — nothing throws to the caller. It adds NO npm
 * dependency: the project has no XML parser, so we use a small, dependency-free
 * tokenizer tuned for the (flat, attribute-heavy) MTConnect stream shape. See
 * `parseStreamsXml` for the documented limitation.
 *
 * Flag-gating lives in the poller; the client itself is inert until called.
 */

export type MtcCategory = "SAMPLE" | "EVENT" | "CONDITION";

/** A normalized reading lifted out of an MTConnect /current or /sample response. */
export interface MtcReading {
  /** Device `name` (or `uuid`) the DataItem belongs to. */
  deviceName: string;
  /** DataItem id (stable handle, e.g. "Xact"). */
  dataItemId: string;
  /** DataItem `name` when present (human label, e.g. "Xabs"). */
  dataItemName?: string;
  /** MTConnect type, UPPER_SNAKE (e.g. "POSITION", "SPINDLE_SPEED", "EXECUTION"). */
  type: string;
  /** MTConnect subType when present (e.g. "ACTUAL", "COMMANDED"). */
  subType?: string;
  /** SAMPLE | EVENT | CONDITION. */
  category: MtcCategory;
  /** Raw text content of the observation ("123.45", "ACTIVE", "Normal", "UNAVAILABLE"). */
  value: string;
  /** Numeric coercion of `value` when finite, else null (SAMPLEs are usually numeric). */
  numericValue: number | null;
  /** Observation timestamp from the XML, parsed; falls back to now() if absent/bad. */
  timestamp: Date;
  /** For CONDITION observations the element name is the state (Normal/Warning/Fault/Unavailable). */
  conditionState?: string;
  /** Vendor's native alarm code (the `nativeCode` attribute, present on CONDITION/EVENT). */
  nativeCode?: string;
  /** Vendor's native severity string (the `nativeSeverity` attribute, CONDITION). */
  nativeSeverity?: string;
}

/** A DataItem definition from /probe. */
export interface MtcDataItemDef {
  id: string;
  name?: string;
  type: string;
  subType?: string;
  category: MtcCategory;
  units?: string;
  deviceName: string;
}

export interface MtcProbeResult {
  devices: Array<{ name: string; uuid?: string; dataItems: MtcDataItemDef[] }>;
  dataItemCount: number;
}

const CONDITION_STATES = new Set(["NORMAL", "WARNING", "FAULT", "UNAVAILABLE"]);
// MTConnect Streams wrapper / structural elements that are never observations.
const NON_OBSERVATION = new Set([
  "MTCONNECTSTREAMS", "HEADER", "STREAMS", "DEVICESTREAM",
  "COMPONENTSTREAM", "SAMPLES", "EVENTS", "CONDITION",
]);

function log(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err != null ? String(err) : "";
  console.warn(`[MTConnect] ${msg}${detail ? `: ${detail}` : ""}`);
}

/** Decode the handful of XML entities that appear in MTConnect payloads. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Parse the attributes of a single start/empty tag into a map. */
function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1]] = decodeEntities(m[2]);
  }
  return attrs;
}

function toCategory(raw: string | undefined): MtcCategory {
  const u = (raw || "").toUpperCase();
  return u === "SAMPLE" || u === "EVENT" || u === "CONDITION" ? u : "EVENT";
}

function parseTimestamp(ts: string | undefined): Date {
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Parse a /probe (MTConnectDevices) document into device + DataItem definitions.
 *
 * Implementation is a tolerant tag scan: we walk every `<Device …>` open tag to
 * pick up the device context, then every `<DataItem …/>` element. This handles
 * the nested Components tree without building a DOM, which is sufficient because
 * DataItem ids/categories are self-describing (no positional meaning).
 */
export function parseProbeXml(xml: string): MtcProbeResult {
  const result: MtcProbeResult = { devices: [], dataItemCount: 0 };
  try {
    // Tokenize the device boundaries so each DataItem is attributed to a device.
    // Split on Device start tags; index 0 is the preamble before the first Device.
    const deviceRe = /<Device\b([^>]*)>/gi;
    const matches: Array<{ index: number; attrs: Record<string, string> }> = [];
    let dm: RegExpExecArray | null;
    while ((dm = deviceRe.exec(xml)) !== null) {
      matches.push({ index: dm.index, attrs: parseAttrs(dm[1]) });
    }
    if (matches.length === 0) return result;

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : xml.length;
      const segment = xml.slice(start, end);
      const dattrs = matches[i].attrs;
      const deviceName = dattrs.name || dattrs.uuid || `device${i}`;
      const dataItems: MtcDataItemDef[] = [];

      const diRe = /<DataItem\b([^>]*?)\/?>/gi;
      let di: RegExpExecArray | null;
      while ((di = diRe.exec(segment)) !== null) {
        const a = parseAttrs(di[1]);
        if (!a.id || !a.type) continue;
        dataItems.push({
          id: a.id,
          name: a.name || undefined,
          type: a.type.toUpperCase(),
          subType: a.subType || undefined,
          category: toCategory(a.category),
          units: a.units || a.nativeUnits || undefined,
          deviceName,
        });
      }

      result.devices.push({ name: deviceName, uuid: dattrs.uuid, dataItems });
      result.dataItemCount += dataItems.length;
    }
  } catch (err) {
    log("parseProbeXml failed", err);
  }
  return result;
}

/**
 * Parse a /current or /sample (MTConnectStreams) document into normalized readings.
 *
 * MTConnect streams nest observations under DeviceStream → ComponentStream →
 * Samples/Events/Condition. Every observation element carries `dataItemId`,
 * `timestamp` and (for non-CONDITION) text content; CONDITION observations use
 * the element name (Normal/Warning/Fault/Unavailable) as the state and may be
 * empty. We scan element-by-element, tracking the enclosing DeviceStream `name`
 * so each reading is attributed to its device.
 *
 * LIMITATION (documented): this is a regex tokenizer, not a validating XML
 * parser. It assumes the well-formed, attribute-on-one-line output that every
 * compliant MTConnect Agent emits (no CDATA in observation text, no `>` inside
 * attribute values). That covers the real-world Agent output we ingest; a
 * pathological hand-crafted document could be mis-tokenized, but such input only
 * yields fewer/no readings — it never throws (the whole body is try/caught).
 */
export function parseStreamsXml(xml: string): MtcReading[] {
  const readings: MtcReading[] = [];
  try {
    let currentDevice = "unknown";
    // Match any start, empty, or end tag and capture its raw body.
    const tagRe = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagRe.exec(xml)) !== null) {
      const isClose = tag[1] === "/";
      const rawName = tag[2];
      const name = rawName.toUpperCase();
      const body = tag[3] || "";
      const selfClosing = tag[4] === "/";

      if (isClose) continue;

      if (name === "DEVICESTREAM") {
        const a = parseAttrs(body);
        currentDevice = a.name || a.uuid || "unknown";
        continue;
      }
      if (NON_OBSERVATION.has(name)) continue;

      const a = parseAttrs(body);
      // An observation always carries a dataItemId attribute.
      if (!a.dataItemId) continue;

      const isCondition = CONDITION_STATES.has(name);

      // Capture text content for non-self-closing, non-condition observations.
      let value = "";
      if (!selfClosing) {
        const close = xml.indexOf(`</${rawName}>`, tagRe.lastIndex);
        if (close !== -1) {
          value = decodeEntities(xml.slice(tagRe.lastIndex, close).trim());
        }
      }
      if (isCondition && !value) value = rawName; // condition with no text → state name

      const num = value !== "" && value.toUpperCase() !== "UNAVAILABLE" ? Number(value) : NaN;
      const numeric = Number.isFinite(num) ? num : null;

      // Category resolution: MTConnect /current observations carry NO `category`
      // attribute (it lives in /probe), so we infer it. CONDITION is unambiguous
      // (element name is a state). Otherwise an explicit category attr wins; if
      // absent, a finite numeric value ⇒ SAMPLE, else EVENT.
      let category: MtcCategory;
      if (isCondition) category = "CONDITION";
      else if (a.category) category = toCategory(a.category);
      else category = numeric !== null ? "SAMPLE" : "EVENT";

      readings.push({
        deviceName: currentDevice,
        dataItemId: a.dataItemId,
        dataItemName: a.name || undefined,
        type: (a.type || rawName).toUpperCase(),
        subType: a.subType || undefined,
        category,
        value,
        numericValue: numeric,
        timestamp: parseTimestamp(a.timestamp),
        conditionState: isCondition ? rawName : undefined,
        nativeCode: a.nativeCode || undefined,
        nativeSeverity: a.nativeSeverity || undefined,
      });
    }
  } catch (err) {
    log("parseStreamsXml failed", err);
  }
  return readings;
}

/** Strip a trailing slash so we can append /probe etc. cleanly. */
function normalizeBase(agentUrl: string): string {
  return agentUrl.replace(/\/+$/, "");
}

/**
 * Fetch + parse text from an MTConnect endpoint. Fail-safe: returns null on any
 * network/HTTP error. Uses axios (already a dependency) with a short timeout.
 */
async function fetchXml(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const { default: axios } = await import("axios");
    const res = await axios.get<string>(url, {
      timeout: timeoutMs,
      responseType: "text",
      transformResponse: [(d) => d], // keep raw XML, do not JSON-parse
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    return typeof res.data === "string" ? res.data : String(res.data ?? "");
  } catch (err) {
    log(`GET ${url} failed`, err);
    return null;
  }
}

/** Fetch + parse the agent's /probe. Returns an empty result on any failure. */
export async function fetchProbe(agentUrl: string, timeoutMs = 8000): Promise<MtcProbeResult> {
  const xml = await fetchXml(`${normalizeBase(agentUrl)}/probe`, timeoutMs);
  if (!xml) return { devices: [], dataItemCount: 0 };
  return parseProbeXml(xml);
}

/** Fetch + parse the agent's /current. Returns [] on any failure. */
export async function fetchCurrent(agentUrl: string, timeoutMs = 8000): Promise<MtcReading[]> {
  const xml = await fetchXml(`${normalizeBase(agentUrl)}/current`, timeoutMs);
  if (!xml) return [];
  return parseStreamsXml(xml);
}

/** Fetch + parse the agent's /sample. Returns [] on any failure. */
export async function fetchSample(agentUrl: string, timeoutMs = 8000): Promise<MtcReading[]> {
  const xml = await fetchXml(`${normalizeBase(agentUrl)}/sample`, timeoutMs);
  if (!xml) return [];
  return parseStreamsXml(xml);
}
