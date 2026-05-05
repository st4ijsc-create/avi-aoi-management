// Script to download and build latest llama.cpp, bypassing the broken yargs CLI
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";

const base = path.resolve("node_modules/.pnpm/node-llama-cpp@3.18.1_typescript@5.9.3/node_modules/node-llama-cpp/dist/cli/commands/source/commands/DownloadCommand.js");
const { DownloadLlamaCppCommand } = await import(pathToFileURL(base).href);

console.log("=== Downloading and building latest llama.cpp ===\n");

try {
  await DownloadLlamaCppCommand({
    release: "latest",
    repo: "ggml-org/llama.cpp",
    gpu: "auto",
    skipBuild: false,
    noBundle: false,
    noUsageExample: true,
    updateBinariesReleaseMetadataAndSaveGitBundle: false,
  });
  console.log("\n=== Successfully updated llama.cpp! ===");
} catch (err) {
  console.error("Failed to update llama.cpp:", err);
  process.exit(1);
}
