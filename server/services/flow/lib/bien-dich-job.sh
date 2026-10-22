#!/bin/bash
# ★★ Luồng AI Đợt 8.4 — CHỈ BIÊN DỊCH Structured Text (node `ai.sinh-ma`), chạy TRONG container st-rusty:1.0.7.
# Dẫn xuất từ scripts/ai-eval/ngau-nhien/lib/st/run-job.sh (bộ đo 7.2) — cùng danh sách thư viện chuẩn (mọi tệp trừ
# timers.st; TON/TOF/TP do prelude đồng hồ giả cung cấp) — nhưng KHÁC ở chỗ cốt yếu: `-c` (chỉ sinh mã đối tượng, KHÔNG
# liên kết) và KHÔNG có bước chạy. Mã do model sinh ra không bao giờ được thực thi.
# /w chứa 00-prelude.st + 10-ma.st. Ghi: compile.log compile.rc (đầu ra .o vào /tmp — tmpfs, bỏ khi container chết).
# ★ Đợt 9 (2026-10-22) — CHE_DO=ir: chỉ sinh LLVM IR (`--ir`). Dùng khi `-c` bị giết sớm (137 — RuSTy 1.0.7 phình bộ nhớ vô
#   hạn với nhãn CASE trùng giữa các nhánh viết dạng danh sách; `--ir` báo ngay "duplicate case value in switch", rc 1).
CT=${CT:-60}
cd /w
INC=()
for f in /usr/share/plc/include/*.st; do
  case "$f" in *timers.st) ;; *) INC+=(-i "$f");; esac
done
if [ "${CHE_DO:-c}" = "ir" ]; then
  timeout -k 1 "$CT" plc /w/*.st "${INC[@]}" --ir -o /tmp/ma.ll --error-format clang -O none > compile.log 2>&1
else
  timeout -k 1 "$CT" plc /w/*.st "${INC[@]}" -c -o /tmp/ma.o --error-format clang -O none > compile.log 2>&1
fi
echo $? > compile.rc
exit 0
