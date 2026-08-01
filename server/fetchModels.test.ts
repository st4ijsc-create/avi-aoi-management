/**
 * W7-D (doc 27 gap V4) — scripts/fetch-models.mjs unit tests.
 * NO network: fetchImpl is injected; dry-run planning is pure fs.
 * Covers: manifest planning, checksum verification + REJECTION, size guard,
 * trust-on-first-use lock pinning, external-gguf presence semantics.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
// @ts-expect-error — plain .mjs module (script), no type declarations
import * as fm from "../scripts/fetch-models.mjs";

let dir: string;
let manifestPath: string;

const GOOD = Buffer.from("tiny-model-payload-0123456789");
const GOOD_SHA = crypto.createHash("sha256").update(GOOD).digest("hex");

function writeManifest(models: unknown[]) {
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, models }, null, 2));
}

function respOk(bytes: Buffer, status = 200, contentLength?: number) {
  return {
    status,
    statusText: "OK",
    headers: { get: (k: string) => (k === "content-length" ? String(contentLength ?? bytes.length) : null) },
    body: Readable.from([bytes]),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-models-test-"));
  manifestPath = path.join(dir, "manifest.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("manifest planning (dry-run — no network by construction)", () => {
  it("reports missing/present honestly and never touches the network", () => {
    writeManifest([
      { name: "tiny", kind: "onnx", file: "tiny.bin", required: true, url: "https://example.invalid/x" },
    ]);
    const manifest = fm.loadManifest(manifestPath);

    let plan = fm.planEntries(manifest, { manifestPath });
    expect(plan[0].present).toBe(false);
    expect(plan[0].required).toBe(true);

    fs.writeFileSync(path.join(dir, "tiny.bin"), GOOD);
    plan = fm.planEntries(manifest, { manifestPath });
    expect(plan[0].present).toBe(true);
    expect(plan[0].sizeBytes).toBe(GOOD.length);
  });

  it("external-gguf entries are presence-checked from env, not downloaded", () => {
    const extPath = path.join(dir, "ext.gguf");
    writeManifest([
      { name: "ext", kind: "external-gguf", pathEnv: "TEST_GGUF_PATH", required: false },
    ]);
    const manifest = fm.loadManifest(manifestPath);

    let plan = fm.planEntries(manifest, { manifestPath, env: { TEST_GGUF_PATH: extPath } });
    expect(plan[0].present).toBe(false);
    expect(plan[0].note).toContain("MISSING");

    fs.writeFileSync(extPath, "x");
    plan = fm.planEntries(manifest, { manifestPath, env: { TEST_GGUF_PATH: extPath } });
    expect(plan[0].present).toBe(true);
    expect(plan[0].note).toContain("already configured");

    plan = fm.planEntries(manifest, { manifestPath, env: {} });
    expect(plan[0].note).toContain("NOT configured");
  });

  it("fetchEntry REFUSES external-gguf entries", async () => {
    const entry = { name: "ext", kind: "external-gguf", pathEnv: "X" };
    await expect(fm.fetchEntry(entry, { manifestPath, env: {}, log: () => {} })).rejects.toThrow(/presence-checked only/);
  });
});

describe("checksum verification", () => {
  it("verifyEntry passes on matching pinned sha256 and fails on mismatch", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", required: true, sha256: GOOD_SHA }]);
    const entry = fm.loadManifest(manifestPath).models[0];

    fs.writeFileSync(path.join(dir, "tiny.bin"), GOOD);
    let v = await fm.verifyEntry(entry, { manifestPath, env: {} });
    expect(v.ok).toBe(true);
    expect(v.sha256).toBe(GOOD_SHA);

    fs.writeFileSync(path.join(dir, "tiny.bin"), Buffer.from("TAMPERED"));
    v = await fm.verifyEntry(entry, { manifestPath, env: {} });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("sha256 mismatch");
  });

  it("env sha256 override beats manifest and lock", () => {
    const entry = { name: "t", sha256: "aa", sha256Env: "T_SHA" };
    expect(fm.expectedSha256(entry, { env: { T_SHA: "BB" }, lock: { t: { sha256: "cc" } } })).toEqual({ sha256: "bb", source: "env T_SHA" });
    expect(fm.expectedSha256(entry, { env: {}, lock: { t: { sha256: "cc" } } })).toEqual({ sha256: "aa", source: "manifest" });
    expect(fm.expectedSha256({ name: "t" }, { env: {}, lock: { t: { sha256: "cc" } } })).toEqual({ sha256: "cc", source: "lock" });
    expect(fm.expectedSha256({ name: "t" }, { env: {}, lock: {} })).toEqual({ sha256: null, source: "unpinned" });
  });
});

describe("fetchEntry (mocked network)", () => {
  it("downloads, verifies against the pinned hash, installs", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", required: true, url: "https://x/y", sha256: GOOD_SHA, maxBytes: 1024 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    const fetchImpl = vi.fn(async () => respOk(GOOD));

    const r = await fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} });
    expect(r.sha256).toBe(GOOD_SHA);
    expect(fs.readFileSync(path.join(dir, "tiny.bin"))).toEqual(GOOD);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("REJECTS a checksum mismatch — file is NOT installed, kept as .rejected", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", required: true, url: "https://x/y", sha256: GOOD_SHA, maxBytes: 1024 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    const fetchImpl = vi.fn(async () => respOk(Buffer.from("EVIL-BYTES")));

    await expect(fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} }))
      .rejects.toThrow(/SHA-256 MISMATCH/);
    expect(fs.existsSync(path.join(dir, "tiny.bin"))).toBe(false); // NOT installed
    expect(fs.existsSync(path.join(dir, "tiny.bin.rejected"))).toBe(true); // forensics copy
  });

  it("size guard: Content-Length over maxBytes aborts before writing", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", url: "https://x/y", maxBytes: 8 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    const fetchImpl = vi.fn(async () => respOk(GOOD)); // 29 bytes > 8

    await expect(fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} }))
      .rejects.toThrow(/size guard/);
    expect(fs.existsSync(path.join(dir, "tiny.bin"))).toBe(false);
  });

  it("size guard: streamed bytes over maxBytes abort mid-stream (lying Content-Length)", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", url: "https://x/y", maxBytes: 8 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    // Claims 4 bytes but streams 29 — guard must trip while streaming.
    const fetchImpl = vi.fn(async () => respOk(GOOD, 200, 4));

    await expect(fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} }))
      .rejects.toThrow(/size guard/);
    expect(fs.existsSync(path.join(dir, "tiny.bin"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "tiny.bin.part"))).toBe(false); // poisoned part removed
  });

  it("unpinned hash: pins into manifest.lock.json on first download (trust-on-first-use)", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", url: "https://x/y", maxBytes: 1024 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    const fetchImpl = vi.fn(async () => respOk(GOOD));

    await fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} });
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "manifest.lock.json"), "utf8"));
    expect(lock.tiny.sha256).toBe(GOOD_SHA);

    // A later fetch of DIFFERENT bytes must now be rejected by the lock pin.
    fs.rmSync(path.join(dir, "tiny.bin"));
    const evilFetch = vi.fn(async () => respOk(Buffer.from("EVIL")));
    await expect(fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl: evilFetch, log: () => {} }))
      .rejects.toThrow(/SHA-256 MISMATCH/);
  });

  it("skips download when the file is already present and verifies", async () => {
    writeManifest([{ name: "tiny", file: "tiny.bin", url: "https://x/y", sha256: GOOD_SHA, maxBytes: 1024 }]);
    const entry = fm.loadManifest(manifestPath).models[0];
    fs.writeFileSync(path.join(dir, "tiny.bin"), GOOD);
    const fetchImpl = vi.fn();

    const r = await fm.fetchEntry(entry, { manifestPath, env: {}, fetchImpl, log: () => {} });
    expect(r.sha256).toBe(GOOD_SHA);
    expect(fetchImpl).not.toHaveBeenCalled(); // no network needed
  });
});

describe("parseArgs", () => {
  it("parses the CLI surface", () => {
    expect(fm.parseArgs(["--dry-run", "--only", "dinov2-small", "--force", "--verify"])).toEqual({
      dryRun: true, verify: true, force: true, only: "dinov2-small",
    });
    expect(fm.parseArgs([])).toEqual({ dryRun: false, verify: false, force: false, only: null });
  });
});
