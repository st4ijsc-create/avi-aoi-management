/**
 * Doc 80 Đợt 1 Task 6 (XC-01) — server nhận query qua POST (allowMethodOverride) để client gửi
 * input lớn trong body thay vì URL (431). Test dựng middleware THẬT của app trên HTTP thật.
 *
 * Final wave (item 4): bản đầu của ca `trpcProcedureType` import CẢ `appRouter` thật — 18,1 s một mình và
 * quá 30 s (timeout) khi chạy chung lô ⇒ đỏ theo tải, không theo mã. Nay mọi ca chạy trên router NHỎ có
 * cùng hình dạng (namespace lồng `ir.*`/`programming.*`) qua đúng adapter + đúng middleware giấy phép;
 * cả tệp phải xong dưới 2 s. Điều còn được chứng minh: GET-mutation ⇒ 405, POST-query qua, giấy phép
 * read-only xếp lại loại thủ tục thật, `_def.procedures` chỉ tra khoá riêng. Điều KHÔNG còn chứng minh ở
 * đây: `ir.lint`/`programming.pouLint` của appRouter THẬT là query — đó là lời khai về appRouter, và đọc
 * `programmingRouter.ts`/`irRouter.ts` (`.query(`) rẻ hơn 18 s mỗi lượt chạy.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { createTrpcMiddleware, trpcProcedureType } from "./trpcAdapter";

// Final wave item 4 — hai module NẶNG mà middleware giấy phép kéo theo (`license-service`, `license-guard`
// → khoá RSA, DB…) chiếm ~2,1 s của ca giấy phép dưới đây. Thay bằng stub: middleware THẬT vẫn chạy, chỉ
// TRẠNG THÁI là giả — đúng như bản cũ đã giả `getState` bằng spy. `vi.mock` được hoist nên trạng thái
// phải nằm trong `vi.hoisted`.
const giayPhep = vi.hoisted(() => ({ state: "readonly" as string }));
vi.mock("../license/license-service", () => ({ licenseService: {} }));
vi.mock("../license/license-guard", () => ({
  licenseGuard: {
    getState: () => giayPhep.state,
    getStatus: () => ({ state: giayPhep.state, message: "", daysUntilExpiry: null, daysPastExpiry: 0 }),
  },
}));
import { licenseEnforcementMiddleware } from "../license/license-middleware";
import { ENV } from "./env";

const t = initTRPC.create({ transformer: superjson });
const ghiMutation = vi.fn();
const testRouter = t.router({
  dem: t.procedure.input(z.object({ s: z.string() })).query(({ input }) => ({ len: input.s.length })),
  ghi: t.procedure.input(z.object({ s: z.string() })).mutation(({ input }) => {
    ghiMutation(input.s);
    return { ok: true };
  }),
  // Final wave item 4 — cùng hình dạng namespace lồng như appRouter (`ir.lint` là "ir" → "lint" trong
  // `_def.procedures` phẳng), để `trpcProcedureType` được tra đúng cách nó tra trên appRouter.
  ir: t.router({
    lint: t.procedure.input(z.object({ s: z.string() })).query(({ input }) => ({ len: input.s.length })),
    transpilePreview: t.procedure.input(z.object({ s: z.string() })).query(() => ({ ok: true })),
    saveFlow: t.procedure.input(z.object({ s: z.string() })).mutation(() => ({ ok: true })),
  }),
  programming: t.router({
    pouLint: t.procedure.input(z.object({ s: z.string() })).query(() => ({ ok: true })),
    plcopenImport: t.procedure.input(z.object({ s: z.string() })).query(() => ({ ok: true })),
  }),
});

let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "200mb" }));
  app.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const batchBody = (input: unknown) => JSON.stringify({ 0: superjson.serialize(input) });

describe("createTrpcMiddleware — allowMethodOverride", () => {
  it("query qua POST (body 2 MB) ⇒ 200 và đúng kết quả", async () => {
    const s = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${base}/dem?batch=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: batchBody({ s }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ result: { data: { json: { len: number } } } }>;
    expect(json[0].result.data.json.len).toBe(s.length);
  });

  it("query qua GET vẫn chạy như cũ", async () => {
    const input = encodeURIComponent(batchBody({ s: "abc" }));
    const res = await fetch(`${base}/dem?batch=1&input=${input}`);
    expect(res.status).toBe(200);
  });

  it("mutation qua GET vẫn bị từ chối (override chỉ mở POST cho query, không mở GET cho mutation)", async () => {
    ghiMutation.mockClear();
    const input = encodeURIComponent(batchBody({ s: "abc" }));
    const res = await fetch(`${base}/ghi?batch=1&input=${input}`);
    expect(res.status).toBe(405);
    expect(ghiMutation).not.toHaveBeenCalled();
  });
});

describe("trpcProcedureType — tra loại thủ tục trên router lồng (cùng hình dạng appRouter, không import appRouter)", () => {
  it("ir/pou preview là query, saveFlow là mutation, path lạ ⇒ undefined", () => {
    expect(trpcProcedureType(testRouter, "ir.lint")).toBe("query");
    expect(trpcProcedureType(testRouter, "ir.transpilePreview")).toBe("query");
    expect(trpcProcedureType(testRouter, "programming.pouLint")).toBe("query");
    expect(trpcProcedureType(testRouter, "programming.plcopenImport")).toBe("query");
    expect(trpcProcedureType(testRouter, "ir.saveFlow")).toBe("mutation");
    expect(trpcProcedureType(testRouter, "dem")).toBe("query");
    expect(trpcProcedureType(testRouter, "ghi")).toBe("mutation");
    expect(trpcProcedureType(testRouter, "khong.tonTai")).toBeUndefined();
    // Chỉ khoá RIÊNG của bản đồ phẳng: tên trên prototype không bao giờ khớp (fail-closed ở middleware).
    expect(trpcProcedureType(testRouter, "__proto__")).toBeUndefined();
    expect(trpcProcedureType(testRouter, "constructor")).toBeUndefined();
    expect(trpcProcedureType(testRouter, "toString")).toBeUndefined();
    // Namespace không phải thủ tục.
    expect(trpcProcedureType(testRouter, "ir")).toBeUndefined();
  });
});

describe("license readonly + POST-query — chuỗi middleware như index.ts", () => {
  it("POST-query qua, POST-mutation bị 403 LICENSE_READONLY", async () => {
    const bypassCu = ENV.licenseBypass;
    (ENV as { licenseBypass: boolean }).licenseBypass = false;
    giayPhep.state = "readonly";
    const app = express();
    app.use(express.json({ limit: "200mb" }));
    app.use("/api/trpc", licenseEnforcementMiddleware({ procedureType: (p) => trpcProcedureType(testRouter, p) }));
    app.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/trpc`;
    try {
      ghiMutation.mockClear();
      const post = (proc: string) =>
        fetch(`${b}/${proc}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: batchBody({ s: "y".repeat(5000) }) });
      expect((await post("dem")).status).toBe(200);
      const m = await post("ghi");
      expect(m.status).toBe(403);
      expect(((await m.json()) as { error: { code: string } }).error.code).toBe("LICENSE_READONLY");
      expect(ghiMutation).not.toHaveBeenCalled();
    } finally {
      (ENV as { licenseBypass: boolean }).licenseBypass = bypassCu;
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe("index.ts gắn đúng middleware của task (dòng giữ nguyên số)", () => {
  it("/api/trpc dùng createTrpcMiddleware + license middleware nhận procedureType", () => {
    const src = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    expect(src).toMatch(/app\.use\("\/api\/trpc", licenseEnforcementMiddleware\(\{ procedureType: \(p\) => trpcProcedureType\(appRouter, p\) \}\)\);/);
    expect(src).toMatch(/"\/api\/trpc",\s*\n\s*createTrpcMiddleware\(\{/);
    expect(src).not.toMatch(/\bcreateExpressMiddleware\(/);
  });
});
