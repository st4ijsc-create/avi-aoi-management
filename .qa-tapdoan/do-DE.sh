#!/bin/sh
# QA lần 11 · LÔ D+E — chạy CÁC CA CÓ GHI THẬT, có `trap EXIT INT TERM` (G111).
#
# Hàng tạm của lô này (tiền tố RIÊNG `QATD-DE-`):
#   · andon_events            title  like 'QATD-DE-%'   (D3)
#   · maintenance_work_orders title  like 'QATD-DE-%'   (D2)
#   · twin_vat_the            ten    like 'QATD-DE-%'   (E5)
#   · audit_logs              entityName like 'QATD-DE-%' (vết của D2/D3)
# Cả bốn xoá được bằng MỘT lệnh: `sh .qa-tapdoan/do-DE.sh don`.
#
# Dùng:  sh .qa-tapdoan/do-DE.sh <D2|D3|E5|don>
set -u
cd /d/SOURCES/avi-aoi-management || exit 1
B=http://localhost:3064

don() {
  echo "--- [trap do-DE] don hang tam $(date -Iseconds) ---"
  node .qa-tapdoan/db-DE.mjs andon-tam xoa
  node .qa-tapdoan/db-DE.mjs vung-xoa-tam
  # phiếu bảo trì: xoá theo TIÊU ĐỀ tiền tố (một lệnh, không cần nhớ id)
  node -e "
import('postgres').then(async (m)=>{const fs=require('fs');
const url=(fs.readFileSync('.env','utf8').match(/^DATABASE_URL=(.*)\$/m)||[])[1].trim();
const sql=m.default(url,{max:1});
const truoc=(await sql\`select count(*)::int n from maintenance_work_orders\`)[0].n;
const hang=await sql\`select id, \"workOrderNumber\", title from maintenance_work_orders where title like 'QATD-DE-%'\`;
const xoa=(await sql\`delete from maintenance_work_orders where title like 'QATD-DE-%'\`).count;
const sau=(await sql\`select count(*)::int n from maintenance_work_orders\`)[0].n;
console.log(JSON.stringify({bang:'maintenance_work_orders',truoc,hang,daXoa:xoa,sau}));
await sql.end();});"
  node .qa-tapdoan/db-DE.mjs audit-xoa-tam
  node .qa-tapdoan/db-DE.mjs dem
}
trap don EXIT INT TERM

CA="${1:-}"
echo "=== [do-DE $CA] bat dau $(date -Iseconds) ==="
node .qa-tapdoan/db-DE.mjs dem

case "$CA" in
  D2)
    node .qa-tapdoan/do-DE.mjs D2 --base=$B
    node .qa-tapdoan/db-DE.mjs wo-liet 4197
    node .qa-tapdoan/db-DE.mjs wo-liet 4568
    ;;
  D3)
    # ── ABLATION N-5: ba mốc trước · có · sau ──────────────────────────────
    echo "--- moc TRUOC (0 hang andon cho may 4977) ---"
    node .qa-tapdoan/do-DE.mjs D3 --moc=truoc --base=$B
    echo "--- chen hang andon raised TAM ---"
    node .qa-tapdoan/db-DE.mjs andon-tam tao 4977
    echo "--- moc CO (badge phai noi; bam ack) ---"
    node .qa-tapdoan/do-DE.mjs D3 --moc=co --base=$B
    node .qa-tapdoan/db-DE.mjs andon-tam dem
    echo "--- xoa hang tam ---"
    node .qa-tapdoan/db-DE.mjs andon-tam xoa
    echo "--- moc SAU (badge phai mat) ---"
    node .qa-tapdoan/do-DE.mjs D3 --moc=sau --base=$B
    ;;
  E5)
    node .qa-tapdoan/db-DE.mjs vung-liet 81
    node .qa-tapdoan/do-DE.mjs E5 --base=$B
    node .qa-tapdoan/db-DE.mjs vung-liet 81
    ;;
  don) echo "chi don" ;;
  *) echo "ca? D2 | D3 | E5 | don"; exit 2 ;;
esac
echo "=== [do-DE $CA] xong $(date -Iseconds) ==="
