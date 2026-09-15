#!/bin/sh
# Làm tươi heartbeat QATD mỗi 45 s trong lúc đo (HAN_MAU_MAY_MS = 300 s). Dừng: tạo tệp .qa-tapdoan/NHIP-DUNG
cd /d/SOURCES/avi-aoi-management || exit 1
rm -f .qa-tapdoan/NHIP-DUNG
i=0
while [ ! -f .qa-tapdoan/NHIP-DUNG ] && [ $i -lt 300 ]; do
  node .qa-tapdoan/sinh-tap-doan.mjs --chi-nhip >> .qa-tapdoan/nhip.log 2>&1
  echo "nhịp #$i $(date -Iseconds)" >> .qa-tapdoan/nhip.log
  i=$((i+1)); sleep 45
done
echo "nhịp dừng $(date -Iseconds)" >> .qa-tapdoan/nhip.log
