/**
 * Quick smoke test cho aiAdvancedVision service.
 *
 * Cách chạy:
 *   pnpm exec tsx test-advanced-vision.mjs <ok.png> [ng.png]
 *
 * Ví dụ:
 *   pnpm exec tsx test-advanced-vision.mjs uploads/inspections/2341/C201-uvAAVpdJ.png uploads/inspections/2341/C201-tI8vMnBE.jpeg
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  imageQualityCheck,
  compareOkVsNg,
  generateDefectHeatmap,
  extractText,
  autoDetectRoi,
  augmentImage,
  visualQA,
  batchTriage,
} from "./server/services/aiAdvancedVision.ts";

const okPath = process.argv[2];
const ngPath = process.argv[3] ?? okPath;

if (!okPath) {
  console.error("Usage: pnpm exec tsx test-advanced-vision.mjs <ok.png> [ng.png]");
  process.exit(1);
}

const ok = await fs.readFile(okPath);
const ng = await fs.readFile(ngPath);

const outDir = "uploads/test-temp/vision-demo";
await fs.mkdir(outDir, { recursive: true });

console.log("\n=== B. imageQualityCheck (OK image) ===");
console.log(await imageQualityCheck(ok));

console.log("\n=== E. autoDetectRoi (OK image) ===");
console.log(await autoDetectRoi(ok));

console.log("\n=== A. compareOkVsNg ===");
const cmp = await compareOkVsNg(ok, ng);
console.log({ verdict: cmp.verdict, diffRatio: cmp.diffRatio, summary: cmp.summary });

console.log("\n=== C. generateDefectHeatmap ===");
const heat = await generateDefectHeatmap(ok, ng);
const heatPath = path.join(outDir, "heatmap.png");
await fs.writeFile(heatPath, heat.heatmapPng);
console.log({ ...heat, heatmapPng: `<saved ${heatPath}>` });

console.log("\n=== F. augmentImage (rotate90, brightnessUp, noise) ===");
const aug = await augmentImage(ok, ["rotate90", "brightnessUp", "noise"]);
for (const a of aug) {
  const p = path.join(outDir, `aug-${a.transform}.png`);
  await fs.writeFile(p, a.imageBuffer);
  console.log(`  saved ${p} (${a.width}x${a.height})`);
}

console.log("\n=== D. extractText (LLaVA OCR) ===");
console.log(await extractText(ok, "auto"));

console.log("\n=== G. visualQA ===");
console.log(await visualQA(ng, "Mô tả ngắn gọn các khuyết tật bạn nhìn thấy."));

console.log("\n=== H. batchTriage (2 ảnh) ===");
console.log(await batchTriage([ok, ng]));

console.log("\nDone. Heatmap & augmented images saved to", outDir);
