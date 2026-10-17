/**
 * ★★★ Đợt 5.1 (VSCode) — phiếu của lượt agent CHẠY CỤC BỘ trong extension, trên CSDL `_test` THẬT (cần mig 0397 + 0398),
 * đi ĐẦU-CUỐI qua tuyến REST thật `POST /api/ai/client-feedback` với token `avgw_` thật (vai `avi_app`).
 *
 * Canh BẤT BIẾN:
 *   • hàng thuộc CHỦ TOKEN (không phải id trong thân), mang `nguon = 'vscode'` + `luotClient`, `runId` NULL;
 *   • IDEMPOTENT theo khoá (người, lượt client, khối): gửi lại / đổi phiếu ⇒ VẪN một hàng; văn bản lần đầu được GIỮ;
 *   • hai người cùng `luotId` ⇒ hai hàng riêng; khối khác ⇒ hàng khác; bỏ phiếu ⇒ xoá đúng hàng của mình;
 *   • bí mật trong văn bản client KHÔNG tới CSDL;
 *   • KHÔNG trộn mức tin: phiếu web (runId) với CÙNG uuid không va; tổng hợp tách `traLoi` / `traLoiVscode`; bộ đọc xuất
 *     không trả hàng vscode; danh sách của tôi mang `nguon`;
 *   • token thiếu `chat` ⇒ 403 và 0 hàng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { createLocalUser } from "./auth";
import { danhSachPhanHoiCuaToi, docHangChoXuat, ghiPhieuTraLoi, tongHopPhanHoi } from "./aiAgentFeedback";
import { taoTokenNguoiDung } from "./aiGatewayTokens";
import { aiAgentFeedback, aiGatewayTokens } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { registerAiGatewayTokenBearerRoutes } from "../routes/aiGatewayTokenBearerApi";

const BI_MAT = "sk-abcdefghijklmnopqrstuvwxyz0123";
const LUOT = randomUUID();
let uA = 0;
let uB = 0;
let tokA = "";
let tokB = "";
let tokChiApply = "";
let tenDb = "(chưa đo)";
let may: { url: string; server: Server };

async function taoNguoi(ten: string): Promise<number> {
  return (await createLocalUser({ username: `t51v-${ten}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, passwordHash: "x", name: ten, role: "engineer" })).id;
}
async function taoToken(userId: number, phamVi: string[]): Promise<string> {
  const kq = await taoTokenNguoiDung({ userId, ten: "luoi-phan-hoi", phamVi, soNgay: 1 });
  if (!kq.ok) throw new Error(`tạo token hỏng: ${kq.ma}`);
  return kq.token;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("không có CSDL");
  const [d] = (await db.execute(sql`SELECT current_database() AS d`)) as unknown as Array<{ d: string }>;
  tenDb = d!.d;
  uA = await taoNguoi("a");
  uB = await taoNguoi("b");
  tokA = await taoToken(uA, ["chat", "fim", "apply"]);
  tokB = await taoToken(uB, ["chat"]);
  tokChiApply = await taoToken(uA, ["apply"]);
  const app = express();
  // Quyền AI: lưới này canh tầng dữ liệu + khoá, không canh RBAC (lưới đơn vị đã canh 403 mất quyền).
  registerAiGatewayTokenBearerRoutes(app, { coQuyenAi: async () => true });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (may ? may.server.close(() => r()) : r()));
  const db = await getDb();
  if (!db) return;
  const ds = [uA, uB].filter((x) => x > 0);
  if (ds.length) {
    await db.delete(aiAgentFeedback).where(inArray(aiAgentFeedback.userId, ds));
    await db.delete(aiGatewayTokens).where(inArray(aiGatewayTokens.userId, ds));
    await db.delete(userSecrets).where(inArray(userSecrets.userId, ds));
    await db.delete(users).where(inArray(users.id, ds));
  }
}, 60_000);

const gui = (tok: string, than: Record<string, unknown>) =>
  fetch(`${may.url}/api/ai/client-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(than),
  });
const coBan = { luotId: LUOT, chiSoKhoi: 2, cauHoi: "Sửa hàm cộng", traLoi: "Đã sửa hàm cộng.", duAn: "repo" };

async function hangCua(userId: number) {
  const db = (await getDb())!;
  return db.select().from(aiAgentFeedback).where(eq(aiAgentFeedback.userId, userId));
}

describe("phiếu VSCode qua REST thật — chủ token, idempotent, tách nguồn", () => {
  it("CSDL là bản _test", () => {
    expect(tenDb).toMatch(/_test$/);
  });

  it("★★★ hàng thuộc CHỦ TOKEN (id lạ trong thân bị bỏ), nguon='vscode', luotClient, runId NULL; bí mật bị che", async () => {
    const r = await gui(tokA, { ...coBan, danhGia: 1, userId: uB, cauHoi: `dùng api_key=${BI_MAT}`, traLoi: `OPENAI_API_KEY=${BI_MAT}` });
    expect(r.status).toBe(200);
    const than = (await r.json()) as { ok: boolean; phieu: { nguon: string; luotClient: string; danhGia: number } };
    expect(than).toMatchObject({ ok: true, phieu: { nguon: "vscode", luotClient: LUOT, danhGia: 1 } });
    const ds = await hangCua(uA);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ nguon: "vscode", luotClient: LUOT, runId: null, chiSoTin: 2, loai: "tra-loi", projectId: "repo" });
    expect(JSON.stringify(ds[0])).not.toContain(BI_MAT);
    expect(await hangCua(uB)).toHaveLength(0);
  });

  it("★★★ idempotent theo khoá: gửi lại + đổi 👎 kèm lý do ⇒ VẪN một hàng; văn bản lần đầu GIỮ nguyên", async () => {
    const r = await gui(tokA, { ...coBan, danhGia: -1, lyDo: "sai API", traLoi: "chữ KHÁC lần đầu" });
    expect(r.status).toBe(200);
    const ds = await hangCua(uA);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ danhGia: -1, lyDo: "sai API" });
    expect(ds[0]!.noiDung).not.toContain("chữ KHÁC");
  });

  it("khối khác ⇒ hàng khác; người B cùng luotId ⇒ hàng RIÊNG của B (không đè A)", async () => {
    expect((await gui(tokA, { ...coBan, chiSoKhoi: 3, danhGia: 1 })).status).toBe(200);
    expect((await gui(tokB, { ...coBan, danhGia: 1 })).status).toBe(200);
    expect(await hangCua(uA)).toHaveLength(2);
    const b = await hangCua(uB);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ danhGia: 1, luotClient: LUOT });
    expect((await hangCua(uA)).find((h) => h.chiSoTin === 2)?.danhGia).toBe(-1);
  });

  it("phiếu WEB (runId = CÙNG uuid) không va hàng vscode; tổng hợp TÁCH nguồn; xuất không trả hàng vscode; danh sách mang nguon", async () => {
    const w = await ghiPhieuTraLoi({ userId: uA, runId: LUOT, chiSoTin: 2, projectId: "repo", danhGia: 1, lyDo: null, cauHoi: "q", noiDung: "a" });
    expect(w.ok && w.hang?.nguon).toBe("web");
    const ds = await hangCua(uA);
    expect(ds.filter((h) => h.nguon === "web")).toHaveLength(1);
    expect(ds.filter((h) => h.nguon === "vscode")).toHaveLength(2);
    const t = await tongHopPhanHoi();
    expect(t!.traLoiVscode.len + t!.traLoiVscode.xuong).toBeGreaterThanOrEqual(3);
    expect(t!.traLoi.len).toBeGreaterThanOrEqual(1);
    expect((await docHangChoXuat(uA)).every((h) => h.nguon === "web")).toBe(true);
    const cua = await danhSachPhanHoiCuaToi(uA);
    expect(new Set(cua.map((p) => p.nguon))).toEqual(new Set(["web", "vscode"]));
  });

  it("bỏ phiếu (danhGia null) ⇒ xoá ĐÚNG hàng vscode của mình (web + của B còn nguyên)", async () => {
    expect((await gui(tokA, { ...coBan, chiSoKhoi: 3, danhGia: null })).status).toBe(200);
    const ds = await hangCua(uA);
    expect(ds.some((h) => h.nguon === "vscode" && h.chiSoTin === 3)).toBe(false);
    expect(ds).toHaveLength(2);
    expect(await hangCua(uB)).toHaveLength(1);
  });

  it("token thiếu phạm vi `chat` ⇒ 403 insufficient_scope, 0 hàng mới", async () => {
    const truoc = (await hangCua(uA)).length;
    const r = await gui(tokChiApply, { ...coBan, chiSoKhoi: 9, danhGia: 1 });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("insufficient_scope");
    expect(await hangCua(uA)).toHaveLength(truoc);
  });
});
