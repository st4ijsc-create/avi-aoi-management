/**
 * scripts/kiem-vo-app-https.test.ts — lưới cho cổng "vỏ app KHÔNG tải tài nguyên từ mạng ngoài" (Đợt 43, G117 / RB-5).
 *
 * Ba tầng, theo thứ tự tin cậy:
 *   (1) Bộ dò phải KÊU trên ca dương đã biết — đúng 4 <link> Google Fonts / jsdelivr của vỏ cũ (HEAD 76b4bff6,
 *       nguyên nhân a6b HỎNG 2 vp + p6 treo 29′ ở QA Đợt 42) — và IM trên chuỗi "https://" trong <script> nội tuyến
 *       (runtime nhúng của React có "https://react.dev/errors/"; đó là chuỗi, trình duyệt không tải). Một cổng
 *       không biết kêu trên ca dương thì "xanh" không là bằng chứng (G111).
 *   (2) NGUỒN vỏ app: client/index.html + client/public/{sw.js,manifest.webmanifest} — 0 http(s):// THÔ (nghiêm
 *       hơn (3): nguồn do ta viết, không có lý do chứa CDN kể cả trong chú thích).
 *   (3) dist/public/index.html (nếu đã build): 0 tài nguyên ngoài. Bước cuối `npm run build` chạy CLI cùng bộ
 *       dò và tệp THIẾU ⇒ build đỏ, nên tầng này không "xanh vì mù" khi chưa build.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kiemTep, kiemVoAppKhongHttps, REPO_ROOT, TEP_MAC_DINH } from "./kiem-vo-app-https.mjs";

const VO_CU = `<!doctype html><html><head>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/default-machine-2d.svg" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
    />
    <script>var v="https://react.dev/errors/"+C;</script>
  </head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

describe("kiemVoAppKhongHttps — bộ dò (tầng 1: ca dương/âm đã biết)", () => {
  it("KÊU đúng 4 <link> ra ngoài của vỏ cũ HEAD 76b4bff6; chuỗi trong <script> nội tuyến chỉ được đếm", () => {
    const r = kiemVoAppKhongHttps(VO_CU);
    expect(r.taiNguyen).toHaveLength(4);
    expect(r.taiNguyen.join("\n")).toMatch(/fonts\.googleapis\.com\/css2\?family=Geist/);
    expect(r.taiNguyen.join("\n")).toMatch(/cdn\.jsdelivr\.net/);
    expect(r.taiNguyen.join("\n")).toMatch(/fonts\.gstatic\.com/);
    expect(r.chuoiKhac).toBe(1);
    expect(r.tongHttps).toBe(5);
    expect(r.metaCsp).toEqual([]);
  });
  it("IM khi bỏ đúng 4 <link> đó (phần còn lại của vỏ cũ là cùng gốc)", () => {
    const vo = VO_CU.replace(/<link rel="preconnect"[^>]*>/g, "").replace(/<link\s+rel="stylesheet"[\s\S]*?\/>/, "");
    const r = kiemVoAppKhongHttps(vo);
    expect(r.taiNguyen).toEqual([]);
    expect(r.chuoiKhac).toBe(1);
  });
  it.each([
    ['<script src="https://cdn.example.com/x.js"></script>', "script src"],
    ['<script src="//cdn.example.com/x.js"></script>', "script src protocol-relative"],
    ["<script src=https://cdn.example.com/x.js></script>", "script src không ngoặc"],
    ['<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />', "link preconnect (gợi ý cũng là phụ thuộc)"],
    ['<img src="https://x.test/a.png" />', "img src"],
    ['<img srcset="/a.png 1x, https://x.test/a@2x.png 2x" />', "img srcset — URL ngoài ở GIỮA giá trị"],
    ["<iframe src='https://x.test/'></iframe>", "iframe src ngoặc đơn"],
    ['<video poster="https://x.test/p.jpg"></video>', "video poster"],
    ['<object data="https://x.test/o.swf"></object>', "object data"],
    ["<style>@font-face{src:url(https://fonts.gstatic.com/a.woff2)}</style>", "url() trong <style>"],
    ["<style>@import url('https://fonts.googleapis.com/css2?family=Geist');</style>", "@import url() trong <style>"],
    ['<style>@import "https://fonts.googleapis.com/css2?family=Geist";</style>', "@import chuỗi trong <style>"],
  ])("KÊU trên %s (%s)", (the) => {
    expect(kiemVoAppKhongHttps(`<html><head>${the}</head></html>`).taiNguyen).toHaveLength(1);
  });
  it.each([
    ['<link rel="apple-touch-icon" href="/default-machine-2d.svg" />', "cùng gốc"],
    ['<script type="module" src="/src/main.tsx"></script>', "cùng gốc (module)"],
    ['<div data-src="https://x.test"></div>', "thẻ không tải tài nguyên"],
    ['<script data-src="https://x.test"></script>', "data-src không phải src (lookbehind)"],
    ['<script>fetch("https://x.test")</script>', "chuỗi trong script nội tuyến"],
    ["<!-- https://x.test trong chú thích -->", "chú thích"],
    ['<a href="https://x.test">x</a>', "<a> điều hướng, không tải khi render"],
  ])("IM trên %s (%s)", (the) => {
    expect(kiemVoAppKhongHttps(`<html><head>${the}</head></html>`).taiNguyen).toEqual([]);
  });
  it("<meta http-equiv=Content-Security-Policy> chứa https:// được LIỆT KÊ, không tính lỗi, không tính chuỗi khác", () => {
    const r = kiemVoAppKhongHttps('<meta http-equiv="Content-Security-Policy" content="font-src https://fonts.gstatic.com" />');
    expect(r.taiNguyen).toEqual([]);
    expect(r.metaCsp).toHaveLength(1);
    expect(r.chuoiKhac).toBe(0);
  });
});

describe("vỏ app NGUỒN (tầng 2) — 0 http(s):// thô", () => {
  it.each(["client/index.html", "client/public/sw.js", "client/public/manifest.webmanifest"])("%s", (tep) => {
    const r = kiemVoAppKhongHttps(readFileSync(resolve(REPO_ROOT, tep), "utf8"));
    expect(r.taiNguyen).toEqual([]);
    expect(r.tongHttps).toBe(0);
  });
  it("client/index.html không còn chữ fonts.googleapis / fonts.gstatic / cdn.jsdelivr (kể cả trong chú thích)", () => {
    expect(readFileSync(resolve(REPO_ROOT, "client/index.html"), "utf8")).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/);
  });
  it("client/src/fonts.css tự phục vụ Geist + Geist Mono (5 + 6 @font-face, woff2 từ @fontsource-variable, 0 http(s)://)", () => {
    const css = readFileSync(resolve(REPO_ROOT, "client/src/fonts.css"), "utf8");
    expect(css.match(/font-family: "Geist";/g)).toHaveLength(5);
    expect(css.match(/font-family: "Geist Mono";/g)).toHaveLength(6);
    expect(css.match(/url\("@fontsource-variable\/geist(-mono)?\/files\/[a-z0-9-]+\.woff2"\)/g)).toHaveLength(11);
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toMatch(/font-display: swap;/);
  });
  it("main.tsx import ./fonts.css TRƯỚC ./index.css (nơi --font-sans dùng tên Geist)", () => {
    const main = readFileSync(resolve(REPO_ROOT, "client/src/main.tsx"), "utf8");
    expect(main.indexOf('import "./fonts.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('import "./fonts.css"')).toBeLessThan(main.indexOf('import "./index.css"'));
  });
});

describe("dist/public/index.html (tầng 3) — sản phẩm build", () => {
  const tep = resolve(REPO_ROOT, "dist/public/index.html");
  it.skipIf(!existsSync(tep))("0 tài nguyên ngoài (chuỗi trong runtime nhúng chỉ được đếm)", () => {
    const [r] = kiemTep(["dist/public/index.html"]);
    expect(r.thieu).toBe(false);
    expect(r.taiNguyen).toEqual([]);
  });
  it("TEP_MAC_DINH của CLI (bước cuối `npm run build`) gồm cả nguồn lẫn dist; tệp thiếu ⇒ thieu=true (không im lặng)", () => {
    expect(TEP_MAC_DINH).toEqual(["client/index.html", "dist/public/index.html"]);
    expect(kiemTep(["khong/co/tep-nay.html"])[0].thieu).toBe(true);
  });
});
