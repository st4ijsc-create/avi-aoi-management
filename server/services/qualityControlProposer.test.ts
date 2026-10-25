/**
 * Doc 24 / Wave-4 — AOI-F: qualityControlProposer tests.
 *
 * Proves the SAFETY posture of the quality→control loop:
 *   (a) flag OFF (default) ⇒ NO proposal (legacy behaviour; propose never called).
 *   (b) flag ON + gated NG ⇒ a TYPED HITL proposal is created via proposeAction
 *       (PROPOSE-ONLY) — NOT a direct write (no dispatch/execute anywhere here).
 *   (d) computeSpiPrinterOffset is DETERMINISTIC (same trend ⇒ same numbers).
 *   (e) every proposal carries honest provenance (inspection/model/confidence/decision).
 *
 * The pure fns need no mocks; the orchestration uses INJECTED deps (propose /
 * findTargets / getToolByName / resolveFactory) so no DB or model is required and
 * the ONLY write-path call is the injected propose spy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeSpiPrinterOffset,
  buildControlProposals,
  isGatedNgOrAnomaly,
  isVisionControlEnabled,
  lamTronTheoLuoiTag,
  proposeControlFromVerdict,
  type ControlProposal,
  type ProposeControlDeps,
} from "./qualityControlProposer";

beforeEach(() => {
  delete process.env.VISION_CONTROL_ENABLED;
  delete process.env.VISION_CONTROL_MAX_PER_RUN;
  vi.clearAllMocks();
});

// ─── (d) Deterministic SPI printer-offset computation ──────────────────────────

describe("computeSpiPrinterOffset (pure, deterministic)", () => {
  const trend = [
    { offsetXUm: 10, offsetYUm: -4, volumePct: 88 },
    { offsetXUm: 12, offsetYUm: -6, volumePct: 90 },
    { offsetXUm: 14, offsetYUm: -5, volumePct: 92 },
    { offsetXUm: 12, offsetYUm: -5, volumePct: 90 },
  ];

  it("corrects OPPOSITE to the mean drift, damped by gain, and is deterministic", () => {
    const a = computeSpiPrinterOffset(trend);
    const b = computeSpiPrinterOffset(trend); // identical input ⇒ identical output
    expect(a).toEqual(b);

    // meanX = 12, meanY = -5, gain 0.5 → correction (-6, +2.5).
    expect(a.meanOffsetXUm).toBe(12);
    expect(a.meanOffsetYUm).toBe(-5);
    expect(a.offsetXUm).toBe(-6);
    expect(a.offsetYUm).toBe(2.5);
    expect(a.samplesUsed).toBe(4);
    expect(a.meanVolumePct).toBe(90);
    expect(a.withinDeadband).toBe(false); // |12| > 5
    expect(a.clamped).toBe(false);
  });

  it("clamps the correction to ±maxStepUm (safety bound)", () => {
    const big = [{ offsetXUm: 400, offsetYUm: 0 }];
    const r = computeSpiPrinterOffset(big, { gain: 0.5, maxStepUm: 50 });
    // raw = -200 → clamped to -50.
    expect(r.offsetXUm).toBe(-50);
    expect(r.clamped).toBe(true);
  });

  it("flags withinDeadband (no correction worth proposing) for sub-deadband drift", () => {
    const r = computeSpiPrinterOffset([{ offsetXUm: 3, offsetYUm: -2 }], { deadbandUm: 5 });
    expect(r.withinDeadband).toBe(true);
  });

  it("uses only the most-recent `window` samples", () => {
    const r = computeSpiPrinterOffset(
      [{ offsetXUm: 100, offsetYUm: 0 }, { offsetXUm: 10, offsetYUm: 0 }, { offsetXUm: 10, offsetYUm: 0 }],
      { window: 2, gain: 1 },
    );
    expect(r.samplesUsed).toBe(2);
    expect(r.meanOffsetXUm).toBe(10); // ignores the leading 100
  });

  it("empty / non-finite trend ⇒ zero correction, withinDeadband true", () => {
    const r = computeSpiPrinterOffset([]);
    expect(r.samplesUsed).toBe(0);
    expect(r.offsetXUm).toBe(0);
    expect(r.offsetYUm).toBe(0);
    expect(r.withinDeadband).toBe(true);
  });
});

// ─── isGatedNgOrAnomaly ────────────────────────────────────────────────────────

describe("isGatedNgOrAnomaly", () => {
  it("true for AUTO_NG / NG / anomaly source; false otherwise", () => {
    expect(isGatedNgOrAnomaly("AUTO_NG")).toBe(true);
    expect(isGatedNgOrAnomaly("NG")).toBe(true);
    expect(isGatedNgOrAnomaly("ANOMALY", "anomaly")).toBe(true);
    expect(isGatedNgOrAnomaly("AUTO_OK")).toBe(false);
    expect(isGatedNgOrAnomaly("NEEDS_REVIEW")).toBe(false);
  });
});

// ─── buildControlProposals (pure) + (e) provenance ─────────────────────────────

describe("buildControlProposals (pure)", () => {
  const baseVerdict = { decision: "AUTO_NG", confidence: 0.92, topLabel: "bridging" } as const;

  it("(e) NG ⇒ reject_divert carrying full provenance + unitRef", () => {
    const proposals = buildControlProposals({
      verdict: { ...baseVerdict },
      inspectionId: 55,
      machineId: 5,
      productModelId: 7,
      modelId: 3,
      modelVersion: "v2",
    });
    expect(proposals).toHaveLength(1);
    const p = proposals[0] as ControlProposal;
    expect(p.kind).toBe("reject_divert");
    expect(p.tool).toBe("reject_divert");
    expect(p.args.machineId).toBe(5);
    expect(p.args.unitRef).toBe("55");
    // Provenance is honest + complete (test (e)).
    expect(p.provenance).toEqual({
      inspectionId: 55,
      machineId: 5,
      productModelId: 7,
      modelId: 3,
      modelVersion: "v2",
      confidence: 0.92,
      decision: "AUTO_NG",
      topLabel: "bridging",
      source: "quality_gate",
    });
    // Provenance is ALSO embedded in the args stored on the HITL row.
    expect(p.args.provenance).toEqual(p.provenance);
  });

  it("NG + out-of-deadband SPI trend ⇒ ALSO an spi_printer_offset with computed value", () => {
    const proposals = buildControlProposals({
      verdict: { ...baseVerdict },
      inspectionId: 55,
      machineId: 5,
      spiTrend: [
        { offsetXUm: 12, offsetYUm: -5 },
        { offsetXUm: 12, offsetYUm: -5 },
      ],
    });
    const spi = proposals.find((p) => p.kind === "spi_printer_offset");
    expect(spi).toBeTruthy();
    expect(spi!.tool).toBe("spi_printer_offset");
    expect(spi!.args.offsetXUm).toBe(-6);
    expect(spi!.args.offsetYUm).toBe(2.5);
    expect(spi!.computedValue).toEqual({ offsetXUm: -6, offsetYUm: 2.5 });
  });

  it("NG + within-deadband SPI trend ⇒ NO spi_printer_offset (only reject_divert)", () => {
    const proposals = buildControlProposals({
      verdict: { ...baseVerdict },
      inspectionId: 55,
      machineId: 5,
      spiTrend: [{ offsetXUm: 2, offsetYUm: -1 }],
    });
    expect(proposals.map((p) => p.kind)).toEqual(["reject_divert"]);
  });

  it("non-NG verdict ⇒ NO proposals", () => {
    expect(buildControlProposals({ verdict: { decision: "AUTO_OK", confidence: 0.99 }, inspectionId: 1, machineId: 5 })).toHaveLength(0);
    expect(buildControlProposals({ verdict: { decision: "NEEDS_REVIEW", confidence: 0.5 }, inspectionId: 1, machineId: 5 })).toHaveLength(0);
  });

  it("no controllable machine target ⇒ NO proposals (advisory-only)", () => {
    expect(buildControlProposals({ verdict: { ...baseVerdict }, inspectionId: 1, machineId: null })).toHaveLength(0);
  });

  it("anomaly source with null confidence ⇒ reject_divert, provenance.confidence null", () => {
    const proposals = buildControlProposals({
      verdict: { decision: "ANOMALY", confidence: null, topLabel: "anomaly", source: "anomaly" },
      inspectionId: 9,
      machineId: 5,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].provenance.confidence).toBeNull();
    expect(proposals[0].provenance.source).toBe("anomaly");
  });
});

// ─── (a)/(b) proposeControlFromVerdict — flag gate + PROPOSE-ONLY invariant ─────

describe("proposeControlFromVerdict — flag gate + HITL invariant", () => {
  const ngInput = {
    verdict: { decision: "AUTO_NG", confidence: 0.9, topLabel: "bridging" },
    inspectionId: 55,
    machineId: 5,
    modelId: 3,
    modelVersion: "v2",
  };

  const fakeTool = {
    name: "reject_divert",
    kind: "write" as const,
    requiredPermission: { module: "machine_control", action: "canCreate" as const },
    parameters: {} as any,
    triggers: [],
    summarize: () => "divert",
    preview: vi.fn(),
    execute: vi.fn(), // MUST NEVER be called (propose-only)
  };

  function deps(propose: ReturnType<typeof vi.fn>): ProposeControlDeps {
    return {
      propose: propose as any,
      findTargets: async () => [{ id: 1, role: "maintenance", name: "Tech" }],
      getToolByName: (n) => (n === "reject_divert" ? (fakeTool as any) : undefined),
      resolveFactory: async () => null,
    };
  }

  it("(a) flag OFF (default) ⇒ DISABLED no-op; propose NEVER called", async () => {
    expect(isVisionControlEnabled()).toBe(false);
    const propose = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "a1" } }));
    const res = await proposeControlFromVerdict(ngInput, deps(propose));
    expect(res.proposed).toBe(0);
    expect(res.skippedReason).toBe("DISABLED");
    expect(propose).not.toHaveBeenCalled();
    expect(fakeTool.execute).not.toHaveBeenCalled();
  });

  it("(b) flag ON + NG ⇒ a TYPED HITL proposal is CREATED via propose (not a direct write)", async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const propose = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "act-77" } }));

    const res = await proposeControlFromVerdict(ngInput, deps(propose));

    expect(res.proposed).toBe(1);
    expect(res.actionIds).toEqual(["act-77"]);
    // The proposal was emitted via PROPOSE (HITL) — never executed/dispatched here.
    expect(propose).toHaveBeenCalledTimes(1);
    expect(fakeTool.execute).not.toHaveBeenCalled();

    const [toolArg, argsArg, ctxArg] = propose.mock.calls[0] as any[];
    expect(toolArg.name).toBe("reject_divert");
    expect(argsArg.machineId).toBe(5);
    // (e) provenance travels INTO the ai_pending_actions row's args.
    expect(argsArg.provenance).toMatchObject({
      inspectionId: 55,
      modelId: 3,
      modelVersion: "v2",
      confidence: 0.9,
      decision: "AUTO_NG",
      source: "quality_gate",
    });
    expect(ctxArg.user.id).toBe(1);
    // The typed proposal is reported back for observability.
    expect(res.proposals[0].kind).toBe("reject_divert");
  });

  it("flag ON but no permitted target users ⇒ nothing proposed (still no write)", async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const propose = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "a1" } }));
    const res = await proposeControlFromVerdict(ngInput, {
      ...deps(propose),
      findTargets: async () => [],
    });
    expect(res.proposed).toBe(0);
    expect(propose).not.toHaveBeenCalled();
  });

  it("flag ON + non-NG verdict ⇒ NO_PROPOSAL (propose not called)", async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const propose = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "a1" } }));
    const res = await proposeControlFromVerdict(
      { ...ngInput, verdict: { decision: "AUTO_OK", confidence: 0.99, topLabel: null } },
      deps(propose),
    );
    expect(res.proposed).toBe(0);
    expect(res.skippedReason).toBe("NO_PROPOSAL");
    expect(propose).not.toHaveBeenCalled();
  });
});

// ─── R1b-2a T1 — bộ đề xuất SPI theo lưới tag (Review Focus 4) ─────────────────────

describe("R1b-2a T1 — lamTronTheoLuoiTag + đề xuất SPI theo lưới tag", () => {
  const VERDICT_NG = { verdict: { decision: "AUTO_NG", confidence: 0.92, topLabel: "bridging" } };

  it("lamTronTheoLuoiTag theo lưới tag", () => {
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "int", scale: 1, offset: 0 }, 1)).toBe(-7);
    expect(lamTronTheoLuoiTag(-7.3, { dataType: "int", scale: "0.5", offset: null }, 1)).toBe(-7.5);
    expect(lamTronTheoLuoiTag(23, { dataType: "int", scale: "10.000000", offset: "0" }, 1)).toBe(20);
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "float", scale: 1, offset: 0, writeStep: 0.5, writeMin: null }, 1)).toBe(-7.5);
    expect(lamTronTheoLuoiTag(-7.26, null, 1)).toBe(-7.3);
    expect(lamTronTheoLuoiTag(50, { dataType: "int", scale: 20, offset: 0 }, 1, 50)).toBe(40);
  });

  it("lamTronTheoLuoiTag — chuẩn hoá scale / offset như driver (NULL / 0 ⇒ 1, NULL ⇒ 0), offset ≠ 0, writeMin làm gốc bước, −0 ⇒ 0, nhiễu dấu phẩy động được làm sạch", () => {
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "int", scale: null, offset: null }, 1)).toBe(-7);
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "int", scale: "0", offset: null }, 1)).toBe(-7);
    expect(lamTronTheoLuoiTag(12, { dataType: "int", scale: 10, offset: 5 }, 1)).toBe(15); // lưới 5 + k·10
    expect(lamTronTheoLuoiTag(0.7, { dataType: "int", scale: 0.1, offset: 0 }, 1)).toBe(0.7); // 7·0.1 = 0.7000000000000001 ⇒ làm sạch
    expect(lamTronTheoLuoiTag(1.2, { dataType: "float", scale: 1, offset: 0, writeStep: 0.5, writeMin: 0.25 }, 1)).toBe(1.25);
    expect(Object.is(lamTronTheoLuoiTag(-0.3, { dataType: "int", scale: 10, offset: 0 }, 1), 0)).toBe(true);
    expect(Object.is(lamTronTheoLuoiTag(-0.01, null, 1), 0)).toBe(true);
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "float", scale: 1, offset: 0, writeStep: null }, 1)).toBe(-7.3); // float không bước ⇒ roundDp
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "bool", scale: 1, offset: 0 }, 1)).toBe(-7.3);
    expect(lamTronTheoLuoiTag(-50, { dataType: "int", scale: 20, offset: 0 }, 1, 50)).toBe(-40); // trần ⇒ lùi MỘT bước về phía 0
  });

  it("computeSpiPrinterOffset nhận luoiX / luoiY: trục int scale 1 ⇒ −7; trục scale 10 ⇒ −10; mean* vẫn roundDp", () => {
    const r = computeSpiPrinterOffset([{ offsetXUm: 7.26, offsetYUm: 12.6 }], {
      gain: 1,
      luoiX: { dataType: "int", scale: 1, offset: 0 },
      luoiY: { dataType: "int", scale: "10.000000", offset: "0.000000" },
    });
    expect(r.offsetXUm).toBe(-7);
    expect(r.offsetYUm).toBe(-10);
    expect(r.meanOffsetXUm).toBe(7.3);
    expect(computeSpiPrinterOffset([{ offsetXUm: 7.26, offsetYUm: 12.6 }], { gain: 1 }).offsetXUm).toBe(-7.3); // không lưới ⇒ như cũ
  });

  it("buildControlProposals truyền spiLuoi: −7,26 trên int µm scale 1 ⇒ đề xuất mang −7 (Review Focus 4)", () => {
    const ps = buildControlProposals({
      ...VERDICT_NG,
      machineId: 7,
      inspectionId: 1,
      spiTrend: [{ offsetXUm: 7.26, offsetYUm: 7.26 }],
      spiOpts: { gain: 1 },
      spiLuoi: { x: { dataType: "int", scale: 1, offset: 0 }, y: { dataType: "int", scale: 1, offset: 0 } },
    });
    const spi = ps.find((p) => p.kind === "spi_printer_offset")!;
    expect(spi.args).toMatchObject({ offsetXUm: -7, offsetYUm: -7 });
    expect(spi.rationale).not.toContain("chưa đọc được lưới tag");
  });

  it("hiệu chỉnh tròn về 0 trên cả hai trục ⇒ không đề xuất spi (Review Focus 4)", () => {
    const ps = buildControlProposals({
      ...VERDICT_NG,
      machineId: 7,
      inspectionId: 1,
      spiTrend: Array(5).fill({ offsetXUm: 6, offsetYUm: 6 }),
      spiLuoi: { x: { dataType: "int", scale: 10, offset: 0 }, y: { dataType: "int", scale: 10, offset: 0 } },
    });
    expect(ps.map((p) => p.kind)).toEqual(["reject_divert"]);
  });

  it("một trục chưa đọc được lưới ⇒ trục đó theo roundDp, rationale ghi '(chưa đọc được lưới tag)'", () => {
    const ps = buildControlProposals({
      ...VERDICT_NG,
      machineId: 7,
      inspectionId: 1,
      spiTrend: [{ offsetXUm: 7.26, offsetYUm: 12.6 }],
      spiOpts: { gain: 1 },
      spiLuoi: { x: { dataType: "int", scale: 1, offset: 0 }, y: null },
    });
    const spi = ps.find((p) => p.kind === "spi_printer_offset")!;
    expect(spi.args).toMatchObject({ offsetXUm: -7, offsetYUm: -12.6 });
    expect(spi.rationale).toContain("(chưa đọc được lưới tag)");
  });

  it("proposeControlFromVerdict: có spiTrend, không có spiLuoi ⇒ gọi deps.layLuoiTagSpi(machineId) và đề xuất theo lưới; lỗi tra ⇒ roundDp + '(chưa đọc được lưới tag)'", async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const spiTool = { name: "spi_printer_offset", kind: "write" as const, requiredPermission: { module: "machine_control", action: "canEdit" as const } };
    const propose = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "a" } }));
    const layLuoiTagSpi = vi.fn(async (_m: number) => ({ x: { dataType: "int", scale: 1, offset: 0 }, y: { dataType: "int", scale: "10", offset: null } }));
    const deps: ProposeControlDeps = {
      propose: propose as never,
      findTargets: async () => [{ id: 1, role: "maintenance" }],
      getToolByName: (n) => (n === "spi_printer_offset" ? (spiTool as never) : undefined),
      resolveFactory: async () => null,
      layLuoiTagSpi,
    };
    const input = { ...VERDICT_NG, machineId: 7, inspectionId: 1, spiTrend: [{ offsetXUm: 7.26, offsetYUm: 12.6 }], spiOpts: { gain: 1 } };
    const res = await proposeControlFromVerdict(input, deps);
    expect(layLuoiTagSpi).toHaveBeenCalledWith(7);
    expect(res.proposed).toBe(1);
    const [, args] = propose.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(args).toMatchObject({ offsetXUm: -7, offsetYUm: -10 });

    propose.mockClear();
    const res2 = await proposeControlFromVerdict(input, { ...deps, layLuoiTagSpi: async () => { throw new Error("db down"); } });
    expect(res2.proposed).toBe(1);
    const [, args2] = propose.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(args2).toMatchObject({ offsetXUm: -7.3, offsetYUm: -12.6 });
    expect(res2.proposals.find((p) => p.kind === "spi_printer_offset")!.rationale).toContain("(chưa đọc được lưới tag)");
  });

  it("proposeControlFromVerdict: spiLuoi có sẵn ⇒ KHÔNG tra lại; không spiTrend / máy null ⇒ không tra", async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const layLuoiTagSpi = vi.fn(async () => ({ x: null, y: null }));
    const deps: ProposeControlDeps = { propose: vi.fn(async () => ({ ok: true })) as never, findTargets: async () => [], getToolByName: () => undefined, resolveFactory: async () => null, layLuoiTagSpi };
    await proposeControlFromVerdict({ ...VERDICT_NG, machineId: 7, inspectionId: 1, spiTrend: [{ offsetXUm: 9, offsetYUm: 9 }], spiLuoi: { x: null, y: null } }, deps);
    await proposeControlFromVerdict({ ...VERDICT_NG, machineId: 7, inspectionId: 1 }, deps);
    await proposeControlFromVerdict({ ...VERDICT_NG, machineId: null, inspectionId: 1, spiTrend: [{ offsetXUm: 9, offsetYUm: 9 }] }, deps);
    expect(layLuoiTagSpi).not.toHaveBeenCalled();
  });
});
