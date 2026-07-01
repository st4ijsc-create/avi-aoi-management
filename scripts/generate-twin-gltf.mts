/**
 * Doc 22 P5 (Khối 7) — generate REAL glTF 2.0 twin assets from the sample URDFs.
 *
 * Runs the existing, tested `urdfToGltf` emitter (server/services/twin/pipeline) on the
 * parametric AOI-machine + robot-arm URDFs and writes SELF-CONTAINED .gltf files (binary
 * buffer embedded as a base64 data-URI) into client/public/models/. Vite serves client/public
 * at the web root and copies it into dist/public at build, so the assets are reachable at
 *   /models/aoi-machine.gltf   and   /models/robot-arm.gltf
 * with NO server change and NO flag. Idempotent — safe to re-run. Pure Node, no DB.
 *
 * Usage:  npx tsx scripts/generate-twin-gltf.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUrdf } from "../server/services/twin/pipeline/urdfParser";
import { urdfToGltf } from "../server/services/twin/pipeline/urdfToGltf";
import {
  SAMPLE_URDF_AOI_MACHINE,
  SAMPLE_URDF_3DOF_ARM,
} from "../server/services/twin/pipeline/sampleUrdfs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "client", "public", "models");

const ASSETS: Array<{ file: string; urdf: string }> = [
  { file: "aoi-machine.gltf", urdf: SAMPLE_URDF_AOI_MACHINE },
  { file: "robot-arm.gltf", urdf: SAMPLE_URDF_3DOF_ARM },
];

fs.mkdirSync(outDir, { recursive: true });

for (const { file, urdf } of ASSETS) {
  const robot = parseUrdf(urdf);
  const out = urdfToGltf(robot);
  const dest = path.join(outDir, file);
  fs.writeFileSync(dest, out.json, "utf8");
  const bytes = Buffer.byteLength(out.json, "utf8");
  console.log(
    `[twin-gltf] ${file}  robot="${robot.name}"  meshes=${out.meshCount} nodes=${out.nodeCount} ` +
      `bounds=[${out.bounds.min.map((n) => n.toFixed(2)).join(",")}]..[${out.bounds.max.map((n) => n.toFixed(2)).join(",")}] ` +
      `${(bytes / 1024).toFixed(1)}KB`,
  );
}

console.log(`[twin-gltf] wrote ${ASSETS.length} asset(s) to ${path.relative(repoRoot, outDir)}`);
