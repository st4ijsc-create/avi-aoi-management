# Đợt 1 — Giành lại VRAM: báo cáo thực thi

Nhánh: `feat/hmi-dep` · Kế hoạch: `docs/superpowers/plans/2026-08-01-dot1-gianh-lai-vram.md`

> File này được nối thêm mục theo từng task của Đợt 1 (Task 1 → Task 4). Mỗi mục là một `§N` độc lập, không sửa lại các mục trước.

---

## §1 Khoá in-flight — app nạp được model 30B trở lại (Task 1)

### Vấn đề

Đợt 0 đo được **45/45 lượt nạp model 30B thất bại** qua đường boot app, tái hiện **100%** mọi lần khởi động. Nguyên nhân: hai nơi độc lập trong app cùng gọi `warmModel(GGUF_DEFAULT_MODEL)` mà `loadGgufModel()` (`server/services/aiGgufEngine.ts`) **không có khoá đồng thời**:

- `server/services/aiGgufEngine.ts:1038` (`warmModel`) ← gọi từ `server/_core/backgroundJobs.ts:126-127`, delay 3000ms sau boot.
- `server/services/aiLocalKnowledgeService.ts:2392-2418` ← gọi từ `server/routes/aiLocalKnowledgeApi.ts:268`, delay 2000ms sau boot.

Cả hai đường đều gọi cùng `modelId`. Khi chồng nhau, cả hai lượt cùng vượt qua `loadedModels.has(modelId)` (model chưa nạp xong ở lượt đầu) và cùng gọi `llama.loadModel()` song song:
- Model **30B**: lượt hai `cudaMalloc` lỗi (không đủ VRAM cho 2 bản ~17 GB cùng lúc) ⇒ boot thất bại.
- Model **4B** (nhỏ hơn): **cả hai lượt đều thành công**. `loadedModels.set(modelId, …)` ở dòng ~660 là **vô điều kiện** (không kiểm entry cũ, không `dispose()`), nên lượt sau ghi đè lượt trước trong map — bản đầu trở thành **mồ côi ~3.474 MiB VRAM**, `evictLRU()` (chỉ duyệt các entry còn trong `loadedModels`) không với tới được nó. Chỉ restart tiến trình mới dọn. Model càng nhỏ càng rò nhiều (lượt càng dễ thành công song song).

### Sửa

Thêm map in-flight ở phạm vi module (`server/services/aiGgufEngine.ts`, cạnh khai báo `loadedModels`) và bọc thân hàm `loadGgufModel` (giữ nguyên logic có sẵn — chỉ thêm khoá ở tầng gọi):

```ts
const inFlightLoads = new Map<string, Promise<string>>();
```

Trong `loadGgufModel`, **sau khi `modelId` đã được tính** (`path.basename(resolvedPath, ".gguf")`) và **sau** phép kiểm `loadedModels.has(modelId)` hiện có: nếu `modelId` đang có một `Promise` in-flight, lượt gọi thứ hai trả về đúng promise đó thay vì nạp song song. Toàn bộ thân hàm nạp (từ `getLlama()` tới `loadedModels.set(...)`) được bọc trong một IIFE async, promise của nó được ghi vào `inFlightLoads` trước khi `await`, và được **xoá khỏi map trong `finally`** — kể cả khi nạp thất bại (nếu không xoá, mọi lượt gọi sau sẽ nhận lại đúng promise lỗi đó vĩnh viễn, không bao giờ thử nạp lại).

**Không đụng** `loadedModels.set()`, `evictLRU()`, `enforceVramGuard()` — các hàm này đúng, chỉ thiếu khoá ở tầng trên.

### TDD — bằng chứng ĐỎ trước khi sửa

File test mới: `server/services/aiGgufEngine.inflight.test.ts`. Mock `node-llama-cpp` với `loadModel` giả nạp chậm (50ms) để hai lượt gọi `Promise.all([loadGgufModel(cfg), loadGgufModel(cfg)])` chắc chắn chồng nhau (race thật). **Lưu ý so với mã mẫu trong brief**: mã mẫu không mock `fs`, nhưng `loadGgufModel()` gọi `resolveModelPath()` → `fs.existsSync()` THẬT trên đĩa; đường dẫn test giả (`test-model.gguf`) không tồn tại trên máy này, nên nếu không mock `fs` thì `resolveModelPath()` sẽ throw "file not found" ngay lập tức ở cả hai lượt gọi, `loadModelSpy` không bao giờ được chạm tới, và test không chứng minh được gì về race. Đã sửa mock (thêm `vi.mock("fs", …)` giống quy ước sẵn có ở `server/services/aiGgufEngine.test.ts`) để mô tả đúng thế giới thật thay vì sửa mã sản xuất cho khớp mock.

Chạy trước khi vá (`npx vitest run server/services/aiGgufEngine.inflight.test.ts`), output đỏ:

```
 ❯ server/services/aiGgufEngine.inflight.test.ts (2 tests | 1 failed) 215ms
   × loadGgufModel — khoá in-flight > hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần 157ms
     → expected "spy" to be called 1 times, but got 2 times

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/services/aiGgufEngine.inflight.test.ts > loadGgufModel — khoá in-flight > hai lượt gọi ĐỒNG THỜI cùng một model chỉ nạp MỘT lần
AssertionError: expected "spy" to be called 1 times, but got 2 times
 ❯ server/services/aiGgufEngine.inflight.test.ts:66:26

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

(Test thứ hai — hai lượt gọi TUẦN TỰ — đã xanh ngay cả trước khi vá, vì lượt thứ hai luôn thấy `loadedModels.has()` đã true; đúng như kỳ vọng, đây không phải test của race.)

### Sau khi vá — bằng chứng XANH

- `npx vitest run server/services/aiGgufEngine.inflight.test.ts` → **2/2 xanh** (`loadModelSpy` chỉ bị gọi 1 lần dù `Promise.all` hai lượt đồng thời).
- `npx vitest run server/services/aiGgufEngine.test.ts` (bộ test cũ, không đổi) → **12/12 xanh**, không hồi quy.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → chỉ còn lỗi tiền tồn tại `client/src/pages/SessionManagement.tsx(195,64)`.

### Đo VRAM không hồi quy

Lệnh: `node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0` (model `Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf`, 16.5 GB trên đĩa).

| Mốc | VRAM (MiB) |
|---|---|
| Baseline trước khi chạy | 1.178 |
| Peak sau khi nạp + sinh | 18.926 |
| **Delta model** | **17.748** (khớp mốc Đợt 0 ~17.700 MiB) |
| Sau khi tiến trình bench thoát | 1.177 |

Nạp **thành công 1 lần duy nhất** (`loaded in 41399.6ms`), không còn lỗi `cudaMalloc`. Sau khi bench thoát: VRAM về baseline (1.177 MiB, sai số đo trong khoảng nhiễu bình thường so với 1.178 MiB trước khi chạy), `tasklist` xác nhận **không còn `node.exe` treo**.

Baseline JSON đầy đủ (không commit — nằm trong `.gitignore` của thư mục bench): `scripts/ai-bench/baselines/2026-08-01T14-21-51-546Z.json`.

### Mối lo / việc để lại cho task sau

- Task này chỉ khoá **in-flight LOAD**. Chưa xử lý bản đồ ngân sách VRAM toàn cục cho 4 hộ tiêu thụ (nợ Đợt 0, ngoài phạm vi Đợt 1) — vẫn có thể OOM nếu nhiều model khác nhau được yêu cầu đồng thời (không cùng `modelId`, nên khoá này không áp dụng).
- Chưa test riêng nhánh "nạp thất bại → `finally` xoá khỏi `inFlightLoads` → lượt sau thử lại thành công" bằng test hành vi (đã xác nhận đúng bằng đọc mã + bộ test OOM-fallback hiện có trong `aiGgufEngine.test.ts` vẫn xanh, chứng tỏ đường lỗi/retry cũ không bị khoá mới phá vỡ, nhưng không có test riêng cho "khoá được giải phóng sau lỗi rồi lượt sau tự thử lại và thành công").
