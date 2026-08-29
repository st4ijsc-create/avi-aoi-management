# Đề nghị đội server thêm `aoi_inspection` vào `RECIPE_KINDS`

**Ngày:** 2026-08-25 · **Gửi:** đội server SYNAPSE · **Loại:** ĐỀ NGHỊ NỚI HỢP ĐỒNG, không phải báo lỗi
**Trạng thái phía chúng tôi:** **chưa đổi một byte nào trên dây; 0 dòng trong `server/` bị sửa.**

> 🔴 **ĐỌC MỤC "THỨ TỰ ƯU TIÊN" Ở CUỐI TRƯỚC KHI XẾP LỊCH.** Hồ sơ này **đứng SAU** hồ sơ 28 trường
> (`2026-08-24-sync-points-push-fields.md`). Nếu quý vị chỉ có thời gian cho **một** việc, hãy làm hồ sơ
> kia. Chúng tôi nói điều này ở đầu trang vì đó là thông tin quý vị cần **trước** khi đọc phần còn lại.

---

## 1. Đề nghị, một câu

Xin thêm `"aoi_inspection"` vào `RECIPE_KINDS` trong `server/services/recipes/recipeSchemas.ts`, kèm một
`RECIPE_PAYLOAD_SCHEMAS` tương ứng, và ánh xạ `AOI` / `AVI` / `AOI_AVI` tới nó trong
`MACHINE_TYPE_TO_RECIPE_KIND`.

## 2. Vì sao — và đây là một phép đo, không phải một cảm giác

Sản phẩm mô phỏng máy của chúng tôi phục vụ một vựng từ tham số vận hành cho **năm** họ máy. Bốn họ đầu
lấy tên khoá **từ chính file của quý vị**, để hai bên đồng bộ sạch. Họ thứ năm — máy kiểm quang học
AOI/AVI — **không có bản khai nào bên quý vị để đối chiếu**, nên tài liệu thiết kế của chúng tôi **tự
phát minh** vựng từ ấy, và mã của chúng tôi đã thi hành **sáu trên bảy** khoá nó phát minh.

**Đo lại hôm nay, 2026-08-25**, đọc trực tiếp từ kho object git (`git show HEAD:server/services/recipes/recipeSchemas.ts`)
vì bản checkout của chúng tôi là checkout *thưa* và thư mục `server/` **không nằm trên đĩa** — nên đây là
*"đã đo"*, không phải *"không thấy"*:

```
RECIPE_KINDS = ["screw_program", "dispense_program", "weld_profile", "iot_settings"]
```

**Bốn phần tử. Không có `aoi_inspection`.**

Và trong `MACHINE_TYPE_TO_RECIPE_KIND`, năm khoá — `SCREWDRIVE`, `DISPENSING`, `WELDER`, `IOT_SENSOR`,
`IOT_GATEWAY`. **Không có `AOI`, không có `AVI`, không có `AOI_AVI`.**

**Hệ quả, nói theo chiều vận hành:** một công thức cho máy AOI đi qua đường `schemaForMachineType()` của
quý vị nhận về `null`, nên **việc kiểm kiểu là một no-op** cho đúng họ máy nhạy cảm với ngoại cảnh nhất.
Không có gì *hỏng* — đó chính là chỗ khó thấy: nó **im lặng không kiểm**.

## 3. Cụ thể xin thêm gì

Sáu khoá dưới đây là **những khoá mã của chúng tôi đang thực sự cưỡng chế hôm nay**, kèm miền đã chặn
cứng. Chúng tôi nêu cả `min`/`max`/`default` để quý vị không phải hỏi lại một vòng:

| khoá | kiểu | đơn vị | min | max | bước | mặc định | nghĩa |
|---|---|---|---|---|---|---|---|
| `exposureUs` | number | µs | 50 | 20000 | 50 | 1500 | thời gian phơi sáng |
| `gain` | number | × | 1.0 | 8.0 | 0.1 | 1.0 | độ khuếch đại cảm biến |
| `lightIntensity` | number | % | 0 | 100 | 1 | 75 | cường độ đèn chiếu |
| `conveyorSpeed` | number | mm/s | 10 | 500 | 5 | 120 | tốc độ băng tải |
| `fiducialTolerance` | number | mm | 0.05 | 2.00 | 0.05 | 0.30 | dung sai định vị fiducial |
| `matchThreshold` | number | score | 0.50 | 0.99 | 0.01 | 0.85 | ngưỡng khớp mẫu |

Dạng đề nghị, viết theo đúng khuôn ba `*Shape` đang có trong file của quý vị — **tất cả đều
`.optional()` trừ hai khoá đầu**, để một công thức cũ không đột ngột thành không hợp lệ:

```ts
const aoiInspectionShape = {
  exposureUs:        z.number().positive(),
  gain:              z.number().positive(),
  lightIntensity:    z.number().min(0).max(100).optional(),
  conveyorSpeed:     z.number().positive().optional(),
  fiducialTolerance: z.number().positive().optional(),
  matchThreshold:    z.number().min(0).max(1).optional(),
} as const;
```

Và ba chỗ nối: thêm `"aoi_inspection"` vào `RECIPE_KINDS`; thêm
`aoi_inspection: z.object(aoiInspectionShape).passthrough()` vào `RECIPE_PAYLOAD_SCHEMAS`; thêm
`AOI: "aoi_inspection"`, `AVI: "aoi_inspection"`, `AOI_AVI: "aoi_inspection"` vào
`MACHINE_TYPE_TO_RECIPE_KIND`.

📌 **Vì sao ba chuỗi máy chứ không một:** cả ba đều là chuỗi `machineType` sống trong dữ liệu của chúng
tôi hôm nay và cả ba đều dựng cùng một bộ mô phỏng. Nếu bên quý vị chỉ nhận một, xin cho biết chuỗi nào
là chuẩn — đó là một câu hỏi chúng tôi **không** tự trả lời được.

## 4. Khoá THỨ BẢY — `retestPolicy` — là một câu hỏi RIÊNG, và chúng tôi cố ý không gộp

Tài liệu thiết kế của chúng tôi liệt kê **bảy** khoá cho `aoi_inspection`. Bảng trên có **sáu**. Khoá còn
lại là `retestPolicy`, và nó **chưa từng được thi hành ở bên chúng tôi** vì một lý do kỹ thuật đơn giản:
mọi tham số trong lược đồ của chúng tôi là **một con số có dải min/max cứng**, còn một *chính sách* thì
không phải hình dạng ấy.

🔴 **Chúng tôi KHÔNG đề nghị quý vị thêm `retestPolicy`.** Nó là một câu hỏi **thiết kế** — *"một chính
sách kiểm lại có nên tồn tại không, và nếu có thì hình dạng nào"* — và nó không có trọng tài: vì
`RECIPE_KINDS` không có `aoi_inspection`, **không có bản khai nào của quý vị để nó đúng hay sai với**.
Chúng tôi nêu nó ở đây để hồ sơ đầy đủ, không phải để xin. Nếu quý vị nhận đề nghị ở §3, khoá thứ bảy
vẫn nằm nguyên chỗ nó đang nằm: một dòng trong tài liệu thiết kế của chúng tôi, chưa ai thi hành.

## 5. Hai chỗ mã CHÚNG TÔI hẹp hơn quý vị — nêu để quý vị biết, KHÔNG xin sửa

Trong lúc đo, chúng tôi đối chiếu cả năm họ và tìm thấy **hai chỗ mà file của quý vị RỘNG hơn mã của
chúng tôi**. Cả hai là **chỗ hẹp có chủ ý bên chúng tôi**, không phải lỗi bên quý vị, và **chúng tôi
không đề nghị đổi gì**:

| khoá | quý vị khai | chúng tôi |
|---|---|---|
| `screw_program.sequence` | `z.array(z.object({step, torque, angle})).optional()` | **không có** |
| `iot_settings.thresholds` | `z.record(z.string(), z.number()).optional()` | **không có** |

Lý do chúng tôi chưa nới: lược đồ tham số của chúng tôi chỉ biểu diễn **một con số vô hướng có dải
cứng**, nên một mảng hoặc một map không đặt vào đó được **mà không đổi cấu trúc một phản hồi REST đã
công bố**. Đó là một quyết định đang chờ chủ sở hữu của chúng tôi, và nó **không phải việc của quý vị**.
Nêu ở đây vì một hồ sơ chỉ kể chiều thuận là một nửa sự thật.

## 6. 🔴 Cái chúng tôi KHÔNG đo — ghi ngay ở đây, không giấu xuống cuối

1. **Chúng tôi không biết có bao nhiêu công thức AOI đang tồn tại trong hệ thống của quý vị.** Không phép
   đo nào của chúng tôi với tới dữ liệu của quý vị. Nếu con số là **không**, đề nghị này rẻ; nếu là
   nhiều, việc thêm một schema `passthrough()` vẫn không làm hỏng chúng, nhưng **chúng tôi không kiểm
   chứng được điều đó** — quý vị kiểm được.
2. **Chúng tôi không đo hiệu lực của `RECIPE_TYPED_SCHEMA_MODE`.** File của quý vị cho phép ba chế độ
   (`off` / `log` / `enforce`) và mặc định là `off`. Nếu chế độ đang chạy là `off`, việc thêm lược đồ
   này **không đổi hành vi nào cả** cho tới khi ai đó bật nó. Chúng tôi không biết chế độ thật đang là
   gì, và câu này là lý do đề nghị có thể **rẻ hơn** quý vị tưởng, chứ không phải đắt hơn.
3. **Chúng tôi không khẳng định sáu con số min/max ở §3 là ĐÚNG VỀ VẬT LÝ.** Chúng là các giả định đang
   dùng để test ở phía chúng tôi. Chúng đúng là *"cái mã chúng tôi đang cưỡng chế"*, không phải *"cái
   một máy AOI công nghiệp nên nhận"*. Nếu quý vị có số thật, **số của quý vị thắng**.
4. **Chúng tôi không đọc mã chạy của quý vị, chỉ đọc `recipeSchemas.ts` tại `HEAD`.** Nếu bản triển khai
   thật của quý vị đã đi trước file ấy, phép đo ở §2 cũ hơn thực tế và đề nghị này có thể đã được làm
   rồi.
5. **Không phép đo nào ở đây nói `aoi_inspection` NÊN tồn tại.** Nó nói: bên chúng tôi có nó, bên quý vị
   không, và hôm nay không bên nào phát hiện được sự lệch ấy một cách tự động.

## 7. 🔴 THỨ TỰ ƯU TIÊN — hồ sơ này đứng THỨ HAI

Chúng tôi đã gửi quý vị một hồ sơ khác, ngày 2026-08-24: **28 trường trên đường `POST /api/machine/sync-points`**
(`2026-08-24-sync-points-push-fields.md` + `.json`). Câu hỏi chính của hồ sơ ấy — *"các anh có GHI 28
trường ấy xuống DB không?"* — **đắt hơn hẳn** câu hỏi trong hồ sơ này, và nó chặn một đường dữ liệu đang
chạy.

| # | hồ sơ | vì sao thứ tự này |
|---|---|---|
| **1** | `2026-08-24-sync-points-push-fields.md` (28 trường) | một vận hành viên sửa 28 trường và bản sửa **mất** khi pull; đường dữ liệu đang chạy |
| **2** | **hồ sơ này** (`aoi_inspection`) | một lược đồ kiểm **không chạy** cho một họ máy; không mất dữ liệu của ai |

🔴 **Đây là lý do hồ sơ này là một FILE RIÊNG chứ không phải một mục thêm vào hồ sơ 28 trường:** gộp
chúng lại làm **loãng** câu hỏi chính. Một người đọc mở một tài liệu có hai đề nghị sẽ trả lời cái dễ
trước, và cái dễ ở đây là cái ít quan trọng hơn.

## 8. Chúng tôi chờ gì từ quý vị

Một câu trả lời **có** hoặc **không** cho §3, và nếu **có** thì cho biết chuỗi `machineType` nào là chuẩn
(§3, ghi chú cuối). Không cần trả lời §4 và §5 — §4 là câu hỏi của chúng tôi, §5 là ghi chú.

**Chúng tôi không chờ, và cũng không đề nghị, một bản sửa nào từ phía mình đi kèm.** Không dòng nào trong
`server/` bị nhiệm vụ này chạm tới.
