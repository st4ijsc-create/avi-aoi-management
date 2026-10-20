#!/bin/bash
# ★★ Luồng AI Đợt 8.4 — CHỈ BIÊN DỊCH Structured Text (node `ai.sinh-ma`), chạy TRONG container st-rusty:1.0.7.
# Dẫn xuất từ scripts/ai-eval/ngau-nhien/lib/st/run-job.sh (bộ đo 7.2) — cùng danh sách thư viện chuẩn (mọi tệp trừ
# timers.st; TON/TOF/TP do prelude đồng hồ giả cung cấp) — nhưng KHÁC ở chỗ cốt yếu: `-c` (chỉ sinh mã đối tượng, KHÔNG
# liên kết) và KHÔNG có bước chạy. Mã do model sinh ra không bao giờ được thực thi.
# /w chứa 00-prelude.st + 10-ma.st. Ghi: compile.log compile.rc (đầu ra .o vào /tmp — tmpfs, bỏ khi container chết).
CT=${CT:-60}
cd /w
INC=()
for f in /usr/share/plc/include/*.st; do
  case "$f" in *timers.st) ;; *) INC+=(-i "$f");; esac
done
timeout -k 1 "$CT" plc /w/*.st "${INC[@]}" -c -o /tmp/ma.o --error-format clang -O none > compile.log 2>&1
echo $? > compile.rc
exit 0
