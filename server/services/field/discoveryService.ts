/**
 * Khối 1 (doc 16 §5 / §15 X1-d) — Hot-plug device DISCOVERY.  Flag: FIELD_V2_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * `discoverDevices({protocol, endpoint})` PROBES a network endpoint for candidate
 * devices and returns them WITHOUT touching the live registry, plus a registration
 * path (`registerDiscoveredDevice`) that adds a chosen candidate into the registry
 * WITHOUT a process restart (a disabled device_adapters row + a field_device_health
 * candidate row; the operator enables it later → the OT manager picks it up).
 *
 * ⚠ HONESTY — real probes vs SEAMS (never fabricated):
 *   • opcua  → REAL probe. Connects via the existing OpcuaDriver and BROWSES the
 *              Objects folder (session.browse). Requires node-opcua installed + a
 *              reachable endpoint. If the package/endpoint is unavailable the driver
 *              throws and we return { ok:false, reason } — we DO NOT invent nodes.
 *   • mdns   → SEAM. No mDNS/Bonjour library is linked in this stack. We return
 *              { ok:false, seam:true } with an honest note. NO fake results.
 *   • others → SEAM (documented) until a real probe is wired.
 *
 * SAFETY: discovery is READ-ONLY (browse). Registration writes registry STATE only,
 * disabled-by-default → opens NO control path. The flag-gated router enforces RBAC.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { deviceAdapters, fieldDeviceHealth } from "../../../drizzle/schema";
import { fieldV2Enabled } from "./fieldHealthService";

export { fieldV2Enabled };

/** Protocols the discovery service knows about (real probe vs honest seam). */
export type DiscoveryProtocol = "opcua" | "mdns" | "modbus" | "s7" | "ethernet-ip";

export interface DiscoverInput {
  protocol: DiscoveryProtocol;
  endpoint: string;
  /** Optional OPC-UA root node to browse (default Objects folder). */
  rootNodeId?: string;
  timeoutMs?: number;
}

export interface DiscoveredCandidate {
  /** Logical candidate key, e.g. "opcua:ns=2;s=Robot1". */
  candidateId: string;
  protocol: DiscoveryProtocol;
  endpoint: string;
  name: string;
  /** Raw probe detail (browseName / nodeClass for OPC-UA). */
  detail?: Record<string, unknown>;
}

export interface DiscoverResult {
  ok: boolean;
  /** True when this protocol is an HONEST SEAM (no real probe library present). */
  seam: boolean;
  protocol: DiscoveryProtocol;
  endpoint: string;
  candidates: DiscoveredCandidate[];
  reason?: string;
}

/** Which protocols are REAL probes vs documented seams (honesty surface for the UI). */
export function probeSupport(): Record<DiscoveryProtocol, "real" | "seam"> {
  return {
    opcua: "real",        // node-opcua browse (when the package + endpoint are available)
    mdns: "seam",         // no mDNS/Bonjour library linked — honest seam
    modbus: "seam",       // unit-id sweep not implemented — honest seam
    s7: "seam",           // rack/slot probe not implemented — honest seam
    "ethernet-ip": "seam",// list-identity not implemented — honest seam
  };
}

/**
 * Probe an endpoint for candidate devices. No-op (ok:false) unless FIELD_V2_ENABLED.
 * Fail-safe: a probe error → { ok:false, reason } (never throws to the caller).
 */
export async function discoverDevices(input: DiscoverInput): Promise<DiscoverResult> {
  const base: DiscoverResult = { ok: false, seam: false, protocol: input.protocol, endpoint: input.endpoint, candidates: [] };
  if (!fieldV2Enabled()) return { ...base, reason: "FIELD_V2_ENABLED off" };

  if (input.protocol === "opcua") {
    return discoverViaOpcua(input);
  }
  // All other protocols are HONEST SEAMS — no real probe library is present. We never
  // fabricate candidates; we return an empty list flagged as a seam with a clear note.
  return {
    ...base,
    seam: true,
    reason:
      input.protocol === "mdns"
        ? "mDNS discovery is a documented seam: no mDNS/Bonjour library is linked. No results fabricated."
        : `${input.protocol} discovery is a documented seam: no real probe implemented yet. No results fabricated.`,
  };
}

/** REAL OPC-UA discovery: connect → browse → map references to candidates → disconnect. */
async function discoverViaOpcua(input: DiscoverInput): Promise<DiscoverResult> {
  const base: DiscoverResult = { ok: false, seam: false, protocol: "opcua", endpoint: input.endpoint, candidates: [] };
  try {
    const { OpcuaDriver } = await import("../ot/drivers/opcuaDriver");
    const driver = new OpcuaDriver();
    try {
      await driver.connect({ endpoint: input.endpoint, timeoutMs: input.timeoutMs ?? 5000 });
      const nodes = await driver.browseNodes(input.rootNodeId);
      const candidates: DiscoveredCandidate[] = nodes.map((n) => ({
        candidateId: `opcua:${n.nodeId}`,
        protocol: "opcua",
        endpoint: input.endpoint,
        name: n.browseName || n.nodeId,
        detail: { nodeId: n.nodeId, browseName: n.browseName, nodeClass: n.nodeClass },
      }));
      return { ...base, ok: true, candidates };
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
  } catch (err) {
    // node-opcua not installed OR endpoint unreachable → honest failure, NO fabrication.
    return { ...base, ok: false, reason: (err as Error)?.message || String(err) };
  }
}

export interface RegisterDiscoveredInput {
  candidate: { protocol: DiscoveryProtocol; endpoint: string; name: string; detail?: Record<string, unknown> };
  /** Adapter name (defaults to the candidate name). */
  name?: string;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface RegisterDiscoveredResult {
  ok: boolean;
  enabled: boolean;
  adapterId?: number;
  healthId?: number;
  message?: string;
}

/**
 * Register a discovered candidate into the registry WITHOUT a restart. Creates a
 * device_adapters row (isEnabled=false — explicit enable required, mirrors the robots
 * registry default) and a field_device_health candidate row (discoveredVia=protocol).
 * The OT manager picks up the adapter when an operator enables it — no restart needed.
 *
 * No-op (enabled:false) unless FIELD_V2_ENABLED. Idempotent on (protocol, endpoint, name):
 * a re-register returns the existing adapter. ONLY OPC-UA registers as an OT adapter
 * today (the only real probe); seam protocols return a clear message.
 */
export async function registerDiscoveredDevice(input: RegisterDiscoveredInput): Promise<RegisterDiscoveredResult> {
  if (!fieldV2Enabled()) return { ok: false, enabled: false, message: "FIELD_V2_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, message: "db unavailable" };

  if (input.candidate.protocol !== "opcua") {
    return { ok: false, enabled: true, message: `${input.candidate.protocol} is a discovery seam — no real adapter to register` };
  }

  const name = (input.name ?? input.candidate.name).slice(0, 255);
  // Deterministic discovery code (unique) so re-registering the same endpoint+name is
  // idempotent. Sanitized to the 64-char code column.
  const code = `disc-opcua-${input.candidate.endpoint}-${name}`
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 64);
  try {
    // Idempotent: an enabled/disabled adapter with the same generated code → return it.
    const [existing] = await db
      .select({ id: deviceAdapters.id })
      .from(deviceAdapters)
      .where(eq(deviceAdapters.code, code))
      .limit(1);
    let adapterId = existing?.id;
    if (!adapterId) {
      const [row] = await db
        .insert(deviceAdapters)
        .values({
          code,
          name,
          protocol: "opcua",
          endpoint: input.candidate.endpoint,
          // Disabled by default — an operator must explicitly enable (mirrors robots).
          isEnabled: false,
        })
        .returning({ id: deviceAdapters.id });
      adapterId = row?.id;
    }

    // Record a field_device_health candidate so it shows in the health board as
    // 'unknown' until it heartbeats. Idempotent on deviceKey.
    const deviceKey = `adapter:${adapterId}`;
    let healthId: number | undefined;
    const [eh] = await db
      .select({ id: fieldDeviceHealth.id })
      .from(fieldDeviceHealth)
      .where(eq(fieldDeviceHealth.deviceKey, deviceKey))
      .limit(1);
    if (eh) {
      healthId = eh.id;
    } else {
      const [hrow] = await db
        .insert(fieldDeviceHealth)
        .values({
          deviceKey,
          deviceKind: "ot-adapter",
          state: "unknown",
          discoveredVia: "opcua",
          endpoint: input.candidate.endpoint,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
        })
        .returning({ id: fieldDeviceHealth.id });
      healthId = hrow?.id;
    }
    console.log(`[Discovery] registered OPC-UA candidate "${name}" → adapter ${adapterId} (disabled; enable to connect)`);
    return { ok: true, enabled: true, adapterId, healthId };
  } catch (err) {
    return { ok: false, enabled: true, message: (err as Error)?.message || String(err) };
  }
}
