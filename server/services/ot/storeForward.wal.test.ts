/**
 * doc 81 Đợt 1B Task 7 — WAL store-and-forward: ghi NGUYÊN TỬ, mẫu hỏng bị CÁCH LY.
 *
 * ĐO (BE3 §L4, storeForward.ts:166, 171-184 ở HEAD trước task): WAL ghi đè TOÀN tệp bằng
 * `fs.writeFile` — không tệp tạm, không fsync, không rename ⇒ tiến trình chết giữa lúc ghi để lại
 * tệp CỤT; một dòng có `ts` hỏng làm `entryToLine` ném ⇒ MỌI lần ghi WAL sau đó hỏng; `restore`
 * nhận dòng `ts` hỏng vào hàng đợi ⇒ lô xả chứa nó ném mãi ⇒ các dòng tốt phía sau KẸT VĨNH VIỄN.
 *
 * Mọi tệp ở thư mục tạm riêng của test (KHÔNG bao giờ đường WAL thật). "Chết giữa lúc ghi" được
 * mô phỏng bằng cách NÉM ở giữa: (a) giữa ghi xong tệp tạm và rename; (b) giữa chừng lúc ghi byte.
 * Oracle: nội dung tệp WAL đọc trực tiếp từ đĩa (so byte với bản trước), không qua mã sản phẩm.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InsertOtTelemetry } from "../../../drizzle/schema/ot";
import { buffer, backfill, restore, bufferedCount, getStatus, setInsertFn, _reset } from "./storeForward";
import { _resetLogGop } from "./otGuards";

function row(tag: string, tsMillis: number, extra: Partial<InsertOtTelemetry> = {}): InsertOtTelemetry {
  return {
    ts: new Date(tsMillis),
    machineId: null,
    deviceId: "ADP-1",
    protocol: "modbus",
    metric: tag,
    numValue: 1,
    textValue: null,
    boolValue: null,
    unit: null,
    quality: "good",
    meta: { adapterId: 1, tagKey: tag },
    ...extra,
  };
}

let dir: string;
let wal: string;
const walLines = async () =>
  (await fsp.readFile(wal, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { key: string; row: { metric: string; ts: string } });

/** FileHandle.prototype — nơi `sync`/`writeFile` thật sống (spy được, không mock module). */
async function fileHandleProto(): Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> {
  const fh = await fsp.open(path.join(dir, "probe"), "w");
  const proto = Object.getPrototypeOf(fh);
  await fh.close();
  return proto;
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "t7-wal-"));
  wal = path.join(dir, "ot-store-forward.jsonl");
  process.env.OT_STORE_FORWARD_FILE = wal;
  process.env.OT_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_DRAIN_BATCH;
  _reset();
  _resetLogGop();
});
afterEach(async () => {
  vi.restoreAllMocks();
  _reset();
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("T7 — WAL ghi nguyên tử (tệp tạm + fsync + rename)", () => {
  it("★ chết GIỮA ghi-tệp-tạm và rename ⇒ tệp WAL cũ còn NGUYÊN từng byte", async () => {
    await buffer([row("a", 1000)]);
    const before = await fsp.readFile(wal);
    const rename = vi.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("mô phỏng: tiến trình chết trước rename"));
    await buffer([row("b", 2000)]);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(await fsp.readFile(wal), before)).toBe(0);
    // hàng đợi trong RAM vẫn giữ cả hai; lần ghi kế tiếp đưa đủ xuống đĩa
    rename.mockRestore();
    await buffer([row("c", 3000)]);
    expect((await walLines()).map((l) => l.row.metric)).toEqual(["a", "b", "c"]);
  });

  it("★ chết GIỮA lúc ghi byte (ghi được nửa rồi ném) ⇒ tệp WAL cũ còn nguyên", async () => {
    await buffer([row("a", 1000), row("b", 2000)]);
    const before = await fsp.readFile(wal);
    const proto = await fileHandleProto();
    const orig = proto.writeFile;
    vi.spyOn(proto, "writeFile").mockImplementationOnce(async function (this: unknown, data: unknown) {
      await orig.call(this, String(data).slice(0, 17)); // nửa dòng đầu
      throw new Error("mô phỏng: ENOSPC / kill giữa lúc ghi");
    });
    await buffer([row("c", 3000)]);
    expect(Buffer.compare(await fsp.readFile(wal), before)).toBe(0);
    const left = (await fsp.readdir(dir)).filter((f) => f !== "ot-store-forward.jsonl" && f !== "probe");
    expect(left).toEqual([]); // tệp tạm hỏng đã dọn
  });

  it("★ fsync tệp tạm TRƯỚC rename", async () => {
    const proto = await fileHandleProto();
    const order: string[] = [];
    const origSync = proto.sync;
    vi.spyOn(proto, "sync").mockImplementation(async function (this: unknown) {
      order.push("sync");
      return origSync.call(this);
    });
    const origRename = fsp.rename;
    vi.spyOn(fsp, "rename").mockImplementation(async (a, b) => {
      order.push("rename");
      return origRename(a, b);
    });
    await buffer([row("a", 1000)]);
    // (POSIX còn fsync THƯ MỤC sau rename — Windows không mở được thư mục nên bỏ bước ấy)
    expect(order.slice(0, 2)).toEqual(["sync", "rename"]);
  });

  it("20 lượt buffer song song ⇒ tệp cuối cùng chứa đủ 20 dòng (ghi được tuần tự hoá)", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => buffer([row(`t${i}`, 1000 + i)])));
    expect((await walLines()).length).toBe(20);
  });
});

describe("T7 — mẫu hỏng bị CÁCH LY, không chặn các mẫu sau", () => {
  it("★ buffer() từ chối dòng ts hỏng — WAL chỉ chứa dòng tốt và vẫn ghi được", async () => {
    const added = await buffer([row("a", 1000), row("bad", NaN), row("c", 3000)]);
    expect(added).toBe(2);
    expect((await walLines()).map((l) => l.row.metric)).toEqual(["a", "c"]);
    expect(getStatus().rejectedInvalid).toBe(1);
    await buffer([row("d", 4000)]); // lần ghi SAU vẫn chạy (trước: mọi lần ghi sau đều hỏng)
    expect((await walLines()).map((l) => l.row.metric)).toEqual(["a", "c", "d"]);
  });

  it("dòng không tuần tự hoá được (BigInt trong meta) bị cách ly khi ghi, các dòng khác vẫn xuống đĩa", async () => {
    await buffer([row("a", 1000), row("big", 2000, { meta: { adapterId: 1, tagKey: "big", n: BigInt(1) } }), row("c", 3000)]);
    expect((await walLines()).map((l) => l.row.metric)).toEqual(["a", "c"]);
    expect(getStatus().quarantined).toBe(1);
    expect(bufferedCount()).toBe(2);
  });

  it("★ restore: dòng hỏng (JSON cụt, ts hỏng, thiếu row) bị BỎ, ĐẾM, log GỘP một dòng, chép sang tệp cách ly", async () => {
    const good = (tag: string, ts: number) =>
      JSON.stringify({ key: `1|${tag}|${ts}`, enqueuedAt: Date.now(), row: { ...row(tag, ts), ts: new Date(ts).toISOString() } });
    const badTs = JSON.stringify({ key: "1|x|NaN", enqueuedAt: Date.now(), row: { ...row("x", 0), ts: "không-phải-ngày" } });
    await fsp.writeFile(
      wal,
      [good("a", 1000), '{"key":"1|cut|5","row":{"ts":"2026-09-2', badTs, '{"foo":1}', good("b", 2000)].join("\n") + "\n",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const n = await restore();
    expect(n).toBe(2);
    expect(getStatus().corruptLinesSkipped).toBe(3);
    const restoreWarns = warn.mock.calls.filter((c) => String(c[0]).includes("restore"));
    expect(restoreWarns.length).toBe(1);
    const q = (await fsp.readFile(wal + ".corrupt", "utf8")).split("\n").filter(Boolean);
    expect(q.length).toBe(3);
  });

  it("★ WAL có một dòng ts hỏng ⇒ replay vẫn lưu các dòng tốt (trước: kẹt vĩnh viễn)", async () => {
    const line = (tag: string, ts: string) =>
      JSON.stringify({ key: `1|${tag}|${ts}`, enqueuedAt: Date.now(), row: { ...row(tag, 0), ts } });
    await fsp.writeFile(wal, [line("a", "2026-09-27T01:00:00.000Z"), line("bad", "rác"), line("b", "2026-09-27T01:00:01.000Z")].join("\n") + "\n");
    await restore();
    const stored: string[] = [];
    // DB giả theo Postgres: một dòng ts không hợp lệ ⇒ cả câu lệnh ném (drizzle gọi toISOString ⇒ RangeError).
    setInsertFn(async (rows) => {
      for (const r of rows) (r.ts as Date).toISOString();
      stored.push(...rows.map((r) => r.metric));
      return rows.length;
    });
    const r = await backfill();
    expect(stored).toEqual(["a", "b"]);
    expect(r.remaining).toBe(0);
  });

  it("★ backfill: dòng bị Postgres từ chối vì DỮ LIỆU (SQLSTATE 22xxx) bị cách ly, các dòng sau vẫn lưu", async () => {
    await buffer([row("a", 1000), row("po\u0000ison", 2000), row("b", 3000)]);
    const stored: string[] = [];
    setInsertFn(async (rows) => {
      if (rows.some((r) => r.metric.includes("\u0000"))) {
        throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("invalid byte"), { code: "22021" }) });
      }
      stored.push(...rows.map((r) => r.metric));
      return rows.length;
    });
    const r = await backfill();
    expect(stored).toEqual(["a", "b"]);
    expect(r.remaining).toBe(0);
    expect(getStatus().quarantined).toBe(1);
    const q = (await fsp.readFile(wal + ".corrupt", "utf8")).split("\n").filter(Boolean);
    expect(q.length).toBe(1);
  });

  it("backfill không làm rơi dòng khi một lượt ghi WAL song song cách ly dòng ĐANG nằm trong lô xả", async () => {
    await buffer([row("a", 1000)]);
    const p1 = buffer([row("big", 2000, { meta: { adapterId: 1, tagKey: "big", n: BigInt(1) } }), row("c", 3000)]);
    const stored: string[] = [];
    setInsertFn(async (rows) => {
      await p1; // lượt ghi WAL chạy xong ⇒ "big" bị cách ly khỏi hàng đợi GIỮA lúc lô đang xả
      await buffer([row("d", 4000)]); // một dòng MỚI tới trong lúc xả
      stored.push(...rows.map((r) => r.metric));
      return rows.length;
    });
    const r = await backfill();
    // "d" tới GIỮA lúc xả lô đầu ⇒ phải được xả ở lô kế (xoá theo VỊ TRÍ sẽ xoá nhầm nó mà không ghi)
    expect(stored).toEqual(["a", "big", "c", "d"]);
    expect(r.remaining).toBe(0);
  });

  it("backfill: DB SẬP (lỗi kết nối, không SQLSTATE dữ liệu) ⇒ GIỮ NGUYÊN hàng đợi, không cách ly gì", async () => {
    await buffer([row("a", 1000), row("b", 2000)]);
    setInsertFn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    const r = await backfill();
    expect(r.remaining).toBe(2);
    expect(getStatus().quarantined).toBe(0);
  });
});
