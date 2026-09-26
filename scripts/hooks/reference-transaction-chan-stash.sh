#!/bin/sh
# BG-124 mở rộng (2026-09-05) — CHẶN `git stash` BẰNG CƠ CHẾ trên nhánh/worktree dùng chung.
#
# Vì sao: `git stash`/`stash pop` từng quét mất công việc của agent khác (R-KC-12 và các vụ
# cùng họ — tổng 5 vi phạm lớp lệnh-cấm tính đến 05/09 dù mọi brief đều ghi cấm). Luật văn
# bản không đủ (bài học BG-124); hook pre-commit chặn được commit trần nhưng stash không đi
# qua pre-commit. Stash ĐI QUA reference-transaction: nó tạo/ghi `refs/stash`.
#
# CƠ CHẾ (đo thật 2026-09-05, scratch repo):
#   `git stash push` với hook này ⇒ exit 128, KHÔNG tạo stash, WORKTREE GIỮ NGUYÊN từng byte.
#   Xóa stash (new=0000…) vẫn cho qua — dọn dẹp không bị cản.
#   Mọi ref khác (heads/tags/remotes) không bị đụng ⇒ commit/fetch/push/rebase như thường.
# Lối thoát người thật:  CHO_PHEP_STASH=1 git stash ...
#
# Cài bằng scripts/hooks/cai-hook.sh (bản chạy là COPY trong .git/hooks/reference-transaction).
if [ "$1" = "prepared" ]; then
  while read old new ref; do
    if [ "$ref" = "refs/stash" ] && [ "$new" != "0000000000000000000000000000000000000000" ]; then
      if [ "$CHO_PHEP_STASH" = "1" ]; then exit 0; fi
      echo "" >&2
      echo "⛔ BG-124: git stash bị chặn trên worktree dùng chung (đã quét mất việc agent khác 2 lần)." >&2
      echo "   Cần đối chiếu bản cũ:  git show HEAD:<tệp> > <tệp tạm ngoài repo>" >&2
      echo "   Người thật cố ý:       CHO_PHEP_STASH=1 git stash ..." >&2
      exit 1
    fi
  done
fi
exit 0
