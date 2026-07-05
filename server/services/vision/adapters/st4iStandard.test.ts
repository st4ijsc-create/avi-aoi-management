/**
 * ST4I Standard Inspection Feed adapter tests — NORMATIVE (doc 28 / doc 27 decision #3).
 *
 * Covers:
 *   - cross-encoding equivalence: the SAME board encoded as JSON / CSV / XML normalizes to
 *     a deep-equal CanonicalInspection (fixtures are the spec's compliance examples);
 *   - lossless mapping: bbox → defectBbox*, values_3d → value*, spec limits folded into
 *     remark AND kept in rawExtras, operator/panel/board_index/program_version/attachments
 *     preserved, cycle time passthrough + derivation;
 *   - strict validation (spec §8): version gate, mandatory tz offset (doc 27 A2), OK|NG|NTF
 *     tokens only, header-OK-vs-NG-measurement contradiction, bbox sanity, finite numbers;
 *   - additive-only forward compatibility: unknown fields NEVER reject — preserved in
 *     rawExtras;
 *   - encoding guards: CSV magic line, CSV column cap, XML root + DOCTYPE rejection.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { createSt4iStandardAdapter } from "./st4iStandard";

const adapter = createSt4iStandardAdapter();
const FIX = path.join(__dirname, "__fixtures__", "st4i-standard");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

/** Minimal valid document builder for validation tests. */
function doc(overrides: {
  header?: Record<string, unknown>;
  measurements?: unknown[];
  top?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    spec_version: 1,
    header: {
      machine_code: "AOI-01",
      serial_number: "SN-1",
      program_name: "PROG",
      started_at: "2026-07-04T08:00:00+07:00",
      finished_at: "2026-07-04T08:00:10+07:00",
      result: "OK",
      ...(overrides.header ?? {}),
    },
    measurements: overrides.measurements ?? [],
    ...(overrides.top ?? {}),
  };
}

describe("st4i-standard: cross-encoding equivalence (normative examples)", () => {
  it("JSON, CSV and XML encodings of the same board normalize to the SAME canonical output", () => {
    const fromJson = adapter.normalize(JSON.parse(read("board-ng.st4i.json")));
    const fromCsv = adapter.normalize(read("board-ng.st4i.csv"));
    const fromXml = adapter.normalize(read("board-ng.st4i.xml"));
    expect(fromCsv).toEqual(fromJson);
    expect(fromXml).toEqual(fromJson);
  });
});

describe("st4i-standard: lossless canonical mapping", () => {
  const canonical = adapter.normalize(JSON.parse(read("board-ng.st4i.json")));

  it("maps header to canonical inspection fields", () => {
    expect(canonical.machineCode).toBe("AOI-01");
    expect(canonical.serialNumber).toBe("SN-2026-000123");
    expect(canonical.productModel).toBe("MB-X1-TOP");
    expect(canonical.batchNumber).toBe("LOT-77");
    expect(canonical.operatorId).toBe("OP-0009");
    expect(canonical.overallResult).toBe("NG");
    expect(canonical.inspectionTime).toBe("2026-07-04T08:30:12.480+07:00");
    expect(canonical.cycleTime).toBe(12.48);
    // panel/program-version/started_at preserved losslessly.
    expect(canonical.rawExtras).toMatchObject({
      spec_version: 1,
      program_version: "1.4.0",
      panel_id: "PNL-88",
      board_index: 2,
      started_at: "2026-07-04T08:30:00+07:00",
    });
  });

  it("maps measurements: bbox → defectBbox*, values_3d → value*, spec limits → remark + rawExtras", () => {
    const [r12, c3, u1] = canonical.measurements;
    expect(r12).toMatchObject({
      pointCode: "R12.1",
      measuredValue: 61.2,
      result: "NG",
      defectCatalogCode: "INSUFFICIENT_SOLDER",
      defectSeverity: "major",
      imageBase64: "SN-2026-000123__R12.1.jpg",
      defectBboxX: 120,
      defectBboxY: 340,
      defectBboxW: 48,
      defectBboxH: 32,
      valueHeight: 95,
      valueArea: 88,
      valueVolume: 61.2,
      valueVoidPct: 2.1,
      valueCoplanarity: 3,
      valueWarpage: 1.2,
      valueOffsetX: -3.5,
      valueOffsetY: 1.1,
      valueTilt: 0.4,
      valueThickness: 40,
      valueZ: 130,
    });
    expect(r12.remark).toBe("insufficient fillet on pad 1; spec[70..130]; nominal=100; unit=%");
    expect(r12.rawExtras).toMatchObject({ type: "solder_joint", unit: "%", lsl: 70, usl: 130, nominal: 100 });
    expect(c3).toMatchObject({ pointCode: "C3", measuredValue: 99.1, result: "OK" });
    expect(u1).toMatchObject({ pointCode: "U1.pin5", result: "NTF", defectCatalogCode: "BRIDGING", defectSeverity: "minor" });
  });

  it("derives cycleTime from started/finished when cycle_time_sec is absent + keeps attachments/extra", () => {
    const out = adapter.normalize(JSON.parse(read("board-ok.st4i.json")));
    expect(out.cycleTime).toBe(8); // 09:00:00Z → 09:00:08Z
    expect(out.rawExtras).toMatchObject({ attachments: { image_dir: ".", images: ["SN-2026-000200__board.jpg"] } });
    expect(out.measurements[0].rawExtras).toMatchObject({ extra: { surface_score: 0.98, algo: "avi-clean-check" } });
  });

  it("ctx.machineCode overrides the payload machine_code", () => {
    const out = adapter.normalize(doc(), { machineCode: "OVERRIDE-1" });
    expect(out.machineCode).toBe("OVERRIDE-1");
  });
});

describe("st4i-standard: strict validation (spec §8)", () => {
  it("rejects a missing / unsupported spec_version (never guesses)", () => {
    const d = doc();
    delete (d as Record<string, unknown>).spec_version;
    expect(() => adapter.normalize(d)).toThrowError(/spec_version is required/);
    expect(() => adapter.normalize(doc({ top: { spec_version: 2 } }))).toThrowError(/unsupported spec_version "2"/);
  });

  it("rejects offset-less timestamps (doc 27 A2 lesson)", () => {
    expect(() =>
      adapter.normalize(doc({ header: { started_at: "2026-07-04T08:00:00" } })),
    ).toThrowError(/explicit UTC offset/);
  });

  it("rejects finished_at earlier than started_at", () => {
    expect(() =>
      adapter.normalize(doc({ header: { finished_at: "2026-07-04T07:59:59+07:00" } })),
    ).toThrowError(/finished_at must be >= started_at/);
  });

  it("rejects non-canonical result tokens (PASS/FAIL are NOT valid in the ST4I feed)", () => {
    expect(() => adapter.normalize(doc({ header: { result: "PASS" } }))).toThrowError(/header.result/);
    expect(() =>
      adapter.normalize(doc({ measurements: [{ point_name: "P1", result: "FAIL" }], header: { result: "NG" } })),
    ).toThrowError(/measurements.0.result/);
  });

  it("rejects a header result OK that contradicts an NG measurement", () => {
    expect(() =>
      adapter.normalize(doc({ measurements: [{ point_name: "P1", result: "NG" }] })),
    ).toThrowError(/contradicts an NG measurement/);
  });

  it("rejects missing serial / empty serial and missing header", () => {
    expect(() => adapter.normalize(doc({ header: { serial_number: "  " } }))).toThrowError(/serial_number/);
    expect(() => adapter.normalize({ spec_version: 1, measurements: [] })).toThrowError(/header is required/);
  });

  it("rejects an insane bbox and non-finite numbers", () => {
    expect(() =>
      adapter.normalize(
        doc({
          header: { result: "NG" },
          measurements: [{ point_name: "P1", result: "NG", bbox_px: { x: 1, y: 1, w: 0, h: 5 } }],
        }),
      ),
    ).toThrowError(/bbox_px.w/);
    expect(() =>
      adapter.normalize(doc({ measurements: [{ point_name: "P1", result: "OK", value: "not-a-number" }] })),
    ).toThrowError(/measurements.0.value/);
  });

  it("does NOT reject unknown fields — additive-only forward compatibility → rawExtras", () => {
    const out = adapter.normalize(
      doc({
        top: { future_top_field: { a: 1 } },
        header: { future_header_field: "x" },
        measurements: [{ point_name: "P1", result: "OK", future_point_field: 42 }],
      }),
    );
    expect(out.rawExtras).toMatchObject({
      document_unknown_fields: { future_top_field: { a: 1 } },
      header_unknown_fields: { future_header_field: "x" },
    });
    expect(out.measurements[0].rawExtras).toMatchObject({ unknown_fields: { future_point_field: 42 } });
  });
});

describe("st4i-standard: encoding guards", () => {
  it("rejects CSV without the magic first line", () => {
    expect(() => adapter.normalize("H,serial_number,SN-1\n")).toThrowError(/cannot detect encoding|line 1 must be/);
    expect(() => adapter.normalize("#WRONG,1\nH,serial_number,SN-1\n")).toThrowError(/cannot detect encoding/);
  });

  it("rejects a CSV M row with too many columns and unknown record tags", () => {
    const tooMany = `#ST4I-INSPECTION,1\nM,${Array(28).fill("x").join(",")}\n`; // 28 > 27 data columns
    expect(() => adapter.normalize(tooMany)).toThrowError(/max 27/);
    expect(() => adapter.normalize("#ST4I-INSPECTION,1\nZ,foo\n")).toThrowError(/unknown record tag "Z"/);
  });

  it("rejects XML without the st4i_inspection root and any DOCTYPE (XXE hardening)", () => {
    expect(() => adapter.normalize("<other><a/></other>")).toThrowError(/root element must be <st4i_inspection>/);
    expect(() =>
      adapter.normalize('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><st4i_inspection/>'),
    ).toThrowError(/DOCTYPE/);
  });

  it("accepts a JSON string payload and rejects arrays / scalars", () => {
    const out = adapter.normalize(JSON.stringify(doc()));
    expect(out.serialNumber).toBe("SN-1");
    expect(() => adapter.normalize([])).toThrowError(/must be a spec document object or raw file text/);
    expect(() => adapter.normalize(42)).toThrowError(/must be a spec document object or raw file text/);
  });
});
