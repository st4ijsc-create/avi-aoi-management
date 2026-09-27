/**
 * doc 81 Đợt 1B Task 11 — nhánh anh em: `GET /api/external/health` ("Confirms the site is up, the
 * DB is reachable") trước bản vá trả `db: !!getDb() ? "up" : "down"` ⇒ LUÔN "up" (đối tượng drizzle
 * cache truthy) cả khi Postgres sập. Nay đọc CÙNG pinger `SELECT 1` với `/health`, `/readyz`.
 *
 * Oracle: pinger được thay bằng bản giả trả `{ok:false}` / `{ok:true}` (vi.mock CÓ factory) ⇒ trường
 * `db` phải theo đúng nó; đột biến quay về `!!getDb()` ⇒ ca "down" ĐỎ (DB `_test` thật vẫn sống).
 * Server test nghe 127.0.0.1 cổng 0, đóng ở afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const trangThai = vi.hoisted(() => ({ ok: false, dem: 0 }));

vi.mock("../_core/healthProbes", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../_core/healthProbes")>();
  return {
    ...goc,
    pingDbCached: async () => {
      trangThai.dem++;
      return { ok: trangThai.ok, reason: trangThai.ok ? undefined : "error", ms: 1, startedAt: 0, at: Date.now() };
    },
  };
});

let srv: http.Server;
let port = 0;

beforeAll(async () => {
  const { registerExternalInspectionRoutes } = await import("./externalInspectionApi");
  const app = express();
  registerExternalInspectionRoutes(app, (_req, _res, next) => next()); // xác thực không phải đối tượng đo ở đây
  srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  port = (srv.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => srv.close(() => r()));
});

function get(p: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, agent: false }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("T11 — /api/external/health: db theo SELECT 1 thật, không theo Boolean(getDb())", () => {
  it("ping DB thất bại ⇒ db:'down' (HTTP vẫn 200 — probe reachability site + token)", async () => {
    trangThai.ok = false;
    const truoc = trangThai.dem;
    const r = await get("/api/external/health");
    expect(r.status).toBe(200);
    expect(r.json.db).toBe("down");
    expect(trangThai.dem - truoc, "phải hỏi pinger SELECT 1").toBe(1);
  });

  it("ping DB thành công ⇒ db:'up' (đường hợp lệ giữ nguyên hình dạng)", async () => {
    trangThai.ok = true;
    const r = await get("/api/external/health");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ success: true, status: "ok", db: "up" });
  });
});
