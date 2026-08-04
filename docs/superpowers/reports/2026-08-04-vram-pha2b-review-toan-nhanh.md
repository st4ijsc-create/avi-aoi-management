# REVIEW TOÀN NHÁNH — Pha 2B (cưỡng chế VRAM)

Nhánh `feat/hmi-dep` · 26 commit `7adfb8c8..dcf402fa` · 54 file · +14.092/−630
Reviewer: một mình, tuần tự, không sub-agent.

**KẾT LUẬN: CHƯA SẴN SÀNG MERGE** — 2 Critical (1 đột biến SỐNG SÓT, 1 hợp đồng người-thi-hành
sai) + 4 Important, trong đó ba mục đổi kết luận về hành vi trên `.env` THẬT.

Nền đã tự kiểm (không tin báo cáo):
- `npx vitest run server/services/vram/` ⇒ **539/539 xanh**, 30 file (chạy 4 lần trong lượt này).
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` ⇒ **exit 0**.
- `git grep "temporary overflow" -- server/ client/ shared/ drizzle/ scripts/ tools/` ⇒ **RỖNG**.
- `git status --porcelain -- server/ client/ drizzle/ shared/` ⇒ **rỗng** trước/sau MỖI đột biến.

---

## (3) ĐỘT BIẾN — hai món còn nợ + một món tự tìm

| # | Đột biến | Kết quả |
|---|---|---|
| A | Gỡ `ttlMs` khỏi `visionSidecarVramRequest()` (`llamaVisionSidecar.ts:204`) | **1 ĐỎ / 539** — `wiring.outofprocess.test.ts:135`, ca đi qua ĐƯỜNG SẢN XUẤT (`ensureSidecar()` spawn thật). **Lưới có thật.** |
| B | Gỡ `configDefaultBytes` (`llamaVisionSidecar.ts:201`) | **1 ĐỎ / 539** — cùng ca, `:140` (`estimateSource` tụt `config-default` → `unknown`). **Lưới có thật.** |
| C | **TỰ TÌM** — gỡ `reclaimer: "gguf-idle-model"` ở `aiGgufEngine.ts:881` | **★★★ 0 ĐỎ / 539 — SỐNG SÓT**, tsc sạch. |

Sau mỗi lượt: `git checkout -- <file>` → status rỗng → chạy lại TOÀN BỘ ⇒ 539/539.

---

## PHÁT HIỆN

### 🔴 C-1 (Critical) — ĐỘT BIẾN SỐNG SÓT: lời khai người thi hành của hộ GGUF không có lưới
`server/services/aiGgufEngine.ts:881` (và anh em ở đường dự phòng `:927`).

Mọi ca chạm vị từ đều tự khai `reclaimer` **bằng tay** (`consolidation.test.ts:434 · :444 · :450 ·
:480 · :481`). Không ca nào đọc cái mà đường sản xuất THẬT SỰ gửi đi.

Đây **đúng lớp** Task 7 vừa vá cho `vision-sidecar` (đột biến 7 đã sống sót rồi được vá bằng
`visionSidecarVramRequest()` + ca `consolidation.test.ts:462`) — nhưng lượt vá chỉ vá **một trong
hai**, và bỏ lại cái **quan trọng hơn**: `gguf-idle-model` là người thi hành DUY NHẤT chạy hằng ngày.

Hậu quả nếu regress (IM LẶNG toàn bộ): `nguoiThiHanhThuHoi()` → `null` cho mọi model GGUF ⇒
`preemptPlan()` rỗng vĩnh viễn ⇒ `evictLRU()` vừa hấp thụ thành MÃ CHẾT ⇒ nhánh
`if (thuHoi.reclaimed.length > 0)` (`vramWiring.ts:741`) không bao giờ chạy ⇒ **mọi lượt hết
khe/hết byte thành TỪ CHỐI CỨNG thay vì "dọn rồi cấp"** — đúng chiều dừng dây chuyền. Kèm:
`reclaimable:false` ở mọi hộ ⇒ `preemptableBytes = 0` ⇒ câu từ chối in *"CÓ cơ chế thu hồi: không có"*.

**Vá:** rút object yêu cầu ra hàm thuần `ggufModelVramRequest(...)` (cùng khuôn Task 7 đã dùng) +
một ca đọc đúng object đó, đặt cạnh ca `:462`.

⚠ Lớp *"lưới đi theo FILE chứ không theo ĐƯỜNG THOÁT"* tái diễn **LẦN THỨ TƯ** (T5 → T6 → T7 → đây),
lần này **bên trong chính bản vá** dựng ra để đóng nó.

### 🔴 C-2 (Critical) — người thi hành `vision-sidecar` khai "xong" TRƯỚC khi thiết bị nhả; lượt xin vẫn hỏng
`server/services/vram/vramPreempt.ts:73-77` vs hợp đồng ghi ở `:49-51` của **chính file đó**:
> *"Mỗi người thi hành trả `true` chỉ khi nó đã **thật sự dispose/giết**, KHÔNG phải khi nó 'đã gọi lệnh'."*

`stopSidecar()` (`llamaVisionSidecar.ts`) **KHÔNG chờ tiến trình chết**: nó gửi `SIGTERM`, đặt một
`setTimeout(...).unref()` 5.000 ms cho `SIGKILL`, rồi **return ngay**. Giấy phép chỉ được nhả ở
`proc.on("exit")`. Nhưng người thi hành `return true` vô điều kiện. Chuỗi thật:

1. `preempt()` → `reclaimed = ["sidecar:vision"]`, `freedBytes = 0` (sổ chưa nhả — đúng như
   `preempt()` tự đo);
2. `vramWiring.ts:741` thấy `reclaimed.length > 0` ⇒ **xin lại NGAY** (`ĐÚNG MỘT LƯỢT, không vòng lặp`);
3. sổ vẫn còn giấy phép 7,8 GB ⇒ **TỪ CHỐI LẦN HAI**.

⇒ **Giết hộ tiêu thụ LỚN NHẤT hệ (7,8 GB, khởi động lại tốn tới `READY_TIMEOUT_MS` = 120 s) và lượt
xin VẪN HỎNG.** Mở rộng lớn nhất của Task 7 trên thực tế là net-âm cho lượt xin đang chạy.

Không lưới nào bắt: `consolidation.test.ts:53` thay `stopSidecar` bằng bản giả (`importOriginal`,
chỉ giữ phần còn lại), nên ngữ nghĩa bất đồng bộ THẬT chưa từng chạy trong test.

**Vá tối thiểu:** `stopSidecar()` trả `Promise` chờ `exit` (hoặc `preempt()` chờ giấy phép rời sổ
với hạn giờ) trước khi khai `true`; nếu không chờ được thì khai `false` và đừng xin lại.

### 🟠 I-1 (Important) — `.env` THẬT đặt `GGUF_VRAM_GUARD_PCT=90`; toàn bộ lập luận "sai lệch có chủ ý" của Task 7 KHÔNG áp dụng cho máy này
`.env:131` ⇒ `GGUF_VRAM_GUARD_PCT=90`. `vramCaps.ts:57-66` biện minh cho việc đổi **mặc định**
90→100 bằng câu: *"Ai muốn thêm một sàn phần trăm CỨNG thì đặt `GGUF_VRAM_GUARD_PCT=90` **tường
minh** và nhận đúng hậu quả đó."* — repo này **đã đặt tường minh**, và không ai nhận ra.

Hệ quả đo được: `usableCeilingBytes` = `floor(32.607 × 0,90)` = **29.346 MiB**, tức **−3.261 MiB**
so với mọi con số trong báo cáo. Dư địa hiệu lực ổn định của `worker` **không phải ~30.559 MiB** mà
≈ **26.274 MiB** (29.346 − 1.024 đệm − 1.024 biên tuổi − 1.024 `unverified-baseline`).
Task 7 tự khai *"trần ĐẾM là một nguồn TỪ CHỐI MỚI, chưa chạy thử với `.env` thật"* — điều này đúng
cho **cả trần BYTE**, và không ai đo lại sau Task 7. Khối 30B (~16.870 MiB) vẫn vừa, nên **chưa
dừng dây chuyền** — nhưng mọi con số nghiệm thu đang sai 3.261–4.285 MiB theo chiều LẠC QUAN.

**Phải làm trước merge:** hoặc gỡ `GGUF_VRAM_GUARD_PCT` khỏi `.env`, hoặc chạy lại một lượt nghiệm
thu sống với `.env` thật và sửa con số trong báo cáo. Đừng để hai nghĩa của "90" cùng tồn tại.

### 🟠 I-2 (Important) — `preemptPlan()` DỌN THỪA ở nhánh chỉ-thiếu-KHE, ngược đúng câu nó tự khai
`vramBroker.ts:314-327`:
```
if (freed >= enough && slots >= slotsNeeded) break;
… if (nguoi === null) continue;  out.push(…); freed += …; if (kind === "gguf-model") slots += 1;
```
Khi từ chối là do **KHE** (`deficitBytes = 0`, xảy ra ở `vramWiring.ts:738` vì
`est − effective < 0` ⇒ `Math.max(0, …)`), điều kiện `freed >= 0` đã đúng ngay từ đầu, nên vòng lặp
chỉ dừng khi `slots >= slotsNeeded`. **Mọi ứng viên có người thi hành đứng TRƯỚC model GGUF cần dọn
đều bị đẩy vào kế hoạch, kể cả khi nó không góp một KHE nào** — điển hình `sidecar:vision`
(`interactive`, nhàn rỗi, `acquiredAt` cũ hơn ⇒ xếp trước theo `xepThuTuNhuong` bước 3).

⇒ Để giành **một khe GGUF**, hệ có thể giết **7,8 GB sidecar thị giác** — thứ không giải phóng khe nào.

Mâu thuẫn trực tiếp với bảng ở `vramPreempt.ts:11` (*"dừng khi | **đủ byte VÀ đủ khe**, không dọn
thừa"*) và docstring `preemptPlan()`. Ca `consolidation.test.ts:372` (`preemptPlan("interactive",
0, 1)`) **không phân biệt được** vì cả ba hộ trong ca đều là `gguf-model`.

**Vá:** bỏ qua ứng viên không góp vào điều kiện còn thiếu (`if (freed >= enough && kind !==
"gguf-model") continue;`), + một ca có hộ non-GGUF xếp trước.

### 🟠 I-3 (Important) — từ chối vì HẾT KHE in ra một câu tự mâu thuẫn, và trên client thì KHÔNG NÊU LÝ DO
`vramRefusal.ts:393` dựng đầu câu `Không đủ VRAM … xin N MiB, còn M MiB.` Với refusal thuần
`gguf-slot-cap`, dư địa byte còn **thừa thãi** ⇒ câu ra dạng *"xin 1.000 MiB, còn 25.000 MiB"*.
Lý do thật chỉ lọt vào mệnh đề `Con số này kém tin hơn bình thường (gguf-slot-cap)` — **khung sai**
(đây không phải "số kém tin", đây là một trần ĐẾM cứng).

Nặng hơn ở đường i18n: khuôn `VRAM_REFUSED` / `VRAM_REFUSED_WITH_REASON` (`vi.json:3566-3567`)
**không có ô `{{degradedReasons}}`** — chỉ `VRAM_HEADROOM_UNKNOWN` mới có. ⇒ Với người vận hành,
`gguf-slot-cap` **biến mất hoàn toàn**; họ đọc "còn 25.000 MiB" rồi đi tìm lỗi ở chỗ không có lỗi —
đúng ca mà `refusalFactsFor()` docstring (`vramBroker.ts:356-359`) tự dựng lên để chống.

Kèm một bất biến gãy: `vramBroker.ts:513-525` nối `"gguf-slot-cap"` vào `reasons` **SAU** khi
`enf.trusted` đã tính ⇒ `decision.trusted === true` cùng lúc `decision.reasons.length > 0`, trong
khi `vramRefusalAppError()` lại suy `trust` từ `degradedReasons` ⇒ **nhật ký nói `trusted`, client
nói `degraded`** cho cùng một lượt.

### 🟠 I-4 (Important) — TÀI LIỆU AN TOÀN ĐÃ LỆCH KHỎI MÃ ở ba file: `api` KHÔNG còn "mù vĩnh viễn"
Task 2 (I-1, `212c2aea`) đã nhấc `startVramReconciler()` ra khỏi `startBackgroundSchedulers()` lên
`server/_core/index.ts:5266` — **TRƯỚC** nhánh rẽ `ROLE`, `api` chạy với `ring:false`, và
`__runReconcileTick()` gọi `publishDecisionTick()` **bất kể `ring`** (`vramReconciler.ts:926`).
⇒ Tiến trình `api` **CÓ tick**.

Nhưng ba nơi viết sau đó vẫn khai ngược:
- `vramWiring.ts:671-674` — *"`readDecisionTick()` trả `null` ở tiến trình `api` **vĩnh viễn**
  (`startVramReconciler` không chạy ở vai trò đó — `backgroundJobs.ts`)"*;
- `vramEnforcement.ts:80-81` — *"ở tiến trình `api` (mù VĨNH VIỄN …) hệ luôn trả **ba** đơn vị"*;
- `progress.md` Task 5 — *"nhánh THƯỜNG TRỰC của sản xuất: no-tick + unverified-baseline, phụ phí
  3.072 MiB"*.

Đây là **Task 5/6/7 tiêu thụ một sự thật đã bị Task 2 đổi trong CHÍNH nhánh này** — đúng câu hỏi (1).
Hành vi mã vẫn đúng (chính sách đọc tick thật), nhưng: (a) mức nặng nhất `"no-tick"` = 2 đơn vị nay
gần như **bất khả đạt** trong sản xuất — một chính sách được viện dẫn làm lá chắn mà thực tế không
chạy; (b) con số 3.072 MiB trong báo cáo sai; (c) người sau đọc ba file này sẽ suy luận sai về
posture của `api`.

⚠ Kèm một hệ quả **chưa ai nêu**: `api` và `worker` nay **cùng chụp nền trên MỘT thiết bị**. Nếu
`api` khởi động lại khi `worker` đang giữ 17 GB, nền của `api` **nuốt trọn 17 GB đó**
(`baselineVerified=false` là toàn bộ phản ứng ⇒ **1.024 MiB** phụ phí cho một sai số **17.000 MiB**).
Bù trừ 17× thiếu. Sổ chung là Pha 3, nhưng con số phụ phí này nên được nói đúng vai.

### 🟡 M-1 — trần thiết bị của `api` là hằng số của MỘT máy, và nguồn "số đo" không với tới được
`vramBroker.ts:16-24` khai ba nguồn trần, nguồn (2) là *"SỐ ĐO THẬT — `vramProbe.probeOnce()` …
nên trần tự đúng trên MỌI máy sau lượt đo đầu tiên **mà không ai phải khai báo gì**"*.
`noteDeviceTotalBytes()` chỉ được gọi từ `vramProbe.ts:72`, và `.env` **không đặt**
`VRAM_DEVICE_TOTAL_MB` (chỉ có trong `.env.example:560`). Đúng là reconciler nay chạy ở cả `api`
(xem I-4) nên nguồn (2) có tới — nhưng **chỉ sau nhịp đầu**; mọi lượt `beginVramAllocation()` xảy
ra trước nhịp đó chạy trên hằng số **32.607 MiB của MỘT máy phát triển**. Trên card 12 GB đó là dư
địa phóng đại 20 GB, và Pha 2 nay **QUYẾT ĐỊNH** trên con số ấy. Nên hoặc bắt buộc
`VRAM_DEVICE_TOTAL_MB` trong `.env` sản xuất, hoặc coi "chưa có số đo" là một `degradedReason`.

### 🟡 M-2 — dân số của trần ĐẾM rộng ra mà giá trị cấu hình thì không đổi
`kheGgufConThieu()` (`vramBroker.ts:400`) đếm **mọi** giấy phép `kind: "gguf-model"` trong sổ,
gồm cả `reranker:<modelPath>` (`aiReranker.ts:478-483`) — hộ này xin giấy phép **kể cả khi chạy
CPU** (`RAG_RERANKER_GPU=false`, mặc định `.env:416`), giữ nó **suốt đời tiến trình**, `refCount`
đứng nguyên `1` (không ai gọi `noteRefCount`) và **không khai `reclaimer`** ⇒ không nhàn rỗi, không
thu hồi được. Bản cũ (`ensureCapacity`) đếm `loadedModels.size`, **không** gồm reranker.
⇒ `GGUF_MAX_LOADED_MODELS=4` (`.env:124`) nay là **3 model sinh chữ**, không phải 4 — một lượt siết
âm thầm. Docstring gọi đây là "SỬA chứ không phải trôi"; đúng về nguyên tắc, nhưng giá trị cấu hình
của người vận hành chưa được hiệu chỉnh lại và không có dòng nào nói ra.

### 🟡 M-3 — `SAFETY_RESERVE_BYTES` vẫn là `const` mức module
`vramBroker.ts:50`. Task 7 chuyển bốn biến trần sang đọc-lười có bộ nhớ đệm với lý do rõ ràng
(*"một `const` mức module khoá cứng giá trị của lượt nhập ĐẦU TIÊN"*), nhưng ô đệm an toàn — ô đi
thẳng vào công thức §5.6c — thì không. Cùng lớp, khác chỗ.

---

## TRẢ LỜI BẢY CÂU

**(1) Task sau phá bảo đảm của task trước?** — **CÓ, một chỗ có hậu quả tài liệu và một chỗ có hậu
quả cơ chế.** Task 2 (I-1) đổi **dân số của `tickPresent`** (api không còn no-tick); Task 5/6/7 vẫn
viết và lập luận theo dân số CŨ ở ba nơi (**I-4**). Task 7 đổi **dân số của trần ĐẾM** (thêm hộ
reranker) mà không hiệu chỉnh `.env` (**M-2**) và mở rộng `nguoiThiHanhThuHoi` sang
`vision-sidecar` mà **không nối lại người tiêu thụ `preemptPlan`** cho ca chỉ-thiếu-khe (**I-2**).
Các vị từ còn lại (`coThiHanhThuHoi`/`reclaimable` — một bản cài đặt, `holderFactFromLease`;
`measured` — một bản; `baselineVerified`/`trusted`/`degradedReasons`/`blind` —
`computeHeadroom`→`applyEnforcement`→`buildVramRefusal` một chiều; `running`/hoãn — `finally` +
`kbSyncDeferStreakIsAlive` một bản, `chuoiHoanConSong` chỉ uỷ quyền; ba khoá in-flight — gộp
`motLuotThoi()`; `isVramRefusal` — 12/12 điểm gọi `beginVramAllocation` có rethrow ngay tại chỗ)
**đã kiểm từng nơi tiêu thụ và KHỚP**.

**(2) Có đường TỪ CHỐI SAI không?** — **Không có đường từ chối một lượt lẽ ra được cấp trên `.env`
hiện tại**, nhưng có **ba chỗ siết ngoài dự tính**: trần BYTE thật thấp hơn báo cáo 3.261 MiB vì
`.env` đặt `GGUF_VRAM_GUARD_PCT=90` (**I-1**); trần ĐẾM hiệu lực là 3 chứ không phải 4 (**M-2**);
và **C-2** biến một lượt-đáng-lẽ-được-cấp-sau-thu-hồi thành một lượt từ chối + mất 7,8 GB. Chiều
NỚI thì có **M-1** (trần hằng số 32.607 MiB trước nhịp đầu).

**(3) Hai đột biến còn nợ** — `ttlMs`: **1 ĐỎ/539**; `configDefaultBytes`: **1 ĐỎ/539**; cả hai lưới
đi đúng ĐƯỜNG THOÁT sản xuất. **Đột biến tự tìm thứ ba (`reclaimer` GGUF ở `aiGgufEngine.ts:881`)
SỐNG SÓT 0 ĐỎ/539** ⇒ **C-1**.

**(4) Đính chính của Task 7** — **XÁC NHẬN BẰNG MÃ**: `coTheNhuong()` (`vramBroker.ts:217-220`) có
hai đường; sidecar thị giác là `interactive` (không phải `production`) nên khi `refCount === 0` một
lượt `background` **lấy được** chỗ của nó. **Đúng §5.2 cả ba quy tắc.** Rủi ro vận hành CHƯA AI NÊU:
(a) **C-2** — lượt thu hồi đó khai "xong" trước khi tiến trình chết ⇒ giết 7,8 GB mà lượt xin vẫn
hỏng; (b) **I-2** — một lượt chỉ thiếu KHE cũng kéo sidecar vào kế hoạch dù nó không góp khe nào;
(c) giá khởi động lại (tới 120 s) do **người dùng thị giác đầu tiên sau 03:00** trả, không phải cron;
(d) khe hở đồng bộ: `refCount` đọc ĐỒNG BỘ lúc lập kế hoạch, `SIGKILL` xảy ra sau — một request thị
giác đến trong khoảng đó bị giết ngang. ⚠ Kèm mâu thuẫn câu chữ: `vramPreempt.ts:13-17` vẫn khai
tuyệt đối *"HÀM NÀY KHÔNG CỨU ĐƯỢC `kb:sync` … kế hoạch **RỖNG** … Đừng đảo ngược câu này"*, trong
khi đính chính của chính Task 7 nói ngược.

**(5) Chuỗi năm tầng** — **số** nhất quán (một `ledgerTotalBytes` cho cả `max()` lẫn
`unattributed`; `refusalFactsFor` in `effectiveHeadroomBytes` chứ không phải dư địa thô; bất biến
`effective ≤ headroom` có ca cho mọi tập con). **Câu chữ thì KHÔNG**: **I-3** (từ chối vì KHE nói
chuyện BYTE, và trên client mất hẳn lý do; `trusted` vs `degraded` nói ngược nhau), **I-4** (ba file
mô tả sai posture của `api`), **I-2/C-2** (`vramPreempt.ts` hứa "không dọn thừa" và "chỉ trả `true`
khi đã thật sự giết" — mã làm ngược cả hai). Lớp "hứa nhiều hơn dữ liệu" ⇒ **lần thứ chín**.

**(6) Điều kiện ra** — 1 **ĐẠT** (nghiệm thu sống Task 1) · 2 **ĐẠT** (`max()` + mỗi mức một chính
sách; kèm cảnh báo I-4: mức nặng nhất `no-tick` gần như bất khả đạt) · 3 **ĐẠT MỘT PHẦN** — còn hai
suy biến im lặng: C-1 (mất người thi hành, không lưới) và I-3 (lý do `gguf-slot-cap` vô hình với
người vận hành) · 4 **ĐẠT** (bốn thành phần + `coverageTail` bắt buộc) · 5 **ĐẠT** (`production`
chặn ở câu đầu `coTheNhuong()`; chống chết đói có mốc TUYỆT ĐỐI 30 s + ca khoá, `measureLock.
priority.test.ts`) · 6 **ĐẠT** (bốn vết, chuỗi hoãn sống qua khởi động lại, `DeferStreak` hai biến
thể để bản sao vị từ **không viết ra được**) · 7 **ĐẠT** (tự kiểm, rỗng) · 8 **ĐẠT MỘT PHẦN**:
vitest 539/539 + tsc exit 0 tự kiểm; `kb:eval 151/151` **chưa tự kiểm** (ngoài phạm vi cho phép).

**(7) Triage nợ** — **Phải đóng trước merge:** C-1 · C-2 · I-1 (quyết định về `GGUF_VRAM_GUARD_PCT`
trong `.env` + đo lại một lượt) · I-2 · I-3 (ít nhất: thêm `{{degradedReasons}}` vào khuôn
`VRAM_REFUSED*`, hoặc một `appCode` riêng cho trần ĐẾM) · I-4 (sửa ba docstring — chúng đang mô tả
sai một lá chắn). **Để lại được:** `getKbSyncSchedulerStatus().defer` chưa có người đọc sản xuất ·
hoãn mới áp cho 1/6 hộ background · ONNX không thu hồi được (đã khai, Pha 3) · nợ N2-2 (PID cấp lại
chiều PID cha — `max()` đang đỡ) · flushVramEvents theo lô mất một lô khi tiến trình chết ·
M-3. **Không đổi kết luận:** phần còn lại của 13 mục "không bảo đảm" trong `task-7-report.md §9`.

⚠ **Task 6 (bị bỏ lượt re-review) — kiểm kỹ hơn một bậc:** máy móc hoãn **vững**. `running` trả
trong `finally` (`:1715-1718`); `NaN` đi thẳng vào `exceeded` (kêu) chứ không vào `retry` (im);
`DeferStreak` hai biến thể ⇒ bản sao vị từ bị `tsc` chặn, và `chuoiHoanConSong()` chỉ uỷ quyền cho
`kbSyncDeferStreakIsAlive()` (một bản cài đặt); khôi phục sau khởi động lại đọc `vram_events` với
mọi dòng méo mó ⇒ `"none"` (fail-closed); `ensureDeferArmed()` có sàn 60 s. **Không tìm thấy phát
hiện mới nào ở Task 6.**
