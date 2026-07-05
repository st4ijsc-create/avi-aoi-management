#!/usr/bin/env node
/**
 * fetch-models.mjs — doc 27 Đợt 7 W7-D (gap V4): download + verify the AI model
 * set declared in models/manifest.json. Model binaries are gitignored; this
 * script is the ONLY sanctioned way to provision them (no weights in git).
 *
 * Usage:
 *   node scripts/fetch-models.mjs                 # fetch all missing fetchable models
 *   node scripts/fetch-models.mjs --dry-run       # print plan/status, NO network
 *   node scripts/fetch-models.mjs --only dinov2-small
 *   node scripts/fetch-models.mjs --verify        # only verify existing files (checksums)
 *   node scripts/fetch-models.mjs --force         # re-download even if present
 *
 * Behaviour:
 *   • Manifest-driven (models/manifest.json): name, file, url (+ urlEnv env
 *     override), sha256 (+ sha256Env override), maxBytes size guard, requiredBy.
 *   • RESUME: partial downloads land in <file>.part; a re-run continues with an
 *     HTTP Range request when the server supports it (206), else restarts.
 *   • SIZE GUARD: aborts if Content-Length or streamed bytes exceed maxBytes.
 *   • SHA-256: if a hash is pinned (manifest sha256 / sha256Env / lock file) the
 *     download is REJECTED on mismatch (the bad file is kept as <file>.rejected
 *     for forensics, never installed). If NO hash is pinned, the computed hash
 *     is printed and pinned into models/manifest.lock.json so every later run
 *     verifies against it (trust-on-first-use, honest and explicit).
 *   • kind:"external-gguf" entries are NOT downloaded — they are presence-checked
 *     at the env-configured path and reported as "external, already configured"
 *     or "external, MISSING".
 *
 * Exit code: 0 = all required models present+verified, 1 = something missing/failed.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, "models", "manifest.json");

// ─── Manifest / lock ─────────────────────────────────────────────────────────

export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.models)) {
    throw new Error(`Manifest ${manifestPath} has no "models" array`);
  }
  return manifest;
}

export function lockPathFor(manifestPath = DEFAULT_MANIFEST_PATH) {
  return path.join(path.dirname(manifestPath), "manifest.lock.json");
}

export function loadLock(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    return JSON.parse(fs.readFileSync(lockPathFor(manifestPath), "utf8"));
  } catch {
    return {};
  }
}

export function saveLock(lock, manifestPath = DEFAULT_MANIFEST_PATH) {
  fs.writeFileSync(lockPathFor(manifestPath), JSON.stringify(lock, null, 2) + "\n");
}

// ─── Path / hash helpers ─────────────────────────────────────────────────────

/** Absolute install path of a fetchable (onnx) entry. */
export function resolveModelFilePath(entry, manifestPath = DEFAULT_MANIFEST_PATH) {
  return path.join(path.dirname(manifestPath), entry.file);
}

/** Absolute path of an external (GGUF) entry from env, or null if unconfigured. */
export function resolveExternalPath(entry, env = process.env) {
  const raw = entry.pathEnv ? env[entry.pathEnv] : undefined;
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  const dir = entry.dirEnv ? env[entry.dirEnv] : undefined;
  return dir ? path.join(dir, raw) : path.resolve(REPO_ROOT, raw);
}

export async function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

/** Pinned hash for an entry: env override → manifest → lock file. null = unpinned. */
export function expectedSha256(entry, { env = process.env, lock = {} } = {}) {
  const fromEnv = entry.sha256Env ? env[entry.sha256Env] : undefined;
  if (fromEnv) return { sha256: fromEnv.toLowerCase(), source: `env ${entry.sha256Env}` };
  if (entry.sha256) return { sha256: String(entry.sha256).toLowerCase(), source: "manifest" };
  const fromLock = lock[entry.name]?.sha256;
  if (fromLock) return { sha256: String(fromLock).toLowerCase(), source: "lock" };
  return { sha256: null, source: "unpinned" };
}

export function resolveUrl(entry, env = process.env) {
  const fromEnv = entry.urlEnv ? env[entry.urlEnv] : undefined;
  return fromEnv || entry.url || null;
}

// ─── Status (pure, no network) ───────────────────────────────────────────────

/**
 * Compute the current status of every manifest entry. NO network.
 * Returns [{ name, kind, required, path, present, sizeBytes, note }].
 */
export function planEntries(manifest, { manifestPath = DEFAULT_MANIFEST_PATH, env = process.env } = {}) {
  const out = [];
  for (const entry of manifest.models) {
    if (entry.kind === "external-gguf") {
      const p = resolveExternalPath(entry, env);
      const extras = (entry.extraPathEnvs ?? [])
        .map((e) => ({ env: e, path: env[e] ?? null }))
        .map((x) => ({ ...x, present: x.path ? fs.existsSync(x.path) : false }));
      const present = !!p && fs.existsSync(p) && extras.every((x) => x.present || !x.path);
      out.push({
        name: entry.name,
        kind: entry.kind,
        required: !!entry.required,
        path: p,
        present,
        sizeBytes: present && p ? safeSize(p) : 0,
        note: !p
          ? `external, NOT configured (set ${entry.pathEnv})`
          : present
            ? "external, already configured"
            : `external, MISSING at ${p}`,
      });
      continue;
    }
    const p = resolveModelFilePath(entry, manifestPath);
    const present = fs.existsSync(p);
    out.push({
      name: entry.name,
      kind: entry.kind ?? "onnx",
      required: !!entry.required,
      path: p,
      present,
      sizeBytes: present ? safeSize(p) : 0,
      note: present ? "present" : `missing — fetch with: node scripts/fetch-models.mjs --only ${JSON.stringify(entry.name)}`,
    });
  }
  return out;
}

function safeSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// ─── Verify an existing file against the pinned hash ────────────────────────

/**
 * Verify one fetchable entry's installed file.
 * Returns { ok, present, sha256, expected, source, reason? }.
 */
export async function verifyEntry(entry, { manifestPath = DEFAULT_MANIFEST_PATH, env = process.env, lock } = {}) {
  const filePath = resolveModelFilePath(entry, manifestPath);
  if (!fs.existsSync(filePath)) return { ok: false, present: false, sha256: null, expected: null, source: null, reason: "file missing" };
  const effLock = lock ?? loadLock(manifestPath);
  const { sha256: expected, source } = expectedSha256(entry, { env, lock: effLock });
  const actual = await sha256OfFile(filePath);
  if (!expected) {
    return { ok: true, present: true, sha256: actual, expected: null, source: "unpinned", reason: "no pinned hash — computed hash reported (pin it via manifest/lock/env to enforce)" };
  }
  if (actual !== expected) {
    return { ok: false, present: true, sha256: actual, expected, source, reason: `sha256 mismatch (expected ${expected} from ${source}, got ${actual})` };
  }
  return { ok: true, present: true, sha256: actual, expected, source };
}

// ─── Download with resume + size guard + checksum ────────────────────────────

/**
 * Fetch one entry. Options:
 *   fetchImpl — injectable fetch (tests); defaults to global fetch.
 *   force     — re-download even if the target exists.
 *   log       — logger fn.
 * Throws on failure (size guard, HTTP error, checksum mismatch).
 * Returns { path, sha256, sizeBytes, resumedFrom }.
 */
export async function fetchEntry(entry, {
  manifestPath = DEFAULT_MANIFEST_PATH,
  env = process.env,
  fetchImpl = globalThis.fetch,
  force = false,
  log = console.log,
} = {}) {
  if (entry.kind === "external-gguf") {
    throw new Error(`${entry.name}: kind external-gguf is presence-checked only — provision it manually under ${entry.dirEnv ?? "its configured dir"}`);
  }
  const filePath = resolveModelFilePath(entry, manifestPath);
  const partPath = `${filePath}.part`;
  const url = resolveUrl(entry, env);
  if (!url) throw new Error(`${entry.name}: no URL (set ${entry.urlEnv ?? "url in manifest"})`);
  const maxBytes = Number(entry.maxBytes ?? 0) || Infinity;
  const lock = loadLock(manifestPath);
  const { sha256: expected, source: shaSource } = expectedSha256(entry, { env, lock });

  if (!force && fs.existsSync(filePath)) {
    const v = await verifyEntry(entry, { manifestPath, env, lock });
    if (v.ok) {
      log(`  ✓ ${entry.name}: already present${v.expected ? " (sha256 verified)" : ` (sha256 ${v.sha256} — unpinned)`}`);
      return { path: filePath, sha256: v.sha256, sizeBytes: safeSize(filePath), resumedFrom: 0 };
    }
    log(`  ! ${entry.name}: present but ${v.reason} — re-downloading`);
    await fsp.rm(filePath, { force: true });
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  // Resume support: continue an interrupted .part with a Range request.
  let resumedFrom = 0;
  const headers = {};
  if (!force && fs.existsSync(partPath)) {
    resumedFrom = safeSize(partPath);
    if (resumedFrom > 0) headers.Range = `bytes=${resumedFrom}-`;
  } else if (force) {
    await fsp.rm(partPath, { force: true });
  }

  log(`  ↓ ${entry.name}: ${url}${resumedFrom > 0 ? ` (resuming at byte ${resumedFrom})` : ""}`);
  const resp = await fetchImpl(url, { headers, redirect: "follow" });

  let append = false;
  if (resp.status === 206 && resumedFrom > 0) {
    append = true; // server honoured the Range — append to .part
  } else if (resp.status === 200) {
    if (resumedFrom > 0) log(`  ! ${entry.name}: server ignored Range — restarting from 0`);
    resumedFrom = 0;
  } else {
    throw new Error(`${entry.name}: HTTP ${resp.status} ${resp.statusText} from ${url}`);
  }
  if (!resp.body) throw new Error(`${entry.name}: empty response body from ${url}`);

  // Size guard (pre-flight via Content-Length, then enforced while streaming).
  const contentLen = Number(resp.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(maxBytes) && contentLen > 0 && resumedFrom + contentLen > maxBytes) {
    throw new Error(`${entry.name}: size guard tripped — Content-Length ${contentLen} + resumed ${resumedFrom} exceeds maxBytes ${maxBytes}`);
  }

  let streamed = resumedFrom;
  const guard = async function* (source) {
    for await (const chunk of source) {
      streamed += chunk.length;
      if (streamed > maxBytes) {
        throw new Error(`${entry.name}: size guard tripped while streaming (${streamed} > maxBytes ${maxBytes})`);
      }
      yield chunk;
    }
  };

  const body = typeof resp.body.getReader === "function" ? Readable.fromWeb(resp.body) : resp.body;
  const sink = fs.createWriteStream(partPath, { flags: append ? "a" : "w" });
  try {
    await pipeline(body, guard, sink);
  } catch (err) {
    // keep .part for resume unless the size guard rejected it
    if (String(err?.message ?? err).includes("size guard")) await fsp.rm(partPath, { force: true });
    throw err;
  }

  // Full-file hash (covers resumed prefix too — hash the finished file, not just the stream).
  const actual = await sha256OfFile(partPath);

  if (expected && actual !== expected) {
    const rejectedPath = `${filePath}.rejected`;
    await fsp.rm(rejectedPath, { force: true });
    await fsp.rename(partPath, rejectedPath);
    throw new Error(
      `${entry.name}: SHA-256 MISMATCH — expected ${expected} (${shaSource}), got ${actual}. ` +
      `File NOT installed (kept at ${rejectedPath} for inspection). ` +
      `If the upstream file legitimately changed, update the pinned hash explicitly.`,
    );
  }

  await fsp.rm(filePath, { force: true });
  await fsp.rename(partPath, filePath);

  // Trust-on-first-use: pin the computed hash in the lock file when unpinned.
  if (!expected) {
    lock[entry.name] = { sha256: actual, sizeBytes: safeSize(filePath), url, fetchedAt: new Date().toISOString() };
    saveLock(lock, manifestPath);
    log(`  ✓ ${entry.name}: downloaded (sha256 ${actual} — pinned into models/manifest.lock.json)`);
  } else {
    log(`  ✓ ${entry.name}: downloaded + sha256 verified (${shaSource})`);
  }
  return { path: filePath, sha256: actual, sizeBytes: safeSize(filePath), resumedFrom };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { dryRun: false, verify: false, force: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verify") args.verify = true;
    else if (a === "--force") args.force = true;
    else if (a === "--only") args.only = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

async function main() {
  // .env is loaded ONLY in CLI mode (never on import — keeps tests hermetic).
  try { (await import("dotenv")).config({ path: path.join(REPO_ROOT, ".env"), quiet: true }); } catch { /* dotenv optional */ }

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/fetch-models.mjs [--dry-run] [--verify] [--force] [--only <name>]");
    process.exit(0);
  }

  const manifest = loadManifest();
  let entries = manifest.models;
  if (args.only) {
    entries = entries.filter((e) => e.name === args.only || e.name.startsWith(args.only));
    if (entries.length === 0) {
      console.error(`No manifest entry matches --only ${args.only}`);
      process.exit(1);
    }
  }

  console.log(`fetch-models — ${entries.length} entr${entries.length === 1 ? "y" : "ies"} (manifest models/manifest.json)`);
  const statuses = planEntries({ models: entries });
  let failures = 0;

  for (const entry of entries) {
    const st = statuses.find((s) => s.name === entry.name);
    if (entry.kind === "external-gguf") {
      console.log(`  ${st.present ? "✓" : entry.required ? "✗" : "!"} ${entry.name}: ${st.note}`);
      if (!st.present && entry.required) failures++;
      continue;
    }
    if (args.dryRun) {
      const mb = st.sizeBytes ? ` (${(st.sizeBytes / 1e6).toFixed(1)} MB)` : "";
      console.log(`  ${st.present ? "✓" : "•"} ${entry.name}: ${st.note}${mb} → ${st.path}`);
      if (!st.present && entry.required) failures++;
      continue;
    }
    if (args.verify) {
      const v = await verifyEntry(entry);
      if (v.ok) console.log(`  ✓ ${entry.name}: ${v.expected ? "sha256 verified" : `present, sha256 ${v.sha256} (unpinned)`}`);
      else { console.error(`  ✗ ${entry.name}: ${v.reason}`); if (entry.required) failures++; }
      continue;
    }
    try {
      await fetchEntry(entry, { force: args.force });
    } catch (err) {
      console.error(`  ✗ ${entry.name}: ${err?.message ?? err}`);
      if (entry.required) failures++;
    }
  }

  if (args.dryRun) {
    console.log("\n(dry-run — nothing downloaded)");
  }
  if (failures > 0) {
    console.error(`\n${failures} required model(s) missing/failed. Runtime will DEGRADE honestly (text-of-image/heuristic tier) until fixed — see models/README.md.`);
    process.exit(1);
  }
  console.log("\nAll required models present.");
}

// Run only when invoked directly (importable for tests).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
