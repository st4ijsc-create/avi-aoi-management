#!/bin/bash
# Đo DẤU CHÂN 4B in-process trong :3000 THẬT + một lần mã hoá ảnh (mmproj :8091) đồng thời khi 4B thường trú (dieu-phoi 2026-10-25, chọn (b)).
# Chạy SAU khi :3000 chạy bản có hàng rào napServerNgoai (103adb745). Khoá khe suốt đợt; KHÔNG khởi động lại :8091 / :3000.
# Mẫu GPU Process Memory (dedicated + shared) theo tiến trình mỗi ~1 s ⇒ tmp/bo-nho/dau-chan-4b/mau.log.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
O=tmp/bo-nho/dau-chan-4b; rm -rf $O; mkdir -p $O
BASE=${BASE:-http://127.0.0.1:3000}
PID3000=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1).OwningProcess" | tr -d '\r')
PID8091=$(powershell.exe -NoProfile -Command "(Get-Process llama-server | Select-Object -First 1).Id" | tr -d '\r')
mau() { powershell.exe -NoProfile -Command "(Get-Counter '\GPU Process Memory(pid_${PID3000}*)\Dedicated Usage','\GPU Process Memory(pid_${PID8091}*)\Dedicated Usage','\GPU Process Memory(pid_${PID8091}*)\Shared Usage').CounterSamples | % { (\$_.InstanceName -replace '_luid.*','') + ':' + \$_.Path.Split('\')[-1].Split(' ')[0] + '=' + [math]::Round(\$_.CookedValue/1MB) }" | tr -d '\r' | tr '\n' ' '; }
rm -f tmp/dung-khoa-dc; node scripts/ai-eval/lib/khoaKhe.mjs giu "do-dau-chan-4b-3000 (phien do-model)" "dau chan 4B :3000 + mmproj dong thoi" --co-dung tmp/dung-khoa-dc > $O/khoa.log 2>&1 & K=$!; sleep 2
( while [ ! -f $O/dung ]; do echo "$(date +%T) card=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | tr -d '\r ') $(mau)"; sleep 1; done > $O/mau.log ) & M=$!
log ":3000 pid=$PID3000 · :8091 pid=$PID8091 · nền: $(tail -1 $O/mau.log)"
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d @tmp/dang-nhap-do.json -c $O/ck.txt -o /dev/null -w "=== đăng nhập HTTP %{http_code}\n"
AI_EVAL_BASE=$BASE node scripts/ai-eval/vscode-e2e/tao-token.mjs --cookie $O/ck.txt --ten do-dau-chan-4b --so-ngay 1 > $O/token.log 2>&1
ID=$(grep -o 'id=[0-9]*' $O/token.log | head -1 | cut -d= -f2); TOK=$(grep AI_EVAL_TOKEN tmp/vscode-e2e/token.env | cut -d= -f2); log "token id=$ID"
sleep 5
# (1) classify ⇒ 4B in-process trong :3000
for i in 1 2 3; do
  r=$(curl -s -m 240 -w " HTTP %{http_code} %{time_total}s" $BASE/v1/chat/completions -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    -d '{"model":"classify","max_tokens":8,"messages":[{"role":"user","content":"Classify: motor overheating. One word: electrical, mechanical, software, other."}]}')
  log "(1.$i) classify: $(echo "$r" | grep -o '"content":"[^"]*"\|HTTP.*')"
done
sleep 10; log "4B thường trú: $(tail -1 $O/mau.log)"
# (2) mã hoá ảnh trên :8091 (35B + mmproj) KHI 4B thường trú — ảnh khổ dài #06 (4.104 token ảnh), qua đường sản phẩm /v1 của :3000
node -e '
const fs=require("fs");const anh="data:image/png;base64,"+fs.readFileSync("scripts/ai-eval/thi-giac/anh/06-ir-editor-dai.png").toString("base64");
fs.writeFileSync(process.argv[1],JSON.stringify({model:"chat",max_tokens:300,chat_template_kwargs:{enable_thinking:false},messages:[{role:"user",content:[{type:"text",text:"Mo ta ngan anh nay."},{type:"image_url",image_url:{url:anh}}]}]}));' $O/anh.json
for i in 1 2; do
  r=$(curl -s -m 240 -w " HTTP %{http_code} %{time_total}s" $BASE/v1/chat/completions -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @$O/anh.json)
  log "(2.$i) anh qua /v1: $(echo "$r" | grep -o 'HTTP.*\|"code":"[^"]*"' | tr '\n' ' ')"
done
sleep 5; touch $O/dung; wait $M
[ -n "$ID" ] && curl -s -X POST $BASE/api/trpc/aiGatewayToken.thuHoi -H "Content-Type: application/json" -b $O/ck.txt -d "{\"json\":{\"id\":$ID}}" -o /dev/null -w "=== thu hồi token $ID HTTP %{http_code}\n"
node -e '
const L=require("fs").readFileSync(process.argv[1],"utf8").trim().split(/\r?\n/);
const so=(l,k)=>{const m=l.match(new RegExp(k+"=([0-9]+)"));return m?+m[1]:null};
const a=process.argv[2],b=process.argv[3];
const ds=L.map(l=>({card:so(l,"card"),d3000:so(l,"pid_"+a+":dedicated"),d8091:so(l,"pid_"+b+":dedicated"),s8091:so(l,"pid_"+b+":shared")}));
const mx=k=>Math.max(...ds.map(x=>x[k]??0)), mn=k=>Math.min(...ds.map(x=>x[k]??1e12));
console.log("=== TÓM TẮT: mẫu",ds.length,"· card max",mx("card"),"MiB / 32607 · :3000 dedicated đầu",ds[0].d3000,"max",mx("d3000"),"· :8091 dedicated min",mn("d8091"),"max",mx("d8091"),"· :8091 shared max",mx("s8091"));
' $O/mau.log $PID3000 $PID8091
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-dc; wait $K
echo EXIT=0
