set -e
cd /d/SOURCES/_twin_wt
G=server/services/trangThaiMayTuoiDot54Goc.ts
don() { rm -f "$G" .qa-dot54/trangThaiMayTuoi.build.mjs; echo "--- da xoa $G: $([ -e "$G" ] && echo CON || echo SACH) ---"; git status --porcelain -- server/services | head -3; }
trap don EXIT INT TERM
git show 9f6da8ca:server/services/trangThaiMayTuoi.ts > "$G.tmp54" && mv "$G.tmp54" "$G"
sed 's|server/services/trangThaiMayTuoi.ts|server/services/trangThaiMayTuoiDot54Goc.ts|; s|VAN_HANH_XAP_XI_KET_NOI\]|null]|' .qa-dot54/mapstatus.mjs > .qa-dot54/mapstatus-z.mjs
node .qa-dot54/mapstatus-z.mjs
