// ĐỢT 54 · mục B — HỢP ĐỒNG TRẠNG THÁI: MỘT máy, MỘT thời điểm, SÁU bề mặt phải nói MỘT chữ.
//   Bề mặt: 1 factoryCommand.overview · 2 factoryCommand.machineDetail · 3 assetCockpit.machineDetail.liveState
//           4 socket `twin:trangThai` · 5 /twin danh sách (DOM) · 6 /twin/may/:id chip (DOM)
//   Khác harness Đợt 34/52: GHI THÊM `operationStatus` và `statusMapped` — hai trường mà QA lần 8 chỉ ra là
//   nơi dữ kiện BIẾN MẤT (`liveState.value.operationStatus = null` ⇒ `mapMachineStatus` rơi `default: running`).
//   Đường ra lấy từ argv (G130). node .qa-dot54/hopdong53.mjs --base=http://localhost:3054 --may=14 --out=.qa-dot54/hd-truoc
import { chromium } from "@playwright/test";
import { io } from "socket.io-client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3054");
const MAY = Number(arg("may", "14"));
const OUT = arg("out", ".qa-dot54/hd-truoc");
const GIAY = Number(arg("giay", "14"));
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const STATE = ".qa-dot54/state-e2e_tai_loE.json";

async function trpcGet(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null, tho: t.slice(0, 200) };
}
async function dangNhap(ctx) {
  const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null;
  if (existsSync(STATE)) { await ctx.addCookies(JSON.parse(readFileSync(STATE, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(STATE, JSON.stringify(await ctx.cookies()));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await dangNhap(ctx);
const kq = { luc: new Date().toISOString(), base: BASE, may: MAY, beMat: {} };

/* ── 1 overview ─────────────────────────────────────────────────────────── */
const ov = await trpcGet(ctx, "factoryCommand.overview", { factoryId: 1 });
const nodes = ov.data?.machines ?? [];
const n = nodes.find((x) => x.id === MAY) ?? null;
kq.beMat["1-factoryCommand.overview"] = { httpStatus: ov.status, soMay: nodes.length, status: n?.status ?? null, code: n?.code ?? null };
kq.phanBoOverview = nodes.reduce((a, x) => { a[x.status] = (a[x.status] ?? 0) + 1; return a; }, {});

/* ── 2 factoryCommand.machineDetail ─────────────────────────────────────── */
const fc = await trpcGet(ctx, "factoryCommand.machineDetail", { machineId: MAY });
kq.beMat["2-factoryCommand.machineDetail"] = { httpStatus: fc.status, status: fc.data?.status ?? null, liveStatusRaw: fc.data?.liveStatusRaw ?? null };

/* ── 3 assetCockpit.machineDetail.liveState ─────────────────────────────── */
const cd = await trpcGet(ctx, "assetCockpit.machineDetail", { machineId: MAY });
const ls = cd.data?.liveState ?? null;
kq.beMat["3-assetCockpit.liveState"] = {
  httpStatus: cd.status,
  available: ls?.available ?? null,
  status: ls?.value?.status ?? null,
  connected: ls?.value?.connected ?? null,
  // ★ hai trường TRỌNG TÂM của mục B
  operationStatus: ls?.value === undefined ? "(khong co value)" : ("operationStatus" in (ls?.value ?? {}) ? ls.value.operationStatus : "(KHONG CO KHOA)"),
  statusMapped: ls?.value?.statusMapped ?? null,
  lastHeartbeat: ls?.value?.lastHeartbeat ? new Date(ls.value.lastHeartbeat).toISOString() : null,
};

/* ── 4 socket twin:trangThai ────────────────────────────────────────────── */
const cookie = (await ctx.cookies()).find((c) => c.name === "app_session_id");
const soc = { goi: 0, trangThai: null, loi: null };
await new Promise((res) => {
  const sk = io(BASE, { path: "/api/socket.io", transports: ["websocket"], extraHeaders: cookie ? { Cookie: `app_session_id=${cookie.value}` } : {}, reconnection: false });
  sk.on("connect", () => sk.emit("subscribe", { twinFactoryId: 1 }));
  sk.on("twin:trangThai", (g) => {
    if (g?.factoryId !== 1) return;
    soc.goi += 1;
    const m = (g.may ?? []).find((x) => x.machineId === MAY);
    if (m) soc.trangThai = m.trangThai ?? m.trang_thai ?? JSON.stringify(m).slice(0, 120);
  });
  sk.on("connect_error", (e) => { soc.loi = String(e?.message ?? e).slice(0, 120); });
  setTimeout(() => { sk.close(); res(); }, GIAY * 1000);
});
kq.beMat["4-socket twin:trangThai"] = soc;

/* ── 5 /twin danh sách (DOM) · 6 /twin/may/:id chip (DOM) ───────────────── */
const page = await ctx.newPage();
await page.goto(`${BASE}/twin?do=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(6000);
kq.beMat["5-/twin danh sach (DOM)"] = await page.evaluate((id) => {
  // testid THẬT của hàng trong `DanhSachMay.tsx:356` là `may-hang-<id>` (bản đầu của tôi gõ `hang-may-`
  // ⇒ bề mặt 5 khai `coPhanTu:false` — phép đo của TÔI sai, không phải sản phẩm thiếu).
  const el = document.querySelector(`[data-testid="may-hang-${id}"]`);
  return { coPhanTu: !!el, trangThai: el?.getAttribute("data-trang-thai") ?? null, chu: el?.textContent?.trim().slice(0, 60) ?? null };
}, MAY);
await page.screenshot({ path: `${OUT}/be-mat-5-twin.png` });

await page.goto(`${BASE}/twin/may/${MAY}?do=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="man-twin-may"] canvas', { timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(6000);
kq.beMat["6-/twin/may chip (DOM)"] = await page.evaluate(() => {
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chip = q("chip-may");
  const tt = q("trang-thai-may");
  const cock = q("cockpit-2d");
  return {
    chip: chip?.textContent?.trim().slice(0, 90) ?? null,
    chipTrangThai: chip?.getAttribute("data-trang-thai") ?? null,
    trangThaiMay: tt ? { chu: tt.textContent?.trim() ?? null, tt: tt.getAttribute("data-trang-thai") } : null,
    cockpitChu: cock?.textContent?.replace(/\s+/g, " ").slice(0, 160) ?? null,
  };
});
await page.screenshot({ path: `${OUT}/be-mat-6-may.png` });

writeFileSync(`${OUT}/tong.json`, JSON.stringify(kq, null, 2));
console.log(`=== HỢP ĐỒNG máy ${MAY} · ${OUT} ===`);
for (const [k, v] of Object.entries(kq.beMat)) console.log(`   ${k.padEnd(34)} ${JSON.stringify(v)}`);
console.log(`   phân bố overview: ${JSON.stringify(kq.phanBoOverview)}`);
await browser.close();
