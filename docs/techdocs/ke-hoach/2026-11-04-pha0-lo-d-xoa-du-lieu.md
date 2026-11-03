# Pha 0 · Lô D — đếm + xoá dữ liệu rác (chuẩn bị, CHƯA CHẠY)

| | |
|---|---|
| Người soạn | tho-ca-agent (2026-11-04) — chỉ viết công cụ + đọc mã; **không chạm DB nào** |
| Người chạy | dieu-phoi, sau khi chủ dự án duyệt số đếm (`01 §9‑19`) |
| Công cụ | `scripts/pha0/xoa-du-lieu.mjs` (một mục mỗi lần, một giao dịch, `--test-only` mặc định luôn ROLLBACK) |
| Vai DB | do người chạy cấp qua `DATABASE_URL` (script không đọc `.env`, không chọn vai) |

## 1. Cách chạy (mỗi mục: test‑only → báo số → duyệt → commit)

```
# 1) đếm: mặc định --chi-dem = giao dịch READ ONLY, chỉ SELECT (dùng cho DEV); --test-only (DELETE+ROLLBACK) chỉ trên _test
DATABASE_URL=<_test hoặc dev> node scripts/pha0/xoa-du-lieu.mjs --item E0-1 --db <current_database mong đợi> --chi-dem
# 2) sau duyệt: ghi thật — --expect-n PHẢI bằng "se_xoa" của lần test‑only ngay trước
DATABASE_URL=<dev> node scripts/pha0/xoa-du-lieu.mjs --item E0-1 --db aoi_management --commit --expect-n <N>
```

Script dừng (không xoá) khi: `current_database()` ≠ `--db` (Đ‑28) · điều kiện canh sai · `--expect-n` lệch số sắp xoá · số xoá thực ≠ số đếm.

## 2. Ba mục

| Mục | Bảng + điều kiện xoá | Số kỳ vọng (từ TechDocs 03/11) | Điều kiện canh (đo TRƯỚC khi xoá) | Ghi chú |
|---|---|---|---|---|
| **E0‑1** | `simulation_runs` `WHERE "mode"='fidelity_check'` | 80 941 hàng / 73,7 MB | 0 hàng `mode <> 'fidelity_check'` | Lịch `twinFidelity` đã GỠ khỏi `backgroundJobs.ts` (commit lô A2+); kiểm tay `twinGov.runFidelityCheck` còn. Bảng không FK. |
| **F0‑1** (mặc định TẮT, bật bằng biến) | `vram_events` `WHERE "createdAt" < now() - interval '30 days'` | ≈ 60 000 (tổng 66 423, +745/ngày) | còn ≥ 1 hàng trong 30 ngày | Từ nay `dataRetentionService` có mục `vram_events` 30 ngày (`RETENTION_VRAM_EVENTS_DAYS`); chỉ chạy khi `DATA_RETENTION_ENABLED=true` (P0‑6) **và** vai ứng dụng có quyền DELETE bảng này (kiểm khi P0‑1 đổi sang `avi_app`). |
| ~~Q0‑5~~ | **BỎ** (chủ dự án 2026-11-04): `product_inspections` là sổ WORM (mig 0279 REVOKE DELETE `avi_app`) — GIỮ seed 13 236 hàng; không xoá, không `VACUUM FULL inspection_packages` | — | — | — |

Kết quả kỳ vọng sau cùng: 3 bảng như bảng trên, `inspection_packages` < 1 MB.

## 3. Phát hiện lệch kế hoạch — mig 0590 "bảng 0 hàng" KHÔNG nên tạo

F0‑2 ghi: *"bảng 0 hàng `ab_test_*`, `batch_inference_*`, `training_batch_*` (mig 0590)"*. Đọc mã thấy **cả ba nhóm đều còn mã sống**:

| Nhóm bảng | Mã sống | Hệ quả |
|---|---|---|
| `batch_inference_jobs/items` | `aiAdvanced.batch` (`aiAdvancedRouter.ts`) — client gọi `batch.list/getById/progress/create` | **DROP làm hỏng màn đang chạy** |
| `training_batch_comments/tags/tag_assignments` | `trainingBatchCommentsRouter.ts` (đang mount) | DROP làm hỏng router |
| `ab_test_experiments/results` | `services/aiABTesting.ts` (`aiQualityGateRouter`, `aiQualityGate.selectCanaryVariant`, `embeddingHead.createExperiment`) + `db/aiAdvanced.ts` | DROP làm hỏng canary của cổng chất lượng |
| `edge_deployments` (nhắc ở 80 §2) | `edgeDeploymentRouter.ts`, `machineApiRouters.ts`, `routes/edgeDownload.ts` | còn sống |

⇒ Đề nghị **không** tạo mig 0590 trong pha 0; "bảng 0 hàng" là *0 hàng*, không phải *0 mã*. Gỡ bảng chỉ sau khi 40‑AL6/80 gỡ nốt mã tương ứng (chủ dự án chốt).

## 4. Việc dieu‑phoi/chủ dự án cần quyết

1. Duyệt số đếm 3 mục (sau `--test-only`).
2. Vai DB cho `--commit` (script không chọn).
3. Xác nhận bỏ mig 0590 khỏi pha 0 (mục 3).
