#!/bin/sh
# ĐỢT 48 — CỔNG NGUỒN (chạy TRƯỚC chuỗi trình duyệt, không chồng tải). Lọc ANSI (G94). G108: i18n:check bắt buộc.
cd /d/SOURCES/_twin_wt || exit 1
D=.qa-dot48
echo "=== HEAD ==="; git log -1 --format='%h %ci %s' | cut -c1-120
echo "=== vitest run twin ==="; npx vitest run twin > $D/vitest-twin-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-twin-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-twin-cuoi.txt | head -8
echo "=== vitest run twin3d ==="; npx vitest run client/src/components/twin3d > $D/vitest-twin3d-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-twin3d-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-twin3d-cuoi.txt | head -8
echo "=== vitest server (13 tệp Đợt 40 + Đợt 43 + api/v1 + census) ==="; npx vitest run trangThaiMayTuoi twinTrangThaiPhamVi trangThaiHangLoat naiveTimestampQuaExecute twinTrangThaiBroadcaster factoryCommandAssetCockpitPhamVi phamViTwinCanh assetCockpitService manMay giuDuLieuTruoc dongThoiGian twinBonManApiVaiPhamVi moduleReadsCockpitPhamVi moduleReads.test assets.test lines.test pdmModelReads digitalTwinPhamVi maintenanceAndonPhamVi twinDemVatThePhamVi phamViDocCensus phamViTuyenCensus > $D/vitest-server-cuoi.txt 2>&1; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-server-cuoi.txt; grep -E 'Test Files|Tests |FAIL' $D/vitest-server-cuoi.txt | head -12
echo "=== vitest cong vo app (Dot 43) ==="; npx vitest run scripts/kiem-vo-app-https.test.ts > $D/vitest-cong-vo-cuoi.txt 2>&1; sed -i "s/[[0-9;]*m//g" $D/vitest-cong-vo-cuoi.txt; grep -E "Test Files|Tests |FAIL" $D/vitest-cong-vo-cuoi.txt | head -4
echo "=== node scripts/kiem-vo-app-https.mjs ==="; node scripts/kiem-vo-app-https.mjs | tee $D/kiem-vo-app-https-cuoi.txt | cut -c1-160
echo "=== i18n:check ==="; npm run i18n:check > $D/i18n-check-cuoi.txt 2>&1; echo "exit=$?"; sed 's/\x1b\[[0-9;]*m//g' $D/i18n-check-cuoi.txt | tail -1
echo "=== check (tsc) ==="; npm run check > $D/check-cuoi.txt 2>&1; echo "exit=$?" | tee -a $D/check-cuoi.txt; grep -cE 'error TS' $D/check-cuoi.txt
echo "=== XONG $(date -Iseconds) ==="; date -Iseconds > $D/cong-nguon-XONG.txt
