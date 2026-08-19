# 79 — Nâng `/ai-coding-workspace` thành công cụ code chuyên (như Claude Code) + verify AI local

> **Trạng thái:** BẢN NHÁP CHỜ DUYỆT · 2026-08-19
> Chủ dự án yêu cầu: *"nâng cấp ai-coding-workspace thành chức năng chuyên code như Claude Code, có
> quản lý dự án/folder; ngoài ra kiểm tra AI local có thực sự chạy được, dùng Playwright verify."*

---

## 0. KẾT QUẢ VERIFY (Playwright, tài khoản engineer THẬT, cổng 3000 live) — ĐỌC TRƯỚC

**Tôi tự chụp + tự đọc ảnh, không tin subagent.** Kết luận thẳng:

> **Giao diện + hộp cát CHẠY THẬT, nhưng hội thoại tác nhân KHÔNG kích hoạt 5 tool lập trình —
> nó rơi vào đường RAG VẬN HÀNH.**

Bằng chứng:
- **Chạy được**: cây tệp hiện repo thật (`list_files` qua tRPC trực tiếp), trình xem mở
  `AI_ANALYTICS_ACTION_ITEMS.md` → 12.519 B thật, click `.gitignore` → hộp cát từ chối đúng lý do.
- **KHÔNG chạy như tác nhân lập trình**: hỏi *"đọc server/routers.ts và tóm tắt"* → trả lời
  *"Trong tài liệu hiện tại tôi không có thông tin… liên hệ kỹ sư kỹ thuật"* (câu của trợ lý VẬN
  HÀNH). Hỏi lại rõ hơn *"dùng read_file đọc server/routers.ts"* → trả về **5 chunk RAG** từ
  `knowledge/`+`docs/`, KHÔNG đọc tệp thật, KHÔNG gọi tool.

### Gốc rễ — BA yếu tố cùng chặn (đã truy mã):
1. **Triggers hẹp.** `read_file`/`list_files`/`grep_repo` có triggers heuristic (`"đọc mã nguồn"`…)
   nhưng KHÔNG phủ hình dạng câu hỏi lập trình tự nhiên (*"đọc `server/routers.ts`"*). Bộ trích
   `REPO_PATH_REGEX` nhận đúng đường dẫn nhưng chỉ chạy **SAU** khi tool đã được chọn — không có
   shortcut *"thấy đường dẫn repo ⇒ chọn read_file"*.
2. **`AI_TOOL_LLM_FALLBACK=0`.** Tôi tự tắt ở G1 vì đo được false-positive **92,3%** cho tool VẬN
   HÀNH. Đúng cho vận hành, nhưng nó cũng chặn LLM chọn tool LẬP TRÌNH khi heuristic trượt.
3. **Cùng đường, cùng persona.** Workspace dùng CHUNG `/api/ai/local-kb/stream` → `streamAnswer`
   với **trợ lý VẬN HÀNH nhà máy**. `context` chỉ truyền `route`/`uiLanguage`/`selectedMachineCode`
   — **không có cờ "phiên lập trình"**. Nên system prompt vẫn là trợ lý vận hành, và khi không tool
   nào khớp, nó rơi vào RAG + câu trả lời kiểu vận hành.

⇒ **5 tool lập trình ĐÃ đăng ký và chạy được** (kiểm bằng lưới pha A-C + cây tệp/trình xem live),
**nhưng đường chat không định tuyến câu hỏi lập trình tới chúng.** Đây là GAP thật, vá được.

---

## 1. Hai trục nâng cấp

### TRỤC 1 — NỐI TÁC NHÂN LẬP TRÌNH THẬT (ưu tiên 1, vô nghĩa nếu bỏ)

Vấn đề không phải tool thiếu — mà là **đường chat không gọi chúng**. Giải bằng một **CHẾ ĐỘ NGỮ
CẢNH** riêng, KHÔNG đụng đường vận hành đang chạy tốt:

- Workspace gửi `context.codingMode = true` (hoặc một endpoint riêng `/api/ai/coding/stream`).
- Trong chế độ ấy, `streamAnswer` dùng:
  - **system prompt TÁC NHÂN LẬP TRÌNH** ("bạn đọc/sửa mã repo qua tool, không phải trợ lý vận
    hành") thay cho persona vận hành;
  - **tập tool = 5 tool lập trình** (+ vài tool phụ nếu cần), KHÔNG trộn tool vận hành;
  - **native tool-calling BẬT** cho tập này (đã có `AI_NATIVE_TOOLCALLS_ENABLED=true`), và/hoặc LLM
    fallback **chỉ trong chế độ này** — vì false-positive 92% là của tool VẬN HÀNH, không phải của
    một tập chỉ-tool-lập-trình với persona rõ ràng.
- **KHÔNG bật lại `AI_TOOL_LLM_FALLBACK` toàn cục** — đó là hồi quy đường vận hành đã đo.
- Thêm shortcut heuristic rẻ: câu chứa đường dẫn repo (`REPO_PATH_REGEX`) + động từ đọc/xem/sửa ⇒
  chọn thẳng tool lập trình, không chờ LLM.

**Cổng ra ĐO ĐƯỢC (bắt buộc, Playwright thật):** hỏi *"đọc server/routers.ts và cho biết export gì"*
→ AI **gọi `read_file`**, trình xem/hội thoại hiện **nội dung THẬT của tệp** (không phải chunk RAG).
Đây chính là phép đo đã thất bại hôm nay — nó phải chuyển từ ĐỎ sang XANH.

> ✅ **ĐÃ THỰC THI + NGHIỆM THU LIVE (2026-08-19)** — tôi tự chụp + tự đọc ảnh Playwright, tài
> khoản `engineer` thật, cổng 3000 bản mới:
> - *"đọc server/routers.ts và cho biết export gì"* → hiện **nội dung THẬT**: danh sách router
>   export (`aiActiveLearning: aiActiveLearningRouter`, … `repoWorkspace: repoWorkspaceRouter`, …
>   `export type AppRouter = typeof appRouter;`). So với hôm trước cùng câu này trả *"liên hệ kỹ
>   sư kỹ thuật"* (RAG vận hành). **Phép đo đã ĐỎ → nay XANH.**
> - *"đọc sandbox-projects/csharp-demo/src/Calculator.cs"* → thẻ "Đọc tệp trong repo" hiện nguyên
>   nội dung **C#** (1105 byte, `namespace CalculatorDemo`, class Calculator + comment lỗi cố ý).
>   ⇒ AI đọc được **cả TypeScript lẫn C#** — hai stack, cùng nội dung thật.
>
> ⚠ Cái CÒN LẠI (chưa verify, đúng phạm vi trục 1): AI mới **đọc/tìm/chạy** được (read/list/grep/
> run_command tất định). **`apply_diff` (SỬA tệp) cần vòng-lặp-tác-nhân qua LLM** — heuristic không
> dựng được `{path, original, modified}` từ câu trần. Vòng khép kín ĐẦY ĐỦ *đọc → SỬA → chạy test →
> đọc lỗi → sửa tiếp* (làm 2 ca đỏ của demo thành xanh) là bước ĐÁNH GIÁ TIẾP, không thuộc cổng ra
> trục 1.

### TRỤC 1 (C) — TÁC NHÂN LẬP TRÌNH **GỌI MODEL**: sinh mã + đề xuất sửa tệp

> ⚠⚠ **CHỦ DỰ ÁN BÁO LỖI THẬT (2026-08-19), VÀ HỌ ĐÚNG.** Họ mở `/ai-coding-workspace`, chọn
> "Demo Csharp", gõ *"viết code C# cho chương trình chat LAN sử dụng socket"* và nhận
> *"Chưa rõ yêu cầu lập trình. Hãy nêu một **đường dẫn tệp cụ thể**…"*.
> Kết luận của họ — *"tôi chưa thấy AI local hoạt động"* — là mô tả CHÍNH XÁC hành vi.

**Gốc rễ (đã truy mã, không đoán):** `streamCodingAnswer` có **5 đường ra** — pendingAction · denied ·
result · error · **không-tool-nào-khớp**. Đường thứ năm gọi `codingNoToolMessage()` và **KHÔNG BAO GIỜ
gọi model**. Trục 1 (A/B) cố ý làm chế độ lập trình TẤT ĐỊNH (heuristic → 5 tool), nên MỌI câu **sinh
mã mới** (không đường dẫn, không lệnh, không mẫu grep) đều bị từ chối theo cấu tạo. Đây là phần CÒN LẠI.

**Đã làm:**

1. **Cửa gọi model riêng** — `server/services/aiCodingAgent.ts` (module MỚI): persona · bộ cắt chuỗi
   suy luận · bộ che bí mật · canh thoái hoá · bóc khối mã · đồng bộ CRLF. **Một** điểm gọi
   `generateTextStream` cho cả hai việc, đã khai vào sổ lượng từ
   (`thinkingSurfaces.quantifier.test.ts`, `noi:"tai_cho"`).
2. **Nhánh SINH MÃ** thay cho ngõ cụt — persona *KỸ SƯ LẬP TRÌNH*: mã hoàn chỉnh trong khối
   ```` ```<ngôn ngữ> ````, giải thích ngắn, **CẤM ĐÍCH DANH** ba hình dạng câu trả lời vận hành đã
   gặp (`[1][2]`, *"liên hệ kỹ sư kỹ thuật"*, giọng trợ lý nhà máy). Kèm **ngữ cảnh dự án đang chọn**
   (tên + mục ở gốc, lấy qua `list_files` trong hộp cát — không mở cửa đọc thứ hai).
3. **Vòng lặp tác nhân — bước SỬA** (mảnh cuối của doc 79): câu có đường dẫn **+ động từ sửa** ⇒
   `read_file` (nội dung THẬT) → model dựng **TOÀN BỘ tệp mới** → `apply_diff` qua **HITL**
   `proposeAction`/`confirmAction` → người bấm duyệt mới ghi. `original` gửi đi là **byte trên đĩa**,
   không phải model tự nhớ — đó là điểm neo của băm chống TOCTOU.
4. **Cứu lượt đoán trượt của bộ chọn LLM**: heuristic trả `null` **và** tool (do LLM đoán) trả
   `NOT_FOUND`/`NO_MATCH` ⇒ đi tiếp xuống nhánh sinh mã, thay vì trả *"Không có tệp X trong hộp cát"*
   cho một câu xin sinh mã (đây là đúng lỗi cũ quay lại dưới tên khác).

**Cờ:** `AI_CODING_GEN` · `AI_CODING_EDIT` (cả hai **mặc định BẬT**; `"0"` ⇒ quay lại hành vi trục 1 và
câu trả lời **khai rõ cờ nào đang tắt**) · `AI_CODING_MODEL_TASK` (mặc định `chat`, xem VRAM dưới).
`AI_TOOL_LLM_FALLBACK` **không đổi** (vẫn 0) — đường vận hành không bị chạm một byte.

> ⚠⚠ **PHÁT HIỆN VRAM, ĐO ĐƯỢC TRÊN `.env` ĐANG CHẠY:** `LLAMA_SERVER_MODEL=Qwen3-30B-A3B-Instruct`
> nhưng `GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct` — **HAI model KHÁC NHAU**.
> `generateTextStream` chỉ đi qua llama-server khi `modelId` TRÙNG model server đang giữ; một
> `modelId` khác **rơi xuống đường in-process** ⇒ nạp bản thứ hai ~19 GB trong khi card còn ~5,6 GB.
> ⇒ Tác nhân lập trình mặc định đi tier **`chat`** (model đang thường trú, còn được prefix-cache).
> Muốn dùng model Coder thì phải đặt `GGUF_CODE_MODEL == LLAMA_SERVER_MODEL` **rồi** mới bật
> `AI_CODING_MODEL_TASK=code`.

**Trạng thái vòng khép kín:** *đọc → SỬA → (người duyệt) → chạy test → đọc lỗi → sửa tiếp* đã đủ mặt
tiếp xúc và chạy được **có người bấm** (client đã nối sẵn: `HunkDiffView` + `ConfirmActionCard`, và
đầu ra `run_command` được đưa lại vào lịch sử hội thoại). **CHƯA có** vòng lặp TỰ ĐỘNG (AI tự chạy
test rồi tự sửa tiếp mà không hỏi) — cố ý: mỗi lượt ghi/chạy vẫn phải qua người duyệt.

### TRỤC 2 — QUẢN LÝ DỰ ÁN / FOLDER (như Claude Code)

Hiện `gocHopCat()` = **MỘT gốc cố định** (`AI_REPO_SANDBOX_ROOT`, mặc định `process.cwd()`). "Quản
lý nhiều dự án" = mở nhiều thư mục gốc, chuyển đổi giữa chúng.

⚠⚠ **Đây chạm LỚP AN TOÀN — hộp cát MỘT gốc là một bất biến.** Cho mở thư mục TUỲ Ý là làm hộp cát
vô nghĩa. Thiết kế an toàn:
- **Danh sách TRẮNG thư mục gốc** (`AI_REPO_SANDBOX_ROOTS`, phân tách bằng dấu — cấu hình, KHÔNG
  người dùng tự nhập đường dẫn). Mỗi mục là một "dự án".
- Mỗi phiên workspace **chọn một gốc trong danh sách**; mọi tool (đọc/lệnh/ghi) bám gốc đang chọn.
  `phanQuyetDuongDan()`/`writeConfined` đã nhận `goc` làm tham số (pha A/C để sẵn) ⇒ mặt tiếp xúc
  đã có, chỉ cần luồng gốc đang-chọn xuống chúng.
- **RBAC không đổi**: vẫn `ai_repo_read/canView|canEdit` + `ai_repo_exec/canCreate`. Chọn dự án
  không mở quyền mới, chỉ đổi gốc trong tập đã cho phép.
- **Cây tệp + trình xem** đổi theo gốc đang chọn; thêm bộ chọn dự án ở đầu cây tệp.

**Cổng ra:** đột biến — mở một đường ra ngoài mọi gốc trong danh sách ⇒ TỪ CHỐI; chuyển giữa hai
dự án ⇒ cây tệp + tool bám đúng gốc; gốc không trong danh sách trắng ⇒ không chọn được.

### THAM KHẢO GIAO DIỆN — Claude Code (chủ dự án cung cấp ảnh, 2026-08-19)

Bố cục đích cho lần nâng UI (làm cùng trục 2 hoặc sau):
- **Bộ chọn dự án ở đầu vùng nhập** — nút *"Select folder…"* + nhãn *"Local"* (chỉ dấu chạy cục
  bộ). Đây chính là mặt người-dùng của trục 2 (đa gốc): người chọn **một dự án trong danh sách
  trắng** rồi cả phiên bám gốc đó.
- **Danh sách phiên bên trái** — *"Sessions you start will show up here"*. Mỗi phiên là một mạch
  hội thoại tác nhân trên một dự án; lưu lại để mở lại. (Hiện workspace chưa có lịch sử phiên.)
- **Ô nhập lớn** kiểu *"Describe a task or ask a question"* — hợp với persona lập trình của trục 1
  (mô tả một việc, không phải hỏi vận hành).
- Tab **Home / Code** tách ngữ cảnh.

⚠ Đây là tham khảo BỐ CỤC, không phải yêu cầu sao chép từng pixel. Ưu tiên vẫn là chức năng (trục
1 + 2) chạy thật; UI theo mẫu này khi hai trục đã vững. Danh sách phiên là hạng mục MỚI (cần lưu
trữ) — đánh giá riêng, không gộp vào trục 1.

> ✅ **TRỤC 2 ĐÃ THỰC THI + NGHIỆM THU LIVE (2026-08-19)** — tôi tự chụp + tự đọc ảnh Playwright:
> - Bộ chọn "Dự án" (mẫu *"Select folder"* + nhãn *"Cục bộ"*) hiện **3 dự án**: Repo chính · Demo
>   Csharp · Demo React + Postgres.
> - Đổi sang **Demo Csharp** ⇒ cây tệp CHỈ hiện `src` / `tests` / `CalculatorDemo.sln` (nội dung
>   của `sandbox-projects/csharp-demo`), KHÔNG còn repo chính. **Cô lập theo gốc chạy thật.**
> - Bất biến an toàn số một (đọc mã xác nhận): `gocTheoId(id lạ)` → `null` (không rơi về gốc mặc
>   định); client gửi ĐƯỜNG DẪN thay vì id → `PROJECT_NOT_FOUND`.
>
> ⚠ **BẪY ĐO ĐƯỢC khi nghiệm thu**: format `.env` không nháy để giữ `\` của đường Windows, NHƯNG
> dotenv coi `#` là comment ⇒ tên "Demo C#" làm chuỗi bị CẮT LẶNG (200+ ký tự → 59), 2/3 dự án
> biến mất, UI chỉ hiện 1 mà không báo lỗi. Lưới đơn vị KHÔNG bắt (nó test hàm parse với chuỗi ĐÃ
> nạp, `#` bị cắt ở tầng dotenv TRƯỚC đó). Sửa: tên không được chứa `#`/`;`/`=`/`|`; đã cảnh báo ở
> `.env.example`. → **Dùng "Demo Csharp".**

---

## 2. Rủi ro, nói thẳng

- **Trục 1** dễ gây **hồi quy đường vận hành** nếu chạm nhầm `classifyToolIntent`/`streamAnswer`
  dùng chung. Nguyên tắc: chế độ lập trình là một NHÁNH RIÊNG theo cờ ngữ cảnh, đường vận hành mặc
  định không đổi một byte. Có lưới A/B: cùng câu hỏi vận hành, chế độ-tắt vs chế độ-bật phải cho
  kết quả GIỐNG HỆT.
- **Trục 2** chạm lớp an toàn hộp cát. Đa gốc CHỈ từ danh sách trắng cấu hình; không có đường nào
  người dùng nhập đường dẫn tự do. Mọi đột biến hộp cát của pha A phải chạy lại trên MỌI gốc.
- **VRAM**: model 30B chỉ một instance. Chế độ lập trình dùng chung model với vận hành — không thêm
  tải, chỉ đổi persona + tập tool.

---

## 3. Thứ tự đề nghị

1. **Trục 1 trước** — không có nó thì workspace chỉ là trình xem tệp, đúng như verify hôm nay cho
   thấy. Làm xong, đo lại bằng Playwright: câu hỏi lập trình phải gọi được tool thật.
2. **Trục 2 sau** — khi tác nhân đã chạy thật trên một dự án, mở rộng sang nhiều dự án.

---

## 4. Cần chủ dự án quyết

1. **Trục 1 làm theo hướng nào**: (a) cờ `codingMode` trên đường stream chung, hay (b) endpoint
   riêng `/api/ai/coding/stream`? Tôi nghiêng (a) — ít mặt tiếp xúc hơn, dễ giữ đường vận hành bất
   biến. Nhưng (b) cách ly sạch hơn.
2. **Trục 2 — danh sách dự án** lấy từ đâu: một biến `.env` (`AI_REPO_SANDBOX_ROOTS`), hay một bảng
   CSDL cho phép thêm dự án qua giao diện (admin)? `.env` an toàn hơn (không sửa runtime); CSDL linh
   hoạt hơn nhưng là một bề mặt mới phải canh.
3. **Có làm cả hai trục trong đợt này**, hay chỉ trục 1 (nối tác nhân) rồi đánh giá trước khi mở đa
   dự án?
