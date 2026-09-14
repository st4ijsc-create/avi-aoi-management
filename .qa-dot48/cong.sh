#!/bin/sh
# CỔNG ĐÓNG PHIÊN Đợt 46 — TUẦN TỰ sau khi chuỗi trình duyệt xong. Lọc ANSI (G94). G115: numstat không dòng nhị phân. G101: EOL theo git ls-files. Dùng: sh .qa-dot48/cong.sh > .qa-dot48/cong.log 2>&1
cd /d/SOURCES/_twin_wt || exit 1
D=.qa-dot48
echo "=== HEAD + cây ==="; git log -6 --format='%h %ci %s' | cut -c1-120; echo "--- ts/tsx/json bẩn (trừ knowledge/.qa/test-results) ---"; git status --porcelain -- '*.ts' '*.tsx' '*.json' | grep -vE '^ M knowledge/|^\?\? knowledge/|^\?\? \.qa-|test-results' ; echo "--- cached ---"; git diff --cached --stat | wc -l
echo "--- numstat nhị phân (G115) ---"; git diff --numstat | grep -E '^-[[:space:]]+-' && echo "!! co dong nhi phan" || echo "numstat: 0 dong nhi phan"
echo "--- chưa push? ---"; git log --oneline @{u}..HEAD 2>/dev/null | wc -l; git status -sb | head -1
echo "=== eol tệp đã sửa/tạo (git ls-files --eol) ==="; git ls-files --eol $(git diff --name-only 3c283233 HEAD | grep -v knowledge/)
echo "=== DB đếm ==="; node .qa-dot37/db.mjs dem | tee $D/db-dem-sau.json; echo; echo "   truoc:"; cat $D/db-dem-truoc.json; echo; echo "=== dem34 (6 khoá) ==="; node .qa-dot34/dem.mjs | tee $D/db-dem34-sau.json; echo; cat $D/db-dem34-truoc.json; echo; diff $D/db-dem34-truoc.json $D/db-dem34-sau.json && echo "dem34 KHỚP"
node -e 'const a=JSON.parse(require("fs").readFileSync(".qa-dot48/db-dem-truoc.json","utf8")),b=JSON.parse(require("fs").readFileSync(".qa-dot48/db-dem-sau.json","utf8"));const k=Object.keys(a).filter(x=>x!=="db");const l=k.filter(x=>a[x]!==b[x]);console.log(l.length?"!! LECH: "+l.map(x=>x+" "+a[x]+"->"+b[x]).join(", "):"DB "+k.length+" bang truoc = sau (KHOP)")'
echo "=== user/andon/api-key tạm còn sót? ==="; node .qa-dot37/db.mjs user-ack dem | tr -d '\n'; echo; node .qa-dot36/db.mjs user-tam dem | tr -d '\n'; echo; node .qa-dot32/user-tam.mjs dem; node .qa-dot37/db.mjs andon-tam dem | tr -d '\n'; echo
node .qa-dot41/user-tam.mjs dem mon | tr -d '\n'; echo; node .qa-dot41/user-tam.mjs dem adm | tr -d '\n'; echo; node .qa-dot41/apikey-tam.mjs dem
echo "=== hàng D42 sót trên DB test? ==="; node -e 'const postgres=require("postgres");const fs=require("fs");const url=(fs.readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();const u=new URL(url);u.pathname="/"+u.pathname.slice(1)+"_test";const sql=postgres(u.toString(),{max:1});(async()=>{try{const r=await sql`select (select count(*) from factories where code like ${"D47-%"}) f,(select count(*) from users where username like ${"D47-%"}) u,(select count(*) from robots where code like ${"D47-%"}) r,(select count(*) from twin_toa_nha where ma like ${"D47-%"}) t`;console.log("test DB D47-* sot:",JSON.stringify(r[0]));}finally{await sql.end()}})()'
echo "=== md5 5 ảnh test-results (G65) ==="; md5sum test-results/*.png > $D/md5-anh-sau.txt; diff $D/md5-anh-truoc.txt $D/md5-anh-sau.txt && echo "md5 5/5 KHỚP"; git status --porcelain -- test-results/ | grep -vE 'zz-truoc-loF' | sed 's/^/   test-results: /'
echo "=== dist đang phục vụ ==="; grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' .qa-dot48/dist-kiem/public/index.html; ls -la --time-style=full-iso .qa-dot48/dist-kiem/index.js | awk '{print $6, $7}'
echo "=== server 3048 ==="; sh $D/server.sh stop
echo "=== cổng cấm còn nguyên (3000/3001/3008/5173/8080) ==="; netstat -ano | grep LISTENING | grep -E ':(3000|3001|3008|5173|8080) ' | awk '{print $2, $5}' | sort -u
echo "=== tiến trình của tôi còn? ==="; netstat -ano | grep LISTENING | grep -E ':3048 ' || echo "3048 đã tắt"
echo "=== XONG $(date -Iseconds) ==="; date -Iseconds > $D/cong-XONG.txt
