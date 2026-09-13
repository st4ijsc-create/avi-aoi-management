#!/bin/sh
# DOT 58 — cong KHONG can server. Ghi tung log rieng, khong cmd > "$f" long nhau (G130).
cd /d/SOURCES/_twin_wt || exit 1
L=.qa-dot58
echo "=== [HQ-tinh] bat dau $(date -Iseconds) ==="
npx vitest run client/src/components/twin3d 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-twin3d.log | tail -6
echo "--- pham vi + census ---"
npx vitest run phamVi 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-phamvi.log | tail -6
echo "--- npm run check ---"
npm run check 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-check.log | tail -4; echo "exit=$?"
echo "--- npm run check:tests ---"
npm run check:tests 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-check-tests.log | tail -3
echo "--- npm run i18n:check ---"
npm run i18n:check 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-i18n.log | tail -4
echo "--- npm run lint:tokens ---"
npm run lint:tokens 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-lint-tokens.log | tail -6
echo "--- kiem-vo-app-https ---"
node scripts/kiem-vo-app-https.mjs 2>&1 | tee $L/HQ-kiem-vo.log | tail -6
echo "=== [HQ-tinh] xong $(date -Iseconds) ==="
