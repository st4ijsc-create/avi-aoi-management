# LÔ F — TỐI ƯU · NHANH · ĐẸP · TRỰC QUAN (QA lần 11, kịch bản tập đoàn)

Đo 2026-09-15, server **3064** (PID 19136, dist `a147fc35`, bundle `index-DxxtO34H.js`). **Số worker = 1** (G147): MỘT tiến trình node, MỘT browser, mọi lượt TUẦN TỰ, mỗi lượt MỘT browser context mới (cache HTTP rỗng).
Tài khoản chính `qatd_kythuat` (giao diện **en**); `qatd_admin`/`qatd_giamdoc`/`qatd_congnhan`/`qatd_quanly`/`qatd_khonggan` dùng cho ablation.
Tầng đo = **tầng đông nhất toàn bộ dữ liệu**: QATD-A toà T2 tầng 1 (`tang_id 88`, `toa_nha 54`, `factory 38`) = **68 máy** (`ky-vong-db.json → mayTheoTang`). Deep-link `/twin?nm=38&toa=54&tang=88`.
Thô: `.qa-tapdoan/tho/F/*.json` · ảnh: `.qa-tapdoan/anh/F-*.png` · harness: `.qa-tapdoan/do-F.mjs`, `do-F1b..f.mjs`, `do-F3b.mjs`, `do-F5.mjs`, `do-F5b.mjs`, `do-F7b.mjs`, `lib-F.mjs`.

## 0. Hai phát hiện về THIẾT BỊ ĐO (đọc trước khi tin bất kỳ số nào dưới đây)

**MSA-1 — Playwright headless mặc định KHÔNG dùng GPU.** `chromium.launch()` mặc định cho
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` = **bộ tô mềm chạy trên CPU**.
Thêm `--use-angle=default --enable-gpu --ignore-gpu-blocklist` mới ra
`ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11, D3D11)`.
⇒ Mọi con số FPS của lô này (và, theo cùng cách khởi chạy, của các đợt QA trước) mặc định là số của **CPU**, không phải của card. Chênh lệch đo được: **26,1 FPS (SwiftShader) → 62,1 FPS (RTX 5090)** trên cùng cảnh, cùng thao tác. Lô F báo **cả hai**, và lấy số GPU làm số chính vì đó là thứ người dùng thật gặp.

**MSA-2 — "40 bước kéo" đo tốc độ của HARNESS chứ không của bộ dựng hình.** Bản đo đầu cho 31,5 FPS; nhưng 113 khung / 40 lần di chuột = 2,8 khung mỗi sự kiện ⇒ con số bị chặn trên bởi vòng CDP (~90 ms/bước), không bởi cảnh. Sửa: đo **khoảng giữa hai khung** (Δt) rồi lấy `1000/Δt`. Bảng dưới dùng thước đã sửa.

---

## 1. Bảng ca

| ca | vp | đề bài | SỐ ĐO THẬT | ngưỡng | phán quyết | vì sao |
|---|---|---|---|---|---|---|
| **F1** thời gian tới màn | 1600×900 + 1280×720 | 4 màn deep-link × 3 lượt × 2 vp, context mới mỗi lượt | **48/48 lượt > 2.500 ms.** GPU: p50 **2.615** · p90 **2.858** · max **3.089** ms. SwiftShader: p50 **2.687** · p90 **3.131** · max **3.328** ms | mọi lượt ≤ 2.500 ms | **SAI** (TRUNG BÌNH) | Không lượt nào đạt, ở cả hai vp, cả hai backend GL. Nguyên nhân đã quy trách được (mục 2) và **KHÔNG phải do dựng hình**: đổi SwiftShader→RTX 5090 gần như không đổi số |
| **F1** khung đầu (`__thongKeVe.calls>0`) | cả hai | ms tới khung 3D đầu tiên | GPU p50 **2.643** · p90 **2.907** · max **3.167** ms | — (tham chiếu) | — | Luôn chỉ sau mốc "tới màn" 10–180 ms ⇒ cảnh vẽ ngay khi màn hiện; độ trễ nằm TRƯỚC màn |
| **F1** `may-dang-tai` | cả hai | ms tới khi ô "đang tải" hết | **không màn nào render ô này** trong 24/24 lượt | — | **N/A** | Ô `may-dang-tai` (TwinMay.tsx:734) không xuất hiện trong cửa sổ đo; không có dữ kiện để chấm |
| **F1b** ablation cỡ dữ liệu | 1600×900 | cảnh 41 máy (SIM-FAC) vs 68 máy (QATD), **cùng tài khoản admin** | 41 máy: p50 **1.291** ms · 68 máy: p50 **1.259** ms | chênh phải ≈0 nếu không do cỡ cảnh | **ĐẠT (ablation)** | Cảnh to hơn 66 % mà **không chậm hơn** ⇒ 2,6 s KHÔNG do số máy trong cảnh |
| **F1b** sàn khởi động | 1600×900 | màn KHÔNG-3D `/oee-dashboard` | p50 **1.238** ms | — | — | Sàn khởi động vỏ ứng dụng ≈1,2 s; twin không cộng thêm gì cho admin |
| **F1c** quy trách theo VAI | 1600×900 | CÙNG URL 68 máy, 3 tài khoản XEN KẼ, 4 lượt | admin p50 **1.182** · kythuat p50 **3.154** · giamdoc p50 **3.151** ms (khối = 68 ở cả ba) | — | **SAI được quy trách** | Chênh **~1,97 s** chỉ do TÀI KHOẢN, không do cảnh (cùng 68 khối). Mốc mạng: với vai không-admin, truy vấn twin chỉ **bắt đầu** ở t≈2.711–3.106 ms, tức sau khi lô quyền trả về |
| **F1d** thủ tục nào ăn thời gian | — | gọi RỜI từng thủ tục của lô vỏ vs cả lô | `commandCenter.hierarchy` **1.674 ms** · `permissions.getMyPermissions` 11 ms · `andon.active` 18 ms · `aiInbox.count` 20 ms · `license.systemState` 4 ms · **cả lô 1.890 ms** | — | **SAI được quy trách** | Cả lô ≈ thủ tục chậm nhất. tRPC `httpBatchLink` chỉ trả lô khi thủ tục CUỐI xong ⇒ cổng quyền của màn twin bị `commandCenter.hierarchy` kéo theo |
| **F1e** liều–đáp theo cỡ tenant | — | `commandCenter.hierarchy` ở 6 cỡ phạm vi (0 → 1.150 máy) | 0 máy **1.646** · 328 **1.737** · 371 **1.690** · 780 **1.739** · 1.108 **1.768** · 1.150 **1.664** ms — **440 KB ở CẢ SÁU** | tăng theo cỡ nếu do phạm vi | **ABLATION BÁC BỎ giả thuyết của tôi** | Không tăng theo phạm vi tenant. Đối chứng cùng thiết bị: `factoryCommand.overview` **có** tăng (8→55 ms, 0→389 KB) ⇒ thiết bị đo BIẾT phân biệt |
| **F1f** vì sao hằng số | — | nội dung `commandCenter.hierarchy` theo vai | **450.813 byte GIỐNG HỆT** cho cả 5 vai; `{site:1, factory:5, line:102, station:1.145, machine:1.151}`; nhà máy lộ: SIM-FAC, T12-SHOT, QATD-A/B/C | — | **SAI (CAO) — ngoài twin** | `qatd_khonggan` (**0 gán**) nhận nguyên cây 1.151 máy, trong khi CÙNG phiên `factory.list`→**0** và `factoryCommand.overview`→**0 máy** (đối chứng hai chiều). Thủ tục này **không lọc tenant** ⇒ chi phí của nó là chi phí của CẢ CSDL, nên nó lớn lên 26× cùng dữ liệu tập đoàn |
| **F2** một canvas | cả hai | `window.__soCanvas === 1` (N-1/RB-4) | **1/1 ở 10/10 ca** (DOM cũng 1) | = 1 | **ĐẠT** | 5 cảnh × 2 vp, không ca nào rò canvas thứ hai |
| **F2** draw calls | cả hai | `renderer.info.render.calls` ≤ 150 | twin 68 máy **5** · `?pv=tapdoan` **5** · line 217 **6** · máy 4197 **5** · studio **3** | ≤ 150 | **ĐẠT** (biên 25×) | Đọc hai lần cách 1,5 s, không đổi. Đối chứng thiết bị: số ĐỔI theo cảnh (3/5/6) ⇒ không phải hằng số chết |
| **F2** tam giác | cả hai | ≤ 500.000 | twin 68 máy **15.026** · tập đoàn 9.998 · studio 2.702 · line 1.202 · máy 314 | ≤ 500.000 | **ĐẠT** (biên 33×) | 68 máy ≈ 221 tam giác/máy ⇒ có gộp thực thể |
| **F2** nhãn DOM đồng thời | cả hai | ≤ 30 (N-3) | twin 68 máy **6** @1600 / **4** @1280 · line **12** · máy **1** · studio **0** · badge ≤2 | ≤ 30 | **ĐẠT** | `__demNhan` trên tầng 68 máy: `tong 73 · trần 30 · vẽ 6 · bị giấu 67 · vượt trần 0 · chồng lấn 0` — chính sách "chỉ tên bất thường" giữ nhãn xa trần |
| **F3** FPS khi xoay (**GPU**) | 1600×900 | kéo 40 bước ⇒ ≥30 FPS | 68 máy: Δt p50 **16,1 ms = 62,1 FPS** · p90 22,6 ms = 44,2 FPS · **khung tệ nhất 27,3 ms = 36,6 FPS** | ≥ 30 FPS | **ĐẠT** | Ngay khung CHẬM NHẤT vẫn ≥30. Δt p50 = 16,1 ms ≈ nhịp 60 Hz ⇒ bị chặn bởi vsync, còn dư sức |
| **F3** FPS khi xoay (**GPU**) | 1280×720 | như trên | 68 máy: p50 **17,1 ms = 58,5 FPS** · khung tệ nhất 48,4 ms = 20,7 FPS | ≥ 30 FPS | **ĐẠT** (p50/p90) | p90 41,5 FPS đạt; một khung lẻ 48,4 ms (20,7 FPS) — 1/60 khung |
| **F3** ablation cỡ cảnh | 1600×900 | 68 máy vs 12 máy, cùng thiết bị | 68 máy 16,1 ms · 12 máy **16,4 ms** (15.026 vs 1.022 tam giác) | — | **ĐẠT (ablation)** | Cảnh gấp 15× tam giác **không tốn thêm khung nào** ⇒ 26× dữ liệu không chạm tới FPS |
| **F3** FPS trên **SwiftShader** | 1600×900 | cùng thao tác, bộ tô mềm | 68 máy p50 **38,3 ms = 26,1 FPS** · 12 máy 35,4 ms = 28,2 FPS | ≥ 30 FPS | **SAI** (chỉ ở cấu hình CPU) | Máy khách KHÔNG có GPU (hoặc trình duyệt chặn GPU) tụt dưới 30 FPS. Ghi lại vì đây là cấu hình mặc định của mọi lưới e2e hiện có |
| **F3** đối chứng dương/âm | cả hai | đứng yên phải ≈0 khung | đứng yên 4 s: **0 khung** (4/4 ca) · kéo: 59–90 khung | 0 khi im, >0 khi kéo | **ĐẠT** | Thiết bị đo phân biệt được hai trạng thái ⇒ số "0" không phải canvas chết |
| **F4** lệch lớp phủ vs canvas | cả hai | `lop-nhan-twin3d`, `lop-canh-bao` = (0,0,0,0) | **(0,0,0,0) ở 10/10 lớp đo được** (twin ×2 vp, line ×2 vp đều đủ 2 lớp; màn Máy có `lop-nhan-twin3d` (0,0,0,0)) | (0,0,0,0) | **ĐẠT** | |
| **F4** lớp vắng mặt | cả hai | — | màn **Máy**: không có `lop-canh-bao`; **Studio**: không có cả hai lớp | — | **N/A** | Đúng thiết kế: `LopCanhBao` chỉ được nhập ở `TwinVanHanh`/`TwinLine`/`TwinMay`; Studio không dùng lớp nhãn vận hành |
| **F4** nhãn/badge/chip ngoài canvas | cả hai | 0 | **0/0/0 ở 8/8 ca** | 0 | **ĐẠT** | |
| **F4** cặp `badge-canh-bao-*` × `nhan-may-twin3d` | cả hai | giao = 0 px² | **0 cặp, 0 px² ở 8/8 ca** | 0 px² | **ĐẠT** | Mật độ cao nhất từng đo (68 máy, 73 nhãn ứng viên) vẫn 0 |
| **F4** cặp nhãn × nhãn | cả hai | (thêm) giao = 0 px² | **0 cặp, 0 px²**; `__demNhan.capConChong = 0` | 0 px² | **ĐẠT** | Hai phép đo rời (bbox của tôi + bộ đếm của sản phẩm) cùng ra 0 |
| **F4** tràn ngang | cả hai | body/doc scrollWidth ≤ innerWidth | doc 1600/1600 và 1280/1280 ở **8/8 ca** | không tràn | **ĐẠT** | |
| **F4** chữ bị cắt | 1600×900 | `scrollWidth > clientWidth+1` | **0** ở cả 4 màn | 0 | **ĐẠT** | |
| **F4** chữ bị cắt | **1280×720** | như trên | **14 chuỗi** trong `danh-sach-may`, **tất cả** là mã máy dạng `QATD-A-T2-X1-L1-M03`: `scrollWidth 124 > clientWidth 66` (mất **47 %**); 14/14 có `title` | 0 | **SAI** (TRUNG BÌNH) | Phần CÒN LẠI sau khi cắt là `QATD-A-T…` — **tiền tố dùng chung của mọi máy**; phần phân biệt (`-X1-L1-M03`) nằm ở ĐUÔI và bị cắt mất ⇒ ở 1280 mọi hàng trong danh sách đọc GIỐNG NHAU (ảnh `F-F5-twin-tang-dong-68may-1280.png`). Lỗi này chỉ lộ ra khi mã dài 19 ký tự của kịch bản tập đoàn; ở 42 máy mã cũ (`SIM-L2-AOI`) vừa chỗ |
| **F5** chip "còn N tên bị ẩn" | cả hai | bbox nằm TRONG canvas | 4/4 ca có chip, **0 ca ngoài canvas**; chữ: `abnormal names only · 67 other names hidden` (1600) / `· 69` (1280) / `· 45` (giám đốc) | trong canvas | **ĐẠT** | Số trong chip khớp `__demNhan.biGiau` |
| **F5** màu theo TRẠNG THÁI (danh sách máy) | 1600×900 | đổi màu theo hạng | Cuộn hết 41 bước danh sách ảo hoá (scrollHeight 8.912 / clientHeight 227) ⇒ **5 trạng thái, 5 màu KHÁC NHAU**: running `oklch(.78 .06 180)` · idle `oklch(.65 .02 260)` · down `oklch(.65 .2 25)` · maintenance `oklch(.7 .13 250)` · khong_ro `oklch(.22 .015 260)` + **hoạ tiết gạch chéo + viền** | mỗi hạng một màu | **ĐẠT** | Mã hoá **dư thừa 3 lớp**: màu + hoạ tiết + CHỮ trạng thái ("Running"/"Idle"/"Down/Stopped"/"Maintenance"/"Unknown") ⇒ không phụ thuộc màu |
| **F5** vòng viền sức khoẻ theo hạng | 1600×900 | vòng đổi màu theo hạng | Đầu vào đo được: `twinCanh.sucKhoeMay(tầng 88)` → **371 lời khai**, phân bố hạng `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52`, miền điểm [40, 99] ⇒ **319 lời khai đáng vẽ vòng**, 3 màu (`#dc2626`, `#f59e0b`, `#eab308`). Ảnh cho thấy vòng ĐỎ và HỔ PHÁCH thật trên cảnh | mỗi hạng một màu | **HỎNG** | **DỮ KIỆN THIẾU: `window.__demVien` (hoặc tương đương) phơi bày TẬP VÒNG VIỀN ĐÃ VẼ kèm màu.** Sản phẩm có `__demNhan` và `__demBadge` nhưng **không có bộ đếm nào cho vòng viền sức khoẻ**; cấm đọc pixel canvas (G34) ⇒ không dụng cụ nào chứng minh từng vòng đúng màu theo hạng. Mắt thấy vòng đỏ/hổ phách (ảnh) nhưng mắt không phải phép đo |
| **F5** bảng 2D song song cho lớp phủ màu (§11.5) | cả hai | §11.5 bắt mọi lớp phủ màu 3D phải có bảng xếp hạng 2D | `xepHangSucKhoe()` tồn tại ở `sucKhoeMay.ts:406`, có ≥4 ca kiểm đơn vị, **0 chỗ gọi trong mã sản phẩm** (`grep` toàn `client/src`+`server`+`shared`, loại test). DOM: 0 bảng xếp hạng trên `/twin`, `/twin/line`, `/twin/may` | phải có | **SAI** (THẤP) | Lớp phủ màu ĐÃ giao (`vienSucKhoe` được gọi ở `TwinVanHanh.tsx:1142/3216`, vòng nhìn thấy trên ảnh) nhưng bảng 2D bắt buộc thì KHÔNG. Cùng lớp G5 với PH-16/PH-17 |
| **F5** màn Máy nói hạng bằng chữ | cả hai | — | `suc-khoe-may[data-hang="nguy_kich"]` = "Health 50 % · critical", vòng đế **ĐỎ** thấy rõ trên ảnh | — | **ĐẠT** | Hạng có kênh CHỮ độc lập với màu |
| **F5** ảnh | — | ≥8 ảnh PNG + chủ đợt tự đọc ≥6 | **43 ảnh** `F-*.png`; **8 ảnh tôi tự Read** (mục 4) | ≥8 / ≥6 | **ĐẠT** | |
| **F6** i18n `en` | 1600×900 | không lộ khoá thô, không lộ nhãn Việt | **0 khoá thô**; chuỗi còn dấu: `Công ty A/B`, `Toà 1..4`, `Tầng 1..7`, `Ùn tắc tại trạm NN (QATD)` | 0 | **ĐẠT** | Truy DB: 4/4 nhóm ấy là **NỘI DUNG CSDL** do bộ sinh QA-11 ghi (`factories.name`, `twin_toa_nha.ten`, `twin_tang.ten`, `andon_events.title`) — dữ liệu tenant, KHÔNG được dịch |
| **F6** i18n `zh` | 1600×900 | như trên | **0 khoá thô**; dịch đủ: 集团 › … › 楼层 · 指标 371 台设备 · 运行中/故障停机/维护中/失去连接 · 告警(35) · 仅显示异常设备名称 · 另有 67 个名称未显示; nhãn 3D "故障/停机" | 0 | **ĐẠT** | Cùng 4 nhóm dữ liệu CSDL còn nguyên tiếng Việt — đúng |
| **F6** đối chứng `vi` | 1600×900 | — | 342 dấu (so với 155 ở en/zh), 0 khoá thô | — | **ĐẠT (đối chứng dương)** | Thiết bị đo BIẾT đếm dấu: en/zh 155 vs vi 342 ⇒ số "155" không phải do bộ đếm hỏng |
| **F7** idle 40 s | 1600×900 | ≤2 khung vẽ thêm | **3 khung trong 40 s đầu** (đo 90 s: **4 khung tổng**, tối đa **1 khung/giây**, 4/90 giây có khung) | ≤2 khung/40 s | **ĐẠT** (xem "vì sao") | Mốc khung: 14.122 / 23.287 / 34.105 / 43.335 ms — cách nhau 9,2–10,8 s và khung đầu rơi **60 ms sau** bản tin `twin:trangThai` lúc 14.062 ms ⇒ đây là **vẽ lại vì dữ liệu sống đổi**, không phải vòng vẽ chạy hoang. Bằng chứng chốt: **46,7 s cuối KHÔNG một khung nào** dù 106 bản tin websocket vẫn tới ⇒ frameloop đúng là `demand`. Ngưỡng "≤2/40 s" được hiệu chuẩn trên CSDL 42 máy không có đổi trạng thái sống; **đề nghị chủ đợt hiệu chuẩn lại ngưỡng này**, tôi ghi rõ đây là phán quyết có suy xét của tôi |
| **F7** đối chứng dương | 1600×900 | chạm ⇒ khung tăng | chạm 4 s: **113 khung** | >0 | **ĐẠT** | |

**Tổng: ĐẠT 25 · SAI 7 · HỎNG 1 · CHẶN-ĐÚNG 0 · N/A 2 = 35 ô chấm. Ô chấm không có phán quyết: 0.**
Bảng còn **2 dòng THAM CHIẾU** (F1 "khung đầu" và F1b "sàn khởi động") cố ý ghi `—`: chúng là số nền để đọc các ô khác, không phải ô chấm. Tổng dòng = 37.

**7 ô SAI nhưng chỉ 5 KHUYẾT TẬT RIÊNG BIỆT** (F1 tới màn + F1c + F1d là BA phép đo của CÙNG một khuyết tật, đừng đếm ba lần):
1. **Thời gian tới màn > 2.500 ms ở 48/48 lượt** (F1, quy trách bởi F1c + F1d) — TRUNG BÌNH.
2. **`commandCenter.hierarchy` không lọc tenant** (F1f) — CAO; vừa là gốc của (1), vừa là chuyện rò phạm vi ngoài twin.
3. **Cắt mã máy ở 1280×720 làm mọi hàng đọc giống nhau** (F4) — TRUNG BÌNH.
4. **FPS < 30 trên bộ tô mềm** (F3 SwiftShader) — THẤP với người dùng có GPU, nhưng là cấu hình MẶC ĐỊNH của mọi lưới e2e.
5. **Thiếu bảng xếp hạng 2D mà §11.5 bắt buộc** (F5, `xepHangSucKhoe` 0 chỗ gọi) — THẤP.

**1 HỎNG** = F5 màu vòng viền sức khoẻ, thiếu dữ kiện `window.__demVien`.

---

## 2. F1 — bảng p50/p90/max đầy đủ và chuỗi quy trách

### 2.1 ms tới `man-*` hiện (mỗi ô 3 lượt, context mới mỗi lượt)

| màn | vp | **GPU** p50 / p90 / max | SwiftShader p50 / p90 / max | QA lần 10 (42 máy) |
|---|---|---|---|---|
| `/twin?nm=38&toa=54&tang=88` (68 máy) | 1600×900 | **2.573 / 2.862 / 2.862** | 2.876 / 3.328 / 3.328 | p50 1.169 · p90 1.284 · max 1.300 |
| `/twin/line/217` | 1600×900 | **2.624 / 2.640 / 2.640** | 2.694 / 2.778 / 2.778 | ” |
| `/twin/may/4197` | 1600×900 | **2.586 / 2.676 / 2.676** | 2.649 / 3.164 / 3.164 | ” |
| `/twin-studio` | 1600×900 | **2.589 / 2.615 / 2.615** | 2.603 / 2.780 / 2.780 | ” |
| `/twin?…` (68 máy) | 1280×720 | **2.688 / 2.715 / 2.715** | 2.682 / 2.788 / 2.788 | ” |
| `/twin/line/217` | 1280×720 | **2.858 / 3.089 / 3.089** | 2.691 / 2.885 / 2.885 | ” |
| `/twin/may/4197` | 1280×720 | **2.624 / 2.634 / 2.634** | 2.687 / 3.131 / 3.131 | ” |
| `/twin-studio` | 1280×720 | **2.592 / 2.624 / 2.624** | 2.666 / 2.757 / 2.757 | ” |
| **TỔNG 24 lượt** | — | **p50 2.615 · p90 2.858 · max 3.089** | **p50 2.687 · p90 3.131 · max 3.328** | — |
| **số lượt > 2.500 ms** | — | **24/24** | **24/24** | 0/? |

### 2.2 ms tới khung 3D đầu tiên (`__thongKeVe.calls > 0`), GPU

| màn | 1600×900 p50/p90/max | 1280×720 p50/p90/max |
|---|---|---|
| twin (68 máy) | 2.668 / 2.907 / 2.907 | 2.739 / 2.751 / 2.751 |
| line 217 | 2.641 / 2.653 / 2.653 | 2.971 / 3.167 / 3.167 |
| máy 4197 | 2.643 / 2.684 / 2.684 | 2.636 / 2.646 / 2.646 |
| studio | 2.598 / 2.625 / 2.625 | 2.601 / 2.852 / 2.852 |

Khung đầu luôn chỉ **sau mốc "tới màn" 10–180 ms** ⇒ dựng cảnh 3D gần như không tốn gì; toàn bộ độ trễ nằm TRƯỚC khi màn xuất hiện.

### 2.3 Chuỗi quy trách (5 phép đo nối nhau, mỗi bước loại một giả thuyết)

1. **Không phải cỡ cảnh** — F1b, cùng tài khoản admin: cảnh 41 máy 1.291 ms, cảnh 68 máy **1.259** ms.
2. **Không phải màn twin** — F1b: `/oee-dashboard` (không 3D) 1.238 ms ⇒ sàn khởi động vỏ ≈1,2 s.
3. **Là TÀI KHOẢN** — F1c, cùng URL, xen kẽ 4 lượt: admin **1.182** ms vs kythuat **3.154** ms vs giamdoc **3.151** ms, `khối = 68` ở cả ba. Mốc mạng: với vai không-admin, `twinCanh.danhSachToaNha,…` chỉ **bắt đầu** ở t = 2.711–3.106 ms, ngay sau khi lô `permissions.getMyPermissions,commandCenter.hierarchy,aiInbox.count,andon.active,license.systemState` trả về. Admin bỏ qua cổng quyền ⇒ truy vấn twin bắt đầu ở t = 683–900 ms.
4. **Trong lô, ai ăn thời gian** — F1d, gọi rời: `commandCenter.hierarchy` **1.674 ms**; bốn thủ tục kia 4–20 ms; cả lô **1.890 ms** ≈ thủ tục chậm nhất (tRPC `httpBatchLink` trả lô khi thủ tục cuối xong).
5. **Vì sao thủ tục ấy nặng** — F1e/F1f: nó trả **450.813 byte y hệt nhau cho mọi vai**, kể cả `qatd_khonggan` **0 gán** (`{site:1, factory:5, line:102, station:1.145, machine:1.151}`), trong khi CÙNG phiên `factory.list` → 0 và `factoryCommand.overview` → 0 máy. ⇒ **`commandCenter.hierarchy` không lọc tenant**: chi phí của nó là chi phí của CẢ CSDL, nên nó lớn lên cùng dữ liệu 26× và kéo theo cổng quyền của mọi vai không-admin.

**Ablation đã BÁC BỎ giả thuyết đầu của tôi** ("chậm vì phạm vi người dùng to hơn"): 0 máy cũng 1.646 ms. Đối chứng cùng thiết bị `factoryCommand.overview` **có** tăng theo phạm vi (8 → 55 ms, 0 → 389 KB) ⇒ thiết bị đo biết phân biệt, số "không tăng" là thật.

---

## 3. F2/F3 — bảng tối ưu

| cảnh | vp | `__soCanvas` | draw calls | tam giác | nhãn DOM | badge | khối trong cảnh |
|---|---|---|---|---|---|---|---|
| twin tầng đông (68 máy) | 1600×900 | **1** | **5** | 15.026 | 6 | 2 | **68** (khớp DB) |
| twin tầng đông | 1280×720 | **1** | **5** | 15.026 | 4 | 2 | **68** |
| twin `?pv=tapdoan` | 1600×900 | **1** | **5** | 9.998 | 4 | 1 | 45 |
| twin `?pv=tapdoan` | 1280×720 | **1** | **5** | 9.998 | 4 | 1 | 45 |
| line 217 | cả hai | **1** | **6** | 1.202 | 12 | 1 | 12 |
| máy 4197 | cả hai | **1** | **5** | 314 | 1 | 0 | 2 |
| studio | cả hai | **1** | **3** | 2.702 | 0 | 0 | *(không có bộ đếm)* |
| **ngưỡng** | | **=1** | **≤150** | **≤500.000** | **≤30** | | |

| FPS (Δt giữa hai khung) | backend | p50 | p90 | khung tệ nhất |
|---|---|---|---|---|
| twin 68 máy @1600×900 | **RTX 5090** | **62,1 FPS** (16,1 ms) | 44,2 FPS (22,6 ms) | **36,6 FPS** (27,3 ms) |
| line 12 máy @1600×900 | RTX 5090 | 61,0 FPS (16,4 ms) | 47,4 FPS | 37,7 FPS |
| twin 68 máy @1280×720 | RTX 5090 | 58,5 FPS (17,1 ms) | 41,5 FPS | 20,7 FPS (1 khung lẻ) |
| line 12 máy @1280×720 | RTX 5090 | 61,0 FPS | 46,5 FPS | 41,5 FPS |
| twin 68 máy @1600×900 | SwiftShader (CPU) | **26,1 FPS** (38,3 ms) | 16,2 FPS | 6,3 FPS |
| line 12 máy @1600×900 | SwiftShader (CPU) | 28,2 FPS | 16,6 FPS | 12,7 FPS |

---

## 4. Tám ảnh tôi TỰ ĐỌC (N-7 — số đếm DOM không phải bằng chứng thị giác)

1. **`F-F5-twin-tang-dong-68may-1600.png`** — 68 khối máy xếp 5 hàng trên sàn lưới tối; **vòng viền đế ĐỎ và HỔ PHÁCH hiện rõ** quanh nhiều máy (đúng 3 hạng mà API khai). 6 nhãn trắng + 2 badge hổ phách ◆, **không nhãn nào chạm nhãn nào**. Chip "abnormal names only · 67 other names hidden" nằm gọn dưới đáy canvas. Bảng Metrics ghi "371 machines / Corporate · Công ty A · **Floor**" — **PH-06 tái hiện đúng trên tầng đông nhất**: nhãn nói TẦNG, số nói cả nhà máy (tầng này chỉ 68 máy).
2. **`F-F5-twin-tang-dong-68may-1280.png`** — cùng cảnh ở 1280: danh sách máy bên trái hiện **"QATD-A-T…"** ở MỌI hàng, không hàng nào đọc được mã đầy đủ; chỉ còn cột "Down/Stopped" và "13s" phân biệt. Thanh công cụ rút gọn còn icon (hợp lý). Cảnh 3D, nhãn và vòng viền vẫn sạch, không chồng.
3. **`F-F5-line-217-1600.png`** — 12 máy xếp hàng, **đủ 12 nhãn** `M01 · Idle` … `M12 · Running`, so le hai tầng độ cao nên **không cái nào đè cái nào**. ★ Dải dưới ghi **"Prefix: QATD-A-T1-X1-L1-"** một lần rồi rút nhãn còn `M01..M12` — **đây chính là lời giải cho lỗi cắt chữ ở ca F4**, và nó đã có sẵn trong sản phẩm ở màn khác. Một badge andon hổ phách có cuống chỉ đúng M07. LINE STRIP 12 trạm với WIP từng trạm.
4. **`F-F5-may-4197-1600.png`** — một khối máy sáng giữa cảnh với **vòng đế ĐỎ** khớp viên tin cậy "ICT · Health 50 % · critical · Updated 8s ago" (`data-hang="nguy_kich"`). Một nhãn 3D duy nhất, nằm trong canvas. Ngăn phải: AOI OK 5 / NG 1 / NTF 0 / YIELD 83.33 %, ALARMS (0), nút Acknowledge + Shelve + Create work order.
5. **`F-F6-gpu-twin-zh.png`** — giao diện dịch **đủ** sang Trung: 生产(MES) · 集团 › … › 楼层 · 指标 371 台设备 · 运行中 261 / 故障停机 25 / 维护中 20 / 失去连接 7 · 告警(35) · 设备/层级树 · 仅显示异常设备名称 · 另有 67 个名称未显示. Nhãn 3D cũng dịch ("故障/停机"). Chỉ còn tiếng Việt ở **dữ liệu**: `Công ty A`, `Toà 2`, `Tầng 1`, tiêu đề andon.
6. **`F-F5-twin-pv-tapdoan-giamdoc-1600.png`** — vai giám đốc, `?pv=tapdoan`: breadcrumb chỉ "Corporate › **Công ty A**" (PH-10). Hai mẫu số cạnh nhau như PH-18: Metrics "371 machines" (một công ty) vs "Alarms (**55**)" (cả ba). Nút **Twin Studio biến mất** khỏi thanh công cụ (đúng luật ẨN-KHÔNG-DISABLE cho vai không có quyền). Cảnh 45 máy, vòng đỏ/hổ phách, 5 nhãn + 1 badge, không chồng. ⚠ Dải "2 things to know" ở trạng thái **THU** — câu khai trung thực mà PH-10 khen nằm bên trong, người dùng phải bấm mới thấy.
7. **`F-F5-studio-1600.png`** / **`F-F4-gpu-studio-1280x720.png`** — khung 3D của Studio gần như **TRỐNG** ở cả hai vp: chỉ một mặt sàn lưới mờ nghiêng xa, 45 máy đã xếp chỗ co lại thành vệt chấm mờ (ở 1280 thì gần như không thấy). Minimap góc phải CÓ chấm ⇒ dữ liệu tồn tại, camera không khung hình lấy nội dung của chính nó. Dải "45 machines placed · 326 awaiting placement" (PH-14). Cây bên trái vẫn liệt kê đủ 8 xưởng của 4 toà dù không có ô chọn toà/tầng.
8. **`F-F7b-sau-idle-90s.png`** — sau 90 s không chạm, cảnh **y nguyên**, không mất context, không đen; "Updated 40s ago" và cột tuổi trong danh sách đổi thành "40s" ⇒ trang vẫn sống và vẫn khai tuổi dữ liệu trung thực trong khi chỉ vẽ 4 khung.

---

## 5. Điều kiện nền ảnh hưởng số đo

- `.qa-tapdoan/nhip.sh` chạy suốt đợt: mỗi **45 s** gọi `sinh-tap-doan.mjs --chi-nhip` (một tiến trình node, cập nhật ~1.108 hàng heartbeat + ~1.108 hàng `machine_health_history`). **Không tắt được** — thiếu nó mọi máy chuyển xám sau 5 phút (PH-04) và mọi phép đo màu/trạng thái sẽ sai oan. Ảnh hưởng: nền CPU/DB không bằng 0; các số ms có thể tốt hơn vài % trên máy rảnh. Nó **không** giải thích 2,6 s vì `commandCenter.hierarchy` một mình đã 1,67 s và số đó ổn định qua 18 lần gọi rời rạc trong ~40 phút.
- Không tiến trình Playwright/vitest nào khác chạy song song (1 worker, tuần tự).
- Khung đo F1 chạy hai lần (SwiftShader rồi GPU) — 48 lượt, cùng kết luận.
