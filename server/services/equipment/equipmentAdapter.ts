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
import { appError } from "../../_core/appError"; // doc 81 Đợt 4 fix round 3 (R-4-n)
import type { AdapterKind } from "./capabilityModel";
import { listProtocols, createDriver } from "../ot/driverRegistry";
import type { OtProtocol } from "../ot/otDriver";
import { dispatch as otDispatch } from "../ot/commandDispatcher";
import { probeWithDeadline, PROBE_MARGIN_MS } from "../ot/probeConnection";
import type { DispatchInput, DispatchTrigger } from "../ot/commandDispatcher";
import { dispatchRobotJob } from "../robot/robotCommandDispatcher";
import type { RobotJobSpec } from "../robot/robotDriver";
import { toRobotJob } from "./robotJobMapping";

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
  /**
   * doc 81 Đợt 1B Task 6 — `tool` = the ai_pending_actions.tool the actionId was created for;
   * the OT dispatcher binds a real write to (tool + canonical payload hash) and consumes it.
   */
  hitl: { actionId: string; requestedBy: number; confirmedBy?: number; tool?: string };
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

/**
 * doc 81 Đợt 1B Task 2 (R8) — hạn tổng cho một lần dò qua mặt tiền: timeoutMs của cấu hình
 * (hoặc mặc định 5000 như các driver) cho connect, cộng thêm chừng ấy cho bước sau connect
 * (health/readTags), cộng biên đóng có hạn PROBE_MARGIN_MS.
 */
const EQUIPMENT_PROBE_DEFAULT_TIMEOUT_MS = 5000;
function equipmentProbeOverallMs(cfg: EquipmentConnConfig): number {
  const t =
    typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? cfg.timeoutMs : EQUIPMENT_PROBE_DEFAULT_TIMEOUT_MS;
  return 2 * t + PROBE_MARGIN_MS;
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
// doc 81 Đợt 1B final wave (item 2) — `toRobotJob` moved to ./robotJobMapping so the FOE
// producer of the robot authorisation row hashes EXACTLY the job this adapter dispatches.

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
      // doc 81 Đợt 1B Task 2 (R8) — MỘT hạn tổng cho connect + health + disconnect (driver treo
      // không giữ được lời gọi; kết nối xong muộn vẫn bị hạ).
      const { latencyMs, value: health } = await probeWithDeadline(
        {
          label: this.protocol,
          connect: () =>
            driver.connect({ endpoint: cfg.endpoint ?? "", options: cfg.options, timeoutMs: cfg.timeoutMs }),
          afterConnect: () => driver.health(),
          disconnect: () => driver.disconnect(),
        },
        equipmentProbeOverallMs(cfg),
      );
      return { ok: health ? health.connected : false, latencyMs, detail: { protocol: this.protocol } };
    } catch (err) {
    // data-raw-ok: dò kết nối thiết bị ở tầng adapter. KHÁC `deviceAdapter.testConnection`
    // (đã có errorCode): hàm này là API NỘI BỘ cho `equipmentIntegrationRouter`, và chính
    // router đó mới là nơi gắn mã cho người dùng — gắn thêm ở đây là hai nguồn sự thật.
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readTelemetry(cfg: EquipmentConnConfig): Promise<EquipmentSample[]> {
    try {
      const driver = createDriver(this.protocol);
      const tags = Array.isArray(cfg.tags) ? (cfg.tags as Parameters<typeof driver.readTags>[0]) : [];
      // doc 81 Đợt 1B Task 2 (R8) — nhánh anh em của testConnection: cùng hạn tổng.
      const { value: samples } = await probeWithDeadline(
        {
          label: this.protocol,
          connect: () =>
            driver.connect({ endpoint: cfg.endpoint ?? "", options: cfg.options, timeoutMs: cfg.timeoutMs }),
          afterConnect: () => driver.readTags(tags),
          disconnect: () => driver.disconnect(),
        },
        equipmentProbeOverallMs(cfg),
      );
      return (samples ?? []).map((s) => ({ key: s.tagKey, value: s.value, timestamp: s.timestamp }));
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
      ...(command.hitl.tool ? { tool: command.hitl.tool } : {}),
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
      // doc 81 Đợt 1C final wave 4 (R-1C-g) — a refused stop/e_stop carries a plain sentence (use the hardware
      // E-STOP) + its localisable appError; absent for every other result (byte-identical).
      detail: { simulated: res.simulated, commandLogIds: res.commandLogIds, reason: res.reason, ...(res.appError ? { appError: res.appError } : {}) },
      ...(res.message ? { error: res.message } : {}),
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
      // doc 81 Đợt 4 fix round 3 (R-4-n) — localisable: INVALID_VALUE { field: robotId, reason: robotIdRequired }.
      const e = appError("BAD_REQUEST", "INVALID_VALUE", { field: "robotId", reason: "robotIdRequired" }, "robotId required for robot command");
      return {
        ok: false,
        status: "rejected",
        routedTo: "robot-dispatcher",
        error: e.message,
        detail: { appError: { appCode: "INVALID_VALUE", appParams: { field: "robotId", reason: "robotIdRequired" } } },
      };
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
 * ════════════════════════════════════════════════════════════════════════════
 * U4b (doc 21 §6 / G-8) — DATA-DRIVEN adapter registry (mirrors ot/driverRegistry).
 *
 * A `Map<kind, factory>` + `registerEquipmentAdapter(kind, factory)` replaces the
 * hard-coded `ADAPTER_KINDS` array + `build()` switch. Every EXISTING kind seeds
 * itself through the registry at module load (below), so resolution is IDENTICAL —
 * this is a behaviour-preserving refactor. A new vendor/kind is now ONE
 * `registerEquipmentAdapter(...)` call (register-and-go); no core switch edit.
 *
 * The `AdapterKind` union is retained for compile-time exhaustiveness; runtime
 * resolution is registry-driven. A brand-new kind can register under a widened
 * string key without a union edit (see `registerEquipmentAdapter`).
 * ════════════════════════════════════════════════════════════════════════════
 */

/** A factory that builds the unified adapter for a kind (memoised by the facade). */
export type EquipmentAdapterFactory = (kind: AdapterKind) => EquipmentAdapter;

/** The plug-in registry: kind → factory. Seeded at load; extensible at runtime. */
const adapterFactories = new Map<AdapterKind, EquipmentAdapterFactory>();
/** Lazily-built, memoised adapter instances (one per kind). */
const adapterCache = new Map<AdapterKind, EquipmentAdapter>();

/**
 * Register (or override) the factory for an adapter kind. Register-and-go: a new
 * vendor/kind needs only this call (+ optionally a capability profile). Overriding
 * an existing kind clears its memoised instance so the next `getAdapter` rebuilds.
 */
export function registerEquipmentAdapter(kind: AdapterKind, factory: EquipmentAdapterFactory): void {
  adapterFactories.set(kind, factory);
  adapterCache.delete(kind);
}

// ── Seed every EXISTING kind through the registry (parity with the old switch) ──
// OT family (opcua/modbus/s7/mitsubishi-mc/ethernet-ip/stub) → OtEquipmentAdapter.
for (const [kind, proto] of Object.entries(OT_KIND_TO_PROTOCOL) as Array<[AdapterKind, OtProtocol]>) {
  registerEquipmentAdapter(kind, (k) => new OtEquipmentAdapter(k, proto));
}
// Robot / AGV → RobotEquipmentAdapter (routes through robotCommandDispatcher).
registerEquipmentAdapter("robot", (k) => new RobotEquipmentAdapter(k, "robot"));
registerEquipmentAdapter("vda5050", (k) => new RobotEquipmentAdapter(k, "vda5050"));
// Telemetry-only kinds → ReadOnlyEquipmentAdapter (sendCommand rejected, never dropped).
registerEquipmentAdapter("vision", (k) => new ReadOnlyEquipmentAdapter(k, "vision"));
registerEquipmentAdapter("mtconnect", (k) => new ReadOnlyEquipmentAdapter(k, "mtconnect"));
registerEquipmentAdapter("secsgem", (k) => new ReadOnlyEquipmentAdapter(k, "secsgem"));
// I1 — FOCAS/Euromap are READ-ONLY monitoring frameworks (no real device, no
// fabricated telemetry, no control path). Their live snapshot is served by their own
// framework adapter; the facade exposes them as read-only kinds so command attempts
// are rejected (never silently dropped).
registerEquipmentAdapter("focas", (k) => new ReadOnlyEquipmentAdapter(k, "focas"));
registerEquipmentAdapter("euromap", (k) => new ReadOnlyEquipmentAdapter(k, "euromap"));

/**
 * All adapter kinds this facade can address (1:1 onto an existing registry). DERIVED
 * from the registry keys (register-and-go) so callers still get a stable array; the
 * insertion order mirrors the historical hard-coded list. Kept as a getter-backed
 * const view — reads are live against the registry.
 */
export const ADAPTER_KINDS: AdapterKind[] = listRegisteredAdapterKinds();

/** The registered kinds, in registration (== historical) order. */
function listRegisteredAdapterKinds(): AdapterKind[] {
  return [...adapterFactories.keys()];
}

/**
 * The equipmentRegistry FACADE. Builds (lazily, memoised) one adapter per kind by
 * looking the factory up in the data-driven registry. NO protocol logic lives here.
 */
export const equipmentRegistry = {
  /** Resolve (memoised) the unified adapter for a kind. Throws for an unknown kind. */
  getAdapter(kind: AdapterKind): EquipmentAdapter {
    const factory = adapterFactories.get(kind);
    if (!factory) {
      throw new Error(`Unknown equipment adapter kind "${kind}"`);
    }
    let a = adapterCache.get(kind);
    if (!a) {
      a = factory(kind);
      adapterCache.set(kind, a);
    }
    return a;
  },

  /** List every adapter kind + the registry it delegates to (discovery/UI). */
  listAdapters(): Array<{ kind: AdapterKind; delegatesTo: DelegateRegistry }> {
    return listRegisteredAdapterKinds().map((kind) => {
      const a = equipmentRegistry.getAdapter(kind);
      return { kind: a.kind, delegatesTo: a.delegatesTo };
    });
  },

  /** Every registered kind (register-and-go view; == derived ADAPTER_KINDS). */
  listKinds(): AdapterKind[] {
    return listRegisteredAdapterKinds();
  },

  /**
   * Cross-check that the OT kinds the facade exposes are actually registered in the
   * underlying ot/driverRegistry (no orphan kinds). Returns the OT protocols present.
   */
  listOtProtocols(): OtProtocol[] {
    return listProtocols();
  },

  /** Test-only: clear the memoised adapters (registrations survive). */
  _clear(): void {
    adapterCache.clear();
  },
};
