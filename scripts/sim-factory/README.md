# SIM FACTORY — "Nhà máy ảo" để đánh giá toàn hệ trước khi có phần cứng

Doc 40 Wave 3B **§13.4 (Full-System Sim Mode)** — quyết định **D10 (DB `_sim` riêng)**.

Mục tiêu: đánh giá TOÀN HỆ ở mức hoàn thiện cao nhất **TRƯỚC KHI có phần cứng** —
dựng "nhà máy ảo" bằng **simulator nói protocol thật** (OPC-UA / Modbus / MTConnect /
REST), bật **mọi flag** qua `.env.sim` (KHÔNG đụng `.env` production), rồi chạy các
**kịch bản phá hoại** lặp lại được và chấm PASS/FAIL.

> **Honest by design:** simulator **bind cổng thật** và **nói protocol thật**. Dữ liệu
> telemetry chảy qua **đúng OT driver** (`node-opcua` / `modbus-serial`) → ingest thật →
> `ot_telemetry` thật; inspection đi qua **đúng REST** `/api/machine/submit-inspection`.
> **Không** bơm thẳng dữ liệu giả vào DB. Vì `seed` và `simulator` đọc chung
> `topology.mjs`, adapter trong DB **luôn** trỏ đúng nodeId/register mà simulator phục vụ.

---

## 0) Thành phần & cổng

| Tiến trình | File | Cổng | Ghi chú |
|---|---|---|---|
| Seed nhà máy ảo | `seed.mjs` (`npm run sim:factory`) | — | idempotent; guard DB `_sim` |
| Simulator thiết bị | `simulator.mjs` (`node …/simulator.mjs`) | 4840-4842 (OPC-UA/line), 5020 (Modbus), 5001 (MTConnect), **4899 (control)** | bind cổng thật |
| Scenario runner | `scenario.mjs` (`npm run sim:scenario`) | — | đọc DB + gọi control-plane |
| Topology (nguồn sự thật) | `topology.mjs` | — | dùng chung cho seed + simulator + scenario |

Nhà máy ảo: **1 nhà máy → 1 xưởng → 3 line × 12 máy** đủ chủng loại
(AOI/AVI/SPI/ICT/FCT + conveyor-OPCUA + power-OPCUA + assembly-Modbus + screwdrive-S7\* +
packaging-EtherNetIP\* + robot + AGV). `*` = **khung** (adapter tồn tại, simulator không
serve → gateway thử connect rồi fail-safe "skipped" — bằng chứng nhánh no-op trung thực).

Mỗi line có **OPC-UA server riêng** (4840/4841/4842) → giết/dựng độc lập từng line để
mô phỏng 1 line rớt kết nối mà không chạm line khác.

---

## 1) Chuẩn bị DB `_sim` (một lần)

```bash
# Tạo DB tên CHỨA 'sim' (guard D10 yêu cầu). Khớp host/port/user với docker-compose của bạn:
psql "postgresql://aoi:aoi@127.0.0.1:5434/postgres" -c 'CREATE DATABASE aoi_management_sim;'

# Áp migration vào DB _sim (nạp .env.sim thay cho .env):
DOTENV_CONFIG_PATH=.env.sim node scripts/migrate-standalone.mjs
```

`.env.sim` đã trỏ `DATABASE_URL=…/aoi_management_sim`. Chỉnh lại nếu host/port khác.

## 2) Seed nhà máy ảo (idempotent)

```bash
npm run sim:factory
```

- Guard D10: chỉ chạy khi `DATABASE_URL` **chứa `sim`** HOẶC `SIM_SEED_CONFIRM=1`.
- Dựng factory/workshop/3 line/36 máy/36 station/layout+positions/3 ca/oee_targets/
  15 device_adapters+tags/commissioning/1 interlock rule. In tally `inserted/skipped`.
- Chạy lại an toàn (ON CONFLICT / existence-check).

## 2b) Seed tầng SẢN XUẤT / CHẤT LƯỢNG cho dashboard quản lý (doc 46 FE-W0.2, D2)

`seed.mjs` **cố ý KHÔNG** bịa inspection/OEE (chờ ingest thật) → mọi dashboard quản lý
(OEE / yield / throughput / plan / SPC / genealogy) trống. Khi **chưa có phần cứng** mà
cần **số THẬT hiển thị để đánh giá UX**, dùng `seed-production.mjs` — bơm tầng sản xuất/
chất lượng mô phỏng, **mọi bản ghi gắn nhãn "SIM"** và **đảo ngược được**.

```bash
npm run sim:production -- --days 14                 # mặc định 14 ngày × 24 unit/ca/line
npm run sim:production -- --days 30 --units-per-shift 40
npm run sim:production -- --purge                   # XOÁ SẠCH toàn bộ dữ liệu SIM
# hoặc: node scripts/sim-factory/seed-production.mjs --days 14
```

> ⚠ **Ghi vào DB THẬT** (`.env` DATABASE_URL, KHÔNG phải `.env.sim`). Đây là hành động
> CHỦ ĐÍCH đã DUYỆT (doc 46 D2): dữ liệu rõ nhãn SIM + đảo ngược 100%. Script in banner
> cảnh báo khi DB không chứa `sim`. **Idempotent**: mỗi lần chạy PURGE dữ-liệu-SIM cũ rồi
> tái sinh → chạy lại KHÔNG nhân đôi.

**Sinh (đọc topology THẬT từ DB — không tạo hierarchy):** product_models `SIM-*` (2 sản
phẩm + điểm đo có giới hạn cho SPC/Cpk) · product_inspections + measurement_results (yield
~98%, NG ~2%, NTF ~1%, giá trị đo quanh nominal±sigma) · daily_statistics + machine_status_logs
+ oee_metrics (A/P/Q/OEE ~91/92/98/84% — **nhất quán** để `oeeService` tính LIVE ra cùng số)
· downtime_events (top-5) · production_orders (plan-vs-actual) · fact_inspection_hourly
(so ca) · genealogy_chain (hash-chain, `verifyChain` = OK) + component_installations +
supplier_lots + process_results (traceability 2 chiều).

**Nhãn "SIM" (phân biệt & xoá):**

| Bảng | Cách nhận diện SIM |
|---|---|
| product_inspections | `serialNumber LIKE 'SIM-%'` + `notes."source"="SIM"` |
| measurement_results | theo `inspectionId` của inspection SIM |
| oee_metrics | `calculatedBy = 'SIM'` |
| downtime_events | `detailedReason LIKE '%[SIM]%'` |
| production_orders | `orderCode LIKE 'SIM-PO-%'` |
| genealogy_chain / component_installations / process_results | `serialNumber LIKE 'SIM-%'` |
| supplier_lots | `supplierLotNumber LIKE 'SIM-%'` |
| machine_status_logs | `ipAddress = 'SIM'` |
| daily_statistics / fact_inspection_hourly | scope theo nhà máy `SIM-FAC` |
| product_models | `code LIKE 'SIM-%'` (**CONFIG — KHÔNG bị `--purge`**, như topology) |

`--purge` xoá tất cả bảng trên (trừ product_models config) theo đúng nhãn → **KHÔNG chạm**
dữ liệu THẬT hay dữ liệu `seed.mjs`/scenario (vd oee_metrics `calculatedBy='SEED'` được giữ).

## 3) Chạy server với profile `.env.sim` (BẬT MỌI THỨ)

```bash
# Windows PowerShell:
$env:DOTENV_CONFIG_PATH=".env.sim"; $env:NODE_ENV="development"; npx tsx watch server/_core/index.ts
# bash/git-bash:
DOTENV_CONFIG_PATH=.env.sim NODE_ENV=development npx tsx watch server/_core/index.ts
```

`.env.sim` bật OT gateway + HA supervisor + interlock + FOE + DPC + robot/VDA5050 +
SECS/GEM + MTConnect + presence/downtime/OEE + observability + store-forward, và
**nén thời gian** cho sim (presence TTL 30s, downtime 1'), `LICENSE_BYPASS=true`.

## 4) Chạy simulator thiết bị

```bash
node scripts/sim-factory/simulator.mjs
```

Bind OPC-UA (4840-4842), Modbus (5020), MTConnect (5001), control (4899). Server (bước 3)
sẽ tự poll các endpoint này → `ot_telemetry` bắt đầu có dữ liệu thật.

## 5) Chạy kịch bản phá hoại

```bash
npm run sim:scenario -- machine-down-10min     # một kịch bản
npm run sim:scenario                            # chạy TẤT CẢ
```

Runner kiểm tra reachability (app `/health` + sim `/health`) rồi thực thi, in PASS/FAIL.

---

## Kịch bản có sẵn (`scenarios/*.yaml`)

| File | Mô tả | Cửa BẮT BUỘC | Quan sát (optional) |
|---|---|---|---|
| `machine-down-10min` | Line 1 rớt → presence→downtime→OEE→Andon | presence **offline** + telemetry **ngừng** | downtime_open, Andon, online lại |
| `ng-spike` | Ép `ng_rate`>20% → interlock nổ (alert-only) | interlock_fired + andon_raised | — |
| `db-down-recovery` | DB sập → inspection vào store-forward → drain | WAL depth **>0** rồi **=0** | — (tắt/bật DB = manual) |
| `opcua-kill-midsession` | Giết OPC-UA giữa phiên → supervisor reconnect | telemetry **ngừng** rồi **chảy lại** | presence online |

## Schema YAML kịch bản

```yaml
name: <tên>
description: <mô tả>
steps:
  - name: <nhãn>
    # CHỌN MỘT trong:
    sim:   { action: <opcua.kill|opcua.restart|machine.stop|machine.start|ng.spike|ng.clear|tag.set|inspection.burst>, line: <1..3>, value?, addr?, count?, ng? }
    wait:  <giây>
    manual: { prompt: <hướng dẫn>, waitSec: <giây> }
    check: <presence|downtime_open|telemetry_fresh|interlock_fired|andon_raised|storeforward_depth>
    # tham số cho check:
    line: <1..3>          # + role: CONVEYOR (giải mã machineId)
    role: <SPI|AOI|AVI|ICT|FCT|CONVEYOR|PWR|ASSY|…>
    expect: <online|offline|true|false>
    maxAgeSec: <n>        # telemetry_fresh
    sinceSec: <n>         # interlock_fired / andon_raised
    ruleName: <str>       # interlock_fired
    op: <gt|gte|lt|lte|eq>; value: <n>   # storeforward_depth
    timeout: <giây>       # poll tối đa (mặc định 30)
    interval: <giây>      # nhịp poll (mặc định 3)
    optional: true        # bước quan sát — fail chỉ WARN, không tính vào verdict
teardown:                 # luôn chạy để trả simulator về sạch
  - sim: { action: …, line: … }
```

## Control-plane simulator (POST `http://127.0.0.1:4899/control`)

| action | body | tác dụng |
|---|---|---|
| `opcua.kill` / `machine.stop` | `{line}` | dừng OPC-UA server của line → telemetry ngừng |
| `opcua.restart` / `machine.start` | `{line}` | dựng lại OPC-UA server → supervisor reconnect |
| `ng.spike` | `{line, value?}` | ép `conveyor.ng_rate` cao (mặc định 35) |
| `ng.clear` | `{line}` | trả `ng_rate` về bình thường |
| `tag.set` | `{line, addr, value}` | override một tag |
| `inspection.burst` | `{line, count?, ng?}` | POST N inspection (test store-forward) |

`GET /health` → snapshot mọi line. `GET /state` → toàn bộ state.

---

## An toàn & giới hạn (trung thực)

- **Không đụng production:** mọi script sim nạp `.env.sim` (không nạp `.env`), và **từ
  chối ghi** nếu `DATABASE_URL` không chứa `sim` (đặt `SIM_SEED_CONFIRM=1` để chủ động
  vượt guard nếu tên DB khác).
- **Đường ghi thiết bị vẫn qua HITL + gate.** `OT_CONTROL_ENABLED=true` chỉ nâng dry-run;
  lệnh thật đi tới "thiết bị ảo" của simulator, không phải HW thật. `INTERLOCK_AUTO_BLOCK`
  vẫn TẮT.
- **s7 / EtherNet-IP là khung:** simulator không serve → gateway log "skipped" (đúng).
  Muốn live thêm protocol → thêm server tương ứng trong `simulator.mjs` + tag trong `topology.mjs`.
- **Kịch bản `db-down-recovery`** cần thao tác tắt/bật Postgres thủ công (runner in hướng
  dẫn + chờ; kiểm tra độ sâu WAL bằng cách đọc FILE nên vẫn chạy khi DB đang tắt).
- **Nén thời gian** (`.env.sim`: presence TTL 30s, downtime 1', interlock poll 3s) chỉ để
  đánh giá nhanh — **không** phản ánh ngưỡng production.
