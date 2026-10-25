#!/bin/bash
# KIỂM sau khi đổi gán classify / chat.ops / extract → GGUF_DEFAULT_MODEL (35B qua :8091) — dieu-phoi 2026-10-25, phương án (A) tạm thời.
# Mong: mỗi vai qua /v1 :3000 ⇒ HTTP 200, :8091 prompt_tokens_total TĂNG, dedicated của :3000 KHÔNG tăng (4B không nạp). Không đổi gì.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
O=tmp/bo-nho/kiem-doi-gan; mkdir -p $O
BASE=${BASE:-http://127.0.0.1:3000}
PID3000=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1).OwningProcess" | tr -d '\r')
ded() { powershell.exe -NoProfile -Command "[math]::Round(((Get-Counter '\GPU Process Memory(pid_${PID3000}*)\Dedicated Usage').CounterSamples | Measure-Object CookedValue -Sum).Sum/1MB)" | tr -d '\r'; }
tok() { curl -s -m 5 http://127.0.0.1:8091/metrics | grep -E "^llamacpp:prompt_tokens_total " | awk '{print $2}'; }
cat > $O/q.mjs <<'EOF'
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
console.log(JSON.stringify(await sql`select id,"roleId","scopeKind","envKey","profileId",mode,"retiredAt","createdAt" from ai_model_bindings where "roleId" in ('classify','chat.ops','extract') order by "roleId", id`));
await sql.end();
EOF
log "binding: $(node --env-file=/d/SOURCES/avi-aoi-management/.env $O/q.mjs)"
curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d @tmp/dang-nhap-do.json -c $O/ck.txt -o /dev/null -w "=== đăng nhập HTTP %{http_code}\n"
AI_EVAL_BASE=$BASE node scripts/ai-eval/vscode-e2e/tao-token.mjs --cookie $O/ck.txt --ten kiem-doi-gan --so-ngay 1 > $O/token.log 2>&1
ID=$(grep -o 'id=[0-9]*' $O/token.log | head -1 | cut -d= -f2); TOK=$(grep AI_EVAL_TOKEN tmp/vscode-e2e/token.env | cut -d= -f2)
log ":3000 pid $PID3000 dedicated trước: $(ded) MiB · :8091 token trước: $(tok)"
for vai in classify chat.ops extract; do
  case $vai in
    classify) nd="Classify this maintenance ticket into one word (electrical, mechanical, software, other): motor overheating on conveyor L1." ;;
    chat.ops) nd="In one short sentence: what should an operator check first when an AOI machine reports E082 low air pressure?" ;;
    extract) nd="Extract the machine code and error code as JSON {machine, error}: Machine AOI-L1-03 stopped with error E082 at 10:15." ;;
  esac
  t0=$(tok)
  r=$(node -e 'process.stdout.write(JSON.stringify({model:process.argv[1],max_tokens:120,chat_template_kwargs:{enable_thinking:false},messages:[{role:"user",content:process.argv[2]}]}))' "$vai" "$nd" | curl -s -m 180 -w " HTTP %{http_code} %{time_total}s" $BASE/v1/chat/completions -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @-)
  t1=$(tok)
  log "$vai: $(echo "$r" | grep -o '"content":"[^"]*"' | head -1 | cut -c1-120) · $(echo "$r" | grep -o 'HTTP.*') · Δ token :8091 = $((t1 - t0)) · :3000 dedicated $(ded) MiB"
done
[ -n "$ID" ] && curl -s -X POST $BASE/api/trpc/aiGatewayToken.thuHoi -H "Content-Type: application/json" -b $O/ck.txt -d "{\"json\":{\"id\":$ID}}" -o /dev/null -w "=== thu hồi token $ID HTTP %{http_code}\n"
echo EXIT=0
