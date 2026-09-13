// MÔ HÌNH B — LIỆT KÊ TOÀN PHÂN BỐ rồi ĐỐI CHIẾU TỔNG (BG-127: độc lập ở MÔ HÌNH)
// Khác A ở CHỖ NÀO: A lọc rồi đếm (WHERE không bao giờ khớp ⇒ 0 câm).
// B không lọc: kéo TOÀN BỘ hàng về client/nhóm đủ mọi nhánh, rồi ĐỐI CHIẾU với TỔNG.
// Nếu cột/bảng sai tên ⇒ NỔ, không ra 0.
import postgres from 'postgres'; import fs from 'fs';
const url = fs.readFileSync('.env','utf8').split(/\r?\n/).find(l=>/^DATABASE_URL=/.test(l)).slice('DATABASE_URL='.length).trim();
const sql = postgres(url,{max:1,idle_timeout:5});
const out={};
// B0 — bảng CÓ TỒN TẠI không (0 hàng vì rỗng, chứ không phải vì bảng biến mất)
const tt = await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('factory_zones','safety_zones','machines') order by 1`;
out.bang_ton_tai = tt.map(r=>r.table_name);
console.log('B0 bảng tồn tại:', out.bang_ton_tai.join(', '));
// B1 — KÉO TOÀN BỘ hàng (không WHERE, không count) rồi đếm ở client
for (const t of ['factory_zones','safety_zones']) {
  const rows = await sql.unsafe(`select * from "${t}"`);
  out['B_rows_'+t]=rows.length;
  console.log(`B1 liệt kê "${t}": ${rows.length} hàng kéo về`, rows.length? JSON.stringify(rows[0]).slice(0,120):'');
}
// B2 — machines: nhóm ĐỦ MỌI NHÁNH rồi đối chiếu TỔNG
const cols = await sql`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='machines' and (column_name ilike '%layout%') order by 1`;
out.machines_cot_layout = cols.map(c=>c.column_name+':'+c.data_type);
console.log('B2 cột layout* của machines:', out.machines_cot_layout.join(' | ') || '(KHÔNG CÓ CỘT NÀO)');
const all = await sql.unsafe(`select id, "layoutPositionX" as x, "layoutPositionY" as y, "layout" as l from machines`);
out.machines_tong = all.length;
const phanbo = { x_null:0, x_cogiatri:0, y_null:0, y_cogiatri:0, l_null:0, l_cogiatri:0 };
for (const r of all) {
  (r.x === null || r.x === undefined) ? phanbo.x_null++ : phanbo.x_cogiatri++;
  (r.y === null || r.y === undefined) ? phanbo.y_null++ : phanbo.y_cogiatri++;
  (r.l === null || r.l === undefined) ? phanbo.l_null++ : phanbo.l_cogiatri++;
}
out.machines_phanbo = phanbo;
console.log('B2 machines TỔNG =', all.length);
console.log('   phân bố x:', phanbo.x_null,'null +', phanbo.x_cogiatri,'có giá trị  =>', phanbo.x_null+phanbo.x_cogiatri, (phanbo.x_null+phanbo.x_cogiatri===all.length?'KHỚP TỔNG':'★ LỆCH TỔNG'));
console.log('   phân bố y:', phanbo.y_null,'null +', phanbo.y_cogiatri,'có giá trị  =>', phanbo.y_null+phanbo.y_cogiatri, (phanbo.y_null+phanbo.y_cogiatri===all.length?'KHỚP TỔNG':'★ LỆCH TỔNG'));
console.log('   phân bố layout:', phanbo.l_null,'null +', phanbo.l_cogiatri,'có giá trị =>', phanbo.l_null+phanbo.l_cogiatri, (phanbo.l_null+phanbo.l_cogiatri===all.length?'KHỚP TỔNG':'★ LỆCH TỔNG'));
// B3 — đối chứng DƯƠNG: mô hình B phải biết KÊU trên một cột CHẮC CHẮN có giá trị
const ten = all.filter(r=>r.id!==null).length;
out.doi_chung_duong_id_cogiatri = ten;
console.log('B3 đối chứng dương (cột id có giá trị):', ten, ten===all.length && all.length>0 ? 'KÊU ĐÚNG (thước không mù)' : '★ THƯỚC MÙ');
fs.writeFileSync('.qa-dot61/01-db-B.json', JSON.stringify(out,null,2));
await sql.end();
