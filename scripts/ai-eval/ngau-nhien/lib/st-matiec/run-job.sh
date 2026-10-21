#!/bin/bash
# Chạy TRONG container st-openplc-matiec (bộ chấm gắn thư mục việc vào /w và gọi `bash /w/run-job.sh`).
# Hai pha biên dịch:
#   A. kiem.st  (prelude + mã ứng viên) với ĐÚNG cờ OpenPLC v3 (`compile_program.sh`: -f -l -p -r -R -a) — mã không qua
#      pha này thì OpenPLC thật cũng không nạp được.
#   B. day-du.st (A + tệp test đã chuyển + CONFIGURATION) thêm -b (test gọi KT_* như CÂU LỆNH — phần mở rộng ngoài chuẩn,
#      CHỈ cho mã của bộ chấm); rồi gcc + chạy MỘT chu kỳ quét (config_run__).
# Ghi: kiem.log kiem.rc compile.log compile.rc gcc.log gcc.rc run.out run.rc
CT=${CT:-30}; RT=${RT:-10}
cd /w
CO="-f -l -p -r -R -a"
mkdir -p /tmp/a /tmp/b /tmp/n
# Mã GỐC (không nới `;`) qua cờ OpenPLC? — chỉ ghi nhận, không chặn.
timeout -k 1 "$CT" iec2c $CO -I /opt/matiec/lib -T /tmp/n /w/kiem-nghiem.st > nghiem.log 2>&1
echo $? > nghiem.rc
timeout -k 1 "$CT" iec2c $CO -I /opt/matiec/lib -T /tmp/a /w/kiem.st > kiem.log 2>&1
echo $? > kiem.rc
[ "$(cat kiem.rc)" = "0" ] || exit 0
timeout -k 1 "$CT" iec2c $CO -b -I /opt/matiec/lib -T /tmp/b /w/day-du.st > compile.log 2>&1
echo $? > compile.rc
[ "$(cat compile.rc)" = "0" ] || exit 0
cp /w/main.c /tmp/b/
( cd /tmp/b && timeout -k 1 "$CT" gcc -w -O0 -I /opt/matiec/lib/C -o /tmp/prog main.c $(ls *.c | grep -v -e "^POUS.c$" -e "^main.c$") -lm ) > gcc.log 2>&1
echo $? > gcc.rc
[ "$(cat gcc.rc)" = "0" ] || exit 0
ulimit -f 2048
timeout -k 1 "$RT" /tmp/prog > run.out 2>&1
echo $? > run.rc
exit 0
