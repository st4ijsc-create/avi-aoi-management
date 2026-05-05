import { spawn } from "node:child_process";

const steps = [
  { name: "extract", cmd: ["node", "scripts/ai-kb/extract-codebase-knowledge.mjs"] },
  { name: "chunk", cmd: ["node", "scripts/ai-kb/build-knowledge-chunks.mjs"] },
  { name: "embed", cmd: ["node", "scripts/ai-kb/generate-embeddings.mjs"] },
  { name: "graph", cmd: ["node", "scripts/ai-kb/build-semantic-graph.mjs"] },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`[kb] Step: ${step.name}`);

    const child = spawn(step.cmd[0], step.cmd.slice(1), {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step '${step.name}' failed with exit code ${code}`));
    });
  });
}

async function run() {
  for (const step of steps) {
    await runStep(step);
  }
  console.log("[kb] Phase 1 pipeline completed successfully");
}

run().catch((error) => {
  console.error("[kb] Pipeline failed:", error.message);
  process.exit(1);
});
