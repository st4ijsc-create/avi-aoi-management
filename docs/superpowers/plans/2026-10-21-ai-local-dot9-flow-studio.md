# Đợt 9 — Flow Studio: chạy thử một node · so sánh lượt · form OT · xoay khoá bí mật

Nhánh `feat/ai-flow-studio` (worktree `_ai9_ui`). Test dùng AI GIẢ; không GPU/:8091. Không mig mới (dải 0410–0414 để trống).

## 1. Chạy thử MỘT node — `flow.chayThuNut`
- `server/services/flow/chayThuNut.ts` (mới, KHÔNG import `dongCo`/`getDb`/`fetch` — census đọc nguồn): nhận node (bản nháp trên canvas, chưa lưu) + item mẫu theo cổng + đầu ra node trước (`$node`).
- Hai tập, mỗi loại node đã đăng ký PHẢI thuộc đúng một (census ∀ sổ đăng ký, node mới chưa phân loại ⇒ đỏ):
  - `CHAY`: chạy hàm `chay` thật vì không ra ngoài — lõi (`kich-hoat.thu-cong`, `du-lieu.dat`, `logic.*`), `ai.llm|trich-xuat|phan-loai|tom-tat` (qua Cổng AI), `ot.doc-tag` (CHỈ ĐỌC CSDL), `ot.de-xuat-lenh|luong` (`kiemVaDeXuat` thuần: trả "yêu cầu chờ duyệt" mô phỏng, KHÔNG ghi hàng chờ).
  - `XEM_TRUOC`: KHÔNG chạy, chỉ đánh giá biểu thức tham số trên item đầu — HTTP (đọc/gửi), `du-lieu.ma`, `ai.sinh-ma`, `ai.agent`, `nguoi.duyet`, `luong.goi-con`, MCP, kích hoạt lịch/webhook. `credentialRef` KHÔNG BAO GIỜ giải mã.
- Không ghi `ai_flow_runs/steps/queue/events/waits`. Đầu ra = `{che, ok, output|cho|loi, thamSoDaDanhGia, ms}`; lỗi bị cắt/chuẩn hoá; trần item 100, trần thời gian 120 s.
- Router: `ghiProcedure` (không phải viewer) + MOD_AI. Ghim `phamViDocCensus` + `congGiayPhepAiCensus`.
- UI: nút "Chạy thử node" ở `NodeConfigPanel` → hộp item mẫu JSON → kết quả ngay tại node (đầu ra / lỗi / chờ duyệt mô phỏng / xem trước).

## 2. So sánh hai lượt
- Không thủ tục mới: client gọi `flow.dongThoiGian` hai lần; so khớp thuần ở `shared/flow/soSanhLuot.ts` (khớp bước theo `nodeId#lan`; trạng thái, thời gian, vào/ra khác nhau theo đường dẫn JSON; bước chỉ có ở một bên).
- UI: chọn lượt A/B trong `RunTimeline` → bảng so sánh.

## 3. Form node OT
- `FormOt` trong `NodeConfigPanel` cho `ot.doc-tag` (chỉ đọc), `ot.de-xuat-lenh`, `ot.de-xuat-luong` + biểu ngữ "MÔ PHỎNG — không gửi lệnh". Không đường gửi lệnh thật; không import dispatcher/FOE (census 8.5 giữ nguyên, thêm kiểm client không import).
- Bật luồng `ot`: đường `batLuongOt` + `stepUp.guard` đã có; e2e chứng minh nút gọi qua step-up.

## 4. Xoay khoá bí mật
- `xoayKhoaBiMat(env, {kho:true|false})` trong `biMat.ts`: giao dịch MỘT lần, khoá hàng (`FOR UPDATE`), giải bằng khoá theo phiên bản, mã lại bằng khoá hiện hành, **đọc lại + giải thử** từng hàng trước khi commit; bất kỳ hàng hỏng ⇒ rollback cả lô. Chế độ khô (`--dry`) chỉ đếm.
- CLI `scripts/flow-xoay-khoa.ts` + runbook `server/services/flow/biMat.RUNBOOK.md`.
- Test bất biến không rò: giá trị/bản mã/khoá không xuất hiện trong kết quả, thông điệp lỗi, log.
