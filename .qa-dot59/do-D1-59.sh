#!/bin/sh
# ĐỢT 59 · MỤC B — chạy THƯỚC MỚI do59 (5 lô) trên cổng 3059, TUẦN TỰ.
# Hàng TẠM (user 0 quyền + andon raised) có `trap` (G111). sh .qa-dot59/do-D1-59.sh <nhan>
cd /d/SOURCES/_twin_wt || exit 1
N="$1"; B=http://localhost:3059; O=".qa-dot59/f$N"
don() { echo "--- [trap do59] don hang tam $(date -Iseconds) ---"; node .qa-dot37/db.mjs andon-tam xoa | tr -d '\n'; echo; node .qa-dot32/user-tam.mjs xoa; rm -f "$O/state-e2e_dot32_khongquyen.json"; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
echo "=== [do59 $N] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
node .qa-dot59/do59.mjs thu --lo=A1600 --base=$B --out=$O
node .qa-dot59/do59.mjs thu --lo=A1280 --base=$B --out=$O
node .qa-dot59/do59.mjs thu --lo=B     --base=$B --out=$O
echo "--- C: user tam 0 quyen (tao -> do -> xoa) ---"; node .qa-dot32/user-tam.mjs tao
node .qa-dot59/do59.mjs thu --lo=C     --base=$B --out=$O
node .qa-dot32/user-tam.mjs xoa; rm -f "$O/state-e2e_dot32_khongquyen.json"
echo "--- R: andon raised TAM may 14 ---"; node .qa-dot37/db.mjs andon-tam tao 14 | tr -d '\n'; echo
node .qa-dot59/do59.mjs thu --lo=R     --base=$B --out=$O
node .qa-dot37/db.mjs andon-tam xoa | tr -d '\n'; echo
echo "=== [do59 $N] thu xong $(date -Iseconds) ==="
node .qa-dot59/do59.mjs xu --out=$O
