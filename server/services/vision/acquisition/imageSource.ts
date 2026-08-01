/**
 * Image ACQUISITION framework — pluggable `ImageSource` seam (doc 24, AOI/AVI pillar).
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A vendor-neutral way to GRAB a frame (image bytes + metadata) from *some* source
 * and feed it into the SAME canonical inspection pipeline the rest of the platform
 * already uses (see visionAdapterRegistry.ts + frameToCanonicalInspection.ts). It is
 * the acquisition analogue of the vision ADAPTER registry: adapters map a vendor's
 * *result payload* → canonical inspection; sources map a *live/stored image* → a frame
 * that can then be inspected/embedded.
 *
 * The point of the seam is that a REAL industrial camera driver (GigE Vision / GenICam
 * via `harvesters` [Python] or `aravis` [C] or a vendor GenTL producer .cti) plugs in
 * behind THIS interface later, WITHOUT changing anything downstream. Two offline
 * sources ship today so the whole pipeline is buildable + testable WITH NO CAMERA:
 *   • FileImageSource — replays images from a directory / explicit file list / buffers.
 *   • MockImageSource — deterministic synthetic frames.
 * A GenICamImageSource STUB documents exactly where the real driver binds and throws an
 * honest "no camera driver configured" error (mirrors sim/physics ExternalPhysicsBackend).
 *
 * ── HONESTY ─────────────────────────────────────────────────────────────────
 * Grabbing a frame is ACQUISITION, not judgement. A frame carries pixels + metadata,
 * never an OK/NG verdict — `frameToCanonicalInspection` defaults the result to "NTF"
 * (needs inspection) unless the caller supplies a verdict from an actual inspection.
 *
 * ── GATING ──────────────────────────────────────────────────────────────────
 * Flag LIVE_ACQUISITION_ENABLED (default OFF). Offline sources (file/mock) are always
 * constructable (they touch no hardware and are needed for tests/dev). LIVE device
 * sources (genicam) are refused with AcquisitionDisabledError until the flag is on — and
 * even then the stub throws not-configured until a real driver is bound.
 */

/** How a source produces the next frame. */
export type TriggerMode = "continuous" | "software-trigger" | "hardware-trigger";

/** Discriminator for the built-in source kinds. */
export type ImageSourceKind = "file" | "mock" | "genicam";

/**
 * Per-frame metadata. Field names mirror the vocabulary a GenICam camera reports
 * (frame id / timestamp / exposure / gain / pixel format / dimensions) so a real driver
 * fills the SAME shape. All hardware-derived fields are optional — a source only sets
 * the ones it actually knows (offline sources never fabricate an exposure it didn't have).
 */
export interface FrameMetadata {
  /** Which source produced this frame. */
  sourceId: string;
  /** Monotonic per-source frame counter, starting at 1 (the GenICam "frame ID"). */
  frameId: number;
  /** ISO-8601 acquisition time. */
  timestamp: string;
  /** Trigger mode in effect when this frame was grabbed. */
  triggerMode: TriggerMode;
  /** Exposure time (ms) if the source knows it. */
  exposureMs?: number;
  /** Analog/digital gain if the source knows it. */
  gain?: number;
  /** Frame width in pixels, when known. */
  width?: number;
  /** Frame height in pixels, when known. */
  height?: number;
  /**
   * Pixel / encoding format. Either a GenICam PFNC name for RAW sensor data
   * ("Mono8", "RGB8", "BayerRG8", …) or an encoded container ("jpeg", "png", "bmp").
   * `isEncodedImageFormat` tells the two apart.
   */
  pixelFormat?: string;
  /** Source-specific extras (e.g. hardwareTriggerEmulated, sourceFile, synthetic). */
  extras?: Record<string, unknown>;
}

/** One grabbed frame: raw image bytes + metadata. */
export interface Frame {
  /** Encoded image bytes (jpeg/png/…) or raw pixel bytes, exactly as the source produced. */
  data: Buffer;
  metadata: FrameMetadata;
}

/** Common construction options for the built-in sources. */
export interface ImageSourceOptions {
  /** Stable id for this source instance (defaults per source kind). */
  sourceId?: string;
  /** Trigger mode (default "continuous"). */
  triggerMode?: TriggerMode;
  /** Exposure (ms) to stamp on every frame's metadata, if the source has no real value. */
  exposureMs?: number;
  /** Gain to stamp on every frame's metadata. */
  gain?: number;
}

/**
 * The pluggable acquisition contract. Implementations must be safe to `open()` more than
 * once (idempotent) and must NOT touch a real device unless they genuinely represent one.
 *
 *   open()   — acquire the source (open file list / connect the camera / arm the grabber).
 *   grab()   — return the next Frame per the trigger mode. Throws if not open.
 *   close()  — release the source. Idempotent.
 *   isOpen() — current state.
 *   softwareTrigger() — (optional) fire one software trigger; only in software-trigger mode.
 */
export interface ImageSource {
  readonly kind: ImageSourceKind;
  readonly sourceId: string;
  readonly triggerMode: TriggerMode;
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  grab(): Promise<Frame>;
  softwareTrigger?(): Promise<void>;
}

/**
 * What a concrete offline source returns from its `acquire()` hook: the bytes plus any
 * dimensions/format it genuinely knows. BaseImageSource assembles the full FrameMetadata
 * (frame id, timestamp, trigger mode) around it.
 */
export interface AcquiredBuffer {
  data: Buffer;
  width?: number;
  height?: number;
  pixelFormat?: string;
  extras?: Record<string, unknown>;
}

/** Encoded/container image formats we can wrap into a renderable data-URL as-is. */
const ENCODED_FORMATS = new Set(["jpeg", "jpg", "png", "bmp", "webp", "gif", "tiff", "tif"]);

/** True when `pixelFormat` names an encoded image (vs raw sensor data like Mono8/BayerRG8). */
export function isEncodedImageFormat(pixelFormat: string | undefined): boolean {
  return !!pixelFormat && ENCODED_FORMATS.has(pixelFormat.toLowerCase());
}

/** MIME type for an encoded pixelFormat, or undefined for raw/unknown formats. */
export function mimeForPixelFormat(pixelFormat: string | undefined): string | undefined {
  if (!pixelFormat) return undefined;
  const f = pixelFormat.toLowerCase();
  if (!ENCODED_FORMATS.has(f)) return undefined;
  if (f === "jpg" || f === "jpeg") return "image/jpeg";
  if (f === "tif" || f === "tiff") return "image/tiff";
  return `image/${f}`;
}

/**
 * Shared base for OFFLINE sources (file/mock): owns the open/close lifecycle, the monotonic
 * frame counter and the metadata assembly. A concrete source only implements `acquire()`
 * (produce the next byte buffer) and, optionally, `onOpen`/`onClose`.
 */
export abstract class BaseImageSource implements ImageSource {
  abstract readonly kind: ImageSourceKind;
  readonly sourceId: string;
  readonly triggerMode: TriggerMode;
  protected readonly exposureMs?: number;
  protected readonly gain?: number;

  /** Offline sources have no real trigger line — hardware-trigger is emulated + flagged. */
  protected readonly emulatesHardwareTrigger: boolean = true;

  private _open = false;
  private _frameId = 0;

  protected constructor(defaultSourceId: string, opts: ImageSourceOptions = {}) {
    this.sourceId = (opts.sourceId ?? defaultSourceId).toString();
    this.triggerMode = opts.triggerMode ?? "continuous";
    this.exposureMs = opts.exposureMs;
    this.gain = opts.gain;
  }

  isOpen(): boolean {
    return this._open;
  }

  async open(): Promise<void> {
    if (this._open) return;
    await this.onOpen();
    this._open = true;
  }

  async close(): Promise<void> {
    if (!this._open) return;
    try {
      await this.onClose();
    } finally {
      this._open = false;
    }
  }

  async grab(): Promise<Frame> {
    if (!this._open) {
      throw new Error(
        `${this.kind} source "${this.sourceId}" is not open — call open() before grab().`,
      );
    }
    const acq = await this.acquire();
    const frameId = ++this._frameId;

    const extras: Record<string, unknown> = { ...(acq.extras ?? {}) };
    if (this.triggerMode === "hardware-trigger" && this.emulatesHardwareTrigger) {
      extras.hardwareTriggerEmulated = true;
    }

    const metadata: FrameMetadata = {
      sourceId: this.sourceId,
      frameId,
      timestamp: new Date().toISOString(),
      triggerMode: this.triggerMode,
      exposureMs: this.exposureMs,
      gain: this.gain,
      width: acq.width,
      height: acq.height,
      pixelFormat: acq.pixelFormat,
      extras: Object.keys(extras).length ? extras : undefined,
    };
    return { data: acq.data, metadata };
  }

  /**
   * Fire one software trigger. Meaningful only in software-trigger mode; for the offline
   * replay sources a grab() already performs the acquisition, so this is a semantic marker
   * (one-shot arm) that validates the caller is using the mode correctly.
   */
  async softwareTrigger(): Promise<void> {
    if (this.triggerMode !== "software-trigger") {
      throw new Error(
        `softwareTrigger() is valid only in software-trigger mode ` +
          `(source "${this.sourceId}" is "${this.triggerMode}").`,
      );
    }
    // Offline sources need no buffering — the next grab() returns the triggered frame.
  }

  /** Frames grabbed so far from this source. */
  get framesGrabbed(): number {
    return this._frameId;
  }

  // ── Subclass hooks ──
  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}
  /** Produce the next frame's bytes (+ any dims/format the source genuinely knows). */
  protected abstract acquire(): Promise<AcquiredBuffer>;
}

// ── Flag ────────────────────────────────────────────────────────────────────

/** LIVE_ACQUISITION_ENABLED — default OFF. Gates construction of LIVE device sources. */
export function isLiveAcquisitionEnabled(): boolean {
  return process.env.LIVE_ACQUISITION_ENABLED === "true";
}

/** Source kinds that talk to real hardware and are therefore gated by the flag. */
export const LIVE_SOURCE_KINDS: readonly ImageSourceKind[] = ["genicam"] as const;

/** True when the kind represents a live device (gated) vs an offline source (always allowed). */
export function isLiveSourceKind(kind: ImageSourceKind): boolean {
  return LIVE_SOURCE_KINDS.includes(kind);
}

/**
 * Thrown when a LIVE device source is requested while LIVE_ACQUISITION_ENABLED is OFF.
 * Distinct from GenICamNotConfiguredError: this is the FLAG gate (feature off), that one is
 * the DRIVER seam (feature on, but no camera driver bound).
 */
export class AcquisitionDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcquisitionDisabledError";
  }
}
