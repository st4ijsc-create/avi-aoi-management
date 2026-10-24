#!/bin/bash
# Cổng (B) `--ctx-checkpoints` (spec 2026-10-20 §6 — cổng viết trước). 27B + mmproj (mặc định doi-model), N = 32 → 16 → 8 → 32.
# Mỗi N: tai-hoi-thoai.mjs (2 vòng; lượt 32 cuối 1 vòng), mẫu Private 10 s + VRAM 2 s. Cuối: :8091 về 35B + mmproj (mặc định). Khoá khe suốt đợt.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-ctx-checkpoints.sh (phien do-model)"
M27="D:/SOURCES/16.AI/Qwen3.6-27B-UD-Q4_K_XL.gguf"; M35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
O=tmp/bo-nho/ctxcp; [ "${CHI_35B:-}" = "1" ] || rm -rf $O; mkdir -p $O
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do ctx-checkpoints" --co-dung tmp/dung-khoa-cp-$$ > $O/khoa.log 2>&1 & KHOA=$!
sleep 2
chay() { # $1 nhãn, $2 N, $3 số vòng
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M27' -GiuKhoa '$CHU' -ThemArgs @('--ctx-checkpoints','$2')" > $O/doi-$1.log 2>&1
  log "$1: doi-model rc=$? · $(tr -d '\r' < $O/doi-$1.log | grep -E 'SAN SANG|HET GIO|MMPROJ' | tr '\n' ' ')"
  local logErr; logErr=$(tr -d '\r' < $O/doi-$1.log | sed -n 's/^LOG: //p' | tail -1)
  log "$1: dòng lệnh: $(powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\").CommandLine" | tr -d '\r' | grep -o -- '--ctx-checkpoints [0-9]*\|--mmproj [^ ]*\|--cache-ram [0-9]*' | tr '\n' ' ')"
  rm -f $O/dung-$1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai-eval/bo-nho/lay-mau-bo-nho.ps1 -Csv "$O/bn-$1.csv" -Dung "$O/dung-$1" -Log "$logErr" -Giay 10 > /dev/null 2>&1 & local MAU=$!
  ( while [ ! -f $O/dung-$1 ]; do echo "$(date +%T),$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | tr -d '\r ')"; sleep 2; done ) > $O/vram-$1.csv & local VR=$!
  sleep 30
  node scripts/ai-eval/bo-nho/tai-hoi-thoai.mjs --vong $3 ${TAI_THEM:-} --ra $O/luot-$1.jsonl > $O/tai-$1.log 2>&1
  log "$1: tải rc=$? · $(tail -1 $O/tai-$1.log)"
  sleep 20
  touch $O/dung-$1; wait $MAU $VR
  log "$1: $(node -e "
    const fs=require('fs');
    const L=fs.readFileSync('$O/bn-$1.csv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(','));
    const p=L.map(x=>+x[2]).filter(x=>x>0), os=L.map(x=>+x[4]);
    const v=fs.readFileSync('$O/vram-$1.csv','utf8').trim().split(/\r?\n/).map(l=>+l.split(',')[1]).filter(x=>x>0).sort((a,b)=>a-b);
    const d=fs.readFileSync('$O/luot-$1.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse);
    const tv=a=>{a=[...a].sort((x,y)=>x-y);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:NaN};
    const dai=d.filter(x=>x.pha==='dai'), xen=d.filter(x=>x.pha==='xen');
    console.log('Private dau '+p[0]+' max '+Math.max(...p)+' cuoi '+p.at(-1)+' TANG '+(Math.max(...p)-p[0]).toFixed(2)+' GB · commit trong min '+Math.min(...os)+' GB · VRAM max '+v.at(-1)+' · luot '+d.length+' loi '+d.filter(x=>x.http!==200).length+' · DAI tv '+tv(dai.map(x=>x.ms))+' ms promptN '+dai.reduce((a,x)=>a+(x.promptN||0),0)+' · XEN tv '+tv(xen.map(x=>x.ms))+' ms promptN '+xen.reduce((a,x)=>a+(x.promptN||0),0)+' · TONG promptN '+d.reduce((a,x)=>a+(x.promptN||0),0))")"
  log "$1: checkpoint lớn nhất $(grep -ao 'created context checkpoint [0-9]* of [0-9]*' "$logErr" | awk '{print $4"/"$6}' | sort -t/ -n -k1 | tail -1) · restored $(grep -ac 'restored context checkpoint' "$logErr") · erased $(grep -aic 'erase' "$logErr")"
}
if [ "${CHI_35B:-}" != "1" ]; then
chay N32a 32 2
chay N16 16 2
chay N8 8 2
chay N32b 32 1
fi
# Vòng XÁC NHẬN 35B (dieu-phoi bổ sung): pha DÀI, 32 rồi N đã chọn (N_35B), mỗi bên 1 vòng — chỉ pha dài (--luot 0).
if [ -n "${N_35B:-}" ]; then
  M27="$M35"; TAI_THEM="--luot 0"
  chay X35-32 32 1
  chay X35-$N_35B $N_35B 1
fi
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M35' -GiuKhoa '$CHU'" > $O/ve-nha.log 2>&1
log "về 35B: rc=$? $(tr -d '\r' < $O/ve-nha.log | grep -E 'SAN SANG|HET GIO|MMPROJ' | tr '\n' ' ')"
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-cp-$$; wait $KHOA 2>/dev/null
echo EXIT=0
