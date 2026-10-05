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
   - `OLLAMA_BASE_URL=http://127.0.0.1:9` (cổng đóng, như `UNS_BROKER_URL`): lượt làm ấm Ollama lúc khởi động
     (`warmUpOllamaModels`, không có cờ tắt) không chạm Ollama thật ở :11434 (doc 81 Đợt 3 final wave — Task 2 đo được
     một kết nối :11434 ngay sau khởi động). Danh sách kết nối được phép KHÔNG đổi.
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
| `h1Top` / `h1Bottom` / `gapH1ToMain` | vị trí h1 và khoảng từ đáy h1 tới đỉnh MAIN. Trang không có h1 thì dải tính từ đỉnh `<main>`. Trang **có h1 ở baseline** (`legacyRef.hadH1`) mà nay mất h1 ⇒ **LỖI**. Studio không có h1 ở baseline ⇒ chỉ cảnh báo |
| `bannersBeforeMain` | **Hình học**: mọi khối nhìn thấy nằm HẲN trên MAIN, giao ngang với MAIN, **dưới đáy h1 — kể cả khối nằm trong page header của h1** (phụ đề, ghi chú… không còn được miễn), **cộng mọi khối phía TRÊN h1** (vd banner Beta) trừ breadcrumb (đếm riêng), cộng **popover/portal mở sẵn** đè dải đầu trang (`kind: overlay`; tính cả `position:fixed` nằm trong `<main>`). Gồm `count`, `px` (chiều cao hợp), `byKind` (`notice`/`kpi`/`tabs`/`subtitle`/`overlay`/`other`, chỉ là nhãn; `breadcrumb` không tính). Không phụ thuộc lớp CSS |
| `blocksAboveH1`, `headerParts`, `bandBlocks[]` | khối phía trên h1 (vd banner Beta), số phần tử trong page header, danh sách đầy đủ có `pos` (`aboveH1`/`besideH1`/`belowH1`/`besideMain`/`overlay`), `kind`, `loc` |
| `bannersFe1Class` | bộ phân loại lớp CSS của FE1. **Chỉ là nhãn phụ** để đối chiếu FE1 |
| `breadcrumbs` | số breadcrumb nhìn thấy (shell + trang), theo selector `nav[data-slot=breadcrumb]`/aria-label như FE1 |
| `kpi` | `legacy` (MetricCard) **và** `official` (`[data-layout-kpi]`), **luôn cả hai**; `all.stripPx` = chiều cao hợp của dải |
| `coverMain` | **Hit-test** lưới 8 px trên phần **đã cắt** của MAIN. Điểm nào có phần tử trên cùng không thuộc MAIN là bị che, bất kể tệp nguồn. Phần tử `position:fixed` nằm **bên trong** MAIN vẫn bị tính là che (`insideMain: true`). Gồm `px`, `pctOfMain`, `items[]` (phần tử fixed/absolute/sticky ngoài cùng: tag/testid/loc/zIndex). `positionedIntersecting[]` liệt kê thêm phần tử định vị cắt MAIN mà hit-test không thấy (vd `pointer-events:none`) — chỉ báo. **Miễn hẹp (R-2-m, Task 5)**: điểm mà phần tử trúng CHÍNH LÀ separator co giãn (`[data-panel-resize-handle-id][role=separator]`, không leo tổ tiên), trong luồng (`static`/`relative`), hộp riêng ≤2 px, là anh em của MAIN (cha chứa MAIN) và điểm cách hộp ≤4 px ⇒ không tính che, đếm riêng ở `separatorHitPx` (chỉ báo). Lý do: dải `::after` của đường kéo panel dưới (`ui/resizable.tsx`) lấn 2 px vào MAIN và trúng đúng một hàng lưới ở 1366 (8448 px² giả) |
| `pageHeightRatio` | **Chỉ số được gác** (R-2-f): (chiều cao tài liệu + phần cuộn/ẩn của mọi **tổ tiên** của MAIN có `overflow-y` auto/scroll/overlay/**hidden/clip**) / vh; mỗi phần chỉ tính khi vượt ≥ 24 px. Phần cuộn/ẩn LỚN NHẤT của các panel **anh em** trong `<main>` (explorer/inspector tự cuộn — bình thường trong vỏ workbench) chỉ BÁO ở `scroll.siblingScrollExtra`, KHÔNG gác. `pageHeightRatioDoc` = cách tính của FE1. `scroll.inner[]` = container cuộn bên trong MAIN (vd bảng tự cuộn — kiểm khi chấm Standards ≤1,5×) |
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
- **Cổng hiệu chuẩn.** Dung sai: Δtop ≤ 4 px, Δleft ≤ 4 px, Δdiện tích ≤ 3 %.
  - Bản ghi trong `do-bo-cuc/calibration.json` có **khoá = màn|vw|biến thể** và lưu hình học MAIN (`mainTop`,
    `rects`, `areaPx`) cùng **bộ chọn của phần tử mang attribute** (`attrSel` = tag + giá trị attribute + tệp
    nguồn).
  - **Mỗi lần chạy** đều so lại với bản ghi: lệch hình học, hoặc attribute nằm trên phần tử khác ⇒ **LỖI**.
  - **Chưa có bản ghi**: so với MAIN tham chiếu theo selector FE1 (`legacyRef` trong `baseline.json`). Khớp ⇒
    đạt kèm cảnh báo "chạy --calibrate"; lệch ⇒ **LỖI**.
  - Quy trình:
    1. Gắn attribute trên bố cục **chưa đổi**, chạy `--spawn --calibrate --screens <màn>`. Công cụ chỉ ghi
       bản ghi MỚI khi khớp tham chiếu FE1. Commit `calibration.json`.
    2. Đổi bố cục, chạy lại `--calibrate`. Công cụ ghi đè bản ghi và giữ `previous`, nên thay đổi hiện trong
       diff git. Commit. Sau đó chạy đo thường để có `pass`.
  - `calibration.json` do công cụ ghi, **không sửa tay** (người duyệt kiểm bằng `git log -p`).
- **Banner / dải KPI trong MAIN (theo hình học).** Quy tắc chính xác:
  1. Phần tử làm việc **W** của một MAIN là **phần tử GỐC** có đỉnh nhỏ nhất trong MAIN thuộc: `table`,
     `[role=grid|treegrid|tree|listbox]`, `canvas`, `.cm-editor`, `.monaco-editor`, `.react-flow`, `textarea`,
     `[contenteditable=true]`, **`EmptyState`** (`data-loc` EmptyState.tsx / `[data-layout-empty]`), hoặc `svg`
     ≥200×120 **không** nằm trong hàng KPI.
     - Phần tử nằm trong bề mặt AI không được tính.
     - `[data-layout-workspace]` **không còn là W**: bên trong nó, công cụ vẫn tìm phần tử gốc đầu tiên, và
       luật banner áp cho cả các khối nằm trên phần tử đó bên trong wrapper.
     - MAIN tự khai `[data-layout-workspace]` mà không phải phần tử gốc (W === MAIN) ⇒ **LỖI**.
     - Nếu không có phần tử gốc, W là khối con đầu tiên cao ≥120 px, và luật áp **tiếp** cho các khối dẫn
       đầu bên trong khối đó.
  2. **Khối trên W**: đi xuống từ MAIN, chỉ xuyên qua các tổ tiên của W. Mỗi con nhìn thấy (không fixed) nằm
     **hẳn** trên đỉnh W là một khối trên W.
  3. Khối trên W có chiều cao **< 120 px** và bề rộng **≥ 60 % bề rộng MAIN** là **BANNER TRONG MAIN**:
     - `kind: kpi-strip` khi nó chứa MetricCard/`[data-layout-kpi]`, hoặc có ≥3 con, con nào cũng hẹp
       (< 50 %), cao **28–140 px** và **không chứa ô nhập/chọn/nút** — tức chip KPI không đánh dấu (hàng điều
       khiển form không phải KPI);
     - ngược lại là `kind: banner`.

     Banner trong MAIN là **LỖI**, trừ ba ngoại lệ (R-2-f):
     - đúng **một** `[data-layout-toolbar]` cao ≤ **56 px**. Hai toolbar, hoặc toolbar > 56 px, là LỖI;
     - tiêu đề thuần `h2–h6`/`[role=heading]`/`[data-slot=card-title]` cao ≤ 40 px;
     - **khối chữ thuần ≤ 40 px**, tức thoả cả ba điều kiện (fix round 4: xét **cả cây con**, không chỉ kiểu của
       chính khối):
       - khối **và mọi hậu duệ nhìn thấy** không có nền màu, không có viền, không có lớp notice, không có
         badge/chip (`data-slot=badge`, tệp `*Badge*`/`*Chip*`), không `role=alert|status`;
       - không chứa icon `svg`/`img`, nút, ô nhập, `role=alert`;
       - chữ (kể cả chữ của hậu duệ) không chứa từ khoá notice (Khi nào dùng/Beta/xem trước/Chỉ xem/Lưu ý/Cảnh
         báo/Chế độ/TẮT…).

       Badge đếm nằm **trong** khối chữ nay làm khối **mất** miễn trừ (badge có nền) — cần badge đếm thì dùng hàng
       tiêu đề `h2–h6` (mục dưới). Wrapper trong suốt bọc chip màu hay hộp notice màu không còn là nhãn.
     - **Hàng chip / dải KPI được phân loại TRƯỚC miễn trừ nhãn** (fix round 4): khối trên W cao <120 px, rộng
       ≥60 % mà chứa MetricCard/`[data-layout-kpi]` hoặc là hàng ≥3 chip (quy tắc 3) là `kpi-strip` ngay cả khi
       ≤40 px và không màu — một hàng chip 32 px trong wrapper trong suốt không thể là "label".
     - **hàng tiêu đề ≤ 40 px**: chứa `h2–h6`/`[role=heading]`/`card-title` chiếm ≥50 % chữ của khối; icon
       (nếu có) chỉ trang trí (`aria-hidden`); không nút/ô nhập/alert; bản thân khối không nền/viền. Ví dụ
       "📥 ĐANG CHỜ DUYỆT & CẢNH BÁO 12" ở Hub. Từ khoá notice nằm trong chữ tiêu đề không tính.
  5. **Trạng thái trống là W**: `EmptyState` (component), hoặc trạng thái trống tự viết. Trạng thái trống tự
     viết là `p`/`div` ≥32 px cao, chữ <160 ký tự mở đầu bằng "Chưa có / Không có / Hiện không có / Trống /
     Chọn … để|ở / No / Nothing / Select … to / 暂无 / 没有", không nút/ô nhập/bảng/alert, không nền/viền, **chữ
     không chứa từ khoá notice**, và **không nằm trong hộp notice** (fix round 4): không tổ tiên nào (từ cha tới
     MAIN, không gồm MAIN) có `role=alert|status`/`data-slot=alert`, lớp notice (regex FE1), lớp Tailwind mang
     token màu `bg-`/`border-(amber|red|sky|green|warning|info|destructive|success|primary…)`, hay nền/viền đã
     tính có **chroma OKLab > 0,05** (trung tính của theme — card/border/muted/secondary/accent — có C ≤ 0,03;
     Chrome trả `oklch()`/`oklab()`, công cụ tự quy đổi). Card/SectionCard bọc ngoài vẫn hợp lệ; "Chưa có dữ
     liệu" trong hộp vàng ⇒ hộp là banner và W là bảng. Ví dụ Orchestration: "Chưa có bước nào…", "Chọn một bước
     trên cây để cấu hình."
     `insideMain[].workspace.kind` = `native` / `empty-state` / `chart` / `fallback-block`.
  4. Khối cao ≥120 px hoặc hẹp hơn 60 % không phải banner, nhưng vẫn cộng vào `aboveWorkspacePx` và đẩy
     `workspacePct` xuống.
- **Bề mặt AI trong MAIN** được trừ khỏi vùng làm việc (`workspacePct`) và báo riêng ở `aiInsideMain`. Nhận
  diện **rộng** có chủ đích: phần tử ≥120×120 trong MAIN khớp `[role=complementary]`, `[data-ai]`,
  `[data-layout-ai]`, `data-testid` chứa `copilot`/`assistant`/`ai-panel`/`ai-chat`, `data-loc` chứa
  `Copilot`/`AILocal`/`Assistant`, hoặc `aria-label` chứa `copilot`/`assistant`/`trợ lý` (không phân biệt
  hoa thường). Ngoài ra, khối ≥120×120 có `aria-label` hoặc tiêu đề đầu (trong 60 px đầu khối) **chứa một
  nhãn AI lấy từ i18n** cũng được tính. Nhãn là mọi chuỗi ≤40 ký tự trong `locales/{vi,en,zh}.json` có
  copilot/trợ lý/assistant/副驾/助手, vd "Trợ lý Lập trình AI", "Programming Copilot", "编程副驾"; nguồn ghi ở
  `via: i18n-label`. Ngoại lệ: màn `programming-copilot`, nơi MAIN chính là bề mặt AI (`aiIsWorkspace`).
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
2. Đối chứng dương `selfTest.pass` ở **cả hai** lần chạy. Có 37 ca trên ECN @1600, đi qua đúng đường đo thật
   (`measurePage` / `runActions` / `dataErrors`); mỗi ca chèn một cách lách vào trang vừa nạp lại sạch. Phép đo
   trong tự kiểm đo lại (≤3 lần, chờ settle) nếu MAIN tạm vắng vì trang đang vẽ lại; số lần đo lại ghi ở
   `meta.selfTest.retries` (0 là bình thường). "Nạp lại sạch" gồm cả **gỡ `data-layout-main` có sẵn của trang**
   (Task 4: ECN là trang đầu tiên gắn attribute; attribute sẵn có làm ca T06 "attribute trên `tbody`" thành MAIN lồng,
   bị bỏ qua ⇒ đỏ oan). Ca tự kiểm dựa vào selector FE1 của ECN (card **hoặc section** `EngineeringChanges.tsx` chứa
   bảng, depth 0 — final wave T4-M6: danh sách ECN là `<section>`, không còn Card vô hiệu kiểu chỉ để selector thấy):

   | Ca | Cách lách | Phải thấy |
   |---|---|---|
   | T01 | banner lồng 2 tầng `px-5 py-4` (lọt regex FE1), cao 100 px | `bannersBeforeMain` +1, `chromeAboveMain` ≥ +100 |
   | T02 | lớp phủ fixed 200×200 không `data-loc` | `coverMain` ≥ +36 000 px², đúng thủ phạm |
   | T03 | `[data-layout-kpi]` | `official` +1, `legacy` không đổi |
   | T04 | attribute bọc h1 + một cái ngoài `<main>` | LỖI |
   | T05 | hành động không tồn tại | LỖI |
   | T06 | attribute đúng phần tử FE1 / đặt lên `tbody` / bản ghi khớp / bản ghi khác bộ chọn / bản ghi khác hình học | `matches-reference` 0 lỗi / LỖI / `recorded-match` 0 lỗi / LỖI / LỖI |
   | T07 | banner `px-5 py-4` **không đánh dấu** đầu MAIN | LỖI banner trong MAIN |
   | T08 | 4 chip KPI **không đánh dấu** đầu MAIN | LỖI `kpi-strip` |
   | T09 | ghi chú chèn vào page header dưới h1 (header một hàng `PageHeaderCompact` bị cho xuống hàng thứ hai để chứa ghi chú — Task 4) | `bannersBeforeMain` +1 |
   | T10 | nút chết | LỖI `no-effect` |
   | T10b | nút mở panel inline 150 px | `inline`, cao ≥150, đẩy MAIN ≥150 |
   | T11 | tổ tiên `overflow:hidden` cắt MAIN còn 100 px | `mainPct` ≤ diện tích 100 px |
   | T12 | `aside[role=complementary]` 300×300 + `[data-testid=copilot-panel]` 200×200 trong MAIN | `aiInsideMain` ≥ 117 000 px², `workspacePct` giảm tương ứng |
   | T13 | portal fixed `role=status` đè dải đầu | +1 banner `overlay` |
   | T14 | `role=dialog` mở sẵn | LỖI `dialogsAtLoad` |
   | T15 | tổ tiên MAIN bị ép cao 200 px + `overflow:hidden` | `pageHeightRatio` không giảm (phần giấu vẫn tính) |
   | T15b | panel anh em `overflow:hidden` 100 px chứa 2 000 px | `siblingScrollExtra` ≥ 1 900 nhưng `pageHeightRatio` tăng ≤ 0,2 (không gác) |
   | T16 | băm `ERR:` | LỖI |
   | T17 | wrapper `[data-layout-workspace]` bọc tiêu đề + notice + bảng | VẪN LỖI banner trong MAIN |
   | T17b | MAIN tự khai `[data-layout-workspace]` (không phải phần tử gốc) | LỖI W === MAIN |
   | T18 | xoá h1 | LỖI mất h1 |
   | T19 | notice chèn **trên** h1 | `bannersBeforeMain` +1 |
   | T20 | `position:fixed` 200×200 **bên trong** MAIN | `coverMain` ≥ +36 000 px² |
   | T21 | nhãn chữ thuần 20 px / cùng cỡ có nền màu | miễn / LỖI banner |
   | T22 | khối 300×300 chỉ có tiêu đề "Trợ lý Lập trình AI" | `aiInsideMain` qua `i18n-label` |
   | T23 | một `[data-layout-toolbar]` 52 px | không lỗi |
   | T24 | hàng 4 chip cao 20 px | `banner`, không phải `kpi-strip` |
   | T25 | `EmptyState` 200 px đứng trước bảng | W = EmptyState, `aboveWorkspacePx` < 50 |
   | T26 | wrapper trong suốt 32 px bọc 4 chip 32 px (chip có màu, rồi chip không màu) | `kpi-strip`, LỖI — không phải `label` |
   | T27 | wrapper trong suốt 36 px bọc hộp notice màu (không icon, không từ khoá) | `banner`, LỖI |
   | T28 | "Chưa có dữ liệu" trong hộp vàng (style oklch / lớp `px-5 py-4` lọt regex FE1) · chữ trống không màu có từ khoá notice | hộp là `banner`, LỖI; W = bảng |
   | T29a | separator anh em MAIN, trong luồng, 1 px, dải `::after` 8 px lấn vào MAIN, đặt đúng một hàng lưới (R-2-m) | `coverMain` KHÔNG đổi, `separatorHitPx` > 0 (gỡ gác `separatorExempt` ⇒ ĐỎ) |
   | T29b | CÙNG attribute separator trên lớp phủ `absolute` 40 px anh em MAIN (absolute TRONG MAIN vốn không tính che) | `coverMain` ≥ +0,9×40×rộng, đúng thủ phạm |
   | T29c | separator 1 px `position:fixed` ngang giữa MAIN | `coverMain` ≥ +0,9×8×rộng, `separatorHitPx` không đổi |
   | T30 | khối 3 000 px chèn vào `<main>` | LỖI "CUỘN NGANG CẤP TRANG" (trang sạch không có) |
   | T31 | đầu dò Copilot trên trang không Copilot (biến thể open) / bơm `aside[data-layout-ai]` có `tabpanel#…-copilot` (open, rồi closed) | LỖI / 0 lỗi / LỖI |
   | T32 | màn tab (`tabOf`) chưa có bản ghi: attribute trùng phần tử của trang mẹ / phần tử khác / trang mẹ chưa có bản ghi | `matches-reference` 0 lỗi / LỖI / LỖI |
3. Không lỗi băm, không trôi dữ liệu trong từng lần chạy.
4. Dữ liệu giống nhau giữa hai lần chạy.
5. Cùng hồ sơ cờ.

**Gác phải biết ĐỎ.** `--mutation` lần lượt gỡ từng gác (`GUARDS` trong script: `geoBand`, `hitTest`,
`kpiBoth`, `attrConstraint`, `actionNotFound`, `calib`, `insideMain`, `headerBanner`, `noDialog`, `clip`,
`aiInside`, `overlayBand`, `dialogsAtLoad`, `errHash`, `scrollAncestors`, `siblingReport`, `wsEscape`, `h1Gate`,
`aboveH1Banner`, `fixedInMain`, `textLabel`, `aiText`, `toolbar56`, `chipMin`, `emptyStateW`, `kpiFirst`, `labelDeep`,
`emptyNotice`, `separatorExempt`, `hScroll`, `copilotAssert`, `tabCalib` — 32 gác). Với mỗi gác bị gỡ, (các) ca của nó
**phải đỏ**; kết quả ghi ở `meta.selfTest.mutation[]`, và `pass` của lần chạy có `--mutation` đòi mọi gác
đều đỏ khi gỡ. Số lần đo lại của mọi lượt gỡ gác được cộng ở `meta.selfTest.mutationRetries`.

Kết quả của Task 1 nằm trong `.superpowers/sdd/2026-09-27-engineering-control-dot2-bo-cuc/task-1-report.md`.

## Đường cơ sở SAU SHELL (Task 2) — dùng cho các task chuyển trang (Task 4+)
`docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline-sau-shell.json` = lần đo sau Task 2 (gitHead a74e59d80; fix round 2 chỉ đổi FreshnessStrip). `baseline.json` (trước Task 2) giữ làm mốc gốc của Đợt 2. Mỗi task chuyển trang: so TRƯỚC/SAU bằng `--compare` với `baseline-sau-shell.json` và hiệu chuẩn `data-layout-main` lần đầu theo hình học của tệp này (ruling R-2-k, 2026-10-03).

## Bí danh sau Task 15 (Ruling R-2-x, 2026-10-04)
Hai màn của Đợt 2 đã bị GỘP ở Task 15. URL cũ của chúng chỉ còn là chuyển hướng (giữ query; xem
`client/src/lib/engineeringLegacyRedirects.tsx`). Hai `SCREENS` này nay đo ĐÍCH chuyển hướng và mang khoá `calibrateAs`:

| id (giữ để bảng 14 màn liền mạch) | route đo | trước Task 15 | hiệu chuẩn so với bản ghi |
|---|---|---|---|
| `engineering-studio` | `/engineering-home?tab=catalog` | launcher Studio riêng (`/engineering-studio`) | `engineering-home|vw|n/a` |
| `programming-copilot` | `/engineering?copilot=scratch` | trang form Copilot riêng (`/programming-copilot`) | `engineering|vw|open` |

- **Cổng vẫn cứng.** Bí danh so hình học và phần tử mang attribute với bản ghi của màn đích. Lệch là LỖI. `--calibrate`
  KHÔNG BAO GIỜ ghi bản ghi cho bí danh: muốn đổi thì hiệu chuẩn màn đích.
- `programming-copilot` **bỏ `aiIsWorkspace`**. Copilot nay là panel trong layout, nằm NGOÀI MAIN. Giữ miễn trừ cũ sẽ là
  nới thước.
- `PAGE_TABLES` / `KNOWN_PROCS` của bí danh = hợp của danh sách cũ với danh sách của màn đích.
- **TRƯỚC/SAU KHÔNG CÙNG LOẠI.** Số FE1 (`--fe1`) và `baseline*.json` của hai id này là trang CŨ. Số sau Task 15 là trang
  đích (tab Danh mục của Hub / IDE chưa mở dự án + Copilot). Mọi bảng TRƯỚC/SAU (Task 16) phải ghi rõ điều này, không
  được đọc như cải thiện hay thoái lui của cùng một màn.

## Đợt 2 final wave (Ruling R-2-z1, 2026-10-04) — mọi số nghiệm thu tái lập được từ thước đã commit
Trước đợt này hai số của doc 81 §11 chỉ có ở một bản sao thước trong scratchpad (final review I-4). Nay thước chính có:

- **Màn `equipment-standards-alarms`** (`/equipment-standards?tab=alarms`, `tabOf: "equipment-standards"`): mục tiêu
  "trang cao nhất ≤1,5×" đo trên chính tab cảnh báo. `PAGE_TABLES`/`KNOWN_PROCS` = của Standards (cùng trang).
  Hiệu chuẩn: bản ghi RIÊNG `equipment-standards-alarms|vw|n/a` (MAIN của tab khác hình học tab mặc định). Bản ghi
  MỚI chỉ được `--calibrate` ghi khi phần tử mang attribute TRÙNG phần tử đã hiệu chuẩn của trang mẹ (`fromReference:
  { parentElement }`) — FE1 chưa từng đo tab này nên không có tham chiếu hình học. Sau đó so lại mỗi lần chạy như mọi
  màn (lệch ⇒ LỖI). Cổng h1 của màn tab / bí danh dùng tham chiếu h1 của màn mẹ/đích (`h1Ref`).
- **`hScroll`** (mỗi bản ghi): `docOverflowPx` (tài liệu) và `mainOverflowPx` (`<main>` của shell, container cuộn của
  trang) — cuộn ngang CẤP TRANG. Ở khung ≥1366 px, >1 px là **LỖI** (Ràng buộc 10). Cuộn ngang bên trong một ô (bảng tự
  cuộn) không tính.
- **Biến thể Copilot phải có thật** (`copilot` mỗi bản ghi của màn có biến thể): đầu dò `COPILOT_PROBE` tìm bề mặt
  `[data-layout-ai]` nhìn thấy ≥120×120 chứa `[role=tabpanel][id$="-copilot"]` không `hidden`. Biến thể `open` mà không
  thấy ⇒ **LỖI**; biến thể `closed` mà thấy ⇒ **LỖI** (hạt giống trạng thái hỏng). Hạt giống là khoá mới
  `progCopilot.open` (M-3; khoá cũ `progCopilotDock.open` bị gỡ trong context đo).
- `KNOWN_PROCS` của Fleet có `fleet.robotPositions` + `twin.occupancyGrid` (bản đồ là MAIN từ Task 10).
- `--calibrate` ghi kèm `gitDirty` (tệp chưa commit dưới `client/src`/`scripts/ui-metrics` lúc hiệu chuẩn) — `gitHead`
  một mình không nói bố cục đo có nằm trong commit đó (T4-M7).


## Màn dời ra trang riêng (Đợt 3 Task 2, 2026-10-05) — `vision-acquisition`
Worker thu ảnh rời tab `?tab=acquisition` của Equipment Integration sang trang riêng Vision › Thu ảnh (`/vision/acquisition`).
URL cũ chuyển hướng tới trang mới (giữ query, bỏ `tab`). Màn đo theo khuôn R-2-k, hai bước, cùng **một** id:

| bước | `route` đo | khoá khai báo | bản ghi hiệu chuẩn `vision-acquisition|vw|n/a` |
|---|---|---|---|
| 1 — TRƯỚC (commit 5107ac3ca) | `/equipment-integration?tab=acquisition` | `tabOf: "equipment-integration"` | ghi bằng `--calibrate` vì attribute TRÙNG phần tử đã hiệu chuẩn của Integration |
| 2 — SAU | `/vision/acquisition` (`aliasOf` = URL cũ) | `movedFrom: "equipment-integration"` | so lại mỗi lần chạy; trang mới ⇒ lệch ⇒ LỖI cho tới khi `--calibrate` ghi đè (giữ `previous`, diff git cho thấy) |

- `movedFrom` **chỉ** cấp tham chiếu h1 (`h1Ref` = của trang mẹ cũ, như `tabOf`/`calibrateAs`). Nó **không** có nhánh hiệu chuẩn
  riêng: không có bản ghi thì rơi vào nhánh thường (không tham chiếu FE1 ⇒ LỖI). Không gác nào bị nới.
- `PAGE_TABLES` = của Integration (vỏ; ⊆ hợp `allTables()`). `KNOWN_PROCS` = CHỈ thủ tục của vỏ + `visionAdapter.acquisitionWorkerStatus`,
  `visionAdapter.listAcquisitionSources` (bộ nhớ server, không bảng) — fix round 1 bỏ `equipmentIntegration.*`/`machine.list` thừa kế
  (trang không gọi; giữ lại là nới danh sách cho phép).
- Hành động khai báo: `khoi-dong-worker` (nút MỞ sheet `acq-start`; không bao giờ bấm nút gửi trong sheet).
- **TRƯỚC/SAU KHÔNG CÙNG LOẠI** về hình học: trước là MAIN của Integration (hàng tab + bảng), sau là MAIN của trang mới (hàng công
  cụ + bảng). Đọc như "cùng nội dung ở chỗ mới", không như cải thiện/thoái lui của cùng một MAIN.

### `production-shifts` (Đợt 3 Task 3, 2026-10-05) — cùng khuôn
Bảng nhân lực rời tab `?tab=workforce` của Safety & Workforce sang trang riêng Sản xuất › Ca (`/production/shifts`).

| bước | `route` đo | khoá khai báo | bản ghi hiệu chuẩn `production-shifts|vw|n/a` |
|---|---|---|---|
| 1 — TRƯỚC (commit 62100994f) | `/safety-workforce?tab=workforce` | `tabOf: "safety-workforce"` | ghi bằng `--calibrate` vì attribute TRÙNG phần tử đã hiệu chuẩn của Safety |
| 2 — SAU | `/production/shifts` (`aliasOf` = URL cũ) | `movedFrom: "safety-workforce"` | so lại mỗi lần chạy; trang mới ⇒ lệch ⇒ LỖI cho tới khi `--calibrate` ghi đè (giữ `previous`) |

- `PAGE_TABLES` = của Safety (đã phủ tab này ở bước 1) ∪ `shift_configs` (thủ tục mới `shiftConfig.list`). `KNOWN_PROCS` = CHỈ 11
  thủ tục trang gọi (vỏ + `safety.status`/`listAssignments`/`currentBoard` + `shiftConfig.list`). `safety-workforce` bỏ
  `safety.currentBoard` khỏi `KNOWN_PROCS` (Safety không còn gọi — thu hẹp, không nới).
- Hành động khai báo: `phan-cong` (nút MỞ sheet `workforce-assign`; không bao giờ bấm nút gửi trong sheet).
- **TRƯỚC/SAU KHÔNG CÙNG LOẠI**: trước là MAIN của Safety (hàng tab + bảng phân công + bảng hiện trường, panel phụ của Safety);
  sau là MAIN của trang mới (hàng công cụ + bảng phân công; bảng hiện trường ở panel phụ của chính trang).


## Đợt 3 Task 4 (2026-10-05) — giao việc Kỹ thuật (mig 0363)
- `PAGE_TABLES` của `engineering-home`, `engineering-changes`, `recipes`, `interlock-rules`, `orchestration-studio` thêm
  `engineering_assignments` (Hub đọc qua `oversight.pendingSummary.mine`; bốn trang đọc cột "Người được giao").
- `KNOWN_PROCS` của bốn trang thêm `engineering.assignments` (gọi lúc nạp trang). `engineering.assignableUsers` KHÔNG thêm:
  chỉ gọi khi mở sheet/khối duyệt — lần đo nạp trang không chạm nó (thêm vào là nới danh sách cho phép).
- Không đổi gác, không đổi bản ghi hiệu chuẩn: MAIN của năm màn trùng hiệu chuẩn cũ (BEFORE/AFTER 0 dòng lệch).

## Đợt 3 Task 5 (2026-10-05) — Fleet → Labs (`/labs/fleet-orchestration`, khuôn bí danh R-2-x)
- Màn `fleet-orchestration` đo route MỚI `/labs/fleet-orchestration`; `aliasOf: "/fleet-orchestration"` (URL cũ chỉ còn chuyển hướng
  giữ query — `client/src/lib/engineeringLegacyRedirects.tsx`).
- Khác hai bí danh Task 15: đây là **CÙNG một trang** (chỉ đổi đường dẫn), nên KHÔNG có `calibrateAs` hay `movedFrom`. id, phần tử
  mang `data-layout-main="fleet-orchestration"` và bản ghi hiệu chuẩn `fleet-orchestration|vw|n/a` là của chính trang ⇒ mỗi lần chạy so
  lại với bản ghi đó (lệch ⇒ LỖI). Không ghi lại hiệu chuẩn, không gác nào bị nới.
- **TRƯỚC/SAU CÙNG LOẠI** (cùng MAIN). Khác duy nhất nhìn thấy: breadcrumb trong top bar đổi section (`Điều phối` ⇒ `Labs — thử nghiệm`).
- `PAGE_TABLES` / `KNOWN_PROCS` KHÔNG đổi (trang gọi đúng các thủ tục cũ; công tắc "Hiện Labs" ở thanh bên là localStorage, không gọi
  server). Người dùng đo (`uim_engineer`) có Labs ẨN (mặc định) — thước vào màn bằng URL nên không phụ thuộc menu.
