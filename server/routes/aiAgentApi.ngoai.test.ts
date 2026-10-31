/**
 * ★ Đợt 10.4b L3 (rà kiem-dinh n19/n20) — mức ROUTE của `POST /api/ai/agent/runs` cho lượt model ngoài: `xacNhanVanHanh` của thân yêu cầu
 * PHẢI tới `taoLuotChay` (thiếu ⇒ 428 mãi), và thân lỗi trước SSE PHẢI mang `muc` (428) / `tranVuot` (429) đúng `LoiTruocSse` (u1).
 * Quản lý lượt chạy GIẢ (chỉ ghi đầu vào, trả từ chối định sẵn) — route là thứ được đo.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return {
    ...that,
    thuXacThucRest: async (req: { headers?: Record<string, unknown> }) => {
      const id = Number(req.headers?.["x-thu-nguoi"] ?? 0);
      if (!id) return { ok: false, ma: 401, lyDo: "AUTH_REQUIRED" };
      return { ok: true, user: { id, role: "admin", name: "Thu" } };
    },
  };
});

import { registerAiAgentRoutes } from "./aiAgentApi";
import type { KetQuaTaoLuotChay, QuanLyLuotChay, YeuCauTaoLuotChay } from "../services/ai/agent/quanLyLuotChay";

const nhan: YeuCauTaoLuotChay[] = [];
let traVe: KetQuaTaoLuotChay = { ok: false, ma: "CHON_MODEL_KHONG_CO", http: 404 };
const qlGia = { taoLuotChay: async (y: YeuCauTaoLuotChay) => (nhan.push(y), traVe) } as unknown as QuanLyLuotChay;

let srv: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAiAgentRoutes(app, qlGia);
  srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => {
  srv?.close();
});

const post = (than: Record<string, unknown>) =>
  fetch(`${base}/api/ai/agent/runs`, { method: "POST", headers: { "content-type": "application/json", "x-thu-nguoi": "7" }, body: JSON.stringify(than) });

describe("POST /api/ai/agent/runs — lượt model ngoài ở mức route", () => {
  it("n19 — xacNhanVanHanh của thân tới taoLuotChay NGUYÊN giá trị (route không tự ép kiểu)", async () => {
    nhan.length = 0;
    for (const x of [true, "true", 1]) await post({ cauHoi: "q", cheDo: "hoi", chonModel: "ngoai:openai:gpt-test", xacNhanVanHanh: x });
    await post({ cauHoi: "q", cheDo: "hoi", chonModel: "ngoai:openai:gpt-test" });
    expect(nhan.map((y) => y.xacNhanVanHanh)).toEqual([true, "true", 1, undefined]);
    expect(nhan[0]!.chonModel).toBe("ngoai:openai:gpt-test");
  });

  it("n20 — 428 mang muc; 429 mang tranVuot; lỗi cũ không có hai trường đó", async () => {
    traVe = { ok: false, ma: "CAN_XAC_NHAN_VAN_HANH", http: 428, muc: "van-hanh" };
    const a = await post({ cauHoi: "q", cheDo: "hoi", chonModel: "ngoai:openai:gpt-test" });
    expect([a.status, await a.json()]).toEqual([428, { success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" }]);
    traVe = { ok: false, ma: "NGOAI_VUOT_TRAN", http: 429, tranVuot: "nha-may" };
    const b = await post({ cauHoi: "q", cheDo: "hoi", chonModel: "ngoai:openai:gpt-test" });
    expect([b.status, await b.json()]).toEqual([429, { success: false, code: "NGOAI_VUOT_TRAN", tranVuot: "nha-may" }]);
    traVe = { ok: false, ma: "CHE_DO_SAI", http: 400 };
    const c = await post({ cauHoi: "q", cheDo: "x" });
    expect([c.status, await c.json()]).toEqual([400, { success: false, code: "CHE_DO_SAI" }]);
  });
});
