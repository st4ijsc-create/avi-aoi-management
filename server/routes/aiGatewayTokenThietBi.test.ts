/**
 * ★★★ Đợt 4A — device flow REST cho extension (`POST /api/ai/gateway-token/thiet-bi` + `/doi`) trên CSDL `_test` thật.
 *
 * Canh: xin mã KHÔNG cần đăng nhập nhưng có trần theo IP; đổi mã trả lỗi chuẩn RFC 8628 (`authorization_pending` ·
 * `slow_down` · `access_denied` · `expired_token` · `invalid_grant`); duyệt ⇒ đổi ra token của NGƯỜI DUYỆT, `no-store`,
 * audit một hàng (không chứa bản rõ); đổi lần hai ⇒ `invalid_grant` (dùng một lần); không trả URL dựng từ Host.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { createLocalUser } from "../db/auth";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { aiGatewayTokens, aiGatewayDeviceCodes, auditLogs } from "../../drizzle/schema";
import { quyetThietBi, xacThucTokenNguoiDung, xemThietBi, TRAN_MA_CHO_MOI_IP } from "../db/aiGatewayTokens";
import { registerAiGatewayTokenThietBiRoutes, TRAN_XIN_MA_MOI_PHUT_IP } from "./aiGatewayTokenThietBi";

let uid = 0;
let may: { url: string; server: Server };

beforeAll(async () => {
  const bcrypt = await import("bcryptjs");
  uid = (
    await createLocalUser({
      username: `gw-tb-rest-${Date.now()}`,
      passwordHash: await bcrypt.hash("Mk-gw-tb!1", 4),
      name: "KS thiet bi",
      role: "engineer",
    })
  ).id;
  const app = express();
  app.set("trust proxy", false);
  registerAiGatewayTokenThietBiRoutes(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => may.server.close(() => r()));
  const db = await getDb();
  if (!db) return;
  await db.delete(aiGatewayDeviceCodes).where(sql`ten LIKE 'luoi-rest-%'`);
  await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, uid));
  await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
  await db.delete(users).where(eq(users.id, uid));
});

const post = (duong: string, than: unknown) =>
  fetch(`${may.url}/api/ai/gateway-token/thiet-bi${duong}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
const nhaHoi = async (maNd: string) => {
  const db = (await getDb())!;
  await db.execute(sql`UPDATE ai_gateway_device_codes SET "hoiLanCuoiLuc" = NULL WHERE "maNguoiDung" = ${maNd}`);
};

describe("device flow REST", () => {
  it("xin mã ⇒ mã bí mật + mã người dùng + đường xác nhận TƯƠNG ĐỐI; chờ ⇒ authorization_pending; hỏi dồn ⇒ slow_down", async () => {
    const r = await post("", { ten: "luoi-rest-1 VSCode", phamVi: ["chat", "fim"] });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.device_code).toMatch(/^avgd_/);
    expect(b.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(b.verification_path).toBe("/ai-thiet-bi");
    // ★ Rà bảo mật de591c868 #3 — đường "complete" KHÔNG mang mã: trang duyệt không điền sẵn, người dùng phải GÕ mã
    //   hiển thị trong VSCode của CHÍNH họ (một đường dẫn mang sẵn mã là mồi lừa đảo một-cú-bấm). Giữ ô cho hợp đồng.
    expect(b.verification_path_complete).toBe("/ai-thiet-bi");
    expect(JSON.stringify(b)).not.toContain(`ma=`);
    expect(b.expires_in).toBe(600);
    expect(b.interval).toBe(5);
    expect(JSON.stringify(b)).not.toMatch(/https?:\/\//); // không dựng URL từ Host (chống chèn Host)

    const c = await post("/doi", { device_code: b.device_code });
    expect(c.status).toBe(400);
    expect((await c.json()).error).toBe("authorization_pending");
    const d = await post("/doi", { device_code: b.device_code });
    expect((await d.json()).error).toBe("slow_down");
  });

  it("duyệt ⇒ token của người duyệt, no-store, audit; đổi lần hai ⇒ invalid_grant", async () => {
    const b = await (await post("", { ten: "luoi-rest-2", phamVi: ["fim"] })).json();
    expect((await quyetThietBi(uid, b.user_code, true)).ok).toBe(true);
    await nhaHoi(b.user_code);
    const r = await post("/doi", { device_code: b.device_code });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    const t = await r.json();
    expect(t.token_type).toBe("Bearer");
    expect(t.scope).toBe("fim");
    expect(t.access_token).toMatch(/^avgw_/);
    expect(await xacThucTokenNguoiDung(t.access_token)).toMatchObject({ ok: true, userId: uid, phamVi: ["fim"] });

    const db = (await getDb())!;
    const [tk] = await db.select().from(aiGatewayTokens).where(eq(aiGatewayTokens.tienTo, t.access_token.slice(0, 12)));
    const au = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "ai_gateway_token"), eq(auditLogs.entityId, tk.id)));
    expect(au).toHaveLength(1);
    expect(au[0].userId).toBe(uid);
    expect(String(au[0].details)).toContain("AI_GATEWAY_TOKEN_CREATED");
    expect(String(au[0].details)).toContain("thiet-bi");
    expect(JSON.stringify(au[0])).not.toContain(t.access_token);

    await nhaHoi(b.user_code);
    const lai = await post("/doi", { device_code: b.device_code });
    expect(lai.status).toBe(400);
    expect((await lai.json()).error).toBe("invalid_grant");
  });

  it("từ chối ⇒ access_denied; mã rác ⇒ invalid_grant", async () => {
    const b = await (await post("", { ten: "luoi-rest-3" })).json();
    expect((await quyetThietBi(uid, b.user_code, false)).ok).toBe(true);
    expect((await (await post("/doi", { device_code: b.device_code })).json()).error).toBe("access_denied");
    expect((await (await post("/doi", { device_code: "rac" })).json()).error).toBe("invalid_grant");
    expect((await (await post("/doi", {})).json()).error).toBe("invalid_grant");
  });

  it("★ #3 lượt khởi tạo ghi NGUỒN GỐC (IP + User-Agent) cho trang duyệt; phạm vi `embed` bị cắt", async () => {
    const r = await fetch(`${may.url}/api/ai/gateway-token/thiet-bi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "luoi-ua VSCode/1.99" },
      body: JSON.stringify({ ten: "luoi-rest-nguon", phamVi: ["chat", "fim", "embed"] }),
    });
    expect(r.status).toBe(200);
    const b = await r.json();
    const xem = await xemThietBi(b.user_code);
    expect(xem).toMatchObject({ ok: true, phamVi: ["chat", "fim"], tacNhanKhoiTao: "luoi-ua VSCode/1.99" });
    expect(xem.ok && String(xem.ipKhoiTao)).toMatch(/127\.0\.0\.1/);
  });

  it("★ #3 trần mã đang CHỜ mỗi IP ⇒ 429 slow_down (không rải hàng loạt mã đi lừa)", async () => {
    const db = (await getDb())!;
    const mau = (await (await post("", { ten: "luoi-rest-cho-mau" })).json()) as { user_code: string };
    const [h] = (await db.execute(
      sql`SELECT "ipKhoiTao" AS ip FROM ai_gateway_device_codes WHERE "maNguoiDung" = ${mau.user_code}`,
    )) as unknown as Array<{ ip: string }>;
    const [dem] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ai_gateway_device_codes WHERE "ipKhoiTao" = ${h.ip} AND "trangThai" = 'cho' AND "hetHanLuc" > now()`,
    )) as unknown as Array<{ n: number }>;
    for (let i = Number(dem.n); i < TRAN_MA_CHO_MOI_IP; i++) {
      await db.execute(
        sql`INSERT INTO ai_gateway_device_codes ("maThietBiHash", "maNguoiDung", ten, "hetHanLuc", "ipKhoiTao")
            VALUES (${"0".repeat(60) + String(1000 + i)}, ${"ZZZZ-ZZ" + "BCDFGHJKLM"[i] + "Z"}, 'luoi-rest-cho-seed', now() + interval '5 minutes', ${h.ip})`,
      );
    }
    const r = await post("", { ten: "luoi-rest-cho-thua" });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("slow_down");
    // Dọn để ca sau đo đúng trần THEO PHÚT (không vướng trần mã chờ).
    await db.execute(sql`UPDATE ai_gateway_device_codes SET "trangThai" = 'tu-choi' WHERE "ipKhoiTao" = ${h.ip} AND "trangThai" = 'cho'`);
    await db.execute(sql`DELETE FROM ai_gateway_device_codes WHERE ten = 'luoi-rest-cho-seed'`);
  });

  it("xin mã dồn từ một IP ⇒ 429 sau trần", async () => {
    let cuoi = 0;
    for (let i = 0; i < TRAN_XIN_MA_MOI_PHUT_IP + 2; i++) cuoi = (await post("", { ten: "luoi-rest-tran" })).status;
    expect(cuoi).toBe(429);
  });
});
