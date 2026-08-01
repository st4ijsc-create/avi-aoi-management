/**
 * Vendor adapter tests — Cognex / Keyence / TRI (doc 24 AOI/AVI).
 *
 * Covers:
 *   - registry resolves cognex / keyence / tri (and they appear in listVisionAdapters).
 *   - cognex (2D job result): status + per-tool pass/score/offset → canonical OK/NG + points.
 *   - keyence (2D checker result): totalJudge + per-tool judge/measured → canonical; toolNo→"T"+no.
 *   - tri (3D SPI window): verdict + per-window volume/height/area/offset → canonical 3D fields.
 *   - representative round-trips (OK all-pass derive; NG on a failing point; defect + severity).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  registerVisionAdapter,
  getVisionAdapter,
  listVisionAdapters,
  _clearRegistry,
} from "./visionAdapterRegistry";
import { createGenericJsonAdapter } from "./adapters/genericJson";
import { createKohYoungAdapter } from "./adapters/kohYoung";
import { createCognexAdapter } from "./adapters/cognex";
import { createKeyenceAdapter } from "./adapters/keyence";
import { createTriAdapter } from "./adapters/tri";

describe("registry resolves the new vendors", () => {
  beforeEach(() => {
    _clearRegistry();
    registerVisionAdapter("generic-json", createGenericJsonAdapter);
    registerVisionAdapter("koh-young", createKohYoungAdapter);
    registerVisionAdapter("cognex", createCognexAdapter);
    registerVisionAdapter("keyence", createKeyenceAdapter);
    registerVisionAdapter("tri", createTriAdapter);
  });

  it("lists + resolves cognex/keyence/tri", () => {
    const keys = listVisionAdapters().map((a) => a.vendorKey);
    expect(keys).toEqual(expect.arrayContaining(["cognex", "keyence", "tri"]));
    expect(getVisionAdapter("cognex").vendorKey).toBe("cognex");
    expect(getVisionAdapter("keyence").vendorKey).toBe("keyence");
    expect(getVisionAdapter("tri").vendorKey).toBe("tri");
    expect(getVisionAdapter("cognex").label).toMatch(/Cognex/i);
    expect(getVisionAdapter("keyence").label).toMatch(/Keyence/i);
    expect(getVisionAdapter("tri").label).toMatch(/TRI/i);
  });
});

describe("cognex adapter (2D job result)", () => {
  const adapter = createCognexAdapter();

  it("maps a representative NG job with tools, score, offsets + defect", () => {
    const out = adapter.normalize(
      {
        job: "InSight_TopCam_A",
        id: "SN-778",
        status: "Fail",
        cycleTimeMs: 42,
        results: [
          { tool: "PatMax_1", pass: true, score: 95.2, offsetX: -3.1, offsetY: 0.8, angle: 1.2 },
          { tool: "Presence_2", pass: false, score: 10, defect: "MISSING_COMPONENT", severity: "major", image: "http://img/t2.jpg" },
        ],
      },
      { machineCode: "CGX-1" },
    );

    expect(out.machineCode).toBe("CGX-1");
    expect(out.serialNumber).toBe("SN-778");
    expect(out.productModel).toBe("InSight_TopCam_A");
    expect(out.cycleTime).toBeCloseTo(0.042, 6); // ms → s
    expect(out.overallResult).toBe("NG"); // status Fail

    const [t1, t2] = out.measurements;
    expect(t1).toMatchObject({ pointCode: "PatMax_1", result: "OK", measuredValue: 95.2, valueOffsetX: -3.1, valueOffsetY: 0.8, valueTilt: 1.2 });
    expect(t2).toMatchObject({
      pointCode: "Presence_2",
      result: "NG",
      measuredValue: 10,
      defectCatalogCode: "MISSING_COMPONENT",
      defectSeverity: "major",
      imageBase64: "http://img/t2.jpg",
    });
  });

  it("derives overall OK when all tools pass + status absent (accepts partId/pass boolean)", () => {
    const out = adapter.normalize({
      partId: "P2",
      tools: [{ name: "Edge_1", pass: true, score: 99 }],
    });
    expect(out.serialNumber).toBe("P2");
    expect(out.measurements[0].pointCode).toBe("Edge_1");
    expect(out.overallResult).toBe("OK");
  });

  it("throws when part id missing / non-object", () => {
    expect(() => adapter.normalize({ results: [] })).toThrowError(/part id.*required/i);
    expect(() => adapter.normalize([])).toThrowError(/must be a JSON object/);
  });
});

describe("keyence adapter (2D checker result)", () => {
  const adapter = createKeyenceAdapter();

  it("maps a representative NG program with toolNo/measured/spec + defect", () => {
    const out = adapter.normalize(
      {
        program: "CVX_Prog_3",
        workId: "WK-100",
        totalJudge: "NG",
        tools: [
          { toolNo: 12, judge: "OK", measured: 1024.5, lower: 900, upper: 1100 },
          { toolNo: 13, toolName: "Scratch_Check", judge: "NG", measured: 5, defectName: "SCRATCH", level: "minor", image: "http://img/t13.jpg" },
        ],
      },
      { machineCode: "KEY-1" },
    );

    expect(out.machineCode).toBe("KEY-1");
    expect(out.serialNumber).toBe("WK-100");
    expect(out.productModel).toBe("CVX_Prog_3");
    expect(out.overallResult).toBe("NG");

    const [t1, t2] = out.measurements;
    expect(t1).toMatchObject({ pointCode: "T12", result: "OK", measuredValue: 1024.5 });
    expect(t1.remark).toMatch(/spec\[900\.\.1100\]/);
    expect(t2).toMatchObject({
      pointCode: "Scratch_Check", // toolName preferred over toolNo
      result: "NG",
      measuredValue: 5,
      defectCatalogCode: "SCRATCH",
      defectSeverity: "minor",
      imageBase64: "http://img/t13.jpg",
    });
  });

  it("derives overall from tools when total judge absent; numeric 0=OK", () => {
    const out = adapter.normalize({
      workpieceId: "WK-2",
      tools: [{ toolNo: 1, judge: 0, measured: 10 }],
    });
    expect(out.measurements[0].result).toBe("OK"); // 0 = pass
    expect(out.overallResult).toBe("OK");
  });

  it("throws when workpiece id missing", () => {
    expect(() => adapter.normalize({ tools: [] })).toThrowError(/workpiece id.*required/i);
  });
});

describe("tri adapter (3D SPI window)", () => {
  const adapter = createTriAdapter();

  it("maps representative 3D windows (volume/height/area/offset) + defect", () => {
    const out = adapter.normalize(
      {
        boardId: "BRD-55",
        program: "TRI_SPI_Top",
        lotId: "L-3",
        verdict: "FAIL",
        machineType: "SPI",
        windows: [
          {
            windowId: "C10.1",
            judgement: "FAIL",
            volumePercent: 60.0,
            heightMicron: 95.0,
            areaPercent: 80.0,
            offsetX: -2.0,
            offsetY: 1.5,
            coplanarityMicron: 3.0,
            voidPercent: 2.4,
            bridge: true,
            defect: "INSUFFICIENT",
            defectClass: "critical",
            image: "http://img/c10.jpg",
          },
        ],
      },
      { machineCode: "TRI-1" },
    );

    expect(out.machineCode).toBe("TRI-1");
    expect(out.serialNumber).toBe("BRD-55");
    expect(out.productModel).toBe("TRI_SPI_Top");
    expect(out.batchNumber).toBe("L-3");
    expect(out.overallResult).toBe("NG"); // FAIL

    const m = out.measurements[0];
    expect(m.pointCode).toBe("C10.1");
    expect(m.result).toBe("NG");
    // 3D field mapping
    expect(m.measuredValue).toBe(60.0);
    expect(m.valueVolume).toBe(60.0);
    expect(m.valueHeight).toBe(95.0);
    expect(m.valueArea).toBe(80.0);
    expect(m.valueOffsetX).toBe(-2.0);
    expect(m.valueOffsetY).toBe(1.5);
    expect(m.valueCoplanarity).toBe(3.0);
    expect(m.valueVoidPct).toBe(2.4);
    // defect + image + remark carries machineType + bridge
    expect(m.defectCatalogCode).toBe("INSUFFICIENT");
    expect(m.defectSeverity).toBe("critical");
    expect(m.imageBase64).toBe("http://img/c10.jpg");
    expect(m.remark).toMatch(/type:SPI/);
    expect(m.remark).toMatch(/bridge/);
  });

  it("derives overall OK when all windows pass (numeric 0=pass) + accepts pads/panelId", () => {
    const out = adapter.normalize({
      panelId: "PNL-9",
      pads: [{ padId: "A", result: 0, volumePercent: 99 }],
    });
    expect(out.serialNumber).toBe("PNL-9");
    expect(out.measurements[0].pointCode).toBe("A");
    expect(out.measurements[0].result).toBe("OK");
    expect(out.overallResult).toBe("OK");
  });

  it("throws when board id missing", () => {
    expect(() => adapter.normalize({ windows: [] })).toThrowError(/board id.*required/i);
  });
});
