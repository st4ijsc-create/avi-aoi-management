/**
 * doc 81 Đợt 1B Task 7 — telemetryBus: lô lớn chia khối, `ts` hỏng bị loại RIÊNG, kết quả
 * trung thực (accepted chỉ đếm dòng đã lưu), mẫu hỏng không vào WAL.
 *
 * ORACLE ĐỘC LẬP: DB giả dưới đây KHÔNG gọi mã sản phẩm — nó mô phỏng ĐÚNG HAI quy tắc của
 * Postgres/postgres.js theo tài liệu:
 *   (1) một câu lệnh mang tối đa 65535 tham số bind (giao thức wire dùng Int16 cho số tham số) —
 *       INSERT ot_telemetry mang 11 cột/dòng (id + ingestedAt do DB sinh) ⇒ quá 65535 ⇒ ném;
 *   (2) chuỗi chứa byte NUL bị Postgres từ chối với SQLSTATE 22P05 (untranslatable_character) —
 *       lỗi thuộc lớp 22 "data exception", KHÁC lỗi mất kết nối.
 * Giả lập bị bóp đúng như thế thì số 7.000 mẫu ⇒ `accepted:0` đo ở BE3 tái hiện được ở đây.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

vi.mock("../db/timescale", () => ({
  insertOtTelemetryRows: vi.fn(async () => null), // TSDB tắt ⇒ đường DB chính
}));

const PG_MAX_BIND_PARAMS = 65535;
const COLS_PER_ROW = 11;

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  mode: "up" as "up" | "down" | "absent",
  /** ném ECONNREFUSED ở câu INSERT thứ N (1-based) — 0 = không ném */
  failOnCall: 0,
  calls: 0,
  statements: [] as number[], // số dòng mỗi câu INSERT đã THÀNH CÔNG
  stored: [] as Row[],
}));

function pgInsert(rows: Row[]): void {
  db.calls += 1;
  if (db.mode === "down") throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { code: "ECONNREFUSED" });
  if (db.failOnCall > 0 && db.calls === db.failOnCall) {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { code: "ECONNREFUSED" });
  }
  if (rows.length * COLS_PER_ROW > PG_MAX_BIND_PARAMS) {
    throw Object.assign(new Error(`Max number of parameters (${PG_MAX_BIND_PARAMS}) exceeded`), {
      code: "MAX_PARAMETERS_EXCEEDED",
    });
  }
  for (const r of rows) {
    for (const v of Object.values(r)) {
      if (typeof v === "string" && v.includes("\u0000")) {
        // drizzle bọc lỗi postgres.js trong DrizzleQueryError, SQLSTATE nằm ở `cause.code`.
        throw Object.assign(new Error("Failed query: insert into \"ot_telemetry\" …"), {
          cause: Object.assign(new Error("unsupported Unicode escape sequence"), { code: "22P05" }),
        });
      }
    }
  }
  db.statements.push(rows.length);
  db.stored.push(...rows);
}

const fakeDb = {
  insert: () => ({
    values: (rows: Row[]) => ({ onConflictDoNothing: async () => pgInsert(rows) }),
  }),
  select: () => ({ from: () => ({ where: async () => [] }) }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => (db.mode === "absent" ? null : fakeDb)) }));
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, ingestTelemetryDetailed, wireStoreForward, type CanonicalSample } from "./telemetryBus";
import { _reset, bufferedCount, backfill, getStatus } from "./ot/storeForward";
import { _resetLogGop, _resetTsDropStats } from "./ot/otGuards";

const NOW = Date.now();
function s(i: number, over: Partial<CanonicalSample> = {}): CanonicalSample {
  return {
    ts: new Date(NOW - 60_000 + i), // quá khứ gần, duy nhất theo i
    machineId: 7,
    deviceId: "T7-DEV",
    protocol: "modbus",
    metric: "temp",
    value: i,
    ...over,
  };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => s(i));

let walPath: string;
beforeEach(() => {
  walPath = path.join(os.tmpdir(), `t7-bus-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.OT_STORE_FORWARD_FILE = walPath;
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_INGEST_MAX_FUTURE_SKEW_MS;
  delete process.env.OT_STORE_FORWARD_DRAIN_BATCH;
  db.mode = "up";
  db.failOnCall = 0;
  db.calls = 0;
  db.statements.length = 0;
  db.stored.length = 0;
  _reset();
  _resetLogGop();
  _resetTsDropStats();
});
afterEach(async () => {
  _reset();
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
  await fs.rm(walPath, { force: true });
  await fs.rm(walPath + ".corrupt", { force: true });
});

describe("T7 — lô lớn được CHIA KHỐI (không vượt trần tham số bind)", () => {
  it("★ 7.000 mẫu qua đường cũ ingestTelemetry ⇒ lưu đủ 7.000 (trước: 0)", async () => {
    const n = await ingestTelemetry(many(7000));
    expect(n).toBe(7000);
    expect(db.stored.length).toBe(7000);
    expect(Math.max(...db.statements)).toBeLessThanOrEqual(1000);
  });

  it("★ 12.000 mẫu qua ingestTelemetryDetailed ⇒ accepted 12.000, rejected rỗng, 12 câu ≤1000 dòng", async () => {
    const r = await ingestTelemetryDetailed(many(12000));
    expect(r).toEqual({ received: 12000, accepted: 12000, rejected: [] });
    expect(db.statements).toEqual(Array(12).fill(1000));
  });

  it("một khối lỗi DB giữa chừng ⇒ accepted đếm ĐÚNG khối đã lưu, phần còn lại db_error (không bao giờ nói dối)", async () => {
    db.failOnCall = 2; // khối 2 (dòng 1000..1999) sập kết nối
    const r = await ingestTelemetryDetailed(many(3000));
    expect(r.accepted).toBe(1000);
    expect(db.stored.length).toBe(1000);
    expect(r.rejected.length).toBe(2000);
    expect(r.rejected[0]).toEqual({ index: 1000, reason: "db_error" });
    expect(r.rejected[1999]).toEqual({ index: 2999, reason: "db_error" });
  });

  it("DB vắng (getDb null) ⇒ accepted 0, MỌI mẫu db_error", async () => {
    db.mode = "absent";
    const r = await ingestTelemetryDetailed(many(5));
    expect(r.accepted).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(Array(5).fill("db_error"));
  });
});

describe("T7 — `ts` hỏng bị loại RIÊNG, không làm hỏng lô", () => {
  it("★ đường cũ: một mẫu ts hỏng KHÔNG làm ném cả lô (trước: RangeError ⇒ 500)", async () => {
    const batch = [s(0), s(1, { ts: new Date("không-phải-ngày") }), s(2)];
    const n = await ingestTelemetry(batch);
    expect(n).toBe(2);
    expect(db.stored.length).toBe(2);
  });

  it("★ lô 10 mẫu, 3 ts sai ⇒ đúng 3 chỉ số bị loại, kèm lý do", async () => {
    const batch = many(10);
    batch[2] = s(2, { ts: new Date("2026-13-45T99:99:99Z") });
    batch[5] = s(5, { ts: new Date(NaN) });
    batch[9] = s(9, { ts: new Date(NOW + 3 * 86_400_000) }); // 3 ngày tương lai
    const r = await ingestTelemetryDetailed(batch);
    expect(r.accepted).toBe(7);
    expect(r.rejected).toEqual([
      { index: 2, reason: "invalid_ts" },
      { index: 5, reason: "invalid_ts" },
      { index: 9, reason: "ts_too_far_future" },
    ]);
    expect(db.stored.length).toBe(7);
  });

  it("ngưỡng tương lai mặc định 24 h và cấu hình được (OT_INGEST_MAX_FUTURE_SKEW_MS)", async () => {
    const r1 = await ingestTelemetryDetailed([s(0, { ts: new Date(NOW + 23 * 3_600_000) })]);
    expect(r1.accepted).toBe(1);
    process.env.OT_INGEST_MAX_FUTURE_SKEW_MS = String(60_000);
    const r2 = await ingestTelemetryDetailed([s(1, { ts: new Date(NOW + 5 * 60_000) })]);
    expect(r2.rejected).toEqual([{ index: 0, reason: "ts_too_far_future" }]);
  });

  it("thiếu ts vẫn = now (hành vi cũ giữ nguyên)", async () => {
    const r = await ingestTelemetryDetailed([s(0, { ts: undefined })]);
    expect(r.accepted).toBe(1);
    expect(db.stored[0].ts).toBeInstanceOf(Date);
  });
});

describe("T7 — mẫu hỏng KHÔNG vào WAL", () => {
  it("★ store-forward BẬT + DB sập + lô có ts hỏng ⇒ WAL chỉ chứa mẫu tốt và đọc lại được trọn", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    db.mode = "down";
    const batch = [s(0), s(1, { ts: new Date("rác") }), s(2)];
    await ingestTelemetry(batch);
    expect(bufferedCount()).toBe(2);
    const raw = await fs.readFile(walPath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);
    for (const l of lines) {
      const p = JSON.parse(l);
      expect(Number.isFinite(new Date(p.row.ts).getTime())).toBe(true);
    }
  });

  it("một khối sập ⇒ chỉ các dòng CHƯA lưu vào WAL (không đệm dòng đã lưu)", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    db.failOnCall = 2;
    await ingestTelemetryDetailed(many(2500));
    expect(bufferedCount()).toBe(1500);
  });

  it("★ lỗi DỮ LIỆU (SQLSTATE lớp 22) chỉ loại đúng dòng đó (invalid_value), không đệm vào WAL", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    const batch = many(5);
    batch[3] = s(3, { metric: "te\u0000mp" });
    const r = await ingestTelemetryDetailed(batch);
    expect(r.accepted).toBe(4);
    expect(r.rejected).toEqual([{ index: 3, reason: "invalid_value" }]);
    expect(db.stored.length).toBe(4);
    expect(bufferedCount()).toBe(0);
  });
});

describe("T7 — nhánh anh em: backfill store-forward cũng chia khối", () => {
  it("★ lô xả WAL 7.000 dòng (OT_STORE_FORWARD_DRAIN_BATCH=7000) ⇒ lưu đủ, không kẹt vĩnh viễn", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    process.env.OT_STORE_FORWARD_DRAIN_BATCH = "7000";
    db.mode = "down";
    await ingestTelemetry(many(7000)); // DB sập ⇒ 7.000 dòng vào WAL
    expect(bufferedCount()).toBe(7000);
    db.mode = "up";
    db.calls = 0;
    await wireStoreForward();
    const r = await backfill();
    expect(r.drained).toBe(7000);
    expect(bufferedCount()).toBe(0);
    expect(Math.max(...db.statements)).toBeLessThanOrEqual(1000);
  });
});

describe("T7 fix r1 — backfill không ghi lại khối đã lưu khi khối SAU hỏng", () => {
  it("★ drain batch 2500, khối 2 sập kết nối ⇒ sau khi DB hồi, tổng dòng lưu = 2500 (không trùng)", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    process.env.OT_STORE_FORWARD_DRAIN_BATCH = "2500";
    db.mode = "down";
    await ingestTelemetry(Array.from({ length: 2500 }, (_, i) => s(i, { deviceId: null })));
    expect(bufferedCount()).toBe(2500);
    db.mode = "up";
    db.calls = 0;
    db.failOnCall = 2;
    await wireStoreForward();
    await backfill();
    db.failOnCall = 0;
    await backfill();
    expect(bufferedCount()).toBe(0);
    expect(db.stored.length).toBe(2500);
    expect(new Set(db.stored.map((r) => r.numValue)).size).toBe(2500);
  });
});

describe("T7 fix r1 — bộ đếm tích luỹ mẫu bị cổng ts loại", () => {
  it("★ droppedInvalidTs / droppedFutureSkew cộng dồn qua cả hai đường ingest, hiện ở getStatus()", async () => {
    await ingestTelemetry([s(0), s(1, { ts: new Date("rác") }), s(2, { ts: new Date(NOW + 3 * 86_400_000) })]);
    await ingestTelemetryDetailed([s(3, { ts: new Date(NaN) }), s(4, { ts: new Date(NaN) }), s(5)]);
    const st = getStatus();
    expect(st.droppedInvalidTs).toBe(3);
    expect(st.droppedFutureSkew).toBe(1);
  });
});
