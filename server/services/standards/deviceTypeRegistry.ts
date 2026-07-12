/**
 * E1-a (doc 16 §10 / §15) — Versioned Device Type Hierarchy + Schema Registry.
 * Flag: EQ_GOVERN_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A GOVERNANCE / VERSIONING layer OVER the existing capability model — NOT a fork.
 * The registry's source-of-truth SEED is built from capabilityModel.ts (the 17
 * EquipmentClass DEFAULT_PROFILES) + packml.ts, arranged into an explicit multi-level
 * inheritance tree:
 *
 *     Equipment (base)
 *       ├── Robot                 (joint_states, tcp_pose, payload, reach, ...)
 *       │     └── CollaborativeRobot (force_limit_n, safety_rated_speed_mms, ...)
 *       ├── Inspection            (AOI, AVI, SPI, AXI, CMM)
 *       ├── TestCell              (ICT, FCT, ICT_FUNC)
 *       └── ProcessAutomation     (AUTOMATION, ASSEMBLY, FEEDER, SCREWDRIVE, ...)
 *
 * RESOLUTION (resolveType): walk parent→child, MERGE attributes/commands/states,
 * child OVERRIDES parent by name/key, and the `extension` object is PRESERVED+merged
 * at every level (vendor-specific never dropped). Pure + fail-safe — never throws.
 *
 * This module is PURE w.r.t. the outside world: the seed builder + resolver take no
 * DB. The DB-bound registry (list published rows, persist a published version) lives
 * in the router/governanceService which have db access. resolveType works on EITHER
 * an in-memory seed map OR a list of rows loaded from device_types.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  listDefaultProfiles,
  getDefaultCapability,
  type EquipmentClass,
  type CommandDescriptor,
  type TelemetryDescriptor,
  type EquipmentCapability,
} from "../equipment/capabilityModel";
import { type PackmlState } from "../equipment/packml";
import type { DeviceTypeAttribute } from "../../../drizzle/schema/equipmentStandards";

/** Flag — default OFF (mirrors fleetOrchEnabled / safetyAuditEnabled). */
export function eqGovernEnabled(): boolean {
  return process.env.EQ_GOVERN_ENABLED === "true" || process.env.EQ_GOVERN_ENABLED === "1";
}

/** A single device-type NODE (one level of the tree) prior to resolution. */
export interface DeviceTypeNode {
  typeKey: string;
  parentTypeKey: string | null;
  version: string;
  status: "draft" | "published" | "archived";
  label?: string;
  description?: string;
  attributesSchema: DeviceTypeAttribute[];
  supportedCommands: CommandDescriptor[];
  supportedStates: PackmlState[];
  extensionFields: Record<string, unknown>;
  mappedMachineTypes: string[];
  adapterKind?: string;
}

/** A fully-resolved device type (all ancestors merged in). */
export interface ResolvedDeviceType {
  typeKey: string;
  version: string;
  /** The inheritance chain root→leaf (typeKeys), inclusive of self. */
  inheritanceChain: string[];
  label?: string;
  attributesSchema: DeviceTypeAttribute[];
  supportedCommands: CommandDescriptor[];
  supportedStates: PackmlState[];
  /** Merged extension across every level (child wins on key clash). */
  extension: Record<string, unknown>;
  mappedMachineTypes: string[];
  adapterKind?: string;
}

/** A hierarchy tree node for UI rendering. */
export interface DeviceTypeTreeNode {
  typeKey: string;
  version: string;
  status: string;
  label?: string;
  mappedMachineTypes: string[];
  children: DeviceTypeTreeNode[];
}

// ── telemetry attribute helpers (capabilityModel telemetry → DeviceTypeAttribute) ──
function telemetryToAttribute(t: TelemetryDescriptor): DeviceTypeAttribute {
  return { name: t.key, label: t.label, dataType: t.dataType, unit: t.unit };
}

// ════════════════════════════════════════════════════════════════════════════
// SEED — build the explicit hierarchy from capabilityModel's DEFAULT_PROFILES.
// ════════════════════════════════════════════════════════════════════════════

/** Map each EquipmentClass → its intermediate parent type in the seed tree. */
const CLASS_PARENT: Record<EquipmentClass, string> = {
  AOI: "Inspection", AVI: "Inspection", SPI: "Inspection", AXI: "Inspection", CMM: "Inspection",
  ICT: "TestCell", FCT: "TestCell", ICT_FUNC: "TestCell", ROBOT_TEST: "Robot",
  AUTOMATION: "ProcessAutomation", ASSEMBLY: "ProcessAutomation", FEEDER: "ProcessAutomation",
  SCREWDRIVE: "ProcessAutomation", DISPENSING: "ProcessAutomation", PACKAGING: "ProcessAutomation",
  ROBOT: "Robot", PALLETIZER: "Robot",
  // doc 40 W5 (MTX-03) — SMT line cells sit under ProcessAutomation.
  MOUNTER: "ProcessAutomation", REFLOW: "ProcessAutomation",
  STENCIL_PRINTER: "ProcessAutomation", WAVE_SOLDER: "ProcessAutomation",
};

/** Base attributes every Equipment carries (mirrors report §9.6 Equipment(base)). */
const EQUIPMENT_BASE_ATTRS: DeviceTypeAttribute[] = [
  { name: "vendor", label: "Vendor", dataType: "string" },
  { name: "model", label: "Model", dataType: "string" },
  { name: "protocol", label: "Protocol", dataType: "string" },
  { name: "pack_ml_state", label: "PackML state", dataType: "string" },
  { name: "utilization_rate", label: "Utilization rate", dataType: "float", unit: "%" },
];

/**
 * Build the full SEED tree (in-memory, deterministic). Two layers:
 *   1. structural intermediate nodes (Equipment/Robot/CollaborativeRobot/Inspection/
 *      TestCell/ProcessAutomation) carrying the report §9.6 attribute hierarchy.
 *   2. one leaf node per EquipmentClass, seeded from capabilityModel DEFAULT_PROFILES
 *      (supportedCommands/telemetry→attributes/supportedStates/adapterKind), parented
 *      onto its intermediate node.
 *
 * All seed rows are version 1.0.0, status 'published', origin 'seed'.
 */
export function buildSeedTypes(): DeviceTypeNode[] {
  const nodes: DeviceTypeNode[] = [];
  const mk = (n: Partial<DeviceTypeNode> & { typeKey: string; parentTypeKey: string | null }): DeviceTypeNode => ({
    version: "1.0.0",
    status: "published",
    attributesSchema: [],
    supportedCommands: [],
    supportedStates: [],
    extensionFields: {},
    mappedMachineTypes: [],
    ...n,
  });

  // ── structural / intermediate nodes ──
  nodes.push(mk({
    typeKey: "Equipment", parentTypeKey: null, label: "Equipment (base)",
    description: "Canonical base for every machine — vendor/model/protocol/PackML/utilization.",
    attributesSchema: EQUIPMENT_BASE_ATTRS,
  }));
  nodes.push(mk({
    typeKey: "Robot", parentTypeKey: "Equipment", label: "Robot",
    description: "Articulated robot — joint states, TCP pose, payload, reach.",
    attributesSchema: [
      { name: "joint_states", label: "Joint states", dataType: "json" },
      { name: "tcp_pose", label: "TCP pose", dataType: "json" },
      { name: "payload_kg", label: "Payload", dataType: "float", unit: "kg" },
      { name: "reach_mm", label: "Reach", dataType: "float", unit: "mm" },
      { name: "controller_type", label: "Controller type", dataType: "string" },
    ],
  }));
  nodes.push(mk({
    typeKey: "CollaborativeRobot", parentTypeKey: "Robot", label: "Collaborative Robot (cobot)",
    description: "Cobot — force/speed safety limits (ISO/TS 15066).",
    attributesSchema: [
      { name: "force_limit_n", label: "Force limit", dataType: "float", unit: "N" },
      { name: "safety_rated_speed_mms", label: "Safety-rated speed", dataType: "float", unit: "mm/s" },
    ],
  }));
  nodes.push(mk({
    typeKey: "Inspection", parentTypeKey: "Equipment", label: "Inspection cell",
    description: "Vision/measurement inspection — yield/NG/cycle.",
  }));
  nodes.push(mk({
    typeKey: "TestCell", parentTypeKey: "Equipment", label: "Electrical test cell",
    description: "ICT/FCT-style electrical test — process result.",
  }));
  nodes.push(mk({
    typeKey: "ProcessAutomation", parentTypeKey: "Equipment", label: "Process automation",
    description: "General PLC-driven automation/assembly/feed/process.",
  }));

  // ── leaf nodes from capabilityModel DEFAULT_PROFILES ──
  const profiles = listDefaultProfiles();
  for (const p of profiles) {
    nodes.push(mk({
      typeKey: p.equipmentClass,
      parentTypeKey: CLASS_PARENT[p.equipmentClass] ?? "Equipment",
      label: p.equipmentClass,
      description: `Seeded from capabilityModel DEFAULT_PROFILES[${p.equipmentClass}].`,
      // telemetry → attribute slots (commands stay in supportedCommands).
      attributesSchema: p.telemetryTags.map(telemetryToAttribute),
      supportedCommands: p.supportedCommands,
      supportedStates: p.supportedStates,
      adapterKind: p.adapterKind,
      mappedMachineTypes: [p.equipmentClass],
      // origin ('seed') lives only on the persisted device_types row, not the node.
    }));
  }
  return nodes;
}

// ════════════════════════════════════════════════════════════════════════════
// RESOLUTION — multi-level inheritance merge (pure, fail-safe).
// ════════════════════════════════════════════════════════════════════════════

/** De-dup-append attributes by name; `incoming` (child) overrides existing. */
function mergeAttributes(base: DeviceTypeAttribute[], incoming: DeviceTypeAttribute[]): DeviceTypeAttribute[] {
  const out = base.map((a) => ({ ...a }));
  for (const a of incoming) {
    if (!a || typeof a.name !== "string") continue;
    const i = out.findIndex((x) => x.name === a.name);
    if (i >= 0) out[i] = { ...out[i], ...a }; // child overrides
    else out.push({ ...a });
  }
  return out;
}

/** De-dup-append commands by name; child overrides parent. */
function mergeCommands(base: CommandDescriptor[], incoming: CommandDescriptor[]): CommandDescriptor[] {
  const out = base.map((c) => ({ ...c, paramsSchema: (c.paramsSchema ?? []).map((p) => ({ ...p })) }));
  for (const c of incoming) {
    if (!c || typeof c.name !== "string") continue;
    const i = out.findIndex((x) => x.name === c.name);
    const clone = { ...c, paramsSchema: (c.paramsSchema ?? []).map((p) => ({ ...p })) };
    if (i >= 0) out[i] = clone;
    else out.push(clone);
  }
  return out;
}

/** Union of states preserving order, no dup. */
function mergeStates(base: PackmlState[], incoming: PackmlState[]): PackmlState[] {
  const out = [...base];
  for (const s of incoming) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Resolve a typeKey against a node set, merging the full ancestor chain root→leaf.
 * `extension` is merged (child wins) AT EVERY LEVEL — vendor-specific is preserved.
 * Fail-safe: unknown typeKey → null (caller decides fallback); a cycle is broken.
 */
export function resolveType(typeKey: string, nodes: DeviceTypeNode[]): ResolvedDeviceType | null {
  const byKey = new Map<string, DeviceTypeNode>();
  // when multiple versions exist, prefer the highest published, else highest overall
  for (const n of nodes) {
    const cur = byKey.get(n.typeKey);
    if (!cur) { byKey.set(n.typeKey, n); continue; }
    if (preferNode(n, cur)) byKey.set(n.typeKey, n);
  }
  const leaf = byKey.get(typeKey);
  if (!leaf) return null;

  // build chain leaf→root with cycle guard
  const chain: DeviceTypeNode[] = [];
  const seen = new Set<string>();
  let cur: DeviceTypeNode | undefined = leaf;
  while (cur && !seen.has(cur.typeKey)) {
    seen.add(cur.typeKey);
    chain.push(cur);
    cur = cur.parentTypeKey ? byKey.get(cur.parentTypeKey) : undefined;
  }
  chain.reverse(); // root→leaf so children override parents

  let attrs: DeviceTypeAttribute[] = [];
  let cmds: CommandDescriptor[] = [];
  let states: PackmlState[] = [];
  let ext: Record<string, unknown> = {};
  let adapterKind: string | undefined;
  let mapped: string[] = [];
  for (const node of chain) {
    attrs = mergeAttributes(attrs, node.attributesSchema ?? []);
    cmds = mergeCommands(cmds, node.supportedCommands ?? []);
    states = mergeStates(states, node.supportedStates ?? []);
    ext = { ...ext, ...(node.extensionFields ?? {}) };
    if (node.adapterKind) adapterKind = node.adapterKind;
    for (const m of node.mappedMachineTypes ?? []) if (!mapped.includes(m)) mapped.push(m);
  }
  return {
    typeKey: leaf.typeKey,
    version: leaf.version,
    inheritanceChain: chain.map((n) => n.typeKey),
    label: leaf.label,
    attributesSchema: attrs,
    supportedCommands: cmds,
    supportedStates: states,
    extension: ext,
    mappedMachineTypes: mapped,
    adapterKind,
  };
}

/** Prefer published>draft>archived, then higher SemVer. */
function preferNode(a: DeviceTypeNode, b: DeviceTypeNode): boolean {
  const rank = (s: string) => (s === "published" ? 2 : s === "draft" ? 1 : 0);
  if (rank(a.status) !== rank(b.status)) return rank(a.status) > rank(b.status);
  return compareSemver(a.version, b.version) > 0;
}

/** Build the hierarchy tree (root→leaf) from a node set (one node per typeKey). */
export function buildTree(nodes: DeviceTypeNode[]): DeviceTypeTreeNode[] {
  const byKey = new Map<string, DeviceTypeNode>();
  for (const n of nodes) {
    const cur = byKey.get(n.typeKey);
    if (!cur || preferNode(n, cur)) byKey.set(n.typeKey, n);
  }
  const tnodes = new Map<string, DeviceTypeTreeNode>();
  for (const n of byKey.values()) {
    tnodes.set(n.typeKey, {
      typeKey: n.typeKey, version: n.version, status: n.status, label: n.label,
      mappedMachineTypes: n.mappedMachineTypes ?? [], children: [],
    });
  }
  const roots: DeviceTypeTreeNode[] = [];
  for (const n of byKey.values()) {
    const t = tnodes.get(n.typeKey)!;
    const parent = n.parentTypeKey ? tnodes.get(n.parentTypeKey) : undefined;
    if (parent && parent !== t) parent.children.push(t);
    else roots.push(t);
  }
  return roots;
}

/**
 * Given a legacy machineType/equipmentClass, return its RESOLVED device type from the
 * seed (so machine→type lookup is consistent with today's capabilityModel profile).
 * Fail-safe: unknown → resolves the Equipment base (never throws).
 */
export function resolveForMachineType(machineType: string, nodes?: DeviceTypeNode[]): ResolvedDeviceType {
  const set = nodes ?? buildSeedTypes();
  return resolveType(machineType, set) ?? resolveType("Equipment", set)!;
}

/**
 * Cross-check: the resolved device type for a machineType should be consistent with
 * the capabilityModel default (same supported command names). Used by complianceService
 * + conformance. Returns the capabilityModel default capability for the type.
 */
export function capabilityForMachineType(machineType: string): EquipmentCapability {
  return getDefaultCapability(machineType);
}

// ════════════════════════════════════════════════════════════════════════════
// SemVer — minimal parse + compare + bump (no dependency).
// ════════════════════════════════════════════════════════════════════════════

export interface SemVer { major: number; minor: number; patch: number; }

/** Parse "x.y.z" (fail-safe → 0.0.0 on garbage). */
export function parseSemver(v: string): SemVer {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 | 0 | 1 (a vs b). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/** Bump a SemVer string by level → new string. */
export function bumpSemver(v: string, level: "major" | "minor" | "patch"): string {
  const p = parseSemver(v);
  if (level === "major") return `${p.major + 1}.0.0`;
  if (level === "minor") return `${p.major}.${p.minor + 1}.0`;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}
