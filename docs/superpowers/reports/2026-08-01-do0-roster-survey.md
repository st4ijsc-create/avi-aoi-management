# Đợt 0 — Khảo sát roster model AI (32,6 GB VRAM)

Kế hoạch: `docs/superpowers/plans/2026-08-01-do0-model-roster-survey.md`. Mỗi task nối thêm một mục `§N` vào file này — **không ghi đè** mục của task khác.

---

## §1 Lưu lượng (Task 1)

**Câu hỏi:** tier nào thực sự được gọi nhiều, để biết tier nào xứng đáng thường trú trên VRAM. Quét file cho ra code/coder 20 · default/chat 16 · vision 12 · fim 5 — nhưng **file ≠ lượt gọi**. `ai_gateway_metrics` ghi từng lượt gọi thật (`drizzle/schema/ai.ts:1828`).

### Bước 1 — dữ liệu TRƯỚC khi làm dày

Lệnh:
```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
"SELECT task, model, count(*) AS luot, sum(\"tokensIn\") AS tok_in, sum(\"tokensOut\") AS tok_out,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY \"latencyMs\") AS latency_p50
 FROM ai_gateway_metrics GROUP BY task, model ORDER BY luot DESC;"
```

Output nguyên văn (18/07→31/07/2026, **18 dòng tổng**):
```
  task  |                 model                  | luot | tok_in | tok_out | latency_p50 
--------+----------------------------------------+------+--------+---------+-------------
 report | Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL |   13 |      0 |       0 |        9534
 chat   | Qwen3-4B-Instruct-2507-UD-Q4_K_XL      |    3 |   4876 |     460 |        7773
 intent | Qwen3-4B-Instruct-2507-UD-Q4_K_XL      |    1 |   4616 |      13 |        7415
 vision | default                                |    1 |   2178 |     700 |       25964
(4 rows)
```

**18 dòng < 100 → KHÔNG đủ để kết luận gì về tier nào "được gọi nhiều".** 13/18 dòng `report` gần chắc chắn là từ `aiBatchRcaScheduler` (cron `0 2 * * *`, thấy trong log khởi động server), tức **traffic nền tự động, không phải người dùng chủ động gọi**. Không có dòng `code`/`fim` nào dù quét file đếm được 20+5 file — đây chính là lỗ hổng phương pháp mà task này tồn tại để lộ ra (xem phần "Phát hiện quan trọng" bên dưới, hoá ra lý do sâu hơn cả "chưa ai gọi").

### Bước 2 — làm dày bằng phiên đại diện

Khởi động app: `npm run dev` (cổng 3000). Đăng nhập qua tRPC `auth.login` bằng tài khoản seed `engineer1` / `Test@1234` (`scripts/seed-test-data.mjs:80-84`) + 2FA TOTP đọc bằng `node scripts/print-otp.mjs engineer1`, hoàn tất qua `POST /api/auth/verify-2fa`. (Tài khoản `admin` seed cũ trong `login.json` không còn đúng mật khẩu — không phải lỗi hệ thống, chỉ là thông tin cũ.)

Thao tác qua tRPC (`/api/trpc/<router>.<procedure>`, body `{"json":{...}}`), **không qua UI** vì nhanh hơn và log được từng lượt chính xác:

| # | Nhóm (theo brief) | Procedure | Số lượt thực hiện | Kết quả |
|---|---|---|---|---|
| 1 | Hỏi trợ lý tri thức (tier chat) | `aiChat.createConversation` rồi `aiChat.chat` | **5** câu hỏi tiếng Việt khác nhau (OEE, workflow bảo trì, SPC out-of-control, cấu hình ngưỡng cảnh báo, RBAC) trên `conversationId=12` | 5/5 thành công, mỗi lượt kèm 1 lượt `intent` tự động (phân loại ý định — sản phẩm phụ của luồng chat, không phải tôi gọi trực tiếp) |
| 2 | RCA / báo cáo (tier chat, prompt dài) | `aiRcaCopilot.diagnose` + `aiReport.rcaReport` | RCA **2** lượt (machineId=2,3) + report **3** lượt (machineId=2,3,4, khoảng 07/2026) = **5** | 5/5 thành công |
| 3 | Sinh/sửa mã PLC (tier code) | `programming.copilotGenerate` (+ `programming.copilotComplete` cho fim) | **5** lượt `copilotGenerate` (kind=iec61131-st, "Viết block chớp đèn báo NG 1Hz") + **1** lượt `copilotComplete` | **0/6 ghi được vào `ai_gateway_metrics`** — xem "Phát hiện quan trọng" |
| 4 | Xử lý ảnh kiểm tra (tier vision) | `aiAdvancedVision.visualQA` | **5** lượt, ảnh THẬT từ `uploads/inspections/4643/*.jpg` (4 ảnh) + `test-pcb-image.jpg` (repo root), câu hỏi khác nhau mỗi lượt | 5/5 thành công |

Thay đổi dữ liệu phụ trợ cần thiết (không phải mã, không phải `.env`):
- Chèn 1 dòng `user_factory_assignments` (`userId=51` seed `engineer1` → `factoryCode='SIM-FAC'`) — thiếu dòng này thì `aiReport.rcaReport` chặn cứng ở `aiAnalyticsScope.ts:295` ("Tài khoản chưa được gán nhà máy nào"). Lệnh:
  ```bash
  MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
  "INSERT INTO user_factory_assignments (\"userId\", \"factoryCode\", \"assignedBy\") VALUES (51, 'SIM-FAC', 51) ON CONFLICT DO NOTHING;"
  ```
  Dòng này vẫn còn trong DB dev sau khi task kết thúc (không xoá — vô hại, chỉ mở quyền xem nhà máy SIM-FAC cho tài khoản test). Xoá bằng `DELETE FROM user_factory_assignments WHERE "userId"=51 AND "factoryCode"='SIM-FAC';` nếu chủ dự án muốn hoàn nguyên.
- Khởi động lại `npm run dev` **một lần** giữa chừng (lý do: rò VRAM, xem "Mối lo" bên dưới) — không đổi mã, không đổi `.env` (`git diff --stat .env` rỗng, xác nhận cuối task).

### Bước 3 — dữ liệu SAU khi làm dày

Lệnh (giống Bước 1, chạy lại):
```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
"SELECT task, model, count(*) AS luot, sum(\"tokensIn\") AS tok_in, sum(\"tokensOut\") AS tok_out,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY \"latencyMs\") AS latency_p50
 FROM ai_gateway_metrics GROUP BY task, model ORDER BY luot DESC;"
```

Output nguyên văn:
```
  task  |                 model                  | luot | tok_in | tok_out | latency_p50 
--------+----------------------------------------+------+--------+---------+-------------
 report | Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL |   16 |    616 |     923 |        6493
 chat   | Qwen3-4B-Instruct-2507-UD-Q4_K_XL      |    9 |  22618 |    1780 |        1996
 vision | default                                |    6 |  18383 |     937 |        2794
 intent | Qwen3-4B-Instruct-2507-UD-Q4_K_XL      |    5 |  23061 |      65 |         904
 rca    | Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL |    2 |      0 |       0 |      2147.5
(5 rows)
```

Tổng số dòng (lệnh `SELECT count(*) FROM ai_gateway_metrics;`): **38** (18 cũ + 20 mới từ phiên này). Vẫn **< 100** — xem cảnh báo bên dưới.

**⚠ ĐÂY LÀ LƯU LƯỢNG DỰNG (SYNTHETIC), KHÔNG PHẢI LƯU LƯỢNG SẢN XUẤT.** Toàn bộ 20 dòng mới là do tôi chủ động gọi trong một phiên đo ~20 phút để lấp đủ 4 nhóm việc theo yêu cầu brief, không phản ánh tần suất người dùng thật sự dùng hệ thống. Task 7 khi cân trọng số theo bảng này **phải** đọc kèm ghi chú này — không suy diễn "chat được gọi 9 lần nên chat quan trọng hơn vision (6 lần)"; tỉ lệ 9:5:3:2:6 (chat:intent:report+2:rca:vision) là tỉ lệ tôi CHỌN gọi theo yêu cầu "≥5 mỗi nhóm", không phải tỉ lệ nhu cầu thật.

### Phát hiện quan trọng — tier `code`/`fim` KHÔNG BAO GIỜ vào được `ai_gateway_metrics`

Đây là phát hiện quan trọng nhất của §1, quan trọng hơn cả bảng số ở trên: quét sơ bộ đếm 20 file `code`/`coder` + 5 file `fim`, nhưng **0 trong 38 dòng** của bảng là `task='code'` hay `task='fim'` — kể cả sau khi tôi gọi `programming.copilotGenerate` **5 lần** (đều lỗi VRAM, xem "Mối lo") và `programming.copilotComplete` **1 lần** (**thành công**, model trả về completion thật, xem log dưới). Lý do không phải "chưa ai gọi" hay "chưa đủ dữ liệu" — mà là **lỗ hổng nối dây trong mã**:

- `server/services/programming/aiProgrammingCopilot.ts` (dùng cho cả `code` và `fim`) gọi thẳng `aiGgufEngine.chatCompletion`/`generateJSON`/`generateFim` (dòng 372, 390, 440, 458, 771, 801) và chỉ dùng `aiModelRouter.route()` (pure, không mét) để lấy tham số model.
- File này **không hề import** `server/services/aiGateway.ts` (đã `grep` xác nhận: không khớp `aiGateway|planInference|routeInference`). Toàn bộ 6 lượt tier chat/rca/report/vision đều đi qua `aiGateway.ts`'s `planInference`/`routeInference` → hàm `enqueue(toRow(...))` mới là chỗ **thực sự ghi** vào `ai_gateway_metrics`.
- Bằng chứng thực nghiệm: lệnh dưới chạy SAU khi đã có 1 lượt `copilotComplete` **thành công** (sinh mã thật `"1;\n  Y2 := 2;..."`) vẫn ra 0 dòng:
  ```bash
  MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
  "SELECT task, count(*) FROM ai_gateway_metrics WHERE task IN ('code','fim') GROUP BY task;"
  # (0 rows)
  ```

**Kết luận cho Task 7:** bảng `ai_gateway_metrics` **cấu trúc không thể** dùng để đo lưu lượng tier code/fim — dù roster cuối cùng có ưu tiên model code hay không, task này không có cách nào chứng minh bằng bảng này. Nếu cần đo lưu lượng code/fim thật, phải hoặc (a) đo qua nguồn khác (ví dụ đếm request ở `programmingRouter.ts` qua access log / APM riêng), hoặc (b) nối `aiProgrammingCopilot.ts` vào `aiGateway.ts` trước — **nhưng đó là đổi hành vi/mã, ngoài phạm vi "chỉ đo" của Đợt 0 này**, chỉ ghi nhận để chủ dự án quyết.

### Nhóm nào thiếu / không đủ ≥5 lượt thật

- **Code/fim**: 0/5 lượt `copilotGenerate` thành công thực sự sinh mã (đều lỗi VRAM — xem "Mối lo"); `copilotComplete` (fim) thành công 1 lượt nhưng vẫn không ghi được metrics vì lý do nối dây ở trên. **Không có cách nào trong phạm vi task này tạo ra dòng `task='code'`/`task='fim'` trong bảng**, kể cả khi gọi thành công — nên "làm dày" nhóm này là bất khả thi bằng đường tRPC, không phải do tôi thiếu cố gắng. Không bù bằng cách gọi lặp nhóm khác.
- 4 nhóm còn lại (chat, intent-phụ, rca, report, vision) đều đạt ≥5 lượt thật như yêu cầu brief (chat=5 mới/9 tổng, rca+report=5 mới/18 tổng, vision=5 mới/6 tổng).

### Mối lo (infra, không phải kết luận roster)

1. **VRAM rò rỉ khi `cudaMalloc` thất bại nhiều lần liên tiếp.** Máy đo: RTX 5090 32.607 MiB (`nvidia-smi`). Baseline lúc app mới khởi động: **~8,7 GB đã dùng** trước khi app tải bất kỳ model nào (desktop Windows + trình nền, không phải app). 5 lần thử tải `Qwen3-Coder-30B` (16,5 GB) đều lỗi `cudaMalloc failed: out of memory`, và **mỗi lần lỗi làm VRAM đã dùng tăng thêm** (8,7 GB → 13,7 GB sau 4 lần thất bại, đo bằng `nvidia-smi --query-gpu=memory.used --format=csv`) dù không có model nào tải thành công — tức bộ nhớ không được giải phóng đúng sau một lần `cudaMalloc` lỗi. Phải `Stop-Process` tiến trình `node` (tsx watch) và khởi động lại `npm run dev` để VRAM về mốc sạch (965 MiB). Đây là quan sát thật trong phiên đo, không phải kết luận — Task 2/3 (đo tráo model) nên lưu ý hiện tượng này khi đo VRAM đỉnh.
2. **Ngay cả khi KHÔNG có model 30B nào khác đang tải, một mình `Qwen3-Coder-30B` (16,5 GB trọng số) cũng không tải được** trong 4/5 lần thử ở phiên này (VRAM free báo 18-24 GB theo `aiGguf.health`/`nvidia-smi` tại thời điểm thử, về lý thuyết đủ chỗ) — nghi vấn context size (`code` task dùng ctx 16384 theo test `aiModelRouter.code.test.ts:108`) cộng buffer runtime của kiến trúc MoE 30B cần nhiều hơn phần trăm free hiển thị bởi `nvidia-smi`/health endpoint tại thời điểm đo. Task 2/3 cần đo trực tiếp VRAM đỉnh lúc tải, không suy từ "free" báo trước khi tải.
3. **`vision` ghi `model='default'`** trong `ai_gateway_metrics` thay vì tên file GGUF thật (`Qwen3-VL-8B-Instruct-UD-Q4_K_XL`) — route quyết định tier vision không set `modelId` tường minh nên cột `model` rơi về default schema (`drizzle/schema/ai.ts`). Không sai chức năng (ảnh vẫn được phân tích đúng, xem câu trả lời "Cổng kết nối... lệch vị trí 0.26 mm" cho ảnh thật), nhưng làm bảng task 7 khó phân biệt "vision dùng model nào" nếu sau này có nhiều hơn 1 model vision. Ghi nhận, không sửa (ngoài phạm vi "chỉ đo").
4. 13/16 dòng `report` (cả trước và sau) khả năng cao là traffic **nền tự động** (`aiBatchRcaScheduler`, cron `0 2 * * *`), không phải người dùng — nên con số "lượt gọi" của `report` không so sánh ngang hàng được với `chat`/`vision` (loại người dùng chủ động).

**Xác nhận `.env` không đổi** (bắt buộc theo global constraint của Đợt 0):
```bash
git diff --stat .env   # → rỗng
```
