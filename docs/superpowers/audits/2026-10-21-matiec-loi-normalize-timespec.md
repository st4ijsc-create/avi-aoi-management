# Lỗi MATIEC/OpenPLC v3: cộng TIME đúng tròn giây cho ra kết quả không chuẩn hoá

Ngày: 2026-10-21 · Phát hiện khi dựng bộ chấm ST bằng MATIEC (`scripts/ai-eval/ngau-nhien/lib/st-matiec/`, commit 43cef3470)
Gửi: người phụ trách bench OpenPLC.

## Tóm tắt

Trình dịch MATIEC đi kèm OpenPLC v3 (bản trong ảnh `avi-openplc-bench:v3`, OpenPLC_v3 @ `b5d41356d`, 2026-04-04)
chuẩn hoá `TIME` bằng phép so **lớn hơn hẳn** thay vì **lớn hơn hoặc bằng**:

```c
/* lib/C/iec_std_lib.h, dòng 179–187 */
static inline void __normalize_timespec (IEC_TIMESPEC *ts) {
  ...
  if( ts->tv_nsec > 1000000000 || (( ts->tv_sec < 0 ) && ( ts->tv_nsec > 0 ))){
    ts->tv_sec++;
    ts->tv_nsec -= 1000000000;
  }
}
```

Tổng nào có phần nano giây **đúng bằng** 1 000 000 000 sẽ không được dồn sang giây: kết quả là `{tv_sec = 0, tv_nsec = 1e9}`
thay vì `{1, 0}`. Phép so `TIME` của MATIEC so `tv_sec` trước, nên giá trị đó **nhỏ hơn** `T#1s`.

## Tái hiện (chương trình 3 dòng)

```iecst
PROGRAM PRG
VAR t : TIME; b : BOOL; c : BOOL; END_VAR
  t := T#993ms + T#7ms;
  b := t >= T#1s;
  c := t = T#1s;
  {{ printf("b=%d c=%d sec=%ld nsec=%ld\n", (int)GetFbVar(B), (int)GetFbVar(C), (long)GetFbVar(T).tv_sec, (long)GetFbVar(T).tv_nsec); }}
END_PROGRAM
CONFIGURATION KT_CFG
 RESOURCE KT_RES ON PLC
  TASK KT_TASK(INTERVAL := T#10ms, PRIORITY := 0);
  PROGRAM KT_INST WITH KT_TASK : PRG;
 END_RESOURCE
END_CONFIGURATION
```

Biên dịch bằng đúng cờ OpenPLC (`iec2c -f -l -p -r -R -a`) + gcc với `lib/C`, chạy một chu kỳ:

```
b=0 c=0 sec=0 nsec=1000000000
```

Kỳ vọng: `b=1 c=1 sec=1 nsec=0`.

## Tác động

- Mọi chương trình OpenPLC **cộng dồn TIME** (đếm giờ chạy, tích phân theo Δt, bộ đếm thời gian tự viết) sai đúng tại các
  biên giây: phép so `>= T#1s` bị trễ một chu kỳ, và có thể lệch tích luỹ.
- `__CURRENT_TIME` của runtime cũng được tăng bằng `__time_add` ⇒ TON/TOF/TP chuẩn đọc một thời điểm không chuẩn hoá
  đúng tại các mốc tròn giây (chưa đo riêng ảnh hưởng lên bộ định thời).
- Trong bộ đo `plc-st-v1`, bài `st-tv6-dem-gio-chay` (đếm giờ chạy bằng Δt 7 ms): lời giải đúng trượt 8/25 test trên MATIEC,
  đạt 25/25 trên RuSTy ⇒ bài bị loại khỏi tập OpenPLC (`lib/st-matiec/tap-openplc.json`).

## Sửa đề xuất (cho bench, nếu dựng lại MATIEC)

Đổi hai phép so trong `__normalize_timespec` thành `>=` / `<=`, hoặc chuẩn hoá bằng chia lấy dư:

```c
if (ts->tv_nsec >= 1000000000 || ...)   /* và đối xứng: ts->tv_nsec <= -1000000000 */
```

Upstream `beremiz/matiec` (`3a41303b`, 2026-09-22, ảnh `st-matiec:local` trên máy) **có cùng lỗi**: `lib/C/iec_std_lib.h:200` vẫn là `ts->tv_nsec > 1000000000` ⇒ đáng báo lên upstream.
