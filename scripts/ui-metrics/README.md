# `scripts/ui-metrics/` — thiết bị đo bố cục (doc 81 Đợt 2)

`engineeringLayout.mjs` đo bố cục 14 màn "Kỹ thuật & Điều khiển" trên trình duyệt thật (Playwright).
Đợt 2 nghiệm thu bằng số của nó: mỗi task chuyển trang chạy script trên trang của mình ở 1600×950 và
1366×768, rồi ghi TRƯỚC/SAU vào báo cáo. Đường cơ sở trước mọi thay đổi nằm ở
`docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json`, đo bằng hồ sơ cờ `dev`.

Vì nó chấm 15 task, **chỉ số phải không lách được bằng chính mã nó chấm** (ruling R-2-e). Mỗi lần chạy tự
làm đối chứng dương (`selfTest`) để chứng minh nó vẫn bắt được những cách lách đã biết.

## Chạy

```bash
# Đo 14 màn × 2 kích thước (+ biến thể mở Copilot cho IDE/IR/POU), hồ sơ cờ dev; tự dựng rồi tự tắt instance
node scripts/ui-metrics/engineeringLayout.mjs --spawn --out .playwright-mcp/do-bo-cuc/lan-1.json

# Chỉ một vài màn, kèm ảnh chụp (vào .playwright-mcp/do-bo-cuc/anh/, đã gitignore — KHÔNG commit ảnh)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --screens engineering-changes --shots --out .playwright-mcp/do-bo-cuc/ecn-sau.json

# MSA: so hai lần chạy. Mã thoát 1 nếu một cổng bất kỳ trượt (xem "MSA" dưới)
node scripts/ui-metrics/engineeringLayout.mjs --compare .playwright-mcp/do-bo-cuc/lan-1.json .playwright-mcp/do-bo-cuc/lan-2.json

# Đối chiếu với bảng §0 của FE1 (±5 %)
node scripts/ui-metrics/engineeringLayout.mjs --fe1 docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json

# Rút lại danh sách bảng mà mỗi màn đọc (khi một task thêm thủ tục tRPC mới — script sẽ cảnh báo)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --discover-tables --out .playwright-mcp/do-bo-cuc/bang.json

# Liệt kê nút trong <main> (để cập nhật danh sách hành động mở dialog)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --list-buttons --sizes 1600x950 --out .playwright-mcp/do-bo-cuc/nut.json
```

Tuỳ chọn:
- `--flags dev|off`: `dev` là mặc định và là hồ sơ nghiệm thu; `off` tắt mọi cờ, dùng làm ca phụ.
- `--server-port 3016`, `--vite-port 5176`, `--sizes 1600x950,1366x768`.
- `--no-selftest` bỏ đối chứng dương. Chỉ dùng khi đo một màn khác ECN.
- `--keep` giữ instance để xem bằng tay; in user/mật khẩu; Ctrl-C để tắt.

Script **chỉ đo instance tự dựng** (`--spawn`). Không bao giờ đo :3000: :3000 chạy `dist` cũ và không có
canh dữ liệu hay canh kết nối. Mã thoát: `0` khi `pass`, `2` khi có lỗi trang / trôi dữ liệu / kết nối lạ /
tự kiểm trượt, `1` khi lỗi hạ tầng.

## `--spawn` làm gì

1. **Kiểm cổng.** 3016 và 5176 phải trống; bận thì dừng. Server tự nhảy sang cổng khác khi cổng bận, nên
   script cũng kiểm dòng `Server running on …:3016` trong log.
2. **User đo tạm.** Tạo `uim_engineer` trong **`aoi_management_test`**, trong một giao dịch.
   - URL DB: script đọc **chuỗi** `DATABASE_URL` từ `.env` (không kết nối DB đó) rồi đổi tên DB thành
     `aoi_management_test`, hoặc lấy từ `UIM_TEST_DATABASE_URL`. Tên DB khác thì từ chối, và
     `current_database()` được kiểm trước mọi lệnh.
   - Quyền: role `engineer`, quyền mẫu `DEFAULT_ROLE_PERMISSIONS.engineer`, gán `SIM-FAC` như `engineer1`
     của FE1, không 2FA.
   - Xoá khi xong, kể cả khi lỗi giữa chừng.
3. **Ảnh chụp dữ liệu TRƯỚC:** băm nội dung các bảng mà 14 màn đọc (xem "Trôi dữ liệu").
4. **Server từ mã nguồn**: `node node_modules/tsx/dist/cli.mjs server/_core/index.ts`, `ROLE=api` (không chạy
   cron/sweeper nền).
   - Env tiến trình con dựng lại từ đầu, chỉ giữ biến hệ thống.
   - `DOTENV_CONFIG_PATH` trỏ tệp không tồn tại ⇒ **server** không nạp `.env`.
   - **Hồ sơ cờ `dev` (R-2-d):** BẬT cờ giao diện như `.env` dev: `FOE_ENABLED`, `DPC_IR_V2_ENABLED`,
     `WORKFORCE_ENABLED`, `SAFETY_AUDIT_ENABLED`, `EQ_GOVERN_ENABLED`, `EQ_INTEG_ENABLED`,
     `FLEET_ORCH_ENABLED`, `FLEET_RESOURCE_ENABLED`.
   - **Luôn TẮT** actuation / ra ngoài: `DPC_DEPLOY`, `SAFETY_PLC_ADAPTER`, OT (control, store-forward, HA),
     MQTT/UNS/Sparkplug, robot, OPC UA, ROS2, SIM telemetry, edge, SECS/GEM, MTConnect, VDA5050,
     LLM (llama/GPU/KB, `AI_ORCHESTRATION*`), webhook, OTEL, twin stream, OpenAI gateway.
5. **Vite dev chạy trong tiến trình script** ở 5176, dùng `vite.config.ts` của repo.
   - Proxy `/api` (kể cả websocket) và `/uploads` sang :3016.
   - `cacheDir` đặt trong `%TEMP%/aoi-ui-metrics-vite-cache` ⇒ không ghi `node_modules/`.
   - Không build, không đụng `dist/`.
   - ⚠ `vite.config.ts` có `envDir` = gốc repo, nên **Vite có nạp `.env`**, nhưng chỉ đưa các biến
     `VITE_*` vào bundle client (vd `VITE_APP_ID`). Không có biến nào trong số đó tới server đo hay DB.
6. **Canh kết nối.** Lấy mẫu kết nối mạng của **cả cây tiến trình server** (`Get-NetTCPConnection` /
   `Get-NetUDPEndpoint`) ba lần: sau khi khởi động, sau mỗi biến thể.
   - Được phép: nghe :3016, TCP tới `127.0.0.1:5434` (Postgres `_test`), TCP vào :3016 từ loopback (Vite).
   - Mọi kết nối khác vào `meta.outboundViolations` ⇒ `pass=false`.
7. **Dọn:** đo xong thì chụp dữ liệu SAU, đóng Vite, `taskkill /T` cây server, xoá user đo, rồi kiểm cổng.
   Kết quả nằm ở `meta.portsAfter` (3016/5176 phải "trống") và `meta.probeUserRemoved`.

## Chỉ số (mỗi bản ghi trong `results[]`)

| Trường | Nghĩa |
|---|---|
| `mainPct` | % khung đầu (vw×vh) mà MAIN chiếm. Diện tích **hợp** các hình chữ nhật MAIN (không cộng trùng), cắt trên ở mép dưới top bar sticky |
| `mainSource` / `missingDataLayoutMain` | `data-layout-main` (chính thức) hoặc `fe1-legacy` (selector FE1 trong `SCREENS[].legacyMain`, kèm cảnh báo) |
| `calibration` | khi trang đã có attribute: MAIN theo selector FE1 vẫn được đo song song (`legacyMainTop/Pct`) để người duyệt so |
| `chromeAboveMain` | = `mainTop`, px từ đỉnh trang tới đỉnh MAIN. **Chỉ số không lách được**: mọi thứ phía trên MAIN đều cộng vào |
| `h1Top` / `h1Bottom` / `gapH1ToMain` | vị trí h1 và khoảng từ đáy h1 tới đỉnh MAIN. `h1Missing:true` + cảnh báo khi trang không có h1 (Studio); khi đó dải tính từ đỉnh `<main>` |
| `bannersBeforeMain` | **Hình học** (R-2-e b): mọi khối nhìn thấy nằm HẲN trên MAIN, giao ngang với MAIN, dưới đáy h1, ngoài page header của h1. Gồm `count`, `px` (chiều cao hợp) và `byKind` (`notice`/`kpi`/`tabs`/`other`, chỉ là nhãn). Mọi độ sâu DOM đều được xét. Không phụ thuộc lớp CSS |
| `blocksAboveH1`, `headerParts`, `bandBlocks[]` | khối phía trên h1 (vd banner Beta), số phần tử trong page header, và danh sách đầy đủ có `pos` (`aboveH1`/`besideH1`/`belowH1`/`besideMain`), `kind`, `loc` |
| `bannersFe1Class` | bộ phân loại lớp CSS của FE1. **Chỉ là nhãn phụ** để đối chiếu FE1 |
| `breadcrumbs` | số breadcrumb nhìn thấy (shell + trang), theo selector `nav[data-slot=breadcrumb]`/aria-label như FE1 |
| `kpi` | `legacy` (MetricCard) **và** `official` (`[data-layout-kpi]`), **luôn cả hai**; `all.stripPx` = chiều cao hợp của dải |
| `coverMain` | **Hit-test** lưới 8 px trên phần nhìn thấy của MAIN. Điểm nào có phần tử trên cùng không thuộc MAIN là bị che, bất kể tệp nguồn. Gồm `px`, `pctOfMain`, `items[]` (phần tử fixed/absolute/sticky ngoài cùng: tag/testid/loc/zIndex). `positionedIntersecting[]` liệt kê thêm phần tử định vị cắt MAIN mà hit-test không thấy (vd `pointer-events:none`) — chỉ báo |
| `pageHeightRatio` | (chiều cao tài liệu + phần cuộn thêm của mọi container cuộn **tổ tiên** của MAIN) / vh. `pageHeightRatioDoc` = cách tính của FE1. `scroll.inner[]` = container cuộn bên trong MAIN (vd bảng tự cuộn) |
| `dialogsAtLoad`, `actions[]` | dialog lúc nạp, và sau khi mở từng hành động khai báo: `status` (`opened`/`disabled`/`not-found`), `kinds` (`dialog`/`sheet`/`alert-dialog`/`popover`/`drawer`), `closedByEsc` |
| `errors[]` / `warnings[]` | **lỗi** làm `pass=false`: MAIN vi phạm ràng buộc, không thấy MAIN, hành động khai báo không tìm thấy. **Cảnh báo**: chưa có attribute, không có h1, hành động disabled, thủ tục tRPC lạ |
| `trpc[]` | thủ tục tRPC màn gọi. Thủ tục mới ngoài `KNOWN_PROCS` ⇒ cảnh báo chạy lại `--discover-tables` |

## Ràng buộc cho các task sau (KHÔNG lách)

- **`data-layout-main`** gắn lên phần tử MAIN của trang (editor/canvas/danh sách/bảng). Phần tử này:
  - phải nằm **trong `<main>`**;
  - **không được chứa** h1, page header (`PageHeader`/`[data-layout-header]`), banner (`role=alert`,
    `FeatureStatusGate`, `BetaBadge`, `[data-layout-banner]`, hoặc khung notice có chữ cảnh báo), hay KPI
    (`MetricCard`, `[data-layout-kpi]`).

  Vi phạm bất kỳ điều nào là **LỖI của trang**. Nhiều vùng MAIN cạnh nhau thì gắn từng vùng; phần tử lồng
  trong một MAIN khác không bị tính hai lần.
- `data-layout-kpi` gắn lên từng chip/thẻ của dải KPI mới. MetricCard cũ còn sót vẫn bị đếm.
- Panel AI nằm trong layout không cần đánh dấu: nó chỉ bị tính là "che" khi thực sự đè lên MAIN.
- Hành động mở dialog khai báo trong `SCREENS[].actions` (theo tên nút). **Chỉ khai nút MỞ**, không bao
  giờ khai nút lưu/duyệt/deploy/chạy. Đổi tên hay dời nút mà không sửa khai báo ⇒ **LỖI**, không phải 0.
  Dialog → flyout được chấm bằng `kinds` (`dialog` → `sheet`), không bằng số đếm.

## Trôi dữ liệu

- `_test` là DB dùng chung với vitest của mọi phiên.
- `PAGE_TABLES` là các bảng mỗi màn đọc khi nạp, kể cả vỏ (top bar, andon, hộp AI…). Danh sách được rút
  bằng `--discover-tables`: lấy delta `pg_stat_user_tables` quanh từng lần nạp màn (chunk TimescaleDB quy
  về hypertable), chạy 2 lần, lấy giao.
- Mỗi bảng được băm **nội dung**: md5 từng hàng, sắp theo md5. Riêng `users` chỉ băm các cột không đổi khi
  đăng nhập.
- Băm TRƯỚC và SAU mỗi lần chạy. `meta.data.drift` khác rỗng ⇒ `pass=false`.
- `--compare` còn đòi ảnh chụp TRƯỚC của hai lần chạy giống hệt nhau.

## MSA

Chạy `--spawn` hai lần liên tiếp, mỗi lần một instance mới, rồi so bằng `--compare`. `pass` đòi đủ năm cổng:

1. Độ lệch tương đối `|a−b| / max(|a|,|b|)` < 2 %, xét trên mọi màn × kích thước × biến thể × chỉ số.
   Chữ ký hành động phải trùng khớp tuyệt đối.
2. Đối chứng dương `selfTest.pass` ở **cả hai** lần chạy. Trên ECN @1600, mỗi phép chèn làm trên trang nạp
   lại sạch, và thiết bị phải bắt được cả năm:
   - (a) banner lồng 2 tầng, lớp `px-5 py-4` (lọt regex FE1), cao 100 px ⇒ `bannersBeforeMain` +1,
     `chromeAboveMain` ≥ +100;
   - (b) lớp phủ `position:fixed` 200×200 không `data-loc` ⇒ `coverMain` ≥ 36 000 px² và chỉ đúng thủ phạm;
   - (c) thêm `[data-layout-kpi]` ⇒ đếm `official` +1 mà `legacy` không đổi;
   - (d) `data-layout-main` bọc h1 + một cái ngoài `<main>` ⇒ hai LỖI;
   - (e) hành động khai báo không tồn tại ⇒ LỖI.
3. Không trôi dữ liệu trong từng lần chạy.
4. Dữ liệu giống nhau giữa hai lần chạy.
5. Cùng hồ sơ cờ.

Kết quả của Task 1 nằm trong `.superpowers/sdd/2026-09-27-engineering-control-dot2-bo-cuc/task-1-report.md`.
