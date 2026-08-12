/**
 * WS-2 — Edge download proxy tests.
 *
 *   - machine A cannot download machine B's deployment → 403
 *   - missing/invalid apiKey → 401
 *   - HTTP Range request (local storage) → 206 Partial Content
 *
 * The proxy uses dynamic import() for its deps, so we mock the resolved module
 * specifiers. We capture the registered handler from a fake Express app and
 * invoke it with stub req/res.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-2** — **FACTORY, KHÔNG AUTOMOCK, CHO BỀ MẶT CHỨA `db/auth`.**
 *
 * Dòng này trước đây là `vi.mock("../server/db")` **không factory** ⇒ vitest **automock** toàn bộ
 * bề mặt của thùng `server/db/index.ts`, và thùng ấy `export * from "./auth"`. Đo được:
 *
 *     typeof db.phaiDoiMatKhau      = function     ← khoá CÓ MẶT
 *     db.phaiDoiMatKhau(1)          => undefined   ← KHÔNG ném
 *     biChanBoiCongDoiMatKhau('user', undefined) = false
 *     chanNeuPhaiDoiMatKhau(...)    => KHÔNG NÉM   ← **CỔNG MỞ, IM LẶNG**
 *
 * ⇒ Automock là hình dạng **không thể ồn ào theo cấu tạo**: một hàm **có thật** trả `undefined`.
 *   Với factory, khoá thiếu là khoá **VẮNG MẶT** ⇒ `db.x is not a function` ⇒ vết ngăn xếp trỏ
 *   thẳng vào dòng sản phẩm. File này chỉ cần **một** khoá; khai đúng một khoá.
 * ⚠ Lượng từ canh chuyện này: `server/_core/mockKhongFactory.test.ts`.
 */
vi.mock("../server/db", () => ({
  getMachineByApiKey: vi.fn(),
}));
vi.mock("../server/db/aiAdvanced");
vi.mock("../server/storage");

import * as db from "../server/db";
import * as aiAdvancedDb from "../server/db/aiAdvanced";
import * as storage from "../server/storage";
import { registerEdgeDownloadRoute } from "../server/routes/edgeDownload";

// Capture the GET handler the route registers.
function buildHandler() {
  let handler: any;
  const app: any = {
    get: (path: string, h: any) => {
      if (path === "/api/edge/download/:deploymentId") handler = h;
    },
  };
  registerEdgeDownloadRoute(app);
  return handler;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, any>,
    headersSent: false,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: any) { this.body = obj; this.headersSent = true; return this; },
    setHeader(k: string, v: any) { this.headers[k] = v; },
    end(data?: any) { this.body = data; this.headersSent = true; return this; },
  };
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("edge download proxy", () => {
  it("rejects missing apiKey with 401", async () => {
    const handler = buildHandler();
    const req: any = { params: { deploymentId: "1" }, headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid apiKey with 401", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue(undefined);
    const handler = buildHandler();
    const req: any = { params: { deploymentId: "1" }, headers: { "x-api-key": "bad" }, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when deployment belongs to a different machine", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue({ id: 7, code: "MACH-A" });
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      id: 1, machineId: 99, deviceId: "MACH-B", packageKey: "models/edge-packages/1/v1.pkg",
    });
    const handler = buildHandler();
    const req: any = { params: { deploymentId: "1" }, headers: { "x-api-key": "key-A" }, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("serves a Range request as 206 Partial Content (local storage)", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue({ id: 7, code: "MACH-A" });
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      id: 1, machineId: 7, deviceId: "MACH-A", modelId: 10, packageVersion: "v1",
      packageHash: "abc", status: "DEPLOYED", packageKey: "models/edge-packages/10/v1.pkg",
    });
    (aiAdvancedDb.updateEdgeDeployment as any).mockResolvedValue({});
    (storage.storageGet as any).mockResolvedValue({ key: "k", url: "/uploads/models/edge-packages/10/v1.pkg" });

    // Stub the disk read path.
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 1000 } as any);
    const fakeStream: any = { pipe: vi.fn() };
    vi.spyOn(fs, "createReadStream").mockReturnValue(fakeStream);

    const handler = buildHandler();
    const req: any = {
      params: { deploymentId: "1" },
      headers: { "x-api-key": "key-A", range: "bytes=0-499" },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 0-499/1000");
    expect(res.headers["Content-Length"]).toBe(500);
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
    expect(fs.createReadStream).toHaveBeenCalledWith(expect.any(String), { start: 0, end: 499 });
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  it("serves full file as 200 when no Range header (local storage)", async () => {
    (db.getMachineByApiKey as any).mockResolvedValue({ id: 7, code: "MACH-A" });
    (aiAdvancedDb.getEdgeDeployment as any).mockResolvedValue({
      id: 2, machineId: 7, deviceId: "MACH-A", modelId: 10, packageVersion: "v1",
      packageHash: "abc", status: "DEPLOYED", packageKey: "models/edge-packages/10/v1.pkg",
    });
    (storage.storageGet as any).mockResolvedValue({ key: "k", url: "/uploads/models/edge-packages/10/v1.pkg" });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 1000 } as any);
    const fakeStream: any = { pipe: vi.fn() };
    vi.spyOn(fs, "createReadStream").mockReturnValue(fakeStream);

    const handler = buildHandler();
    const req: any = { params: { deploymentId: "2" }, headers: { "x-api-key": "key-A" }, query: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Length"]).toBe(1000);
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });
});
