#!/usr/bin/env node
/**
 * scripts/ui-metrics/engineeringLayout.mjs — THIẾT BỊ ĐO BỐ CỤC 14 màn "Kỹ thuật & Điều khiển"
 * (doc 81 Đợt 2 Task 1). Mọi task chuyển trang của Đợt 2 được nghiệm thu bằng số của script này.
 *
 * Đo cái gì (mỗi màn × mỗi kích thước × mỗi biến thể Copilot):
 *   · mainPct           — % khung đầu (vw×vh) mà vùng MAIN chiếm (phần nhìn thấy, cắt dưới top bar sticky)
 *   · mainSource        — "data-layout-main" (attribute chính thức) hoặc "fe1-legacy" (selector đo của FE1)
 *   · h1Top             — khoảng từ đỉnh viewport tới mép trên h1 đầu tiên nhìn thấy (px, scrollY=0)
 *   · breadcrumbs       — số breadcrumb nhìn thấy (shell + trang)
 *   · bannersBeforeMain — số/px banner (notice) nằm phía trên MAIN (định nghĩa notice của FE1)
 *   · kpi               — số thẻ KPI và chiều cao dải KPI (hộp bao các thẻ)
 *   · dialogs           — số role=dialog đang render lúc nạp + sau khi mở TỪNG hành động khai báo
 *   · aiOcclusion       — diện tích MAIN bị dock Copilot / bong bóng AI đè (px² và %)
 *   · pageHeightRatio   — chiều cao trang / chiều cao viewport
 *
 * Instance: KHÔNG dùng :3000 (chạy dist cũ). `--spawn` tự dựng server TỪ MÃ NGUỒN (tsx) ở :3016
 * + Vite dev (in-process) ở :5176, DB `aoi_management_test`, KHÔNG nạp .env (DOTENV_CONFIG_PATH trỏ
 * tệp không tồn tại), mọi tích hợp ra ngoài tắt bằng env của tiến trình con; tạo user đo tạm
 * (role engineer, quyền mẫu DEFAULT_ROLE_PERMISSIONS.engineer, gán SIM-FAC như engineer1) rồi
 * xoá; tắt hết và chứng minh cổng đã trả. Xem README.md cùng thư mục.
 *
 * Dùng:
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --out <file.json> [--shots] [--screens a,b] [--sizes 1600x950,1366x768]
 *   node scripts/ui-metrics/engineeringLayout.mjs --base http://127.0.0.1:5176 --user U --password P --out f.json
 *   node scripts/ui-metrics/engineeringLayout.mjs --compare a.json b.json [--threshold 2]
 *   node scripts/ui-metrics/engineeringLayout.mjs --fe1 run.json [--threshold 5]
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --list-buttons --out buttons.json
 */
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(REPO, "package.json"));

// ───────────────────────────────────────────────────────────────────────────────────────────
// 1. Khai báo: 14 màn, MAIN cũ (FE1), hành động mở dialog, biến thể Copilot
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * `legacyMain` — selector đo của FE1 (`.playwright-mcp/survey81/_kpi.cjs`), viết lại theo TỆP của
 * `data-loc` + loại vùng + tiêu đề thay vì số dòng (số dòng trôi sau mỗi lần sửa tệp). Chỉ dùng khi
 * trang CHƯA có `[data-layout-main]`; khi dùng, kết quả mang `mainSource: "fe1-legacy"` và script
 * in cảnh báo — không bao giờ im lặng.
 *
 * `actions` — hành động MỞ (không bao giờ lưu/gửi): bấm nút theo tên, đếm role=dialog, Esc đóng.
 * Chỉ khai nút mở form/sheet/popover; nút ghi (Duyệt, Lưu, Deploy, Chạy…) KHÔNG được khai.
 */
export const SCREENS = [
  { n: 1, id: "engineering-home", route: "/engineering-home",
    legacyMain: { desc: "PendingReviewStrip + EngineeringHub section (depth 0)", fn: (r) => r.depth === 0 && /PendingReviewStrip\.tsx|EngineeringHub\.tsx/.test(r.loc || "") && r.kind === "section" },
    actions: [] },
  { n: 2, id: "engineering-studio", route: "/engineering-studio",
    legacyMain: { desc: "WorkspaceShell resizable-panel bên phải (panel nội dung)", pick: (rs) => { const c = rs.filter((r) => /WorkspaceShell\.tsx/.test(r.loc || "") && r.kind === "resizable-panel"); if (!c.length) return []; const mx = Math.max(...c.map((r) => r.x)); return c.filter((r) => r.x === mx).slice(0, 1); } },
    actions: [] },
  // IDE: editor chỉ hiện khi đã chọn dự án ⇒ mở bằng deep-link `?projectId=` (U1 doc 26, phải còn sống
  // qua Đợt 2) tới dự án cập nhật gần nhất trong `programming.listProjects` — FE1 có dự án đã chọn sẵn.
  { n: 3, id: "engineering", route: "/engineering", copilot: true, deepLink: "firstProject",
    legacyMain: { desc: "khung CodeMirror (vùng không data-loc, có input, cao ≥200)", fn: (r) => !r.loc && r.inp >= 1 && r.h >= 200 },
    actions: [{ id: "so-tay", label: /sổ tay/i }] },
  { n: 4, id: "engineering-changes", route: "/engineering-changes",
    legacyMain: { desc: "EngineeringChanges card chứa bảng", fn: (r) => /EngineeringChanges\.tsx/.test(r.loc || "") && r.kind === "card" && r.tbl >= 1 && r.depth === 0 },
    actions: [{ id: "thay-doi-moi", label: /Thay đổi mới/ }] },
  { n: 5, id: "recipes", route: "/recipes",
    legacyMain: { desc: "RecipeManagement: card 'Mã recipe' + card cùng hàng (phiên bản)", pick: (rs) => { const a = rs.find((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && /^Mã recipe/.test(r.head)); if (!a) return []; return rs.filter((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === a.depth && Math.abs(r.y - a.y) <= 4); } },
    actions: [{ id: "luu-phien-ban-moi", label: /Lưu phiên bản mới/ }] },
  { n: 6, id: "interlock-rules", route: "/interlock-rules",
    legacyMain: { desc: "InterlockRuleManagement tabs-content đang mở", fn: (r) => /InterlockRuleManagement\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "them-quy-tac", label: /Thêm quy tắc/ }] },
  { n: 7, id: "orchestration-studio", route: "/orchestration-studio",
    legacyMain: { desc: "OrchestrationStudio card Cây/Sơ đồ + Cấu hình bước", fn: (r) => /OrchestrationStudio\.tsx/.test(r.loc || "") && r.kind === "card" && /^(Cây quy trình|Sơ đồ|Cấu hình bước)/.test(r.head) },
    actions: [{ id: "phien-ban", label: /^Phiên bản$/ }, { id: "nhan-ban", label: /^Nhân bản$/ }] },
  { n: 8, id: "ir-editor", route: "/ir-editor", copilot: true,
    legacyMain: { desc: "card 'Vùng vẽ luồng'", fn: (r) => r.kind === "card" && /Vùng vẽ luồng/.test(r.head) },
    actions: [{ id: "project-ir-flow-moi", label: /Project ir-flow mới/ }] },
  { n: 9, id: "pou-studio", route: "/pou-studio", copilot: true,
    legacyMain: { desc: "card 'Trình soạn POU'", fn: (r) => r.kind === "card" && /Trình soạn POU/.test(r.head) },
    actions: [{ id: "luu-vao-project", label: /Lưu vào project/ }] },
  { n: 10, id: "programming-copilot", route: "/programming-copilot",
    legacyMain: { desc: "ProgrammingCopilot card đầu (form sinh mã)", pick: (rs) => rs.filter((r) => /ProgrammingCopilot\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === 0).slice(0, 1) },
    actions: [] },
  { n: 11, id: "fleet-orchestration", route: "/fleet-orchestration",
    legacyMain: { desc: "FleetOrchestration tabs-content đang mở", fn: (r) => /FleetOrchestration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
  { n: 12, id: "safety-workforce", route: "/safety-workforce",
    legacyMain: { desc: "SafetyWorkforce tabs-content đang mở", fn: (r) => /SafetyWorkforce\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "bao-cao-tiem-can", label: /Báo cáo tiệm cận/ }] },
  { n: 13, id: "equipment-standards", route: "/equipment-standards",
    legacyMain: { desc: "EquipmentStandards tabs-content đang mở", fn: (r) => /EquipmentStandards\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "dang-ky-loai", label: /Đăng ký loại/ }] },
  { n: 14, id: "equipment-integration", route: "/equipment-integration",
    legacyMain: { desc: "EquipmentIntegration tabs-content đang mở", fn: (r) => /EquipmentIntegration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
];

/** FE1 §0 (docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/FE1_DO_BO_CUC_THEO_VUNG_14_MAN.md), :3000 dist, engineer1, 2026-09-26. */
export const FE1 = {
  "engineering-home": { mainTop: 366, ws1600: 42.5, ws1366: 33.0, notices: 1, noticePx: 57, ratio1600: 2.03, ratio1366: 2.57, crumbs: 2, kpi: 0 },
  "engineering-studio": { mainTop: 134, ws1600: 53.5, ws1366: 48.9, notices: 0, noticePx: 0, ratio1600: 1.02, ratio1366: 1.03, crumbs: 1, kpi: 0 },
  "engineering|open": { mainTop: 713, ws1600: 10.4, ws1366: 0.0, notices: 1, noticePx: 70, ratio1600: 3.11, ratio1366: 3.93, crumbs: 2, kpi: 0 },
  "engineering|closed": { mainTop: 697, ws1600: 14.8, ws1366: 3.5, notices: 1, noticePx: 54, ratio1600: 2.99, ratio1366: 3.84, crumbs: 2, kpi: 0 },
  "engineering-changes": { mainTop: 347, ws1600: 21.3, ws1366: 25.0, notices: 0, noticePx: 0, ratio1600: 1.0, ratio1366: 1.0, crumbs: 1, kpi: 0 },
  "recipes": { mainTop: 511, ws1600: 28.0, ws1366: 23.9, notices: 1, noticePx: 48, ratio1600: 1.25, ratio1366: 1.56, crumbs: 2, kpi: 0 },
  "interlock-rules": { mainTop: 399, ws1600: 15.9, ws1366: 19.5, notices: 1, noticePx: 34, ratio1600: 1.0, ratio1366: 1.0, crumbs: 2, kpi: 0 },
  "orchestration-studio": { mainTop: 762, ws1600: 15.1, ws1366: 0.0, notices: 2, noticePx: 72, ratio1600: 1.60, ratio1366: 2.01, crumbs: 2, kpi: 0 },
  "ir-editor|open": { mainTop: 822, ws1600: 2.8, ws1366: 0.0, notices: 3, noticePx: 174, ratio1600: 3.04, ratio1366: 4.01, crumbs: 2, kpi: 4 },
  "ir-editor|closed": { mainTop: 704, ws1600: 8.2, ws1366: 1.1, notices: 3, noticePx: 138, ratio1600: 2.86, ratio1366: 3.61, crumbs: 2, kpi: 4 },
  "pou-studio|open": { mainTop: 689, ws1600: 6.9, ws1366: 0.0, notices: 3, noticePx: 178, ratio1600: 1.56, ratio1366: 2.15, crumbs: 2, kpi: 4 },
  "pou-studio|closed": { mainTop: 629, ws1600: 12.9, ws1366: 5.6, notices: 3, noticePx: 138, ratio1600: 1.47, ratio1366: 1.88, crumbs: 2, kpi: 4 },
  "programming-copilot": { mainTop: 315, ws1600: 23.9, ws1366: 34.6, notices: 1, noticePx: 34, ratio1600: 1.0, ratio1366: 1.03, crumbs: 1, kpi: 0 },
  "fleet-orchestration": { mainTop: 653, ws1600: 24.2, ws1366: 9.0, notices: 3, noticePx: 118, ratio1600: 1.55, ratio1366: 1.94, crumbs: 2, kpi: 9 },
  "safety-workforce": { mainTop: 695, ws1600: 20.8, ws1366: 5.0, notices: 3, noticePx: 160, ratio1600: 1.68, ratio1366: 2.13, crumbs: 2, kpi: 4 },
  "equipment-standards": { mainTop: 669, ws1600: 22.9, ws1366: 7.5, notices: 3, noticePx: 118, ratio1600: 1.85, ratio1366: 2.32, crumbs: 2, kpi: 5 },
  "equipment-integration": { mainTop: 673, ws1600: 22.6, ws1366: 7.1, notices: 3, noticePx: 138, ratio1600: 1.31, ratio1366: 1.70, crumbs: 2, kpi: 4 },
};

const DEFAULT_SIZES = [[1600, 950], [1366, 768]];

// ───────────────────────────────────────────────────────────────────────────────────────────
// 2. Hàm đo chạy TRONG trình duyệt. Phần walk/notice/crumbs/floats/scrollH là NGUYÊN VĂN
//    MEASURE của FE1 (`.playwright-mcp/survey81/_driver.js`) để số đối chiếu được; phần cuối
//    (mainRects, h1, KPI, AI che, dialog) là bổ sung của Task 1.
// ───────────────────────────────────────────────────────────────────────────────────────────
function MEASURE_IN_PAGE() {
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const main = document.querySelector('main');
  const BOUND_SLOT = new Set(['card','alert','tabs','table-container','resizable-panel-group','resizable-panel','scroll-area','sheet-content','dialog-content','accordion','collapsible']);
  const BOUND_ROLE = new Set(['alert','tablist','tabpanel','region','status','grid','tree','toolbar','log','dialog','application']);
  const BOUND_TAG = new Set(['SECTION','FORM','TABLE','CANVAS','ASIDE','ARTICLE','FIELDSET']);
  const cls = (e) => (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || ''));
  const isEditor = (e) => /(^|\s)(cm-editor|monaco-editor|react-flow|reactflow)(\s|$)/.test(cls(e));
  const isNoticeCls = (e) => { const c = cls(e); return /(border|bg)-(amber|yellow|warning|info|blue|orange|destructive|red|sky|primary\/|success\/|muted)/.test(c) && /(border)/.test(c) && /(rounded)/.test(c) && /(p-2|p-3|p-4|px-3|px-4|py-2|py-3)/.test(c); };
  const isBoundary = (e) => {
    if (!(e instanceof Element)) return false;
    if (BOUND_TAG.has(e.tagName)) return true;
    const sl = e.getAttribute('data-slot'); if (sl && BOUND_SLOT.has(sl)) return true;
    const ro = e.getAttribute('role'); if (ro && BOUND_ROLE.has(ro)) return true;
    if (isEditor(e)) return true;
    if (e.tagName === 'NAV') return true;
    if (isNoticeCls(e) && e.getBoundingClientRect().height < 260) return true;
    return false;
  };
  const hasBoundDesc = (e) => { for (const d of e.querySelectorAll('*')) if (isBoundary(d) && vis(d)) return true; return false; };
  const count = (e) => {
    const q = (s) => [...e.querySelectorAll(s)].filter(vis).length;
    return {
      btn: q('button,[role=button],a[data-slot=button]'),
      inp: q('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,[contenteditable=true],.cm-content'),
      sel: q('select,[role=combobox],[data-slot=select-trigger]'),
      chk: q('input[type=checkbox],[role=checkbox],[role=switch],input[type=radio],[role=radio]'),
      tbl: q('table'), rows: q('tbody tr'),
      cnv: q('canvas,.react-flow,.reactflow') + [...e.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.width > 200 && r.height > 120; }).length,
      chart: q('.recharts-wrapper'), code: q('.cm-editor,.monaco-editor'),
      tabs: q('[role=tab]'), links: q('a[href]'),
    };
  };
  const head = (e) => {
    const h = e.querySelector('h1,h2,h3,h4,[data-slot=card-title],[data-slot=alert-title],legend,caption');
    let t = h ? h.innerText : '';
    if (!t) t = (e.innerText || '').split('\n').find(x => x.trim()) || '';
    return t.trim().replace(/\s+/g, ' ').slice(0, 70);
  };
  const NOTICE_TXT = /(Khi nào dùng|Beta|xem trước|Chỉ xem|chỉ đọc|advisory|TẮT|SIMULATED|không được phép|Bạn không có quyền|Chế độ|Lưu ý|Cảnh báo|Luồng vàng|thử nghiệm|preview)/i;
  const regions = []; let id = 0;
  const push = (e, depth, parent, kind) => {
    const r = e.getBoundingClientRect(); const y = r.top + scrollY;
    const c = count(e); const txt = (e.innerText || '').trim();
    const noticeReason = (e.getAttribute('role') === 'alert' || e.getAttribute('data-slot') === 'alert') ? 'alert' : (isNoticeCls(e) && r.height < 260 && c.tbl === 0 && c.inp === 0 && c.btn <= 3 ? 'notice-style' : ((kind === 'block' && r.height < 160 && c.inp === 0 && c.tbl === 0 && NOTICE_TXT.test(txt.slice(0, 300)) && txt.length > 25) ? 'notice-text' : null));
    const o = { id: id++, parent, depth, tag: e.tagName, loc: e.getAttribute('data-loc'), kind: kind || (e.getAttribute('data-slot') || e.getAttribute('role') || e.tagName.toLowerCase()), head: head(e),
      x: Math.round(r.left), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), ...c, notice: noticeReason };
    regions.push(o); return o.id;
  };
  const walk = (el, depth, parent) => {
    for (const ch of el.children) {
      if (!vis(ch)) { if (hasBoundDesc(ch)) walk(ch, depth, parent); continue; }
      if (isBoundary(ch)) {
        const pid = push(ch, depth, parent);
        const r = ch.getBoundingClientRect();
        if (depth < 3 && (r.height > 0.45 * vh || (r.width > 0.9 * main.getBoundingClientRect().width && r.height > 250)) && hasBoundDesc(ch) && !isEditor(ch) && ch.tagName !== 'TABLE') walk(ch, depth + 1, pid);
      } else if (hasBoundDesc(ch)) {
        walk(ch, depth, parent);
      } else {
        const r = ch.getBoundingClientRect();
        if (r.height >= 16 && (ch.innerText || '').trim().length + ch.querySelectorAll('button,input,svg,canvas,img').length > 0) push(ch, depth, parent, 'block');
      }
    }
  };
  if (main) walk(main, 0, null);
  const sidebar = [...document.querySelectorAll('div,aside')].find(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().left === 0 && e.getBoundingClientRect().height > vh * 0.9 && e.getBoundingClientRect().width > 40 && e.getBoundingClientRect().width < 400);
  const sbW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
  const topEl = document.elementFromPoint(Math.min(vw - 5, sbW + 20), 10);
  const topbar = topEl ? (topEl.closest('header') || topEl) : null;
  const crumbs = [...document.querySelectorAll('nav[data-slot=breadcrumb],nav[aria-label*=readcrumb],[aria-label*="breadcrumb" i]')].filter(vis).map(n => ({ loc: n.getAttribute('data-loc'), y: Math.round(n.getBoundingClientRect().top + scrollY), h: Math.round(n.getBoundingClientRect().height) }));
  const mr = main ? main.getBoundingClientRect() : null;
  const scrollH = Math.max(document.scrollingElement.scrollHeight, main ? (main.scrollHeight + mr.top + scrollY) : 0);
  const spinners = [...document.querySelectorAll('.animate-spin,[data-slot=skeleton],.animate-pulse')].filter(vis).length;

  // ── bổ sung Task 1 ──────────────────────────────────────────────────────────────────────
  const rectOf = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  // MAIN chính thức: [data-layout-main] nhìn thấy, bỏ phần tử lồng trong một phần tử khác cùng attribute.
  const dlm = [...document.querySelectorAll('[data-layout-main]')].filter(vis);
  const dlmTop = dlm.filter(e => !dlm.some(o => o !== e && o.contains(e)));
  // h1
  const h1s = [...document.querySelectorAll('h1')].filter(vis);
  const h1 = h1s.length ? h1s[0] : null;
  // KPI: [data-layout-kpi] (chính thức, các task sau) hoặc MetricCard (data-loc) — FE1 đếm MetricCard.
  const kpiOfficial = [...document.querySelectorAll('main [data-layout-kpi]')].filter(vis);
  const kpiLegacy = [...document.querySelectorAll('main [data-loc*="MetricCard.tsx"]')].filter(vis).filter((e, _i, a) => !a.some(o => o !== e && o.contains(e)));
  const kpiEls = kpiOfficial.length ? kpiOfficial : kpiLegacy;
  let kpiStrip = null;
  if (kpiEls.length) { const rs = kpiEls.map(e => e.getBoundingClientRect()); const top = Math.min(...rs.map(r => r.top)), bot = Math.max(...rs.map(r => r.bottom)); kpiStrip = { y: Math.round(top + scrollY), h: Math.round(bot - top) }; }
  // AI che: dock Copilot + bong bóng AI (phần tử ngoài cùng mang data-loc của hai tệp) + [data-layout-ai].
  const aiCand = [...document.querySelectorAll('[data-loc*="AILocalChatBubble.tsx"],[data-loc*="ProgrammingCopilotDock.tsx"],[data-layout-ai]')].filter(vis);
  const aiTop = aiCand.filter(e => !aiCand.some(o => o !== e && o.contains(e)));
  const ai = aiTop.map(e => ({ name: e.hasAttribute('data-layout-ai') ? (e.getAttribute('data-layout-ai') || 'ai') : (/ProgrammingCopilotDock/.test(e.getAttribute('data-loc')) ? 'copilot-dock' : 'ai-bubble'), loc: e.getAttribute('data-loc'), pos: getComputedStyle(e).position, ...rectOf(e) }));
  // Dialog lúc nạp
  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(vis).map(e => ({ role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), ...rectOf(e) }));
  return {
    url: location.pathname + location.search, vw, vh, spinners,
    shell: { sidebarW: sbW, topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null, topbarBottom: topbar ? Math.round(topbar.getBoundingClientRect().bottom) : null, topbarPos: topbar ? getComputedStyle(topbar).position : null, mainTop: mr ? Math.round(mr.top + scrollY) : null, mainW: mr ? Math.round(mr.width) : null, mainPad: main ? getComputedStyle(main).padding : null, crumbs },
    scrollH, scrollRatio: +(scrollH / vh).toFixed(2),
    regions,
    dlm: dlmTop.map(e => ({ value: e.getAttribute('data-layout-main'), ...rectOf(e) })),
    h1: h1 ? { top: Math.round(h1.getBoundingClientRect().top), text: h1.innerText.replace(/\s+/g, ' ').slice(0, 60) } : null, h1Count: h1s.length,
    kpi: { source: kpiOfficial.length ? 'data-layout-kpi' : 'MetricCard', count: kpiEls.length, strip: kpiStrip },
    ai, dialogs,
  };
}

/** Diện tích phần nhìn thấy của các hình chữ nhật (toạ độ trang, scrollY=0) trong [0,vw]×[clipTop,vh]. */
function visibleArea(rects, vw, vh, clipTop) {
  let a = 0;
  for (const r of rects) {
    const t = Math.max(r.y, clipTop), b = Math.min(r.y + r.h, vh);
    const w = Math.max(0, Math.min(r.x + r.w, vw) - Math.max(r.x, 0));
    if (b > t) a += (b - t) * w;
  }
  return a;
}
function intersectArea(a, b, vw, vh, clipTop) {
  const x0 = Math.max(a.x, b.x, 0), x1 = Math.min(a.x + a.w, b.x + b.w, vw);
  const y0 = Math.max(a.y, b.y, clipTop), y1 = Math.min(a.y + a.h, b.y + b.h, vh);
  return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
}
const BAD_NOTICE_KINDS = ["button", "a", "select-trigger", "input", "popover-trigger", "textarea", "combobox"];

/** Rút gọn số đo thô thành bản ghi chỉ số (cái được commit và so sánh). */
export function summarize(screen, variant, raw) {
  const { vw, vh } = raw;
  let mainSource, mainRects;
  if (raw.dlm.length) { mainSource = "data-layout-main"; mainRects = raw.dlm.map(({ x, y, w, h }) => ({ x, y, w, h })); }
  else {
    mainSource = "fe1-legacy";
    const L = screen.legacyMain;
    const picked = L.pick ? L.pick(raw.regions) : raw.regions.filter(L.fn);
    mainRects = picked.map(({ x, y, w, h }) => ({ x, y, w, h }));
  }
  // Cắt trên tại mép dưới top bar sticky (56 px hiện nay). FE1 cắt ở 109 (top bar + breadcrumb shell);
  // ở đường cơ sở mọi MAIN bắt đầu dưới 109 nên hai cách cho cùng số — giữ cả `mainPctFe1` để chứng minh.
  const clipTop = raw.shell.topbarPos === "sticky" || raw.shell.topbarPos === "fixed" ? (raw.shell.topbarBottom ?? 0) : 0;
  const mainArea = visibleArea(mainRects, vw, vh, clipTop);
  const mainTop = mainRects.length ? Math.min(...mainRects.map((r) => r.y)) : null;
  // Định nghĩa notice của FE1 + loại trừ NÚT: `DialogTrigger asChild` ghi đè data-slot của Button thành
  // "dialog-trigger" nên nút chính (vd "Thay đổi mới" của ECN, bg-primary + border) lọt bộ lọc kind của FE1.
  const notices = raw.regions.filter((r) => r.notice && !BAD_NOTICE_KINDS.includes(r.kind) && !/-trigger$/.test(r.kind) && r.tag !== "BUTTON" && r.tag !== "A" && r.depth === 0 && !/PageHeader/.test(r.loc || ""));
  const before = mainTop == null ? notices : notices.filter((n) => n.y < mainTop);
  const aiItems = raw.ai.map((a) => {
    const overlapMain = mainRects.reduce((s, m) => s + intersectArea(a, m, vw, vh, clipTop), 0);
    return { name: a.name, pos: a.pos, rect: { x: a.x, y: a.y, w: a.w, h: a.h }, overlapMainPx: overlapMain };
  });
  const overlapMainPx = aiItems.reduce((s, a) => s + a.overlapMainPx, 0);
  return {
    screen: screen.id, route: screen.route, vw, vh, variant,
    mainSource, missingDataLayoutMain: mainSource !== "data-layout-main",
    mainSelector: mainSource === "data-layout-main" ? "[data-layout-main]" : screen.legacyMain.desc,
    mainFound: mainRects.length > 0,
    mainRects, mainTop,
    mainPct: +(mainArea / (vw * vh) * 100).toFixed(1),
    mainPctFe1: +(visibleArea(mainRects, vw, vh, 109) / (vw * vh) * 100).toFixed(1),
    mainPctUnoccluded: +(Math.max(0, mainArea - overlapMainPx) / (vw * vh) * 100).toFixed(1),
    h1Top: raw.h1 ? raw.h1.top : null, h1Text: raw.h1 ? raw.h1.text : null, h1Count: raw.h1Count,
    breadcrumbs: raw.shell.crumbs.length, breadcrumbLocs: raw.shell.crumbs.map((c) => (c.loc || "").replace(/^.*[\\/]/, "")),
    bannersBeforeMain: { count: before.length, px: before.reduce((s, n) => s + n.h, 0), items: before.map((n) => ({ loc: (n.loc || "").replace(/^.*[\\/]/, ""), kind: n.kind, reason: n.notice, y: n.y, h: n.h, head: n.head.slice(0, 50) })) },
    kpi: { source: raw.kpi.source, count: raw.kpi.count, stripHeight: raw.kpi.strip ? raw.kpi.strip.h : 0, stripY: raw.kpi.strip ? raw.kpi.strip.y : null },
    aiOcclusion: { overlapMainPx, overlapMainPctOfMain: mainArea ? +(overlapMainPx / mainArea * 100).toFixed(1) : 0, overlapMainPctOfViewport: +(overlapMainPx / (vw * vh) * 100).toFixed(1), items: aiItems },
    pageHeightRatio: raw.scrollRatio, scrollH: raw.scrollH,
    shell: { sidebarW: raw.shell.sidebarW, topbarH: raw.shell.topbarH, mainTop: raw.shell.mainTop, mainW: raw.shell.mainW, mainPad: raw.shell.mainPad },
    dialogsAtLoad: raw.dialogs.length,
    spinnersAtMeasure: raw.spinners,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 3. Instance tự dựng: _test DB, server tsx :3016, Vite dev :5176
// ───────────────────────────────────────────────────────────────────────────────────────────
const TEST_DB = "aoi_management_test";
const PROBE_OPENID = "ui-metrics-engineer";
const PROBE_USER = "uim_engineer";

function readEnvKey(key) {
  const f = path.join(REPO, ".env");
  if (!fs.existsSync(f)) return undefined;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i < 0 || t.slice(0, i).trim() !== key) continue;
    return t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}
/** URL DB _test: UIM_TEST_DATABASE_URL, hoặc DATABASE_URL của .env đổi tên DB thành aoi_management_test. Tên khác ⇒ từ chối. */
export function testDatabaseUrl() {
  let u;
  if (process.env.UIM_TEST_DATABASE_URL) u = new URL(process.env.UIM_TEST_DATABASE_URL);
  else { const dev = readEnvKey("DATABASE_URL"); if (!dev) throw new Error("Không có DATABASE_URL trong .env và không có UIM_TEST_DATABASE_URL"); u = new URL(dev); u.pathname = "/" + TEST_DB; }
  if (u.pathname !== "/" + TEST_DB) throw new Error(`Từ chối: DB đo phải là ${TEST_DB}, nhận ${u.pathname}`);
  return u.toString();
}
async function withTestDb(fn) {
  const postgres = require("postgres");
  const sql = postgres(testDatabaseUrl(), { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const [{ db }] = await sql`select current_database() as db`;
    if (db !== TEST_DB) throw new Error(`Từ chối: current_database()=${db}`);
    return await fn(sql);
  } finally { await sql.end({ timeout: 5 }); }
}
function engineerTemplatePerms() {
  const src = fs.readFileSync(path.join(REPO, "server/routers/permissionsRouter.ts"), "utf8");
  const start = src.indexOf("\n  engineer: [");
  if (start < 0) throw new Error("Không tìm thấy DEFAULT_ROLE_PERMISSIONS.engineer");
  const from = src.indexOf("[", start); let depth = 0, i = from;
  for (; i < src.length; i++) { if (src[i] === "[") depth++; else if (src[i] === "]") { depth--; if (depth === 0) break; } }
  // dữ liệu tĩnh của repo (object literal) — cùng cách scripts/seed-test-data.mjs
  return Function(`"use strict"; return ([${src.slice(from + 1, i)}])`)();
}
async function deleteProbeUser(sql) {
  const rows = await sql`select id from users where "openId" = ${PROBE_OPENID}`;
  let deleted = 0, deactivated = 0;
  for (const { id } of rows) {
    await sql`delete from permissions where "userId" = ${id}`;
    await sql`delete from user_factory_assignments where "userId" = ${id}`;
    await sql`delete from user_sessions where "userId" = ${id}`.catch(() => {});
    await sql`delete from user_secrets where "userId" = ${id}`;
    try { await sql`delete from users where id = ${id}`; deleted++; }
    catch { await sql`update users set "isActive" = false where id = ${id}`; deactivated++; }
  }
  return { deleted, deactivated };
}
async function createProbeUser() {
  const bcrypt = require("bcryptjs");
  const password = "Uim!" + crypto.randomBytes(12).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  const perms = engineerTemplatePerms();
  return withTestDb(async (sql) => {
    const stale = await deleteProbeUser(sql);
    const [u] = await sql`insert into users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
      values (${PROBE_OPENID}, ${PROBE_USER}, 'UI metrics engineer', 'password', 'engineer', true, false, now()) returning id`;
    await sql`insert into user_secrets ("userId", "passwordHash", "updatedAt") values (${u.id}, ${hash}, now())`;
    for (const p of perms) {
      await sql`insert into permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
        values (${u.id}, ${p.category}, ${p.moduleName}, ${!!p.canView}, ${!!p.canCreate}, ${!!p.canEdit}, ${!!p.canDelete}, ${!!p.canExport})`;
    }
    const fac = await sql`select code from factories where code = 'SIM-FAC' limit 1`;
    if (fac.length) await sql`insert into user_factory_assignments ("userId", "factoryCode") values (${u.id}, 'SIM-FAC')`;
    return { userId: u.id, username: PROBE_USER, password, perms: perms.length, factory: fac.length ? "SIM-FAC" : null, staleRemoved: stale };
  });
}

/**
 * Ảnh chụp số hàng các bảng nuôi 14 màn. `_test` là DB DÙNG CHUNG với vitest của mọi phiên: chiều cao
 * bảng/danh sách phụ thuộc số hàng ⇒ hai lần đo chỉ so được khi snapshot này khớp (so ở `--compare`).
 */
export const DATA_TABLES = ["program_projects", "program_artifacts", "program_builds", "program_deployments", "engineering_changes", "machine_recipes", "recipe_deployments", "interlock_rules", "interlock_events", "orchestration_workflows", "orchestration_runs", "alarm_taxonomy", "master_alarms", "device_adapters", "safety_plc_configs"];
async function dataSnapshot() {
  return withTestDb(async (sql) => {
    const o = {};
    for (const t of DATA_TABLES) { try { o[t] = (await sql.unsafe(`select count(*)::int n from "${t}"`))[0].n; } catch { o[t] = null; } }
    return o;
  });
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "0.0.0.0");
  }).then((busy) => busy || new Promise((resolve) => {
    const c = net.connect({ port, host: "127.0.0.1" });
    c.once("connect", () => { c.destroy(); resolve(true); });
    c.once("error", () => resolve(false));
    c.setTimeout(1000, () => { c.destroy(); resolve(false); });
  }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Env của tiến trình server đo: KHÔNG kế thừa env cha (ngoài biến hệ thống), KHÔNG nạp .env. */
function serverEnv(port, logDir) {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"];
  const env = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(logDir, "khong-ton-tai.env"),
    DATABASE_URL: testDatabaseUrl(),
    PORT: String(port), ROLE: "api",
    JWT_SECRET: "uim-" + crypto.randomBytes(32).toString("hex"),
    LICENSE_BYPASS: "true", AUTH_2FA_BAT_BUOC: "0", VITE_APP_ID: "ui-metrics",
    MQTT_ENABLED: "false", MQTT_PORT: "51883", MQTT_WS_PORT: "51884", EXTERNAL_MQTT_ENABLED: "false",
    UNS_BRIDGE_ENABLED: "false", UNS_SPARKPLUG_ENABLED: "false", UNS_BROKER_URL: "mqtt://127.0.0.1:9", SPARKPLUG_COMMAND_ENABLED: "false", UNS_TOPIC_V2_ENABLED: "false",
    OT_CONTROL_ENABLED: "false", ROBOT_GATEWAY_ENABLED: "false", ROBOT_CONTROL_ENABLED: "false", OPCUA_GATEWAY_ENABLED: "false", ROS2_BRIDGE_ENABLED: "false",
    SIM_OT_TELEMETRY_ENABLED: "false", SIM_KINEMATIC_ENABLED: "false", EDGE_RUNTIME_ENABLED: "false", SECS_GEM_ENABLED: "false", MTCONNECT_ENABLED: "false", VDA5050_ENABLED: "false",
    LLAMA_SERVER_ENABLED: "false", ENABLE_GPU: "false", GGUF_WARM_DEEP_MODEL_ON_BOOT: "false", PROG_KB_ENABLED: "false", KB_AUTOSYNC_ENABLED: "false", HOT_FOLDER_INGEST_ENABLED: "false",
    WEBHOOKS_ENABLED: "false", OTEL_ENABLED: "false", TWIN_LIVE_ENABLED: "false", TWIN_STREAM_ENABLED: "false", STREAM_TELEMETRY_TAP_ENABLED: "false", OPENAI_GATEWAY_ENABLED: "false",
  });
  return env;
}

async function startServer(port, logDir) {
  if (await portBusy(port)) throw new Error(`Cổng ${port} đang bận — không đo (server sẽ tự nhảy cổng khác).`);
  const log = fs.openSync(path.join(logDir, "server.log"), "w");
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "server/_core/index.ts"], { cwd: REPO, env: serverEnv(port, logDir), stdio: ["ignore", log, log], windowsHide: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    if (child.exitCode != null) throw new Error(`Server thoát sớm (mã ${child.exitCode}) — xem ${path.join(logDir, "server.log")}`);
    const txt = fs.readFileSync(path.join(logDir, "server.log"), "utf8");
    const m = /Server running on https?:\/\/localhost:(\d+)/.exec(txt);
    if (m) {
      if (Number(m[1]) !== port) { killTree(child.pid); throw new Error(`Server nghe cổng ${m[1]} thay vì ${port}`); }
      return { child, bootMs: Date.now() - t0 };
    }
    await sleep(1000);
  }
  killTree(child.pid);
  throw new Error("Server không lên sau 240 s");
}
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch { /* đã chết */ }
}
async function startVite(vitePort, serverPort) {
  if (await portBusy(vitePort)) throw new Error(`Cổng ${vitePort} đang bận`);
  const { createServer } = await import("vite");
  const cacheDir = path.join(os.tmpdir(), "aoi-ui-metrics-vite-cache"); // ngoài node_modules
  const target = `http://127.0.0.1:${serverPort}`;
  const server = await createServer({
    configFile: path.join(REPO, "vite.config.ts"),
    cacheDir, logLevel: "warn", clearScreen: false,
    server: { port: vitePort, strictPort: true, host: "127.0.0.1", hmr: false,
      fs: { strict: true, allow: [REPO, cacheDir] },
      proxy: { "/api": { target, ws: true, changeOrigin: false }, "/uploads": { target } } },
  });
  await server.listen();
  return server;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 4. Đo bằng Playwright
// ───────────────────────────────────────────────────────────────────────────────────────────
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  let clean = 0;
  for (let i = 0; i < 40 && clean < 3; i++) {
    const n = await page.evaluate(() => { const v = (e) => { const r = e.getBoundingClientRect(); return r.width > 6 && r.height > 6; }; const m = document.querySelector('main'); const t = m ? m.innerText : ''; return [...document.querySelectorAll('main .animate-spin, main [data-slot=skeleton], main .animate-pulse')].filter(v).length + (/(Đang tải|Loading)/.test(t) ? 1 : 0) + (m ? 0 : 1); });
    clean = n === 0 ? clean + 1 : 0;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
}
async function countDialogs(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width >= 4 && r.height >= 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
  });
}
async function runActions(page, screen) {
  const out = [];
  for (const a of screen.actions || []) {
    const btn = page.locator("main").getByRole("button", { name: a.label }).first();
    const rec = { id: a.id, label: String(a.label) };
    if (!(await btn.count())) { out.push({ ...rec, found: false }); continue; }
    rec.found = true;
    rec.enabled = await btn.isEnabled();
    if (!rec.enabled) { out.push(rec); continue; }
    await btn.click();
    await page.waitForTimeout(700);
    const ds = await countDialogs(page);
    rec.dialogs = ds.length; rec.kinds = ds.map((d) => d.slot || d.role); rec.rects = ds;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    rec.closedByEsc = (await countDialogs(page)).length === 0;
    if (!rec.closedByEsc) { await page.reload(); await settle(page); }
    out.push(rec);
  }
  return out;
}

async function resolveRoute(ctx, base, s) {
  if (s.deepLink !== "firstProject") return s.route;
  const res = await ctx.request.get(base + "/api/trpc/programming.listProjects");
  const body = await res.json().catch(() => null);
  const data = body?.result?.data?.json ?? body?.result?.data;
  const first = Array.isArray(data) && data.length ? data[0] : null;
  if (!first) { console.log(`[uim] ${s.id}: không có dự án nào ⇒ đo không chọn dự án (editor sẽ không hiện)`); return s.route; }
  return `${s.route}?projectId=${first.id}`;
}

async function measureAll({ base, username, password, screens, sizes, shots, shotDir, listButtons }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const buttons = {};
  try {
    for (const variant of ["closed", "open"]) {
      const list = screens.filter((s) => variant === "closed" || s.copilot);
      if (!list.length) continue;
      const ctx = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", deviceScaleFactor: 1 });
      await ctx.addInitScript((dock) => { try { localStorage.setItem("i18nextLng", "vi"); localStorage.setItem("progCopilotDock.open", dock); localStorage.setItem("sidebar_open", "true"); } catch { /* */ } }, variant === "open" ? "1" : "0");
      const login = await ctx.request.post(base + "/api/auth/login", { data: { username, password } });
      if (!login.ok()) throw new Error(`Đăng nhập thất bại ${login.status()} ${await login.text()}`);
      const page = await ctx.newPage();
      for (const s of list) {
        const route = await resolveRoute(ctx, base, s);
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(base + route);
          await settle(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
          if (shots) await page.screenshot({ path: path.join(shotDir, `${String(s.n).padStart(2, "0")}-${s.id}-${variant}-${w}.png`) });
          const raw = await page.evaluate(MEASURE_IN_PAGE);
          const rec = summarize(s, s.copilot ? variant : "n/a", raw);
          rec.actions = await runActions(page, s);
          if (listButtons) buttons[`${s.id}-${variant}-${w}`] = await page.evaluate(() => [...document.querySelectorAll('main button,main [role=button]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((b) => ({ name: (b.innerText.trim() || b.getAttribute('aria-label') || b.getAttribute('title') || '?').replace(/\s+/g, ' ').slice(0, 40), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', haspopup: b.getAttribute('aria-haspopup') })));
          results.push(rec);
          const flag = rec.missingDataLayoutMain ? "  ⚠ CHƯA có [data-layout-main] → selector FE1" : "";
          console.log(`${s.id.padEnd(22)} ${String(w).padStart(4)} ${rec.variant.padEnd(6)} main=${String(rec.mainPct).padStart(5)}% h1=${rec.h1Top} crumbs=${rec.breadcrumbs} banners=${rec.bannersBeforeMain.count}/${rec.bannersBeforeMain.px}px kpi=${rec.kpi.count}/${rec.kpi.stripHeight}px ai=${rec.aiOcclusion.overlapMainPx}px² ratio=${rec.pageHeightRatio}${rec.mainFound ? "" : "  ✗ KHÔNG THẤY MAIN"}${flag}`);
        }
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return { results, buttons };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 5. MSA (so 2 lần chạy) và đối chiếu FE1
// ───────────────────────────────────────────────────────────────────────────────────────────
const MSA_METRICS = [
  ["mainPct", (r) => r.mainPct], ["mainTop", (r) => r.mainTop], ["h1Top", (r) => r.h1Top], ["breadcrumbs", (r) => r.breadcrumbs],
  ["banners.count", (r) => r.bannersBeforeMain.count], ["banners.px", (r) => r.bannersBeforeMain.px],
  ["kpi.count", (r) => r.kpi.count], ["kpi.stripHeight", (r) => r.kpi.stripHeight],
  ["ai.overlapMainPx", (r) => r.aiOcclusion.overlapMainPx], ["pageHeightRatio", (r) => r.pageHeightRatio],
  ["dialogsAtLoad", (r) => r.dialogsAtLoad], ["actionDialogs", (r) => (r.actions || []).reduce((s, a) => s + (a.dialogs || 0), 0)],
];
const keyOf = (r) => `${r.screen}|${r.vw}|${r.variant}`;
const relDev = (a, b) => (a == null && b == null) ? 0 : (a == null || b == null) ? 100 : (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) * 100);
export function compareRuns(A, B, threshold = 2) {
  const mb = new Map(B.results.map((r) => [keyOf(r), r]));
  const rows = []; let worst = 0, n = 0;
  for (const a of A.results) {
    const b = mb.get(keyOf(a)); if (!b) { rows.push({ key: keyOf(a), metric: "*", a: "có", b: "THIẾU", dev: 100 }); worst = 100; continue; }
    for (const [name, get] of MSA_METRICS) { const d = relDev(get(a), get(b)); n++; worst = Math.max(worst, d); if (d > 0) rows.push({ key: keyOf(a), metric: name, a: get(a), b: get(b), dev: +d.toFixed(2) }); }
  }
  const dataDiff = {};
  for (const t of new Set([...Object.keys(A.meta?.dataSnapshot || {}), ...Object.keys(B.meta?.dataSnapshot || {})])) {
    const x = A.meta?.dataSnapshot?.[t], y = B.meta?.dataSnapshot?.[t]; if (x !== y) dataDiff[t] = [x, y];
  }
  return { comparisons: n, nonZero: rows.length, worstDevPct: +worst.toFixed(2), pass: worst < threshold, threshold, dataSnapshotDiff: dataDiff, rows };
}
export function reconcileFe1(run, threshold = 5) {
  const rows = [];
  const get = (id, vw, variant) => run.results.find((r) => r.screen === id && r.vw === vw && (variant ? r.variant === variant : true));
  for (const [k, f] of Object.entries(FE1)) {
    const [id, v] = k.split("|"); const variant = v || undefined;
    const r16 = get(id, 1600, variant), r13 = get(id, 1366, variant);
    if (!r16 || !r13) continue;
    const add = (metric, fe1, now) => rows.push({ screen: k, metric, fe1, now, dev: +relDev(fe1, now).toFixed(1), ok: relDev(fe1, now) <= threshold });
    add("mainTop@1600", f.mainTop, r16.mainTop);
    add("ws%@1600", f.ws1600, r16.mainPctFe1);
    add("ws%@1366", f.ws1366, r13.mainPctFe1);
    add("notices@1600", f.notices, r16.bannersBeforeMain.count);
    add("noticePx@1600", f.noticePx, r16.bannersBeforeMain.px);
    add("ratio@1600", f.ratio1600, r16.pageHeightRatio);
    add("ratio@1366", f.ratio1366, r13.pageHeightRatio);
    add("crumbs@1600", f.crumbs, r16.breadcrumbs);
    add("kpiCards@1600", f.kpi, r16.kpi.count);
  }
  return { threshold, total: rows.length, within: rows.filter((r) => r.ok).length, rows };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 6. CLI
// ───────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const nx = argv[i + 1]; if (nx != null && !nx.startsWith("--") && !["spawn", "shots", "list-buttons", "keep"].includes(k)) { o[k] = nx; i++; } else o[k] = true; }
    else o._.push(a);
  }
  return o;
}
async function portsReport(ports) {
  const r = {}; for (const p of ports) r[p] = (await portBusy(p)) ? "BẬN" : "trống"; return r;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    const A = JSON.parse(fs.readFileSync(args.compare, "utf8")), B = JSON.parse(fs.readFileSync(args._[0], "utf8"));
    const c = compareRuns(A, B, Number(args.threshold ?? 2));
    console.log(JSON.stringify(c, null, 1));
    process.exit(c.pass ? 0 : 1);
  }
  if (args.fe1) {
    const run = JSON.parse(fs.readFileSync(args.fe1, "utf8"));
    const c = reconcileFe1(run, Number(args.threshold ?? 5));
    console.log(JSON.stringify(c, null, 1));
    return;
  }
  const serverPort = Number(args["server-port"] ?? 3016), vitePort = Number(args["vite-port"] ?? 5176);
  const sizes = args.sizes ? String(args.sizes).split(",").map((s) => s.split("x").map(Number)) : DEFAULT_SIZES;
  const screens = args.screens ? SCREENS.filter((s) => String(args.screens).split(",").includes(s.id)) : SCREENS;
  const outFile = path.resolve(args.out || path.join(REPO, ".playwright-mcp/do-bo-cuc", `run-${Date.now()}.json`));
  const shotDir = path.join(REPO, ".playwright-mcp/do-bo-cuc/anh");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (args.shots) fs.mkdirSync(shotDir, { recursive: true });
  const meta = { tool: "scripts/ui-metrics/engineeringLayout.mjs", startedAt: new Date().toISOString(), argv: process.argv.slice(2), sizes, gitHead: (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim(); } catch { return null; } })() };

  let base = args.base, username = args.user, password = args.password;
  let serverChild = null, vite = null, probe = null;
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "uim-"));
  const cleanup = async () => {
    if (vite) { await vite.close().catch(() => {}); vite = null; }
    if (serverChild) { killTree(serverChild.pid); serverChild = null; }
    if (probe) { meta.probeUserRemoved = await withTestDb(deleteProbeUser).catch((e) => ({ error: e.message })); probe = null; }
  };
  process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
  try {
    if (args.spawn) {
      probe = await createProbeUser();
      meta.dataSnapshot = await dataSnapshot();
      meta.instance = { server: `tsx server/_core/index.ts :${serverPort} (env tách, không nạp .env)`, vite: `vite dev in-process :${vitePort} (proxy /api,/uploads → :${serverPort})`, db: TEST_DB, user: { username: probe.username, role: "engineer", perms: probe.perms, factory: probe.factory } };
      const s = await startServer(serverPort, logDir); serverChild = s.child; meta.instance.serverBootMs = s.bootMs; meta.instance.serverPid = s.child.pid;
      vite = await startVite(vitePort, serverPort);
      base = `http://127.0.0.1:${vitePort}`; username = probe.username; password = probe.password;
      console.log(`[uim] instance: server :${serverPort} (pid ${s.child.pid}, boot ${s.bootMs} ms) · vite :${vitePort} · DB ${TEST_DB} · log ${logDir}`);
      if (args.keep) { console.log(`[uim] --keep: giữ instance; user ${username} / ${password}. Ctrl-C để tắt.`); await new Promise(() => {}); }
    }
    if (!base || !username || !password) throw new Error("Cần --spawn, hoặc --base + --user + --password");
    meta.base = base;
    const { results, buttons } = await measureAll({ base, username, password, screens, sizes, shots: !!args.shots, shotDir, listButtons: !!args["list-buttons"] });
    const missing = [...new Set(results.filter((r) => r.missingDataLayoutMain).map((r) => r.screen))];
    const notFound = results.filter((r) => !r.mainFound).map((r) => `${r.screen}@${r.vw}/${r.variant}`);
    meta.finishedAt = new Date().toISOString();
    const out = { meta, pagesMissingDataLayoutMain: missing, mainNotFound: notFound, results };
    if (args["list-buttons"]) out.buttons = buttons;
    if (missing.length) console.log(`\n⚠ ${missing.length}/${screens.length} màn CHƯA có [data-layout-main] — đang đo bằng selector FE1: ${missing.join(", ")}`);
    if (notFound.length) console.log(`✗ KHÔNG THẤY MAIN: ${notFound.join(", ")}`);
    await cleanup();
    if (args.spawn) { await sleep(1500); out.meta.portsAfter = await portsReport([serverPort, vitePort]); console.log(`[uim] cổng sau khi tắt: ${JSON.stringify(out.meta.portsAfter)} · user đo: ${JSON.stringify(out.meta.probeUserRemoved)}`); }
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    console.log(`[uim] ghi ${outFile}`);
  } catch (e) {
    await cleanup();
    console.error("[uim] LỖI:", e.message, `(log: ${logDir})`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
