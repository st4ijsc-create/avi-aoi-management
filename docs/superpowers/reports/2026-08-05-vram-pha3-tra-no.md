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


