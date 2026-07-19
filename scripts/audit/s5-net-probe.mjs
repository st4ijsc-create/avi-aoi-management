// doc 64 S5-OPT: liệt kê JS tải khi vào /dashboard (critical path) + tổng KB. Chạy: node scripts/audit/s5-net-probe.mjs [route]
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const route = process.argv[2] ?? "/dashboard";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
await ctx.request.post(BASE + "/api/auth/login", {
  data: { username: "p1_audit_admin", password: "P1audit_2026x" },
  headers: { "Content-Type": "application/json" },
});
const page = await ctx.newPage();
const js = [];
page.on("response", async (r) => {
  const u = r.url();
  if (u.endsWith(".js") || u.includes(".js?")) {
    try { const b = await r.body(); js.push({ url: u.split("/").pop(), kb: Math.round(b.length / 1024) }); } catch { /* aborted */ }
  }
});
await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
js.sort((a, b) => b.kb - a.kb);
let total = 0;
for (const f of js) { total += f.kb; console.log(String(f.kb).padStart(6) + "K  " + f.url); }
console.log("TOTAL: " + total + "K over " + js.length + " files  (route " + route + ")");
await browser.close();
