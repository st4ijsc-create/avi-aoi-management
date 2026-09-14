#!/bin/sh
cd /d/SOURCES/_twin_wt || exit 1
D=.qa-dot52
r(){ n=$1; shift; npx vitest run "$@" > $D/vitest-$n.txt 2>&1; e=$?; sed -i 's/\x1b\[[0-9;]*m//g' $D/vitest-$n.txt; echo "--- $n exit=$e"; grep -E "Test Files|Tests " $D/vitest-$n.txt | tail -2; grep -E "^ *FAIL" $D/vitest-$n.txt | head -5; }
r twin3d client/src/components/twin3d
r phamvi twinBonManApiVaiPhamVi factoryCommandAssetCockpitPhamVi digitalTwinPhamVi maintenanceAndonPhamVi
r kiemvo scripts/kiem-vo-app-https.test.ts
r presence machinePresence
r twincanh server/db/twinCanh
r fleet server/services/fleet server/routers/fleetRouter robot
r census phamViDocCensus phamViTuyenCensus
echo DONE > $D/04-vitest-XONG.txt
