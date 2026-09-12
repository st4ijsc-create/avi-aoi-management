#!/bin/sh
# ĐỢT 53 — "NHANH": F1 mang=chan, 1600x900, N luot x 4 man, tren 3054. Đường ra .qa-dot54/f1-54-<i>.
cd /d/SOURCES/_twin_wt || exit 1
N=${1:-7}
i=1
while [ "$i" -le "$N" ]; do
  echo "--- F1 luot $i $(date -Iseconds) · chrome=$(tasklist //FI 'IMAGENAME eq chrome.exe' //FO CSV 2>/dev/null | wc -l) node=$(tasklist //FI 'IMAGENAME eq node.exe' //FO CSV 2>/dev/null | wc -l) ---"
  QA_OUT=".qa-dot54/f1-54-$i" \
  QA_STATE=".qa-dot54/state-e2e_tai_loE.json" \
  QA_MANG_NGOAI=".qa-dot54/mang-ngoai" \
    node .qa-dot54/f1-fonts.mjs --vp=1600x900 --tag="f1-54-$i" --base=http://localhost:3054 --mang=chan 2>&1 | tail -3
  i=$((i+1))
done
