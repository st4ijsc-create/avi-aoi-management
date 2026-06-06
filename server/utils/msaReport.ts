/**
 * P4.B G12 — MSA report (Gauge R&R / Bias / Linearity / Stability) renderer.
 *
 * Produces a self-contained Markdown report from an `instrumentMsaRecords`
 * row plus its parent instrument. PDF generation is deferred — Markdown is
 * the canonical machine-readable artefact and renders cleanly in any viewer.
 *
 * Caller is responsible for persisting / serving the result.
 */

import type { InstrumentMsaRecord, MeasurementInstrument } from "../../drizzle/schema/product";

export interface MsaReportInput {
  instrument: Pick<MeasurementInstrument,
    "id" | "code" | "name" | "instrumentType" | "manufacturer" | "model" | "serialNumber" | "defaultUnit"
  >;
  msa: Pick<InstrumentMsaRecord,
    "id" | "method" | "performedAt" | "validUntil" | "evPct" | "avPct" | "grrPct" | "ndc" | "ptRatio"
    | "biasValue" | "linearityScore" | "stabilityScore" | "verdict" | "approvedBy" | "approvedAt" | "notes"
  >;
}

function fmtNum(n: string | number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

export function renderMsaReportMarkdown(input: MsaReportInput): string {
  const { instrument: i, msa: m } = input;
  const lines: string[] = [];
  lines.push(`# MSA Report — ${i.code} (${i.name})`);
  lines.push("");
  lines.push(`**Method:** ${m.method}  `);
  lines.push(`**Verdict:** ${m.verdict.toUpperCase()}  `);
  lines.push(`**Performed:** ${fmtDate(m.performedAt)}  `);
  lines.push(`**Valid Until:** ${fmtDate(m.validUntil)}  `);
  lines.push("");
  lines.push("## Instrument");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| ID | ${i.id} |`);
  lines.push(`| Code | ${i.code} |`);
  lines.push(`| Name | ${i.name} |`);
  lines.push(`| Type | ${i.instrumentType} |`);
  lines.push(`| Manufacturer | ${i.manufacturer ?? "—"} |`);
  lines.push(`| Model | ${i.model ?? "—"} |`);
  lines.push(`| Serial | ${i.serialNumber ?? "—"} |`);
  lines.push(`| Unit | ${i.defaultUnit ?? "—"} |`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| EV% (Equipment Variation) | ${fmtNum(m.evPct, 2)} |`);
  lines.push(`| AV% (Appraiser Variation) | ${fmtNum(m.avPct, 2)} |`);
  lines.push(`| GR&R% | ${fmtNum(m.grrPct, 2)} |`);
  lines.push(`| ndc (Number of Distinct Categories) | ${m.ndc ?? "—"} |`);
  lines.push(`| P/T Ratio | ${fmtNum(m.ptRatio, 4)} |`);
  lines.push(`| Bias | ${fmtNum(m.biasValue)} |`);
  lines.push(`| Linearity Score | ${fmtNum(m.linearityScore, 4)} |`);
  lines.push(`| Stability Score | ${fmtNum(m.stabilityScore, 4)} |`);
  lines.push("");
  lines.push("## Acceptance Criteria (AIAG MSA 4th Ed.)");
  lines.push("");
  lines.push(`- **GR&R% < 10%** → good (process capable)`);
  lines.push(`- **10% ≤ GR&R% ≤ 30%** → acceptable (review)`);
  lines.push(`- **GR&R% > 30%** → poor (reject)`);
  lines.push(`- **ndc ≥ 5** required for variable gauge studies`);
  lines.push("");
  if (m.approvedAt) {
    lines.push(`**Approved:** ${fmtDate(m.approvedAt)} by user #${m.approvedBy ?? "—"}`);
    lines.push("");
  }
  if (m.notes) {
    lines.push("## Notes");
    lines.push("");
    lines.push(m.notes);
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Generated ${new Date().toISOString()} — record #${m.id}_`);
  return lines.join("\n");
}
