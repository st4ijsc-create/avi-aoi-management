/**
 * ★★★ CẮT-IM-LẶNG trên luồng xuất — lưới cho sự cố đo được ngày 2026-08-18.
 * ════════════════════════════════════════════════════════════════════════════
 * SỰ CỐ THẬT (đo trên CSDL dev, 6/6 lượt giống hệt nhau):
 *   `/api/export/measurements.csv` giao 27.000 hàng trong khi `SELECT count(*)` = 27.599.
 *   HTTP 200 · header đúng · dòng cuối TRỌN VẸN · người tải về không có cách nào biết
 *   mình thiếu 599 hàng. Nguyên nhân: trang thứ 28 chạm `statement_timeout` (30 s) vì
 *   planner chọn Nested Loop cho `JOIN … LIMIT 1000` ⇒ `catch` gọi `res.destroy()`.
 *
 * HÌNH DẠNG DỮ LIỆU Ở ĐÂY LÀ HÌNH DẠNG THẬT ĐÃ ĐO — 27 trang đầy 1.000 hàng + MỘT trang
 * lẻ 599 hàng, và lỗi được ném ở ĐÚNG trang 28. Lưới dựng trên dữ liệu "tròn trịa" (mọi
 * trang đều đầy) sẽ KHÔNG bao giờ chạm lớp lỗi này — đó là bài học đã trả giá.
 *
 * Máy chủ Express + HTTP THẬT trên cổng tạm (kỷ luật apiV1.test.ts); tầng CSDL giả lập
 * theo kịch bản. Ca chạm CSDL THẬT nằm ở `exportRealStream.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { Writable } from "node:stream";

// ── Kịch bản CSDL ────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  /** Hàng kỳ vọng do truy vấn ĐẾM trả về (thước đo độc lập). */
  aggregate: { n: 0, maxId: 0 } as { n: number; maxId: number },
  /** Các trang hàng đo, theo thứ tự. */
  pages: [] as Row[][],
  /** Chỉ số trang (0-based) sẽ NÉM lỗi thay vì trả dữ liệu. -1 = không ném. */
  throwOnPage: -1,
  /** Lỗi được ném (mặc định: đúng lỗi statement_timeout của postgres). */
  pageError: null as Error | null,
  pageCursor: 0,
  auditRows: [] as Record<string, unknown>[],
  inspectionPages: [] as Array<{ data: Row[]; hasMore: boolean; nextCursor: string | null }>,
  inspectionExpected: 0,
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async (row: Record<string, unknown>) => {
    h.auditRows.push(row);
    return { id: h.auditRows.length };
  }),
}));

vi.mock("../../_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(async () => ({ id: 7, name: "tester", role: "admin" })) },
}));

vi.mock("../../db/inspection", () => ({
  getProductInspectionsCursor: vi.fn(async () => {
    const page = h.inspectionPages.shift();
    return page ?? { data: [], hasMore: false, nextCursor: null, prevCursor: null };
  }),
}));

/**
 * Trình dựng truy vấn drizzle GIẢ: chuỗi hoá mọi phương thức mà router dùng và phân giải
 * khi được `await`. Phân biệt ba truy vấn theo TẬP CỘT được chọn — không theo thứ tự gọi —
 * nên lưới không vỡ khi mã đổi thứ tự.
 */
vi.mock("../../db/connection", () => {
  const CHAIN = ["select", "from", "innerJoin", "leftJoin", "where", "orderBy", "limit"] as const;
  type Ops = Array<{ kind: string; arg: unknown }>;

  function resolveOps(ops: Ops): unknown {
    const cols = (ops[0]?.arg ?? {}) as Record<string, unknown>;
    if ("n" in cols) return [{ n: h.aggregate.n, maxId: h.aggregate.maxId }];
    if ("hit" in cols) return []; // truy vấn con EXISTS — không bao giờ được await
    if ("id" in cols && Object.keys(cols).length === 1) {
      // Trang CHỌN ID.
      if (h.pageCursor === h.throwOnPage) {
        throw h.pageError ?? new Error("statement_timeout");
      }
      const page = h.pages[h.pageCursor] ?? [];
      return page.map((r) => ({ id: r.id }));
    }
    // Hình chiếu của trang hiện tại.
    const page = h.pages[h.pageCursor] ?? [];
    h.pageCursor += 1;
    return page;
  }

  function make(ops: Ops): Record<string, unknown> {
    const self: Record<string, unknown> = {
      getSQL: () => ({ queryChunks: [] }), // đủ để drizzle `exists()` nhận là SQLWrapper
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => resolveOps(ops))
          .then(res, rej),
    };
    for (const m of CHAIN) self[m] = (...a: unknown[]) => make([...ops, { kind: m, arg: a[0] }]);
    return self;
  }

  // ⚠ GỐC phải KHÔNG thenable: `await getDb()` sẽ "mở" bất kỳ đối tượng nào có `.then`
  //   và biến chính trình dựng thành kết quả truy vấn đầu tiên (db.select is not a function).
  const root = { select: (...a: unknown[]) => make([{ kind: "select", arg: a[0] }]) };
  return { getDb: vi.fn(async () => root) };
});

vi.mock("../../_core/accessControl", () => ({
  resolveDataScope: vi.fn(async () => ({ filter: undefined })),
}));

import {
  createExportRouter,
  csvCompletionLine,
  CSV_COMPLETE_PREFIX,
  resolveExportOutcome,
  ExportStreamAccountant,
  MEASUREMENT_EXPORT_COLUMNS,
} from "./exportRouter";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.EXPORT_RATE_LIMIT_PER_5MIN = "5000";
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/export", createExportRouter());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.pages = [];
  h.pageCursor = 0;
  h.throwOnPage = -1;
  h.pageError = null;
  h.auditRows = [];
  h.inspectionPages = [];
  h.aggregate = { n: 0, maxId: 0 };
});

// ── Dựng ĐÚNG hình dạng đã đo: 27 × 1000 + 1 × 599 = 27.599 ───────────────────
const REAL_TOTAL = 27_599;
const REAL_FULL_PAGES = 27;
const REAL_TAIL = 599;

function measurementRow(id: number): Row {
  return {
    id,
    inspectionId: 50_000 + id,
    serialNumber: `SIM-L1-${id}`,
    inspectionTime: new Date("2026-07-01T00:00:00.000Z"),
    machineId: 2,
    pointDefId: 75,
    pointCode: "MP-SLDR-H",
    pointName: "Chiều cao thiếc Q1",
    measuredValue: "0.223034",
    measuredValueText: null,
    result: "OK",
    defectCatalogId: null,
    defectCode: null,
    defectName: null,
    defectSeverity: null,
    aiConfidence: null,
  };
}

/** Hình dạng THẬT: `pageSizes` mô tả số hàng mỗi trang. */
function seedMeasurements(pageSizes: number[], declaredTotal?: number): void {
  let id = 65_700;
  h.pages = pageSizes.map((size) => Array.from({ length: size }, () => measurementRow(++id)));
  const emitted = pageSizes.reduce((a, b) => a + b, 0);
  h.aggregate = { n: declaredTotal ?? emitted, maxId: id };
}

function realShape(): void {
  seedMeasurements([...Array(REAL_FULL_PAGES).fill(1000), REAL_TAIL]);
}

const WINDOW = "from=2026-06-01&to=2026-08-01";
const KEY = { "X-API-Key": "MASTER" };

/** Đọc toàn bộ thân phản hồi, PHÂN BIỆT "đọc xong" với "kết nối đứt giữa chừng". */
async function readBody(url: string): Promise<{ status: number; body: string; transportError: boolean; expectedHeader: string | null }> {
  const res = await fetch(url, { headers: KEY });
  const expectedHeader = res.headers.get("x-export-expected-rows");
  try {
    const body = await res.text();
    return { status: res.status, body, transportError: false, expectedHeader };
  } catch {
    return { status: res.status, body: "", transportError: true, expectedHeader };
  }
}

function dataRows(body: string): string[] {
  return body
    .split("\r\n")
    .filter((l) => l.length > 0)
    .slice(1) // bỏ header CSV
    .filter((l) => !l.startsWith(CSV_COMPLETE_PREFIX));
}

// ═══════════════════════════════════════════════════════════════════════════════
describe("measurements.csv — luồng ĐỦ hàng", () => {
  it("giao đủ 27.599 hàng và ĐÓNG bằng dòng chứng nhận", async () => {
    realShape();
    const { status, body, transportError, expectedHeader } = await readBody(
      `${baseUrl}/api/export/measurements.csv?${WINDOW}`,
    );
    expect(status).toBe(200);
    expect(transportError).toBe(false);
    expect(expectedHeader).toBe(String(REAL_TOTAL));
    expect(dataRows(body)).toHaveLength(REAL_TOTAL);
    expect(body.endsWith(csvCompletionLine(REAL_TOTAL))).toBe(true);
  });

  it("hàng audit mang CẢ số kỳ vọng LẪN số ghi được, không chỉ một cờ", async () => {
    realShape();
    await readBody(`${baseUrl}/api/export/measurements.csv?${WINDOW}`);
    await new Promise((r) => setTimeout(r, 30)); // audit là fire-and-forget
    const row = h.auditRows.at(-1);
    expect(row).toBeDefined();
    const detail = row!.details as Record<string, unknown>;
    expect(detail.expectedRows).toBe(REAL_TOTAL);
    expect(detail.rows).toBe(REAL_TOTAL);
    expect(detail.outcome).toBe("complete");
    expect(row!.status).toBe("success");
  });
});

describe("★ SỰ CỐ GỐC — trang CSDL lỗi giữa chừng (statement_timeout)", () => {
  it("KHÔNG được kết thúc êm: không dòng chứng nhận + client thấy lỗi truyền", async () => {
    realShape();
    h.throwOnPage = REAL_FULL_PAGES; // đúng trang 28 như đã đo
    h.pageError = Object.assign(new Error('Failed query: … statement_timeout'), { code: "57014" });

    const res = await fetch(`${baseUrl}/api/export/measurements.csv?${WINDOW}`, { headers: KEY });
    expect(res.headers.get("x-export-expected-rows")).toBe(String(REAL_TOTAL));
    let body = "";
    let transportError = false;
    try {
      body = await res.text();
    } catch {
      transportError = true;
    }
    // Bằng chứng KHÔNG-IM-LẶNG: hoặc client báo lỗi truyền, hoặc — nếu client bỏ qua —
    // tệp vẫn THIẾU dòng chứng nhận. Cả hai đều phát hiện được; im lặng thì không.
    expect(transportError || !body.includes(CSV_COMPLETE_PREFIX)).toBe(true);
    expect(body.includes(CSV_COMPLETE_PREFIX)).toBe(false);
  });

  it("ghi log/audit KÈM SỐ (kỳ vọng / ghi được), không chỉ một dòng 'aborted'", async () => {
    realShape();
    h.throwOnPage = REAL_FULL_PAGES;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await readBody(`${baseUrl}/api/export/measurements.csv?${WINDOW}`);
      await new Promise((r) => setTimeout(r, 30));
      const printed = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(printed).toMatch(/expected=27599/);
      expect(printed).toMatch(/written=27000/);
      expect(printed).toMatch(/missing=599/);
    } finally {
      spy.mockRestore();
    }
    const detail = h.auditRows.at(-1)!.details as Record<string, unknown>;
    expect(detail.expectedRows).toBe(REAL_TOTAL);
    expect(detail.rows).toBe(REAL_FULL_PAGES * 1000);
    expect(detail.outcome).toBe("failed");
    expect(h.auditRows.at(-1)!.status).toBe("failure");
  });
});

describe("★ THIẾU HÀNG mà KHÔNG có lỗi nào — lớp cắt im lặng nguy hiểm nhất", () => {
  it("CSDL trả ít hơn số đã đếm ⇒ luồng bị huỷ, KHÔNG có dòng chứng nhận", async () => {
    // Không trang nào ném; nhưng tập giao chỉ có 27.000 trong khi phép đếm nói 27.599.
    seedMeasurements([...Array(27).fill(1000)], REAL_TOTAL);
    h.aggregate.maxId += 10_000; // vòng lặp còn "muốn" chạy tiếp nhưng CSDL hết hàng

    const res = await fetch(`${baseUrl}/api/export/measurements.csv?${WINDOW}`, { headers: KEY });
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* lỗi truyền cũng là một phát hiện hợp lệ */
    }
    expect(body.includes(CSV_COMPLETE_PREFIX)).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    const detail = h.auditRows.at(-1)!.details as Record<string, unknown>;
    expect(detail.outcome).toBe("short");
    expect(detail.rows).toBe(27_000);
    expect(detail.expectedRows).toBe(REAL_TOTAL);
  });
});

describe("measurements.json — luồng JSON", () => {
  it("hoàn chỉnh ⇒ parse được và mang complete:true + count", async () => {
    realShape();
    const { body } = await readBody(`${baseUrl}/api/export/measurements.json?${WINDOW}`);
    const parsed = JSON.parse(body) as { rows: unknown[]; count: number; complete: boolean };
    expect(parsed.rows).toHaveLength(REAL_TOTAL);
    expect(parsed.count).toBe(REAL_TOTAL);
    expect(parsed.complete).toBe(true);
  });

  it("bị cắt ⇒ KHÔNG parse được (không bao giờ là một tài liệu hợp lệ mà thiếu hàng)", async () => {
    realShape();
    h.throwOnPage = REAL_FULL_PAGES;
    const res = await fetch(`${baseUrl}/api/export/measurements.json?${WINDOW}`, { headers: KEY });
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    expect(() => JSON.parse(body)).toThrow();
  });
});

describe("inspections.csv — cùng cơ chế", () => {
  it("đủ hàng ⇒ dòng chứng nhận + header số kỳ vọng", async () => {
    h.inspectionPages = [
      { data: [{ id: 3, serialNumber: "A" }, { id: 2, serialNumber: "B" }], hasMore: true, nextCursor: "c1" },
      { data: [{ id: 1, serialNumber: "C" }], hasMore: false, nextCursor: null },
    ];
    h.aggregate = { n: 3, maxId: 3 }; // countInspectionsInWindow đi qua cùng builder giả
    const { body, expectedHeader } = await readBody(`${baseUrl}/api/export/inspections.csv?${WINDOW}`);
    expect(expectedHeader).toBe("3");
    expect(dataRows(body)).toHaveLength(3);
    expect(body.endsWith(csvCompletionLine(3))).toBe(true);
  });

  it("thiếu hàng ⇒ không dòng chứng nhận, audit ghi 'short' kèm số", async () => {
    h.inspectionPages = [{ data: [{ id: 3 }, { id: 2 }], hasMore: false, nextCursor: null }];
    h.aggregate = { n: 9, maxId: 9 }; // phép đếm nói 9, luồng chỉ giao 2
    // ⚠ Với thân phản hồi rất ngắn, `res.destroy()` có thể reset kết nối SỚM tới mức chính
    //   `fetch()` đã hỏng — đó cũng là một phát hiện hợp lệ (client KHÔNG nhận được tệp êm).
    let body = "";
    try {
      const res = await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}`, { headers: KEY });
      body = await res.text();
    } catch {
      body = "";
    }
    expect(body.includes(CSV_COMPLETE_PREFIX)).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    const detail = h.auditRows.at(-1)!.details as Record<string, unknown>;
    expect(detail.outcome).toBe("short");
    expect(detail.expectedRows).toBe(9);
    expect(detail.rows).toBe(2);
  });
});

// ── Đơn vị: cơ chế quyết kết cục + backpressure ──────────────────────────────
describe("resolveExportOutcome — thước KHÔNG được tự thoả", () => {
  it("ghi ít hơn kỳ vọng ⇒ 'short' (đột biến 'expected = written' làm ca này ĐỎ)", () => {
    expect(resolveExportOutcome({ failed: false, clientGone: false, written: 27_000, expected: 27_599 })).toBe("short");
  });
  it("ghi đủ ⇒ 'complete'", () => {
    expect(resolveExportOutcome({ failed: false, clientGone: false, written: 27_599, expected: 27_599 })).toBe("complete");
  });
  it("client tự đóng ⇒ 'client_aborted', KHÔNG bị nhầm thành lỗi máy chủ", () => {
    expect(resolveExportOutcome({ failed: false, clientGone: true, written: 10, expected: 99 })).toBe("client_aborted");
  });
  it("trang CSDL lỗi ⇒ 'failed' kể cả khi số hàng tình cờ khớp", () => {
    expect(resolveExportOutcome({ failed: true, clientGone: false, written: 5, expected: 5 })).toBe("failed");
  });
  it("ghi NHIỀU hơn kỳ vọng KHÔNG phải mất dữ liệu ⇒ vẫn 'complete'", () => {
    expect(resolveExportOutcome({ failed: false, clientGone: false, written: 27_600, expected: 27_599 })).toBe("complete");
  });
});

describe("ExportStreamAccountant — backpressure", () => {
  /** Writable giả có đệm nhỏ: `write()` trả false cho tới khi được 'drain'. */
  function fakeRes(): { res: Writable & { destroyed: boolean; writableEnded: boolean }; drain: () => void; chunks: string[] } {
    const chunks: string[] = [];
    let blocked = false;
    const res = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } }) as Writable & {
      destroyed: boolean;
      writableEnded: boolean;
    };
    const orig = res.write.bind(res);
    (res as unknown as { write: (c: string) => boolean }).write = (c: string) => {
      orig(c);
      blocked = !blocked; // xen kẽ: một lần ghi được, một lần bị chặn
      return !blocked;
    };
    return { res, drain: () => res.emit("drain"), chunks };
  }

  it("chờ 'drain' khi write() trả false — và ĐẾM ĐỦ mọi hàng đã giao", async () => {
    const { res, drain, chunks } = fakeRes();
    const acc = new ExportStreamAccountant(res as never);
    const writes = (async () => {
      for (let i = 0; i < 6; i++) await acc.writeRow(`row-${i}\r\n`);
    })();
    const timer = setInterval(drain, 2);
    await writes;
    clearInterval(timer);
    expect(acc.written).toBe(6);
    expect(chunks).toHaveLength(6);
  });

  it("socket đóng TRONG lúc chờ drain ⇒ không treo, và luồng tự coi là đã đóng", async () => {
    const { res } = fakeRes();
    const acc = new ExportStreamAccountant(res as never);
    const p = (async () => {
      await acc.writeRow("a\r\n");
      await acc.writeRow("b\r\n"); // dòng này bị chặn ⇒ chờ drain
    })();
    setTimeout(() => res.emit("close"), 5);
    await expect(p).resolves.toBeUndefined();
    expect(acc.clientGone).toBe(true);
    expect(acc.open).toBe(false);
  });
});

describe("hình dạng dòng chứng nhận", () => {
  it("là dòng CUỐI, có tiền tố nhận diện và mang SỐ", () => {
    expect(csvCompletionLine(27_599)).toBe(`${CSV_COMPLETE_PREFIX} rows=27599\r\n`);
  });
  it("cột xuất không đổi (dòng chứng nhận không được giả dạng một hàng dữ liệu)", () => {
    expect(MEASUREMENT_EXPORT_COLUMNS[0]).toBe("id");
    expect(csvCompletionLine(1).startsWith("#")).toBe(true);
  });
});
