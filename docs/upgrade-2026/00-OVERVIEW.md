# Kế hoạch nâng cấp hệ sinh thái 4.0 — 2026

> Tài liệu PM tổng hợp. Tạo ngày 2026-05-30. Nguồn: khảo sát codebase thực tế + 4 agent kiến trúc sư.
> Trạng thái: **ĐÃ TRIỂN KHAI CODE CẢ 4 WS (2026-05-30) — chưa commit/push, chờ chạy migration + nghiệm thu E2E trên môi trường thật.**

## 🚦 Trạng thái triển khai (cập nhật 2026-05-30)
| WS | Code | Test | Typecheck | Còn lại |
|---|---|---|---|---|
| WS-3 Vector Search | ✅ | 13/13 | 0 lỗi mới | cài pgvector + migration + backfill |
| WS-1 AI tự học | ✅ cốt lõi | 33/33 | 0 lỗi mới (−12 tiền tồn) | UI 3/5 trang (backend sẵn), migration, train thật |
| WS-2 Edge Deploy + Wizard | ✅ | 17/17 | 0 lỗi mới | migration, firmware máy, E2E |
| WS-4 Predictive + Auto-schedule | ✅ | 15/15 | 0 lỗi mới | migration, bật job, dữ liệu live |
| **Tổng** | **4/4** | **78/78 PASS** | **0 lỗi mới** | migration + nghiệm thu môi trường |

> Migration mới: `0091` (WS-3), `0104` (WS-1), `0105` (WS-2), `0106` (WS-4) — đều additive/idempotent, không drop. KHÔNG commit/push/tạo branch.

## Mục tiêu
Biến hệ thống từ "giám sát + thống kê" thành **hệ sinh thái 4.0 tự cải tiến**: dữ liệu → AI local đánh giá → tự học lại → đẩy xuống edge → nâng sản lượng/chất lượng. Dữ liệu không rời nhà máy (offline-first, AI local GGUF + Ollama).

## Hiện trạng hệ thống (đã khảo sát)
- Frontend: 109 trang React/TS · Backend: ~80 router tRPC + MQTT (Aedes) + Socket.io · 99+ bảng, ~50 bảng AI.
- Đa ngôn ngữ Vi/En/Zh · License Hybrid (online/offline RSA) · Backup ISO 22301 S3/MinIO · IEC 62543 socket hardening.
- Mức hoàn thiện tổng thể ~85%. Nền tảng xuất sắc.

## Phát hiện then chốt (gốc rễ vì sao tính năng chưa chạy)
| # | Phát hiện (file:line) | WS |
|---|---|---|
| 1 | `aiTrainingPipeline.ts:150-198` training mô phỏng (`Math.random`); nhánh thật phụ thuộc `TRAINING_SERVICE_URL` (cloud) | WS-1 |
| 2 | `aiLocalTraining.ts` import sai bảng (`aiInferenceResults`/`aiAnnotations` không tồn tại); router disable `routers.ts:83` | WS-1 |
| 3 | `aiEdgeEnhancedRouter` disable `routers.ts:82,405`; không có endpoint cho máy tải model | WS-2 |
| 4 | `aiImageEmbeddings.embedding` lưu TEXT, không index → full scan O(N) | WS-3 |
| 5 | `predictedFailureRisk = 100 - healthScore` (`mqttOeeRouters.ts:538`) — không có chiều thời gian | WS-4 |
| 6 | `productionRouters.ts:367-387` auto-schedule map sai field (`o.quantity`, `o.estimatedHours`) | WS-4 |

→ Schema phần lớn đã đủ. Công việc chính: **nối dây + bỏ stub + migration nhẹ (nullable, backward-compatible)**.

## 4 Workstream
| WS | Tên | Quyết định đã chốt |
|---|---|---|
| [WS-1](WS1-ai-self-learning.md) | AI tự học (Training + Active Learning) | **Tầng 1 thuần Node, offline 100%** (Tầng 2 sidecar Python = tùy chọn tương lai) |
| [WS-2](WS2-edge-deployment.md) | Edge Deployment đầu-cuối + Wizard cài máy | HTTP pull + verify sha256; MQTT/Socket chỉ notify |
| [WS-3](WS3-vector-search.md) | Vector Search ảnh NG tương tự | **Ollama text-of-image, D=1024** + pgvector HNSW |
| [WS-4](WS4-predictive-maintenance.md) | Predictive Maintenance + Auto-scheduling | Heuristic thống kê + time-series engine có sẵn (không train ML nặng) |

## Ràng buộc chung (mọi WS)
Offline-first · License gating · Đa ngôn ngữ Vi/En/Zh · Backward-compatible API máy/MQTT · Mỗi WS = 1 nhánh + migration riêng + test Vitest + cập nhật knowledge base.

## Thứ tự triển khai đề xuất
**WS-3** (gọn, độc lập) → **WS-1** (giá trị cao nhất) → **WS-2** (cần model từ WS-1) → **WS-4** (cần dữ liệu vận hành tích lũy).
WS-3 và WS-1 có thể chạy song song (chạm file khác nhau).
