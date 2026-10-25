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
  laKenhDaKhai,
  proposeControlFromVerdict,
  type ControlProposal,
  type LuoiGhiTag,
  type ProposeControlDeps,
} from "./qualityControlProposer";
import { kiemGiaTriGhi } from "./scada/kenhScada";
import { kenhDaKhai } from "./scada/nhatQuanKenh";

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

  it("security review — trần: điểm lưới TRONG [−T, T] gần v nhất (offset ≠ 0, bước thô, v lớn) — lùi một bước kiểu cũ vẫn vượt trần", () => {
    // offset 10, bước 30, v 130 ⇒ lưới …, 40, 70, … ; bản cũ: 130 − 30 = 100 > 50. Đúng: 40.
    expect(lamTronTheoLuoiTag(130, { dataType: "int", scale: 30, offset: 10 }, 1, 50)).toBe(40);
    expect(lamTronTheoLuoiTag(-130, { dataType: "int", scale: 30, offset: -10 }, 1, 50)).toBe(-40); // đối xứng âm
    expect(lamTronTheoLuoiTag(200, { dataType: "int", scale: 20, offset: 5 }, 1, 50)).toBe(45); // bản cũ 185
    expect(lamTronTheoLuoiTag(-200, { dataType: "int", scale: -20, offset: -5 }, 1, 50)).toBe(-45); // scale âm cùng lưới
    expect(lamTronTheoLuoiTag(80, { dataType: "float", scale: 1, offset: 0, writeStep: 30, writeMin: 7 }, 1, 50)).toBe(37); // lưới float 7 + k·30
    expect(lamTronTheoLuoiTag(73.26, null, 1, 50)).toBe(50); // roundDp: kẹp vào 50.0
    expect(lamTronTheoLuoiTag(50, { dataType: "int", scale: 25, offset: 0 }, 1, 50)).toBe(50); // điểm lưới ĐÚNG bằng trần được giữ
  });

  it("security review — KHÔNG có điểm lưới nào trong [−T, T] ⇒ null (bản cũ trả −60 / 60, |r| > T); đối xứng âm", () => {
    expect(lamTronTheoLuoiTag(50, { dataType: "int", scale: 120, offset: 60 }, 1, 50)).toBeNull(); // lưới −60, 60
    expect(lamTronTheoLuoiTag(-50, { dataType: "int", scale: 120, offset: -60 }, 1, 50)).toBeNull();
    expect(lamTronTheoLuoiTag(0, { dataType: "int", scale: 120, offset: 60 }, 1, 50)).toBeNull();
    expect(lamTronTheoLuoiTag(1, { dataType: "int", scale: 1, offset: 0 }, 1, -1)).toBeNull(); // trần âm ⇒ không gì hợp lệ
  });

  it("polish M5 — v không hữu hạn ⇒ null (có trần hay không, mọi loại lưới), không bao giờ NaN", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      for (const luoi of [null, { dataType: "int", scale: 10, offset: 5 }, { dataType: "float", scale: 1, offset: 0, writeStep: 0.5, writeMin: null }] as const) {
        expect(lamTronTheoLuoiTag(v, luoi, 1, 50)).toBeNull();
        expect(lamTronTheoLuoiTag(v, luoi, 1)).toBeNull();
      }
  });

  it("security review — thuộc tính: ∀ lưới int (scale, offset) × v × trần ⇒ null HOẶC (|r| ≤ trần VÀ r nằm trên lưới)", () => {
    const scales = [0.1, 0.5, 1, 3, 7.5, 20, 30, 49, 99, 101, 120, -20];
    const offsets = [0, 0.3, 5, -5, 10, 25, -60, 60, 49.9];
    for (const s of scales)
      for (const o of offsets)
        for (const T of [0, 1, 7, 50])
          for (const v of [-200, -51, -50, -49.5, -7.26, 0, 3.3, 49.9, 50, 50.1, 130, 999]) {
            const r = lamTronTheoLuoiTag(v, { dataType: "int", scale: s, offset: o }, 1, T);
            if (r === null) continue;
            expect(Math.abs(r), `s=${s} o=${o} T=${T} v=${v} ⇒ ${r}`).toBeLessThanOrEqual(T);
            const k = (r - o) / s;
            expect(Math.abs(k - Math.round(k)), `lệch lưới s=${s} o=${o} T=${T} v=${v} ⇒ ${r}`).toBeLessThan(1e-6);
          }
  });

  it("security review — trục không có điểm lưới trong ±maxStepUm ⇒ KHÔNG đề xuất spi; maxStepUm > 50 bị chặn ở 50", () => {
    const ps = buildControlProposals({
      ...VERDICT_NG,
      machineId: 7,
      inspectionId: 1,
      spiTrend: [{ offsetXUm: -50, offsetYUm: -12 }],
      spiOpts: { gain: 1 },
      spiLuoi: { x: { dataType: "int", scale: 120, offset: 60 }, y: { dataType: "int", scale: 1, offset: 0 } },
    });
    expect(ps.map((p) => p.kind)).toEqual(["reject_divert"]);
    const r = computeSpiPrinterOffset([{ offsetXUm: -500, offsetYUm: 0 }], { gain: 1, maxStepUm: 80 });
    expect(r.maxStepUm).toBe(50);
    expect(r.offsetXUm).toBe(50);
    expect(r.khongCoDiemLuoi).toBe(false);
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

// ═════════════════ R1b-2a T2 (task-1-review M7) — tag int ĐÃ khai: lưới thô ∩ bước khai báo ∩ dải khai báo ∩ ±50 µm, hoặc null ═════════════════
describe("R1b-2a T2 (M7) — lamTronTheoLuoiTag trên tag int ĐÃ khai: tôn trọng writeStep + write_min / write_max", () => {
  const khai = (o: Partial<LuoiGhiTag>): LuoiGhiTag => ({ dataType: "int", scale: 1, offset: 0, channelKind: "output", writeMin: null, writeMax: null, writeStep: null, ...o });
  const VERDICT_NG = { verdict: { decision: "AUTO_NG", confidence: 0.92, topLabel: "bridging" } };

  it("laKenhDaKhai = bản sao đúng của nhatQuanKenh.kenhDaKhai (mọi tổ hợp NULL / khác NULL của bốn cột)", () => {
    for (let m = 0; m < 16; m++) {
      const t = { channelKind: m & 1 ? ("output" as const) : null, writeMin: m & 2 ? 0 : null, writeMax: m & 4 ? 1 : null, writeStep: m & 8 ? 1 : null };
      expect(laKenhDaKhai(t)).toBe(kenhDaKhai(t));
    }
  });

  it("dải: −7,26 trên int scale 1 dải −5..5 ⇒ −5 (bản T1: −7 ⇒ dispatch OUT_OF_RANGE); trong dải ⇒ như lưới thô", () => {
    expect(lamTronTheoLuoiTag(-7.26, khai({ writeMin: -5, writeMax: 5 }), 1, 50)).toBe(-5);
    expect(lamTronTheoLuoiTag(-3.4, khai({ writeMin: -5, writeMax: 5 }), 1, 50)).toBe(-3);
    expect(lamTronTheoLuoiTag(-7.26, khai({ writeMin: 0, writeMax: 300, scale: 10 }), 1, 50)).toBe(0); // dải 0..300 ∩ ±50 ⇒ 0
  });

  it("bước: −7,26 trên int scale 1 bước 2 ⇒ −8 (−7 lệch bước); bước 1.5 trên scale 0.5 dải 0..10: 4,1 ⇒ 4,5 (4 lệch bước)", () => {
    expect(lamTronTheoLuoiTag(-7.26, khai({ writeStep: 2 }), 1, 50)).toBe(-8);
    expect(lamTronTheoLuoiTag(4.1, khai({ scale: "0.5", writeMin: 0, writeMax: 10, writeStep: 1.5 }), 1, 50)).toBe(4.5);
    expect(lamTronTheoLuoiTag(-7.26, khai({ writeStep: 2, writeMin: -9 }), 1, 50)).toBe(-7); // gốc bước = writeMin ⇒ −9 + 2k: −7 hợp lệ
  });

  it("không có giá trị nào thoả cả bốn ⇒ null (không đề xuất): dải không chứa điểm lưới thô; bước lẻ ∩ lưới chẵn; dải ngoài ±50", () => {
    expect(lamTronTheoLuoiTag(65, khai({ scale: 10, writeMin: 61, writeMax: 69 }), 1, 50)).toBeNull();
    expect(lamTronTheoLuoiTag(20, khai({ scale: 10, writeMin: 1, writeMax: 49, writeStep: 4 }), 1, 50)).toBeNull(); // 1 + 4k lẻ, lưới 10k chẵn
    expect(lamTronTheoLuoiTag(-7, khai({ writeMin: 60, writeMax: 100 }), 1, 50)).toBeNull();
    expect(lamTronTheoLuoiTag(-7, khai({ writeMin: -10, writeMax: 10 }), 1, -1)).toBeNull(); // trần âm
  });

  it("không trần (tranTuyetDoi vắng) ⇒ vẫn dải + bước; không khai gì ngoài channel_kind ⇒ chỉ lưới thô", () => {
    expect(lamTronTheoLuoiTag(130, khai({ writeMin: 0, writeMax: 100, writeStep: 5 }), 1)).toBe(100);
    expect(lamTronTheoLuoiTag(-7.26, khai({}), 1)).toBe(-7);
    expect(Object.is(lamTronTheoLuoiTag(-0.3, khai({ scale: 10 }), 1, 50), 0)).toBe(true);
  });

  it("tag CHƯA khai (bốn cột NULL) KHÔNG đổi hành vi T1 (dải không có để tôn trọng)", () => {
    expect(lamTronTheoLuoiTag(-7.26, { dataType: "int", scale: 1, offset: 0, channelKind: null, writeMin: null, writeMax: null, writeStep: null }, 1, 50)).toBe(-7);
  });

  it("thuộc tính + tối ưu: ∀ cấu hình khai báo × v × trần ⇒ null ⇔ không điểm lưới thô nào trong [lo, hi] được kiemGiaTriGhi nhận; khác null ⇒ được nhận, |r| ≤ T, và GẦN v NHẤT (so với duyệt vét)", () => {
    const cauHinh: Array<Partial<LuoiGhiTag>> = [];
    for (const scale of [1, 0.5, 10, 2.5, -10])
      for (const offset of [0, 0.5, 3])
        for (const [writeMin, writeMax] of [[null, null], [-20, 20], [0, 300], [5, 15], [-100, -60]] as const)
          for (const writeStep of [null, 2, 1.5, 5, 7]) cauHinh.push({ scale, offset, writeMin, writeMax, writeStep });
    let soNull = 0;
    let soCo = 0;
    for (const c of cauHinh) {
      const luoi = khai(c);
      const tag = { dataType: "int" as const, writeMin: luoi.writeMin ?? null, writeMax: luoi.writeMax ?? null, writeStep: luoi.writeStep ?? null, scale: luoi.scale, offset: luoi.offset };
      const b = Math.abs(Number(luoi.scale));
      const o = Number(luoi.offset);
      for (const T of [7, 50])
        for (const v of [-63.3, -7.26, 0, 3.3, 12.6, 49.9, 77]) {
          const r = lamTronTheoLuoiTag(v, luoi, 1, T);
          // duyệt vét mọi điểm lưới thô trong [max(min, −T), min(max, T)]
          const lo = Math.max(luoi.writeMin ?? -T, -T);
          const hi = Math.min(luoi.writeMax ?? T, T);
          let tot: number | null = null;
          for (let k = Math.ceil((lo - o) / b - 1e-9); k <= Math.floor((hi - o) / b + 1e-9); k++) {
            const x = Number((o + k * b).toPrecision(15));
            if (Math.abs(x) <= T && kiemGiaTriGhi(tag, x).ok && (tot === null || Math.abs(x - v) < Math.abs(tot - v))) tot = x;
          }
          const nhan = `${JSON.stringify(c)} T=${T} v=${v} ⇒ ${r}`;
          if (tot === null) {
            expect(r, nhan).toBeNull();
            soNull++;
          } else {
            expect(r, nhan).not.toBeNull();
            expect(kiemGiaTriGhi(tag, r).ok, nhan).toBe(true);
            expect(Math.abs(r!), nhan).toBeLessThanOrEqual(T);
            expect(Math.abs(r! - v), nhan).toBeCloseTo(Math.abs(tot - v), 9);
            soCo++;
          }
        }
    }
    expect(soNull).toBeGreaterThan(50); // cả hai nhánh thực sự được phủ
    expect(soCo).toBeGreaterThan(500);
  });

  it("buildControlProposals: trục tag ĐÃ khai không có giá trị hợp lệ trong dải ∩ ±50 ⇒ KHÔNG đề xuất spi; có ⇒ đề xuất mang giá trị trong dải", () => {
    const base = { ...VERDICT_NG, machineId: 7, inspectionId: 1, spiTrend: [{ offsetXUm: 7.26, offsetYUm: 7.26 }], spiOpts: { gain: 1 } };
    const khong = buildControlProposals({ ...base, spiLuoi: { x: khai({ writeMin: 60, writeMax: 100 }), y: khai({}) } });
    expect(khong.map((p) => p.kind)).toEqual(["reject_divert"]);
    const co = buildControlProposals({ ...base, spiLuoi: { x: khai({ writeMin: -5, writeMax: 5 }), y: khai({ writeStep: 2 }) } });
    expect(co.find((p) => p.kind === "spi_printer_offset")!.args).toMatchObject({ offsetXUm: -5, offsetYUm: -8 });
  });
});
