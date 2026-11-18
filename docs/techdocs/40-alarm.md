# 40 · Cảnh báo, andon, thông báo (alarm)

| | |
|---|---|
| Mục tiêu phục vụ | M2 giám sát thời gian thực (trực tiếp: bất thường phải nổi lên trong ≤ 1 chu kỳ poll); M4 chất lượng (cảnh báo NG/yield/SPC đi cùng một cửa); M5 AI (AI đọc/đề xuất ack qua cùng cửa, không có cửa riêng) |
| Phụ thuộc | 10 hierarchy (site, phạm vi), 20 asset (asset, tag.role, tag_template.alarm_default, alarm_taxonomy), 30 telemetry (LiveStore, quality/stale, bus) |
| Module phụ thuộc vào đây | 50 control (interlock phát sự kiện; lệnh STOP nguy cấp), 60 inspection (NG/yield/SPC phát sự kiện), 70 engineering (mô phỏng phát sự kiện `origin=sim`), 80 ai (đọc cảnh báo, đề xuất), 90 platform (OEE downtime từ sự kiện, báo cáo, vỏ: chip cảnh báo) |
| Mốc đo | `_ai8_wt ec76a24f6` (2026-11-03), DB `aoi_management@5434` read-only; chuẩn ISA‑18.2 (trạng thái, shelve/suppress/OOS, rationalization), EEMUA 191 (tải cảnh báo), ISA‑101 (hình + số + chữ) |
| Trạng thái | **v1.1 — ĐÃ DUYỆT 2026-11-03** (8 câu hỏi §7 duyệt theo khuyến nghị; mig 0510–0529) |

## 0. Phạm vi của module

Module này sở hữu **sự kiện bất thường và vòng đời của nó**: định nghĩa cảnh báo (ngưỡng, ưu tiên, lý do, hành động), engine đánh giá trên tín hiệu sống, một cửa phát sự kiện cho mọi module khác (`raiseEvent`), trạng thái ISA‑18.2 (active/acked/cleared, shelved, suppressed‑by‑design, out‑of‑service), andon do người kéo, thông báo và leo thang (in‑app, email, webhook, push), KPI cảnh báo (tần suất, MTTA/MTTR, phân bổ ưu tiên), và **một màn** `/canh-bao`.

Module này **không** sở hữu: ngưỡng quy trình/SPC và cách tính NG (60 — chỉ gọi `raiseEvent`), interlock và hành động chặn/dừng (50 — interlock phát sự kiện vào đây, quyết định chặn ở 50), dữ liệu tín hiệu (30), kênh gửi webhook/email ở tầng hạ tầng (90 giữ sender; 40 giữ *quy tắc* gửi).

Bất biến: (1) **một sự kiện bất thường chỉ có một bản ghi** dù đi qua bao nhiêu kênh; (2) **dữ liệu cũ thắng cảnh báo** — tag stale không sinh cảnh báo ngưỡng, chỉ sinh `comm_lost` (ràng buộc #7); (3) **không có cảnh báo không có người nhận**: mỗi sự kiện P1/P2 phải có ít nhất một đích thông báo, hoặc bị ghi `undelivered` nhìn thấy được.

---

## 1. Hiện trạng đo được

### 1.1 Số đếm tổng

| Chỉ số | Đo được |
|---|---|
| Hệ cảnh báo backend | **16 hệ** (báo cáo tổng quan đếm 8), 21,2k LOC không kể `mqttService.ts` 3 759 và `ecosystemEvents.ts` 407 |
| Bảng liên quan | **~39 bảng** (báo cáo đếm 27); 36 bảng khớp mẫu tên, trong đó 19 bảng **rỗng** |
| Từ vựng mức độ | **13 bộ** khác nhau ở backend; **20 bảng ánh xạ màu** khác nhau ở client; `call` của andon được hiểu **5 cách** (high / critical / danger / info / `--alarm-high`) |
| Trang client | 8 trang + ~15 component (≈ 12 500 LOC); 2 component mồ côi (`AlertSoundSettings`, `AlertWidget`); 4 bộ phát âm thanh |
| Cửa phát sự kiện | 5: `routeAlert` (~17 chỗ gọi), `raiseAndon` (5), `raiseCriticalStopAlert` (~15), `publishNGAlert`, `notifyOwner` trực tiếp |
| Bộ leo thang | **2 bộ cùng ghi `predictive_alerts.escalationLevel`** với hai thang thời gian khác nhau (5/10/20 phút và 30 phút phẳng) |
| Shelve/suppress | chỉ `master_alarms.shelvedUntil/isSuppressed`, chỉ được kiểm ở đường adapter (`isAlarmSuppressed` 1 chỗ gọi); andon từ interlock/SPC/tay bỏ qua |

### 1.2 Dữ liệu `[đo]`

| Bảng | Hàng | Mức độ | Trạng thái | Ack | FK máy | Thời gian | Ghi chú đo được |
|---|---|---|---|---|---|---|---|
| `notifications` | 56 433 | priority URGENT 53 660 / NORMAL 2 670 / HIGH 103 | — | `isRead` | — | naive | **56 433/56 433 chưa đọc**; 55 823 `entityType=alert`; **53 416 tiêu đề "CRITICAL Alert: DEFECT SPIKE"** phát cho 5 user (≈ 10 000/user); 18 hàng trong 24 h |
| `predictive_alerts` | 992 | CRITICAL 617 / MEDIUM 374 / HIGH 1 | **EXPIRED 992/992** | có | không | naive + 1 cột tz | id 84–2 981: 2 000 hàng đã bị sweeper xoá; là *hub* thật của hệ (17 nơi gọi `routeAlert`) |
| `predictive_alert_occurrences` | 1 635 | CRITICAL 1 261 | — | — | — | tz | |
| `alert_escalations` | 7 779 | fromLevel 0/1/2 | — | — | — | naive | 2 929 alert; **`notifiedUserIds = []` 7 779/7 779**; cùng alert cùng bậc leo thang ghi 2–3 lần trong < 1 s |
| `machine_status_logs` | 95 971 | — | online 49 008 / offline 46 963 | — | không | naive | 2 498 hàng/24 h, 1 249 máy (offlineMonitor 60 s, ngưỡng 5 phút, luôn bật) |
| `mqtt_alert_history` | 3 183 | không có cột | `isResolved` 2 | không | — | naive | **1 rule (THROUGHPUT_LOW) bắn mỗi 30 phút từ 17/07 đến nay, `notificationSent=false` 3 183/3 183** — cảnh báo "throughput 0" vì không có MQTT thật |
| `mqtt_alert_rules` | 5 | — | enabled 5/5 | | | naive | sức khoẻ broker, không phải cảnh báo nhà máy |
| `andon_events` | 80 | state red 40 / yellow 38 / call 2 | raised 70 / acknowledged 10 | có, MTTA/MTTR | không | naive | MTTA trung bình 1 229 963 s (≈ 14 ngày) — không ai vận hành thật; 70 andon mở từ 07–09/2026 |
| `alarm_taxonomy` | 175 | critical 35 / high 70 / medium 39 / low 12 / diagnostic 19 | — | — | — | naive | vendor + nativeCode → standardCode; unique (vendor, nativeCode); 3 migration seed + seed trong mã |
| `master_alarms` | 13 | priority critical 1 / high 9 / medium 3 | shelvedUntil/isSuppressed | — | — | naive | **đã có rationalization ISA‑18.2** (consequence, timeToRespond, setpoint, deadband, cause) — mẫu tốt cho `alarm_definition` |
| `downtime_events` | 91 | — | — | có | không | naive | 06–07/2026; thuộc OEE (90) nhưng phát sinh từ cảnh báo |
| `interlock_rules` / `interlock_events` | 1 / 3 | — | alert_only 3 | — | | naive | rule SIM "NG‑rate spike" `action=alert`; engine tắt cờ |
| `w3_backup_alerts` | 52 | HIGH 49 | ACTIVE 52 | | | naive | bảng sao lưu không PK, bỏ |
| `failure_events` | 6 | | | | | tz | PdM |
| `safety_events` | 0 | không có cột | outcome | | | naive | |
| Rỗng (19) | 0 | | | | | | `alert_settings`, `alert_history`, `alert_escalation_rules`, `andon_notes`, `mqtt_alert_config`, `mqtt_connection_alerts`, `mqtt_ng_alert_settings`, `mqtt_ng_rate_alert_history`, `mqtt_ng_rate_thresholds`, `yield_alert_thresholds`, `yield_threshold_history`, `mp_spc_alerts`, `model_drift_alerts`, `spc_rule_violations`, `user_notification_preferences`, `factory_alert_versions`, `quality_gate_events`, `deployment_events`, `safety_event_trust` |

Số đo chung: **0 bảng cảnh báo có FK tới `machines`**; **0 hypertable**; mọi cột thời gian naive trừ `predictive_alert_occurrences`, `failure_events`, `safety_event_trust`; 13 bộ từ vựng mức độ (LOW/MEDIUM/HIGH/CRITICAL · info/warning/critical · warning|critical · warn · critical/high/medium/low/diagnostic · priority×consequence · green/yellow/red/call · LOW/NORMAL/HIGH/URGENT · info/low/medium/high/critical · mobile critical…info · bậc 0..3 · không có · chép cứng high/critical).

### 1.3 Backend `[đo]`

| # | Hệ | Tệp chính | LOC | Bảng | Kích hoạt | Tình trạng | Về đâu |
|---|---|---|---|---|---|---|---|
| 1 | Smart alert / predictive (hub) | `aiSmartAlertRouter.ts` 1 371, `services/alerts/decide*` 225, `alertEscalationService.ts`, `alertEvaluatorScheduler.ts`, `alertExpirySweeper.ts` | 2 549 | predictive_alerts, _occurrences, alert_escalations | `routeAlert` inline ~17 chỗ + cron 60 s + 2 phút + 30 phút | sống; **2 bộ leo thang xung đột**; `aiSmartAlertRouting.*` 0 client | lõi `decide*` (dedup, cooldown, suppression) → giữ làm **lõi quyết định**; còn lại gỡ |
| 2 | `alert_settings` cũ | `alertRouters.ts` 602, `db/alerts.ts` 231 | 833 | alert_settings, alert_history, yield_alert_thresholds, yield_threshold_history | evaluator 2 phút | sống; `notifySms` không có sender | → `alarm_definition` (nguồn `kpi`) |
| 3 | MQTT alert rules | `alertEvaluationService.ts` 438 | 508 | mqtt_alert_rules, mqtt_alert_history | 1 phút nếu MQTT_ENABLED | sống, **bắn mù 3 183 lần** | → `alarm_definition` nguồn `system` (sức khoẻ kết nối lấy từ 20 `connection_status`) |
| 4 | MQTT connection alerts + escalation rules | `mqttAlertScheduler.ts` 742, `alertEscalationRouter.ts` 236 | 991 | mqtt_connection_alerts, mqtt_alert_config, alert_escalation_rules | 5 phút, cờ TẮT | tắt | → `notification_rule` (thang leo thang) |
| 5 | NG / FactoryAlert / external | `ngRateAlertService.ts` 806, `externalAlertApi.ts` 531, `fcmService.ts` 456, bulletin 1 125, `ngRateThresholdRouter.ts` 647 | 3 876 | 6 bảng mqtt_ng_* / bulletin / factory_alert_versions | on ingest + cron | sống; **bulletin FCM import hàm không tồn tại** (`sendBulletinPushNotification`) | ngưỡng NG → 60 phát `raiseEvent`; `/api/external/alerts*` thành **adapter đọc** trên `alarm_event` (D7: di động chỉ đọc + ack); bulletin đóng băng cùng FactoryAlert |
| 6 | Andon + SLA | `andonService.ts` 388, `andonRouter.ts` 585, `db/andonBoard.ts` 458 | 1 568 | andon_events, andon_notes | tay + 5 chỗ gọi; SLA sweep cờ TẮT | sống | → `alarm_event(kind=andon)`; giữ hành vi raise/ack/resolve/ghi chú |
| 7 | Interlock | `services/interlock/*` 1 329, `interlockRouter.ts` 985 | 2 314 | interlock_rules, interlock_events | poll 10 s, cờ TẮT | tắt | **ở lại 50**; phát `raiseEvent(kind=interlock)` |
| 8 | Taxonomy / master alarms / adapter bridge | `alarmTaxonomy.ts`, `alarmMasterService.ts` 381, `alarmNormalizer.ts`, `adapterAlarmBridge.ts` | 1 752 | alarm_taxonomy, master_alarms | alarm từ adapter (MTConnect, Euromap, SECS) khi `EQ_INTEG_ENABLED` | tắt; `computeAlarmKpis` chết | `alarm_taxonomy` **giữ**; `master_alarms` → `alarm_definition` |
| 9 | Alarm KPI | `alarmKpiRouter.ts`, `alarmKpiMath.ts` | 607 | đọc andon + predictive | query | sống | giữ công thức, đổi nguồn sang `alarm_event` |
| 10 | SPC alerts (3 kho) | `aiSpcAlertScheduler.ts`, `spcCentralAlertBridge.ts`, `spcAlertSink.ts` | 520 | spc_rule_violations, mp_spc_alerts | analyze path; sweep cờ TẮT | nửa sống | 60 giữ vi phạm SPC làm **kết quả phân tích**; chỉ phát `raiseEvent` khi tới ngưỡng cảnh báo |
| 11 | Notification senders | `notificationService.ts` 486, `_core/notification.ts`, `emailService.ts`, `webhookRouter.ts` 421 | 1 670 | notifications, user_notification_preferences, webhook_* | được gọi | sống; không có Telegram/Zalo/SMS | `notifications` giữ (hộp thư in‑app) + FK `event_id`; sender ở 90 |
| 12 | Máy offline | `_core/offlineMonitor.ts` | 144 | machine_status_logs (+ alert_settings) | 60 s luôn bật | sống | → 30 C1 `comm_lost` + định nghĩa hệ thống `comm_lost` ở 40; `machine_status_logs` → `alarm_journal(kind=state_change)` |
| 13 | Safety events | `safetyAuditService.ts`, `nearMissAdvisor.ts`, `safetyRouter.ts` 1 363 | 1 778 | safety_events | PLC/zone/vision, cờ TẮT | tắt | ở lại 50; phát `raiseEvent(kind=safety)` |
| 14 | Critical‑stop alert | `criticalStopAlert.ts` | 149 | notifications | ~15 chỗ gọi | sống | → `raiseEvent(kind=alarm, priority=1, bypassQuietHours)` |
| 15 | SLO burn‑rate | `sloAlerting.ts` | 322 | → predictive_alerts | OBSERVABILITY | tắt | → `raiseEvent(kind=system)` |
| 16 | PdM | `predictiveMaintenanceService.ts` 1 028 | 1 142 | → predictive_alerts | 30 phút cờ TẮT | tắt | → `raiseEvent(kind=alarm, source=calc)`; `maintenance:alert` in‑memory gỡ |

Socket phát từ server: `inspection:alert`, `spc:violation`, `andon:event`, `safety:event`, `alert:escalation`, `maintenance:alert`, `downtime:start/end`, `machine:status_change/disconnected`, `notification:*`, và hai luồng gộp `ecosystem:event` + `alerts:stream`. **Không client nào nghe** `alert:escalation`, `maintenance:alert`, `downtime:*`, `notification:new` theo tên.

Cờ liên quan (chỉ tên): `ALERT_EVALUATOR_ENABLED`, `ALERT_TTL_HOURS`, `ALERT_RENOTIFY_COOLDOWN_*`, `ROUTE_ALERT_MAX_PER_WINDOW`, `ALERT_EXPIRY_SWEEP_*`, `ALERT_ESCALATION_SWEEP_ENABLED`, `ANDON_SLA_*`, `INTERLOCK_ENGINE_ENABLED`, `EQ_INTEG_ENABLED`, `SPC_CENTRAL_ALERT_*`, `AI_SPC_ALERT_SWEEP_ENABLED`, `MQTT_ENABLED`, `EXTERNAL_MQTT_*`, `FIREBASE_*`, `SMTP_*`, `ALERT_EMAIL_TO`, `WEBHOOKS_ENABLED`, `STOP_ALERT_DEDUP_WINDOW_MS`, `PREDICTIVE_MAINTENANCE_ENABLED`, `OBSERVABILITY`.

### 1.4 Frontend `[đo]`

| Tệp | LOC | Route | Procedure | Socket | Poll | Màu thô |
|---|---|---|---|---|---|---|
| `pages/Alerts.tsx` | 485 | `/alerts` | `alert.*` | — | — | 0 |
| `pages/AndonBoard.tsx` | 952 | `/andon` | `dashboard.getAndonBoard`, `andon.acknowledge` | `andon:event` + 7 sự kiện khác | 15 s | 0 |
| `pages/AlarmKpiDashboard.tsx` | 346 | `/alarm-kpi` | `alarmKpi.summary` | `alerts:stream` | 60 s | 2 |
| `pages/SlaCockpit.tsx` | 519 | `/sla-cockpit` | `andon.metrics/list`, `alertEscalation.recentEscalations` | — | 30 s | 0 (mặc định `success` cho mọi state khác red) |
| `pages/OpsConsole.tsx` + `components/opsconsole/*` | 1 909 | `/ops-console` | 6 nguồn: andon, predictiveAlert, interlock, mqttAlert, alert | `andon:event` | 30/60 s | 4 |
| `pages/MqttAlertRules.tsx` + `EscalationRulesSection.tsx` | 1 158 | `/connectivity?tab=alerts` | `mqttAlert.*`, `alertEscalation.*` | — | 60 s | 0 |
| `pages/EquipmentStandards.tsx` (phần alarm) | ~600/2 093 | `/equipment-standards` | `equipmentStandards.*Alarm*`, `alarmKpi.summary` | — | — | — |
| `pages/MachineCockpit.tsx` / `RobotCockpit.tsx` (tab alarm) | 1 425 / 1 012 | `/machine/:id`, `/robot/:id` | `assetCockpit.machineDetail` | `telemetry:sample` | 10 s | 0 / 5 |
| `components/ShellAlertChip.tsx` | 150 | vỏ | `andon.active/acknowledge/resolve` | — | 15 s | 1 |
| `components/NotificationCenter.tsx` | 462 | vỏ | `notification.*` | `inspection:alert`, `alerts:stream` | 30 s | 15 |
| `components/quality/SpcAlertsPanel.tsx` | 208 | `/quality-cockpit` | `spcAlerts.*` | — | 30 s | 7 |
| `twin3d/van-hanh/{NganXuLy,LopCanhBao,DaiCanhBao}.tsx`, `useTrangThaiSong.ts` | 2 556 | `/twin*` | `andon.*` | `andon:event` | ≤ 20 s | 9 |
| `NotificationSoundCustomization.tsx` (settings), `AlertSoundSettings.tsx` (mồ côi), `AlertWidget.tsx` (mồ côi), `lib/alertSoundService.ts` | 1 563 | — | — | — | — | 12 |
| `FreshnessStrip.tsx`, `PollFreshness.tsx` | 224 | vỏ | — | — | 1 s | 18 (amber) |

Phát hiện: 20 bảng ánh xạ màu; không có `SeverityBadge` dùng chung (`AndonBadge` 1 chỗ, `AlarmPriorityBadge` 1 chỗ sau cờ `isIsa101V2`); âm thanh ở 4 nơi (OpsConsole 880 Hz, AndonBoard chime, alertSoundService, NotificationSoundCustomization — service xuất ra không ai import); shelve chỉ ở EquipmentStandards; snooze chỉ ở NotificationCenter (client, không ghi server); không nơi nào có "out of service".

### 1.5 Kết luận hiện trạng

1. **Một khái niệm, mười sáu bản.** Cùng một "máy X vượt ngưỡng" có thể thành `predictive_alert` + `notifications` ×5 user + email + `andon_event` + `alerts:stream` + `inspection:alert`, mỗi bản một vòng đời, một từ vựng, một màn.
2. **Lũ cảnh báo đã xảy ra trong chính DB dev**: 53 416 thông báo cùng tiêu đề, 0 % được đọc; 3 183 cảnh báo broker chưa từng gửi; 70 andon mở 2 tháng. Hệ đã mất khả năng phân biệt bất thường — đúng tình huống EEMUA 191 cảnh báo (mục tiêu ≤ 1 cảnh báo/10 phút/người vận hành, ≤ 10 trong 10 phút sau sự cố).
3. **Không có trạng thái ISA‑18.2**: không "cleared‑unacked", không shelve có thời hạn cho người vận hành, không OOS cho bảo trì, không suppressed‑by‑design theo trạng thái máy (ví dụ máy đang setup không báo ng_rate).
4. **Leo thang hai bộ, thông báo rỗng** (`notifiedUserIds=[]` 100 %), tức là thang leo thang hiện tại chưa từng tới ai.
5. **Dữ liệu cũ không được tôn trọng**: không hệ nào kiểm `quality/stale` trước khi so ngưỡng; `machine_offline` là hệ riêng thay vì hệ quả của C1 (30).

---

## 2. Mục tiêu: mô hình dữ liệu

### 2.1 Quyết định thiết kế `[QĐ 2026-11-03]`

1. **Một sự kiện = một hàng `alarm_event`**, mọi loại (`kind = alarm | andon | interlock | safety | system | state_change`) và mọi nguồn (tag, KPI 60, SPC, PdM, AI, người). Vòng đời ISA‑18.2 nằm trên hàng đó; mọi chuyển trạng thái ghi **append‑only** vào `alarm_journal` (hypertable, WORM theo luật audit 01 §6).
2. **Một định nghĩa = `alarm_definition`**, thay 6 bảng ngưỡng/quy tắc (`master_alarms`, `alert_settings`, `yield_alert_thresholds`, `mqtt_alert_rules`, `mqtt_ng_rate_thresholds`, `alert_escalation_rules` phần điều kiện). Định nghĩa gắn vào **`tag.role` của lớp** (`asset_class`) hoặc **một tag/asset cụ thể**; có đủ trường rationalization (consequence, time_to_respond, cause, action) — kế thừa từ `master_alarms`.
3. **Bốn mức ưu tiên `priority ∈ {1,2,3,4}`** (1 = nguy cấp, 2 = cao, 3 = trung bình, 4 = thấp) + `diagnostic` là `priority=4, kind=system`; **không giữ 13 từ vựng**; `shared/alarm/priority.ts` là nguồn duy nhất, có bảng ánh xạ một chiều từ từ vựng cũ dùng trong di trú và adapter di động. Phân bổ mục tiêu EEMUA: P1 ≈ 5 %, P2 ≈ 15 %, P3+P4 ≈ 80 % (đo ở KPI).
4. **Trạng thái tách thành cột trực giao** thay vì một enum lớn: `active` (điều kiện còn đúng), `acked_at`, `cleared_at`, `shelved_until`, `suppressed_by` (`design | oos | null`). Trạng thái hiển thị dẫn xuất: `active_unacked`, `active_acked`, `cleared_unacked`, `closed`, `shelved`, `suppressed`, `oos`. Hàng **đóng** khi `cleared_at` và `acked_at` đều có (hoặc `kind` không cần ack).
5. **Một cửa phát: `raiseEvent()`** (nội bộ) thay `routeAlert`, `raiseAndon`, `raiseCriticalStopAlert`, `publishNGAlert`, `notifyOwner` trực tiếp. Dedup theo `dedup_key = (definition_id|kind:code, asset_id)` trong cửa sổ `active`: lần sau chỉ tăng `occurrence_count` + journal `reoccur`. Lõi `services/alerts/decide*` (dedup, cooldown, suppression) giữ làm lõi quyết định (báo cáo §B).
6. **Engine đánh giá ngưỡng chạy trên LiveStore (30)**: on/off‑delay, deadband, hysteresis theo định nghĩa; **tag `quality≠good` hoặc stale ⇒ không so ngưỡng** (chỉ `comm_lost` của connection sinh sự kiện). Máy offline, broker offline, edge mất = **định nghĩa hệ thống** trên `connection_status` (20), không còn `offlineMonitor` riêng.
7. **Thông báo và leo thang là một bảng `notification_rule`** (match: site/area/line, kind, priority, giờ) → thang bậc `[{after_min, channels, recipients}]`; **một scheduler leo thang** (60 s) ghi journal `escalated` và `notification_delivery`. `notifications` giữ làm hộp thư in‑app với FK `event_id`; `user_notification_preferences` giữ (quiet hours) nhưng **P1 bỏ qua quiet hours**.
8. **Andon là `alarm_event(kind=andon)`** với `reason`, `raised_by`, MTTA/MTTR dẫn xuất từ journal; `andon_notes` → `alarm_journal(action=comment)`.
9. **`alarm_taxonomy` giữ nguyên tên**, thêm `priority` (int) thay `severity` varchar, thêm `asset_class_id` thay `machineType/deviceTypeKey`; là bảng tra mã vendor → `alarm_definition` mặc định của lớp.
10. **Hộp thư cũ xoá**: 56 433 `notifications` (100 % chưa đọc, 95 % một tiêu đề) là lũ, không phải dữ liệu; `predictive_alerts` (992 EXPIRED), `alert_escalations` (7 779, không người nhận), `mqtt_alert_history` (3 183 mù) **không di trú**, chỉ giữ `andon_events` (80) và `alarm_taxonomy`/`master_alarms` làm seed. `[QĐ 2026-11-03]`

### 2.2 Đặc tả bảng

#### `alarm_definition`

| Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|---|---|---|---|
| id | bigint identity | | | |
| site_id | bigint FK site | yes | | null = toàn hệ (mẫu của lớp) |
| key | varchar(64) | | | duy nhất trong (site_id, asset_class_id/asset_id); ví dụ `TEMP_HIHI`, `NG_RATE_HI`, `COMM_LOST` |
| name | varchar(160) | | | hiển thị |
| scope_kind | varchar(16) | | | `class` (mọi asset của lớp) · `asset` (một asset) · `tag` (một tag) · `site` (hệ thống) |
| asset_class_id / asset_id / tag_id | bigint FK | yes | | đúng một cột theo `scope_kind` (CHECK) |
| tag_role | varchar(32) | yes | | khi `scope_kind=class`: role trong 20 §2.4; engine tìm tag theo role |
| source | varchar(16) | | `tag` | `tag` (engine ngưỡng) · `kpi` (60/90 gọi `raiseEvent` với `definition_id`) · `external` (adapter/vendor code qua taxonomy) · `manual` (andon) · `system` |
| condition | varchar(16) | | | `hi` · `hihi` · `lo` · `lolo` · `deviation` · `rate_of_change` · `discrete` (= giá trị) · `stale` · `comm_lost` · `rule` (biểu thức ở `expr`) |
| setpoint | numeric | yes | | |
| deadband | numeric | yes | 0 | tuyệt đối theo đơn vị tag |
| on_delay_ms / off_delay_ms | int | | 0 / 0 | lọc nhiễu |
| discrete_value | varchar(64) | yes | | cho `discrete` |
| expr | text | yes | | cho `rule`: biểu thức giới hạn (tập toán tử trắng, không eval tự do) |
| priority | smallint | | | 1–4 |
| consequence | varchar(16) | yes | | `none/minor/major/severe` (rationalization) |
| time_to_respond_min | int | yes | | |
| cause / action | text | yes | | hiển thị trên hàng cảnh báo (ISA‑18.2 §6) |
| requires_ack | boolean | | true | P4/system có thể không cần ack |
| auto_clear | boolean | | true | false = andon/manual phải resolve |
| suppressed_when | jsonb | yes | | suppressed‑by‑design: `{ "state_in": ["SETUP","OFF"] }` tra `tag.role=state`/`run` |
| shelve_max_min | int | | 480 | trần shelve người vận hành |
| enabled | boolean | | true | |
| approved_by / approved_at / def_hash | | yes | | định nghĩa đổi ⇒ phải duyệt lại (kế thừa `approvedDefHash` của interlock) |
| origin | varchar(8) | | `real` | `real/sim/qa` theo site (10) — engine không trộn |
| created_by/at, updated_by/at, deleted_at | timestamptz | | | |

Index: `(site_id, enabled)`, `(asset_class_id, tag_role)`, `(asset_id)`, `(tag_id)`; unique `(coalesce(site_id,0), scope_kind, coalesce(asset_class_id,0), coalesce(asset_id,0), coalesce(tag_id,0), key) where deleted_at is null`.

#### `alarm_event`

| Cột | Kiểu | Null | Ghi chú |
|---|---|---|---|
| id | bigint identity | | |
| site_id | bigint FK site | | RLS |
| kind | varchar(16) | | `alarm · andon · interlock · safety · system · state_change` |
| definition_id | bigint FK alarm_definition | yes | null cho andon tay / state_change |
| asset_id / tag_id | bigint FK | yes | |
| line_id | bigint FK line | yes | chép từ asset lúc phát để lọc nhanh |
| code | varchar(64) | | `definition.key` hoặc `ANDON_<reason>` / `INTERLOCK_<rule>` / vendor standardCode |
| priority | smallint | | 1–4 |
| message | varchar(240) | | đã i18n‑key hoá: `msg_key` + `msg_args jsonb` (01 §F1) |
| value / limit / unit | numeric / numeric / varchar | yes | tại lúc phát |
| quality_at_raise | varchar(12) | | `good/uncertain/bad` của tag lúc phát (bất biến 2) |
| raised_at | timestamptz | | |
| raised_by_kind / raised_by_id | varchar(8) / bigint | | `user/ai/system/machine` (01 §6) |
| active | boolean | | điều kiện còn đúng |
| cleared_at | timestamptz | yes | |
| acked_at / acked_by | timestamptz / bigint FK user | yes | |
| shelved_until / shelved_by / shelve_reason | | yes | |
| suppressed_by | varchar(8) | yes | `design` · `oos` |
| escalation_level | smallint | | 0 |
| occurrence_count | int | | 1 |
| last_occurred_at | timestamptz | | |
| dedup_key | varchar(128) | | unique partial `where active` |
| reason | varchar(16) | yes | andon: `quality/material/maintenance/safety/setup/other` |
| source_ref | jsonb | yes | `{ "inspectionId": …, "spcViolationId": …, "interlockEventId": … }` |
| origin | varchar(8) | | `real/sim/qa` |
| closed_at | timestamptz | yes | = max(cleared_at, acked_at) khi đủ điều kiện; index cho "đang mở" |

Index: `(site_id, closed_at) where closed_at is null` (đang mở), `(asset_id, raised_at desc)`, `(raised_at desc)`, `(definition_id, raised_at desc)`. Retention: hàng đóng > 2 năm xoá (trước đó đã tổng hợp KPI). Không hypertable (bảng mutable, ≤ vài triệu hàng/năm ở tải EEMUA).

#### `alarm_journal` (hypertable, WORM)

`id, event_id FK, ts timestamptz, action varchar(16)` (`raised · reoccur · acked · cleared · shelved · unshelved · suppressed · unsuppressed · oos · in_service · escalated · notified · undelivered · comment · resolved · auto_closed`), `actor_kind/actor_id`, `note text`, `data jsonb` (giá trị, bậc, kênh). Chunk 7 d, nén 30 d, giữ 3 năm. Trigger cấm UPDATE/DELETE (như `audit_trail`).

#### `notification_rule`

`id, site_id, name, enabled, match jsonb` (`{kinds, priorities, line_ids, asset_class_ids, hours}`), `ladder jsonb` = `[{ after_min: 0, channels: ["inapp","socket"], to: {roles:["operator"], users:[], scope:"line"} }, { after_min: 10, channels:["email","push"], to:{roles:["supervisor"]} }, { after_min: 30, channels:["email","webhook"], to:{roles:["manager"], webhooks:[id]} }]`, `repeat_min` (nhắc lại khi chưa ack), `bypass_quiet_hours boolean` (mặc định true với P1), `approved_by/at`, timestamps. Mặc định seed một quy tắc/site: P1 0‑5‑15 phút, P2 0‑15‑60, P3 0‑60, P4 chỉ in‑app.

#### `notification_delivery`

`id, event_id FK, rule_id FK, level smallint, channel varchar(12), recipient_kind/recipient_id, status varchar(12)` (`queued/sent/failed/skipped_quiet`), `sent_at, error text`. Index `(event_id)`, `(status, sent_at)`. Retention 180 d. Thay `webhook_delivery_logs` phần cảnh báo và `alert_escalations`.

#### `notifications` (giữ, sửa)

Thêm `event_id bigint FK alarm_event null`, `priority` → smallint 1–4 (ánh xạ URGENT→1, HIGH→2, NORMAL→3, LOW→4), `created_at` → timestamptz; unique `(user_id, event_id, kind)` để một sự kiện không gửi hai lần cho một người. Xoá nội dung cũ (QĐ10).

#### `alarm_taxonomy` (giữ, sửa)

`severity varchar` → `priority smallint`; thêm `asset_class_id FK` (giữ `vendor`, `native_code`, `standard_code`, `description`, `recommended_action`); `machineType/deviceTypeKey` bỏ sau A2 (20); timestamps → timestamptz.

#### Kiểu dùng chung `shared/alarm/types.ts`

```ts
export type AlarmPriority = 1 | 2 | 3 | 4;
export type AlarmKind = 'alarm' | 'andon' | 'interlock' | 'safety' | 'system' | 'state_change';
export type AlarmState = 'active_unacked' | 'active_acked' | 'cleared_unacked' | 'closed' | 'shelved' | 'suppressed' | 'oos';
export type AlarmEvent = { id: number; siteId: number; lineId?: number; assetId?: number; tagId?: number; kind: AlarmKind; code: string; priority: AlarmPriority; state: AlarmState; msgKey: string; msgArgs?: Record<string, string | number>; value?: number; limit?: number; unit?: string; qualityAtRaise: 'good' | 'uncertain' | 'bad'; raisedAt: number; ackedAt?: number; clearedAt?: number; shelvedUntil?: number; escalationLevel: number; occurrenceCount: number; origin: 'real' | 'sim' | 'qa' };
export type RaiseInput = { kind: AlarmKind; siteId: number; assetId?: number; tagId?: number; definitionId?: number; code?: string; priority?: AlarmPriority; msgKey: string; msgArgs?: Record<string, string | number>; value?: number; limit?: number; unit?: string; sourceRef?: Record<string, number | string>; actor: { kind: 'user' | 'ai' | 'system' | 'machine'; id?: number }; reason?: string; bypassQuietHours?: boolean };
```

### 2.3 Bảng gỡ / chuyển

| Bảng cũ | Đi đâu |
|---|---|
| `predictive_alerts`, `predictive_alert_occurrences`, `alert_escalations` | gỡ; không di trú dữ liệu (QĐ10) |
| `alert_settings`, `alert_history`, `yield_alert_thresholds`, `yield_threshold_history` | định nghĩa → `alarm_definition(source=kpi)`; lịch sử gỡ (rỗng) |
| `mqtt_alert_rules`, `mqtt_alert_history`, `mqtt_alert_config`, `mqtt_connection_alerts` | → định nghĩa hệ thống trên `connection_status`; lịch sử gỡ |
| `alert_escalation_rules`, `user_notification_preferences` (quiet hours giữ) | → `notification_rule` |
| `mqtt_ng_rate_thresholds`, `mqtt_ng_rate_alert_history`, `mqtt_ng_alert_settings` | ngưỡng → `alarm_definition(source=kpi, tag_role=ng_rate)`; 60 gọi `raiseEvent` |
| `andon_events`, `andon_notes` | → `alarm_event(kind=andon)` + `alarm_journal(comment)`; di trú 80 hàng |
| `master_alarms` | → `alarm_definition(scope_kind=class)`; di trú 13 hàng |
| `machine_status_logs` | → `alarm_journal(kind=state_change)` **chỉ từ nay**; 95 971 hàng cũ gỡ sau khi OEE (90) xác nhận không đọc `[cần kiểm]` |
| `mp_spc_alerts`, `spc_rule_violations` | ở lại 60 (kết quả phân tích); chỉ ngưỡng cảnh báo mới thành sự kiện |
| `interlock_rules/events`, `safety_events`, `safety_event_trust` | ở lại 50; phát `raiseEvent` |
| `downtime_events` | ở lại 90 (OEE); từ nay sinh từ `alarm_event(kind=state_change)` |
| `w3_backup_alerts`, `factory_alert_versions`, `mqtt_bulletin_*`, `model_drift_alerts`, `quality_gate_events`, `deployment_events`, `model_rollback_events`, `vram_events` | không phải cảnh báo nhà máy: w3 gỡ; bulletin/FactoryAlert đóng băng (Q10); drift/rollback/vram ở 80; quality_gate 60; deployment 90 |

---

## 3. Mục tiêu: backend

### 3.1 Cấu trúc `server/modules/alarm/`

| Tệp | Vai trò |
|---|---|
| `raise.ts` | `raiseEvent(input: RaiseInput)` — cửa duy nhất: kiểm phạm vi, tra định nghĩa, suppressed‑by‑design, OOS, dedup (`decide*` lõi), ghi `alarm_event` + journal `raised/reoccur`, phát bus `alarm.changed` |
| `engine.ts` | chạy ở **worker**: tap bus tín hiệu (30 `LiveStore`), giữ máy trạng thái per (definition, asset): on/off delay, deadband; bỏ qua mẫu `quality≠good`/stale; `clear()` khi điều kiện hết + off_delay; định nghĩa `comm_lost`/`stale` nghe `connection_status` |
| `lifecycle.ts` | `ack`, `shelve`, `unshelve`, `suppress/unsuppress`, `oos/inService`, `resolve` (andon), `comment`, `autoClose`; mọi hàm ghi journal; kiểm `shelve_max_min`, quyền |
| `escalation.ts` | scheduler 60 s: với sự kiện mở chưa ack ⇒ bậc kế tiếp theo `notification_rule.ladder`; ghi `escalated` + gọi `notify.ts`; **một bộ duy nhất** |
| `notify.ts` | chọn người nhận (vai trò × phạm vi 10 `user_scope`), quiet hours, ghi `notification_delivery`, gọi sender 90 (`inapp`, `socket`, `email`, `webhook`, `push`); lỗi ⇒ `undelivered` journal (bất biến 3) |
| `flood.ts` | bộ đếm trượt per site: > 10 sự kiện mới/10 phút ⇒ gộp thành một sự kiện `system/ALARM_FLOOD` P2, các sự kiện con vẫn ghi nhưng không thông báo riêng (EEMUA 191) |
| `kpi.ts` | công thức từ `alarmKpiMath.ts` đổi nguồn: tần suất/10 phút, phân bổ ưu tiên, MTTA/MTTR, top 10 "bad actors", % shelved, % stale‑at‑raise |
| `router.ts` | namespace `alarm.*` |
| `legacyAdapters/` | `externalAlerts.ts`: `/api/external/alerts*` đọc/ack trên `alarm_event` cho app di động đóng băng (D7); `ecosystemStream.ts`: `alerts:stream` phát `AlarmEvent` canonical |

Thứ tự `raiseEvent`: phạm vi (site RLS) → định nghĩa/ưu tiên → `suppressed_when` (tra tag `state/run` sống) → OOS của asset/definition → shelved đang hiệu lực (ghi journal `reoccur` nhưng không thông báo) → dedup theo `dedup_key where active` → ghi → bus → `notify(level 0)`. Mọi bước là hàm thuần có test đột biến (01 §10).

### 3.2 Procedure `alarm.*`

| Procedure | Loại | Vào | Ra | Ghi chú |
|---|---|---|---|---|
| `alarm.active` | permission(alarm_view) | `{scope?, kinds?, priorities?, includeShelved?}` | `AlarmEvent[]` + `{seq, serverTs}` | ≤ 500 hàng, sắp theo ưu tiên rồi thời gian |
| `alarm.list` | permission(alarm_view) | lọc + con trỏ thời gian | trang | lịch sử (đóng) |
| `alarm.get` | permission(alarm_view) | `{id}` | event + journal + delivery + định nghĩa (cause/action) | |
| `alarm.ack` / `alarm.ackMany` | permission(alarm_ack) | `{ids, note?}` | | người vận hành; ghi journal `acked` |
| `alarm.shelve` / `alarm.unshelve` | permission(alarm_shelve) | `{id, minutes, reason}` | | ≤ `shelve_max_min`; hết hạn tự unshelve (scheduler) |
| `alarm.resolve` | permission(alarm_ack) | `{id, note}` | | andon/manual (`auto_clear=false`) |
| `alarm.comment` | permission(alarm_view) | `{id, note}` | | |
| `alarm.raiseAndon` | permission(andon_raise) | `{assetId|lineId, reason, priority?, note}` | event | thay `andon.raise/quickReport` |
| `alarm.setOutOfService` / `returnToService` | permission(alarm_oos) | `{assetId|definitionId, until, reason}` | | kỹ sư; journal `oos/in_service` |
| `alarm.definition.list/get/create/update/approve/disable/archive` | permission(alarm_manage) | | | sửa ⇒ `def_hash` đổi ⇒ `approved_at=null` ⇒ engine bỏ qua tới khi duyệt |
| `alarm.definition.test` | permission(alarm_manage) | `{id, sampleValues[]}` | kết quả máy trạng thái | chạy khô, không phát |
| `alarm.taxonomy.list/upsert/map` | permission(alarm_manage) | | | thay `equipmentStandards.*Alarm*` |
| `alarm.notificationRule.list/create/update/approve/toggle/test` | permission(notification_rule_manage) | | | `test` gửi tới chính người gọi |
| `alarm.kpi.summary` | permission(alarm_view) | `{scope, from, to}` | bảng KPI | thay `alarmKpi.summary` |
| `alarm.inbox.list/markRead/markAllRead` | protected | | | thay `notification.*` phần cảnh báo |
| `alarm.raiseTest` | admin | `{priority}` | | nghiệm thu kênh |

Nội bộ (không qua tRPC): `raiseEvent`, `clearEvent`, `onConnectionStatus` (20 → 40), `registerKpiSource` (60/90 đăng ký `definition.source=kpi`).

Phạm vi: `alarm_event.site_id` + RLS `app.site_ids` (10); `alarm.active` lọc thêm theo `user_scope` level line khi có.

### 3.3 Kênh đẩy

- Giữ **tên luồng `alerts:stream` đã có**, đổi payload thành `{seq, serverTs, op: 'snapshot'|'upsert'|'close', events: AlarmEvent[]}`; snapshot khi subscribe (phạm vi theo phiên), delta theo `alarm.changed` trên bus. Không thêm `socket.join`/`io.emit` mới (ràng buộc #22); dùng emitter sẵn có của 1a khi 1a lên main (30 §3.3), trước đó dùng emitter hiện tại của `alerts:stream`.
- Gỡ phát riêng: `inspection:alert`, `spc:violation`, `andon:event`, `safety:event`, `alert:escalation`, `maintenance:alert`, `machine:disconnected` (client đã không nghe hoặc đổi sang `alerts:stream`); `machine:status_change` giữ cho 30/90 tới khi 1a.
- Client không `io()` riêng; qua `lib/live/` (30 §4).

### 3.4 Thông báo

Kênh ở v1: `inapp` (bảng `notifications` + `alerts:stream`), `email` (SMTP 90), `webhook` (90, HMAC), `push` (FCM cho app di động đóng băng). **Không** thêm Telegram/Zalo/SMS (không có sender; chưa có yêu cầu). Mọi lần gửi ghi `notification_delivery`; thất bại ⇒ journal `undelivered` và sự kiện hiện huy hiệu "chưa tới ai" trên màn.

### 3.5 Cờ

Bật mặc định: engine, leo thang, flood. Cờ còn lại: `ALARM_ENGINE_ENABLED` (tắt chỉ để chẩn đoán), `ALARM_LEGACY_SHADOW` (giai đoạn AL3: hệ cũ vẫn chạy, mỗi sự kiện cũ ghi bản sao qua `raiseEvent` để so khớp). Gỡ 20 cờ cũ ở §1.3 khi cắt nguồn.

---

## 4. Mục tiêu: frontend

### 4.1 Màn `/canh-bao` (một màn, thay 8)

Vùng Giám sát (báo cáo §IA). Quyền `alarm_view`. Tab:

| Tab | Nội dung | Procedure |
|---|---|---|
| **Đang mở** (mặc định) | bảng ảo hoá theo ưu tiên → thời gian; cột: ưu tiên (glyph hình + số + chữ), tài sản (breadcrumb ISA‑95), mã + thông điệp, giá trị/giới hạn (ô số; **tím gạch nếu tag đang stale**), tuổi, trạng thái ISA‑18.2, bậc leo thang, nút Ack/Shelve/Mở chi tiết; chọn nhiều ⇒ Ack hàng loạt; bộ lọc phạm vi/kind/ưu tiên/đã shelve; âm thanh P1 mới (một dịch vụ, một nút tắt) | `alarm.active` + `alerts:stream` |
| **Andon** | bảng theo line: ô máy, trạng thái, andon mở, nút Kéo andon (lý do), Ack, Resolve; chế độ TV (`?tv`) không thao tác | `alarm.active kinds=[andon]`, `alarm.raiseAndon/ack/resolve` |
| **Lịch sử** | con trỏ thời gian, lọc, xuất CSV; mở chi tiết = journal timeline + delivery | `alarm.list`, `alarm.get` |
| **KPI** | tần suất/10 phút theo ca, phân bổ ưu tiên so 5/15/80, MTTA/MTTR, top 10 bad actors, % stale‑at‑raise, % shelved, "cảnh báo đứng" (> 24 h) | `alarm.kpi.summary` |
| **Định nghĩa** | danh sách theo lớp/asset; form (ngưỡng, deadband, delay, ưu tiên, rationalization), thử nghiệm khô, duyệt; taxonomy vendor | `alarm.definition.*`, `alarm.taxonomy.*` |
| **Thông báo** | quy tắc + thang leo thang (bộ soạn bậc), gửi thử, nhật ký giao | `alarm.notificationRule.*` |

Chi tiết sự kiện (`AlarmDrawer`, ngăn phải của vỏ): thông điệp, cause/action từ định nghĩa, sparkline tag 15 phút (`TrendPanel` 30), journal, delivery, nút Ack/Shelve/Resolve/Comment/OOS (theo quyền), liên kết mở L3 máy.

### 4.2 Vỏ và các màn khác

- `AlarmChip` (thay `ShellAlertChip`): số P1/P2 đang mở chưa ack trong phạm vi, nhấp mở `/canh-bao`; nhấp nháy chỉ khi có P1 chưa ack; nguồn `alerts:stream`.
- `AlarmStrip` (SCADA L2/L3, spec v3 §5.1‑7): 3 hàng ưu tiên cao nhất, bấm nhảy tới ký hiệu. Dùng cùng dữ liệu.
- `AlarmBadge` (hình + số + chữ: ■1 ▲2 ▼3 ●4, token `--alarm-p1..p4` ở `index.css`); **là component duy nhất** vẽ ưu tiên; 20 bảng ánh xạ cũ gỡ; ESLint cấm lớp màu thô ở `components/alarm/` và `pages/canh-bao/`.
- Tab "Cảnh báo" ở L3 máy (`/giam-sat/may/:id`) và L2 line: `AlarmTable` lọc theo asset/line, cùng component.
- Twin 3D `LopCanhBao/DaiCanhBao`: giữ, đổi nguồn sang `useAlarmSong()` và `AlarmBadge` (cùng token).
- Hộp thư in‑app (`NotificationCenter`): giữ chuông, nội dung = `alarm.inbox.*`; xoá lớp màu thô (15).
- Âm thanh: một `lib/alarmSound.ts` (P1 mới: 2 nhịp; andon kéo: 1 nhịp), tắt/bật lưu theo người dùng; gỡ 3 bộ còn lại.

Gỡ/chuyển: `Alerts`, `AndonBoard`, `AlarmKpiDashboard`, `SlaCockpit`, `OpsConsole` (+ `opsconsole/*`), `MqttAlertRules`, `EscalationRulesSection`, `EquipmentStandards` tab alarm, `SpcAlertsPanel` (→ 60 đọc `alarm.active kinds=[alarm] code like SPC_%`), `AlertSoundSettings`, `AlertWidget`, `NotificationSoundCustomization`, `alertSoundService`, `useSpcAlertToast` (→ toast chung từ `alerts:stream` P1/P2). Route cũ `/alerts`, `/andon`, `/alarm-kpi`, `/sla-cockpit`, `/ops-console`, `/predictive-alerts`, `/mqtt-alerts` → redirect `/canh-bao?tab=…`.

### 4.3 Hook/dữ liệu client

`lib/live/useAlarmSong(scope)` (snapshot + delta, seq, tự resubscribe), `useAlarmKpi`, `useAlarmDefinitions`. i18n namespace `canhBao.*` (một), thông điệp sự kiện render từ `msgKey+msgArgs` (không chuỗi tiếng Việt từ server).

---

## 5. Di trú từ hiện trạng

Dải migration: **0510–0529** `[QĐ 2026-11-03: duyệt]`. Phụ thuộc: 20‑A3 (asset/tag/connection_status) và 30‑T2 (LiveStore nuôi mọi tag) trước AL4; không đụng `services/interlock/*`, `services/safety/*` trước A2(o) (50).

| Bước | Việc | Nghiệm thu |
|---|---|---|
| **AL0** | Gỡ lịch `detectDefectSpike/detectYieldDrop` phát 5 user (xong 04/11, do-model 7072d4eda; nghiệm thu đếm `notifications` THEO NGUỒN 2 bộ dò = 0, không đếm tổng); THROUGHPUT_LOW chỉ bắn khi luồng MQTT từng sống 24 h trước; xoá dữ liệu lũ (`notifications` 56 433, `alert_escalations`, `mqtt_alert_history`) **sau khi chủ dự án xác nhận** (Q2); sửa import `sendBulletinPushNotification` (bug) hoặc tắt bulletin | `notifications` 24 h < 50; không còn lỗi import |
| **AL1** | Tạo `alarm_definition`, `alarm_event`, `alarm_journal` (hypertable + trigger WORM), `notification_rule`, `notification_delivery`; sửa `notifications`, `alarm_taxonomy`; `shared/alarm/*`; RLS theo `site_id` | DDL `--test-only` xanh; census |
| **AL2** | Seed: `master_alarms` 13 → định nghĩa lớp; `alarm_taxonomy` priority; định nghĩa hệ thống `COMM_LOST`/`STALE` mỗi site; `notification_rule` mặc định mỗi site; di trú `andon_events` 80 → `alarm_event` | đếm khớp 13/175/80 |
| **AL3** | `raiseEvent` + lifecycle + router `alarm.*`; **chạy song song 2 tuần** (`ALARM_LEGACY_SHADOW`): 5 cửa cũ gọi thêm `raiseEvent`; so khớp số lượng và ưu tiên hằng ngày (rủi ro P0 của báo cáo) | bảng so khớp ≥ 95 % trùng; chênh lệch được giải thích |
| **AL4** | Engine trên LiveStore + `onConnectionStatus`; gỡ `offlineMonitor`; flood control; một bộ leo thang + notify + delivery | N3–N6 |
| **AL5** | Màn `/canh-bao` 6 tab, `AlarmBadge/Chip/Strip/Drawer`, `useAlarmSong`; redirect 7 route; hộp thư đổi nguồn | N8–N10 |
| **AL6** | Cắt nguồn cũ: `routeAlert`, `raiseAndon`, `raiseCriticalStopAlert`, `publishNGAlert`, `notifyOwner` trực tiếp → `raiseEvent`; gỡ 15 hệ (§1.3), 8 trang + component (§4.2), 20 cờ; adapter `/api/external/alerts*` | census: 0 chỗ gọi cũ; `check:tests` |
| **AL7** | Gỡ bảng (§2.3); `machine_status_logs` sau khi 90 xác nhận; retention journal/delivery | bảng cảnh báo 39 → 7 |

---

## 6. Tiêu chí nghiệm thu module

| # | Tiêu chí | Đo bằng |
|---|---|---|
| N1 | Một cửa: grep `routeAlert\|raiseAndon\|raiseCriticalStopAlert\|publishNGAlert\|notifyOwner(` ngoài `modules/alarm/` = 0 | grep |
| N2 | Một từ vựng: không còn chuỗi `critical\|high\|medium\|low\|warning\|URGENT` làm mức độ ngoài `shared/alarm/priority.ts` và bảng ánh xạ di trú | grep/census |
| N3 | Tag stale/bad không sinh cảnh báo ngưỡng (đột biến: bỏ kiểm quality ⇒ test đỏ) | vitest |
| N4 | Dedup: 100 lần vượt ngưỡng liên tiếp trên một tag ⇒ 1 `alarm_event` active, `occurrence_count=100`, 1 thông báo bậc 0 | vitest + DB |
| N5 | Leo thang: P1 chưa ack 5 phút ⇒ bậc 1 có `notification_delivery` tới ≥ 1 người thật trong phạm vi; không bao giờ `recipients=[]` không có `undelivered` | vitest (clock giả) |
| N6 | Flood: 50 sự kiện/10 phút ⇒ 1 `ALARM_FLOOD` + ≤ 10 thông báo | vitest |
| N7 | Shelve hết hạn tự quay lại; shelve > `shelve_max_min` bị từ chối; OOS chặn phát nhưng vẫn ghi journal | vitest |
| N8 | `/canh-bao` cập nhật ≤ 1 s sau `raiseEvent` qua `alerts:stream` (không poll) | Playwright |
| N9 | Lớp màu thô trong `components/alarm/`, `pages/canh-bao/` = 0; mọi ưu tiên qua `AlarmBadge` (hình + số + chữ) | ESLint + grep |
| N10 | Trang cũ 8 → 1; 7 route redirect | Playwright |
| N11 | Bảng cảnh báo 39 → 7 (`alarm_definition, alarm_event, alarm_journal, notification_rule, notification_delivery, notifications, alarm_taxonomy`) | SQL |
| N12 | Adapter di động: `/api/external/alerts` trả cùng số sự kiện mở với `alarm.active` cho cùng phạm vi | test hợp đồng |
| N13 | KPI 7 ngày sau AL6 trên site thật/sim: tần suất ≤ 1/10 phút/người vận hành ở chế độ ổn định (nếu không đạt ⇒ rationalization lại định nghĩa, không tắt engine) | `alarm.kpi.summary` |

---

## 7. Câu hỏi mở — đã trả lời `[QĐ 2026-11-03]`

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| 1 | Số mức ưu tiên | **4 mức 1–4**; P4 không nhấp nháy/âm thanh, không cần ack; spec SCADA v3 hiển thị P1–P3 | `shared/alarm/priority.ts`; §4.2 `AlarmBadge` |
| 2 | Xoá dữ liệu lũ | **Đồng ý xoá, không di trú**: `notifications` 56 433, `alert_escalations` 7 779, `predictive_alerts(+occurrences)` 2 627, `mqtt_alert_history` 3 183; `machine_status_logs` 95 971 sau khi 90 xác nhận; giữ `andon_events` 80, `master_alarms` 13, `alarm_taxonomy` 175 | AL0/AL7; dieu-phoi duyệt SQL, báo trước khi chạy (01 §9‑19) |
| 3 | Interlock/safety | **Ở lại 50**, chỉ phát `raiseEvent`; `action=alert` thành `alarm_definition(condition=rule)` khi 50 viết | 50 |
| 4 | Kênh thông báo | **Chỉ in‑app/email/webhook/push**; không Telegram/Zalo/SMS ở v1 | §3.4 |
| 5 | App di động | **Giữ `/api/external/alerts*` làm adapter chỉ đọc + ack** trên `alarm_event` (D7) | `legacyAdapters/externalAlerts.ts`; N12 |
| 6 | Thang leo thang mặc định | **Đồng ý seed** P1 0‑5‑15, P2 0‑15‑60, P3 0‑60, P4 in‑app | AL2 |
| 7 | Dải migration 0510–0529 | **Đồng ý** | §5 |
| 8 | Chạy song song 2 tuần | **Đồng ý** (`ALARM_LEGACY_SHADOW`) | AL3 |

---

## 8. Nhật ký

| Ngày | Phiên | Việc | Số đo |
|---|---|---|---|
| 2026-11-03 | chủ dự án + chu-du-an-HST | **Duyệt v1.1**: 8 câu hỏi §7 theo khuyến nghị (4 mức; xoá dữ liệu lũ; interlock/safety ở 50; 4 kênh; adapter di động; thang mặc định; mig 0510–0529; song song 2 tuần) | — |
| 2026-11-03 | chu-du-an-HST | Viết v1 từ kiểm kê read-only `_ai8_wt ec76a24f6` + DB live | 16 hệ / 21,2k LOC / ~39 bảng (19 rỗng); 13 từ vựng BE + 20 ánh xạ màu FE; 56 433 thông báo 100 % chưa đọc (53 416 một tiêu đề); 7 779 leo thang 0 người nhận; 3 183 cảnh báo broker mù; 5 cửa phát; 2 bộ leo thang |
| 2026-11-04 | chu-du-an-HST | Mockup `/canh-bao` (luong-ui): **P1 ack từng hàng; P2–P4 ack hàng loạt; "Ack nhóm" chỉ cho cảnh báo thứ cấp trong lũ**; ngưỡng lũ mặc định 10/10 phút, cấu hình theo site qua `setting` (90); lũ mất kết nối = một `COMM_LOST` theo connection, tag con không thành cảnh báo riêng (30 C1); `AlarmDrawer` 440 px ngăn phải của vỏ | — |
| 2026-11-04 | chu-du-an-HST | **AlarmChip (vỏ) nhấp nháy theo NGUỒN của chính P1 chưa ack**: nguồn tươi ⇒ nhấp nháy dù line khác cũ; chỉ đứng yên + dấu cũ khi P1 thuộc nguồn cũ hoặc toàn phạm vi cũ ("có cũ bất kỳ ⇒ tắt chip" bị bác vì fail-open). Mockup 5 màn: kiem-dinh ĐẠT trọn (luong-ui a6771ddef, scada-ui 6b62c2c42) | 7 phép × 50 lượt |
| 2026-11-04 | dieu-phoi | AL0‑3 xoá dữ liệu lũ trên DEV (`aoi_management`, avi_app, mỗi mục 1 giao dịch + expect‑n): `notifications` 56 460 → 0; `alert_escalations` 7 779 → 0; `predictive_alerts` EXPIRED 992 (+1 635 occurrences cascade) → 0; `mqtt_alert_history` 3 221 → 0 (lệch +2 so số duyệt — rule THROUGHPUT_LOW vẫn bắn tới lúc xoá ⇒ AL0‑1/AL0‑2 phải chặn gốc). `machine_status_logs` KHÔNG xoá (OEE đọc: `oeeService.ts`, `productionDashboardRouter.ts:567`) | 0 / 0 / 0 / 0 |
| 2026-11-06 | do-model | **AL0‑2 XONG** `df263f94a`: thêm `sendBulletinPushNotification` (fcmService), `publishBulletin` import có kiểu, bỏ `as any` + rào `typeof`; trước đó cờ "Gửi FCM Push" không gửi gì và không báo lỗi | lỗi import = 0 (tsc + test đường gửi thật, chỉ giả `fetch`; đột biến 5/5) |
| 2026-11-08 | kiem-dinh | §9 sau pha 0: `notifications` 56 460→0, `alert_escalations` 7 779→0, `predictive_*` 992+1 635→0; `mqtt_alert_history` 3 221→75 **hàng mới** sau xoá (rule còn bắn — AL0‑2 xác nhận nguồn trước khi kết luận) | — |
| 2026-11-08 | dieu-phoi | **AL0‑2 nguồn 75 hàng `mqtt_alert_history` mới**: 100 % rule 3 THROUGHPUT_LOW (0 msg/min < ngưỡng 1, mỗi 30 phút, `notificationSent=false`), hai đợt 03/11 22:02→04/11 08:xx và 06/11 06:xx→07/11 08:05; từ 07/11 08:05 **0 hàng** (> 36 h). **ĐÃ XÁC MINH (rút suy luận "luồng tắt")**: `mqtt_message_logs` 948 hàng, mới nhất 26/09 ⇒ không có luồng MQTT nào trong tháng 11; theo mã AL0‑1 (`coMessageTruocCuaSo`) không message 24 h ⇒ rule KHÔNG bắn, nên 75 hàng **đến từ build CHƯA có AL0‑1** (`02c3db8c1`, `8442b0690`; `triggeredAt` naive = UTC → đợt 1 04/11 05:02→15:3x khớp log `server3000-1104-02c3db8c1`, đợt 2 06/11 13:0x→07/11 15:05 khớp log `server3000-1106`/`8442b0690`). Từ build có AL0‑1 chạy (08/11 04:08) tới nay **0 hàng/17 h** ⇒ AL0‑1 có tác dụng thật; tiêu chí AL0‑2 về nguồn **đóng**. 75 hàng là rác cùng loại AL0‑3d — mặc định GIỮ; xoá phải trình chủ dự án kèm số đếm. Không gửi thông báo. Lỗi import `sendBulletinPushNotification` không còn (export ở `fcmService.ts:407`) | — |
