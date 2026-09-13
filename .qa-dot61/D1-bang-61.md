| # | Ca | Giá trị ĐỌC ĐƯỢC | Phán | Ghi chú |
|---|---|---|---|---|
| 1 | /twin: canvas DOM = __soCanvas = 1 | dom 1 / kit 1 | **ĐẠT** |  |
| 2 | /twin: lớp nhãn trùng canvas, tâm nhãn trong canvas | trùng true · 4/4 | **ĐẠT** |  |
| 3 | /twin: CÓ đường đi tới màn Line/Máy — đo theo VAI TRÒ (bấm được + URL đổi) | máy bấm được → /twin/may/14 · trạm bấm được → /twin/may/14 | **ĐẠT** | thước cũ đếm <a href> (cơ chế đã chết sau QĐ-23) ⇒ 0 phán quyết, chỉ ghi 'xem #7' |
| 4 | /twin: chỉ báo kết nối sau 7 s | "Live" | **ĐẠT** |  |
| 5 | /twin 1600: dải hợp nhất không chồng lên nút | chồng 0 | **ĐẠT** |  |
| 6 | /twin: bấm máy 14 ⇒ URL /twin/may/14 | /twin/may/14 | **ĐẠT** |  |
| 7 | /twin ?xem=machine:14 ⇒ ngăn nhúng (lối vào CŨ) | ngăn 0 — redirect → /twin/may/14 | **N/A** | QĐ-23 bỏ lối vào cũ ⇒ N/A CÓ LÝ DO ĐỌC ĐƯỢC (URL redirect), không phải 'không đo' |
| 8 | /twin/line/2: 12/12 máy trong khung | vẽ 12 giấu 0 ngoàiKhung 0 tổng 12 | **ĐẠT** |  |
| 9 | /twin/line/2: lớp nhãn trùng canvas, tâm trong, 0 bị che | trùng true · tâm 12/12 · che 0 | **ĐẠT** |  |
| 10 | /twin/line/2: bấm ô trạm 14 ⇒ URL | /twin/may/14 | **ĐẠT** |  |
| 11 | /twin/line/2: dải trạm 1 hàng, đáy ≤ 900 | đáy 866 · 12 ô | **ĐẠT** |  |
| 12 | /twin/line/2: ?cam= đổi camera THẬT (đọc tư thế camera, không suy từ vị trí nhãn) | (19.2,21.4,27.8) → (10.0,5.0,10.0) · nhãn 0 sau ?cam= | **ĐẠT** | thước cũ suy từ 'vị trí nhãn có đổi không' — ở HEAD `?cam=` cho 0 nhãn ⇒ so 12 với 0 ⇒ 'đổi' kể cả khi trang chết |
| 13 | /twin/line/2: idle ≤ 2 khung/4 s (×2) | 0/0 | **ĐẠT** |  |
| 14 | /twin/may/14 1600: cockpit.h > khoiCanh.h, đáy ≤ 900 | canh 324 · cockpit 427 · đáy 876 | **ĐẠT** |  |
| 15 | /twin/may/14: nhãn 3D · ngăn phải · cockpit · hàng /twin nói MỘT điều (đọc CHỮ) | nhãn3D "Unknown" · ngăn Không rõ · cockpit OFFLINE · hàng /twin "SIM-L2-AOI Unknown 58 days" | **ĐẠT** | thước cũ đọc trang-thai-may@data-trang-thai — Đợt 57 DỜI ⇒ null ⇒ SAI OAN |
| 16 | /twin/may/14: câu TUỔI dữ liệu có mặt và khớp Connected/Disconnected (đọc CHỮ) | "58 days" (cảnh:58 days ngăn:—) · Disconnected | **ĐẠT** | thước cũ đọc ngan-do-tuoi — Đợt 57 DỜI sang viên tin cậy ⇒ null ⇒ SAI OAN |
| 17 | /twin/may/14: Status thô của cockpit không mâu thuẫn Connection | Status "offline" · Disconnected | **ĐẠT** |  |
| 18 | /twin/may/14: tab '3D model' cockpit ⇒ canvas DOM | dom 1 / kit 1 | **ĐẠT** |  |
| 19 | /twin/may/14: ‹Line · Back · F5 · ‹Nhà máy · Back (5 bước) | 5/5: /twin/line/2→/twin/may/14→/twin/may/14→/twin?cam=46.29%2C16.28%2C40.01%2C19.13%2C12.85→/twin/may/14 | **ĐẠT** |  |
| 20 | /twin/may/14: chuỗi thời gian CÂU TUỔI ở 5 mốc — không 'chưa từng báo' giả | 58 days · 58 days · 58 days · 58 days · 58 days | **ĐẠT** | thước cũ: every() trên `doTuoi ?? ""` ⇒ null×5 vẫn ĐẠT — XANH GIẢ (G146) |
| 21 | /twin/may/14: idle theo mốc (khung/2 s tại 5 mốc) ≤ 2 | 0/0/0/0/0 | **ĐẠT** |  |
| 22 | /twin-studio 1600: đáy ≤ 900 | đáy 876 | **ĐẠT** |  |
| 23 | /twin-studio: tab thiết kế 1 canvas = kit | dom 1 / kit 1 | **ĐẠT** |  |
| 24 | deep-link /twin/may/14 (context mới): vỏ app | "Production (MES)" · canvas 1087 ms | **ĐẠT** |  |
| 25 | deep-link /twin/line/2 (context mới): vỏ app | "Production (MES)" | **ĐẠT** |  |
| 26 | deep-link /twin-studio (context mới): vỏ app | "Production (MES)" | **ĐẠT** |  |
| 27 | redirect 14 đường cũ + đối chứng sai TRƯỢT | 14/14 · đối chứng trượt true | **ĐẠT** |  |
| 28 | /twin?pv=line:2&chon=machine:14 ⇒ màn riêng | /twin/may/14 | **ĐẠT** |  |
| 29 | API máy 14: overview.status ↔ cockpit.connected (một hợp đồng) | overview offline · connected false | **ĐẠT** |  |
| 30 | API máy 14: issue offline ageMinutes ≠ 0 | offline:84394′ | **ĐẠT** |  |
| 31 | /factory-command 3D: 1 canvas, nhãn trùng canvas (kit LopNhan NGOÀI twin) | dom 1 · trùng true · nhãn 6 | **ĐẠT** |  |
| 32 | /twin 1280: đáy ≤ 720 | đáy 696 | **ĐẠT** |  |
| 33 | /twin 1280: dải hợp nhất không chồng nút | chồng 0 | **ĐẠT** |  |
| 34 | /twin/line/2 1280: dải trạm đáy ≤ 720, 12 ô MỘT dòng (cao ô ≤ 60) | đáy 696 · 12 ô · cao ô 55 | **ĐẠT** |  |
| 35 | /twin/may/14 1280: cockpit.h > khoiCanh.h, đáy ≤ 720 | canh 280 · cockpit 291 · đáy 696 | **ĐẠT** |  |
| 36 | /twin-studio 1280: đáy ≤ 720 | đáy 696 | **ĐẠT** |  |
| 37 | deep-link /twin/may/14 1280: vỏ app | "Production (MES)" | **ĐẠT** |  |
| 38 | operator1 /twin: màn mở, 0 canvas, không bị chặn cửa | màn 1 · canvas 0 · chặn 0 | **ĐẠT** |  |
| 39 | operator1 /twin/line/2: 0 canvas, không sàn trống | canvas 0 · rỗng 0 | **ĐẠT** |  |
| 40 | operator1 /twin/may/14: lý do ĐÚNG BẢN CHẤT (chuaGanNhaMay) | lyDo chuaGanNhaMay · canvas 0 | **ĐẠT** |  |
| 41 | operator1 /twin-studio: bị chặn (0 quyền sửa) | chặn 1 · màn 0 | **CHẶN-ĐÚNG** |  |
| 42 | user 0 quyền /twin: bị chặn, 0 canvas | chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** |  |
| 43 | user 0 quyền /twin/line/2: bị chặn, 0 canvas | chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** |  |
| 44 | user 0 quyền /twin/may/14: bị chặn, 0 canvas | chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** |  |
| 45 | user 0 quyền /twin-studio: bị chặn, 0 canvas | chặn 1 · màn 0 · canvas 0 | **CHẶN-ĐÚNG** |  |
| 46 | raised: /twin/line/2 máy 14 có nhãn nhận ra được (đọc CHỮ nhãn) | nhãn 14: AOI · Unknown | **ĐẠT** |  |
| 47 | raised: /twin/may/14 ngăn có ≥1 cảnh báo; nút ack ẩn với vai canView | cảnh báo 1 · nút ack 0 | **ĐẠT** |  |
| 48 | raised: /twin bấm máy 14 ⇒ /twin/may/14, ngăn có cảnh báo | /twin/may/14 · cảnh báo 1 | **ĐẠT** |  |

N=48 · {"ĐẠT":42,"N/A":1,"CHẶN-ĐÚNG":5}
Ô KHÔNG có phán quyết: 0
