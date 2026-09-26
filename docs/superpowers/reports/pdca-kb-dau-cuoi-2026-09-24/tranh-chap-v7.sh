#!/bin/sh
# Vòng 7 — đo tranh chấp slot: một lượt DÀI (8000 token, ~36 s) trên :8091 giả lượt lập trình + câu hỏi vận hành đồng thời.
cd D:/SOURCES/avi-aoi-management
curl -s -m 300 http://127.0.0.1:8091/v1/chat/completions -H "Content-Type: application/json" --data-binary @tmp/luot-dai.json -o /dev/null -w "luot-dai: %{time_total}s\n" &
sleep 2
node scripts/ai-eval/kb-dau-cuoi.mjs ${3:-scripts/ai-eval/st4i-giu-lai-lac-de.jsonl} --only $2 --label $1 2>&1 | grep -E "^$2"
wait
