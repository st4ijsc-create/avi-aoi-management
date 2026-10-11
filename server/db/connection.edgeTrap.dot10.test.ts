/**
 * doc 81 Đợt 10 task A — the edge-role DB trap in server/db/connection.ts (design §2.15).
 *
 * With AVI_PROCESS_ROLE=edge, getDb / getJobsDb / getReadDb never construct a postgres client, whatever DATABASE_URL /
 * DATABASE_READ_URL say:
 *   • default (production): they return null, log loudly ONCE and count every attempt (edgeDbTrapCount);
 *   • EDGE_DB_TRAP=throw (tests / CI): they throw EdgeDbTrapError (code EDGE_DB_TRAP).
 * The postgres driver is mocked so that a construction is OBSERVED (constructed counter), never a real connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructed: string[] = [];
vi.mock("postgres", () => ({
  default: (url: string) => {
    constructed.push(url);
    const fake = Object.assign(async () => [], { end: async () => undefined, options: { parsers: {}, serializers: {} } });
    return fake;
  },
}));
vi.mock("../queryMonitor", () => ({ instrumentPostgresClient: () => undefined }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (c: unknown) => ({ __fakeDb: true, c }) }));

const ENV_KEYS = ["AVI_PROCESS_ROLE", "EDGE_DB_TRAP", "DATABASE_URL", "DATABASE_READ_URL"] as const;
let saved: Record<string, string | undefined> = {};

async function freshConnection() {
  vi.resetModules();
  return import("./connection");
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  constructed.length = 0;
  process.env.DATABASE_URL = "postgresql://trap-probe:x@127.0.0.1:1/never_test";
  process.env.DATABASE_READ_URL = "postgresql://trap-probe:x@127.0.0.1:1/never_read_test";
  delete process.env.EDGE_DB_TRAP;
  delete process.env.AVI_PROCESS_ROLE;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("edge-role DB trap (AVI_PROCESS_ROLE=edge)", () => {
  it("default mode: getDb / getJobsDb / getReadDb return null, never construct a client, count every attempt", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = await freshConnection();
    expect(c.edgeDbTrapCount()).toBe(0);
    expect(await c.getDb()).toBeNull();
    expect(await c.getJobsDb()).toBeNull();
    expect(await c.getReadDb()).toBeNull();
    expect(await c.getDb()).toBeNull();
    expect(constructed).toEqual([]);
    expect(c.edgeDbTrapCount()).toBe(4);
    expect(c.edgeDbTrapStats()).toEqual({ count: 4, byAccessor: { getDb: 2, getJobsDb: 1, getReadDb: 1 } });
    // loud ONCE, not once per call
    const trapLogs = err.mock.calls.filter((a) => String(a[0]).includes("EDGE_DB_TRAP"));
    expect(trapLogs.length).toBe(1);
  });

  it("EDGE_DB_TRAP=throw: each accessor throws EdgeDbTrapError (code EDGE_DB_TRAP) and still constructs nothing", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    process.env.EDGE_DB_TRAP = "throw";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = await freshConnection();
    for (const fn of [c.getDb, c.getJobsDb, c.getReadDb]) {
      const e = await fn().then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(c.EdgeDbTrapError);
      expect((e as { code?: string }).code).toBe("EDGE_DB_TRAP");
    }
    expect(constructed).toEqual([]);
    expect(c.edgeDbTrapCount()).toBe(3);
  });

  it("the role is matched exactly (case / whitespace tolerant), a central process is unaffected", async () => {
    process.env.AVI_PROCESS_ROLE = " Edge ";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let c = await freshConnection();
    expect(c.isEdgeProcessRole()).toBe(true);
    expect(await c.getDb()).toBeNull();
    expect(constructed).toEqual([]);

    process.env.AVI_PROCESS_ROLE = "central";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    c = await freshConnection();
    expect(c.isEdgeProcessRole()).toBe(false);
    expect(await c.getDb()).not.toBeNull();
    expect(constructed.length).toBe(1);
    expect(c.edgeDbTrapCount()).toBe(0);
  });

  it("no role set: unchanged behaviour (a client is constructed lazily, once)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const c = await freshConnection();
    const a = await c.getDb();
    const b = await c.getDb();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(constructed).toEqual([process.env.DATABASE_URL]);
    expect(c.edgeDbTrapCount()).toBe(0);
  });

  it("an unknown EDGE_DB_TRAP value is the safe default (null), never 'allow'", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    process.env.EDGE_DB_TRAP = "off";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = await freshConnection();
    expect(await c.getDb()).toBeNull();
    expect(constructed).toEqual([]);
  });
});
