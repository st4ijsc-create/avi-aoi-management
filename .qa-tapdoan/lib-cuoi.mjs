/** NGHIỆM-THU CUỐI — thư viện dùng chung. Không sửa mã sản phẩm. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import postgres from "postgres";
export const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
export const BASE = arg("base", "http://localhost:3064");
export const MK = "Qatd!2026";
export const THO = ".qa-tapdoan/tho/CUOI";
export const ANH = ".qa-tapdoan/anh";
export const LAUNCH = { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] };
mkdirSync(THO, { recursive: true }); mkdirSync(ANH, { recursive: true });
export const MOC = JSON.parse(readFileSync(`${THO}/moc.json`, "utf8"));
const DBURL = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();
export const sqlMo = () => postgres(DBURL, { max: 2 });

export function luu(ten, obj) {
  const p = `${THO}/${ten}.json`;
  writeFileSync(`${p}.tmp`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, ...obj }, null, 1));
  renameSync(`${p}.tmp`, p);
  return p;
}
export const bao = (ca, pq, vi) => console.log(`  ${String(pq).padEnd(11)} ${ca} · ${String(vi).slice(0, 520)}`);

/** Phán quyết: thiếu dữ kiện ⇒ HỎNG kèm TÊN; tập rỗng ⇒ gọi phải tự kiểm. */
export function phan(can, kiem) {
  const thieu = Object.entries(can).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (thieu.length) return { pq: "HỎNG", vi: `thiếu dữ kiện: ${thieu.join(", ")}`, thieu };
  const sai = kiem.filter((k) => !k.ok);
  if (sai.length) return { pq: "SAI", vi: sai.map((k) => `${k.ten}: ${k.thay}`).join(" · "), sai: sai.map((k) => k.ten) };
  return { pq: "ĐẠT", vi: kiem.map((k) => `${k.ten} OK`).join(" · ") };
}

export async function dangNhapCtx(ctx, u) {
  const f = `.qa-tapdoan/state-CUOI-${u}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === u) return "cache"; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: MK } });
  const ten = await ai();
  if (r.status() !== 200 || ten !== u) throw new Error(`dang nhap that bai ${u}: login=${r.status()} me=${ten}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return "moi";
}
export async function layCookie(browser, user) {
  const ctx = await browser.newContext();
  try { await dangNhapCtx(ctx, user); return await ctx.cookies(); } finally { await ctx.close(); }
}
export async function trpcPost(ctx, proc, input) {
  const r = await ctx.request.post(`${BASE}/api/trpc/${proc}`, { data: { json: input } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  const boc = j?.result?.data;
  return { http: r.status(), data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null), ma: j?.error?.json?.data?.code ?? null, loi: (j?.error?.json?.message ?? null)?.slice(0, 300) ?? null, tho: t.slice(0, 300) };
}
export async function trpcGet(ctx, proc, input) {
  const r = await ctx.request.get(`${BASE}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  const boc = j?.result?.data;
  return { http: r.status(), data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null), ma: j?.error?.json?.data?.code ?? null, loi: (j?.error?.json?.message ?? null)?.slice(0, 300) ?? null, tho: t.slice(0, 300) };
}
export const anh = async (page, ten) => { const p = `${ANH}/CUOI-${ten}.png`; await page.screenshot({ path: p }); return p; };

/** Chờ cảnh: khung đầu đã vẽ (`__thongKeVe.calls > 0`) rồi tới khi hết spinner. */
export async function choCanh(page, moc = 0) {
  const toi = await page.waitForFunction((m) => (window.__thongKeVe?.calls ?? 0) > m, moc, { timeout: 120_000 }).then(() => true).catch(() => false);
  await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
  return toi;
}
export const pct = (xs, q) => { const a = xs.filter((x) => x != null).sort((m, n) => m - n); if (!a.length) return null; const i = Math.min(a.length - 1, Math.ceil((q / 100) * a.length) - 1); return a[Math.max(0, i)]; };
