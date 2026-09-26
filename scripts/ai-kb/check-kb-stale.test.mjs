// doc69 Wave 0 (W0-A) — KB embeddings-vs-chunks staleness gate test.
//
// Unit-tests the PURE `embeddingsVsChunksStaleness()` function exported from
// check-kb-stale.mjs. This function takes already-parsed embeddings-meta.json /
// chunks-stats.json objects (+ a threshold) and NEVER throws — honest "unknown"
// degradation on missing/unparseable input, since the RAG corpus went dead once
// before (chunks re-generated, embeddings not re-run) and this gate must detect
// that drift loudly without ever crashing the pre-push hook.
//
// Run: node scripts/ai-kb/check-kb-stale.test.mjs
// (Not part of the vitest suite — vitest.config.ts only globs *.test.ts, so this
// uses node:test + node:assert/strict for a zero-config self-runnable test,
// mirroring the existing scripts/ai-kb/buildOperationalCards.test.mjs convention.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddingsVsChunksStaleness } from "./check-kb-stale.mjs";

test("reports stale when chunks are newer than embeddings by more than the threshold", () => {
  const embMeta = { generatedAt: "2026-07-27T00:00:00.000Z" };
  const chunkStats = { generatedAt: "2026-07-29T00:00:00.000Z" }; // +48h
  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 });
  assert.equal(result.status, "stale");
  assert.equal(result.lagHours, 48);
});

test("reports fresh when embeddings are newer than chunks", () => {
  const embMeta = { generatedAt: "2026-07-29T00:00:00.000Z" };
  const chunkStats = { generatedAt: "2026-07-27T00:00:00.000Z" };
  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 });
  assert.equal(result.status, "fresh");
});

test("reports fresh when chunks are newer but within the threshold", () => {
  const embMeta = { generatedAt: "2026-07-27T00:00:00.000Z" };
  const chunkStats = { generatedAt: "2026-07-27T02:00:00.000Z" }; // +2h
  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 });
  assert.equal(result.status, "fresh");
  assert.equal(result.lagHours, 2);
});

test("reports unknown (never throws) when embeddings-meta is missing", () => {
  const chunkStats = { generatedAt: "2026-07-27T00:00:00.000Z" };
  assert.doesNotThrow(() => embeddingsVsChunksStaleness({ embMeta: null, chunkStats, staleHours: 24 }));
  const result = embeddingsVsChunksStaleness({ embMeta: null, chunkStats, staleHours: 24 });
  assert.equal(result.status, "unknown");
});

test("reports unknown (never throws) when generatedAt is missing on embeddings-meta", () => {
  const embMeta = {};
  const chunkStats = { generatedAt: "2026-07-27T00:00:00.000Z" };
  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 });
  assert.equal(result.status, "unknown");
});

test("reports unknown (never throws) when generatedAt is an unparseable date", () => {
  const embMeta = { generatedAt: "not-a-date" };
  const chunkStats = { generatedAt: "2026-07-27T00:00:00.000Z" };
  assert.doesNotThrow(() => embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 }));
  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours: 24 });
  assert.equal(result.status, "unknown");
});
