/**
 * Doc 31 — Đợt C (MP5 / PM4) — generic centroid parser + transform tests.
 * Pure functions; no DB. Covers unit/decimal/delimiter/flip/dedupe/messy rows,
 * the mm↔pixel coordinate transform, and header guessing on real header styles.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseCentroidCsv,
  transformCentroidRows,
  buildCentroidCandidates,
  inspectCentroidHeaders,
  guessColumnMap,
  detectDelimiter,
  splitCsvLine,
  normalizeSide,
  type CentroidColumnMap,
} from "./centroidParser";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(HERE, "__fixtures__", "centroid", name), "utf-8");

const GENERIC_MAP: CentroidColumnMap = {
  refDesignator: "refdes", x: "x", y: "y", rotation: "rotation",
  side: "side", package: "package", componentCode: "value",
};

describe("splitCsvLine", () => {
  it("respects quoted fields with embedded delimiters + doubled quotes", () => {
    expect(splitCsvLine('"R1","CONN,2P","he said ""hi"""', ",")).toEqual([
      "R1", "CONN,2P", 'he said "hi"',
    ]);
  });
  it("splits on tab / semicolon", () => {
    expect(splitCsvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
    expect(splitCsvLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent of , ; tab", () => {
    expect(detectDelimiter("a;b;c;d")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb\tc\td\te")).toBe("\t");
  });
});

describe("normalizeSide", () => {
  it("maps many spellings to top/bottom", () => {
    for (const s of ["top", "T", "Top Layer", "1", "F.Cu", "front"]) {
      expect(normalizeSide(s)).toBe("top");
    }
    for (const s of ["bottom", "B", "bot", "2", "B.Cu", "back"]) {
      expect(normalizeSide(s)).toBe("bottom");
    }
    expect(normalizeSide("")).toBeUndefined();
    expect(normalizeSide("weird")).toBeUndefined();
  });
});

describe("parseCentroidCsv — generic comma/mm", () => {
  const res = parseCentroidCsv(fixture("generic_mm.csv"), {
    columnMap: GENERIC_MAP,
  });

  it("detects comma delimiter + header, parses the rows", () => {
    expect(res.detectedDelimiter).toBe(",");
    expect(res.headers).toEqual(["refdes", "x", "y", "rotation", "side", "package", "value"]);
  });

  it("maps every field", () => {
    const r1 = res.rows.find((r) => r.refDesignator === "R1")!;
    expect(r1.rawX).toBe(10.5);
    expect(r1.rawY).toBe(20.0);
    expect(r1.rotation).toBe(0);
    expect(r1.side).toBe("top");
    expect(r1.package).toBe("0402");
    expect(r1.componentCode).toBe("10K");
    const d1 = res.rows.find((r) => r.refDesignator === "D1")!;
    expect(d1.side).toBe("bottom");
  });

  it("dedupes by refDesignator (first wins) and counts duplicates", () => {
    const r2s = res.rows.filter((r) => r.refDesignator === "R2");
    expect(r2s.length).toBe(1);
    expect(r2s[0].rawX).toBe(15.5); // the first R2, not the DUP row
    expect(res.stats.duplicates).toBe(1);
    expect(res.stats.parsed).toBe(5);
  });
});

describe("parseCentroidCsv — column map by index", () => {
  it("accepts numeric column indices", () => {
    const res = parseCentroidCsv("R1,1.0,2.0\nR2,3.0,4.0\n", {
      hasHeader: false,
      columnMap: { refDesignator: 0, x: 1, y: 2 },
    });
    expect(res.rows.map((r) => r.refDesignator)).toEqual(["R1", "R2"]);
    expect(res.rows[0].rawX).toBe(1.0);
  });
});

describe("parseCentroidCsv — messy KiCad file", () => {
  const res = parseCentroidCsv(fixture("kicad_pos.csv"), {
    columnMap: { refDesignator: "Ref", x: "PosX", y: "PosY", rotation: "Rot", side: "Side", package: "Package", componentCode: "Val" },
  });
  it("skips comment + blank lines and unquotes fields", () => {
    expect(res.rows.map((r) => r.refDesignator).sort()).toEqual(["J1", "R1", "R2", "U1"]);
    const j1 = res.rows.find((r) => r.refDesignator === "J1")!;
    expect(j1.side).toBe("bottom");
    const u1 = res.rows.find((r) => r.refDesignator === "U1")!;
    expect(u1.rawX).toBe(30);
    expect(u1.package).toBe("QFN-48");
  });
});

describe("parseCentroidCsv — EU semicolon + decimal comma", () => {
  const res = parseCentroidCsv(fixture("altium_eu_semicolon.csv"), {
    delimiter: ";",
    decimal: ",",
    columnMap: {
      refDesignator: "Designator", x: "Center-X(mm)", y: "Center-Y(mm)",
      rotation: "Rotation", side: "Layer", package: "Footprint", componentCode: "Comment",
    },
  });
  it("parses comma-decimal numbers with semicolon delimiter", () => {
    expect(res.detectedDelimiter).toBe(";");
    const q1 = res.rows.find((r) => r.refDesignator === "Q1")!;
    expect(q1.rawX).toBeCloseTo(45.25, 5);
    expect(q1.rawY).toBeCloseTo(12.75, 5);
    expect(q1.side).toBe("bottom");
    const r1 = res.rows.find((r) => r.refDesignator === "R1")!;
    expect(r1.rawX).toBeCloseTo(10.5, 5);
  });
});

describe("parseCentroidCsv — invalid/blank handling", () => {
  it("skips rows with blank refdes or non-numeric x/y", () => {
    const res = parseCentroidCsv(
      "refdes,x,y\nR1,1,2\n,5,6\nR2,notanumber,3\nR3,7,8\n",
      { columnMap: GENERIC_MAP },
    );
    expect(res.rows.map((r) => r.refDesignator)).toEqual(["R1", "R3"]);
    expect(res.stats.skipped).toBe(2);
  });
});

describe("guessColumnMap / inspectCentroidHeaders", () => {
  it("guesses refdes/x/y/rotation/side/package from Altium-ish headers", () => {
    const g = guessColumnMap(["Designator", "Comment", "Layer", "Footprint", "Center-X(mm)", "Center-Y(mm)", "Rotation"]);
    expect(g.refDesignator).toBe(0);
    expect(g.side).toBe(2);
    expect(g.package).toBe(3);
    expect(g.x).toBe(4);
    expect(g.y).toBe(5);
    expect(g.rotation).toBe(6);
  });
  it("does not map the same column twice (posx wins over bare x)", () => {
    const g = guessColumnMap(["Ref", "PosX", "PosY", "Rot"]);
    expect(g.x).toBe(1);
    expect(g.y).toBe(2);
  });
  it("inspect returns headers + guessed map + sample rows", () => {
    const ins = inspectCentroidHeaders(fixture("generic_mm.csv"));
    expect(ins.detectedDelimiter).toBe(",");
    expect(ins.headers?.[0]).toBe("refdes");
    expect(ins.guessedMap.refDesignator).toBe(0);
    expect(ins.sampleRows.length).toBeGreaterThan(0);
  });
});

describe("transformCentroidRows — unit conversion", () => {
  const rows = [
    { refDesignator: "A", rawX: 100, rawY: 100, sourceLine: 1 },
    { refDesignator: "B", rawX: 200, rawY: 200, sourceLine: 2 },
  ];
  it("mil → mm", () => {
    const tf = transformCentroidRows(rows, { unit: "mil", targetMode: "mm" }, {});
    // 100 mil = 2.54 mm
    expect(tf.candidates[0].mmX).toBeCloseTo(2.54, 5);
  });
  it("inch → mm", () => {
    const tf = transformCentroidRows(rows, { unit: "inch", targetMode: "mm" }, {});
    expect(tf.candidates[1].mmX).toBeCloseTo(200 * 25.4, 3);
  });
});

describe("transformCentroidRows — Y-flip", () => {
  const rows = [
    { refDesignator: "LOW", rawX: 0, rawY: 0, sourceLine: 1 },
    { refDesignator: "HIGH", rawX: 0, rawY: 10, sourceLine: 2 },
  ];
  it("mirrors Y about the bounding box (bottom-left → top-left)", () => {
    const tf = transformCentroidRows(rows, { unit: "mm", targetMode: "mm", flipY: true }, {});
    const low = tf.candidates.find((c) => c.code === "LOW")!;
    const high = tf.candidates.find((c) => c.code === "HIGH")!;
    // After flip, the originally-lowest Y point ends up at the top of the range.
    expect(low.positionY).toBeCloseTo(10, 5);
    expect(high.positionY).toBeCloseTo(0, 5);
  });
});

describe("transformCentroidRows — mm → pixel fit-to-image", () => {
  const rows = [
    { refDesignator: "A", rawX: 0, rawY: 0, sourceLine: 1 },
    { refDesignator: "B", rawX: 100, rawY: 50, sourceLine: 2 },
  ];
  it("scales the board cloud into the image with a margin and sets normalized coords", () => {
    const tf = transformCentroidRows(
      rows,
      { unit: "mm", targetMode: "pixel", fitToImage: true, marginPct: 0 },
      { imageWidth: 1000, imageHeight: 1000, coordinateMode: "pixel" },
    );
    // Board is 100mm x 50mm → uniform scale limited by width = 1000/100 = 10 px/mm.
    expect(tf.effectiveScale).toBeCloseTo(10, 5);
    const a = tf.candidates.find((c) => c.code === "A")!;
    const b = tf.candidates.find((c) => c.code === "B")!;
    // A at bbox min-x → x=0; centered vertically (50mm*10=500px tall in 1000px → offset 250).
    expect(a.positionX).toBeCloseTo(0, 3);
    expect(b.positionX).toBeCloseTo(1000, 3);
    // normalized within 0..1
    expect(a.normalizedX).toBeCloseTo(0, 5);
    expect(b.normalizedX).toBeCloseTo(1, 5);
    expect(a.normalizedY).toBeGreaterThanOrEqual(0);
    expect(b.normalizedY).toBeLessThanOrEqual(1);
  });

  it("warns + falls back to scale 1 when pixel mode requested but no image dims", () => {
    const tf = transformCentroidRows(
      rows,
      { unit: "mm", targetMode: "pixel", fitToImage: true },
      { imageWidth: null, imageHeight: null, coordinateMode: "pixel" },
    );
    expect(tf.effectiveScale).toBe(1);
    expect(tf.warnings.join(" ")).toMatch(/no image dimensions/i);
  });
});

describe("buildCentroidCandidates — end-to-end from a fixture", () => {
  it("parses generic_mm and places into a pixel image", () => {
    const built = buildCentroidCandidates(
      fixture("generic_mm.csv"),
      {
        parse: { columnMap: GENERIC_MAP },
        transform: { unit: "mm", targetMode: "pixel", fitToImage: true, flipY: true },
      },
      { imageWidth: 800, imageHeight: 600, coordinateMode: "pixel" },
    );
    expect(built.candidates.length).toBe(5); // deduped
    for (const c of built.candidates) {
      expect(c.positionX).toBeGreaterThanOrEqual(0);
      expect(c.positionX).toBeLessThanOrEqual(800);
      expect(c.normalizedX).toBeGreaterThanOrEqual(0);
      expect(c.normalizedX).toBeLessThanOrEqual(1);
    }
    const u1 = built.candidates.find((c) => c.refDesignator === "U1")!;
    expect(u1.componentCode).toBe("MCU-STM32");
    expect(u1.package).toBe("QFN48");
  });
});
