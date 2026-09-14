#!/bin/sh
# ĐỢT 48 — build vào outDir RIÊNG (G120), KHÔNG chạm dist/ (3001/3008 đang phục vụ bundle của dist/). sh .qa-dot48/build.sh <tag>
cd /d/SOURCES/_twin_wt || exit 1
T=.qa-dot48/dist-$1
rm -rf "$T"; mkdir -p "$T"
echo "=== build $1 bat dau $(date -Iseconds) HEAD=$(git rev-parse --short HEAD) ==="
NODE_ENV=production npx vite build --outDir "/d/SOURCES/_twin_wt/$T/public" --emptyOutDir 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -vE '^\s*$' | tail -6
echo "vite exit=$?"
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir="$T" 2>&1 | tail -3
cp server/license/sdk/index.cjs "$T/index.cjs"
node scripts/copy-font-assets.mjs --dest "$T/assets/fonts" 2>&1 | tail -2
node scripts/kiem-vo-app-https.mjs 2>&1 | tail -2
echo "=== build $1 xong $(date -Iseconds) ==="
(cd "$T" && find . -type f \( -path './public/*' -o -name 'index.js' -o -name 'index.cjs' \) | sort | xargs md5sum) > .qa-dot48/md5-dist-$1.txt
echo "md5 dong: $(wc -l < .qa-dot48/md5-dist-$1.txt) · bundle: $(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' $T/public/index.html)"
