// LÔ F — thư viện dùng chung: đăng nhập (cache cookie), đường ra ghi-tạm-rồi-mv (G129/G130).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
export const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
export const BASE = arg("base", "http://localhost:3064");
export const MK = "Qatd!2026";
export const THO = ".qa-tapdoan/tho/F";
export const ANH = ".qa-tapdoan/anh";
mkdirSync(THO, { recursive: true }); mkdirSync(ANH, { recursive: true });

export function ghi(ten, obj) {
  const tmp = `${THO}/.tmp-${ten}-${process.pid}.json`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, `${THO}/${ten}.json`);
}
async function me(ctx) {
  const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`);
  try { const j = JSON.parse(await r.text()); return j?.result?.data?.json?.username ?? j?.result?.data?.username ?? null; } catch { return null; }
}
/** Đăng nhập một lần cho mỗi tài khoản, trả về mảng cookie để tiêm vào context MỚI (context mới ⇒ cache HTTP rỗng). */
export async function layCookie(browser, user) {
  const f = `.qa-tapdoan/state-F-${user}.json`;
  const ctx = await browser.newContext();
  try {
    if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await me(ctx)) === user) return await ctx.cookies(); await ctx.clearCookies(); }
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: user, password: MK } });
    const ai = await me(ctx);
    if (r.status() !== 200 || ai !== user) throw new Error(`dang nhap that bai ${user}: login=${r.status()} me=${ai}`);
    const ck = await ctx.cookies();
    writeFileSync(f, JSON.stringify(ck));
    return ck;
  } finally { await ctx.close(); }
}
export const TANG_DONG = { nm: 38, toa: 54, tang: 88, may: 68, nhan: "QATD-A toà T2 tầng 1" };
export const p = (xs, q) => { const a = xs.filter((x) => x != null).sort((m, n) => m - n); if (!a.length) return null; const i = Math.min(a.length - 1, Math.ceil((q / 100) * a.length) - 1); return a[Math.max(0, i)]; };
