/**
 * P4.B G16 — As-built dimensional report.
 *
 * Generates a Markdown report comparing each measurement point's specification
 * (LSL/USL/nominal) to the actually-measured value for one inspection. PDF
 * generation is deferred — Markdown is the canonical artefact.
 */

import type { ProductInspection, MeasurementResult } from "../../drizzle/schema/inspection";
import type { MeasurementPointDef } from "../../drizzle/schema/product";

export interface AsBuiltRow {
  pointDef: Pick<MeasurementPointDef,
    "id" | "code" | "name" | "unit" | "lowerLimit" | "upperLimit" | "nominalValue"
  >;
  result: Pick<MeasurementResult,
    "id" | "measuredValue" | "measuredValueText" | "result" | "remark"
  > | null;
}

export interface AsBuiltReportInput {
  inspection: Pick<ProductInspection,
    "id" | "serialNumber" | "productModel" | "batchNumber" | "machineId"
    | "overallResult" | "originalResult" | "inspectionTime" | "operatorId"
  >;
  rows: AsBuiltRow[];
}

function fmt(n: string | number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  return v.toFixed(digits);
}

function deviation(measured: string | number | null | undefined, nominal: string | number | null | undefined): string {
  if (measured == null || nominal == null || measured === "" || nominal === "") return "—";
  const m = Number(measured);
  const n = Number(nominal);
  if (Number.isNaN(m) || Number.isNaN(n)) return "—";
  const d = m - n;
  return (d >= 0 ? "+" : "") + d.toFixed(4);
}

function judgement(row: AsBuiltRow): string {
  const r = row.result?.result;
  if (r === "OK") return "✓ OK";
  if (r === "NG") return "✗ NG";
  if (r === "NTF") return "… NTF";
  return row.result ? String(r) : "—";
}

export function renderAsBuiltReportMarkdown(input: AsBuiltReportInput): string {
  const { inspection: i, rows } = input;
  const okCount = rows.filter((r) => r.result?.result === "OK").length;
  const ngCount = rows.filter((r) => r.result?.result === "NG").length;
  const missing = rows.filter((r) => !r.result).length;

  const lines: string[] = [];
  lines.push(`# As-Built Report — ${i.serialNumber}`);
  lines.push("");
  lines.push(`**Inspection #:** ${i.id}  `);
  lines.push(`**Product Model:** ${i.productModel ?? "—"}  `);
  lines.push(`**Batch:** ${i.batchNumber ?? "—"}  `);
  lines.push(`**Machine ID:** ${i.machineId}  `);
  lines.push(`**Operator:** ${i.operatorId ?? "—"}  `);
  lines.push(`**Inspection Time:** ${new Date(i.inspectionTime).toISOString()}  `);
  lines.push(`**Overall Result:** ${i.overallResult} (original: ${i.originalResult})  `);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Total Points | OK | NG | Missing |`);
  lines.push(`| ---: | ---: | ---: | ---: |`);
  lines.push(`| ${rows.length} | ${okCount} | ${ngCount} | ${missing} |`);
  lines.push("");
  lines.push("## Measurements");
  lines.push("");
  lines.push(`| # | Code | Name | Unit | LSL | Nominal | USL | Measured | Δ vs Nominal | Result | Remark |`);
  lines.push(`| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | :---: | --- |`);
  rows.forEach((row, idx) => {
    const d = row.pointDef;
    const r = row.result;
    const measured = r?.measuredValue != null
      ? fmt(r.measuredValue)
      : (r?.measuredValueText ?? "—");
    lines.push(
      `| ${idx + 1} | ${d.code} | ${d.name} | ${d.unit ?? "—"} | ${fmt(d.lowerLimit)} | ${fmt(d.nominalValue)} | ${fmt(d.upperLimit)} | ${measured} | ${deviation(r?.measuredValue, d.nominalValue)} | ${judgement(row)} | ${(r?.remark ?? "").replace(/\|/g, "\\|").slice(0, 120)} |`
    );
  });
  lines.push("");
  lines.push("---");
  lines.push(`_Generated ${new Date().toISOString()} — inspection #${i.id}_`);
  return lines.join("\n");
}
