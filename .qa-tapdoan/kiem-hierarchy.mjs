// Xác minh lỗ rò: commandCenter.hierarchy có lọc tenant không?
// Đối chứng hai chiều CÙNG PHIÊN: factory.list và factoryCommand.overview phải lọc.
import crypto from "node:crypto";
const BASE="http://localhost:3064";
const dn=async u=>{const r=await fetch(`${BASE}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:u,password:"Qatd!2026"}),redirect:"manual"});return (r.headers.getSetCookie?.()??[]).map(c=>c.split(";")[0]).join("; ");};
const goi=async(ck,p,inp)=>{const q=inp===undefined?"":`?input=${encodeURIComponent(JSON.stringify({json:inp}))}`;const t0=Date.now();const r=await fetch(`${BASE}/api/trpc/${p}${q}`,{headers:{cookie:ck}});const t=await r.text();const ms=Date.now()-t0;let j=null;try{j=JSON.parse(t);}catch{}return{st:r.status,byte:t.length,ms,md5:crypto.createHash("md5").update(t).digest("hex"),d:j?.result?.data?.json??j?.result?.data,err:j?.error?.json?.data?.code??j?.error?.data?.code??null};};
const kq={};
for (const u of ["qatd_admin","qatd_giamdoc","qatd_kythuat","qatd_congnhan","qatd_khonggan","qatd_khongquyen"]) {
  const ck=await dn(u);
  const h=await goi(ck,"commandCenter.hierarchy");
  const fl=await goi(ck,"factory.list");
  const ov=await goi(ck,"factoryCommand.overview");
  // đếm thực thể trong cây trả về
  let dem=null, ten=null;
  if (h.d) { const s=JSON.stringify(h.d);
    dem = { may:(s.match(/"machine"/g)||[]).length||undefined, chuoiByte:s.length };
    ten = ["QATD-A","QATD-B","QATD-C","SIM-FAC","T12-SHOT"].filter(x=>s.includes(x));
  }
  kq[u]={
    hierarchy:{st:h.st,byte:h.byte,ms:h.ms,md5:h.md5.slice(0,12),err:h.err,tenLoRa:ten,dem},
    factoryList:{so:Array.isArray(fl.d)?fl.d.length:fl.err, ms:fl.ms},
    overview:{may:Array.isArray(ov.d?.machines)?ov.d.machines.length:ov.err, byte:ov.byte, ms:ov.ms},
  };
}
const md5s=Object.entries(kq).filter(([,v])=>v.hierarchy.md5&&!v.hierarchy.err).map(([u,v])=>[u,v.hierarchy.md5]);
console.log(JSON.stringify(kq,null,1));
console.log("\n== md5 hierarchy theo vai:", JSON.stringify(md5s));
console.log("== số md5 khác nhau:", new Set(md5s.map(x=>x[1])).size, "(1 = MỌI VAI NHẬN BYTE Y HỆT ⇒ 0 lọc tenant)");
