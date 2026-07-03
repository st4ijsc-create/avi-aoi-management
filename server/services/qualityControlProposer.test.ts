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
