// ★ F1d — QUY TRÁCH cho 2 s chênh của F1c. Mốc mạng cho thấy: với tài khoản KHÔNG-admin, truy vấn twin
//   (`twinCanh.danhSachToaNha,…`) chỉ BẮT ĐẦU sau khi lô `permissions.getMyPermissions,commandCenter.hierarchy,
//   aiInbox.count,andon.active,license.systemState` trả về (~2,0–2,3 s); với admin thì không chờ (admin bypass quyền).
//   tRPC httpBatchLink trả lô CHỈ KHI thủ tục CHẬM NHẤT trong lô xong ⇒ cổng quyền bị một thủ tục nặng kéo theo.
//   Phép đo: gọi TỪNG thủ tục RỜI (không lô) rồi gọi CẢ LÔ, 3 lượt, 2 tài khoản ⇒ thủ tục nào ăn 2 s.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, p as pct } from "./lib-F.mjs";

const LUOT = Number(arg("luot", "3"));
const TKS = arg("tk", "qatd_kythuat,qatd_admin").split(",");
const THU_TUC = ["permissions.getMyPermissions", "commandCenter.hierarchy", "aiInbox.count", "andon.active", "license.systemState", "sites.list"];

const browser = await chromium.launch();
const kq = { ca: "F1d", base: BASE, luc: new Date().toISOString(), soWorker: 1, do: [] };
try {
  for (const tk of TKS) {
    const ck = await layCookie(browser, tk);
    const ctx = await browser.newContext();
    await ctx.addCookies(ck);
    for (let i = 1; i <= LUOT; i += 1) {
      for (const p1 of THU_TUC) {
        const t = Date.now();
        const r = await ctx.request.get(`${BASE}/api/trpc/${p1}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null, meta: { values: ["undefined"] } } }))}`);
        const ms = Date.now() - t;
        const txt = (await r.text()).slice(0, 400);
        kq.do.push({ tk, luot: i, kieu: "roi", thuTuc: p1, ms, status: r.status(), coLoi: /"error"/.test(txt), co: txt.length });
        console.log(`  [${tk} lượt ${i}] RỜI ${p1.padEnd(32)} ${String(ms).padStart(5)} ms  (${r.status()}${/"error"/.test(txt) ? " LỖI" : ""})`);
      }
      // cả lô đúng như client gửi
      const lo = tk === "qatd_admin" ? "sites.list,commandCenter.hierarchy,aiInbox.count,andon.active,license.systemState" : "permissions.getMyPermissions,commandCenter.hierarchy,aiInbox.count,andon.active,license.systemState";
      const inp = {}; for (let k = 0; k < 5; k += 1) inp[k] = { json: null, meta: { values: ["undefined"] } };
      const t = Date.now();
      const r = await ctx.request.get(`${BASE}/api/trpc/${lo}?batch=1&input=${encodeURIComponent(JSON.stringify(inp))}`);
      const ms = Date.now() - t;
      await r.text();
      kq.do.push({ tk, luot: i, kieu: "lo", thuTuc: lo, ms, status: r.status() });
      console.log(`  [${tk} lượt ${i}] LÔ  ${String(ms).padStart(5)} ms  ← ${lo}`);
    }
    await ctx.close();
  }
  kq.tomTat = {};
  for (const tk of TKS) for (const kieu of ["roi", "lo"]) for (const p1 of [...THU_TUC, "lo"]) {
    const ds = kq.do.filter((x) => x.tk === tk && x.kieu === kieu && (kieu === "lo" ? true : x.thuTuc === p1));
    if (!ds.length) continue;
    const key = `${tk}/${kieu === "lo" ? "LÔ-5-thủ-tục" : p1}`;
    if (kq.tomTat[key]) continue;
    kq.tomTat[key] = { so: ds.map((x) => x.ms), p50: pct(ds.map((x) => x.ms), 50), max: Math.max(...ds.map((x) => x.ms)) };
  }
  console.log("\n=== F1d: ms từng thủ tục (RỜI) vs CẢ LÔ ===");
  for (const [k, v] of Object.entries(kq.tomTat)) console.log(`  ${k.padEnd(48)} p50 ${String(v.p50).padStart(5)} ms · max ${String(v.max).padStart(5)} ms · [${v.so.join(", ")}]`);
} finally { ghi("F1d", kq); await browser.close(); }
