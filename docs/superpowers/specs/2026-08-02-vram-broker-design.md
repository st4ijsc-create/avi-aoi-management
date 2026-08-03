# Thiết kế: Module điều phối VRAM chung cho AI Local

> **Trạng thái:** đã duyệt phần kiến trúc (2026-08-02). Chờ chủ dự án duyệt spec đầy đủ trước khi lên kế hoạch thực thi.
> **Tiếp nối:** Đợt 2 (`9e235464..b17b0436`) · spec `2026-08-01-ai-local-model-strategy-design.md` §5 **bước A** — chỗ này chính là bước A đó, nay được tách thành spec riêng.

## 1. Mục tiêu

Dựng **một người nắm ngân sách VRAM duy nhất** cho toàn bộ AI Local, để:

- không hộ tiêu thụ nào còn cấp phát GPU mà không ai biết;
- khi hết chỗ, hệ **từ chối trung thực** thay vì tràn âm thầm;
- hệ **tự đo chính mình trong sản xuất**, thôi phụ thuộc vào một script bench song song;
- về sau, Agent **đọc được trạng thái và ra lệnh được** qua cùng một mặt tiếp xúc.

**Không** phải mục tiêu: sửa bí ẩn CUDA · xây engine tài nguyên tổng quát · làm giao diện.

## 2. Vì sao cần — bằng chứng đo được

### 2.1 Năm hộ tiêu thụ, ba ranh giới tiến trình

| Hộ tiêu thụ | Nơi chạy | Đo được | Ai điều khiển hôm nay |
|---|---|---|---|
| Model GGUF (deep · code · fim · embed) | tiến trình server | 19.077 (Coder-30B) · 5.534 (4B) · 2.232 (embed) · 2.188 (FIM) MiB | `aiGgufEngine` |
| Sidecar thị giác `llama-server` | **tiến trình riêng** | **7.825 MiB** | không ai — chỉ tự tắt sau 10 phút nhàn rỗi |
| Session ONNX/DirectML | tiến trình server | **+339 MiB** (1 session) · **+991** (5 session) | `aiInferenceEngine` + `ocrService`, **hai** bộ đệm tách rời |
| Tiến trình cron 03:00 `kb:sync` | **tiến trình riêng** | **1.251 MiB** | không ai |
| Nhiễu: Chromium (puppeteer), PyTorch trainer | tiến trình riêng | vài chục MB, rời rạc | không ai |

Trần thiết bị: **32.607 MiB** (RTX 5090).

### 2.2 Hệ NHÌN THẤY gần hết nhưng HÀNH ĐỘNG được rất ít

- [`readVramState()`](../../../server/services/aiGgufEngine.ts) (`:359`) đọc **toàn thiết bị** ⇒ *có* thấy sidecar, ONNX, cron.
- [`evictLRU()`](../../../server/services/aiGgufEngine.ts) (`:431`) chỉ duyệt `loadedModels` ⇒ **chỉ đuổi được model GGUF trong tiến trình này**.
- [`enforceVramGuard()`](../../../server/services/aiGgufEngine.ts) (`:402`) phản ứng theo mức **hiện tại**, **không biết kích thước sắp nạp** ⇒ qua cổng ở 85% rồi mới xin 19 GB.
- [`ensureCapacity()`](../../../server/services/aiGgufEngine.ts) (`:454`) đếm **số model**, không đếm **byte**.
- Cả hai, khi bí, kết thúc bằng *"allowing temporary overflow"* — **cảnh báo rồi vẫn làm**.

### 2.3 Lớp lỗi này đã trả giá ba lần

| Đợt | Hộ bị bỏ sót | Cách phát hiện | Hậu quả |
|---|---|---|---|
| 0 | Sidecar thị giác 7,8 GB | review **toàn nhánh**, sau 7 task + 7 review | bảng quyết định sai ~3.400 MiB **theo hướng lạc quan** |
| 2 | ONNX/DirectML +339 | review **toàn nhánh**, sau 6 task + 6 review | ăn **27%** biên an toàn đã công bố |
| 2 | Cron 03:00 +1.251 | review **toàn nhánh** | chưa vào bảng nào |

⚠ ONNX **đã được gọi tên** ở spec chiến lược §4.1 với cột *"Biết tổng VRAM?" = ❌* — **được nêu trong văn xuôi, không bao giờ vào số học**. Đây là lỗi **cấu trúc**, không phải bất cẩn: **không ai sở hữu tổng ngân sách**.

### 2.4 Hệ quả đang sống

Cấu hình `.env` hôm nay (`GGUF_FIM_MODEL` riêng) + thị giác thức, **lúc nghỉ**: **32.847 MiB = 100,7% ❌**.

## 3. Kiến trúc

### 3.1 Quyết định nền tảng

> **Broker đứng trên đường CẤP PHÁT, không đứng trên đường SUY LUẬN.**

Cấp phát là chuyện hiếm (nạp model, tạo context, tạo session, spawn tiến trình). Suy luận là chuyện liên tục. **Giữ giấy phép rồi thì suy luận chạy toàn tốc, không một lời gọi broker nào.**

⇒ Broker chậm cũng không thể làm chậm việc sinh chữ.

### 3.2 Hai nguồn số, tách bạch

| | Dùng để | Chi phí | Vị trí |
|---|---|---|---|
| **Sổ cái** (trong bộ nhớ) | quyết định cho/không | vài µs | trên đường cấp phát |
| **Đầu dò thiết bị** | phát hiện lệch | tới ~3 s | nền, theo nhịp, **không bao giờ chặn quyết định** |

⚠ Mã hiện tại làm **ngược**: gọi `readVramState()` ngay trong `enforceVramGuard()` trước mỗi lượt nạp. Chính file đó ghi (`:372`) rằng bản `nvidia-smi` **đồng bộ** từng **đóng băng toàn bộ xử lý request**.

### 3.3 Năm thành phần

**`server/services/vram/vramBroker.ts`** — sổ cái + quyết định kết nạp + thu hồi. Thuần tuý, trong bộ nhớ, **không I/O trên đường quyết định**. Mặt tiếp xúc duy nhất mà consumer gọi.

**`server/services/vram/vramProbe.ts`** — nguồn sự thật: `llamaInstance.getVramState()` (native, nhanh), lùi về `nvidia-smi` (async, `execFile`, timeout 3 s). Có bộ nhớ đệm kèm tuổi.

**`server/services/vram/vramReconciler.ts`** — so sổ với đầu dò theo nhịp; phát cảnh báo khi lệch; **nhận nuôi** giấy phép mồ côi; **thu hồi** giấy phép của tiến trình đã chết.

**`server/services/vram/adapters/*`** — bốn bộ nối mỏng tại đúng điểm cấp phát: `gguf` · `onnx` · `sidecar` · `cron`.

**`server/services/vram/vramEventLog.ts`** — nhật ký chỉ-ghi-thêm, **bất đồng bộ, gom lô**.

### 3.4 Sơ đồ

```
  Tiến trình server                      Tiến trình NGOÀI
  ┌────────────────────────┐      ┌──────────────────────────┐
  │ GGUF models            │      │ llama-server (thị giác)  │
  │ ONNX sessions          │      │ node kb:sync (cron 03:00)│
  └───────────┬────────────┘      └────────────┬─────────────┘
              │ reserve/commit/release          │ người GIÁM SÁT
              │                                 │ xin thay (pha 3)
              ▼                                 ▼
        ┌────────────────────────────────────────────────┐
        │  vramBroker — SỔ CÁI DUY NHẤT                  │
        │  biết KÍCH THƯỚC trước khi cấp phát            │
        │  cấp · từ chối · thu hồi · ưu tiên             │
        └──────────────┬──────────────────┬──────────────┘
                       │ đọc sổ           │ ghi sự kiện
                       ▼                  ▼
              ┌────────────────┐   ┌──────────────────┐
              │ vramReconciler │◀──│ vramEventLog     │
              │ so sổ vs thật  │   │ (ước lượng↔thật) │
              └───────┬────────┘   └──────────────────┘
                      │ nvidia-smi (nền, ~3s)
                      ▼
              ┌────────────────┐
              │   vramProbe    │
              └────────────────┘
```

## 4. Vòng đời giấy phép

```ts
type VramPriority = "production" | "interactive" | "background";

type VramLeaseKind =
  | "gguf-model" | "gguf-context" | "gguf-embed-context"
  | "onnx-session"
  | "external-process";   // sidecar thị giác, cron kb:sync

interface VramReserveRequest {
  owner: string;            // định danh ổn định, ví dụ "gguf:Qwen3-Coder-30B"
  kind: VramLeaseKind;
  estimatedBytes: number;   // BẮT BUỘC — đây là thứ enforceVramGuard() không có
  priority: VramPriority;
  ttlMs?: number;           // bắt buộc cho external-process
}

interface VramLease {
  id: string;
  request: VramReserveRequest;
  acquiredAt: Date;
  actualBytes: number | null;   // null cho tới khi commit()
  lastHeartbeatAt: Date;
}
```

**Bốn thao tác:**

| | Ngữ nghĩa |
|---|---|
| `reserve(req)` | → `VramLease` **hoặc ném `VramRefusedError`**. Chỉ đọc sổ. Không I/O. |
| `commit(lease, actualBytes)` | sau khi cấp phát xong, ghi **số thật**. Đây là nguồn của "harness tự sinh". |
| `release(lease)` | **bất biến khi gọi nhiều lần** (idempotent). |
| `heartbeat(lease)` | cho hộ ngoài tiến trình; thiếu nhịp quá `ttlMs` ⇒ reconciler xác minh rồi thu hồi. |

⚠ `release()` **phải** idempotent. Đợt 2 vừa trả giá: `releaseModel()` kẹp `refCount > 0` nên hai lần trừ bị **nuốt mất**, và một test "chống double-release" **xanh cả khi gỡ cờ idempotent**.

## 5. Chính sách kết nạp

### 5.1 Quyết định

```
duMuc  = tranThietBi − tongDaCap − duTruAnToan
neu  estimatedBytes ≤ duMuc            → CẤP
neu  không → thử THU HỒI theo ưu tiên  → CẤP nếu đủ
neu  vẫn không                          → TỪ CHỐI TRUNG THỰC
```

`duTruAnToan` mặc định **1.024 MiB** — che nhiễu nền, phần cấp phát lười của llama.cpp (compute buffer chỉ hiện ở lượt suy luận đầu), và **độ trôi nền `nvidia-smi` đo được ~103 MiB/ngày**.

### 🔴 5.1b `CẤP` nghĩa là "SỔ CHO PHÉP", KHÔNG nghĩa là "DRIVER SẼ CẤP" (sửa 2026-08-03, do Ư0/Ư7)

**Phiên bản đầu của §5 giả định sai rằng đếm đủ byte thì tránh được thất bại cấp phát.** Phép đo Ư0 (24 lượt, một bản mã, `docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md` §10) bác bỏ giả định đó:

| Bằng chứng | Hệ quả |
|---|---|
| **18/18 lượt hỏng đều có ~30 GB TRỐNG** cho một yêu cầu 16.698,37 MiB — dư **1,84×** | Phép trừ số học **không chạm được** lớp lỗi này. Kết nạp theo byte-còn-trống sẽ nói "CẤP", rồi driver vẫn từ chối. |
| Ư7: cùng một khối 16.698,37 MiB, **3 lần OK / 9 lần HỎNG** trên máy rảnh | **Trần một-lần-`cudaMalloc` KHÔNG TẤT ĐỊNH.** Mọi thiết kế dựa vào *một con số trần* bị loại từ đầu. |

⇒ **`duMuc` là điều kiện CẦN, không phải điều kiện ĐỦ.** Broker phải coi thất bại cấp phát là **sự kiện BÌNH THƯỜNG có đường xử lý** (§5.5), không phải điều kiện tránh được bằng cách tính cho khéo.

⚠ **Không viết đường vòng "chạm CUDA sớm" thành mã.** Nhánh B của Ư0 là **phiên bản mạnh hơn** của mẹo đó — model 0,6B thật sự thường trú, đi trước 1,63–2,27 s — và **vẫn hỏng 9/12**; hai nhánh **không phân biệt được** (Fisher `p = 1,0000`). Biến thể *chưa* bị bác là *"CUDA context tạo TRƯỚC khi tiến trình app boot"*, thuộc Ư7a, **chưa** đủ bằng chứng để thành mã.

### 5.2 Ưu tiên — xếp theo giá trị thật của nhà máy

1. **`production`** — đường kiểm tra AOI. Không bao giờ bị thu hồi.
2. **`interactive`** — người vận hành: RCA, trợ lý, ghost-text.
3. **`background`** — nạp tri thức, huấn luyện, cron 03:00. **Nhường trước tiên.**

Chỉ thu hồi được giấy phép **đang nhàn rỗi** (`refCount === 0`) hoặc mức **thấp hơn** mức đang xin.

### 5.3 Từ chối trung thực

`VramRefusedError` phải mang: **xin bao nhiêu · còn bao nhiêu · ai đang giữ gì · ai có thể nhường**. Không phải một câu "hết bộ nhớ".

Nối vào hệ mã lỗi Sprint 5 (`client/src/lib/errorCodes.ts`) để hiện thành câu tiếng Việt cho người vận hành.

⚠ **Không lặp lại `"allowing temporary overflow"`.** Tràn im lặng chính là thứ spec này tồn tại để diệt.

### 5.4 Hoãn — không chặn (quyết định chủ dự án, 2026-08-02)

Việc **`background`** bị từ chối thì **hoãn rồi thử lại**, **không** hỏng và **không** bỏ qua. Áp cho cron 03:00 `kb:sync` và mọi việc nền sau này.

**Nhưng hoãn mãi chính là bỏ qua, một cách im lặng** — đúng lớp lỗi cả ba đợt vừa diệt. Nên hoãn phải **có đáy và có tiếng**:

| | |
|---|---|
| Người bắt lỗi | **người giám sát** (`kbSyncScheduler`), không phải tiến trình con — con chưa kịp sinh ra |
| Lùi dần | thử lại sau **15 phút**, nhân đôi, trần **60 phút** |
| Đáy | `KB_SYNC_MAX_DEFER_HOURS`, mặc định **6 giờ** (03:00 → 09:00 — vẫn trong đêm) |
| Quá đáy | **KHÔNG âm thầm bỏ.** Ghi sự kiện `defer_exceeded` + cảnh báo nêu **ai đang giữ chỗ** |
| Tín hiệu sẵn có | biển báo *"KB có thể đã cũ"* (so `KB built` với `source last changed`) **tự nổi lên** khi sync trượt — **dùng lại nó, đừng phát minh tín hiệu mới** |

⚠ **Không được có đường nào mà một lượt `kb:sync` biến mất mà không để lại vết.** Nếu tri thức cũ đi vì broker liên tục từ chối, người vận hành phải biết **vì sao**, không phải chỉ biết **rằng** nó cũ.

### 🔴 5.5 BA kết cục, không phải hai (thêm 2026-08-03, do Ư0)

Một lượt xin VRAM có **ba** kết cục. Thiết kế cũ chỉ tính hai.

| # | Kết cục | Ai từ chối | Khi nào | Trạng thái hôm nay |
|---|---|---|---|---|
| 1 | `VramRefusedError` | **sổ** | trước khi nạp/spawn | thiết kế ở §5.3 — ổn |
| 2 | `cudaMalloc failed` | **driver**, sau khi đã **qua** cổng sổ | giữa lượt nạp | **chưa có đường xử lý** |
| 3 | **suy biến im lặng** | không ai — chỉ *ít* GPU hơn | giữa lượt nạp | **đang xảy ra** |

**Kết cục 3 là lỗi nặng nhất vì nó không kêu.** Đo được: `0/24` log Ư0 chứa dòng lùi `gpuLayers:"auto"` — tức **lớp phòng thủ cuối cùng KHÔNG BAO GIỜ chạy**. Hai nguyên nhân độc lập, cả hai phải vá **trong Pha 2**:

- `isOom` **không khớp** chuỗi `"Failed to load model"` mà llama.cpp thật sự ném ⇒ nhánh hạ `gpuLayers` không với tới.
- `warmModel` có `catch {}` **rỗng** ⇒ nuốt trọn thất bại nạp lúc khởi động.

⚠ Nhắc lại cạm bẫy đã ghi ở Đợt 1: `Math.max(0, Math.min(totalLayers, -1)) === 0` — nên `gpuLayers: -1` **không** nghĩa "tất cả các lớp", mà nạp **0 lớp**, chạy CPU, chậm gấp bội, **và không báo gì**. Đường lùi phải đặt số lớp **tường minh**.

**Xử lý kết cục 2 — bắt buộc:**

1. **Trả giấy phép NGAY.** Driver từ chối mà lease còn treo thì sổ **cộng dư vĩnh viễn**, và lượt xin kế tiếp bị từ chối trên **byte ma**. Đây là lớp lỗi Pha 1.5 vừa diệt (T5-1/C-1) — không được để cưỡng chế đẻ lại nó.
2. **Thử lại có trần**, vì trần không tất định (3/12 lượt thành công trên **cùng** khối): thử lại **2 lần**, cách nhau **5 s**. Cùng khuôn "hoãn có đáy và có tiếng" của §5.4.
3. **Rồi mới hạ `gpuLayers` tường minh**, ghi sự kiện `degraded` kèm **số lớp thật đã nạp**.
4. **Rồi mới từ chối trung thực** theo §5.3.

Mỗi bước phải ghi sự kiện riêng. **Không có bước nào được im lặng** — đó là toàn bộ lý do §5.5 tồn tại.

### 🔴 5.6 Quy luật liệt kê — điều kiện bật cưỡng chế (thêm 2026-08-03)

> **Mọi cấp phát không đi qua cổng đều VÔ HÌNH với cưỡng chế.**

Đây là **quy luật**, không phải sự cố lẻ. Bằng chứng: hộ tiêu thụ bị bỏ sót ở **cả bốn** đợt — sidecar thị giác 7,8 GB (Đợt 0, lọt 7 task + 7 review), ONNX và cron (Đợt 2), hộ thứ bảy rồi 8/10/11 (Pha 1) — trong đó **một hộ được sinh ra cách 143 dòng phía trên đúng đoạn mã vừa nối, cờ đang bật trong `.env`, chạy 03:00 mỗi đêm**.

Ở Pha 1 sót một hộ chỉ làm **số đo lệch**. Ở Pha 2 sót một hộ làm **cưỡng chế sai**: sổ tưởng còn trống nên vẫn nói CẤP, trong khi thiết bị đã đầy.

⇒ **Điều kiện bật cưỡng chế: liệt kê ĐẦY ĐỦ đường cấp phát TRƯỚC, không vá lẻ khi lộ.** Cụ thể, Pha 2 phải mở đầu bằng một task **chỉ-đếm**, và bản liệt kê phải:

- quét theo **hai** trục độc lập — theo **lời gọi** (`getLlama` · `loadModel` · `createContext` · `InferenceSession` · `spawn`) **và** theo **tiến trình** (`nvidia-smi --query-compute-apps` trên máy đang chạy thật, gồm cả cửa sổ 03:00);
- đối chiếu hai bản; **mọi chênh lệch là một hộ chưa biết**, phải truy đến tên file và dòng;
- kết thúc bằng **một hằng số đếm được kiểm bằng test** — số điểm cấp phát đã nối. Test đỏ khi ai đó thêm điểm mới mà không khai báo.

⚠ Con số này **đã sai hai lần liên tiếp** khi đếm bằng cách cộng dồn trong đầu. **Đếm bằng `git grep`, mỗi lần đếm lại từ đầu.**

## 6. Đối chiếu và báo động — phần giá trị nhất

Reconciler chạy theo nhịp (mặc định **60 s**, chỉnh được):

```
lech = thucTe(đầu dò) − tongDaCap(sổ)
neu |lech| > nguong (mặc định 512 MiB, > biên nhiễu ±25 MiB rất nhiều):
    → CẢNH BÁO "có kẻ cấp phát không xin phép"
    → ghi sự kiện kèm ảnh chụp toàn bộ sổ
```

**Sidecar 7,8 GB của Đợt 0, ONNX và cron của Đợt 2 — cả ba sẽ tự lộ trong vài phút** thay vì cần một lượt review toàn nhánh.

> Biến "một hộ tiêu thụ không ai đếm" từ **lỗi tài liệu vô hình** thành **cảnh báo lúc chạy**.

**Nhận nuôi giấy phép mồ côi:** server khởi động lại trong khi sidecar vẫn giữ 7,8 GB ⇒ sổ mất, thực tế còn. Reconciler dò tiến trình sidecar đang sống (cổng + PID đã biết) rồi **dựng lại giấy phép**. Cùng cơ chế bắt luôn ca ngược: tiến trình chết mà giấy phép còn treo.

## 7. Harness thôi là script riêng — nó thành sản phẩm phụ của sản xuất

`bench.mjs` đã sai **bốn lần**, vì nó là **bản cài đặt song song** với sản xuất. Hai bản cài đặt luôn trôi khỏi nhau.

Mỗi giấy phép ghi **ước lượng lúc xin** và **số thật lúc `commit()`**. Sau vài ngày, hệ có **số đo thật của chính nó, do sản xuất sinh ra**.

Diệt trực tiếp lớp lỗi *"+940 ước lượng vs +146 đo thật"* — hệ tự sửa con số mà không cần ai chạy lại bench.

⚠ `bench.mjs` **vẫn giữ** làm phép kiểm chéo độc lập, nhưng **thôi là nguồn sự thật**. Cổng `bench.production-parity.test.ts` giữ nguyên.

## 8. "Thống nhất về một mối" — cái gì bị xoá, cái gì bị hấp thụ

| Đang chạy | Số phận | Pha |
|---|---|---|
| `enforceVramGuard()` (`aiGgufEngine.ts:402`) | **XOÁ** — thay bằng `reserve()`, vốn biết kích thước trước | 2 |
| `ensureCapacity()` (`:454`) | **HẤP THỤ** thành chính sách đếm của broker | 2 |
| `evictLRU()` (`:431`) | **HẤP THỤ** thành `preempt()` — nay với tới hộ ngoài tiến trình | 2–3 |
| `GGUF_VRAM_GUARD_PCT` · `GGUF_MAX_VRAM_MB` · `GGUF_MAX_LOADED_MODELS` · `AI_SESSION_CACHE_MAX` | giữ tên, **một người đọc duy nhất** | 2 |
| `recSessionCache` (`ai/ocrService.ts:296`) — `Map` **không giới hạn** | vào dưới broker | 2 |
| `aiReranker.ts:361` gọi **thẳng** `llama.loadModel({ gpuLayers: useGpu ? -1 : 0 })` | phải xin giấy phép | 2 |
| Ba khoá in-flight (`inFlightLoads` · `embeddingContextInFlight` · `textContextInFlight`) | **KHÔNG hấp thụ** (bài toán khác: chống làm trùng việc) — nhưng gộp **ba bản sao cùng hình dạng** thành **một helper** | 2 |
| `ensureTextContext()` cấp phát ~2 GB **ngoài `withGgufSlot`** (nợ Đợt 2) | đưa vào trong giấy phép | 2 |

⚠ **Không viết lại `aiGgufEngine.ts` (2.712 dòng).** Chỉ **rút phần sở hữu bộ nhớ** ra — riêng việc đó đã bỏ được khối guard/evict/capacity.

## 9. Mô hình dữ liệu

Migration **`drizzle/0310_vram_broker.sql`**, schema `drizzle/schema/vram.ts`, theo đúng khuôn `aiGatewayMetrics` (`drizzle/schema/ai.ts:1828`).

```ts
export const vramEvents = pgTable("vram_events", {
  id: serial("id").primaryKey(),
  resourceKind: varchar("resourceKind", { length: 16 }).default("vram").notNull(),
  event: varchar("event", { length: 24 }).notNull(),   // reserve|commit|release|refuse|preempt|drift|adopt
  owner: varchar("owner", { length: 160 }).notNull(),
  leaseKind: varchar("leaseKind", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  estimatedBytes: bigint("estimatedBytes", { mode: "number" }),
  actualBytes: bigint("actualBytes", { mode: "number" }),
  deviceUsedBytes: bigint("deviceUsedBytes", { mode: "number" }),
  ledgerTotalBytes: bigint("ledgerTotalBytes", { mode: "number" }),
  driftBytes: bigint("driftBytes", { mode: "number" }),
  detail: jsonb("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
```

**Sổ cái sống nằm trong bộ nhớ** (đó là trạng thái tiến trình). Bảng này là **lịch sử**: cho Agent đọc sau, và là dữ liệu trả lời Ư7.

⚠ Ghi **bất đồng bộ, gom lô** theo khuôn `aiGateway` — **kèm bài học Task 2**: bộ đếm giờ xả (`setInterval` unref'd) **rò vào bộ test và tự ghi DB test**. Phải cách ly được ngay từ đầu.

## 10. Bốn pha và cổng chặn

| Pha | Nội dung | Đổi hành vi? | Cổng ra |
|---|---|---|---|
| **1 — Sổ cái & báo động** | broker + sổ + đầu dò + reconciler + 4 bộ nối **chỉ khai báo**; nhật ký sự kiện; **đo `aiReranker` bật GPU** (§16); **chạy Ư7 bằng chính nhật ký này** | **KHÔNG** | Sổ khớp thiết bị trong ±512 MiB suốt 24 h; báo cáo **phân bố lệch** + **p50/p95 chi phí đầu dò** để chốt §15.1/§15.2; **Ư7 có câu trả lời** |
| **2 — Cưỡng chế trong tiến trình** | **liệt kê đầy đủ đường cấp phát (§5.6)**; GGUF + ONNX phải xin phép; **ba kết cục §5.5**; từ chối trung thực; ưu tiên; **xoá/hấp thụ mục §8** | **CÓ** | Không còn `"temporary overflow"`; **không còn suy biến im lặng** — có test bắt được lượt nạp hạ lớp; `kb:eval` 151/151 |
| **3 — Cưỡng chế xuyên tiến trình** | sidecar + cron xin qua người giám sát; thu hồi được; nhận nuôi mồ côi | **CÓ** | Ô 100,7% ❌ được giải **bằng cơ chế**; gỡ được biện pháp tạm gộp FIM |
| **4 — Mặt tiếp xúc backend cho Agent** | bảng + router tRPC đọc/ra lệnh, có phân quyền | không | Agent truy vấn và ra lệnh được |

**Pha 5 (giao diện) nằm NGOÀI spec này** — theo yêu cầu chủ dự án: backend hoàn chỉnh trước.

### ✅ Cổng Ư7 — ĐÃ GỠ (2026-08-03)

Ư7 và Ư0 đều đã có câu trả lời (Pha 1 §7, Pha 1.5 §10). Kết quả **không** hợp thức hoá thiết kế cũ mà **đổi nó**: xem §5.1b và §5.5. Cổng này đóng lại ở đây.

### 🔴 Cổng chặn T5-11 — PHÉP ĐO PER-PROCESS (mới, thay chỗ cổng Ư7)

**Pha 2 KHÔNG được bắt đầu khi phép đo còn là `after − before` trên mức dùng TOÀN THIẾT BỊ.**

Lý do là số học, không phải phòng xa: mỗi đêm `cron:kb-sync` chạy ~30 phút; **mọi** lượt nạp rơi vào cửa sổ đó có hai đầu đo chồng nhau ⇒ bị gắn `measureFailed` ⇒ `actualBytes` **không bao giờ** được ghi. Pha 2 khi ấy **cưỡng chế trên toàn ước lượng**, đúng thứ Pha 1.5 vừa chứng minh là sai tới **16.335 MiB** một lượt.

**Điều kiện gỡ cổng:** một nguồn đo **theo tiến trình**, kèm bằng chứng: hai lượt nạp **cố ý chồng nhau** vẫn cho ra **hai** con số `actualBytes` đúng.

#### ✅ Đã đo 2026-08-03 — cổng GỠ ĐƯỢC KÈM ĐIỀU KIỆN

Báo cáo: `docs/superpowers/reports/2026-08-03-t511-per-process-feasibility.md`.

⚠ **Nguồn tôi ghi vào bản spec đầu — NVML/`--query-compute-apps` — KHÔNG DÙNG ĐƯỢC.** Driver ở chế độ **WDDM** trả `[N/A]` cho **mọi** tiến trình; đây là giới hạn cứng của NVIDIA, không phải thiếu quyền. Ghi lại để không ai thử lại đường đó.

**Nguồn thay thế đã kiểm:** bộ đếm hiệu năng Windows `\GPU Process Memory(pid_<PID>_luid_…)\Dedicated Usage`.

| Câu hỏi | Kết quả đo |
|---|---|
| Có thấy cấp phát CUDA? | **CÓ.** `D/F = 0,990` (30B) và `0,996` (0,6B). Thấy **cả ba** đường: backend `getLlama` · trọng số `loadModel` · KV-cache `createContext`. |
| Có nhiễu? | **Không.** Backend đọc **431,6 MiB byte-y-hệt ở 5/5** tiến trình — **khớp độc lập** với `+430/+431` đo bằng thước khác ở Pha 1. |
| Tách được lượt chồng nhau? | **CÓ — đây là bằng chứng gỡ cổng.** Cửa sổ nhỏ lồng trọn trong cụm cấp phát của model lớn: bộ đếm trả **2.424,0** và **16.700,2 MiB** (sai −0,18% / −1,01% so với kích thước file), trong khi `nvidia-smi` gán **19.117 / 19.112** cho **cả hai** — sai **+687%** với model nhỏ. |
| Có phải "thước thứ hai"? | **Có, nhưng vô hại ĐÚNG CHỖ TA DÙNG.** Lệch **tuyệt đối** +505…+511 MiB (hằng số, trải 5,9 MiB khi thiết bị chạy 1.097→21.077). Lệch theo **chênh lệch** — thứ broker thật sự dùng — chỉ **0…12 MiB, trung vị 1,6** = **2,3%** ngưỡng 512. |

**Năm điều kiện bắt buộc mang vào Pha 2:**

| # | Điều kiện |
|---|---|
| Đ1 | **Chỉ tách được GIỮA các tiến trình, KHÔNG tách được TRONG một tiến trình** — `inFlightLoads` khoá **theo `modelId`**, nên hai model **khác nhau** vẫn nạp song song trong cùng PID. **Cần cơ chế thứ hai** (xem quyết định dưới). |
| Đ2 | **Cộng theo CÂY tiến trình, không phải `child.pid`** — `spawnKbSyncWithVram()` dùng `spawn("npm", …, { shell: true })` nên `child.pid` là `cmd.exe`, còn 5 script node chạy **nối tiếp**, mỗi script một PID. Một giấy phép ↔ nhiều PID kế tiếp. (`spawnEvalGateWithVram` thì sạch — `spawn(process.execPath, …)`.) |
| Đ3 | **Lọc theo LUID của NVIDIA** — máy có **4 LUID**; hôm nay 3 cái đọc 0 nên cộng thô không sai, nhưng iGPU Intel có mặt. |
| Đ4 | **KHÔNG trộn hai thước** — số **tuyệt đối** của hai nguồn không thay thế nhau được. Chỉ dùng bộ đếm cho **chênh lệch**. |
| Đ5 | **Chi phí: `Get-Counter` p50 1.016 ms — VƯỢT 1 giây.** Từ Node, mỗi lượt đọc tốn **760 ms** (PDH .NET) hoặc **1.342 ms** (Get-Counter) vì phải spawn `powershell.exe`. Đường **4,3 ms** chỉ có khi PDH handle đã ấm **trong tiến trình** — cần helper sống lâu hoặc native addon, **chưa dựng**. |

**Quyết định về Đ1 — nối tiếp hoá cửa sổ đo trong tiến trình.** Bộ đếm trả một số cho mỗi PID, nên hai model khác nhau nạp song song **trong cùng tiến trình** vẫn không tách được. Cơ chế thứ hai là **một khoá nạp DUY NHẤT toàn tiến trình** (thay vì khoá theo `modelId`) bao quanh cửa sổ đo.

Đây **không phải cái giá phải trả, mà là điều đằng nào cũng nên làm**: hai lượt `cudaMalloc` 17 GB chạy song song đúng là kịch bản dễ chạm trần bất định nhất (Ư7: 3 OK/9 hỏng trên máy rảnh). Nối tiếp hoá vừa làm phép đo đúng, vừa giảm chính lớp lỗi đó.

**Quyết định về Đ5 — chấp nhận 760 ms, KHÔNG dựng helper sống lâu.** Broker chỉ đọc **2 lần mỗi lượt NẠP**, không phải mỗi nhịp; +1,52 s trên một lượt nạp mất 5–120 s là ≤2%. Helper sống lâu là một thành phần chạy ngầm mới, đổi lấy khoản tiết kiệm không ai cảm nhận được. **YAGNI** — ghi vào tồn đọng, dựng khi có số chứng minh cần.

Kèm theo, phải trả **T5-15** trong cùng pha: giấy phép `gguf-backend` **không có đường trả ở nhánh thành công** — nếu bị gắn `measureFailed` thì xấu nhất không phải "nên khởi động lại" mà là **"bắt buộc khởi động lại"**.

### ⚠ Hai điều kiện Pha 1 CHƯA đạt — khai thẳng

Điều kiện ra của Pha 1 gồm *"sổ khớp thiết bị trong ±512 MiB suốt 24 h"*. **Lượt chạy 24 h CHƯA thực hiện.** Bằng chứng hiện có là 101 mẫu liên tục (lệch p50 15 / p90 210 MiB, **0 báo động**) — đủ để chốt ngưỡng và nhịp (§15), **không** đủ để tuyên bố điều kiện 24 h là ĐẠT. Ghi ở đây để không ai đọc bảng trên mà tưởng cả bốn điều kiện đều xanh.

## 11. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| Đầu dò hỏng (`nvidia-smi` vắng) | reconciler **im lặng bỏ qua**, broker **vẫn cấp theo sổ**. Không được biến máy không-GPU thành máy chết. |
| `commit()` không bao giờ tới (cấp phát ném) | **trả giấy phép NGAY tại chỗ bắt lỗi** (§5.5 bước 1). `ttlMs` + reconciler chỉ là **lưới đỡ**, không phải đường chính — chờ TTL nghĩa là sổ cộng dư suốt quãng đó và lượt xin kế tiếp bị từ chối trên **byte ma**. |
| `cudaMalloc failed` **sau khi** đã qua cổng sổ | **không phải lỗi bất thường** — chạy đủ 4 bước §5.5 (trả phép → thử lại 2×5 s → hạ `gpuLayers` tường minh → từ chối trung thực), mỗi bước một sự kiện |
| Tiến trình ngoài chết không trả giấy phép | thiếu nhịp ⇒ reconciler **xác minh bằng đầu dò** rồi thu hồi. **Không thu hồi chỉ vì thiếu nhịp** — phải xác minh. |
| Server khởi động lại, sidecar còn sống | **nhận nuôi** (§6) |
| Sổ và thiết bị lệch dai dẳng | cảnh báo **leo thang**; **không tự cưỡng chế theo số sai** |
| Ước lượng thấp hơn thực tế | `commit()` ghi số thật; lần sau dùng số thật |

## 12. Kiểm thử

**Nguyên tắc bắt buộc — mọi lưới an toàn phải được chứng minh bằng mutation test.** Đợt 2 vừa bắt một test "chống double-release" **xanh cả khi gỡ cờ idempotent**. Lưới không được kiểm là **lưới giả**.

- `reserve/commit/release` — đơn vị, gồm **release hai lần phải bằng release một lần** (mutation: gỡ cờ idempotent ⇒ **phải đỏ**).
- Kết nạp — bảng ca: vừa đủ · thiếu · thu hồi được · không thu hồi được · ưu tiên bằng nhau.
- Reconciler — **giả một lượt cấp phát không xin phép ⇒ phải báo động**. Đây là test quan trọng nhất của pha 1.
- Nhận nuôi — giả server khởi động lại khi sidecar còn sống.
- **Hiệu năng** — khẳng định `reserve()` **không I/O**: mock đầu dò rồi assert nó **không được gọi** trên đường quyết định.
- Cách ly bộ đếm giờ xả (bài học Task 2).
- ⚠ Assert **giá trị chính xác** (`toBe`), **không** `<=` — bài học Sprint 5.

## 13. Ngoài phạm vi

- **Sửa bí ẩn CUDA.** Broker quyết định *có cho phép*, không đổi *cách cấp phát*.
- **Engine tài nguyên tổng quát.** Chỉ VRAM. `resource_kind` là **một cột**, không phải framework.
- **Giao diện.** Pha 5.
- **Gom mọi suy luận về một tiến trình.** Sidecar cần binary `llama-server`; và bí ẩn CUDA cho thấy thứ tự cấp phát trong một tiến trình đang mong manh.
- **Nhiễu Chromium/PyTorch.** Ghi vào sổ như hằng số quan sát, không quản.

## 14. Quyết định gộp FIM

Chủ dự án đã quyết **gộp FIM vào Coder-30B** (2026-08-02) để gỡ ô `100,7% ❌`.

**Ghi nhận là biện pháp TẠM**, kèm điều kiện gỡ: khi **pha 3** chạy được, broker đuổi được FIM lúc thị giác thức ⇒ lấy lại ghost-text nhanh gấp đôi.

Giá phải trả nếu gộp vĩnh viễn: tổng tới gợi ý 32 token **84-89 ms → 149-188 ms**, vượt ngưỡng ~100 ms (Miller/Nielsen) ⇒ ghost-text **hết cảm giác tức thì**, mỗi lần gõ phím, mãi mãi.

## 15. Bốn quyết định của chủ dự án (2026-08-02)

1. **Ngưỡng lệch khởi điểm 512 MiB — DUYỆT.** Pha 1 thu phân bố thật rồi chốt số cuối. Nghĩa vụ pha 1: báo cáo phân bố `|lệch|` trong 24 h.
2. **Nhịp đối chiếu khởi điểm 60 s — DUYỆT.** Pha 1 đo chi phí thật của đầu dò rồi chốt. Nghĩa vụ pha 1: báo cáo `p50/p95` thời gian một lượt dò.
3. **Cron 03:00: CHỈ HOÃN, không chặn hẳn.** Xem §5.4.
4. **Đo `aiReranker` với `RAG_RERANKER_GPU=true` trong pha 1 — DUYỆT.** Đây là hộ tiêu thụ thứ sáu (§16); chưa đo thì chưa đặt chính sách được.

## 16. Phát hiện phụ khi soạn spec — hộ tiêu thụ thứ SÁU

Đọc mã để viết §8, tôi thấy `aiReranker.ts:361` **không chỉ** bỏ qua semaphore `withGgufSlot` (file này **không có** một lời gọi nào tới nó). Nó gọi **thẳng** `llama.loadModel(...)`, **không** qua `loadGgufModel()`.

⇒ Model rerank **không vào `loadedModels`** ⇒ **vô hình với `evictLRU()`, với `enforceVramGuard()`, và với mọi phép cộng của cả ba đợt.**

Hôm nay vô hại vì `RAG_RERANKER_GPU=false` ⇒ `gpuLayers: 0` ⇒ 0 MiB GPU, và ba đợt đều ghi đúng "reranker = 0 MiB". Nhưng **đổi một cờ trong `.env` là có ngay một hộ tiêu thụ GPU thứ sáu mà không công cụ nào của hệ nhìn thấy** — cùng hình dạng đã trả giá ba lần.

**Không sửa trong spec này** (nó thuộc §8, pha 2). Ghi lại vì nó là bằng chứng mới nhất cho lý do spec này tồn tại: **chừng nào chưa có một người nắm sổ, mỗi cờ cấu hình đều là một hộ tiêu thụ tiềm tàng chưa ai đếm.**
