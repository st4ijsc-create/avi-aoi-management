/**
 * Image acquisition framework — public entrypoint + gated source factory.
 *
 * `createImageSource(kind, opts)` is the ONE place the LIVE_ACQUISITION_ENABLED flag gates
 * hardware: offline sources (file/mock) are always constructable; a LIVE device source
 * (genicam) throws AcquisitionDisabledError until the flag is on — and even then the GenICam
 * stub throws GenICamNotConfiguredError until a real driver is bound. Two independent safety
 * layers, no ungated device path.
 *
 * A real GigE Vision / GenICam driver (harvesters / aravis / a vendor GenTL producer) plugs
 * in by satisfying the ImageSource contract behind the "genicam" kind (see genICamImageSource.ts).
 */
import {
  AcquisitionDisabledError,
  isLiveAcquisitionEnabled,
  isLiveSourceKind,
  type ImageSource,
  type ImageSourceKind,
} from "./imageSource";
import { FileImageSource, type FileImageSourceOptions } from "./fileImageSource";
import { MockImageSource, type MockImageSourceOptions } from "./mockImageSource";
import { GenICamImageSource, type GenICamImageSourceOptions } from "./genICamImageSource";

/** Options accepted by createImageSource, discriminated by `kind`. */
export type CreateImageSourceOptions =
  | ({ kind: "file" } & FileImageSourceOptions)
  | ({ kind: "mock" } & MockImageSourceOptions)
  | ({ kind: "genicam" } & GenICamImageSourceOptions);

/**
 * Construct a source by kind. LIVE device kinds are refused unless LIVE_ACQUISITION_ENABLED
 * is on (AcquisitionDisabledError). Offline sources are always allowed.
 */
export function createImageSource(opts: CreateImageSourceOptions): ImageSource {
  const kind = opts.kind;
  if (isLiveSourceKind(kind) && !isLiveAcquisitionEnabled()) {
    throw new AcquisitionDisabledError(
      `Live image acquisition is disabled — cannot create a "${kind}" (live device) source. ` +
        `Set LIVE_ACQUISITION_ENABLED=true to enable (a real camera driver must still be bound; ` +
        `see genICamImageSource.ts). Offline sources ("file", "mock") are always available.`,
    );
  }
  switch (kind) {
    case "file":
      return new FileImageSource(opts);
    case "mock":
      return new MockImageSource(opts);
    case "genicam":
      return new GenICamImageSource(opts);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown image source kind: ${String(_exhaustive)}`);
    }
  }
}

/** Metadata about a supported source kind (for UI discovery). */
export interface ImageSourceKindInfo {
  kind: ImageSourceKind;
  label: string;
  /** True when the kind talks to real hardware (gated by LIVE_ACQUISITION_ENABLED). */
  live: boolean;
  /** True when the kind is usable right now (offline OR flag-on). */
  available: boolean;
  description: string;
}

/** Discover the built-in source kinds + whether each is usable under the current flag. */
export function listImageSourceKinds(): ImageSourceKindInfo[] {
  const liveOn = isLiveAcquisitionEnabled();
  return [
    {
      kind: "file",
      label: "File / Directory replay",
      live: false,
      available: true,
      description: "Replay frames from a directory, an explicit file list, or in-memory buffers.",
    },
    {
      kind: "mock",
      label: "Synthetic (mock)",
      live: false,
      available: true,
      description: "Deterministic synthetic frames — no camera, no disk (dev/test).",
    },
    {
      kind: "genicam",
      label: "GenICam / GigE Vision (stub)",
      live: true,
      available: liveOn,
      description:
        "Seam for a real GigE Vision / GenICam camera (harvesters / aravis / vendor GenTL). " +
        "Gated by LIVE_ACQUISITION_ENABLED; throws not-configured until a driver is bound.",
    },
  ];
}

// ── Re-exports ────────────────────────────────────────────────────────────────
export {
  // types + interface
  type Frame,
  type FrameMetadata,
  type ImageSource,
  type ImageSourceKind,
  type ImageSourceOptions,
  type AcquiredBuffer,
  type TriggerMode,
  // base + helpers
  BaseImageSource,
  isEncodedImageFormat,
  mimeForPixelFormat,
  // flag + gate
  isLiveAcquisitionEnabled,
  isLiveSourceKind,
  LIVE_SOURCE_KINDS,
  AcquisitionDisabledError,
} from "./imageSource";

export { FileImageSource, type FileImageSourceOptions } from "./fileImageSource";
export { MockImageSource, type MockImageSourceOptions } from "./mockImageSource";
export {
  GenICamImageSource,
  GenICamNotConfiguredError,
  type GenICamImageSourceOptions,
} from "./genICamImageSource";
export {
  frameToCanonicalInspection,
  frameToDataUrl,
  frameImageBuffer,
  embedFrame,
  type FrameInspectionContext,
  type EmbedFrameOptions,
} from "./frameToCanonicalInspection";
