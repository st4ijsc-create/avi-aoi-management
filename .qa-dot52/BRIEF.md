# Đợt 52 — QA lần 8: NGHIỆM THU CUỐI Twin 3D (độc lập, không sửa mã)

Bạn là QA ĐỘC LẬP — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác; 3001/3008 đang phục vụ `_twin_wt/dist` — KHÔNG rebuild `dist/`).

**Việc đầu tiên: gọi `Skill pdca`.** Bạn KHÔNG sửa mã sản phẩm, KHÔNG sửa `e2e/`; chỉ ghi vào `.qa-dot52/` và commit thư mục đó bằng pathspec khi xong. Mỗi bước để lại `.qa-dot52/<bước>-XONG.txt`; đừng im lặng > 10′.

Đây là **nghiệm thu cuối**: chấm yêu cầu gốc của chủ sở hữu — *"từ nhà máy chọn Line thì hiển thị Line 3D Twin, chọn vào máy (Cell) thì hiển thị Machine 3D Twin… tối ưu, nhanh, đẹp và trực quan"* — và 6 quyết định QĐ-18/19/21/23/24/25 + QĐ-27.

## 0. Cây + hệ đo (MSA trước — Bước 0 PDCA)
- HEAD kỳ vọng `389fa9b3` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot52/00-head-XONG.txt` + DỪNG.
- Porcelain bẩn sẵn (bỏ qua, KHÔNG sửa): `knowledge/*` (~180, sinh tự động), `.qa-*`, `uploads/aoi-cache/BG87-*`, `test-results/zz-*`. **`.qa-dot47/` có 103 tệp 0 byte — sự cố Đợt 50 (G130), KHÔNG đắp, KHÔNG xoá.**
- Cổng riêng **3052** (cấm 3000/3001/3008/5173/8080/3047…3051). Build outDir **tuyệt đối ngoài `client/`** (`vite.config.ts root: client/`); md5 build lặp khớp (G120); `trap EXIT` tắt server.
- DB dev bất biến: `node .qa-dot37/db.mjs dem` (11 khoá) + `.qa-dot34/dem.mjs` (6 khoá) trước/sau; hàng tạm `trap`. 5 ảnh `test-results/` giữ md5.
- **G130/G133:** trước khi chạy BẤT KỲ harness cũ nào, `grep -n "qa-dot[0-9]\+" <tệp>` xem nó ghi vào đâu; hàng rào `e2e/duongRaBangChung.ts` đã có (đường đích đã có tệp ⇒ tự đổi sang `<đường>-lai-<mốc>`), nhưng **bạn vẫn phải kiểm trước**, và không bao giờ khôi phục bằng `cmd > "$f"` (ghi tệp tạm rồi `mv`).

## 1. Kết cục gốc — đường người dùng thật (G123/G126), 2 vp 1280×720 + 1600×900, vai `e2e_tai_loE` (`auth.me` thật — G100)
- K8a `/twin`: `mouse.click` **tâm khối máy** ⇒ `/twin/may/:id` **đúng id**; lặp cho ≥ 5 máy khác nhau mỗi màn/vp, **kể cả máy mà tâm bị nhãn máy khác phủ** (census `k7-nhan-che`-kiểu). Đo trễ trong trang + chụp SAU khi màn Máy **vẽ xong** (`may-dang-tai=0`, `__thongKeVe.calls>0`).
- K8b `/twin/line/2` như trên. K8c sàn trống ⇒ URL không đổi. K8d kéo ⇒ camera đổi, pathname giữ. K8e cursor pointer/auto. K8f bấm nhãn ⇒ đúng máy của nhãn. K8g `demObject` 1/1/1. K8h đối chứng dương `/factory-command` (ghi nhận bố cục chồng khối G102, không tính SAI).
- K8i **sau kéo 60 px** và **sau đổi tầng/toà nhà** (trạng thái mà Đợt 47–49 hay lộ lỗi).

## 2. "Nhanh" (kết cục hiệu năng, sau QĐ-27)
- F1 `mang=chan` 1600×900 **≥ 7 lượt × 4 màn**: p50/p90/max + số lượt > 2 500 ms. Nền so sánh: Đợt 51 có index **1 183 / 1 545 / 1 889, 0/28**; Đợt 50 nền 1 231 / 2 443 / 6 217, 2–3/44.
- Log server: đếm `[SLOW QUERY]` (**stderr**, không phải stdout — Đợt 51 suýt kết luận sai), phân loại theo câu; kỳ vọng 0 câu `traSucKhoeMay`.
- 40 s đứng yên × 3 màn: 0 khung, commit R3F 0, rAF 0; kéo vẫn vẽ.
- Ghi rõ điều kiện tải (đếm chrome/node trước mỗi lượt) — Đợt 50/51 cho thấy đột biến phụ thuộc tải.

## 3. "Đẹp · trực quan"
- Lệch lớp-vs-canvas `lop-nhan` + `lop-canh-bao` 4 màn × 2 vp = (0,0,0,0).
- 22 trạng thái × **vi và en**: nhãn/badge ngoài canvas 0 · bị che 0 · cặp chồng 0 · nhãn×badge 0 · chip có bbox trong canvas; badge `soAn/biChe` ở `/twin`@1280 (Đợt 49 đưa về 0/0).
- bbox 34/34 mục thiết kế QĐ-26. Đếm cặp nhãn ∩ khối máy khác (nền Đợt 49/50: **41**, từng trạng thái 10/13/0/0/9/7/2/0).
- **Tự đọc ≥ 8 ảnh PNG** (Read) — DOM count không phải bằng chứng thị giác.

## 4. Bảo mật + hợp đồng
- D-4 API 6 vai × 48 lượt + socket + HTTP v1 (nền Đợt 50: **lệch 0**). API key thiếu scope ⇒ 404. operator1 0 gán ⇒ rỗng/404/403, 0 dấu vết nhà máy khác.
- 4 lưới phạm vi 180/180 · census `phamViDoc*`/`phamViTuyen*` xanh · hợp đồng trạng thái 6 bề mặt (G105: nhịp tim là bằng chứng sống; `TRAN_NHIP_AN_TOAN_MS` 20 s — mutation phải làm máy đỏ).

## 5. Hồi quy + MỌI cổng trong `package.json` (G108 đã cắn 3 lần)
`vitest twin3d` ≥ 103/2 452 · e2e bấm cảnh 16/16 · D-1 48 ca × 2 vp (`tomtat-D1` cột 52) · D-2 chặn K/E/I/P · `check` · `i18n:check` · `lint:tokens` · **`check:tests`** (đang ĐỎ 32 lỗi — nợ có sẵn, xác nhận bằng `git archive` mốc trước) · `kiem-vo-app-https` · và **liệt kê mọi script kiểm khác trong `package.json`, chạy hết, ghi cái nào đỏ sẵn**.

## 6. Báo cáo `.qa-dot52/BAO-CAO.md` (10 mục)
1 cây + MSA · 2 bảng ca ĐẠT/SAI/HỎNG/CHẶN-ĐÚNG (mã ca, phép đo, số, tệp thô) · 3 kết cục gốc K8 · 4 nhanh · 5 đẹp/trực quan · 6 bảo mật · 7 hồi quy + bảng cổng package.json · 8 Pareto SAI · 9 brief này SAI ở đâu (đếm) + lỗi của chính bạn · 10 **PHÁN QUYẾT NGHIỆM THU CUỐI cho từng mục: yêu cầu gốc · tối ưu · nhanh · đẹp · trực quan · 7 QĐ** — mỗi mục ĐẠT/CHƯA kèm số, và nếu CHƯA thì thiếu chính xác cái gì.
Không xoá tệp dự án, không `reset/checkout -f/stash`, không merge `main`, không chạm 5 màn cũ. Commit duy nhất: `test(qa/dot52): ...` pathspec `.qa-dot52/`.
