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

**18 dòng < 100 → KHÔNG đủ để kết luận gì về tier nào "được gọi nhiều".** 13/18 dòng `report` là traffic nền tự động từ **`ExecReportScheduler`** (`server/services/reportScheduler.ts`, cron `EXEC_REPORT_SHIFT_CRON` mặc định `"0 0 6,14,22 * * *"` — giờ Asia/Ho_Chi_Minh 06:00/14:00/22:00 mỗi ca, `EXEC_REPORT_ENABLED=true` trong `.env`), không phải người dùng chủ động gọi. **(Vòng sửa 1: bản đầu ghi nhầm nguồn là `aiBatchRcaScheduler` / cron `0 2 * * *` — xem mục "Vòng sửa 1" cuối §1 để biết bằng chứng đúng.)** Không có dòng `code`/`fim` nào dù quét file đếm được 20+5 file — đây chính là lỗ hổng phương pháp mà task này tồn tại để lộ ra (xem phần "Phát hiện quan trọng" bên dưới, hoá ra lý do sâu hơn cả "chưa ai gọi").

### Bước 2 — làm dày bằng phiên đại diện

Khởi động app: `npm run dev` (cổng 3000). Đăng nhập qua tRPC `auth.login` bằng tài khoản seed `engineer1` / `Test@1234` (`scripts/seed-test-data.mjs:80-84`) + 2FA TOTP đọc bằng `node scripts/print-otp.mjs engineer1`, hoàn tất qua `POST /api/auth/verify-2fa`. (Tài khoản `admin` seed cũ trong `login.json` không còn đúng mật khẩu — không phải lỗi hệ thống, chỉ là thông tin cũ.)

Thao tác qua tRPC (`/api/trpc/<router>.<procedure>`, body `{"json":{...}}`), **không qua UI** vì nhanh hơn và log được từng lượt chính xác:

| # | Nhóm (theo brief) | Procedure | Số lượt thực hiện | Kết quả |
|---|---|---|---|---|
| 1 | Hỏi trợ lý tri thức (tier chat) | `aiChat.createConversation` rồi `aiChat.chat` | Chủ động gửi **5** câu hỏi tiếng Việt khác nhau (OEE, workflow bảo trì, SPC out-of-control, cấu hình ngưỡng cảnh báo, RBAC) trên `conversationId=12` | 5 câu hỏi thành công, nhưng bảng ghi **6** dòng `chat` + **4** dòng `intent` — KHÔNG phải 5/5 như số lượt gửi, xem giải thích lệch ngay dưới bảng |
| 2 | RCA / báo cáo (tier chat, prompt dài) | `aiRcaCopilot.diagnose` + `aiReport.rcaReport` | RCA **2** lượt (machineId=2,3) + report **3** lượt (machineId=2,3,4, khoảng 07/2026) = **5** | 5/5 thành công |
| 3 | Sinh/sửa mã PLC (tier code) | `programming.copilotGenerate` (+ `programming.copilotComplete` cho fim) | **5** lượt `copilotGenerate` (kind=iec61131-st, "Viết block chớp đèn báo NG 1Hz") + **1** lượt `copilotComplete` | **0/6 ghi được vào `ai_gateway_metrics`** — xem "Phát hiện quan trọng" |
| 4 | Xử lý ảnh kiểm tra (tier vision) | `aiAdvancedVision.visualQA` | **5** lượt, ảnh THẬT từ `uploads/inspections/4643/*.jpg` (4 ảnh) + `test-pcb-image.jpg` (repo root), câu hỏi khác nhau mỗi lượt | 5/5 thành công |

**Vì sao +6 chat / +4 intent, không phải +5/+5 (Minor, vòng sửa 1):** tôi gửi đúng 5 câu hỏi phân biệt, nhưng lần gửi đầu chạy dưới dạng vòng lặp 5 lệnh `curl` bị chính công cụ (bash tool) SIGTERM sau 400s khi câu hỏi thứ 5 (RBAC) đang xử lý — client bị huỷ nhưng **server vẫn xử lý xong request gốc** (tRPC không kiểm tra client-disconnect giữa chừng ở đường `aiChat.chat`) và vẫn ghi 1 dòng metrics. Không biết điều đó, tôi gửi lại câu hỏi RBAC bằng 1 lệnh `curl` riêng — request này cũng chạy xong → 2 dòng `chat` cho cùng 1 câu hỏi. Bằng chứng (lệnh: `MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c "SELECT id, task, \"tokensIn\", \"tokensOut\", \"latencyMs\", \"createdAt\" FROM ai_gateway_metrics WHERE task IN ('chat','intent') ORDER BY \"createdAt\";"`), 2 dòng trùng `tokensIn`/`tokensOut`, cách nhau 85s:
```
id=27 chat tokensIn=2717 tokensOut=220 latencyMs=1584 createdAt=2026-07-31 19:54:56.766
id=28 chat tokensIn=2717 tokensOut=220 latencyMs=1395 createdAt=2026-07-31 19:56:21.423
```
→ 5 câu hỏi thật + 1 dòng trùng = **6** dòng `chat` mới (3→9, khớp bảng Bước 3).

`intent`: chỉ **4** dòng mới (1→5), không phải 5 hay 6 — nghĩa là KHÔNG PHẢI mọi lượt `chat` đều kèm 1 lượt `intent` tự động như bản đầu viết ("mỗi lượt kèm 1 lượt intent tự động" — câu đó sai, đã sửa). Ví dụ dòng `chat` trùng (id=28) không có `intent` đi kèm. Cơ chế chính xác vì sao không phải 1:1 tôi chưa truy đến tận mã nguồn trong task này — ghi nhận hiện tượng bằng số liệu, không suy diễn nguyên nhân.

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

**Kết luận cho Task 7:** bảng `ai_gateway_metrics` **cấu trúc không thể** dùng để đo lưu lượng tier code/fim — dù roster cuối cùng có ưu tiên model code hay không, task này không có cách nào chứng minh bằng bảng này. Nếu cần đo lưu lượng code/fim thật, phải hoặc (a) đo qua nguồn khác (ví dụ đếm request ở `programmingRouter.ts` qua access log / APM riêng), hoặc (b) nối `aiProgrammingCopilot.ts` vào `aiGateway.ts` trước — **nhưng đó là đổi hành vi/mã, ngoài phạm vi "chỉ đo" của Đợt 0 này**, chỉ ghi nhận để chủ dự án quyết. **KHÔNG vá lỗ hổng này trong Đợt 0** — đây là phát hiện của khảo sát, sửa là việc của đợt khác.

### ⚠ Giới hạn quan trọng cho Task 7 — không có bảng nào thay thế được cho code/fim

Đã kiểm thêm bảng thứ hai có thể chứa dữ liệu tương tự:
```bash
MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c "SELECT count(*) FROM ai_model_metrics;"
# → 0
```
`ai_model_metrics` tồn tại (có schema) nhưng **0 dòng** — không có nguồn thay thế nào trong DB hiện tại để bù đắp cho lỗ hổng nối dây của `aiProgrammingCopilot.ts`. Kết luận cho Task 7: **khi cân trọng số roster, KHÔNG được coi "code/fim = 0 lượt trong bảng" là bằng chứng "code/fim ít được dùng"** — đó là khoảng trống đo lường (measurement gap), không phải khoảng trống nhu cầu (demand gap). Nếu quyết định roster phụ thuộc vào tần suất dùng code/fim thật, phải đo bằng nguồn khác ngoài phạm vi Đợt 0 này, hoặc chấp nhận quyết định dựa trên các trục khác (VRAM, chất lượng — §2-§6) mà không có dữ liệu lưu lượng code/fim.

### Nhóm nào thiếu / không đủ ≥5 lượt thật

- **Code/fim**: 0/5 lượt `copilotGenerate` thành công thực sự sinh mã (đều lỗi VRAM — xem "Mối lo"); `copilotComplete` (fim) thành công 1 lượt nhưng vẫn không ghi được metrics vì lý do nối dây ở trên. **Không có cách nào trong phạm vi task này tạo ra dòng `task='code'`/`task='fim'` trong bảng**, kể cả khi gọi thành công — nên "làm dày" nhóm này là bất khả thi bằng đường tRPC, không phải do tôi thiếu cố gắng. Không bù bằng cách gọi lặp nhóm khác.
- 3 nhóm còn lại đều đạt ≥5 lượt thật như yêu cầu brief: chat=**6** mới/9 tổng (5 câu hỏi + 1 dòng trùng, xem giải thích ở Bước 2), intent-phụ=**4** mới/5 tổng (byproduct, không phải nhóm brief yêu cầu), rca+report=**5** mới/18 tổng (rca +2, report +3), vision=**5** mới/6 tổng.

### Mối lo (infra, không phải kết luận roster)

1. **VRAM rò rỉ khi `cudaMalloc` thất bại nhiều lần liên tiếp.** Máy đo: RTX 5090 32.607 MiB (`nvidia-smi`). Baseline lúc app mới khởi động: **~8,7 GB đã dùng** trước khi app tải bất kỳ model nào (desktop Windows + trình nền, không phải app). 5 lần thử tải `Qwen3-Coder-30B` (16,5 GB) đều lỗi `cudaMalloc failed: out of memory`, và **mỗi lần lỗi làm VRAM đã dùng tăng thêm** (8,7 GB → 13,7 GB sau 4 lần thất bại, đo bằng `nvidia-smi --query-gpu=memory.used --format=csv`) dù không có model nào tải thành công — tức bộ nhớ không được giải phóng đúng sau một lần `cudaMalloc` lỗi. Phải `Stop-Process` tiến trình `node` (tsx watch) và khởi động lại `npm run dev` để VRAM về mốc sạch (965 MiB). Đây là quan sát thật trong phiên đo, không phải kết luận — Task 2/3 (đo tráo model) nên lưu ý hiện tượng này khi đo VRAM đỉnh.
2. **Ngay cả khi KHÔNG có model 30B nào khác đang tải, một mình `Qwen3-Coder-30B` (16,5 GB trọng số) cũng không tải được** trong 4/5 lần thử ở phiên này (VRAM free báo 18-24 GB theo `aiGguf.health`/`nvidia-smi` tại thời điểm thử, về lý thuyết đủ chỗ) — nghi vấn context size (`code` task dùng ctx 16384 theo test `aiModelRouter.code.test.ts:108`) cộng buffer runtime của kiến trúc MoE 30B cần nhiều hơn phần trăm free hiển thị bởi `nvidia-smi`/health endpoint tại thời điểm đo. Task 2/3 cần đo trực tiếp VRAM đỉnh lúc tải, không suy từ "free" báo trước khi tải.
3. **`vision` ghi `model='default'`** trong `ai_gateway_metrics` thay vì tên file GGUF thật (`Qwen3-VL-8B-Instruct-UD-Q4_K_XL`) — route quyết định tier vision không set `modelId` tường minh nên cột `model` rơi về default schema (`drizzle/schema/ai.ts`). Không sai chức năng (ảnh vẫn được phân tích đúng, xem câu trả lời "Cổng kết nối... lệch vị trí 0.26 mm" cho ảnh thật), nhưng làm bảng task 7 khó phân biệt "vision dùng model nào" nếu sau này có nhiều hơn 1 model vision. Ghi nhận, không sửa (ngoài phạm vi "chỉ đo").
4. 13/16 dòng `report` (cả trước và sau) là traffic **nền tự động** — nên con số "lượt gọi" của `report` không so sánh ngang hàng được với `chat`/`vision` (loại người dùng chủ động). **Nguồn đúng (vòng sửa 1) là `ExecReportScheduler`**, không phải `aiBatchRcaScheduler` như bản đầu ghi nhầm:
   - `aiBatchRcaScheduler` chỉ dùng `task:"rca"` — xác nhận `server/services/aiInsightsService.ts:82` (`route({ task: "rca", requiredQuality: "high" })`) và `grep -n "task" server/services/aiBatchRcaScheduler.ts` không ra kết quả nào (file này không tự set task nào, uỷ quyền cho `aiInsightsService`).
   - Nguồn thật: `server/services/reportScheduler.ts:576-668` (`runExecutiveReport` → `aiExecutiveReport.ts:489` `route({task:"report", requiredQuality:"high"})`), cron `EXEC_REPORT_SHIFT_CRON` mặc định `"0 0 6,14,22 * * *"` (không bị override trong `.env`) + cron `day` mặc định `EXEC_REPORT_DAY_CRON="0 5 6 * * *"`, giờ `EXEC_REPORT_TZ=Asia/Ho_Chi_Minh`, `EXEC_REPORT_ENABLED=true`.
   - Bằng chứng đối chiếu timestamp (lệnh: `MSYS_NO_PATHCONV=1 docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c "SELECT id, \"createdAt\", \"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh' AS vn_time FROM ai_gateway_metrics WHERE task='report' ORDER BY \"createdAt\" LIMIT 8;"`) — giờ VN suy ra khớp đúng 06:00 / 06:05 / 14:00 / 22:00 lặp lại mỗi ngày:
     ```
     id=1 createdAt=2026-07-27 07:00:02 UTC → 14:00:02 VN   (khớp ca 14:00 shift-cron)
     id=6 createdAt=2026-07-27 23:00:22 UTC → 06:00:22 VN (28/07)  (khớp ca 06:00 shift-cron)
     id=7 createdAt=2026-07-27 23:05:13 UTC → 06:05:13 VN (28/07)  (khớp day-cron 06:05)
     id=8 createdAt=2026-07-28 15:00:02 UTC → 22:00:02 VN   (khớp ca 22:00 shift-cron)
     ```
   - Kết luận **định hướng** (traffic nền, không so ngang hàng với chat/vision) không đổi — chỉ tên scheduler + biểu thức cron ở bản đầu sai (`0 2 * * *` không khớp bất kỳ dòng nào thật sự).

**Xác nhận `.env` không đổi** (bắt buộc theo global constraint của Đợt 0):
```bash
git diff --stat .env   # → rỗng
```

### Vòng sửa 1 (review)

Reviewer tự chạy lại SQL — bảng §1 khớp 100%; xác nhận độc lập đúng cả 3 điểm: lỗ hổng `aiProgrammingCopilot`↛`aiGateway`, `vision` ghi `model='default'`, dòng test `user_factory_assignments`. Hai điểm phải sửa, cả hai đã sửa trong bản này:

- **Important — quy sai nguồn traffic `report`.** Bản đầu ghi "`aiBatchRcaScheduler`, cron `0 2 * * *`". Reviewer bác, tôi tự kiểm chứng độc lập (đọc mã + đối chiếu timestamp thật, không chỉ tin lời reviewer) và xác nhận reviewer đúng: nguồn thật là `ExecReportScheduler` (`server/services/reportScheduler.ts`), cron mặc định `EXEC_REPORT_SHIFT_CRON="0 0 6,14,22 * * *"` + `EXEC_REPORT_DAY_CRON="0 5 6 * * *"`, cả hai đang bật. Đã sửa ở Bước 1 và Mối lo #4 (bằng chứng cron + timestamp đính kèm).
- **Minor — số "mới" tự mâu thuẫn với bảng.** Bản đầu ghi "chat +5" / ngụ ý "intent +5" nhưng bảng cho thấy chat 3→9 (+6), intent 1→5 (+4). Đã sửa: giải thích +6 do 1 request chat bị timeout ở client nhưng server xử lý xong (không huỷ được) + tôi gửi lại → trùng 1 lượt (bằng chứng: 2 dòng `tokensIn`/`tokensOut` giống hệt, id=27/28); +4 (không phải 1:1 mỗi chat) ghi nhận là hiện tượng chưa truy rõ cơ chế, không suy diễn.
- **Ghi thêm cho Task 7** (không phải lỗi, theo yêu cầu reviewer): thêm mục "⚠ Giới hạn quan trọng cho Task 7" — `ai_model_metrics` cũng 0 dòng, không có nguồn thay thế cho code/fim trong DB hiện tại.

Không đụng mã sản xuất, không đụng `.env` trong vòng sửa này — chỉ sửa văn bản báo cáo.

---

## §2 Tráo model & KV cache (Task 2)

**Câu hỏi:** roster hiện tại (2 model 30B riêng: `Qwen3-30B-A3B-Instruct` cho default + `Qwen3-Coder-30B-A3B` cho code) có đuổi nhau (LRU evict) nhiều hơn roster A (gộp default=code=cùng 1 file 30B) không? Phải đo được **cả hai chiều** — brief giả thuyết hiện tại evict>0, A evict=0.

**⚠ Kết quả bất ngờ — báo trung thực, không ép khớp giả thuyết:** cả hai roster đều đo ra **0 lần evict**. KHÔNG phải vì roster A "đủ chỗ" như giả thuyết — mà vì qua **đường boot của app**, 45/45 lượt thử nạp 30B (Instruct hay Coder, ở roster nào) đều lỗi `cudaMalloc failed: out of memory`, kể cả khi VRAM đang dùng chỉ 58-71%. Cơ chế LRU-evict không có gì để đuổi vì không có gì nạp được để mà đuổi.

**⚠ Sửa sau review round 1 (Critical):** bản đầu kết luận rộng hơn bằng chứng — viết "không model 30B nào nạp thành công trong **môi trường đo hôm nay**". Reviewer bác bằng cách tự chạy `node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0` — nạp **thành công ngay lần đầu**. Tôi tự chạy lại độc lập (không chỉ tin lời reviewer, xem "Bằng chứng đường race-free" bên dưới) và xác nhận đúng: **CẢ HAI** model 30B nạp sạch qua `bench.mjs` (không boot app). Kết luận đúng, đã thu hẹp: **"không nạp nổi qua ĐƯỜNG BOOT HIỆN TẠI CỦA APP (do race điều kiện double-warm — xem bên dưới), KHÔNG PHẢI môi trường/driver hỏng."** 45/45 lỗi qua đường boot app vẫn là số liệu ĐÚNG và vẫn có giá trị — chỉ phạm vi kết luận rút gọn lại.

### Phương pháp

Lặp lại đúng phiên đại diện 4 nhóm ≥5 lượt của Task 1 Bước 2 (chat/RCA+report/code/vision), 1 lần cho mỗi roster, đo qua `npm run dev > log 2>&1` (log evict ra thẳng stdout, xác nhận đọc mã `aiGgufEngine.ts:341-390` — có **2 đường log evict khác định dạng**: `console.warn` dòng 366 chữ thường "evicted LRU model "X" before loading" [nhánh `enforceVramGuard()` theo %VRAM] và `console.log` dòng 388 chữ Hoa "Evicted LRU model: X" [nhánh `evictLRU()`, gọi từ cả guard lẫn nhánh catch-retry-OOM ở `loadGgufModel()` dòng 622-645] — brief chỉ nhắm đường #1, đã đo cả hai để không bỏ sót). VRAM đỉnh đo song song bằng `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 1` ghi ra CSV riêng.

Roster hiện tại chạy qua **3 tiến trình** `npm run dev` (2 lần crash tiến trình giữa chừng — xem "Phát hiện thêm" bên dưới); roster A qua **2 tiến trình** (1 lần crash). Restart sạch giữa mỗi lần crash, không đo tiếp trên tiến trình cũ.

### Bảng kết quả

| Roster | Evict (log #1, brief) | Evict (log #2) | Lượt thử 30B / thành công | Lỗi `cudaMalloc` | VRAM đỉnh | Crash tiến trình |
|---|---|---|---|---|---|---|
| **Hiện tại** (`GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct`, `GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B`, khác file) | **0** | **0** | 24 / **0** | 24 | 19039 MiB (58% / 32.607 MiB) | 2 |
| **A** (`GGUF_DEFAULT_MODEL=GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`, cùng 1 file) | **0** | **0** | 21 / **0** | 21 | 23298 MiB (71% / 32.607 MiB) | 1 |

Lệnh tạo bảng (chạy trên từng file log/csv của từng roster, gộp lại):
```bash
grep -c "evicted LRU model" do0-roster-*.log         # đường #1 (brief) — tất cả = 0
grep -c "Evicted LRU model:" do0-roster-*.log        # đường #2 — tất cả = 0
grep -c "cudaMalloc failed" do0-roster-*.log         # 2+5+17=24 (hiện tại) · 2+19=21 (A)
grep -c "Loading model:.*Qwen3-30B-A3B-Instruct\|Loading model:.*Qwen3-Coder-30B" do0-roster-*.log
cat do0-vram-*.csv | sort -n | tail -3               # peak per roster
```

Model **duy nhất** nạp thành công ở CẢ HAI roster: `Qwen3-Embedding-0.6B-f16`, `Qwen3-4B-Instruct-2507` (fast tier), `Qwen2.5-Coder-1.5B-Instruct` (FIM). Không có lượt 30B nào (Instruct hay Coder, roster nào) thành công.

### Điều tra thêm — vì sao đường boot app không nạp nổi 30B, dù đường race-free nạp sạch

Vượt khỏi yêu cầu tối thiểu của brief, nhưng cần thiết để báo cáo không bị hiểu lầm.

**Bằng chứng đường race-free (tự chạy, sau review round 1):**
```bash
node scripts/ai-bench/bench.mjs --models deep --iters 1 --warmup 0
# [bench] loaded in 8307.2ms
# [bench]   prefill@128 (153tok): prefill 559.7 tok/s, decode 292.7 tok/s
# vram: baselineUsedMib=1164, peakUsedMib=18896, modelDeltaMib=17732 (baseline JSON: scripts/ai-bench/baselines/2026-07-31T21-52-29-887Z.json)

node scripts/ai-bench/bench.mjs --models code --iters 1 --warmup 0
# [bench] loaded in 39902.3ms
# [bench]   prefill@128 (153tok): prefill 464.5 tok/s, decode 285.9 tok/s
# (baseline JSON: scripts/ai-bench/baselines/2026-07-31T21-53-00-652Z.json)
```
**CẢ HAI** model 30B (`Qwen3-30B-A3B-Instruct` VÀ `Qwen3-Coder-30B-A3B`) nạp **thành công ngay lần đầu** qua `bench.mjs` — script tự nạp `node-llama-cpp` trực tiếp, **không boot app**, nên không đi qua đường có race điều kiện. Cả hai lần, tiến trình thoát sạch, VRAM về baseline (1163/1157 MiB) — không leak. Đây là bằng chứng trực tiếp, đối lập 2/2 thành công (race-free) với 45/45 thất bại (qua app) trên **cùng model, cùng máy, cùng driver, cùng cấu hình BAR1**.

**Hai giả thuyết cho "vì sao đường app hỏng" — đặt cạnh nhau, không để giả thuyết yếu hơn đứng đầu:**

1. **Race điều kiện double-warm lúc boot (bằng chứng MẠNH, xác nhận độc lập bởi reviewer đọc mã VÀ tự tôi đọc lại sau review):** `aiGgufEngine.ts:1066-1098` (`initDeepModelWarmup()`, gọi từ `server/_core/backgroundJobs.ts:126-127`, delay mặc định 3000ms — tự xác nhận: `sed -n '120,130p' server/_core/backgroundJobs.ts`) VÀ `aiLocalKnowledgeService.ts:2392-2418` (`warmUpOllamaModels()`, gọi từ `server/routes/aiLocalKnowledgeApi.ts:268` lúc `registerAiLocalKnowledgeRoutes()` đăng ký route, delay 2000ms — tự xác nhận: `sed -n '260,272p' server/routes/aiLocalKnowledgeApi.ts`) **độc lập với nhau cùng gọi `warmModel(GGUF_DEFAULT_MODEL)`**. `loadGgufModel()` **không có mutex/in-flight lock** cho model đang nạp dở dang — early-return "đã nạp chưa" chỉ kiểm tra `loadedModels.has(modelId)` (đã nạp XONG), không khoá "đang nạp DỞ". Hai lời gọi cùng modelId race nhau (delay lệch 1s: 2000ms vs 3000ms — đủ để CẢ HAI đều đi qua check trước khi lời gọi đầu hoàn tất, vì `llama.loadModel()` mất 8-40s), cả hai cùng xin cấp phát ~17GB đồng thời (34GB > 32,6GB) → OOM gần như chắc chắn cho ít nhất 1, thường cả 2. **Tái hiện 100% mọi lần boot** trong khảo sát này (luôn thấy đúng 2 dòng `Loading model:` liên tiếp cho cùng 1 model ngay sau boot, luôn theo sau bởi ≥1 dòng `cudaMalloc failed`). Giải thích trực tiếp, đầy đủ cho lỗi ĐẦU TIÊN của mỗi tiến trình.
2. **Thiếu `dispose()` ở nhánh catch OOM, gây phân mảnh/rò trong PHẠM VI 1 tiến trình sống (bằng chứng vừa, khớp ngang hoặc hơn giả thuyết BAR1 bên dưới):** `aiGgufEngine.ts:622-645` — khi `llama.loadModel()` lỗi OOM, biến `model` chưa bao giờ được gán (assignment bên trái thất bại) nên không có handle JS nào để gọi `dispose()`; nếu native layer (ggml/llama.cpp) đã cấp phát MỘT PHẦN buffer trước khi lỗi toàn phần và không tự dọn trước khi ném exception lên JS, phần đó rò ở tầng CUDA context của native add-on. Khớp với: (a) trong CÙNG 1 tiến trình sống (`do0-roster-hientai-part3.log`), VRAM tăng dần qua ~17 lượt lỗi liên tiếp (1113→19035 MiB) rồi NGƯNG — dạng "rò tới một ngưỡng rồi bão hoà" khớp với rò từng phần lặp lại tại CÙNG điểm cấp phát; (b) `bench.mjs` chạy trong tiến trình HOÀN TOÀN MỚI (không có context CUDA cũ, không có rò tích luỹ) nạp sạch ngay lần đầu — nhất quán với "vấn đề gắn với TRẠNG THÁI TÍCH LUỸ của 1 tiến trình sống, không phải môi trường/driver bên ngoài tiến trình". **Chưa chứng minh dứt điểm** (chưa đọc được mã native của `node-llama-cpp`/ggml để xác nhận đường rò cụ thể) nhưng khớp bằng chứng ít nhất ngang giả thuyết #3.
3. **BAR1 gần đầy (227/256 MiB) — DEMOTE, giả thuyết yếu, có khả năng KHÔNG liên quan:** `nvidia-smi -q -d MEMORY` cho thấy BAR1 chỉ 256 MiB tổng, gần đầy. Bản đầu đặt giả thuyết này lên đầu — **sai vị trí, đã sửa theo review**: BAR1 là cửa sổ CPU↔GPU (dùng cho pinned/mapped/P2P), về nguyên tắc **không chi phối `cudaMalloc` device-side thuần** mà `llama.cpp` dùng để cấp phát buffer trọng số. Kiểm tra lại (tự chạy sau review): BAR1 **VẪN 227/256 MiB, không đổi**, đo cả lúc app đang lỗi (Bước 2-3, trong task) LẪN ngay sau 2 lần `bench.mjs` thành công (bây giờ) LẪN lúc GPU hoàn toàn rảnh — tức BAR1 gần-đầy là trạng thái NỀN CỐ ĐỊNH của máy (nhiều khả năng do desktop/driver Windows tự chiếm), **không tương quan** với việc load 30B qua app thành công hay thất bại. Hạ xuống hàng "quan sát phụ, không phải cơ chế dẫn đầu".
4. **3 lần crash tiến trình hoàn toàn** (không chỉ leak VRAM như Task1 mô tả) — log dừng im lặng, không JS stack trace, VRAM về baseline ngay lập tức trong 1 khoảng poll (1s). Khác nhánh OOM-có-catch (case đó IN RA stack trace và server vẫn sống). Dấu hiệu crash gốc native trong add-on CUDA — độc lập xác nhận, MẠNH HƠN mối lo mức-tin-cậy-trung-bình của Task1. **Đã kiểm `%LOCALAPPDATA%\CrashDumps` (tự chạy, không chỉ tin reviewer):**
   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\CrashDumps" | Select-Object Name, LastWriteTime
   ```
   → có dump cho `git.exe`, `Inno3D.exe`, `pemworker.exe`, `smtpprobe.exe`, `UVUninstall.exe` (nghĩa là Windows Error Reporting CÓ hoạt động trên máy này cho một số tiến trình) nhưng **KHÔNG có dump nào cho `node.exe`** dù quan sát 3 lần biến mất hoàn toàn — ghi nhận để người điều tra sau không mất công tìm dump; crash không để lại minidump theo cấu hình WER hiện tại (native crash có thể bị chặn ở tầng driver/CUDA trước khi WER kịp bắt).

### KV cache dưới ngữ cảnh tối đa (`GGUF_MAX_CTX`=32768)

**Không đo được qua tier deep/code** — cả hai model 30B không nạp nổi phần TRỌNG SỐ (không liên quan KV cache), không tách được ảnh hưởng riêng của context lớn. Đo thay thế bằng model tin cậy nhất (`GGUF_FAST_MODEL`=Qwen3-4B), gọi trực tiếp `loadGgufModel`/`generateText`/`unloadGgufModel` (cùng code path production) qua script cô lập, quét contextSize 4096→32768, unload giữa mỗi lần:

| contextSize | VRAM trước | VRAM sau (Δ) | Kết quả |
|---|---|---|---|
| 4096 | 1169 MiB | 6702 MiB (+5533) | OK |
| 8192 | 1664 MiB | 9005 MiB (+7341) | OK |
| 16384 | 1663 MiB | 13603 MiB (+11940) | OK |
| 32768 (trần cứng) | 1653 MiB | 22819 MiB (+21166) | OK |

4/4 thành công, unload trả VRAM về baseline mỗi lần (không leak khi nạp THÀNH CÔNG). Không tìm được "mốc bắt đầu thiếu" cho model 4B (32768 chỉ tốn 68% VRAM). **Không đo được cho tier 30B** — lý do nêu trên, không ngoại suy.

### Lỗi phương pháp trong brief — `.env` không được git track

Brief Bước 4 dùng `git diff --stat .env` + `git checkout -- .env` để xác nhận hoàn nguyên. **Không hoạt động**: `.env` nằm trong `.gitignore` → `git diff --stat .env` LUÔN rỗng bất kể nội dung thật, và `git checkout -- .env` **LỖI** (`pathspec did not match`) — không hoàn nguyên gì. Phát hiện ngay khi chạy (thấy lỗi thay vì thành công im lặng) → hoàn nguyên **thủ công** bằng cách sửa lại đúng dòng đã đổi rồi xác nhận bằng đọc nội dung file (không dùng git). Task1 cũng dùng đúng công thức này để "xác nhận" — vô hại vì họ chưa từng sửa `.env`, nhưng phép xác nhận đó chưa từng thực sự chứng minh được gì. Khuyến nghị: Task nào sau này còn phải sửa `.env` tạm thời thì xác nhận hoàn nguyên bằng `grep`/đọc nội dung, không dùng lệnh git cho file bị `.gitignore` chặn.

**Xác nhận `.env` đã hoàn nguyên** (thủ công):
```bash
grep -n "^GGUF_DEFAULT_MODEL=" .env
# → GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf   (đúng giá trị gốc)
```

### Kết luận cho Task 7 (sửa sau review round 1 — khuyến nghị cũ "chờ môi trường ổn định" SAI hướng, đã thay)

**Không thể trả lời câu hỏi gốc của Đợt 0 ("roster nào evict nhiều hơn") bằng dữ liệu hôm nay qua đường app** — cả hai roster đều evict=0 vì tier deep hỏng hoàn toàn qua ĐƯỜNG BOOT CỦA APP ở MỌI roster (nguyên nhân chính: race điều kiện double-warm, mục #1 ở trên — KHÔNG PHẢI môi trường/driver hỏng, đã chứng minh bằng `bench.mjs` nạp sạch 2/2 lần), không phải vì 1 trong 2 thiết kế tốt hơn trên trục evict.

**Khuyến nghị ĐÚNG cho Task 7 (thay cho "chờ môi trường ổn định" ở bản trước — SAI, môi trường không hỏng):**
1. **Vá race điều kiện double-warm** (`aiGgufEngine.ts:1066-1098` × `aiLocalKnowledgeService.ts:2392-2418`, cùng gọi `warmModel(GGUF_DEFAULT_MODEL)` không khoá) rồi đo lại evict qua đường app — đây là việc CẦN làm trước khi đường app cho số evict có nghĩa.
2. **Trong lúc chờ vá:** đường **race-free** (`scripts/ai-bench/bench.mjs`, không boot app) **DÙNG ĐƯỢC NGAY** để đo tải/VRAM/tok-s của từng model 30B riêng lẻ (không đo được evict qua đường này vì nó không tái hiện tình huống 2 model tranh chấp cùng lúc — nhưng đo được "1 model 30B đơn lẻ có nạp/chạy được không, tốn bao nhiêu VRAM/thời gian" một cách đáng tin cậy, đúng loại số Task 7 cần cho quyết định "model nào nên thường trú").
3. Không suy diễn "cả hai roster đều tệ như nhau" từ dữ liệu evict hôm nay — dữ liệu evict hôm nay đo lỗi HẠ TẦNG (race), không đo được tín hiệu roster thật.

### Vòng sửa 1 (review)

Reviewer: spec ✅ đạt, diff sạch, `.env` hoàn nguyên đúng, đo cả hai chiều + báo trung thực kết quả bất ngờ — giữ nguyên tinh thần đó. Race điều kiện double-warm được xác nhận ĐÚNG bằng đọc mã độc lập (vị trí chính xác hơn bản đầu: `server/_core/backgroundJobs.ts:126-127` gọi `initDeepModelWarmup`, `server/routes/aiLocalKnowledgeApi.ts:268` gọi `warmUpOllamaModels()` của `aiLocalKnowledgeService.ts`). 1 Critical + 1 Important + 1 Minor:

- **Critical — kết luận rộng hơn bằng chứng, trỏ sai hướng cho Task 7.** Bản đầu: "không model 30B nào nạp thành công trong môi trường đo hôm nay" + khuyến nghị Task 7 "chờ môi trường/driver ổn định". Reviewer tự chạy `bench.mjs --models deep --iters 1 --warmup 0` → nạp thành công 40,3s. Tôi tự chạy lại độc lập (không chép số reviewer) — xác nhận đúng, CẢ HAI model 30B nạp sạch qua đường race-free (xem "Bằng chứng đường race-free"). Đã thu hẹp kết luận thành "không nạp nổi qua ĐƯỜNG BOOT CỦA APP", sửa khuyến nghị Task 7 thành "vá race rồi đo lại + dùng `bench.mjs` ngay trong lúc chờ vá" (không phải "chờ môi trường ổn định").
- **Important — 2 giả thuyết chưa đối chiếu ngang hàng, giả thuyết yếu hơn (BAR1) đứng đầu.** Đã sắp lại thứ tự: race điều kiện (bằng chứng mạnh) lên #1, thiếu `dispose()`-gây-phân-mảnh-trong-1-tiến-trình lên #2 (khớp bằng chứng ngang/hơn), BAR1 xuống #3 kèm giải thích tại sao yếu hơn (BAR1 đo lại vẫn 227/256 MiB **không đổi** dù app đang lỗi hay `bench.mjs` vừa thành công — không tương quan với kết quả nạp, nhiều khả năng là trạng thái nền cố định của máy, không phải cơ chế gây OOM).
- **Minor — crash dump.** Đã tự kiểm `%LOCALAPPDATA%\CrashDumps` (không chỉ tin reviewer) — xác nhận: có dump cho tiến trình khác (`git.exe`, `Inno3D.exe`...) nhưng không có dump `node.exe` nào. Ghi thêm vào mục #4.

Không vá race điều kiện (đúng ràng buộc — đó là phát hiện của khảo sát, để đợt vá sau). Không đụng mã sản xuất, không đụng `.env` trong vòng sửa này — chỉ chạy thêm 2 lệnh `bench.mjs` (đọc, không ghi) + sửa văn bản báo cáo.

Bản đầy đủ (điều tra chi tiết, log excerpt, script KV-cache-scan): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-2-report.md` (không commit — `.superpowers/sdd/*` bị `.gitignore` chặn).

---

## §3 Bench ba roster (Task 3)

**Câu hỏi:** đo hiệu năng thật (load ms · prefill/decode tok/s · VRAM đỉnh) của 3 roster ứng viên bằng harness có sẵn `scripts/ai-bench/bench.mjs`, **không sửa harness**, **chỉ đo**.

### Phương pháp

Đọc `scripts/ai-bench/README.md` trước khi chạy (Bước 1) — harness tự nạp `node-llama-cpp` trực tiếp, đọc `GGUF_*` từ `.env` qua `dotenv`, không boot app. Backup `.env` thủ công trước khi sửa dòng nào (`.env` không git-track — bài học Task 2):
```bash
cp .env .env.do0-backup
```
Mỗi roster chạy `npm run ai:bench -- --label <tên>` (full run mặc định: `deep,fast,code,fim,embed`, `warmup=1 iters=3 maxTokens=256 prefill=128,1024` — không truyền cờ nào khác, đúng cấu hình mặc định của harness). Sau mỗi lượt: xác nhận `nvidia-smi` VRAM về baseline (~1,1-1,2 GB) và không còn `node.exe` (`tasklist | grep node.exe`).

### Roster hiện tại làm mốc (Bước 2) — không đổi `.env`

Lệnh:
```bash
npm run ai:bench -- --label roster-current-do0-3
```
5/5 model đo được, 0 skip. Ghi `scripts/ai-bench/baselines/roster-current-do0-3.json`. VRAM sau chạy: 1189 MiB (so baseline trước chạy 1183 MiB) — sạch, không `node.exe` treo.

### Roster A (Bước 3) — `GGUF_DEFAULT_MODEL=GGUF_CODE_MODEL`=Coder-30B (cùng 1 file)

Sửa `.env` dòng 120: `GGUF_DEFAULT_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` (giữ nguyên `GGUF_CODE_MODEL` đã sẵn là Coder-30B). Lệnh:
```bash
npm run ai:bench -- --label roster-A
```
5/5 model đo được, 0 skip → `scripts/ai-bench/baselines/roster-A.json`. VRAM sau chạy 1094 MiB, không `node.exe` treo.

### Roster B (Bước 4) — `GGUF_DEFAULT_MODEL`=Qwen3-4B (nhỏ), `GGUF_CODE_MODEL`=Coder-30B (không đổi)

Sửa `.env` dòng 120: `GGUF_DEFAULT_MODEL=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf`. Lệnh:
```bash
npm run ai:bench -- --label roster-B
```
5/5 model đo được, 0 skip → `scripts/ai-bench/baselines/roster-B.json`. VRAM sau chạy 1104 MiB, không `node.exe` treo.

### Roster C (Bước 5, **sửa sau review round 1**) — ĐO ĐƯỢC, không cần sửa mã

**Bản đầu kết luận "chưa đo được" — SAI, đã sửa.** Bản đầu chỉ tìm biến env/cờ CLI (`GGUF_GPU_LAYERS`, `--gpuLayers` trên `bench.mjs`) — đúng là **không tồn tại** ở 2 nơi đó, nhưng dừng tìm quá sớm. Reviewer lần mã tiếp và chỉ ra cơ chế partial-offload **đã có sẵn, đang vận hành**, chỉ chưa lộ qua `bench.mjs`:

- `server/routers/aiGgufRouter.ts:47-55` — mutation `aiGguf.loadModel` nhận thẳng `gpuLayers: z.number().min(-1).max(200).optional()`, nối trực tiếp tới `loadGgufModel(input)` (import từ `aiGgufEngine.ts`, dòng 612/620 `const requestedGpuLayers = config.gpuLayers ?? "max"` → `llama.loadModel({ ..., gpuLayers: requestedGpuLayers })`).
- Đây chính là hàm **production thật** mà mọi lượt nạp model trong app đi qua — không phải API thử nghiệm.

**Cách đo:** thay vì đi qua Express + tRPC HTTP + router (rủi ro dính 2 racer boot-warm mà Task 2 phát hiện), viết script tạm **import thẳng `loadGgufModel`/`unloadGgufModel`/`generateText`/`getLoadedGgufModels` từ `server/services/aiGgufEngine.ts`** (script tạm `scripts/ai-bench/_roster-c-probe.ts`, chạy bằng `npx tsx`, **xoá ngay sau khi chạy xong**, không commit). Import module này một mình **không** boot Express app ⇒ **không** trigger `backgroundJobs.ts`'s `initDeepModelWarmup()` lẫn `aiLocalKnowledgeApi.ts`'s `warmUpOllamaModels()` (cả hai chỉ chạy khi Express app khởi động các route/job của nó) — nên **không cần đổi `GGUF_WARM_DEEP_MODEL_ON_BOOT`, không cần sửa `.env` gì cho bước này**. Đây là lựa chọn sạch hơn gợi ý ban đầu của reviewer (tắt 1 racer qua app), vì né được **cả hai** racer bằng cấu trúc thay vì tắt được 1.

Trước khi chọn số lớp, đọc metadata thật của file Instruct-30B bằng `readGgufFileInfo` (export nhẹ của `node-llama-cpp`, không cần load full model):
```bash
node -e "const {readGgufFileInfo}=await import('node-llama-cpp'); const info=await readGgufFileInfo('D:/SOURCES/16.AI/Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf'); console.log(info.architectureMetadata);" --input-type=module
# → { block_count: 48, ... expert_count: 128, expert_used_count: 8, ... }
```
→ Instruct-30B có **48 layer**. Chọn `gpuLayers=8` (≈17% trên GPU, ~83% đẩy sang CPU/RAM) làm đại diện cụ thể cho tinh thần "đẩy sang RAM 64GB" của roster C.

**Kết quả (script chạy 1 lần, log đầy đủ, VRAM trước 1070 MiB):**

| Bước | Model | gpuLayers | load ms | VRAM sau (MiB) | VRAM Δ (MiB) |
|---|---|---|---|---|---|
| 1 | General-30B (Instruct) | 8 / 48 | 5671 | 4770 | 3700 |
| 2 | Coder-30B (trong khi General **vẫn resident**) | max | 45249 | 23283 | +18513 (so bước 1) |

→ **CẢ HAI model 30B cùng resident thành công** — 23283 MiB / 32607 MiB = **71,4%**, dưới ngưỡng `GGUF_VRAM_GUARD_PCT=90` nên không có eviction nào xảy ra, không lỗi `cudaMalloc`.

`generateText()` (cùng hàm, cùng script, cùng đơn vị đo — so sánh nội bộ đáng tin dù không cùng thang với `bench.mjs`, xem chú thích dưới bảng chính):
- General-30B (`gpuLayers=8`, 49 token sinh ra): **2,9 tok/s** — rất chậm, phần lớn tính toán chạy trên CPU.
- Coder-30B (`gpuLayers=max`, 27 token sinh ra): **30,5 tok/s**.

⚠ **Hai con số trên KHÔNG so trực tiếp được với cột "decode tok/s" của bảng bench.mjs chính** (khác định nghĩa: `generateText()`'s `tokensPerSecond` gộp cả prefill+decode vào 1 tổng, còn `bench.mjs` tách riêng TTFT/decode; thêm nữa lượt gọi này **không có warmup** — bench.mjs luôn bỏ 1 lượt warmup trước khi đo — nên có overhead lần-gọi-đầu (biên dịch kernel CUDA lần đầu, cấp phát bộ nhớ) bị tính vào, làm số bị đánh giá thấp hơn thực tế ổn định). Con số **đáng tin nhất và có ý nghĩa nhất** là tỷ lệ **nội bộ, cùng script, cùng định nghĩa metric**: General (partial, 8 layer) chậm hơn Code (full GPU) khoảng **10,5 lần** (2,9 vs 30,5 tok/s) — đây là chi phí thật của việc "đẩy sang RAM" mà roster C phải trả.

Dispose cả hai (`unloadGgufModel`) → VRAM về 1563 MiB (gần baseline 1070, dao động nhỏ bình thường — xác nhận lại vài giây sau: 1062 MiB), không `node.exe` treo, `getLoadedGgufModels()` rỗng.

**Kết luận roster C:** ĐO ĐƯỢC, không cần sửa mã sản xuất — chỉ cần **dùng** đúng tham số `gpuLayers` mà `loadGgufModel()`/mutation `aiGguf.loadModel` đã hỗ trợ sẵn. Đây là roster **DUY NHẤT** giữ được cả hai model 30B cùng lúc, nhưng cái giá là model bị đẩy sang RAM chạy chậm ~10 lần so với model còn lại chạy full GPU — trade-off VRAM-vs-tốc-độ rõ ràng, số liệu ở trên đủ cho Task 7 cân nhắc (ví dụ: 2,9 tok/s cho model "General/chat" nghĩa là câu trả lời dài sẽ mất hàng chục giây → có thể không chấp nhận được cho tương tác thời gian thực, tuỳ ngưỡng UX chủ dự án đặt ra).

### Bảng so sánh 3 roster (roster hiện tại · A · B) — lệnh tạo bảng

```bash
node -e "
const fs=require('fs');
for(const f of ['roster-current-do0-3','roster-A','roster-B']){
  const j=JSON.parse(fs.readFileSync('scripts/ai-bench/baselines/'+f+'.json','utf8'));
  for(const m of j.models){ /* in load/vram/prefill/decode từ m.loadTimeMs, m.vram, m.results[i] */ }
}"
```
(script đầy đủ đã chạy trong phiên, output dưới)

| Roster | logical | file | load ms | VRAM Δ (MiB) | VRAM đỉnh (MiB) | prefill tok/s @128 / @1024 (median) | decode tok/s @128 / @1024 (median) |
|---|---|---|---|---|---|---|---|
| **Hiện tại** | deep | Qwen3-30B-A3B-**Instruct** | 9346.9 | 17750 | 18930 | 3938.4 / 8492.6 | 277.4 / 246.9 |
| Hiện tại | fast | Qwen3-4B-Instruct | 7036.0 | 3491 | 4671 | 7528.3 / 14406.7 | 288.5 / 276.0 |
| Hiện tại | code | Qwen3-**Coder**-30B-A3B | 40968.5 | 17737 | 18917 | 3770.1 / 8322.2 | 265.9 / 253.3 |
| Hiện tại | fim | Qwen2.5-Coder-1.5B | 3479.0 | 1811 | 2991 | 11120.6 / 23042.4 | 472.7 / 481.0 |
| Hiện tại | embed | Qwen3-Embedding-0.6B | 3924.3 | 5664 | 6844 | embedMs=6.4ms, inputTok/s=5166.2 | — |
| **A** | deep(=code) | Qwen3-Coder-30B-A3B | 8852.5 | 17729 | 18851 | 3683.0 / 8300.4 | 227.2 / 242.9 |
| A | fast | Qwen3-4B-Instruct | 2029.0 | 3464 | 4586 | 8053.1 / 14918.5 | 272.0 / 267.2 |
| A | code(=deep) | Qwen3-Coder-30B-A3B | 8828.2 | 17698 | 18820 | 3990.2 / 8507.1 | 268.3 / 254.4 |
| A | fim | Qwen2.5-Coder-1.5B | 1104.0 | 1774 | 2896 | 11268.2 / 21815.5 | 458.1 / 459.7 |
| A | embed | Qwen3-Embedding-0.6B | 1296.2 | 5628 | 6750 | embedMs=8.1ms, inputTok/s=4097.2 | — |
| **B** | deep(=fast) | Qwen3-4B-Instruct | 2341.6 | 3481 | 4594 | 7595.9 / 14320.2 | 264.2 / 275.7 |
| B | fast | Qwen3-4B-Instruct | 2017.0 | 3474 | 4587 | 7584.4 / 14493.2 | 286.6 / 277.4 |
| B | code | Qwen3-Coder-30B-A3B | 8805.7 | 17716 | 18829 | 3753.5 / 8185.0 | 267.4 / 240.4 |
| B | fim | Qwen2.5-Coder-1.5B | 1076.4 | 1786 | 2899 | 12526.2 / 23222.6 | 490.5 / 482.7 |
| B | embed | Qwen3-Embedding-0.6B | 1219.1 | 5652 | 6765 | embedMs=6.8ms, inputTok/s=4864.5 | — |
| **C** | General(gpuLayers=8/48) | Qwen3-30B-A3B-Instruct | 5671 | 3700 | 4770 | (không đo prefill/decode tách riêng — xem `generateText()` bên dưới) | **2,9 tok/s** (gộp prefill+decode, không warmup) |
| C | Coder(gpuLayers=max, cùng resident) | Qwen3-Coder-30B-A3B | 45249 | +18513 (từ mốc bước 1) | 23283 | (như trên) | **30,5 tok/s** (gộp prefill+decode, không warmup) |

⚠ **M-1 (sửa sau review round 1) — đọc cột "load ms" trong bảng trên cẩn thận, KHÔNG phải khác biệt giữa các roster.** Lệch lớn nhất trong bảng (`code` ở roster hiện tại = 40968,5 ms vs `deep`/`code` ở roster A chỉ ~8800 ms — chênh **4,7 lần**) là **hiệu ứng OS file-cache trong cùng 1 phiên đo** (lần đọc đĩa đầu tiên của 1 file luôn chậm hơn các lần đọc lại sau, xem giải thích đầy đủ + bằng chứng chéo-roster ở mục "Lệch so với baseline-2026-07-05" bên dưới), **không phải** do cấu hình roster A/B khác roster hiện tại. Đừng đọc bảng này như "roster A/B nạp nhanh hơn roster hiện tại" — thứ tự chạy (hiện tại → A → B) mới là biến chi phối load-ms, không phải roster nào.

### Xác nhận bằng đo lường: hai model 30B **KHÔNG** thể cùng thường trú trên 32,6 GB VRAM

**Sửa sau review round 1 — nâng từ "suy luận cộng dồn" lên "đã xác nhận bằng đo trực tiếp".** Bản đầu chỉ có phép cộng arithmetic dưới đây (vì `bench.mjs` nạp/xoá tuần tự, không giữ 2 model cùng lúc) và tự nhận đó là giới hạn. Reviewer chỉ ra có phép kiểm trực tiếp rẻ (~44s, không sửa mã): nạp cả 2 model 30B trong **cùng 1 tiến trình**, **không** dispose model đầu trước khi nạp model hai, bằng chính API `node-llama-cpp` mà `bench.mjs` dùng. Tôi tự chạy lại độc lập (không chép số reviewer) bằng script tạm `scripts/ai-bench/_double-load-probe.mjs` (xoá ngay sau khi chạy, không commit):

```
[probe] vram before: {"total":32607,"used":1078}
[probe] loading model #1 (deep) gpuLayers=max ...
[probe] model #1 loaded in 9449ms
[probe] vram after model #1: {"total":32607,"used":18206}
[probe] loading model #2 (code) gpuLayers=max, model #1 STILL RESIDENT (no dispose) ...
[probe] model #2 load REJECTED — exact error message:
[probe] >>> Not enough VRAM to fit the model with the specified settings
[probe] vram at rejection: {"total":32607,"used":18206}
[probe] disposing...
[probe] vram after dispose: {"total":32607,"used":1501}
```
(xác nhận lại vài giây sau: VRAM ổn định ở 1071 MiB, không `node.exe` treo.)

**Kết quả khớp chính xác với phép cộng arithmetic bên dưới** — model #2 bị từ chối ngay khi VRAM đã dùng ~18,2 GB (từ model #1) cộng thêm ~17,7 GB cần cho model #2 sẽ vượt 32,6 GB. Không có bằng chứng phân mảnh làm tệ hơn dự đoán (VRAM về sạch sau dispose, không rơi rớt), cũng không có chia sẻ buffer làm tốt hơn dự đoán (model #2 bị từ chối thẳng, không "gần vừa"). Phép cộng arithmetic dưới đây giờ có **cả suy luận số học LẪN đo trực tiếp cùng một tiến trình** làm bằng chứng — mức tin cậy cao nhất trong toàn Đợt 0:

```
Roster hiện tại (deep 30B-Instruct + code 30B-Coder cùng resident, số liệu bench.mjs):
  baseline 1180 + deepΔ 17750 + codeΔ 17737 = 36667 MiB > 32607 MiB tổng VRAM
  → VƯỢT 4060 MiB (~4 GB), TRƯỚC KHI tính buffer KV-cache/generation thêm (mỗi model +470-940 MiB nữa lúc sinh token thật).
```

**Đây là xác nhận bằng đo lường cho tiền đề gốc của Đợt 0**, giờ có 2 nguồn độc lập: (a) delta ~17,7 GB cho MỘT model 30B tại một thời điểm — đo trên **2 file GGUF khác nhau** (Instruct-30B và Coder-30B, xem chú thích M-2 ngay dưới), nhất quán qua ≥5 lượt trong Task 2 và Task 3; (b) phép kiểm trực tiếp vừa chạy — nạp cả hai TRONG CÙNG TIẾN TRÌNH, không dispose, bị từ chối đúng như dự đoán. ⇒ hai model 30B riêng biệt cùng thường trú cần ~35,5 GB > 32,6 GB VRAM thật của máy — **không thể, đã xác nhận cả bằng suy luận số học lẫn đo trực tiếp**. Task 2 đã đo được delta (a) nhưng chưa nêu kết luận cộng dồn; Task 3 bổ sung cả phép cộng lẫn phép đo trực tiếp (b) để xác nhận dứt điểm.

⚠ **M-2 (sửa sau review round 1) — làm rõ "delta ổn định" là qua HAI FILE KHÁC NHAU, không phải 1 file đo lặp lại.** Câu ở mục "lệch baseline" bên dưới ("17801→17750→17729...") liệt kê các lần đo `deep`/`code` xen kẽ — nhưng `deep` (roster hiện tại) = **Qwen3-30B-A3B-Instruct-2507** (file 1), còn `code` (roster hiện tại, roster A×2, roster B) = **Qwen3-Coder-30B-A3B-Instruct** (file 2, khác file 1 — kiến trúc/kích thước tương tự nhưng KHÔNG phải cùng 1 file đọc lặp lại nhiều lần). Kết luận "delta VRAM ~17,7GB ổn định cho 1 model 30B" vẫn ĐÚNG — cả hai file có delta gần như giống hệt nhau (17698–17801 MiB, <0,6% dao động) — nhưng đó là **hai model 30B kiến trúc MoE giống nhau (48 layer, qwen3moe) cho ra delta gần bằng nhau**, không phải bằng chứng "đo lặp lại 1 file luôn ra cùng 1 số" (dù điều đó cũng đúng riêng — roster A's `deep` và `code` cùng trỏ 1 file Coder-30B, delta 17729 vs 17698, chênh <0,2%, đó MỚI là phép đo-lặp-lại-1-file thật).

Ngược lại, roster A và B (chỉ giữ **một** bản 30B duy nhất, không phải hai) đều **VỪA** trong ngân sách nếu 4 logical-slot còn lại (deep/fast/code/fim/embed, trừ trùng file) cùng thường trú:
```
Roster A (1 model 30B dùng chung deep+code, + fast + fim + embed):
  1122 + 17729 + 3464 + 1774 + 5628 = 29717 MiB < 32607 MiB  (dư ~2890 MiB)
Roster B (fast=deep 4B dùng chung, + code 30B riêng + fim + embed):
  1113 + 3474 + 17716 + 1786 + 5652 = 29741 MiB < 32607 MiB  (dư ~2866 MiB)
```
(Lệnh tạo 2 phép cộng trên: script `node -e` inline đọc `scripts/ai-bench/baselines/{roster-A,roster-B}.json`, lấy `hardware.vramUsedBaselineMib` + từng `models[].vram.modelDeltaMib` — đã chạy trong phiên.) Đây là bằng chứng số cho lý do roster A/B là ứng viên hợp lý còn roster hiện tại thì không, trên đúng trục VRAM.

### Lệch so với `baseline-2026-07-05.json` — nói thật

1. **Phần cứng đã đổi giữa 05/07 và hôm nay** — không phải lỗi đo, là thay đổi máy thật: baseline 07-05 ghi `cpu: "i7-12700KF"`, `cpuCores: 20`, `totalMemGb: 47.8`; cả 3 roster hôm nay đều ghi `cpu: "i9-12900K"`, `cpuCores: 24`, `totalMemGb: 63.8`. **Task 7 cần biết: máy đã được nâng cấp CPU+RAM sau 05/07** (GPU RTX 5090 32.607 MiB không đổi).
2. **`deep` load time lệch lớn**: baseline 07-05 = 40260,5 ms; roster hiện tại hôm nay = 9346,9 ms (nhanh hơn ~4,3 lần). Đã truy được nguyên nhân nhiều khả năng nhất, không phải suy đoán suông: **hiệu ứng OS file-cache trong phiên**, không phải khác biệt cấu hình. Bằng chứng trực tiếp: model `code` (Coder-30B) đọc **lần đầu trong phiên** (roster hiện tại) mất 40968,5 ms — chậm y hệt kiểu baseline 07-05 — nhưng file **giống hệt** đọc lại vài phút sau ở slot `deep` của roster A chỉ mất 8852,5 ms, và slot `code` của roster A (đọc lần 3 trong phiên) chỉ 8828,2 ms. Cùng file, cùng máy, cách nhau vài phút, chênh lệch 4,6 lần — khớp mô hình "lần đọc đĩa đầu chậm, các lần sau ăn cache OS (63,8 GB RAM đủ cache thoải mái 1 file 17,7 GB)". Không loại trừ phần cứng CPU mới cũng góp phần, nhưng cache-effect giải thích trực tiếp và đủ cho phần lớn chênh lệch.
3. **`decode` tok/s cao hơn baseline 07-05 khoảng 20-30%** (vd. deep @128 decode median: 212,7 → 277,4). Không có baseline `code`/`fim` trên 07-05 để so (biến `GGUF_CODE_MODEL`/`GGUF_FIM_MODEL` khi đó chưa cấu hình — file `baseline-2026-07-05.json` chỉ có 3 model `deep/fast/embed`). Hướng nghi vấn hợp lý: CPU mới (24 nhân) hoặc driver/CUDA Toolkit cập nhật giữa hai lần đo — **chưa xác nhận, chỉ ghi nhận độ lệch**.
4. **VRAM delta của model 30B ổn định bất chấp mọi lệch trên** (sửa cách viết theo M-2 — tách rõ theo TỪNG FILE, không gộp): **Instruct-30B** (logical `deep`, chỉ đo được ở roster-hiện-tại vì roster A/B trỏ `GGUF_DEFAULT_MODEL` sang file khác) — 17801 MiB (07-05) → 17750 MiB (hôm nay) — 2 điểm, lệch 0,3%. **Coder-30B** (logical `code`, cả 3 roster; cũng là logical `deep` ở riêng roster A vì trùng file) — không có baseline 07-05 để so (chưa cấu hình khi đó) — 4 điểm hôm nay: 17737 (hiện tại) / 17729 (A, slot deep) / 17698 (A, slot code — phép đo-lặp-lại-1-file thật, cùng 1 file trong cùng 1 lượt chạy) / 17716 (B) — dao động 17698–17737, <0,3%. Gộp cả 2 file: 17698–17801 MiB toàn bộ, <0,6%. Đây là con số quan trọng nhất cho quyết định roster (mục VRAM ở trên), và nó **không bị ảnh hưởng** bởi các lệch phần cứng/cache kể trên — đáng tin cậy để dùng cho Task 7, nay còn được củng cố bằng phép đo trực tiếp (mục "Xác nhận bằng đo lường").

### Vệ sinh tiến trình / VRAM — xác nhận từng lượt

| Lượt | VRAM sau khi chạy | `node.exe` còn sống? |
|---|---|---|
| Roster hiện tại | 1189 MiB | Không |
| Roster A | 1094 MiB | Không |
| Roster B | 1104 MiB | Không |

Không gặp `cudaMalloc failed` hay VRAM không-trả-về-baseline ở bất kỳ lượt nào trong 3 lượt — khác hẳn Task 1/2 (đường boot app, race điều kiện). Củng cố thêm kết luận Task 2: đường `bench.mjs` (race-free, không boot app) ổn định, đáng tin cậy để đo model 30B đơn lẻ.

### Xác nhận `.env` đã hoàn nguyên

```bash
cp .env.do0-backup .env && diff .env .env.do0-backup && echo "ĐÃ HOÀN NGUYÊN ĐÚNG" && rm .env.do0-backup
grep -n "^GGUF_DEFAULT_MODEL=\|^GGUF_CODE_MODEL=\|^GGUF_FAST_MODEL=" .env
# GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf   (đúng giá trị gốc)
# GGUF_FAST_MODEL=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf           (không đổi, chưa từng sửa)
# GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf     (đúng giá trị gốc, chưa từng sửa)
```
`diff` rỗng → hoàn nguyên đúng. (Xác nhận này bao trùm toàn bộ Bước 2-4. Phép đo roster C ở vòng sửa 1 và phép kiểm trực tiếp Important-1 **không đụng `.env`** — cả hai chạy bằng script tạm import thẳng module, không boot app, không cần đổi biến nào.)

### Mối lo / lưu ý cho Task 7

1. Máy đã nâng cấp phần cứng (CPU+RAM) từ 05/07 đến nay — số tok/s so với `baseline-2026-07-05.json` không so ngang hàng tuyệt đối được (nhanh hơn ~20-30% ở decode), **nhưng VRAM delta thì có** (ổn định qua cả 2 mốc thời gian) — Task 7 nên ưu tiên dùng trục VRAM (đáng tin) hơn trục tok/s tuyệt đối khi so với baseline cũ.
2. **Roster C đo được (sửa sau review round 1)** — là roster **duy nhất** giữ cả hai 30B cùng lúc, nhưng model bị đẩy sang RAM (`gpuLayers=8/48`) chạy **~10,5 lần chậm hơn** model còn lại full-GPU (2,9 vs 30,5 tok/s, cùng script/cùng định nghĩa metric — xem mục Roster C). Task 7 cần tự quyết: 2,9 tok/s có chấp nhận được cho use-case "General/chat" không? Chỉ đo 1 điểm `gpuLayers=8`; chưa quét dải giá trị (vd. 12, 16, 24) để tìm điểm cân bằng tốc độ/VRAM tốt hơn — nếu cần, đó là việc đo thêm ngoài phạm vi thời gian hợp lý của Task 3.
3. `bench.mjs` không đo được kịch bản "2 model cùng resident" trực tiếp (luôn dispose tuần tự) — số 36667 MiB / 29717 MiB / 29741 MiB ở mục VRAM là suy ra bằng cộng dồn delta, **nhưng nay đã có phép đo TRỰC TIẾP xác nhận đúng chiều** (script `_double-load-probe.mjs`, mục "Xác nhận bằng đo lường" — model #2 bị từ chối với thông điệp `"Not enough VRAM to fit the model with the specified settings"` đúng như phép cộng dự đoán). Không còn là suy luận thuần — có cả đo trực tiếp cho roster hiện tại (2 model full-GPU, thất bại) VÀ roster C (1 full + 1 partial, thành công).

### Vòng sửa 1 (review)

Reviewer: spec ✅ đạt, diff sạch (0 mã sản xuất), `bench.mjs`/`aiGgufEngine.ts` xác nhận không bị sửa, `.env` hoàn nguyên đúng, 15/15 hàng bảng gốc khớp 100% với JSON thô. 2 Important + 2 Minor, cả 4 đã xử lý trong bản này:

- **Important 1 — con số cộng dồn 36667 MiB đáng lẽ phải kiểm bằng đo trực tiếp, không chỉ để ở mức suy luận.** Reviewer tự chạy phép kiểm rẻ (~44s, không sửa mã): nạp 2 model 30B cùng tiến trình, không dispose model đầu, ra thông điệp từ chối `"Not enough VRAM to fit the model with the specified settings"`. Tôi **tự chạy lại độc lập** (không chép số reviewer) bằng script tạm `scripts/ai-bench/_double-load-probe.mjs` (raw `node-llama-cpp`, cùng cách bench.mjs gọi) — xác nhận **cùng thông điệp, cùng hành vi** (model #1 nạp OK 9449ms/18206 MiB, model #2 bị từ chối ngay, VRAM về sạch sau dispose). Đã nâng mục "Xác nhận bằng đo lường" từ "chỉ cộng dồn arithmetic" lên "cộng dồn + đo trực tiếp cùng xác nhận". Bài học: có công cụ (script cô lập gọi thẳng `node-llama-cpp`/production function, đúng kỹ thuật Task 2 làm mẫu) mà không dùng để tự kiểm con số trung tâm nhất của báo cáo — lần sau ưu tiên đo trực tiếp trước khi dừng ở suy luận, khi chi phí đo thấp (ở đây chỉ ~1 phút).
- **Important 2 — kết luận "roster C không đo được nếu không sửa mã" SAI, đã sửa thành ĐO ĐƯỢC.** Bản đầu dừng tìm ở `bench.mjs`/env sau khi xác nhận cả hai không hỗ trợ số lớp GPU cụ thể — đúng nhưng KHÔNG ĐẦY ĐỦ, chưa lần tới router. Reviewer chỉ ra `server/routers/aiGgufRouter.ts:47-55` (`aiGguf.loadModel`, `gpuLayers: z.number()`) và `GGUF_WARM_DEEP_MODEL_ON_BOOT=false` (tắt 1 trong 2 racer boot Task 2 phát hiện). Tôi đã đo bằng cách **tốt hơn** gợi ý ban đầu (import thẳng `loadGgufModel` từ `aiGgufEngine.ts` qua script tạm, né **cả hai** racer bằng cấu trúc thay vì tắt 1 racer qua `.env`+boot app) — kết quả: cả 2 model 30B cùng resident thành công với General ở `gpuLayers=8/48` (23283/32607 MiB = 71,4%), nhưng chậm ~10,5 lần so với model full-GPU (2,9 vs 30,5 tok/s). Bài học: dừng tìm ngay sau khi 2 chỗ đầu tiên (harness + config type) không ra kết quả — trong khi mã production (router mutation) là nơi thứ 3 chưa xét tới, và tồn tại sẵn không cần sửa gì.
- **M-1 — cảnh báo file-cache chỉ nằm ở mục so-baseline-07-05, chưa gắn vào bảng 3-roster chính nơi lệch 4,7 lần dễ bị hiểu nhầm là khác biệt giữa các roster.** Đã thêm cảnh báo ngay dưới bảng chính.
- **M-2 — câu "VRAM delta ổn định 17801→17750→17729" ghép 2 file GGUF khác nhau (Instruct-30B và Coder-30B) như 1 phép đo lặp lại.** Đã tách rõ theo từng file ở cả mục "Xác nhận bằng đo lường" và mục "Lệch so với baseline" — kết luận không đổi (delta vẫn ổn định, <0,6% dù gộp 2 file), chỉ cách trình bày rõ ràng hơn.

Không đụng mã sản xuất, không đụng `bench.mjs`, không đụng `.env` trong vòng sửa này (roster C + phép kiểm trực tiếp đều dùng script tạm import module, không boot app) — 2 script tạm đã xoá ngay sau khi chạy, không commit.

---

## §4 A/B tiếng Việt (Task 4)

**⚠ Mục này KHÔNG kết luận model nào hay hơn — theo đúng ràng buộc tuyệt đối của task này. Chỉ ghi lại đã sinh gì, ở đâu, bằng tham số nào. Chờ chủ dự án chấm.**

Đã sinh **4 cặp** câu trả lời (4 prompt thật × 2 model = 8 lượt sinh), 1 lượt/prompt/model (không lặp). Script: `scripts/ai-survey/vi-quality-ab.mjs`. Bản ẩn danh cho chủ dự án đọc (nhãn "Model 1"/"Model 2", KHÔNG có kết luận): `docs/superpowers/reports/2026-08-01-do0-vi-ab.md`. Bảng ánh xạ nhãn↔model thật ở file riêng, không commit: `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-4-model-map.md`.

4 prompt lấy từ đường chạy thật (nguồn + dòng ghi trong chính file `2026-08-01-do0-vi-ab.md`, mỗi prompt kèm "Ghi chú" nói rõ phần nào verbatim / phần nào phải tái dựng vì hàm gốc không export): RCA (`aiRcaCopilot.ts:500-513`), báo cáo điều hành (`aiExecutiveReport.ts:318-342`, KPI thật từ `gatherKpis()` sống), tóm tắt chất lượng hàng ngày thay cho "cố vấn ngưỡng" (`aiReportGenerator.ts:556-560`), trợ lý tri thức (`aiLocalKnowledgeService.ts:1136-1166`, citation thật từ `knowledge/chunks.jsonl` qua `retrieveKnowledge()` sống).

**Hai phát hiện quan trọng, độc lập với câu hỏi "model nào viết tiếng Việt hay hơn" (nâng lên đây, không chôn trong ghi chú từng prompt — chủ dự án cần thấy cả hai):**
1. **RCA copilot sinh tiếng Anh, không phải tiếng Việt**, dù `lang` mặc định `"vi"` — `synthesize(input, lang, ev)` nhận `lang` nhưng không hề tham chiếu nó, `sys`/`userPrompt` 100% tiếng Anh. Xác nhận bằng lượt sinh thật (cả 2 model đều trả lời tiếng Anh ở Prompt 1). **Bug sản phẩm thật, không vá trong khảo sát này.**
2. **"Cố vấn ngưỡng" không hề gọi LLM** — grep 7 file (`aiThresholdAdvisor.ts`/`aiSetupAdvisor.ts`/`aiThresholdTuneScheduler.ts`/`aiCalibration.ts`/`aiAnomalyCalibration.ts`/`thresholdGovernanceService.ts`/`aiAutoProposer.ts`) → 0 khớp pattern gọi model. 100% thống kê + chuỗi tĩnh — trục này **không bị ảnh hưởng** bởi việc đổi model 30B thường trú. Đã thay Prompt 3 bằng `aiReportGenerator.ts` vì lý do này.

Tham số sinh (giống hệt cho cả 2 model, cả 4 prompt — ghi đầy đủ lý do chọn trong `2026-08-01-do0-vi-ab.md`): temperature=0 (greedy), topP=0.9, maxTokens=700, contextSize=8192, gpuLayers="max", seed không áp dụng (không hỗ trợ ở `generateText()`, và không cần vì greedy). Sinh **tuần tự** (model đầu → dispose → model thứ hai → dispose), không giữ 2 model cùng lúc. VRAM: bắt đầu 1006 MiB → sau dispose model đầu 1493 MiB → sau dispose model thứ hai (cuối) 1496 MiB → xác nhận lại độc lập sau khi script thoát: 1009 MiB, không `node.exe` treo — về baseline sạch ở mọi mốc.

Bản đầy đủ (thảo luận phương pháp, các lựa chọn tái dựng prompt, rủi ro): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-4-report.md` (không commit).

**Chờ chủ dự án chấm.**

### Vòng sửa 1 (review)

Reviewer xác nhận: phép so công bằng (tham số giống hệt, prompt dựng 1 lần dùng lại byte-for-byte cho cả 2 model, cùng code path), nhãn Model 1/2 gán 1 lần không đảo giữa 4 prompt, cả 2 phát hiện phụ ở trên ĐÚNG. Nhưng **spec ❌** vì 2 Important, cả 2 đã sửa KHÔNG cần chạy lại model 30B:

- **Important 1 — rò tên model thật ngay trong file khai là ẩn danh.** Bảng "Vệ sinh VRAM" cuối `2026-08-01-do0-vi-ab.md` in thẳng "General"/"Coder" (tên nội bộ hard-code trong script) thay vì nhãn trung lập. Đã sửa: đổi thành "model đầu tiên nạp"/"model thứ hai nạp" (theo THỨ TỰ NẠP, không theo Model 1/2, để không lộ thêm suy luận) — sửa cả trong `vi-quality-ab.mjs` (cho lần chạy sau) lẫn file đã sinh (đọc lại, không chạy lại model).
- **Important 2 — P1 (RCA) đổi cơ chế sinh mà không khai.** Sản xuất dùng `generateJSON()` ràng buộc GBNF grammar (`aiRcaCopilot.ts:527-539`); script A/B dùng `generateText()` tự do — bằng chứng: cả 2 model đều không khớp `RCA_JSON_SCHEMA` thật. **Chọn hướng (a) — khai báo rõ, không chạy lại**, vì mục tiêu Task 4 là chấm văn xuôi tiếng Việt và ràng buộc GBNF sẽ gần như xoá hết văn xuôi để chấm (chỉ còn field JSON ngắn). Đã thêm đoạn khai báo đầy đủ vào "Ghi chú" của Prompt 1 ở cả `vi-quality-ab.mjs` và `2026-08-01-do0-vi-ab.md`, nêu rõ: cơ chế khác, áp dụng đều cho cả 2 model (không phá công bằng), nhưng P1 kém đại diện đường chạy thật hơn 3 prompt còn lại.
- **Minor — "2026-07-13 nhiều dữ liệu thật nhất" sai.** Reviewer chạy lại đúng SQL: 2026-07-12 có 5370 bản ghi > 3540 của 07-13. Đã sửa chữ dùng trong comment script ("nhiều" thay vì "nhiều nhất") — KHÔNG đổi mốc `now` (lựa chọn vẫn hợp lý, dữ liệu thật và đủ phong phú), không cần chạy lại model.

Cả 2 phát hiện phụ (RCA tiếng Anh, cố vấn ngưỡng không LLM) đã nâng lên mục riêng dễ thấy ở đầu `2026-08-01-do0-vi-ab.md` và trong §4 này (xem trên) thay vì chôn trong "Ghi chú" từng prompt. Không sửa mã sản xuất, không sửa `.env`, không chạy lại model 30B trong vòng sửa này — chỉ sửa văn bản `vi-quality-ab.mjs` (script khảo sát) + 2 file báo cáo đã sinh.

---

## §5 Độ trễ FIM (Task 5)

**Câu hỏi:** ghost-text (gợi ý mã khi gõ) đang dùng `Qwen2.5-Coder-1.5B` (941MB, cũ 2 thế hệ). `Qwen3-Coder-30B-A3B` mới hơn, roster A/B/C đều giữ nó thường trú sẵn. Có nên đổi FIM sang dùng nó không? **Chỉ đổi nếu số liệu ủng hộ.**

### TTFT đo trực tiếp, không suy từ tok/s

`scripts/ai-bench/bench.mjs` (không sửa) tách sẵn TTFT: `onTextChunk()` của `LlamaChatSession.prompt()` bắn `tFirst = performance.now()` ngay khi có ký tự đầu tiên — `ttftMs = tFirst - t0` là mốc THẬT, không phải suy từ `tokens/tok-per-sec`. `totalMs = t1 - t0` là thời gian tới khi TOÀN BỘ gợi ý sinh xong. Đo với `--maxTokens 32` (giống độ dài gợi ý FIM thật, khác default 256 của harness) và 2 ngữ cảnh nhắc thật (`--prefill 128,512` → 153/533 token nhắc thật sau khi cộng system prompt), `--warmup 2 --iters 5`.

Lệnh (model 1, giá trị `.env` gốc):
```bash
node scripts/ai-bench/bench.mjs --models fim --warmup 2 --iters 5 --maxTokens 32 --prefill 128,512 --label do0-task5-fim-1p5b
```
Lệnh (model 2, `.env` sửa tạm `GGUF_FIM_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`, backup/hoàn nguyên thủ công vì `.env` không git-track):
```bash
node scripts/ai-bench/bench.mjs --models fim --warmup 2 --iters 5 --maxTokens 32 --prefill 128,512 --label do0-task5-fim-30b-coder
```

### Kết quả (n=5, trung vị — KHÔNG đủ mẫu để tính p95 có ý nghĩa, xem "Mối lo")

| Model (vai FIM) | Ngữ cảnh nhắc thật | TTFT trung vị | TTFT min–max | **Tổng thời gian tới gợi ý 32-token HOÀN CHỈNH** | tổng min–max | decode tok/s (thông tin thêm) |
|---|---|---|---|---|---|---|
| **Qwen2.5-Coder-1.5B** (hiện tại) | 153 tok | **13.2 ms** | 12.7–15.0 | **83.8 ms** | 81.5–93.1 | 453.8 tok/s |
| **Qwen2.5-Coder-1.5B** (hiện tại) | 533 tok | **26.8 ms** | 26.2–28.2 | **89.3 ms** | 87.5–92.1 | 513.7 tok/s |
| **Qwen3-Coder-30B-A3B** | 153 tok | **39.5 ms** | 38.9–40.8 | **148.6 ms** | 146.3–150.1 | 296.9 tok/s |
| **Qwen3-Coder-30B-A3B** | 533 tok | **76.6 ms** | 75.7–78.6 | **187.8 ms** | 186.7–191.5 | 288.7 tok/s |

Chênh lệch tuyệt đối (30B − 1.5B): TTFT +26.3ms (@153tok) / +49.8ms (@533tok); tổng thời gian tới gợi ý đầy đủ +64.8ms (@153tok) / +98.5ms (@533tok).

**Bằng ngôn ngữ người dùng:** ⚠ ngưỡng "dừng gõ phím ~300-500ms" dùng để so sánh dưới đây là **giả định của điều phối viên (controller) nêu trong lệnh giao việc gửi agent thực thi task này — KHÔNG có trong `task-5-brief.md`, kế hoạch, hay bất kỳ spec nào, và chưa có nguồn kiểm chứng** (không phải số đo, không trích dẫn chuẩn UX nào). Task 7/chủ dự án cần tự đặt ngưỡng thật nếu muốn kết luận chắc chắn hơn — dưới đây chỉ dùng để có một mốc tham chiếu, không phải tiêu chí đã chốt.

So với khoảng giả định đó, nêu ĐỦ cả 2 đầu (không chỉ đầu có lợi):

| Kịch bản | Tổng thời gian tới gợi ý đầy đủ | % của đầu THẤP (300ms) | % của đầu CAO (500ms) |
|---|---|---|---|
| Tốt nhất — 1.5B, ngữ cảnh ngắn | 83.8 ms | 28% | 17% |
| Xấu nhất — 30B, ngữ cảnh dài | 187.8 ms | **63%** | 38% |

Tức là: xấu nhất đo được (đổi sang 30B, ngữ cảnh dài, so với đầu thấp 300ms của khoảng giả định) chiếm **63%** ngưỡng — gần 2/3, không phải "1/2" như bản trước viết (đó là kết quả của việc ghép số tốt (149ms) với ngưỡng thấp — chọn đầu có lợi). Vẫn dưới 100% (chưa vượt ngưỡng ở cả 2 đầu, tại 2 ngữ cảnh đã đo) nhưng biên an toàn hẹp hơn nhiều so với "1/3-1/2" ban đầu mô tả.

### Câu hỏi phụ — dùng lại model đã nạp sẵn: MỘT đánh đổi có hai mặt, không phải hai ghi chú độc lập

Đọc mã `loadGgufModel()` (`aiGgufEngine.ts:593-599`): engine cache theo **basename file** (`modelId = path.basename(resolvedPath, ".gguf")`). Nghĩa là hành động trỏ `GGUF_FIM_MODEL` vào **đúng file** đang dùng cho `GGUF_CODE_MODEL` — thứ tạo ra "0ms nạp thêm, không tốn VRAM thêm" — **CHÍNH LÀ** hành động khiến FIM và code dùng chung 1 model instance. Không có cách nào lấy lợi ích load mà tránh việc chia sẻ instance — hai điều này là MỘT hành động, không phải hai lựa chọn tách rời.

- **Mặt lợi (VRAM đo trực tiếp, phần load suy từ đọc mã):** model 1.5B riêng resident chiếm delta **~1774 MiB** đo được. Nếu trỏ chung file với code, khoản này biến mất + lượt gọi FIM đi thẳng cache-hit (0ms nạp thêm).
- **Mặt rủi ro (đọc mã thêm, KHÔNG ĐO trực tiếp):** đọc `server/services/ggufConcurrency.ts` cho thấy bức tranh rộng hơn cả việc chia sẻ file — MỌI lượt gọi GGUF (FIM/chat/code/RCA/report...) đã đi qua **một semaphore FIFO toàn cục** (`withGgufSlot()`), hiện `.env` đặt `GGUF_MAX_CONCURRENCY=4` (dòng 125, không phải default 1). Đồng thời mỗi context model được tạo với `sequences: GGUF_SEQUENCES` (default 4, không bị override trong `.env`) — tức MỘT model instance có thể phục vụ tới 4 chuỗi sinh song song, không nhất thiết phải xếp hàng cứng chỉ vì trùng file. Nói cách khác: rủi ro "ghost-text xếp hàng sau code-gen dài" **không phải đặc thù của việc chia sẻ file** (nó tồn tại ngay hôm nay, ở tầng semaphore toàn cục, bất kể FIM dùng model riêng hay chung) — nhưng **cạnh tranh COMPUTE GPU thật (không phải hàng đợi logic) thì vẫn còn nguyên**: 1 GPU vật lý, dù API cho phép 4 sequence "song song", tổng thông lượng vẫn bị chia sẻ — 1 lượt sinh code dài chạy cùng lúc nhiều khả năng làm CHẬM (không nhất thiết chặn cứng) lượt ghost-text đang chờ token đầu tiên.
- Cả điểm này (mức độ chậm thêm khi có tải đồng thời thật) **CHƯA ĐƯỢC ĐO** — `bench.mjs` chỉ chạy cô lập (1 model/1 lượt gọi tại 1 thời điểm), không mô phỏng 2 lượt gọi chạy cùng lúc trên cùng GPU.
- Giữ model FIM riêng (tốn thêm ~1.7GB VRAM đo được, `.env` hiện `GGUF_MAX_LOADED_MODELS=4` nên không tranh CHỖ NẠP với model code) không loại bỏ rủi ro cạnh tranh compute (vẫn qua chung semaphore + chung 1 GPU) nhưng giữ 2 model **instance** tách biệt — mức độ điều đó có thực sự giảm độ trễ ghost-text khi có tải đồng thời hay không thì **chưa đo**.

### Khuyến nghị

**Số liệu ỦNG HỘ đổi về mặt độ trễ thuần (model đã resident, không tải đồng thời)** — không phải vì "mới hơn thì tốt hơn": ở cả 2 đầu ngưỡng giả định (xem bảng trên), kịch bản xấu nhất đo được vẫn dưới 100% (63% ở đầu thấp, 38% ở đầu cao). **Nhưng đây là số liệu TỐT NHẤT có thể (best-case), đi kèm 2 điều kiện chưa đo trong task này — không tách rời nhau:**
1. **Residency:** chỉ an toàn nếu Coder-30B ĐƯỢC ĐẢM BẢO thường trú trước lượt gọi FIM đầu tiên — nếu cold-load, Task 3 đo được 40969ms cho đúng file này (đọc nguội).
2. **Đánh đổi chia-sẻ-instance (xem "Câu hỏi phụ" trên):** lợi ích "0ms nạp thêm/tiết kiệm VRAM" và rủi ro "cạnh tranh GPU compute khi có tải đồng thời" là HAI MẶT của CÙNG một quyết định trỏ chung file — không đo được mức độ chậm thêm thực tế khi ghost-text và code-gen chạy cùng lúc trên 1 GPU.

### Mối lo / giới hạn

1. Chỉ đo 2 ngữ cảnh (153/533 token) — xu hướng cho thấy khoảng cách TTFT MỞ RỘNG khi ngữ cảnh dài hơn (+26.3ms→+49.8ms khi prompt tăng ~3.5×); ngữ cảnh rất lớn (1500-3000+ token) chưa đo, ngoại suy cẩn trọng.
2. Không mô phỏng tải GPU đồng thời (mối lo #2 ở khuyến nghị).
3. `loadTimeMs` quan sát được (2948ms/8713ms) gần như chắc chắn ĐỌC NÓNG (cache ấm từ Task 3/4 cùng ngày, cùng 2 file) — Task 3 đo NGUỘI cùng file Coder-30B ra 40969ms, gấp ~4.7 lần. Không suy "cold start server" từ 2 số này.
4. n=5/ngữ cảnh — đủ thấy xu hướng, dao động (max−min)/trung vị ở 3/4 hàng dưới 10% (533tok 1.5B 7.5%, 153tok 30B 4.8%, 533tok 30B 3.8%) nhưng **1/4 hàng vượt: 153tok/1.5B lệch 17.4%** (range 2.3ms trên trung vị 13.2ms — nhỏ về số tuyệt đối nhưng KHÔNG đúng nếu gộp chung "mọi hàng <10%"). Dù vậy KHÔNG đủ mẫu để tính p95 có ý nghĩa thống kê; báo cáo chỉ đưa median/min/max, không bịa p95.
5. Chỉ đo compute thuần trên GPU rảnh, KHÔNG gồm chi phí mạng/HTTP client↔server.

### Xác nhận `.env` hoàn nguyên + VRAM baseline

```bash
cp .env.do0-backup .env && diff .env .env.do0-backup && echo "DIFF RỖNG — HOÀN NGUYÊN ĐÚNG" && rm .env.do0-backup
grep -n "^GGUF_FIM_MODEL=" .env
# GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf   (đúng giá trị gốc)
```
`diff` rỗng → hoàn nguyên đúng. VRAM: 1208 MiB trước → 1210 MiB sau (khớp baseline, lệch trong dao động nền). Không `node.exe` treo sau cả 2 lượt bench.

Bản đầy đủ (bảng tham số chọn khác default harness, JSON thô, mọi lý do): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-5-report.md` (không commit).

### Vòng sửa 1 (review)

Reviewer xác nhận spec ✅ (TTFT đo thật khớp `bench.mjs:259-280`, mọi số khớp JSON đến từng ms, chạy lại độc lập ra 12.8ms so với 13.2ms báo cáo — cùng thứ tự độ lớn). Chất lượng cần sửa — 2 Important + 1 Minor, cả 3 đã xử lý, KHÔNG chạy lại model: (1) ngưỡng "300-500ms" được gắn nhãn rõ là **giả định của điều phối viên trong lệnh giao việc, không phải yêu cầu từ brief/spec, chưa có nguồn** — và câu "1/3-1/2 ngưỡng" (ghép mỗi kịch bản với đầu ngưỡng có lợi) sửa thành bảng nêu đủ 2 đầu, xấu nhất = 62.6% (đầu thấp), không phải 1/2; (2) "miễn phí nạp" và "rủi ro hàng đợi" viết lại thành MỘT đánh đổi có hai mặt (trỏ chung file = cùng lúc được lợi + chịu rủi ro), đào sâu thêm phát hiện `server/services/ggufConcurrency.ts` (semaphore toàn cục `GGUF_MAX_CONCURRENCY=4` + `sequences: GGUF_SEQUENCES` cho phép 4 chuỗi song song/model) — rủi ro "xếp hàng cứng" không đặc thù riêng việc share file, nhưng cạnh tranh GPU compute thật thì còn, CHƯA ĐO; (3) "dao động <10%" sửa vì sai với 1/4 hàng (153tok/1.5B = 17.4%). Chi tiết đầy đủ: `task-5-report.md` mục "Vòng sửa 1".

---

## §6 Toàn vẹn không gian nhúng (Task 6)

**Câu hỏi:** hệ có đang dùng hai model nhúng khác nhau (kho RAG = Qwen3-Embedding-0.6B-f16,
tìm-ảnh-theo-ảnh = mxbai-embed-large) mà phép canh KÍCH THƯỚC (`aiGgufEngine.ts:173`,
`assertEmbeddingDim`, mặc định 1024) không đủ để phát hiện trộn nhầm (cả hai ra 1024 chiều)?
**Chỉ đo và báo cáo — KHÔNG sửa**, kể cả chỗ sửa rõ ràng và dễ. Không đụng
`knowledge/embeddings.jsonl`.

### 0. Kiểm premise trước khi tin

Brief mô tả tìm-ảnh-theo-ảnh "dùng mxbai-embed-large" — đọc `aiImageSearchRouter.ts:153`
thật thì đó chỉ là comment của guard kích thước, không phải lệnh gọi hard-code. Model thật
phụ thuộc `.env` `GGUF_EMBED_MODEL` (CÙNG biến RAG KB dùng) + cờ `IMAGE_EMBEDDING_DEFAULT`.
Kiểm `.env` hiện tại:
```bash
grep -n "GGUF_EMBED_MODEL\|GGUF_EMBEDDING_MODEL\|GGUF_EMBED_DIM\|IMAGE_EMBEDDING_DEFAULT" .env
# 144:GGUF_EMBEDDING_MODEL=Qwen3-Embedding-0.6B-f16.gguf
# 147:GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B-f16.gguf
# 148:GGUF_EMBED_DIM=1024
# 295:IMAGE_EMBEDDING_DEFAULT=onnx
```
**Premise brief đã lỗi thời:** hôm nay `GGUF_EMBED_MODEL` = CÙNG model với kho RAG (không
phải mxbai), và `IMAGE_EMBEDDING_DEFAULT=onnx` + 1 model DINOv2 ONNX `ACTIVE` (xác nhận qua
DB) khiến đường tìm-ảnh mặc định đi qua ONNX (384-dim, khác họ hoàn toàn), KHÔNG chạm nhánh
mxbai/GGUF nào. Điều này KHÔNG làm bẫy biến mất — nó vẫn có thật ở tầng MÃ (mục 1) — chỉ là
hôm nay không có dữ liệu thật nào đi qua nhánh đó để bị hỏng. Báo cáo dưới đây phân biệt rõ
**"bẫy có thật trong code, đang ngủ (dormant)"** vs **"đang hoạt động, có dữ liệu thật"**.

### 1. Truy vết mọi đường nhúng × mọi đường tìm

```bash
grep -rn "embedModelBasename\|GGUF_EMBED_MODEL\|GGUF_EMBEDDING_MODEL" server/ scripts/ --include=*.ts --include=*.mjs | grep -v test
# → 80 dòng khớp
```
`server/services/ai/modelResolver.ts:172-174` (`embedModelBasename()`) là NGUỒN DUY NHẤT
phân giải embedding cho `aiGgufEngine.generateEmbedding(s)` — chỉ đọc `GGUF_EMBED_MODEL`,
**không có fallback nào sang `GGUF_EMBEDDING_MODEL`**. Biến còn lại chỉ được đọc ở đúng 1 chỗ
khác (`aiGgufEngine.ts:762-770`, `configuredNonGenerativeBasenames()`) với vai trò khác hẳn:
chặn `GGUF_DEFAULT_MODEL` vô tình trỏ vào model nhúng — không liên quan câu hỏi Task 6. Hai
biến trùng giá trị hôm nay là **may mắn của lần sửa `.env` gần nhất, không được validation
nào ép buộc**.

Bảng đầy đủ 7 đường nhúng × 7 đường tìm (kho lưu, model, guard, số dòng DB thật) ở
`task-6-report.md` mục 1b/1c. Tóm tắt: **3 ô cấu trúc KHÔNG có guard định danh** (chỉ nhiều
nhất là guard kích thước, hoặc hoàn toàn không guard):

| Ô lệch | Trạng thái hôm nay (đo qua DB) | Mức nguy cơ |
|---|---|---|
| KB Studio ingest (`kb_studio_chunks`, không cột lưu model đã nhúng) × KB Studio search (tái dùng vector câu hỏi đã nhúng, không kiểm phía corpus) | **ĐANG BẬT** (`KB_STUDIO_ENABLED=true`), có dữ liệu thật: 3 dòng, 1 corpus `so-tay-bao-tri-w2`, ingest trong 1 cửa sổ 27 giây (`SELECT corpus, count(*), min/max("createdAt") FROM kb_studio_chunks GROUP BY corpus` → 1 hàng) | **Cao nhất** — sống, chỉ chưa bị kích hoạt vì chưa có lần `.env` đổi giữa 2 lần ingest |
| ops-KB pgvector mirror (`kb_chunks`, `server/services/kb/kbVectorStore.ts`) — `cosine()` tự viết dùng `Math.min(len)` TRUNCATE-COMPARE, tệ hơn cả canh kích thước | Dormant — `KB_PGVECTOR_ENABLED` không set trong `.env` → mặc định `false`; `SELECT count(*) FROM kb_chunks` → **0** | Thấp hôm nay, nhưng nếu bật lại mà không sửa trước thì không canh gì cả |
| Image search text-of-image (`aiImageEmbedding.ts`, modelCode `TEXT_OF_IMAGE_MODEL_CODE` là hằng số cố định bất kể model GGUF thật; `searchByImage()` chỉ lọc `modelCode` cho nhánh `onnx`, KHÔNG cho nhánh này) | Dormant — `IMAGE_EMBEDDING_DEFAULT=onnx` + 1 model ONNX `ACTIVE` (`SELECT count(*) FROM ai_models WHERE "modelType"='embedding' AND status='ACTIVE' AND format='ONNX'` → 1) nên nhánh mặc định không tới đây; `ai_image_embeddings` hôm nay 990/990 dòng đều `modelCode='dinov2-small'`, `embeddingDim=384` | Thấp hôm nay, sống lại ngay nếu tắt/xoá model ONNX ACTIVE |

**Q1×N1 (RAG KB ask ↔ RAG KB corpus) và Q2×N2 (Programming KB) CÓ guard định danh** —
`aiLocalKnowledgeService.ts`'s `computeEmbedModelMatches()` (W0.3, doc 11) so ĐỊNH DANH
(basename, đã chuẩn hoá quant suffix) giữa `embeddings-meta.json.model` (corpus) và
`GGUF_EMBED_MODEL` (query runtime) — lệch thì fallback keyword-only + cảnh báo, KHÔNG âm
thầm dùng vector sai không gian. `aiProgrammingKnowledgeService.ts` có bản sao gần như y hệt
(rủi ro drift giữa 2 bản copy nếu 1 bên sửa mà quên bên kia — ghi ở "Mối lo").

### 2. Probe cosine — script mới `scripts/ai-survey/embed-space-probe.mjs`

Nhúng CÙNG một câu (*"Máy AOI phát hiện lỗi hàn thiếu tại vị trí chân linh kiện R12 trên bo
mạch, cần kiểm tra lại trạm hàn sóng."*) bằng CẢ HAI model, `modelId` truyền TƯỜNG MINH (bỏ
qua `.env`/`resolveEmbedModelBasename()` để phép đo không phụ thuộc giá trị `.env` hiện tại):
```bash
npx tsx scripts/ai-survey/embed-space-probe.mjs
```
Output (rút gọn):
```
[A] Qwen3-Embedding-0.6B-f16 → dim=1024, resolvedId="Qwen3-Embedding-0.6B-f16"
[B] mxbai-embed-large-v1-f16 → dim=1024, resolvedId="mxbai-embed-large-v1-f16"

Số chiều: A=1024  B=1024  → GIỐNG NHAU (canh kích thước sẽ CHO QUA)
Cosine similarity(A, B) trên CÙNG một câu = 0.024282
```
**Số chiều bằng nhau (1024=1024, `assertEmbeddingDim` cho qua) nhưng cosine = 0.024282 —
gần như trực giao (orthogonal), không phải "kém chính xác hơn" mà là "hai không gian không
liên quan gì nhau".** Bằng chứng thực nghiệm trực tiếp, không suy diễn: bất kỳ đường nào so
sánh vector Qwen3 với vector mxbai sẽ nhận điểm tương đồng ≈ nhiễu ngẫu nhiên, không có tín
hiệu đáng tin, và không có lỗi/exception nào báo hiệu. Không có kết quả bất ngờ cần báo —
khớp giả thuyết brief.

VRAM/tiến trình: 1273 MiB trước → 1272 MiB sau (`nvidia-smi --query-gpu=memory.used...`),
không `node.exe` treo (`tasklist | grep -i node.exe` rỗng cả trước lẫn sau). Script tự
`unloadGgufModel()` cả hai model + `process.exit(0)`.

### 3. Mốc an toàn cho đợt sau — `npm run kb:eval`

```bash
npm run kb:eval
# recall@5 (cosine baseline): 151/151 = 1.000
```
25/25 domain đều `= 1.000`. Bằng chứng gián tiếp CỦNG CỐ mục 1 (Q1×N1 đang khớp không gian
đúng — nếu lệch, W0.3 guard đã tự rơi keyword-only và recall không thể sạch 1.000). Đây là
**mốc chốt**: đợt sửa embedder/guard sau này phải chạy lại đúng `npm run kb:eval` và so với
`151/151 = 1.000` — số nào thấp hơn là hỏng truy hồi, không phải cải thiện đo lường. Kết quả
ghi vào `knowledge/rag-eval-results.json` (đã có từ trước, lần chạy này chỉ cập nhật
timestamp). VRAM/tiến trình sau `kb:eval`: 1271 MiB, không `node.exe` treo.

### 4. Khuyến nghị (KHÔNG thực hiện)

1. **Ưu tiên cao nhất — KB Studio (`kb_studio_chunks`)**: thêm cột `embedModel` (ghi lúc
   ingest), rồi so định danh với `GGUF_EMBED_MODEL` hiện tại lúc query — tái dùng logic
   `computeEmbedModelMatches()` đã có, lý tưởng là RÚT THÀNH HÀM DÙNG CHUNG thay vì thêm bản
   sao thứ 3 (đang có 2 bản gần giống nhau ở Q1/Q2).
2. **`kb/kbVectorStore.ts`'s `cosine()`** (dormant): bỏ truncate-compare trước khi có ý định
   bật lại `KB_PGVECTOR_ENABLED`.
3. **`aiImageEmbedding.ts` text-of-image path** (dormant): đổi `TEXT_OF_IMAGE_MODEL_CODE` từ
   hằng số cố định sang phản ánh model GGUF thật đang chạy, và áp `modelCode` filter cho
   nhánh này giống nhánh `onnx`.
4. Cân nhắc hợp nhất/validate `GGUF_EMBED_MODEL` ↔ `GGUF_EMBEDDING_MODEL` (rủi ro thấp,
   dễ tránh).
5. Q1×N1/Q2×N2 (RAG/Programming KB) và Q5×N5 (image ONNX) đã có guard đủ tốt — không cần vá.

Không mục nào ở trên được thực hiện — đúng ràng buộc "chỉ đo, không sửa".

### Mối lo

1. KB Studio là nguy cơ SỐNG (dữ liệu thật + tính năng đang bật), khác 2 ô còn lại (dormant
   do cờ/điều kiện tắt) — ưu tiên khác nhau rõ rệt, không nên xếp ngang hàng.
2. `computeEmbedModelMatches()` tồn tại 2 bản gần như y hệt (`aiLocalKnowledgeService.ts`,
   `aiProgrammingKnowledgeService.ts`) — rủi ro drift nếu chỉ một bên được cập nhật, cùng lớp
   bug "tam trùng lặp" mà `modelResolver.ts` (doc69 G2-5b) từng phải dọn ở lớp resolve model
   thấp hơn.
3. `GGUF_EMBED_MODEL`/`GGUF_EMBEDDING_MODEL` trùng giá trị hôm nay là may mắn, không phải
   bảo đảm bằng validation.
4. KHÔNG tái hiện được sự cố sống ở ô Q3×N3 (cần 2 lần ingest bằng 2 model khác nhau thật —
   dựng dữ liệu giả cho KB Studio thật sẽ vượt ràng buộc "chỉ đo"); đánh giá "guard vắng mặt"
   dựa trên đọc mã trực tiếp, không phải tái hiện — ranh giới này cần giữ rõ khi đọc báo cáo.

Bản đầy đủ (bảng 7×7 đầy đủ, mọi lệnh + output nguyên văn): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-6-report.md` (không commit).
