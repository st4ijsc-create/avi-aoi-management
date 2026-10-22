#!/bin/bash
# Đợt 9 (2026-10-22, dieu-phoi tìm gốc llama-server chết 18:21: Windows "Virtual Memory Minimum Too Low" — commit trống 3,4 GB,
# vmmemWSL giữ 26 GB gần hết là PAGE CACHE Linux). Mỗi 30 phút: thả page cache của VM docker-desktop (an toàn, không dừng container)
# + ghi commit trống vào log canh; < 8 GB ⇒ CẢNH BÁO. Chạy nền suốt đợt GPU dài; kill khi xong.
LOG=${1:-tmp/canh-bo-nho.log}
while true; do
  truoc=$(powershell.exe -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB,1)" | tr -d '\r')
  wsl -d docker-desktop -u root sh -c "sync; echo 3 > /proc/sys/vm/drop_caches" >/dev/null 2>&1
  sau=$(powershell.exe -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB,1)" | tr -d '\r')
  canh=""; awk "BEGIN{exit !($sau < 8)}" && canh=" ⚠ CẢNH BÁO: commit trống < 8 GB"
  echo "$(date +%T) commit trống ${truoc} GB → (drop_caches) → ${sau} GB${canh}" >> "$LOG"
  sleep 1800
done
