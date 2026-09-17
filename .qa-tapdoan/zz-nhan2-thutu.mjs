/**
 * zz-nhan2-thutu.mjs — CHỌN THỨ TỰ ỨNG VIÊN BẰNG SỐ, KHÔNG BẰNG Ý THÍCH.
 * V1 = trượt chèn NGAY SAU neo sinh ra nó (đang vá).
 * V2 = trượt DỒN XUỐNG CUỐI, sau cả `phu`  → phương án nhỏ hơn.
 * Cả hai phải: (a) tái hiện phép đo ở mọi nhãn baseline, (b) vá được "Toà 2",
 * (c) V2 thêm: giữ nguyên kết quả ca ⑦ tổng hợp của lưới cũ.
 */
import fs from "node:fs";
const J = JSON.parse(fs.readFileSync(".qa-tapdoan/zz-nhan2-do1-truoc.json", "utf8"));
const KHE = 6, TRAN = 40;
const chePhu=(vc,x,y)=>vc.find(z=>x>=z.trai&&x<=z.phai&&y>=z.tren&&y<=z.duoi)??null;
const giaoLop=(vc,x,y,co)=>{const t=x-co.rong/2,p=x+co.rong/2,tr=y-co.cao/2,d=y+co.cao/2;
  return vc.find(z=>z.trai<p&&z.phai>t&&z.tren<d&&z.duoi>tr)??null;};
function ds(hop,co,uuTien){
  const gX=(hop.trai+hop.phai)/2,gY=(hop.tren+hop.duoi)/2,nC=co.cao/2,nR=co.rong/2;
  const yT=hop.tren-KHE-nC,yD=hop.duoi+KHE+nC;
  const oT=["tren-giua",gX,yT],oD=["duoi-giua",gX,yD],oI=["trong-giua",gX,gY];
  const dau=uuTien==="tren"?[oT,oD]:uuTien==="duoi"?[oD,oT]:[oI,oT,oD];
  return {dau,phu:[["trong-duoi",gX,hop.duoi-KHE-nC],["trong-tren",gX,hop.tren+KHE+nC],
    ["tren-phai",hop.phai-nR,yT],["tren-trai",hop.trai+nR,yT],
    ["duoi-phai",hop.phai-nR,yD],["duoi-trai",hop.trai+nR,yD]]};
}
function dat(hop,co,vungCam,khung,uuTien,cuoi){
  const {dau,phu}=ds(hop,co,uuTien); const [mD,xD,yD]=dau[0];
  if(!(khung.rong>0)||!(khung.cao>0)) return {x:xD,y:yD,ma:mD};
  const uv=[],truot=[];
  for(const a of dau){ uv.push(a); const [,x,y]=a; const them=[];
    const tt=z=>{if(!z)return; for(const yy of [z.duoi+KHE+co.cao/2,z.tren-KHE-co.cao/2])
      if(Math.abs(yy-y)<=TRAN) them.push(["truot",x,yy]);};
    const ch=giaoLop(vungCam,x,y,co); tt(ch);
    const ct=chePhu(vungCam,x,y); if(ct&&ct!==ch) tt(ct);
    if(cuoi) truot.push(...them); else uv.push(...them); }
  uv.push(...phu); if(cuoi) uv.push(...truot);
  const tk=(x,y)=>x>=0&&x<=khung.rong&&y>=0&&y<=khung.cao;
  for(const [m,x,y] of uv){ if(!tk(x,y))continue; if(giaoLop(vungCam,x,y,co))continue; return {x,y,ma:m}; }
  for(const [m,x,y] of uv){ if(!tk(x,y))continue; if(chePhu(vungCam,x,y))continue; return {x,y,ma:m}; }
  return null;
}
// ── ca ⑦ của lưới cũ ──
const THE={trai:0,phai:470,tren:34,duoi:400}, KHOI={trai:420,phai:560,tren:300,duoi:380}, CO={rong:60,cao:18};
for(const cuoi of [false,true]){
  const d=dat(KHOI,CO,[THE],{rong:968,cao:489},"trong",cuoi);
  const ok = d.x-CO.rong/2>=THE.phai && Math.abs(d.x-490)>1e-6;
  console.log(`ca ⑦ lưới cũ · trượt-${cuoi?"CUỐI (V2)":"ngay-sau-neo (V1)"}: ${JSON.stringify(d)} ⇒ lưới cũ ${ok?"XANH ✓":"ĐỎ ✗"}`);
}
// ── ca THẬT "Toà 2" kythuat 3D ──
const K2={trai:356.3,phai:445.1,tren:182.7,duoi:245.3}, CT={rong:37.7,cao:18.5}, KPI={trai:232,phai:470,tren:34,duoi:254.3};
const giao=(h,z)=>Math.max(0,Math.min(h.phai,z.phai)-Math.max(h.trai,z.trai))*Math.max(0,Math.min(h.duoi,z.duoi)-Math.max(h.tren,z.tren));
for(const cuoi of [false,true]){
  const d=dat(K2,CT,[KPI],{rong:968,cao:489},"tren",cuoi);
  const h={trai:d.x-CT.rong/2,phai:d.x+CT.rong/2,tren:d.y-CT.cao/2,duoi:d.y+CT.cao/2};
  console.log(`"Toà 2" · trượt-${cuoi?"CUỐI (V2)":"ngay-sau-neo (V1)"}: ${JSON.stringify(d)} giao=${giao(h,KPI).toFixed(1)}px² ⇒ ${giao(h,KPI)===0?"SẠCH TRỌN ✓":"CÒN CHE ✗"}`);
}
