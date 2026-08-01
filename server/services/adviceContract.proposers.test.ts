/**
 * G4.29 (doc 44 W5-A3) — the two proposal sources attach an advice contract.
 *
 * Pure builders, no mocks:
 *   • aiAutoProposer.decideNgBurst        → contract.requires ['policy_permit'] +
 *     a guardrail bounding the tightened warning to [0, current].
 *   • qualityControlProposer.buildControlProposals → each proposal carries
 *     requires ['policy_permit','human_approval'], confidence from provenance, and
 *     an explanation; the SPI correction ALSO carries a ±maxStep guardrail.
 */
import { describe, it, expect } from "vitest";
import { decideNgBurst } from "./aiAutoProposer";
import { buildControlProposals } from "./qualityControlProposer";

describe("aiAutoProposer.decideNgBurst — attaches an advice contract", () => {
  it("ng_burst draft carries requires[policy_permit] + a [0, current] guardrail", () => {
    const res = decideNgBurst({ id: 7, warningThreshold: 10, criticalThreshold: 20 }, "NG burst on M1");
    expect(res.draft).toBeTruthy();
    const c = res.draft!.contract!;
    expect(c.requires).toEqual(["policy_permit"]);
    // The tightened warning (10 * 0.8 = 8) is bounded to [0, 10].
    expect(c.guardrail).toMatchObject({ min: 0, max: 10, unit: "%", key: "warningThreshold" });
    expect(res.draft!.args.warningThreshold).toBe(8);
    expect(c.explain).toEqual(["NG burst on M1"]);
  });

  it("no existing threshold → no draft (and therefore no contract)", () => {
    expect(decideNgBurst(null, "x").draft).toBeNull();
  });
});

describe("qualityControlProposer.buildControlProposals — attaches an advice contract", () => {
  const baseVerdict = { decision: "AUTO_NG", confidence: 0.92, topLabel: "bridging" } as const;

  it("reject_divert carries requires[policy_permit,human_approval] + confidence + explain", () => {
    const [p] = buildControlProposals({ verdict: { ...baseVerdict }, inspectionId: 55, machineId: 5 });
    expect(p.contract).toBeTruthy();
    expect(p.contract!.requires).toEqual(["policy_permit", "human_approval"]);
    expect(p.contract!.confidence).toBe(0.92); // from provenance
    expect(p.contract!.explain).toEqual([p.rationale]);
    expect(p.contract!.guardrail).toBeUndefined(); // divert has no numeric band
  });

  it("spi_printer_offset ALSO carries a ±maxStep guardrail on offsetXUm", () => {
    const proposals = buildControlProposals({
      verdict: { ...baseVerdict },
      inspectionId: 55,
      machineId: 5,
      spiTrend: [
        { offsetXUm: 12, offsetYUm: -5 },
        { offsetXUm: 12, offsetYUm: -5 },
      ],
    });
    const spi = proposals.find((x) => x.kind === "spi_printer_offset")!;
    expect(spi.contract!.requires).toEqual(["policy_permit", "human_approval"]);
    expect(spi.contract!.guardrail).toMatchObject({ min: -50, max: 50, unit: "µm", key: "offsetXUm" });
    // The clamped correction (-6) is inside the band.
    expect(spi.args.offsetXUm).toBe(-6);
  });

  it("anomaly source with null confidence → contract omits confidence (honest)", () => {
    const [p] = buildControlProposals({
      verdict: { decision: "ANOMALY", confidence: null, source: "anomaly", topLabel: "anomaly" },
      inspectionId: 9,
      machineId: 5,
    });
    expect(p.contract!.requires).toEqual(["policy_permit", "human_approval"]);
    expect(p.contract).not.toHaveProperty("confidence");
  });
});
