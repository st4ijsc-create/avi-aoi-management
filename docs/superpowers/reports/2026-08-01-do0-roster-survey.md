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
