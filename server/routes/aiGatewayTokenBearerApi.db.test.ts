/**
 * ★★★ Đợt 4B-server — ba tuyến REST xác thực bằng TOKEN THEO NGƯỜI DÙNG (`Authorization: Bearer avgw_…`) trên CSDL
 * `_test` THẬT (cần mig 0392 + 0396):
 *
 *   POST /api/ai/client-apply/bat-dau   (phạm vi `apply`) ⇒ ĐÚNG `aiCopilotActions.batDauApDungOClient`
 *   POST /api/ai/client-apply/chot      (phạm vi `apply`) ⇒ ĐÚNG `aiCopilotActions.chotApDungOClient`
 *   POST /api/ai/gateway-token/tu-thu-hoi                  ⇒ thu hồi CHÍNH token đang trình (idempotent, audit)
 *
 * Canh, mỗi ô một hợp đồng:
 *   §1 token THIẾU `apply` ⇒ 403 `insufficient_scope` và KHÔNG một hàng sổ nào được tạo;
 *   §2 token CÓ `apply` ⇒ hàng `ai_pending_actions` gắn ĐÚNG người của token (`userId`), trạng thái `dang_ap_client`;
 *      chốt ⇒ `da_ap_client`; audit `AI_CLIENT_APPLY_STARTED` mang userId của token;
 *   §3 token của người B KHÔNG chốt được lượt của người A (409, hàng của A giữ nguyên `dang_ap_client`);
 *   §4 tự thu hồi: lần 1 ⇒ token chết (xác thực trả `thu-hoi`), một hàng audit; lần 2 ⇒ 200 `already_revoked` (không
 *      audit thêm); token rác ⇒ 401; token đã thu hồi gọi `bat-dau` ⇒ 401 `token_revoked`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { createLocalUser } from "../db/auth";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { aiGatewayTokens, aiPendingActions, auditLogs } from "../../drizzle/schema";
import { taoTokenNguoiDung, xacThucTokenNguoiDung } from "../db/aiGatewayTokens";
import { registerAiGatewayTokenBearerRoutes } from "./aiGatewayTokenBearerApi";

let uidA = 0;
let uidB = 0;
let tokA = ""; // chat + apply
let tokB = ""; // chat + apply (người B)
let tokKhongApply = ""; // chat + fim (người A)
let may: { url: string; server: Server };

const H64 = (c: string) => c.repeat(64);

async function taoNguoi(ten: string): Promise<number> {
  const bcrypt = await import("bcryptjs");
  return (
    await createLocalUser({
      username: `gw-bearer-${ten}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      passwordHash: await bcrypt.hash("Mk-gw-bearer!1", 4),
      name: `KS bearer ${ten}`,
      role: "engineer",
    })
  ).id;
}

async function taoToken(userId: number, phamVi: string[]): Promise<string> {
  const kq = await taoTokenNguoiDung({ userId, ten: "luoi-bearer", phamVi, soNgay: 1 });
  if (!kq.ok) throw new Error(`tạo token hỏng: ${kq.ma}`);
  return kq.token;
}

beforeAll(async () => {
  uidA = await taoNguoi("a");
  uidB = await taoNguoi("b");
  tokA = await taoToken(uidA, ["chat", "apply"]);
  tokB = await taoToken(uidB, ["chat", "apply"]);
  tokKhongApply = await taoToken(uidA, ["chat", "fim"]);
  const app = express();
  // `coQuyenAi` — seam: bit `ai_repo_read/canView` của vai `engineer` trên `_test` không phải thứ lưới này đo (ô mất quyền
  // nằm ở lưới đơn vị `aiGatewayTokenBearerApi.test.ts`). Mọi thứ còn lại là THẬT: tra băm, dịch vụ sổ, audit.
  registerAiGatewayTokenBearerRoutes(app, { coQuyenAi: async () => true });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => may.server.close(() => r()));
  const db = await getDb();
  if (!db) return;
  for (const id of [uidA, uidB]) {
    if (id <= 0) continue;
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, id));
    await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, id));
    await db.delete(userSecrets).where(eq(userSecrets.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

const post = (duong: string, token: string | null, than?: unknown) =>
  fetch(`${may.url}${duong}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(than ?? {}),
  });

const THAN_BAT_DAU = {
  path: "src/a.ts",
  nhanWorkspace: "repo-luoi",
  sha256Truoc: H64("a"),
  sha256Sau: H64("b"),
  tomTat: "sửa a.ts",
  soDongThem: 2,
  soDongBot: 1,
};

describe("§1 — thiếu phạm vi `apply` ⇒ 403, không ghi sổ", () => {
  it("token chat+fim gọi bat-dau ⇒ 403 insufficient_scope; 0 hàng sổ mới của người A", async () => {
    const db = (await getDb())!;
    const truoc = await db.select().from(aiPendingActions).where(eq(aiPendingActions.userId, uidA));
    const r = await post("/api/ai/client-apply/bat-dau", tokKhongApply, THAN_BAT_DAU);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("insufficient_scope");
    const sau = await db.select().from(aiPendingActions).where(eq(aiPendingActions.userId, uidA));
    expect(sau.length).toBe(truoc.length);
  });
  it("token chat+fim gọi chot ⇒ 403 (không chạm hàng nào)", async () => {
    const r = await post("/api/ai/client-apply/chot", tokKhongApply, { actionId: "x", token: "x", thanhCong: true });
    expect(r.status).toBe(403);
  });
});

describe("§2 — có `apply` ⇒ ghi sổ ĐÚNG người của token", () => {
  it("bat-dau ⇒ 200 {actionId, token}; hàng `dang_ap_client` userId = A; audit STARTED của A; chot ⇒ da_ap_client", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", tokA, THAN_BAT_DAU);
    expect(r.status).toBe(200);
    const kq = (await r.json()) as { actionId: string; token: string };
    expect(kq.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(kq.token).toBe(kq.actionId);

    const db = (await getDb())!;
    const [h] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, kq.actionId));
    expect(h).toMatchObject({ userId: uidA, userRole: "engineer", status: "dang_ap_client", tool: "ap_o_client" });
    expect(Object.keys(h.argsJson as object).sort()).toEqual(
      ["path", "sha256Sau", "sha256Truoc", "soDongBot", "soDongThem", "tomTat"].sort(),
    );
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, uidA), eq(auditLogs.action, "ai_client_apply_started")));
    expect(audit.some((a) => JSON.stringify(a).includes(kq.actionId))).toBe(true);

    const c = await post("/api/ai/client-apply/chot", tokA, { ...kq, thanhCong: true, sha256SauThat: H64("c") });
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ ok: true, status: "da_ap_client" });
    const [h2] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, kq.actionId));
    expect(h2.status).toBe("da_ap_client");
  });
  it("thân sai hình (băm không phải 64 hex) ⇒ 400, không ghi", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", tokA, { ...THAN_BAT_DAU, sha256Sau: "noi dung tep" });
    expect(r.status).toBe(400);
  });
});

describe("§3 — token người B KHÔNG chốt được lượt của người A", () => {
  it("chot bằng token B ⇒ 409 ok:false; hàng của A giữ `dang_ap_client`", async () => {
    const r = await post("/api/ai/client-apply/bat-dau", tokA, THAN_BAT_DAU);
    const kq = (await r.json()) as { actionId: string; token: string };
    const c = await post("/api/ai/client-apply/chot", tokB, { ...kq, thanhCong: false, loi: "chen ngang" });
    expect(c.status).toBe(409);
    expect(await c.json()).toMatchObject({ ok: false, status: "invalid" });
    const db = (await getDb())!;
    const [h] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, kq.actionId));
    expect(h.status).toBe("dang_ap_client");
    expect(h.userId).toBe(uidA);
  });
});

describe("§4 — tự thu hồi (idempotent, audit)", () => {
  it("lần 1 ⇒ 200 revoked; token chết; một hàng audit REVOKED; lần 2 ⇒ 200 already_revoked; dùng lại ⇒ 401 token_revoked", async () => {
    const tok = await taoToken(uidB, ["chat", "apply"]);
    const r1 = await post("/api/ai/gateway-token/tu-thu-hoi", tok);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { revoked: boolean; already_revoked: boolean; token_prefix: string };
    expect(b1).toMatchObject({ revoked: true, already_revoked: false, token_prefix: tok.slice(0, 12) });
    expect(await xacThucTokenNguoiDung(tok)).toEqual({ ok: false, ma: "thu-hoi" });

    const db = (await getDb())!;
    const [hang] = await db.select().from(aiGatewayTokens).where(eq(aiGatewayTokens.tienTo, tok.slice(0, 12)));
    expect(hang.thuHoiBoi).toBe(uidB);
    const demAudit = async () =>
      (
        await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.userId, uidB), eq(auditLogs.entityType, "ai_gateway_token"), eq(auditLogs.entityId, hang.id)))
      ).filter((a) => JSON.stringify(a).includes("AI_GATEWAY_TOKEN_REVOKED")).length;
    expect(await demAudit()).toBe(1);
    // Không bản rõ nào trong audit.
    const moiAudit = await db.select().from(auditLogs).where(eq(auditLogs.userId, uidB));
    expect(JSON.stringify(moiAudit).includes(tok)).toBe(false);

    const r2 = await post("/api/ai/gateway-token/tu-thu-hoi", tok);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ revoked: true, already_revoked: true });
    expect(await demAudit()).toBe(1);

    const r3 = await post("/api/ai/client-apply/bat-dau", tok, THAN_BAT_DAU);
    expect(r3.status).toBe(401);
    expect(((await r3.json()) as { error: { code: string } }).error.code).toBe("token_revoked");
  });
  it("token rác / không có Bearer ⇒ 401 (không chạm hàng nào)", async () => {
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", "avgw_" + "Z".repeat(43))).status).toBe(401);
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", null)).status).toBe(401);
  });
  it("tự thu hồi KHÔNG đụng token khác của cùng người", async () => {
    const t1 = await taoToken(uidA, ["chat"]);
    const t2 = await taoToken(uidA, ["chat"]);
    expect((await post("/api/ai/gateway-token/tu-thu-hoi", t1)).status).toBe(200);
    expect((await xacThucTokenNguoiDung(t2)).ok).toBe(true);
    // Sạch sẽ: số token hiệu lực vẫn đếm đúng bằng SQL (không lẫn).
    const db = (await getDb())!;
    const [d] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ai_gateway_tokens WHERE "userId" = ${uidA} AND "thuHoiLuc" IS NOT NULL`,
    )) as unknown as Array<{ n: number }>;
    expect(Number(d.n)).toBeGreaterThanOrEqual(1);
  });
});
