/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — kbVectorStore.ts unit tests.
 *
 * `../db/connection`'s getDb is fully mocked — no live database is ever touched. `db.execute`
 * (both the top-level call used by searchCorpus and the `tx.execute` used inside
 * upsertChunks' transaction) is routed through the SAME `executeMock`, so assertions can
 * inspect every raw-SQL call issued by either function.
 *
 * `renderSql()` flattens a drizzle `sql\`...\`` tagged-template result into a debug string —
 * literal SQL text stays in `StringChunk`s while bound values (corpus, chunk text, …) appear
 * as raw interleaved values in `queryChunks`, which is exactly what lets the "parameterized,
 * not string-concatenated" tests below tell the difference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const transactionMock = vi.fn(async (cb: (tx: { execute: typeof executeMock }) => unknown) =>
  cb({ execute: executeMock }),
);
const fakeDb = { execute: executeMock, transaction: transactionMock };
const getDbMock = vi.fn(async () => fakeDb);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { upsertChunks, searchCorpus, type KbChunkInput } from "./kbVectorStore";

function missingTableError(): Error & { code: string } {
  return Object.assign(new Error('relation "kb_studio_chunks" does not exist'), { code: "42P01" });
}

/** doc69/E3-2 fix — the REAL shape a drizzle-orm ≥0.44 query against an unmigrated table
 * produces: a "Failed query: ..." wrapper Error with `code: undefined` at the top level and
 * the real postgres.js driver error (code 42P01) on `.cause`. Before the fix, kbVectorStore's
 * local `isMissingTableError` only checked the top-level `.code`, so THIS shape leaked as a
 * raw, un-degraded error instead of `tableAvailable:false` / `[]` — this is the live bug
 * being regression-tested here. Note: kbVectorStore uses raw `db.execute(sql\`...\`)`, not
 * drizzle's query builder, but the SAME DrizzleQueryError wrapping applies to `execute()`. */
function wrappedMissingTableError(): Error {
  const wrapped = new Error('Failed query: SELECT * FROM kb_studio_chunks WHERE "corpus" = $1');
  (wrapped as Error & { cause: unknown }).cause = missingTableError();
  return wrapped;
}

/**
 * Recursively flattens a drizzle `sql\`...\`` tagged-template result into its LITERAL SQL
 * text (only the parts that are actually sent to postgres as raw query text — including
 * nested `sql.raw(...)` fragments like the vector-dimension literal) and its bound
 * PARAMETER values (everything interpolated via `${...}` that is NOT `sql.raw`, e.g.
 * corpus/text/embedding) kept separate. This is what makes the "parameterized, not
 * string-concatenated" test below meaningful — checking the LITERAL text for an injected
 * value proves nothing if the check also (incorrectly) inspects the parameter values
 * themselves, which of course "contain" whatever was passed in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenSql(s: any): { literal: string; params: unknown[] } {
  let literal = "";
  const params: unknown[] = [];
  for (const c of s.queryChunks) {
    if (c && typeof c === "object" && Array.isArray(c.value)) {
      literal += c.value.join("");
    } else if (c && typeof c === "object" && Array.isArray(c.queryChunks)) {
      const nested = flattenSql(c);
      literal += nested.literal;
      params.push(...nested.params);
    } else {
      params.push(c);
    }
  }
  return { literal, params };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderSql(s: any): string {
  return flattenSql(s).literal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawParams(s: any): unknown[] {
  return flattenSql(s).params;
}

function makeChunk(overrides: Partial<KbChunkInput> = {}): KbChunkInput {
  return {
    index: 0,
    text: "chunk body text",
    embedding: new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
    sourceType: "pdf",
    sourceRef: "manual.pdf",
    createdBy: 7,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb);
  transactionMock.mockImplementation(async (cb: (tx: { execute: typeof executeMock }) => unknown) =>
    cb({ execute: executeMock }),
  );
});

// ─── upsertChunks ─────────────────────────────────────────────────────────

describe("upsertChunks", () => {
  it("builds the right INSERT (table/columns/values) inside a transaction, after a clean-slate DELETE", async () => {
    executeMock
      .mockResolvedValueOnce(undefined) // DELETE (corpus, sourceRef)
      .mockResolvedValueOnce([{ id: 42 }]) // INSERT
      .mockResolvedValueOnce(undefined); // embedding_vec UPDATE
    const result = await upsertChunks("vendor-x-manuals", [makeChunk()]);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(3);

    const deleteSql = renderSql(executeMock.mock.calls[0]![0]);
    expect(deleteSql).toContain("DELETE FROM kb_studio_chunks");
    expect(deleteSql).toContain('"corpus" =');
    expect(deleteSql).toContain('"sourceRef" =');

    const insertSql = renderSql(executeMock.mock.calls[1]![0]);
    expect(insertSql).toContain("INSERT INTO kb_studio_chunks");
    expect(insertSql).toContain('"corpus"');
    expect(insertSql).toContain('"sourceType"');
    expect(insertSql).toContain('"sourceRef"');
    expect(insertSql).toContain('"chunkIndex"');
    expect(insertSql).toContain('"text"');
    expect(insertSql).toContain("ON CONFLICT");

    const insertParams = rawParams(executeMock.mock.calls[1]![0]);
    expect(insertParams).toContain("vendor-x-manuals");
    expect(insertParams).toContain("manual.pdf");
    expect(insertParams).toContain("chunk body text");

    expect(result).toEqual({ tableAvailable: true, inserted: 1, skipped: 0 });
  });

  it("writes embedding_vec as a best-effort UPDATE for 1024-dim rows", async () => {
    executeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce(undefined);
    await upsertChunks("c1", [makeChunk()]);

    const updateSql = renderSql(executeMock.mock.calls[2]![0]);
    expect(updateSql).toContain("UPDATE kb_studio_chunks SET embedding_vec");
    expect(updateSql).toContain("vector(1024)");
  });

  it("skips the embedding_vec UPDATE for non-1024-dim embeddings", async () => {
    executeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ id: 5 }]);
    await upsertChunks("c1", [makeChunk({ embedding: [0.1, 0.2, 0.3] })]);
    expect(executeMock).toHaveBeenCalledTimes(2); // DELETE + INSERT, no vector UPDATE
  });

  it("corpus is a bound parameter, never string-concatenated into the SQL text", async () => {
    executeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce(undefined);
    const trickyCorpus = "corpus'; DROP TABLE kb_studio_chunks; --";
    await upsertChunks(trickyCorpus, [makeChunk()]);

    const deleteCall = executeMock.mock.calls[0]![0];
    expect(renderSql(deleteCall)).not.toContain("DROP TABLE");
    expect(rawParams(deleteCall)).toContain(trickyCorpus);

    const insertCall = executeMock.mock.calls[1]![0];
    expect(renderSql(insertCall)).not.toContain("DROP TABLE");
    expect(rawParams(insertCall)).toContain(trickyCorpus);
  });

  it("clean-slate re-ingest: DELETE for (corpus, sourceRef) is issued before the INSERTs, inside the transaction", async () => {
    // Simulates the PREVIOUS ingest of "manual.pdf" having written 5 chunks; this call
    // re-ingests the same (corpus, sourceRef) with only 2 chunks (the document shrank).
    executeMock
      .mockResolvedValueOnce(undefined) // DELETE (corpus, "manual.pdf") — wipes all 5 old rows
      .mockResolvedValueOnce([{ id: 101 }]) // INSERT chunk 0
      .mockResolvedValueOnce(undefined) // vector UPDATE chunk 0
      .mockResolvedValueOnce([{ id: 102 }]) // INSERT chunk 1
      .mockResolvedValueOnce(undefined); // vector UPDATE chunk 1
    const chunks = [makeChunk({ index: 0 }), makeChunk({ index: 1 })];
    const result = await upsertChunks("vendor-x-manuals", chunks);

    // Only ONE DELETE (one distinct sourceRef), scoped to that sourceRef, issued first —
    // then exactly the 2 new chunks are inserted. No attempt is made to insert/keep any
    // stale higher-chunkIndex rows from the previous (5-chunk) ingest.
    expect(executeMock).toHaveBeenCalledTimes(5);
    const deleteCall = executeMock.mock.calls[0]![0];
    expect(renderSql(deleteCall)).toContain("DELETE FROM kb_studio_chunks");
    expect(rawParams(deleteCall)).toEqual(["vendor-x-manuals", "manual.pdf"]);

    const insertCalls = [executeMock.mock.calls[1]![0], executeMock.mock.calls[3]![0]];
    for (const c of insertCalls) {
      expect(renderSql(c)).toContain("INSERT INTO kb_studio_chunks");
    }
    // The transaction ordering (DELETE at index 0, both INSERTs after it) proves the delete
    // happens before any insert of the new set, all inside the same db.transaction() call.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ tableAvailable: true, inserted: 2, skipped: 0 });
  });

  it("clean-slate re-ingest with MORE chunks than before still works (full replace, not additive)", async () => {
    executeMock
      .mockResolvedValueOnce(undefined) // DELETE
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 2 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce(undefined);
    const chunks = [makeChunk({ index: 0 }), makeChunk({ index: 1 }), makeChunk({ index: 2 })];
    const result = await upsertChunks("c1", chunks);
    expect(executeMock).toHaveBeenCalledTimes(7); // 1 DELETE + 3×(INSERT + vector UPDATE)
    expect(result).toEqual({ tableAvailable: true, inserted: 3, skipped: 0 });
  });

  it("scopes the DELETE per sourceRef when a call writes multiple documents — other sourceRefs in the same corpus are untouched", async () => {
    executeMock
      .mockResolvedValueOnce(undefined) // DELETE (corpus, "manual.pdf")
      .mockResolvedValueOnce(undefined) // DELETE (corpus, "manual2.pdf")
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 2 }])
      .mockResolvedValueOnce(undefined);
    const chunks = [
      makeChunk({ index: 0, sourceRef: "manual.pdf" }),
      makeChunk({ index: 0, sourceRef: "manual2.pdf" }),
    ];
    await upsertChunks("vendor-x-manuals", chunks);

    // Exactly 2 DELETEs — one per distinct sourceRef being written, NOT a corpus-wide wipe.
    const deleteCalls = [executeMock.mock.calls[0]![0], executeMock.mock.calls[1]![0]];
    const deletedRefs = deleteCalls.map((c) => rawParams(c));
    expect(deletedRefs).toContainEqual(["vendor-x-manuals", "manual.pdf"]);
    expect(deletedRefs).toContainEqual(["vendor-x-manuals", "manual2.pdf"]);
    for (const c of deleteCalls) {
      expect(renderSql(c)).not.toContain("DROP TABLE");
    }
    // A sourceRef NOT present in this call (e.g. a third document already in the corpus)
    // never appears in any DELETE's bound params — the DELETE is scoped, not corpus-wide.
    for (const c of deleteCalls) {
      expect(rawParams(c)).not.toContain("other-document.pdf");
    }
  });

  it("is a no-op (no DB call) for an empty corpus or an empty chunks array", async () => {
    expect(await upsertChunks("", [makeChunk()])).toEqual({ tableAvailable: true, inserted: 0, skipped: 0 });
    expect(await upsertChunks("corpus-x", [])).toEqual({ tableAvailable: true, inserted: 0, skipped: 0 });
    expect(executeMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("degrades to {tableAvailable:false} on 42P01 (table not migrated) — never throws", async () => {
    executeMock.mockRejectedValueOnce(missingTableError());
    const result = await upsertChunks("c1", [makeChunk()]);
    expect(result).toEqual({ tableAvailable: false, inserted: 0, skipped: 1 });
  });

  it("degrades to {tableAvailable:false} on 42P01 WRAPPED in a drizzle DrizzleQueryError (real shape) — regression for the live bug", async () => {
    executeMock.mockRejectedValueOnce(wrappedMissingTableError());
    const result = await upsertChunks("c1", [makeChunk()]);
    expect(result).toEqual({ tableAvailable: false, inserted: 0, skipped: 1 });
  });

  it("a REAL error (not 42P01) is rethrown — no half-written corpus is reported as success", async () => {
    executeMock
      .mockResolvedValueOnce(undefined) // DELETE (corpus, "manual.pdf") ok
      .mockResolvedValueOnce(undefined) // DELETE (corpus, "manual2.pdf") ok
      .mockResolvedValueOnce([{ id: 1 }]) // chunk 1 insert ok
      .mockResolvedValueOnce(undefined) // chunk 1 vector update ok
      .mockRejectedValueOnce(new Error("connection reset")); // chunk 2 insert fails
    await expect(
      upsertChunks("c1", [makeChunk({ index: 0 }), makeChunk({ index: 1, sourceRef: "manual2.pdf" })]),
    ).rejects.toThrow(/connection reset/);
  });

  it("no DB connection available ⇒ fail-safe no-op", async () => {
    getDbMock.mockResolvedValueOnce(undefined);
    const result = await upsertChunks("c1", [makeChunk()]);
    expect(result).toEqual({ tableAvailable: false, inserted: 0, skipped: 1 });
  });
});

// ─── searchCorpus ─────────────────────────────────────────────────────────

describe("searchCorpus", () => {
  const QUERY_VEC = new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));

  it("scopes the query to the given corpus (bound param) and returns top-k", async () => {
    executeMock.mockResolvedValueOnce([
      { id: 1, corpus: "c1", sourceType: "pdf", sourceRef: "a.pdf", chunkIndex: 0, text: "hit one", score: 0.9 },
      { id: 2, corpus: "c1", sourceType: "pdf", sourceRef: "b.pdf", chunkIndex: 0, text: "hit two", score: 0.5 },
    ]);
    const hits = await searchCorpus("c1", QUERY_VEC, 2);

    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ id: 1, corpus: "c1", sourceRef: "a.pdf", score: 0.9 });

    const call = executeMock.mock.calls[0]![0];
    const sqlText = renderSql(call);
    expect(sqlText).toContain("FROM kb_studio_chunks");
    expect(sqlText).toContain('"corpus" =');
    expect(rawParams(call)).toContain("c1");
  });

  it("clamps k into [1,50]", async () => {
    executeMock.mockResolvedValueOnce([]);
    await searchCorpus("c1", QUERY_VEC, 9999);
    expect(executeMock).toHaveBeenCalledTimes(1); // an empty tier-1 result IS the answer, no tier-2 fallthrough
    expect(rawParams(executeMock.mock.calls[0]![0])).toContain(50);
  });

  it("missing table (42P01) ⇒ empty array, no throw, no second (brute-force) query attempted", async () => {
    executeMock.mockRejectedValueOnce(missingTableError());
    const hits = await searchCorpus("c1", QUERY_VEC, 5);
    expect(hits).toEqual([]);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("missing table (42P01) WRAPPED in a drizzle DrizzleQueryError ⇒ empty array, no throw, no brute-force fallthrough — regression for the live bug", async () => {
    executeMock.mockRejectedValueOnce(wrappedMissingTableError());
    const hits = await searchCorpus("c1", QUERY_VEC, 5);
    expect(hits).toEqual([]);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Node brute-force cosine when the HNSW tier fails for a non-missing-table reason", async () => {
    executeMock
      .mockRejectedValueOnce(new Error("extension \"vector\" is not available"))
      .mockResolvedValueOnce([
        {
          id: 1,
          corpus: "c1",
          sourceType: "pdf",
          sourceRef: "a.pdf",
          chunkIndex: 0,
          text: "close match",
          embedding: JSON.stringify(QUERY_VEC),
        },
        {
          id: 2,
          corpus: "c1",
          sourceType: "pdf",
          sourceRef: "b.pdf",
          chunkIndex: 0,
          text: "far match",
          embedding: JSON.stringify(new Array(1024).fill(0).map((_, i) => (i === 1 ? 1 : 0))),
        },
      ]);
    const hits = await searchCorpus("c1", QUERY_VEC, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0].sourceRef).toBe("a.pdf"); // identical vector ⇒ cosine 1 ⇒ ranked first
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it("bad input (empty corpus / empty embedding) ⇒ empty, no DB call", async () => {
    expect(await searchCorpus("", QUERY_VEC, 5)).toEqual([]);
    expect(await searchCorpus("c1", [], 5)).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("no DB connection available ⇒ empty, fail-safe", async () => {
    getDbMock.mockResolvedValueOnce(undefined);
    expect(await searchCorpus("c1", QUERY_VEC, 5)).toEqual([]);
  });
});
