/**
 * run-vision-validation.mjs — doc 27 V17 (Đợt 7.6): run the vision validation
 * harness (accuracy + Gage R&R) and write JSON + Markdown reports.
 *
 * Usage (via tsx — the harness is TypeScript):
 *   npm run vision:validate                          # bundled synthetic study
 *   npm run vision:validate -- path/to/corpus.json   # real corpus manifest
 *
 * Reports land in ./validation-reports/ (gitignored). See
 * server/services/vision/__validation__/README.md for the corpus format.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const harness = await import("../server/services/vision/validationHarness.ts");

const manifestArg = process.argv[2];

let study;
if (manifestArg) {
  const manifestPath = path.resolve(manifestArg);
  if (!fs.existsSync(manifestPath)) {
    console.error(`Corpus manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  console.log(`Loading REAL corpus: ${manifestPath}`);
  study = await harness.loadCorpusStudy(manifestPath);
} else {
  console.log("No manifest given — running the bundled SYNTHETIC study (labelled synthetic).");
  study = harness.buildSyntheticStudy();
}

console.log(
  `Study "${study.name}": ${study.registration.length} registration case(s), ${study.spi.length} SPI case(s) — running…`,
);
const started = Date.now();
const report = await harness.runValidationStudy(study);
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const outDir = path.resolve("validation-reports");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jsonPath = path.join(outDir, `vision-validation-${stamp}.json`);
const mdPath = path.join(outDir, `vision-validation-${stamp}.md`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(mdPath, harness.renderReportMarkdown(report), "utf8");

console.log(`\nReports written:\n  ${jsonPath}\n  ${mdPath}\n`);
if (report.registration?.gageRRDx) {
  const g = report.registration.gageRRDx;
  console.log(`Registration %GRR(dx) = ${g.pctGrr.toFixed(1)}% (${g.verdict}), ndc=${g.ndc}`);
}
if (report.spi?.gageRRVolume) {
  const g = report.spi.gageRRVolume;
  console.log(`SPI volume  %GRR      = ${g.pctGrr.toFixed(1)}% (${g.verdict}), ndc=${g.ndc}`);
}
