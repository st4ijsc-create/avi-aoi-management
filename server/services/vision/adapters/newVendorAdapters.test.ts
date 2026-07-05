/**
 * Vendor adapter tests — I.C.T AOI / Saki AOI / Mirtec (doc 27 C2/C6, decision #3 vendors).
 *
 * These adapters are REPRESENTATIVE shapes pending real machine export files (honest
 * header comments in each adapter). Tests lock in:
 *   - registry: st4i-standard / ict-aoi / saki-aoi / mirtec registered alongside the
 *     existing five;
 *   - saki (CSV row file): serial/machine/job/lot, Date+Time → tz-aware inspectionTime
 *     (doc 27 A2 — site default offset appended), Judge → result, DefectName → IPC code
 *     via SAKI_DEFECT_MAP (unmapped tokens pass through), X/Y/Width/Height → bbox,
 *     rows-array input form, missing serial throws;
 *   - mirtec (result XML): BoardInfo/DefectList mapping, GOOD board → OK with 0
 *     measurements (defect-only export), cycle time End−Start, DOCTYPE rejected;
 *   - ict (CSV + JSON push): both input forms, board Result vs per-component result,
 *     defect map, missing SN throws.
 */
import { describe, it, expect } from "vitest";

import { listVisionAdapters, getVisionAdapter } from "../index";
import { createSakiAoiAdapter, SAKI_DEFECT_MAP } from "./sakiAoi";
import { createMirtecAdapter } from "./mirtec";
import { createIctAoiAdapter } from "./ictAoi";

describe("registry includes the doc-27 decision-#3 vendors (existing five kept)", () => {
  it("lists all nine adapters", () => {
    const keys = listVisionAdapters().map((a) => a.vendorKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "generic-json", "koh-young", "cognex", "keyence", "tri",
        "st4i-standard", "ict-aoi", "saki-aoi", "mirtec",
      ]),
    );
    expect(getVisionAdapter("st4i-standard").label).toMatch(/ST4I Standard/i);
    expect(getVisionAdapter("ict-aoi").label).toMatch(/I\.C\.T/i);
    expect(getVisionAdapter("saki-aoi").label).toMatch(/Saki/i);
    expect(getVisionAdapter("mirtec").label).toMatch(/Mirtec/i);
  });
});

describe("saki-aoi adapter (representative CSV result file)", () => {
  const adapter = createSakiAoiAdapter();
  const csv = [
    "Date,Time,MachineName,JobName,BoardSerial,BoardResult,Lot,CircuitNo,PartsName,PartsNo,WindowNo,Algorithm,Judge,DefectName,X,Y,Width,Height,ImageFile",
    "2026/07/04,08:31:05,SAKI-BF3,MB-X1-TOP,SN-124,NG,LOT-77,1,R12,RC0402-103,12,Solder,NG,Insufficient,1120,2340,64,48,SN-124_R12.jpg",
    "2026/07/04,08:31:05,SAKI-BF3,MB-X1-TOP,SN-124,NG,LOT-77,1,C3,CC0603-104,7,Placement,OK,,,,,",
    "2026/07/04,08:31:05,SAKI-BF3,MB-X1-TOP,SN-124,NG,LOT-77,1,U9,IC-BGA,4,Solder,NG,WeirdNewDefect,10,20,30,40,SN-124_U9.jpg",
  ].join("\n");

  it("maps CSV text → canonical (header, tz-aware time, defect map, bbox)", () => {
    const out = adapter.normalize(csv);
    expect(out.serialNumber).toBe("SN-124");
    expect(out.machineCode).toBe("SAKI-BF3");
    expect(out.productModel).toBe("MB-X1-TOP");
    expect(out.batchNumber).toBe("LOT-77");
    expect(out.overallResult).toBe("NG");
    // Saki files carry NO offset → site default appended (doc 27 A2).
    expect(out.inspectionTime).toBe("2026-07-04T08:31:05+07:00");
    expect(out.measurements).toHaveLength(3);

    const [r12, c3, u9] = out.measurements;
    expect(r12).toMatchObject({
      pointCode: "R12",
      result: "NG",
      defectCatalogCode: "INSUFFICIENT_SOLDER", // Insufficient → IPC code
      defectBboxX: 1120,
      defectBboxY: 2340,
      defectBboxW: 64,
      defectBboxH: 48,
      imageBase64: "SN-124_R12.jpg",
    });
    expect(r12.rawExtras).toMatchObject({ vendor_defect_name: "Insufficient", part_number: "RC0402-103" });
    expect(c3).toMatchObject({ pointCode: "C3", result: "OK" });
    expect(c3.defectCatalogCode).toBeUndefined();
    // Unmapped vendor token passes through tokenized (soft catalog reference).
    expect(u9.defectCatalogCode).toBe("WEIRDNEWDEFECT");
  });

  it("accepts pre-parsed row objects and ctx.machineCode override; derives overall from judges", () => {
    const rows = [
      { Date: "2026/07/04", Time: "09:00:00", BoardSerial: "SN-2", JobName: "J", PartsName: "R1", Judge: "OK" },
      { Date: "2026/07/04", Time: "09:00:00", BoardSerial: "SN-2", JobName: "J", PartsName: "R2", Judge: "NG", DefectName: "Bridge" },
    ];
    const out = adapter.normalize(rows, { machineCode: "SAKI-9" });
    expect(out.machineCode).toBe("SAKI-9");
    expect(out.overallResult).toBe("NG"); // no BoardResult column → derived
    expect(out.measurements[1].defectCatalogCode).toBe(SAKI_DEFECT_MAP.BRIDGE);
  });

  it("throws when the board serial column is missing / no rows", () => {
    expect(() => adapter.normalize("PartsName,Judge\nR1,OK\n")).toThrowError(/board serial column is required/);
    expect(() => adapter.normalize("A,B\n")).toThrowError(/no data rows/);
    expect(() => adapter.normalize(42)).toThrowError(/must be CSV text/);
  });
});

describe("mirtec adapter (representative MV-series result XML)", () => {
  const adapter = createMirtecAdapter();
  const xml = `<?xml version="1.0"?>
<MirtecResult>
  <BoardInfo>
    <Machine>MIRTEC-MV6</Machine><Model>MB-X1</Model><Barcode>SN-127</Barcode>
    <Lot>LOT-78</Lot><StartTime>2026-07-04 08:34:00</StartTime>
    <EndTime>2026-07-04 08:34:09</EndTime><Result>NG</Result>
  </BoardInfo>
  <DefectList>
    <Defect>
      <Location>R12</Location><PartName>RC0402-103</PartName>
      <DefectName>Tombstone</DefectName><DefectCode>D021</DefectCode>
      <X>1120</X><Y>2340</Y><Width>64</Width><Height>48</Height>
      <ImagePath>SN-127_R12.jpg</ImagePath><Judge>NG</Judge>
    </Defect>
  </DefectList>
</MirtecResult>`;

  it("maps result XML → canonical (board info, defect map, bbox, cycle time)", () => {
    const out = adapter.normalize(xml);
    expect(out.serialNumber).toBe("SN-127");
    expect(out.machineCode).toBe("MIRTEC-MV6");
    expect(out.productModel).toBe("MB-X1");
    expect(out.batchNumber).toBe("LOT-78");
    expect(out.overallResult).toBe("NG");
    expect(out.inspectionTime).toBe("2026-07-04T08:34:09+07:00"); // EndTime + site offset
    expect(out.cycleTime).toBe(9); // End − Start
    expect(out.rawExtras).toMatchObject({ vendor: "mirtec", started_at: "2026-07-04T08:34:00+07:00" });

    const m = out.measurements[0];
    expect(m).toMatchObject({
      pointCode: "R12",
      result: "NG",
      defectCatalogCode: "TOMBSTONING", // Tombstone → IPC code
      defectBboxX: 1120,
      defectBboxY: 2340,
      defectBboxW: 64,
      defectBboxH: 48,
      imageBase64: "SN-127_R12.jpg",
    });
    expect(m.rawExtras).toMatchObject({ vendor_defect_code: "D021", vendor_defect_name: "Tombstone", part_name: "RC0402-103" });
  });

  it("GOOD board with empty DefectList → OK, 0 measurements (defect-only export is honest)", () => {
    const ok = adapter.normalize(
      `<MirtecResult><BoardInfo><Barcode>SN-OK</Barcode><Result>GOOD</Result></BoardInfo><DefectList/></MirtecResult>`,
    );
    expect(ok.overallResult).toBe("OK");
    expect(ok.measurements).toHaveLength(0);
  });

  it("accepts the equivalent parsed object form", () => {
    const out = adapter.normalize({
      BoardInfo: { Barcode: "SN-128", Result: "GOOD" },
      DefectList: [],
    });
    expect(out.serialNumber).toBe("SN-128");
    expect(out.overallResult).toBe("OK");
  });

  it("rejects DOCTYPE, missing root and missing barcode", () => {
    expect(() => adapter.normalize("<!DOCTYPE x><MirtecResult/>")).toThrowError(/DOCTYPE/);
    expect(() => adapter.normalize("<Other/>")).toThrowError(/root element/);
    expect(() =>
      adapter.normalize("<MirtecResult><BoardInfo><Result>NG</Result></BoardInfo></MirtecResult>"),
    ).toThrowError(/barcode is required/);
  });
});

describe("ict-aoi adapter (representative AI-series CSV / JSON push)", () => {
  const adapter = createIctAoiAdapter();

  it("maps CSV text → canonical (board Result, defect rows → NG, defect map, bbox)", () => {
    const csv = [
      "Machine,SN,PCB_Code,Program,TestTime,Result,Designator,PartNo,DefectType,DefectCode,X,Y,W,H,ImagePath",
      "ICT-AI5146,SN-125,MB-X1,MB-X1-TOP-V2,2026-07-04 08:32:40,FAIL,R7,RC0402-102,Missing,E02,300,520,40,30,SN-125_R7.jpg",
      "ICT-AI5146,SN-125,MB-X1,MB-X1-TOP-V2,2026-07-04 08:32:40,FAIL,D2,LED-0603,Polarity,E07,610,900,44,36,SN-125_D2.jpg",
    ].join("\n");
    const out = adapter.normalize(csv);
    expect(out.serialNumber).toBe("SN-125");
    expect(out.machineCode).toBe("ICT-AI5146");
    expect(out.productModel).toBe("MB-X1-TOP-V2");
    expect(out.overallResult).toBe("NG"); // FAIL → NG
    expect(out.inspectionTime).toBe("2026-07-04T08:32:40+07:00"); // + site offset (doc 27 A2)
    expect(out.rawExtras).toMatchObject({ vendor: "ict", pcb_code: "MB-X1" });

    const [r7, d2] = out.measurements;
    expect(r7).toMatchObject({
      pointCode: "R7",
      result: "NG", // defect row without explicit point result → NG
      defectCatalogCode: "MISSING_COMPONENT",
      defectBboxX: 300,
      defectBboxY: 520,
      defectBboxW: 40,
      defectBboxH: 30,
      imageBase64: "SN-125_R7.jpg",
    });
    expect(r7.rawExtras).toMatchObject({ vendor_defect_code: "E02", vendor_defect_name: "Missing", part_no: "RC0402-102" });
    expect(d2.defectCatalogCode).toBe("REVERSE_POLARITY");
  });

  it("maps the JSON push form (components with per-point results)", () => {
    const out = adapter.normalize({
      machine: "ICT-AI5146",
      sn: "SN-126",
      program: "P1",
      test_time: "2026-07-04 08:33:10",
      result: "PASS",
      components: [
        { designator: "R7", result: "OK" },
        { designator: "D2", result: "NTF", defect: "Dirty" },
      ],
    });
    expect(out.serialNumber).toBe("SN-126");
    expect(out.overallResult).toBe("OK"); // explicit board PASS wins
    expect(out.measurements[0]).toMatchObject({ pointCode: "R7", result: "OK" });
    expect(out.measurements[1]).toMatchObject({
      pointCode: "D2",
      result: "NTF",
      defectCatalogCode: "CONTAMINATION_PARTICLE", // Dirty → IPC code
    });
  });

  it("throws when SN missing / empty inputs", () => {
    expect(() => adapter.normalize({ components: [] })).toThrowError(/board serial \('SN'\) is required/);
    expect(() => adapter.normalize("A,B\n1,2\n")).toThrowError(/board serial \('SN'\) is required/);
    expect(() => adapter.normalize("")).toThrowError(/no data rows/);
    expect(() => adapter.normalize(42)).toThrowError(/payload must be CSV text/);
  });
});
