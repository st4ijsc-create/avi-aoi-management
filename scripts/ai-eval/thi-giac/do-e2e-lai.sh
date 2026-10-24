#!/bin/bash
# Chạy LẠI phần e2e của cổng (A) — lần 2 (08:39) và lần 3 sau khi sửa KB (0296c7295) (spec 2026-10-24 đọc ảnh §6): lần 1 (08:05) KB 0/3 vì worktree THIẾU tệp tri thức sinh ra (knowledge/chunks.jsonl…
# — .gitignore; KB trả sự kiện error "Knowledge artifacts missing" trước khi trả lời) — lỗi MÔI TRƯỜNG, không phải đường ảnh. Cùng cổng.
cd "$(dirname "$0")/../../.." || exit 1
log() { echo "=== $(date +%T) $*"; }
CHU="do-e2e-lai.sh (phien do-model)"; M35="D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"; O=tmp/thi-giac/e2e-lai; mkdir -p $O
cp /d/SOURCES/avi-aoi-management/.env "$TEMP/do-e2e-lai-$$.env"; printf '\nLLAMA_SERVER_MMPROJ=auto\n' >> "$TEMP/do-e2e-lai-$$.env"; trap 'rm -f "$TEMP/do-e2e-lai-$$.env"' EXIT
node scripts/ai-eval/lib/khoaKhe.mjs giu "$CHU" "do e2e anh" --co-dung tmp/dung-khoa-el-$$ > $O/khoa.log 2>&1 & KHOA=$!; sleep 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ai/start-llama-server.ps1 -EnvFile "$(cygpath -w "$TEMP")\do-e2e-lai-$$.env" -Force -Model Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf > $O/sp.log 2>&1
log "35B auto: rc=$? /props $(curl -s -m 5 http://127.0.0.1:8091/props | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s).modalities))}catch{console.log("?")}})')"
LOG_JSON=1 powershell.exe -NoProfile -ExecutionPolicy Bypass -File tmp/khoi-3013.ps1 -Log "tmp\server-3013-e2elai.log" >/dev/null 2>&1 </dev/null
ok=0; for i in $(seq 1 60); do c=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3013/); [ "$c" = 200 ] && { ok=1; break; }; sleep 5; done; log ":3013 lên=$ok"
curl -s -X POST http://127.0.0.1:3013/api/auth/login -H "Content-Type: application/json" -d @tmp/dang-nhap-do.json -c tmp/audit-ai/ck.txt -o /dev/null -w "=== đăng nhập HTTP %{http_code}\n"
AI_EVAL_BASE=http://127.0.0.1:3013 node scripts/ai-eval/vscode-e2e/tao-token.mjs --cookie tmp/audit-ai/ck.txt --ten do-anh-e2e-lai --so-ngay 1 > $O/token.log 2>&1
id=$(grep -o 'id=[0-9]*' $O/token.log | head -1 | cut -d= -f2); log "token id=$id"
node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt 2>&1 | sed 's/^/=== CỔNG (web): /'
# Tham khảo (không thuộc cổng): đúng hình dạng extension — LOCAL (route vscode, codingMode false) và SERVER (codingMode true).
node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt --chi-kb --ngu-canh '{"route":"vscode"}' 2>&1 | sed 's/^/=== tham khảo vscode-local: /'
node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt --chi-kb --ngu-canh '{"route":"vscode","codingMode":true}' ${id:+--thu-hoi $id} 2>&1 | sed 's/^/=== tham khảo vscode-server: /'
p=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3013 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" | tr -d '\r'); [ -n "$p" ] && powershell.exe -NoProfile -Command "Stop-Process -Id $p -Force"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'scripts/ai-eval/codegen-chay-duoc/doi-model.ps1' -Model '$M35' -GiuKhoa '$CHU'" > $O/ve-nha.log 2>&1; log "về 35B rc=$?"
node scripts/ai-eval/lib/khoaKhe.mjs dung tmp/dung-khoa-el-$$; wait $KHOA 2>/dev/null
echo EXIT=0
