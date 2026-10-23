# SCADA R0 · Kết nối thật — Báo cáo nghiệm thu (Task 12)

Ngày đo: 2026-10-23 (Task 12) và 2026-10-23/24 (Task 12b, sau sửa D1–D3 — mục ngay dưới) · nhánh `feat/scada-r0` (worktree `D:\SOURCES\_scada_wt`) · máy Windows 11, Docker Desktop 29.8.2 (engine linux).
Mọi số dưới đây là **đo bằng đồng hồ thật**; không cổng nào được khai "đạt" mà không có phép đo. Ngưỡng **không nới**.

## Sau sửa D1–D3 (Task 12b, đo 2026-10-23/24)

Sửa ở commit `8c46126a5` (phán quyết T12 D1/D2/D3 trong sổ điều phối). Ngưỡng **không đổi**: poll 1000 ms, `timeoutMs` 800, G1 ≤ 2000,
G2 ≤ 5000, G3 ≤ 5000 mỗi chiều, G4 ≤ 2000.

- **D3 (G1)** — trên ĐƯỜNG POLL, giao dịch QUÁ HẠN huỷ phần còn lại của tick như lỗi mức liên kết (`laLoiHuyTickPoll`, Modbus/SLMP/EIP):
  mọi tag còn lại ⇒ `bad/comm_lost/timeout`, đúng một loạt mỗi đợt. Lỗi thiết bị (exception Modbus, end code SLMP, tag không tồn tại)
  vẫn theo từng tag. S7/MC đọc một lô (`readAllItems`) — quá hạn vốn đã ném cả tick. `tinhDeadlineMs` giữ nguyên.
- **D1 (G2/G3)** — K = 2 tick poll HỎNG liên tiếp (timeout / comm_lost cả tick / mọi tag bad-comm_lost) ⇒ báo `lost` và hạ phiên driver
  để đường nối lại nhanh chạy. Legacy: bộ đếm theo phiên trong `otManager` (`xuLyMatLegacy`); HA: `ConnectionSupervisor.soTickHongDeMat`
  ⇒ `onActiveLost`. Tick tốt xoá bộ đếm; tick của phiên cũ / sau `stopOt` bị bỏ qua.
- **D2 (G4)** — `taoVongPoll` đọc lần đầu NGAY khi subscribe, rồi mỗi `intervalMs`; chốt chống chồng giữ tới khi `doc()` xong.
- **Lưới stub có thêm kiểu rút TREO** (`simDatLoi({treo:true})`: TCP nửa mở, `isConnected()` vẫn true, mọi giao dịch quá hạn sau
  `timeoutMs`, connect chờ tới hạn) — đúng hình đường `docker pause` đã làm đỏ ở Task 12. Lưới chạy 4 tổ hợp: {legacy, HA} × {từ chối, treo}.

### Kết luận sau sửa

| Cổng R0 | Stub legacy (từ chối / treo) | Stub HA (từ chối / treo) | Bench `pause` legacy / HA | Bench `stop` legacy / HA |
|---|---|---|---|---|
| 1. rút ⇒ mọi tag bad ≤ 2000 | 14/14 · 14/14 | 14/14 · **13/14** | 3/3 · 3/3 | 3/3 · 3/3 |
| 2. M10 "lost" ≤ 5000 | 14/14 · 14/14 | 14/14 · **13/14** | 3/3 · 3/3 | 3/3 · 3/3 |
| 3. DB `error` / `connected` ≤ 5000 | 14/14 · 14/14 | 14/14 · **13/14** | 3/3 · 3/3 | 3/3 (⚠ 2 lượt "connected" giả) · 3/3 |
| 4. cắm lại ⇒ tốt ≤ 2000 | 14/14 · 14/14 | 14/14 · 14/14 | 3/3 · 3/3 | 3/3 · 3/3 |
| 5. uncertain OPC UA tới màn | — | — | — | — |

Cổng 5 không bị đụng tới (OPC UA không đi qua mã đã sửa ngoài `vongPoll`); `r0OpcuaUncertain.test.ts` xanh trong lần chạy toàn bộ.

**Đánh giá:** mọi cổng xanh trên bench thật (12/12 lượt) và 55/56 tổ hợp-lượt của lưới stub. Một lượt đỏ duy nhất (lượt 4, HA/treo) bị lệch
ĐỀU +5,0 s ở cả G1, G2, G3 (6895 / 7895 / 7908 ms so với ~1850 / 2880 / 2830 ms các lượt khác) — chưa giải thích được, KHÔNG tái hiện ở 10
lượt sau, kể cả 8 lượt có chẩn đoán (ingest > 300 ms ở 8 lượt, nghẽn vòng sự kiện > 300 ms ở 4 lượt: đều rỗng). Vì vòng poll CHỜ từng lần ingest
(`await onSample`), một lần ghi telemetry/DB treo ~5 s sẽ cho đúng hình này; chưa chứng minh. Không nới ngưỡng.

⚠ **Biên G1 trên đường treo hẹp:** G1 = (chờ tới tick kế: 0–1000 ms) + `timeoutMs` 800 + xử lý ⇒ cận trên ~1,8 s; đo 1816–1888 ms ở
25/28 lượt-treo của lưới (biên 112–184 ms; 2 lượt pha may 877 / 903 ms; 1 lượt lệch +5 s ở trên), bench 981–1703 ms. Cổng "≤ 2 chu kỳ"
trên đường treo chỉ với tới khi `timeoutMs` + thời gian xử lý < poll (ở đây 800 ms + ~60 ms < 1000 ms).

**Chạy toàn bộ sau sửa** (`npx vitest run server/services/ot server/services/scada server/services/interlock server/_core/socket*`, song
song): 124 tệp, 1717 test — 1710 qua, 7 đỏ, tất cả ở `commandDispatcher.dot1b.db.test.ts` với `53300 remaining connection slots…` (tải
của lô song song trên PG `_test` dùng chung); chạy riêng `-c vitest.db.config.ts`: 44/44 xanh. `npm run check` xanh; 6 tệp test đã sửa/thêm
kiểm kiểu riêng bằng tsc: 0 lỗi.

### Lưới stub sau sửa — `r0NghiemThu.db.test.ts` (ms)

13 lượt tuần tự `npx vitest run -c vitest.db.config.ts server/services/scada/r0NghiemThu.db.test.ts` + 1 lượt nằm trong lần chạy toàn bộ
song song ("full"). Lượt 1–6 chưa có chẩn đoán; 7–10 có chẩn đoán ingest > 300 ms; 11–13 và "full" thêm nghẽn vòng sự kiện > 300 ms — rỗng ở mọi lượt có đo. Đỏ in đậm.
Kết quả theo lượt: 16/16, 16/16, 16/16, **13/16**, 16/16, 16/16, 16/16 ×7, full 16/16.

#### legacy / tu-choi
| Lượt | G1 (≤2000) | G2 (≤5000) | G3 mất (≤5000) | G3 có lại (≤5000) | G4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|
| 1 | 325 | 417 | 431 | 1960 | 998 | 937 |
| 2 | 374 | 433 | 427 | 2051 | 1012 | 966 |
| 3 | 187 | 209 | 207 | 2074 | 61 | 27 |
| 4 | 499 | 577 | 545 | 1970 | 1008 | 977 |
| 5 | 330 | 333 | 436 | 1976 | 991 | 930 |
| 6 | 248 | 326 | 319 | 1973 | 1044 | 983 |
| 7 | 437 | 461 | 543 | 1971 | 977 | 937 |
| 8 | 410 | 450 | 528 | 1962 | 1013 | 938 |
| 9 | 20 | 101 | 107 | 1974 | 1003 | 957 |
| 10 | 392 | 481 | 433 | 1969 | 1000 | 933 |
| 11 | 438 | 560 | 544 | 1969 | 971 | 935 |
| 12 | 75 | 67 | 108 | 1973 | 1036 | 999 |
| 13 | 41 | 79 | 107 | 1973 | 1006 | 965 |
| full | 231 | 291 | 296 | 1940 | 1077 | 985 |

#### legacy / treo
| Lượt | G1 (≤2000) | G2 (≤5000) | G3 mất (≤5000) | G3 có lại (≤5000) | G4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|
| 1 | 1820 | 2775 | 2820 | 1980 | 63 | 27 |
| 2 | 877 | 1831 | 1838 | 2081 | 62 | 12 |
| 3 | 1858 | 2884 | 2919 | 1968 | 1264 | 1188 |
| 4 | 1816 | 2891 | 2829 | 1973 | 1251 | 1206 |
| 5 | 1887 | 2884 | 2822 | 1980 | 1254 | 1221 |
| 6 | 1878 | 2903 | 2827 | 1966 | 1246 | 1171 |
| 7 | 1867 | 2877 | 2832 | 1972 | 62 | 26 |
| 8 | 1867 | 2832 | 2894 | 1975 | 1215 | 1165 |
| 9 | 1823 | 2775 | 2822 | 1987 | 77 | 11 |
| 10 | 1869 | 2913 | 2821 | 1964 | 1206 | 1177 |
| 11 | 1857 | 2809 | 2840 | 2053 | 71 | 31 |
| 12 | 1867 | 2881 | 2852 | 1973 | 42 | 10 |
| 13 | 1857 | 2913 | 2825 | 1972 | 1217 | 1165 |
| full | 903 | 1858 | 1918 | 1934 | 1228 | 1183 |

#### HA / tu-choi
| Lượt | G1 (≤2000) | G2 (≤5000) | G3 mất (≤5000) | G3 có lại (≤5000) | G4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|
| 1 | 998 | 1017 | 985 | 1970 | 221 | 168 |
| 2 | 1012 | 1035 | 1098 | 1968 | 203 | 136 |
| 3 | 988 | 1058 | 1088 | 1936 | 1076 | 1000 |
| 4 | 972 | 1037 | 987 | 1967 | 997 | 936 |
| 5 | 998 | 1043 | 1091 | 1975 | 251 | 190 |
| 6 | 1029 | 1049 | 1076 | 1947 | 969 | 903 |
| 7 | 990 | 1084 | 1074 | 1978 | 986 | 919 |
| 8 | 984 | 1029 | 1089 | 1972 | 93 | 41 |
| 9 | 1003 | 1060 | 1091 | 1970 | 222 | 184 |
| 10 | 1014 | 1030 | 1093 | 1964 | 402 | 326 |
| 11 | 1019 | 1037 | 1084 | 1971 | 156 | 103 |
| 12 | 969 | 1028 | 1074 | 1955 | 163 | 123 |
| 13 | 969 | 1013 | 983 | 1966 | 153 | 118 |
| full | 1008 | 1010 | 1084 | 1938 | 780 | 740 |

#### HA / treo
| Lượt | G1 (≤2000) | G2 (≤5000) | G3 mất (≤5000) | G3 có lại (≤5000) | G4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|
| 1 | 1859 | 2863 | 2911 | 1962 | 72 | 32 |
| 2 | 1856 | 2883 | 2837 | 1969 | 77 | 16 |
| 3 | 1834 | 2895 | 2834 | 1977 | 108 | 32 |
| 4 | **6895** | **7895** | **7908** | 1942 | 93 | 16 |
| 5 | 1873 | 2925 | 2826 | 1960 | 61 | 13 |
| 6 | 1853 | 2898 | 2811 | 1972 | 122 | 18 |
| 7 | 1818 | 2770 | 2817 | 1975 | 62 | 16 |
| 8 | 1866 | 2883 | 2817 | 1971 | 62 | 15 |
| 9 | 1827 | 2787 | 2811 | 2073 | 40 | 10 |
| 10 | 1849 | 2896 | 2820 | 1966 | 61 | 9 |
| 11 | 1861 | 2873 | 2829 | 1967 | 71 | 31 |
| 12 | 1837 | 2874 | 2843 | 1968 | 73 | 32 |
| 13 | 1840 | 2871 | 2825 | 1943 | 62 | 12 |
| full | 1888 | 2902 | 2933 | 1971 | 94 | 33 |


Đột biến cấp hệ thống (chạy, hoàn tác): `SO_TICK_HONG_DE_MAT = ∞` ⇒ lưới: **G2 + G3 đỏ ở cả legacy/treo và HA/treo** (không bao giờ
`lost`, G1 vẫn xanh 1839 / 1869 ms nhờ D3), kiểu từ chối vẫn xanh — kiểu rút treo của lưới bắt được D1.

### Bench OpenPLC sau sửa — `scripts/scada-r0-bench.ts`

Cùng bench, cùng cách đo, cùng lệnh như §3 (`pnpm tsx scripts/scada-r0-bench.ts --endpoint tcp://127.0.0.1:15502 --poll 1000 --tags 18
--container avi-openplc-bench --timeout 800 --lap 3`); ảnh `avi-openplc-bench:v3` `sha256:180893084146…`. Ban đầu Exited ⇒ start + Start
qua web; cuối cùng Exited. 12 lượt, 3 mỗi tổ hợp.

| Tổ hợp | G1 bad ≤ 2000 | G2 lost ≤ 5000 | G3a error ≤ 5000 | G3b connected ≤ 5000 | G4 good ≤ 2000 |
|---|---|---|---|---|---|
| pause legacy | 1703 / 981 / 1360 ✓ | 2694 / 1976 / 2360 ✓ | 2680 / 1975 / 2344 ✓ | 1846 / 1853 / 1839 ✓ | 0 / 0 / 0 ✓ |
| pause HA | 1617 / 1670 / 1584 ✓ | 2623 / 2670 / 2587 ✓ | 2607 / 2655 / 2573 ✓ | 1847 / 1828 / 1848 ✓ | 0 / 0 / 0 ✓ |
| stop legacy | 17 / 18 / 19 ✓ | 17 / 18 / 19 ✓ | 6 / 0 / 5 ✓ | 0⚠ / 1553 / 0⚠ ✓ | 929 / 211 / 911 ✓ |
| stop HA | 14 / 21 / 176 ✓ | 14 / 21 / 176 ✓ | 0 / 1 / 174 ✓ | 1571 / 1607 / 1594 ✓ | 712 / 712 / 928 ✓ |

Trước sửa (§3, để so): pause legacy G1 2835/2697/2358 ✗, G2/G3 không bao giờ ✗; pause HA G1 1/3, G2/G3 không bao giờ ✗; stop legacy
G4 2377/1946/1998 (2/3).

Chẩn đoán bench:
- pause: mẫu xấu `bad/comm_lost/timeout`; log `link lost (poll: 2 consecutive failed ticks (timeout))` một lần mỗi lượt (legacy).
  Lệnh ghi DB: `lost` ~2,0–2,7 s sau khi rút; `connected` ~7,0–7,7 s = lần ghi `lost` + 5 s (điều tiết ghi DB 5 s của Task 5) ⇒ 3b
  ~1,85 s sau khi Modbus trả lời. G4 = 0 ms: lần nối lại đang chờ (connect qua proxy cổng tới container bị pause) xong ngay khi unpause
  và lần đọc đầu NGAY (D2) cho tag tốt trước cả lần thăm dò độc lập đầu tiên (thăm dò mỗi 100 ms).
- stop legacy lượt 1 và 3: DB nhận `connected@+5013/5017 ms` khi PLC còn chết (Modbus trả lời ~+8,5 s) — proxy cổng của Docker Desktop
  nhận TCP rồi đóng ⇒ "connected" giả (giới hạn đã biết, xem dưới); 3b vì vậy ghi 0 ⚠.
- Modbus trả lời 5183–5212 ms sau `docker start` (runtime phải bấm Start qua web), 80–89 ms sau `unpause`.

### Giới hạn đã biết (chuyển R1, theo phán quyết T12)

1. **Backoff khi mất lâu:** cổng 4 (≤ 2 chu kỳ sau khi cắm lại) chỉ áp cho đợt mất nằm trong cửa sổ nối lại nhanh (10 lần đầu ≈ 10 s ở
   poll 1000). Mất lâu hơn ⇒ backoff lũy thừa hiện có (legacy `OT_LEGACY_RECONNECT_MS` 5000, trần không đổi) ⇒ có lại trong ≤ ~5 s, không
   phải 2 s (đo ở §2: 4410 / 7467 ms nối lại sau đợt mất 11–18 s).
2. **"Connected" giả qua proxy cổng / gateway:** thiết bị (hoặc proxy cổng Docker Desktop, gateway hết slot) NHẬN TCP rồi đóng ⇒ legacy
   "nối được" rồi rớt, DB có thể ghi `connected` trong lúc thiết bị chết (bench stop legacy 2/3 lượt). `connected` hiện = TCP lên, chưa
   phải "lần đọc tốt đầu tiên". Quy tắc K = 2 (D1) chặn trạng thái giả này trong ~2 tick khi socket nhận-nhưng-không-trả-lời; với
   nhận-rồi-đóng thì watchdog thấy ngắt ngay. R1: chỉ báo `connected` sau lần đọc tốt đầu tiên.
3. **Bản đồ địa chỉ 1-based:** cú pháp tag của sản phẩm là 1-based kiểu Modicon (`holding:1` = thanh ghi 0 = `%QW0`); `holding:0` bị từ
   chối và hiện được phân loại `device_error` chứ không phải `config_error` (minor của T3, hoãn). Bench dùng `holding:1..18`.
4. (mới, T12b) **Thiết bị sống-nhưng-chậm chập chờn:** một thiết bị trả lời chậm hơn `timeoutMs` ở 2 tick liên tiếp bị coi là mất (báo
   `lost`, hạ phiên, nối lại) — giá đã chấp nhận của D1. D3 cũng làm MỘT tag treo (thanh ghi không bao giờ trả lời trên một PLC còn sống)
   làm bad cả adapter trong tick đó (thay hành vi F3 cũ "chỉ tag đó bad").
5. (mới, T12b) **Đường treo với cờ `OT_CHAT_LUONG_V2_ENABLED` TẮT:** không huỷ tick ⇒ Modbus đọc tuần tự 18 × 800 ms; hạn vòng poll 2000 ms
   cắt lần đọc nhưng chốt chống chồng giữ tới khi lần đọc thật xong (~14 s) nên tick hỏng thứ 2 chỉ tới sau ~14 s ⇒ `lost` chậm. (Suy ra
   từ mã, CHƯA đo.) Cấu hình nghiệm thu bật cờ.
6. (mới, T12b) **Nếu connect THÀNH CÔNG trong lúc thiết bị không trả lời** (proxy/gateway nhận TCP), mỗi phiên mới đó phát thêm MỘT loạt
   mẫu xấu (vòng poll mới bắt đầu ngoài đợt lỗi) và chập chờn `lost`↔`connected` mỗi ~2 tick — bad vẫn là bad ở bộ đệm. (Suy ra từ mã;
   stub treo và bench pause không cho connect thành công nên không đo được.)

---

## (Trước sửa — Task 12, giữ làm bằng chứng)

## Kết luận ngắn (trước sửa)

| Cổng R0 | Stub DB (legacy) | Stub DB (HA) | Bench `pause` (TREO) | Bench `stop` (RESET) | OPC UA |
|---|---|---|---|---|---|
| 1. rút ⇒ mọi tag bad ≤ 2 chu kỳ | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (1/6 lượt) | ĐẠT 6/6 | — |
| 2. M10 "mất kết nối" ≤ 5 s | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (không bao giờ) | ĐẠT 6/6 | — |
| 3. `device_adapters.status` khớp ≤ 5 s | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (không bao giờ) | ĐẠT 6/6 (⚠ xem 3.3) | — |
| 4. cắm lại ⇒ tốt ≤ 2 chu kỳ | **KHÔNG ỔN ĐỊNH** (đỏ 10/16 lượt) | sát ngưỡng (đỏ 2/15) | ĐẠT 6/6 | sát ngưỡng (đỏ 1/6) | — |
| 5. uncertain OPC UA tới màn | — | — | — | — | ĐẠT |

**R0 CHƯA đạt nghiệm thu.** Hai lỗi thật của mã các task trước (không phải của thiết bị đo):

1. **Đường TREO (`docker pause` = rút cáp phía PLC khi có switch ở giữa — trường hợp thực tế phổ biến nhất): adapter KHÔNG BAO GIỜ chuyển sang "mất".**
   Socket TCP vẫn mở ⇒ `ModbusDriver.isConnected()` vẫn `true` ⇒ cả watchdog legacy (`otManager.legacyTick`) lẫn supervisor HA
   (`healthTick`: `isConnected()` + `health()`) đều không thấy mất. Vòng poll vẫn phát loạt mẫu `bad/comm_lost/timeout` (cổng 1 có tín
   hiệu) nhưng sự kiện `onTick({ok:false, timeout:true})` chỉ đi vào bộ đếm (`ghiNhanDoc`), không vào trạng thái. ⇒ M10 hiện "connected"
   và DB giữ `connected` trong khi mọi tag xấu. Sở hữu: Task 5 (C1/C3 — trạng thái ở otManager/supervisor) + Task 6 (onTick).
2. **Cổng 4 ≈ thời gian nối lại + MỘT chu kỳ poll đầy đủ**: `taoVongPoll` (Task 2) chỉ đọc lần đầu sau `setInterval` (1000 ms), không đọc
   ngay khi subscribe. Cộng với khoảng nối lại nhanh `max(poll, 500)` (Task 5) và nhịp watchdog legacy 500 ms ⇒ legacy đo
   1956–2262 ms (đỏ 10/16), HA 1246–2205 ms (đỏ 2/15), bench stop 1848–2377 ms. Tách được bằng chẩn đoán "RAM `connected` lại":
   legacy nối lại sau ~770–1010 ms, rồi thêm ~1000–1200 ms tới lần đọc đầu.
3. **Đường TREO, cổng 1**: hạn đọc `tinhDeadlineMs(1000, 800) = max(2×1000, 800+1000) = 2000 ms` tính từ ĐẦU lần đọc kế tiếp; timeout
   từng giao dịch (800 ms) KHÔNG huỷ tick (phán quyết Task 3: timeout giữ theo từng tag). ⇒ bad = (chờ tới tick kế: 0–1000 ms) + 2000 ms;
   chỉ đạt khi lúc rút rơi đúng vào lần đọc đang bay. Sở hữu: Task 3/6 (phán quyết hạn đọc). Với cấu hình `timeoutMs ≤ 800`, cổng
   "≤ 2 chu kỳ" trên đường treo **không với tới được bằng công thức hiện tại**.

Đề xuất sửa (để task sở hữu quyết, KHÔNG làm ở Task 12): (a) N tick timeout liên tiếp ⇒ báo `lost` (hoặc driver tự lật `connected=false`
sau tick bị cắt hạn) — sửa (1); (b) `taoVongPoll` đọc ngay một lần khi bắt đầu — gỡ ~1 chu kỳ khỏi cổng 4; (c) hạn đọc cho đường poll
không vượt quá `poll + timeout` — sửa (3).

---

## 1. Lưới stub có kịch bản trên CSDL `_test` — `server/services/scada/r0NghiemThu.db.test.ts`

Đường chạy thật: otManager (legacy **và** HA — `.env` dev có `OT_CONN_HA_ENABLED=true`) + StubDriver + vòng poll chung + ingest.ts →
bộ đệm (`napTuOt`) + telemetryBus → `ot_telemetry` + `device_adapters.status` + `scadaDiag.danhSach` (tRPC caller, admin qua
`taoNguoiDungTest`). Adapter: poll 1000 ms, 18 tag, `connectionOptions.timeoutMs: 800`. Rút cáp = `simDatLoi({matKetNoi:true})`.
Trước khi rút: liên kết ổn định 11 s. Hỏi bộ đệm mỗi 20 ms, danhSach/DB mỗi 100 ms (số đo là cận trên). Mỗi cổng một `it`.

Số đo (ms) của các lượt chạy tuần tự (`npx vitest run -c vitest.db.config.ts …`), 3 lượt cuối cùng với tệp đã commit:

| Lượt | Nhánh | Cổng 1 (≤2000) | Cổng 2 (≤5000) | Cổng 3 mất (≤5000) | Cổng 3 có lại (≤5000) | Cổng 4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|---|
| A | legacy | 58 | 123 | 111 | 1966 | **2102** | 1011 |
| A | HA | 24 | 33 | 123 | 1951 | 1354 | 247 |
| B | legacy | 255 | 237 | 249 | 2066 | 1089 | 16 |
| B | HA | 1037 | 1060 | 1085 | 1960 | 1433 | 346 |
| C | legacy | 419 | 453 | 530 | 1990 | 1988 | 909 |
| C | HA | 20 | 24 | 108 | 1968 | 1266 | 203 |

Toàn bộ cổng 4 qua mọi lượt hôm nay (kể cả bản trước khi chốt khung thời gian):
- legacy (16 lượt): 1984, 2035, 1971, 2140, 2055, 2013, 1997, 2262, 1956, 2058, 2085, 2017, 2057, 2102, 1089, 1988 — **đỏ 10/16**.
- HA (15 lượt): 1950, 1317, 1975, 1397, 1840, 1246, 1269, 1334, 2129, 1401, 1323, 2205, 1354, 1433, 1266 — đỏ 2/15.
- Cổng 1–3: xanh mọi lượt (cổng 1 ≤ 1037 ms, cổng 2 ≤ 1163 ms, cổng 3 ≤ 2066 ms).

⚠ **Điều tiết ghi DB 5 s** (Task 5): nếu lần ghi trước mới < 5 s, lần ghi `error` bị dời tới mốc 5 s. Đo được khi rút ~2 s sau lần ghi
`connected` lúc khởi động: cổng 3 "mất" = 2684–2896 ms (vẫn ≤ 5 s ở stub vì phát hiện nhanh). Trường hợp xấu nhất = phát hiện + gần 5 s
⇒ có thể vượt 5 s với liên kết chập chờn. Lưới chốt kịch bản "máy chạy ổn định" (11 s trước khi rút); trường hợp xấu nhất chưa có lưới.

## 2. Đột biến cấp hệ thống (Step 4)

| Đột biến (sửa `vi.stubEnv` trong lưới, chạy, hoàn tác) | Cổng đỏ | Số đo |
|---|---|---|
| `OT_CHAT_LUONG_V2_ENABLED=false` | **cổng 1** đỏ ở CẢ hai nhánh (+ cổng 4 do đợt mất kéo dài 18 s ⇒ rơi vào backoff) | cổng 1 = ∞ (tag giữ giá trị good cũ) |
| `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=false` | **cổng 3** đỏ ở CẢ hai nhánh | DB trước khi rút = `disabled`, không bao giờ `error`/`connected` |

Phụ phẩm đáng ghi của đột biến: đợt mất dài ~11–18 s ⇒ legacy nối lại sau 4410 / 7467 ms (quá 10 lần nối nhanh ⇒ backoff lũy thừa
`OT_LEGACY_RECONNECT_MS` 5000). Cổng 4 vì vậy chỉ giữ được với đợt mất < ~10 s ở nhánh legacy; HA nối lại 152 ms trong cùng tình huống.

## 3. Bench OpenPLC — `scripts/scada-r0-bench.ts`

**Bench:** container `avi-openplc-bench`, ảnh `avi-openplc-bench:v3` (`sha256:180893084146519c837b7c54bfdf8a1b6b1174ba739390eac9256b0678ebf2df`,
tạo 2026-10-14), OpenPLC Runtime v3 (git `b5d41356dab4aeadca0dd7ca64ba542f870b595d`, 2026-04-04), Modbus `127.0.0.1:15502`, web
`127.0.0.1:18080`. Trạng thái ban đầu: **Exited** ⇒ `docker start`, runtime "Stopped" ⇒ đăng nhập `openplc/openplc` + Start; cuối cùng
đã `docker stop` trả về Exited. Chương trình nạp: `benchL2` (515787.st) — chỉ khai 3 coil `%QX0.0–0.2`.

**Bản đồ địa chỉ (đã xác nhận trên bench):** FC03 thanh ghi holding 0..17 (`%QW0..%QW17`) trả về 18 giá trị, không exception (giá trị 0
cố định vì chương trình không khai `%QW` — cổng đo chất lượng truyền thông, không đo giá trị). ⚠ Cú pháp tag của sản phẩm là **1-based**
(`modbusDecode.parseModbusAddress`): `holding:0..17` như kế hoạch viết bị TỪ CHỐI ("invalid Modbus register offset: 0" ⇒ mọi tag bad
`device_error`); đúng là `holding:1..18`. Bench dùng `holding:1..18`.

**Cách đo:** trong tiến trình, không DB, không :3000 — otManager THẬT (`startOt`) qua seam `setAdapterSource`, ModbusDriver THẬT,
`timeoutMs: 800`, poll 1000 ms, 18 tag; hai seam thay DB: `setTelemetryPersistFn` và `__datGhiDb` (ghi lại THỜI ĐIỂM lệnh UPDATE
`device_adapters.status`). Cổng 2 = trạng thái RAM `layTrangThaiAdapter` — đúng thứ `scadaDiag.danhSach` hiển thị (RAM đi trước DB).
Rút cáp đo từ lúc lệnh docker TRẢ VỀ (có in cả từ lúc bắt đầu lệnh). Cổng 4 đo từ lúc **Modbus thật sự trả lời lại**: một client thăm
dò riêng (kết nối mới, hạn 500 ms) đọc holding 0..17 mỗi 100 ms; lần thành công đầu tiên là mốc. Pha rút cáp ngẫu nhiên trong chu kỳ poll
(lượt đầu không ngẫu nhiên cho pha cố định ≈ −920 ms ⇒ đã sửa). 3 lượt mỗi tổ hợp:
`pnpm tsx scripts/scada-r0-bench.ts --endpoint tcp://127.0.0.1:15502 --poll 1000 --tags 18 --container avi-openplc-bench --timeout 800 --lap 3`.

### 3.1 `docker pause/unpause` (đường TREO) — nhánh legacy — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 2835 / 2697 / 2358 ms — đạt 0/3 (mẫu `bad/comm_lost/timeout`) |
| 2. M10 "lost" | ≤ 5000 ms | > 15000 / > 15000 / > 15000 — đạt 0/3 |
| 3a. ghi DB `error` sau khi rút | ≤ 5000 ms | > 15000 / > 15000 / > 15000 — đạt 0/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | không có chuyển trạng thái (adapter chưa từng `lost`) |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 795 / 684 / 344 ms — đạt 3/3 |

Pha (mẫu good cuối so với lúc bắt đầu lệnh pause): −93 / −258 / −581 ms ⇒ tick kế tiếp ở +907 / +742 / +419 ms ⇒ bad ≈ tick kế + 2000 ms
(khớp 2835 / 2697 / 2358). Lệnh pause 66–81 ms; Modbus trả lời 85–88 ms sau unpause.

### 3.2 `docker pause/unpause` (đường TREO) — nhánh HA — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 2014 / 2693 / 1774 ms — đạt 1/3 |
| 2. M10 "lost" | ≤ 5000 ms | > 15000 × 3 — đạt 0/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | > 15000 × 3 — đạt 0/3 |
| 3b. ghi DB `connected` | ≤ 5000 ms | không có chuyển trạng thái |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 1004 / 593 / 598 ms — đạt 3/3 |

### 3.3 `docker stop -t 0/start` (đường RESET) — nhánh legacy — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 18 / 24 / 13 ms — đạt 3/3 (mẫu `bad/comm_lost/comm_lost`) |
| 2. M10 "lost" | ≤ 5000 ms | 18 / 24 / 13 ms — đạt 3/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | 1 / 6 / 3 ms — đạt 3/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | 0 ⚠ / 1107 / 1095 ms — đạt 3/3 |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | **2377** / 1946 / 1998 ms — đạt 2/3 |

Lệnh `stop -t 0` 481–1088 ms; Modbus trả lời 5197–5268 ms sau `docker start` (runtime OpenPLC phải bấm Start qua web — script tự làm
sau 3 s); RAM `connected` lại 881–1375 ms sau khi Modbus trả lời.
⚠ **Chập chờn trong lúc thiết bị chết:** proxy cổng của Docker Desktop NHẬN kết nối TCP rồi đóng khi container chưa chạy ⇒ legacy "nối
được" rồi rớt, lặp lại (log `link lost — reconnecting` / `reconnected` ×5); trạng thái RAM nhảy lost↔connected và một lượt ghi DB
`connected` lúc +5013 ms (lần ghi trễ của điều tiết mang trạng thái mới nhất) trong khi PLC còn chết (Modbus trả lời ở ~+8,5 s). PLC thật
với cáp rút sẽ không nhận TCP, nhưng thiết bị/gateway nhận-rồi-đóng (hết slot kết nối) sẽ cho đúng hình này: M10/DB báo "connected" giả.

### 3.4 `docker stop -t 0/start` (đường RESET) — nhánh HA — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 16 / 15 / 12 ms — đạt 3/3 |
| 2. M10 "lost" | ≤ 5000 ms | 16 / 15 / 12 ms — đạt 3/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | 3 / 1 / 3 ms — đạt 3/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | 953 / 940 / 952 ms — đạt 3/3 |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 1898 / 1848 / 1849 ms — đạt 3/3 (biên ~100–150 ms) |

HA không chập chờn (DB: `lost@~0`, `lost@~5010` trễ, `connected@~10020`).

## 4. Cổng 5 — uncertain của OPC UA tới màn — `server/services/scada/r0OpcuaUncertain.test.ts`

OPCUAServer node-opcua trong tiến trình (cổng HĐH cấp, SecurityMode None), biến `U` = 42.5 với StatusCode
`UncertainLastUsableValue`, biến `G` Good. OpcuaDriver.subscribe → `ingestSamples` → telemetryBus thật (chỉ khâu ghi thay bằng
`setTelemetryPersistFn`) → bộ đệm (`napTuOt`) → `scada:subscribe` trên socket giả ⇒ snapshot `["…","u",42.5,"uncertain",…,stale:false,
"device_error"]`; hàng ghi mang `quality:"uncertain"`, `numValue 42.5`, `meta.statusCode` chứa `UncertainLastUsableValue`.
Đối chứng cờ `OT_CHAT_LUONG_V2_ENABLED` tắt ⇒ `bad`, `v:null`. **ĐẠT** (2/2, chạy 3 lần).

## 5. Chạy toàn bộ (Step 7)

- `npx vitest run server/services/ot server/services/scada server/services/interlock server/_core/socket*` (cấu hình mặc định, song
  song): **123 tệp, 1693 test: 1646 qua, 25 đỏ, 22 bỏ qua.** 24/25 đỏ là do TẢI của lô song song trên PG `_test` dùng chung
  (`53300 remaining connection slots…`, `57014 statement timeout`, PKI watcher quá hạn 15 s) — chạy lại riêng: 6 tệp DB
  (`-c vitest.db.config.ts`) 131/131 xanh, `opcuaDriver.secure.sim` + `r0OpcuaUncertain` 18/18 xanh. Đỏ còn lại = cổng 4 legacy của
  `r0NghiemThu.db.test.ts` (2057 ms) — lỗi thật đã nêu.
- `npx vitest run -c vitest.db.config.ts server/services/scada/r0NghiemThu.db.test.ts`: 8 test; 3 lượt cuối: 7/8, 8/8, 8/8.
- `npm run check`: xanh (rc 0). (tsconfig gốc loại `*.test.ts` và `scripts/` — ba tệp mới được kiểm riêng bằng tsc, 0 lỗi.)

## 6. Bàn giao

- Không push. `.env.example` thêm `OT_CHAT_LUONG_V2_ENABLED=false`, `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=false`.
- Trước khi bật cờ ở dev: sửa (1) đường TREO không báo mất và (2) lần đọc đầu sau subscribe — cả hai làm M10 nói sai/ chậm trên thiết bị thật.
