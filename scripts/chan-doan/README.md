# scripts/chan-doan — công cụ chẩn đoán lỗi server dev chết im lặng lúc boot (2026-10-23)

Báo cáo: `docs/superpowers/audits/2026-10-23-server-dev-chet-im-lang.md`. Gốc: worker_thread của `pino-pretty` (dev) — ĐÃ VÁ ở `server/logger.ts`. :3000 production không bị.

| Tệp | Việc |
|---|---|
| `boot-lap.mjs` | khởi động `server/_core/index.ts` lặp N lần (spawn node trực tiếp, cổng 3016, DB `_test`), ghi exit code + log; `KEY=VAL` ghi đè env |
| `vite-iso.mjs` | dựng riêng Vite dev server (không app) để loại Vite |
| `diag-report.mjs` | `--import`: ghi `process.report` (sharedObjects) mỗi 4 s — cũng là BỘ KHUẾCH ĐẠI lỗi heap (dev chết 40–50 %) |
| `stub-hook.mjs` + `stub-preload.mjs` | `--import`: thay module ESM (`sharp`, `onnxruntime-node`) bằng stub (`DIAG_STUB=…`) |
| `stub-cjs-preload.mjs` | `--import`: chặn `require()` addon native rollup/lightningcss/oxide (`DIAG_STUB_NATIVE=…`) |
| `diag-boot.patch` | cờ `DIAG_*` cho mã sản phẩm (vite.ts, vite.config.ts, aiGgufEngine.ts, aiLocalKnowledgeService.ts; cờ pretty đồng bộ đã thành mã thật trong logger.ts). **KHÔNG commit**; `git apply scripts/chan-doan/diag-boot.patch` rồi `git restore` sau khi đo |

Ví dụ: `NODE_OPTIONS="--import file:///D:/SOURCES/_ai9_qa/scripts/chan-doan/diag-report.mjs" DIAG_REPORT_OUT=D:/tmp/m.txt node scripts/chan-doan/boot-lap.mjs 30 DIAG_NO_KB_WARM=1 AI_ORCHESTRATION_ENABLED=false EDGE_FACTORY_DRIFT_ALERT=off LOG_JSON=1`

Quy tắc khi GPU đang bận (do-model đo): LUÔN `DIAG_NO_KB_WARM=1` + `AI_ORCHESTRATION_ENABLED=false` + `DIAG_TRACE_LLAMA=1` và kiểm 0 dòng `DIAG getLlama` trong log đã lưu (`BOOT_SAVE_LOG=1`).
