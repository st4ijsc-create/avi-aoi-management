# `scripts/ui-metrics/` — thiết bị đo bố cục (doc 81 Đợt 2)

`engineeringLayout.mjs` đo bố cục 14 màn "Kỹ thuật & Điều khiển" trên trình duyệt thật (Playwright).
Đợt 2 dùng nó để nghiệm thu: mỗi task chuyển trang chạy script trên trang của mình ở 1600×950 và
1366×768, rồi ghi số TRƯỚC/SAU vào báo cáo. Đường cơ sở trước mọi thay đổi nằm ở
`docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json`.

## Chạy

```bash
# Tự dựng instance, đo 14 màn × 2 kích thước (+ biến thể mở Copilot cho IDE/IR/POU), rồi tắt hết
node scripts/ui-metrics/engineeringLayout.mjs --spawn --out .playwright-mcp/do-bo-cuc/lan-1.json

# Chỉ một vài màn (khi nghiệm thu một task), kèm ảnh chụp (vào .playwright-mcp/do-bo-cuc/anh/, đã gitignore)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --screens engineering-changes --shots --out .playwright-mcp/do-bo-cuc/ecn-sau.json

# MSA: so hai lần chạy, mã thoát 1 nếu có chỉ số lệch ≥ 2 %
node scripts/ui-metrics/engineeringLayout.mjs --compare .playwright-mcp/do-bo-cuc/lan-1.json .playwright-mcp/do-bo-cuc/lan-2.json

# Đối chiếu với bảng §0 của FE1 (±5 %)
node scripts/ui-metrics/engineeringLayout.mjs --fe1 docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json

# Liệt kê nút trong <main> của từng màn (để cập nhật danh sách hành động mở dialog)
node scripts/ui-metrics/engineeringLayout.mjs --spawn --list-buttons --sizes 1600x950 --out .playwright-mcp/do-bo-cuc/nut.json
```

Tuỳ chọn: `--server-port 3016`, `--vite-port 5176`, `--sizes 1600x950,1366x768`,
`--keep` (giữ instance để xem bằng tay; in user/mật khẩu; Ctrl-C tắt). Muốn đo một instance có sẵn:
`--base http://127.0.0.1:5176 --user U --password P`. **Không bao giờ trỏ `--base` vào :3000**:
:3000 chạy `dist` cũ, không phản ánh mã đang sửa.

## `--spawn` làm gì (và vì sao an toàn)

1. Kiểm cổng 3016 và 5176 còn trống. Nếu bận thì dừng, không đo. Server tự nhảy sang cổng khác
   khi cổng bận, nên script cũng kiểm dòng `Server running on …:3016` trong log.
2. Tạo user đo tạm `uim_engineer` trong **`aoi_management_test`**. URL lấy từ `DATABASE_URL` của
   `.env` (chỉ đọc) rồi đổi tên DB, hoặc từ `UIM_TEST_DATABASE_URL`. Tên DB khác
   `aoi_management_test` thì từ chối, và `current_database()` được kiểm trước mọi lệnh ghi.
   User có role `engineer`, quyền theo `DEFAULT_ROLE_PERMISSIONS.engineer` (cùng cách
   `scripts/seed-test-data.mjs`), được gán `SIM-FAC` như `engineer1` của FE1. 2FA tắt.
3. Server **từ mã nguồn**: `node node_modules/tsx/dist/cli.mjs server/_core/index.ts`, cổng 3016,
   `ROLE=api`.
   - Env của tiến trình con được dựng lại từ đầu, chỉ giữ biến hệ thống.
   - `DOTENV_CONFIG_PATH` trỏ tới một tệp không tồn tại ⇒ `.env` **không** được nạp.
   - Mọi tích hợp ra ngoài đều tắt: MQTT/UNS/Sparkplug, OT, robot, OPC UA, ROS2, SIM telemetry,
     edge, SECS/GEM, MTConnect, VDA5050, llama/GPU/KB, webhook, OTEL, twin stream, OpenAI gateway.
   - Không sửa `.env`.
   - Đã đo một lần (báo cáo Task 1): server chỉ có kết nối ra tới `127.0.0.1:5434`.
4. Vite dev chạy **trong tiến trình script** ở cổng 5176, dùng `vite.config.ts` của repo.
   - Proxy `/api` (kể cả websocket) và `/uploads` sang :3016.
   - `cacheDir` đặt trong `%TEMP%/aoi-ui-metrics-vite-cache`, nên không ghi vào `node_modules/`.
   - Không build, không đụng `dist/`.
5. Đo, rồi dọn: đóng Vite, `taskkill /T` cây tiến trình server, xoá user đo (quyền, gán nhà máy,
   phiên, bí mật). JSON kết quả ghi `meta.portsAfter` (3016/5176 phải là "trống") và
   `meta.probeUserRemoved`.

## Chỉ số (mỗi bản ghi trong `results[]`)

| Trường | Nghĩa |
|---|---|
| `mainPct` | % khung đầu (vw×vh) mà vùng MAIN chiếm. Chỉ tính phần nhìn thấy, cắt trên ở mép dưới top bar sticky |
| `mainSource` / `missingDataLayoutMain` | `data-layout-main` (chính thức) hoặc `fe1-legacy` (selector FE1, xem `SCREENS[].legacyMain`) |
| `mainPctFe1` | như `mainPct` nhưng cắt ở y=109 như FE1, chỉ để đối chiếu |
| `mainPctUnoccluded` | `mainPct` trừ phần bị AI đè |
| `mainTop` | y của mép trên MAIN (px, scrollY=0) |
| `h1Top` | khoảng từ đỉnh viewport tới h1 đầu tiên nhìn thấy |
| `breadcrumbs` | số breadcrumb nhìn thấy (shell + trang) |
| `bannersBeforeMain` | số và px các notice phía trên MAIN, theo định nghĩa notice của FE1 (alert, khung viền màu, "Khi nào dùng"/Beta…) |
| `kpi` | `[data-layout-kpi]` nếu có, nếu không thì thẻ `MetricCard`; gồm `count` và `stripHeight` (chiều cao hộp bao các thẻ) |
| `dialogsAtLoad`, `actions[]` | số `role=dialog`/`alertdialog` lúc nạp, và sau khi mở từng hành động khai báo (`dialogs`, `kinds` = data-slot, `closedByEsc`) |
| `aiOcclusion` | diện tích MAIN bị dock Copilot / bong bóng AI / `[data-layout-ai]` đè: `overlapMainPx`, % của MAIN, % khung |
| `pageHeightRatio` | chiều cao trang / chiều cao viewport |

`pagesMissingDataLayoutMain` liệt kê các màn chưa có attribute. Script in cảnh báo ⚠ cho từng
bản ghi đo bằng selector cũ và **không bao giờ im lặng**. Không thấy MAIN thì ghi `mainFound:false`,
và màn đó nằm trong `mainNotFound`.

## Quy ước cho các task sau

- Gắn `data-layout-main` lên phần tử MAIN của trang (editor/canvas/danh sách/bảng). Nhiều vùng MAIN
  cạnh nhau thì gắn từng vùng. Phần tử lồng trong một phần tử khác cùng attribute không bị tính hai lần.
- Gắn `data-layout-kpi` lên từng chip/thẻ của dải KPI mới (`StatusChipStrip`).
- Panel AI nằm trong layout có thể gắn `data-layout-ai`. Nó chỉ bị tính là "che" khi hình chữ
  nhật của nó cắt MAIN.
- Hành động mở dialog khai báo trong `SCREENS[].actions` (theo tên nút). **Chỉ khai nút MỞ**,
  không bao giờ khai nút lưu/duyệt/deploy/chạy.
- Biến thể Copilot (`variant`): `closed` cho mọi màn, thêm `open` cho IDE/IR/POU. Trạng thái đặt
  qua localStorage `progCopilotDock.open` trước khi nạp trang. Ngôn ngữ ép `vi`, sidebar mở.

## MSA

Chạy `--spawn` hai lần liên tiếp, mỗi lần một instance mới, rồi so bằng `--compare`. Độ lệch được
tính tương đối, `|a−b| / max(|a|,|b|)`, cho từng màn × kích thước × biến thể × chỉ số. Ngưỡng 2 %.
Kết quả của Task 1 nằm trong `.superpowers/sdd/2026-09-27-engineering-control-dot2-bo-cuc/task-1-report.md`.
