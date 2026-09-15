# QA LẦN 11 — 3D TWIN THEO KỊCH BẢN TẬP ĐOÀN (2026-09-15)

Chủ đợt: phiên avi-aoi-management-39. Skill: pdca. HEAD đo: `a147fc35` (= fresh/twin = fresh/hang-rao). Bản dựng đo: `.qa-tapdoan/dist-a147fc35` (md5 `.qa-tapdoan/md5-dist-a147fc35.txt`, bundle `index-DxxtO34H.js`). Server đo: cổng **3064** (`sh .qa-tapdoan/server.sh start a147fc35`), `RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000` inline. Cổng 3000 của chủ dự án: KHÔNG chạm.

## 0. Lệnh chủ dự án (rút gọn)

Kiểm toàn bộ dự án đã mới nhất; Playwright test toàn bộ 3D twin (build + view) với kịch bản **1 tập đoàn → 3 công ty → mỗi công ty 4 toà × 7 tầng → tầng 1-2 là xưởng → 3-5 line/xưởng → 8-15 máy khác loại/line**; đứng trên 4 vai **quản lý · kỹ thuật · giám đốc · công nhân** review theo tiêu chí chức năng/nghiệp vụ của vai; báo cáo hoàn chỉnh; gọi agent chuyên môn.

## 1. Dữ liệu

Tiền tố `QATD-`, bộ sinh `.qa-tapdoan/sinh-tap-doan.mjs`, tóm tắt id `.qa-tapdoan/sinh-summary.json`. Tập đoàn `QATD` · công ty `QATD-A/B/C` (`factories.corporateCode='QATD'`) · 12 toà `twin_toa_nha` · 84 tầng `twin_tang` (capSo 1..7) · 24 xưởng (chỉ tầng 1-2, `workshops.tangId`) · line 3-5/xưởng · máy 8-15/line, 24 loại không lặp trong line · `twin_dat_cho` 1 hàng/máy · heartbeat now() (làm tươi bằng `--chi-nhip` mỗi dưới 5 phút trong lúc đo). SIM-FAC (43 máy) và T12-SHOT giữ nguyên = đối chứng dữ liệu cũ.

## 2. Tài khoản

`node .qa-tapdoan/tai-khoan.mjs tao` — mật khẩu chung `Qatd!2026`, 2FA tắt, đăng nhập `POST /api/auth/login {username,password}`.

| tài khoản | vai người | role | phạm vi | quyền chốt (V/C/E/D) | vào /twin | vào /twin-studio | ack | tạo phiếu | sửa bố cục |
|---|---|---|---|---|---|---|---|---|---|
| `qatd_giamdoc` | GIÁM ĐỐC | supervisor | **gán TẬP ĐOÀN QATD** ⇒ thấy A+B+C | analytics_oee V · machine_status V · dashboard_corporate V · andon V | ✅ | ❌ | ❌ | ❌ | ❌ |
| `qatd_quanly` | QUẢN LÝ | supervisor | QATD-A | + machine_control VE · andon VE | ✅ | ✅ | ✅ | ❌ | ✅ |
| `qatd_kythuat` | KỸ THUẬT | engineer | QATD-A + QATD-B | machine_status VCE · machine_control VCE · settings_factory VCED · andon VE | ✅ | ✅ | ✅ | ✅ | ✅ |
| `qatd_congnhan` | CÔNG NHÂN | operator | QATD-C | machine_status V · andon VE | ✅ | ❌ | ✅ | ❌ | ❌ |
| `qatd_admin` | đối chứng bypass | admin | không gán = thấy hết | 0 hàng | ✅ | ✅ | ✅ | ✅ | ✅ |
| `qatd_khonggan` | đối chứng phạm vi | operator | 0 gán | machine_status V | ✅ nhưng RỖNG (`chuaGanNhaMay`) | ❌ | — | — | — |
| `qatd_khongquyen` | đối chứng quyền | user | QATD-A | 0 hàng | ❌ CHẶN-ĐÚNG | ❌ CHẶN-ĐÚNG | — | — | — |

Ghi chú: "giám đốc" không có trong enum vai (8 giá trị) — dựng bằng supervisor chỉ-xem + gán cấp tập đoàn (đường `user_corporate_assignments`, chỉ sống khi `factories.corporateCode` điền — đây là một phép đo).

## 3. Tiêu chí và cách chấm

Kế thừa 5 tiêu chí thực dùng (§14q.31: kết cục gốc · tối ưu · nhanh · đẹp · trực quan) + N-1..N-7 (§15.7.3) + §15 mục 25/26.

Bốn rổ: **ĐẠT · SAI · HỎNG · CHẶN-ĐÚNG** (+ N/A có lý do). Luật L1 fail-closed: ca khai TÊN dữ kiện cần; thiếu ⇒ HỎNG kèm tên. Luật L2 đọc theo NGHĨA (chữ người dùng đọc được), testid chỉ để tìm. "Ô không phán quyết" phải = 0. Mỗi ca lưu THÔ: đề bài · dữ kiện đọc được · kết cục · phán quyết · một câu vì sao ⇒ `.qa-tapdoan/tho/<lo>/<ca>.json` + ảnh PNG.

### 3.1 Ma trận ca (lô × vai)

Lô **A — Cửa vào và phạm vi** (mọi vai): A1 `/twin` mở được hoặc bị chặn đúng kỳ vọng bảng §2; A2 ô chọn nhà máy liệt kê ĐÚNG tập nhà máy được gán (giamdoc 3, quanly 1, kythuat 2, congnhan 1, admin ≥5, khonggan 0 + lý do); A3 `factoryCommand.overview` số máy = kỳ vọng từ DB theo mô hình rời (đếm qua 4 chặng station→line→workshop→factory, lọc isActive) — đối chứng BG-127.

Lô **B — Toà và tầng** (giamdoc, kythuat, congnhan): B1 bộ chọn nạp: 4 toà/nhà máy, 7 tầng/toà; B2 chọn tầng 1 ⇒ `dem-may` = số máy DB của xưởng tầng đó; B3 tầng 2 tương tự; B4 tầng 3 (không xưởng) ⇒ 0 máy + trạng thái rỗng TRUNG THỰC (không spinner); B5 tầng 7; B6 đổi toà 2..4 ⇒ dem-may đổi đúng; B7 `?pv=tapdoan` với giamdoc ⇒ hiện đủ 3 công ty (§15 #26 — chưa bao giờ đo được).

Lô **C — Kết cục gốc: chọn Line → Line 3D, chọn máy → Machine 3D** (mỗi vai trong phạm vi của mình): C1 qua cây phân cấp bung tới line của công ty **B và C** (không phải nhà máy đầu — nghi vấn `TwinLine.tsx:355` lấy cứng `factories[0]`) ⇒ `/twin/line/:id` mở đúng `ten-line`, `dem-may-line` = DB, `dem-tram-line` = DB; C2 `/twin/may/:id` máy của công ty B/C ⇒ `ten-may`, `loai-may` đúng DB, `khoi-canh-may` 1 canvas, không `may-chua-dat-cho`; C3 bấm THẲNG tâm khối máy trên canvas ≥5 máy ở một tầng công ty C (congnhan) ⇒ URL `/twin/may/<đúng id>`; C4 line/máy NGOÀI phạm vi ⇒ `line-khong-mo-duoc`/`may-khong-mo-duoc` (CHẶN-ĐÚNG; API NOT_FOUND, không FORBIDDEN); C5 breadcrumb và nút về màn nhà máy giữ đúng nhà máy đang xem.

Lô **D — Ngăn xử lý và nghiệp vụ vai**: D1 nút hiện/ẩn theo bảng §2 (luật ẨN-KHÔNG-DISABLE): ack (andon E), tạo phiếu (machine_status C), gán KTV (machine_status E), ẩn tạm (machine_control C); D2 kythuat tạo 1 phiếu bảo trì thật cho máy QATD-B (ghi `maintenance_work_orders`, dọn bằng trap); D3 congnhan ack 1 andon `raised` dựng tay (N-5: chèn → badge nổi → ack → khôi phục); D4 quanly thấy "Mở chức năng" → `/corporate-dashboard`, `/oee-dashboard`; congnhan không thấy `/control-plane`; D5 giamdoc: KPI nổi + dải cảnh báo chỉ đọc, 0 nút ghi.

Lô **E — Studio (build)** (kythuat, quanly; đối chứng congnhan, giamdoc bị chặn): E1 vào được đúng bảng; E2 ô chọn nhà máy trong studio = phạm vi; E3 chọn toà 2..4 và tầng 2 để thiết kế (nghi vấn `TwinStudio.tsx:106,125` chỉ phần tử [0]); E4 tab Thiết kế: `__soCanvas`=1, khu chờ xếp chỗ, thư viện asset, minimap, dựng nhà xưởng xem trước; E5 vẽ vùng an toàn → lưu → thấy trong danh sách → xoá (đường ghi thật, trap); E6 quanly: có gizmo (machine_control E) nhưng KHÔNG có nút dựng/sinh (C) — ẩn không disable; E7 sinh tự động chỉ admin: kythuat gọi `twinCanh.sinhTuDong` ⇒ FORBIDDEN (CHẶN-ĐÚNG).

Lô **F — Tối ưu/Nhanh/Đẹp/Trực quan** (kythuat @1600×900 và @1280×720; giamdoc @1600): F1 ms tới `man-*` và tới khung đầu (`__thongKeVe.calls>0`) cho 4 màn deep-link, ≥3 lượt, context mới mỗi lượt ⇒ p50/p90/max (tham chiếu QA10 p90 1.284 ms; dữ liệu lớn hơn, ghi số thật); F2 `__soCanvas`=1 mọi màn; draw calls ≤150, tam giác ≤500k, nhãn DOM ≤30; F3 kéo chuột 40 bước ⇒ FPS ≥30; F4 lệch lớp `lop-nhan-twin3d`/`lop-canh-bao` vs canvas = (0,0,0,0); 0 nhãn/badge ngoài canvas; cặp badge×nhãn 0 px²; F5 ảnh PNG mỗi màn × vai (chủ đợt tự Read ≥8 ảnh); F6 i18n: `/twin` en và zh không lộ dấu tiếng Việt trong nhãn twin; F7 idle 40 s ≤2 khung (1 màn).

Lô **G — Hợp đồng trạng thái**: G1 `dem-may/dem-tuoi/dem-cu/dem-khong-ro/dem-ngung` trên /twin (tầng 1 công ty A) = phân bố `operationStatus` + heartbeat trong DB theo luật 5 phút; G2 ngừng `--chi-nhip` >5 phút ⇒ máy xám (đối chứng dương) — nếu thời gian cho phép.

Lô **H — Hồi quy suite e2e twin có sẵn** trên 3064 với dữ liệu lớn: `npx playwright test --project=chromium-canh-3d` (1 worker) + `--project=chromium` cho `e2e/twin-*.spec.ts`; ghi số worker (G147); đỏ đối chiếu nợ đã biết.

Lô **K — Cổng nền** (không quy oan): `pnpm check`, `i18n:check`, `vitest run twin3d` (nền 109/2.539), `vitest run phamVi` (nền 17/437).

### 3.2 Ablation (phải có ít nhất 2)

AB-1: xoá hàng `user_corporate_assignments` của giamdoc ⇒ A2/B7 phải chuyển 3→0 công ty; chèn lại ⇒ 3. AB-2: `UPDATE factories SET "corporateCode"=NULL WHERE code='QATD-B'` ⇒ giamdoc thấy 2; hoàn nguyên ⇒ 3. AB-3 (N-5): andon raised dựng tay ⇒ badge nổi; xoá ⇒ mất.

## 4. Nợ có sẵn KHÔNG quy oan

QĐ-30 index production · G149 `domains.ts` 8 ô · `twin.replay` STATE_METRICS · 899 khoá i18n mồ côi ngoài twin · `twin-dot31-may` A5 đỏ chặn B1/B2 · 41 cặp nhãn∩khối (chỉ đo) · `/factory-command` 42 máy chồng 1 điểm (G102) · `check:tests` 27 lỗi TS · `npm test` ~97 tệp đỏ · 24+48 chuỗi ≤12 px bị che/cuộn · `hienDoTuoi` mã chết · PH-01 khoá API cứng trong test client (ngoài twin).

## 5. Luật harness

G78 chỉ giết PID của mình · G111 trap EXIT cho mọi hàng tạm (phiếu, andon, vùng an toàn) · G129/130 đường ra từ ENV, ghi tạm rồi mv · G139 số 0 phải kèm đối chứng dương cùng thiết bị · G140 outputDir `.qa-pw-output` · G141 chứng minh bundle bằng ký hiệu · G146 tập rỗng ⇒ HỎNG không ĐẠT · G147 ghi số worker · G150 đọc mã bằng `docMaNguon()`.

Mỗi bước để lại `.qa-tapdoan/<bước>-XONG.txt`. Không im lặng quá 10 phút.
