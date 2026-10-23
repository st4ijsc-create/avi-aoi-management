#!/bin/bash
# Đo bộ nhớ (commit/Private) llama-server :8091 theo cấu hình — CHỈ ĐO (Đợt 9, 2026-10-23/24; sự cố 2026-10-23 22:20: 27B giữ ~40 GB
# commit). Mỗi CẤU HÌNH: dựng :8091 → lấy mẫu bộ nhớ mỗi 10 s (lay-mau-bo-nho.ps1) → 40 s nền → tải (tai-dai.mjs) → 30 s sau tải → tóm tắt.
# Giữ khoá khe suốt đợt (khoaKhe giu --co-dung), cuối đợt LUÔN đưa :8091 về 35B qua doi-model.ps1 rồi nhả khoá.
#
#   bash scripts/ai-eval/bo-nho/do-bo-nho-llama.sh <nhãn>:<đường>:<model>[:<ThemArgs>] ...
#     đường  = doi (doi-model.ps1 -GiuKhoa) | sp (ĐƯỜNG SẢN PHẨM scripts/ai/start-llama-server.ps1 -Force, .env cây chính chỉ đọc)
#     model  = 27b | 35b ;  ThemArgs (chỉ đường doi) vd "@('--cache-ram','4096')"
#     TAI=a (mặc định: 20 lượt, nghĩ tắt) | b (10 lượt, nghĩ bật, ra ~6k)
#   vd  bash scripts/ai-eval/bo-nho/do-bo-nho-llama.sh 27b-moi:doi:27b 35b-sp:sp:35b
# Kết quả: tmp/bn-<nhãn>.csv (mẫu), tmp/bn-tai-<nhãn>.log (tải), dòng "===" ra stdout. Chạy từ gốc repo (worktree).
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-bo-nho-llama.sh (phien do-model)"
declare -A MODEL=([27b]="D:/SOURCES/16.AI/Qwen3.6-27B-UD-Q4_K_XL.gguf" [35b]="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")
ENV_CHINH="D:\\SOURCES\\avi-aoi-management\\.env"
TAI=${TAI:-a}
mkdir -p tmp
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do bo nho llama-server" --co-dung tmp/dung-khoa-$$ > tmp/khoa-giu-bn.log 2>&1 & KHOA=$!
goKhoa() { node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-$$; wait $KHOA 2>/dev/null; }
sleep 2
chay() { # $1 nhãn, $2 đường, $3 model, $4 ThemArgs
  local nhan=$1 duong=$2 m=${MODEL[$3]} them="" logErr=""
  [ -z "$m" ] && { log "$nhan: model '$3' lạ — bỏ qua"; return; }
  [ -n "$4" ] && them="-ThemArgs $4"
  if [ "$duong" = sp ]; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai/start-llama-server.ps1 -EnvFile "$ENV_CHINH" -Force -Model "$(basename "$m")" > tmp/bn-doi-$nhan.log 2>&1
    log "$nhan: start-llama-server rc=$?"
    logErr=$(tr -d '\r' < tmp/bn-doi-$nhan.log | sed -n 's/.*log *: *\(.*\)\.out\.log.*/\1.err.log/p' | tail -1)
  else
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$m' -GiuKhoa '$CHU' $them" > tmp/bn-doi-$nhan.log 2>&1
    log "$nhan: doi-model rc=$? · $(tr -d '\r' < tmp/bn-doi-$nhan.log | grep -E 'SAN SANG|BAN GIAO|HET GIO|KHOA' | tr '\n' ' ')"
    logErr=$(tr -d '\r' < tmp/bn-doi-$nhan.log | sed -n 's/^LOG: //p' | tail -1)
  fi
  log "$nhan: log = $logErr"
  log "$nhan: dòng lệnh: $(powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\").CommandLine" | tr -d '\r' | sed 's/.*-c 65536//')"
  log "$nhan: log cache: $(grep -aE 'prompt cache is|cache-ram' "$logErr" | head -3 | tr -d '\r' | tr '\n' ' ' | cut -c1-300)"
  rm -f tmp/bn-dung
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai-eval/bo-nho/lay-mau-bo-nho.ps1 -Csv "tmp/bn-$nhan.csv" -Dung "tmp/bn-dung" -Log "$logErr" -Giay 10 > /dev/null 2>&1 &
  local MAU=$!
  sleep 40   # nền sau khi nạp (≥ 3 mẫu)
  if [ "$TAI" = b ]; then DAI_RA=1 node scripts/ai-eval/bo-nho/tai-dai.mjs 10 > tmp/bn-tai-$nhan.log 2>&1
  else node scripts/ai-eval/bo-nho/tai-dai.mjs 20 > tmp/bn-tai-$nhan.log 2>&1; fi
  log "$nhan: tải rc=$? · HTTP 200: $(grep -c 'HTTP 200' tmp/bn-tai-$nhan.log) · $(tail -1 tmp/bn-tai-$nhan.log)"
  sleep 30   # sau tải
  touch tmp/bn-dung; wait $MAU
  log "$nhan: $(node -e "
    const L=require('fs').readFileSync('tmp/bn-$nhan.csv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(','));
    const p=L.map(x=>+x[2]).filter(x=>x>0), os=L.map(x=>+x[4]);
    console.log('mau '+L.length+' · private dau '+p[0]+' GB · max '+Math.max(...p)+' GB · cuoi '+p.at(-1)+' GB · max-dau '+(Math.max(...p)-p[0]).toFixed(2)+' GB · commit trong OS min '+Math.min(...os)+' GB · prompt_save '+L.at(-1)[5])")"
}
for c in "$@"; do IFS=: read -r nhan duong model them <<< "$c"; chay "$nhan" "$duong" "$model" "$them"; done
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '${MODEL[35b]}' -GiuKhoa '$CHU'" > tmp/bn-doi-ve-nha.log 2>&1
log "về 35B: doi-model rc=$? · $(tr -d '\r' < tmp/bn-doi-ve-nha.log | grep -E 'SAN SANG|HET GIO|LOG' | tr '\n' ' ')"
goKhoa
log "HẾT :8091 = $(curl -s -m 5 http://127.0.0.1:8091/v1/models | head -c 90)"
echo EXIT=0
