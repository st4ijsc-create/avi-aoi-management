#!/bin/sh
# ĐỢT 53 — F1 XEN KẼ hai build (z = TRƯỚC vá / c = SAU vá) để TRỪ KHỬ trôi tải máy.
#   Moi lo: doi server, cho 8s, chay 2 luot F1. sh .qa-dot54/do-F1-xen.sh <so-lo>
cd /d/SOURCES/_twin_wt || exit 1
N=${1:-4}
lo=1
while [ "$lo" -le "$N" ]; do
  for TAG in 54z 54a; do
    sh .qa-dot54/server.sh start $TAG > /dev/null 2>&1
    i=1
    while [ "$i" -le 2 ]; do
      echo "--- lo $lo · $TAG · luot $i $(date -Iseconds) · chrome=$(tasklist //FI 'IMAGENAME eq chrome.exe' //FO CSV 2>/dev/null | wc -l) node=$(tasklist //FI 'IMAGENAME eq node.exe' //FO CSV 2>/dev/null | wc -l) ---"
      QA_OUT=".qa-dot54/fx-$TAG-$lo$i" QA_STATE=".qa-dot54/state-e2e_tai_loE.json" QA_MANG_NGOAI=".qa-dot54/mang-ngoai" \
        node .qa-dot54/f1-fonts.mjs --vp=1600x900 --tag="fx-$TAG-$lo$i" --base=http://localhost:3054 --mang=chan 2>&1 | tail -1
      i=$((i+1))
    done
  done
  lo=$((lo+1))
done
