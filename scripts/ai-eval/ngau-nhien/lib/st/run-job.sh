#!/bin/bash
# Chạy TRONG container st-rusty:1.0.7 (bộ chấm gắn thư mục việc vào /w và gọi `bash /w/run-job.sh`).
# /w chứa các tệp *.st đã đặt tên theo THỨ TỰ biên dịch (00-prelude.st, 10-…, 80-…, 90-…).
# Ghi: compile.log compile.rc run.out run.rc
# Thư viện chuẩn RuSTy nạp TẤT CẢ trừ timers.st — TON/TOF/TP do prelude cung cấp (đồng hồ giả G_NOW, tất định).
CT=${CT:-30}; RT=${RT:-10}
cd /w
INC=()
for f in /usr/share/plc/include/*.st; do
  case "$f" in *timers.st) ;; *) INC+=(-i "$f");; esac
done
SRC=(/w/*.st)
timeout -k 1 "$CT" plc "${SRC[@]}" "${INC[@]}" \
  -o /tmp/prog --linker cc -liec61131std -lm --error-format clang -O none \
  > compile.log 2>&1
echo $? > compile.rc
[ "$(cat compile.rc)" = "0" ] || exit 0
ulimit -f 2048   # chặn tệp ra 2 MB (vòng lặp in vô hạn)
timeout -k 1 "$RT" /tmp/prog > run.out 2>&1
echo $? > run.rc
exit 0
