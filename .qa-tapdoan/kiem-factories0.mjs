// Phép đo QUYẾT ĐỊNH: nếu ADMIN (bypass mọi quyền, thấy 5 nhà máy) KHÔNG mở được máy/line
// mà CÔNG NHÂN (quyền hẹp nhất, 1 nhà máy) mở được CÙNG máy đó ⇒ không thể là quyền/phạm vi.
const BASE = "http://localhost:3064";
const dn = async (u) => { const r = await fetch(`${BASE}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:u,password:"Qatd!2026"}),redirect:"manual"}); return (r.headers.getSetCookie?.()??[]).map(c=>c.split(";")[0]).join("; "); };
const goi = async (ck,p,inp) => { const q = inp===undefined?"":`?input=${encodeURIComponent(JSON.stringify({json:inp}))}`; const r = await fetch(`${BASE}/api/trpc/${p}${q}`,{headers:{cookie:ck}}); const t=await r.text(); let j=null; try{j=JSON.parse(t);}catch{} return { st:r.status, d:j?.result?.data?.json ?? j?.result?.data, err:j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null }; };
const kq = {};
for (const u of ["qatd_admin","qatd_giamdoc","qatd_kythuat","qatd_congnhan"]) {
  const ck = await dn(u);
  const fl = await goi(ck,"factory.list");
  const ds = Array.isArray(fl.d)? fl.d : [];
  const dau = ds[0];
  // API cấp máy: có thấy máy 4977 (QATD-C) không?
  const md = await goi(ck,"factoryCommand.machineDetail",{machineId:4977});
  // toà nhà của nhà máy ĐẦU (đúng thứ thay TwinMay hỏi) và của QATD-C (40)
  const tnDau = dau ? await goi(ck,"twinCanh.danhSachToaNha",{factoryId:dau.id}) : {d:null};
  const tnC   = await goi(ck,"twinCanh.danhSachToaNha",{factoryId:40});
  kq[u] = {
    soNhaMay: ds.length,
    nhaMayDau: dau ? `${dau.id} ${dau.code} ${dau.name}` : null,
    thuTu: ds.map(f=>f.name),
    may4977_API: md.err ?? (md.d ? "CÓ DỮ LIỆU" : "null"),
    toaNhaCuaNhaMayDau: Array.isArray(tnDau.d)? tnDau.d.length : (tnDau.err??"?"),
    toaNhaCuaQATD_C: Array.isArray(tnC.d)? tnC.d.map(t=>t.ma) : (tnC.err??"?"),
  };
}
console.log(JSON.stringify(kq,null,1));
