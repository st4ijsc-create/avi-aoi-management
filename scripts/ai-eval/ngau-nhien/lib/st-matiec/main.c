/* Lối vào chương trình chấm MATIEC: khởi tạo cấu hình, chạy ĐÚNG MỘT chu kỳ quét (tệp test là một PROGRAM tuần tự,
   tự tăng đồng hồ bằng KT_BUOC). Mã thoát = số test trượt (trần 125). */
#include <stdio.h>
#include <stdlib.h>
#include "iec_types_all.h"
TIME __CURRENT_TIME;
BOOL __DEBUG;
long kt_dat, kt_truot;
void config_init__(void);
void config_run__(unsigned long tick);
int main(void) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  config_init__();
  config_run__(0);
  return (int)(kt_truot > 125 ? 125 : kt_truot);
}
