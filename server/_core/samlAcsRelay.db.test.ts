/**
 * doc 81 Đợt 3c Task 3 — HTTP THẬT cho đường `RelayState` của ACS SAML (`POST /api/saml/acs`).
 *
 * Đợt 3b đã vá open redirect (`samlRelayTarget = safeInternalPath(raw) ?? "/"`) nhưng ACS chỉ được canh bằng regex trên
 * mã nguồn (samlRelay.test.ts). Tệp này POST thật vào route ACS — gắn bằng `registerOAuthRoutes` (đúng chỗ server thật gắn)
 * sau CÙNG bộ phân tích thân `express.json` + `express.urlencoded({ extended: true })` như `server/_core/index.ts` — và đọc
 * `Location` của câu trả lời 302.
 *
 * ★ CHỈ "giả" đúng MỘT chỗ — cổng kiểm CHỮ KÝ XML-DSig của assertion: repo chưa cài thư viện kiểm chữ ký (xem đầu
 *   samlProvider.ts), nên ACS mặc định trả 501. Ta tắt cổng đó bằng công tắc CỦA CHÍNH MÃ (`SAML_REQUIRE_SIGNED=false`, chỉ
 *   trên tiến trình thử) — không thay hàm nào. Mọi thứ còn lại chạy THẬT: giải base64, phân tích XML, ánh xạ hồ sơ,
 *   `upsertUser` + ghi sổ phiên trên CSDL `_test`, cookie phiên, `res.redirect`. §0 chứng minh cổng chữ ký thật sự đóng khi
 *   không bật công tắc (501, không chuyển hướng) ⇒ công tắc là thứ DUY NHẤT bị bỏ qua.
 * ★ Người dùng thử `saml:<RUN>@saml.test` + các hàng `user_sessions` của nó bị XOÁ ở afterAll (chỉ của lượt này).
 * ★ Oracle độc lập: "/" cho mọi giá trị xấu, đúng đường cho giá trị tốt — viết tay, không gọi lại `safeInternalPath`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `d3c3-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const NAME_ID = `${RUN}@saml.test`;
const OPEN_ID = `saml:${NAME_ID}`;

const ENV: Record<string, string> = {
  SAML_ENABLED: "true",
  SAML_IDP_SSO_URL: "https://idp.example/sso",
  SAML_IDP_ENTITY_ID: "idp.example",
  JWT_SECRET: process.env.JWT_SECRET || "dot3c-saml-acs-relay-secret",
};
const saved: Record<string, string | undefined> = {};
const savedRequireSigned = process.env.SAML_REQUIRE_SIGNED;

/** Một SAMLResponse tối thiểu (KHÔNG ký) — base64 như binding HTTP-POST. */
const samlResponse = Buffer.from(
  `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
    `<saml:Issuer>idp.example</saml:Issuer>` +
    `<saml:Assertion><saml:Issuer>idp.example</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${NAME_ID}</saml:NameID></saml:Subject>` +
    `<saml:AuthnStatement SessionIndex="_s1"/>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${NAME_ID}</saml:AttributeValue></saml:Attribute>` +
    `<saml:Attribute Name="displayName"><saml:AttributeValue>${RUN} SAML</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion></samlp:Response>`,
  "utf8",
).toString("base64");

let sql: ReturnType<typeof postgres>;
let base = "";
let close: () => Promise<void> = async () => undefined;

async function acs(relayState: string | undefined) {
  const body = new URLSearchParams({ SAMLResponse: samlResponse });
  if (relayState !== undefined) body.set("RelayState", relayState);
  return fetch(`${base}/api/saml/acs`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
}

describe.skipIf(!DB_URL)("POST /api/saml/acs — HTTP THẬT: RelayState ⇒ Location (Đợt 3c Task 3)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [{ d }] = await sql`SELECT current_database() AS d`;
    if (!String(d).endsWith("_test")) throw new Error(`KHÔNG chạy ngoài _test (đang ở ${d})`);
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    // Nạp SAU khi đặt JWT_SECRET (ENV của sdk đọc lúc import).
    const { registerOAuthRoutes } = await import("./oauth");
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    registerOAuthRoutes(app);
    const srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    close = () => new Promise((r) => srv.close(() => r(undefined)));
  }, 60_000);

  afterAll(async () => {
    await close();
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (savedRequireSigned === undefined) delete process.env.SAML_REQUIRE_SIGNED;
    else process.env.SAML_REQUIRE_SIGNED = savedRequireSigned;
    if (!sql) return;
    const ids = (await sql`SELECT id FROM users WHERE "openId" = ${OPEN_ID}`).map((r) => Number(r.id));
    if (ids.length) {
      await sql`DELETE FROM user_sessions WHERE "userId" = ANY(${ids})`;
      await sql`DELETE FROM users WHERE id = ANY(${ids})`;
    }
    const left = await sql`SELECT count(*)::int AS n FROM users WHERE "openId" = ${OPEN_ID}`;
    await sql.end({ timeout: 5 });
    expect(left[0].n).toBe(0);
  }, 60_000);

  it("§0 cổng chữ ký THẬT đang đóng khi không bật công tắc: 501 SAML_NOT_CONFIGURED, không Location, không tạo người dùng", async () => {
    delete process.env.SAML_REQUIRE_SIGNED;
    const res = await acs("/engineering");
    expect(res.status).toBe(501);
    expect(res.headers.get("location")).toBeNull();
    expect((await res.json()).error).toBe("SAML_NOT_CONFIGURED");
    expect((await sql`SELECT count(*)::int AS n FROM users WHERE "openId" = ${OPEN_ID}`)[0].n).toBe(0);
  });

  describe("chỉ bỏ cổng chữ ký (SAML_REQUIRE_SIGNED=false) — phần còn lại của ACS chạy thật", () => {
    beforeAll(() => {
      process.env.SAML_REQUIRE_SIGNED = "false";
    });

    it.each([
      ["//evil"],
      ["/\\evil"],
      ["/..//evil"],
      ["https://evil"],
      ["javascript:"],
    ])("RelayState %j ⇒ 302 Location '/'", async (relay) => {
      const res = await acs(relay);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    it("RelayState hợp lệ '/engineering' ⇒ 302 Location '/engineering' + cookie phiên + người dùng SAML có sổ phiên trong _test", async () => {
      const res = await acs("/engineering");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/engineering");
      expect(res.headers.get("set-cookie") ?? "").toMatch(/^app_session_id=/);
      const [u] = await sql`SELECT id, "loginMethod" FROM users WHERE "openId" = ${OPEN_ID}`;
      expect(u?.loginMethod).toBe("saml");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM user_sessions WHERE "userId" = ${u.id}`;
      expect(n).toBeGreaterThan(0);
    });

    it("không có RelayState ⇒ Location '/'", async () => {
      const res = await acs(undefined);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });
  });
});
