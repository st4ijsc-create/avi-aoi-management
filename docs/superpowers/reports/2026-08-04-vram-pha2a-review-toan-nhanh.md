# Review TOÀN NHÁNH — Pha 2A (đo đúng và liệt kê)

- Nhánh `feat/hmi-dep`, 26 commit (`edd1b93f` → `3761cf06`), 36 file, +7.240/−96.
- Kiểm chứng độc lập của reviewer: `npx vitest run server/services/vram/` → **233/233 xanh** (tự chạy lại, 20 file, 4,05 s).
- Cây làm việc: 243 mục bẩn lúc bắt đầu → **243 mục lúc kết thúc**. Reviewer không thêm/không stage/không dọn mục nào. Một file test tạm (`__wb_probe.test.ts`) đã được tạo để đo, chạy, rồi **xoá**; đã xác nhận bằng `git status`.

---

## KẾT LUẬN

**SẴN SÀNG MERGE — có điều kiện: một lượt vá CHỈ-CHÚ-THÍCH (0 dòng mã thực thi) cho C-1, I-1, I-2.**

Lý do merge được: điều lệ Pha 2A được tôn trọng nghiêm ngặt — không một hàng rào cấp phát nào đổi,
không lượt xin nào bị từ chối thêm, `commitFallback` không chạm `recordActual()`, `reserve()` vẫn
đồng bộ. Cổng T5-11 **đã gỡ thật** (nghiệm thu song Task 3 + đo trực tiếp Task 6 trùng tới từng byte).
T5-15 đã đóng. Migration 0311 đã áp cả hai DB.

Lý do có điều kiện: ba phát hiện dưới đây đều là **lỗ đã tồn tại từ trước, KHÔNG do nhánh này đẻ ra**,
nhưng cả ba đều nằm đúng chỗ mà nhánh này tuyên bố đã phủ. Theo đúng kỷ luật mà chính pha này đã
lập ("cảnh báo phải VÀO MÃ, không chỉ vào báo cáo" — Task 6 I-2), chúng phải được viết vào mã trước
khi ai đó dựa vào bảng/chú thích để thiết kế Pha 2B. Cả ba sửa được bằng chú thích, giống hệt tiền
lệ `3761cf06`.

---

## (1) ★★★ TASK SAU CÓ PHÁ BẢO ĐẢM CỦA TASK TRƯỚC KHÔNG?

**Không có ca nào như ba Critical của Pha 1.5.** Truy đủ 9 vị từ/trạng thái dùng chung qua cả 6 task:

| Vị từ / trạng thái | Task đổi DÂN SỐ | Mọi nơi tiêu thụ có được kiểm lại sau lần đổi CUỐI? |
|---|---|---|
| `holdsUncommittedBytes()` = `actualBytes === null` | **Task 4** (`commitFallback` điền ô số) | ✔ đã kiểm lại tường minh, ghi ở `vramReconciler.ts:71-81` |
| `isLoadingLease()` = `actualBytes === null && !measureFailed` | Task 4 (gián tiếp) | ✔ dân số không đổi (lease dự phòng vốn đã bị loại vì `measureFailed`) |
| `leaseBytes()` = `actualBytes ?? estimatedBytes` | Task 4 | ✔ `totalReserved()`/`splitLedgerByMeasureSource()` đều đọc lại đúng |
| `splitLedgerByMeasureSource()` | Task 3 tạo, **Task 4 sửa** | ✔ `vramReconciler.ts:605` đã thêm nhánh `measureSource === "none"` |
| `measureFailed` | Task 3 (thêm cửa 8), Task 4 (hàng rào `commitFallback`) | ✔ `commit()` xoá cờ, `commitFallback()` cố ý giữ — bất biến khớp tại chỗ |
| `actualBytes === null` | Task 4 | ✔ `types.ts:80-91` khai rõ "không còn đồng nghĩa đã đo được" |
| `fallbackReason` | Task 4 | ✔ vòng đời KÍN, đúng 2 writer |
| `seen` (`ScopeReading`) | Task 3 tạo | ✔ Task 6 **KHÔNG** đổi dân số của nó, và nói thẳng ra điều đó |
| `openMeasureWindows` / khoá đo | Task 2 tạo, Task 3 nối, **Task 6 kéo dài 250 ms** | ✔ 6 nhánh thoát đều qua `closeWindow()`; ca 6 của `wiring.settle.test.ts` canh |
| `VRAM_PROCESS_PROBE` | Task 3 tạo, đảo logic ở vòng vá | ✔ danh sách BẬT tường minh |

Sáu nhánh đo-hỏng **đều** gọi `chotSoBangDuPhong()` (kiểm từng dòng: `:695`, `:791`, `:838`, `:890`, `:946`).
Nhánh thoát thứ BẢY (`catch` cuối `commitMeasured`) cố ý không được cứu, và điều đó được khai ở
`vramWiring.ts:629-636`.

**Một ca đúng hình dạng, hậu quả lành — nhưng đúng hình dạng:** Task 6 sửa `vramProcessProbe.ts` và
`vramWiring.ts` **sau khi** Task 5 chốt bảng liệt kê, làm mọi số dòng mà bảng trích dẫn cho hai file
đó **lệch đi**. Bảng vẫn xanh vì ca test chỉ khoá `file` + `symbol`, còn `note` (nơi chứa số dòng)
không ai canh. Đây chính là "lưới còn nguyên, bằng chứng của lưới thì mục" — xem M-1.

## (2) ★★★ CÒN HỘ TIÊU THỤ GPU NÀO KHÔNG ĐƯỢC ĐẾM KHÔNG?

**CÓ — một hộ có ĐIỂM CẤP PHÁT TRONG `server/`, vắng mặt hoàn toàn khỏi bảng 151 dòng.**

`server/services/reportGenerator.ts:382-386` — `await import("puppeteer")` rồi
`puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })`.
**Không có `--disable-gpu`.** Chromium headless hiện đại khởi tạo một tiến trình GPU riêng trên
Windows+NVIDIA. `puppeteer` là **dependency sản xuất** (`package.json:164`).

`grep -c reportGenerator server/services/vram/vramAllocationSites.ts` → **0**.

Vì sao lọt, và vì sao nó KHÁC ca `index.cjs`: `index.cjs` lọt vì né tránh có chủ đích (mẫu cắt đôi,
gọi qua chỉ số chuỗi) — đúng lớp "không quyết định được" mà Task 5 kết luận. **`reportGenerator.ts`
lọt vì lý do tầm thường hơn nhiều**: nó không `import child_process` (puppeteer tự sinh tiến trình
trong thư viện của nó) và `puppeteer` không nằm trong `MODULE_PATTERNS`. Bộ mẫu module được liệt kê
BẰNG TAY và chỉ có ba thư viện GPU (`node-llama-cpp`, `onnxruntime-node`, `child_process`). Một hộ
GPU đi qua thư viện thứ TƯ là vô hình theo cấu trúc — không cần né tránh gì cả.

Trạng thái hôm nay: **bất động** (`generateNGVisualPDF` chỉ có một người gọi gián tiếp,
`universalExportService.ts:717`, mà hàm đó không có người gọi nào). Nhưng bảng tự khai tiêu chí là
liệt kê **cả** dòng bất động và **cả** dòng không chạm GPU ("`wired: false` không có nghĩa bỏ qua
được, nó có nghĩa phải phân loại" — `vramAllocationSites.ts:7`), và bảng ĐANG liệt kê những dòng bất
động y hệt (`LLM_FINETUNE_CMD` chưa đặt, `WHISPER_BIN` còn chú thích). Nên nó thiếu **theo đúng tiêu
chí của chính nó**, không phải theo một tiêu chí reviewer tự nghĩ ra.

⇒ Điều này **không bác** kết luận nhận thức luận của Task 5 — nó **củng cố** kết luận đó bằng một
thể hiện rẻ tiền hơn hẳn `index.cjs`, và vì thế đáng ghi vào mã hơn: người đọc bảng có thể nghĩ
"151 dòng chỉ hụt ở những ca né tránh tinh vi". Không phải vậy. Nó hụt ở một `import` bình thường.

**Ba mục khác, mức thấp hơn, đều là mở rộng của mục đã có trong `CONSUMERS_WITHOUT_A_CODE_SITE`:**
- **`ROLE=edge` là tiến trình thứ BA**, không phải hai. Mục 2 của khối chỉ nói `worker`;
  `package.json` có `start:edge` → `server/edge/edgeGatewayMain.ts`. Cùng lớp, cộng thêm một sổ.
- **Bản triển khai `_deploy/avi-aoi-v1.0.0/`** mang cùng `node-llama-cpp`/`onnxruntime-node`/`puppeteer`
  và một service wrapper NSSM (`install-service.bat`) — một bản sao đầy đủ chạy như dịch vụ Windows.
- **Backend Vulkan cũng được cài** (`@node-llama-cpp/win-x64-vulkan` trong `node_modules`) bên cạnh
  CUDA. Không đổi kết luận, nhưng "backend CUDA 431,6 MiB" là hằng số của MỘT backend.

**Kiểm âm tính, đáng ghi lại:** không một `worker_threads`/`new Worker()` nào trong `server/` hay
`scripts/`; không cấu hình Docker nào cấp GPU (`nvidia`/`capabilities: [gpu]` = 0 hit trên 6 file
compose + 2 Dockerfile) ⇒ mọi lượt dùng GPU là bare-metal Windows; không pm2, không systemd.
`sharp`/`@napi-rs/canvas` là CPU. `apps/machine-shell` chỉ là khung Tauri chưa dựng được.

## (3) ★★ CHUỖI ĐO ĐẦU-CUỐI có đáng tin sau pha này không?

**Đáng tin hơn hẳn trước pha — nhưng CÒN MỘT ĐƯỜNG SAI LẶNG LẼ, và nó ở đúng chiều nguy hiểm.**

Cửa sổ đo được nối tiếp hoá đối với các lượt **CẤP PHÁT** đi qua `beginVramAllocation()`. Nó **không
được nối tiếp hoá đối với các lượt NHẢ**. `ticket.release()` (`vramWiring.ts:983`) không lấy khoá,
không mở cửa sổ, không đánh dấu gì. Ba đường nhả chạy hoàn toàn ngoài khoá:

1. **`ensureCapacity()` chạy TRƯỚC `beginVram()`** — `aiGgufEngine.ts:844` so với `:851`. Lượt nạp
   model B gọi `evictLRU()` → `unloadGgufModel(A)` → `dispose()` **trước khi** nó xếp hàng vào khoá.
   Nghĩa là B có thể giải phóng 17 GB **ngay giữa hai đầu đo của C**. `inFlightLoads` chỉ chặn cùng
   một `modelId`; `withGgufSlot` không bao quanh đường nạp (`vramWiring.ts:110-113` đã ghi).
2. **`unloadGgufModel()` qua HTTP** — `server/routers/aiGgufRouter.ts:73`, bất kỳ lúc nào.
3. **`while (await evictLRU())` trong nhánh OOM-retry** — `aiGgufEngine.ts:885`, nằm TRONG chính cửa
   sổ của nó.

Hậu quả: `actual = after − before` bị **trừ đi** phần vừa được nhả. Nếu phần nhả **lớn hơn** phần cấp
⇒ delta âm ⇒ **BỊ BẮT**. Nếu phần nhả **nhỏ hơn** ⇒ delta dương-nhưng-hụt ⇒ **KHÔNG lưới nào bắt**:
`overlappedBy` rỗng (nhả không mở cửa sổ), `measurable === true` (bộ đếm của khoá chỉ đếm lượt
BỎ CUỘC, không đếm lượt nhả), `seen === true`, `actual > 0`. Hệ `commit()` + `recordActual()` một
con số hụt, khai `measureSource: "process-delta"`, `measureFailed: false`.

**ĐO ĐƯỢC, KHÔNG SUY LUẬN.** Reviewer viết một file test tạm chạy trên mã sản xuất thật (đã xoá sau
khi chạy), 3/3 xanh:

- **A.** `before = 10 GiB`; model cấp 4 GiB **và** một hộ khác nhả 1 GiB trong cửa sổ ⇒ `after = 13 GiB`
  ⇒ sổ ghi `actualBytes = 3 GiB` (thật là 4), `measureFailed` falsy, `measureSource = "process-delta"`,
  **không một sự kiện `measure_failed` nào**, và `estimateBytesFor()` trả `{ bytes: 3 GiB, source: "learned" }`
  — nấc `learned` bị đóng đinh HỤT tới hết đời tiến trình.
- **B (đối chứng).** Nhả 1 GiB mà chỉ cấp 0 ⇒ delta âm ⇒ `measureFailed === true`. Lưới CÓ khả năng bắt;
  số 0 ở ca A là âm tính THẬT, không phải dụng cụ đo hỏng.
- **C.** `measureWindowDepth() === 1` trong lúc một giấy phép khác gọi `release()`; `measurable` vẫn
  `true`. Khoá nối tiếp **không hề biết** lượt nhả đã xảy ra.

Đây là **cùng một lỗ với ca 7 của `wiring.settle.test.ts`** (delta = 0 do bộ đếm trễ), chỉ khác cơ chế
kích hoạt: ca 7 là biến thể **toàn phần**, ca này là biến thể **một phần**. Ca 7 được ghi rõ, có ca đỏ
canh, có lệnh dứt khoát cho người vá. Biến thể một phần thì **không được ghi ở đâu cả** — mọi chú thích
về `evictLRU()` xen giữa hai đầu đo (`vramWiring.ts:842-859`, `:884`) chỉ nói tới hệ quả **delta ÂM**,
tức chỉ nói tới nửa số ca.

Chiều sai: **HỤT** ⇒ ở Pha 2B là `headroom` phóng đại ⇒ không từ chối khi phải từ chối ⇒ OOM.
Đúng chiều mà brief gọi là "chiều nguy hiểm duy nhất".

Ba đường sai lặng lẽ khác, mức thấp hơn:
- **`commitMeasured()` không idempotent.** Chỉ có cờ `released`, không có cờ `committed`. Gọi lần hai
  sẽ chạy lại biên lắng + đầu đo và `commit(after₂ − before₁)` — một con số lớn hơn nhiều — rồi
  `recordActual()` nó. Hôm nay không điểm gọi nào gọi hai lần, nhưng `vramWiring.ts:588-591` phát biểu
  điều đó như một **sự thật**, trong khi nó là một quy ước không được mã cưỡng chế. Một dòng là đủ.
- **`readScopeBytes` cộng gộp mọi LUID.** `byPid` cộng qua mọi adapter (`vramProcessProbe.ts:59`);
  `byLuid` được tính nhưng **không nơi nào đọc**. Trên máy hai GPU, hiệu số trộn hai thiết bị mà
  `measureFailed` vẫn `false`. Máy phát triển hôm nay là i7-12700**KF** (không iGPU) + một RTX 5090
  nên bất động — nhưng chính `vramBroker.ts:8-16` đã bắt lớp lỗi "hằng số của MỘT máy".
- **`estimator.recordActual()` chạy vô điều kiện sau `broker.commit()`** (`vramWiring.ts:953-954`).
  `commit()` là no-op nếu giấy phép đã `released`; `recordActual()` thì không kiểm gì. Ở ca
  `release()` xen vào giữa `commitMeasured()` đang bay, sổ đúng nhưng nấc `learned` vẫn bị ghi.

## (4) ★★ CHI PHÍ TRÊN ĐƯỜNG SẢN XUẤT

Đơn giá một cửa sổ: 2 × ~1,5 s đầu dò + 250 ms biên lắng = **~3,35 s**, và nó **nối tiếp** (khoá
`self`). Kết luận "onnx-session được cache nên chấp nhận được" của review-theo-task **đúng có điều
kiện, và điều kiện đó chưa được nói ra**.

- **Khởi động nguội: N = 4 cửa sổ nối tiếp ≈ 13,4 s chi phí đo thuần**, trên nền lượt nạp 30B thật
  (11–43 s). Hai đường warm độc lập cùng chạy: `aiLocalKnowledgeService.ts:2392` (hẹn 2 s, KHÔNG có
  cờ chặn) và `aiGgufEngine.ts:1521` (hẹn 3 s, `GGUF_WARM_DEEP_MODEL_ON_BOOT` **không đặt ⇒ BẬT**).
  Bốn cửa sổ: `cuda-backend` · `gguf:<30B>` · `gguf:<0,6B embed>` · `gguf-embed-ctx`.
- **★ Đường AOI có rơi vào chi phí đó — trần cache là 5, không phải vô hạn.**
  `SESSION_CACHE_MAX = envInt("AI_SESSION_CACHE_MAX", 5, 1)` (`aiInferenceEngine.ts:62`; `.env` để
  dòng đó bị chú thích ⇒ chạy mặc định 5). Quá 5 model AOI hoạt động ⇒ đuổi ⇒ lượt kiểm kế tiếp
  trượt cache ⇒ **vào lại trọn vẹn cửa sổ đo ~3,35 s, bên trong một request `production`**.
  Cộng thêm: `getSession()` **không có khoá in-flight** (`:206-208`) ⇒ hai request đồng thời cùng
  một model chưa cache mở **HAI** cửa sổ, rồi hai cửa sổ đó **nối tiếp nhau** ⇒ 2 × 3,35 s cho một
  model. Và mọi lượt `activateVersion`/`promoteStage`/auto-rollback đổi `currentVersion` ⇒ đổi
  cacheKey (`:158`) ⇒ một lượt nạp có đo bị **hoãn sang request kiểm tra đầu tiên sau khi deploy**,
  không rơi vào lượt deploy.
- **★★ ĐẢO NGƯỢC ƯU TIÊN có thật và ở trên đường sản xuất.** Broker biết ưu tiên
  (`PRIORITY_RANK`, `vramBroker.ts:63`); **khoá đo thì không**. `hangCho` là FIFO thuần
  (`vramMeasureLock.ts:5/33/75`), `withMeasureWindow` không nhận tham số ưu tiên (`:122`), và
  `vramWiring.ts:508-512` chỉ truyền `(fn, budget, owner)` — `opts.priority` dừng ở broker và nhật ký.
  ⇒ một lượt kiểm AOI `production` trượt cache có thể xếp **sau** một `gguf-embed-ctx`/`reranker`
  mức `background`, hoặc sau một lượt nạp 30B `interactive` (cửa sổ trải qua `loadModel()` 11–43 s
  **+** `createContext()` + biên lắng + 2 đầu dò). `VRAM_MEASURE_WAIT_MS` không đặt trong `.env`
  ⇒ ngân sách **180 s**. Đây là điều Task 3 đã ghi cho Pha 2B — nhưng nó **đang chạy hôm nay**, ở
  Pha 2A, không phải một rủi ro tương lai.
  ⚠ Hạ `VRAM_MEASURE_WAIT_MS` để chặn đảo ngược là **không an toàn**: `vramMeasureLock.ts:101-111`
  khai rằng nhánh hết-giờ đang âm thầm gánh vai trò lưới chống bế tắc (thứ tự khoá với `withGgufSlot`
  không nhất quán). Đổi "mất phép đo" lấy "treo cứng".
- **Cron:** chỉ chuỗi `kbSyncScheduler` (03:00, `.env:748`) mở giấy phép, và cả hai giấy phép của nó
  là `external-process` ⇒ **không lấy khoá**, cố ý không commit ⇒ chỉ +2 × 1,5 s trên một job
  30 phút. Không đáng kể. Gián tiếp: `aiBatchRcaScheduler.ts:251` (02:00) gọi `warmModel` ⇒ 1–2 cửa
  sổ `self` nếu model chưa cư trú.
- **Bù lại, và phải nói cho công bằng:** cổng tối ưu đã được mở đúng mức bằng chứng
  (`vramProcessProbe.ts:98-128`) — bỏ `Get-CimInstance` được phép ngay (~200 ms/lượt), còn 1,2 s của
  `-SampleInterval` thì chỉ được hạ **sau khi đo lại trên đúng đường bị ảnh hưởng**. Đó là cách viết
  cổng đúng, và I-1 vòng vá Task 6 đã thu hẹp nó lại từ một câu quá rộng. Nếu cắt được 1,2 s, khoản
  250 ms vừa thêm được hoàn lại gấp ~10 lần.

## (5) ★★ TUYÊN BỐ CÓ ĐƯỢC MÃ CHỐNG LƯNG KHÔNG?

Chất lượng chung **cao khác thường** — pha này đã tự bắt bốn lần và hạ giọng đúng chỗ (I-2 Task 6 về
dấu thời gian PDH, I-1 về cổng tối ưu, M-6 về "xác nhận thứ ba", `vramWiring.ts:1011-1017` tự khai
một dòng là mã trơ). Ba mục còn lại:

1. **`vramWiring.ts:49` — câu SAI, đã biết, chưa vá tại chỗ.**
   > "reviewer grep toàn repo — **không MỘT lời gọi `.release()` nào lên `ort.InferenceSession`**"

   `server/services/aiLocalTraining.ts` có **năm** (`:332`, `:504`, `:765`, `:889`, `:954`).
   Task 5 **đã phát hiện** và ghi đính chính — nhưng ghi ở `vramAllocationSites.ts:224`, một file
   KHÁC. Người đọc `vramWiring.ts:49` (nơi câu đó là lập luận chống lưng cho `releaseProof:
   "unverified"` và cho quyết định không sửa gốc ở Pha 1) sẽ không bao giờ tới dòng đính chính.
   Kết luận `unverified` **không đổi** (bốn session của `aiLocalTraining` ghim `executionProviders:
   ["cpu"]`), nên đây là lỗi phát biểu, không phải lỗi thiết kế — nhưng nó là đúng lớp lỗi mà pha
   này tự đặt ra để diệt, và nó đang nằm trong chính file trung tâm.
2. **`aiInferenceEngine.ts:96` lặp lại cùng câu đó** ("mà toàn repo KHÔNG có một lời gọi nào như
   vậy"), cùng mức sai, cùng cách sửa.
3. **Câu "mỗi điểm cấp phát chỉ `await` nó đúng MỘT lần"** (`vramWiring.ts:590`) được phát biểu như
   một sự thật để biện minh cho việc gắn `measureFailed` sớm — nhưng mã không cưỡng chế. Xem (3).

Không tìm thấy ca "lưới này đảm bảo…" / "không thể xảy ra…" nào khác thổi phồng. Ngược lại: phạm vi
được nói **hẹp hơn** thực tế ở nhiều chỗ (`vramWiring.ts:179` "có LƯỚI PHÁT HIỆN nhưng không có LƯỚI
NỐI TIẾP — nói đúng như vậy, đừng nói rộng hơn"), đó là hướng đúng.

## (6) ★ TRIAGE MINOR ĐÃ HOÃN — chỉ nêu cái ĐỔI KẾT LUẬN

Reviewer đồng ý hoãn phần lớn. **Hai mục đổi kết luận, một mục cần nâng mức:**

- **T2-M4 (`setTimeout` của `giuKhoa` không `.unref()`) — NÊN SỬA, vì Task 6 vừa lập ra nguyên tắc
  ngược lại.** Task 6 phân tích rất kỹ (`vramProcessProbe.ts:222-226`) rồi **giữ `.unref()`** cho hẹn
  giờ 250 ms, với lý do: "một hẹn giờ có `ref` giữ tiến trình sống thêm 250 ms ở mỗi lượt cấp phát
  đang bay… đó là ranh giới *telemetry chỉ QUAN SÁT* mà module này tự cấm mình vượt". Hẹn giờ của
  khoá đo giữ tiến trình sống tới **180 giây** — dài hơn **720 lần** — và nó không `.unref()`.
  Hai quyết định đối lập nhau về cùng một nguyên tắc, trong cùng một pha. Hoặc sửa T2-M4, hoặc viết
  ra vì sao khoá được miễn.
- **T3-M6 (`commitMeasured()` gọi lần hai đọc lại đầu dò) — nâng từ "chi phí" lên "đúng đắn".**
  Sổ tay ghi mục này như một mối lo về ~3 s. Hậu quả thật nặng hơn: xem (3) — lần hai `commit()` một
  hiệu số tính từ `beforeUsed` **cũ**, tức một con số bịa, rồi `recordActual()` nó. Bất biến "gọi
  một lần" chỉ nằm trong chú thích. Một cờ `committed` là đủ.
- **T3-M5 (bỏ qua `byLuid`) — giữ hoãn cho merge, nhưng phải là ĐIỀU KIỆN VÀO Pha 2B.** Bất động
  trên máy phát triển (một adapter). Trên máy hai GPU nó là một đường sai lặng lẽ, cùng lớp với ca
  trong (3). `byLuid` đã được tính sẵn và chưa ai đọc — chi phí vá gần bằng 0 khi cần.

Giữ nguyên hoãn (không đổi kết luận): T1-m1/m2, T2-M2 (`measureWaitBudgetMs()` ở `vramWiring.ts:357`
đã lọc NaN/âm trước khi tới khoá), T2-M3, T2-M5/M6/M7, T3-M2, T3-M4, T3-M7, Task 6 M-1…M-6.

---

## PHÁT HIỆN THEO MỨC

### Critical

- **C-1 — Lượt NHẢ xen giữa hai đầu đo cho ra delta HỤT mà không lưới nào bắt; `learned` bị đóng đinh
  hụt tới hết đời tiến trình.** `server/services/vram/vramWiring.ts:745` (`actual = after − beforeUsed`)
  × `server/services/aiGgufEngine.ts:844` (`ensureCapacity()` chạy TRƯỚC `beginVram()` ở `:851`)
  × `server/services/vram/vramMeasureLock.ts:137-141` (`measurable` chỉ đếm lượt BỎ CUỘC, không đếm
  lượt nhả) × `server/routers/aiGgufRouter.ts:73` (đường nhả qua HTTP).
  Đo được 3/3 bằng test tạm trên mã sản xuất; nhánh delta-âm chỉ phủ nửa số ca. Chiều sai là chiều
  OOM của Pha 2B. **Vá bằng chú thích** (ghi vào khối `actual < 0` ở `vramWiring.ts:842-867` rằng nó
  chỉ phủ NỬA lớp, và vào `chotSoBangDuPhong`/`ScopeReading` rằng khoá nối tiếp KHÔNG bao lượt nhả);
  vá thật là điều kiện vào cưỡng chế Pha 2B, không thuộc điều lệ 2A.

### Important

- **I-1 — Hộ tiêu thụ GPU có điểm cấp phát trong `server/` vắng mặt khỏi bảng 151 dòng.**
  `server/services/reportGenerator.ts:384` (`puppeteer.launch`, không `--disable-gpu`);
  `package.json:164` (dependency sản xuất). Vắng khỏi `server/services/vram/vramAllocationSites.ts`
  (0 lần xuất hiện). Nguyên nhân: `MODULE_PATTERNS` liệt kê tay đúng ba thư viện. Bất động hôm nay,
  nhưng thiếu theo đúng tiêu chí bảng tự khai ở `vramAllocationSites.ts:7`.
- **I-2 — Câu tuyên bố SAI ở file trung tâm, đính chính nằm ở file khác.**
  `server/services/vram/vramWiring.ts:49` và `server/services/aiInferenceEngine.ts:96` khẳng định
  toàn repo không có `.release()` nào lên `ort.InferenceSession`; `server/services/aiLocalTraining.ts:332,
  :504, :765, :889, :954` có năm. Đính chính chỉ tồn tại ở `vramAllocationSites.ts:224`.
- **I-3 — Đảo ngược ưu tiên trên đường AOI `production`, đang chạy ở Pha 2A.**
  `server/services/vram/vramMeasureLock.ts:5, :39, :75, :122` (FIFO, không nhận ưu tiên) ×
  `server/services/vram/vramWiring.ts:508-512` (không truyền `opts.priority`) ×
  `server/services/aiInferenceEngine.ts:184` (`priority: "production"`). Ngân sách 180 s
  (`vramMeasureLock.ts:1`, `VRAM_MEASURE_WAIT_MS` không đặt trong `.env`). Không hạ ngân sách được:
  `vramMeasureLock.ts:101-111` khai nhánh hết-giờ đang gánh vai lưới chống bế tắc.
- **I-4 — `commitMeasured()` không idempotent; bất biến "gọi một lần" chỉ có trong chú thích.**
  `server/services/vram/vramWiring.ts:700-702` (chỉ cờ `released`) so với lời khẳng định ở `:590`.
- **I-5 — Chi phí đo trên đường AOI có điều kiện chưa được nói ra: trần cache = 5 và không có khoá
  in-flight.** `server/services/aiInferenceEngine.ts:62` (`SESSION_CACHE_MAX` mặc định 5),
  `:206-208` (không dedup) — hai request đồng thời mở hai cửa sổ rồi nối tiếp nhau.

### Minor

- **M-1 — Số dòng bảng liệt kê trích dẫn cho `vram/**` đã mục vì Task 6 sửa hai file đó SAU Task 5.**
  `server/services/vram/vramAllocationSites.ts:99, :154` trỏ `vramWiring.ts:397` (thật: `:426`);
  `:259` trỏ `vramProcessProbe.ts:151` (thật: `:287`). Ca test chỉ khoá `file`+`symbol`, không khoá
  `note` ⇒ bằng chứng của lưới mục mà lưới vẫn xanh. (Trích dẫn sang `aiGgufEngine.ts` kiểm 6/6 ĐÚNG.)
- **M-2 — `vramWiring.ts:857-859` trỏ `aiGgufEngine.ts:771 / :737 / :802`; thật là `:885 / :529 / :916`.**
- **M-3 — `estimator.recordActual()` chạy vô điều kiện sau `broker.commit()`** dù `commit()` là no-op
  trên giấy phép đã `released`. `server/services/vram/vramWiring.ts:953-954`.
- **M-4 — `byLuid` được tính rồi không ai đọc; `byPid` cộng gộp mọi adapter.**
  `server/services/vram/vramProcessProbe.ts:59-60` × `vramWiring.ts:327`. Bất động trên máy một GPU.
- **M-5 — `sampledAtMs` là trường CHẾT** (`vramProcessProbe.ts:63`, `Date.now()` lúc parse, không nơi
  nào đọc). Task 6 I-2 đã khai đúng bản chất; ghi lại để không ai tưởng nó là hàng rào độ tươi.
- **M-6 — `ROLE=edge` là tiến trình thứ BA có sổ riêng**, mục 2 của
  `CONSUMERS_WITHOUT_A_CODE_SITE` (`vramAllocationSites.ts:381-385`) chỉ nói `worker`.
  `package.json` → `server/edge/edgeGatewayMain.ts`.
- **M-7 — `.unref()` bất nhất giữa hẹn giờ biên lắng (có, 250 ms) và hẹn giờ khoá đo (không, 180 s).**
  `vramProcessProbe.ts:237` so với `vramMeasureLock.ts:43`. Xem (6).

---

## ĐIỀU KIỆN VÀO CƯỠNG CHẾ PHA 2B (bổ sung vào danh sách sẵn có)

1. Lượt **NHẢ** phải nằm trong cùng cơ chế nối tiếp/đánh dấu với lượt **CẤP PHÁT** (C-1). Không thì
   `learned` hụt là chuyện thường ngày, và cưỡng chế đứng trên nó.
2. Khoá đo phải biết ưu tiên, hoặc `production` phải có đường không-đo-mà-không-chờ (I-3).
3. `byLuid` phải được dùng, hoặc phải từ chối đo trên máy nhiều adapter (M-4).
4. Bản liệt kê **không** được dùng làm bằng chứng đã đủ — I-1 là bằng chứng thứ hai, rẻ hơn `index.cjs`,
   cho đúng kết luận Task 5 đã rút.
