#!/bin/sh
# ĐỢT 48 · D-4 — MA TRẬN API × VAI × NHÀ MÁY (tRPC + socket + HTTP v1). Hàng tạm: user C/D/M/ADM + api key, có trap (G111). Không trình duyệt (chạy TRƯỚC chuỗi G97).
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3048
don() { echo "--- [trap D-4 api] don hang tam $(date -Iseconds) ---"; node .qa-dot32/user-tam.mjs xoa; node .qa-dot36/db.mjs user-tam xoa | tr -d '\n'; echo; node .qa-dot41/user-tam.mjs xoa mon; echo; node .qa-dot41/user-tam.mjs xoa adm; echo; node .qa-dot41/apikey-tam.mjs xoa; echo; node .qa-dot37/db.mjs dem; echo; }
trap don EXIT INT TERM
echo "=== [D-4 api] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem; echo; node .qa-dot41/apikey-tam.mjs dem; echo
echo "--- tao user tam C, D, M, ADM ---"; node .qa-dot32/user-tam.mjs tao; node .qa-dot36/db.mjs user-tam tao | tr -d '\n'; echo; node .qa-dot41/user-tam.mjs tao mon; echo; node .qa-dot41/user-tam.mjs tao adm; echo
for V in A B C D M ADM; do echo "--- tRPC vai $V ---"; node .qa-dot48/api-vai.mjs --vai=$V --base=$B; done
for V in A B C D M ADM; do echo "--- socket vai $V ---"; node .qa-dot48/socket-vai.mjs --vai=$V --base=$B --giay=12; done
echo "--- HTTP v1 (api key tam SIM-FAC) ---"; node .qa-dot41/apikey-tam.mjs tao > .qa-dot48/api-vai/apikey-tao.json; sed 's/"key":"[^"]*"/"key":"(an)"/' .qa-dot48/api-vai/apikey-tao.json; echo
KEY=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".qa-dot48/api-vai/apikey-tao.json","utf8")).key)')
node .qa-dot48/http-v1.mjs --key="$KEY" --base=$B
node .qa-dot41/apikey-tam.mjs xoa | tee .qa-dot48/api-vai/apikey-xoa.json; echo
sed -i 's/"key":"[^"]*"/"key":"(da xoa khoi tep tho)"/' .qa-dot48/api-vai/apikey-tao.json
echo "=== [D-4 api] xong $(date -Iseconds) ==="
