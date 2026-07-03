/**
 * aiSpi3d.test.ts — native 3D / SPI metrology (synthetic height-maps).
 *
 * Covers (per doc-24 Tier-2 acceptance):
 *   (a) a known paste deposit → correct volume / area / height within tolerance
 *   (b) an offset deposit → correct offset X/Y + "misaligned" class
 *   (c) insufficient / excessive volume → correct class vs thresholds
 *   (d) bridging between two pads detected
 *   (e) coplanarity across pads on a component
 *   (f) degraded (no calibration) labeled, not fabricated
 *   + point-sample rasterization, surface-void proxy, canonical enrichment flag gating.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBoardSpi,
  computePadSpi,
  pointsToHeightMap,
  enrichCanonicalWithSpi3d,
  spi3dNativeEnabled,
  DEFAULT_SPI_THRESHOLDS,
  type HeightMap,
  type PadGeometry,
  type PadMask,
} from "./aiSpi3d";
import type { CanonicalInspection } from "./vision/visionAdapterRegistry";

// ── helpers to build synthetic height-maps ──

/** Blank Z=0 map. */
function blank(width: number, height: number): HeightMap {
  return { data: new Float32Array(width * height), width, height };
}

/** Paint a flat rectangular deposit of height `z` (µm) into a map. */
function paintRect(hm: HeightMap, x0: number, y0: number, w: number, h: number, z: number): void {
  const d = hm.data as Float32Array;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= hm.width || y >= hm.height) continue;
      d[y * hm.width + x] = z;
    }
  }
}

const CAL = { umPerPxX: 10, umPerPxY: 10 }; // 10 µm / pixel lateral

describe("aiSpi3d — known deposit volume/area/height (a)", () => {
  it("computes correct volume, area and mean height for a flat brick", () => {
    // 40x40 map; a 10x10 pad brick of height 100µm at (10,10). Pixel = 10µm.
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    const pad: PadGeometry = { padId: "P1", bbox: { x: 10, y: 10, w: 10, h: 10 } };

    const r = computePadSpi(hm, pad, { calibration: CAL });

    // area = 100 pixels × (10µm)² = 10,000 µm²
    expect(r.area).toBeCloseTo(100 * 100, 3);
    expect(r.areaPx).toBe(100);
    // meanHeight = 100 µm, max = 100 µm
    expect(r.meanHeight).toBeCloseTo(100, 3);
    expect(r.maxHeight).toBeCloseTo(100, 3);
    // volume = Σh(=100*100µm) × pixelArea(100µm²) = 1,000,000 µm³
    expect(r.volume).toBeCloseTo(100 * 100 * 100, 1);
    expect(r.unit).toBe("um");
    expect(r.degraded).toBe(false);
    expect(r.defectClass).toBe("good"); // no nominal, no offset → good
    expect(r.result).toBe("OK");
  });

  it("volumePct/heightPct vs nominal are computed when nominal supplied", () => {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    // nominal brick = 100 px² ideal → area 10000µm², height 100µm, volume 1,000,000 µm³
    const pad: PadGeometry = {
      padId: "P1",
      bbox: { x: 10, y: 10, w: 10, h: 10 },
      nominalVolume: 1_000_000,
      nominalHeight: 100,
      nominalArea: 10_000,
    };
    const r = computePadSpi(hm, pad, { calibration: CAL });
    expect(r.volumePct).toBeCloseTo(100, 2);
    expect(r.heightPct).toBeCloseTo(100, 2);
    expect(r.areaPct).toBeCloseTo(100, 2);
    expect(r.defectClass).toBe("good");
  });
});

describe("aiSpi3d — offset deposit → offsetX/Y + misaligned (b)", () => {
  it("detects a laterally shifted deposit and flags misaligned", () => {
    // pad aperture centered at bbox (10,10,10,10) → center (14.5,14.5).
    // deposit painted shifted +4px in X so its centroid is right of the pad center.
    const hm = blank(40, 40);
    paintRect(hm, 14, 10, 10, 10, 100); // shifted +4 in x
    const pad: PadGeometry = {
      padId: "P1",
      bbox: { x: 10, y: 10, w: 10, h: 10 },
      // small offset limit so the shift trips misaligned: 20% of pad width (100µm) = 20µm
    };
    const r = computePadSpi(hm, pad, {
      calibration: CAL,
      // ROI margin captures the shifted deposit; offset limit = 20% of pad width (20µm).
      thresholds: { offsetMaxPctOfPad: 0.2, searchMarginPx: 8 },
    });
    // paste centroid is 4px right of pad center → offsetX ≈ 4px × 10µm = 40µm
    expect(r.offsetXPx).toBeGreaterThan(3.5);
    expect(r.offsetX).toBeGreaterThan(35);
    expect(Math.abs(r.offsetY)).toBeLessThan(1);
    expect(r.flags).toContain("misaligned");
    expect(r.defectClass).toBe("misaligned");
    expect(r.result).toBe("NG");
  });

  it("a centered deposit has ~zero offset and stays good", () => {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    const pad: PadGeometry = { padId: "P1", bbox: { x: 10, y: 10, w: 10, h: 10 } };
    const r = computePadSpi(hm, pad, { calibration: CAL, thresholds: { offsetMaxPctOfPad: 0.1 } });
    expect(Math.abs(r.offsetX)).toBeLessThan(1);
    expect(Math.abs(r.offsetY)).toBeLessThan(1);
    expect(r.defectClass).toBe("good");
  });
});

describe("aiSpi3d — insufficient / excessive volume (c)", () => {
  const pad: PadGeometry = {
    padId: "P1",
    bbox: { x: 10, y: 10, w: 10, h: 10 },
    nominalVolume: 1_000_000, // = full 10x10 brick @100µm @10µm/px
    nominalHeight: 100,
  };

  it("classifies a thin deposit as insufficient", () => {
    // height 40µm over full footprint → 40% volume & 40% height → insufficient (<50%)
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 40);
    const r = computePadSpi(hm, pad, {
      calibration: CAL,
      thresholds: { pasteThresholdUm: 5 }, // fixed low floor so 40µm counts as paste
    });
    expect(r.volumePct).toBeLessThan(50);
    expect(r.flags).toContain("insufficient");
    expect(r.defectClass).toBe("insufficient");
    expect(r.result).toBe("NG");
    expect(r.severity).toBe("major");
  });

  it("classifies a tall deposit as excessive", () => {
    // height 200µm → 200% volume/height → excessive (>150%)
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 200);
    const r = computePadSpi(hm, pad, { calibration: CAL });
    expect(r.volumePct).toBeGreaterThan(150);
    expect(r.flags).toContain("excessive");
    expect(r.defectClass).toBe("excessive");
    expect(r.result).toBe("NG");
  });

  it("a nominal deposit is good", () => {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    const r = computePadSpi(hm, pad, { calibration: CAL });
    expect(r.volumePct).toBeCloseTo(100, 1);
    expect(r.defectClass).toBe("good");
    expect(r.result).toBe("OK");
  });
});

describe("aiSpi3d — bridging between two pads (d)", () => {
  it("detects a solder bridge across the gap and flags BOTH pads", () => {
    // two 8-wide pads with a 4px gap; a paste ridge fills the gap connecting them.
    const hm = blank(40, 20);
    paintRect(hm, 6, 6, 8, 8, 100);   // pad A footprint deposit
    paintRect(hm, 18, 6, 8, 8, 100);  // pad B footprint deposit
    paintRect(hm, 14, 9, 4, 2, 90);   // BRIDGE ridge across the gap (rows 9-10)
    const padA: PadGeometry = { padId: "A", bbox: { x: 6, y: 6, w: 8, h: 8 } };
    const padB: PadGeometry = { padId: "B", bbox: { x: 18, y: 6, w: 8, h: 8 } };

    const board = computeBoardSpi(hm, [padA, padB], {
      calibration: CAL,
      thresholds: { pasteThresholdUm: 20 },
    });
    const A = board.pads.find((p) => p.padId === "A")!;
    const B = board.pads.find((p) => p.padId === "B")!;
    expect(A.flags).toContain("bridged");
    expect(B.flags).toContain("bridged");
    expect(A.defectClass).toBe("bridged");
    expect(B.defectClass).toBe("bridged");
    expect(A.severity).toBe("critical");
    expect(board.boardResult).toBe("NG");
  });

  it("does NOT flag bridging when the gap is clean (separate deposits)", () => {
    const hm = blank(40, 20);
    paintRect(hm, 6, 6, 8, 8, 100);
    paintRect(hm, 18, 6, 8, 8, 100);
    // no ridge in the gap
    const padA: PadGeometry = { padId: "A", bbox: { x: 6, y: 6, w: 8, h: 8 } };
    const padB: PadGeometry = { padId: "B", bbox: { x: 18, y: 6, w: 8, h: 8 } };
    const board = computeBoardSpi(hm, [padA, padB], {
      calibration: CAL,
      thresholds: { pasteThresholdUm: 20 },
    });
    expect(board.pads.every((p) => !p.flags.includes("bridged"))).toBe(true);
    expect(board.boardResult).toBe("OK");
  });
});

describe("aiSpi3d — coplanarity across pads on a component (e)", () => {
  it("reports the peak-to-peak height spread of a component's pads", () => {
    // 3 pads on component "U1" at different heights 100 / 110 / 130 µm.
    const hm = blank(60, 20);
    paintRect(hm, 4, 6, 8, 8, 100);
    paintRect(hm, 20, 6, 8, 8, 110);
    paintRect(hm, 36, 6, 8, 8, 130);
    const pads: PadGeometry[] = [
      { padId: "U1.1", componentId: "U1", bbox: { x: 4, y: 6, w: 8, h: 8 } },
      { padId: "U1.2", componentId: "U1", bbox: { x: 20, y: 6, w: 8, h: 8 } },
      { padId: "U1.3", componentId: "U1", bbox: { x: 36, y: 6, w: 8, h: 8 } },
    ];
    const board = computeBoardSpi(hm, pads, { calibration: CAL, thresholds: { pasteThresholdUm: 20 } });
    const cop = board.pads[0].coplanarity!;
    // pads are colinear (same y) → plane-fit degenerates to a line fit through x;
    // residual p2p should still reflect the 100..130 non-linear spread.
    // The exact residual depends on the fit, but must be > 0 and finite and shared by all pads.
    expect(cop).toBeGreaterThan(0);
    expect(board.pads[1].coplanarity).toBe(cop);
    expect(board.pads[2].coplanarity).toBe(cop);
    // board warpage present
    expect(board.warpage).not.toBeNull();
  });

  it("coplanarity is null for a pad with no componentId", () => {
    const hm = blank(20, 20);
    paintRect(hm, 4, 6, 8, 8, 100);
    const r = computePadSpi(hm, { padId: "X", bbox: { x: 4, y: 6, w: 8, h: 8 } }, { calibration: CAL });
    expect(r.coplanarity).toBeNull();
  });
});

describe("aiSpi3d — degraded (no calibration) is labeled, not fabricated (f)", () => {
  it("reports unit px + degraded true and pixel-domain values (no fabricated scale)", () => {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    const pad: PadGeometry = { padId: "P1", bbox: { x: 10, y: 10, w: 10, h: 10 } };

    const r = computePadSpi(hm, pad); // NO calibration

    expect(r.degraded).toBe(true);
    expect(r.unit).toBe("px");
    expect(r.umPerPx).toBeNull();
    // area is pixel-domain (100 px²), NOT multiplied by a fabricated µm/px
    expect(r.area).toBe(100);
    expect(r.areaPx).toBe(100);
    // volume is Σh (pixel-domain, µm·px²): 100 pixels × 100µm = 10,000
    expect(r.volume).toBeCloseTo(10_000, 1);
    // height is still physical (Z is µm) even when lateral-degraded
    expect(r.meanHeight).toBeCloseTo(100, 3);
    // offset stays pixel-domain
    expect(r.offsetX).toBe(r.offsetXPx);
  });

  it("board-level degraded flag mirrors pad-level", () => {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 100);
    const board = computeBoardSpi(hm, [{ padId: "P1", bbox: { x: 10, y: 10, w: 10, h: 10 } }]);
    expect(board.degraded).toBe(true);
    expect(board.unit).toBe("px");
  });
});

describe("aiSpi3d — point-sample rasterization + surface-void proxy", () => {
  it("rasterizes 3-D point samples to a height-map (top surface = max Z)", () => {
    const pts = [
      { x: 0, y: 0, z: 50 },
      { x: 0, y: 0, z: 80 }, // same cell → max wins
      { x: 1, y: 0, z: 60 },
      { x: 0, y: 1, z: 70 },
      { x: 1, y: 1, z: 90 },
    ];
    const { heightMap, width, height } = pointsToHeightMap(pts);
    expect(width).toBe(2);
    expect(height).toBe(2);
    expect(heightMap.data[0]).toBe(80); // max of 50,80
    expect(heightMap.data[3]).toBe(90);
  });

  it("detects a surface dimple as void%", () => {
    // full 10x10 deposit @100µm with a 2x2 hole (dip to 10µm) → void proxy > 0
    const hm = blank(30, 30);
    paintRect(hm, 5, 5, 10, 10, 100);
    paintRect(hm, 9, 9, 2, 2, 10); // dimple
    const r = computePadSpi(hm, { padId: "P1", bbox: { x: 5, y: 5, w: 10, h: 10 } }, {
      calibration: CAL,
      thresholds: { pasteThresholdUm: 30, voidDepthFraction: 0.5 },
    });
    // 4 dimple pixels / 100 footprint pixels = 4%
    expect(r.surfaceVoidPct).toBeCloseTo(4, 1);
  });
});

describe("aiSpi3d — canonical enrichment flag gating", () => {
  const baseCanonical: CanonicalInspection = {
    serialNumber: "PNL-1",
    overallResult: "OK",
    measurements: [
      { pointCode: "P1", result: "OK", measuredValue: 99, valueVolume: 99 }, // pass-through vendor value
    ],
  };

  function buildInput() {
    const hm = blank(40, 40);
    paintRect(hm, 10, 10, 10, 10, 40); // thin → insufficient vs nominal
    return {
      heightMap: hm,
      pads: [
        {
          padId: "P1",
          bbox: { x: 10, y: 10, w: 10, h: 10 },
          nominalVolume: 1_000_000,
          nominalHeight: 100,
        } as PadGeometry,
      ],
      calibration: CAL,
      thresholds: { pasteThresholdUm: 5 },
    };
  }

  beforeEach(() => {
    delete process.env.SPI_3D_NATIVE_ENABLED;
  });

  it("flag OFF → pure pass-through, canonical unchanged", () => {
    expect(spi3dNativeEnabled()).toBe(false);
    const out = enrichCanonicalWithSpi3d(baseCanonical, buildInput());
    expect(out.native).toBe(false);
    expect(out.report).toBeNull();
    expect(out.canonical).toBe(baseCanonical); // same reference
    expect(out.canonical.measurements[0].valueVolume).toBe(99); // vendor value preserved
  });

  it("flag ON + height-map → native values preferred, defect written back", () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    const out = enrichCanonicalWithSpi3d(baseCanonical, buildInput());
    expect(out.native).toBe(true);
    expect(out.report).not.toBeNull();
    const m = out.canonical.measurements[0];
    // native volume replaces the vendor pass-through value
    expect(Number(m.valueVolume)).toBeCloseTo(40 * 100 * 100, 0); // Σh(40*100) × pixelArea(100)
    expect(m.result).toBe("NG");
    expect(m.defectCatalogCode).toBe("INSUFFICIENT");
    expect(m.defectSeverity).toBe("major");
    expect(out.canonical.overallResult).toBe("NG");
    // untouched original stays intact
    expect(baseCanonical.measurements[0].valueVolume).toBe(99);
  });

  it("flag ON but no height-map → pass-through (native:false)", () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    const out = enrichCanonicalWithSpi3d(baseCanonical, null);
    expect(out.native).toBe(false);
    expect(out.canonical).toBe(baseCanonical);
  });

  it("flag ON + measurement with no matching pad → that measurement passes through", () => {
    process.env.SPI_3D_NATIVE_ENABLED = "true";
    const canonical: CanonicalInspection = {
      serialNumber: "PNL-2",
      overallResult: "OK",
      measurements: [
        { pointCode: "P1", result: "OK", valueVolume: 99 },
        { pointCode: "UNMAPPED", result: "OK", valueVolume: 77 }, // no height-map pad
      ],
    };
    const out = enrichCanonicalWithSpi3d(canonical, buildInput());
    expect(out.native).toBe(true);
    expect(out.canonical.measurements[1].valueVolume).toBe(77); // untouched
  });
});

describe("aiSpi3d — defaults sanity", () => {
  it("default thresholds are IPC-style windows", () => {
    expect(DEFAULT_SPI_THRESHOLDS.volumeLowPct).toBe(50);
    expect(DEFAULT_SPI_THRESHOLDS.volumeHighPct).toBe(150);
  });

  it("mask restricts analysis to the aperture footprint", () => {
    // deposit spills outside the aperture; a mask limits volume to inside the mask.
    const hm = blank(20, 20);
    paintRect(hm, 4, 4, 10, 10, 100); // 10x10 deposit
    const mask: PadMask = { data: new Uint8Array(20 * 20), width: 20, height: 20 };
    // aperture = inner 6x6 at (6,6)
    for (let y = 6; y < 12; y++) for (let x = 6; x < 12; x++) (mask.data as Uint8Array)[y * 20 + x] = 1;
    const r = computePadSpi(hm, { padId: "P", bbox: { x: 4, y: 4, w: 10, h: 10 }, mask }, { calibration: CAL });
    expect(r.areaPx).toBe(36); // only the 6x6 masked region
  });
});
