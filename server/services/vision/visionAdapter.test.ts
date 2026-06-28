/**
 * Vision adapter framework tests.
 *
 * Covers:
 *   - registry: registered adapters listed; getVisionAdapter resolves; unknown → throws.
 *   - genericJson: sample payload → canonical (result + value + image + defect mapping;
 *     overall derived when absent).
 *   - kohYoung: SPI sample → canonical incl. 3D field mapping (volume/height/area/
 *     coplanarity/offset/void) + defect mapping.
 *   - router: flag-off ingest is a no-op (persists nothing); unknown vendor → NOT_FOUND;
 *     bad payload → BAD_REQUEST; flag-on ingest forwards canonical to submitInspection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  registerVisionAdapter,
  getVisionAdapter,
  listVisionAdapters,
  _clearRegistry,
} from "./visionAdapterRegistry";
import { createGenericJsonAdapter } from "./adapters/genericJson";
import { createKohYoungAdapter } from "./adapters/kohYoung";

describe("visionAdapterRegistry", () => {
  beforeEach(() => {
    _clearRegistry();
    registerVisionAdapter("generic-json", createGenericJsonAdapter);
    registerVisionAdapter("koh-young", createKohYoungAdapter);
  });

  it("lists registered adapters with labels", () => {
    const list = listVisionAdapters();
    const keys = list.map((a) => a.vendorKey).sort();
    expect(keys).toEqual(["generic-json", "koh-young"]);
    expect(list.find((a) => a.vendorKey === "koh-young")?.label).toMatch(/Koh Young/i);
  });

  it("resolves a registered adapter", () => {
    expect(getVisionAdapter("generic-json").vendorKey).toBe("generic-json");
  });

  it("throws a clear error for an unknown vendor", () => {
    expect(() => getVisionAdapter("nope")).toThrowError(/No vision adapter registered for vendor "nope"/);
  });
});

describe("genericJson adapter", () => {
  const adapter = createGenericJsonAdapter();

  it("normalizes a sample payload to canonical (value/result/image/defect)", () => {
    const out = adapter.normalize({
      serial: "SN12345",
      product: "BoardX",
      batch: "B-2026",
      results: [
        { point: "MP001", value: 0.42, judged: "OK", image: "data:image/png;base64,AAAA" },
        { point: "MP002", value: "bridge", judged: "NG", defect: "SOLDER_BRIDGE", severity: "major" },
      ],
    });

    expect(out.serialNumber).toBe("SN12345");
    expect(out.productModel).toBe("BoardX");
    expect(out.batchNumber).toBe("B-2026");
    // overall derived: one NG present → NG
    expect(out.overallResult).toBe("NG");
    expect(out.measurements).toHaveLength(2);

    const [m1, m2] = out.measurements;
    expect(m1).toMatchObject({ pointCode: "MP001", measuredValue: 0.42, result: "OK", imageBase64: "data:image/png;base64,AAAA" });
    expect(m2).toMatchObject({
      pointCode: "MP002",
      measuredValue: "bridge",
      result: "NG",
      defectCatalogCode: "SOLDER_BRIDGE",
      defectSeverity: "major",
    });
  });

  it("injects machineCode from ctx and honors explicit overall result", () => {
    const out = adapter.normalize(
      { serial: "S1", result: "OK", results: [{ point: "P1", value: 1, judged: true }] },
      { machineCode: "AOI-09" },
    );
    expect(out.machineCode).toBe("AOI-09");
    expect(out.overallResult).toBe("OK");
    expect(out.measurements[0].result).toBe("OK");
  });

  it("throws on missing serial or non-object payload", () => {
    expect(() => adapter.normalize({ results: [] })).toThrowError(/serial.*required/i);
    expect(() => adapter.normalize([])).toThrowError(/must be a JSON object/);
  });
});

describe("kohYoung adapter (3D SPI mapping)", () => {
  const adapter = createKohYoungAdapter();

  it("maps 3D solder-paste fields + defect to canonical", () => {
    const out = adapter.normalize({
      barcode: "PNL-0099",
      recipe: "BoardX-Top",
      lot: "LOT-77",
      judgement: "FAIL",
      pads: [
        {
          padId: "R12.1",
          result: "FAIL",
          volumePct: 60.0,
          heightUm: 112.0,
          areaPct: 80.5,
          coplanarityUm: 4.5,
          offsetXUm: -3.2,
          offsetYUm: 1.1,
          warpageUm: 2.0,
          tiltDeg: 0.4,
          voidPct: 1.5,
          defectCode: "INSUFFICIENT",
          defectLevel: "critical",
          imageUrl: "http://img/r12.jpg",
        },
      ],
    });

    expect(out.serialNumber).toBe("PNL-0099");
    expect(out.productModel).toBe("BoardX-Top");
    expect(out.batchNumber).toBe("LOT-77");
    expect(out.overallResult).toBe("NG"); // FAIL → NG

    const m = out.measurements[0];
    expect(m.pointCode).toBe("R12.1");
    expect(m.result).toBe("NG");
    // 3D field mapping
    expect(m.measuredValue).toBe(60.0);
    expect(m.valueVolume).toBe(60.0);
    expect(m.valueHeight).toBe(112.0);
    expect(m.valueArea).toBe(80.5);
    expect(m.valueCoplanarity).toBe(4.5);
    expect(m.valueOffsetX).toBe(-3.2);
    expect(m.valueOffsetY).toBe(1.1);
    expect(m.valueWarpage).toBe(2.0);
    expect(m.valueTilt).toBe(0.4);
    expect(m.valueVoidPct).toBe(1.5);
    // defect + image
    expect(m.defectCatalogCode).toBe("INSUFFICIENT");
    expect(m.defectSeverity).toBe("critical");
    expect(m.imageBase64).toBe("http://img/r12.jpg");
  });

  it("derives overall OK when all pads pass + numeric result 0 = pass", () => {
    const out = adapter.normalize({
      barcode: "P2",
      pads: [{ padId: "A", result: 0, volumePct: 99 }],
    });
    expect(out.measurements[0].result).toBe("OK");
    expect(out.overallResult).toBe("OK");
  });

  it("throws when barcode missing", () => {
    expect(() => adapter.normalize({ pads: [] })).toThrowError(/barcode.*required/i);
  });
});

// ── Router: flag gating + error mapping + persistence forwarding ──
const perm = { allow: true };
vi.mock("../../_core/accessControl", () => ({
  requirePermission: (_m: string, _a: string) =>
    async ({ ctx, next }: any) => {
      if (!perm.allow) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: "no perm" });
      }
      return next({ ctx });
    },
}));

// Mock the submitInspection persistence path so the router test stays DB-free while
// still verifying that the canonical payload is forwarded verbatim.
const submitInspection = vi.fn(async () => ({ success: true, inspectionId: 4242 }));
vi.mock("../../routers/machineApiRouters", () => ({
  machineApiRouter: { createCaller: () => ({ submitInspection }) },
}));

import { visionAdapterRouter } from "../../routers/visionAdapterRouter";

const ctx = { user: { id: 7, role: "supervisor", name: "Sup" } } as any;
const caller = visionAdapterRouter.createCaller(ctx);

describe("visionAdapterRouter", () => {
  beforeEach(() => {
    perm.allow = true;
    submitInspection.mockClear();
    delete process.env.VISION_ADAPTERS_ENABLED;
  });

  it("flag OFF → ingest is a no-op, persists nothing", async () => {
    const res = await caller.ingest({
      vendorKey: "generic-json",
      payload: { serial: "S1", results: [{ point: "P1", value: 1, judged: "OK" }] },
    });
    expect(res).toMatchObject({ enabled: false, ingested: false });
    expect(submitInspection).not.toHaveBeenCalled();
  });

  it("flag ON + unknown vendor → NOT_FOUND, persists nothing", async () => {
    process.env.VISION_ADAPTERS_ENABLED = "true";
    await expect(
      caller.ingest({ vendorKey: "ghost", payload: {}, machineCode: "M1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(submitInspection).not.toHaveBeenCalled();
  });

  it("flag ON + bad payload → BAD_REQUEST", async () => {
    process.env.VISION_ADAPTERS_ENABLED = "true";
    await expect(
      caller.ingest({ vendorKey: "generic-json", payload: { results: [] }, machineCode: "M1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(submitInspection).not.toHaveBeenCalled();
  });

  it("flag ON + valid payload → forwards canonical to submitInspection", async () => {
    process.env.VISION_ADAPTERS_ENABLED = "true";
    const res = await caller.ingest({
      vendorKey: "koh-young",
      machineCode: "KY-1",
      payload: {
        barcode: "PNL-1",
        judgement: "FAIL",
        pads: [{ padId: "A1", result: "FAIL", volumePct: 50, heightUm: 100, defectCode: "INSUFFICIENT" }],
      },
    });
    expect(res).toMatchObject({ enabled: true, ingested: true, inspectionId: 4242 });
    expect(res.summary).toMatchObject({ serialNumber: "PNL-1", overallResult: "NG", measurementCount: 1, ngCount: 1 });
    expect(submitInspection).toHaveBeenCalledTimes(1);
    const forwarded = submitInspection.mock.calls[0][0] as any;
    expect(forwarded.machineCode).toBe("KY-1");
    expect(forwarded.measurements[0].valueVolume).toBe(50);
  });

  it("listAdapters always available (read-only) and reflects flag", async () => {
    const res = await caller.listAdapters();
    expect(res.enabled).toBe(false);
    expect(res.adapters.map((a) => a.vendorKey)).toEqual(
      expect.arrayContaining(["generic-json", "koh-young"]),
    );
  });

  it("RBAC denial → FORBIDDEN", async () => {
    perm.allow = false;
    await expect(caller.listAdapters()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
