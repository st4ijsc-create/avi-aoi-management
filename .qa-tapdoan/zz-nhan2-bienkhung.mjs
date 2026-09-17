import { chromium } from "playwright";
const GOC = process.env.GOC_QA || "http://localhost:3067";
const t = await chromium.launch({ args:["--use-angle=default","--enable-gpu","--ignore-gpu-blocklist"] });
const ctx = await t.newContext({ viewport:{width:1280,height:720} });
const p = await ctx.newPage();
await p.request.post(`${GOC}/api/auth/login`,{data:{username:"qatd_admin",password:"Qatd!2026"}});
await p.goto(`${GOC}/twin?pv=tapdoan&do=1`,{waitUntil:"domcontentloaded"});
await p.getByTestId("man-twin-van-hanh").waitFor({timeout:90000}).catch(()=>{});
await p.waitForFunction(()=>{const n=document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;const on=window.__k===n&&n>0;window.__k=n;return on;},undefined,{timeout:120000,polling:1000}).catch(()=>{});
await p.getByTestId("nut-che-2d").click({timeout:15000}).catch(()=>{});
await p.getByTestId("canh-van-hanh-2d").waitFor({timeout:45000}).catch(()=>{});
await p.waitForFunction(()=>{const n=document.querySelectorAll("[data-testid='toa-2d-sa-ban']").length;const on=window.__k2===n&&n>0;window.__k2=n;return on;},undefined,{timeout:45000,polling:800}).catch(()=>{});
const r = await p.evaluate(()=>{
  const svg=document.querySelector("[data-testid='canh-van-hanh-2d']");
  const sr=svg.getBoundingClientRect();
  const out=[];
  for(const e of document.querySelectorAll("[data-testid='nhan-toa-sa-ban-2d'],[data-testid='nhan-cum-sa-ban-2d']")){
    const an=getComputedStyle(e).visibility==="hidden"||e.getAttribute("data-an")==="1";
    if(an) continue;
    const b=e.getBoundingClientRect();
    const treo = Math.max(0, sr.y-b.y) + Math.max(0, (b.y+b.height)-(sr.y+sr.height));
    const treoX = Math.max(0, sr.x-b.x) + Math.max(0, (b.x+b.width)-(sr.x+sr.width));
    if(treo>0||treoX>0) out.push({chu:e.textContent.trim(), hop:{x:Math.round(b.x*10)/10,y:Math.round(b.y*10)/10,w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10},
      thoRaDoc:Math.round(treo*10)/10, thoRaNgang:Math.round(treoX*10)/10, pcDoc:Math.round(treo/b.height*1000)/10});
  }
  return {svg:{x:sr.x,y:sr.y,w:sr.width,h:sr.height}, overflow:getComputedStyle(svg).overflow, thoRa:out,
    soNhanHien:[...document.querySelectorAll("[data-testid='nhan-toa-sa-ban-2d'],[data-testid='nhan-cum-sa-ban-2d']")].filter(e=>!(getComputedStyle(e).visibility==="hidden"||e.getAttribute("data-an")==="1")).length};
});
console.log("svg:",JSON.stringify(r.svg),"overflow:",r.overflow);
console.log("nhãn HIỆN:",r.soNhanHien,"· nhãn THÒ RA KHỎI KHUNG SVG:",r.thoRa.length);
for(const o of r.thoRa) console.log("   \""+o.chu+"\" hộp="+JSON.stringify(o.hop)+" thò dọc "+o.thoRaDoc+"px ("+o.pcDoc+"% chiều cao) · thò ngang "+o.thoRaNgang+"px");
await p.screenshot({path:".qa-tapdoan/zz-nhan2-anh/sau/admin-2d-CAT-dinh.png", clip:{x:560,y:190,width:420,height:90}});
await t.close();
