# Đợt 61 — XOÁ MÃ 3D CHẾT (QĐ-31) · báo cáo 8 mục

Worktree `D:/SOURCES/_twin_wt` · nhánh `feat/twin-3d-trung-tam` · 2026-09-13.
HEAD vào `518434af` (đúng kỳ vọng brief) → HEAD ra `5b009b77`.
Hai commit: `c54485fc` (xoá 8 tệp) · `5b009b77` (bỏ cảnh 3D của CommandCenter).

Mọi con số dưới đây **đo bằng lệnh**. Script + log thô trong `.qa-dot61/`.

---

## 1. Cây

| | |
|---|---|
| HEAD vào | `518434afa7f76172680c7fd2c44422ec5456120a` — khớp brief, 0 commit `docs(...)` thêm |
| HEAD ra | `5b009b77` |
| nhánh | `feat/twin-3d-trung-tam` |
| cổng dùng | **3061** (đã kiểm TRỐNG trước khi chiếm) |
| cổng KHÔNG đụng | 3001 (PID 14228) · 3008 (PID 29676) — đo `netstat` trước và sau: vẫn LISTENING, cùng PID |
| `dist/` gốc | **KHÔNG chạm** — md5 `dist/public/index.html` trước = sau = `fe363553345bebdcfddad86c57b2dc9f` |
| bản dựng của đợt | `.qa-dot61/dist-61` (914 tệp) + `dist-61b` (đối chứng md5) + `dist-nen` (nền 518434af) |
| cây sản phẩm lúc bắt đầu | `client/ server/ e2e/` **sạch**; 373 tệp `M` đều là `knowledge/` + `.qa-*` untracked (không đụng) |

---

## 2. Bảng "TRƯỚC KHI XOÁ" — bằng chứng 0 chỗ gọi sống, số dòng, md5

Đo lại **ngay trước** mỗi lần `git rm` (G83), grep trên `client/ server/ e2e/`,
trừ chính tệp. Bản đầy đủ: `.qa-dot61/TRUOC-KHI-XOA.txt`, `mon1-XONG.txt`, `mon3456-XONG.txt`.

| # | tệp | dòng | md5 (trước khi xoá) | bằng chứng "0 chỗ gọi sống" |
|---|---|---:|---|---|
| 1 | `client/src/components/factory-scene/FactoryScene3D.tsx` | 516 | `fdcee08949994ed9f92e7377a5bc924d` | 8 dòng khớp: **7 chú thích** + **1 chỗ sống** = dòng re-export của barrel `index.ts:5`. **0 chỗ DỰNG**. Người dùng barrel duy nhất là `FactoryCommandView.tsx:46` và nó chỉ lấy `FactoryScene2D`. |
| 1 | `client/src/components/factory-scene/machineMesh.tsx` | 159 | `ad05dcf59cfb090d2e7feeb865dbc3a4` | **0 dòng** nào ngoài chính tệp và `FactoryScene3D` (cũng bị xoá). |
| 2 | `client/src/pages/TwinHub.tsx` | 140 | `ad19058d425c0e3949d4a5007839b310` | 13 dòng khớp: **12 chú thích**; grep `import`/`from` = **0** trong mã sản phẩm. Chỗ dùng thật duy nhất: 1 ca unit test (`twinHubTabBoTriXuong:80`). |
| 3 | `client/src/pages/DigitalTwinDashboard.tsx` | 606 | `107cdc9a0b3bf62156b67bdf29994a06` | 3 dòng khớp, **cả 3 là chú thích**; import = **0**. |
| 4 | `client/src/pages/CellTwinPlayer.tsx` | 770 | `8b43b87ce8ab5fafbba176dfd58314db` | 2 dòng khớp, cả 2 là chú thích trong `DigitalTwinCenter`; import = **0**. |
| 5 | `client/src/pages/FactoryLiveMap3D.tsx` | 240 | `69336172f4ee34a11661765bb7556c69` | import = **0** (sau khi `TwinHub` đã xoá). |
| 5 | `client/src/components/FactoryFloor3D.tsx` | 209 | `4ea1b271d9867679529e72135d0d927f` | 2 import — **cả hai nằm trong chính tập đang xoá** (`FactoryFloorEditor:27`, `FactoryLiveMap3D:30`); sau khi xoá món 6 thì = **0**. |
| 6 | `client/src/pages/FactoryFloorEditor.tsx` | 604 | `f4e4289817964e2b9a6086fefd8bda94` | 16 dòng khớp, **16/16 là chú thích**; import/`await import` = **0**. + đo DB (dưới). |

**Tổng 8 tệp = 3.244 dòng.**

### 2b. `FactoryFloorEditor` — đo DB dev bằng HAI MÔ HÌNH RỜI NHAU (BG-127)

DB `postgresql://avi_app@127.0.0.1:5434/aoi_management`, **chỉ đọc**.
Script: `.qa-dot61/_db-mohinh-A.mjs`, `_db-mohinh-B.mjs`; kết quả thô `01-db-A.json`, `01-db-B.json`.

| | mô hình A — **LỌC + ĐẾM** | mô hình B — **LIỆT KÊ TOÀN PHÂN BỐ + ĐỐI CHIẾU TỔNG** |
|---|---|---|
| `factory_zones` | `count(*)` = **0** | kéo TOÀN BỘ hàng về client: **0 hàng**; bảng **CÓ TỒN TẠI** trong `information_schema` |
| `safety_zones` | `count(*)` = **0** | **0 hàng**; bảng **CÓ TỒN TẠI** |
| `machines.layoutPositionX` | `where … is not null` = **0** | 43 null + **0 có giá trị** = 43 = **KHỚP TỔNG** |
| `machines.layoutPositionY` | **0** | 43 null + **0** = 43 **KHỚP TỔNG** |
| `machines.layout` | **0** | 43 null + **0** = 43 **KHỚP TỔNG** |
| đối chứng dương | — | cột `id` có giá trị **43/43** ⇒ **thước KHÔNG MÙ** |

Vì sao hai mô hình này **thật sự rời nhau**: A lọc rồi đếm — đúng cách hỏng của
BG-127 (một `WHERE` không bao giờ khớp ⇒ **0 câm**). B **không lọc gì**: nó đọc
tên cột thật từ `information_schema`, kéo toàn bộ hàng, nhóm đủ mọi nhánh rồi
**đối chiếu với TỔNG**; tên bảng/cột sai ⇒ **NỔ**, không ra 0. Cộng thêm một
**đối chứng dương** để chứng minh thước biết kêu.
⇒ **Khác 0 = KHÔNG** ⇒ không DỪNG. Xoá không mất hàng dữ liệu nào.

---

## 3. Những gì đã xoá

### 3a. 8 tệp (commit `c54485fc`) — **3.244 dòng**

```
client/src/pages/TwinHub.tsx                             140
client/src/pages/DigitalTwinDashboard.tsx                606
client/src/pages/CellTwinPlayer.tsx                      770
client/src/pages/FactoryLiveMap3D.tsx                    240
client/src/components/FactoryFloor3D.tsx                 209
client/src/pages/FactoryFloorEditor.tsx                  604
client/src/components/factory-scene/FactoryScene3D.tsx   516
client/src/components/factory-scene/machineMesh.tsx      159
```

Tất cả bằng `git rm` (còn nguyên trong lịch sử). Không `rm -rf`, không đụng `.qa-*`,
không `reset`/`checkout -f`/`stash`.

### 3b. Cảnh 3D của `/command-center` (commit `5b009b77`) — **281 dòng**

`CommandCenter.tsx` 1.596 → 1.315. Chi tiết ở mục 4.

### 3c. Sửa kèm (không phải xoá)

- `factory-scene/index.ts`: bỏ dòng 5 re-export `FactoryScene3D`; **giữ** `FactoryScene2D`,
  `sceneTypes`, `useOptionalTheme` (kit mới dùng lại).
- `twinHubTabBoTriXuong.unit.test.ts`: bỏ dòng `await import("./TwinHub")` + **cả khối §2**.
  **Giữ §1** — `LayoutContent` còn sống qua route `/layout/:id`. Tệp XANH 1/1.
- `scripts/i18n-missing-baseline.json`: thu hẹp 339 → **336** (xem mục 5).
- **9 lời khai đã hết hạn** được viết lại thay vì để trỏ vào tệp không còn:
  `App.tsx:347` ("`TwinHub` và cả bảy màn con VẪN CÒN TRÊN ĐĨA, §11b cấm xoá") ·
  `App.tsx:726` · `FactoryCommandView.tsx:52` · `DigitalTwinCenter.tsx:18/504` ·
  `VeVung.tsx:9` · `XuongThietKe.tsx:1051/1080` · `server/db/twinCanh.ts:1583` ·
  `server/routers/twinCanhRouter.ts:1332` (bốn chỗ sau đều khai
  "`FactoryFloorEditor.tsx:444` **vẫn là nơi DUY NHẤT** CRUD vùng an toàn / xoá hôm nay
  là **mất tính năng thật**" — đo DB hôm nay bác bỏ).

### 3d. ★ Đảo thứ tự món 5 ↔ 6 so với brief

`FactoryFloorEditor.tsx:27` `import { statusColor } from "@/components/FactoryFloor3D"`.
Xoá món 5 trước món 6 ⇒ `npm run check` **ĐỎ** ở giữa hai món, vi phạm chính điều
kiện brief đặt ra ("sau mỗi món `check` phải 0"). Làm **6 trước, 5 sau** ⇒ cả 5 lượt
`check` đều 0.

### 3e. Giữ nguyên đúng như brief yêu cầu

**6 `<Redirect>` còn đủ** (`App.tsx` dòng 367 `/digital-twin` · 524 `/factory-live-map` ·
578 `/factory-floor-editor` · 583 `/cell-twin` · 584 `/digital-twin-center` · 741 `/layout`).
**Không redirect nào trỏ tới trang vừa xoá** — đo lại bảng `dinhTuyenTwinCu`: 13 đích =
`/twin` ×7, `/twin-studio` ×4, `/rf-test-cell` ×1. Không phải đổi đích nào.
Cũng giữ: `DigitalTwinCenter` + `ArticulatedRobot` (Đợt 62) · `FactoryScene2D` ·
`RfTestCellSim` · `Layout` · `MachineCockpit` · `RobotCockpit` · `CorporateLayout`.

---

## 4. Nav + cảnh 3D của CommandCenter

### 4a. Mục nav `/digital-twin` — ★★★ **DỪNG, KHÔNG XOÁ**

Số dòng brief ghi (`navigation.tsx:439`) — **xác minh lại: ĐÚNG**.

Hai phép đo brief chỉ định đều **SẠCH**: `grep 'navHref="/digital-twin"'` = **0**;
không `RouteGuard`/`hasAccessToItem` nào tra href ấy.

**Nhưng danh sách phép đo của brief thiếu một đường tra thứ ba** — và nó có **3 chỗ
gọi sống** (đúng lớp lỗi G24 "lấy DANH SÁCH thay vì BẤT BIẾN"):

```
getRequiredPermissionForHref("/digital-twin")
  client/src/pages/DataManagementHub.tsx:24   LAYOUT_TILE_PERMISSION
  client/src/pages/DataSettings.tsx:796       layoutLinkPermission
  client/src/lib/navigation.unit.test.ts:88   lưới GHIM hợp đồng "một nguồn quyền-theo-route"
```

Chú thích `navigation.tsx:407-437` (Đợt 21 Lô Y) đã ghi sẵn: *"ĐO TRƯỚC KHI XOÁ,
và phép đo BÁC BỎ việc xoá"* — nêu đúng 2 chỗ gọi ấy.

**Ablation** (bỏ ô nav → chạy lưới → khôi phục):
`navigation.unit.test.ts` **27/27 → 26 xanh / 1 ĐỎ** (`:88` Expected `"analytics_oee"`,
Received `undefined`). Khôi phục xong: md5 `navigation.tsx` = `0b1888af14e75f21874b26a4dce5491e`
(khớp bản gốc), `git status` cho tệp ấy **rỗng** ⇒ 0 byte lệch.

Sắc thái cần chủ sở hữu biết (không phải lý do để tôi tự quyết): hai chỗ gọi sản phẩm
đều có `?? "analytics_oee"` và ô nav **đang khai đúng `analytics_oee`** ⇒ về **giá trị**,
bỏ ô nav **không đổi hành vi**. Cái đổi là **HỢP ĐỒNG**: "một nguồn quyền-theo-route"
thành "hằng chép tay ở 2 nơi", và lưới ghim hợp đồng ấy ĐỎ.

⚠ **Nợ CÓ TRƯỚC phát hiện thêm** (ngoài phạm vi đợt): cả hai chú thích nói đích của
`/layout` là `/digital-twin?tab=layout` (gate `analytics_oee`). Từ QĐ-18, `/layout`
`<Redirect to="/twin-studio">`, mà `/twin-studio` gate `settings_factory` **HOẶC**
`machine_control` — **không phải** `analytics_oee`. ⇒ điều kiện hiện quick-link đang
tra **sai quyền** ở cả hai nơi, từ trước Đợt 61.

Theo đúng luật brief ("ra > 0 ⇒ DỪNG món đó, ghi lại, báo tôi") ⇒ **DỪNG**.
Ghi đầy đủ ở `.qa-dot61/muc2-DUNG-XONG.txt`.

### 4b. Cảnh 3D của `/command-center` — ĐÃ BỎ

**Brief sai 3 chỗ ở mục này** (đo lại trước khi sửa):

1. Brief gọi đây là **"tab 3D"** và đòi "tab list giảm đúng 1".
   `CommandCenter` **không có `Tabs` nào**. 3D là một **bộ chuyển 2D/3D**
   (`viewMode`, lưu `localStorage["commandCenter:viewMode"]`) trong pane `CenterOverview`.
2. Brief: "nếu tab 3D là tab mặc định ⇒ đổi mặc định". **Không có tab mặc định.**
   Mặc định của bộ chuyển là `'3d'` khi bề rộng > 1366px, `'2d'` khi ≤ 1366px —
   nghĩa là đường 2D **đã là đường chạy thật** trên panel-PC, không phải nhánh dự
   phòng chưa ai chạy.
3. Brief: "bỏ bản sao `twin.sceneGraph` **chỉ phục vụ tab ấy**". **Đo lại: sai.**
   `sceneGraph` phục vụ **4 thứ của đường 2D**: (a) số thiết bị trên tiêu đề pane,
   (b) chấm tươi `PollFreshness`, (c) trạng thái đang tải của pane, (d) làm giàu PackML
   (`state`/`activeTaskId`) cho chip 2D khi mở `ContextDrawer`.
   ⇒ **GIỮ LẠI `twin.sceneGraph`**. Bỏ nó là bỏ 4 tính năng đang sống của lưới 2D.

Đã bỏ (**281 dòng**): khối cảnh 177 dòng (`FLOOR_W/FLOOR_D`, `GRID_SPACING`,
`gridPositions`, `TwinBlock`, `CompactTwinScene`) · `<Canvas>` + `<Suspense>` +
`ErrorBoundary` riêng của cảnh · import `@react-three/fiber` / `@react-three/drei` /
`three` · bộ chuyển 2D/3D + `viewMode` + khoá localStorage · thăm dò WebGL
`getContext("webgl")` + `canRender3D` + `webglOk` · `selectedDeviceId`/`selectedDevice`/
`openTwinDevice` · `stateSummary`/`sceneAriaLabel` · hàm `Legend` · import `stateHex`.

**Đo sau** (server 3061, vai `e2e_tai_loE`, 1600×900):

| | NỀN (518434af) | SAU (Đợt 61) |
|---|---|---|
| `/command-center` mở được | có | có |
| `<canvas>` trong DOM | **1** | **0** ★ |
| `window.__soCanvas` | `null` | `null` |
| chữ đọc được trên trang | 1.527 ký tự | **2.645** ký tự |
| 4 thủ tục `commandCenter.*` | 4 | **4** |
| link sống tới `/command-center` | 10 | **10/10** (8 tệp) |

★★★ **Vì sao phải đếm DOM chứ không chỉ `__soCanvas` như brief ghi (G99)**:
`<Canvas>` cũ của CommandCenter **không đăng ký** qua kit `twin3d`, nên `__soCanvas`
= `null` ở **CẢ HAI** bản. Nếu chỉ đọc `__soCanvas` thì phép đo **XANH cả trước lẫn
sau** ⇒ mù đúng thứ nó phải bắt. `DOM canvas 1 → 0` mới là bằng chứng.

---

## 5. Cổng ra đầy đủ

Bản đầy đủ + log thô: `.qa-dot61/04-cong-ra-XONG.txt` và các `HQ-*.log`.

| cổng | ngưỡng brief | ĐO ĐƯỢC | |
|---|---|---|---|
| `npm run check` | 0 | **0** (chạy sau MỖI món, 5 lượt) | ĐẠT |
| `npm run check:tests` | ≤ 27 | **27** (y hệt nền) · 0 trong `twin3d` · 0 trong `e2e/` | ĐẠT |
| `npm run i18n:check` | 0 | **exit 0** — 0 mismatch · 0 NEW missing · 0 stale | ĐẠT |
| `npm run lint:tokens` | Δ0 | exit 0 · **0 tệp TĂNG vi phạm**; 65→61 tệp, 1.111→1.019 (giảm vì 4 tệp đã xoá) | ĐẠT |
| `kiem-vo` | ĐẠT | ĐẠT cả `client/index.html` và `dist-61/public/index.html` (tài nguyên ngoài 0) | ĐẠT |
| `vitest twin3d` | ≥ 108 / 2.530 | **108 tệp / 2.530 ca XANH** | ĐẠT |
| 4 lưới phạm vi | "180/180" | **17 tệp / 437 ca XANH** — xem ghi chú | ĐẠT (số brief sai) |
| `vitest client` | liệt kê đỏ | 224 tệp / 4.238 ca · 3 tệp đỏ / 7 ca đỏ — **y hệt nền** | mục 6 |
| build outDir riêng | sạch, md5 lặp khớp | `.qa-dot61/dist-61` **914 tệp**; dựng lần 2 → **diff md5 = 0 dòng** | ĐẠT |
| `dist/` gốc | không chạm | md5 trước = sau | ĐẠT |
| 13 redirect trên 3061 | đúng đích | **13/13** | ĐẠT |
| 6 màn mở + canvas | như trước | 4 màn twin DOM 1/kit 1 (= nền) · `/factory-command` 0 (= nền) · `/command-center` 1→**0** | ĐẠT |
| e2e bấm cảnh | 16/16 `--workers=1` | **16/16 XANH** | ĐẠT |
| D-1 `do59.mjs` | 0 ô đổi | **N=48 · ĐẠT 42 · N/A 1 · CHẶN-ĐÚNG 5 · 0 ô không phán quyết**; diff với bảng Đợt 59: **0 ô đổi PHÁN QUYẾT** | ĐẠT |

### D-1 chi tiết (thước `do59.mjs`, fail-closed, 5 lô, cổng 3061)

`N=48 · {"ĐẠT":42,"N/A":1,"CHẶN-ĐÚNG":5}` · **Ô KHÔNG có phán quyết: 0**.

`diff .qa-dot59/D1-bang-59-head.md .qa-dot61/D1-bang-61.md` ⇒ **đúng 2 ô khác, 0 ô
đổi phán quyết** — và cả hai là **giá trị theo thời gian**, không phải kết luận:

| ô | Đợt 59 | Đợt 61 | vì sao đổi |
|---|---|---|---|
| #24 deep-link `/twin/may/14` | canvas **1357 ms** | canvas **1087 ms** | số đo thời gian nạp, mỗi lượt một khác; phán quyết **ĐẠT** ở cả hai |
| #30 API máy 14 `ageMinutes` | offline **83.998′** | offline **84.394′** | đồng hồ chạy tiếp ~396′ ≈ 6,6 h giữa hai lượt đo; phán quyết **ĐẠT** ở cả hai |

46 ô còn lại **giống từng ký tự**, kể cả 5 ô CHẶN-ĐÚNG (hai chiều quyền) và ô #31
(`/factory-command` 1 canvas, nhãn trùng canvas) — ô này là **đối chứng quan trọng
của đợt**: nó dùng kit `LopNhan` NGOÀI twin và vẫn nguyên vẹn sau khi xoá
`FactoryScene3D`.

Hàng TẠM (user 0 quyền · andon raised máy 14) tạo rồi **dọn sạch** qua `trap EXIT`
(G111): `andon 7→8→7`, `raised 0→1→0`, `users 10→11→10`, `userTam 0` — đối chiếu
đếm DB trước/sau khớp tuyệt đối.

**Ghi chú "180/180"**: không phép đo nào hôm nay ra con số ấy. `vitest phamVi` cho
**17 tệp / 437 ca**, đúng bằng số Đợt 58 và Đợt 59 đã ghi. "180/180" là di sản
từ một đợt cũ hơn, brief chép lại mà không đo.

**⚠ Một hỏng THIẾT BỊ ĐO phải nói ra**: lượt chạy e2e bấm cảnh ĐẦU TIÊN ra **0/16**,
toàn bộ ĐỎ tại `expect(login).toBe(200)` nhận **429**. Limiter đăng nhập dùng
**Redis** (`REDIS_URL` có trong `.env`) ⇒ thùng đếm **DÙNG CHUNG** với 3001/3008 của
chủ sở hữu; 52 lượt đăng nhập của lượt chạy toàn project trước đó đã làm đầy cửa sổ
15 phút (max 30). Vá bằng cách khởi động lại **riêng server 3061** với
`RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000` — chỉ tác động tiến trình của
tôi, **không sửa `.env`**, **không đụng 3001/3008**. Sau đó 16/16 XANH.

---

## 6. Test đỏ / biến mất

Chi tiết: `.qa-dot61/06-test-do-XONG.txt`.

### 6a. Biến mất — **đúng 1 ca, cố ý**

`client/src/pages/twinHubTabBoTriXuong.unit.test.ts` **2 ca → 1 ca**.
Ca bỏ: *"§2 TwinHub TABS — mục 'layout'"* (đọc `TABS` của `TwinHub.tsx`, tệp đã xoá).
**§1 giữ** — `LayoutContent` còn sống qua route `/layout/:id`, và cái bẫy nó khoá
(`useParams()` trả `{}` ngoài route có `:id`) vẫn còn nguyên. Tệp XANH 1/1.
Cái §2 bảo vệ (`/layout` không `:id` phải tới được màn soạn bố trí) nay do
`<Route path="/layout"><Redirect to="/twin-studio" /></Route>` và lưới
`dinhTuyenTwinCu` giữ — **đo sống 13/13 trên 3061**.

### 6b. Đỏ — **3 tệp / 7 ca, CÓ TRƯỚC Đợt 61**

`clientErrorCoverage.unit.test.ts` (2) · `rawErrorMessageCensus.unit.test.ts` (3) ·
`viStringCoverage.unit.test.ts` (2).

**Đối chứng**: dựng **cây nền** tại HEAD `518434af` bằng `git archive` (đúng khuôn
"census đo trên cây MỘT COMMIT, không trên worktree chung"), nối `node_modules` bằng
junction, chạy đúng 3 tệp ấy:

| phép đếm | NỀN `518434af` | SAU Đợt 61 |
|---|---:|---:|
| tệp đỏ / ca đỏ | 3 / **7** | 3 / **7** |
| hình-3 (F12) | 34 | 34 |
| phủ mã lỗi client | 1 (`pages/AOIPackages.tsx`) | 1 |
| chuỗi thô (F1) | 4 (`twin3d/occtWorker.ts`, `thiet-ke/NhapBanVe.tsx`, …) | 4 |
| cầu chì F1 "bơm nợ" | 5 ≠ 1 | 5 ≠ 1 |

Bằng chứng độc lập thứ hai: `git diff 518434af --stat` trên 3 tệp **nguồn** vi phạm +
3 tệp **test** = **rỗng** ⇒ cả 6 tệp y nguyên như HEAD. Census cộng số ≥ 0 theo từng
tệp ⇒ xoá tệp chỉ có thể **làm giảm** tổng, không thể đẻ ra vi phạm mới.
⇒ **Đợt 61 làm lệch 0 ca.**

### 6c. Suite khác (sau đợt)

`vitest twin3d` 108/2.530 XANH · `vitest phamVi` 17/437 XANH ·
`vitest client/src/pages` 12/140 XANH · e2e bấm cảnh 16/16 XANH.

---

## 7. Brief SAI ở đâu (đếm) + lỗi của chính tôi

### 7a. Brief sai — **6 chỗ**

| # | brief nói | đo được |
|---|---|---|
| 1 | Mục 2: chỉ cần kiểm `navHref=` và `RouteGuard`/`hasAccessToItem` là đủ để xoá ô nav `/digital-twin` | **Thiếu một đường tra thứ ba.** `getRequiredPermissionForHref("/digital-twin")` có **3 chỗ gọi sống** (2 trang + 1 lưới ghim hợp đồng). ⇒ DỪNG món |
| 2 | Mục 3: gọi 3D của `CommandCenter` là **"tab"**, đòi "tab list giảm đúng 1" | `CommandCenter` **không có `Tabs` nào**; đó là bộ chuyển 2D/3D lưu localStorage |
| 3 | Mục 3: "nếu tab 3D là **tab mặc định** ⇒ đổi mặc định" | Không có tab mặc định; mặc định bộ chuyển theo **bề rộng màn** (≤1366px đã là 2D) |
| 4 | Mục 3: "bản sao `twin.sceneGraph` **chỉ phục vụ tab ấy**" | Nó phục vụ **4 thứ của đường 2D** ⇒ giữ lại, không bỏ |
| 5 | Mục 4: `__soCanvas` trên `/command-center` = 0 là phép đo đủ | `__soCanvas` = **null ở CẢ nền lẫn sau** (G99) ⇒ phép đo **MÙ**; phải đếm `<canvas>` trong DOM (1 → 0) |
| 6 | Mục 4: "4 lưới phạm vi **180/180**" | `vitest phamVi` = **17 tệp / 437 ca** (đúng như Đợt 58/59 đã ghi). Con số 180 không khớp phép đo nào |

Thứ tự món 5/6 trong brief cũng **không chạy được như viết** (mục 3d) — tôi tính đây
là hệ quả của việc brief kế thừa thứ tự từ báo cáo Đợt 60 chứ không phải một câu sai
riêng, nên không đếm thành chỗ thứ 7.

**Brief ĐÚNG ở**: 6 món đều thật sự chết · số dòng ước lượng sát (675 / 140 / 606 /
770 / 449 / 604 — khớp tuyệt đối) · `navigation.tsx:439` đúng dòng ·
`CommandCenter.tsx:863` đúng dòng `<Canvas>` · phải giữ 6 `<Redirect>` · phải đo DB
bằng hai cách rời nhau trước khi xoá `FactoryFloorEditor` · cảnh báo G83.

### 7b. Lỗi của chính tôi

1. **Chạy `--project=chromium-canh-3d` TOÀN BỘ trước khi chạy spec cần đo.** 52 lượt
   đăng nhập làm đầy thùng rate-limit Redis **dùng chung với server của chủ sở hữu**,
   khiến lượt đo thật ra 0/16 và tốn ~12 phút. Đáng lẽ chạy đúng spec của cổng trước,
   và đáng lẽ đọc `REDIS_URL` trong `.env` để biết thùng là **dùng chung** chứ không
   phải riêng tiến trình.
2. **Xoá món 3 và món 4 rồi mới chạy `check`**, thay vì sau từng món như brief yêu cầu.
   Không gây hậu quả (cả hai đều là tệp mồ côi, `check` = 0) nhưng nếu một trong hai
   hỏng thì tôi đã mất khả năng quy trách nhiệm cho đúng món.
3. **Suýt tin "đọc từ cơ chế" thay vì đo** ở mục 4a: tôi đã lập luận xong rằng bỏ ô
   nav là vô hại (fallback bằng đúng giá trị hiện tại) trước khi chạy ablation. Ablation
   mới cho con số 26/27 và cho thấy cái mất là **hợp đồng**, không phải giá trị.
4. **Lượt patch đầu bằng heredoc bị bash nuốt** (lỗi cú pháp), phải viết script ra tệp.
   Mất một lượt, không hỏng gì vì bash lỗi cú pháp thì **không chạy gì cả**.

---

## 8. Món DỪNG không xoá + còn mở cho Đợt 62

### 8a. Món DỪNG — **1 món**

| món | vì sao DỪNG |
|---|---|
| **Mục nav `/digital-twin`** (`navigation.tsx:439-446`) | Đo ra **3 chỗ tra sống** qua `getRequiredPermissionForHref` (2 trang sản phẩm + 1 lưới ghim). Luật brief: "> 0 ⇒ DỪNG". Ablation: 1 lưới ĐỎ. Cần chủ sở hữu quyết: (a) giữ nguyên, hoặc (b) xoá ô nav **kèm** sửa 2 chỗ gọi khai quyền thẳng + sửa lưới — nhưng khi đó phải sửa **đúng quyền của đích thật** (`/twin-studio` = `settings_factory` HOẶC `machine_control`), không phải chép `analytics_oee` |

Không món nào trong 6 món XOÁ phải DỪNG: cả 6 đều đo ra 0 chỗ gọi sống.

### 8b. Còn mở cho Đợt 62

1. **Di trú rồi xoá `DigitalTwinCenter.tsx` (936) + `ArticulatedRobot.tsx` (196)** —
   0 route, 0 import sống **từ sau Đợt 61** (người gọi duy nhất là `TwinHub`, đã xoá).
   Thứ nó còn giữ riêng: `twin.replay` (:534) · `twin.status` (:397) · robot khớp nối.
   Lý do hoãn cũ ("giữ `usdExport` duy nhất") **đã sai** — `usdExport` có 2 chỗ gọi sống.
2. **~214 khoá i18n mồ côi × 3 ngôn ngữ** trong `vi/en/zh.json` — Đợt 61 **không đụng
   một khoá locale nào**. Nhóm: `celltwin.*` · `digitalTwin.*` · `ffe.*` · `flm.*` ·
   `twin.*` · `twinHub.*`. ⚠ Sau Đợt 61 còn mồ côi thêm ~10 khoá của cảnh 3D
   CommandCenter (`commandCenter.sceneAria/tomTatTwin/dangChay/cho/tamDungGiu/loiEStop/
   ngoaiTuyen/lenhSo/cheDoHienThiSo`, `cmd.gridNoWebgl`).
   ⚠ **Âm tính giả đã biết**: `nav.digitalTwin` chỉ thật sự mồ côi **nếu** ô nav
   `/digital-twin` cũng bị xoá — mà mục 4a vừa DỪNG việc ấy.
3. **Nợ quyền của quick-link `/layout`** (mục 4a): `DataManagementHub.tsx:24` +
   `DataSettings.tsx:796` đang tra `analytics_oee` trong khi đích thật `/twin-studio`
   đòi `settings_factory`/`machine_control`. Nợ CÓ TRƯỚC, chưa ai đo.
4. **`factory.uploadFloorPlan` + `factory.updateFloorDims`**: sau khi xoá
   `FactoryFloorEditor`, hai thủ tục này **còn trên server nhưng 0 UI**. Dữ liệu không
   mất. `TwinStudio`/`NhapBanVe` đi qua `twinCanh.*`, không gọi hai thủ tục này.
5. **`/factory-command` (`FactoryCommandView`, 823 dòng)** — QĐ-31 giữ nguyên. Còn
   trùng phạm vi với `/twin`; sổ ghi `factoryCommand.overview` **0 scope tenant** (G113).
6. **7 ca đỏ có trước** ở 3 tệp census client (mục 6b) — chưa ai nhận.
7. **`check:tests` 27 lỗi có trước** ở 8 tệp `server/services/aiLocal*` v.v.

---

## 9. Cổng đóng phiên

| việc | trạng thái |
|---|---|
| server 3061 | **ĐÃ TẮT** (xem `.qa-dot61/99-dong-cong-XONG.txt`) |
| 3001 (PID 14228) / 3008 (PID 29676) | **KHÔNG bị đụng** — kiểm `netstat` sau cùng |
| `dist/` gốc | md5 trước = sau |
| hàng TẠM trong DB (user 0 quyền, andon raised) | đã dọn — `trap EXIT` của `do-D1-61.sh` |
| `.qa-dot47/` 103 tệp 0 byte | không đụng |
| `.qa-dot61/base-tree` (junction `node_modules`) | junction đã gỡ |
