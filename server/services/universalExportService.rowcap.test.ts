/**
 * doc 54 §11 P2.4 #1 — export row-cap (OOM guard) tests.
 *
 * Proves:
 *  1. exportMaxRows() default (100000) + valid/invalid env override handling.
 *  2. capRowsForRender is a byte-identical no-op within the cap (same array ref),
 *     and over the cap keeps exactly `max` rows + ONE visible marker row placed
 *     in a TEXT column (never coerced to NaN by a numeric-format path).
 *  3. renderReport surfaces truncated/totalRows/renderedRows and emits a visible
 *     truncation marker in the rendered file (CSV), while staying unchanged when
 *     the dataset is within the cap.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  exportMaxRows,
  capRowsForRender,
  renderReport,
  type ExportColumn,
} from "./universalExportService";

const COLUMNS: ExportColumn[] = [
  { key: "name", header: "Tên" },
  { key: "count", header: "Số", format: "number" },
];

function makeData(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ name: `row-${i}`, count: i }));
}

const ORIGINAL = process.env.EXPORT_MAX_ROWS;
function setMax(v: string | undefined): void {
  if (v === undefined) delete process.env.EXPORT_MAX_ROWS;
  else process.env.EXPORT_MAX_ROWS = v;
}

describe("exportMaxRows", () => {
  afterEach(() => setMax(ORIGINAL));

  it("defaults to 100000 when unset", () => {
    setMax(undefined);
    expect(exportMaxRows()).toBe(100_000);
  });

  it("honors a valid positive override", () => {
    setMax("5000");
    expect(exportMaxRows()).toBe(5000);
  });

  it("ignores a non-positive / non-numeric override", () => {
    setMax("-1");
    expect(exportMaxRows()).toBe(100_000);
    setMax("abc");
    expect(exportMaxRows()).toBe(100_000);
  });
});

describe("capRowsForRender", () => {
  it("is a no-op (identical array ref) within the cap", () => {
    const data = makeData(3);
    const capped = capRowsForRender(data, COLUMNS, "vi", 10);
    expect(capped.truncated).toBe(false);
    expect(capped.rows).toBe(data); // same reference → un-truncated render is byte-identical
    expect(capped.totalRows).toBe(3);
    expect(capped.renderedRows).toBe(3);
  });

  it("keeps exactly `max` rows + one text-column marker over the cap", () => {
    const data = makeData(10);
    const capped = capRowsForRender(data, COLUMNS, "en", 4);
    expect(capped.truncated).toBe(true);
    expect(capped.totalRows).toBe(10);
    expect(capped.renderedRows).toBe(4);
    expect(capped.rows.length).toBe(5); // 4 kept + 1 marker
    const marker = capped.rows[capped.rows.length - 1] as Record<string, unknown>;
    expect(String(marker.name)).toContain("TRUNCATED");
    expect(marker.count).toBeUndefined(); // marker never lands in the numeric column
  });
});

describe("renderReport — truncation signal", () => {
  afterEach(() => setMax(ORIGINAL));

  it("flags truncated and emits a visible marker row (CSV)", async () => {
    setMax("3");
    const out = await renderReport({
      type: "t",
      title: "Cap test",
      format: "csv",
      locale: "en",
      columns: COLUMNS,
      data: makeData(20),
    });
    expect(out.truncated).toBe(true);
    expect(out.totalRows).toBe(20);
    expect(out.renderedRows).toBe(3);
    expect(out.buffer.toString("utf8")).toContain("TRUNCATED");
  });

  it("does not truncate or alter output within the cap", async () => {
    setMax("1000");
    const out = await renderReport({
      type: "t",
      title: "No cap",
      format: "csv",
      locale: "en",
      columns: COLUMNS,
      data: makeData(5),
    });
    expect(out.truncated).toBe(false);
    expect(out.totalRows).toBe(5);
    expect(out.renderedRows).toBe(5);
    expect(out.buffer.toString("utf8")).not.toContain("TRUNCATED");
  });
});
