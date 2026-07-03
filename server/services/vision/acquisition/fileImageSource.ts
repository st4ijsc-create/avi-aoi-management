/**
 * FileImageSource — replay frames from disk or from in-memory buffers.
 *
 * An offline `ImageSource` for dev/test/replay: it needs NO camera. Feed it any of:
 *   • `buffers`   — an ordered list of image byte buffers (fully in-memory; no disk).
 *   • `buffer`    — a single image buffer (convenience for one-shot).
 *   • `files`     — an explicit ordered list of file paths.
 *   • `directory` — a folder; all files whose extension matches `extensions` (default the
 *                   common image types) are enumerated + sorted by name at open().
 *
 * `directory` + `extensions` is the simple, dependency-free "glob" (e.g. every *.png in a
 * capture folder). Provide `files` for exact ordering / cross-directory sets.
 *
 * Grab order follows the resolved list; when exhausted, grab() throws unless `loop` is set
 * (then it wraps to the start — useful for a soak/replay loop). pixelFormat is inferred from
 * the file extension; width/height are left undefined (we do not decode — honest: the source
 * only reports what it actually knows without pulling in an image decoder).
 */
import { promises as fs } from "fs";
import path from "path";
import {
  BaseImageSource,
  type AcquiredBuffer,
  type ImageSourceKind,
  type ImageSourceOptions,
} from "./imageSource";

const DEFAULT_EXTENSIONS = ["jpg", "jpeg", "png", "bmp", "webp", "tif", "tiff"];

export interface FileImageSourceOptions extends ImageSourceOptions {
  /** In-memory frames, in grab order (no disk access). */
  buffers?: Buffer[];
  /** A single in-memory frame (convenience). */
  buffer?: Buffer;
  /** Explicit ordered file paths. */
  files?: string[];
  /** A directory to enumerate (files sorted by name). */
  directory?: string;
  /** Extensions to include when scanning `directory` (no dot; default common image types). */
  extensions?: string[];
  /** Wrap to the first frame after the last instead of throwing at end-of-list. Default false. */
  loop?: boolean;
}

/** One resolved item to grab: either an in-memory buffer or a lazily-read file path. */
type Item = { buffer: Buffer; pixelFormat?: string } | { file: string; pixelFormat?: string };

/** Map a file extension (no dot) to a pixel/encoding format name, or undefined if unknown. */
function formatFromExt(ext: string): string | undefined {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (!e) return undefined;
  if (e === "jpg") return "jpeg";
  if (e === "tif") return "tiff";
  if (DEFAULT_EXTENSIONS.includes(e)) return e;
  return undefined;
}

export class FileImageSource extends BaseImageSource {
  readonly kind: ImageSourceKind = "file";

  private readonly opts: FileImageSourceOptions;
  private items: Item[] = [];
  private cursor = 0;

  constructor(opts: FileImageSourceOptions = {}) {
    super("file-source", opts);
    this.opts = opts;
  }

  protected async onOpen(): Promise<void> {
    const items: Item[] = [];

    // 1) In-memory buffers (buffers[] then single buffer).
    for (const b of this.opts.buffers ?? []) {
      items.push({ buffer: b });
    }
    if (this.opts.buffer) items.push({ buffer: this.opts.buffer });

    // 2) Explicit files.
    for (const f of this.opts.files ?? []) {
      items.push({ file: f, pixelFormat: formatFromExt(path.extname(f)) });
    }

    // 3) Directory scan (the dependency-free "glob").
    if (this.opts.directory) {
      const exts = (this.opts.extensions ?? DEFAULT_EXTENSIONS).map((e) =>
        e.replace(/^\./, "").toLowerCase(),
      );
      let entries: string[];
      try {
        entries = await fs.readdir(this.opts.directory);
      } catch (e) {
        throw new Error(
          `FileImageSource: cannot read directory "${this.opts.directory}": ${
            (e as Error)?.message ?? e
          }`,
        );
      }
      const matched = entries
        .filter((name) => exts.includes(path.extname(name).replace(/^\./, "").toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => path.join(this.opts.directory!, name));
      for (const f of matched) {
        items.push({ file: f, pixelFormat: formatFromExt(path.extname(f)) });
      }
    }

    if (items.length === 0) {
      throw new Error(
        "FileImageSource: no frames resolved — provide `buffers`, `buffer`, `files` or a `directory`.",
      );
    }
    this.items = items;
    this.cursor = 0;
  }

  protected async onClose(): Promise<void> {
    this.items = [];
    this.cursor = 0;
  }

  /** Number of frames resolved at open() (0 before open). */
  get length(): number {
    return this.items.length;
  }

  protected async acquire(): Promise<AcquiredBuffer> {
    if (this.cursor >= this.items.length) {
      if (this.opts.loop) {
        this.cursor = 0;
      } else {
        throw new Error(
          `FileImageSource "${this.sourceId}": no more frames (${this.items.length} exhausted; set loop:true to replay).`,
        );
      }
    }
    const item = this.items[this.cursor++];
    if ("buffer" in item) {
      return { data: item.buffer, pixelFormat: item.pixelFormat, extras: { source: "buffer" } };
    }
    let data: Buffer;
    try {
      data = await fs.readFile(item.file);
    } catch (e) {
      throw new Error(
        `FileImageSource: failed to read "${item.file}": ${(e as Error)?.message ?? e}`,
      );
    }
    return { data, pixelFormat: item.pixelFormat, extras: { sourceFile: item.file } };
  }
}
