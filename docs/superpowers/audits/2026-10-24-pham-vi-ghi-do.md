# Phạm vi GHI (tRPC mutation) — đo 2026-10-24 (kiểm định, CHỈ ĐO, không vá)

## 1. Số đo (bộ quét AST `server/routers/phamViGhiScan.ts`)
- **1.198 mutation** (khớp đúng nhóm D của `phamViDocScan` — hai bộ quét độc lập).
- **724 mutation nhận khoá định danh thực thể mà chuỗi gọi KHÔNG với tới bộ phân giải phạm vi** (sổ nợ `phamViGhiBaseline.ts`); 209 có cổng; 265 không nhận khoá nào.
- Bậc (heuristic theo tên/bảng/router): điều khiển-thiết bị-an toàn **51** · sản xuất **114** · cấu hình **559**.
- Sàn quyền của 724: `protectedProcedure` 372 · `adminProcedure` **204** (admin BYPASS phạm vi ⇒ rủi ro thấp) · `writeProcedure` 51 · `qualityProcedure` 28 · `actuationProcedure` 18 · còn lại ~51 (canEdit/author/operator/supervisor/deploy…). 232 mục có `requirePermission`, 286 mục không-admin KHÔNG có.
- Nhiều nợ nhất: productRouters 57 · hierarchyRouters 26 · masterDataRouter 26 · mqttOeeRouters 24 · aiAdvancedRouter 23 · repoWorkspaceRouter 19 · dashboardWidgetRouters 18 · programmingRouter 16.
- Bảng đầy đủ 1.198 dòng (router · mutation · khoá · cổng · sàn quyền · middleware · bảng ghi · bậc · điểm): `2026-10-24-pham-vi-ghi-bang.csv`.
- ⚠ Giới hạn: "có cổng" = chuỗi gọi với tới một bộ phân giải THEO TÊN (không chứng minh cổng áp đúng khoá); khoá suy từ tên trường; cột bảng ghi còn nhiễu theo tên-hàm (programDeployments/robotJobs lọt từ closure); mutation tạo mới không khoá không vào sổ; điểm xếp hạng là heuristic — Top 15 dưới đây đã **chọn tay** sau khi đọc mã.

## 2. Top 15 nguy hiểm nhất (người dùng nhà máy A ghi lên thực thể nhà máy B)
| # | Router · mutation | Khoá | Sàn quyền | Bảng | Hậu quả |
|---|---|---|---|---|---|
| 1 | safety.updateZone | id, robotId, stationId, lineId | protected + machine_control.canCreate | safety_zones | **hạ ngưỡng dừng/giảm tốc vùng an toàn của nhà máy khác** (ĐO ĐỎ) |
| 2 | safety.createZone | stationId, lineId, factoryId… | idem | safety_zones | tạo vùng an toàn gắn trạm/nhà máy khác |
| 3 | safety.ingestProximity / ingestDetectionFrame / ingestSimulatedHuman | robotId, stationId, factoryId | machine_control | safety_events | bơm sự kiện người-gần-robot giả ⇒ dừng/giảm tốc robot nhà máy khác |
| 4 | safety.startCollaboration | robotDeviceId, humanOperatorId, taskId | idem | collaboration_sessions | mở phiên cộng tác người-robot trên thiết bị nhà máy khác |
| 5 | recipes.create (machineId) | machineId | protected + machine_control.canCreate | machine_recipes | gắn công thức vào máy nhà máy khác (ĐO ĐỎ) |
| 6 | recipes.archive | id | machine_control.canEdit | machine_recipes | lưu trữ công thức đang dùng của nhà máy khác (ĐO ĐỎ) |
| 7 | recipes.setGolden | id | idem | machine_recipes | đổi bản "golden" chuẩn của nhà máy khác (ĐO ĐỎ) |
| 8 | recipes.approve | recipeId | actuationProcedure | machine_recipes | duyệt công thức nhà máy khác (mở đường deploy) |
| 9 | equipmentIntegration.recordRecipeLoad / createRecipeVersion / archiveRecipeVersion | machineId, recipeId | protected + requirePermission | machine_recipes, recipe_load_log | nhật ký nạp/phiên bản công thức máy nhà máy khác |
| 10 | aoiOnboarding.signOff / decommission | machineId | machine_monitoring.canEdit | aoi_commissioning_records | nghiệm thu / ngừng vận hành máy AOI của nhà máy khác |
| 11 | aoiOnboarding.saveDraft / deleteDraft | machineId | machine_monitoring.canCreate | aoi_commissioning_records | tạo / XOÁ bản nháp nghiệm thu máy nhà máy khác (ĐO ĐỎ) |
| 12 | bom.recordComponentInstallation | machineId, serialNumber, lotCode | **protected, KHÔNG requirePermission** | component_installations, genealogy | ghi lắp linh kiện / genealogy lên máy-serial nhà máy khác bởi MỌI user đăng nhập |
| 13 | aiRobotAnomaly.scanRobot / acknowledgeAnomaly | robotId, id | requirePermission | robot_behavior_anomalies | quét/ack bất thường robot nhà máy khác |
| 14 | twin.pipeline.convertStep / convertUrdf | equipmentId, machineId, factoryId | requirePermission | equipment_3d_models | ghi mô hình 3D của thiết bị nhà máy khác |
| 15 | rootCause.analyze / delete | machineId, factoryId, id | protected / requirePermission | root_cause_analysis | tạo/xoá phân tích nguyên nhân gốc của nhà máy khác |

(Đã vá sẵn ở cây hiện tại, không còn nợ: commissioning.create, genealogy.appendEvent, recipes.deploy/rollback.)

## 3. ĐO ĐỎ THẬT (`server/routers/phamViGhiDo.db.test.ts`, CSDL `_test`)
Người dùng kỹ sư gán CHỈ nhà máy A, đủ quyền module; gọi lên thực thể nhà máy B. 4 ca đối chứng (thực thể A) **xanh**; 6 ca xuyên nhà máy **ĐỎ** (`PHAMVI_GHI_DO=1`, nguyên văn):
| Ca | Kết quả đo (kỳ vọng: từ chối + hàng B không đổi) |
|---|---|
| recipes.create machineId=B | `{ loi: null, hangGhiLenB: 1 }` — tạo được |
| recipes.archive công thức máy B | `{ loi: null, trangThai: 'archived' }` |
| recipes.setGolden công thức máy B | `{ loi: null, isGolden: true }` |
| aoiOnboarding.saveDraft máy B | `{ loi: null, hangGhiLenB: 1 }` |
| aoiOnboarding.deleteDraft máy B | `{ loi: null, nhapConLai: 0 }` — xoá mất nháp |
| safety.updateZone vùng trạm B (stopDistanceMm 1000→600) | `{ loi: null, stopDistanceMm: 600 }` |
Mặc định các ca xuyên nhà máy chạy bằng `it.fails` ⇒ lưới XANH khi lỗ còn; khi luong-ui vá, `it.fails` sẽ ĐỎ ⇒ buộc gỡ `fails` + xoá dòng khỏi sổ nợ. Ghi chú: `safety.updateZone` chỉ chạy khi `SAFETY_ZONE_SW_ENABLED=true` (cờ mặc định tắt ⇒ lỗ ngủ).

## 4. Census `phamViGhiCensus` (đã dựng, 12 test xanh)
`phamViGhiCensus.test.ts` + `phamViGhiBaseline.ts` (khuôn phamViDoc): §1 bộ quét không mù, tổng khớp nhóm D; §2 ghim 1.198/724; §4 mutation MỚI có khoá định danh mà không có cổng ⇒ ĐỎ; §5 dòng sổ đã vá mà chưa gỡ ⇒ ĐỎ; §6 tệp ảo (ghi đè, không ghi đĩa) chứng minh vị từ bắt/không bắt đúng hình dạng. Trả nợ = XOÁ dòng sổ + hạ số ghim.
