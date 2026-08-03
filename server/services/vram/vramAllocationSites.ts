/**
 * ★★★ PHA 2A TASK 5 — BẢN LIỆT KÊ ĐẦY ĐỦ ĐƯỜNG CẤP PHÁT VRAM. ĐẦU VÀO CHO PHA 2B.
 *
 * Pha 2B cưỡng chế trên `headroom = trần − Σ leaseBytes`. Một hộ tiêu thụ VẮNG MẶT khỏi bảng
 * này là một khối byte mà sổ tưởng còn TRỐNG trong khi thiết bị đã giữ ⇒ cưỡng chế cho phép cấp
 * phát trên byte ma ⇒ OOM. Vì thế bảng liệt kê CẢ hộ ĐÃ NỐI lẫn hộ CHƯA NỐI, và cả những dòng
 * KHÔNG chạm GPU: `wired: false` không có nghĩa "bỏ qua được", nó có nghĩa "phải phân loại".
 *
 * ⚠⚠ ĐẾM BẰNG `git grep`, ĐẾM LẠI TỪ ĐẦU MỖI LẦN. Con số này ĐÃ SAI HAI LẦN LIÊN TIẾP ở pha
 * trước vì được cộng dồn trong đầu: "12" (thiếu `aiLlmFinetuneSidecar`) rồi "13" (quên đúng điểm
 * mà chính lượt vá đó vừa thêm — `cuda-backend:reranker`).
 *
 *     git grep -nE "beginVram(Allocation)?[[:space:]]*\(" -- server/ | grep -v "\.test\."
 *
 * cho **19** lần xuất hiện; trừ **5** lần KHÔNG PHẢI điểm gọi (xem
 * `PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES`) ⇒ **14** điểm gọi.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢNG NÀY LÀ MỘT LƯỚI, KHÔNG PHẢI TÀI LIỆU — VÀ LƯỚI ĐÓ ĐÃ TỪNG THỦNG.
 *
 * `vramAllocationSites.test.ts` quét lại `server/**` + `scripts/**` rồi đòi kết quả khớp TỪNG
 * DÒNG. Bản ĐẦU TIÊN của lưới **để một sidecar GPU đi qua**: reviewer thêm
 * `cp.spawn("llama-server.exe", ["-ngl","999"])` và `execFile("whisper-cuda.exe", …)` ⇒ 7/7 xanh.
 * Nguyên nhân: mẫu `spawn(` chặn dạng gọi thành viên, và `execFile(` vắng mặt — dù whisper.cpp
 * đã được GỌI TÊN trong chính báo cáo của task này.
 *
 * Bản này quét HAI LỚP: mẫu LỜI GỌI (cấp phát ở đâu) + mẫu MODULE `child_process` (file nào CÓ
 * KHẢ NĂNG sinh tiến trình con). Lớp thứ hai là lớp DUY NHẤT bắt được `promisify(execFile)` —
 * đúng cách `kbVideoTranscriber.ts` (whisper) và `kbPdfOcr.ts` gọi. Trước lượt vá này cả hai file
 * đó **không hề xuất hiện** trong bảng.
 *
 * ⚠ KHÔNG TUYÊN BỐ lưới này đóng được lớp lỗi sidecar 7,8 GB của Đợt 0. Bản trước có tuyên bố đó
 * và nó SAI. Xem `CONSUMERS_WITHOUT_A_CODE_SITE` và khối "không bắt được gì" ở đầu file test.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Số **ĐIỂM GỌI** `beginVramAllocation()` (kể cả qua lớp bọc `beginVram()`) trong mã sản xuất
 * của `server/`. Không phải số lần xuất hiện của ký hiệu — xem docstring đầu file.
 *
 * Đếm lại ngày 2026-08-04 bằng HAI cách độc lập sau khi nới mẫu quét (I-7), cùng ra 14.
 */
export const WIRED_ALLOCATION_SITE_COUNT = 14;

/**
 * ★★ HAI CÁI BẪY ĐẾM-HAI-LẦN, khai TƯỜNG MINH thay vì lọc ngầm bằng regex.
 *
 * Sau khi mẫu quét bỏ ràng buộc `\(\s*\{` (I-7), ký hiệu giấy phép còn khớp thêm hai thứ KHÔNG
 * phải điểm gọi: **khai báo hàm** và **pass-through bên trong lớp bọc**. Đếm chúng vào là báo
 * thừa 5 hộ; lọc chúng bằng một regex kiểu "bỏ dòng có `function`" thì một ngày nào đó sẽ lặng
 * lẽ nuốt một điểm gọi THẬT. Nên: liệt kê từng cái, và ca `3b` bắt buộc mỗi cái phải còn tồn tại.
 */
export const PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES: readonly {
  file: string;
  symbol: string;
  why: string;
}[] = [
  { file: "server/services/vram/vramWiring.ts", symbol: "beginVramAllocation(", why: ":397 KHAI BÁO hàm — nơi định nghĩa, không phải nơi gọi." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", why: ":752 KHAI BÁO lớp bọc nội bộ `beginVram()`." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVramAllocation(", why: ":757 PASS-THROUGH bên trong lớp bọc — đếm nó là đếm hai lần cùng bốn điểm gọi của file này." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", why: ":22 KHAI BÁO lớp bọc nội bộ `beginVram()`." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVramAllocation(", why: ":27 PASS-THROUGH bên trong lớp bọc." },
];

/**
 * MỘT DÒNG = MỘT LẦN XUẤT HIỆN của `symbol` trong `file` (120 dòng / 2026-08-04).
 *
 * `symbol` là ĐÚNG khoá mà máy quét dùng, không phải tên hàm bao quanh — có vậy bảng mới đối
 * chiếu được. Tên hàm / chủ sở hữu / số dòng nằm trong `note`.
 *
 * `wired`:
 *   • `true`  — lượt cấp phát này nằm TRONG một cửa sổ `beginVramAllocation()`/`commitMeasured()`,
 *               hoặc chính là điểm mở giấy phép.
 *   • `false` — KHÔNG giấy phép nào bao quanh. Gồm cả những dòng KHÔNG chạm GPU (ghi rõ trong
 *               `note`) — chúng ở đây để BẮT BUỘC phân loại, không phải vì chúng là hộ.
 *
 * ⚠ `wired: true` chỉ nói "có giấy phép", KHÔNG nói "số đúng". Ví dụ sống: `gguf-embed-ctx` có
 * giấy phép, commit 526,0 MiB, và vẫn thiếu ~128 MiB bộ đệm lười (xem khối cuối file).
 *
 * ⚠ Số dòng đúng ở **2026-08-04** và sẽ trôi. Khoá đối chiếu là `file` + `symbol`.
 */
export const KNOWN_ALLOCATION_SITES: readonly {
  file: string;
  symbol: string;
  wired: boolean;
  note: string;
}[] = [
  // ═════════════════════════════════════════════════════════════════════════════════════════
  // A. server/ — 14 ĐIỂM MỞ GIẤY PHÉP + 5 lần xuất hiện KHÔNG phải điểm gọi
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/vram/vramWiring.ts", symbol: "beginVramAllocation(", wired: true, note: ":397 KHAI BÁO hàm — không phải điểm gọi. Xem PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ":752 KHAI BÁO lớp bọc nội bộ — không phải điểm gọi (nuốt lỗi rồi uỷ quyền cho vramWiring)." },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVramAllocation(", wired: true, note: ":757 PASS-THROUGH trong lớp bọc `beginVram()` — không phải điểm gọi độc lập." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", wired: true, note: ":22 KHAI BÁO lớp bọc nội bộ — không phải điểm gọi." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVramAllocation(", wired: true, note: ":27 PASS-THROUGH trong lớp bọc `beginVram()` — không phải điểm gọi độc lập." },

  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':399 ĐIỂM GỌI 1/14 — owner "cuda-backend", gguf-backend, production. Backend CUDA của cả tiến trình. ĐO ĐƯỢC 431,6 MiB trong tiến trình sạch 2026-08-04.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':851 ĐIỂM GỌI 2/14 — owner "gguf:<modelId>", gguf-model, interactive. Bao quanh llama.loadModel() ở :861/:888 VÀ model.createContext() ở :904.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':1041 ĐIỂM GỌI 3/14 — owner "gguf-ctx:<modelId>", gguf-context, interactive. Bao quanh createContext() LƯỜI ở :1046.' },
  { file: "server/services/aiGgufEngine.ts", symbol: "beginVram(", wired: true, note: ':2824 ĐIỂM GỌI 4/14 — owner "gguf-embed-ctx:<modelId>", gguf-embed-context, background. Bao quanh createEmbeddingContext() ở :2830.' },
  { file: "server/services/aiInferenceEngine.ts", symbol: "beginVram(", wired: true, note: ':181 ĐIỂM GỌI 5/14 — owner "onnx:<code>", onnx-session, production, releaseProof "unverified". EP = DirectML vì ENABLE_GPU=true.' },
  { file: "server/services/aiImageEmbedding.ts", symbol: "beginVramAllocation(", wired: true, note: ':506 ĐIỂM GỌI 6/14 — owner "onnx-img:<code>", onnx-session, production, releaseProof "unverified".' },
  { file: "server/services/ai/ocrService.ts", symbol: "beginVramAllocation(", wired: true, note: ':328 ĐIỂM GỌI 7/14 — owner "onnx-ocr:<modelPath>", onnx-session, production.' },
  { file: "server/services/aiReranker.ts", symbol: "beginVramAllocation(", wired: true, note: ':393 ĐIỂM GỌI 8/14 — owner "cuda-backend:reranker", gguf-backend, background. getLlama() THỨ HAI của tiến trình (thể hiện Llama RIÊNG). fallbackBytes theo RAG_RERANKER_GPU (=false ⇒ 0).' },
  { file: "server/services/aiReranker.ts", symbol: "beginVramAllocation(", wired: true, note: ':468 ĐIỂM GỌI 9/14 — owner "reranker:<modelPath>", gguf-model, background. Cửa sổ bao CẢ loadModel(:480) LẪN createRankingContext(:486); commitMeasured() ở :488.' },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "beginVramAllocation(", wired: true, note: ':255 ĐIỂM GỌI 10/14 — owner "sidecar:vision", external-process, interactive, releaseProof "process-exit". HỘ LỚN NHẤT HỆ (7,8 GB, Đợt 0).' },
  { file: "server/services/kbSyncScheduler.ts", symbol: "beginVramAllocation(", wired: true, note: ':264 ĐIỂM GỌI 11/14 — owner "cron:kb-eval-gate", external-process, releaseProof "process-exit", ttl 10 phút. CỐ Ý không commitMeasured().' },
  { file: "server/services/kbSyncScheduler.ts", symbol: "beginVramAllocation(", wired: true, note: ':482 ĐIỂM GỌI 12/14 — owner "cron:kb-sync", ttl 30 phút. ⚠ KHÔNG khai releaseProof ⇒ mặc định "device-disposed", SAI ngữ nghĩa (nó nhả ở nhánh exit/error của tiến trình con). Ước lượng 1251 MiB; ĐO ĐƯỢC đỉnh 1.367,7 MiB.' },
  { file: "server/services/localSidecarTrainer.ts", symbol: "beginVramAllocation(", wired: true, note: ':353 ĐIỂM GỌI 13/14 — owner "sidecar:local-trainer", external-process, releaseProof "process-exit", ttl 2 GIỜ. CỐ Ý không commitMeasured().' },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "beginVramAllocation(", wired: true, note: ':466 ĐIỂM GỌI 14/14 — owner "sidecar:llm-finetune", external-process, releaseProof "process-exit", ttl 4 GIỜ (trần lớn nhất hệ).' },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // B. server/ — lượt cấp phát THẬT nằm TRONG cửa sổ giấy phép
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/aiGgufEngine.ts", symbol: "getLlama(", wired: true, note: ":338 KHAI BÁO hàm nội bộ `getLlama()`. Lượt khởi tạo backend THẬT (initLlama của node-llama-cpp) ở :376, BÊN TRONG cửa sổ giấy phép :399." },
  { file: "server/services/aiGgufEngine.ts", symbol: "getLlama(", wired: true, note: ":841 lời gọi trong loadGgufModel(). Lượt thứ hai trở đi trả thể hiện đã cache (:339) ⇒ không cấp phát thêm; giấy phép :399 chỉ mở đúng một lần cho cả tiến trình." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".loadModel(", wired: true, note: ":861 llama.loadModel({gpuLayers:'max'}) — lượt nạp CHÍNH, trong cửa sổ giấy phép :851." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".loadModel(", wired: true, note: ":888 llama.loadModel({gpuLayers:'auto'}) — lượt RETRY sau khi :861 ném OOM (đã evictLRU hết model rảnh). CÙNG giấy phép :851." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createContext(", wired: true, note: ":904 context thường tạo NGAY trong loadGgufModel() (bỏ qua khi embeddingOnly). Trong cửa sổ :851 ⇒ actualBytes của `gguf:*` gồm CẢ trọng số LẪN context này." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createContext(", wired: true, note: ":1046 context LƯỜI của ensureTextContext(), trong cửa sổ giấy phép :1041." },
  { file: "server/services/aiGgufEngine.ts", symbol: ".createEmbeddingContext(", wired: true, note: ":2830, trong cửa sổ :2824. contextSize = EMBED_CTX (:288, chốt theo GGUF_EMBED_CTX/GGUF_MAX_CTX) — KHÔNG phải 'auto', nên kích thước KHÔNG phụ thuộc dư địa lúc gọi." },
  { file: "server/services/aiInferenceEngine.ts", symbol: "InferenceSession.create(", wired: true, note: ":192, trong cửa sổ giấy phép :181. EP từ getExecutionProviders() (:125) — ENABLE_GPU=true ⇒ DirectML ⇒ CÓ chiếm VRAM." },
  { file: "server/services/aiImageEmbedding.ts", symbol: "InferenceSession.create(", wired: true, note: ":521, trong cửa sổ :506. ⚠⚠ EP Ở ĐÂY KHÁC hai hộ ONNX kia: :493-495 CHỈ đẩy 'cuda' khi ENABLE_CUDA==='true', KHÔNG gọi getExecutionProviders() và KHÔNG BAO GIỜ đẩy 'dml'. .env hôm nay có ENABLE_GPU=true nhưng KHÔNG có ENABLE_CUDA ⇒ hộ này chạy CPU, 0 byte, trong khi onnx:* và onnx-ocr:* chạy DirectML. Đổi đúng MỘT cờ là nó thành hộ thật — docstring :439 đã cảnh báo." },
  { file: "server/services/ai/ocrService.ts", symbol: "InferenceSession.create(", wired: true, note: ":337, trong cửa sổ :328. CHỈ model `rec` được nạp (:388) — không có session `det` nào trong repo hôm nay." },
  { file: "server/services/aiReranker.ts", symbol: "getLlama(", wired: true, note: ":417, trong cửa sổ giấy phép :393 (đóng ngay ở :448 TRƯỚC khi mở cửa sổ model — cố ý, để hai cửa sổ không chồng nhau)." },
  { file: "server/services/aiReranker.ts", symbol: ".loadModel(", wired: true, note: ":480, trong cửa sổ :468. gpuLayers = useGpu ? -1 : 0 — RAG_RERANKER_GPU=false trong .env ⇒ 0 byte VRAM hôm nay." },
  { file: "server/services/aiReranker.ts", symbol: ".createRankingContext(", wired: true, note: ':486 ⚠⚠ contextSize:"auto" — ĐIỂM "auto" THỨ HAI, và là điểm DUY NHẤT nằm trong MÃ SẢN XUẤT (I-1 review vòng 1; bản trước của tôi khẳng định chỉ có một, ở scripts/ — SAI). Mở khoá bằng RAG_RERANKER_GPU=true. ⚠ "ĐÃ NỐI" KHÔNG cứu được lớp này: giấy phép ĐO SAU khi cấp phát xong, còn cưỡng chế phải quyết định TRƯỚC — không có con số nào để từ chối dựa vào.' },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "child_process", wired: true, note: ":30 import spawn — tiến trình con là llama-server CUDA, nằm trong giấy phép :255." },
  { file: "server/services/llamaVisionSidecar.ts", symbol: "spawn(", wired: true, note: ":283 spawn(LLAMA_SERVER_BIN, ['-ngl', GPU_LAYERS, …]). .env: LLAMA_SERVER_BIN=D:/SOURCES/16.AI/llama-cuda/llama-server.exe, LLAMA_VISION_GPU_LAYERS=999. Trong cửa sổ :255." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "child_process", wired: true, note: ":63 import spawn — hai lượt spawn của file này đều nằm trong giấy phép (:264 / :482)." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "spawn(", wired: true, note: ":291 spawn(node, [eval-rag.mjs, '--ci']) — trong cửa sổ giấy phép :264." },
  { file: "server/services/kbSyncScheduler.ts", symbol: "spawn(", wired: true, note: ":505 spawn('npm', ['run','kb:sync']) — trong cửa sổ :482. Kẻ cấp phát THẬT là tiến trình CHÁU (npm → node embed-incremental.mjs → _gguf-embed.mjs), nên phạm vi đo BẮT BUỘC cộng theo CÂY." },
  { file: "server/services/localSidecarTrainer.ts", symbol: "child_process", wired: true, note: ":29 import spawn — tiến trình huấn luyện nằm trong giấy phép :353." },
  { file: "server/services/localSidecarTrainer.ts", symbol: "spawn(", wired: true, note: ":298 spawn(LOCAL_TRAINER_CMD) — .env: `python tools/trainer/train.py`. Trong cửa sổ :353." },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "child_process", wired: true, note: ":92 import spawn — tiến trình fine-tune nằm trong giấy phép :466." },
  { file: "server/services/aiLlmFinetuneSidecar.ts", symbol: "spawn(", wired: true, note: ":425 spawn(LLM_FINETUNE_CMD) — CHƯA đặt trong .env ⇒ đường này bất động hôm nay. Trong cửa sổ :466." },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // C. server/ — CHƯA NỐI. Phần Pha 2B phải quyết định.
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "server/services/kbVideoTranscriber.ts", symbol: "child_process", wired: false, note: '★★ :55 import execFile → promisify → execFileAsync(:212) chạy WHISPER.CPP (:361) và ffmpeg (:337). KHÔNG giấy phép nào. Một bản whisper.cpp dựng với CUDA là hộ tiêu thụ THẬT. VIDEO_INGEST_ENABLED=true trong .env nhưng WHISPER_BIN còn bị chú thích ⇒ bất động HÔM NAY. ffmpeg KHÔNG có -hwaccel ⇒ giải mã CPU. ⚠ File này CHỈ xuất hiện được nhờ mẫu MODULE: mọi lời gọi đi qua alias promisify nên không mẫu tên-hàm nào bắt được (đây chính là lỗ C-1).' },
  { file: "server/services/kbPdfOcr.ts", symbol: "child_process", wired: false, note: ":48 import execFile → promisify → runPdftoppm(:181) chạy pdftoppm/poppler. Kết xuất ảnh CPU, KHÔNG chạm GPU. (Ảnh sau đó đi vào ocrService — hộ ĐÃ NỐI.) PDFTOPPM_BIN chưa đặt trong .env." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":130 trainClassifierHead() — executionProviders GHIM CỨNG ['cpu'] ⇒ 0 byte VRAM. KHÔNG nối là ĐÚNG. ⚠ Đổi một chữ 'cpu' thành 'dml'/'cuda' là sinh một hộ VÔ HÌNH — bốn dòng này ở đây để lượt đổi đó không im lặng." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":387 trainFewShot() — executionProviders ['cpu']. Cùng lý do như :130." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":564 trainIncremental() — executionProviders ['cpu']. Cùng lý do như :130." },
  { file: "server/services/aiLocalTraining.ts", symbol: "InferenceSession.create(", wired: false, note: ":882 classifyWithHead() — executionProviders ['cpu']. ⚠ File này có NĂM lời gọi session.release() (:332, :504, :765, :889, :954) ⇒ câu ở vramWiring.ts:49 ('grep toàn repo: KHÔNG một .release() nào lên ort.InferenceSession') SAI NHƯ ĐANG VIẾT; nó chỉ đúng nếu thu hẹp thành 'không session CÓ KHẢ NĂNG GPU nào được release'. Kết luận releaseProof='unverified' KHÔNG đổi." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "child_process", wired: false, note: ":9 import spawn — cổng vào của mọi plugin sidecar. Lệnh do plugin khai, KHÔNG giấy phép nào." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":42 createSupervisedTransportSpawner() — spawn LỆNH TUỲ Ý (PLUGIN_SIDECAR_CMD / manifest). Cổng PLUGIN_SIDECAR mặc định OFF và KHÔNG đặt trong .env ⇒ bất động. ⚠ Pha 2B: một plugin GPU nạp qua đường này là hộ mà sổ KHÔNG THỂ biết trước kích thước." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":47 spawnSidecarWithTransport() — cùng lớp với :42, dùng bởi pluginConformance." },
  { file: "server/services/plugins/sidecar/nodeSpawner.ts", symbol: "spawn(", wired: false, note: ":65 createNodeSpawner() — cùng lớp với :42, dùng bởi pluginSidecarBootstrap lúc boot." },
  { file: "server/services/plugins/sidecar/pluginSupervisor.ts", symbol: "spawn(", wired: false, note: ":110 this.deps.spawn(...) — gọi THÀNH VIÊN qua injected dependency. ⚠ Dòng này VÔ HÌNH với bản quét đầu tiên (lỗ C-1 #1) và chỉ hiện ra sau khi mẫu `spawn(` bỏ ràng buộc `(?<![.\\w])`." },
  { file: "server/services/apsSolver.ts", symbol: "child_process", wired: false, note: ":15 import spawn — solver CP-SAT/OR-Tools, xem :276." },
  { file: "server/services/apsSolver.ts", symbol: "spawn(", wired: false, note: ":276 runApsSolver() → APS_SOLVER_CMD, mặc định .venv python + scripts/aps_solver.py (CP-SAT). Solver tổ hợp CHẠY CPU — KHÔNG phải hộ VRAM. Ở đây để bắt buộc phân loại." },
  { file: "server/services/backupService.ts", symbol: "child_process", wired: false, note: ":10 import spawn/execFile — pg_dump và psql, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "execFile(", wired: false, note: ":370 execFile(pgDump, ['--version']) — kiểm phiên bản, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "spawn(", wired: false, note: ":397 spawn(pg_dump) — sao lưu CSDL, KHÔNG chạm GPU." },
  { file: "server/services/backupService.ts", symbol: "spawn(", wired: false, note: ":578 spawn(psql) — phục hồi CSDL, KHÔNG chạm GPU." },
  { file: "server/services/backupReplicationService.ts", symbol: "child_process", wired: false, note: ":1 import spawn — đẩy bản sao lên S3, KHÔNG chạm GPU." },
  { file: "server/services/backupReplicationService.ts", symbol: "spawn(", wired: false, note: ":87 spawn('aws', …) — sao chép đối tượng, KHÔNG chạm GPU." },
  { file: "server/services/aiGgufEngine.ts", symbol: "child_process", wired: false, note: ":476 execFile('nvidia-smi', ['--query-gpu=memory.used,…']) qua promisify — ĐỌC VRAM, không cấp phát. Bản đồng bộ của chính lời gọi này từng làm đóng băng xử lý request (xem chú thích :474)." },
  { file: "server/services/vram/vramProbe.ts", symbol: "child_process", wired: false, note: ":92 execFile('nvidia-smi') qua promisify — đầu dò TOÀN THIẾT BỊ, đọc chứ không cấp phát." },
  { file: "server/services/vram/vramProcessProbe.ts", symbol: "child_process", wired: false, note: ":1 import execFile — đầu dò THEO TIẾN TRÌNH (PDH), đọc chứ không cấp phát." },
  { file: "server/services/vram/vramProcessProbe.ts", symbol: "execFile(", wired: false, note: ":151 execFile('powershell.exe', …) đọc bộ đếm \\GPU Process Memory. ~1,5 s mỗi lượt; KHÔNG cấp phát VRAM." },

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // D. scripts/ — CHẠY NGOÀI TIẾN TRÌNH API. Sổ cái là biến TRONG BỘ NHỚ của MỘT tiến trình,
  //    nên KHÔNG script nào được ghi vào sổ của tiến trình API, kể cả khi mã nó đi qua đúng
  //    `beginVramAllocation()`. Hai script được API SPAWN thì được phủ GIÁN TIẾP bằng giấy phép
  //    `external-process`; phần còn lại KHÔNG được phủ bởi bất cứ thứ gì.
  // ═════════════════════════════════════════════════════════════════════════════════════════
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: "getLlama(", wired: true, note: ":73 — module nhúng DÙNG CHUNG. NĂM đường vào, chỉ HAI được giấy phép phủ: embed-incremental.mjs (trong chuỗi kb:sync ⇒ `cron:kb-sync`) và eval-rag.mjs --ci (⇒ `cron:kb-eval-gate`). BA đường chạy TAY KHÔNG được phủ: generate-embeddings.mjs (npm run kb:embed), backfill-image-embeddings.mjs, verify-embedding-cosine.mjs." },
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: ".loadModel(", wired: true, note: ":75 gpuLayers -1. ⚠ `-1` đáng ngờ — aiGgufEngine.ts:864-865 ghi node-llama-cpp 3.x hiểu -1 là 0 lớp (CPU im lặng) và CẤM truyền -1. Nhưng ở ĐÂY nó VẪN LÊN GPU: đo trực tiếp trong cửa sổ cron THẬT 2026-08-04, tiến trình embed-incremental.mjs (pid 38492) giữ 1.167,7 → đỉnh 1.367,7 MiB. Số ĐO thắng." },
  { file: "scripts/ai-kb/_gguf-embed.mjs", symbol: ".createEmbeddingContext(", wired: true, note: ":87 contextSize = min(GGUF_EMBED_CTX, GGUF_MAX_CTX) — CÓ CHẶN TRÊN, cùng công thức với EMBED_CTX của aiGgufEngine." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: "getLlama(", wired: true, note: ":211 gpu 'auto'. Chạy dưới `cron:kb-eval-gate` (kbSyncScheduler:291, cờ --ci) ⇒ wired gián tiếp. `npm run kb:eval` chạy tay thì KHÔNG." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: ".loadModel(", wired: true, note: ":221 gpuLayers -1 — model rerank/sinh chữ, cộng thêm vào cùng tiến trình con với embedder." },
  { file: "scripts/ai-kb/eval-rag.mjs", symbol: ".createContext(", wired: true, note: ":222 contextSize { min: 2048, max: 8192 } — CÓ CHẶN TRÊN." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: "getLlama(", wired: false, note: ":101 gpu 'auto'. KHÔNG có mục nào trong package.json và KHÔNG được server spawn ⇒ chỉ chạy TAY. Không giấy phép nào phủ." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: ".loadModel(", wired: false, note: ":102 gpuLayers 'max' — nạp toàn bộ lên GPU." },
  { file: "scripts/ai-kb/embed-programming.mjs", symbol: ".createEmbeddingContext(", wired: false, note: ':103 ⚠⚠ contextSize:"auto" — KHÔNG CÓ CHẶN TRÊN. node-llama-cpp co giãn context theo VRAM CÒN TRỐNG lúc gọi. ĐO ĐƯỢC 2026-08-04 trên máy rảnh: cùng model 0,6B, "auto" chiếm 3.916,1 MiB so với 526,0 MiB khi chốt bằng EMBED_CTX (gấp 7,4 lần). Với Pha 2B đây là lớp NGUY HIỂM NHẤT: không có kích thước để ước lượng, và nó ăn ĐÚNG BẰNG dư địa broker vừa chừa ra.' },
  { file: "scripts/ai-kb/reembed-images-onnx.mjs", symbol: "InferenceSession.create(", wired: false, note: ":184 executionProviders động. Chỉ chạy TAY — không có mục package.json, không được server spawn." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "getLlama(", wired: false, note: ":584 gpu theo cờ. `npm run ai:bench` — chỉ chạy TAY. Chính công cụ đo này từng MÙ ba lần (Đợt 0/1) nên nó phải nằm trong bảng." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".loadModel(", wired: false, note: ":618 gpuLayers 'max' khi bật GPU — nạp model thật để đo." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".createContext(", wired: false, note: ":329 context thường — bench cố ý tạo nó TRƯỚC context nhúng." },
  { file: "scripts/ai-bench/bench.mjs", symbol: ".createEmbeddingContext(", wired: false, note: ":420 context nhúng — thứ tự này tái hiện đúng bug hụt 2.030 MiB của Đợt 1 Task 2." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "child_process", wired: false, note: ":82 import execFileSync — chạy nvidia-smi để đọc VRAM, không cấp phát." },
  { file: "scripts/ai-bench/bench.mjs", symbol: "execFileSync(", wired: false, note: ":231 execFileSync('nvidia-smi', …) — ĐỌC VRAM cho bảng bench, không cấp phát." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":171 EP ['cpu'] — không VRAM. Script chẩn đoán môi trường, chạy tay." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":181 EP ['dml'] — CÓ chiếm VRAM. Script chẩn đoán, chạy tay, không giấy phép." },
  { file: "scripts/check-tier3-env.mjs", symbol: "InferenceSession.create(", wired: false, note: ":193 EP ['cuda'] — CÓ chiếm VRAM nếu EP nạp được. Script chẩn đoán, chạy tay." },
  { file: "scripts/check-tier3-env.mjs", symbol: "child_process", wired: false, note: ":15 import spawnSync — dò nvidia-smi/driver, không cấp phát." },
  { file: "scripts/check-tier3-env.mjs", symbol: "spawnSync(", wired: false, note: ":36 spawnSync(cmd, args) — chạy công cụ chẩn đoán (nvidia-smi, nvcc), KHÔNG cấp phát VRAM." },
  { file: "scripts/validate-models.mjs", symbol: "InferenceSession.create(", wired: false, note: ":38 EP ['cpu'] — kiểm tính hợp lệ của file model, không VRAM." },
  { file: "scripts/ai-kb/run-phase1.mjs", symbol: "child_process", wired: false, note: ":1 import spawn — điều phối các bước kb (kb:phase1), chạy tay." },
  { file: "scripts/ai-kb/run-phase1.mjs", symbol: "spawn(", wired: false, note: ":14 spawn(step.cmd[0], …) — chạy TỪNG BƯỚC kb tuần tự. Bản thân không nạp model; các bước con thì CÓ (xem _gguf-embed.mjs). Chạy tay ⇒ không giấy phép." },
  { file: "scripts/ai-survey/vi-quality-ab.mjs", symbol: "child_process", wired: false, note: ":43 import execFileSync — công cụ khảo sát chất lượng tiếng Việt, chạy tay." },
  { file: "scripts/ai-survey/vi-quality-ab.mjs", symbol: "execFileSync(", wired: false, note: ":82 execFileSync(...) — script này import THẲNG aiGgufEngine.ts (:365) ⇒ chạy đúng mã ĐÃ NỐI nhưng trong tiến trình RIÊNG, tức SỔ RIÊNG. Cùng lớp với embed-space-probe.mjs." },
  { file: "scripts/ai-eval/eval-specialist.mjs", symbol: "child_process", wired: false, note: ":136 import execFileSync — chấm điểm agent chuyên gia, chạy tay." },
  { file: "scripts/ai-eval/eval-specialist.mjs", symbol: "execFileSync(", wired: false, note: ":145 execFileSync(node, …) — gọi lại chính repo qua CLI; model nạp trong tiến trình CON, ngoài mọi sổ." },
  { file: "scripts/ai-kb/check-kb-stale.mjs", symbol: "child_process", wired: false, note: ":39 import execSync — kiểm KB có cũ không, chỉ chạy git." },
  { file: "scripts/ai-kb/check-kb-stale.mjs", symbol: "execSync(", wired: false, note: ":63 execSync('git …') — đọc lịch sử git, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "child_process", wired: false, note: ":18 import execSync — cài git hook, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "execSync(", wired: false, note: ":30 execSync('git config …') — đọc cấu hình hook, KHÔNG chạm GPU." },
  { file: "scripts/ai-kb/install-git-hooks.mjs", symbol: "execSync(", wired: false, note: ":39 execSync('git rev-parse …') — tìm thư mục .git, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "child_process", wired: false, note: ":29 import execSync/spawnSync — đóng gói bản offline, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":82 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":164 execSync(npm install …) — cài phụ thuộc vào thư mục deploy, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":170 execSync(npm install …) — cài thêm gói tuỳ chọn, KHÔNG chạm GPU." },
  { file: "scripts/build-offline-package.mjs", symbol: "execSync(", wired: false, note: ":178 execSync('npm install onnxruntime-common …') — chỉ CÀI gói, không nạp model." },
  { file: "scripts/build-secure.mjs", symbol: "child_process", wired: false, note: ":23 import execSync — dựng bản có ký, KHÔNG chạm GPU." },
  { file: "scripts/build-secure.mjs", symbol: "execSync(", wired: false, note: ":51 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/build-secure.mjs", symbol: "execSync(", wired: false, note: ":125 execSync(...) — bước ký/băm artefact, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "child_process", wired: false, note: ":21 import execSync — đóng gói offline (biến thể), KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":49 execSync('npm run build') — dựng bản phát hành, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":140 execSync(npm …) — chuẩn bị thư mục staging, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":149 execSync(npm …) — cài phụ thuộc trong staging, KHÔNG chạm GPU." },
  { file: "scripts/pack-offline.mjs", symbol: "execSync(", wired: false, note: ":462 execSync(...) — nén/đóng gói kết quả, KHÔNG chạm GPU." },
  { file: "scripts/contracts-compat-check.mjs", symbol: "child_process", wired: false, note: ":21 import execFileSync — cổng tương thích hợp đồng schema, KHÔNG chạm GPU." },
  { file: "scripts/contracts-compat-check.mjs", symbol: "execFileSync(", wired: false, note: ":78 execFileSync('git', …) — đọc bản schema cũ để so, KHÔNG chạm GPU." },
  { file: "scripts/setup-test-db.mjs", symbol: "child_process", wired: false, note: ":23 import execFileSync — dựng CSDL test, KHÔNG chạm GPU." },
  { file: "scripts/setup-test-db.mjs", symbol: "execFileSync(", wired: false, note: ":97 execFileSync(node, [migrate…]) — áp migration cho CSDL test, KHÔNG chạm GPU." },
  { file: "scripts/plugin-scaffold.mjs", symbol: "child_process", wired: false, note: ":22 import spawn — sinh khung plugin, KHÔNG chạm GPU." },
  { file: "scripts/plugin-scaffold.mjs", symbol: "spawn(", wired: false, note: ":199 spawn(sidecar.command, …) — chạy thử sidecar mẫu vừa sinh ra, KHÔNG chạm GPU." },
  { file: "scripts/sim/sim-devices.mjs", symbol: "child_process", wired: false, note: ":23 import spawn — trình mô phỏng thiết bị, KHÔNG chạm GPU." },
  { file: "scripts/sim/sim-devices.mjs", symbol: "spawn(", wired: false, note: ":99 spawn(cmd, nodeArgs) — sinh tiến trình mô phỏng máy, KHÔNG chạm GPU." },
  { file: "scripts/verify/worker-leader-proof.run.mjs", symbol: "child_process", wired: false, note: ":8 import spawn — kiểm chứng bầu leader, KHÔNG chạm GPU." },
  { file: "scripts/verify/worker-leader-proof.run.mjs", symbol: "spawn(", wired: false, note: ":15 spawn(node, [SCRIPT]) — chạy hai worker để chứng minh chỉ một thành leader, KHÔNG chạm GPU." },
];

/**
 * ★★★ HỘ TIÊU THỤ KHÔNG CÓ ĐIỂM CẤP PHÁT NÀO TRONG REPO — máy quét KHÔNG THỂ thấy chúng, nên
 * chúng phải được viết ra bằng tay. Bỏ chúng khỏi Pha 2B là lặp lại đúng lỗi Đợt 0.
 *
 * ⚠ TIÊU CHÍ (phải nhất quán, nếu không danh sách này thành tuỳ hứng): liệt kê mọi hộ CÓ THỂ
 * chiếm VRAM mà **không có dòng mã nào trong repo tạo ra nó**, kể cả khi hôm nay nó bất động vì
 * cấu hình. whisper.cpp KHÔNG còn ở đây vì nó CÓ điểm cấp phát (`kbVideoTranscriber.ts:361` →
 * `:212`) — nó chỉ từng vô hình vì máy quét thiếu `execFile`, và nay đã nằm trong bảng chính.
 *
 * 1. **Bộ đệm tính toán LƯỜI của llama.cpp** — ĐO ĐƯỢC, và không nằm trong sổ.
 *    llama.cpp cấp phát compute buffer ở lượt SUY LUẬN ĐẦU TIÊN, tức SAU `commitMeasured()`.
 *    `aiGgufEngine.ts:915-919` đã ghi điều này cho `gguf-model` nhưng KHÔNG ai cộng nó.
 *    ĐO 2026-08-04 (tiến trình sạch, bộ đếm PDH): lượt nhúng đầu tiên **+132,0 MiB**.
 *    ⚠ Phép đo đó dùng `contextSize:"auto"` (context 3.916 MiB) còn đường sản xuất dùng
 *    `EMBED_CTX` (526 MiB) — **khác 7,4 lần**, nên +132,0 KHÔNG chuyển thẳng sang đường sản xuất.
 *    Ứng viên khớp CHÍNH XÁC hơn cho khoảng lệch 128,0 MiB quan sát được ở tiến trình API:
 *    `aiGgufEngine.ts:2801` ghi context nhúng thật là **654 MiB**, và **654 − 526 = 128**.
 *    ⇒ HỆ QUẢ CHO PHA 2B, phải nói thẳng: **mọi lease GGUF đều BÁO THIẾU**, và khoản thiếu
 *    **không phải hằng số** — nó co giãn theo model/context. Hộ 30B **chưa từng quan sát được**.
 *    `vramReconciler` chỉ PHÁT HIỆN lệch dương, **không bù sổ**, nên `headroom` bị phóng đại theo
 *    đúng chiều **cho phép cấp phát khi thiết bị đã đầy**.
 *
 * 2. **Tiến trình `worker`** (`server/worker.ts` → `runWorkerProcess`). Sổ cái là biến trong bộ
 *    nhớ của MỘT tiến trình. `ROLE=worker` ⇒ hai sổ độc lập trên MỘT thiết bị, mỗi sổ thấy nửa
 *    của mình. Pha 1 đã ghi nhận ("ROLE=api ⇒ sổ MỘT tiến trình trong khi hệ chạy NĂM"); vẫn
 *    CHƯA giải. Cùng lớp: `vi-quality-ab.mjs` / `embed-space-probe.mjs` import thẳng
 *    `aiGgufEngine.ts` ⇒ chạy đúng mã đã nối, trong tiến trình riêng, sổ riêng.
 *
 * 3. **`llama-server` bền bỉ khởi động BẰNG TAY** — `LLAMA_SERVER_ENABLED` + runbook
 *    `scripts/ai/llama-server.md`. Thêm: `.env:660-661` có `LLAMA_CODER_PORT=8090` /
 *    `LLAMA_CODER_CTX` nhưng **không một dòng mã nào trong repo đọc `LLAMA_CODER_PORT`/
 *    `LLAMA_CODER_BIN`** — cấu hình cho một tiến trình mà mã không biết tới.
 *
 * 4. **`ollama serve`** — SÁU file đọc `OLLAMA_BASE_URL` (`aiImageEmbedding.ts`,
 *    `aiLocalKnowledgeService.ts`, `aiLocalTools/intentClassifier.ts`, và ba script
 *    `ai-kb/*embed*.mjs`). Đường HTTP tới một daemon GPU RIÊNG mà repo không spawn.
 *    Bất động hôm nay (`USE_LEGACY_OLLAMA` không bật) — **đúng bằng mức bất động của #3**, nên
 *    tiêu chí đòi nó phải có mặt.
 *
 * 5. **Nền desktop Windows** — 1.707,9 MiB lúc rảnh (dwm.exe 865,9 là khoản lớn nhất), đo
 *    2026-08-04. ⚠ Đây KHÔNG phải hằng số, và cũng không hoàn toàn "của người khác": nó chứa
 *    **client của chính sản phẩm này** (`client/**` nằm NGOÀI `SCAN_ROOTS` — một tab trình duyệt
 *    mở dashboard/`@react-three` twin 3D là VRAM của ta, do mã của ta, mà bảng này không quét).
 *
 * ⚠ ĐÍNH CHÍNH một suy đoán dễ mắc: ba cron cùng nổ lúc 03:00 (`KB_AUTOSYNC_CRON`,
 * `ANOMALY_BANK_REBUILD_CRON`, `AI_SELF_LEARNING_CRON` — cả ba đều BẬT trong `.env`). ĐÃ KIỂM:
 * **chỉ `kbSyncScheduler` là đường GPU.** `aiAnomalyBankScheduler` đọc vector ĐÃ LƯU trong
 * `ai_image_embeddings` (docstring :4), `aiSelfLearningScheduler` thuần DB/thống kê.
 * "Ba cron 03:00" ≠ "ba hộ tiêu thụ 03:00".
 */
export const CONSUMERS_WITHOUT_A_CODE_SITE = 5 as const;
