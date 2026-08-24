# Đề nghị nới `POST /api/machine/sync-points` — 28 khoá server ĐÃ GỬI XUỐNG nhưng KHÔNG NHẬN NGƯỢC LÊN

**Gửi:** đội server SYNAPSE (`synapse-platform`).
**Từ:** đội St4i Machine Simulator (máy AOI/AVI ở biên).
**Ngày đo:** 2026-08-24. **Kèm file:** `2026-08-24-sync-points-push-fields.json` (thân request mẫu, JSON hợp lệ).

> 🔴 **Đây là một BẢN ĐỀ NGHỊ, không phải một bản sửa.** Phía máy **chưa đổi một byte nào** trên dây và
> sẽ không đổi cho tới khi các anh xác nhận. Không có gì phải hoàn nguyên nếu các anh từ chối.

---

## 1. Nói đúng vấn đề trong một câu

Hai mươi tám trường của một điểm đo (`measurement_point_defs`) **các anh ĐÃ gửi xuống máy** qua
`GET /api/machine/get-points`, và **KHÔNG nhận ngược lên** qua `POST /api/machine/sync-points`.

**Đây là một khe PUSH bị thiếu, KHÔNG phải một trường bị thiếu trong hợp đồng.** Phân biệt này quan
trọng, vì nó quyết định các anh phải sửa cái gì:

* ❌ Cách nói SAI (và chúng tôi đã từng ghi sai như vậy trong hồ sơ nội bộ): *"28 trường này không có
  chỗ trong hợp đồng đồng bộ."* — Nếu đọc đúng chữ ấy thì phải đi định nghĩa 28 trường MỚI. **Không
  phải việc đó.**
* ✅ Cách nói ĐÚNG, đo được: **cả 28 đều đã có tên, có kiểu, có ngữ nghĩa, và đều đã nằm trong khối
  `<POINT>` mà `get-points` trả về.** Thứ thiếu là **28 khoá tương ứng trong zod schema của thân
  request `sync-points`**.

Chứng cứ nằm trong **chính tài liệu hợp đồng của các anh** — `CONFIG_SYNC_SERVER_CONTRACT.md`, bản
chúng tôi đang giữ:

| | mục trong tài liệu hợp đồng | có 28 trường này không? |
|---|---|---|
| Kéo xuống | §`<POINT> full shape (from get-points, per measurement_point_defs)` | ✅ **có đủ cả 28** |
| Đẩy lên | §`Push up (machine→ecosystem, REAL write)` → `points:[{…}]` | ❌ **không có khoá nào trong 28** |

Nên việc cần làm không phải là thiết kế lại gì cả — mà là **cho khối `points[]` của `sync-points`
nhận thêm đúng những khoá mà `get-points` vốn đã phát ra**.

---

## 2. ĐẾM Ở MỨC NÀO — chọn dứt khoát, vì một schema mập mờ về độ sâu là một schema không cài được

Con số **28** là số **khoá trên object `point`**. Nhưng một trong 28 khoá ấy (`lighting`) là **một
mảng object**, nên nếu đếm tới **lá** thì con số khác:

* **27 khoá vô hướng / JSON tự do** trên object `point`, **cộng**
* **1 khoá mảng** (`lighting`), mà **mỗi phần tử có 12 khoá lá**.

⇒ **27 + 12 = 39 khoá lá.**

🔴 **BẢN ĐỀ NGHỊ NÀY DÙNG MỨC LÁ: 39.** Nghĩa là các anh cần **hai** schema, không phải một:
**28 khoá thêm vào `measurementPointSyncSchema`**, trong đó `lighting` trỏ tới **một schema phần tử
riêng có đúng 12 khoá**. File JSON kèm theo được viết ở đúng mức ấy — mở nó ra là thấy cả 39.

---

## 3. Đúng chỗ phải sửa trong cây của các anh — trỏ bằng TÊN, kèm số dòng đo ngày 2026-08-24

| cái gì | ở đâu |
|---|---|
| Schema mỗi điểm trong thân push | `server/routers/machineApiRouters.ts` — `const measurementPointSyncSchema = z.object({…})`, **dòng 170–~207** |
| Procedure nhận push | `server/routers/machineApiRouters.ts` — `syncMeasurementPoints: publicProcedure`, **dòng 3492** |
| Route HTTP bọc ngoài | `server/_core/index.ts` — `app.post("/api/machine/sync-points", …)`, **dòng 874** |

Số dòng đo trên nhánh chúng tôi đang giữ ngày **2026-08-24**; nếu cây của các anh đã dịch thì tìm
bằng **tên**, tên mới là thứ ổn định.

### 3.1 Hai điều chúng tôi ĐO ĐƯỢC về schema hiện tại, và cả hai đều là tin tốt

**(a) Thêm khoá vào push là AN TOÀN NGƯỢC, và các anh có thể triển khai server TRƯỚC.**
`measurementPointSyncSchema` là một `z.object({…})` **không có `.strict()`** (đo: `.strict()` xuất
hiện **0 lần** trong cả `machineApiRouters.ts`). Với `zod` (`package.json` gốc khai `"zod": "^4.3.6"`),
`z.object()` mặc định **strip** — khoá lạ bị **bỏ đi trong im lặng**, không phải bị **từ chối**.

⇒ Hệ quả thực tế: **nếu hôm nay máy gửi thừa 28 khoá ấy, push KHÔNG hỏng — server chỉ vứt chúng đi.**
Nên thứ tự triển khai không bị ràng buộc: các anh thêm khoá lúc nào cũng được, máy bật gửi lúc nào
cũng được, và **không có cửa sổ nào hai bên phải khớp nhau.**

> 🔴 **Điều chúng tôi KHÔNG đo:** chúng tôi **đọc schema**, **không chạy server của các anh**. Mệnh đề
> "strip là mặc định" là tính chất của `zod` ở phiên bản `package.json` khai, không phải một lần chạy
> chúng tôi quan sát. Nếu ở giữa còn một lớp proxy/body-parser nào khác thì lớp ấy nằm ngoài phép đo
> này. **Nhờ các anh xác nhận bằng một lần curl.**

**(b) Dùng `.nullish()` chứ đừng chỉ `.optional()`.**
Trong `zod`, `.optional()` chấp nhận `undefined` nhưng **từ chối `null` tường minh**. Máy của chúng
tôi hiện **bỏ hẳn khoá null** khi tuần tự hoá (`JsonIgnoreCondition.WhenWritingNull`), nên
`.optional()` là đủ **cho máy này**. Nhưng một máy khác của một hãng khác rất dễ gửi `null`, và khi
ấy `.optional()` làm **hỏng cả push** chứ không phải bỏ qua một trường. Đề nghị dùng
`.optional().nullable()` (hay `.nullish()`) cho cả 28.

---

## 4. Ba mươi chín khoá — kiểu, miền hợp lệ, ai soạn, vì sao phải đi lên

**Ai soạn tất cả những thứ dưới đây:** **vận hành viên tại máy**, qua màn hình sửa điểm đo của HMI
(`PointForm`). Ngoại lệ **duy nhất** là `cells` — nó không có ô nhập trên HMI, chỉ được **chuyển tiếp
nguyên vẹn** những gì máy đã pull về. Nên với `cells`, "ai soạn" là **UI của SYNAPSE**, và lý do nó
cần đi lên là để một lần pull sau **không xoá mất** thứ máy đang giữ (xem §5).

**Vì sao TẤT CẢ phải đi lên — một lý do chung, viết một lần:** cả 28 khoá đều nằm trong **khoá băm
sai khác** (drift key) mà hai bên dùng để so cấu hình. Đo trên cây của chúng tôi: một điểm đo có **52
thuộc tính**; **3** thuộc tính kiểm toán bị loại khỏi khoá băm (`lastModifiedAt`, `deletedAt`,
`deletedAtVersion`); **49** còn lại vào khoá băm; **21** trong 49 đi được lên qua `sync-points`.
**49 − 21 = 28.** Nghĩa là: **sửa bất kỳ khoá nào trong 28 ⇒ drift bật hổ phách ⇒ và không tồn tại
đường nào đưa bản sửa ấy lên.**

### 4.1 Định danh mở rộng và chế độ dung sai (4 khoá)

| khoá | kiểu | miền hợp lệ | ghi chú |
|---|---|---|---|
| `measurementTypeCode` | `string` | tự do; thực tế là SCREAMING_SNAKE (`HEIGHT_2D`, `SOLDER_3D`, `BGA_XRAY`, `COLOR_DELTA_E`, `ROTATION_OFFSET`, `PITCH_2D`, `PRESENCE`) | Nửa **MỞ** của phân loại, đứng cạnh enum **ĐÓNG** `measurementType` đã có trong push. Khi `measurementType` chỉ nói được `OTHER`, đây là chỗ tên thật sống. |
| `toleranceMode` | `string` (enum) | `min_only` \| `max_only` \| `range` \| `bilateral` | Nói **cách đọc** `lowerLimit`/`upperLimit` — mà ba khoá kia **đã** đi lên được. Đẩy giới hạn lên mà không đẩy chế độ đọc chúng lên là đẩy một nửa câu. |
| `tolPlus` | `number` | ≥ 0, cùng đơn vị với `unit` | Nửa dương của dải `bilateral`, ghi bằng **độ lớn**. |
| `tolMinus` | `number` | ≥ 0, cùng đơn vị với `unit`, **ghi DƯƠNG** (ví dụ `0.05`, không phải `-0.05`) | Nửa âm, cùng quy ước. |

### 4.2 Khối 3D / mối hàn / X-quang (20 khoá)

Ba nhóm ba-số-một-đơn-vị. 🔴 **Mỗi nhóm mang đơn vị RIÊNG và KHÔNG đọc `unit` của điểm** — một điểm
hoàn toàn có thể là `mm3` ở `unit` và `mm` ở `heightUnit` cùng lúc.

| khoá | kiểu | miền hợp lệ | vì sao cần |
|---|---|---|---|
| `positionZ` | `number` | toạ độ tuyệt đối theo `coordinateMode` của sản phẩm | Toạ độ thứ ba mà cặp `positionX`/`positionY` không mang được — cảm biến 3D cần nó để lấy nét. Là **VỊ TRÍ**, không phải giới hạn. |
| `heightMin` / `heightMax` / `heightNominal` | `number` | theo `heightUnit` | Dải chấp nhận chiều cao. Mối hàn thiếu thiếc rơi dưới `heightMin`; linh kiện kênh vượt `heightMax`. |
| `heightUnit` | `string` | tự do; thực tế `mm` | Không có nó thì ba số trên là ba số không đơn vị. |
| `areaMin` / `areaMax` / `areaNominal` | `number` | theo `areaUnit` | Diện tích thấm thiếc. `areaMax` bắt cầu nối (bridging). |
| `areaUnit` | `string` | tự do; thực tế `mm2` (chữ số ASCII, **không** dùng `²`) | |
| `volumeMin` / `volumeMax` / `volumeNominal` | `number` | theo `volumeUnit` | Thể tích thiếc — tiêu chí chính của kiểm 3D mối hàn. |
| `volumeUnit` | `string` | tự do; thực tế `mm3` (chữ số ASCII) | |
| `coplanarityMax` | `number` | ≥ 0, khung độ dài như `heightUnit` | Trần một phía (0 là hoàn hảo, không có sàn). Chân/bi lệch mặt phẳng chung bao nhiêu thì không ngồi được. |
| `warpageMax` | `number` | ≥ 0, cùng khung độ dài | **Khác** `coplanarityMax`: warpage là **đế board cong**, coplanarity là **các đầu nối bất đồng về mặt phẳng**. |
| `voidPctMax` | `number` | **0–100 (PHẦN TRĂM)**, không phải 0..1 | Tỉ lệ rỗng khí trong mối hàn. 🔴 Đơn vị chỉ được nói ở **cái tên** (`Pct`) — nó không theo `unit` và không theo ba `*Unit` ở trên. |
| `offsetXMax` / `offsetYMax` | `number` | ≥ 0, đơn vị tuyệt đối của sản phẩm | Lệch đặt tối đa theo từng trục, ghi bằng **độ lớn** (một dải ± viết một lần). Hai trần **độc lập**, không phải một bán kính. |
| `tiltMax` | `number` | ≥ 0, **ĐỘ** | Nghiêng khỏi mặt board (linh kiện dựng bia / kênh chân). Thành viên **duy nhất** của khối này mang đơn vị góc, nên không có `*Unit` nào cho nó. |
| `thicknessMin` / `thicknessMax` | `number` | ≥ 0 | Bề dày vật liệu (kem hàn, mạ, phủ). 🔴 **Cặp này KHÔNG có khoá đơn vị riêng** — người đọc phải suy khung từ các giá trị 3D khác của cùng điểm. Nếu các anh muốn thêm `thicknessUnit`, chúng tôi ủng hộ, nhưng **đó là một thay đổi vượt ra ngoài đề nghị này**. |

### 4.3 Hai khối JSON tự do (2 khoá)

| khoá | kiểu | miền hợp lệ | vì sao cần |
|---|---|---|---|
| `criteria` | `object` (jsonb) | tự do | Tiêu chí đạt/không-đạt **ngoài** các trường số — ví dụ mẫu OCR + ngưỡng tin cậy cho điểm kiểm nhãn. Một điểm `VISUAL` lấy phán quyết **từ đây**, không phải từ dải số. |
| `cells` | `array` (jsonb) | tự do; chỉ có nghĩa khi `shape` = `array` | Hình học từng ô của lưới lặp (ví dụ ma trận bi BGA). **Đây là khoá duy nhất trong 28 mà HMI không cho sửa** — máy chỉ giữ và chuyển tiếp. Nó vẫn cần đi lên vì nó nằm trong khoá băm, nên thiếu nó thì drift **không bao giờ về sạch được**. |

### 4.4 `lighting` — 1 khoá mảng, **12 khoá lá mỗi phần tử**

`lighting: LightingShot[]`, một phần tử cho mỗi lần chụp. Một điểm mối hàn thường có hai
(trường sáng + trường tối).

| khoá lá | kiểu | miền hợp lệ | ghi chú |
|---|---|---|---|
| `shotIndex` | `int` | ≥ 0 | Là **ĐỊNH DANH**, không phải gợi ý thứ tự — pull/diff ghép các shot lại **bằng số này**. |
| `name` | `string` | tự do | Nhãn cho vận hành viên (`"Bright-field coax"`, `"Dark-field"`). |
| `lightSource` | `string` | tự do; thực tế `LED_RING` \| `LED_BAR` \| `DOME` \| `XRAY` | SCREAMING_SNAKE, khác quy ước chữ thường của các enum cấp điểm. `XRAY` **không phải đèn** — shot mang nó thường bỏ trống `color`/`colorHex`, và đó là trạng thái hợp lệ. |
| `color` | `string` | tự do; thực tế `white`, `amber` | Bạn đồng hành "lỏng" của `colorHex`; hai khoá **độc lập**, không gì giữ chúng khớp nhau. |
| `colorHex` | `string` | quy ước `#RRGGBB` chữ HOA | Không có gì kiểm; chuỗi nào cũng round-trip. |
| `intensityPct` | `number` | **0–100 (PHẦN TRĂM)**, không phải 0..1 | Khác hẳn quy ước 0..1 của các trường toạ độ chuẩn hoá cùng payload. |
| `angleDeg` | `number` | ĐỘ | 🔴 **Đo từ MẶT BOARD, không phải từ trục quang.** `90` = chiếu thẳng đứng (coaxial), `0` = dome khuếch tán, `15`–`45` = chiếu xiên/lướt. Đọc theo quy ước kia là **đảo ngược hoàn toàn**. |
| `exposureUs` | `number` | **MICRO-giây** | Đơn vị nằm trong tên; không nơi nào quy đổi sang ms. |
| `gain` | `number` | **hệ số KHÔNG THỨ NGUYÊN**, `1.0` = đơn vị | 🔴 **KHÔNG phải dB.** Dải quan sát được là 1,0–2,0; đọc theo dB thì đó là 100× thay vì 2×. |
| `focusOffsetUm` | `number` | **MICRO-mét**, **CÓ DẤU** | `0` và "không đặt" là **hai trạng thái khác nhau** và không gì gộp chúng lại. Dùng để lấy nét lại cho từng shot. |
| `opticalFilter` | `string` | tự do | Kính lọc trong đường quang (phân cực, thông dải…). |
| `purpose` | `string` | tự do; thực tế **chữ thường** (`height`, `void`, `shape`, `ocr`, `void_detection`, `orientation`…) | Là tài liệu cho người chỉnh recipe, **không phải bộ chọn** — không mã nào rẽ nhánh trên nó. |

---

## 5. 🔴 CÁI GÌ ĐANG HỎNG HÔM NAY — kể bằng lời người vận hành

> Tôi đứng ở máy AOI-01. Bo MODEL-A vừa đổi lô, mối hàn BGA hay bị rỗng khí hơn trước. Tôi mở màn
> hình điểm đo, vào điểm **P08**, và siết trần rỗng khí từ **25 %** xuống **15 %**. Tôi bấm lưu. Máy
> nhận. Từ lúc đó máy chạy đúng con số tôi đặt.
>
> Ngay sau khi lưu, cái **huy hiệu đồng bộ** trên màn hình chuyển sang **màu hổ phách**: *"cấu hình
> máy khác với cấu hình trên hệ thống"*. Đúng thế thật — tôi vừa làm nó khác.
>
> Trên màn hình có đúng **hai** cái nút. Nút **ĐẨY LÊN** tôi bấm, nó chạy, nó báo thành công. Huy
> hiệu **vẫn hổ phách**. Tôi bấm lại. Vẫn hổ phách. Không có thông báo lỗi nào, không có dòng nào nói
> trường nào đã đi và trường nào không.
>
> Nút còn lại là **KÉO XUỐNG**. Tôi bấm. Huy hiệu **về xanh ngay lập tức** — **và con số của tôi biến
> mất**. Trần rỗng khí quay về 25 %. Cái tôi vừa đo cả buổi sáng bị xoá bởi đúng cái thao tác duy
> nhất làm cho màn hình hết báo động.
>
> Nên hôm nay tôi có ba lựa chọn, và cả ba đều tệ:
> 1. **Để hổ phách vĩnh viễn** — rồi cả xưởng học cách bỏ qua cái huy hiệu ấy, và lần sau nó hổ phách
>    vì lý do THẬT thì không ai nhìn nữa.
> 2. **Bấm kéo xuống** — mất bản sửa, quay lại con số sai.
> 3. **Gọi điện cho người quản trị SYNAPSE** và đọc từng con số qua điện thoại để họ gõ tay vào hệ
>    thống. Đó là cái chúng tôi đang làm.
>
> Tôi không cần thêm nút nào. Tôi chỉ cần cái nút **ĐẨY LÊN** mang theo được những trường mà chính hệ
> thống đã gửi xuống cho tôi.

**Nói lại bằng lời kỹ thuật, để không mất gì khi dịch:**

* Huy hiệu drift băm **toàn bộ** điểm đo (49 trên 52 thuộc tính), nên **bất kỳ** khoá nào trong 28
  khoá đổi là drift bật.
* `sync-points` mang lên **21** thuộc tính. 28 khoá kia **không có đường lên**.
* Nên **thứ duy nhất từng xoá được drift là một lần PULL**, và một lần PULL **ghi đè** bản sửa.
* Và **không một dòng nào trên giao diện nói cho vận hành viên biết điều đó** — push báo *thành
  công* vì nó thành công: nó đã gửi đúng những gì hợp đồng cho phép nó gửi.

🔴 **Vì sao đây là loại lỗi tệ nhất trong bốn lỗi config-sync chúng tôi ghi được:** cách **duy nhất**
để hết khác biệt **cũng chính là** cách xoá công của người dùng.

---

## 6. Chúng tôi ĐỀ NGHỊ gì, chính xác

1. Thêm **28 khoá** vào `measurementPointSyncSchema` (`server/routers/machineApiRouters.ts:170`), tất
   cả **`.optional().nullable()`**, tên và kiểu **đúng như khối `<POINT>` của `get-points`** — nghĩa
   là không có tên mới nào phải nghĩ ra.
2. `lighting` trỏ tới một **schema phần tử 12 khoá** như §4.4.
3. Cho `syncMeasurementPoints` **ghi** chúng xuống `measurement_point_defs` / `mp_lighting_profiles`.
4. Nếu có trường nào các anh **cố ý** không muốn máy ghi ngược (ví dụ `cells`), **nói ra** — chúng tôi
   sẽ khoá ô nhập ở HMI và **loại nó khỏi khoá băm drift**, để vận hành viên không bao giờ rơi vào
   trạng thái không thoát được. **Một lời từ chối rõ ràng cũng giải quyết được vấn đề này**; thứ
   không giải quyết được là im lặng.

**Chúng tôi KHÔNG đề nghị:** đổi tên khoá nào, đổi kiểu khoá nào, đổi bất cứ thứ gì trên đường
**pull**, hay đổi hành vi của `threshold governance` (`lowerLimit`/`upperLimit`/`nominalValue` vẫn cứ
bị chặn theo vòng đời sản phẩm như hôm nay — chúng tôi không xin nới chỗ đó).

---

## 7. File JSON kèm theo — đọc nó thế nào

`2026-08-24-sync-points-push-fields.json` là **một thân request `POST /api/machine/sync-points` hoàn
chỉnh và hợp lệ**, dán thẳng vào `curl -d @…` được.

* **JSON không có chú thích**, nên mọi giải thích nằm ở file này. File JSON cố tình **không** mang một
  khoá chú giải giả nào, vì như thế là giao một thân request không dùng được.
* Nó chứa **đủ cả 28 khoá đề nghị**, cộng **17 trong 25 khoá hiện hành** — đúng những khoá điểm mẫu
  **thật sự đặt**, không hơn. Khoá nào điểm không đặt thì **bị bỏ hẳn** chứ không ghi `null`, đúng như
  máy thật tuần tự hoá (`WhenWritingNull`). Vì thế các anh sẽ **không** thấy tám khoá `radius`,
  `normalizedRadius`, `geometry`, `workstationCode`, `imageBase64`, `imageMimeType`, `imageUrl`,
  `expectedUpdatedAt` trong mẫu — cả tám **đã** có trong schema của các anh, và điểm mẫu này đơn giản
  là không đặt chúng. **Tổng số khoá trên object `point` là 45 = 17 + 28**, và phép cộng ấy là cách
  nhanh nhất để kiểm rằng bản các anh nhận được không bị cắt xén trên đường đi.
* **Giá trị là giá trị thật**, lấy từ dữ liệu gieo sẵn của kho chúng tôi. 🔴 **Ba ngoại lệ, khai
  thẳng ở đây vì một mẫu không được giả vờ là một phép đo:**
  1. Điểm mẫu là **P08** (BGA U1, X-quang) — điểm **duy nhất** trong kho chúng tôi lấp kín khối 3D
     từ đầu tới cuối. Nhưng P08 **không** đặt dải 2D, nên nó không thể minh hoạ
     `toleranceMode`/`tolPlus`/`tolMinus`. Sáu khoá `lowerLimit`/`upperLimit`/`nominalValue`/
     `toleranceMode`/`tolPlus`/`tolMinus` trong mẫu **mượn từ điểm Q01** (J1 Pin Pitch, cùng đơn vị
     `mm`). **Cả hai bộ giá trị đều thật; cái ghép lại thì không.**
  2. `focusOffsetUm: -150` — trong kho chúng tôi khoá này **chỉ từng được quan sát ở giá trị `0`**.
     `-150` là một giá trị **hợp lệ về kiểu và hợp lý về vật lý** do chúng tôi đặt để khoá này có ví
     dụ, **không phải một giá trị đo được**.
  3. `opticalFilter: "BANDPASS-450NM"` — **chưa một shot nào trong kho chúng tôi đặt khoá này.** Cùng
     tình trạng như trên: một ví dụ hợp kiểu, không phải một quan sát. **Đừng suy ra định dạng nào từ
     nó** — nếu SYNAPSE có vựng từ cho kính lọc, vựng từ của các anh thắng.

---

## 8. Cần gì ở các anh

1. **Xác nhận hoặc bác** mệnh đề ở §3.1(a) bằng một lần curl: gửi một `sync-points` có khoá lạ và cho
   biết nó **bị strip** hay **bị 400**.
2. **Đồng ý / từ chối / từ chối một phần** danh sách 28 khoá. Từ chối một phần thì **nêu tên từng
   khoá bị từ chối** — chúng tôi cần tên để khoá đúng ô nhập tương ứng ở HMI.
3. Nếu đồng ý: cho biết **phiên bản server** nào sẽ có, để chúng tôi bật gửi sau mốc đó.

Bên phía máy, sau khi có trả lời, việc cần làm là **một chỗ**: `ConfigSyncEngine.ToWireDto` cùng
`SyncPointDto`. Chúng tôi **không** đổi gì cho tới khi có trả lời.
