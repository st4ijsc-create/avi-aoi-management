/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — kbStudioService.ts unit tests.
 *
 * `../db/connection`'s getDb is fully mocked with a generic thenable chain-stub (mirrors the
 * `.select().from().where().limit()` mocking pattern already used by
 * server/services/aiGatewayQuota.test.ts) — no live database is ever touched. `drizzle-orm`
 * (eq/desc/sql) and `../../drizzle/schema/kbStudio` are the REAL modules (pure builders/
 * definitions, no I/O); since `db.select`/`db.insert`/`db.update`/`db.delete`/`db.transaction`
 * are entirely mocked, the query-builder calls they receive are never actually executed by
 * real drizzle — only inspected/stubbed here.
 *
 * Covers the fail-safe triage documented in kbStudioService.ts's module doc comment: READ
 * paths degrade to empty/`tableAvailable:false` on 42P01; the ingest-adjacent bookkeeping
 * writes (ensureCorpusRegistered/createJob/markJobSucceeded/markJobFailed) degrade to a
 * silent no-op; the EXPLICIT registry writes (createCorpus/deleteCorpus) throw a typed
 * {@link KbStudioTableUnavailableError} instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDbMock = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

function missingTableError(): Error & { code: string } {
  return Object.assign(new Error('relation "kb_corpora" does not exist'), { code: "42P01" });
}

/** doc69/E3-2 fix — the REAL shape a drizzle-orm ≥0.44 query against an unmigrated table
 * produces: a "Failed query: ..." wrapper Error with `code: undefined` at the top level and
 * the real postgres.js driver error (code 42P01) on `.cause`. Before the fix, kbStudioService's
 * local `isMissingTableError` only checked the top-level `.code`, so THIS shape leaked as a
 * raw, un-degraded error instead of `tableAvailable:false` — this is the live bug being
 * regression-tested here. */
function wrappedMissingTableError(): Error {
  const wrapped = new Error('Failed query: select "id" from "kb_corpora" order by "createdAt" desc');
  (wrapped as Error & { cause: unknown }).cause = missingTableError();
  return wrapped;
}

/** Generic thenable chain-stub: EVERY chain method (from/where/orderBy/limit/groupBy/values/
 * returning/onConflictDoNothing/set) returns the SAME stub, and awaiting it resolves to
 * `result` — avoids hand-writing the exact chain shape per call site (kbStudioService.ts
 * chains differ per query: select+groupBy, insert+values+returning, delete+where+returning, …). */
function chainable(result: unknown) {
  const methods = [
    "from", "where", "orderBy", "limit", "groupBy", "values",
    "returning", "onConflictDoNothing", "set",
  ] as const;
  const obj: Record<string, unknown> & PromiseLike<unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  } as unknown as Record<string, unknown> & PromiseLike<unknown>;
  for (const m of methods) obj[m] = vi.fn(() => obj);
  return obj;
}

function chainableRejecting(err: unknown) {
  const obj: Record<string, unknown> & PromiseLike<never> = {
    then: (_resolve: unknown, reject: (e: unknown) => void) => reject(err),
  } as unknown as Record<string, unknown> & PromiseLike<never>;
  const methods = ["from", "where", "orderBy", "limit", "groupBy", "values", "returning", "onConflictDoNothing", "set"] as const;
  for (const m of methods) obj[m] = vi.fn(() => obj);
  return obj;
}

let selectMock: ReturnType<typeof vi.fn>;
let insertMock: ReturnType<typeof vi.fn>;
let updateMock: ReturnType<typeof vi.fn>;
let deleteMock: ReturnType<typeof vi.fn>;
let transactionMock: ReturnType<typeof vi.fn>;
let fakeDb: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  selectMock = vi.fn();
  insertMock = vi.fn();
  updateMock = vi.fn();
  deleteMock = vi.fn();
  transactionMock = vi.fn();
  fakeDb = { select: selectMock, insert: insertMock, update: updateMock, delete: deleteMock, transaction: transactionMock };
  getDbMock.mockReset();
  getDbMock.mockResolvedValue(fakeDb);
});

async function loadService() {
  return import("./kbStudioService");
}

// ─── listCorpora ────────────────────────────────────────────────────────────

describe("kbStudioService.listCorpora", () => {
  it("no db connection ⇒ tableAvailable:false, empty", async () => {
    getDbMock.mockResolvedValue(null);
    const svc = await loadService();
    await expect(svc.listCorpora()).resolves.toEqual({ tableAvailable: false, corpora: [] });
  });

  it("kb_corpora unmigrated (42P01) ⇒ tableAvailable:false, empty — never throws", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.listCorpora()).resolves.toEqual({ tableAvailable: false, corpora: [] });
  });

  it("kb_corpora unmigrated, WRAPPED in a drizzle DrizzleQueryError (real shape) ⇒ tableAvailable:false, empty — regression for the live bug", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(wrappedMissingTableError()));
    const svc = await loadService();
    await expect(svc.listCorpora()).resolves.toEqual({ tableAvailable: false, corpora: [] });
  });

  it("no registered corpora ⇒ tableAvailable:true, empty, no stats queries issued", async () => {
    selectMock.mockReturnValueOnce(chainable([]));
    const svc = await loadService();
    const result = await svc.listCorpora();
    expect(result).toEqual({ tableAvailable: true, corpora: [] });
    expect(selectMock).toHaveBeenCalledTimes(1); // only the kb_corpora select — stats skipped
  });

  it("merges chunk-count + job-count/last-ingest stats per corpus", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const lastIngest = "2026-02-01T00:00:00Z";
    selectMock
      .mockReturnValueOnce(
        chainable([
          { id: 1, name: "vendor-x", description: null, createdBy: 7, createdAt: created, updatedAt: created },
          { id: 2, name: "vendor-y", description: null, createdBy: 7, createdAt: created, updatedAt: created },
        ]),
      )
      .mockReturnValueOnce(chainable([{ corpus: "vendor-x", cnt: 12 }])) // chunk stats
      .mockReturnValueOnce(chainable([{ corpus: "vendor-x", cnt: 3, lastAt: lastIngest }])); // job stats

    const svc = await loadService();
    const result = await svc.listCorpora();
    expect(result.tableAvailable).toBe(true);
    expect(result.corpora).toEqual([
      expect.objectContaining({ name: "vendor-x", chunkCount: 12, jobCount: 3, lastIngestAt: new Date(lastIngest) }),
      expect.objectContaining({ name: "vendor-y", chunkCount: 0, jobCount: 0, lastIngestAt: null }),
    ]);
  });

  it("kb_studio_chunks unmigrated (42P01) while kb_corpora IS ⇒ chunkCount degrades to 0, still returns corpora", async () => {
    const created = new Date();
    selectMock
      .mockReturnValueOnce(chainable([{ id: 1, name: "vendor-x", description: null, createdBy: 7, createdAt: created, updatedAt: created }]))
      .mockReturnValueOnce(chainableRejecting(missingTableError())) // chunk stats table missing
      .mockReturnValueOnce(chainable([])); // job stats — empty but available

    const svc = await loadService();
    const result = await svc.listCorpora();
    expect(result.tableAvailable).toBe(true);
    expect(result.corpora[0]).toEqual(expect.objectContaining({ chunkCount: 0, jobCount: 0 }));
  });
});

// ─── createCorpus ───────────────────────────────────────────────────────────

describe("kbStudioService.createCorpus", () => {
  it("no db connection ⇒ throws KbStudioTableUnavailableError (WRITE never silently no-ops)", async () => {
    getDbMock.mockResolvedValue(null);
    const svc = await loadService();
    await expect(svc.createCorpus({ name: "x" })).rejects.toBeInstanceOf(svc.KbStudioTableUnavailableError);
  });

  it("kb_corpora unmigrated (42P01) ⇒ throws KbStudioTableUnavailableError", async () => {
    insertMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.createCorpus({ name: "x" })).rejects.toBeInstanceOf(svc.KbStudioTableUnavailableError);
  });

  it("kb_corpora unmigrated, WRAPPED in a drizzle DrizzleQueryError ⇒ still throws KbStudioTableUnavailableError, not the raw wrapped error", async () => {
    insertMock.mockReturnValueOnce(chainableRejecting(wrappedMissingTableError()));
    const svc = await loadService();
    await expect(svc.createCorpus({ name: "x" })).rejects.toBeInstanceOf(svc.KbStudioTableUnavailableError);
  });

  it("success ⇒ returns the inserted row", async () => {
    const row = { id: 1, name: "vendor-x", description: "d", createdBy: 7, createdAt: new Date(), updatedAt: new Date() };
    insertMock.mockReturnValueOnce(chainable([row]));
    const svc = await loadService();
    await expect(svc.createCorpus({ name: "vendor-x", description: "d", createdBy: 7 })).resolves.toEqual(row);
  });

  it("a non-42P01 DB error (e.g. unique violation) propagates UNCHANGED for the router to map", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    insertMock.mockReturnValueOnce(chainableRejecting(uniqueViolation));
    const svc = await loadService();
    await expect(svc.createCorpus({ name: "vendor-x" })).rejects.toBe(uniqueViolation);
  });
});

// ─── ensureCorpusRegistered ─────────────────────────────────────────────────

describe("kbStudioService.ensureCorpusRegistered", () => {
  it("swallows 42P01 — never throws (best-effort, must never block ingest)", async () => {
    insertMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.ensureCorpusRegistered("vendor-x", 7)).resolves.toBeUndefined();
  });

  it("swallows ANY other error too", async () => {
    insertMock.mockReturnValueOnce(chainableRejecting(new Error("connection reset")));
    const svc = await loadService();
    await expect(svc.ensureCorpusRegistered("vendor-x")).resolves.toBeUndefined();
  });

  it("uses onConflictDoNothing so a re-ingest into an already-registered corpus is a silent no-op", async () => {
    const chain = chainable([]);
    insertMock.mockReturnValueOnce(chain);
    const svc = await loadService();
    await svc.ensureCorpusRegistered("vendor-x", 7);
    expect(chain.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

// ─── deleteCorpus ───────────────────────────────────────────────────────────

describe("kbStudioService.deleteCorpus", () => {
  it("no registry row for the name ⇒ KbCorpusNotFoundError, transaction never runs", async () => {
    selectMock.mockReturnValueOnce(chainable([]));
    const svc = await loadService();
    await expect(svc.deleteCorpus("ghost")).rejects.toBeInstanceOf(svc.KbCorpusNotFoundError);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("kb_corpora unmigrated on lookup ⇒ KbStudioTableUnavailableError", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.deleteCorpus("vendor-x")).rejects.toBeInstanceOf(svc.KbStudioTableUnavailableError);
  });

  it("success ⇒ deletes chunks + jobs + registry row inside ONE transaction, returns counts", async () => {
    selectMock.mockReturnValueOnce(chainable([{ id: 1, name: "vendor-x" }])); // existence check
    const txDeleteMock = vi.fn();
    transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb({ delete: txDeleteMock }),
    );
    txDeleteMock
      .mockReturnValueOnce(chainable([{ id: 101 }, { id: 102 }])) // chunks deleted
      .mockReturnValueOnce(chainable([{ id: 9 }])) // jobs deleted
      .mockReturnValueOnce(chainable(undefined)); // registry row deleted

    const svc = await loadService();
    const result = await svc.deleteCorpus("vendor-x");
    expect(result).toEqual({ chunksRemoved: 2, jobsRemoved: 1 });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txDeleteMock).toHaveBeenCalledTimes(3);
  });

  it("kb_studio_chunks/kb_ingest_jobs missing INSIDE the transaction ⇒ KbStudioTableUnavailableError (atomic — nothing partially deleted)", async () => {
    selectMock.mockReturnValueOnce(chainable([{ id: 1, name: "vendor-x" }]));
    transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb({ delete: vi.fn(() => chainableRejecting(missingTableError())) }),
    );
    const svc = await loadService();
    await expect(svc.deleteCorpus("vendor-x")).rejects.toBeInstanceOf(svc.KbStudioTableUnavailableError);
  });
});

// ─── listJobs ───────────────────────────────────────────────────────────────

describe("kbStudioService.listJobs", () => {
  it("no db ⇒ tableAvailable:false, empty", async () => {
    getDbMock.mockResolvedValue(null);
    const svc = await loadService();
    await expect(svc.listJobs({})).resolves.toEqual({ tableAvailable: false, jobs: [] });
  });

  it("42P01 ⇒ tableAvailable:false, empty — fail-safe, never throws", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.listJobs({ corpus: "vendor-x" })).resolves.toEqual({ tableAvailable: false, jobs: [] });
  });

  it("42P01 WRAPPED in a drizzle DrizzleQueryError ⇒ tableAvailable:false, empty — fail-safe, never throws", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(wrappedMissingTableError()));
    const svc = await loadService();
    await expect(svc.listJobs({ corpus: "vendor-x" })).resolves.toEqual({ tableAvailable: false, jobs: [] });
  });

  it("success ⇒ returns the job rows", async () => {
    const rows = [{ id: 1, corpus: "vendor-x", status: "succeeded" }];
    selectMock.mockReturnValueOnce(chainable(rows));
    const svc = await loadService();
    await expect(svc.listJobs({ corpus: "vendor-x" })).resolves.toEqual({ tableAvailable: true, jobs: rows });
  });
});

// ─── createJob / markJobSucceeded / markJobFailed ──────────────────────────

describe("kbStudioService job bookkeeping — never blocks the caller", () => {
  it("createJob: 42P01 ⇒ {tableAvailable:false, job:null}", async () => {
    insertMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(
      svc.createJob({ corpus: "vendor-x", sourceType: "pdf", sourceRef: "a.pdf" }),
    ).resolves.toEqual({ tableAvailable: false, job: null });
  });

  it("createJob: success ⇒ returns the inserted running job row", async () => {
    const row = { id: 5, corpus: "vendor-x", status: "running" };
    insertMock.mockReturnValueOnce(chainable([row]));
    const svc = await loadService();
    await expect(
      svc.createJob({ corpus: "vendor-x", sourceType: "pdf", sourceRef: "a.pdf", createdBy: 7 }),
    ).resolves.toEqual({ tableAvailable: true, job: row });
  });

  it("markJobSucceeded: jobId null ⇒ no DB call at all", async () => {
    const svc = await loadService();
    await svc.markJobSucceeded(null, 10);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("markJobSucceeded: swallows a DB error (best-effort, never masks a real success)", async () => {
    updateMock.mockReturnValueOnce(chainableRejecting(new Error("boom")));
    const svc = await loadService();
    await expect(svc.markJobSucceeded(5, 10)).resolves.toBeUndefined();
  });

  it("markJobFailed: jobId null ⇒ no DB call at all", async () => {
    const svc = await loadService();
    await svc.markJobFailed(null, "oops");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("markJobFailed: swallows a DB error (best-effort, never masks the original ingest error)", async () => {
    updateMock.mockReturnValueOnce(chainableRejecting(new Error("boom")));
    const svc = await loadService();
    await expect(svc.markJobFailed(5, "parse failed")).resolves.toBeUndefined();
  });
});

// ─── previewCorpus (Eval-lite) ──────────────────────────────────────────────

describe("kbStudioService.previewCorpus", () => {
  it("no db ⇒ tableAvailable:false, zero counts", async () => {
    getDbMock.mockResolvedValue(null);
    const svc = await loadService();
    await expect(svc.previewCorpus("vendor-x", 20)).resolves.toEqual({
      tableAvailable: false,
      totalChunks: 0,
      distinctSources: 0,
      sample: [],
    });
  });

  it("blank corpus ⇒ short-circuits with zero counts, issues no queries", async () => {
    const svc = await loadService();
    const result = await svc.previewCorpus("   ", 20);
    expect(result).toEqual({ tableAvailable: true, totalChunks: 0, distinctSources: 0, sample: [] });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("42P01 ⇒ tableAvailable:false — fail-safe, never throws", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.previewCorpus("vendor-x", 20)).resolves.toEqual({
      tableAvailable: false,
      totalChunks: 0,
      distinctSources: 0,
      sample: [],
    });
  });

  it("success ⇒ returns counts + a sample, truncating long chunk text", async () => {
    const longText = "x".repeat(1000);
    selectMock
      .mockReturnValueOnce(chainable([{ total: 42 }]))
      .mockReturnValueOnce(chainable([{ distinct: 3 }]))
      .mockReturnValueOnce(
        chainable([
          { id: 1, sourceType: "pdf", sourceRef: "a.pdf", chunkIndex: 0, text: longText, tokenCount: 250, createdAt: new Date() },
          { id: 2, sourceType: "pdf", sourceRef: "a.pdf", chunkIndex: 1, text: "short chunk", tokenCount: 3, createdAt: new Date() },
        ]),
      );
    const svc = await loadService();
    const result = await svc.previewCorpus("vendor-x", 20);
    expect(result.tableAvailable).toBe(true);
    expect(result.totalChunks).toBe(42);
    expect(result.distinctSources).toBe(3);
    expect(result.sample).toHaveLength(2);
    expect(result.sample[0]!.text.length).toBeLessThan(longText.length);
    expect(result.sample[0]!.text.endsWith("…")).toBe(true);
    expect(result.sample[1]!.text).toBe("short chunk");
  });
});

// ─── listCorpusChunksForTraining (doc69 E3-6 — LoRA fine-tune data source) ──

describe("kbStudioService.listCorpusChunksForTraining", () => {
  it("no db ⇒ tableAvailable:false, empty", async () => {
    getDbMock.mockResolvedValue(null);
    const svc = await loadService();
    await expect(svc.listCorpusChunksForTraining("vendor-x", 100)).resolves.toEqual({
      tableAvailable: false,
      chunks: [],
    });
  });

  it("blank corpus ⇒ short-circuits, issues no queries", async () => {
    const svc = await loadService();
    const result = await svc.listCorpusChunksForTraining("   ", 100);
    expect(result).toEqual({ tableAvailable: true, chunks: [] });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("42P01 ⇒ tableAvailable:false — fail-safe, never throws", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(missingTableError()));
    const svc = await loadService();
    await expect(svc.listCorpusChunksForTraining("vendor-x", 100)).resolves.toEqual({
      tableAvailable: false,
      chunks: [],
    });
  });

  it("the drizzle-wrapped 42P01 shape also degrades fail-safe", async () => {
    selectMock.mockReturnValueOnce(chainableRejecting(wrappedMissingTableError()));
    const svc = await loadService();
    await expect(svc.listCorpusChunksForTraining("vendor-x", 100)).resolves.toEqual({
      tableAvailable: false,
      chunks: [],
    });
  });

  it("success ⇒ returns FULL (untruncated) chunk text, ordered", async () => {
    const longText = "x".repeat(1000);
    selectMock.mockReturnValueOnce(
      chainable([
        { id: 1, sourceRef: "a.pdf", chunkIndex: 0, text: longText },
        { id: 2, sourceRef: "a.pdf", chunkIndex: 1, text: "short chunk" },
      ]),
    );
    const svc = await loadService();
    const result = await svc.listCorpusChunksForTraining("vendor-x", 100);
    expect(result.tableAvailable).toBe(true);
    expect(result.chunks).toHaveLength(2);
    // Unlike previewCorpus, the full text is returned — no truncation.
    expect(result.chunks[0]!.text).toBe(longText);
    expect(result.chunks[1]!.text).toBe("short chunk");
  });

  it("clamps an absurd limit to the 20000 hard cap (no unbounded query)", async () => {
    selectMock.mockReturnValueOnce(chainable([]));
    const svc = await loadService();
    await svc.listCorpusChunksForTraining("vendor-x", 999_999);
    const chain = selectMock.mock.results[0]!.value;
    expect(chain.limit).toHaveBeenCalledWith(20000);
  });
});
