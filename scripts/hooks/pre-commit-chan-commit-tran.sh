#!/bin/sh
# BG-124 — CHẶN COMMIT TRẦN BẰNG CƠ CHẾ, không bằng luật văn bản.
#
# Bối cảnh: 3 tai nạn git trong một ngày (2026-09-04) trên nhánh chung nhiều phiên/agent
# (R-KC-4/11/12): `git commit` KHÔNG kèm pathspec `--` cuốn luôn tệp phiên khác đang stage.
# Luật "pathspec ở CẢ add LẪN commit" nằm trong mọi brief mà vẫn bị vi phạm ⇒ BG-124 kết luận
# phải đóng bằng cơ chế. Hook này là cơ chế đó.
#
# CƠ CHẾ (đo thật 2026-09-05, git 2.x Windows — xem backlog BG-124):
#   · `git commit -m ... -- <tệp>` (pathspec) ⇒ git dựng INDEX TẠM, hook thấy
#     GIT_INDEX_FILE = .../next-index-<pid>.lock            ⇒ CHO QUA
#   · `git commit -m ...` / `git commit -a` (trần, cả index) ⇒ hook thấy
#     GIT_INDEX_FILE = .git/index (hoặc không đặt)          ⇒ TỪ CHỐI
#
# Lối thoát CÓ CHỦ Ý (con người, hoặc ca đặc biệt như kết thúc merge):
#   CHO_PHEP_COMMIT_TRAN=1 git commit ...      (khai rõ ý định)
#   git commit --no-verify ...                 (đường thoát chuẩn của git)
#
# ⚠ Hook nằm ở scripts/hooks/ (được version); bản chạy là bản COPY trong .git/hooks/
#   (cài bằng scripts/hooks/cai-hook.sh). Sửa ở đây thì chạy lại installer.

if [ "$CHO_PHEP_COMMIT_TRAN" = "1" ]; then
  exit 0
fi

ten_index=$(basename "${GIT_INDEX_FILE:-index}")
case "$ten_index" in
  index)
    echo "" >&2
    echo "⛔ BG-124: COMMIT TRẦN bị chặn trên nhánh dùng chung nhiều phiên." >&2
    echo "   Commit này sẽ cuốn TOÀN BỘ index — kể cả tệp phiên/agent khác đang stage." >&2
    echo "   Tệp đang stage:" >&2
    git diff --cached --name-only | sed 's/^/     · /' >&2
    echo "   Dùng:  git commit -m \"...\" -- <tệp1> <tệp2>   (pathspec — cách chuẩn)" >&2
    echo "   Người thật cần commit cả index:  CHO_PHEP_COMMIT_TRAN=1 git commit ..." >&2
    exit 1
    ;;
  *)
    # next-index-*.lock ⇒ commit pathspec: đúng kỷ luật, cho qua.
    exit 0
    ;;
esac
