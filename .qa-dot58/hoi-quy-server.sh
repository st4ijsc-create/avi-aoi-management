#!/bin/sh
# DOT 58 — cong CAN server 3058 (dist-head1). Anh e2e di vao .qa-dot58, KHONG vao test-results/.
cd /d/SOURCES/_twin_wt || exit 1
L=.qa-dot58
export PLAYWRIGHT_BASE_URL=http://localhost:3058
export TWIN_E2E_ANH_DOT31=$L/e2e-dot31
export TWIN_E2E_ANH=$L/e2e-anh
echo "=== [HQ-server] bat dau $(date -Iseconds) ==="
echo "--- e2e bam canh (16) ---"
npx playwright test e2e/twin-dot47-bam-canh.spec.ts --reporter=line 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-bamcanh.log | tail -5
echo "--- e2e twin-dot31-may (7) ---"
npx playwright test e2e/twin-dot31-may.spec.ts --reporter=line 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $L/HQ-e2e-may.log | tail -8
echo "--- thi giac vi ---"
QA_OUT=$L/d3-vi node .qa-dot57/thigiac57.mjs --lang=vi --base=http://localhost:3058 2>&1 | tee $L/HQ-thigiac-vi.log | tail -3
echo "--- thi giac en ---"
QA_OUT=$L/d3-en node .qa-dot57/thigiac57.mjs --lang=en --base=http://localhost:3058 2>&1 | tee $L/HQ-thigiac-en.log | tail -3
echo "--- bbox 34 ---"
QA_OUT=$L/bbox-58 node .qa-dot57/bbox57.mjs --tag=58 --base=http://localhost:3058 2>&1 | tee $L/HQ-bbox.log | tail -3
echo "=== [HQ-server] xong $(date -Iseconds) ==="
