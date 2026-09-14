#!/bin/sh
# ĐỢT 52 — "NHANH": F1 mang=chan, 1600x900, N luot x 4 man, tren 3052. Đường ra .qa-dot52/f1-52-<i>.
cd /d/SOURCES/_twin_wt || exit 1
N=${1:-7}
i=1
while [ "$i" -le "$N" ]; do
  echo "--- F1 luot $i $(date -Iseconds) · chrome=$(tasklist //FI 'IMAGENAME eq chrome.exe' //FO CSV 2>/dev/null | wc -l) node=$(tasklist //FI 'IMAGENAME eq node.exe' //FO CSV 2>/dev/null | wc -l) ---"
  QA_OUT=".qa-dot52/f1-52-$i" \
  QA_STATE=".qa-dot52/state-e2e_tai_loE.json" \
  QA_MANG_NGOAI=".qa-dot52/mang-ngoai" \
    node .qa-dot52/f1-fonts.mjs --vp=1600x900 --tag="f1-52-$i" --base=http://localhost:3052 --mang=chan 2>&1 | tail -3
  i=$((i+1))
done
