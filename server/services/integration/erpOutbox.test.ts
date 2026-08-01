/**
 * R0-4 (doc 16 §4 Khối 0) — durable outbound outbox worker tests.
 *
 * Drives drainOnce() against a minimal drizzle-shaped fake DB + a mocked fetch,
 * asserting:
 *   • exponential backoff increments attempts and pushes nextAttemptAt forward;
 *   • the per-endpoint circuit-breaker OPENS after the failure threshold;
 *   • a row that exhausts MAX_ATTEMPTS is dead-lettered (status='dead');
 *   • enqueueOutbox is idempotent on idempotencyKey (no second insert).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake DB capturing outbox rows + driving selects/updates ──────────────────
interface Row {
  id: number;
  eventType: string;
  payload: unknown;
  targetEndpoint: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  idempotencyKey: string | null;
  corporateCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
}
let outboxRows: Row[] = [];
let nextId = 1;
// Controls what the "due" select returns (the worker filters by status+time in SQL;
// our fake ignores predicates and just returns the current pending/failed rows).
function dueRows(): Row[] {
  return outboxRows.filter((r) => r.status === "pending" || r.status === "failed");
}

function makeFakeDb() {
  return {
    insert: (_table: any) => ({
      values: (vals: any) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        const inserted: Row[] = arr.map((v: any) => {
          const row: Row = {
            id: nextId++,
            eventType: v.eventType,
            payload: v.payload,
            targetEndpoint: v.targetEndpoint,
            status: v.status ?? "pending",
            attempts: v.attempts ?? 0,
            nextAttemptAt: v.nextAttemptAt ?? new Date(),
            lastError: v.lastError ?? null,
            idempotencyKey: v.idempotencyKey ?? null,
            corporateCode: v.corporateCode ?? null,
            createdAt: new Date(),
            sentAt: v.sentAt ?? null,
          };
          outboxRows.push(row);
          return row;
        });
        return {
          returning: async () => inserted.map((r) => ({ id: r.id })),
          // allow await without .returning()
          then: (res: any) => res(undefined),
        };
      },
    }),
    select: (_cols?: any) => ({
      from: (_table: any) => ({
        where: (_pred: any) => ({
          limit: async (_n: number) => {
            // enqueue idempotency lookup uses select({id}).from().where(eq(idem)).limit(1)
            // We can't see the predicate; return [] (no prior) unless a test sets it.
            return idemLookupResult;
          },
          orderBy: (_o: any) => ({
            limit: async (_n: number) => dueRows(),
          }),
        }),
        groupBy: async (_g: any) => [],
      }),
    }),
    update: (_table: any) => ({
      set: (vals: any) => ({
        where: async (pred: any) => {
          // pred is eq(id, X) → our fake eq returns [col, val]; id is the 2nd element.
          const id = Array.isArray(pred) ? pred[pred.length - 1] : undefined;
          const row = outboxRows.find((r) => r.id === id);
          if (row) Object.assign(row, vals);
        },
      }),
    }),
    delete: (_table: any) => ({ where: async () => undefined }),
  };
}

// Per-test override for the enqueue idempotency lookup.
let idemLookupResult: Array<{ id: number }> = [];

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../../drizzle/schema", () => ({
  integrationOutbox: {
    id: "id",
    status: "status",
    nextAttemptAt: "nextAttemptAt",
    idempotencyKey: "idempotencyKey",
    targetEndpoint: "targetEndpoint",
    eventType: "eventType",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => a,
  eq: (...a: any[]) => a,
  lte: (...a: any[]) => a,
  inArray: (...a: any[]) => a,
  sql: Object.assign((..._a: any[]) => ["sql"], { raw: (..._a: any[]) => ["sql"] }),
}));

import {
  enqueueOutbox,
  drainOnce,
  MAX_ATTEMPTS,
  BREAKER_FAILURE_THRESHOLD,
  breakerSnapshot,
  _resetBreakers,
} from "./erpOutbox";

const ENDPOINT = "https://erp.example.test/hook";

beforeEach(() => {
  outboxRows = [];
  nextId = 1;
  idemLookupResult = [];
  _resetBreakers();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function seedPending(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: nextId++,
    eventType: "quality-result",
    payload: { hello: "world" },
    targetEndpoint: ENDPOINT,
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(0),
    lastError: null,
    idempotencyKey: null,
    corporateCode: null,
    createdAt: new Date(),
    sentAt: null,
    ...overrides,
  };
  outboxRows.push(row);
  return row;
}

describe("R0-4 enqueueOutbox idempotency", () => {
  it("rejects an unknown eventType", async () => {
    const r = await enqueueOutbox({ eventType: "nope" as any, payload: {}, targetEndpoint: ENDPOINT });
    expect(r.ok).toBe(false);
  });

  it("inserts a pending row", async () => {
    const r = await enqueueOutbox({ eventType: "production-event", payload: { a: 1 }, targetEndpoint: ENDPOINT });
    expect(r.ok).toBe(true);
    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].status).toBe("pending");
  });

  it("returns the prior row for a duplicate idempotencyKey (no double insert)", async () => {
    // Simulate the prior row existing.
    idemLookupResult = [{ id: 42 }];
    const r = await enqueueOutbox({ eventType: "oee-metric", payload: {}, targetEndpoint: ENDPOINT, idempotencyKey: "k1" });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(r.id).toBe(42);
    expect(outboxRows.length).toBe(0); // nothing inserted
  });
});

describe("R0-4 drainOnce delivery + backoff", () => {
  it("marks a row sent on a 2xx", async () => {
    seedPending();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 }) as any));
    const res = await drainOnce(new Date());
    expect(res.sent).toBe(1);
    expect(outboxRows[0].status).toBe("sent");
    expect(outboxRows[0].attempts).toBe(1);
    expect(outboxRows[0].sentAt).toBeInstanceOf(Date);
  });

  it("increments attempts + schedules a future retry on failure (backoff)", async () => {
    const row = seedPending();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as any));
    const now = new Date();
    const res = await drainOnce(now);
    expect(res.failed).toBe(1);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(row.lastError).toContain("500");
  });
});

describe("R0-4 circuit-breaker", () => {
  it("opens after BREAKER_FAILURE_THRESHOLD consecutive failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as any));
    // Seed THRESHOLD distinct failing rows (so attempts don't dead-letter first)
    // each drain attempts the one due row; reset nextAttemptAt so it's due again.
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i++) {
      seedPending({ nextAttemptAt: new Date(0) });
    }
    // Drain once: all rows due, same endpoint → consecutive failures accumulate.
    await drainOnce(new Date());
    expect(breakerSnapshot()[ENDPOINT]).toBe("open");
  });

  it("skips delivery while the breaker is open", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i++) seedPending({ nextAttemptAt: new Date(0) });
    await drainOnce(new Date());
    expect(breakerSnapshot()[ENDPOINT]).toBe("open");
    const callsAfterOpen = fetchMock.mock.calls.length;
    // Add a fresh due row; with the breaker open it must NOT be delivered.
    seedPending({ nextAttemptAt: new Date(0) });
    const res = await drainOnce(new Date());
    expect(res.skippedByBreaker).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(callsAfterOpen); // no new fetch
  });
});

describe("R0-4 dead-letter", () => {
  it("moves a row to 'dead' once attempts reach MAX_ATTEMPTS", async () => {
    // A row already at MAX_ATTEMPTS-1 attempts → one more failure dead-letters it.
    const row = seedPending({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as any));
    const res = await drainOnce(new Date());
    expect(res.dead).toBe(1);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
  });
});
