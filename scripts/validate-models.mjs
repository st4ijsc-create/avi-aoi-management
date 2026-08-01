#!/usr/bin/env node
/**
 * validate-models.mjs — doc 27 Đợt 7 W7-D (gap V4): load each PRESENT onnx model
 * from models/manifest.json into an onnxruntime-node session (CPU EP — this is a
 * LOAD/SHAPE validation, not a GPU benchmark) and run one dummy tensor, checking
 * the output shape against manifest.expectedOutput.
 *
 *   node scripts/validate-models.mjs [--only <name>]
 *
 * Exit code 0 = every present onnx model loaded + produced the expected shape.
 * Missing models are reported but only fail the run when required:true.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, resolveModelFilePath, parseArgs } from "./fetch-models.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ort = await import("onnxruntime-node");
  const manifest = loadManifest();
  let entries = manifest.models.filter((e) => (e.kind ?? "onnx") === "onnx");
  if (args.only) entries = entries.filter((e) => e.name === args.only || e.name.startsWith(args.only));

  let failures = 0;
  for (const entry of entries) {
    const filePath = resolveModelFilePath(entry);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${entry.required ? "✗" : "!"} ${entry.name}: not present (${path.relative(REPO_ROOT, filePath)}) — skip`);
      if (entry.required) failures++;
      continue;
    }
    const t0 = Date.now();
    try {
      const session = await ort.InferenceSession.create(filePath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
      const dims = entry.input?.dims ?? [1, 3, 224, 224];
      const size = dims.reduce((a, b) => a * b, 1);
      const inputName = session.inputNames[0];
      const feeds = { [inputName]: new ort.Tensor("float32", new Float32Array(size), dims) };
      const results = await session.run(feeds);
      const outName =
        (entry.expectedOutput?.name && session.outputNames.includes(entry.expectedOutput.name))
          ? entry.expectedOutput.name
          : session.outputNames[session.outputNames.length - 1];
      const out = results[outName];
      const got = out?.dims ? Array.from(out.dims) : [];
      const want = entry.expectedOutput?.dims ?? null;
      const shapeOk = !want || (got.length === want.length && got.every((d, i) => d === want[i]));
      const ms = Date.now() - t0;
      if (shapeOk) {
        console.log(`  ✓ ${entry.name}: session OK (CPU EP), input ${inputName}${JSON.stringify(dims)} → ${outName}${JSON.stringify(got)} in ${ms}ms`);
      } else {
        failures++;
        console.error(`  ✗ ${entry.name}: output shape ${JSON.stringify(got)} ≠ expected ${JSON.stringify(want)} (output ${outName})`);
      }
    } catch (err) {
      failures++;
      console.error(`  ✗ ${entry.name}: failed to load/run — ${err?.message ?? err}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} model(s) failed validation.`);
    process.exit(1);
  }
  console.log("\nAll present onnx models validated (CPU EP — GPU EP is a runtime concern, see models/README.md).");
}

main().catch((err) => { console.error(err); process.exit(1); });
