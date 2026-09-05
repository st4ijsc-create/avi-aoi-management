#!/bin/sh
# BG-124 — cài hook chặn-commit-trần vào .git/hooks của clone hiện tại.
# Chạy:  sh scripts/hooks/cai-hook.sh
set -e
goc=$(git rev-parse --show-toplevel)
cp "$goc/scripts/hooks/pre-commit-chan-commit-tran.sh" "$goc/.git/hooks/pre-commit"
chmod +x "$goc/.git/hooks/pre-commit"
echo "Đã cài pre-commit (BG-124) vào $goc/.git/hooks/pre-commit"
