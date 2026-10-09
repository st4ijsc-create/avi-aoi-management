/**
 * doc 81 Đợt 3b final wave (post-review, chủ dự án duyệt) — open redirect CÓ SẴN ở SAML: `GET /api/saml/login?redirect=` và
 * `RelayState` của `POST /api/saml/acs` nhận mọi chuỗi bắt đầu "/" ⇒ "//evil.example" (URL cùng giao thức tới máy KHÁC) lọt
 * vào `res.redirect`. Nay cả hai đi qua `samlRelayTarget` = `safeInternalPath` (shared/internalPath.ts) ⇒ không hợp lệ ⇒ "/".
 * Oracle: luật WHATWG viết tay (như shared/internalPath.test.ts) + một lượt HTTP thật trên route đăng nhập.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { registerSamlRoutes, samlRelayTarget } from "./samlProvider";

const BAD = [
  ["// cùng giao thức", "//evil.example/x"],
  ["gạch chéo ngược", "/\\evil.example"],
  ["đoạn chấm ⇒ //", "/..//evil.example"],
  ["đoạn chấm mã hoá ⇒ //", "/%2e%2e//evil.example"],
  ["URL tuyệt đối", "https://evil.example/x"],
  ["javascript:", "javascript:alert(1)"],
  ["TAB ⇒ //", "/\t/evil.example"],
  ["rỗng", ""],
] as const;

describe("samlRelayTarget — đích sau đăng nhập SAML chỉ là đường NỘI BỘ", () => {
  it.each(BAD)("chặn %s ⇒ '/'", (_n, raw) => {
    expect(samlRelayTarget(raw)).toBe("/");
  });
  it.each([undefined, null, 42, ["/x"]])("không phải chuỗi ⇒ '/' (%s)", (v) => {
    expect(samlRelayTarget(v as unknown)).toBe("/");
  });
  it("đường nội bộ hợp lệ được GIỮ", () => {
    expect(samlRelayTarget("/engineering-changes?flyout=ecn&flyoutId=12")).toBe("/engineering-changes?flyout=ecn&flyoutId=12");
  });

  it("samlProvider.ts: CẢ HAI chỗ (login ?redirect= và ACS RelayState) đi qua samlRelayTarget; không còn startsWith('/') trần", () => {
    const src = fs.readFileSync(path.join(__dirname, "samlProvider.ts"), "utf8");
    expect(src).not.toMatch(/\.startsWith\(\s*["']\/["']\s*\)/);
    expect(src).toMatch(/samlRelayTarget\(req\.query\.redirect\)/);
    expect(src).toMatch(/res\.redirect\(302,\s*samlRelayTarget\(/);
  });
});

describe("GET /api/saml/login — HTTP thật: RelayState gửi IdP", () => {
  const saved: Record<string, string | undefined> = {};
  const ENV = { SAML_ENABLED: "true", SAML_IDP_SSO_URL: "https://idp.example/sso", SAML_IDP_ENTITY_ID: "idp" };
  let base = "";
  let close: () => void = () => undefined;
  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const app = express();
    registerSamlRoutes(app);
    const srv = app.listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    close = () => srv.close();
  });
  afterAll(() => {
    close();
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const relayOf = async (redirect: string) => {
    const res = await fetch(`${base}/api/saml/login?redirect=${encodeURIComponent(redirect)}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    return new URL(res.headers.get("location")!).searchParams.get("RelayState");
  };
  it.each(BAD.filter(([, r]) => r !== ""))("redirect=%s ⇒ RelayState '/'", async (_n, raw) => {
    expect(await relayOf(raw)).toBe("/");
  });
  it("redirect nội bộ ⇒ RelayState giữ nguyên", async () => {
    expect(await relayOf("/recipes?filter=pending")).toBe("/recipes?filter=pending");
    void zlib;
  });
});
