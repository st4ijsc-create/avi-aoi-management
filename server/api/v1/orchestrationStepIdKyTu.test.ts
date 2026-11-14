/**
 * Luật ĐẦU VÀO step id MỚI — đường API công khai (gọi API THẲNG, không qua UI): POST /api/v1/orchestration/workflows với step id
 * chứa "," "(" ")" xuống dòng ⇒ 400 invalid_workflow, errors nêu path + ký tự. Kiểm chạy ở SERVER (handler Express thật, mock DB/khoá).
 * Không DB thật, không thiết bị; server nghe cổng 0 trong tiến trình test và đóng ở afterAll.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineById: vi.fn(async () => undefined),
  getMachines: vi.fn(async () => []),
  getMachineByApiKey: vi.fn(async () => undefined),
}));
vi.mock("../../routers", () => ({ appRouter: { createCaller: () => ({}) } }));
vi.mock("../../_core/context", () => ({ createContext: vi.fn(async () => ({})) }));

import { createV1Router } from "./router";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown) =>
  fetch(`${base}/api/v1/orchestration/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer MASTER" },
    body: JSON.stringify(body),
  });
const def = (id: string, extra: Record<string, unknown> = {}) => ({ ref: "kt", name: "kt", steps: [{ id, type: "delay", ms: 1, ...extra }] });

describe("POST /api/v1/orchestration/workflows — id chứa ký tự cấm bị từ chối Ở SERVER", () => {
  const CA: Array<[string, string]> = [[",", '","'], ["(", '"("'], [")", '")"'], ["\n", "line feed"], ["\r", "carriage return"]];
  for (const [ky, ten] of CA) {
    it(`id "a${JSON.stringify(ky).slice(1, -1)}b" ⇒ 400 invalid_workflow, errors[0] path steps[0].id, nêu ${ten}`, async () => {
      vi.stubEnv("FOE_ENABLED", "true");
      const res = await post(def(`a${ky}b`));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_workflow");
      expect(body.error.message).toContain(ten);
      const e = body.error.details?.errors ?? body.error.errors ?? body.details?.errors;
      expect(e?.[0]?.path).toBe("steps[0].id");
      expect(e?.[0]?.code).toBe("STEP_ID_FORBIDDEN_CHAR");
    });
  }

  it("ký tự cấm nằm trong compensation ⇒ cũng bị từ chối, path …compensation.id", async () => {
    vi.stubEnv("FOE_ENABLED", "true");
    const res = await post(def("tot", { compensation: { id: "bu,tru", type: "delay", ms: 1 } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    const e = body.error.details?.errors ?? body.error.errors ?? body.details?.errors;
    expect(e?.[0]?.path).toBe("steps[0].compensation.id");
  });

  it("FOE tắt ⇒ vẫn 503 foe_disabled như cũ (luật mới không đổi cổng cờ)", async () => {
    vi.stubEnv("FOE_ENABLED", "false");
    const res = await post(def("a,b"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("foe_disabled");
  });
});

describe("POST /api/v1/orchestration/workflows — ba luật thêm bị từ chối Ở SERVER với đúng mã", () => {
  const CA: Array<[string, string, string]> = [
    ["dài 129", "d".repeat(129), "STEP_ID_TOO_LONG"],
    ['tiền tố "abort:"', "abort:x", "STEP_ID_ABORT_PREFIX"],
    ['dấu "[[A2N" ở đầu', "[[A2Nx", "STEP_ID_RESERVED_MARKER"],
  ];
  for (const [ten, id, code] of CA) {
    it(`${ten} ⇒ 400 invalid_workflow, errors[0].code ${code}`, async () => {
      vi.stubEnv("FOE_ENABLED", "true");
      const res = await post(def(id));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_workflow");
      const e = body.error.details?.errors ?? body.error.errors ?? body.details?.errors;
      expect(e?.[0]?.code).toBe(code);
      expect(e?.[0]?.path).toBe("steps[0].id");
    });
  }
});
