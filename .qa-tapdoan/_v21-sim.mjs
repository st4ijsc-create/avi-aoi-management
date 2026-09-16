/** V-21 (1) — MÔ PHỎNG TẤT ĐỊNH, KHÔNG GHI GÌ VÀO CSDL.
 *
 *  Mục đích: chứng minh bản vá `tiLeNg` mà KHÔNG phải sinh lại dữ liệu (agent khác
 *  đang đo sống trên cổng 3064).
 *
 *  Ba bước, bước 1 là kiểm THIẾT BỊ ĐO:
 *   1. Chạy lại công thức CŨ trên đúng 1.108 mã máy đang có ⇒ số NG mỗi máy phải
 *      TRÙNG TỪNG MÁY với product_inspections trong CSDL. Không trùng ⇒ mô phỏng sai,
 *      dừng, mọi bảng phía sau vô giá trị.
 *   2. In bảng 4 hạng TRƯỚC (công thức cũ).
 *   3. In bảng 4 hạng SAU, dùng `tiLeNgTheoSucKhoe` NHẬP TỪ chính bộ sinh (đo mã thật,
 *      không đo bản sao).
 *
 *  Thước = "máy có >= 1 NG": đã đo được (vòng 5) rằng đó ĐÚNG là điều kiện kích hoạt
 *  của bộ bơm cảnh báo phía máy chủ — 575 máy có >=1 NG, và tại mốc T3 đúng 575 máy
 *  có cảnh báo mở; 51/51 máy đang có cảnh báo đều có >=1 NG.
 */
import postgres from "postgres"; import fs from "node:fs";
import { taoNgauNhien, bamChuoi, tiLeNgTheoSucKhoe } from "./sinh-tap-doan.mjs";

const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});

const may = await sql`select m.code ma,
    (select h."healthScore" from machine_health_history h
      where h."machineId"=m.id and h."calculationMethod"='WEIGHTED' limit 1)::int health,
    (select count(*) filter (where i."overallResult"='NG') from product_inspections i where i."machineId"=m.id)::int ng_db,
    (select count(*) from product_inspections i where i."machineId"=m.id)::int ins_db
  from machines m where m.code like 'QATD-%' order by m.code`;
await sql.end();

/** Bản CŨ, nguyên văn dòng đã thay: `const tiLeNg = rnd() * 0.25;` */
const cuTiLeNg = (jitter) => jitter * 0.25;

function chay(tinhTiLe) {
  return may.map((m) => {
    const rnd = taoNgauNhien(bamChuoi(`kt:${m.ma}`));
    const tiLeNg = tinhTiLe(rnd(), m.health);
    let ng = 0;
    for (let k = 0; k < 6; k++) if (rnd() < tiLeNg) ng++;
    return { ma: m.ma, health: m.health, ng, tiLeNg };
  });
}

const HANG = (h) => (h < 55 ? "1 xau(<55)" : h < 70 ? "2 (55-69)" : h < 85 ? "3 (70-84)" : "4 tot(>=85)");
function bang(rows, ten) {
  const g = {};
  for (const r of rows) { const k = HANG(r.health); (g[k] ??= { soMay: 0, coNG: 0, tongNG: 0, tongHs: 0 });
    g[k].soMay++; if (r.ng > 0) g[k].coNG++; g[k].tongNG += r.ng; g[k].tongHs += r.health; }
  const ks = Object.keys(g).sort();
  console.log(`\n  ${ten}`);
  console.log("  hang            soMay  coNG  tiLe%   NG/6ins  health_tb");
  const tiLe = {};
  for (const k of ks) { const v = g[k]; tiLe[k] = 100 * v.coNG / v.soMay;
    console.log(`  ${k.padEnd(14)} ${String(v.soMay).padStart(5)} ${String(v.coNG).padStart(5)}  ${tiLe[k].toFixed(1).padStart(5)}   ${(v.tongNG / (v.soMay * 6) * 100).toFixed(1).padStart(6)}%   ${(v.tongHs / v.soMay).toFixed(1).padStart(6)}`); }
  const xau = tiLe[ks[0]], tot = tiLe[ks[ks.length - 1]];
  const donDieu = ks.every((k, i) => i === 0 || tiLe[ks[i - 1]] >= tiLe[k]);
  console.log(`  => don dieu giam: ${donDieu ? "CO" : "KHONG"} · xau/tot = ${(xau / tot).toFixed(2)}x (can >= 2.00x)`
    + ` · tong NG ${rows.reduce((a, r) => a + r.ng, 0)}/${rows.length * 6}`);
  return { donDieu, tiSo: xau / tot, tiLe, tongNG: rows.reduce((a, r) => a + r.ng, 0) };
}

// ── BƯỚC 1 — KIỂM THIẾT BỊ ĐO ────────────────────────────────────────────────
const cu = chay((j) => cuTiLeNg(j));
const lech = cu.filter((r, i) => r.ng !== may[i].ng_db);
const insSai = may.filter((m) => m.ins_db !== 6);
console.log(`  BUOC 1 — kiem thiet bi do: ${may.length} may · lech NG voi CSDL = ${lech.length}`
  + ` · may khong co du 6 ins = ${insSai.length}`);
if (lech.length) { console.log("   VI DU LECH: " + JSON.stringify(lech.slice(0, 5))); }
if (lech.length || insSai.length) { console.log("  => MO PHONG SAI. Dung, khong in bang."); process.exit(1); }
console.log("  => MO PHONG TRUNG 1108/1108 may. Cac bang duoi day dang tin.");

// ── BƯỚC 2/3 ────────────────────────────────────────────────────────────────
const bCu = bang(cu, "TRUOC (tiLeNg = rnd()*0.25 — doc lap voi health)");
const moi = chay((j, h) => tiLeNgTheoSucKhoe(h, j));
const bMoi = bang(moi, "SAU  (tiLeNg = tiLeNgTheoSucKhoe(health, jitter))");
const dat = bMoi.donDieu && bMoi.tiSo >= 2;
console.log(`\n  TIEU CHI (don dieu giam + xau/tot >= 2x): ${dat ? "DAT" : "VO"}`);
console.log(`  Hinh dang giu nguyen: tong NG ${bCu.tongNG} -> ${bMoi.tongNG}`
  + ` (lech ${((bMoi.tongNG / bCu.tongNG - 1) * 100).toFixed(1)}%), so dong ins KHONG doi (6/may).`);
process.exit(dat ? 0 : 1);
