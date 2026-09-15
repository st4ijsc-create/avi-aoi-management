// Đo phạm vi qua API thật (đường sản phẩm): login /api/auth/login rồi gọi tRPC.
// Dùng: node .qa-tapdoan/api-vai.mjs [base] > tệp
const BASE = process.argv[2] || "http://localhost:3064";
const MK = "Qatd!2026";
const VAI = ["qatd_giamdoc","qatd_quanly","qatd_kythuat","qatd_congnhan","qatd_admin","qatd_khonggan","qatd_khongquyen"];
const dangNhap = async (u) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({username:u,password:MK}), redirect:"manual" });
  const ck = (r.headers.getSetCookie?.() ?? []).map(c=>c.split(";")[0]).join("; ");
  const body = await r.text();
  return { ok:r.ok, status:r.status, cookie:ck, body: body.slice(0,200) };
};
const goi = async (cookie, path, input) => {
  const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({json:input}))}`;
  const r = await fetch(`${BASE}/api/trpc/${path}${q}`, { headers:{cookie} });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  const d = j?.result?.data?.json ?? j?.result?.data;
  const err = j?.error?.json?.data?.code ?? j?.error?.data?.code ?? j?.error?.json?.message ?? (r.ok?null:`HTTP${r.status}`);
  return { status:r.status, data:d, err, thoLen:t.length };
};
const kq = {};
for (const u of VAI) {
  const lg = await dangNhap(u);
  if (!lg.ok) { kq[u] = { login:lg.status, ghi:lg.body }; continue; }
  const fl = await goi(lg.cookie, "factory.list");
  const ov = await goi(lg.cookie, "factoryCommand.overview");
  const nmIds = Array.isArray(fl.data) ? fl.data.map(f=>f.id) : null;
  const perNm = {};
  if (nmIds) for (const id of nmIds.slice(0,8)) { const o = await goi(lg.cookie, "factoryCommand.overview", {factoryId:id}); perNm[id] = Array.isArray(o.data?.machines)? o.data.machines.length : (o.err||"?"); }
  const tn = nmIds?.length ? await goi(lg.cookie, "twinCanh.danhSachToaNha", {factoryId:nmIds[0]}) : {err:"không có nhà máy"};
  kq[u] = {
    login: lg.status,
    factoryList: nmIds ? { so: nmIds.length, ma: fl.data.map(f=>f.code) } : { err: fl.err },
    overviewKhongThamSo: Array.isArray(ov.data?.machines) ? { may: ov.data.machines.length, nhaMay: ov.data.factories?.length ?? null } : { err: ov.err },
    overviewTheoNhaMay: perNm,
    toaNhaCuaNhaMayDau: Array.isArray(tn.data) ? tn.data.length : (tn.err ?? "?"),
  };
}
console.log(JSON.stringify(kq, null, 1));
