#!/bin/bash
# Cổng (A) bật LLAMA_SERVER_MMPROJ=auto (spec 2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md §6 — cổng viết trước, dieu-phoi duyệt mức).
# ĐƯỜNG SẢN PHẨM start-llama-server.ps1 -Force trên BẢN SAO TẠM .env cây chính + LLAMA_SERVER_MMPROJ=auto|off (xoá khi xong).
# Mỗi model: auto (X chữ 20 + Y 13 ảnh [+ e2e ở 35B]) rồi off (X chữ 20 + Y' 13 câu chữ chung tiền tố). Cuối: 35B qua doi-model.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-cong-a.sh (phien do-model)"
M35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"
O=tmp/thi-giac/cong-a; rm -rf $O; mkdir -p $O
TW="$(cygpath -w "$TEMP")"
for c in auto off; do cp /d/SOURCES/avi-aoi-management/.env "$TEMP/do-cong-a-$c-$$.env"; printf '\nLLAMA_SERVER_MMPROJ=%s\n' $c >> "$TEMP/do-cong-a-$c-$$.env"; done
trap 'rm -f "$TEMP"/do-cong-a-*-$$.env' EXIT
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do cong A mmproj" --co-dung tmp/dung-khoa-ca-$$ > $O/khoa.log 2>&1 & KHOA=$!
sleep 2
pid3013() { powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3013 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" | tr -d '\r'; }
cmdl() { powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\").CommandLine" | tr -d '\r'; }

e2e() {
  LOG_JSON=1 powershell.exe -NoProfile -ExecutionPolicy Bypass -File tmp/khoi-3013.ps1 -Log "tmp\\server-3013-conga.log" >/dev/null 2>&1 </dev/null
  local ok=0; for i in $(seq 1 60); do c=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3013/); [ "$c" = 200 ] && { ok=1; break; }; sleep 5; done
  log "e2e: :3013 lên=$ok"
  if [ $ok = 1 ]; then
    curl -s -X POST http://127.0.0.1:3013/api/auth/login -H "Content-Type: application/json" -d @tmp/dang-nhap-do.json -c tmp/audit-ai/ck.txt -o /dev/null -w "=== e2e: đăng nhập HTTP %{http_code}\n"
    AI_EVAL_BASE=http://127.0.0.1:3013 node scripts/ai-eval/vscode-e2e/tao-token.mjs --cookie tmp/audit-ai/ck.txt --ten do-anh-cong-a --so-ngay 1 > $O/token.log 2>&1
    local id; id=$(grep -o 'id=[0-9]*' $O/token.log | head -1 | cut -d= -f2); log "e2e: token id=$id"
    node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt ${id:+--thu-hoi $id} 2>&1 | sed 's/^/=== e2e: /'
  fi
  local p; p=$(pid3013); [ -n "$p" ] && powershell.exe -NoProfile -Command "Stop-Process -Id $p -Force"
}

doMot() { # $1 nhãn, $2 basename model, $3 auto|off, $4 lệnh pha Y, $5 lệnh thêm (e2e)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai/start-llama-server.ps1 -EnvFile "$TW\\do-cong-a-$3-$$.env" -Force -Model "$2" > $O/sp-$1.log 2>&1
  log "$1: start-llama-server rc=$?"
  local logErr; logErr=$(tr -d '\r' < $O/sp-$1.log | sed -n 's/.*log *: *\(.*\)\.out\.log.*/\1.err.log/p' | tail -1)
  log "$1: /props modalities = $(curl -s -m 5 http://127.0.0.1:8091/props | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s).modalities))}catch{console.log("?")}})') · $(cmdl | grep -o -- '--mmproj [^ ]*' || echo 'không --mmproj') · $(cmdl | grep -o -- '--cache-ram [0-9]*')"
  rm -f $O/dung-$1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai-eval/bo-nho/lay-mau-bo-nho.ps1 -Csv "$O/bn-$1.csv" -Dung "$O/dung-$1" -Log "$logErr" -Giay 10 > /dev/null 2>&1 & local MAU=$!
  ( while [ ! -f $O/dung-$1 ]; do echo "$(date +%T),$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | tr -d '\r ')"; sleep 2; done ) > $O/vram-$1.csv & local VR=$!
  sleep 40
  node scripts/ai-eval/bo-nho/tai-dai.mjs 20 > $O/chu-$1.log 2>&1
  log "$1: X chữ 20: HTTP 200 $(grep -c 'HTTP 200' $O/chu-$1.log)/20 · trung vị $(grep -o '[0-9]* ms' $O/chu-$1.log | awk '{print $1}' | sort -n | sed -n 10p) ms"
  eval "$4" 2>&1 | tail -1 | sed "s/^/=== $1: Y: /"
  [ -n "$5" ] && eval "$5"
  sleep 30
  touch $O/dung-$1; wait $MAU $VR
  log "$1: $(node -e "
    const fs=require('fs');
    const v=fs.readFileSync('$O/vram-$1.csv','utf8').trim().split(/\r?\n/).map(l=>+l.split(',')[1]).filter(x=>x>0).sort((a,b)=>a-b);
    const p99=v[Math.min(v.length-1,Math.ceil(v.length*0.99)-1)];
    const L=fs.readFileSync('$O/bn-$1.csv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(','));
    const p=L.map(x=>+x[2]).filter(x=>x>0), os=L.map(x=>+x[4]);
    console.log('VRAM p99 '+p99+' max '+v.at(-1)+' MiB (n='+v.length+') · Private dau '+p[0]+' max '+Math.max(...p)+' cuoi '+p.at(-1)+' · TANG '+(Math.max(...p)-p[0]).toFixed(2)+' GB · commit trong min '+Math.min(...os)+' GB')")"
  log "$1: checkpoint lớn nhất: $(grep -ao 'created context checkpoint [0-9]* of [0-9]*' "$logErr" | awk '{print $4}' | sort -n | tail -1) · cỡ $(grep -ao 'created context checkpoint.*size = [0-9.]* MiB' "$logErr" | tail -1 | grep -o 'size = [0-9.]* MiB')"
}
ANH='node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan cong-a-$1 --che-do truc-tiep --url http://127.0.0.1:8091 --lan 1'
CHU_Y='node scripts/ai-eval/thi-giac/tai-chung-tien-to.mjs 13 > $O/y-$1.log 2>&1; echo "13 câu chữ chung tiền tố: HTTP 200 $(grep -c "HTTP 200" $O/y-$1.log)/13"'
doMot A35 Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf auto "$ANH" e2e
doMot O35 Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf off "$CHU_Y"
doMot A27 Qwen3.6-27B-UD-Q4_K_XL.gguf auto "$ANH"
doMot O27 Qwen3.6-27B-UD-Q4_K_XL.gguf off "$CHU_Y"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M35' -GiuKhoa '$CHU'" > $O/ve-nha.log 2>&1
log "về 35B: rc=$? $(tr -d '\r' < $O/ve-nha.log | grep -E 'SAN SANG|HET GIO' | tr '\n' ' ')"
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-ca-$$; wait $KHOA 2>/dev/null
echo EXIT=0
