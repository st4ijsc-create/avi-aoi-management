/**
 * W4-D (doc 27 §8 gap B5) — DB pool sizing configuration tests.
 *
 * resolvePoolMax / resolveJobsPoolMax are pure env readers (no connection is
 * opened here); getDb/getJobsDb pass them as postgres-js `max`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolvePoolMax, resolveJobsPoolMax } from "./connection";

const ENV_KEYS = ["DB_POOL_MAX", "DB_POOL_MAX_JOBS"] as const;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

describe("resolvePoolMax (primary/API pool)", () => {
  it("defaults to 25 (doc 27 B5: raised from the hard-coded 10)", () => {
    delete process.env.DB_POOL_MAX;
    expect(resolvePoolMax()).toBe(25);
  });

  it("respects DB_POOL_MAX", () => {
    process.env.DB_POOL_MAX = "40";
    expect(resolvePoolMax()).toBe(40);
  });

  it("ignores invalid values (non-numeric, zero, negative)", () => {
    process.env.DB_POOL_MAX = "abc";
    expect(resolvePoolMax()).toBe(25);
    process.env.DB_POOL_MAX = "0";
    expect(resolvePoolMax()).toBe(25);
    process.env.DB_POOL_MAX = "-5";
    expect(resolvePoolMax()).toBe(25);
  });
});

describe("resolveJobsPoolMax (background-jobs pool)", () => {
  it("defaults to 8 and is independent from DB_POOL_MAX", () => {
    delete process.env.DB_POOL_MAX_JOBS;
    process.env.DB_POOL_MAX = "50";
    expect(resolveJobsPoolMax()).toBe(8);
  });

  it("respects DB_POOL_MAX_JOBS", () => {
    process.env.DB_POOL_MAX_JOBS = "4";
    expect(resolveJobsPoolMax()).toBe(4);
  });

  it("ignores invalid values", () => {
    process.env.DB_POOL_MAX_JOBS = "zero";
    expect(resolveJobsPoolMax()).toBe(8);
  });
});
