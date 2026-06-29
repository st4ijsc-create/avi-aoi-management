#!/usr/bin/env node
/**
 * check-kb-stale.mjs (doc 11 · W1.2 companion) — warn when the AI knowledge base
 * is older than the latest change to its source material.
 *
 * The RAG corpus (knowledge/embeddings.jsonl, via knowledge/embeddings-meta.json
 * `generatedAt`) is built from routers/services/schema/docs/feature-guides. If any
 * of those changed AFTER the last KB build, the assistant may not know about the
 * change until `npm run kb:sync` runs. This is a WARN-ONLY check (always exits 0)
 * intended for a git pre-push hook — it never blocks a push.
 *
 *   node scripts/ai-kb/check-kb-stale.mjs
 *
 * Exit code is always 0 (advisory). Set KB_STALE_STRICT=1 to exit 1 instead
 * (e.g. for a CI job that should fail on a stale KB).
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const META = path.join(process.cwd(), "knowledge", "embeddings-meta.json");

// Source paths whose changes should be reflected in the KB.
const SOURCE_PATHS = [
  "server/routers",
  "server/services",
  "drizzle/schema",
  "docs",
  "apidocs",
  "knowledge/domain",
  "knowledge/features",
  "shared/module-registry.ts",
  "client/src/App.tsx",
  "client/src/lib/navigation.tsx",
];

const C = { y: "\x1b[33m", g: "\x1b[32m", dim: "\x1b[2m", b: "\x1b[1m", r: "\x1b[0m" };

function gitLatestSourceCommitISO() {
  try {
    const out = execSync(
      `git log -1 --format=%cI -- ${SOURCE_PATHS.join(" ")}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null; // not a git repo / git unavailable → skip
  }
}

function main() {
  if (!fs.existsSync(META)) {
    // No KB yet — nothing to warn about (a fresh checkout). Stay silent.
    return 0;
  }

  let builtAtISO = null;
  try {
    const meta = JSON.parse(fs.readFileSync(META, "utf8"));
    builtAtISO = meta.generatedAt ?? null;
  } catch {
    return 0;
  }
  if (!builtAtISO) return 0;

  const srcISO = gitLatestSourceCommitISO();
  if (!srcISO) return 0;

  const builtAt = new Date(builtAtISO).getTime();
  const srcAt = new Date(srcISO).getTime();
  if (!Number.isFinite(builtAt) || !Number.isFinite(srcAt)) return 0;

  if (srcAt > builtAt) {
    const days = Math.max(0, Math.round((srcAt - builtAt) / 86_400_000));
    process.stderr.write(
      `\n${C.y}${C.b}⚠ KB có thể đã cũ / KB may be stale${C.r}\n` +
        `${C.dim}  KB built:   ${builtAtISO}\n` +
        `  Source last changed: ${srcISO}${days ? ` (~${days}d newer)` : ""}${C.r}\n` +
        `${C.y}  → Chạy ${C.b}npm run kb:sync${C.r}${C.y} để cập nhật tri thức AI trước khi tin tưởng câu trả lời.${C.r}\n\n`,
    );
    if (process.env.KB_STALE_STRICT === "1") return 1;
    return 0;
  }

  // Fresh — quiet success (a single dim line so the hook shows it ran).
  process.stderr.write(`${C.dim}[kb] knowledge base is up to date (built ${builtAtISO}).${C.r}\n`);
  return 0;
}

process.exit(main());
