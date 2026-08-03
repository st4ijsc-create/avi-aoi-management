/**
 * ★★★ PHA 2A TASK 5 — BẢN LIỆT KÊ ĐẦY ĐỦ ĐƯỜNG CẤP PHÁT VRAM. ĐẦU VÀO CHO PHA 2B.
 *
 * Pha 2B cưỡng chế trên `headroom = trần − Σ leaseBytes`. Một hộ tiêu thụ VẮNG MẶT khỏi bảng
 * này là một khối byte mà sổ tưởng còn TRỐNG trong khi thiết bị đã giữ ⇒ cưỡng chế cho phép
 * cấp phát trên byte ma ⇒ OOM. Vì thế bảng liệt kê CẢ hộ ĐÃ NỐI lẫn hộ CHƯA NỐI: `wired: false`
 * không có nghĩa "bỏ qua được", nó có nghĩa "Pha 2B phải quyết định làm gì với nó".
 *
 * ⚠⚠ ĐẾM BẰNG `git grep`, ĐẾM LẠI TỪ ĐẦU MỖI LẦN. Con số này ĐÃ SAI HAI LẦN LIÊN TIẾP ở pha
 * trước vì được cộng dồn trong đầu: "12" (thiếu `aiLlmFinetuneSidecar`) rồi "13" (quên đúng
 * điểm mà chính lượt vá đó vừa thêm — `cuda-backend:reranker`). Lệnh đếm lại:
 *
 *     git grep -n "await beginVramAllocation({" -- server/ | grep -v "\.test\."   # 9
 *     git grep -n "await beginVram({"           -- server/ | grep -v "\.test\."   # 5
 *                                                                              # tổng = 14
 *
 * `beginVram(` là LỚP BỌC nội bộ của `aiGgufEngine.ts:752` và `aiInferenceEngine.ts:22` — đếm
 * lời gọi LỚP BỌC, không đếm hai dòng `beginVramAllocation` bên trong chúng, nếu không sẽ đếm
 * hai lần đúng hai file đó.
 *
 * ⚠ LỊCH SỬ — ĐỌC TRƯỚC KHI TIN BẢNG NÀY: hộ tiêu thụ GPU bị sót ở CẢ BỐN đợt trước (sidecar
 * thị giác 7,8 GB lọt qua 7 task + 7 review ở Đợt 0; ONNX/DirectML + cron 03:00 ở Đợt 2; hộ thứ
 * 7 rồi 8/10/11 ở Pha 1). "Sạch ngay lần đầu" là hình dạng thường gặp của một cuộc quét chưa đủ
 * sâu, KHÔNG phải của một hệ thống đơn giản.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * BẢNG NÀY LÀ MỘT LƯỚI, KHÔNG PHẢI MỘT TÀI LIỆU. `vramAllocationSites.test.ts` quét lại
 * `server/**` và `scripts/**` (đã BỎ chú thích VÀ nội dung chuỗi) rồi đòi kết quả quét KHỚP
 * TỪNG DÒNG với mảng dưới đây. Thêm một điểm cấp phát mới mà không khai báo ⇒ ca test ĐỎ.
 *
 * ⚠ VÌ SAO LIỆT KÊ CẢ `spawn()` KHÔNG DÍNH GPU (pg_dump, aws, psql, ortools, plugin sidecar):
 * một `spawn()` mới KHÔNG tự nói nó có chạm GPU hay không. Bắt mọi `spawn()` phải được PHÂN
 * LOẠI bằng tay là cách duy nhất để một sidecar GPU tương lai không lọt vào im lặng — đúng lớp
 * lỗi đã cho lọt sidecar thị giác 7,8 GB ở Đợt 0.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Số điểm gọi `beginVramAllocation()` (kể cả qua lớp bọc `beginVram()`) trong mã SẢN XUẤT của
 * `server/`. ĐẾM LẠI BẰNG `git grep` — xem hai lệnh ở đầu file.
 *
 * Đếm ngày 2026-08-04 bằng HAI cách độc lập, cùng ra 14:
 *   • `git grep` (9 + 5);
 *   • máy quét cơ học của `vramAllocationSites.test.ts` (bỏ chú thích + nội dung chuỗi).
 */
export const WIRED_ALLOCATION_SITE_COUNT = 14;

/**
 * MỘT DÒNG = MỘT LẦN XUẤT HIỆN của `symbol` trong `file`.
 *
 * `symbol` là ĐÚNG chuỗi mà máy quét tìm (không phải tên hàm bao quanh) — có vậy bảng mới đối
 * chiếu được với kết quả quét. Tên hàm/chủ sở hữu/số dòng nằm trong `note`.
 *
 * `wired`:
 *   • `true`  — lượt cấp phát này nằm TRONG một cửa sổ `beginVramAllocation()`/`commitMeasured()`.
 *   • `false` — KHÔNG có giấy phép nào bao quanh. Gồm cả những dòng KHÔNG chạm GPU (đã ghi rõ
 *               trong `note`) — chúng ở đây để bắt buộc phân loại, không phải vì chúng là hộ.
 *
 * ⚠ Số dòng là số dòng NGÀY VIẾT (2026-08-04) — chúng trôi. `file` + `symbol` mới là khoá.
 */
export const KNOWN_ALLOCATION_SITES: readonly {
  file: string;
  symbol: string;
  wired: boolean;
  note: string;
}[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  // A. server/ — MƯỜI BỐN ĐIỂM ĐÃ NỐI (giấy phép) + lượt cấp phát THẬT mà mỗi điểm bao quanh
  // ───────────────────────────────────────────────────────────────────────────────────────
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "beginVram(",
    wired: true,
    note: ':399 getLlama() → owner "cuda-backend", kind gguf-backend, priority production. Backend CUDA của cả tiến trình. ĐO ĐƯỢC 431,6 MiB (452.591.616 B) trong tiến trình sạch 2026-08-04 — khớp CUDA_BACKEND_FALLBACK_BYTES.',
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "beginVram(",
    wired: true,
    note: ':851 loadGgufModel() → owner "gguf:<modelId>", kind gguf-model, priority interactive. Bao quanh llama.loadModel() ở :861/:888.',
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "beginVram(",
    wired: true,
    note: ':1041 ensureTextContext() → owner "gguf-ctx:<modelId>", kind gguf-context, priority interactive. Bao quanh model.createContext() ở :1046.',
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "beginVram(",
    wired: true,
    note: ':2824 getEmbeddingContext() → owner "gguf-embed-ctx:<modelId>", kind gguf-embed-context, priority background. Bao quanh model.createEmbeddingContext() ở :2830.',
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "getLlama(",
    wired: true,
    note: ":338 khai báo hàm nội bộ `getLlama()`. Lượt khởi tạo backend THẬT (`initLlama` = getLlama của node-llama-cpp) nằm ở :376, BÊN TRONG cửa sổ của giấy phép :399.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: "getLlama(",
    wired: true,
    note: ":841 lời gọi trong loadGgufModel(). Lượt gọi thứ hai trở đi trả thể hiện đã cache (:339) ⇒ không cấp phát thêm; giấy phép :399 chỉ mở đúng một lần cho cả tiến trình.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: ".loadModel(",
    wired: true,
    note: ":861 llama.loadModel({gpuLayers: 'max'}) — lượt nạp CHÍNH, trong cửa sổ giấy phép :851.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: ".loadModel(",
    wired: true,
    note: ":888 llama.loadModel({gpuLayers: 'auto'}) — lượt RETRY sau khi :861 ném OOM (đã evictLRU hết model rảnh). CÙNG giấy phép :851, nên delta đo được là của lượt nạp THÀNH CÔNG.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: ".createContext(",
    wired: true,
    note: ":904 context thường tạo NGAY trong loadGgufModel() (bỏ qua khi config.embeddingOnly). Trong cửa sổ giấy phép :851 — nên actualBytes của `gguf:*` gồm CẢ trọng số LẪN context này.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: ".createContext(",
    wired: true,
    note: ":1046 context LƯỜI của ensureTextContext(), trong cửa sổ giấy phép :1041.",
  },
  {
    file: "server/services/aiGgufEngine.ts",
    symbol: ".createEmbeddingContext(",
    wired: true,
    note: ":2830, trong cửa sổ giấy phép :2824. contextSize = EMBED_CTX (:288, chốt theo GGUF_EMBED_CTX/GGUF_MAX_CTX) — KHÔNG phải 'auto', nên kích thước KHÔNG phụ thuộc dư địa lúc gọi.",
  },
  {
    file: "server/services/aiInferenceEngine.ts",
    symbol: "beginVram(",
    wired: true,
    note: ':181 getSession() → owner "onnx:<code>", kind onnx-session, priority production, releaseProof "unverified". EP theo getExecutionProviders() (:125) — ENABLE_GPU=true trong .env ⇒ DirectML ⇒ CÓ chiếm VRAM.',
  },
  {
    file: "server/services/aiInferenceEngine.ts",
    symbol: "InferenceSession.create(",
    wired: true,
    note: ":192, trong cửa sổ giấy phép :181.",
  },
  {
    file: "server/services/aiImageEmbedding.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':506 getEmbeddingSession() → owner "onnx-img:<code>", kind onnx-session, priority production, releaseProof "unverified".',
  },
  {
    file: "server/services/aiImageEmbedding.ts",
    symbol: "InferenceSession.create(",
    wired: true,
    note: ":521, trong cửa sổ giấy phép :506. ⚠⚠ EP Ở ĐÂY KHÁC hai hộ ONNX kia và đó là chỗ dễ đọc nhầm nhất trong bảng: :493-495 CHỈ đẩy 'cuda' khi ENABLE_CUDA==='true', KHÔNG hề gọi getExecutionProviders() và KHÔNG bao giờ đẩy 'dml'. .env hôm nay có ENABLE_GPU=true nhưng KHÔNG có ENABLE_CUDA ⇒ hộ này chạy CPU, chiếm 0 byte VRAM, trong khi onnx:* và onnx-ocr:* CHẠY DirectML. Đổi đúng MỘT cờ (ENABLE_CUDA=true) là hộ này thành hộ tiêu thụ thật — docstring :439 của chính file đó đã cảnh báo.",
  },
  {
    file: "server/services/ai/ocrService.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':328 getOnnxSession() → owner "onnx-ocr:<modelPath>", kind onnx-session, priority production.',
  },
  {
    file: "server/services/ai/ocrService.ts",
    symbol: "InferenceSession.create(",
    wired: true,
    note: ":337, trong cửa sổ giấy phép :328. CHỈ model `rec` được nạp (:388) — không có session `det` nào trong repo hôm nay.",
  },
  {
    file: "server/services/aiReranker.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':393 getRankingContext() → owner "cuda-backend:reranker", kind gguf-backend, priority background. getLlama() THỨ HAI của tiến trình (thể hiện Llama RIÊNG). fallbackBytes theo cờ RAG_RERANKER_GPU (=false trong .env ⇒ 0).',
  },
  {
    file: "server/services/aiReranker.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':468 getRankingContext() → owner "reranker:<modelPath>", kind gguf-model, priority background. Cửa sổ của nó bao CẢ loadModel(:480) LẪN createRankingContext(:486) — commitMeasured() ở :488.',
  },
  {
    file: "server/services/aiReranker.ts",
    symbol: "getLlama(",
    wired: true,
    note: ":417, trong cửa sổ giấy phép :393 (đóng ngay ở :448 TRƯỚC khi mở cửa sổ model — cố ý, để hai cửa sổ không chồng nhau).",
  },
  {
    file: "server/services/aiReranker.ts",
    symbol: ".loadModel(",
    wired: true,
    note: ":480, trong cửa sổ giấy phép :468. gpuLayers = useGpu ? -1 : 0 — RAG_RERANKER_GPU=false trong .env ⇒ 0 byte VRAM hôm nay.",
  },
  {
    file: "server/services/aiReranker.ts",
    symbol: ".createRankingContext(",
    wired: true,
    note: ":486, trong cửa sổ giấy phép :468.",
  },
  {
    file: "server/services/llamaVisionSidecar.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':255 ensureSidecar() → owner "sidecar:vision", kind external-process, priority interactive, releaseProof "process-exit", ttlMs READY_TIMEOUT_MS. HỘ LỚN NHẤT HỆ (7,8 GB, Đợt 0).',
  },
  {
    file: "server/services/llamaVisionSidecar.ts",
    symbol: "spawn(",
    wired: true,
    note: ":283 spawn(LLAMA_SERVER_BIN, ['-ngl', GPU_LAYERS, ...]) — llama-server CUDA. Trong cửa sổ giấy phép :255. .env: LLAMA_SERVER_BIN=D:/SOURCES/16.AI/llama-cuda/llama-server.exe, LLAMA_VISION_GPU_LAYERS=999.",
  },
  {
    file: "server/services/kbSyncScheduler.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':264 beginEvalGateVram() → owner "cron:kb-eval-gate", kind external-process, releaseProof "process-exit", ttlMs 10 phút. CỐ Ý không commitMeasured().',
  },
  {
    file: "server/services/kbSyncScheduler.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':482 beginKbSyncVram() → owner "cron:kb-sync", kind external-process, ttlMs 30 phút. ⚠ KHÔNG khai releaseProof ⇒ rơi về mặc định "device-disposed", trong khi nó nhả ở nhánh "exit"/"error" của tiến trình con — ĐÚNG ngữ nghĩa "process-exit" mà ba hộ external-process kia đều khai. Ô đó trong nhật ký SAI với hộ này. Ước lượng VRAM_KB_SYNC_ESTIMATE_MB=1251; ĐO ĐƯỢC 2026-08-04: đỉnh 1.367,7 MiB (thấp hơn thực ~8,5%).',
  },
  {
    file: "server/services/kbSyncScheduler.ts",
    symbol: "spawn(",
    wired: true,
    note: ":291 spawn(node, [eval-rag.mjs, '--ci']) — trong cửa sổ giấy phép :264.",
  },
  {
    file: "server/services/kbSyncScheduler.ts",
    symbol: "spawn(",
    wired: true,
    note: ":505 spawn('npm', ['run', 'kb:sync']) — trong cửa sổ giấy phép :482. Kẻ cấp phát THẬT là tiến trình CHÁU (npm → node scripts/ai-kb/embed-incremental.mjs → scripts/ai-kb/_gguf-embed.mjs), nên phạm vi đo BẮT BUỘC là 'descendants' cộng theo CÂY.",
  },
  {
    file: "server/services/localSidecarTrainer.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':353 beginTrainerVram() → owner "sidecar:local-trainer", kind external-process, releaseProof "process-exit", ttlMs 2 GIỜ. CỐ Ý không commitMeasured().',
  },
  {
    file: "server/services/localSidecarTrainer.ts",
    symbol: "spawn(",
    wired: true,
    note: ":298 spawn(LOCAL_TRAINER_CMD) — .env: `python tools/trainer/train.py`. Trong cửa sổ giấy phép :353.",
  },
  {
    file: "server/services/aiLlmFinetuneSidecar.ts",
    symbol: "beginVramAllocation(",
    wired: true,
    note: ':466 beginFinetuneVram() → owner "sidecar:llm-finetune", kind external-process, releaseProof "process-exit", ttlMs 4 GIỜ (trần lớn nhất hệ). CỐ Ý không commitMeasured().',
  },
  {
    file: "server/services/aiLlmFinetuneSidecar.ts",
    symbol: "spawn(",
    wired: true,
    note: ":425 spawn(LLM_FINETUNE_CMD) — CHƯA đặt trong .env hôm nay ⇒ đường này bất động. Trong cửa sổ giấy phép :466.",
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  // B. server/ — CHƯA NỐI. Đây là phần Pha 2B phải quyết định.
  // ───────────────────────────────────────────────────────────────────────────────────────
  {
    file: "server/services/aiLocalTraining.ts",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":130 trainClassifierHead() — executionProviders GHIM CỨNG ['cpu'] ⇒ 0 byte VRAM hôm nay. KHÔNG nối là ĐÚNG. ⚠ Đổi một chữ 'cpu' thành 'dml'/'cuda' là sinh ra một hộ tiêu thụ VÔ HÌNH — bốn dòng này ở đây để lượt đổi đó không im lặng.",
  },
  {
    file: "server/services/aiLocalTraining.ts",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":387 trainFewShot() — executionProviders ['cpu']. Cùng lý do như :130.",
  },
  {
    file: "server/services/aiLocalTraining.ts",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":564 trainIncremental() — executionProviders ['cpu']. Cùng lý do như :130.",
  },
  {
    file: "server/services/aiLocalTraining.ts",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":882 classifyWithHead() — executionProviders ['cpu']. Cùng lý do như :130. ⚠ File này có NĂM lời gọi session.release() (:332, :504, :765, :889, :954) ⇒ câu trong vramWiring.ts:49 — 'grep toàn repo: KHÔNG một lời gọi .release() nào lên ort.InferenceSession' — SAI NHƯ ĐANG VIẾT. Nó chỉ còn đúng nếu thu hẹp thành 'không session CÓ KHẢ NĂNG GPU nào được release' (aiInferenceEngine/aiImageEmbedding/ocrService). Kết luận releaseProof='unverified' của ba hộ đó KHÔNG đổi; chỉ câu chữ chống lưng cho nó là quá rộng.",
  },
  {
    file: "server/services/plugins/sidecar/nodeSpawner.ts",
    symbol: "spawn(",
    wired: false,
    note: ":42 createSupervisedTransportSpawner() — spawn LỆNH TUỲ Ý do plugin khai (PLUGIN_SIDECAR_CMD / manifest). KHÔNG có giấy phép. Cổng PLUGIN_SIDECAR mặc định OFF và KHÔNG đặt trong .env hôm nay ⇒ bất động. ⚠ Pha 2B: một plugin GPU nạp qua đường này là hộ tiêu thụ mà sổ KHÔNG THỂ biết trước kích thước.",
  },
  {
    file: "server/services/plugins/sidecar/nodeSpawner.ts",
    symbol: "spawn(",
    wired: false,
    note: ":47 spawnSidecarWithTransport() — cùng lớp với :42.",
  },
  {
    file: "server/services/plugins/sidecar/nodeSpawner.ts",
    symbol: "spawn(",
    wired: false,
    note: ":65 createNodeSpawner() — cùng lớp với :42.",
  },
  {
    file: "server/services/apsSolver.ts",
    symbol: "spawn(",
    wired: false,
    note: ":276 runApsSolver() → APS_SOLVER_CMD, mặc định .venv python + scripts/aps_solver.py (CP-SAT / OR-Tools). Solver tổ hợp CHẠY CPU — KHÔNG phải hộ tiêu thụ VRAM. Ở đây để bắt buộc phân loại.",
  },
  {
    file: "server/services/backupService.ts",
    symbol: "spawn(",
    wired: false,
    note: ":397 spawn(pg_dump) — KHÔNG chạm GPU.",
  },
  {
    file: "server/services/backupService.ts",
    symbol: "spawn(",
    wired: false,
    note: ":578 spawn(psql) — KHÔNG chạm GPU.",
  },
  {
    file: "server/services/backupReplicationService.ts",
    symbol: "spawn(",
    wired: false,
    note: ":87 spawn('aws', …) — KHÔNG chạm GPU.",
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  // C. scripts/ — CHẠY NGOÀI TIẾN TRÌNH API. Sổ cái là BIẾN TRONG BỘ NHỚ của MỘT tiến trình,
  //    nên KHÔNG script nào dưới đây được ghi vào sổ của tiến trình API, kể cả khi mã nó đi
  //    qua đúng `beginVramAllocation()`. Hai script được tiến trình API SPAWN thì được phủ
  //    GIÁN TIẾP bằng giấy phép `external-process` (phạm vi đo `descendants`); phần còn lại
  //    KHÔNG được phủ bởi bất cứ thứ gì.
  // ───────────────────────────────────────────────────────────────────────────────────────
  {
    file: "scripts/ai-kb/_gguf-embed.mjs",
    symbol: "getLlama(",
    wired: true,
    note: ':73 — module nhúng DÙNG CHUNG. NĂM đường vào, chỉ HAI được giấy phép phủ: embed-incremental.mjs (trong chuỗi kb:sync ⇒ nằm trong `cron:kb-sync`) và eval-rag.mjs --ci (⇒ `cron:kb-eval-gate`). BA đường CHẠY TAY KHÔNG được phủ: generate-embeddings.mjs (`npm run kb:embed`), backfill-image-embeddings.mjs, verify-embedding-cosine.mjs.',
  },
  {
    file: "scripts/ai-kb/_gguf-embed.mjs",
    symbol: ".loadModel(",
    wired: true,
    note: ":75 gpuLayers -1. ⚠ `-1` ĐÚNG LÀ ĐÁNG NGỜ — aiGgufEngine.ts:864-865 ghi rõ node-llama-cpp 3.x hiểu -1 là 0 lớp (CPU im lặng) và CẤM truyền -1. Nhưng ở ĐÂY nó VẪN LÊN GPU: đo trực tiếp 2026-08-04 trong cửa sổ cron THẬT (chạy `npm run kb:sync` bằng tay, lấy mẫu PDH lúc đang chạy) — tiến trình `node scripts/ai-kb/embed-incremental.mjs` (pid 38492) giữ 1.167,7 → đỉnh 1.367,7 MiB VRAM. Vậy hoặc ngữ nghĩa -1 khác với ghi chú kia, hoặc ghi chú kia chỉ đúng cho createContext. Số ĐO thắng; ước lượng VRAM_KB_SYNC_ESTIMATE_MB=1251 vì thế là con số ĐÚNG BẬC, không phải may.",
  },
  {
    file: "scripts/ai-kb/_gguf-embed.mjs",
    symbol: ".createEmbeddingContext(",
    wired: true,
    note: ":87 contextSize = min(GGUF_EMBED_CTX, GGUF_MAX_CTX) — CÓ CHẶN TRÊN, cùng công thức với EMBED_CTX của aiGgufEngine.",
  },
  {
    file: "scripts/ai-kb/eval-rag.mjs",
    symbol: "getLlama(",
    wired: true,
    note: ":211 gpu 'auto'. Chạy dưới `cron:kb-eval-gate` (kbSyncScheduler:291, cờ --ci) ⇒ wired gián tiếp. `npm run kb:eval` chạy tay thì KHÔNG.",
  },
  {
    file: "scripts/ai-kb/eval-rag.mjs",
    symbol: ".loadModel(",
    wired: true,
    note: ":221 gpuLayers -1 — model RERANK/sinh chữ, cộng thêm vào cùng tiến trình con.",
  },
  {
    file: "scripts/ai-kb/eval-rag.mjs",
    symbol: ".createContext(",
    wired: true,
    note: ":222 contextSize { min: 2048, max: 8192 } — CÓ CHẶN TRÊN.",
  },
  {
    file: "scripts/ai-kb/embed-programming.mjs",
    symbol: "getLlama(",
    wired: false,
    note: ":101 gpu 'auto'. KHÔNG có mục nào trong package.json và KHÔNG được server spawn ⇒ chỉ chạy TAY. Không giấy phép nào phủ.",
  },
  {
    file: "scripts/ai-kb/embed-programming.mjs",
    symbol: ".loadModel(",
    wired: false,
    note: ":102 gpuLayers 'max'.",
  },
  {
    file: "scripts/ai-kb/embed-programming.mjs",
    symbol: ".createEmbeddingContext(",
    wired: false,
    note: ":103 ⚠⚠ contextSize: \"auto\" — KHÔNG CÓ CHẶN TRÊN. node-llama-cpp co giãn context theo VRAM CÒN TRỐNG lúc gọi. ĐO ĐƯỢC 2026-08-04 trên máy rảnh: cùng model 0,6B, contextSize 'auto' chiếm 3.916,1 MiB (so với 526,0 MiB khi chốt bằng EMBED_CTX). Với Pha 2B đây là lớp hộ NGUY HIỂM NHẤT: nó không có kích thước để ước lượng, nó ĂN ĐÚNG BẰNG dư địa mà broker vừa chừa ra.",
  },
  {
    file: "scripts/ai-kb/reembed-images-onnx.mjs",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":184 executionProviders động (providers). Chỉ chạy TAY — không có mục package.json, không được server spawn.",
  },
  {
    file: "scripts/ai-bench/bench.mjs",
    symbol: "getLlama(",
    wired: false,
    note: ":584 gpu theo cờ. `npm run ai:bench` — chỉ chạy TAY. Chính công cụ đo này từng MÙ ba lần (Đợt 0/1) nên nó phải nằm trong bảng.",
  },
  {
    file: "scripts/ai-bench/bench.mjs",
    symbol: ".loadModel(",
    wired: false,
    note: ":618 gpuLayers 'max' khi bật GPU.",
  },
  {
    file: "scripts/ai-bench/bench.mjs",
    symbol: ".createContext(",
    wired: false,
    note: ":329 context thường.",
  },
  {
    file: "scripts/ai-bench/bench.mjs",
    symbol: ".createEmbeddingContext(",
    wired: false,
    note: ":420 context nhúng — bench cố ý tạo context THƯỜNG (:329) TRƯỚC context nhúng để tái hiện đúng bug hụt 2.030 MiB của Đợt 1 Task 2.",
  },
  {
    file: "scripts/check-tier3-env.mjs",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":171 EP ['cpu'] — không VRAM.",
  },
  {
    file: "scripts/check-tier3-env.mjs",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":181 EP ['dml'] — CÓ chiếm VRAM. Script chẩn đoán, chạy tay.",
  },
  {
    file: "scripts/check-tier3-env.mjs",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":193 EP ['cuda'] — CÓ chiếm VRAM nếu EP nạp được. Script chẩn đoán, chạy tay.",
  },
  {
    file: "scripts/validate-models.mjs",
    symbol: "InferenceSession.create(",
    wired: false,
    note: ":38 EP ['cpu'] — không VRAM.",
  },
  {
    file: "scripts/ai-kb/run-phase1.mjs",
    symbol: "spawn(",
    wired: false,
    note: ":1 import — spawn các bước kb khác (kb:phase1). Bản thân không nạp model; các bước con thì có (xem _gguf-embed.mjs). Chạy tay.",
  },
  {
    file: "scripts/plugin-scaffold.mjs",
    symbol: "spawn(",
    wired: false,
    note: "công cụ scaffold — KHÔNG chạm GPU.",
  },
  {
    file: "scripts/sim/sim-devices.mjs",
    symbol: "spawn(",
    wired: false,
    note: "trình mô phỏng thiết bị — KHÔNG chạm GPU.",
  },
  {
    file: "scripts/verify/worker-leader-proof.run.mjs",
    symbol: "spawn(",
    wired: false,
    note: "kiểm chứng bầu leader — KHÔNG chạm GPU.",
  },
];

/**
 * ★★★ HỘ TIÊU THỤ KHÔNG CÓ ĐIỂM CẤP PHÁT NÀO TRONG REPO — máy quét KHÔNG THỂ thấy chúng, nên
 * chúng phải được viết ra bằng tay. Bỏ chúng khỏi Pha 2B là lặp lại đúng lỗi Đợt 0.
 *
 * 1. **Bộ đệm tính toán LƯỜI của llama.cpp** — ĐO ĐƯỢC, và không nằm trong sổ.
 *    llama.cpp cấp phát compute buffer ở lượt SUY LUẬN ĐẦU TIÊN, tức SAU `commitMeasured()`.
 *    `aiGgufEngine.ts:915-919` đã ghi điều này cho `gguf-model` nhưng KHÔNG ai cộng nó.
 *    ĐO TRỰC TIẾP 2026-08-04 (tiến trình sạch, cùng bộ đếm PDH mà vramProcessProbe dùng):
 *      getLlama 431,6 → loadModel(0,6B) 1.569,6 → createEmbeddingContext 5.485,7 →
 *      **lượt nhúng ĐẦU TIÊN +132,0 MiB** → 5.617,8 MiB (đứng yên sau đó).
 *    Đối chứng phía tiến trình API cùng ngày: PDH self 2.223,7 MiB vs Σ sổ 2.095,7 MiB
 *    (431,6 + 1.138,0 + 526,0) = **lệch 128,0 MiB** — cùng bậc độ lớn, cùng dấu.
 *    ⚠ NÓI ĐÚNG PHẠM VI: 132,0 MiB là số ĐO ĐƯỢC của cơ chế; 128,0 MiB là số ĐO ĐƯỢC của
 *    khoảng lệch. Nhật ký phiên đó KHÔNG ghi lượt nhúng nào, nên "hai con số này là CÙNG một
 *    khối byte" là điều tôi **CHƯA chứng minh được**, chỉ mới cho thấy chúng khớp nhau.
 *
 * 2. **Tiến trình `worker` (`server/worker.ts` → `runWorkerProcess`)** — sổ cái là biến trong
 *    bộ nhớ của MỘT tiến trình. Chạy `ROLE=worker` là có HAI sổ độc lập trên MỘT thiết bị, mỗi
 *    sổ chỉ thấy nửa của mình. Pha 1 đã ghi nhận ("ROLE=api ⇒ sổ MỘT tiến trình trong khi hệ
 *    chạy NĂM"); nó vẫn CHƯA được giải, và Pha 2B cưỡng chế trên một trong hai sổ đó.
 *
 * 3. **`llama-server` bền bỉ khởi động BẰNG TAY** (`LLAMA_SERVER_ENABLED` + runbook
 *    `scripts/ai/llama-server.md`; và `LLAMA_CODER_PORT=8090` có trong .env nhưng KHÔNG dòng mã
 *    nào trong repo đọc `LLAMA_CODER_PORT`/`LLAMA_CODER_BIN`). Không có `spawn()` nào trong
 *    repo tạo ra chúng ⇒ không máy quét nào tìm được ⇒ với sổ, VRAM của chúng nằm trong "nền".
 *
 * 4. **whisper.cpp qua `kbVideoTranscriber.ts:361`** (`runSidecar(cfg.whisperBin, …)`).
 *    KHÔNG có giấy phép. `VIDEO_INGEST_ENABLED=true` trong .env nhưng `WHISPER_BIN` còn bị
 *    chú thích ⇒ bất động HÔM NAY. Một bản whisper.cpp dựng với CUDA là hộ tiêu thụ thật.
 *    (Không lọt vào bảng trên vì file này dùng `execFile`, không dùng `spawn`; `ffmpeg` cùng
 *    file KHÔNG có `-hwaccel` nên giải mã bằng CPU.)
 *
 * 5. **Nền desktop Windows** — dwm.exe 865,9 MiB + trình duyệt/VS Code/Docker ≈ 1.700 MiB tổng
 *    lúc rảnh (đo 2026-08-04). Không phải của ta, nhưng nó ĂN vào cùng 32.607 MiB.
 *    ⚠ BA cron cùng nổ lúc 03:00 (`KB_AUTOSYNC_CRON`, `ANOMALY_BANK_REBUILD_CRON`,
 *    `AI_SELF_LEARNING_CRON` — cả ba đều BẬT trong .env), nhưng ĐÃ KIỂM: chỉ `kbSyncScheduler`
 *    là đường GPU. `aiAnomalyBankScheduler` đọc vector ĐÃ LƯU trong `ai_image_embeddings`
 *    (docstring :4) và `aiSelfLearningScheduler` thuần DB/thống kê — không lượt suy luận nào.
 *    Nói ra ở đây vì "ba cron 03:00" rất dễ bị đọc thành "ba hộ tiêu thụ 03:00".
 */
export const CONSUMERS_WITHOUT_A_CODE_SITE = 5 as const;
