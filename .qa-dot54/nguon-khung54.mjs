// ĐỢT 39 · D-6b — NGUỒN KHUNG VẼ trong 40 s đứng yên, ĐỌC TỪ CƠ CHẾ (G112):
//   (1) hook `requestAnimationFrame` — R3F `frameloop="demand"`: `invalidate()` → `requestAnimationFrame(loop)` khi chưa lên lịch ⇒ STACK tại lời gọi rAF = kẻ đòi khung.
//   (2) hook `__REACT_DEVTOOLS_GLOBAL_HOOK__` tối thiểu — mỗi commit React (DOM lẫn R3F reconciler): fiber nào đổi props, prop nào (tên prop sống sót minify).
//   (3) tRPC (tên thủ tục) + gói WebSocket. Khung = `__thongKeVe` đổi (poll 10 ms, như tuong-quan-khung Đợt 38).
//   node .qa-dot49/nguon-khung.mjs --man=may|twin|line [--base=http://localhost:3049] [--vp=1600x900]
// Ghi .qa-dot49/nguon-khung/<man>-<vp>.json + in bảng: khung ← rAF(stack) ← commit(fiber/prop) ← mạng. KHÔNG sửa mã.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const MAN = arg("man", "may"); const BASE = arg("base", "http://localhost:3049");
const [VW, VH] = arg("vp", "1600x900").split("x").map(Number); const VP = `${VW}x${VH}`;
const OUT = process.env.QA_OUT ?? ".qa-dot50/nguon-khung"; mkdirSync(OUT, { recursive: true });
const TAG = arg("tag", ""); const DUONG = { may: "/twin/may/14", line: "/twin/line/2", twin: "/twin", studio: "/twin-studio" }[MAN];
const CV = { may: '[data-testid="khoi-canh-may"] canvas', line: '[data-testid="man-twin-line"] canvas', twin: '[data-testid="man-twin-van-hanh"] canvas', studio: '[data-testid="man-twin-studio"] canvas' }[MAN];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
await ctx.addCookies(JSON.parse(readFileSync(process.env.QA_STATE ?? ".qa-dot50/state-e2e.json", "utf8")));
const page = await ctx.newPage();
await page.addInitScript(() => {
  const W = window;
  W.__raf = []; W.__commit = []; W.__ws = [];
  const rafGoc = W.requestAnimationFrame.bind(W);
  W.requestAnimationFrame = function (cb) {
    if (W.__raf.length < 20000) { let st = ""; try { st = String(new Error().stack || ""); } catch {} W.__raf.push({ t: performance.now(), st: st.split("\n").slice(2, 9).map((s) => s.trim().replace(/^at /, "")).join(" < ") }); }
    return rafGoc(cb);
  };
  const doiProps = (a, b) => { const ks = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]); const d = []; for (const k of ks) { if (k === "children") continue; if ((a || {})[k] !== (b || {})[k]) d.push(k); } return d; };
  const tenFiber = (f) => (typeof f.type === "string" ? f.type : (f.type && (f.type.displayName || f.type.name)) || (f.tag === 3 ? "Root" : f.tag === 7 ? "Fragment" : f.tag === 4 ? "Portal" : f.tag === 10 ? "Provider" : f.tag === 9 ? "Consumer" : f.tag === 11 ? "ForwardRef" : f.tag === 15 ? "Memo" : "?" + f.tag));
  const testidGan = (f) => { let p = f; let n = 0; while (p && n < 60) { const sn = p.stateNode; if (sn && typeof sn.getAttribute === "function") { const t = sn.getAttribute("data-testid"); if (t) return t; } p = p.return; n += 1; } return null; };
  const hook = {
    isDisabled: false, supportsFiber: true, supportsFlight: false, renderers: new Map(), _n: 0, _ten: {},
    inject(r) { const id = ++hook._n; hook.renderers.set(id, r); hook._ten[id] = (r.rendererPackageName || "?") + "@" + (r.version || "?"); return id; },
    onCommitFiberRoot(id, root) {
      try {
        const t = performance.now(); const doi = []; let tong = 0; let soDoi = 0;
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop(); if (!f) continue; tong += 1; if (tong > 40000) break;
          if (f.alternate && f.memoizedProps !== f.alternate.memoizedProps) { const ks = doiProps(f.alternate.memoizedProps, f.memoizedProps); if (ks.length) { soDoi += 1; if (doi.length < 80) doi.push({ ten: tenFiber(f), tag: f.tag, keys: ks.slice(0, 12), tid: testidGan(f) }); } }
          if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
        }
        if (W.__commit.length < 5000) W.__commit.push({ t, rid: id, renderer: hook._ten[id], soFiber: tong, soDoi, doi });
      } catch (e) { if (W.__commit.length < 5000) W.__commit.push({ t: performance.now(), rid: id, loi: String(e).slice(0, 120) }); }
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, on() {}, off() {}, emit() {}, sub() { return () => {}; }, registerInternalModuleStart() {}, registerInternalModuleStop() {},
  };
  Object.defineProperty(W, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: false, enumerable: false, writable: false });
  const OrigWS = W.WebSocket;
  W.WebSocket = new Proxy(OrigWS, { construct(t, a) { const ws = new t(...a); ws.addEventListener("message", (e) => { const d = String(e.data || ""); const m = d.match(/^\d+\["([^"]+)"/); if (W.__ws.length < 5000) W.__ws.push({ t: performance.now(), ev: m ? m[1] : d.slice(0, 20) }); }); return ws; } });
});
const t0 = Date.now(); const trpc = [];
page.on("response", (r) => { const u = r.url(); if (u.includes("/api/trpc/")) trpc.push({ t: Date.now() - t0, proc: decodeURIComponent(u.split("/api/trpc/")[1].split("?")[0]).slice(0, 80), status: r.status() }); });
await page.goto(`${BASE}${DUONG}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(CV, { timeout: 90_000 });
if (MAN === "may") await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(8000);
const batDau = Date.now() - t0;
const perfBatDau = await page.evaluate(() => performance.now());
const khung = await page.evaluate((t) => new Promise((r) => { const s = performance.now(); const ds = []; let a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { ds.push(Math.round(performance.now() - s)); a = b; } }, 10); setTimeout(() => { clearInterval(id); r(ds); }, t); }), 40_000);
const [raf, commit, ws, renderers] = await page.evaluate((p0) => [
  (window.__raf || []).filter((x) => x.t >= p0 - 50).map((x) => ({ t: Math.round(x.t - p0), st: x.st })),
  (window.__commit || []).filter((x) => x.t >= p0 - 50).map((x) => ({ ...x, t: Math.round(x.t - p0) })),
  (window.__ws || []).filter((x) => x.t >= p0).map((x) => ({ t: Math.round(x.t - p0), ev: x.ev })),
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__?._ten ?? null,
], perfBatDau);
const trpcTrong = trpc.filter((x) => x.t >= batDau).map((x) => ({ t: x.t - batDau, proc: x.proc.replace(/^twinCanh\.|^factoryCommand\./, "") }));
// Chữ ký stack: các vị trí `index-*.js:L:C` (bỏ khung của chính hook) — 3 vị trí đầu
const viTri = (st) => [...st.matchAll(/(index-[A-Za-z0-9_-]+\.js):(\d+):(\d+)/g)].map((m) => `${m[2]}:${m[3]}`);
const chuKy = (st) => viTri(st).slice(0, 3).join(" < ") || st.slice(0, 80);
const bang = khung.map((k) => {
  const r = raf.filter((x) => x.t >= k - 300 && x.t <= k + 5).map((x) => chuKy(x.st));
  const c = commit.filter((x) => x.t >= k - 400 && x.t <= k + 5).map((x) => `${(x.renderer || "").replace(/@.*/, "")}:${x.soDoi}[${(x.doi || []).slice(0, 6).map((d) => `${d.ten}{${d.keys.join(",")}}${d.tid ? "@" + d.tid : ""}`).join(" ")}]`);
  const m = [...ws.filter((x) => x.t >= k - 1500 && x.t <= k).map((x) => `ws:${x.ev}@${x.t}`), ...trpcTrong.filter((x) => x.t >= k - 1500 && x.t <= k).map((x) => `trpc:${x.proc}@${x.t}`)];
  return { khung: k, raf: r, commit: c, mang: m };
});
// Đếm theo chữ ký rAF (mỗi khung tính chữ ký ĐẦU TIÊN trước nó) + theo fiber đổi
const demChuKy = {}; const demFiber = {}; let khongRaf = 0; let khongCommit = 0;
for (const b of bang) { const ck = b.raf.length ? b.raf[b.raf.length - 1] : null; if (!ck) khongRaf += 1; else demChuKy[ck] = (demChuKy[ck] ?? 0) + 1; if (!b.commit.length) khongCommit += 1; }
for (const c of commit) for (const d of c.doi || []) { const k = `${(c.renderer || "").replace(/@.*/, "")} ${d.ten}{${d.keys.join(",")}}${d.tid ? "@" + d.tid : ""}`; demFiber[k] = (demFiber[k] ?? 0) + 1; }
// Trích đoạn bundle quanh vị trí đầu của mỗi chữ ký (định danh mã nguồn từ chuỗi đặc trưng)
const bundleTen = (raf[0]?.st.match(/index-[A-Za-z0-9_-]+\.js/) ?? [null])[0];
let bundle = null; try { if (bundleTen) bundle = readFileSync(`dist/public/assets/${bundleTen}`, "utf8").split("\n"); } catch {}
const trich = (ck) => { const m = ck.match(/^(\d+):(\d+)/); if (!m || !bundle) return null; const line = bundle[Number(m[1]) - 1] ?? ""; const c = Number(m[2]); return line.slice(Math.max(0, c - 220), c + 120).replace(/\s+/g, " "); };
const top = Object.entries(demChuKy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ck, n]) => ({ ck, n, trich: trich(ck) }));
const topFiber = Object.entries(demFiber).sort((a, b) => b[1] - a[1]).slice(0, 25);
writeFileSync(`${OUT}/${MAN}-${VP}${TAG}.json`, JSON.stringify({ man: MAN, vp: VP, luc: new Date().toISOString(), tongKhung: khung.length, khung, raf, commit, ws, trpc: trpcTrong, renderers, bang, demChuKy, khongRaf, khongCommit, top, topFiber }, null, 2));
console.log(`[${MAN} ${VP}] ${khung.length} khung/40 s · rAF ${raf.length} lời gọi · commit ${commit.length} (${JSON.stringify(commit.reduce((a, c) => { const k = (c.renderer || "?").replace(/@.*/, ""); a[k] = (a[k] ?? 0) + 1; return a; }, {}))}) · ws ${ws.length} · trpc ${trpcTrong.length} · khung KHÔNG có rAF trong 300 ms trước: ${khongRaf} · KHÔNG có commit trong 400 ms trước: ${khongCommit}`);
console.log(`  renderers: ${JSON.stringify(renderers)}`);
console.log(`  chữ ký rAF (khung ← rAF cuối trước nó):`); for (const t of top) console.log(`    ${String(t.n).padStart(3)} × ${t.ck}\n        ${(t.trich || "").slice(0, 300)}`);
console.log(`  fiber đổi props (mọi commit trong 40 s):`); for (const [k, n] of topFiber) console.log(`    ${String(n).padStart(3)} × ${k}`);
console.log(`  mạng: ws ${ws.map((w) => `${w.ev}@${w.t}`).join(" ")} · trpc ${trpcTrong.map((x) => `${x.proc}@${x.t}`).join(" ")}`);
for (const b of bang) console.log(`  khung@${String(b.khung).padStart(5)} ← rAF ${b.raf.slice(-2).join(" | ") || "(không)"} ← commit ${b.commit.slice(-2).join(" | ").slice(0, 260) || "(không)"} ← ${b.mang.join(" ") || "(không mạng 1,5 s)"}`);
await browser.close();
