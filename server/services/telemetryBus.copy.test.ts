/**
 * doc 48 R4 — OT ingest COPY fast path (telemetryBus.persistRows).
 *
 * Proves the COPY bulk-insert lever preserves EVERY existing semantic:
 *   (a) flag OFF  → byte-for-byte the .insert().onConflictDoNothing() path (COPY never
 *                   touched); the raw client is not begin()'d.
 *   (b) COPY path DEDUPS: a batch carrying an intra-batch duplicate + a row that already
 *       exists lands ONLY the new distinct rows, and still RETURNS the batch size
 *       ("persisted or already present") so store-and-forward never re-buffers a replay.
 *   (c) DB absent → returns 0 (unchanged degrade behaviour).
 *   + the pure COPY text-format SERIALIZER (escaping / NULL / types) is exact.
 *
 * The COPY path is exercised through a FAITHFUL in-memory $client mock that runs the REAL
 * production code (begin → CREATE TEMP → COPY .writable() → INSERT…SELECT…ON CONFLICT):
 * the mock DECODES the streamed COPY text back to rows (per the Postgres text-format spec)
 * and emulates the uq_ot_telemetry_device_metric_ts unique index (NULLS DISTINCT) with an
 * ON CONFLICT DO NOTHING. So the test drives the real serializer + wiring end-to-end, with
 * no live DB. (A real-Postgres benchmark + dedup proof is run separately; see the report.)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Writable } from "node:stream";

// TSDB disabled → main-DB fallback (the path under test).
vi.mock("../db/timescale", () => ({
  insertOtTelemetryRows: vi.fn(async () => null),
}));

// ── shared "physical table" + unique-index (deviceId, metric, ts) NULLS DISTINCT ──
const physicalRows: Array<Record<string, unknown>> = [];
const seenKeys = new Set<string>();

function tsMillis(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(v as string | number).getTime();
}
/** Natural key, or null when deviceId IS NULL (NULLS DISTINCT ⇒ never conflicts). */
function conflictKey(r: Record<string, unknown>): string | null {
  if (r.deviceId == null) return null;
  return `${String(r.deviceId)}|${String(r.metric)}|${tsMillis(r.ts)}`;
}
/** Emulate INSERT … ON CONFLICT DO NOTHING against the shared physical table. */
function insertOnConflictDoNothing(rows: Array<Record<string, unknown>>): void {
  for (const r of rows) {
    const k = conflictKey(r);
    if (k !== null && seenKeys.has(k)) continue; // conflict → skipped, never thrown
    if (k !== null) seenKeys.add(k);
    physicalRows.push(r);
  }
}

// ── COPY text-format DECODER (reverse of encodeCopyTextRow, to the Postgres spec) ──
const COPY_COL_ORDER = [
  "ts", "machineId", "deviceId", "protocol", "metric",
  "numValue", "textValue", "boolValue", "unit", "quality", "meta",
] as const;

/** Unescape a COPY text field left-to-right (spec-correct — NOT naive sequential replace). */
function unescapeCopyText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[++i];
      out += n === "n" ? "\n" : n === "r" ? "\r" : n === "t" ? "\t" : n === "\\" ? "\\" : n;
    } else {
      out += c;
    }
  }
  return out;
}
/** A field equal EXACTLY to the two chars `\N` is NULL; otherwise unescape. */
function decodeField(f: string): string | null {
  return f === "\\N" ? null : unescapeCopyText(f);
}
/** Decode the whole COPY text payload → rows. Splits on LITERAL tab/newline (data
 *  tabs/newlines are backslash-escaped, so this matches Postgres' own parse order). */
function decodeCopyText(text: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    const obj: Record<string, unknown> = {};
    COPY_COL_ORDER.forEach((col, idx) => {
      const raw = decodeField(parts[idx]);
      if (col === "ts") obj.ts = raw == null ? null : new Date(raw);
      else if (col === "machineId" || col === "numValue") obj[col] = raw == null ? null : Number(raw);
      else if (col === "boolValue") obj.boolValue = raw == null ? null : raw === "true";
      else if (col === "meta") obj.meta = raw == null ? null : JSON.parse(raw);
      else obj[col] = raw;
    });
    rows.push(obj);
  }
  return rows;
}

// ── faithful $client mock: begin → unsafe(CREATE/INSERT) + unsafe(COPY).writable() ──
const beginSpy = vi.fn();

function makeFakeClient() {
  return {
    unsafe: () => undefined, // top-level (only used by getCopyClient's shape check)
    async begin(fn: (sql: unknown) => Promise<unknown>) {
      beginSpy();
      const temp: Array<Record<string, unknown>> = []; // per-transaction TEMP table
      const txnSql = {
        unsafe(query: string) {
          // Awaitable (CREATE TEMP / INSERT…SELECT) AND exposes .writable() (COPY).
          return {
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
              return Promise.resolve()
                .then(() => {
                  if (/^\s*INSERT\s+INTO\s+ot_telemetry/i.test(query)) {
                    insertOnConflictDoNothing(temp); // temp → physical, deduped
                  }
                  // CREATE TEMP TABLE … → no-op (temp already reset per begin)
                })
                .then(res, rej);
            },
            async writable() {
              let acc = "";
              return new Writable({
                write(chunk, _enc, cb) {
                  acc += chunk.toString();
                  cb();
                },
                final(cb) {
                  for (const row of decodeCopyText(acc)) temp.push(row);
                  cb();
                },
              });
            },
          };
        },
      };
      return fn(txnSql);
    },
  };
}

// Controllable main-DB: drizzle .insert().values().onConflictDoNothing() funnels into the
// SAME physical table so both paths are comparable; `$client` is the faithful COPY mock.
let dbPresent = true;
const insertValues = vi.fn((rows: Array<Record<string, unknown>>) => ({
  onConflictDoNothing: async () => insertOnConflictDoNothing(rows),
}));
const fakeDb = {
  insert: () => ({ values: insertValues }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  $client: makeFakeClient(),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => (dbPresent ? fakeDb : null)) }));
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, toCanonicalRow, encodeCopyTextRow, type CanonicalSample } from "./telemetryBus";

function sample(tsMillisVal: number, over: Partial<CanonicalSample> = {}): CanonicalSample {
  return {
    ts: new Date(tsMillisVal),
    machineId: 5, // pre-resolved → no machineId DB lookup
    deviceId: "ADP-1",
    protocol: "modbus",
    metric: "temperature",
    value: 42,
    meta: { adapterId: 1, tagKey: "temperature" },
    ...over,
  };
}

beforeEach(() => {
  physicalRows.length = 0;
  seenKeys.clear();
  insertValues.mockClear();
  beginSpy.mockClear();
  dbPresent = true;
  delete process.env.TELEMETRY_BATCH_ENABLED;
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_INGEST_COPY_ENABLED;
  delete process.env.OT_INGEST_COPY_MIN_ROWS;
});

describe("R4 — encodeCopyTextRow (pure COPY text-format serializer)", () => {
  /** Split a serialized line into its 11 fields (safe: data tabs/newlines are escaped). */
  function fieldsOf(r: Parameters<typeof encodeCopyTextRow>[0]): string[] {
    const line = encodeCopyTextRow(r);
    expect(line.endsWith("\n")).toBe(true);
    return line.slice(0, -1).split("\t");
  }

  it("numeric value + meta + explicit nulls → correct fields, \\N for NULLs", () => {
    const r = toCanonicalRow(
      { ts: new Date("2026-01-02T03:04:05.678Z"), deviceId: "d1", protocol: "modbus", metric: "temp", value: 42.5, unit: "C", meta: { a: 1 } },
      7,
    );
    const f = fieldsOf(r);
    expect(f).toHaveLength(11);
    expect(f[0]).toBe("2026-01-02T03:04:05.678Z"); // ts ISO-8601
    expect(f[1]).toBe("7"); // machineId
    expect(f[2]).toBe("d1"); // deviceId
    expect(f[3]).toBe("modbus"); // protocol
    expect(f[4]).toBe("temp"); // metric
    expect(f[5]).toBe("42.5"); // numValue
    expect(f[6]).toBe("\\N"); // textValue NULL
    expect(f[7]).toBe("\\N"); // boolValue NULL
    expect(f[8]).toBe("C"); // unit
    expect(f[9]).toBe("good"); // quality default
    expect(f[10]).toBe('{"a":1}'); // meta jsonb
  });

  it("commas + quotes pass through unescaped (text format); newline/tab/backslash escape", () => {
    const r = toCanonicalRow(
      { ts: new Date(0), protocol: "mqtt", metric: "m", deviceId: 'd,q"c', value: "line1\nline2\tx\\y" },
      null,
    );
    const f = fieldsOf(r);
    expect(f[1]).toBe("\\N"); // machineId null (unmapped)
    expect(f[2]).toBe('d,q"c'); // comma + quote are literal in TEXT format
    expect(f[6]).toBe("line1\\nline2\\tx\\\\y"); // \n \t \\ escaped
    // and the serialized line has exactly ONE real newline (the row terminator)
    expect(encodeCopyTextRow(r).match(/\n/g)).toHaveLength(1);
  });

  it("boolean → true/false (numValue NULL); string value → textValue (numValue NULL)", () => {
    const b = fieldsOf(toCanonicalRow({ ts: new Date(0), protocol: "opcua", metric: "run", value: true }, 1));
    expect(b[5]).toBe("\\N"); // numValue
    expect(b[7]).toBe("true"); // boolValue
    const s = fieldsOf(toCanonicalRow({ ts: new Date(0), protocol: "opcua", metric: "state", value: "OK" }, 1));
    expect(s[5]).toBe("\\N"); // numValue
    expect(s[6]).toBe("OK"); // textValue
  });

  it("meta with quotes/backslashes round-trips through the COPY text escaping", () => {
    const meta = { a: 'x"y\\z', nested: { t: "a\tb", n: "l1\nl2" } };
    const r = toCanonicalRow({ ts: new Date(0), protocol: "mqtt", metric: "m", value: 1, meta }, 1);
    const f = encodeCopyTextRow(r).slice(0, -1).split("\t");
    expect(JSON.parse(unescapeCopyText(f[10]))).toEqual(meta);
  });
});

describe("R4 — persistRows COPY fast path (flag-gated, dedup, contract)", () => {
  it("(a) flag OFF → INSERT path, COPY (begin) never touched", async () => {
    // default: OT_INGEST_COPY_ENABLED unset
    const persisted = await ingestTelemetry([sample(1000)]);
    expect(persisted).toBe(1);
    expect(insertValues).toHaveBeenCalledTimes(1); // drizzle .values() path used
    expect(beginSpy).not.toHaveBeenCalled(); // COPY path NOT entered
    expect(physicalRows).toHaveLength(1);
  });

  it("flag ON but batch below threshold → still INSERT path (COPY not worth it)", async () => {
    process.env.OT_INGEST_COPY_ENABLED = "true";
    process.env.OT_INGEST_COPY_MIN_ROWS = "5";
    const persisted = await ingestTelemetry([sample(1000), sample(2000)]); // 2 < 5
    expect(persisted).toBe(2);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(beginSpy).not.toHaveBeenCalled();
  });

  it("(b) flag ON + batch ≥ threshold → COPY path DEDUPS (intra-batch + pre-existing)", async () => {
    process.env.OT_INGEST_COPY_ENABLED = "true";
    process.env.OT_INGEST_COPY_MIN_ROWS = "1"; // force COPY for the small test batch

    // Seed a pre-existing row at ts=1000 via COPY.
    const seed = await ingestTelemetry([sample(1000)]);
    expect(seed).toBe(1);
    expect(beginSpy).toHaveBeenCalledTimes(1); // COPY used
    expect(insertValues).not.toHaveBeenCalled(); // NOT the drizzle path
    expect(physicalRows).toHaveLength(1);

    // Batch: dup of pre-existing (1000) + an intra-batch duplicate (2000 twice) + fresh (3000).
    const persisted = await ingestTelemetry([sample(1000), sample(2000), sample(2000), sample(3000)]);
    expect(persisted).toBe(4); // RETURNS batch size (persisted-or-already-present)

    // Only the NEW distinct rows landed: 2000 once + 3000. 1000 pre-existed; 2nd 2000 deduped.
    expect(physicalRows).toHaveLength(3);
    expect(physicalRows.map((r) => tsMillis(r.ts)).sort((a, b) => a - b)).toEqual([1000, 2000, 3000]);
    // and the streamed values decoded correctly (numValue round-tripped through COPY text).
    expect(physicalRows.every((r) => r.numValue === 42)).toBe(true);
    expect(physicalRows.every((r) => r.deviceId === "ADP-1" && r.protocol === "modbus")).toBe(true);
  });

  it("COPY path with NULL deviceId does NOT dedup (uq index is NULLS DISTINCT)", async () => {
    process.env.OT_INGEST_COPY_ENABLED = "true";
    process.env.OT_INGEST_COPY_MIN_ROWS = "1";
    // Two unmapped-device rows, same (metric, ts) → both must land (NULL deviceId ≠ NULL).
    const rows = [
      sample(9000, { deviceId: null }),
      sample(9000, { deviceId: null }),
    ];
    const persisted = await ingestTelemetry(rows);
    expect(persisted).toBe(2);
    expect(physicalRows).toHaveLength(2); // NOT deduped
  });

  it("(c) DB absent → returns 0 (COPY flag ON does not change degrade behaviour)", async () => {
    process.env.OT_INGEST_COPY_ENABLED = "true";
    process.env.OT_INGEST_COPY_MIN_ROWS = "1";
    dbPresent = false;
    const persisted = await ingestTelemetry([sample(1000), sample(2000)]);
    expect(persisted).toBe(0);
    expect(beginSpy).not.toHaveBeenCalled();
    expect(physicalRows).toHaveLength(0);
  });
});
