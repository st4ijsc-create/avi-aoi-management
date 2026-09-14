// ĐỢT 58 — tóm tắt lưới thị giác: đếm VI PHẠM theo đúng tiêu chí Đợt 56/57 (nhãn/badge ngoài canvas,
// bị che, cặp chồng, tràn) + số "lệch lớp-vs-canvas" (lop-nhan/lop-canh-bao) khác (0,0,0,0).
import { readdirSync, readFileSync } from "node:fs";
const dir = process.argv[2];
let nhan = 0, badge = 0, vp = 0, tt = 0, lechXau = 0, lechDo = 0;
const chiTiet = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const k = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  tt++;
  nhan += (k.nhan ?? []).length; badge += (k.badge ?? []).length;
  const v = [];
  for (const n of k.nhan ?? []) { if (!n.trongCanvas) v.push(`nhãn ngoài canvas: ${n.chu}`); if (n.biChe?.length) v.push(`nhãn bị che: ${n.chu} ← ${n.biChe.join(",")}`); }
  for (const b of k.badge ?? []) { if (!b.trongCanvas) v.push(`badge ngoài canvas`); if (b.biChe?.length) v.push(`badge bị che ← ${b.biChe.join(",")}`); }
  if (k.capChongNhan) v.push(`cặp nhãn chồng ${k.capChongNhan}`);
  if (k.capChongBadge) v.push(`cặp badge chồng ${k.capChongBadge}`);
  if (k.capChongNhanBadge) v.push(`nhãn×badge ${k.capChongNhanBadge}`);
  if (k.tran && (k.tran.docW > k.tran.innerW || k.tran.docH > k.tran.innerH)) v.push(`tràn ${k.tran.docW}/${k.tran.innerW} ${k.tran.docH}/${k.tran.innerH}`);
  if (k.lopLech) { for (const key of Object.keys(k.lopLech)) { const L = k.lopLech[key]; lechDo++; if (L && Array.isArray(L) ? L.some((x) => x !== 0) : (L && (L.x || L.y || L.w || L.h))) { lechXau++; v.push(`lệch lớp ${key}=${JSON.stringify(L)}`); } } }
  vp += v.length;
  if (v.length) chiTiet.push(`${f}: ${v.join(" | ")}`);
}
console.log(`${dir}: trạng thái ${tt} · nhãn ${nhan} · badge ${badge} · VI PHẠM ${vp}${lechDo ? ` · lệch lớp đo ${lechDo}, xấu ${lechXau}` : ""}`);
for (const c of chiTiet.slice(0, 12)) console.log("   ✗ " + c);
