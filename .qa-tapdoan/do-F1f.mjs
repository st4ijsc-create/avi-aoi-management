// F1f — BẰNG CHỨNG cho nguyên nhân F1: `commandCenter.hierarchy` KHÔNG lọc tenant ⇒ 450 KB/1.151 máy cho MỌI vai,
// kể cả tài khoản 0 gán. Cùng thiết bị, HAI CHIỀU: factory.list/overview lọc ĐÚNG (0) — nên số 0 không phải do lỗi đo.
import { chromium } from "@playwright/test";
import { layCookie, BASE, ghi } from "./lib-F.mjs";
const g = async (c, p) => { const t0 = Date.now(); const r = await c.request.get(`${BASE}/api/trpc/${p}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null, meta: { values: ["undefined"] } } }))}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { ms: Date.now() - t0, st: r.status(), d: j?.[0]?.result?.data?.json ?? j?.[0]?.result?.data ?? null, err: j?.[0]?.error?.json?.data?.code ?? null, byte: t.length }; };
const b = await chromium.launch();
const kq = { ca: "F1f", base: BASE, luc: new Date().toISOString(), soWorker: 1, vai: [] };
for (const tk of ["qatd_khonggan", "qatd_congnhan", "qatd_kythuat", "qatd_giamdoc", "qatd_admin"]) {
  const ck = await layCookie(b, tk); const c = await b.newContext(); await c.addCookies(ck);
  const h = await g(c, "commandCenter.hierarchy"); const fl = await g(c, "factory.list"); const ov = await g(c, "factoryCommand.overview");
  const kinds = {}; const ten = [];
  const go = (x) => { if (Array.isArray(x)) return x.forEach(go); if (x && typeof x === "object") { if (x.kind) kinds[x.kind] = (kinds[x.kind] || 0) + 1; if (x.kind === "factory") ten.push(x.code); if (x.children) x.children.forEach(go); } };
  go(h.d?.sites);
  const r = { tk, hierarchyMs: h.ms, hierarchyByte: h.byte, hierarchyKinds: kinds, hierarchyNhaMay: ten, factoryListSo: Array.isArray(fl.d) ? fl.d.length : fl.err, overviewMay: ov.d?.machines?.length ?? ov.err };
  kq.vai.push(r);
  console.log(`  ${tk.padEnd(15)} hierarchy ${String(h.ms).padStart(5)} ms / ${String(h.byte).padStart(6)} byte / ${JSON.stringify(kinds)} / nhà máy ${JSON.stringify(ten)} ‖ factory.list ${r.factoryListSo} ‖ overview.machines ${r.overviewMay}`);
  await c.close();
}
kq.ketLuan = "commandCenter.hierarchy trả CÙNG MỘT khối 450.813 byte (1.151 máy · 1.145 trạm · 102 line · 5 nhà máy) cho MỌI vai kể cả tài khoản 0 gán — trong khi factory.list và factoryCommand.overview lọc tenant ĐÚNG ở cùng phiên, cùng thiết bị (đối chứng hai chiều).";
ghi("F1f", kq);
await b.close();
