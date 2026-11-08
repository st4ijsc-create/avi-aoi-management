import { describe, expect, test, vi } from "vitest";
import { renderMsaReportMarkdown } from "./msaReport";

type MsaReportInput = {
  instrument: {
    id: number;
    code: string;
    name: string;
    instrumentType: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    defaultUnit: string | null;
  };
  msa: {
    id: number;
    method: string;
    performedAt: Date | null;
    validUntil: Date | null;
    evPct: number | string | null | undefined;
    avPct: number | string | null | undefined;
    grrPct: number | string | null | undefined;
    ndc: number | null | undefined;
    ptRatio: number | string | null | undefined;
    biasValue: number | string | null | undefined;
    linearityScore: number | string | null | undefined;
    stabilityScore: number | string | null | undefined;
    verdict: string;
    approvedBy: number | null;
    approvedAt: Date | null;
    notes: string | null;
  };
};

function makeInput(overrides?: {
  instrument?: Partial<MsaReportInput["instrument"]>;
  msa?: Partial<MsaReportInput["msa"]>;
}): MsaReportInput {
  return {
    instrument: {
      id: 42,
      code: "GA-001",
      name: "Caliper Digital",
      instrumentType: "gauge",
      manufacturer: "Mitutoyo",
      model: "CD-150",
      serialNumber: "SN-12345",
      defaultUnit: "mm",
      ...overrides?.instrument,
    },
    msa: {
      id: 7,
      method: "Gauge R&R",
      performedAt: new Date("2026-03-31T23:30:00Z"),
      validUntil: new Date("2027-03-31T23:59:59Z"),
      evPct: 5.1234,
      avPct: 2.6789,
      grrPct: 7.8023,
      ndc: 8,
      ptRatio: 0.123456,
      biasValue: 0.0045,
      linearityScore: 0.9876,
      stabilityScore: 0.5432,
      verdict: "good",
      approvedBy: null,
      approvedAt: null,
      notes: null,
      ...overrides?.msa,
    },
  };
}

describe("renderMsaReportMarkdown", () => {
  test("(1) Tiêu đề '# MSA Report — <code> (<name>)'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toMatch(/^# MSA Report — GA-001 \(Caliper Digital\)$/m);
  });

  test("(2) Verdict in HOA", () => {
    const resultGood = renderMsaReportMarkdown(makeInput({ msa: { verdict: "good" } }));
    expect(resultGood).toContain("**Verdict:** GOOD");

    const resultAcceptable = renderMsaReportMarkdown(makeInput({ msa: { verdict: "acceptable" } }));
    expect(resultAcceptable).toContain("**Verdict:** ACCEPTABLE");

    const resultPoor = renderMsaReportMarkdown(makeInput({ msa: { verdict: "poor" } }));
    expect(resultPoor).toContain("**Verdict:** POOR");
  });

  test("(3a) performedAt 23:30 UTC → '2026-03-31'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("**Performed:** 2026-03-31");
  });

  test("(3b) validUntil 23:59:59 UTC → '2027-03-31'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("**Valid Until:** 2027-03-31");
  });

  test("(3c) performedAt null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { performedAt: null } }));
    expect(result).toContain("**Performed:** —");
  });

  test("(3d) validUntil null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { validUntil: null } }));
    expect(result).toContain("**Valid Until:** —");
  });

  test("(4a) evPct number 5.1234 → '5.12' (2 chữ số)", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| EV% (Equipment Variation) | 5.12 |");
  });

  test("(4b) evPct string '12.3456' → '12.35' (làm tròn 2 chữ số)", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { evPct: "12.3456" } }));
    expect(result).toContain("| EV% (Equipment Variation) | 12.35 |");
  });

  test("(4c) avPct 2.6789 → '2.68'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| AV% (Appraiser Variation) | 2.68 |");
  });

  test("(4d) grrPct 7.8023 → '7.80'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| GR&R% | 7.80 |");
  });

  test("(5a) ptRatio 0.123456 → '0.1235' (4 chữ số)", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| P/T Ratio | 0.1235 |");
  });

  test("(5b) biasValue 0.0045 → '0.0045'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| Bias | 0.0045 |");
  });

  test("(5c) linearityScore 0.9876 → '0.9876'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| Linearity Score | 0.9876 |");
  });

  test("(5d) stabilityScore 0.5432 → '0.5432'", () => {
    const result = renderMsaReportMarkdown(makeInput());
    expect(result).toContain("| Stability Score | 0.5432 |");
  });

  test("(6a) fmtNum null → '—'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { evPct: null, avPct: null, grrPct: null, ptRatio: null, biasValue: null, linearityScore: null, stabilityScore: null } })
    );
    expect(result).toContain("| EV% (Equipment Variation) | — |");
    expect(result).toContain("| AV% (Appraiser Variation) | — |");
    expect(result).toContain("| GR&R% | — |");
    expect(result).toContain("| P/T Ratio | — |");
    expect(result).toContain("| Bias | — |");
    expect(result).toContain("| Linearity Score | — |");
    expect(result).toContain("| Stability Score | — |");
  });

  test("(6b) fmtNum undefined → '—'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { evPct: undefined, avPct: undefined, grrPct: undefined } })
    );
    expect(result).toContain("| EV% (Equipment Variation) | — |");
    expect(result).toContain("| AV% (Appraiser Variation) | — |");
    expect(result).toContain("| GR&R% | — |");
  });

  test("(6c) fmtNum '' (chuỗi rỗng) → '—'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { evPct: "", avPct: "", grrPct: "" } })
    );
    expect(result).toContain("| EV% (Equipment Variation) | — |");
    expect(result).toContain("| AV% (Appraiser Variation) | — |");
    expect(result).toContain("| GR&R% | — |");
  });

  test("(6d) fmtNum 'abc' (không phải số) → '—'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { evPct: "abc", avPct: "abc", grrPct: "abc" } })
    );
    expect(result).toContain("| EV% (Equipment Variation) | — |");
    expect(result).toContain("| AV% (Appraiser Variation) | — |");
    expect(result).toContain("| GR&R% | — |");
  });

  test("(7a) ndc = 0 → '0'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { ndc: 0 } }));
    expect(result).toContain("| ndc (Number of Distinct Categories) | 0 |");
  });

  test("(7b) ndc = 8 → '8'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { ndc: 8 } }));
    expect(result).toContain("| ndc (Number of Distinct Categories) | 8 |");
  });

  test("(7c) ndc null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { ndc: null } }));
    expect(result).toContain("| ndc (Number of Distinct Categories) | — |");
  });

  test("(8a) manufacturer null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ instrument: { manufacturer: null } }));
    expect(result).toContain("| Manufacturer | — |");
  });

  test("(8b) model null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ instrument: { model: null } }));
    expect(result).toContain("| Model | — |");
  });

  test("(8c) serialNumber null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ instrument: { serialNumber: null } }));
    expect(result).toContain("| Serial | — |");
  });

  test("(8d) defaultUnit null → '—'", () => {
    const result = renderMsaReportMarkdown(makeInput({ instrument: { defaultUnit: null } }));
    expect(result).toContain("| Unit | — |");
  });

  test("(9a) approvedAt null → không có khối 'Approved:'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { approvedAt: null } }));
    expect(result).not.toContain("**Approved:**");
  });

  test("(9b) approvedAt có giá trị → có khối 'Approved:'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { approvedAt: new Date("2026-04-01T10:00:00Z") } })
    );
    expect(result).toContain("**Approved:** 2026-04-01");
  });

  test("(10a) approvedBy null → 'user #—'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { approvedAt: new Date("2026-04-01T10:00:00Z"), approvedBy: null } })
    );
    expect(result).toContain("by user #—");
  });

  test("(10b) approvedBy có giá trị → 'user #<id>'", () => {
    const result = renderMsaReportMarkdown(
      makeInput({ msa: { approvedAt: new Date("2026-04-01T10:00:00Z"), approvedBy: 123 } })
    );
    expect(result).toContain("by user #123");
  });

  test("(11a) notes null → không có '## Notes'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { notes: null } }));
    expect(result).not.toContain("## Notes");
  });

  test("(11b) notes '' → không có '## Notes'", () => {
    const result = renderMsaReportMarkdown(makeInput({ msa: { notes: "" } }));
    expect(result).not.toContain("## Notes");
  });

  test("(11c) notes có nội dung → có '## Notes' và chứa đúng nội dung", () => {
    const noteText = "Kiểm tra lại calibration trước khi sử dụng.";
    const result = renderMsaReportMarkdown(makeInput({ msa: { notes: noteText } }));
    expect(result).toContain("## Notes");
    expect(result).toContain(noteText);
  });

  test("(12) Dòng cuối '_Generated <ISO> — record #<id>_' với fake timers", () => {
    const fakeNow = new Date("2026-06-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = renderMsaReportMarkdown(makeInput());

    expect(result).toContain(`_Generated ${fakeNow.toISOString()} — record #7_`);

    vi.useRealTimers();
  });

  test("(12b) Dòng cuối thay đổi id record", () => {
    const fakeNow = new Date("2026-06-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const result = renderMsaReportMarkdown(makeInput({ msa: { id: 99 } }));

    expect(result).toContain(`_Generated ${fakeNow.toISOString()} — record #99_`);

    vi.useRealTimers();
  });
});
