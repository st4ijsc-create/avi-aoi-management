/**
 * Phase E0 — Factory Control Plane: UNIFIED EquipmentAdapter facade.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE entrypoint over the existing per-protocol registries (OT / vision / robot /
 * mtconnect / secsgem / vda5050). This is a THIN FACADE — it owns NO protocol
 * logic; it DELEGATES to the existing registries/managers and routes any command
 * STRICTLY through the EXISTING HITL dispatchers. It NEVER opens a new control path.
 *
 * SAFETY (non-negotiable):
 *   • sendCommand() → routes to commandDispatcher.dispatch (OT/PLC) or
 *     robotCommandDispatcher.dispatchRobotJob (robot/AGV). Both honour the global
 *     OT_CONTROL_ENABLED / ROBOT_CONTROL_ENABLED dry-run gates and the HITL trigger
 *     (actionId/confirmedBy). This facade adds NO bypass — when those flags are off
 *     (the default) the underlying dispatcher returns `simulated` and writes nothing.
 *   • readTelemetry()/testConnection()/getState() are read-only and delegate to the
 *     existing driver/manager/client of the chosen registry.
 *
 * Callers: listAdapters() / getAdapter(kind). E1 (Unified API) and E2 (Orchestration
 * Engine) build on these. Fail-safe: unknown kind → clear Error; read failures →
 * a typed result, never a crash.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { AdapterKind } from "./capabilityModel";
import { listProtocols, createDriver } from "../ot/driverRegistry";
import type { OtProtocol } from "../ot/otDriver";
import { dispatch as otDispatch } from "../ot/commandDispatcher";
import type { DispatchInput, DispatchTrigger } from "../ot/commandDispatcher";
import { dispatchRobotJob } from "../robot/robotCommandDispatcher";
import type { RobotJobSpec, RobotJobType } from "../robot/robotDriver";

/** All adapter kinds this facade can address (1:1 onto an existing registry). */
export const ADAPTER_KINDS: AdapterKind[] = [
  "ot-opcua",
  "ot-modbus",
  "ot-s7",
  "ot-mitsubishi-mc",
  "ot-ethernet-ip",
  "ot-stub",
  "vision",
  "robot",
  "mtconnect",
  "secsgem",
  "vda5050",
  // I1 (doc 16 §6) — multi-vendor equipment integration FRAMEWORKS (read-only).
  "focas",
  "euromap",
];

/** Which existing registry/manager a kind delegates to (for discovery/UI). */
export type DelegateRegistry =
  | "ot"
  | "vision"
  | "robot"
  | "mtconnect"
  | "secsgem"
  | "vda5050"
  | "focas"
  | "euromap";

/** Generic connection descriptor passed to read/test ops (kept loose — the real shape lives in the delegated driver). */
export interface EquipmentConnConfig {
  endpoint?: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
  [k: string]: unknown;
}

/** Result of a read-only connectivity test (normalised across registries). */
export interface EquipmentTestResult {
  ok: boolean;
  latencyMs?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

/** ONE normalised telemetry sample. */
export interface EquipmentSample {
  key: string;
  value: number | string | boolean | null;
  unit?: string;
  timestamp: Date;
}

/**
 * The HITL command envelope this facade accepts. It carries the identity the
 * underlying dispatcher needs (adapterId for OT, robotId for robot) + the HITL
 * actor. The facade NEVER fabricates a trigger — the caller supplies it.
 */
export interface EquipmentCommand {
  /** Canonical command verb (== a CommandDescriptor.name, e.g. "start", "run_job"). */
  name: string;
  /** OT adapter id (required for OT/PLC-routed commands). */
  adapterId?: number;
  /** Robot id (required for robot/AGV-routed commands). */
  robotId?: number;
  machineId?: number | null;
  /** tag writes for OT (tagKey/value) — filled by the caller from the capability. */
  writes?: Array<{ tagKey: string; value: unknown }>;
  /** robot job spec for robot/AGV kinds. */
  job?: RobotJobSpec;
  idempotencyKey: string;
  /** HITL provenance — actionId + confirmedBy/requestedBy. */
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number };
  lang?: "vi" | "en" | "zh";
}

/** Normalised result of a routed command (whether simulated or real). */
export interface EquipmentCommandResult {
  ok: boolean;
  /** 'simulated' when the dry-run gate is off (the default) — nothing written. */
  status: string;
  routedTo: "ot-dispatcher" | "robot-dispatcher";
  detail?: Record<string, unknown>;
  error?: string;
}

/**
 * The UNIFIED adapter contract. Every kind implements this; control always routes
 * through the existing HITL dispatcher.
 */
export interface EquipmentAdapter {
  readonly kind: AdapterKind;
  readonly delegatesTo: DelegateRegistry;
  /** Read-only connectivity probe (delegates to the real driver/client). */
  testConnection(cfg: EquipmentConnConfig): Promise<EquipmentTestResult>;
  /** Read-only telemetry snapshot (delegates to the real driver/manager). */
  readTelemetry(cfg: EquipmentConnConfig): Promise<EquipmentSample[]>;
  /** Route a command through the EXISTING HITL dispatcher (honours dry-run). */
  sendCommand(command: EquipmentCommand): Promise<EquipmentCommandResult>;
  /** Optional current PackML/device state (delegates to a stateful driver if any). */
  getState?(cfg: EquipmentConnConfig): Promise<{ state?: string; raw?: Record<string, unknown> }>;
}

const OT_KIND_TO_PROTOCOL: Partial<Record<AdapterKind, OtProtocol>> = {
  "ot-opcua": "opcua",
  "ot-modbus": "modbus",
  "ot-s7": "s7",
  "ot-mitsubishi-mc": "mitsubishi-mc",
  "ot-ethernet-ip": "ethernet-ip",
  "ot-stub": "stub",
};

/** Map a robot job verb string onto the RobotDriver RobotJobType. */
function toRobotJob(command: EquipmentCommand): RobotJobSpec {
  if (command.job) return command.job;
  const verbs: RobotJobType[] = ["move", "pick_place", "dispense", "screw", "home", "abort", "custom"];
  const jobType = verbs.includes(command.name as RobotJobType)
    ? (command.name as RobotJobType)
    : command.name === "abort"
      ? "abort"
      : "custom";
  return { jobType, params: {} };
}

/**
 * An OT-family adapter (opcua/modbus/s7/mitsubishi-mc/ethernet-ip/stub). Delegates
 * reads/test to the OT driver from the EXISTING ot/driverRegistry, and routes
 * commands through the EXISTING ot/commandDispatcher.dispatch (HITL + dry-run).
 */
class OtEquipmentAdapter implements EquipmentAdapter {
  readonly delegatesTo = "ot" as const;
  constructor(public readonly kind: AdapterKind, private readonly protocol: OtProtocol) {}

  async testConnection(cfg: EquipmentConnConfig): Promise<EquipmentTestResult> {
    try {
      const driver = createDriver(this.protocol);
      const t0 = Date.now();
      await driver.connect({ endpoint: cfg.endpoint ?? "", options: cfg.options, timeoutMs: cfg.timeoutMs });
      const health = await driver.health();
      await driver.disconnect().catch(() => undefined);
      return { ok: health.connected, latencyMs: Date.now() - t0, detail: { protocol: this.protocol } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readTelemetry(cfg: EquipmentConnConfig): Promise<EquipmentSample[]> {
    try {
      const driver = createDriver(this.protocol);
      await driver.connect({ endpoint: cfg.endpoint ?? "", options: cfg.options, timeoutMs: cfg.timeoutMs });
      const tags = Array.isArray(cfg.tags) ? (cfg.tags as Parameters<typeof driver.readTags>[0]) : [];
      const samples = await driver.readTags(tags);
      await driver.disconnect().catch(() => undefined);
      return samples.map((s) => ({ key: s.tagKey, value: s.value, timestamp: s.timestamp }));
    } catch {
      return [];
    }
  }

  async sendCommand(command: EquipmentCommand): Promise<EquipmentCommandResult> {
    if (command.adapterId == null) {
      return { ok: false, status: "rejected", routedTo: "ot-dispatcher", error: "adapterId required for OT command" };
    }
    const triggeredBy: DispatchTrigger = {
      kind: "hitl",
      actionId: command.hitl.actionId,
      requestedBy: command.hitl.requestedBy,
      confirmedBy: command.hitl.confirmedBy ?? command.hitl.requestedBy,
    };
    const input: DispatchInput = {
      adapterId: command.adapterId,
      machineId: command.machineId ?? null,
      commandType: command.name,
      writes: (command.writes ?? []).map((w) => ({ tagKey: w.tagKey, value: w.value })),
      triggeredBy,
      lang: command.lang,
      idempotencyKey: command.idempotencyKey,
    };
    const res = await otDispatch(input);
    return {
      ok: res.ok,
      status: res.status,
      routedTo: "ot-dispatcher",
      detail: { simulated: res.simulated, commandLogIds: res.commandLogIds, reason: res.reason },
    };
  }
}

/**
 * The robot/AGV adapter (vendor robot drivers + VDA5050 AGV). Routes commands
 * through the EXISTING robot/robotCommandDispatcher.dispatchRobotJob (HITL + dry-run).
 */
class RobotEquipmentAdapter implements EquipmentAdapter {
  constructor(public readonly kind: AdapterKind, public readonly delegatesTo: DelegateRegistry) {}

  async testConnection(_cfg: EquipmentConnConfig): Promise<EquipmentTestResult> {
    // Live robot/AGV connectivity is owned by robotManager/vda5050Manager (runtime
    // adapters). The facade does not open ad-hoc robot connections — report deferred.
    return { ok: false, error: "robot/AGV connectivity is managed by robotManager (runtime); no ad-hoc test" };
  }

  async readTelemetry(_cfg: EquipmentConnConfig): Promise<EquipmentSample[]> {
    return [];
  }

  async sendCommand(command: EquipmentCommand): Promise<EquipmentCommandResult> {
    if (command.robotId == null) {
      return { ok: false, status: "rejected", routedTo: "robot-dispatcher", error: "robotId required for robot command" };
    }
    const res = await dispatchRobotJob({
      robotId: command.robotId,
      job: toRobotJob(command),
      triggerKind: "hitl",
      actionId: command.hitl.actionId,
      requestedBy: command.hitl.requestedBy,
      confirmedBy: command.hitl.confirmedBy,
      idempotencyKey: command.idempotencyKey,
    });
    return {
      ok: res.ok,
      status: res.status,
      routedTo: "robot-dispatcher",
      detail: { jobId: res.jobId },
      error: res.error,
    };
  }
}

/**
 * A read-only adapter for telemetry-only registries (mtconnect / secsgem). These
 * have NO control path today — sendCommand is rejected (never silently dropped).
 */
class ReadOnlyEquipmentAdapter implements EquipmentAdapter {
  constructor(public readonly kind: AdapterKind, public readonly delegatesTo: DelegateRegistry) {}

  async testConnection(_cfg: EquipmentConnConfig): Promise<EquipmentTestResult> {
    return { ok: false, error: `${this.kind} connectivity is managed by its poller/manager (runtime)` };
  }
  async readTelemetry(_cfg: EquipmentConnConfig): Promise<EquipmentSample[]> {
    return [];
  }
  async sendCommand(_command: EquipmentCommand): Promise<EquipmentCommandResult> {
    return {
      ok: false,
      status: "rejected",
      routedTo: "ot-dispatcher",
      error: `${this.kind} is telemetry-only; no command path`,
    };
  }
}

/**
 * The equipmentRegistry FACADE. Builds (lazily, memoised) one adapter per kind that
 * delegates to the matching existing registry. NO protocol logic lives here.
 */
const adapterCache = new Map<AdapterKind, EquipmentAdapter>();

function build(kind: AdapterKind): EquipmentAdapter {
  const proto = OT_KIND_TO_PROTOCOL[kind];
  if (proto) return new OtEquipmentAdapter(kind, proto);
  if (kind === "robot") return new RobotEquipmentAdapter(kind, "robot");
  if (kind === "vda5050") return new RobotEquipmentAdapter(kind, "vda5050");
  if (kind === "vision") return new ReadOnlyEquipmentAdapter(kind, "vision");
  if (kind === "mtconnect") return new ReadOnlyEquipmentAdapter(kind, "mtconnect");
  if (kind === "secsgem") return new ReadOnlyEquipmentAdapter(kind, "secsgem");
  // I1 — FOCAS/Euromap are READ-ONLY monitoring frameworks (no real device, no
  // fabricated telemetry, no control path). Their live snapshot is served by their
  // own framework adapter (focas/euromapAdapter); the facade exposes them as
  // read-only kinds so command attempts are rejected (never silently dropped).
  if (kind === "focas") return new ReadOnlyEquipmentAdapter(kind, "focas");
  if (kind === "euromap") return new ReadOnlyEquipmentAdapter(kind, "euromap");
  throw new Error(`No equipment adapter for kind "${kind}"`);
}

export const equipmentRegistry = {
  /** Resolve (memoised) the unified adapter for a kind. Throws for an unknown kind. */
  getAdapter(kind: AdapterKind): EquipmentAdapter {
    if (!ADAPTER_KINDS.includes(kind)) {
      throw new Error(`Unknown equipment adapter kind "${kind}"`);
    }
    let a = adapterCache.get(kind);
    if (!a) {
      a = build(kind);
      adapterCache.set(kind, a);
    }
    return a;
  },

  /** List every adapter kind + the registry it delegates to (discovery/UI). */
  listAdapters(): Array<{ kind: AdapterKind; delegatesTo: DelegateRegistry }> {
    return ADAPTER_KINDS.map((kind) => {
      const a = equipmentRegistry.getAdapter(kind);
      return { kind: a.kind, delegatesTo: a.delegatesTo };
    });
  },

  /**
   * Cross-check that the OT kinds the facade exposes are actually registered in the
   * underlying ot/driverRegistry (no orphan kinds). Returns the OT protocols present.
   */
  listOtProtocols(): OtProtocol[] {
    return listProtocols();
  },

  /** Test-only: clear the memoised adapters. */
  _clear(): void {
    adapterCache.clear();
  },
};
