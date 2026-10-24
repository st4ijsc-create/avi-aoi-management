# scripts/chan-doan — công cụ chẩn đoán lỗi server dev chết im lặng lúc boot (2026-10-23)

Báo cáo: `docs/superpowers/audits/2026-10-23-server-dev-chet-im-lang.md`. Gốc: worker_thread của `pino-pretty` (dev) — ĐÃ VÁ ở `server/logger.ts`. :3000 production không bị.

| Tệp | Việc |
|---|---|
| `boot-lap.mjs` | khởi động `server/_core/index.ts` lặp N lần (spawn node trực tiếp, cổng 3016, DB `_test`), ghi exit code + log; `KEY=VAL` ghi đè env |
| `vite-iso.mjs` | dựng riêng Vite dev server (không app) để loại Vite |
| `diag-report.mjs` | `--import`: ghi `process.report` (sharedObjects) mỗi 4 s — cũng là BỘ KHUẾCH ĐẠI lỗi heap (dev chết 40–50 %) |
| `stub-hook.mjs` + `stub-preload.mjs` | `--import`: thay module ESM (`sharp`, `onnxruntime-node`) bằng stub (`DIAG_STUB=…`) |
| `stub-cjs-preload.mjs` | `--import`: chặn `require()` addon native rollup/lightningcss/oxide (`DIAG_STUB_NATIVE=…`) |
| `diag-boot.patch` | cờ `DIAG_*` còn lại cho mã sản phẩm (vite.ts, vite.config.ts, aiGgufEngine.ts — trace `getLlama` `DIAG_TRACE_LLAMA`, bisect Vite); cờ pretty đồng bộ và cờ KB-warm đã thành mã/cờ THẬT. **KHÔNG commit**; `git apply scripts/chan-doan/diag-boot.patch` rồi `git restore` sau khi đo |

Ví dụ: `NODE_OPTIONS="--import file:///D:/SOURCES/_ai9_qa/scripts/chan-doan/diag-report.mjs" DIAG_REPORT_OUT=D:/tmp/m.txt node scripts/chan-doan/boot-lap.mjs 30 DIAG_NO_KB_WARM=1 AI_ORCHESTRATION_ENABLED=false EDGE_FACTORY_DRIFT_ALERT=off LOG_JSON=1`


## Quy ước khi GPU đang bận (do-model đo)

Boot dev/server app BẰNG: `AI_KB_WARM_ON_BOOT=false AI_ORCHESTRATION_ENABLED=false` (boot-lap.mjs đặt sẵn). Hai cờ THẬT, không cần bản vá: cờ thứ nhất chặn `warmUpOllamaModels` (không `warmModel`/`embedQuestion`/`retrieveKnowledge` ⇒ không `getLlama()` ⇒ không nạp CUDA backend + embedder 0.6B ~1,7 GB lúc boot); cờ thứ hai tắt aiWatcher. Mặc định của sản phẩm vẫn BẬT warm (để câu KB đầu không chậm). Muốn CHỨNG MINH 0 lần gọi: áp `diag-boot.patch` (trace `DIAG_TRACE_LLAMA=1`, `BOOT_SAVE_LOG=1`) rồi `grep -l "DIAG getLlama"` trong log đã lưu phải rỗng. Cũng đặt `GGUF_WARM_DEEP_MODEL_ON_BOOT=false`, `LLAMA_SERVER_ENABLED=false`, `LLAMA_WATCHDOG_ENABLED=false` (boot-lap đặt sẵn).
