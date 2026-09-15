// ★ F1e — ABLATION LIỀU–ĐÁP cho `commandCenter.hierarchy` (thủ tục ăn 1,7 s ở F1d).
//   Sáu tài khoản = sáu CỠ DỮ LIỆU khác nhau trên CÙNG server, CÙNG thủ tục, CÙNG lúc:
//   khonggan 0 máy · congnhan 328 · quanly 371 · kythuat 780 · giamdoc 1.108 · admin 1.150 (kể cả SIM-FAC 41).
//   Nếu ms tăng theo số máy ⇒ chi phí DO CỠ DỮ LIỆU (26×), không phải do môi trường đo.
//   Đối chứng cùng thiết bị: `andon.active` + `permissions.getMyPermissions` phải KHÔNG tăng theo cỡ.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, p as pct } from "./lib-F.mjs";

const LUOT = Number(arg("luot", "3"));
const TKS = [
  ["qatd_khonggan", 0], ["qatd_congnhan", 328], ["qatd_quanly", 371], ["qatd_kythuat", 780], ["qatd_giamdoc", 1108], ["qatd_admin", 1150],
];
const THU_TUC = ["commandCenter.hierarchy", "andon.active", "permissions.getMyPermissions", "factoryCommand.overview"];

const browser = await chromium.launch();
const kq = { ca: "F1e", base: BASE, luc: new Date().toISOString(), soWorker: 1, do: [] };
try {
  const ctxs = {};
  for (const [tk] of TKS) { const ck = await layCookie(browser, tk); const c = await browser.newContext(); await c.addCookies(ck); ctxs[tk] = c; }
  for (let i = 1; i <= LUOT; i += 1) for (const [tk, may] of TKS) for (const p1 of THU_TUC) {
    const t = Date.now();
    const r = await ctxs[tk].request.get(`${BASE}/api/trpc/${p1}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null, meta: { values: ["undefined"] } } }))}`);
    const ms = Date.now() - t;
    const txt = await r.text();
    const loi = /"error"/.test(txt) ? (txt.match(/"code":"([A-Z_]+)"/) || [])[1] ?? "LOI" : null;
    kq.do.push({ tk, may, luot: i, thuTuc: p1, ms, status: r.status(), loi, coByte: txt.length });
  }
  for (const c of Object.values(ctxs)) await c.close();
  kq.tomTat = {};
  console.log("=== F1e: ms theo CỠ DỮ LIỆU (số máy trong phạm vi tenant) ===");
  for (const p1 of THU_TUC) {
    console.log(`\n  ${p1}`);
    for (const [tk, may] of TKS) {
      const ds = kq.do.filter((x) => x.tk === tk && x.thuTuc === p1);
      const v = { may, so: ds.map((x) => x.ms), p50: pct(ds.map((x) => x.ms), 50), max: Math.max(...ds.map((x) => x.ms)), loi: [...new Set(ds.map((x) => x.loi).filter(Boolean))], kb: Math.round(ds[0].coByte / 1024) };
      kq.tomTat[`${p1}/${tk}`] = v;
      console.log(`    ${tk.padEnd(16)} ${String(may).padStart(5)} máy → p50 ${String(v.p50).padStart(5)} ms · max ${String(v.max).padStart(5)} ms · ${String(v.kb).padStart(4)} KB${v.loi.length ? " · " + v.loi.join(",") : ""} · [${v.so.join(", ")}]`);
    }
  }
} finally { ghi("F1e", kq); await browser.close(); }
