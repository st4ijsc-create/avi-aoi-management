// ĐỢT 43 — BỌC MẠNG cho harness Playwright (G117): chặn CDN ngoài MẶC ĐỊNH, trần goto/newPage 30 s, đếm request ra ngoài.
//   import { boc, CHE_DO_MANG } from "./mang.mjs";   const browser = boc(await chromium.launch());
//   --mang=chan   (mặc định) route.abort("namenotresolved") cho fonts.googleapis.com | fonts.gstatic.com | cdn.jsdelivr.net
//                 ⇒ mạng nhà máy air-gap: DNS chết NHANH (trình duyệt coi tài nguyên đã hỏng, render tiếp).
//   --mang=treo   GIỮ request tới CDN 60 s rồi abort("timedout") ⇒ internet CHẬM — đúng điều kiện Đợt 42 (8–38 s):
//                 stylesheet render-blocking ⇒ trang trắng tới khi hết trần. Dùng cho ĐỐI CHỨNG gỡ vá.
//   --mang=cham   GIỮ request tới CDN 30 s rồi abort (yêu cầu chủ dự án — cùng bậc với trần goto 30 s).
//   --mang=thuong không chặn (đối chứng mạng thường).
//   Mọi context: setDefaultNavigationTimeout(30 000) — goto không treo vô hạn; newPage có trần 30 s (Promise.race).
//   Mọi request ra http(s):// (không phải localhost) ghi .qa-dot44/mang-ngoai/<pid>.json lúc browser.close() + in 1 dòng.
import { mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
export const CHE_DO_MANG = arg("mang", "chan");
export const CDN = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)(\/|$)/i;
export const TRAN_MS = 30_000;
const CUC_BO = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;
const ngoai = [];

const tran = (p, ten) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`[mang] ${ten} quá ${TRAN_MS} ms`)), TRAN_MS); })]).finally(() => clearTimeout(t));
};

export function boc(browser) {
  if (!["chan", "treo", "cham", "thuong"].includes(CHE_DO_MANG)) throw new Error(`--mang=${CHE_DO_MANG}? (chan|treo|thuong)`);
  const gocCtx = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const c = await gocCtx(o);
    c.setDefaultNavigationTimeout(TRAN_MS);
    if (CHE_DO_MANG !== "thuong") {
      await c.route(CDN, (r) => {
        if (CHE_DO_MANG === "treo" || CHE_DO_MANG === "cham") { const t = setTimeout(() => r.abort("timedout").catch(() => {}), CHE_DO_MANG === "cham" ? 30_000 : 60_000); t.unref?.(); }
        else r.abort("namenotresolved").catch(() => {});
      });
    }
    c.on("request", (r) => { const u = r.url(); if (/^https?:\/\//i.test(u) && !CUC_BO.test(u)) ngoai.push({ luc: new Date().toISOString(), url: u.slice(0, 200), loai: r.resourceType() }); });
    const gocPage = c.newPage.bind(c);
    c.newPage = () => tran(gocPage(), "newPage");
    return c;
  };
  const gocClose = browser.close.bind(browser);
  browser.close = async () => {
    const DIR_NGOAI = process.env.QA_MANG_NGOAI ?? ".qa-dot51/mang-ngoai";  // ĐỢT 50 G129 — ENV, không ghi đè đợt trước
    mkdirSync(DIR_NGOAI, { recursive: true });
    const host = [...new Set(ngoai.map((n) => { try { return new URL(n.url).host; } catch { return "?"; } }))];
    writeFileSync(`${DIR_NGOAI}/${process.pid}.json`, JSON.stringify({ cheDo: CHE_DO_MANG, argv: process.argv.slice(2), soNgoai: ngoai.length, host, ngoai }, null, 1));
    console.log(`   [mang=${CHE_DO_MANG}] request ra ngoài: ${ngoai.length}${host.length ? " ⇒ " + host.join(",") : ""} (${DIR_NGOAI}/${process.pid}.json)`);
    return gocClose();
  };
  return browser;
}
export const soNgoai = () => ngoai.length;
export const dsNgoai = () => ngoai.slice();
