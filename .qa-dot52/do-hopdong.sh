#!/bin/sh
# ĐỢT 52 — HỢP ĐỒNG TRẠNG THÁI 6 BỀ MẶT cho MỘT máy tại MỘT thời điểm (khuôn Đợt 34, .qa-dot34/do.mjs).
#   a9 = 3 bề mặt API (factoryCommand.overview · assetCockpit.machineDetail.liveState · factoryCommand.machineDetail)
#   m1 = /twin danh sách · m2 = /twin/line/2 dải trạm+nhãn · m3 = /twin/may/14 chip+ngăn+cockpit  ⇒ 6 bề mặt.
#   ABLATION SỐNG (G105): chèn NHỊP TIM now() cho máy 14 ⇒ cả 6 bề mặt PHẢI đổi; xoá ⇒ trở lại. Hàng tạm có trap.
cd /d/SOURCES/_twin_wt || exit 1
B=http://localhost:3052
HB=""
don() { [ -n "$HB" ] && node .qa-dot37/db.mjs xoa-hb "$HB"; node .qa-dot37/db.mjs dem; }
trap don EXIT INT TERM
echo "=== [hop dong] TRUOC $(date -Iseconds) ==="; node .qa-dot37/db.mjs dem
node .qa-dot34/do.mjs --cases=a9,m1,m2,m3,a1 --tag=../.qa-dot52/hd-truoc --may=14 --base=$B 2>&1 | tail -30
echo "=== [hop dong] CHEN NHIP TIM now() may 14 (hang tam) ==="
node .qa-dot37/db.mjs chen-hb 14 > .qa-dot52/hd-chen-hb.json; cat .qa-dot52/hd-chen-hb.json; echo
HB=$(node -e 'const j=JSON.parse(require("fs").readFileSync(".qa-dot52/hd-chen-hb.json","utf8"));console.log(j.hang?.id ?? j.id ?? "")')
echo "HB=$HB"
node .qa-dot34/do.mjs --cases=a9,m1,m2,m3 --tag=../.qa-dot52/hd-sau-hb --may=14 --base=$B 2>&1 | tail -24
echo "=== [hop dong] XOA hang tam ==="
node .qa-dot37/db.mjs xoa-hb "$HB"; HB=""
node .qa-dot37/db.mjs dem
echo "=== [hop dong] xong $(date -Iseconds) ==="
