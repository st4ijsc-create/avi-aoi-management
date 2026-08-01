/**
 * U6-c (doc 21 §6 U6 / G-12) — soft-ref integrity checker tests.
 *
 * Covers, WITHOUT a real DB (a mock `db.execute` drives the SELECTs):
 *   • detects a planted orphan (count>0 → sample fetched → ok:false, totalOrphans>0);
 *   • clean when none (all counts 0 → ok:true, totalOrphans:0, no sample fetch);
 *   • DB absent → honest skipped result (all rules skipped, ok:true);
 *   • a per-rule query error is isolated (that rule skipped, others still run).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the DB connection module the checker imports.
const getDb = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: () => getDb() }));

import { checkSoftRefIntegrity } from "./integrityCheck";

/**
 * Build a mock db whose execute() returns a scripted result per SQL by matching a
 * fragment of the query text. `counts` maps a rule fragment → orphan count;
 * sample queries return `sampleRows`.
 */
function mockDb(opts: {
  counts: Record<string, number>;
  sampleRows?: any[];
  throwOn?: string;
}) {
  return {
    execute: vi.fn(async (query: any) => {
      // drizzle sql`` → stringify the query chunks to inspect intent.
      const text = JSON.stringify(query?.queryChunks ?? query ?? "");
      if (opts.throwOn && text.includes(opts.throwOn)) {
        throw new Error(`boom:${opts.throwOn}`);
      }
      const isCount = text.includes("count(*)");
      // find which rule this query belongs to
      const key = Object.keys(opts.counts).find((k) => text.includes(k));
      if (isCount) {
        return [{ n: key ? opts.counts[key] : 0 }];
      }
      // sample query
      return opts.sampleRows ?? [];
    }),
  };
}

describe("checkSoftRefIntegrity (U6-c / G-12)", () => {
  beforeEach(() => {
    getDb.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects a planted orphan", async () => {
    // Plant an orphan on the tasks→robots rule; all others clean.
    getDb.mockResolvedValue(
      mockDb({
        counts: { "FROM tasks t": 2 },
        sampleRows: [
          { id: 11, ref: 999 },
          { id: 12, ref: 998 },
        ],
      }),
    );
    const report = await checkSoftRefIntegrity();
    expect(report.ok).toBe(false);
    expect(report.totalOrphans).toBe(2);
    const taskRule = report.rules.find((r) => r.rule.startsWith("tasks."));
    expect(taskRule?.orphanCount).toBe(2);
    expect(taskRule?.skipped).toBe(false);
    expect(taskRule?.sample).toEqual([
      { id: 11, ref: 999 },
      { id: 12, ref: 998 },
    ]);
    // other rules clean
    expect(report.rules.filter((r) => r.orphanCount > 0)).toHaveLength(1);
  });

  it("clean when no orphans (no sample fetch)", async () => {
    const db = mockDb({ counts: {} }); // every count → 0
    getDb.mockResolvedValue(db);
    const report = await checkSoftRefIntegrity();
    expect(report.ok).toBe(true);
    expect(report.totalOrphans).toBe(0);
    expect(report.rules.every((r) => r.orphanCount === 0 && !r.skipped)).toBe(true);
    expect(report.rules.every((r) => r.sample.length === 0)).toBe(true);
    // 4 rules, each only the count query (no sample query since count=0)
    expect(db.execute).toHaveBeenCalledTimes(4);
  });

  it("DB absent → honest skipped result", async () => {
    getDb.mockResolvedValue(null);
    const report = await checkSoftRefIntegrity();
    expect(report.ok).toBe(true);
    expect(report.totalOrphans).toBe(0);
    expect(report.rules).toHaveLength(4);
    expect(report.rules.every((r) => r.skipped)).toBe(true);
  });

  it("isolates a per-rule query error (that rule skipped, others run)", async () => {
    getDb.mockResolvedValue(
      mockDb({ counts: {}, throwOn: "genealogy_chain" }),
    );
    const report = await checkSoftRefIntegrity();
    const genRule = report.rules.find((r) => r.rule.startsWith("genealogy_chain"));
    expect(genRule?.skipped).toBe(true);
    // the other three ran fine (not skipped)
    expect(report.rules.filter((r) => !r.skipped)).toHaveLength(3);
    expect(report.ok).toBe(true); // no orphans counted
  });
});
