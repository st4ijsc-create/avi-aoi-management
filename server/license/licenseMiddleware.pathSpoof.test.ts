/**
 * Doc 80 Đợt 1 final wave (item 3) — giấy phép READ-ONLY bị vượt bằng đường dẫn giả mạo.
 *
 * `license-middleware` cũ tách tên thủ tục từ CẢ `req.path` thô (`split(",")`) và đọc namespace từ đoạn
 * ĐẦU (`licensePolicy.isProductionCritical`), trong khi tRPC 11.18 chạy đoạn CUỐI sau dấu `/`
 * (`express.mjs`: `req.path.slice(req.path.lastIndexOf("/") + 1)`), `decodeURIComponent` rồi mới
 * `split(",")` CHỈ KHI `?batch=1` (`resolveResponse.mjs`). Hai phép đọc khác nhau ⇒
 *   `POST /api/trpc/inspection.x/settings.upsert?batch=1`  và  `…/inspection.x%2Csettings.upsert?batch=1`
 * đều được middleware xét như `inspection.*` (thiết yếu ⇒ qua) còn tRPC thì chạy `settings.upsert`.
 *
 * Lưới này dựng ĐÚNG chuỗi middleware của `index.ts` (giấy phép → `createTrpcMiddleware`) trên HTTP thật
 * với một router nhỏ có cùng hình dạng namespace, `getState()` giả = `readonly`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { createTrpcMiddleware, trpcProcedureType } from "../_core/trpcAdapter";

// Như `trpcAdapter.test.ts` (final wave item 4): stub hai module NẶNG mà middleware kéo theo (`license-service`,
// `license-guard`); middleware THẬT + adapter THẬT vẫn chạy, chỉ TRẠNG THÁI giấy phép là giả (= `readonly`).
vi.mock("./license-service", () => ({ licenseService: {} }));
vi.mock("./license-guard", () => ({
  licenseGuard: {
    getState: () => "readonly",
    getStatus: () => ({ state: "readonly", message: "", daysUntilExpiry: null, daysPastExpiry: 0 }),
  },
}));
import { licenseEnforcementMiddleware } from "./license-middleware";
import { ENV } from "../_core/env";

const t = initTRPC.create({ transformer: superjson });
const daChay = vi.fn<(proc: string, s: string) => void>();
const testRouter = t.router({
  inspection: t.router({
    record: t.procedure.input(z.object({ s: z.string() })).mutation(({ input }) => {
      daChay("inspection.record", input.s);
      return { ok: true };
    }),
  }),
  settings: t.router({
    upsert: t.procedure.input(z.object({ s: z.string() })).mutation(({ input }) => {
      daChay("settings.upsert", input.s);
      return { ok: true };
    }),
    get: t.procedure.input(z.object({ s: z.string() })).query(({ input }) => ({ len: input.s.length })),
  }),
  ir: t.router({
    lint: t.procedure.input(z.object({ s: z.string() })).query(({ input }) => ({ len: input.s.length })),
  }),
});

let server: http.Server;
let base = "";
let bypassCu = false;

beforeAll(async () => {
  bypassCu = ENV.licenseBypass;
  (ENV as { licenseBypass: boolean }).licenseBypass = false;
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/trpc", licenseEnforcementMiddleware({ procedureType: (p) => trpcProcedureType(testRouter, p) }));
  app.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
});

afterAll(async () => {
  (ENV as { licenseBypass: boolean }).licenseBypass = bypassCu;
  await new Promise<void>((r) => server.close(() => r()));
});

const batchBody = (input: unknown) => JSON.stringify({ 0: superjson.serialize(input) });
const post = (rawPath: string, input: unknown = { s: "x" }) =>
  fetch(`${base}/${rawPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: batchBody(input) });
const get = (rawPath: string, input: unknown = { s: "abc" }) =>
  fetch(`${base}/${rawPath}${rawPath.includes("?") ? "&" : "?"}input=${encodeURIComponent(batchBody(input))}`);
const maLoi = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

describe("readonly — hai ví dụ giả mạo của final review BỊ CHẶN, thủ tục ghi KHÔNG chạy", () => {
  it("★★★ POST inspection.x/settings.upsert?batch=1 (thêm `/`): 403 LICENSE_READONLY, settings.upsert không chạy", async () => {
    daChay.mockClear();
    const res = await post("inspection.x/settings.upsert?batch=1", { s: "spoof-slash" });
    expect(res.status).toBe(403);
    expect(await maLoi(res)).toBe("LICENSE_READONLY");
    expect(daChay).not.toHaveBeenCalled();
  });

  it("★★★ POST inspection.x%2Csettings.upsert?batch=1 (`,` mã hoá): 403 LICENSE_READONLY, settings.upsert không chạy", async () => {
    daChay.mockClear();
    const res = await post("inspection.x%2Csettings.upsert?batch=1", { s: "spoof-pct" });
    expect(res.status).toBe(403);
    expect(await maLoi(res)).toBe("LICENSE_READONLY");
    expect(daChay).not.toHaveBeenCalled();
  });

  it("đối chứng: POST settings.upsert?batch=1 (không giả mạo) cũng 403 — ghi không thiết yếu chờ gia hạn", async () => {
    daChay.mockClear();
    expect((await post("settings.upsert?batch=1")).status).toBe(403);
    expect(daChay).not.toHaveBeenCalled();
  });
});

describe("readonly — đường hợp lệ vẫn qua (không vá quá tay)", () => {
  it("GET settings.get?batch=1 (query) ⇒ 200", async () => {
    expect((await get("settings.get?batch=1")).status).toBe(200);
  });

  it("Task 6: POST ir.lint?batch=1 (query đi POST vì input lớn) ⇒ 200", async () => {
    const res = await post("ir.lint?batch=1", { s: "y".repeat(5000) });
    expect(res.status).toBe(200);
  });

  it("POST inspection.record?batch=1 (ghi THIẾT YẾU — không bao giờ dừng dây chuyền) ⇒ 200 và CHẠY", async () => {
    daChay.mockClear();
    expect((await post("inspection.record?batch=1", { s: "critical" })).status).toBe(200);
    expect(daChay).toHaveBeenCalledWith("inspection.record", "critical");
  });
});

describe("phòng thủ nhiều lớp — đường thô đáng ngờ được xét như GHI", () => {
  it("GET x/settings.get?batch=1: tRPC sẽ chạy query settings.get, nhưng đường có `/` thừa ⇒ 403 (không nới cho query)", async () => {
    expect((await get("x/settings.get?batch=1")).status).toBe(403);
  });

  it("POST ir.lint%2Fx?batch=1: `%2F` ⇒ xét như ghi ⇒ 403 dù ir.lint là query", async () => {
    expect((await post("ir.lint%2Fx?batch=1")).status).toBe(403);
  });

  it("POST settings.x/inspection.record?batch=1: đáng ngờ nhưng thủ tục THẬT SỰ chạy là thiết yếu ⇒ qua (ghi thiết yếu luôn qua)", async () => {
    daChay.mockClear();
    expect((await post("settings.x/inspection.record?batch=1", { s: "c2" })).status).toBe(200);
    expect(daChay).toHaveBeenCalledWith("inspection.record", "c2");
  });

  it("POST inspection.x,settings.upsert KHÔNG batch: tRPC không tách theo `,` ⇒ 404, settings.upsert không chạy", async () => {
    daChay.mockClear();
    const res = await fetch(`${base}/inspection.x,settings.upsert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(superjson.serialize({ s: "no-batch" })),
    });
    expect(res.status).toBe(404);
    expect(daChay).not.toHaveBeenCalled();
  });
});
