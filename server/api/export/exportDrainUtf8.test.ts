/**
 * Hồi quy Node 24.22 / 26.13: `res.write(chuỗi đa byte)` mất sự kiện `drain` ⇒ luồng xuất treo vĩnh viễn (xem `toWireBuffer`).
 * HTTP THẬT trên cổng tạm; `ExportStreamAccountant` THẬT; hàng có tiếng Việt, đủ lớn để chạm backpressure nhiều lần.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ExportStreamAccountant, toWireBuffer } from "./exportRouter";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const ROW = "SIM-L1-65701,Chiều cao thiếc Q1,0.223034,OK\r\n";
const N = 27_599;

async function chay(): Promise<{ body: string; written: number }> {
  let written = 0;
  server = createServer(async (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    const acc = new ExportStreamAccountant(res as never);
    for (let i = 0; i < N; i++) await acc.writeRow(ROW);
    written = acc.written;
    res.end();
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  return { body: await r.text(), written };
}

describe("luồng xuất — tiếng Việt qua backpressure (Node 24/26 mất drain với chuỗi đa byte)", () => {
  it("toWireBuffer giữ nguyên byte UTF-8", () => {
    expect(toWireBuffer(ROW).toString("utf8")).toBe(ROW);
    expect(toWireBuffer("é").length).toBe(2);
  });

  it("★ ExportStreamAccountant giao đủ 27.599 hàng tiếng Việt, không treo", async () => {
    const { body, written } = await chay();
    expect(written).toBe(N);
    expect(body.length).toBe(N * ROW.length);
  }, 10_000);
});
