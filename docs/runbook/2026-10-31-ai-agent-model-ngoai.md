# Runbook — tác nhân lập trình máy chủ chạy model NGOÀI (Đợt 10.4b L3 + L3b)

> Áp dụng khi mở bề mặt `agent` trong `BE_MAT_NGOAI_DUOC_DUNG` (`server/services/ai/chonModel/kieu.ts`) · chủ: do-model (mã) / dieu-phoi
> (vận hành, quyết mở) · hợp đồng: `docs/superpowers/plans/2026-10-30-dot10-4b-L3-agent-ngoai-hop-dong.md` · kiem-dinh ĐẠT L3 (95e45abe5 +
> c771d2a97) và L3b (9c0a41c76).

## Trạng thái

Mã L3 + L3b đã có; bề mặt `agent` **CHƯA** nằm trong `BE_MAT_NGOAI_DUOC_DUNG` ⇒ `POST /api/ai/agent/runs` với `chonModel: "ngoai:…"` vẫn
trả `404 CHON_MODEL_KHONG_CO` như trước. Mở = thêm `"agent"` vào hằng đó + đổi ca ghim `n6 (k7)` trong
`server/services/ai/agent/quanLyLuotChay.ngoai.test.ts` (một commit, qua cổng thường, kèm câu chữ hướng dẫn dưới đây đã lên UI).

## Người dùng cần biết (đưa vào hướng dẫn / chú thích UI khi mở)

1. **Chỉ chế độ "Hỏi" (chỉ đọc).** Model ngoài đọc mã dự án bằng `read_file` · `list_dir` · `grep`; không ghi, không chạy lệnh, không giao
   việc cho agent con. Chọn "Sửa" / "Tự động" với model ngoài ⇒ bị từ chối (`NGOAI_CHI_HOI`).
2. **"Dừng" không dừng được cuộc gọi đang bay.** Bấm Dừng chặn vòng TIẾP THEO; một yêu cầu đã gửi tới nhà cung cấp vẫn chạy hết (dữ liệu
   của vòng đó đã rời máy, phí của vòng đó vẫn tính, tối đa một vòng).
3. **Có lịch sử ⇒ dữ liệu "vận hành".** Lượt đầu (không lịch sử, phiên mới) gửi mức `ky-thuat`; có lịch sử hội thoại hoặc phiên đã có lượt
   ⇒ mức `van-hanh` ⇒ hộp xác nhận một lần (428 `CAN_XAC_NHAN_VAN_HANH`), và nhà máy phải cho dữ liệu vận hành ra ngoài.
4. **Sau một lượt model ngoài, phiên đó mất "Tự động".** Lượt cục bộ chế độ Tự động trong cùng phiên bị hạ tự trị từ đầu: mọi ghi / lệnh
   cần người duyệt (cảnh báo "hạ tự trị" hiện ngay sau khi bắt đầu). Mở phiên mới để dùng lại Tự động.
5. **Giới hạn đã biết:** lịch sử dán / gửi kèm mà KHÔNG gắn phiên thì máy chủ không biết có lượt ngoài ⇒ không hạ tự trị được. Dùng phiên.

## Vận hành

- Tắt nhanh: bỏ `"agent"` khỏi `BE_MAT_NGOAI_DUOC_DUNG` (build lại) — hoặc tắt cổng ngoài của nhà máy ở màn quản trị (mọi bề mặt).
- Trần: mỗi lượt agent = một run của cổng (trần số vòng / USD của nhà máy) + trần CỨNG 6 vòng của bộ chuyển (`TRAN_VONG_AGENT_NGOAI`).
- Sổ: `ai_agent_runs."nguonModel"` (máy chủ ghi lúc tạo, mig 0419) · `ai_external_calls` theo `runId` (vết token / USD) · cờ phiên
  `ai_coding_sessions."coLuotNgoai"`.
- Lỗi nhà cung cấp có loại ổn định (Đợt 12 H3.1): hết hạn mức (`QUOTA`) không thử lại; giới hạn tốc độ thử lại theo `Retry-After`
  (chờ > 10 s ⇒ báo lỗi ngay).
