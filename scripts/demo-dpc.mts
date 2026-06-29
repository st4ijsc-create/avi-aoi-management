/**
 * Doc 09 — DPC end-to-end DEMO (emulator / no hardware).
 * Exercises: project → artifact → validate → build → simulate → deploy(gate) for the
 * stub + Zmotion + Ladder kinds, plus the AI copilot. Run: npx tsx scripts/demo-dpc.mts
 * SAFE: no hardware is present, so real adapters honestly report 'failed' on deploy and
 * the stub reports 'simulated' — nothing is ever written to a device.
 */
import "dotenv/config";
import { getDb } from "../server/db/connection";
import { programProjects, programArtifacts } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  validateArtifact, buildArtifact, simulateBuild, deployBuild, hashContent,
  dpcDeployEnabled,
} from "../server/services/programming/programmingService";
import { suggestProgram } from "../server/services/programming/aiProgrammingCopilot";
import { programmingRegistry } from "../server/services/programming/programmingAdapter";

const USER = { id: 1, role: "admin", name: "Demo" };
const log = (...a: unknown[]) => console.log(...a);

async function seedProject(code: string, kind: any, language: string, content: string) {
  const d = (await getDb())!;
  await d.delete(programProjects).where(eq(programProjects.code, code)).catch(() => {});
  const [p] = await d.insert(programProjects).values({ code, name: code, kind, createdBy: USER.id }).returning();
  const [a] = await d.insert(programArtifacts).values({
    projectId: p.id, branch: "main", version: 1, kind, language, content, contentHash: hashContent(content), createdBy: USER.id,
  }).returning();
  return { project: p, artifact: a };
}

async function main() {
  log("=== DPC end-to-end demo ===");
  log("DPC_DEPLOY_ENABLED:", dpcDeployEnabled());
  log("Implemented adapters:", programmingRegistry.listAdapters().filter((x) => x.implemented).map((x) => x.kind).join(", "));

  // 1) Zmotion BASIC — real validate/build/simulate; deploy honestly fails (no ZMC HW).
  log("\n--- [1] Zmotion BASIC ---");
  const zmo = await seedProject("DEMO-ZMC", "zmotion-basic", "basic",
    "BASE(0,1)\nATYPE=1,1\nUNITS=100,100\nSPEED=200,200\nMOVEABS(100,50)\nMOVE(20,0)\nWAIT IDLE");
  log("validate:", JSON.stringify(await validateArtifact(zmo.artifact.id)));
  const zb = await buildArtifact(zmo.artifact.id, USER);
  log("build:", { ok: zb.ok, status: zb.status, outputRef: zb.outputRef });
  const zsim = await simulateBuild(zb.id, {}, USER);
  log("simulate:", { ok: zsim.ok, steps: (zsim.timeline as any[]).length });
  const zdep = await deployBuild({ buildId: zb.id, stage: "staging", idempotencyKey: "demo-zmc-1", hitl: { actionId: "a1", requestedBy: 1, confirmedBy: 1 } }, USER);
  log("deploy (flag ON + sign-off, NO HW):", { status: zdep.status, simulated: zdep.simulated, error: (zdep as any).error?.slice(0, 70) });

  // 2) Ladder — REAL one-scan evaluation.
  log("\n--- [2] IEC 61131-3 Ladder (real one-scan) ---");
  const ld = await seedProject("DEMO-LD", "iec61131-ld", "ld", "Y0 := X0 AND NOT X1\nY1 := Y0 OR X2");
  const lb = await buildArtifact(ld.artifact.id, USER);
  const lsimA = await simulateBuild(lb.id, { assumedInputs: { X0: true, X1: false, X2: false } }, USER);
  log("scan X0=1,X1=0,X2=0 →", (lsimA.timeline as any[]).map((s) => s.label).join(" | "));
  const lsimB = await simulateBuild(lb.id, { assumedInputs: { X0: true, X1: true, X2: false } }, USER);
  log("scan X0=1,X1=1,X2=0 →", (lsimB.timeline as any[]).map((s) => s.label).join(" | "));

  // 3) Stub — deploy is 'simulated' (no device path at all).
  log("\n--- [3] Stub (deploy → simulated) ---");
  const st = await seedProject("DEMO-STUB", "stub", "text", "line 1\nline 2\nline 3");
  const sb = await buildArtifact(st.artifact.id, USER);
  const sdep = await deployBuild({ buildId: sb.id, stage: "staging", idempotencyKey: "demo-stub-1", hitl: { actionId: "a2", requestedBy: 1, confirmedBy: 1 } }, USER);
  log("deploy:", { status: sdep.status, simulated: sdep.simulated });

  // 4) AI copilot — advisory, validated, refuses safety.
  log("\n--- [4] AI Copilot ---");
  const sug = await suggestProgram({ kind: "zmotion-basic", intent: "move axis 0 home then dwell" });
  log("suggest zmotion:", { valid: sug.valid, refused: sug.refused, firstLine: sug.source?.split("\n")[1] });
  const refused = await suggestProgram({ kind: "iec61131-ld", intent: "add an emergency e-stop interlock" });
  log("suggest safety intent:", { refused: refused.refused, reason: refused.reason?.slice(0, 60) });

  log("\n=== demo done — no device was written (honest gate proven) ===");
  process.exit(0);
}

main().catch((e) => { console.error("DEMO ERROR:", e); process.exit(1); });
