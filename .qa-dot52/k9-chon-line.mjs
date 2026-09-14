// ĐỢT 52 · K9 — NỬA CÒN LẠI CỦA YÊU CẦU GỐC: "từ nhà máy CHỌN LINE ⇒ hiển thị Line 3D Twin".
//   Brief Đợt 52 chỉ kê K8 (bấm MÁY). Yêu cầu gốc của chủ sở hữu có HAI vế; vế Line phải đo bằng
//   ĐƯỜNG NGƯỜI DÙNG THẬT (G123), không bằng redirect gõ tay.
//   Đường đo: /twin → bật "Cây phân cấp" → CLICK node line → kỳ vọng /twin/line/:id + canvas vẽ xong.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith(`--${k}=`));return m?m.slice(k.length+3):d;};
const BASE=arg("base","http://localhost:3052"); const VPS=arg("vp","1600x900,1280x720").split(",");
const OUT=".qa-dot52/k9"; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch(); const ca=[];
try{
for(const vp of VPS){
 const [W,H]=vp.split("x").map(Number);
 const ctx=await b.newContext({viewport:{width:W,height:H}});
 await ctx.addInitScript(()=>{try{localStorage.setItem("i18nextLng","vi");}catch{}});
 await ctx.addCookies(JSON.parse(readFileSync(".qa-dot52/state-e2e_tai_loE.json","utf8")));
 const p=await ctx.newPage();
 await p.addInitScript(()=>{window.__doBam={tClick:null,tPush:null};document.addEventListener("click",()=>{window.__doBam.tClick=performance.now();window.__doBam.tPush=null;},true);const g=history.pushState.bind(history);history.pushState=function(...a){window.__doBam.tPush=performance.now();return g(...a);};});
 await p.goto(`${BASE}/twin?do=1`,{waitUntil:"domcontentloaded"});
 await p.waitForSelector('[data-testid="man-twin-van-hanh"] canvas',{timeout:90_000});
 await p.waitForTimeout(4_000);
 // bật cây phân cấp
 const coNut=await p.locator('[data-testid="mo-cay-phan-cap"]').count();
 if(coNut) await p.locator('[data-testid="mo-cay-phan-cap"]').click();
 await p.waitForTimeout(1_500);
 // ★ cây mở MẶC ĐỊNH chỉ 1 node gốc (workshop) ⇒ phải BUNG bằng nút mũi tên (đường người dùng thật)
 for(let lan=0; lan<4; lan++){
   const n=await p.evaluate(()=>[...document.querySelectorAll('[data-testid^="node-cay-"]')].filter(el=>el.getAttribute("aria-expanded")==="false").map(el=>el.getAttribute("data-testid")));
   if(!n.length) break;
   for(const tid of n){ const nut=p.locator(`[data-testid="${tid}"] button`).first(); if(await nut.count()) { await nut.click().catch(()=>{}); await p.waitForTimeout(180);} }
 }
 await p.waitForTimeout(800);
 const nodes=await p.evaluate(()=>[...document.querySelectorAll('[data-testid^="node-cay-"]')].map(el=>({tid:el.getAttribute("data-testid"),chu:(el.textContent||"").replace(/\s+/g," ").trim().slice(0,40)})));
 const lines=nodes.filter(n=>/node-cay-line[:%]/.test(n.tid));
 const r={vp,coNutCay:coNut,soNode:nodes.length,soNodeLine:lines.length,nodes:nodes.slice(0,20),bam:[]};
 for(const ln of lines.slice(0,3)){
   const urlT=p.url();
   await p.locator(`[data-testid="${ln.tid}"]`).click();
   const toi=await p.waitForURL(/\/twin\/line\/\d+/,{timeout:5_000}).then(()=>true).catch(()=>false);
   const url=p.url(); const id=(url.match(/\/twin\/line\/(\d+)/)??[])[1]??null;
   const ve=await p.waitForSelector('[data-testid="man-twin-line"] canvas',{timeout:60_000}).then(()=>true).catch(()=>false);
   await p.waitForFunction(()=>(window.__demTuongTac?.dsMay?.()??[]).some(m=>m.trongKhung),null,{timeout:60_000}).catch(()=>{});
   await p.waitForTimeout(2_500);
   /* ★★★ SỬA THIẾT BỊ ĐO (lần 2 trong đợt này): bản đầu chấm bằng `__demTuongTac.dsMay()`.
      Điều hướng TRONG TRANG từ `/twin?do=1` sang `/twin/line/:id` LÀM MẤT `?do=1` ⇒ cảnh mới
      KHÔNG gắn cửa sổ đo, `dsMay()` còn lại là closure CŨ của cảnh đã unmount ⇒ trả 0.
      K8 đo CÙNG màn (mở thẳng `/twin/line/2?do=1`) thấy 12 máy ⇒ mâu thuẫn lộ ra phép đo sai,
      không phải sản phẩm sai. Chấm lại bằng tín hiệu DOM/không phụ thuộc `?do=1`. */
   const dem=await p.evaluate(()=>({canvas:document.querySelectorAll('[data-testid="man-twin-line"] canvas').length,soCanvas:window.__soCanvas??null,calls:window.__thongKeVe?.calls??null,may:(window.__demTuongTac?.dsMay?.()??[]).filter(m=>m.trongKhung).length,nhan:document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,oTram:document.querySelectorAll('[data-testid^="o-tram-"]:not([data-testid^="o-tram-wip-"])').length,daiLine:document.querySelectorAll('[data-testid="dai-line"]').length}));
   const doBam=await p.evaluate(()=>window.__doBam??null);
   const tre=doBam?.tClick!=null&&doBam?.tPush!=null?+(doBam.tPush-doBam.tClick).toFixed(2):null;
   const png=`${OUT}/k9-${vp}-${ln.tid}.png`; await p.screenshot({path:png});
   const ok=toi&&/\/twin\/line\/\d+$/.test(new URL(url).pathname)&&ve&&dem.canvas>=1&&dem.soCanvas===1&&(dem.calls??0)>0&&dem.nhan>0&&dem.oTram>=1;
   r.bam.push({node:ln.tid,chu:ln.chu,urlTruoc:urlT,url,lineId:id,toi,ve,...dem,treTrongTrang:tre,png,ok});
   console.log(`   ${ok?"ĐẠT ":"SAI "} K9 @${vp} bấm "${ln.chu}" (${ln.tid}) ⇒ ${new URL(url).pathname} · canvas ${dem.canvas}/kit ${dem.soCanvas} · nhãn máy ${dem.nhan} · ô trạm ${dem.oTram} · dải line ${dem.daiLine} · draw ${dem.calls} · trễ trong trang ${tre} ms`);
   // quay lại /twin và mở cây lần nữa
   await p.goto(`${BASE}/twin?do=1`,{waitUntil:"domcontentloaded"});
   await p.waitForSelector('[data-testid="man-twin-van-hanh"] canvas',{timeout:90_000}); await p.waitForTimeout(3_000);
   if(await p.locator('[data-testid="mo-cay-phan-cap"]').count()) await p.locator('[data-testid="mo-cay-phan-cap"]').click();
   await p.waitForTimeout(1_200);
   for(let lan=0; lan<4; lan++){ const n=await p.evaluate(()=>[...document.querySelectorAll('[data-testid^="node-cay-"]')].filter(el=>el.getAttribute("aria-expanded")==="false").map(el=>el.getAttribute("data-testid"))); if(!n.length) break; for(const tid of n){ const nut=p.locator(`[data-testid="${tid}"] button`).first(); if(await nut.count()) { await nut.click().catch(()=>{}); await p.waitForTimeout(180);} } }
   await p.waitForTimeout(600);
 }
 if(!lines.length) console.log(`   SAI  K9 @${vp}: 0 node line trong cây (nodes: ${nodes.map(n=>n.tid).slice(0,12).join(", ")})`);
 ca.push(r); await p.close(); await ctx.close();
}
} finally { await b.close(); }
writeFileSync(`${OUT}/k9.json`,JSON.stringify(ca,null,2));
const t=ca.flatMap(x=>x.bam); console.log(`=== K9: ĐẠT ${t.filter(x=>x.ok).length}/${t.length} cú bấm LINE ===`);
