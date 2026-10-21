# Xoay khoá bí mật Luồng AI — runbook

Khoá: `AI_FLOW_KHOA_BI_MAT` (base64, 32 byte) · phiên bản: `AI_FLOW_KHOA_BI_MAT_PHIEN_BAN` (số nguyên ≥ 1, mặc định 1) ·
khoá của phiên bản ngay trước: `AI_FLOW_KHOA_BI_MAT_CU`. Mỗi bí mật mang `phienBanKhoa` của khoá đã mã nó.
Chỉ giữ được MỘT khoá cũ ⇒ phải mã lại hết bí mật sang khoá mới TRƯỚC khi xoay lần kế tiếp.

## Các bước (ví dụ v1 → v2)

1. `npx tsx scripts/flow-xoay-khoa.ts --sinh-khoa` → in một khoá mới (chỉ in khoá).
2. Sao lưu CSDL (hoặc ít nhất bảng `ai_flow_credentials`).
3. Sửa `.env`: `AI_FLOW_KHOA_BI_MAT_CU=<khoá v1 hiện tại>` · `AI_FLOW_KHOA_BI_MAT=<khoá mới>` · `AI_FLOW_KHOA_BI_MAT_PHIEN_BAN=2`.
4. **Chạy khô**: `npx tsx scripts/flow-xoay-khoa.ts` — in tên CSDL, số bí mật cần chuyển; giải thử mọi hàng. Lỗi `THIEU_KHOA` (liệt kê `id@phiên-bản`) hoặc `GIAI_MA_HONG` (nêu id) ⇒ dừng, sửa nguyên nhân.
5. **Áp dụng**: `npx tsx scripts/flow-xoay-khoa.ts --ap-dung` — MỘT giao dịch: giải bằng khoá cũ, mã lại bằng khoá mới (IV mới), đọc lại và giải thử CHỈ bằng khoá mới; bất kỳ hàng nào lỗi ⇒ lùi cả lô.
6. Chạy lại bước 4: phải báo `cần chuyển 0`.
7. Khởi động lại máy chủ với khoá mới; xoá `AI_FLOW_KHOA_BI_MAT_CU` khỏi `.env` rồi khởi động lại lần nữa (chứng minh không còn cần khoá cũ).
8. Huỷ khoá v1 ở nơi lưu giữ khoá.

Tuỳ chọn `--tien-to=erp-`: chỉ xoay các bí mật có id bắt đầu bằng tiền tố (xoay từng phần; vẫn phải xoay hết trước lần xoay kế).

## Bảo đảm (có test: `biMatXoayKhoa.db.test.ts`, `scripts/flow-xoay-khoa.db.test.ts`)
- Nguyên tử; chạy khô không ghi; chạy lại vô hại.
- Nhảy cóc hai phiên bản, thiếu khoá cũ, hàng bị sửa ⇒ từ chối trước/trong giao dịch, không đổi gì.
- Đầu ra, lỗi, console, stdout/stderr không chứa giá trị bí mật, bản mã, hay khoá.
