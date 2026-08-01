/**
 * doc 24 Wave-3 T3 — DTDL twin-schema + USDA-export tests.
 *
 * PURE + DB-free (no drizzle/db mock needed): we drive `assembleSceneGraph` (pure) and
 * hand-built SceneGraph fixtures through `sceneGraphToTwinModels` / `sceneGraphToUsda`.
 *
 * Coverage:
 *   (a) scene-graph → twin models: typed interfaces + relationships + telemetry-from-
 *       capability (machine class AOI → yield/ng…; robot → pose/joints/battery…).
 *   (b) the query API (getById / getByType / getRelationships / getRelated / children).
 *   (c) USDA export: structurally valid (balanced braces, #usda header, xformOpOrder),
 *       references for devices with a modelUri, robot joint xforms, placeholder cubes,
 *       and a round-trip of device count + hierarchy.
 *   (d) empty / degenerate scene-graph degrades safely (valid empty twin graph + stage).
 */
import { describe, it, expect } from "vitest";
import { assembleSceneGraph, type SceneGraph, type DeviceNode } from "./sceneGraph";
import {
  sceneGraphToTwinModels,
  DTDL_INTERFACES,
  DTDL_CONTEXT,
  type DeviceTwin,
  type RobotTwin,
} from "./twinSchema";
import { sceneGraphToUsda, usdSanitizeName } from "./usdExport";

// ── shared fixture (pure assembly) ───────────────────────────────────────────
function fixtureGraph(): SceneGraph {
  return assembleSceneGraph({
    factory: { id: 1, code: "F1", name: "Factory 1" },
    zones: [
      { id: 7, code: "Z7", name: "Cell A", zoneType: "production", maxConcurrentRobots: 2 },
      { id: 8, code: "Z8", name: "Cell B", zoneType: "buffer", maxConcurrentRobots: 1 },
    ],
    lines: [{ id: 2, code: "L2", name: "Line 2", workshopId: 9 }],
    stations: [
      { id: 5, code: "S5", name: "Station 5", lineId: 2 },
      { id: 6, code: "S6", name: "Station 6", lineId: 2 },
    ],
    machines: [{ id: 12, code: "M12", name: "AOI 12", stationId: 5, operationStatus: "running", modelUri: "m12.glb" }],
    robots: [{ id: 3, code: "R3", name: "Cobot 3", stationId: 6, status: "running", kind: "cobot", joints: [0, 1.5, -0.5, 0, 0, 0] }],
  });
}

/** class resolver: machine 12 → AOI, robots → ROBOT. */
const classOf = (d: DeviceNode) => (d.kind === "robot" ? "ROBOT" : d.id === "machine:12" ? "AOI" : null);

// ════════════════════════════════════════════════════════════════════════════
// (a) scene-graph → typed twin models + relationships + telemetry-from-capability
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToTwinModels — typed models + relationships + telemetry", () => {
  it("emits the DTDL metamodel interfaces with DTMI @id/@type/@context", () => {
    const g = sceneGraphToTwinModels(fixtureGraph(), { equipmentClassOf: classOf });
    const iface = g.toDtdlDocument();
    expect(iface.length).toBe(DTDL_INTERFACES.length);
    for (const i of iface) {
      expect(i["@context"]).toBe(DTDL_CONTEXT);
      expect(i["@type"]).toBe("Interface");
      expect(i["@id"]).toMatch(/^dtmi:st4i:twin:[A-Za-z]+;1$/);
    }
    const device = iface.find((i) => i["@id"] === "dtmi:st4i:twin:Device;1")!;
    // Device interface carries a Nameplate Component + config Properties.
    expect(device.contents.some((c) => c["@type"] === "Component" && c.name === "nameplate")).toBe(true);
    const robot = iface.find((i) => i["@id"] === "dtmi:st4i:twin:Robot;1")!;
    expect(robot.extends).toContain("dtmi:st4i:twin:Device;1");
  });

  it("projects factory/zone/line/station/device twins with the right relationships", () => {
    const g = sceneGraphToTwinModels(fixtureGraph(), { equipmentClassOf: classOf });

    // Factory contains both zones + the line.
    const factory = g.getById("factory:1")!;
    expect(factory.type).toBe("Factory");
    const factoryContains = factory.relationships.filter((r) => r.name === "contains").map((r) => r.target).sort();
    expect(factoryContains).toEqual(["line:2", "zone:7", "zone:8"]);

    // Zones: zone:7 adjacent zone:8 (ordering-derived).
    expect(g.getRelationships("zone:7", "adjacent").map((r) => r.target)).toEqual(["zone:8"]);

    // Line contains its two stations.
    expect(g.getRelationships("line:2", "contains").map((r) => r.target).sort()).toEqual(["station:5", "station:6"]);

    // Station 5 contains machine:12 AND feeds the downstream station:6.
    expect(g.getRelationships("station:5", "contains").map((r) => r.target)).toEqual(["machine:12"]);
    expect(g.getRelationships("station:5", "feeds").map((r) => r.target)).toEqual(["station:6"]);
    // Last station in the line has no feeds edge.
    expect(g.getRelationships("station:6", "feeds")).toHaveLength(0);
    expect(g.getRelationships("station:6", "contains").map((r) => r.target)).toEqual(["robot:3"]);
  });

  it("sources DEVICE telemetry channels from the equipment capability model", () => {
    const g = sceneGraphToTwinModels(fixtureGraph(), { equipmentClassOf: classOf });

    const machine = g.getById("machine:12") as DeviceTwin;
    expect(machine.type).toBe("Device");
    expect(machine.$metadata.$model).toBe("dtmi:st4i:twin:Device;1");
    expect(machine.properties.equipmentClass).toBe("AOI");
    expect(machine.properties.adapterKind).toBe("vision");
    // AOI capability telemetry: yield/ng_count/ok_count/cycle_time/state.
    const mKeys = machine.telemetry.map((t) => t.name).sort();
    expect(mKeys).toEqual(["cycle_time", "ng_count", "ok_count", "state", "yield"]);
    // schema mapping: yield (float → double), ng_count (int → integer).
    expect(machine.telemetry.find((t) => t.name === "yield")?.schema).toBe("double");
    expect(machine.telemetry.find((t) => t.name === "ng_count")?.schema).toBe("integer");
    // nameplate component present.
    expect(machine.components.nameplate).toEqual({ code: "M12", name: "AOI 12", kind: "machine" });

    const robot = g.getById("robot:3") as RobotTwin;
    expect(robot.type).toBe("Robot");
    expect(robot.$metadata.$model).toBe("dtmi:st4i:twin:Robot;1");
    const rKeys = robot.telemetry.map((t) => t.name);
    // ROBOT capability telemetry includes pose (json → object) + UDM joint/battery.
    expect(rKeys).toContain("pose");
    expect(rKeys).toContain("joint_states");
    expect(rKeys).toContain("battery_level");
    expect(robot.telemetry.find((t) => t.name === "pose")?.schema).toBe("object");
    // robot kinematics: joints carried on the Kinematics component + property.
    expect(robot.properties.jointCount).toBe(6);
    expect(robot.properties.kinematicModelId).toBe("sample-arm-6dof");
    expect(robot.components.kinematics.joints).toEqual([0, 1.5, -0.5, 0, 0, 0]);
  });

  it("degrades machine telemetry to the minimal capability profile when class is unknown", () => {
    // No class resolver → machines resolve to null → capability fallback (state only).
    const g = sceneGraphToTwinModels(fixtureGraph());
    const machine = g.getById("machine:12") as DeviceTwin;
    expect(machine.properties.equipmentClass).toBeNull();
    expect(machine.telemetry.map((t) => t.name)).toEqual(["state"]);
    // robots still default to ROBOT → rich telemetry.
    const robot = g.getById("robot:3") as RobotTwin;
    expect(robot.telemetry.map((t) => t.name)).toContain("pose");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) the query API
// ════════════════════════════════════════════════════════════════════════════
describe("TwinModelGraph query API", () => {
  it("getById / getByType / getAllDevices resolve correctly", () => {
    const g = sceneGraphToTwinModels(fixtureGraph(), { equipmentClassOf: classOf });
    expect(g.getById("machine:12")?.type).toBe("Device");
    expect(g.getById("nope")).toBeUndefined();
    expect(g.getByType("Zone")).toHaveLength(2);
    expect(g.getByType("Device")).toHaveLength(1); // machines only
    expect(g.getByType("Robot")).toHaveLength(1);
    expect(g.getAllDevices().map((d) => d.$dtId).sort()).toEqual(["machine:12", "robot:3"]);
    expect(g.size).toBe(1 + 2 + 1 + 2 + 2); // factory + 2 zones + line + 2 stations + 2 devices
  });

  it("getRelated / getChildren resolve target twins", () => {
    const g = sceneGraphToTwinModels(fixtureGraph(), { equipmentClassOf: classOf });
    const factoryChildren = g.getChildren("factory:1").map((t) => t.$dtId).sort();
    expect(factoryChildren).toEqual(["line:2", "zone:7", "zone:8"]);
    const lineChildren = g.getRelated("line:2", "contains").map((t) => t.type);
    expect(lineChildren).toEqual(["Station", "Station"]);
    // dangling / unknown source → no relationships, no related.
    expect(g.getRelationships("ghost")).toEqual([]);
    expect(g.getRelated("ghost")).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (c) USDA export — structural validity + references + round-trip
// ════════════════════════════════════════════════════════════════════════════
/** Count non-overlapping occurrences of a substring. */
function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/** A richer hand-built graph: positions, an orphan device, a joint robot, a no-model device. */
function usdaFixture(): SceneGraph {
  const machine12: DeviceNode = {
    id: "machine:12", kind: "machine", refId: 12, code: "M12", name: "AOI 12", stationId: 5,
    state: "running", color: "#0f0", position: { x: 1, y: 2 }, bounds: null,
    modelUri: "m12.glb", modelKind: "gltf", activeTaskId: null, alarm: null, joints: null, kinematicModelId: null,
  };
  const robot3: DeviceNode = {
    id: "robot:3", kind: "robot", refId: 3, code: "R3", name: "Cobot 3", stationId: 5,
    state: "running", color: "#0f0", position: { x: 3, y: 4, z: 1 }, bounds: null,
    modelUri: null, modelKind: null, activeTaskId: null, alarm: null,
    joints: [0, Math.PI / 2], kinematicModelId: "sample-arm-6dof",
  };
  const orphan99: DeviceNode = {
    id: "machine:99", kind: "machine", refId: 99, code: "M99", name: "Loose 99", stationId: null,
    state: "idle", color: "#888", position: null, bounds: null,
    modelUri: null, modelKind: null, activeTaskId: null, alarm: null, joints: null, kinematicModelId: null,
  };
  return {
    factory: { id: 1, code: "F1", name: "Factory 1" },
    zones: [{ id: "zone:7", refId: 7, code: "Z7", name: "Cell A", zoneType: "production", maxConcurrentRobots: 2, bounds: null }],
    lines: [
      {
        id: "line:2", refId: 2, code: "L2", name: "Line 2", workshopId: 9,
        stations: [{ id: "station:5", refId: 5, code: "S5", name: "Station 5", lineId: 2, devices: [machine12, robot3] }],
      },
    ],
    devices: [machine12, robot3, orphan99],
    ts: 1234,
  };
}

describe("sceneGraphToUsda — structural validity + round-trip", () => {
  it("emits a well-formed USDA stage with balanced braces + header", () => {
    const usda = sceneGraphToUsda(usdaFixture());
    expect(usda.startsWith("#usda 1.0")).toBe(true);
    expect(usda).toContain(`defaultPrim = "factory_1"`);
    expect(usda).toContain(`upAxis = "Z"`);
    // balanced braces (well-formed def/scope nesting).
    expect(count(usda, "{")).toBe(count(usda, "}"));
    expect(count(usda, "{")).toBeGreaterThan(0);
  });

  it("mirrors the factory→line→station→device hierarchy as Xform prims", () => {
    const usda = sceneGraphToUsda(usdaFixture());
    expect(usda).toContain(`def Xform "factory_1"`);
    expect(usda).toContain(`def Scope "Lines"`);
    expect(usda).toContain(`def Xform "line_2"`);
    expect(usda).toContain(`def Xform "station_5"`);
    expect(usda).toContain(`def Scope "Zones"`);
    expect(usda).toContain(`def Xform "zone_7"`);
    // orphan device swept into UnassignedDevices.
    expect(usda).toContain(`def Scope "UnassignedDevices"`);
    expect(usda).toContain(`def Xform "machine_99"`);
  });

  it("round-trips the device count via st4i:deviceId provenance attrs", () => {
    const g = usdaFixture();
    const usda = sceneGraphToUsda(g);
    expect(count(usda, "custom string st4i:deviceId")).toBe(g.devices.length); // 3
  });

  it("emits xformOp:translate from layout coords + correct xformOpOrder", () => {
    const usda = sceneGraphToUsda(usdaFixture());
    expect(usda).toContain(`double3 xformOp:translate = (1, 2, 0)`); // machine:12
    expect(usda).toContain(`double3 xformOp:translate = (3, 4, 1)`); // robot:3
    expect(usda).toContain(`uniform token[] xformOpOrder = ["xformOp:translate"]`);
  });

  it("references the glTF asset for devices with a modelUri, placeholder cube otherwise", () => {
    const usda = sceneGraphToUsda(usdaFixture());
    // exactly one device (machine:12) has a modelUri → one reference.
    expect(count(usda, "references = @")).toBe(1);
    expect(usda).toContain(`references = @m12.glb@`);
    // robot:3 + machine:99 have no model → placeholder cubes (2).
    expect(count(usda, `def Cube "geo"`)).toBe(2);
  });

  it("emits a nested joint Xform chain for an articulated robot", () => {
    const usda = sceneGraphToUsda(usdaFixture());
    // robot:3 has 2 joints → Joint_0, Joint_1.
    expect(usda).toContain(`def Xform "Joint_0"`);
    expect(usda).toContain(`def Xform "Joint_1"`);
    expect(count(usda, `def Xform "Joint_`)).toBe(2);
    expect(usda).toContain(`double xformOp:rotateZ = 90`); // PI/2 rad → 90 deg
  });

  it("usdSanitizeName maps ids to valid USD identifiers", () => {
    expect(usdSanitizeName("machine:12")).toBe("machine_12");
    expect(usdSanitizeName("factory:1")).toBe("factory_1");
    expect(usdSanitizeName("7zone")).toBe("_7zone"); // leading digit prefixed
    expect(usdSanitizeName("")).toBe("_");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (d) empty / degenerate scene-graph degrades safely
// ════════════════════════════════════════════════════════════════════════════
describe("degrade-safe: empty / degenerate scene-graph", () => {
  const emptyGraph: SceneGraph = { factory: null, zones: [], lines: [], devices: [], ts: 0 };

  it("empty scene-graph → an empty (but valid) twin graph, metamodel still present", () => {
    const g = sceneGraphToTwinModels(emptyGraph);
    expect(g.size).toBe(0);
    expect(g.getByType("Factory")).toEqual([]);
    expect(g.getAllDevices()).toEqual([]);
    // The DTDL metamodel is still available for reference/export.
    expect(g.toDtdlDocument().length).toBe(DTDL_INTERFACES.length);
  });

  it("empty scene-graph → a valid empty USDA stage (no prims, no throw)", () => {
    const usda = sceneGraphToUsda(emptyGraph);
    expect(usda.startsWith("#usda 1.0")).toBe(true);
    expect(usda).toContain("empty stage");
    expect(count(usda, "{")).toBe(count(usda, "}")); // 0 == 0, balanced
    expect(count(usda, "def ")).toBe(0);
  });

  it("factory with no children → valid stage, zero devices", () => {
    const g: SceneGraph = { factory: { id: 4, code: "F4", name: "Empty F" }, zones: [], lines: [], devices: [], ts: 5 };
    const usda = sceneGraphToUsda(g);
    expect(usda).toContain(`def Xform "factory_4"`);
    expect(count(usda, "custom string st4i:deviceId")).toBe(0);
    expect(count(usda, "{")).toBe(count(usda, "}"));
    const models = sceneGraphToTwinModels(g);
    expect(models.getByType("Factory")).toHaveLength(1);
    expect(models.getAllDevices()).toHaveLength(0);
  });
});
