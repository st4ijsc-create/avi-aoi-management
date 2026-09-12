#!/bin/sh
# ĐỢT 52 · D-4 — MA TRẬN API × VAI × NHÀ MÁY (tRPC + socket + HTTP v1) trên 3054. Hàng tạm có trap (G111).
export API_VAI_OUT=.qa-dot54/api-vai      # G129/G130 — đường ra từ ENV, KHÔNG ghi vào .qa-dot49/50
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3054
don() { echo "--- [trap D-4] don hang tam $(date -Iseconds) ---"; node .qa-dot32/user-tam.mjs xoa; node .qa-dot36/db.mjs user-tam xoa | tr -d '\n'; echo; node .qa-dot41/user-tam.mjs xoa mon; echo; node .qa-dot41/user-tam.mjs xoa adm; echo; node .qa-dot41/apikey-tam.mjs xoa; echo; node .qa-dot37/db.mjs dem; echo; }
trap don EXIT INT TERM
echo "=== [D-4] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem; echo; node .qa-dot41/apikey-tam.mjs dem; echo
echo "--- tao user tam C, D, M, ADM ---"; node .qa-dot32/user-tam.mjs tao; node .qa-dot36/db.mjs user-tam tao | tr -d '\n'; echo; node .qa-dot41/user-tam.mjs tao mon; echo; node .qa-dot41/user-tam.mjs tao adm; echo
for V in A B C D M ADM; do echo "--- tRPC vai $V ---"; node .qa-dot54/api-vai.mjs --vai=$V --base=$B; done
for V in A B C D M ADM; do echo "--- socket vai $V ---"; node .qa-dot54/socket-vai.mjs --vai=$V --base=$B --giay=12; done
echo "--- HTTP v1 (api key tam SIM-FAC) ---"; node .qa-dot41/apikey-tam.mjs tao > .qa-dot54/api-vai/apikey-tao.json; sed 's/"key":"[^"]*"/"key":"(an)"/' .qa-dot54/api-vai/apikey-tao.json; echo
KEY=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".qa-dot54/api-vai/apikey-tao.json","utf8")).key)')
node .qa-dot54/http-v1.mjs --key="$KEY" --base=$B
node .qa-dot41/apikey-tam.mjs xoa | tee .qa-dot54/api-vai/apikey-xoa.json; echo
sed -i 's/"key":"[^"]*"/"key":"(da xoa khoi tep tho)"/' .qa-dot54/api-vai/apikey-tao.json
echo "=== [D-4] xong $(date -Iseconds) ==="
