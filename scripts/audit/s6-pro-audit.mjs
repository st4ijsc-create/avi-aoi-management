/**
 * doc 65 — audit "chuyên nghiệp ≥95%" phần MÁY-ĐO. Với mỗi màn:
 *  A. pageerror/console.error = 0
 *  B. Không lộ key i18n thô (text dạng ns.key.leaf)
 *  C. Không "undefined"/"NaN"/"[object Object]" trong text hiển thị
 *  D. Không residue dịch-máy EN-VN trên text NHÌN THẤY (whitelist từ mượn kỹ thuật)
 *  E. <html lang> đúng + document.title có nghĩa
 *  F. Touch target (thiết bị đích: panel 10.1" cảm ứng + găng): ≥90% control ≥40×40px
 *  G. Màn giám sát: có FreshnessStrip / scope chip (bất biến trung thực doc63/64)
 *  + screenshot mỗi màn cho vòng thẩm định thị giác đa-agent.
 * Kết quả: JSON per-màn → scripts/audit/.s6-results.json + PNG vào SHOTDIR.
 * Chạy: node scripts/audit/s6-pro-audit.mjs  (server :3000; account p1_audit_admin active)
 */
import { chromium } from "@playwright/test";
import fs from "fs";

const BASE = "http://localhost:3000";
const SHOTDIR = process.env.S6_SHOTS ?? "scripts/audit/.s6-shots";
fs.mkdirSync(SHOTDIR, { recursive: true });

const MONITOR_ROUTES = new Set(["/dashboard", "/andon", "/line-view", "/device-monitor", "/oee-dashboard", "/wip-dashboard", "/quality-cockpit"]);
const ROUTES = [
  "/login", "/dashboard", "/andon", "/line-view", "/device-monitor",
  "/oee-dashboard", "/wip-dashboard", "/quality-cockpit", "/history",
  "/settings", "/profile", "/sessions",
];

// Từ mượn kỹ thuật chấp nhận trong UI Việt (nhất quán toàn hệ) — không tính là residue.
const LOANWORDS = /\b(Dashboard|Email|Serial|API|OEE|Andon|MQTT|SPC|CpK|Cpk|PDF|CSV|JSON|Excel|ID|URL|Import|Export|Webhook|Topic|Broker|SSO|TOTP|QR|SDK|IoT|Sparkplug|WIP|FPY|NG|NTF|OK|KPI|Line View|SYNAPSE|AOI|AVI|ICT|FCT|SPI|SMT|MES|SCADA|HMI|PLC|Studio|Cockpit|Pareto|Yield|Gauge|Reflow|Wave|Tab|Layout|Session|Token|Client|Server|Log|Backup|Cache|Uptime|Online|Offline|Realtime|WebSocket|CPU|GPU|RAM|Rack|Slot|Firmware|Sensor|Tag|Profile|Job|Batch|Recipe|Template)\b/;
const EN_WORD = /\b(Enter|Change|Please|Setup|Regenerate|Logout|Login|Manually|Description|Message|Title|Success|Failed|Error|View|Detail|None|when|from|with|this|least|one|correct|resolution|sent|desc)\b/;
const VN_CHAR = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]/;

import { loginAuditAdmin } from "./login-totp.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
await loginAuditAdmin(ctx, BASE);
const page = await ctx.newPage();
// steady-state: nudge template đã dismiss (doc64)
await page.addInitScript(() => { try { window.localStorage.setItem("dashboardTemplate:admin:1546", "1"); } catch {} });

const results = [];
for (const route of ROUTES) {
  const errors = [];
  const onPageErr = (e) => errors.push("pageerror: " + String(e).slice(0, 200));
  const onConsole = (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); };
  page.on("pageerror", onPageErr);
  page.on("console", onConsole);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);

  const dom = await page.evaluate(() => {
    const vp = { w: innerWidth, h: innerHeight };
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const s = (n.textContent ?? "").trim();
      if (!s || s.length < 2) continue;
      const el = n.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      texts.push(s);
    }
    // Touch targets: control tương tác NHÌN THẤY trong viewport
    const ctrls = Array.from(document.querySelectorAll("button, a[href], input, select, [role=button], [role=tab]"));
    let total = 0, small = [];
    for (const el of ctrls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > vp.h) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // Skip-link sr-only (1×1 clip) là a11y ĐÚNG CHUẨN — không phải target chạm.
      if (r.width <= 2 && r.height <= 2) continue;
      total++;
      if (r.width < 40 || r.height < 40) small.push(`${(el.textContent ?? el.getAttribute("aria-label") ?? el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const hasFreshness = !!document.querySelector("[data-freshness], [class*=freshness i]") ||
      Array.from(document.querySelectorAll("span,div")).some((e) => /Trực tiếp|Đang cập nhật|Ngoại tuyến|đã lâu/.test(e.textContent ?? "") && e.getBoundingClientRect().top < 80);
    const hasScopeChip = Array.from(document.querySelectorAll("span,div,button")).some((e) => {
      const t = e.textContent ?? "";
      return (/trang này chưa lọc|Xưởng|Toàn nhà máy/.test(t)) && e.getBoundingClientRect().top < 120 && (e.getBoundingClientRect().height > 0);
    });
    return { lang: document.documentElement.lang, title: document.title, texts, touch: { total, small }, hasFreshness, hasScopeChip };
  });

  const rawKeys = dom.texts.filter((s) => /^[a-z][a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/.test(s) && !s.includes("@") && !/\d+\.\d+/.test(s)).slice(0, 10);
  const junkVals = dom.texts.filter((s) => /\bundefined\b|\bNaN\b|\[object Object\]/.test(s)).slice(0, 10);
  const residue = dom.texts.filter((s) => {
    const noLoan = s.replace(new RegExp(LOANWORDS.source, "g"), "");
    return EN_WORD.test(noLoan) && VN_CHAR.test(s);
  }).slice(0, 10);

  const touchPct = dom.touch.total ? Math.round(((dom.touch.total - dom.touch.small.length) / dom.touch.total) * 100) : 100;
  const shot = `${SHOTDIR}/${route.replace(/\//g, "_") || "_root"}.png`;
  await page.screenshot({ path: shot });

  results.push({
    route,
    checks: {
      A_noErrors: { pass: errors.length === 0, detail: errors.slice(0, 5) },
      B_noRawKeys: { pass: rawKeys.length === 0, detail: rawKeys },
      C_noJunkValues: { pass: junkVals.length === 0, detail: junkVals },
      D_noResidue: { pass: residue.length === 0, detail: residue },
      E_langTitle: { pass: dom.lang === "vi" && !!dom.title && !/vite/i.test(dom.title), detail: `lang=${dom.lang} title=${dom.title}` },
      F_touch40: { pass: touchPct >= 90, detail: `${touchPct}% (${dom.touch.small.length}/${dom.touch.total} nhỏ) vd: ${dom.touch.small.slice(0, 5).join(" | ")}` },
      ...(MONITOR_ROUTES.has(route)
        ? { G_honesty: { pass: dom.hasFreshness || dom.hasScopeChip, detail: `freshness=${dom.hasFreshness} scope=${dom.hasScopeChip}` } }
        : {}),
    },
    shot,
  });
  page.off("pageerror", onPageErr);
  page.off("console", onConsole);
  const passN = Object.values(results[results.length - 1].checks).filter((c) => c.pass).length;
  const totN = Object.keys(results[results.length - 1].checks).length;
  console.log(`${route}  ${passN}/${totN}`);
}

let pass = 0, tot = 0;
for (const r of results) for (const c of Object.values(r.checks)) { tot++; if (c.pass) pass++; }
console.log(`MACHINE SCORE: ${pass}/${tot} = ${Math.round((pass / tot) * 1000) / 10}%`);
fs.writeFileSync("scripts/audit/.s6-results.json", JSON.stringify(results, null, 2));
await browser.close();
console.log("S6 DONE");
