#!/bin/bash
# Đợt đo ĐỌC ẢNH (spec docs/superpowers/specs/2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md §4 — cổng viết trước). Khoá khe suốt đợt;
# cuối đợt :8091 về 35B mặc định qua doi-model rồi nhả khoá. VRAM lấy mẫu nvidia-smi mỗi 2 s ⇒ tmp/thi-giac/vram-<nhãn>.csv.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-thi-giac.sh (phien do-model)"
M35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"; M27="D:/SOURCES/16.AI/Qwen3.6-27B-UD-Q4_K_XL.gguf"
MM35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-mmproj-F16.gguf"; MM27="D:/SOURCES/16.AI/Qwen3.6-27B-mmproj-F16.gguf"
LAN=${LAN:-3}
mkdir -p tmp/thi-giac
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do doc anh" --co-dung tmp/dung-khoa-tg-$$ > tmp/thi-giac/khoa.log 2>&1 & KHOA=$!
sleep 2
vram() { # $1 nhãn — chạy nền tới khi có tmp/thi-giac/dung-vram
  rm -f tmp/thi-giac/dung-vram; ( while [ ! -f tmp/thi-giac/dung-vram ]; do echo "$(date +%T),$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | tr -d '\r ')"; sleep 2; done ) > tmp/thi-giac/vram-$1.csv & VRAM=$!
}
vramDung() { touch tmp/thi-giac/dung-vram; wait $VRAM; log "$1: VRAM đỉnh $(cut -d, -f2 tmp/thi-giac/vram-$1.csv | sort -n | tail -1) MiB · mẫu $(wc -l < tmp/thi-giac/vram-$1.csv)"; }
doi() { # $1 nhãn, $2 model, $3 ThemArgs
  local them=""; [ -n "$3" ] && them="-ThemArgs $3"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$2' -GiuKhoa '$CHU' $them" > tmp/thi-giac/doi-$1.log 2>&1
  log "$1: doi-model rc=$? · $(tr -d '\r' < tmp/thi-giac/doi-$1.log | grep -E 'LOG:|SAN SANG|HET GIO' | tr '\n' ' ')"
}
taiChu() { node scripts/ai-eval/bo-nho/tai-dai.mjs 5 > tmp/thi-giac/chu-$1.log 2>&1; log "$1: Tải A 5 lượt: $(grep -o '[0-9]* ms' tmp/thi-giac/chu-$1.log | tr '\n' ' ')"; }

# (a) 35B + mmproj
doi A35 "$M35" "@('--mmproj','$MM35')"
vram A35
node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan smoke-A35 --che-do truc-tiep --url http://127.0.0.1:8091 --chi 08 --lan 1 2>&1 | tail -2
node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan A35 --che-do truc-tiep --url http://127.0.0.1:8091 --lan $LAN 2>&1 | tee tmp/thi-giac/A35.out | tail -1
taiChu A35
vramDung A35
# (a') 27B + mmproj — 1 lượt, tham khảo
doi A27 "$M27" "@('--mmproj','$MM27')"
vram A27
node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan A27 --che-do truc-tiep --url http://127.0.0.1:8091 --lan 1 2>&1 | tee tmp/thi-giac/A27.out | tail -1
vramDung A27
# (b) 35B chữ + VL-8B mô tả
doi B35 "$M35" ""
vram B
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai-eval/thi-giac/model-tham-chieu.ps1 -Lam bat > tmp/thi-giac/vl8b.log 2>&1; log "VL-8B: rc=$? $(tr -d '\r' < tmp/thi-giac/vl8b.log | tail -2 | tr '\n' ' ')"
if curl -s -m 3 http://127.0.0.1:8095/health | grep -q ok; then
  node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan B --che-do hai-buoc --url http://127.0.0.1:8091 --url-mo-ta http://127.0.0.1:8095 --lan $LAN 2>&1 | tee tmp/thi-giac/B.out | tail -1
  node scripts/ai-eval/thi-giac/do-doc-anh.mjs --nhan B0 --che-do truc-tiep --url http://127.0.0.1:8095 --nghi tat --lan 1 2>&1 | tee tmp/thi-giac/B0.out | tail -1
  taiChu B
fi
vramDung B
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai-eval/thi-giac/model-tham-chieu.ps1 -Lam tat
doi ve-nha "$M35" ""
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-tg-$$; wait $KHOA 2>/dev/null
log "HẾT :8091 = $(curl -s -m 5 http://127.0.0.1:8091/v1/models | head -c 90)"
echo EXIT=0
