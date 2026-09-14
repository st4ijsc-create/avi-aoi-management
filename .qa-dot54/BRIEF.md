# Đợt 54 — QA lần 9: XÁC NHẬN 5 SAI đã đóng + nghiệm thu lại "đẹp" (độc lập, không sửa mã)

Bạn là QA ĐỘC LẬP — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác; 3001/3008 phục vụ `_twin_wt/dist` — KHÔNG rebuild `dist/`).

**Việc đầu tiên: gọi `Skill pdca`.** KHÔNG sửa mã sản phẩm, KHÔNG sửa `e2e/`; chỉ ghi + commit `.qa-dot54/` (pathspec). Mỗi bước `.qa-dot54/<bước>-XONG.txt`; đừng im lặng > 10′.

Đây là **QA xác nhận**: QA lần 8 (`.qa-dot52/BAO-CAO.md`) chấm 290/308, chỉ tiêu chí **"đẹp" CHƯA ĐẠT** vì 4 ca badge đè nhãn + 1 ca hợp đồng trạng thái. Đợt 53 (spec §14q.32) khai đã đóng cả 3 món. Việc của bạn: **đo lại từ đầu, không kế thừa lời khai**.

## 0. Cây + hệ đo (MSA)
- HEAD kỳ vọng `360c9218` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot54/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3054** (cấm 3000/3001/3008/5173/8080/3047…3053). outDir **tuyệt đối ngoài `client/`**; md5 build lặp khớp (G120); `trap EXIT`.
- DB dev bất biến (`node .qa-dot37/db.mjs dem` 11 khoá + `.qa-dot34/dem.mjs` 6 khoá trước/sau; hàng tạm `trap`). 5 ảnh `test-results/` giữ md5. `.qa-dot47/` 103 tệp 0 byte — **không đắp, không xoá** (G130).
- **G130/G133:** `grep -n "qa-dot[0-9]\+"` mọi harness trước khi chạy; không `cmd > "$f"`; hàng rào `e2e/duongRaBangChung.ts` đã có nhưng vẫn phải kiểm.
- **G138:** `npm run kb:operational-cards:test` **ghi đè 169 tệp tracked dưới `knowledge/`**. Chạy hay không là quyền bạn, nhưng phải **khai rõ** trong báo cáo; nếu chạy thì ghi lại `git status -- knowledge` trước/sau và **không khôi phục** (phiên khác đang làm dở ở đó).

## 1. Xác nhận 5 SAI (mỗi món phải có phép đo của CHÍNH bạn + ảnh)
- **S1–S4 badge×nhãn ở máy CÓ cảnh báo** (`/twin/may/18`), 2 vp × vi/en: đếm cặp nhãn∩badge + % diện tích + ai nằm trên; **và cặp số "badge VẼ vs badge VÀO SỔ"** ở cả 3 màn (G136 — lệch là bug). Kỳ vọng Đợt 53: 0/16 cặp, vẽ = vào sổ ở cả 3 màn. Tự đọc ≥ 4 ảnh.
- **S5 hợp đồng trạng thái trên DỮ LIỆU SỐNG** (G135): chèn nhịp tim `now()` tạm (`trap` xoá), đọc **6 bề mặt** cùng một máy (`factoryCommand.overview`, `machineDetail`, `assetCockpit.liveState.statusMapped` + `operationStatus`, socket, danh sách `/twin`, `/twin/may/:id`) ⇒ phải cùng một chữ. Thêm ca **thiếu dữ kiện** (`operationStatus` null/""/undefined) ⇒ không được suy ra `running`. Kiểm cả `TRAN_NHIP_AN_TOAN_MS` 20 s (mutation phải làm máy đỏ) và `NGUONG_TRANG_THAI_TUOI_MS` 5′.
- **S-C hiệu năng**: `[SLOW QUERY]` đọc từ **stderr**, đếm câu `DISTINCT ON machine_health_history` trong cửa sổ F1 (kỳ vọng 0); **EXPLAIN ấm** cho câu đã vá (`factoryCommandService.ts:290`) và cho `oeeService.ts:837,855` (G137 — log chậm ≠ bệnh).

## 2. Nghiệm thu lại "đẹp" + không hồi quy
- 24 trạng thái × 2 vp × vi/en (gồm `may/co-canh-bao`): nhãn/badge ngoài canvas 0 · bị che 0 · cặp chồng 0 · nhãn×badge 0 · chip có bbox trong canvas.
- Lệch lớp `lop-nhan` + `lop-canh-bao` 4 màn × 2 vp = (0,0,0,0). bbox 34/34.
- K8 bấm tâm khối máy ≥ 5 máy/màn/vp (**kể cả máy bị nhãn phủ**) ⇒ đúng `/twin/may/:id`; K9 chọn Line 6/6; e2e bấm cảnh 16/16.
- F1 ≥ 7 lượt × 4 màn: p50/p90/max + đột biến > 2 500 ms, **kèm số tiến trình chrome/node lúc đo** (Đợt 53 cho thấy nền phụ thuộc tải; nếu lệch nền 52 thì phải chạy **xen kẽ hai build** mới được kết luận hồi quy).
- 40 s đứng yên × 3 màn = 0 khung, commit R3F 0. D-1 48 ca (cột 54: `D1_MOI=.qa-dot54 D1_TRUOC=.qa-dot53`). D-2 chặn K/E/I/P. D-4 6 vai (⚠ Đợt 53 báo **4/6 vai nền đã bị xoá ⇒ 401** — đo lại, nếu thiếu vai thì tạo user TẠM có `trap` và nói rõ).
- `vitest twin3d` ≥ 104/2 461 · 4 lưới phạm vi 180/180 · census xanh · `check` 0 · `i18n:check` 0 · `lint:tokens` · `kiem-vo` · **bảng cổng `package.json` như QA lần 8** (ghi cái nào đỏ sẵn, cái nào có tác dụng phụ).

## 3. Báo cáo `.qa-dot54/BAO-CAO.md` (8 mục)
1 cây + MSA · 2 bảng S1–S5 + S-C: ĐÓNG/CHƯA kèm số + ảnh · 3 nghiệm thu "đẹp" (ĐẠT/CHƯA) · 4 hồi quy + bảng cổng · 5 Pareto nếu còn SAI · 6 brief này SAI ở đâu (đếm) + lỗi của chính bạn · 7 DB/md5/cổng trước–sau · 8 **PHÁN QUYẾT: 5 tiêu chí (yêu cầu gốc · tối ưu · nhanh · đẹp · trực quan) + 7 QĐ — ĐẠT/CHƯA kèm số**; nếu tất cả ĐẠT thì nói thẳng "nghiệm thu cuối ĐẠT 5/5", nếu không thì thiếu chính xác cái gì.
Không xoá tệp dự án, không `reset/checkout -f/stash`, không merge `main`, không chạm 5 màn cũ. Commit duy nhất: `test(qa/dot54): ...` pathspec `.qa-dot54/`.
