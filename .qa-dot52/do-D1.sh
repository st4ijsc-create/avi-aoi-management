#!/bin/sh
# ĐỢT 52 · D-1 — 48 ca Đợt 32 NGUYÊN TRẠNG (harness .qa-dot44/do32.mjs) trên 3052, hai vp, vai A/B/C + andon raised TẠM.
# TUẦN TỰ (G97). Đầu ra .qa-dot52/nen-*/ (G65/G130). Hàng tạm có trap (G111).
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3052
T=../.qa-dot52
L='✓|✗|dang nhap|LOI|ĐẠT|TRƯỢT'
don() { echo "--- [trap D-1] don hang tam $(date -Iseconds) ---"; node .qa-dot37/db.mjs andon-tam xoa | tr -d '\n'; echo; node .qa-dot32/user-tam.mjs xoa; rm -f .qa-dot32/state-e2e_dot32_khongquyen.json; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
echo "=== [D-1] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
for VP in 1600x900 1280x720; do
  echo "--- A @ $VP: lo 1 ---"; node .qa-dot44/do32.mjs --role=A --vp=$VP --cases=a1,a1b,a2,a3,a3b,a4,a4b --tag=$T/nen-$VP --base=$B 2>&1 | grep -E "$L"
  echo "--- A @ $VP: lo 2 ---"; node .qa-dot44/do32.mjs --role=A --vp=$VP --cases=a5,a6,a6b,a7,a8,a9,a10 --tag=$T/nen-$VP --base=$B 2>&1 | grep -E "$L"
  echo "--- B operator1 @ $VP ---"; node .qa-dot44/do32.mjs --role=B --vp=$VP --cases=b1 --tag=$T/nen-$VP --base=$B 2>&1 | grep -E "$L"
done
echo "--- C user tam 0 quyen (tao -> 2 vp -> xoa) ---"; node .qa-dot32/user-tam.mjs tao
for VP in 1600x900 1280x720; do node .qa-dot44/do32.mjs --role=C --vp=$VP --cases=c1 --tag=$T/nen-$VP --base=$B 2>&1 | grep -E "$L"; done
node .qa-dot32/user-tam.mjs xoa; rm -f .qa-dot32/state-e2e_dot32_khongquyen.json
echo "--- andon raised TAM may 14 -> a2,a3,a4 @1600 ---"; node .qa-dot37/db.mjs andon-tam tao 14 | tee .qa-dot52/raised-tao.json | tr -d '\n'; echo
node .qa-dot44/do32.mjs --role=A --vp=1600x900 --cases=a2,a3,a4 --tag=$T/raised-1600x900 --base=$B > .qa-dot52/raised-node.log 2>&1; echo "node exit=$?"; grep -E "$L" .qa-dot52/raised-node.log
node .qa-dot37/db.mjs andon-tam xoa | tee .qa-dot52/raised-xoa.json | tr -d '\n'; echo
echo "=== [D-1] xong $(date -Iseconds) ==="
