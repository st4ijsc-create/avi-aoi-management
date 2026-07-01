/**
 * I3b-2 (doc 20 §3/§5) — Euromap 77/83 OPC-UA READ PATH.
 * Flag: EQ_INTEG_ENABLED (reuses the I1 equipment-integration master flag).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * I1 built the Euromap FRAMEWORK (euromapAdapter): a pure ingest/normalize + local
 * cache with NO transport. This module adds the missing READ PATH for Euromap 77
 * (OPC-UA Companion Spec for injection-moulding machines, PLASTICS_RUBBER nodeset;
 * Euromap 83 carries the SAME model over MQTT/JSON). It REUSES the existing
 * `opcuaDriver` (ot/drivers/opcuaDriver.ts) — the platform's real node-opcua read
 * path — via a CONFIGURED node-map (`EuromapNodeMap`: UEM field → OPC-UA nodeId).
 *
 * Euromap 77 exposes (per PLASTICS_RUBBER / the machine's OPC-UA server) nodes for:
 *   ActualCycleTime, ShotCounter / GoodPartsCounter, machine mode/state, active
 *   mould/recipe, and alarms. The exact nodeIds are PER MACHINE — a bring-up fills the
 *   node-map from the server's address space (browse) once, then this reader pulls them.
 *
 * HONESTY / SAFETY (unchanged from I1):
 *   - READ-ONLY. Uses ONLY driver.readTags (never writeTags). Opens no control path.
 *   - No endpoint configured / server unreachable → a CLEAR error, source stays cache|
 *     none. NOTHING is fabricated: a node that reads bad/absent stays null.
 *   - Alarm nodes → alarmNormalizer → Andon with vendor identity (default 'euromap').
 *
 * A real run points the endpoint at an OPC-UA sim server (open62541 / Prosys) loaded
 * with the Euromap 77 nodeset, or a real Euromap-77 machine (see doc 20 §7 runbook).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { OtDriver, OtTagAddress, OtSample } from "../ot/otDriver";
import type { EuromapNativeReadout, EuromapAlarm, EuromapTransport } from "./euromapAdapter";

/**
 * Map of Unified-Equipment-Model fields → OPC-UA nodeIds on a Euromap-77 server.
 * Every entry is OPTIONAL — a machine may not expose every node. `alarmNodes` are
 * read as booleans (active/clear); each carries the native alarm code to normalize.
 */
export interface EuromapNodeMap {
  /** ns=…;s=ActiveMould / recipe id → recipe_id. */
  activeMould?: string;
  recipeName?: string;
  /** ActualCycleTime (seconds). */
  actualCycleTime?: string;
  /** Cumulative shot/cycle counter → cycle_count. */
  shotCounter?: string;
  /** Good parts counter → production_counter. */
  goodPartsCounter?: string;
  /** Target cycle time (seconds) — used with actual for a utilization proxy. */
  targetCycleTime?: string;
  /** Machine mode/state string (AUTOMATIC / SEMI_AUTOMATIC / MANUAL / STOPPED). */
  machineMode?: string;
  /**
   * Alarm nodes: each is a boolean node that reads true when the alarm is active.
   * `code` is the NATIVE alarm code fed to the taxonomy (mapAlarm). Optional message.
   */
  alarmNodes?: Array<{ nodeId: string; code: string; message?: string }>;
}

/** The OPC-UA data type to read each node as (all read-only). */
type NumericField = "actualCycleTime" | "shotCounter" | "goodPartsCounter" | "targetCycleTime";
type StringField = "activeMould" | "recipeName" | "machineMode";

const NUMERIC_FIELDS: NumericField[] = ["actualCycleTime", "shotCounter", "goodPartsCounter", "targetCycleTime"];
const STRING_FIELDS: StringField[] = ["activeMould", "recipeName", "machineMode"];

/**
 * Build the OtTagAddress list for a node-map. Numeric fields → 'float' tags, string
 * fields → 'string' tags, alarm nodes → 'bool' tags. tagKey encodes the field/code so
 * the reader can re-associate the OtSample back to the UEM. PURE (no I/O).
 */
export function buildTagAddresses(map: EuromapNodeMap): OtTagAddress[] {
  const tags: OtTagAddress[] = [];
  for (const f of NUMERIC_FIELDS) {
    const nodeId = map[f];
    if (nodeId) tags.push({ tagKey: `uem:${f}`, address: nodeId, dataType: "float" });
  }
  for (const f of STRING_FIELDS) {
    const nodeId = map[f];
    if (nodeId) tags.push({ tagKey: `uem:${f}`, address: nodeId, dataType: "string" });
  }
  for (const [i, a] of (map.alarmNodes ?? []).entries()) {
    if (a?.nodeId) tags.push({ tagKey: `alarm:${i}`, address: a.nodeId, dataType: "bool" });
  }
  return tags;
}

/**
 * PURE assembler: OPC-UA samples (keyed by the tagKeys buildTagAddresses produced) +
 * the node-map → a native Euromap readout. Only GOOD-quality samples contribute; a
 * bad/absent sample leaves that field undefined (never fabricated). Alarm nodes that
 * read true → an active EuromapAlarm carrying the configured native code.
 */
export function samplesToReadout(
  samples: OtSample[],
  map: EuromapNodeMap,
  opts: { transport?: EuromapTransport; vendor?: string } = {},
): EuromapNativeReadout {
  const byKey = new Map(samples.map((s) => [s.tagKey, s]));
  const num = (f: NumericField): number | undefined => {
    const s = byKey.get(`uem:${f}`);
    if (!s || s.quality !== "good" || typeof s.value !== "number" || !Number.isFinite(s.value)) return undefined;
    return s.value;
  };
  const str = (f: StringField): string | undefined => {
    const s = byKey.get(`uem:${f}`);
    if (!s || s.quality !== "good" || s.value == null) return undefined;
    const v = String(s.value).trim();
    return v ? v : undefined;
  };

  const alarms: EuromapAlarm[] = [];
  for (const [i, a] of (map.alarmNodes ?? []).entries()) {
    const s = byKey.get(`alarm:${i}`);
    // Only assert active when we actually read a truthy GOOD value — never guess.
    if (s && s.quality === "good" && s.value === true) {
      alarms.push({ code: a.code, message: a.message, active: true });
    }
  }

  const readout: EuromapNativeReadout = {
    transport: opts.transport ?? "euromap77",
    vendor: opts.vendor,
    activeMoldId: str("activeMould"),
    recipeName: str("recipeName"),
    actualCycleTimeSec: num("actualCycleTime"),
    shotCounter: num("shotCounter"),
    goodPartsCounter: num("goodPartsCounter"),
    targetCycleTimeSec: num("targetCycleTime"),
    machineMode: str("machineMode"),
    alarms: alarms.length ? alarms : undefined,
    at: new Date(),
  };
  return readout;
}

/** Config for one Euromap-77 OPC-UA connection. */
export interface EuromapOpcuaConfig {
  endpoint: string;
  nodeMap: EuromapNodeMap;
  transport?: EuromapTransport;
  vendor?: string;
  timeoutMs?: number;
  options?: Record<string, unknown>;
}

/**
 * Read one Euromap-77 snapshot over OPC-UA, REUSING the supplied `driver` (the real
 * opcuaDriver from ot/driverRegistry, or a mock in tests). Connect → readTags(nodeMap)
 * → assemble the native readout → disconnect. READ-ONLY; never calls writeTags.
 *
 * Honest failure: no endpoint → throws a clear error; an unreachable server surfaces
 * the driver's connect error (the caller keeps its last cache — nothing fabricated).
 *
 * @returns the native readout (feed it to EuromapAdapter.ingest → UEM + alarm→Andon).
 */
export async function readEuromapOverOpcua(
  driver: OtDriver,
  cfg: EuromapOpcuaConfig,
): Promise<EuromapNativeReadout> {
  const endpoint = (cfg.endpoint ?? "").trim();
  if (!endpoint) {
    throw new Error("Euromap OPC-UA: no endpoint configured (set EUROMAP_OPCUA_ENDPOINT)");
  }
  const tags = buildTagAddresses(cfg.nodeMap);
  if (tags.length === 0) {
    throw new Error("Euromap OPC-UA: empty node-map (nothing to read) — configure EUROMAP_OPCUA_NODEMAP");
  }

  await driver.connect({ endpoint, options: cfg.options, timeoutMs: cfg.timeoutMs ?? 5000 });
  try {
    const samples = await driver.readTags(tags);
    return samplesToReadout(samples, cfg.nodeMap, { transport: cfg.transport, vendor: cfg.vendor });
  } finally {
    await driver.disconnect().catch(() => undefined);
  }
}

/**
 * Parse a EUROMAP_OPCUA_NODEMAP env value (JSON object matching EuromapNodeMap). Pure,
 * fail-safe → null on any error (the caller reports "no node-map configured").
 */
export function parseNodeMap(raw: string | undefined): EuromapNodeMap | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object") return parsed as EuromapNodeMap;
  } catch {
    // fall through
  }
  return null;
}
