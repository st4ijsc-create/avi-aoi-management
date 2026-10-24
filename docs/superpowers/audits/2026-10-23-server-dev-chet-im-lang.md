# Server app (dev) chết im lặng lúc boot — gốc: worker_thread của `pino-pretty`

Ngày đo: 2026-10-22 → 2026-10-23 · Người đo: kiem-dinh · Công cụ: `scripts/chan-doan/` · Trạng thái: ĐÃ XÁC ĐỊNH GỐC VÀ ĐÃ VÁ (2026-10-23, dieu-phoi quyết định): `server/logger.ts` dev dùng `pino-pretty` đồng bộ; nghiệm thu ở §6.

## 0. Tóm tắt dành cho vận hành

- **:3000 (production) KHÔNG bị lỗi này.** Production không dùng `pino-pretty` nên không tạo worker thread của logger; đo 0/80 lần chết (20 + 60) so với dev ~6–13 %.
- Lỗi chỉ ảnh hưởng **server dev** (`NODE_ENV=development`: :3012–3015, instance e2e, `npx tsx server/_core/index.ts`): ~6–13 % lần khởi động chết sớm (trước khi cổng nghe) với mã thoát `3221226356` (0xC0000374, STATUS_HEAP_CORRUPTION) hoặc `3221226505` (0xC0000409, fast-fail); lần thử lại thường lên.
- **Giải pháp tạm không đổi mã**: khởi động dev với `LOG_JSON=1` (tắt pino-pretty ⇒ không worker). Không có tác dụng phụ khác đáng kể ngoài định dạng log JSON và `console.*` đi qua pino.
- **ĐÃ VÁ (không đổi gói)**: ở dev `server/logger.ts` dùng `pino-pretty` như stream ĐỒNG BỘ (`sync: true`) trong tiến trình chính thay cho `transport` (worker). Production giữ nguyên. `LOG_PRETTY_WORKER=1` quay lại transport cũ để đối chứng. Test `server/logger.cheDo.test.ts`; nghiệm thu §6.

## 1. Bằng chứng (mỗi dòng = số lần khởi động; "chết" = tiến trình thoát TRƯỚC khi cổng nghe)

Cấu hình chung: spawn node trực tiếp (bắt đúng exit code), PORT 3016, DB `aoi_management_test`, tắt warm model/llama-server/watchdog, `GGUF_WARM_DEEP_MODEL_ON_BOOT=false`; từ loạt "không GPU" trở đi thêm `DIAG_NO_KB_WARM=1` + `AI_ORCHESTRATION_ENABLED=false` và trace `getLlama()` = 0 lần gọi, 0 dòng `cuda-backend` trong MỌI log (kiểm sau từng loạt). Các lần "treo" do DB `_test` bị khoá/phình KHÔNG tính vào mẫu số.

| Loạt | Chết / tổng | Ghi chú |
|---|---|---|
| Dev nền (chưa tắt đường CUDA ngầm) | 6/46 (13 %) | 5× 0xC0000374, 1× 0xC0000409 |
| Dev nền, bisect V0–V4 (40 lần mỗi biến) | 6/40, 4/40 (HMR tắt), 7/26 (watch tắt), 5/33 (bỏ tailwind), 1/29 (hoãn Vite 20 s) | không biến thể Vite nào loại được lỗi |
| Node 22.23.4 (zip chính thức, SHA256 khớp) | 3/40 (7,5 %) | không riêng Node 24.18.0 |
| **Không GPU thật** (0 getLlama) | 4/40 (10 %) | CUDA không phải gốc |
| Chặn sharp/onnxruntime (stub ESM) | 3/18 (17 %) vs đối chứng 1/16 (6 %) | không phải sharp/onnxruntime |
| Chặn rollup+lightningcss+oxide (stub CJS) | 8/40 (20 %) vs đối chứng dev 2/40 + 3/40 | không phải addon Vite |
| Dev **không dựng Vite** (`DIAG_SKIP_VITE`) | 4/40 + 1/40 (6 %) vs có Vite 2/40 + 3/40 (6 %) | **Vite không phải gốc** |
| Vite dev đứng riêng (không app) | 0/40 | |
| **Production** (không Vite, không pino-pretty) | 0/20 + 0/60 | |
| **Dev + `LOG_JSON=1`** | **0/60** | tắt pino-pretty |
| Dev + `LOG_BRIDGE_CONSOLE=1` (cầu nối console, VẪN worker) | 9/80 (11 %) | cầu nối không phải biến cứu |
| Bộ khuếch đại (`process.report` mỗi 4 s) A: pino-pretty mặc định | **12/30 (40 %)** | 10× 0xC0000374, 2× 0xC0000409 |
| Khuếch đại B: `LOG_JSON=1` | **0/30** | |
| Khuếch đại C: bridge (có worker) | 6/30 (20 %) | |
| Khuếch đại D: **pino-pretty đồng bộ** (`DIAG_PRETTY_SYNC=1`, không worker) | **0/30** | |

Fisher: A vs B hoặc A vs D p ≈ 1e-4; L1 (dev+LOG_JSON 0/60) vs L2 (bridge 9/80) p ≈ 0,006. Kết luận: biến duy nhất tách được dev khỏi production và đưa tỉ lệ về 0 là **sự có mặt của worker thread của logger `pino-pretty`** (`server/logger.ts`: `usePretty = !isProduction && !LOG_JSON` ⇒ `transport: { target: "pino-pretty" }` ⇒ `thread-stream` Worker).

Điểm chết không cố định: thường ngay sau `[Interlock] disabled`, đôi khi sau `[StopAlert]…` hoặc log rỗng — phù hợp heap corruption bị lộ ra bởi cấp phát đồng thời (cả hai luồng cùng tạo/huỷ đối tượng), không phải một dòng mã cụ thể. Bộ khuếch đại (`process.report.getReport()`, đi bộ heap) đẩy tỉ lệ chết dev lên 40–50 %.

Chưa xác định được *cơ chế* bên trong (module chủ thể). Giả thuyết còn mở: tương tác `thread-stream` Worker + loader hook của `tsx` (mỗi Worker kế thừa execArgv/hook của tsx) + addon native nạp trong tiến trình chính; production chạy bản build (không tsx) và không có Worker. Cần dump để chốt (xem §4).

## 2. Hai việc phụ đã phát hiện

1. **Quét STOP/factory-drift lúc boot đổ thông báo hàng loạt** (đã được luong-ui vá ở `0e09f01af` + `b4b32e7c3`, công tắc `EDGE_FACTORY_DRIFT_ALERT=off`). Trước khi vá: mỗi lần boot trên `aoi_management_test` tạo ~6.000 hàng `notifications` (ALERT) × ~1.900 người dùng ⇒ ~170 lần boot của đợt đo này làm bảng phình **1.017.040 hàng / 972 MB**, gây truy vấn quá hạn và các lần "treo không nghe cổng". **Đã dọn 1.017.040 hàng** ở `aoi_management_test` (chỉ `_test`; `type='ALERT'` và 4 mẫu tiêu đề `factory changed while edge` · `STOP owed after transfer` · `OT STOP sync between central` · `STOP not confirmed`; `createdAt ≥ 2026-10-22T10:00Z`) + `VACUUM ANALYZE`; còn 1.661 hàng `PATTERN ANOMALY` không đụng. Có thể ~759 hàng "OT STOP sync…" thuộc test của phiên khác trong cùng cửa sổ (dữ liệu test tổng hợp). DEV (`aoi_management`) không bị: 56.343 hàng, 0 hàng drift.
2. **Boot mặc định chạm GPU ngầm** (khi chưa tắt): `aiLocalKnowledgeService.warmUpOllamaModels()` (← `aiLocalKnowledgeApi.ts:374`) → `warmModel(GGUF_DEFAULT_MODEL)` + `embedQuestion("warmup")` (nạp Qwen3-Embedding-0.6B-f16 ~1,7 GB lên GPU) và `orchestration/aiWatcher.generateAdvisory` (khi `AI_ORCHESTRATION_ENABLED=true`) đều gọi `getLlama()` (CUDA backend) lúc boot dù `GGUF_WARM_DEEP_MODEL_ON_BOOT=false`. Đây là đường do-model thấy chết sau `[vram] "cuda-backend" … Ước lượng = 0`; **không phải gốc** của lỗi heap (loạt không-GPU vẫn chết ~10 %). ~90 lần boot đầu của đợt đo này (trước khi có cờ DIAG) đã chạm GPU thoáng qua; từ đó mọi loạt đều chặn cả hai đường.

## 3. Phiên bản

Node 24.18.0 (đối chứng 22.23.4) · pino 10.3.1 · pino-pretty 13.1.3 · thread-stream 4.2.0 · sonic-boom 4.2.1 · real-require 0.2.0 · vite 7.3.1 · rollup 4.57.0 · lightningcss 1.32.0 · @tailwindcss/oxide 4.3.2 · esbuild 0.25.12 · tsx (cli trong node_modules). Không nâng gói. Tra cứu web (2 truy vấn) không thấy issue nào gắn `pino`/`thread-stream` với 0xC0000374 trên Windows; chỉ có báo cáo chung về addon native nạp trong worker thread gây sập khi worker thoát (Node #41107). Chưa có bản vá upstream đã biết.

## 4. Việc còn lại / đề xuất (do dieu-phoi quyết)

1. ~~Vá sản phẩm~~ — ĐÃ LÀM (§6). Nếu vẫn thấy chết trên dev sau bản vá, bật `LOG_JSON=1` và báo.
2. **Chốt cơ chế bằng dump** — KHÔNG CÒN CẦN (gốc đã khoanh vùng và đã vá; dieu-phoi bỏ khỏi danh sách việc, 2026-10-23). Giữ lệnh để tham khảo (cần admin): WER LocalDumps — TẠO (PowerShell admin):
   `New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe' -Force; New-Item -ItemType Directory -Force D:\SOURCES\_dumps\node; $k='HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe'; New-ItemProperty $k -Name DumpFolder -PropertyType ExpandString -Value 'D:\SOURCES\_dumps\node' -Force; New-ItemProperty $k -Name DumpType -PropertyType DWord -Value 2 -Force; New-ItemProperty $k -Name DumpCount -PropertyType DWord -Value 5 -Force`
   GỠ: `Remove-Item -Recurse -Force 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe'`. Chủ dự án đã đồng ý ghi khoá (2026-10-23); phiên chẩn đoán không có quyền admin nên CHƯA tạo. Máy chưa có `gflags`/`cdb`/`procdump` (thư mục Debuggers chỉ có DLL) — PageHeap/Application Verifier cần cài Windows SDK Debugging Tools; nếu bật chỉ dùng cho `D:\SOURCES\_tools\node22\node.exe` (chậm hẳn): `gflags /p /enable D:\SOURCES\_tools\node22\node.exe /full` — gỡ: `gflags /p /disable D:\SOURCES\_tools\node22\node.exe`.
3. Không cần đổi cấu hình :3000.

## 6. Bản vá và nghiệm thu bằng số (mã đã vá, KHÔNG cờ `LOG_JSON`/`LOG_PRETTY_WORKER`)

Bản vá: `server/logger.ts` — `chonCheDoLogger(env)` (`json` | `pretty-dong-bo` | `pretty-worker`) và `taoLogger(env, destination?)`; dev ⇒ `pino(opts, pinoPretty({ colorize, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname", sync: true }))` (import ESM tĩnh); production ⇒ JSON như cũ; `LOG_PRETTY_WORKER=1` ⇒ transport worker cũ (chỉ dev). Test `server/logger.cheDo.test.ts` (10 ca): chọn chế độ; stream dev KHÔNG phải `ThreadStream`; đầu ra có màu/giờ/mức/trường, không pid/hostname; đối chứng dương `LOG_PRETTY_WORKER=1` ⇒ `ThreadStream`; production ⇒ JSON; census: `target: "pino-pretty"` chỉ xuất hiện đúng 1 lần, trong nhánh `pretty-worker`. Đột biến (4/4 bị bắt): dùng lại transport ở nhánh đồng bộ · mặc định worker · production cũng worker · bỏ `sync: true` (qua hằng xuất `PRETTY_DONG_BO`). `tsc --noEmit` toàn dự án sạch.

Nghiệm thu (cờ không-GPU `DIAG_NO_KB_WARM=1`, `AI_ORCHESTRATION_ENABLED=false`, `EDGE_FACTORY_DRIFT_ALERT=off`, trace `getLlama` = 0 lần gọi trong mọi log):

| Loạt | Chết / tổng |
|---|---|
| Bộ khuếch đại (`process.report` 4 s), dev, mã đã vá, mặc định | **0/30** (trước vá: 12/30) |
| Dev thường, mã đã vá, mặc định | **0/60** (trước vá: ~6–13 %) |

> 2026-10-24: cờ chẩn đoán `DIAG_NO_KB_WARM` đã thành cờ THẬT `AI_KB_WARM_ON_BOOT=false` (mặc định bật) — các lệnh dưới đây dùng cờ cũ cho lịch sử; hiện chỉ cần `AI_KB_WARM_ON_BOOT=false AI_ORCHESTRATION_ENABLED=false`.

## 5. Tái hiện

```
node scripts/chan-doan/boot-lap.mjs 40 DIAG_NO_KB_WARM=1 AI_ORCHESTRATION_ENABLED=false EDGE_FACTORY_DRIFT_ALERT=off LOG_PRETTY_WORKER=1   # (trước vá: mặc định) chết ~6–13 %; mã đã vá chỉ chết khi bật LOG_PRETTY_WORKER=1
node scripts/chan-doan/boot-lap.mjs 40 DIAG_NO_KB_WARM=1 AI_ORCHESTRATION_ENABLED=false EDGE_FACTORY_DRIFT_ALERT=off LOG_JSON=1   # 0/60 (mã đã vá: mặc định cũng 0/60)
```
(`DIAG_NO_KB_WARM`, `DIAG_PRETTY_SYNC`, `DIAG_SKIP_VITE`, `DIAG_TRACE_LLAMA`, `DIAG_NO_TAILWIND`, `DIAG_VITE_*` chỉ có hiệu lực khi áp `scripts/chan-doan/diag-boot.patch` vào cây làm việc — KHÔNG commit.) Cổng 3016, DB `_test`; đặt `BOOT_CLEAN_EVERY=5` nếu chưa có bản vá drift.
