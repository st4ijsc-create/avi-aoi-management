// doc69 G2-7 (Wave E4) — operational-card generator test.
//
// Runs the REAL build steps (build-operational-cards.mjs, then
// build-knowledge-chunks.mjs) exactly as `npm run kb:*` would, against the
// repo's actual catalogs, and asserts:
//   1. Well-formed cards: every knowledge/operational/*.md has parseable YAML
//      front matter with a valid `route` + a well-typed `permission`, and the
//      route/permission match knowledge/operational-cards.json (the runtime
//      index aiOperationalGrounding.ts reads).
//   2. RBAC accuracy: at least one card carries a non-null `permission` (proves
//      the requirePermission extraction fix actually reaches the generator —
//      before the fix, routes-catalog.json's requiredPermission was always
//      null, so every card's permission would have been null too).
//   3. Determinism: running the generator twice produces BYTE-IDENTICAL output
//      (no Date.now()/Math.random() — same input catalogs -> same cards).
//   4. Chunker ingestion: build-knowledge-chunks.mjs picks up the new
//      "operational" sourceType, one chunk per card (short cards, no
//      multi-part split), each chunk's sourcePath resolving to a real index
//      entry and its text carrying the "Route: ... | Permission: ..." meta
//      line this task added to the chunker.
//
// Run: node scripts/ai-kb/buildOperationalCards.test.mjs
// (Not part of the vitest suite — vitest.config.ts only globs *.test.ts, and
// this exercises real build SCRIPTS end-to-end via child_process, mirroring
// the existing scripts/ai-kb/*.mjs smoke-test convention.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const OPERATIONAL_DIR = path.join(ROOT, "knowledge", "operational");
const INDEX_FILE = path.join(ROOT, "knowledge", "operational-cards.json");
const CHUNKS_FILE = path.join(ROOT, "knowledge", "chunks.jsonl");
const GENERATOR = path.join(ROOT, "scripts", "ai-kb", "build-operational-cards.mjs");
const CHUNKER = path.join(ROOT, "scripts", "ai-kb", "build-knowledge-chunks.mjs");

function runGenerator() {
  return execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, encoding: "utf8" });
}
function runChunker() {
  return execFileSync(process.execPath, [CHUNKER], { cwd: ROOT, encoding: "utf8" });
}
function readIndex() {
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
}
function readChunksJsonl() {
  return fs
    .readFileSync(CHUNKS_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function snapshotDir(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    out[name] = fs.readFileSync(path.join(dir, name), "utf8");
  }
  return out;
}

// ── Prerequisite: routes-catalog.json / nav-catalog.json / etc. must already
// exist (produced by `npm run kb:extract`, which this test does NOT re-run —
// it exercises the operational-card generator against whatever catalogs are
// currently on disk, same precondition the real kb:* chain has).
test("prerequisite: route/nav catalogs exist (run `npm run kb:extract` first if this fails)", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "knowledge", "routes-catalog.json")), "knowledge/routes-catalog.json missing");
  assert.ok(fs.existsSync(path.join(ROOT, "knowledge", "nav-catalog.json")), "knowledge/nav-catalog.json missing");
});

test("generator produces the operational-cards.json index + matching .md cards", () => {
  runGenerator();
  assert.ok(fs.existsSync(INDEX_FILE), "operational-cards.json was not written");
  assert.ok(fs.existsSync(OPERATIONAL_DIR), "knowledge/operational/ was not created");

  const index = readIndex();
  assert.ok(Array.isArray(index) && index.length > 0, "index should be a non-empty array");

  const mdFiles = new Set(fs.readdirSync(OPERATIONAL_DIR).filter((f) => f.endsWith(".md")));
  assert.equal(mdFiles.size, index.length, "one .md file must exist per index entry (and vice versa)");

  for (const entry of index) {
    const base = path.basename(entry.sourcePath);
    assert.ok(mdFiles.has(base), `index entry ${entry.sourcePath} has no matching .md file`);
  }
});

test("every card is well-formed: parseable front matter, valid route, permission consistent with the index", () => {
  const index = readIndex();
  const bySourcePath = new Map(index.map((c) => [c.sourcePath, c]));
  assert.ok(bySourcePath.size > 0);

  const seenRoutes = new Set();
  for (const [sourcePath, entry] of bySourcePath) {
    const fileText = fs.readFileSync(path.join(ROOT, sourcePath), "utf8");
    const fm = fileText.match(/^---\n([\s\S]*?)\n---\n?/);
    assert.ok(fm, `${sourcePath} is missing a YAML front-matter block`);

    const meta = parseYaml(fm[1]);
    assert.ok(meta && typeof meta === "object", `${sourcePath} front matter did not parse to an object`);

    // route: required, must start with "/", must match the index entry exactly.
    assert.equal(typeof meta.route, "string", `${sourcePath}: route must be a string`);
    assert.ok(meta.route.startsWith("/"), `${sourcePath}: route "${meta.route}" must start with "/"`);
    assert.equal(meta.route, entry.route, `${sourcePath}: front-matter route must match the index entry`);

    // routes are the card's identity — no two cards may claim the same route.
    assert.ok(!seenRoutes.has(meta.route), `duplicate route across cards: ${meta.route}`);
    seenRoutes.add(meta.route);

    // permission: null or a non-empty string; must match the index entry.
    assert.ok(
      meta.permission === null || (typeof meta.permission === "string" && meta.permission.length > 0),
      `${sourcePath}: permission must be null or a non-empty string, got ${JSON.stringify(meta.permission)}`,
    );
    assert.equal(meta.permission ?? null, entry.permission ?? null, `${sourcePath}: front-matter permission must match the index entry`);

    // role: an array (possibly empty) of non-empty strings.
    assert.ok(Array.isArray(meta.role), `${sourcePath}: role must be an array`);
    for (const r of meta.role) assert.equal(typeof r, "string");

    // screen labels: required non-empty strings (used as the card title + FE button label).
    assert.ok(typeof meta.screenVi === "string" && meta.screenVi.length > 0, `${sourcePath}: screenVi must be a non-empty string`);
    assert.ok(typeof meta.screenEn === "string" && meta.screenEn.length > 0, `${sourcePath}: screenEn must be a non-empty string`);

    // The card body must reference the route/URL, so it's actually about THIS screen.
    const body = fileText.slice(fm[0].length);
    assert.ok(body.includes(meta.route), `${sourcePath}: card body should mention its own route`);
  }
});

test("RBAC accuracy: at least one card carries a real (non-null) permission, and at least one is role-gated", () => {
  // Regression guard for the requirePermission (not requiredPermission) extractor
  // bug this task fixed in extract-codebase-knowledge.mjs — before the fix EVERY
  // route's requiredPermission was null, so this would have failed.
  const index = readIndex();
  const withPermission = index.filter((c) => c.permission);
  const withRole = index.filter((c) => Array.isArray(c.role) && c.role.length > 0);
  assert.ok(withPermission.length > 0, "expected at least one operational card with a non-null permission");
  assert.ok(withRole.length > 0, "expected at least one operational card with a non-empty role[]");
});

test("determinism: running the generator twice produces byte-identical cards + index", () => {
  const indexBefore = fs.readFileSync(INDEX_FILE, "utf8");
  const dirBefore = snapshotDir(OPERATIONAL_DIR);

  runGenerator();

  const indexAfter = fs.readFileSync(INDEX_FILE, "utf8");
  const dirAfter = snapshotDir(OPERATIONAL_DIR);

  assert.equal(indexAfter, indexBefore, "operational-cards.json changed on a re-run with the same input catalogs");
  assert.deepEqual(dirAfter, dirBefore, "knowledge/operational/*.md changed on a re-run with the same input catalogs");
});

test("chunker ingests the new 'operational' sourceType: one chunk per card, route/permission meta line, sourcePath matches the index", () => {
  runChunker();
  const index = readIndex();
  const validSourcePaths = new Set(index.map((c) => c.sourcePath));

  const chunks = readChunksJsonl();
  const operationalChunks = chunks.filter((c) => c.sourceType === "operational");

  assert.ok(operationalChunks.length > 0, "no 'operational' sourceType chunks were produced");
  // Cards are short (well under KB_CHUNK_MAX_CHARS) -> exactly one chunk per card.
  assert.equal(operationalChunks.length, index.length, "expected exactly one operational chunk per card");

  const seenIds = new Set();
  for (const c of operationalChunks) {
    assert.ok(validSourcePaths.has(c.sourcePath), `chunk sourcePath ${c.sourcePath} is not in operational-cards.json`);
    assert.match(c.text, /^Route: \S+ \| Permission: \S+ \| Role: \S+/, `chunk ${c.id} is missing the Route/Permission/Role meta line`);
    assert.ok(!seenIds.has(c.id), `duplicate chunk id: ${c.id}`);
    seenIds.add(c.id);

    const entry = index.find((e) => e.sourcePath === c.sourcePath);
    assert.ok(c.text.includes(`Route: ${entry.route}`), `chunk meta line route mismatch for ${c.sourcePath}`);
  }
});
