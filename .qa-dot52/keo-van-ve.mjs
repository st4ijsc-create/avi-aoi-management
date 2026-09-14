// ĐỢT 52 — ĐỐI CHỨNG DƯƠNG cho "0 khung khi đứng yên": sau 40 s im, KÉO phải sinh khung.
// Nếu kéo cũng 0 khung thì phép đo "0 khung" chỉ chứng minh canvas CHẾT, không chứng minh frameloop=demand đúng.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith(`--${k}=`));return m?m.slice(k.length+3):d;};
const BASE=arg("base","http://localhost:3052"); const OUT=".qa-dot52"; mkdirSync(OUT,{recursive:true});
const MAN={twin:["/twin",'[data-testid="man-twin-van-hanh"] canvas'],line:["/twin/line/2",'[data-testid="man-twin-line"] canvas'],may:["/twin/may/14",'[data-testid="man-twin-may"] canvas']};
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1600,height:900}});
await ctx.addCookies(JSON.parse(readFileSync(".qa-dot52/state-e2e_tai_loE.json","utf8")));
const kq=[];
for(const [ten,[duong,sel]] of Object.entries(MAN)){
  const p=await ctx.newPage();
  await p.goto(`${BASE}${duong}?do=1`,{waitUntil:"domcontentloaded"});
  await p.waitForSelector(sel,{timeout:90_000});
  await p.waitForTimeout(6_000);
  // ★ SỬA THIẾT BỊ ĐO: `calls` là DRAW CALL CỦA MỘT KHUNG (hằng số khi cảnh tĩnh), KHÔNG phải
  //   bộ đếm khung. `BomThongKe` (KhungCanh.tsx:257) GÁN MỘT OBJECT MỚI mỗi khung ⇒ đếm khung =
  //   đếm lần ĐỔI ĐỊNH DANH. Bản đầu của tôi đọc `calls` ⇒ đối chứng dương "kéo phải vẽ" TRƯỢT,
  //   và đó chính là cái cứu phép đo: 0 khung khi đứng yên mà kéo cũng 0 thì đang đo canvas CHẾT.
  const demKhung=(ms)=>p.evaluate((t)=>new Promise((r)=>{let n=0;let a=window.__thongKeVe;const id=setInterval(()=>{const b=window.__thongKeVe;if(b!==a){n++;a=b;}},10);setTimeout(()=>{clearInterval(id);r(n);},t);}),ms);
  const c0=0;
  const c1=await demKhung(8_000);                      // đứng yên 8 s
  const box=await p.locator(sel).boundingBox();
  const X=box.x+box.width/2, Y=box.y+box.height/2;
  const dem2=demKhung(4_000);
  await p.mouse.move(X,Y,{steps:3}); await p.mouse.down();
  for(let i=1;i<=8;i++){ await p.mouse.move(X+i*12,Y+i*2,{steps:1}); await p.waitForTimeout(16); }
  await p.mouse.up();
  const c2=await dem2;
  const r={man:ten,duong,khungIm8s:c1,khungKhiKeo4s:c2};
  kq.push(r);
  console.log(`   ${ten}: ĐỨNG YÊN 8 s → ${c1} khung · KÉO trong 4 s → ${c2} khung ⇒ ${c1===0?"đứng yên 0 khung ĐẠT":"CÓ VẼ KHI ĐỨNG YÊN (SAI)"} · ${c2>0?"kéo CÓ vẽ (đối chứng dương ĐẠT)":"kéo KHÔNG vẽ (PHÉP ĐO HỎNG)"}`);
  await p.close();
}
writeFileSync(`${OUT}/keo-van-ve.json`,JSON.stringify(kq,null,2));
await b.close();
