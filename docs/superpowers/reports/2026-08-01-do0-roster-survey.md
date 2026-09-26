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

- `server/services/programming/aiProgrammingCopilot.ts` (dùng cho cả `code` và `fim`) gọi thẳng `aiGgufEngine.chatCompletion`/`generateJSON`/`generateFim` (dòng 372, 390, 440, 458, 771, **807**) và chỉ dùng `aiModelRouter.route()` (pure, không mét) để lấy tham số model.
  *(Vòng sửa 2 — sửa số dòng: bản trước ghi **801**. Dòng 801 là `route({ task: "fim", … })` — bộ **định tuyến**, không phải lời gọi engine; dòng **807** mới là `await generateFim(`. Xác nhận bằng `sed -n '798,810p' server/services/programming/aiProgrammingCopilot.ts`. §7.8 #4 ghi 807 là đúng; §1 sai, nay đã thống nhất.)*
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
3. **`vision` ghi `model='default'`** trong `ai_gateway_metrics` thay vì tên file GGUF thật (`Qwen3-VL-8B-Instruct-UD-Q4_K_XL`) — route quyết định tier vision không set `modelId` tường minh nên cột `model` rơi về default schema (`drizzle/schema/ai.ts`). Không sai chức năng (ảnh vẫn được phân tích đúng, xem câu trả lời "Cổng kết nối... lệch vị trí 0.26 mm" cho ảnh thật). Ghi nhận, không sửa (ngoài phạm vi "chỉ đo").

   ⚠ **NÂNG MỨC (vòng sửa 2) — đây không còn là phiền toái nhãn mác.** Nhãn `default` này là **lý do trực tiếp khiến suốt cả Đợt 0 không ai nhìn thấy một model 8B đang cư trú trên GPU**. Model thật phục vụ 6 lượt vision ở bảng Bước 3 **không chạy trong tiến trình chính** — nó chạy trong một tiến trình `llama-server` **riêng** (`server/services/llamaVisionSidecar.ts`), chiếm **7 821 MiB đo trực tiếp** (§7.1a). Vì cột `model` ghi `default`, bảng lưu lượng **không hề tiết lộ** rằng dòng `vision` ứng với một hộ tiêu thụ VRAM lớn thứ hai trong hệ; vì nó là tiến trình khác, `loadedModels` của `aiGgufEngine` cũng không thấy nó. Hai lớp mù cộng lại ⇒ **mọi phép cộng VRAM của Đợt 0 (§2, §3, và bảng quyết định §7.1 bản đầu) đều thiếu nó**. Xem §7.1a để biết đầy đủ hậu quả và số đo.
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
# vram: baselineUsedMib=1164, peakUsedMib=18896, modelDeltaMib=17732

node scripts/ai-bench/bench.mjs --models code --iters 1 --warmup 0
# [bench] loaded in 39902.3ms
# [bench]   prefill@128 (153tok): prefill 464.5 tok/s, decode 285.9 tok/s
```

⚠ **Mức lưu bằng chứng của §2 (sửa ở vòng sửa 2 — bản trước trích 2 file JSON KHÔNG TỒN TẠI).** Bản trước ghi kèm hai đường dẫn `scripts/ai-bench/baselines/2026-07-31T21-52-29-887Z.json` và `…21-53-00-652Z.json`. Hai file đó **đã bị dọn** cùng đám tệp tạm cuối Task 2 và **không còn trên đĩa** — kiểm lại: `ls scripts/ai-bench/baselines/2026-07-31T21-5*.json` → `No such file or directory`. Trích một đường dẫn không tồn tại là tệ hơn không trích: người đọc sau tưởng có bằng chứng thô để mở ra. Đã **gỡ hai đường dẫn đó**; số liệu trên là **output nguyên văn của lệnh, JSON thô KHÔNG được giữ lại**. Muốn dựng lại thì chạy đúng hai lệnh trên kèm `--label` (mỗi lệnh ~1 phút) — chúng sẽ sinh JSON mới. Ba mức lưu bằng chứng của Đợt 0 nay được nói rõ ở §7.7 #13.
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

**Bằng chứng thô (vòng sửa 2):** hai file JSON của §5 — `scripts/ai-bench/baselines/do0-task5-fim-1p5b.json` và `do0-task5-fim-30b-coder.json` — trước đây **có trên đĩa nhưng chưa commit** (untracked). Nay **đã commit** cùng đợt sửa này, nên mọi con số ở bảng TTFT trên đều mở lại kiểm chứng được sau khi nhánh rời máy. Xem §7.7 #13 về ba mức lưu bằng chứng của cả đợt.

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
| **KB Studio ingest × search — LỖ HỔNG KÉP (sửa sau vòng review, xem "Vòng sửa 1")**: (a) `kb_studio_chunks` không cột lưu model đã nhúng, `searchCorpus()` không so định danh phía corpus; **VÀ (b) chính `searchCorpus()`'s nhánh Tier-2 dự phòng (`server/services/kbVectorStore.ts:236-245`) dùng `cosine()` TRUNCATE-COMPARE (`Math.min(len)`), không kiểm dim trước khi so** | **ĐANG BẬT** (`KB_STUDIO_ENABLED=true`), có dữ liệu thật: 3 dòng, 1 corpus `so-tay-bao-tri-w2`, ingest trong 1 cửa sổ 27 giây | **Cao nhất trong toàn báo cáo** — sống, KHÔNG có phòng thủ ở bất kỳ tầng nào (không định danh, không cả kích thước ở nhánh dự phòng) |
| ops-KB pgvector mirror (`kb_chunks`, `server/services/kb/kbVectorStore.ts` — **LƯU Ý tên gần trùng file KB Studio ở trên, chỉ khác thư mục `kb/`**) — `cosine()` TRUNCATE-COMPARE Y HỆT bản KB Studio: **hai bản sinh đôi của cùng một bug, một dormant (đây) một đang sống (hàng trên)** | Dormant — `KB_PGVECTOR_ENABLED` không set trong `.env` → mặc định `false`; `SELECT count(*) FROM kb_chunks` → **0** | Thấp hôm nay, nhưng nếu bật lại mà không sửa trước thì không canh gì cả |
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
25/25 domain đều `= 1.000`.

**[Sửa sau vòng review — lý do ban đầu SAI]** Bản đầu giải thích độ tin cậy của 1.000 bằng
guard sản xuất W0.3 (`computeEmbedModelMatches()`) — **sai**: `scripts/ai-kb/eval-rag.mjs` là
harness độc lập, tự cài lại phép truy hồi cosine riêng, KHÔNG BAO GIỜ gọi guard đó (đọc header
file: "Self-contained: re-implements the same bruteforce cosine retrieval"). Bằng chứng ĐÚNG
(tự chạy, không chép số reviewer) — ép `GGUF_EMBED_MODEL` sang mxbai qua biến môi trường CLI
(KHÔNG sửa `.env` — dotenv không ghi đè biến đã set sẵn, nên khỏi cần backup/restore `.env`):
```bash
GGUF_EMBED_MODEL=mxbai-embed-large-v1-f16.gguf npm run kb:eval
# recall@5 (cosine baseline): 56/151 = 0.371
```
Khớp chính xác số reviewer báo. **Mốc `1.000` đáng tin KHÔNG PHẢI vì có guard sản xuất canh
nó, mà vì đã TỰ ĐO được nó sụp xuống 0,371 (giảm 63%) khi cố ý đổi sai embedder** — chứng
minh `kb:eval` thực sự nhạy với lệch không gian nhúng, đó mới là lý do 1.000 xứng đáng làm
mốc chốt.

**Mốc chốt**: `npm run kb:eval` (không cờ, `.env` gốc) → `151/151 = 1.000`. Đợt sửa
embedder/guard sau này phải chạy lại đúng lệnh và so với mốc này — số nào thấp hơn là hỏng
truy hồi. Đã khôi phục `knowledge/rag-eval-results.json` về đúng trạng thái `151/151` sau phép
thử ép-mxbai (`cp` backup trước → chạy → `cp` khôi phục → `diff` rỗng → `rm` backup — lệnh đầy
đủ ở `task-6-report.md` mục 3). `.env` xác nhận không đổi cả trước lẫn sau
(`grep -n "^GGUF_EMBED_MODEL=" .env` → `Qwen3-Embedding-0.6B-f16.gguf`, không đổi). VRAM/tiến
trình sau cả 2 lượt `kb:eval`: dao động 1246-1271 MiB quanh baseline ~1250 MiB, không
`node.exe` treo ở lượt nào.

### 4. Khuyến nghị (KHÔNG thực hiện)

1. **Ưu tiên cao nhất — KB Studio (`kb_studio_chunks`)**: thêm cột `embedModel` (ghi lúc
   ingest), rồi so định danh với `GGUF_EMBED_MODEL` hiện tại lúc query — tái dùng logic
   `computeEmbedModelMatches()` đã có, lý tưởng là RÚT THÀNH HÀM DÙNG CHUNG thay vì thêm bản
   sao thứ 3 (đang có 2 bản gần giống nhau ở Q1/Q2).
2. **Bỏ truncate-compare ở CẢ HAI bản `cosine()`** — `server/services/kbVectorStore.ts:236-245`
   (KB Studio, ĐANG SỐNG) ưu tiên ngang mục 1 vì cùng đường sống; bản song sinh
   `server/services/kb/kbVectorStore.ts:33-41` (dormant) vẫn cần sửa trước khi bật lại
   `KB_PGVECTOR_ENABLED`.
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
5. **[Vòng sửa 1]** Hai file tên gần giống hệt (`server/services/kbVectorStore.ts` sống vs
   `server/services/kb/kbVectorStore.ts` dormant) là bẫy đọc-nhầm — chính lượt đo đầu tiên của
   task này chỉ điều tra một trong hai rồi dừng, bỏ sót bản song sinh của cùng một bug ở file
   còn lại. Rủi ro lặp lại: một đợt vá sau này sửa 1 file mà quên file kia, không ai nhận ra vì
   tên gần trùng.

### Vòng sửa 1 (review)

Reviewer: spec ✅ đạt (đúng 4 bước brief, diff sạch, premise-check đúng, cosine 0.024282 tái
lập byte-for-byte, KB Studio thiếu guard xác nhận qua `\d kb_studio_chunks`). 2 Important, cả
hai đã xử lý, KHÔNG sửa mã sản xuất:

- **Important 1 — bỏ sót bản song sinh của chính bug tôi tìm ra.** Chỉ điều tra
  `server/services/kb/kbVectorStore.ts`'s `cosine()` (dormant) rồi dừng, không đọc file tên
  gần giống `server/services/kbVectorStore.ts` (KB Studio, không có `kb/` giữa đường dẫn).
  Reviewer tìm bug Y HỆT (`Math.min(a.length, b.length)` truncate-compare) ở dòng 236-245 file
  này — nằm trong Tier-2 fallback của chính `searchCorpus()`, đúng ô đã xếp "rủi ro cao nhất".
  Tự đọc lại độc lập (Read trực tiếp, không chỉ tin lời reviewer) — xác nhận đúng. Đã gộp vào
  bảng ô-lệch, nâng mức nghiêm trọng KB Studio thành "lỗ hổng kép", cập nhật khuyến nghị #2 và
  thêm Mối lo #5.
- **Important 2 — lý do giải thích `recall@5=1.000` sai, không liên quan số đo được.** Bản
  đầu viện dẫn guard sản xuất W0.3 — nhưng `eval-rag.mjs` là harness độc lập, không gọi guard
  đó. Tự chạy lại phép ép-đổi-model độc lập (không chép số reviewer):
  `GGUF_EMBED_MODEL=mxbai-embed-large-v1-f16.gguf npm run kb:eval` → **56/151 = 0.371** (khớp
  đúng số reviewer). Đã thay giải thích sai bằng bằng chứng thật này. Đã khôi phục
  `knowledge/rag-eval-results.json` về `151/151` (diff rỗng) và xác nhận `.env` không hề bị
  chạm (biến truyền qua CLI, không qua file).

Không đụng mã sản xuất, không đụng `knowledge/embeddings.jsonl` — chỉ đọc thêm 1 file, chạy
thêm 1 lệnh `kb:eval` có kiểm soát rồi khôi phục `rag-eval-results.json`, sửa văn bản báo cáo.

Bản đầy đủ (bảng 7×7 đầy đủ, mọi lệnh + output nguyên văn, chi tiết vòng sửa 1): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-6-report.md` (không commit).

---

## §7 Tổng hợp và khuyến nghị (Task 7)

**Mục này không tạo ra số mới.** Mọi con số đều truy được về §1-§6 hoặc sổ tiến độ của đợt. Chỗ nào là phép suy của tôi thì dán nhãn **[suy luận]**; chỗ nào chưa ai đo thì ghi thẳng **chưa đo**. Chất lượng tiếng Việt **không được chấm ở đây** — đó là việc của chủ dự án.

### 7.0 Ba mức tin cậy — đừng trộn vào cùng một câu

| Trục | Mức tin cậy | Vì sao |
|---|---|---|
| **VRAM · khả thi** | **CAO — quyết được bằng trục này** | Hai người đo độc lập ra số khớp **đến từng MiB** (§3: 4770 / 23283 / 1563). Delta của một model 30B dao động **<0,6%** qua 6 lượt, 2 file GGUF khác nhau, 2 mốc thời gian cách gần một tháng (§3 "Lệch so với baseline"). Có cả **đo trực tiếp**, không chỉ phép cộng: model thứ hai bị từ chối nguyên văn `Not enough VRAM to fit the model with the specified settings` (§3). |
| **Tốc độ (tok/s)** | **CHỈ ĐỊNH HƯỚNG** | Tỉ lệ General/Coder ở roster C **dao động 3-30×** tuỳ độ dài output và có warmup hay không (sổ tiến độ, Task 3) — **không phải sai số cố định**. Chỉ nói được "chậm hơn một bậc độ lớn", **không đủ chính xác để cam kết SLA**. Thêm nữa máy đã đổi CPU+RAM giữa hai mốc baseline (§3), nên tok/s tuyệt đối không so ngang hàng với số cũ. |
| **Lưu lượng — cột "bao nhiêu lượt"** | **KHÔNG DÙNG ĐƯỢC** để cân roster | 20/38 dòng là do chính agent gọi trong một phiên 20 phút; 13/16 dòng `report` là cron nền; tier `code`/`fim` **về nguyên tắc** không vào được bảng (§1). |
| **Lưu lượng — cột "model nào phục vụ việc gì"** | TRUNG BÌNH-CAO | Cặp `task × model` là sự thật ghi lại từ đường chạy thật, **độc lập với việc gọi bao nhiêu lần**. Đây là phần duy nhất của trục lưu lượng còn dùng được. |

### 7.1a 🔴 Hộ tiêu thụ VRAM thứ năm: sidecar thị giác — ĐO TRỰC TIẾP (bổ sung ở vòng sửa 2)

**Bản đầu của §7 — và của cả §2, §3 — bỏ sót hoàn toàn khoản này.** Mọi phép cộng VRAM của Đợt 0 chỉ đếm các model nằm trong `loadedModels` của `aiGgufEngine`. Tier `vision` **không nằm ở đó**: nó chạy trong một **tiến trình `llama-server` riêng biệt** do `server/services/llamaVisionSidecar.ts` sinh ra (`spawn()`, dòng 220). Vì thế nó vô hình với mọi trục đo của đợt: `bench.mjs` **không có một chữ "vision" nào** (`grep -ic vision scripts/ai-bench/bench.mjs` → **0**), `loadedModels` không thấy tiến trình khác, và bảng `ai_gateway_metrics` ghi nó là `model='default'` (§1 Mối lo #3).

**Nó đang sống trong sản xuất hôm nay**, không phải khả năng lý thuyết — cả ba điều kiện của `isVisionSidecarAvailable()` (`llamaVisionSidecar.ts:122-134`) đều thoả:

```bash
grep -n "LLAMA_SERVER_BIN\|GGUF_VISION_MODEL\|GGUF_VISION_MMPROJ\|LLAMA_VISION_" .env
# 142:GGUF_VISION_MODEL=D:/SOURCES/16.AI/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf
# 143:GGUF_VISION_MMPROJ=D:/SOURCES/16.AI/Qwen3-VL-8B-mmproj-F16.gguf
# 265:LLAMA_SERVER_BIN=D:/SOURCES/16.AI/llama-cuda/llama-server.exe
# 269:LLAMA_VISION_GPU_LAYERS=999      ← nạp TOÀN BỘ lên GPU
# 271:LLAMA_VISION_CTX=8192
# 275:LLAMA_VISION_IDLE_TIMEOUT_MS=600000   ← giữ 10 phút sau mỗi lần dùng
```
Cả ba file đều tồn tại trên đĩa (`ls -l` xác nhận), và §1 ghi **6 lượt vision thật, 5/5 thành công trên ảnh thật**.

#### Phép đo trực tiếp (không ước lượng)

Tôi **không** dùng con số suy từ kích thước file. Tôi khởi chính binary `llama-server` với **đúng bộ tham số mà mã sản xuất truyền** (`llamaVisionSidecar.ts:208-217`: `-m … --mmproj … --host 127.0.0.1 --port 8081 -ngl 999 -c 8192 --jinja`), đo `nvidia-smi` trước/sau, chạy một lượt suy luận thật trên ảnh thật, rồi tắt. **Đây là tiến trình riêng — không khởi động app, không chạm race double-warm.**

```bash
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits      # trước
D:/SOURCES/16.AI/llama-cuda/llama-server.exe \
  -m D:/SOURCES/16.AI/Qwen3-VL-8B-Instruct-UD-Q4_K_XL.gguf \
  --mmproj D:/SOURCES/16.AI/Qwen3-VL-8B-mmproj-F16.gguf \
  --host 127.0.0.1 --port 8081 -ngl 999 -c 8192 --jinja &
# poll /health tới khi {"status":"ok"} (giống probeHealth() của sidecar)
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits      # sau
curl -s -X POST http://127.0.0.1:8081/v1/chat/completions -d @req.json  # 1 ảnh PCB thật
```

| Mốc | VRAM đã dùng (MiB) | Δ so với baseline |
|---|---|---|
| Baseline (GPU rảnh, không app, không model) | **1 239** | — |
| Sidecar **sẵn sàng, chưa suy luận** (`/health` = ok sau **16 s**) | **9 060** | **+7 821** |
| **Đỉnh trong lượt suy luận thật** (ảnh PCB 227 KB, 270 tok nhắc → 512 tok ra) | **9 159** | **+7 920** |
| Sau khi tắt tiến trình | **1 233** | +0 (sạch) |

⇒ **Số dùng cho mọi phép cộng dưới đây: 7 821 MiB** (trạng thái thường trú, dè dặt hơn đỉnh). Lượt suy luận trả về 1 630 ký tự tiếng Việt mô tả bo mạch — **sidecar hoạt động thật, không phải cấu hình chết**.

⚠ **Số đo được LỚN HƠN ĐÁNG KỂ mọi ước lượng từ kích thước file.** Trọng số trên đĩa chỉ 6 015 MiB (4 910 + 1 105); áp hệ số file→delta của chính đợt này (17 750/16 872 = ×1,052) ra ~6 330 MiB. **Thực đo 7 821 MiB — cao hơn ước lượng ~1 490 MiB.** Log của `llama-server` giải thích chỗ chênh, và đây là chi tiết quan trọng cho đợt sau:
```
srv llama_server: n_parallel is set to auto, using n_parallel = 4 and kv_unified = true
srv    load_model: initializing slots, n_slots = 4          ← 4 khe × n_ctx 8192
srv    load_model: [mtmd] estimated worst-case memory usage of mmproj is 1502.33 MiB
```
Sidecar **không truyền `-np`**, nên `llama-server` **tự chọn 4 khe song song**, mỗi khe ctx 8192 ⇒ KV-cache ×4 cộng buffer mtmd 1 502 MiB. Bài học lặp lại đúng lớp lỗi của cả đợt: **ước lượng từ hằng số cấu hình (kích thước file, `-c 8192`) mà không đo hàm/tiến trình thật thì thiếu ~19%.**

#### Ba câu hỏi phải trả lời bằng mã, không bằng suy đoán

**(1) Sidecar có thường trú không? — KHÔNG thường trú, nhưng "tạm thời" ở đây dài 10 phút và tự kích hoạt.**
`ensureSidecar()` **chỉ** được gọi từ `describeImageViaSidecar()` — không có lời gọi nào lúc boot (`grep -rn "ensureSidecar" server/` → 0 call site ngoài chính module). Nó là **nạp-theo-yêu-cầu**. Sau mỗi lượt dùng, `touchIdle()` (`:149-160`) đặt hẹn giờ `LLAMA_VISION_IDLE_TIMEOUT_MS=600000` ⇒ **giữ nguyên 7,8 GB thêm 10 phút** rồi mới `stopSidecar()`.
⚠ Nhưng **nó không chỉ được kích hoạt bởi thao tác tay của người dùng**: `aoiImageEmbeddingWorker.ts:322-328` gọi `describeImageViaSidecar()` **tự động** mỗi khi một lượt kiểm tra AOI bị đánh giá là bất thường (`decision.escalate`), và hàng đợi đó được nạp từ `aoiPackageRouter.ts:907` — tức **do lưu lượng máy đẩy lên, không do người bấm nút**. Cờ đang BẬT: `.env:301 AOI_EMBEDDING_ENABLED=true`. ⇒ Trên dây chuyền chạy thật, sidecar **lên xuống theo nhịp ảnh NG**, và mỗi lần lên là giữ 10 phút. **Không được coi đây là sự kiện hiếm.**

**(2) Có tắt được không? — CÓ, bằng `.env`, nhưng cái giá là mất hẳn tính năng thị giác.**
`getVisionSidecarConfig()` (`:104-116`) trả `null` nếu **thiếu bất kỳ** biến nào trong `LLAMA_SERVER_BIN` / `GGUF_VISION_MODEL` / `GGUF_VISION_MMPROJ` ⇒ `isVisionSidecarAvailable()` = false. **Mọi** call site đều kiểm cờ này trước và **suy giảm trung thực** (`aiGgufEngine.ts:1653`, `aiVisionLanguage.ts:135/206`, `aiProviderRouter.ts:398`, `kbImageDescriber.ts:64`, `aoiImageEmbeddingWorker.ts:324`, `aiLocalKnowledgeApi.ts:233`) — không có đường nào âm thầm hỏng. ⇒ **Đây là một lựa chọn thật của chủ dự án:** đổi 7,8 GB VRAM lấy việc **không còn mô tả/hỏi đáp ảnh kiểm tra**. Không có nút chỉnh trung gian: `LLAMA_VISION_GPU_LAYERS` hạ xuống sẽ đẩy sidecar sang CPU (chậm, chưa đo), nhưng **không tồn tại** cơ chế giới hạn VRAM nào khác cho tiến trình này.

**(3) Có phải tính vào ngân sách không? — PHẢI, và đây là chỗ bản đầu sai nhất.**
Vì nó không thường trú vĩnh viễn, cám dỗ là để nó ngoài bảng. **Sai** — vì ngân sách VRAM không phải bài toán trung bình mà là bài toán **đỉnh đồng thời**: câu hỏi đúng không phải "sidecar chạy bao nhiêu % thời gian" mà **"khi nó chạy, roster có sống không?"**. Và nó có thể chạy **bất cứ lúc nào** 4 model kia đang thường trú, do máy đẩy lên. ⇒ Bảng 7.1 dưới đây tính nó vào, kèm một cột riêng cho trạng thái "sidecar đang ngủ" để chủ dự án thấy cả hai mặt.

#### Hậu quả 1 — cộng lại toàn bộ ba roster

| Roster | §7 bản đầu (không sidecar) | **+ sidecar 7 821** | So với 32 607 MiB |
|---|---|---|---|
| **Hiện trạng** (2×30B) | 36 667 · vượt 4 060 ❌ | **44 488** | ❌ **vượt 11 881** |
| **A** (Coder-30B dùng chung) | 29 717 · dư 2 890 ✅ | **37 538** | ❌ **vượt 4 931** |
| **B** (4B + Coder-30B) | 29 741 · dư 2 866 ✅ | **37 562** | ❌ **vượt 4 955** |
| **C** (4 model, General partial) | 30 685 · dư 1 922 ✅ | **38 506** | ❌ **vượt 5 899** |

*(Phép cộng: delta sidecar đo trên baseline 1 239 MiB, các tổng roster đã gồm baseline riêng của chúng (1 122/1 113/1 180) — nên cộng delta-vào-tổng là đúng, không đếm baseline hai lần.)*

⚠ **Đọc kỹ dòng A và B: mức vượt 4 931 / 4 955 MiB LỚN HƠN chính con số 4 060 MiB mà cả Đợt 0 dùng để kết án hiện trạng là "không dùng được".** Ô trung tâm của bảng quyết định — "vừa 32,6 GB? ✅" — **không đúng cho bất kỳ roster nào** khi sidecar thức.

#### Hậu quả 2 — cách nó thực sự hỏng: **thu nhỏ roster, không phải OOM ngay**

Đừng đọc "vượt 4 931 MiB" thành "sập". Cơ chế thật tinh vi hơn, và tệ hơn về mặt chẩn đoán. Khi sidecar thức, dư địa còn lại cho các model GGUF là:
```
32 607 − 1 240 (nền desktop) − 7 821 (sidecar) = 23 546 MiB
Roster A cần:  17 729 (Coder-30B) + 3 464 (4B) + 1 774 (fim) + 5 628 (embed) = 28 595 MiB
                                                              ⇒ THIẾU 5 049 MiB
```
Tập con **lớn nhất còn vừa**: Coder-30B + embed = 17 729 + 5 628 = **23 357 MiB** (còn dư 189). Thêm bất kỳ model thứ ba nào cũng vỡ. ⇒ **Khi có ảnh đi qua, roster A co từ 4 model xuống còn 2**, và hai model bị đuổi phải nạp lại — **8 828 ms nếu file còn nóng, 40 969 ms nếu nguội** (§3). Người dùng không thấy lỗi; họ thấy "AI thỉnh thoảng chậm kinh khủng".

#### Hậu quả 3 — sidecar ĐẾM VÀO guard nhưng KHÔNG BỊ ĐUỔI ĐƯỢC

Đây là điểm lật lại kết luận Critical của vòng sửa 1. Tôi tự đọc `readVramState()` (`aiGgufEngine.ts:303-336`): **cả hai** nguồn đều đo **toàn thiết bị**, không phải riêng tiến trình —
- nguồn 1: `llamaInstance.getVramState()`;
- nguồn 2 (fallback): `nvidia-smi --query-gpu=memory.used,memory.total` — theo định nghĩa là **toàn card**.

⇒ 7 821 MiB của sidecar **được cộng vào `vram.used` mà guard đọc**. Nhưng `evictLRU()` (`:375-390`) **chỉ duyệt `loadedModels`** — một `Map` của tiến trình chính. Sidecar là **tiến trình khác**, không có entry nào, **không thể bị đuổi**.

| | Bản đầu §7.1 (không sidecar) | Với sidecar thức |
|---|---|---|
| Mức guard đọc được, roster A, thứ tự bất lợi nhất | (29 717 − 1 774)/32 607 = **85,7%** → dưới ngưỡng 90 | (27 943 + 7 821)/32 607 = **109,7%** |
| Ngưỡng 90% = 29 346 MiB — bị vượt khi? | không bao giờ (trần là 29 717 và guard đọc trước lượt nạp cuối) | **ngay khi nền 1 240 + sidecar 7 821 + Coder-30B 17 729 = 26 790 rồi nạp thêm model thứ ba bất kỳ** |

⇒ Câu **"guard KHÔNG kích hoạt lần nào — A và B giữ đủ 4 model"** (bản đầu ở 7.1, 7.5, 7.6 bước 8) **chỉ đúng khi sidecar đang ngủ**. Khi nó thức, guard **kích hoạt**, và vì thứ chiếm chỗ nhiều nhất (sidecar) lại là thứ duy nhất nó **không** đuổi được, nó sẽ đuổi **các model GGUF vô can** — rồi nếu tất cả đều `refCount > 0` thì rơi vào nhánh `console.warn` `"no idle model to evict — deferring/allowing load with OOM risk"` (`:358`) và **vẫn cho nạp**.

**⚠ Kết luận thẳng, không cứu:** con số 85,7% và câu "giữ đủ 4 model" của vòng sửa 1 là **phân tích trạng thái tĩnh trong một hệ mà tôi chưa đếm hết hộ tiêu thụ**. Nó không sai về số học; nó sai về phạm vi. Cả A lẫn B **đều không vừa** khi tính đủ.

---

### 7.1 Bảng quyết định — ba roster ứng viên + hiện trạng, trên mọi trục đã đo

Định nghĩa roster (§3): **A** = một model 30B duy nhất (Coder) làm cả `deep` lẫn `code`. **B** = `deep` là Qwen3-4B, `code` là Coder-30B. **C** = giữ cả hai 30B, model General bị đẩy phần lớn sang RAM (`gpuLayers=8/48`).

| Trục | Hiện trạng (2×30B) | A (Coder-30B dùng chung) | B (4B + Coder-30B) | C (General partial + Coder full) | Nguồn |
|---|---|---|---|---|---|
| **VRAM — cấu hình chính, sidecar thị giác ĐANG NGỦ** | **36 667 MiB · vượt 4 060 MiB** ❌ | 29 717 MiB · dư 2 890 | 29 741 MiB · dư 2 866 | **23 283 MiB · 71,4% · dư 9 324** (đo trực tiếp 2 model cùng cư trú) | §3 "Xác nhận bằng đo lường" (cộng dồn từ `scripts/ai-bench/baselines/roster-*.json`) · ô C từ §3 "Roster C" (script import thẳng `loadGgufModel`) |
| **🔴 Sidecar thị giác `Qwen3-VL-8B` (tiến trình `llama-server` RIÊNG)** | **+7 821 MiB** — cộng vào **MỌI** cột, vì nó độc lập với lựa chọn roster | +7 821 | +7 821 | +7 821 | **§7.1a — ĐO TRỰC TIẾP** (spawn `llama-server` đúng args sản xuất, `nvidia-smi` trước/sau: 1 239 → 9 060 MiB; đỉnh lúc suy luận thật 9 159) |
| **🔴 VRAM — cấu hình chính, sidecar THỨC (trạng thái phải sống được)** | **44 488 · vượt 11 881** ❌ | **37 538 · vượt 4 931** ❌ | **37 562 · vượt 4 955** ❌ | **31 104 · dư 1 503** ⚠ (chỉ 2 model lớn, chưa gồm fim/embed) | §7.1a bảng "Hậu quả 1". Mức vượt của A/B **lớn hơn** chính 4 060 MiB dùng để kết án hiện trạng |
| **VRAM — khi MỌI tier cùng thường trú [suy luận]** | 47 633 MiB — không khả thi | 29 717 (4 model) / **37 538 nếu sidecar thức** | 29 741 (4 model) / **37 562 nếu sidecar thức** | 30 685 (4 model) / **38 506 nếu sidecar thức** — hoặc **34 159 · vượt** nếu giữ thêm khe `fast` 4B (5 model) | Phép cộng của tôi, cùng phương pháp §3, trên chính các delta §3 + delta sidecar §7.1a. `GGUF_MAX_LOADED_MODELS=4` (`.env:124`) chặn ở 4 model ⇒ model thứ 5 bị đuổi thay vì cộng thêm |
| **Ngưỡng đuổi LRU 90% có kích hoạt không?** *(sửa 2 lần — xem 7.9 và 7.10)* | không tới lượt — model 30B thứ hai bị từ chối trước đó | **sidecar ngủ: KHÔNG** (85,7%) · **sidecar thức: CÓ** — và đuổi nhầm đối tượng, xem ⚠ dưới bảng | **sidecar ngủ: KHÔNG** (85,7%) · **sidecar thức: CÓ** | 2 model lớn: **71,4%** khi sidecar ngủ; thức thì **95,4%** ⇒ vượt ngưỡng | Đọc mã: `enforceVramGuard()` (`aiGgufEngine.ts:346`) chỉ tới được từ `ensureCapacity()` (dòng 435), call site duy nhất dòng 607 — chạy **TRƯỚC mỗi lượt nạp**; không `setInterval`. **`readVramState()` (`:303-336`) đo TOÀN THIẾT BỊ** (cả `getVramState()` lẫn `nvidia-smi --query-gpu`) ⇒ sidecar **đếm vào** guard; nhưng `evictLRU()` (`:375-390`) **chỉ duyệt `loadedModels`** ⇒ **không đuổi được sidecar** |
| **Số lần đuổi LRU (evict) đo được** | **0** — nhưng đây là **BẪY ĐỌC** | **0** — cùng bẫy | chưa đo | chưa đo | §2 bảng kết quả, đếm cả **hai** đường log (`grep -c "evicted LRU model"` và `grep -c "Evicted LRU model:"`) |
| **KV cache ở ngữ cảnh tối đa (32 768)** | **chưa đo** cho model 30B ở mọi roster — trọng số không nạp nổi qua đường app nên không tách được ảnh hưởng riêng của ngữ cảnh | chưa đo | chưa đo | chưa đo | §2 "KV cache" — đo **thay thế** bằng model 4B: 4/4 thành công ctx 4096→32768, VRAM 6 702→22 819 MiB, 32768 mới tốn 68% nên **không tìm được điểm hỏng**. Không đại diện cho 30B |
| **Hai bộ não 30B cùng thường trú được không?** | **❌ KHÔNG** — model #2 bị từ chối, có nguyên văn | không áp dụng (chỉ còn 1 model 30B) | không áp dụng | **✅ CÓ** — đo trực tiếp, cả hai cùng cư trú, không lỗi `cudaMalloc` | §3 `_double-load-probe.mjs` (3 người chạy độc lập, cùng kết quả) · ô C: §3 "Roster C" |
| **Tốc độ khe "general"** | 277,4 tok/s decode @128 ‡ | 227,2-268,3 ‡ | 264,2 ‡ (model 4B) | **2,9 tok/s** ‡‡ — chậm hơn một bậc độ lớn | §3 bảng 3-roster (`npm run ai:bench`) · ô C: §3 `generateText()` |
| **Tốc độ khe "code"** | 265,9 ‡ | 268,3 ‡ | 267,4 ‡ | 30,5 tok/s ‡‡ (và **không có tranh chấp GPU** khi hai model cùng cư trú — re-reviewer đo Coder 126,7 tok/s một mình vs **134,4** lúc co-resident) | §3 bảng 3-roster · sổ tiến độ Task 3 (đo lại độc lập) |
| **TTFT gợi ý mã (FIM)** | Giữ 1.5B: 13,2 / 26,8 ms · trỏ sang Coder-30B: 39,5 / 76,6 ms | **giống hệt** — cả ba roster đều giữ Coder-30B thường trú | giống hệt | giống hệt (Coder chạy full GPU ở C) | §5 bảng TTFT (`bench.mjs`, mốc sự kiện thật `onTextChunk`, không suy từ tok/s) |
| **Lưu lượng phục vụ được** | **Trục này không phân biệt được roster nào** — xem 7.4(b): tier code/fim về cấu trúc không vào được bảng, và 20/38 dòng là lưu lượng dựng | ← | ← | ← | §1 bảng Bước 3 + §1 "Phát hiện quan trọng" |
| **Đổi được bằng MỘT dòng `.env`?** | (hiện trạng) | **✅ dòng 120** | **✅ dòng 120** | **❌ KHÔNG** — không tồn tại biến env nào cho `gpuLayers` của engine chính ⇒ phải sửa mã đường boot | `grep -rniE "GGUF_GPU_LAYERS\|GPU_LAYERS" --include=*.ts --include=*.mjs server/ scripts/ .env` (chạy trong Task 7) |
| **Sống được qua đường boot app hôm nay (race chưa vá)?** *(ô B sửa sau vòng review — bản đầu kết luận NGƯỢC, xem 7.9)* | **❌ 24 lượt / 0 thành công** | **❌ 21 lượt / 0 thành công** | **chưa đo — và [suy luận] TỆ HƠN A/hiện trạng, không phải tốt hơn**: model mặc định 4B đủ nhỏ để **cả hai** lượt nạp chồng nhau **cùng thành công**, lượt sau ghi đè entry lượt trước **mà không `dispose()`** ⇒ **rò ~3 474 MiB mồ côi** mà `evictLRU()` không với tới được ⇒ 29 741 + 3 474 = **33 215 > 32 607** | **chưa đo qua boot app** (§3 đo bằng script import thẳng module, né cả hai racer bằng cấu trúc) | §2 bảng kết quả · ô B: đọc mã `aiGgufEngine.ts:659-670` — `loadedModels.set()` là **vô điều kiện**, không kiểm tra entry cũ, không `dispose()`; `evictLRU()` (dòng 375) chỉ duyệt `loadedModels` nên không thấy bản mồ côi |

‡ Số của `bench.mjs` (có warmup, tách riêng prefill/decode). ‡‡ Số của `generateText()` (gộp prefill+decode, **không warmup**). **Hai thang đo này không so trực tiếp được với nhau** — chỉ so trong cùng một thang (§3 đã cảnh báo). Trong bảng, hãy so cột-với-cột ở cùng ký hiệu, đừng so 265,9 ‡ với 30,5 ‡‡.

⚠ **"0 lần evict" là bẫy đọc, đừng đọc thành "roster này quản lý bộ nhớ tốt".** Nó bằng 0 vì **không có model 30B nào nạp nổi để mà đuổi** (§2). Cơ chế khớp với log: `evictLRU()` chỉ duyệt bảng `loadedModels`, mà một entry chỉ được ghi vào bảng **sau khi** model nạp xong hoàn toàn — hai racer đang cùng nạp dở thì bảng **rỗng**, không có gì để đuổi. Đó là lý do §2 đếm được **0 dòng trên cả hai đường log evict** dù nhánh xử lý OOM có gọi `evictLRU()`. *(Đọc mã, nhất quán với log §2 — không phải phép đo mới.)*

⚠ **Rủi ro thật của mức 91% không phải là bị đuổi model — mà là hỏng im lặng** (sửa sau vòng review, thay cho suy luận sai ở bản đầu): guard **không bảo vệ** khoảng dư ~2,9 GB, vì nó chạy trước lượt nạp và không biết model sắp nạp to bao nhiêu. Khi một lượt nạp thực sự vượt VRAM, nhánh `catch` (`aiGgufEngine.ts:620-645`) **không báo lỗi lên trên**: nó **đuổi sạch mọi model đang rảnh**, rồi **nạp lại với `gpuLayers:"auto"`** — tức đẩy bớt lớp sang CPU. Kết quả: **tier đó âm thầm tụt xuống tốc độ kiểu roster C**, chỉ để lại **một dòng `console.warn` trong log máy chủ**, không lỗi, không tín hiệu nào tới người dùng, và các tier khác vừa bị đuổi sẽ phải nạp lại (8 828 ms nếu file còn nóng, 40 969 ms nếu nguội — §3). Đây đúng lớp **"hỏng im lặng"** mà cả Đợt 0 đang đuổi. ⇒ Việc cần làm sau khi đổi roster không phải chỉnh ngưỡng, mà là **theo dõi dòng cảnh báo đó** (7.6 bước 8).

⚠ **Mọi con số guard ở trên là PHÂN TÍCH TRẠNG THÁI TĨNH — nêu rõ điều kiện, đừng đọc thành vô điều kiện** (bổ sung ở vòng sửa 2). Phép tính "tổng − model nhỏ nhất" chỉ đúng khi **không model nào đang sinh token**. Nhưng chính §3 ghi: mỗi model tốn **thêm 470-940 MiB lúc sinh token thật**, và `.env:125` đặt `GGUF_MAX_CONCURRENCY=4` ⇒ hệ cho phép **tới 4 lượt sinh đồng thời**. Cộng vào:

| Trạng thái | Roster A | % của 32 607 |
|---|---|---|
| 4 model thường trú, **không ai sinh** (con số của vòng sửa 1) | 29 717 | 91,1% |
| + **2 lượt sinh** đồng thời (~940-1 880 MiB) | 30 657-31 597 | **94-97%** |
| + **4 lượt sinh** đồng thời (trần `GGUF_MAX_CONCURRENCY`) | 31 597-33 477 | **97-103%** |

⇒ Phát biểu đúng là: ***"ở trạng thái tĩnh và khi sidecar thị giác đang ngủ, guard không kích hoạt; khi có sinh token đồng thời — hoặc khi sidecar thức — thì có, và đúng lúc đó `evictLRU()` lại bất lực: model đang bận thì `refCount > 0` nên bị bỏ qua (`:379`), còn sidecar thì không nằm trong `loadedModels`."*** Cả hai đường đều dẫn về cùng một nhánh `:358` — *"no idle model to evict — deferring/allowing load with OOM risk"* — tức **vẫn cho nạp** dù biết rủi ro.

**Kết luận không phụ thuộc bất kỳ điều gì còn chờ:** hiện trạng **không thể giữ cả hai model 30B cùng thường trú** (đo trực tiếp trên đường race-free, model thứ hai bị từ chối nguyên văn), **và** không nạp nổi model 30B nào **qua đường boot hiện tại của app** (45/45 lượt lỗi, §2). Hai model 30B riêng cần ~35,5-36,7 GB trên một cỗ máy có 32,6 GB — xác nhận bằng **ba nguồn độc lập**: phép cộng delta (§3), delta 17,7 GB × 2 ≈ 35,4 GB đo ở Task 2 qua đường race-free (sổ tiến độ Task 2), và phép nạp-chồng trực tiếp bị từ chối (§3).

⚠ **Nhưng "hiện trạng không dùng được" KHÔNG còn kéo theo "A hoặc B thì dùng được"** (sửa ở vòng sửa 2). Với sidecar thị giác tính vào, **A vượt 4 931 MiB và B vượt 4 955 MiB** — **nhiều hơn** chính 4 060 MiB đã dùng để kết án hiện trạng (§7.1a). Kết luận trung thực: **không roster nào trong bảng vừa 32,6 GB một cách vô điều kiện.** Việc phải làm không chỉ là chọn roster mà là **quyết định xem tính năng thị giác có nằm trong ngân sách hay không** — xem 7.5.

### 7.2 Trục tốc độ, nói bằng ngôn ngữ người dùng

Roster C là roster duy nhất giữ được cả hai bộ não, và đây là cái giá của nó:

| Việc | Roster A/B (full GPU) | Roster C (General đẩy sang RAM) |
|---|---|---|
| Một câu trả lời ngắn ~150 token | vài giây | ~52 giây |
| Một đoạn phân tích ~500 token | ~16 giây *(lấy con số **dè dặt nhất** của cả đợt, 30,5 tok/s ở thang ‡‡)* | **~172 giây — gần 3 phút** |
| Một báo cáo ca ~1 500 token | ~50 giây | **~8,6 phút** |

Các số cột C là **phép nhân từ một điểm đo duy nhất 2,9 tok/s** (§3) — đúng để hình dung **bậc độ lớn**, **sai nếu dùng làm cam kết**: tỉ lệ chậm dao động 3-30× tuỳ độ dài output và warmup (sổ tiến độ Task 3). Câu đáng tin là: *ở roster C, model general trả lời chậm hơn một bậc độ lớn — khoảng cách là "vài giây" so với "vài phút", không phải "hơi chậm hơn"*.

Một điểm **có lợi** cho C, cũng đã đo: khi hai model cùng cư trú, model code **không hề chậm đi** (126,7 → 134,4 tok/s) — **chỉ mình model general trả giá**.

### 7.3 TTFT gợi ý mã — thay ngưỡng giả định bằng chuẩn có nguồn

Ngưỡng "nửa giây / 300-500 ms" dùng ở §5 là **giả định của điều phối viên, không có nguồn nào** (§5 đã tự dán nhãn đúng). Tôi không dùng nó làm khung chính. Thay bằng một chuẩn **có nguồn**:

> **Ba mốc thời gian phản hồi giao diện** — Miller (1968), Card/Robertson/Mackinlay (1991), phổ biến hoá bởi Jakob Nielsen (*Usability Engineering*, 1993; NN/g, "Response Times: The 3 Important Limits"):
> **0,1 giây** = người dùng cảm thấy hệ thống phản ứng **tức thì** · **1 giây** = dòng suy nghĩ **không bị đứt** (đã thấy chậm nhưng chưa mất mạch) · **10 giây** = giới hạn giữ được chú ý.

⚠ Đây là chuẩn giao diện **tổng quát**, **không phải chuẩn riêng cho gợi ý mã nội dòng (ghost-text)**, và **không được đo trên hệ này**. Một chuẩn có nguồn dành riêng cho ghost-text thì **tôi không biết** — nói thẳng là không biết, thay vì bịa một con số khác.

Đối chiếu số §5 với ba mốc đó:

| Kịch bản | Thời gian tới **ký tự đầu tiên** | Thời gian tới **gợi ý 32 token hoàn chỉnh** | Đọc theo chuẩn |
|---|---|---|---|
| Qwen2.5-Coder-1.5B (hiện tại), nhắc 153 tok | 13,2 ms | 83,8 ms | Cả hai mốc đều **trong vùng "tức thì" 0,1 s** |
| 1.5B, nhắc 533 tok | 26,8 ms | 89,3 ms | như trên |
| Qwen3-Coder-30B, nhắc 153 tok | 39,5 ms | 148,6 ms | Ký tự đầu **tức thì**; gợi ý trọn vẹn rơi vào vùng giữa 0,1 s và 1 s |
| Qwen3-Coder-30B, nhắc 533 tok | **76,6 ms** (= 77% ngân sách 0,1 s) | 187,8 ms | như trên |

**Đọc ra tiếng người:** đổi ghost-text sang Coder-30B thì **ký tự đầu vẫn xuất hiện tức thì** ở cả hai độ dài đã đo; thứ đổi là gợi ý **trọn vẹn** không còn "tức thì" nhưng vẫn **rất xa** mốc làm đứt mạch suy nghĩ (1 giây). Trên trục độ trễ thuần, **không có lý do bằng số để từ chối đổi**.

⚠ Ba điều làm mọi số trên là **tốt nhất có thể (best-case)**: đo trên **GPU rảnh** (§5 mối lo 2), **không gồm** chi phí mạng/HTTP giữa trình soạn thảo và máy chủ (§5 mối lo 5), và **giả định model đã thường trú** — nếu phải nạp trước, §3 đo đúng file này mất **8 828 ms khi file còn nóng trong cache hệ điều hành, 40 969 ms khi nguội** (nêu đủ cả hai đầu: trích một đầu là gây hiểu nhầm — §3 M-1). Riêng ngân sách 0,1 s thì phần mạng/HTTP bỏ sót là đáng kể, không phải làm tròn.

### 7.4 ⚠ Ba chỗ số liệu KHÔNG quyết được

**(a) Chất lượng tiếng Việt — đang chờ chủ dự án chấm.** File ẩn danh: `docs/superpowers/reports/2026-08-01-do0-vi-ab.md`. Khảo sát này **không chấm và không đoán trước**. Ba điều nên biết **trước khi** chấm (đây là bối cảnh, không phải gợi ý kết quả):

- ⚠ **Có 4 cặp được sinh ra, nhưng chỉ 3 cặp CHẤM ĐƯỢC** (nói rõ ở vòng sửa 2 — bản đầu chỉ nói nhẹ "nên cân trọng số"). **Prompt 1 (RCA) không đóng góp gì** cho câu hỏi "tiếng Việt của model nào tốt hơn" vì **cả hai model đều trả lời bằng tiếng Anh** — do `synthesize()` nhận tham số `lang` nhưng không hề dùng (7.8 #3), không phải do model. Chấm P1 là chấm một thứ mà **sản xuất không bao giờ sinh ra bằng tiếng Việt**. ⇒ Phán quyết tổng hợp phải dựa trên **P2/P3/P4**.
- §4 chỉ so **30B-Instruct vs 30B-Coder**. **Model 4B không có mặt trong phép so.** ⇒ Nếu kết quả chấm nghiêng về "cần một model general giỏi tiếng Việt", thì roster B **vẫn chưa có bằng chứng chất lượng nào** và phải qua một lượt chấm nữa trước khi chọn.
- Nhãn **"Model 1" là CÙNG MỘT model xuyên suốt cả 4 prompt** (Model 2 cũng vậy) — gán một lần, không đảo giữa các prompt. Không biết điều này thì không thể ra phán quyết tổng hợp. File A/B nay nói rõ điều đó ngay đầu trang và có sẵn phiếu ghi phán quyết.

**(b) Lưu lượng tier code/fim — đây là lỗ ĐO LƯỜNG, không phải lỗ NHU CẦU.** `aiProgrammingCopilot.ts` gọi thẳng engine, **không bao giờ** đi qua `aiGateway.ts` — nơi thực sự ghi bảng; 6 lượt gọi thật (có lượt sinh ra mã thật) ⇒ **0 dòng**. Bảng thứ hai `ai_model_metrics` cũng **0 dòng**, không có nguồn thay thế trong DB (§1). ⇒ **Không được đọc "code/fim = 0 lượt" thành "code/fim ít được dùng".** Hệ quả cho quyết định hôm nay rất cụ thể: **trục lẽ ra dùng để kiểm chứng — hoặc bác bỏ — ưu tiên "nghiêng code" của chủ dự án đang câm.** Ưu tiên đó vì thế vẫn phải giữ đúng vai trò đã thống nhất: **quy tắc phá hoà khi số liệu ngang nhau**, không phải bằng chứng.

**(c) Điều trục lưu lượng CÓ nói được** (cột `task × model` đáng tin, dù cột số lượt thì không — xem 7.0): hôm nay model **general 30B chỉ phục vụ đúng hai việc: `report` (16 dòng) và `rca` (2 dòng)**; còn `chat` — trợ lý tri thức, mặt người dùng hỏi han nhiều nhất — **chạy bằng model 4B**, không phải 30B (§1 bảng Bước 3). Hai hệ quả:
- Bỏ model general 30B **không đụng tới trợ lý tri thức**; nó đụng tới **báo cáo điều hành và RCA**.
- Mà RCA thì **đang trả lời bằng tiếng Anh** (7.8 #3). ⇒ Phần lớn lập luận "giữ general vì tiếng Việt hay hơn" **dồn vào một mặt duy nhất: báo cáo điều hành**. Đây là bối cảnh quan trọng khi đọc §4.

⚠ **Nhưng lập luận vừa rồi có hạn sử dụng — nói rõ để không tự lừa mình** (bổ sung sau vòng review): nó **chỉ đúng chừng nào lỗi RCA-tiếng-Anh còn tồn tại**. Chính báo cáo này đề nghị vá lỗi đó (7.8 #3); **vá xong thì RCA trở lại là mặt sinh tiếng Việt thứ hai** và lý do "chỉ còn báo cáo điều hành" **hết hiệu lực**. ⇒ Nếu quyết định roster được đưa ra **trước** khi vá RCA, đừng dựa vào việc thu hẹp này như thể nó vĩnh viễn; hãy coi nó là **trạng thái tạm thời của hôm nay**.

### 7.5 Khuyến nghị — dạng ĐIỀU KIỆN, chờ §4

**Điều kiện 0 (mới ở vòng sửa 2, đứng TRƯỚC cả việc chọn roster): quyết định ngân sách cho sidecar thị giác.**
Đây không còn là chi tiết kỹ thuật — nó là **câu hỏi sản phẩm** mà chỉ chủ dự án trả lời được, và nó **chi phối cả ba nhánh dưới đây**. Với 7 821 MiB đo được (§7.1a), **không roster nào vừa** nếu tính năng thị giác được giữ nguyên như hôm nay. Ba đường đi, nêu đủ, không giấu cái nào:

| Đường | Cách làm | Cái giá | Trạng thái bằng chứng |
|---|---|---|---|
| **(i) Tắt hẳn thị giác** | Bỏ trống 1 trong 3 biến `LLAMA_SERVER_BIN` / `GGUF_VISION_MODEL` / `GGUF_VISION_MMPROJ` ⇒ mọi call site suy giảm trung thực | **Mất hẳn** mô tả/hỏi đáp ảnh kiểm tra + mô tả VL trong đường bất thường AOI (`aoiImageEmbeddingWorker.ts:322`) | ĐO: cơ chế tắt xác nhận bằng đọc mã 6 call site; **hậu quả nghiệp vụ chưa lượng hoá** |
| **(ii) Giữ thị giác, chấp nhận roster co lại khi có ảnh** | Không đổi gì; hiểu rằng khi sidecar thức, roster A **co từ 4 model xuống 2** (Coder-30B + embed = 23 357 MiB vừa khít 23 546 dư địa) | Mỗi lượt ảnh ⇒ 2 model bị đuổi ⇒ nạp lại **8 828 ms (nóng) / 40 969 ms (nguội)**; người dùng thấy "AI thỉnh thoảng đứng hình" | ĐO một phần: các delta đều đo thật; **chưa chạy kịch bản ảnh-xen-kẽ-chat để đo tần suất thật** |
| **(iii) Thu nhỏ sidecar** | Truyền `-np 1` thay vì để `n_parallel=auto`→4, và/hoặc hạ `LLAMA_VISION_CTX` | Log cho thấy 4 khe × ctx 8192 là phần đáng kể của 7 821 MiB ⇒ có thể tiết kiệm **vài GB** | **CHƯA ĐO** — và **cần sửa mã** (`llamaVisionSidecar.ts:208-217` không truyền `-np`; không có biến `.env` nào cho nó) ⇒ ngoài phạm vi Đợt 0 |

⚠ **Đường (iii) là đường có triển vọng nhất mà Đợt 0 KHÔNG đo được** — nêu ra để đợt sau nhặt, không phải để dựa vào hôm nay. **Đừng chọn roster dựa trên giả định (iii) sẽ thành công.**

**Điều kiện 1 áp cho mọi nhánh (không có ngoại lệ): vá race double-warm TRƯỚC khi đổi.** Không vá thì mọi roster có model 30B ở khe mặc định đều không nạp nổi qua đường boot app — đã đo **45/45 lượt lỗi** (§2), và mọi phép nghiệm thu sau khi đổi sẽ đo lỗi hạ tầng chứ không đo roster.

- **NẾU §4 cho thấy tiếng Việt của Coder-30B chấp nhận được** (không tệ đi đáng kể ở văn bản dành cho người vận hành) ⇒ **chọn roster A.**
  Lý do bằng số: một model 30B duy nhất, tổng 29 717 MiB **vừa** ngân sách và **giữ được đủ 4 model** (guard không kích hoạt — xem bảng 7.1); **không tier nào chậm đi một bậc độ lớn** như ở C. *(Sửa sau vòng review: bản đầu viết "không phải trả giá tốc độ ở bất kỳ tier nào" — sai với bảng. Khe general của A đo được 227,2 tok/s so với 277,4 của hiện trạng, tức thấp hơn ~18%. Nhưng chính roster A cho thấy **hai khe trỏ CÙNG MỘT FILE, trong CÙNG một lượt chạy** ra 227,2 và 268,3 — lệch 15,3%. Chênh lệch 18% vì thế **nằm trong khoảng dao động của chính phép đo**, không đủ căn cứ để khẳng định A chậm hơn thật; nhưng cũng không được nói "không trả giá gì".)* Đổi và quay lui bằng **một dòng `.env`**; đây cũng là nhánh rẻ nhất về công sức kỹ thuật.

- **NẾU §4 cho thấy chỉ model general viết tiếng Việt đủ tốt, và văn bản tiếng Việt cho người vận hành là thứ không nhân nhượng** ⇒ hai lựa chọn, theo thứ tự này:
  1. **B trước** — 29 741 MiB, cũng **một dòng `.env`**. ⚠ **Sửa sau vòng review — bản đầu nói ngược:** tôi viết B "nhiều khả năng sống qua boot ngay cả khi race chưa vá". **Sai.** Với model 4B thì **cả hai** lượt nạp chồng nhau đều **thành công**, và `loadedModels.set()` (`aiGgufEngine.ts:659`) ghi đè entry lượt trước **mà không `dispose()`** ⇒ **~3 474 MiB mồ côi**, `evictLRU()` không với tới được, chỉ khởi động lại tiến trình mới dọn. 29 741 + 3 474 = **33 215 > 32 607**. Khoản rò **lớn hơn toàn bộ dư địa 2 866 MiB của B**. ⇒ B chính là roster mà race **âm thầm ăn hết dư địa** — nghịch lý: model **nhỏ** mới rò, vì model 30B thì lượt sau thất bại nên không có lượt `set()` thứ hai. **Vá race là điều kiện bắt buộc của B, không phải tuỳ chọn.** Và bắt buộc **phải chấm 4B trước** — §4 chưa hề đo nó (7.4a).
  2. **C sau cùng** — giữ được đúng cả hai bộ não, đã đo trực tiếp 23 283 MiB. Ba cái giá phải nhìn thẳng: **(i)** model general 2,9 tok/s ⇒ **~3 phút cho 500 token** (7.2); **(ii)** **không đổi được bằng `.env`** — không tồn tại biến `gpuLayers`, phải sửa mã đường boot ⇒ **mất luôn đường quay lui một dòng**; **(iii)** mới đo **đúng một điểm** `gpuLayers=8/48` trong khi còn dư ~9,3 GB VRAM — **rất có thể có điểm cân bằng tốt hơn nhiều**, nên nếu chọn C thì việc đầu tiên là **quét dải** `gpuLayers` (12 / 16 / 24), không phải chốt ở 8.

- **NẾU §4 không phân biệt được rõ** (hai model ngang nhau, hoặc khác biệt không đáng kể với công việc thật) ⇒ **A**, đúng theo quy tắc phá hoà đã thống nhất từ đầu đợt.

- **Trong mọi trường hợp: KHÔNG giữ hiện trạng.** Kết luận này **không chờ §4** — xem cuối 7.1.

#### 7.5b 🟡 FIM (ghost-text) — CHỐT MỘT CÂU (giải mâu thuẫn ba chỗ, vòng sửa 2)

**Ba chỗ trong báo cáo này đang nói ba kiểu** — reviewer nêu đúng, tôi xác nhận bằng cách đọc lại chính mình:
- §5 "Khuyến nghị": *"số liệu ỦNG HỘ đổi về mặt độ trễ thuần"*;
- 7.3: *"không có lý do bằng số để từ chối đổi"*;
- 7.5 (bản đầu): **im lặng hoàn toàn**;
- 7.6 bước "Đổi": *"`GGUF_FIM_MODEL` (dòng 655) **không cần đụng**"*.

Chủ dự án đọc xong không biết mình có đang được đề nghị đổi hay không. **Chốt:**

> ### ✅ **CÓ — đổi `GGUF_FIM_MODEL` trỏ sang cùng file với `GGUF_CODE_MODEL` (Coder-30B), đổi CÙNG LÚC với việc đổi roster, không tách thành đợt riêng.**

**Ba lý do, theo thứ tự sức nặng:**

1. **Nó trả lại 1 774 MiB — khoản dư địa duy nhất còn tìm được, và Đợt 0 chưa bao giờ đưa nó vào bảng nào.** `loadGgufModel()` cache theo **basename file** (`aiGgufEngine.ts:593-599`), nên trỏ chung file = **không nạp thêm model nào**, không tốn thêm VRAM, cache-hit 0 ms. Đưa vào phép cộng (delta lấy từ `roster-A.json`: `fim=1774`, `roster-B.json`: `fim=1786`):

   | Roster | 4 model (bản đầu) | Bỏ khe FIM riêng | **+ sidecar 7 821** | So 32 607 |
   |---|---|---|---|---|
   | A | 29 717 | **27 943** | **35 764** | ❌ vẫn vượt **3 157** |
   | B | 29 741 | **27 955** | **35 776** | ❌ vẫn vượt **3 169** |

   ⚠ **Nói thẳng: 1 774 MiB KHÔNG cứu được A hay B.** Nó thu hẹp mức vượt từ 4 931 xuống 3 157 MiB — đáng làm, **nhưng không đủ**. Ai đọc bảng này để kết luận "vậy thì đổi FIM là xong" là đọc sai. Chỉ khi **cộng cả** đường (i) tắt thị giác **hoặc** (iii) thu nhỏ sidecar thì mới có roster vừa.

2. **Trục độ trễ không phản đối** — §5 đo TTFT thật: 39,5 ms (nhắc 153 tok) / 76,6 ms (533 tok), gợi ý 32 token trọn vẹn 148,6 / 187,8 ms. Ký tự đầu vẫn nằm trong vùng "tức thì" 0,1 s theo mốc Miller/Nielsen (7.3). Đắt hơn 1.5B thật (+26,3 / +49,8 ms) nhưng **không vượt mốc nào**.

3. **Nó bớt được một hộ tiêu thụ khỏi bảng kế toán** — ít model riêng = ít khả năng chạm trần `GGUF_MAX_LOADED_MODELS=4`, tức ít lần đi qua nhánh `"At capacity (4/4)"` (`:404`).

**Hai điều kiện kèm theo, không được bỏ:**
- **(a) Chỉ đổi nếu roster giữ Coder-30B thường trú** (A, B, hoặc C đều thoả). Nếu Coder-30B **không** thường trú thì lượt ghost-text đầu tiên phải nạp nguội — §3 đo **40 969 ms** cho đúng file này. Đó là phá hoại trải nghiệm, không phải cải thiện.
- **(b) Chưa đo tải đồng thời** (§5 mối lo 2): ghost-text và sinh mã dài dùng **chung một instance model, chung semaphore, chung một GPU**. Mức chậm thêm khi chúng chạy cùng lúc **chưa có số**. Đây là rủi ro đã biết, chưa lượng hoá — nghiệm thu sau khi đổi phải nhìn vào nó.

**Sửa kèm:** 7.6 bước "Đổi" (câu *"`GGUF_FIM_MODEL` không cần đụng"*) đã được sửa cho khớp quyết định này.

### 7.6 Việc phải làm khi đổi roster

**Trước khi đổi**
1. **Vá race double-warm** (7.8 #1) — nếu không, không có phép nghiệm thu nào sau đó có nghĩa.
2. Sao lưu `.env` **thủ công**: `cp .env .env.backup`. ⚠ **`.env` KHÔNG được git track** ⇒ `git diff --stat .env` luôn rỗng bất kể nội dung thật, và `git checkout -- .env` **lỗi im lặng, không hoàn nguyên gì** (bài học §2 — chính kế hoạch của đợt này đã vấp).
3. Ghi lại mốc truy hồi để so sau: `npm run kb:eval` → **151/151 = 1.000** (§6).

**Đổi (roster A hoặc B — đúng một dòng)**
```bash
# .env dòng 120 — roster A:
GGUF_DEFAULT_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf
# .env dòng 120 — roster B:
GGUF_DEFAULT_MODEL=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf
```
`GGUF_CODE_MODEL` (dòng 654) **không cần đụng** cho cả A lẫn B.

**`GGUF_FIM_MODEL` (dòng 655) thì CÓ — sửa ở vòng sửa 2** (bản đầu ghi "không cần đụng", chỏi với §5 và 7.3; nay đã chốt ở **7.5b**):
```bash
# .env dòng 655 — trỏ chung file với GGUF_CODE_MODEL, trả lại 1 774 MiB:
GGUF_FIM_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf
```
⚠ Chỉ làm bước này **nếu** roster đang chọn giữ Coder-30B thường trú (A/B/C đều thoả) — điều kiện (a) ở 7.5b. Quay lui: đặt lại `Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf`.

Roster C **không làm được bằng `.env`** — xem 7.5.

**Sau khi đổi — bốn chỗ ghim cứng tên model trong mã**

4. **`server/services/aiModelCard.ts:71 / 90 / 108 / 126`** — bốn tên model **ghim cứng** trong `PORTFOLIO_CARDS`. Đây không phải chú thích: nó là **hồ sơ quản trị model** (dấu vết minh bạch kiểu EU-AI-Act, xem header file), được liệt kê ra giao diện và **ghi ngược vào `ai_models.metadata`** qua `seedPortfolioCards()`. Gỡ một model khỏi `.env` mà quên đây ⇒ **hệ khai báo một model không còn tồn tại**, còn model đang thật sự chạy thì **không có hồ sơ nào**.
   ⚠ **Chỗ này đã lệch từ TRƯỚC Đợt 0**: catalog có card cho Instruct-30B / 4B / VL-8B / Embedding-0.6B / DINOv2, nhưng **không có card nào cho `Qwen3-Coder-30B` (đang là `GGUF_CODE_MODEL`) lẫn `Qwen2.5-Coder-1.5B` (đang là `GGUF_FIM_MODEL`)** — xác nhận: `grep -n "Coder" server/services/aiModelCard.ts` → **0 khớp**. Roster A và B đều biến Coder-30B thành model chính ⇒ **phải viết card cho nó**, không chỉ sửa tên card cũ.

5. **Quét lại toàn repo** (lệnh đúng như brief giao):
   ```bash
   grep -rnE '"Qwen[0-9A-Za-z.-]*(30B|4B|8B|1\.5B|0\.6B)[^"]*"' --include=*.ts server/ client/ | grep -v test
   ```
   Kết quả chạy hôm nay: **5 khớp, trong đó chỉ 4 là ghim cứng thật** — `aiModelCard.ts:71/90/108/126`, cộng `server/services/aiCostModel.ts:17` (chỉ là ví dụ trong chú thích, vô hại).

6. **Quét rộng hơn lệnh brief** (thêm `.tsx`/`.mjs`, thêm `scripts/`) tìm được **4 chỗ nữa** — không chặn roster A/B nhưng phải biết:
   - `scripts/ai-kb/ingest-manuals.mjs:50` — `const EMBED_MODEL = "Qwen3-Embedding-0.6B-f16"` **ghim cứng, không đọc env**. Nếu sau này đổi `GGUF_EMBED_MODEL` mà quên đây, kho tri thức mới sẽ bị **đóng dấu sai tên model** — đúng loại lỗi mà §6 chứng minh là **không thể phát hiện được** (hai không gian nhúng cùng 1024 chiều, cosin 0,024).
   - `scripts/ai-kb/embed-programming.mjs:35` và `scripts/ai-kb/eval-rag.mjs:215` — fallback `|| "Qwen3-…"` khi biến môi trường vắng: **lặng lẽ dùng model cũ thay vì báo lỗi**.
   - `client/src/pages/AIBrainDashboard.tsx:78` — chữ hiển thị "Vision (Qwen2.5-VL)" trong khi `.env:142` là `Qwen3-VL-8B`: **màn hình đang nói sai tên model với người dùng, sai từ trước Đợt 0**.

**Nghiệm thu sau khi đổi**
7. `npm run kb:eval` — so với mốc **151/151**. Thấp hơn = hỏng truy hồi (§6 đã chứng minh phép đo này **nhạy thật**: ép sai embedder thì tụt còn 56/151).
8. `nvidia-smi` sau khi hệ ổn định — và **quan trọng hơn: soi log máy chủ tìm BỐN dòng cảnh báo**.
   *(Sửa 2 lần: vòng 1 gỡ một khuyến nghị có hại — xem 7.9; vòng 2 bổ sung 3/4 dòng còn thiếu — xem 7.10.)*
   **Đừng hạ `GGUF_MAX_LOADED_MODELS`**: hạ xuống 3 chỉ **ép** một lượt đuổi, tức tự trả đúng cái giá 8 828-40 969 ms mà nó định tránh.

   ⚠ **Bản đầu chỉ dặn canh MỘT dòng. Thực có BỐN**, tất cả cùng một họ "hệ vừa âm thầm xoay xở, không ai báo cho bạn". Đọc mã `aiGgufEngine.ts:346-436` + `:620-645`. Canh đủ cả bốn — **lệnh gợi ý**:
   ```bash
   grep -nE "ran out of VRAM|no idle model to evict|At capacity \(|evicted LRU model" <log-may-chu>
   ```

   | # | Dòng log (nguyên văn, rút gọn) | Vị trí | **Nghĩa là gì — và phải làm gì** |
   |---|---|---|---|
   | **1** | `<model>: full GPU offload ran out of VRAM — freeing idle models and retrying with gpuLayers:"auto" (partial offload, CPU fallback for the rest).` | `:636` | **Nặng nhất về hậu quả.** Một tier vừa **âm thầm tụt xuống tốc độ kiểu roster C** (§7.2: vài giây → vài phút). Không lỗi, không tín hiệu giao diện. ⇒ Roster đang chọn **không thực sự vừa**. |
   | **2** | `VRAM guard: used X/Y MB (Z%) ≥ 90% but no idle model to evict — deferring/allowing load with OOM risk.` | `:358` | **Nguy hiểm nhất về cơ chế: hệ biết sắp OOM và VẪN CHO NẠP.** Xảy ra khi mọi model đều `refCount>0` **hoặc** khi thứ chiếm chỗ là **sidecar thị giác** — thứ `evictLRU()` không với tới được (§7.1a). Thấy dòng này = đang chạy trên may rủi. |
   | **3** | `At capacity (4/4) but all models are in use (refCount>0); allowing temporary overflow.` | `:404` | **Đáng lo riêng cho A và B vì chúng chạy ĐÚNG ở trần 4/4** (`GGUF_MAX_LOADED_MODELS=4`) ⇒ hệ **thường trực sát trần**, mỗi lượt nạp thứ 5 (kể cả nạp lại model vừa bị đuổi) đều đi qua đây. Tần suất cao = roster quá chật, cân nhắc bỏ khe FIM riêng (7.5b). |
   | **4** | `VRAM guard: used X/Y MB (Z%) ≥ 90% — evicted LRU model "<M>" before loading.` *(kèm `Evicted LRU model: <M>` ở `:388`)* | `:364` / `:388` | Guard **đã kích hoạt và đuổi được** — đỡ hơn #2, nhưng model bị đuổi sẽ phải **nạp lại 8 828-40 969 ms**. Vài lần/ngày = bình thường; liên tục = roster đang thrash. |

   ⚠ **Bốn dòng này đều là `console.warn`/`console.log` — không phải lỗi, không vào bảng nào, không lên giao diện.** Nếu log máy chủ không được thu gom thì **cổng nghiệm thu này vô hiệu**. Đây chính là lớp "hỏng im lặng" mà cả Đợt 0 đang đuổi.
   ⚠ **Và phải nghiệm thu VỚI ảnh đi qua**, không chỉ chat/code: mở một lượt hỏi đáp ảnh kiểm tra (hoặc chờ một lượt bất thường AOI tự kích hoạt) rồi mới đọc log — nếu chỉ thử tier chữ, sidecar không thức và **bốn dòng trên sẽ im lặng một cách giả tạo** (§7.1a).

**Quay lui — đúng một dòng**
```bash
# .env dòng 120 — trả về nguyên trạng, khởi động lại app là xong:
GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf
```
⚠ Nếu đã sửa `aiModelCard.ts` ở bước 4 thì phải hoàn tác **cả chỗ đó** — file ấy là **mã**, không phải cấu hình, nên một dòng `.env` không kéo nó về theo.

### 7.7 Giới hạn của chính khảo sát này

1. **Lưu lượng là DỰNG, không phải sản xuất.** 20/38 dòng do agent chủ động gọi trong một phiên ~20 phút; tỉ lệ giữa các tier là tỉ lệ **tôi chọn gọi**, không phải nhu cầu thật (§1).
2. **Tier code/fim về nguyên tắc không đo được** bằng hạ tầng hiện có (7.4b) — trục đáng lẽ liên quan nhất tới ưu tiên "nghiêng code" thì không có dữ liệu.
3. **Trục tốc độ chỉ định hướng** (7.0). Roster C chỉ đo **một điểm** `gpuLayers=8/48`; chưa quét dải nên **chưa biết điểm cân bằng tốt nhất của C**. ⚠ **Nâng mức ở vòng sửa 2:** sau khi cộng sidecar, C là roster **duy nhất** mà cấu hình chính (2 model lớn, 23 283 + 7 821 = 31 104 = **95,4%**) còn **vừa** — nhưng chỉ vừa **1 503 MiB**, và **vỡ ngay** nếu giữ thêm khe `fim`/`embed` (38 506). ⇒ Việc **quét dải `gpuLayers`** (12/16/24) chuyển từ "tuỳ chọn nếu chọn C" thành **việc BẮT BUỘC nếu C lên bàn** — biên 1 503 MiB quá mỏng để chốt trên một điểm đo duy nhất.
4. **Máy đã nâng cấp phần cứng** (i7-12700KF/20 luồng/47,8 GB → i9-12900K/24 luồng/63,8 GB) giữa baseline 05/07 và nay ⇒ tok/s tuyệt đối **không so ngang hàng** với baseline cũ; VRAM thì so được (§3).
5. **Cột "load ms" trong bảng §3 bị chi phối bởi cache của hệ điều hành**, không phải bởi roster: cùng một file, lần đọc đầu 40 969 ms, lần sau 8 828 ms (§3 M-1).
6. **KV cache cho model 30B: KHÔNG đo được** — trọng số không nạp nổi qua đường app, phải đo thay bằng model 4B (§2). ⇒ Câu hỏi "còn dư bao nhiêu chỗ cho ngữ cảnh dài ở roster A/B/C" **chưa có số**.
7. **Roster C chưa từng chạy qua đường boot app** (đo bằng script import thẳng module) ⇒ chưa biết nó có sống nổi qua khởi động thật hay không.
8. **§4 không đo model 4B** ⇒ roster B chưa có bằng chứng chất lượng nào (7.4a).
9. **§5 có n=5/kịch bản** — đủ thấy xu hướng, **không đủ tính p95**; và mọi số là best-case (GPU rảnh, không tải đồng thời, không tính mạng/HTTP).
10. **Không đo kịch bản tải đồng thời thật** — mức chậm thêm khi ghost-text và sinh mã chạy cùng lúc trên một GPU **chưa đo** (§5).
11. **Chỉ khảo sát các model đã có sẵn trên đĩa** (ràng buộc "không tải model mới"). Việc có model nào ra đời sau **05/2026** phù hợp hơn hay không — **agent không biết**, chủ dự án cần tự xác nhận trước khi chốt lâu dài.
12. **Ngưỡng UX ở §5 là giả định không nguồn**; mục 7.3 đã thay bằng chuẩn có nguồn, nhưng chuẩn đó là chuẩn giao diện **tổng quát**, không phải chuẩn riêng cho gợi ý mã, và không đo trên hệ này.

**Bổ sung ở vòng sửa 2:**

13. **Ba mức lưu giữ bằng chứng — nay đã thống nhất, nhưng phải biết mức nào là mức nào.** Ba mục ngang hàng của báo cáo này trước đây lưu bằng chứng ba kiểu khác nhau; đã xử lý như sau:
    | Mục | Trạng thái trước | Nay |
    |---|---|---|
    | §3 (bench 3 roster) | 3 file `roster-*.json` **đã commit** | không đổi ✔ |
    | §5 (TTFT FIM) | 2 file có trên đĩa nhưng **untracked** | **đã commit** trong đợt sửa này ✔ |
    | §2 (đường race-free) | trích 2 đường dẫn JSON **KHÔNG TỒN TẠI** | **đã gỡ đường dẫn**, ghi rõ "output nguyên văn, JSON không giữ lại" + lệnh dựng lại ✔ |
    | §7.1a (sidecar) | — | **output nguyên văn + lệnh đầy đủ trong báo cáo**; tiến trình đo là tạm thời, không sinh JSON ⇒ dựng lại bằng đúng lệnh đã ghi |
    ⇒ Nguyên tắc rút ra cho đợt sau: **hoặc commit file thô, hoặc ghi lệnh dựng lại — nhưng đừng bao giờ trích một đường dẫn mà không kiểm nó còn tồn tại.**

14. **🟡 `aiReranker` — hộ tiêu thụ GPU thứ tư, cách một dòng `.env`, và báo cáo này chưa từng nhắc tên nó.** `.env:408 RAG_RERANKER_ENABLED=true` + `.env:412 RAG_RERANKER_MODE=gguf` ⇒ **đang bật**. `aiReranker.ts:361` tự gọi `llama.loadModel({ modelPath, gpuLayers: useGpu ? -1 : 0 })` — **bypass cả semaphore `withGgufSlot()` lẫn bảng `loadedModels`**, đúng cùng lớp mù với sidecar thị giác (§7.1a): model chạy **ngoài kế toán của `aiGgufEngine`**, nên `evictLRU()` không thấy, còn `readVramState()` thì vẫn tính vào guard. **An toàn hôm nay CHỈ NHỜ `.env:416 RAG_RERANKER_GPU=false`** (nạp trên CPU, `gpuLayers: 0`) — đổi đúng một dòng đó là có ngay hộ tiêu thụ VRAM thứ tư không ai kế toán. ⚠ **Trước khi đổi roster, kiểm `RAG_RERANKER_GPU` vẫn là `false`**; nếu ai đó bật lên thì mọi phép cộng VRAM trong báo cáo này phải làm lại. **Chưa đo** VRAM của nó (chưa từng chạy ở chế độ GPU).

15. **Sidecar thị giác: đo được phần thường trú, CHƯA đo phần vận hành.** §7.1a đo chắc chắn 7 821 MiB (thường trú) / 7 920 MiB (đỉnh 1 ảnh). **Chưa đo:** (a) nhiều ảnh đồng thời — `n_parallel=4` nghĩa là 4 lượt song song **có thể** đẩy cao hơn; (b) ảnh độ phân giải lớn hơn ảnh thử 227 KB; (c) mức tiết kiệm thật của `-np 1` (đường (iii) ở 7.5) — **chưa thử, cần sửa mã**; (d) tần suất thức/ngủ thật trên dây chuyền chạy thật. ⇒ 7 821 MiB là **sàn dưới đáng tin**, không phải trần.

### 7.8 ⚠ Ngoài phạm vi — bốn thứ Đợt 0 tìm ra mà không ai cử nó đi tìm

Đây có thể là phần giá trị nhất của cả đợt. **Cả bốn đều đã được xác minh độc lập (ít nhất hai người đọc mã / chạy lại). CHƯA CÁI NÀO ĐƯỢC VÁ** — đúng ràng buộc "đợt này chỉ đo".

Tiêu chí xếp hạng: **(a)** đang xảy ra hôm nay hay chưa · **(b)** người dùng có tự phát hiện được không · **(c)** mức hại khi xảy ra. Chủ dự án hoàn toàn có thể xếp lại nếu đánh giá trọng số khác.

**#1 — Race điều kiện double-warm khiến app không nạp nổi model 30B.** `aiGgufEngine.ts:1066-1098` và `aiLocalKnowledgeService.ts:2392-2418` là **hai nơi độc lập** cùng gọi `warmModel(GGUF_DEFAULT_MODEL)` lệch nhau 1 giây, trong khi `loadGgufModel()` **không có khoá** cho model đang nạp dở ⇒ hai lượt nạp cùng một file 17 GB đụng nhau ⇒ `cudaMalloc failed`. **Tái hiện 100% mọi lần boot mặc định** (45/45 lượt trong đợt này).
> *Hậu quả cho người dùng thật:* **mỗi lần khởi động lại máy chủ, bộ não lớn không lên** — báo cáo điều hành, phân tích nguyên nhân gốc, hỏi đáp khó và sinh mã PLC đều hoặc lỗi, hoặc âm thầm rơi xuống model nhỏ; người dùng chỉ thấy "AI không trả lời" hoặc trả lời kém, **không thấy lý do**. Đây cũng chính là thứ đã làm hỏng phép đo evict của chính Đợt 0.
>
> ⚠ **Lỗi này có mặt thứ hai, tệ hơn, phát hiện ở vòng review Task 7 — với model NHỎ nó không lỗi mà RÒ:** khi cả hai lượt nạp cùng thành công (model đủ nhỏ, ví dụ 4B), `loadedModels.set()` (`aiGgufEngine.ts:659`) ghi đè entry lượt trước **mà không `dispose()`** ⇒ bản sao thứ nhất **mồ côi trong VRAM**, không còn handle JS nào, `evictLRU()` **không với tới được**, **chỉ khởi động lại tiến trình mới dọn**. Với roster B, khoản rò ~3 474 MiB **lớn hơn toàn bộ dư địa VRAM của roster đó** (7.5). ⇒ Đợt vá phải xử lý **cả hai mặt**: khoá in-flight *và* dọn bản bị ghi đè.

**#2 — KB Studio: lỗ hổng kép, đang bật, có dữ liệu thật.** `kb_studio_chunks` **không có cột nào lưu định danh model đã nhúng** và truy vấn **không lọc theo model**; đã vậy nhánh dự phòng của `searchCorpus()` dùng hàm `cosine()` **cắt ngắn rồi so** (`Math.min(a.length, b.length)`) nên **không kiểm cả số chiều**. §6 đã đo: hai model nhúng khác nhau đều ra **1024 chiều** nhưng **cosin giữa chúng = 0,024** — gần như trực giao. Bug `cosine()` này có **bản song sinh giống byte-for-byte ở hai file tên gần trùng** (`server/services/kbVectorStore.ts:236-245` đang sống, `server/services/kb/kbVectorStore.ts:33-42` đang ngủ) — chính lượt điều tra đầu tiên của Đợt 0 đã sửa hụt vì đọc nhầm file.
> *Hậu quả cho người dùng thật:* nếu kho từng được nhúng bằng một model rồi tìm bằng model khác, **ô tìm kiếm vẫn trả về kết quả trông hợp lệ nhưng thực chất là nhiễu ngẫu nhiên, không một cảnh báo nào** — kỹ thuật viên tra sổ tay bảo trì và nhận về đúng-hình-thức-sai-nội-dung. Xếp #2 vì **không ai phát hiện được**, và vì **chính hành động đổi model đang bàn ở đây là thứ kích hoạt nó**.

**#3 — RCA copilot sinh câu tiếng Anh cho người vận hành Việt Nam.** `aiRcaCopilot.ts` — `synthesize(input, lang, ev)` **nhận tham số `lang` nhưng không hề tham chiếu nó trong thân hàm**; toàn bộ `sys` và `userPrompt` là tiếng Anh, không có nhánh ngôn ngữ nào. Trong lượt sinh thật của §4, **cả hai model đều trả lời tiếng Anh**.
> *Hậu quả cho người dùng thật:* khi dây chuyền dừng, người vận hành mở phân tích nguyên nhân gốc ra và **đọc một đoạn tiếng Anh** — chậm xử lý, hoặc hiểu sai. Đang xảy ra ở **mọi lượt**. Đây là **cùng lớp lỗi mà Sprint 5 vừa dọn 48 khoá i18n**, nhưng nằm ở **tầng prompt** nên **không cổng kiểm nào của Sprint 5 chạm tới được**.

**#4 — Toàn bộ đường sinh mã / gợi ý mã vô hình với hệ đo lường.** `aiProgrammingCopilot.ts` gọi thẳng engine (dòng 372/390/440/458/771/807), **không bao giờ** qua `aiGateway.ts` — nơi thực sự ghi `ai_gateway_metrics`. 6 lượt gọi thật, có lượt sinh ra mã thật ⇒ **0 dòng**; bảng thay thế `ai_model_metrics` cũng **0 dòng**.
> *Hậu quả cho người dùng thật:* không hại trực tiếp, nhưng **mọi quyết định về model dành cho lập trình viên đều đang bay mù** — kể cả quyết định đang bàn trong chính báo cáo này (7.4b). Cùng lớp "đường giao hàng đứt" mà Sprint 5 đuổi ở tầng hiển thị, chỉ khác là ở **tầng quan sát**.

**Không mục nào ở trên được vá trong Đợt 0** — đúng ràng buộc "chỉ đo, không sửa". Cả bốn đều nên thành đầu vào cho đợt kế tiếp, và **#1 là điều kiện tiên quyết của chính việc đổi roster** (7.5).

### 7.9 Vòng sửa 1 (review)

Reviewer truy **từng con số** của §7 về §1-§6/sổ tiến độ và tự tính lại mọi phần trăm, phép cộng, phép quy đổi thời gian — **không ô nào lệch**. 1 Critical + 2 Important + 4 Minor, **tất cả đã xử lý**; tôi **tự đọc mã kiểm chứng lại từng khẳng định của reviewer** trước khi sửa, không sửa cho qua.

- **Critical — suy luận về ngưỡng VRAM đúng phép tính nhưng SAI CƠ CHẾ, và nó đảo ngược kết luận cho A và B.** Bản đầu: A (91,1%) và B (91,2%) vượt `GGUF_VRAM_GUARD_PCT=90` nên "engine nhiều khả năng vẫn đuổi LRU". **Sai.** Tự kiểm chứng bằng đọc mã: `enforceVramGuard()` (`aiGgufEngine.ts:346`) chỉ tới được từ `ensureCapacity()` (dòng 435), `ensureCapacity()` có **đúng một** call site (dòng 607) và chạy **TRƯỚC mỗi lượt nạp**; cả file **không có `setInterval`** (đã grep) ⇒ **không tồn tại thời điểm nào guard đọc được con số 91%**. Guard so **mức đang dùng hiện tại** và **không biết kích thước model sắp nạp** — chú thích mã dòng 620-627 nói đúng như vậy. Tự tính lại mức guard đọc được ở **thứ tự bất lợi nhất** (model nhỏ nhất nạp sau cùng): A = (29 717 − 1 774)/32 607 = **85,7%**, B = (29 741 − 1 786)/32 607 = **85,7%** ⇒ **dưới 90%, guard không kích hoạt lần nào; A và B giữ đủ 4 model.** Khuyến nghị đính kèm ("hạ `GGUF_MAX_LOADED_MODELS` xuống 3") còn tệ hơn — nó **ép** một lượt đuổi mà bình thường không xảy ra, tự trả đúng cái giá 8 828-40 969 ms mà nó muốn tránh — **đã gỡ bỏ**. Thay vào đó là rủi ro **thật** mà reviewer tìm ra và tôi xác nhận bằng đọc mã: guard **không bảo vệ** phần dư, và khi vượt thật thì nhánh `catch` (dòng 620-645) **đuổi sạch model rảnh rồi lặng lẽ nạp lại với `gpuLayers:"auto"`** ⇒ tier đó **âm thầm tụt xuống tốc độ kiểu roster C**, chỉ để lại một dòng `console.warn`. Đã viết lại hàng bảng 7.1, thêm đoạn cảnh báo dưới bảng, và đổi hẳn bước 8 của 7.6 thành "canh dòng cảnh báo đó".
  **Bài học:** tôi suy cơ chế từ **hằng số cấu hình** (`GGUF_VRAM_GUARD_PCT=90`) mà **không đọc hàm dùng nó** — đúng loại lỗi mà cả đợt này liên tục bắt được ở người khác.
- **Important 1 — roster B: race chưa vá thì RÒ MỘT BẢN SAO MODEL, tôi kết luận ngược.** Bản đầu suy luận B "nhiều khả năng sống qua boot dù race chưa vá" vì 2 × 4B ≈ 7 GB vẫn vừa. Phép tính đúng, nhưng bỏ sót bước sau đó: `loadedModels.set()` (dòng 659) là **vô điều kiện** — không kiểm tra entry cũ, không `dispose()` (tự đọc xác nhận). Với 4B thì **cả hai lượt nạp đều thành công**, lượt sau ghi đè lượt trước ⇒ **~3 474 MiB mồ côi** mà `evictLRU()` (chỉ duyệt `loadedModels`) không với tới được. B thành 29 741 + 3 474 = **33 215 > 32 607**; khoản rò **lớn hơn cả dư địa 2 866 MiB của B**. ⇒ B không phải roster miễn nhiễm với race, nó là roster **bị race âm thầm ăn hết dư địa**. Đã sửa hàng bảng 7.1, nhánh B của 7.5, và bổ sung mặt thứ hai này vào 7.8 #1.
- **Important 2 — tiền đề tự huỷ.** 7.4(c) dùng lỗi RCA-sinh-tiếng-Anh để thu hẹp lý do giữ model general, trong khi 7.8 lại đề nghị vá chính lỗi đó. Đã thêm cảnh báo: lập luận ấy **chỉ đúng chừng nào lỗi còn tồn tại** và **hết hiệu lực khi vá**.
- **M-1 — bảng thiếu 2/6 trục brief đòi.** Đã thêm hàng **số lần evict** và hàng **KV headroom**. Riêng "0 evict" được ghi rõ là **bẫy đọc**: nó bằng 0 vì không model 30B nào nạp nổi để mà đuổi, kèm cơ chế khớp log (entry chỉ vào `loadedModels` **sau khi** nạp xong ⇒ hai racer đang nạp dở thì bảng rỗng, `evictLRU()` không có gì để đuổi).
- **M-2 — "A không trả giá tốc độ ở tier nào" mâu thuẫn với chính bảng** (227,2 vs 277,4). Đã sửa, và nêu đủ bối cảnh: chính roster A cho thấy hai khe **trỏ cùng một file, cùng một lượt chạy** ra 227,2 và 268,3 (lệch 15,3%) ⇒ chênh 18% nằm trong dao động của phép đo, không đủ để khẳng định A chậm hơn thật — nhưng cũng không được nói "không trả giá".
- **M-3 — trích 40 969 ms mà bỏ 8 828 ms.** Đã nêu đủ cả hai đầu (nguội/nóng) ở mọi chỗ trích.
- **M-4 — §7 sửa thầm số dòng của §1.** §1 ghi lời gọi engine cuối của `aiProgrammingCopilot.ts` ở dòng **801**, §7 ghi **807**. Tự kiểm: dòng 801 là `route({ task: "fim" … })` (bộ định tuyến, **không** phải lời gọi engine), dòng 807 mới là `await generateFim(`. **§7 đúng, §1 sai** — nay nói ra thay vì sửa lặng lẽ. (Không sửa §1: mục đó là bản ghi của Task 1, đính chính ở đây là đủ.)
- **Nốt trung lập:** đã bỏ ý "trùng ưu tiên nghiêng code" khỏi nhánh A của 7.5 — nhánh đó **không phải thế hoà** nên viện dẫn quy tắc phá hoà ở đó là thừa và hơi nghiêng. Ưu tiên "nghiêng code" nay chỉ còn xuất hiện đúng chỗ của nó: nhánh "không phân biệt được rõ" (7.5) và mục nói về trục lưu lượng đang câm (7.4b). Cụm "cấu hình không chạy được" ở cuối 7.1 cũng đã đổi thành phát biểu chính xác hơn: **không thể giữ cả hai 30B cùng thường trú** (đo trực tiếp) **và** không nạp nổi 30B qua **đường boot hiện tại** (45/45).

Không sửa mã sản xuất, không sửa `.env`, **không vá** race/RCA/KB Studio trong vòng này — chỉ đọc thêm 4 vùng mã để kiểm chứng và sửa văn bản báo cáo.

Bản đầy đủ (bảng nguồn từng ô, output nguyên văn các lệnh quét, phép cộng chi tiết): `.superpowers/sdd/2026-08-01-do0-model-roster-survey/task-7-report.md` (không commit — `.superpowers/sdd/*` bị `.gitignore` chặn).

### 7.10 Vòng sửa 2 (review toàn nhánh — cổng cuối trước bàn giao)

Reviewer độc lập đọc toàn nhánh 15 commit. **Ràng buộc "chỉ đo" xác nhận giữ trọn vẹn** (0 dòng mã sản xuất, 3 phát hiện CẤM VÁ còn nguyên, `.env` sạch). **1 Critical + 3 Important + 3 Minor phải xử lý** — tất cả đã xử lý dưới đây; tôi **tự đo lại và tự đọc mã** cho từng mục, không chép số reviewer.

- **🔴 CRITICAL — sidecar thị giác vắng mặt khỏi MỌI phép cộng VRAM của cả đợt.** Đã xử lý bằng **phép đo trực tiếp**, không dùng ước lượng: khởi `llama-server` với đúng args sản xuất, `nvidia-smi` trước/sau ⇒ **7 821 MiB thường trú / 7 920 MiB đỉnh khi suy luận thật** (§7.1a). ⚠ **Số thật cao hơn ước lượng của reviewer (~6 330) tới 1 490 MiB** — nguyên nhân truy được từ log: sidecar không truyền `-np` nên `llama-server` tự chọn **4 khe song song × ctx 8192**, cộng buffer mtmd 1 502 MiB. Đã: thêm 3 hàng vào bảng 7.1, **cộng lại toàn bộ ba roster** (A vượt **4 931**, B vượt **4 955**, C-4-model vượt **5 899**), sửa phân tích guard (sidecar **đếm vào** `readVramState()` vì nó đo toàn thiết bị, nhưng `evictLRU()` **không đuổi được** vì khác tiến trình), và trả lời bằng mã ba câu hỏi "tắt được không / thường trú không / có tính vào ngân sách không".
  **Đã xem lại kết luận cuối và ĐỔI, không cứu:** câu "A và B vừa 32,6 GB" của bản trước **bị rút**. Mức vượt của A/B nay **lớn hơn chính 4 060 MiB** đã dùng để kết án hiện trạng ⇒ **không roster nào vừa một cách vô điều kiện**, và 7.5 có thêm **Điều kiện 0** (quyết ngân sách thị giác) đứng **trước** việc chọn roster. Khuyến nghị "chọn A" vì thế **yếu đi thật** — nói thẳng thay vì giữ nguyên độ mạnh cũ.
  **Bài học:** đúng lớp lỗi §7 tự rút ở vòng 1 (*"suy cơ chế từ hằng số cấu hình mà không đọc hàm dùng nó"*) — lần này chính §7 đã **grep ra** `LLAMA_VISION_GPU_LAYERS` (hàng "đổi được bằng một dòng `.env`?") rồi **gạt đi như kết quả không liên quan**, thay vì đi thêm một bước tới `llamaVisionSidecar.ts` hỏi "cái này ăn bao nhiêu VRAM?".
- **🟠 IMPORTANT 1 — checklist canh log thiếu 3/4 dòng.** 7.6 bước 8 dặn canh **một** dòng; thực có **bốn** (`:636`, `:358`, `:404`, `:364`+`:388`). Đã lập bảng đủ bốn, **nêu rõ dòng nào nghĩa là gì và phải làm gì**, kèm lệnh `grep` gộp. Hai dòng nguy nhất: `:358` (*"no idle model to evict — deferring/allowing load with OOM risk"* — hệ biết sắp OOM và **vẫn nạp**) và `:404` (*"At capacity (4/4)"* — **A và B chạy đúng ở trần đó**). Thêm cảnh báo: **phải nghiệm thu với ảnh đi qua**, không thì sidecar không thức và bốn dòng im lặng giả tạo.
- **🟠 IMPORTANT 2 — phân tích guard là trạng thái TĨNH nhưng phát biểu vô điều kiện.** §3 tự ghi **+470-940 MiB/model lúc sinh** và `.env:125 GGUF_MAX_CONCURRENCY=4` cho phép 4 lượt sinh đồng thời. Đã thêm bảng: 4 model + 2 lượt sinh ⇒ **94-97%**; + 4 lượt sinh ⇒ **97-103%**. Câu 85,7% nay có điều kiện tường minh: *"ở trạng thái tĩnh VÀ khi sidecar đang ngủ"*.
- **🟠 IMPORTANT 3 — ba mức lưu bằng chứng khác nhau.** §2 trích **2 file JSON không tồn tại** (đã gỡ, thay bằng "output nguyên văn, JSON không giữ lại" + lệnh dựng lại); §5 có file nhưng **chưa commit** (**nay đã commit**); §3 đã commit (không đổi). Bảng đối chiếu ở **7.7 #13**.
- **🟡 M-1 — §1 vẫn ghi dòng 801.** Tự đọc `sed -n '798,810p'`: **801 = `route({task:"fim"})`** (định tuyến), **807 = `await generateFim(`**. §7 đúng, §1 sai. **Đã sửa §1** (trước đây cố ý để nguyên và chỉ đính chính ở 7.9 M-4 — reviewer đúng khi nói để số sai trong tài liệu bàn giao là không chấp nhận được).
- **🟡 M-2 — `vision` ghi `model='default'`: NÂNG MỨC.** Không còn là phiền toái nhãn mác: đó chính là **lý do không ai nhìn thấy một model 8B đang cư trú trên GPU suốt cả đợt**. Đã nối thẳng nó với phát hiện Critical ở §1 Mối lo #3.
- **🟡 M-3 — `aiReranker` không xuất hiện lần nào trong báo cáo giao chủ dự án.** Đã thêm **7.7 #14**: đang bật, mode `gguf`, `aiReranker.ts:361` bypass cả semaphore lẫn `loadedModels`, **an toàn hôm nay chỉ nhờ `RAG_RERANKER_GPU=false`** — cùng họ với sidecar.
- **🟡 Mâu thuẫn FIM (chưa ai nêu) — ba chỗ nói ba kiểu.** §5/7.3 "ủng hộ đổi", 7.5 im lặng, 7.6 "không cần đụng". Đã **chốt một câu ở 7.5b: CÓ, đổi**, đưa khoản **1 774 MiB** vào phép cộng lần đầu tiên — **và nói thẳng nó KHÔNG cứu được A/B** (vượt 4 931 → 3 157, vẫn vượt). Đã sửa 7.6 cho khớp.

**Không sửa mã sản xuất, không sửa `.env`, không vá race/RCA/KB Studio.** Phép đo sidecar chạy trên **tiến trình `llama-server` riêng** (được phép — không phải app), đã tắt sạch: VRAM **1 239 → 9 060 → 1 233 MiB**, không tiến trình treo, file tạm đã dọn.

Bản đầy đủ đợt sửa cuối: `.superpowers/sdd/2026-08-01-do0-model-roster-survey/final-fix-report.md` (không commit).
