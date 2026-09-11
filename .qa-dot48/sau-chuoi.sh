#!/bin/sh
# ĐỢT 48 — SAU CHUỖI (tuần tự, G97): (1) đo lại F1 chan @1280 x2 (2 ✗ sát ngưỡng 2 500 ms ở lượt 1 — treo/chậm là DỮ LIỆU, đo lại); (2) census K7-NC nhãn phủ khối + bấm thử.
cd /d/SOURCES/_twin_wt || exit 1
Q=.qa-dot48; B=http://localhost:3048
log() { echo "$(date -Iseconds) $*"; }
while [ ! -f $Q/chuoi-XONG.txt ]; do sleep 10; done
log "##### sau-chuoi bat dau #####"
for i in 1 2; do echo "##### F1 mang=chan vp=1280x720 lai $i $(date +%T) #####"; timeout 400 node .qa-dot44/f1-fonts.mjs --vp=1280x720 --tag=../$Q/f1-lai-$i --mang=chan --base=$B 2>&1 | cut -c1-330; done > $Q/run-F1-lai.log 2>&1
log "F1 lai xong ✓=$(grep -c '✓' $Q/run-F1-lai.log) ✗=$(grep -c '✗' $Q/run-F1-lai.log)"; date -Iseconds > $Q/14-F1-lai-XONG.txt
node $Q/k7-nhan-che.mjs --base=$B > $Q/run-k7-nhan-che.log 2>&1; log "K7-NC xong: $(grep -c 'BẤM' $Q/run-k7-nhan-che.log) lần bấm thử"; date -Iseconds > $Q/15-k7-nc-XONG.txt
log "##### sau-chuoi xong #####"; date -Iseconds > $Q/sau-chuoi-XONG.txt
