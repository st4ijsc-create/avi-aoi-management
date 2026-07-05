/**
 * Doc 27 Đợt 2 / W2-C — INSPECTION STORE-AND-FORWARD tests (vitest, no live DB).
 *
 * The submit pipeline + DB dedup check are INJECTED (setProcessFn/setDedupFn) so
 * buffer / backfill / idempotency / dead-letter / bounds run against mocks. A
 * per-test WAL file under the OS temp dir exercises the file mirror + restore.
 *
 * Acceptance matrix (mission Part 1):
 *   (a) DB failure mid-submit → payload lands in the WAL (not dropped).
 *   (b) after "recovery" the backfill replays it through the pipeline → exactly-once.
 *   (c) a machine-side duplicate retry does NOT create a second entry/insert.
 *   (d) a live-path success + queued duplicate → backfill dedupes (ledger + DB check).
 *   (e) permanent errors dead-letter instead of poisoning the queue.
 *   (f) bounded overflow (counted, never silent) + flag-off passthrough.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  inspectionStoreForwardEnabled,
  computeSubmissionKey,
  bufferSubmission,
  backfillInspections,
  restoreInspectionWal,
  bufferedInspectionCount,
  getInspectionStoreForwardStatus,
  markSubmissionApplied,
  isPermanentSubmitError,
  setProcessFn,
  setDedupFn,
  _resetInspectionStoreForward,
  type BufferedSubmission,
} from "./inspectionStoreForward";

function submission(serial: string, extra: Partial<BufferedSubmission> = {}): BufferedSubmission {
  return {
    apiKey: "TEST-KEY",
    serialNumber: serial,
    inspectionTime: "2026-07-04T08:00:00.000Z",
    overallResult: "OK",
    measurements: [],
    ...extra,
  };
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(
    os.tmpdir(),
    `insp-sf-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.INSPECTION_STORE_FORWARD_MAX;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_AGE_MS;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_BYTES;
  delete process.env.INSPECTION_STORE_FORWARD_DRAIN_BATCH;
  _resetInspectionStoreForward();
});

afterEach(async () => {
  _resetInspectionStoreForward();
  for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
    try {
      await fs.unlink(f);
    } catch {
      /* may not exist */
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("flag gating", () => {
  it("is OFF by default and follows OT_STORE_FORWARD_ENABLED as fallback", () => {
    delete process.env.INSPECTION_STORE_FORWARD_ENABLED;
    expect(inspectionStoreForwardEnabled()).toBe(false);
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    expect(inspectionStoreForwardEnabled()).toBe(true);
    // explicit own flag wins over the fallback
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    expect(inspectionStoreForwardEnabled()).toBe(false);
  });

  it("buffer is a no-op when disabled (passthrough behaviour)", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    const r = await bufferSubmission(submission("SN-1"));
    expect(r.buffered).toBe(false);
    expect(bufferedInspectionCount()).toBe(0);
  });
});

describe("submission key (machine+serial+timestamp hash)", () => {
  it("is stable for the same payload and never contains the raw apiKey", () => {
    const a = computeSubmissionKey(submission("SN-1"));
    expect(a).toBe(computeSubmissionKey(submission("SN-1")));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("TEST-KEY");
  });

  it("differs by machine, serial and timestamp", () => {
    const base = computeSubmissionKey(submission("SN-1"));
    expect(computeSubmissionKey(submission("SN-2"))).not.toBe(base);
    expect(computeSubmissionKey(submission("SN-1", { apiKey: "OTHER" }))).not.toBe(base);
    expect(
      computeSubmissionKey(submission("SN-1", { inspectionTime: "2026-07-04T09:00:00.000Z" })),
    ).not.toBe(base);
  });
});

describe("DB failure → WAL → backfill (exactly-once)", () => {
  it("buffers on failure, replays exactly once after recovery", async () => {
    const processed: BufferedSubmission[] = [];
    let dbUp = false;
    setProcessFn(async (p) => {
      if (!dbUp) throw new Error("connect ECONNREFUSED");
      processed.push(p);
      return { inspectionId: 100 + processed.length };
    });
    setDedupFn(async () => false);

    const r = await bufferSubmission(submission("SN-A"));
    expect(r.buffered).toBe(true);
    expect(bufferedInspectionCount()).toBe(1);

    // DB still down → entry stays queued.
    let bf = await backfillInspections();
    expect(bf.drained).toBe(0);
    expect(bf.remaining).toBe(1);

    // recovery → drained exactly once
    dbUp = true;
    bf = await backfillInspections();
    expect(bf.drained).toBe(1);
    expect(bf.remaining).toBe(0);
    expect(processed).toHaveLength(1);
    expect(processed[0].serialNumber).toBe("SN-A");

    // replaying again does nothing (queue empty, ledger holds the key)
    bf = await backfillInspections();
    expect(bf.drained).toBe(0);
    expect(processed).toHaveLength(1);
  });

  it("a machine-side duplicate retry while queued does not double-buffer or double-insert", async () => {
    const processFn = vi.fn(async () => ({ inspectionId: 1 }));
    setProcessFn(processFn);
    setDedupFn(async () => false);

    const first = await bufferSubmission(submission("SN-DUP"));
    const second = await bufferSubmission(submission("SN-DUP")); // machine retried
    expect(first.buffered).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.key).toBe(first.key);
    expect(bufferedInspectionCount()).toBe(1);

    const bf = await backfillInspections();
    expect(bf.drained).toBe(1);
    expect(processFn).toHaveBeenCalledTimes(1); // exactly-once
  });

  it("live-path success + queued duplicate → backfill dedupes via the applied ledger", async () => {
    const processFn = vi.fn(async () => ({ inspectionId: 1 }));
    setProcessFn(processFn);
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-LIVE"));
    // …DB recovers, the machine retries LIVE and the router persists + ledgers it:
    markSubmissionApplied(computeSubmissionKey(submission("SN-LIVE")));

    const bf = await backfillInspections();
    expect(bf.deduped).toBe(1);
    expect(bf.drained).toBe(0);
    expect(processFn) .not.toHaveBeenCalled();
  });

  it("dedupes via the DB existence check (crash-replay / cross-restart guard)", async () => {
    const processFn = vi.fn(async () => ({ inspectionId: 1 }));
    setProcessFn(processFn);
    setDedupFn(async () => true); // a matching product_inspections row already exists

    await bufferSubmission(submission("SN-DBDUP"));
    const bf = await backfillInspections();
    expect(bf.deduped).toBe(1);
    expect(processFn).not.toHaveBeenCalled();
  });

  it("a failing dedup check (DB still down) leaves the entry queued", async () => {
    setProcessFn(async () => ({ inspectionId: 1 }));
    setDedupFn(async () => {
      throw new Error("db down");
    });
    await bufferSubmission(submission("SN-WAIT"));
    const bf = await backfillInspections();
    expect(bf.drained).toBe(0);
    expect(bf.remaining).toBe(1);
  });
});

describe("permanent errors → dead-letter", () => {
  it("classifies TRPC auth/validation as permanent, generic errors as transient", () => {
    expect(isPermanentSubmitError(new TRPCError({ code: "UNAUTHORIZED" }))).toBe(true);
    expect(isPermanentSubmitError(new TRPCError({ code: "BAD_REQUEST" }))).toBe(true);
    expect(isPermanentSubmitError(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }))).toBe(false);
    expect(isPermanentSubmitError(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("dead-letters a permanently invalid payload and continues draining", async () => {
    const processFn = vi.fn(async (p: BufferedSubmission) => {
      if (p.serialNumber === "SN-BAD") throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
      return { inspectionId: 7 };
    });
    setProcessFn(processFn);
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-BAD"));
    await bufferSubmission(submission("SN-GOOD"));

    const bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1);
    expect(bf.drained).toBe(1);
    expect(bf.remaining).toBe(0);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-BAD");
    expect(dead).toContain("Invalid API key");
  });
});

describe("bounds + restore + status", () => {
  it("overflow drops the OLDEST and counts it (never silent)", async () => {
    process.env.INSPECTION_STORE_FORWARD_MAX = "2";
    setProcessFn(async () => ({ inspectionId: 1 }));
    await bufferSubmission(submission("SN-1"));
    await bufferSubmission(submission("SN-2"));
    await bufferSubmission(submission("SN-3"));
    expect(bufferedInspectionCount()).toBe(2);
    const st = getInspectionStoreForwardStatus();
    expect(st.droppedOverflow).toBe(1);
    expect(st.buffered).toBe(3);
  });

  it("restores buffered submissions from the WAL file after a restart", async () => {
    await bufferSubmission(submission("SN-R1"));
    await bufferSubmission(submission("SN-R2"));
    expect(bufferedInspectionCount()).toBe(2);

    _resetInspectionStoreForward(); // simulate process restart (file survives)
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
    expect(bufferedInspectionCount()).toBe(0);

    const restored = await restoreInspectionWal();
    expect(restored).toBe(2);

    const processed: string[] = [];
    setProcessFn(async (p) => {
      processed.push(p.serialNumber);
      return { inspectionId: 1 };
    });
    setDedupFn(async () => false);
    const bf = await backfillInspections();
    expect(bf.drained).toBe(2);
    expect(processed).toEqual(["SN-R1", "SN-R2"]); // replay order = enqueue order
  });

  it("status exposes honest metrics", async () => {
    await bufferSubmission(submission("SN-M"));
    const st = getInspectionStoreForwardStatus();
    expect(st.enabled).toBe(true);
    expect(st.bufferedCount).toBe(1);
    expect(st.walFile).toBe(walPath);
    expect(st.lastBufferedAt).toBeTruthy();
  });
});
