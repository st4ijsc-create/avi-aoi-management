# Sổ nợ còn mở sau Đợt 56 — GHI, KHÔNG VÁ

Ngày đo: **2026-09-12**, worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`, HEAD sau Đợt 56.
Kế thừa từ `.qa-dot55/NO.md`. Mỗi món giữ ba ô bắt buộc: `file:line` · **ai chịu** · **cách kiểm khi đóng**.

> ★★★ Luật của sổ này (G83): **số kế thừa là LỜI KHAI, không phải phép đo.** Đợt 56 vừa chứng minh
> luật ấy bằng chính món số 7 của Đợt 55 — xem mục "ĐÃ SỬA SAI" ở cuối.

---

## 1. ★★ `kb:operational-cards:test` — 194 ≠ 164 (ĐỎ)
*(nguyên văn Đợt 55 — Đợt 56 KHÔNG đo lại, không đụng tới `knowledge/`)*

| | |
|---|---|
| **Ở đâu** | `scripts/ai-kb/buildOperationalCards.test.mjs:159`, assert nổ `:169` |
| **Triệu chứng** | `ERR_ASSERTION · actual: 194 · expected: 164` |
| **Ai chịu** | Chủ sở hữu KB — "164 là số ĐÚNG hay số CŨ" là quyết định sản phẩm |
| **Cách kiểm khi đóng** | `npm run kb:operational-cards:test` ⇒ exit 0, kèm lý do con số mới đúng |

## 2. ★ `ext:check` — thiếu `@types/vscode` (ĐỎ)
*(nguyên văn Đợt 55)*

| | |
|---|---|
| **Ở đâu** | `vscode-extension/tsconfig.json` khai `types: ["vscode"]`, gói không có trong `vscode-extension/node_modules` |
| **Triệu chứng** | `error TS2688` — đúng 1 lỗi, không phải lỗi mã |
| **Ai chịu** | Chủ sở hữu extension VSCode |
| **Cách kiểm khi đóng** | `npm i -D @types/vscode --prefix vscode-extension` + `npm run ext:check` ⇒ 0 lỗi; rồi chạy lại `ext:build` + `ext:package` |

## 3. ★★ `npm test` (toàn bộ) — 97 tệp / 205 ca ĐỎ, **0 tệp trong `twin3d`**
*(nguồn: Đợt 54. Đợt 55 **và** Đợt 56 đều KHÔNG đo lại — tranh chấp DB. Vẫn là lời khai của Đợt 54.)*

| | |
|---|---|
| **Ở đâu** | `.qa-dot54/test-full-failfiles.txt` |
| **Nguyên nhân trội** | một họ: `No "<tên>" export is defined on the "../db" mock` |
| **Ai chịu** | Chủ sở hữu suite `server` (nợ CÓ SẴN từ 2026-08-18) |
| **Cách kiểm khi đóng** | `npx vitest run` ⇒ `0 failed`. Bước trung gian đo được: sửa mock `../db` đủ export ⇒ số tệp đỏ tụt **dưới 30** |

## 4. ★★ `test:e2e` toàn bộ — CHƯA AI CHẠY (bẫy `outputDir` đã gỡ ở Đợt 55)

| | |
|---|---|
| **Ở đâu** | `package.json` script `test:e2e`; `playwright.config.ts` (`outputDir: ".qa-pw-output"` — **ĐỪNG BỎ**, không có nó Playwright dọn sạch `test-results/`) |
| **Đo được Đợt 56** | `npx playwright test --list` ⇒ **151 test / 30 tệp**, và nay **0 lỗi kiểu** (mục B đã đưa `e2e/` vào cổng) |
| **Vì sao vẫn chưa chạy** | 30 spec thuộc các đợt khác nhau, **cổng khác nhau** (3030/3038/3047/3100/3130/3140/3141/3142). Một `baseURL` chung ⇒ phần lớn đỏ OAN (G108) |
| **Ai chịu** | Chủ sở hữu (quyết định: gộp một cổng, hay chia project theo lô trong một config) |
| **Cách kiểm khi đóng** | `npm run test:e2e` ⇒ exit 0 **và** `--list` vẫn 151/30 **và** `git status --porcelain test-results/` RỖNG sau lượt chạy |

## 5. ★ Bộ chọn TẦNG — chưa đo được vì DB dev chỉ có 1 toà / 1 tầng
*(nguyên văn Đợt 55 — Đợt 56 giữ DB bất biến nên không dựng tầng thứ hai)*

| | |
|---|---|
| **Ở đâu** | `client/src/components/twin3d/van-hanh/BoChonNapUI.tsx:156` · chỗ gọi duy nhất `client/src/pages/TwinVanHanh.tsx:2588` |
| **Đo được** | `twin_toa_nha` = 1 hàng · `twin_tang` = 1 hàng ⇒ ô chọn một lựa chọn **không phân biệt** "lọc đúng" với "không lọc gì" |
| **Ai chịu** | Chủ sở hữu dữ liệu mô phỏng (`scripts/sim-factory/`) |
| **Cách kiểm khi đóng** | Dựng tầng thứ hai có ≥1 máy: chọn A ⇒ `__demMay.ve` = số máy A; chọn B ⇒ số máy B; A+B = tổng. Ba số một lượt. Hàng tạm phải `trap` (G111), DB về đúng 11+6 khoá |

## 6. ★ 41 cặp nhãn ∩ khối máy khác (G128) — CHỈ ĐO, kết cục click đã đúng
*(nguồn: spec §14q:6882, Đợt 49. Đợt 55 **và** 56 không đo lại — cần trình duyệt + dist)*

| | |
|---|---|
| **Ở đâu** | `client/src/components/twin3d/loi/LopNhan.tsx:476-477` (`deKhoiKhac` vs `deKhoiKhacDoLai`) |
| **Vì sao KHÔNG vá** | Hợp đồng bố cục là "hết chỗ thì GIỮ nhãn" (NT-2). Kết cục người dùng đã ĐẠT ở Đợt 54 |
| **Ai chịu** | Chủ sở hữu — đóng nó đòi **đổi hợp đồng sản phẩm** |
| **Cách kiểm khi đóng** | `deKhoiKhacDoLai` = 0 ở cả 8 trạng thái **ĐỒNG THỜI** `soBiGiau` nhãn máy bất thường vẫn = 0 |

## 7. ★ `DISTINCT ON` ngoài đường Twin — **31 chỗ** (số Đợt 55 đã sửa, xem cuối)

Đo lại Đợt 56 (`grep -rn "DISTINCT ON" server/ --include=*.ts`, bỏ dòng bình luận): **35 chỗ SQL / 17 tệp**.
Trong đó **4 chỗ** thuộc `factoryCommandService.ts` (đường Twin — Đợt 56 đã đo, **không chỗ nào là bệnh**),
còn **31 chỗ ngoài Twin CHƯA AI ĐO `EXPLAIN`**.

| tệp | số chỗ SQL | ghi chú |
|---|---:|---|
| `server/db/twinCanh.ts` | 10 | đường Twin — QĐ-27 đã đo, có index |
| `server/services/factoryCommandService.ts` | **4** | ✅ Đợt 56 đã đo cả 4: 0,7–3,3 ms, không chỗ nào đạt tiêu chí bệnh |
| `server/services/oeeService.ts` | 6 | ⚠ ngoài Twin nhưng **bước 6 của `overview` gọi vào đây** — chiếm **34 %** thời gian thủ tục (xem món 10) |
| `server/db/machine.ts` | 4 | ngoài Twin |
| 13 tệp còn lại | 1–2 mỗi tệp | ngoài Twin |

| | |
|---|---|
| **Ai chịu** | Chủ sở hữu từng module |
| **Cách kiểm khi đóng** | Mỗi chỗ ghim **ba** số: `Seq Scan rows` · `Sort Method` (không còn `external merge`) · `Execution Time` **ấm**. Rồi đo lại **qua chính thủ tục** (`createCaller`), không chỉ SQL thuần. ⚠ Và áp **tiêu chí bệnh** trước khi vá (G137): `DISTINCT ON` **tự nó không phải lỗi** — Đợt 56 đo 4 chỗ thì cả 4 đều lành |

## 8. ★★★ Production chưa áp index QĐ-27
*(nguyên văn Đợt 55 — thao tác production, không phải việc của agent)*

| | |
|---|---|
| **Ở đâu** | Migration `drizzle/0356` — `machine_health_history ("machineId","createdAt" DESC)` |
| **Trạng thái** | DEV: **ĐÃ ÁP** (`indisvalid=true`). PRODUCTION: **CHƯA** |
| **Số đo dev** | `traSucKhoeMay`: 288,534 ms (Seq Scan 212 194 hàng + external merge 7 848 kB) → **0,302 ms**. Qua thủ tục ấm p50: 319,26 → 11,82 ms (27,0×) |
| **Xác nhận lại Đợt 56** | Index **vẫn đang được dùng**: `factoryCommandService:317` chạy `SkipScan → Index Scan idx_health_machine_created_desc`, quét thật **43 hàng** trên bảng **217 683 hàng**, ấm **0,8 ms** |
| **Ai chịu** | **Chủ sở hữu** — cửa sổ bảo trì |
| **Cách kiểm khi đóng** | Trên production: `indisvalid` = `t`, rồi `EXPLAIN (ANALYZE,BUFFERS)` ⇒ **0 dòng `external merge`**, `Execution Time` < 5 ms. Đo **trước** rồi **sau**, cùng câu cùng máy |

---

## MÓN MỚI — Đợt 56 phát hiện

## 9. ★★★ `pngjs` là PHỤ THUỘC MA (phantom dependency)

| | |
|---|---|
| **Ở đâu** | `package.json` — **không** có `pngjs` ở `dependencies` lẫn `devDependencies`. Nhưng 17 chỗ gọi: `e2e/twin-lo-u-tuong-tac.spec.ts:2`, `e2e/twin-lo-v-tuong-tac.spec.ts:3` (+15 chỗ `PNG.sync.read` trong 2 tệp ấy) và ~10 script QA (`.qa-dot30/do-anh.mjs:11` … `.qa-dot53/thigiac53.mjs:12`) |
| **Rủi ro đo được** | Gói chỉ tồn tại như phụ thuộc **bắc cầu**. Một lần `npm ci` mà cây phụ thuộc đổi ⇒ **mọi phép đo pixel của dự án chết** — mà chết bằng `ERR_MODULE_NOT_FOUND`, tức đỏ ồn ào, không âm thầm. Đó là điểm nhẹ nhõm duy nhất |
| **Vì sao Đợt 56 không tự vá** | Brief chỉ cho thêm `@types/pngjs` **"nếu gói đã có trong node_modules"** — điều kiện SAI (không có). Thêm `pngjs` vào `package.json` là động vào `package-lock.json`, ngoài phạm vi được giao. Đã thay bằng `e2e/pngjs.d.ts` (khai kiểu HẸP) để đóng lỗ kiểu |
| **Mạng** | **KHÔNG bị chặn**: `npm view @types/pngjs version` ⇒ `6.0.5` |
| **Ai chịu** | Chủ sở hữu (đổi `package.json`/`package-lock.json`) |
| **Cách kiểm khi đóng** | `npm i -D pngjs@5.0.0 @types/pngjs@6.0.5`, **XOÁ `e2e/pngjs.d.ts`**, rồi `npm run check:tests` ⇒ vẫn **27 lỗi, 0 trong `e2e/`**. Nếu xoá `.d.ts` mà số lỗi ≠ 27 thì `@types` chưa thực sự thay được nó |

## 10. ★★ Nút thắt thật của `factoryCommand.overview` là **OEE**, không phải `DISTINCT ON`

| | |
|---|---|
| **Ở đâu** | `server/services/factoryCommandService.ts:339` bước 6 gọi `getAllMachinesOEELive({windowHours:24})` → `server/services/oeeService.ts` (6 chỗ `DISTINCT ON`) |
| **Đo được Đợt 56** | Thủ tục `overview({factoryId:1})` ấm **22,4 ms** (41 máy / 67 issue). Phân rã: **OEE 7,7 ms = 34,4 %** · 4 `DISTINCT ON` cộng lại 5,6 ms = 25,0 % · phần còn lại ~40 % là join máy+phả hệ, andon/alert/WO và ráp payload. Bằng chứng: `.qa-dot56/A-pareto.txt` |
| **Vì sao chỉ GHI, không vá** | **Chưa đạt tiêu chí bệnh** (G137): 7,7 ms ấm, xa ngưỡng `[SLOW QUERY]` 200 ms (`server/queryMonitor.ts:40`). Vá bây giờ là tối ưu thứ chưa ai chứng minh là đau |
| **Ai chịu** | Chủ sở hữu `oeeService` — và chỉ khi có bằng chứng chậm ở quy mô thật |
| **Cách kiểm khi đóng** | Nếu về sau thủ tục vượt 200 ms: đo lại **bảng Pareto này trước** (`.qa-dot56/A-pareto.mts` chạy lại được), vá mục lớn nhất, rồi chứng minh md5 đầu ra ≥ 2 vai KHÔNG đổi |

## 11. ★ Bước 4 của `overview` luôn trả RỖNG — `machine_positions` = 0 hàng

| | |
|---|---|
| **Ở đâu** | `server/services/factoryCommandService.ts:277` (`DISTINCT ON` trên `machine_positions`) |
| **Đo được Đợt 56** | `select count(*) from machine_positions` ⇒ **0**. Câu chạy 0,7 ms và luôn cho `posByMachine` rỗng ⇒ mọi máy dùng vị trí dự phòng |
| **Vì sao không vá** | Không phải lỗi mã: bảng trống là **trạng thái dữ liệu**. Nhưng nó làm mọi lưới đi qua bước này **không thể phân biệt** "đọc vị trí đúng" với "không đọc gì" — cùng lớp mù với món 5 |
| **Ai chịu** | Chủ sở hữu dữ liệu layout/mô phỏng |
| **Cách kiểm khi đóng** | Chèn ≥1 hàng `machine_positions` cho một máy đã biết ⇒ `overview` phải trả đúng `x/y/z` ấy cho máy ấy **và** máy khác vẫn dùng dự phòng. Hai chiều, không lấy một. ⚠ Hàng tạm phải `trap` xoá |

## 12. ★ Spec e2e khai kiểu TAY cho `window.__*` thay vì dùng nguồn sự thật

| | |
|---|---|
| **Ở đâu** | `e2e/twin-studio-thiet-ke.spec.ts:116` (bản sao tay của `__gizmo`) — nguồn đầy đủ là `CuaSoDoGizmo` tại `client/src/components/twin3d/thiet-ke/GizmoBienDoi.tsx:90`. Cùng khuôn ở `:150` (`__thongKeVe`) và các spec khác |
| **Đo được Đợt 56** | Bản sao tay đã TRÔI: khai 3 ô trong khi 4 dòng `expect` đọc 6 ô. Vì `e2e/` chưa từng có `tsc` nhìn, độ trôi ấy sống sót cho tới hôm nay. Đã vá **triệu chứng** (thêm 3 ô), **chưa vá nguyên nhân** (còn là bản sao) |
| **Vì sao không vá nguyên nhân** | `import type` từ `client/` vào `e2e/` sẽ là **tiền lệ đầu tiên** (0/30 spec hiện làm vậy) — vượt mức xáo trộn brief cho phép |
| **Ai chịu** | Chủ sở hữu e2e |
| **Cách kiểm khi đóng** | Đổi spec sang `import type { CuaSoDoGizmo } from "@/components/twin3d/thiet-ke/GizmoBienDoi"` ⇒ `npm run check:tests` vẫn 27/0-trong-e2e **và** `npx playwright test --list` vẫn 151/30 (chứng minh `import type` bị xoá hết lúc chạy, không phá module graph) |

---

## ĐÃ ĐÓNG trong Đợt 56

| món | trước | sau | bằng chứng |
|---|---|---|---|
| `e2e/` không nằm trong cổng kiểu nào — 30 spec chưa từng được `tsc` nhìn | 0 tệp e2e được canh | **30 tệp được canh**, `check:tests` 27 lỗi · **0 trong `e2e/`** | `.qa-dot56/B-XONG.txt`; ablation 2 chiều `.qa-dot56/ablation-B-ketqua.txt` |
| 5 lỗi TS có sẵn trong `e2e/` | 5 | **0** | `.qa-dot56/B-check-tests.txt` |
| `dist/` cũ hơn HEAD 6 đợt (thiếu mọi bản vá 49–54) | 0/3 dấu Đợt 49+ | **3/3** dấu có mặt | `.qa-dot56/C-XONG.txt`, md5 trước/sau |

---

## ★★★ ĐÃ SỬA SAI — món số 7 của Đợt 55 là LỜI KHAI CŨ, không phải phép đo

Đợt 55 ghi: *"`factoryCommandService.ts` — **8 chỗ**; spec §14q:6946 đã đo `:289`: Seq Scan **214 197 hàng**
→ external merge **8 824 kB** → **136,7 ms**. Bản sao thứ hai của đúng lớp lỗi QĐ-27, **CHƯA VÁ**."*
Brief Đợt 56 kế thừa nguyên câu ấy. Đo lại tại HEAD cho thấy **ba** chỗ sai:

1. **"8 chỗ" là đếm DÒNG grep, không phải đếm TRUY VẤN.** 9 dòng chứa chuỗi `DISTINCT ON`, trong đó
   **5 dòng là bình luận** (16, 244, 260, 274, 288). SQL thật: **4** (252, 264, 277, 317). *(G106)*
2. **Con số 136,7 ms mô tả một bản mã KHÔNG CÒN TỒN TẠI.** Nó đo `:289` — câu
   `machine_health_history` **trước** bản vá Đợt 53. Hôm nay câu ấy ở dòng **317** và đã là
   `ORDER BY "machineId","createdAt" DESC`, chạy **SkipScan → Index Scan**, quét **43 hàng**, **0,8 ms**.
   Ô "CHƯA VÁ" của Đợt 55 nói về bản đã chết. *(G83)*
3. **Đường dẫn chỗ gọi sai:** Đợt 55 và brief đều ghi `client/src/hooks/useTrangThaiSong.ts:87`.
   Tệp ấy **không tồn tại**; đường thật là `client/src/components/twin3d/van-hanh/useTrangThaiSong.ts:87`.

**Kết luận đo được:** cả 4 chỗ `DISTINCT ON` trong `factoryCommandService.ts` đều **KHÔNG đạt tiêu chí bệnh**
(quét > 50 000 hàng · external merge · ấm > 20 ms). Chậm nhất là 3,3 ms — **1,7 %** ngưỡng `[SLOW QUERY]`.
Đợt 56 vá **0/4** và đó là kết quả ĐÚNG.
