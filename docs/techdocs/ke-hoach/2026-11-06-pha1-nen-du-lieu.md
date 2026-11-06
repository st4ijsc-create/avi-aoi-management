# Pha 1 · Nền dữ liệu — gói việc bàn giao dieu‑phoi

| | |
|---|---|
| Nguồn | 00‑INDEX "Lộ trình tổng hợp" pha 1; §5 của 10, 20, 30, 40, 50, 60, 90 |
| Mục tiêu pha | Một cây ISA‑95 có `site_id`; `asset`/`asset_class`/`connection`/`tag` có FK; tín hiệu neo `tag_id` + LiveStore + C1; `raiseEvent` + bảng alarm chạy song song; `setting`/`audit_trail`/`credential`/job registry + worker; hợp đồng `InspectionV3` chạy bóng; `command_request` (sau A2(o)) |
| Điều kiện mở pha | **Pha 0 đã gộp main** (5 nhánh `feat/pha0-*`) và kiem‑dinh có số "sau"; main xanh census + `check:tests` |
| Điều kiện cứng | Không chạm `services/scada/*`, `services/ot/commandDispatcher.ts`, `otDeviceWrite.ts`, `services/edge/*` trước **A2(o) trọn** (lô 50‑C1/C2 và 20‑A4 chờ); 30‑T4 (socket) **không thuộc pha 1** (chờ 1a + 2 cờ); mọi migration: SQL gửi dieu‑phoi duyệt → `--test-only` trên `_test` → DEV bằng owner `aoi` → chạy census catalog (`edgeDbSearchPath*`, 0376/0377) vì có hàm/bảng mới; test không dùng owner `aoi`, dọn bằng ROLLBACK; mọi con số DB kèm `current_database()` |
| Nguyên tắc tương thích | Mọi bước **thêm song song** (cột/bảng/namespace mới + alias/wrapper/view cũ); không đổi tên bảng, không gỡ cột cũ trong pha 1 (đổi tên ở pha 4: H7, A8, T8) |
| Ước lượng | 3–4 tuần, 3 luồng song song sau khi 20‑A3 xong |

## 1. Thứ tự và phụ thuộc

```
10-H1 → H2 → H3 → (H5 ∥ 20-A1) → H6
                 20-A1 → A2 → A3 ──┬─→ 30-T1 → T2 → T3 → T6(CAGG)
                                   ├─→ 40-AL1 → AL2 → AL3 (song song 2 tuần)
                                   ├─→ 60-Q1 → Q2 (bóng) → Q3
                                   └─→ 90-P1 (setting · audit_trail · credential · job registry · worker)
[sau A2(o)]  20-A4 · 50-C1 → C2
```

Lối găng: **10‑H2 → 20‑A3**. Mọi lô sau A3 chạy song song trên nhánh riêng; lô nào cũng chỉ thêm, nên gộp theo thứ tự hoàn thành.

## 2. Lô và việc

### Lô 1A — 10 hierarchy (mig 0460–0465) · 1 phiên nền

| Bước | Việc chính | Migration | Nghiệm thu (10 §6) |
|---|---|---|---|
| H1 | FK `workshops.tangId` khai Drizzle; `user_factory_assignments` unique thật (kiểm trùng trước); `factories.timezone` NOT NULL | 0460 | `uq_user_factory` là UNIQUE; 0 FK chỉ‑SQL trong 5 bảng cây |
| H2 | cột song song: `factories.enterprise_id`, `factories.origin` (`SIM-%`→sim; `QATD-%`→qa; còn lại real), `production_lines.kind/site_id`, `stations.site_id`, `*.deleted_at`, `machines.line_id`, timestamptz 5 bảng cây (USING `AT TIME ZONE 'Asia/Ho_Chi_Minh'`) | 0461–0462 | 1 700/1 700 máy có `line_id`; 6/6 site có `origin`; 0 hàng lệch giờ (so mẫu 100 hàng trước/sau) |
| H2‑xoá | **xoá seed `FUYU-F` (id 47) + `T12-SHOT-FA-…` (id 18) kèm cây con** — *chủ dự án đã duyệt 03/11; trình lại số đếm cây con trước khi chạy; khoá bằng số đã duyệt* | (script, không migration) | số hàng trước/sau theo bảng; không FK mồ côi |
| H3 | namespace `hierarchy.*` + wrapper router cũ (`factory/workshop/line/station/hierarchyTree`) giữ hình dạng output | — | snapshot output router cũ không đổi; census xanh |
| H5 | `user_scope` + backfill (1 + 8 dòng… đo lại) + `hierarchy.scope.*`; `idsTrongPhamVi` đọc bảng mới | 0463 | bộ test phạm vi hiện có xanh trên bảng mới |
| H6 | RLS FORCE theo `app.site_ids` trên 5 bảng cây + `user_scope`; middleware đặt GUC ở tRPC/REST/socket (**một chỗ**) | 0464–0465 | `tenantRlsCuongChe`: user hẹp không đọc site khác khi kết nối `avi_app`; đột biến "quên set GUC" ⇒ đỏ |

H4 (màn `/tai-san` phần cây) **không thuộc pha 1** (pha 2, sau `AppFrame`).

### Lô 1B — 20 asset (mig 0470–0476) · 1 phiên nền, nối sau H2

| Bước | Việc chính | Migration | Nghiệm thu (20 §6) |
|---|---|---|---|
| A1 | đưa DB về Drizzle: 7 cột 0374 + 4 cột `edge_nodes`, `machine_claim_tokens`, `machine_enrollment_tokens` thành pgTable; unique `equipment_3d_models.modelKey` — **không xoá `edgeControlSchema.ts`** (nằm trong `services/edge`, chờ A2(o); chỉ khai song song) | 0470 | 0 cột/bảng ngoài Drizzle trong miền (trừ danh sách edge chờ) |
| A2 | `asset_class` + `tag_template`; seed từ `device_types` (31) + `DEFAULT_PROFILES` + `twin_kich_thuoc_loai` (24) + từ vựng 31 role; `machines.class_id` backfill | 0471–0472 | 1 700/1 700 có `class_id`; 0 lớp `draft` đang được dùng |
| A3 | `machines.kind/attributes/edge_node_id/owner_epoch` + tz; `device_adapters.machineId` NOT NULL + FK; `device_tags.adapterId` FK + `role/template_id/energy_direction/source/uns_topic/sparkplug_metric`; backfill từ `uns_tag_mappings`; **`connection_status` tạo + ghi mặc định bật** (gỡ cờ `OT_GHI_TRANG_THAI_ADAPTER_ENABLED`) | 0473–0475 | 15/15 connection FK; 42/42 tag FK; `connection_status` có hàng cho mọi connection enabled ≤ 10 s; đóng C3 |
| A5 | namespace `asset.*` + wrapper router cũ | — | snapshot output cũ không đổi |
| A6 | `asset_credential` (băm) + backfill claim/enroll; api key cũ đọc‑chỉ, ghi log máy còn dùng (chu kỳ 14 ngày bắt đầu khi gộp) | 0476 | bảng log "máy dùng key cũ" có số; chưa drop cột |

⚠ `device_tags` là bảng SCADA đang dùng (0431+): A3 **chỉ thêm cột/FK**, chạy bench OpenPLC 24/24 sau migration; thiếu migration ⇒ toàn bộ OT hỏng (bài học R1a) ⇒ áp migration TRƯỚC build ở mọi môi trường. A4 (robots → asset) chờ A2(o) + 1a.

### Lô 1C — 30 telemetry (mig 0490–0496) · do‑model hoặc phiên nền, sau A3

| Bước | Việc chính | Nghiệm thu (30 §6) |
|---|---|---|
| T1 | một nguồn DDL Timescale (0271 thắng); gỡ `timescale/0003`, `TSDB_URL`, `db/timescale.ts`; Drizzle khai PK `(id, ts)` | `timescaledb_information.*` khớp migration; 0 DDL ngoài `drizzle/` |
| T2 | `ot_telemetry` + `tag_id/asset_id/site_id/reason/ts_source/source/seq`; tag ảo `protocol=push`; ghi song song cột cũ + mới; backfill 7 d | 100 % hàng mới có `tag_id` |
| T3 | `LiveStore` (thay `boDemHienTai` — **giữ hành vi adapter OT trung tâm**, chỉ bọc; không sửa `services/scada/boDemHienTai.ts` trước A2(o): LiveStore đọc qua adapter) + `ingestSignals` + C1 mặc định bật + `DurableBuffer` chung + `signal_ingest_stat` | test C1: ngắt simulator ⇒ `bad/comm_lost` ≤ 10 s; đột biến "bỏ applyBad" đỏ |
| T6 | CAGG `signal_1m/1h/1d`; `telemetry.series/assetSummary`; gỡ `hourly_yield_cagg` + matview telemetry | `telemetry.series` 24 h/1m < 150 ms p95 |

T0 phần còn lại (retention theo `origin`, 2 bảng PdM < 200 MB) đi cùng T2 khi có `site_id`. T4/T5/T7 thuộc pha 2–3.

### Lô 1D — 40 alarm (mig 0510–0514) · sau A3

| Bước | Việc chính | Nghiệm thu |
|---|---|---|
| AL1 | `alarm_definition`, `alarm_event`, `alarm_journal` (hypertable + trigger WORM), `notification_rule`, `notification_delivery`; sửa `notifications`, `alarm_taxonomy`; `shared/alarm/*`; RLS `site_id` | DDL xanh; census catalog |
| AL2 | seed: `master_alarms` 13 → định nghĩa lớp; taxonomy 175 priority; `COMM_LOST`/`STALE` mỗi site; rule mặc định P1 0‑5‑15 / P2 0‑15‑60 / P3 0‑60; di trú `andon_events` 80 | đếm khớp 13/175/80 |
| AL3 | `raiseEvent` + lifecycle + router `alarm.*`; **`ALARM_LEGACY_SHADOW` 2 tuần**: 5 cửa cũ gọi thêm `raiseEvent`; bảng so khớp hằng ngày | ≥ 95 % trùng số lượng/ưu tiên; chênh lệch có giải thích |

AL4 (engine trên LiveStore) cần 30‑T3 — cuối pha 1 nếu kịp, không thì đầu pha 3.

### Lô 1E — 90 platform P1 (mig 0610–0619) · do‑model (nối `feat/pha0-platform`)

| Việc | Ghi chú | Nghiệm thu (90 §6) |
|---|---|---|
| `setting` + `setting_def` + cache/pub‑sub; di trú 22 bảng settings (đọc cũ một chu kỳ) | cờ nghiệp vụ rời `.env` **theo từng module khi module đó vào pha** (không chuyển hết một lần) | N4 (ratchet số `process.env.*` ngoài `modules/platform`) |
| `audit_trail` (= `audit_logs` + cột `actor_kind/site_id/entity_kind`, nén) + `auditMutationMiddleware` cho **mọi** mutation có danh tính | view `audit_logs` một chu kỳ | N5 |
| `credential` (user_api/service/ai_gateway) | máy ở 20‑A6 | — |
| job registry + `job_run`; `ROLE=api|worker|all`; mọi job có owner‑module | dev mặc định `all` | N6 |
| 26 bảng SQL‑only vào drizzle (**trừ** nhóm edge/stop ledger chờ A2(o)) | | N7 (một phần) |

### Lô 1F — 60 inspection (mig 0550–0556) · sau A3 + lô 1C T3 (DurableBuffer)

| Bước | Việc chính | Nghiệm thu |
|---|---|---|
| Q1 | `shared/quality/{kpi,spc}.ts`; CAGG `inspection_1h/_1d`, `item_point_1h`; `quality.kpi.*` | N3: 3 bề mặt bằng nhau tới 0,01 % trên cùng tập |
| Q2 | hợp đồng `InspectionV3` + adapter v1.x/ZIP/hot‑folder/vision; `ingestInspection` một đường; tenant từ khoá máy; **ghi bóng 1 chu kỳ**, so khớp header/item | N1, N2, N5 |
| Q3 | bảng `inspection`/`inspection_capture`/`inspection_item` + view tương thích; seed 13 236 **giữ** với `origin='qa'` (QĐ 04/11 — WORM); di trú `process_results`, 33 product, 114 điểm đo, 101 mã lỗi, 180 threshold | đếm khớp; 0 hàng thiếu FK |

### Lô 1G — sau A2(o) trọn (không ước lượng trong pha 1)

20‑A4 (robots → asset), 50‑C1 (`command_request`/`command`/`command_attempt` + FK, view `command_log`), 50‑C2 (`requestCommand`/`confirmCommand` bọc HMI + AI + FOE; `xacThucTheoMuc` một middleware; L‑7 limiter Redis), cổng chế độ edge (scada‑master trong A2).

## 3. Phân phiên đề xuất (dieu‑phoi quyết)

| Phiên | Lô |
|---|---|
| do‑model (sau pha0‑platform/alarm‑telemetry) | 1E, rồi 1C |
| tho‑ca‑agent | 1F (Q1 → Q2 → Q3) — sau khi gộp pha0‑eng‑ai |
| phiên nền mới hoặc luong‑ui phần server | 1A → 1B (lối găng) |
| scada‑master | A2(o) → 1G; rà mọi migration chạm `device_tags`/`device_adapters` của 1B |
| kiem‑dinh | đo trước/sau mỗi lô; đột biến trên từng cổng mới (RLS GUC, `raiseEvent` dedup, tenant‑từ‑khoá, sim‑gate không thuộc pha này) |
| luong‑ui / scada‑ui | không có việc UI trong pha 1 ngoài pha0‑ui còn lại; chuẩn bị 90‑P3 (đọc mockup đã duyệt), **chưa viết mã vỏ** |

## 4. Việc chỉ chủ dự án làm trong pha 1

1. Duyệt lại **số đếm cây con** trước khi xoá seed `FUYU-F` + `T12-SHOT…` (H2‑xoá).
2. Xác nhận danh sách `origin`: `SIM-FAC` = sim; `QATD-A/B/C` = qa; còn lại = real (hiện **chưa có nhà máy thật** — nếu vậy `real` rỗng là đúng).
3. Quyết thời điểm bắt đầu **chu kỳ 14 ngày xoay api key máy** (A6) — chỉ có nghĩa khi có máy thật/simulator .NET đang chạy bằng key cũ.
4. `.env`: khi 1E gộp, áp diff chuyển cờ nghiệp vụ sang `setting` theo đợt. (`RETENTION_VRAM_EVENTS_DAYS` là dòng chú thích — retention `vram_events` tắt có chủ đích, QĐ 2026‑11‑06; khoá trùng đã = 0.)
5. Sau AL3: xem bảng so khớp 2 tuần rồi cho phép cắt nguồn cảnh báo cũ (AL6, pha 3–4).

## 5. Rủi ro và giảm thiểu

| Rủi ro | Giảm |
|---|---|
| Đổi `timestamp → timestamptz` tại chỗ lệch 7 h (postgres.js naive, 7 câu chưa vá) | làm từng bảng; so 100 hàng mẫu trước/sau; vá 7 câu `machine.ts`, `twinCanh.ts`, `oeeService` ×3, `warRoomService` cùng lô chạm bảng đó |
| RLS FORCE chặn nhầm job nền/worker (không có danh tính người) | worker đặt `app.site_ids` = toàn bộ (vai `system`) tường minh; test job chạy bằng `avi_app` |
| Migration chạm `device_tags`/`device_adapters` làm hỏng OT/SCADA | chỉ thêm; scada‑master rà SQL; bench OpenPLC 24/24 sau áp; áp migration trước build |
| Ghi song song (T2, AL3, Q2) làm chậm ingest | đo p95 ingest trước/sau; ghi bóng qua bus/worker, không trong giao dịch chính |
| `GRANT` cho hàm/bảng mới làm đỏ census catalog (bài học F5 0435) | mỗi migration có bước cấp quyền `avi_app` idempotent + chạy `edgeDbSearchPath*` trong cổng |
| Hai phiên cùng sửa `drizzle/schema/*` | mỗi lô một tệp schema mới (`hierarchyV2.ts`, `asset.ts`, `alarm.ts`, `platform.ts`, `inspectionV3.ts`); tệp cũ chỉ thêm cột |

## 6. Số đo trước/sau (kiem‑dinh)

bảng có `site_id` · bảng có FK tới `machines`/`asset` · số policy FORCE · `connection_status` hàng/connection · % hàng `ot_telemetry` mới có `tag_id` · mẫu `bad/comm_lost` khi ngắt sim · `alarm_event` vs nguồn cũ (so khớp ngày) · yield/FPY 3 bề mặt · p95 ingest telemetry + inspection · số `process.env.*` ngoài platform · job có `job_run` · bảng ngoài drizzle · bench OpenPLC.
