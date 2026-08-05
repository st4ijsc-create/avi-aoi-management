# Trả hai món nợ Pha 3 để lại

Nhánh `feat/hmi-dep` · nền vào việc: `npx vitest run server/services/vram/` = **699/699 (37 file)** ·
`tsc --noEmit` **exit 0** · `i18n:check` **0 lệch** · HEAD lúc bắt đầu `42e2b1b8`.
Làm một mình, tuần tự, KHÔNG sub-agent. Ghi dần sau mỗi mục.

---

# NỢ 1 — `tsconfig.json` LOẠI TRỪ `**/*.test.ts`

## 1. ĐO TRƯỚC — số thô

Cấu hình đo: đúng `include` của `tsconfig.json` (`client/src/**/*` · `shared/**/*` · `server/**/*`),
`exclude` giữ nguyên **trừ** dòng `"**/*.test.ts"`; `NODE_OPTIONS=--max-old-space-size=8192`;
sổ biên dịch riêng để không đụng sổ của `npm run check`.

```
npx tsc --noEmit -p tsconfig.measure.tmp.json   →  exit 2
```

| Số thô | Giá trị |
|---|---|
| **Tổng lỗi kiểu** | **710** |
| **Số file có lỗi** | **174** |
| Số file test toàn repo (`server` + `client/src` + `shared`) | **820** (`server` 776 · `client/src` 43 · `shared` 1) |
| Lỗi nằm **ngoài** file test | **0** |
| Thời gian một lượt (máy này, không cache) | ~93 s |

⚠ Hai điều phải nói cùng lúc với con số 710:

1. **Toàn bộ 820 file là `.test.ts`, 0 file `.test.tsx`.** Dòng loại trừ chỉ có `**/*.test.ts`,
   nên đúng 100 % file test lọt qua — không có phần nào "tình cờ vẫn được canh".
2. **0/710 lỗi nằm ngoài file test** ⇒ mở cổng cho file test **không** thể làm `npm run check` đỏ.
   Đây là điều kiện then chốt cho phép chọn cách chữa ở §3.

### Phân bố (20 file nặng nhất)

| lỗi | file |
|---|---|
| 33 | `server/services/orchestration/foe/foe.test.ts` |
| 26 | `server/services/ai/aiLlmAudit.test.ts` |
| 20 | `server/services/aiDriftRetrain.test.ts` |
| 19 | `server/routes/openaiGatewaySafety.test.ts` |
| 16 | `server/machineStatus.test.ts` |
| 15 | `server/services/programming/iec61131/pou.p4.test.ts` |
| 15 | `server/services/aiProviderGatewayRouting.test.ts` |
| 14 | `server/routers/processResultAnalytics.test.ts` |
| 13 | `server/routers/aiSpecialistAgentRouter.test.ts` |
| 12 | `server/services/aiLocalTools/handlersF7.test.ts` · `server/services/aiCopilotActions.autonomy.test.ts` · `server/routers/machineApiP2.test.ts` |
| 11 | `aiTrainingPipeline.tier2` · `aiAgentCenterService` · `machineApiBatchIngest` · `server/mqtt` |
| 10 | `server/services/aiLocalTools/writeHandlers.gd3.test.ts` · `server/routers/measurementPointGuards.test.ts` |

★ **`server/services/vram/**` có ĐÚNG 0 lỗi** — kể cả `threeOutcomes.test.ts:1274` (m-4 của review
toàn nhánh) nay đã sạch. Phạm vi VRAM là hạt giống sạch để bật cổng.

---

## 2. PHÂN LOẠI

| nhóm | mã lỗi | số | ý nghĩa |
|---|---|---|---|
| **(b) artefact của mock — vô hại** | TS2556 (180) · TS2493 (139) · TS2352 (53) · TS2554 (20) · TS7016 (4) · TS2698 (3) | **399** (56 %) | `vi.fn()` không có generic ⇒ kiểu `Mock<[], any>` ⇒ `fn(...args)` là TS2556 và `mock.calls[0]![1]` là TS2493. `undefined as Date` trong ca cố ý. Không có ca nào xanh vì lý do sai từ nhóm này. |
| **(c) lỗi kiểu thường** | TS2345 (83) · TS2339 (47 − 7 của nhóm a) · TS2322 (44) · TS2353 (32) · TS2532 (25) · TS18048 (17) · TS18047 (16) · TS2300 (8) · TS2740 (7) · TS2769/TS2722/TS2551 (6+6+6 − 6 của nhóm a) · còn lại | **298** | trôi kiểu giữa ca và sản xuất; ô thừa trên `mockResolvedValue`; `possibly undefined`. Sai thì ca **ĐỎ ở runtime**, không xanh giả. |
| **★ (a) LƯỚI GIẢ THẬT SỰ** | TS2551 (6) + TS2339 (7) | **13 điểm lỗi · 2 file · 8 ca** | ca "kiểm" một hàm sản xuất **KHÔNG TỒN TẠI** |

Cách nhận diện nhóm (a) một cách máy móc: lỗi mà vế trái là **không gian tên module**
(`does not exist on type 'typeof import(...)'`). Quét toàn bộ 710 lỗi cho đúng **13** điểm, cả 13
nằm ở 2 file.

### ★ Nhóm (a) — liệt kê từng cái, kèm `file:dòng`

Cả hai file dùng cùng một khuôn: `vi.mock("./db", () => ({ … }))` với **nhà máy mock viết tay**,
trong đó có tên hàm **không hề tồn tại trong mã sản xuất**. Ca sau đó nạp giá trị cho mock, gọi
chính mock đó, rồi khẳng định mock trả về đúng thứ vừa nạp. **Không một dòng mã sản xuất nào chạy.**

**`server/machineStatus.test.ts`** — nhà máy mock ở `:5-13`

| dòng | ký hiệu | thực tế |
|---|---|---|
| `:99` `:101` | `db.getUptimeStats` | TS2339 — **0 định nghĩa** trong `server/db/**` |
| `:115` `:117` | `db.getUptimeStats` | ⇢ ca *"should calculate uptime percentage"* / *"…handle zero…"* |
| `:162` `:169` | `db.bulkCreateMeasurementPointDefs` | TS2551 *"Did you mean `bulkCreateMeasurementPoints`?"* — **0 định nghĩa** |
| `:179` `:186` | `db.bulkCreateMeasurementPointDefs` | ⇢ ca *"should handle duplicate codes gracefully"* |
| `:197` `:204` | `db.bulkCreateMeasurementPointDefs` | ⇢ ca *"should validate measurement types"* |

⇒ **5 ca** (`describe("getUptimeStats")` 2 ca + `describe("bulkCreateMeasurementPointDefs")` 3 ca).

**`server/sessionBackup.test.ts`** — nhà máy mock ở `:4-46`

| dòng | ký hiệu | thực tế |
|---|---|---|
| `:113` | `revokeUserSession` | TS2339 — **0 định nghĩa** |
| `:122` | `revokeAllUserSessions` | TS2339 — **0 định nghĩa** |
| `:147` | `getBackupCodesStatus` | TS2339 — **0 định nghĩa** |

⇒ **3 ca**.

**Xác nhận bằng cách chạy thật, không phải suy luận:**

```
npx vitest run server/machineStatus.test.ts server/sessionBackup.test.ts
 ✓ server/machineStatus.test.ts (11 tests)
 ✓ server/sessionBackup.test.ts (11 tests)
 Tests  22 passed (22)
```

22 ca xanh, trong đó **8 ca kiểm 5 hàm không tồn tại**. Ba trong năm cái tên đó **có tồn tại** —
nhưng là **tên thủ tục tRPC**, không phải hàm DB: `getUptimeStats` ở
`server/routers/statusTemplateRouters.ts:61`, `getBackupCodesStatus` ở
`server/routers/userRouters.ts:358`. Người viết ca lấy tên ở tầng router rồi mock nó ở tầng `db`.
Đây đúng hình dạng *"lưới xanh vì lý do sai"*: ca khẳng định một sự thật về **chính nó**.

⚠ **KHÔNG sửa 8 ca này trong lượt này.** Sửa nghĩa là **xoá ca** (hàm không tồn tại thì không có gì
để kiểm) — đó là quyết định về vùng phủ của người sở hữu hai module kia, không phải của món nợ build.
Đã đưa cả hai file vào danh sách cách ly và ghi tên ở đây để có địa chỉ.

### Hai thứ nhỏ hơn nhưng cùng gốc, ghi lại để khỏi mất

- `server/services/ai/embeddingHead.test.ts:92` — **TS2578 `Unused '@ts-expect-error' directive`**.
  Chỉ thị đó tự khai *"cố ý thử một phép biến đổi bất hợp lệ"* nhưng **không có lỗi kiểu nào để nuốt**.
  Vế runtime (`.toThrow()` trên mảng đã đóng băng) vẫn làm việc thật ⇒ không phải lưới giả, nhưng câu
  chú thích đang hứa một tầng bảo vệ không tồn tại.
- `server/routers/kbErrorCodes.test.ts:24` + `:192` — **TS2300 `Duplicate identifier
  'KbContentTypeMismatchError'`**: cùng một ký hiệu được `import` **hai lần** trong một file. Vitest/
  esbuild nuốt được; `tsc` thì không. Không đổi kết luận ca nào, nhưng là dấu của một lượt gộp tay.

---

## 3. CÁCH CHỮA ĐÃ CHỌN — và vì sao

**Số đo nói: 710 lỗi / 174 file ⇒ LỚN.** Theo đúng nhánh "số lớn" của brief: **KHÔNG** sửa hàng trăm
lỗi trong một lượt, **KHÔNG** bỏ dòng loại trừ trong `tsconfig.json`.

Nhưng có một lựa chọn nữa phải nói rõ, vì nó quyết định giá trị của cả món nợ:

> **danh sách CHO PHÉP** (chỉ canh vài thư mục sạch) **hay danh sách CÁCH LY** (canh tất, trừ đúng
> 174 file đang nợ)?

Chọn **CÁCH LY**. Lý do: với danh sách cho phép, một file test **MỚI** viết ngày mai nằm ngoài phạm
vi ⇒ **không được canh** ⇒ lớp lỗi này tiếp tục sinh ra sau khi ta vừa trả nợ. Với danh sách cách ly,
mặc định là **được canh**; nợ là **hữu hạn, có tên, chỉ co lại**. Cùng chi phí, khác hẳn chiều.

### Đã làm

| # | thay đổi | ghi chú |
|---|---|---|
| 1 | **`tsconfig.tests.json`** (mới) | `extends ./tsconfig.json`; `include` y hệt; `exclude` = 5 mục gốc + **174 file nợ liệt kê từng dòng**; `tsBuildInfoFile` **riêng** (`tsbuildinfo.tests`) để không đụng sổ của `npm run check` |
| 2 | **`package.json`** | `"check:tests": "cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit -p tsconfig.tests.json"` |
| 3 | **`.github/workflows/ci.yml`** | thêm bước `Typecheck (file test — tsconfig.tests.json)` ngay **sau** bước `Typecheck`, trong job `build-test` |

`tsconfig.json` **không đổi một ký tự** — `npm run check` giữ nguyên phạm vi, nguyên tốc độ, nguyên
sổ biên dịch.

### Nghiệm thu cổng

```
npx tsc --noEmit                                  →  exit 0   (npm run check — KHÔNG đổi)
npm run check:tests                               →  exit 0   (~93 s, không cache)
```

⚠ Chi phí CI: **+~90 s** cho job `build-test`. Job đó đang `timeout-minutes: 25`; bước `Typecheck`
hiện tại vốn đã chạy `tsc` trên cùng cây, nên đây là ~1 phút thêm chứ không phải nhân đôi.
`cross-env NODE_OPTIONS=--max-old-space-size=8192` là bắt buộc — không có nó `tsc` hết bộ nhớ trên
cây này.

---

## 4. NGHIỆM THU — cơ chế có BẮT ĐƯỢC đúng hình dạng lưới giả đã biết không

Cơ chế đã commit ở `175c4187` **trước** khi đột biến (kỷ luật *"COMMIT TRƯỚC, ĐỘT BIẾN SAU"*).

Dựng `server/services/vram/_muta_luoiGia.test.ts` — tái hiện **đúng** ca mà Pha 3 tự dẫm: gọi
`computeHeadroom()` bằng **SÁU tên ô SAI** (`ceiling` · `ledgerTotal` · `attributable` ·
`safetyReserve` · `baselineOk` · `tick` thay cho `ceilingBytes` · `ledgerTotalBytes` ·
`attributableBytes` · `safetyReserveBytes` · `baselineVerified` · `tickPresent`), rồi khẳng định
`headroomBytes === headroomBytes − 1 GiB`.

**Hai lượt đo, ngược chiều nhau — đó mới là nghiệm thu:**

```
(1) npx vitest run server/services/vram/_muta_luoiGia.test.ts
      ✓ server/services/vram/_muta_luoiGia.test.ts (1 test)
      Tests  1 passed (1)                    ← LƯỚI GIẢ XANH. Lớp lỗi CÓ THẬT.

(2) npm run check:tests
      server/services/vram/_muta_luoiGia.test.ts(13,7): error TS2353:
        Object literal may only specify known properties, and 'ceiling'
        does not exist in type 'HeadroomInput'.
      EXIT = 2                               ← CỔNG MỚI BẮT ĐƯỢC.
```

Sáu ô sai ⇒ mọi trường `undefined` ⇒ `invalidInput` ⇒ `headroomBytes = -Infinity` ⇒
`-Infinity === -Infinity − 1 GiB` là **TRUE** ⇒ ca xanh dưới **mọi** đột biến của công thức.
Vitest không thấy gì; cổng mới đỏ ngay dòng đầu tiên.

⚠ Điểm phải nói thẳng: cổng bắt được **vì file đó KHÔNG nằm trong danh sách cách ly**. Nếu hôm nay
ai đó dán một lưới giả y hệt vào một trong 174 file đang cách ly thì **cổng vẫn mù**. Đó là giá của
việc trả nợ dần — và là lý do danh sách phải **chỉ co lại**.

**Đã xoá đột biến. Xác nhận:**

```
git status --porcelain -- server/ client/ drizzle/ shared/   →  0 dòng
npm run check:tests                                          →  exit 0
npx vitest run server/services/vram/                         →  699/699 (37 file)
```

---

## KẾT LUẬN NỢ 1

| câu hỏi | trả lời |
|---|---|
| bao nhiêu lỗi kiểu bị dòng loại trừ giấu đi? | **710**, ở **174/820** file test |
| có lỗi nào ngoài file test không? | **0** ⇒ `npm run check` an toàn tuyệt đối |
| lưới giả **thật sự** tìm được? | **13 điểm · 2 file · 8 ca**, đều là *"kiểm một hàm sản xuất không tồn tại"* |
| cách chữa? | **config phụ + bước CI**, danh sách **CÁCH LY** (không phải cho phép) |
| `npm run check` có chậm đi/đỏ lên không? | **không** — `tsconfig.json` không đổi một ký tự, sổ biên dịch tách riêng |
| cơ chế có bắt được lưới giả không? | **có**, đã chứng minh bằng đột biến rồi xoá |

---

# NỢ 2 — Ô 100,7 % CỦA ĐỢT 2, ĐO LẠI DƯỚI PHA 3

## 1. BẢNG ROSTER CỦA ĐỢT 2 — nó được tính như thế nào

Nguồn: `docs/superpowers/reports/2026-08-02-dot2-report.md:1324` + `:1031` (bảng nền ba đợt), và hai
spec (`2026-08-01-ai-local-model-strategy-design.md:291,294` ·
`2026-08-01-ai-local-hybrid-internal-code-profile-design.md:165,167`).

**Ô là:** *biến thể lành nhất — `deep = code = Coder-30B`, **giữ FIM 1,5B riêng**, sidecar thị giác
**thức**, **LÚC NGHỈ** (không sinh gì cả)*.

**Cách tính: một PHÉP CỘNG sáu số hạng, mỗi số hạng là một `nvidia-smi` delta đo riêng qua đường
sản xuất, chia cho trần thiết bị 32.607 MiB** (= `memory.total` của RTX 5090; ba ô khác của bảng
kiểm chéo đúng mẫu số này: 32.518/32.607 = 99,7 % · 31.716/32.607 = 97,3 %).

```
nền 1.200 + Coder-30B 19.077 + Qwen3-Embedding-0.6B 2.232 + ONNX 329
          + FIM Qwen2.5-Coder-1.5B 2.188 + sidecar thị giác 7.821
        = 32.847 MiB / 32.607 = 100,7 %   ❌ VƯỢT TRẦN
```

## 2. CẤU HÌNH `.env` ĐANG CHẠY — vẫn đúng cái roster đó, và còn NẶNG HƠN

```
GGUF_DEFAULT_MODEL = Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf
GGUF_CODE_MODEL    = Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf
GGUF_FIM_MODEL     = Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf     ← FIM RIÊNG, y như Đợt 2
GGUF_MAX_LOADED_MODELS = 4 · GGUF_VRAM_GUARD_PCT = 100 (mặc định) · VRAM_SAFETY_RESERVE_MB = 1024 (mặc định)
```

⚠ Ô 100,7 % giả định **biến thể LÀNH NHẤT** (`deep = code = Coder-30B`, chỉ MỘT model 30B). `.env`
đang chạy nêu **HAI model 30B khác nhau**. Cùng phép cộng, thêm `Qwen3-30B-A3B-Instruct` **19.094**
(cùng bảng nền Đợt 2) ⇒ `51.939 MiB = 159,3 %`. Tức ô 100,7 % là **cận DƯỚI** của cấu hình đang
chạy, không phải cận trên.

## 3. ĐO LẠI

### (a) Số hạng đo lại được hôm nay — sidecar thị giác

Đo bằng **đúng đường sản xuất**: `llama-server.exe` thật, đúng args của `llamaVisionSidecar.ts`
(`-m Qwen3-VL-8B-Instruct-UD-Q4_K_XL --mmproj Qwen3-VL-8B-mmproj-F16 -ngl 999 -c 8192 -np 1 --jinja`),
`nvidia-smi` trước/sau, dọn theo **đúng PID** (22676), không quét mù theo tên.

```
NỀN            = 1.173 MiB
SAU NẠP        = 8.992 MiB   (healthy sau 6.156 ms)
DELTA SIDECAR  = 7.819 MiB          ← Đợt 2 công bố 7.821  ⇒  Δ = −2 MiB
SAU DỌN        = 1.163 MiB   (PID 22676 đã chết)
```

−2 MiB nằm **sâu trong** biên nhiễu ±~25 MiB của repo này. **Số hạng KHÔNG ĐỔI.**
Kiểm chéo độc lập: Pha 3 Task 1 đã đo 5 lượt spawn→stop trên chính sidecar này và ghi
**7.825–7.840 MiB** vào docstring `llamaVisionSidecar.ts:602-605` — cùng dải.

### (b) Các số hạng KHÔNG đo lại được hôm nay — mang sang, có khai

`Coder-30B 19.077` · `embedding 2.232` · `FIM 2.188` · `ONNX 329` đều được Đợt 1/Đợt 2 đo qua đường
**node-llama-cpp trong tiến trình app**. Trên máy này `getLlama()` **không nạp được trong tiến trình
`tsx` trần** ⇒ đo lại bằng `llama-server` sẽ là **một loader KHÁC** ⇒ so với số cũ là vô nghĩa
(đúng điều bị cấm). **Mang sang nguyên số, và ghi rõ là mang sang.**
Nền: Đợt 2 giữ `1.200` để ba đợt trừ được cho nhau; hôm nay đo `1.163–1.180` — giữ `1.200`.

### (c) PHÉP CỘNG CHẠY LẠI — cùng công thức, cùng mẫu số

| số hạng | Đợt 2 | hôm nay | nguồn |
|---|---:|---:|---|
| nền hệ điều hành | 1.200 | 1.200 *(đo 1.163–1.180)* | giữ để so được |
| sidecar thị giác | 7.821 | **7.819** | **ĐO LẠI, đường sản xuất** |
| Coder-30B | 19.077 | 19.077 | mang sang (Đợt 1 §4) |
| Qwen3-Embedding-0.6B | 2.232 | 2.232 | mang sang (Đợt 2 §3) |
| FIM Qwen2.5-Coder-1.5B | 2.188 | 2.188 | mang sang (Đợt 2 §6(ii)) |
| phiên ONNX dinov2 | 329 | 329 | mang sang (Đợt 2 §7) |
| **TỔNG** | **32.847** | **32.845** | |
| **% trần 32.607** | **100,7 %** | **100,7 %** | |

## ★ TRẢ LỜI DỨT KHOÁT: **CÒN VƯỢT 100 %.** `32.845 MiB = 100,7 %`, vượt trần **238 MiB**.

Pha 3 **không giành lại một byte nào** ở ô này, và không hề định làm thế — Pha 3 là sổ chung và
cưỡng chế, không phải một đợt giành VRAM. Ô lật dấu ở Đợt 2 vẫn đang lật.

## 4. CƠ CHẾ NÀO ĐANG GIỮ NÓ KHÔNG NỔ — ĐO, KHÔNG SUY

Chạy `reserve()` **thật** của Pha 3 (module thật, `.env` thật, trần hiệu lực thật = 32.607 MiB) và
seat đúng roster trên, đọc kết cục từng lượt.

**Thứ tự A — sidecar tới TRƯỚC (app khởi động với vision thức):**

| lượt xin | kết cục | dư địa hiệu lực còn |
|---|---|---:|
| sidecar 7.819 | ✅ CẤP | 23.764 |
| Coder-30B 19.077 | ✅ CẤP | 4.687 |
| embedding 2.232 | ✅ CẤP | 2.455 |
| FIM 2.188 | ✅ CẤP | **267** |
| **ONNX 329** | **⛔ TỪ CHỐI — thiếu 62 MiB** · `trusted=true` · `reasons=[]` · **`wouldPreempt=[]`** | — |

**Thứ tự B — sidecar tới CUỐI (model đã nóng, rồi có người tải một tấm ảnh lên):**

| lượt xin | kết cục |
|---|---|
| Coder-30B · embedding · FIM · ONNX | ✅ CẤP hết (Σ 23.826) |
| **sidecar 7.819** | **⛔ TỪ CHỐI — thiếu ĐÚNG 62 MiB** · **`wouldPreempt=[model nhúng Qwen3-Embedding-0.6B]`** |

**⇒ Cơ chế giữ nó không nổ là: TỪ CHỐI người tới SAU, rồi NHƯỜNG CHỖ.**
Thiết bị dừng ở `32.516 / 32.607` (thứ tự A) hoặc `25.026 / 32.607` (thứ tự B) — **không tràn**.
Ở thứ tự B, nhường model nhúng (2.232) trả lại `7.757 + 2.232 = 9.989 > 7.819` ⇒ sidecar vào được.
Đây **đúng** là *"ô được giải BẰNG CƠ CHẾ"* của spec §10: roster **không vừa**, và ai đó **phải**
nhường — Pha 3 quyết định ai, một cách tất định, có tên, và `trusted=true`.

## 5. BA ĐIỀU PHẢI NÓI THẲNG — cái giá, và một quả chưa nổ

**(i) Biên quyết định chỉ 62 MiB.** Cả hai thứ tự đều thiếu **đúng 62 MiB** — chỉ **2,5 lần** biên
nhiễu đo ±25 MiB của chính repo này, và **0,19 %** trần. Một lượt đo lệch, một bản driver, một tab
Chrome nữa là đổi bên. *Không* nên trích 62 MiB như một con số ổn định.

**(ii) 62 MiB quyết định mất cái gì — và nó phụ thuộc THỨ TỰ, không phụ thuộc GIÁ TRỊ.** Thứ tự A
mất một phiên ONNX **329 MiB**; thứ tự B mất **toàn bộ năng lực thị giác 7,8 GB** (hoặc phải giết
model nhúng). Cơ chế từ chối **người tới sau**, không phải người rẻ nhất. Ở thứ tự A
`wouldPreempt=[]` ⇒ hộ `background` bị từ chối **không có đường lùi** — đúng nhánh "suy giảm tại
chỗ" mà review toàn nhánh (6)#5 đã khai.

**(iii) ★★ MỘT QUẢ CHƯA NỔ, ĐO ĐƯỢC, KHÔNG PHẢI SUY LUẬN — đệm an toàn NHỎ HƠN nền desktop.**
Trần đi vào công thức là **tổng THÔ của thiết bị** (`deviceUsableBytes() = 32.607 MiB`,
`GGUF_VRAM_GUARD_PCT = 100`), còn `attributableBytes = deviceUsed − baseline` **đã TRỪ nền ra**.
Nghĩa là nền desktop **không bị tính vào vế nào**; thứ duy nhất che nó là
`VRAM_SAFETY_RESERVE_MB = 1024` — và docstring `vramCaps.ts:144-146` nói thẳng đệm này
***"KHÔNG phải nền desktop"***.

Số đo hôm nay: nền = **1.163 – 1.180 MiB**. Đệm = **1.024 MiB**.

```
cổng cho phép:  Σ giấy phép ≤ 32.607 − 1.024 = 31.583 MiB
thiết bị chịu:  Σ giấy phép ≤ 32.607 − 1.173 = 31.434 MiB
                                     ⇒ CHÊNH 149 MiB ĐƯỢC CẤP PHÉP VƯỢT
```

Đo được trực tiếp trong lượt chạy: sau bốn giấy phép `Σ = 31.316` và dư địa hiệu lực còn `267 MiB`.
Ai xin đúng 267 MiB nữa sẽ **được cấp** ⇒ `31.583 + 1.173 = 32.756 MiB` trên một thiết bị **32.607**.

⚠ **KHÔNG nới và KHÔNG sửa hằng số nào** (đúng điều bị cấm). Ghi lại để chủ dự án quyết:
đặt `VRAM_SAFETY_RESERVE_MB ≥ 1200` sẽ đóng, nhưng đó là một **quyết định chính sách** — nó cắt
~176 MiB khỏi ngân sách của **mọi** máy, và ở biên 62 MiB thì nó **lật cả hai lượt từ chối ở trên
thành từ chối SỚM HƠN**. Phải đo lại roster sau khi đổi, không được đổi rồi tuyên bố.

## KẾT LUẬN NỢ 2

| câu hỏi | trả lời |
|---|---|
| ô 100,7 % đo lại được bao nhiêu? | **32.845 MiB = 100,7 % trần 32.607** (Đợt 2: 32.847 = 100,7 %) |
| còn vượt 100 % không? | **CÒN. Vượt 238 MiB.** Pha 3 không giành byte nào ở ô này |
| số hạng nào thực sự được đo lại? | sidecar thị giác **7.819** (Đợt 2: 7.821, Δ −2) · nền 1.163–1.180. Bốn số hạng còn lại **mang sang, có khai** |
| cơ chế nào giữ nó không nổ? | **`reserve()` TỪ CHỐI người tới sau** (thiếu 62 MiB), rồi **`preempt()` nhường model nhúng**. Thiết bị dừng ở 32.516 / 32.607 — **không tràn**. Đây ĐÚNG là "giải bằng cơ chế" |
| còn quả chưa nổ nào không? | **CÓ.** `VRAM_SAFETY_RESERVE_MB = 1024` < nền desktop đo được **1.173** ⇒ cổng cấp phép **vượt thiết bị ~149 MiB** khi sổ đầy. Không sửa, ghi lại |

⇒ Câu đúng phạm vi để ghi vào spec §10: ***"ô 100,7 % KHÔNG được giải bằng cách giảm byte — nó vẫn
ở 100,7 %. Nó được giải bằng CƠ CHẾ: roster không vừa, và Pha 3 quyết định tất định ai không được
ngồi. Biên của quyết định đó là 62 MiB, và đệm an toàn hiện nhỏ hơn nền desktop 149 MiB."***

---

## XÁC NHẬN CUỐI

```
git status --porcelain -- server/ client/ drizzle/ shared/   →  0 dòng
nvidia-smi memory.used                                       →  1.169 MiB (không còn llama-server nào)
npm run check                                                →  exit 0
npm run check:tests                                          →  exit 0
npx vitest run server/services/vram/                         →  699/699 (37 file)
```

Script đo đặt ngoài repo (scratchpad) + một file tạm ở gốc repo đã xoá. Sidecar dọn theo **đúng
PID 22676**, không quét mù theo tên. **KHÔNG** chạy `kb:sync`, **KHÔNG** DDL, **KHÔNG** trainer.
243 mục bẩn của việc KHÁC (`knowledge/**`, `tools/machine-simulator/**`, `docs/ECOSYSTEM/**`, ảnh
`.png` ở gốc): **không đụng, không dọn, không stage**.

### KHÔNG LÀM — kèm lý do

| mục | lý do |
|---|---|
| Sửa 710 lỗi kiểu / gỡ dòng loại trừ trong `tsconfig.json` | Số đo nói LỚN (710/174 file). Brief chỉ đường: config phụ + bước CI, mở rộng dần. Sửa hàng trăm lỗi trong một lượt là đúng thứ brief cấm |
| Sửa/xoá 8 ca lưới giả ở `machineStatus.test.ts` + `sessionBackup.test.ts` | Hàm không tồn tại ⇒ "sửa" = **xoá ca**, tức đổi vùng phủ của hai module không thuộc nhánh này. Đã cách ly + ghi địa chỉ để người sở hữu quyết |
| Đo lại 4 số hạng bằng `llama-server` | Đó là **loader KHÁC** với loader đã sinh ra 19.077/2.232/2.188/329. So hai phép tính khác nhau là vô nghĩa — brief cấm đích danh |
| Đổi `VRAM_SAFETY_RESERVE_MB` để đóng lỗ 149 MiB | *"không nới một hằng số nào để con số đẹp lên"*. Là quyết định chính sách của chủ dự án, và phải **đo lại** roster sau khi đổi |
