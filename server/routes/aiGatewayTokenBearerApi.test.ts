/**
 * ★★★ Đợt 4B-server — lưới ĐƠN VỊ (seam, không CSDL) cho ba tuyến Bearer `avgw_…` ở `aiGatewayTokenBearerApi.ts`.
 * Lưới CSDL thật (ghi sổ đúng người, chéo người, tự thu hồi) ở `aiGatewayTokenBearerApi.db.test.ts`.
 *
 * Canh: mỗi lý do token bị từ chối ⇒ ĐÚNG mã HTTP + `error.code` của cổng `/v1` (một bảng dùng chung); key chung KHÔNG
 * được nhận (sổ cần một NGƯỜI); mất quyền AI ⇒ 403; thiếu `apply` ⇒ 403 và dịch vụ KHÔNG được gọi; dịch vụ nhận ĐÚNG
 * người của token (không bao giờ từ thân yêu cầu); thân sai ⇒ 400 trước khi gọi dịch vụ; trần theo token ⇒ 429;
 * CSDL sập ⇒ 503 (fail-closed); header `Authorization` KHÔNG đi vào ngữ cảnh audit.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import type { KetQuaXacThucToken } from "../db/aiGatewayTokens";
import { registerAiGatewayTokenBearerRoutes, TRAN_APPLY_MOI_PHUT_TOKEN } from "./aiGatewayTokenBearerApi";

const T_OK = "avgw_" + "A".repeat(43);
const T_KHONG_APPLY = "avgw_" + "B".repeat(43);
const T_TAT = "avgw_" + "C".repeat(43);
const T_CSDL = "avgw_" + "D".repeat(43);
const T_KHONG_QUYEN = "avgw_" + "E".repeat(43);
const T_DOI_MK = "avgw_" + "F".repeat(43);
const T_RPM = "avgw_" + "G".repeat(43);

const BANG: Record<string, KetQuaXacThucToken> = {
  [T_OK]: { ok: true, tokenId: 21, userId: 601, role: "engineer", name: "KS A", phamVi: ["chat", "apply"], ten: "vscode" },
  [T_KHONG_APPLY]: { ok: true, tokenId: 22, userId: 601, role: "engineer", name: "KS A", phamVi: ["chat", "fim"], ten: "cu" },
  [T_TAT]: { ok: false, ma: "tai-khoan-tat" },
  [T_CSDL]: { ok: false, ma: "csdl" },
  [T_KHONG_QUYEN]: { ok: true, tokenId: 23, userId: 777, role: "viewer", name: null, phamVi: ["apply"], ten: "x" },
  [T_DOI_MK]: { ok: false, ma: "phai-doi-mat-khau" },
  [T_RPM]: { ok: true, tokenId: 24, userId: 601, role: "engineer", name: "KS A", phamVi: ["apply"], ten: "rpm" },
};

const xacThucToken = vi.fn(async (t: string): Promise<KetQuaXacThucToken> => BANG[t] ?? { ok: false, ma: "khong-hop-le" });
const coQuyenAi = vi.fn(async (userId: number) => userId !== 777);
const ghiDung = vi.fn();
const batDau = vi.fn(async (_vao?: unknown, _nguoi?: unknown, _req?: unknown) => ({ actionId: "act-1", token: "act-1" }));
const chot = vi.fn(async (_vao?: unknown, _nguoi?: unknown, _req?: unknown): Promise<{ ok: boolean; status: "da_ap_client" | "ap_client_that_bai" | "invalid"; message?: string }> => ({
  ok: true,
  status: "da_ap_client",
  message: "Đã áp vào workspace.",
}));
const tuThuHoi = vi.fn();

let may: { url: string; server: Server };
beforeAll(async () => {
  const app = express();
  registerAiGatewayTokenBearerRoutes(app, { xacThucToken, coQuyenAi, ghiDung, batDau, chot, tuThuHoi, ghiAudit: vi.fn(async () => {}) });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(() => new Promise<void>((r) => may.server.close(() => r())));
beforeEach(() => vi.clearAllMocks());

const H64 = "a".repeat(64);
const THAN = { path: "src/a.ts", nhanWorkspace: "repo", sha256Truoc: H64, sha256Sau: H64, tomTat: "x", soDongThem: 1, soDongBot: 0 };
const post = (duong: string, auth: string | null, than: unknown = THAN) =>
  fetch(`${may.url}${duong}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(than),
  });
const ma = async (r: Response) => ((await r.json()) as { error?: { code?: string } }).error?.code;

describe("xác thực Bearer — cùng bảng mã với cổng /v1", () => {
  it("không header ⇒ 401 invalid_api_key; dịch vụ không được gọi", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", null);
    expect(r.status).toBe(401);
    expect(await ma(r)).toBe("invalid_api_key");
    expect(batDau).not.toHaveBeenCalled();
  });
  it("Bearer KHÔNG phải `avgw_` (key chung cũ) ⇒ 401 — sổ cần một NGƯỜI, key chung không gắn người", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", "Bearer KEY-CHUNG-CU");
    expect(r.status).toBe(401);
    expect(xacThucToken).not.toHaveBeenCalled();
  });
  it("token lạ ⇒ 401; tài khoản tắt ⇒ 403 account_disabled; phải đổi mật khẩu ⇒ 403; CSDL sập ⇒ 503", async () => {
    expect((await post("/api/ai/client-apply/bat-dau", `Bearer avgw_${"Q".repeat(43)}`)).status).toBe(401);
    const tat = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_TAT}`);
    expect([tat.status, await ma(tat)]).toEqual([403, "account_disabled"]);
    const mk = await post("/api/ai/client-apply/chot", `Bearer ${T_DOI_MK}`, { actionId: "a", token: "a", thanhCong: true });
    expect([mk.status, await ma(mk)]).toEqual([403, "password_change_required"]);
    const cs = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_CSDL}`);
    expect([cs.status, await ma(cs)]).toEqual([503, "auth_backend_unavailable"]);
    expect(batDau).not.toHaveBeenCalled();
    expect(chot).not.toHaveBeenCalled();
  });
  it("mất quyền AI (`ai_repo_read/canView`) ⇒ 403 permission_denied", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_KHONG_QUYEN}`);
    expect([r.status, await ma(r)]).toEqual([403, "permission_denied"]);
    expect(coQuyenAi).toHaveBeenCalledWith(777, "viewer");
    expect(batDau).not.toHaveBeenCalled();
  });
  it("thiếu phạm vi `apply` ⇒ 403 insufficient_scope (cả bat-dau lẫn chot)", async () => {
    const a = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_KHONG_APPLY}`);
    expect([a.status, await ma(a)]).toEqual([403, "insufficient_scope"]);
    const b = await post("/api/ai/client-apply/chot", `Bearer ${T_KHONG_APPLY}`, { actionId: "a", token: "a", thanhCong: true });
    expect([b.status, await ma(b)]).toEqual([403, "insufficient_scope"]);
    expect(batDau).not.toHaveBeenCalled();
    expect(chot).not.toHaveBeenCalled();
  });
});

describe("gọi ĐÚNG hai hàm dịch vụ với người CỦA TOKEN", () => {
  it("bat-dau ⇒ 200 {actionId, token}; dịch vụ nhận người của token (KHÔNG từ thân — thân mang userId giả bị bỏ)", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_OK}`, { ...THAN, userId: 999, role: "admin" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ actionId: "act-1", token: "act-1" });
    expect(batDau).toHaveBeenCalledTimes(1);
    const [vao, nguoi, reqMeta] = batDau.mock.calls[0] as unknown as [Record<string, unknown>, unknown, { headers: Record<string, unknown> }];
    expect(vao).toEqual(THAN);
    expect(nguoi).toEqual({ id: 601, role: "engineer", name: "KS A" });
    // Token KHÔNG bao giờ vào ngữ cảnh audit.
    expect(JSON.stringify(reqMeta.headers ?? {})).not.toContain(T_OK);
    expect(ghiDung).toHaveBeenCalledWith(21);
  });
  it("thân sai (băm không phải sha256 / thiếu ô) ⇒ 400 invalid_body, dịch vụ không được gọi", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_OK}`, { ...THAN, sha256Sau: "noi dung tep ..." });
    expect([r.status, await ma(r)]).toEqual([400, "invalid_body"]);
    const c = await post("/api/ai/client-apply/chot", `Bearer ${T_OK}`, { actionId: "a" });
    expect([c.status, await ma(c)]).toEqual([400, "invalid_body"]);
    expect(batDau).not.toHaveBeenCalled();
    expect(chot).not.toHaveBeenCalled();
  });
  it("chot ok ⇒ 200 nguyên thân dịch vụ; ok:false ⇒ 409; DB_UNAVAILABLE ⇒ 503", async () => {
    const r = await post("/api/ai/client-apply/chot", `Bearer ${T_OK}`, { actionId: "act-1", token: "act-1", thanhCong: true, sha256SauThat: H64 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, status: "da_ap_client", message: "Đã áp vào workspace." });
    expect(chot.mock.calls[0]?.[1]).toEqual({ id: 601, role: "engineer", name: "KS A" });
    expect(chot.mock.calls[0]?.[0]).toEqual({ actionId: "act-1", token: "act-1", thanhCong: true, sha256SauThat: H64 });

    chot.mockResolvedValueOnce({ ok: false, status: "invalid", message: "Token hoặc người dùng không khớp." });
    const x = await post("/api/ai/client-apply/chot", `Bearer ${T_OK}`, { actionId: "b", token: "b", thanhCong: true });
    expect(x.status).toBe(409);
    expect(await x.json()).toMatchObject({ ok: false, status: "invalid" });

    chot.mockResolvedValueOnce({ ok: false, status: "invalid", message: "DB_UNAVAILABLE" });
    expect((await post("/api/ai/client-apply/chot", `Bearer ${T_OK}`, { actionId: "c", token: "c", thanhCong: true })).status).toBe(503);
  });
  it("bat-dau: dịch vụ ném (CSDL sập) ⇒ 503 db_unavailable, không lọt 500 thô", async () => {
    batDau.mockRejectedValueOnce(new Error("DB_UNAVAILABLE — không mở được sổ"));
    const r = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_OK}`);
    expect([r.status, await ma(r)]).toEqual([503, "db_unavailable"]);
  });
  it(`trần THEO TOKEN (${TRAN_APPLY_MOI_PHUT_TOKEN}/phút) ⇒ 429 + Retry-After`, async () => {
    let cuoi: Response | null = null;
    for (let i = 0; i <= TRAN_APPLY_MOI_PHUT_TOKEN; i++) cuoi = await post("/api/ai/client-apply/bat-dau", `Bearer ${T_RPM}`);
    expect(cuoi!.status).toBe(429);
    expect(cuoi!.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("tự thu hồi", () => {
  it("không Bearer avgw_ ⇒ 401 và KHÔNG tra CSDL; có ⇒ gọi tuThuHoi với CHÍNH token đó", async () => {
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", null, {})).status).toBe(401);
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", "Bearer KEY-CHUNG", {})).status).toBe(401);
    expect(tuThuHoi).not.toHaveBeenCalled();

    tuThuHoi.mockResolvedValueOnce({ ok: true, tokenId: 21, userId: 601, tienTo: T_OK.slice(0, 12), daThuHoiTruoc: false });
    const r = await post("/api/ai/gateway-token/tu-thu-hoi", `Bearer ${T_OK}`, {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ revoked: true, already_revoked: false, token_prefix: T_OK.slice(0, 12) });
    expect(tuThuHoi).toHaveBeenCalledWith(T_OK);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("không tồn tại ⇒ 401 invalid_api_key; CSDL sập ⇒ 503", async () => {
    tuThuHoi.mockResolvedValueOnce({ ok: false, ma: "khong-hop-le" });
    const r = await post("/api/ai/gateway-token/tu-thu-hoi", `Bearer ${T_OK}`, {});
    expect([r.status, await ma(r)]).toEqual([401, "invalid_api_key"]);
    tuThuHoi.mockResolvedValueOnce({ ok: false, ma: "csdl" });
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", `Bearer ${T_OK}`, {})).status).toBe(503);
  });
});
