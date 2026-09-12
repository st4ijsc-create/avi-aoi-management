#!/bin/sh
# ĐỢT 52 — build vào outDir TUYỆT ĐỐI ngoài `client/` (vite root = client/ ⇒ --outDir tương đối rơi vào client/, G120).
# KHÔNG chạm dist/ (3000/3001/3008 phiên khác đang phục vụ nó).  sh .qa-dot52/build.sh <tag>
cd /d/SOURCES/_twin_wt || exit 1
T=/d/SOURCES/_twin_wt/.qa-dot52/dist-$1
echo "=== build $1 bat dau $(date -Iseconds) HEAD=$(git rev-parse --short HEAD) ==="
rm -rf "$T"; mkdir -p "$T"
NODE_ENV=production npx vite build --outDir "$T/public" --emptyOutDir 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -vE '^\s*$' | tail -4
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir="$T" 2>&1 | tail -2
cp server/license/sdk/index.cjs "$T/index.cjs"
node scripts/copy-font-assets.mjs --dest "$T/assets/fonts" 2>&1 | tail -1
echo "=== build $1 xong $(date -Iseconds) ==="
(cd "$T" && find . -type f \( -path './public/*' -o -name 'index.js' -o -name 'index.cjs' \) | sort | xargs md5sum) > /d/SOURCES/_twin_wt/.qa-dot52/md5-dist-$1.txt
echo "md5 dong: $(wc -l < /d/SOURCES/_twin_wt/.qa-dot52/md5-dist-$1.txt) · bundle: $(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' $T/public/index.html)"
