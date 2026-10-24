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
import { createTrpcMiddleware, trpcBatchLimitMiddleware, trpcProcedureType } from "./trpcAdapter";
import { TRPC_MAX_BATCH_SIZE } from "../../shared/trpcBatch";

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

/**
 * ★★★ Trần số thủ tục trong một batch (rà bảo mật 2026-10-24: 30 lần thử TOTP trong MỘT yêu cầu HTTP lách bộ giới hạn 300/phút).
 * Vượt trần ⇒ 400 `TRPC_BATCH_QUA_LON` và KHÔNG thủ tục nào chạy; đúng trần ⇒ chạy đủ.
 */
describe("trpcBatchLimitMiddleware — trần số thủ tục trong một batch", () => {
  let srv: http.Server;
  let url = "";
  let srvMacDinh: http.Server;
  let urlMacDinh = "";
  let srvChiAdapter: http.Server;
  let urlChiAdapter = "";
  const mo = async (app: express.Express): Promise<[http.Server, string]> => {
    const s = http.createServer(app);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/trpc`];
  };
  beforeAll(async () => {
    const a1 = express();
    a1.use(express.json());
    a1.use("/api/trpc", trpcBatchLimitMiddleware(5));
    a1.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
    [srv, url] = await mo(a1);
    const a2 = express();
    a2.use(express.json());
    a2.use("/api/trpc", trpcBatchLimitMiddleware());
    a2.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
    [srvMacDinh, urlMacDinh] = await mo(a2);
    // KHÔNG gắn middleware trần riêng: chỉ lớp phòng thủ thứ hai (maxBatchSize của chính adapter)
    const a3 = express();
    a3.use(express.json());
    a3.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext: () => ({}) }));
    [srvChiAdapter, urlChiAdapter] = await mo(a3);
  });
  afterAll(async () => {
    for (const s of [srv, srvMacDinh, srvChiAdapter]) await new Promise<void>((r) => s.close(() => r()));
  });

  const duongBatch = (ten: string, n: number) => Array.from({ length: n }, () => ten).join(",");
  const bodyBatch = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), superjson.serialize({ s: "x" + i })])));

  it("★★★ batch VƯỢT trần ⇒ 400 TRPC_BATCH_QUA_LON (mã rõ, số thủ tục + trần), KHÔNG xử lý một phần: mutation không chạy cái nào", async () => {
    ghiMutation.mockClear();
    const res = await fetch(`${url}/${duongBatch("ghi", 6)}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(6) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { json: { message: string; data: { appCode: string; soThuTuc: number; tran: number; httpStatus: number } } } };
    expect(json.error.json.data).toMatchObject({ appCode: "TRPC_BATCH_QUA_LON", soThuTuc: 6, tran: 5, httpStatus: 400 });
    expect(json.error.json.message).toContain("6");
    expect(ghiMutation).not.toHaveBeenCalled();
  });

  it("★★★ batch ĐÚNG trần ⇒ chạy đủ cả 5 thủ tục", async () => {
    ghiMutation.mockClear();
    const res = await fetch(`${url}/${duongBatch("ghi", 5)}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(5) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(5);
    expect(ghiMutation).toHaveBeenCalledTimes(5);
  });

  it("★★ batch GET (query) vượt trần cũng bị chặn; dưới trần thì qua", async () => {
    const input = (n: number) => encodeURIComponent(bodyBatch(n));
    expect((await fetch(`${url}/${duongBatch("dem", 9)}?batch=1&input=${input(9)}`)).status).toBe(400);
    expect((await fetch(`${url}/${duongBatch("dem", 3)}?batch=1&input=${input(3)}`)).status).toBe(200);
  });

  it("★★★ không né được bằng mã hoá dấu phẩy (%2C)", async () => {
    ghiMutation.mockClear();
    const res = await fetch(`${url}/${duongBatch("ghi", 8).replace(/,/g, "%2C")}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(8) });
    expect(res.status).toBe(400);
    expect(ghiMutation).not.toHaveBeenCalled();
  });

  it("★★ yêu cầu ĐƠN (không batch) không bị ảnh hưởng", async () => {
    const res = await fetch(`${url}/dem?input=${encodeURIComponent(JSON.stringify(superjson.serialize({ s: "abc" })))}`);
    expect(res.status).toBe(200);
  });

  it("★★★ trần MẶC ĐỊNH = TRPC_MAX_BATCH_SIZE: đúng trần chạy, trần+1 ⇒ 400 (client chia theo cùng hằng này)", async () => {
    ghiMutation.mockClear();
    const ok = await fetch(`${urlMacDinh}/${duongBatch("ghi", TRPC_MAX_BATCH_SIZE)}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(TRPC_MAX_BATCH_SIZE) });
    expect(ok.status).toBe(200);
    expect(ghiMutation).toHaveBeenCalledTimes(TRPC_MAX_BATCH_SIZE);
    ghiMutation.mockClear();
    const qua = await fetch(`${urlMacDinh}/${duongBatch("ghi", TRPC_MAX_BATCH_SIZE + 1)}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(TRPC_MAX_BATCH_SIZE + 1) });
    expect(qua.status).toBe(400);
    expect(ghiMutation).not.toHaveBeenCalled();
  });

  it("★★ lớp phòng thủ thứ hai: KHÔNG có middleware trần riêng, adapter tRPC tự từ chối batch quá trần (400, không chạy phần nào)", async () => {
    ghiMutation.mockClear();
    const res = await fetch(`${urlChiAdapter}/${duongBatch("ghi", TRPC_MAX_BATCH_SIZE + 1)}?batch=1`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyBatch(TRPC_MAX_BATCH_SIZE + 1) });
    expect(res.status).toBe(400);
    expect(ghiMutation).not.toHaveBeenCalled();
  });

  it("★★★ index.ts gắn middleware trần TRƯỚC giấy phép/tRPC (nguồn)", () => {
    const nguon = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    const iTran = nguon.indexOf('app.use("/api/trpc", trpcBatchLimitMiddleware())');
    const iGiayPhep = nguon.indexOf('app.use("/api/trpc", licenseEnforcementMiddleware(');
    const iTrpc = nguon.indexOf("createTrpcMiddleware({\n      router: appRouter");
    expect(iTran).toBeGreaterThan(-1);
    expect(iTran).toBeLessThan(iGiayPhep);
    expect(iGiayPhep).toBeLessThan(iTrpc);
  });
});
