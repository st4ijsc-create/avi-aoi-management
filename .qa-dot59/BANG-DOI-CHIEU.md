| # | Ca | `do32` (đóng băng) trên HEAD | `do59` trên HEAD | `do59` trên NỀN | Khác? |
|---|---|---|---|---|---|
| 1 | /twin: canvas DOM = __soCanvas = 1 | ĐẠT — dom 1 / kit 1 | **ĐẠT** — dom 1 / kit 1 | ĐẠT |  |
| 2 | /twin: lớp nhãn trùng canvas, tâm nhãn trong canvas | ĐẠT — trùng true · 4/4 | **ĐẠT** — trùng true · 4/4 | ĐẠT |  |
| 3 | /twin: CÓ đường đi tới màn Line/Máy — đo theo VAI TRÒ (bấm được + URL  | KHÔNG CÓ PHÁN QUYẾT — href line 0 · máy 0 | **ĐẠT** — máy bấm được → /twin/may/14 · trạm bấm được → /twi | ĐẠT | **KHÁC** |
| 4 | /twin: chỉ báo kết nối sau 7 s | ĐẠT — "Live" | **ĐẠT** — "Live" | ĐẠT |  |
| 5 | /twin 1600: dải hợp nhất không chồng lên nút | ĐẠT — chồng 0 | **ĐẠT** — chồng 0 | ĐẠT |  |
| 6 | /twin: bấm máy 14 ⇒ URL /twin/may/14 | ĐẠT — /twin/may/14 | **ĐẠT** — /twin/may/14 | ĐẠT |  |
| 7 | /twin ?xem=machine:14 ⇒ ngăn nhúng (lối vào CŨ) | N/A — ngăn nhúng không còn (redirect /twin/may/14) | **N/A** — ngăn 0 — redirect → /twin/may/14 | N/A |  |
| 8 | /twin/line/2: 12/12 máy trong khung | ĐẠT — vẽ 12 giấu 0 ngoàiKhung 0 tổng 12 | **ĐẠT** — vẽ 12 giấu 0 ngoàiKhung 0 tổng 12 | ĐẠT |  |
| 9 | /twin/line/2: lớp nhãn trùng canvas, tâm trong, 0 bị che | ĐẠT — trùng true · tâm 12/12 · che 0 | **ĐẠT** — trùng true · tâm 12/12 · che 0 | ĐẠT |  |
| 10 | /twin/line/2: bấm ô trạm 14 ⇒ URL | ĐẠT — /twin/may/14 | **ĐẠT** — /twin/may/14 | ĐẠT |  |
| 11 | /twin/line/2: dải trạm 1 hàng, đáy ≤ 900 | ĐẠT — đáy 866 · 12 ô | **ĐẠT** — đáy 866 · 12 ô | ĐẠT |  |
| 12 | /twin/line/2: ?cam= đổi camera THẬT (đọc tư thế camera, không suy từ v | ĐẠT — camĐổi true | **ĐẠT** — (19.2,21.4,27.8) → (10.0,5.0,10.0) · nhãn 0 sau ?c | ĐẠT | *cùng phán, khác CƠ SỞ* |
| 13 | /twin/line/2: idle ≤ 2 khung/4 s (×2) | ĐẠT — 0/0 | **ĐẠT** — 0/0 | ĐẠT |  |
| 14 | /twin/may/14 1600: cockpit.h > khoiCanh.h, đáy ≤ 900 | ĐẠT — canh 324 · cockpit 427 · đáy 876 | **ĐẠT** — canh 324 · cockpit 427 · đáy 876 | ĐẠT |  |
| 15 | /twin/may/14: nhãn 3D · ngăn phải · cockpit · hàng /twin nói MỘT điều  | SAI — chip null · header OFFLINE | **ĐẠT** — nhãn3D "Unknown" · ngăn Không rõ · cockpit OFFLINE | ĐẠT | **KHÁC** |
| 16 | /twin/may/14: câu TUỔI dữ liệu có mặt và khớp Connected/Disconnected ( | SAI — "null" · Disconnected | **ĐẠT** — "58 days" (cảnh:58 days ngăn:—) · Disconnected | ĐẠT | **KHÁC** |
| 17 | /twin/may/14: Status thô của cockpit không mâu thuẫn Connection | ĐẠT — Status "offline" · Disconnected | **ĐẠT** — Status "offline" · Disconnected | ĐẠT |  |
| 18 | /twin/may/14: tab '3D model' cockpit ⇒ canvas DOM | ĐẠT — dom 1 / kit 1 | **ĐẠT** — dom 1 / kit 1 | ĐẠT |  |
| 19 | /twin/may/14: ‹Line · Back · F5 · ‹Nhà máy · Back (5 bước) | ĐẠT — 5/5 | **ĐẠT** — 5/5: /twin/line/2→/twin/may/14→/twin/may/14→/twin? | ĐẠT |  |
| 20 | /twin/may/14: chuỗi thời gian CÂU TUỔI ở 5 mốc — không 'chưa từng báo' | ĐẠT — ·  ·  ·  · | **ĐẠT** — 58 days · 58 days · 58 days · 58 days · 58 days | ĐẠT | *cùng phán, khác CƠ SỞ* |
| 21 | /twin/may/14: idle theo mốc (khung/2 s tại 5 mốc) ≤ 2 | ĐẠT — 0/0/0/0/0 | **ĐẠT** — 0/0/0/0/0 | ĐẠT |  |
| 22 | /twin-studio 1600: đáy ≤ 900 | ĐẠT — đáy 876 | **ĐẠT** — đáy 876 | ĐẠT |  |
| 23 | /twin-studio: tab thiết kế 1 canvas = kit | ĐẠT — dom 1 / kit 1 | **ĐẠT** — dom 1 / kit 1 | ĐẠT |  |
| 24 | deep-link /twin/may/14 (context mới): vỏ app | ĐẠT — "Production (MES)" · canvas 1581 ms | **ĐẠT** — "Production (MES)" · canvas 1357 ms | ĐẠT |  |
| 25 | deep-link /twin/line/2 (context mới): vỏ app | ĐẠT — "Production (MES)" | **ĐẠT** — "Production (MES)" | ĐẠT |  |
| 26 | deep-link /twin-studio (context mới): vỏ app | ĐẠT — "Production (MES)" | **ĐẠT** — "Production (MES)" | ĐẠT |  |
| 27 | redirect 14 đường cũ + đối chứng sai TRƯỢT | ĐẠT — 14/14 · đối chứng trượt true | **ĐẠT** — 14/14 · đối chứng trượt true | ĐẠT |  |
| 28 | /twin?pv=line:2&chon=machine:14 ⇒ màn riêng | ĐẠT — /twin/may/14 | **ĐẠT** — /twin/may/14 | ĐẠT |  |
| 29 | API máy 14: overview.status ↔ cockpit.connected (một hợp đồng) | ĐẠT — overview offline · connected false · ts 2026 | **ĐẠT** — overview offline · connected false | ĐẠT |  |
| 30 | API máy 14: issue offline ageMinutes ≠ 0 | ĐẠT — offline:84010′ | **ĐẠT** — offline:83998′ | ĐẠT |  |
| 31 | /factory-command 3D: 1 canvas, nhãn trùng canvas (kit LopNhan NGOÀI tw | ĐẠT — dom 1 · trùng true · nhãn 6 | **ĐẠT** — dom 1 · trùng true · nhãn 6 | ĐẠT |  |
| 32 | /twin 1280: đáy ≤ 720 | ĐẠT — đáy 696 | **ĐẠT** — đáy 696 | ĐẠT |  |
| 33 | /twin 1280: dải hợp nhất không chồng nút | ĐẠT — chồng 0 | **ĐẠT** — chồng 0 | ĐẠT |  |
| 34 | /twin/line/2 1280: dải trạm đáy ≤ 720, 12 ô MỘT dòng (cao ô ≤ 60) | ĐẠT — đáy 696 · 12 ô · cao ô 55 | **ĐẠT** — đáy 696 · 12 ô · cao ô 55 | ĐẠT |  |
| 35 | /twin/may/14 1280: cockpit.h > khoiCanh.h, đáy ≤ 720 | ĐẠT — canh 280 · cockpit 291 · đáy 696 | **ĐẠT** — canh 280 · cockpit 291 · đáy 696 | ĐẠT |  |
| 36 | /twin-studio 1280: đáy ≤ 720 | ĐẠT — đáy 696 | **ĐẠT** — đáy 696 | ĐẠT |  |
| 37 | deep-link /twin/may/14 1280: vỏ app | ĐẠT — "Production (MES)" | **ĐẠT** — "Production (MES)" | ĐẠT |  |
| 38 | operator1 /twin: màn mở, 0 canvas, không bị chặn cửa | ĐẠT — màn 1 · canvas 0 · chặn 0 | **ĐẠT** — màn 1 · canvas 0 · chặn 0 | ĐẠT |  |
| 39 | operator1 /twin/line/2: 0 canvas, không sàn trống | ĐẠT — canvas 0 · rỗng 0 · nhãn 0 | **ĐẠT** — canvas 0 · rỗng 0 | ĐẠT |  |
| 40 | operator1 /twin/may/14: lý do ĐÚNG BẢN CHẤT (chuaGanNhaMay) | ĐẠT — lyDo chuaGanNhaMay · canvas 0 | **ĐẠT** — lyDo chuaGanNhaMay · canvas 0 | ĐẠT |  |
| 41 | operator1 /twin-studio: bị chặn (0 quyền sửa) | CHẶN-ĐÚNG — chặn 1 · màn 0 | **CHẶN-ĐÚNG** — chặn 1 · màn 0 | CHẶN-ĐÚNG |  |
| 42 | user 0 quyền /twin: bị chặn, 0 canvas | CHẶN-ĐÚNG — chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** — chặn 1 · màn 0 · canvas 0 | CHẶN-ĐÚNG |  |
| 43 | user 0 quyền /twin/line/2: bị chặn, 0 canvas | CHẶN-ĐÚNG — chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** — chặn 1 · màn 0 · canvas 0 | CHẶN-ĐÚNG |  |
| 44 | user 0 quyền /twin/may/14: bị chặn, 0 canvas | CHẶN-ĐÚNG — chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** — chặn 1 · màn 0 · canvas 0 | CHẶN-ĐÚNG |  |
| 45 | user 0 quyền /twin-studio: bị chặn, 0 canvas | CHẶN-ĐÚNG — chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** — chặn 1 · màn 0 · canvas 0 | CHẶN-ĐÚNG |  |
| 46 | raised: /twin/line/2 máy 14 có nhãn nhận ra được (đọc CHỮ nhãn) | ĐẠT — nhãn 14: AOI · Unknown · chip — | **ĐẠT** — nhãn 14: AOI · Unknown | ĐẠT |  |
| 47 | raised: /twin/may/14 ngăn có ≥1 cảnh báo; nút ack ẩn với vai canView | ĐẠT — cảnh báo 1 · nút ack 0 · lớp 3D 4 | **ĐẠT** — cảnh báo 1 · nút ack 0 | ĐẠT |  |
| 48 | raised: /twin bấm máy 14 ⇒ /twin/may/14, ngăn có cảnh báo | ĐẠT — /twin/may/14 · cảnh báo 1 | **ĐẠT** — /twin/may/14 · cảnh báo 1 | ĐẠT |  |

### Năm ô mà hai thước không cùng CƠ SỞ

- **#3** — do32 đếm `<a href>` — cơ chế CHẾT sau QĐ-23 ⇒ không ra phán quyết; do59 đo theo VAI TRÒ (bấm được + URL đổi)
- **#12** — cùng ĐẠT nhưng do32 suy từ *vị trí nhãn có đổi không*, mà `?cam=` cho **0 nhãn** ⇒ so 12 với 0 ⇒ ĐẠT kể cả khi trang chết; do59 đọc TƯ THẾ CAMERA thật
- **#15** — do32 đọc `trang-thai-may@data-trang-thai` — Đợt 57 DỜI ⇒ `null` ⇒ **SAI OAN**; do59 đọc 4 nguồn CHỮ
- **#16** — do32 đọc `ngan-do-tuoi` — Đợt 57 DỜI sang viên tin cậy ⇒ `null` ⇒ **SAI OAN**; do59 đọc CÂU tuổi ở bất kỳ đâu
- **#20** — cùng ĐẠT nhưng do32 XANH GIẢ: `doTuoi` **null ×5**, `every(… ?? "")` ⇒ xanh trên TẬP RỖNG (G146); do59 đòi đọc được câu tuổi ở cả 5 mốc, nếu không ⇒ HỎNG
