#!/bin/sh
# ĐỢT 48 · D-2 (MANG=chan|treo|thuong) — K1–K11 (.qa-dot44/do33.mjs) + E1–E9 (.qa-dot44/do35.mjs) + I1–I6 (.qa-dot44/do36.mjs) trên 3043, tuần tự (G97).
# Đầu ra .qa-dot48/$M/K-*, E, I, P (G65). Khuôn = .qa-dot37/do-D2.sh (QA Đợt 37), chỉ đổi cổng + thư mục. Hàng tạm có trap (G111).
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3048
M="${MANG:-chan}"; T=../.qa-dot48/$M
L='✓|✗|dang nhap|LOI|ĐẠT|TRƯỢT'
don() { node .qa-dot37/db.mjs andon-tam xoa > /dev/null 2>&1; [ -n "$MSL" ] && node .qa-dot37/db.mjs xoa-msl "$MSL" > /dev/null 2>&1; node .qa-dot36/db.mjs user-tam xoa > /dev/null 2>&1; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
MSL=""
echo "=== [D-2] bat dau $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
echo "--- K @1600: k1,k2,k3,k5,k6,k7,k9,k11 ---"; node .qa-dot44/do33.mjs --role=A --vp=1600x900 --cases=k1,k2,k3,k5,k6,k7,k9,k11 --tag=$T/K-1600x900 --base=$B --mang=$M 2>&1 | grep -E "$L"
echo "--- K @1280: k1,k2,k3,k6 ---"; node .qa-dot44/do33.mjs --role=A --vp=1280x720 --cases=k1,k2,k3,k6 --tag=$T/K-1280x720 --base=$B --mang=$M 2>&1 | grep -E "$L"
for VP in 1600x900 1280x720; do
  echo "--- E @ $VP: A e1,e2,e3,e5 · B e8 ---"
  node .qa-dot44/do35.mjs --role=A --vp=$VP --cases=e1,e2,e3,e5 --tag=$T/E --base=$B --mang=$M 2>&1 | grep -E "$L"
  node .qa-dot44/do35.mjs --role=B --vp=$VP --cases=e8 --tag=$T/E --base=$B --mang=$M 2>&1 | grep -E "$L"
done
echo "--- E6: andon raised TAM may 14 (tao -> e6 @1600 + @1280 -> xoa) ---"
node .qa-dot37/db.mjs andon-tam tao 14
node .qa-dot44/do35.mjs --role=A --vp=1600x900 --cases=e6 --tag=$T/E --base=$B --mang=$M 2>&1 | grep -E "$L"
node .qa-dot44/do35.mjs --role=A --vp=1280x720 --cases=e6 --tag=$T/E --base=$B --mang=$M 2>&1 | grep -E "$L"
node .qa-dot37/db.mjs andon-tam xoa
echo "--- E9: msl now() TAM may 14 (chen -> e9 -> xoa) ---"
mkdir -p .qa-dot48/$M/E
node .qa-dot37/db.mjs chen-msl 14 > .qa-dot48/$M/E/e9-chen-msl.json; cat .qa-dot48/$M/E/e9-chen-msl.json; echo
MSL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).hang.id)' .qa-dot48/$M/E/e9-chen-msl.json)
node .qa-dot37/db.mjs msl-ts "$MSL" > .qa-dot48/$M/E/e9-msl-ts.json; cat .qa-dot48/$M/E/e9-msl-ts.json; echo
node .qa-dot35/db.mjs robot-ts > .qa-dot48/$M/E/e9-robot-db.json
node .qa-dot44/do35.mjs --role=A --vp=1600x900 --cases=e9 --tag=$T/E --base=$B --mang=$M 2>&1 | grep -E "$L"
node .qa-dot37/db.mjs xoa-msl "$MSL" > .qa-dot48/$M/E/e9-xoa-msl.json; cat .qa-dot48/$M/E/e9-xoa-msl.json; echo; MSL=""
for LANG_ in vi en zh; do
  case $LANG_ in vi) CAS=i1,i2,i4;; en) CAS=i1,i2,i3,i4,i5,i5b;; zh) CAS=i1,i2,i4;; esac
  echo "--- I A lang=$LANG_: $CAS ---"
  node .qa-dot44/do36.mjs --role=A --lang=$LANG_ --vp=1600x900 --cases=$CAS --tag=$T/I --base=$B --mang=$M 2>&1 | grep -E "$L"
done
echo "--- I6: user TAM chi analytics_oee (tao -> role C en -> xoa) + doi chung A ---"
node .qa-dot36/db.mjs user-tam tao
node .qa-dot44/do36.mjs --role=C --lang=en --vp=1600x900 --cases=i6 --tag=$T/I --base=$B --mang=$M 2>&1 | grep -E "$L"
node .qa-dot36/db.mjs user-tam xoa; rm -f .qa-dot36/state-e2e_dot36_oee.json
node .qa-dot44/do36.mjs --role=A --lang=en --vp=1600x900 --cases=i6 --tag=$T/I-doichung --base=$B --mang=$M 2>&1 | grep -E "$L"
echo "=== [D-2] xong $(date -Iseconds) ==="
echo "--- P3-P7 @1600 + @1280 (.qa-dot44/do38.mjs → .qa-dot48/$M/P) ---"
for VP in 1600x900 1280x720; do node .qa-dot44/do38.mjs --cases=p3,p4,p5,p6,p7 --vp=$VP --tag=../.qa-dot48/$M/P --base=$B --mang=$M 2>&1 | grep -vE '^\s*$'; done
echo "=== [D-2+P] xong $(date -Iseconds) ==="
