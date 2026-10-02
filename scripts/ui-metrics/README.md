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

# Gỡ từng gác và chứng minh ca tự kiểm của nó ĐỎ (≈4 phút thêm)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --screens engineering-changes --sizes 1600x950 --mutation --out .playwright-mcp/do-bo-cuc/dot-bien.json

# Hiệu chuẩn khi một trang LẦN ĐẦU gắn data-layout-main (bố cục chưa đổi) — ghi do-bo-cuc/calibration.json
node scripts/ui-metrics/engineeringLayout.mjs --spawn --calibrate --screens engineering-changes --out .playwright-mcp/do-bo-cuc/hieu-chuan.json
```

Tuỳ chọn:
- `--flags dev|off`: `dev` là mặc định và là hồ sơ nghiệm thu; `off` tắt mọi cờ, dùng làm ca phụ.
- `--server-port 3016`, `--vite-port 5176`, `--sizes 1600x950,1366x768`.
- `--no-selftest` bỏ đối chứng dương. Chỉ dùng khi đo một màn khác ECN.
- `--reference <baseline.json>` là tệp tham chiếu MAIN cho cổng hiệu chuẩn; mặc định là `do-bo-cuc/baseline.json`.
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
| `mainPct` | % khung đầu (vw×vh) mà MAIN chiếm. Diện tích **hợp** các hình chữ nhật MAIN (không cộng trùng), **đã cắt** theo mọi tổ tiên có `overflow ≠ visible` (`clippedBy[]`) và theo mép dưới top bar sticky. `mainRectsRaw` = trước khi cắt |
| `workspacePct` | % khung đầu của **vùng làm việc**: MAIN đã cắt, từ đỉnh phần tử làm việc W trở xuống, **trừ** bề mặt AI bên trong MAIN. Chỉ số nghiệm thu "editor ≥45 % khi mở Copilot" của Task 13 dùng số này |
| `insideMain[]` | mỗi MAIN: `workspace` (W), `aboveWorkspacePx`, `banners`/`bannerPx`, `toolbars`, `blocks[]` — xem quy tắc "Banner/KPI trong MAIN" |
| `aiInsideMain` | bề mặt AI/Copilot **bên trong** MAIN: `px` (diện tích trong MAIN), `inWorkspacePx` (phần đã trừ khỏi `workspacePct`), `items[]` |
| `mainSource` / `missingDataLayoutMain` | `data-layout-main` (chính thức) hoặc `fe1-legacy` (selector FE1 trong `SCREENS[].legacyMain`, kèm cảnh báo) |
| `legacyRef` | MAIN theo selector FE1 (`mainTop`, `rects`, `areaPx`) — lưu trong `baseline.json` cho **cổng hiệu chuẩn** |
| `calibration` | khi trang có attribute: `matches-reference` / `recorded` / `MISMATCH` (= LỖI), kèm Δtop/Δleft/Δdiện tích |
| `chromeAboveMain` | = `mainTop`, px từ đỉnh trang tới đỉnh MAIN. **Chỉ số không lách được**: mọi thứ phía trên MAIN đều cộng vào |
| `h1Top` / `h1Bottom` / `gapH1ToMain` | vị trí h1 và khoảng từ đáy h1 tới đỉnh MAIN. `h1Missing:true` + cảnh báo khi trang không có h1 (Studio); khi đó dải tính từ đỉnh `<main>` |
| `bannersBeforeMain` | **Hình học**: mọi khối nhìn thấy nằm HẲN trên MAIN, giao ngang với MAIN, **dưới đáy h1 — kể cả khối nằm trong page header của h1** (phụ đề, ghi chú… không còn được miễn), cộng **popover/portal mở sẵn** đè dải đầu trang (`kind: overlay`). Gồm `count`, `px` (chiều cao hợp), `byKind` (`notice`/`kpi`/`tabs`/`subtitle`/`overlay`/`other`, chỉ là nhãn). Không phụ thuộc lớp CSS |
| `blocksAboveH1`, `headerParts`, `bandBlocks[]` | khối phía trên h1 (vd banner Beta), số phần tử trong page header, danh sách đầy đủ có `pos` (`aboveH1`/`besideH1`/`belowH1`/`besideMain`/`overlay`), `kind`, `loc` |
| `bannersFe1Class` | bộ phân loại lớp CSS của FE1. **Chỉ là nhãn phụ** để đối chiếu FE1 |
| `breadcrumbs` | số breadcrumb nhìn thấy (shell + trang), theo selector `nav[data-slot=breadcrumb]`/aria-label như FE1 |
| `kpi` | `legacy` (MetricCard) **và** `official` (`[data-layout-kpi]`), **luôn cả hai**; `all.stripPx` = chiều cao hợp của dải |
| `coverMain` | **Hit-test** lưới 8 px trên phần **đã cắt** của MAIN. Điểm nào có phần tử trên cùng không thuộc MAIN là bị che, bất kể tệp nguồn. Gồm `px`, `pctOfMain`, `items[]` (phần tử fixed/absolute/sticky ngoài cùng: tag/testid/loc/zIndex). `positionedIntersecting[]` liệt kê thêm phần tử định vị cắt MAIN mà hit-test không thấy (vd `pointer-events:none`) — chỉ báo |
| `pageHeightRatio` | (chiều cao tài liệu + phần cuộn/ẩn của mọi **tổ tiên** của MAIN có `overflow-y` auto/scroll/overlay/**hidden/clip** + phần cuộn/ẩn LỚN NHẤT của các container **anh em** trong `<main>`) / vh. Mỗi phần chỉ tính khi vượt ≥ 24 px. `pageHeightRatioDoc` = cách tính của FE1. `scroll.inner[]` = container cuộn bên trong MAIN (vd bảng tự cuộn — kiểm khi chấm Standards ≤1,5×) |
| `dialogsAtLoad` | dialog/sheet mở sẵn lúc nạp. **Phải là 0** — khác 0 là LỖI |
| `actions[]` | sau từng hành động khai báo: `status` `opened` (có dialog/sheet/popover/menu; `kinds`, `closedByEsc`) / `inline` (không dialog nhưng hình học đổi: `inlineHeight`, `pushesMainPx`, `newBlocks`) / `no-effect` (**LỖI**: không dialog VÀ không đổi hình học) / `not-found` (**LỖI**) / `disabled` (cảnh báo) |
| `errors[]` / `warnings[]` | **lỗi** làm `pass=false`. **Cảnh báo**: chưa có attribute, không có h1, hành động disabled, thủ tục tRPC lạ, và (khi còn đo bằng selector FE1) các vi phạm mà ở chế độ attribute sẽ là lỗi |
| `trpc[]` | thủ tục tRPC màn gọi. Thủ tục mới ngoài `KNOWN_PROCS` ⇒ cảnh báo chạy lại `--discover-tables` |

## Ràng buộc cho các task sau (KHÔNG lách)

- **`data-layout-main`** gắn lên phần tử MAIN của trang (editor/canvas/danh sách/bảng). Phần tử này:
  - phải nằm **trong `<main>`**;
  - **không được chứa** h1, page header (`PageHeader`/`[data-layout-header]`), banner (`role=alert`,
    `FeatureStatusGate`, `BetaBadge`, `[data-layout-banner]`, khung ≥200×24 không phải nút), hay KPI
    (`MetricCard`, `[data-layout-kpi]`);
  - và không chứa banner / dải KPI **theo hình học** (quy tắc dưới).

  Vi phạm bất kỳ điều nào là **LỖI của trang**. Nhiều vùng MAIN cạnh nhau thì gắn từng vùng; phần tử lồng
  trong một MAIN khác không bị tính hai lần.
- **Cổng hiệu chuẩn** (lần đầu gắn attribute). Trang có `data-layout-main` được so với MAIN tham chiếu theo
  selector FE1 (`legacyRef` trong `baseline.json`, cùng màn × kích thước × biến thể). Dung sai: Δtop ≤ 4 px,
  Δleft ≤ 4 px, Δdiện tích ≤ 3 %.
  - Lệch mà **chưa có bản ghi** trong `do-bo-cuc/calibration.json` ⇒ **LỖI**.
  - Quy trình bắt buộc: (1) gắn attribute trên bố cục **chưa đổi**; (2) chạy
    `--spawn --calibrate --screens <màn>`, công cụ chỉ ghi bản ghi khi khớp tham chiếu; (3) commit
    `calibration.json`; (4) rồi mới đổi bố cục.
  - `calibration.json` do công cụ ghi, **không sửa tay** (người duyệt kiểm bằng `git log -p`).
- **Banner / dải KPI trong MAIN (theo hình học).** Quy tắc chính xác:
  1. Phần tử làm việc **W** của một MAIN là phần tử có đỉnh nhỏ nhất trong MAIN thuộc:
     `[data-layout-workspace]`, `table`, `[role=grid|treegrid|tree|listbox]`, `canvas`, `.cm-editor`,
     `.monaco-editor`, `.react-flow`, `textarea`, `[contenteditable=true]`, `svg` ≥200×120. Phần tử nằm trong
     bề mặt AI không được tính. Nếu không có phần tử nào như vậy, W là khối con đầu tiên cao ≥120 px.
  2. **Khối trên W**: đi xuống từ MAIN, chỉ xuyên qua các tổ tiên của W. Mỗi con nhìn thấy (không fixed) nằm
     **hẳn** trên đỉnh W là một khối trên W.
  3. Khối trên W có chiều cao **< 120 px** và bề rộng **≥ 60 % bề rộng MAIN** là **BANNER TRONG MAIN**:
     - `kind: kpi-strip` khi nó chứa MetricCard/`[data-layout-kpi]`, hoặc có ≥3 con, con nào cũng hẹp
       (< 50 % MAIN) và thấp (≤ 140 px) — tức chip KPI không đánh dấu;
     - ngược lại là `kind: banner`.

     Banner trong MAIN là **LỖI**, trừ hai ngoại lệ:
     - đúng **một** `[data-layout-toolbar]` cao ≤ 48 px. Hai toolbar, hoặc toolbar > 48 px, là LỖI;
     - tiêu đề thuần `h2–h6`/`[role=heading]`/`[data-slot=card-title]` cao ≤ 40 px.
  4. Khối cao ≥120 px hoặc hẹp hơn 60 % không phải banner, nhưng vẫn cộng vào `aboveWorkspacePx` và đẩy
     `workspacePct` xuống.
- **Bề mặt AI trong MAIN** được trừ khỏi vùng làm việc (`workspacePct`) và báo riêng ở `aiInsideMain`. Nhận
  diện **rộng** có chủ đích: phần tử ≥120×120 trong MAIN khớp `[role=complementary]`, `[data-ai]`,
  `[data-layout-ai]`, `data-testid` chứa `copilot`/`assistant`/`ai-panel`/`ai-chat`, `data-loc` chứa
  `Copilot`/`AILocal`/`Assistant`, hoặc `aria-label` chứa `copilot`/`assistant`/`trợ lý` (không phân biệt
  hoa thường). Ngoại lệ: màn `programming-copilot`, nơi MAIN chính là bề mặt AI (`aiIsWorkspace`).
- `data-layout-kpi` gắn lên từng chip/thẻ của dải KPI mới. MetricCard cũ còn sót vẫn bị đếm.
- Panel AI nằm NGOÀI MAIN chỉ bị tính khi đè lên MAIN (`coverMain`). Panel nằm TRONG MAIN bị trừ khỏi vùng
  làm việc.
- Hành động khai báo trong `SCREENS[].actions` (theo tên nút). **Chỉ khai nút MỞ**, không bao giờ khai nút
  lưu/duyệt/deploy/chạy.
  - Đổi tên hay dời nút mà không sửa khai báo ⇒ **LỖI**.
  - Nút bấm không ra dialog/sheet và không đổi hình học ⇒ **LỖI**.
  - Panel inline mở ra được báo `kind: inline` kèm chiều cao và độ đẩy MAIN (`pushesMainPx` — tính là
    chrome của MAIN khi chấm).
  - Dialog → flyout được chấm bằng `kinds` (`dialog` → `sheet`), không bằng số đếm.

## Trôi dữ liệu

- `_test` là DB dùng chung với vitest của mọi phiên.
- `PAGE_TABLES` là các bảng mỗi màn đọc khi nạp, kể cả vỏ (top bar, andon, hộp AI…). Danh sách được rút bằng
  `--discover-tables`: lấy delta `pg_stat_user_tables` quanh từng lần nạp màn (chunk TimescaleDB quy về
  hypertable). Lần rút 2026-10-02 lấy **hợp** của 2 lần chạy cộng `collaboration_sessions`.
- Mỗi bảng được băm **nội dung**: md5 từng hàng, sắp theo md5. Cột/hàng do chính instance đo ghi được loại
  có lý do (`TABLE_COLS`, `TABLE_EXCLUDE_COLS`, `TABLE_WHERE`, `SELF_WRITTEN`).
- Băm TRƯỚC và SAU mỗi lần chạy. `meta.data.drift` khác rỗng ⇒ `pass=false`.
- Băm lỗi (`ERR:`, vd bảng không tồn tại) ⇒ `meta.data.errors` ⇒ `pass=false`.
- `--compare` còn đòi ảnh chụp TRƯỚC của hai lần chạy giống hệt nhau.

## MSA

Chạy `--spawn` hai lần liên tiếp, mỗi lần một instance mới, rồi so bằng `--compare`. `pass` đòi đủ mọi cổng:

1. Độ lệch tương đối `|a−b| / max(|a|,|b|)` < 2 %, xét trên mọi màn × kích thước × biến thể × chỉ số.
   Chữ ký hành động và trạng thái hiệu chuẩn phải trùng khớp tuyệt đối.
2. Đối chứng dương `selfTest.pass` ở **cả hai** lần chạy. Có 17 ca trên ECN @1600, đi qua đúng đường đo thật
   (`measurePage` / `runActions` / `dataErrors`); mỗi ca chèn một cách lách vào trang vừa nạp lại sạch:

   | Ca | Cách lách | Phải thấy |
   |---|---|---|
   | T01 | banner lồng 2 tầng `px-5 py-4` (lọt regex FE1), cao 100 px | `bannersBeforeMain` +1, `chromeAboveMain` ≥ +100 |
   | T02 | lớp phủ fixed 200×200 không `data-loc` | `coverMain` ≥ +36 000 px², đúng thủ phạm |
   | T03 | `[data-layout-kpi]` | `official` +1, `legacy` không đổi |
   | T04 | attribute bọc h1 + một cái ngoài `<main>` | LỖI |
   | T05 | hành động không tồn tại | LỖI |
   | T06 | attribute đúng phần tử FE1 (đối chứng) / đặt lên `tbody` (lệch) | đối chứng: `matches-reference`, 0 lỗi; lệch: LỖI hiệu chuẩn |
   | T07 | banner `px-5 py-4` **không đánh dấu** đầu MAIN | LỖI banner trong MAIN |
   | T08 | 4 chip KPI **không đánh dấu** đầu MAIN | LỖI `kpi-strip` |
   | T09 | ghi chú chèn vào page header dưới h1 | `bannersBeforeMain` +1 |
   | T10 | nút chết | LỖI `no-effect` |
   | T10b | nút mở panel inline 150 px | `inline`, cao ≥150, đẩy MAIN ≥150 |
   | T11 | tổ tiên `overflow:hidden` cắt MAIN còn 100 px | `mainPct` ≤ diện tích 100 px |
   | T12 | `aside[role=complementary]` 300×300 + `[data-testid=copilot-panel]` 200×200 trong MAIN | `aiInsideMain` ≥ 117 000 px², `workspacePct` giảm tương ứng |
   | T13 | portal fixed `role=status` đè dải đầu | +1 banner `overlay` |
   | T14 | `role=dialog` mở sẵn | LỖI `dialogsAtLoad` |
   | T15 | container anh em `overflow:hidden` cao 100 px chứa 2 000 px | `pageHeightRatio` ≥ +1,95 |
   | T16 | băm `ERR:` | LỖI |
3. Không lỗi băm, không trôi dữ liệu trong từng lần chạy.
4. Dữ liệu giống nhau giữa hai lần chạy.
5. Cùng hồ sơ cờ.

**Gác phải biết ĐỎ.** `--mutation` lần lượt gỡ từng gác (`GUARDS` trong script: `geoBand`, `hitTest`,
`kpiBoth`, `attrConstraint`, `actionNotFound`, `calib`, `insideMain`, `headerBanner`, `noDialog`, `clip`,
`aiInside`, `overlayBand`, `dialogsAtLoad`, `scrollSiblings`, `errHash`). Với mỗi gác bị gỡ, (các) ca của nó
**phải đỏ**; kết quả ghi ở `meta.selfTest.mutation[]`, và `pass` của lần chạy có `--mutation` đòi mọi gác
đều đỏ khi gỡ.

Kết quả của Task 1 nằm trong `.superpowers/sdd/2026-09-27-engineering-control-dot2-bo-cuc/task-1-report.md`.
