# Nhóm C — Xử lý các phát hiện của lượt khảo sát

**Ngày đo:** 2026-08-13 · **Nhánh:** `feat/hmi-dep` · **HEAD vào:** `8c6621d1`
**Đầu vào:** `docs/superpowers/reports/2026-08-12-nhom-c-khao-sat.md`
**Loại lượt:** sửa **đường build** + sửa **tài liệu** + **ĐO** từng cờ. 0 DDL · 0 migration · 0 seed · 0 đổi dữ liệu/quyền/tài khoản.

---

## 0. Kết luận một dòng

> **Việc 1 nặng hơn khảo sát mô tả — và Việc 2 thì khảo sát mô tả SAI hai phần ba.**
> Font PDF không phải "quả mìn hẹn giờ": **`Dockerfile` trong repo ĐANG định nghĩa một ảnh mà xuất PDF tiếng Việt chết hẳn**. Ngược lại, hai "lời khai sai" mà brief giao tôi sửa (`uq_machines_code_active` không tồn tại · `machineCode`/`approvalStatus` là cột bịa) **đều là âm tính giả của chính lượt khảo sát** — tài liệu bị tố thì đúng.
> Việc 3: đo 10 cờ. **Bật 0 cờ** — và đó là kết quả của phép đo, không phải của sự rụt rè: bảy cờ đổi hành vi đường ghi/hợp đồng đang chạy, một cờ ghi dữ liệu sản xuất không có đường lùi sạch, và **nghiệm thu sống bất khả thi lượt này** vì máy chủ cổng 3000 **không tồn tại** và đường ingest đòi một khoá máy mà tôi bị cấm tạo.

---

## 1. LỆCH TRẠNG THÁI SO VỚI BRIEF — 4 điểm, tự đo

Brief cảnh báo đã lệch 14 lần / 4 pha. Lượt này **thêm bốn**:

| # | Brief / khảo sát nói | Đo được | Chứng cứ |
|:--:|---|---|---|
| **1** | *"`uq_machines_code_active` **không tồn tại** trong DB"* | **TỒN TẠI** | `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='machines'` → **12 index**, có `CREATE UNIQUE INDEX uq_machines_code_active ON public.machines USING btree (code) WHERE ("isActive" = true)`. Nguồn `drizzle/0181_machine_lifecycle_softdelete.sql:77`. `pg_class.oid`=**23602** (cũ hơn `uq_machines_urn_active` oid 61551 của mig 0251) ⇒ có từ lâu. Khảo sát khai chỉ 2 index ⇒ đọc thiếu 10. |
| **2** | *"DB thật là `code`/`registrationStatus` ⇒ **mọi truy vấn chép từ tài liệu lỗi cột**"* | **SAI phần khái quát** | `information_schema.columns`: `machineCode` là cột **thật trên 16 bảng** (`oee_metrics`, `downtime_events`, `predictive_alerts`, `maintenance_schedules`, `maintenance_work_orders`, `sync_logs`, `ai_insights`, `inspection_packages`, `machine_health_history`, `mqtt_message_history`, `pm_effectiveness_metrics`, `root_cause_analysis`, `w3_backup_*`, +2 chunk hypertable) **và** là tên trường hợp đồng API (`server/contracts/machineDataContract.ts:27`, `server/api/v1/openapi.ts:99`). `approvalStatus` là cột **thật** trên `mqtt_clients` + `suppliers` — đúng cột doc 51 §5.3 đọc. **Đúng phần**: riêng bảng `machines` là `code`/`registrationStatus`. |
| **3** | *"Máy chủ chạy cổng 3000"* (brief) · *"máy chủ sống PID 15052"* (khảo sát) | **KHÔNG CÓ máy chủ nào** | `Get-NetTCPConnection -LocalPort 3000` → *No matching objects* · `netstat -ano \| :3000` → **0 dòng** · `curl http://127.0.0.1:3000/` → **exit 7 (connection refused)**. 24 tiến trình `node.exe` đang chạy, `Win32_Process.CommandLine` cho thấy **không cái nào** là máy chủ ứng dụng (toàn MCP server + Playwright test-server). PID 15052 đã chết trước lượt này. |
| **4** | Tên cờ doc 16: *"`SAFETY_ZONE` · `SIM_PHYSICS` · `FIELD_V2` · `ERP_INBOUND`"* | **Không phải tên biến môi trường** | Tên thật: `SAFETY_ZONE_SW_ENABLED` · `SIM_PHYSICS_ENABLED` · `FIELD_V2_ENABLED` · `ERP_INBOUND_ENABLED`. Khảo sát `grep` bốn chuỗi **rút gọn** và được trả về 0 dòng ⇒ **kết luận đúng vì may**, không vì phép đo. Đo lại bằng tên thật: vẫn 0 dòng ⇒ kết luận giữ nguyên. |

> Điểm ③ có hệ quả cứng: **mọi mục "BẬT ⇒ kèm nghiệm thu sống" của Việc 3 không thực hiện được lượt này.**
> Tôi **KHÔNG** tự redeploy: máy chủ đã tắt sẵn khi tôi tới, và `startBackgroundJobs` khởi động các cron **GHI dữ liệu** (cpk snapshot, AI threshold tune, kb sync…). Tự dựng một tiến trình ghi dữ liệu lên môi trường của chủ dự án mà không được hỏi thì tệ hơn là để nó tắt. Cần một câu của chủ dự án.

---

## 2. VIỆC 1 — build không chép font vào `dist`

### 2.1 Đo TRƯỚC khi sửa

| Câu hỏi brief đặt | Phép đo | Kết quả |
|---|---|---|
| Font nằm ở đâu? | `ls server/assets/fonts/` | `BeVietnamPro-Regular.ttf` (132.948 B) · `-Bold.ttf` (140.300 B) · `NotoSansSC-Regular/Bold.ttf` (~10,5 MB mỗi cái) · 2 OFL.txt · README. **Cả 7 file đều git-tracked** (`git ls-files`). |
| Ai đọc nó? | `grep -rl fontAssets` | `server/services/universalExportService.ts` (jsPDF) · `server/services/pdfTemplateService.ts` (PDFKit). |
| Nhánh dự phòng ở dòng nào? | đọc `server/services/fontAssets.ts:75-83` | 5 ứng viên. Chạy thử từng cái với `HERE=dist`: **chỉ MỘT trúng** — `join(process.cwd(),"server","assets","fonts")` (**dòng 80**). |
| `dist` thiếu gì? | `find dist -iname "*BeVietnam*"` | **0 file.** (20 hit `.ttf` dưới `dist/` là font KaTeX của client — thước dễ nói dối đúng chỗ này.) |
| Có cửa thoát nào đang đặt? | `grep -c FONT_ASSETS_DIR .env` | **0**, `grep` exit **1**. |

### 2.2 Phát hiện NẶNG HƠN khảo sát — không phải giả định

Khảo sát viết *"một triển khai chỉ-ship-`dist` sẽ…"* ở **thì tương lai**. Đo `Dockerfile`:

```dockerfile
43  COPY --from=build /app/dist ./dist
44  COPY --from=build /app/drizzle ./drizzle
45  COPY --from=build /app/scripts ./scripts
46  COPY --from=build /app/knowledge ./knowledge
...
56  CMD ["node", "dist/index.js"]      # WORKDIR /app
```

**`server/` KHÔNG được chép.** ⇒ trong ảnh Docker, `/app/server/assets/fonts` không tồn tại, cả 5 ứng viên trượt, `fontAssets.resolveFontDir()` — **cố ý FAIL LOUD** (`:101-109`) — ném lỗi ⇒ **mọi báo cáo PDF tiếng Việt chết**. Đường triển khai ấy **đã nằm trong repo**, không phải giả định.
`scripts/build-secure.mjs` cùng bệnh: chỉ chép `client`/`public` vào `dist-secure/`, và hướng dẫn deploy của chính nó (`:265`) là *"Copy dist-secure/ to server"*.

### 2.3 Bản vá — **cộng thêm, không gỡ nhánh dự phòng**

| File | Đổi gì |
|---|---|
| `scripts/copy-font-assets.mjs` **(mới)** | `server/assets/fonts` → `dist/assets/fonts`. Font VN **BẮT BUỘC** (thiếu ⇒ build ĐỎ, không đẻ ra artifact có engine PDF chết); Noto CJK + OFL **TUỲ CHỌN** (fetch-on-demand, ~10 MB/weight, `fontAssets` trả `null` khi vắng). |
| `package.json:10` | `"build"` nối `&& node scripts/copy-font-assets.mjs`. |
| `scripts/build-secure.mjs:173` | `clientDirs = ['client','public']` → `+ 'assets'`. |
| `server/services/fontAssets.ts:75-89` | **THÊM** ứng viên `resolve(HERE, "assets", "fonts")`. `HERE` = `dist/` vì bundle esbuild giữ nguyên `import.meta.url` — đã đọc thẳng trong `dist/index.js`: `HERE = dirname(fileURLToPath(import.meta.url))`. **Nhánh `process.cwd()` GIỮ NGUYÊN.** |
| `Dockerfile` | **không đổi** — nó vốn chép `dist` trọn gói, nên font vào theo. Đó là chỗ đẹp của cách vá này. |

Đích là `dist/assets`, **không** phải `dist/public/assets`: `serveStatic()` phục vụ `dist/public` (`server/_core/vite.ts:47-58`) ⇒ font đọc được bởi tiến trình mà **không** thành tài sản web.

### 2.4 Lưới — `server/services/fontAssetsDist.test.ts`, **5 ca**

| Ca | Nó chứng minh gì |
|---|---|
| `dist_self_sufficient` | esbuild bundle **THẬT** `fontAssets.ts` (đúng cờ của `"build"`) vào một `dist/` tạm, chạy bằng **cwd không có cây nguồn** và **xoá `FONT_ASSETS_DIR` khỏi env con** ⇒ nhánh `process.cwd()` **CHẾT**. So **byte length khớp đúng file nguồn**, không chỉ "nạp được gì đó". |
| `negative_control` | Cùng probe, **không** chép ⇒ **PHẢI đỏ**. Không có ca này thì một ca xanh không chứng minh được nó xanh **NHỜ** bước chép. |
| `build_wiring` | `"build"` có chứa `scripts/copy-font-assets.mjs`. |
| `build_secure_wiring` | `clientDirs` của `build-secure.mjs` có `'assets'`. |
| `copy_script_refuses_to_produce_a_fontless_dist` | `--src <thư mục rỗng>` ⇒ exit ≠ 0 + `required font(s) missing`. |

### 2.5 Đột biến (sau commit, **có cầu chì**)

Cầu chì bắt buộc trước mỗi lượt: file phải **sạch git trước khi đột biến** · dòng bị chạm **không được là bình luận** (kiểm `^\s*(//|\*|/\*)`) · đột biến phải **đổi ≥1 byte** · in `git diff --stat` để chứng minh đã chạm mã sống · khôi phục xong phải `git status` **rỗng**.

| Đột biến | Ca ĐỎ |
|---|---|
| **A** — gỡ ` && node scripts/copy-font-assets.mjs` khỏi `package.json` `"build"` | **`build_wiring: \`npm run build\` invokes the font copy step`** — `AssertionError: expected 'vite build && esbuild server/_core/in…' to contain 'scripts/copy-font-assets.mjs'`. `Tests 1 failed \| 4 passed (5)`, exit 1. |
| **B** — vô hiệu `copyFileSync(src, join(destDir, name));` (dòng mã sống, cầu chì xác nhận không phải bình luận) | **`dist_self_sufficient: after the build's copy step the probe loads the VN font with no source tree in cwd`** — `[copy-font-assets] FAILED: ENOENT … \dist\assets\fonts\BeVietnamPro-Regular.ttf`. `Tests 1 failed \| 4 passed (5)`, exit 1. |
| **Đối chứng dương** (đã khôi phục) | `git status` rỗng · `Test Files 1 passed (1)` · `Tests 5 passed (5)` · exit 0. |

### 2.6 Nghiệm thu trên artifact THẬT

Xoá `dist/assets` rồi chạy **`npm run build` đầy đủ** (không phải chạy riêng script):

```
[copy-font-assets] 6 file(s) → d:\SOURCES\avi-aoi-management\dist\assets\fonts (21390337 bytes)
BUILD_EXIT=0
```

Đọc lại **chính `dist/index.js` vừa ship**:
```js
c.push(resolve3(HERE, "..", "assets", "fonts"));
c.push(resolve3(HERE, "assets", "fonts"));          // ← ứng viên MỚI, có trong bundle
c.push(resolve3(HERE, "..", "..", "server", "assets", "fonts"));
c.push(join3(process.cwd(), "server", "assets", "fonts"));   // ← dự phòng CÒN NGUYÊN
```
Chạy thử 5 ứng viên với `HERE = <repo>/dist`: **`HIT` ở ứng viên MỚI** (`dist/assets/fonts`) — và ứng viên dự phòng vẫn `HIT`, đúng ý đồ fail-safe.

**Commit: `bc1b85af`**

---

## 3. VIỆC 2 — ba lời khai trong `docs/ECOSYSTEM/51_*.md`

### 3.1 Kết quả: **2/3 lời khai của brief là SAI** (xem §1 ①②)

Doc 51 §3 mục 5 khoe `uq_machines_code_active` là "điểm mạnh đã có" — **đúng, không sửa gì**.
Doc 51 dùng `machineCode`/`approvalStatus` — **đúng ngữ cảnh**, chỉ cần một ghi chú thuật ngữ cho riêng bảng `machines`.
**Cái thật sự phải sửa là lời khai của LƯỢT KHẢO SÁT.** Tôi ghi đính chính **thẳng vào** `2026-08-12-nhom-c-khao-sat.md` — một báo cáo khảo sát mới tinh cũng là "tài liệu trong repo", và tài liệu trong repo **không nằm yên, nó ĐƯỢC TIN**. (Đây là lần thứ **bảy** trong dự án; sáu lần trước: `vitest.setup.ts` · `trpc.ts:702-704` · `0316` "CHƯA ÁP" · `auth.ts:290` "covers ban" · `.env` "no timescaledb" · và nay chính nó.)

### 3.2 Lời khai thứ ba thì ĐÚNG — và đây là bệnh chung của cả 5 tài liệu

| Doc | Bệnh đo được | Đã sửa |
|---|---|---|
| **42** | **Nặng nhất.** Đầu tài liệu **không có trạng thái nào**; §3 tiêu đề *"Phát hiện P0 (chặn sản xuất)"*; trạng thái thực thi chôn ở **§9 dòng ~304/505**. Ai đọc §1+§3 rồi dừng sẽ kết luận module đang hỏng. | Khối đỏ lên đầu + **đo lại cả hai P0**: `PermissionGate.tsx:71` `mergeSlotProps` (dùng ở `:116`, `:124`); `masterDataRouter.ts` **51× `.nullish()`**. |
| **51** | Đầu còn *"Chưa commit — chờ review"* trong khi **§12 ghi commit `cfb6fa9f`**; còn *"Đang thực thi P0"*; **§7 tiêu đề "(CHỜ DUYỆT)"** cạnh §8 *"USER ĐÃ DUYỆT 8/8"*; **§0 bốn "claim tự kiểm chứng"** viết ở **thì hiện tại** nhưng cả bốn **đã vá**. | Sửa cả bốn chỗ + bảng đo lại 4/4 P0 + 3 đính chính + bảng "còn thật". |
| **32** | §4 *"— chờ duyệt"* ↔ §5 *"ĐÃ CHỐT 2026-07-05"* + §8 *"TỔNG KẾT THỰC THI"*. | Sửa tiêu đề §4 + đánh dấu việc-chờ-người **#3 (ship font) XONG** bởi `bc1b85af`. |
| **16** | §15 *"(phần chờ bạn DUYỆT…)"* ↔ khối ⓘ đầu tài liệu *"đã được thực thi"*. | Sửa tiêu đề §15 + gắn phép đo bảng-thật/cờ-thật. |
| **55** | §6 *"Quyết định cần bạn duyệt (trước khi thực thi)"* ↔ §0-ter *"Chốt quyết định (user duyệt)"* 14/14. | Sửa tiêu đề §6, trỏ về khối chốt. |

### 3.3 Đo thêm, đưa luôn vào doc 51

- **§12.2 #1 (`__UNMAPPED__` bị soft-delete, gắn cờ 🔴 "Cần fix") ĐÃ HẾT**: `SELECT id, code, "deletedAt" FROM product_models WHERE code='__UNMAPPED__'` → `id=1, deletedAt=NULL`.
- **16/41 máy** còn `apiKey` plaintext at-rest (`count(*) FILTER (WHERE "apiKey" IS NOT NULL)`), không còn xác thực được vì `.env` `MACHINE_SHARED_KEY_ALLOWED=false` → policy `deny`.

**Commit: `3c6ccfc2`** — 0 dòng mã sản phẩm, 0 DDL, 0 đổi dữ liệu.

---

## 4. VIỆC 3 — BẢNG TỪNG CỜ

Mỗi ô là **phép đo**, không phải trích tài liệu. Cột "lưới" = số ca **chạy xanh lượt này**, đã đọc **cả số file lẫn số ca** (`1 passed (1)` / `N passed (N)`), `PIPESTATUS=0`.

| # | Cờ | Bật thì đường chạy đổi ở đâu (file:dòng, CẢ HAI nhánh) | Có lưới không? | Rủi ro đo được | **QĐ** + lý do | Đường lùi |
|:--:|---|---|---|---|---|---|
| 1 | **`INSPECTION_SINGLE_TX_ENABLED`** | Rẽ tại `machineApiRouters.ts:1456`. **ON** → `:1461 db.reserveInspectionId()` + `:1889 db.persistInspectionAtomic(...)`. **OFF** → `:1464 db.createProductInspection(...)` rồi đường 2-pha kết ở `:2010`. | **CÓ, mạnh nhất trong bảng.** `machineApiSingleTx.test.ts` **5 ca** (4 ON + 1 OFF) + `server/db/persistInspectionAtomic.db.test.ts` **6 ca chạy trên Postgres THẬT**, gồm ca ★ *"measurement failure ROLLS BACK the header — mutation-proof"*. **11/11 xanh.** | Đổi **đường ghi ingest sản xuất**. Doc 55 §6 buộc chủ dự án chấp nhận **sequence gap** + **ảnh orphan**. <br>⚠ Đo lại: **gap KHÔNG phải hành vi mới** — `product_inspections` hiện có `22.996` hàng, id `54751…95302`, tức **17.556 lỗ đã tồn tại (43%)**. Đối số này **yếu hơn** khảo sát nghĩ. | **KHÔNG BẬT.** Không phải vì rủi ro mã — vì **không nghiệm thu sống được lượt này**: (a) không có máy chủ cổng 3000; (b) đường ingest đòi khoá `mk_` mà `MACHINE_SHARED_KEY_ALLOWED=false` chặn khoá cũ, và **tạo khoá = đổi dữ liệu ⇒ bị cấm cứng**. Bật một cờ đường-ghi mà không bấm được nó một lần là ship mù. | Gỡ dòng `.env` + redeploy. **Sạch**: không schema, không migration; hàng ghi lúc ON cùng bảng/cột, chỉ khác thứ tự cấp id. |
| 2 | **`MACHINE_FIDUCIAL_REGISTRATION`** | `machineApiRouters.ts:326` `envTrue(...)`. ON → `resolveCoordinates` căn affine (ép similarity Umeyama, `MACHINE_FIDUCIAL_MAX_RESIDUAL_PX`=5.0, `MIN_MARKS`). OFF → chỉ scale theo độ phân giải. | **CÓ** — `machineApiFiducialRegistration.test.ts` **6 ca** (5 bật cờ), gồm fallback `residual_exceeded` (RMS 18.257 > 5) và `insufficient`. Xanh. | **Đổi toạ độ ghi vào DB.** Doc 55 QĐ⑧ chốt 5.0px *"sau khi có telemetry residual thật"* — telemetry ấy **chưa có** (0 lượt chạy thật). Ngưỡng sai ⇒ hoặc bỏ qua căn chỉnh, hoặc căn sai âm thầm. | **KHÔNG BẬT.** Đổi hành vi **nhìn thấy được** (vị trí điểm đo) + ngưỡng chưa được hiệu chuẩn bằng số thật + không nghiệm thu sống được. | Gỡ dòng `.env` + redeploy. **Không sạch hoàn toàn**: toạ độ đã ghi lúc ON **giữ nguyên** (phải chấp nhận hoặc backfill = đổi dữ liệu). |
| 3 | **`PRODUCT_VARIANT_ENABLED`** | `machineApiRouters.ts:361` + `productRouters.ts:129`. ON → sync/ingest variant-aware (`variantCode` vào ACL, deltaSync tombstone per-variant). OFF → bỏ qua. | **CÓ, nhiều nhất** — `machineApiProductVariant.test.ts` **14 ca** (9 bật cờ). Xanh. | **Bật để làm gì?** — `SELECT * FROM product_variants` → **4 hàng, cả 4 là `code='BASE'`, `isBase=true`**, sinh bởi backfill mig 0286 ngày 2026-07-17; `variant_point_overrides` → **0 hàng**. ⇒ **0 biến thể thật.** Bật = đổi hợp đồng sync với máy để đạt **0 lợi ích đo được**. | **KHÔNG BẬT.** Đổi hợp đồng API, lợi ích đo được = 0. Bật lại khi có biến thể đầu tiên. | Gỡ dòng `.env` + redeploy. Sạch (chưa hàng nào bị gắn variant ≠ base). |
| 4 | **`MQTT_ADMISSION_ENFORCE`** | `mqttService.ts:663-666`. ON → thiết bị `approvalStatus≠APPROVED` bị **giới hạn vào phạm vi pairing** (`ACL_PAIRING_LEAVES`), chặn `configure`/`ack`/broadcast. OFF → **gắn cờ + ghi log, vẫn cho qua**. | **CÓ** — `mqttTopicAcl.test.ts` **60 ca**, **20** dùng `ADMIT_ENFORCE`, gồm ca *"DEFAULT — a PENDING violation is FLAGGED but ALLOWED"*. Xanh. | **Có thể CẮT thiết bị đang chạy.** Mã tự khai một **staleness cố ý**: `approvalStatus` đọc **một lần lúc authenticate** rồi cache trên connection ⇒ thiết bị được duyệt trong lúc đang kết nối vẫn kẹt PENDING tới lần reconnect. | **KHÔNG BẬT.** Lớp phòng vệ **thứ hai** (lớp thứ nhất — topic ACL — **đang cưỡng chế thật**, `:1459`/`:1474`). Khảo sát khuyến nghị đúng: chạy warn-only trọn một ca rồi đọc log. | Gỡ dòng `.env` + redeploy. Sạch (chỉ đổi quyết định cho/chặn, không ghi gì). |
| 5 | **`OEE_SNAPSHOT_ENABLED`** | `oeeSnapshotScheduler.ts:49` `ENABLED`; `:262-264` `startOeeSnapshotScheduler()` no-op khi tắt. ON → 2 cron (`5 * * * *` HOUR, `20 1 * * *` DAY) **GHI** `oee_metrics`. | **CÓ** — `oeeSnapshotScheduler.test.ts` **8 ca**, gồm *"idempotent — never double-inserts an existing machine+period+end"* + *"no fabricated Performance"*. Xanh. | **GHI DỮ LIỆU SẢN XUẤT** (chính docstring `:19` viết hoa "WRITES data"). `oee_metrics` hiện **897 hàng, mới nhất `2026-07-16`** (28 ngày cũ). Mã đòi **single-worker**; tôi **không xác lập được** điều đó — không có máy chủ nào chạy, và repo có cả `dist/worker.js` riêng. | **KHÔNG BẬT.** Vi phạm trực tiếp ràng buộc *"KHÔNG bật cờ nào chạm dữ liệu sản xuất mà chưa có đường lùi"*. | **KHÔNG SẠCH** — gỡ cờ chỉ dừng ghi tiếp; hàng đã ghi ở lại, xoá chúng = đổi dữ liệu (bị cấm cứng). |
| 6 | **`SIM_PHYSICS_ENABLED`** | `kinematicSimGate.ts:414-436` — ON + backend gắn (`@dimforge/rapier3d-compat`, **có cài**) ⇒ thêm lượt rigid-body vào **cổng chặn deploy chương trình robot**; `irAdapter.ts:201` sinh lý do PHYSICS-block. | Có test `sim.t2b.test.ts` **35 ca** xanh (cổng kinematic), `rapierPhysics.test.ts`. | Đây là **cổng CHẶN**, không phải tính năng hiển thị. Bật ⇒ một chương trình đang deploy được **có thể bị chặn**, hoặc ngược lại. Vùng an-toàn-liền-kề. | **KHÔNG BẬT.** Đổi phán quyết của một cổng chặn ⇒ cần chủ dự án. | Gỡ dòng `.env` + redeploy. Sạch. |
| 7 | **`FIELD_V2_ENABLED`** | `fieldRouter.ts:47-51` `requireFlag()` ⇒ OFF: `CONFLICT/FEATURE_DISABLED`. ON: mở discovery/register/dispatch + `commandAuthz`. | `field.x1.test.ts` **18 ca** xanh (gồm ca *"flag ON + opcua against unreachable endpoint → honest failure, NO fabrication"*). | Mở **năng lực ghi xuống thiết bị** (discovery + command dispatch). Không có hậu quả **đang diễn ra** nếu để tắt. | **KHÔNG BẬT.** Mở bề mặt điều khiển thiết bị = quyết định của chủ dự án, không phải của agent. | Gỡ dòng `.env` + redeploy. Sạch. |
| 8 | **`ERP_INBOUND_ENABLED`** | `erpIntake.ts:39` + `:88-92` — OFF: **HTTP 503** `erp_inbound_disabled`. ON: nhận order/BOM thật, phát `order.created`. | `erpIntake.test.ts` **13 ca** xanh. | **Đổi hợp đồng API vào** với hệ ERP đối tác: cùng một endpoint đang trả 503 sẽ bắt đầu **nuốt và ghi** dữ liệu. | **KHÔNG BẬT.** Đổi hợp đồng với bên thứ ba. | Gỡ dòng `.env` + redeploy — nhưng order đã nạp thì **ở lại**. |
| 9 | **`SAFETY_ZONE_SW_ENABLED`** | `safetyRouter.ts:84-88` `requireSafetyZoneFlag()`; `:255` cũng lái zone evaluator. | `safety.s2a.test.ts` **31 ca** xanh. | Chính thông điệp lỗi tự khai: ***"ADVISORY only, not SIL"***. Doc 16 §15 xếp nó vào nhóm **cần phần cứng** (UWB/LiDAR + Safety PLC đạt SIL). | **KHÔNG BẬT.** Bật một bề mặt an toàn **không đạt SIL** mà không có phần cứng là mời người vận hành tin vào một thứ không được phép tin. | Gỡ dòng `.env` + redeploy. Sạch. |
| 10 | **`LICENSE_BYPASS`** (`.env:111 = true`) | — **CHỈ ĐO, KHÔNG CHẠM** — | `licenseHardening.test.ts` | xem §4.1 | **GIỮ NGUYÊN `true`.** | — |

**Tổng: bật 0/9 cờ có-thể-bật.** Bảy cờ đổi hành vi/hợp đồng đường chạy thật, một cờ ghi dữ liệu sản xuất không có đường lùi sạch, và **không cờ nào nghiệm thu sống được** vì §1 ③.

### 4.1 `LICENSE_BYPASS` — tắt nó thì hỏng gì (đo, không suy)

Chuỗi đo:

1. `licenses` = **0 hàng** · `license_activations` = **0** · `license_modules` = **0**.
2. `LICENSE_MODULE_GATE_ENABLED` **vắng khỏi `.env`**, mà `env.ts:35` là `!== 'false'` ⇒ **module gate MẶC ĐỊNH BẬT**. Thứ duy nhất đang giữ cửa mở là `LICENSE_BYPASS=true` (`moduleGate.ts:194`).
3. `moduleGate.resolveEntitlement()` (`:119-124`): DB không có module nào ⇒ **rơi xuống cache đĩa** `server/license/license-state-cache.json`. Cache ấy **có thật**: `state:"normal"`, `licenseKey:"XA8V-…"`, `expiresAt` = **2027-02-20**, `allowedModules` = **đúng 10 mã**, `cachedAt` = **2026-03-31** (135 ngày trước).
4. ⇒ `configured: true` ⇒ **KHÔNG rơi vào nhánh no-brick**. Module vắng khỏi 10 mã ấy bị **từ chối cứng** (`FORBIDDEN`/`FEATURE_DISABLED`).
5. Đối chiếu **tập mã thật sự được cưỡng chế trong mã máy chủ** (`grep moduleGate\|moduleProcedure`) với 10 mã của cache:

| Mã | Số điểm gác | Trong SKU cache? | Kết quả nếu `LICENSE_BYPASS=false` |
|---|:--:|:--:|---|
| `MOD_AI` | **15** | ✗ | **TỪ CHỐI** |
| `MOD_OT_CONTROL` | **12** | ✗ | **TỪ CHỐI** |
| `MOD_ENGINEERING` | **10** | ✗ | **TỪ CHỐI** |
| `MOD_QUALITY` | **6** | ✗ | **TỪ CHỐI** |
| `MOD_FEDERATION` | **4** | ✗ | **TỪ CHỐI** |
| `MOD_PRODUCTION` | 7 | ✓ | qua |
| `MOD_X` | 1 | — | qua (không có trong registry ⇒ pass-through) |

> **⇒ 47/55 điểm gác module sẽ TỪ CHỐI.** Không phải "khoá cả ứng dụng" (lớp `licenseEnforcementMiddleware` sẽ đọc cache `state:"normal"` nên **không** rơi vào `no_license`, và `decideLicenseBatch` còn giữ *never-stop-production*), nhưng **năm module lớn tắt ngóm** — AI, OT-control, Engineering, Quality, Federation.

**Quả mìn thứ hai, tách bạch:** `runtime-security.ts:50-105` chỉ bị bỏ qua khi `LICENSE_BYPASS=true` **hoặc** `NODE_ENV !== 'production'`. Mà `"start"` là `cross-env NODE_ENV=production node dist/index.js`. ⇒ với `LICENSE_BYPASS=false` **ở production**, tiến trình `fs.watch` chính `dist/index.js` và **`process.exit(78)`** ngay khi hash đổi — tức **một lượt `npm run build` khi máy chủ đang chạy sẽ tự giết máy chủ**.

**Khuyến nghị đo được:** muốn tắt `LICENSE_BYPASS` thì **trước hết nạp SKU thật** (hàng `licenses` với `allowed_modules` đủ 5 mã trên), **hoặc** xoá/làm mới `license-state-cache.json` để rơi đúng vào nhánh no-brick. Tắt trước, nạp sau = tự chặn 5 module.

---

## 5. CỔNG RA

| Cổng | Kết quả |
|---|---|
| `npm run check` (tsc `--noEmit`) | **exit 0** |
| `npm run check:tests` (`tsconfig.tests.json`) | **exit 0** |
| `npm run i18n:check` | **exit 0** — `0` placeholder mismatch · `0` NEW missing-in-all · `0` NEW missing-in-some · `0` stale baseline · `0` baseline-integrity violation *(nợ đóng băng có trước: 817 + 20)* |
| §"Cổng kiểm chung" — khối `npx vitest run …` (56 đường) | **exit 0** — **`Test Files 158 passed (158)` · `Tests 2470 passed (2470)`** · 56,27 s |
| **Cùng khối + `--sequence.shuffle.tests`** | **exit 0** — **`158 passed (158)` · `2470 passed (2470)`** · 57,72 s |
| `npm run build` (chuỗi đầy đủ) | **exit 0** · `[copy-font-assets] 6 file(s) → dist\assets\fonts (21390337 bytes)` |
| Lưới mới `server/services/fontAssetsDist.test.ts` | **`1 passed (1)` / `5 passed (5)`**, `PIPESTATUS=0` |

**Khớp đúng mốc brief (2.470 ca, 0 đỏ) ⇒ lượt này KHÔNG gây hồi quy nào.**

### 5.1 `CONG` / `FILE_CANH` — đọc bằng cách ĐỂ CỔNG ĐỎ

Không tin hai con số ghim. Đột biến `toBe(56)` → `toBe(999999)` và `toBe(120)` → `toBe(888888)` (cầu chì: file phải sạch git trước, phải chạm **đúng 2** chỗ, `git diff --stat` xác nhận `2 insertions(+), 2 deletions(-)`), rồi **đọc số thật trong thông điệp lỗi**:

```
AssertionError: … expected 56 to be 999999
                  … expected 120 to be 888888
Tests  2 failed | 13 passed (15)
```

⇒ **`CONG` = 56 · `FILE_CANH` = 120 — KHÔNG ĐỔI.** Khôi phục xong: `git status` **0 mục bẩn**, `vramPha5Gate.test.ts` **15/15 xanh**.
Lưới mới của tôi (`fontAssetsDist.test.ts`) **không** vào tập bị canh — đúng theo cấu tạo: nó không tự khai `Pha N` và không nằm dưới `server/services/vram/`, nên cả ba bộ nhận diện đều không bắt. Đây là *"không đổi"* **đo được**, không phải *"chắc là không đổi"*.

---

## 6. NỢ MỚI / VIỆC CÒN CHỜ NGƯỜI

| # | Việc | Vì sao chờ người |
|:--:|---|---|
| 1 | **Máy chủ cổng 3000 đang TẮT** | Tôi không tự dựng lại: `startBackgroundJobs` khởi động cron **GHI** dữ liệu. Cần một câu của chủ dự án ⇒ `pwsh scripts/redeploy.ps1`, rồi kiểm `GET /` = 200 và **đếm lại** tiến trình phục vụ cổng 3000 (từng có HAI máy chủ song song trên cùng DB). |
| 2 | **Nghiệm thu sống cho cờ #1/#2** | Cần (a) máy chủ chạy, (b) **một khoá máy `mk_` hợp lệ** để bắn một lượt `submitInspection` thật. Tạo khoá = đổi dữ liệu ⇒ ngoài quyền của lượt này. |
| 3 | **`LICENSE_BYPASS`: nạp SKU trước, tắt sau** | 47/55 điểm gác sẽ từ chối nếu tắt trước khi nạp (§4.1). Kèm: `license-state-cache.json` đã **135 ngày tuổi** và đang là **nguồn SKU duy nhất**. |
| 4 | **16/41 máy còn `apiKey` plaintext at-rest** | Bước cuối runbook doc 52 (`UPDATE machines SET "apiKey"=NULL`) — **đổi dữ liệu**. Chạy `scripts/machine-key-rotation-report.mjs` trước. |
| 5 | **Cache SKU chỉ 10 module** trong khi mã cưỡng chế 6 mã module, 5 mã vắng | Quyết định thương mại: SKU thật gồm những module nào. |

---

*Nhóm C · lượt xử lý 2026-08-13 · Việc 1 `bc1b85af` · Việc 2 `3c6ccfc2` · Việc 3 **0 cờ được bật, 10 cờ được đo**.*
