/**
 * doc 24 Wave-3 T3 — DTDL-inspired TWIN SCHEMA layer (typed, queryable twin graph).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A standardized, QUERYABLE model layer over the bespoke scene-graph (sceneGraph.ts).
 * The scene-graph stays the source of truth for HIERARCHY + live status; this module
 * projects it into a DTDL-v3-shaped twin model:
 *
 *   • Interface    — a typed model (@id DTMI / @type Interface / @context) per node
 *                    kind (Factory / Zone / Line / Station / Device / Robot), plus two
 *                    component interfaces (Nameplate / Kinematics).
 *   • Property     — static config + last-known snapshot (code/name/state/modelUri…).
 *   • Telemetry    — the streamed channels, SOURCED FROM the capability model
 *                    (capabilityModel.getCapabilitiesForMachine) so a twin declares the
 *                    same {yield, ng_count, pose, joint_states…} the equipment publishes.
 *   • Relationship — contains (hierarchy) / feeds (process flow, station→station) /
 *                    adjacent (spatial, zone→zone). Best-effort, ordering-derived.
 *   • Component    — Nameplate on every device; Kinematics on robots (joints).
 *
 * VALUE-ADD (the reason to have a schema layer over the raw graph): a small QUERY API —
 * get a twin by id, find twins by type, list a twin's relationships, resolve related
 * twins. See `TwinModelGraph`.
 *
 * PURITY: `sceneGraphToTwinModels(graph, opts)` is PURE + DB-free (unit-testable). The
 * DB-bound convenience `buildFactoryTwinModels(factoryId)` lazily builds the scene-graph
 * and resolves each machine's equipmentClass so telemetry channels are real per class.
 *
 * SELF-CONTAINED: no Azure/DTDL SDK dependency — the DTDL shapes are plain TS types.
 * Additive + backward-compatible: the scene-graph is unchanged. Degrade-safe: an empty
 * scene-graph yields an empty (but valid) twin graph, never a throw.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SceneGraph, DeviceNode, NormalizedState } from "./sceneGraph";
import type { CapabilityDataType, TelemetryDescriptor } from "../equipment/capabilityModel";
import { getCapabilitiesForMachine } from "../equipment/capabilityModel";

// ── DTDL v3 metamodel shapes (self-contained, no Azure dep) ──────────────────

/** The DTDL v3 context every Interface declares. */
export const DTDL_CONTEXT = "dtmi:dtdl:context;3" as const;

/** DTDL primitive schema types we emit (+ "object" marker for JSON payloads). */
export type DtdlSchema =
  | "boolean"
  | "date"
  | "dateTime"
  | "double"
  | "duration"
  | "float"
  | "integer"
  | "long"
  | "string"
  | "time"
  | "object";

export interface DtdlProperty {
  "@type": "Property";
  name: string;
  schema: DtdlSchema;
  displayName?: string;
  writable?: boolean;
  unit?: string;
}
export interface DtdlTelemetry {
  "@type": "Telemetry";
  name: string;
  schema: DtdlSchema;
  displayName?: string;
  unit?: string;
}
export interface DtdlRelationship {
  "@type": "Relationship";
  name: TwinRelationshipName;
  displayName?: string;
  /** DTMI of the target Interface (optional in DTDL — untargeted allowed). */
  target?: string;
  minMultiplicity?: number;
  maxMultiplicity?: number;
}
export interface DtdlComponent {
  "@type": "Component";
  name: string;
  /** DTMI of the component's Interface. */
  schema: string;
}
export type DtdlContent = DtdlProperty | DtdlTelemetry | DtdlRelationship | DtdlComponent;

/** A DTDL v3 Interface (a typed model). */
export interface DtdlInterface {
  "@context": typeof DTDL_CONTEXT;
  "@id": string; // DTMI
  "@type": "Interface";
  displayName: string;
  extends?: string[];
  contents: DtdlContent[];
}

// ── Twin instance ("digital twin") shapes ────────────────────────────────────

export type TwinNodeType = "Factory" | "Zone" | "Line" | "Station" | "Device" | "Robot";
export type TwinRelationshipName = "contains" | "feeds" | "adjacent";

/** One resolved telemetry channel on a twin instance (from the capability model). */
export interface TwinTelemetryChannel {
  name: string;
  displayName: string;
  schema: DtdlSchema;
  unit?: string;
}

/** One relationship edge from a twin instance. */
export interface TwinRelationship {
  name: TwinRelationshipName;
  /** $dtId of the target twin. */
  target: string;
}

interface TwinBase {
  /** Stable twin id — equals the scene-graph node id (e.g. "machine:12", "zone:7"). */
  $dtId: string;
  /** DTDL instance metadata: which Interface this twin conforms to. */
  $metadata: { $model: string };
  type: TwinNodeType;
  displayName: string;
  /** The scene-graph node id this twin is projected from (== $dtId). */
  sourceId: string;
  refId: number;
  /** Static config + last-known snapshot values. */
  properties: Record<string, unknown>;
  /** Streamed channel definitions (from the capability model on devices). */
  telemetry: TwinTelemetryChannel[];
  /** DTDL Components (sub-part instances). */
  components: Record<string, Record<string, unknown>>;
  /** Outgoing relationship edges. */
  relationships: TwinRelationship[];
}

export interface FactoryTwin extends TwinBase {
  type: "Factory";
  properties: { code: string; name: string };
}
export interface ZoneTwin extends TwinBase {
  type: "Zone";
  properties: { code: string; name: string; zoneType: string; maxConcurrentRobots: number };
}
export interface LineTwin extends TwinBase {
  type: "Line";
  properties: { code: string; name: string; workshopId: number };
}
export interface StationTwin extends TwinBase {
  type: "Station";
  properties: { code: string; name: string; lineId: number };
}
export interface DeviceTwin extends TwinBase {
  type: "Device";
  kind: "machine" | "robot";
  properties: {
    code: string;
    name: string;
    kind: string;
    stationId: number | null;
    state: NormalizedState;
    modelUri: string | null;
    modelKind: string | null;
    equipmentClass: string | null;
    adapterKind: string | null;
  };
}
export interface RobotTwin extends TwinBase {
  type: "Robot";
  kind: "robot";
  properties: DeviceTwin["properties"] & {
    kinematicModelId: string | null;
    jointCount: number;
  };
}

export type AnyTwin = FactoryTwin | ZoneTwin | LineTwin | StationTwin | DeviceTwin | RobotTwin;

// ── DTMI ids for the fixed metamodel interfaces ──────────────────────────────

const DTMI = {
  Factory: "dtmi:st4i:twin:Factory;1",
  Zone: "dtmi:st4i:twin:Zone;1",
  Line: "dtmi:st4i:twin:Line;1",
  Station: "dtmi:st4i:twin:Station;1",
  Device: "dtmi:st4i:twin:Device;1",
  Robot: "dtmi:st4i:twin:Robot;1",
  Nameplate: "dtmi:st4i:twin:Nameplate;1",
  Kinematics: "dtmi:st4i:twin:Kinematics;1",
} as const;

/** Map a node type → its Interface DTMI ($metadata.$model). */
function modelIdForType(type: TwinNodeType): string {
  return type === "Robot" ? DTMI.Robot : DTMI[type];
}

/** Capability data type → DTDL schema (json/enum degrade to object/string). */
function toDtdlSchema(t: CapabilityDataType): DtdlSchema {
  switch (t) {
    case "bool":
      return "boolean";
    case "int":
      return "integer";
    case "float":
      return "double";
    case "json":
      return "object";
    case "enum":
      return "string";
    case "string":
    default:
      return "string";
  }
}

function telemetryChannel(t: TelemetryDescriptor): TwinTelemetryChannel {
  return { name: t.key, displayName: t.label, schema: toDtdlSchema(t.dataType), ...(t.unit ? { unit: t.unit } : {}) };
}

// ── The fixed DTDL metamodel (interface definitions) ─────────────────────────

const P = (name: string, schema: DtdlSchema, displayName?: string, writable = false, unit?: string): DtdlProperty => ({
  "@type": "Property",
  name,
  schema,
  ...(displayName ? { displayName } : {}),
  writable,
  ...(unit ? { unit } : {}),
});
const R = (name: TwinRelationshipName, target?: string, displayName?: string): DtdlRelationship => ({
  "@type": "Relationship",
  name,
  ...(displayName ? { displayName } : {}),
  ...(target ? { target } : {}),
});
const C = (name: string, schema: string): DtdlComponent => ({ "@type": "Component", name, schema });

/** The Nameplate component interface (every device carries one). */
const IFACE_NAMEPLATE: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Nameplate,
  "@type": "Interface",
  displayName: "Nameplate",
  contents: [P("code", "string", "Code"), P("name", "string", "Name"), P("kind", "string", "Kind")],
};

/** The Kinematics component interface (robots carry one). */
const IFACE_KINEMATICS: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Kinematics,
  "@type": "Interface",
  displayName: "Kinematics",
  contents: [
    P("kinematicModelId", "string", "Kinematic model id"),
    P("jointCount", "integer", "Joint count"),
    P("joints", "object", "Latest joint vector"),
  ],
};

const IFACE_FACTORY: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Factory,
  "@type": "Interface",
  displayName: "Factory",
  contents: [P("code", "string", "Code"), P("name", "string", "Name"), R("contains", undefined, "Contains")],
};
const IFACE_ZONE: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Zone,
  "@type": "Interface",
  displayName: "Zone",
  contents: [
    P("code", "string", "Code"),
    P("name", "string", "Name"),
    P("zoneType", "string", "Zone type"),
    P("maxConcurrentRobots", "integer", "Max concurrent robots"),
    R("adjacent", DTMI.Zone, "Adjacent zone"),
  ],
};
const IFACE_LINE: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Line,
  "@type": "Interface",
  displayName: "Line",
  contents: [P("code", "string", "Code"), P("name", "string", "Name"), R("contains", DTMI.Station, "Contains station")],
};
const IFACE_STATION: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Station,
  "@type": "Interface",
  displayName: "Station",
  contents: [
    P("code", "string", "Code"),
    P("name", "string", "Name"),
    R("contains", DTMI.Device, "Contains device"),
    R("feeds", DTMI.Station, "Feeds downstream station"),
  ],
};
const IFACE_DEVICE: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Device,
  "@type": "Interface",
  displayName: "Device",
  contents: [
    P("code", "string", "Code"),
    P("name", "string", "Name"),
    P("kind", "string", "Kind"),
    P("state", "string", "Normalized PackML state"),
    P("modelUri", "string", "3D model URI"),
    P("equipmentClass", "string", "Equipment class"),
    P("adapterKind", "string", "Adapter kind"),
    C("nameplate", DTMI.Nameplate),
  ],
};
const IFACE_ROBOT: DtdlInterface = {
  "@context": DTDL_CONTEXT,
  "@id": DTMI.Robot,
  "@type": "Interface",
  displayName: "Robot",
  extends: [DTMI.Device],
  contents: [
    P("kinematicModelId", "string", "Kinematic model id"),
    P("jointCount", "integer", "Joint count"),
    C("kinematics", DTMI.Kinematics),
  ],
};

/** The full fixed DTDL metamodel (interface definitions), in dependency order. */
export const DTDL_INTERFACES: DtdlInterface[] = [
  IFACE_NAMEPLATE,
  IFACE_KINEMATICS,
  IFACE_FACTORY,
  IFACE_ZONE,
  IFACE_LINE,
  IFACE_STATION,
  IFACE_DEVICE,
  IFACE_ROBOT,
];

// ── The queryable twin graph ─────────────────────────────────────────────────

/**
 * A typed, queryable projection of a scene-graph into DTDL twins. The value-add over
 * the raw scene-graph: a small query API (getById / getByType / getRelationships /
 * getRelated). Immutable snapshot — rebuild from a fresh scene-graph to refresh.
 */
export class TwinModelGraph {
  readonly interfaces: DtdlInterface[];
  readonly twins: AnyTwin[];
  private readonly byId = new Map<string, AnyTwin>();

  constructor(twins: AnyTwin[], interfaces: DtdlInterface[] = DTDL_INTERFACES) {
    this.twins = twins;
    this.interfaces = interfaces;
    for (const t of twins) this.byId.set(t.$dtId, t);
  }

  /** Total twin count. */
  get size(): number {
    return this.twins.length;
  }

  /** Get a twin by its $dtId (== scene-graph node id, e.g. "machine:12"). */
  getById(dtId: string): AnyTwin | undefined {
    return this.byId.get(dtId);
  }

  /** All twins of a given node type. */
  getByType(type: TwinNodeType): AnyTwin[] {
    return this.twins.filter((t) => t.type === type);
  }

  /** Every device twin (machines: type "Device" + robots: type "Robot"). */
  getAllDevices(): Array<DeviceTwin | RobotTwin> {
    return this.twins.filter((t): t is DeviceTwin | RobotTwin => t.type === "Device" || t.type === "Robot");
  }

  /** The outgoing relationships of a twin (optionally filtered by name). */
  getRelationships(fromDtId: string, name?: TwinRelationshipName): TwinRelationship[] {
    const t = this.byId.get(fromDtId);
    if (!t) return [];
    return name ? t.relationships.filter((r) => r.name === name) : t.relationships;
  }

  /** Resolve the target twins reachable from a twin via its relationships. */
  getRelated(fromDtId: string, name?: TwinRelationshipName): AnyTwin[] {
    const out: AnyTwin[] = [];
    for (const r of this.getRelationships(fromDtId, name)) {
      const target = this.byId.get(r.target);
      if (target) out.push(target);
    }
    return out;
  }

  /** Convenience: the children of a twin (its `contains` targets). */
  getChildren(fromDtId: string): AnyTwin[] {
    return this.getRelated(fromDtId, "contains");
  }

  /** The DTDL model document (array of Interfaces) for export/registration. */
  toDtdlDocument(): DtdlInterface[] {
    return this.interfaces;
  }
}

/** Options for the pure projection. */
export interface TwinModelOptions {
  /**
   * Resolve a device's equipmentClass (machineType) so its telemetry channels come from
   * the capability model. Defaults: robots → "ROBOT"; machines → null (→ the capability
   * model's minimal read-only fallback: a single `state` channel). The DB-bound
   * `buildFactoryTwinModels` supplies real machineTypes so machine telemetry is rich.
   */
  equipmentClassOf?: (device: DeviceNode) => string | null | undefined;
}

/** Default class resolver: robots → ROBOT; machines → null (minimal telemetry). */
function defaultEquipmentClassOf(device: DeviceNode): string | null {
  return device.kind === "robot" ? "ROBOT" : null;
}

/** Resolve the telemetry channels for a device from the capability model. */
function telemetryFor(device: DeviceNode, equipmentClass: string | null): { channels: TwinTelemetryChannel[]; adapterKind: string } {
  // getCapabilitiesForMachine is fail-safe: a null/unknown class → a minimal read-only
  // profile (a single `state` channel), never a throw.
  const cap = getCapabilitiesForMachine(equipmentClass ?? undefined);
  return { channels: cap.telemetryTags.map(telemetryChannel), adapterKind: cap.adapterKind };
}

/**
 * PURE — project a scene-graph into a typed, queryable DTDL twin graph. DB-free.
 * Degrade-safe: a null-factory / empty scene-graph → an empty TwinModelGraph.
 */
export function sceneGraphToTwinModels(graph: SceneGraph, opts?: TwinModelOptions): TwinModelGraph {
  const classOf = opts?.equipmentClassOf ?? defaultEquipmentClassOf;
  const twins: AnyTwin[] = [];

  if (!graph.factory) return new TwinModelGraph(twins);

  // Factory (contains zones + lines).
  const factoryTwin: FactoryTwin = {
    $dtId: `factory:${graph.factory.id}`,
    $metadata: { $model: DTMI.Factory },
    type: "Factory",
    displayName: graph.factory.name,
    sourceId: `factory:${graph.factory.id}`,
    refId: graph.factory.id,
    properties: { code: graph.factory.code, name: graph.factory.name },
    telemetry: [],
    components: {},
    relationships: [
      ...graph.zones.map((z) => ({ name: "contains" as const, target: z.id })),
      ...graph.lines.map((l) => ({ name: "contains" as const, target: l.id })),
    ],
  };
  twins.push(factoryTwin);

  // Zones (adjacent to the next zone by order — spatial approximation).
  graph.zones.forEach((z, i) => {
    const next = graph.zones[i + 1];
    twins.push({
      $dtId: z.id,
      $metadata: { $model: DTMI.Zone },
      type: "Zone",
      displayName: z.name,
      sourceId: z.id,
      refId: z.refId,
      properties: { code: z.code, name: z.name, zoneType: z.zoneType, maxConcurrentRobots: z.maxConcurrentRobots },
      telemetry: [],
      components: {},
      relationships: next ? [{ name: "adjacent", target: next.id }] : [],
    });
  });

  // Devices — indexed by scene-graph id for station-child lookup.
  const deviceById = new Map<string, DeviceNode>();
  for (const d of graph.devices) deviceById.set(d.id, d);

  // Lines → Stations → Devices.
  for (const line of graph.lines) {
    twins.push({
      $dtId: line.id,
      $metadata: { $model: DTMI.Line },
      type: "Line",
      displayName: line.name,
      sourceId: line.id,
      refId: line.refId,
      properties: { code: line.code, name: line.name, workshopId: line.workshopId },
      telemetry: [],
      components: {},
      relationships: line.stations.map((s) => ({ name: "contains" as const, target: s.id })),
    });

    line.stations.forEach((station, i) => {
      const downstream = line.stations[i + 1];
      const rels: TwinRelationship[] = station.devices.map((d) => ({ name: "contains" as const, target: d.id }));
      if (downstream) rels.push({ name: "feeds", target: downstream.id });
      twins.push({
        $dtId: station.id,
        $metadata: { $model: DTMI.Station },
        type: "Station",
        displayName: station.name,
        sourceId: station.id,
        refId: station.refId,
        properties: { code: station.code, name: station.name, lineId: station.lineId },
        telemetry: [],
        components: {},
        relationships: rels,
      });
    });
  }

  // Device twins (machines → Device; robots → Robot). Every scene device becomes one
  // twin exactly once (nested or not) so counts round-trip.
  for (const d of graph.devices) {
    const equipmentClass = classOf(d) ?? null;
    const { channels, adapterKind } = telemetryFor(d, equipmentClass);
    const baseProps = {
      code: d.code,
      name: d.name,
      kind: d.kind,
      stationId: d.stationId,
      state: d.state,
      modelUri: d.modelUri,
      modelKind: d.modelKind,
      equipmentClass,
      adapterKind,
    };
    const nameplate = { code: d.code, name: d.name, kind: d.kind };

    if (d.kind === "robot") {
      const jointCount = d.joints?.length ?? 0;
      const robot: RobotTwin = {
        $dtId: d.id,
        $metadata: { $model: DTMI.Robot },
        type: "Robot",
        kind: "robot",
        displayName: d.name,
        sourceId: d.id,
        refId: d.refId,
        properties: { ...baseProps, kinematicModelId: d.kinematicModelId, jointCount },
        telemetry: channels,
        components: {
          nameplate,
          kinematics: { kinematicModelId: d.kinematicModelId, jointCount, joints: d.joints ?? null },
        },
        relationships: [],
      };
      twins.push(robot);
    } else {
      const device: DeviceTwin = {
        $dtId: d.id,
        $metadata: { $model: DTMI.Device },
        type: "Device",
        kind: "machine",
        displayName: d.name,
        sourceId: d.id,
        refId: d.refId,
        properties: baseProps,
        telemetry: channels,
        components: { nameplate },
        relationships: [],
      };
      twins.push(device);
    }
  }

  return new TwinModelGraph(twins);
}

/**
 * DB-bound convenience — build the twin graph for a factory. Lazily builds the
 * scene-graph (buildSceneGraph) and resolves each machine's equipmentClass from the
 * `machines` table so telemetry channels are the real per-class capability channels.
 * Read-only. Degrade-safe: no DB / no factory → an empty twin graph.
 */
export async function buildFactoryTwinModels(factoryId: number): Promise<TwinModelGraph> {
  const { buildSceneGraph } = await import("./sceneGraph");
  const graph = await buildSceneGraph(factoryId);

  // Resolve machineType per machine device so machine telemetry is real (AOI → yield…).
  const classById = new Map<string, string>();
  try {
    const machineIds = graph.devices.filter((d) => d.kind === "machine").map((d) => d.refId);
    if (machineIds.length) {
      const { getDb } = await import("../../db/connection");
      const db = await getDb();
      if (db) {
        const { machines } = await import("../../../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const rows = await db
          .select({ id: machines.id, machineType: machines.machineType })
          .from(machines)
          .where(inArray(machines.id, machineIds));
        for (const r of rows) if (r.machineType != null) classById.set(`machine:${r.id}`, String(r.machineType));
      }
    }
  } catch {
    // Best-effort: any failure just leaves machine telemetry at the minimal fallback.
  }

  return sceneGraphToTwinModels(graph, {
    equipmentClassOf: (d) => (d.kind === "robot" ? "ROBOT" : classById.get(d.id) ?? null),
  });
}
