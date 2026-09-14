#!/bin/sh
# ĐỢT 48 — CHUỖI HỒI QUY trên 3048, TUẦN TỰ (G97): D-1 48 ca (do32) → tomtat-D1 (Đợt 44 → 45) → D-2 chan (K/E/I + P) → F1 fonts @1600 chan + @1280 chan.
# Ghi .qa-dot48/hoi-quy-XONG.txt khi xong; từng bước *-XONG.txt.
cd /d/SOURCES/_twin_wt || exit 1
Q=.qa-dot48; B=http://localhost:3048
log() { echo "$(date -Iseconds) $*"; }
echo "##### [hoi quy 48] bat dau $(date -Iseconds) pid=$$ #####"; node .qa-dot37/db.mjs dem; echo
sh $Q/do-D1.sh > $Q/run-D1.log 2>&1; log "D-1 xong ✓=$(grep -c '✓' $Q/run-D1.log) ✗=$(grep -c '✗' $Q/run-D1.log) LOI=$(grep -c 'LOI' $Q/run-D1.log)"; date -Iseconds > $Q/D1-XONG.txt
node $Q/tomtat-D1.mjs > $Q/tomtat-D1.txt 2>&1; tail -2 $Q/tomtat-D1.txt | cut -c1-400
MANG=chan sh $Q/do-D2.sh > $Q/run-D2-chan.log 2>&1; log "D-2 chan xong ✓=$(grep -c '✓' $Q/run-D2-chan.log) ✗=$(grep -c '✗' $Q/run-D2-chan.log) TRUOT=$(grep -c 'TRƯỢT' $Q/run-D2-chan.log) DAT=$(grep -c 'ĐẠT' $Q/run-D2-chan.log)"; date -Iseconds > $Q/D2-chan-XONG.txt
{ echo "##### F1 mang=chan vp=1600x900 $(date +%T) #####"; timeout 500 node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=../$Q/f1 --mang=chan --base=$B 2>&1 | cut -c1-330; echo "##### F1 mang=chan vp=1280x720 $(date +%T) #####"; timeout 400 node .qa-dot44/f1-fonts.mjs --vp=1280x720 --tag=../$Q/f1 --mang=chan --base=$B 2>&1 | cut -c1-330; } > $Q/run-F1.log 2>&1; log "F1 xong ✓=$(grep -c '✓' $Q/run-F1.log) ✗=$(grep -c '✗' $Q/run-F1.log)"; date -Iseconds > $Q/F1-XONG.txt
{ echo "##### F1 mang=thuong vp=1600x900 $(date +%T) #####"; timeout 500 node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=../$Q/f1-thuong --mang=thuong --base=$B 2>&1 | cut -c1-330; } > $Q/run-F1-thuong.log 2>&1; log "F1 thuong xong ✓=$(grep -c '✓' $Q/run-F1-thuong.log) ✗=$(grep -c '✗' $Q/run-F1-thuong.log)"; date -Iseconds > $Q/F1-thuong-XONG.txt
node .qa-dot37/db.mjs dem; echo
echo "##### [hoi quy 48] xong $(date -Iseconds) #####"; date -Iseconds > $Q/hoi-quy-XONG.txt
