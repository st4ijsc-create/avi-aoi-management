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

---

# ✅ PHẦN CUỐI — VÒNG KHÉP KÍN ĐÃ CHẠY THẬT (nghiệm thu live 2026-08-19)

Chủ dự án báo: hỏi *"viết code C# cho chương trình chat LAN sử dụng socket"* → AI trả *"Chưa rõ yêu
cầu lập trình…"*. **"Tôi chưa thấy AI local hoạt động."** Họ ĐÚNG.

**GỐC RỄ**: `streamCodingAnswer` có SÁU đường ra; đường cuối — *"không tool nào khớp"* — là **NGÕ
CỤT: nó KHÔNG BAO GIỜ gọi model**. Trục 1 cố ý tất định (heuristic đọc/tìm/chạy), nên mọi câu **SINH
MÃ MỚI** (không đường dẫn, không lệnh) đều bị từ chối.

## Nghiệm thu live — tôi tự chạy Playwright, tự chụp, tự đọc ảnh

| Phép đo | Trước | Sau |
|---|---|---|
| **"viết code C# … chat LAN … socket"** | *"Chưa rõ yêu cầu lập trình"* | **mã C# THẬT** — `using System.Net.Sockets`, `UdpClient`, `async Task Main`, tô cú pháp + giải thích tiếng Việt |
| **"sửa src/Calculator.cs để Divide ném ArgumentException khi chia 0"** | không có đường | **xem trước diff** + thẻ **"Đề xuất SỬA tệp — cần bạn duyệt"** (`1 khối +2 −0`) |
| bấm **"Duyệt & ghi"** | — | tệp **ghi thật xuống đĩa** (`git diff` = 2 dòng thêm) |
| `dotnet test CalculatorDemo.sln` | 4 xanh / **2 ĐỎ** | **6/6 XANH, 0 đỏ** |

⇒ **Vòng khép kín ĐẦY ĐỦ đã chạy**: *đọc tệp thật → AI sửa → NGƯỜI DUYỆT → ghi đĩa → chạy test →
XANH*. Hai ca `Divide_ByZero_*` chuyển đỏ→xanh **do chính AI sửa**, không phải tôi gõ tay.

> ♻ **Đề thi đã NẠP LẠI**: tôi hoàn nguyên `Calculator.cs` về bản có lỗi cố ý để chủ dự án tự thử
> lại đúng kịch bản này. `react-pg-demo` chưa dùng, vẫn còn 2 ca đỏ nguyên vẹn.

## ⚠⚠ CHẶN ĐƯỜNG ĐÃ GẶP KHI NGHIỆM THU — LỖ HỔNG THẬT, CHƯA VÁ

Lượt đo ĐẦU tiên **ĐỎ**, nhưng KHÔNG phải vì mã tác nhân: nó đã đi TỚI lượt gọi model rồi bị **sổ
VRAM** chặn — *"Không đủ VRAM: xin 0 MiB, còn **−19054 MiB**"*.

**Đo được**: bảng `vram_leases` có **107 hàng, trong đó 104 hàng thuộc 77 pid ĐÃ CHẾT** = **54.755
MiB hộ ma** trên card 32 GB ⇒ dư địa tính ra ÂM ⇒ **mọi lượt gọi model đều bị từ chối**. Hàng ma cũ
nhất từ **2026-08-17** (2 ngày).

**Vì sao tồn tại**: `chayLuotNhanNuoi()` chỉ thu hồi hộ **nhận nuôi trong bộ nhớ của TIẾN TRÌNH HIỆN
TẠI**. Hàng của **tiến trình anh em đã chết** trong sổ chung KHÔNG có bộ quét tự động — chỉ có lệnh
ops thủ công `vramRouter.releaseStale({leaseKey})`, **từng hàng một**.

> ⚠ **Hệ quả sản xuất, không chỉ là chuyện của tôi**: mỗi lần app chết cứng (crash, kill -9, mất
> điện) để lại hộ ma vĩnh viễn. Đủ vài lần ⇒ **AI ngừng trả lời hoàn toàn** cho tới khi có người
> chạy lệnh ops. Đây là **chế độ hỏng câm** — người dùng chỉ thấy "không đủ VRAM" với con số vô lý.

**Đã làm để thông đường** (KHÔNG phải bản vá): sao lưu cả bảng ra scratchpad, rồi xoá đúng các hàng
có `pid` **vắng mặt khỏi bảng tiến trình** — chính tiêu chí mà cổng an toàn `process-not-proven-dead`
dùng. Giữ nguyên 4 hàng của pid còn sống (1.231 MiB, khớp thực tế). ⚠ Xoá xong CHƯA đủ: tiến trình
app giữ **bản sao sổ trong bộ nhớ** và không đọc lại — phải **restart** mới nhận sổ sạch.

**NỢ ĐỀ XUẤT (chưa làm, chờ chủ dự án)**: một bộ quét khi khởi động + định kỳ, thu hồi hàng của pid
đã chết trong sổ chung, dùng đúng bằng chứng `process-not-proven-dead` (vắng mặt khỏi bảng tiến
trình HOẶC `ctime` đổi ⇒ PID bị cấp lại). Không có nó, mọi crash đều gặm dần dư địa VRAM.

## Cái CHƯA có (nói thẳng)

- **Vòng TỰ ĐỘNG** — AI tự chạy test rồi tự đọc lỗi rồi tự sửa tiếp mà không cần người. Hiện mỗi lượt
  ghi đều phải **người bấm duyệt** (HITL là thật, không phải nhãn). Cố ý.
- **Danh sách phiên** (phần còn lại của giao diện Claude Code) — hạng mục riêng, chưa làm.
- Model dùng là **`chat` tier** (Qwen3-30B-A3B-Instruct đang thường trú), KHÔNG phải Qwen3-**Coder**.
  Muốn đổi phải đặt `GGUF_CODE_MODEL == LLAMA_SERVER_MODEL` trước, nếu không sẽ nạp bản thứ hai
  ~19 GB khi card còn ~5,6 GB ⇒ OOM (xem khối ⚠ VRAM đầu `aiCodingAgent.ts`).

---

# ✅ VÒNG TỰ ĐỘNG + NỢ VRAM — nghiệm thu live 2026-08-19

## Vòng tự động — CHẠY THẬT

Trước: mỗi bước phải gõ tay (gõ câu sửa → bấm duyệt → **tự mở terminal** chạy test → **tự đọc** lỗi
→ **tự gõ** câu sửa tiếp). Nay tự động hoá **đúng ba việc**: CHẠY test · ĐỌC lỗi thật · ĐỀ XUẤT bản kế.

**Nghiệm thu live** (tôi tự chạy Playwright, tự chụp, tự đọc ảnh): bấm *"Duyệt & ghi"* một lần ⇒ thẻ
xanh **"Vòng tự động — lượt 1/3"** tự hiện, tự chạy `$ dotnet test CalculatorDemo.sln`, đọc kết quả
**"0 ca đỏ / 6 ca xanh"**, dừng với lý do **"XONG — lệnh kiểm chứng đã xanh hết."** Tôi chạy lại
`dotnet test` trong terminal của mình: **Failed: 0, Passed: 6** — khớp chính xác con số AI báo.

⚠ **RANH GIỚI GIỮ NGUYÊN**: thẻ tự nói *"Mỗi lượt GHI vẫn cần bạn bấm duyệt — vòng chỉ tự CHẠY test,
ĐỌC lỗi và ĐỀ XUẤT"*. Tự động hoá **không** đụng quyền ghi đĩa.

- Chọn lệnh test **tất định, không gọi model** (`.sln` ⇒ `dotnet test`; `package.json`+`test/` ⇒
  `node --test`; người nêu đích danh ⇒ dùng; không suy được ⇒ nói thẳng, vòng KHÔNG chạy).
  **KHÔNG BAO GIỜ tự chọn `npm run check`** — tsc toàn repo 4 phút là cách nhanh nhất để người dùng
  tắt hẳn tính năng.
- Trần mặc định 3 / cứng 5, kiểm ở **cả client lẫn server**. Dừng-khi-không-tiến-bộ **ba tín hiệu nối
  bằng HOẶC** (ca đỏ không giảm · đầu ra test lặp · diff lặp) — nối bằng VÀ là vị từ **tự thoả**.
- ★ Agent phát hiện lỗ brief tôi không nêu: **`dotnet format` GHI ĐÈ tệp mã nguồn** — mục duy nhất
  trong 9 mục danh sách trắng làm vậy. Để lọt ⇒ vòng ghi được đĩa **không cần duyệt**. Đã loại.
- ★ Và nó **va vào một bất biến đã viết ra**: `autonomyPolicy.ts` xếp `run_command` vào
  `AUTONOMY_INELIGIBLE` kèm câu *"Không có cấu hình nào mở được điều này"*. Cờ này LÀ cấu hình đó, qua
  cửa khác ⇒ **`AI_CODING_AUTOLOOP` mặc định TẮT**, người bật phải là chủ dự án.

## Nợ VRAM — GỐC RỄ THẬT, không phải cái tôi tưởng

| Phép đo | Trước | Sau |
|---|---|---|
| `vram_leases` | **107 hàng, 104 là ma** (77 pid chết) | **3 hàng, 0 ma** |
| Byte sổ khai | 61.000+ MiB trên card 32 GB ⇒ dư địa **ÂM** | **2.096 MiB** (thật) |
| `"KHÔNG đọc được bảng tiến trình"` | **66 dòng**, 0 lượt quét thành công | **0 dòng** |

**Ba tiền đề của TÔI bị bác bỏ, cả ba đều đo được:**

1. *"Không có bộ quét tự động nào"* — **SAI.** Bộ quét có từ Pha 3 Task 4 và nó ĐÚNG. Nó **mù**.
2. *"Bản sao sổ trong bộ nhớ bị cũ"* — **SAI.** Bản sao làm mới ≤60 s. Thứ tôi quan sát là
   `dungLaiTuSoCucBo()` dựng lại upsert cho mọi lease còn sống ⇒ xoá hàng **của chính app** bằng SQL
   thì nó quay lại. Thiết kế, không phải cache cũ.
3. *"Giữ nguyên 4 hàng của pid CÒN SỐNG"* — **SAI, và tôi đã nói câu này với chủ dự án.** Cả 4 đều là
   ma: pid 10992 vắng hẳn; 18208→`NisSrv.exe`, 20788→`claude.exe`, 33488→`ShellHost.exe` — Windows đã
   **cấp lại PID cho chương trình khác**. Tiêu chí thủ công của tôi ("pid có trong bảng tiến trình")
   **yếu hơn** tiêu chí của mã vốn đòi cả `ctime`. May là sai theo chiều AN TOÀN (giữ thừa).

**Và gốc rễ thật, tôi truy ra sau khi bản vá đầu vẫn chưa hết mù**: dòng cảnh báo không in `LÝ DO:` ⇒
`run()` **không hề hỏng** ⇒ đường câm duy nhất còn lại là `JSON.parse`. Dò thẳng: powershell **chạy
xong**, trả **122.285 ký tự**, `JSON.parse` ném *"Bad control character in string literal at position
83902"*. Thủ phạm **U+001A** trong `CommandLine` của một tiến trình đang chạy — `ConvertTo-Json`
(PowerShell 5.1) **không thoát ký tự điều khiển thô**. Một tiến trình có ký tự lạ là đủ giết cả bảng.

> ★★★ **VÌ SAO CẢ HAI LƯỢT CHẨN ĐOÁN TRƯỚC ĐỀU TRƯỢT**: phép đo đối chứng *"cùng lệnh chạy từ tiến
> trình Node khác cho 413–467 ms, 0 lỗi"* đo `run()` — thứ **quả thật chạy xong**. Nó **không** đo
> `JSON.parse`. **Cái được đo không phải cái đang hỏng.** Cùng lớp với "lưới xanh vì lý do sai".
> Và hỏng **phụ thuộc DỮ LIỆU đang chạy trên máy**, không phụ thuộc mã ⇒ không tái hiện trên máy sạch.

⚠ Đã thử và **đo là KHÔNG ăn**: lọc phía PowerShell `-replace '[\x00-\x1F]'` (U+001A vẫn lọt, vị trí
ném 83902 → 83897). Việc lọc nằm phía Node, nơi có lưới đơn vị tất định canh (14 ca, đột biến vô hiệu
bộ lọc ⇒ 7 đỏ).

## Còn lại

- ~~**Danh sách phiên**~~ — **ĐÃ LÀM**, xem mục cuối tài liệu này.
- **Vòng hoàn toàn tự trị** (AI tự bấm duyệt) — **cố ý KHÔNG làm**; HITL mỗi lượt ghi là bất biến.

---

# ✅ DANH SÁCH PHIÊN — hạng mục CUỐI của giao diện Claude Code (2026-08-19)

Ba thứ trong ảnh chủ dự án gửi nay đủ cả: *Select folder* (trục 2) · ô *Describe a task* (trục 1) ·
**danh sách phiên**.

## Nơi lưu: **CSDL** (`ai_coding_sessions`, migration `0333`) — và vì sao KHÔNG phải `localStorage`

`localStorage` nghe như *"0 bề mặt server ⇒ 0 rủi ro"*. Đo lại thì **ngược**:

| | `localStorage` | CSDL + phạm vi chủ sở hữu |
|---|---|---|
| Gắn với | **ORIGIN** | **NGƯỜI DÙNG** |
| Máy trạm xưởng dùng chung | A đăng xuất, **B đọc hết phiên của A** — không tầng nào chặn được | B không thấy gì |
| Bit `ai_repo_read` | **bị vô hiệu sau lượt đầu**: tài khoản không có quyền vẫn đọc được mã nguồn người trước kéo về | vẫn cưỡng chế mỗi lượt đọc |
| Đổi máy / trình duyệt | mất | còn |

Nội dung một phiên **là mã nguồn repo + diff đề xuất** — đúng thứ `ai_repo_read` sinh ra để canh.
`sessionStorage` thì mất khi đóng tab, tức không phải "danh sách phiên".

### "Ai đọc được phiên của ai": **CHỈ CHỦ PHIÊN — kể cả `admin` cũng không.**

- Phạm vi là **QUYỀN SỞ HỮU** (`userId`), **không** phải tenant. Hai lý do đo được:
  1. RLS tầng CSDL của repo **nằm im** (`runWithTenantScope` 0 nơi gọi trong mã sản xuất, đo
     2026-08-18) ⇒ một bảng dựa vào nó là bảng **không có hàng rào** kèm giấy chứng nhận vô can;
  2. tenant là **SAI TRỤC**: A và B cùng nhà máy ⇒ cùng tenant ⇒ RLS cho qua, trong khi câu hỏi
     phải trả lời là *"A đọc được phiên của B không"*.
- Hàng rào nằm trong **mệnh đề WHERE** của **mọi** truy vấn (`server/db/aiCodingSessions.ts`), với
  `userId` **luôn** từ `ctx.user.id`; **không `input` nào có ô danh tính**.
- **KHÔNG mở quyền mới**: dùng lại đúng bit `ai_repo_read/canView` (mig 0330). Migration 0333
  không chèn một hàng `permissions` nào.

## Phiên gắn dự án · nhãn tự sinh

- Phiên mang **`projectId`** (id trong danh sách trắng), **không bao giờ đường dẫn** — ba lớp:
  zod ở tuyến · `phanGiaiGoc()` fail-closed · **`CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$')`**
  ở tầng CSDL (`D:\…` có `:` và `\`; `/etc/passwd` có `/` ⇒ cả hai bị CSDL từ chối kể cả khi vòng
  qua tRPC). Đổi dự án ⇒ **rời** phiên, không mang sang.
- **Nhãn do SERVER suy** từ câu hỏi ĐẦU TIÊN của người (`nhanTuLuot`), gộp về một dòng, cắt 80 ký
  tự. Không suy được ⇒ trả **chuỗi rỗng**, giao diện hiện nhãn mặc định qua `t()` ba locale —
  nhét *"Phiên chưa đặt tên"* vào CSDL là ghim một ngôn ngữ vào **dữ liệu**.

## Ba thứ vừa dựng còn nguyên — cưỡng chế **theo cấu tạo**, không bằng lời dặn

> **Bất biến số một: một phiên đã lưu chỉ chứa `{role, content}`.**
> `locLuot()` là một phép **CHIẾU** (không phải phép kiểm tra) chạy ở **CẢ cửa ghi LẪN cửa đọc**.

1. **HITL** — phiên **không lưu** `actionId`/`token`/`args`/`expiresAt`, nên nạp lại **không có gì**
   để dựng một thẻ duyệt. Chiếu ở cửa **ĐỌC** là chỗ ca *"nạp lại thẻ duyệt CŨ"* chết: một hàng bị
   đầu độc bằng SQL thẳng vẫn đọc ra đúng hai ô (đo thật, §4). Băm TOCTOU cũ vì thế không có đường
   tới `confirmAction`; và server còn chặn **độc lập** (băm đọc lại từ đĩa + TTL + token gắn userId).
   `chonPhien` còn xoá tường minh `pending`/`pendingDiff`.
2. **Vòng tự động** — không lưu, không khôi phục. `chonPhien`/`phienMoi` đặt lại `VONG_RONG`; không
   đường nào của phiên chạm `chayLuotVong`/`kiemChungM`.
3. **Cô lập theo gốc** — xem trên. Client chỉ giữ và gửi **id**.

## Giao diện

Cột phiên **ngoài cùng bên trái** (mẫu *"Sessions you start will show up here"*): nhãn tự sinh ·
`n lượt · thời gian` · phiên đang mở được đánh dấu (`aria-current` + đậm/màu) · nút **Phiên mới** ·
nút xoá từng phiên. **Ba khung cũ giữ nguyên** thứ tự và vai trò — lưới thành
`[190px_240px_1fr_400px]` (phiên · cây tệp + bộ chọn dự án · trình xem · hội thoại). 11 nhãn mới,
`t()` một-dòng, đủ **vi/en/zh**.

## Đột biến ĐÃ CHẠY — và **đã chứng minh ĂN** (đọc lại trạng thái thật sau mỗi lượt)

| # | Đột biến | Kết quả |
|---|---|---|
| M1 | bỏ `eq(userId)` khỏi `moPhien` | **ĐỎ 2 ca** — *"B mở phiên của A"* + *"ADMIN đọc phiên của A"* |
| M2 | `locLuot` chiếu → `{...o}` | **ĐỎ 4 ca / 2 file** — gồm ca CSDL: `actionId`/`args` rò tới client |
| M3 | `chonPhien` bỏ `setPending(null)`/`setPendingDiff(null)` | **ĐỎ** §1 census client |
| M4 | `chonPhien` bỏ đặt lại `VONG_RONG` | **ĐỎ** §2 census client |
| M5 | **DROP CHECK** `chk_…_project_id` trên CSDL test | **ĐỎ** — `D:\SOURCES\…` INSERT lọt ⇒ CHECK là hàng rào THẬT, không phải trang trí |

M5 là lượt quan trọng nhất về mặt phương pháp: nó chứng minh ca *"CSDL từ chối đường dẫn"* **không**
xanh vì một lý do khác (FK, kiểu cột…). Cả năm đã hoàn nguyên và đo lại xanh.

## Suite ĐẦY ĐỦ — và phép so có ĐỐI CHỨNG

`1006` tệp: **937 xanh · 67 đỏ**. Không đọc con số ấy là "tôi làm hỏng 67 tệp": đã đo **hai chiều**.

| | tập đỏ |
|---|---|
| chạy riêng 67 tệp ấy **ở HEAD** (`git stash` hết lượt này) | **64** |
| chạy riêng 67 tệp ấy **với lượt này** | **64** |
| `diff` hai tập | **KHÔNG CÓ KHÁC BIỆT — y hệt từng dòng** |

⇒ **0 hồi quy.** 64 tệp là **nợ CÓ SẴN** (sản phẩm/máy/IR transpiler/CAD — không tệp nào nằm trong
diff của lượt này). Ba tệp còn lại (`neoTenXacThuc` · `processResultAnalytics` ·
`vramReadModel.guard`) **xanh khi chạy riêng ở CẢ HAI phía** ⇒ chúng đỏ vì **nhiễu CSDL dùng chung
lúc chạy song song**, đúng hiện tượng đã ghi trong sổ trước đây — không phải vì lượt này.

## Hai lỗi của CHÍNH TÔI, bắt được trong lúc làm (ghi lại vì cả hai đều là lớp đã trả giá)

1. **Bao đóng bất đồng bộ đọc state cũ.** Bản đầu của `luuTranscript` đọc `sessionId` từ bao đóng.
   Lượt lưu thứ nhất (câu người hỏi) TẠO phiên và gọi `setSessionId`; lượt thứ hai (câu AI trả lời)
   có thể được dựng bao đóng TRƯỚC khi state kịp cập nhật ⇒ **đẻ ra phiên thứ hai cho cùng một
   mạch**. Đây **đúng lớp lỗi mà chính file này đã viết ra cho `vongRef`** ("một vòng bất đồng bộ
   đọc `useState` sẽ thấy giá trị của lần render TRƯỚC") — và tôi vẫn dẫm vào. Sửa: `sessionIdRef`
   là nguồn sự thật, `datSessionId()` ghi ref TRƯỚC rồi state SAU; có lưới đếm cưỡng chế
   (`setSessionId(` xuất hiện **đúng 1 lần**, trong `datSessionId`).
2. **CRLF.** Một ca của lưới client so chuỗi nhiều dòng bằng `\n` ⇒ **ĐỎ trong khi mã hoàn toàn
   đúng** (tệp lưu `\r\n`). Sửa ở **thiết bị đo**, không ở vật được đo: chuẩn hoá `\r\n → \n` ngay
   lúc đọc tệp nguồn.

## ⚠ TIỀN ĐỀ SAI ĐÃ PHÁT HIỆN — `phamViDocCensus` **ĐÃ ĐỎ SẴN Ở HEAD**

Brief nói *"census sẽ cắn"*, hàm ý cổng đang xanh và tôi là người có thể làm nó đỏ. **Không đúng.**
`git stash` toàn bộ lượt này rồi chạy lại: HEAD đo được `tong 2215` so với `GHIM 2209` — **đã lệch 6
từ trước**. Truy ra: `GHIM` đặt ở `d3b0ed74`, **trước khi** `repoWorkspaceRouter.ts` tồn tại
(`8f5b32c1`, doc 78 pha D); 6 thủ tục của nó (`listFiles`/`readFile`/`grep` → S · `listProjects`/
`cauHinhVong` → C · `chayKiemChung` → D) **chưa bao giờ được khai**. Đó là **nợ có sẵn của chính
dòng việc doc 78/79**, không phải của lượt này. Đã trả cùng lượt (để lại thì con số mới cũng vô
nghĩa), kèm phép quy trách nhiệm đầy đủ trong `phamViDocCensus.test.ts`:
`2209 + 6 (nợ cũ) = 2215 (đo) + 4 (lượt này) = 2219`. **Nhóm (A) KHÔNG đổi: 363.**

---

# ✅ DANH SÁCH PHIÊN — mảnh CUỐI, nghiệm thu live 2026-08-19

Ba mảnh của giao diện Claude Code chủ dự án gửi mẫu **nay đủ cả ba**:

| Mảnh mẫu Claude Code | Ở đây | Trạng thái |
|---|---|---|
| *"Select folder"* | bộ chọn dự án (trục 2) | ✅ live |
| ô *"Describe a task…"* | AI sinh mã · sửa tệp qua HITL · vòng tự động | ✅ live |
| **danh sách phiên** | cột "Phiên" + "Phiên mới" | ✅ **live (mục này)** |

**Nghiệm thu live** (tôi tự chạy Playwright, tự chụp, tự đọc ảnh): tạo hai phiên ⇒ cả hai hiện trong
cột trái với **nhãn tự sinh từ câu hỏi đầu** + `2 lượt · 12:42 19-08`; bấm lại phiên CŨ ⇒ **khôi phục
nguyên hội thoại** (câu hỏi + nội dung `Calculator.cs` thật). Chân cột nói rõ: *"Phiên lưu trên máy
chủ, riêng theo tài khoản và theo dự án — người khác không đọc được."*

## ★★ Trục an ninh: CHỦ SỞ HỮU, không phải tenant — tiền đề của tôi SAI

Tôi dặn *"nếu chọn CSDL thì phải trả lời RLS/tenant"*. **Sai trục.** Tenant không trả lời được câu
hỏi thật (*"A đọc được phiên của B không?"* — A với B cùng nhà máy thì **cùng tenant**), và RLS tầng
CSDL của repo này **nằm im** (`runWithTenantScope` 0 nơi gọi). Trục đúng là **quyền sở hữu**, chặt
hơn tenant một bậc: **chỉ chủ phiên, kể cả `admin` cũng không**. Hàng rào nằm trong **mệnh đề WHERE
của mọi truy vấn**; `userId` luôn từ `ctx.user.id`, `input` không có ô danh tính nào.

★ Và `localStorage` — thứ nghe như *"0 bề mặt server ⇒ 0 rủi ro"* — thực ra **ngược**: nó gắn với
**origin**, không gắn với **người dùng**. Trên máy trạm xưởng dùng chung, A đăng xuất, B đăng nhập
cùng hồ sơ trình duyệt và **đọc hết phiên của A**. Mà nội dung phiên **là mã nguồn + diff đề xuất** —
đúng thứ bit `ai_repo_read` sinh ra để canh.

## ⚠ MỘT LỖI CHỈ MẮT BẮT ĐƯỢC — mọi lưới đều xanh

Ảnh chụp đầu tiên lộ **khối "Dự án" bị bóp còn 13 px** trong khi `<select>` bên trong cao 20 px ⇒ nó
**tràn và đè lên** khối "Cây tệp". Nguyên nhân: trong `flex flex-col` có `ScrollArea flex-1`, các khối
đầu thiếu `shrink-0` nên bị co; cột phiên mới làm lưới chặt hơn nên lỗi cũ mới lộ.

> Đây đúng bài học nhóm C: **cổng tĩnh xanh chỉ chứng minh "không còn thứ TÔI BIẾT CÁCH NHÌN"**.
> `check` · `check:tests` · `i18n:check` · 73/73 ca phiên — tất cả xanh, và không cái nào thấy được
> hai khối đè lên nhau.

Sau khi thêm `shrink-0`: khối "Dự án" **67 px**, `<select>` **32 px**, "Cây tệp" xuống y=155 — hết đè.

## Nợ CÓ SẴN đóng kèm

`phamViDocCensus` **đã ĐỎ ở HEAD** (đo 2215 vs ghim 2209). Truy ra ghim đặt ở `d3b0ed74` **trước khi**
`repoWorkspaceRouter.ts` tồn tại (`8f5b32c1`, doc 78 pha D) ⇒ 6 thủ tục chưa bao giờ được khai — nợ
của **chính dòng việc doc 78/79**. Trả kèm quy trách nhiệm: `2209 + 6 (nợ cũ) = 2215 (đo) + 4 (lượt
này) = 2219`. ⚠ **Nhóm A (rò rỉ) KHÔNG đổi: 363.**

## Trạng thái cuối

- Migration **0333** đã áp **cả hai** CSDL. Phiên thử của tôi đã xoá (bảng về 0 hàng).
- Đề thi C# + React đều **nạp lại**, `sandbox-projects/` 0 thay đổi.
- `AI_CODING_AUTOLOOP=1` đang bật ở `.env` máy này để nghiệm thu; **mã mặc định TẮT**.

---

# ✅ CỔNG GIẤY PHÉP `MOD_AI` — nghiệm thu live 2026-08-19

Chủ dự án muốn bán cho **hai loại khách**: doanh nghiệp **KHÔNG mua AI** (hệ vẫn chạy đủ) và doanh
nghiệp **CÓ mua** (AI sáng lên). Ràng buộc số một họ nêu: *"đảm bảo các hệ thống khác không dùng AI
sẽ KHÔNG bị ảnh hưởng"*.

**Không tách repo** — đo được 47 tệp ngoài vùng AI phụ thuộc engine (thị giác, OCR, RCA, cố vấn
ngưỡng, chat vận hành), và `aiLocalTools` chứa **69 tool trong đó chỉ 5 là lập trình**. Cắt ra là
làm hỏng bốn module khác. Thứ cần là **cổng giấy phép**, và `MOD_AI` đã đăng ký sẵn từ trước.

## Ba kịch bản — nghiệm thu LIVE (tôi tự chạy, tự chụp, tự đọc ảnh)

| Kịch bản | Cách dựng | Kết quả |
|---|---|---|
| **Chưa khai SKU** | `licenses` rỗng, cache rỗng | ✅ **mọi thứ chạy** — đúng thiết kế không-brick |
| **Có giấy phép, KHÔNG mua AI** | chèn 1 hàng `licenses` thật, 10 module, vắng `MOD_AI` | ✅ tuyến AI → **"Module chưa được cấp phép"**; **Bảng điều khiển sản xuất chạy ĐẦY ĐỦ** (36 trạm, KPI, toolbar, bảng dữ liệu) |
| **Có mua AI** | `LICENSE_BYPASS=true` (khuôn hiện tại) | ✅ **không một byte hành vi nào đổi** |

Hàng `licenses` thử đã **xoá**, bảng về đúng **0 hàng** như trước.

## Số đo

- **28 → 291** thủ tục sau `MOD_AI` (4 → 28 file). Thủ tục **ngoài AI bị khoá nhầm: 0**.
- Dân số cổng 5 SKU khác **giữ nguyên từng con số**: PRODUCTION 62 · QUALITY 67 · ENGINEERING 68 ·
  FEDERATION 8 · OT_CONTROL 105.
- **52 ca lưới** trên sổ thật **2.219 thủ tục** — trùng đúng `phamViDocCensus#GHIM.tong`, hai bộ suy
  độc lập ra cùng dân số. `moduleGate.ts` trước lượt này **không có lưới nào**.
- Đột biến **6/6 ăn**, gồm ca phá không-brick và ca client bỏ chặn.

## ⚠ 62 thủ tục CỐ Ý KHÔNG khoá — chủ dự án ĐÃ DUYỆT

Ký tên đầy đủ trong `MIEN_TRU_VAN_HANH`. Đáng chú ý nhất:

- **Công tắc dừng khẩn của agent (3)** — giấy phép có thể hết hạn **trong lúc** agent đang chạy;
  khoá nút dừng sau một hợp đồng thương mại là **ngược chiều an toàn**.
- **Sổ cảnh báo trung tâm (14)** — `predictive_alerts` được SPC/SLO/leo-thang ghi vào, OpsConsole
  đọc. Khoá = tắt bảng cảnh báo của khách không-AI.
- **Phân tích kiểm tra thuần SQL/SPC (11)** — `/drill-down` thuộc **CORE_DASHBOARD**.
- **Bề mặt gắn trên chrome toàn cục (6)**, **người gọi nằm trên màn của SKU khác (10)**.

> **Hệ quả nhìn thấy được**: panel *"Tín hiệu AI theo máy"* **vẫn hiện** trên bảng sản xuất của khách
> không-AI (rỗng, ghi "Chưa thiết lập giám sát"). Bấm *"Hỏi AI"* → dẫn tới `/ai-chat` và **gặp đúng
> tường cấp phép**. Không hỏng, nhưng là ngõ cụt dẫn tới lời mời nâng cấp. Muốn ẩn hẳn thì phải sửa
> client trước, rồi mới khoá thủ tục (lưới §5 sẽ đỏ nếu quên gỡ dòng khỏi sổ miễn trừ).

## ★★ Tệp cache giấy phép — đã gỡ khỏi git

`server/license/license-state-cache.json` **bị git theo dõi** và khai một SKU **10 module vắng
`MOD_AI`, `MOD_QUALITY`, `MOD_OT_CONTROL`, `MOD_ENGINEERING`, `MOD_FEDERATION`**, trong khi bảng
`licenses` **rỗng** ⇒ nó là **nguồn SKU duy nhất** của mọi bản sao repo.

⚠ **Đính chính mức nguy hiểm** (tôi đo thêm sau khi agent cảnh báo): app **ghi đè tệp đó về rỗng ở
mỗi lần khởi động**, nên nó **tự lành lúc chạy**. Vẫn đúng khi gỡ khỏi git — nó là **sản phẩm sinh
ra** (`license-service.ts:314` ghi nó; dòng 326 xử lý đúng khi vắng) — nhưng không phải quả bom như
thoạt nghe. Cùng lớp với `embeddings.jsonl`: artifact bị commit rồi hoá thành cấu hình ngoài ý muốn.

## Việc CÒN LẠI trước khi bán được hai gói

Vì cache tự reset, **không có đường nào để một khách hàng thật có SKU thiếu AI chỉ bằng tệp này**.
Cổng đã sẵn sàng đón, nhưng **nguồn SKU thì chưa**: cần một hàng `licenses` thật hoặc một license
server. Đây là hạng mục thương mại, không phải kỹ thuật.

---

# ✅ TRỤC 1 (D) — HẾT MÙ KIẾN TRÚC KHI SINH MÃ (2026-08-20)

Chủ dự án nêu: hỏi *"hệ thống này xác thực người dùng thế nào"* thì AI **không tra gì cả** — nó viết
một câu nghe-đúng về một hệ thống nó chưa từng nhìn. Đo lại: **đúng**. Đường `streamCodingGenerate`
không gọi một lời truy hồi nào; toàn bộ "hiểu biết về repo" của model là `nguCanhDuAnChoPrompt()` =
**tên dự án + ≤24 mục ở thư mục gốc**.

## ⚠⚠ TIỀN ĐỀ SAI CỦA BRIEF — *"đường ống ĐÃ CÓ, chỉ cần nối dây"*. **KHÔNG ĐÚNG.**

Brief khai: *"`gatherRepoIndexContext` dùng chunk tóm tắt để TÌM tệp, rồi `gatherRepoContext` đọc
NỘI DUNG THẬT qua `confineTargetUnder`/`readConfined`"*. Kiểm bằng mã — **ba câu sai**:

| Lời khai | Sự thật đo được |
|---|---|
| `gatherRepoIndexContext` "dùng chunk để TÌM tệp rồi đọc mã thật" | Nó gọi `gatherRepoContext({objective, includeRag:true})` — **KHÔNG truyền `files`** ⇒ vòng `for (const raw of input.files ?? [])` chạy trên tập **RỖNG** ⇒ **0 byte tệp được đọc**. Thứ nó trả về là **văn bản chunk tóm tắt**. Bước nhảy *mục lục → mã thật* **CHƯA TỪNG TỒN TẠI**. |
| `gatherRepoContext` đọc qua `confineTargetUnder`/`readConfined` (realpath, `nlink>1`, tầng fd) | Nó gọi **`fs.readFileSync` thẳng** với hàng rào RIÊNG (`classifyRepoPath` + `realpathSync`). **Không có** `nlink`, **không có** tầng fd. Chính docblock đầu file ấy đã viết *"HAI ĐƯỜNG, HAI LUẬT"* và cảnh báo `classifyRepoPath` **không phải** cửa của đường tool. |
| chunk là "mục lục", mã thật là ngữ cảnh | Đúng về Ý ĐỊNH, sai về HIỆN TRẠNG. Một chunk router nguyên văn: `"Router file: … Router names: … Procedure calls: 44"`. Nhét nó vào prompt sinh mã là nhét **mục lục** vào chỗ cần **mã**. |

⇒ Việc KHÔNG phải "nối dây": bước nhảy phải được **dựng mới**. Đó là
`server/services/ai/codingRepoContext.ts`.

## (a) Nối vào đường nào — **SINH MÃ**, không phải SỬA TỆP

| | dư địa token | ngữ cảnh sẵn có | quyết |
|---|---|---|---|
| `streamCodingGenerate` | **29.383** token trống (đo: 385 vào + 3.000 ra / slot 32.768) | **0** — đây LÀ cái lỗ | ✅ nối |
| `streamCodingEdit` | **âm** ở trần: tệp 60.000 ký tự ⇒ 21.817 vào + 12.000 ra = 33.817 > 32.768 | đã chở **nguyên tệp đích** + lịch sử | ❌ không nối |

Đường SỬA đã có đúng tệp cần sửa trong prompt; thêm ngữ cảnh ở đó là biến một chức năng đang chạy
thành một chức năng luôn ném, đổi lấy lợi ích gần bằng 0.

## Cách chạy — HAI TẦNG, và tầng hai đi qua CỬA TOOL

1. **MỤC LỤC** — `gatherRepoIndexContext()` xếp hạng; ta lấy `snippets[].sourcePath` và **vứt
   `block`** (block là tóm tắt).
2. **MÃ THẬT** — đọc từng đường dẫn bằng `executeDecision({tool:"read_file", args:{path, maxBytes}})`
   do NGƯỜI GỌI **tiêm vào**. `codingRepoContext.ts` **không nhập `fs`** — nên thừa hưởng nguyên
   `confineTargetUnder` + `readConfined` (realpath, `nlink>1`, tầng fd chống TOCTOU) + che bí mật +
   trần byte tệp/phiên + RBAC `ai_repo_read/canView` + **gốc dự án đang chọn**. Không mở cửa `fs`
   thứ hai ⇒ `programmingFileIo.census` không đổi một dòng.

## (b) Ngân sách token — cưỡng chế bằng **CHÍNH** `kiemNganSachNguCanh`, không có thước thứ hai

**Thứ tự nhường chỗ: `lịch sử` → `ngữ cảnh mã` → (không bao giờ) `prompt gốc`.**

Khối mã được nhét vào **`ghepPrompt`**, tức nó nằm trong chính chuỗi mà `dungKhoiLichSu` đã cân bằng
`kiemNganSachNguCanh`. Nhờ thế lịch sử tự nhường trước (vòng `k` giảm dần — bất biến doc 81 còn
nguyên, không phải viết lại); chỉ khi *prompt gốc + khối mã + **0** lượt lịch sử* vẫn vượt
(`vuotTruocKhiCoLichSu`) thì khối mã bị **bỏ hẳn** và cân lại — **không từ chối cả lượt sinh mã**.
Từ chối một câu hỏi vì ta vừa TỰ THÊM ngữ cảnh vào là biến cải tiến thành hồi quy.

### Đối chiếu hai trần `60.000` ↔ `tranTokenChoTep` — **ĐO, rồi quyết GIỮ NGUYÊN**

Chạy `kiemNganSachNguCanh` trên CHÍNH `personaSuaTep` + `promptSuaTep`:

```
n = 55.000 → 20.032 + 12.000 = 32.032  ✔
n = 57.063 → 20.768 + 12.000 = 32.768  ✔  ← ĐIỂM HOÀ
n = 57.064 → 20.769 + 12.000 = 32.769  ✘
n = 60.000 → 21.817 + 12.000 = 33.817  ✘
```

Trần THẬT: **57.063 (vi) · 57.069 (en) · 57.441 (zh)** — nó **xê dịch theo locale và theo độ dài
ngữ cảnh dự án**. `60.000` cao hơn trần thật ~2.900 ký tự.

**KHÔNG hạ xuống 57.000.** (1) Hạ ⇒ từ chối SỚM những tệp hôm nay VẪN chạy được (dải 57.001–57.063)
= hồi quy thật, đổi lấy một câu từ chối đẹp hơn. (2) **Không tồn tại một hằng số đúng** — ghim một
con số là ghim một lời khai chỉ đúng cho MỘT cấu hình. (3) Sai lệch hiện tại đi hướng AN TOÀN: bộ
lọc thô RỘNG hơn cổng chính xác nên không chặn nhầm; `kiemNganSachNguCanh` (cùng thước mà server
dùng) mới phán quyết. Việc phải làm là **nói ra sự thật ấy** — đã ghi vào docblock
`TRAN_KY_TU_TEP_SUA`.

## (c) Cờ — RIÊNG, và mặc định **BẬT**

`AI_CODING_REPO_CONTEXT` (mặc định **1**). **Không** dùng chung `AI_COPILOT_REPO_INDEX_ENABLED`:

- Phép đo biện minh cho việc TẮT cờ PLC là về câu hỏi **cú pháp HÃNG**, nơi chunk repo là nhiễu
  (`tm-pick-place` kéo `drizzle/schema/robot.ts` lên 0,70). Ở đây câu hỏi là **về chính repo này**,
  và cùng phép đo ấy ghi **0,580–0,782 với đoạn TRÚNG ĐÍCH**. **Kết luận không chuyển sang được.**
- Khác biệt nặng hơn: đường PLC nhét **văn bản chunk** vào prompt ⇒ một lượt xếp hạng trượt là một
  lời khai SAI. Ở đây chunk chỉ **CHỌN TỆP**; chọn trượt tốn token chứ **không nói dối**, vì thứ vào
  prompt luôn là byte thật trên đĩa.
- Chi phí có trần và fail-safe: 1 lượt truy hồi (ẤM 245–283 ms; LẠNH ~14 s, hạn giờ 20 s rồi bỏ qua)
  + ≤3 `read_file` ≤12 KB; ≤4.000 token trên 29.383 dư địa. Hỏng ở đâu ⇒ khối rỗng ⇒ **đúng hành vi
  cũ**. Tắt bằng `AI_CODING_REPO_CONTEXT=0`.
- ⚠ Chi phí thật cần biết: mỗi lượt tiêu ≤36 KB của **ngân sách byte PHIÊN** (1 MB/15 phút) ⇒ ~29
  lượt sinh mã trước khi chạm trần — dùng CHUNG với những lượt `read_file` người dùng tự gọi.

## ⚠⚠ TRỤC 2 — chỗ sai LẶNG nguy hiểm nhất, đã bịt

`knowledge/chunks.jsonl` mô tả **DUY NHẤT repo chính** (đếm theo gốc `sourcePath`: docs 4.113 ·
server 2.298 · knowledge 525 · client 224 · drizzle 202 · apidocs 199 · shared 21 — **0** thuộc
`sandbox-projects/**`). Mở **Demo Csharp** mà vẫn truy hồi ⇒ mục lục trả đường dẫn của **repo
chính**. `chiMucKhopGoc()` là cổng **fail-closed đứng TRƯỚC lượt truy hồi**: gốc đang chọn ≠ gốc chỉ
mục ⇒ `"khac-goc"`, không truy hồi, không đọc.

## (d) Người dùng thấy gì

- **MỘT thẻ tool** "Đọc tệp trong repo" liệt kê mọi tệp + `byte trên đĩa` + `ký tự vào ngữ cảnh` +
  cờ ĐÃ CẮT. ⚠ **Một** thẻ chứ không phải một thẻ mỗi tệp — đo được: `AICodingWorkspace` giữ
  `streamTool` là **một ô** và `setStreamTool` **GHI ĐÈ**; N thẻ ⇒ người dùng chỉ thấy thẻ CUỐI.
- **Chân nguồn nối vào `answer`** (`📄 Câu trả lời dựa trên các tệp sau, ĐỌC TỪ ĐĨA trong lượt này:`)
  — vì một phiên đã lưu **chỉ giữ `{role, content}`** (bất biến `locLuot()`), nên thẻ BIẾN MẤT khi
  mở lại phiên cũ; chân nguồn sống trong `content`. Ba locale, chuỗi SERVER ⇒ **0 nhãn client mới**
  ⇒ `viStringCoverage` vẫn **đúng 500**, `i18n:check` exit 0.

## (e) Đột biến — 9 lượt, và **MỘT lượt SỐNG SÓT đã lộ ra thiết bị đo dối**

| # | Đột biến | Kết quả |
|---|---|---|
| M1 | bỏ cổng cờ `nguCanhMaEnabled()` | **ĐỎ 3** (ca âm §1 + §7.1) |
| M2 | bỏ cổng gốc `chiMucKhopGoc()` | **ĐỎ 3** (§2 ×2 + §7.4) |
| M3 | bỏ phép kiểm `kq.note` (từ chối hộp cát) | ⚠ **SỐNG SÓT** → sau khi sửa THIẾT BỊ ĐO: **ĐỎ 7** |
| M4 | bỏ nhánh nhường chỗ ngân sách | **ĐỎ 1** — đúng chỗ: `canh.vua=false`, 903+3000 > 3477 |
| M5 | dùng `mucLuc.block` (chunk tóm tắt) thay mã thật | **ĐỎ 6** (gồm §7.2 "khớp byte") |
| M6a | bỏ thẻ tool | **ĐỎ 1** (§7.3) |
| M6b | bỏ chân nguồn trong `answer` | **ĐỎ 1** (§7.3) |
| M7 | làm `boQuaCo` vô hiệu | **ĐỎ 1** — cờ PLC sẽ bịt LẶNG cờ lập trình |
| M8 | bỏ phép cắt theo ngân sách | **ĐỎ 2** (§4) |
| M9 | bỏ luồng `execCtx.projectRoot` ở người gọi | **ĐỎ 1** (§7.4) |

### ★★★ M3 SỐNG SÓT — bài học đắt nhất của lượt này

Cửa đọc GIẢ của tôi trả `data: {}` khi có `note` (giống `RONG_DOC` mà `read_file` trả HÔM NAY). Bỏ
hẳn phép kiểm `kq.note` thì **§3 lẫn §7.5 vẫn XANH** — chúng xanh vì `content` rỗng, **KHÔNG** vì
cổng `note` làm việc. Tức tôi có một hàng rào **không ai đo**, và một lưới **tự nhận là đang đo nó**.
Sửa ở **thiết bị đo**: cửa giả nay dựng ca độc nhất *"vừa từ chối vừa mang chữ"*. M3 áp lại ⇒ **ĐỎ 7**.

### ★★ §7.4 — một mệnh đề TỰ THOẢ bị bắt tại chỗ

Bản đầu của §7.4 khẳng định *"prompt KHÔNG chứa `namespace CalculatorDemo`"* và tôi coi đó là bằng
chứng chống rò rỉ xuyên dự án. **Nó tự thoả**: gỡ cổng gốc ra, mệnh đề ấy VẪN xanh — vì `read_file`
chạy với `__projectRoot` = gốc tạm nên trả `NOT_FOUND`. Mệnh đề ĐO ĐƯỢC là *"ta thậm chí KHÔNG THỬ
đọc tệp của dự án khác"*, đếm trên bản kiểm `h.quyetDinh`. Ranh giới nói thẳng: **byte không rời ra
được là nhờ hàng rào THỨ HAI** (`__projectRoot` do `argsWithAuthCtx` tiêm), độc lập; ca này đo hàng
rào THỨ NHẤT.

### ★ §7.6 — ca đầu ĐỎ VÌ LÝ DO SAI

Bản đầu dựng "câu hỏi khổng lồ" 78 KB rồi khai rằng nó làm prompt vượt trần. Đo ra **không vượt**
(≈31.800/32.768) ⇒ ca đỏ vì thiết bị đo sai, không vì mã sai. Sửa: ca **tự hiệu chỉnh trần** — chạy
một lượt PHỎNG (cờ tắt) để đo prompt gốc, rồi đặt `LLAMA_SERVER_CTX_PER_SLOT = gốc + 3.000 + 10`.
Theo cấu tạo: prompt gốc vừa khít, khối mã nào cũng làm nó vượt. **Không con số nào phải đoán.**

## Cổng — và một ca ĐỎ được QUY TRÁCH NHIỆM đúng chỗ

`npm run check` ✔ · `check:tests` ✔ · `i18n:check` exit 0 ✔ · `viStringCoverage` = **500** ✔ ·
7 census (`programmingFileIo` · `toolNote` · `toolPermission` · `authCtx` · `repoCommand` ·
`repoSandbox` · `applyDiff`) + `phamViDocCensus` (nhóm A vẫn **363**) + `phamViTuyenCensus` +
`congGiayPhepAiCensus` + `thinkingSurfaces.quantifier` ✔ (không thêm điểm gọi sinh chữ nào).

Chạy 60 tệp vùng ảnh hưởng: **1.150 xanh / 1 đỏ**. Ca đỏ
(`aiSpecialistAgentRouter > model lỗi ⇒ phiên failed`) **XANH khi chạy riêng**, và **ĐỎ Y HỆT ở HEAD**
sau `git stash` với cùng tải song song ⇒ **nợ CÓ SẴN / nhiễu chạy song song, không phải hồi quy**.

## Chưa làm (nói thẳng)

- Dự án **không phải repo chính** vẫn không có ngữ cảnh mã (`khac-goc`) — muốn có thì phải dựng chỉ
  mục cho từng gốc; một hạng mục riêng, chưa đánh giá.
- **Chưa nghiệm thu LIVE** (chủ dự án giữ việc này): chưa build, chưa restart, chưa Playwright, không
  gọi model thật, không chạm CSDL, `sandbox-projects/` **0 thay đổi**.
