#!/bin/sh
# ĐỢT 54 — ca THIẾU DỮ KIỆN SỐNG: may 14 có nhịp tim now() + operationStatus = NULL (rồi ''), 6 bề mặt.
#   KHÔNG được suy ra "running". Khôi phục bằng trap (giá trị cũ = 'stopped', đã đo ở opnull xem).
set -e
cd /d/SOURCES/_twin_wt
B=http://localhost:3054
TAG="$1"
CU=stopped
HB=""
don() {
  node .qa-dot54/opnull.mjs tra 14 "$CU"
  [ -n "$HB" ] && node .qa-dot37/db.mjs xoa-hb "$HB"
  node .qa-dot37/db.mjs dem
}
trap don EXIT INT TERM
echo "=== [$TAG] gia tri cu ==="; node .qa-dot54/opnull.mjs xem 14
node .qa-dot37/db.mjs chen-hb 14 > ".qa-dot54/td-$TAG-hb.json"; cat ".qa-dot54/td-$TAG-hb.json"; echo
HB=$(node -e "const j=JSON.parse(require('fs').readFileSync('.qa-dot54/td-$TAG-hb.json','utf8'));console.log(j.hang?.id ?? '')")
for MODE in rong; do
  echo "=== [$TAG] operationStatus = $MODE ==="
  node .qa-dot54/opnull.mjs dat 14 "$MODE"
  node .qa-dot54/hopdong54.mjs --base=$B --may=14 --out=".qa-dot54/td-$TAG-$MODE" --giay=8
done
