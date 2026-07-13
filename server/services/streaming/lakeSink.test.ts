/**
 * doc 48 R3 — LakeSink pure-core tests (no NATS, no FS side effects).
 *   • aspectOfTopic: subject → aspect partition key
 *   • partitionOf: Hive-style UTC date/hour/aspect
 *   • messageToRows: sample[] expansion + provenance + event-time
 *   • ndjsonGzip: gunzip round-trip is loss-free NDJSON
 *   • partFileName: deterministic (idempotent-ish) + seq-sensitive
 *   • groupRowsByPartition: splits across the hour boundary
 */
import { describe, it, expect } from "vitest";
import { gunzipSync } from "zlib";
import {
  aspectOfTopic,
  partitionOf,
  messageToRows,
  ndjsonGzip,
  partFileName,
  groupRowsByPartition,
  type LakeRow,
} from "./lakeSink";
import type { StreamMessage } from "./streamBridge";

describe("aspectOfTopic", () => {
  it("uses the 2nd subject segment as the aspect", () => {
    expect(aspectOfTopic("syn/telemetry/l1")).toBe("telemetry");
    expect(aspectOfTopic("syn/derived/_line/sim/sim/l1")).toBe("derived");
  });
  it("falls back honestly for unexpected topics", () => {
    expect(aspectOfTopic("weird")).toBe("weird");
    expect(aspectOfTopic("")).toBe("unknown");
  });
});

describe("partitionOf", () => {
  it("builds a Hive-style UTC partition dir", () => {
    // 2026-07-13T05:34:00Z
    const ms = Date.UTC(2026, 6, 13, 5, 34, 0);
    const p = partitionOf(ms, "telemetry");
    expect(p.date).toBe("2026-07-13");
    expect(p.hour).toBe("05");
    expect(p.aspect).toBe("telemetry");
    expect(p.dir).toBe("date=2026-07-13/hour=05/aspect=telemetry");
  });
  it("defaults a missing aspect to 'unknown'", () => {
    expect(partitionOf(Date.UTC(2026, 0, 1, 0, 0, 0), "").aspect).toBe("unknown");
  });
});

describe("messageToRows", () => {
  const baseMsg = (payload: unknown): StreamMessage => ({
    topic: "syn/telemetry/l1",
    seq: 42,
    ts: Date.UTC(2026, 6, 13, 5, 0, 0),
    payload,
  });

  it("expands an array payload into one row per sample with provenance", () => {
    const eventTs = new Date(Date.UTC(2026, 6, 13, 5, 30, 0)).toISOString();
    const rows = messageToRows(
      baseMsg([
        { deviceId: "d1", metric: "temp", value: 10, ts: eventTs },
        { deviceId: "d2", metric: "temp", value: 20, ts: eventTs },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]._topic).toBe("syn/telemetry/l1");
    expect(rows[0]._seq).toBe(42);
    expect(rows[0]._aspect).toBe("telemetry");
    expect(rows[0]._event_ts).toBe(eventTs);
    expect(rows[0].deviceId).toBe("d1");
    // ingest time comes from the message publish ts
    expect(rows[0]._ingest_ts).toBe(new Date(Date.UTC(2026, 6, 13, 5, 0, 0)).toISOString());
  });

  it("falls back to ingest time when a sample has no ts", () => {
    const rows = messageToRows(baseMsg([{ deviceId: "d1", metric: "x", value: 1 }]));
    expect(rows[0]._event_ts).toBe(rows[0]._ingest_ts);
  });

  it("wraps a non-array payload as a single row", () => {
    const rows = messageToRows(baseMsg({ path: "l1/_line", state: "EXECUTE" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("EXECUTE");
  });
});

describe("ndjsonGzip", () => {
  it("round-trips loss-free through gunzip as NDJSON", () => {
    const rows: LakeRow[] = [
      { _topic: "t", _seq: 1, _aspect: "telemetry", _ingest_ts: "i", _event_ts: "e", value: 1 },
      { _topic: "t", _seq: 2, _aspect: "telemetry", _ingest_ts: "i", _event_ts: "e", value: 2 },
    ];
    const buf = ndjsonGzip(rows);
    const lines = gunzipSync(buf).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ _seq: 1, value: 1 });
    expect(JSON.parse(lines[1])).toMatchObject({ _seq: 2, value: 2 });
  });
});

describe("partFileName", () => {
  const rows = (seqs: number[]): LakeRow[] =>
    seqs.map((s) => ({ _topic: "syn/telemetry/l1", _seq: s, _aspect: "telemetry", _ingest_ts: "i", _event_ts: "e" }));

  it("is deterministic for the same batch (idempotent-ish re-write)", () => {
    expect(partFileName("lake_sink", rows([3, 4, 5]))).toBe(partFileName("lake_sink", rows([3, 4, 5])));
  });
  it("encodes the seq range and differs when the batch differs", () => {
    const a = partFileName("lake_sink", rows([3, 4, 5]));
    expect(a).toMatch(/^part-lake_sink-3-5-[0-9a-f]{8}\.ndjson\.gz$/);
    expect(a).not.toBe(partFileName("lake_sink", rows([6, 7, 8])));
  });
});

describe("groupRowsByPartition", () => {
  it("splits rows across the UTC hour boundary", () => {
    const rows: LakeRow[] = [
      {
        _topic: "syn/telemetry/l1",
        _seq: 1,
        _aspect: "telemetry",
        _ingest_ts: "i",
        _event_ts: new Date(Date.UTC(2026, 6, 13, 5, 59, 0)).toISOString(),
      },
      {
        _topic: "syn/telemetry/l1",
        _seq: 2,
        _aspect: "telemetry",
        _ingest_ts: "i",
        _event_ts: new Date(Date.UTC(2026, 6, 13, 6, 1, 0)).toISOString(),
      },
    ];
    const groups = groupRowsByPartition(rows);
    expect(groups.size).toBe(2);
    expect([...groups.keys()].sort()).toEqual([
      "date=2026-07-13/hour=05/aspect=telemetry",
      "date=2026-07-13/hour=06/aspect=telemetry",
    ]);
  });
});
