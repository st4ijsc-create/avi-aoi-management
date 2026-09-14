#!/bin/sh
# ĐỢT 53 · mục B — HỢP ĐỒNG TRẠNG THÁI 6 BỀ MẶT, có ABLATION SỐNG (G105).
#   Chèn NHỊP TIM now() cho máy 14 (hàng TẠM, `trap` xoá) ⇒ máy "đang kết nối" ⇒ bất đồng mới lộ.
#   sh .qa-dot54/do-hopdong53.sh <thumuc-goc>    (vd: truoc | sau)
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3054
GOC=".qa-dot54/hd-$1"
HB=""
don() { [ -n "$HB" ] && node .qa-dot37/db.mjs xoa-hb "$HB"; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
echo "=== [hop dong $1] DB TRUOC $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
echo "=== [hop dong $1] KHONG nhip tim (may 14 im lang 57 ngay) ==="
node .qa-dot54/hopdong54.mjs --base=$B --may=14 --out="$GOC-khong-hb"
echo "=== [hop dong $1] CHEN NHIP TIM now() may 14 (hang tam) ==="
node .qa-dot37/db.mjs chen-hb 14 > "$GOC-chen-hb.json"; cat "$GOC-chen-hb.json"; echo
HB=$(node -e "const j=JSON.parse(require('fs').readFileSync('$GOC-chen-hb.json','utf8'));console.log(j.hang?.id ?? j.id ?? '')")
echo "HB=$HB"
node .qa-dot54/hopdong54.mjs --base=$B --may=14 --out="$GOC-co-hb"
echo "=== [hop dong $1] XOA hang tam ==="
node .qa-dot37/db.mjs xoa-hb "$HB"; HB=""
node .qa-dot37/db.mjs dem
echo "=== [hop dong $1] xong $(date -Iseconds) ==="
