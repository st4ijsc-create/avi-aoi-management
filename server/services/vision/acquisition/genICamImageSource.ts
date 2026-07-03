/**
 * GenICamImageSource — DOCUMENTED STUB for a real industrial-camera driver.
 *
 * This is the acquisition analogue of sim/physics `ExternalPhysicsBackend`: it defines the
 * exact contract a REAL GigE Vision / GenICam camera driver must satisfy behind the
 * `ImageSource` interface, and THROWS an honest `GenICamNotConfiguredError` when opened/
 * grabbed, because no camera driver is bound in this process. There is NO fabricated frame
 * and NO silent success — the failure is self-documenting.
 *
 * ── WHY A STUB (no real SDK dependency) ─────────────────────────────────────
 * Real GenICam acquisition needs a native GenTL "producer" (.cti) plus a transport binding —
 * none of which can be vendored here and none of which run without a physical camera:
 *   • harvesters  — Python GenICam/GenTL harness (via a Python bridge / sidecar), OR
 *   • aravis      — GObject/C GigE-Vision library (via node-gtk / a native addon), OR
 *   • a VENDOR GenTL producer .cti (Basler pylon, FLIR Spinnaker, Baumer, Matrix Vision …).
 *
 * ── INTEGRATION CONTRACT (what a real binding must do) ──────────────────────
 * A real GenICam source, on `open()`, would:
 *   1. Load the GenTL producer (.cti from `producerCti` / GENICAM_GENTL64_PATH), enumerate
 *      interfaces + devices, and open the device matching `deviceId` (serial / user id / MAC).
 *   2. Configure the node map: PixelFormat, ExposureTime (→ metadata.exposureMs), Gain,
 *      AcquisitionMode, and the trigger (TriggerMode/TriggerSource) per this.triggerMode
 *      (continuous free-run | software TriggerSoftware | hardware Line0/…).
 *   3. Start the acquisition engine + announce/queue buffers.
 * and on `grab()` would pull one filled buffer, copy its payload into a Node Buffer, read the
 * chunk-data timestamp/frame-id/exposure, requeue the buffer, and return the SAME `Frame`
 * shape the offline sources return — so everything downstream is unchanged.
 *
 * Binding is out of scope for this repo (needs the native producer + hardware). Until then,
 * open()/grab() throw. Selection is additionally gated by LIVE_ACQUISITION_ENABLED (see
 * createImageSource) — this stub is only ever reachable when that flag is on.
 */
import type {
  Frame,
  ImageSource,
  ImageSourceKind,
  TriggerMode,
} from "./imageSource";

export interface GenICamImageSourceOptions {
  sourceId?: string;
  triggerMode?: TriggerMode;
  /** Device selector — serial number / user-defined name / MAC of the target camera. */
  deviceId?: string;
  /** Path to the GenTL producer (.cti). Falls back to GENICAM_GENTL64_PATH at bind time. */
  producerCti?: string;
  /** Desired GenICam PixelFormat (e.g. "Mono8", "BayerRG8", "RGB8"). */
  pixelFormat?: string;
  /** Desired exposure time (ms) to program into the node map. */
  exposureMs?: number;
  /** Desired gain to program into the node map. */
  gain?: number;
}

/**
 * Thrown when a GenICam source is opened/grabbed but no real camera driver is bound.
 * Carries the integration contract in the message so the failure is self-documenting.
 * Distinct from AcquisitionDisabledError (the LIVE_ACQUISITION_ENABLED flag gate).
 */
export class GenICamNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenICamNotConfiguredError";
  }
}

export class GenICamImageSource implements ImageSource {
  readonly kind: ImageSourceKind = "genicam";
  readonly sourceId: string;
  readonly triggerMode: TriggerMode;

  constructor(private readonly opts: GenICamImageSourceOptions = {}) {
    this.sourceId = opts.sourceId ?? (opts.deviceId ? `genicam:${opts.deviceId}` : "genicam-source");
    this.triggerMode = opts.triggerMode ?? "continuous";
  }

  isOpen(): boolean {
    return false;
  }

  async open(): Promise<void> {
    throw this.notConfigured("open");
  }

  async grab(): Promise<Frame> {
    throw this.notConfigured("grab");
  }

  async close(): Promise<void> {
    // Never opened — nothing to release.
  }

  private notConfigured(op: string): GenICamNotConfiguredError {
    const target =
      this.opts.producerCti ??
      process.env.GENICAM_GENTL64_PATH ??
      "a GenTL producer (.cti: pylon/Spinnaker/aravis/harvesters)";
    return new GenICamNotConfiguredError(
      `GenICam camera driver is NOT configured (source "${this.sourceId}", op "${op}"). ` +
        `LIVE_ACQUISITION_ENABLED is on but no in-process camera driver is bound. ` +
        `Bind a real GigE Vision / GenICam driver behind the ImageSource contract: load ${target}, ` +
        `open device "${this.opts.deviceId ?? "<deviceId>"}", configure PixelFormat/ExposureTime/Gain/Trigger, ` +
        `start acquisition, and return filled buffers as Frame. See genICamImageSource.ts for the full contract.`,
    );
  }
}
