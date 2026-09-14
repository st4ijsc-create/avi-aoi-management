#!/bin/sh
# ĐỢT 54 — GỠ VÁ Đợt 53 (5 tệp sản phẩm) về bản TRƯỚC vá (9f6da8ca), build dist-54z, rồi KHÔI PHỤC.
# G101: dùng `git show <sha>:` (không `git checkout --`, tránh CRLF).  G130: ghi tệp tạm rồi `mv`.
set -e
cd /d/SOURCES/_twin_wt
F1=client/src/components/twin3d/van-hanh/locBadge.ts
F2=client/src/components/twin3d/van-hanh/LopCanhBao.tsx
F3=server/services/trangThaiMayTuoi.ts
F4=server/services/ecosystem/assetCockpitService.ts
F5=server/services/factoryCommandService.ts
KHOI_PHUC() {
  for F in "$F1" "$F2" "$F3" "$F4" "$F5"; do
    git show 360c9218:"$F" > "$F.tmp54" && mv "$F.tmp54" "$F"
  done
  echo "--- KHOI PHUC xong $(date -Iseconds) ---"
  md5sum "$F1" "$F2" "$F3" "$F4" "$F5" > .qa-dot54/md5-ma-sau.txt
  diff .qa-dot54/md5-ma-truoc.txt .qa-dot54/md5-ma-sau.txt && echo "md5 5/5 KHOP" || echo "!!! md5 LECH"
  git status --porcelain -- "$F1" "$F2" "$F3" "$F4" "$F5" > .qa-dot54/gitstatus-ma-sau.txt
  echo "git status 5 tep: [$(cat .qa-dot54/gitstatus-ma-sau.txt)] (rong = sach)"
}
trap KHOI_PHUC EXIT INT TERM
for F in "$F1" "$F2" "$F3" "$F4" "$F5"; do
  git show 9f6da8ca:"$F" > "$F.tmp54" && mv "$F.tmp54" "$F"
done
echo "=== da go va ve 9f6da8ca; git diff --stat ==="
git diff --stat -- "$F1" "$F2" "$F3" "$F4" "$F5"
sh .qa-dot54/build.sh 54z 2>&1 | tail -3
