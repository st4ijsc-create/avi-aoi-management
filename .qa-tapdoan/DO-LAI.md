# KẾ HOẠCH ĐO LẠI SAU VÁ (vòng 2) — mỗi ca phải chuyển SAI→ĐẠT, mỗi đối chứng âm phải GIỮ NGUYÊN

Nguyên tắc: **ca đã SAI phải xanh** VÀ **ca đã CHẶN-ĐÚNG phải vẫn chặn**. Bản vá nới hàng rào thì nặng hơn lỗi nó vá.

## Chuẩn bị (theo đúng khuôn vòng 1)
1. `node .qa-tapdoan/sinh-tap-doan.mjs --kho` rồi `--ghi` (tất định, cùng LCG ⇒ cùng id) · cầu chì 32/32
2. `node .qa-tapdoan/tai-khoan.mjs tao` (7 vai, `Qatd!2026`)
3. `sh .qa-tapdoan/nhip.sh &` (45 s, dưới ngưỡng tươi 60 s — PH-09)
4. Dựng `.qa-tapdoan/dist-<sha mới>` + md5 + xác minh ký hiệu bundle (G120/G141). **KHÔNG dựng vào `dist/`** (cây dùng chung, cổng 3000 đã nạp `dist/index.js` vào bộ nhớ — rebuild một mình ⇒ frontend mới + backend cũ)
5. `sh .qa-tapdoan/server.sh start <sha mới>` cổng 3064

## Ca phải chuyển SAI → ĐẠT
| ca vòng 1 | vá | kỳ vọng vòng 2 |
|---|---|---|
| C1.1 line 249 (QATD-B) qua cây, vai kythuat | PH-12 | tên line thật, `dem-may-line`=15, `dem-tram-line`=15, cảnh có 15 khối |
| C1.4 line 299 (QATD-C **toà T3**) | PH-12 | header "Máy 10 · Trạm 10" **và cảnh 10 khối** (vòng 1: 0 khối) |
| C2.1 `/twin/may/4568` (QATD-B), kythuat | PH-12 | mở được, `ten-may`/`loai-may` đúng DB, 1 canvas |
| C2.4 `/twin/may/5139` (QATD-C toà T3) | PH-12 | KHÔNG còn "chưa có chỗ trên bố cục" (DB có hàng đặt chỗ) |
| C5.1 breadcrumb sau khi mở máy QATD-B | PH-12 | có `ve-man-line`, về đúng line 249 và nhà máy 39 |
| C4a line ngoài phạm vi | PH-13 | câu **khác** câu "chưa xếp chỗ" (lý do `ngoaiPhamVi`) |
| E3 Studio chọn toà 2-4 / tầng 2 | PH-14 | có `chon-toa-nha` + `chon-tang`; chọn tầng 2 ⇒ dải sức khoẻ đếm theo tầng đó |
| E6 quanly (canEdit, 0 canCreate) | PH-15 | **KHÔNG** thấy `nut-mo-sinh` và nút "Create building" (ẩn, không disable) |
| PH-23 md5 cây phân cấp theo 5 vai | PH-23 | **5 md5 KHÁC NHAU**; người 0 gán nhận cây rỗng |
| PH-24 thời gian tải | PH-23 | vai không-admin về ~1,2 s (vòng 1: p50 2.615 ms, 48/48 > 2.500) |

## Đối chứng âm PHẢI GIỮ NGUYÊN (nếu đổi ⇒ bản vá phá hàng rào)
| ca | kỳ vọng giữ |
|---|---|
| C4b máy ngoài phạm vi (congnhan → 4568) | vẫn `may-khong-mo-duoc` / `ngoaiPhamVi` |
| C4c 7 lời gọi API ngoài phạm vi | vẫn NOT_FOUND / [] / null, **0 rò** |
| E7 kythuat gọi `sinhTuDong` | vẫn **403** |
| A1 `qatd_khongquyen` vào `/twin` | vẫn bị chặn |
| A2/A3 phạm vi 7 vai | vẫn khớp DB: giamdoc 1108 · quanly 371 · kythuat 780 · congnhan 328 · admin 1150 · khonggan 0 |
| PH-05 hợp đồng trạng thái | vẫn 5/5 rổ khớp DB |

## Ca MỚI do bản vá sinh ra (hazard, phải đo)
| ca | vì sao |
|---|---|
| N1 Studio: đổi tầng khi có thay đổi CHƯA LƯU | agent PH-14 báo `key={tangId}` remount ⇒ **mất im lặng**; nợ mới, chưa có cảnh báo |
| N2 `__soCanvas` sau khi đổi tầng ở Studio | agent suy luận 1→0→1 nhưng **chưa đo live** (RB-4/N-1) |
| N3 chiều cao header `/twin-studio` @1280 | `BoChonNapUI` 3 ô chọn thay 1 ô; docblock đòi header giữ 48 px, `gon` chưa bật |
| N4 chi phí thêm 1 lượt gọi `noiCuaThucThe` mỗi lần mở màn Line/Máy | agent PH-12 chưa đo p50/p90 |
| N5 auto-fit Studio (PH-29) | kiểm khung 3D không còn gần trống; và 3 ca Fit cũ vẫn đo được (agent đã thêm `dayCameraDiXa`) |
| N6 line trải hai toà | `chonNoiTheoDatCho` chọn toà đa số ⇒ toà kia không vẽ; chưa biết ca này có tồn tại không |

## Cổng nền phải giữ
`npm run check` 0 · `i18n:check` 0 · `vitest phamVi` (nền 437, sẽ tăng vì lưới mới) · `vitest twin3d` (nền 2.539 → sau vá 2.617+) · suite e2e twin: so với vòng 1 (79+5 đạt / 8 đỏ) trên **cùng số worker**
