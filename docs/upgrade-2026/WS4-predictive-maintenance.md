# WS-4 — Predictive Maintenance + Auto-scheduling

> Quyết định: **heuristic thống kê + time-series engine có sẵn (không train ML nặng)**. GGUF chỉ để diễn giải. Offline-first.

## 1. Mục tiêu
- **PM:** thay cảnh báo ngưỡng bằng mô hình có cơ sở thống kê — MTBF/MTTR, xu hướng suy giảm sức khỏe, anomaly heartbeat, ước lượng RUL → sinh `predictiveAlerts(MACHINE_FAILURE)` kèm `confidenceScore` + `predictedTimeframe`. Nghiệm thu: cảnh báo trước hỏng ≥ X giờ (mặc định 24h) với độ tin cậy đo được.
- **Auto-scheduling:** nâng `productionSchedulingService` thành xếp lịch resource-leveling, tôn trọng `capacityPerHour`/`maxConcurrentOrders`/dependency/deadline, **trừ downtime dự báo từ PM**, lưu "schedule run" audit + apply, what-if (defect spike → tác động giao hàng).

## 2. Hiện trạng (file:line)
- `drizzle/schema/machine.ts:29-45` `machineHeartbeats` (cpu/mem/disk/temperature); `:77-111` `machineHealthHistory` (đã có `predictedFailureRisk`, `recommendedMaintenanceDate`, `maintenanceUrgency`, `healthScore`).
- `drizzle/schema/oee.ts:42-79` `downtimeEvents` (category/start/end/duration) — nguồn MTBF/MTTR.
- `drizzle/schema/ai.ts:77-129` `predictiveAlerts` đủ field (`confidenceScore`, `predictedTimeframe`, `aiAnalysis json`, `escalationLevel`).
- `production.ts:58-93` `productionOrders`; `hierarchy.ts:86-87` `capacityPerHour`/`maxConcurrentOrders`.
- Engine tái dùng: `server/services/aiTimeSeriesEngine.ts` (`ewmaForecast`, `forecastWithConfidenceInterval`, `seasonalDecompose`, `detectChangePoints`, `analyzeMultivariate` Isolation Forest).
- `server/db/machine.ts:416-417` MTBF/MTTR thô từ statusLogs; `:646-687` `recordMachineHealthSnapshot`/`getMachineHealthHistory`.
- **`mqttOeeRouters.ts:538-557`** — `predictedFailureRisk = 100 - healthScore` (heuristic, không chiều thời gian → cần thay).
- `server/services/aiSmartAlertRouter.ts:64-166,224-246` `routeAlert()` chèn `predictiveAlerts`, định tuyến MACHINE_FAILURE → role maintenance, escalation + GGUF. **Điểm tích hợp phát alert.**
- `server/services/productionSchedulingService.ts:70-363` heuristic FIFO/Priority/EDF + conflict + `explainScheduleWithAI`. **Nền auto-schedule.**
- **`productionRouters.ts:367-387`** map sai field (`o.quantity`, `o.endDate`, `o.estimatedHours` không tồn tại) — **bug cần sửa**.
- `alertEvaluationService.ts:293-320` + `_core/index.ts:4293` pattern background job.

## 3. Predictive Maintenance (Phần A)
### Features (offline, từ DB sẵn có)
1. Reliability từ `downtimeEvents` (category→UD): MTBF = uptime/số UD; MTTR = phút UD/số UD; tần suất & xu hướng.
2. Health trend: chuỗi `machineHealthHistory.healthScore` → `seasonalDecompose`/`ewmaForecast` → slope + dự báo thời điểm chạm ngưỡng nguy hiểm (RUL).
3. Anomaly heartbeat: ghép cpu/mem/disk/temp → `analyzeMultivariate` (Isolation Forest); nhiệt độ tăng → `detectChangePoints`.
4. Heartbeat gaps: gap > ngưỡng = micro-stoppage; tần suất gap tăng = degradation.

### Mô hình RUL/điểm rủi ro (hybrid, không train nặng)
`failureRisk (0-100)` = tổ hợp trọng số (lưu `aiAnalysis.factors`): `riskReliability` (hazard `uptimeSinceLast/MTBF`), `riskTrend` (slope healthScore), `riskAnomaly` (tỉ lệ điểm anomaly), `riskTemp` (changepoint nhiệt).
`predictedTimeframe` = horizon đầu tiên mà cận dưới CI forecast healthScore < ngưỡng nguy hiểm → quy ra giờ (lấy min với MTBF).
`confidenceScore` = f(số dataPoints, độ hẹp CI, số features đồng thuận) → đại lượng nghiệm thu "đo được".

### Luồng (tái dùng `routeAlert`)
Service mới `predictiveMaintenanceService.ts`: `computeReliabilityStats`, `computeFailureRisk`, `runPredictiveMaintenanceCycle` (loop máy → `recordMachineHealthSnapshot` cập nhật field đã có → nếu risk≥ngưỡng & confidence≥ngưỡng & timeframe≤X → `routeAlert({type:'MACHINE_FAILURE',...})`). Background job `startPredictiveMaintenanceJob` theo pattern `alertEvaluationService`, đăng ký `_core/index.ts:~4293`, bọc license + cờ `aiSystemConfig`.

### IoT cảm biến (optional, feature-flag)
Đã có `temperature` trong heartbeat. Mở rộng rung động: bảng `machineSensorReadings` ghi từ MQTT; PM đọc thêm nếu có; không có → degrade về 4 metric. Không bắt buộc cho nghiệm thu.

## 4. Auto-scheduling (Phần B)
**Heuristic greedy + resource leveling** (không solver nặng — offline-first):
- Duration thật: `ceil(targetQuantity / capacityPerHour)` (thay công thức `quantity/100*8` ở `:143`).
- Resource leveling: greedy theo Priority/EDF/FIFO, tôn trọng `maxConcurrentOrders` + shift calendar (`shiftConfigs`).
- **Blackout windows** = `recommendedMaintenanceDate`/alert timeframe → đẩy slot qua cửa sổ bảo trì (liên kết PM↔schedule).
- Conflict đã có (overlap/dependency/capacity/deadline) — giữ + bổ sung capacity conflict.

**Schedule run (audit + apply):** bảng `scheduleRuns` + `scheduleRunItems` lưu mỗi lần auto-schedule (input/output/KPI/applied). Endpoint `generate`/`apply` (qua `reschedule` để giữ audit)/`list`/`getById`.

**What-if:** `simulateWhatIf({lineId, defectRatePct|extraDowntimeHours|capacityReductionPct})` → giảm capacity hiệu dụng, chạy lại scheduler in-memory, so `suggestedEnd` vs deadline → danh sách đơn trễ + giờ trễ. GGUF diễn giải. Read-only.

## 5. Các bước
1. Schema/Migration: `scheduleRuns`, `scheduleRunItems`, (optional) `machineSensorReadings`. KHÔNG sửa `predictiveAlerts`/`machineHealthHistory` (đủ).
2. `predictiveMaintenanceService.ts` (mới).
3. Sửa nhỏ `aiSmartAlertRouter.ts` ghi `predictedTimeframe`/`confidenceScore`/`factors`.
4. Sửa `mqttOeeRouters.ts:538-557` dùng `computeFailureRisk` (fallback nếu thiếu dữ liệu).
5. `predictiveMaintenanceRouter.ts` (mới): `getMachineRisk`, `getReliabilityStats`, `listRulForecast`, `runNow`. Đăng ký `routers.ts`, bọc license.
6. Nâng cấp `productionSchedulingService.ts` (duration capacity, shift, blackout, simulateWhatIf, generateScheduleRun). Giữ chữ ký cũ.
7. Sửa `productionRouters.ts` (fix mapping `:367-387` + endpoint mới; reuse `reschedule` cho apply).
8. Đăng ký PM background job `_core/index.ts`.
9. Frontend: `PredictiveAlertsPage` (confidence/timeframe/factors), `MachineHealthMonitoring` (RUL/forecast + MTBF/MTTR), `ProductionScheduling`/Gantt (Auto-schedule, conflicts, What-if, overlay blackout).
10. i18n vi/en/zh.
11. Tests + nghiệm thu.

## 6. Files
**Tạo:** `server/services/predictiveMaintenanceService.ts`, `server/routers/predictiveMaintenanceRouter.ts`, `drizzle/schema/scheduling.ts` (hoặc thêm `production.ts`), `drizzle/00XX_ws4_*.sql`, tests.
**Sửa:** `aiSmartAlertRouter.ts`, `productionSchedulingService.ts`, `productionRouters.ts`, `mqttOeeRouters.ts`, `routers.ts`, `_core/index.ts`, `drizzle/schema/index.ts`, `PredictiveAlertsPage.tsx`, `MachineHealthMonitoring.tsx`, `ProductionScheduling.tsx`, i18n.

## 7. Migration (additive)
- `scheduleRuns`: id, scope(factoryId/lineId nullable), algorithm, status(DRAFT/APPLIED/DISMISSED), kpiSummary json, conflictCount, createdBy/At, appliedAt.
- `scheduleRunItems`: id, runId(FK), productionOrderId, lineId, suggestedStart/End, reason, applied bool.
- (optional) `machineSensorReadings`: id, machineId, sensorType, value, unit, timestamp, source, index(machineId,timestamp).
- KHÔNG drop/sửa bảng cũ.

## 8. Tests Vitest
computeReliabilityStats (MTBF/MTTR đúng) · computeFailureRisk (chuỗi giảm → risk↑, timeframe≤X, confidence∈[0,100]; ổn định → không alert) · anomaly nhiệt · scheduling (duration capacity, blackout đẩy slot, deadline conflict, không conflict input hợp lệ) · whatIf (giảm capacity → đơn trễ tăng) · regression `scheduleFIFO/Priority/EDF` + `optimizeSchedule`.

## 9. Nghiệm thu
PM sinh alert trước hỏng ≥ X giờ (mặc định 24h), `confidenceScore`≠null + `predictedTimeframe` hiển thị; đo precision/recall trên tập mô phỏng · MTBF/MTTR + RUL khớp tính tay · auto-schedule không conflict + né bảo trì + apply audit · what-if ra đơn trễ · offline, license-gated, Vi/En/Zh, endpoint cũ không vỡ.

## 10. Rủi ro
- Dữ liệu thưa → MTBF/RUL kém tin cậy: cold-start fallback heuristic cũ, confidence thấp khi ít dataPoints, không alert dưới ngưỡng confidence (tránh false positive).
- Cảm biến rung phụ thuộc MQTT thực → optional/feature-flag.
- GGUF chỉ diễn giải, non-blocking (`catch→null`).
- License gating router + job.
- `productionRouters.ts:367-387` map sai → sửa là cải thiện, cần regression test.
- Background job: guard `if(interval) return` + try/catch per-máy.

## Critical files
`server/services/aiTimeSeriesEngine.ts` · `aiSmartAlertRouter.ts` · `productionSchedulingService.ts` · `server/db/machine.ts` · `oeeService.ts`

---

## ✅ KẾT QUẢ TRIỂN KHAI (2026-05-30) — HOÀN TẤT (chờ môi trường để nghiệm thu precision/recall live)

### Files đã tạo/sửa
**Tạo:** `server/services/predictiveMaintenanceService.ts` (MTBF/MTTR + computeFailureRisk 4 features + RUL + cycle + job) · `server/routers/predictiveMaintenanceRouter.ts` · `drizzle/schema/scheduling.ts` (`scheduleRuns`/`scheduleRunItems`/`machineSensorReadings`) · `drizzle/0106_ws4_predictive_scheduling.sql` · 2 test (15 ca).
**Sửa:** `enums.ts` (+`scheduleRunStatusEnum`) · `schema/index.ts` · `aiSmartAlertRouter.ts` (ghi `predictedTimeframe`/`confidenceScore`/`factors`, tương thích ngược) · `mqttOeeRouters.ts` (dùng `computeFailureRisk` + fallback cold-start) · `productionSchedulingService.ts` (duration theo `capacityPerHour`, shift calendar, blackout, capacity conflict, `simulateWhatIf`; giữ chữ ký cũ) · `productionRouters.ts` (**FIX BUG** mapping `o.quantity/o.endDate/o.estimatedHours`→field thật + endpoint scheduleRun/whatIf) · `db/production.ts` · `db/machine.ts` · `routers.ts` · `_core/index.ts` (job, cờ `PREDICTIVE_MAINTENANCE_ENABLED`) · UI `MachineHealthMonitoring.tsx` + `ProductionScheduling.tsx` + i18n vi/en/zh. (`PredictiveAlertsPage.tsx` đã sẵn UI — nay có dữ liệu thật.)

### Xác minh
- **Test:** 2 file, **15/15 PASS** — MTBF=10h/MTTR=0.5h khớp tay; chuỗi giảm→risk↑ + timeframe≤MTBF + confidence∈[0,100]; chuỗi ổn định→không alert; duration theo capacity; blackout đẩy slot; deadline conflict; input hợp lệ 0 conflict; what-if -30%→đơn trễ tăng; regression FIFO/Priority/EDF.
- **Typecheck:** 0 lỗi mới ở file WS-4 (lỗi còn lại tiền tồn, xác minh bằng stash).

### Cần con người làm tiếp
1. `node scripts/migrate-standalone.mjs` (file 0106 idempotent).
2. Bật job: `PREDICTIVE_MAINTENANCE_ENABLED=true`; tinh chỉnh `PM_RISK_THRESHOLD/PM_CONFIDENCE_THRESHOLD/PM_TIMEFRAME_HOURS`.
3. MQTT ingest `machineSensorReadings` (rung động) — bảng sẵn, chưa wire (optional theo plan).
4. License: không có middleware per-procedure → `protected/adminProcedure` + TODO.

### Sai khác so với plan (có lý do)
- `generateScheduleRun` orchestration đặt ở router (đọc DB); service cấp `buildScheduleRunPayload` thuần → dễ unit-test.
- `mqttOeeRouters` chỉ dùng risk dự đoán khi `confidence≥30 & dataPoints≥5`, ngược lại fallback heuristic (cold-start tránh false positive).
- `PredictiveAlertsPage` không sửa (UI đã sẵn).

### Nghiệm thu
| Tiêu chí | Trạng thái |
|---|---|
| RUL/MTBF/MTTR khớp tính tay | ✅ Đạt (test) |
| Alert kèm confidenceScore + predictedTimeframe, gate ≥24h + ngưỡng confidence | ✅ Đạt |
| Auto-schedule không conflict + né bảo trì + apply (audit scheduleRuns) | ✅ Đạt (test) |
| What-if ra danh sách đơn trễ | ✅ Đạt (test) |
| Offline (GGUF non-blocking) + endpoint cũ không vỡ + Vi/En/Zh | ✅ Đạt |
| precision/recall + cảnh báo trước hỏng ≥X giờ trên dữ liệu live | ⏳ Cần môi trường + job chạy thật |
