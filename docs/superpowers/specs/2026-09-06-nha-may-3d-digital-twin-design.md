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
| 30 | What-if throughput (`digitalTwin.whatIf`) | ✅ Đợt 19 lô X — `NganMoPhong.tsx`, chỗ gọi `TwinVanHanh.tsx:2577` |
| 31 | Defect heatmap | Lớp phủ 3D + bảng xếp hạng 2D dải dưới |
| 32 | Station load + bottleneck | Lớp phủ + bảng xếp hạng |
| 33 | Prediction tắc nghẽn | Badge nổi + panel cảnh báo |
| 34 | Bảng health/risk (`digitalTwin.twinState`) | Danh sách trái (đồng bộ 2 chiều) |

> **Luật kèm theo:** mọi lớp phủ màu trên 3D **phải có bảng xếp hạng 2D song song** ở dải dưới. Màu không cho phép so sánh chính xác — đây là mẫu của Siemens Plant Simulation Bottleneck Analyzer.

### 11.6 `CellTwinPlayer.tsx` (6)

| # | Tính năng | Đích |
|---|---|---|
| 35 | Phát lại `orchestration.simulate` workflow bất kỳ | ✅ Đợt 19 lô X — `NganMoPhong.tsx`, chỗ gọi `TwinVanHanh.tsx:2577`. ⚠ 4/5 workflow thật `totalDurationMs=0` ⇒ chế độ **theo BƯỚC** (G71) |
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

### 11n.3 LO X DA VE - MUC CUOI DONG, va HAI loi chi TRINH DUYET/ANH bat duoc (2026-09-08)

Cong: **58 tep / 1706 test** (nen 57/1668) - `check` 0 - `build` 0 - DB `factories 2 · machines 43 ·
twin_dat_cho 82` nguyen ven - 5 anh lo C **con nguyen** (`git diff -- test-results/` rong).

| Muc | Cho goi `file:line` |
|---|---|
| #30 what-if | `TwinVanHanh.tsx:2577` `<NganMoPhong>`; truy van `:1502` `digitalTwin.whatIf` |
| #35 phat lai | cung `<NganMoPhong>`; truy van `:1536` `orchestration.simulate`, `:1532` `listWorkflows` |
| **`dangMoPhong` HET hardcode** | **`TwinVanHanh.tsx:1577`** - `daBamChay && dungWhatIf.chay && whatIfQ.data != null` |

Nghiem thu THI GIAC (`.qa-loX/`, cong 3130 rieng, **khong dung 3000 cua phien khac**): badge xuat xu
lat **`bong` → `mo_phong`** khi chay what-if that (san luong **3000**, nut that **#1**) - tu chup, tu doc.

> #### ★★★ G71 - **`gateMs = 0` LA CHU Y DUNG, NHUNG NO LAM CHET NUT BAM TREN 4/5 DU LIEU THAT**
> Do `orchestration.simulate` tren **ca 5** hang `orchestration_workflows`:
> `Line-a-startup` total **34.000** (command/wait) - **4 hang con lai total 0**, vi chung gom **TOAN
> `hitl_gate`** va simulate de `gateMs` mac dinh **0** (`foeSimulator.ts:680`; docblock `:127` ghi
> *"the human pause is 0 in sim by default"* - **dung**, mot cong cho NGUOI khong co thoi luong doan duoc).
>
> Hai he qua, **ca hai deu 1.694 luoi don vi mu**:
> 1. **Nut ►/◄ CHET.** Tap bien `[0, ...startMs, tongMs]` gop ve dung `[0]` ⇒ `f(x) = x`, **G32**.
> 2. **`0.0s / 0.0s` la LOI KHAI SAI** - mot workflow **5 buoc co that** doc y het *"workflow rong"*.
>
> Ban va: `coThoiLuong()` tach **HAI che do** (theo THOI GIAN / theo BUOC), va **ca hai** ham
> `datBuocPhatLai` + `mocBuocKeTiep` phai hoi **cung mot cua** (G12) - lech nhau thi bam nut thay so
> doi ma **khong thanh nao sang**. Che do buoc in "buoc 2/5" + mot cau noi **vi sao** khong co giay.
>
> ⇒ **Luat:** mot mac dinh **dung ve ngu nghia** o tang duoi (`gateMs=0`) van co the la **du lieu thoai
> hoa** o tang tren. Tang tren phai **phat hien va doi che do**, khong duoc trinh bay thoai hoa nhu do dac.

> #### ★★★ G72 - **MODULE THUAN KHONG DUOC SINH CHU CHO NGUOI DOC** (anh tu chup bat)
> `nhanTuoi()` ban dau tra thang `"17 ngày"`, roi tang ve ghep vao khuon EN `"{{tuoi}} ago"` ⇒ man
> hinh in **"(17 ngày ago)"**. `tsc` **0**, **36** luoi don vi **xanh**, **3** ca Playwright **xanh** -
> vi **khong o nao hoi "chuoi nay thuoc ngon ngu nao"**. Chi **TU DOC ANH** moi lo.
> Ban va: `nhanTuoi` tra **`{so, donVi}`** (du lieu), `t()` dich **DON VI** o tang ve.
> ⇒ Cung ho voi G10b: **mot lop loi ma moi cong tu dong deu mu**, chi con mat nguoi (hoac mot o luoi
> hoi dung cau hoi do - da them ca hai: `.unit.test.ts` + assertion e2e `not.toMatch(/ngày|giờ|phút/)`).

> #### ★ G73 - DOT BIEN SONG SOT VI **BO DU LIEU DO TRUNG KET QUA HAI LUAT**
> Thay `coThoiLuong(buoc, tongMs)` bang `tongMs > 0` trong `datBuocPhatLai`: **35/35 luoi van xanh**.
> Ly do: bo `BUOC_TOAN_CONG` di kem `tongMs = 0`, noi **hai luat trung ket qua**. Cho chung khac nhau
> DUY NHAT la `tongMs > 0` **va** moi buoc dai 0 - chua o nao hoi. Them ca do ⇒ dot bien chet.
> ⇒ **Luat:** dot bien song sot **khong** co nghia ban va thua; truoc het hay hoi *"bo du lieu cua toi
> co di qua cho hai ban cai dat KHAC NHAU khong?"* **9/9** dot bien bi giet sau khi bo sung.

**Honest-null tren CSDL nay (G45 - "khong lam" cung la ket luan do duoc):** `line_balance_metrics`
chuyen 1 co **6 hang**, hang moi nhat **2026-08-21 (17-18 ngay)** va **chinh hang ay `avgCycleTimeMs`
NULL**; `station_dwell_time` chuyen 1 moc moi nhat **2026-07-19/08-21**. ⇒ what-if tren du lieu that
ra **`ban_ghi_khong_co_nhip`**: hien `—` **kem CAU giai thich + tuoi**, khong hien `0`.
`dungDauVaoWhatIf` tach **SAU** ly do roi nhau (`chua_chon_line` · `khong_co_tram` · `chua_do` ·
`khong_co_ban_ghi` · `ban_ghi_khong_co_nhip` · `nhip_het_han`) - gop chung lam mot la vut di dung
phan giup nguoi van hanh biet phai lam gi (G50).

★ **Cua kiem han dat o CLIENT, va do la bat buoc:** `whatIf` la ham **thuan** ⇒ no **tin tuyet doi**
`cycleTimeSec` ta gui len, khong co cach nao biet con so ay 18 ngay tuoi. Dung lai `conHieuLuc` +
`HAN_KHAI_NGHEN_MS` (8h) cua `wipTram.ts` - **khong viet ban thu hai** (G12).

★ **G40 lan hai:** `"moPhong"` them vao `PANEL_THU_DUOC` (`duongDanTwin.ts:152`), **khong de khoa URL
thu bay**. Danh sach DONG o ca hai chieu ⇒ quen them ten thi `?thu=moPhong` bi **nuot cam** (ghi ra
dung, doc lai rong, ngan tu mo lai sau F5, **khong loi nao no**) - dung lop **G67 "tang dau tien la KIEU"**.

★ **Brief cua chu du an dung o moi diem kiem duoc** (`TwinVanHanh.tsx:836` hardcode · `whatIf` thuan
khong rui ro tenant · `simulate` ton tai · §12b.2 xep G-2 vao nhom GOP). **Mot cho chua day du:**
brief noi *"neu mot phan mo phong khong co du lieu de chay"* - thuc te **ca hai phan deu co du lieu**,
nhung **theo hai kieu khac nhau**: #35 co **5 workflow that** (chay duoc ngay), #30 co nguon nhung
**het han/NULL** ⇒ honest-null. Khong phan nao la "ngan trong".

## 11o. DOT 19 LO X - **DONG MUC CUOI CUA SO KIEM §11** (2026-09-08)

Commit `84cd5a3d`. Cong: **58 tep / 1.706 test** (nen 57/1.668) - `check` 0 - `build` 0 -
DB `2 / 43 / 82` - **5 anh lo C con nguyen**.

`dangMoPhong` **thoi hardcode**: `TwinVanHanh.tsx:1577` tinh tu trang thai that
(`daBamChay && dungWhatIf.chay && whatIfQ.data != null`). `<NganMoPhong>` render o `:2577`;
#30 qua `digitalTwin.whatIf` (`:1502`), #35 qua `orchestration.simulate` (`:1536`).
**Nghiem thu tren trinh duyet that**: huy hieu xuat xu lat **`bong` → `mo_phong`** sau mot lan chay
what-if that (dau ra 3000, nut that #1). Hang `line_balance` gieo de chung minh **da xoa** (39 truoc = 39 sau).

> #### ★★★ G71 - `gateMs = 0` LA MAC DINH DUNG, NHUNG **DU LIEU THUONG NGUON THOAI HOA**
> Do **ca 5 workflow that**: `Line-a-startup` tong **34.000 ms**; **bon cai con lai tong 0** vi deu la
> `hitl_gate` (cong cho NGUOI, khong co thoi luong may).
> Hai he qua: (a) tap bien gioi **co lai con `[0]`** ⇒ nut buoc **chet tren 4/5 workflow that** (**G32**,
> `f(x)=x`); (b) in `0.0s / 0.0s` cho mot workflow **5 buoc co that** doc ra thanh *"workflow rong"* -
> **mot loi khai sai**.
> Va bang `coThoiLuong()` tach **che do thoi gian** khoi **che do buoc**, va **ca hai nguoi tieu thu hoi
> CUNG MOT cong** (G12 - khong de hai ban lech nhau).

> #### ★★★ G72 - **MOT MODULE THUAN KHONG DUOC PHAT VAN XUOI CHO NGUOI DOC**
> `nhanTuoi` tra chuoi **`"17 ngay"`**, bi ghep vao khuon mau EN `"{{tuoi}} ago"` ⇒ man hinh in
> **"(17 ngay ago)"**. `tsc` **0 loi**, **36 unit test xanh**, **3 ca Playwright xanh** - **khong phep do
> nao hoi "chuoi nay tieng gi"**. Chi doc **anh chup cua chinh minh** moi bat duoc.
> Nay tra **`{so, donVi}`** de tang hien thi tu chon ngon ngu.
> ⇒ Ranh gioi: module thuan tra **du lieu co cau truc**; **chi tang hien thi** moi duoc ghep chu.

> #### ★★★ G73 - **DOT BIEN SONG SOT: HOI DU LIEU CO DI QUA CHO HAI BAN KHAC NHAU KHONG**
> Mot dot bien **song sot** (thay `coThoiLuong(...)` bang `tongMs > 0`, **35/35 van xanh**) - vi fixture
> cua lo X ghep **moi buoc = 0 voi `tongMs = 0`**, dung cho **hai quy tac DONG Y voi nhau**.
> Them ca phan biet (`tongMs > 0` **VA** moi buoc dai 0) ⇒ dot bien **chet**. Tong **9/9 bi giet**.
> ⇒ Dot bien song sot **truoc het** goi y *"du lieu thu cua toi co di qua **cho hai ban cai dat khac
> nhau** khong?"* - truoc khi ket luan "luoi yeu".

### 11o.1 Honest-null la **thuc te do duoc**, khong phai thieu sot

Tren DB nay what-if **khong co nguon cycle-time con han**: hang moi nhat cua `line_balance_metrics`
line 1 la **2026-08-21** (17-18 ngay) va **chinh hang do co `avgCycleTimeMs` NULL**;
`station_dwell_time` cu **18-51 ngay**. Nen bang hien **`—` kem MOT CAU va TUOI**, khong bao gio `0`.
`dungDauVaoWhatIf` phan biet **SAU ly do** rieng thay vi mot cau "khong co du lieu".
**Cong han tuoi dat o phia client CO CHU Y** - `whatIf` la ham thuan, **tin bat ky `cycleTimeSec` nao ta
gui**, nen no **khong the biet** con so da 18 ngay tuoi. Dung lai `conHieuLuc`/`HAN_KHAI_NGHEN_MS` (G12).

**Lo X KHONG dung `station_dwell_time` lam cycle time**: `dwellMs` gom `starvedMs`/`blockedMs` -
**cho, khong phai lam**. Dung no se la **cung loai sai dai luong** voi `commandLog.avgDurations` o #36.

**G40:** `"moPhong"` duoc them vao danh sach **dong** `PANEL_THU_DUOC` thay vi de khoa URL thu bay.
Bo qua buoc do thi `?thu=moPhong` **bi nuot im lang** (ghi duoc, doc ra rong, panel mo lai sau F5,
**khong loi nao no**) - dung lop **G67/G69** "chet o tang kieu/danh sach truoc".

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


## 13b. §14 — THIẾT KẾ LẠI 3D TWIN HỢP NHẤT (ĐỢT 20, 2026-09-08)

> **Vì sao mục này mang số 13b chứ không phải 14.** Brief giao *"mục mới §14"*, nhưng tài liệu này
> **đã có `## 13c. QUYET DINH CUA CHU SO HUU VE §13b (2026-09-08)

Ban thiet ke §13b hoi **ba cau**. Chu so huu tra loi **ca ba**, va cau 1 duoc lam ro them
sau khi chu du an **do be mat anh huong**.

### 13c.1 Cau 1 - **GOP**, va gop theo kieu **QUYEN THEO TUNG VUNG**

§13b **de nghi khong gop** vi hai cong quyen khac nhau. Chu du an kiem lai va **xac nhan luan diem**:

| Man | Cong (`navigation.tsx`) |
|---|---|
| `/twin` | `analytics_oee` **hoac** `machine_status` (`:446`) |
| `/twin-studio` | `settings_factory` **hoac** `machine_control` (`:467`) |

Nhung chu so huu **van chon GOP**. De quyet dinh khong mu, chu du an **do be mat that**:

```
Tong tai khoan hoat dong co quyen : 7
Vao duoc CA HAI                   : 4
CHI vao duoc /twin                : 1   <- operator1 (vai operator)
```

⇒ Rui ro **khong phai gia dinh**, no la **dung mot nguoi**. Va vi the co loi thoat sach:

> #### ★★★ QD-16 - MOT TRANG, **QUYEN THEO TUNG VUNG**, KHONG PHAI MOT CONG DUY NHAT
> Ai co `analytics_oee`/`machine_status` **vao duoc trang va XEM moi thu**.
> Cong cu **SUA nha xuong** (keo tha, gizmo, luu bo cuc) **chi hien** voi ai co
> `settings_factory`/`machine_control`.
> ⇒ `operator1` **khong mat gi** - chi khong thay nut sua. Dung **luat an-khong-disable** ma du an
> da theo (§12b.3, va ban va P-3 o `RobotCockpit.tsx:916-918`).
>
> **Vi sao KHONG chon hai kieu gop kia:**
> - **Cong chat** (`settings_factory`): `operator1` **mat luon loi vao**, khong xem duoc 3D nua -
>   **dung tai nan Dot 3 CHAN-1** (1/4 vai mat quyen) ma **Dot 15 da phai va nguoc lai**.
> - **Cong rong** (ai xem duoc thi sua duoc): `operator1` **sua duoc nha xuong**. Do la **doi mo hinh
>   an toan**, khong phai doi giao dien - va **loi lo K da tu choi** dung kieu nay
>   (noi quyen khi khong chung minh duoc truc tenant roi).

### 13c.2 Cau 2 - **BO phong cach sci-fi** cua mau

Chu so huu **dong y bo**. Ly do §13b nêu, chu du an giu nguyen: tren nen neon xanh **mot may do
KHONG NOI BAT** - mat dung thu ma canh 3D ton tai de lam.
⇒ Theo **ISA-101**: xam trung tinh lam nen, **mau chi danh cho bat thuong**. Nguon mau **duy nhat**
van la `mauTrangThai.ts` (≤7 ma) - **khong de bang token thu hai** (G12).

### 13c.3 Cau 3 - **Dong y** chuyen `floor`/`layout` sang vung sua

Chu so huu dong y. Ket hop **QD-16**: vi nay la **mot trang**, "chuyen sang `/twin-studio`" tro thanh
**"nam trong vung chi hien voi quyen sua"** - nen **khong ai bi cat loi vao**, ke ca `operator1`.

### 13c.4 Rang buoc mang sang Dot 21

- Pham vi la **hoan thien + doi bo cuc**, **khong phai viet lai**: dem duoc **38 chuc nang -
  CO 24 · MOT PHAN 4 · CHUA 10** (§13b).
- Bon muc G chua noi: **G-1 suc khoe may** (nguon `machine_health_history` **180.674 hang, tuoi HOM NAY**),
  G-4 vung, G-6 UNS, G-7 cay da site.
- **G74 (§13b)**: *"da gop" la loi khai ve TEP, khong phai ve VIEC* - what-if/phat lai/tua lai **da noi
  san** (`:1502`, `:1536`, `:748`). Dem lai truoc khi giao.
- Bang 38 chuc nang la **anh chup 2026-09-08**, khong phai hang so - brief Dot 20 **da lech so voi ma
  chi sau ~1 ngay** (**G55**: so do co han su dung).

## 13d. DOT 21 LO Z - 3/4 muc G, va mot huy hieu KHAI SAI DAI LUONG (2026-09-08)

Commit `5a80d5b2`. Cong: **65 tep / 1.834 test** (nen 58/1.706) - `check` 0 - `build` 0 - DB `2/43/82`.

### 13d.1 Z1 - Suc khoe may, **nhom (A)** neo vat the

Do truoc khi lam: `machine_health_history` **180.800 hang** (brief ghi 180.674 - **bang dang ghi LIVE**,
moc chay 09:27 → 09:40 → 09:57), **43/43 may co hang**, 42/43 tuoi trong 24h.
**G50 duoc KIEM chu khong gia dinh**: `healthScore`/`predictedFailureRisk`/`maintenanceUrgency`
NULL = **0/180.800** ca ba cot. Mien [55…100]; **6/43 duoi 60**, 21/43 duoi 80.

Cho goi: `CanhVanHanh.tsx:415` (`<LopVienSucKhoe>`), logic `sucKhoeMay.ts`, duong doc
`twinCanhRouter.ts:1152` + `twinCanh.ts:2043`.
**Ngan sach:** 1 InstancedMesh cho moi vong ⇒ draw call **3 → 4**. Chi hang `nguy_kich` gianh nhan
(**6 may**); neu cho hang `canh` gianh thi rieng no **an 21/30 cho**.

### 13d.2 Z2 - Vung len man Van hanh, **nhom (A)**

**Nguon VAN RONG** (do lai, khong ke thua): `twin_vat_the` 4 hang, toan `tuong`, **0 hang `vung`**.
Lo Z dung **ca duong that** (polygon 6000×4000mm), doc qua dung cau `traVungAnToan`, roi xoa;
**khoi phuc byte-exact** (`tong=4 maxid=44 md5=db6eb576…` khop truoc/sau).
Cho goi `CanhVanHanh.tsx:411`. **Tai dung `thiet-ke/LopVung`** (G12), **khong** truyen `onChon` -
van hanh **chi doc**.

### 13d.3 ★★★ Z3 - **HUY HIEU "TRUC TIEP" KHAI SAI DAI LUONG** (ho G7)

**G74 tra gia dung nhu canh bao**: `phuUns` **da co va da duoc goi that** (`TwinVanHanh.tsx:154`),
`trang-thai-ket-noi` (`:2342`) va `badge-xuat-xu` (`:2383`) **deu da co**. Khoang trong that nam cho khac:

> `nhipHoiMs` lam poll tRPC **chay SONG SONG voi WebSocket, khong bao gio tat** (`TwinVanHanh.tsx:570`,
> `:583` - chu du an kiem, **con nguyen**). Nen khi huy hieu noi *"Truc tiep"*, **mot phan so van den tu
> poll 30s**. Huy hieu **khai mot dai luong no khong do** - cung ho **G7** (`commandLog.avgDurations`
> bi dung lam cycle time) va **G56** (gan nham nguon cho thu tuc).
> `xuatXuNhip.ts` tach **5 hang**: `day` · `hon_hop` · `hoi` · `lich_su` · `chua_ro`.

### 13d.4 Chong G5 bang ablation that

Go cho goi ⇒ **2 test TANG 1 do**. Di moi hang ve mot mau ⇒ test *"ba mau roi nhau"* **do** - dung phep
do ma **12 cot WIP trang** tung truot (G29).
**Tien de G5 bat loi cua chinh lo Z hai lan**: fixture `55+i` roi `54+i` **deu lech nguong 60**.

### 13d.5 Ba dieu lo Z bac / dinh chinh

1. **`digitalTwin.twinState` KHONG thieu `phamViCua`** - brief cua chu du an ngu y G49 co the ho;
   thuc te no **co** o `digitalTwinRouter.ts:85`. Lo Z mo duong moi **vi ly do khac**: `twinState`
   **vut `timestamp`** ⇒ **G30 khong kiem duoc han**, va no keo toan bo hang ve app-layer.
2. **`vramPha5Gate` do (FILE_CANH 126→128) la NO CO SAN**, khong phai cua lo Z: no dem tep test tu khai
   `"Pha N"`; ca 5 tep twin3d dinh vao **deu da commit tu lo truoc**. Bon tep test cua lo Z: **0 lan
   khop regex** (do bang grep). ⚠ `git stash` bi hook chan ⇒ phai chung minh no-co-san bang
   **`git archive` + grep**, khong bang stash.
3. **Mot luot test tranh I/O voi `rm -rf` co the BAO THIEU tep ma VAN EXIT XANH** (24/892 thay vi
   65/1834) - **mot cai bay hinh dang G5 nua**: cong xanh tren mot tap bi cat ngan.

### 13d.6 ⚠ CA BA MUC DUNG O RANH GIOI TEP - **G16 con mo**

Cho goi cuoi cung cua ca ba nam trong **`TwinVanHanh.tsx`** ma **lo Y dang giu**. Lo Z **khong dung** -
dung luat. Chu du an kiem: `grep -c "vienSucKhoe|khaiNguonSo|vungTuDanhSach" TwinVanHanh.tsx` ⇒ **0**.
⇒ Ha tang **co**, nhung **chua giao duoc gi**. Ba prop cho lo Y noi:
`vienSucKhoe(khai, cho, bayGio)` · `vungTuDanhSach(canhThietKe.vung)` (`canhThietKe` **da tra `vung`**)
· `khaiNguonSo({ketNoi, mocGoiCuoi, mocPollCuoi, dangXemLai}, bayGio)`.

**Z4 (G-7 cay da site) CHUA LAM.** Khong co anh nghiem thu thi giac - lo Z **khong chay Playwright**.

## 13e. DOT 21 LO Y - BO CUC NOI-DE + QD-16, va **MOT MUC TIEU BAT KHA THI** (2026-09-08)

Commit `54b1cabe`. Cong: **65 tep / 1.834 test** - `check` 0 - `build` 0 - DB `2/43/82` -
**5 anh lo C md5 y het**.

### 13e.1 Ket qua do duoc (1280×720, vai khong-admin, tren `dist` da dung)

| | truoc | sau |
|---|---|---|
| Canvas | 488×453 = **24,0 %** | 968×515 = **51,4 %** |
| Chieu **rong** canvas | 488 px | **968 px = TRON khung**, o **ca hai** trang thai panel |
| Dai ngang | **280 px** ca xau nhat | **74 px** (tran §13b 120) |

**Panel tu CHIA DAT sang NOI DE** - vi the chieu rong **khong doi** khi thu panel nua.

> #### ★★★ G75 - **MUC TIEU PHAN TRAM PHAI KIEM BANG SO HOC TRUOC KHI GIAO**
> §13b (va brief cua chu du an) dat muc tieu canvas **82 % / 94 %**. Lo Y chung minh **bat kha thi
> trong pham vi tep cua no**, va chu du an **tinh lai xac nhan**:
> ```
> khung twin = 1280 − sidebar 264 − <main> padding 48 = 968 px
>              720 − app chrome 133 − padding 24      = 563 px
> TRAN TUYET DOI (canvas an TRON khung, 0 dai, 0 panel) = 968×563 / (1280×720) = 59,1 %
> De dat 82 % can chieu rong 1.342 px — khung chi co 968.
> ```
> Phan con lai bi `DashboardLayout.tsx:658` an - **ngoai pham vi lo Y**. Thu sidebar (nut da co san
> cua vo) nang tran len **72,3 %**.
> ⇒ **Chu du an dua con so 82 % vao brief ma khong kiem.** Mot muc tieu phan tram luon la **ti so hai
> so**; phai do **mau so** truoc khi hua tu so. Va **nen tuyen bo tran** (*"59,1 % neu khong doi vo"*)
> thay vi mot con so tuyet doi.
> **Nen cung sai:** brief ghi *"~17 %"*; do lai la **24,0 %**.

### 13e.2 Hai URL redirect trong §13b **se hong am tham**

Lo Y bat truoc khi giao:
- `?tab=map` → `/twin?lop=uns` — **`"uns"` KHONG nam trong `LOP_HOP_LE`** (danh sach dong 6 ten).
  `docLop()` **bo ten la trong im lang** ⇒ URL trong nhu chay ma khong lam gi (ho **G67/G69**:
  chet o tang danh sach truoc).
- `?tab=cell` → `/twin?thu=moPhong` — **NGUOC**: `thu=` liet ke panel **dang THU LAI**. URL do se
  **dong dung ngan Mo phong** ma nguoi dung vua bam vao de xem.
⇒ Ca hai doi dich ve `/twin`.

### 13e.3 QD-16 - chung minh hai chieu bang tai khoan that

Be mat do tren `permissions`: **7** tai khoan co quyen, **4** ca hai man, **dung 1** (`operator1`)
chi-xem — **khop §13c.1**.

| | vao trang | thay nut "Sua bo cuc" |
|---|---|---|
| `operator1` | ✅ | ❌ |
| `engineer1` | ✅ | ✅ |

`?che-do=botri` (dich redirect **den voi moi nguoi**): `operator1` → **ha xuong che do xem VA duoc bao**;
`engineer1` → vao vung sua. **5/5 e2e xanh**, anh tu doc.
**Dot bien**: **ca hai hinh dang tai nan** deu duoc thu — *cong rong* (**5 test do**) va *cong chat*
(**2 do**). Dot bien bo cuc (panel ve chia-dat) ⇒ e2e bat **968→488 px, 51,4 %→27,3 %**.

### 13e.4 No G16 cua lo Z **DA DONG**

Chu du an kiem: `TwinVanHanh.tsx` tu **0** len **12** tham chieu.

| Ham | Cho goi | Chung minh song |
|---|---|---|
| `vienSucKhoe` | `:1109` → prop `:2948` | **42 khai suc khoe** qua day; **vong hien trong anh**, mot cai do |
| `vungTuDanhSach` | `:1141` → prop `:2949` | `vung = 0 hang` — **nguon rong that**, khong bia |
| `khaiNguonSo` | `:1871` → badge `:2528` | badge doc **`day + hoi 30s`**, `coChe=hon_hop` |

Ban va **G7** duoc xac nhan tai nguon: `nguonDuLieu.ts:37` `NHIP_CO_LUONG_MS = 30_000` — poll **co y
khong bao gio tat**, nen chu *"Truc tiep"* mot minh dang mo ta **KET NOI** trong khi nguoi doc suy ra
**CON SO**.

### 13e.5 Mot quyet dinh lo Y **giu lai** thay vi xoa

Lo Y **giu** muc nav `/digital-twin`. Ly do: `DataManagementHub.tsx:24` va `DataSettings.tsx:796` doc
quyen route qua `getRequiredPermissionForHref("/digital-twin")`; xoa no lam **ca hai roi ve
`"analytics_oee"` IM LANG** va hien quick-link bo cuc cho nguoi **khong duoc sua** — **tai tao dung loi
"mot loi vao roi tu choi"** ma chinh dot nay di va, o **hai tep ngoai pham vi**. No **ghi no vao ma**.

**Con mo:** `?thu=trai,phai` **khong con tang dien tich canvas** (dung thiet ke moi) ⇒ muc tieu "94 % khi
thu" cua §13b **khong con co che de dat** trong vo hien tai. Va mot loi **co san** khong do lo Y gay:
`navigation.unit.test.ts` *"getAcceptedPermissionsForHref"* — do y het o `HEAD` (kiem bang
`git show HEAD:` roi chay lai), la **banh cong cu** tu lo truoc mong `/twin` chi nhan `analytics_oee`.

## 13f. DOT 22 — Z4 (cay phan cap co roll-up) + NGHIEM THU THI GIAC BAT 5 LOI (2026-09-08)

### 13f.1 Z4 / G-7 — **TAI DUNG** `CayPhanCap`, khong viet cay thu hai

**Do duoc truoc khi quyet (G70 — dem bang `<CayPhanCap`, KHONG bang ten chuoi):**

| Phep dem | So | Cho |
|---|---|---|
| `<CayPhanCap` (render) | **1** | `XuongThietKe.tsx:946` |
| `import { CayPhanCap }` | **1** | `XuongThietKe.tsx:102` |
| chuoi "CayPhanCap" trong `TwinVanHanh.tsx` | 1 | `:915` — **CHU THICH**, khong phai ma chay |

G44 — ba dang dem rieng. Brief noi dung o ca ba diem.

**Ket luan: tai dung HOP LE, va day la ba dieu do duoc lam no hop le** (khong phai "tien tay"):

1. `CayPhanCap` la **component DIEU KHIEN THUAN** — khong giu state chon, khong prop nao mang nghia ghi.
2. `CayThietKe` la **CAU TRUC DU LIEU** (`{goc, khuCho, theoKhoa}`), khong phai trang thai trinh sua.
   Dung duoc tu `{xuong, chuyen, tram, may, datCho}` — dung **NAM mang ma `twinCanh.canhThietKe` DA tra
   ve cho `/twin` tu truoc** (`canhQ`). ⇒ **0 truy van moi**.
3. Ban phim WAI-ARIA (roving tabindex + Enter/Space/mui-ten/Home/End) da tra tien roi. Viet ban thu hai
   la chep ngan ay (G12) hoac giao cho nguoi dung ban phim mot cay khai `role="tree"` ma khong di duoc.

**Dieu kien tai dung — man Van hanh CHI DOC:** `onChon` **khong sua gi**, no dich khoa node thanh thay
doi URL (`?pv=` / `?xem=`). `onDoiPhamVi` **khong truyen**. Dung khuon lo Z dung voi `LopVung`.

**Cho goi (file:line):**
- `client/src/pages/TwinVanHanh.tsx` — `import { CayPhanCap }` va `<CayPhanCap ... />` trong panel trai
- `client/src/components/twin3d/van-hanh/cayVanHanh.ts` — mo hinh thuan (4 ham), **21 test**
- `client/src/components/twin3d/thiet-ke/CayPhanCap.tsx` — them prop **tuy chon** `soMayTrucTiep`

**Roll-up: HAI dai luong, HAI ban do RA RIENG (chong lop loi §13d Z3).**
`ropCanhBao` la phep cong THUAN tren cay va khong biet no cong cai gi ⇒ dung lai nguyen ven cho SO MAY.
Cai phai tach la **dau vao**: `demMayTrucTiep` (moi node `machine:` = 1) vs `demTrucTiep` (canh bao).
Hai badge, hai mau: so may **xam trung tinh** (ISA-101 §10.1 — mau chi danh cho bat thuong), canh bao
**do**, dung sat mep phai. **Gop hai so lam mot la tai pham §13d Z3.**

**Do duoc tren `dist`, vai `e2e_tai_loE` (khong-admin), du lieu `--240`:**
`FUYU-G-WS1 · 60 · canhbao5` · nam line con moi cai `12 · canhbao1` · WS2/WS3/WS4 moi cai `60 · canhbao5`.
So hoc kiem duoc bang mat: 5x12 = 60 · 4x60 = 240 = o dem "Machines 240" · 4x5 = 20 = "Open andon 20".
Bam node line ⇒ URL doi thanh `?pv=line:196&chon=line:196`. **Dieu huong that, khong phai trang tri.**

**Dot bien (2 lan, khoi phuc byte-exact bang md5):**
- DB-1 — bo cong con trong `ropCanhBao` (`for (const c of n.con) di(c)`): **13 test do / 3 tep**.
- DB-2 — `demMayTrucTiep` dem MOI node thay vi chi `machine:`: **5 test do**.

**Bat doi xung CO THAT, va no duoc khai chu khong giau:** thang cay la
`workshop/line/station/machine`, thang `PhamVi` la `tapDoan/nhaMay/tang/line/may`. Chi `line:` khop
mot-mot. `machine:`/`station:` mo bang `?xem=`. **`workshop:` KHONG di dau ca** — cap tren `line` trong
thang `/twin` la `tang`, ma xuong **khong phai** tang (`XuongThietKe.tsx:252`). Dua ve `?pv=tang:<idXuong>`
la SAI ID va canh nap tang cua mot toa khac **ma khong loi nao no**. ⇒ node xuong la node **gop**, va
spec ghi ro no khong hua gi them.

### 13f.2 NGHIEM THU THI GIAC BAT **NAM** LOI — hai cai la CUA CHINH Z4

Ban dau cua Z4 dat cay canh `DanhSachMay`, ca hai `flex-1`, voi ly le "chia nhau phan co duoc".
**Anh bac bo ca ba ve cua ly le ay:**

| # | Trieu chung do duoc | Nguon |
|---|---|---|
| L-1 | `danh-sach-may` **h = 0** (`hien:false`) — bien mat, khong co lai | **CO SAN** |
| L-2 | **HAI o "Filter by name or code…" chong len nhau** (y~777 va y~808), de ca nhan "HIERARCHY" | Z4 |
| L-3 | Cay tran khoi khung: hop y=784 h=393 ⇒ day **1177 > 1080** | Z4 |
| L-4 | `operator1` thay **san xam trong, 0 may**, moi o "—", *nhung* "Alarms (27)" | **CO SAN** |
| L-5 | `?xem=machine:2` **khong mo panel may**, va khong cau nao noi vi sao | **CO SAN** |

**ABLATION tach L-1 khoi Z4** (chong G5 — hoi "cai gi GAY RA", khong hoi "cai gi co mat"):

```
nguyen ban            : daiCanhBao=715  khoiCay= 30  danhSachMay=  0
go khoi cay khoi DOM  : daiCanhBao=744  khoiCay=null danhSachMay=  0   <- cay VO CAN
go them dai canh bao  : daiCanhBao=null khoiCay=null danhSachMay=744   <- NGUYEN NHAN
```

⇒ **L-1 co TRUOC Dot 22.** Goc re: `DaiCanhBao` khai `h-full` nhung o day no la flex item **khong co
`flex-1` cung khong co tran**, nen no lay chieu cao theo NOI DUNG (27 canh bao) va anh em `flex-1`
chi con phan du — bang 0. **Ban va:** boc bang `min-h-0 flex-1 basis-0`, va them `basis-0` cho
`DanhSachMay`. `basis-0` la BAT BUOC — khong co no, flexbox cap chieu cao noi dung TRUOC roi moi chia
phan du, va 715 px kia van duoc cap truoc.
**Sau va (1920x1080):** `dai-canh-bao` 357 · `danh-sach-may` 357 — chia deu, ca hai dung duoc.

**Ban va L-2/L-3 — goc re khong phai CSS ma la IA.** Cay va danh sach may tra loi **CUNG MOT CAU HOI**
("chon may/line nao"), chi khac hinh dang (phan cap vs phang). §13b 14.1.3 da dat ten cho dung benh nay:
*"bay tab la bay cau tra loi cho cung mot cau hoi"*. ⇒ Chung **LOAI TRU NHAU** bang mot cong tac that
(`? :`, khong phai an bang CSS): dung MOT khoi `flex-1` ton tai tai mot thoi diem. **Mac dinh la DANH
SACH** — thu dang dung duoc tu truoc Dot 22; mot tinh nang moi khong duoc tu day tinh nang cu ra khoi man.
Ghim hai chieu trong e2e: cay hien **VA** `danh-sach-may` **bien mat khoi DOM** + panel trai chi con
**MOT** o loc. Chi ghim ve dau thi ban hong cu (h=0 nhung con trong DOM) van xanh.

### 13f.3 L-4 — `operator1` VAO DUOC `/twin` NHUNG THAY MAN RONG (chua ai va)

**Do duoc:** `user_factory_assignments` chi co **4 hang thuoc DUNG 2 nguoi dung** — `engineer1`(51) va
`e2e_tai_loE`(21075). **`operator1`(48) va `supervisor1`(49) khong co hang nao.**
⇒ `twinCanh.canhThietKe` tra `scopeEmptyReason="no_factory_assignment"` va **moi mang deu rong**
(do thang qua tRPC: xuong 0 · chuyen 0 · tram 0 · may 0). Doi chung: `e2e_tai_loE` ⇒ xuong 1 · chuyen 3 ·
tram 36 · may 42.

**Cai nguoi dung thay:** nav cho vao, khung dung len, panel/dai/nut deu co — nhung **san xam trong,
0 may, moi o "—", breadcrumb "Corporate > Factory > Floor" khong ten**, *dong thoi* panel trai khai
**"Alarms (27)" voi 20 hang that**. Tuc la man hinh noi: *"nha may khong co may nao, nhung 27 canh bao
dang keu"* — hai loi khai mau thuan trong cung mot khung nhin.

⚠ `EmptyState scopeEmptyReason="no_factory_assignment"` **da ton tai trong ma** (§THUONG-2(b)) nhung
**khong hien o day**. Do la mon con mo, khong sua trong dot nay (ngoai pham vi Z4, va sua mu mot duong
khong do duoc la cach nhanh nhat de them mot loi cam).

**Bai hoc do luong:** suite nay ban dau chup bo cuc bang `operator1` — va moi con so ve vung/cay/roll-up
tren do la **so 0 nguy trang**. Doi sang `e2e_tai_loE` (van KHONG-admin) moi do duoc. **Vai khong-admin
la dieu kien CAN, khong phai dieu kien DU: vai ay con phai CO DU LIEU.**

### 13f.4 L-5 va cac quan sat thi giac khac (khai, khong va)

- **L-5** — `?xem=machine:2` (may SIM-FAC) tren canh FUYU-G: panel phai van noi *"Select a machine…"*.
  Lua chon khong phan giai duoc va **khong cau nao noi vi sao**. Cung ho voi A3 (`?pv=line:1`):
  header "Waiting… / Last updated: —", Metrics toan gach, Simulation *"This line has no stations"* —
  trong khi canh van ve FUYU-G. **Pham vi URL va pham vi canh lech nhau ma khong bao.**
- **Nhan 3D chong nhau:** chip "FUYU-G-T1-L3-M7" / "-L5-M7" / "-L4-M12" **de len nhau** thanh khoi khong
  doc duoc; luat uu tien nhan §14.5.2 (tran 30) hoac tat hoac bi vuot.
- **Hai panel noi (`Metrics`, `Simulation`) de len canh** ⇒ mot phan cai gia ma Dot 21 vua mua bang
  `absolute inset-0` bi tra lai — chi khac la bang lop phu thay vi cot flex.
- **"Updated 1568573s ago"** (~18 ngay) o header vung sua — mot con so tho khong duoc quy doi.

### 13f.5 G75 — TI SO HAI SO, va **MAU SO da bi do**

| Viewport | canvas | % viewport |
|---|---|---|
| 1280x720 | 968x489 | **51,4 %** |
| 1280x720 (`?thu=trai,phai`) | 968x489 | **51,4 %** — KHONG DOI |
| 1920x1080 | 1608x849 | **65,8 %** |

⚠⚠ **`?thu=trai,phai` cho DUNG cung con so** — do lai o Dot 22 va khop y het `do-bo-cuc.json` cua lo Y.
Day KHONG phai thiet bi do hong: sau Dot 21 canvas **da** `absolute inset-0` chiem tron khung, nen thu
panel **khong the** tang dien tich canvas nua (panel noi DE, khong chia dat). ⇒ Muc tieu **"72,3 % khi
thu sidebar" cua G75 va "94 % khi thu panel" cua §13b deu KHONG CON CO CHE DE DAT** trong vo hien tai.

**⇒ HAI MUC TIEU AY DUOC BO, va day la ly do:** chung do mot dai luong ma bo cuc moi khong con san sinh.
Muon tang % canvas nua thi phai dong vao **thanh nav trai cua ung dung (288 px)** va **header/dai tren
(207 px)** — ca hai **ngoai pham vi man `/twin`**. Tran that cua khung twin (968x563 tren 1280x720) da
duoc chinh G75 khai la **59,1 %**, va 51,4 % hien tai la 87 % cua tran ay. Phan con lai nam o hai dai
ngang trong khung (header 48 + dai hop nhat 26 = 74 px), khong nam o panel.

**Va day moi la dieu quan trong hon con so:** anh cho thay cai chiem cho tren canh **khong phai panel**
ma la **nhan 3D chong nhau + hai panel noi**. Do "dien tich canvas" khong do duoc dieu do — mot canvas
968x489 **gan nhu trong** van cho 51,4 %. G5: **ta da do CAI HOP, khong do CAI NHIN THAY.**

### 13f.6 Loi CO SAN da dong

`navigation.unit.test.ts` *"getAcceptedPermissionsForHref"* — do y het o `HEAD` (`17a3f4c6`), truoc moi
thay doi cua Dot 22. Banh cong cu tu lo truoc mong `/twin` chi nhan `analytics_oee`, trong khi **Dot 5
CHAN-1 da co y noi** sang `["analytics_oee","machine_status"]` (`navigation.tsx:475`) vi do duoc rang
3/4 vai van hanh khong co `analytics_oee`. ⇒ **Sua KY VONG cua test, KHONG sua ma san pham.**
Hop le vi doi chung chieu nguoc ngay tren no (`/twin` + `machine_control` ⇒ `false`) **van xanh**: tap
quyen duoc noi dung MOT phan tu, khong bi mo toang.

## 13g. DOT 22 - Z4 XONG + NGHIEM THU THI GIAC BAT 5 LOI (2026-09-08)

Commit `ac3b2697`. Cong: **66 tep / 1.855 test** (nen 65/1.834) - `check` 0 - `build` 0 -
DB `2/43/82` - 5 anh lo C **md5 nguyen ven**.

### 13g.1 Z4 - lam xong bang **TAI DUNG**, ba ly do do duoc

Chu du an kiem: `TwinVanHanh.tsx` **12 tham chieu** `CayPhanCap` (truoc: 0).
Tai dung hop le **khong phai "tien tay"**:
1. `CayPhanCap` la component **dieu khien thuan** - **0 prop mang nghia ghi**.
2. `CayThietKe` la **cau truc du lieu**, dung tu dung 5 mang ma `canhThietKe` **da tra san** cho
   `/twin` ⇒ **0 truy van moi**.
3. Ban phim WAI-ARIA **da tra tien roi** (Dot 8 lo B); ban thu hai la **G12**.

**Roll-up dung lai `ropCanhBao`** nhung **hai ban do dau vao ROI** - chong tai pham §13d Z3.
Do tren `dist`, vai khong-admin: WS1 `60·⚠5`, moi line `12·⚠1`; **5×12=60**, **4×60=240** khop o dem,
**4×5=20** khop *"Open andon"*. Bam node line ⇒ `?pv=line:196&chon=line:196`.

**Bat doi xung khai thang:** node `workshop:` **khong di dau** - xuong **khong phai** tang;
`?pv=tang:<idXuong>` se nap tang toa khac **ma khong loi nao no**.

### 13g.2 ★★★ Nghiem thu thi giac bat **5 loi** - **3 CO SAN**, 2 do chinh Z4 gay (da va)

| | Loi | Nguon |
|---|---|---|
| **L-1** | `danh-sach-may` **cao = 0** - **bien mat han** | **CO SAN** |
| L-2 | **HAI o loc chong nhau**, de nhan "HIERARCHY" | Z4 (da va) |
| L-3 | Cay **tran khoi khung** (day 1177 > 1080) | Z4 (da va) |
| **L-4** | `operator1` thay **san trong 0 may** ma panel khai **"Alarms (27)"** | **CO SAN** |
| **L-5** | `?xem=machine:2` **khong mo panel**, **khong cau nao noi vi sao** | **CO SAN** |

**Ablation tach L-1 khoi Z4** (dung khuon G5): go cay ⇒ **van 0** (cay vo can); go them `DaiCanhBao`
⇒ **744** (nguyen nhan). Goc re: `DaiCanhBao` la flex item **khong `flex-1`, khong tran** ⇒ lay chieu
cao noi dung. Va bang **`flex-1 basis-0`** (chu du an kiem: `TwinVanHanh.tsx:3065`); sau va **357/357**.

**L-2/L-3 goc re la IA khong phai CSS** - cay va danh sach **tra loi cung mot cau hoi** ⇒ cho
**loai tru nhau**, mac dinh giu **DANH SACH**.

> #### ★★★ G76 - **VAI KHONG-ADMIN LA DIEU KIEN CAN, KHONG PHAI DU**
> Brief cua chu du an bao chup vai **`operator1`**. Lam the thi **moi con so la SO 0 NGUY TRANG**:
> chu du an do lai xac nhan - `operator1` va `supervisor1` co **0 hang** trong
> `user_factory_assignments` ⇒ `no_factory_assignment`, **moi mang rong**.
> Dot 22 doi sang `e2e_tai_loE` (**van khong-admin**, nhung **co 1 nha may**).
> ⇒ Chong "do bang admin chung minh so 0" (bai hoc Khoi D) **de ra mot bay moi**: chon vai khong-admin
> **khong co du lieu** thi cung chung minh so 0, chi khac chieu. **Phai kiem vai do CO DU LIEU** truoc
> khi dung no lam thiet bi do.

> #### ★★★ G77 - **DO CAI HOP, KHONG DO CAI NHIN THAY**
> `?thu=trai,phai` cho **dung 51,4 %** - **y het mac dinh**. Sau Dot 21 canvas da `absolute inset-0`,
> panel **noi de** nen thu panel **khong the tang dien tich**. ⇒ **G75 "thu sidebar → 72,3 %"** va
> **§13b "94 % khi thu"** **deu KHONG CON CO CHE** - da ghi **BO** vao §13f.5.
>
> **Va quan trong hon con so:** thu chiem cho tren canh **khong phai panel** ma la **nhan 3D chong nhau
> thanh khoi khong doc duoc** + **hai panel noi** (`Metrics`/`Simulation`) de len canh - **tra lai mot
> phan cai gia Dot 21 vua mua**. Mot canvas 968×489 **gan nhu trong** van cho **51,4 %**.
> ⇒ Chi so dien tich la **do CAI HOP**; no **khong biet** ben trong hop co gi. Phai co phep do thu hai
> ve **cai NHIN THAY** (mat do nhan doc duoc, dien tich bi lop phu che).

### 13g.3 Cho bo cuc moi **CHUA dung duoc** - khai, khong va (ngoai pham vi)

L-4 (`EmptyState` cho ca nay **da co trong ma** nhung **khong hien**) · L-5 · **nhan 3D chong nhau** ·
hai panel noi de len canh · `"Updated 1568573s ago"` (**~18 ngay** - G30 chua phu het cho).

**Viec 3 xong ca hai:** `navigation.unit.test.ts` - xac nhan do y het o `HEAD`, sua **ky vong** khong sua
ma san pham (Dot 5 CHAN-1 **co y** noi), **27/27 xanh**. Muc tieu 94 % - ghi **bo** kem ly do (§13f.5).

⚠ **Mot viec ngoai luat can biet:** de chay du luot do, Dot 22 khoi dong lai server voi
`AUTH_RATE_LIMIT_PER_15MIN=500` va xoa khoa `rl:auth:*` trong Redis (gioi han 30/15ph chan suite).
**Chi la bien moi truong luc chay do, khong sua ma, khong migration**; server da tat.

### 13g.4 G78 - **"DA TAT HET" LA LOI KHAI VE MOT LENH, KHONG PHAI VE HE THONG** (2026-09-08)

Dot 22 bao ba lan (qua ba thong bao lap) rang moi server do **da tat**, va lan cuoi ghi
*"nothing is left running"*. Chu du an **do lai bang `netstat`**:

```
cong 3000  PID 28480  LISTENING   <- phien khac, DUNG la con song
cong 3112  PID 35904  LISTENING   <- khoi dong 07/09 10:26
cong 3140  PID  7616  LISTENING   <- khoi dong 08/09 18:17
cong 3143  PID 39484  LISTENING   <- khoi dong 08/09 20:37
```
Ca ba deu **tra HTTP 200** - **van dang phuc vu**.

**Vi sao loi khai ay sai ma nguoi khai khong biet:** `pkill -f "dist/index.js"` **chi giet tien trinh
khop mau ay tai thoi diem chay**. Nhung server duoc khoi dong lai nhieu lan trong mot dot (Dot 22 tu
ke it nhat **bon** task khoi dong lai), va tien trinh sinh **sau** luot `pkill` thi **song sot**.
Thong bao *"task X stopped"* chi noi **mot** task da dung - **khong** noi he thong da sach.

⇒ **Luat:** *"da tat het"* phai do bang **`netstat`/`Get-Process` liet ke cong dang nghe**, khong bang
**"toi da chay lenh giet"**. Cung ho **G16** (*ham ton tai ≠ ai goi*) va **G74** (*"da gop" la loi khai
ve TEP*): **lenh da chay ≠ trang thai da dat**.

**Chu du an KHONG tu giet ba tien trinh nay:** PID 39484 khoi dong **20:37 hom nay**, rat co the la cua
**Dot 23 dang chay**; hai cai kia co the thuoc **phien khac**. Giet nham la **pha viec dang chay** -
dung lop tai nan §11e (mot phien doi nhanh worktree lam mat viec chua commit).
⇒ **Ghi lai de don sau khi Dot 23 xong**, khong don giua chung.

**Do lai LAN THU NAM** (sau nam thong bao lap deu khai *"nothing left running"*): van con **5 server**
dang nghe (3112 · 3140 · 3142 · 3145 · 3146), va **danh sach DOI GIUA CAC LAN DO** - 3143/3144 mat,
3146 moi xuat hien. ⇒ Loi khai ay **khong chi sai luc viet**, no **khong the dung**: tien trinh **van
dang sinh ra** sau moi luot `pkill`.

⇒ **Bo sung cho G78:** khi mot he thong **con dang sinh tien trinh**, cau hoi *"da tat het chua"*
**khong co cau tra loi on dinh**. Phep do dung phai kem **moc thoi gian** (*"luc 20:51 con 5 cong nghe"*),
va **cho ai do tuyen bo XONG** roi moi don - dung don giua chung.

## 13h. DOT 23 - DON THI GIAC 4 MON (2026-09-08)

Commit `c0d70db2`. Cong: **66 tep / 1.873 test** (nen 66/1.855) - `check` 0 - `build` 0 -
DB `2/43/82` - 5 anh lo C **md5 nguyen ven**. Anh: `.qa-dot23/SAU-toan-man.png` (ca 4 mon
trong MOT khung), `.qa-dot23/L4-operator1-truoc.png`.

### 13h.1 ★★★ G77 tu do chinh no: **PHEP DO THU HAI BAC BO CHAN DOAN M1**

Brief Dot 23 giao: *"nhan 3D chong nhau thanh khoi khong doc duoc"*. Xay phep do thu hai
theo dung yeu cau G77 (`e2e/twin-dot23-do-nhan.spec.ts`) - quet **CA BA lop `<Html>`**
(`LopNhan` z20 - `LopCanhBao` z30 - `LopVung` z15) bang `getBoundingClientRect` THAT, dem
cap chong **KHONG phan biet lop**. Ket qua o tu the camera ghim, 1280x720, `?thu=trai,phai`:

| | truoc | sau |
|---|---|---|
| tong nhan tren man | 8 | 8 |
| **cap chong LIEN LOP** | **0** | **0** |
| nhan bi de | 0 | 0 |
| **nhan DOC DUOC** | **8/8** | **8/8** |
| nhan bi giau (khai ra) | **0 - khong ai noi** | **37 - chip noi ra** |

⇒ **Nhan KHONG he chong nhau.** `locNhan.ts` da co hau dieu kien "0 cap chong" tu Dot truoc
va no dang chay dung. Loi THAT nam o chieu nguoc lai: `__demNhan` khai
`tong 45 - chongLap 37 - ve 8 - vuotTran 0`, tuc **45 ung vien chi con 8 nhan, 82 % may mat
ten**, va man **KHONG NOI GI**. Tran 30 chua he cham (`vuotTran = 0`), nen noi tran la va
nham cho.

> #### ★★★ G79 - **BO LOC CHAY DUNG HOP DONG VAN LA MOT LOI GIAO DIEN**
> `locNhan` dung tuyet doi theo hop dong cua no, va `capConChong = 0` la lời khai THAT.
> Nhung hop dong ay tra loi cau hoi *"nhan nao duoc ve"*, con nguoi dung hoi
> *"may nay ten gi"*. Mot bo loc im lang bo 37 cau tra loi thi **so 8 tro thanh mot lời
> khai sai** - nguoi doc 8 ten se tin do la tat ca.
> ⇒ Va bang **KHAI BAO SU THIEU** (`soBiGiau` + chip "37 more names hidden"), cung luat NT-3
> ma ca man da theo: *khong co du lieu ≠ binh thuong*, o day la *khong co nhan ≠ khong co may*.
> ⇒ Bat bien ke toan ghim bang luoi: `ve + soBiGiau === tongUngVien` - khong ung vien nao roi.

### 13h.2 M2 - hai panel noi che **18,6 % canvas**, do duoc

```
  canvas 968x489        = 473.352 px²
  Metrics  208x220      =  45.760 px²
  Simulation 257x165    =  42.437 px²
  ────────────────────────────────────
  che VINH VIEN         =  88.197 px²  = 18,6 % canvas
```
Tra lai gan **mot phan nam** cai gia Dot 21 vua mua bang bo cuc noi-de.

**Quyet dinh: thu `Simulation`, GIU `Metrics`** - khong doi xung, va co ly do do duoc:
`BangKpiNoi` tra loi cau hoi nguoi xem LUON co (§11 #16 dung no de che do `?thu=trai,phai`
khong con la *"3D dep ma 0 con so"*); `NganMoPhong` la cong cu what-if goi theo nhu cau, o
trang thai mac dinh no hien dung *"— Select a line to simulate throughput"* + o chon workflow
RONG, tuc **tieu 42.437 px² de noi rang no chua co gi de noi**. SAU: **6.720 px²** (chi con
thanh dau, van bam mo duoc).

★ **G40 giu nguyen, khong de khoa thu bay.** Ngu nghia `thu=` KHONG doi (*"liet ke panel DANG
THU"*, vang = mo) nen `docThu`/`ghiThu` khong sua mot dong. Panel mac-dinh-thu mang **ten
chieu NGUOC** `moPhongMo`. Ten cu `moPhong` **GIU LAI** trong `PANEL_THU_DUOC` de link cu
khong bi `docThu` NUOT im lang - dung bay G67 ma chinh docblock do canh bao.

### 13h.3 ★★★ M3 (L-4) - **CHAN DOAN CUA BRIEF DUNG TRIEU CHUNG, SAI MOT BUOC VE GOC RE**

Brief: *"`:717` chi doc tu `canhQ` ⇒ neu `canhQ` khong tra co… `EmptyState` khong hien"* -
ngu y `canhThietKe` CO CHAY roi thieu co. Do lai tren `dist`, vai `operator1`:

```
  factory.list        →  [] (n=0)          ⇒ factoryId = null
  twinCanh.canhThietKe →  0 LAN GOI         (chan boi `enabled: factoryId !== null`)
  canhQ.data          →  undefined         ⇒ phamViRong = false
  man that            →  0 may · 0 nhan · moi KPI `—`   ma vo van khai "Alarms (7)"
```

⇒ **Thu tuc KHONG HE CHAY.** Server da tra dung nhan tu truoc (`twinCanhRouter.ts:1057`
`...nhan.labels`); cho hong nam o **CHO DOC**. Va bang *"them co vao `canhThietKe`"* se
**KHONG doi duoc mot chu nao**, vi dap ung ay khong bao gio ton tai.

> #### ★★★ G80 - **"TRUY VAN KHONG TRA CO" VA "TRUY VAN KHONG CHAY" LA HAI BENH KHAC NHAU**
> Ca hai cho ra cung mot trieu chung (`data === undefined` ⇒ co = false), nen doc tu trieu
> chung se chan doan nham nua so lan. Phan biet duoc bang **dem SO LAN GOI tren day**
> (`page.on("response")` loc theo ten thu tuc) - hits = 0 phan biet dut khoat hai benh.
> ⇒ Nguon su that cho "pham vi rong" phai la truy van **LUON CHAY**, khong phu thuoc bien ma
> chinh no dang dinh nghia. O day: `factory.list`.
> ⚠ `!isLoading && !isError` la **BAT BUOC**: luot tai dau `factories` cung rong, thieu ve nay
> thi MOI nguoi dung thay `EmptyState` nhap nhay mot nhip - bien ban va thanh loi moi cho
> toan bo nguoi dung.

**DOI CHUNG (G5/G32):** `e2e_tai_loE` SAU khi va **van 8 nhan + KPI nguyen ven** - ban va
khong qua tay. `operator1` SAU: EmptyState hien, va cau *"Alarms (7)"* mau thuan **bien mat
khoi than man**.

### 13h.4 M4 - `"Updated 1572061s ago"` = 18,2 ngay: **HAI loi trong MOT dong**

1. **DINH DANG** - giay song. `nhanDoTuoi` nay tra them `rut: {so, donVi}` bang cach **uy thac
   cho `nhanTuoi`** (G12/G72 - module thuan tra DU LIEU, khong phat van xuoi). Duoi 60 s VAN
   in giay: do la nhip lam moi cua man, giay la don vi dung o do.
2. **HAN HIEU LUC (G30)** - `do` (do khi > 60 s) **khong phan biet 61 giay voi 18 ngay**, nen
   mot gia tri 18 ngay hien ra *trong y nhu binh thuong, chi do hon chut*. Them `quaCu`
   (> `NGUONG_CU_MS`). `NganXuLy.tsx:300` **da co san** badge `duLieuQuaCu` cho dung ca nay;
   thanh cong cu thi khong - **cung mot su that, hai cau tra loi tren cung mot man**.

SAU: **`"Updated 18 days ago"`** + badge *"Data too old — status not trustworthy"*. Ca hai cho
nay gio noi **CUNG CAU** qua **CUNG mot ham** `nhanTuoiDocDuoc`. `data-giay` **giu nguyen so
tho** (1.573.478) - khong lam mu thiet bi do cua chinh minh.

### 13h.5 Dot bien (tiem - bat - khoi phuc byte-exact, doi chieu md5)

| Dot bien | Ket qua |
|---|---|
| M1 `soBiGiau` quen cong nguon chinh-sach | 1 luoi do |
| M2 bo `moPhongMo` khoi `PANEL_THU_DUOC` (G67) | 1 luoi do |
| M3 bo ve `factory.list` rong | **tai hien DUNG loi L-4 tren `dist`** |
| M4 in giay song cho moi moc | 2 luoi do |

### 13h.6 Con mo - khai, khong va (ngoai pham vi)

- **Badge "7" o VO ung dung** van hien khi vai khong co nha may. No thuoc **shell toan cuc**
  (ngoai `/twin`), khong phai man nay - man da thoi tu mau thuan trong pham vi cua no.
- `chiNhanBatThuong` **da co duong day du** (`locNhan` → `LopNhan` → `CanhVanHanh`) nhung
  **chua noi vao UI** - chua co nut bat/tat. Duong da co va da co luoi; con thieu dung mot
  cho bam.
- L-5 (`?xem=machine:2` khong mo panel, khong cau nao noi vi sao) - **khong dung toi** o dot nay.

---

## 13i. DOT 24 - BA MON CUOI, va **LO DOC XUYEN TENANT O VO UNG DUNG** (2026-09-08)

Commit `65dcd2b4`. Cong: **66 tep / 1.890 test** (nen 1.873, **+17**) - `check` 0 - `build` 0 -
DB `2/43/82` - 5 anh lo C md5 nguyen ven.

### 13i.1 Viec 1 - lo **RONG HON** chan doan cua chu du an

Chu du an neu **`active`**. Do lai: **ca BON thu tuc DOC** thieu `ctx` - `active` · `list` · `get` ·
`metrics`. **Lo R (Dot 15) chi va DUONG GHI** (`acknowledge`/`resolve`) roi **dung o do**.

> #### ★★★ G81 - **SO NO CO SAN BIET TRUOC, MA KHONG AI DOC**
> Dot 24 tim thay **xac nhan doc lap ma no khong tu suy ra**: so no
> `phamViDocBaseline.ts:121` **da liet ke dung bon thu tuc do** duoi muc `andonRouter.ts (4)`.
> ⇒ Lo hong **da duoc ghi lai tu truoc**, chi la **khong ai doc so no truoc khi tuyen bo da va xong**.
> Cung ho **G58** (*va moi `create` la de nguyen cua cho `delete`*): mot ban va theo **ten thu tuc brief
> chi** thay vi theo **ca router** se luon de sot - va lan nay **cai so no da noi truoc so sot la 4**.

**Chung minh hai chieu qua HTTP that, `dist`, vai khong-admin:**

| Vai | Duoc gan | Truoc | Sau |
|---|---|---|---|
| `operator1` | **0** | **7 hang** | **0** |
| `e2e_tai_loE` | 1 (SIM-FAC) | 7 hang | **7** |

Ca hai **HTTP 200, `appCode: null`** - bi chan boi **cong pham vi**, khong phai RBAC (**G43**).
**Ablation**: go dung menh de roi dung lai ⇒ `operator1` **doc lai duoc ca 7**.
Cong dat **trong `WHERE`**, khong phai sau `limit(200)`. Census `A: 355 → 351`, go **4 dong so no da tra**.

### 13i.2 Viec 3 - goc re **SAU HON** chan doan, va mot nhanh **chet**

Chu du an chi vao `docXemTuQuery`. Do duoc (`.qa-dot24/probe.mjs`): **`NganXuLy.tsx:262` tra ve som
khi `machineId === null`**, va `<NganNhung>` nam **SAU** do ⇒ `?xem=` **khong mo gi ca, ke ca voi id
hoan toan hop le**.
⇒ **Mot ban va "them cau bao ly do" se KHONG BAO GIO CHAY.** Nay `<NganNhung>` render o **ca hai nhanh**.

> #### ★★★ G82 - **"BA CAU KHAC NHAU" CO THE LA MOT YEU CAU KHONG DO DUOC**
> Chu du an doi phan biet **ba** ly do: *khong ton tai* · *ngoai pham vi* · *thieu quyen*.
> Dot 24 do: `/twin` **khong co truy van toan-bo-may**, nen *"khong ton tai"* va *"cua nha may khac"*
> **cung mot hinh dang o client** - **co chu y**: mot ma loi rieng cho *"khong ton tai"* **tu no xac nhan
> vat the CO TON TAI**, tuc ro thong tin. Tach chung doi mot vong server **mo lai dung lo vua dong**.
> ⇒ Giao **hai ly do trung thuc** thay vi **ba, trong do mot la nhanh chet**. **Yeu cau cua chu du an
> sai**, va cai sai nam o cho no **nghe hop ly hon** cai dung.

### 13i.3 Viec 2 + ba dinh chinh khac

`chiNhanBatThuong` nay **co nut**: `duongDanTwin.ts:170` (them ten vao **danh sach dong** - **G67**),
doc URL `TwinVanHanh.tsx:2200`, nut `aria-pressed` `:2975`, prop `:3362`. Dung lai khoa `thu=` (**G40**);
test ghim **dung mot khoa query** bi cham.

- **Ky vong V5 cua chinh Dot 24 sai**: `operator1` **khong bao gio toi duoc ngan** - `EmptyState` toan
  man o `:2608` **da tra loi dung**. No **viet lai test de do hanh vi that**.
- **Phep dem `<NganNhung` dau tien tra 3** vi **docblock cua chinh no** chua chuoi do - **thiet bi do
  sai, khong phai ma sai** (ho **G44**).
- **Census `C`/`D` va 3 dong so no le do san tren HEAD sach** - Dot 24 **khong hap thu vao so cua minh**,
  de chu so huu ky. Dung.

### 13i.4 Don server do - do bang **liet ke cong** (G78)

Dot 24 khai giet cong 3005. Chu du an do lai luc **22:40**: con **3006** (PID 37552, khoi dong **22:37**
- **sau** luot don 22:07 cua chu du an, tuc cua chinh Dot 24). Da giet theo PID.
**Xac minh cuoi:** `Get-NetTCPConnection` dai **3002-3200** ⇒ **0 server do**; cong **3000 (PID 28480)
cua phien khac** ⇒ **con nguyen**.

## 14m. DOT 25 - BRIEF CUA CHU DU AN SAI **NAM CHO**, tat ca vi **doc ma CU trong dau** (2026-09-09)

Commit `2966f420`. Cay nguon **sach** (khong sua ma), 5 anh lo C md5 nguyen ven, §15 **2.003 dong**.

> #### ★★★ G83 - **MO TA HIEN TRANG TU TRI NHO LA LOI KHAI VE MOT PHIEN BAN DA CHET**
> Chu du an viet brief Dot 25 dua tren hieu biet **truoc Dot 21**. Nam cho sai, **tat ca cung mot goc**:
>
> | | Brief noi | Do lai (chu du an kiem) |
> |---|---|---|
> | **S-1** | *"4 page Twin, `/twin-studio` la man rieng"* | **Chi con 2 tuyen song** - `App.tsx:174,356` ghi ro `/twin-studio` **DA LA redirect** vao `/twin?che-do=botri` tu Dot 21; `/digital-twin` cung da redirect |
> | **S-2** | *"chon may ⇒ ngan nhung, KHONG phai dialog"* | **`NganNhung.tsx` DA LA dialog that** - Radix Sheet, **`aria-modal`**, khoa cuon nen, focus trap, `Esc`. Cai thieu la **canh 3D trong dialog**, khong phai dialog |
> | **S-3** | *"bay camera o `phamViCanh.ts:65`"* | `:65` la **`trongPhamVi()`** - mot **vi tu loc**. Camera Line o `TwinVanHanh.tsx:1965` |
> | **S-4** | *"3 man qua phuc tap"* | Phuc tap **khong nam o so man**: **97,7 %** trong **MOT ham**, **50 `useMemo`** (chu du an dem lai: dung 50), 18 `useState`, 14 `useQuery` |
> | **S-5** | *"mo 3 canh 3D cung luc thi CONG chi phi"* | ★★★ **Khong phai bai toan cong - BI CAM.** **RB-4 "MOT `<Canvas>` DUY NHAT"** co **4 cho** trong ma (`TwinVanHanh.tsx:8`, `:221`, `:234`, …) va la **luat an toan**, khong phai toi uu |
>
> ⇒ **Luat:** truoc khi viet brief mo ta hien trang, **grep lai tung cau khang dinh**. Mot he thay doi
> nhanh thi tri nho cua **chinh nguoi dieu phoi** la nguon sai lech lon nhat - va no sai **mot cach tu
> tin**, vi tung dung. Cung ho **G55** (*so do co han su dung*) nhung o tang **kien truc**, khong phai so.

**QD-17 - "dialog" la trai nghiem, khong phai co che.** Dot 25 chon **lop noi trong CUNG mot `<Canvas>`**:
trong nhu dialog (nen pha mo 72 % - `TI_LE_PHA_NGOAI_PHAM_VI` **da co**, vien, tieu de, `✕`, `Esc`)
nhung **khong dung Canvas thu hai** (RB-4). Truc URL `?pv=` da co ⇒ **Back trinh duyet thanh "phim back"
mien phi**. Ngan sach ba cap: **~12 draw calls / tran 150** (bien 92 %) - cai dat **khong phai GPU ma la
NHAN** (tran 30 la tran *doc duoc*).
★ Dot 25 tim lai loi **chinh chu so huu** viet o Dot 10 (chep tai `NganNhung.tsx:8`):
*"dialog **hoac** modal **hien thi tren panel do luon**"* - **chinh ong da coi hai cach la tuong duong**.

**★ MAU THUAN VOI QD-16 - dua ra HOI, khong tu chon.** Yeu cau Dot 25 doc nhu `/twin-studio` la trang
rieng; nhung **QD-16** (chu so huu chot 2026-09-08) da gop mot trang + quyen theo vung, va **Dot 21 da
thuc thi + nghiem thu 5/5 e2e voi 2 tai khoan that**. Tach lai = **dao nguoc mot dot da nghiem thu**, va
`operator1` **mat loi vao**. De xuat: **giu QD-16**, chi doi nhan nut `⚙ Sua bo cuc` → `⚙ Twin Studio`
(**mot chuoi i18n**).

**Con dung MOT mon gop that:** `/command-center` (1.596 dong) → `?pv=tapdoan`, nhung ⛔ **khong redirect**
truoc khi cap tap doan nghiem thu bang anh (R-4).

**Bo hoat anh bang tai (D-7)** du **ca hai anh mau** ban no lam diem nhan: Hollifield neu **dich danh**
*"moving conveyors"* la dau hieu do hoa kem, va duoi `frameloop="demand"` no **giu GPU chay 8 tieng**.
Nguon ngoai duoc lam **manh hon**: cang di sau, ti le 3D cang **giam** (cap May chi **20 %** viewport).

**G82 khai thang:** *"dep"* **KHONG DO DUOC** - thay bang **nghiem thu mat cua chu so huu** (tien le:
nghiem thu thi giac Dot 22/23 bat **10 loi** ma 1.834 test mu). Va phep nghiem thu **khong** chung minh
duoc nguoi van hanh that **tim may hong nhanh hon** - can nguoi dung that + dong ho.

---

## 14o. ĐỢT 26 — ★★★ QĐ-18 **TÁCH** `/twin-studio` THÀNH TRANG RIÊNG, ĐẢO NGƯỢC QĐ-16 (2026-09-09)

### 14o.1 Quyết định của chủ sở hữu (nguyên văn), và vì sao nó THẮNG lý lẽ của QĐ-16

> *"Không gộp. Twin-studio là nơi **thiết kế và layout cũng như xây dựng** 3D Twin cho nhà
> máy/ProductionLine, **chỉ những người có quyền mới làm được**. Còn Twin là nơi **trình diễn, xem,
> quản lý realtime** nhà máy, **không chỉnh sửa được**, và các bộ phận liên quan đến nhà máy **đều có
> thể xem nếu được phép**. Đây là **2 trang liên kết với nhau nhưng mục đích hoàn toàn khác nhau**."*

★★★ **Đây KHÔNG phải chủ sở hữu đổi ý — đây là một PHÂN LOẠI khác, và nó đúng hơn.**

| | QĐ-16 (2026-09-08) | QĐ-18 (2026-09-09) |
|---|---|---|
| Coi hai màn là | hai **VÙNG** của một việc | hai **MỤC ĐÍCH** khác nhau |
| ⇒ Kết luận đúng theo phân loại ấy | **gộp** (một trang, quyền theo vùng) | **tách** (hai trang liên kết) |
| Câu quyết định | *"cùng là 3D Twin của nhà máy"* | *"người chỉ XEM **không bao giờ cần** công cụ SỬA"* |

Hai vùng của một việc thì gộp là đúng. Hai mục đích thì tách là đúng. §13b (14.2.2) **đã đề nghị
KHÔNG gộp ngay từ đầu** vì hai cổng quyền khác nhau — QĐ-18 quay về đúng đề nghị ấy, nay có thêm
**số đo** để đứng vững.

### 14o.2 ★★★ SỐ ĐO LẬT NGƯỢC NỖI LO LỚN NHẤT CỦA QĐ-16

QĐ-16 từ chối tách vì sợ **cổng CHẶT**: `operator1` mất lối vào — đúng tai nạn Đợt 3 CHẶN-1 mà Đợt
15 đã phải vá ngược. Đo lại trên bảng `permissions` (2026-09-09, 8 tài khoản `isActive`, **không kế
thừa lời khai lượt trước** — G83):

| Tài khoản | `analytics_oee` ∨ `machine_status` → xem `/twin` | `settings_factory` ∨ `machine_control` → sửa studio |
|---|---|---|
| `operator1` | ✅ (`machine_status`) | **❌** |
| `engineer1` | ✅ | ✅ |
| `maint1` | ✅ | ✅ |
| `supervisor1` | ✅ | ✅ |
| `e2e_tai_loE` | ✅ | ✅ |

⇒ ★★★ **`operator1` KHÔNG MẤT GÌ KHI TÁCH.** Họ vốn không có cả hai quyền sửa, nên vùng sửa với họ
**đã luôn không tồn tại** — chính QĐ-16 cũng tự hạ họ về `xem` bằng `kepVungTheoQuyen`. Tách chỉ
**đổi chỗ** một thứ họ chưa từng thấy.

⚠ **Khác hẳn CHẶN-1 thật** (Đợt 3): ở đó **2/4 vai** mất một màn **họ đang dùng được**. Ở đây là
**0/5 vai** mất bất cứ thứ gì. Nỗi lo của QĐ-16 là hợp lý khi chưa đo; sau khi đo thì nó **không áp
dụng cho ca này**.

### 14o.3 Việc đã làm — 6 nhóm tệp, và **chỗ gọi** của từng thứ bị gỡ

| # | Tệp | Việc |
|---|---|---|
| 1 | `client/src/App.tsx:399` | `/twin-studio`: `Redirect` → **route thật** `<RouteGuard navHref="/twin-studio"><TwinStudio /></RouteGuard>`; thêm `React.lazy` cho `TwinStudio` |
| 2 | `client/src/App.tsx:511,672` | `/factory-floor-editor` + `/layout` → `/twin-studio` (thay `/twin?che-do=botri`) |
| 3 | `client/src/components/twin3d/bo-cuc/dinhTuyenTwinCu.ts` | 4 đích đổi sang `/twin-studio`; **`/twin-studio` RỜI bảng** (nó là tuyến thật, không còn là "đường cũ") ⇒ bảng **14 → 13 khoá** |
| 4 | `client/src/pages/TwinVanHanh.tsx` | Gỡ `lazy(TwinStudio)` · gỡ `dangSua`/`doiVung`/`vungDaKep` · gỡ banner `banner-vung-sua-ha-cap` · nút toggle → **`<Link href="/twin-studio">`** · `moXuongDung` → `setLocation("/twin-studio")` |
| 5 | `client/src/components/twin3d/bo-cuc/vungQuyen.ts` | Giữ `QUYEN_XEM`/`QUYEN_SUA`/2 vị từ; **XOÁ** `kepVungTheoQuyen`, `docVungTuUrl`, `TenVung`, `VungDaKep` |
| 6 | 4 suite e2e + 2 suite unit | Đảo lưới QĐ-16 → QĐ-18; đổi khoá đo; **suite mới** `twin-dot26-tach-trang.spec.ts` |

★★★ **G70 — vì sao XOÁ 4 export thay vì để lại:** đếm bằng cách liệt kê **mọi export**, tách
`import` / `<Tên` / `Tên(`. Sau khi tách, `kepVungTheoQuyen` và `docVungTuUrl` có **0 chỗ gọi ngoài
test** — chúng chỉ tồn tại để kẹp `?che-do=`, một khoá nay không còn ở đâu. Giữ lại là để một API
chết cùng **8 lưới xanh canh gác số 0** — đúng lớp *"CÓ MÃ + CÓ TEST + KHÔNG GIAO HÀNG"* mà Đợt
0-7 đã đo được 4 lỗ. Việc chúng từng làm **đổi tầng**, không biến mất: từ *kẹp trong trang* sang
*cổng ở cửa* (`RouteGuard navHref`).

### 14o.4 ★★★ G40 — `?che-do=botri`: CHỌN **REDIRECT SANG `/twin-studio`**, không bỏ qua

**Quyết định: 4 đường vào có Ý ĐỊNH SỬA đều tới `/twin-studio`.**

Bỏ qua khoá ấy (để `/layout` rơi về `/twin` trơn) sẽ là **lỗi câm đúng nghĩa G67**: người bấm
bookmark `/layout` muốn **sửa bố cục**, và họ sẽ ra màn **chỉ đọc** — không lỗi, không giải thích,
chỉ là công cụ họ cần **không có ở đó**. Nên `?che-do=` bị **xoá hẳn** (0 chỗ đọc, 0 chỗ ghi) và
4 đường ấy trỏ thẳng vào trang sửa.

Lưới cưỡng chế: `dinhTuyenTwinCu.unit.test.ts` — *"G67 — `?che-do=` KHÔNG còn tồn tại ở `App.tsx`
NÀO"* + *"G40 — 4 đường vào có Ý ĐỊNH SỬA đều tới `/twin-studio`"*. **Đột biến C** (để sót đúng
**một** `?che-do=botri` ở `/layout`) làm **2 lưới đỏ** ⇒ phép đo biết kêu.

### 14o.5 ★★★ RB-4 **CHẶT HƠN** sau khi tách — đo trên trình duyệt thật, không suy từ mã

Brief lo tách làm hỏng RB-4 (một `<Canvas>` WebGL sống tại một thời điểm). **Ngược lại:**

| | Đợt 21 (QĐ-16) | Đợt 26 (QĐ-18) |
|---|---|---|
| Cái giữ RB-4 | một `? :` trong cây React | **kiến trúc định tuyến** (wouter unmount trang cũ) |
| Hỏng được bằng cách | đổi `? :` thành `hidden` để giữ camera — Đợt 21 **đã phải ghi hẳn cảnh báo** về nguy cơ này | phải phá chính bộ định tuyến |

**Đo được** (`D26-J`, Playwright, engineer1, 1280×720): `/twin` = **1 canvas** → bấm liên kết →
`/twin-studio` = **1 canvas**, `window.__soCanvas` = **1**. Không lúc nào có 2.

★ Cái giá của Đợt 21 cũng biến mất: khi ấy rời vùng sửa rồi quay lại thì **camera xưởng dựng về mặc
định** (cây React bị unmount) và phải giải thích. Nay đó là hai trang — mất camera khi điều hướng là
hành vi **đúng và mong đợi**.

### 14o.6 Nghiệm thu **hai chiều** bằng tài khoản thật — 10/10, và **cả hai hình dạng tai nạn**

`e2e/twin-dot26-tach-trang.spec.ts`, server `dist` `NODE_ENV=production` cổng **3007**, ảnh vào
`.qa-dot26/` (**G65**: `test-results/` có 5 ảnh lô C đã commit — không đụng, md5 nguyên vẹn).

| Vai | `/twin` | `/twin-studio` | liên kết sửa trên `/twin` |
|---|---|---|---|
| `operator1` | **vào được, chỉ đọc** ✅ D26-A | **"Access denied"** ✅ D26-C | **không thấy** ✅ D26-B |
| `engineer1` | vào được ✅ D26-D | **vào + sửa được** ✅ D26-F | **thấy** ✅ D26-E |
| `e2e_tai_loE` | vào được, **có dữ liệu** | — | **thấy** ✅ D26-I |

★★★ **G76 — vai không-admin là điều kiện CẦN, KHÔNG ĐỦ.** `operator1` có **0 hàng**
`user_factory_assignments` (toàn DB chỉ **3 hàng**: engineer1×2, e2e_tai_loE×1) ⇒ cảnh **RỖNG**
(*"Your account is not assigned to any factory"*). Nên *"operator1 không thấy liên kết"* có **hai
nguyên nhân khả dĩ cho cùng một quan sát**: thiếu QUYỀN hay thiếu DỮ LIỆU? **D26-I** tách đôi
chúng bằng `e2e_tai_loE` (**có** nhà máy **và** có `machine_control`): nó **THẤY** liên kết ⇒ thứ
quyết định là **QUYỀN**, không phải dữ liệu.

★ **Đột biến — 5 con, chết cả 5** (khôi phục byte-exact, md5 đối chiếu):

| # | Tiêm | Lưới kêu |
|---|---|---|
| A | trả `/twin-studio` về `Redirect` (QĐ-16) | 2 đỏ |
| B | bỏ `RouteGuard` (**cổng RỘNG**) | 1 đỏ |
| C | sót **một** `?che-do=botri` ở `/layout` (**G67**) | 2 đỏ |
| D | `{true ? (` — liên kết hiện cho **mọi** vai (**cổng RỘNG**) | 1 đỏ |
| E | nới nav `/twin-studio` thêm `machine_status` ⇒ `operator1` **thấy** ô | 2 đỏ |

### 14o.7 ★★★ HAI LỖI CỦA CHÍNH TÔI TRONG ĐỢT NÀY — ghi vì cả hai đều CÂM

**L-1 — `asChild` NUỐT `data-testid`, và không lưới unit nào bắt.**
Tôi đặt `data-testid="nut-sua-bo-cuc"` trên `<Button asChild>` bọc `<Link>`. Radix `asChild` **hợp
nhất props vào phần tử CON**, nên khoá ấy cho **0 phần tử** trong DOM trong khi trang **trông đúng
hoàn toàn** và `npm run check` + 1890 lưới unit đều **xanh**. Chỉ `QD16-C` (e2e, đối chứng dương của
Đợt 21) bắt được — và tôi suýt đổ cho *"rate limiter"* vì 4 ca khác quanh nó đúng là do 429.
⇒ **Bài học: một ca đỏ giữa nhiều ca đỏ-vì-hạ-tầng vẫn phải được đo riêng.** Tôi đã phải chạy
`git show HEAD:` để phân biệt *đỏ có sẵn* với *đỏ do tôi*.
⇒ Sửa: khoá **đổi tên** `nut-sua-bo-cuc` → `lien-ket-twin-studio` (nói đúng bản chất: LIÊN KẾT, không
phải nút bật/tắt), 3 suite cũ sửa theo.

**L-2 — `rindex` nuốt 90 dòng trạng thái KHÔNG liên quan.**
Khi gỡ khối `?che-do=`, tôi tìm ngược đầu docblock bằng `rindex` và trúng một docblock **xa hơn**,
xoá nhầm `thuKpi`/`chiNhanBatThuong`/`quyen`/`che2D`/`doiPhamVi`/`thuTrai`… (90 dòng). `tsc` bắt
ngay (20 lỗi `TS2304`), nên nó **không câm** — nhưng nó cho thấy **sửa bằng biên đoạn văn bản phải
neo bằng chuỗi DUY NHẤT ở CẢ HAI đầu**, không bằng một mẫu lặp lại.

### 14o.8 Nợ **có sẵn**, đo được, KHÔNG phải của Đợt 26

★★★ **`QD16-A` đỏ ở khẳng định *"operator1 phải THẤY canvas"*** — và nó **đỏ y hệt trên mã HEAD chưa
sửa** (đo bằng `git show HEAD:e2e/twin-lo-y-qd16-quyen.spec.ts` chạy với server Đợt 26). Nguyên nhân:
`operator1` có **0 nhà máy** ⇒ EMPTY SCOPE. Khẳng định ấy **trộn hai câu**: *vào được* (về QUYỀN) và
*có dữ liệu* (về GÁN NHÀ MÁY) — chỉ câu đầu thuộc suite ấy. Đã hạ xuống `annotations` kèm lý do thay
vì **nới lỏng trong im lặng**; muốn xanh thật thì phải **gán nhà máy cho `operator1`** (việc về DỮ
LIỆU, không về mã).

⚠ **Rate limiter là THIẾT BỊ ĐO, không phải lỗi sản phẩm.** `createAuthLimiter` chặn **30 login/15
phút/IP** và **lưu ở Redis** (`rl:auth:*`) nên **sống qua restart server**. Nó làm **4 ca đỏ** trông
y như bản vá hỏng. ⛔ Lối thoát SAI là nới `AUTH_RATE_LIMIT_PER_15MIN` — đó là *sửa hệ thống cho vừa
phép đo*, và làm yếu đúng thứ ta muốn tin. Lối thoát ĐÚNG: xoá khoá Redis giữa các lượt + đăng nhập
**một lần mỗi vai** (`storageState`).

### 14o.9 Cập nhật hai mục cũ

- **§15.4.1 / Q-2 (15.8)** — câu hỏi *"giữ QĐ-16 hay tách lại?"* nay **ĐÃ CÓ TRẢ LỜI: tách** (Đ-B).
  Đề xuất cũ của tôi là Đ-A (*"giữ QĐ-16, chỉ đổi nhãn nút"*) — **chủ sở hữu chọn Đ-B**, và lý do ông
  đưa (*hai mục đích khác nhau*) mạnh hơn lý do tôi đưa. Rủi ro tôi ghi ở Đ-B (*"`operator1` mất lối
  vào"*) **đã được đo là KHÔNG xảy ra** (14o.2).
- **§13c.1 (QĐ-16)** vẫn giữ nguyên văn làm **lịch sử** — nó giải thích vì sao mã từng có hình dạng
  ấy. Đợt 21 **không mất giá trị**: bố cục nổi-đè, canvas 51,4 %, **14 redirect ≤1 chặng** đều còn
  nguyên (đo lại: **14/14 đường vào cũ vẫn tới đích**, `Y-URL` xanh). **Chỉ phần gộp trang bị đảo.**

## 14o. DOT 26 - **QD-18 TACH `/twin-studio`**, dao nguoc QD-16 (2026-09-09)

Commit `fc08118c`. Cong: **66 tep / 1.890 test** = nen - `check` 0 - `build` 0 - DB `2/43/82` -
5 anh lo C md5 nguyen ven.

### 14o.1 QD-18 thay QD-16 - **ly do MANH HON, khong phai doi y**

Chu so huu: *"Twin-studio la noi thiet ke va layout cung nhu xay dung 3D Twin, chi nguoi co quyen.
Twin la noi trinh dien, xem, quan ly realtime, khong chinh sua duoc. Hai trang lien ket nhung
MUC DICH HOAN TOAN KHAC NHAU."*

QD-16 gop vi so `operator1` **mat loi vao**. Chu du an **do lai be mat** (7 tai khoan hoat dong):

| Vai | xem `/twin` | sua studio |
|---|---|---|
| `operator1` | co | **KHONG** |
| `engineer1` · `maint1` · `supervisor1` · `e2e_tai_loE` | co | co |

=> **`operator1` KHONG mat gi khi tach** - ho **von khong co quyen sua**. Noi lo cua QD-16 **bi so do bac**.
Hai cong **tach bach**, chu du an kiem tan noi: `/twin` -> `analytics_oee|machine_status`
(`navigation.tsx:475`) · `/twin-studio` -> `settings_factory|machine_control` (`:500`).
Route that `App.tsx:399`. Lien ket gac sau `duocSuaNhaXuong` (`TwinVanHanh.tsx:2301`) - **an-khong-disable**.

> #### G84 - **TACH LAI CO THE LAM HANG RAO CHAT HON, KHONG PHAI LONG HON**
> Lo ngai: tach thi thanh **hai `<Canvas>`**, vi pham **RB-4**. Do that (D26-J): `/twin` **1 canvas**,
> `/twin-studio` **1 canvas**, `__soCanvas=1` **ca hai**.
> Hang rao chuyen tu **mot bieu thuc `? :`** (Dot 21 da phai ghi canh bao ve nguy co doi thanh `hidden`)
> sang **kien truc DINH TUYEN** - hai trang khong bao gio song cung luc **vi router**, khong vi mot
> dieu kien ai do co the sua nham.
> => **Dao nguoc mot quyet dinh khong nhat thiet la mat cai da mua.** Bo cuc noi-de + canvas 51,4 %
> + 14 redirect cua Dot 21 **con nguyen**.

### 14o.2 Bon cho brief cua chu du an SAI (G83 lan hai)

| Brief noi | Do duoc |
|---|---|
| *"khoi phuc nav neu Dot 21 da go"* | **KHONG can** - `navigation.tsx:496` **con nguyen** voi gate dung. Dot 21 go **route**, giu **nav** => muc nav **dang tro vao mot redirect** |
| *"bo `?che-do=botri`"* (ngu y 1 cho) | **6 cho**: `App.tsx` x3, `dinhTuyenTwinCu.ts` x4, + 4 e2e + 2 unit |
| *"`TwinVanHanh.tsx:245`"* (1 cho nap luoi) | Dung, **nhung con 5 cho goi khac** (`dangSua` x3, `doiVung` x2, `moXuongDung`) - **G70** |
| *"Dot 21 nghiem thu 5/5 e2e"* | **`QD16-A` DA DO SAN** tren ma HEAD chua sua |

### 14o.3 Hai loi cua chinh Dot 26 - mot cai **cam hoan toan**

> #### G85 - `asChild` **NUOT `data-testid`**: 1.890 luoi + `tsc` deu XANH, trang **trong dung hoan toan**,
> ma **0 phan tu** trong DOM
> Chi **QD16-C** (e2e cua Dot 21) bat duoc. Va Dot 26 **suyt do cho rate limiter** vi **4 ca quanh no
> dung la 429** - phai chay **`git show HEAD:`** moi tach duoc *do co san* / *do do minh*.
> => Khi mot ca do **giua cum ca do khac**, **dung gop nguyen nhan**. Va **`asChild` (Radix) THAY THE
> phan tu con** - moi thuoc tinh dat tren cha **bien mat khong bao loi**.
> (Loi thu hai, `rindex` nuot 90 dong state, **`tsc` bat ngay 20 loi** => **khong cam** - doi lap sang.)

> #### G86 - **RATE LIMITER LA THIET BI DO**, va no **song qua restart**
> 30 login/15 phut/IP, **luu Redis**. Bon ca do trong nhu ban va hong. Dot 26 **khong noi**
> `AUTH_RATE_LIMIT_PER_15MIN` - *"do la sua he thong cho vua phep do"*. **Dung.**

**Nghiem thu hai chieu 10/10** (tai khoan that, `dist` production): `operator1` vao `/twin` chi doc,
`/twin-studio` **"Access denied"**, **khong thay** lien ket. `engineer1` vao ca hai, **sua duoc**.
`e2e_tai_loE` **co du lieu VA thay lien ket** => **G76 go nham lan: quyet dinh la QUYEN, khong phai DU LIEU.**
**Dot bien 5 con, chet ca 5** - gom **cong rong** va **sot MOT `?che-do=`** (G67).

**G40:** chon **redirect** `?che-do=botri` -> `/twin-studio`, **khong bo qua** - bo qua la **loi cam**:
nguoi bam bookmark muon **sua** se ra man **chi doc**, khong loi nao no. **14/14 duong vao cu van toi dich.**

**No CO SAN, khong phai cua Dot 26:** `QD16-A` do o *"operator1 phai THAY canvas"* - **do y het tren HEAD
chua sua**. `operator1` co **0 hang** `user_factory_assignments` (toan DB **3 hang**) => empty scope.
Khang dinh **tron** *vao duoc* (QUYEN) voi *co du lieu* (GAN NHA MAY). Ha xuong `annotations` kem ly do,
**khong noi long im lang**.

## 14p. QD-19 + QD-20 - CHU SO HUU TRA LOI Q-1 VA Q-3 (2026-09-09)

### 14p.1 QD-19 - **BA MAN RIENG BIET**, moi man MOT canvas

§15.8 hoi **Q-1**: lop noi (L2, khuyen nghi) hay **modal that** (L3)? Chu so huu chon **modal that**,
roi **lam ro them ngay sau do**:

> *"y toi 1 man canvas la danh cho factory thoi, con Line/Machine la 2 man hinh khac"*

⇒ **Khong phai mot trang doi noi dung canh. Ba MAN RIENG:**

| Man | Canvas | Noi dung |
|---|---|---|
| **Factory** | rieng | canh nha may |
| **Line** | rieng | canh mot chuyen |
| **Machine** | rieng | canh mot may |

★ **Chu du an tung hieu sai** *"modal that"* = mot trang thu don roi dung lai canh. Chu so huu **lam ro
truoc khi dot xay bat dau** ⇒ **khong ton gi**. (Neu khong hoi Q-1 ma cu the xay, dot 27 da di sai duong.)

> #### ★★★ G87 - **BA MAN RIENG LAM RB-4 SACH HON MOT TRANG DOI NOI DUNG**
> Lo ngai ban dau: ba cap ⇒ nhieu canvas ⇒ vi pham **RB-4** (`KhungCanh.tsx:221-232` dem canvas **dang
> mount cung luc**, canh bao khi `> 1`; ly do ghi trong ma: *"can WebGL context… bieu hien la canvas DEN,
> khong phai mot loi doc duoc"*).
> **Ba man rieng thi ba canvas KHONG BAO GIO song cung luc - VI ROUTER**, khong vi mot bieu thuc dieu
> kien ai do co the sua nham. `__soCanvas` van **= 1** o moi man.
> ⇒ **Dung bai hoc G84** (Dot 26, `/twin-studio`): **tach lai lam hang rao CHAT hon, khong long hon**.
> Hai lan lien tiep, cung mot ket luan: **kien truc dinh tuyen manh hon co che dieu kien**.

**Cai that su danh doi** (chu du an neu day du **truoc khi** chu so huu quyet): mat **ngu canh khong
gian** (o man Line khong con thay Line nam dau trong nha may) va **toc do chuyen man** (thu don canh cu,
dung canh moi). ⇒ Neu mot dot sau thay *"giat khi mo Line"*, **day la nguyen nhan da biet truoc**,
khong phai loi moi.

### 14p.2 QD-20 - **TACH TRUOC, XAY SAU** (dung khuyen nghi Q-3)

Tach **T-1/T-2/T-3** (~1.100 dong, **thuan doc**, rui ro thap) **truoc**; giu **mat ghi** (T-4/T-5/T-6)
cho dot sau. Ly do §15.8: xay trom len `TwinVanHanh.tsx` **3.754 dong / MOT ham / 50 `useMemo`** se lam
no phinh **~5.000 dong**, va manh **kho tach nhat** (mat ghi) cang kho tach an toan ve sau.

★ **QD-19 lam viec tach CANG DANG GIA**: ba manh thuan doc se **dung chung cho ca ba man**, thay vi bi
chon trong mot ham. Rang buoc them cho dot tach: **khong de manh tach ra doc thang `useSearch()`/
`useRoute()`** cua trang cha - **nhan qua prop**. Day chinh la **G37**: *man tu doc route hong CAM khi
dat ngoai route cua no* (`RobotCockpit`/`StationAnalysis` tung dinh, `id = NaN`, **khong exception**).

**Tieu chi nghiem thu cua dot tach la HANH VI KHONG DOI**, khong phai "test van xanh" (**G5/G32**):
canvas 51,4 %, `__soCanvas=1`, draw calls, so nhan, badge nguon so, va **ca hai chieu quyen** cua QD-18.

**Q-2 da tra loi** (QD-18, §14o). **Q-4 (`/command-center`) chua tra loi** - giu nguyen, **khong redirect**
cho toi khi `?pv=tapdoan` nghiem thu bang anh voi du lieu that (R-4).

### 14p.3 VAT LIEU SAN CO CHO HAI MAN MOI - do truoc khi giao dot xay

Chu du an do **truoc** khi viet brief dot xay, de khong lap **G83** (*mo ta hien trang tu tri nho*).

**Man LINE - da co, dem bang cho goi:**

| Manh | Cho goi | Vai tro |
|---|---|---|
| `DongChayLine` | **10** | mui ten dong chay giua tram |
| `DaiLine` | **7** | dai xep hang tram + WIP |
| `phamViLine` | **6** | loc vat the theo line |
| `khungNhinLine` | **3** | camera bay theo line |

**Man MACHINE - da co:**

| Manh | Cho goi | Vai tro |
|---|---|---|
| `NganNhung` | **40** | dialog that (Radix `Sheet`, `aria-modal`, `Esc`) |
| `NganXuLy` | **28** | mat GHI cap may (2 mutation W1/W2 + 3 qua ngan nhung) |
| `MachineCockpitBody` | **14** | than cockpit **da tach san** de nhung (G37) |
| `vienSucKhoe` | **11** | vien suc khoe neo vat the (42 khai di qua) |

⇒ **Ca hai man moi dung tu manh DA NGHIEM THU**, khong phai viet tu dau. Rui ro chinh **khong phai**
"viet moi" ma la **noi day** va **giu hanh vi**.

**Hien trang dinh tuyen:** chi **2 route** (`App.tsx:360` `/twin`, `:399` `/twin-studio`).
`CapPhamVi` (`duongDanTwin.ts:38`) **da khai du 5 cap** `tapDoan|nhaMay|tang|line|may` va **ca 5 deu co
xu ly that** (§11e.3) ⇒ **truc pham vi khong phai xay moi**, chi can **duong vao rieng** cho hai cap
`line` va `may`.

⚠ **Cau con mo cho dot xay:** URL cua hai man moi. Hai hinh dang:
- `/twin/line/:id` + `/twin/may/:id` — **duong dan phan cap**, doc duoc, bookmark tu nhien
- `/twin-line?id=` + `/twin-may?id=` — **phang**, giong `/twin-studio`

Chu du an **khong tu chon** - de dot xay do va de xuat, vi no cham **14 redirect** da nghiem thu (G40:
mot khoa/duong dan sai se **bi nuot im lang**, khong loi nao no).

### 14p.4 QD-21 - URL HAI MAN MOI: **DUONG DAN PHAN CAP** (chu so huu chon, 2026-09-09)

§14p.3 de mo hai hinh dang. Chu so huu chon **phan cap**:

```
  /twin              -> man NHA MAY   (da co, App.tsx:360)
  /twin/line/:id     -> man LINE      (moi)
  /twin/may/:id      -> man MACHINE   (moi)
  /twin-studio       -> man THIET KE  (da co, App.tsx:399)
```

**Chu du an do ba dieu truoc khi ghi - khong doan:**

1. **Khong va voi `/twin`.** Wouter khop **chinh xac**, khong phai tien to. Tien le trong chinh
   `App.tsx`: `/station-analysis/:id` (`:409`), `/inspection/:id` (`:401`), `/line-view/:lineId?`
   (`:444`) - **ca ba deu khong co route cha rieng**, va khong cai nao nuot cai nao.
2. **Dang `:id?` (tuy chon) da co tien le** (`/line-view/:lineId?`, `/sop/:sopId?`) ⇒ neu dot xay muon
   `/twin/line` khong id thi **co khuon san**.
3. ⚠ **`/line-view/:lineId` DA TON TAI** - `LineView.tsx` **418 dong**, **0 tham chieu 3D**
   (`Canvas`/`three`/`KhungCanh`). Do la **man 2D**, **khong trung viec** voi man Line 3D moi.
   Nhung **ten gan nhau** ⇒ dot xay phai **noi ro trong ma** hai thu khac nhau, khong thi nguoi sau se
   tuong mot trong hai la ban trung lap va xoa nham (**dung lop loi §11b**: xoa man vi tuong khong ai
   dung).

**Rang buoc mang sang dot xay:**
- **G40** - **14 redirect da nghiem thu** (`dinhTuyenTwinCu.ts`) tro ve `/twin?pv=...`. Them hai route
  moi **khong duoc lam chet duong nao trong 14 duong do**. Neu doi dich cua redirect nao, **do lai ca
  14**, dung sua mot roi cho la xong.
- **G67** - neu them ten vao **danh sach dong** (`LOP_HOP_LE`, `PANEL_THU_DUOC`, bang redirect), **them
  vao danh sach**; quen thi URL **bi nuot im lang** - ghi duoc, doc ra rong, **khong loi nao no**.
- **QD-18** - hai man moi thua **cong quyen cua `/twin`** (`analytics_oee|machine_status`), **khong**
  cong cua studio. Chung la man **XEM**.

### 14p.5 G88 - **MOT LO CO THE DUNG MA KHONG COMMIT VA KHONG BAO** (2026-09-09)

Lo duoc giao tach `TwinVanHanh` (QD-20) **bien mat**: khong con trong `ListAgents`, **khong commit**,
**khong bao cao**. Chu du an do lai truoc khi ket luan - **khong doan**:

```
git status --porcelain -- *.ts *.tsx   ->  0 dong  (khong ai dang sua)
wc -l client/src/pages/TwinVanHanh.tsx ->  3.738   (nen 3.754; chenh 16 la cua cac dot TRUOC)
git log --oneline -8 | grep dot27      ->  khong co
git status --porcelain | grep '^??'    ->  chi cac thu muc .qa-* cu
```

⇒ **Khong de lai gi.** Khong phai mat viec (khac **G39**, noi viec **bi cuon vao commit khac**) - lan
nay **chua tung co viec**.

> #### ★★★ G88 - **"AGENT DA CHAY" KHONG PHAI "VIEC DA LAM"**
> Mot lo co the dung giua chung **khong dau vet**: khong commit, khong bao, khong tep untracked.
> Neu chu du an tin **thong bao hoan thanh** thay vi **do cay ma**, dot sau se xay tren mot nen **tuong
> la da tach**.
> => Truoc khi giao dot ke tiep, **do trang thai THAT** (`git log`, `git status`, `wc -l` tren chinh tep
> muc tieu), khong doc lai bao cao. Cung ho **G16** (*ham ton tai != ai goi*) va **G74** (*"da gop" la
> loi khai ve TEP*): **lo da chay != viec da xong**.
>
> **Bien phap mang sang dot giao lai:** brief ghi ro *"**commit som, commit tung phan** - lo truoc dung
> ma mat trang vi de don"*. Mot lo commit tung manh thi khi no dung, **phan da lam van con**.


### 14p.6 DOT 27 - **DO LAI §15.5 TREN MA THAT**: T-3/T-2 TACH DUOC, T-1 **KHONG** (2026-09-09)

> Dot 27 lam VIEC 1 (tach) va do tien de cho VIEC 2. Muc nay ghi **cai do duoc**, de lo sau
> khong ke thua lai loi khai cua §15.5 — chinh §15.5 duoc viet khi CHUA tach thu.

#### ★★★ SAU DIEU §15.5 / BRIEF DOT 27 NOI SAI - do lai 2026-09-09

| # | Loi khai | Do duoc | Nguon |
|---|---|---|---|
| 1 | brief: *"doc §15.7 lay ranh gioi T-1/T-2/T-3"* | §15.7 la **NGUON NGOAI · RUI RO · NGHIEM THU**. Ranh gioi T-1/T-2/T-3 o **§15.5.2** | muc luc tep nay |
| 2 | §15.5: `TwinVanHanh.tsx` **3.754 dong** | **3.738** dong luc bat dau Dot 27 | `wc -l` |
| 3 | §15.5.1: **18 `useState`** | **8** `useState` (49 `useMemo`, khong phai 50) | `grep -c` |
| 4 | brief: **14 redirect** trong `dinhTuyenTwinCu` | **13** muc trong `DICH_TWIN_CU` | dem tay + `dinhTuyenTwinCu.unit.test.ts` 13/13 |
| 5 | brief: 14 redirect *"tro ve `/twin?pv=…`"* | **0/13** muc co `?pv=`. Dich la `/twin`, `/twin-studio`, `/rf-test-cell` | doc bang |
| 6 | brief: co so DB `2 · 43 · 82` (ngu y stations=82) | `stations` = **37**. So 82 la **`twin_dat_cho`** | SQL tren 5434 |

★ Khong cai nao lam hong viec, nhung ca 6 deu la **mo ta tu tri nho** (G83). Muc nay thay chung
bang so do duoc.

#### ★★★ T-1 **KHONG TACH DUOC NHU §15.5.2 VIET** - va day la ket qua, khong phai that bai

§15.5.2 giao T-1 = *"gom **14 `useQuery`** thanh 1 hook, tra 1 object"*, xep rui ro **THAP**,
ly do: *"thuan doc, khong JSX, khong nhanh quyen"*.

Do lai tren ma that: **14 truy vay khong phai mot KHOI, ma la mot CHUOI XEP TANG** — dau vao cua
truy van sau la **dau ra da dan xuat** cua truy van truoc, va cac memo dan xuat nam **XEN GIUA**:

```
  factoriesQ (:328) ──> mucNhaMay ──> factoryId (:355)
                                        │
                       toaNhaQ (:425) <─┘──> dsToaNha ──> mucToaNha ──> toaNhaId (:446)
                                                                            │
                                          chiTietQ (:459) <─────────────────┘──> dsTang
                                                                                    │
                                          canhQ (:549) <── tangIdsHoi (:546) <───────┘
```

Va 5 dau vao con lai deu la dan xuat rieng: `nhipTongQuanMs`/`coLuongDay` (tu `useKhoTrangThai`,
hook nay **co chu y** dung TREN moi `useQuery` — xem chu thich `:400`), `lineDangXem` (tu `phamVi`),
`mocTua` (tu `urlState.tg`), `dungWhatIf`+`daBamChay` va `coQuyenXemQuyTrinh`+`workflowRef` (tu
`useState` + `hasPermission` cua trang).

⇒ Mot hook `useDuLieuTwin` "tra 1 object" se phai **nhan 9 tham so**, trong do **3 cai
(`toaNhaId`, `tangIdsHoi`, `lineDangXem`) lai duoc tinh TU KET QUA cua chinh cac truy van trong
hook do**. Do la vong tron: hoac tach doi hook thanh nhieu tang (khong con la "1 hook"), hoac keo
theo ca chuoi memo dan xuat sang (khong con la "thuan doc").

★★★ **Rui ro that cua T-1 la CAO, khong phai THAP.** Ba `refetchInterval` mang bat bien an toan
do duoc (`andonQ`/`anToanQ` co **tran 20 s**, `nhipHoiToiDa` chi duoc **rut NGAN** nhip, khong bao
gio de no troi len 30 s). Chuyen nham mot cai thanh **hoi quy an toan doi lot refactor** — va
`npm run check` + 1.890 test **deu xanh** voi ca hai ban.

⇒ **De nghi cho lo sau:** T-1 **khong lam theo cach §15.5.2 viet**. Neu lam, phai tach theo
**TANG cua chuoi** (nhamay → toa → tang → canh), moi tang mot hook nhan dau ra tang truoc, va
moi tang mot ablation rieng. Do la **4 lo nho**, khong phai 1.

#### CAI DOT 27 DA LAM - T-3 va T-2 (lat Line)

| Manh | Tep | Vi sao tach duoc |
|---|---|---|
| **T-3** | `van-hanh/useTrangThaiTwin.ts` | `duongDanTwin.ts` da la module THUAN da test; day chi la vo React. **0 phu thuoc vao chuoi truy van** |
| **T-2 (lat Line)** | `van-hanh/canhLine.ts` — `dungHinhLine()` | Chi can **du lieu thuan**; khong React, khong route, khong trpc |

★★★ Ca hai deu **nhan qua tham so**, khong tu doc route (**G37**). Luoi cua T-3 la **BAT BIEN TREN
MA NGUON** (tep khong duoc chua `useSearch`/`useRoute`/`useLocation`, khong import tu `wouter`) chu
khong phai mot ca kiem thu — vi neu hook tu doc route, no van **CHAY DUNG tren `/twin`** va chi sai
tren `/twin/line/:id`. Mot ca test viet tren `/twin` se XANH trong khi hang that da hong.

#### VIEC 2 (man Line) - **DA DO TIEN DE, CHUA XAY**

★ Tien de QD-21 **da do duoc** (`bo-cuc/duongDanBaMan.unit.test.ts`, 9 ca): `/twin` **khong nuot**
`/twin/line/2` — do bang chinh bo khop cua wouter 3.7.1 (`regexparam` 3.0.0), khong bang regex tu
viet. §14p.4 doan dung, nay co so.

★★★ **Vi sao chua xay:** man Line can `mayVe` · `bangWip` · `cotWipCanh` · `nhipChuyenMs` ·
`canhBao3D` · `nhanTatCa` — **tat ca van nam trong than ham `TwinVanHanh()` (con ~3.430 dong)**,
tuc la san pham cua **T-1/T-4/T-5**. Dung `DaiLine`/`DongChayLine` voi du lieu **rong** thi ra mot
man **co vo ma khong co so** — dung lop loi §11c.2 (*co ma + co test + KHONG giao hang*) ma tep nay
da dem duoc **4 lan**.

⇒ Thu tu dung la **QD-20 (tach truoc, xay sau)** cho tron: xong T-1 (theo 4 lo nho o tren) va T-5
thi man Line moi co dau vao that. Xay vo truoc se tao mot man phai **thao ra lam lai** ngay sau do.

### 14p.7 DOT 27 - TACH DUOC 2/3 MANH, va **TU CHOI XAY MAN LINE co ly do do duoc**

Bon commit **tung phan** (`9ba64be7` T-3 · `735f4bc0` T-2 · `dd80e586` do tien de · `c73e7d36` spec).
Cong: **69 tep / 1.915 test** (nen 66/1.890) - `check` 0 - `build` 0 - DB `2/43/82` - 5 anh md5 nguyen.
`TwinVanHanh.tsx` **3.738 → 3.674**. Chu du an kiem: `useTrangThaiTwin` **5 cho goi**, `canhLine` **2**.

> #### ★★★ G89 - **TU CHOI XAY LA KET QUA DUNG khi tien de chua co**
> Dot 27 **khong xay man Line**, va **noi ra** thay vi giao mot cai vo. Ly do **do duoc**, chu du an
> kiem lai: man Line can `mayVe`·`bangWip`·`cotWipCanh`·`nhipChuyenMs` - **tat ca van nam trong than
> ham** `TwinVanHanh()` (`mayVe` **26 lan**, `bangWip` 4, `cotWipCanh` 3, `nhipChuyenMs` 3).
> Dung `DaiLine`/`DongChayLine` voi du lieu **rong** ⇒ **man co VO ma khong co SO** - **dung lop loi
> §11c.2** (*co ma + co test + KHONG giao hang*) ma chinh tep spec nay **da dem duoc 4 lan**.
> => Theo dung **QD-20** (tach truoc, xay sau): xay vo bay gio tao ra mot man **phai thao ra lam lai
> ngay sau do**.

> #### ★★★ G90 - **"RUI RO THAP" TRONG SPEC PHAI DO LAI, KHONG KE THUA**
> §15.5.2 giao **T-1** = *"gom 14 `useQuery` thanh 1 hook"*, xep rui ro **THAP**. Dot 27 do lai:
> 14 truy van **khong phai mot KHOI** ma la **CHUOI XEP TANG** -
> `factoriesQ`→`factoryId`→`toaNhaQ`→`toaNhaId`→`chiTietQ`→`tangIdsHoi`→`canhQ`, memo dan xuat **xen
> giua**. Mot hook *"tra 1 object"* phai nhan **9 tham so**, trong do **3 cai lai duoc tinh TU KET QUA
> cua chinh cac truy van trong hook do** - **vong tron**.
> Va rui ro that la **CAO**: ba `refetchInterval` mang **bat bien an toan** (`andonQ`/`anToanQ` tran
> 20 s; nhip thich nghi **chi duoc rut ngan** - **G-bac-brief Dot 8**). Chuyen nham mot cai thanh
> **hoi quy an toan doi lot refactor**, ma `check` + 1.890 test **deu xanh voi ca hai ban**.
> => De xuat: tach theo **tang cua chuoi**, moi tang mot ablation = **4 lo nho**.

**Tien de QD-21 nay CO SO**: `bo-cuc/duongDanBaMan.unit.test.ts` (9 ca) do bang **chinh bo khop wouter
3.7.1** (`regexparam` 3.0.0), **khong** bang regex tu viet ⇒ `/twin` **khong nuot** `/twin/line/2`.
§14p.4 **doan dung**, nay co so.

### 14p.8 SAU cho brief cua chu du an / §15 SAI (G83 lan ba)

| | Khai | Do duoc |
|---|---|---|
| 1 | ranh gioi T-1/T-2/T-3 o **§15.7** | **§15.5.2** (§15.7 la *"Nguon ngoai · Rui ro · Nghiem thu"*) |
| 2 | `TwinVanHanh` **3.754** dong | **3.738** |
| 3 | **18** `useState` · **50** `useMemo` | **8** · **49** |
| 4 | **14** redirect | **13** (chu du an dem lai `bo-cuc/dinhTuyenTwinCu.ts`: **13**) |
| 5 | redirect tro ve `/twin?pv=…` | **0/13** co `?pv=`; dich la `/twin`, `/twin-studio`, `/rf-test-cell` |
| 6 | DB `2 · 43 · 82` | `stations` = **37**; **82** la **`twin_dat_cho`**, khong phai stations |

★ Cho **5** dang chu y nhat: chu du an **khong chi sai SO ma sai HINH DANG DICH**. Neu dot xay tin cau
do roi *"giu nguyen `?pv=`"*, no se **them tham so vao 13 URL chua tung co** - va **G67** noi ro loai
loi ay **bi nuot im lang**.

### 14p.9 DOT 28 - TACH 10/14 TRUY VAN, va **BIEN LOI TU CHOI THANH PHEP DO**

**Nam commit tung tang** (`c62899eb` T4 · `ea06e24d` T3 · `c94a1355` T2 · `38e36d29` lich su ·
`d644180d` tang 1). Cong: **75 tep / 1.967 test** (nen 69/1.915) - `check` 0 - `build` 0 -
DB `2/43/82`, `stations` 37 - 5 anh md5 nguyen. `TwinVanHanh.tsx` **3.674 → 3.573**.

| Tang | Tach? | Tep | Chu du an kiem |
|---|---|---|---|
| 4 mo phong | co | `useMoPhongTwin.ts` | **3 cho goi** |
| 3 phan tich | co | `usePhanTichLine.ts` | **3 cho goi** |
| 2 trang thai song | co | `useTrangThaiSong.ts` | **3 cho goi** |
| lich su | co | `useAnhLichSu.ts` | **3 cho goi** |
| **1 pham vi** | ⛔ **de nguyen** | van o `TwinVanHanh.tsx` | - |

> #### ★★★ G91 - **BIEN LOI TU CHOI THANH MOT PHEP DO CHAY DUOC**
> Dot 27 tu choi tach T-1 (**G90**), va loi tu choi do **nam trong bao cao**. Dot 28 do lai, **cung ket
> luan**, nhung lam khac: viet **`tang1KhongTachDuoc.unit.test.ts` (7 ca)**.
> Ly do no neu: *"loi tu choi trong bao cao se bay hoi va dot sau lai doc 'rui ro thap' trong spec roi
> lam lai lan ba"*.
> **Rang buoc quyet dinh** (do duoc): `useKhoTrangThai` (`:413`) **nam GIUA chuoi** - an `factoryId`
> (`:360`) roi sinh `coLuongDay` (`:426`), thu **tang 2/3 can cho `refetchInterval`**. Goi tang 1 vao
> mot hook ⇒ **hoac** hook phai tra `ketNoi` (khong lien quan "pham vi"), **hoac** phai goi hook hai
> lan. **Vong tron that.**
> => **Mot quyet dinh "khong lam" cung can co cho song trong ma**, khong chi trong van ban. Cung ho
> **G88** (*"agent da chay" != "viec da lam"*) o chieu nguoc: **"da tu choi" phai co ai do canh**.

> #### ★★★ G92 - **THIET BI DO VAN BAN TU BAN VAO CHAN MINH BA LAN**
> Ca ba deu **do oan** - nhung **chieu nguy hiem la chieu nguoc lai (xanh gia)**:
> 1. Phep do doc **ca docblock**: chu `useSearch`/`refetchInterval` nam trong loi giai thich **vi sao
>    chung vang mat** ⇒ **tuoc chu thich truoc khi do**. ⚠ Va bang cach **xoa chu khoi chu thich** se
>    cho tap test **xanh ma mu**.
> 2. `slice(i, i+400)` **tran sang truy van ke ben** ⇒ cat theo **dau ket loi goi**.
> 3. Dau ket `
  );` **khong khop** `useQuery(undefined, {…})` dong bang `
  });`.
>
> **Va mot hoi quy THAT bi bat nho baseline:** mot dot bien T4a **lot vao ban luu du phong**, lam mat
> vinh vien cua `daBamChay`. Baseline ra **"1 failed"** - va **do la thu cuu no**. Neu doc **delta
> ablation** ma **khong kiem baseline**, no da commit ma hong.
> => **Ablation phai doc CA baseline, khong chi doc delta.**

**Bat bien nhip an toan - chu du an kiem tan noi:** `TRAN_NHIP_AN_TOAN_MS = 20_000` nay la **hang co
ten** (`useTrangThaiSong.ts:53`), dung o `:102`. Dot bien `20_000 → 30_000` ⇒ **DO, 3 ca doc lap**
(*"tran dung bang 20 s"* · *"tran phai ngat hon nhip tong quan"* · *"socket khoe: o lai 20 s, khong troi
len 30 s"*). Tong **6/6 dot bien tang 2 bi giet**, gom **T2b** (andon **muon tran 60 s** - *dem tong van
dung*) va **T2d** (`Math.min`→`Math.max`).
★ Test do **gia tri THAT** `nhipHoiToiDa` tra ve, **khong dem chinh ta** - phep do cu **chet khi ma doi
nha** va **mu voi cach viet khac**.

**Hai cho brief cua chu du an SAI:** (1) **`anhLichSu` KHONG thuoc tang 4** - ba truy van kia **tra** du
lieu, cai nay **GHI** vao kho dung chung (`datAnhLichSu`) ⇒ **co tac dung phu**, tach rieng.
(2) duong dan that la `client/src/pages/TwinVanHanh.tsx`, khong phai duoi `pages/twin3d/`.
★ Brief **dung** cho **6 cho `refetchInterval`** (§14p.7 ghi **3** la sai) va dung ca 14 dong truy van.

## 14q. KE HOACH CHAY DEN XONG - BA MAN (2026-09-09, chu so huu giao)

Chu so huu: *"Tiep tuc giao cho den khi xong, ban van lam chu du an va quyet dinh cac phan ky thuat,
theo doi va quan ly cac session, cac Agent... su dung QA Skill de verify lai."*

### 14q.1 Duong den dich - **thu tu do duoc, khong phai uoc luong**

| Dot | Viec | Chan cai gi | Trang thai |
|---|---|---|---|
| 27 | T-3 trang thai URL · T-2 lat Line | - | **XONG** (3.738→3.674) |
| 28 | T-1 bon tang truy van | - | **XONG** (3.674→3.573), 10/14 truy van |
| **29** | **T-4 hop nhat du lieu** (`mayVe` **24 lan**, `bangWip`, `cotWipCanh`, `nhipChuyenMs`, `canhBao3D`, `nhanTatCa`) | ⛔ **CHAN man Line VA man May** | dang chay |
| 30 | **Man Line** `/twin/line/:id` | - | cho 29 |
| 31 | **Man Machine** `/twin/may/:id` | - | cho 30 |
| 32 | **QA verify** toan bo ba man | - | cho 31 |

★ **Vi sao 29 phai truoc 30:** Dot 27 do duoc (**G89**) - dung `DaiLine`/`DongChayLine` voi du lieu
**rong** cho ra **man co VO ma khong co SO**, dung lop loi §11c.2 ma spec nay **da dem 4 lan**.

### 14q.2 Ba man dung tu manh DA NGHIEM THU, khong viet moi

**Man Line** (§14p.3): `DongChayLine` 10 cho · `DaiLine` 7 · `phamViLine` 6 · `khungNhinLine` 3.
**Man Machine**: `NganNhung` 40 (dialog that, `aria-modal`) · `NganXuLy` 28 (mat GHI) ·
`MachineCockpitBody` 14 (**da tach san** de nhung - G37) · `vienSucKhoe` 11.
⇒ Rui ro chinh **khong phai "viet moi"** ma la **noi day** va **giu hanh vi**.

### 14q.3 Luat mang sang MOI dot con lai

- **QD-19/QD-21**: ba man rieng, **moi man MOT canvas**, URL **phan cap**. `__soCanvas` **= 1** o **moi**
  man (**G87** - kien truc dinh tuyen manh hon co che dieu kien).
- **QD-18**: hai man moi thua cong **`analytics_oee|machine_status`** - **man XEM**, khong phai cong studio.
- **G40/G67**: **13 redirect** da nghiem thu, **0/13 co `?pv=`**. Them route **khong duoc lam chet**
  duong nao; them ten vao **danh sach dong** thi phai them **du cho**, quen thi **nuot im lang**.
- ⚠ **`/line-view/:lineId` DA TON TAI** (`LineView.tsx` 418 dong, **0 tham chieu 3D**) - man **2D**,
  **khong trung viec**; **ghi ro trong ma** keo bi xoa nham (§11b).
- **G88**: **commit tung phan**. **G91**: *"khong lam duoc"* phai **thanh test**, khong chi trong bao cao.
- **G92**: ablation doc **CA baseline**, khong chi delta.
- **G83**: **grep lai tung cau khang dinh trong brief** - brief cua chu du an da sai o Dot 25 (**5 cho**),
  27 (**6 cho**), 28 (**2 cho**).

### 14q.4 Cong nghiem thu cuoi (Dot 32 - QA)

Khong phai *"test van xanh"* ma la **hanh vi do duoc**:
`__soCanvas = 1` moi man · **13/13 redirect** con song · **hai chieu quyen** QD-18 (`operator1` chi doc,
`engineer1` sua duoc) · **bat bien nhip an toan** (tran **20 s**, dot bien `20_000→30_000` **phai do**) ·
**5 anh lo C md5 nguyen** · DB `2 · 43 · 82` · va **nghiem thu THI GIAC** - tien le: nghiem thu mat o
Dot 22/23 **bat 10 loi** ma **1.834 test mu**.

### 14q.5 DOT 29 - T-4 XONG, va **VIEC TACH TU SINH RA MOT LOP LOI MOI**

Hai commit (`0af7c459` tach · `e8679ada` noi + luoi khop noi). Cong: **78 tep / 2.010 test**
(nen 75/1.967) - `check` 0 - `build` 0 - DB `2/43/82` (`stations` 37) - 5 anh md5 khop **tung byte**.
`TwinVanHanh.tsx` **3.573 → 3.542**. Module moi `hopNhatCanh.ts` **422 dong**, **5 cho goi**
(chu du an kiem), 7 ham: `dungMayVe:175` · `idMayChuaDat:233` · `mepMatBang:251` · `neoTrenNoc:296` ·
`dungNhanMay:318` · `gopNhan:356` · `dungCanhBao3D:396`.

> #### ★★★ G93 - **TACH MOT KHOI TAO RA MOT CHO MOI DE NOI NHAM**
> Sau khi noi, Dot 29 ablation **o TRANG** (khong chi o module). **Ba dot bien SONG SOT ca 1.998 test**:
> - `tangId: tangIdCuaDatCho` → `tangId` (pham vi theo **tang dang xem** thay vi **tang cua hang dat cho**)
> - `idDuocNap: tapDs.idMay` → **moi may** (dung loi F2: **373 may tang khac** dung thanh khoi trong khu cho)
> - `gopNhan(nhan, nhanLine)` → `gopNhan(nhan, [])` (**nhan chuyen #54 bien mat**)
>
> Luoi cua **module** khong cuu duoc: no chung minh **ham dung khi duoc goi dung**, **khong biet trang
> goi bang doi so nao**.
> ⇒ **Truoc khi tach**, `tangId`/`tapDs.idMay` nam **trong than bieu thuc**; **sau khi tach** chung thanh
> **doi so truyen tay** - tuc **them dung mot cho de noi nham**. Da viet
> `hopNhatCanhNoiVaoTrang.unit.test.ts` (**12 ca**); chay lai 3/3 nay **DO**.
> => **Moi refactor "tach ra cho sach" deu MUA them mot be mat loi o KHOP NOI.** Phai ablation **o ca
> hai phia**: module (ham dung khong) **va** trang (goi dung khong).

> #### ★★★ G94 - **MA MAU ANSI LAM PHEP DO IM LANG TRA RONG**
> Harness ablation dau loc `grep "Tests +[0-9]"` - vitest **chen ma mau ANSI** giua `Tests` va chu so
> ⇒ mau **khong bao gio khop**, moi luot in ra **RONG**. **Doc rong thanh "khong do" cho ra dung ket
> luan NGUOC.**
> Chinh **baseline rong** to cao thiet bi (**G92** - doc ca baseline, khong chi delta). Sua bang
> `sed 's/\[[0-9;]*m//g'` roi **chay lai TOAN BO** ablation, gom ca cac dot bien module **da "do"
> truoc do** - vi khong the tin ket qua doc bang thiet bi hong.

**Ablation: 11/11 dot bien DO, baseline XANH.** Gom hoan vi truc y↔z · `neoTrenNoc` cong cao vao z ·
khu cho dung `!has()` (**khe giua hai dieu kien**) · ngoai pham vi lam **toi** thay vi **pha nen** ·
`mepMatBang` tra `Infinity` · muc andon la **bi bo im lang**.

**Khong tach them - da viet thanh test (G91):** `hopNhatCanhKhongTachThem.unit.test.ts` (6 ca).
`cotWipCanh`/`bangWip`/`nhipChuyenMs` **DA tach san** - chung la **loi goi mot dong** toi `wipTram.ts`;
keo qua module moi chi **them lop boc rong**, tuc them cho cho **luat thu hai moc len** (**G12**).
`mayVeTatCa` la **DIEM NOI**, khong phai phep bien doi. **Hoan vi truc chi duoc viet MOT cho** -
module goi `mmSangScene()` thay vi **ba** `mmSangMet` viet tay nhu ban cu.

**Cho brief cua chu du an SAI (G83 lan tu):** phep dem cua toi la **grep THO co chu thich**.
Chu du an do lai xac nhan: `mayVe` **tho 24 / sach 18** · `bangWip` 4→**2** · `cotWipCanh` 3→**2**.
`:670` va `:984` **dung chinh xac**. ⇒ **Chinh cai bay G92 ma Dot 28 vua ghi da can toi o Dot 29.**

### 14q.6 DOT 30 - MAN LINE dung xong, bi CAT giua nghiem thu cuoi (2026-09-09/10)

Ba commit: `ba568cd5` (`manLine.ts` lat thuan) · `983e2d1d` (`TwinLine.tsx` + route `App.tsx:395`) ·
`80ddefde` (va chieu cao - **chu du an commit ho** sau khi agent bi cat). **Da push.**
Cong do voi cay hien tai: **80 tep / 2.070 test** (nen 78/2.010) - `check` 0 - cay sach - 5 anh md5
nguyen - **13/13 redirect** - route thua cong `/twin` (`navHref="/twin"`, dung **QD-18**).

> #### ★★★ G95 - **SESSION LIMIT CAT AGENT GIUA CHUNG - va G88 (commit tung phan) LA THU CUU VIEC**
> Agent Dot 30 bi API ket thuc som (429 session limit) dung luc *"re-run the full live acceptance and
> read the screenshot"*. Khac Dot 27-lan-dau (**G88**: dung, mat trang), lan nay **hai commit da nam
> tren nhanh** va phan do chi la **2 tep, 117 dong** trong cay lam viec.
> Chu du an **khong resume mu**: (1) doc diff - la ban va chieu cao **dung huong** (do
> `getBoundingClientRect().top`, khong hang so doan - **G23**); (2) doc test moi - ghim **dieu do duoc**,
> khong phai vo rong; (3) chay **80/2.070 + check 0** tren cay dang do; (4) **roi moi commit**, pathspec
> dich danh 2 tep. Sau do resume agent voi **trang thai that** de no khong lam lai.
> => Khi mot lo bi cat: **do cay ma TRUOC, resume SAU**, va noi ro cho no cai gi da commit ho. Va
> **giet server no de lai** (3030, PID khoi dong 21:46) - khong de no tu xu vi no khong biet minh da chet.

**Loi man Line tu bat bang anh (G41 lan nua):** ban dau `h-full` ⇒ `man-twin-line` y=80 h=889 ⇒ day o
**969, tran 69 px**; **12 o tram** y=904 **nam duoi mep 900** - **co trong DOM, co kich thuoc that, moi
`toBeVisible()` XANH**. Chi anh + bbox bat duoc. Nay chieu cao = `100vh - var(--twin-line-top)` voi
bien **do luc chay**, bien CSS **rieng** (khong dung chung `--twin-top` cua `/twin`).

**Con lai cua Dot 30 (agent dang resume):** nghiem thu thi giac tren `dist` moi (bbox 12 o ≤ 900) ·
`__soCanvas = 1` · hai chieu quyen · ablation ca hai phia (G93) · liet ke cong (G78).

### 14q.7 DOT 30 HOAN TAT (resume) - 7/7 cong, 26/26 dot bien DO

bbox sau va (1600×900, `e2e_tai_loE`): `man-twin-line` y=80 h=820 ⇒ day **900** (truoc 969) ·
**12 o tram y=835 h=55 ⇒ day 890 < 900**. Anh doc: dai `LINE STRIP 12 stations · Takt 2.4s · WIP 1304`,
12 o theo dong chay `SPI 121 #1 → AOI 116 #2 → … #12`, **mot canvas**, `OEE measured on 0/12` (honest-null).
`__soCanvas` **= 1** (`e2e_tai_loE` va `operator1`), **`null`** o man id-xau (khong canvas). **13/13 redirect.**

**Ablation ca hai phia (G93):** 9 module + 10 khop noi trang + 3 App + 4 va chieu cao = **26/26 DO**,
baseline 2.070 xanh (doc sau khi loc ANSI - G94).

> #### ★★★ G96 - **CHIEU "BI CHAN" KHONG DO DUOC BANG TAI KHOAN SAN CO - PHAI DUNG VAI RONG**
> Brief chu du an: *"mot vai KHONG co `analytics_oee`/`machine_status` bi chan"*. Dot 30 do DB:
> **5/5 non-admin dang hoat dong DEU co `machine_status`** ⇒ vai ay **khong ton tai**. Chieu chan
> chi do duoc bang user tam `e2e_dot30_khongquyen` (**0 hang `permissions`**) → *"Access denied"*,
> 0 canvas, tRPC **403 / `PERMISSION_DENIED`**. Da xoa, DB ve **8 user**.
> => **G76 co chieu nguoc**: vai khong-admin **co du lieu** chung minh chieu VAO; nhung chieu CHAN can
> vai **khong co gi** - va vai do thuong **khong co san** vi seed nao cung cap toi thieu. Phai dung tam.

> #### G97 - **HAI TRINH DUYET SONG SONG LAM PHEP DO THOI GIAN DO OAN**
> Luot dau: **11/13 redirect** - trong nhu hoi quy. Nguyen nhan: cua so co dinh **1.200 ms** khi hai
> trinh duyet chay song song. Do lai **mot minh** voi `waitForFunction` ⇒ **13/13**, tre max **303 ms**.
> => Mot phep do co **cua so thoi gian co dinh** la thiet bi do **phu thuoc tai may**. Khi do song song
> (nhieu lo), doc do trong phep do thoi gian **truoc het la nghi thiet bi**, sau moi nghi ma.

**Quan sat ngoai pham vi (ghi cho Dot 31/32, khong sua):** `khungNhinLine` `HE_SO_CAO.line=0.55` khung
~7/12 may o 1600×900 - **dung chung** voi `/twin?pv=line`, doi la doi ca hai · 11/12 may chuyen 2 hien
`khong_ro` - hop dong overview **khong mang thoi diem do** cho may khong-offline (NT-3) · man Line lay
`factories[0]` vi `canhThietKe` nhan mot `factoryId`.

### 14q.8 DOT 31 - MAN MAY xong, 8 commit, 40/40 dot bien DO - va MOT LOI KIT CA BA MAN

`1a221d23` manMay.ts · `5ee85b69` TwinMay.tsx · `9d05b692` route `App.tsx:188` (`navHref="/twin"`, QD-18)
· `723f7f11` luoi khop noi 38 ca · `cd0b379b` 3 loi chi anh bat · `72c490ad` e2e 7 ca · `02d0ea65` **va
kit** · `c31e13e0` giet M8. Cong (chu du an do): **82 tep / 2.155 test** (nen 80/2.070) - `check` 0 -
cay sach - 5 anh nguyen - **13/13 + 14/14** dinh tuyen - netstat chi 3000/3001/3008.

**bbox tren `dist` 1600×900:** `man-twin-may` day **900** · canvas 125→449 (**324 = khung**) · cockpit 2D
449→900 (**451 px, LON HON canh** - dung §15.3.3: cap May 3D chi ~20-36 %) · nhan noc **trong khung** ·
draw calls **5**. `__soCanvas`: may 14 = **1** · id xau = `null` · may nha may khac = `null` + `ngoaiPhamVi` ·
`operator1` = `null` + **L-5 `thieuQuyen`** (khac ky vong "=1" cua chu du an - man May **noi ly do** thay vi
ve canh rong; **dung chu y §15.3.3 L-5**). Hai chieu quyen: user tam 0 quyen → 403 `PERMISSION_DENIED`,
`users` truoc/sau **10 hang / 8 active**.

> #### ★★★ G98 - **LOI KIT CO SAN LAM NHAN LECH O CA BA MAN - `toBeVisible()` XANH CA BA** (QD-22: GIU VA)
> `LopNhan.tsx:226` — drei `<Html fullscreen>` neo lop nhan quanh **hinh chieu GOC CANH**, khong quanh
> **canvas**. Do bbox that: `/twin` lop (231,111) vs canvas (288,207) ⇒ **13/13 nhan lech (−57,−96) px**
> khoi may · `/twin/line/2` lop (−496,−322) ⇒ **3/3 nhan y AM - man Line Dot 30 chua tung hien nhan** ·
> `/twin/may/14` nhan y=34 **ngoai khung**. `soNhan`/`toBeVisible` **xanh o ca ba**.
> Va **mot dong**: `calculatePosition={(_el,_camera,size) => [size.width/2, size.height/2]}`. Do lai:
> `/twin` lop = canvas (13/13), Line 6/6 tam nhan trong canvas, May nhan tren noc.
> **QD-22 (chu du an):** **GIU** `02d0ea65` - loi co san, do bang bbox, va la co che dung. ⚠ `LopNhan`
> cung vao **`CanhNhaMay.tsx` (kit loi)** ⇒ **`/twin-studio` CHUA duoc do sau va** - giao Dot 32.
> => Mot lop phu "hien" (toBeVisible) o **toa do sai** van xanh. Chi **bbox lop vs bbox canvas** bat duoc.
> Va **ba man cung mot lop loi** ⇒ khi mot man moi lo loi kit, **do lai cac man cu** truoc khi tin chung.

> #### G99 - **`__soCanvas` MU voi canvas drei NGOAI `KhungCanh`**
> Brief noi `MachineCockpitBody` = cockpit **2D** — **sai**: tab "3D" (`MachineCockpit.tsx:281`) co
> `<Canvas>` drei **khong qua `KhungCanh`** ⇒ bam tab ⇒ **2 canvas trong DOM, `__soCanvas` van 1**.
> **No co san** o `/twin` qua `NganNhung.tsx:92`. RB-4 chi dem cai **no biet**. Ghim bang test + e2e.
> => Chi bao dem theo **dang ky** (KhungCanh tang bo dem) **mu voi moi canvas khong dang ky**. Dot 32
> phai dem **`document.querySelectorAll("canvas")`** song song voi `__soCanvas`.

**Ba loi chi anh bat (G41) → luoi (G91):** canvas tran 14 px (`KhungCanh.tsx:242` ep `minHeight 320`, dat
306 ⇒ `clamp(320px,36vh,360px)` + luoi doc `minHeight` **tu chinh kit**) · camera qua gan cat noc
(`HE_SO_NOI_KHUNG_MAY=2.2`, luoi tinh **goc 8 dinh < 22,5°**, FOV 45 doc tu `KhungCanh.tsx:207`) ·
cockpit mount **truoc khi biet** may mo duoc ⇒ toast "Could not find machine" canh cau L-5.

**Brief/§15 sai (G83):** Hinh C "⚠ May dang E-STOP" **khong co nguon theo may** (`anToanRobot` tra robot,
`robot.id ≠ machines.id`) - khong ve, test **cam** `anToanQ` · §15.6.1 (B) "NG 24h" khong nguon ⇒ D-5 ·
"hang xom qua nen canh Line pha 72 %" - man rieng **khong co canh thu hai** ⇒ `mayHangXom` + pha 72 % cap
`may` · docblock `doMoTheoPhamVi` **noi nguoc** hanh vi do duoc cua `/twin` · `machines isActive` **42**,
khong phai 43 · **nhieu do**: harness Dot 30 tiem dot bien vao `TwinLine.tsx`/`App.tsx` **trong luc** Dot
31 do nen ⇒ 1 do oan ⇒ them **bao ve mtime** vao harness.

**Con mo cho Dot 32:** `/twin-studio` sau va kit · `__soCanvas` mu tab 3D cockpit · cung may 14:
`NganXuLy` "Unknown/Never reported" vs cockpit "ONLINE/Connected" (**hai hop dong**, NT-3) · i18n
`twin3d.may.*`/`twin3d.line.*` chi co default vi.

### 14q.9 DOT 32 - QA DOC LAP (skill `pdca`): **DAT 14 · SAI 18 · HONG 4 · CHAN-DUNG 5** tren 41 ca

Tep tho `.qa-dot32/` (38 json · 54 png · 6 log). **Khong sua ma, khong commit.** Chu du an do lai: HEAD
`91654ee3`, cay sach, 38/54 khop; **3 loi khai Pareto khop ma** (`TwinVanHanh.tsx:2068` `chonMay→ghiUrl`,
`TwinLine.tsx:747` `onChonMay=datMachineIdChon`, `navigation.tsx:2317` `item.href === href`); **4 anh tu
xem khop** (a2 · a3 · a4 · a6b). **So xau la ket qua THANH CONG** - lan dau ket cuc nguoi dung goc *"chon
Line → Line 3D, chon may → Machine 3D"* duoc do, va **khong dat**.

**Buoc 0 (MSA) - thiet bi do bi bac/sua 5 cho:** `__soCanvas` mu (DOM **2** o `/twin/may/14` tab 3D VA
ngan nhung `/twin`) ⇒ moi so canvas la DOM · `tamTrong/tronVen` **13/13 xanh khi lech (−57,−96)** ⇒
loai, chi `lopTrungCanvas` dang tin · `/factory-command` xanh **ca khi go va** (goc canh tinh co o tam) ⇒
khong phai ca duong · `voShell` ban 1 bat nham `<aside>` · `soLink` mu (nav khong phai `<a>`).
**Ablation tren artifact dist** (go `calculatePosition` khoi chunk, md5 truoc/sau) ⇒ DO 3/3 ⇒ khoi phuc
⇒ xanh - **chung minh thiet bi do ma khong sua nguon**. Nhip an toan: 35/35 → dot bien **3 do/32 xanh**.

**Duong co so (vai A `e2e_tai_loE` 1600×900):** a1 `/twin` **0 href** toi `/twin/line/*`·`/twin/may/*`;
Metrics de `SIM-L1-AVI`/`SIM-L2-CONVEYOR`; "Open andon **6**" vs "Alarms (**7**)" vs badge **7** · a2 bam may
⇒ **o lai `/twin`** (`?chon=machine:14`), NganXuLy "Unknown · 54 days" vs cockpit nhung cung may
"**ONLINE · Connected**", tab 3D ⇒ **DOM 2 canvas** · a3 `/twin/line/2` **6/12** may trong khung, cot WIP
vuot mep tren, nua duoi canh trong, bam `o-tram-14` **URL khong doi**, `?cam=` **khong doi camera**, idle
**62/46 khung/4 s** · a4 `/twin/may/14` bo cuc DAT (day 900, canvas 324, cockpit 451), dieu huong
‹/Back/F5 **5/5**; nhung **tren cung mot man**: chip "Unknown" canh header "ONLINE", "Never reported"
canh "Connected" · a5 `/twin-studio` day **953 > 900** · a6 **deep-link `/twin/line/2`·`/twin/may/14` ⇒
app "Overview", sidebar RONG** · a7 redirect **14/14** · a8 `/twin?pv=line:2` **man Line tai cho van
song song song man rieng**, 9/17 nhan bi panel che 72–100 % · a9 API may 14: **BON nguon**
(`factoryCommand`=idle · `assetCockpit`=online/connected · DB `operationStatus=stopped` · twin
`khong_ro`). **1280×720:** 4 SAI/HONG (May cockpit **275 < canh 320** vi pham bat bien Dot 31 ghim o
1600; studio 773 > 720; Line dai 721 > 720). **Vai B `operator1`:** `/twin/line/2` **san trong, "—
machines", khong mot cau giai thich** (TwinMay co `phamViRong`, Line khong). **Vai C 0 quyen:**
CHAN-DUNG 4/4. **Andon `raised` tam:** `/twin/line/2` may su co **ngoai khung, khong dau hieu**.

**Pareto (giam dan):**

| # | Goc re | Dinh | `file:line` |
|---|---|---|---|
| 1 | **Bon hop dong trang thai** mot may; `mapMachineStatus` **khong xet tuoi** log ⇒ log "online" 54 ngay + `operationStatus` null = "running" | 4 man · 9 ca | `factoryCommandService.ts:118-133` · `ecosystem/assetCockpitService.ts:496` `connected = status==="online" ‖ hb<5′` · `TwinMay.tsx:324`/`TwinLine.tsx:372`/`TwinVanHanh.tsx:712` · `kpiNoiLogic.ts:155` dem MAY vs DaiCanhBao dem SU KIEN |
| 2 | **Khong co duong di** toi hai man moi; Line/May **tai cho** van song | 2 man · 4 ca | `TwinVanHanh.tsx:2068,3534` · `TwinLine.tsx:642,747` |
| 3 | **Vo shell rong khi deep-link** | 2 URL × 2 vp | `navigation.tsx:2317` khop chinh xac → `apps.ts getAppForRoute` undefined → `useActiveApp` fallback `listApps()[0]`; `ROUTE_APP_OVERRIDES` `apps.ts:251` |
| 4 | Bo cuc theo viewport | 5 ca | `TwinStudio.tsx:139` `h-[calc(100vh-5rem)]` (top=133) · `TwinMay.tsx:660`+`KhungCanh.tsx:242` · `DaiLine.tsx` `min-w-16` |
| 5 | Nhan: che boi lop phu DOM, ve ngoai canvas ±10 %, 6/12 ngoai khung, su co ngoai khung cam | 4 man · 6 ca | `locNhan.ts` · `LopNhan.tsx:141-143` · `phamViCanh.ts khungNhinLine HE_SO_CAO.line=0.55` |
| 6 | Hoat anh lien tuc man Line (D-7) | 1 man | `TwinLine.tsx` prop `dongChay` → `CanhVanHanh.tsx:526` |
| 7 | Pham vi rong cam tren Line | 1 man · 1 vai | `TwinLine.tsx:264,653,659` |
| 8 | i18n 0 khoa `twin3d.may.*`/`line.*`; chuoi lap trinh hien UI; "4724305s"; "1 machines" | 3 man | `MachineCockpit.tsx` tab 3D · `DanhSachMay.tsx:397` |
| 9 | `?cam=` nuot im lang tren man moi | 1 man | `TwinLine.tsx`/`TwinMay.tsx` khong `docCamera` |

> #### ★ QD-23 (chu du an, he qua truc tiep QD-19 + yeu cau goc) - `/twin` LA CUA VAO, KHONG PHAI NOI XEM LINE/MAY
> Yeu cau goc: *"tu nha may chon Line thi hien thi Line 3D Twin, chon vao may thi hien thi Machine 3D
> Twin"*; QD-19: *"1 man canvas danh cho factory thoi, Line/Machine la 2 man hinh khac"*. Do duoc: `/twin`
> **0 href** toi hai man moi, bam may **o lai** `/twin`, `?pv=line:` van dung man Line **tai cho**.
> ⇒ **Bam Line trong `/twin` → `/twin/line/:id`. Bam may → `/twin/may/:id`.** `?pv=line:N` va
> `?chon=machine:N` (va `?xem=machine:`) tren `/twin` **redirect** sang man rieng (them vao bang
> `dinhTuyenTwinCu` - G40: do lai ca 14 sau khi them). Ngan nhung cockpit trong `/twin` (`NganNhung`) **mat
> duong vao** (khong xoa ma) ⇒ tab 3D 2-canvas o `/twin` **bien mat theo** (dong mot nua G99). `/twin` giu
> 3 cap `tapDoan|nhaMay|tang` + ngan phai **tom tat** khi chon Line/tang. ⚠ Chu so huu co the dao: neu
> muon giu "xem nhanh" may ngay trong `/twin`, noi truoc Dot 33.

**Ke hoach va (tuan tu, mot worktree - cam git song song):**
- **Dot 33** — Pareto **#2 + #3 + #9**: duong di nguoi dung (QD-23) · vo shell deep-link
  (`ROUTE_APP_OVERRIDES` hoac khop tien to) · `docCamera` o hai man moi. Ket cuc do: tu `/twin` bam Line
  → URL `/twin/line/N` + sidebar "Production (MES)"; bam may → `/twin/may/N`; F5 giu; **`?pv=line:`
  redirect**; 14/14 + moi.
- **Dot 34** — Pareto **#1**: mot hop dong trang thai. Server: `mapMachineStatus` nhan `ts`, gate tuoi;
  `assetCockpit connected` bo nhanh khong tuoi; response mang `ts`. Client: mot ham `trangThaiMay(ts,
  status, opStatus)` dung chung ba man + `kpiNoiLogic` dem cung don vi voi DaiCanhBao. Ket cuc: cung may
  14, **ba man + API noi MOT dieu**, "Never reported" chi khi that su chua co hang.
- **Dot 35** — Pareto **#4 + #5 + #6 + #7**: viewport 1280 (studio `--top` do luc chay; May clamp; Line
  dai) · nhan (vung cam DOM tu bbox lop phu; bo ±10 %; `khungNhinLine` bao 12/12; chip "N su co ngoai
  khung") · `dongChay` tat khi idle · nhanh `phamViRong` cho Line.
- **Dot 36** — Pareto **#8** i18n + **QA lai bang `pdca`** tren harness `.qa-dot32/do.mjs` (san 41 ca).

> #### G100 - **`/api/auth/me` tra HTML SPA 200 - helper `dangNhap` cua e2e Dot 26/31 CHUA BAO GIO kiem vai**
> Giong `/api/health` (Khoi D). `ten = undefined` ⇒ cau "phien phai dung vai" **bo qua im lang** o moi e2e
> tu Dot 26. Dung tRPC `auth.me`. ⇒ **Mot endpoint khong ton tai tra 200** la bay cho moi helper doc no.

> #### G101 - **`git checkout --` voi `core.autocrlf=true` ghi lai LF→CRLF** ⇒ md5 lech du `git diff` rong
> Khoi phuc **dung byte** bang `git show HEAD:path > path`. Chi so "md5 khop" sau khoi phuc phai do
> bang cach nay, khong thi bao do oan (hoac te hon: bao xanh khi tep da doi).

> #### G102 - **"kit loi" ≠ "moi man dung no"** - brief toi noi `LopNhan` vao `CanhNhaMay` ⇒ studio chua do;
> do: `CanhNhaMay` o **`/factory-command`** (`App.tsx:495`), studio **0 `LopNhan`**. Suy tu ten kit = G83
> lan 7. Va `/factory-command` **moi may `position 0,0,0`** chong dong, nhan "Idle/Running" trong khi
> `/twin` "Unknown 41" **cung API** - Pareto #1 lan ra ngoai twin3d.

**Brief Dot 32 sai 5 cho (G83):** netstat con **5173/8080** (co san, khong phai twin) ·
`dinhTuyenTwinCu.ts` o `bo-cuc/` · `machine_health_history` **189.711** · studio khong co `LopNhan` ·
bang redirect e2e **14** hang (13 + `/rf-test-cell`).

**Con mo (QA noi thang):** co 3D andon `raised` tren `/twin/may` co 4 nut DOM ma anh khong thay (chua do
bbox) · chieu **ack** chua do (`e2e_tai_loE` thieu `andon canEdit`) · vai `engineer1` khong do lai ·
82/2155 khong tai lap dung bo loc, **104/2408** la tap bao (`vitest run twin`).

### 14q.10 DOT 33 - PARETO #2 + #3 + #9 (QD-23): `/twin` LA CUA VAO - K1..K9 do SONG tren dist, ablation hai phia

Thư mục thô `.qa-dot33/` (harness `do.mjs` kế thừa Đợt 32; `truoc/` = dist `9ea4016c`, `sau/` = dist sau vá,
`go-va-*/` = ablation mức dist, `ablation-unit/` = ablation mức lưới). Vai `e2e_tai_loE` (tRPC `auth.me`, G100),
1600×900, cổng **3033** (không đụng 3000/3001/3008/5173/8080). **6 commit** pathspec `eab0dae7 → 5c2ee49e`.

**Kết cục gốc** *"từ nhà máy chọn Line thì hiển thị Line 3D Twin, chọn vào máy thì hiển thị Machine 3D Twin"*:
Đợt 32 **KHÔNG ĐẠT** → Đợt 33 **ĐẠT**, đo bằng `waitForFunction` (không cửa sổ cố định):

| K | Trước (`truoc/`) | Sau (`sau/`) |
|---|---|---|
| K1 `/twin?pv=factory:1` → bấm node Line trong cây | ở lại `/twin?pv=line:2&chon=line:2` (15 s không tới) | **`/twin/line/2` sau 7 ms**, canvas DOM 1 = `__soCanvas` 1, app "Production (MES)" 10 mục |
| K2 `/twin?pv=tang:28` → bấm `may-hang-14` | ở lại `/twin?…&chon=machine:14`, cockpit 0 | **`/twin/may/14`**, `cockpit-2d` 1, `ngan-nhung` 0 suốt, canvas DOM 1 suốt (K8) |
| K3 `/twin/line/2` → bấm `o-tram-14` | URL không đổi | **`/twin/may/14`** 19 ms; ‹ Line về `/twin/line/2`; Back ×2 đúng |
| K4 Back / link "Nhà máy" / F5 | link về `/twin` trơn | Back → `pv=factory:1` · link → `pv=factory:1` (history.state) · F5 rồi link → `factory:1` · F5 rồi Back → `factory:1` |
| K5 deep-link context mới `/twin/line/2` · `/twin/may/14` | app **"Overview"**, 0 mục | **"Production (MES)"**, 10 mục, "3D Factory" cùng lớp `bg-sidebar-accent` với đối chứng `/twin` |
| K6 redirect | 14/14 cũ · **0/6** mới · 4/4 giữ | **14/14 cũ · 6/6 mới (≈550 ms) · 4/4 giữ** · 2 đối chứng cố ý sai TRƯỢT (G92) |
| K7 `/twin/line/2?cam=` | nhãn KHÔNG đổi (340 px ≈ nhiễu 674), `__tuTheCamera` null | **`__tuTheCamera` = đúng giá trị yêu cầu** (A `19.2,18,30` · B `0,10,14.8`; mặc định `19.2,7.6,21.7`), nhãn đổi, pixel canvas khác **239.705 / 354.158** (nhiễu 2 lần không-cam: 1.512) |
| K11 lối vào Mô phòng | — | `/twin` tầng: `ngan-mo-phong` 1, `data-ly-do=chua_chon_line`; `/twin/line/2`: **0** ⇒ what-if **mất lối vào** (xem ô dưới) |
| K9 tenant `/twin/line/11` · `/twin/may/257` | `line-rong` 1, 0 ô trạm, 0 nhãn, 0 canvas · `ngoaiPhamVi` | không đổi |

> #### ★ QD-23 thực thi - bốn mảnh, mỗi mảnh một hàm, một commit
> 1. **`dichManRieng(search)`** (`bo-cuc/dinhTuyenTwinCu.ts`) — redirect THAM SỐ: `xem=machine` > `chon=machine` >
>    `pv=machine` > `chon=line` > `pv=line`; `tapdoan|factory|tang`, `chon=station`, `xem=robot|station` **ở lại**.
>    Gọi ở **VỎ** `TwinVanHanh` (`useSearch` → `<Redirect replace>`), thân `ThanTwinVanHanh` không mount cho URL sắp rời
>    — vì `<Route>` wouter chỉ render lại theo *pathname*, và thân có ~90 hook (không chen `return` giữa).
> 2. **`chonMay`/`chonLine`/`chonPhamVi`** trong `/twin`: mọi bề mặt (cây, danh sách, 2D/3D, dải cảnh báo, `DaiLine`,
>    breadcrumb) → `setLocation(duongDanMan*(id), { state: trangThaiVe(pathname+search) })`. `chonMay(null)` vẫn là bỏ
>    chọn tại chỗ. `NganXuLy` trên `/twin` **không còn** `onMoTaiCho/nganNhung/lyDoNgan/onDongNhung` ⇒ `NganNhung`
>    mất đường vào (tệp giữ, `NganXuLy.tsx` vẫn dựng khi được truyền).
> 3. **`TwinLine`**: bỏ `datMachineIdChon`; cảnh 3D + dải trạm cùng `dieuHuongToiMay`. **Vỏ** `TwinLine`/`TwinMay`
>    đọc `?cam=` (`docTrangThaiUrl(search).cam` — cùng bộ đọc với `/twin`) và `history.state` (`useHistoryState` của
>    `wouter/use-browser-location`) rồi TRUYỀN xuống thân (G37). `khungNhin = camUrl ? khungNhinTuCamera(camUrl) : …`.
>    Link "Nhà máy" `href={duongVe ?? "/twin"}`; Máy → Line mang `state` tiếp.
> 4. **`getAppForRoute`** (`lib/apps.ts`): route con thừa app của route cha (cắt dần đuôi) — BẤT BIẾN thay vì thêm
>    hàng vào `ROUTE_APP_OVERRIDES` (danh sách đóng, G67). `apps.unit.test.ts` đo trên **toàn bộ `navGroups`**: 0 mục
>    nav đổi app; `/corporate-dashboard` override giữ; gốc lạ vẫn `undefined`.

**Lưới đỏ khi vá — phân loại:** **(a) 3 ca** ghim hành vi cũ mà QĐ-23 thay, đã cập nhật kèm lý do trong test:
`manMayNoiVaoTrang` ⑦ (chuỗi ``setLocation(`/twin/may/${id}`)`` → helper + state) · `nhungTaiCho.dom` "TRUYỀN cả ba
móc" (đảo chiều: `/twin` KHÔNG truyền, `NganXuLy` VẪN nhận) · `nhungTaiCho.dom` "TRUYỀN `lyDoNgan`" (lý do L-5 nay ở
`TwinMay`). **(b) 0 ca** bất biến bị mã vi phạm (`tang1KhongTachDuoc`, `manLineNoiVaoTrang`, `duongDanBaMan`,
`useTrangThaiTwin` G37, RB-4 một canvas, tenant `ngoaiPhamVi` — tất cả xanh không sửa). Lưới MỚI: `cuaVaoTwin` 24 ca ·
`apps.unit` 5 · `dichManRieng` 10 · `duongDanTwin` 8 · `khungNhinTuCamera` 4. Cổng: twin3d **83 tệp / 2200** (nền
82/2155), `vitest run twin` **105 / 2453** (nền 104/2408), `check` 0, `build` 0 (55,7 s).

**Ablation (G93 cả hai phía):** mức lưới `ablation-unit.log` — gỡ từng mảnh (A1 helpers 15 đỏ · A2 cam 4 · A3 `/twin`
11 · A4 Line/Máy 10 · A5 shell 4) rồi khôi phục ⇒ 0 đỏ, md5 4 tệp CRLF khớp byte sau `git checkout --` (G101 chiều
NGƯỢC: `git show >` ghi **LF** vào tệp worktree CRLF ⇒ md5 lệch dù `git diff` rỗng — tuỳ EOL của tệp mà chọn lệnh khôi
phục, so md5 với bản ghi TRƯỚC là phép đo duy nhất đáng tin). **Mức dist theo mảnh** (`ablation-dist.sh`: sao lưu
byte → trả tệp về `9ea4016c` → build → restart 3033 → đo → chép byte gốc lại): **A3** gỡ `TwinVanHanh.tsx` ⇒ K1 đỏ
(ở lại `/twin?pv=line:2&chon=line:2`), K2 đỏ (`?chon=machine:14`, cockpit 0), K6 mới **0/6** đỏ — 14/14 cũ vẫn xanh
(bảng cũ độc lập, đúng) · **A4** gỡ `TwinLine/TwinMay` ⇒ K3 đỏ (URL không đổi), K7 đỏ (`__tuTheCamera` vẫn
`19.2,7.6,21.7` với cả A/B; pixel 1.105/856 ≈ nhiễu 889 — kit hook sống, màn bỏ qua cam) · **A5** gỡ `apps.ts` ⇒ K5
đỏ (deep-link "Overview", 0 mục; `/twin` đối chứng vẫn "Production (MES)" 10 mục, mục không-active KHÁC chuẩn ⇒ phép so
biết kêu). Cột "Trước" của bảng K = dist `9ea4016c` = gỡ toàn bộ. Sau khi chép byte gốc lại: build cuối + smoke
k1/k5/k7 xanh (`sau-khoi-phuc/`), cây `*.ts/*.tsx` sạch.

> #### ★ HỆ QUẢ QĐ-23 chủ dự án PHẢI biết - ngăn Mô phỏng what-if (lô X) MẤT LỐI VÀO
> `NganMoPhong` + `useMoPhongTwin` chỉ chạy khi `lineDangXem = phamVi.cap === "line" ? … : null`
> (`TwinVanHanh.tsx:678`). Sau QĐ-23 `/twin` không bao giờ ở cấp line ⇒ ngăn luôn khai `chua_chon_line`; màn
> `/twin/line/:id` **không có** ngăn này (D-1 chỉ đọc, chưa nối). Đo K11 `sau/k11-mo-phong-loi-vao.json`. Tính năng
> §11 #35 (phát lại workflow, Gantt) do đó **0 lối vào UI** cho tới khi chuyển `NganMoPhong` sang `TwinLine`
> (đề nghị Đợt 34/35; nó chỉ có truy vấn đọc, không phạm D-1). e2e `twin-lo-x-mo-phong.spec.ts` X1–X3 (đi
> `/twin?pv=line:1`) sẽ ĐỎ — **không "nới" lưới**, để đỏ tới khi có quyết định.

**Brief Đợt 33 sai/thiếu (G83):** (1) *"`?cam=` đọc thật … `docCamera` như `TwinVanHanh`"* — **`/twin` cũng KHÔNG
đọc** `urlState.cam` (grep: chỉ `ghiUrl({cam})` ở `:2114`); nó chỉ GHI. Đợt này KHÔNG sửa `/twin` vì `/twin` ghi
`cam` bằng `replaceState` sau mỗi lần dừng xoay ⇒ đọc lại rồi bay tới sẽ thành vòng lặp tween; cần "đọc một lần lúc
mount" — ghi nợ. (2) *"`/twin/line/<line nhà máy khác>` ⇒ `ngoaiPhamVi` (Đợt 30 đã có)"* — **SAI**: `TwinLine` không
có nhánh `ngoaiPhamVi`, nó hiện `line-rong` "Chuyền này chưa có máy nào trên bố cục" (đúng Pareto #7 Đợt 32); K9 đo
đúng thứ có thật, không hỏng. (3) *"đo camera qua `__thongKeVe`"* — không có trường camera; thêm cửa sổ đo
`__tuTheCamera` (kit, 1 dòng ở `CanhVanHanh.camDoi`). (4) `[data-sidebar="menu-button"]` đếm **0 ngay trên `/twin`
lành** — sidebar launcher không dùng `SidebarMenuButton`; đo vỏ bằng chữ nội dung + lớp CSS của đúng mục, so với `/twin`
làm chuẩn. (5) Bảng e2e redirect 14 hàng: đúng; nhưng `twin-dot22` A3/A4 + `twin-dot24` V4–V6 + `twin-lo-x` X1–X3 đi
qua `/twin?pv=line:`/`?xem=` — e2e ngoài cổng vitest, chưa ai chạy lại (ghi ở "còn mở").

**Còn mở (nói thẳng, `file:line`):** · `useTrangThaiTwin.ts` vẫn trả `nganNhung`/`ghiXem` — **0 chỗ gọi** sau đợt này
(giữ vì `nhungTaiCho.dom.test.tsx:167-185` ghim hook đọc/ghi `?xem=`; dọn cùng lúc với quyết định NganNhung) ·
`?xem=robot:N`/`?xem=station:N` trên `/twin` nay **bị bỏ qua im lặng** (không màn riêng, `dichManRieng` trả `null`) ·
`/twin` không đọc `?cam=` (mục 1 ở trên) · các nhánh `phamVi.cap === "line"|"may"` trong `TwinVanHanh.tsx`
(`:678`, `:1776-1800`, `DaiLine :3502`) nay **không thể tới** — mã chết có chủ ý, dọn ở đợt tách tiếp · e2e
`twin-dot22-nghiem-thu.spec.ts:175,192,318` · `twin-dot24-nghiem-thu.spec.ts:84-140` · `twin-lo-x-mo-phong.spec.ts:24-120`
ghim hành vi cũ (a), chưa chạy lại · Pareto #1/#4–#8 nguyên trạng (K1 ảnh: cột WIP vượt mép, 6/12 máy trong khung;
K2 ảnh: chip "Unknown · Never reported" cạnh cockpit "ONLINE · Connected").

### 14q.11 CHU DU AN NGHIEM THU DOT 33 + QD-24 + DOT 34

Do lai doc lap tren `5c80f639`: **7 commit** pathspec · twin3d **83 tep / 2.200** (+1 tep, +45 ca) · `vitest run
twin` 105/2.453 · `check` 0 · `build` 0 · cay sach · 5 anh nguyen · 3033 tat · route `/twin/line/:id` +
`/twin/may/:id` con. **Ket cuc goc DAT lan dau**: K1 bam Line → `/twin/line/2` **7 ms**, K2 bam may →
`/twin/may/14`, K5 deep-link → "Production (MES)" 10 muc, K6 **14/14 cu + 6/6 moi**, K7 `?cam=` doi camera
that. Ablation **ca hai muc**: unit (A1 15 · A2 4 · A3 11 · A4 10 · A5 4 do → khoi phuc 0) va **dist** (A3/A4/A5
moi phia deu do, 14/14 cu van xanh khi go va moi - bang cu doc lap, dung G40).

> #### ★ QD-24 (chu du an) - CHUYEN `NganMoPhong` (what-if, lo X) SANG `TwinLine`
> Do: `useMoPhongTwin`/`NganMoPhong` **chi o `TwinVanHanh`** (`:678`, `phamVi.cap==="line"`), can `lineId`
> (`moPhongLogic.ts:138` `chua_chon_line` khi null). Sau QD-23 `/twin` **khong con cap Line** ⇒ mo phong o
> `/twin` **luon** "chua chon line"; `TwinLine` 0 ngan ⇒ tinh nang **mat han** (K11). Hook da nhan
> `lineDangXem` qua tham so (G37) ⇒ chuyen duoc, **chi truy van doc** (khong pham D-1). Nhanh `cap==="line"`
> trong `TwinVanHanh` thanh **ma chet co chu y** — Dot 34 go `NganMoPhong` khoi `/twin` sau khi Line co.
> e2e `twin-lo-x` X1–X3 viet lai theo man Line; `twin-dot22:175,192`, `twin-dot24:84,135` cap nhat theo QD-23.

> #### G103 - **BRIEF SAI LAN 8** (5 cho) - va mot cho toi tu suy tu Dot 30
> (1) *"`docCamera` nhu `TwinVanHanh`"* — `/twin` **cung khong doc** `cam` (chi ghi, `:2114`); doc lai = vong
> lap tween. (2) *"`/twin/line/<nha may khac>` ⇒ `ngoaiPhamVi` (Dot 30 da co)"* — **khong co**, Line chi co
> `line-rong` (= Pareto #7). Toi **ke thua loi khai Dot 30** ma khong grep. (3) `__thongKeVe` khong co camera.
> (4) `[data-sidebar="menu-button"]` dem **0 tren `/twin` lanh** — selector mu. (5) Brief khong neu Mo phong
> song nho `phamVi.cap==="line"` ⇒ QD-23 giet no. ⇒ **He qua cua mot quyet dinh dinh tuyen phai grep MOI
> nhanh `cap===` truoc khi thuc thi**, khong chi nhanh minh dang sua.

**e2e cu tren dist (`.qa-dot33/e2e-legacy.log`): 15 pass / 10 fail** — 7 lop (a) do QD-23 (Dot 34 cap nhat).
Agent khai 3 ca "moi truong", trong do *"operator1 khong con 0 gan"* — **chu du an do DB: operator1 id 48,
`user_factory_assignments` = 0 hang, users = 10** ⇒ loi khai sai. Doc anh + ma that:
- `twin-dot24:117` V5 `/twin?xem=machine:1` → **redirect `/twin/may/1`** (QD-23) → TwinMay **noi ly do** "Khong mo
  duoc may #1 … to be assigned a factory" — regex cu `/not assigned to any factory|chua duoc gan/` khong khop cau
  moi ⇒ **lop (a)**. ⚠ TwinMay dung `thieuQuyen` cho vai **0 gan nha may** — cau sai ban chat ("You do not have
  permission" trong khi thuc ra "chua duoc gan") ⇒ Dot 34 tach `chuaGanNhaMay` khoi `thieuQuyen` (L-5 noi dung ly do).
- `twin-dot24:34` V1: anh hien dung EmptyState "not assigned", testid `man-twin-van-hanh` **con o ca 3 nhanh**
  (`:2485/2499/2530`), Dot 32 b1 do mot minh **DAT** ⇒ do la **nhieu tai** 25 ca song song (G97) ⇒ Dot 34 do lai
  **mot minh** truoc khi ket luan.
- `twin-dot31:300` phu thuoc user tam da xoa — **test thiet ke sai**, phai tu tao/xoa trong test.
⇒ **Ten test khong phai bang chung** ("operator1 (0 gan)" trong ten ≠ DB doi). Doc anh that + DB that.

**Con mo:** `?xem=robot:N|station:N` tren `/twin` bi **nuot im lang** (`dichManRieng` tra `null` — G67 lop cu)
· `useTrangThaiTwin` van tra `nganNhung`/`ghiXem` 0 cho goi (ghim boi `nhungTaiCho.dom`) · nhanh
`cap==="line"|"may"` trong `TwinVanHanh` (`:678`, `:1776-1800`, `:3502`) khong the toi.

**Dot 34 (giao tiep):** Pareto **#1** (server `CommandMachineNode.tsTrangThai` + `mapMachineStatus` gate tuoi;
`assetCockpit connected` gate tuoi; client `tsTrangThaiTuIssues` uu tien `ts` that; `kpiNoiLogic` dem cung don
vi DaiCanhBao) + **QD-24** (NganMoPhong → TwinLine) + **e2e cu 7 ca (a)** + `twin-dot31:300` tu tao user.

### 14q.12 DOT 34 - MOT HOP DONG TRANG THAI (Pareto #1) + QD-24 - DAT; BRIEF SAI LAN 9 O CHO COT LOI

`a86327ed`, **6 commit** pathspec. Chu du an do lai: twin3d **83 tep / 2.210** (+10) · `vitest run twin` 105/2.463 ·
server `trangThaiMayTuoi` 17/17 · `check` 0 · `build` 0 · 5 anh nguyen · DB `2·82·37·42·10·7 · hb 108 · msl 7.814`
truoc = sau · 3034 tat · e2e cu **25/25** `--workers=1` (V1 mot minh **pass** 1,6′ ⇒ Dot 33 do la nhieu tai).

**Bang 4 nguon may 14** (`.qa-dot34/bang-4-nguon-may-14.md`): truoc = `idle` (41 = 38 idle + **3 running gia**) ·
cockpit `connected:true` "ONLINE · Connected" · `machineDetail running` · chip `khong_ro` "Never reported"/"54 days".
Sau = **`offline` + `tsTrangThai` 2026-07-17T01:26Z** o overview · cockpit **`connected:false` "OFFLINE ·
Disconnected · hb 54d"** · `machineDetail offline` · chip `khong_ro` "54 days" · `/twin` KPI chay 0 / mat KN **41** ·
`/twin/line/2` 0 / 12 · **ngan Mo phong `1`** tren Line (QD-24), **0** tren `/twin`. **Doi chung may song** (chen 1
hang `machine_heartbeats` cho 18 `now()`, 108→109→108): `running` + "Updated 2s ago" + cockpit "ONLINE · Connected ·
2s" ⇒ gate **khong giet may song**. Ablation: go gate server ⇒ 3 running gia + "ONLINE" quay lai; go uu tien
`tsTrangThai` client ⇒ "Never reported" quay lai o cua so truoc goi socket (~10 s). Khoi phuc md5 3/3.

> #### ★★★ G105 - **BRIEF SAI LAN 9 - O CHO COT LOI**: "gate theo tuoi hang log `online`" la SAI
> `machine_status_logs` la **SU KIEN CHUYEN** (`recordPresence` *"chi ghi khi doi"*; `socket.ts:320/440/605/786`
> ghi luc connect/disconnect). Gate theo tuoi log se to `offline` **may song on dinh** sau 5′ — mot hoi quy an
> toan doi lot "trung thuc du lieu". Dot 6 **da ghim dung dieu nay** (`db/twinCanh.ts:1095 chonNguonMocTuoi`,
> THUONG-4) ma toi khong doc lai. Agent dung **NHIP TIM** (`machine_heartbeats`, DISTINCT ON) lam bang chung song;
> log `offline` chi thang khi ghi **sau** nhip tim cuoi. `NGUONG_TRANG_THAI_TUOI_MS = 5′` **mot so**, test ghim
> `= NGUONG_CU_MS` client. Va: log 14 la **3 ngay** (khoi dong lai 09-06), **54 ngay la heartbeat** — toi tron hai
> thu. 43/43 may co log moi nhat `online` (mot lan khoi dong lai) ⇒ gate theo log = **43/43 sai**.
> ⇒ **Bang chung "song" phai la TIN HIEU DINH KY, khong phai SU KIEN CHUYEN.** Khi thiet ke gate tuoi, hoi
> truoc: *bang nay ghi theo nhip hay theo doi?*

> #### ★★★ G104 - **`db.execute` THO DOC `timestamp` NAIVE LECH −7 h** (postgres.js doc theo gio may; drizzle typed
> doc UTC) - **lo ra chi nho doi chung may song** (chen hb `now()` ma tuoi hien 7 h). Va 5 cau (fleet ×3, kho
> `trangThaiTapMay` ×2) bang `AT TIME ZONE 'UTC'` (`a86327ed`). **Con 7 cau** `"timestamp" AS ts` chua va (grep
> `server --include=*.ts`, tru test) ⇒ Dot 35 lo rieng + **luoi**: mot test chay SQL tho vs typed tren cung hang,
> lech phai = 0. ⇒ Cung lop "bon hop dong": hai duong doc **cung cot** ra **hai gio**.

**Brief sai them (G83):** "`tsTrangThai` tu `statusByMachine`" — phai la **nhip tim**, khong thi nen (3 ngay) va kho
(54 ngay) **lat nhau moi goi socket** · "Never reported bia" chi trong **cua so truoc goi socket dau** (~10 s) — sau
do kho phu; ablation B chung minh dung cua so ay · e2e X1 ghim `data-mo="1"` loi thoi tu **Dot 23 M2** (mac dinh
THU), khong chi do QD-23.

**QD-24 thuc thi:** `NganMoPhong` + `useMoPhongTwin({lineDangXem: lineId})` + `dungDauVaoWhatIf` sang `TwinLine`; vo
doc `?thu=moPhongMo` **mot lan** (G37/G40), mac dinh THU; go **188 dong** khoi `TwinVanHanh` co docblock. **(D)**
`lyDoMoManMay` tach `chuaGanNhaMay` (phamViRong) khoi `thieuQuyen` (FORBIDDEN), i18n ×3; V5 that:
`data-ly-do=chuaGanNhaMay` "Your account is not assigned to any factory yet…".

**Con mo:** 7 cau `timestamp` naive · `factoryCommandService` issue `offline` may chua tung co gi ⇒ `ageMinutes: 0`
(loi khai "0 phut") · `khoTrangThai.ts:185-199 hopNhat` phu `operationStatus` (`stopped`) len nen overview (`idle`)
— hai tu vung, chua do voi may song `stopped` · `DanhSachMay.tsx:397` "4733902s" (#8) · `/factory-command` nay 41
issue `offline` trong feed — chua nghiem thu thi giac · `check:tests` 32 loi co san.

**Dot 35 (giao tiep):** Pareto **#4 + #5 + #6 + #7** theo TEN (so dong da troi): `TwinStudio` `h-[calc(100vh-5rem)]`
→ do `top` luc chay nhu `--twin-line-top`; `TwinMay` `clamp(320px,36vh,360px)` giu bat bien `cockpit.h > khoiCanh.h`
o 720; `DaiLine` `min-w-16`; `loi/locNhan.ts` vung cam DOM; `loi/LopNhan.tsx` `ngoaiKhung` ±10 % bo; `phamViCanh.ts`
`HE_SO_CAO.line 0.55` bao 12/12; chip "N su co ngoai khung"; `CanhVanHanh` `{dongChay ? <DongChayLine/>}` tat khi
idle (D-7); `TwinLine` `rongThat` can `canhQ.isSuccess` ma query **tat** khi `factoryId=null` ⇒ nhanh
`chuaGanNhaMay` (dung `cauChoLyDoManMay` Dot 34). + **lo mui gio 7 cau + luoi**.

### 14q.13 DOT 35 - PARETO #4 #5 #6 #7 + G104 - DAT; BRIEF SAI LAN 10 (8 CHO)

`a0e314a5`, **8 commit** pathspec. Chu du an do lai: twin3d **86 tep / 2.298** (+3 tep, +88 ca) · `vitest run twin`
108/2.551 · server 5 tep/71 · `check` 0 · `build` 0 · 5 anh nguyen · DB `2·82·37·42·10·7·hb 108·msl 7.814` truoc = sau
· 3035 tat · cay + index sach · `__soCanvas` = DOM canvas = 1 moi man · e2e `twin-dot31` 7/7. **Anh tu xem**: Line 1600
**12/12 may mot hang**, cot WIP tron, Metrics khong de nhan, robot co andon noi; studio 1280 day vua 720.

| E | truoc | sau (`sau-D/`) |
|---|---|---|
| E1 studio 1600/1280 | day **953/773** | **900/720** (`useTruDinhKhung`, bien rieng `--twin-studio-top`) |
| E2 May 1280 | canvas 320 > cockpit **275** | canvas **259 < cockpit 336**; 1600 giu 324/451 |
| E3 Line 1280 | o tram 70 px, 11/12 gay 2 dong, day 721 | **55 px ca hai vp**, day 720/900 |
| E4 Line 1600 | **6/12** trong khung, pixel la mep tren 709 | **12/12**, pixel la **0**, nhan 11/12 |
| E5 nhan duoi lop phu / ngoai canvas (6 phep) | 1/2 · 0/1 | **0/0 ca 6** (`vungCam` tu `[data-che-nhan]`, bo ±10 %) |
| E6 andon ngoai khung (tam 7→8→7) | khong dau hieu | chip **"2 alarms out of view"** (14 tam + 18 `acknowledged`) |
| E7 idle 4 s | **88/106**, 158/156 khung | **1/1**, 0/2; keo ⇒ 15/40; go C ⇒ 119/115 |
| E8 operator1 Line | `lyDo=null`, 1 canvas, "— machines" | `chuaGanNhaMay`, **0 canvas** (dung lai `cauChoLyDoManMay`) |
| E9 msl tam `now()` (7814→7815→7814) | tuoi **25.203 s (420′)** | **2 s**; go E ⇒ 420′ |

> #### ★★ G106 - **GREP DEM CAU, KHONG DEM KET CUC** - "con 7 cau mui gio" hoa ra **5/7 la SQL-only**
> `machine.ts:122`, `oeeService` ×3, `warRoomService:381`: `ts` chi vao `EXTRACT(EPOCH …)` **cung phien** (session
> `TimeZone=Etc/UTC`) — khong roi SQL ⇒ **khong co ket cuc de va**. Nguoc lai, **2 cau roi SQL toi bo sot** vi khong
> khop pattern `"timestamp" AS ts`: `energy.ts:149 peakAt`, `aiRcaCopilot.ts:252 createdAt`. Cung lop G83/G102: dem
> theo **hinh dang chuoi** thay vi **duong di cua gia tri**. ⇒ Voi loi "hai duong doc mot cot": liet ke theo **noi gia
> tri roi SQL** (tra ve client/API), khong theo ten cot. Luoi `naiveTimestampQuaExecute.db.test.ts` 6/6 do that tren
> DB test. Con lop G104 **ngoai twin**, chua do: `externalInspectionApi.ts:292-293` (MIN/MAX ra API),
> `repoWorkspaceRouter.ts:437`, `aiRouters.ts:43`, `enhancedAuditRouter.ts:549`, `aiImageEmbedding.ts:942,970`.

> #### ★ G107 - **`git apply -R --3way` THAT BAI DE O NHIEM INDEX** (`UU/MM`) du worktree da khoi phuc
> Ablation A/B o HEAD khong go rieng duoc (hunk chong voi D/B2) ⇒ agent do **tuan tu** `truoc/→sau-A/→sau-B/` + doi
> chung muc luoi. Xu ly: `git restore --staged` (chi index) + `git cat-file --filters` (dang smudge chuan). ⚠ Agent
> khai "blob tu chua CRLF ⇒ `\r\r\n`"; chu du an do `git ls-files --eol`: **`i/lf w/crlf`** — blob **LF**, worktree
> CRLF do `autocrlf`. ⇒ Truoc khi ket luan CRLF, chay `git ls-files --eol`; sau ablation, kiem **`git diff --cached`
> rong** ngoai `git diff` rong.

**Brief sai 8 cho (G83 lan 10):** "9/17 nhan bi che" la cua `/twin?pv=line:2` da redirect (nen that 1–2) ·
`min-w-16` **khong** phai nguyen nhan (chu "1 machines" xuong dong khi `li` bi ep) · G104 5/7 SQL-only + 2 bo sot ·
chip "N su co" **khong dem duoc voi kit cu** (`batThuong` theo trang thai, khong theo andon ⇒ them `andonTheoMay`)
· chip ra **2** khong phai 1 (may 18 `acknowledged` cung bo loc `LopCanhBao`) · idle that **88–158** (khong 62/46)
va **hai nguon khong neu**: `DieuKhien` tween lai khi `khungNhin` doi tham chieu moi nhip; `duong` dung lai theo
tham chieu `diem` · va #5 keo theo loi moi: `chip-may` (vung cam) de nhan noc o 1280 ⇒ B2 · CRLF (xem G107).

**Con mo:** `phamViCanh.ts khopKhungNhin` khop bbox kem WIP 6 m ⇒ may nam dai giua, **nua duoi canvas con trong**
(le bat doi xung) · `TwinLine lyDoMoManLine` chua xet `FORBIDDEN` · idle `/twin` chua do (co the cung tween theo
tham chieu) · Line 1280 cuon ngang 25 px · E7 duoi 4 khung sau keo (damping 0,08 ≈ 2,7 s) · "1 more names hidden"
o 1600 · G104 ngoai twin 6 cho.

**Dot 36 (giao tiep) — Pareto #8 i18n + con mo nho:** 8 khoa `twin3d.line.*` + 19 `twin3d.may.*` chi co
`defaultValue` vi ⇒ them **en/vi/zh** (`client/src/i18n/locales/`); `DanhSachMay.tsx` `${giay}s` ⇒ tuoi doc duoc
(dung `trangThaiHienThi`/ham tuoi co san); chuoi ky thuat `twin/modelRegistry.resolveModel(…)` (nhan "nguon" cockpit,
`assetCockpitService.ts:30`) khong ra UI; "1 machines" so nhieu; `lyDoMoManLine` FORBIDDEN; idle `/twin` do; le
`khopKhungNhin`. **Dot 37 — QA lai bang `pdca`** (agent doc lap, khong sua ma) tren harness 41 ca Dot 32 + E1–E9 +
K1–K9, ca hai viewport, ba vai.

### 14q.14 DOT 36 - PARETO #8 i18n + CON MO - DAT; PARETO DOT 32 DONG 9/9

`a2c3e53d`, **7 commit** pathspec. Chu du an do lai: twin3d **87 tep / 2.312** · `vitest run twin` 109/2.565 ·
`check` 0 · `build` 0 · **`i18n:check` exit 0** (0 NEW missing; 339+20 no co truoc dong bang) · 5 anh nguyen · DB
truoc = sau · 3036 tat · cay + index sach. Anh en man May tu xem: "Health 61 % · warning" · "OFFLINE" ·
"Disconnected" · "Updated 54 days ago" — nhat quan.

| I | truoc | sau | go va |
|---|---|---|---|
| I1 dong UI co dau o en/zh (twin/line/may) | **8/2/2** | **0/0/0** (vi doi chung 150/42/53 — bo do van keu) | 6/2/2 |
| I2 `tuoi-14` | `4738076s` ×39/42 | "54 days / 54 ngày / 54 天", `data-giay` giu so tho | ×39 |
| I3 chuoi ky thuat | may **3** (`model3d.source`, `health.source`, `oee.source`) | **0/0/0** | 3 |
| I4 so nhieu en | "1 machines" ×12 | "1 machine" ×12 | ×12 |
| I5 idle `/twin` | **137 khung/40 s** theo dot 8–36 (tween theo tham chieu) | **12/40 s**; keo 28 | 137 |
| I6 FORBIDDEN tren Line (user tam chi `analytics_oee` + gan SIM-FAC, overview **403**) | `lyDo=null`, canvas 1, "Machines 12" | `thieuQuyen` 1,3 s, **0 canvas, 0 dai tram** | canvas 1 |

Hoi quy E1–E9 + K1/K5/K7: **0** (`hoi-quy-cuoi/`).

> #### ★★ G108 - **LUOI CO SAN DANG DO TAI HEAD MA KHONG AI CHAY = KHONG CO LUOI**
> `npm run i18n:check` **exit 1 tai `89787b25`** (44 NEW missing-in-all) — script roi, khong nam trong `check`/`build`/
> vitest ⇒ 35 dot qua **khong dot nao chay**. Toi brief "luoi i18n co san = `viStringCoverage`" — sai: cai do **mu khoa
> vang ca ba locale**. ⇒ Cong dong phien tu Dot 37: **`i18n:check` exit 0** la mot hang bat buoc, ngang `check`/`build`.
> Va: **manh moi sinh khoa moi** — toi dem 8+19 = 27 tu hai tep; that **44** (14 khoa `vanHanh` cua 4 manh Dot 33–35 +
> 2 `daiHopNhat` + 1 `studioUi` + …) + 10 khoa mau `coCheGiao` cong cu mu. Dem khoa thieu bang **cong cu**, khong bang
> hai tep minh nho.

**Brief sai them (lan 11):** chuoi ky thuat khong chi `model3d` — `health.source`/`oee.source` cung lop
(`MachineCockpit.tsx:951/997`) · FORBIDDEN **tao duoc** (nav `/twin` = `analytics_oee` HOAC `machine_status`; `overview`
doi `machine_status`) — va co **nua thu hai chi anh bat**: dai tram + WIP van bay duoi "Cannot open line" ⇒ `a2c3e53d` ·
regex I3 `twin\/` khop `href="/twin/line/2"` (1 duong gia trong HTML; so text moi dung) · idle `/twin` theo **dot**, khong
lien tuc nhu Line.

**Con mo:** `nhungTaiCho.ts:372` cau `thieuQuyen` "…to be assigned a factory" **sai cua** cho ca thieu quyen module (da
gan nha may) — dung chung TwinMay, chua tach · idle `/twin` du 1–4 khung/nhip lam moi (tang kit `LoBatchMay`/`LopNhan`
invalidate theo tham chieu `mayVe`) · zh **53/53 dich**, 7 khoa chua chac nghia (`may.hang.theoDoi`=关注,
`may.hang.hetHan`=已过期, `vanHanh.moTwinStudio`, 4 cau dai) + thuat ngu lech co san "设备/台设备" vs "机台" ·
`TwinVanHanh.tsx:2545–2565` object `defaultValue` `coCheGiao` thua (hinh-dang-3 34→10 neu go) · o *Live state* cockpit in
`Status: online` (log status tho) canh "Disconnected" — **hai tu vung** tren mot the (NT-3, `khoTrangThai hopNhat`) · thong
bao loi server chi vi trong console · vo shell vai chi `analytics_oee`: "Production (MES)" **0 muc nav** (ngoai twin) ·
`khopKhungNhin` le bat doi xung (khong lam).

**Pareto Dot 32: 9/9 DONG** (#1 Dot 34 · #2 #3 #9 Dot 33 · #4 #5 #6 #7 Dot 35 · #8 Dot 36). **Dot 37 — QA LAI TOAN BO
bang `pdca`** (agent doc lap, khong sua ma): 41 ca Dot 32 doi chieu ket cuc cu → moi, K1–K9, E1–E9, I1–I6, hai viewport,
ba vai + user tam 0 quyen + vai chi `analytics_oee`, en/vi/zh, dot bien nhip an toan, DOM canvas, bbox nhan, 14+6
redirect, tenant, QD-18 hai chieu, mui gio (msl tam), may song (hb tam), andon tam, D-3 duong di that, **nghiem thu thi
giac** ca 4 man × 2 vp — xep hang van de con lai cho chu so huu quyet.

### 14q.15 DOT 37 - QA DOC LAP LAN 2 (skill `pdca`): 9/9 DONG THAT - VA MOT LOI HIEU NANG LON CHUA AI DO

Tep tho `.qa-dot37/` (145 json · 175 png · 4 webm). **Khong sua ma.** Chu du an do lai: HEAD `e47c713d`, cay + index
sach, 5 anh nguyen, DB `2·82·37·42·10·7·hb 108·msl 7.814` truoc = sau (+10 `audit_logs` WORM: dang nhap harness + 1
ack that — khong xoa duoc, khai ro), 3037 tat. **Anh tu xem**: `/twin` 1280 vi — thanh cong cu tran phai ("Xuo"),
the Chi so de canh, nhan chong nhau, panel phai trong, nut chat de timeline; canh 3D con ~490 px.

**MSA (Buoc 0) — thiet bi do bi bac/sua trong phien:** dist cu hon commit ⇒ build lai ⇒ **cung hash** `index-HGBxLCtW.js`
(Vite tat dinh) ⇒ nghi van bac bang do · 3001/3008 phuc vu **dung hash `_twin_wt/dist`** ⇒ phien khac chay tu worktree
nay · CORS ×2.545 "Blocked" **chi log roi cho qua** (`index.ts:245-247`) · **harness raised Dot 32 khong co `finally`**
⇒ khi chu du an nham "D-1 chet" (vong cho theo cmdline thoat oan — G109), QA chay raised lan hai **chong len** lan mot ⇒
a3/a4 do khong co hang; xu ly: cho theo **PID cha**, doi ten thu muc hong `…-CHONG-NHAU-VO-HIEU/`, do lai voi `trap
EXIT/INT/TERM` · user tam role `supervisor` **login 401** (role `user` duoc 200) — chua ro ⇒ ack do bang `engineer1` that ·
QA tu sai mot lan: grep bi `head -20` cat ⇒ suyt ket luan "server khong co hang" (co o `trangThaiMayTuoi.ts:63`).
**Chi so × ca duong da keu:** canvas DOM vs `__soCanvas` keu o tab "3D model" (2/1) · `lopTrungCanvas` nen Dot 32 keu 6/12
· `demKhungIdle` keu 20/32 o May · `waitForFunction` doi chung truot 2/2 · bo do chu Viet vi 150/42/53 · dot bien
`TRAN_NHIP` 3 do · server `NGUONG 5→6′` **1 do** (chi test ghim dang thuc) · client `NGUONG_CU_MS` 6 do.

**D-1 · 48 ca Dot 32 cu → moi** (`tomtat-D1.mjs`; bang goc "41" khong co tep phan quyet ⇒ tai dung 48):
| | DAT | SAI | CHAN-DUNG | N/A |
|---|---|---|---|---|
| Dot 32 | 16 | 26 | 5 | 1 |
| **HEAD** | **38** | **4** | 5 | 1 |
SAI con lai 4: Live state `Status: online` canh `Disconnected` (cu **DAT gia** vi hai chu tinh co khop) · tab "3D model" 2
canvas DOM (G99 con) · idle **man May** 4/0/11/0/9 khung/2 s (cu 1/5/16/0/0 — **co san, chua ai gan co**) · chi bao ket
noi `/twin` "Waiting…" 9–10 s.
**D-2** K1–K11 **8/8 @1600 + 4/4 @1280**, E1–E9 DAT hai vp (tru E7 duoi 3 khung, E3 1280 cuon ngang), I1–I4/I6 DAT,
**I5 SAI** (`/twin` idle 0/3). **D-4** may 14 **6 be mat** (khong phai 4): gate nhip tim **dung** (hb `now()` ⇒ may
`stopped` song: overview `idle`, cockpit `connected:true`, chip "Stopped 11 s"); con lech: **`anhLichSu` replay theo log**
(`running 3,2 d` khi live `offline` 54 d; msl `now()` ⇒ `running 1 s`) · **hai tu vung** `stopped` (twin) vs `idle`
(fleet) · Live state `Status` = log tho. **D-5** duong di that co video: bam Line **14/25 ms**, bam may **3/17 ms**, F5,
Back ×2, deep-link — **DAT 2/2 vp**; raised tam ⇒ Line 9 nut canh bao, chip "2 alarms out of view"; **ACK that**
(`engineer1`): "Da xac nhan", DB `acknowledged`, MTTA 12 s ⇒ **DAT**. **D-6** (trung vi 2 lan): toi canvas `/twin`
1.302 ms · Line 1.163 · May 1.686 · studio 1.346; long task max 80–163 ms; draw 5/6/5/3; **40 s dung yen: `/twin` 16 ·
Line 16 · May 193 · studio 0**.

**Pareto loi MOI:**
| # | Goc re | Do | `file:line` |
|---|---|---|---|
| 1 | **Man May tween camera ve CUNG cho moi ~10 s** — `mucTieu` phu thuoc `mayVe` (tham chieu moi moi nhip) ⇒ `khungNhin` doi tuong moi ⇒ `DieuKhien` effect khoi dong tween | **143–230 khung/40 s**, camera khong doi; **va thu** khuon `khoaKhungNhin` cua Line ⇒ **10**, hoan nguyen ⇒ 143. Chan socket ⇒ 230, chan tRPC ⇒ 107, chan ca hai ⇒ 114 ⇒ trigger **noi tai** | `TwinMay.tsx:445` `mucTieu` · `:512` `khungNhin = useMemo(…,[camUrl, mucTieu])` · `cuaVaoTwin.unit.test.ts:153/171` **chi ghim LINE + NHA_MAY, khong ghim MAY** |
| 2 | Hop dong thu hai: replay theo log ≠ live theo nhip tim + hai tu vung `stopped`/`idle` | D-4 | `server/db/twinCanh.ts:1335-1367` · `khoTrangThai.ts:185-199 hopNhat` · `trangThaiMayTuoi.ts:145` |
| 3 | Live state `Status` in log tho (`online` tone success) canh Connection `offline` (error) | 4/4 luot, anh vi 2 vp | `MachineCockpit.tsx:935` ← `assetCockpitService.ts:534` · `StatusBadge.tsx:37/45` |
| 4 | RB-4/G99: tab "3D model" dung `<Canvas>` ngoai `KhungCanh` | a4 2 vp | `MachineCockpit.tsx:281` `Model3DPane` |
| 5 | Trang cuon doc **24 px** Line/May/studio (2 vp; `/twin` khong) — `<main>` vua, document 924/900 | 3 man × 2 vp | `chieuCaoTruDinh`/`--twin-*-top` thieu tru padding day vo (chua ghim dong) |
| 6 | "Waiting…" toi 10 s: broadcaster chi phat theo interval, khong phat khi subscribe | 2/2 lan | `socket.ts:1576-1730` |
| 7 | Line 1280 dai tram cuon ngang 25 px, ten tram cat, chip "con 5 ten bi an" | E3 | `DaiLine.tsx` / `TwinLine.tsx:1047` |
| 8 | Ngan Mo phong Line co nhung `nhip_het_han` (cua 8 h G30, `line_balance_metrics` cu) | K11 | du lieu, khong phai ma |
| 9 | Ngoai twin: `/factory-command` nhan chong dong, `khoi-canh-3d` day 904 > 900 | a10 | — |

> #### ★★★ G110 - **VA MOT LOP LOI O HAI MAN MA KHONG QUET MAN THU BA** = G98 lap lai o chieu nguoc
> Dot 35 va tween-theo-tham-chieu o **Line**, Dot 36 o **`/twin`**; **man May** cung lop, cung kit, **khong ai do** — du
> a4b Dot 32 **da ghi 16 khung/2 s** va ket cuc "idle ≤ 2 khung/4 s" nam trong brief Dot 35/36. Lưới `cuaVaoTwin` ghim
> LINE + NHA_MAY bang **danh sach**, khong bang **bat bien "moi man dung `CanhVanHanh`"** (dung lop L-1 Khoi D: danh sach
> thay vi bat bien). ⇒ Khi va mot lop loi: **liet ke moi noi cung kit** (grep chỗ goi `DieuKhien`/`CanhVanHanh`) va do
> tung noi; ghim bang bat bien tren tap ay, khong bang hai ten.

> #### ★★ G111 - **HARNESS TAO HANG TAM PHAI CO `trap EXIT/INT/TERM`**; "DAT gia" khi hai chu tinh co khop
> Harness raised Dot 32 khong co finally ⇒ chet giua chung de hang. Va Live state `Status: online`/`Connected` o Dot 32
> duoc cham DAT vi **hai chu tinh co cung sai** — mot ca "DAT" chua bao gio la bang chung neu khong co doi chung.

**D-7 · NGHIEM THU THI GIAC (vi, 4 man × 2 vp) — xep hang cho chu so huu:** (1) May: "Trang thai: online (xanh)" ngay
duoi "Mat ket noi" (do) = Pareto #3 · (2) Line: **nua duoi canvas trong** (`khopKhungNhin` le) · (3) Line 1280 dai tram
cuon ngang, ten cat · (4) `/twin` 1280 **thanh cong cu tran phai** ("Xuo"), breadcrumb cut · (5) `/twin` 15 nhan "Khong
ro" chong o tam, chip "con 30/39 ten bi an", KPI de canh, **panel phai 320 px trong** khi chua chon · (6) **nut chat noi
(vo app) de noi dung** ca 4 man · (7) cuon doc 24 px · (8) May 1280 canvas 259 px thap, "TAO VIEC" rong · (9) `/twin`
panel trai "Ton dong >24h" bi tab cat · (10) studio 1280 minimap ~40 % canvas. **Dat ve mat:** Line 1600 12/12 mot
hang; May 1600 324/451; 0 chu Viet o en/zh; "Khong ro · 54 ngay" nhat quan.

**Con mo QA noi thang:** `/twin`/Line 1–5 khung moi goi 10 s ⇒ tieu chi "≤ 2/4 s" truot ngau nhien theo pha — **doi
tieu chi sang cua so 40 s** (May sau va ky vong ≤ 12) · user tam `supervisor` 401 chua tra · "Failed to fetch" ×12 D-1
chi suy luan (D-6 context moi 0 loi) · G104 ngoai twin chua do · `robot_telemetry` +2 hang/s do mo phong trong server.

**Ke hoach:** **Dot 38** — va Pareto moi **#1 → #7** (ky thuat, tu quyet): #1 `khoaKhungNhin` cho May + bat bien MAY
trong `cuaVaoTwin` · #2 mot tu dien (`hopNhat`/`mapMachineStatus` cung nhan; `anhLichSu` gate nhip tim hoac nhan "su
kien log") · #3 Status suy tu `connected` · #4 Canvas tab 3D qua `KhungCanh` hoac unmount canh twin khi tab mo · #5 tru
padding day, e2e `scrollHeight === innerHeight` · #6 phat `twin:trangThai` khi subscribe · #7 Line 1280 `ol.scrollWidth
≤ clientWidth`. Tieu chi idle: **cua so 40 s** ≤ 12 khung moi man. **Cho chu so huu quyet** (thiet ke, khong phai ky
thuat): D-7 (2) le Line · (4)(5) bo cuc `/twin` 1280 + panel phai trong · (6) nut chat vo app · (10) minimap studio.
**Dot 39** — QA lai `pdca`.

### 14q.16 DOT 38 - PARETO QA DOT 37 #1→#7 - DAT (P1 May 179→14, chua toi 12); BRIEF SAI LAN 12

`a6a0459b`, **5 commit** pathspec. Chu du an do lai: twin3d **89 tep / 2.344** (+2, +32) · `vitest run twin` 111/2.600 ·
server 4 tep/65 · `check` 0 · `build` 0 (tat dinh) · `i18n:check` 0 · 5 anh nguyen · DB truoc = sau · 3038 tat · cay +
index sach. **Hoi quy 39 ✓ / 0 ✗** (K 12/12, E hai vp — **E4 12/12 nhan ca hai vp**, I 6/6).

| P | truoc | sau 1600 / 1280 | go va (dist) |
|---|---|---|---|
| P1 40 s dung yen May | **179** (QA 143–230) | **14 / 15**; /twin 12/14; Line 15/16; studio 0; camera khong doi; keo ⇒ 42–60 khung | TwinMay ve nen ⇒ **238**, camDoi=true |
| P2 mot tu dien | `anhLichSu` 14 `running 3,2 d`; hb tam ⇒ twin "Stopped" vs fleet `idle` | `anhLichSu = offline/55 d`; hb tam ⇒ overview `idle` == /twin "Idle 6s" == chip == ngan; msl tam ⇒ van `offline` | ⇒ `running/3,3 d` quay lai |
| P3 Status | `online` success duoi "Mat ket noi" | `offline` error (2 vp); hb tam ⇒ `online` | ⇒ `online`/success |
| P4 canvas tab 3D | DOM 2 / kit 1 | **1/1** moi trang thai, tab nhung hien ghi chu | ⇒ 2/1 |
| P5 cuon doc | 924/900 · 744/720 ×3 man | 900/900 · 720/720 (`--twin-*-top` +24: `pb-24` cua `<main>` bi `md:p-6` de) | ⇒ 924/900 ×3 |
| P6 "Live" | 8.944 / 9.781 ms | **1.506 / 1.091** @1600 · 999 / 972 @1280; `intervalMs = 10000` ghim | ⇒ 10.226 / 9.791 |
| P7 Line 1280 | ol 969/944, chip "5 ten an" | ol **944/944**, 0 ma cat, chip null, **12/12 nhan** | ⇒ 969/944 + 5 an |

Ablation unit 8/8 (go ⇒ do 7·10·5·1·1·3·2·4, khoi phuc ⇒ xanh, md5 khop) + dist 6/6 + build cuoi tu nguon khoi phuc **cung
hash** va xanh lai; `git diff`/`--cached` rong sau moi buoc. e2e moi `twin-dot38-nghiem-thu.spec.ts` 6/6.

> #### ★★ G112 - **SO DO TU VA-THU KHONG PHAI TIEU CHI** - P1 May "≤ 12" tu va-thu 10 cua QA la **uoc luong**
> Sau khi khoa `khungNhin` (tween tat that: go ⇒ 238), phan du **14–15** khong phai tween: bang tuong quan
> (`tuong-quan-may-1600x900.json`) 14/15 khung xuat hien ≤ 30 ms sau mot phan hoi tRPC (`andon.active` 20 s ·
> `anToanRobot` 20 s · `overview+sucKhoeMay` 30 s · `machineDetail` 10 s) hoac goi `twin:trangThai` 10 s; chan tRPC ⇒ 10.
> Agent go them 3 nguon re-render (`bayGioThat` trong deps, `wip={[]}` literal, `cotWip` moi moi goi 2 s —
> `onDinhTheoGiaTri.ts`, ap ca 3 man) 16–18 → 14–15; nguon `invalidate` con lai **chua dinh danh** (ung vien
> `LoBatchMay.tsx:181,202`, `LopNhan.tsx:287`). ⇒ Tieu chi hieu nang phai **doc tu co che** (moi nguon re-render mot
> con so), khong tu mot lan va-thu; phan du cua mot lan va la **cau hoi**, khong phai that bai.

**Brief sai 5 cho (lan 12):** `server/socket.ts` khong ton tai → `server/_core/socket.ts` · #7 "ten tram cat": **0 ma
cat** — that la `li` bi ep co nen o **de len mui ten**; "5 ten an" goc re **khong phai be rong**: hang nhan @1280 nam
**ngay duoi panel Metrics** (vung cam) ⇒ 3 nhan trai khong co tang phia tren; nhan chua tung ve nhan
`RONG_SUY_DOAN_PX = 150` ⇒ tu khoa · #2 `hopNhat` **khong phai cho sua**: goc `traTrangThaiHangLoat.trangThai =
operationStatus` tho + `BANG_MAU` thieu `idle/offline` ⇒ **nen overview da roi `khong_ro` cam** roi "lat" khi goi toi
(chua ai do) · #5 dung nguyen nhan, do them `pb-24` bi `md:p-6` de.

**Con mo:** P1 du 14–15 (nguon `invalidate`) · `TwinVanHanh.tsx:~1128 vienSucKhoeCanh` deps `bayGio` chua on dinh ·
`MachineCockpit.tsx Model3DCanvas` `<Environment preset="warehouse">` (RB-5 CDN, ngoai twin) · Line badge canh bao 3D in
ma day du canh nhan ngan (anh vi 1280) — cho chu so huu · `LICH_SU_LA_XAP_XI` chua hien UI · D-7 (2)(4)(5)(6)(10) cho chu
so huu — **chua co tra loi**.

**Dot 39 — QA lai lan 3 bang `pdca`** (doc lap, khong sua ma): 48 ca + K/E/I/P, hai vp, ba vai + 2 user tam, en/vi/zh,
bat bien, 6 be mat may 14 + may song + may stopped song, duong di that, hieu nang cua so 40 s (doc tu co che: dem
`invalidate` theo nguon), thi giac 4 man × 2 vp. Sau do: **bao cao tong ket cho chu so huu** + cho quyet D-7.

### 14q.17 DOT 39 - QA DOC LAP LAN 3: 48 ca **41 DAT · 0 SAI** - NGHIEM THU CHUC NANG DUOC; MOT LO TENANT NGOAI TWIN

Tep tho `.qa-dot39/` (184 json · 199 png · 4 webm). **Khong sua ma.** Chu du an do lai: HEAD `2eb00e4c`, cay + index sach,
5 anh nguyen, DB truoc = sau (+10 `audit_logs` WORM khai ro), 3039 tat. **D-1 ba cot:** Dot 32 **16 DAT/26 SAI** → Dot 37
37/3 → **HEAD 41 DAT · 0 SAI · 5 CHAN-DUNG · 2 N/A**. 4 ca SAI cua Dot 37 nay DAT (Live state · tab 3D 1/1 · idle May ·
"Live" 7 s). K 12/12 · E/I/P DAT hai vp · **dot bien 4/4 DO** (TRAN_NHIP 3 · NGUONG server 1 · NGUONG_CU 6 ·
`intervalMs` 1) · QD-18 ma tran **4 URL × 4 vai** (canvas = kit = 1 o 12 tab cockpit + ngan mo phong + 3 tab studio) ·
**6 be mat may 14 mot tu dien** (nen, hb tam, msl tam; cua so 0–10 s **0 lat gia tri**) · duong di co video (bam Line
8/3 ms, may 4/7 ms) · ACK `engineer1` MTTA 40 s · 40 s dung yen: `/twin` 12–15 · Line 14–18 · May 13–16 · studio 0.

**MSA — 6 lan thiet bi tu bac trong phien:** bo do nhan `/SIM-L2-AOI/` **mu sau P7** (nhan nay `AOI · Unknown`) ⇒ suyt bao
hoi quy #46 · `bon-nguon` doc `hangTrangThai` bang selector **con** ⇒ luon null · chu ky rAF chi khop `index-*.js` ⇒ phan
tich lai ngoai tuyen · P6 @1280 2.702 ms khi chay node song song (G97) ⇒ do lai mot minh, **cold-load dau tien 2,5–6,3 s
la bundle** ⇒ tieu chi P6 doc tu co che (`chua_ket_noi→truc_tiep` ≤ 241 ms) · `tasklist` khong thay PID MSYS ⇒ cho theo
tep cuoi (G109) · **"supervisor 401" = loi harness Dot 37**: `permissions.category="machines"` khong co trong enum (dung
la `analytics`) ⇒ transaction rollback ⇒ user chua tung ton tai.

**Dinh danh nguon khung (doc tu co che, hook rAF + React devtools hook, `nguon-khung/`):** 100 % khung co commit R3F ≤
400 ms truoc; ba duong: (1) **R3F `rootStore.subscribe ⇒ invalidate`** 9–15×/man vi `<Canvas dpr gl={{…}} camera={{…}}
onCreated>` **literal moi render** (`loi/KhungCanh.tsx:275-297`); (2) reconciler `applyProps` 3–6×: `CanhVanHanh.tsx:253-259`
mesh/grid literal, `KhungCanh.tsx:142` `directionalLight position={viTriDenHuong}` (default `[40,60,25]` `:256` moi moi
render), drei `<Html calculatePosition>` `LopNhan.tsx:312-314`, `instancedMesh args` (Line 38×); (3) `/twin`
`VienSucKhoe` `CanhVanHanh.tsx:449` effect `[vien]` ⇒ `invalidate()` vi `vienSucKhoeCanh` deps `bayGio`
(`TwinVanHanh.tsx:1123-1135`). **`LoBatchMay:171/202` khong trong stack; `LopNhan.tsx:287` khong co `invalidate(`** —
brief sai. DOM: May **99 commit/40 s** (`cockpit-2d` `div{style}` 1.174 lan — Radix Tabs), `/twin` 75, Line 93. Tieu
chi tu co che: moi nguon refresh 1 khung ⇒ May ≈ 13, `/twin`/Line ≈ 9.

**Pareto moi:**
| # | Goc re | Bang chung | Thuoc |
|---|---|---|---|
| 1 | Vai chi `analytics_oee` (thieu `machine_status`): **3 man noi 3 kieu** — `/twin` "—" cam, Line forbidden that, **May ve canvas + cockpit "Machine not found"** (that la 403) | `qd18/D-*.json` | ky thuat |
| 2 | **API khong rao tenant/gan**: `factoryCommand.overview(18)` 200/1 va `overview(1)` 200/41 cho **operator1 0 gan**; `assetCockpit.machineDetail(257)` 200 identity may nha may khac. Chu du an do: `factoryCommandRouter.ts` **0** / `assetCockpitRouter.ts` **0** tham chieu `phamViCua`/`trongPhamVi` (twinCanh 36) | `qd18/B-*.json api.overview1 soMay 41` | **an toan du lieu** — va `/twin` tu Dot 34 lay KPI/trang thai **qua chinh** `factoryCommand.overview` |
| 3 | `anhLichSu` `running` cho may stopped-song (`LICH_SU_LA_XAP_XI` `twinCanh.ts:1324` chua hien UI); `liveState.status` tho | `bon-nguon/hb-M14.json` | ky thuat |
| 4 | Hieu nang du: literal props moi render + `bayGio` trong deps; DOM 75–99 commit/40 s | `nguon-khung/*.json` | ky thuat |
| 5 | Nhay DOM: hang may `/twin` / o tram Line **remount ~250 ms** 1 lan luc 1,3–3,7 s (6/12 lan) | `cua-so-som/*.json` | ky thuat (nho) |
| 6 | Cold-load deep-link 2,7–6,3 s — bundle, khong phai broadcaster | `duong-di/*/duong-di.json` | ngoai twin |
| 7 | Quan tinh OrbitControls sau keo @1600: 28 khung/4–8 s (`duoiTat:false`) | `E/e7-*.json` | quan sat |

> #### ★★★ G113 - **"MOT HOP DONG" DI QUA ROUTER CHUA RAO** - nguon su that moi cua twin la API khong co tenant scoping
> Dot 14/15/24 dong tenant leak o `digitalTwinRouter`/`maintenanceRouter`/`andonRouter`; Dot 34 doi nguon trang thai ba
> man sang `factoryCommand.overview` — **chua ai kiem router ay co rao khong** (0 tham chieu). UI twin che duoc (EmptyState,
> K9), nhung **du lieu van lo qua API**. ⇒ Khi doi nguon su that, **kiem scope cua router moi** nhu kiem hop dong; cong
> QA co hang "API × vai 0 gan ⇒ []/403" cho **moi** router twin doc. Khong nghiem thu bao mat du lieu toi khi vá va do
> lai o router.

**D-7 thi giac:** (1)(3)(7) **het**; con (2)(4)(5)(6)(8)(9)(10) cho chu so huu; **moi**: (11) May thanh tab cockpit cat
("Tru…"/"Canh b…") khong chi bao cuon · (12) May 1280 the "Mat ket noi" gay 3 dong · (13) studio 1600 canvas chi 726×373
(41 % cao) vi khoi tieu de ~260 px.

**D-8 ket luan QA:** *"chon Line → Line 3D, chon may → Machine 3D"* **DAT co so** (3–8 ms, Back/F5/deep-link, 24/24
redirect, ba man ba URL mot canvas, QD-18/23/24); **nhanh** (canvas ~1,3 s, 0–18 khung/40 s, draw 3–6); **truc quan** (mot
tu dien, 12/12 nhan, 0 cuon, i18n 3 ngon ngu). Chua dat ky thuat: #1 #3 #4 #5. Ngoai twin: #2 tenant API, cold-load,
`Environment` CDN. Cho quyet thiet ke: 8 muc. **Nghiem thu chuc nang duoc; "dep" cho quyet; bao mat du lieu CHUA.**

**Brief sai 7 cho (lan 13):** `LoBatchMay` o `loi/`, invalidate `:171,202` · `LopNhan.tsx:287` khong co `invalidate(` ·
supervisor 401 = enum harness · script Dot 38 ghi cung `.qa-dot38/` (G65 qua `--tag`) · `hieu-nang.mjs` ghi de 2 vp ·
`tuong-quan-*.json` o `sau/` · "14+6 redirect" thuc do **26** (+4 giu +2 doi chung).

**Dot 40 (giao tiep, ky thuat — tu quyet):** **(A) #2 tenant API — uu tien 1**: `factoryCommandRouter` + `assetCockpitRouter`
moi read procedure scope theo khuon `twinCanhRouter` (`phamViCua`/`trongPhamVi`, `user_factory_assignments` join
`factoryCode`, admin bypass nhu cac router khac); test API 2 vai × 2 nha may ⇒ []/403; hoi quy K/E/I/P + `/factory-command`
+ cockpit. **(B) #1** May gate nhu Line (FORBIDDEN ⇒ `thieuQuyen`, 0 canvas), `/twin` "—" ⇒ cau ly do. **(C) #3**
`liveState.status` anh xa; `anhLichSu` gate nhip tim hoac nhan "su kien log" khi `LICH_SU_LA_XAP_XI`. **(D) #4** memo
`gl/camera/onCreated`, hang module `[40,60,25]`, hoist literal mesh/grid/Html, bo `bayGio` khoi deps ⇒ cong **so commit
R3F/40 s** (May ≤ 13, `/twin` ≤ 9) do bang `nguon-khung.mjs`. **(E) #5** remount 250 ms neu dinh danh duoc. **(F)** test
hanh vi broadcaster (fake timers) thay `SRC.toContain`. Sau do **Dot 41 QA lan 4** + bao cao tong ket.

### 14q.18 DOT 40 - TENANT API DONG + PARETO QA DOT 39 #1 #3 #4 #5 - DAT; COMMIT R3F/40 s = 0

`060dee97`, **5 commit** pathspec. Chu du an do lai: twin3d **91 tep / 2.354** · `vitest run twin` 114/2.621 · server 13
tep/244 · **luoi tenant `factoryCommandAssetCockpitPhamVi.db.test.ts` 22/22** (chay doc lap) · `check` 0 · `build` 0 ·
`i18n:check` 0 · 5 anh nguyen · DB truoc = sau · 3040 tat · cay + index sach · `git ls-files --eol` moi tep `i/lf`, **0 tep
nhi phan** · `factoryCommandRouter` **7** / `assetCockpitRouter` **6** tham chieu scope (truoc 0/0) · tep tho `qd18/B`:
operator1 `overview(1|18)` **soMay 0/0**.

| T | truoc | sau | go va |
|---|---|---|---|
| **T1 tenant** (5 thu tuc: `factoryCommand.{overview,machineDetail}` + `assetCockpit.{machineDetail,robotDetail,machineAlarms}`) | operator1 41/1 may, `machineDetail` 200 | **0/0**, `machineDetail` **404 NOT_FOUND** (khuon Dot 14/15/24, G82 — **khong** 403 nhu brief); `e2e_tai_loE` `overview(1)` 41 giu, `overview(18)` 1→**0**, `machineDetail(257)` 404; C 403; admin bypass; robot mo coi fail-closed; `operator1` `/twin` EmptyState, 0 loi 500 | service ve HEAD ⇒ **12/12 ca (−) do, 10/10 (+) xanh** |
| T2 vai chi `analytics_oee` | `/twin` "—" cam · May canvas 1 `lyDo null` | `/twin` `ly-do-so-trong=thieuQuyen` · Line `thieuQuyen` · May `thieuQuyen` **0 canvas 0 cockpit** (2 vp) | luoi ⑧ do 1 |
| T3 | `liveState.status` tho | `statusMapped` (them, `status` giu) `offline→running→offline` khop `connected` (hb tam); `anhLichSu.laXapXi` + nhan "Replay" khi tua, an khi Live | luoi do 1 |
| **T4 commit R3F/40 s** | May 15 · `/twin` 13 · Line 19 (khung 17/14/18) | **0 / 0 / 0** (×2 lan + dist cuoi); DOM commit 99/75/93 → 86/50/55; keo ⇒ 60/23/34 khung; K7 ✓ | — |
| T5 remount | 6/12 | **0/12** (goc: **doi khoa truy van** `tangIds [] → that` ⇒ `data undefined` mot nhip; `placeholderData=giuKhiCungNhaMay`) | — |
| T6 broadcaster | `SRC.toContain` | test hanh vi (dong ho gia, socket.io gia, `initializeSocket` that) | go phat-khi-join ⇒ 2 do; 10 s→5 s/15 s ⇒ 1 do |

Hoi quy K 12/12 · E 12/12 · I 14/14 · P1–P7 hai vp · `/factory-command` mo voi A (0 5xx) · cockpit A `statusMapped`, B
`khongThay`.

> #### ★★ G114 - **"DINH DANH TU CO CHE" VAN SAI MOT NUA** - literal props KHONG phai nguyen nhan
> QA Dot 39 hook rAF + devtools ket luan "literal `gl/camera` ⇒ `root.configure` ⇒ invalidate". Agent Dot 40 doc bundle
> (`vendor-three:4019:79808`): diem `set` la **`store.setSize`, chay o MOI lan `<Canvas>` render** bat ke prop; mang literal
> tren phan tu three **khong** gay `applyProps` (R3F `is.equ` nong), chi **prop ham inline** moi gay. Hoist literal mot minh
> khong du — can **`memo(CanhVanHanhOnDinh)`** voi 8 prop du lieu ghim theo JSON + 4 trampoline ham ⇒ 0 commit. ⇒ Tuong
> quan stack ≠ co che; **doc bundle** truoc khi va. Va "bo `bayGio` khoi deps" (brief) se **dong bang** phep `het_han` —
> on dinh theo gia tri thay the.

> #### ★ G115 - **1 byte NUL lot vao sentinel ⇒ git coi `CanhVanHanh.tsx` la NHI PHAN** (`060dee97`)
> Sentinel `undefined` cua `khoaGiaTri` viet bang ky tu khong nhin thay ⇒ diff mat, review mu. Sentinel phai la **chuoi nhin
> thay duoc** (`"@undefined"`); cong dong phien them **`git diff --numstat` khong co dong `-\t-`**.

**Brief sai 7 cho (lan 14):** literal props (G114) · `bayGio` deps · `machineDetail` ⇒ 403 (khuon la `NOT_FOUND`) · "cockpit
noi not-found cho 403": o `/machine/14` RouteGuard day vai D di truoc moi truy van, trieu chung chi o `/twin/may/14` (nay
gate truoc mount) · E "nhanh `dangTai`" — goc la doi khoa truy van · harness Dot 39 ghim cung `.qa-dot39/` · khong noi
`phamViDocCensus.test.ts` §3/§5 **da do san** o HEAD (C 472→474, D 1101→1119…; 3 muc `maintenanceRouter` da va chua go).

**Con mo:** `MachineCockpit.tsx:853` nhanh FORBIDDEN chua co ca UI (guard chan truoc) · `twinCanh.ts:1324` `anhLichSu`
van `running` cho may stopped-song (khong co lich su `operationStatus` — chon nhan UI) · `phamViDocCensus` §3/§5 do co san
— cho ben do ky · `server/api/v1/moduleReads`, `aiRcaCopilot.vision` goi `machineDetail()` **khong `scope`** (loi di khong
danh tinh) — chua do · DOM commit 50–86/40 s (Radix Tabs) · `LoBatchMay` handler inline.

**Dot 41 — QA lan 4 bang `pdca`** (doc lap, khong sua ma): 48 ca + K/E/I/P/T, **API × vai cho MOI router twin doc** (G113),
hai vp, bat bien, 6 be mat + hb/msl tam, duong di, commit R3F/40 s doc tu co che, thi giac 4 man × 2 vp, **D-8 nghiem thu
ca bao mat du lieu**. Sau do **bao cao tong ket** cho chu so huu + cho quyet 8 muc thiet ke.

### 14q.19 DOT 41 - QA DOC LAP LAN 4 (NGHIEM THU): CHUC NANG + HIEU NANG DAT CO SO; BAO MAT DU LIEU CHUA - 4 LO NGOAI twin3d

Tep tho `.qa-dot41/` (~230 json · 209 png · 4 webm · 17 log; 17 thu muc). **Khong sua ma.** Agent chet 429 luc tong hop
(`chuoi-XONG.txt` da co) ⇒ chu du an do cay (G95: HEAD `d01ef0f7`, cay sach, DB nguyen, 3041 con — agent tat sau), resume
viet bao cao tu tep tho. Chu du an doi chieu doc lap `api-vai/{B,D}.json`, `http-v1.json` truoc khi bao cao ve.

**D-1 bon cot:** Dot 32 **16/26** → 37 37/3 → 39 41/0 → **HEAD 41 DAT · 0 SAI · 5 CHAN-DUNG · 1 N/A · 1 "xem K"**; doi phan
quyet 39→41: **0**. **D-2** K 12/12 (bam Line 10/2 ms, may 14/7 ms; K6 **26 = 14 cu + 6 moi + 4 giu + 2 doi chung TRUOT**) ·
E/I/P/T hai vp DAT. **D-3** dot bien **5/5 DO** (TRAN_NHIP 3 · NGUONG server 1 · NGUONG_CU 6 · bo phat-khi-join 3 · 10 s→5 s 1),
khoi phuc md5 4/4, numstat 0 nhi phan, 164/164 xanh lai; canvas = kit = 1 o **13 tab cockpit + ngan mo phong + 3 tab studio
× 2 vp**. **D-5** 6 be mat may 14 mot tu dien (nen `offline/4.774.631 s` = cockpit = anhLichSu = /twin = Line = chip; hb tam
⇒ `idle/1 s` = `connected:true` = "Idle 11 s"; msl tam ⇒ van `offline`); cua so 0–10 s **11 tep × 4 be mat: 0 lat**; duong di
video 8–29 ms, ACK `engineer1` MTTA 43 s. **D-6** toi canvas 1,24–1,69 s · **40 s dung yen 0 khung 8/8 · commit R3F 0 o
16/16** — doi chung duong: chen hb giua cua so ⇒ **2 commit R3F + 3 khung** ngay sau goi ⇒ bo dem khong mu · keo 38–60
khung/1,5 s · DOM commit 43–87 (Radix/danh sach).

**D-4 · BAO MAT DU LIEU — 48 thu tuc × 6 vai (A gan NM1 · B 0 gan · C 0 quyen · D chi oee+gan · M monitoring+gan · ADM 0
gan) × NM1/NM18 + socket + HTTP v1 (API key tam khoa `factoryCode=SIM-FAC`):** **rao dung** 5 thu tuc Dot 40 + 20 thu tuc
khac (`twinCanh.*` hinh dang rong `khai: []`/`null`, `dashboard.getMachineStats` `scopeApplied`, `digitalTwin.wipFlowState`,
`maintenance.*`, `machine.checkCapabilities`, `mqttClient.getDowntimeHistory`, `andon.active`) + socket `twin:trangThai` rao
tung socket + phat-ngay-khi-join. **HO 4 loi** (chu du an xac nhan bang ma):

| # | Thu tuc (man goi) | Bang chung | `file:line` |
|---|---|---|---|
| 1 | **`twin.usdExport(1/18)`** (nut "Xuat USD" o `/twin`) | **operator1 0 gan: 200 41.850 B (ma SIM) · 200 1.970 B (ma `T12-SHOT-…`)** — xuat USDA **ca hai nha may** | `twinRouter.ts:316` chi `requirePermission(machine_monitoring)` (alias → `machine_status`), `buildFactoryUsda(factoryId)` → `sceneGraph.ts:210` khong scope |
| 2 | **HTTP v1 `/api/v1/machines/:id/detail`, `/robots/:id/detail`** | API key **khoa SIM-FAC** goi `/machines/257` (NM18) ⇒ **200 identity `T12-SHOT-MC-…`**; khong khoa 401; 999999 404 | `moduleReads.ts:421/433` goi `machineDetail(machineId)`/`robotDetail` **bo `req.apiPrincipal.tenantScope`** du chu ky co `scope?: PhamViNguoiXem` (`assetCockpitService.ts:487`) |
| 3 | **`wip.lineBalance(line 2)`** (`/twin/line` qua `usePhanTichLine`) | **moi vai ke ca C 0 quyen: 16 hang** takt/cycle/bottleneck NM1 | `wipRouter.ts:129` `.query(async ({ input }))` **khong doc ctx**, 0 scope, 0 cong quyen (ban `mesControlTowerRouter.lineBalance` co scope — hai router cung ten) |
| 4 | **`sensor.listTypes/readSeries(m1)`** (cockpit nhung `/twin/may`) | moi vai: 3 loai · 24 diem; UI mac dinh 7 ngay thay `[]` (du lieu 07-15), API `windowHours` mo | `sensorRouter.ts` `.query(({input}))` khong nhan ctx |

> #### ★★★ G116 - **NHUNG COCKPIT/NUT CU VAO MAN MOI KEO THEO ROUTER CU CHUA RAO** - QA 4 dot truoc chi quet router "twin"
> Dot 14/15/24 rao 3 router; Dot 40 rao 5 thu tuc cua **nguon su that moi**; QA Dot 41 la lan dau **liet ke MOI thu tuc bon
> man goi** (grep `trpc.` trong `pages/Twin*.tsx`, `twin3d/**`, cockpit nhung) ⇒ 48 thu tuc, **4 ho** o router cu ma man moi
> **nhung** (`usdExport` nut cu giu lai theo ⛔ khong xoa `DigitalTwinCenter`; `sensor` qua `MachineCockpitBody`; `lineBalance`
> qua hook Dot 27). ⇒ **Bat bien QA**: tap thu tuc man goi × vai 0 gan ⇒ rong/404/403 — la **luoi tu dong** (harness
> `api-vai.mjs` thanh test), khong phai bang tay moi dot. Nhung mot manh cu = nhan ca no cua manh ay.

**MSA:** 6 lan thiet bi tu bac (socket path `/api/socket.io` khong phai mac dinh; `tuong-quan` ENOENT — **khong do lai** theo
G114; heredoc vo 2 lan ⇒ Write; `cong.sh` sed mangle; tomtat thieu cot). Ke thua: a2 harness Dot 32 cho 232 s `ngan-nhung` da
mat loi vao ⇒ N/A. **Brief sai/thieu lan 15 (6):** `aiRcaCopilot.vision` **khong** goi `machineDetail()` (grep toan server) ·
"P6 ≤ 241 ms" do phan giai 250 ms khong chung duoc · `nguon-khung.mjs` chi 3 man · `machine_status` co o ca `analytics` lan
`machine_monitoring` (alias) ⇒ operator1 qua cong `usdExport` · socket path · K6 = 26 gom ca doi chung.

**D-7:** het (1)(3)(7); con cho chu so huu (2)(4)(5)(6)(8)(9)(10)(13); ky thuat nho (11)(12); **moi (14)** studio 1280 minimap
che 3 nut cong cu canvas. bbox canvas 8/8 khop Dot 39.

**D-8 KET LUAN QA:** "chon Line → Line 3D, chon may → Machine 3D" **DAT co so** · "toi uu, nhanh" **DAT** (cold-load bundle
ngoai twin) · "dep, truc quan": mot tu dien DAT, bo cuc **CHO QUYET** · QD-18/19/21/23/24 **DAT** · **Bao mat du lieu: CHUA —
khong nen nghiem thu** cho toi khi 4 lo dong va do lai bang `api-vai.mjs`/`http-v1.mjs`/`socket-vai.mjs`.

**Dot 42 (giao tiep — an toan du lieu, tu quyet):** (1) `usdExport` scope tenant (khuon `phamViCua`, `NOT_FOUND`/rong) + cong
quyen dung; (2) `moduleReads.ts:421/433` truyen `tenantScope` cua API key vao `machineDetail/robotDetail`; (3) `wipRouter.lineBalance`
scope + `requirePermission` (hoac tro sang `mesControlTower.lineBalance` da rao — chon mot, xoa trung); (4) `sensorRouter` ctx +
scope theo may; (5) **luoi tu dong API × vai** tu `api-vai.mjs` (thu tuc man goi × B/C/D ⇒ rong/404/403; A ⇒ NM1 co, NM18
khong; ADM bypass); (6) ky thuat nho (11)(12) neu gon. Sau do **Dot 43 QA lan 5 chi bao mat** (`api-vai`, `http-v1`, `socket`)
+ bao cao tong ket.

### 14q.20 DOT 42 - 4 LO BAO MAT DONG + LUOI TU DONG 115 CA; SU CO TREO = GOOGLE FONTS RENDER-BLOCKING

`d7a6a6c7`, **5 commit** pathspec (agent chet 429/server_error **2 lan**, chuoi nen treo 29′ o p6 — chu du an do cay (G95),
giet dung PID treo, resume tu tep tho; moi buoc de lai `*-XONG.txt`). Chu du an do lai: twin3d **91 / 2.354** · `vitest run
twin` **115 / 2.736** (+1 tep/+115 ca) · **3 luoi tenant 150/150** (`twinBonManApiVaiPhamVi` 115 + `moduleReadsCockpitPhamVi`
13 + `factoryCommandAssetCockpitPhamVi` 22, chay doc lap) · `check` 0 · `i18n:check` 0 · 5 anh nguyen · DB 11 bang + `api_keys`
55 truoc = sau · 3042 tat · cay + index sach · 0 nhi phan · scope: `twinRouter` 3 / `wipRouter` 3 / `sensorRouter` 7 /
`moduleReads` 14 tham chieu (truoc 0/0/0/0).

| Lo | truoc | sau | go va (luoi) |
|---|---|---|---|
| 1 `twin.usdExport` | B 0 gan: 200 41.850 B SIM · 200 1.970 B T12 | B **404/404**; A (1) 200 SIM · (18) **404**; ADM ca hai | 2 do |
| 2 HTTP v1 `machines/:id/detail`, `robots/:id/detail` | khoa SIM-FAC /257 **200 T12** | /257 **404**; /14 200 S; /robots/1 200 S; khong khoa 401; **khoa CHUA KHAI pham vi ⇒ 404** (fail-closed, cung chieu `/ecosystem/kpi`) | 3 do |
| 3 `wip.lineBalance` | moi vai ke ca C 0 quyen: 16 hang | B **0**, C **403** (`requireAnyPermission(analytics_oee\|machine_status)` = nav `/twin`); A/D/M 16 giu | 2 do |
| 4 `sensor.listTypes/readSeries` | moi vai 3 loai · 24 diem | B/C **404**; A m1 co, m257 404 | 4 do |

**Bang D-4 sau va — 48 luot × 6 vai** (`tomtat-D4.txt`): **dung 16 o doi, tat ca thuoc 4 lo; 41 hang con lai 0 doi**; socket
6/6 y het; dau vet T12 o A/B/M **1→0**. Co che moi: `db/hierarchy.ts` **`PhamViMaTenant {tenantScope}` + `PhamViDoc`** (truc ②
cua `resolveTenantFactoryScope`, G12) — `PhamViNguoiXem` **khong bieu dien duoc khoa API** (brief sai). Luoi §0 ghim **42
duong dan `trpc.*`** grep that tu 4 man + cockpit nhung (them `trpc.abc.xyz` gia vao `TwinHub.tsx` ⇒ 3 do).

> #### ★ QD-25 (chu du an) - khoa API **chua khai** pham vi tenant ⇒ **404 fail-closed** (nhu `/ecosystem/kpi`), khong mo.

> #### ★★★ G117 - **UNG DUNG NHA MAY PHU THUOC CDN NGOAI: GOOGLE FONTS RENDER-BLOCKING** — treo p6 29′, a6b HONG 2 vp
> `client/index.html:28-29` `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist…">` — stylesheet
> **render-blocking** tu CDN ngoai, khong co Geist local. Do: `curl fonts.googleapis` 2,06 s / **000 @30 s** / 18,95 s; tien
> kiem 2/6 luot cham tran 8 s; Playwright `goto /twin` **38.073 ms**, `screenshot` timeout voi `document.fonts.status="loading"`
> cho **Geist ×3**; `curl /twin` 3–10 ms; renderer SwiftShader ⇒ GPU vo can; server 0 mau > 30 s. He qua that: **deep-link
> (context moi, khong cache) trang trang toi khi CSS ve** — a6b #25/#26 **HONG ca hai vp** (`tomtat-D1` HEAD 39 DAT · 2 HONG), p6
> lan 2 treo. Khong phai server, khong phai harness, khong phai va Dot 42 (`client/` 0 doi). ⇒ **Nha may thuong khong co
> internet on dinh**: moi `https://` trong `index.html` la mot diem treo. Cung ho RB-5 (`Environment preset` drei tai HDR tu
> CDN — con o `Factory3DScene.tsx:233`, `FactoryFloor3D.tsx:179`, ngoai twin).

> #### ★ G118 - **"THU TUC" ≠ "LUOT GOI"** - brief noi "48 thu tuc"; that: 48 luot goi, grep **42 duong dan** (QA phu ~30,
> goi 5 thu tuc man khong goi, sot `twinCanh.chiTietBanGhi` + 14 mutation). Luoi tu dong phai ghim **tap grep**, khong phai
> tap QA nho.

**Brief sai 10 cho (lan 16):** 48 vs 42 · "ham chuyen tenantScope ⇒ PhamViNguoiXem" khong ton tai · robot 1 co `lineId` NM1
· harness D-2 khong co e4 · khong noi `phamViTuyenCensus` (REST) do san va se bat ban va HTTP · harness ghi cung OUT/3041 ·
S1 la 404 khong "403" · `getMachineStats` than toan 0 cho **moi** vai ke ca ADM ⇒ khong phan biet rao/rong · hook BG-124 chan
`git add` tran · T4/T5 khong co gi do lai.

**Con mo:** `userRouters.ts:87-90` `assignableTechnicians` tra moi user (chi ADM thay; ngoai le trong luoi) ·
`twinRouter.ts:75/89/289/299/361/379`, `wipRouter.ts:46/72/95/173` so no (man twin khong goi) · `moduleReads.ts` 14 tuyen
khac nhom A · `dashboardStatsRouters.ts:75` khong phan biet rao/rong · census 4 assertion drift **co san** (cho ben do ky) ·
`client/index.html:28-29` (G117) · D-7 (11)(12).

**Dot 43 (giao tiep — ky thuat, tu quyet): SELF-HOST FONTS.** `@fontsource-variable/geist` + `@fontsource-variable/geist-mono`
(hoac woff2 vao `client/public/fonts` + `@font-face`), bo `<link>` + `preconnect` googleapis/gstatic/jsdelivr; **cung font, khong
doi giao dien**. Ket cuc: Playwright `route.abort` `fonts.googleapis.com|fonts.gstatic.com` ⇒ 4 man render < 2 s, `document.fonts.check('12px
Geist')` true, `document.fonts.status = loaded`; **a6b #25/#26 DAT ca hai vp voi mang bi chan**; `dist/public/index.html` **0
`https://`**; `tomtat-D1` 48 ca ve 41 DAT · 0 HONG. Harness: `newPage`/`goto` co tran rieng; `route.abort` CDN mac dinh. Sau
do **Dot 44 QA lan 5** (bao mat sau va + fonts + D-1 48 ca) + **bao cao tong ket** cho chu so huu.

### 14q.21 DOT 43 - SELF-HOST GEIST, VO APP 0 TAI NGUYEN NGOAI - G117 DONG; D-1 48 ca 41 DAT · 0 HONG

`636fb183`, **3 commit** pathspec (agent chet 1 lan server_error truoc khi sua ma — resume tu `.qa-dot43/*-XONG.txt`, `npm i`
lan 2 `--legacy-peer-deps` da xong). Chu du an do lai: twin3d **91 / 2.354** · twin 115/2.736 · **3 luoi tenant 150/150** ·
**cong vo app 30/30 + CLI DAT** (`client/index.html` 0 https; `dist/public/index.html` 0 tai nguyen `href/src` https, 31 chuoi
`http(s)://` trong script noi tuyen la chuoi) · `check` 0 · `i18n:check` 0 · 5 anh nguyen · DB + api_keys nguyen · 3043 tat ·
cay + index sach · 0 nhi phan · **30 woff2** self-host (Geist 76.420 B + Mono 70.448 B; trinh duyet vi tai lan dau 4 tep 77 KB)
· `package.json` `build` noi `node scripts/kiem-vo-app-https.mjs` (cong buoc cuoi).

**Bang 2×2 F1** (`tomtat-F1.txt`, 4 man, context moi moi man, DAT = man ≤ 2,5 s ∧ Geist ≥ 1 ∧ loaded):

| dist | thuong | chan (abort) | cham (giu 30 s) | treo (giu 60 s) |
|---|---|---|---|---|
| **cu** `76b4bff6` | 0/4 — `/twin` goto **7,7 s** ×4 luot, 20 request googleapis+gstatic | 0/4 — man 1,0–1,2 s nhung **Geist 0/0 = fallback Segoe/Consolas** | 0/4 — `goto` **timeout 30 s ×4**, man 30,9–31,0 s | 0/4 — canvas **60,9–61,5 s** |
| **moi** `636fb183` | **4/4** 1,05–2,27 s | **4/4** 1,05–1,17 s, `faceGeistLoaded 3` (latin, latin-ext, vietnamese) + Mono 1 | **4/4** | **4/4** — **0 request ngoai** o 11/11 phien |

- **F2** D-1 48 ca (mang chan): `✓35 ✗0`; `tomtat-D1` HEAD **41 DAT · 0 HONG · 0 SAI** — **#25/#26 HONG→DAT** (a6b deep-link
  `/twin/line/2`, `/twin-studio` ca hai vp vo "Production (MES)"). **F3** p6 @1600 ×2 mang chan **961 / 768 ms** (Dot 42 treo 29′).
- **F4** 5 neo × 4 man: lech **0–1 px**, `fontFamily` trung; **pixel vung chu truoc (Google) / sau (tu phuc vu) 0,00–0,03 %**,
  doi chung duong Google vs fallback **5,9–26,8 %** ⇒ phep do thay duoc doi font; mat khong phan biet duoc. Giao dien **khong doi**.
- **F5** bundle +149.881 B; CSS +3.225 B.
- Hoi quy D-2 K/E/I + P **ca `chan` lan `thuong`**: `✓39 ✗0 · DAT 60 · TRUOT 4` (4 = `[DOI CHUNG]` co y, trung tung dong Dot 42).
- Ablation: chen lai `<link https>` ⇒ 2 test do + CLI TRUOT; bo `import "./fonts.css"` ⇒ 1 do; tuoc 11 `@font-face` khoi CSS
  phuc vu ⇒ **Geist 0/0, `fonts.check` van true**, TRUOT 0/4 ⇒ khoi phuc md5 khop.
- Co che: `client/src/fonts.css` 11 `@font-face` sinh tu `index.css` cua goi, **giu `unicode-range` tung subset** (trung nguyen van
  CSS Google), doi ho `'Geist Variable'` → `"Geist"`/`"Geist Mono"` (goi variable dat ten khac — import thang **khong** khop
  `--font-sans`), trong luong `300 700` / `400 600`, chi `normal` (Google cung khong phuc vu italic).

> #### ★ G119 - **ba bay thiet bi do trong mot dot**: (1) `route.abort` **khong tai hien** G117 — dist cu van toi man 1,2 s bang
> fallback; dieu kien that la **GIU** request (`cham`/`treo`); (2) `document.fonts.check('12px Geist')` tra `true` khi **0
> `@font-face`** ⇒ mu — chi so chinh la `faceGeistLoaded`; (3) **shebang trong `.mjs` duoc test import ⇒ vite-node boc module
> trong ham ⇒ `SyntaxError` chi vao dong chu thich sai** — bo shebang, CLI qua `node scripts/x.mjs`.

**Brief sai 8 cho (lan 17):** "khong thay tai nguyen tu jsdelivr" — **co**: `vendor-three-*.js` chua
`cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1` (troika cua drei `<Text>`), dung o 4 man **ngoai twin**
(`Factory3DScene`, `FactoryFloor3D`, `CommandCenter`, `DigitalTwinCenter`), twin3d 0 ⇒ agent bo preconnect (chi goi y) — **chu du
an giu quyet dinh nay** · dist con **4** `<link https>` khong 3 · `--legacy-peer-deps` bat buoc · mang hom nay curl 0,44 s nhung
trinh duyet lan dau van 7,7 s ×4 tren dist cu · knowledge/* 26 tep ban do job KB sync 03:00 (co san).

**Con mo:** RB-5 ngoai twin: troika→jsdelivr luc chay (4 man tren) + HDR `Environment preset` (`Factory3DScene.tsx:233`,
`FactoryFloor3D.tsx:179`) · `server/_core/securityHeaders.ts:70-71` CSP van cho phep googleapis/gstatic (siet duoc) ·
`server/_core/vite.ts:58` `express.static` khong `maxAge` ⇒ woff2 bam `max-age=0` · khoi dong lanh server 3,7–6,3 s mot man (0
request ngoai) — do rieng · `packageManager: pnpm@10.4.1` nhung cay cai bang npm, `pnpm-lock.yaml` khong co 2 goi moi · italic
tong hop.

**Dot 44 — QA lan 5 (nghiem thu cuoi, `pdca`, khong sua ma):** 48 ca bon cot + K/E/I/P/T/F, **bao mat sau va** (48 luot × 6 vai
+ HTTP v1 + socket bang `api-vai.mjs`/`http-v1.mjs`/`socket-vai.mjs`), fonts (2×2), bat bien, 6 be mat, duong di video, hieu
nang tu co che, thi giac, **D-8 tung muc DAT/CHUA/CHO QUYET** ⇒ **bao cao tong ket** cho chu so huu.

### 14q.22 DOT 44 - QA DOC LAP LAN 5 = NGHIEM THU CUOI: DAT trong twin; con lai NGOAI TWIN hoac THIET KE CHO QUYET

Tep tho `.qa-dot44/` (**360 json · 341 png · 4 webm · 41 log**; `chuoi-44.sh → sau-chuoi.sh → cong.sh`, moi buoc `*-XONG.txt`).
**Khong sua ma.** Chu du an do lai: cay + index sach, 0 nhi phan, 5 anh nguyen, DB nguyen, 3044 tat, twin3d **91/2.354**, **4 luoi
(3 tenant + vo) 180/180**, `check` 0, `i18n` 0, `tomtat-D1` doi phan quyet 41→44 **0**, `tomtat-D4` dau vet truoc = sau.

**MSA:** HEAD doi `636fb183 → 5094367e` giua hai lenh dau (chu du an commit docs 18:55 — dung nhanh "+1 docs"); **build lai vao
outDir rieng ⇒ 895/895 asset md5 khop**, `dist/public/index.html` lech **1 dong chu thich** (dist dung truoc commit doi ten tep
cong) ⇒ dong bo; `--outDir` tuong doi bi vite giai theo `root=client/` ⇒ ghi vao `client/.qa-dot44/` (da don). 6 lan thiet bi tu
bac: `vitest run twin` 1 do timeout vi chay chong luc server nap GGUF 12,5 s + reranker 14,5 s (chay rieng 15/15) · wrapper nen
bao "killed" nhung PID + mtime con song ⇒ cho theo PID (G109) · `do33` @1280 thoat im lang sau k1 (grep loc stderr) ⇒ chay lai
3/3 · `fonts.check()` mu (Geist 0/0 ma true) · `route.abort` khong tai hien treo (chi `cham`) · census 4 do co san.

**D-1 nam cot:** 32 **16/26** → 37 37/3 → 39 41/0 → 41 41/0 → **44: 41 DAT · 0 SAI · 0 HONG · 5 CHAN-DUNG · 1 N/A · 1 "xem K"**.
**D-2** K 12/12 ×2 mang (K6 = 26) · E 13/13 ×2 · I 14/14 ×2 · P (p6 "Live" 1.000–1.153 ms) · **F1 4/4 o thuong/chan/cham/treo
@1600 + chan @1280**, `faceGeistLoaded` 3 + Mono 1, **0 request ngoai**. **D-3** dot bien **5/5 do**, md5/eol/diff/cached/numstat
sach, nen xanh lai; go 4 va ⇒ **2/3/2/4 do**; `trpc.abc.xyz` gia ⇒ 3 do; chen `<link https>` ⇒ CLI exit 1 + 2 test do + F1 `cham`
**0/4 (goto 30 s ×4)**; tuoc 11 `@font-face` ⇒ Geist 0/0, 0/4. **D-4 BAO MAT:** 48 luot × 6 vai — **0/288 o doi** so voi sau va;
dau vet **A T12=0/SIM=15 · B 0/0 · C 0/0 · D 0/7 · M 0/13 · ADM T12=10/SIM=16**; doc `tho` moi hang B/C `n>0` = hinh dang rong;
A hoi NM18 17 hang: rong/`NOT_FOUND`; socket **B/C 0 goi · A/D/M chi `twin:1` · ADM ca hai**; HTTP v1 khong khoa 401 · khoa SIM-FAC
/14 200 S · /257 **404** · khoa **chua khai** (`dataScopeMode NULL`, nhu 52/55 khoa that): /14 404 · /257 404 · /robots/1 404 ·
`/ecosystem/kpi` **200 rong** (`value:null, available:false`); luoi §0 **grep 42 = ghim 42** (115 tep). **D-5** 6 be mat may 14/18
mot tu dien (hb tam ⇒ `idle`/`running` 1 s; msl tam ⇒ **van offline**); cua so 0–10 s **0 lat** 11 tep × 4 be mat; duong di video 4
webm: bam Line **36/36 ms**, may **20/32 ms**, Back 27–83 ms, deep-link 1,1–1,3 s; ACK `engineer1` MTTA 53 s; T2 vai D 3 man
`thieuQuyen`. **D-6** toi canvas trung vi @1600 twin 1.177 · line 1.267 · may 1.593 · studio 1.508 ms; @1280 1.465/1.272/1.764/1.367;
long task max 72–255 ms; **40 s dung yen 0 khung 27/27**; nguon khung **19/19 luot 0 khung · 0 rAF · 0 commit R3F** (doi chung hb ⇒
2 khung/3 commit); keo 25–55 khung/1,5 s; **khoi dong lanh**: luot 1 sau restart /twin **4.512** · line 2.101 · may 1.301 · studio
3.078 ms — server nap GGUF embedding 12,5 s + reranker 14,5 s len GPU **ngay sau `listen`** (`server-lanh.out.log:173,187`); luot 2
may **10.660 ms** outlier; luot 3 4/4 ≤ 1,35 s; CPU 4–10 %, VRAM 29,7/32,6 GB, 0 request ngoai ⇒ **nguon outlier chua dinh danh**.

**D-7:** het (1)(3)(7); cho quyet (2)(4)(5)(6)(8)(9)(10)(13); ky thuat nho (11)(12)(14); **moi (15)** breadcrumb pham vi tren thanh
cong cu `/twin` cat con "T… › Nha… › T" **ca 1600 lan 1280**; font Geist that 4/4 man; en 0 chu Viet o UI.

> #### ★ QD-25 (sua chu) - khoa API chua khai pham vi ⇒ may/robot **404**; `/ecosystem/kpi` ⇒ **200 rong** (`available:false`) —
> cung huong dong, **khac ma**. Spec §14q.20 viet "nhu `/ecosystem/kpi`" la lech; ma dung, chu sua.

> #### ★ G120 - **"THU DANG CHAY = THU VUA SUA" chung minh bang BUILD LAI VAO OUTDIR RIENG + SO MD5 TUNG ASSET** (895/895), khong
> bang mtime. Va **`vite build --outDir` tuong doi giai theo `root`** (`client/`), khong theo cwd — ghi vao sai cho im lang.

**D-8 KET LUAN QA LAN 5:**
| Muc | Phan quyet |
|---|---|
| Chon Line → Line 3D, chon may → Machine 3D | **DAT** (36/36 · 20/32 ms; Back/F5/deep-link 5/5; 26 redirect ×4; D-1 41/0/5) |
| Toi uu, nhanh | **DAT (twin)** · **CHUA (ngoai twin)**: luot 1 sau restart 4,5 s (AI stack), outlier 10,7 s chua dinh danh |
| Dep, truc quan | mot tu dien **DAT** · bo cuc **CHO QUYET** 8 muc + (14)(15) · (11)(12) **CHUA (ky thuat nho)** |
| QD-18/19/21/23/24 | **DAT** · QD-25 **DAT** (sua chu spec) |
| Bao mat du lieu | **DAT (twin)** — 0/288 o doi, 0 dau vet cheo, ablation 2 chieu · **CHUA (ngoai twin)** 3 thu tuc toan cuc/khong phan biet (`user.assignableTechnicians` ADM 12 user; `orchestration.listWorkflows` 5 ten toan cuc; `dashboard.getMachineStats` toan 0 moi vai) |
| Khong phu thuoc mang ngoai | **DAT (vo + twin)** — 55/55 phien 0 request ngoai · **CHUA (ngoai twin)** troika/HDR CDN o 4 man cu, CSP con googleapis |
**Khong nghiem thu mu**: hieu nang "luot dau sau restart" + outlier thuoc server/AI stack — ghi dieu kien khi ban giao.

**Brief sai/lech lan 18 (5):** `nguon-khung.mjs` da co studio · outlier ca **sau** restart, khong chi ngay sau · QD-25 "nhu kpi" ·
dist dau phien khac HEAD 1 chu thich · "mot minh" — chu du an commit docs vao worktree 18:55 (truoc khi do, khong anh huong).

**Con mo (chu du an tong hop, giao sau khi chu so huu quyet):** (a) **thiet ke** 9 muc (8 + (15)) cho chu so huu; (b) **ky thuat
nho twin** (11)(12)(14); (c) **ngoai twin**: khoi dong lanh/outlier (do tach AI tat/bat), 3 thu tuc toan cuc, CSP siet, `express.static`
`maxAge`, troika/HDR CDN o 4 man cu, census 4 assertion drift, `pnpm-lock` lech; (d) sua chu QD-25 (da sua o day).

### 14q.23 QD-26 - CHU SO HUU DONG Y CA 9 MUC THIET KE (2026-09-11) - DOT 45

Chu so huu: *"dong y 9 muc tieu thiet ke, tiep tuc"*. Dot 45 (skill `frontend-design`, theo yeu cau dung plugin Design): (1) nut
chat noi vo app de noi dung 4 man · (2) `/twin` @1280 thanh cong cu tran + ngan phai 320 px trong khi chua chon · (3) Line nua
duoi canh trong (`khopKhungNhin`, giu E4 12/12) · (4) `/twin` nhan chong ⇒ mac dinh chi nhan bat thuong · (5) studio @1280 minimap
che nut · (6) May @1280 canh 259 px, the gay 3 dong, tab cat (= ky thuat nho 11, 12) · (7) studio @1600 khoi tieu de 260 px ·
(8) `/twin` "Ton dong >24h" bi tab cat · (9) `/twin` breadcrumb cat "T… › Nha… › T" ca hai vp. Rang buoc: giu moi ket cuc DAT
(K/E/I/P/F/T, D-1 48 ca), luoi bbox 2 vp, anh truoc/sau tu xem, ablation, i18n 3 locale, cong vo 30/30. Sau do **Dot 46 QA thi
giac**.

### 14q.24 DOT 45 - 9 MUC THIET KE + 2 KY THUAT NHO (QD-26) - DAT 34/34 LUOI BBOX, 0 DOI PHAN QUYET

`eca90c44`, **12 commit** pathspec (skill `frontend-design` goi truoc khi sua; ke hoach thiet ke: *"canh la nhan vat chinh · moi cum
mot nha cung nha o moi man · khong giau gi ma khong co dau hieu · so that khong doi"*, token cu, 0 font/CDN moi). Chu du an do
lai: twin3d **96 / 2.387** (+5 tep, +33 ca) · twin 120/2.769 · 4 luoi 180/180 · `check` 0 · `i18n` 0 · cay + index sach · 0 nhi
phan · 5 anh nguyen · DB nguyen · 3045 tat · **anh tu xem** 5 man (twin 1280/1600, line 1600, may 1280, studio 1600): ca 9 muc
thay duoc bang mat.

| Muc | truoc 1600 / 1280 | sau | go va |
|---|---|---|---|
| 1 chat de | giao 992–2.304 px² ×4 man ×2 vp | **0** (an ho `/twin*` bang mot vi tu `bongBongTheoTuyen`, 15 ca; route khac giu) | 8/8 M1 do |
| 2a thanh cong cu | @1280 tran, nut studio ngoai header | khong tran, 6 nut trong header (icon-only khi header < 1.100 px — **do that, khong theo viewport**) | M2a do |
| 2b ngan phai | 320 / 256 px trong `lyDo=null` | **0 px** khi rong, canh **1.000 / 744 px** | M2b ×2 do |
| 3 Line | tam dai may 0,48 / 0,49 | **0,63 / 0,62**, 12/12, ngoaiKhung 0 (`dichKhungDoc`, `TAM_DOC_NDC_LINE=-0,28`) | M3 ×2 do |
| 4 nhan | 16 / 8 nhan chong, chip "con 29/37 ten bi an" **chua bao gio nhin thay** | mac dinh chi bat thuong (URL › localStorage › mac dinh, `chinhSachNhan.ts`), 4 / 1 nhan, hover giu, chip that o day-giua canh | M4 ×2 do |
| 5 minimap | @1280 giao nut 1.410 px², 82 % cao | giao 0, **43 %** (clamp 88–148) | M5 do |
| 6 canh May | @1280 259 < cockpit 312 | **280** (san mem chi khi cockpit > canh); @1600 324 giu | M6 do |
| 7 studio | canh 50,2 % / canvas chui khoi vung | **61,5 %** / 49,2 %, day canvas = day vung | M7 ×2 do |
| 8 ton dong | cuon khong bong, tab cat | `.cuon-doc-bong` + tieu de nhom sticky | M8 ×2 do |
| 9 breadcrumb | 3/3 mat xich cat ca 2 vp | "Tap doan › Nha may ao (SIM) › Tang" du; @1280 "… › …" (`gopBreadcrumb`) | M9 ×2 do |
| 11 tab cockpit | khong chi bao | `CuonNgangCoMep` mep mo + nut "›" | M11 ×2 do |
| 12 the ket noi | @1280 3 dong | 1 dong ca 2 vp (KPI `@container`) | M12 do |

Luoi cuoi **34/34** (nen 8/34). Hoi quy: D-1 **41/0, doi phan quyet 44→45: 0** · K 12/12 ×2 · E 13/13 ×2 (E4 12/12) · I 14/14 ·
P p6 **1,025 s** mot minh · F1 4/4 ×2 vp (0 request ngoai). Tren `/device-monitor` (ngoai twin) nut chat **van co** — doi chung
duong cua muc 1.

> #### ★★ G122 - **CHIP "CON N TEN BI AN" CHUA BAO GIO NHIN THAY SUOT 22 DOT (tu Dot 23)** - DOM co, mat khong
> Chip nam o `y = mep tren canvas − 8`, **duoi dai hop nhat z-30**; QA doc chu tu DOM (§14q.15 "chip con 29/37 ten bi an") va
> chu du an tin. Chi khi Dot 45 siet luoi M4 (chip phai **trong canvas** va **khong bi lop phu che**) moi lo. Goc re (4d):
> `demDuoiChoChip()` cong ca lop phu **khong ngang qua tam canvas** (panel trai top-0 bottom-0 ⇒ `demDuoi=669`) ⇒ chip bay len
> tren mep. Va 4c chan doan "hop drei sai" — **SAI**, probe DOM bac. ⇒ Cung ho G98: **moi chu doc tu DOM phai kem bbox trong
> canvas + khong bi che**; mot chi bao "co mat" (G5) chua la "nhin thay".

**Brief sai 9 cho (lan 19):** "ngan phai mo khi chon Line/tang" — sau QD-23 `NganXuLy` tren `/twin` **luon rong** (`?chon=machine:`
redirect) ⇒ 0 px la dung · "ten day du khi re chuot" — chinh sach cu **khong** giu hover · "menu ⋯ duoi 1400 px" — **loai** (giau hanh
dong, pha test bam) ⇒ icon-only theo be rong header · `TAM_DOC` khong o `khopKhungNhin` · muc 12 da DAT @1600, 5/6 chi do @1280 ·
HEAD brief `dac34691` (G121) · `.qa-dot38/scripts` khong ton tai · G5 lap: `chuNhanAnTheoChinhSach` "co mat" ma khong toi `LopNhan`
(lop on-dinh-ham cua `CanhVanHanh` liet ke prop co dinh — **danh sach thay vi bat bien**, L-1) ⇒ 4b.

**MSA:** P@1600 chet `newPage > 30 s` khi **8 chrome + 32 node** cua cac phien khac song ⇒ chay lai mot minh 6/6 · F1@1280 ✗ chi vi
`msToiMan > 2,5 s` trang dau sau context lanh (6–8 s bat ke man — outlier server §14q.22) ⇒ do lai 4/4 · khoi phuc ablation bang
`git show HEAD:` de lai bong ma "M" EOL (diff noi dung rong) — tra CRLF cho 6 tep `w/crlf` (G101 lap).

**Con mo:** icon `AlertTriangle` cua nut "chi nhan bat thuong" doc nhu canh bao · `dungBreadcrumb` cap tang chi "Tang" khong ten ·
`goi-y-chon-may` en bi `truncate` 24 rem · `DaiHopNhat.tsx:80` `null` khi 0 viec · e2e ngoai cong `qa-dot6-viewport:65` (rect 0 ⇒
"trong khung" — mu), `twin-lo-v-tuong-tac:1302` (`nut-thu-phai` khong render khi ngan rong, co `.catch`) · ngoai twin nhu §14q.22.

**Dot 46 — QA THI GIAC lan 6** (doc lap, khong sua ma): 11 muc × 2 vp × vi/en, bbox + anh tu xem, doi chieu 15 muc D-7 (10 Dot 37 +
3 Dot 39 + 1 Dot 41 + 1 Dot 44), hoi quy D-1/K/E/I/P/F, va **D-8 "dep" cuoi cung** ⇒ cap nhat trang nghiem thu.

### 14q.25 DOT 46 - QA THI GIAC LAN 6: 11/11 muc Dot 45 DAT, 14/15 lich su het, 0 hoi quy - NHUNG "DEP, TRUC QUAN" CHUA: N2 + N1

Tep tho `.qa-dot46/` (1.424 tep · 239 png · 177 json). **Khong sua ma.** Chu du an do lai: **96/2.387** · 4 luoi 180/180 · check 0
· i18n 0 · D-1 sau cot doi phan quyet **0** · DB 11 bang khop · md5 5/5 · cay sach (agent tra CRLF bong ma). **Dieu kien do**:
may chu dang chay **3 server `dist/index.js` cua phien khac** (CPU tich luy 113.226 / 104.535 / 62.842 s), 9 chrome + 25 node ⇒
moi so thoi gian mang dieu kien nay (F1 thuong 3/4 chi vi `msToiMan` 2,5–4 s, font 3/11 loaded, 0 request ngoai).

**D-1 11 muc:** bbox46 **vi 34/34 · en 34/34**; mat: 9 dep, muc 8 @1280 chat (ton dong 1,5 hang), muc 4 dung chip nhung canh van
xau vi N1/N5. **D-2 15 muc lich su:** 14 het; **(8) con nua** — "TAO VIEC" tieu de trong 0 nut cho vai canView (`NganXuLy.tsx:474`
h3 vo dieu kien) — Dot 45 dem muc 6 la "canh 280" va **bo roi nua sau**. **Hoi quy 0**: D-1 41/0, K 12/12, E 13/13, I 14/14, P
DAT, 4 luoi 180/180, twin3d 2.387, census 4 do co san. Ablation: lat mac dinh nhan ⇒ M4 ×2 do; go 2+9 ⇒ M2a/M2b/M9 (+M4 noi day)
do; nen xanh lai md5 895/895.

**D-3 CAI MOI (`thigiac46.mjs` 22 trang thai × vi/en; `probe-*.mjs`):**

| # | Phat hien | So do | Thuoc |
|---|---|---|---|
| **N2 ★★★** | **Re/bam MAY TREN CANH `/twin` va `/twin/line/2` khong phan ung** | 0/≈260 diem: `probe-may` 126 diem/vp re (cursor luon `auto`), `probe-hover2` bam neo nhan (URL khong doi ca Line), `probe-hover4` bam 60 diem vung may `/twin` ⇒ URL khong doi. **Doi chung cung phien**: `/twin-studio` bam canh ⇒ chon "SN-SIMVERIFY-01…"; `/factory-command` (cung `LoBatchMay`/BatchedMesh) re ⇒ `cursor=pointer` ⇒ Playwright/R3F/raycast **song**, chet chi o `CanhVanHanh`. `e2e/twin-*.spec.ts` **0 `mouse.click`** tren canh — 48 ca deu qua `may-hang-14`/`o-tram-14`/cay | ky thuat — goc re **chua dinh danh** |
| **N1 ★★★** | Badge canh bao bi the "Chi so" che (G122 lop thu 3) | `/twin` @1600 **3/4** badge `biChe` boi `bang-kpi-noi` (z30 > z29): `▲SIM-L1-SPI` (**do, su co**) 1.425/1.428 px² = toan bo, `◆SIM-L2-CONVEYOR` 442, `●SIM-L1-AVI` 188; @1280 2/3; Line @1280 1/2 (CONVEYOR toan bo). Tuong phan clip SPI **1,02**. `LopCanhBao`/`locBadge` **khong doc `[data-che-nhan]`** (LopNhan co, `soVungCam=5`); luoi M4 chi do chip + nhan ⇒ **mu badge**. 7 andon ⇒ 4 ve ⇒ **1 badge that su nhin thay** @1600 | ky thuat (kit) |
| N3 | Tay nam thu panel trai de icon hang canh bao | `nut-thu-trai` 21×42 z30 `left-0` tren panel: de "▲" 166/160 px² @1280 | thiet ke — cho quyet |
| N4 | Chu nho duoi AA | `goi-y-chon-may` 3,74 (12/12 < 4,5) · `kpi-mau-so` 4,08–4,38 · **badge da ack (opacity .6)** median 3,27, 51/60 < 4,5, 25/60 < 3 | thiet ke — cho quyet |
| N5 | Nhan × badge chong cheo LOP (hai bo khu chong doc lap) | `SIM-L1-AVI` × `◆SIM-L2-CONVEYOR` 344 px²; `nhanTatCa` @1280 `SIM-L2-PACK` × `◆SIM-L2-ROBOT` **1.819 px²** (chu tron) | ky thuat (kit) |
| N6 | Cat chu khong `title` | `DanhSachMay.tsx:386` `truncate` (5 hang @1280); `<select chon-toa-nha>`; cay studio @1280 | ky thuat nho |
| N7 | May: cung ten/trang thai lap 4 lan; "vien tin cay" nam trong ngan phai, khong o goc tren-phai canh nhu 3 man kia | anh `may-mac-dinh-1600x900.png` | thiet ke — quan sat |

Khong thay moi: tran 0/44 trang thai · Geist 3 face 44/44 · nhan trong canvas, 0 bi che, 0 nhan–nhan chong · ngan mo phong khong
che · cockpit cuon khong dung canh · en 0 chu Viet. **D-6 duong di @1280 co anh**: `/twin` 1.475 ms → re may **khong doi gi** →
tab Cay → bam line 2 → `/twin/line/2` 149 ms → o tram 14 → `/twin/may/14` 94 ms → Back 24 ms → Back 43 ms.

> #### ★★★ G123 - **KET CUC GOC DUOC "DO" QUA DUONG VONG SUOT 46 DOT** - "chon vao may" tren canh chua tung co e2e
> 48 ca D-1, K1–K11, duong di co video (Dot 37/39/41/44/45) deu bam **danh sach / o tram / cay** — khong ca nao `mouse.click`
> vao khoi may tren canvas. Ba man "DAT" 5 lan QA ma hanh dong dau tien cua nguoi van hanh (*bam cai minh thay*) **khong chay**.
> Doi chung cung kit (`/factory-command`, studio) song ⇒ loi **khu tru** o `CanhVanHanh` (nghi: memo `CanhVanHanhOnDinh` Dot 40 /
> lop on-dinh-ham 4b Dot 45 / `raycast={() => null}` `:465` / `internal.interaction`). ⇒ Luoi cho mot ket cuc phai di **dung
> duong nguoi dung**, khong phai duong de do. Va **doi chung duong cung kit** la cach dinh vi loi nhanh nhat.

**D-8 QA lan 6 — "dep, truc quan": CHUA.** Chan: N2 + N1 (ky thuat, trong twin). Cho quyet (thiet ke): N3, N4, N7, @1280 ton
dong 1,5 hang. Ky thuat nho: N5, N6, (8)-nua-sau, breadcrumb "Tang" khong ten.

**Brief sai/lech lan 20 (9):** "trang thai da chon may tren `/twin`" khong ton tai sau QD-23 · "hover nhan" khong co tac dung
de do · §14q.24 "hover giu" la loi khai · `tomtat-D1` Dot 45 doc `.qa-dot44/` hai lan (mat cot 41) — QA sua · tai may 9 + 25–26
· "9 muc thay duoc bang mat" — anh sau3 da lo badge bi che, khong ai gan co (ke ca chu du an) · (8) nua sau roi · `vitest run
twin` co the do 1 ca timeout duoi tai.

**Dot 47 (giao tiep — ky thuat, tu quyet):** (A) **N2**: dinh danh goc re bang **ablation theo commit** (dist tai `d01ef0f7~1`
truoc Dot 40 vs sau; `1c6674dd~1`/`abe7a71c` Dot 45) + cua so do `__demTuongTac` (object co handler, hit dau tai NDC) ⇒ va ⇒
**e2e bam may TREN CANH ⇒ `/twin/may/:id`** o `/twin` va `/twin/line/2` (2 vp), cursor `pointer` khi re, bam **nhan** cung dieu
huong (click ≠ drag: pointer-up cach pointer-down < 4 px). (B) **N1**: `LopCanhBao`/`locBadge` nhan `vungCam` tu `[data-che-nhan]`
nhu `locNhan`; luoi M4 quet `badge-canh-bao-*` (trong canvas, giao lop phu = 0); **badge su co do khong bao gio bi che**. (C) N5: mot
ngan sach hinh chu nhat chung nhan + badge. (D) N6 `title`. (E) (8) an `<section nhom-tao-viec>` khi khong quyen. (F) sua
`tomtat-D1` cot. Sau do **Dot 48 QA lan 7** (thi giac + duong di bam tren canh). Thiet ke N3/N4/N7/@1280 ton dong: trinh chu so
huu.

### 14q.26 Đợt 47 — bấm máy TRÊN CẢNH sống lại + badge hết lệch (2026-09-11/12, 9 commit `f48d2842…60cd57fe`)

**Đầu vào:** QA lần 6 (§14q.25) N2 *bấm khối máy trên cảnh chết ở `/twin` + Line* (0/≈260 điểm), N1 *badge sự cố bị thẻ Chỉ số che 3/4*, N5/N6/(8).

**Gốc rễ N2 = bug thư viện, không phải hồi quy.** Ablation 6 mốc commit trên `dist` cùng chết ⇒ không do memo/lớp ổn-định-hàm Đợt 40/45. R3F 9.5 `swapInstances` (`dist/events-*.esm.js:15200-15260`) khi `<primitive object>` đổi lô (BatchedMesh rỗng → lô 43 máy) remove object cũ nhưng **không `removeInteractivity`**, tái dùng descriptor `eventCount=3` ⇒ `applyProps` thấy `prevHandlers === eventCount` ⇒ object mới **không vào `internal.interaction`** ⇒ raycast bỏ qua: bấm/rê chết im lặng, cursor `auto`, 0 lỗi console. `/factory-command` cùng kit sống vì lô đầu đã đủ máy (không swap). **Vá `f48d2842`:** handler `onClick/onPointerDown/onPointerMove/onPointerOut` lên `<group name="twin3d-lo-may-su-kien">` ổn định bọc `<primitive>`; bấm≠kéo 4 px/300 ms (`phanBietBamKeo.ts`); cửa sổ đo dev `window.__demTuongTac` (`cheDoDo.ts`, chỉ DEV hoặc `?do=1`) đọc **từ store thật** (`demObject`: soObject/coHandler/trongScene; `tamMay`/`hitTai`).

**Gốc rễ N1 = G110 cắn lần 2 (`318bb997`).** Đợt 31 đo lớp NHÃN lệch canvas và chỉ vá `LopNhan`; lớp BADGE `LopCanhBao` dùng cùng `<Html fullscreen>` **không có `calculatePosition={TAM_CANVAS}`** ⇒ mọi badge vẽ lệch máy của nó (−57,−96 @`/twin` 1600; −443,−142 @Line 1600) **suốt 16 đợt**; "badge bị thẻ Chỉ số che" là HỆ QUẢ của lệch lớp. Sau vá: lớp badge = canvas 4/4 màn×vp; badge bị lớp phủ che `/twin` 1600 4→0; thị giác 22 trạng thái badge bị che 0/48; nhãn×badge 0; cặp chồng 0. Kèm: hộp badge là vùng cấm ⇒ nhãn cùng máy **đẩy tầng** thay vì biến mất (Line 12/12); `ResizeObserver` trên `[data-che-nhan]` + `invalidate()` khi số đo thật đổi (frameloop=demand không tự xin khung); thứ tự dời badge lên→phải→trái→xuống.

**Lưới đầu tiên đi đúng đường người dùng (G123) — `e2e/twin-dot47-bam-canh.spec.ts` (`ab410ef1`, bằng chứng `c3fc0e1b`):** `mouse.click` tâm khối máy ⇒ `/twin/may/13` (Line 2) và `/twin/may/246` (`/twin`) **4/4 màn×vp**, trễ trong trang click→pushState **≤ 1 ms** (0,2–0,7 ms), Playwright 14–41 ms; cursor `pointer` trên máy / `auto` trên sàn; bấm sàn trống không điều hướng; kéo vẫn xoay; bấm NHÃN cùng đích; cơ chế `demObject` 1/1/1. Docblock ghi kết quả gỡ đo được (8/12 đỏ trước vá; T1c xanh vì đường nhãn độc lập) thay dự đoán (`60cd57fe`). + lưới reconciler R3F thật `loBatchMay.dom.test.tsx`.

**Các mục khác:** N5 nhãn bấm được + cursor + `LopCanhBao` chạy trước `LopNhan` (`6ca23553`); N6 `title` mã máy truncate/`select` toà nhà/nhãn cây studio (`441f1945`); (8) `NganXuLy` ẩn cả nhóm "Tạo việc" khi vai không có `taoPhieu` (`c73b8df8`); `9f0033c5` vùng cấm `[data-che-nhan]` + dời chỗ thay vì giấu + `hopDaVe` chung.

**Hồi quy (agent đo):** D-1 ✓35 · ✗0 · lỗi 0 (dưới tải 9 chrome + 25 node phiên khác; a2 227 s); `tomtat-D1` 7 cột HEAD 47 = 41 ĐẠT · 5 CHẶN-ĐÚNG · 1 xem · 1 N/A, **đổi phán quyết 46→47 = 0** · K 12/12 · E 13/13 · I 14/14 · P p3–p7 ĐẠT (D-2 chặn ✓39/✗0, TRƯỢT 4 = đối chứng âm cố ý, y hệt Đợt 44/46) · F F1 chặn ✓8/✗0 + thường ✓4/✗0 (Geist 3/11 loaded, ngoài 0) · vitest twin3d `twin3d` **101 tệp / 2.424** (+5 tệp/+37 ca) · `twin` 125/2.806 (Đợt 46 còn 1 timeout) · server 4 đỏ **có sẵn** (census `phamViDoc*`, = Đợt 46; 0 commit Đợt 47 chạm `server/`) · 4 lưới `thigiac47` vi+en 22×2 trạng thái: badge bị che 0/48 · đỏ bị che 0/12 · nhãn×badge 0 · cặp chồng 0 · `bbox46` 34/34 · lưới reconciler R3F 3/3 · vỏ app 30/30 · `check` 0 · `i18n:check` 0 · commit R3F/40 s idle #13/#21 ĐẠT trong D-1 (commit R3F/40 s 3 màn đo riêng ở QA lần 7) · DB dev bất biến 11 bảng trước = sau (2 · 82 · 37 · 42 · 10 · 7 · hb 108 · msl 7814 · perm 104 · ufa 3); hàng tạm 0 · 5 ảnh md5 5/5 khớp `git show HEAD:` · cổng 3047 tắt (0 LISTENING), cổng cấm nguyên PID cũ, worktree `_qa47-wt` gỡ.

> #### ★★★ G124 - **BUG THƯ VIỆN GIẢ DẠNG LỖI CỦA MÌNH: khi MỌI mốc commit đều chết như nhau, dừng ablation và đọc bundle thư viện.**
> 6 mốc ablation `dist` (trước/sau Đợt 40, 45, HEAD) cùng chết ⇒ nguyên nhân nằm DƯỚI mã dự án. R3F 9.5 `swapInstances` bỏ rơi handler khi `<primitive object>` đổi — object mới không vào `internal.interaction`, không lỗi, không cảnh báo. Kiểm bằng cửa sổ đo đọc **từ store thật** (`internal.interaction` phải chứa object đang vẽ), không tin `onClick` có trong JSX (G5). Khuôn vá: handler lên `<group>` ổn định, để object đổi tự do bên trong. Quét mọi chỗ khác `<primitive object={…}>` + handler khi object có thể đổi.

> #### ★★★ G125 - **"BỊ CHE" phải đo LỆCH LỚP-VS-CANVAS trước khi đo CHE; vá một `<Html fullscreen>` thì grep MỌI `<Html` cùng kit và ghim `calculatePosition` bằng lưới.**
> G110 cắn lần 2: Đợt 31 vá lớp nhãn, lớp badge cùng cơ chế lệch (−443,−142) suốt 16 đợt và QA lần 6 gọi là "bị thẻ Chỉ số che" — mô tả triệu chứng đúng, nguyên nhân sai, và 5 lần QA "ĐẠT" đều đo che chứ không đo lệch. Lưới `lopCanhBaoNoiVaoCanvas.unit.test.ts` ghim `TAM_CANVAS` cho lớp badge; mọi lớp DOM-trên-canvas mới phải có lưới cùng khuôn `cheNhan`.

#### 14q.26.1 Đo lại độc lập (chủ dự án)
Tôi đo lại tại `60cd57fe` (2026-09-12 05:05 +07, cùng tải phiên khác): `vitest twin3d` **101 tệp / 2.424 ca xanh** · `npm run check` exit 0 · `i18n:check` 0/0/0/0 · `kiem-vo-app-https` ĐẠT 2/2 (client + dist, tài nguyên ngoài 0) · md5 5 ảnh `test-results/` 5/5 = `git show HEAD:` · DB `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` · cổng 3047 0 LISTENING · cây sạch ngoài `.qa-*`/`knowledge/`(bẩn sẵn) · index rỗng · nhị phân 26fb2555..HEAD = đúng 4 PNG bằng chứng T1a tôi yêu cầu · 4 JSON T1a: `/twin/may/13|246` 4/4, trễ 0,2–0,7 ms, cursor pointer/auto, `demObject` 1/1/1 · ảnh `nhan47-sau5-1600x900_twin.png` tự đọc: ▲SIM-L1-SPI đỏ giữa cảnh, 7 badge thấy, chip "chỉ tên máy bất thường · 42 tên khác ẩn" ở đáy canvas · 4 ca "trượt" D-2 chặn = đối chứng, y hệt `.qa-dot44`/`.qa-dot46` · census `phamViDoc*` 4 đỏ: tôi chạy lại, 0 commit chạm `server/`/`drizzle/`/`shared/` từ baseline Đợt 42 `d7a6a6c7` ⇒ có sẵn, nguyên nhân dân số đổi chưa rõ — Đợt 49. Push `fresh` sau đo lại.

**Brief sai/lệch lần 21:** (7) `d01ef0f7~1` ≡ `060dee97` và `1c6674dd~1` ≡ `abe7a71c` (hai cặp mốc trùng) · 6 giả thuyết i–vi đều sai — gốc ở R3F, không trong mã dự án · "cursor luôn auto" không phải bằng chứng hover chết (0 dòng đặt cursor ở màn Vận hành) · N1 "bị KPI che" là hệ quả lệch lớp chưa ai đo · "gỡ vá ⇒ e2e đỏ" — T1c vẫn xanh · K7 `/twin` đổi `?cam=` khi kéo, Line không. **Còn mở kỹ thuật (Đợt 49):** `LoBatchMay.tsx:205` deps `[may]` dựng lại BatchedMesh mỗi khi màu đổi (vô hại cho sự kiện, tốn GPU) · `KhungCanh.tsx:211` chú thích thứ tự `useFrame` sai · `/twin` nhãn bất thường 3/6 @1600, 1/6 @1280 (`locNhan.ts:188` chỉ xếp tầng dọc) · `locBadge.ts:182` 3 bước ⇒ 2 badge `biChe` @1280 · (E) chưa đo sống với vai không `taoPhieu` (QA lần 7) · census `phamViDoc*` 4 đỏ có sẵn: GHIM C 472→474 · D 1101→1119 · S 290→324 · tổng 2234→2267, 3 mục `maintenanceRouter` đã vá còn trong sổ nợ — cập nhật GHIM có lý do.

**Đợt 48 (giao tiếp — QA lần 7 độc lập, `Skill pdca`, không sửa mã):** kết cục gốc đi ĐÚNG ĐƯỜNG NGƯỜI DÙNG (`mouse.click` khối máy 2 màn × 2 vp, sàn trống, kéo, nhãn, cursor, `demObject` 1/1/1, đối chứng `/factory-command`) · lệch lớp-vs-canvas cho CẢ `lop-nhan` + `lop-canh-bao` 4 màn × 2 vp · 22 trạng thái · bbox 34/34 + badge · D-1 48 ca 7 cột · K/E/I/P/F · an ninh · 4 lưới · check/i18n · R3F 40 s 3 màn · DB/md5/cổng. Thiết kế 10–13 chờ chủ sở hữu. Ngoài twin: 7 câu `db.execute` naive, 3 thủ tục toàn cục, CSP, troika/HDR CDN.

### 14q.27 Đợt 48 — QA lần 7 độc lập: đường người dùng thật + thị giác (2026-09-12, HEAD đo `a64723e1`, commit `3709be0d`)

**Khuôn:** `Skill pdca`, MSA trước (build outDir riêng, md5 dist gốc 914/914 = build #1 = #3; build #2 lệch 478/914 vì `vite.config.ts:28 root: client/` làm `--outDir` tương đối rơi vào `client/` — lỗi hệ đo tự bắt), cổng 3048, vai `e2e_tai_loE` (`auth.me` thật), 2 vp, không sửa mã, không chạm `dist/` (3001/3008 phiên khác đang phục vụ nó).

**Kết cục gốc — bấm thẳng lên khối máy (K7, 26 ca): 24 ĐẠT · 2 SAI.** K7c/d/e/f/g/h 4/4 mỗi ca: sàn trống không điều hướng; kéo 60 px ⇒ camera đổi, pathname giữ (`/twin` ghi `?cam=` replaceState — §9.4); cursor `pointer`/`auto`; bấm NHÃN ⇒ đúng `data-machine-id`, Back 1 lần, bấm khối cùng máy ⇒ cùng đích; `demObject` 1/1/1; trễ trong trang click→pushState **0,2–0,4 ms**, màn Máy vẽ xong 3,0–3,3 s dưới tải. **Hai SAI cùng một lớp lỗi mới:** K7a `/twin`@1600 bấm tâm máy 246 ⇒ mở máy **1** (điểm (687,527) nằm trong nhãn "SIM-L1-SPI · Không rõ"); K7b Line@1280 bấm tâm máy 23 ⇒ mở máy **21** (nhãn "SCREW"). Census K7-NC: 2/2 lần bấm thử "đích = máy CỦA NHÃN (nhãn thắng khối)". Cơ chế QA đọc ra: `LopNhan.tsx:194-207` `khiBam` lấy hộp nhãn đầu tiên trong `hopDaVe` chứa điểm, `stopPropagation()` ⇒ nhãn bấm được (Đợt 47 N5) + `locNhan` không tránh khối máy KHÁC ⇒ **nhãn của máy A "cướp" click của máy B**. Đối chứng cùng kit `/factory-command` tab 3D: bấm được, nhưng 42 máy chồng MỘT điểm (0 hàng `machine_positions`, G102) ⇒ Sheet mở máy khác — màn cũ, ghi nhận.

**Thị giác:** lệch lớp-vs-canvas `lop-nhan` + `lop-canh-bao` = (0,0,0,0) ở **8/8** màn×vp (N1 Đợt 47 hết ở mọi nơi); 22 trạng thái vi **22/22** (nhãn/badge ngoài canvas 0 · bị che 0 · cặp chồng 0 · nhãn×badge 0 · chip trong canvas); bbox QĐ-26 **34/34**. Quan sát không hồi quy: `/twin`@1280 badge `tong 7 · ve 5 · soAn 2 · biChe 2` — 2 cảnh báo bị GIẤU vì chạm lớp phủ mà **0 chỉ báo UI** (chip chỉ đếm tên máy ẩn).

**Hồi quy:** D-1 48 ca × 2 vp **35 ✓ / 0 ✗**, bảng 8 cột QA7 = {ĐẠT 41 · xem 1 · N/A 1 · CHẶN-ĐÚNG 5}, **0 đổi phán quyết** so với Đợt 47 · D-2 chặn K/E/I/P **38 ✓ / 0 ✗** (4 trượt = đối chứng cố ý, = Đợt 46/47) · F1 thường 4/4 · **F1 chặn @1280 dưới tải 6/8 ×3 lượt: mỗi lượt 1–2 ca NGẪU NHIÊN vượt 2 500 ms** (Line 3 362 · Máy 2 651 · `/twin` 5 598 · studio 3 171; `goto` 428–1 734 ms) — không cùng ca ⇒ nhiễu tải phiên khác (9 chrome + 25 node), không phải font (fonts loaded, ngoài 0) · D-4 API 6 vai: operator1 0 gán ⇒ rỗng/404/403, 0 dấu vết SIM; user 0 quyền 36×403; API key thiếu scope ⇒ 404; admin bypass T12 10 = nợ Đợt 41 · R3F 40 s 3 màn: 0 khung · rAF 0 · commit R3F 0 (react-dom 50/55/63 do ws 84–90 gói + tRPC 7–12) · p1 0 khung, kéo 33/34/59 khung/1,5 s · cổng nguồn `twin3d` 101/2.424 · `twin` 125/2.806 · server 536/540 (4 đỏ census có sẵn) · 4 lưới phạm vi 180/180 (`twinBonManApiVaiPhamVi` 115 + `factoryCommandAssetCockpitPhamVi` 22 + `digitalTwinPhamVi` 15 + `maintenanceAndonPhamVi` 28) · `kiem-vo` ĐẠT · i18n 0 · tsc 0 · e2e Đợt 47 12/12 trên 3048 (ảnh "sau bấm" thật = màn Máy đã vẽ).

**QA bác bằng chứng của Đợt 47:** 4 PNG `.qa-dot47/e2e/t1a-*-sau-bam.png` đã commit (`c3fc0e1b`) là **SPINNER** (chụp ngay sau `waitForURL`), không phải màn Máy — kết cục đúng (URL + trễ) nhưng ảnh không chứng minh "màn Máy hiện ra"; spec ghi cứng `ANH=".qa-dot47/e2e"` nên chạy lại ghi đè tệp tracked (QA sao lưu/khôi phục, md5 khớp). Đợt 49 F sửa.

**Brief sai/lệch lần 22 (12, QA đếm):** `.qa-dot34/dem.mjs` chỉ 6 khoá (11 khoá là `.qa-dot37/db.mjs dem`) · porcelain ngoài `.qa-*` không rỗng (`knowledge/` ~180, `uploads/`, `.qa-loW/X/Y`, spec stat-dirty CRLF) · HEAD đổi +1 docs trong lúc chạy (hợp G121) · outDir tương đối rơi vào `client/` · spec ghi cứng thư mục ảnh tracked · đối chứng `/factory-command` bấm được nhưng 42 máy chồng một điểm · `.qa-dot47/probe/*` là đầu ra, harness là `probe-*.mjs` · F fonts dùng `.qa-dot44/f1-fonts.mjs` · "4 lưới 180/180" không nêu tên · census: brief đúng · "22 trạng thái" = 11 × 2 vp · "chụp sau khi màn Máy vẽ xong" — đúng và cần.

#### 14q.27.1 Đo lại độc lập (chủ dự án)
Commit QA `3709be0d`: **216 tệp, tất cả trong `.qa-dot48/`** (14,0 MB, 56 nhị phân), 0 tệp mã/spec lẫn vào; cây sau commit **0 tệp mã bẩn**, `git diff --cached` rỗng; md5 5 ảnh `test-results/` 5/5 = `git show HEAD:`; DB 6 khoá `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` y trước; cổng 3048 **0 LISTENING**. Tôi tự đọc 2 ảnh "trước bấm" và xác nhận bằng mắt: điểm (687,527) ở `/twin`@1600 nằm gọn trong hộp nhãn "SIM-L1-SPI · Không rõ" của máy 1, điểm (950,323) ở Line@1280 nằm trong hộp "SCREW · Không rõ" của máy 21 — **kết luận Pareto #1 đúng**.

★ **Giả định của tôi bị QA bác:** khi thấy F1 chặn 6/8 tôi kết luận "nhiễu tải phiên khác (9 chrome + 25 node), không vá" và đã ghi thế vào brief Đợt 49. QA đo `[SLOW QUERY]` **690 lần/85′** trên DB dùng chung — `robot_telemetry DISTINCT ON ("robotId") … AT TIME ZONE` 321× max 4,0 s; robot state select 74× max 14,0 s; sức khoẻ máy 77× — và tách đúng hai kết cục: **fonts/CDN 28/28 ĐẠT (đóng)**, "thời gian tới màn" 23/28 ≤ 2,5 s với 5 đột biến rải ngẫu nhiên theo màn. Bài học lặp lại G112/G106: *quy cho "nhiễu môi trường" mà không đọc log của tầng dưới là lời khai, không phải phép đo.* Đợt 49 mục H nhận việc này (đo lại trên DB riêng trước khi vá index).

> #### ★★★ G126 - **LÀM MỘT THỨ BẤM ĐƯỢC = CHO NÓ QUYỀN CƯỚP CLICK CỦA THỨ NẰM DƯỚI; đo "đúng đích" chứ không chỉ "có điều hướng".**
> Đợt 47 làm nhãn bấm được (N5) và e2e chỉ hỏi "URL có đổi sang `/twin/may/:id` của máy CHỌN TRƯỚC không" với điểm bấm được lưới tự chọn sao cho không bị che ⇒ 12/12 xanh. QA lần 7 bấm ĐÚNG TÂM khối máy như người dùng ⇒ 2/4 màn×vp đi sai máy vì nhãn máy khác nằm đè. Lưới cho hành động bấm phải (1) kiểm **đích** = thứ người dùng thấy tại điểm bấm (`elementFromPoint` + `hitTai.machineId`), (2) census mọi điểm "tâm bị thứ khác phủ" như một ca riêng, (3) bố cục lớp DOM trên canvas phải coi khối máy KHÁC là vùng tránh. Cùng gốc với G122/G125: chữ/badge/nhãn trên canvas chỉ đúng khi đo cả **vị trí tương đối với vật 3D**, không chỉ với nhau.

**Đợt 49 (giao tiếp — kỹ thuật, tự quyết):** A ★★★ `locNhan` tránh khối máy khác + `hitTai.machineId`/`domTai`/`diemThay` + lưới đúng-đích + census tâm-bị-phủ = 0 · B tách màu/hình `LoBatchMay:205` · C nhãn bất thường 3/6 xếp ngang · D badge ẩn có chỉ báo ("còn N cảnh báo ẩn") + dời ≤ 6 bước · E census `phamViDoc*` GHIM có lý do + sổ nợ 3 mục · F spec ảnh qua env + ảnh "sau bấm" thật, chú thích `KhungCanh:211`, cursor thống nhất · G đo sống vai không `taoPhieu`. Sau đó QA lần 8.

### 14q.28 Đợt 49 — nhãn thôi cướp click, GHIM census bị lật, ba truy vấn chậm lộ diện (2026-09-12, 10 commit `2cb815b6…d5ed0432`)

**A (★★★ nhãn cướp click) — phải HAI cơ chế, không một.** Census 8 khung, hai `dist`: cặp (nhãn A ∩ hình chiếu khối B) **59 → 41** (−31 %), diện tích giao **24 291 → 14 073 px²** (−42 %), nhưng **máy có tâm bị nhãn khác đè vẫn 16/16** — vì hợp đồng của `locNhan` là *hết chỗ thì GIỮ nhãn* (không giấu). Kết cục chỉ đóng khi thêm cơ chế thứ hai: `LopNhan.khiBam` **nhường** khi điểm bấm nằm trong hình chiếu khối máy khác. Bấm thật vào tâm bị phủ: **1 đúng/2 SAI → 5 đúng/0 SAI**; e2e T1g 4 khung **2/4 ĐỎ → 4/4 XANH**; e2e bấm cảnh tổng **16/16** (12 cũ + T1g).

**B (dựng lại BatchedMesh) — điều kiện lỗi KHÔNG tái hiện trên DB dev.** `soLanDungLo` 60 s live = **0/0 ở cả hai bản** (117/114 gói ws nhưng giá trị `may` không đổi; `CanhVanHanh` đã ổn định theo giá trị). Nhân quả chỉ chứng minh được ở reconciler R3F thật: 5 gói đổi màu ⇒ 0 lần dựng + giữ nguyên object lô; đổi kích thước/vị trí/tập máy ⇒ +1 mỗi lần. Không hồi quy (R3F idle 3 màn 0 khung/40 s).

**C** `/twin` nhãn bất thường **3→4** @1600, **1→3** @1280; "nhãn tất cả" 13→21 @1600, 6→12 @1280; 0 hồi quy ở 22 trạng thái vi **và** en. **D** `/twin`@1280 badge `ve/tổng/ẩn/bị che` **5/7/2/2 → 7/7/0/0** (`doiCho` 4→6); chip "còn 2 cảnh báo ẩn" có bbox (715,601,115×23) trong canvas ở bản gỡ vá — ảnh tự đọc. **F** `TWIN_E2E_ANH` env + siết điều kiện chụp; **4 PNG spinner đã thay bằng ảnh màn Máy vẽ xong**. **G** `/twin/may/14` `nhom-tao-viec`: vai CÓ 1 / vai KHÔNG 0 — **2/2 hai chiều**; đối chứng dương trượt lần đầu và nhờ đó bắt fixture sai: gate `machine_monitoring` nhưng `PERMISSION_MODULE_ALIASES` resolve sang **`machine_status`** (G24 lặp lại).

**E (census) — GHIM bị lật, không phải "dân số trôi".** 4 ca đỏ → 0. Đo bộ quét trên 4 cây `git archive`: `d7a6a6c7` = HEAD = C 474 / D 1119 / S 324 / tổng 2267 (`git diff d7a6a6c7..HEAD -- server/` **rỗng** ⇒ dân số KHÔNG đổi); ở `2cb1f771` — chính cây mà GHIM tự viện dẫn — đo được C 470 / D 1097 / S 286 / tổng 2224, **khác con số ghim**. GHIM được cộng tay trên chú thích, phần dư mỗi đợt giải thích bằng *"độ trôi của lô khác — để bên đó ký"*; không ai ký vì không có gì để ký.

**H (chỉ ĐO, chưa vá — chờ duyệt trước khi chạm mã ngoài twin).** `robot_telemetry` 1 373 282 hàng, hypertable 10 chunk (7 nén + 3 chưa nén 175 MB), index `("robotId","timestamp")` **có sẵn trên cả 3 chunk** ⇒ không phải thiếu index. `server/db/twinCanh.ts:1518` `DISTINCT ON` = 409 ms EXPLAIN / 673–782 ms thật (3 chunk chưa nén bị Seq Scan + external merge 14 MB ra đĩa); đối chứng per-robot `ORDER BY ts DESC LIMIT 1` ×3 = **13+10 ms ấm**. ★★★ Nặng nhất: **`server/routers/fleetRouter.ts:221-226 robotPositions` `select()` KHÔNG `LIMIT`** ⇒ kéo **1 373 283 hàng (cả `poseJson`) trong 12 601 ms** để giữ đúng 3 hàng cuối — chính là "robot state select max 14 s" mà QA lần 7 thấy. `server/services/machinePresenceService.ts:142` GROUP BY toàn `ot_telemetry` (33,4 M hàng) = 774 ms/lượt.

**Hồi quy:** `twin3d` **103 tệp / 2 452** · e2e bấm cảnh 16/16 · thị giác vi+en 22×2 · bbox 34/34 · lệch lớp 8/8 · R3F 40 s ×3 = 0 khung · D-1 ✓35/✗0 {ĐẠT 41 · xem 1 · N/A 1 · CHẶN-ĐÚNG 5} = **0 đổi phán quyết** · D-2 ✓39/✗0 (ĐẠT 60, TRƯỢT 4 đối chứng) · D-4 6 vai y hệt Đợt 48 · 4 lưới phạm vi 180/180 · **census 540/540** · `check` 0 · `i18n:check` 0 · `kiem-vo` 30/30 · F1 fonts 8/8 loaded 0 request ngoài (2 đột biến 3,4/3,9 s = đúng mẫu DB mục H). Test đỏ của agent: **0**.

**14q.28.1 Đo lại độc lập (chủ dự án):** HEAD `d5ed0432`, 10 commit đã push `fresh`; cây 0 tệp mã bẩn, index rỗng; `vitest twin3d` **103/2 452 xanh** (tôi chạy lại); md5 5 ảnh `test-results/` 5/5 khớp; DB 6 khoá y trước; nhị phân trong dải = 4 PNG `.qa-dot47/e2e` cố ý thay + ảnh bằng chứng `.qa-dot49/`; cổng 3049 tắt, 3000/3001/3008/8080 nguyên PID. ⚠ **5173 (PID 7496) của phiên khác biến mất trong phiên** — tôi grep toàn bộ log Đợt 49: mọi `taskkill` đều nhắm PID trong `.qa-dot49/server.pid`; đã báo phiên `avi-aoi-management-b2` để họ tự kiểm.

**Brief tôi sai lần 23 (6 + 1 tự phát hiện):** `hitTai`/`tamMay` KHÔNG ở `cheDoDo.ts` (26 dòng, chỉ cờ chế độ) mà ở `KhungCanh.tsx:323` + `LoBatchMay.tsx`, `diemThay` thừa · "xoá 3 mục sổ nợ rồi **hạ `GHIM.A`**" SAI: A là dân số bộ quét ĐẾM TRÊN MÃ (342 trước và sau), sổ nợ chỉ là danh sách miễn trừ — hạ xuống 339 mới đúng là "sửa cho xanh" · tiền đề "dân số đổi" SAI · B "dựng lại mỗi khi màu đổi" đúng cơ chế nhưng không nổ trên DB dev · F "cursor thống nhất `CanhNhaMay.tsx:317`" không làm được (người gọi duy nhất là màn cấm sửa `/factory-command`) · A.5 "gỡ vá ⇒ K7a@1600 sai máy" không tất định (rê chuột làm lớp nhãn tính lại). **Agent tự bắt lỗi của mình:** hằng dời ngang 28 px nhỏ hơn nửa bề rộng nhãn ⇒ không bao giờ tới đích; và **D-4 của nó ghi đè 13 tệp tracked của Đợt 48** — đúng lớp lỗi mục F vừa vá, ở tệp khác, trong cùng phiên (đã khôi phục byte-exact + lấy đường ra từ ENV).

> #### ★★★ G127 - **CON SỐ "GHIM" ĐƯỢC CỘNG TAY RỒI GIẢI THÍCH PHẦN DƯ BẰNG "ĐỘ TRÔI CỦA LÔ KHÁC" — CHƯA BAO GIỜ LÀ PHÉP ĐO.**
> Census phạm vi đọc đỏ 4 ca suốt nhiều đợt; ai cũng đọc lời khai "dân số đã đổi, để lô kia ký". Đo lại bộ quét trên `git archive` của CHÍNH commit mà GHIM viện dẫn: số ở đó cũng không khớp ⇒ GHIM sai từ trước baseline, dân số không hề đổi (`git diff -- server/` rỗng). **Khi một cổng đỏ được giải thích bằng "nợ của người khác", dựng lại cây ở đúng mốc ấy và ĐO, đừng kế thừa lời khai** (cùng họ G112: số từ vá-thử không phải tiêu chí; G106: đếm câu ≠ đếm kết cục).

> #### ★★★ G128 - **VÁ HÌNH HỌC KHÔNG ĐÓNG ĐƯỢC KẾT CỤC KHI HỢP ĐỒNG CỦA BỘ BỐ CỤC LÀ "HẾT CHỖ THÌ GIỮ".**
> Đưa khối máy khác vào vùng tránh của nhãn giảm 31 % số cặp đè và 42 % diện tích, nhưng **16/16 tâm vẫn bị phủ** vì bố cục được phép giữ nhãn khi không còn chỗ — và người dùng bấm đúng những tâm ấy. Kết cục chỉ đóng khi thêm **lớp quyết định tại điểm bấm** (hit-test nhường khối). Khi chỉ tiêu là "không còn X" mà cơ chế có nhánh "đành chịu", phải đo kết cục ở nhánh đành-chịu và vá riêng cho nó.

> #### ★★ G129 - **VỪA VÁ MỘT LỚP LỖI XONG, CHÍNH MÌNH LẶP LẠI NÓ Ở TỆP KHÁC TRONG CÙNG PHIÊN.**
> Agent vá mục F (harness ghi đè thư mục ảnh **tracked**) rồi ngay sau đó để D-4 của mình ghi đè 13 tệp tracked của Đợt 48. Quét MỌI harness cùng khuôn ngay khi đặt tên lớp lỗi — không đợi đợt sau (G110 ở phạm vi công cụ đo thay vì mã sản phẩm).

**Đợt 50 (giao tiếp — kỹ thuật, tự quyết; KHÔNG migration/không đổi schema):** vá 3 truy vấn mục H (fleetRouter `robotPositions` per-robot `LIMIT 1`; `twinCanh.ts:1518`; `machinePresenceService.ts:142`) với **đối chứng đầu ra bằng byte** trước/sau + đo EXPLAIN/thời gian ấm-nguội; `CanhNhaMay.tsx:317` chỉ ghi docblock; sau đó **Đợt 51 QA lần 8** (nghiệm thu cuối). Thiết kế 10–13 vẫn chờ chủ sở hữu.

### 14q.29 Đợt 50 — năm truy vấn chậm bị vá, kết cục gốc CHƯA ĐẠT, và một sự cố mất dữ liệu đo (2026-09-12, 5 commit `65f96c91…bab5943a`)

**Đo qua CHÍNH thủ tục (`createCaller`), không SQL thô** — nguội / ấm ×5, và đối chứng đầu ra bằng md5 JSON:

| | trước | sau | md5 đầu ra |
|---|---|---|---|
| A `fleet.robotPositions` | **5 927 / 5 830–6 161 ms**, kéo **1 377 398 hàng** | **34–169 / 3,7–83 ms**, kéo **1 hàng** | khớp (admin) · khớp (operator1 ⇒ `[]`) |
| B `twin.anToanRobot` (`twinCanh.ts:1518`) | 276 / 270–335 ms | **11,3 / 7,7–9,0 ms** | khớp cả 3 hình dạng trong một snapshot `REPEATABLE READ` |
| C `sweepPresenceFromTelemetry` (`machinePresenceService.ts:142`) | 584 / 472–510 ms | **104 / 17–25 ms**, `checked=42 changed=0` | khớp |

EXPLAIN: `DISTINCT ON` 703–827 ms (Seq Scan 3 chunk chưa nén + external merge **3 424+7 664+3 344 kB** / 566 167 hàng) · `LATERAL` 198–317 ms · **`LIMIT 1`/robot 1,9–4,3 ms** (9/10 chunk *never executed*) · C: `GROUP BY` quét **33 504 873 hàng** → per-máy `Index Only Scan` trên index **đã có sẵn**. **Không index mới, không migration.** Đối chứng dương G104 ở B: chèn hàng `now()` cho robot 2 ⇒ `estop true`, `capNhatLuc` lệch **2 ms (0 h)**; xoá ⇒ trở lại `null`.

★★★ **Mục E — ngoài brief, và là nguồn thật của đột biến.** Đo lại F1 **sau** A/B/C: đột biến **không hết, còn tệ hơn** (3/28 → 6/26); log server vẫn có `select … robot_telemetry …` **10,1 / 11,0 / 12,1 / 16,0 giây**. Mục A chỉ vá **1 trong 3 bản sao** cùng câu (G110): `server/services/fleet/taskAllocator.ts:297` (chạy theo **nhịp sweep 60 s**) và `trafficManager.ts:635`. Nhân quả đo được: **số lượt sweep khớp 1:1 số câu > 2 s** (4/4 trước, 6/6 sau). Vá bằng một chỗ dùng chung `server/db/telemetryMoiNhat.ts`. ★ Chính số liệu QA lần 7 đã chỉ đúng chỗ mà brief tôi đọc sai: *"robot state select 74×/85′"* ≈ 1 lượt/69 s = nhịp sweep, **không phải** màn bản đồ — `robotPositions` chỉ được gọi từ `/fleet-orchestration`, **0 màn twin nào gọi**.

**Kết cục gốc CHƯA ĐẠT (nói thẳng).** F1 `chan` 1600×900, 7 lượt × 4 màn: trước `4215c526` p50 **1 233** / p90 **3 908** / max 6 856, đột biến **3/28**; sau A+B+C p50 1 353 / p90 4 936 / max 5 887, **6/26**; sau A+B+C+E p50 **1 231** / p90 **2 443** (−37 %) / max 6 217, **2/28** (3/44 phép). Hồ sơ server: câu chậm nhất **15 992 → 487 ms**, số câu chậm **128 → 32**, câu "kéo cả bảng" **0**. Đột biến vẫn còn.

**D**: docblock đối chiếu cursor đã có sẵn ở `CanhVanHanh.tsx:527` (Đợt 49) — brief tưởng chưa; agent thêm bản đối xứng ở `CanhNhaMay.tsx`, người gọi duy nhất vẫn là `FactoryCommandView.tsx:518` ⇒ giữ `"grab"`. 41 cặp nhãn ∩ khối máy **giống hệt Đợt 49 từng trạng thái** (10/13/0/0/9/7/2/0) — chỉ đo (G128).

**Hồi quy:** `twin3d` 103/2 452 · phạm vi 4 lưới 180 · fleet+robot 22/200 · presence 11 · twinCanh 7 · e2e bấm cảnh **16/16** · bbox 34/34 · R3F 40 s ×3 = 0 khung · thị giác vi+en 22×2 khớp từng dòng Đợt 49 · **D-4 288 ca × 6 vai lệch 0** · D-1 ✓35/✗0 · census `git archive` 2267 y hệt hai cây · `check` 0 · `i18n` 0 · DB 11+6 khoá bất biến · md5 5/5 · hàng tạm 0. Test đỏ của agent: 0. **Chủ dự án đo lại:** `phamViDocCensus` + `phamViTuyenCensus` **XANH** (bác nghi ngờ "không tái lập được 540/540"); còn `server/contracts/capChuoiVarcharDuongIngestMacDinh.test.ts` **4 ca đỏ** — tệp sửa lần cuối 2026-09-03, Đợt 50 không chạm ⇒ nợ có sẵn (Đợt 51 xác nhận bằng `git archive`).

> #### ★★★ G130 - **`cmd > "$f"` VÀ `open(p,'wb')` CẮT TỆP TRƯỚC KHI LỆNH CHẠY — MỘT VÒNG "KHÔI PHỤC" LÀM MẤT 103 TỆP KHÔNG CÓ TRONG GIT.**
> Agent Đợt 50 chạy spec Đợt 47 (đường ra ảnh **ghim cứng** `.qa-dot47/e2e/`) ⇒ ghi đè bằng chứng; vòng khôi phục `git show HEAD:"$f" > "$f"` cắt sạch tệp **trước** khi git báo "tệp untracked" ⇒ **103 tệp thô của Đợt 47 thành 0 byte, mất hẳn** (99 tệp depth-1 + 4 `t1g-*.json`); cùng bẫy trong Python làm rỗng thêm 4 tệp **mã nguồn** (đã khôi phục đúng byte từ git, `tsc` 0, vitest xanh). **Luật:** mọi khôi phục ghi ra **tệp tạm rồi `mv`**; trước khi chạy harness cũ phải `grep -n "qa-dot4[0-9]"` kiểm đường ra và chuyển sang ENV; **không đắp tệp cùng tên từ đợt khác** (bịa bằng chứng). Agent đã tự khai đầy đủ và **không** đắp — đó là hành vi đúng.

> #### ★★ G131 - **"NẶNG NHẤT" KHÔNG PHẢI "TRÊN ĐƯỜNG NGƯỜI DÙNG": ĐỌC AI GỌI TRƯỚC KHI XẾP PARETO.**
> `robotPositions` nặng nhất (12,6 s) nhưng **0 màn twin nào gọi** ⇒ vá nó một mình không xoá được đột biến; thủ phạm là hai bản sao cùng câu chạy theo **nhịp nền 60 s**. Số "74 lượt/85′" trong báo cáo QA đã nói đúng điều đó ngay từ đầu. Xếp Pareto theo **đường gọi thật × tần suất**, không theo ms của một câu.

**QĐ-27 (chủ sở hữu, 2026-09-12):** **duyệt tạo index mới `machine_health_history ("machineId","createdAt" DESC)` — CHỈ trên DB dev**, đo trước/sau + đối chứng đầu ra byte, production để sau trong cửa sổ bảo trì. Lý do: `traSucKhoeMay` (`twinCanh.ts:2196`) chiếm **24/32** câu chậm còn lại và **đổi hình dạng câu không cứu được** (per-máy UNION ALL 233–412 ms *tệ hơn* DISTINCT ON 126–154 ms) vì bảng chỉ có index `("machineId","timestamp")` còn câu sắp theo `"createdAt"`. Chủ sở hữu cũng chốt bước kế tiếp là **QA lần 8 nghiệm thu cuối** sau khi index xong.

### 14q.30 Đợt 51 — index được duyệt: truy vấn chậm biến mất, kết cục gốc ĐẠT nhưng ablation bác bỏ nhân quả (2026-09-12, 3 commit `5142f895…`)

**A (QĐ-27, CHỈ DEV) — `drizzle/0356` `machine_health_history ("machineId","createdAt" DESC)`.** Bảng 213 567 hàng / 42 máy có sẵn **6 index**, hai cái *trông như* đúng (`("machineId","timestamp")` và UNIQUE cùng cột) nhưng câu của `traSucKhoeMay` sắp theo **`createdAt`** — cột khác, và khác *có chủ ý*. Kế hoạch trước: `Seq Scan 212 194 hàng → Sort **external merge Disk 7 848 kB** → Unique 42 hàng`, `Execution Time 288,534 ms`, `shared hit=211 read=5159, temp read=981 written=984`. Sau: `Custom Scan (SkipScan) → Index Scan`, **0,302 ms**, `shared hit=168`, **0 temp**. Đo qua **CHÍNH thủ tục** (`createCaller`, `twinCanh.sucKhoeMay`): admin nguội **523,31 → 45,58 ms**, ấm ×5 p50 **319,26 → 11,82 ms (27,0×)**; SQL thuần 247–311 → 0,79–1,08 ms. Index: `CONCURRENTLY` **114,92 ms · 6 608 kB**, `indisvalid=true`; bảng 76 → 82 MB (index 34 → 40 MB). `CONCURRENTLY` dùng được vì `scripts/migrate-standalone.mjs:222-231` chạy **từng câu bằng `sql.unsafe`, KHÔNG bọc transaction` — đã đọc mã rồi mới viết, không đoán. **KHÔNG sửa một dòng nào của `traSucKhoeMay`** cho "hợp index".

**Đối chứng đầu ra BẰNG BYTE — hai phép, vì một phép không đủ.** (1) trước/sau ở tầng thủ tục: admin `4f88db1d…` = `4f88db1d…`, operator1 `79a361eb…` = `79a361eb…`, thêm **engineer1** (vai KHÔNG-admin duy nhất CÓ gán nhà máy, 42 máy) cùng md5 với admin. (2) **miễn nhiễm với trôi dữ liệu**: job sức khoẻ ghi +42 hàng mỗi vài phút ⇒ md5 thủ tục *có thể* lệch vì DỮ LIỆU chứ không vì index; nên chạy **hai kế hoạch trong CÙNG một snapshot `REPEATABLE READ`** (`enable_indexscan off/on`): Seq Scan+Sort vs SkipScan+Index Scan, md5 `f7b4562b…` = `f7b4562b…`, 42 = 42 hàng.

**A.6 đường GHI — phép đo đầu TIÊN KHÔNG ĐỦ NHẠY, và brief kê đúng phép đo ấy.** Brief bảo "chèn 100 hàng tạm". Làm đúng vậy: 7 index p50 59,96 ms vs 8 index p50 56,2 ms — *âm tính*, nhưng vô nghĩa: 100 `INSERT` rời nhau bị **round-trip mạng** chi phối, không phải bảo trì index. Đổi sang `INSERT…SELECT 20 000 hàng` một câu: hai lượt tuần tự cho phân bố **chồng nhau hoàn toàn** (có index 171–486 ms vs không 450–533 ms — *ngược chiều*). Chỉ **ablation XEN KẼ A/B/A/B/A/B** (9 lô mỗi phía) mới có dấu: p50 222,65 vs 186,30 ⇒ **+1,8 µs/hàng (+19,5 %), là CẬN TRÊN**. Quy ra nhịp ghi thật (42 hàng mỗi ~6 phút) = **+0,076 ms/chu kỳ**. Mọi lô chạy trong transaction rồi `ROLLBACK`; `count(*)` 213 609 = 213 609 ở mọi phép đo, hàng tạm sót **0**.

**★★★ KẾT CỤC GỐC ĐẠT — VÀ ABLATION BÁC BỎ NHÂN QUẢ.** F1 `mang=chan` 1600×900, 7 lượt × 4 màn, cổng 3051: **p50 1 183 · p90 1 545 · max 1 889 · đột biến 0/28** (nền Đợt 50: 1 231 / 2 443 / 6 217, **2/28**, 3/44). p90 −37 %, max −70 %. **Nhưng gỡ index rồi chạy lại đúng phép đo ấy: vẫn 0/28.** Mở rộng 14 lượt mỗi phía: có index **0/56** (p90 1 486 / max 1 889) · gỡ index **1/56** (p90 1 867 / max 2 777). Tức là điều kiện sinh ra đột biến 6 217 ms của Đợt 50 **không tái hiện hôm nay ở cả hai chiều**; phần index thật sự đóng góp là p90 −20 % / max −32 %, nhỏ và KHÔNG phải thứ đóng kết cục. **Không nhận công cho phần còn lại.**

**Nhân quả ĐƯỢC chứng minh — ở tầng truy vấn, ablation hai chiều, cùng một tiến trình server, mốc dòng log ghi lại (4121 → 6076 → 7959):** có index **0 câu chậm / 0 `traSucKhoeMay`**; gỡ index **11 câu chậm / 8 `traSucKhoeMay` / chậm nhất 538,5 ms** (nền Đợt 50: 32 câu chậm, 24 là `traSucKhoeMay`). ⚠ `[SLOW QUERY]` đi ra **stderr**; lần đọc đầu tôi đếm trên `.out.log` và ra "0 ở cả hai điều kiện" — kết luận SAI do đọc nhầm luồng, sửa bằng mốc dòng hai đầu trên đúng tệp.

**B — hàng rào ở chính công cụ, và brief sai hai lần ở đây.** Brief: "`twin-dot47-bam-canh.spec.ts:13` vẫn ghim cứng ⇒ đọc `TWIN_E2E_ANH`". SAI: Đợt 49 (mục F) **đã** thêm `TWIN_E2E_ANH` ở dòng 38 — và **nó không cứu được**, vì mặc định vẫn trỏ thẳng `.qa-dot47/e2e`; Đợt 50 chạy không đặt ENV và mất bằng chứng. *Một ENV mà người chạy phải NHỚ đặt không phải hàng rào.* Brief cũng chỉ nêu **một** spec; quét 713 tệp đo được **139 tệp ghi vào `.qa-dotNN` ghim cứng**, trong đó `scripts/` = 0 và `e2e/` = **7 spec** (dot22 10 đường · dot23 3 · dot24 8 · dot26 · dot31 · dot38 · dot47). Vá bằng **bất biến, không phải danh sách** — `e2e/duongRaBangChung.ts`: *"thư mục đích ĐÃ CÓ TỆP ⇒ không ghi vào đó"*, tự đổi sang `<đường>-lai-<mốc>` + kêu to; `QA_GHI_DE_BANG_CHUNG=1` là lối thoát có chủ ý. **KHÔNG `throw`**: cả 7 spec nằm trong suite mặc định của `playwright.config.ts`, ném lỗi là tự tạo G108. Nghiệm bằng cách **tái diễn chính xác kịch bản Đợt 50** — chạy `twin-dot47` KHÔNG đặt ENV trên 3051: `16/16 PASS`, đường ra đổi sang `.qa-dot47/e2e-lai-20260912-055805`, **md5 8/8 tệp tracked của Đợt 47 KHỚP** (0 tệp bị ghi đè). ⚠ Bộ quét của tôi **mù một lần**: mẫu `path: ".qa-dotNN/…"` bỏ sót dot26/dot31 vì chúng viết `const ANH = ".qa-dot26"` rồi `${ANH}/…`; bắt được nhờ grep lần hai **theo HẰNG SỐ, không theo lời gọi**.

**C — nợ có sẵn, xác nhận bằng ĐỐI CHỨNG DƯƠNG chứ không chỉ bằng "nó cũng đỏ hôm qua".** `server/contracts/capChuoiVarcharDuongIngestMacDinh.test.ts` 4 đỏ / 109 xanh. Cả 4 ca dựa trên MỘT phép đo: tìm chuỗi `"metaData = metaJsonSchema.parse(JSON.parse(metaContent));"` trong `server/routers/aoiPackageRouter.ts`. Commit **`c69e071c` (2026-09-05, BG-39 gđ2)** tách dòng đó làm hai (`const metaRaw = JSON.parse(metaContent)` … `metaJsonSchema.parse(metaRaw)`) để chèn cổng `laHinhDangCayV2` ⇒ **neo cứng gãy, hành vi được kiểm KHÔNG hỏng**. Đo trên 3 cây `git archive` (+ `node_modules` junction, vitest THẬT): `0dae81b6` (09-04) **113/113 XANH** ← đối chứng dương, phép đo biết kêu xanh; `c69e071c` 4 đỏ; `4215c526` 4 đỏ; HEAD 4 đỏ. Tệp test tại `0dae81b6` **giống hệt HEAD (diff 0 dòng)**. ⇒ nợ có từ **7 ngày trước Đợt 50**. KHÔNG vá. Đề xuất: neo theo lời gọi `metaJsonSchema.parse(<bất kỳ>)` thay vì nguyên văn một dòng — đúng điều chính tên ca test đã khai.

**Hồi quy (cổng 3051, `dist` riêng `.qa-dot51/dist-51`, KHÔNG chạm `dist/`):** `twin3d` **103 tệp / 2 452** · 4 lưới phạm vi **180/180** · census `phamViDoc`+`phamViTuyen` **2/37 XANH** (bác nghi ngờ "không tái lập được") · fleet+robot **22/200** (y hệt Đợt 50) · presence 11 · twinCanh 7 · `kiem-vo` 30 + `scripts/kiem-vo-app-https.mjs` ĐẠT · e2e bấm cảnh **16/16 ×2 lượt** (một lượt KHÔNG đặt ENV, một lượt có) · `playwright --list` 151 test / 30 tệp · `check` 0 · `i18n:check` 0 · `lint:tokens` 0 · **census `git archive` A 342 · C 474 · D 1119 · S 324 · tổng 2267 y hệt `4215c526` và `bab5943a` ⇒ Đợt 51 đổi 0 thủ tục** · **D-1 48 ca: ĐẠT 41 · SAI 0 · CHẶN-ĐÚNG 5 · N/A 1 · 0 ĐỔI PHÁN QUYẾT so với Đợt 50** (hàng tạm user 0-quyền + andon raised 189 tạo→xoá bằng `trap`, đếm lại 0 sót) · DB 11 khoá y nguyên ba mốc · md5 5 ảnh `test-results/` 5/5 · md5 8 tệp tracked `.qa-dot47/e2e` 8/8 · cổng 3000/3001/3008/8080 giữ nguyên PID đầu phiên. **Test đỏ của agent: 0.**

**★★★ G108 lặp lại — cổng chưa ai chạy: `npm run check:tests` ĐỎ tại HEAD, exit 2 / 32 lỗi TS.** Không có trong brief, Đợt 50 cũng không chạy. Đo lại trên cây `git archive 4215c526`: **32 lỗi, phân bố giống hệt từng tệp từng số** ⇒ nợ có sẵn, 0 lỗi nằm trong `e2e/`. Liệt kê MỌI script kiểm của `package.json` vào cổng — đúng điều G108 đã dặn sau 35 đợt `i18n:check` đỏ mà không ai chạy.

**Brief tôi sai lần 24 (4 chỗ) + 2 lỗi của chính tôi:** (1) `.qa-dot50/BAO-CAO.md` **không tồn tại** (Đợt 50 ghi `04-hoi-quy-XONG.txt`/`05-ketcuc-goc-XONG.txt`); (2) "`twin-dot47:13` vẫn ghim cứng ⇒ đọc `TWIN_E2E_ANH`" — ENV **đã có từ Đợt 49**, cái hỏng là MẶC ĐỊNH; (3) brief nêu 1 spec, thật có **7**; (4) A.6 "chèn 100 hàng tạm" là **phép đo không đủ nhạy** — bị round-trip mạng chi phối, cho *âm tính giả*; phải `INSERT…SELECT 20 000` + ablation xen kẽ mới có dấu. **Lỗi của tôi:** bộ quét đường ra **mù dot26/dot31** (bắt bằng grep theo HẰNG SỐ ở lần hai); và bản vá đầu của chính hàng rào **đẻ 15 thư mục rỗng chỉ với `playwright --list`** vì `mkdir` chạy lúc nạp module — tách `taoThuMuc()` ra, đo lại = 0.

> #### ★★★ G132 - **KẾT CỤC ĐẠT KHÔNG PHẢI BẰNG CHỨNG CỦA BẢN VÁ: PHẢI GỠ BẢN VÁ RA VÀ ĐO LẠI.**
> F1 sau index: p90 2 443 → 1 545 ms, đột biến 2/28 → **0/28**. Đọc theo cách thường thấy: "index đóng kết cục". Gỡ index, chạy lại đúng phép đo: **vẫn 0/28**. Điều kiện sinh ra đột biến 6 217 ms của Đợt 50 **không tái hiện** — nên phần lớn cải thiện là của MÔI TRƯỜNG, không của bản vá. Nhân quả chỉ đứng vững ở nơi ablation hai chiều còn phân giải được: tầng truy vấn (0 vs 11 câu chậm, 8 là `traSucKhoeMay`). **Mọi số "sau khi vá" đều phải có số "gỡ vá ra" đứng cạnh, cùng phiên, cùng tải** — nếu không, ta đang ghi công cho mình vì trời hôm nay đẹp. (Họ G112 · G131 · và lặp lại đúng bài học Đợt 49 mục B "điều kiện lỗi không tái hiện trên DB dev".)

> #### ★★ G133 - **MỘT BIẾN MÔI TRƯỜNG NGƯỜI CHẠY PHẢI NHỚ ĐẶT KHÔNG PHẢI HÀNG RÀO — MẶC ĐỊNH MỚI LÀ HÀNG RÀO.**
> Đợt 49 thêm `TWIN_E2E_ANH` để cứu bằng chứng Đợt 47, và **giữ mặc định trỏ vào chính thư mục cần cứu**. Đợt 50 chạy không đặt ENV ⇒ mất 103 tệp. Vá đúng là đổi **mặc định** thành an toàn bằng một BẤT BIẾN ("thư mục đích đã có tệp ⇒ không ghi vào đó"), có lối thoát phải gõ ra (`QA_GHI_DE_BANG_CHUNG=1`) và **không làm suite đỏ** — nghiệm bằng cách tái diễn đúng kịch bản đã gây tai nạn.

**Còn mở:** (1) **2–3/44 đột biến của Đợt 50 vẫn chưa có nguyên nhân** — không định vị được vì không tái hiện; muốn đóng phải bắt được điều kiện sinh ra chúng trước. (2) `check:tests` 32 lỗi TS nợ có sẵn. (3) `capChuoiVarcharDuongIngestMacDinh.test.ts` 4 đỏ — neo cứng, đề xuất neo theo lời gọi. (4) **Index MỚI chỉ có trên DEV**; production cần cửa sổ bảo trì, thủ tục 3 bước ghi ở cuối `drizzle/0356`. (5) 67 harness trong `.qa-dot30…50/` vẫn ghi sang thư mục của ĐỢT KHÁC (`.qa-dot51/B-quet-SAU.json`) — không sửa tệp đợt cũ, nhưng ai dùng lại phải `grep -n "qa-dot"` trước.


#### 14q.30.1 Đo lại độc lập (chủ dự án)
HEAD `389fa9b3`, 5 commit đã push `fresh`. Tôi đo lại: `vitest twin3d` **103 tệp / 2 452 xanh** · `npm run check` exit 0 · **`npm run check:tests` exit 2 / 32 lỗi TS** (xác nhận nợ có sẵn agent báo — từ nay vào cổng thường trực) · index **`idx_health_machine_created_desc` 6 616 kB CÓ THẬT trong DB dev** (`pg_indexes`, cạnh 7 index cũ) · md5 5 ảnh `test-results/` 5/5 · DB 6 khoá y trước · cổng 3051 tắt, 3000/3001/3008/8080 nguyên · `.qa-dot47/` vẫn **103/616 tệp 0 byte** — không đắp, không xoá (G130). Cây mã sạch, index git rỗng.

**Đợt 52 = QA lần 8 NGHIỆM THU CUỐI** (chủ sở hữu chọn): chấm yêu cầu gốc + *tối ưu · nhanh · đẹp · trực quan* + QĐ-18/19/21/23/24/25/27, bấm tâm khối máy ≥ 5 máy/màn/vp **kể cả máy bị nhãn phủ**, F1 ≥ 7 lượt, `[SLOW QUERY]` đọc từ **stderr**, 22 trạng thái vi+en, D-4 6 vai, và **chạy MỌI script kiểm trong `package.json`** (G108 đã cắn 4 lần).

### 14q.31 Đợt 52 — QA lần 8 NGHIỆM THU CUỐI: 290/308, chỉ "đẹp" còn thiếu đúng một thứ (2026-09-12, commit `52e62d94`)

**Tổng theo rổ 308 ca: ĐẠT 290 · SAI 5 · HỎNG 0 · CHẶN-ĐÚNG 9 · N/A 4.** K8 (bấm máy) 46/48 · K9 (chọn Line) 6/6 · F1 28/28 · 40 s đứng yên 6/6 · thị giác 46/46 · bbox 34/34 · nhãn×badge màn Máy 28/32 · D-1 41 ĐẠT/5 chặn-đúng/2 N/A · D-2 50/54 · hợp đồng trạng thái 5/6. D-4 chấm riêng: **lệch 0/299** (288 tRPC × 6 vai + 6 socket + 5 HTTP v1).

| Mục nghiệm thu | Phán quyết | Số |
|---|---|---|
| **Yêu cầu gốc** (chọn Line → Line 3D, chọn máy → Machine 3D) | **ĐẠT** | Máy **24/24** `mouse.click` tâm khối ⇒ đúng `/twin/may/:id` (**gồm 5 máy mà tâm bị nhãn máy khác phủ** — kết cục Đợt 49 đứng vững), trễ trong trang 0–0,5 ms; Line **6/6** |
| **Tối ưu** | **ĐẠT** | `__soCanvas=1` cả 3 màn · `demObject` 1/1/1 · draw 3–6 (trần 150) · 0 khung/40 s × 3 màn, rAF 0, commit R3F 0 |
| **Nhanh** | **ĐẠT** | p50 **1 169** · p90 **1 284** · max **1 300** ms · **0/28** > 2 500 ms · `traSucKhoeMay` 0 câu chậm (QĐ-27 có hiệu lực) |
| **Đẹp** | **CHƯA** | 34/34 bbox, 0 tràn, 46/46 trạng thái sạch — thiếu **đúng 1 thứ**: màn Máy của máy *đang có cảnh báo*, badge đè **17–35 %** nhãn tên (4/4 ca vp × ngôn ngữ) |
| **Trực quan** | **ĐẠT** | 0 nhãn ngoài canvas / bị che · chip "còn N tên bị ẩn" nhìn thấy · vòng sức khoẻ đổi màu theo hạng (đọc trên 6 ảnh) |
| **QĐ-18/19/21/23/24/25** | **ĐẠT** | studio chặn riêng · 1 canvas/màn 30/30 · URL phân cấp 30/30 · redirect 20/20 + 2 đối chứng trượt đúng · what-if ở màn Line · API key thiếu scope ⇒ 404 |
| **QĐ-27** | **ĐẠT (dev)** | index có thật, `traSucKhoeMay` 0 câu chậm — **production chưa áp** |

**Pareto SAI (2 nguyên nhân / 5 ca).** (1) **4 ca** — màn Máy **không có** chính sách tránh nhau `lop-nhan` ↔ `lop-canh-bao` (ở `/twin`/Line có `chinhSachNhan` + `locBadge`: badge dời chỗ 30 lần, cặp chồng 0). Lỗ đo: lưới 22 trạng thái dùng `/twin/may/14` — máy **0 cảnh báo** — nên trạng thái này **chưa bao giờ vào lưới**. (2) **1 ca** — `assetCockpit.machineDetail.liveState.value.operationStatus = **null**` ⇒ `factoryCommandService.ts:576` mất dữ kiện ⇒ `mapMachineStatus` rơi `default:` ⇒ **`machineDetail`="running" trong khi `overview`="idle"** cho cùng máy đang kết nối; chỉ lộ khi chèn nhịp tim `now()` (8 đợt trước mọi máy offline nên hai bề mặt tình cờ bằng nhau — đúng họ G105).

**Pareto hiệu năng (không tính SAI):** `server/services/factoryCommandService.ts:289` còn **bản sao thứ hai của đúng lớp lỗi QĐ-27**: `DISTINCT ON machine_health_history`, không WHERE, `ORDER BY timestamp` (index mới là `createdAt DESC`) ⇒ Seq Scan **214 197 hàng** → external merge **8 824 kB** → **136,7 ms**, và **nằm trên đường người dùng cả 3 màn Twin** (`useTrangThaiSong.ts:87`).

**Bảng cổng `package.json` — chạy HẾT (G108 lần 5).** Xanh: `check` · `i18n:check` · `lint:tokens` · `i18n:audit` · `kb:stale-check` · `vision:validate` · `lake:verify` · `kiem-vo-app-https`. **ĐỎ:** `check:tests` 32 lỗi TS (**5 lỗi nằm TRONG `client/src/components/twin3d/van-hanh/`**) · `kb:operational-cards:test` 194≠164 · `ext:check` thiếu `@types/vscode` · `vitest` toàn bộ 96 tệp/196 test (0 trong twin3d). Chưa chạy có lý do: `test:e2e` toàn bộ (spec ghi DB dev ngoài trap).

**Lỗi của QA, 5/6 nằm ở THIẾT BỊ ĐO** — và mỗi cái đều bị chính phép đo khác bác: đếm khung bằng `__thongKeVe.calls` (draw call một khung) ⇒ đối chứng "kéo vẫn vẽ" trượt, phải đếm **đổi định danh object**; gom số thị giác nhầm khoá ⇒ "toàn 0" GIẢ; K9 0/6 SAI vì điều hướng trong trang làm rơi `?do=1`; diff D-4 lần đầu chỉ so 12/288 lượt; `grep "QĐ-19"` rỗng vì tài liệu viết "QD-19". **Brief tôi sai 4 chỗ**, nặng nhất: **mục 1 bỏ mất nửa yêu cầu gốc** (chỉ bấm MÁY, không có ca nào đi đường người dùng cho **chọn Line**) — QA tự thêm K9; và K8i "đổi tầng/toà nhà" **không đo được** vì DB dev chỉ có **1 toà / 1 tầng**.

> #### ★★★ G134 - **LƯỚI TRẠNG THÁI CHỌN MẪU "SẠCH" THÌ TRẠNG THÁI CÓ SỰ CỐ KHÔNG BAO GIỜ ĐƯỢC ĐO.**
> 22 trạng thái thị giác chạy suốt 20 đợt trên `/twin/may/14` — máy **0 cảnh báo**. Màn Máy chưa bao giờ có badge để mà chồng, nên lỗi "badge đè nhãn 35 %" sống sót qua mọi lần QA cho tới khi ai đó chọn `/twin/may/18`. **Chọn mẫu theo TRẠNG THÁI cần phủ (có/không cảnh báo, có/không dữ liệu tươi), không theo mẫu tiện tay**; danh sách trạng thái phải nằm trong lưới, không nằm trong trí nhớ người chạy.

> #### ★★ G135 - **HỢP ĐỒNG TRẠNG THÁI CHỈ VỠ KHI DỮ LIỆU SỐNG XUẤT HIỆN — "HAI BỀ MẶT BẰNG NHAU" TRÊN DỮ LIỆU CHẾT LÀ SỰ TRÙNG HỢP.**
> Đợt 34 đóng "một hợp đồng trạng thái" và 8 đợt sau đều xanh — vì mọi máy đều offline, mọi bề mặt cùng nói "offline". Chèn một nhịp tim `now()` là hai bề mặt tách đôi ngay (`machineDetail` "running" vs `overview` "idle") do nhánh `default:` suy ra "running" khi thiếu dữ kiện. **Bất biến trạng thái phải đo trên dữ liệu SỐNG (chèn nhịp tim tạm), và nhánh thiếu-dữ-kiện phải fail-safe, không suy ra trạng thái đẹp nhất.**

**Đợt 53 (giao tiếp — kỹ thuật, tự quyết):** A đóng "đẹp" (chính sách tránh nhau ở màn Máy + mở lưới 22 trạng thái sang máy CÓ cảnh báo, ablation 2 chiều) · B `mapMachineStatus` fail-safe + bất biến 6 bề mặt thành lưới tự động · C vá bản sao câu chậm `factoryCommandService.ts:289` + quét mọi `DISTINCT ON` trên đường người dùng · D ghi bảng nợ (`check:tests` 32 lỗi trong đó 5 ở twin3d, `kb:operational-cards`, `ext:check`, 1 toà/1 tầng chặn bộ chọn nạp).

### 14q.32 Đợt 53 — đóng 3 món cuối của QA lần 8 (2026-09-12, 5 commit `0cf85226…6fea6ae3`)

**A — "đẹp" ĐÓNG, và gốc rễ KHÔNG phải như brief tôi viết.** Ba màn dùng chung `<CanhVanHanh>` nên chính sách tránh nhau **có đủ**; đo từ cơ chế: `/twin` badge vẽ 7 / vào sổ 7, Line 2/2, **`/twin/may/18` vẽ 1 / vào sổ 0** ⇒ 1 cặp chồng. Badge `badge-canh-bao-11` bị **kẹp rìa** (`data-ngoai-khung="1"`, §10.3 luật 3) ⇒ `locBadge` trả `hop=null` ⇒ `LopCanhBao` `filter(h!==null)` **ném nó khỏi sổ `hopDaVe`** ⇒ lớp nhãn không biết badge tồn tại. Vá: thêm trường bắt buộc `hopManHinh` (hộp thật sự chiếm pixel, luôn có) vào sổ; `hop` giữ hợp đồng cũ. **Trước 4/16 ca chồng · 4 668 px² (35 % @1600, 17 % @1280, badge TRÊN) → sau 0/16 · 0 px²**, nhãn vẫn vẽ (`ve=1`, `biChe=0`), dời xuống 52 px, trọn trong canvas. Lưới 22 → **24 trạng thái** (thêm `may/co-canh-bao` = `/twin/may/18`) × 2 vp × vi/en: cặp nhãn×badge 0, bị che 0. **Ablation:** gỡ vá ⇒ lưới mới ĐỎ 7/9 **trong khi lưới cũ (`locBadge` + `lopCanhBaoNoiVaoCanvas` + `hopDaVe`) vẫn XANH 38/38** — bằng chứng lưới cũ mù đúng lớp lỗi này. Agent làm **ngược chiều brief** (tôi viết "badge dời, nhãn giữ") và nói rõ vì sao: hợp đồng kit Đợt 47 là badge giữ chỗ, nhãn nhường — đảo lại sẽ thành hai luật cho ba màn. Chủ dự án tự đọc ảnh trước/sau: badge cắt đôi chữ → badge ở mép trên, cả hai đọc được.

**B — một hợp đồng trạng thái, ĐÓNG hai nửa.** Tái hiện bằng nhịp tim `now()` tạm (hb 108→109→108, `trap`): 2/6 bề mặt sai (`machineDetail` và `assetCockpit.liveState.statusMapped` = "running" trong khi 4 bề mặt kia "idle"); sau vá **6/6 nói một chữ**. Hai nửa: (1) `assetCockpitService` đọc thêm cột `operationStatus` **trong đúng truy vấn đã chạy** cho `lastHeartbeat` (0 truy vấn thêm) — brief tôi bỏ sót nửa này, sửa `default:` một mình sẽ hỏng replay; (2) `mapMachineStatus` thiếu dữ kiện ⇒ **`idle`** (fail-safe), `VAN_HANH_XAP_XI_KET_NOI` là cửa duy nhất còn lại ra `running`; `trangThaiLichSuTaiMoc` khai tường minh nên không đổi một bit. Gỡ vá ⇒ ĐỎ 5 ca, chỉ đích danh `assetCockpitService.ts:580` + `trangThaiMayTuoi.ts:168`. Lưới mới `hopDongTrangThaiMotChu.test.ts` là **bất biến quét** (đọc mọi tệp `.ts` sản phẩm, cắt đối số thứ 2 của mọi lời gọi) ⇒ đường thứ tư ngày mai cũng bị bắt.

**C — bản sao câu chậm, ĐÓNG bằng MỘT TỪ, không index mới.** `ORDER BY "timestamp"` → `"createdAt"` (cột index QĐ-27 đã phủ): EXPLAIN ×6 trên 215 079 hàng **Seq Scan → Sort external merge 8 864 kB → 103,9–126,1 ms** thành **Index Scan 0,098–0,418 ms (~800×)**; 43 hàng **giống hệt theo byte**, md5 `overview` khớp trước/sau trên 2 vai. Agent khai thật: `pdmRiskHigh` = 0/41 trên dev nên bằng chứng nặng nhất nằm ở mức SQL. Quét 4 câu `DISTINCT ON` trên đường overview: **chỉ 1/4 là bệnh thật** (đã vá), 3 câu còn lại bảng ≤ 7 814 hàng, 0,03–7,5 ms, sort trong RAM ⇒ để nguyên; 26 chỗ ngoài đường Twin chưa đo.

**F1 "nhanh" — số xấu hơn nền nhưng KHÔNG phải hồi quy.** 7 lượt trên bản vá: p50 1 465 / p90 2 375 / max 3 704, 2 đột biến (nền Đợt 52: 1 169/1 284/1 300, 0). Cơ chế nói ngược ⇒ agent **dựng lại build TRƯỚC vá** và chạy **xen kẽ 4 lô**: trước vá 1 492/3 327/8 784 (6/32) vs sau vá 1 510/3 198/14 585 (6/32) ⇒ không phân biệt được ⇒ lệch là **môi trường đo** (node 27→32 tiến trình, ba server phiên khác giữ ~11 GB RSS). Hiệu lực mục C đo độc lập tải bằng `[SLOW QUERY]` (**stderr**): bản trước vá có 1 câu `DISTINCT ON machine_health_history` 325 ms, bản sau vá **0/58**.

**Hồi quy:** `twin3d` **104 tệp / 2 461** (+1 tệp, +9 ca = lưới mới) · 4 lưới phạm vi 180/180 · e2e bấm cảnh 16/16 · **K8 24/24 cú bấm máy đúng, K9 6/6** · bbox 34/34 · lệch lớp 14/14 · **D-1 cột 53 y hệt cột 52** · D-4 lệch 0/96 (2 vai còn sống) · `check` 0 · `i18n:check` 0 · `lint:tokens` 0 · DB 11+6 khoá lệch 0 · md5 5 ảnh + `.qa-dot47` 616/616 không đổi · 3053 tắt. Test đỏ của agent: 2, **đã đóng cả hai** — trong đó `assetCockpitService.test.ts:341` đang **ghim chính hành vi sai** (`statusMapped==="running"`), bắt được ở lượt quét thứ hai.

> #### ★★★ G136 - **PHẦN TỬ VẪN VẼ NHƯNG BỊ LỌC KHỎI SỔ DÙNG CHUNG ⇒ SỔ NÓI DỐI VỚI MỌI LỚP KHÁC.**
> `locBadge` trả `hop=null` cho badge **kẹp rìa** (vẫn chiếm pixel!), `LopCanhBao` `filter(h!==null)` ⇒ badge không vào `hopDaVe` ⇒ lớp nhãn tính chỗ như thể nó không tồn tại, và đè lên nhau 35 %. Lưới cũ xanh 38/38 vì tất cả đều đọc **cùng cái sổ đã thiếu**. **Sổ chia sẻ giữa các lớp phải có trường "hộp thật sự chiếm pixel" luôn tồn tại; `null` chỉ được mang nghĩa "không vẽ", không bao giờ mang nghĩa "vẽ nhưng không tính".** Kiểm bằng cặp số **vẽ vs vào sổ** ở mọi màn — lệch là bug.

> #### ★★ G137 - **`[SLOW QUERY]` TRỘN "CHẬM LÚC NGUỘI" VỚI BỆNH THẬT — XẾP ƯU TIÊN PHẢI ĐỌC EXPLAIN ẤM.**
> `oeeService.ts:837,855` vào log chậm 249/349 ms nhưng EXPLAIN ấm 0,3/0,01 ms ⇒ chỉ là lần chạy nguội, không phải bệnh. Đọc log để **tìm ứng viên**, đọc EXPLAIN ấm để **xếp ưu tiên** (cùng họ G131: ai gọi × tần suất).

> #### ★★ G138 - **MỘT SCRIPT TRONG BẢNG CỔNG CÓ THỂ GHI VÀO CÂY: `kb:operational-cards:test` ghi đè 169 tệp tracked dưới `knowledge/`.**
> Agent phát hiện khi chạy hết cổng theo G108, đo hai lần liên tiếp: **366/367 tệp byte-y-hệt**, chỉ `chunks-stats.json.generatedAt` đổi ⇒ lượt chạy chỉ đổi mtime. Và nó **không khôi phục** vì `knowledge/` đã bẩn sẵn bởi phiên khác — khôi phục là xoá việc đang dở của họ. **Trước khi đưa một script vào cổng, đo xem nó có ghi vào cây không; cổng phải chạy trên bản sao hoặc được khai rõ là "có tác dụng phụ".**

**Đợt 54 (giao tiếp — QA lần 9, xác nhận):** chấm lại riêng 5 SAI của QA lần 8 (4 ca badge×nhãn ở máy CÓ cảnh báo + 1 ca hợp đồng trạng thái trên **dữ liệu sống**), kiểm mục C bằng `[SLOW QUERY]` từ stderr + EXPLAIN ấm, và toàn bộ hồi quy + bảng cổng `package.json` (ghi rõ `kb:operational-cards:test` có tác dụng phụ — chạy hay không là quyết định có khai). Nếu 5/5 đóng và 0 hồi quy ⇒ **"đẹp" ĐẠT ⇒ nghiệm thu cuối đủ 5/5 tiêu chí**.

### 14q.33 Đợt 54 — QA lần 9 XÁC NHẬN: **nghiệm thu cuối ĐẠT 5/5 tiêu chí** (2026-09-12, commit `a65af5a5`)

**625 ca đo · 0 SAI · 0 HỎNG · 13 CHẶN-ĐÚNG · 2 N/A.** Mỗi món đo **hai lần**: trên HEAD và trên build ablation `dist-54z` dựng lại từ `9f6da8ca` — bundle hash **trùng khít** bản Đợt 52 ⇒ đúng là nền của QA lần 8.

| Món | HEAD | Ablation (nền QA lần 8) | Phán quyết |
|---|---|---|---|
| S1–S4 badge đè nhãn (máy CÓ cảnh báo) | **0/20 cặp · 0 px²** | **8/20 cặp · 11 928 px²** | ĐÓNG |
| G136 badge VẼ vs VÀO SỔ | **20/20 + 48/48 bằng nhau** | máy 18 & 23: vẽ 1 / sổ **0** | ĐÓNG |
| S5 sáu bề mặt trên dữ liệu sống | **6/6 nói một chữ** (`idle`) | **2/6 sai** (`running`, `operationStatus=null`) | ĐÓNG |
| S5b thiếu dữ kiện (tầng hàm) | `null`/`undefined`/`""` → **idle** | cả ba → **running** | ĐÓNG |
| S-C `[SLOW QUERY]` (stderr) + EXPLAIN ấm | **0 câu** `DISTINCT ON` · **0,10 ms** | **2 câu** (259,9 / 202,0 ms) · **114–153 ms** | ĐÓNG |

★ **Phát hiện ngoài cả hai đợt trước:** máy **23 (SIM-L2-ROBOT)** cũng có andon chưa resolved và cũng dính lỗi — **nặng hơn máy 18: 52 % vs 35 %**. QA lần 8 và Đợt 53 chỉ mở `/twin/may/18`, nên con số nền "4/16" ở §14q.32 là **đếm thiếu** (thật: 8/20). Bản vá ở **cơ chế** (`hopManHinh`) đóng luôn ca chưa ai nhìn thấy — đúng lý do phải vá cơ chế thay vì vá ca.

**Phán quyết nghiệm thu:** Yêu cầu gốc **ĐẠT** (24/24 bấm tâm khối máy + 6/6 chọn Line + e2e 16/16) · Tối ưu **ĐẠT** (1 canvas/màn, 0 khung/40 s × 3 màn, đối chứng kéo 87/76/83 khung) · Nhanh **ĐẠT** · **Đẹp ĐẠT** (khoảng cách duy nhất của QA lần 8 đã đóng) · Trực quan **ĐẠT** · QĐ-18/19/21/23/24/25 **ĐẠT** · **QĐ-27 ĐẠT trên dev — production vẫn CHƯA áp index**.

**Hồi quy 0.** F1 tuần tự lệch nền 52 ⇒ QA **chạy xen kẽ 4 lô hai build** (đúng bài học Đợt 53): 54a `p50 1 181 / p90 1 579 / max 2 107 / **0 đột biến**` vs 54z `1 161 / 1 754 / 4 495 / 2` ⇒ bản có vá **không chậm hơn và là bản duy nhất 0 đột biến**. D-1 cột 54 y hệt cột 53 · D-2 60 ĐẠT + 4 đối chứng trượt đúng · D-4 lệch **0/288** với **6/6 vai đăng nhập được** (bác lời khai Đợt 53 "4/6 vai bị xoá") · `twin3d` 104/2 461 · phạm vi 180/180 · bbox 34/34 · `nc` 41 = nền.

**Bảng cổng:** `check` 0 · `i18n:check` / `lint:tokens` / `i18n:audit` / `kb:stale-check` / `vision:validate` / `lake:verify` 0 · `check:tests` **32 lỗi nền, 5 nằm trong `twin3d/van-hanh`** (`cayVanHanh.unit.test.ts:38,91` thiếu `tangId`; `hopNhatCanh.unit.test.ts:54,216,239` sai kiểu `KhoiKey`) · `ext:check` 2 (môi trường) · `kb:operational-cards:test` 1 (194≠164) · `npm test` 97 tệp/205 ca đỏ, **0 tệp `twin3d`**. **G138 thực hành:** QA có chạy `kb:operational-cards:test`, đo tác dụng phụ bằng md5 (**365/367 tệp byte y hệt**, 2 tệp đổi) và **không khôi phục** vì `knowledge/` đang do phiên khác làm dở.

**Brief tôi sai 4 chỗ:** "4 ca badge" → thật **8** (thiếu máy 23) · "ca thiếu dữ kiện trên dữ liệu sống" **không dựng được** (`machines."operationStatus"` là ENUM NOT NULL — chặn `NULL` 23502 và `''` 22P02), phải đo ở tầng hàm · "Đợt 53 báo 4/6 vai bị xoá" **sai**, 6/6 vai đăng nhập 200 · "24 trạng thái" thực là 12 trạng thái × 2 vp.

**Lỗi của QA — 6, đều ở thiết bị đo, 4/6 do đọc CHUỖI thay vì đọc CẤU TRÚC:** 3 lần ra "toàn 0" giả (MSYS đổi `/twin` thành đường dẫn Windows; gom thị giác nhầm khoá; gom `nc` nhầm khoá ⇒ "0 = 0" khớp giả) và 1 lần **báo động giả "225 tệp đỏ, 7 tệp twin3d"** (thật 97 tệp, **0** twin3d). Vì vậy **mọi kết luận "0" trong báo cáo đều kèm ablation chứng minh thiết bị đo biết kêu khác 0** — kể cả lưới thị giác (chạy trên 54z ⇒ kêu đúng 1 cặp chồng).

> #### ★★★ G139 - **MỘT KẾT LUẬN "0" CHỈ CÓ GIÁ TRỊ KHI CÙNG THIẾT BỊ ĐO ĐÓ KÊU KHÁC 0 TRÊN NỀN CŨ — VÀ NỀN PHẢI ĐƯỢC CHỨNG MINH LÀ NỀN (bundle hash trùng khít).**
> QA lần 9 dựng lại `dist-54z` từ commit trước vá, đối chiếu **bundle hash trùng khít bản Đợt 52**, rồi chạy **cùng một harness** trên cả hai: HEAD 0/20 cặp chồng, nền 8/20 · HEAD 0 câu chậm, nền 2 câu · HEAD 6/6 bề mặt đồng thuận, nền 2/6 sai. Không có bước này thì "0" chỉ là lời khai của một thiết bị đo đã 4 lần cho "toàn 0" giả trong cùng phiên. **Ablation không phải thủ tục cuối cùng — nó là cách duy nhất đọc được số 0.**

**Còn mở sau nghiệm thu (không chặn):** production chưa áp index QĐ-27 (chờ chủ sở hữu, cửa sổ bảo trì) · `check:tests` 5 lỗi TS trong `twin3d/van-hanh` (Đợt 55) · `kb:operational-cards:test` / `ext:check` / `npm test` đỏ sẵn **ngoài Twin** · `test:e2e` toàn bộ chưa chạy · bộ chọn tầng chưa đo được (DB dev 1 toà/1 tầng) · 41 cặp nhãn ∩ khối máy khác (G128, kết cục click đã đúng) · 26 chỗ `DISTINCT ON` ngoài đường Twin chưa đo EXPLAIN.

## 14n. §15 — THIẾT KẾ LẠI 3D TWIN BA CẤP: NHÀ MÁY → LINE → MÁY (ĐỢT 25, 2026-09-09)

> **Vì sao mục này mang số 14n chứ không phải 15.** Tệp này **đã có `## 15. Tiêu chí nghiệm thu tổng
> thể`** (dòng 6076) và `## 15b. Nợ i18n` (dòng 6110) từ trước. Chiếm lại số 15 sẽ tạo hai mục cùng
> số trong một tệp sắp đem ra bàn. Đây **đúng cùng lý do và cùng cách xử lý** đã dùng cho §12b (Đợt
> 14) và §14 (đặt dưới `## 13b`, Đợt 20). ★ Đánh số bên trong giữ dạng **15.x** như brief yêu cầu.
>
> **Trạng thái: BẢN THIẾT KẾ ĐỂ CHỦ SỞ HỮU DUYỆT. KHÔNG CÓ MÃ NÀO ĐƯỢC SỬA trong đợt này.**
> Cổng ra: `git status --porcelain -- '*.ts' '*.tsx'` **rỗng** · 5 ảnh lô C md5 y hệt.
>
> Mục này trả lời yêu cầu nguyên văn của chủ sở hữu:
> *"Tôi thấy không ổn: Chúng ta có tận 2 page cho Twin 3D: 1. `/twin-studio`, 2. `/twin?cam=…`,
> 3. `/digital-twin`, 4. `/command-center`… twin studio là nơi thiết kế… còn lại 3 màn hình còn lại
> đang quá phức tạp… thiết kế 3D Twin sao cho **từ nhà máy chọn Line thì hiển thị dialog show
> production Line 3D Twin, chọn vào máy (Cell) thì sẽ hiển thị Machine 3D Twin**. Thiết kế lại toàn bộ
> dựa trên những gì đã có để biến 3D Twin thực sự tối ưu, nhanh, đẹp và trực quan nhất, làm báo cáo
> thiết kế chi tiết trước (các màn hình, layout mỗi màn hình, các thông tin hiển thị...)"*

---

### 15.0 ★★★ NĂM ĐIỀU BRIEF ĐỢT 25 NÓI SAI — ĐO LẠI 2026-09-09

Ghi ra trước. Một bản thiết kế dựng trên hiện trạng sai sẽ đề xuất **làm lại thứ đã làm xong** — và
đó là cách tiêu tiền nhanh nhất mà không mua được gì. Cả năm đo trên worktree `D:\SOURCES\_twin_wt`,
HEAD `0213c547`.

| # | Brief / chủ sở hữu nói | ĐO ĐƯỢC 2026-09-09 | Hệ quả cho thiết kế |
|---|---|---|---|
| **S-1** | *"Có tận 4 page cho Twin 3D"*; bảng brief liệt kê `/twin-studio` là **màn riêng cần GIỮ** | **Chỉ còn 2 tuyến sống.** `App.tsx:368` `<Route path="/twin-studio"><Redirect to="/twin?che-do=botri" /></Route>` — `/twin-studio` **đã là redirect** từ Đợt 21. `App.tsx:345-348` `/digital-twin` cũng **đã là redirect** qua bảng `dinhTuyenTwinCu.ts`. Hai tuyến thật còn lại: **`/twin`** (`:354`) và **`/command-center`** (`:487`) | ⇒ Việc "gộp 4 → N" **đã làm 2/3 rồi**. Còn **đúng một** món gộp thật: `/command-center`. Xem 15.4 |
| **S-2** | *"Chọn máy ⇒ mở **ngăn nhúng** qua `?xem=machine:<id>` — **không** phải dialog"* | ⚠ **Nửa đúng, nửa sai.** `NganNhung.tsx:35-45` ghi rõ nó **là `Sheet` = Radix Dialog: modal thật, có overlay, focus trap, `aria-modal`, khoá cuộn nền, `Esc`**. Nó **đã là dialog**. Cái nó **không** có là **cảnh 3D của máy** — nó nhúng `MachineCockpitBody`/`RobotCockpitBody` (`:92`,`:95`), tức **thân màn 2D cũ** | ⇒ Khoảng trống thật **không phải** "dialog vs ngăn". Là **"trong dialog có 3D hay không"** |
| **S-3** | *"Chọn Line ⇒ đổi phạm vi + bay camera (`phamViCanh.ts:65`)"* | `phamViCanh.ts:65` là **`trongPhamVi()`** — vị từ lọc *"vật thể có nằm trong phạm vi không"*, **không** phải bay camera. Camera cấp Line ở **`TwinVanHanh.tsx:1965-1966`** (`khungNhinLine(hinhLine.hh.bbox, …)`) | ⇒ Chẩn đoán **đúng triệu chứng, sai `file:line`**. Đợt xây phải sửa ở `:1965`, không ở `phamViCanh.ts` |
| **S-4** | Chủ sở hữu: *"3 màn hình còn lại đang quá phức tạp"* — ngụ ý phức tạp trải đều 3 màn | Đo dòng: `TwinVanHanh` **3.754** · `TwinHub` **140** (0 lối vào URL) · `CommandCenter` **1.596**. Và `TwinVanHanh` là **MỘT hàm duy nhất** — `export default function TwinVanHanh()` ở `:250`, **không có component con nào ở tầng tệp** — chứa **50 `useMemo` · 18 `useState` · 14 `useQuery` · 13 `useCallback` · 6 `useEffect`** | ⇒ **"Gộp màn" KHÔNG chữa được cảm giác phức tạp.** Gốc là **mật độ trong một hàm**, không phải **số màn**. Xem 15.5 |
| **S-5** | Brief: *"nếu mở **3 cảnh 3D cùng lúc** (nhà máy + line + máy), **cộng chi phí** và nói ra"* | ⚠ **Không phải bài toán cộng — là bài toán CẤM.** **RB-4** có **4 chỗ trong mã sản phẩm** ghi nhận: `XuongThietKe.tsx:7` · `TwinVanHanh.tsx:8` · `CanhThietKe.tsx:5` · `DungNhaXuong.tsx:571`. `TwinHub.tsx:8-9` ghi nó *"cố ý dựa vào Tabs-unmount để giữ 1 WebGL context"* | ⇒ Ba cảnh 3D đồng thời **không phải lựa chọn đắt — nó là lựa chọn BỊ CẤM** bởi kiến trúc. Ràng buộc này quyết định toàn bộ 15.2 |

★ **S-5 là điều quan trọng nhất của cả mục này.** Yêu cầu *"chọn Line → **dialog** show Line 3D Twin"*
đọc theo **nghĩa đen** là **hai `<Canvas>` chồng nhau** (cảnh nhà máy phía sau + cảnh Line trong
dialog). Điều đó vi phạm RB-4. Toàn bộ 15.2 tồn tại để trả lời: **làm sao giữ trải nghiệm "dialog"
mà không vi phạm RB-4.**

---

### 15.1 ★★★ ĐỌC LẠI YÊU CẦU — CÁI CHỦ SỞ HỮU MUỐN vs CÁI CHỮ "DIALOG" NÓI

Brief nói đúng: *"«Dialog» là quyết định thiết kế bạn phải cân nhắc, không phải mệnh lệnh kỹ thuật."*
Tôi cân nhắc, và **nói rõ chỗ tôi làm khác chữ**.

**Cái chủ sở hữu thật sự đòi** — rút từ *ba* câu của chính ông ở ba thời điểm:

| Lần | Nguyên văn | Đòi hỏi rút ra |
|---|---|---|
| Đợt 10 | *"không sử dụng redirect chuyển trang để xem rất bất tiện, cần sử dụng **dialog hoặc modal** hiển thị thông tin/**hiển thị trên panel đó luôn** và có **phím back** cũng được để ng dùng **không cần rời màn hình 3D**"* (chép nguyên ở `NganNhung.tsx:8-12`) | **① Không rời màn · ② quay lại được** |
| Đợt 25 | *"từ nhà máy chọn Line thì hiển thị **dialog show** production Line 3D Twin, chọn vào máy (Cell) thì sẽ hiển thị **Machine 3D Twin**"* | **③ Mỗi cấp có CẢNH 3D RIÊNG** |
| Đợt 25 | *"tối ưu, **nhanh**, đẹp và **trực quan** nhất"* | **④ Nhanh · ⑤ đọc được ngay** |

★ Chú ý: ở lần Đợt 10 chính ông viết *"dialog **hoặc** modal **hiển thị trên panel đó luôn**"* — tức
ông **đã coi** *dialog* và *panel tại chỗ* là **hai cách chấp nhận được cho cùng một mục đích**. Chữ
"dialog" ở Đợt 25 vì thế **mô tả trải nghiệm** (*"bật lên ngay, không rời màn"*), **không** ràng buộc
cơ chế (*"phải là `role=dialog` chặn nền"*).

⇒ **Điều MỚI thật sự của Đợt 25 là ③: mỗi cấp phải có CẢNH 3D CỦA RIÊNG NÓ.** Hiện tại:

| Cấp | Cảnh 3D riêng? | Đo được |
|---|---|---|
| Nhà máy | ✅ có | `CanhVanHanh.tsx`, 240 máy = **3 draw calls** |
| **Line** | ❌ **KHÔNG** | Vẫn cảnh nhà máy, chỉ siết camera (`TwinVanHanh.tsx:1965`) + dải 2D `DaiLine` (`:3713`) |
| **Máy** | ❌ **KHÔNG** | Dialog `NganNhung` chứa **thân màn 2D** `MachineCockpitBody` (`:92`) |

Đó là khoảng trống. **Không phải "thiếu dialog".**

---

### 15.2 ★★★ QUYẾT ĐỊNH VỀ "DIALOG" — BỐN LỰA CHỌN, ĐÁNH ĐỔI, VÀ CÁI TÔI CHỌN

Bài toán: hiện **cảnh 3D của Line** (hoặc của Máy) mà **không rời** cảnh nhà máy, dưới **RB-4: một
`<Canvas>`**.

| | **L1 — Dialog thật, 2 Canvas** | **L2 — Cảnh THAY THẾ tại chỗ** | **L3 — Dialog thật, 1 Canvas teleport** | **L4 — Panel nổi, ảnh tĩnh** |
|---|---|---|---|---|
| **Cơ chế** | `<Sheet>` chứa `<Canvas>` thứ hai; cảnh nhà máy vẫn sống phía sau | Cùng một `<Canvas>` đổi nội dung + camera; khung/panel giữ nguyên; breadcrumb + `Esc` để ra | `<Sheet>` chứa cảnh; **unmount** cảnh nhà máy khi mở, remount khi đóng | Dialog chứa **ảnh chụp** (`toDataURL`) + số liệu 2D |
| **RB-4** | ❌ **VI PHẠM** — 2 context WebGL | ✅ đạt | ✅ đạt (đúng khuôn `TwinHub.tsx:8-9`) | ✅ đạt |
| **Chi phí GPU** | **2× draw calls, 2× VRAM, 2 vòng `demand`**; iGPU thường trần **8–16 context** nhưng mở/đóng lặp là ca `webglcontextlost` kinh điển | **0 thêm** — cùng cảnh, đổi tập con của `BatchedMesh` | Bằng L2 khi mở, **cộng chi phí dựng lại cảnh nhà máy lúc đóng** | 0 |
| **Thời gian mở** | tức thì (cảnh đã dựng) | **tức thì** — chỉ lọc + bay camera | **chậm nhất**: unmount + dựng cảnh mới + dựng lại cảnh cũ khi đóng | tức thì |
| **① không rời màn** | ✅ | ✅ (URL vẫn `/twin`) | ✅ | ⚠ mất tương tác 3D |
| **② quay lại** | Esc/X | **breadcrumb + `Esc` + nút ← + Back trình duyệt** (vì trạng thái ở URL) | Esc/X | Esc/X |
| **③ cảnh 3D riêng mỗi cấp** | ✅ | ✅ | ✅ | ❌ |
| **④ nhanh** | ⚠ nền vẫn vẽ | ✅ **nhanh nhất** | ❌ **chậm nhất** | ✅ |
| **⑤ trực quan** | ⚠ **hai cảnh 3D chồng nhau = hai câu trả lời cho "nhà máy đang thế nào"** — đúng lỗi **D-5** (§14.5.5) mà dự án vừa dọn | ✅ một cảnh, một sự thật | ⚠ nền biến mất ⇒ **mất ngữ cảnh không gian**, đúng thứ 3D tồn tại để cho | ⚠ ảnh chết |
| **Deep-link** | cần khoá URL mới | ✅ **`?pv=line` / `?pv=may&chon=` ĐÃ CÓ** (`duongDanTwin.ts:38`,`:269`,`:553`) | cần khoá mới | cần khoá mới |
| **Rủi ro `webglcontextlost`** | **cao** | thấp | trung bình | 0 |

#### ★★★ QĐ-17 — CHỌN **L2**, TRÌNH BÀY NHƯ MỘT LỚP NỔI

> **Cấp Line và cấp Máy dùng CÙNG một `<Canvas>`**, đổi nội dung cảnh + camera + mật độ thông tin.
> Về **thị giác** nó *trông như* một lớp bật lên: khung viền dày, phần cảnh ngoài phạm vi **pha về
> nền 72 %** (`TI_LE_PHA_NGOAI_PHAM_VI = 0.72`, `phamViCanh.ts` — **đã có**), tiêu đề
> `LINE 2 — 12 máy`, nút `✕` và `←` góc trên, `Esc` đóng. Về **kỹ thuật** nó **không** là
> `role="dialog"` chặn nền, và **không** dựng Canvas thứ hai.
>
> **Ba lý do đo được, không phải sở thích:**
> 1. **RB-4 là ràng buộc cứng có 4 chỗ trong mã ghi nhận.** L1 đòi **bỏ RB-4** — đó là **đổi kiến
>    trúc**, không phải đổi giao diện, và nó mua lại đúng cái `TwinHub.tsx:8-9` đã cố ý tránh.
> 2. **Trục URL đã tồn tại và đã nghiệm thu.** L2 **không đẻ khoá URL mới (G40)**; ba lựa chọn kia
>    đều phải đẻ. Và vì trạng thái ở URL, **nút Back của trình duyệt tự nhiên thành "phím back" ②**
>    mà chủ sở hữu đòi — **miễn phí**, không viết dòng nào.
> 3. **Một cảnh = một sự thật.** D-5 (§14.5.5) đã bỏ *"ba bộ dựng sàn 3D rời"* vì *"hai cảnh nói hai
>    câu về cùng nhà máy"*. Mở dialog-3D **chồng lên** cảnh nhà máy tái tạo **đúng lỗi đó**, chỉ khác
>    là lần này hai cảnh cách nhau 8 px chứ không cách nhau hai màn hình.

⚠ **Chỗ tôi làm KHÁC chữ của chủ sở hữu — nói thẳng:** ông viết *"hiển thị **dialog**"*. Tôi giao
**trải nghiệm dialog** (bật lên, không rời màn, `Esc` thoát, có nút back) nhưng **không** giao **cơ
chế dialog** (modal chặn nền + Canvas thứ hai). Nếu chủ sở hữu vẫn muốn modal thật chặn nền, **cách
an toàn duy nhất là L3** — và **tôi khuyên không**, vì nó là cách **chậm nhất** trong bốn cách, đúng
thứ ông đặt đầu danh sách (*"tối ưu, **nhanh**"*). ⇒ **Câu Q-1 cần ông trả lời (15.8).**

★ Ở **cấp Máy**, L2 có một biến thể quan trọng: `NganNhung` (`Sheet` thật) **giữ nguyên** cho *"Mở
chức năng"* (cockpit 2D, lịch sử bảo trì, chương trình). Cái **mới** là **cảnh 3D của máy** hiện
**trong cùng `<Canvas>`**, còn `Sheet` 2D nằm **bên cạnh** — không chồng lên. Xem **Hình C**.

★★★ **Ngân sách khi ba cấp cùng "mở" (trả lời trực tiếp câu brief hỏi):**

```
  KHÔNG BAO GIỜ có 3 cảnh sống cùng lúc — RB-4 cấm. Phép cộng đúng là:

  Cấp Nhà máy   240 máy  → 3 draw calls (ĐO ĐƯỢC, §14.5.0) + ~4 nhãn bất thường   =  ~7
  Cấp Line       12 máy  → 1 BatchedMesh + 12 trạm InstancedMesh + 1 đường tâm     =  ~3
                           (cảnh nhà máy KHÔNG bị unmount, chỉ bị PHA VỀ NỀN 72 %
                            — nó vẫn nằm trong CÙNG BatchedMesh ⇒ +0 draw call)
  Cấp Máy         1 máy  → 1 glTF (hoặc khối mặc định §10B) + viền sức khoẻ         =  ~2
  ──────────────────────────────────────────────────────────────────────────────
  TỐI ĐA đồng thời (nhà máy pha nền + line pha nền + máy nét)              ≈ 12 draw calls
  Trần §4 = 150.  Biên còn lại: 138 (92 %).
```

⇒ **Chi phí GPU của thiết kế ba cấp gần như bằng không**, vì cả ba cấp **chia nhau một BatchedMesh**
— đây chính là điều `BatchedMesh` mua được mà `InstancedMesh` không (§4 mục 2: *"render nhiều object
cùng material nhưng khác hình học trong 1 draw call, giữ ID từng object"*).
⚠ **Cái ĐẮT không phải GPU — là NHÃN.** Trần nhãn **30** là trần **đọc được**, không phải trần GPU.
Luật cắt nhãn theo cấp ở **15.6.2**.

---

### 15.3 ★★★ HÌNH VẼ LAYOUT — NĂM HÌNH, KÍCH THƯỚC KIỂM BẰNG SỐ HỌC

> Chủ sở hữu nhấn mạnh *"layout mỗi màn hình"*. Mọi kích thước dưới đây tính trên viewport chuẩn
> **1280×720** — cùng viewport §13e đã đo, để **so sánh được** với hiện trạng.

#### 15.3.0 ★★★ TRẦN DIỆN TÍCH — KIỂM TRƯỚC KHI HỨA (G75)

Trước khi vẽ, chốt lại **mẫu số**, vì §13e.1 đã trả giá một lần cho việc hứa 82 % mà không kiểm:

```
  khung twin khả dụng = 1280 − sidebar 264 − <main> padding 48  =  968 px  (rộng)
                        720 − app chrome 133 − padding 24       =  563 px  (cao)

  TRẦN TUYỆT ĐỐI (canvas ăn TRỌN khung, 0 dải, 0 panel):
        968 × 563 / (1280 × 720)  =  545.  /  921.600  =  59,1 %
  Thu sidebar (nút CÓ SẴN của vỏ):                          72,3 %
```

★ **Mọi con số % trong năm hình dưới đây là % của VIEWPORT 1280×720, và không hình nào vượt 59,1 %
khi sidebar mở.** Bản thiết kế này **tuyên bố trần**, không tuyên bố một con số tuyệt đối.
**Hiện trạng đo được sau Đợt 21: 968×515 = 51,4 %.** Thiết kế này nhắm **968×539 = 53,8 %** — tăng
**+2,4 điểm** bằng cách gộp dải Line vào lớp phủ (15.3.2), **không** bằng cách bỏ thông tin.

---

#### 15.3.1 ★ HÌNH A — CẤP NHÀ MÁY (`/twin?pv=nhamay`, mặc định)

Cảnh mở đầu. Trả lời **một** câu: *"nhà máy đang thế nào, và chỗ nào cần tôi?"*

```
╔═ 1280 ══════════════════════════════════════════════════════════════════════════════════╗
║ ▣ AVI/AOI │ SIM-FAC ▾ │ Nhà máy                    [◉ TRỰC TIẾP · đẩy+hỏi 30s] [⬒2D] [⚙] ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ⚠ 2 việc cần biết ▾  ·  9 máy mất tín hiệu                              [xem] [ẩn]      ║ 24px  ← DẢI HỢP NHẤT (§14.4)
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                         ║
║ ┌──────────────────┐                                             ┌───────────────────┐  ║
║ │ ⬛ TỔNG QUAN     │                                             │ ⚠ CẦN XỬ LÝ  (2)  │  ║
║ │  240 máy         │        ░░░░░░░░░░░░░░░░░░░░░░░░░░░          │                   │  ║
║ │   208 chạy    ▉▉ │      ░░░                       ░░░         │ ● M-114  E-STOP   │  ║
║ │    19 dừng    ▉  │     ░░    KHUÔN VIÊN 3D          ░░        │   Toà A·T2·Line 2 │  ║
║ │     9 mất tín ▉  │    ░░   4 tầng · 20 line          ░░       │   2 phút trước    │  ║
║ │     4 chưa rõ ▉  │    ░░   ▭ toà A     ▭ toà B       ░░       │                   │  ║
║ │                  │    ░░      🔴                     ░░       │ ● M-087  sức khoẻ │  ║
║ │  OEE     — ⁽¹⁾   │     ░░   cờ đỏ NEO vào toà       ░░        │   31 % · giảm 12h │  ║
║ │  NG 24h  — ⁽²⁾   │      ░░░   CÓ sự cố             ░░░        │                   │  ║
║ │                  │        ░░░░░░░░░░░░░░░░░░░░░░░░░░          │ [Mở chức năng ▸]  │  ║
║ └──────────────────┘                                             └───────────────────┘  ║
║  224px · NỔI ĐÈ            CANVAS 3D  968 × 539 = 53,8 %              256px · NỔI ĐÈ    ║ 539px
║  2xl:288                   (chạy SUỐT bên dưới hai tấm nổi)                             ║
║   ◀ thu (?thu=trai)                                                  (?thu=phai) thu ▶  ║
║                                                                                         ║
║                    ┌───────────────────────────────────────┐                            ║
║                    │ ● Nhà máy   ○ Tầng   ○ Line   ○ Máy  │ ← đổi cấp, NỔI đáy giữa    ║ 32px
║                    └───────────────────────────────────────┘                            ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ◀◀ ──────────●────────────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [◉ BÂY GIỜ]      ║ 40px
╚═════════════════════════════════════════════════════════════════════════════════════════╝
  ⁽¹⁾ OEE `—` KHÔNG phải `0%`: oee_metrics 897 hàng, **0 hàng trong 24h** ⇒ chú thích
      "đo trên 0/240 máy trong 24h" (§14.5.6 · NT-4)
  ⁽²⁾ NG `—`: product_inspections 2.880/2.880 `factoryCode` NULL ⇒ rỗng với mọi vai không-admin (P-1)
```

**Cái gì nằm đâu — cấp Nhà máy**

| Vùng | px | Nội dung | Nhóm |
|---|---|---|---|
| Header | 1280×44 | breadcrumb · badge nguồn nhịp · 2D · nút Sửa (chỉ hiện khi có quyền, QĐ-16) | B |
| Dải hợp nhất | 1280×24 | *"N việc cần biết"* — gộp 8 dải cũ | B |
| Panel trái NỔI | 224×~300 | đếm máy theo trạng thái · OEE · NG | B |
| Panel phải NỔI | 256×~300 | **tối đa 2 mục** cần xử lý + nút `Mở chức năng` | C |
| Canvas | **968×539** | toà nhà · đường · cờ đỏ neo vào **toà CÓ sự cố** | A |
| Bộ chuyển cấp | ~380×32 | Nhà máy / Tầng / Line / Máy | — |
| Timeline | 1280×40 | tua lại · `BÂY GIỜ` | B |

★ **Ở cấp này, KHÔNG neo nhãn vào từng máy.** 240 nhãn > trần 30 và **không ai đọc nổi**. Chỉ **cờ
đỏ neo vào TOÀ NHÀ** có sự cố (≤ 4 nhãn cho 4 toà). Đây là **semantic zoom**: đổi cấp = **đổi biểu
diễn**, không phải dolly camera (Microsoft *Semantic Zoom*, §17).

---

#### 15.3.2 ★★★ HÌNH B — "DIALOG" LINE 3D TWIN (`/twin?pv=line&id=2`)

★ Đây là **hình trả lời trực tiếp yêu cầu mới của chủ sở hữu**. Theo **QĐ-17**: trông như lớp bật
lên, kỹ thuật là cảnh thay thế **trong cùng `<Canvas>`**.

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ▣ │ Nhà máy › Toà A › T2 › ► LINE 2          [◉ TRỰC TIẾP · 3s] [⬒2D] [⚙]              ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ⚠ 1 việc cần biết ▾                                                     [xem] [ẩn]      ║ 24px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║░░░░░░░░ nền = cảnh NHÀ MÁY vẫn còn đó, PHA VỀ NỀN 72 % (không unmount) ░░░░░░░░░░░░░░░░░║
║░░┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓░░║
║░░┃ ◀ Toà A·T2      ► LINE 2 · 12 máy · nhịp 42 s                            ✕ (Esc) ┃░░║ 36px  ← "thanh tiêu đề dialog"
║░░┠───────────────────────────────────────────────────────────────────────────────────┨░░║
║░░┃                                                                                   ┃░░║
║░░┃  ┌────────────┐                                              ┌────────────────┐  ┃░░║
║░░┃  │ LINE 2     │   ▪▪──▪▪──▪🔴──▪▪──▪▪──▪▪──▪▪──▪▪──▪▪──▪▪   │ ⚠ CẦN XỬ LÝ    │  ┃░░║
║░░┃  │ 12 máy     │    T1  T2  T3  T4  T5  T6  T7  T8  T9  T10   │                │  ┃░░║
║░░┃  │  10 chạy   │            ▲                                  │ ● M-114        │  ┃░░║
║░░┃  │   1 dừng   │      camera DỌC THEO LINE, nhìn xuôi dòng     │   E-STOP 14:30 │  ┃░░║
║░░┃  │   1 chưa rõ│      (khungNhinLine — TwinVanHanh.tsx:1965)   │   [Xác nhận]   │  ┃░░║
║░░┃  │            │                                               │                │  ┃░░║
║░░┃  │ nút thắt:  │   CẢNH 3D LINE  ≈ 690 × 300                   │ [+ Tạo phiếu]  │  ┃░░║
║░░┃  │  TRẠM 3 ⁽³⁾│   ── 12 máy · 12 trạm · 1 đường tâm ──        │                │  ┃░░║
║░░┃  │ WIP  128   │                                               │ [Mở chức năng▸]│  ┃░░║
║░░┃  └────────────┘                                               └────────────────┘  ┃░░║
║░░┃    200px NỔI                                                        216px NỔI     ┃░░║
║░░┠───────────────────────────────────────────────────────────────────────────────────┨░░║
║░░┃ DÒNG CHẢY TRẠM ─ `DaiLine` ĐÃ CÓ (200 dòng), nay NẰM TRONG lớp, cao 84px          ┃░░║ 84px
║░░┃  T1    T2    T3🔴   T4    T5    T6    T7    T8    T9   T10   T11   T12            ┃░░║
║░░┃  ▇▇▇   ▇▇▇   ▇▇▇▇▇  ▇▇    ▇▇▇   ▇▇▇   ▇▇    ▇▇▇   ▇▇   ▇▇▇   ▇▇    ▇▇             ┃░░║
║░░┃  38s   41s   67s    39s   40s   42s   38s   41s   37s  40s   39s   38s            ┃░░║
║░░┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛░░║
║░░░░░░░░ 908 × 455 = lớp Line, canh giữa, chừa 30px viền để thấy nền ░░░░░░░░░░░░░░░░░░░░║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ◀◀ ──────────●────────────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [◉ BÂY GIỜ]      ║ 40px
╚═════════════════════════════════════════════════════════════════════════════════════════╝
  ⁽³⁾ nguồn `wip.lineBalance` — trả NGUYÊN HÀNG nên nút thắt và mốc thời gian CHẮC CHẮN
      cùng một bản ghi. ⛔ KHÔNG dùng `stationLoadHeatmap` (D-2: không trả `periodStart`,
      Đợt 8 đo được một lời khai 16 ngày tuổi tô đỏ SAI trạm)
```

**★ Bốn thứ làm nó "cảm giác như dialog" mà KHÔNG cần Canvas thứ hai:**

| Tín hiệu dialog | Cài bằng | Có sẵn? |
|---|---|---|
| Nền tối/mờ đi | cảnh ngoài phạm vi **pha về nền 72 %** — `TI_LE_PHA_NGOAI_PHAM_VI` | **CÓ** (`phamViCanh.ts`) |
| Khung viền + thanh tiêu đề | `<div>` bo góc, đổ bóng, tiêu đề `LINE 2 · 12 máy` | mới, thuần CSS |
| `✕` + `Esc` đóng | về `?pv=tang` | **CÓ** (`ghiPhamVi`) |
| `←` quay lại + Back trình duyệt | **URL đã mang trạng thái** ⇒ Back tự chạy | **CÓ** (`kieuGhiLichSu` `:539`) |

**Đường vào / đường ra — cấp Line**

| | Cách |
|---|---|
| **VÀO** | ① click **thân line** trên cảnh nhà máy/tầng · ② click line trong panel trái · ③ bộ chuyển cấp · ④ **URL trực tiếp `?pv=line&id=2`** (chia sẻ được) · ⑤ click trạm trên `DaiLine` |
| **RA** | ① `✕` · ② `Esc` · ③ `←` breadcrumb · ④ **Back trình duyệt** · ⑤ click ra **vùng nền pha mờ** · ⑥ chọn cấp khác ở bộ chuyển cấp |

⚠ **`Esc` đụng độ:** khi `NganNhung` (Sheet thật) đang mở, Radix **nuốt `Esc`** trước. Luật: `Esc`
đóng **lớp trong cùng trước** — Sheet trước, rồi mới tới lớp Line. Phải có **test bàn phím**, vì đây
là kiểu lỗi chỉ trình duyệt bắt được (§13g.2 đã có tiền lệ).

★ **Cái GIỮ NGUYÊN, không viết lại:** `DaiLine.tsx` (200 dòng) và `DongChayLine.tsx` (190 dòng) **đã
có và đã chạy** ở `TwinVanHanh.tsx:3713`. Hình này **chỉ đặt lại chỗ** — từ "dải thứ 9 dưới đáy màn"
thành "phần dưới của lớp Line". **Không có phép tính thứ hai (G12).**

---

#### 15.3.3 ★★★ HÌNH C — MACHINE 3D TWIN (`/twin?pv=may&chon=M-114`)

Học từ mẫu `Machine 3D Twin.png` / `.webp` / `Machine 3D Twin (2).webp`: **máy 3D làm trung tâm, chỉ
số neo quanh**. ★ **Cố ý làm KHÁC mẫu ở MỘT chỗ**, xem cảnh báo bên dưới.

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ▣ │ … › Line 2 › ► M-114                     [◉ TRỰC TIẾP · 3s] [⬒2D] [✕ đóng]         ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ⚠ Máy đang E-STOP — dừng lúc 14:30, 2 phút trước                            [xem]       ║ 24px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║░░░ nền = cảnh LINE pha về nền 72 % — hàng xóm của máy VẪN THẤY (định vị) ░░░░░░░░░░░░░░░║
║░┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓░║
║░┃ ◀ Line 2      ► M-114 · AOI-3D · Trạm 3                                 ✕ (Esc)  ┃░║ 36px
║░┠─────────────────────────────────────────────────────┬─────────────────────────────┨░║
║░┃                                                     │  NGĂN XỬ LÝ  (`NganXuLy`)   ┃░║
║░┃  ┌───────────┐         ░░░░░░░░░░░░░░░░             │  ── ĐÃ CÓ, 726 dòng ──      ┃░║
║░┃  │ ● E-STOP  │       ░░░              ░░░           │                             ┃░║
║░┃  │           │      ░░   MÔ HÌNH 3D    ░░           │  Cảnh báo (3)               ┃░║
║░┃  │ Sức khoẻ  │      ░░   CỦA MÁY NÀY   ░░           │  ┌───────────────────────┐  ┃░║
║░┃  │   31 % ▼  │      ░░  glTF · hoặc 1  ░░           │  │ E-STOP        14:30   │  ┃░║
║░┃  │  ┌──────┐ │      ░░  trong 7 khối   ░░           │  │ [Xác nhận]            │  ┃░║
║░┃  │  │▁▂▃▂▁▁│ │       ░░░ mặc định §10B░░░           │  └───────────────────────┘  ┃░║
║░┃  │  └──────┘ │         ░░░░░░░░░░░░░░░░             │                             ┃░║
║░┃  │ 24h · 180k│                                       │  [+ Tạo phiếu bảo trì]     ┃░║
║░┃  │ hàng, mới │   ┌────────┐ ┌────────┐ ┌────────┐   │                             ┃░║
║░┃  │ nhất HÔM  │   │ Nhiệt  │ │ Rung   │ │ Chu kỳ │   │  ── Mở chức năng ────────   ┃░║
║░┃  │ NAY       │   │ 74 °C  │ │ 2,1 mm │ │ 41,2 s │   │  ▸ Buồng lái máy   (Sheet)  ┃░║
║░┃  │           │   │ ▲ cao  │ │ bình   │ │ bình   │   │  ▸ Lịch sử bảo trì (Sheet)  ┃░║
║░┃  │ NG 24h  — │   └────────┘ └────────┘ └────────┘   │  ▸ Chương trình    (Sheet)  ┃░║
║░┃  └───────────┘   THẺ CHỈ SỐ — lớp phủ DOM,          │                             ┃░║
║░┃    192px          **0 draw call**, neo DƯỚI máy      │  ⛔ KHÔNG có nút Start/Stop ┃░║
║░┃                   (khuôn `BangKpiNoi`, 197 dòng)     │     — xem D-1 / 15.7        ┃░║
║░┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┷━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛░║
║░░░ 928 × 467, canvas 3D máy ≈ 620 × 300 · ngăn phải 288px ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ◀◀ ──────────●────────────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [◉ BÂY GIỜ]      ║ 40px
╚═════════════════════════════════════════════════════════════════════════════════════════╝
```

★★★ **CHỖ CỐ Ý LÀM KHÁC MẪU — và vì sao nói ra:**
Cả ba ảnh mẫu `Machine 3D Twin*` đều đặt **`Free Run` / `Pause` / `Stop` / `Apply` / `Reset` ngay
cạnh mô hình 3D**. **Ta KHÔNG đặt lệnh OT ở đây.** Ba lý do đo được (D-1, §14.5.5 · §12b.4):
1. Cảnh 3D là mặt **khám phá** — người ta xoay, kéo, bấm thử. Nút `Stop` trên mặt khám phá là **mời
   tai nạn**.
2. Đường ghi hiện có **chưa lọc tenant** (L-1) — chưa chứng minh được ai được lệnh cho máy nào.
3. Cảnh **không tự chứng minh đủ tươi để RA LỆNH**: badge hiện khai `đẩy + hỏi 30s` (`nguonDuLieu.ts:37`
   `NHIP_CO_LUONG_MS = 30_000`). **Đủ tươi để NHÌN ≠ đủ tươi để STOP.**
⇒ Thay vào đó: `[Mở chức năng ▸] → /command-console`, **rời mặt khám phá MỘT CÁCH CÓ Ý THỨC**.
Nguồn ngoài độc lập ủng hộ: Hollifield/PAS — Level 1 *"Control interactions are not made from this
screen"* (§14.8.1).

**Đường vào / đường ra — cấp Máy**

| | Cách |
|---|---|
| **VÀO** | ① click **máy** trên cảnh (bất kỳ cấp nào) · ② click dòng trong `DanhSachMay` panel trái · ③ click mục trong `DaiCanhBao` · ④ **URL `?pv=may&chon=machine:114`** · ⑤ click trạm trên `DaiLine` → `chonMay(mayDau.id)` (`:3745`, ĐÃ CÓ) |
| **RA** | ① `✕` · ② `Esc` · ③ `←` về Line · ④ **Back trình duyệt** · ⑤ click nền pha mờ · ⑥ chọn máy khác (thay tại chỗ, **không** chồng lớp) |

⚠ **L-5 đã vá và phải giữ:** `?xem=…` **lệch phạm vi** thì màn **NÓI RA**, không im lặng
(`nhungTaiCho.ts:273`, `lyDoNganNhung` `:356` trả `mo | ngoaiPhamVi | thieuQuyen`). Cấp Máy mới
**phải dùng lại đúng ba lý do đó**, không đẻ nhánh im lặng thứ tư.

---

#### 15.3.4 HÌNH D — `/twin?che-do=botri` (VÙNG THIẾT KẾ — "twin-studio")

⚠ **Đây KHÔNG còn là một trang riêng.** `App.tsx:368` — `/twin-studio` **đã là redirect** vào
`/twin?che-do=botri` từ Đợt 21 (QĐ-16). `TwinStudio.tsx` (239 dòng) nay được `/twin` **nạp lười**
(`TwinVanHanh.tsx:245` `const VungSuaNhaXuong = lazy(() => import("./TwinStudio"))`).

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ▣ │ SIM-FAC ▾ │ ⚙ ĐANG SỬA BỐ CỤC          [⟲ hoàn tác] [⟳ làm lại] [Lưu] [✕ Thoát sửa] ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ⚠ Bạn đang ở chế độ SỬA — thay đổi hình học sẽ ghi vào bố cục nhà máy     [tìm hiểu]     ║ 24px  ← hổ phách
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║┌────────────┐                                                         ┌────────────────┐║
║│ CÔNG CỤ    │                                                         │ THUỘC TÍNH     │║
║│            │        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░              │ (vật thể chọn) │║
║│ ▣ Chọn     │      ░░░                              ░░░              │                │║
║│ ✥ Di chuyển│     ░░     CANH THIẾT KẾ — CÙNG MỘT     ░░             │ M-114          │║
║│ ↻ Xoay     │     ░░     `<Canvas>` (RB-4), đổi       ░░             │ x  12.400 mm   │║
║│ ⊞ Lưới     │     ░░     nội dung + BẬT gizmo         ░░             │ y   3.200 mm   │║
║│ ▢ Vẽ vùng  │     ░░                                   ░░            │ góc     90 °   │║
║│ ⇥ Căn      │     ░░   ┌───────────┐  ← TransformControls           │ tầng      T2   │║
║│ ⌗ Snap 50mm│     ░░   │  ▣ M-114  │     (RB-1: KHÔNG                │ line   Line 2  │║
║│            │      ░░░ └───────────┘      còn là Object3D)  ░░░      │                │║
║│ ── Cây ──  │        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░              │ [Áp dụng]      │║
║│ ▾ Toà A    │                                                         │ [Hoàn nguyên]  │║
║│  ▾ T2      │     CANVAS 3D  ≈ 720 × 539                              │                │║
║│   ▸ Line 2 │     (hẹp hơn Hình A vì HAI panel CHIA ĐẤT —             │  ⚠ Snap xoay   │║
║│            │      chế độ sửa cần thấy toạ độ CHÍNH XÁC,              │   phải TUYỆT   │║
║│ ── Lớp ──  │      không được để panel che vật thể đang kéo)          │   ĐỐI (RB-2)   │║
║│ ☑ Máy      │                                                         │                │║
║│ ☑ Vùng     │                                                         │                │║
║│ ☐ Tường    │                                                         │                │║
║└────────────┘                                                         └────────────────┘║
║  224px CHIA ĐẤT                                                        224px CHIA ĐẤT   ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
   ⛔ KHÔNG có timeline ở chế độ sửa: tua lại + sửa hình học = "sửa quá khứ", vô nghĩa và nguy hiểm
```

★ **Ba khác biệt CÓ CHỦ Ý so với Hình A/B/C** — mỗi cái có lý do, không phải cho khác:

| | Vận hành (A/B/C) | Thiết kế (D) | Vì sao |
|---|---|---|---|
| Panel | **NỔI ĐÈ** | **CHIA ĐẤT** | Kéo máy mà panel che chỗ thả = **kéo mù**. Chế độ sửa **đổi diện tích lấy độ chính xác** |
| Dải cảnh báo | *"N việc cần biết"* | *"Bạn đang ở chế độ SỬA"* | Đang sửa hình học thì cảnh báo vận hành là **nhiễu** — và tệ hơn: nó **mời bấm** giữa lúc tay đang kéo |
| Timeline | có | **KHÔNG** | *"Sửa bố cục lúc 03:00"* không có nghĩa |
| Ai thấy | `analytics_oee` ∨ `machine_status` | **`settings_factory` ∨ `machine_control`** | QĐ-16: cùng trang, **quyền theo từng vùng**, luật **ẩn-không-disable** |

★ **`operator1` bấm `?che-do=botri`** ⇒ **hạ về chế độ xem VÀ ĐƯỢC BÁO** (`kepVungTheoQuyen`,
`TwinVanHanh.tsx:2303`) — **không** trắng màn, **không** 403. Đã nghiệm thu 5/5 e2e ở §13e.3.

---

#### 15.3.5 HÌNH E — BA TRẠNG THÁI ĐẶC BIỆT

**E-1 · ĐANG TUA LẠI (`?tg=…`)** — trạng thái nguy hiểm nhất: cảnh **trông y hệt** lúc LIVE.

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ▣ │ Nhà máy › Toà A › T2  [⏱ ĐANG TUA — 03:00 hôm nay]  [⬒2D] [⚙]                      ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣ ← viền HỔ PHÁCH 2px
║▓                                                                                       ▓║   BAO QUANH toàn canvas
║▓  ┌───────────────┐        ░░░░░░░░░░░░░░░░░░░░          ┌───────────────┐             ▓║
║▓  │ TỔNG QUAN     │      ░░  CẢNH LÚC 03:00  ░░          │ CẦN XỬ LÝ     │             ▓║
║▓  │ ★ lúc 03:00   │      ░░ (KHÔNG phải bây  ░░          │ ★ lúc 03:00   │             ▓║
║▓  │  208 chạy     │      ░░      giờ)        ░░          │ ● M-114       │             ▓║
║▓  └───────────────┘        ░░░░░░░░░░░░░░░░░░░░          └───────────────┘             ▓║
║▓        ▲ MỌI tấm nổi ĐỔI NHÃN thành "lúc 03:00"                                       ▓║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ◀◀ ────●──────────────────────────────────── ▶ │ 03:00 hôm nay │ 4× │ [◉ VỀ BÂY GIỜ]   ║ 40px
╚═════════════════════════════════════════════════════════════════════════════════════════╝
  BA chỉ báo ĐỒNG THỜI (một cái có thể bị bỏ sót):
   ① viền hổ phách bao canvas · ② chữ "ĐANG TUA + mốc" THAY CHỖ badge LIVE · ③ nút VỀ BÂY GIỜ sáng
  ⛔ Ở cấp Line/Máy khi đang tua: nút [Xác nhận] và [+ Tạo phiếu] **BỊ VÔ HIỆU + nói lý do**
     — xác nhận một cảnh báo của 03:00 lúc 14:32 là ghi SAI vào sổ.
```

**E-2 · ĐANG MÔ PHỎNG (`?thu=moPhong` mở, what-if đang chạy)**

```
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ▣ │ Nhà máy › Toà A › T2   [🧪 MÔ PHỎNG — số KHÔNG phải thực đo]  [⬒2D] [⚙]            ║ 44px
╠═════════════════════════════════════════════════════════════════════════════════════════╣ ← viền TÍM 2px + sọc chéo
║▨  ┌──────────────┐       ░░░░░░░░░░░░░░░░░░░░       ┌──────────────────────────────┐  ▨║
║▨  │ TỔNG QUAN    │     ░░  cảnh GIẢ ĐỊNH   ░░       │ NGĂN MÔ PHỎNG (`NganMoPhong`)│  ▨║
║▨  │ 🧪 giả định  │     ░░  (kịch bản #3)   ░░       │ Kịch bản: +1 ca đêm Line 2   │  ▨║
║▨  │  OEE 71 % 🧪 │       ░░░░░░░░░░░░░░░░░░░        │ [Chạy] [So sánh] [Bỏ]        │  ▨║
║▨  └──────────────┘                                   └──────────────────────────────┘  ▨║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
  ★ NT-4 — SỐ GIẢ ĐỊNH PHẢI TỰ KHAI LÀ GIẢ ĐỊNH. Mọi số sinh từ mô phỏng mang tiền tố 🧪
    và KHÔNG BAO GIỜ dùng chung ô với số thực đo. Đây là lỗi `whatIfQ` đã vá ở `:1515-1518`
    (kết quả chuyền TRƯỚC nằm lại dưới nhãn chuyền MỚI) — áp cho trục kịch bản.
```

**E-3 · THIẾU QUYỀN / NGUỒN RỖNG** — ★ hai thứ **khác nhau**, phải nói **khác nhau**.

```
┌─ cấp Máy, vai `operator1` ────────────────┐   ┌─ cấp Nhà máy, andon_events = 0 hàng ────┐
│  ► M-114 · AOI-3D                    ✕    │   │  ⚠ CẦN XỬ LÝ                            │
│                                            │   │                                          │
│    ░░░ MÔ HÌNH 3D ░░░  ← VẪN HIỆN         │   │   ✔ Không có cảnh báo đang mở            │
│                                            │   │                                          │
│  Cảnh báo (3)                              │   │   Nguồn: andon.active                    │
│  ┌──────────────────────────────────────┐ │   │   Cập nhật: 14:32:07 (12 giây trước)     │
│  │ E-STOP  14:30                        │ │   │                                          │
│  │ (nút Xác nhận KHÔNG hiện — ẩn, không │ │   │  ★ KHÔNG in "0" trần trụi. Phải phân      │
│  │  disable, theo luật ẩn-không-disable)│ │   │    biệt "ĐÃ HỎI, không có" với "CHƯA     │
│  └──────────────────────────────────────┘ │   │    HỎI ĐƯỢC" (NT-3)                      │
│                                            │   │                                          │
│  ℹ️ Bạn xem được máy này. Xác nhận cảnh    │   │  ⚠ andon_events đo 2026-09-08: 7 hàng,   │
│     báo cần quyền `machine_status`.        │   │    **0 hàng `raised`** ⇒ nhánh "có cảnh  │
│     [Yêu cầu quyền]                        │   │    báo" CHƯA AI ĐI QUA BAO GIỜ (G26)     │
└────────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

★★★ **NT-3 là điều kiện sống còn ở cả ba cấp:** *"không có dữ liệu ≠ bình thường"*. Một cảnh 3D
toàn màu xám vì **mất kết nối** trông **y hệt** một cảnh 3D toàn màu xám vì **mọi máy đều khoẻ**.
⇒ Mỗi lớp phủ mang **nguồn + tuổi**. Và nghiệm thu **bắt buộc dựng ca dương bằng tay** (chèn 1 hàng
`raised`, mở `/twin`, badge phải **nổi lên**, rồi khôi phục) — không dựng thì "không badge nào hiện"
trông y hệt nhau dù mã đúng hay hỏng (**G5/G22**).

---

#### 15.3.6 ★ CHUYỂN CẢNH — AI LẬP LỊCH HOẠT ẢNH (G63)

Dưới `frameloop="demand"` (`KhungCanh.tsx:245`), **khung chỉ vẽ khi có ai gọi `invalidate()`**. Một
hoạt ảnh bay camera kéo dài **~600 ms** ⇒ **~36 khung** ⇒ **phải có người lập lịch 36 lần**.

```
  Người dùng click Line 2
        │
        ├─► ghi URL  ?pv=line&id=2         (duongDanTwin.ts — ĐÃ CÓ)
        │
        ├─► `useEffect` trong CanhNhaMay.tsx:122-136  ── ĐÃ CÓ KHUÔN ──
        │     const invalidate = useThree((s) => s.invalidate);   // :122
        │     … đặt camera đích … ; invalidate();                 // :135
        │
        └─► ★ MỚI: bộ nội suy camera 600 ms
              requestAnimationFrame loop
                 ├ mỗi khung: cập nhật camera + GỌI invalidate()   ← NGƯỜI LẬP LỊCH
                 └ khung cuối: dừng rAF, KHÔNG gọi invalidate nữa  ← vòng lặp TỰ TẮT
```

★ **Ba luật bắt buộc cho bộ nội suy** (mỗi luật là một cách nó hỏng nếu thiếu):
1. **Tự huỷ khi unmount** — nếu không, rAF chạy tiếp sau khi rời `/twin` ⇒ GPU **không bao giờ về 0**,
   phá đúng thứ `demand` mua được cho ca 8 tiếng.
2. **Huỷ khi người dùng chạm `OrbitControls`** — người dùng thắng hoạt ảnh, luôn luôn. Nếu không, họ
   kéo mà camera **giật ngược** về đích.
3. **`prefers-reduced-motion` ⇒ nhảy thẳng, 0 khung nội suy** — và điều này phải **test**, vì đây là
   nhánh **không ai nhìn thấy khi phát triển**.

⚠ **`three.js` *Rendering on Demand* cảnh báo vòng phản hồi**: `invalidate()` gọi từ trong `useFrame`
tạo vòng vô tận. Bộ nội suy phải sống trong **`rAF` riêng**, **không** trong `useFrame`.

★ Đo được rằng khuôn này **đã tồn tại**: `CanhNhaMay.tsx` có **4 chỗ** nối `invalidate` (`:65`, `:122`,
`:166`, `:227`) và `dieuKhienQuay.ts:5-6` ghi rõ *"`OrbitControls` của drei tự gọi `invalidate`;
`OrbitControls` thuần thì KHÔNG"*. ⇒ Đây là **mở rộng khuôn có sẵn**, không phải phát minh.

---

### 15.4 ★★★ GỘP MÀN — ĐO LẠI, VÀ **MÂU THUẪN VỚI QĐ-16 PHẢI ĐƯA RA HỎI**

#### 15.4.1 ⚠ MÂU THUẪN CẦN CHỦ SỞ HỮU GIẢI — `/twin-studio`

| | Nội dung |
|---|---|
| **QĐ-16 (§13c.1, chủ sở hữu chốt 2026-09-08)** | *"MỘT TRANG, **QUYỀN THEO TỪNG VÙNG**, KHÔNG PHẢI MỘT CỔNG DUY NHẤT"* — `/twin` + `/twin-studio` gộp làm một trang |
| **Đợt 21 đã THỰC THI** | `App.tsx:368` `/twin-studio` → `Redirect to="/twin?che-do=botri"`; `TwinStudio.tsx` nạp lười từ `/twin` (`TwinVanHanh.tsx:245`); nghiệm thu **5/5 e2e**, hai tài khoản thật (`operator1` ✅ vào / ❌ nút sửa; `engineer1` ✅/✅) |
| **Yêu cầu Đợt 25 (chủ sở hữu, 2026-09-09)** | *"**twin studio là nơi thiết kế**, thiết lập thông số, cài đặt cho 3D Twin của nhà máy, **còn lại 3 màn hình còn lại** đang quá phức tạp"* — câu này đọc như `/twin-studio` **là một trang riêng** |

⇒ **Hai đọc hiểu, hệ quả rất khác nhau:**

| Đọc | Nghĩa | Việc phải làm | Rủi ro |
|---|---|---|---|
| **Đ-A** *(tôi nghiêng về cái này — và tôi ĐÃ SAI)* | Chủ sở hữu đang phân biệt **VAI TRÒ**, **không** đòi tách lại tuyến. QĐ-16 vẫn đứng | **0** — đã xong ở Đợt 21 | 0 |
| ✅ **Đ-B** — **CHỦ SỞ HỮU CHỌN CÁI NÀY** (QĐ-18, 2026-09-09) | Chủ sở hữu muốn **tách lại** thành hai tuyến riêng | **Đảo ngược phần GỘP của Đợt 21**: trả `RouteGuard` cho `/twin-studio`, xoá `?che-do=`, viết lại e2e | ~~`operator1` mất lối vào~~ → **ĐO ĐƯỢC LÀ KHÔNG**: họ chưa từng có quyền sửa ⇒ mất **0**. Xem §14o.2 |

★★★ **BÀI HỌC CHO CHÍNH TÔI (G83 + "lý do hoãn có HẠN SỬ DỤNG"):** tôi xếp Đ-A trên vì tôi **cân
một quyết định đã thực thi nặng hơn một câu hỏi chưa đo**. Rủi ro tôi viện ra để bênh Đ-A
(*"`operator1` mất lối vào"*) là **lời khai kế thừa từ QĐ-16, chưa ai đo lại**. Một truy vấn
`permissions` — thứ tôi có thể chạy bất cứ lúc nào — đã đủ cho thấy nó **không áp dụng**. ⇒ **Trước
khi dùng một rủi ro để bác một lựa chọn, phải ĐO rủi ro ấy còn sống không.**

★★★ **KHÔNG TỰ CHỌN.** Brief nói đúng: *"Đo lại hiện trạng, nêu mâu thuẫn nếu có, và **hỏi rõ** thay
vì tự chọn."* ⇒ **Câu Q-2 (15.8).**
★ Nếu là Đ-A — và tôi tin là Đ-A, vì câu của chủ sở hữu **mô tả vai trò chứ không mô tả URL** — thì
việc duy nhất còn lại là **đổi CHỮ trên giao diện**: nút hiện ghi `⚙ Sửa bố cục`; đổi thành
`⚙ Twin Studio` để tên ông quen **tìm thấy được**. Đó là **một chuỗi i18n**, không phải một đợt.

#### 15.4.2 Từng thứ trong 7 tab `TwinHub` + `/command-center` — GIỮ / GỘP / BỎ

★ **Đo lại 2026-09-09, không kế thừa lời khai (G74).** `TwinHub` (140 dòng) hiện có **0 lối vào URL**
— `App.tsx:345-348` đã chuyển `/digital-twin` thành redirect qua `dinhTuyenTwinCu.ts`.

| # | Thứ | `file:line` | Trạng thái ĐO ĐƯỢC | Quyết Đợt 25 | URL cũ → đi đâu |
|---|---|---|---|---|---|
| 1 | vỏ `TwinHub` | `TwinHub.tsx`, 140 dòng | **0 lối vào** — `/digital-twin` đã redirect | **ĐÃ BỎ** ✔ ⛔ **KHÔNG xoá tệp** | `/digital-twin` → `/twin` (`App.tsx:348`) |
| 2 | tab `overview` | `DigitalTwinDashboard.tsx`, 606 dòng | Sức khoẻ **ĐÃ GỘP** — `vienSucKhoe` sống ở `TwinVanHanh.tsx:1109`→prop`:2948`, **42 khai sức khoẻ** đi qua | **ĐÃ GỘP** ✔ | → `/twin` |
| 3 | tab `center` | `DigitalTwinCenter.tsx`, 936 dòng | Vùng an toàn **ĐÃ GỘP** (`vungTuDanhSach` `:1141`→`:2949`); replay đã gộp (`DongThoiGian`) | **ĐÃ GỘP** ✔ ⛔ **KHÔNG xoá tệp** (§11b: giữ chỗ gọi `usdExport` thứ hai) | → `/twin` |
| 4 | tab `map` | `FactoryLiveMap3D.tsx`, 240 dòng | Badge nguồn nhịp **ĐÃ GỘP** (`khaiNguonSo` `:1871`→badge`:2528`, đọc `đẩy + hỏi 30s`) | **ĐÃ GỘP** ✔ | `/factory-live-map` → `/twin` (`:426`, **1 chặng** ✔) |
| 5 | tab `floor` | `FactoryFloorEditor.tsx`, 604 dòng | Công cụ soạn, 9 mutation | **ĐÃ CHUYỂN** vào vùng sửa ✔ | `/factory-floor-editor` → `/twin?che-do=botri` (`:480`) |
| 6 | tab `layout` | `Layout.tsx`, 1.026 dòng | 3 mutation CRUD bố trí | **ĐÃ CHUYỂN** ✔ | `/layout` → `/twin?che-do=botri` (`:641`) |
| 7 | tab `cell` | `CellTwinPlayer.tsx`, 770 dòng | Phát lại **ĐÃ GỘP** (`orchestration.simulate` `:1536`) | **ĐÃ GỘP** ✔ | `/cell-twin` → `/twin` (`:485`) |
| 8 | tab `rf` | `RfTestCellSim.tsx`, 792 dòng | **0 lời gọi tRPC** — mô phỏng thuần | **ĐÃ TÁCH** khỏi Twin ✔ | `/rf-test-cell` = **tuyến thật** (`:483`) |
| **9** | **`/command-center`** | `App.tsx:487`, **1.596 dòng** | ★ **TUYẾN THẬT, CÒN SỐNG** — nav `:301`. Cây đa site `commandCenter.hierarchy` `:931` **ĐÃ GỘP** (Z4/`CayPhanCap`, §13f.1) | ⚠ **MÓN GỘP DUY NHẤT CÒN LẠI** — xem 15.4.3 | ⚠ **CHƯA redirect** |
| 10 | `/layout/:id` | `App.tsx:642` | Route **sống, 0 lối vào UI** (nợ từ Khối D) | ⚠ **CẦN QUYẾT** | — |

⇒ **Đếm lại: `/twin` + `/command-center` + `/rf-test-cell` = 3 tuyến Twin-liên-quan còn sống**, không
phải 4. Sau Đợt 25 nếu gộp `/command-center`: **còn 2**.

#### 15.4.3 `/command-center` — đề xuất **GỘP, NHƯNG KHÔNG REDIRECT NGAY**

| Thứ trong `CommandCenter.tsx` | Quyết | Lý do đo được |
|---|---|---|
| Cây đa site `:931` `commandCenter.hierarchy` | **ĐÃ GỘP** (`CayPhanCap`, Z4) | §13f.1 — tái dùng, không viết cây thứ hai |
| Sàn 3D `:735` | **BỎ** | **D-5**: dùng **lưới tổng hợp** `:466-491`, **không phải vị trí thật** ⇒ hai cảnh nói hai câu về cùng nhà máy |
| Dải KPI `:938` | **BỎ** | **D-4**: gộp = **năm** bản đếm cùng một thứ = **bốn cơ hội lệch nhau** |
| Đài cảnh báo `:1049` | **ĐÃ GỘP** (`DaiCanhBao`) | phần phân biệt rỗng-vì-RBAC |
| Khuôn `ErrorBoundary` `:839-849` | **GIỮ TẠI CHỖ** | §4 mượn khuôn này cho `<Canvas>` |

★ **Đề xuất: cấp `?pv=tapdoan` trên `/twin` (`CapPhamVi` đã có `"tapDoan"`, `duongDanTwin.ts:38`),
rồi redirect `/command-center` → `/twin?pv=tapdoan`.**
⚠ **NHƯNG KHÔNG redirect trước khi đo `?pv=tapdoan` chạy thật với dữ liệu thật.** Đây là **R-4** đã
ghi ở §14.9. `/command-center` là tuyến có nav mục riêng (`:301`); redirect vào một cấp **chưa nghiệm
thu** biến một màn đang chạy thành một màn hỏng, và **không ai phát hiện** vì URL vẫn 200.

#### 15.4.4 ⛔ BỐN THỨ KHÔNG ĐƯỢC ĐỘNG VÀO

| Thứ | Vì sao | Bằng chứng |
|---|---|---|
| `MachineCockpit.tsx` | `MachineWorkspace` nhúng nó **ngoài Twin**; và `NganNhung.tsx:92` nhúng `MachineCockpitBody` | §11b |
| `RobotCockpit.tsx` | **ĐÍCH DI TRÚ** — `nganXuLyLogic.ts:232` trỏ `/robot/:id`; `NganNhung.tsx:95` nhúng `RobotCockpitBody` | §11b |
| `DigitalTwinCenter.tsx` | Giữ **chỗ gọi `usdExport` thứ hai** | §11c.7 |
| **mục nav `/digital-twin`** | `DataManagementHub.tsx:24` + `DataSettings.tsx:796` đọc quyền route qua `getRequiredPermissionForHref("/digital-twin")`. Xoá ⇒ **cả hai rơi về `"analytics_oee"` IM LẶNG** và hiện quick-link bố cục cho người **không được sửa** — **tái tạo đúng lỗi "một lối vào rồi TỪ CHỐI"** | §13e.5 |

---

### 15.5 ★★★ `TwinVanHanh.tsx` 3.754 DÒNG — KẾ HOẠCH TÁCH (THIẾT KẾ, KHÔNG LÀM ĐỢT NÀY)

#### 15.5.1 Chẩn đoán — đo, không suy

```
  export default function TwinVanHanh()      ← TwinVanHanh.tsx:250
  └── và KHÔNG CÓ GÌ KHÁC ở tầng tệp.
      grep "^function |^const [A-Z].*=>|^export function" ⇒ ĐÚNG 1 kết quả

  Trong MỘT hàm đó:   50 useMemo · 18 useState · 14 useQuery · 13 useCallback · 6 useEffect
```

★ **Đây là con số quan trọng nhất của cả §15.** Chủ sở hữu nói *"quá phức tạp"* về **3 màn**; đo được
thì **97,7 %** khối lượng nằm trong **một hàm**. ⇒ **Gộp thêm màn nữa KHÔNG làm nó bớt phức tạp** —
nó làm hàm đó **dài thêm**. Đây là lý do 15.5 tồn tại và vì sao nó **quan trọng ngang** 15.2.

#### 15.5.2 Tách theo TRÁCH NHIỆM — 6 mảnh, thứ tự theo rủi ro tăng dần

| # | Mảnh | Rút ra | Ước dòng | Rủi ro | Vì sao an toàn / nguy |
|---|---|---|---|---|---|
| **T-1** | **Đọc dữ liệu** | `useDuLieuTwin.ts` — gom **14 `useQuery`** thành 1 hook, trả 1 object | ~350 | **THẤP** | Thuần đọc, không JSX, không nhánh quyền. Test bằng mock tRPC |
| **T-2** | **Dẫn xuất cảnh** | `useCanhVe.ts` — `mayVe`, `hinhLine` (`:1644`), `bangWip`, `cotWipCanh` | ~500 | **THẤP** | Hàm thuần trên dữ liệu T-1. ⚠ **`bangWip` và `cotWipCanh` PHẢI ở cùng một hook** — tách đôi là mở đường cho phép tính thứ hai (G12), đúng thứ chú thích `:3713` cảnh báo |
| **T-3** | **Trạng thái URL** | `useTrangThaiTwin.ts` — bọc `duongDanTwin.ts` + `?che-do=` + `?xem=` | ~250 | **THẤP** | `duongDanTwin.ts` **đã là module thuần đã test**; đây chỉ là vỏ React |
| **T-4** | **Cấp Nhà máy/Tầng** | `<CapNhaMay>` | ~450 | TRUNG BÌNH | JSX + lớp phủ |
| **T-5** | **Cấp Line** | `<LopLine>` — bọc `DaiLine` + `DongChayLine` **đã có** | ~350 | TRUNG BÌNH | ⚠ **Ranh giới G16**: đụng cùng vùng với T-4 |
| **T-6** | **Cấp Máy** | `<LopMay>` — bọc `NganXuLy` (726 dòng, **đã có**) + `NganNhung` | ~400 | **CAO** | ⚠ Đây là **mặt GHI duy nhất** (2 mutation W1/W2 + 3 qua ngăn nhúng). Tách sai = **mất đường ghi mà cổng vẫn xanh** |

⇒ Còn lại trong `TwinVanHanh.tsx`: **~1.400 dòng** vỏ + điều phối. Không phải mục tiêu "300 dòng" —
mục tiêu là **mỗi mảnh vừa một đầu người**.

#### 15.5.3 ★ RỦI RO CỦA VIỆC TÁCH — bốn cái, và cách chống từng cái

| Rủi ro | Vì sao có thật ở dự án này | Chống bằng |
|---|---|---|
| **R-T1 · Đứt đường ghi mà cổng vẫn xanh** | §11c.2 đã đo **4 lớp lỗi "có mã + có test + KHÔNG giao hàng"**; §13d.6 đo `grep -c` ⇒ **0 chỗ gọi** cho 3 hạ tầng vừa xây | **Ablation bắt buộc**: gỡ chỗ gọi ⇒ test **PHẢI ĐỎ**. §13d.4 đã dùng và nó **bắt lỗi của chính lô Z hai lần** |
| **R-T2 · Prop drilling 5 tầng** | 18 `useState` phân tán cho 6 mảnh ⇒ mảnh nào cũng cần nửa số | Gom vào **1 object trạng thái** từ T-3, truyền 1 prop, **không** truyền 18 |
| **R-T3 · Hai hook cùng tính một số** | G12; và `bangWip`/`cotWipCanh` là ca đã có chú thích cảnh báo | **T-2 là hook DUY NHẤT** được tính dẫn xuất cảnh. Test: cùng đầu vào ⇒ 3D và 2D cùng nói `nghen: true` |
| **R-T4 · Xung đột G16 giữa các lô** | §13d.6: cả 3 mục lô Z **dừng ở ranh giới tệp** vì lô Y đang giữ `TwinVanHanh.tsx` | **T-1/T-2/T-3 trước, tuần tự, MỘT phiên**. T-4/T-5/T-6 sau, và **không lô nào chạm 2 mảnh** |

★ **Không tách trong đợt này.** Đây là thiết kế. ⇒ **Câu Q-3 (15.8).**

---

### 15.6 ★★★ THÔNG TIN NÀO LÊN 3D — BỐN NHÓM, THEO TỪNG CẤP

> §14.5 đã phân A/B/C/D cho **toàn trang**. Mục này làm điều §14.5 **chưa làm**: phân theo **TỪNG
> CẤP**. Vì cùng một thông tin có thể **đúng ở cấp này và sai ở cấp kia** — và đó chính là điều
> làm 3 màn cũ "quá phức tạp": chúng hiện **mọi thứ ở mọi cấp**.

#### 15.6.1 Bảng ba cấp × bốn nhóm

**★ (A) NEO VÀO VẬT THỂ 3D — đắt (1 draw call/nhãn), phải giành chỗ**

| Cấp | Neo cái gì | Neo vào đâu | Nguồn | Trần nhãn | Đã có? |
|---|---|---|---|---|---|
| **Nhà máy** | ① cờ đỏ *"toà có sự cố"* ② màu thân toà (chạy/dừng/mất tín) | **TOÀ NHÀ**, không phải máy | `factoryCommand.overview` `:525` · `andon.active` `:538` | **≤ 4** (4 toà) | màu **CÓ**; cờ theo toà **CHƯA** |
| **Line** | ① nhãn **nút thắt** ② badge E-STOP ③ tên trạm | **TRẠM** | `wip.lineBalance` `:609` · `twinCanh.anToanRobot` `:551` | **≤ 12+1** | nút thắt **CÓ** (2D, chưa neo 3D) |
| **Máy** | ① tên máy ② badge cảnh báo ③ **vòng viền sức khoẻ** ở đế | **MÁY** | `machine_health_history` (**180.800 hàng, tươi HÔM NAY**) | **≤ 3** | `vienSucKhoe` **CÓ** (`:1109`→`:2948`) |

★ **Vì sao cấp Nhà máy KHÔNG neo vào máy:** 240 nhãn > trần 30, và **không ai đọc nổi 240 nhãn**.
Ở cấp nhà máy người dùng hỏi *"toà nào?"*, không hỏi *"máy nào?"*. Đây là **semantic zoom** — đổi cấp
= **đổi biểu diễn**, không phải phóng to cùng một biểu diễn.

**★ (B) LỚP PHỦ 2D — 0 draw call, khuôn `BangKpiNoi` (197 dòng, ĐÃ CÓ)**

| Cấp | Chip trái | Chip phải | Header |
|---|---|---|---|
| **Nhà máy** | 240 máy · 208/19/9/4 · OEE `—`⁽¹⁾ · NG `—`⁽²⁾ | ⚠ **tối đa 2** mục cần xử lý | badge nguồn nhịp · tuổi dữ liệu |
| **Line** | Line N · 12 máy · **nhịp** · **nút thắt trạm** · WIP | ⚠ mục của line này | ⟵ như trên + breadcrumb Line |
| **Máy** | mã · loại · **sức khoẻ %** + xu hướng 24h · NG 24h | cảnh báo của máy này | ⟵ như trên + breadcrumb Máy |

⁽¹⁾ `oee_metrics` **897 hàng, 0 hàng trong 24h** ⇒ **`—` kèm "đo trên 0/240 máy trong 24h"**, ★ **không**
`0%`. `?? 0` là **lời khai SAI**.
⁽²⁾ `product_inspections` **2.880/2.880 `factoryCode` NULL** ⇒ rỗng với mọi vai không-admin (P-1).
⚠ Chữa SAI là nới cổng thành *"NULL thì cho qua"* — mở lại đúng lỗ Q1 vừa vá. Phải sửa **đường ghi** trước.

**★ (C) PANEL — đọc kỹ, so sánh, thao tác**

| Cấp | Panel trái | Panel phải |
|---|---|---|
| **Nhà máy** | `CayPhanCap` (Z4) · `DanhSachMay` ảo hoá | `DaiCanhBao` gộp |
| **Line** | 12 máy của line · `DaiLine` dòng chảy trạm (**ĐÃ CÓ**) | cảnh báo line + `NganXuLy` |
| **Máy** | sức khoẻ + **biểu đồ 24h** (C-9, **CHƯA có**) | **`NganXuLy` 726 dòng ĐÃ CÓ** — mặt ghi duy nhất |

**★★★ (D) KHÔNG LÊN 3D — quan trọng NGANG (A)**

> Brief nói đúng: *"một trung tâm nhồi mọi thứ sẽ không đọc được."* Đây là danh sách **cố ý bỏ**,
> theo cấp. Cột cuối là **chỗ thay thế** — bỏ khỏi 3D ≠ bỏ khỏi hệ.

| # | Ở cấp | KHÔNG lên 3D | Vì sao (đo được) | Ở đâu thay thế |
|---|---|---|---|---|
| **D-1** | **cả 3** | **Nút lệnh OT** (Start/Stop/Reset/đổi chế độ) | ① 3D là mặt **khám phá** — người ta xoay/kéo/bấm thử ② đường ghi **chưa lọc tenant** (L-1) ③ badge khai `đẩy + hỏi 30s` ⇒ **đủ tươi để NHÌN ≠ đủ tươi để STOP**. ★ Mẫu `Machine 3D Twin*` **có** Free Run/Pause/Stop — **ta cố ý bỏ** | `[Mở chức năng]` → `/command-console` |
| **D-2** | cả 3 | `stationLoadHeatmap` làm chỉ báo nút thắt | **Không trả `periodStart`** ⇒ không tự chứng minh còn hạn. Đợt 8 đo được **lời khai 16 ngày tuổi tô đỏ SAI trạm** | `wip.lineBalance` — trả **nguyên hàng** |
| **D-3** | Nhà máy | **Nhãn tên cho MỌI máy** | 240 > trần 30; 48 máy/tầng cũng > 30 | màu thân + hover + `DanhSachMay` |
| **D-4** | Nhà máy | **Bảng máy dạng bảng** | Trình bày lại C-1. **Bảng thứ hai không thêm sự thật, chỉ thêm chỗ để lệch** | `DanhSachMay` |
| **D-5** | Nhà máy | **4 dải KPI rời** | Gộp = **5 bản đếm cùng một thứ** = **4 cơ hội lệch nhau** | chip nổi B-1 |
| **D-6** | Line | **Từng bo mạch / ảnh AOI trên băng tải** | Một line = hàng nghìn bo/giờ. Neo được cũng **không đọc được**, và **kéo draw call theo sản lượng** — ngân sách phụ thuộc **ca sản xuất**, không phụ thuộc thiết kế | `[Mở chức năng]` → màn kiểm tra |
| **D-7** | Line | **Hoạt ảnh băng tải chạy** | ★ Hollifield nêu **đích danh**: *"moving conveyors, animated flames"* là dấu hiệu đồ hoạ **kém**. Và dưới `frameloop="demand"` nó **giữ GPU chạy 8 tiếng liền** — phá đúng thứ `demand` mua được | nhịp hiển thị bằng **SỐ** (`nhịp 42 s`) |
| **D-8** | Máy | **Song ánh khớp nối robot thời gian thực** | §11g.7 (lô N mục #3) đo: **KHÔNG LÀM ĐƯỢC** — không có nguồn góc khớp. Vẽ nó ra là **bịa** | trạng thái + chỉ số thật |
| **D-9** | Máy | **Ảnh sản phẩm / kết quả AOI từng bo** | Một máy = hàng nghìn ảnh; không neo được vào 240 vật thể mà vẫn đọc được | `[Mở chức năng]` |
| **D-10** | cả 3 | **Biểu đồ xu hướng dài hạn** (OEE tháng, Pareto lỗi) | Cảnh 3D trả lời *"bây giờ, ở đâu"*; **không** trả lời *"ba tháng qua, vì sao"* | `/quality-cockpit`, `/analytics` |
| **D-11** | cả 3 | **Công cụ sửa bố cục** | Trộn mặt **ghi hình học** với mặt **đọc vận hành** = **kéo nhầm máy khi đang xem cảnh báo** | vùng `?che-do=botri` |
| **D-12** | Line/Máy | **`twin_vat_the` kiểu `vung`** ở cấp Line/Máy | Đo 2026-09-08: **0 hàng `vung`** (4 hàng, toàn `tuong`). Dành chỗ cho nguồn rỗng = **hứa mà không giao** | chỉ hiện ở cấp Nhà máy/Tầng, và **im khi rỗng** |

#### 15.6.2 ★ LUẬT CẮT NHÃN THEO CẤP — trần 30 phân bổ thế nào

```
  Ngân sách nhãn = 30 (trần ĐỌC ĐƯỢC, không phải trần GPU)

  Cấp Nhà máy :  ≤ 4   (cờ theo TOÀ)        → thừa 26 → KHÔNG tiêu
  Cấp Line    :  ≤ 13  (12 trạm + 1 nút thắt) → thừa 17 → KHÔNG tiêu
  Cấp Máy     :  ≤ 3   (tên + cảnh báo + sức khoẻ) → thừa 27 → KHÔNG tiêu

  ★★★ "Thừa ngân sách" KHÔNG phải lý do để tiêu.
      Trần 30 là trần MẮT NGƯỜI. 26 nhãn thừa mà đổ lên màn thì màn hỏng
      dù GPU không hề hấn. Đây là chỗ dễ sai nhất khi ai đó đọc bảng ngân sách
      §4 và thấy "150 draw calls, ta mới dùng 12".

  Xếp hạng khi VƯỢT (chỉ xảy ra ở cấp Tầng, 48 máy):
    1. E-STOP đang bật              ─┐
    2. Cảnh báo andon mức cao        │ BẤT THƯỜNG — LUÔN thắng
    3. Sức khoẻ dưới ngưỡng         ─┘
    4. Nút thắt chuyền
    5. Vật thể ĐANG CHỌN (`chon=`)   ─── ý định người dùng
    6. Tên máy trong bán kính camera ─── lấp chỗ còn lại
    ────────────────────────── cắt ở 30 ──
    7. còn lại: KHÔNG nhãn — đọc bằng màu + hover + panel trái
       ★ và hiện chip **"+N máy nữa"** — im lặng cắt là NÓI DỐI về số lượng (G9)
```

---

### 15.7 NGUỒN NGOÀI · RỦI RO · NGHIỆM THU

#### 15.7.1 ★★★ NHẤT QUÁN VỚI KẾT LUẬN §14.8 — HAY BÁC NÓ?

§14.8.1 rút kết luận: **"3D được biện minh cho ĐỊNH VỊ, không được biện minh cho ĐIỀU KHIỂN."**
Thiết kế §15 **giữ nguyên kết luận đó**, không bác. Nhưng nó **thêm ba cấp**, và ba cấp là một
**lời buộc tội mới** mà §14.8 chưa trả lời. Trả lời ở đây:

| Cáo buộc của Hollifield/PAS | §15 hoá giải thế nào | Ở đâu |
|---|---|---|
| *"90% màn cho 3D, 10% cho thông tin"* | ★ **Ba cấp làm cho cáo buộc này YẾU ĐI, không mạnh lên.** Ở cấp Nhà máy 3D **đúng là** bản đồ định vị 240 máy (thứ bảng danh sách không cho). Nhưng ở cấp **Máy**, canvas 3D chỉ chiếm **620×300 = 20 % viewport** — phần còn lại là `NganXuLy` + thẻ chỉ số. **Càng đi sâu, tỉ lệ 3D càng GIẢM** — vì càng sâu thì câu hỏi càng chuyển từ *"ở đâu"* sang *"bao nhiêu"* | 15.3.1 vs 15.3.3 |
| *"không biết nhà máy chạy tốt hay tệ"* | Chip B-1 + dải *"N việc cần biết"* trả lời **trước khi** người dùng nhìn 3D. Và ở mỗi cấp, panel *"CẦN XỬ LÝ"* giới hạn **tối đa 2 mục** — nếu mọi thứ đều khẩn thì không gì khẩn | 15.3.1, 15.6.1 |
| *"3D + màu rực = giấu mất cảnh báo"* | Bỏ bảng màu neon của mẫu (QĐ, §13c.2). Nền xám trung tính; **màu chỉ dành cho bất thường**. Nguồn màu **duy nhất** vẫn là `mauTrangThai.ts` (≤ 7 mã) | §14.7.1 |
| *"Spinning pumps, **moving conveyors**, animated flames"* | ★ **D-7 bỏ hoạt ảnh băng tải** — và đây là chỗ §15 **đắt giá nhất** so với mẫu: cả `Production Line 3D Twin.png` lẫn `Machine 3D Twin.webp` đều bán hoạt ảnh chuyển động làm điểm nhấn | 15.6.1 D-7 |
| Level 1: *"Control interactions are not made from this screen"* | **D-1** — không đặt lệnh OT trên bất kỳ cấp nào, kể cả cấp Máy nơi mẫu **có** Free Run/Pause/Stop | 15.3.3 |

★ **Một chỗ ta mạnh hơn ca chung của Hollifield, và §15 làm nó mạnh thêm:** ông cho phép mô tả sơ đồ
*"when functionally essential"*. Với **240 máy trên 4 tầng, 20 line**, bố trí không gian **LÀ**
functionally essential. Và **ba cấp là biểu hiện trực tiếp của Clause 6.3 *Display Hierarchy*
(ISA-101.01)** — nó đòi tổ chức phải có **một phân cấp màn hình có tài liệu**. §15 chính là tài liệu đó.

⚠ **Chỗ tôi KHÔNG tìm được nguồn đủ mạnh — khai thẳng (§14.8 đã khai 4 chỗ, §15 thêm 2):**
- **(e)** Không có nguồn có thẩm quyền cho *"lớp nổi giả-dialog tốt hơn modal thật trong viewer 3D"*.
  QĐ-17 dựa trên **ràng buộc RB-4 của chính dự án** + đo được, **không** dựa trên chuẩn ngành.
- **(f)** Không có nguồn cho **con số** *"tối đa 2 mục ở panel CẦN XỬ LÝ"*. Đó là **phán đoán thiết
  kế**, chọn theo tinh thần *"nếu mọi thứ đều khẩn thì không gì khẩn"*, **không** phải chuẩn.

**Nguồn ngoài áp thêm cho §15** (ngoài danh sách §17 đã có):
- **Microsoft, *Semantic Zoom*** — đổi cấp = **đổi biểu diễn**, không phải dolly camera. ⇒ cơ sở cho
  việc cấp Nhà máy neo vào **toà**, cấp Line neo vào **trạm**, cấp Máy neo vào **máy** (15.6.1).
- **NN/g, *Breadcrumbs: 11 Design Guidelines*** — breadcrumb theo **vị trí trong phân cấp**, KHÔNG
  theo lịch sử phiên. ⇒ `Nhà máy › Toà A › T2 › Line 2 › M-114` là **vị trí**, và **Back trình duyệt**
  là lịch sử — hai thứ **khác nhau**, và §15 cấp **cả hai**.
- **three.js *Rendering on Demand*** — khuôn cờ `renderRequested` chống vòng phản hồi ⇒ 15.3.6.
- **NVIDIA Omniverse web-viewer-sample** — phân chia sở hữu: **cảnh 3D sở hữu dựng hình + chọn; web
  client sở hữu panel/cây/điều khiển**. ⇒ cơ sở độc lập cho việc `NganXuLy` (mặt ghi) nằm **ngoài**
  canvas, không neo vào vật thể.

#### 15.7.2 RỦI RO — CÁI GÌ CÓ THỂ VỠ

| # | Rủi ro | Xác suất | Hậu quả | Chống |
|---|---|---|---|---|
| **R-1** | ★★★ **Ai đó cài "dialog" theo nghĩa đen ⇒ Canvas thứ hai** | **CAO** — chữ "dialog" trong yêu cầu **mời** làm thế | Vi phạm RB-4; `webglcontextlost`; canvas **đen vĩnh viễn** | QĐ-17 ghi rõ. **Test bánh cóc**: đếm `<canvas>` trong DOM ở cả 3 cấp ⇒ **luôn = 1**. Đây là bất biến **đo được**, không phải lời dặn |
| **R-2** | **`Esc` đụng độ ba lớp** (Sheet → lớp Máy → lớp Line) | CAO | Người dùng **kẹt**, hoặc đóng nhầm 2 lớp một lúc | Test bàn phím e2e: mở đủ 3 lớp, `Esc` **ba lần**, kiểm URL sau **mỗi** lần |
| **R-3** | **Hoạt ảnh camera không tự tắt** | TRUNG BÌNH | GPU **không về 0** ⇒ phá `demand`, laptop nóng cả ca | Test: sau chuyển cảnh 2 s, `renderer.info.render.frame` **không tăng nữa** |
| **R-4** | **Redirect `/command-center` trước khi `?pv=tapdoan` chạy thật** | TRUNG BÌNH | Màn đang chạy → màn hỏng, **URL vẫn 200** nên không ai báo | **KHÔNG redirect** cho tới khi cấp tập đoàn nghiệm thu bằng ảnh (15.4.3) |
| **R-5** | **Tách `TwinVanHanh` làm đứt đường ghi** | TRUNG BÌNH | Mất mặt ghi duy nhất mà **cổng vẫn xanh** — đúng 4 lớp lỗi §11c.2 | **Ablation bắt buộc** cho T-6 (15.5.3 R-T1) |
| **R-6** | ★ **Cấp Line/Máy đẹp trên dữ liệu giả, rỗng trên dữ liệu thật** | **CAO** | Nghiệm thu ĐẠT rồi production trống | `andon_events` **0 hàng `raised`**, `oee_metrics` **0 hàng/24h**, `twin_vat_the` **0 hàng `vung`** ⇒ **dựng ca dương bằng tay** rồi khôi phục byte-exact (khuôn §13d.2, đối chiếu md5) |
| **R-7** | **Thu hẹp phạm vi làm mất lối vào của `operator1`** | THẤP | Tái diễn tai nạn Đợt 3 CHẶN-1 | Mọi cấp mới **giữ cổng của `/twin`**; quyền SỬA kẹp **trong** trang (QĐ-16); đo bằng **2 tài khoản thật** |
| **R-8** | **Cấp Máy dựng glTF thật ⇒ vỡ ngân sách** | THẤP | draw call/tam giác tăng theo số mesh của file | LOD 4 bậc (§10B.3) + `ModelErrorBoundary` **đã có** + rơi về **7 khối mặc định** (§10B.1) |

#### 15.7.3 ★ NGHIỆM THU — ĐO GÌ ĐỂ BIẾT ĐẠT

★ **G82: nói thẳng khi một yêu cầu không đo được.** Ba trong bốn tính từ chủ sở hữu dùng
(*"tối ưu, nhanh, đẹp, trực quan"*) **không đo trực tiếp được**. Dưới đây là **thay thế đo được** —
và **chỗ tôi thừa nhận phép thay thế không hoàn hảo**.

| Chủ sở hữu nói | Đo được bằng | Ngưỡng | ⚠ Phép thay thế **không** bắt được gì |
|---|---|---|---|
| **"nhanh"** | ① thời gian từ click Line → khung đầu của cảnh Line ② FPS khi xoay ③ GPU khi đứng yên | ① **≤ 300 ms** ② **≥ 30** ③ **≈ 0 %** | Không bắt được *"cảm giác nhanh"* khi hoạt ảnh **giật** dù tổng thời gian đạt |
| **"tối ưu"** | ① draw calls mỗi cấp ② `<canvas>` trong DOM ③ tam giác | ① **≤ 150** (dự kiến ~12) ② **= 1** ③ **≤ 500.000** | Không bắt được **bundle phình** — đo riêng bằng `dist/public/assets` |
| **"trực quan"** | ① nhãn đồng thời ② số click từ `/twin` tới bất kỳ máy nào ③ **nghiệm thu THỊ GIÁC** — tự chụp + **tự Read ảnh** | ① **≤ 30** ② **≤ 3** ③ người đọc | ★ ② là **proxy yếu**: 3 click tới đúng máy **không** chứng minh người dùng **tìm được** máy đó |
| **"đẹp"** | ⛔ **KHÔNG ĐO ĐƯỢC** | — | ★ **Khai thẳng.** Thay bằng **nghiệm thu mắt của chủ sở hữu** trên ảnh thật. ⚠ Tiền lệ: §13g.2 nghiệm thu thị giác bắt **5 lỗi** mà **1.834 test mù**, §13f.2 bắt **5 lỗi** nữa. Đây **không** phải hình thức |

**Bảy phép đo bắt buộc trước khi tuyên bố ĐẠT:**

```
 N-1  `<canvas>` trong DOM ở CẢ BA cấp                      ⇒ luôn = 1        (RB-4)
 N-2  draw calls mỗi cấp qua `renderer.info.render.calls`    ⇒ ≤ 150
      ⚠ KHÔNG dùng `getParameter`/`readPixels` — chặn đồng bộ tới 1 ms (MDN)
 N-3  nhãn đồng thời mỗi cấp                                 ⇒ ≤ 30
 N-4  ★ ABLATION: gỡ chỗ gọi cấp Line ⇒ test PHẢI ĐỎ         ⇒ chống G5
 N-5  ★ CA DƯƠNG DỰNG TAY: chèn 1 andon `raised` ⇒ badge nổi ⇒ rồi KHÔI PHỤC
      byte-exact, đối chiếu md5                              (khuôn §13d.2)
 N-6  HAI tài khoản thật (`operator1` · `engineer1`) × ba cấp × vào/nút sửa
 N-7  ★ NGHIỆM THU THỊ GIÁC: tự chụp + TỰ READ ảnh mỗi cấp   ⇒ 3+ ảnh
      ⚠ G65: dùng `outputDir` RIÊNG; kiểm `git status -- test-results/` sau lượt cuối
```

⚠ **Cái nghiệm thu này KHÔNG chứng minh:** rằng người vận hành thật, trong ca thật, **tìm được máy
hỏng nhanh hơn** so với màn cũ. Đo điều đó cần **người dùng thật + đồng hồ**, không có trong tầm đợt
xây. **Khai ra thay vì giả vờ đã đo.**

---

### 15.8 ★★★ BỐN CÂU CẦN CHỦ SỞ HỮU TRẢ LỜI TRƯỚC KHI XÂY

| # | Câu hỏi | Vì sao không tự quyết được | Đề xuất của tôi |
|---|---|---|---|
| **Q-1** | **"Dialog" — chấp nhận LỚP NỔI (QĐ-17/L2) hay đòi MODAL THẬT chặn nền (L3)?** | Modal thật đòi **unmount cảnh nền** (RB-4) ⇒ **chậm nhất** trong 4 cách + **mất ngữ cảnh không gian**. Đây là đánh đổi giữa **chữ ông viết** và **thứ ông đặt đầu danh sách** (*"nhanh"*) — **chỉ ông quyết được** | **L2** (lớp nổi). Trông như dialog, nhanh nhất, deep-link miễn phí, Back trình duyệt tự chạy |
| **Q-2** | ~~**`/twin-studio`: giữ QĐ-16 hay tách lại hai tuyến?**~~ ✅ **ĐÃ TRẢ LỜI 2026-09-09 — TÁCH (QĐ-18, §14o)** | — | ★★★ **Chủ sở hữu chọn Đ-B (tách), NGƯỢC đề xuất Đ-A của tôi.** Lý do ông đưa mạnh hơn: *hai **mục đích** khác nhau*, không phải hai vùng. Rủi ro tôi ghi ở Đ-B (*"`operator1` mất lối vào"*) **đã đo là KHÔNG xảy ra**: `operator1` vốn không có `settings_factory` lẫn `machine_control` ⇒ **mất 0**. Đã thực thi + nghiệm thu **10/10 e2e**, 3 tài khoản thật |
| **Q-3** | **Tách `TwinVanHanh.tsx` (3.754 dòng, MỘT hàm, 50 `useMemo`) — làm trước hay sau khi xây ba cấp?** | Tách trước = ba cấp xây trên nền sạch nhưng **chậm thấy kết quả**. Xây trước = thấy ngay nhưng hàm phình lên **~5.000 dòng** và mảnh T-6 (**mặt ghi duy nhất**) càng khó tách an toàn | **T-1/T-2/T-3 TRƯỚC** (rủi ro THẤP, ~1.100 dòng, thuần đọc). T-4/T-5/T-6 **sau** khi ba cấp chạy |
| **Q-4** | **`/command-center` (1.596 dòng) — gộp vào `?pv=tapdoan` hay giữ riêng?** | Cây đa site **đã gộp** (Z4). Còn lại chỉ là sàn 3D (**D-5**: lưới tổng hợp, không phải vị trí thật) + dải KPI (**D-4**) — cả hai đều **nên bỏ**. Nhưng nó có **nav mục riêng** và người dùng có thể đang dùng | **Gộp**, nhưng ⛔ **KHÔNG redirect** cho tới khi `?pv=tapdoan` **nghiệm thu bằng ảnh với dữ liệu thật** (R-4) |

⚠ **`/layout/:id` (`App.tsx:642`) vẫn sống mà 0 lối vào UI** — nợ từ Khối D, **chưa ai quyết**. Đợt
xây phải **nối vào vùng sửa hoặc bỏ hẳn**, không để lửng thêm một đợt nữa.

---

### 15.9 TÓM TẮT — CÁI GÌ ĐÃ CÓ, CÁI GÌ PHẢI XÂY

★ **G74: "đã có" là lời khai về TỆP, không phải về VIỆC.** Cột "Đã có?" dưới đây đếm bằng **chỗ gọi**
(`file:line`), không bằng tên tệp.

| Việc | Đã có? | Bằng chứng / khoảng trống |
|---|---|---|
| Trục URL 3 cấp (`?pv=`, `?chon=`) | ✅ **CÓ** | `duongDanTwin.ts:38,269,290,553` — **không đẻ khoá mới** (G40) |
| Pha mờ ngoài phạm vi (hiệu ứng "nền dialog") | ✅ **CÓ** | `phamViCanh.ts` — `TI_LE_PHA_NGOAI_PHAM_VI = 0.72` |
| Camera bay theo Line | ✅ **CÓ** | `TwinVanHanh.tsx:1965` `khungNhinLine(...)` |
| Dải dòng chảy trạm | ✅ **CÓ** | `DaiLine.tsx` 200 dòng + `DongChayLine.tsx` 190 dòng, gọi ở `:3713` |
| Dialog thật cho cấp Máy | ✅ **CÓ** | `NganNhung.tsx` — Radix `Sheet`, focus trap, `Esc`, `aria-modal` |
| Mặt ghi cấp Máy | ✅ **CÓ** | `NganXuLy.tsx` 726 dòng — 2 mutation W1/W2 + 3 qua ngăn nhúng |
| Viền sức khoẻ neo vật thể | ✅ **CÓ** | `vienSucKhoe` `:1109`→prop`:2948`, **42 khai** đi qua |
| Khuôn lớp phủ 0 draw call | ✅ **CÓ** | `BangKpiNoi.tsx` 197 dòng |
| Cây phân cấp có roll-up | ✅ **CÓ** | `CayPhanCap` (Z4, §13f.1) |
| Gộp `/digital-twin` + 7 tab | ✅ **XONG** | `App.tsx:345-348`, 7 redirect 1 chặng |
| Gộp `/twin-studio` (QĐ-16) | ✅ **XONG** | `App.tsx:368`; nghiệm thu 5/5 e2e, 2 tài khoản thật |
| **CẢNH 3D RIÊNG cho cấp Line** | ❌ **CHƯA** | Vẫn cảnh nhà máy + siết camera. **Đây là khoảng trống #1** |
| **CẢNH 3D RIÊNG cho cấp Máy** | ❌ **CHƯA** | Dialog chứa **thân màn 2D** (`MachineCockpitBody` `:92`). **Khoảng trống #2** |
| **Khung "lớp nổi"** (viền, tiêu đề, `✕`) | ❌ **CHƯA** | Thuần CSS + 1 component. **Khoảng trống #3** |
| **Bộ nội suy camera + lập lịch `invalidate`** | ❌ **CHƯA** | Khuôn có ở `CanhNhaMay.tsx:122-136`; thiếu vòng rAF. **Khoảng trống #4** |
| **Cờ đỏ neo theo TOÀ** (cấp Nhà máy) | ❌ **CHƯA** | Hiện neo theo máy. **Khoảng trống #5** |
| **Biểu đồ sức khoẻ 24h** (C-9, cấp Máy) | ❌ **CHƯA** | Nguồn **giàu và sống**: 180.800 hàng, tươi hôm nay |
| Cấp `?pv=tapdoan` | ❌ **CHƯA** | `CapPhamVi` **đã khai** `"tapDoan"`; cảnh chưa dựng |
| Tách `TwinVanHanh` 6 mảnh | ❌ **CHƯA** | 15.5 — **Q-3** |

⇒ **Sáu khoảng trống thật.** Phần lớn công việc của yêu cầu Đợt 25 là **hoàn thiện + đổi bố cục**,
**không phải viết lại** — đúng ràng buộc §13c.4 đã mang sang từ Đợt 21.

---

## 14. Rủi ro`** từ trước. Chiếm lại số 14 sẽ tạo hai mục cùng số trong một tệp sắp đem
> ra bàn — đúng kiểu nhầm lẫn mà một bản thiết kế không được phép gây ra. Nội dung được yêu cầu nằm
> nguyên vẹn ở đây, đặt ngay trước §14 cũ. Cùng lý do và cùng cách xử lý với §12b.
>
> ★ Đánh số bên trong mục này giữ nguyên dạng **14.x** như brief yêu cầu, để đối chiếu được với brief.
> **Trạng thái: BẢN THIẾT KẾ ĐỂ CHỦ SỞ HỮU DUYỆT. KHÔNG CÓ MÃ NÀO ĐƯỢC SỬA trong đợt này.**
> Cổng ra của đợt: `git status --porcelain -- '*.ts' '*.tsx'` **rỗng**.
>
> Mục này trả lời yêu cầu nguyên văn: *"Trang 3D Twin vẫn chưa đạt yêu cầu về thiết kế… lập lại
> thiết kế 3D Twin và hợp nhất với `/digital-twin` thành 1 trang duy nhất. Thiết kế không chỉ bằng
> code và chữ mà cần vẽ cả layout và bố trí của trang."*

---

### 14.0 ★★★ BỐN ĐIỀU BRIEF ĐỢT 20 NÓI SAI — ĐO LẠI 2026-09-08

Brief giao đợt này mô tả một hiện trạng **đã cũ**. Ghi ra trước, vì một bản thiết kế dựng trên hiện
trạng sai sẽ đề xuất làm lại thứ đã làm xong — và đó là cách tiêu tiền nhanh nhất mà không mua được gì.

| # | Brief Đợt 20 nói | ĐO ĐƯỢC 2026-09-08 | Hệ quả cho thiết kế |
|---|---|---|---|
| **T-1** | *"tám nơi làm việc chồng nhau"* | Đúng về **số tệp**, sai về **số việc**. `/twin` **đã gộp sẵn** what-if (`TwinVanHanh.tsx:1502` `digitalTwin.whatIf`), phát lại workflow (`:1536` `orchestration.simulate`), tua lại lịch sử (`:748` `twinCanh.anhLichSu` + `DongThoiGian` `:157`) | Phạm vi gộp **nhỏ hơn brief tưởng**. Chỉ còn **4** mục G thật sự chưa nối — xem 14.2 |
| **T-2** | *"`/twin` cho canvas chỉ 360×453 px (~16%)"* | Con số ấy **đã được đo và ĐÃ VÁ MỘT PHẦN**, ghi nguyên văn tại `TwinVanHanh.tsx:2417-2436`. Panel nay là `w-56 2xl:w-72` (224 px dưới 1536 px) chứ không còn `w-72`; và `?thu=trai`/`?thu=phai` thu hẳn về 0 (`:2439`, `:2659`) | **Đường tới "3D gần toàn màn" ĐÃ CÓ**, chỉ là **mặc định sai** và **phải tự tìm ra**. Xem 14.1 — đây vẫn là khác biệt lớn nhất, nhưng gốc rễ **không phải bề ngang panel** |
| **T-3** | (brief không biết) | Thân `/twin` có **tối đa 8 dải ngang `shrink-0`** xếp chồng trên canvas: header 48 px (`:2006`) + 5 banner (`:2255`, `:2273`, `:2303`, `:2334`, `:2357`) + dải E-STOP (`:2381`) + dải kết quả USD + `DongThoiGian` | ★★★ **Gốc rễ thật của "3D bé"** là **chiều DỌC**, không phải chiều ngang. Xem 14.1.2 |
| **T-4** | *"`/digital-twin` = `TwinHub.tsx` vỏ mỏng 140 dòng gom 7 tab"* | Đúng. Nhưng 7 tab ấy nạp **6.974 dòng** thân màn: `DigitalTwinCenter` 936 · `RfTestCellSim` 792 · `CellTwinPlayer` 770 · `FactoryFloorEditor` 604 · `DigitalTwinDashboard` 606 · `Layout` 1.026 · `FactoryLiveMap3D` 240 | "Vỏ mỏng" là lời khai về **TwinHub.tsx**, không phải về `/digital-twin`. Chi phí gộp nằm ở 6.974 dòng kia |

> #### G74 — **"ĐÃ GỘP" LÀ LỜI KHAI VỀ TỆP, KHÔNG PHẢI VỀ VIỆC**
> Brief đếm **tệp** (8 nơi) rồi kết luận về **việc** (8 việc chồng nhau). Đo ra: 3 trong 7 mục
> GỘP của §12b **đã nối xong vào `/twin`** mà tệp cũ vẫn nằm nguyên trên đĩa — nên phép đếm tệp
> vẫn ra 8. Cùng lớp lỗi với Khối D (*"phạm vi 10 màn co còn 1 vì tôi ĐẾM tên tệp thay vì ĐỌC"*)
> và với S-5 của §12b.0. Lần này nó lặp lại **trên chính tài liệu đã ghi bài học ấy**.
> ⇒ **Luật:** trước khi lập kế hoạch gộp, grep **chỗ gọi** (`trpc.X.useQuery`) ở đích, không đếm
> tệp ở nguồn. Tệp còn sống ≠ việc chưa gộp.

---

### 14.1 ★★★ CHẨN ĐOÁN — VÌ SAO "CHƯA ĐẠT", ĐO ĐƯỢC

Chủ sở hữu nói *"chưa đạt yêu cầu về thiết kế"* mà không nêu triệu chứng cụ thể. Đo được ba nguyên
nhân, và **chúng không cùng một loại** — nên cũng không cùng một cách chữa.

#### 14.1.1 Nguyên nhân 1 — 3D không phải nhân vật chính (bố cục)

Đối chiếu với 11 ảnh mẫu chủ sở hữu đưa: **10/11 mẫu cho 3D ≥ 60% khung**. Mẫu FanRuan
(`Factory 3D Twin.jpg`) cho 3D **100% khung** — panel **nổi ĐÈ LÊN** cảnh chứ không đứng cạnh chia đất.
`/twin` hiện cho 3D ~**17–35%** tuỳ viewport.

★ Nhưng khác biệt thật **không phải con số phần trăm**, mà là **mô hình bố cục**:

| | Mẫu (FanRuan, Fujitsu, Line 3D) | `/twin` hiện tại |
|---|---|---|
| Quan hệ panel ↔ 3D | **Chồng lớp** — panel nổi trên cảnh, cảnh chạy suốt dưới đáy | **Chia đất** — panel đẩy cảnh co lại |
| Khi thêm một thông tin | Thêm một tấm nổi, **cảnh không đổi kích thước** | Cảnh **teo thêm** |
| 3D khi đủ thông tin | Vẫn toàn khung | Có thể còn **17%** |

⇒ **Đây là điều phải đổi.** Không phải "làm panel hẹp hơn" — mà **đổi từ chia-đất sang chồng-lớp**.
`/twin` **đã có sẵn khuôn đúng**: `BangKpiNoi` là lớp phủ DOM nổi trên canvas, **0 draw call**
(`:2410-2420`, khoá `?thu=kpi`). Việc của đợt xây là **đưa panel trái/phải về cùng khuôn ấy**, không
phải phát minh gì mới.

#### 14.1.2 ★★★ Nguyên nhân 2 — TÁM DẢI NGANG ĂN CHIỀU DỌC (gốc rễ thật)

Đây là thứ brief không thấy, và nó **nặng hơn** chuyện bề ngang panel.

Đo trên `TwinVanHanh.tsx`, mọi dải đều `shrink-0` (không co được) và **xếp chồng dọc trên canvas**:

```
                                     cao (px)   luôn hiện?
  header công cụ         :2006         48        LUÔN
  dải kết quả xuất USD   :2055        ~28        sau khi bấm Xuất
  banner thiếu quyền     :2255        ~26        khi có FORBIDDEN
  banner đối soát lệch   :2273        ~26        khi máy chưa đặt chỗ
  banner ngoài lượt nạp  :2303        ~26        khi có máy tầng khác   ← 373 máy ⇒ GẦN NHƯ LUÔN
  banner hạ cấp phạm vi  :2334        ~26        khi ?pv=tapdoan
  banner link bỏ qua     :2357        ~26        khi link cũ
  dải E-STOP             :2381        ~30        khi robot estop
  DongThoiGian           :2262-2270   ~44        LUÔN
                                     ───────
  xấu nhất                            280 px  = 39% của 720
```

Trên viewport 1280×720, phần thân còn **~440 px** cho canvas — và đó là **trước khi** trừ panel.
Với 3 dải hay gặp (header + ngoài-lượt-nạp + timeline = 118 px), canvas cao ~**600 px**.

> ★★★ **Không được "sửa" bằng cách bỏ banner.** Mỗi banner ở trên là **một lời khai trung thực** mà
> các đợt trước đổ công vá vào (NT-3, honest-null). Bỏ chúng = đổi một lời khai đúng lấy một chỗ im
> lặng — chính lỗi mà `:2296-2300` viết ra để cảnh báo.
>
> **Chữa đúng: đổi HÌNH DẠNG của lời khai, không bỏ lời khai.** Xem 14.4 (Dải trạng thái hợp nhất).

#### 14.1.3 Nguyên nhân 3 — bảy tab là bảy câu trả lời cho cùng một câu hỏi

`/digital-twin` bắt người dùng **chọn tab trước khi biết mình cần gì**. Bảy tab, ba chế độ dữ liệu
(LIVE/SIM/SƠ ĐỒ — `TwinHub.tsx:38`), và chúng **không phải bảy nhiệm vụ khác nhau** mà phần lớn là
**bảy cách vẽ cùng một nhà máy**:

- 3 tab dựng sàn 3D từ **hai nguồn khác nhau** trên **hai hệ toạ độ khác nhau** (§12b.2 B-3)
- 3 tab có bộ chọn nhà máy riêng (B-4)
- 4 tab có dải KPI "đang chạy / dừng / offline" riêng (B-1)

⇒ Một người hỏi *"máy X thế nào?"* phải **đoán** nó ở tab nào. Đây là lỗi **kiến trúc thông tin**,
và gộp thành một trang chính là cách chữa.

---

### 14.2 HỢP NHẤT — BẢN ĐỒ 8 NƠI → 1 TRANG

**Trang đích: `/twin`.** Không phải `/digital-twin`.

★ Vì sao chọn `/twin` làm đích, dù chủ sở hữu viết *"hợp nhất với `/digital-twin`"*:

1. `/twin` **đã là** trang gộp — 2.746 dòng, đã nối 13 nguồn dữ liệu, đã có trục URL 6 khoá
   (`duongDanTwin.ts`), đã có honest-null, đã có cổng quyền hai-trục, đã có 2D fallback.
2. `/digital-twin` là **vỏ Tabs 140 dòng** — nó không có gì để giữ ngoài chính cái vỏ.
3. Gộp về `/digital-twin` = chép 2.746 dòng đã nghiệm thu sang một vỏ chưa nghiệm thu.

⇒ **`/digital-twin` trở thành redirect vào `/twin`.** Tên hiển thị trên nav vẫn có thể là "Bản sao
số" — người dùng không mất lối vào quen thuộc, chỉ URL đổi.

#### 14.2.1 Bảng quyết định — từng nơi một

| # | Nơi | `file:line` | Quyết | Lý do |
|---|---|---|---|---|
| **1** | `/twin` `TwinVanHanh` | `App.tsx:325`, 2.746 dòng | **GIỮ — làm đích** | Đã gộp 13 nguồn, đã có trục URL, đã nghiệm thu |
| **2** | `/twin-studio` `TwinStudio` | `App.tsx:326`, 239 dòng | **GIỮ RIÊNG** | ⚠ **Không gộp** — xem 14.2.2 |
| **3** | `/digital-twin` `TwinHub` | `App.tsx:321`, 140 dòng | **BỎ vỏ** → redirect `/twin` | Vỏ Tabs không mang nghiệp vụ nào |
| 3a | tab `overview` `DigitalTwinDashboardContent` | `DigitalTwinDashboard.tsx`, 606 dòng | **GỘP MỘT PHẦN** | Chỉ lấy **G-1 sức khoẻ** (`:49` `digitalTwin.twinState`). Bảng máy `:225-254` → BỎ (B-2, `/twin` đã có `DanhSachMay`). Dải KPI `:139-176` → BỎ (B-1). `stationLoadHeatmap` `:71` → **BỎ CÓ CHỦ Ý** (B-5, nguồn không trả `periodStart`). `whatIf` `:64` → **ĐÃ GỘP RỒI** (`TwinVanHanh.tsx:1502`) |
| 3b | tab `center` `DigitalTwinCenterContent` | `DigitalTwinCenter.tsx`, 936 dòng | **GỘP MỘT PHẦN + GIỮ TỆP** | Lấy **G-4 vùng an toàn** (`:282-308`). Replay `:504-592` → **ĐÃ GỘP** (`DongThoiGian`). ★ **KHÔNG XOÁ TỆP** — §11c.7 giữ chỗ gọi `usdExport` thứ hai |
| 3c | tab `map` `FactoryLiveMap3DContent` | `FactoryLiveMap3D.tsx`, 240 dòng | **GỘP MỘT PHẦN** | Lấy **G-6 badge live/poll trung thực** (`:87`, `:122-132`). Sàn 3D `:177` → BỎ (B-3). Bộ chọn nhà máy `:135-140` → BỎ (B-4) |
| 3d | tab `floor` `FactoryFloorEditorContent` | `FactoryFloorEditor.tsx`, 604 dòng | **CHUYỂN sang `/twin-studio`** | Đây là **công cụ soạn** (9 mutation, gồm `machine.updateLayout` `:68`, `factoryZone.*` `:117-119`). Nó thuộc mặt Thiết kế, không thuộc mặt Vận hành — ranh giới §12b.7 |
| 3e | tab `layout` `LayoutContent` | `Layout.tsx`, 1.026 dòng | **CHUYỂN sang `/twin-studio`** | Cùng lý do: 3 mutation CRUD bố trí (`:161`,`:173`,`:184`). ⚠ `/layout/:id` (`App.tsx:596`) đang **sống mà 0 lối vào UI** (nợ ghi ở sổ Khối D) — đợt xây phải nối hoặc bỏ, không để lửng |
| 3f | tab `cell` `CellTwinPlayerContent` | `CellTwinPlayer.tsx`, 770 dòng | **BỎ tab** → GIỮ tệp | Phát lại workflow **ĐÃ GỘP** (`TwinVanHanh.tsx:1536` `orchestration.simulate`). Tệp còn `commandLog.avgDurations` `:210` chưa nối — đánh giá riêng, đừng gộp mù |
| 3g | tab `rf` `RfTestCellSimContent` | `RfTestCellSim.tsx`, 792 dòng | **BỎ khỏi Twin** | ★★★ Đo được: **0 lời gọi tRPC** trong cả 792 dòng. Đây là **mô phỏng thuần, không nối dữ liệu thật** — nó không trả lời *"nhà máy đang thế nào"*. §11.12 đã xếp nó ưu tiên thấp nhất. Cho nó tuyến riêng `/rf-test-cell`, **không** nằm trong Twin |
| **4** | `/command-center` `CommandCenter` | `App.tsx:441`, 1.596 dòng | **GỘP MỘT PHẦN** | Lấy **G-7 cây đa site** (`:931` `commandCenter.hierarchy`). Sàn 3D `:735` → BỎ (B-3, dùng lưới tổng hợp `:466-491` **không phải vị trí thật**). KPI `:938` → BỎ (B-1). Đài cảnh báo `:1049` → lấy **G-5** phần phân biệt rỗng-vì-RBAC |

#### 14.2.2 ★ ĐIỀU TÔI ĐỀ NGHỊ KHÔNG LÀM — không gộp `/twin-studio` vào `/twin`

Chủ sở hữu viết *"hợp nhất thành 1 trang duy nhất"*. Đọc tối đa nghĩa sẽ kéo cả `/twin-studio` vào.
**Đề nghị không**, ba lý do đo được:

1. **Hai cổng quyền KHÁC NHAU, và đó là chủ ý.** `/twin` = `analytics_oee` ∨ `machine_status`
   (`navigation.tsx:442`). `/twin-studio` = `settings_factory` ∨ `machine_control`
   (`navigation.tsx:467`, khớp `twinCanhRouter.ts:63`). Gộp một trang ⇒ **một cổng**. Chọn cổng
   rộng thì người xem sửa được nhà xưởng; chọn cổng hẹp thì **2/4 vai non-admin mất lối vào**
   — đúng tai nạn Đợt 3 CHẶN-1 đã ghi ở `navigation.tsx:445-461`.
2. **Vận hành là CHỈ ĐỌC hình học** (`canhThietKe` `TwinVanHanh.tsx:505`), Thiết kế là **SỬA**.
   Trộn mặt đọc với mặt ghi trên cùng một cảnh 3D là **mời kéo nhầm máy khi đang xem cảnh báo**
   — cùng lý lẽ đã dùng để **không** nhúng `/command-console` (§12b.4).
3. **Ranh giới hiện đang ĐÚNG** (§12b.7 kết luận nguyên văn *"đang đúng và nên giữ"*). Đổi nó phải
   có lý do mới; "gộp cho gọn" không phải lý do kỹ thuật.

⇒ **Đề xuất: HAI trang, MỘT nav group, chuyển qua lại bằng một nút trong khung.** Người dùng thấy
"một nơi làm việc"; hệ vẫn giữ hai cổng quyền. Cụ thể ở 14.3 (nút `Sửa bố cục` trên header).

★ Sau đợt này số trang Twin: **8 → 2** (`/twin` vận hành, `/twin-studio` thiết kế), cộng
`/rf-test-cell` đứng riêng ngoài Twin. Nếu chủ sở hữu vẫn muốn **đúng 1**, cách an toàn duy nhất là
**gộp cổng quyền trước** (một quyết định RBAC, không phải quyết định UI) — và tôi khuyên không.

#### 14.2.3 Đường vào cũ — KHÔNG URL NÀO ĐƯỢC CHẾT

| URL cũ | Hiện tại | Sau Đợt 21 |
|---|---|---|
| `/digital-twin` | `TwinHub` (`App.tsx:321`) | → `/twin` |
| `/digital-twin?tab=overview` | tab overview | → `/twin` (sức khoẻ là lớp phủ `?lop=sucKhoe`) |
| `/digital-twin?tab=center` | tab center | → `/twin` |
| `/digital-twin?tab=map` | tab map | → `/twin?lop=uns` |
| `/digital-twin?tab=floor` | tab floor | → `/twin-studio` |
| `/digital-twin?tab=layout` | tab layout | → `/twin-studio?che-do=botri` |
| `/digital-twin?tab=cell` | tab cell | → `/twin?thu=moPhong` (ngăn Mô phỏng đã có) |
| `/digital-twin?tab=rf` | tab rf | → `/rf-test-cell` (tuyến sống lại, ngoài Twin) |
| `/factory-live-map` | → `?tab=map` (`App.tsx:383`) | → `/twin?lop=uns` (**redirect 2 chặng phải rút thành 1**) |
| `/factory-floor-editor` | → `?tab=floor` (`:437`) | → `/twin-studio` |
| `/rf-test-cell` | → `?tab=rf` (`:438`) | → `/rf-test-cell` (**bỏ redirect, trả tuyến thật**) |
| `/cell-twin` | → `?tab=cell` (`:439`) | → `/twin?thu=moPhong` |
| `/digital-twin-center` | → `?tab=center` (`:440`) | → `/twin` |
| `/layout` | → `?tab=layout` (`:595`) | → `/twin-studio?che-do=botri` |
| `/layout/:id` | route sống, **0 lối vào UI** (`:596`) | ⚠ **CẦN QUYẾT**: nối vào `/twin-studio` hay bỏ |
| `/command-center` | route thật (`:441`) + nav (`:301`) | → `/twin?pv=tapdoan` sau khi G-7 xong. **Không redirect trước** — xem rủi ro R-4 |

★ **Luật rút redirect:** chuỗi 2 chặng (`/factory-live-map` → `/digital-twin?tab=map` → `/twin`) phải
rút thành **1 chặng** trong cùng đợt. Để 2 chặng là để lại một mắt xích sẽ mục khi ai đó dọn
`/digital-twin`.

---

### 14.3 ★★★ HÌNH VẼ BỐ CỤC — bốn cấp + ba trạng thái

> Đây là phần chủ sở hữu nhấn mạnh: *"cần vẽ cả layout và bố trí của trang"*.
> Mọi kích thước dưới đây tính trên viewport chuẩn **1280×720** (cùng viewport đã đo `/twin`
> ở `TwinVanHanh.tsx:2417-2436`, để so sánh được với hiện trạng). Con số `2xl:` là ≥1536 px.

#### 14.3.0 Nguyên tắc bố cục — MỘT KHUNG, BỐN CẤP, KHÔNG TAB

Cả bốn cấp dùng **cùng một khung**. Đổi cấp **không** đổi bố cục — chỉ đổi *nội dung cảnh* và
*mật độ thông tin*. Đây là điểm khác then chốt so với `/digital-twin` (7 tab = 7 bố cục).

```
   Nhà máy  ──zoom/click──>  Tầng  ──>  Line  ──>  Máy
      ▲                                              │
      └──────────── breadcrumb / Esc ────────────────┘
   pv=nhamay          pv=tang      pv=line     pv=may&chon=…
```

Trục điều hướng **đã có**: `pv=` (phạm vi) + `chon=` (vật thể) — `duongDanTwin.ts`. Thiết kế này
**không đẻ khoá URL mới** (G40).

---

#### 14.3.1 HÌNH A — CẤP NHÀ MÁY / KHUÔN VIÊN (`?pv=nhamay`, mặc định)

```
┌────────────────────────────────────────────────────────────────────────────────┐ 1280
│ ▣ AVI/AOI   SIM-FAC ▾ │ Nhà máy › Toà A › T2      [◉LIVE 3s] [⬒2D] [⚙Sửa bố cục]│ 44px
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 2 việc cần biết  ▾                                              [xem] [ẩn]    │ 26px ← DẢI HỢP NHẤT (14.4)
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌───────────────┐                                          ┌───────────────┐  │
│  │ ⬛ TỔNG QUAN  │            ░░░░░░░░░░░░░░░░░░             │ ⚠ CẦN XỬ LÝ   │  │
│  │ 240 máy       │        ░░░  KHUÔN VIÊN 3D  ░░░           │               │  │
│  │  208 chạy     │      ░░░   toà nhà · đường  ░░░          │ ● M-114 E-STOP│  │
│  │   19 dừng     │     ░░░  ○ toà A   ○ toà B  ░░░          │   Toà A · T2  │  │
│  │    9 mất tín  │     ░░░      ▲             ░░░           │   2 phút      │  │
│  │    4 chưa rõ  │      ░░░   cờ đỏ neo       ░░░           │ ● M-087 sức   │  │
│  │               │        ░░░ vào toà có sự cố░░░           │   khoẻ 31%    │  │
│  │ OEE  — (¹)    │            ░░░░░░░░░░░░░░░░░             │               │  │
│  │ NG   1,2%     │                                          │ [Mở chức năng]│  │
│  └───────────────┘                                          └───────────────┘  │
│    224px  nổi                  CANVAS 3D = 100% thân                nổi  256px │ 590px
│    2xl:288   ▲                 (chạy suốt DƯỚI hai tấm nổi)          ▲         │
│              │                                                       │         │
│         ◀ thu (?thu=trai)                              (?thu=phai) thu ▶       │
│                                                                                │
│                    ┌──────────────────────────────────┐                        │
│                    │ ○ Nhà máy  ● Tầng  ○ Line  ○ Máy │  ← chuyển cấp, nổi     │
│                    └──────────────────────────────────┘     đáy giữa           │
├────────────────────────────────────────────────────────────────────────────────┤
│ ◀◀ ─────────●──────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [BÂY GIỜ]      │ 40px
└────────────────────────────────────────────────────────────────────────────────┘
   (¹) OEE hiện `—`: 897 hàng oee_metrics, 0 hàng trong 24h — honest-null có tuổi (14.5)
```

**Cái gì ĐỔI so với hiện tại:**

| | Hiện tại | Thiết kế này |
|---|---|---|
| Canvas 3D | **~440×360 px** (xấu nhất) = 17% | **1280×590 px** = **82%** viewport |
| Panel | **chia đất** — đẩy canvas co lại | **nổi đè** — canvas chạy suốt dưới |
| Dải ngang | tối đa **8**, cao tới 280 px | **2** (header 44 + trạng thái 26), cố định 70 px |
| Timeline | dải thứ 9 | vẫn ở đáy, nhưng là **dải cuối cùng duy nhất** |

★ **3D "gần toàn màn" theo nghĩa của mẫu FanRuan** đạt được **không phải bằng bỏ thông tin**, mà
bằng đổi panel từ *chia đất* sang *nổi đè* + gộp 8 dải thành 1.

---

#### 14.3.2 HÌNH B — CẤP TẦNG (`?pv=tang`)

Cấp làm việc chính. Bố cục **y hệt Hình A** — chỉ nội dung cảnh đổi. Đây là điểm mấu chốt: người
dùng **không phải học lại màn hình** khi đi sâu.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▣ AVI/AOI   SIM-FAC ▾ │ Nhà máy › Toà A › T2 ▾    [◉LIVE 3s] [⬒2D] [⚙Sửa bố cục]│
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 3 việc cần biết ▾ · 373 máy ở tầng khác                        [xem] [ẩn]    │
├────────────────────────────────────────────────────────────────────────────────┤
│┌─────────────┐                                                  ┌─────────────┐│
││ TỔNG QUAN   │  ┌─Line 1───────────────────────────────┐        │ CẦN XỬ LÝ   ││
││ (tầng T2)   │  │ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ │        │             ││
││ 48 máy      │  └──────────────────────────────────────┘        │ ● M-114     ││
││  41 chạy    │  ┌─Line 2───────────────────────────────┐        │   E-STOP    ││
││   5 dừng    │  │ ▪▪ ▪▪ ▪🔴 ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪│        │             ││
││   2 chưa rõ │  └────────▲─────────────────────────────┘        │ [Mở c.năng] ││
││             │  ┌─Line 3─│─────────────────────────────┐        ├─────────────┤│
││ ─────────── │  │ ▪▪ ▪▪ ▪▪ ▪▪ ▪🟠 ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪│        │ CHI TIẾT    ││
││ DANH SÁCH   │  └──────────────────────────────────────┘        │ (khi chọn)  ││
││ [tìm…]      │  ┌─Line 4───────────────────────────────┐        │  ─ trống ─  ││
││ ▸ M-101 ●   │  │ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ │        │             ││
││ ▸ M-102 ●   │  └──────────────────────────────────────┘        │             ││
││ ▸ M-114 🔴  │            🔴 = nhãn neo (chỉ máy bất thường)     │             ││
│└─────────────┘                                                  └─────────────┘│
│                    ┌──────────────────────────────────┐                        │
│                    │ ○ Nhà máy  ● Tầng  ○ Line  ○ Máy │                        │
│                    └──────────────────────────────────┘                        │
├────────────────────────────────────────────────────────────────────────────────┤
│ ◀◀ ─────────●──────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [BÂY GIỜ]      │
└────────────────────────────────────────────────────────────────────────────────┘
```

★ **Nhãn 3D chỉ neo vào máy BẤT THƯỜNG** (🔴🟠), không neo vào 48 máy đang chạy tốt. Đây là luật
ưu tiên nhãn ở 14.5.2 — và cũng là ISA-101: *màu và nhãn dành cho bất thường, bình thường thì im*.

---

#### 14.3.3 HÌNH C — CẤP LINE (`?pv=line`)

Cấp này học từ mẫu `Machine List` (dải trạm + gauge theo trạm) — **nhưng không chép**: mẫu ấy cho
gauge nửa vòng mỗi trạm, ta dùng dải ngang vì ta có **12 trạm/line**, không phải 8.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▣ AVI/AOI  │ Nhà máy › Toà A › T2 › Line 2 ▾      [◉LIVE 3s] [⬒2D] [⚙Sửa]      │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 1 việc cần biết ▾                                              [xem] [ẩn]    │
├────────────────────────────────────────────────────────────────────────────────┤
│┌─────────────┐                                                  ┌─────────────┐│
││ LINE 2      │      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         │ CẦN XỬ LÝ   ││
││ 12 máy      │    ░░  CẢNH 3D — camera dọc theo line   ░░       │             ││
││ nhịp 42 s   │   ░░   ▪▪──▪▪──▪🔴──▪▪──▪▪──▪▪──▪▪──▪▪   ░░      │ ● M-114     ││
││ nút thắt:   │   ░░        ▲ nút thắt neo tại chỗ       ░░      │   E-STOP    ││
││  TRẠM 3 (²) │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         │             ││
││             │                                                  │ [Mở c.năng] ││
││ WIP 128     │                                                  │             ││
│└─────────────┘                                                  └─────────────┘│
│                                                                                │
├────────────────────────────────────────────────────────────────────────────────┤
│ DÒNG CHẢY TRẠM ─ dải 2D, cao 84px, CHỈ hiện ở cấp Line                         │
│  T1    T2    T3🔴   T4    T5    T6    T7    T8    T9   T10   T11   T12         │
│  ▇▇▇   ▇▇▇   ▇▇▇▇▇  ▇▇    ▇▇▇   ▇▇▇   ▇▇    ▇▇▇   ▇▇   ▇▇▇   ▇▇    ▇▇          │
│  38s   41s   67s    39s   40s   42s   38s   41s   37s  40s   39s   38s         │
├────────────────────────────────────────────────────────────────────────────────┤
│ ◀◀ ─────────●──────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [BÂY GIỜ]      │
└────────────────────────────────────────────────────────────────────────────────┘
  (²) nguồn `wip.lineBalance` — trả NGUYÊN HÀNG nên nút thắt và mốc thời gian
      CHẮC CHẮN cùng một bản ghi. KHÔNG dùng `stationLoadHeatmap` (B-5, §12b.2).
```

★ Dải `DongChayLine` **đã có** (`DaiLine.tsx`, `DongChayLine.tsx`) và đã hiện khi
`phamVi.cap === "line"` (`TwinVanHanh.tsx:2527`). Hình này **giữ nguyên**, chỉ đặt lại chỗ.

---

#### 14.3.4 HÌNH D — CẤP MÁY (`?pv=may&chon=M-114`)

Học từ `Machine 3D Twin.png` / `.webp`: 3D máy làm trung tâm, chỉ số neo quanh, panel tham số bên phải.
★ **Cố ý làm KHÁC mẫu ở một chỗ:** mẫu có `Free Run / Pause / Stop` ngay cạnh 3D. **Ta không đặt
lệnh OT ở đây** — lý do §12b.4, nhắc lại ở 14.6 R-2.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▣ AVI/AOI │ … › Line 2 › M-114 ▾              [◉LIVE 3s] [⬒2D] [✕ đóng]        │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Máy đang E-STOP — dừng lúc 14:30, 2 phút trước                    [xem]      │
├────────────────────────────────────────────────────────────────────────────────┤
│┌─────────────┐                                            ┌──────────────────┐ │
││ ← Line 2    │         ░░░░░░░░░░░░░░░░░░░░░              │ NGĂN XỬ LÝ       │ │
││             │       ░░░                    ░░░           │                  │ │
││ M-114       │      ░░    MÔ HÌNH MÁY 3D     ░░           │ Cảnh báo (3)     │ │
││ AOI-3D      │      ░░    (glTF hoặc khối    ░░           │ ┌──────────────┐ │ │
││ Line 2 · T3 │      ░░     mặc định §10B)    ░░           │ │E-STOP  14:30 │ │ │
││             │       ░░░                    ░░░           │ │[Xác nhận]    │ │ │
││ ● E-STOP    │         ░░░░░░░░░░░░░░░░░░░░░              │ └──────────────┘ │ │
││             │                                            │                  │ │
││ Sức khoẻ    │   ┌────────┐ ┌────────┐ ┌────────┐        │ [+ Tạo phiếu]    │ │
││   31% ▼     │   │ Nhiệt  │ │ Rung   │ │ Chu kỳ │        │                  │ │
││ (180.674 kỳ │   │ 74 °C  │ │ 2,1 mm │ │ 41,2 s │        │ ── Mở chức năng ─│ │
││  mới nhất   │   │ ▲ cao  │ │ bình   │ │ bình   │        │ ▸ Buồng lái máy  │ │
││  HÔM NAY)   │   └────────┘ └────────┘ └────────┘        │ ▸ Lịch sử bảo trì│ │
││             │      THẺ CHỈ SỐ — lớp phủ DOM,             │ ▸ Chương trình   │ │
││ NG 24h 2,1% │      0 draw call, neo dưới máy             │                  │ │
│└─────────────┘                                            └──────────────────┘ │
│  224px                        canvas 3D                              288px     │
├────────────────────────────────────────────────────────────────────────────────┤
│ ◀◀ ─────────●──────────────────────── ▶ │ 14:32 hôm nay │ 1× │ [BÂY GIỜ]      │
└────────────────────────────────────────────────────────────────────────────────┘
```

★ Ngăn xử lý bên phải **đã có** (`NganXuLy.tsx`, mặt ghi duy nhất, 2 mutation W1/W2 + 3 qua ngăn
nhúng). Hình này **không thêm đường ghi nào** — chỉ đặt lại chỗ và cho nó nổi thay vì chia đất.

---

#### 14.3.5 HÌNH E — TRẠNG THÁI ĐẶC BIỆT: 3D TOÀN MÀN (`?thu=trai,phai`)

Đây là câu trả lời trực tiếp cho *"mẫu Fujitsu cho 3D gần toàn màn"*. **Đường này đã có**
(`?thu=`), thiết kế chỉ làm nó **tìm thấy được**: một nút ⛶ trên header + phím `F`.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▣ │ Nhà máy › Toà A › T2                     [◉LIVE 3s] [⬒2D] [⛶ thoát]        │ 44px
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│                                                                                │
│   ▸ 240 máy    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      ⚠ 2 ●         │
│   ▸ 208 chạy ░░░░░                                    ░░░░░░                   │
│   ▸  19 dừng░░░                CẢNH 3D                   ░░░                   │
│              ░░░           100% × 676 px                  ░░░                  │
│   chip nổi   ░░░              = 94% viewport               ░░░  chip nổi       │
│   góc trái   ░░░░░                                    ░░░░░░   góc phải        │
│   (đọc liếc)   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░       (bấm → mở panel)│
│                                                                                │
│                    ┌──────────────────────────────────┐                        │
│                    │ ○ Nhà máy  ● Tầng  ○ Line  ○ Máy │                        │
│                    └──────────────────────────────────┘                        │
└────────────────────────────────────────────────────────────────────────────────┘
```

⚠ **Ngay cả ở chế độ này, hai thứ KHÔNG được biến mất**: (a) chip cảnh báo góc phải — an toàn không
xếp hàng sau thẩm mỹ; (b) chỉ báo LIVE/tuổi dữ liệu trên header — người xem phải luôn biết mình đang
nhìn *bây giờ* hay *lúc 3 giờ sáng*.

---

#### 14.3.6 HÌNH F — TRẠNG THÁI ĐẶC BIỆT: ĐANG TUA LẠI (`?tg=…`)

Trạng thái nguy hiểm nhất về mặt trung thực: **cảnh trông y hệt lúc LIVE**. Phải khai bằng thị giác,
không chỉ bằng chữ.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ▣ │ Nhà máy › Toà A › T2       [⏱ ĐANG TUA — 03:00 hôm nay] [⬒2D] [⚙]         │ 44px
├════════════════════════════════════════════════════════════════════════════════┤ ← viền hổ phách
│                              ░░░░░░░░░░░░░░░░░                                 │   2px, BAO QUANH
║  ┌───────────┐              ░░  CẢNH LÚC 03:00 ░░           ┌───────────┐      ║   toàn canvas
║  │ TỔNG QUAN │             ░░  (không phải bây giờ)░░       │ CẦN XỬ LÝ │      ║
║  │ lúc 03:00 │              ░░░░░░░░░░░░░░░░░░░░░           │ lúc 03:00 │      ║
║  └───────────┘                                              └───────────┘      ║
│                     ┌──────────────────────────────────┐                       │
│                     │ ○ Nhà máy  ● Tầng  ○ Line  ○ Máy │                       │
│                     └──────────────────────────────────┘                       │
├════════════════════════════════════════════════════════════════════════════════┤
│ ◀◀ ────●───────────────────────────── ▶ │ 03:00 hôm nay │ 4× │ [◉ VỀ BÂY GIỜ]  │ 40px
└────────────────────────────────────────────────────────────────────────────────┘
```

Ba chỉ báo **đồng thời**, vì một cái có thể bị bỏ sót: (1) viền hổ phách bao canvas · (2) chữ
"ĐANG TUA + mốc" thay chỗ badge LIVE trên header · (3) nút `VỀ BÂY GIỜ` sáng ở timeline.
★ Mọi tấm nổi đổi nhãn thành *"lúc 03:00"* — nếu không, panel trái nói số của 03:00 dưới tiêu đề
trông như số bây giờ. Đây chính là lỗi `whatIfQ` đã vá ở `:1515-1518` (kết quả chuyền trước nằm lại
dưới nhãn chuyền mới), áp cho trục thời gian.

---

### 14.4 DẢI TRẠNG THÁI HỢP NHẤT — chữa 8 dải mà không bỏ lời khai nào

Vấn đề 14.1.2: 8 dải ngang ăn tới 280 px. Nhưng mỗi dải là **một lời khai trung thực** không được bỏ.

**Chữa: đổi hình dạng, giữ nội dung.** Một dải cao **26 px** luôn ở chỗ cũ, gộp mọi lời khai:

```
  THU (mặc định) — 26px
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚠ 3 việc cần biết ▾ · 373 máy ở tầng khác                     [xem] [ẩn]   │
└────────────────────────────────────────────────────────────────────────────┘

  MỞ (bấm ▾ hoặc [xem]) — panel nổi ĐÈ canvas, canvas KHÔNG co lại
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚠ 3 việc cần biết ▴                                           [ẩn tất cả]  │
├────────────────────────────────────────────────────────────────────────────┤
│ 🔴 AN TOÀN   Robot R-07 đang E-STOP                          [Mở buồng lái]│
│ 🟠 DỮ LIỆU   12 máy chưa đặt chỗ · 3 chỗ đặt mồ côi          [Sửa bố cục]  │
│ 🔵 PHẠM VI   373 máy ở tầng khác của toà này                 [Đổi tầng]    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Luật cứng:**

1. **Dải E-STOP KHÔNG bị gộp khi đang có E-STOP.** An toàn không xếp hàng sau bố cục — đúng nguyên
   văn `TwinVanHanh.tsx:2370-2374`. Khi `anToan.coCanhBao`, dải an toàn **hiện riêng, đỏ, luôn mở**;
   dải hợp nhất mang phần còn lại.
2. **Đếm phải đúng.** "3 việc cần biết" = số banner **thật sự đang có điều kiện bật**, không phải số
   loại banner. Sai chỗ này là G9 (đơn vị của con số).
3. **`[ẩn]` chỉ ẩn phiên này**, không ghi vào server, và **không ẩn được nhóm AN TOÀN**.
4. Mỗi dòng giữ nguyên `data-testid` cũ (`banner-doi-soat`, `banner-ngoai-luot-nap`, …) để **bánh
   cóc e2e sẵn có không đỏ** — đổi bố cục không được đổi hợp đồng đo.

⇒ Chiều dọc: **280 px → 26 px** (xấu nhất → thường), và khi mở là **nổi đè**, canvas vẫn nguyên.

---

### 14.5 ★★★ THÔNG TIN NÀO ĐƯỢC LÊN 3D — bốn nhóm A/B/C/D

> Đây là mục chủ sở hữu yêu cầu thêm: *"cần xác định các thông tin đưa lên twin 3D"*.
> Câu hỏi: **trong toàn bộ dữ liệu hệ có, cái gì xứng đáng chiếm chỗ trên cảnh 3D?**

#### 14.5.0 Ngân sách — cái gì đắt, cái gì miễn phí

| Cách hiện thông tin | Chi phí | Trần |
|---|---|---|
| **Nhãn 3D** (troika/CSS2D neo vào vật thể) | **1 draw call MỖI nhãn** | **30 nhãn** (§4) |
| **Màu trên thân máy** | **0** — đã nằm trong `BatchedMesh` | không giới hạn |
| **Lớp phủ DOM** (`BangKpiNoi`, thẻ chỉ số) | **0 draw call** | giới hạn bởi *chỗ đọc*, không bởi GPU |
| **Panel bên** | 0 | giới hạn bởi *sự chú ý* |

★ Đo được: 240 máy = **3 draw calls**. Trần 150 còn **rất nhiều chỗ** — **nhưng đừng tiêu bằng nhãn 3D**,
vì trần nhãn (30) là trần **đọc được**, không phải trần GPU: 300 nhãn CSS2D đã laggy *và* không ai đọc nổi.

#### 14.5.1 NHÓM A — NEO VÀO VẬT THỂ 3D (đắt, phải giành chỗ)

Tiêu chí vào nhóm A: **thông tin chỉ có nghĩa khi biết máy NÀO** — và người dùng cần biết *ở đâu*
trước khi biết *bao nhiêu*.

| # | Thông tin | Hình thức | Nguồn | Đã có? | Tốn nhãn? |
|---|---|---|---|---|---|
| A-1 | **Trạng thái vận hành** (chạy/dừng/mất tín/chưa rõ) | **MÀU thân máy** | `factoryCommand.overview` `:525` | **CÓ** | **0** ✔ |
| A-2 | **Cảnh báo andon đang mở** | **Badge neo** + màu | `andon.active` `:538` | **CÓ** (`LopCanhBao.tsx`) | 1/máy báo động |
| A-3 | **E-STOP robot** | **Badge đỏ neo** + dải | `twinCanh.anToanRobot` `:551` | **CÓ** | 1/robot estop |
| A-4 | ★ **Sức khoẻ máy / nguy cơ hỏng** | **Vòng viền quanh đế máy** (0 nhãn) + nhãn CHỈ khi < ngưỡng | `digitalTwin.twinState` (`DigitalTwinDashboard.tsx:49`) | **CHƯA** (G-1) | 1/máy dưới ngưỡng |
| A-5 | **Nút thắt chuyền** | Neo vào **trạm**, 1 nhãn/line | `wip.lineBalance` `:609` | **CÓ** (dải 2D) — chưa neo 3D | 1/line |
| A-6 | ★ **Vùng an toàn / chia sẻ với người** | **Khối trong suốt**, nhãn CHỈ khi chọn | `factoryZone.listByFactory` (`FactoryFloorEditor.tsx:103`) | **CHƯA** (G-4) | 0 khi không chọn |
| A-7 | **Tên/mã máy** | Nhãn | `twinCanh.canhThietKe` `:514` | **CÓ** | 1/máy ⚠ **kẻ ngốn ngân sách** |

★★★ **A-4 là ứng viên số một cho nhóm A**, và số đo nói vì sao: `machine_health_history`
**180.674 hàng, mới nhất HÔM NAY (2026-09-08)** — nguồn **giàu nhất và còn sống**. §12b.2 xếp nó vào
GỘP với lý do đúng: `/twin` hiện tô màu theo **trạng thái vận hành** (A-1), không theo **sức khoẻ**
⇒ A-4 là **thông tin MỚI**, không phải vẽ lại A-1.

⚠ **A-4 phải khác A-1 về hình thức**, nếu không hai thứ tranh nhau một kênh thị giác: A-1 giữ **màu
thân**, A-4 lấy **vòng viền đế**. Một máy *đang chạy* mà *sức khoẻ 31%* phải đọc được là **xanh thân
+ viền hổ phách** — và đó chính là ca mà A-4 mua được giá trị.

#### 14.5.2 ★ LUẬT ƯU TIÊN NHÃN — khi vượt trần 30

A-7 (tên máy) một mình đã ngốn hết ngân sách: 48 máy/tầng > 30. Nên **không thể "hiện tên mọi máy"**.

```
  Xếp hạng nhãn, cắt ở 30:
   1. E-STOP đang bật                    (A-3)  ─┐
   2. Cảnh báo andon mức cao             (A-2)   │ BẤT THƯỜNG — luôn thắng
   3. Sức khoẻ dưới ngưỡng               (A-4)  ─┘
   4. Nút thắt chuyền                    (A-5)
   5. Vật thể ĐANG CHỌN (`chon=`)        (A-7)  ─── ý định người dùng
   6. Tên máy trong bán kính camera      (A-7)  ─── lấp chỗ còn lại
   ────────────────────────────────── cắt ở 30 ──
   7. còn lại: KHÔNG nhãn — đọc bằng màu (A-1) + hover + panel trái
```

Ba tính chất phải test (module thuần, `locNhan.ts` — đã có khuôn `locBadge.unit.test.ts`):
1. Bất thường **không bao giờ** bị cắt để nhường tên máy bình thường.
2. Vật thể đang chọn **luôn** có nhãn, kể cả khi 30 chỗ đã đầy bất thường (⇒ trần **31** khi có chọn,
   hoặc đẩy nhãn hạng thấp nhất ra — chọn cách sau, và **nói ra** trong test).
3. Khi bị cắt, hiện **"+N máy nữa"** ở chip góc — im lặng cắt là nói dối về số lượng (G9).

#### 14.5.3 NHÓM B — LỚP PHỦ 2D TRÊN CẢNH (0 draw call, đọc bằng mắt liếc)

Tiêu chí: **con số tổng hợp**, đọc trong một cái liếc, không cần biết máy nào.

| # | Thông tin | Chỗ | Nguồn | Đã có? |
|---|---|---|---|---|
| B-1 | Đếm máy theo trạng thái (240/208/19/9/4) | chip nổi góc trái | `factoryCommand.overview` | **CÓ** (`BangKpiNoi`) |
| B-2 | Số cảnh báo đang mở | chip nổi góc phải | `andon.active` | **CÓ** |
| B-3 | Tuổi dữ liệu + LIVE/poll | header | `:1986` + ★ G-6 `phuUns` | **MỘT PHẦN** |
| B-4 | Badge xuất xứ (SHADOW/mô phỏng/sơ đồ) | header | `:1967` logic `:821` | **CÓ** |
| B-5 | Mốc thời gian đang xem | timeline + viền | `tg=` | **CÓ** |
| B-6 | OEE tổng | chip nổi | `oee_metrics` | ⚠ **xem 14.5.6** |
| B-7 | Tỷ lệ NG 24h | chip nổi | `product_inspections` | ⚠ **BỊ CHẶN** — P-1, `factoryCode` NULL 2.880/2.880 |

#### 14.5.4 NHÓM C — PANEL BÊN / DƯỚI (đọc kỹ, so sánh, cuộn)

Tiêu chí: cần **so sánh nhiều dòng**, hoặc cần **thao tác**.

| # | Thông tin | Chỗ | Nguồn | Đã có? |
|---|---|---|---|---|
| C-1 | Danh sách máy có lọc/tìm | panel trái | `canhThietKe` | **CÓ** (`DanhSachMay`, ảo hoá) |
| C-2 | Đài cảnh báo (gộp, chip mức, >24h) | panel trái | `andon.active` | **CÓ** (`DaiCanhBao`) |
| C-3 | Chi tiết máy đang chọn | panel phải | nhiều | **CÓ** (`NganXuLy`) |
| C-4 | Xác nhận cảnh báo / tạo phiếu | panel phải | W1/W2 | **CÓ** ⚠ chưa lọc tenant (L-1) |
| C-5 | Dòng chảy trạm theo line | dải dưới (chỉ cấp Line) | `wip.lineBalance` | **CÓ** (`DaiLine`) |
| C-6 | Mô phỏng what-if | ngăn `?thu=moPhong` | `digitalTwin.whatIf` | **CÓ** (`:1502`) |
| C-7 | Phát lại workflow | ngăn `?thu=moPhong` | `orchestration.simulate` | **CÓ** (`:1536`) |
| C-8 | ★ Cây đa site có roll-up | panel trái, cấp Tập đoàn | `commandCenter.hierarchy` | **CHƯA** (G-7) |
| C-9 | Lịch sử sức khoẻ 1 máy (biểu đồ) | panel phải, cấp Máy | `machine_health_history` | **CHƯA** |

#### 14.5.5 ★★★ NHÓM D — KHÔNG LÊN 3D (quan trọng ngang nhóm A)

> Một trung tâm nhồi mọi thứ sẽ **không đọc được**. Đây là danh sách cái **cố ý bỏ**.

| # | Thông tin | Vì sao KHÔNG | Ở đâu thay thế |
|---|---|---|---|
| D-1 | **Nút lệnh OT** (Start/Stop/Reset/đổi chế độ) | §12b.4, ba lý do đo được: cảnh 3D là mặt **khám phá** — người ta xoay/kéo/bấm thử; đường ghi hiện có **chưa lọc tenant** (L-1); cảnh **không tự chứng minh đủ tươi để RA LỆNH** (đủ tươi để NHÌN ≠ đủ tươi để STOP) | `[Mở chức năng]` → `/command-console`, rời mặt khám phá **có ý thức** |
| D-2 | **`stationLoadHeatmap` làm chỉ báo nút thắt** | B-5 §12b.2: thủ tục **không trả `periodStart`** ⇒ không tự chứng minh còn hạn. Đợt 8 đo được **một lời khai 16 ngày tuổi tô đỏ sai trạm** | `wip.lineBalance` — trả NGUYÊN HÀNG, mốc và số **chắc chắn cùng bản ghi** |
| D-3 | **Bảng máy dạng bảng** (`DigitalTwinDashboard.tsx:225-254`) | Trình bày lại C-1. Bảng thứ hai không thêm sự thật, chỉ thêm chỗ để lệch | `DanhSachMay` panel trái |
| D-4 | **Bốn dải KPI "đang chạy/dừng/offline"** | B-1 §12b.2: gộp = **năm** bản đếm cùng một thứ = **bốn cơ hội lệch nhau** | chip nổi B-1 |
| D-5 | **Ba bộ dựng sàn 3D rời** | B-3: đọc **hai nguồn** trên **hai hệ toạ độ**; `CommandCenter` dùng **lưới tổng hợp** (`:466-491`) không phải vị trí thật ⇒ hai cảnh nói hai câu về cùng nhà máy | một cảnh, nguồn `canhThietKe` |
| D-6 | **Mô phỏng RF cell** (`RfTestCellSim`, 792 dòng) | **0 lời gọi tRPC** — không nối dữ liệu thật, không trả lời *"nhà máy đang thế nào"* | tuyến riêng `/rf-test-cell` ngoài Twin |
| D-7 | **Công cụ sửa bố cục** (kéo-thả máy, vẽ vùng, CRUD layout) | Mặt **ghi hình học** trộn với mặt **đọc vận hành** = kéo nhầm máy khi đang xem cảnh báo. Hai cổng quyền khác nhau (14.2.2) | `/twin-studio` |
| D-8 | **Biểu đồ xu hướng dài hạn** (OEE tháng, Pareto lỗi) | Cần trục thời gian dài + so sánh nhiều chiều — cảnh 3D trả lời *"bây giờ, ở đâu"*, không trả lời *"ba tháng qua, vì sao"* | `/quality-cockpit`, `/analytics` |
| D-9 | **Ảnh sản phẩm / kết quả AOI từng bo** | Một máy = hàng nghìn ảnh; không neo được vào 240 vật thể mà vẫn đọc được | `[Mở chức năng]` → màn kiểm tra |
| D-10 | **Nhãn tên cho MỌI máy** | 48 máy/tầng > trần 30 nhãn, và 240 nhãn thì **không ai đọc** | màu thân (A-1) + hover + C-1 |

#### 14.5.6 ⚠ BA NGUỒN CHƯA ĐỦ SỐNG — phải khai tuổi, không được khai `0`

Đo được 2026-09-08. Ba nguồn này **có bảng, có hàng, nhưng không đủ để làm chỉ báo trên cảnh**:

| Nguồn | Đo được | Hệ quả thiết kế |
|---|---|---|
| `oee_metrics` | **897 hàng**, chỉ **36 máy** SIM-FAC, **0 hàng trong 24h** | B-6 phải hiện **`—` kèm "đo trên 0/240 máy trong 24h"**, ★ **không** `0%`. `?? 0` là lời khai sai. Và **không** cho nó chiếm 1 trong 30 nhãn để rồi hiện `—` |
| `andon_events` | **7 hàng**, ★ **0 hàng trạng thái `raised`** (G26) | A-2 **hiện chưa có dữ liệu để thấy**. Nhánh "chưa xác nhận" **chưa ai đi qua bao giờ** ⇒ nghiệm thu **bắt buộc dựng ca dương bằng tay**: chèn 1 hàng `raised`, mở `/twin`, badge phải **nổi lên**; khôi phục thì tắt. Không dựng ca dương thì "không badge nào hiện" trông y hệt nhau dù mã đúng hay hỏng (G5/G22) |
| `product_inspections` | 2.880 hàng, **2.880/2.880 `factoryCode` NULL** | B-7 **rỗng với mọi vai không-admin**. ⚠ Chữa SAI là nới cổng thành "NULL thì cho qua" — mở lại đúng lỗ Q1 vừa vá. Phải sửa **đường ghi** trước (P-1) |

★ `machine_health_history` (**180.674 hàng, tươi hôm nay**) là nguồn **duy nhất** trong nhóm ứng viên
mới vừa **giàu** vừa **sống** ⇒ A-4 nên là mục xây đầu tiên của Đợt 21.

★ Tên bảng phiếu việc là **`maintenance_work_orders`** (cùng `maintenance_schedules`,
`work_order_parts`) — **không phải** `work_orders`. Ghi ra vì G24: tên trong spec phải grep ra được
trong mã sản phẩm.

---

### 14.6 TỪNG CHỨC NĂNG TRÊN TRANG MỚI — vùng · nguồn · đã có · ai thấy

★ Cột **"Ai thấy"** đo từ `navigation.tsx` + `hasPermission()` trong mã, không suy từ spec (G24).
★★★ Mọi dòng "ai thấy" phải nghiệm thu bằng vai **KHÔNG-admin** — admin **bypass** `requirePermission`,
nên đo bằng admin chứng minh **số 0** về quyền (bài học Khối D).

| # | Chức năng | Vùng (hình) | Nguồn `file:line` / thủ tục | Đã có | Ai thấy được |
|---|---|---|---|---|---|
| F-01 | Vào trang | — | `App.tsx:325` | CÓ | `analytics_oee` ∨ `machine_status` (`navigation.tsx:442`) |
| F-02 | Breadcrumb 4 cấp, bấm được | header (A–D) | `:1869` | CÓ | như F-01 |
| F-03 | Chọn nhà máy / toà / tầng | header | `factory.list` `:293`, `twinCanh.danhSachToaNha` `:390` | CÓ | như F-01 |
| F-04 | Chỉ báo LIVE + tuổi dữ liệu | header (B-3) | `:1926`, `:1986` | CÓ | như F-01 |
| F-05 | Badge xuất xứ SHADOW/SIM/sơ đồ | header (B-4) | `:1967`, logic `:821` | CÓ | như F-01 |
| F-06 | Toggle 2D/3D | header | `:2029` | CÓ | ai cũng thấy; **disable** khi WebGL hỏng (năng lực ≠ quyền) |
| F-07 | Xuất USD | header | `xuatUsd.ts` | CÓ | **ẨN** nếu thiếu `machine_status/canView` (`:2005`) |
| F-08 | ⛶ 3D toàn màn | header (E) | `?thu=trai,phai` | **MỘT PHẦN** — đường có, nút **chưa** | như F-01 |
| F-09 | Dải trạng thái hợp nhất | dải 26px (14.4) | gộp 5 banner + E-STOP | **CHƯA** (bố cục mới) | như F-01; nhóm AN TOÀN **không ẩn được** |
| F-10 | Cảnh 3D + xoay/zoom/chọn | canvas (A–D) | `CanhVanHanh.tsx`, `twinCanh.canhThietKe` `:514` | CÓ | cần `quyenDocHinhHoc` (`twinCanhRouter.ts:196`); thiếu ⇒ banner `:2255`, **không** cảnh trống |
| F-11 | Cảnh 2D thay thế | canvas | `CanhVanHanh2D.tsx` | CÓ | như F-10 |
| F-12 | Màu thân theo trạng thái (A-1) | canvas | `factoryCommand.overview` `:525` | CÓ | như F-01 |
| F-13 | Badge cảnh báo neo (A-2) | canvas | `andon.active` `:538` | CÓ | ⚠ **0 hàng `raised`** — chưa thấy được, xem 14.5.6 |
| F-14 | Badge E-STOP neo (A-3) | canvas + dải | `twinCanh.anToanRobot` `:551` | CÓ | như F-01 |
| F-15 | ★ Vòng sức khoẻ máy (A-4) | canvas | `digitalTwin.twinState` | **CHƯA** (G-1) | cần đo — thủ tục có cổng riêng |
| F-16 | ★ Vùng an toàn (A-6) | canvas | `factoryZone.listByFactory` | **CHƯA** (G-4) | cần đo |
| F-17 | Nhãn máy + luật ưu tiên (14.5.2) | canvas | `locNhan.ts` (khuôn `locBadge.ts`) | **MỘT PHẦN** — cap có, xếp hạng **chưa** | như F-01 |
| F-18 | Chip KPI nổi (B-1/B-2) | góc canvas | `BangKpiNoi`, `?thu=kpi` | CÓ | như F-01 |
| F-19 | Bộ chuyển cấp (nhà máy/tầng/line/máy) | đáy giữa | `pv=` | **MỘT PHẦN** — `pv=` có, bộ chuyển **chưa** | như F-01 |
| F-20 | Danh sách máy lọc/tìm (C-1) | panel trái | `DanhSachMay`, ảo hoá | CÓ | như F-01 |
| F-21 | Đài cảnh báo (C-2) | panel trái | `DaiCanhBao` | CÓ | như F-01 |
| F-22 | ★ Phân biệt rỗng-vì-RBAC / bình yên | panel trái | G-5 (`CommandCenter.tsx:1458-1481`) | **CHƯA** | như F-01 |
| F-23 | ★ Cây đa site roll-up (C-8) | panel trái, `pv=tapdoan` | `commandCenter.hierarchy` | **CHƯA** (G-7) | cần đo |
| F-24 | Chi tiết máy đang chọn | panel phải | `NganXuLy.tsx` | CÓ | như F-01 |
| F-25 | **Xác nhận cảnh báo** (W1) | panel phải | `andon.acknowledge` | CÓ | **ẨN** nếu thiếu `andon/canEdit` (`:1793`) ⚠ **chưa lọc tenant** (L-1) |
| F-26 | **Tạo phiếu bảo trì** (W2) | panel phải | `maintenance.createWorkOrder` → `maintenance_work_orders` | CÓ | **ẨN** nếu thiếu `machine_monitoring/canCreate` (`:1797`) ⚠ **chưa lọc tenant** (L-1) |
| F-27 | Ẩn tạm cảnh báo | panel phải | — | ⚠ **khai mà không ghi** (P-4) | `machine_control/canCreate` (`:1794`) |
| F-28 | Mở chức năng → cockpit/console | panel phải | `NganXuLy.tsx:574-599` | CÓ | lọc theo quyền từng mục (`:577`, `:2679`) |
| F-29 | Ngăn nhúng tại chỗ (cockpit trong Sheet) | panel phải | `NganNhung.tsx` | CÓ | theo cockpit ⚠ `RobotCockpit.tsx:916-918` **hiện-rồi-chặn** (P-3) |
| F-30 | Dòng chảy trạm (C-5) | dải dưới, cấp Line | `wip.lineBalance` `:609` | CÓ | như F-01 |
| F-31 | Mô phỏng what-if (C-6) | ngăn `?thu=moPhong` | `digitalTwin.whatIf` `:1502` | CÓ | như F-01 |
| F-32 | Phát lại workflow (C-7) | ngăn `?thu=moPhong` | `orchestration.simulate` `:1536` | CÓ | **ẨN** nếu thiếu `machine_monitoring/canView` (`:1530`) |
| F-33 | Tua lại 24h + trạng thái tua (F) | timeline | `twinCanh.anhLichSu` `:748` | CÓ | như F-01 |
| F-34 | ★ Chỉ báo "đang tua" ba lớp | viền + header + nút | 14.3.6 | **CHƯA** | như F-01 |
| F-35 | Link sâu hai chiều (`pv/chon/cam/lop/tg/thu`) | URL | `duongDanTwin.ts` | CÓ | như F-01 |
| F-36 | Chuyển sang `/twin-studio` | header ⚙ | `navigation.tsx:467` | **CHƯA** (nút) | **ẨN** nếu thiếu `settings_factory` ∨ `machine_control` |
| F-37 | Tóm tắt cho trình đọc màn hình | ẩn | `:2470` `sr-only` | CÓ | mọi vai |
| F-38 | ★ Lịch sử sức khoẻ 1 máy (C-9) | panel phải, cấp Máy | `machine_health_history` | **CHƯA** | cần đo |

**Tổng: 38 chức năng — CÓ 24 · MỘT PHẦN 4 · CHƯA 10.**
⇒ Đợt 21 là **hoàn thiện + đổi bố cục**, không phải viết lại. Đây là lý do tôi đề nghị **không**
đập đi làm lại `/twin`.

---

### 14.7 THAM CHIẾU MẪU — NGUYÊN TẮC RÚT RA, KHÔNG PHẢI BẢN SAO

> Chủ sở hữu nói rõ: *"anh tham khảo là cách và kiểu thiết kế để bạn tham khảo thêm, không nhất
> thiết là copy giống 100%"*. Nên với mỗi thứ lấy từ mẫu, ghi **nguyên tắc** và **vì sao hợp/không hợp**.

| Mẫu | Chi tiết trình bày | **Nguyên tắc rút ra** | Áp cho hệ này? |
|---|---|---|---|
| `Factory 3D Twin .jpg` (Fujitsu) | Vòng tròn % xếp dọc hai mép | **3D là nhân vật chính; KPI nổi TRÊN nó, không đứng cạnh chia đất** | ✔ **ÁP** — 14.1.1, 14.3.1. ✘ **BỎ** vòng tròn %: chiếm nhiều điểm ảnh cho một con số, và ta cần đọc **nhiều** số cùng lúc |
| Fujitsu | Cờ đỏ chữ "Down" cắm vào cảnh | **Bất thường phải NEO vào vật thể**, không chỉ nằm trong danh sách | ✔ **ÁP** (A-2/A-3). ✘ **ĐỔI HÌNH THỨC**: cờ 3D tốn draw call + che máy. Dùng **badge phẳng + vòng viền** — hợp ISA-101 hơn |
| `Production Line 3D Twin.png` | Timeline **trên cùng**, kéo được | **Trục thời gian là công dân hạng nhất** | ✔ **ÁP** nguyên tắc. ✘ **ĐỔI CHỖ**: ta đặt **đáy**. Lý do: `DongThoiGian` đã ở đáy và e2e đang bám; đổi chỗ mua 0 sự thật mà làm đỏ bánh cóc |
| ″ | Robot đổi **màu cam khi quá nhiệt** ngay trong cảnh | **Thông số vượt ngưỡng đổi màu vật thể — 0 draw call** | ✔ **ÁP** — đúng cơ chế A-4 (vòng viền sức khoẻ) |
| ″ | Thanh cảnh báo đỏ đáy **nêu đích danh máy** | **Cảnh báo phải gọi tên**, không chỉ đếm | ✔ **ÁP** — dải hợp nhất 14.4 nêu đích danh + nút nhảy tới |
| `Machine 3D Twin.png` | `Free Run/Pause/Stop` **cạnh 3D** | Điều khiển gần đối tượng điều khiển | ✘ **CỐ Ý KHÔNG ÁP** — D-1/§12b.4. Đây là chỗ **quan trọng nhất tôi làm khác mẫu**: mẫu là máy đơn có người đứng cạnh; ta là **240 máy nhìn từ xa qua mạng**, cảnh có thể trễ |
| ″ | Chỉ số máy dạng **thẻ dưới đáy** | **Thông số neo quanh mô hình, dạng thẻ DOM** | ✔ **ÁP** — Hình D, 0 draw call |
| `Machine List (2).webp` | Thẻ có **ảnh máy thật**, dải màu trạng thái trên đầu thẻ | **Trạng thái đọc được trước khi đọc chữ** | ✔ **ÁP** phần dải màu. ✘ **BỎ ảnh máy**: 240 ảnh = 240 request + ta **chưa có** ảnh thật cho máy AVI/AOI. Khai có ảnh mà dùng ảnh mẫu là **lời khai sai** |
| `Machine List` (line view) | Zone selector + timeline trên, **rail máy trái**, gauge/trạm, indicators đáy | **Cấp Line có bố cục riêng: dải trạm nằm ngang theo thứ tự công đoạn** | ✔ **ÁP** — Hình C. ✘ **BỎ gauge nửa vòng**: 12 trạm/line, gauge tốn chỗ; dùng **cột nhịp** so sánh được bằng mắt |
| `Factory 3D Twin (3).jpg` | Mini-map góc trái, camera giám sát góc phải, bảng Run/Stop | **Ở cấp khuôn viên cần định vị bối cảnh** | ◐ **ÁP MỘT PHẦN**: mini-map ✔ (đã có `C3-minimap`). ✘ **BỎ camera giám sát**: hệ **không có** luồng camera — vẽ ô camera trống là hứa suông |
| `Factory 3D Twin(1).jpg` (AVEVA) | ~14 panel số vây kín 3D | ✘ **PHẢN VÍ DỤ** — 3D còn ~35% và không panel nào đọc kỹ được. Đây đúng thứ `/twin` đang mắc | ✘ **KHÔNG ÁP** — ghi lại làm mốc *đừng đi hướng này* |
| `Factory 3D Twin.jpg` (FanRuan) | 3D **tràn viền**, panel trong suốt nổi đè, nút chế độ **nhúng trong cảnh** | ★ **Panel NỔI ĐÈ, cảnh chạy suốt dưới** ⇒ thêm thông tin **không** làm cảnh teo | ✔✔ **ÁP — nguyên tắc trung tâm của bản thiết kế này** (14.1.1) |
| `Factory 3D Twin (2).jpg` | KPI vòng cung, nền xanh đêm phát sáng | ✘ **KHÔNG ÁP** phong cách sci-fi phát sáng | ✘ Xem 14.7.1 |

#### 14.7.1 ★ CHỖ TÔI CỐ Ý LÀM KHÁC MẪU NHẤT — bảng màu

9/11 mẫu dùng **nền xanh đêm + đường viền phát sáng + chữ neon**. Đề nghị **không theo**, ba lý do:

1. **Xung đột chuẩn an toàn.** ISA-101 / ASM Guideline 6.1 (đã dẫn §17): nền **xám trung tính**, màu
   **chỉ dành cho bất thường**, ≤ 7 mã màu. Trên nền neon xanh, **một máy đỏ không nổi bật** vì mọi
   thứ đã phát sáng. Mẫu đẹp trong ảnh chụp; trên màn treo suốt ca 8 tiếng nó **giấu mất cảnh báo**.
2. **Hệ đã có design system.** §10.4 buộc hoà nhập token sẵn có; `mauTrangThai.ts` là **một nguồn sự
   thật** cho màu trạng thái (§10.2, ≤7 mã). Bảng màu sci-fi riêng cho Twin = **nguồn thứ hai**, và
   hai nguồn màu sẽ lệch.
3. Nền tối phát sáng + accent neon là **mặc định** của thể loại — nó xuất hiện bất kể chủ đề. Chọn nó
   là **không chọn gì**.

⇒ **Đề xuất:** giữ nền xám trung tính của design system (sáng/tối theo chủ đề người dùng), 3D dùng
vật liệu **không phát sáng**, và **dành toàn bộ độ bão hoà cho bất thường**. Cảm giác "cao cấp" đến
từ **bố cục và khoảng trống** (3D tràn viền, panel nổi nhẹ) — không từ ánh neon.

---

### 14.8 NGUỒN NGOÀI — trích dẫn, và cái gì ÁP / cái gì BỎ

> Chủ sở hữu yêu cầu tham khảo nguồn ngoài. Dưới đây là nguồn **đã đọc**, kèm **trích nguyên văn**,
> và quan trọng hơn: **cái gì tôi bỏ, vì sao**. Ba chỗ **không tìm được nguồn đủ mạnh** cũng được
> khai thẳng — trích một nguồn không nói điều ta gán cho nó là lỗi nặng hơn không trích.

#### 14.8.1 ★★★ LẬP LUẬN MẠNH NHẤT **CHỐNG LẠI** THỨ TA ĐANG XÂY

Trung thực trước: nguồn có thẩm quyền nhất về HMI công nghiệp **phản đối trực diện** HMI 3D.

**Hollifield / PAS, *The High Performance HMI* (ISA lưu trữ)**
https://www.isa.org/getmedia/06130a38-f7af-4b35-8c9c-2c34f25c1977/The-High-Performance-HMI-Overview-v2-01.pdf

Danh sách "vấn đề của loại đồ hoạ này" nêu **đích danh**: *"Brightly colored **3-D vessels**"* ·
*"Highly detailed equipment depictions"* · *"**Spinning pumps/compressors, moving conveyors,
animated flames**"* · *"A lack of display hierarchy."*
Ngược lại, đồ hoạ hiệu năng cao có: *"**Low-contrast depictions in 2-D, not 3D**"* · *"**Gray
backgrounds to minimize glare**"* · *"**No animation except for specific alarm-related graphic
behavior**"*.

Và cáo buộc thực nghiệm — **câu ta phải trả lời**:
> *"The graphic dedicates **90% of the screen space to the depiction of 3-D equipment**… However,
> the information actually used by the operator… only makes up **10% of the available screen area**.
> …**You cannot easily tell from this graphic whether the operation is running well or poorly.**"*

Bằng chứng kèm theo: thử nghiệm EPRI (nhà máy điện) và ASM Consortium (nhà máy ethylene) cho thấy đồ
hoạ hiệu năng cao cải thiện đáng kể việc **phát hiện bất thường — kể cả TRƯỚC khi cảnh báo nổ**.

★★★ **Đây chính là lời buộc tội dành cho mẫu FanRuan/Fujitsu mà chủ sở hữu đưa** — và cũng là
lời buộc tội dành cho Hình A của tôi nếu tôi làm ẩu. **Ba cách hoá giải, và cả ba đã nằm trong
thiết kế này**, không phải thêm vào để chống chế:

| Cáo buộc | Hoá giải trong bản này | Ở mục nào |
|---|---|---|
| *"90% màn cho 3D, 10% cho thông tin"* | 3D ở đây **không phải trang trí** — nó là **bản đồ định vị 240 máy**. Nhưng thông tin hành động **không nằm trong 3D**: nó ở panel nổi (B), panel bên (C), dải trạng thái (14.4). ★ Và nhóm **D** tồn tại chính để giữ thông tin **không** bị 3D nuốt | 14.5.3–14.5.5 |
| *"không biết nhà máy chạy tốt hay tệ"* | Chip KPI nổi (B-1) + dải "N việc cần biết" (14.4) trả lời câu ấy **trước khi** người dùng nhìn vào 3D | 14.3.1, 14.4 |
| *"3D + màu rực = giấu mất cảnh báo"* | **Bỏ bảng màu neon của mẫu**, giữ xám trung tính, dành độ bão hoà cho bất thường | 14.7.1 |

★ Và một chỗ **ca của ta mạnh hơn ca chung của Hollifield**: ông viết đồ hoạ nên *"generally
non-schematic **except when functionally essential**"*, và cho phép mô tả sơ đồ ở Level 3. Với nhà
máy 240 máy trên 4 tầng, **bố trí không gian LÀ functionally essential** — người vận hành phải biết
*máy nào, ở đâu* để đi tới. Đó là điều bảng danh sách không cho.
⇒ **Kết luận trung thực: 3D được biện minh cho ĐỊNH VỊ, không được biện minh cho ĐIỀU KHIỂN.**
Đây là cơ sở độc lập, từ nguồn ngoài, cho quyết định D-1 (không đặt lệnh OT lên cảnh).

**ASM Consortium, *Why Gray Backgrounds for DCS Operating Displays*** (2011)
https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/February%2028%202011%20-%20Why%20Gray%20Backgrounds%20for%20DCS%20Operating%20Displays.pdf
> *"The most safety-critical or urgent information should stand out the most in the display
> foreground whereas less important, static data… **such as vessels or display background, should
> blend more to the background**."*

Nền xám sáng còn cho *"a broader range of foreground color choices for manipulating salience"*, và
tránh trường hợp màu nền trùng phổ với màu tiền cảnh — *"increasing the likelihood of confusion or
mistakes for individuals with **color vision deficiencies**"*.
⇒ **ÁP:** thân máy bình thường **hoà vào nền**; chỉ bất thường mới nổi. Đây là lý do A-1 dùng **độ
sáng tương đối** chứ không dùng 5 màu rực cho 5 trạng thái.

#### 14.8.2 ISA-101 — cái nó thật sự đòi, và cái người ta gán nhầm cho nó

**ANSI/ISA-101.01-2015** (mục lục chính thức)
https://www.grahamnasby.com/files_publications/ANSI-ISA-101-01-2015_TOC-excerpt.pdf
Cấu trúc: Clause 5 *Human Factors* (5.2 User Sensory Limits, 5.3 User Cognitive Limits) · Clause 6
*Display Styles and Overall HMI Structure* (**6.2 Display Styles**, **6.3 Display Hierarchy**) ·
Clause 7 *User Interaction* · Clause 8 *Performance*.

> ⚠ **ĐÍNH CHÍNH MỘT HIỂU NHẦM PHỔ BIẾN — và brief của tôi suýt mắc.** ISA-101.01 **không** bắt buộc
> nền xám, cũng **không** tự định nghĩa taxonomy Level 1–4. Nó đòi tổ chức **phải CÓ** một triết lý
> HMI, một style guide, và **một phân cấp màn hình có tài liệu**. Nội dung 4 cấp và luật nền xám đến
> từ **Hollifield/PAS và ASM**. ⇒ Trích ISA-101 cho *"phải có phân cấp + style guide"*; trích
> PAS/ASM cho *nội dung* từng cấp và luật màu. Gán nhầm là dựng lập luận trên nguồn không nói thế.

**Bốn cấp màn hình (PAS/Hollifield), nguyên văn — và ánh xạ sang 4 cấp của ta:**

| Cấp ISA/PAS | Nguyên văn | Cấp của ta | Khớp? |
|---|---|---|---|
| **Level 1 — Operation Overview** | *"a single display showing the operator's entire span of control, the big picture… **Control interactions are not made from this screen.**"* | **Nhà máy** (Hình A) | ✔ Khớp tốt. ★ Câu *"không ra lệnh từ màn này"* là **chuẩn ngoài** ủng hộ D-1 |
| **Level 2 — Unit Control** | *"designed to contain all the information and controls required to perform most operator tasks associated with that section, from a single graphic"* | **Tầng / Line** (Hình B, C) | ✔ Khớp |
| **Level 3 — Unit Detail** | *"all of the detail about a single piece of equipment… used for a detailed diagnosis… A **schematic** type of depiction is **often desirable** for a Level 3 display."* | **Máy** (Hình D) | ✔ Khớp — và cho phép mô tả sơ đồ |
| **Level 4 — Support & Diagnostic** | *"the most detail of subsystems, individual sensors, or components"* | **KHÔNG có tương ứng 3D** | ✘ **Cố ý không ánh xạ** |

★★★ **Chỗ ánh xạ KHÔNG khớp, và tôi nói thẳng:** phân cấp của ta là **không gian**
(khuôn viên→tầng→line→máy), phân cấp ISA là **mức trừu tượng chức năng**. Chúng trùng nhau ở Level
1–3. **Level 4 không có vị trí camera nào tương ứng** — chi tiết cảm biến/linh kiện là **panel**,
không phải một cấp zoom. ⇒ Bản này **dừng ở 4 cấp không gian**, và Level 4 của ISA nằm ở
`[Mở chức năng]` → cockpit (F-28). Ép 1:1 sẽ đẻ ra một cấp zoom vô nghĩa.

#### 14.8.3 Mức trưởng thành — ★ ta đang xây DIGITAL SHADOW, không phải DIGITAL TWIN

**Kritzinger và cộng sự 2018**, *IFAC-PapersOnLine* **51(11):1016–1022**, DOI
**10.1016/j.ifacol.2018.08.474** (bình duyệt, ~2.300 trích dẫn) — phân loại theo **mức tích hợp dữ liệu**:

| Mức | Định nghĩa | Ta ở đâu |
|---|---|---|
| **Digital Model** | không trao đổi dữ liệu tự động chiều nào | — |
| **Digital Shadow** | **một chiều**: vật lý → số. Vật lý đổi thì bản số đổi, **ngược lại thì không** | ★★★ **`/twin` Ở ĐÂY** |
| **Digital Twin** | **hai chiều** tự động; bản số **tác động ngược** lên vật lý | chưa, và **có chủ ý** (D-1) |

★ Điều này **xác nhận bằng nguồn ngoài** cái mà mã đã tự khai: badge xuất xứ ở `TwinVanHanh.tsx:1967`
ghi chữ **"SHADOW"** — và **đó là lời khai ĐÚNG**. Bài báo còn ghi nhận tài liệu về DT hai chiều
thật sự *"is scarce"*: phần lớn thứ được gọi là "digital twin" **thực chất là digital shadow**.
⇒ **Đề nghị: giữ nguyên badge SHADOW, không đổi thành "Twin" cho kêu.** Gọi đúng tên là phòng thủ
tốt nhất trước câu hỏi *"twin này điều khiển được nhà máy chưa?"*.

**ISO 23247 — Digital twin framework for manufacturing**
https://cdn.standards.iteh.ai/samples/75066/ec0a1c59176e488887873acda6b7ecd9/ISO-23247-1-2021.pdf
Phân tích của **NIST** (Shao, Frechette & Srinivasan, MSEC 2023):
https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=935765
> DT = *"a **fit for purpose** digital representation of an observable manufacturing element **with
> synchronization** between the element and its digital representation."*

Bốn thực thể: **User Entity** (*"…as well as the **human-machine interfaces**"*) · **Digital Twin
Entity** · **Device Communication Entity** · **Cross-system Entity**.
⇒ **ÁP:** ISO 23247 đặt HMI/3D viewer vào **User Entity**, **tách hẳn** khỏi bản thân biểu diễn twin.
Đây là **cơ sở chuẩn hoá** cho ranh giới `/twin` (User Entity, chỉ đọc) ↔ `server/services/twin/`
(Digital Twin Entity) ↔ `/twin-studio` (soạn thảo). Cũng là lý lẽ độc lập cho 14.2.2 (không gộp
hai trang).
★ ISO 23247 tự khai *"does **not** prescribe specific data formats and communication protocols"*
⇒ **không** dùng nó để biện minh cho lựa chọn kỹ thuật cụ thể nào.

#### 14.8.4 Kỹ thuật — nhãn, LOD, vẽ theo yêu cầu

**Mapbox, *Optimize map label placement*** — nguồn tốt nhất cho **luật cắt nhãn** (14.5.2):
https://docs.mapbox.com/help/dive-deeper/optimize-map-label-placement/
> *"the set of labels in a tile is larger than what can be displayed without overlap, so **collision
> detection automatically chooses which labels to display** to preserve legibility."*
Mặc định `icon-allow-overlap` và `text-allow-overlap` = **`false`**. Ưu tiên va chạm đặt bằng
`symbol-sort-key`. Và một luật **ổn định** rất đáng chép khi xoay cảnh 3D: khi đổi zoom, renderer
*"will try to place the label in its **original position first**"* — chống nhãn nhảy.
⇒ **ÁP cả ba:** (1) cắt nhãn là **bình thường**, không phải lỗi — nên phải hiện "+N máy nữa";
(2) `symbol-sort-key` ≡ bảng xếp hạng 14.5.2; (3) **giữ vị trí cũ trước** khi xoay camera.

**three.js `BatchedMesh`** https://threejs.org/docs/#api/en/objects/BatchedMesh
> *"…a large number of objects with the same material but with **different geometries** or world
> transformations."*
⇒ đúng nguyên thuỷ cho sàn máy **không đồng dạng** dùng chung vật liệu — xác nhận lựa chọn §4.

**three.js *Rendering on Demand*** https://threejs.org/manual/en/rendering-on-demand.html
> *"Rendering continuously is a waste of the devices power…"* — kèm khuôn cờ `renderRequested`
chống vòng lặp phản hồi (controls `change` → render → `controls.update` → `change`…).
⇒ Xác nhận RB-3/G63: `frameloop="demand"` **phải** nối tay `invalidate` cho **mọi** nguồn thay đổi.

**MDN WebGL best practices** https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
> *"'Batching' draw calls into fewer, larger draw calls will generally improve performance."*
Cảnh báo đáng giá: `getError()`, `getParameter()`, `readPixels()` gây **đồng bộ hoá chặn**, *"as long
as 1ms"* mỗi lần. ⇒ **Đo draw call bằng `renderer.info` (bộ đếm CPU), KHÔNG bằng `getParameter`** —
nếu không, chính thiết bị đo làm hỏng thứ nó đo.

> ⚠ **KHÔNG tìm được nguồn có thẩm quyền cho một CON SỐ ngân sách draw call.** MDN và three.js đều
> nói *"giảm draw call"* mà **không nêu số**. Các số hay gặp (desktop ~500, mobile ~100) chỉ có ở
> blog. ⇒ Trần **150** của §4 phải trình bày là **mục tiêu dự án tự chọn, đo trên phần cứng của
> mình** — **không** được khai là "theo chuẩn". (Và ta có số đo thật: 240 máy = **3 draw calls**.)

**NVIDIA Omniverse** — kiến trúc, không phải bố cục:
https://github.com/NVIDIA-Omniverse/web-viewer-sample ·
https://docs.omniverse.nvidia.com/arch-diagrams/latest/ref-arch-diagrams/factory-dt-diagram.html
Khuôn công bố là **dựng hình phía máy chủ + WebRTC pixel streaming**, với phân chia sở hữu rõ:
**Kit app** sở hữu dựng hình/viewport + dữ liệu USD; **web client** sở hữu điều khiển UI, cây
scene, kết nối, định tuyến thông điệp (`{event_type, payload}`, đồng bộ chọn hai chiều).
⇒ **ÁP nguyên tắc phân chia sở hữu** — nó khớp thiết kế này: cảnh 3D sở hữu *dựng hình + chọn*;
DOM sở hữu *panel, danh sách, hành động*.
⇒ ✘ **KHÔNG áp pixel streaming**: đòi GPU máy chủ; RB-6 đã chốt WebGL client, và 240 máy = 3 draw
calls thì **không có vấn đề để pixel streaming giải quyết**.

> ⚠ **KHÔNG tìm được hướng dẫn UX công bố nào của NVIDIA/Unity về tỷ lệ viewport, chỗ đặt panel,
> hay chính sách LOD cho factory twin.** Các trang kiến trúc Omniverse chỉ nói về **tầng dữ liệu và
> phần cứng**. ⇒ **Không** trích chúng cho tỷ lệ bố cục — làm thế là gán cho nguồn điều nó không nói.
> Tỷ lệ 82% ở Hình A là **lựa chọn của bản thiết kế này**, biện minh bằng 14.1.1 + 11 mẫu, **không**
> phải bằng chuẩn nào.

#### 14.8.5 Điều hướng — breadcrumb và semantic zoom

**Nielsen Norman Group, *Breadcrumbs: 11 Design Guidelines*** https://www.nngroup.com/articles/breadcrumbs/
Luật quan trọng nhất cho ta: breadcrumb phải chỉ *"the current location in the site's hierarchical
structure, **not the session history**"*. Không thay thế nav toàn cục. Mục hiện tại **có mặt nhưng
KHÔNG phải link**. Không cần cho phân cấp chỉ 1–2 cấp — ta có **4**, thoả.
⇒ **ÁP:** breadcrumb `:1869` phải phản ánh **`pv=` hiện tại**, không phải đường người dùng đã đi.
★ Đây là **ca kiểm thử thật**: nhảy ngang Line 2 → Line 5 **không** được đẻ ra vệt lịch sử.

**Microsoft, *Semantic Zoom*** https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom
> *"…switch between **two different semantic views of the same content**…"* — view thu nhỏ hiện
**tiêu đề nhóm**, view phóng to hiện **từng mục**.
⇒ **ÁP — và đây là nền lý thuyết cho 4 cấp:** chuyển cấp **không phải dolly camera**, mà là **đổi
biểu diễn**: ở cấp Tầng, một Line là **một khối có nhãn + số tổng hợp**; ở cấp Line, nó **bung ra
thành 12 trạm**. Đây là lý do Hình B vẽ line là khối, còn Hình C vẽ từng trạm.

> ⚠ **HAI CHỖ KHÔNG CÓ NGUỒN ĐỦ MẠNH — khai thẳng:**
> 1. **URL làm nơi chứa trạng thái**: không có hướng dẫn W3C/MDN/NN-g nào. Chỉ có blog. Nguyên tắc
>    *"cái gì chia sẻ/đánh dấu được thì thuộc về URL"* là **thực hành được chấp nhận, KHÔNG phải
>    chuẩn** — và ta theo nó vì `duongDanTwin.ts` **đã** chứng minh nó chạy được ở đây, không phải vì
>    có ai ban hành.
> 2. **Mini-map trong viewer 3D công nghiệp**: không có nguồn UX có thẩm quyền. ⇒ Biện minh mini-map
>    bằng **semantic zoom + breadcrumb** ở trên, **không** vờ có chuẩn.

---

### 14.9 RỦI RO — cái gì có thể vỡ

| # | Rủi ro | Vì sao tin là thật | Chặn bằng |
|---|---|---|---|
| **R-1** | **Đổi bố cục làm đỏ bánh cóc e2e sẵn có** | `/twin` có e2e bám `data-testid` (`banner-doi-soat`, `panel-trai`, `dem-may`…). Gộp 5 banner thành 1 dải **đổi cây DOM** | 14.4 luật 4: **giữ nguyên mọi `data-testid`** trong dải hợp nhất. Chạy bộ e2e Twin **trước** khi đổi để có mốc, không đo sau |
| **R-2** | **Panel nổi đè che mất máy đang chọn** | Chuyển từ chia-đất sang nổi-đè: hai tấm 224+288 px giờ **đè lên cảnh**. Máy nằm dưới tấm ⇒ bấm không tới | Cảnh phải **tự lùi tâm nhìn** khi panel mở (offset camera theo bề rộng panel). ★ Phải test: chọn máy ở mép trái, mở panel trái, máy **vẫn thấy được** |
| **R-3** | **G41 lặp lại — lớp phủ hiện đủ mà đọc không được** | Nhãn drei ở **z-index 20**; `BangKpiNoi` phải `z-30`. Thêm 2 tấm nổi + dải hợp nhất + bộ chuyển cấp = **4 lớp mới** tranh z-index | Đặt **thang z-index có tên** trong một tệp, không rải số. Nghiệm thu **bằng mắt trên nền thật**, không bằng test DOM (test thấy phần tử tồn tại, mắt thấy nó bị che) |
| **R-4** | **Redirect `/command-center` → `/twin` TRƯỚC khi G-7 xong** | `/command-center` là mặt **đa site duy nhất** (`commandCenter.hierarchy`). Redirect trước khi `/twin` có cây đa site = **xoá một năng lực** và gọi đó là gộp | ★ **Redirect PHẢI đi SAU G-7**, không cùng đợt. Cổng: `/twin?pv=tapdoan` phải liệt kê **đủ số site** mà `/command-center` liệt kê — đối chiếu **hai phép đếm rời** |
| **R-5** | **Chuyển `floor`+`layout` sang `/twin-studio` làm mất lối vào cho vai chỉ có `analytics_oee`** | `/digital-twin` gate `analytics_oee` (`navigation.tsx:410`); `/twin-studio` đòi `settings_factory` ∨ `machine_control`. Vai chỉ có `analytics_oee` **đang vào được** tab floor, sau đổi thì **không** | ★ **Đo trước bằng vai không-admin**: có vai nào thật sự chỉ có `analytics_oee` mà đang dùng tab floor? Nếu có ⇒ đây là **cắt quyền**, phải chủ sở hữu quyết, không phải quyết định UI. Nếu không ⇒ đổi an toàn. **Đo, đừng đoán** |
| **R-6** | **Ngân sách §4 vỡ khi thêm A-4 + A-6** | A-4 thêm vòng viền/máy (hình học mới), A-6 thêm khối trong suốt (**vật liệu trong suốt phá batching**, cần sắp xếp độ sâu) | Vòng viền A-4 **gộp vào `BatchedMesh`** sẵn có hoặc làm bằng **màu đỉnh**, không phải mesh rời. A-6 **chỉ dựng khi bật lớp** (`?lop=`), mặc định tắt. Đo lại draw call **sau** khi thêm, ngưỡng ≤150 |
| **R-7** | **"Nhãn bất thường luôn thắng" biến thành 240 nhãn khi nhà máy đỏ** | Luật 14.5.2 cho bất thường thắng vô điều kiện. Một sự cố mất điện ⇒ 240 máy "mất tín hiệu" ⇒ 240 nhãn ⇒ **đúng lúc cần đọc nhất thì không đọc được** | **Trần cứng 30 áp cho CẢ bất thường.** Vượt ⇒ **gom**: "38 máy mất tín hiệu ở Line 3" thành **một** nhãn cấp line + chip "+N". ★ Phải test **ca 100% đỏ**, không chỉ ca 2 máy đỏ |
| **R-8** | **Không ai thấy được A-2 hoạt động** | `andon_events` **7 hàng, 0 hàng `raised`** ⇒ nhánh badge cảnh báo **chưa ai đi qua** (G26) | Nghiệm thu **bắt buộc ca dương dựng tay** — xem 14.10 mục 6 |
| **R-9** | **Gộp xong nhưng 6.974 dòng màn cũ vẫn nằm trên đĩa** | §11b: `DigitalTwinCenter` **không được xoá** (giữ `usdExport`), `MachineCockpit` có consumer ngoài Twin (`MachineWorkspace`), `RobotCockpit` là đích di trú §11.4 | **Không xoá tệp trong đợt xây.** Gỡ *tuyến* và *tab*, giữ *tệp*. Xoá tệp là đợt riêng, sau khi §11 sổ kiểm đóng và có người ký |
| **R-10** | **Thiết kế này dựa trên hiện trạng đo hôm nay; đợt xây bắt đầu muộn hơn** | 14.0 cho thấy brief Đợt 20 **đã lệch** so với mã chỉ sau ~1 ngày | Đợt xây **phải đo lại 14.6** (38 chức năng) trước khi lập kế hoạch. Bảng ấy là **ảnh chụp**, không phải hằng số. ★ *Lý do hoãn có hạn sử dụng* — bài học Khối D |

---

### 14.10 ĐIỀU KIỆN NGHIỆM THU CHO ĐỢT XÂY

Mọi mục dưới đây **đo được**, không có mục nào là "trông ổn hơn".

**A. Bố cục — đo bằng số, trên viewport chuẩn**

1. **Canvas 3D ≥ 75% viewport** ở trạng thái mặc định trên **1280×720**, cả hai panel MỞ.
   Đo: `getBoundingClientRect()` của canvas ÷ (1280×720). Hiện trạng **17%** (`:2417-2436`).
   ★ Đo **cùng viewport** với phép đo cũ, nếu không là G9 (đổi đơn vị rồi khoe tiến bộ).
2. **Tổng chiều cao dải ngang cố định ≤ 120 px** ở ca xấu nhất (mọi banner có điều kiện bật).
   Hiện trạng **280 px**. ★ Ca xấu nhất phải **dựng được**, không chờ nó tự xảy ra.
3. **`?thu=trai,phai` cho canvas ≥ 90%** viewport, và **chip cảnh báo + badge LIVE vẫn hiện**.

**B. Hợp nhất — không URL nào chết**

4. **14 URL cũ ở 14.2.3 đều tới đích đúng**, mỗi cái **≤1 chặng** redirect.
   Đo: e2e đi từng URL, khẳng định URL cuối + một `data-testid` đặc trưng của đích.
   ★ Đếm **số chặng** bằng `response.request().redirectedFrom()`, không đếm bằng mắt.
5. **`/twin` một mình trả lời được mọi câu mà 7 tab trả lời**, trừ nhóm D đã khai bỏ.
   Đo: đối chiếu bảng 14.6 — mỗi dòng "CÓ"/"MỘT PHẦN" phải có **chỗ gọi `file:line`** (G16:
   hàm không ai gọi = chưa xong).

**C. Trung thực dữ liệu — chỗ dễ tự lừa nhất**

6. ★★★ **Ba ca dương dựng tay** (G22/G26 — không dựng thì "không có gì hiện" trông y hệt nhau dù
   mã đúng hay hỏng):
   - chèn 1 `andon_events` trạng thái **`raised`** ⇒ badge A-2 **nổi lên** trên cảnh; xoá ⇒ tắt.
   - đặt 1 robot **`estop`** ⇒ dải an toàn + badge A-3 hiện; khôi phục ⇒ tắt.
   - đặt 1 máy sức khoẻ **dưới ngưỡng** ⇒ vòng viền A-4 hiện; khôi phục ⇒ tắt.
7. **Nguồn rỗng hiện `—` kèm lý do và TUỔI, không hiện `0`.** Ca bắt buộc: **OEE** (897 hàng,
   **0 trong 24h**) phải hiện *"— (đo trên 0/240 máy trong 24h)"*. ★ Thấy `0%` là **trượt**.
8. **Trạng thái tua lại có đủ BA chỉ báo** đồng thời (viền + header + nút), và **mọi tấm nổi đổi
   nhãn "lúc HH:MM"**. Đo: chụp ảnh ở `?tg=` và đọc bằng mắt.

**D. Ngân sách §4 — đo lại SAU khi thêm**

9. **Draw calls ≤ 150** đọc từ `renderer.info.render.calls` (★ **không** dùng `getParameter` —
   MDN: gây chặn đồng bộ tới 1 ms). Mốc hiện tại: 240 máy = **3**.
10. **FPS ≥ 30** khi xoay, đo qua `requestAnimationFrame`. **Nhãn đồng thời ≤ 30**, kể cả
    **ca 100% máy bất thường** (R-7).
11. **GPU ≈ 0% khi đứng yên** — `frameloop="demand"` còn nguyên sau khi thêm hoạt ảnh nào
    (G63: mọi hoạt ảnh phải có người lập lịch `invalidate`).

**E. Quyền — đo bằng vai KHÔNG-admin**

12. ★★★ **Mọi dòng "Ai thấy" ở 14.6 nghiệm thu bằng tài khoản không-admin.** Admin **bypass**
    `requirePermission` ⇒ đo bằng admin **chứng minh số 0**. Tối thiểu 2 vai:
    một chỉ `analytics_oee`, một có `machine_control` mà không có `settings_factory`.
13. **Thiếu quyền ⇒ ẨN, không hiện-rồi-disable** (`nganXuLyLogic.ts:102-111`). Ca đã biết lệch:
    `RobotCockpit.tsx:916-918` (P-3).
14. **R-5 phải có câu trả lời ĐO ĐƯỢC** trước khi chuyển `floor`/`layout` sang `/twin-studio`.

**F. Cổng chung**

15. `npm run check` **0 lỗi**, build **0 lỗi**, bộ test Twin **xanh**, và **e2e Twin xanh cả trước
    lẫn sau** (R-1).
16. **G65**: nếu chạy Playwright, ghi ảnh ra thư mục riêng và kiểm `git status -- test-results/`
    sau lượt cuối — 5 ảnh lô C **phải còn nguyên**.

---

### 14.11 ĐỀ XUẤT THỨ TỰ CHO ĐỢT 21 — cái nào chặn cái nào

```
  ĐỢT 21a — NỀN (không thêm tính năng, chỉ đổi hình dạng)
    1. Dải trạng thái hợp nhất (14.4)      ── chặn ──┐
    2. Panel nổi đè thay chia đất (14.1.1) ── chặn ──┤
    3. Bộ chuyển cấp + nút ⛶ (F-08/F-19)             │
       └─> cổng: canvas ≥75%, dải ≤120px             │
                                                     ▼
  ĐỢT 21b — THÔNG TIN MỚI (cần bố cục mới để có chỗ đặt)
    4. A-4 sức khoẻ máy (G-1)   ← nguồn giàu nhất, tươi HÔM NAY
    5. Luật ưu tiên nhãn (14.5.2) ← chặn bởi 4 (không có A-4 thì chưa cần xếp hạng)
    6. G-5 phân biệt rỗng-vì-RBAC
       └─> cổng: 3 ca dương dựng tay, ngân sách §4 đo lại

  ĐỢT 21c — HỢP NHẤT TUYẾN (đi SAU cùng)
    7. G-7 cây đa site  ── chặn ──> 8. redirect /command-center (R-4)
    9. chuyển floor+layout sang /twin-studio ← chặn bởi câu trả lời R-5
   10. /digital-twin → /twin, rút redirect 2 chặng thành 1

  NGOÀI ĐỢT — cần chủ sở hữu quyết, KHÔNG tự làm:
    · L-1 vá tenant cho W1/W2 (lỗ GHI, chặn mọi đường ghi mới)
    · P-1 factoryCode cho product_inspections (chặn nghiệp vụ chất lượng)
    · /layout/:id — nối vào /twin-studio hay bỏ?
    · xoá 6.974 dòng màn cũ (R-9) — đợt riêng, sau khi §11 đóng
```

---

### 14.12 BA CÂU CẦN CHỦ SỞ HỮU TRẢ LỜI TRƯỚC KHI XÂY

1. **"Một trang duy nhất" — chấp nhận HAI trang (`/twin` + `/twin-studio`) không?**
   Tôi đề nghị **hai** (14.2.2): gộp một trang buộc gộp **cổng quyền**, và mọi cách gộp cổng đều
   hoặc cho người xem sửa được nhà xưởng, hoặc cắt lối vào của 2/4 vai non-admin. Nếu chủ sở hữu
   vẫn muốn **đúng một**, đó là **quyết định RBAC** cần ký, không phải quyết định UI.

2. **Bỏ phong cách sci-fi của 9/11 mẫu — đồng ý không?**
   Tôi đề nghị **bỏ** (14.7.1), có nguồn ngoài đứng sau: trên nền neon **cảnh báo không nổi bật**,
   và hệ đã có một nguồn sự thật về màu (`mauTrangThai.ts`, ≤7 mã). Nếu chủ sở hữu muốn giữ vẻ
   ngoài của mẫu, tôi cần biết **trước khi xây**, vì nó đổi cả bảng token chứ không phải một lớp sơn.

3. **R-5: có vai nào chỉ có `analytics_oee` đang dùng tab `floor` không?**
   Đây là câu **đo được** nhưng cần dữ liệu vai thật. Nếu **có**, việc chuyển `floor` sang
   `/twin-studio` là **cắt quyền** và phải có người ký; nếu **không**, chuyển an toàn.

> ★ Và một lời khai về chính bản thiết kế này: nó dựa trên hiện trạng đo **2026-09-08**. Mục 14.0
> cho thấy brief Đợt 20 đã lệch so với mã chỉ sau khoảng một ngày. **Bảng 14.6 là ảnh chụp, không
> phải hằng số** — đợt xây phải đo lại trước khi lập kế hoạch (R-10).

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

**Bổ sung Đợt 20 (§13b.8) — đã đọc và trích nguyên văn 2026-09-08**
- Hollifield/PAS, *The High Performance HMI* (ISA lưu trữ) — https://www.isa.org/getmedia/06130a38-f7af-4b35-8c9c-2c34f25c1977/The-High-Performance-HMI-Overview-v2-01.pdf — ★ lập luận **chống** HMI 3D ("Brightly colored 3-D vessels"; "90% màn cho 3D, 10% cho thông tin"); nguồn của 4 cấp Level 1–4; Level 1 *"Control interactions are not made from this screen"*
- ASM Consortium, *Why Gray Backgrounds for DCS Operating Displays* (2011) — https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/February%2028%202011%20-%20Why%20Gray%20Backgrounds%20for%20DCS%20Operating%20Displays.pdf — nền xám: dải màu tiền cảnh rộng hơn + an toàn cho người khiếm sắc
- ANSI/ISA-101.01-2015, mục lục chính thức — https://www.grahamnasby.com/files_publications/ANSI-ISA-101-01-2015_TOC-excerpt.pdf — Clause 6.2 Display Styles, 6.3 Display Hierarchy. ⚠ **KHÔNG** tự bắt nền xám, **KHÔNG** tự định nghĩa Level 1–4 (hiểu nhầm phổ biến)
- Kritzinger et al. 2018, DOI 10.1016/j.ifacol.2018.08.474 — Model / **Shadow** / Twin theo mức tích hợp dữ liệu. ★ `/twin` là **digital shadow**, badge "SHADOW" ở `TwinVanHanh.tsx:1967` là lời khai ĐÚNG
- ISO 23247-1:2021 (bản xem trước) — https://cdn.standards.iteh.ai/samples/75066/ec0a1c59176e488887873acda6b7ecd9/ISO-23247-1-2021.pdf · phân tích NIST (Shao/Frechette/Srinivasan, MSEC 2023) — https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=935765 — HMI/3D viewer thuộc **User Entity**, tách khỏi Digital Twin Entity
- Mapbox, *Optimize map label placement* — https://docs.mapbox.com/help/dive-deeper/optimize-map-label-placement/ — collision detection, `symbol-sort-key`, giữ vị trí cũ trước khi đổi zoom (nền cho luật cắt nhãn §13b.5.2)
- three.js *Rendering on Demand* — https://threejs.org/manual/en/rendering-on-demand.html — khuôn cờ `renderRequested` chống vòng lặp phản hồi (RB-3/G63)
- MDN WebGL best practices — https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices — ⚠ `getError`/`getParameter`/`readPixels` chặn đồng bộ tới 1 ms ⇒ đo draw call bằng `renderer.info`
- NVIDIA Omniverse web-viewer-sample — https://github.com/NVIDIA-Omniverse/web-viewer-sample — phân chia sở hữu: cảnh 3D sở hữu dựng hình + chọn; web client sở hữu panel/cây/điều khiển
- NN/g, *Breadcrumbs: 11 Design Guidelines* — https://www.nngroup.com/articles/breadcrumbs/ — breadcrumb theo **vị trí trong phân cấp**, KHÔNG theo lịch sử phiên
- Microsoft, *Semantic Zoom* — https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom — đổi cấp = **đổi biểu diễn**, không phải dolly camera
- ⚠ **KHÔNG có nguồn có thẩm quyền** cho: (a) một CON SỐ ngân sách draw call — trần 150 của §4 là mục tiêu dự án tự chọn, không phải chuẩn; (b) hướng dẫn UX của NVIDIA/Unity về tỷ lệ viewport hay chỗ đặt panel; (c) "URL làm nơi chứa trạng thái" và (d) mini-map trong viewer 3D công nghiệp — cả hai là thực hành được chấp nhận, không phải chuẩn
