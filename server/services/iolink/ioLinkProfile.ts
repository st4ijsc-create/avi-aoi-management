/**
 * doc 40 (MTX-06) — IO-LINK MASTER data-map profiles (process-data coverage).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A DATA-ONLY port→tag map for common IO-Link masters (ifm / Balluff / Turck),
 * expressed as the platform's `OtTagAddress[]` so an IO-Link master is polled by an
 * EXISTING OT driver — NO new driver, NO new dependency. Mirrors the shape of
 * energyMeterTemplate.ts (which does the same for Modbus power/energy meters).
 *
 * IO-Link masters do NOT speak IO-Link on the wire to the controller: they expose the
 * 8 ports' process data over a fieldbus / IT protocol. The two paths we reuse:
 *
 *   (a) OPC-UA  — most masters embed an OPC-UA server. Each port's Process-Data-In is
 *       an OPC-UA node; we address it with an OPC-UA nodeId and let the EXISTING
 *       opcuaDriver (server/services/ot/drivers/opcuaDriver.ts) poll it. FULLY WIRED.
 *
 *   (b) HTTP/REST (ifm moneo / IoT-core, Balluff/Turck web-API) — each port's PDIn is
 *       a JSON endpoint/path. There is NO HTTP OtDriver registered today, so the HTTP
 *       plan is a DESCRIPTOR/seam only: it carries the REST paths so a future HTTP
 *       poller (or an external gateway that re-emits onto telemetryBus) can consume it.
 *       Marked in the plan so nobody mistakes it for a live wire.
 *
 * Wiring (OPC-UA path):
 *   device_adapters(protocol='opcua', endpoint=opc.tcp://master:4840)
 *        ──poll──▶ opcuaDriver.readTags(port tags)
 *        ──emit OtSample(tagKey)──▶ ot_telemetry(metric = tagKey)
 *   i.e. registering an IO-Link master with this profile + a per-port config is enough
 *   for each sensor's value to land in telemetry under the tagKey you choose per port.
 *
 * ⚠️⚠️ HONESTY CAVEAT — VALIDATE AGAINST THE VENDOR / IODD DOCS ⚠️⚠️
 *   The OPC-UA nodeId templates and REST paths below are PLAUSIBLE conventions
 *   assembled WITHOUT the proprietary per-model OPC-UA address-space / IoT-core API
 *   documents, and the per-sensor scale/unit depends entirely on the connected device's
 *   IODD. They MUST be verified against the master's published address space and each
 *   sensor's IODD before trusting readings on real hardware — hence
 *   `validationStatus: "assumed"`. They are collected in one editable table so a real
 *   deployment fixes them in a single place.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { OtTagAddress, OtDataType } from "../ot/otDriver";
import { parseOpcuaAddress } from "../ot/drivers/opcuaAddress";

/** Transport used to reach the IO-Link master's process data. */
export type IoLinkProtocol = "opcua" | "http";

/** How well the address map is validated against the vendor / IODD documents. */
export type IoLinkValidation = "spec-verified" | "assumed";

/** Max IO-Link ports a standard master exposes. */
export const IO_LINK_MAX_PORTS = 8;

/**
 * A named IO-Link master profile: connection defaults + the per-port address
 * TEMPLATES. `{port}` is substituted with the 1-based port index at plan build time.
 * The concrete tagKey/unit/scale/dataType per port come from the deployment's
 * `IoLinkPortConfig[]` (they depend on the sensor's IODD, not the master).
 */
export interface IoLinkMasterProfile {
  /** Stable profile id (used to attach to a device_adapter). */
  id: string;
  vendor: string;
  model: string;
  /** Number of IO-Link ports (typically 8). */
  portCount: number;
  /** Honest validation status of the address templates. */
  validationStatus: IoLinkValidation;
  /** Default OPC-UA server TCP port on the master (4840 by IEC-62541 default). */
  defaultOpcuaPort: number;
  /** Default HTTP/REST port on the master (80). */
  defaultHttpPort: number;
  /**
   * OPC-UA nodeId template for a port's Process-Data-In, `{port}` = 1..portCount.
   * Must resolve to a nodeId that `parseOpcuaAddress` accepts.
   */
  opcuaNodeIdTemplate: string;
  /** REST/JSON path template for a port's Process-Data-In, `{port}` = 1..portCount. */
  httpPathTemplate: string;
  /** Free-form note (e.g. which vendor doc to verify against). */
  note?: string;
}

/**
 * One deployed port's mapping: which physical port, and how to interpret its sensor.
 * `tagKey` is the canonical telemetry metric the port's value is emitted under
 * (e.g. "pressure_bar", "temperature", "distance_mm") — it flows OtSample.tagKey →
 * ot_telemetry.metric. dataType/scale/unit come from the connected device's IODD.
 */
export interface IoLinkPortConfig {
  /** 1-based IO-Link port index (1..profile.portCount). */
  port: number;
  /** Canonical metric name emitted for this port (== OtTagAddress.tagKey). */
  tagKey: string;
  /** float (analog process value) by default; bool for a switching signal, etc. */
  dataType?: OtDataType;
  /** Multiply raw process value by `scale` to get engineering units (per IODD). */
  scale?: number;
  /** Engineering unit (bar / degC / mm / …). */
  unit?: string;
  /** Human label for UI. */
  label?: string;
  /** IODD device reference (vendorId/deviceId) if known — pure documentation. */
  iodd?: string;
}

// ── Profiles (ASSUMED address templates — verify vs the vendor address space) ─────

/**
 * ifm AL1350 — 8-port IO-Link master (PROFINET/EtherNet-IP + ifm IoT-core REST + an
 * OPC-UA server). IoT-core addresses process data as `iolinkmaster/port[N]/iolinkdevice/
 * pdin`; the OPC-UA nodeId below mirrors that path. Verify vs the AL1350 OPC-UA address
 * space + IoT-core API doc.
 */
const IFM_AL1350: IoLinkMasterProfile = {
  id: "ifm-al1350",
  vendor: "ifm",
  model: "AL1350",
  portCount: 8,
  validationStatus: "assumed",
  defaultOpcuaPort: 4840,
  defaultHttpPort: 80,
  opcuaNodeIdTemplate: "ns=1;s=iolinkmaster/port[{port}]/iolinkdevice/pdin",
  httpPathTemplate: "/iolinkmaster/port[{port}]/iolinkdevice/pdin/getdata",
  note: "Verify OPC-UA namespace + node path vs the ifm AL1350 address space / IoT-core API. Per-port scale/unit come from each sensor's IODD.",
};

/**
 * Balluff BNI (BNI0086-class 8-port IO-Link master with the Balluff web-server / REST
 * JSON API and an OPC-UA server). NodeId + path are the assumed Balluff convention —
 * confirm against the BNI OPC-UA / REST manual.
 */
const BALLUFF_BNI: IoLinkMasterProfile = {
  id: "balluff-bni",
  vendor: "Balluff",
  model: "BNI (8-port IO-Link master)",
  portCount: 8,
  validationStatus: "assumed",
  defaultOpcuaPort: 4840,
  defaultHttpPort: 80,
  opcuaNodeIdTemplate: "ns=2;s=IO-Link.Port{port}.PDIn",
  httpPathTemplate: "/rest/iolink/port/{port}/pdin",
  note: "Verify OPC-UA nodeId + REST path vs the Balluff BNI OPC-UA / web-API manual. Per-port scale/unit come from each sensor's IODD.",
};

/**
 * Turck TBEN-L IO-Link master (multiprotocol block I/O with 8 IO-Link channels, OPC-UA
 * server + REST API). Assumed address convention — confirm vs the TBEN-L manual.
 */
const TURCK_TBEN_L: IoLinkMasterProfile = {
  id: "turck-tben-l",
  vendor: "Turck",
  model: "TBEN-L (IO-Link master)",
  portCount: 8,
  validationStatus: "assumed",
  defaultOpcuaPort: 4840,
  defaultHttpPort: 80,
  opcuaNodeIdTemplate: "ns=1;s=TBEN.IOL.Port{port}.ProcessDataIn",
  httpPathTemplate: "/iolink/port/{port}/pdin",
  note: "Verify OPC-UA nodeId + REST path vs the Turck TBEN-L manual. Per-port scale/unit come from each sensor's IODD.",
};

const PROFILES: Record<string, IoLinkMasterProfile> = {
  [IFM_AL1350.id]: IFM_AL1350,
  [BALLUFF_BNI.id]: BALLUFF_BNI,
  [TURCK_TBEN_L.id]: TURCK_TBEN_L,
};

/** All profiles (read-only view for a picker UI). */
export function listIoLinkMasterProfiles(): IoLinkMasterProfile[] {
  return Object.values(PROFILES).map((p) => ({ ...p }));
}

/** One profile by id, or undefined. */
export function getIoLinkMasterProfile(id: string): IoLinkMasterProfile | undefined {
  const p = PROFILES[id];
  return p ? { ...p } : undefined;
}

/**
 * Resolve a port's device address for the given transport by substituting `{port}`
 * into the profile template. For OPC-UA the result is additionally validated to be a
 * legal nodeId (throws otherwise — fail-loud on a bad template).
 */
export function resolvePortAddress(
  profile: IoLinkMasterProfile,
  port: number,
  protocol: IoLinkProtocol,
): string {
  assertValidPort(profile, port);
  const template = protocol === "opcua" ? profile.opcuaNodeIdTemplate : profile.httpPathTemplate;
  const address = template.replace(/\{port\}/g, String(port));
  if (protocol === "opcua") {
    // Fail loud if the template produced an unparseable nodeId.
    parseOpcuaAddress(address);
  }
  return address;
}

function assertValidPort(profile: IoLinkMasterProfile, port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > profile.portCount) {
    throw new Error(
      `IO-Link port out of range for ${profile.id}: ${port} (expected 1..${profile.portCount})`,
    );
  }
}

/**
 * Convert a set of port configs into `OtTagAddress[]` for the chosen transport.
 * `tagKey === IoLinkPortConfig.tagKey` so emitted samples carry the metric name you
 * chose per port. Validates port range + uniqueness (fail-loud). Throws for an unknown
 * profile id.
 */
export function toOtTagAddresses(
  profileOrId: IoLinkMasterProfile | string,
  protocol: IoLinkProtocol,
  ports: IoLinkPortConfig[],
): OtTagAddress[] {
  const profile = typeof profileOrId === "string" ? getIoLinkMasterProfile(profileOrId) : profileOrId;
  if (!profile) throw new Error(`unknown IO-Link master profile: ${String(profileOrId)}`);

  const seen = new Set<number>();
  return ports.map((pc) => {
    assertValidPort(profile, pc.port);
    if (seen.has(pc.port)) throw new Error(`duplicate IO-Link port ${pc.port} for ${profile.id}`);
    seen.add(pc.port);
    const address = resolvePortAddress(profile, pc.port, protocol);
    return {
      tagKey: pc.tagKey,
      address,
      dataType: pc.dataType ?? "float",
      ...(pc.scale != null ? { scale: pc.scale } : {}),
      unit: pc.unit ?? "",
    } as OtTagAddress;
  });
}

/**
 * Describe the `device_adapters` + `device_tags` rows to create for an IO-Link master,
 * WITHOUT touching the DB (pure). The caller (an admin router / seed script) inserts
 * these with its own db handle.
 *
 * - protocol='opcua' → adapter.protocol='opcua' → reuses the EXISTING opcuaDriver (live).
 * - protocol='http'  → adapter.protocol='http'; `httpDriverAvailable:false` flags that
 *   NO HTTP OtDriver is registered yet, so this plan is a REST descriptor/seam only.
 */
export interface IoLinkAdapterPlan {
  adapter: {
    protocol: IoLinkProtocol;
    endpoint: string; // opc.tcp://host:port  |  http://host:port
    /** Marks the adapter as an IO-Link master for discovery/UI. */
    kind: "iolink_master";
    profileId: string;
    portCount: number;
    validationStatus: IoLinkValidation;
    /** false for protocol='http' — no HTTP OtDriver is registered yet (seam). */
    httpDriverAvailable: boolean;
  };
  tags: OtTagAddress[];
}

/**
 * Build an adapter+tags plan for an IO-Link master at `host` using `profileId`,
 * transport `protocol`, and the deployment's per-port config.
 */
export function buildIoLinkAdapterPlan(
  profileId: string,
  protocol: IoLinkProtocol,
  ports: IoLinkPortConfig[],
  opts?: { host?: string; port?: number },
): IoLinkAdapterPlan {
  const profile = getIoLinkMasterProfile(profileId);
  if (!profile) throw new Error(`unknown IO-Link master profile: ${profileId}`);
  if (!ports.length) throw new Error(`IO-Link plan needs at least one port config for ${profileId}`);

  const host = opts?.host ?? "iolink-master";
  const tags = toOtTagAddresses(profile, protocol, ports);

  if (protocol === "opcua") {
    const port = opts?.port ?? profile.defaultOpcuaPort;
    return {
      adapter: {
        protocol: "opcua",
        endpoint: `opc.tcp://${host}:${port}`,
        kind: "iolink_master",
        profileId: profile.id,
        portCount: profile.portCount,
        validationStatus: profile.validationStatus,
        httpDriverAvailable: true, // opcuaDriver is registered
      },
      tags,
    };
  }

  const port = opts?.port ?? profile.defaultHttpPort;
  return {
    adapter: {
      protocol: "http",
      endpoint: `http://${host}:${port}`,
      kind: "iolink_master",
      profileId: profile.id,
      portCount: profile.portCount,
      validationStatus: profile.validationStatus,
      httpDriverAvailable: false, // no HTTP OtDriver — REST descriptor/seam only
    },
    tags,
  };
}
