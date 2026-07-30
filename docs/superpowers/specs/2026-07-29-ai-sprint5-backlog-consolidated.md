# Sprint 5 — Backlog hợp nhất sau Wave 0→4

**Ngày lập:** 2026-07-29 · **Nhánh:** `feat/hmi-dep` · **HEAD khi lập:** `208301dc`

**Tài liệu này là điểm bắt đầu cho một session MỚI.** Nó gom toàn bộ nợ đã ghi sổ qua bốn wave, loại những mục đã được wave sau trả, và xếp theo mức thiệt hại thật — không theo thứ tự phát hiện.

---

## 0. Đọc trước — bối cảnh tối thiểu cho session mới

| Wave | Đã làm | Commit |
|---|---|---|
| 0 | Kích hoạt AI chặng cuối | `f02b4b88` |
| 1 | 4 agent chuyên môn gọi-được + **sửa gốc rễ: hệ đang sinh chữ bằng model NHÚNG** | `65dbc2fa` |
| 2 | Sửa 3 đường giao hàng đứt (150 đề xuất→3 áp dụng · kho 0 chunk→trợ lý trích dẫn được · ghost-text) | `8e4d2f66` |
| 3 | Ngừng sản xuất nhiễu tại nguồn (52 cảnh báo→6, một-cảnh-báo-mở mỗi máy×loại) | `f53bb004` |
| 4 | Đo đúng cái vừa sửa (KPI đếm theo lần-tái-diễn, ISA-18.2) | `208301dc` |

Memory: `ai-wave0-activation`, `ai-wave1-specialist-studio`, `ai-wave2-delivery`, `ai-wave3-alert-trust`, `ai-wave4-alert-kpi-truth`.

**Ba bài học đã trả giá để có — mang vào mọi brief của sprint này:**
1. **Mock phải mô tả thế giới CÓ THẬT.** Wave 3+4 có 4 lỗi vì mock trả hình dạng mã thật không bao giờ nhận (`.returning()` khi không gọi; mảng đầy khi driver trả rỗng; `.innerJoin()` bỏ qua điều kiện nối).
2. **Kiểm hợp đồng API TRƯỚC khi viết giao diện.** Hai lần `.map()` liệt kê tay thiếu trường ⇒ tính năng không bao giờ hiện được (`occurrenceCount` ở Wave 3, `resolutionNotes` ở Wave 4).
3. **Nói thẳng brief có thể sai** + chỉ đích danh cần kiểm gì. Wave 4 vẫn có 3 lỗi brief nhưng **cả ba bị bắt ngay trong task**, không lọt vào mã.

**Đã trả rồi — ĐỪNG làm lại:** Wave 3 I3 (KPI đếm theo dòng) → Wave 4 T4 · Wave 3 M5 (nút sinh dự đoán bỏ qua `routeAlert`) → Wave 4 T5 · Wave 3 M3 (dòng `EXPIRED` vô hình) → Wave 4 T6.

---

## 1. NHÓM A — Hệ vẫn làm phiền người thật (ưu tiên cao nhất)

### A1. Thông báo vẫn bắn MỖI LẦN tái diễn — Wave 3 gộp dòng nhưng KHÔNG giảm tải người vận hành
`aiSmartAlertRouter.ts` — thông báo gửi ở Step 4, **trước** khi quyết insert/update.

Hệ quả đo được: máy tái diễn 22 lần/ngày ⇒ **vẫn tới 22 lượt push**, dù bảng cảnh báo chỉ còn 1 dòng. Wave 3 tuyên bố "52 → 6" là đúng về **dòng**, sai nếu ai hiểu là hết nhiễu.

**Vì sao bây giờ mới làm được:** Wave 3 §4.5 và Wave 4 đều từ chối chặn bớt thông báo vì "cần dữ liệu để quyết". Nhật ký lần-tái-diễn (Wave 4) **chính là dữ liệu đó** — nay có rồi.

⚠ Đây là **thay đổi tải thật lên người vận hành** ⇒ phải hỏi chủ dự án trước, không tự quyết.

### A2. Phép "ngập báo động" ISA-18.2 không thể kích hoạt cho MỘT máy
`aiSmartAlertRouter.ts:130-147` return sớm khi `nextCount > 3` trong cửa sổ gộp 5 phút ⇒ **trần cứng 6 lượt/10 phút** cho mỗi `(loại, máy, xưởng)`, trong khi ISA-18.2 cần **>10 lượt/10 phút**.

⇒ Flood chỉ kích hoạt được khi nhiều máy cùng kêu. **Wave 4 sửa xong phần ĐẾM, chưa sửa phần PHÁT HIỆN.**

Cùng gốc với A1 (đều là cửa sổ gộp 5 phút) ⇒ nên làm cùng lúc, nhưng **cẩn thận**: A1 muốn gộp NHIỀU hơn, A2 muốn ghi ĐỦ hơn. Hai hướng ngược nhau — phải tách rõ "ghi nhật ký" (luôn đủ) khỏi "gửi thông báo" (được phép gộp).

### A3. KPI sẽ hiện 0 sau khi triển khai, không giải thích
Nhật ký lần-tái-diễn rỗng lúc bắt đầu (cấm nạp ngược quá khứ — quyết định đúng). Bảng điều khiển sẽ hiện "0 cảnh báo AI" mà không nói vì sao, cho tới khi có cảnh báo mới đi qua `routeAlert`.

Cần một câu trên giao diện kiểu *"chưa có dữ liệu lần-tái-diễn kể từ khi bật tính năng"* — nếu không, người dùng sẽ kết luận "AI hỏng rồi", đúng thứ Wave 3 §6 đã cảnh báo.

### A4. Câu từ chối nạp tài liệu bằng tiếng Anh và khó dùng
`Document exceeds 20971520 bytes` (byte thô, không phải "20 MB") · `Unsupported document type: "pptx". Supported: pdf, docx, md, txt.` · `Failed to fetch` · `File "notes.txt" has a TXT (text) extension but its content is a PNG image…`

Cùng một luồng nạp tài liệu nhưng `kbImageDescriber.ts` lại tiếng Việt ⇒ **không nhất quán ngay trong một luồng**. Người vận hành Việt Nam khó hiểu "magic bytes"/"NUL byte".

**Cách sửa rẻ và đúng** (reviewer Wave 2 đề xuất): **đừng dịch chuỗi máy chủ** (dùng chung nhiều caller) — gắn `code` máy-đọc-được ổn định lên lỗi rồi ánh xạ i18n ở `mapTrpcError` phía client. Một việc, không phải bốn.

---

## 2. NHÓM B — Lỗ hổng đo lường (số liệu có thể nói dối mà không ai biết)

### B1. `classifySuppression` và biểu thức phát cảnh báo là HAI BẢN SAO logic, không test nào so khớp
Wave 3 cố ý giữ hai đường tách biệt để phát hiện sai lệch. Nhưng **không test nào so chúng** ⇒ đổi ngưỡng ở một nơi thì số đếm nói dối mà không ai biết — mà **độ tin của số đếm chính là toàn bộ giá trị** của tính năng đó.

Đặc biệt cấp thiết vì Wave 4 vừa dùng chính số đếm này để phát hiện *"độ tin cậy mới là ràng buộc thật, không phải rủi ro"* (hạ ngưỡng rủi ro 60→25 ⇒ `low-risk` 39→30 nhưng `low-confidence` **2→11**). Nếu số đó sai, kết luận đó sai theo.

### B2. Không test nào chứng minh `occurrenceCount` tới được client
Đúng lớp lỗi đã xảy ra **hai lần** (`occurrenceCount` Wave 3, `resolutionNotes` Wave 4): `.map()` liệt kê tay thiếu trường ⇒ tính năng không bao giờ hiện được. Hiện chỉ được canh bằng mắt người.

### B3. Test còn thiếu, rẻ
- Ca dương tính cho `.md` hợp lệ (hiện chỉ có ca âm tính PNG-trong-`.md`).
- Tổ hợp `unknown-user` + `no-permission` trong `canDecide` — nếu ai đảo hai bước đầu, không test nào bắt.
- `initAlertExpirySweeper` có thật sự gọi `pruneOldOccurrences` không — xoá dòng đó khỏi `setInterval` thì **toàn bộ test vẫn xanh**.

---

## 3. NHÓM C — Dữ liệu không tới đích

### C1. `aiQualityGate.ts:1020` INSERT thẳng, không qua `routeAlert`
⇒ không gộp trùng, không `expiresAt`, **không ghi nhật ký** ⇒ vô hình với KPI. Cờ `ANOMALY_CREATE_ALERTS` mặc định `false`, nhưng bật lên là mất hẳn nhóm `PATTERN_ANOMALY` khỏi KPI, **không một dấu hiệu nào**.

Đây là **nguồn ghi cuối cùng** chưa đi qua cửa chung (Wave 4 đã xử `generatePredictions`).

### C2. `routeAlert` chưa nhận `predictedValue`, `productModelCode`, `modelUsed`
Ba trường mà đường INSERT cũ có ghi. Không màn nào đọc chúng hiện tại, nhưng chúng là dữ liệu thật đang bị bỏ. `modelUsed` bị **gán cứng** `"smart-alert-router"` (`:177`, `:188`), che mất tên thuật toán thật.

### C3. Danh sách "cảnh báo vừa đóng" sắp theo `createdAt`, không theo lúc đóng
`aiRouters.ts:443-444` `orderBy(desc(createdAt)).limit(50)`. Cảnh báo sống 30 ngày rồi vừa bị đóng hôm nay sẽ bị 50 dòng mới-tạo-hơn đẩy ra ⇒ **không bao giờ hiện** trong mục tên là "vừa đóng". Mà cảnh báo sống lâu **chính là loại sweeper hay đóng nhất**.

---

## 4. NHÓM D — Vận hành, rẻ

- **D1.** `.env.example` thiếu `ALERT_TTL_HOURS`, `ALERT_EXPIRY_SWEEP_ENABLED/MINUTES`, `ALERT_OCCURRENCE_RETENTION_DAYS`. ⚠ Đặt retention < 30 ngày sẽ khiến API cửa sổ dài đọc phải khoảng trống **không báo gì**.
- **D2.** 9 khoá `manualHelp.*` chưa có trong `vi/en/zh` (nợ từ doc 37). Vô hại vì mọi `t()` có mặc định tiếng Việt tại chỗ — chỉ khiến bản en/zh hiện tiếng Việt.
- **D3.** `countPendingByProduct` không có `.limit()` (Wave 2). Đúng vẫn đúng; rủi ro chỉ khi tồn đọng một sản phẩm phình to.
- **D4.** `predictive_alert_occurrences.confidenceScore` **được ghi nhưng không nơi nào đọc** — cột chết, hoặc dùng nó, hoặc bỏ.

---

## 4b. NHÓM E — phát sinh KHI THI CÔNG nhóm A (2026-07-30)

Do review tìm ra trong lúc làm nhóm A + B1, **không** thuộc phạm vi đã chốt nên cố ý để lại.

- **E1. `-Infinity` bị chặn ở CỔNG, chưa chặn ở NGUỒN. ⚠ ƯU TIÊN CAO.**
  B1 đã khiến `classifySuppression` chặn `predictedTimeframeHours = -Infinity`, nhưng giá trị đó vẫn được **sinh ra** ở `predictiveMaintenanceService.ts:505-523`: `Math.round(-Infinity)` giữ nguyên `-Infinity`, và `recommendedMaintenanceDate = new Date(-Infinity)` là **Invalid Date** vẫn đi vào `recordMachineHealthSnapshot`.
  Reviewer cuối đánh giá nặng hơn dự tính ban đầu: Invalid Date đưa xuống drizzle/postgres-js có thể **ném `RangeError`**, tức đây có thể là đường sập chứ không chỉ dữ liệu bẩn. Cần task riêng chặn tại nguồn (`Number.isFinite` quanh phép chia ước lượng RUL).

- **E2. Cảnh báo KHÔNG có `machineId` không được cooldown nào chi phối. CẦN CHỦ DỰ ÁN QUYẾT.**
  `routeAlert` chỉ tra cảnh báo đang mở khi `machineId != null`, nên `decideAlertWrite` luôn trả `insert/no-machine` ⇒ `decideNotify` luôn trả `first` ⇒ **luôn báo**. Cooldown 4 giờ không áp dụng cho nhóm này (`YIELD_DROP` cấp nhà máy; `modelAutoRollback.ts:244` không có cả `machineId` lẫn `factoryId`).
  Sprint 5 đã gỡ trần 3 lượt/5 phút vốn là throttle **duy nhất** của nhóm này ⇒ trần thực tế đi từ 3 lên 200 lượt/cửa sổ.
  Chưa hồi quy thực tế vì `alertEvaluatorScheduler` chạy 2 phút/lượt (≈2-3 lượt/cửa sổ, gần như không chạm trần cũ), nhưng van đã mất nếu một nguồn bùng. **Đã tài liệu hoá trong `.env.example`; phần đổi hành vi chờ quyết.**

- **E3. `notificationSentAt` đóng dấu TRƯỚC khi gửi.** Dấu nằm trong khối ghi, lượt gửi thật xảy ra sau. Tiến trình chết trong khe vài mili-giây đó ⇒ cảnh báo mang dấu "đã báo" mà không ai được báo ⇒ im 4 giờ về một máy sắp hỏng. Cùng lớp rủi ro mà §2.4 đã lo cho ca `targets = 0` nhưng bỏ sót ca này.

- **E4. Sai chính tả biến môi trường rơi về mặc định trong im lặng.** `Number("abc")` → NaN ⇒ 240; `-1` ⇒ 240. Người vận hành gõ nhầm khi định **tắt** tính năng sẽ nhận đúng 4 giờ im lặng và không một dòng log. Nên `console.log` một lần lúc khởi động ba giá trị đang có hiệu lực.

- **E5. Van an toàn kêu MỖI lượt khi chạm trần.** Vòng lặp hỏng 1000 lượt/phút sinh 1000 dòng warn/phút. Đánh đổi đúng hướng (log ồn hơn DB ồn) nhưng nên có throttle log.

- **E6. Truy vấn `MIN(occurredAt)` của `occurrenceLog` là toàn bảng, không lọc `lineId`/`machineId`.** Nhất quán với `sourceCounts.predictive` (cũng chưa lọc) nên câu giải thích không sai, nhưng ở màn đã lọc theo máy, một máy im lặng vẫn không được giải thích nếu nhà máy có dữ liệu.

- **E7. Khoảng trống test nhỏ:** khối `try/catch` quanh truy vấn `MIN` (`alarmKpiRouter.ts`) không cô lập test được bằng cơ chế mock hiện tại · nhánh `!input.generatedAt` (`alarmKpiEmptyState.ts`) chưa có test · assert nội dung `console.warn` của van chưa nêu khoá.

---

## 4c. NHÓM F — nợ A4 sau khi di trú xong (2026-07-30)

Cổng đếm `server/routers/**` đã về **0** (1056 → 0, 43 commit). Nhưng review toàn cục chỉ ra mức phủ thật hẹp hơn con số đó gợi ra. Ghi lại trung thực để sprint sau không tưởng nhầm là đã xong.

- **F1. Chỉ ~15% màn hình thật sự hưởng lợi. ⚠ ƯU TIÊN CAO NHẤT.**
  `translateAppError` chỉ chạy khi lỗi đi qua `mapTrpcError`. Đo trên `client/src` (748 file): **535** handler `onError`, chỉ **82 (15%)** qua `mapTrpcError`; **446 (83%) hiện thẳng `.message`** ở 159 file. Chỉ 19/748 file import `lib/trpcErrors`. `client/src/main.tsx` không có handler lỗi toàn cục.
  ⇒ 1061 chỗ máy chủ đã có mã, nhưng phần lớn màn hình vẫn hiện y nguyên chuỗi cũ. **Tuyên bố "người dùng Việt thôi đọc tiếng Anh thô" chỉ đúng cho 15% bề mặt.** Việc còn lại là di trú handler client — đó mới là chỗ người dùng thật sự nhận được giá trị.

- **F2. 75 chỗ `throw new Error(...)` trong chính `server/routers/**` — vô hình với cổng cũ.**
  Trong đó **31 chỗ** là `"Database not available"` — đúng chuỗi mà loạt này tuyên bố đã xoá sổ. tRPC v11 đặt `message = cause?.message` nên chúng đi nguyên vẹn tới client. Đã dựng ngân sách `ALLOWED_RAW_ERROR_THROWS = 75` để không phình thêm; việc di trú là một đợt quét riêng.

- **F3. 64 chỗ / 13 file ngoài `server/routers/**` chưa di trú.** Nặng nhất: `machineAuthService.ts` 17 · `aiAnalyticsScope.ts` 13 · `_core/trpc.ts` 12 (mọi chối-quyền RBAC, mọi gọi chưa đăng nhập) · `securityIdentityRouter.ts` 5 · `thresholdGovernanceService.ts` 5. Hạ tầng lõi + security-critical, cần sprint riêng.

- **F4. Mất thông tin hành-động-được — lớn hơn ước tính ban đầu.**
  **184 chỗ** `fallbackMessage` vốn ĐÃ là tiếng Việt (di trú ở đó là thuần lỗ), và **76 nhóm** trong đó ≥2 nguyên nhân khác nhau nay render một câu y hệt. Nặng nhất: `productionRouters.ts:201/224/238` mất danh sách lệnh trùng lịch + chỉ dẫn `forceOverride=true` ⇒ người dùng **kẹt hoàn toàn**; `deviceAdapterRouter.ts:188` mất "hãy tắt trước khi xoá"; `defectDispositionRouter.ts:167` mất "Vào Cài đặt > Bảo mật".
  Gốc: `OPERATION_FAILED`/`INVALID_VALUE` không có chỗ chứa lý do. **Nếu làm lại: thêm không gian từ điển `errors.reason.*` TRƯỚC đợt quét, không phải sau.**

- **F5. Hợp đồng chết trong registry.** `ENTITY_DUPLICATE // params: { entity, field? }` và `INVALID_VALUE // params: { field, reason? }` quảng cáo tham số mà không template nào render — 12 chỗ truyền `field:` vô ích, 36 khoá từ điển không bao giờ hiện. Cùng lớp bug `errors.action.*` đã bắt ở Task 7.

- **F6. Nhất quán chéo task.** "Bảng chưa migrate" có **4** cách xử lý (`FEATURE_DISABLED` / `OPERATION_FAILED` / `PRECONDITION_FAILED` / `throw new Error` thô) · `product` ↔ `productModel` cùng trỏ `product_models` · `report` ↔ `reportTemplate` cùng trỏ `report_templates` · `TWO_FACTOR_NOT_SET_UP` mang cả `FORBIDDEN` lẫn `BAD_REQUEST`.

- **F7. Chất lượng bản dịch.** en: **336/384** câu bắt đầu bằng chữ thường (`"{{entity}} not found."` × entity viết thường ⇒ *"user not found."*) · zh lệch thuật ngữ (`entity.machine`=设备 vs `operation.registerMachine`=机台; `entity.fleetTask`=车队任务 vs `operation.assignFleetTask`=机队) · `errors.feature.web_ingest` là khoá snake_case duy nhất giữa 307 khoá camelCase · `errors.entity.factory` là khoá chết.

- **F8. i18n lười + `fallbackLng:'vi'`.** en/zh nạp bằng `import()` động. Trong cửa sổ chờ hoặc khi chunk hỏng (offline), `translateAppError` trả **chuỗi tiếng Việt** — không phải sentinel — nên fallback tiếng Anh không bao giờ tới. Người dùng en đọc "Không tìm thấy sản phẩm.". **Đường này mới có sau di trú.**

- **F9. Bảo mật đăng nhập, tiền tồn tại, ngoài phạm vi.** Kiểm `isActive`/`lockedUntil` chạy TRƯỚC `bcrypt.compare`, nên chỉ cần username là phân biệt được "tồn tại + vô hiệu/khoá" với "không tồn tại"; nhánh unknown-user bỏ qua bcrypt ⇒ side-channel thời gian. Đợt di trú **không làm tệ hơn** (`INVALID_CREDENTIALS` vẫn gộp chung sai-mật-khẩu với không-có-tài-khoản).

- **F10. Chưa kiểm bằng mắt trên trình duyệt.** 343 chỗ + 198 khoá từ điển của đợt cuối chưa từng render thật lần nào. Cổng tĩnh chứng minh khoá tồn tại, không chứng minh câu ghép ra đọc được. Cần một phiên có uỷ quyền rebuild + restart `:3000`, kiểm 1 ca mỗi họ.

**Công tắc quay lui:** `APP_ERROR_CODES_ENABLED=false` gỡ `appCode` khỏi phản hồi ⇒ client tự rơi về hành vi trước sprint, **không cần build lại FE**.

---

## 5. KHÔNG phải nợ — ngoại lệ CÓ CHỦ Ý đã chốt

**Đừng "sửa giúp" những mục này ở sprint sau mà không hỏi lại:**

- **RCA đã lưu rò TÊN TỆP kho Studio cho operator.** Chủ dự án chốt **để mở** sau khi biết đúng chi phí sửa (1 dòng filter tại 2 chỗ, `aiRcaCopilot.ts:182`/`:195`). Đánh đổi: chặn thì kỹ sư mất bằng chứng từ tài liệu tự nạp khi chạy RCA.
- **Cổng kho Studio role-only, KHÔNG đòi 2FA.** Lý do: *"2FA có thể bật tắt, trong môi trường khách hàng offline đôi khi không quan trọng"* — gắn cứng `require2FA` là sai bối cảnh sản phẩm.
- **Không nạp ngược quá khứ cho nhật ký lần-tái-diễn.** Không ai biết 52 lần đó xảy ra lúc nào.

---

## 6. Đề xuất phạm vi Sprint 5

**Khuyến nghị: chỉ lấy NHÓM A + B1.** Lý do: nhóm A là thứ người dùng thật cảm nhận được (bị làm phiền, thấy số 0 không giải thích, đọc câu lỗi không hiểu); B1 bảo vệ con số mà sprint sau sẽ dùng để quyết ngưỡng.

Nhóm C và D là nợ thật nhưng **không ai đang đau vì chúng** — C1 nằm sau một cờ mặc định tắt, C2 không màn nào đọc, D toàn việc vệ sinh.

**Quyết định cần chủ dự án trước khi thi công:**
1. **A1 — chặn bớt thông báo?** Đây là đổi tải thật lên người vận hành. Nay đã có dữ liệu để quyết. Cần chốt: gộp theo cửa sổ bao lâu, và mức độ nào thì **không bao giờ** gộp (ví dụ `CRITICAL` luôn báo ngay).
2. **A2 — nới trần gộp để flood phát hiện được?** Ngược hướng A1. Phải tách "ghi nhật ký" khỏi "gửi thông báo" thì mới làm được cả hai.

---

## 7. Cách bắt đầu ở session mới

```
Đọc docs/superpowers/specs/2026-07-29-ai-sprint5-backlog-consolidated.md
rồi bắt đầu Sprint 5 theo phạm vi khuyến nghị (nhóm A + B1).
```

Session mới nên: **đo lại trước khi thi công** (số liệu trong tài liệu này chụp tại `208301dc`, có thể đã đổi), rồi qua `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` như bốn wave trước.

⚠ **Gotcha vận hành đã trả giá:**
- Chạy migration: `docker exec avi-aoi-management-postgres-1 psql -U aoi -d <db> -f /tmp/x.sql` (socket cục bộ, vai chủ bảng). Git Bash dịch `/tmp/…` ⇒ phải `MSYS_NO_PATHCONV=1`. **DB test tên `aoi_management_test` phải áp migration RIÊNG**, không thì test "xanh rỗng".
- **Chạy migration NGAY sau task tạo bảng**, đừng để cuối — drizzle liệt kê toàn bộ cột từ schema nên lệch schema/DB làm **cả INSERT lẫn SELECT** ném `42703`.
- **Không bao giờ chạy hai implementer song song**, kể cả khác file — tranh chấp git index. Review (chỉ đọc) thì song song được.
