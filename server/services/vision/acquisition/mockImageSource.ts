/**
 * MockImageSource — deterministic SYNTHETIC frames, no camera and no disk.
 *
 * Generates a reproducible raw-pixel buffer per grab so the acquisition pipeline can be
 * exercised end-to-end in tests/dev. Each frame is a `width*height` (× channels) byte
 * buffer whose pixel values are a simple deterministic function of (x, y, frameId), so:
 *   • two MockImageSource instances with the same options produce identical frame bytes,
 *   • consecutive frames differ (the frameId term shifts the pattern) — useful for change
 *     detection / motion-ish tests.
 *
 * Honest: these are SYNTHETIC pixels (a gradient/checker pattern), NOT a photo of a real
 * board — metadata carries `synthetic: true`. Format defaults to raw "Mono8" (1 byte/px);
 * pass pixelFormat "RGB8" for 3 bytes/px. Because the bytes are raw sensor data (not an
 * encoded PNG/JPEG), frameToCanonicalInspection will treat them as raw (no renderable
 * data-URL) unless a real encoder is applied first.
 */
import {
  BaseImageSource,
  type AcquiredBuffer,
  type ImageSourceKind,
  type ImageSourceOptions,
} from "./imageSource";

export interface MockImageSourceOptions extends ImageSourceOptions {
  /** Frame width in pixels (default 64). */
  width?: number;
  /** Frame height in pixels (default 64). */
  height?: number;
  /** Raw pixel format — "Mono8" (1 ch) or "RGB8" (3 ch). Default "Mono8". */
  pixelFormat?: "Mono8" | "RGB8";
  /** Max frames before grab() throws "exhausted"; omit/0 for unlimited. */
  maxFrames?: number;
  /** Deterministic seed mixed into the pattern (default 0). */
  seed?: number;
}

function channelsFor(fmt: string): number {
  return fmt.toUpperCase() === "RGB8" ? 3 : 1;
}

export class MockImageSource extends BaseImageSource {
  readonly kind: ImageSourceKind = "mock";

  private readonly width: number;
  private readonly height: number;
  private readonly fmt: string;
  private readonly channels: number;
  private readonly maxFrames: number;
  private readonly seed: number;

  constructor(opts: MockImageSourceOptions = {}) {
    super("mock-source", opts);
    this.width = Math.max(1, Math.floor(opts.width ?? 64));
    this.height = Math.max(1, Math.floor(opts.height ?? 64));
    this.fmt = opts.pixelFormat ?? "Mono8";
    this.channels = channelsFor(this.fmt);
    this.maxFrames = opts.maxFrames && opts.maxFrames > 0 ? Math.floor(opts.maxFrames) : 0;
    this.seed = Math.floor(opts.seed ?? 0);
  }

  protected async acquire(): Promise<AcquiredBuffer> {
    // framesGrabbed is the count BEFORE this grab is counted; the frame we are about to
    // produce is number (framesGrabbed + 1). Enforce the cap here.
    const nextIndex = this.framesGrabbed + 1;
    if (this.maxFrames && nextIndex > this.maxFrames) {
      throw new Error(
        `MockImageSource "${this.sourceId}": exhausted after ${this.maxFrames} frame(s).`,
      );
    }

    const { width, height, channels } = this;
    const data = Buffer.allocUnsafe(width * height * channels);
    let o = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Deterministic pattern: diagonal gradient shifted by frame index + seed.
        const base = (x + y + nextIndex + this.seed) & 0xff;
        for (let c = 0; c < channels; c++) {
          // Per-channel offset so RGB8 frames are not grey.
          data[o++] = (base + c * 40) & 0xff;
        }
      }
    }

    return {
      data,
      width,
      height,
      pixelFormat: this.fmt,
      extras: { synthetic: true, pattern: "diagonal-gradient", channels },
    };
  }
}
