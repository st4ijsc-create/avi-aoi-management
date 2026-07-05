/**
 * W7-E (doc 27 V12/V13) — height-map seam tests.
 *
 * Covers: env kind resolution (default / per-machine / off / unknown),
 * vendor-passthrough acquisition from canonical rawExtras.points3d,
 * the file source (manifest inline data · bare CSV + payload padBbox ·
 * PNG16 with/without zScale · no sidecar), the device stub honesty, and the
 * end-to-end fail-safe enrichment helper (flag off → byte-for-byte pass-through;
 * flag on + vendor points → native NG verdict; device error → pass-through).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  buildVendorPassthroughAcquisition,
  getHeightMapSource,
  HeightMapNotConfiguredError,
  listHeightMapSources,
  maybeEnrichCanonicalWithHeightMap,
  parseCsvHeightMap,
  resolveHeightMapSourceKind,
  sidecarManifestCandidates,
} from "./heightMapSource";
import type { CanonicalInspection } from "./visionAdapterRegistry";

const ENV_KEYS = ["SPI_3D_NATIVE_ENABLED", "HEIGHT_MAP_SOURCE", "HEIGHT_MAP_SOURCE_SPI_01"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Canonical with one pad carrying 3-D samples: 3×3 px pad at (10,10), Z=40µm. */
function canonicalWithPoints(): CanonicalInspection {
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) points.push({ x, y, z: 40 });
  return {
    serialNumber: "PNL-9",
    overallResult: "OK",
    machineCode: "SPI-01",
    measurements: [
      {
        pointCode: "P1",
        result: "OK",
        measuredValue: 99,
        valueVolume: 99, // vendor pass-through value (native must override when enabled)
        // 40µm mean height vs 100µm nominal → heightPct 40% < 50% ⇒ insufficient.
        rawExtras: { points3d: points, nominalHeight: 100 },
      },
      { pointCode: "NO3D", result: "OK", valueVolume: 55 }, // no samples → untouched
    ],
    rawExtras: { spiCalibration: { umPerPxX: 10, zScale: 1 } },
  };
}

/** Minimal genuine 16-bit grayscale PNG (bitdepth 16, colour type 0). */
function png16Gray(u16: Uint16Array, w: number, h: number): Buffer {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = (table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; //  greyscale
  const raw = Buffer.alloc(h * (1 + w * 2));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw.writeUInt16BE(u16[y * w + x], o);
      o += 2;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let tmpDir: string | null = null;
function mkTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmseam-"));
  return tmpDir;
}
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ── env selection ─────────────────────────────────────────────────────────────

describe("resolveHeightMapSourceKind", () => {
  it("defaults to vendor-passthrough", () => {
    expect(resolveHeightMapSourceKind(null)).toBe("vendor-passthrough");
  });

  it("honours the global env value + off/none/unknown disable", () => {
    process.env.HEIGHT_MAP_SOURCE = "file";
    expect(resolveHeightMapSourceKind("M1")).toBe("file");
    process.env.HEIGHT_MAP_SOURCE = "off";
    expect(resolveHeightMapSourceKind("M1")).toBeNull();
    process.env.HEIGHT_MAP_SOURCE = "banana";
    expect(resolveHeightMapSourceKind("M1")).toBeNull();
  });

  it("per-machine override wins (code sanitized: spi-01 → SPI_01)", () => {
    process.env.HEIGHT_MAP_SOURCE = "vendor-passthrough";
    process.env.HEIGHT_MAP_SOURCE_SPI_01 = "device";
    expect(resolveHeightMapSourceKind("spi-01")).toBe("device");
    expect(resolveHeightMapSourceKind("other")).toBe("vendor-passthrough");
  });
});

// ── vendor-passthrough ────────────────────────────────────────────────────────

describe("vendor-passthrough acquisition", () => {
  it("rasterizes rawExtras.points3d into a height-map + derived pad bbox", () => {
    const acq = buildVendorPassthroughAcquisition(canonicalWithPoints());
    expect(acq).not.toBeNull();
    expect(acq!.pads).toHaveLength(1);
    expect(acq!.pads[0].padId).toBe("P1");
    // Origin-normalized bbox: points spanned x=10..12 → bbox at 0 with w=3.
    expect(acq!.pads[0].bbox).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(acq!.pads[0].nominalHeight).toBe(100);
    expect(acq!.heightMap.width).toBe(3);
    expect(Number(acq!.heightMap.data[0])).toBe(40);
    expect(acq!.calibration?.umPerPxX).toBe(10);
  });

  it("returns null when no measurement carries 3-D samples (honest — no invention)", () => {
    const canonical: CanonicalInspection = {
      serialNumber: "X",
      overallResult: "OK",
      measurements: [{ pointCode: "P1", result: "OK", valueVolume: 99 }],
    };
    expect(buildVendorPassthroughAcquisition(canonical)).toBeNull();
  });
});

// ── file source ───────────────────────────────────────────────────────────────

describe("file source (depth sidecar next to the result file)", () => {
  it("manifest with inline data → height-map + manifest pads + calibration", async () => {
    const dir = mkTmp();
    const resultFile = path.join(dir, "board1.csv");
    fs.writeFileSync(resultFile, "ignored", "utf8");
    const manifest = {
      width: 4,
      height: 4,
      data: new Array(16).fill(50),
      umPerPxX: 10,
      pads: [{ padId: "P1", bbox: { x: 0, y: 0, w: 4, h: 4 }, nominalHeight: 100 }],
    };
    fs.writeFileSync(path.join(dir, "board1.heightmap.json"), JSON.stringify(manifest), "utf8");

    const src = getHeightMapSource("file");
    const acq = await src.acquire({
      canonical: { serialNumber: "S", overallResult: "OK", measurements: [] },
      resultFilePath: resultFile,
    });
    expect(acq).not.toBeNull();
    expect(acq!.heightMap.width).toBe(4);
    expect(Number(acq!.heightMap.data[5])).toBe(50);
    expect(acq!.pads[0].padId).toBe("P1");
    expect(acq!.calibration?.umPerPxX).toBe(10);
  });

  it("bare <stem>.heightmap.csv + pads from measurement rawExtras.padBbox", async () => {
    const dir = mkTmp();
    const resultFile = path.join(dir, "board2.xml");
    fs.writeFileSync(resultFile, "ignored", "utf8");
    fs.writeFileSync(
      path.join(dir, "board2.heightmap.csv"),
      "10,10,10\n10,10,10\n10,10,10\n",
      "utf8",
    );
    const canonical: CanonicalInspection = {
      serialNumber: "S",
      overallResult: "OK",
      measurements: [
        { pointCode: "R1", result: "OK", rawExtras: { padBbox: { x: 0, y: 0, w: 3, h: 3 }, nominalHeight: 20 } },
      ],
    };
    const src = getHeightMapSource("file");
    const acq = await src.acquire({ canonical, resultFilePath: resultFile });
    expect(acq).not.toBeNull();
    expect(acq!.heightMap.height).toBe(3);
    expect(acq!.pads[0].padId).toBe("R1");
  });

  it("PNG16 via manifest decodes real 16-bit gray values (zScale applied)", async () => {
    const dir = mkTmp();
    const resultFile = path.join(dir, "board3.json");
    fs.writeFileSync(resultFile, "{}", "utf8");
    const u16 = new Uint16Array([0, 1000, 2000, 3000]);
    fs.writeFileSync(path.join(dir, "depth.png"), png16Gray(u16, 2, 2));
    fs.writeFileSync(
      path.join(dir, "board3.heightmap.json"),
      JSON.stringify({
        png16: "depth.png",
        zScale: 0.1, // 0.1 µm per DN
        pads: [{ padId: "P1", bbox: { x: 0, y: 0, w: 2, h: 2 } }],
      }),
      "utf8",
    );
    const src = getHeightMapSource("file");
    const acq = await src.acquire({
      canonical: { serialNumber: "S", overallResult: "OK", measurements: [] },
      resultFilePath: resultFile,
    });
    expect(acq).not.toBeNull();
    expect(acq!.heightMap.width).toBe(2);
    expect(Number(acq!.heightMap.data[1])).toBeCloseTo(100, 5); // 1000 DN × 0.1
    expect(Number(acq!.heightMap.data[3])).toBeCloseTo(300, 5);
  });

  it("PNG16 WITHOUT zScale is refused (no fabricated units)", async () => {
    const dir = mkTmp();
    const resultFile = path.join(dir, "board4.json");
    fs.writeFileSync(resultFile, "{}", "utf8");
    fs.writeFileSync(path.join(dir, "d.png"), png16Gray(new Uint16Array([1, 2, 3, 4]), 2, 2));
    fs.writeFileSync(
      path.join(dir, "board4.heightmap.json"),
      JSON.stringify({ png16: "d.png", pads: [{ padId: "P1", bbox: { x: 0, y: 0, w: 2, h: 2 } }] }),
      "utf8",
    );
    const src = getHeightMapSource("file");
    const acq = await src.acquire({
      canonical: { serialNumber: "S", overallResult: "OK", measurements: [] },
      resultFilePath: resultFile,
    });
    expect(acq).toBeNull();
  });

  it("no sidecar → null (normal case, not an error)", async () => {
    const dir = mkTmp();
    const resultFile = path.join(dir, "board5.csv");
    fs.writeFileSync(resultFile, "ignored", "utf8");
    const src = getHeightMapSource("file");
    const acq = await src.acquire({
      canonical: { serialNumber: "S", overallResult: "OK", measurements: [] },
      resultFilePath: resultFile,
    });
    expect(acq).toBeNull();
  });

  it("manifest candidates cover <stem>.heightmap.json and <full>.heightmap.json", () => {
    const c = sidecarManifestCandidates(path.join("d:", "drop", "b1.csv"));
    expect(c[0].endsWith("b1.heightmap.json")).toBe(true);
    expect(c[1].endsWith("b1.csv.heightmap.json")).toBe(true);
  });

  it("parseCsvHeightMap rejects ragged/non-numeric grids", () => {
    expect(() => parseCsvHeightMap("1,2\n3\n")).toThrow(/inconsistent/);
    expect(() => parseCsvHeightMap("1,x\n")).toThrow(/non-numeric/);
    expect(() => parseCsvHeightMap("# only comments\n")).toThrow(/empty/);
  });
});

// ── device stub ───────────────────────────────────────────────────────────────

describe("device stub", () => {
  it("probe reports unavailable; acquire throws HeightMapNotConfiguredError", async () => {
    const src = getHeightMapSource("device");
    const probe = await src.probe();
    expect(probe.available).toBe(false);
    await expect(
      src.acquire({ canonical: { serialNumber: "S", overallResult: "OK", measurements: [] } }),
    ).rejects.toBeInstanceOf(HeightMapNotConfiguredError);
  });

  it("listHeightMapSources exposes all three kinds", async () => {
    const kinds = (await listHeightMapSources()).map((s) => s.kind).sort();
    expect(kinds).toEqual(["device", "file", "vendor-passthrough"]);
  });

  it("hot-folder never ingests height-map sidecars as result files", async () => {
    const { shouldProcessFileName } = await import("./hotFolderService");
    expect(shouldProcessFileName("board1.heightmap.json", "*.{csv,xml,json}")).toBe(false);
    expect(shouldProcessFileName("board1.heightmap.csv", "*.{csv,xml,json}")).toBe(false);
    expect(shouldProcessFileName("board1.csv", "*.{csv,xml,json}")).toBe(true);
    expect(shouldProcessFileName("board1.json", "*.{csv,xml,json}")).toBe(true);
  });
});

// ── end-to-end enrichment helper ─────────────────────────────────────────────

describe("maybeEnrichCanonicalWithHeightMap", () => {
  it("flag OFF → byte-for-byte pass-through (reason flag_off)", async () => {
    const canonical = canonicalWithPoints();
    const out = await maybeEnrichCanonicalWithHeightMap(canonical);
    expect(out.native).toBe(false);
    expect(out.reason).toBe("flag_off");
    expect(out.canonical).toBe(canonical); // same reference
  });

  it("flag ON + vendor points (thin deposit vs nominal) → native NG enrichment", async () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    const canonical = canonicalWithPoints();
    const out = await maybeEnrichCanonicalWithHeightMap(canonical);
    expect(out.sourceKind).toBe("vendor-passthrough");
    expect(out.native).toBe(true);
    expect(out.report).not.toBeNull();
    const p1 = out.canonical.measurements.find((m) => m.pointCode === "P1")!;
    // 40µm deposit vs 100µm nominal → insufficient, native values replace vendor's.
    expect(p1.result).toBe("NG");
    expect(p1.defectCatalogCode).toBe("INSUFFICIENT");
    expect(Number(p1.valueVolume)).not.toBe(99);
    // measurement without 3-D samples stays untouched.
    const no3d = out.canonical.measurements.find((m) => m.pointCode === "NO3D")!;
    expect(no3d.valueVolume).toBe(55);
    // the ORIGINAL canonical was not mutated.
    expect(canonical.measurements[0].result).toBe("OK");
  });

  it("flag ON + device source error → fail-safe pass-through (never throws)", async () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    process.env.HEIGHT_MAP_SOURCE = "device";
    const canonical = canonicalWithPoints();
    const out = await maybeEnrichCanonicalWithHeightMap(canonical);
    expect(out.native).toBe(false);
    expect(out.reason).toMatch(/^error:/);
    expect(out.canonical).toBe(canonical);
  });

  it("flag ON + source off → pass-through (source_disabled)", async () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    process.env.HEIGHT_MAP_SOURCE = "off";
    const out = await maybeEnrichCanonicalWithHeightMap(canonicalWithPoints());
    expect(out.native).toBe(false);
    expect(out.reason).toBe("source_disabled");
  });
});
