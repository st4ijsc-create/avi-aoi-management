#!/bin/sh
cd /d/SOURCES/_twin_wt || exit 1
Q=.qa-dot49; B=http://localhost:3049
log(){ echo "[$(date +%T)] $*" >> $Q/hoi-quy.log; }
sh $Q/do-D4-api.sh > $Q/run-D4-api.log 2>&1; log "D-4 xong"
{ echo "##### F1 chan 1600 #####"; timeout 500 node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=../$Q/f1 --mang=chan --base=$B 2>&1 | cut -c1-330; echo "##### F1 chan 1280 #####"; timeout 400 node .qa-dot44/f1-fonts.mjs --vp=1280x720 --tag=../$Q/f1 --mang=chan --base=$B 2>&1 | cut -c1-330; } > $Q/run-F1.log 2>&1; log "F1 xong"
sh $Q/do-D2.sh > $Q/run-D2-chan.log 2>&1; log "D-2 xong"
sh $Q/do-D1.sh > $Q/run-D1.log 2>&1; log "D-1 xong"
echo DONE > $Q/07-hoi-quy-XONG.txt
