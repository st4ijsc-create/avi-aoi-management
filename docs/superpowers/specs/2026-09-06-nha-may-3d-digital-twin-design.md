# Thiết kế: Nhà máy 3D Digital Twin — trung tâm hệ sinh thái AVI/AOI

- **Ngày:** 2026-09-06
- **Trạng thái:** CHỜ DUYỆT — chưa được phép viết mã
- **Nhánh hiện tại:** `feat/hmi-dep`
- **Nhánh đề xuất thực thi:** `feat/twin-3d-trung-tam`
- **Người duyệt:** chủ sở hữu hệ thống

---

## 0. Tóm tắt điều hành

Xây một Digital Twin 3D làm **trung tâm điều hướng và xử lý** cho hệ AVI/AOI, gồm hai màn bổ trợ:

| Màn | Route | Vai trò | Ai dùng |
|---|---|---|---|
| **Xưởng dựng Twin** | `/twin-studio` (mới) | Thiết kế & bố trí mặt bằng 3D: kéo thả, căn chỉnh, vùng an toàn, ảnh nền, thư viện model | Kỹ sư layout, admin |
| **Twin vận hành** | `/twin` (mới) | Xem & xử lý: 3D toàn khung, trạng thái realtime, click máy → ack alarm / tạo phiếu / mở chức năng | Quản lý, kỹ thuật, vận hành |

Đây **không phải dự án từ số 0**, cũng **không phải nâng cấp tại chỗ**. Repo đã có 11 màn liên quan 3D/layout với **62 tính năng độc nhất đang chạy**, 5.269 dòng service twin ở backend, và một package cảnh 3D (`factory-scene`, 1.393 dòng) đã đạt chuẩn kỹ thuật tốt. Chiến lược: **xây Twin mới đầy đủ, di trú dần 62 tính năng, xoá màn cũ sau khi từng dòng sổ kiểm được đánh dấu *đã di trú và đã đo*.**

### Quyết định nền đã chốt với chủ sở hữu

| # | Quyết định |
|---|---|
| QĐ-1 | Xây Twin mới đầy đủ, di trú dần 62 tính năng, cuối cùng xoá màn cũ |
| QĐ-2 | 3D điều hướng + panel 2D xử lý (ack alarm, tạo phiếu ở bề mặt 2D tuân ISA-101) |
| QĐ-3 | Bộ 9 công cụ căn chỉnh + snap vật-vào-vật + array (mức Visual Components) |
| QĐ-4 | Hệ toạ độ **mm tuyệt đối** mới, di trú 2 hệ cũ vào, giữ cột cũ để màn cũ không gãy |
| QĐ-5 | Dựng đủ cấu trúc campus (Site→Toà→Tầng→Xưởng→Chuyền→Trạm→Máy), nhưng **chờ người nhập** toà nhà/tầng thật; sinh tự động chỉ tạo 1 toà 1 tầng mặc định |
| QĐ-6 | Hình học: sinh thủ tục từ DB + GLB cho máy gần camera + **import CAD/STEP** qua `occt-import-js` |
| QĐ-7 | Kích thước máy: mặc định theo **loại máy** + badge "chưa đo" + sửa được trong Inspector |
| QĐ-8 | ~~Hai editor cũ chạy **song song** trong giai đoạn di trú~~ → **THAY BỞI QĐ-15** |
| **QĐ-15** | **(2026-09-06, chủ sở hữu quyết)** Xoá **toàn bộ** dữ liệu twin **và cả hai hệ toạ độ cũ**, seed lại bằng script thiết kế đúng. Dứt điểm hai nguồn sự thật song song ngay, không chờ Đợt 4 |
| QĐ-9 | Thứ tự theo **giá trị**: Thiết kế 3D → Vận hành → Cockpit → Mô phỏng |
| QĐ-10 | Màn Thiết kế v1 **đủ thay cả hai editor cũ**: máy + vùng polygon + ảnh nền + tỉ lệ mét + thêm/xoá máy |
| QĐ-11 | Spec markdown + mockup HTML tương tác để duyệt |
| QĐ-12 | Dựng nhà xưởng **hai con đường**: nhập bản vẽ CAD/STEP/GLB (sửa được sau khi nhập) **hoặc** điền dài×rộng×cao từng mặt sàn (§10A) |
| QĐ-13 | Hình học thiết bị: **7 khối mặc định** phủ 24 loại máy, thay được bằng file 3D ở 3 cấp — máy / chủng loại / mặc định (§10B) |
| QĐ-14 | **Line là phạm vi, không phải vật thể** — hình học suy ra từ trạm/máy; có chế độ xem 3D riêng cho từng Line và cho toàn tập đoàn (§10C) |

---

## 1. Hiện trạng đo được (2026-09-06)

Mọi số dưới đây **đo trực tiếp** trên repo và DB `aoi_management@127.0.0.1:5434`, không lấy từ tài liệu.

### 1.1 ⚠️ Bản thiết kế đính kèm là của HỆ KHÁC

Tài liệu `2026-09-04-nha-may-3d-twin-design.md` mà chủ sở hữu cung cấp **chưa từng tồn tại trong repo này** — kiểm trên 123 nhánh, toàn bộ lịch sử git (`git log --all --diff-filter=A`). Các tệp nó đặt tên (`TwinBuilder.tsx`, `sinhBoCuc.ts`, `twinSceneRouter.ts`) cũng chưa từng có commit nào. **0/7 pha của nó đã thực thi**, vì nó thuộc một hệ thống khác.

Ba giả định nền của nó **sai với repo ta** — chép theo sẽ hỏng ngay pha 0:

| Giả định của tài liệu đính kèm | Đo được ở repo ta | Hệ quả nếu chép |
|---|---|---|
| Cấm `@react-three/drei` (lỗi Vite) | drei `^10.7.7` **đang dùng ở 7 tệp**, chạy tốt | Tự trói tay, viết lại vô ích |
| Migration kế tiếp là `0043` | Cao nhất **`0349`** (348 tệp `.sql`) | Trùng số, migration không chạy |
| `machine_positions` có mm + quaternion | **int pixel**; `positionZ`=0 và `rotation`=0 ở **36/36 hàng** | Đọc ra toàn số 0, cảnh 3D dẹt |
| 74 máy / 35 xưởng / 201 trạm | **43 máy / 1 xưởng thật / 37 trạm** | Ngân sách hiệu năng sai 5× |

**Giữ lại từ nó:** cấu trúc chương mục, ý tưởng tách Builder/Viewer, cờ `nguồn = sinh|tay`, kỷ luật "không vẽ máy mất tín hiệu bằng màu xanh". Đó là những phần đúng bất kể hệ nào.

### 1.2 Quy mô thật (đo trên DB dev)

> **★ ĐÍNH CHÍNH 2026-09-06 (session seed) — con số dưới đây là TOÀN HỆ, không phải SIM-FAC.**
> Đo lại theo nhà máy: **SIM-FAC có 36 trạm / 42 máy** (3 Line × 12 trạm = 36, khớp đúng);
> `T12-SHOT-FA` có 1 trạm / 1 máy. Cộng lại mới ra 37/43. Brief giao Đợt 4 dùng "37 trạm, 43 máy
> cho SIM-FAC" là **lẫn phạm vi** — agent seed phát hiện khi thực thi.
> ⇒ Mọi con số phải kèm **phạm vi** cùng với đơn vị (G9).

```
corporates 1 · factories 4 (2 isActive) · workshops 2 · production_lines 4
stations 37 · machines 43 (42 isActive)      ← TOÀN HỆ; SIM-FAC riêng = 36 trạm / 42 máy
factory_layouts 3 · machine_positions 36 · workshop_positions 0 · factory_positions 0
factory_zones 0 · equipment_3d_models 5
```

Phân bố máy theo nhà máy:

| Nhà máy | isActive | Xưởng | Số máy |
|---|---|---|---|
| `SIM-FAC` | ✅ | Xưởng lắp ráp ảo (SIM) | **42** |
| `T12-SHOT-FA-…` | ✅ | Task 12 anh chup - ws | 1 |
| `AUDIT_FAC_01` | ❌ | — | 0 |
| `AUDIT2_65562` | ❌ | — | 0 |

**Kết luận:** chỉ có **một xưởng thật** với dữ liệu. Hai nhà máy còn lại là rác kiểm thử. Quy mô 43 máy là **rất nhỏ** với WebGL — hiệu năng không phải rào cản; **chất lượng dữ liệu bố cục mới là rào cản**.

### 1.3 Chất lượng dữ liệu bố cục — lỗ hổng thật

| Vấn đề | Số đo | Hệ quả |
|---|---|---|
| **Không có bảng `buildings`/`floors`** | 0 bảng | Campus nhiều toà nhà không dựng được — chặn cứng |
| **Không máy nào có độ cao** | `positionZ = 0` ở **36/36** hàng | Cảnh 3D dẹt hoàn toàn |
| **Không máy nào có hướng xoay** | `rotation = 0` ở **36/36** hàng | Mọi máy cùng một hướng |
| **Không model nào có kích thước** | `bounds IS NULL` ở **5/5** `equipment_3d_models` | Không biết vẽ máy to bao nhiêu |
| **HAI hệ toạ độ song song** | 36 hàng `machine_positions` (int pixel 60..1255) **và** 38 máy có `layoutPositionX/Y` (0–1) + `layout` jsonb | Hai nguồn sự thật không đồng bộ |
| **Không có vùng nào** | `factory_zones` = 0 dòng | Chưa ai vẽ vùng an toàn |
| **`three` chưa tách chunk** | `vite.config.ts` không có `manualChunks` lẫn `resolve.dedupe` | Nguy cơ 2 bản three cùng tồn tại (lỗi câm phổ biến nhất của R3F) |
| **`three-mesh-bvh` chưa cài** | 0 kết quả toàn cây | Snap vật-vào-vật cần thêm gói này |

### 1.4 Nền móng đã có — dùng lại được ngay

**Frontend — package `factory-scene` (1.393 dòng) là nền kit tốt nhất:**

| Tệp | Dòng | Vai trò |
|---|---|---|
| `client/src/components/factory-scene/FactoryScene3D.tsx` | 516 | Cảnh 3D: `frameloop="demand"`, InstancedMesh 1 draw-call/nhóm, LOD nhãn cap 60, `AdaptiveDpr`, `ContactShadows frames={1}` |
| `client/src/components/factory-scene/FactoryScene2D.tsx` | 361 | **Bản 2D cùng chữ ký props** — fallback WebGL có sẵn |
| `client/src/components/factory-scene/sceneTypes.ts` | 295 | `MachineNode`, `FactorySceneProps`, `OverlayMode`, `resolveLayout`, `shapeKeyFor`, `scenePalette`, `overlayColorHex` — **module thuần, test được** |
| `client/src/components/factory-scene/machineMesh.tsx` | 159 | Geometry cache theo shape |
| `client/src/components/factory-scene/useOptionalTheme.ts` | 41 | Theme-aware |

**Backend twin (5.269 dòng service) — rất dày, nhưng chỉ đọc:**

| Tệp | Vai trò |
|---|---|
| `server/services/twin/sceneGraph.ts` | Scene graph phân cấp factory→zone/line→station→device, resolve `modelUri` |
| `server/services/twin/twinSchema.ts` | Mô hình DTDL v3 |
| `server/services/twin/usdExport.ts` | Xuất USDA cho Omniverse (643 dòng) |
| `server/services/twin/occupancyGrid.ts` + `dstarLite.ts` | Lưới chiếm dụng + A* + D* Lite |
| `server/services/twin/twinReplay.ts` | Replay time-series TimescaleDB |
| `server/services/twin/twinStream.ts` | WS gateway đẩy delta thiết bị |
| `server/services/twin/modelRegistry.ts` | register/list/resolve model glTF/URDF |

Router: `twinRouter` (15 thủ tục), `digitalTwinRouter` (6), `twinGovRouter` (4), `layoutRouters` (8), `assetCockpitRouter` (3).

**Điểm mấu chốt: không có API ghi cảnh 3D.** Toàn bộ là read-only. Đây là phần backend phải xây mới.

**Gói đã có sẵn, chưa dùng cho layout:** `occt-import-js@0.0.23` (đọc STEP/IGES), `@dimforge/rapier3d-compat`, `@dnd-kit/*`, `react-resizable-panels@3.0.6`.

### 1.5 Realtime — cờ ĐANG BẬT trong môi trường thật

| Hạng mục | Trạng thái đo được |
|---|---|
| `TWIN_STREAM_ENABLED` | **`=true`** tại `.env:756` (chú thích "A2 doc37"); `.env.example:1668` = `false` |
| Từ khi nào | 7 bản `.env.bak-*` từ **2026-08-16** đều có `=true` |
| `startTwinBroadcaster` | `server/_core/socket.ts:1412`, interval **2000 ms**, sàn `Math.max(500, …)` |
| Sự kiện | `twin:update` → room `global` + `line:{lineId}` |
| `twin:status` | **KHÔNG TỒN TẠI** — 0 kết quả grep |
| `TWIN_LIVE_ENABLED` | Cờ thứ hai, gate tầng service |

**Nghĩa là:** broadcaster WIP 2 giây **đang chạy thật**. Thiết kế realtime nối vào cái đang chạy, không phải bật từ đầu.

### 1.6 Kiểm thử — lỗ hổng lớn nhất

- **0 test** cho mọi component 3D (`client/src/components/twin/` có 1 tệp, 0 test).
- **0 e2e** liên quan twin/3D/layout (thư mục `e2e/` có 5 tệp, không tệp nào chạm 3D).
- 2 unit test duy nhất (`twinHubTabBoTriXuong.unit.test.ts`) chỉ kiểm tab layout không crash.
- Backend twin **có test dày** (`twin.t1.test.ts`, `twinSchema.t3.test.ts`, `usdExport.t3b.test.ts`, `dstarLite.unit.test.ts`…).

### 1.7 Bản đồ 11 màn hiện có

`TwinHub` (`/digital-twin`) **đã gộp sẵn 7 tab** và có redirect từ 6 route cũ. Ngoài hub còn: `/command-center`, `/machine/:id`, `/robot/:id`, `/factory-command`, `/corporate-layout`, `/layout/:id`.

| # | Màn | Dòng | 3D? | Vai trò |
|---|---|---|---|---|
| 1 | `TwinHub.tsx` | 140 | — | Vỏ 7 tab + badge LIVE/SIM/SƠ ĐỒ |
| 2 | `DigitalTwinCenter.tsx` | 936 | ✅ | Scene-graph 3D + replay + export USD + robot FK |
| 3 | `CommandCenter.tsx` | 1596 | ✅ | 3 pane: cây ISA-95 + twin + dải cảnh báo |
| 4 | `MachineCockpit.tsx` | 1223 | ✅ | 12 tab chuyên sâu một máy |
| 5 | `RobotCockpit.tsx` | 889 | ✅ | 11 tab chuyên sâu một robot |
| 6 | `DigitalTwinDashboard.tsx` | 606 | ❌ | 6 tab bảng/heatmap/what-if |
| 7 | `CellTwinPlayer.tsx` | 770 | ❌ (SVG) | Phát lại workflow mô phỏng |
| 8 | `FactoryFloorEditor.tsx` | 604 | ❌ (SVG) | **Editor hệ 0–1 + CRUD vùng + ảnh nền** |
| 9 | `WorkshopLayoutEditor.tsx` | 716 | ❌ (DOM) | **Editor hệ pixel + thêm/xoá máy** |
| 10 | `FactoryLiveMap3D.tsx` | 240 | ✅ | Bản đồ 3D + UNS stream |
| 11 | `Layout.tsx` | 1026 | ❌ | CRUD layout theo tên + minimap + export PNG |
| — | `RfTestCellSim.tsx` | 792 | ❌ | **0 lệnh tRPC** — giáo cụ trình diễn tĩnh |

**Ba engine cảnh 3D trùng lặp:**

| Engine | Dòng | demand | Instancing | LOD | HDR CDN | Dùng ở |
|---|---|---|---|---|---|---|
| `factory-scene/FactoryScene3D` | 516 | ✅ | ✅ | ✅ | ❌ (an toàn) | `/factory-command` |
| `FactoryFloor3D` | 209 | ❌ | ❌ | ❌ | ⚠️ `preset="night"` | `/digital-twin?tab=map` |
| `Factory3DScene` | 255 | ❌ | ❌ | ❌ | ⚠️ `preset="night"` | `/corporate-layout` |

⚠️ **`Factory3DScene.tsx:219-226` rò rỉ GPU**: cấp phát `new THREE.Line(new BufferGeometry(), new LineBasicMaterial())` **mỗi lần render**, không `dispose()`. Bug thật, đáng vá bất kể thiết kế này có được duyệt hay không.

⚠️ **`/layout/:id` là route mồ côi** — còn sống (`App.tsx:587`), có guard `settings_factory`, nhưng **không màn nào navigate tới**. Đúng lớp lỗi "một lối vào rồi từ chối" đã gặp ở Khối D.

---

## 2. Ràng buộc cứng — vi phạm là vỡ màn

Mọi agent thực thi phải đọc mục này trước khi viết dòng đầu tiên. Ba mục đầu đã **kiểm chứng trực tiếp trên `node_modules` của repo này**, không phải trích tài liệu.

### RB-1 ★★★ `TransformControls` KHÔNG còn là `Object3D`

Kiểm chứng: `node_modules/three/examples/jsm/controls/TransformControls.js:77` → `class TransformControls extends Controls`, và `getHelper()` tại dòng 397.

```js
scene.add(transformControls);              // ❌ THROW: "object not an instance of THREE.Object3D"
scene.add(transformControls.getHelper());  // ✅ ĐÚNG
```

Đây là breaking change từ three r169; repo ở r182 nên **đang dính**. Viết sai thì gizmo không hiện và không có lỗi rõ ràng.

### RB-2 ★★★ Snap xoay của three là TƯƠNG ĐỐI, phải vá thành tuyệt đối

`setTranslationSnap()` snap theo lưới thế giới (tuyệt đối), nhưng `setRotationSnap()` snap **tương đối với góc hiện tại**. Máy đang ở 8° với snap 15° sẽ đi 8°→23°→38°, **không bao giờ chạm 15°**. Nghĩa là "xoay máy này về đúng hướng chuyền" là bất khả thi nếu không vá.

Cách vá (~10 dòng, trong `hinhHocCanChinh.ts`): bắt sự kiện `objectChange`, làm tròn tuyệt đối `Math.round(góc / bước) * bước`.

### RB-3 `frameloop="demand"` phải nối tay `invalidate`

Controls của drei tự gọi `invalidate()`; controls thuần **không**. Thiếu dòng này thì **màn hình đứng hình khi xoay camera**:

```js
controls.addEventListener('change', invalidate);
useFrame(() => animationDangChay && invalidate());
```

### RB-4 Chỉ MỘT `<Canvas>` sống tại một thời điểm

`TwinHub.tsx:8-9` ghi rõ nó cố ý dựa vào Radix Tabs unmount để giữ 1 WebGL context. Twin mới dùng panel/drawer thay tab, nên **phải tự đảm bảo bất biến này**. Nhiều canvas cùng lúc = cạn WebGL context, canvas đen.

### RB-5 Không tải HDR/asset từ CDN

`CommandCenter.tsx:605-607` đã phải **tự tay gỡ `<Environment preset="night">`** vì mạng nhà máy air-gap chặn CDN → khung đen. Đây là lỗi đã xảy ra thật. Dùng `HemisphereLight` + `DirectionalLight` tự cân như `FactoryScene3D` đang làm.

### RB-6 KHÔNG dùng WebGPU

`three@0.182` đã có entry `./webgpu`, nhưng [three.js#30560](https://github.com/mrdoob/three.js/issues/30560) còn mở: WebGPU **chậm hơn WebGL ~4×** với nhiều mesh không-instanced, và đo trên Intel Iris Xe cho kết quả tương tự. Đó **chính xác** là hồ sơ tải của ta (43 máy khác hình dạng + iGPU văn phòng). Ở lại `WebGLRenderer`; đặt lịch đo lại khi #30560 đóng.

### RB-7 `dispose()` triệt để

three.js **không** tự thu hồi bộ nhớ GPU. Mọi geometry/material/texture/render target phải `dispose()` trong cleanup. Cả 3 engine hiện tại đều thiếu — kit mới phải có, vì hub mount/unmount tab liên tục.

### RB-8 Quy ước sẵn có của repo phải giữ

1. **Module tính toán tách ra `.ts` thuần** (tên tiếng Việt không dấu, camelCase). Vitest chạy `environment: "node"`, chỉ include `client/src/**/*.test.ts` → **`.tsx` không test được**.
2. **Route mới phải `React.lazy` trong `App.tsx` VÀ có mục trong `navigation.tsx`** — bánh cóc `client/src/lib/duongVaoMenu.test.ts` sẽ đỏ nếu thiếu.
3. **Mọi chuỗi qua `t()`**, thêm khoá vào cả 3 tệp `vi.json` / `en.json` / `zh.json`.
4. `data-testid` tiếng Việt không dấu, kebab-case (`khoi-canh-3d`, `cay-phan-cap-twin`).
5. Migration áp bằng `npm run db:push` (`scripts/migrate-standalone.mjs`), **không** `drizzle-kit push`.
6. Cột thời gian dùng `timestamptz` + `DEFAULT now()` (quy ước migration `0038`).

---

## 3. Bốn nguyên tắc bất biến

Mọi quyết định thiết kế đều dẫn xuất từ đây.

### NT-1 — Twin là *mục lục không gian*, không phải mô phỏng

Việc của 3D là trả lời "*cái nào* trong 43 máy giống hệt nhau" và "*nó ở đâu*", rồi **bàn giao ngay** cho bề mặt 2D. Mọi tính năng 3D không trả lời được một câu hỏi vận hành cụ thể thì **cắt**.

Đây là thuốc chống cạm bẫy số 1 của ngành. Phân loại Kritzinger (2018, IFAC 51(11):1016–1022, ~2.337 trích dẫn) chia theo **mức tích hợp dữ liệu, không theo độ đẹp đồ hoạ**: *Digital Model* (thủ công hai chiều) → *Digital Shadow* (tự động một chiều) → *Digital Twin* (tự động hai chiều, đối tượng số là thực thể điều khiển). "Đồ trang trí đắt tiền" chính là: xây một Digital Model, render ở chất lượng Twin, bán giá Twin.

### NT-2 — 3D định vị, 2D quyết định

ASM Consortium liệt kê *"No 3D graphical objects"* như một quy tắc thiết kế HMI. Ta không bỏ 3D — ta đặt đúng chỗ:

- **3D**: ngữ cảnh không gian, định vị, phân biệt, điều hướng.
- **2D tuân ISA-101**: báo động, xác nhận, tạo phiếu, điều khiển.

Kèm ba luật cứng:
1. **Góc camera không bao giờ được che một alarm đang hoạt động.** Badge alarm vẽ ở **không gian màn hình**, không ở không gian thế giới.
2. **Alarm badge = hình dạng + màu + chữ** (mã hoá dư thừa), không bao giờ chỉ màu.
3. Bảng màu **≤ 7 mã** (giới hạn trí nhớ ngắn hạn, ASM Guideline 6.1).

### NT-3 — Không có dữ liệu ≠ bình thường

Cạm bẫy chết người nhất: tag vẫn `Quality=Good` trong khi timestamp ngừng tiến; HMI vẫn vẽ số cuối, badge vẫn xanh, không alarm nào nổ.

Bắt buộc:
1. **Mọi giá trị đi thành bộ ba `(giá trị, chất lượng, thời điểm)`.** Không bao giờ vẽ số mà thiếu xuất xứ.
2. **Trạng thái `KHÔNG RÕ` là hạng nhất** — xám gạch chéo, không bao giờ suy biến về "khoẻ" hay "lỗi".
3. **Ba mức tươi**: `< 60s` tươi (màu bình thường) · `60s–5 phút` cũ (nhạt 40% + badge đồng hồ) · `> 5 phút` không rõ (xám gạch chéo).
4. **"Cập nhật lần cuối" phải là `max(timestamp)` của dữ liệu nền**, KHÔNG phải thời điểm render trang. Riêng phân biệt này diệt cả một lớp bug giả-tươi.
5. **Đếm rỗng khác đếm bằng 0** — chưa đo hiện `—`, không hiện `0` (tái dùng quy ước `WipLineBalance.tsx:110-127`).
6. Giữ nguyên `isScopeEmpty` của `CommandCenter.tsx:1468` — phân biệt "0 cảnh báo vì yên ổn" với "0 vì tài khoản không được gán nhà máy".

### NT-4 — Số giả định phải tự khai là giả định

Kích thước máy, toà nhà, tầng đều **chưa có dữ liệu thật**. Nên:
- Mọi giá trị sinh ra mang cờ `nguon = 'sinh'` và hiện **badge vàng "chưa đo"** trên UI.
- Người nhập tay → `nguon = 'tay'` → lần sinh sau **không đè** (trừ khi tích ô "ghi đè cả phần đã chỉnh tay", có dialog đếm rõ bao nhiêu bản ghi sẽ mất).
- **Nhãn đời model** hiện song song với dấu thời gian dữ liệu: *"bố cục cập nhật 2026-09-06"*. Model cũ được đối xử hiển thị y như dữ liệu cũ — đây là thuốc chống *model drift*.

Đây chính là bài học `BG-127` của repo: *độc lập phải ở mô hình, không ở người đo*.

---

## 4. Ngân sách hiệu năng

Quy mô 43 máy là rất nhỏ với WebGL (đối chiếu: có hệ chạy 30.000 pallet @ 90fps trên three.js thuần, ~670 draw calls). Ngân sách đặt rộng rãi, và **đo bằng e2e tự động, không bằng cảm nhận**.

| Chỉ số | Ngưỡng | Đo bằng |
|---|---|---|
| Draw calls | **≤ 150** | `renderer.info.render.calls` |
| Tam giác | **≤ 500.000** | `renderer.info.render.triangles` |
| Đèn | **≤ 3**, không point-light shadow | Đọc scene graph |
| Nhãn DOM đồng thời | **≤ 30** (cap cứng) | `locNhan.ts` |
| DPR | clamp **≤ 1,5** | `<Canvas dpr={[1, 1.5]}>` |
| FPS khi xoay | **≥ 30** | e2e qua `requestAnimationFrame` |
| GPU khi đứng yên | **≈ 0%** | `frameloop="demand"` |
| Chunk `three` | tách riêng `vendor-three` | `dist/public/assets` |

**Vì sao cap nhãn ở 30:** đo được rằng **300 nhãn CSS2D đã "laggy"**, và `troika-three-text` tốn **1 draw call mỗi nhãn**. Không công nghệ nào cứu được — phải **cull**, và cull mới là cách sửa, không phải chọn thư viện.

**Kỹ thuật bắt buộc:**

1. **`frameloop="demand"` + `invalidate()`** — đòn bẩy lớn nhất cho iGPU. Dashboard mở suốt ca 8 tiếng phải đưa GPU về 0 khi không ai chạm.
2. **`BatchedMesh` cho thân máy** — đã kiểm chứng `node_modules/three/src/objects/BatchedMesh.js` **có sẵn** trong r182. Nó render nhiều object **cùng material nhưng khác hình học** trong 1 draw call, `perObjectFrustumCulled` mặc định `true`, và **giữ ID từng object** nên click vào máy vẫn hoạt động. Đây là điểm khác then chốt so với `InstancedMesh` (chỉ một geometry duy nhất).
3. **`InstancedMesh` cho vật thể lặp** (kệ, pallet, cột).
4. **Hạ tầng tĩnh merge thành 1 mesh** với baked vertex color; đường viền gộp thành 1 `LineSegments`.
5. **Outline bằng `EdgesGeometry`, KHÔNG post-processing.** Trên iGPU, `EffectComposer` mất MSAA rẻ và thêm một full-screen pass.
6. **Baked lighting**: 1 `HemisphereLight` + 1 `DirectionalLight` shadow map 1024, `shadow.autoUpdate = false` (chỉ update khi layout đổi).
7. **`vite.config.ts`**: thêm `resolve.dedupe: ['three']` (chống 2 bản three — lỗi câm phổ biến nhất) và `manualChunks` gom `three` + `@react-three/*` vào `vendor-three`.

**KHÔNG dùng `@three.ez/instanced-mesh`**: phiên bản `0.3.x` (API chưa ổn định), README không có benchmark, và có phản chứng đo được — [issue #101](https://github.com/agargaro/instanced-mesh/issues/101): 500.000 ngọn cỏ chạy `InstancedMesh` thường **60 FPS** vs `InstancedMesh2` **15 FPS**. Lợi ích của nó chỉ hoàn vốn ở 10⁵–10⁶ instance; ta ở 10¹–10².

### Chống vỡ

- **Bắt `webglcontextlost`**: `event.preventDefault()` + chờ `webglcontextrestored` → khởi tạo lại. Không làm thì canvas đen vĩnh viễn. Đây là chuyện *sẽ* xảy ra (hết VRAM, driver crash, tab ẩn lâu).
- **Không có WebGL** → rơi thẳng vào `FactoryScene2D` (đã có sẵn, cùng chữ ký props), **không** hiện "trình duyệt không hỗ trợ".
- **`MatDoKhungHinh.ts`**: fps trung bình < 25 trong 3 giây → tự hạ: tắt shadow → DPR = 1 → tắt nhãn → chỉ box. Hiện chip "Chế độ hiệu năng thấp", cho phép ép bật/tắt, nhớ trong `localStorage`.
- **`ErrorBoundary` riêng bọc `<Canvas>`** với fallback là view 2D — tái dùng khuôn `CommandCenter.tsx:839-849`.

---

## 5. Mô hình dữ liệu

### 5.1 Nguyên tắc: một nguồn sự thật mm, hai hệ cũ được nuôi

Hiện có **hai hệ toạ độ song song, không đồng bộ**:

| Hệ | Bảng/cột | Đơn vị | Ai ghi | Ai đọc |
|---|---|---|---|---|
| A | `machines.layoutPositionX/Y` + `machines.layout` jsonb | chuẩn hoá **0–1** | `FactoryFloorEditor` (`machine.updateLayout`) | `FactoryFloor3D`, `DigitalTwinCenter`, `CellTwinPlayer` |
| B | `machine_positions.positionX/Y/Z` + `rotation` | **int pixel** | `WorkshopLayoutEditor` (`layout.updateMachinePosition`) | `Layout.tsx` |

Cả hai đều **không biểu diễn được** thứ Twin 3D cần: độ cao thật, hướng xoay 3 trục, kích thước máy. Đo được: `positionZ = 0` và `rotation = 0` ở **36/36** hàng.

**Quyết định (QĐ-4):** tạo hệ thứ ba là **nguồn sự thật duy nhất cho Twin** — mm tuyệt đối, quaternion, kích thước. Di trú dữ liệu từ A và B vào. **Giữ nguyên cột A và B** để 2 editor cũ chạy song song (QĐ-8) — không đổi ý nghĩa cột đang có dữ liệu, vì đó là thay đổi câm.

### 5.2 Quy ước toạ độ

```
DB lưu milimét (numeric 14,3) · Scene dùng mét (float)

scene.x =  viTriXMm / 1000        // Đông  →
scene.y =  viTriZMm / 1000        // Z trong DB là ĐỘ CAO
scene.z =  viTriYMm / 1000        // Y mặt bằng hướng xuống → Z scene
```

Y của mặt bằng hướng **xuống** (quy ước ảnh/CAD), Y của scene hướng **lên**. Toàn bộ quy đổi nằm trong **một** module thuần `heToaDo.ts`, có test. Mọi thực thể mới (toà nhà, tầng, vật thể cảnh) dùng chung quy ước này.

> ### ★★★ BẪY HOÁN VỊ TRỤC — lỗi câm, không gì nổ (2026-09-06, Đợt 4b)
>
> `hinhHocCanChinh.ts` làm việc trên **hệ scene**; DB dùng **hệ mặt bằng** (y = mặt bằng, z = độ cao).
> Truyền thẳng toạ độ DB vào các hàm căn chỉnh thì:
> - align *"canh lên trên"* **không làm gì cả**
> - `danDeu` **làm máy bay lên trời**
>
> Và **không lỗi nào nổ** — không exception, không cảnh báo, `npm run check` xanh. Người dùng chỉ
> thấy nút bấm không có tác dụng, hoặc máy biến mất khỏi tầm nhìn.
>
> ⇒ Hoán vị đặt ở **một chỗ duy nhất**, có test vòng tròn (đi rồi về phải bằng chính nó).
> Đo được khi tiêm lỗi: **bỏ hoán vị → 5 test đỏ**; **snap tương đối → 7 test đỏ**.
>
> Đây là họ hàng của L-1 (§8 bước 6 ghi "trục Z" khiến máy treo lơ lửng): **mọi chỗ hai hệ toạ độ
> gặp nhau đều là chỗ có thể sai câm.** Danh sách các điểm giao hiện tại: `heToaDo.ts` (mm↔mét),
> `hinhHocTuMoTa.tsx` (mô tả→three), và lớp gọi `hinhHocCanChinh` từ UI.

### 5.3 Bảng mới

#### `twin_toa_nha` — toà nhà

```sql
CREATE TABLE twin_toa_nha (
  id              serial PRIMARY KEY,
  "factoryId"     integer NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  ma              varchar(64)  NOT NULL,
  ten             varchar(255) NOT NULL,
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "rongMm"        numeric(14,3) NOT NULL DEFAULT 60000,
  "sauMm"         numeric(14,3) NOT NULL DEFAULT 40000,
  "caoMm"         numeric(14,3) NOT NULL DEFAULT 12000,
  "quatX" numeric(12,9) DEFAULT 0, "quatY" numeric(12,9) DEFAULT 0,
  "quatZ" numeric(12,9) DEFAULT 0, "quatW" numeric(12,9) DEFAULT 1,
  nguon           twinnguonenum NOT NULL DEFAULT 'sinh',
  "isActive"      boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("factoryId", ma),
  CONSTRAINT ck_toa_nha_quat CHECK (
    abs("quatX"*"quatX" + "quatY"*"quatY" + "quatZ"*"quatZ" + "quatW"*"quatW" - 1) < 0.000001)
);
```

#### `twin_tang` — tầng

```sql
CREATE TABLE twin_tang (
  id              serial PRIMARY KEY,
  "toaNhaId"      integer NOT NULL REFERENCES twin_toa_nha(id) ON DELETE CASCADE,
  "capSo"         integer NOT NULL,                    -- 1,2,3... (am = ham)
  ten             varchar(255) NOT NULL,
  "caoDoMm"       numeric(14,3) NOT NULL DEFAULT 0,
  "caoThongThuyMm" numeric(14,3) NOT NULL DEFAULT 6000,
  "anhNenUrl"     text,
  "anhNenKey"     text,
  "tiLeMmMoiPx"   numeric(12,6),
  "daHieuChuan"   boolean NOT NULL DEFAULT false,
  nguon           twinnguonenum NOT NULL DEFAULT 'sinh',
  "isActive"      boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("toaNhaId", "capSo")
);
```

#### `twin_dat_cho` — vị trí 3D của MỌI thực thể phân cấp

Một bảng thay vì bốn (`machine_positions` + `workshop_positions` + `factory_positions` + …). Lý do: thuật toán sinh, gizmo, undo/redo, và API lưu batch đều thao tác đồng nhất trên "một vật thể có vị trí"; tách bảng theo cấp buộc mọi thứ nhân bốn.

```sql
CREATE TYPE twinnguonenum   AS ENUM ('sinh','tay');
CREATE TYPE twinthucTheenum AS ENUM ('workshop','line','station','machine','workstation');

CREATE TABLE twin_dat_cho (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  "loaiThucThe"   twinthucTheenum NOT NULL,
  "thucTheId"     integer NOT NULL,
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "rongMm"        numeric(14,3), "caoMm" numeric(14,3), "sauMm" numeric(14,3),
  "kichThuocDaDo" boolean NOT NULL DEFAULT false,
  "quatX" numeric(12,9) DEFAULT 0, "quatY" numeric(12,9) DEFAULT 0,
  "quatZ" numeric(12,9) DEFAULT 0, "quatW" numeric(12,9) DEFAULT 1,
  "tiLeX" numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeY" numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeZ" numeric(10,6) NOT NULL DEFAULT 1,
  "modelId"       integer REFERENCES equipment_3d_models(id) ON DELETE SET NULL,
  "daKhoa"        boolean NOT NULL DEFAULT false,
  "hienThi"       boolean NOT NULL DEFAULT true,
  nguon           twinnguonenum NOT NULL DEFAULT 'sinh',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("loaiThucThe", "thucTheId"),
  CONSTRAINT ck_dat_cho_quat CHECK (
    abs("quatX"*"quatX" + "quatY"*"quatY" + "quatZ"*"quatZ" + "quatW"*"quatW" - 1) < 0.000001)
);
CREATE INDEX idx_twin_dat_cho_tang ON twin_dat_cho("tangId");
CREATE INDEX idx_twin_dat_cho_thuc_the ON twin_dat_cho("loaiThucThe","thucTheId");
```

> **`UNIQUE (loaiThucThe, thucTheId)`** là ràng buộc quan trọng nhất bảng này: một máy chỉ có **một** vị trí trong toàn hệ. Đây là thứ ngăn hệ toạ độ thứ tư ra đời.

#### `twin_vat_the` — vật thể cảnh không thuộc cây phân cấp

Tường, cột, cửa, vạch kẻ sàn, **vùng an toàn (polygon)**, kệ, pallet, biển báo, và mọi GLB người dùng nhập.

```sql
CREATE TYPE twinvatTheenum AS ENUM (
  'tuong','cot','cua','vach_ke','vung','ke','pallet',
  'bang_tai','rao_an_toan','bien_bao','nhom','khac'
);

CREATE TABLE twin_vat_the (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  "chaId"         integer REFERENCES twin_vat_the(id) ON DELETE CASCADE,
  loai            twinvatTheenum NOT NULL,
  ten             varchar(255) NOT NULL,
  "modelId"       integer REFERENCES equipment_3d_models(id) ON DELETE SET NULL,
  "viTriXMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriYMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "viTriZMm"      numeric(14,3) NOT NULL DEFAULT 0,
  "rongMm"        numeric(14,3), "caoMm" numeric(14,3), "sauMm" numeric(14,3),
  "quatX" numeric(12,9) DEFAULT 0, "quatY" numeric(12,9) DEFAULT 0,
  "quatZ" numeric(12,9) DEFAULT 0, "quatW" numeric(12,9) DEFAULT 1,
  "tiLeX" numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeY" numeric(10,6) NOT NULL DEFAULT 1,
  "tiLeZ" numeric(10,6) NOT NULL DEFAULT 1,
  mau             varchar(9),
  "diemDa"        jsonb,
  "thuocTinh"     jsonb NOT NULL DEFAULT '{}',
  "thuTu"         integer NOT NULL DEFAULT 0,
  "daKhoa"        boolean NOT NULL DEFAULT false,
  "hienThi"       boolean NOT NULL DEFAULT true,
  nguon           twinnguonenum NOT NULL DEFAULT 'tay',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_twin_vat_the_tang ON twin_vat_the("tangId");
```

> `loai = 'vung'` với `diemDa` thay thế `factory_zones` (hiện **0 dòng**, nên không có dữ liệu để mất). Cột `points` của `factory_zones` là toạ độ 0–1; ở đây là mm — nhất quán với phần còn lại.

#### `twin_kich_thuoc_loai` — kích thước mặc định theo loại máy (QĐ-7)

```sql
CREATE TABLE twin_kich_thuoc_loai (
  "loaiMay"       machinetypeenum PRIMARY KEY,
  "rongMm"        numeric(14,3) NOT NULL,
  "caoMm"         numeric(14,3) NOT NULL,
  "sauMm"         numeric(14,3) NOT NULL,
  "laGiaDinh"     boolean NOT NULL DEFAULT true,
  "ghiChu"        text,
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);
```

Seed cho **24 giá trị** của `machineTypeEnum` (AVI, AOI, SPI, AXI, ICT, FCT, CMM, MOUNTER, REFLOW, STENCIL_PRINTER, WAVE_SOLDER, ROBOT, PALLETIZER, WELDER…). **Mọi hàng seed đặt `laGiaDinh = true`** — không hàng nào được giả vờ là số đo. Kỹ thuật đo thật rồi sửa trong Inspector → `laGiaDinh = false` → badge tự tắt.

Thứ tự ưu tiên lấy kích thước khi vẽ máy:

```
twin_dat_cho.rongMm/caoMm/sauMm      (đã nhập tay, kichThuocDaDo = true)
  ↓ nếu NULL
equipment_3d_models.bounds           (bbox đo từ file GLB khi nạp)
  ↓ nếu NULL
twin_kich_thuoc_loai[machineType]    (mặc định theo loại — badge "chưa đo")
  ↓ nếu không có
1200 × 1800 × 800 mm                 (mặc định cuối — badge "chưa đo")
```

#### `twin_ban_ghi` — phiên bản bố cục

```sql
CREATE TABLE twin_ban_ghi (
  id              serial PRIMARY KEY,
  "tangId"        integer NOT NULL REFERENCES twin_tang(id) ON DELETE CASCADE,
  nhan            varchar(255) NOT NULL,
  "anhChup"       jsonb NOT NULL,
  "daXuatBan"     boolean NOT NULL DEFAULT false,
  "nguoiTao"      integer REFERENCES users(id),
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
```

**Màn Vận hành chỉ đọc bản đã xuất bản.** Người đang dựng không làm rối màn hình vận hành đang chạy.

### 5.4 Sửa bảng có sẵn

| Bảng | Thay đổi | Vì sao |
|---|---|---|
| `layoutLevelEnum` | thêm `SITE`, `BUILDING`, `FLOOR` | Layout neo được vào cấp campus |
| `equipment_3d_models` | thêm `soTamGiac integer`, `kichThuocByte bigint`, `anhXemTruocUrl text`, `phanLoai varchar(64)`, `nguonGoc varchar(16) DEFAULT 'builtin'` | Thư viện asset có phân loại, ảnh xem trước, biết nặng bao nhiêu. `bounds` **đã có sẵn**, chỉ chưa điền |
| `workshops` | thêm `tangId integer REFERENCES twin_tang(id) ON DELETE SET NULL` | Xưởng nằm ở tầng nào |
| `machine_positions`, `machines.layoutPositionX/Y` | **KHÔNG ĐỔI** | QĐ-8: hai editor cũ chạy song song |

### 5.5 Migration

| Tệp | Nội dung |
|---|---|
| `drizzle/0350_twin_toa_nha_va_tang.sql` | `twin_toa_nha`, `twin_tang`, `workshops.tangId`, mở rộng `layoutLevelEnum` |
| `drizzle/0351_twin_dat_cho_va_vat_the.sql` | 3 enum mới, `twin_dat_cho`, `twin_vat_the`, `twin_ban_ghi` |
| `drizzle/0352_twin_kich_thuoc_loai.sql` | `twin_kich_thuoc_loai` + seed 24 loại (`laGiaDinh = true`) |
| `drizzle/0353_twin_mo_rong_asset.sql` | Cột mới cho `equipment_3d_models` |

Áp bằng `npm run db:push`.

> **ĐÍNH CHÍNH (Đợt 0):** spec ban đầu ghi *"sau đó `npm run db:verify`"* — **script đó không tồn tại**
> trong `package.json` (chỉ có `db:push` và `db:generate`). Thay bằng **migration `0354`** đóng vai
> cầu chì: tự đọc lại `pg_catalog` và **ném lỗi nếu bảng/cột/enum thiếu**. Lý do: các migration dùng
> `IF NOT EXISTS` dày đặc có thể "chạy sạch" mà **không tạo gì cả** — chạy sạch không phải bằng chứng
> đã tạo.

### 5.6 Di trú dữ liệu — script một chiều, đo được

> ### ★★★ QĐ-15 (2026-09-06) — MỤC NÀY ĐÃ HẾT HIỆU LỰC VỚI DỮ LIỆU DEV
>
> Chủ sở hữu quyết **xoá toàn bộ và thiết kế lại**, thay vì di trú. Cụ thể đã xoá:
> `twin_toa_nha` (3) · `twin_tang` (5) · `twin_dat_cho` (38) · `twin_vat_the` (12) ·
> `machine_positions` (36) · `factory_layouts` (3) · `machines.layoutPositionX/Y` + `machines.layout`
> (38 máy → NULL) · 2–3 nhà máy rác audit. **Giữ** `twin_kich_thuoc_loai` (24 hàng, bảng tham chiếu)
> và toàn bộ cây phân cấp SIM-FAC (43 máy / 37 trạm / 3 Line).
> Sao lưu: `scratchpad/backup/twin-truoc-xoa.json` (135 hàng, 8 bảng).
>
> **Thay bằng** `scripts/seed-twin-mau.ts` — tất định, idempotent, mọi hàng `nguon='sinh'` +
> `kichThuocDaDo=false`. Kích thước toà nhà **suy từ nội dung phải chứa** (3 Line × 12 trạm ×
> bước trạm), không lấy số tròn tuỳ tiện và tuyệt đối không đọc `factories.floorWidthM` (§10A.0).
>
> **Hệ quả phải biết:** hai editor cũ (`FactoryFloorEditor` hệ 0–1, `WorkshopLayoutEditor` hệ pixel)
> giờ **không còn dữ liệu** — chúng sẽ hiện mặt bằng trống. Đây là hệ quả **có chủ ý** của QĐ-15:
> dứt điểm hai nguồn sự thật song song ngay, thay vì nuôi chúng tới Đợt 4. Sổ kiểm §11 mục
> #41–#49 (tính năng độc nhất của 2 editor đó) **vẫn phải di trú sang màn Thiết kế** — mất dữ liệu
> không có nghĩa mất yêu cầu chức năng.
>
> Mục §5.6 dưới đây **giữ lại làm hồ sơ**: nó ghi 3 lỗi spec mà Đợt 0 phát hiện khi thực thi, và
> khuôn đối soát hai mô hình rời vẫn áp dụng cho script seed mới.

Script `scripts/di-tru-bo-cuc-twin.ts`, chạy tay, **idempotent**, in báo cáo đối soát.

**Bước 1 — sinh khung tối thiểu.** Với mỗi `factory` có ít nhất 1 máy (đo được: **2 nhà máy**), tạo 1 `twin_toa_nha` + 1 `twin_tang`, `nguon = 'sinh'`. **Không sinh nhiều toà/tầng** (QĐ-5) — chờ người nhập thật.

> **ĐÍNH CHÍNH (Đợt 0):** không có cột `machines.factoryId`. Phải đi **4 chặng**:
> `machines.stationId → stations.lineId → production_lines.workshopId → workshops.factoryId`.

**Bước 2 — di trú vị trí.** Với mỗi máy, ưu tiên:

```
1. machine_positions (hệ B, int pixel)    → 36 máy
     xMm = positionX × TI_LE_PX_MM
2. machines.layoutPositionX/Y (hệ A, 0–1) → 38 máy, dùng khi hệ B không có
     xMm = layoutPositionX × KÍCH_THƯỚC_MẶC_ĐỊNH_TẦNG
     ★ ĐÍNH CHÍNH (Đợt 0): bản đầu ghi "× factories.floorWidthM × 1000" — SAI, và
       TỰ MÂU THUẪN với §10A.0 vốn cấm dùng floorWidthM (SIM-FAC = 1500 ⇒ 1,5 km, số rác).
       Đợt 0 từ chối làm theo và báo lại. Dùng kích thước mặc định của tầng.
3. Không có cả hai                        → không tạo hàng;
                                            máy hiện ở "khu chờ xếp chỗ"
```

> ⚠️ **`TI_LE_PX_MM` là GIẢ ĐỊNH, không phải số đo.** `factory_layouts` không có trường tỉ lệ và không có cờ hiệu chuẩn. Nên **mọi hàng di trú đặt `nguon = 'sinh'` và `kichThuocDaDo = false`**, hiện badge "chưa đo". Người dùng hiệu chuẩn lại bằng công cụ **Đặt tỉ lệ** ở màn Thiết kế (§7.4). Không được trình bày kết quả di trú như toạ độ thật.

**Bước 3 — đối soát bắt buộc.** Script in và **dừng nếu lệch**:

```
Máy trong DB:              43
Máy isActive:              42
Đã có vị trí (hệ B):       36
Đã có vị trí (hệ A):       38
Hợp nhất được:             N
Không có vị trí nào:       43 − N   ← phải khớp số máy hiện ở
                                      "khu chờ xếp chỗ" trên UI
```

Đây là phép đo **hai mô hình rời nhau** (đếm từ DB **và** đếm từ UI), theo bài học `BG-127`: hai phép đo cùng kiểu có thể cùng sai.

---

## 6. Kiến trúc phần mềm

### 6.1 Bản đồ module

```
client/src/components/twin3d/
├── loi/                          ★ LÕI ENGINE — dùng chung Thiết kế + Vận hành
│   ├── KhungCanh.tsx             <Canvas> + camera + đèn + demand + webglcontextlost
│   ├── dieuKhienQuay.ts          OrbitControls + nối invalidate (RB-3)
│   ├── boNhoModel.ts             GLTFLoader + DRACOLoader singleton có cache
│   ├── LoBatchMay.tsx            BatchedMesh — 1 draw call, giữ ID máy để click
│   ├── LoInstanceVatThe.tsx      InstancedMesh cho kệ/pallet/cột
│   ├── LopNhan.tsx               nhãn HTML chiếu + declutter cap 30
│   ├── chonVatThe.ts             picking + đồng bộ 2 chiều với DOM
│   ├── vienNoiBat.ts             outline EdgesGeometry (KHÔNG post-processing)
│   ├── matDoKhungHinh.ts         theo dõi fps, tự hạ chất lượng
│   └── giaiPhong.ts              dispose() geometry/material/texture (RB-7)
│
├── (module thuần .ts — CÓ TEST vitest)
│   ├── heToaDo.ts                mm ↔ mét, quaternion, bbox
│   ├── hinhHocCanChinh.ts        snap lưới, VÁ snap xoay tuyệt đối (RB-2),
│   │                             align, distribute, array
│   ├── snapVatVaoVat.ts          spatial index + dung sai theo PIXEL màn hình
│   ├── sinhBoCuc.ts              thuật toán sinh bố cục (§8)
│   ├── hinhKhoiMay.ts            sinh khối máy theo loại
│   ├── hinhKhoiHaTang.ts         sinh tường/cột/sàn/vạch kẻ
│   ├── mucChiTiet.ts             LOD 4 bậc
│   ├── mauTrangThai.ts           MỘT nguồn sự thật màu trạng thái (§10)
│   ├── locNhan.ts                declutter screen-space
│   ├── lichSuThaoTac.ts          undo/redo command-pattern
│   ├── kiemTraAsset.ts           validate GLB/STEP upload
│   └── duongDanTwin.ts           mã hoá/giải mã deep-link URL ↔ trạng thái
│
├── thiet-ke/                     ★ chỉ màn Thiết kế
│   ├── GizmoBienDoi.tsx          TransformControls + getHelper() (RB-1)
│   ├── CayPhanCap.tsx            cây trái, kéo-thả đổi cha
│   ├── BangThuocTinh.tsx         inspector phải, nhập số chính xác
│   ├── ThuVienAsset.tsx          palette asset + upload GLB/STEP
│   ├── ThanhCanChinh.tsx         align 6 hướng, distribute, array, đo
│   ├── VeVungPolygon.tsx         vẽ/sửa vùng an toàn
│   └── HopThoaiSinh.tsx          dialog sinh tự động + xem trước dạng ma
│
└── van-hanh/                     ★ chỉ màn Vận hành
    ├── ThanhDuongDan.tsx         breadcrumb Site→Toà→Tầng→Xưởng→Chuyền
    ├── NganXuLy.tsx              ★ drawer 2D: ack alarm, tạo phiếu, gán KTV (NT-2)
    ├── BangKpiNoi.tsx            KPI overlay
    ├── DaiCanhBao.tsx            dải cảnh báo (di trú từ CommandCenter)
    └── DongThoiGian.tsx          timeline tua

client/src/pages/
├── TwinStudio.tsx                ★ MỚI → /twin-studio
└── TwinVanHanh.tsx               ★ MỚI → /twin

server/routers/
└── twinCanhRouter.ts             ★ MỚI — CRUD cảnh, sinh tự động, upload asset

server/services/twin/
├── boCucService.ts               ★ MỚI — chạy thuật toán sinh, ghi DB trong transaction
└── canhService.ts                ★ MỚI — đọc/ghi cảnh theo phạm vi
```

**Vì sao thư mục mới `twin3d/` chứ không dùng `twin/`:** `client/src/components/twin/` hiện chứa `ArticulatedRobot.tsx` thuộc kiến trúc cũ. Tên mới tránh nhầm lẫn trong giai đoạn hai hệ sống chung; khi di trú xong thì đổi tên là việc cơ học.

**Quan hệ với `factory-scene`:** package `factory-scene` (1.393 dòng) là **nền của `loi/`**, không viết lại. Cụ thể: `sceneTypes.ts` (`MachineNode`, `OverlayMode`, `scenePalette`, `overlayColorHex`, `shapeKeyFor`) được **mở rộng tại chỗ**; `FactoryScene2D.tsx` trở thành fallback 2D chính thức; `machineMesh.tsx` là nền cho `hinhKhoiMay.ts`.

### 6.2 Luồng dữ liệu

```
                  ┌──────────────────────────────────────┐
   DB (mm)  ─────►│  twinCanh.docCanh({phamVi, id})      │
                  │  trả 1 lần: TOÀN BỘ hình học tĩnh    │
                  └──────────────┬───────────────────────┘
                                 │  staleTime 5 phút
                                 ▼
                      heToaDo.ts (mm → mét)
                                 │
                                 ▼
                  ┌──────────────────────────────────────┐
                  │  Scene graph bất biến (useMemo)      │
                  │  BatchedMesh cho máy · Instanced cho │
                  │  vật thể lặp · merge cho hạ tầng     │
                  └──────────────┬───────────────────────┘
                                 │
   twin:update (2s, ĐANG BẬT) ──►│  CHỈ cập nhật:
   twin:trangThai (10s, MỚI) ───►│   • màu instance
   fallback poll 5s ────────────►│   • nội dung nhãn
                                 │   • badge alarm
                                 ▼   KHÔNG dựng lại geometry
                          invalidate() → 1 frame
```

**Nguyên tắc bất biến:** hình học tĩnh tách hẳn khỏi trạng thái động. Dữ liệu realtime **chỉ** được chạm `instanceColor`, `visible`, nội dung nhãn. Không bao giờ dựng lại scene graph vì một cập nhật trạng thái.

### 6.3 API mới

`server/routers/twinCanhRouter.ts`, đăng ký namespace `twinCanh`.

| Thủ tục | Loại | Input | Output |
|---|---|---|---|
| `docCanh` | query | `{phamVi, phamViId, banGhiId?}` | Toàn bộ hình học tĩnh: toà nhà, tầng, đặt chỗ, vật thể, asset |
| `trangThaiHangLoat` | query | `{phamVi, phamViId}` | `[{machineId, trangThai, diemSucKhoe, capNhatLuc, doTuoiGiay}]` — **3 query cố định, KHÔNG N+1** |
| `xemTruocSinh` | query | `{factoryIds[], cauHinh}` | `KetQuaSinh` — **không ghi DB**, để vẽ ghost |
| `sinhTuDong` | mutation (admin) | `{factoryIds[], cauHinh, ghiDeThuCong}` | `{daTao, daGiuNguyen, canhBao[]}` — 1 transaction |
| `luuToaNha` / `xoaToaNha` | mutation | CRUD `twin_toa_nha` | |
| `luuTang` / `xoaTang` | mutation | CRUD `twin_tang` | |
| `luuDatCho` | mutation | CRUD `twin_dat_cho` | |
| `luuVatThe` / `xoaVatThe` | mutation | CRUD `twin_vat_the` | |
| `luuHangLoat` | mutation | `{thayDoi[]}` (≤ 500) | Ghi batch 1 transaction — nút Lưu của Thiết kế |
| `taiAnhNen` | mutation | `{tangId, tenFile, duLieu}` | URL ảnh nền tầng |
| `luuBanGhi` / `xuatBanBanGhi` / `khoiPhucBanGhi` | mutation | Phiên bản bố cục | |

**Sửa lỗi hiệu năng đã phát hiện:** `machineStatus.listWithStatus` **từng** chạy 3 query con mỗi máy (N+1).

> **★ ĐÍNH CHÍNH 2026-09-07 (Đợt 6) — N+1 ĐÃ ĐƯỢC VÁ TỪ TRƯỚC.** Đo bằng cách vá hook `debug` của
> `postgres-js` (điểm **mọi** câu lệnh đi qua) rồi gọi hàm thật: **N=42 ⇒ 4 query**, ổn định qua 3
> lượt — không phải `1 + 3×42 = 127`. `server/db/machine.ts:55` đã viết lại ở commit `d467c6b5`
> (doc 54 Wave C), **đang dùng đúng khuôn `DISTINCT ON` + `LEAD`** mà §6.3 kê; comment
> `machine.ts:80-87` ghi lại việc gỡ fan-out cũ.
>
> ⇒ Việc còn lại **không phải "vá N+1"** mà là **dựng endpoint hình dạng §6.3 trong
> `twinCanhRouter.ts`, dùng lại truy vấn tập hợp đã có**.
>
> ★ Agent tự nêu giới hạn phép đo của chính nó: *"4 query ở N cố định 42 chưa tự nó chứng minh không
> có N+1 — cần cho N biến thiên."* Đúng. Đó là phép đo phải làm để đóng mục này.

Toàn bộ là `protectedProcedure`; `sinhTuDong`, `xoaAsset`, `xuatBanBanGhi` là `adminRoleProcedure`.

### 6.4 Phân quyền

| Hành động | Quyền |
|---|---|
| Mở `/twin` (vận hành) | `analytics_oee` **hoặc** `machine_status` — canView |
| Mở `/twin-studio` (thiết kế) | `settings_factory` **hoặc** `machine_control` — canView |
| Sửa/xoá bố cục | canEdit |
| Nhập asset | canCreate |
| Sinh tự động, xuất bản phiên bản | **`adminProcedure`** |

> **★ ĐÍNH CHÍNH 2026-09-06 (vá Đợt 4) — spec sai TÊN so với mã.** Bản đầu ghi `adminRoleProcedure`;
> tên đó **không tồn tại**. `server/_core/trpc.ts` có `adminProcedure` (dòng 353) và factory
> `roleProcedure(...)`. Agent chọn `adminProcedure` — đúng nghĩa spec, khớp khuôn ~20 router khác —
> và **báo lại thay vì tự sửa spec**.
>
> **Hệ quả phải biết:** `adminProcedure` **kèm cổng 2FA** (`require2FA`). Admin chưa bật 2FA gọi
> `sinhTuDong` sẽ nhận `TWO_FACTOR_NOT_SET_UP`. Đúng §8.4 (2FA bắt buộc cho internet-facing), nhưng
> đây là **đổi hành vi thật** — không phải đổi tên suông.
| Ack alarm | canEdit trên module alarm |
| Tạo phiếu công việc | `canCreate` trên module **`machine_monitoring`** (alias `machine_status`) |

**Không có quyền → vào thẳng chế độ chỉ đọc, ẩn toàn bộ gizmo và nút Lưu** (không chỉ disable).

> ⚠️ **Bài học Khối D bắt buộc áp dụng.** Mục nav và route guard phải khai **cùng một quyền** — lỗi "một lối vào rồi từ chối" xảy ra khi nav khai `settings_factory` nhưng route gate `analytics_oee`. Và: **admin bypass `requirePermission`**, nên phép đo quyền **phải thực hiện bằng tài khoản KHÔNG phải admin**; đo bằng admin chứng minh số 0.
>
> ### ★★★ NỢ ĐANG MỞ (2026-09-06, Đợt 4b tự khai) — e2e XANH nhưng CHỨNG MINH SỐ 0 về quyền
>
> `e2e/twin-studio-thiet-ke.spec.ts` chạy **5/5 xanh**, nhưng bằng tài khoản `e2e_twin_dot4`
> (id 20191) **vai `admin`**. Admin bypass `requirePermission` ⇒ **suite đó không đo gì về phân
> quyền**. Agent viết mã **tự khai điều này** thay vì để nó trôi — nhưng nợ vẫn là nợ.
>
> **Đây là một biến thể của G5 (đo trên tập rỗng):** phép đo chạy, kết quả xanh, và cổng nào cũng
> hài lòng — trong khi luật cần kiểm **chưa bao giờ được thực thi một lần nào**. Ai đọc "e2e 5/5
> xanh" mà kết luận "quyền đã đo" là mắc đúng bẫy này.
>
> **Tài khoản non-admin có sẵn trong DB dev để đo cho đúng:**
> `operator1` (48, không quyền) · `supervisor1` (49, chỉ `machine_control`) ·
> `maint1` (50, `machine_control`) · `engineer1` (51, cả hai).
> Kỳ vọng theo §6.4: supervisor1/maint1 **PHẢI vào được** `/twin-studio` (nhánh OR), operator1 **bị chặn**.
>
> Và một mục §6.4 **giờ mới đo được** vì đã có gizmo: *"Không có quyền → vào thẳng chế độ chỉ đọc,
> **ẩn** toàn bộ gizmo và nút Lưu (không chỉ disable)"*.

---

## 7. Màn Thiết kế — `/twin-studio`

### 7.1 Bố cục ba vùng

Đây là bố cục chung của AWS TwinMaker Scene Composer, Azure 3D Scenes Studio, và Visual Components. Nó tồn tại vì hai lối tìm kiếm khác nhau: **cây tìm theo tên** (khi không biết vật ở đâu), **canvas tìm theo vị trí** (khi không biết tên).

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Xưởng dựng Twin      [Tầng ▾][☑Nhãn][☐Ngừng KT]  [⊹Kéo][↻Xoay][⤢Co]  ↶ ↷      │
│                                              [✨Sinh tự động][💾Lưu][↺Vẽ lại]   │
├────────────────────────────────────────────────────────────────────────────────┤
│ Sức khoẻ: 41/41 đã xếp · 0 chờ · 42 chưa đo · ⚠ 1 đặt chỗ MỒ CÔI              │
├──────────────────┬──────────────────────────────────────┬──────────────────────┤
│ CÂY PHÂN CẤP     │                                      │ THUỘC TÍNH           │
│ [🔍 lọc...]      │            CANVAS 3D                 │                      │
│                  │                                      │ Tên   [__________]   │
│ ▾ SIM-FAC        │      (gizmo di chuyển/xoay/co)       │ Loại  [AOI      ▾]   │
│   ▾ Toà A        │                                      │ Model [mặc định ▾][⤒]│
│     ▾ Tầng 1     │                                      │                      │
│       ▾ Xưởng SIM│                                      │ Vị trí (mm)          │
│         ▾ Chuyền1│                                      │  X [____] Y [____]   │
│           ▸ Tr.1 │                                      │  Z [____]            │
│             ■ M1 │                                      │ Xoay (°)  [_____]    │
│                  │                                      │ Kích thước (mm)      │
│ ── KHU CHỜ ──    │                                      │  R[__] C[__] S[__]   │
│  ▫ M40 (chưa đặt)│                                      │  ⚠ chưa đo  [Đã đo]  │
│  ▫ M41           │  [⊞Lưới][📐Đo][🎨Vùng][🖼Ảnh nền]     │ ☐ Khoá   ☑ Hiện      │
│  ▫ M42           │  Vẽ 17 · 1.418 tri · 58 fps          │ [Gỡ khỏi mặt bằng]   │
├──────────────────┴──────────────────────────────────────┴──────────────────────┤
│ THƯ VIỆN ASSET   [Máy][Hạ tầng][Kho]   [🔍 lọc]        [⤒ Tải mô hình lên]     │
│  ▢ AOI mặc định  ▢ AVI mặc định  ▢ Tường  ▢ Cột  ▢ Kệ  ▢ Pallet               │
│  Kéo thẻ vào cảnh để đặt mô hình lên mặt bằng.                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

> **★ ĐÍNH CHÍNH 2026-09-06 (Đợt 4b) — số trong khung trên đã sửa.** Bản đầu ghi "36/43 đã xếp ·
> 7 chờ xếp" là **số cũ trước khi seed lại** (QĐ-15). Đo lại bằng hai mô hình rời:
> SIM-FAC có **42 máy tổng, 41 sống**; `twin_dat_cho` có **42 hàng máy**, trong đó **1 hàng trỏ vào
> máy `isActive=false`** — bảng đặt chỗ giữ vị trí cho một máy đã ngừng.
>
> Agent **không sửa spec** mà thêm ô đếm **`datChoMoCoi`** để chỗ lệch **tự kêu trên UI** (NT-3),
> thay vì im lặng cho hai con số khớp nhau. Đây là xử lý đúng: chênh lệch không biến mất, nó được
> **hiển thị**.
>
> Máy chờ xếp chỗ duy nhất toàn hệ là id 257 (factory 18, chưa có toà nhà).


Dùng `PageShell maxWidth="full"` + `react-resizable-panels@3.0.6` (đã có trong deps) cho 3 cột kéo giãn được.

**Hai chi tiết bố cục có lý do đo được:**

1. **Dải "Sức khoẻ dữ liệu" trên cùng** — hiện *đã xếp chỗ / chờ xếp / chưa đo kích thước*. Đây là hiện thực hoá NT-3 và NT-4 ngay ở chỗ dễ thấy nhất, thay vì giấu trong tooltip.
2. **"Khu chờ xếp chỗ" trong cây** — 7 máy chưa có vị trí (43 − 36) hiện ở nhánh riêng, mờ + viền nét đứt. Tái dùng khuôn đã có ở `FactoryFloor3D.tsx:154-159`. Nếu ẩn chúng đi, người dùng không bao giờ biết mình thiếu 7 máy.

### 7.2 Bộ 9 công cụ căn chỉnh (QĐ-3)

Không thư viện nào cho sẵn align/distribute — three.js `TransformControls`, drei `PivotControls`, Babylon `GizmoManager` đều chỉ có gizmo + snap lưới. Nhưng phần thiếu **chỉ là số học bounding-box**, không cần spatial index hay constraint solver. Đó là ranh giới tự nhiên của v1.

| # | Công cụ | Phím | Ghi chú thực thi |
|---|---|---|---|
| 1 | Gizmo di chuyển / xoay / co giãn | `W` / `E` / `R` | `TransformControls` + **`getHelper()`** (RB-1). Quy ước phím theo Unity — người dùng 3D đã có sẵn trong ngón tay |
| 2 | Snap lưới bước chỉnh được (mặc định 100 mm) | giữ `Ctrl` để **đảo** | Ngữ nghĩa *đảo* của Blender: một phím phục vụ cả "snap ngay" lẫn "thoát snap". **Snap không có đường thoát còn tệ hơn không snap** |
| 3 | **Vá snap xoay thành tuyệt đối** | — | RB-2. 0/15/30/45/90°. ~10 dòng trong `hinhHocCanChinh.ts` |
| 4 | Nudge phím mũi tên | `←↑→↓` 10 mm · `Shift` 100 mm | Độ chính xác không phụ thuộc con chuột |
| 5 | Khoá trục khi kéo | `X` / `Y` / `Z` | |
| 6 | **Align 6 hướng + Distribute** | `Alt`+chữ | Trái/giữa/phải + trên/giữa/dưới; distribute ngang/dọc. Thuần bbox. Dùng `Alt` (Figma) thay `Ctrl+Shift+Mũi tên` để tránh đụng phím trình duyệt |
| 7 | Nhập số chính xác trong Inspector | — | **Ô nhập là nguồn sự thật, gizmo chỉ là lối tắt** |
| 8 | Khoá / ghim vật thể | `Ctrl+L` | Cột `daKhoa`. Chặn lỗi phổ biến nhất: kéo nhầm thứ đã đặt đúng |
| 9 | **Undo/Redo command-pattern** | `Ctrl+Z` / `Ctrl+Shift+Z` | Không phải tính năng mà là **quyết định kiến trúc** — nhét sau rất đắt. Lưu *lệnh* `{op, targets, truoc, sau}`, không snapshot cả scene. Stack 50 bước, gộp thao tác kéo liên tiếp |

**Cộng thêm (QĐ-3, mức Visual Components):**

| # | Công cụ | Ghi chú |
|---|---|---|
| 10 | **Snap vật-vào-vật** | Bắt cạnh / mặt / tâm / góc bbox của máy khác. ⚠️ **Dung sai tính theo PIXEL màn hình, không theo đơn vị thế giới** — nếu không, snap vỡ ở mọi mức zoom. Cần `three-mesh-bvh` (chưa cài) hoặc lưới không gian tự viết |
| 11 | **Array / nhân bản theo mẫu** | Tuyến tính (theo trục, bước, số lượng) và toả tròn (quanh trục, góc, số lượng). Xem trước bằng bounding box trước khi Áp dụng — khuôn của Visual Components `Pattern` |
| 12 | **Đo khoảng cách** | Click 2 điểm → hiện khoảng cách mm. Bố trí mặt bằng luôn cần "cái này cách cái kia bao xa" |

> **Cạm bẫy đã biết — snap source ≠ snap target.** Người dùng tưởng **góc** vật đang kéo sẽ snap, nhưng code lại snap **gốc toạ độ**. Blender giải bằng tuỳ chọn "Snap With: Closest/Center/Median/Active"; không thư viện web nào có. v1 **hardcode "điểm gần nhất của bounding box"** và ghi rõ trong tooltip.

### 7.3 Chức năng chính

| Nhóm | Chi tiết |
|---|---|
| **Chọn phạm vi** | Dropdown Tầng. Đổi tầng = đổi cảnh, camera bay tới, cây tự mở đúng nhánh |
| **Sinh tự động** | Mở `HopThoaiSinh`: chỉnh tham số → **xem trước dạng ma (ghost) trong 3D** → bảng tổng kết "sẽ tạo N vật thể, **giữ nguyên M vật thể đã chỉnh tay**" → Áp dụng |
| **Chọn** | Click trong 3D **hoặc** trong cây — **đồng bộ hai chiều bắt buộc**. `Shift`-click chọn nhiều. Chọn xong: outline + inspector đổi |
| **Kéo–thả** | Gizmo 3 chế độ. Kéo giới hạn trong mặt sàn của tầng đang chọn (không cho máy bay lơ lửng, trừ khi bỏ khoá trục Y) |
| **Gỡ khỏi mặt bằng** | Phím `Delete`. Xoá hàng `twin_dat_cho` = gỡ máy khỏi mặt bằng, **KHÔNG** xoá bản ghi `machines`. Dialog xác nhận nói rõ điều đó, và máy chuyển về "Khu chờ xếp chỗ" |
| **Thêm máy vào mặt bằng** | Kéo từ "Khu chờ xếp chỗ" vào cảnh — **thay thế chức năng độc nhất của `WorkshopLayoutEditor`** (QĐ-10) |
| **Vẽ vùng an toàn** | Công cụ polygon: click thêm điểm, kéo đỉnh, đổi màu, đặt tên, xoá. Ghi `twin_vat_the` với `loai='vung'` — **thay chức năng độc nhất của `FactoryFloorEditor`** (QĐ-10) |
| **Ảnh nền + tỉ lệ** | Tải ảnh mặt bằng CAD (≤ 8 MB) làm nền tầng; công cụ **Đặt tỉ lệ**: click 2 điểm trên ảnh + nhập khoảng cách thật (mm) → tính `tiLeMmMoiPx`, đặt `daHieuChuan = true`. **Đây là cách sửa giả định `TI_LE_PX_MM` ở §5.6** |
| **Lưu** | Ghi *batch* trong **một transaction**. Chỉ báo "N thay đổi chưa lưu" + chặn rời trang (`beforeunload`) |
| **Phiên bản** | `luuBanGhi` / `xuatBanBanGhi` / `khoiPhucBanGhi`. **Vận hành chỉ đọc bản đã xuất bản** |

### 7.4 Thư viện asset và nhập mô hình (QĐ-6)

**Nhóm sẵn có (builtin)** — sinh khi migrate, không cần vẽ:
- *Máy*: khối thủ tục theo `machineTypeEnum` (AOI, AVI, SPI, MOUNTER, REFLOW, ROBOT…) + **5 model đã có** trong `equipment_3d_models`.
- *Hạ tầng*: tường, cột, cửa, lan can an toàn, vạch kẻ sàn, biển tên vùng.
- *Kho*: kệ, pallet, thùng, băng tải, xe đẩy.

**Luồng nhập GLB/GLTF:**

```
Chọn file (.glb/.gltf, ≤ 15 MB)
  → GLTFLoader nạp NGAY TRÊN TRÌNH DUYỆT (chưa upload)
  → kiemTraAsset.ts đo: số tam giác, số material, bbox, có texture rời không
  → Hiện xem trước + số liệu
       ≤ 50.000 tam giác        → OK
       50.001 – 150.000         → cảnh báo, vẫn cho dùng, gợi ý nén
       > 150.000 hoặc > 15 MB   → CHẶN, hướng dẫn nén
  → Upload → uploads/twin-assets/<uuid>.glb
  → Ghi equipment_3d_models: bounds + soTamGiac + nguonGoc='uploaded'
  → Sinh ảnh xem trước: chụp canvas offscreen 256×256 → PNG
```

**Luồng nhập CAD/STEP (QĐ-6)** — dùng `occt-import-js@0.0.23` đã có sẵn:

```
Chọn file (.step/.stp/.iges/.igs, ≤ 30 MB)
  → occt-import-js chuyển sang mesh TRÊN TRÌNH DUYỆT (worker)
  → Cảnh báo nếu > 150.000 tam giác sau chuyển đổi, đề nghị giảm lưới
  → Người dùng xác nhận → xuất GLB → theo luồng GLB ở trên
  → equipment_3d_models.sourceFormat = 'step', conversionStatus = 'ready'
```

> **Nén phía máy chủ — cảnh báo bắt buộc.** Nếu chạy `gltf-transform optimize`, **phải dùng `--no-join --no-flatten`**. Mặc định của nó là `--join true --flatten true`, sẽ **gộp mesh và làm sập cây scene** ⇒ mất danh tính từng node máy ⇒ click-vào-máy chết. Và cần biết: **Draco/Meshopt chỉ giảm băng thông tải, KHÔNG tăng FPS và KHÔNG giảm VRAM** (giải nén xảy ra trước khi lên GPU). Thứ *thật sự* giảm VRAM là **KTX2** — texture nén nằm nén luôn trên GPU.

**Bảo mật — bắt buộc:** allowlist đường dẫn model chỉ mở thêm đúng tiền tố `/uploads/twin-assets/`, không mở gì khác. Server kiểm MIME + magic bytes glTF (`glTF` = `0x46546C67`), giới hạn dung lượng, chỉ cho vai trò có `canCreate`.

---

## 8. Thuật toán sinh bố cục

Module thuần `client/src/components/twin3d/sinhBoCuc.ts` — **thuần tuý, tất định, có test**. Server gọi lại chính module này qua `boCucService.ts` để không có hai bản cài đặt lệch nhau.

### 8.1 Chữ ký

```ts
export interface CauHinhSinh {
  buocChuyenMm: number;         // 6_000  — khoảng cách giữa 2 chuyền
  buocTramMm: number;           // 2_500  — bước dọc chuyền
  buocMayTrongTramMm: number;   // 1_400  — nhiều máy cùng trạm
  loiDiMm: number;              // 4_000  — lối đi giữa các hàng xưởng
  rongSanToiDaMm: number;       // 100_000 — nới ra nếu có xưởng rộng hơn
  kichThuocMacDinh: { rongMm: number; caoMm: number; sauMm: number };
}

export interface CayPhanCapDauVao {
  nhaMay: { id: number; ma: string; isActive: boolean }[];
  toaNha: { id: number; factoryId: number; ma: string }[];   // ★ xem GC-1
  tang:   { id: number; toaNhaId: number; capSo: number }[]; // ★ xem GC-1
  xuong:  { id: number; factoryId: number; ma: string; tangId: number | null }[];
  chuyen: { id: number; workshopId: number; ma: string }[];
  tram:   { id: number; lineId: number; ma: string; thuTu: number | null }[];
  may:    { id: number; stationId: number | null; ma: string;
            loaiMay: string; isActive: boolean }[];
}

export interface KetQuaSinh {
  datCho:  ViTriDatCho[];
  vatThe:  ViTriVatThe[];
  boQua:   { loai: string; id: number; lyDo: string }[];   // đã 'tay' → giữ nguyên
  canhBao: string[];                                        // "3 xưởng không có chuyền nào"
}

export function sinhBoCuc(
  cay: CayPhanCapDauVao,
  kichThuocTheoLoai: Map<string, KichThuoc>,
  daCoThuCong: Set<string>,      // khoá dạng "machine:42"
  cauHinh: CauHinhSinh
): KetQuaSinh;
```

> **GC-1 — `CayPhanCapDauVao` PHẢI mang mảng `toaNha` và `tang`.**
> Nếu không, `xuong.tangId` không có gì để ánh xạ, và mọi xưởng đã được người dùng gán tầng sẽ rơi vào nhánh dự phòng — tức là **lựa chọn tầng của người dùng bị xoá mỗi lần bấm "Sinh tự động"**, đúng kiểu tự huỷ mà cờ `nguon` sinh ra để ngăn. Đây là lỗi *cấu trúc chữ ký*, không phải thiếu dữ liệu, nên phải đúng ngay từ bản đầu.

### 8.2 Các bước

1. **Toà nhà & tầng**: mỗi nhà máy có máy → **1 toà, 1 tầng** (QĐ-5). Không sinh nhiều tầng. Toà/tầng đã tồn tại → **giữ nguyên**, chỉ sinh phần thiếu.
2. **Xưởng vào tầng**: xưởng đã có `tangId` → giữ nguyên tầng đó (đọc qua mảng `tang`, xem GC-1). Chưa có → gán tầng 1 của toà thuộc nhà máy đó.
3. **Xưởng trên mặt sàn — xếp kệ (shelf packing)**:
   - bề **rộng** ô xưởng (trục X) = `sốTrạmNhiềuNhấtTrongMộtChuyền × buocTramMm`
   - bề **sâu** ô xưởng (trục Y) = `sốChuyền × buocChuyenMm`
   - Sắp giảm dần theo bề rộng, xếp thành hàng, xuống hàng khi vượt `rongSanToiDaMm`, chừa `loiDiMm` giữa các hàng và giữa các xưởng cùng hàng.

   > **Trục phải khớp bước 4 và 5.** Bước 4 xếp chuyền cách nhau theo **trục Y**, bước 5 xếp trạm dọc **trục X** ⇒ bề rộng do *số trạm* quyết định, không phải số chuyền. Viết ngược thì ô đóng gói xoay 90° so với nội dung bên trong.
   >
   > **★★★ ĐÍNH CHÍNH 2026-09-06 (Đợt 4a) — bản đầu ghi "T4 đổ ngay ở quy mô nhỏ nhất". SAI.**
   > Đo được khi tiêm đúng phép đảo trục đó: **T5 đổ** (`machine:10 ra ngoài sàn tầng 201`), còn
   > **T4 vẫn XANH** trên mọi ca một-xưởng, kể cả quy mô thật 43 máy.
   >
   > Lý do: đảo trục làm ô **đóng gói** xoay 90°, nhưng nội dung bên trong vẫn xếp đúng ⇒ máy
   > **tràn ra ngoài ô**, không va vào nhau. Số đo (2 chuyền × 10 trạm): ô đúng 27.500×18.000, ô sai
   > 14.500×31.000, nội dung cần tới x = 25.000. T4 chỉ bắt được khi có **xưởng thứ hai kề bên** để
   > phần tràn đâm vào — với ô sai, xưởng 2 bắt đầu ở x = 18.500 < 25.000 ⇒ chồng lấn.
   >
   > ⇒ **Đợt 4a đã thêm ca `★ HAI XƯỞNG KỀ NHAU trên một tầng` vào T4** và kiểm chứng nó biết kêu.
   > Xác minh độc lập của chủ dự án (tiêm lại phép đảo trục): **T4 đỏ ở đúng ca đó**
   > (`tầng 201: machine:8 × machine:21`) **và T5 đỏ**; hoàn nguyên → 623 xanh.
   >
   > **Bài học lớn hơn cả lỗi:** nếu agent làm **đúng chữ của spec** — viết T4 theo mô tả một-xưởng —
   > thì **T4 sẽ mù đúng cái lỗi mà spec giao nó canh, và cổng vẫn báo xanh**. Spec **dự đoán sai chỉ
   > báo nào sẽ đổ** là một lớp lỗi riêng: nó không sai về hành vi mã, nó sai về **thiết bị đo**.
   > ⇒ Xem G10.

4. **Chuyền trong xưởng**: dải song song dọc trục X, cách nhau `buocChuyenMm`, thứ tự theo `production_lines.code` (tất định).
5. **Trạm trên chuyền**: dọc trục X theo `stations.orderIndex` (fallback `code`), bước `buocTramMm`.
6. **Máy trong trạm**: máy đầu ở tâm trạm; máy thứ 2, 3… lệch ±`buocMayTrongTramMm` **theo trục Y mặt bằng**. Kích thước lấy theo thứ tự ưu tiên ở §5.3.

   > **★★★ ĐÍNH CHÍNH 2026-09-06 (session seed) — L-1: bản đầu ghi "theo trục Z" là MÂU THUẪN NỘI TẠI.**
   > §5.2 định nghĩa **Z của DB là ĐỘ CAO**. Trạm `SIM-L1-SPI-ST` có **7 máy** ⇒ làm đúng chữ của
   > bước này sẽ **treo 6 máy lơ lửng tới 4,2 m trên không**. Agent seed phát hiện khi thực thi, đi
   > theo trục Y và **báo lại thay vì tự sửa spec** — xử lý đúng.
   > Đã đo sau seed: `viTriZMm ≠ 0` là **0/42 máy**. Không máy nào bay.
   >
   > **Hai lỗi nhỏ cùng đợt, cũng do thực thi phát hiện:**
   > - **`buocMayTrongTramMm = 1400` an toàn NHỜ DỮ LIỆU, không nhờ tham số.** Cặp kề tệ nhất hiện
   >   cần 1.300 mm (AOI sâu 1100 ↔ WELDER sâu 1500) — vừa lọt. Hai máy sâu 1500 kề nhau sẽ **chồng**.
   >   Cầu chì T4 quét hậu điều kiện trong script sẽ bắt khi dữ liệu đổi; đừng tin con số 1400.
   > - **`stations.orderIndex` là 0-based (0..11)**, không phải 1,2,3… như bước 5 ngầm giả định. Hàm
   >   tính vị trí phải trừ `thuTuNhoNhat` để đúng cho cả hai quy ước.
7. **Hướng máy**: quay quanh trục Y sao cho mặt trước hướng ra lối đi của chuyền (0° hoặc 180° tuỳ dải chẵn/lẻ) → quaternion chuẩn hoá.
8. **Hạ tầng sinh kèm**: tường bao mỗi tầng, sàn, cột lưới 12 m, vạch kẻ lối đi giữa các hàng xưởng, biển tên xưởng. Ghi `twin_vat_the` với `nguon = 'sinh'`.
9. **Bỏ qua & báo cáo**: mọi bản ghi `nguon = 'tay'` đưa vào `boQua`. Trả `canhBao` cho bất thường (xưởng rỗng, chuyền không trạm, máy không thuộc trạm nào).

### 8.3 Tính tất định (bắt buộc)

Không `Math.random()`, không `Date.now()`, không phụ thuộc thứ tự trả về của DB. Cùng đầu vào → cùng đầu ra, **byte-for-byte**. Đây là điều kiện để viết được test T1–T2, và là điều kiện để "Sinh tự động" an toàn khi bấm lần thứ hai.

### 8.4 Chín tính chất phải test (`sinhBoCuc.unit.test.ts`)

| # | Tính chất |
|---|---|
| T1 | **Tất định**: gọi 2 lần cùng đầu vào → kết quả *deep-equal* |
| T2 | **Idempotent**: đưa kết quả lần 1 vào làm `daCoThuCong` rỗng → lần 2 y hệt |
| T3 | **Tôn trọng thủ công**: đánh dấu 5 máy là `tay` → 5 máy đó nằm trong `boQua`, không có trong `datCho` |
| T4 | **Không chồng lấn**: bounding box 2D của 2 máy bất kỳ trong cùng tầng không giao nhau (phép so **chặt**) |
| T5 | **Trong biên**: mọi máy nằm trong bbox của tầng chứa nó |
| T6 | **Quaternion chuẩn hoá**: `x²+y²+z²+w² ≈ 1` (sai số 1e-6) → khớp CHECK constraint của DB |
| T7 | **Đầu vào rỗng** → kết quả rỗng, không ném lỗi |
| T8 | **Dữ liệu khuyết**: xưởng không chuyền, chuyền không trạm, máy không trạm → vào `canhBao`, không làm hỏng phần còn lại |
| T9 | **Quy mô thật**: 2 nhà máy / 2 xưởng / 4 chuyền / 37 trạm / 43 máy chạy < 100 ms |

> T9 dùng **số thật đo được của repo này** (§1.2), không phải số của hệ khác.

---

## 9. Màn Vận hành — `/twin`

Đây là **trung tâm** mà chủ sở hữu yêu cầu: mọi hoạt động quản lý và theo dõi đều xử lý được ở đây.

### 9.1 Bố cục toàn khung

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ SIM-FAC › Toà A › Tầng 1 › Xưởng SIM › Chuyền 1 › AOI-03    ⏱ 12s  [Ops|Trình bày]│
├───────────────┬──────────────────────────────────────────┬─────────────────────┤
│ TỔNG QUAN     │                                          │ NGĂN XỬ LÝ          │
│ Máy       43  │                                          │                     │
│ Chạy      38  │            C A N V A S   3 D             │ AOI-03              │
│ Dừng       2  │            (toàn khung, nền)             │ ● Đang chạy         │
│ Lỗi        1  │                                          │ Health 92 · FPY 98% │
│ Không rõ   2  │                                          │ Cập nhật 12s trước  │
│ ───────────   │                                          │ ─────────────────── │
│ TƯƠI DỮ LIỆU  │                                          │ ⚠ CẢNH BÁO (2)      │
│ ● 38 tươi     │                                          │  [Xác nhận][Ẩn tạm] │
│ ● 3 cũ        │                                          │ ─────────────────── │
│ ▨ 2 không rõ  │                                          │ [+ Tạo phiếu]       │
│ ───────────   │                                          │ [+ Gán kỹ thuật]    │
│ CẢNH BÁO      │                                          │ ─────────────────── │
│ ⚠ AOI-03 P1   │  [Tầng▾][Lớp▾][2D/3D][⤢Fit][⌂]           │ MỞ CHỨC NĂNG        │
│ ⚠ SPI-01 P2   │  Vẽ 41 · 12.880 tri · 60 fps             │ [Sức khoẻ máy →]    │
│               │                                          │ [Phân tích trạm →]  │
│ ── DANH SÁCH ─│                                          │ [Lịch sử kiểm →]    │
│ (bảng máy, tab│                                          │ [Ảnh lỗi AOI →]     │
│  được, đồng bộ│                                          │ [Cockpit đầy đủ →]  │
│  2 chiều 3D)  │                                          │                     │
├───────────────┴──────────────────────────────────────────┴─────────────────────┤
│ WIP theo trạm  ▁▂▃▅▂  │  Nhật ký sự kiện (live)  │  Tải trạm / nghẽn          │
│ ◁ ◀ ⏸ ▶ ▷   ×1 ×5 ×20   ├────────────────────────── 24h ──────────────────┤  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Twin là nơi XỬ LÝ, không chỉ để xem (QĐ-2)

Khảo sát cho thấy **không hệ lớn nào** (AWS TwinMaker, Azure ADT, ThingsBoard) cho phép ack alarm, tạo phiếu công việc, hay gán kỹ thuật viên ngay trên 3D. Nghĩa là **không có tiền lệ để sao chép** — phần này ta tự thiết kế, và phải thiết kế cẩn thận.

Cách giải quyết mâu thuẫn giữa "mọi việc xử lý trên twin" (yêu cầu) và "3D không nên là mặt xử lý alarm" (ASM/ISA-101): **hành động ở ngăn 2D bên phải, ngữ cảnh ở 3D bên trái**. Người dùng click máy trên 3D → ngăn xử lý mở ra ngay cạnh, và mọi thao tác diễn ra trên bề mặt 2D tuân chuẩn.

**Ba nhóm hành động trong `NganXuLy`:**

| Nhóm | Hành động | Điều kiện |
|---|---|---|
| **Xử lý cảnh báo** | Xác nhận (ack) · Ẩn tạm (shelve, có hạn) · Ghi chú | `canEdit` module alarm. Ack/shelve ghi vết kiểm toán |
| **Tạo việc** | Tạo phiếu công việc từ máy này · Gán kỹ thuật viên · Đặt mức ưu tiên | `canCreate` module **`machine_monitoring`**. Phiếu tự điền machineId, trạng thái, alarm liên quan |
| **Mở chức năng** | Điều hướng sang màn chuyên sâu, mang theo đúng id | canView của module đích |

**Ẩn tạm (shelve) là trạng thái hạng nhất**, không phải "xoá khỏi danh sách": theo ISA-18.2, alarm bị shelve phải **hiện rõ cho người vận hành + có vết kiểm toán + có hạn tự bung**. Hợp với hạ tầng WORM/audit đã có của repo.

### 9.3 Bảng điều hướng (đo được từ 11 màn hiện có)

Click vật thể → `NganXuLy` hiện đúng nhóm nút theo loại:

| Chọn | Nút điều hướng |
|---|---|
| **Máy** | `/machine/:id` (cockpit 12 tab) · `/machine-health` · `/history?machineId=` · `/traceability?machineId=` · `/control-plane?machineId=&command=` · `/device-monitor` |
| **Robot** | `/robot/:id` (cockpit 11 tab) · `/robot-control` · `/command-console?robotId=&command=` · `/ir-editor?projectId=` |
| **Trạm** | `/station-analysis/:id` · `/station-escape?stationId=` |
| **Chuyền** | `/wip-dashboard?lineId=` · `/production-dashboard?lineId=` · `/oee-dashboard?lineId=` |
| **Xưởng** | `/production-dashboard?workshopId=` · `/andon?workshopId=` |
| **Nhà máy** | `/corporate-dashboard?factoryId=` · `/reports?factoryId=` |
| **Bất kỳ, có alarm** | `/andon` cuộn tới sự kiện · `/ops-console` · `/safety-workforce` |
| **Bố cục** | `/twin-studio` (sửa mặt bằng) · `/layout/:id` ★ |

> ★ **`/layout/:id` hiện là route mồ côi** — còn sống, có guard, nhưng **không màn nào link tới**. Đưa vào bảng này là cách sửa rẻ nhất; nếu quyết định bỏ thì phải gỡ cả route lẫn guard, không để nửa vời.

### 9.4 Deep-link hai chiều

`duongDanTwin.ts` mã hoá trạng thái vào query string:

```
/twin?pv=tang:1&chon=machine:42&cam=45.2,18.0,-30.5,0.8,120&lop=nhiet,wip&tg=2026-09-06T14:30
      pv  = phạm vi      chon = vật thể chọn      cam = vị trí+hướng camera
      lop = lớp bật      tg   = mốc thời gian (chế độ tua)
```

Mở URL → khôi phục đúng cảnh. Đổi cảnh → `replaceState` (không đẩy history mỗi lần xoay chuột); chỉ `pushState` khi đổi phạm vi hoặc đổi vật thể chọn.

Điều này biến câu "anh xem chỗ này giúp em" thành một đường link — mẫu **saved viewpoint** mà mọi hệ chuyên nghiệp đều có.

### 9.5 Trung thực dữ liệu (NT-3) — điều kiện sống còn

1. **Ba trạng thái tươi**, hiện ở panel trái *và* trên chính vật thể:

| Tuổi dữ liệu | Hiển thị |
|---|---|
| < 60 giây | Màu trạng thái bình thường |
| 60 giây – 5 phút | Nhạt 40% + badge đồng hồ |
| > 5 phút, hoặc chưa từng có | **Xám gạch chéo, nhãn "Không rõ"** |

2. **Chỉ báo độ tươi luôn hiện**: "Cập nhật 12 giây trước", đổi sang đỏ khi > 60 giây. Giá trị này là **`max(timestamp)` của dữ liệu nền**, KHÔNG phải thời điểm render trang.

3. **Đối soát mỗi lần nạp cảnh**: so số máy `isActive` trong DB với số node trong scene. Lệch → banner vàng *"7 máy chưa được đặt vào mặt bằng — [Mở Xưởng dựng]"*. Đây là thuốc chống *model drift*: layout thật đổi mà twin không đổi thì banner sẽ kêu.

4. **Nhãn đời bố cục**: *"Bố cục cập nhật 2026-09-06 · 43 kích thước chưa đo"* — model cũ được đối xử hiển thị y như dữ liệu cũ.

5. **Đếm rỗng khác đếm bằng 0**: chưa đo hiện `—`, không hiện `0`.

6. **Giữ `isScopeEmpty`** (`CommandCenter.tsx:1468`): phân biệt "0 cảnh báo vì yên ổn" với "0 vì tài khoản không được gán nhà máy".

7. **Nhà máy/xưởng/máy `isActive = false`**: vẽ **mờ 35% + không màu trạng thái**, kèm nhãn "Ngừng khai thác". Tầng hình học **không lọc** `isActive` (lọc thì mặt bằng thiếu mà không nói vì sao); bộ chọn phạm vi mặc định chỉ hiện phần đang khai thác, có ô "☐ Hiện cả phần ngừng khai thác".

### 9.6 Nhãn — declutter

Đo được: **300 nhãn CSS2D đã lag**; `troika-three-text` tốn **1 draw call mỗi nhãn**. Không công nghệ nào cứu — phải **cull**.

Chiến lược trong `locNhan.ts`:
1. **Mặc định KHÔNG hiện nhãn.** Chỉ hiện cho: đang hover, đang chọn, **đang bất thường**, và top-N gần camera.
2. LOD nhãn: xa → chấm màu (instanced sprite); trung → icon; gần → chữ.
3. Declutter screen-space: `Vector3.project()` các ứng viên → sort theo khoảng cách → greedy loại nhãn có bbox giao nhau → **cap cứng 30 nhãn DOM**.
4. Occlusion: chỉ raycast cho ứng viên đã lọc, không toàn scene.
5. Nhãn là DOM thật → Playwright và trình đọc màn hình đọc được.

> ### QUYẾT ĐỊNH 2026-09-06, sau Đợt 1 — nhãn CỠ CỐ ĐỊNH, không co theo khoảng cách
>
> `FactoryScene3D.tsx:265` cũ dùng `<Html distanceFactor={14}>`: chữ **co nhỏ dần khi camera lùi
> ra**, tới mức **vô hình khi zoom xa**. Kit Đợt 1 vẽ cỡ cố định trên màn hình (`LopNhan.tsx:174`,
> `fontSize: 12`). Đây là **thay đổi hành vi nhìn thấy được**, và Đợt 1 báo lại thay vì tự nhận là
> cải tiến — đúng cách.
>
> **Quyết định: giữ cỡ cố định.** Nhãn co theo khoảng cách mâu thuẫn với §10.3 luật 1 — *badge alarm
> vẽ ở **không gian màn hình**, không ở không gian thế giới, để phối cảnh không thu nhỏ badge P1
> thành không đọc nổi*. Nhãn máy chịu cùng ràng buộc: một máy đang lỗi ở xa mà nhãn nhỏ tới mức vô
> hình **chính là** chế độ hỏng mà luật đó sinh ra để phòng.
>
> Cỡ cố định cộng cap 30 nhãn (§4) là cặp đúng: **chọn ÍT nhãn để hiện, nhưng nhãn nào hiện thì đọc
> được**. Cặp sai là ngược lại — hiện nhiều nhãn nhưng nhãn nào cũng không đọc nổi.

### 9.7 Chế độ trình bày

Toggle `Ops | Trình bày`: ẩn toàn bộ panel, camera bay chậm theo tuyến định sẵn, chỉ giữ KPI lớn và cảnh báo. Không phải sản phẩm thứ hai — chỉ là một cờ `cheDo` trong cùng component. Tự thoát khi có tương tác chuột.

### 9.8 Tua lại thời gian

Dải dưới có scrubber `◁ ◀ ⏸ ▶ ▷` + tốc độ ×1/×5/×20 + thanh kéo 24 h qua.

**Nguyên tắc bắt buộc: CÙNG MỘT state store cho live và replay**, chỉ đổi nguồn (socket `twin:update` → API lịch sử). Tách hai code path thì replay sẽ luôn lệch.

Nguồn lịch sử: `machine_status_logs`, `station_dwell_time`, `wip_tracking`, `andon_events`.

> ### ★★★ ĐÍNH CHÍNH 2026-09-07 (Đợt 6) — "3 bảng 0 dòng" là SAI, xây theo nó sẽ LỘN NGƯỢC NT-3
>
> Bản đầu ghi `oee_metrics`, `machine_heartbeats`, `ot_telemetry` **0 dòng**. Đo lại trên DB thật:
>
> | Bảng | Spec ghi | ĐO ĐƯỢC | Hàng mới nhất |
> |---|---|---|---|
> | `oee_metrics` | 0 | **897** | 2026-07-17 (~52 ngày cũ) |
> | `machine_heartbeats` | 0 | **108** | 2026-07-17 (~52 ngày cũ) |
> | `ot_telemetry` | 0 | **24.458.273** | **2026-09-06 — TƯƠI** |
>
> Làm theo bản cũ sẽ dán *"chưa có dữ liệu"* lên **24,4 triệu hàng tươi** — NT-3 bị **lộn ngược**.
>
> ⇒ **Phân biệt thật là CŨ, không phải RỖNG.** `trungThucDuLieu.ts` đã cài đúng thang ba mức tuổi của
> §9.5; bảng cũ **tự rơi** vào `khong_ro` vì lý do đo được, không vì một danh sách hardcode sẽ mục.
>
> **★ Ca NT-3 đang SỐNG trong dữ liệu thật — không cần dựng:**
> ```
> 3 máy 'running'  → heartbeat mới nhất 2026-07-17   (im lặng 52 NGÀY)
> 40 máy 'stopped' → heartbeat 2026-09-03
> ```
> Renderer ngây thơ vẽ **3 máy XANH trên một nhà máy đã chết**. Đây là **ca dương có sẵn** để nghiệm
> thu NT-3 — dùng nó, đừng dựng ca giả.

### 9.9 Khả năng truy cập và chế độ 2D

**Bắt buộc, không phải tuỳ chọn.** Canvas 3D vô hình với trình đọc màn hình.

- **Danh sách máy bên trái là DOM thật**, tab-navigable, có focus ring rõ, và **mọi hành động làm được từ đó** — chọn máy, xem KPI, ack alarm, mở chi tiết. Selection 3D ↔ focus DOM đồng bộ hai chiều. Điều này giải quyết cả a11y lẫn mẫu "list và 3D là hai mặt của một selection".
- **Toggle `2D | 3D`** ở thanh dưới. Bản 2D render từ **chính dữ liệu đó** — `FactoryScene2D.tsx` (361 dòng) đã có sẵn cùng chữ ký props.
- **2D cũng là fallback tự động** khi WebGL không khả dụng hoặc context bị mất. Không hiện "trình duyệt không hỗ trợ".
- `sr-only` tóm tắt trạng thái + `role="img"` aria-label cho canvas — tái dùng khuôn `CommandCenter.tsx:769-779`.

---

## 10. Ngôn ngữ thị giác

### 10.1 ISA-101: xám là mặc định, màu chỉ dành cho bất thường

Đây là điểm đa số twin 3D làm sai. Nguyên tắc: **màu sáng dùng để thu hút chú ý vào tình huống bất thường, không phải để thể hiện tình trạng bình thường.**

Cụ thể:
- Sàn, tường, cột, băng tải, kệ: **xám trung tính**, phân biệt nhau bằng **độ sáng và độ dày nét**, không bằng sắc.
- Máy **đang chạy bình thường**: xám nhạt hơi ngả xanh — *không* xanh lá rực.
- Chỉ máy **bất thường** mới có màu bão hoà.
- Độ bão hoà = mức nghiêm trọng: cảnh báo sớm dùng màu nhạt, chỉ mức cao mới full saturation.
- **Không animation lúc bình thường.** Animation chỉ để làm nổi bật tình huống bất thường.
- **Không đổ bóng/bevel/specular** trên hình học máy.

> Hollifield phản biện lập luận "nhưng nó không giống nhà máy!" bằng một câu đáng nhớ: *"Bảng đồng hồ ô tô của bạn có nên trông giống động cơ không?"*

### 10.2 Một nguồn sự thật cho màu trạng thái

Hiện có **ba** hệ lệch nhau:
- Server hex: `server/services/digitalTwinService.ts:6` (`TWIN_STATUS_COLORS`)
- Token oklch: `client/src/index.css`
- Ánh xạ client: `client/src/lib/trangThai.tsx`

**Quyết định:** `client/src/components/twin3d/mauTrangThai.ts` là nguồn duy nhất cho cảnh 3D, phân giải từ token oklch để **tự đổi theo theme sáng/tối**. Server ngừng quyết định màu; `digitalTwinService.colorForStatus` giữ lại cho tương thích ngược nhưng Twin không đọc nữa.

| Trạng thái | Vai trò 3D | Token |
|---|---|---|
| `running` | xám nhạt ngả xanh, **không nổi bật** | `--neutral-strong` pha `--primary` 15% |
| `warming_up`, `changeover` | xanh dương nhạt | `--info-subtle` |
| `starved`, `blocked` | vàng/cam theo mức | `--marginal` → `--warning` |
| `stopped` | xám đậm | `--neutral-subtle` |
| `maintenance` | xanh dương + sọc chéo | `--info` + hoạ tiết |
| `error` | **đỏ bão hoà** (duy nhất) | `--destructive` |
| **`khong_ro`** (mới) | **xám gạch chéo** | `--muted` + hoạ tiết |
| **`ngung_khai_thac`** (mới) | mờ 35%, không màu trạng thái | `--muted` opacity 0.35 |

Quy ước alarm: **Đỏ = critical · Vàng = warning · Xanh dương = information.** Bảng màu **≤ 7 mã** (ASM Guideline 6.1 — giới hạn trí nhớ ngắn hạn).

**Cấm hardcode hex trong component 3D.** Test `mauTrangThai.unit.test.ts` kiểm: mọi giá trị của `operationStatusEnum` đều có ánh xạ; `khong_ro` khác mọi màu "khoẻ"; tương phản đủ trên nền cả hai theme.

### 10.3 Badge alarm — ba luật cứng

1. **Vẽ ở không gian màn hình**, không ở không gian thế giới ⇒ phối cảnh không thể thu nhỏ badge P1 thành không đọc nổi.
2. **Mã hoá dư thừa: hình dạng + màu + chữ.** Màu đơn thuần không bao giờ là dấu hiệu duy nhất.
3. **Góc camera không bao giờ được che một alarm đang hoạt động.** Alarm bị khuất sau hình học phải nổi lên rìa màn hình kèm mũi tên chỉ hướng.

Đây chính là chế độ hỏng mà quy tắc "No 3D" của ASM sinh ra để phòng. Ta giữ 3D nhưng phải trả đúng cái giá này.

### 10.4 Hoà nhập design system

- Bọc bằng `PageShell maxWidth="full"` + `PageHeader` + `PageSection`.
- KPI dùng `ds/StatTile` (có sẵn `isError`, `emptyHint`) — **không** chép tay `<Card>`.
- Bảng dùng `ds/DataTable` (bắt buộc `isLoading`/`isError`, có phân trang).
- Bộ lọc dùng `ds/FilterBar` + `useFilterBar()` (tự đồng bộ query string — hợp với deep-link).
- Token vai trò trong `index.css`: `text-metric`, `--space-gutter`, `--radius-lg`, `--shadow-panel`.
- Dark-first. 3D phải đúng ở **cả hai** theme — nền cảnh lấy từ `--background`, không hardcode.

---


---

## 10A. Dựng nhà xưởng — hai con đường

Yêu cầu chủ sở hữu (2026-09-06): cho phép **dựng nhà xưởng từ bản vẽ kỹ thuật** (nhập CAD/STEP/GLB, chỉnh sửa được sau khi nhập) **hoặc** **điền kích thước dài × rộng × cao từng mặt sàn** rồi dựng các tầng.

Hai con đường **không loại trừ nhau** — chúng ghi vào cùng `twin_toa_nha` / `twin_tang` / `twin_vat_the`, nên nhập CAD xong vẫn sửa tay được, và ngược lại.

### 10A.0 Vì sao cần cả hai — bằng chứng đo được

`factories.floorWidthM = 1500` và `floorDepthM = 1200` trên `SIM-FAC`. Đọc đúng đơn vị thì đó là **1,5 km × 1,2 km** — vô lý cho một xưởng lắp ráp. Gần như chắc chắn ai đó nhập số pixel vào ô mét. Ba nhà máy còn lại để `NULL`.

Nghĩa là: **kích thước sàn hiện tại không dùng được**, và đây chính là lỗ hổng mà con đường B lấp. Con đường A (nhập bản vẽ) lấp nó bằng cách khác — lấy hình học thật từ file CAD.

> **Luật bắt buộc:** giá trị `floorWidthM/floorDepthM` cũ **không được di trú thẳng** vào `twin_tang`. Script di trú phải bỏ qua chúng và để `twin_tang` dùng mặc định, kèm badge "chưa đo" — vì di trú số rác sẽ tạo ra một mặt sàn 1,5 km mà không ai hiểu tại sao.

### 10A.1 Con đường A — nhập từ bản vẽ kỹ thuật

**Định dạng nhận:** `.glb` / `.gltf` (mesh sẵn), `.step` / `.stp` / `.iges` / `.igs` (CAD đặc), `.dxf` / `.dwg` **không nhận ở v1** (cần thư viện riêng, xem §16).

**Công cụ:** `occt-import-js@0.0.23` — đã có sẵn trong repo, kèm `occt-import-js-worker.js` và `occt-import-js.wasm`, nên **chuyển đổi chạy trên trình duyệt trong worker**, không cần dịch vụ máy chủ.

```
Chọn file bản vẽ (≤ 60 MB)
  → Worker occt-import-js chuyển STEP/IGES → mesh (không chặn giao diện)
     hoặc GLTFLoader nạp thẳng .glb/.gltf
  → Đo: số tam giác, số node, bbox tổng
  → HỘP THOẠI HIỆU CHỈNH (bắt buộc, không bỏ qua được):
       • Đơn vị nguồn:  [mm ▾] m · cm · inch
       • Trục lên:      [Z ▾] Y            ← CAD thường Z-up, glTF Y-up
       • Xoay quanh trục lên: [0°]
       • Điểm gốc:      [góc bbox ▾] tâm bbox · gốc file
       • Xem trước kèm THƯỚC TỈ LỆ và một hình người cao 1,7 m để đối chiếu
  → Người dùng xác nhận kích thước đọc được:
       "Bao ngoài: 84,2 m × 51,6 m × 9,4 m — đúng không?"
  → Chọn cách dùng:
       (a) Làm VỎ NHÀ (một `twin_vat_the` loai='nhom', giữ nguyên hình)
       (b) TÁCH THÀNH TẦNG — xem 10A.3
  → Ghi `equipment_3d_models` (sourceFormat='step'|'gltf') + `twin_vat_the`
```

**Vì sao hộp thoại hiệu chỉnh là bắt buộc:** file CAD **không tự khai đơn vị một cách đáng tin**. Nhập sai đơn vị cho ra nhà xưởng lớn gấp 1.000 lần hoặc nhỏ bằng hạt gạo, và người dùng sẽ không hiểu vì sao. Thước tỉ lệ + hình người 1,7 m làm sai lệch đơn vị **lộ ra ngay bằng mắt** — rẻ hơn mọi cách kiểm tự động.

**Chỉnh sửa sau khi nhập** (yêu cầu rõ của chủ sở hữu):
- Vỏ nhà nhập vào là một `twin_vat_the` bình thường → **gizmo di chuyển/xoay/co giãn áp dụng được ngay**, cùng bộ 12 công cụ căn chỉnh ở §7.2.
- Cây phân cấp hiện **cây node của file gốc** (giữ được nhờ `--no-join --no-flatten`, §7.4) → ẩn/hiện/xoá từng bộ phận (mái, tường, cột) độc lập.
- Nút **"Đặt lại tỉ lệ"** mở lại hộp thoại hiệu chỉnh nếu phát hiện đơn vị sai sau khi đã nhập.
- Nút **"Thay bản vẽ"** giữ nguyên mọi máy đã đặt, chỉ thay vỏ.

**Ngưỡng chặn:** > 2.000.000 tam giác hoặc > 60 MB → chặn, hướng dẫn giảm lưới. Vỏ nhà là hình học **tĩnh**, sẽ được merge thành 1 mesh + baked vertex color (§4), nên số tam giác cao ít hại hơn máy móc — nhưng vẫn phải có trần.

### 10A.2 Con đường B — điền kích thước từng mặt sàn

Đây là con đường **mặc định** khi không có bản vẽ, và là con đường nhanh nhất để có mặt bằng dùng được.

**Trình tự ba bước trong màn Thiết kế:**

```
Bước 1 — Toà nhà
  Mã       [TN-A          ]
  Tên      [Toà A         ]
  Kích thước bao ngoài (m)   Dài [84.0]  Rộng [52.0]  Cao [12.0]
  Vị trí trong khuôn viên (m) X [0]  Y [0]

Bước 2 — Các tầng    [+ Thêm tầng]
  ┌────┬──────────────┬─────────┬────────┬──────────┬───────────┐
  │ Số │ Tên          │ Dài (m) │ Rộng   │ Cao thông│ Cao độ    │
  ├────┼──────────────┼─────────┼────────┼──────────┼───────────┤
  │ 1  │ Tầng trệt    │  84.0   │  52.0  │   6.0    │    0.0    │
  │ 2  │ Tầng 2       │  84.0   │  52.0  │   4.5    │    6.3    │
  └────┴──────────────┴─────────┴────────┴──────────┴───────────┘
  ☑ Các tầng cùng kích thước với toà nhà
  ☐ Tự tính cao độ tầng trên = cao độ + cao thông thuỷ + 0,3 m sàn

Bước 3 — Xem trước 3D + [Tạo]
```

**Quy tắc thiết kế:**
- **Nhập bằng MÉT, lưu bằng MILIMÉT.** Người dùng nghĩ bằng mét ("xưởng dài 84 mét"); DB lưu mm để không mất độ chính xác khi đặt máy. Quy đổi trong `heToaDo.ts`, một chỗ duy nhất.
- **Cao độ tầng trên tự tính** nhưng **sửa đè được** — mặc định `caoDo(n+1) = caoDo(n) + caoThongThuy(n) + 300mm`.
- Tầng có thể **nhỏ hơn** toà nhà (tầng lửng, tầng kỹ thuật) — bỏ tích "cùng kích thước".
- Mỗi tầng có **ảnh nền mặt bằng riêng** + công cụ **Đặt tỉ lệ** (§7.3) — hai điểm click + khoảng cách thật.
- Mọi giá trị nhập tay đặt `nguon = 'tay'` ⇒ **sinh tự động không đè**.

**Sinh tường bao tự động:** tạo tầng xong, sinh 4 `twin_vat_the` loai=`tuong` theo chu vi, dày 200 mm, `nguon='sinh'` — để tầng không phải một mặt phẳng trơ. Xoá được, sửa được.

### 10A.3 Tách bản vẽ thành tầng (cầu nối A → B)

Khi nhập bản vẽ nhiều tầng, hộp thoại đề nghị tách theo cao độ:

```
Phát hiện 3 cụm hình học theo trục cao:
  [☑]  0,0 – 6,2 m    → Tầng 1    (12.408 tam giác)
  [☑]  6,3 – 10,8 m   → Tầng 2    ( 9.117 tam giác)
  [☐] 10,9 – 12,4 m   → Mái       ( 2.043 tam giác)   ← bỏ tích = gộp vào tầng dưới
                                             [Tách thành tầng]
```

Thuật toán: chiếu bbox mọi node lên trục cao, tìm khoảng trống > 0,5 m làm ranh giới. Đây là **gợi ý**, người dùng sửa được ranh giới trước khi áp dụng. Module thuần `tachTangTuHinhHoc.ts`, có test.

### 10A.4 Bảng dữ liệu bổ sung

`twin_tang` thêm ba cột (gộp vào migration `0350`):

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `daiMm` | `numeric(14,3)` | Dài mặt sàn (trục X) |
| `rongMm` | `numeric(14,3)` | Rộng mặt sàn (trục Y) |
| `nguonHinhHoc` | `varchar(16)` | `'nhap_tay'` \| `'ban_ve'` \| `'sinh'` — biết mặt sàn từ đâu ra |

`twin_toa_nha` thêm:

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `modelVoId` | `integer REFERENCES equipment_3d_models(id)` | Vỏ nhà nhập từ bản vẽ, NULL = dựng bằng khối |
| `donViNguon` | `varchar(8)` | Đơn vị của file gốc, để hiệu chỉnh lại |

---

## 10B. Hình học thiết bị — mặc định theo chủng loại, thay được bằng file

Yêu cầu chủ sở hữu: **hiển thị mặc định theo vài chủng loại máy thông thường**, và **cho phép nhập file 3D nhẹ để thay thế mặc định**.

### 10B.1 Bảy hình khối mặc định phủ 24 loại máy

`machineTypeEnum` có **24 giá trị**, nhưng không cần 25 hình khối. Vẽ 7 hình đủ để phân biệt bằng mắt ở khoảng cách vận hành, và mỗi hình ≈ 40–60 tam giác.

| Hình khối | Loại máy dùng nó | Đặc điểm nhận dạng |
|---|---|---|
| **Buồng kiểm quang** | `AOI`, `AVI`, `SPI`, `AXI` | Hộp + nắp buồng camera nhô lên + cửa băng tải hai đầu |
| **Bàn test** | `ICT`, `FCT`, `ICT_FUNC`, `CMM`, `ROBOT_TEST` | Hộp thấp + mặt bàn + trụ đồ gá |
| **Máy gắp đặt** | `MOUNTER`, `FEEDER` | Hộp dài + dàn feeder răng lược một bên |
| **Lò / buồng nhiệt** | `REFLOW`, `WAVE_SOLDER` | Hộp rất dài + ống khói + băng tải xuyên tâm |
| **Máy in / phun** | `STENCIL_PRINTER`, `DISPENSING`, `SCREWDRIVE` | Hộp + khung in phía trên + ray ngang |
| **Cánh tay robot** | `ROBOT`, `PALLETIZER`, `WELDER` | Đế trụ + 3 khúc khớp (dùng lại `ArticulatedRobot` khi có dữ liệu khớp) |
| **Trạm chung** | `ASSEMBLY`, `PACKAGING`, `AUTOMATION`, còn lại | Hộp bo góc + bảng điều khiển nghiêng |

Ánh xạ trong module thuần `hinhKhoiMay.ts`:
```ts
export function hinhKhoiCho(loaiMay: string): KhoiKey   // 24 loại → 7 khối
```
Test `hinhKhoiMay.unit.test.ts`: **mọi giá trị của `machineTypeEnum` phải ánh xạ được**, không giá trị nào rơi vào `undefined` — đây là bánh cóc chống việc thêm loại máy mới mà quên cập nhật.

> **ĐO ĐƯỢC 2026-09-06 (cổng QA Đợt 2, đo bằng cách CHẠY `hinhHocKhoi` chứ không đọc mã):**
> cả **7/7 khối đều đúng 60 tam giác** (5 hộp × 12), tức **chạm sát trần trên của khoảng
> 40–60, dư địa bằng 0**. Thêm dù chỉ **một** hộp con vào bất kỳ khối nào sẽ vượt 60 và test
> đỏ ngay. Đây là hành vi đúng của lưới, nhưng đợt sau phải biết trước: muốn thêm chi tiết
> hình học thì phải **bớt chỗ khác**, hoặc nâng trần có chủ đích kèm lý do.

**Mỗi khối tôn trọng kích thước thật** từ `twin_dat_cho.rongMm/caoMm/sauMm` (§5.3) — hình dạng cố định, tỉ lệ co giãn theo số đo. Máy AOI 1400 mm và máy AOI 2200 mm nhìn khác nhau ngay.

**Chỉ báo hướng:** mỗi khối có **một vạch màu ở mặt trước** (mặt vào phôi). Không có nó thì máy xoay 180° trông y hệt, và người dùng không phát hiện hướng sai.

### 10B.2 Thay mặc định bằng file 3D

Ba cấp gán, độ ưu tiên từ hẹp đến rộng — tận dụng đúng cấu trúc `equipment_3d_models` đã có:

```
1. machineId       → model riêng cho ĐÚNG máy này
2. equipmentClass  → model cho cả CHỦNG LOẠI (mọi máy AOI dùng chung)
3. (không có)      → khối thủ tục theo 10B.1
```

Cấp 2 là cấp **đáng dùng nhất**: nhập một file cho `AOI` là 14 máy AOI đổi hình cùng lúc. UI thư viện asset phải làm rõ điều này bằng nút riêng:

```
┌──────────────────────────────────────────────┐
│  aoi-machine.glb    12.400 tam giác  1,8 MB  │
│  [Gán cho máy này]  [Gán cho MỌI máy AOI ▾]  │
└──────────────────────────────────────────────┘
```

**Định dạng nhận:** `.glb`, `.gltf` (nhẹ, khuyến nghị) · `.step`, `.stp`, `.iges`, `.igs` (qua `occt-import-js`) · **`.svg` KHÔNG nhận** — SVG là ảnh 2D, không có chiều sâu; nếu cần biểu tượng phẳng thì đó là việc của bản 2D, không phải mô hình 3D. *(Chủ sở hữu có nhắc `.svg`; tôi ghi rõ lý do từ chối ở đây thay vì im lặng bỏ qua.)*

**Ngưỡng cho model máy** (chặt hơn vỏ nhà, vì máy nhân lên 43 lần và nằm gần camera):

| Số tam giác | Xử lý |
|---|---|
| ≤ 50.000 | Nhận, không cảnh báo |
| 50.001 – 150.000 | Nhận, cảnh báo, gợi ý nén |
| > 150.000 hoặc > 15 MB | **Chặn** |

> ### ⚠️ CẢNH BÁO 2026-09-06, do Đợt 3 tự khai — `donViDeNghi` sai với vật thể NHỎ
>
> Hàm gợi ý đơn vị (`docBanVe.ts`) **giả định vật thể cỡ nhà xưởng**. Đo được trên một khối lập
> phương thật 10 mm (`Cube 10x10.stp`): nó gợi ý đơn vị **`m`** và **tự khai là "chắc chắn"**, nên
> cảnh báo *"không suy được đơn vị"* **sẽ không hiện**.
>
> Vô hại ở §10A vì hộp thoại vẫn **bắt buộc xác nhận bằng mắt** (thước tỉ lệ + hình người 1,7 m) —
> đó chính là lý do hộp thoại đó tồn tại. **Nhưng nguy hiểm nếu tái dùng module này cho model MÁY**
> (§10B.2), vì máy nhỏ hơn nhà xưởng vài bậc độ lớn. Trước khi Đợt sau dùng lại: hoặc siết ngưỡng
> tự tin theo cỡ vật thể, hoặc **bỏ hẳn cờ "chắc chắn"** và luôn buộc người dùng xác nhận.
>
> Đây là **lời tự khai của agent viết mã, không ai hỏi** — loại phát hiện đắt nhất, vì nó nằm ở
> chỗ không phép đo nào đang chĩa vào.

**Hiệu chỉnh khi nhập** — cùng hộp thoại của 10A.1 (đơn vị, trục lên, xoay, gốc), cộng thêm:
- **So sánh với kích thước khai báo**: nếu bbox file lệch > 30 % so với `twin_dat_cho`, hiện cảnh báo *"Model cao 2,9 m nhưng máy khai 1,9 m — dùng kích thước nào?"* (lệch 52,6 %; ví dụ cũ 2,4 m chỉ lệch 26,3 % nên **không** vượt ngưỡng 30 % — đã sửa sau khi Đợt 2 khoá con số bằng test) với hai nút `[Theo model]` `[Giữ khai báo, co model]`.
- **Ghi `bounds`** vào `equipment_3d_models` (hiện **NULL ở 5/5 hàng**) — lấp đúng lỗ hổng ở §1.3.

### 10B.3 LOD — bốn bậc

43 máy là ít, nhưng model nhập có thể nặng. Bậc chi tiết trong `mucChiTiet.ts`:

| Bậc | Điều kiện | Vẽ gì |
|---|---|---|
| L0 | ≤ 8 máy gần camera nhất **và** khoảng cách < 25 m | GLB thật, đầy đủ |
| L1 | < 60 m | Khối thủ tục 7 hình (§10B.1) |
| L2 | < 150 m | Hộp đơn (12 tam giác) |
| L3 | ≥ 150 m hoặc ngoài khung nhìn | Không vẽ |

Ngân sách cứng: **tối đa 8 GLB nạp đồng thời**. Vượt thì thay thế theo LRU. Điều này giữ ngân sách §4 kể cả khi người dùng nhập 43 model nặng.

---

## 10C. Bố cục và xem theo Line sản xuất

Yêu cầu chủ sở hữu: **layout theo Line, và view 3D riêng cho từng Line** thay vì luôn xem cả tầng.

### 10C.0 Dữ liệu Line đo được

| Line | Mã | Xưởng | Trạm | Máy |
|---|---|---|---|---|
| 1 | `SIM-L1` | Xưởng lắp ráp ảo | 12 | 18 |
| 2 | `SIM-L2` | Xưởng lắp ráp ảo | 12 | 12 |
| 3 | `SIM-L3` | Xưởng lắp ráp ảo | 12 | 12 |
| 11 | `T12-SHOT-LA-…` | Task 12 anh chup | 1 | 1 |

Hai dữ kiện quyết định thiết kế:
- **`orderIndex` đầy đủ 37/37 trạm** → thứ tự dòng chảy dọc Line **suy ra được chính xác**, không cần ai nhập tay.
- **`production_lines` không có cột hình học nào** → Line **không tự có vị trí**; hình học của nó là **bao lồi các trạm thuộc nó**. Đây là quyết định kiến trúc, không phải thiếu sót.

### 10C.1 Line là phạm vi, không phải vật thể

**QĐ-12:** Line **không** có hàng riêng trong `twin_dat_cho` cho hình học. Nó là **bộ lọc phạm vi** — hình học suy ra từ trạm/máy thuộc nó:

```ts
// module thuần phamViLine.ts
export function hinhHocLine(tram: ViTri[], may: ViTri[]): {
  bbox: BBox;              // bao lồi mọi trạm+máy của line
  truc: 'X' | 'Y';         // trục chính, từ phương sai lớn hơn
  huong: 1 | -1;           // chiều dòng chảy, từ orderIndex
  diemDuongTam: Vec3[];    // đường tâm, nối tâm các trạm theo orderIndex
}
```

**Vì sao không cho Line vị trí riêng:** nếu Line có toạ độ riêng, nó sẽ **lệch** khỏi các trạm khi ai đó kéo trạm đi — sinh ra nguồn sự thật thứ hai cho cùng một thứ. Suy ra thì không bao giờ lệch.

Ngoại lệ có chủ ý: `twin_dat_cho` **vẫn nhận** `loaiThucThe='line'` để lưu **nhãn và màu dải Line** (`mau`, `hienThi`, `daKhoa`) — nhưng các cột vị trí bị bỏ qua khi đọc. Ghi rõ trong docblock để không ai "sửa" thành dùng vị trí.

### 10C.2 Chế độ xem theo Line

Bộ chọn phạm vi có **bốn cấp**, chọn cấp nào thì camera và bộ lọc đổi theo:

| Phạm vi | Camera | Hiện | Làm mờ / ẩn |
|---|---|---|---|
| **Tập đoàn** | Ortho nghiêng, cao ~400 m | Khối các nhà máy + tên + đèn cảnh báo tổng | Mọi thứ bên trong |
| **Nhà máy** | Orbit quanh khuôn viên | Các toà nhà, cắt mái | Chi tiết máy |
| **Tầng** | Top-down ortho nghiêng nhẹ | Xưởng, chuyền, trạm, máy dạng khối | Nhãn máy (trừ máy lỗi) |
| **Line** ★ | **Orbit dọc trục chính của Line** | Trạm + máy **có nhãn đầy đủ** + mũi tên dòng chảy + WIP từng trạm | Line khác **mờ 12 %**, tường/cột mờ 40 % |
| **Máy** | Orbit gần, ≤ 8 m | GLB chi tiết + nhãn đầy đủ + ngăn xử lý | — |

Chuyển cấp bằng tween 500 ms. Breadcrumb (§9.1) là đường đi lên; click node trong cây là đường đi xuống.

### 10C.3 Chế độ xem Line có gì riêng

Ba thứ chỉ xuất hiện ở phạm vi Line, vì chúng vô nghĩa ở cấp cao hơn:

**1. Đường dòng chảy có hướng.** Nối tâm các trạm theo `orderIndex`, vẽ mũi tên chạy. Đây là thứ duy nhất trên toàn Twin được phép **animation lúc bình thường** — vì hướng dòng chảy là thông tin, không phải trang trí. Tốc độ mũi tên **tỉ lệ với nhịp thật** (`commandLog.avgDurations`), không phải hằng số; đứng yên khi Line dừng.

**2. Ống WIP theo trạm.** Mỗi trạm có một cột đứng cạnh, cao theo số WIP đang chờ. Trạm nghẽn → cột cao + màu cảnh báo. Đây là cách đọc nút thắt bằng mắt trong 2 giây.

**3. Dải Line theo băng ngang.** Dưới canvas, một dải 2D thu nhỏ toàn Line: 12 ô trạm nối nhau, mỗi ô có màu trạng thái + số WIP + nhịp. **Đồng bộ hai chiều với 3D** — click ô là camera bay tới trạm.

> Dải 2D này thực thi luật §11.5: *mọi lớp phủ màu trên 3D phải có bản 2D song song*. Màu không cho phép so sánh chính xác "trạm 5 tải hơn trạm 4 bao nhiêu".

### 10C.4 Bố cục theo Line trong màn Thiết kế

Ở màn Thiết kế, chọn phạm vi Line mở thêm ba công cụ chuyên dụng — chúng chính là **array + align (§7.2) đặt vào ngữ cảnh Line**, không phải cơ chế mới:

| Công cụ | Việc |
|---|---|
| **Rải trạm dọc Line** | Nhập bước (mặc định 2.500 mm) → xếp lại toàn bộ trạm theo `orderIndex` trên một đường thẳng. Máy trong trạm đi theo |
| **Nắn thẳng Line** | Fit đường thẳng bình phương tối thiểu qua các trạm, chiếu mọi trạm lên đó. Sửa Line bị lệch sau nhiều lần kéo tay |
| **Đổi hướng Line** | Xoay cả Line 90°/180° quanh tâm, giữ nguyên thứ tự trạm và hướng máy tương đối |

Cả ba là **một lệnh undo được**, không phải chuỗi thao tác — dùng lại `lichSuThaoTac.ts` với `{op:'raiTram', targets:[...], truoc, sau}`.

### 10C.5 Deep-link và điều hướng

Phạm vi Line vào deep-link như mọi phạm vi khác:
```
/twin?pv=line:1&chon=station:5&lop=wip,dongChay
```

Nút điều hướng ở `NganXuLy` khi chọn Line (đã có trong §9.3): `/wip-dashboard?lineId=` · `/production-dashboard?lineId=` · `/oee-dashboard?lineId=`.

### 10C.6 Xem toàn tập đoàn

Phạm vi cao nhất, đáp ứng yêu cầu "xem toàn bộ nhà máy trong tập đoàn":

- Nối qua `factories.corporateCode` → `corporates.code` (**varchar, không phải id** — đo được ở `hierarchy.ts:78`).
- Mỗi nhà máy là **một khối** đặt theo `twin_toa_nha` của nó; nhà máy chưa có toà nhà → khối giữ chỗ mờ + nhãn "chưa dựng".
- Bố trí giữa các nhà máy: **lưới vuông tất định** `ceil(sqrt(n))` cột, bước 400 m, thứ tự theo `factories.code`. Chỉnh tay được, `nguon='tay'` thì không đè.
- Hiện: tên, số máy, số cảnh báo đang mở, đèn trạng thái tổng.
- Click nhà máy → tụt xuống phạm vi Nhà máy.

**Hiện trạng cần nói thẳng:** DB có **1 tập đoàn, 1 nhà máy có dữ liệu**. View tập đoàn đúng về cấu trúc nhưng hiện chỉ hiển thị một khối. Nó **không phải tính năng chết** — nó là chỗ chứa sẵn cho nhà máy thứ hai. Nhưng đừng nghiệm thu nó bằng ảnh chụp trông "hoành tráng"; nghiệm thu bằng: tạo nhà máy thứ hai trong DB test → phải hiện đủ hai khối.
## 11. Sổ kiểm 62 tính năng — cổng ra cho việc xoá màn cũ

QĐ-1 là phương án **khối lượng lớn nhất**: 62 tính năng đang chạy phải được viết lại trước khi xoá màn cũ. Rủi ro lớn nhất không phải kỹ thuật mà là **quên mất một tính năng ai đó đang dùng hằng ngày**.

**Luật cổng ra:** không màn cũ nào bị xoá cho tới khi **mọi dòng của nó** trong bảng dưới được đánh dấu `✅ đã di trú và ĐÃ ĐO` — đo bằng e2e hoặc bằng người thao tác thật, không phải bằng lời khai "đã làm xong".

### 11.1 `DigitalTwinCenter.tsx` (7)

| # | Tính năng | Đích di trú |
|---|---|---|
| 1 | Export USD/USDA (`twin.usdExport`) | Nút trong `NganXuLy` cấp nhà máy |
| 2 | Replay lịch sử TimescaleDB + scrubber + tốc độ | `DongThoiGian.tsx` (§9.8) |
| 3 | Robot khớp nối FK (`ArticulatedRobot` + `getKinematicModel`) | `loi/` — đường thoát "thiết bị có model động" |
| 4 | glTF per-device + `ModelErrorBoundary` | `boNhoModel.ts` + fallback khối |
| 5 | Vùng 3D translucent + nhãn | `twin_vat_the` loai=`vung` |
| 6 | Socket `twin:{factoryId}` / `twin:device` delta lerp | Giữ nguyên, nối vào `loi/` |
| 7 | Banner 3 trạng thái cờ/stream/poll | Panel trái, mục "Tươi dữ liệu" |

### 11.2 `CommandCenter.tsx` (10)

| # | Tính năng | Đích di trú |
|---|---|---|
| 8 | Cây ISA-95 5 tầng + roll-up đếm | `CayPhanCap.tsx` |
| 9 | Tìm kiếm cây debounce 200ms + highlight `<mark>` | `CayPhanCap.tsx` |
| 10 | Lọc "chỉ node có cảnh báo" + auto-expand | `CayPhanCap.tsx` |
| 11 | **Bàn phím WAI-ARIA tree** (Enter/Space/←/→, roving tabindex) | `CayPhanCap.tsx` — ★ phần khó nhất, đừng viết lại từ đầu |
| 12 | Dải cảnh báo hợp nhất (seed + socket, dedupe, cap 100) | `DaiCanhBao.tsx` |
| 13 | Nhóm "Tồn đọng > 24h" | `DaiCanhBao.tsx` |
| 14 | Chip lọc mức độ | `DaiCanhBao.tsx` |
| 15 | Scope filter theo subtree | `CayPhanCap.tsx` ↔ `DaiCanhBao.tsx` |
| 16 | KPI toàn hệ sinh thái | `BangKpiNoi.tsx` |
| 17 | **`isScopeEmpty`** chống nói dối "yên ổn" khi 0-gán | ★ NT-3, bắt buộc giữ |

### 11.3 `MachineCockpit.tsx` (6)

| # | Tính năng | Đích di trú |
|---|---|---|
| 18 | **Upload & đăng ký glTF cho máy** (`twin.models.uploadAndRegister`) | `ThuVienAsset.tsx` (§7.4) |
| 19 | Sensor trend + band ±2σ | Giữ ở cockpit, mở từ `NganXuLy` |
| 20 | Maintenance: WO + lazy parts + downtime timeline | Giữ ở cockpit; **nút "Tạo phiếu" của Twin ghi vào đây** |
| 21 | gatedActions → `/control-plane` | `NganXuLy` nhóm "Mở chức năng" |
| 22 | CapabilitiesValidationBadge | Giữ ở cockpit |
| 23 | Tab `process` (ProcessAnalyticsPanel) | Giữ ở cockpit |

### 11.4 `RobotCockpit.tsx` (6)

| # | Tính năng | Đích |
|---|---|---|
| 24 | TeachJogPanel + persist + lưu thành artifact | Giữ ở cockpit (2 mutation) |
| 25 | Joints bar + limit band | Giữ ở cockpit |
| 26 | E-STOP badge | **Nổi lên Twin** — an toàn phải thấy từ tổng quan |
| 27 | Sparkline speed/battery | Giữ ở cockpit |
| 28 | Tab safety / anomalies / jobs / tasks | Giữ ở cockpit |
| 29 | gatedActions → `/command-console` | `NganXuLy` |

### 11.5 `DigitalTwinDashboard.tsx` (5)

| # | Tính năng | Đích |
|---|---|---|
| 30 | What-if throughput (`digitalTwin.whatIf`) | Ngăn kéo "Mô phỏng" (đợt 5) |
| 31 | Defect heatmap | Lớp phủ 3D + bảng xếp hạng 2D dải dưới |
| 32 | Station load + bottleneck | Lớp phủ + bảng xếp hạng |
| 33 | Prediction tắc nghẽn | Badge nổi + panel cảnh báo |
| 34 | Bảng health/risk (`digitalTwin.twinState`) | Danh sách trái (đồng bộ 2 chiều) |

> **Luật kèm theo:** mọi lớp phủ màu trên 3D **phải có bảng xếp hạng 2D song song** ở dải dưới. Màu không cho phép so sánh chính xác — đây là mẫu của Siemens Plant Simulation Bottleneck Analyzer.

### 11.6 `CellTwinPlayer.tsx` (6)

| # | Tính năng | Đích |
|---|---|---|
| 35 | Phát lại `orchestration.simulate` workflow bất kỳ | Ngăn "Mô phỏng" (đợt 5) |
| 36 | `commandLog.avgDurations` → cycle time thật | Ngăn "Mô phỏng" |
| 37 | Scrub Gantt + phím ←/→ theo biên step | `DongThoiGian.tsx` |
| 38 | Toggle Dự đoán/Trực tiếp | `DongThoiGian.tsx` |
| 39 | Dùng lại layout vẽ polyline dòng chảy | Lớp phủ WIP |
| 40 | Deep-link `?ref=` + EngineeringContext | `duongDanTwin.ts` |

### 11.7 `FactoryFloorEditor.tsx` (5) — ★ RỦI RO CAO NHẤT

| # | Tính năng | Đích |
|---|---|---|
| 41 | **Nơi DUY NHẤT ghi toạ độ 0–1** mà 3 màn khác đọc | `twin_dat_cho` + script di trú §5.6 |
| 42 | **Nơi DUY NHẤT CRUD vùng an toàn** | `VeVungPolygon.tsx` (§7.3) |
| 43 | Ảnh nền CAD + tỉ lệ mét | `twin_tang.anhNenUrl` + công cụ Đặt tỉ lệ |
| 44 | Undo/Redo | `lichSuThaoTac.ts` |
| 45 | Xoay + footprint W/D per-machine | Gizmo + Inspector |

> Xoá màn này trước khi 41–43 xong = **3D map thành vô dụng**. Đây là lý do QĐ-8 (chạy song song) không phải là sự thận trọng thừa.

### 11.8 `WorkshopLayoutEditor.tsx` (4)

| # | Tính năng | Đích |
|---|---|---|
| 46 | Hệ toạ độ pixel riêng | `twin_dat_cho` + di trú |
| 47 | **Thêm/xoá máy khỏi layout** | "Khu chờ xếp chỗ" (§7.1, §7.3) |
| 48 | Chip lineStage theo station | Inspector |
| 49 | Sửa toạ độ bằng số | Inspector (đã có, món #7) |

### 11.9 `FactoryLiveMap3D.tsx` (5)

| # | Tính năng | Đích |
|---|---|---|
| 50 | **UNS stream ISA-95** (`useUnsStream`) — duy nhất | `loi/` nguồn realtime thứ hai |
| 51 | Adaptive poll 5s ↔ 30s theo trạng thái WS | `loi/` |
| 52 | Badge phân biệt SHADOW vs TWIN | Panel "Tươi dữ liệu" |
| 53 | Máy chưa đặt = bán trong suốt (staged) | "Khu chờ xếp chỗ" |
| 54 | Nhãn tên chuyền tại centroid | `LopNhan.tsx` |

### 11.10 `Layout.tsx` (7)

| # | Tính năng | Đích |
|---|---|---|
| 55 | **CRUD layout theo tên** | `twin_ban_ghi` (phiên bản bố cục) |
| 56 | Mini-map click-to-navigate | Góc dưới phải canvas |
| 57 | Export PNG | Nút trong Thiết kế |
| 58 | Fit-all-in-view + Fullscreen | Thanh công cụ canvas |
| 59 | Highlight theo lineStage | Chọn máy → sáng cả stage |
| 60 | Stats AOI OK/NG/NTF/Yield | `NganXuLy` |
| 61 | WIP overlay theo `layoutId` | Lớp phủ WIP |

### 11.11 `TwinHub.tsx` (2)

| # | Tính năng | Đích |
|---|---|---|
| 62 | **Badge xuất xứ LIVE / SIM / SƠ ĐỒ + legend** | ★ NT-3 — giữ nguyên tinh thần, hiện ở panel "Tươi dữ liệu" |
| — | Unmount tab → 1 WebGL context | ★ RB-4 — Twin mới phải tự đảm bảo |

### 11.12 `RfTestCellSim.tsx` — ưu tiên thấp nhất

Đo được: **792 dòng, 0 lệnh tRPC**. Hoàn toàn dữ liệu tĩnh — là **giáo cụ trình diễn**, không nối hệ thật. Di trú sau cùng, hoặc giữ nguyên như một trang độc lập.

---

## 11b. Bản đồ phụ thuộc 5 màn cũ — ĐO TRƯỚC KHI XOÁ (2026-09-07)

Đợt 7 xoá màn cũ. Trước đó phải biết **ai đang phụ thuộc chúng** — đo được, không đoán:

| Màn cũ | Ai import | Xoá cần làm gì trước |
|---|---|---|
| `DigitalTwinCenter` | **`TwinHub.tsx`** — `DigitalTwinCenterContent` (tab `center`) | Gỡ tab khỏi TwinHub |
| `FactoryLiveMap3D` | **`TwinHub.tsx`** — `FactoryLiveMap3DContent` (tab `map`) | Gỡ tab khỏi TwinHub |
| `CommandCenter` | `App.tsx:174` lazy + `:652` preload map, route `/command-center` | Gỡ route + preload + redirect |
| `MachineCockpit` | `App.tsx:178` **VÀ `MachineWorkspace.tsx`** | ★ **CÓ CONSUMER NGOÀI ROUTE** |
| `RobotCockpit` | `App.tsx:179`, route `/robot/:id` | Gỡ route + redirect |

> ### ★★★ CẢNH BÁO — `MachineCockpit` có consumer thứ hai
> `client/src/pages/MachineWorkspace.tsx` import `MachineCockpit` trực tiếp (nó export
> `MachineCockpitBody({machineId, embedded})` để nhúng). **`MachineWorkspace` KHÔNG nằm trong phạm vi
> Twin** — xoá `MachineCockpit` sẽ làm gãy một màn ngoài dự án.
> ⇒ Đợt 7 **không được xoá `MachineCockpit`** cho tới khi `MachineWorkspace` có đường khác, và đó là
> quyết định của chủ sở hữu, không phải của đợt dọn dẹp.

> ### ★★★ BẪY ĐO — grep sai mẫu cho ra "0 nơi import"
> Lần đo đầu của chủ dự án dùng mẫu `pages/<Tên>` và cho kết quả `DigitalTwinCenter: 0 nơi import` —
> **sai**. TwinHub import chúng bằng đường dẫn tương đối `"./DigitalTwinCenter"`, không khớp mẫu đó.
> Nếu tin con số ấy, Đợt 7 đã xoá hai màn **đang được TwinHub dùng**.
> ⇒ Đây là **G9 (đơn vị/phạm vi của con số)** áp cho `grep`: một phép đếm chỉ đúng trong phạm vi mẫu
> của nó. Trước khi tin "0 kết quả", **thử mẫu thứ hai rời hẳn** — ở đây là đếm cả `./<Tên>`,
> `@/pages/<Tên>`, và `pages/<Tên>`.

> ### ★★★ G24 — SPEC LẤY TÊN TỪ FIXTURE TEST, KHÔNG TỪ HỆ THẬT (đóng nợ Đợt 6)
>
> §6.4 và brief của tôi ghi cổng quyền là `maintenance_*`. Agent đo lại: **tên đó không tồn tại**
> trong mã sản phẩm. Chuỗi `"maintenance"` chỉ xuất hiện **ở đúng một fixture test**
> (`twinTrangThaiPhamVi.unit.test.ts:49`). Module thật là **`machine_monitoring`** (alias `machine_status`).
>
> Tác hại nếu tin spec: người **lấy được danh sách KTV** sẽ khác người **tạo được phiếu** —
> dropdown đầy tên nhưng bấm Lưu thì 403. Một lớp lỗi **không test đơn nào bắt được**, vì mỗi
> đầu đều đúng với cổng của chính nó.
>
> ⇒ **Luật:** tên định danh trong spec (module quyền, enum, cờ, trường DB) phải **grep ra được
> trong mã sản phẩm** trước khi viết. Trúng trong tests/fixtures **không tính** — test có thể tự
> dựng thế giới của nó. Và hai điểm chặn của cùng một luồng phải dùng **cùng một hằng có tên**.


---

## 11c. ĐỢT 7 — ĐO LẠI SỔ KIỂM 62 MỤC (2026-09-07)

> Đo lại **từ đầu**, không đọc lời khai đợt trước. Ba agent đo ba khối rời nhau; mọi mục
> đánh XONG đều phải chỉ ra **chỗ gọi** (G16). Kết quả bác bỏ nhiều giả định của chính spec này.

### 11c.1 Kết quả tổng

| Trạng thái | Số mục | Danh sách |
|---|---|---|
| **XONG — ĐO ĐƯỢC** | **18** | 2, 7, 17, 20, 21, 26, 29, 41, 44, 45, 46, 47, 49, 50, 52, 53, 54, 62 (+62b) |
| **XONG — CHƯA ĐO** | **8** | 19, 22, 23, 24, 25, 27, 28, 39 |
| **CHƯA LÀM** | **36** | 1, 3, 4, 5, 6*, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 42, 43, 48, 51, 55, 56, 57, 58, 59, 60, 61 |

`*` #6 đã di trú socket nhưng **hợp đồng đổi**: kênh là `twin:trangThai` (ảnh chụp cả nhà máy),
không phải `twin:{factoryId}`/`twin:device` delta ⇒ **delta lerp không còn đối tượng để nội suy**.

> ### ★★★ CỔNG RA §11 CHƯA MỞ — 18/62 đo được, KHÔNG PHẢI ≥58/62
> Luật §11 nói: *không màn cũ nào bị xoá cho tới khi **mọi dòng** ✅ đã đo*. Với 36 mục CHƯA LÀM,
> **xoá bất kỳ màn nào trong 4 màn cũ hôm nay là mất tính năng thật đang chạy**, không phải dọn dẹp.

### 11c.2 ★★★ BỐN LỚP LỖI ĐO ĐƯỢC — "có mã, có test, nhưng không giao được gì"

Đây là phần đáng giá nhất của đợt đo. Cả bốn đều **qua `check`, qua `build`, qua 994 test**.

**L-1 — `nhipHoiMs` (#51): hàm được viết ĐÚNG cho mục đó, có test, và KHÔNG AI GỌI.**
`van-hanh/nguonDuLieu.ts:52` khai `nhipHoiMs(coLuong)` (5 s ↔ 30 s), docblock trích thẳng "#51".
`nguonDuLieu.unit.test.ts:15-27` kiểm nó xanh. Nhưng `TwinVanHanh.tsx:113` chỉ import
`laGiaDinh, xuatXuHienTai` — **`nhipHoiMs` có 0 chỗ gọi trong mã sản phẩm**, trong khi ba nhịp
poll ở `TwinVanHanh.tsx:237/243/254` là **hằng viết cứng** 30 s/20 s/20 s.
⇒ Bẫy: *tệp* được import nên grep theo TÊN TỆP báo "đã nối". Phải grep theo **TÊN HÀM**.

**L-2 — `wip={[]}` (#61, #32, #36): lớp phủ dựng xong, gọi thật, và vĩnh viễn vô hình.**
`CanhVanHanh.tsx:199-239` có đủ `OngWip` (InstancedMesh 1 draw call, màu nghẽn, RB-7 dispose) và
được render ở `:302`. Nhưng chỗ gọi duy nhất truyền **mảng rỗng viết cứng**:
`TwinVanHanh.tsx:1384 wip={[]}`, và `CanhVanHanh.tsx:238 if (wip.length === 0) return null`.
Cùng hình dạng: `TwinVanHanh.tsx:1381 nhipMs: null` ⇒ mũi tên dòng chảy chạy tốc độ hằng.
⇒ Đây là **G5 nguyên bản**: cổng xanh trên tập rỗng trùng khít cổng xanh của hệ đúng. Không test
nào trong 994 test truyền một `wip` KHÁC RỖNG.

**L-3 — `twin_ban_ghi` (#55): bảng có, migration có, 0 dòng và 0 mã đọc/ghi.**
`drizzle/0351_twin_dat_cho_va_vat_the.sql:158` tạo bảng, `drizzle/schema/twin3d.ts:261` khai kiểu.
Đo trên DB dev: **0 dòng**. `grep twinBanGhi server/ client/` (trừ schema) ⇒ **0 kết quả**.
Bảng tồn tại không phải là tính năng tồn tại.

**L-4 — `taiAnhNen` (#43): backend xong, i18n ba thứ tiếng xong, client 0 chỗ gọi.**
`twinCanhRouter.ts:398` có thủ tục, `twinCanh.ts:428/450` có cột `anhNenUrl`, khoá i18n đã viết ở
`en/vi/zh.json:4020`. `grep taiAnhNen client/src` ⇒ chỉ trúng chính các khoá i18n đó.
⇒ Dấu hiệu làm từ trên xuống rồi **dừng ngay trước component**. Khoá i18n tồn tại cho một tính
năng không có UI là chỉ báo sớm rất tốt — nên đưa vào cổng QA.

### 11c.3 ★★★ SPEC SAI — SÁU CHỖ ĐO ĐƯỢC (họ G24, nối tiếp nợ Đợt 6)

| Spec ghi | Sự thật đo được | Hệ quả nếu tin spec |
|---|---|---|
| `DaiCanhBao.tsx`, `BangKpiNoi.tsx` (#12-16) | **KHÔNG TỒN TẠI** dưới bất kỳ tên nào (đo 3 mẫu: trần, `./X`, `@/…/X`) | Đánh dấu xong nhầm cho `LopCanhBao.tsx` — đó là **badge 3D screen-space §10.3**, tính năng KHÁC |
| `VeVungPolygon.tsx` (#42) | **KHÔNG TỒN TẠI**; CRUD vùng an toàn vẫn chỉ ở `FactoryFloorEditor.tsx:444` | Xoá `FactoryFloorEditor` = mất **nơi duy nhất** CRUD vùng an toàn |
| `boNhoModel.ts` (#4) | **KHÔNG TỒN TẠI** ở cả client lẫn server | — |
| `lineStage` (#48, #59) | **Định danh ma**: 0 hit trong mã sản phẩm Twin; `trpc.lineStage.*` duy nhất ở `factoryConfig/StagesTab.tsx` (màn cài đặt, không liên quan) | Hai mục **không di trú được như đã viết** |
| `CayPhanCap.tsx` là đích của #8-11, #15 (màn **Vận hành**) | Tệp có thật nhưng ở `thiet-ke/`, **chỗ gọi duy nhất `XuongThietKe.tsx:725`** (màn **Thiết kế**). `/twin` KHÔNG có cây phân cấp | Đánh dấu xong nhầm cho một component dựng cho mục đích khác |
| #1 "nút trong `NganXuLy` **cấp nhà máy**" | `NganXuLy` là **cấp MÁY** (`NganXuLyProps.machineId`, `NganXuLy.tsx:89-91`). Không có vùng cấp nhà máy | Đích di trú của #1 **sai kiến trúc**, phải chọn lại chỗ đặt |

> **★★★ `CayPhanCap` có ARIA nhưng KHÔNG có bàn phím — tệ hơn là không có gì.**
> `CayPhanCap.tsx:70 role="treeitem"`, `:180 role="tree"`, có `aria-selected`/`aria-expanded`.
> Nhưng **0 `onKeyDown`, 0 `tabIndex`** trong toàn `twin3d/**` (chỗ duy nhất là
> `BangThuocTinh.tsx:108`, không liên quan). Hàng là `<div onClick>`.
> ⇒ Nó **tự khai với trình đọc màn hình rằng nó là một cây điều khiển được**, rồi không thao tác
> được bằng bàn phím. #11 (mục spec đánh dấu ★ "phần khó nhất") chưa làm, và phần ARIA đã có làm
> cho lỗi **khó phát hiện hơn** chứ không nhẹ đi.

### 11c.4 Đo trên DB dev (2026-09-07) — đổi kết luận cho #41/#46

Đo bằng **hai mô hình rời** (đếm trực tiếp; và `query_to_xml` liệt kê toàn phân bố) — BG-127:

```
twin_dat_cho          82     (nguon: 'sinh' 82 / 'tay' 0)
twin_tang              1     twin_toa_nha           1
twin_vat_the           4     (loai: 'tuong' 4 / 'vung' 0)   ⇒ #5 CHƯA LÀM ở cả tầng dữ liệu
twin_ban_ghi           0     twin_kich_thuoc_loai  24
machine_positions      0  ★  factory_layouts        0  ★
machines              43     dat_cho: machine 42 / station 36 / line 3 / workshop 1
```

> ### ★★★ HAI BẢNG NGUỒN CỦA #41/#46 ĐỀU **RỖNG**
> §11.7 gọi #41 là *"nơi DUY NHẤT ghi toạ độ 0–1 mà 3 màn khác đọc"* và xếp §11.7 là **rủi ro cao
> nhất**. Đo được: `machine_positions` = **0 dòng**, `factory_layouts` = **0 dòng**.
> ⇒ Trên DB dev **không còn dữ liệu bố cục cũ để mất**. Rủi ro thật của việc xoá
> `FactoryFloorEditor` KHÔNG phải mất toạ độ (#41/#46 đã có đường mới, và nguồn cũ rỗng) mà là
> **mất #42 (CRUD vùng an toàn) và #43 (ảnh nền CAD + tỉ lệ)** — hai mục chưa có đường thay thế.
> ⚠ Con số này là của **DB dev**. Trước khi xoá thật phải đo lại trên production — một bảng rỗng
> ở dev không chứng minh gì về production (G9: phạm vi của phép đếm).

### 11c.5 Hai thủ tục server SỐNG mà KHÔNG AI GỌI từ Twin mới

`twin.usdExport` (`twinRouter.ts:316`, có `usdExport.t3b.test.ts`) và `twin.replay`
(`twinRouter.ts:346`) đã cài đặt đầy đủ. Chỗ gọi client **chỉ có ở màn sắp xoá**:
`DigitalTwinCenter.tsx:606` và `SystemHealth.tsx:592`.
⇒ **Xoá `DigitalTwinCenter` hôm nay = âm thầm mất xuất USD trong ngữ cảnh Twin.**

### 11c.6 Quyết định Đợt 7 về "Ngăn mô phỏng + xuất USD" — **HOÃN**

Brief cho phép tự quyết: chỉ làm nếu ≥58/62 mục XONG-ĐO ĐƯỢC. Đo được **18/62**.
Theo **§16 YAGNI** (*tính năng mới xếp sau tính năng đã hứa*) ⇒ **KHÔNG làm ngăn mô phỏng, KHÔNG
làm xuất USD trong đợt này**. Thêm bề mặt mới trong khi 36 mục đã hứa còn nợ là cách chắc chắn
làm cổng ra §11 không bao giờ đóng được.

### 11c.7 Kế hoạch GỠ 4 màn — ĐO XONG, **CHƯA THỰC THI** (chờ chủ sở hữu)

> ⛔ Đợt 7 **không xoá gì**. Dưới đây là chỗ phải sửa, đo được, để lần xoá thật không phải dò lại.
> Điều kiện tiên quyết cho MỌI dòng: các mục §11 tương ứng phải XONG-ĐO ĐƯỢC trước.

| Màn | Chỗ phải sửa (file:line) | Redirect cần thêm | Chặn hiện tại |
|---|---|---|---|
| `DigitalTwinCenter` | `TwinHub.tsx:25` (import), `:42` (tab `center`) | `/digital-twin-center` đã redirect (`App.tsx:440`) — giữ | **#1 USD** (`DigitalTwinCenter.tsx:606` là chỗ gọi duy nhất trong ngữ cảnh Twin); #3, #4, #5 |
| `FactoryLiveMap3D` | `TwinHub.tsx:26` (import), `:43` (tab `map`) | `/factory-live-map` đã redirect (`App.tsx:383`) — giữ | #51 (nhịp thích ứng) chưa nối; #50/#52/#53/#54 **đã xong** |
| `CommandCenter` | `App.tsx:174` (lazy), `:441` (route `/command-center`), `:652` (preload map), `navigation.tsx:301` (mục nav) | `/command-center` → `/twin` | **#8-#16 chưa làm (9 mục)**; #17 đã xong |
| `RobotCockpit` | `App.tsx:179` (lazy), `:454` (route `/robot/:id`) | `/robot/:id` → `/twin?chon=…` **chỉ khi** #24/#25/#27/#28 có đường mới | #24, #25, #27, #28 mới XONG-CHƯA ĐO và **spec nói GIỮ ở cockpit** ⇒ xoá là **trái spec** |
| `MachineCockpit` | ⛔ **KHÔNG XOÁ** | — | `MachineWorkspace.tsx:17` import `MachineCockpitBody`, dùng ở `:78`. **Ngoài phạm vi Twin.** Quyết định của chủ sở hữu |

> ### ★★★ HAI MÀN TRONG DANH SÁCH "XOÁ" ĐƯỢC SPEC YÊU CẦU **GIỮ**
> §11.4 ghi rõ #24/#25/#27/#28 là *"Giữ ở cockpit"* — tức `RobotCockpit` **không phải màn để xoá**,
> nó là **đích đến** của 4 mục. Tương tự §11.3 với `MachineCockpit` (#19/#22/#23).
> ⇒ Brief Đợt 7 xếp `RobotCockpit` vào "4 màn còn lại" là **mâu thuẫn với §11.4 của chính spec**.
> Chỉ có `NganXuLy` **trỏ tới** chúng (`nganXuLyLogic.ts:241` `/machine/:id`, `:269` `/robot/:id`)
> — xoá đích thì hai nút điều hướng vừa xây xong ở Đợt 6 sẽ trỏ vào 404.

> ### ★★★ `TwinHub` VẪN CHẠY TOÀN BỘ NGĂN XẾP CŨ
> `TwinHub.tsx:24-30` import **7 màn cũ** và có **0 tham chiếu** tới `twin3d/**`, `TwinVanHanh`,
> `TwinStudio`. Ngăn xếp mới sống ở route riêng (`App.tsx:325-326`). Đúng QĐ-8 (chạy song song),
> nhưng nghĩa là #55/#56/#57/#59/#60/#61 **vẫn còn bản cũ đang phục vụ người dùng** sau các tab
> `layout`/`floor`/`map` — và xoá chúng là mất tính năng, không phải dọn dẹp.

### 11c.8 Đề xuất cho chủ sở hữu (KHÔNG tự thực thi — cần hỏi người dùng)

Không mục nào dưới đây được thực hiện trong Đợt 7. Kèm bằng chứng đo được để chủ sở hữu quyết định:

1. **Nối `nhipHoiMs` vào ba `refetchInterval`** (`TwinVanHanh.tsx:237/243/254`) — mã và test đã có
   sẵn, chỉ thiếu chỗ gọi. Chi phí thấp nhất trong toàn bộ danh sách nợ.
2. **Cấp dữ liệu cho `wip`** (`TwinVanHanh.tsx:1384`) và `nhipMs` (`:1381`) — mở khoá #61, #32, #36
   cùng lúc; lớp phủ 3D đã dựng xong. Kèm điều kiện §11.5: phải có **bảng xếp hạng 2D song song**
   (hiện `DaiLine.tsx` thiếu cột WIP và nhịp).
3. **Sửa spec §11** cho 6 chỗ sai ở §11c.3 — đặc biệt đổi đích của #1 (NganXuLy là cấp máy) và
   viết lại #48/#59 (`lineStage` không tồn tại).
4. **Bổ sung bàn phím cho `CayPhanCap`** hoặc **gỡ `role="tree"`** — hiện trạng (ARIA có, bàn phím
   không) là lời khai sai với trình đọc màn hình.
5. **Xoá 2 thủ tục chết hoặc nối chúng**: `twin.usdExport`, `twin.replay`. ⚠ Chỉ sau khi quyết
   định số phận `DigitalTwinCenter` — hiện chúng vẫn có người dùng thật qua màn cũ.

## 11d. ĐỢT 8 — ĐÓNG 36 MỤC CÒN LẠI (2026-09-07, chủ dự án duyệt)

Đợt 7 đo ra **18/62**. Người dùng duyệt đề xuất **Đợt 8 = đóng 36 mục**, không phải xóa màn cũ.

### 11d.1 Chia lô theo **tệp đích**, không theo số mục

36 mục **không đồng chất**: có mục chỉ thiếu một sợi dây, có mục là cả màn hình. Chia theo tệp đích
để ba lô chạy **song song trên cùng nhánh mà không đụng tay nhau**:

| Lô | Mục | Tệp độc quyền |
|---|---|---|
| **A — nối dây chết** | #51, #61, #32, #36, #60 | `TwinVanHanh.tsx` (**duy nhất A được sửa**), `nguonDuLieu.ts`, `CanhVanHanh.tsx`, `DaiLine.tsx` |
| **B — cây + cảnh báo** | #8–#15 | `CayPhanCap.tsx`, `DaiCanhBao.tsx` (tạo mới) |
| **C — công cụ canvas** | #56, #57, #58, #5, #42 | `thiet-ke/**` (trừ `CayPhanCap`), `loi/**` |

**Luật phân lô:** mỗi tệp thuộc **đúng một lô**. `TwinVanHanh.tsx` là điểm nóng nhất — cả ba lô đều
muốn nối vào nó, nên nó được giao **độc quyền cho A**; B và C phải **báo lại** thay vì tự sửa.

### 11d.2 Hoãn có lý do — không giao ở Đợt 8

- **#30/#35/#36 (ngăn Mô phỏng), #37/#38 (`DongThoiGian`)** — §16 YAGNI: tính năng mới xếp sau
  tính năng đã hứa. `TwinVanHanh.tsx:460` đang hardcode `dangMoPhong: false`.
- **#1 (nút USD)** — **đích sai kiến trúc**: `NganXuLy` phạm vi **MÁY** (`NganXuLyProps.machineId`),
  nút cấp nhà máy không có chỗ đặt. Phải viết lại mục trước khi giao.
- **#48/#59 (`lineStage`)** — định danh **ma**: `trpc.lineStage.*` duy nhất thuộc màn settings khác.
  Viết lại mục trước, đừng đoán (**G24**).
- **#55 (`twin_ban_ghi`)** — bảng có, **0 hàng, 0 consumer**; cần quyết định hợp đồng phiên bản trước.

### 11d.3 Ràng buộc cứng cho cả ba lô

1. **Không xóa gì** — không `git rm`/`rm`/`DROP`/`DELETE FROM`, không màn nào. Dữ liệu thử phải
   khôi phục **byte-exact**. (Ba màn `MachineCockpit`/`RobotCockpit`/`DigitalTwinCenter` đều đang
   phục vụ thật — §11b, §11c.7.)
2. **G5 là luật trung tâm của đợt này**: `wip={[]}` cho thấy một tính năng có thể có đủ mã, đủ test,
   qua cả 994 test mà **chưa bao giờ vẽ gì**. Mọi mục nối xong phải có test với dữ liệu **KHÁC RỖNG**.
3. **G16**: khai xong phải kèm **chỗ gọi `file:line`**. Hàm không ai gọi = chưa xong.
4. **G9 cho `grep`**: `nhipHoiMs` cho thấy *tệp* được import vẫn khiến grep-theo-tên-tệp báo "đã nối".
   Grep **tên hàm**.

### 11d.4 LÔ B ĐÃ VỀ — và ba thứ đo được nằm ngoài phạm vi vá (2026-09-07)

Cổng: **45 tệp / 1387 test** (nền 32/994) · `check` 0 lỗi · `build` 0. Commit `0162fafc`.

**NỢ KHAI THỪlNG (đúng luật G16):** `DaiCanhBao.tsx` có **0 chỗ gọi** — điểm nối là
`TwinVanHanh.tsx`, tệp **lô A giữ độc quyền**. #12/#13/#14 = *logic xong + đo được, CHƯA nối UI*.
Agent **không tự nhận là xong** — đúng, vì hàm không ai gọi thì chưa giao được gì.

> #### ★★★ G25 — MỘT SỰ KIỆN PHÁT VÀO BA PHÒNG: "TRÙNG" KHÔNG PHẢI LỖI CLIENT
> `socket.ts:1392-1394` phát **cùng một** `andon:event` vào `global` + `line:{id}` + `machine:{id}`.
> Client nghe nhiều phòng nhận **2–3 bản**. Thêm nữa, id seed nhúng `seq` đơn điệu ⇒ **cùng một
> hàng andon ra id khác nhau mỗi lần refetch**, nên dedupe theo id **khử được 0**. Phải khoá theo
> `{nguon}:{idNguon}`. ⇒ Trước khi dedupe, hỏi **khoá có ỔN ĐỊNH qua hai lần đọc không**.

> #### ★★★ G26 — NHÁNH KHÔNG AI ĐI ĐƯỢC, TRÔNG NHƯ THIẾT KẾ ĐÚNG (họ G5)
> `nganXuLyLogic.ts:120` lọc `trangThai === "raised"` để hiện nút *Xác nhận*. Đo độc lập bằng
> **hai mô hình rời** (BG-127) — liệt kê toàn phân bố rồi đối chiếu tổng:
> `[{"status":"acknowledged","n":7}]`, tổng 7 = cộng phân bố 7 ⇒ **0 hàng `raised` trên TOÀN BẢNG**.
> Nhánh đó **chưa ai từng đi qua** trên DB dev. Người nghiệm thu live sẽ thấy "không có nút"
> và tưởng **đúng thiết kế**. ⇒ Mọi nghiệm thu ack **phải tự dựng hàng `raised`** (ca dương, G22).
> `stationId` NULL 7/7 — một tập rỗng thứ hai nằm sẵn đó.

**#11 — "đừng viết lại từ đầu" là lời khuyên SAI của tôi:** bản gốc
`CommandCenter.tsx:330-343` chỉ có Enter/Space/←/→, **không có ↑/↓/Home/End** ⇒ trên bàn phím
**không đi lại được giữa các node**. Chép sang là chép một cây chỉ mở/đóng được.

### 11d.5 LÔ C ĐÃ VỀ — 5/5 mục có chỗ gọi thật (2026-09-07)

Cổng: **45 tệp / 1391 test** · `check` 0 · `build` 0. Commit `e44c90be`.
#58 `khungNhin.ts` · #57 `xuatAnh.ts` · #56 `banDoNho.ts` → `XuongThietKe.tsx:880` ·
#5 `vungAnToan.ts` → `CanhThietKe.tsx:405` · #42 `VeVung.tsx` → `XuongThietKe.tsx:922`.

> #### ★★★ G27 — TỰ BẮT LỜI KHAI QUÁ CỦA CHÍNH MÌNH, RỒI SỬA CHO LỜI KHAI THÀNH ĐÚNG
> Docblock đầu tiên của lô C hứa nhãn vùng đặt tại **trọng tâm diện tích**. Tự đo lại trên hình
> chữ L `(0,0)-(12,0)-(12,4)-(3,4)-(3,12)-(0,12)` m ⇒ trọng tâm **(4,5 · 4,0) NẰM NGOÀI đa giác**
> ⇒ nhãn nổi giữa lối đi.
> Nó **không sửa câu chữ cho khớp mã** — nó viết `diemDatNhan()` (quét ngang, lấy nhịp trong dài
> nhất) để **lời hứa thành đúng**, và gọi nó ở `vungAnToan.ts:344`.
> ⇒ Khi phát hiện tài liệu nói quá mã: **hỏi lời hứa hay mã mới là thứ sai**. Hạ lời hứa xuống cho
> khớp mã là cách dễ nhất để giữ một khuyết tật vĩnh viễn.

> #### ★ G28 — `preserveDrawingBuffer=false`: ẢNH XUẤT RA **TRẮNG MÀ KHÔNG LỖI**
> `toDataURL` ngây thơ trên build thật cho chuỗi **11.126 ký tự** (ảnh trắng); đường render-rồi-chụp
> cho **120.458** (10,8×). Không exception, không cảnh báo — chỉ một tệp PNG rỗng. Đo bằng **độ dài
> chuỗi**, đừng đo bằng "có tải về được không".

**Vượt phạm vi — chấp nhận:** lô C thêm đường ghi server (`twinCanh.ts`, `twinCanhRouter.ts`) vì
#42 là **CRUD**, không có đường ghi thì không làm được. Đo lại: **chỉ `e44c90be` chạm hai tệp đó**,
không xung đột. Nó **khai thẳng thay vì im**. ⇒ Phạm vi tệp là hàng rào **chống đụng tay**, không
phải rào chặn kỹ thuật; vượt rào + khai báo + đo không xung đột = chấp nhận được.

**Khôi phục DB đo độc lập:** `twin_vat_the` = `[{"loai":"tuong","n":4}]`, tổng 4 = cộng phân bố 4,
**0 hàng `vung`** — sạch đúng trạng thái trước thử nghiệm.

**G2 (nhiều lô một nhánh):** khoá i18n của lô C bị cuốn vào commit `0162fafc` của lô B. Đo lại:
`canvasUi` + `vung` **có đủ ở cả vi/en/zh** ⇒ phiền sổ sách, không mất mát.

### 11d.6 LÔ A ĐÃ VỀ — và một lớp lỗi màu lan ra ngoài đợt (2026-09-07)

Cổng: **45 tệp / 1391 test** (riêng `van-hanh` **18 tệp / 387**) · `check` 0 · `build` 0. Commit `ba47a695`.
#51 → `TwinVanHanh.tsx:291,305,318` · #61/#32/#36 → `:1444,1447` + `DaiLine` `:1692-1714`.

> #### ★★★ G29 — `THREE.Color` KHÔNG ĐỌC `oklch()`: VẼ ĐỦ HÌNH, CHỞR **0 BIT**
> three r182 gặp `new THREE.Color("oklch(...)")` thì **WARN rồi trả TRẮNG** — không ném lỗi.
> 12 cột WIP vẽ đúng vị trí, đúng chiều cao, **trắng như nhau** ⇒ lớp phủ chở **0 bit thông tin**.
> Đo pixel trước/sau: trắng **33.901 → 62**, xanh **1.117 → 4.861**.
>
> **Lan xa hơn đợt này** (đo độc lập): `mauTrangThai.ts` có **2 `oklch(`, 0 hex**, trong khi
> `tachRgb` (`phamViCanh.ts`) chỉ đọc `rgb()`/`#hex` ⇒ `phaVeNen()` **trả nguyên màu gốc**
> ⇒ **"mờ 12% cho Line ngoài phạm vi" (§10C) CHƯA TỪNG CÓ HIỆU LỰC**. Mã chạy, không lỗi,
> không làm gì — **G5 ở dạng độc nhất**. Còn 84 warning `oklch` từ `LoBatchMay`/kit.
>
> Docblock `mauTrangThai.ts:44` ("trình duyệt tính oklch→rgb nên không cần thư viện màu") **sai**:
> custom property **không được CSS phân giải** trước khi tới three.

> #### ★★★ G30 — LỜI KHAI TRONG DB KHÔNG CÓ HẠN DÙNG (họ "lý do hoãn hết hạn", Khối D)
> Bản ghi `line_balance` của Line 1 **16 ngày 18 giờ tuổi** khai trạm 10 là nút thắt (124 WIP),
> trong khi trạm 1 đang giữ **3.152** (22× trung vị). Màn tô đỏ **đúng trạm không hỏng**.
> ⇒ Mọi giá trị đọc từ bảng phân tích phải kèm **hạn hiệu lực** (ở đây `conHieuLuc` 8 h);
> không có hạn thì một kết luận đúng của **hai tuần trước** vẫn được vẽ như sự thật hôm nay.

**Spec SAI — #36:** §11 chỉ `commandLog.avgDurations` là "cycle time thật". Thủ tục đó là
`avg(ackedAt − sentAt) GROUP BY commandType` = **độ trễ ACK lệnh**, không theo chuyền. Chuyền 12 s/chiếc
+ ack 80 ms ⇒ mũi tên chạy **nhanh gấp 150 lần** (G7). Nguồn đúng: `line_balance_metrics.avgCycleTimeMs`.

**Bác brief đúng:** áp thẳng `nhipHoiMs` sẽ làm andon/E-STOP **chậm đi** 20→30 s khi socket khoẻ
⇒ thêm `nhipHoiToiDa` (chỉ rút ngắn, không kéo dài). **An toàn không được chậm đi vì một tối ưu.**

**ĐB-9 sống sót lần đầu** (13 tiêm/13 bắt sau khi vá): gỡ trần 20 s khỏi **một** trong hai truy vấn,
`toContain` vẫn xanh nhờ chuỗi còn sót ở call site kia — **G9**. Đổi sang đếm + neo đích danh.

**Chưa chứng minh (tự khai):** cột 3D **màu hổ phách** của trạm nghẽn chưa nhìn tận mắt (nằm sát mép
trái khung hình). Cột xanh đã đo được bằng pixel. **A3 (#60) CHƯA LÀM** — đích `NganXuLy.tsx` ngoài
danh sách tệp lô A.

### 11d.7 LÔ D ĐÃ VỀ — nợ đã ĐO ĐƯỢC đã dọn, và một mục KHÔNG chứng minh được (2026-09-07)

Cổng: **47 tệp / 1433 test** (nền 45/1391) · `check` 0 · `build` 0 · **cảnh báo `oklch` 84 → 0**.
Commit `5588bf0a`.

**D1 → `mauThree.ts` + `byteMau.ts`** (mới) · `DongChayLine.tsx:92,105` · `TwinVanHanh.tsx:653,702,703,773`
**D2 → `phamViCanh.ts` `tachRgb`** · **D3 (#60) → `NganXuLy.tsx` `nhom-stats-aoi`** ·
**D4 → `TwinVanHanh.tsx:1554`** (`<DaiCanhBao>`) **+ `andon:event`**

> #### ★★★ G31 — MỘT BẢN VÁ ĐÚNG Ở MỘT TỆP VẪN LÀ MỘT BẢN VÁ **CHƯA TỚI ĐÍCH**
> Lô A vá `THREE.Color(oklch)` **đúng**, có test, và **tự khai** ba chỗ còn lại ngoài phạm vi tệp
> của nó. Ba chỗ đó là toàn bộ giá trị còn lại: 84 warning và `phaVeNen()` chết câm. ⇒ Khi một
> bản vá tự khai "còn N chỗ nữa", **N chỗ đó là món nợ có kỳ hạn**, không phải chú thích. Cách
> dọn đúng là **rút bản vá ra một module** rồi mọi người tiêu thụ import (G12), KHÔNG chép sang
> N chỗ. Lô D tách `byteMau.ts` (không three) khỏi `mauThree.ts` (có three) để `phamViCanh.ts`
> giữ được lời khai "module THUẦN" của chính nó — hạ lời khai xuống cho khớp mã là cách dễ nhất
> giữ một khuyết tật vĩnh viễn (G27).

> #### ★★★ G32 — "PHÉP BIẾN ĐỔI ĐỒNG NHẤT": G5 KHÔNG CẦN TẬP RỖNG
> `phaVeNen()` nhận dữ liệu **KHÁC RỖNG**, chạy hết thân, không lỗi, không cảnh báo, và trả về
> **đúng đầu vào của nó**. Mọi cổng xanh; "mờ 12 % cho Line ngoài phạm vi" (§10C) **chưa từng có
> hiệu lực** qua nhiều đợt. Đo song song hai nhánh trên trang thật: chênh **TRƯỚC vá = 0** cho
> cả 4 trạng thái · **SAU vá = 376 / 329 / 306 / 28** (running / error / blocked / khong_ro).
> ⇒ Với mọi hàm BIẾN ĐỔI, ca nghiệm thu phải là **so đầu vào với đầu ra và đòi chúng KHÁC nhau**.
> "Chạy không lỗi" không phân biệt được `f(x)=y` với `f(x)=x`.

> #### ★★★ G33 — TỰ BẮT MÌNH ĐO NHẦM TẦNG, VÀ **KHÔNG** HẠ KỲ VỌNG CHO XANH
> Ca "#60 vẽ đủ bốn ô" viết `expect(NGAN).toContain("stats-ok")` và **ĐỎ** — không phải vì thiếu
> tính năng, mà vì ba ô sinh trong `.map()` với ``data-testid={`stats-${ma_}`}``: chuỗi đó chỉ tồn
> tại **lúc chạy**. Cám dỗ là hạ xuống `toContain("stats-")` — nhưng một tiền tố cũng thoả, tức đo
> đúng **số 0**. ⇒ Neo vào **MẢNG SINH RA** bốn ô (ba mã trong mảng + ô thứ tư viết tay), không
> vào chuỗi phẳng. Cùng họ G9: một phép đếm chỉ đúng trong phạm vi mẫu của nó.

> #### ★★ G34 — `preserveDrawingBuffer=false` LẦN THỨ HAI: `tong = 0` **TRÔNG NHƯ** "CANVAS TRỐNG"
> Đọc pixel canvas WebGL cho `tong: 0` ở lần chụp đầu — mọi pixel `alpha < 10`, vì buffer đã bị
> XOÁ sau khi present. Con số đó **không phân biệt được** với "cảnh không vẽ gì". Chỉ khi ép một
> frame (`pointermove` + **hai** `requestAnimationFrame`) mới đọc được 397.800 px. ⇒ Mọi phép đo
> pixel phải có **cửa kiểm frame khác rỗng** trước khi phân loại màu; nếu không, một lỗi đo được
> báo cáo thành một kết luận về sản phẩm (G28 mặc áo mới).

**Spec/brief SAI — #60 nguồn dữ liệu:** brief chỉ `dashboard.getAllMachinesStats`. Đo hợp đồng
(`dashboardStatsRouters.ts:95-153`): thủ tục đó `Promise.all` **một `getMachineStats` cho MỖI máy**
(42 trên SIM-FAC) để ngăn dùng đúng **một** hàng — N+1 mà Đ6 sinh ra để diệt. Dùng
`dashboard.getMachineStats` (`:75-93`): **cùng** procedure, **cùng** `StatsScopeArgs`, **cùng** khoá
cache ⇒ số bằng nhau từng chữ số.

**CHƯA CHỨNG MINH ĐƯỢC (khai thẳng) — cột hổ phách của D5:** đo 715.000 px × 4 tư thế camera trên
build thật ⇒ **0 pixel hổ phách**. Nguyên nhân đo được: trạm nghẽn là **trạm #1** (3.152 WIP,
`data-nghen="1"` trên `o-tram-wip-1`) ở **ĐẦU** chuyền, và nhãn 3D của nhóm máy đó chiếu ra **x âm**
(`SIM-L1-AOI` x=−14, `SN-SIM-0001` x=−61) ⇒ ngoài khung về phía trái; mọi cách dời camera bị
`ghiCamera` ghi `?cam=` đè lại sau ~1 s. Đo được **tầng ngay dưới**: màu nạp vào `setColorAt` —
nghẽn `rgb(239,168,49)` vs thường `rgb(90,163,236)`, **chênh 341**; trước vá cả hai `#ffffff`, chênh
**0**. ⇒ Món còn mở cho đợt sau: **một đường đặt camera KHÔNG bị URL ghi đè** (hoặc nút fit-all ở
màn Vận hành) — thiếu nó thì không nghiệm thu thị giác được bất cứ gì nằm ngoài khung mặc định.

**G30 đã có hiệu lực:** `conHieuLuc` bác đúng bản khai `line_balance` 16 ngày tuổi, và đường suy từ
WIP chọn **trạm 1 (3.152)** thay vì trạm 10 (124) mà bản ghi cũ khai. Đo trên DOM trang thật.


### 11d.8 TỔNG KẾT ĐỢT 8 — 4 lô, chủ dự án đo độc lập (2026-09-07)

**Cổng cuối: 47 tệp / 1433 test** (nền Đợt 7: 32/994) · `check` 0 · `build` 0 · cây nguồn sạch ·
**cảnh báo `oklch` 84 → 0**. Commit: A `ba47a695` · B `0162fafc` · C `e44c90be` · D `5588bf0a`.

**Kiểm G16 độc lập — MỌI mục có chỗ gọi thật** (khác hẳn Đợt 7, nơi `nhipHoiMs`/`wip` có đủ mã mà **0** chỗ gọi):
`nhipHoiToiDa` 4 · `wipTram` 2 · `khungNhin` 21 · `xuatAnh` 10 · `banDoNho` 3 · `vungAnToan` 7 ·
`VeVung` 2 · `DaiCanhBao` 3 · `docStatsAoi` 2 · `byteMau` 9.

**Nợ lô B đã đóng:** `DaiCanhBao` từ 0 chỗ gọi → `TwinVanHanh.tsx:1639`. Khối `<ul>` phẳng cũ bị bỏ —
để lại là **hai dải cùng nói về một sự cố với hai con số**.

**#60 — bác brief đúng, đo được:** brief chỉ `getAllMachinesStats`; thủ tục đó
(`dashboardStatsRouters.ts:95-153`) `Promise.all` **một `getMachineStats` cho MỖI máy** (42 trên SIM-FAC)
để ngăn này dùng đúng **một** hàng — chính là N+1 mà Đợt 6 sinh ra để diệt. Nguồn đúng
`dashboard.getMachineStats` (`:75-93`); **cả hai `protectedProcedure`** ⇒ đổi nguồn **không nới quyền**.

> #### ★★★ G32 — PHÉP BIẾN ĐỔI ĐỒNG NHẤT: G5 **KHÔNG CẦN TẬP RỖNG**
> `phaVeNen()` nhận `oklch`, không phân giải được, **trả nguyên màu gốc**. Đầu vào **khác rỗng**, mã
> **chạy đủ**, không lỗi, mọi cổng xanh — và hiệu ứng là **`f(x) = x`**. Đo song song hai nhánh
> trên trang thật: chênh lệch **0 → 376** (running), **0 → 329** (error), **0 → 306** (blocked).
> ⇒ Chống G5 không chỉ là "cho dữ liệu khác rỗng"; phải hỏi **đầu ra có KHÁC đầu vào không**.

> #### ★ G31 — VÁ ĐÚNG MỘT TỆP VẪN CHƯA TỚI ĐÍCH
> Lô A vá `oklch` ở `CanhVanHanh.tsx` và **tự khai còn 2 chỗ + 84 warning**. Chính lời tự khai đó là
> toàn bộ giá trị còn lại — không có nó thì lô D không biết đi đâu.

> #### ★ G33/G34 — ĐO NHẦM TẦNG, VÀ `tong=0` GIỐNG HỆT CANVAS TRỐNG
> G33: `toContain("stats-ok")` đỏ vì ba ô sinh trong `.map()`; **hạ xuống `"stats-"` sẽ XANH mà đo đúng
> số 0** — neo vào mảng sinh ra bốn ô thay vì nới chỉ báo. G34: `preserveDrawingBuffer=false` lần 2 —
> phải có **cửa kiểm frame khác rỗng** trước khi phân loại màu.

**D5 — KHÔNG CHỨNG MINH ĐƯỢC, khai thẳng:** 715.000 pixel × 4 tư thế camera ⇒ **0 pixel hổ phách**.
Nguyên nhân **đo được**: trạm nghẽn là **trạm #1** ở đầu chuyền, nhãn 3D chiếu ra **x âm**
(`SIM-L1-AOI` x=−14) ⇒ ngoài khung trái; mọi cách dời camera bị `ghiCamera` ghi `?cam=` đè sau ~1 s.
Đo được tầng ngay dưới: `setColorAt` nghẽn `rgb(239,168,49)` vs thường `rgb(90,163,236)`, **chênh 341**
(trước vá cả hai `#ffffff`, chênh **0**).
**MÓN CÒN MỞ:** màn Vận hành **thiếu đường đặt camera không bị URL ghi đè** ⇒ không nghiệm thu thị
giác được bất cứ gì ngoài khung mặc định. Đây là **hạn chế của THIẾT BỊ ĐO**, không phải của tính năng.

**G30 đã có hiệu lực trên trang thật:** `conHieuLuc` bác đúng bản khai `line_balance` **16 ngày tuổi**;
đường suy từ WIP chọn **trạm 1 (3.152)** thay vì trạm 10 (124).

**Nghiệm thu chạy bằng `e2e_twin_dot4@local.test` — KHÔNG phải admin** ⇒ số về quyền là số thật
(admin **bypass** `requirePermission`, đo bằng admin chứng minh **0** — bài học Khối D).

## 11e. ĐỢT 9 + 10 — QUY MÔ TẬP ĐOÀN VÀ UX TẠI CHỖ (2026-09-07, chủ sở hữu giao)

Sáu yêu cầu mới. Chủ sở hữu chốt: dữ liệu sinh **trên DB dev, có cờ nguồn + script gỡ**; UX **tách Đợt 10**.

### 11e.1 Quy mô yêu cầu vs thực tế đang đo được

| | Hiện có | Yêu cầu mới |
|---|---|---|
| Nhà máy | **2** (`SIM-FAC` id 1, id 18) | **4** (mục 3), hướng tới **6–7** (mục 4) |
| Máy toàn hệ | **43** | FUYU-F **360–720**; 6–7 tòa × **100 máy/tòa** |
| `twin_dat_cho` | **82** | — |

⇒ Gấp **17–50×** mọi phép đo hiệu năng từ trước đến nay. **`FUYU-F` chưa tồn tại.**

### 11e.2 ★ CHỦ SỞ HỮU CHỐT LỐI THOÁT TRƯỚC KHI ĐO

> *"nếu xem cùng lúc 7 tòa bị vượt quá, thì chỉ cho phép load từng tòa 1, cho thêm ô chọn tòa"*

Điều này **đổi tiêu chí "gãy"**: xem 7 tòa cùng lúc **không còn là ràng buộc phải đạt**. Phải đo **hai
số riêng**: (a) **một tòa** — số này phải đạt §4; (b) **nhiều tòa** — đo để tìm **ngưỡng gãy chính xác**,
vì chính con số đó quyết định **ô chọn tòa chặn ở đâu**. Đo tăng dần **1 → 2 → 4 → 7** để thấy đường
cong, không chỉ một điểm.

### 11e.3 Đo được: nền cho mục #2 (Line/Cell twin) ĐÃ CÓ, không phải xây từ đầu

`duongDanTwin.ts:38` khai `CapPhamVi = "tapDoan" | "nhaMay" | "tang" | "line" | "may"` — và **cả 5 cấp đều
có xử lý thật**, không phải khai báo suông: `phamViCanh.ts:67` (`may`), `:59,82,298` (`tapDoan`),
`duongDanTwin.ts:158,170,360`. Cấp `tapDoan` chính là nền cho câu hỏi **#3 (nhiều nhà máy)**.
⇒ Việc còn lại là **cảnh 3D + panel cho cấp `may`**, không phải dựng hệ định tuyến mới.

### 11e.4 Ràng buộc dữ liệu đo được trước khi sinh

- Chuỗi phân cấp: `factories → workshops.factoryId → production_lines.workshopId → stations.lineId
  → machines.stationId`. **`machines.stationId` BẮT BUỘC** — máy không treo thẳng vào line.
- **`twinnguonenum` chỉ có `sinh` và `tay`** ⇒ **không có chỗ cho cờ nguồn thứ ba**. Thêm giá trị enum là
  đổi lược đồ ⇒ **cấm**. Cờ phải đặt theo **MÃ** (tiền tố `FUYU-F-*`, `TAI-*`), và script gỡ dựa vào đó.
- Đơn vị bảng `twin_*` là **mm**: 3000 m = **3.000.000 mm**. §10A.0 đã cấm `floorWidthM`
  (SIM-FAC = 1500 ⇒ 1,5 km, số rác) — **đừng lặp lại lỗi đơn vị đó**.
- **Script GỠ phải viết và nghiệm thu TRƯỚC khi sinh khối lớn**: đếm → sinh nhỏ → gỡ → đếm lại →
  **mọi số về đúng ban đầu**. Gỡ không sạch thì **dừng**, đừng sinh tiếp.

### 11e.5 Đợt 10 — UX tại chỗ (tách riêng theo quyết định chủ sở hữu)

- **Mục 5**: bỏ redirect khi xem chi tiết máy/Line → **modal/panel tại chỗ + nút quay lại**, người dùng
  **không rời màn 3D**. (Liên quan §11c.7: `nganXuLyLogic.ts:267` hiện **trỏ ra `/robot/:id`** — đúng
  loại điều hướng mà mục 5 muốn bỏ.)
- **Mục 6**: thống kê và chỉ số hiển thị **trên màn 3D**.
- Lý do tách: kết quả đo ở Đợt 9 có thể **đổi cách thiết kế panel** (ngân sách nhãn §4 cap ở **30**;
  300 nhãn CSS2D đã laggy) ⇒ thiết kế UX trước khi biết ngưỡng là thiết kế trên giả định.

### 11e.6 LÔ E ĐÃ ĐO — **NÚT THẮT KHÔNG PHẢI GPU, LÀ KIẾN TRÚC NẠP** (2026-09-07)

Commit `b21a05e3`. Cổng: **47 tệp / 1433 test** đúng nền · `check` 0 · `build` 0 · cây sạch ·
DB cuối **`factories` 2 · `machines` 43 · `twin_dat_cho` 82 · 0 hàng rác** (chủ dự án đo lại độc lập).

**Script gỡ viết TRƯỚC script sinh**, và nghiệm thu **mạnh hơn brief đòi**: không chỉ đếm mà
**MD5 từng hàng của 9 bảng** — trùng khớp baseline sau khi gỡ **2.141 máy / 4.366 hàng `twin_dat_cho`**.
Nhận dạng bằng **mã** (`FUYU-F%`/`TAI-%`), không bằng `nguon='sinh'` — dùng enum sẽ **xoá nhầm 82 hàng
thật của SIM-FAC**.

#### Hiệu năng: ĐẠT RỘNG RÃI, không phải nút thắt

| Cảnh | Tải (ms) | draw calls | tam giác | FPS xoay | nhãn |
|---|---|---|---|---|---|
| 1 nhà máy, **549 máy** | 2.572–7.815 | **3** | 27.842 | **57–59** | 6–12 |
| `?pv=tapdoan` (4 NM) | 6.650 | **3** | 32.942 | 54,1 | 7 |

Ngân sách §4 (≤150 calls, ≥30 FPS, ≤30 nhãn): đạt rộng rãi. **`BatchedMesh` hoạt động thật —
549 máy trong 3 draw calls.** Ablation chứng minh thiết bị đo không mù: 549 máy → 32.942 tam giác;
0 máy → 21.602.

> #### ★★★ G35 — KHÔNG ĐO ĐƯỢC ĐƯỜNG CONG LÀ **PHÁT HIỆN**, KHÔNG PHẢI THẤT BẠI
> Brief đòi đường cong **1→2→4→7 toà**. Đo không được — và **lý do chính là câu trả lời**:
> `TwinVanHanh.tsx` nạp `factories[0]` (`:227`) → `toaNha[0]` (`:270`) → `tangs[0]` (`:278`) —
> **ba chỉ số `[0]` viết cứng**. **Không đường nào trong UI hiện hơn một tầng, của một toà, của một
> nhà máy.**
> ⇒ Ô chọn toà mà chủ sở hữu yêu cầu **không cần ngưỡng chặn vì hiệu năng** — GPU còn rất rộng ở
> 549 máy/tầng. Nó cần tồn tại vì **hiện không có lối vào**.
> ⇒ Khi một phép đo bất khả thi, **hỏi vì sao** trước khi coi là thiếu sót; lý do thường là kết luận.

#### Sáu phần frontend **chưa dùng được** ở quy mô này (đo, không sửa)

| # | Chỗ | Đo được |
|---|---|---|
| 1 | `DanhSachMay.tsx:109` | `.map()` toàn mảng ⇒ **549 `<li>` thật trong DOM**; gõ bộ lọc **263 ms/lần** |
| 2 | `TwinVanHanh.tsx:225-228` | **0 `<select>`, 0 `[role=combobox]`** — màn *duy nhất* thiếu picker (đối chứng `FactoryFloorEditor.tsx` có **9**) |
| 3 | `TwinVanHanh.tsx:270,278` | Banner **"373 machines not placed"** — ablation: dồn 1 tầng ⇒ banner biến mất; trải 176/187/186 ⇒ trở lại đúng **187+186=373**. **Máy tầng 2/3 bị khai sai** |
| 4 | `?pv=tapdoan` | breadcrumb "Corporate" nhưng `dem-may=549`, **1.592 máy của 3 NM `TAI-*` vắng mặt** |
| 5 | `navigation.tsx:446` vs `TwinVanHanh.tsx:388-395` | **"MỘT LỐI VÀO RỒI TỪ CHỐI"** (Khối D): nav cho vào bằng `analytics_oee`/`machine_status`, dữ liệu đòi `settings_factory`/`machine_control` ⇒ **màn trắng**. Mã **đã tự khai** lỗi này mà **chưa ai đo bằng tài khoản thật** |
| 6 | canvas | chỉ **360×473 px** ở viewport 1280×720 ⇒ 3D chiếm **~13%** màn hình laptop |

#### Spec SAI — §10C.6

**Bước lưới 400 m giữa các nhà máy**: ở quy mô **3 km/nhà máy**, 400 m làm 4 khối **lồng vào nhau**.
Và mục nghiệm thu *"tạo nhà máy thứ hai → phải hiện đủ hai khối"* — lô E tạo **bốn**, vẫn chỉ hiện
**một**. **Mục nghiệm thu này đang HỎNG và chưa ai chạy nó.**

#### Không chứng minh được — khai thẳng

Thang 50/150/300/549 máy cho FPS **không đơn điệu** (39/38/23/**57**). Lô E **tự loại dãy đó** khỏi kết
luận thay vì dùng nó để vẽ đường cong đẹp — **đúng**: một dãy không đơn điệu là dấu hiệu thiết bị đo
nhiễu, không phải dữ liệu.

### 11e.7 ĐỢT 10 — chia 3 lô theo tệp độc quyền (2026-09-07, chủ sở hữu duyệt)

| Lô | Việc | Tệp độc quyền |
|---|---|---|
| **F** | Gỡ 3 chỉ số `[0]` + ô chọn NM/toà/tầng · sửa banner "373 chưa xếp chỗ" · `?pv=tapdoan` · canvas | `TwinVanHanh.tsx` |
| **G** | Panel/modal tại chỗ thay redirect · cấp `may` (Cell twin) | `NganXuLy.tsx`, `nganXuLyLogic.ts` |
| **H** | Ảo hoá 549 `<li>` · **"một lối vào rồi TỪ CHỐI"** | `DanhSachMay.tsx`, `navigation.tsx` |

#### Đo được trước khi giao — ba manh mối tiết kiệm cả đợt

**1. Đường redirect của mục #5 nằm ở đâu** (tìm được sau khi đổi mẫu grep — **G9 cắn chính chủ dự án**:
mẫu `navigate\(|setLocation\(` cho **0 kết quả** trong `van-hanh/`):
`NganXuLy.tsx:107` nhận `onDieuHuong(href)` → `:528` `onClick` → icon **`ExternalLink`** `:530`;
`TwinVanHanh.tsx:1721` truyền **`onDieuHuong={setLocation}`** ⇒ **rời hẳn màn 3D**.
Đích: `nganXuLyLogic.ts:267-275` → `/robot/:id`, `/command-console?robotId=`, `/station-analysis/:id`.

**2. Các đích đó là MÀN KHÔNG ĐƯỢC XOÁ** (§11b/§11c.7) ⇒ mục #5 là **NHÚNG nội dung tại chỗ**,
**không phải dựng lại sáu tính năng ở Twin**. `MachineCockpit` đã export
**`MachineCockpitBody({machineId, embedded})`** — hình dạng để nhúng **có sẵn**.

**3. Mục #6 có nguồn **KHÔNG** gây lỗi cổng quyền**: `factoryCommand.overview`
(`factoryCommandRouter.ts:32-33`) trả *vị trí + trạng thái live + OEE + andon + PdM*, gate bằng
**`machine_status`** — **cùng cổng nav của `/twin`**. Khác hẳn truy vấn **hình học** (đòi
`settings_factory`/`machine_control`) vốn là thứ gây màn trắng ở §11e.6 mục 5.
⇒ Thống kê trên màn 3D dùng `overview` thì **không đẻ thêm một "lối vào rồi từ chối"** nữa.
`BangKpiNoi` (§11 #16) **chưa tồn tại** — sẽ tạo mới.

#### Ràng buộc chung ba lô
Không xoá màn/dữ liệu, không đổi lược đồ, DB gốc về **`factories` 2 · `machines` 43 ·
`twin_dat_cho` 82** (nghiệm thu bằng **MD5 từng hàng**), đo bằng vai **không-admin**
(admin **bypass** `requirePermission` ⇒ đo bằng admin chứng minh **0**).

### 11e.8 LÔ H ĐÃ VỀ — ảo hoá + cổng quyền, và **hai lỗ mới đo được** (2026-09-07)

Commit `67822401`. Cổng: **51 tệp / 1539 test** (nền 47/1433) · server twin **20/211** · `check` 0 · `build` 0.

**H1 — ảo hoá:** `<li>` **549 → 29**, gõ lọc **80,7 → 27,7 ms**. Ablation N=0/43/150/549 chứng minh
thiết bị đo không mù. **Không thêm thư viện** — tái dùng `computeVirtualWindow`
(`DataTable.tsx:289`, đã có 9 test canh) thay vì viết bản thứ hai (họ **G12**).

> #### ★★★ G36 — TỐI ƯU HIỆU NĂNG CÓ THỂ **PHÁ A11Y MÀ KHÔNG LỖI NÀO NỔ**
> Ảo hoá kiểu "cắt mảng, mỗi ô một `tabIndex`": máy thứ 400 **không có trong DOM** ⇒ Tab không bao
> giờ tới, **449/549 máy rơi khỏi tầm bàn phím**, không gì báo lỗi.
> **Đột biến số 2 là bằng chứng đắt nhất cả đợt**: cài bản ảo hoá **ngây thơ** ⇒ **2/11 đỏ — đúng
> hai ca a11y, mọi ca hiệu năng VẪN XANH**. Nếu chỉ đo hiệu năng thì bản vá nguy hiểm **đã đi qua cổng
> xanh**. Khuôn đúng: `role=listbox` + **một** điểm dừng Tab + `aria-activedescendant` + `aria-setsize`
> theo **mảng đã lọc**, con trỏ chạy trên dữ liệu chứ không trên DOM.

**H2 — chọn phương án (b) nới cổng đọc.** Ca dương **có sẵn trong seed**: `operator1` có đúng một
quyền `machine_status` ⇒ vào được nav, `trangThaiHangLoat` 200, nhưng `danhSachToaNha` và
`canhThietKe` **403**. Không chọn (a) vì siết nav = **xoá `/twin` khỏi `operator1`/`maint1`** — chính
các vai màn Vận hành sinh ra để phục vụ — và đảo ngược bản vá Đợt 5. **Sửa "vào rồi bị chặn" bằng
"không cho vào nữa" là đóng cửa thay vì mở đường.**

**Chứng minh không nới âm thầm — ba điều đo được:** chỉ **3 thủ tục đọc** được mở, mọi đường **ghi**
giữ `quyenThietKe` (`luuToaNha` vẫn **403**) · **phạm vi tenant không đi qua cổng quyền** mà qua
`trongPhamVi(..., phamViCua(ctx))` — **trục rời hẳn** · `/twin-studio` **không bị mở**. Test ghim cả cận
dưới lẫn **cận trên**.

> #### ★★★ LỖ QUYỀN THỨ HAI — `andon.active`, CHƯA VÁ (ngoài phạm vi lô H)
> `andonRouter.ts:165-166` đòi quyền **`andon`**, nhưng nav `/twin` chỉ đòi
> `analytics_oee`/`machine_status`. Chủ dự án đo độc lập trên 4 vai seed:
> `maint1` → **chỉ `machine_status`** · `operator1`/`supervisor1`/`engineer1` → **có `andon`**.
> ⇒ **`maint1` là vai DUY NHẤT mất dải cảnh báo** — và đó chính là **vai bảo trì**, người cần thấy
> cảnh báo nhất. Lô H bắt được **chỉ vì tự Read ảnh chụp**; phép đo API của nó **mù hoàn toàn**.

> #### ★★ LỌC TENANT VẮNG MẶT — `demVatThe` (có sẵn từ trước, chưa vá)
> `twinCanhRouter.ts:681` dùng `async ({ input })` — **không nhận `ctx`** — trong khi bốn thủ tục
> xung quanh (`:311,319,355,377`) đều truyền `phamViCua(ctx)`. `tangIds` **do client tự khai**.
> Cùng họ với bài học cũ *"hàng rào tenant lọc theo cột CLIENT TỰ KHAI"*.

**Đính chính số nền:** §11e.6 ghi cổng server twin là "17 tệp / 184 test"; đo lại **19 / 201**
trước khi chạm vào gì. **H3 (`?pv=tapdoan` phía server) CHƯA LÀM** — lô H khai thẳng, không giả vờ đã đo.

### 11e.9 LÔ G ĐÃ VỀ — xem chi tiết **không rời màn 3D** (2026-09-07)

Commit `a3eb2919`. Cổng: **51 tệp / 1539 test** · `check` 0 · `build` 0.
Chỗ gọi: `NganXuLy.tsx:582,590,611` · `TwinVanHanh.tsx:257,261,1949-1951`.
Mặc định = **tại chỗ** (icon `Maximize2`); `ExternalLink` giữ làm **lối thoát phụ**.

Nghiệm thu mắt (vai **không-admin**, trên `dist`): bấm "Cockpit đầy đủ" ⇒ URL
`/twin?pv=machine:2405&chon=machine:2405&cam=11.27,…&xem=machine:2405` — **vẫn ở `/twin`**, `pv`+`cam`
nguyên vẹn, cảnh 3D còn sống bên trái. Esc đóng · Back mở lại · F5 giữ ngăn · **0 lỗi console**.

> #### ★★★ G37 — MÀN TỰ ĐỌC ROUTE HỎNG **CÂM** KHI ĐẶT NGOÀI ROUTE CỦA NÓ
> `MachineCockpitBody` đã có sẵn nên dễ tưởng hai màn kia cũng nhúng được. Đo lại:
> **`RobotCockpit.tsx:885` dùng `useRoute("/robot/:id")`** và **`StationAnalysis.tsx:3` dùng `useParams()`**
> ⇒ đặt ngoài route của chính nó thì `id = NaN` → *"Invalid robot id"*. **Không exception, không
> cảnh báo** — chỉ một ngăn báo lỗi trông như dữ liệu xấu.
> ⇒ Trước khi nhúng một màn, **grep `useRoute`/`useParams`/`useSearch` trong chính nó**. Một màn
> đọc ngữ cảnh route là một màn **không nhúng được** cho tới khi tách thân — và tách thân phải
> **không đổi hành vi màn cũ** (đo lại `/robot/3`, `/station-analysis/2192`, và cả nhánh id-sai `/robot/abc`).

> #### ★★ G38 — TỰ KHAI PHẠM VI PHẢI ĐO, KHÔNG ƯỚC LƯỢNG
> Lô G được giao *"chỉ sửa đúng một dòng `:1721`"*, tự khai đã sửa **"~15 dòng"**. `git show --stat`:
> **570 dòng** trong `TwinVanHanh.tsx`. Việc vượt phạm vi là **đúng** (trạng thái ngăn phải đọc/ghi URL,
> một dòng không đủ) và nó **có khai báo** — nhưng **con số thì sai 38×**.
> ⇒ Khi một lô báo "tôi sửa khoảng N dòng", **chạy `git show --stat`** trước khi dựa vào N để đánh
> giá rủi ro xung đột. Đo được lúc ấy: lô F **chưa chạm** `TwinVanHanh.tsx` (tệp sạch) ⇒ không xung
> đột thật, nhưng đã cảnh báo lô F phải **đọc lại tệp từ đĩa** trước khi sửa.

**Ba đích CỐ Ý không nhúng** (khai rõ, không phải thiếu sót): `/control-plane`, `/command-console`
(**màn ra lệnh OT** — nhúng cạnh 3D là mời bấm nhầm), `/history`, `/traceability`, `/device-monitor`.
Chúng giữ `ExternalLink`, không mất chức năng. **G3 (cấp `line`) chưa làm** — khai thẳng.

**Lỗi nhỏ tự khai, chưa vá:** nhãn phụ của ngăn lấy từ **máy đang chọn** ⇒ mở ngăn robot/trạm vẫn
hiện mã máy. Thẩm mỹ, không sai chức năng — **khai thay vì vá lén**.

### 11e.10 LÔ F2 — **TIỀN ĐỀ BRIEF CỦA TÔI SAI: KHÔNG CÓ GÌ BỊ MẤT** (2026-09-07)

Commit `88e51e1e` (worktree riêng `D:/SOURCES/_twin_wt`). Cổng: **51 tệp / 1547 test** (nền 51/1539) ·
`check` 0 · `build` 0 · DB `factories 2 · machines 43 · twin_dat_cho 82`, 0 hàng rác.

> #### ★★★ G39 — "MẤT VIỆC" CẦN ĐO BẰNG GIT, KHÔNG SUY TỪ TRIỆU CHỨNG
> Tôi chẩn đoán lô F mất `TwinVanHanh.tsx` và giao lô F2 **dựng lại**. Lô F2 đo bằng git và **bác bỏ**:
> `ababe4c9:TwinVanHanh.tsx` còn `factories[0]` (**1** kết quả); `a3eb2919:TwinVanHanh.tsx` có
> **4** tham chiếu `boChonNap`/`BoChonNapUI`. ⇒ **Việc của lô F đã bị CUỐN vào commit mang nhãn lô G.**
> Nó không mất — chỉ **bị gán sai tên**, và thông điệp commit `a3eb2919` **không hề nhắc lô F**.
> Điều này cũng giải thích **G38**: 570 dòng ấy là **lô F + lô G cộng lại**, không phải lô G ước lượng sai.
> ⇒ Trước khi ra lệnh "dựng lại", **`git show <commit>:<tệp> | grep`** cả hai phiên bản. Dựng lại thứ
> đã có là cách tạo ra **hai bản cài đặt** của cùng một việc (họ **G12**).

> #### ★★★ G40 — HAI LÔ SHIP CHUNG MỘT COMMIT ⇒ **ĐƯỜNG NỐI GIỮA CHÚNG CHƯA TỪNG ĐƯỢC ĐO**
> `nap/thu` ghi URL qua `tronTrangThaiUrl`; `xem` ghi qua `tronXemVaoQuery`. **Hai hàm độc lập, một
> query string.** Vì cả hai lô vào **cùng một commit**, chưa lần chạy CI nào thấy chúng **tách nhau**.
> Phủ sóng cũ chỉ có "giữ tham số lạ" (`utm_source`) — chứng minh *"không xoá thứ không ai ghi"*,
> **không** chứng minh *"hai người ghi không đè nhau"*.
> **Ablation đắt nhất:** giữ đột biến số 2 còn sống, gỡ 6 test mới ⇒ **50/50 test cũ XANH**.
> Bộ test cũ **mù hoàn toàn** với lớp lỗi này.

**F3 — Lời khai của lô E SAI, và e2e đòi HÀNH VI SAI.** Chủ dự án đo độc lập:
`user_factory_assignments` nối bằng **`factoryCode`** (không có cột `factoryId`); `e2e_tai_loE`
(id 21075, `supervisor`) được gán **đúng 1**: `["SIM-FAC"]`. ⇒ `factory.list` trả 1 ⇒
**"Tập đoàn = 1 nhà máy" là câu ĐÚNG** — **hàng rào tenant chạy đúng**, không phải lỗi.
§11e.6 mục 4 (*"1.592 máy vắng mặt"*) **bị bác bỏ**. `e2e/twin-lo-f.spec.ts` từng assert
`expect(b.haCap).not.toBeNull()` — **đòi một lần hạ cấp KHÔNG ĐƯỢC PHÉP xảy ra** ⇒ test đó sẽ đỏ
trên một hệ **chạy đúng**. Đã viết lại, không đổi mã sản phẩm.

**Suýt thành BG-127 lần hai:** phép đếm đầu của lô F2 dùng `a."factoryId"` — cột **không tồn tại** ⇒
Postgres ném `42703`, **hỏng ồn ào**. Nếu lược đồ tình cờ có một cột `factoryId` vô nghĩa, phép đo đã
**âm thầm trả "0 nhà máy được gán"** và "xác nhận" câu chuyện sai của lô E.

**MÓN CÒN MỞ (lô F2 khai thẳng):** `e2e/twin-lo-f.spec.ts` **chưa từng chạy** — Playwright cần server
sống, worktree mới **không có `.env`** (chỉ có `.env.testbak`). ⇒ Số canvas F4 (**488×416**, thu cả hai
⇒ **968**) và `header.height` về **48** vẫn là **lời khai của lô F, chưa ai nghiệm thu độc lập**.

## 11f. DOT 11 - THONG KE TREN MAN 3D + HAI LO QUYEN/TENANT (2026-09-07)

Cong: **52 tep / 1566 test** (nen 51/1547) - `check` 0 - `build` 0 - DB `factories 2, machines 43,
twin_dat_cho 82`. Lo J `fe2c8c07`, lo K `47a5e602`. **Yeu cau #6 cua chu so huu: XONG.**

### 11f.1 Lo J - bang KPI noi tren canh 3D

Cho goi: `TwinVanHanh.tsx:2220` (render), `:1605` (`tinhKpiNoi`), `duongDanTwin.ts:145`.
Dung `overviewQ` **da co** o `:514` - khong goi them truy van nao. Do tren trinh duyet that:
**`drawCalls = 3` truoc va sau** => lop phu DOM ton **0 draw call** (muc 4 tran 150). `?thu=trai,phai`
(canvas 968) bang **van con**. Dung chung khoa `thu=`, **khong de khoa query thu nam** (G40).
`oeeTrungBinh = "-"` kem *"OEE measured on 0/41 machines"* - **honest-null** dung tren DB that
(ban `?? 0` se in *"OEE 0 %"*, mot loi khai sai).

> #### G41 - TINH NANG **HIEN RA DU MA DOC KHONG DUOC**: hai khuyet tat chi ANH bat duoc
> Ca hai cong deu **xanh** khi chung ton tai:
> 1. **Nhan 3D de len so** - `LopNhan.tsx:180` dung drei `<Html zIndexRange={[20,0]}>` => nhan o
>    z-index **20**; bang dat `z-10` bi *"SIM-L2-ICT - Unknown"* phu kin. Bang **hien ra nhung doc
>    khong duoc** - hong dung thu yeu cau #6 doi. Va `z-30`.
> 2. **Dong cuoi bi cat** - `max-w-[min(20rem,60%)]` o canvas 488 chi cho 196 px.
> => Mot lop phu thong tin phai nghiem thu bang **mat tren nen that**, khong bang "co render khong".

> #### G42 - `elementFromPoint` **BO QUA `pointer-events:none`**
> Phep do che-khuat dau tien cua lo J la **am-tinh-gia**: bao "ca 8 o bi che" boi phan tu **rong chu**,
> vi bang KPI **bat buoc** co `pointer-events:none` (de canvas nhan drag xoay). Do lai bang
> **thu tu ve** + ca duong da biet (17 nhan co chu) => 0 nhan chong lan o z >= 30.

**e2e lo F chay lan dau -> DO, va SPEC sai chu khong phai ma:** `twin-lo-f.spec.ts:74` doi
`soTang >= 3`, nhan **1**. Chu du an do doc lap: DB co **1 toa `TN-SEED-1` / 1 tang "Tang tret"**.
The gioi 3 tang/549 may **chi ton tai sau `sinh-tai-twin.ts`**. Lo J **khong noi assertion cho xanh** -
dung. **Loi khai canvas cua lo F sai 2/4:** canvas **488x453** (khai 416), `header.height` **56** (khai 48).

**J2 - brief cua toi SAI:** toi ghi "lo G chua lam cap `line`". Do lai: `phamViCanh.ts:65,235,298,320,323`
xu ly `line` that, `DaiLine` render o `TwinVanHanh.tsx:2338`, `?pv=line:1` cho breadcrumb + LINE STRIP
12 tram + cot WIP 3D. **Cap `line` da chay day du tu truoc.**

### 11f.2 Lo K - K1 **TU CHOI VA**, va do la ket luan cua phep do

Tien de brief cua toi (*"`maint1` mat dai canh bao IM LANG"*) **khong song sot phep do**. Ba dieu
chu du an kiem doc lap:
1. **Suy bien tu te DA CO** - `TwinVanHanh.tsx:1924` banner in **nguyen van duong tRPC bi tu choi**;
   `:2154` truyen `khongDoDuoc` => `DaiCanhBao` render `-`, **khong phai `0`**. `maint1` mat dai **ON AO**.
2. **Tien le lo H KHONG tai hien duoc** - lo H duoc noi cong doc vi chung minh **truc tenant di duong
   khac**. `andonRouter` **0 tham chieu** `phamViCua`/`trongPhamVi`, va `andon_events` **khong co cot
   tenant** => noi `andon` o day la **noi THAT**. No **tu choi noi thieu chuan chung minh cua lo H**.
3. **La quyet dinh san pham da viet ra** - `navigation.tsx:362`: *"maintenance thieu andon/canView se
   thay trang thai rong trung thuc"*.

> #### G43 - MOT MA 403 KHONG NOI NO DEN TU CONG NAO
> Do qua HTTP that, `maint1` tra **403 tren ca ba thu tuc** - nhung `appCode` la
> **`MUST_CHANGE_PASSWORD`**, khong phai `PERMISSION_DENIED`. Cong do chay **truoc** RBAC
> (`trpc.ts:163`; `maint1.passwordChangedAt = NULL`). Doc "403" roi ket luan "lo quyen" la **do nham
> han mot thu khac**. Chi sau khi tam go cong do moi thay `PERMISSION_DENIED` that tren module `andon`.

**K2 - RO RI TENANT THAT, da va va chung minh hai chieu.** `demVatThe` nay
`async ({ input, ctx })` -> `demVatTheTheoTang(input.tangIds, phamViCua(ctx))` (chu du an kiem tan noi).
Do tren **server song, build cu**: `maint1` - **0 nha may duoc gan** - van dem duoc **4 vat the** cua
tang SIM-FAC.

| tai khoan | duoc gan | truoc | sau |
|---|---|---|---|
| `maint1` | **khong co** | **4** | **0** |
| `e2e_tai_loE` | SIM-FAC | 4 | **4** |

**Dot bien (b) lo vung mu:** router quen `phamViCua(ctx)` => **khong test nao trong repo do**. Test cu
cua lo H chi canh 3 thu tuc `DOC_MO`. Da them `phamViTwinCanh.unit.test.ts` (luong phan toan tap).
**K3:** ca **20** thu tuc `twinCanhRouter` nay deu truyen `phamViCua(ctx)`.

**Brief cua toi sai so quyen** - toi ghi *"`maint1` => machine_status"* (1 module). Do lai: **17 module**
(lo K dem 18 ke ca hang het han). Phep do truoc cua toi **loc theo 3 module** nen chi thay 1 -
**G9 can chinh toi lan nua**.

## 11g. DOT 12 - DO LAI SO KIEM SAU DOT 8-11 (2026-09-07)

Dot 7 dem **18/62**. Bon dot da chay tu do. Chu du an **do lai tung muc bang cho goi that**
(G16), khong cong loi khai.

### 11g.1 Muc da dong, kiem bang CHO GOI trong `client/src`

| Module | Muc | Cho goi |
|---|---|---|
| `khungNhin` | #58 | 21 |
| `xuatAnh` | #57 | 10 |
| `banDoNho` | #56 | 3 |
| `vungAnToan` | #5 | 7 |
| `VeVung` | #42 | 2 |
| `DaiCanhBao` | #12-14 | 5 |
| `CayPhanCap` | #8-11 | 9 |
| `docStatsAoi` | #60 | 2 |
| `nhipHoiToiDa` | #51 | 4 |
| `wipTram` | #61/#32/#36 | 2 |
| `BangKpiNoi` | #16 | 3 |
| `NganNhung` | #5 nhung | 22 |
| `boChonNap` | o chon nap | 2 |

**Khong module nao la ham chet** - khac han Dot 7, noi `nhipHoiMs` va `wip` co du ma ma **0 cho goi**.

### 11g.2 Sau muc THAT SU con thieu - do trong PHAM VI TWIN

Phep dem tho tren toan repo **gay hieu nham** (G9): `heatmap` ra **409**, `whatIf` ra **26** - phan lon
nam ngoai Twin. Do lai chi trong `twin3d` + `TwinVanHanh.tsx` + `TwinStudio.tsx`:

```
uploadAndRegister  0     taiAnhNen  0     twin_ban_ghi  0
boNhoModel         0     whatIf     0     usdExport     0
```

=> **#18, #43, #55, #4, #30/#35/#36, #1** chua co trong Twin. `ArticulatedRobot` ra 1 nhung do la
**chu thich** o `hinhKhoiMay.ts:365`, khong phai ma chay (#3 chua lam).

### 11g.3 `DongThoiGian` - lop loi G16 LAP LAI

`DongThoiGian.tsx:62` export component that (thanh tua lai 24 gio, muc 9.8) nhung **0 cho goi san pham**
trong toan `client/src`. Day dung lop loi Dot 7 phat hien voi `nhipHoiMs` va `wip={[]}`: **co ma,
co the co test, khong giao duoc gi**.

=> Dot 12 chia hai lo: **L** noi `DongThoiGian` (#37/#38) + ngan Mo phong (#30/#35/#36) +
heatmap/prediction/health (#31/#33/#34); **M** nhap model (#18/#4), anh nen CAD (#43), CRUD layout (#55).

**Rang buoc mang sang lo L:** `commandLog.avgDurations` **KHONG phai cycle time** (muc 11c.3 da do) -
no la do tre ACK lenh; dung nham thi mui ten chay **nhanh gap 150 lan**. Nguon dung:
`line_balance_metrics.avgCycleTimeMs`, kem `conHieuLuc` 8h (G30).

**Rang buoc mang sang lo M:** `boNhoModel.ts` **khong ton tai** - spec ghi sai dich; lo M tu chon kien
truc hop voi `mucChiTiet.ts` (da co LRU 8 GLB). Va **cam migration** - `twin_ban_ghi` co bang nhung
0 hang/0 consumer, neu hop dong khong dung duoc thi **bao lai**.

### 11g.4 LO L DA VE - VA BAC BRIEF CUA CHU DU AN O HAI CHO (2026-09-07)

Commit `30165f93`. Cong: **55 tep / 1632 test** (nen 52/1566) - `check` 0 - `build` 0 - DB nguyen ven.

> #### G44 - GREP LOC BO `import` CO THE LOC BO CA CHO GOI JSX
> Toi khai *"`DongThoiGian` co ma, 0 cho goi san pham"*. **SAI.** Chu du an do lai:
> `TwinVanHanh.tsx:2107` da render `<DongThoiGian>` tu commit `444151f3` (Dot 6), va no **noi day
> that**: `mocTua` dieu khien `twinCanh.anhLichSu` va **chan** goi realtime khi dang tua.
> Loi cua toi: grep ten roi loc bo dong `import` - **loc luon ca dong render JSX** vi ca hai deu
> chua ten do. Day la **G9 lan thu ba** trong cung mot du an.
> => Khi grep de tim cho goi, dem **rieng** cac dang: `import`, `<Ten`, `Ten(`, `= Ten`.

**Bac thu hai - #36 DA VA TU TRUOC:** brief toi canh bao `commandLog.avgDurations` dung nham.
Do lai: `TwinVanHanh.tsx:579-590` docblock ghi ro **nguon DUNG la `line_balance_metrics.avgCycleTimeMs`
qua `wip.lineBalance`**, tieu thu that o `:2190`/`:2368`. Khong con gi de sua.

**Mon THAT SU chua ai goi (dung lop loi G16, khac symbol):** `docThoiGian`/`ghiThoiGian` + khoa `tg=`
da du trong `duongDanTwin.ts`, co test - va **0 cho goi**; `mocTua` nam trong `useState`. He qua: F5
mat cho dang xem, khong gui duoc link *"xem giup luc 08:30"*, Back khong quay lai moc.
**Da noi:** `TwinVanHanh.tsx:714` (`mocTua = urlState.tg`), `:716` (`ghiUrl({tg})`) - chu du an kiem tan noi.

`mocTheoBuoc()` **can ve bien** thay vi `moc + delta`: cong tho khong bao gio dat chan len moc tron
(slider `step=60_000` neo theo `min`=`Date.now()`). Hai luat con: lech bien thi buoc dau **chi can ve
bien** (neu khong, 09:00 la moc **khong bao gio** toi duoc bang phim); dung bien thi **di tron o**
(neu khong => `f(x)=x`, G32).

> #### G45 - "KHONG LAM" CO THE LA KET LUAN DO DUOC, KHONG PHAI BO SOT
> **#38 (toggle Du doan) KHONG LAM** - va do la ket luan dung. `digitalTwin.predictionOverlay` doc
> `wip_tracking` voi lookback **24h cung** va can >=3 diem. Chu du an do doc lap:
> `wip_tracking` co **7.048 hang** nhung **0 hang trong 24h**, ban ghi moi nhat **17 ngay tuoi**
> => moi line ra `series.length=0` => `available:false`.
> **#31 (heatmap):** `product_inspections` = **0 hang** => heatmap vinh vien trong.
> => Lam toggle/heatmap tren nguon do la **cong xanh tren tap RONG** (G5). Can seed truoc.
> Lo L **khong lam do** va **noi thang** - dung hon la giao mot tinh nang khong bao gio hien gi.

**Anh dau tien cua lo L chi co spinner** - no **tu doc va tu loai**, chup lai moi thay dai tua that.
Neu khong tu nhin, mot anh vo gia tri da thanh bang chung.

**Bay con lai cho nguoi sau:** `noiChoGoi.unit.test.ts` **grep VAN BAN THO** - docblock trich nguyen
van `` `wip={[]}` `` lam luoi do; no **khong phan biet duoc ma voi van xuoi**.

**Cong 3000 la server cua PHIEN KHAC** (PID 28480). Nghiem thu dau cua lo L tren 3000 cho ket qua SAI
vi no phuc vu **bundle cu**. Chuyen sang 3123, khong dung PID kia.

### 11g.5 LO M DA VE - 4/4 muc, va hai loi CHI ca duong bat duoc (2026-09-07)

Commit `66fd7dc9`. Cong: **56 tep / 1650 test** (nen 52/1566) - `check` 0 - `build` 0 -
DB `factories 2, machines 43, twin_dat_cho 82` nguyen ven.

| Muc | Cho goi (chu du an kiem doc lap) |
|---|---|
| #18 nhap glTF | `XuongThietKe.tsx:993` `<ThuVienAsset>` |
| #4 LOD + ModelErrorBoundary | `CanhThietKe.tsx` `<LopModelMay>`; `napModel.ts:45` dung `mucChiTiet.ts` |
| #43 anh nen CAD | `XuongThietKe.tsx:1009` `<AnhNenTang>` |
| #55 CRUD ban ghi | `XuongThietKe.tsx:1020` `<BanGhiBoCuc>` |

`mucChiTiet.ts` truoc day **0 cho goi** - nay duoc dung that. Lo M **khong dung `boNhoModel.ts`**
(spec ghi sai dich) ma **tai dung LRU 8 GLB da co** (G12).

> #### G46 - HAI LOI MA CHI CA DUONG TREN NEN THAT BAT DUOC
> 1. **`twin-assets/` KHONG DOC DUOC.** `_uyQuyenAnh.ts:209` la allowlist **dong**, tra 403
>    `image_path_shape_unknown`. Duong **ghi** tra 200, hang dang ky **dung**, `bounds` **da day** -
>    chi khi doc lai trong trinh duyet that moi lo. Trieu chung se la mot may **am tham roi ve khoi
>    mac dinh**, khong phan biet duoc voi model hong that.
> 2. **LOD KHONG BAO GIO CHAY.** `camera` la tham chieu **on dinh** (three doi `position` **tai cho**),
>    nen `useMemo` khong bao gio chay lai => **0 request `.glb` ke ca sau khi zoom**. Day dung lop loi
>    L-1 ma lo M duoc giao di dong, **tai xuat hien o cho tinh vi hon**. Va bang `useTheoDoiCamera`
>    (250 ms + nguong 2 m): sau va **4 request, 3 dap ung HTTP 200**.
> => Mot gia tri **doi tai cho** khong kich hoat `useMemo`/`useEffect`. Nghiem thu bang **so request
>    that**, khong bang "ham co duoc goi khong".

**Brief cua chu du an KHONG DAY DU o M1:** toi ghi `uploadAndRegister` = 0 trong Twin. Dung - nhung
thu tuc **co ton tai** (`twinRouter.ts:129`) voi nguoi goi song o `MachineCockpit.tsx:740`. No chi
buoc **cap MAY** (`machineId` bat buoc, `modelKey` cung), nen **cap CHUNG LOAI** - tang gia tri nhat
theo §10B.2 - khong co duong. Lo M **them `phamVi` thay vi noi long thu tuc dang chay** (dung).

**Spec so dong cu:** `taiAnhNen` o `twinCanhRouter.ts:457`, khong phai `:398`.

### 11g.6 BA MON CAN CHU SO HUU QUYET - lo M BAO, KHONG TU SUA (cam migration)

Chu du an do doc lap ca ba:

1. **`twin_ban_ghi` thieu `UNIQUE ("tangId", nhan)`** - do bang `pg_constraint`: chi co
   `twin_ban_ghi_pkey` + 2 khoa ngoai, **khong co UNIQUE nao**. Lo M cuong che o tang ghi
   (find-before-create; ha co trong **mot** giao dich) nhung do la **hang rao MEM** - hai lan ghi
   dong thoi van lot.
2. **`taiAnhNen` bat buoc `anhBase64`** (`twinCanhRouter.ts:483`) => buoc "Dat ti le" phai **gui lai
   ca anh** => moi lan hieu chuan de ra **mot tep mo coi**. Can thu tuc `datTiLeTang` chi nhan
   `{tangId, tiLeMmMoiPx}`.
3. **Hang model cap chung loai la TOAN CUC** - so dang ky khong co cot pham vi cho hang cap lop.
   Hang rao cua lo M chan **ai duoc ghi**, khong chan **ai bi anh huong**.

**He qua tich cuc:** #43 va #42 la **hai chan tro that** cua viec go `FactoryFloorEditor` (§11c.4).
Ca hai nay da xong => **rang buoc do duoc go**. Lo M **khong xoa gi** vi cong §11 con xa moi mo - dung.

### 11g.7 LO N - #1 nut xuat USD XONG - #3 robot khop noi KHONG LAM DUOC (2026-09-07)

Commit `88095499`. Cong: **57 tep / 1667 test** (nen 56/1650) - `check` 0 - `build` 0 - DB nguyen ven.
Cho goi: `TwinVanHanh.tsx:1998` (nut), `:2090` (bang ket qua), module thuan `xuatUsd.ts` (+17 test).

> #### G47 - "DEGRADE-SAFE" LA CAI BAY: 200 + noi dung HOP LE + RONG NGHIA
> `buildFactoryUsda` voi nha may rong tra stage USDA **hop le ma 0 prim**, **HTTP 200**, khong nem loi.
> Do qua HTTP bang `operator1` (non-admin):
> - factory 1 -> **40.024 byte / 142 prim** (canh that)
> - factory 2 -> **115 byte / 0 prim** - `"empty stage (no factory)"`
>
> Hai ket qua di qua **dung mot duong ma**. `byteLength` **KHONG phan biet duoc** (115 van qua moi
> `length > 0`). => Cong ra phai dem **don vi NGHIA** (prim), khong dem byte. Day la G28 o dang manh
> hon: khong chi "anh trang khong loi" ma "**tep hop le ma rong nghia**".

**Ba cho brief/spec SAI (lo N do, chu du an kiem lai ca ba):**
1. **Dich §11 #1 sai** - `NganXuLyProps` pham vi **MOT MAY**, `usdExport` nhan `{factoryId}`. Dat o do
   thi nut **bien mat dung luc can nhat** (chua chon may) va **noi doi ve pham vi** khi da chon.
   Lo N dat o **thanh cong cu man Van hanh**, cung pham vi toan man.
2. **Brief noi "cho goi Twin duy nhat la `DigitalTwinCenter.tsx:606`"** - dung theo nghia Twin, nhung
   thuc te co **hai** cho goi `usdExport`; cho kia la `SystemHealth.tsx:592`. Khong dung ca hai.
3. **Brief noi "cung cong nav => khong de them loi-vao-roi-tu-choi"** - **chi dung mot nua**. Nav `/twin`
   la `analytics_oee` **HOAC** `machine_status`; `usdExport` chi nhan `machine_status`. Chu du an do
   tren `permissions` that: **0 tai khoan** roi vao khe (moi hang `analytics_oee` deu kem
   `machine_status`) => **rui ro tiem tang, khong phai loi dang xay ra**. Nut **an** thay vi hien-roi-chan.

> #### G48 - CHON NHAM COT CHO CUNG MOT KET LUAN VI LY DO SAI HAN
> #3 khong lam duoc. Lo N do bang **hai mo hinh roi**: 0 khoa ngoai lien quan `robots` trong toan luoc
> do; `machines JOIN robots ON code` = 0. Va enum `twinthuctheenum` =
> `workshop|line|station|machine|workstation` - **khong co `robot`** (chu du an kiem tan noi).
> => Noi Twin<->joints doi **gia tri enum moi = migration**, ma lo nay bi **cam** doi luoc do.
>
> **Bay cot, do duoc:** `robot_telemetry.joint_states` = **0 hang khac NULL**, nhung
> `robot_telemetry."poseJson"` = **1.097.349 hang**. Chon nham cot thi ket luan *"khong co du lieu khop"*
> se **SAI hoan toan** - ma van ra **cung mot cau** "chua lam duoc", vi ly do khac han.
> => Khi ket luan "nguon rong", phai noi **rong o cot nao** va da thu **cot thay the** nao.

**Lo N khong dung du lieu tam** - dung: cai thieu khong phai *du lieu* ma la *duong dia chi hoa*;
dung tam cung khong lam hien duoc gi. §11 #25 (joints) da xep dich = **GIU O RobotCockpit**
(`nganXuLyLogic.ts:261`), khong phai Twin.

**Con mo:** khe quyen `analytics_oee`-ma-khong-`machine_status` (hom nay **0 tai khoan**) - chua ai quyet
co nen noi `usdExport` thanh `requireAnyPermission` nhu `quyenVanHanh` khong.

## 11h. DOT 14 - NHA MAY 4 TANG + GOP DIGITAL TWIN VAO 3D FACTORY (2026-09-07)

Chu so huu giao hai viec, va **giua chung doi huong viec 2**:
> *"Voi muc 2 can lam mot ban thiet ke chi tiet tung man hinh, tung nghiep vu tung hanh dong tren
> 3D Factory va xay dung 3D Factory sau do chung ta se ban them truoc khi di den mot ke hoach
> nang cap cu the"*

=> **Viec 2 chuyen thanh: VA LO BAO MAT + VIET THIET KE**, khong xay them tinh nang moi.
Ban thiet ke se duoc **dem ra ban** truoc khi co ke hoach nang cap.

### 11h.1 Viec 1 (lo P) - nha may moi 4 tang x 5 line x 12 may = **240 may**

Rang buoc mang sang: `machines.stationId` **bat buoc** - may khong treo thang vao line;
`twinnguonenum` chi co `sinh|tay` => co dat theo **MA**, **cam them gia tri enum**; bang `twin_*` dung
**mm** (§10A.0 cam `floorWidthM`); **Z la chieu cao**; §10C.6 buoc luoi 400 m **sai** o quy mo km.
Script `sinh-tai-twin.ts`/`go-tai-twin.ts` **da co** (`b21a05e3`) - mo rong, **dung viet ban thu hai** (G12).

**Diem then chot cua viec "mo phong":** hai nguon mo phong dang **RONG** (§11g.4 do duoc):
`wip_tracking` **0 hang trong 24h** (moi nhat **17 ngay**) va `product_inspections` **0 hang**.
=> Nha may moi **phai sinh kem du lieu van hanh** (WIP, telemetry, andon) voi **moc thoi gian gan hien
tai** (G30: `conHieuLuc` 8h se loai du lieu cu). Khong thi se giao mot canh 3D dep ma **moi lop phu
deu trong** - dung cai bay G5.

### 11h.2 Viec 2 (lo Q) - **DO TRUOC KHI GIAO**: bon trang cu, 3.378 dong, 12 thu tuc

| Trang | Dong | Thu tuc tRPC |
|---|---|---|
| `DigitalTwinDashboard` | 606 | `digitalTwin.twinState` `defectHeatmap` `stationLoadHeatmap` `predictionOverlay` `whatIf` |
| `CommandCenter` | 1596 | `commandCenter.hierarchy` `kpiSummary` `recentAlerts` `status` + `twin.sceneGraph` |
| `DigitalTwinCenter` | 936 | `twin.sceneGraph` `twin.status` `machineStatus.listWithStatus` |
| `FactoryLiveMap3D` | 240 | `machineStatus.listWithStatus` |

`DigitalTwinDashboard` giu **dung 5 muc Twin con thieu**: #30 `whatIf` - #31 `defectHeatmap` -
#32 `stationLoadHeatmap` - #33 `predictionOverlay` - #34 `twinState`.

> #### G49 - **GOP MOT ROUTER CHUA LOC TENANT LA MANG RO RI VAO TRUNG TAM**
> `digitalTwinRouter` co **0 tham chieu** `phamViCua`/`resolveTenantFactoryScope`/`trongPhamVi`
> (chu du an do), va `twinState:33-40` nhan `stationId` **do client tu khai**. Moi thu tuc chi
> `protectedProcedure` - **khong cong module nao**.
> Day **dung lop loi lo K vua va** o `demVatThe`: `maint1` - 0 nha may duoc gan - van dem duoc vat the
> cua SIM-FAC.
> => **Va truoc khi gop.** Gop mot nguon chua loc vao man trung tam la nhan rong pham vi ro ri, khong
> phai them tinh nang. Co san `phamViCua(ctx)` + `trongPhamVi(...)` + test luong-phan
> `phamViTwinCanh.unit.test.ts` - **dung lai** (G12).
>
> **He qua phu dang chu y:** vi router nay **khong co cong module**, gop no vao `/twin` **khong** de
> them "mot loi vao roi tu choi" - nhung cai gia la no cung **chua tung chan ai**.

### 11h.3 Yeu cau **honest-null** cho hai muc nguon rong

`predictionOverlay` luon `available:false` va `defectHeatmap` vinh vien trong (do o §11g.4).
=> Hai muc do phai hien **`-` kem ly do** (*"do tren 0/N"*), **KHONG** hien `0`. Ban `?? 0` la
**loi khai sai**. `BangKpiNoi` da lam dung khuon nay (§11f.1).

### 11h.4 LO Q DA VE - Q1 va lo tenant, §12b thiet ke 282 dong (2026-09-08)

Commit `cd56d186` (ma) + `d5d60634` (thiet ke). Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0.

**Q1 - lo do duoc TRUOC khi va:** tai khoan **0 nha may duoc gan** doc duoc **43/43 may** va
**4.707 WIP** cua SIM-FAC. Chu du an kiem lai: `digitalTwinRouter` truoc do **0 tham chieu** loc tenant,
**nay 15**. Chung minh hai chieu tren CSDL that (vai `engineer` khong-admin):

| | 0 nha may | duoc gan SIM-FAC |
|---|---|---|
| `twinState` | **0** | **42** |
| `wipFlowState` line 1 | **0** | **4.707** |
| `stationLoadHeatmap` | **0 cells** | 1 cell |

Va o **tang router** (db functions con caller khac), **hai truc**: `idsTrongPhamVi` cho `machines`,
`congMaTenant` cho `product_inspections`. **7 dot bien, giet ca 7.** Dang chu y: dot bien (f)/(g) **chi**
bi bat boi o dich danh - hai o phan doi tong quat **de lot**.

> #### G50 - **DU LIEU CO MA VAN VO DUNG: cot pham vi de TRONG**
> Brief cua chu du an ghi `product_inspections` = 0 hang (do o §11g.4). **Da doi**: nay co **2.880 hang**.
> Nhung chu du an do lai: **ca 2.880 deu `factoryCode IS NULL`** => sau Q1, vai duoc gan nha may thay
> **0 hang**; chi admin (bypass) thay.
> => **Fail-closed dung huong** - nhung "co du lieu" **khong** dong nghia "dung duoc". Cach chua **SAI**
> la noi cong quyen cho du lieu hien ra; cach dung la **dien `factoryCode`**.
> Cung the voi `wip_tracking`: nay co 2.704 hang/24h, nhung `predictionOverlay` **van chan** vi
> `station_dwell_time` moi nhat **17 ngay** - **mot nguon thu hai** ma khong ai nhin toi.

> #### ★★★ L-1 (LO Q PHAT HIEN, CHUA VA) - `createWorkOrder` KHONG BOC `ctx`
> `maintenanceRouter.ts:89` `createWorkOrder` khai `.mutation(async ({ input }) => ...)` - **khong nhan
> `ctx`** - roi tra `machines` bang `input.machineId` **do client tu khai**, khong kiem pham vi.
> Doi chung trong **cung tep**: thu tuc o `:256` **co** dung `async ({ input, ctx })`.
> **Be mat do duoc:** 283 may tren 3 nha may (`FUYU-G` 240, `SIM-FAC` 42, id-18 1) => mot tai khoan o
> nha may A **tao duoc phieu cong viec cho bat ky may nao** cua nha may B.
> => Cung lop loi voi `demVatThe` (lo K) va `digitalTwinRouter` (lo Q), nhung o **DUONG GHI** - nang hon
> duong doc. **Chua va vi ngoai pham vi tep duoc giao** - can chu so huu ky.

**Ba trong bon trang cu DA bi gop san** thanh tab `TwinHub` (`TwinHub.tsx:41-43`) => pham vi viec 2 **nho
hon** brief tuong. §12b chot **GOP 7 / BO 6**, moi cai kem ly do.
Dang chu y **B-5**: bo `stationLoadHeatmap` **khong** vi trung lap ma vi **no khong tu chung minh duoc
minh con han** (G30) - lo truoc da co y go, ly do o `TwinVanHanh.tsx:574-582`.

**Q3 do duoc:** `TwinVanHanh.tsx` co **dung 0 mutation**; 5 duong ghi W1-W5 deu `requirePermission`.
Luat **an-khong-disable** da theo dung, con **mot** cho lech: `RobotCockpit.tsx:916-918`.

**Lo Q noi thang dieu khong nen lam:** khong nhung bang lenh OT canh 3D, ba ly do do duoc - khop voi
quyet dinh cua lo G truoc do.

**Dinh chinh so nen cua chu du an:** cong 2 (tap twin) **khong phai "20 tep/211 test xanh"** - nen tren
HEAD sach la **20 tep / 226 test, trong do 3 DA DO** (census pin lech do lo khac). Lo Q dong them 1,
**khong them do nao**.

### 11h.5 LO P DA VE - nha may 240 may + mo phong SONG (2026-09-08)

Commit `8fa28e17`. Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0 -
DB sau khi go **`factories 2, machines 43, twin_dat_cho 82`, 0 hang rac** (chu du an kiem doc lap).

**Hieu nang o 240 may** (yeu cau chu so huu: 4 tang x 5 line x 12 may):
**3 draw calls** (tran 150) - **60,3 FPS** (san 30) - tai **1,18 s** - 3.422 tam giac.
Nghiem thu **go truoc khi sinh khoi lon**: **16/16 bang khop tuyet doi** (dem + MD5 tung hang).

**Mo phong da SONG** (do qua API that, vai supervisor khong-admin):
`predictionOverlay` **`available: true`** (truoc lo nay **vinh vien false**) - `defectHeatmap` **240 may**,
346 NG/2.880 - `wipFlowState` 139 WIP/12 tram, nut that WIP **trung** `bottleneckStationId` server khai.

> #### G51 - **NGUONG TUOI NGHIEM NGAT NHAT KHONG PHAI CAI BRIEF NHAC**
> Brief cua chu du an dan "moc gan hien tai, `conHieuLuc` 8h". Rang buoc **nang nhat thuc ra la 5 PHUT**:
> `NGUONG_CU_MS = 300s` (`mauTrangThai.ts`) - qua do **240 may hoa xam** du moi bang day du lieu.
> => Khi giao "sinh du lieu tuoi", phai **liet ke MOI nguong tuoi tren duong hien thi**, khong chi cai
> minh nho. Lo P them `--chi-nhip` de lam tuoi mau ma khong sinh lai.

> #### G52 - **`npm run check` KHONG BAO VE `scripts/`**
> Mot backtick lac trong chu thich SQL lam script **khong chay noi**, ma cong 2 (`check`) **van exit 0**.
> => Cong go/sinh du lieu phai co **test parse rieng**; `tsc --noEmit` khong phu thu muc nay.

> #### G53 - **PHAM VI PHEP GO PHAI SUY TU DO THI THAM CHIEU, KHONG TU DANH SACH INSERT**
> Server **tu bom 100.800 hang `ot_telemetry`** vao may cua lo P - khong nam trong danh sach INSERT nao
> cua script. Quet theo **khoa ngoai** **bo sot** `predictive_alerts`; chi quet theo **ten cot** moi thay
> (BG-127: hai mo hinh roi). Va **Timescale**: DELETE tren hypertable nen (28,3M hang) chay 10 phut roi
> do `53400` - giao dich **quay lui sach**, dung ly do moi phep xoa nam trong mot `begin`.

**★ Anh dau tien cua lo P la ANH TRANG HOAN TOAN** (bay `preserveDrawingBuffer=false`, G28). No **tu doc,
tu loai, chup lai** bang viewport. Day la lan thu ba trong du an mot lo tu bat anh vo gia tri cua chinh no.

### 11h.6 MON CAN CHU SO HUU QUYET - **8.197 hang mo coi la RAC CUA DOT 9**

Lo P bao "co san tu truoc, khong phai cua toi" - **dung**. Chu du an truy nguon goc bang hai mo hinh:

| Ngay tao | So hang |
|---|---|
| **07/09** | **8.180** |
| 03/09 | 3 |
| 18/08 | 14 |

Tien to ma: **`FUYU-F` 6.588** - `TAI-C`/`TAI-D` ~740 - deu la **du lieu thu cua LO E (Dot 9)**.
=> Khong phai rac ngoai du an: **script go cua lo E BO SOT bang `machine_health_history`**, dung lop loi
ma G53 mo ta (pham vi go suy tu danh sach INSERT thay vi do thi tham chieu).
⇒ **Xoa chung la XOA DU LIEU** - can chu so huu quyet, khong tu lam.

**Hai mon con mo khac (lo P khai thang, khong xu):** `oee_metrics` **897 hang, 0 trong 24h**, chi 36 may
SIM-FAC ⇒ man hien **"OEE measured on 0/240"** - **nguon rong thu ba**. Va nhan tung may van hien
"Unknown" du o dem da 240 tuoi.

**Giu lai de xem** (hien **da go** de chung minh cong 5):
```
npx tsx scripts/sinh-tai-twin.ts --240        # dung lai 240 may
npx tsx scripts/sinh-tai-twin.ts --chi-nhip   # lam tuoi mau (moi <5 phut)
npx tsx scripts/go-tai-twin.ts                # go - DUNG SERVER TRUOC
```

## 11i. DOT 15 - CHU SO HUU DUYET §12b, MO DOT XAY (2026-09-08)

Chu so huu **duyet ca ba**: va L-1, don 8.197 hang mo coi, va danh sach **GOP 7 / BO 6** cua §12b.
Thu tu lam theo **§12b.5** - ba thu **CHAN** phan con lai di truoc.

### 11i.1 Chia lo

| Lo | Viec | Tep doc quyen |
|---|---|---|
| **R** | **L-1** va lo ghi xuyen tenant (2 thu tuc) - don 8.197 hang mo coi - **P-3** an-khong-disable | `maintenanceRouter.ts`, `andonRouter.ts`, `RobotCockpit.tsx`, `scripts/go-tai-twin.ts` |
| **S** | **P-1** dien `factoryCode` - **P-2** sinh `station_dwell_time` | `scripts/sinh-tai-twin.ts`, `scripts/_lib/**`, duong ghi `product_inspections` |

### 11i.2 L-1 co **HAI** thu tuc, khong phai mot

Ban thiet ke §12b.6 tim ra thu hai; chu du an kiem lai ca hai:

| Thu tuc | `file:line` | Hinh dang |
|---|---|---|
| `maintenance.createWorkOrder` | `maintenanceRouter.ts:89` | `.mutation(async ({ input }) => ...)` - **khong boc `ctx`**; tra `machines` bang `input.machineId` client tu khai |
| `andon.acknowledge` | `andonRouter.ts:125-131` | **Co** `ctx` (dong dau nguoi tiep nhan) nhung **khong kiem `input.id` thuoc pham vi nguoi goi** |

**Doi chung trong cung tep:** `maintenanceRouter.ts:256` **co** dung `async ({ input, ctx })`.
**Be mat do duoc:** 283 may / 3 nha may => mot tai khoan o nha may A **tao duoc phieu cho bat ky may
nao** cua nha may B, chi can doan `machineId`.

> #### G54 - `andon_events` **KHONG CO COT TENANT** => pham vi phai SUY QUA PHAN CAP
> Chu du an do: cot bang la `id, state, reason, status, lineId, stationId, machineId, ...` - **khong co
> `factoryId`/`factoryCode`**. Pham vi phai suy qua `machines -> stations -> production_lines ->
> workshops -> factories`.
> **Va ca ba cot `lineId`/`stationId`/`machineId` deu CO THE NULL** - hang NULL ca ba thuoc pham vi ai?
> Day la mot **quyet dinh**, khong phai chi tiet ky thuat; **fail-closed la mac dinh an toan**.

### 11i.3 P-1 - cai bay da duoc canh bao TRUOC

`product_inspections` 2.880 hang, **ca 2.880 `factoryCode IS NULL`**. Sau khi lo Q va loc tenant, vai
khong-admin thay **0 hang**.

> **Cach chua SAI: noi cong thanh "NULL thi cho qua".** Do la **mo lai dung lo ma lo Q vua va**, cho moi
> tenant doc moi hang chua khai. Cach **DUNG**: **dien `factoryCode`** - ca o **duong ghi** (de khong de
> them hang NULL) lan **du lieu san co** (suy tu chuoi phan cap, chi dien hang **suy duoc chac chan**).

### 11i.4 P-2 - nguon thu hai ma khong ai nhin toi

`predictionOverlay` **van chan** du `wip_tracking` nay co 2.704 hang/24h - vi **`station_dwell_time` moi
nhat 17 ngay**. Day la **G50 o dang thu hai**: sua mot nguon xong van khong mo duoc tinh nang, vi con
mot nguon nua.
⇒ Khi mot tinh nang "van khong chay du da co du lieu", **liet ke MOI bang no doc**, dung dung lai o
bang dau tien.

### 11i.5 LO S DA VE - **BAC CA HAI TIEN DE CUA CHU DU AN** (2026-09-08)

Commit `6ee7150a`. Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0 - DB
`factories 2, machines 43, twin_dat_cho 82`, `station_dwell_time` ve **8.652**.

> #### ★★★ G55 - **SO DO CO HAN SU DUNG: mot phep do dung LUC AY co the SAI LUC GIAO VIEC**
> Brief cua chu du an ghi *"`product_inspections` 2.880 hang, ca 2.880 `factoryCode` NULL"* - **do that,
> luc do**. Lo S do lai bang **hai mo hinh roi**: `count(*)` = **0** va `n_live_tup` = **0**.
> Chu du an kiem lai: **dung 0**.
> Ly do: 2.880 hang ay la cua **lo P**, va `go-tai-twin.ts` **da don chung** khi thao FUYU-G - dung nhu
> thiet ke. Giua luc do va luc giao viec, **the gioi da doi**.
> => **Do lai ngay truoc khi lam**, dung tin so trong brief - ke ca brief cua chinh minh viet 1 gio truoc.
> Cung ho voi G30 (*"loi khai trong DB khong co han dung"*), nhung o **tang dieu phoi**: **con so trong
> mot ban giao viec cung co han su dung**.

> #### ★★★ G56 - **"NGUON THU HAI" GAN NHAM THU TUC** (loi suy luan cua chu du an)
> Chu du an ket luan: *"`predictionOverlay` van chan vi `station_dwell_time` moi nhat 17 ngay"*.
> **SAI.** Lo S do tai nguon, chu du an xac minh tan noi:
>
> | Thu tuc | Ham | Bang |
> |---|---|---|
> | `predictionOverlay` | `getWipCountSeries` (`db/twin.ts:88`) | **`wip_tracking`** |
> | `stationLoadHeatmap` | `getStationDwellAgg` | **`station_dwell_time`** |
>
> **Hai thu tuc, hai bang, KHONG giao nhau.** Chan that su la `wip_tracking` cu. Docblock cua lo P
> (`taiVanHanhTwin.ts:20-24`) **da ghi dung** dieu nay tu truoc - chu du an **khong doc**.
> => Khi noi "X chan Y", phai **chi ra dong ma noi Y doc X**. Suy tu ten bang nghe hop ly la **doan**.

**S1(a) DA XONG TU TRUOC:** ca **bon** duong ghi san xuat deu dien `factoryCode` tu
`macTenantChoGhi(machine)` - suy tu **may da xac thuc**, khong bao gio tu input client
(`machineApiRouters.ts:1760,2281,3868`, `aoiPackageRouter.ts:1461`).
★ **Census G44 cho thay grep BAT DONG:** 3 cho theo grep chu, **11 cho that** - hai bo ghi hang loat cua
sim dung **ten bang dong**, khong co chuoi `INSERT INTO product_inspections` nao.

**Da xay:** `sinhDwellChoLine` + duong ghi `station_dwell_time` (nut that dwell **co y trung** nut that
WIP - lech nhau chinh la bug Dot 8) - `--va-ma-kiem-tra` (backfill mot giao dich, in phan bo truoc/sau +
doi chieu tong, **idempotent**) - `--chi-nhip` nay lam tuoi **ca ba dong ho** (nhip 5', wip 24h, dwell 24h),
**truot ca chuoi** thay vi don ve `now()` (don ve se chi con 1 bucket va overlay **van tat**).

**Chung minh qua API that, vai supervisor KHONG-admin:**

| | truoc | sau |
|---|---|---|
| `predictionOverlay.available` | `false` | **`true`** |
| `stationLoadHeatmap.cells` | 0 | **4** |

Ablation day du: 8 cells → **0** (tiem NULL `factoryCode`) → **8** (backfill). 96 hang, tong doi chieu
khop tuyet doi. **Admin chi dung lam doi chung** - no qua bat ke, chung minh **so 0**.

> #### G57 - **NHANH "KHONG SUY DUOC" CO THE RONG THEO LUOC DO**
> Lo S thu **ba cach** dung mot hang khong suy duoc `factoryCode`; luoc do **tu choi ca ba**
> (`23502`/`23503`): moi mat xich `machineId → stationId → lineId → workshopId → factoryId → code` deu
> **NOT NULL**, va `machineId` co **FK** toi `machines`.
> => Nhanh "de nguyen vi khong suy duoc" **khong bao gio chay**. Giu lai vi vo hai, nhung **bao dam manh
> hon** brief gia dinh. Doi lap voi G26 (nhanh khong ai di **vi thieu du lieu**): day la nhanh khong ai
> di **vi luoc do cam**.

**★ Mon cho lo R:** `station_dwell_time` **khong co trong `go-tai-twin.ts`** - thao nha may thu de lai
**48 hang mo coi** (lo S da don tay). Duong go cung hinh dang: `WHERE "stationId" = ANY(<tram cua nha may>)`.

**Loi khai lo S tu gioi han:** vi `product_inspections` **rong tren DB nay**, tinh dung dan cua backfill
dua tren **fixture 96 hang** no tu dung roi go, **khong** tren tap 2.880 hang ma brief mo ta. Cong cu san
sang nhung **chua chay tren tap do**.

### 11i.6 LO R DA VE - L-1 rong hon **5,5 lan** brief, va mot canh bao 2 TRIEU HANG (2026-09-08)

Commit `3bb3b151`. Cong: **57 tep / 1667 test** = nen - tap twin **20 tep / 223 test, 0 do** -
`check` 0 - `build` 0 - DB `factories 2, machines 43, twin_dat_cho 82`.

> #### ★★★ G58 - **VA MOI `create` LA DE NGUYEN CUA CHO `delete`**
> Brief cua chu du an neu **2** thu tuc. Lo R do lai: **11**.
> `maintenanceRouter` co **ca 9** thu tuc khong boc `ctx` - khong chi `create` ma ca
> `update`/`close`/**`delete`**/`list`/`get`/`summary`/`recordPartsUsed`/`listPartsForWorkOrder`.
> `andonRouter` co `acknowledge` **va** `resolve` (brief chi neu `acknowledge`).
> => Va mot `create` ma bo `delete` la **de nguyen cua**: mot `id` doan duoc van **xoa** duoc phieu cua
> tenant khac. **Khi tim lo tenant, quet CA ROUTER, dung quet thu tuc brief chi ten.**
>
> Chu du an kiem lai: con **dung 1** thu tuc khong boc `ctx` - `partsBelowReorder` (`:449`), doc
> `sparePartsInventory` (**kho vat tu, khong co truc tenant theo may**) => bo qua **hop ly**.

**Chung minh hai chieu** (`maintenanceAndonPhamVi.db.test.ts`, 19/19, CSDL that, vai `engineer`) - moi
chieu (−) xac nhan bang **SQL tho** rang **0 byte doi**: `create` chan cho may B (0 hang ghi) -
`update/close/delete` chan phieu B (title/status/so hang khong doi) - `acknowledge`/`resolve` chan
andon B (van `raised`, `acknowledgedAt` NULL). Ngoai pham vi tra **`NOT_FOUND`**, khong `FORBIDDEN`.

> #### ★★★ G43 BAT DUOC THAT - lan chay dau **4 o do voi `appCode: PERMISSION_DENIED`**
> RBAC chan **truoc** cong pham vi ⇒ moi o (−) khi ay xanh vi **LY DO SAI**, va **van xanh neu go sach
> ban va**. Chi sau khi cap quyen RBAC that roi **kiem `appCode == ENTITY_NOT_FOUND`** moi do dung thu.
> Bay kem: `machine_monitoring` bi **alias** sang `machine_status` (goi `resolvePermissionModule`, dung
> chep tay); `permissions.category` la **enum** - `'system'` nem `22P02`.

**Quyet dinh NULL ca ba truc** (`andon_events`, G54): **fail-CLOSED** cho nguoi bi thu hep, vai toan
quyen van cham duoc (khong thanh rac vinh vien). **G48**: 9 hang - `machineId` 9/9, `lineId` 9/9,
`stationId` 2/9, **NULL-ca-ba 0/9** ⇒ luat khong lam mat hang that nao.

### 11i.7 Don rac - va **GOC RE sau hon brief tuong**

BG-127 hai mo hinh roi, **doi chieu tong khop tuyet doi**: truoc **185.805** = 177.608 song + **8.197**
mo coi → `DELETE 8197` (vi tu **quan he**, khong theo tien to ma) → sau **177.608 + 0**.
Chu du an kiem doc lap: `machine_health_history` mo coi **= 0**.

**Ba phat hien khi va script go:**
1. `machine_health_history` **da co san** trong script (lo P them) - **brief cua chu du an sai cho nay**.
   8.197 la rac cua cac luot go **truoc** ban va do.
2. `station_dwell_time`: khoa dung la **`machineId`**, **KHONG** phai `stationId` nhu chu du an de xuat.
   Do duoc: mo coi theo `machineId` **3.247**, theo `stationId` **0** ⇒ duong go theo `stationId` **se de
   lai dung 3.247 hang ay**.
3. **★ Goc re:** do thi **FK vao `machines` RONG (0 hang)** ⇒ quet theo FK cho **am-tinh-gia hoan hao**;
   quet theo **ten cot** la mo hinh **duy nhat con hieu luc**. Da them cau chi **tu suy** quet theo ten
   cot - chi **DO va BAO**, khong xoa.

> #### G59 - **TEN COT KHONG THONG NHAT GIUA CAC BANG**
> Chu du an quet kiem chung thi `ot_telemetry` dung **`machine_id`** (snake_case) trong khi
> `machine_health_history`/`station_dwell_time` dung **`machineId`** (camelCase) - Postgres nem `42703`.
> => Cau chi quet theo ten cot phai thu **ca hai quy uoc**, khong thi no se **bao 0 mo coi mot cach
> am tham** o dung nhung bang lon nhat.

### 11i.8 ⚠ CAN CHU SO HUU QUYET - **~2 TRIEU hang mo coi o 6 bang khac**

Lo R **bao lai, khong tu xoa** (dung). Chu du an do lai doc lap va **so con cao hon** vi du lieu van chay:

| Bang | Lo R do | Chu du an do lai |
|---|---|---|
| `ot_telemetry` | 1.954.052 | **2.024.741** |
| `rul_estimates` | 8.197 | — |
| `machine_status_logs` | 4.022 | — |
| `station_dwell_time` | 3.247 | **3.247** ✓ |
| `predictive_alerts` | 10 | — |
| `measurement_point_defs` | 12 | — |

⚠ `ot_telemetry` la **hypertable nen** - lo P do duoc: `DELETE` tren 28,3M hang chay **10 phut roi do
`53400`**. Xoa 2 trieu hang o day **khong phai mot lenh DELETE**.

**Chinh chinh nen cong 2 cua chu du an:** brief ghi *"20 tep / 226 test, 3 DA DO"*. Lo R do nen that
**19 tep / 204 test, 0 do**; khong tai hien duoc 3 do nao - mot lan thay do la **timeout 5s flaky**.
Va **be mat L-1**: brief ghi 283 may / 3 nha may (**do luc FUYU-G con song**); DB nay **43 may / 2 nha may**.

## 11j. DOT 16 LO T - DON 1.969.546 HANG MO COI, 0 HANG SONG MAT (2026-09-08)

Commit `94620e75`. Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0.

| Bang | Cot | Mo coi truoc → sau | Song truoc → sau |
|---|---|---|---|
| `ot_telemetry` | `machineId` | **1.954.052 → 0** | 26.411.016 → 26.414.400 (**+3.384 chay vao**) |
| `rul_estimates` | `machine_id` | 8.197 → 0 | **khong doi** |
| `machine_status_logs` | `machineId` | 4.022 (+6 dua ghi) → 0 | **khong doi** |
| `station_dwell_time` | `machineId` | 3.247 → 0 | **khong doi** |
| `measurement_point_defs` | `machineId` | 12 → 0 | **khong doi** |
| `predictive_alerts` | `machineId` | 10 → 0 | **khong doi** |

Chu du an do doc lap sau khi xong: `ot_telemetry` **mo coi 0**, **NULL 70.689 con nguyen**.

> #### ★★★ G60 - **`NOT EXISTS` GOP `NULL` VAO "MO COI"** (loi cua chu du an, suyt giet 70.689 hang)
> Chu du an do `ot_telemetry` mo coi = **2.024.741**. Lo T do lai bang vi tu quan he **loai NULL**:
> **1.954.052 mo coi + 70.689 NULL**, chenh **dung bang so NULL**.
> `NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = t."machineId")` **DUNG voi hang `machineId IS NULL`**
> - vi khong co `m.id` nao bang NULL. Chung **khong** mo coi: chung la hang **chua gan may**, hop le.
> ⇒ **Xoa theo con so cua chu du an se giet 70.689 hang hop le.**
> => Moi vi tu mo coi phai co **`<cot> IS NOT NULL`** di kem. Va phep cong kiem tra phai la
> **mo coi + NULL + song = tong** (ba nhom), khong phai hai.

> #### ★★★ G61 - **CHAN DOAN "KHONG CHAY DUOC" CO THE SAI VE NGUYEN NHAN**
> Chu du an ghi *"DELETE tren hypertable nen khong chay duoc"* (dua tren `53400` ma lo P gap).
> Lo T do lai: `53400` la **tran bang khoa**, **khong phai nen** - `max_locks_per_transaction=64`
> (~6.400 o) so voi 9 chunk x 6 chi muc + 38 bang `compress_hyper_*`.
> **Bang chung phan de:** DELETE tren chunk **dang nen** `_hyper_25_68` xoa 108 hang trong **532ms
> khong loi** (da rollback). Timescale 2.28.2 **tu giai nen** doan bi cham.
> => Mot ma loi noi **cai gi hong**, khong noi **vi sao**. Dung suy nguyen nhan tu trieu chung;
> **dung ca doi chung** (thu dieu bi cho la khong the).

**Ba rang buoc THAT gap tren duong** (khac han cai chu du an du doan): `ctid` **khong dung duoc** tren
chunk nen (`transparent decompression only supports tableoid`) ⇒ cat lo bang khoa logic `machineId` ·
chunk **0 mo coi phai BO QUA HAN** - DELETE tren chunk nen 4,59M hang **sach** van giai nen de kiem vi tu
roi do `tuple decompression limit exceeded` (tran 100.000) · **khong `drop_chunks`**: do tung chunk,
**khong chunk nao 100% mo coi** - chunk dam rac nhat `_hyper_25_78` van chua **5.526.376 hang song**.

> #### ★★★ G62 - **SCRIPT XOA TU CHAY KHI BI `import`** (lo T tu tim ra khi lam viec 2)
> De export cho test, lo T `import` hai script - va `go-tai-twin.ts` **tu chay `main()`**, ma `main()`
> **khong co che do chi-do mac dinh**: **mot luot chay test se go sach nha may 240 may cua lo P ma khong
> ai ra lenh**.
> Da chot ca hai tep sau cua `import.meta.url === process.argv[1]` (`go-tai-twin.ts:761`,
> `don-mo-coi-may.ts:464`), va `don-mo-coi-may.ts` **mac dinh CHI DO** - phai co `--xoa` moi xoa
> (chu du an kiem ca hai lop).
> => Moi script **co tac dung phu pha huy** phai co **hai** lop: **cua goi-truc-tiep** + **mac dinh
> khong pha huy**. Mot lop la khong du.

**Vong do script go:** `TAI-LOT` (6 may) sinh → go → quet ⇒ bat 6 hang `machine_status_logs` mo coi,
`createdAt` **sau** anh chup giao dich ⇒ **dua ghi voi server dang chay**, khong phai thieu bang.
`TAI-LOT2` (cho 45s) ⇒ con sot **0**. Quet toan bo: **0 mo coi tren ca 130 bang** co cot may.
Them `measurement_point_defs` vao script go - **bang duy nhat trong 6 con thieu** (12 hang, qua nho de tu
keu, **chi phep quet moi thay**).

**Bat bien DB doi cach dien dat:** brief ghi `factories 2 / machines 43 / twin_dat_cho 82` - **da het han**
(FUYU-G 240 may cua lo P con trong DB ⇒ that la **3 / 283 / 586**). Lo T doi bat bien thanh
**"3 bang goc KHONG DOI truoc/sau"** thay vi so tuyet doi - dung, neu khong script se **do oan** moi luot
lo P nap/go. (**G55** lan hai: so trong brief co han su dung.)

## 11k. DOT 16 LO U - **TAI HIEN DUOC** trieu chung chu so huu bao (2026-09-08)

Commit `89c02203`. Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0 - DB ve goc.

> #### ★★★ G63 - `frameloop="demand"` + `enableDamping` = **QUAN TINH BI VUT**, khong loi nao no
> Chu so huu bao: *"thi thoang khong thuc hien duoc, do, giat, lag hoac khong muot"*. **Tai hien duoc**,
> va co che giai thich **dung chu "thi thoang"**.
>
> `taoDieuKhienQuay` bat `enableDamping` (`dieuKhienQuay.ts:55`, mac dinh **true**) voi
> `dampingFactor = 0.08` (`:56`). Voi damping, OrbitControls **khong ap tron cu chuot ngay**: moi
> `update()` chi ap **8%**, phan du nhan `(1 - 0,08)` roi **cho lan `update()` sau**
> (`OrbitControls.js:617-618, 701-704`). Phan du 92% can **~40 lan `update()` nua**.
>
> Nhung duoi **`frameloop="demand"` KHONG co vong lap nao tu chay** - thu duy nhat lap lich nhung lan
> `update()` do la mot `useFrame`. Do duoc **truoc ban va**:
>
> | Cho goi | `useFrame(update)` |
> |---|---|
> | `CanhNhaMay.tsx:102` | ✅ dung tu dau |
> | `CanhThietKe.tsx:130` | ❌ **khong co dong nao** |
> | `CanhVanHanh.tsx:143` | ⚠️ co, nhung **`return` ngay khi khong tween** |
>
> ⇒ Quan tinh **chi chay tron trong luc con tween doi pham vi**; moi luc khac **cut**. Do chinh la
> **"thi thoang"**.
> => Bat kien truc **theo yeu cau** (`demand`) thi **moi hoat anh KEO DAI QUA MOT KHUNG** phai co
> nguoi lap lich - quan tinh, tween, spring, LOD. Thieu mot cai la **no im lang khong chay**.

**Phep do trung tam** - **do doi anh canvas tu luc THA CHUOT → +1,2s** (= quan tinh co chay khong):

| Man | Truoc | Sau |
|---|---|---|
| `/twin-studio` | **0,000 %** (dung chet) | **3,039 %** |
| `/twin` | 41,006 % | 9,471 % |

★ **Doi chung khong cham chuot = 0,000 % o CA HAI man** ⇒ con so 0,000 % kia la **quan tinh chet that**,
khong phai nhieu do (G5/G32). **Dot bien**: bo lai `useFrame(update)` o `CanhThietKe` ⇒ coasting ve
**dung 0,000 %**, `/twin` **van song** (ban va o tep khac) - doi chung dung.

> #### G64 - **KHONG DOC DUOC NOI BO ⇒ DO CAI NGUOI DUNG NHIN THAY**
> Build production **khong pho `__r3f`** tren canvas (lo U do: chi co `__reactFiber$…`), di bo cay fiber
> ra rong ⇒ **khong doc duoc `camera.position` tu ngoai**. Lo U chuyen sang do **pixel canvas**.
> => Khong phu thuoc noi bo, va **dung la thu chu so huu nhin thay**. Khi thiet bi do bi chan, hoi
> *"nguoi dung phan nan ve cai gi"* - thuong do duoc truc tiep hon.

**Lo U tu bac gia thuyet cua chinh no:** *"nhieu su kien hon ⇒ di xa hon"* - do duoc **0,85x**, khong
phai >1x, vi moi `pointermove` **cung tu goi `update()`**. Phan thieu **chi la phan troi sau khi tha**.
No **doi phep do theo so**, khong giu gia thuyet.

### 11k.1 NO CON MO - lo U khai thang (G45)

- **"Khong thuc hien duoc" theo nghia MAT HAN tuong tac: KHONG tai hien.** Moi thao tac deu lam doi anh
  > 0; cac lop phu deu co `pointer-events-none` dung cho. Neu chu so huu con gap, can them: **may yeu hon**,
  hoac **transform gizmo** (chua do duoc - can may **da dat cho**, ma nhanh nay 180/240 may **chua dat**).
- **CHUA DO:** transform gizmo (keo/xoay/scale), chon may, doi pham vi, mo/dong panel.
- **Long task 16 lan luc zoom `/twin`** - tin hieu dang theo nhung **chua quy duoc ve nguyen nhan**.
  Lo U **khong va mo** - dung.

**Brief cua chu du an sai mot cho:** `--chi-nhip` **khong** phai lenh go; no chi lam tuoi nhip tim.
Lenh go la `scripts/go-tai-twin.ts`.

### 11k.2 G65 - CONG CU DO **TU XOA TEP DA COMMIT** cua lo khac (2026-09-08)

> #### ★★★ G65 - PLAYWRIGHT DON `test-results/` MOI LUOT CHAY
> `test-results/` chua **5 anh nghiem thu DA COMMIT** cua lo C (`C1-C4-toan-man.png`,
> `C1-fit-all-sau.png`, `C2-anh-xuat-that.png`, `C3-minimap-sau-click.png`,
> `C5-hop-thoai-luu-vung.png`). Playwright **don sach thu muc do moi lan chay** ⇒ chung bi xoa.
>
> **Lo U khai da khoi phuc.** Chu du an kiem `git status`: **van dang bi xoa** - loi khai **sai**
> (khoi phuc that, roi luot chay **sau do** lai xoa). Da `git checkout HEAD -- test-results/`, ve du **5**.
>
> => Cung ho **G62** (script tu chay khi bi `import`): mot cong cu co **tac dung phu pha huy** ma
> **khong ai ra lenh**. Khac o cho thu pham lan nay la **cau hinh mac dinh cua Playwright**, khong phai
> ma cua du an.
> => **Luat:** (1) khong ghi anh nghiem thu vao thu muc ma cong cu do **tu don**; (2) truoc khi commit,
> `git status --porcelain -- test-results/` - thay dong ` D ` thi phuc hoi, **dung commit mot luot xoa
> tep cua nguoi khac**; (3) **do lai SAU luot chay cuoi**, dung khai "da khoi phuc" o giua chung -
> chinh lo U da khai dung the va van sai.

## 11l. DOT 17 LO V - **NGUYEN NHAN GOC CUA "DO/GIAT" NAM NGOAI TWIN** (2026-09-08)

Commit `05eea0ab`. Cong: **57 tep / 1667 test** = nen - `check` 0 - `build` 0 - DB ve goc
(go FUYU-G#35: 240 may, 504 dat cho, **516.480 telemetry**, 0 mo coi).

> #### ★★★ G66 - `.env` **RO RI VAO BAN DUNG SAN XUAT** ⇒ 271/813 CHUNK MANG RUNTIME DEV
> Lo V quy duoc nguyen nhan **long task** ma lo U do duoc nhung khong giai thich noi.
> `.env:15` dat **`NODE_ENV=development`**, va `vite.config.ts:27` co **`envDir`** tro goc repo
> ⇒ `npm run build` **doc phai bien do** va sinh bundle mang **React development runtime**:
> `jsxDEV` cap **mot `Error()` moi phan tu JSX**.
>
> CPU profile: `jsxDEV` chiem **11/25 dong dau (~430 ms)**, `getBoundingClientRect` ~187 ms - thoi gian
> nam o **React dung DOM**, khong o WebGL. Chu du an do doc lap tren `dist` hien tai:
> **271/813 chunk** mang dau vet dev, bundle **46 MB**.
>
> **Ablation:** `NODE_ENV=production npm run build` ⇒ `react_stack_bottom_frame` = **0** moi chunk.
> **V2-ZOOM long task: 16 (lo U) → 5 (dev) → 0 (prod).**
>
> => Day la **don bay lon nhat** voi trieu chung chu so huu bao, va no **nam ngoai Twin** - moi man
> deu bi. Lo V **khong tu sua** (doi che do dung cham moi man) - dung.

### 11l.1 CPU cham l**a dieu kien TAI HIEN duoc** (V4)

| | ban dev | ban prod |
|---|---|---|
| throttle x4, tac vu dai nhat | **2.543 ms** | 84 ms |
| throttle x20, dai nhat | **13.320 ms** | 607 ms |
| throttle x20, tong chan | 48.641 ms | 4.290 ms |

⇒ Tren may cham, ban dev **treo 13 giay** o mot tac vu. Day rat co the la **"khong thuc hien duoc"** ma
chu so huu gap. 6/7 dieu kien khac **KHONG tai hien** (ngay sau tai - tRPC dang bay - ngan nhung -
keo lien tiep 6 lan - tha ngoai canvas - doi tab) - liet ke du theo **G45**.

### 11l.2 Transform gizmo **MUOT** - nhung mot nua khong noi vao duong ghi

RB-1 **DAT** tren ban dung that: `helperLaObject3D=true`, `helperTrongScene=true`, `soConHelper=2`
(ten lop do duoc la `"Yk"`/`"nY"` - **dung G10b**, ten lop bi bundler doi).
RB-2 **DAT**: xoay ra **45,00°** va **60,00°** - deu la boi dung cua buoc 15°, **snap tuyet doi**.

| Keo | do doi anh | tre dau | ket qua |
|---|---|---|---|
| MOVE | 1,046 % | 9,1 ms | "1 unsaved changes" |
| XOAY Y | 0,001 % | 7,3 ms | 45,00° - "1 unsaved changes" |
| **SCALE** | 0,001 % | 7,5 ms | **quaternion KHONG DOI - null** |

> #### ★★★ G67 - **CONG CU SCALE LA TRANG TRI**: nut bam duoc, gizmo hien, **khong gi duoc luu**
> `GizmoBienDoi` **co tra `tiLe`**, nhung `XuongThietKe.tsx` viet
> `onBienDoiXong={({ viTri, gocYDo }) => ...}` - **bo `tiLe`**. Khong loi nao no, khong canh bao.
> Nguoi dung keo scale, thay hinh doi, bam Luu - **kich thuoc khong duoc ghi**.
> => Cung ho **G16** (ham khong ai goi) nhung o dang **kho thay hon**: tinh nang **co UI day du**, chi
> **dut o mot tham so bi bo trong destructuring**.

**Xoay quanh X/Z dung im la HANH VI DUNG** - `objectChange` ep `rotation.x/z = 0` theo y do
"may dung tren san". Khong phai loi.

### 11l.3 Brief cua chu du an SAI hai cho

1. **"180/240 may chua dat cho"** - **sai nhan qua**. `--240` ghi `twin_dat_cho` cho **moi** may
   (`tong=240 daDat=240`); 180 la **chenh mau so** (`may` toan nha may vs `datCho` **mot tang**).
   Ly do that lo U khong do duoc gizmo la **QUYEN**: `e2e_tai_loE` co 4 hang `permissions` deu
   **`canEdit=false`** ⇒ `mayDangChon` bi ep `null`. Lo V cap tam roi **tra lai dung baseline**.
2. `CanhThietKe.tsx` thieu cap `thiet-ke/` trong duong dan.

### 11l.4 HAI VIEC CAN CHU SO HUU QUYET

1. **Bat `NODE_ENV=production` cho `npm run build`** - **don bay lon nhat** voi trieu chung do/giat.
   Anh huong **moi man**, khong rieng Twin ⇒ can quyet dinh o cap he.
2. **Noi `tiLe` vao `onBienDoiXong`, hoac go nut Scale** - hien tai nut **noi doi voi nguoi dung**.

## 11m. DOT 18 LO W - BAN DUNG SACH + GO CONG CU GIA (2026-09-08)

Commit `bcb588a4`. Cong: **57 tep / 1.668 test** (nen 1.667, **+1 luoi G67**) - `check` 0 - `build` 0 -
DB `2 / 43 / 82` - **5 anh lo C con nguyen** (G65 duoc tuan thu).

### 11m.1 Viec 1 - ban dung khong con mang runtime dev

**Cach sua:** `"build": "cross-env NODE_ENV=production vite build && esbuild ..."` - cross-env **chi
dung truoc `vite build`**, khong boc ca chuoi.
**Ly do:** doi xung voi `dev`/`start` (deu da dung cross-env; `build` la script **duy nhat** trong nhom
bo trong); bien tuong minh **thang `.env`** nen va dung goc ma **khong dung `.env`/`vite.config.ts`**.
**Khong xoa `NODE_ENV` khoi `.env`** vi do duoc **50/57 script** khong tu dat va dang dua vao mac dinh do.

**Co che do truc tiep, khong suy tu script:** `vite.loadEnv("production", <goc>, "").NODE_ENV` ra
**`"development"`** ⇒ `envDir` hut `.env:15` vao ban dung.

| | truoc | sau (chu du an do lai) |
|---|---|---|
| chunk mang React dev | **271/813** | **0/813** |
| bundle | 47.144.294 B (45,0 MiB) | **39.042.934 B (37,2 MiB)** |
| long task zoom | **17** | **2** |
| chan main / tre khung dau | 1.189 ms / 252,7 ms | **115 ms / 9,7 ms** |

**Ablation:** go cross-env → dung lai ra **chinh xac 271/813, 47.144.255 B** ⇒ **nhan qua**, khong trung hop.

> #### G68 - **20 CHO SERVER DOC `NODE_ENV`: KHONG CHO NAO DOI HANH VI**
> Lo W do **tren chinh ban dung**: `dist/index.js` **14**, `worker.js` **7**, `edgeGatewayMain.js` **7**
> lan `process.env.NODE_ENV` **con nguyen van**; so cho bi thay bang hang `"production"` = **0**.
> Vi esbuild chay `--packages=external` va **khong co `--define`** ⇒ **khong noi tuyen**.
> ⇒ Che do chay van do `npm start` quyet, ke ca `runtime-security.ts:57` va `pluginDriverBridge.ts:67`
> (fail-closed). **Rui ro chu du an lo la co that ve nguyen tac, nhung do duoc la BANG 0 o day** - va
> cach biet la **doc ban dung**, khong doc ma nguon.

### 11m.2 Viec 2 - chon **GO** cong cu Scale, kem chung minh

Cot `tiLeX/Y/Z` **co that**, nhung `group by` cho **82/82 hang = 1.000000** - **chua tung ghi**.

> #### ★★★ G69 - MOT TINH NANG CHET CO THE DUT O **BON TANG**, KHONG PHAI MOT
> Chu du an ghi: *"`XuongThietKe.tsx` destructure bo mat `tiLe`"* - ngu y **mot** cho ho.
> Lo W do lai: `GizmoBienDoi.tsx:76` **co tra `tiLe`**, nhung no **chet TRUOC KHI toi `XuongThietKe`** -
> kieu `onBienDoiXong` o **`CanhThietKe.tsx:119` von khong khai `tiLe`**. Bon tang:
> `CanhThietKe.tsx:119` · `XuongThietKe.tsx:992` · `trangThaiThietKe.ts:121` · `twinCanhRouter.ts:1193`.
> ⇒ **Sua moi cho destructure se khong lam gi ca.** Truoc khi va mot "tham so bi bo", **lan nguoc CA
> DUONG** tu noi sinh toi noi ghi.

**Ly do go (nghiep vu):** may co **kich thuoc that (mm)** + co `kichThuocDaDo` + badge "chua do";
**keo chuot tao ra so khong ai do**. Duong dung **da co**: o nhap mm `BangThuocTinh.tsx:281-298` + nut
dong 308 (chu du an kiem: duong nay **con nguyen**).

**★ Go o CHINH KIEU → `tsc` lo ra DUONG VAO THU HAI: phim R.** Chi go nut thi loi **van song sau mot
phim bam**. (Chu du an kiem: ca nut lan phim R **da go sach**.)
Dot bien: tiem lai `case "r": return "scale"` ⇒ luoi **DO** dung cho; khoi phuc byte-exact.

### 11m.3 Lo W noi thang cho **chua** chung minh duoc

Cong #7 doi **0** long task, lo W do **2**. So 0 cua lo V den tu luot chay **CPU throttle x20**; luot
nay **khong throttle**, may dang ban ⇒ **2-vs-0 khong so sanh duoc**. Cap so so sanh duoc la **ablation
cung dieu kien (17→2)**. **"0 long task" chua chung minh.**
Chi bao cong #6 ra **1** chu khong 0 - nhung do la **duong tinh gia**: chuoi ten tuy chon cua
`hast-to-jsx-runtime` trong `if(e.development)`. Chi bao React dev **that** = **0 tep** (chu du an do lai
doc lap: **0/813**).

## 11n. DOT 19 - DEM LAI SO KIEM, VA MOT PHEP DEM CUA CHU DU AN LAI SAI (2026-09-08)

### 11n.1 Ba trong sau muc "con thieu" o §11g.2 **da dong**

Do lai trong pham vi Twin: `taiAnhNen` **10** cho - `usdExport` **7** - `twin_ban_ghi` **1**.
Con lai: **`whatIf` 0** (#30/#35) va `ArticulatedRobot` 1 (**chu thich**, khong phai ma chay).

> #### ★★★ G70 - **MOT MODULE "0 CHO GOI" CO THE CHI LA TEN TEP ≠ TEN HAM**
> Chu du an dem `uploadAndRegister` ra **0** trong Twin va suyt ket luan **#18 chua lam**.
> Thuc te #18 **DA XONG** - duoi ten **`taiModelMay`** (`ThuVienAsset.tsx:14`). Grep tên **thu tuc
> server** khong tim ra ten **ham client** goi no.
>
> Va khi dem lai **19 module** bang mau `<Ten` / `Ten(`, sau module ra `dung: 0`:
> `khungNhin`, `xuatAnh`, `banDoNho`, `vungAnToan`, `wipTram`, `boChonNap`.
> **Mo hinh thu hai** (do **ham export chinh** ben trong tung tep) lat nguoc **5/6**:
> `polygonHopLe` **4** cho - `phanGiaiNap` **3** - `dungPhepChieu` **1** - `tenTepAnh` **1** -
> `conHieuLuc` **1**. **Mo hinh thu ba** cho `khungNhin` (liet ke **moi** export): `fitTatCa` **4**,
> `bboxSan` **4**, `fitBBox` **2** ⇒ **duoc dung that**.
>
> ⇒ **Ket luan: moi module Twin deu co cho goi that.** Nhung ba phep dem cho **ba ket qua khac nhau**
> tren cung mot cay ma. Mot module tien ich **khong duoc goi bang ten tep** - no duoc goi bang **ten
> tung ham**. => Khi dem "cho goi" cho mot **module**, phai liet ke **moi export** roi dem tung cai;
> dem theo **ten tep** la mo hinh sai cho lop nay. (**G44** o tang cao hon: khong chi tach `import` khoi
> `<Ten`, ma con phai hoi **don vi dem la gi** - tep hay ham.)

### 11n.2 Muc CUOI cua so kiem: #30/#35 ngan Mo phong

`TwinVanHanh.tsx:836` van hardcode **`dangMoPhong: false`**. Hai nguon **deu ton tai**:
`digitalTwin.whatIf` (`digitalTwinRouter.ts:218`, docblock `:6` ghi *"pure compute, khong ghi DB"*
⇒ **khong mang rui ro tenant**, khac han `twinState`/`wipFlowState` ma lo Q phai va) va
`orchestration.simulate` (`orchestrationRouter.ts:243`).
§12b.2 xep **G-2 what-if** la *"mat mo phong duy nhat trong ca 4 trang - dung nghia digital TWIN chu
khong phai digital shadow"*.

## 12. Kế hoạch triển khai — 7 đợt, phân công session & agent

Mỗi đợt là **một chốt nghiệm thu độc lập**: sau mỗi đợt hệ thống vẫn chạy, không đợt nào để lại trạng thái dở dang.

### 12.1 Bảng đợt

| Đợt | Nội dung | Đầu ra nghiệm thu | Phụ thuộc |
|---|---|---|---|
| **Đ0** | **Nền móng & lưới an toàn.** 5 migration (thêm cột 10A.4); seed `twin_kich_thuoc_loai` 24 loại; script di trú §5.6 + đối soát; `resolve.dedupe` + `manualChunks vendor-three`; **vá rò rỉ GPU `Factory3DScene.tsx:219-226`**; `mauTrangThai.ts` hợp nhất 3 hệ màu; route stub `/twin` + `/twin-studio` + `navigation.tsx` + **toàn bộ khoá i18n `twin3d.*` cho vi/en/zh** | `db:push && db:verify` sạch · `npm test` xanh (kể cả `duongVaoMenu.unit.test.ts`) · chunk `vendor-three` trong `dist` · script di trú in đối soát khớp · **`floorWidthM=1500` KHÔNG được di trú** (§10A.0) | — |
| **Đ1** | **Lõi engine `twin3d/loi/`** + module thuần. Mở rộng `factory-scene` thành kit: `KhungCanh`, `dieuKhienQuay` (+`invalidate`), `LoBatchMay` (BatchedMesh), `LopNhan`+`locNhan`, `chonVatThe`, `vienNoiBat`, `matDoKhungHinh`, `giaiPhong`, `webglcontextlost`, `heToaDo.ts` | `/factory-command` viết lại trên kit mà **hoạt động y hệt** · ≤ 150 draw calls đo được · `heToaDo.unit.test.ts` xanh | Đ0 |
| **Đ2** | **Hình học thiết bị (§10B).** 7 khối mặc định `hinhKhoiMay.ts` + ánh xạ 24 loại; `mucChiTiet.ts` 4 bậc LOD; vạch chỉ hướng mặt trước; gán model 3 cấp (máy / chủng loại / mặc định) | `hinhKhoiMay.unit.test.ts`: **mọi giá trị `machineTypeEnum` ánh xạ được**, 0 giá trị `undefined` · 7 khối phân biệt được bằng mắt ở ảnh chụp · LOD hạ bậc đúng ngưỡng | Đ1 |
| **Đ3** | **Dựng nhà xưởng (§10A).** Con đường B (điền kích thước 3 bước) + con đường A (nhập CAD/GLB qua `occt-import-js` worker) + hộp thoại hiệu chỉnh đơn vị/trục + `tachTangTuHinhHoc.ts` + sinh tường bao | Điền 84×52×6 m → tạo được toà + tầng, xem trước đúng tỉ lệ · nhập STEP → hộp thoại hiệu chỉnh hiện thước + hình người 1,7 m · **nhập sai đơn vị bị bắt bằng mắt** · tách tầng theo cao độ chạy đúng | Đ1 |
| **Đ4** | **Màn Thiết kế (§7) + thuật toán sinh (§8).** `sinhBoCuc.ts` + `hinhHocCanChinh.ts` + `snapVatVaoVat.ts` + `boCucService.ts` + tRPC ghi cảnh; 3 vùng, gizmo, bộ 12 công cụ, cây, inspector, undo/redo, thư viện asset, vùng polygon, ảnh nền + tỉ lệ, khu chờ xếp chỗ; **3 công cụ Line (§10C.4)** | 9 test T1–T9 xanh · kéo máy → Lưu → reload giữ nguyên · sinh lại **không đè** máy đã chỉnh tay · **xoay snap ra đúng 15.000 không phải 23.000** (RB-2) · **đủ điều kiện tắt 2 editor cũ** (sổ kiểm #41–#49 ✅) | Đ2, Đ3 |
| **Đ5** | **Màn Vận hành (§9) + phạm vi Line/Tập đoàn (§10C).** Bố cục toàn khung, `NganXuLy` (ack alarm + tạo phiếu + gán KTV), 5 cấp phạm vi, `phamViLine.ts`, đường dòng chảy có hướng, ống WIP, dải Line 2D, deep-link, 3 trạng thái tươi, đối soát, toggle 2D + fallback, a11y bàn phím | Click máy → ack alarm **thật trong DB**, tạo phiếu **thật** · chọn phạm vi Line → chỉ Line đó rõ, Line khác mờ 12 % · deep-link `?pv=line:1` khôi phục đúng · tắt WebGL → rơi 2D · **chỉ bàn phím vẫn ack được** · sổ kiểm #8–#17, #30–#34, #50–#54 ✅ | Đ1, Đ4 |
| **Đ6** | **Hấp thụ cockpit & realtime.** `twin:trangThai` 10s; `trangThaiHangLoat` (bỏ N+1); UNS stream; di trú cây ISA-95 + dải cảnh báo; nút mở cockpit; E-STOP nổi lên Twin; timeline tua | Không còn N+1 trong vòng render · sổ kiểm **#18–#29 + #50–#54** ✅ (★ đính chính Đợt 6: bản đầu ghi #55–#62 — SAI, đó là `Layout.tsx`+`TwinHub`; "UNS stream" mà chính dòng này nêu là mục **#50** thuộc khối `FactoryLiveMap3D`. 12+5 = 17 mục, khớp bảng §11) · **xoá được `CommandCenter`, `FactoryLiveMap3D`, `DigitalTwinCenter`** sau khi mọi dòng ✅ | Đ5 |
| **Đ7** | **Mô phỏng & dọn dẹp.** Ngăn "Mô phỏng" (what-if + workflow replay), export USD, xoá màn cũ đã ✅ toàn bộ, gỡ 2 editor cũ, gỡ `Factory3DScene`/`FactoryFloor3D`, quyết định `/layout/:id` | Sổ kiểm **62/62 ✅** · grep 3 engine cũ = 0 kết quả · mọi route cũ redirect đúng | Đ6 |

### 12.2 Phân công session và agent

Chủ dự án (phiên điều phối) tạo **một session riêng cho mỗi đợt**, giao brief gồm: §2 (ràng buộc cứng) + §3 (nguyên tắc) + §4 (ngân sách) + mục đợt của mình + danh sách test phải xanh.

| Đợt | Loại session | Agent chuyên môn | Vì sao |
|---|---|---|---|
| Đ0 | Backend/DB | `general-purpose` | Migration + script di trú + cấu hình build; ít suy luận kiến trúc, nhiều thao tác chính xác |
| Đ1 | Frontend 3D | `feature-dev:code-architect` → rồi `general-purpose` | Kit engine là quyết định kiến trúc ảnh hưởng mọi đợt sau; cần thiết kế trước khi viết |
| Đ2 | Frontend 3D | `general-purpose` | 7 khối + LOD là công việc hình học rõ ràng, có test làm cổng |
| Đ3 | Full-stack | `general-purpose` | Nhập CAD chạy trong worker trình duyệt; cần cả UI lẫn xử lý tệp |
| Đ4 | Frontend 3D | `feature-dev:code-architect` → `general-purpose` | Màn nặng nhất: gizmo + 12 công cụ + undo/redo; kiến trúc lệnh phải đúng từ đầu |
| Đ5 | Frontend | `feature-dev:code-architect` → `general-purpose` | Màn trung tâm nghiệp vụ; ack alarm/tạo phiếu chạm nhiều module |
| Đ6 | Full-stack | `general-purpose` | Realtime + di trú tính năng; nhiều việc cơ học |
| Đ7 | Full-stack | `code-simplifier` + `general-purpose` | Dọn dẹp và xoá; cần con mắt gộp trùng lặp |

### 12.1b Nợ kỹ thuật bàn giao cho Đ4 — do Đợt 3 tự khai

Ba món, không món nào là lỗi, nhưng Đ4 phải biết trước:

| # | Nợ | Vì sao để lại | Việc của Đ4 |
|---|---|---|---|
| N-1 | **`dungNhaXuong` KHÔNG chạy trong một transaction** | Bọc transaction đòi cài lại `trongPhamVi` bên trong `tx` — tức **hệ phân quyền thứ hai**, thứ `hierarchy.ts` cấm | Nếu lỗi giữa chừng, hàng để lại **vẫn hợp lệ và sửa được** (không phải rác). Đ4 quyết: chấp nhận, hay tách một lớp transaction không cần quyền |
| N-2 | **Nạp `.glb`/`.gltf` cho bản vẽ đang là stub** (`napGltfChoBanVe` ném lỗi, UI nói "đợt sau") | `GLTFLoader` kéo theo `three`; Đ1 sở hữu lớp bọc three trong `twin3d/loi/`. Hai bản `three` cùng tồn tại **chính là lỗi câm** mà `resolve.dedupe:['three']` sinh ra để chặn | Nối `napGltfChoBanVe` vào `boNhoModel.ts` của Đ1 |
| N-3 | **`KhungXemTruoc3D` trả `null`** — interface khai, thân rỗng | Xem trước hiện dùng SVG để giữ **RB-4: một WebGL context** | Điền thân bằng kit `twin3d/loi/`, và bảo đảm không mở canvas thứ hai |

**Chạy song song được:**
- Đ0 ∥ phần module thuần của Đ2/Đ4 (`hinhKhoiMay.ts`, `sinhBoCuc.ts`, `hinhHocCanChinh.ts`) — khác tệp hoàn toàn.
- Đ2 ∥ Đ3 sau khi Đ1 xong — hình học thiết bị và dựng nhà xưởng không chạm nhau.
- **Đ4 và Đ5 KHÔNG song song** — cả hai đọc cùng kit và cùng mô hình dữ liệu; chạy song song sẽ xung đột liên tục.

**Gộp 5 tệp dùng chung vào Đ0** (`App.tsx`, `navigation.tsx`, 3 tệp locale) để các đợt sau không xung đột merge.

### 12.3 Cổng chất lượng sau mỗi đợt — bắt buộc

Không đợt nào được coi là xong cho tới khi qua đủ **ba cổng**, theo thứ tự:

```
1. CỔNG MÁY    npm run check && npm run build && npm test && npm run test:e2e
                 ↑ ★ `build` là BẮT BUỘC, không được coi `check` là đủ
                 ↓ (xanh)
2. CỔNG QA     Agent QA độc lập (KHÔNG phải agent đã viết mã)
                 · đọc brief đợt + đọc diff
                 · tìm lỗi, tìm chỗ khai mà không đo
                 · chạy lại phép đo bằng mô hình RỜI với mô hình của người viết
                 · báo cáo: lỗi CHẶN / lỗi THƯỜNG / quan sát
                 ↓ (0 lỗi chặn)
3. CỔNG PDCA   Skill `pdca` cho mọi lỗi QA tìm được
                 · validate thiết bị đo TRƯỚC
                 · đo OUTCOME người dùng thấy, không đo cơ chế
                 · chứng minh nhân quả bằng ablation
                 · Pareto gốc rễ rồi mới sửa
                 ↓
   → mở đợt kế tiếp
```

> ### ★★★ ĐÍNH CHÍNH sau PDCA vòng 1 (2026-09-06) — ba lỗ hổng ĐO ĐƯỢC của quy trình
>
> Đo trên 10 sự kiện thật của Đợt 0+2: **7 ĐẠT / 3 HỎNG**. Ba ca hỏng có ba gốc rễ khác nhau,
> và **không ca nào bị cổng nào bắt** — chúng lọt tới tận chủ dự án.
>
> **G1 — Cổng QA phải có NĂNG LỰC ĐO, không chỉ có brief đúng.**
> Vòng 1 giao QA cho một agent chỉ có Read/Grep, trong khi brief yêu cầu chạy `vitest` và `git`.
> Kết quả: hai mục cốt lõi nhất (bánh cóc có biết kêu không) **không đo được**, agent phải tự báo
> "KHÔNG ĐẠT vì thiếu công cụ". Cổng thiết kế đúng nhưng **không thực thi được**.
> ⇒ **Luật:** agent QA phải là loại **có Bash**. Trước khi giao, đối chiếu brief với công cụ của
> agent: mỗi động từ trong brief (*chạy*, *tiêm*, *hoàn nguyên*, *đo*) phải có công cụ tương ứng.
>
> **G2 — Không tiêm/sửa tệp DÙNG CHUNG khi có phiên khác chạy cùng nhánh.**
> Vòng 1: chủ dự án tiêm giá trị giả vào `enums.ts` để đo bánh cóc; session Đợt 0 chạy song song
> commit đúng lúc đó và **cuốn dòng giả vào lịch sử** (`7ee92263`), phải vá bằng `634deee9`.
> ⇒ **Luật:** trước khi tiêm, chạy `git status --short` và **`ListAgents`**. Có phiên khác đang
> chạy ⇒ hoặc đo trên **worktree riêng**, hoặc **chờ phiên kia commit xong**. Repo này có hook
> `BG-124` chặn commit trần — nó cứu được commit của mình, **không** cứu được commit của phiên khác.
>
> **G3 — Mọi CON SỐ trong spec phải đối soát với nguồn thật trước khi giao việc.**
> Vòng 1: spec ghi "25+ loại máy" (ước lượng đọc lướt); số thật là **24**, đo bằng
> `unnest(enum_range(NULL::machinetypeenum))`. Cũng vậy: spec ghi tên test `.test.ts` trong khi
> `vitest.config.ts` chỉ include `.unit.test.ts` — nếu agent làm theo spec thì **176 test không
> được thu thập mà cổng vẫn báo xanh**.
> ⇒ **Luật:** con số nào trong spec chưa kèm câu lệnh đo được thì phải đánh dấu **"ước lượng"**,
> và cổng ra của đợt phải **đối soát bằng hai mô hình rời nhau** (liệt kê toàn phân bố ↔ đếm tổng),
> không phải hai lần cùng một phép đếm.

> ### ★★★ G4 — `npm run check` XANH KHÔNG THAY ĐƯỢC `npm run build` (2026-09-06, sau QA Đợt 1)
>
> Đo được: sau khi Đợt 0 và Đợt 3 cùng vào nhánh, `npm run check` **exit 0** trong khi
> `npm run build` **VỠ**:
> ```
> [vite:worker-import-meta-url] Invalid value "iife" for option "worker.format"
> — UMD and IIFE output formats are not supported for code-splitting builds.
> ```
> **Không đợt nào sai riêng.** Đợt 0 thêm `manualChunks` (bật code-splitting); Đợt 3 thêm worker
> `occtWorker.ts`; Vite mặc định `worker.format="iife"`. Riêng từng cái đều chạy — **chỉ tổ hợp
> mới hỏng**. Và `check` không thể thấy, vì đây là lỗi **thời-điểm-bundle**, không phải lỗi kiểu.
>
> Cả Đợt 0, Đợt 1 và Đợt 3 đều khai "build exit 0" — **đúng tại thời điểm commit của từng đợt**,
> sai sau khi hợp nhất. Chỉ QA Đợt 1 bắt được, vì nó **chạy build thật** thay vì tin lời khai.
>
> ⇒ **Luật:** cổng máy của mọi đợt phải chạy **`npm run check` VÀ `npm run build`**. Và với dự án
> nhiều đợt song song: **chạy lại build sau MỖI lần hợp nhất**, không chỉ trong đợt của mình.
> Vá tại `vite.config.ts` (`worker.format: "es"`), commit `0b3cae57`.

**Luật cứng cho cổng QA:** agent QA **không được là agent đã viết mã đợt đó**, và **phải có Bash** (G1). Bài học `BG-127` của repo: *độc lập phải ở mô hình, không ở người đo* — hai phiên cùng sai một kiểu vẫn cho cùng kết quả sai. Nên QA phải đo bằng **mô hình khác**: nếu người viết đếm bằng `WHERE`, QA phải liệt kê toàn phân bố và đối chiếu tổng.

> ### ★★★ G5b — CA DƯƠNG BẮT ĐƯỢC LỖI THẬT, và cần DÒNG ĐỐI CHỨNG (2026-09-06, session seed)
>
> G5 nói *phải* dựng ca dương. Session seed làm, và nó **bắt được một lỗi câm có thật** — chứng minh
> ca dương không phải nghi thức:
>
> Lượt G5 đầu, cầu chì NT-4 báo **đỏ**: `kichThuocDaDo` thiếu trong mệnh đề `DO UPDATE` của `upsert`.
> Hậu quả: một hàng từng là `nguon='tay'` (nên `kichThuocDaDo=true`) khi được ghi lại thành `'sinh'`
> **vẫn giữ cờ "đã đo"** ⇒ **một hàng SINH tự nhận là ĐO**. Đúng thứ NT-4 sinh ra để chặn, và nó lọt
> qua mọi phép kiểm khác. Vá tại `scripts/seed-twin-mau.ts:717-742`.
>
> Điều này cũng chứng minh **cầu chì NT-4 không phải chỉ báo luôn-đúng (G8)**: nó đã nói `false` một
> lần, trên một ca dương có thật.
>
> **★ Và một bổ sung quan trọng cho khuôn đo — DÒNG ĐỐI CHỨNG:**
> Ca dương chỉ chứng minh "hàng `tay` không đổi". Nhưng *không đổi* có hai nguyên nhân: (a) luật
> `WHERE nguon='sinh'` chặn đúng, hoặc (b) **script không hề chạy qua đường ghi đó**. Hai nguyên nhân
> cho **cùng một quan sát**.
> ⇒ Phải kèm **một dòng đối chứng `nguon='sinh'`** và chứng minh `updatedAt` của nó **ĐÃ TIẾN**.
> Đo được: hàng `tay` giữ `06:57:53.697`; hàng đối chứng `sinh` tiến lên `06:57:59.394`.
> Không có dòng đối chứng thì ca dương vẫn có thể là một phép đo trên đường chết.

> ### ★★★ G5 — PHẢI DỰNG CA DƯƠNG, không được đo trên tập rỗng (2026-09-06, QA Đợt 3)
>
> Lời hứa trung tâm của NT-4 là *"chạy lại sinh tự động **không đè** hàng `nguon='tay'`"*. Mọi lượt
> chạy script di trú trước đó đều in "đối soát ĐẠT" — nhưng QA Đợt 3 đo được: khi đó
> `twin_dat_cho` có **0 hàng `nguon='tay'`**. Mệnh đề `WHERE nguon='sinh'` **chưa bao giờ được thực
> thi trên một hàng nào**. Mọi lượt chạy trước **chứng minh số 0**, đúng lớp lỗi `C-1: đo với cờ tắt`.
>
> QA phải **tự dựng ca dương** rồi mới đo: đánh dấu một hàng thành `nguon='tay'` với vị trí đặc
> trưng (77777/88888), chạy script, đọc lại bằng SQL thô. Kết quả: `updatedAt` **không đổi một
> microgiây**, vị trí nguyên vẹn ⇒ NT-4 ĐẠT — lần đầu có bằng chứng thật.
>
> **Và một cái bẫy đi kèm:** toà `D3-CONGRA` "sống sót" qua script **không phải** vì NT-4 bảo vệ nó,
> mà vì script chỉ chạm mã `TN-DITRU-{factoryId}` — `D3-CONGRA` **không nằm trên đường đi**. Ai lấy
> nó làm bằng chứng NT-4 là đang đo nhầm thứ.
>
> ⇒ **Luật:** trước khi tin một phép đo "không có gì xấu xảy ra", hỏi *"nếu luật này KHÔNG tồn tại
> thì phép đo có khác đi không?"* Nếu không khác, phép đo đang chứng minh số 0 — phải dựng ca dương.

> ### ★★★ G12 — "HAI BẢN CÀI ĐẶT" HIẾM KHI CHỈ LỆCH MỘT CHỖ (2026-09-06, hợp nhất THƯỜNG-4)
>
> QA báo triệu chứng: `sum(viTriXMm)` lệch 6283. Session vá tìm ra **gốc rễ là công thức lệch máy**.
> Hợp nhất công thức xong — **vẫn lệch 6 hàng**.
>
> Đo **từng hàng** (không đếm `count(*)`, vốn sẽ trông ổn) lộ ra **hai lệch nữa cùng lớp**, cả hai
> nằm trong **câu truy vấn** chứ không phải trong công thức:
> - **Thứ tự máy**: seed sort theo `id`; `sinhBoCuc` sort theo `code` rồi `id` (`sapTheoMa`).
>   Trạm `SIM-L1-SPI-ST` cho `1,243,244,245,246,247` so với `244,245,243,1,247,246` — **cùng công
>   thức, khác vị trí**.
> - **`isActive`**: `sinhBoCuc` lọc máy đã ngừng, seed không ⇒ 82 hàng so với 81.
>
> Sau khi vá cả ba: **78/78 hàng khớp** dưới **một** phép tịnh tiến cứng duy nhất (`dX=2950, dY=2800`
> — một giá trị cho mọi hàng), 0 lệch tương đối. Trước đó phần dư là **bội của 1400** — dấu vết của
> công thức, không phải của phép neo.
>
> ⇒ **Luật:** khi hợp nhất hai bản cài đặt, **đừng dừng ở chỗ lệch đầu tiên tìm được**. Đo lại
> **từng phần tử** sau mỗi lần vá; `count(*)` và tổng `sum()` che được lệch hoán vị. Và nhớ:
> hai bản cùng gọi một hàm vẫn lệch nếu **đầu vào của chúng khác nhau** (thứ tự, bộ lọc, phạm vi).
>
> **★ Phần dư còn lại KHÔNG phải trôi dạt — và agent dừng đúng chỗ.** `dX=2950` đến từ:
> seed neo ở `tường + lối đi` (200+4000+1250 = 5450), `sinhBoCuc` xếp kệ từ gốc 0 (2500). Và
> `gocXMm === 0` **được khẳng định tường minh** tại `sinhBoCuc.unit.test.ts:745` ⇒ **có chủ đích**.
> Re-neo seed sẽ viết lại toàn bộ vỏ nhà (kích thước sàn, 4 tường, bbox xưởng) mà `sinhBoCuc`
> **không mô hình hoá**, và đẩy trạm vào trong đường tường. Đây là **quyết định thiết kế của chủ sở
> hữu**, không phải việc của một phiên vá lỗi.
>
> **★ Test khẳng định trên MÃ NGUỒN, không trên GIÁ TRỊ TRẢ VỀ:** một bản chép-dán tái tạo đúng công
> thức sẽ làm **mọi test dựa trên giá trị xanh** trong khi tái tạo y nguyên con bug. Test mới kiểm
> tệp seed **thật sự import** `lechTrongTram`. Ablation trên mã trước-vá: **6/9 đỏ**.
>
> **★ QUYẾT ĐỊNH CHỦ SỞ HỮU về phép neo (2026-09-06): GIỮ NGUYÊN, không hợp nhất.**
> Đo hệ quả thật trước khi quyết: tầng `38.400 × 29.600 mm`, máy sau seed ở `X 5.450..32.950`,
> `Y 4.950..20.800`. Nếu `sinhTuDong` chạy (neo gốc 0) thì `minX = 2.500`, `minY = 2.150` —
> **vẫn trong tường** (tường dày 200 mm), **không lọt ra ngoài**. Hậu quả thật: máy sát tường hơn,
> mất lối đi 4 m — khó chịu, không sai.
> ⇒ Không đáng đổi vỏ nhà lúc này. Ghi lại để Đợt sau biết: **hai bản khác NHAU ở phép NEO, giống
> nhau ở BỐ CỤC TƯƠNG ĐỐI** (78/78 hàng khớp dưới một tịnh tiến cứng). Muốn hợp nhất hoàn toàn thì
> phải cho `sinhBoCuc` biết về tường và lối đi — tức mở rộng mô hình, không phải sửa hằng số.

> **Nợ còn lại (đã đo):** hàng `twin_dat_cho` id 776 → máy `SN-ST4I-TRIAL-WELD-20260818`
> (`isActive=false`) sót từ trước khi thêm bộ lọc. **Seed cập nhật nhưng không xoá**, `sinhTuDong`
> không tái sinh nó. Cần một đường xoá — ngoài phạm vi. Đây chính là hàng mà ô `datChoMoCoi` đang
> đếm, nên **hệ đang tự khai đúng**.

> ### ★★★ G15 — "0 kèm HTTP 200" CÂM HƠN 403 (2026-09-06, áp lại vá Đợt 5)
>
> CHẶN-2 vá xong đường 403: query bị từ chối giờ hiện `—` + banner. Nhưng session áp lại tìm ra
> **một đường câm hơn**:
>
> `factory.list` trả **`[]` kèm HTTP 200** (không phải 403) ⇒ `factoryId` = null ⇒ `canhQ`/`overviewQ`
> bị `enabled: false` ⇒ **`isLoading = false` VÀ `isError = false`** ⇒ 5 ô đếm vẫn in **`0`**.
>
> Bản vá CHẶN-2 chỉ bắt `isError`. Query **chưa từng chạy** không phải lỗi, cũng không phải đang tải —
> nó là **trạng thái thứ ba** mà cả hai cờ đều không mô tả. Đã thêm cờ `chuaChay`.
>
> ⇒ **Luật:** một chỉ số có **ba** trạng thái chứ không phải hai: *đã đo* · *đang đo* · **chưa từng đo**.
> Vá một đường trả `0` không đủ; phải liệt kê **mọi đường** dẫn tới `0` và hỏi từng đường:
> *"số 0 này đến từ phép đo, hay từ việc không có phép đo nào?"*
> Đây là G7 (đếm đầu vào ≠ đầu ra) áp cho *trạng thái query*, và là ca thứ tư của họ
> "cổng xanh mà không đo gì".

> ### ★★★ G16 — TEST XANH + COMMIT SẠCH KHÔNG CHỨNG MINH TÍNH NĂNG ĐƯỢC NỐI (2026-09-07)
>
> `locBadge.ts` viết xong, **18 test xanh**, commit sạch, cổng máy đủ. Nhưng
> `LopCanhBao.tsx` **không hề gọi nó** — grep ra **0 kết quả**. Lỗi T-1 (11 cặp badge alarm chồng
> nhau, che mất alarm đang hoạt động) **vẫn sống nguyên trên `/twin`**.
>
> Module mới **luôn xanh** khi chưa ai dùng: test của nó gọi thẳng hàm, nên nó đo *hàm đúng không*,
> không đo *hàm có được gọi không*. Cổng máy cũng hài lòng vì không gì hỏng.
>
> Session viết mã **tự khai** điều này trong commit message (`CHUA NOI VAO UI`) — trung thực, và là
> lý do nó được phát hiện ngay. Nhưng nếu chỉ đọc số test thì không ai thấy.
>
> ⇒ **Luật:** với mọi module mới, hỏi **"ai gọi nó?"** trước khi tính là xong — `grep -rn "<tênHàm>"`
> ngoài chính tệp và tệp test của nó. Và nghiệm thu phải đo **ở lớp người dùng chạm vào**
> (bbox DOM thật trên `/twin`), không phải ở lớp hàm. Đây là G11 (*hiện ra* ≠ *hoạt động*) đẩy lên
> một bậc: ở đây thậm chí **chưa hiện ra**, mà mọi cổng vẫn xanh.

> ### ★★★ G22 — CA DƯƠNG DỰNG XONG MỚI BIẾT LỖ CÓ THẬT (vá Đợt 6)
>
> QA đo `twin:device` bằng cách nghe 2 chu kỳ: `operator1` nhận **0 gói** — trông như bị chặn. QA
> **nói thẳng là không kết luận được**, vì sim không phát metric nào trong cửa sổ đo (G21).
>
> Session vá **tự dựng producer thật** (`ingestTelemetry` → tap → `flush` → `emitTwinDeviceDeltas`,
> 30 sample), rồi đo **ablation hai chiều**:
>
> | | operator1 | supervisor1 | engineer1 |
> |---|---|---|---|
> | **TRƯỚC vá** | **10** ❌ | **10** ❌ | 10 |
> | **SAU vá** | **0** ✅ | **0** ✅ | 10 ✅ |
>
> ⇒ **`twin:device` rò THẬT.** Không có ca dương thì lỗ này đã được ghi là "không đo được" và
> **sống sót**. Phép đo im lặng và hệ an toàn cho **cùng một quan sát**; chỉ ca dương tách được chúng.
>
> **★ Và một đọc-nhầm mà ca dương cũng gỡ:** `engineer1@18` nhận 13 gói `twin:update` — trông như rò.
> Đo tại nguồn: 36 trạm đó **đều thuộc factory 1** (đúng phạm vi engineer1); factory 18 chỉ có 1 trạm
> và **0 WIP**. `twin:update` là feed **theo NGƯỜI**, không theo phòng. **Có gói ≠ có rò** — phải hỏi
> *gói đó chứa dữ liệu của ai*.
>
> ⇒ **Luật:** với mọi khẳng định bảo mật dạng "không nhận được gì", **dựng producer rồi đo lại**.
> Và khi thấy "nhận được gói", kiểm **nội dung** trước khi gọi là rò.

> ### ★★★ G23 — CÙNG MỘT CON SỐ SAI Ở HAI MÔI TRƯỜNG ⇒ HẰNG SỐ SAI, KHÔNG PHẢI HIỆU ỨNG (vá Đợt 6)
>
> Lỗi tràn viewport: bản vá **đầu tiên** đoán là lỗi flex/cuộn, thêm `min-h-0`. Đo lại: **vẫn tràn
> đúng 77px**.
>
> **Cùng một con số ở hai kích thước màn rất khác nhau (1366×768 và 1280×1249) là chữ ký của một
> HẰNG SỐ SAI, không phải của một hiệu ứng layout** — hiệu ứng sẽ đổi theo kích thước.
>
> Gốc rễ: khung ở `top = 133` nhưng CSS trừ `5rem` = 80px, cộng `p-6` = 24px của `<main>` ⇒ **lệch
> đúng 77px**. Vá bằng cách **đo** `getBoundingClientRect().top` + `paddingBottom` của cha lúc chạy,
> **không đoán một hằng số mới**.
>
> ⇒ **Luật:** trước khi vá một sai lệch số, đo nó ở **≥2 điều kiện khác nhau**. Số **đổi** ⇒ hiệu ứng,
> tìm cơ chế. Số **đứng yên** ⇒ hằng số sai, tìm phép cộng/trừ. Và thay hằng số bằng **phép đo lúc
> chạy**, đừng thay bằng hằng số khác — hằng số mới sẽ sai lại khi bố cục đổi.

> ### ★★★ G20 — TEST ĐO BẢN SAO CHÉP TAY, KHÔNG ĐO MÃ GIAO HÀNG (QA Đợt 6)
>
> `server/_core/twinTrangThaiPhamVi.unit.test.ts` có **5 test xanh** canh bộ lọc tenant — thứ vừa
> được thêm để bịt một lỗ rò bảo mật. Nhưng tệp đó **chỉ `import { describe, it, expect }` từ
> `vitest`** — **không import gì từ `socket.ts`**, và tự khai lại hàm quyết định `duocNhan` ở dòng 31.
>
> QA tiêm: **xoá sạch `resolveTenantFactoryScope` khỏi broadcaster thật, phát cho cả phòng** ⇒
> **5/5 test VẪN XANH**.
>
> Test đo **một bản tái-cài-đặt của logic**, không đo **mã sẽ chạy trên production**. Cả hai bản có
> thể trôi khỏi nhau vô hạn mà cổng không bao giờ đỏ — và ở đây bản trôi là **bộ lọc bảo mật**.
>
> ⇒ **Luật:** test phải **import chính module giao hàng**. Nếu logic bị chôn trong một hàm không
> export được (đóng trong `startXBroadcaster`), thì **tách nó ra thành hàm thuần có export** rồi
> test hàm đó — đừng chép nó sang tệp test. Câu hỏi kiểm nhanh: *"nếu tôi xoá sạch mã sản phẩm,
> test này có đỏ không?"* Không đỏ ⇒ nó đang đo tệp test của chính nó.
>
> Đây là **G6 (nhánh không ai đi) + G10 (chỉ định nhầm chỉ báo)** hợp lại, và là ca thứ **năm** của
> họ *"cổng xanh mà không đo gì"*.

> ### ★★★ G21 — "ĐỊNH TUYẾN" KHÔNG PHẢI "PHÂN QUYỀN" (QA Đợt 6)
>
> Agent Đợt 6 khai `twin:device` an toàn vì *"gateway đã lọc trước khi phát"*. QA **đo lại và bác bỏ**:
> `twinStream.flush()` nhóm delta **theo nhà máy CỦA MÁY** rồi `io.to("twin:{factoryId}").emit(...)`.
> Đó là **định tuyến gói tới đúng phòng** — nó quyết định *gói đi đâu*, không quyết định *ai được vào
> phòng*. Và handler `subscribe` (`socket.ts:166`) cho **bất kỳ ai** join `twin:{id}` họ tự khai.
>
> **Bằng chứng đo được, và nó là cái bẫy đẹp nhất của cả đợt:** `operator1` (không được gán nhà máy
> nào) nhận **0 gói `twin:device`** — trông y như bị chặn. Nhưng lý do thật là **sim không phát metric
> nào trong cửa sổ đo**, không phải vì có bộ lọc. Nếu producer phát, mọi socket trong phòng đều nhận.
>
> Đây là **G5 ở dạng tinh vi nhất**: phép đo cho kết quả "an toàn" trên một **tập rỗng**, và kết quả
> đó **trùng khít** với kết quả của hệ thực sự an toàn.
>
> Đo được ở kênh còn lại: `emitTwinUpdate` (`socket.ts:1407`) phát `io.to("global")` ⇒ `operator1`
> nhận **11 gói WIP** của SIM-FAC (36 trạm, `stationId:29 wipCount:86`) trong 2 chu kỳ.
>
> ⇒ **Luật:** khi khai một kênh là "đã lọc", chỉ ra **dòng mã kiểm quyền của người nhận**. Nhóm theo
> thuộc tính của *dữ liệu* (nhà máy của máy) là định tuyến. Phân quyền phải hỏi *người đang cầm socket
> là ai và họ được xem gì* — như `twin:trangThai` làm ở `socket.ts:1580`.
> Và: **"không nhận được gói nào" chỉ là bằng chứng khi có ai đó đang phát.**

> ### ★★★ G17 — BẢN VÁ CÓ THỂ MỞ LỖ MÀ LỖI GỐC KHÔNG CÓ (2026-09-07, Đợt 6)
>
> Đợt 6 thêm broadcaster `twin:trangThai` 10 giây. Trong lúc viết, agent **tự phát hiện bản vá của
> chính mình mở một lỗ rò xuyên tenant**:
>
> `subscribe` (`socket.ts:166`) cho socket `join("twin:{twinFactoryId}")` **không kiểm quyền gì cả** —
> id nhà máy là **lời tự khai của client**. Với `twin:device` điều đó còn chịu được (gateway đã lọc
> *trước* khi phát). Nhưng broadcaster mới **tự đọc DB theo id lấy từ tên phòng** ⇒ một tài khoản
> **không được gán nhà máy nào** (đo được: `operator1`) chỉ cần gửi `{twinFactoryId: 1}` là nhận
> **trạng thái toàn SIM-FAC mỗi 10 giây**.
>
> **Lỗi gốc (`subscribe` không kiểm quyền) đã tồn tại từ trước và vô hại; bản vá biến nó thành lỗ rò.**
>
> Cách bịt: phát **từng socket**, mỗi socket lọc theo phạm vi của chính người cầm nó, dùng
> `resolveTenantFactoryScope` — **đúng bộ phân giải mà tầng dữ liệu đi qua**, không tự suy lại (G12).
> Đo bằng 4 tài khoản non-admin: `engineer1`→factory 1 **NHẬN**; `operator1`/`supervisor1`/`maint1`
> **BỊ CHẶN**; `engineer1`→factory 18 **BỊ CHẶN**.
>
> ⇒ **Luật:** sau khi vá, hỏi *"bản vá này còn chạm đường nào nữa?"* — đặc biệt khi nó **đọc dữ liệu
> theo một tham số do client cấp**. Một cơ chế vô hại trở nên nguy hiểm khi có consumer mới tin nó.
>
> **★ G16 bắt được orphan của chính agent:** `emitTwinTrangThai` (phát cho cả phòng) có **0 nơi gọi**
> và là **đường vòng qua chính bộ lọc trên**. Đã gỡ. Nếu để lại, người sau sẽ dùng nó và mở lại lỗ.

> ### ★★★ G18 — CHỈ TRÌNH DUYỆT MỚI THẤY (2026-09-07, Đợt 6)
>
> Thanh tua thời gian render **đúng mọi testid**, `check` 0, `build` 0, **971 test xanh** — nhưng nó
> nằm ở `top: 1265` trong khung nhìn cao **1249px**: **vô hình**. Không cổng nào thấy được.
>
> Cùng họ với G11 (*ảnh chụp chứng minh hiện ra, không chứng minh hoạt động*), nhưng ngược chiều:
> ở đây **mã chạy đúng, DOM đúng, test đúng** — chỉ **vị trí trên màn** sai. Không có lớp nào giữa
> "DOM tồn tại" và "người dùng nhìn thấy" ngoài trình duyệt thật.
>
> ⇒ **Luật:** tính năng có bề mặt thị giác phải nghiệm thu **trên trình duyệt thật ở kích thước thật**,
> và phép đo là **`getBoundingClientRect()` so với `innerHeight`/`innerWidth`**, không phải sự tồn tại
> của testid. "Có trong DOM" và "ở trong khung nhìn" là **hai đại lượng khác nhau** (G7).

> ### ★★★ G19 — DỮ LIỆU THẬT CÓ THỂ HẸP HƠN ENUM (2026-09-07, Đợt 6)
>
> Hai lỗi agent **tự gây ra rồi tự bắt bằng phép đo, không phải bằng test**:
>
> 1. **Độ tươi lấy `max(status_log, heartbeat)`** ⇒ 3 băng tải **im lặng 51,7 ngày** báo thành
>    **0,4 ngày**. Sửa thành **chỉ heartbeat**. Đây là **cùng lớp lỗi** mà `trungThucDuLieu.ts` đã
>    từng bị vá một lần — lớp lỗi tái phát ở chỗ khác.
> 2. **`machine_status_logs.status` chỉ có `online`/`offline`** (4.171/3.490 hàng) so với
>    `operationStatusEnum` **8 giá trị**. Trả thẳng ⇒ `mauChoTrangThai` rơi hết về `khong_ro` ⇒
>    **replay sơn xám TOÀN nhà máy, im lặng**. Đã ánh xạ tường minh, và khai `online→running` là
>    **xấp xỉ** (NT-4: số giả định phải tự khai).
>
> ⇒ **Luật:** trước khi tin một cột enum, **đếm phân bố giá trị THẬT** của nó. Enum khai 8 giá trị
> không có nghĩa dữ liệu có 8. Cột hẹp hơn enum là **lỗi câm** — không gì nổ, chỉ là mọi thứ rơi về
> nhánh mặc định.

> ### ★★★ G13b — LUẬT CÔNG CỤ: `sed` SỬA ĐƯỢC, `sed` ĐO KHÔNG ĐƯỢC (2026-09-07, Đợt 6)
>
> Agent Đợt 6 nêu một xung đột thật: hướng dẫn môi trường bảo dùng `sed`/heredoc thay cho Edit/Write,
> nhưng G13 cấm đúng thứ đó. Nó **dừng lại hỏi thay vì im lặng chọn một bên** — đúng cách.
>
> **Phân xử:**
>
> | Việc | Công cụ | Vì sao |
> |---|---|---|
> | Sửa **mã sản phẩm** | `sed`/heredoc được | Kết quả đi qua `check`/`build`/`test` — sai thì lộ |
> | **Tiêm đột biến để ĐO** | **BẮT BUỘC** Python + `assert old in s` | Tiêm hụt ⇒ kết quả "xanh" — mà "xanh" **chính là thứ đang muốn chứng minh** ⇒ không gì phát hiện |
>
> ⇒ **Nguyên tắc chung, rộng hơn `sed`:**
> **Công cụ nào mà THẤT BẠI của nó TRÔNG GIỐNG THÀNH CÔNG thì không được dùng để đo.**
>
> `sed` hụt khớp → thoát 0, không đổi gì. `perl -0pi` hụt khớp → im lặng. Cả hai biến **phép đo**
> thành **lời khai**. Python `assert` thì nổ.
>
> **Luật này tự chứng minh ngay khi được viết:** script sửa spec của chủ dự án `assert` **bắn** vì
> đoán sai câu gốc. Dùng `sed` thì đã commit một bản "sửa" **không sửa gì** — và không ai biết.

> ### ★★★ G13 — THIẾT BỊ ĐO HỎNG TRONG KHI THỨ ĐƯỢC ĐO VẪN TỐT (QA Đợt 5)
>
> QA Đợt 5 gặp **ba lần thiết bị đo của chính nó hỏng** trong một lượt audit, và tự rút ra dấu hiệu chung:
> - `perl -0pi` **im lặng không áp** bản tiêm ⇒ báo "854/854 xanh" — một đột biến *chưa từng tồn tại*
> - hook WebGL trả `0/0`
> - wrapper `Bash` exit 127 trong khi tiến trình con vẫn chạy và phục vụ HTTP 200
>
> **Cả ba: thiết bị hỏng, thứ được đo vẫn tốt.** Và cả ba có cùng một dấu hiệu:
> ***một kết quả không tốn gì để tạo ra.*** Suite xanh mà không chạy gì cũng xanh. Bộ đếm trả 0 vì
> không đo được cũng trả 0. Exit code của vỏ bọc không nói gì về tiến trình bên trong.
>
> Lần thứ tư suýt lọt: lượt re-test T-3 **im lặng không áp**, báo 895 xanh. QA chỉ bắt được vì
> Python `assert` bắn. Nguyên văn: *"Nếu dùng `sed`, tôi đã báo một đột biến sống sót mà chưa từng tồn tại."*
>
> ⇒ **Luật:** khi tiêm đột biến, công cụ tiêm phải **tự khẳng định đã áp** (`assert old in s` rồi mới ghi).
> `sed`/`perl -i` thất bại **im lặng**; Python với `assert` thì không. Và mọi kết quả **xanh hoặc bằng 0**
> phải có **mô hình thứ hai không liên quan** xác nhận trước khi tin — đây là G5/G7/G10 áp cho chính dụng cụ.
>
> ### ★★★ G14 — `reset --hard` TRÊN WORKTREE DÙNG CHUNG XOÁ VIỆC CHƯA COMMIT CỦA PHIÊN KHÁC
>
> **Tai nạn thật, lỗi của chủ dự án (2026-09-06).** Chuỗi sự kiện:
> 1. Một phiên khác **đổi nhánh của worktree chính** từ `feat/twin-3d-trung-tam` sang `feat/ai-local-L7-hang-rao`
> 2. Chủ dự án thấy 4 commit twin3d "biến mất khỏi `HEAD`" ⇒ tưởng bị rebase mất ⇒ cherry-pick chúng vào — **nhầm nhánh**
> 3. Gỡ bằng `git reset --hard 1b327541` ⇒ **xoá mọi thay đổi chưa commit trên tệp đã tracked**
>
> **Thiệt hại đo được:** bản vá T-3 của session vá (`NGUONG_CU_MS` trong `mauTrangThai.ts`) biến mất,
> cùng sửa chưa commit trên 5 tệp khác. Test **895 → 872** (mất ~23). Tệp **untracked**
> (`locBadge.ts` + test) **còn nguyên** — `reset --hard` không chạm untracked.
>
> **Không mất commit nào:** nhánh `feat/twin-3d-trung-tam` vẫn ở `926a9d98` nguyên vẹn. Bốn commit
> "biến mất" chỉ là **worktree đang đứng ở nhánh khác** — chúng chưa bao giờ rời nhánh của mình.
>
> ⇒ **Ba luật:**
> 1. **Trước khi kết luận "commit bị mất", chạy `git branch --show-current` và `git log --oneline -1 <nhánh-của-mình>`.**
>    Commit "biến mất khỏi HEAD" thường chỉ là HEAD đang ở chỗ khác.
> 2. **KHÔNG BAO GIỜ `reset --hard` trên worktree có việc chưa commit của phiên khác.** Kiểm
>    `git status --short` trước. Cách gỡ cherry-pick nhầm là `git cherry-pick --abort` (khi đang dở)
>    hoặc `git reset --soft` (giữ nguyên cây làm việc).
> 3. **Commit sớm theo từng hạng mục.** Việc nằm chưa commit là việc có thể mất. Session vá bị mất
>    ~23 test vì gom nhiều hạng mục vào một lần commit chưa xảy ra.
>
> Hook `BG-124` chặn commit trần và hook reference-transaction chặn `stash` — cả hai **cứu commit
> của mình**, nhưng **không cứu cây làm việc của phiên khác** khỏi `reset --hard`.

> ### ★★★ G11 — ẢNH CHỤP CHỨNG MINH THỨ *HIỆN RA*, KHÔNG CHỨNG MINH THỨ *HOẠT ĐỘNG* (QA Đợt 4)
>
> Đợt 4b nghiệm thu RB-1 bằng **ảnh chụp gizmo 3 trục** — và ảnh đó **đúng**. Nhưng QA Đợt 4 đo tiếp
> và tìm ra: **gizmo hiện đẹp mà kéo không lưu được**.
>
> Gốc rễ (`CanhThietKe.tsx:218-223`): proxy `new THREE.Object3D()` được `attach()` nhưng **chưa bao
> giờ vào scene graph** — không `scene.add`, không `<primitive>`. Chuỗi nhân quả kiểm chứng tại
> nguồn `node_modules/three/examples/jsm/controls/TransformControls.js`:
> 1. dòng 1066: `parent === null` → vào nhánh `console.error`, **`_parentScale` không được gán**
> 2. dòng 344: `_parentScale = new Vector3()` = **(0,0,0)**
> 3. dòng 501/505: `.divide(this._parentScale)` → **chia cho 0** ⇒ NaN
>
> Triệu chứng: kéo gizmo **lúc được lúc không**; cùng một cặp toạ độ cho kết quả khác nhau giữa hai
> lượt. Console nổ **90+ lần** mỗi phiên. Nút **Lưu vẫn disabled** sau nhiều lượt kéo, SQL thô xác
> nhận DB **không đổi một byte**.
>
> **Đối chứng phân lập của QA là phần đắt nhất:** gõ số vào ô Inspector → `luuDisabled: false` ngay.
> Cùng một kết cục mong đợi, **hai đường vào: đường Inspector sống, đường gizmo chết**. Không có
> đối chứng này thì rất dễ kết luận nhầm là "lỗi ở đường lưu".
>
> **Bốn thiết bị đo đều nói ĐẠT mà tính năng trung tâm vẫn hỏng:** 747 test xanh (không test nào
> chạm đường gizmo thật) · `check` 0 · `build` 0 · **ảnh chụp thấy gizmo**.
>
> ⇒ **Luật:** ảnh chụp nghiệm thu **thứ hiện ra**. Muốn nghiệm thu **thứ hoạt động**, phải đo
> **kết cục bền vững**: thao tác → đọc lại từ **DB bằng đường độc lập** → giá trị đổi thật.
> Và với mọi tính năng có **hai đường vào** cùng kết cục, phải đo **cả hai** — một đường sống có thể
> che một đường chết.

> ### ★★★ G10b — CHỈ BÁO ĐO *BUNDLER* THAY VÌ ĐO HÀNH VI (2026-09-06, Đợt 4b)
>
> G10 ứng nghiệm ngay trên chỉ báo của chính agent viết mã. Nó dựng chỉ báo RB-1 là
> `helper.constructor.name === "TransformControlsRoot"` — chạy `dev` thì **xanh**, chạy trên bản
> `npm run build` thì **ĐỎ**, vì minifier đổi tên lớp thành `"Fj"`.
>
> Chỉ báo đó **không đo RB-1**; nó đo **minifier**. Nếu chỉ chạy ở `dev` thì nó xanh vĩnh viễn và
> chẳng canh gì; nếu chạy ở `build` thì nó đỏ vĩnh viễn dù mã hoàn toàn đúng. **Cả hai chiều đều vô dụng.**
>
> Thay bằng ba chỉ báo bất biến với minify (`GizmoBienDoi.tsx:191-195`):
> `controlsLaObject3D` (phải **false** — đó chính là nội dung RB-1) · `helperLaObject3D` (true) ·
> `helperTrongScene` (`helper.parent === scene`). Đo được: `soConHelper: 2`, draw call **2 → 16** khi
> gắn gizmo — bằng chứng gizmo thật sự vào scene, không phải mesh tự vẽ.
>
> ⇒ **Luật:** chỉ báo dựa trên **tên** (tên lớp, tên hàm, chuỗi trong mã) là chỉ báo về **công cụ
> dựng**, không phải về hành vi. Đo bằng **quan hệ cấu trúc** (`instanceof`, `parent`, số con) hoặc
> **hệ quả quan sát được** (draw call tăng). Và mọi chỉ báo phải chạy **cả `dev` lẫn `build`** — đây
> là G4 áp cho chính thiết bị đo.

> ### ★★★ G10 — SPEC DỰ ĐOÁN SAI *CHỈ BÁO NÀO SẼ ĐỔ* (2026-09-06, Đợt 4a)
>
> §8.2 bước 3 khẳng định: đảo trục sẽ làm **T4 ("không chồng lấn") đổ ngay ở quy mô nhỏ nhất**.
> Đo được: **T4 vẫn XANH** trên mọi ca một-xưởng kể cả 43 máy thật; thứ đổ là **T5 ("trong biên")**.
>
> Spec **không sai về hành vi mã** — đảo trục đúng là lỗi. Nó sai về **thiết bị đo**: chỉ định nhầm
> chỉ báo sẽ bắt được lỗi. Hậu quả nguy hiểm hơn một lỗi thường:
>
> **Nếu agent làm ĐÚNG CHỮ của spec, nó viết T4 theo mô tả một-xưởng ⇒ T4 mù đúng cái lỗi spec giao
> nó canh ⇒ cổng vẫn báo xanh.** Spec tự tay tạo ra vùng mù, và không phép kiểm nào bắt được vì mọi
> test đều xanh và mọi chữ trong spec đều được thực hiện.
>
> ⇒ **Luật:** khi spec nói *"vi phạm X sẽ làm test Y đỏ"*, đó là **một lời khai cần đo**, không phải
> sự thật. Agent thực thi phải **tiêm X và xem test nào thật sự đỏ** — nếu không phải Y, thì **thêm
> ca cho Y** (như Đợt 4a đã làm: `★ HAI XƯỞNG KỀ NHAU`) và **báo lại**, chứ không im lặng dựa vào Y-thay-thế.
>
> Đây là ca thứ tư trong dự án của cùng một họ: G5 (đo trên tập rỗng), G6 (nhánh không ai đi),
> G7 (đo nhầm đại lượng), G10 (chỉ định nhầm chỉ báo). Cả bốn đều cho **cổng xanh mà không đo gì**.

> ### ★★★ G9 — ĐƠN VỊ CỦA CON SỐ (2026-09-06, dọn cổng i18n)
>
> Chủ dự án giao brief nói *"dọn **33 mục** i18n thiếu"*. Agent đo lại và sửa: **33 là số DÒNG BÁO
> LỖI, không phải số KHOÁ** — chúng gộp lại còn **7 khoá riêng biệt** (mỗi khoá báo một lần cho mỗi
> locale, và vài điểm gọi lặp lại). Ai lập kế hoạch theo "33 bản dịch" là làm việc trên con số phóng
> đại gần 5 lần.
>
> Cùng lớp với "25+ loại máy" (số thật 24) ở G3, nhưng nguy hiểm hơn: ở đây **con số đúng** —
> chỉ **đơn vị sai**. Không phép kiểm tra "số này có khớp DB không" nào bắt được.
>
> ⇒ **Luật:** mọi con số trong brief phải kèm **đơn vị và câu lệnh sinh ra nó**. *"33 dòng từ
> `vitest run <tệp>`"* khác hẳn *"33 khoá cần dịch"*. Và agent nhận brief **được phép và nên** đo lại
> con số đó trước khi lập kế hoạch — đây là lần thứ hai một agent sửa số của chủ dự án và đúng.
>
> **Chi tiết đo đáng nhớ:** khi thiếu khoá, suite **dừng sớm** — 7 test thu thập tụt còn 3, trong đó
> `1 passed`. Ai chỉ nhìn "số xanh" mà không nhìn **số thu thập** sẽ thấy "1 passed" và tưởng gần ổn.
> Đây chính là G3 áp cho ca lỗi-chặn-thu-thập.

> ### ★★★ G8 — CHỈ BÁO LUÔN-ĐÚNG là chỉ báo KHÔNG BAO GIỜ NÓI KHÔNG (2026-09-06, vá Đợt 3)
>
> `donViDeNghiChacChan` cũ nghĩa là *"đơn vị đã chọn có hợp lý không"* — **đúng theo cấu trúc**, vì
> hàm chỉ chọn đơn vị nào hợp lý. Một chỉ báo không bao giờ trả `false` thì không phải chỉ báo.
> Bản vá đổi nghĩa thành *"có **đúng một** đơn vị hợp lý"* — giờ nó nói `false` được khi nhập nhằng.
>
> Đây là **cùng lớp** với bánh cóc `0 undefined` ở Đợt 2 (hàm toàn phần nên mệnh đề luôn đúng) và
> với `chongLap = 0` ở G7. Ba ca, ba nơi, cùng một hình dạng: **một phép đo tự thoả mãn**.
>
> ⇒ **Luật:** với mọi cờ boolean/chỉ báo, hỏi *"đầu vào nào làm nó trả `false`?"* Không trả lời được
> bằng một ví dụ cụ thể ⇒ nó vô dụng. Và UI đã sẵn sàng cho `false` **không chứng minh** `false` từng
> xảy ra: `NhapBanVe.tsx:304` có cảnh báo nhập nhằng từ đầu — nó **chưa bao giờ nhận được `false`**.
>
> **Hai quyết định kỹ thuật kèm theo, đáng giữ làm khuôn:**
> 1. **Bất biến về DỮ LIỆU thì đặt ở DB, không ở mã.** Chọn *partial unique* `WHERE "isActive"` thay
>    vì find-before-create: khuôn sau có khe TOCTOU (vẫn phải bắt `23505`, tức nửa việc mà gấp đôi
>    chi phí) và **âm thầm hồi sinh** tầng/ảnh/vị-trí-máy của lần dựng trước dưới một mã gõ lại.
>    Khuôn BG-93 hợp với bảng WORM nơi **không thể xoá** — không phải ca này.
> 2. **Chọn `<=` chứ không `<`** ở `sanQuaHepChoTuongBao`: cạnh đúng bằng `2 × DAY_TUONG_MM` vẫn cho
>    `sauMm = 0`, thứ router `.positive()` từ chối. Dùng `<` sẽ để lọt **đúng con số tròn mà người
>    dùng hay gõ**.

> ### ★★★ G7 — ĐẾM ĐẦU VÀO ≠ ĐẾM ĐẦU RA (2026-09-06, vá Đợt 1)
>
> Gốc thật của lời khai sai *"khử chồng lấp nhãn hoạt động"* **không phải** ở thuật toán, mà ở chỗ
> **lẫn hai đại lượng khác nhau**:
> - `chongLap` đếm **nhãn bị loại** — đại lượng ĐẦU VÀO của thuật toán
> - "số cặp còn chồng trên màn" là đại lượng ĐẦU RA — thứ người dùng thật sự nhìn thấy
>
> Bộ đếm báo `chongLap = 0` **hoàn toàn đúng với định nghĩa của nó**, trong khi màn hình có 5 cặp
> nhãn che nhau. Không ai nói dối; phép đo đo nhầm đại lượng.
>
> ⇒ **Luật:** dụng cụ đo phải **độc lập với thuật toán nó đo**. Bản vá thêm `demCapChongLap()` — quét
> hậu điều kiện trên kết quả, không đọc biến đếm nội bộ — và `__demNhan.capConChong` để e2e đối chiếu
> với `getBoundingClientRect`. Khi kiểm một chỉ số, luôn hỏi: *nó đếm thứ tôi làm, hay thứ người dùng nhận?*
>
> **Ba quyết định kèm theo, đáng giữ làm khuôn:**
> 1. **Đổi HÌNH, không đổi SỐ.** Nhãn tỉ lệ ~9:1; nới bán kính đường tròn cho phủ hết bề rộng 180px
>    thì cũng phủ 180px chiều dọc ⇒ giết oan nhãn xếp chồng dọc vốn đọc được. Mô hình sai thì tinh
>    chỉnh tham số không cứu được.
> 2. **Fixture sai thì sửa FIXTURE, không sửa KHẲNG ĐỊNH.** 6 test cũ đỏ sau khi đổi mô hình vì
>    fixture đặt bước 126px < bề rộng nhãn 150px — 126px thật sự không đủ để hai nhãn không đè nhau.
>    Chính lỗi đó bị mô hình cũ che đi.
> 3. **Không nối mã CHƯA ĐO vào điểm ĐANG CHẠY ĐÚNG.** `giaiPhong.ts` (0 test) không được thay 4 chỗ
>    `dispose()` viết tay đang là bằng chứng RB-7 — thay chúng là bằng chứng hết hiệu lực và phải đo
>    lại rò rỉ GPU trên màn thật. Gọn gàng không đáng đổi lấy rủi ro chưa đo.

> ### ★★★ G6 — VÙNG MÙ Ở NHÁNH KHÔNG AI ĐI, và BẢN SAO THỨ HAI của một bảng dữ liệu
>
> QA Đợt 3 tiêm sai hệ số inch **10 lần** (0,0254 → 0,254) vào `docBanVe.ts` ở **cả hai** hàm —
> **378/378 test vẫn XANH**. Nguyên nhân: 8 assertion của `donViDeNghi` chỉ chạm mm/cm/m; **nhánh
> `inch` chưa từng có một assertion nào**.
>
> Nặng hơn: `docBanVe.ts` giữ **bản sao thứ hai** của bảng hệ số đơn vị (bản gốc ở
> `hieuChinhNhapModel.ts:42`, có test). Hai bản sao có thể lệch nhau mà **không gì báo** — đúng thứ
> docblock của `boCucTang.ts` đã cảnh báo: *"hai chỗ chia 1000 là hai chỗ có thể lệch nhau"*.
>
> ⇒ **Luật:** (a) mỗi bảng hằng số dữ liệu chỉ được có **một** bản; nơi khác **import**, không khai
> lại. (b) Sàng mật độ phải tiêm vào **từng nhánh** của một `switch`/bảng tra, không chỉ nhánh phổ
> biến — nhánh không ai đi là nhánh không ai đo.

**Luật bàn giao số:** báo cáo của mỗi đợt phải đọc **thiết bị đo**, không đọc kết quả. "Test xanh" là lời khai; "`npm test` in `142 passed`, dán nguyên văn" là số đo.

## 12b. §13 — THIẾT KẾ 3D FACTORY LÀM TRUNG TÂM (ĐỢT 14 LÔ Q, 2026-09-07)

> **Vì sao mục này mang số 12b chứ không phải 13.** Điều phối giao *"mục mới §13"*, nhưng tài liệu
> này **đã có `## 13. Kiểm thử`** từ trước. Chiếm lại số 13 sẽ tạo hai mục cùng tên trong một tệp
> sắp được đem ra bàn — đúng kiểu nhầm lẫn mà một bản thiết kế không được phép gây ra. Nên nội dung
> được yêu cầu nằm nguyên vẹn ở đây, đặt ngay trước §13 cũ.

**Trạng thái:** Q1 (vá lỗ tenant) **ĐÃ LÀM VÀ ĐÃ NGHIỆM THU** — commit `cd56d186`. Phần còn lại của
mục này là **THIẾT KẾ, CHƯA XÂY**. Mọi mục chưa có đều được đánh dấu rõ.

---

### 12b.0 ★★★ NĂM ĐIỀU BRIEF NÓI SAI — ĐO LẠI 2026-09-07

Bản brief giao lô Q chứa những khẳng định **không còn đúng**. Ghi ra đây vì một bản thiết kế dựng
trên số sai sẽ dẫn tới một quyết định sai.

| # | Brief nói | ĐO ĐƯỢC 2026-09-07 | Hệ quả |
|---|---|---|---|
| S-1 | `product_inspections` **0 hàng** ⇒ `defectHeatmap` vĩnh viễn trống | **2.880 hàng** (341 NG / 2.539 OK), mới nhất trong 24h | Lô P đã sinh dữ liệu. Nhưng xem S-2 — kết luận "trống" vẫn đúng, **vì một lý do KHÁC HẲN** |
| S-2 | — (brief không biết) | **CẢ 2.880 hàng đều `factoryCode IS NULL`** | Sau Q1, `defectHeatmap` cho admin **240 hàng / 341 NG**, cho vai được gán SIM-FAC **0 hàng**. Fail-CLOSED đúng hướng, nhưng heatmap **rỗng với mọi vai không-admin** |
| S-3 | `wip_tracking` 0 hàng/24h, mới nhất **17 ngày** ⇒ `predictionOverlay` luôn `available:false` | **2.704 hàng trong 24h**, mới nhất **0 ngày** | Nguồn WIP **đã sống**. Nhưng `predictionOverlay` **vẫn** `insufficient_data` — xem S-4 |
| S-4 | — (brief không biết) | `station_dwell_time` mới nhất **2026-08-21 (17 ngày)**; chuỗi WIP 24h của chuyền 1 gom được **0 bucket** | Lô P sinh WIP với mốc mới nhưng **chưa sinh kèm `station_dwell_time`**. Nên `stationLoadHeatmap` đo trên dữ liệu 17 ngày tuổi, và `predictionOverlay` vẫn không đủ 3 điểm |
| S-5 | 4 trang cũ là 4 màn rời, "3.378 dòng" | **3 trong 4 ĐÃ bị gộp sẵn** thành tab của `TwinHub` (`client/src/pages/TwinHub.tsx:41-43`); hai tuyến cũ đã là **redirect** (`App.tsx:383`, `App.tsx:440`) | Chỉ `CommandCenter` còn tuyến riêng (`App.tsx:441`) + còn trên thanh điều hướng (`navigation.tsx:301`). Phạm vi "gộp 4 màn" nhỏ hơn brief tưởng |

> #### G50 — **"NGUỒN ĐÃ CÓ DỮ LIỆU" KHÔNG BẰNG "LỚP PHỦ ĐÃ ĐỌC ĐƯỢC"**
> Ba lớp phủ cùng mang tiếng "nguồn rỗng", nhưng sau khi lô P đổ dữ liệu, chúng **rỗng vì ba lý do
> khác nhau**: `defectHeatmap` rỗng vì **thiếu cột tenant**; `predictionOverlay` rỗng vì **thiếu
> bảng thứ hai** (`station_dwell_time`); `stationLoadHeatmap` **có số nhưng số đã 17 ngày**.
> Một câu "nguồn đã có dữ liệu rồi, bật lớp phủ lên" sẽ cho ba kết quả sai theo ba kiểu.
> ⇒ **Điều kiện nghiệm thu phải viết theo LỚP PHỦ, không theo BẢNG.**

★ S-5 đúng lớp lỗi đã ghi ở sổ Khối D: *"phạm vi 10 màn co còn 1 vì tôi ĐẾM tên tệp thay vì ĐỌC"*.

---

### 12b.1 HIỆN TRẠNG `/twin` — ĐO ĐƯỢC, KHÔNG SUY

`/twin` = `client/src/pages/TwinVanHanh.tsx` (**2.568 dòng**), tuyến `App.tsx:325`.

#### 12b.1.1 Các vùng màn hình

| Vùng | `file:line` | Hiện gì |
|---|---|---|
| Thanh đầu (48px) | `TwinVanHanh.tsx:1865` | Dải công cụ trên cùng |
| ↳ Breadcrumb | `:1869` | Nhà máy → toà → tầng → line → máy, bấm được |
| ↳ Trạng thái kết nối | `:1926` | Chỉ báo socket realtime |
| ↳ Badge xuất xứ | `:1967` | SHADOW / mô phỏng / chỉ-sơ-đồ (logic `:821`) |
| ↳ Độ tuổi dữ liệu | `:1986` | "cập nhật N giây trước" |
| ↳ Nút nạp lại | `:1995` | Refetch mọi truy vấn |
| ↳ Nút xuất USD | `:2009` | Xuất `.usda`; **ẩn** nếu thiếu `machine_status/canView` (`:2005`) |
| ↳ Toggle 2D/3D | `:2029` | Đổi `CanhVanHanh` ↔ `CanhVanHanh2D`; **disable** khi WebGL hỏng (năng lực, không phải quyền) |
| Dải kết quả xuất USD | `:2055` | Số prim / số byte / lý do thất bại |
| Banner: truy vấn bị từ chối | `:2114` | **Nêu đích danh** thủ tục tRPC nào trả FORBIDDEN |
| Banner: đối soát lệch | `:2132` | N máy chưa đặt / N chỗ đặt mồ côi + link `/twin-studio` |
| Banner: máy ngoài lượt nạp | `:2162` | Máy đặt ở tầng/toà khác |
| Banner: hạ cấp phạm vi | `:2193` | `?pv=tapdoan` bị hạ về một nhà máy |
| Banner: link cũ bị bỏ qua | `:2216` | URL trỏ tới nhà máy/toà/tầng đã xoá |
| Dải cảnh báo E-STOP | `:2242` | Robot đang E-STOP (`role="alert"`) |
| Dòng thời gian | `:2262-2270` | Tua lại 24h: mốc, play/pause, tốc độ |
| **Panel trái** | `:2300` | Thu được bằng `?thu=trai` |
| ↳ Khối tổng quan | `:2306` | `dem-may` `:2309` · `dem-tuoi` `:2313` · `dem-cu` `:2317` · `dem-khong-ro` `:2321` · `dem-ngung` `:2325` |
| ↳ Đài cảnh báo | `:2335-2350` | Cảnh báo khử trùng lặp, chip mức, gom >24h |
| ↳ Danh sách máy | `:2352-2360` | DOM thật, đi được bằng bàn phím |
| **Canvas giữa** | `:2361` | `CanhVanHanh` (3D) **hoặc** `CanhVanHanh2D` — loại trừ nhau |
| ↳ Bảng KPI nổi | `:2410-2420` | Lớp phủ DOM (**0 draw call**), sống qua `?thu=` |
| ↳ Tay thu trái / phải | `:2434` / `:2453` | Chevron nổi |
| ↳ Tóm tắt cho trình đọc màn hình | `:2470` | `sr-only` |
| **Panel phải** | `:2483`, `NganXuLy` `:2489-2518` | **Mặt ghi duy nhất** |
| ↳ Ngăn nhúng tại chỗ | `NganXuLy.tsx:614` → `NganNhung.tsx` | Radix Sheet nạp thân cockpit máy/robot/trạm **tại chỗ** |
| Dải line dưới | `:2527` | Dải trạm 2D khi `phamVi.cap === "line"` |

#### 12b.1.2 `/twin` hiện cho SỬA những gì — đường ghi đã nối

★ Đây là câu chủ sở hữu hỏi thẳng ("điều chỉnh và sửa đổi được"). Đo được:
**`TwinVanHanh.tsx` có ĐÚNG 0 mutation.** Toàn bộ khả năng ghi nằm ở `NganXuLy.tsx` và ở các thân
cockpit nạp qua ngăn nhúng.

| # | Thủ tục | Chỗ gọi `file:line` | Ghi gì | Cổng quyền (server) |
|---|---|---|---|---|
| W1 | `andon.acknowledge` | hook `NganXuLy.tsx:158`, gọi `:416` | Đánh dấu 1 hàng `andon_events` đã tiếp nhận | `andonRouter.ts:125` + `requirePermission("andon","canEdit")` `:126` |
| W2 | `maintenance.createWorkOrder` | hook `NganXuLy.tsx:167`, gọi `:496` | INSERT `maintenance_work_orders` | `maintenanceRouter.ts:89` + `requirePermission(MODULE,"canCreate")` `:90` |
| W3 | `twin.models.uploadAndRegister` | `MachineCockpit.tsx:740` / `:753` (qua ngăn nhúng) | Nạp + đăng ký mô hình 3D cho máy | `twinRouter.ts:129` + `machine_control/canCreate` `:130` |
| W4 | `programming.createArtifact` | `RobotCockpit.tsx:393` / `:402`,`:413` | Tạo phiên bản chương trình `tmscript` | `programmingRouter.ts:317` + `machine_control/canCreate` `:318` |
| W5 | `programming.createProject` | `RobotCockpit.tsx:400` / `:416` | Tạo dự án lập trình robot | `programmingRouter.ts:216` + `machine_control/canCreate` `:217` |

**Không có đường ghi nào ra lệnh OT** (start/stop/reset/đổi chế độ) trên `/twin`. Có chủ ý — xem 12b.4.

#### 12b.1.3 ẨN hay HIỆN-RỒI-CHẶN — đo từng phần tử

Luật của dự án ghi ở `nganXuLyLogic.ts:102-111`: **thiếu quyền ⇒ ẨN; bị chặn tạm thời ⇒ disable +
giải thích.** `duocPhep` (quyền) tách hẳn `lyDoChan` (trạng thái) — `nganXuLyLogic.ts:93-99`.

| Phần tử | `file:line` | Kết luận |
|---|---|---|
| Nút Ack | `NganXuLy.tsx:408-423` | **ẨN** (ternary trả `null` `:423`); `disabled` `:413` chỉ cho `lyDoChan`/pending |
| Nút Ẩn tạm | `:425`, `:652-659` | **ẨN** `:425` |
| Nút + form tạo phiếu | `:434-533` | **ẨN** `:533` |
| Select gán kỹ thuật viên | `:469-485` | **ẨN** `:485` |
| Nút lưu phiếu | `:488-507` | **DISABLE** `:494` khi `title.length < 3` — khớp zod `min(3)` (`maintenanceRouter.ts:93`). Đúng luật: trạng thái, không phải quyền |
| Truy vấn kỹ thuật viên | `:206-209` | **KHÔNG BẮN** khi thiếu quyền (`enabled` `:207`) |
| Nút điều hướng | `:574-599` | **ẨN** (lọc khỏi mảng `:577`) |
| Nút xuất USD | `TwinVanHanh.tsx:2005-2024` | **ẨN** `:2024` |
| **Lưu teach buffer (robot)** | `RobotCockpit.tsx:916-918` | ⚠ **HIỆN-RỒI-CHẶN** — nút vẫn render, chỉ `disabled` + `title` giải thích. **Vi phạm duy nhất** của luật, và **với tới được từ `/twin`** qua ngăn nhúng |

⇒ **Kết luận Q3:** phần `/twin` do các lô này viết **đã theo đúng luật ẩn-không-disable**. Còn **một**
chỗ lệch, thừa kế từ `RobotCockpit` — xem P-3.

#### 12b.1.4 Trục URL đang dùng (G40)

Khoá đã có: `pv=` (phạm vi) · `chon=` (vật thể) · `cam=` (camera) · `lop=` (lớp phủ) · `tg=` (thời
gian) · `thu=` (panel đang thu) — `duongDanTwin.ts:7`. `lop=` là **danh sách ĐÓNG 6 tên**
(`duongDanTwin.ts:186-193`): `nhan` `canhBao` `wip` `dongChay` `tuoi` `ngungKhaiThac`.

⇒ **Mọi lớp phủ mới phải THÊM TÊN vào `LOP_HOP_LE`, không đẻ khoá URL thứ bảy.** `thu=` đã được lô J
dùng lại cho bảng KPI (`duongDanTwin.ts:134-142`) — đúng khuôn, cứ thế mà theo.

---

### 12b.2 CÁI GỘP VÀ CÁI BỎ — kèm lý do từng cái

Ba tiêu chí: **(1)** trả lời *"nhà máy đang thế nào"* ⇒ thuộc về Twin · **(2)** chỉ là **cách trình
bày khác** của dữ liệu Twin đã có ⇒ bỏ · **(3)** **ra lệnh OT** ⇒ cân nhắc kỹ.

#### GỘP — 7 mục

| # | Mục | Nguồn `file:line` | Vì sao GỘP |
|---|---|---|---|
| G-1 | **Health score + nguy cơ hỏng theo máy** | `DigitalTwinDashboard.tsx:245-250`, thủ tục `digitalTwin.twinState` | Trả lời thẳng *"máy nào sắp hỏng"*. `/twin` hiện tô màu theo **trạng thái vận hành**, không theo **sức khoẻ** ⇒ thông tin MỚI, không phải trình bày lại. Nguồn `machine_health_history` **185.180 hàng, mới nhất hôm nay** |
| G-2 | **Mô phỏng what-if năng suất** | `DigitalTwinDashboard.tsx:319-377, 556-606` | Mặt **mô phỏng** duy nhất trong cả 4 trang — đúng nghĩa "digital TWIN" chứ không phải digital shadow. Hàm thuần, **không chạm CSDL** ⇒ không mang theo rủi ro tenant |
| G-3 | **Tua lại lịch sử (replay/scrub)** | `DigitalTwinCenter.tsx:504-592, 750-800` | *"Nhà máy đã thế nào lúc 3 giờ sáng"* là câu hỏi vận hành chính đáng. `/twin` **đã có** `DongThoiGian` (`:2262-2270`) và khoá `tg=` ⇒ **nối nguồn vào khung đã dựng**, không dựng khung mới |
| G-4 | **Vùng (zones) + glTF + robot khớp động** | `DigitalTwinCenter.tsx:282-308, 171-184, 240-243` | Vùng an toàn / chia-sẻ-với-người là **thông tin an toàn**, không phải trang trí. `/twin` có dải E-STOP (`:2242`) nhưng **chưa vẽ được vùng** |
| G-5 | **Đài cảnh báo hợp nhất + tồn đọng >24h + "phạm vi rỗng ≠ không có cảnh báo"** | `CommandCenter.tsx:1415-1505`, đặc biệt `:1458-1481` | `/twin` **đã có** `DaiCanhBao`; cái đáng gộp là **ô phân biệt "rỗng vì RBAC" với "rỗng vì bình yên"** (`:1468-1473`) — đúng khuôn honest-null, và là **tính đúng đắn an toàn** |
| G-6 | **Lớp phủ UNS realtime + badge live/poll trung thực** | `FactoryLiveMap3D.tsx:39-48, 87, 122-132` | Nói thẳng *"số này đến từ WS hay từ poll 5s"*. `/twin` đã có `trang-thai-ket-noi` (`:1926`) + badge xuất xứ (`:1967`) ⇒ **nối thêm nguồn vào chỉ báo đã có** |
| G-7 | **Cây phân cấp site→máy có roll-up** | `CommandCenter.tsx:1330-1405` | Mặt điều hướng **đa site** duy nhất. `/twin` chỉ có breadcrumb một nhánh (`:1869`) ⇒ ở quy mô tập đoàn (§11e) đây là khoảng trống thật |

#### BỎ — 6 mục

| # | Mục | Nguồn `file:line` | Vì sao BỎ |
|---|---|---|---|
| B-1 | **Bốn dải KPI "đang chạy / dừng / offline"** | `FactoryLiveMap3D.tsx:157-163` · `DigitalTwinCenter.tsx:726-734` · `DigitalTwinDashboard.tsx:139-176` | Tiêu chí (2). `/twin` **đã có** `khoi-tong-quan` (`:2306-2325`) + `BangKpiNoi`. Gộp = **năm** bản đếm cùng một thứ, và **bốn cơ hội để chúng lệch nhau** |
| B-2 | **Bảng trạng thái máy dạng bảng** | `DigitalTwinDashboard.tsx:225-254` | Tiêu chí (2). `/twin` đã có `DanhSachMay` (`:2352-2360`) — DOM thật, đi được bằng bàn phím. Bảng thứ hai không thêm sự thật nào |
| B-3 | **Ba bộ dựng sàn 3D rời** | `FactoryLiveMap3D.tsx:177` · `DigitalTwinCenter.tsx:819-832` · `CommandCenter.tsx:863-867` | Tiêu chí (2), và tệ hơn: chúng đọc **hai nguồn khác nhau** (`machineStatus` vs `twin.sceneGraph`) trên **hai hệ toạ độ khác nhau** (`CommandCenter` dùng lưới tổng hợp `:466-491`, không phải vị trí thật). Giữ cả ba là mời hai cảnh 3D nói hai câu khác nhau về cùng một nhà máy |
| B-4 | **Ba bộ chọn nhà máy** | `FactoryLiveMap3D.tsx:135-140` · `DigitalTwinCenter.tsx:658-663` | Tiêu chí (2). `/twin` đã có `pv=` + breadcrumb — **một trục phạm vi duy nhất, ghi được vào URL** |
| B-5 | **`stationLoadHeatmap` làm nguồn nút thắt** | `DigitalTwinDashboard.tsx:437-480` | ⚠ **KHÔNG phải vì trùng lặp — vì nó KHÔNG TỰ CHỨNG MINH ĐƯỢC MÌNH CÒN HẠN.** Lô trước đã **cố ý gỡ** lời gọi này khỏi `/twin`; lý do ghi nguyên văn ở `TwinVanHanh.tsx:574-582`: thủ tục **không trả `periodStart`**, và nghiệm thu Đợt 8 đo được **một lời khai 16 ngày tuổi tô đỏ sai trạm**. Nguồn ĐÚNG đang dùng: `wip.lineBalance` — trả NGUYÊN HÀNG nên `bottleneckStationId` và `periodStart` **chắc chắn cùng một bản ghi**. Gộp lại = tái lập đúng lỗi đã vá (G12) |
| B-6 | **Nhúng `/command-console` (ra lệnh OT) cạnh 3D** | — | Tiêu chí (3). Lô G đã **cố ý không nhúng**; xem 12b.4 |

---

### 12b.3 TỪNG NGHIỆP VỤ — đã có hay chưa

| Nghiệp vụ | Trạng thái | Chỗ gọi / thiếu gì |
|---|---|---|
| **THEO DÕI** trạng thái máy realtime | CÓ | `TwinVanHanh.tsx:516` (`factoryCommand.overview`), `:1926` chỉ báo socket |
| Theo dõi cảnh báo andon | CÓ | `:529` (`andon.active`), đài `:2335-2350` |
| Theo dõi an toàn robot / E-STOP | CÓ | `:542` (`twinCanh.anToanRobot`), dải `:2242` |
| Theo dõi WIP theo trạm | CÓ | `:566` (`digitalTwin.wipFlowState`) — **đã lọc tenant sau Q1** |
| Theo dõi nhịp chuyền / nút thắt | CÓ | `:600` (`wip.lineBalance`) — nguồn tự chứng minh được hạn |
| Theo dõi **sức khoẻ máy / nguy cơ hỏng** | **CHƯA** | Cần G-1. Nguồn `machine_health_history` **có thật** (185.180 hàng, mới nhất hôm nay) nhưng `/twin` **chưa gọi** `digitalTwin.twinState` |
| Theo dõi **chất lượng / tỷ lệ NG** | **BỊ CHẶN** | `product_inspections.factoryCode` NULL **2.880/2.880** ⇒ mọi vai không-admin thấy rỗng. **Phải sửa nguồn ghi trước** — P-1 |
| Theo dõi **dự báo tắc nghẽn** | **BỊ CHẶN** | `station_dwell_time` mới nhất **17 ngày**; chuỗi WIP 24h chuyền 1 = **0 bucket** ⇒ `insufficient_data`. Cần lô P sinh `station_dwell_time` mốc mới — P-2 |
| Theo dõi **đa site / tập đoàn** | **CHƯA** | Cần G-7 |
| **ĐIỀU CHỈNH** — tiếp nhận cảnh báo | CÓ | W1 `NganXuLy.tsx:416` |
| **ĐIỀU CHỈNH** — ẩn tạm cảnh báo (shelve) | **NỬA VỜI** | Nút **có** (`NganXuLy.tsx:652-659`), quyền có (`anTamAlarm`), **nhưng KHÔNG bắn mutation nào** — chỉ mở hộp giải thích (docblock `:623-644`). Một hành động **khai mà chưa nối đường ghi** |
| **SỬA ĐỔI** — tạo phiếu bảo trì | CÓ | W2 `NganXuLy.tsx:496` |
| **SỬA ĐỔI** — gán kỹ thuật viên | CÓ | `NganXuLy.tsx:469-485` (cần `suaPhieu`) |
| **SỬA ĐỔI** — đăng ký mô hình 3D cho máy | CÓ (qua ngăn nhúng) | W3 `MachineCockpit.tsx:753` |
| **SỬA ĐỔI** — chương trình robot | CÓ (qua ngăn nhúng) | W4/W5 `RobotCockpit.tsx:402`,`:416` |
| **SỬA ĐỔI** — vị trí / hình học máy trong cảnh | CÓ, **ở màn khác** | `/twin-studio` (`App.tsx:326`). `/twin` **cố ý chỉ đọc** hình học; banner đối soát `:2132` **link sang** studio |
| **RA LỆNH OT** (start/stop/reset) | **KHÔNG CÓ, VÀ ĐỀ NGHỊ GIỮ NGUYÊN** | Xem 12b.4 |

#### Từng hành động trên cảnh 3D — quyền, đường ghi, hoàn tác

| Hành động | Điều kiện quyền | Đường ghi | Hoàn tác được? |
|---|---|---|---|
| Chọn vật thể (máy/robot/trạm) | Không | Không ghi — chỉ `chon=` trên URL | Có (bấm chỗ khác) |
| Xoay / kéo / zoom camera | Không | Không ghi — `cam=` trên URL | Có |
| Bật/tắt lớp phủ | Không | Không ghi — `lop=` trên URL | Có |
| Thu/mở panel | Không | Không ghi — `thu=` trên URL | Có |
| Tua thời gian | Không | Không ghi — `tg=` trên URL | Có |
| Xuất USD | `machine_status/canView` | Không ghi server; tải tệp về máy | Không cần |
| **Ack cảnh báo** | `andon/canEdit` | W1 → `andon_events` | **KHÔNG** — có `resolve` riêng (`andonRouter.ts:134`) nhưng không có "bỏ ack" |
| **Tạo phiếu bảo trì** | `machine_monitoring/canCreate` | W2 → `maintenance_work_orders` | **KHÔNG** trên `/twin` — phải sang màn bảo trì |
| **Gán kỹ thuật viên** | `machine_monitoring/canEdit` | W2 (trường `assignedTo`) | Như trên |
| Kéo-thả vị trí máy | — | **Không có trên `/twin`** (chỉ `/twin-studio`) | — |

---

### 12b.4 ★ ĐIỀU TÔI KHÔNG KHUYÊN LÀM — và vì sao nói thẳng

Chủ sở hữu viết *"mọi hoạt động của nhà máy đều có thể quản lý, theo dõi, **điều chỉnh và sửa đổi**
được"*. Đọc tối đa nghĩa câu ấy sẽ dẫn tới **nhúng bảng ra lệnh OT cạnh cảnh 3D**.
**Đề nghị KHÔNG làm**, ba lý do đo được:

1. **Lô G đã cố ý không nhúng `/command-console`**, lý do ghi lại: *"nhúng cạnh 3D là mời bấm nhầm"*.
   Cảnh 3D là mặt **khám phá** — người dùng xoay, kéo, bấm thử. Một nút `STOP` sống trong mặt khám
   phá là một nút **sẽ** bị bấm thử.
2. **Hai mutation ghi hiện có của `/twin` CHƯA LỌC TENANT** (12b.6, L-1). Thêm đường ghi mạnh hơn
   (lệnh OT) lên một mặt mà đường ghi yếu hơn còn chưa an toàn là **cộng dồn rủi ro**, không phải
   thêm tính năng.
3. Cảnh 3D **không tự chứng minh được mình còn hạn ở mức đủ cho lệnh OT**. `/twin` có badge độ tuổi
   (`:1986`) — nhưng "đủ tươi để NHÌN" khác "đủ tươi để RA LỆNH". Bấm `STOP` lên một máy khi cảnh
   đang trễ 5 giây là **dừng nhầm máy**.

**Đề xuất thay thế:** giữ **chọn-rồi-nhảy** — `/twin` chọn máy, nút "Mở chức năng"
(`NganXuLy.tsx:574-599`, đã lọc theo quyền `:577`) đưa sang cockpit/console thật. Người dùng **rời
mặt khám phá một cách có ý thức** trước khi chạm đường ghi OT. Đây là hành vi **đang có**, chỉ cần giữ.

---

### 12b.5 KHOẢNG TRỐNG ĐO ĐƯỢC + THỨ TỰ ƯU TIÊN (cái nào CHẶN cái nào)

```
P-1 ──chặn──> nghiệp vụ chất lượng / NG trên /twin
P-2 ──chặn──> dự báo tắc nghẽn + stationLoad
L-1 ──chặn──> mọi đường ghi MỚI trên /twin
```

| # | Việc | Vì sao ở bậc này | Chặn cái gì |
|---|---|---|---|
| **P-1** | **Điền `factoryCode` cho đường ghi `product_inspections`** | 2.880/2.880 hàng NULL ⇒ vai không-admin thấy **0**. ⚠ **Cách chữa SAI là nới cổng thành "NULL thì cho qua"** — đó là mở lại đúng lỗ Q1 vừa vá, cho mọi tenant đọc mọi hàng chưa khai | Toàn bộ nghiệp vụ chất lượng |
| **P-2** | **Lô P sinh `station_dwell_time` với mốc gần hiện tại** | Mới nhất 17 ngày; WIP 24h chuyền 1 = 0 bucket | `predictionOverlay`, `stationLoadHeatmap` |
| **L-1** | **Vá tenant cho W1/W2** (12b.6) | Lỗ **GHI**, cùng lớp với lỗ ĐỌC mà Q1 vừa vá | Mọi đường ghi mới |
| **P-3** | Vá "hiện-rồi-chặn" ở `RobotCockpit.tsx:916-918` | Vi phạm duy nhất của luật ẩn-không-disable, với tới được từ `/twin` | — |
| **P-4** | Nối đường ghi cho nút **Ẩn tạm**, hoặc bỏ nút | Hành động khai mà không ghi gì | — |
| **P-5** | G-1 sức khoẻ máy | Nguồn đã sống, chỉ thiếu lời gọi | — |
| **P-6** | G-5 phân biệt "phạm vi rỗng" / "bình yên" | Tính đúng đắn an toàn | — |
| **P-7** | G-2 what-if · G-3 replay · G-4 zones · G-6 UNS · G-7 cây đa site | Tính năng, làm sau khi nền đã sạch | — |

**Ngân sách phải giữ khi làm G-1…G-7** (§4): nhãn cap **30** · draw call **≤150** · FPS **≥30** ·
lớp phủ bảng theo khuôn `BangKpiNoi` (**0 draw call**, DOM) · bảng phải `z-30` vì nhãn drei ở
**z-index 20** (G41) · nghiệm thu **bằng mắt trên nền thật**.

---

### 12b.6 ★★★ L-1 — LỖ GHI CÙNG LỚP VỚI LỖ ĐỌC VỪA VÁ (phát hiện khi làm Q1)

Q1 vá **đường ĐỌC**. Đo tiếp **đường GHI** của chính `/twin`, thấy cùng hình dạng ấy còn nguyên:

| Thủ tục | `file:line` | Hình dạng |
|---|---|---|
| `maintenance.createWorkOrder` | `maintenanceRouter.ts:89-104` | Khai **`async ({ input })`** — **không bóc `ctx`**. `input.machineId` do client TỰ KHAI, chỉ dùng để tra `machines.code` (`:104`). **Không `phamViCua`, không `trongPhamVi`** |
| `andon.acknowledge` | `andonRouter.ts:125-131` | Có `ctx` (để đóng dấu người tiếp nhận) nhưng **không kiểm `input.id` có thuộc phạm vi người gọi không** |

⇒ Một tài khoản có `machine_monitoring/canCreate` ở nhà máy A **tạo được phiếu bảo trì cho máy của
nhà máy B**, chỉ cần đoán `machineId`. Cổng `requirePermission` **không** đo tenant — hai trục khác
nhau, và chỉ một trục có người canh (đúng câu đã ghi ở `twinDemVatThePhamVi.db.test.ts:14-16`).

**Chưa vá trong lô này** vì `maintenanceRouter`/`andonRouter` **ngoài phạm vi tệp được giao**. Ghi ra
đây để có người ký. Khuôn vá đã có sẵn: `trongPhamVi("machine", input.machineId, phamViCua(ctx))`.

---

### 12b.7 `/twin-studio` — vùng, và ranh giới với `/twin`

`/twin-studio` = `client/src/pages/TwinStudio.tsx`, tuyến `App.tsx:326`. Ranh giới **đang đúng và nên giữ**:

| | `/twin` (Vận hành) | `/twin-studio` (Thiết kế) |
|---|---|---|
| Hình học nhà xưởng | **CHỈ ĐỌC** (`canhThietKe` `TwinVanHanh.tsx:505`) | **SỬA** |
| Cổng quyền | `quyenDocHinhHoc` (`twinCanhRouter.ts:196`) | `quyenThietKe` = `settings_factory` ∨ `machine_control` (`twinCanhRouter.ts:115`) |
| Dữ liệu runtime | Có (WIP, andon, an toàn) | Không |

★ Hai cổng khác nhau **là nguyên nhân** của banner `thieuQuyenBoCuc` (`TwinVanHanh.tsx:611`, `:1807`):
người qua cổng `analytics_oee` vào được `/twin` nhưng `canhThietKe` đòi cổng kia ⇒ **nếu không bắt
FORBIDDEN thì họ thấy một cảnh TRỐNG trông y như nhà máy chưa dựng — một lời khai sai về thế giới**
(nguyên văn `:1802-1806`). Đây là bản vá **đã có** cho lớp lỗi "một lối vào rồi TỪ CHỐI" của Khối D.

---

### 12b.8 Điều kiện nghiệm thu cho phần XÂY (sau khi bàn xong)

1. Mỗi mục G-x phải có **chỗ gọi `file:line`** — hàm không ai gọi = chưa xong (G16).
2. Lớp phủ mới ⇒ thêm tên vào `LOP_HOP_LE` (`duongDanTwin.ts:186`), **không** đẻ khoá URL thứ bảy (G40).
3. Mỗi lớp phủ phải **tự khai được nguồn và độ tuổi**; nguồn không trả mốc thời gian ⇒ **không dùng
   làm chỉ báo** (bài học B-5).
4. Nguồn rỗng ⇒ **`—` kèm lý do**, không `0` (`?? 0` là lời khai sai). Khuôn: `BangKpiNoi`.
5. Đo bằng vai **KHÔNG-admin** (admin bypass `requirePermission` ⇒ đo bằng admin chứng minh **0**).
6. Ngân sách §4 đo lại sau khi thêm: draw call ≤150, FPS ≥30, nhãn ≤30.
7. Mỗi lớp phủ mới đọc dữ liệu tenant phải có **ô hai chiều** như `digitalTwinPhamVi.db.test.ts`.


## 13. Kiểm thử

Hiện trạng: **0 test cho mọi component 3D, 0 e2e liên quan twin.** Đây là lỗ hổng lớn nhất và phải lấp cùng lúc với việc xây.

### 13.1 Vitest — module thuần (`environment: "node"`, chỉ `.ts`)

> ### ★★★ ĐÍNH CHÍNH 2026-09-06, sau khi thực thi module thuần Đợt 2
> Bảng này ban đầu ghi tên tệp là `*.test.ts`. **SAI.** `vitest.config.ts:50` chỉ include
> `client/src/**/*.unit.test.ts` — đo được: **105 tệp `.unit.test.ts` so với 3 tệp `.test.ts`**
> trong `client/src`. Đặt tên theo bản cũ thì tệp test **không bao giờ được thu thập, mà cổng
> vẫn báo xanh** — âm tính giả ở chính thiết bị đo. Chính `vitest.config.ts:41` đã ghi lại một
> lần mắc lỗi này trước đây: *"KHÔNG NẰM trong `include` cũ nên chưa từng được vitest thu thập"*.
>
> **Mọi tệp test module thuần đặt tên `<tên>.unit.test.ts`.** Cổng ra của mỗi đợt phải dán
> **số test được thu thập**, không chỉ dán chữ "xanh" — một suite 0 test cũng xanh.

| Tệp test | Phủ |
|---|---|
| `sinhBoCuc.unit.test.ts` | 9 tính chất T1–T9 (§8.4) |
| `heToaDo.unit.test.ts` | mm↔m, Y↔Z, quaternion chuẩn hoá, bbox, làm tròn |
| `hinhHocCanChinh.unit.test.ts` | ★ **snap xoay TUYỆT ĐỐI** (8° + snap 15° → 15°, không phải 23°), snap lưới, align 6 hướng, distribute, array tuyến tính/toả tròn |
| `snapVatVaoVat.unit.test.ts` | dung sai theo pixel giữ nguyên ở mọi mức zoom |
| `mauTrangThai.unit.test.ts` | đủ enum, `khong_ro` khác mọi màu "khoẻ", tương phản 2 theme |
| `locNhan.unit.test.ts` | cap 30, không chồng bbox, ưu tiên bất thường > gần camera |
| `lichSuThaoTac.unit.test.ts` | undo/redo, giới hạn 50, gộp thao tác kéo liên tiếp |
| `kiemTraAsset.unit.test.ts` | ngưỡng 50k/150k tam giác, 15 MB, bbox suy biến |
| `duongDanTwin.unit.test.ts` | mã hoá↔giải mã round-trip, tham số rác không làm vỡ |
| `hinhKhoiMay.unit.test.ts` | ★ **mọi giá trị `machineTypeEnum` (24) ánh xạ được**, 0 giá trị `undefined`; khối co giãn đúng theo kích thước |
| `hieuChinhNhapModel.unit.test.ts` | quy đổi đơn vị mm/cm/m/inch, đổi trục Z-up↔Y-up, xoay, đặt gốc; bbox sau hiệu chỉnh đúng |
| `tachTangTuHinhHoc.unit.test.ts` | tách cụm theo cao độ, khoảng trống > 0,5 m làm ranh giới, sửa ranh giới thủ công |
| `phamViLine.unit.test.ts` | bao lồi Line, trục chính từ phương sai, hướng dòng chảy từ `orderIndex`, đường tâm qua tâm trạm |
| `boCucTang.unit.test.ts` | dài×rộng×cao → bbox tầng; cao độ tầng trên tự tính; tầng nhỏ hơn toà nhà |

### 13.2 Playwright e2e

| Tệp | Kiểm |
|---|---|
| `e2e/twin-thiet-ke-sinh-tu-dong.spec.ts` | Sinh tự động → thấy ≥ 43 node máy trong cây |
| `e2e/twin-thiet-ke-keo-tha.spec.ts` | Chọn máy → di chuyển → Lưu → reload → vị trí giữ nguyên |
| `e2e/twin-thiet-ke-khong-de.spec.ts` | ★ Chỉnh tay 1 máy → Sinh tự động lại → máy đó **không bị đè** |
| `e2e/twin-thiet-ke-can-chinh.spec.ts` | Chọn 3 máy → Align trái → 3 máy cùng X; Distribute → khoảng cách đều |
| `e2e/twin-thiet-ke-vung-anh-nen.spec.ts` | Vẽ vùng polygon → lưu → reload; tải ảnh nền → đặt tỉ lệ |
| `e2e/twin-van-hanh-dieu-huong.spec.ts` | Click máy → ngăn xử lý → nút "Sức khoẻ máy" → đúng route + id |
| `e2e/twin-van-hanh-ack-alarm.spec.ts` | ★ Click máy có alarm → Xác nhận → alarm đổi trạng thái **thật trong DB** |
| `e2e/twin-van-hanh-tao-phieu.spec.ts` | ★ Click máy → Tạo phiếu → phiếu xuất hiện trong `maintenance.listWorkOrders` |
| `e2e/twin-deep-link.spec.ts` | Mở URL có `?pv=&chon=&cam=` → cảnh khôi phục đúng |
| `e2e/twin-khong-webgl.spec.ts` | Chặn WebGL → tự rơi về 2D, không màn hình đen |
| `e2e/twin-ban-phim.spec.ts` | ★ Chỉ bàn phím: Tab tới danh sách → Enter → ack được alarm |
| `e2e/twin-ngan-sach-hieu-nang.spec.ts` | `window.__thongKeVe` → ≤ 150 draw calls, ≤ 500k tam giác |
| `e2e/twin-du-lieu-khong-ro.spec.ts` | ★ Máy không có dữ liệu → **không** màu xanh; có badge "Không rõ" |
| `e2e/twin-mot-canvas.spec.ts` | ★ RB-4: đếm số `<canvas>` WebGL sống = 1 tại mọi thời điểm |
| `e2e/twin-dung-tang-nhap-tay.spec.ts` | Điền 84×52×6 m → toà + tầng xuất hiện, tường bao sinh tự động |
| `e2e/twin-nhap-ban-ve.spec.ts` | Nhập GLB → hộp thoại hiệu chỉnh; đổi đơn vị → bbox đổi 1.000×; sửa được sau khi nhập |
| `e2e/twin-gan-model-chung-loai.spec.ts` | ★ Gán model cho `AOI` → **mọi máy AOI** đổi hình, không chỉ máy đang chọn |
| `e2e/twin-pham-vi-line.spec.ts` | ★ Chọn Line 1 → Line 2,3 mờ; dải Line 2D click được; deep-link `?pv=line:1` khôi phục |
| `e2e/twin-pham-vi-tap-doan.spec.ts` | Seed nhà máy thứ hai → view Tập đoàn hiện **2 khối** |

Cửa sổ đo cho e2e: `window.__thongKeVe`, `window.__demNhan`, `window.__phamViTwin`, `window.__soCanvas`.

### 13.3 Bánh cóc sẵn có phải giữ xanh

- `client/src/lib/duongVaoMenu.test.ts` — thêm `/twin` + `/twin-studio` vào **cả** `App.tsx` và `navigation.tsx`
- `client/src/i18n/khoaDungTrongMa.test.ts`, `placeholderRatchet.unit.test.ts` — khoá mới đủ `vi`/`en`/`zh`
- `client/src/lib/designTokens.test.ts` — không phá ngưỡng tương phản
- `server/routers/layoutRoutersPermissionKhoiD.db.test.ts` — quyền layout không đổi
- `npm run check` (`tsc --noEmit`) sạch

---

## 14. Rủi ro

| # | Rủi ro | Xác suất | Ảnh hưởng | Giảm thiểu |
|---|---|---|---|---|
| R1 | **Twin thành "đồ trang trí"** — nguyên nhân thất bại số 1 của ngành | Cao | Nghiêm trọng | NT-1 + NT-2 là **tiêu chí nghiệm thu bắt buộc**, không phải "nice to have". Mọi tính năng 3D không trả lời được một câu hỏi vận hành cụ thể thì **cắt** |
| R2 | **Quên một trong 62 tính năng** khi xoá màn cũ | **Cao** | Nghiêm trọng | Sổ kiểm §11 là **cổng ra**. Không xoá màn nào cho tới khi mọi dòng của nó ✅ **đã đo**, không phải "đã khai" |
| R3 | **Di trú toạ độ sai vì `TI_LE_PX_MM` là giả định** | **Chắc chắn** | Cao | Mọi hàng di trú `nguon='sinh'` + badge "chưa đo"; công cụ **Đặt tỉ lệ** để sửa; đối soát 2 mô hình rời nhau (§5.6 bước 3) |
| R4 | **Model drift** — layout thật đổi, twin không đổi | Cao | Nghiêm trọng | QĐ-6: sinh geometry **từ chính DB**, không có bước "nhờ ai đó update file 3D". Banner đối soát §9.5(3). Nhãn đời bố cục §9.5(4) |
| R5 | **Nhập liệu layout không ai làm** — Thiết kế xong nhưng không ai ngồi kéo 43 máy | Trung bình | Cao | Sinh tự động phải cho ra cảnh **dùng được ngay** (Đ2 có cả sinh lẫn kéo). Thiết kế chỉ để tinh chỉnh dần |
| R6 | **Hai editor sống chung gây lệch dữ liệu** | Trung bình | Cao | Editor cũ ghi hệ cũ, Twin ghi hệ mới; **không đồng bộ ngược**. Banner ở editor cũ: "màn này sẽ được thay". Tắt ngay khi sổ kiểm #41–#49 ✅ |
| R7 | ~~Bảng dữ liệu rỗng~~ → **Bảng dữ liệu CŨ** (đính chính Đợt 6): `oee_metrics` 897 hàng · `machine_heartbeats` 108 · `ot_telemetry` **24,4 triệu, tươi** · `factory_zones` 0 | **Chắc chắn** | Trung bình | Phân biệt theo **TUỔI**, không theo rỗng. Thang 3 mức của §9.5 xử đúng mà không cần danh sách hardcode. ★ Ca dương có sẵn: 3 máy `running` im lặng 52 ngày |
| R8 | **Hiệu năng trên máy xưởng** kém hơn máy dev | Trung bình | Trung bình | Ngân sách §4 kiểm bằng **e2e tự động**. `matDoKhungHinh` tự hạ chất lượng. Fallback 2D |
| R9 | **Lỗi drei tái phát** dưới dạng khác | Thấp | Cao | Không tìm thấy issue drei/Vite đang mở nào khớp; drei 10.7.8 tương thích three 0.182 + R3F 9.5. Nhưng thêm test kiểm bundle không phình |
| R10 | **Xung đột merge** ở `App.tsx`, `navigation.tsx`, 3 tệp i18n | Cao | Thấp | Gộp mọi sửa đổi 5 tệp dùng chung vào Đ0, một lần |
| R11 | **Máy vận hành không có WebGL** hoặc driver cũ | Thấp | Cao | Fallback 2D bắt buộc + e2e `twin-khong-webgl.spec.ts` |
| R12 | **Nhánh dài** `feat/hmi-dep` đã có nhiều thay đổi | Trung bình | Trung bình | Làm trên nhánh riêng `feat/twin-3d-trung-tam` cắt từ nhánh hiện tại; rebase sau mỗi đợt |

---

## 15. Tiêu chí nghiệm thu tổng thể

Twin được coi là **hoàn thành** khi và chỉ khi tất cả đúng:

1. `npm run check` sạch · `npm test` xanh · `npm run test:e2e` xanh (gồm 14 e2e mới).
2. Mở `/twin-studio` → Sinh tự động → hiện đủ **43 máy / 37 trạm / 4 chuyền / 2 xưởng**, số khớp DB.
3. Kéo một máy, Lưu, reload → vị trí giữ nguyên. Chạy lại Sinh tự động → máy đó **không** bị đè.
4. Chọn 3 máy → Align trái → cùng toạ độ X (đo bằng e2e, không bằng mắt).
5. **Xoay máy về đúng 15°** bằng snap → giá trị đọc ra là `15.000`, không phải `23.000` (RB-2).
6. Vẽ được vùng an toàn, tải được ảnh nền, đặt được tỉ lệ mét → `daHieuChuan = true`.
7. Kéo máy từ "Khu chờ xếp chỗ" vào mặt bằng → số máy chờ giảm đúng 1.
8. Mở `/twin` → 3D toàn khung → click máy → **ack được alarm thật** (đổi trạng thái trong DB) và **tạo được phiếu thật**.
9. Click máy → nút mở đúng `/machine/:id` và `/station-analysis/:id` với đúng id.
10. Copy URL đang xem, mở tab mới → cảnh khôi phục y hệt (phạm vi, vật thể chọn, camera, lớp bật).
11. Máy không có dữ liệu > 5 phút → **xám gạch chéo "Không rõ"**, không xanh.
12. `renderer.info` báo **≤ 150 draw calls** và **≤ 500.000 tam giác** ở cảnh đầy đủ nhất.
13. Không chạm chuột 10 giây → `frameloop` dừng, GPU về ~0%.
14. Tắt WebGL → tự rơi về 2D, không màn hình đen, vẫn chọn được máy.
15. **Chỉ dùng bàn phím**: Tab tới danh sách máy → Enter → ack được alarm.
16. Đếm `<canvas>` WebGL sống = **1** tại mọi thời điểm (RB-4).
17. Đổi theme sáng ↔ tối → cảnh 3D đúng ở cả hai.
18. Đổi ngôn ngữ vi/en/zh → không còn chuỗi cứng nào trong Twin.
19. **Đo quyền bằng tài khoản KHÔNG phải admin**: vai không có quyền → chế độ chỉ đọc, gizmo và nút Lưu **biến mất** (không phải disable).
20. Điền `84 × 52 × 6` m → tạo được toà nhà + tầng, xem trước 3D đúng tỉ lệ; tường bao sinh tự động.
21. Nhập một file STEP → hộp thoại hiệu chỉnh hiện **thước tỉ lệ + hình người 1,7 m**; đổi đơn vị mm→m làm mô hình đổi kích thước 1.000 lần **thấy được bằng mắt**.
22. Nhập bản vẽ nhiều tầng → tách được theo cao độ; sửa ranh giới trước khi áp dụng.
23. Mọi giá trị của `machineTypeEnum` (24) ánh xạ được sang 1 trong 7 khối — **0 giá trị rơi vào `undefined`**.
24. Gán một model cho chủng loại `AOI` → **mọi máy AOI đổi hình cùng lúc**, không phải gán từng máy.
25. Chọn phạm vi **Line** → chỉ Line đó rõ, Line khác mờ 12 %; mũi tên dòng chảy chạy theo `orderIndex`; dải Line 2D đồng bộ hai chiều với 3D.
26. Tạo nhà máy thứ hai trong DB test → view **Tập đoàn hiện đủ hai khối** (không nghiệm thu bằng ảnh chụp một khối).
27. **Sổ kiểm §11 đạt 62/62 ✅ đã đo** trước khi xoá màn cũ cuối cùng.

---

## 15b. Nợ i18n còn lại — đã đo, cố ý KHÔNG mở rộng phạm vi

Session dọn cổng i18n (`a9049f26`) làm xanh **2 cổng** `entityDictionaryCoverage` +
`appErrorParamsCoverage` (7/7), thêm đúng **7 khoá** vào cả 3 locale, `errors.*` cân bằng
**646/646/646**. Sàng mật độ chứng minh cổng biết kêu (xoá 1 khoá → 2 đỏ; hoàn nguyên → 7 xanh).

**Nợ CÒN LẠI, nằm ngoài `errors.*` nên hai cổng trên không quản:**

| Hạng mục | Số đo |
|---|---|
| Tổng khoá mỗi locale | vi **17.958** · en **17.978** · zh **17.986** — lệch |
| Nợ chính thức đóng băng | **339 thiếu-ở-tất-cả + 20 thiếu-ở-một-vài** (`npm run i18n:check`) |
| Nợ này có phải do Twin sinh ra? | **KHÔNG** — tại HEAD trước khi vá đã là 17.951/17.971/17.979; mỗi tệp chỉ tăng đúng +7 |

**Hai điều người tiếp quản phải biết:**
1. **`i18n:check` sẽ XANH suốt** trong khi nợ này tồn tại, vì nó đã được đóng băng làm đường cơ sở.
   Nghĩa là **không có cổng nào nhắc ai sửa** — nợ này chỉ được xử khi có người chủ động tìm đến.
2. **3 tệp locale là tệp dùng chung.** Dọn ~359 khoá cần một session **không có phiên nào ghi song
   song** — xem luật G2.

## 16. Ngoài phạm vi (YAGNI)

- ❌ Photoreal / PBR / HDRI / raytracing — con đường nhanh nhất biến twin thành đồ trang trí.
- ❌ Mô phỏng vật lý, va chạm, robot kinematics đầy đủ (giữ `ArticulatedRobot` hiện có, không mở rộng).
- ❌ VR/AR/WebXR.
- ❌ WebGPU — RB-6, đo lại khi three.js#30560 đóng.
- ❌ Ràng buộc align vĩnh viễn kiểu Revit (cần constraint solver + đồ thị phụ thuộc + phát hiện chu trình; mặt bằng nhà máy không có phụ thuộc hình học như toà nhà).
- ❌ Rule engine cấu hình được kiểu TwinMaker (biểu thức JEXL → màu). v1 dùng ánh xạ trạng thái cố định.
- ❌ Điều khiển máy trực tiếp từ 3D. Hệ hiện là **ALERT-ONLY**; các nút "Propose" điều hướng sang `/control-plane` và `/command-console` chứ không ghi lệnh xuống máy. Giữ nguyên nguyên tắc đó.
- ❌ Thực thể camera CCTV — DB chưa có bảng camera.
- ❌ Import BIM/IFC (chỉ GLB/GLTF + STEP/IGES ở v1).
- ❌ **Import `.dxf` / `.dwg`** — cần thư viện riêng (`dxf-parser` hoặc RealDWG); bản vẽ 2D dùng làm **ảnh nền tầng** (§7.3) là đủ cho v1.
- ❌ **Import `.svg` làm mô hình máy** — SVG là ảnh 2D không có chiều sâu. Chủ sở hữu có nhắc định dạng này; lý do từ chối ghi ở §10B.2. Nếu cần biểu tượng phẳng thì đó là việc của bản 2D.

---

## 17. Phụ lục: nguồn tham khảo

**Sản phẩm chuẩn ngành**
- AWS IoT TwinMaker Scene Composer — https://docs.aws.amazon.com/iot-twinmaker/latest/guide/scenes-creation.html
- Azure Digital Twins 3D Scenes Studio — https://learn.microsoft.com/en-us/azure/digital-twins/how-to-use-3d-scenes-studio
- `microsoft/iot-cardboard-js` (MIT) — schema `3DScenesConfiguration` đáng học: Scene → Element → Behavior → Layer
- Visual Components (Snap Type 7 chế độ, Align hai điểm, Pattern array) — https://help.visualcomponents.com/4.10/Premium/en/English/3D%20Operations/Snapping_components.htm
- Emulate3D (Rockwell) — Snap Mode 8 chế độ, Align/Distribute/Grid Snap
- Siemens Plant Simulation Bottleneck Analyzer — màu trên vật thể **+** bảng xếp hạng song song

**Kỹ thuật three.js**
- three.js editor (MIT) — khuôn multi-select group-proxy + delta matrix tại `editor/js/Selector.js`; snap tại `Viewport.js:318`
- three.js#29546 — TransformControls không còn là Object3D (RB-1)
- TransformControls snap xoay tương đối — https://discourse.threejs.org/t/transformcontrols-snapping-is-absolute-for-translation-but-relative-for-rotation/47420 (RB-2)
- three.js#30560 — WebGPURenderer chậm với nhiều render item (RB-6)
- R3F Scaling performance — https://r3f.docs.pmnd.rs/advanced/scaling-performance
- BatchedMesh — https://threejs.org/docs/pages/BatchedMesh.html
- `webglcontextlost` phải `preventDefault()` — https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event
- glTF-Transform: `--no-join --no-flatten` giữ danh tính node — https://gltf-transform.dev/

**Chuẩn và cạm bẫy**
- Kritzinger et al. 2018, *IFAC-PapersOnLine* 51(11):1016–1022 — phân loại Model/Shadow/Twin theo mức tích hợp dữ liệu
- ISA-101 HMI — Hollifield, *The High Performance HMI*
- ASM Consortium Guideline 6.1 — ≤7 mã màu; "No 3D graphical objects"
- ISA-18.2 — vòng đời alarm 10 giai đoạn; shelved/suppressed là trạng thái hạng nhất
- ISA-95 / IEC 62264 — `ISA95EquipmentElementLevelEnum`, discrete manufacturing: Enterprise→Site→Area→Production Line→Work Cell
- WEF Global Lighthouse Network — 70% nhà sản xuất kẹt "pilot purgatory"
- ⚠️ Con số *"80% dự án digital twin thất bại"* lan truyền rộng nhưng **không quy được nguồn** — không dùng làm bằng chứng

**Trong repo**
- `client/src/components/factory-scene/` — nền kit 3D (1.393 dòng)
- `server/services/twin/` — 5.269 dòng service đã có
- `CommandCenter.tsx:605-607` — bằng chứng HDR từ CDN làm treo màn hình (RB-5)
- `Factory3DScene.tsx:219-226` — rò rỉ GPU cần vá
