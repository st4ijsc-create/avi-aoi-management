/**
 * T-3 (doc 38 R-3 / doc 25 §T1) — SAFETY-PLC VENDOR ADAPTER SEAM — SKELETON ONLY.
 *   Flag: SAFETY_ESTOP_ADAPTER_ENABLED (default OFF → nothing registers here).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADDS (over safetyEstopAdapter.ts)
 *   safetyEstopAdapter.ts defines the minimal TRIGGER contract (SafetyPlcAdapter:
 *   triggerEmergencyStop / health / isRated / label) + the Null default + the
 *   registry (registerSafetyPlcAdapter). This file adds the RICHER vendor contract
 *   `SafetyPlcVendorAdapter` (adds readEstopState / readZoneState / selfTest) and
 *   TWO honest, un-actuating SKELETON adapters for the certified controllers the
 *   plant plans to buy:
 *     • Pilz PNOZmulti / PSS  (diagnostic interface over Modbus-TCP)
 *     • Sick Flexi Soft       (diagnostic interface over EtherNet/IP)
 *   Both reach the controller's NON-safety diagnostic interface through the
 *   EXISTING OT driver (driverRegistry) — the same connect/readTags path the
 *   read-only plc/safetyPlcAdapter already uses.
 *
 * ⚠ SAFETY / HONESTY — THE CENTRAL INVARIANT (do not weaken)
 *   The RATED emergency stop on a Pilz/Sick controller is performed by the
 *   controller ITSELF, in HARDWARE, over a HARD-WIRED dual-channel circuit
 *   (ISO 13849 Cat 3/4, IEC 62061 SIL 2/3), executing < 100 ms — INDEPENDENT of
 *   this software. This adapter is a SEAM to OBSERVE that circuit and, at most,
 *   REQUEST a NON-rated soft-stop over the diagnostic bus. Therefore, until the
 *   hardware is installed AND certified (FAT passed, see docs/SAFETY_PLC_ADAPTER.md):
 *     • isRated()  === false           (NEVER hard-code true)
 *     • triggerEmergencyStop() returns actuated:false, rated:false, ok:false —
 *       it does NOT actuate. Software interlock remains the ONLY active stop path.
 *     • selfTest() returns rated:false; ok:false while not commissioned.
 *   Reads (readEstopState/readZoneState) NEVER fabricate a value — an unreadable
 *   or unconfigured endpoint yields quality:"unknown", not a made-up state.
 *
 *   These skeletons are NOT auto-registered. The runtime registry stays Null
 *   (see safetyEstopAdapter.registered) until a commissioning step explicitly
 *   calls registerVendorAdapter(). So with the flag OFF and nothing registered,
 *   this file changes NOTHING at runtime — it is pure scaffolding for the seam.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  type SafetyPlcAdapter,
  type EstopTarget,
  type EstopResult,
  type SafetyPlcHealth,
  registerSafetyPlcAdapter,
} from "./safetyEstopAdapter";
import { createDriver } from "../../ot/driverRegistry";
import type { OtProtocol, OtTagAddress, OtDataType } from "../../ot/otDriver";

// ── Reading types (honest: quality carries "unknown" — never a fabricated state) ──

export type ReadQuality = "good" | "bad" | "unknown";

/** Observed e-stop circuit state (diagnostic read; the rated stop is hard-wired). */
export interface EstopStateReading {
  /** true = e-stop currently ACTIVE (line stopped). undefined when unknown. */
  active?: boolean;
  /** Dual-channel diagnostics (channel A / B) when the controller exposes them. */
  channelA?: boolean;
  channelB?: boolean;
  quality: ReadQuality;
  detail?: string;
}

/** Observed safety-zone state (occupied / muting) for a target zone. */
export interface ZoneStateReading {
  zoneId?: number | null;
  occupied?: boolean;
  muted?: boolean;
  quality: ReadQuality;
  detail?: string;
}

/** Result of a non-actuating self-test / commissioning probe. */
export interface SelfTestResult {
  /** All configured checks passed AND the adapter is ready. false until commissioned. */
  ok: boolean;
  /** TRUE only when backed by certified rated HW. Skeleton → always false. */
  rated: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  message?: string;
}

/**
 * Richer vendor contract. Extends the minimal TRIGGER adapter with diagnostic
 * READS and a self-test. A real implementation talks to the certified Safety PLC
 * over its own channel; a rated stop is still the controller's hard-wired job.
 */
export interface SafetyPlcVendorAdapter extends SafetyPlcAdapter {
  readonly vendor: "pilz" | "sick";
  /** Read the observed e-stop circuit state (never actuates). */
  readEstopState(target?: EstopTarget): Promise<EstopStateReading>;
  /** Read the observed safety-zone state (never actuates). */
  readZoneState(target?: EstopTarget): Promise<ZoneStateReading>;
  /** Non-actuating commissioning probe: config sanity + reachability + rated check. */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * Config for a vendor adapter. `endpoint` stays undefined until the HW is wired.
 * `tags` map the controller's DIAGNOSTIC points (READ). `softStopRequest` is an
 * OPTIONAL non-rated request coil — DOCUMENTED but intentionally NOT written by
 * the skeleton (a soft write over the diagnostic bus is NOT a rated stop).
 */
export interface SafetyPlcVendorConfig {
  /** OT protocol for the controller's non-safety diagnostic interface. */
  protocol: OtProtocol;
  /** Endpoint URL/host — undefined until commissioned. */
  endpoint?: string;
  tags?: {
    estopActive?: string;
    estopChannelA?: string;
    estopChannelB?: string;
    zoneOccupied?: string;
    muting?: string;
    /** Non-rated soft-stop request coil (documented; NOT written by the skeleton). */
    softStopRequest?: string;
  };
  timeoutMs?: number;
}

/**
 * Shared skeleton. Reads go through the OT driver honestly; actuation is a
 * deliberate no-op (actuated:false) until certified HW + FAT. Subclasses only
 * set `vendor` + a default protocol/label.
 */
abstract class BaseVendorSafetyPlcAdapter implements SafetyPlcVendorAdapter {
  abstract readonly vendor: "pilz" | "sick";
  readonly kind: string;
  protected readonly cfg: SafetyPlcVendorConfig;

  constructor(kind: string, cfg: SafetyPlcVendorConfig) {
    this.kind = kind;
    this.cfg = cfg;
  }

  /** NEVER true for a skeleton — no certified HW behind it. */
  isRated(): boolean {
    return false;
  }

  protected hasEndpoint(): boolean {
    return typeof this.cfg.endpoint === "string" && this.cfg.endpoint.length > 0;
  }

  /** Read one bool diagnostic tag via the OT driver. quality:"unknown" on any gap. */
  protected async readBoolTag(address?: string): Promise<{ value?: boolean; quality: ReadQuality; detail?: string }> {
    if (!address) return { quality: "unknown", detail: "tag not mapped" };
    if (!this.hasEndpoint()) return { quality: "unknown", detail: "endpoint not commissioned" };
    const tag: OtTagAddress = { tagKey: address, address, dataType: "bool" as OtDataType };
    try {
      const driver = createDriver(this.cfg.protocol);
      await driver.connect({ endpoint: this.cfg.endpoint!, timeoutMs: this.cfg.timeoutMs ?? 5000 });
      try {
        const [s] = await driver.readTags([tag]);
        if (!s || s.quality !== "good") return { quality: "unknown", detail: "bad/absent sample" };
        const v = s.value;
        const value = typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v === "1" || v === "true";
        return { value, quality: "good" };
      } finally {
        await driver.disconnect().catch(() => undefined);
      }
    } catch (err) {
      // Honest: unreachable / driver not implemented → unknown, fabricate nothing.
      return { quality: "unknown", detail: `read failed: ${(err as Error)?.message ?? String(err)}` };
    }
  }

  async health(): Promise<SafetyPlcHealth> {
    const reachable = this.hasEndpoint()
      ? (await this.readBoolTag(this.cfg.tags?.estopActive)).quality === "good"
      : false;
    return {
      reachable,
      rated: false, // skeleton — never rated
      label: this.label(),
      detail: this.hasEndpoint()
        ? "diagnostic interface only — rated stop is the controller's hard-wired dual-channel circuit, not this software"
        : "endpoint not commissioned — software interlock is the only active stop path",
    };
  }

  async readEstopState(_target?: EstopTarget): Promise<EstopStateReading> {
    const active = await this.readBoolTag(this.cfg.tags?.estopActive);
    const chA = await this.readBoolTag(this.cfg.tags?.estopChannelA);
    const chB = await this.readBoolTag(this.cfg.tags?.estopChannelB);
    const quality: ReadQuality = active.quality;
    return {
      active: active.value,
      channelA: chA.value,
      channelB: chB.value,
      quality,
      detail: active.detail ?? "diagnostic read (READ-ONLY)",
    };
  }

  async readZoneState(target?: EstopTarget): Promise<ZoneStateReading> {
    const occ = await this.readBoolTag(this.cfg.tags?.zoneOccupied);
    const mut = await this.readBoolTag(this.cfg.tags?.muting);
    return {
      zoneId: target?.zoneId ?? null,
      occupied: occ.value,
      muted: mut.value,
      quality: occ.quality,
      detail: occ.detail ?? "diagnostic read (READ-ONLY)",
    };
  }

  /**
   * SKELETON actuation — DOES NOT actuate. The rated stop is the controller's
   * hard-wired dual-channel circuit; this software path is NOT safety-rated and
   * MUST NOT claim to have stopped anything. Returns actuated:false honestly.
   * (Even a non-rated soft-stop request coil is intentionally NOT written here
   * until HW + FAT — a soft write must never be mistaken for a rated stop.)
   */
  async triggerEmergencyStop(target: EstopTarget): Promise<EstopResult> {
    return {
      ok: false,
      rated: false,
      actuated: false,
      adapter: this.label(),
      message:
        `SKELETON (${this.vendor}): NOT actuated — certified Safety-PLC hardware absent/uncommissioned. ` +
        `The rated stop is the controller's hard-wired dual-channel circuit (<100ms), independent of this software. ` +
        `Software interlock remains the ONLY active stop path` +
        (target?.reason ? ` [reason: ${target.reason}]` : "") + ".",
    };
  }

  async selfTest(): Promise<SelfTestResult> {
    const checks: SelfTestResult["checks"] = [];
    checks.push({ name: "endpoint-configured", pass: this.hasEndpoint(), detail: this.cfg.endpoint ?? "(none)" });
    checks.push({ name: "estop-tag-mapped", pass: !!this.cfg.tags?.estopActive });
    checks.push({
      name: "dual-channel-tags-mapped",
      pass: !!(this.cfg.tags?.estopChannelA && this.cfg.tags?.estopChannelB),
      detail: "FAT requires independent channel A/B monitoring",
    });
    // Reachability probe (non-actuating).
    const reach = this.hasEndpoint() ? await this.readBoolTag(this.cfg.tags?.estopActive) : { quality: "unknown" as ReadQuality };
    checks.push({ name: "diagnostic-reachable", pass: reach.quality === "good", detail: reach.detail });
    // The gating check: rated HW present + certified. Skeleton → always fails.
    checks.push({
      name: "rated-hardware-certified",
      pass: false,
      detail: "no certified Safety-PLC bound — see docs/SAFETY_PLC_ADAPTER.md (FAT <100ms dual-channel required)",
    });
    return {
      ok: false, // not commissioned
      rated: false,
      checks,
      message: `${this.vendor} skeleton self-test — NOT commissioned; software interlock is the only active stop path.`,
    };
  }

  label(): string {
    const where = this.hasEndpoint() ? `${this.cfg.protocol} @ ${this.cfg.endpoint}` : "no endpoint";
    return `${this.vendor} skeleton (${where}) — NOT safety-rated`;
  }
}

/**
 * Pilz PNOZmulti / PSS skeleton — diagnostic interface over Modbus-TCP by default.
 * Actuation is a no-op (isRated()=false) until the certified unit is wired + FAT'd.
 */
export class PilzPnozMultiAdapter extends BaseVendorSafetyPlcAdapter {
  readonly vendor = "pilz" as const;
  constructor(cfg: Partial<SafetyPlcVendorConfig> = {}) {
    super("pilz-pnozmulti", { protocol: cfg.protocol ?? "modbus", ...cfg });
  }
}

/**
 * Sick Flexi Soft skeleton — diagnostic interface over EtherNet/IP by default.
 * Actuation is a no-op (isRated()=false) until the certified unit is wired + FAT'd.
 */
export class SickFlexiSoftAdapter extends BaseVendorSafetyPlcAdapter {
  readonly vendor = "sick" as const;
  constructor(cfg: Partial<SafetyPlcVendorConfig> = {}) {
    super("sick-flexisoft", { protocol: cfg.protocol ?? "ethernet-ip", ...cfg });
  }
}

/**
 * Build a vendor adapter from a vendor id + config (commissioning helper).
 */
export function createVendorAdapter(
  vendor: "pilz" | "sick",
  cfg: Partial<SafetyPlcVendorConfig> = {},
): SafetyPlcVendorAdapter {
  return vendor === "pilz" ? new PilzPnozMultiAdapter(cfg) : new SickFlexiSoftAdapter(cfg);
}

/**
 * Register a vendor adapter into the estop registry (delegates to
 * registerSafetyPlcAdapter). Called ONLY by an explicit commissioning step —
 * NEVER at import time. Returns the previously-registered adapter.
 *
 * ⚠ Registering a SKELETON does not make e-stop safety-rated: isRated() stays
 * false and triggerEmergencyStop() still does not actuate. Only a real, certified
 * adapter (isRated()===true) backed by installed + FAT-passed hardware provides a
 * rated stop. See docs/SAFETY_PLC_ADAPTER.md.
 */
export function registerVendorAdapter(adapter: SafetyPlcVendorAdapter): SafetyPlcAdapter {
  return registerSafetyPlcAdapter(adapter);
}
