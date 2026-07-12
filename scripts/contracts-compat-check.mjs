#!/usr/bin/env node
/**
 * Contract-schema BACKWARD-compat gate — doc 44 Batch W0-E (gap G2.5).
 *
 * CI has no DB, but it HAS git — so instead of comparing against the persisted registry, each
 * contracts/canonical/*.json is compared against its previous Git version:
 *   1. working tree vs `git show HEAD:<file>`      (local run with uncommitted edits)
 *   2. if identical (typical CI: clean checkout), `git show HEAD~1:<file>` vs current
 *      (on a PR merge commit HEAD~1 is the base branch → catches what the PR changed)
 *   3. file absent in the older revision → NEW schema → pass.
 *
 * A BREAKING change (removed property / changed type / new required / shrunk enum) exits 1 —
 * the topic must bump to a new major subject (…/v2 file) instead of mutating in place.
 *
 * ⚠ KEEP IN SYNC: `checkBackwardCompat` below is a deliberate minimal re-implementation of
 * server/services/contracts/schemaRegistry.ts#checkBackwardCompat (this .mjs cannot import the
 * TS module without a build step). If you change the gate rules there, mirror them here.
 *
 * Usage: node scripts/contracts-compat-check.mjs   (run from repo root; exits 1 on breaking)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CANONICAL_DIR = "contracts/canonical"; // repo-relative, forward slashes (git paths)

// ── BACKWARD gate (mirror of schemaRegistry.ts#checkBackwardCompat — keep in sync) ──────────
function props(s) {
  return s && typeof s.properties === "object" && s.properties ? s.properties : {};
}
function requiredSet(s) {
  return new Set(Array.isArray(s?.required) ? s.required : []);
}
function checkBackwardCompat(prev, next) {
  const breaking = [];
  const warnings = [];
  if (prev.type && next.type && prev.type !== next.type) {
    breaking.push(`root type changed ${String(prev.type)} → ${String(next.type)}`);
  }
  const pProps = props(prev);
  const nProps = props(next);
  const pReq = requiredSet(prev);
  const nReq = requiredSet(next);
  for (const key of Object.keys(pProps)) {
    if (!(key in nProps)) {
      breaking.push(`property "${key}" removed`);
      continue;
    }
    const a = pProps[key];
    const b = nProps[key];
    if (a.type && b.type && a.type !== b.type) {
      breaking.push(`property "${key}" type changed ${String(a.type)} → ${String(b.type)}`);
    }
    if (Array.isArray(a.enum)) {
      const bEnum = Array.isArray(b.enum) ? b.enum : null;
      if (!bEnum) warnings.push(`property "${key}" dropped its enum constraint`);
      else {
        for (const v of a.enum) {
          if (!bEnum.includes(v)) breaking.push(`property "${key}" enum value ${JSON.stringify(v)} removed`);
        }
      }
    }
  }
  for (const key of nReq) {
    if (!pReq.has(key)) breaking.push(`property "${key}" became required`);
  }
  for (const key of Object.keys(nProps)) {
    if (!(key in pProps)) warnings.push(`property "${key}" added (optional — safe)`);
  }
  return { compatible: breaking.length === 0, breaking, warnings };
}

// ── git helpers ──────────────────────────────────────────────────────────────────────────────
/** File content at a revision, or null if it did not exist there (or the revision is absent). */
function gitShow(rev, repoRelPath) {
  try {
    return execFileSync("git", ["show", `${rev}:${repoRelPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // new file at this rev / shallow clone without the rev
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
function main() {
  const absDir = path.resolve(process.cwd(), CANONICAL_DIR);
  if (!fs.existsSync(absDir)) {
    console.log(`[contracts-compat] ${CANONICAL_DIR}/ not found — nothing to check.`);
    return 0;
  }
  const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.log(`[contracts-compat] no canonical schemas — nothing to check.`);
    return 0;
  }

  let failures = 0;
  for (const file of files) {
    const repoRel = `${CANONICAL_DIR}/${file}`; // git wants forward slashes on every OS
    const currentRaw = fs.readFileSync(path.join(absDir, file), "utf8");
    let current;
    try {
      current = JSON.parse(currentRaw);
    } catch (e) {
      console.error(`✗ ${repoRel}: invalid JSON — ${e.message}`);
      failures++;
      continue;
    }

    // Pick the comparison base: HEAD if the working tree differs from it (local uncommitted
    // edits); otherwise HEAD~1 (CI: the commit under test vs its parent/base).
    let baseRev = "HEAD";
    let prevRaw = gitShow("HEAD", repoRel);
    if (prevRaw !== null && prevRaw.trim() === currentRaw.trim()) {
      baseRev = "HEAD~1";
      prevRaw = gitShow("HEAD~1", repoRel);
    }
    if (prevRaw === null) {
      console.log(`✓ ${repoRel}: new schema (no ${baseRev} version) — pass`);
      continue;
    }
    let prev;
    try {
      prev = JSON.parse(prevRaw);
    } catch {
      console.log(`✓ ${repoRel}: previous version at ${baseRev} was invalid JSON — skipping compare`);
      continue;
    }

    const res = checkBackwardCompat(prev, current);
    if (res.compatible) {
      const note = res.warnings.length > 0 ? ` (${res.warnings.length} additive change(s))` : " (unchanged)";
      console.log(`✓ ${repoRel}: BACKWARD-compatible vs ${baseRev}${note}`);
    } else {
      failures++;
      console.error(`✗ ${repoRel}: BREAKING vs ${baseRev}:`);
      for (const b of res.breaking) console.error(`    - ${b}`);
      console.error(`    → bump to a new major subject (new …_v2 canonical file) instead of mutating in place.`);
    }
  }

  if (failures > 0) {
    console.error(`\n[contracts-compat] FAILED — ${failures} breaking schema change(s).`);
    return 1;
  }
  console.log(`\n[contracts-compat] OK — ${files.length} schema(s) BACKWARD-compatible.`);
  return 0;
}

process.exit(main());
