/**
 * Image ACQUISITION framework tests (doc 24 AOI/AVI).
 *
 * Covers:
 *   - MockImageSource: deterministic synthetic frames + metadata (frameId/timestamp/format);
 *     two instances agree; maxFrames exhaustion; grab-before-open throws.
 *   - FileImageSource: in-memory buffers, explicit files, directory scan (the "glob"), order,
 *     loop wrap, end-of-list throw; pixelFormat inferred from extension.
 *   - frameToCanonicalInspection: raw frame → canonical (NTF default, serial default, no fake
 *     image for raw formats); encoded png frame → data-URL image; ctx overrides + measurements.
 *   - embedFrame: injected embedder used; honest-degrades to null with no model.
 *   - createImageSource gate: file/mock always allowed; genicam refused (AcquisitionDisabledError)
 *     when LIVE_ACQUISITION_ENABLED off; allowed but GenICamNotConfiguredError when on.
 *   - listImageSourceKinds reflects the flag.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import {
  MockImageSource,
  FileImageSource,
  createImageSource,
  listImageSourceKinds,
  frameToCanonicalInspection,
  frameToDataUrl,
  frameImageBuffer,
  embedFrame,
  isEncodedImageFormat,
  AcquisitionDisabledError,
  GenICamImageSource,
  GenICamNotConfiguredError,
} from "./index";

const FLAG = "LIVE_ACQUISITION_ENABLED";

describe("MockImageSource", () => {
  it("grabs deterministic synthetic frames with metadata", async () => {
    const src = new MockImageSource({ width: 8, height: 4, pixelFormat: "Mono8", sourceId: "mock-A" });
    expect(src.isOpen()).toBe(false);
    await src.open();
    expect(src.isOpen()).toBe(true);

    const f1 = await src.grab();
    const f2 = await src.grab();

    expect(f1.metadata.sourceId).toBe("mock-A");
    expect(f1.metadata.frameId).toBe(1);
    expect(f2.metadata.frameId).toBe(2);
    expect(f1.metadata.width).toBe(8);
    expect(f1.metadata.height).toBe(4);
    expect(f1.metadata.pixelFormat).toBe("Mono8");
    expect(f1.metadata.triggerMode).toBe("continuous");
    expect(typeof f1.metadata.timestamp).toBe("string");
    expect(f1.metadata.extras).toMatchObject({ synthetic: true });
    // Mono8: width*height bytes.
    expect(f1.data.length).toBe(8 * 4);
    // Consecutive frames differ (frameId shifts the pattern).
    expect(Buffer.compare(f1.data, f2.data)).not.toBe(0);

    await src.close();
    expect(src.isOpen()).toBe(false);
  });

  it("is deterministic across two instances with the same options", async () => {
    const a = new MockImageSource({ width: 6, height: 6, seed: 3 });
    const b = new MockImageSource({ width: 6, height: 6, seed: 3 });
    await a.open();
    await b.open();
    const fa = await a.grab();
    const fb = await b.grab();
    expect(Buffer.compare(fa.data, fb.data)).toBe(0);
  });

  it("RGB8 produces 3 bytes/pixel", async () => {
    const src = new MockImageSource({ width: 5, height: 5, pixelFormat: "RGB8" });
    await src.open();
    const f = await src.grab();
    expect(f.data.length).toBe(5 * 5 * 3);
    expect(f.metadata.pixelFormat).toBe("RGB8");
  });

  it("throws when grabbing before open, and when exhausted", async () => {
    const src = new MockImageSource({ maxFrames: 1 });
    await expect(src.grab()).rejects.toThrow(/not open/i);
    await src.open();
    await src.grab();
    await expect(src.grab()).rejects.toThrow(/exhausted/i);
  });

  it("software-trigger mode: softwareTrigger valid only in that mode", async () => {
    const soft = new MockImageSource({ triggerMode: "software-trigger" });
    await soft.open();
    await expect(soft.softwareTrigger()).resolves.toBeUndefined();
    const f = await soft.grab();
    expect(f.metadata.triggerMode).toBe("software-trigger");

    const cont = new MockImageSource({ triggerMode: "continuous" });
    await cont.open();
    await expect(cont.softwareTrigger()).rejects.toThrow(/software-trigger mode/i);
  });

  it("hardware-trigger on an offline source is flagged as emulated", async () => {
    const src = new MockImageSource({ triggerMode: "hardware-trigger" });
    await src.open();
    const f = await src.grab();
    expect(f.metadata.extras).toMatchObject({ hardwareTriggerEmulated: true });
  });
});

describe("FileImageSource", () => {
  it("grabs from in-memory buffers in order", async () => {
    const src = new FileImageSource({
      buffers: [Buffer.from("one"), Buffer.from("two")],
      sourceId: "file-buf",
    });
    await src.open();
    expect(src.length).toBe(2);
    const f1 = await src.grab();
    const f2 = await src.grab();
    expect(f1.data.toString()).toBe("one");
    expect(f2.data.toString()).toBe("two");
    expect(f1.metadata.frameId).toBe(1);
    expect(f2.metadata.frameId).toBe(2);
    // No format known for a bare buffer.
    expect(f1.metadata.pixelFormat).toBeUndefined();
  });

  it("throws at end of list, wraps when loop:true", async () => {
    const noLoop = new FileImageSource({ buffers: [Buffer.from("x")] });
    await noLoop.open();
    await noLoop.grab();
    await expect(noLoop.grab()).rejects.toThrow(/no more frames/i);

    const loop = new FileImageSource({ buffers: [Buffer.from("x")], loop: true });
    await loop.open();
    const a = await loop.grab();
    const b = await loop.grab(); // wraps
    expect(a.data.toString()).toBe("x");
    expect(b.data.toString()).toBe("x");
    expect(b.metadata.frameId).toBe(2);
  });

  it("open() with no source resolved throws", async () => {
    const src = new FileImageSource({});
    await expect(src.open()).rejects.toThrow(/no frames resolved/i);
  });

  describe("disk-backed", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "acq-test-"));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("reads explicit files and infers pixelFormat from extension", async () => {
      const p1 = path.join(dir, "a.png");
      await fs.writeFile(p1, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // arbitrary bytes
      const src = new FileImageSource({ files: [p1] });
      await src.open();
      const f = await src.grab();
      expect(f.metadata.pixelFormat).toBe("png");
      expect(f.metadata.extras).toMatchObject({ sourceFile: p1 });
      expect(f.data.length).toBe(4);
    });

    it("scans a directory (the dependency-free glob), sorted by name", async () => {
      await fs.writeFile(path.join(dir, "b.jpg"), Buffer.from("B"));
      await fs.writeFile(path.join(dir, "a.jpg"), Buffer.from("A"));
      await fs.writeFile(path.join(dir, "ignore.txt"), Buffer.from("nope"));
      const src = new FileImageSource({ directory: dir });
      await src.open();
      expect(src.length).toBe(2); // txt excluded
      const f1 = await src.grab();
      const f2 = await src.grab();
      expect(f1.data.toString()).toBe("A"); // a.jpg sorts first
      expect(f2.data.toString()).toBe("B");
      expect(f1.metadata.pixelFormat).toBe("jpeg");
    });
  });
});

describe("frameToCanonicalInspection", () => {
  it("raw frame → canonical NTF with default serial and NO fabricated image", async () => {
    const src = new MockImageSource({ width: 4, height: 4, sourceId: "cam1" });
    await src.open();
    const frame = await src.grab();

    const insp = frameToCanonicalInspection(frame, { machineCode: "AOI-1" });
    expect(insp.machineCode).toBe("AOI-1");
    expect(insp.overallResult).toBe("NTF"); // acquisition ≠ judgement
    expect(insp.serialNumber).toBe("cam1-1"); // <sourceId>-<frameId>
    expect(insp.inspectionTime).toBe(frame.metadata.timestamp);
    expect(insp.measurements).toHaveLength(1);
    expect(insp.measurements[0].pointCode).toBe("FRAME");
    expect(insp.measurements[0].result).toBe("NTF");
    // Mono8 is raw → NOT encoded → no data-URL image.
    expect(isEncodedImageFormat(frame.metadata.pixelFormat)).toBe(false);
    expect(insp.measurements[0].imageBase64).toBeUndefined();
    expect(frameToDataUrl(frame)).toBeUndefined();
    // frameImageBuffer is exactly the bytes (embedding input).
    expect(frameImageBuffer(frame)).toBe(frame.data);
  });

  it("encoded png frame → data-URL image attached", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acq-png-"));
    try {
      const p = path.join(dir, "board.png");
      const bytes = Buffer.from([1, 2, 3, 4, 5]);
      await fs.writeFile(p, bytes);
      const src = new FileImageSource({ files: [p] });
      await src.open();
      const frame = await src.grab();

      const url = frameToDataUrl(frame);
      expect(url).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
      const insp = frameToCanonicalInspection(frame, { machineCode: "AOI-2", serialNumber: "SN-9" });
      expect(insp.serialNumber).toBe("SN-9");
      expect(insp.measurements[0].imageBase64).toBe(url);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("honors ctx overallResult + explicit measurements", async () => {
    const src = new MockImageSource();
    await src.open();
    const frame = await src.grab();
    const insp = frameToCanonicalInspection(frame, {
      machineCode: "AOI-3",
      overallResult: "OK",
      measurements: [
        { pointCode: "P1", result: "OK", measuredValue: 1 },
        { pointCode: "P2", result: "NG", measuredValue: 9 },
      ],
    });
    expect(insp.overallResult).toBe("OK"); // explicit wins over derive
    expect(insp.measurements).toHaveLength(2);
  });
});

describe("embedFrame", () => {
  it("uses an injected embedder", async () => {
    const src = new MockImageSource();
    await src.open();
    const frame = await src.grab();
    const res = await embedFrame(frame, {
      embed: async (buf) => ({ embedding: [buf.length], dim: 1, modelCode: "test", processingTimeMs: 0 }),
    });
    expect(res).toMatchObject({ modelCode: "test", dim: 1 });
    expect(res?.embedding[0]).toBe(frame.data.length);
  });

  it("honest-degrades to null when no model/DB is available", async () => {
    const src = new MockImageSource();
    await src.open();
    const frame = await src.grab();
    // No AI_EMBEDDING model registered in the isolated test DB → null (never fabricated).
    const res = await embedFrame(frame, { modelCode: "definitely-not-a-real-model" });
    expect(res).toBeNull();
  });
});

describe("createImageSource gate (LIVE_ACQUISITION_ENABLED)", () => {
  const prev = process.env[FLAG];
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  it("flag OFF → file/mock allowed, genicam refused (no acquisition)", () => {
    delete process.env[FLAG];
    expect(createImageSource({ kind: "mock" })).toBeInstanceOf(MockImageSource);
    expect(createImageSource({ kind: "file", buffers: [Buffer.from("x")] })).toBeInstanceOf(FileImageSource);
    expect(() => createImageSource({ kind: "genicam", deviceId: "cam-1" })).toThrow(AcquisitionDisabledError);
    expect(() => createImageSource({ kind: "genicam" })).toThrow(/disabled/i);

    const kinds = listImageSourceKinds();
    expect(kinds.find((k) => k.kind === "genicam")?.available).toBe(false);
    expect(kinds.find((k) => k.kind === "file")?.available).toBe(true);
  });

  it("flag ON → genicam constructs but open()/grab() throw not-configured", async () => {
    process.env[FLAG] = "true";
    const src = createImageSource({ kind: "genicam", deviceId: "cam-1" });
    expect(src).toBeInstanceOf(GenICamImageSource);
    expect(src.isOpen()).toBe(false);
    await expect(src.open()).rejects.toBeInstanceOf(GenICamNotConfiguredError);
    await expect(src.grab()).rejects.toThrow(/not configured/i);
    await expect(src.close()).resolves.toBeUndefined();

    expect(listImageSourceKinds().find((k) => k.kind === "genicam")?.available).toBe(true);
  });
});
