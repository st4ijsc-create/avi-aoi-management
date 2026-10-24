#!/bin/bash
# Cổng C5' (spec 2026-10-24 đọc ảnh §5): đường CHỮ có chậm đi khi 35B nạp --mmproj không? Ghép cặp xen kẽ thuong/mm/thuong/mm, Tải A 20 lượt.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-c5-ghep-cap.sh (phien do-model)"; M35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"; MM35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-mmproj-F16.gguf"
mkdir -p tmp/thi-giac
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do C5 ghep cap" --co-dung tmp/dung-khoa-c5-$$ > tmp/thi-giac/khoa-c5.log 2>&1 & KHOA=$!
sleep 2
for nhan in thuong1 mm1 thuong2 mm2; do
  them=""; [[ $nhan == mm* ]] && them="-ThemArgs @('--mmproj','$MM35')"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M35' -GiuKhoa '$CHU' $them" > tmp/thi-giac/c5-doi-$nhan.log 2>&1
  log "$nhan: doi-model rc=$? $(tr -d '\r' < tmp/thi-giac/c5-doi-$nhan.log | grep -E 'SAN SANG|HET GIO' | tr '\n' ' ')"
  node scripts/ai-eval/bo-nho/tai-dai.mjs 20 > tmp/thi-giac/c5-$nhan.log 2>&1
  log "$nhan: $(grep -c 'HTTP 200' tmp/thi-giac/c5-$nhan.log)/20 · $(grep -o '[0-9]* ms' tmp/thi-giac/c5-$nhan.log | tr '\n' ' ')"
done
node -e '
const fs=require("fs");const t=(n)=>fs.readFileSync(`tmp/thi-giac/c5-${n}.log`,"utf8").match(/\d+(?= ms)/g).map(Number);
const tv=(a)=>{a=[...a].sort((x,y)=>x-y);return (a[(a.length-1)>>1]+a[a.length>>1])/2};
const th=[...t("thuong1"),...t("thuong2")], mm=[...t("mm1"),...t("mm2")];
console.log(`C5: thuong trung vi ${tv(th)} ms (n=${th.length}) · mmproj ${tv(mm)} ms (n=${mm.length}) · ti le ${(tv(mm)/tv(th)).toFixed(3)} · ${tv(mm)<=1.1*tv(th)?"DAT":"KHONG DAT"}`);
console.log(`tung cap: ${["1","2"].map(i=>(tv(t("mm"+i))/tv(t("thuong"+i))).toFixed(3)).join(" / ")}`);'
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M35' -GiuKhoa '$CHU'" > tmp/thi-giac/c5-doi-ve.log 2>&1
log "ve nha rc=$?"
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-c5-$$; wait $KHOA 2>/dev/null
echo EXIT=0
