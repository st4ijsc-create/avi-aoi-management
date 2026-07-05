/**
 * Wave R5 (doc 32 §2 P3 #18) — EN/ZH coverage for the report/export surface.
 *
 * Every `t("...")` key used by the report pages must resolve in ALL THREE
 * locales (vi/en/zh) so the report surface never falls back to hardcoded
 * Vietnamese. Reads the locale JSON + the page sources straight off disk.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const url = (rel: string) => new URL(rel, import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(url(rel), "utf8"));
const readSrc = (rel: string) => readFileSync(url(rel), "utf8");

const LOCALES = {
  vi: readJson("./locales/vi.json"),
  en: readJson("./locales/en.json"),
  zh: readJson("./locales/zh.json"),
} as const;

// The report / export surface (doc 32 §4 Wave R5, item 18).
const REPORT_FILES = [
  "../pages/Reports.tsx",
  "../pages/ReportBuilder.tsx",
  "../pages/ScheduledReports.tsx",
  "../pages/PdfReports.tsx",
  "../pages/AIReportsPage.tsx",
  "../pages/RealtimeReportView.tsx",
  "../pages/HistoryExportScheduling.tsx",
  "../components/ReportExportButton.tsx",
];

function hasKey(obj: unknown, dotted: string): boolean {
  return (
    dotted.split(".").reduce<unknown>(
      (o, k) => (o && typeof o === "object" && k in (o as Record<string, unknown>) ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    ) !== undefined
  );
}

/** Extract static `t("key" | 'key' | `key`)` keys, skipping dynamic/interpolated ones. */
function extractKeys(src: string): string[] {
  const keys = new Set<string>();
  const re = /\bt\(\s*[`"']([^`"']+)[`"']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const key = m[1];
    if (key.includes("$") || key.includes("{") || key.includes("`")) continue; // dynamic key
    keys.add(key);
  }
  return [...keys];
}

const ALL_KEYS = (() => {
  const set = new Set<string>();
  for (const f of REPORT_FILES) for (const k of extractKeys(readSrc(f))) set.add(k);
  return [...set].sort();
})();

describe("report-surface i18n coverage", () => {
  it("extracts a meaningful number of t() keys from the report surface", () => {
    expect(ALL_KEYS.length).toBeGreaterThan(100);
  });

  for (const loc of ["vi", "en", "zh"] as const) {
    it(`every report-surface key resolves in ${loc} (no missing-key fallback)`, () => {
      const missing = ALL_KEYS.filter((k) => !hasKey(LOCALES[loc], k));
      expect(missing, `missing in ${loc}: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("newly backfilled keys are present in all three locales", () => {
    const newKeys = [
      "reports.export",
      "reports.line",
      "reports.station",
      "reports.product",
      "reports.shift",
      "reports.ngRatePercent",
      "rtReport.title",
      "rtReport.apply",
      "rtReport.enpi",
      "settings.email.reportBrandingNote",
    ];
    for (const loc of ["vi", "en", "zh"] as const) {
      const missing = newKeys.filter((k) => !hasKey(LOCALES[loc], k));
      expect(missing, `missing in ${loc}: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("zh values are genuinely translated, not Vietnamese copies, for the report namespaces", () => {
    // A representative sample of report keys — zh must differ from vi (real CJK).
    const sample = ["rtReport.apply", "rtReport.title", "reports.export", "reports.shift"];
    for (const k of sample) {
      const vi = k.split(".").reduce<any>((o, s) => o?.[s], LOCALES.vi);
      const zh = k.split(".").reduce<any>((o, s) => o?.[s], LOCALES.zh);
      expect(zh).toBeDefined();
      expect(zh).not.toBe(vi);
    }
  });
});
