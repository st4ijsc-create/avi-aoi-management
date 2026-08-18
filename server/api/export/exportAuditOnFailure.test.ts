/**
 * ★★★ SỔ KIỂM TOÁN CỦA ĐƯỜNG LỖI — lưới cho sự cố đo được 2026-08-18.
 * ════════════════════════════════════════════════════════════════════════════
 * SỰ CỐ THẬT. Trên 8/8 lượt `/api/export/measurements.csv` bị cắt giữa chừng, máy chủ in
 *   `[Export] audit log failed: Cannot read properties of undefined (reading 'id')`
 * và **không hàng audit nào được ghi**; trên 16/16 lượt xuất XONG thì không một lỗi nào.
 * ⇒ Một lượt tệp xuất mất 22.599 hàng **không để lại dấu vết nào phía máy chủ**.
 *
 * ⚠⚠ VÌ SAO LƯỚI PHẢI Ở TẦNG HTTP THẬT, KHÔNG PHẢI GỌI HÀM.
 * Gốc rễ là **THỜI ĐIỂM ĐỌC**: `auditExport` cũ đọc `req.ip` bên trong `.then()` của
 * `import("../../db")`, tức MỘT MICROTASK SAU khi `sealExport()` đã gọi `res.destroy()`.
 * Sau lượt destroy ấy `req.socket.remoteAddress` là `undefined` (Node chỉ nhớ `_peername`
 * nếu nó ĐÃ ĐƯỢC ĐỌC lúc handle còn sống). Một ca gọi hàm trực tiếp **không có socket để
 * huỷ** nên nó không bao giờ chạm được lớp lỗi này — nó sẽ xanh với cả mã hỏng.
 * ⇒ Ở đây: Express + HTTP thật, luồng bị cắt THẬT, rồi đọc lại hàng audit.
 *
 * Tầng CSDL được kịch bản hoá (kỷ luật `exportTruncation.test.ts`); `createAuditLog` là
 * một BỒN CHỨA có thể ép ném, để đo được cả nhánh "chính sổ kiểm toán cũng hỏng".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  aggregate: { n: 0, maxId: 0 } as { n: number; maxId: number },
  pages: [] as Row[][],
  /** Trang (0-based) sẽ NÉM thay vì trả dữ liệu. -1 = không ném. */
  throwOnPage: -1,
  /**
   * ⚠ Độ TRỄ trước khi trang ấy ném — đây là THƯỚC ĐO của bản vá, không phải trang trí.
   * Xem ghi chú "ĐỒNG HỒ" ở ca đầu tiên: nó tách "chụp ngữ cảnh lúc NHẬN yêu cầu" khỏi
   * "đọc ngữ cảnh lúc luồng đã chết" bằng một khoảng thời gian đo được.
   */
  failDelayMs: 0,
  pageCursor: 0,
  /** Hàng audit đã ghi được. */
  auditRows: [] as Record<string, unknown>[],
  /** Số lượt ghi audit ĐẦU TIÊN sẽ bị ép ném (mô phỏng sổ kiểm toán hỏng). */
  auditFailFirst: 0,
  /** Mọi lượt ghi audit đều ném. */
  auditAlwaysFails: false,
  auditAttempts: 0,
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async () => undefined),
  createAuditLog: vi.fn(async (row: Record<string, unknown>) => {
    h.auditAttempts += 1;
    if (h.auditAlwaysFails) throw new Error("audit sink down");
    if (h.auditFailFirst > 0) {
      h.auditFailFirst -= 1;
      throw new Error("audit sink down (lượt đầy đủ)");
    }
    h.auditRows.push(row);
    return { id: h.auditRows.length };
  }),
}));

vi.mock("../../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: { headers?: Record<string, unknown> }) =>
      req?.headers?.["x-session"] ? { id: 51, name: "Anh Minh (Kỹ sư TĐH)", role: "admin" } : null,
    ),
  },
}));

vi.mock("../../db/inspection", () => ({
  getProductInspectionsCursor: vi.fn(async () => ({ data: [], hasMore: false, nextCursor: null, prevCursor: null })),
}));

vi.mock("../../db/connection", () => {
  const CHAIN = ["select", "from", "innerJoin", "leftJoin", "where", "orderBy", "limit"] as const;
  type Ops = Array<{ kind: string; arg: unknown }>;

  function resolveOps(ops: Ops): unknown {
    const cols = (ops[0]?.arg ?? {}) as Record<string, unknown>;
    if ("n" in cols) return [{ n: h.aggregate.n, maxId: h.aggregate.maxId }];
    if ("hit" in cols) return [];
    if ("id" in cols && Object.keys(cols).length === 1) {
      if (h.pageCursor === h.throwOnPage) {
        const boom = new Error("canceling statement due to statement timeout");
        if (h.failDelayMs > 0) {
          return new Promise((_res, rej) => setTimeout(() => rej(boom), h.failDelayMs));
        }
        throw boom;
      }
      return (h.pages[h.pageCursor] ?? []).map((r) => ({ id: r.id }));
    }
    const page = h.pages[h.pageCursor] ?? [];
    h.pageCursor += 1;
    return page;
  }

  function make(ops: Ops): Record<string, unknown> {
    const self: Record<string, unknown> = {
      getSQL: () => ({ queryChunks: [] }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => resolveOps(ops))
          .then(res, rej),
    };
    for (const m of CHAIN) self[m] = (...a: unknown[]) => make([...ops, { kind: m, arg: a[0] }]);
    return self;
  }
  const root = { select: (...a: unknown[]) => make([{ kind: "select", arg: a[0] }]) };
  return { getDb: vi.fn(async () => root) };
});

vi.mock("../../_core/accessControl", () => ({
  resolveDataScope: vi.fn(async () => ({ filter: undefined })),
}));

import { createExportRouter, CSV_COMPLETE_PREFIX } from "./exportRouter";

let server: Server;
let baseUrl: string;

const PAGE = 1000;

/** Dựng `pages`/`aggregate`: `full` trang đầy + một trang lẻ `tail`. */
function scriptRows(full: number, tail: number): number {
  h.pages = [];
  let id = 1;
  for (let p = 0; p < full; p++) {
    h.pages.push(Array.from({ length: PAGE }, () => ({ id: id++, inspectionId: 1, result: "OK" })));
  }
  if (tail > 0) h.pages.push(Array.from({ length: tail }, () => ({ id: id++, inspectionId: 1, result: "OK" })));
  const total = full * PAGE + tail;
  h.aggregate = { n: total, maxId: total };
  return total;
}

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
  h.auditRows = [];
  h.auditFailFirst = 0;
  h.auditAlwaysFails = false;
  h.auditAttempts = 0;
  h.pageCursor = 0;
  h.throwOnPage = -1;
  h.failDelayMs = 0;
});

const WINDOW = "from=2026-06-01&to=2026-08-01";

/** Gọi luồng xuất; trả về thân đã đọc được (hoặc lỗi truyền) — KHÔNG che sự cố. */
async function fetchStream(
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; transportError: string | null }> {
  const res = await fetch(`${baseUrl}${path}?${WINDOW}`, { headers });
  try {
    return { status: res.status, body: await res.text(), transportError: null };
  } catch (err) {
    return { status: res.status, body: "", transportError: (err as Error).message };
  }
}

/** Hàng audit chạy bất đồng bộ sau `finally` — chờ tới khi có, hoặc hết hạn. */
async function waitForAudit(n = 1, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (h.auditRows.length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
}

const SESSION = { "x-session": "1", "user-agent": "vitest-session" };
const APIKEY = { "x-api-key": "MASTER", "user-agent": "vitest-apikey" };

describe("luồng xuất CẮT GIỮA CHỪNG vẫn phải để lại dấu vết", () => {
  /**
   * ★★★ ĐỒNG HỒ LÀ THƯỚC ĐO CHÍNH của bản vá này — KHÔNG phải ô `ipAddress`.
   *
   * ⚠ ĐÃ ĐO VÀ ĐÃ SAI MỘT LẦN: ca này thoạt tiên chỉ đòi `ipAddress` khác rỗng, vì trên máy
   * chủ sản xuất **19/19** hàng audit hỏng đều mất IP. Nhưng đột biến M1 (đọc ngữ cảnh SAU
   * `res.destroy()`) **vẫn XANH** dưới vitest: `express-rate-limit` tắt lớp kiểm tra của nó
   * khi `NODE_ENV=production` nhưng BẬT ở test, và lớp ấy đọc `req.ip` sớm ⇒ Node nhớ
   * `socket._peername` ⇒ IP sống sót qua lượt destroy **chỉ trong test**. Một lưới dựng
   * trên IP là lưới đo một tính chất của MÔI TRƯỜNG, không phải của MÃ.
   *
   * ⇒ Thước đo thật: **KHI NÀO** ngữ cảnh được chụp. Trang hỏng bị làm trễ `failDelayMs`,
   *   nên "chụp lúc nhận yêu cầu" và "đọc lúc luồng chết" cách nhau một khoảng ĐO ĐƯỢC.
   *   Ô `ipAddress` vẫn được giữ lại như một ràng buộc phụ (nó là ô mất thật ở sản xuất).
   */
  it("★ phiên người dùng: cắt giữa chừng ⇒ CÓ hàng audit, outcome=failed, ngữ cảnh chụp SỚM", async () => {
    const total = scriptRows(27, 599);
    h.throwOnPage = 5; // trang 6 chạm statement_timeout
    h.failDelayMs = 600; // luồng chỉ chết SAU 600 ms
    const t0 = Date.now();
    const out = await fetchStream("/api/export/measurements.csv", SESSION);
    const tFail = Date.now();
    expect(tFail - t0, "kịch bản phải thực sự trễ, nếu không phép đo thời điểm vô nghĩa").toBeGreaterThan(500);

    // sự cố gốc VẪN được báo ra ngoài: không có dòng chứng nhận
    expect(out.body.includes(CSV_COMPLETE_PREFIX) && out.transportError === null).toBe(false);

    await waitForAudit();
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    expect(row.status).toBe("failure");
    expect((row.details as Record<string, unknown>).outcome).toBe("failed");
    expect((row.details as Record<string, unknown>).expectedRows).toBe(total);
    expect(row.userId).toBe(51);
    expect(row.userAgent).toBe("vitest-session");
    expect(row.ipAddress, "IP là ô mất thật ở sản xuất — phải còn").toBeTruthy();

    // ★★ THƯỚC ĐO CHÍNH: ngữ cảnh phải được chụp lúc NHẬN yêu cầu, không phải lúc ghi sổ.
    const requestedAt = Date.parse((row.details as Record<string, string>).requestedAt);
    expect(Number.isFinite(requestedAt)).toBe(true);
    expect(
      requestedAt - t0,
      "ngữ cảnh audit được chụp SAU khi luồng đã chết ⇒ nó đọc một `req` đã bị tháo dỡ",
    ).toBeLessThan(400);
    expect(tFail - requestedAt).toBeGreaterThan(400);
  });

  it("★ KHOÁ API (không có phiên người dùng): cắt giữa chừng ⇒ VẪN có hàng audit", async () => {
    scriptRows(27, 599);
    h.throwOnPage = 3;
    await fetchStream("/api/export/measurements.csv", APIKEY);

    await waitForAudit();
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    // khoá API KHÔNG phải người dùng ⇒ không có userId, nhưng danh tính khoá phải còn
    expect(row.userId).toBeNull();
    expect(row.userName).toBeTruthy();
    expect(row.status).toBe("failure");
    expect((row.details as Record<string, unknown>).outcome).toBe("failed");
    expect(row.ipAddress, "khoá API vẫn phải để lại IP ở đường lỗi").toBeTruthy();
  });

  it("★ client BỎ ĐI giữa chừng cũng để lại dấu vết (client_aborted)", async () => {
    scriptRows(27, 599);
    const ctrl = new AbortController();
    const res = await fetch(`${baseUrl}/api/export/measurements.csv?${WINDOW}`, {
      headers: SESSION,
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ctrl.abort();

    await waitForAudit();
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    expect(row.status).toBe("failure");
    expect(["client_aborted", "failed", "short"]).toContain((row.details as Record<string, unknown>).outcome);
    expect(row.ipAddress).toBeTruthy();
  });

  it("★ chính sổ kiểm toán hỏng ở lượt ĐẦY ĐỦ ⇒ vẫn ghi được hàng TỐI GIẢN", async () => {
    scriptRows(27, 599);
    h.throwOnPage = 2;
    h.auditFailFirst = 1; // lượt đầy đủ ném, lượt tối giản phải cứu được bản ghi
    await fetchStream("/api/export/measurements.csv", SESSION);

    await waitForAudit();
    expect(h.auditAttempts).toBeGreaterThanOrEqual(2);
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    expect(row.status).toBe("failure");
    expect(row.entityName).toBe("/api/export/measurements.csv");
    expect(row.ipAddress).toBeTruthy(); // ô sống sót phải là ô THẬT, không phải null
  });

  it("★ sổ kiểm toán hỏng HOÀN TOÀN ⇒ sự cố GỐC vẫn được báo ra ngoài, không bị nuốt", async () => {
    scriptRows(27, 599);
    h.throwOnPage = 4;
    h.auditAlwaysFails = true;
    const errs: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errs.push(a));
    let out: Awaited<ReturnType<typeof fetchStream>>;
    try {
      out = await fetchStream("/api/export/measurements.csv", SESSION);
      // chờ cả ba nấc ghi audit chạy xong
      const until = Date.now() + 3000;
      while (h.auditAttempts < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    } finally {
      spy.mockRestore();
    }

    // ① kết cục của lượt xuất vẫn là HỎNG với client (không có dòng chứng nhận)
    expect(out!.body.includes(CSV_COMPLETE_PREFIX) && out!.transportError === null).toBe(false);
    // ② sự cố GỐC vẫn được báo trong log, KHÔNG bị thay bằng lỗi của sổ kiểm toán
    const flat = errs.map((a) => a.map(String).join(" ")).join("\n");
    expect(flat).toContain("measurements stream failed");
    expect(flat).toContain("statement timeout");
    // ③ và hàng audit không ghi được thì phải in RA ĐỦ để dựng lại — không "một dòng rồi đi tiếp"
    expect(flat).toContain("HÀNG AUDIT BỊ MẤT HOÀN TOÀN");
    expect(flat).toContain("/api/export/measurements.csv");
    expect(h.auditRows).toHaveLength(0);
  });

  it("chiều dương: xuất XONG vẫn ghi audit như cũ (chống hồi quy)", async () => {
    const total = scriptRows(2, 40);
    const out = await fetchStream("/api/export/measurements.csv", SESSION);
    expect(out.body).toContain(CSV_COMPLETE_PREFIX);

    await waitForAudit();
    expect(h.auditRows).toHaveLength(1);
    const row = h.auditRows[0] as Record<string, unknown>;
    expect(row.status).toBe("success");
    expect((row.details as Record<string, unknown>).outcome).toBe("complete");
    expect((row.details as Record<string, unknown>).rows).toBe(total);
    expect(row.ipAddress).toBeTruthy();
    expect(row.userAgent).toBe("vitest-session");
  });
});
