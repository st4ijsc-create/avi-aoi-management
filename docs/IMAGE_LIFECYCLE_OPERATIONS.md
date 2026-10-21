# Vòng đời ảnh trên đĩa — hướng dẫn vận hành

Cập nhật 2026-10-21 (nhánh `chore/ai-luoi-do`). Mã: `server/services/imageLifecycleService.ts`, `server/services/dataRetentionService.ts`.

## 1. Ảnh nằm ở đâu

| Vị trí (dưới `LOCAL_STORAGE_DIR`, mặc định `./uploads`) | Do ai ghi | Cột/bảng tham chiếu |
|---|---|---|
| `inspections/<inspectionId>/<pointCode>-<nanoid>.<ext>` | đường ingest máy (`machineApiRouters`) | `measurement_results.imageKey` / `defectCropKey` / `imageUrl` / `defectCropUrl` |
| `aoi/…` (gói ZIP gốc) | `aoiPackageRouter` | `inspection_packages.storageKey` |
| `aoi-cache/<packageId>/<tệp>` | `aoiPackageRouter` (bóc ảnh từ ZIP theo yêu cầu) | không có — là bộ nhớ đệm, dựng lại được |

⚠ `LOCAL_STORAGE_DIR=/uploads` (đường dẫn tuyệt đối không ổ đĩa) được `path.resolve` thành `<ổ đĩa của cwd>:\uploads` — KHÁC `./uploads` của repo. Kiểm tra giá trị thật trước khi kết luận "không có ảnh". `aoi-cache` mặc định theo `process.cwd()/uploads/aoi-cache` (hoặc `AOI_CACHE_DIR`), KHÔNG theo `LOCAL_STORAGE_DIR`.

## 2. Ai dọn ảnh

1. **dataRetentionService (R6)** — xoá hàng quá hạn và dọn ảnh theo khoá (`RETURNING`). **Không chạy cho bảng có chính sách native** của TimescaleDB (`product_inspections`, `measurement_results`, … `drop_after 365 days`, mig 0173): quét ứng dụng bỏ qua bảng đó để khỏi xoá đôi. Trên môi trường có Timescale native, nhánh này là **chết** cho hai bảng ảnh.
2. **`pruneOldInspectionImages`** — cơ chế thật cho ảnh của chunk bị drop. Xoá thư mục `inspections/<id>` có tệp mới nhất cũ hơn `RETENTION_INSPECTION_IMAGES_DAYS` (365). Duyệt theo id số tăng dần, trần `IMAGE_LIFECYCLE_MAX_DIRS_PER_RUN` chỉ đếm thư mục **đã xét**, con trỏ bền ở `<LOCAL_STORAGE_DIR>/.lifecycle/inspections-prune.cursor.json` (hết vòng thì quay lại đầu). Cần `DATA_RETENTION_ENABLED=true` và `STORAGE_MODE=local`. *(Bản trước 2026-10-21 đếm mọi thư mục và không có con trỏ ⇒ chỉ rà ~5 000 tên đầu; đã vá.)*
3. **`reapOrphanImages`** — so khoá ảnh trong storage với `measurement_results`, xoá ảnh mồ côi đủ già (ân hạn 24 h). **Tắt mặc định, dry-run mặc định** (`ORPHAN_IMAGE_REAPER_ENABLED`, `ORPHAN_IMAGE_REAPER_DELETE`).
4. **`sweepAoiCache`** — quét `aoi-cache` theo TTL (`AOI_CACHE_TTL_DAYS`, 7). **Luôn chạy ở chế độ báo cáo**; chỉ xoá khi `AOI_CACHE_SWEEP_DELETE=true`. Log dạng `[AoiCacheSweep] DRY-RUN — would delete N dirs / F files / X MB`.

## 3. Khuyến nghị vận hành (quyết định của chủ hệ thống, chưa bật)

- **B — reaper**: bật `ORPHAN_IMAGE_REAPER_ENABLED=true` (vẫn dry-run) trên môi trường thật 1–2 tuần, đọc log `[OrphanReaper]`, rồi mới đặt `ORPHAN_IMAGE_REAPER_DELETE=true`. Lưu ý tập tham chiếu hiện chỉ lấy từ `measurement_results`; hàng của bảng này cũng bị Timescale drop nên khoá mồ côi sẽ hiện ra đúng lúc chunk bị bỏ.
- **aoi-cache**: đọc vài ngày log dry-run, rồi mới `AOI_CACHE_SWEEP_DELETE=true`. Dọn tay phần tồn đọng cần chủ dự án duyệt.
- **Chỉ số mồ côi**: chưa có màn nào hiển thị kết quả reaper/sweep (chỉ log). Không dựng màn mới ở đợt này.
