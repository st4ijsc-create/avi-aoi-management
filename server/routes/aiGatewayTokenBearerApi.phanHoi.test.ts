/**
 * ★★★ Đợt 5.1 (VSCode) — lưới ĐƠN VỊ (seam, không CSDL) cho tuyến `POST /api/ai/client-feedback` (Bearer `avgw_…`,
 * phạm vi `chat`): phiếu 👍/👎 cho câu trả lời cuối của lượt agent CHẠY CỤC BỘ trong extension. Lưới CSDL thật (hàng
 * đúng chủ token, idempotent theo khoá, tách nguồn) ở `server/db/aiAgentFeedback.client.db.test.ts`.
 *
 * Canh: cùng cửa xác thực với `client-apply` (không Bearer ⇒ 401 TRƯỚC khi đọc thân; mất quyền AI ⇒ 403; thiếu `chat` ⇒
 * 403 `insufficient_scope`); người = CHỦ TOKEN (thân mang `userId` lạ bị bỏ); thân sai / quá trần ⇒ 400 và thủ tục KHÔNG
 * được gọi; thân quá lớn ⇒ 413 khung OpenAI (không 5xx); CSDL hỏng ⇒ 503; trần theo token ⇒ 429 + Retry-After.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import type { KetQuaXacThucToken } from "../db/aiGatewayTokens";
import { registerAiGatewayTokenBearerRoutes, TRAN_PHAN_HOI_MOI_PHUT_TOKEN } from "./aiGatewayTokenBearerApi";
import { TRAN_KY_TU_CAU_HOI_CLIENT, TRAN_KY_TU_TRA_LOI_CLIENT } from "@shared/phanHoiAgent";

const T_CHAT = "avgw_" + "H".repeat(43);
const T_CHI_APPLY = "avgw_" + "I".repeat(43);
const T_KHONG_QUYEN = "avgw_" + "J".repeat(43);
const T_RPM = "avgw_" + "K".repeat(43);
const T_DB = "avgw_" + "L".repeat(43);

const BANG: Record<string, KetQuaXacThucToken> = {
  [T_CHAT]: { ok: true, tokenId: 31, userId: 601, role: "engineer", name: "KS A", phamVi: ["chat", "fim", "apply"], ten: "vscode" },
  [T_CHI_APPLY]: { ok: true, tokenId: 32, userId: 601, role: "engineer", name: "KS A", phamVi: ["apply"], ten: "chi-apply" },
  [T_KHONG_QUYEN]: { ok: true, tokenId: 33, userId: 777, role: "viewer", name: null, phamVi: ["chat"], ten: "x" },
  [T_RPM]: { ok: true, tokenId: 34, userId: 602, role: "engineer", name: "KS B", phamVi: ["chat"], ten: "rpm" },
  [T_DB]: { ok: true, tokenId: 35, userId: 603, role: "engineer", name: "KS C", phamVi: ["chat"], ten: "db" },
};

const xacThucToken = vi.fn(async (t: string): Promise<KetQuaXacThucToken> => BANG[t] ?? { ok: false, ma: "khong-hop-le" });
const coQuyenAi = vi.fn(async (userId: number) => userId !== 777);
const phanHoiClient = vi.fn(async (u: { id: number }, _vao: unknown) =>
  u.id === 603 ? { ok: false as const, note: "DB_LOI" as const, phieu: null } : { ok: true as const, note: null, phieu: null },
);

let may: { url: string; server: Server };
beforeAll(async () => {
  const app = express();
  registerAiGatewayTokenBearerRoutes(app, { xacThucToken, coQuyenAi, ghiDung: vi.fn(), phanHoiClient });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(() => new Promise<void>((r) => may.server.close(() => r())));
beforeEach(() => vi.clearAllMocks());

const DUONG = "/api/ai/client-feedback";
const THAN = {
  luotId: "0f0e0d0c-0b0a-4908-8706-050403020100",
  chiSoKhoi: 1,
  danhGia: -1,
  lyDo: "sai API",
  cauHoi: "Sửa hàm cộng",
  traLoi: "Đã sửa hàm cộng.",
  duAn: "repo",
};
const post = (auth: string | null, than: unknown = THAN) =>
  fetch(`${may.url}${DUONG}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: typeof than === "string" ? than : JSON.stringify(than),
  });
const ma = async (r: Response) => ((await r.json()) as { error?: { code?: string } }).error?.code;

describe("POST /api/ai/client-feedback — cửa xác thực Bearer, phạm vi `chat`", () => {
  it("không header ⇒ 401 invalid_api_key; không tra token, không gọi thủ tục", async () => {
    const r = await post(null);
    expect(r.status).toBe(401);
    expect(await ma(r)).toBe("invalid_api_key");
    expect(xacThucToken).not.toHaveBeenCalled();
    expect(phanHoiClient).not.toHaveBeenCalled();
  });

  it("key chung (không `avgw_`) ⇒ 401 — phiếu cần MỘT người", async () => {
    expect((await post("Bearer KEY-CHUNG")).status).toBe(401);
    expect(xacThucToken).not.toHaveBeenCalled();
  });

  it("token thiếu phạm vi `chat` ⇒ 403 insufficient_scope; thủ tục KHÔNG được gọi", async () => {
    const r = await post(`Bearer ${T_CHI_APPLY}`);
    expect(r.status).toBe(403);
    expect(await ma(r)).toBe("insufficient_scope");
    expect(phanHoiClient).not.toHaveBeenCalled();
  });

  it("chủ token mất quyền AI ⇒ 403 permission_denied", async () => {
    const r = await post(`Bearer ${T_KHONG_QUYEN}`);
    expect(r.status).toBe(403);
    expect(await ma(r)).toBe("permission_denied");
    expect(phanHoiClient).not.toHaveBeenCalled();
  });

  it("★★★ hợp lệ ⇒ 200; người = CHỦ TOKEN — `userId` lạ trong thân bị BỎ, không bao giờ tới thủ tục", async () => {
    const r = await post(`Bearer ${T_CHAT}`, { ...THAN, userId: 999, nguon: "web" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: true, phieu: null });
    expect(phanHoiClient).toHaveBeenCalledTimes(1);
    const [nguoi, vao] = phanHoiClient.mock.calls[0]!;
    expect(nguoi).toMatchObject({ id: 601 });
    expect(vao).toEqual(THAN);
  });

  it("bỏ phiếu (danhGia null) là thân hợp lệ", async () => {
    expect((await post(`Bearer ${T_CHAT}`, { ...THAN, danhGia: null, lyDo: null })).status).toBe(200);
    expect(phanHoiClient.mock.calls[0]![1]).toMatchObject({ danhGia: null });
  });
});

describe("POST /api/ai/client-feedback — thân + trần", () => {
  it.each([
    ["luotId không phải uuid", { ...THAN, luotId: "run-1" }],
    ["chiSoKhoi âm", { ...THAN, chiSoKhoi: -1 }],
    ["danhGia 2", { ...THAN, danhGia: 2 }],
    ["thiếu câu trả lời", { ...THAN, traLoi: "" }],
    ["câu hỏi quá trần", { ...THAN, cauHoi: "q".repeat(TRAN_KY_TU_CAU_HOI_CLIENT + 1) }],
    ["câu trả lời quá trần", { ...THAN, traLoi: "a".repeat(TRAN_KY_TU_TRA_LOI_CLIENT + 1) }],
    ["lý do quá 2000", { ...THAN, lyDo: "l".repeat(2001) }],
  ])("%s ⇒ 400 invalid_body; thủ tục KHÔNG được gọi", async (_t, than) => {
    const r = await post(`Bearer ${T_CHAT}`, than);
    expect(r.status).toBe(400);
    expect(await ma(r)).toBe("invalid_body");
    expect(phanHoiClient).not.toHaveBeenCalled();
  });

  it("JSON hỏng ⇒ 400 khung OpenAI; thân quá lớn ⇒ 413 khung OpenAI (không 5xx, không HTML)", async () => {
    const r1 = await post(`Bearer ${T_CHAT}`, "{không phải json");
    expect(r1.status).toBe(400);
    expect(await ma(r1)).toBe("invalid_body");
    const r2 = await post(`Bearer ${T_CHAT}`, { ...THAN, traLoi: "a".repeat(3_000_000) });
    expect(r2.status).toBe(413);
    expect(await ma(r2)).toBe("body_too_large");
    expect(phanHoiClient).not.toHaveBeenCalled();
  });

  it("CSDL hỏng ⇒ 503 db_unavailable", async () => {
    const r = await post(`Bearer ${T_DB}`);
    expect(r.status).toBe(503);
    expect(await ma(r)).toBe("db_unavailable");
  });

  it(`trần THEO TOKEN (${TRAN_PHAN_HOI_MOI_PHUT_TOKEN}/phút) ⇒ 429 + Retry-After`, async () => {
    let cuoi: Response | undefined;
    for (let i = 0; i <= TRAN_PHAN_HOI_MOI_PHUT_TOKEN; i++) cuoi = await post(`Bearer ${T_RPM}`);
    expect(cuoi!.status).toBe(429);
    expect(Number(cuoi!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(phanHoiClient).toHaveBeenCalledTimes(TRAN_PHAN_HOI_MOI_PHUT_TOKEN);
  });
});
