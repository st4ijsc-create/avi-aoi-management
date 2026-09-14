#!/bin/sh
# ĐỢT 48 — CHUỖI TRÌNH DUYỆT TUẦN TỰ (G97: một trình duyệt/một tải nặng tại một thời điểm) trên 3048 (dist-kiem = HEAD).
#   Chờ D-4 API (03) + cổng nguồn (04) xong rồi mới chạy. Từng bước ghi .qa-dot48/<n>-<bước>-XONG.txt.
cd /d/SOURCES/_twin_wt || exit 1
Q=.qa-dot48; B=http://localhost:3048
log() { echo "$(date -Iseconds) $*"; }
while [ ! -f $Q/03-D4-api-XONG.txt ] || [ ! -f $Q/04-cong-nguon-XONG.txt ]; do sleep 15; done
log "##### chuoi 48 bat dau pid=$$ #####"; node .qa-dot37/db.mjs dem; echo
node $Q/k7.mjs --base=$B --tag=k7 > $Q/run-k7.log 2>&1; log "K7 xong: $(tail -1 $Q/run-k7.log)"; date -Iseconds > $Q/05-k7-XONG.txt
node $Q/probe-lop48.mjs --base=$B --tag=lop > $Q/run-lop48.log 2>&1; log "lop xong: $(tail -1 $Q/run-lop48.log)"; date -Iseconds > $Q/06-lop-XONG.txt
node $Q/thigiac48.mjs --lang=vi --base=$B > $Q/run-d3-vi.log 2>&1; log "thigiac vi xong ($(grep -c 'nhãn' $Q/run-d3-vi.log) dòng trạng thái)"; date -Iseconds > $Q/07-thigiac-vi-XONG.txt
node $Q/bbox48.mjs --tag=qa7 --base=$B > $Q/run-bbox-qa7.log 2>&1; log "bbox xong: $(tail -1 $Q/run-bbox-qa7.log)"; date -Iseconds > $Q/08-bbox-XONG.txt
PLAYWRIGHT_BASE_URL=$B npx playwright test e2e/twin-dot47-bam-canh.spec.ts --workers=1 --output $Q/pw-output > $Q/run-e2e-spec47.log 2>&1; echo "exit=$?" >> $Q/run-e2e-spec47.log
mkdir -p $Q/e2e-spec47; cp .qa-dot47/e2e/* $Q/e2e-spec47/; cp $Q/bak-dot47-e2e/* .qa-dot47/e2e/; md5sum .qa-dot47/e2e/* > $Q/md5-dot47-e2e-sau.txt
diff $Q/md5-dot47-e2e-truoc.txt $Q/md5-dot47-e2e-sau.txt > /dev/null && echo "dot47/e2e khoi phuc KHOP" | tee $Q/e2e-spec47-khoiphuc.txt || echo "!! dot47/e2e LECH" | tee $Q/e2e-spec47-khoiphuc.txt
log "e2e spec47 xong: $(grep -E 'passed|failed|exit=' $Q/run-e2e-spec47.log | tail -3 | tr '\n' ' ')"; date -Iseconds > $Q/09-e2e-spec47-XONG.txt
for M in twin line may; do node $Q/nguon-khung48.mjs --man=$M --base=$B > $Q/run-nguon-khung-$M.log 2>&1; log "nguon-khung $M: $(head -1 $Q/run-nguon-khung-$M.log | cut -c1-260)"; done; date -Iseconds > $Q/10-nguon-khung-XONG.txt
node .qa-dot44/do38.mjs --cases=p1 --man=twin,line,may --vp=1600x900 --tag=../.qa-dot48/p1 --base=$B --mang=chan > $Q/run-p1.log 2>&1; grep "p1" $Q/run-p1.log | cut -c1-250; date -Iseconds > $Q/11-p1-XONG.txt
sh $Q/hoi-quy.sh > $Q/hoi-quy.log 2>&1; log "hoi-quy xong: $(grep -E 'xong' $Q/hoi-quy.log | tail -4 | cut -c1-120 | tr '\n' ' ')"; date -Iseconds > $Q/12-hoi-quy-XONG.txt
{ echo "##### F1 mang=cham vp=1600x900 $(date +%T) #####"; timeout 900 node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=../$Q/f1-cham --mang=cham --base=$B 2>&1 | cut -c1-330; echo "##### F1 mang=treo vp=1600x900 $(date +%T) #####"; timeout 1200 node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=../$Q/f1-treo --mang=treo --base=$B 2>&1 | cut -c1-330; } > $Q/run-F1-cham-treo.log 2>&1
log "F1 cham/treo xong ✓=$(grep -c '✓' $Q/run-F1-cham-treo.log) ✗=$(grep -c '✗' $Q/run-F1-cham-treo.log)"; date -Iseconds > $Q/13-F1-cham-treo-XONG.txt
node .qa-dot37/db.mjs dem; echo
log "##### chuoi 48 xong #####"; date -Iseconds > $Q/chuoi-XONG.txt
