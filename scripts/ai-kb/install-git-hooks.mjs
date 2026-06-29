#!/usr/bin/env node
/**
 * install-git-hooks.mjs (doc 11 · W1.2 companion) — dependency-free git hook setup.
 *
 * Installs a pre-push hook that runs the WARN-ONLY KB staleness check
 * (scripts/ai-kb/check-kb-stale.mjs). We avoid husky here because it pulled an
 * ERESOLVE peer conflict in this repo; writing .git/hooks/pre-push directly needs
 * no dependency and no lockfile change. Idempotent + non-destructive:
 *   - If no pre-push hook exists → create it.
 *   - If one exists but is OURS (contains the marker) → overwrite (update).
 *   - If one exists and is NOT ours → leave it, print how to add the line manually.
 *
 *   node scripts/ai-kb/install-git-hooks.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const MARKER = "# doc11-kb-stale-check";
const HOOK_BODY = `#!/bin/sh
${MARKER}
# Warn (never block) if the AI knowledge base is older than its source material.
node scripts/ai-kb/check-kb-stale.mjs || true
`;

function gitHooksDir() {
  try {
    // Respect core.hooksPath if set; else <gitdir>/hooks.
    const custom = execSync("git config --get core.hooksPath", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (custom) return path.resolve(process.cwd(), custom);
  } catch {
    /* not set */
  }
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.resolve(process.cwd(), gitDir, "hooks");
  } catch {
    return null;
  }
}

function main() {
  const dir = gitHooksDir();
  if (!dir) {
    console.error("[hooks] not a git repo — skipping");
    return 0;
  }
  fs.mkdirSync(dir, { recursive: true });
  const hookPath = path.join(dir, "pre-push");

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf8");
    if (!existing.includes(MARKER)) {
      console.error(
        `[hooks] a custom pre-push hook already exists at ${hookPath} — not overwriting.\n` +
          `        Add this line to it manually:  node scripts/ai-kb/check-kb-stale.mjs || true`,
      );
      return 0;
    }
  }

  fs.writeFileSync(hookPath, HOOK_BODY, { mode: 0o755 });
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    /* chmod may no-op on Windows; git for-windows still runs it via sh */
  }
  console.error(`[hooks] installed pre-push KB-stale check → ${hookPath}`);
  return 0;
}

process.exit(main());
