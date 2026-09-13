#!/bin/sh
# ĐỢT 59 — chạy thước ĐÓNG BĂNG .qa-dot44/do32.mjs (KHÔNG sửa một dòng) trên cổng 3059, để đối
# chiếu từng ô với thước mới do59. Hàng TẠM có trap (G111). sh .qa-dot59/do-D1-32.sh <nhan>
cd /d/SOURCES/_twin_wt || exit 1
N="$1"; B=http://localhost:3059; T=../.qa-dot59; L='✓|✗|dang nhap|LOI|ĐẠT|TRƯỢT'
don() { echo "--- [trap D-1/32] don hang tam $(date -Iseconds) ---"; node .qa-dot37/db.mjs andon-tam xoa | tr -d '\n'; echo; node .qa-dot32/user-tam.mjs xoa; rm -f .qa-dot32/state-e2e_dot32_khongquyen.json; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
echo "=== [D-1/32 $N] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
for VP in 1600x900 1280x720; do
  echo "--- A @ $VP lo 1 ---"; node .qa-dot44/do32.mjs --role=A --vp=$VP --cases=a1,a1b,a2,a3,a3b,a4,a4b --tag=$T/d1$N-$VP --base=$B 2>&1 | grep -E "$L"
  echo "--- A @ $VP lo 2 ---"; node .qa-dot44/do32.mjs --role=A --vp=$VP --cases=a5,a6,a6b,a7,a8,a9,a10 --tag=$T/d1$N-$VP --base=$B 2>&1 | grep -E "$L"
  echo "--- B operator1 @ $VP ---"; node .qa-dot44/do32.mjs --role=B --vp=$VP --cases=b1 --tag=$T/d1$N-$VP --base=$B 2>&1 | grep -E "$L"
done
echo "--- C user tam 0 quyen ---"; node .qa-dot32/user-tam.mjs tao
for VP in 1600x900 1280x720; do node .qa-dot44/do32.mjs --role=C --vp=$VP --cases=c1 --tag=$T/d1$N-$VP --base=$B 2>&1 | grep -E "$L"; done
node .qa-dot32/user-tam.mjs xoa; rm -f .qa-dot32/state-e2e_dot32_khongquyen.json
echo "--- andon raised TAM may 14 ---"; node .qa-dot37/db.mjs andon-tam tao 14 | tr -d '\n'; echo
node .qa-dot44/do32.mjs --role=A --vp=1600x900 --cases=a2,a3,a4 --tag=$T/d1$N-raised-1600x900 --base=$B > .qa-dot59/d1$N-raised-node.log 2>&1; echo "node exit=$?"
node .qa-dot37/db.mjs andon-tam xoa | tr -d '\n'; echo
echo "=== [D-1/32 $N] xong $(date -Iseconds) ==="
