/**
 * ★ CA CHẠM LUỒNG THẬT — Express + HTTP thật + **PostgreSQL thật** (không mock tầng CSDL).
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CÓ CA NÀY. Sự cố 2026-08-18 sống được nhiều tháng vì mọi lưới hiện có đều
 * mock `db/connection`: chúng chứng minh vòng lặp phân trang ĐÚNG LOGIC, trong khi thứ hỏng
 * là KẾ HOẠCH THỰC THI mà PostgreSQL chọn cho truy vấn ấy (Nested Loop loại 3 tỷ hàng ⇒
 * `statement_timeout` ⇒ `res.destroy()`). Một mock KHÔNG THỂ nói dối hay nói thật về plan —
 * nó không có plan. Nên ca này phải chạy SQL thật.
 *
 * Ca này bất biến với LƯỢNG dữ liệu: nó tự hỏi CSDL "có bao nhiêu" rồi đòi luồng giao đúng
 * chừng ấy. Trên CSDL dev (27.599 hàng) nó tái hiện đúng sự cố; trên CSDL test rỗng nó vẫn
 * chứng minh SQL mới hợp lệ và dòng chứng nhận được ghi.
 *
 * Chỉ mock XÁC THỰC (phiên) — không phải thứ đang được đo.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

vi.mock("../../_core/sdk", () => ({
  // admin ⇒ không nhánh resolveDataScope, để phép đo tập trung vào chính luồng xuất.
  sdk: { authenticateRequest: vi.fn(async () => ({ id: 1, name: "real-stream-test", role: "admin" })) },
}));

import { createExportRouter, CSV_COMPLETE_PREFIX, csvCompletionLine } from "./exportRouter";

let server: Server;
let baseUrl: string;
/** null khi máy chạy test không có PostgreSQL — ca sẽ NÓI RÕ thay vì xanh im lặng. */
let dbUp = false;

const FROM = "2000-01-01";
const TO = "2000-03-01"; // cửa sổ hẹp mặc định; mở rộng bên dưới theo dữ liệu thật

beforeAll(async () => {
  process.env.EXPORT_RATE_LIMIT_PER_5MIN = "5000";
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/export", createExportRouter());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const { getDb } = await import("../../db/connection");
  dbUp = (await getDb()) !== null;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Cửa sổ [from,to] rộng nhất mà `parseExportWindow` cho phép (92 ngày), neo vào dữ liệu thật. */
async function widestWindow(): Promise<{ from: string; to: string; expected: number }> {
  const { getDb } = await import("../../db/connection");
  const db = (await getDb())!;
  const { sql } = await import("drizzle-orm");
  const bounds = await db.execute(
    sql`SELECT max("inspectionTime") AS mx FROM product_inspections`,
  );
  const rows = bounds as unknown as Array<{ mx: string | Date | null }>;
  const mx = rows[0]?.mx ? new Date(rows[0].mx as string) : new Date();
  const to = new Date(mx.getTime() + 86_400_000);
  const from = new Date(to.getTime() - 90 * 86_400_000);
  const cnt = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM measurement_results mr
    WHERE EXISTS (
      SELECT 1 FROM product_inspections pi
      WHERE pi.id = mr."inspectionId"
        AND pi."inspectionTime" >= ${from.toISOString()}
        AND pi."inspectionTime" <= ${to.toISOString()}
    )`);
  const c = cnt as unknown as Array<{ n: number }>;
  return { from: from.toISOString(), to: to.toISOString(), expected: Number(c[0]?.n ?? 0) };
}

describe("measurements.csv trên PostgreSQL THẬT", () => {
  it("CSDL phải có mặt — không có thì NÓI RA, không xanh im lặng", () => {
    expect(
      dbUp,
      "Không nối được PostgreSQL (DATABASE_URL). Ca chạm-luồng-thật KHÔNG chạy được ⇒ " +
        "lưới này đang không bảo vệ gì. Chạy `node scripts/setup-test-db.mjs` rồi thử lại.",
    ).toBe(true);
  });

  it("số hàng giao ra KHỚP `count(*)` và tệp kết thúc bằng dòng chứng nhận", async () => {
    const { from, to, expected } = await widestWindow();
    const res = await fetch(
      `${baseUrl}/api/export/measurements.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-export-expected-rows")).toBe(String(expected));

    const body = await res.text(); // ném nếu luồng bị cắt — chính là điều ta muốn phát hiện
    const lines = body.split("\r\n").filter((l) => l.length > 0);
    const dataRows = lines.slice(1).filter((l) => !l.startsWith(CSV_COMPLETE_PREFIX));

    expect(dataRows).toHaveLength(expected);
    expect(body.endsWith(csvCompletionLine(expected))).toBe(true);
  }, 180_000);

  it("id trong tệp TĂNG NGẶT và không trùng — con trỏ phân trang không nhảy/không mất", async () => {
    const { from, to, expected } = await widestWindow();
    if (expected === 0) return; // không có hàng thì không có gì để nói về thứ tự
    const res = await fetch(
      `${baseUrl}/api/export/measurements.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    const body = await res.text();
    const ids = body
      .split("\r\n")
      .filter((l) => l.length > 0)
      .slice(1)
      .filter((l) => !l.startsWith(CSV_COMPLETE_PREFIX))
      .map((l) => Number(l.split(",")[0]));

    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1]);
  }, 180_000);

  it("inspections.csv: số hàng khớp `count(*)` + dòng chứng nhận", async () => {
    const { getDb } = await import("../../db/connection");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const { from, to } = await widestWindow();
    const cnt = (await db.execute(sql`
      SELECT count(*)::int AS n FROM product_inspections
      WHERE "inspectionTime" >= ${from} AND "inspectionTime" <= ${to}`)) as unknown as Array<{ n: number }>;
    const expected = Number(cnt[0]?.n ?? 0);

    const res = await fetch(
      `${baseUrl}/api/export/inspections.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.headers.get("x-export-expected-rows")).toBe(String(expected));
    const body = await res.text();
    const dataRows = body
      .split("\r\n")
      .filter((l) => l.length > 0)
      .slice(1)
      .filter((l) => !l.startsWith(CSV_COMPLETE_PREFIX));
    expect(dataRows).toHaveLength(expected);
    expect(body.endsWith(csvCompletionLine(expected))).toBe(true);
  }, 180_000);
});

// Giữ FROM/TO khỏi bị coi là biến chết nếu ai đó sửa lại cửa sổ mặc định.
void FROM;
void TO;
