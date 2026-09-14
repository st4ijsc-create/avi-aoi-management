#!/bin/sh
cd /d/SOURCES/_twin_wt || exit 1
D=.qa-dot49
echo "=== vitest twin3d ==="; npx vitest run client/src/components/twin3d > $D/vitest-twin3d-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-twin3d-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-twin3d-cuoi.txt | head -6
echo "=== vitest twin (rong) ==="; npx vitest run twin > $D/vitest-twin-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-twin-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-twin-cuoi.txt | head -6
echo "=== 4 luoi pham vi ==="; npx vitest run twinBonManApiVaiPhamVi factoryCommandAssetCockpitPhamVi digitalTwinPhamVi maintenanceAndonPhamVi > $D/vitest-phamvi-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-phamvi-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-phamvi-cuoi.txt | head -6
echo "=== kiem-vo ==="; npx vitest run scripts/kiem-vo-app-https.test.ts > $D/vitest-kiemvo-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-kiemvo-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-kiemvo-cuoi.txt | head -4
echo "=== i18n:check ==="; npm run i18n:check > $D/i18n-check-cuoi.txt 2>&1; echo "exit=$?"; tail -2 $D/i18n-check-cuoi.txt
echo "=== tsc check ==="; npm run check > $D/check-cuoi.txt 2>&1; echo "exit=$?"
echo "=== kiem-vo-app-https.mjs tren dist-va ==="; node scripts/kiem-vo-app-https.mjs > $D/kiem-vo-cuoi.txt 2>&1; echo "exit=$?"; tail -3 $D/kiem-vo-cuoi.txt
echo "=== R3F 40s x3 man ==="; for m in twin line may; do node $D/nguon-khung49.mjs --man=$m > $D/run-nguon-khung-$m.log 2>&1; tail -2 $D/run-nguon-khung-$m.log; done
echo DONE > $D/06-cong-nguon-XONG.txt
