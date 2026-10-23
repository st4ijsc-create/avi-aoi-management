#!/bin/bash
# Đợt 9 (2026-10-22, dieu-phoi tìm gốc llama-server chết 18:21: Windows "Virtual Memory Minimum Too Low" — commit trống 3,4 GB,
# vmmemWSL giữ 26 GB gần hết là PAGE CACHE Linux). Mỗi 30 phút: thả page cache của VM docker-desktop (an toàn, không dừng container)
# + ghi commit trống vào log canh; < 8 GB ⇒ CẢNH BÁO. Chạy nền suốt đợt GPU dài; kill khi xong.
# 2026-10-24 (dieu-phoi duyệt P3): thêm MỖI 30 s một dòng "mau" = Private (commit) của llama-server + commit trống OS — để thấy
# đường đi bộ nhớ của llama-server suốt đợt đo (sự cố 2026-10-23 22:20: 27B giữ ~40 GB commit mà không ai thấy nó leo lúc nào).
# Dòng log:  HH:MM:SS mau pid=<pid> private=<GB> commitTrong=<GB>   |   HH:MM:SS commit trống A GB → (drop_caches) → B GB
LOG=${1:-tmp/canh-bo-nho.log}
NHIP=${CANH_BO_NHO_NHIP_GIAY:-30}
DROP_MOI=$(( 1800 / NHIP ))
commitTrong() { powershell.exe -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB,1)" | tr -d '\r'; }
i=0
while true; do
  if [ $(( i % DROP_MOI )) -eq 0 ]; then
    truoc=$(commitTrong)
    wsl -d docker-desktop -u root sh -c "sync; echo 3 > /proc/sys/vm/drop_caches" >/dev/null 2>&1
    sau=$(commitTrong)
    canh=""; awk "BEGIN{exit !($sau < 8)}" && canh=" ⚠ CẢNH BÁO: commit trống < 8 GB"
    echo "$(date +%T) commit trống ${truoc} GB → (drop_caches) → ${sau} GB${canh}" >> "$LOG"
  fi
  mau=$(powershell.exe -NoProfile -Command '$p = Get-Process llama-server -ErrorAction SilentlyContinue | Select-Object -First 1; $c = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB,1); if ($p) { "pid={0} private={1:N2} commitTrong={2}" -f $p.Id, ($p.PrivateMemorySize64/1GB), $c } else { "pid=- private=- commitTrong=$c" }' | tr -d '\r')
  canh=""; c=${mau##*commitTrong=}; awk "BEGIN{exit !($c < 8)}" 2>/dev/null && canh=" ⚠ commit trống < 8 GB"
  echo "$(date +%T) mau ${mau}${canh}" >> "$LOG"
  i=$(( i + 1 ))
  sleep "$NHIP"
done
