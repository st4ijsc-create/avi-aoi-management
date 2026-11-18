/**
 * C0-8 — Zmotion `deploy` ĐÓNG BĂNG (MODULE_PAUSED) tới khi 70 nối đường ghi qua 50.
 * Bất biến cần ghim: deploy KHÔNG chạm bộ điều khiển — không probe TCP, không ZmcLink, không nạp zauxFfi/koffi — dù đã cấu hình endpoint
 * (opts.endpoint hoặc ZMC_ENDPOINT) và build có tệp .bas. Phép đo là HÀNH VI: một máy chủ TCP cục bộ đếm số kết nối tới.
 * Đột biến: đặt MODULE_ZMOTION_DEPLOY_TAM_DUNG = false ⇒ probe nối vào máy chủ ⇒ đỏ.
 */
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZmotionBasicAdapter } from "./zmotionBasicAdapter";

let may: Server;
let ketNoi = 0;
let cong = 0;
const envCu = process.env.ZMC_ENDPOINT;

beforeEach(async () => {
  ketNoi = 0;
  may = createServer((s) => {
    ketNoi++;
    s.destroy();
  });
  await new Promise<void>((ok) => may.listen(0, "127.0.0.1", ok));
  cong = (may.address() as { port: number }).port;
});
afterEach(async () => {
  await new Promise<void>((ok) => may.close(() => ok()));
  if (envCu === undefined) delete process.env.ZMC_ENDPOINT;
  else process.env.ZMC_ENDPOINT = envCu;
});

const build = { ok: true, diagnostics: [], meta: { filePath: "D:/khong-ton-tai/x.bas" } } as never;
const hitl = { actionId: "a", requestedBy: 1, confirmedBy: 2 };
const doi = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("C0-8 Zmotion deploy — MODULE_PAUSED, không chạm thiết bị", () => {
  it("★ có opts.endpoint trỏ vào máy chủ sống + staging/production ⇒ failed MODULE_PAUSED, 0 kết nối", async () => {
    const a = new ZmotionBasicAdapter();
    for (const stage of ["staging", "production"] as const) {
      const r = await a.deploy(build, { stage, idempotencyKey: "k", endpoint: `127.0.0.1:${cong}`, hitl });
      expect(r).toMatchObject({ ok: false, status: "failed", simulated: false, detail: { reason: "MODULE_PAUSED", module: "zmotion-deploy" } });
      expect(String(r.error)).toMatch(/^MODULE_PAUSED/);
    }
    await doi(150);
    expect(ketNoi, "deploy đã nối TCP tới bộ điều khiển").toBe(0);
  });

  it("★ chỉ có ZMC_ENDPOINT (env) ⇒ cũng đóng băng, 0 kết nối", async () => {
    process.env.ZMC_ENDPOINT = `127.0.0.1:${cong}`;
    const r = await new ZmotionBasicAdapter().deploy(build, { stage: "production", idempotencyKey: "k", hitl });
    expect(r).toMatchObject({ ok: false, status: "failed", detail: { reason: "MODULE_PAUSED" } });
    await doi(150);
    expect(ketNoi).toBe(0);
  });

  it("không bao giờ trả deployed / simulated:true", async () => {
    const r = await new ZmotionBasicAdapter().deploy(build, { stage: "production", idempotencyKey: "k", endpoint: `127.0.0.1:${cong}`, hitl });
    expect(r.status).not.toBe("deployed");
    expect(r.simulated).toBe(false);
  });
});
