#!/bin/sh
# BG-124 — cài bộ hook của repo vào .git/hooks của clone hiện tại.
# Chạy:  sh scripts/hooks/cai-hook.sh
#
# ⚠ BẪY ĐÃ GẶP (2026-09-05): clone dev từng có `core.hooksPath` trỏ sang clone CŨ
# (c:\Apps\...\.git\hooks — di tích 29/06) ⇒ mọi hook cài vào .git/hooks đều CÂM,
# commit trần lọt không tiếng động. Installer này phát hiện và từ chối chạy khi
# hooksPath còn trỏ nơi khác — gỡ bằng: git config --unset core.hooksPath
# (nhớ chép hook còn giá trị từ chỗ cũ về trước khi gỡ).
set -e
goc=$(git rev-parse --show-toplevel)
hp=$(git config core.hooksPath || true)
if [ -n "$hp" ]; then
  echo "⛔ core.hooksPath đang trỏ [$hp] — hook cài vào .git/hooks sẽ CÂM." >&2
  echo "   Gỡ trước:  git config --unset core.hooksPath" >&2
  exit 1
fi
cp "$goc/scripts/hooks/pre-commit-chan-commit-tran.sh" "$goc/.git/hooks/pre-commit"
cp "$goc/scripts/hooks/pre-push-kb-stale.sh" "$goc/.git/hooks/pre-push"
cp "$goc/scripts/hooks/reference-transaction-chan-stash.sh" "$goc/.git/hooks/reference-transaction"
chmod +x "$goc/.git/hooks/pre-commit" "$goc/.git/hooks/pre-push" "$goc/.git/hooks/reference-transaction"
echo "Đã cài pre-commit (BG-124) + pre-push (kb-stale) + reference-transaction (chặn stash) vào $goc/.git/hooks/"
