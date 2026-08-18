# 78 — Nâng AI local thành TÁC NHÂN LẬP TRÌNH cho kỹ sư làm code cả hệ thống

> **Trạng thái:** ✅ **ĐÃ DUYỆT** · 2026-08-18 · chủ dự án trả lời trực tiếp trong §7.
> Chủ dự án yêu cầu: *"nâng cấp giao diện code cho AI local giống Claude Code để kỹ sư làm code cả hệ thống"*.
>
> **Ba quyết định đã chốt** (nguyên văn ở §7):
> 1. **CÓ cho AI ghi tệp** ⇒ làm cả pha A, B, **C**.
> 2. **Hộp cát = chính repo này**, kèm hàng rào *"tệp có thay đổi chưa commit ⇒ TỪ CHỐI ghi"*.
> 3. **Ghim theo vai `engineer`/`admin`** qua `requiredPermission`, không mở cho mọi tài khoản.
>
> ⚠ Quyết định 1+2 cộng lại nghĩa là: một tác nhân sẽ **ghi thẳng vào cây làm việc thật**. Hàng rào
> "tệp bẩn" ở §4/PHA C vì thế **không phải một tuỳ chọn** — nó là điều kiện để quyết định 2 an toàn.
> Nó chặn đúng sự cố đã xảy ra hôm nay (§3 mục 1: mất 123 dòng chưa commit).

---

## 1. Khoảng cách THẬT — đo, không ước lượng

Tôi khảo sát trước khi vẽ kế hoạch. Kết quả làm đổi hẳn hình dạng việc phải làm: **phần khó nhất
đã có sẵn, phần còn thiếu lại đúng là phần nguy hiểm nhất.**

| Năng lực | Hiện trạng đo được | Còn thiếu |
|---|---|---|
| Vòng lặp tác nhân đa bước | ✅ `aiLocalTools/toolLoop.ts`, `AI_TOOL_LOOP_ENABLED=1`, đa bước 0/8 → **8/8** | — |
| Lập kế hoạch + lập lại kế hoạch | ✅ `aiAgentPlanner`, `aiAgentOrchestrator` (`AGENT_MAX_STEPS`, `AGENT_MAX_REPLANS`) | — |
| Gọi tool bản địa | ✅ `openaiGateway.ts` + `AI_NATIVE_TOOLCALLS_ENABLED=true` | — |
| Sổ đăng ký tool | ✅ **56 tool** | **0 tool chạm tệp, 0 tool chạy lệnh** |
| RAG trên chính repo này | ✅ 7.349 chunk, `repoContextService`, `code-graph.json` | — |
| Chữ gợi ý nội tuyến (ghost text) | ✅ `inlineCopilotExtension.ts`, model 1,5B riêng | — |
| Xem khác biệt (diff) | ✅ `diffHunks.ts`, `HunkDiffView.tsx` | áp diff xuống đĩa |
| Người-trong-vòng (HITL) | ✅ `proposeAction`/`confirmAction`, `isWriteTool`, `assertExecutable` | — |
| Nhật ký WORM | ✅ `audit_logs`, `control_audit_log` (`avi_app` bị thu hồi DELETE) | — |
| **Đọc/ghi tệp repo** | ❌ **không có** | **toàn bộ** |
| **Chạy lệnh (test, build, lint)** | ❌ **không có** | **toàn bộ** |
| **Không gian làm việc nhiều tệp** | ❌ | **toàn bộ** |

**Hai điều quan trọng nhất trong bảng trên:**

**(a) `repoContextService` CỐ Ý không nằm trong sổ đăng ký tool.** Docblock của chính nó viết:
> *"AN TOÀN: chỉ-đọc, KHÔNG có bất kỳ đường ghi nào; KHÔNG đăng ký vào toolRegistry nên LLM không
> thể tự gọi với tham số tuỳ ý — chỉ service gọi với danh sách file do NGƯỜI DÙNG nhập."*

Nghĩa là hôm nay LLM **không tự chọn được** file để đọc. Đó là một quyết định an toàn có chủ ý, và
kế hoạch này chính là **đề nghị đảo nó** — nên nó phải được đảo **có kiểm soát**, không phải bằng
cách gỡ dòng chú thích đó đi.

**(b) `aiProgrammingCopilot` phục vụ MIỀN KHÁC.** Nó viết chương trình **PLC/robot** cho thiết bị
(doc 09/D7 + doc 34/P2), không phải TypeScript của chính nền tảng. Đừng nhầm nó là "copilot code"
theo nghĩa Claude Code — hai thứ khác nhau, và ghép nhầm sẽ đẻ ra một cái nửa nạc nửa mỡ.

⇒ **Việc phải làm không phải "dựng một tác nhân lập trình". Việc phải làm là mở đúng bốn năng
lực còn thiếu, trên một nền tác nhân đã chạy được, mà không phá lớp an toàn đang giữ nó.**

---

## 2. Lằn ranh: cái gì làm cho Claude Code hữu dụng

Không phải model. Model 30B cục bộ đã đủ để viết mã (đo ở doc 76). Thứ tạo ra khác biệt là **vòng
phản hồi khép kín**:

```
đọc mã thật  →  đề xuất sửa  →  ÁP xuống đĩa  →  CHẠY test  →  đọc lỗi thật  →  sửa tiếp
```

Hôm nay vòng ấy **đứt ở nhịp thứ ba**. Trợ lý nói ra bản vá, con người chép tay, và mọi thứ học
được từ lượt chạy test **không quay lại được** với trợ lý. Đó là lý do nó cho cảm giác "biết nhiều
mà không làm được việc".

Nối được nhịp 3 và 5 là 80% giá trị. Giao diện đẹp là 20% còn lại — làm sau.

---

## 3. Rủi ro, nói thẳng trước khi nói lợi ích

Cấp cho một LLM quyền **ghi tệp + chạy lệnh** trên repo đang chạy sản xuất là thay đổi nguy hiểm
nhất từng đề xuất cho hệ này. Nguy hiểm hơn cả đợt phạm vi tenant vừa rồi, vì hỏng ở đây **không
lộ dữ liệu — nó phá mã nguồn**.

Ba đường hỏng cụ thể, không phải lo xa:

1. **Ghi đè công việc chưa commit.** Hôm nay đã xảy ra thật: một agent chạy `git checkout <file>`
   để hoàn nguyên một đột biến 1 dòng và **xoá mất 123 dòng chưa commit**. Bằng chứng nằm ngay
   trong đầu ra của chính nó (`git diff --stat` báo 124 insertions cho một sửa đổi 1 dòng) và nó
   đọc lướt qua.
2. **Chạy lệnh phá huỷ.** `rm -rf`, `git reset --hard`, `DROP TABLE`, `npm publish`.
3. **Rò bí mật.** Repo có `.env` với khoá CSDL, `MASTER_API_KEY`, `ANH_KY_SECRET`. Một tool đọc
   tệp tuỳ ý là một đường rò `.env` thẳng vào cửa sổ chat — và từ đó vào nhật ký, vào bộ nhớ đệm
   câu trả lời, vào bất kỳ nơi nào câu trả lời được lưu.

**Kết luận thiết kế: bốn năng lực mới KHÔNG được là bốn tool bình thường.** Chúng phải đi qua đúng
lớp mà repo đã dựng cho write-tool (`isWriteTool` → `proposeAction` → `confirmAction`), cộng thêm
một hàng rào riêng cho hệ tệp.

---

## 4. Kế hoạch — bốn pha, mỗi pha có cổng ra ĐO ĐƯỢC

### PHA A — Đọc có kiểm soát (nền của mọi thứ)

Mở cho LLM tự chọn file để đọc, nhưng trong một **hộp cát tường minh**.

- `read_file`, `list_files`, `grep_repo` — đăng ký vào `toolRegistry` như **read tool**.
- **Gốc hộp cát khai bằng đường dẫn tuyệt đối**, mặc định là thư mục repo. Mọi đường đi qua
  `path.resolve` rồi kiểm **tiền tố**; `..`, đường tuyệt đối, symlink trỏ ra ngoài ⇒ **từ chối có
  mã**. (Hôm nay đã có tiền lệ dùng được: `server/routes/_uyQuyenAnh.ts` soi **từng đoạn** đường
  dẫn — bản đầu chỉ soi đầu chuỗi và `C:` ở GIỮA lọt qua.)
- **Danh sách cấm đọc**: `.env*`, `*.pem`, `*.key`, `node_modules/`, `dist/`, `.git/`.
  Đi kèm `redactSecretsOnly()` đã có, **hai lớp**, đúng khuôn `repoContextService`.
- **Trần**: số tệp/lượt, số byte/tệp, số byte/phiên.

**Cổng ra:** một lưới **điều tra dân số** (khuôn `toolNoteCensus.test.ts`) khẳng định không đường
nào ra khỏi hộp cát; **đột biến bắt buộc**: gỡ phép kiểm tiền tố ⇒ ĐỎ; `..` ⇒ ĐỎ; đọc `.env` ⇒ ĐỎ;
và **chống vá quá tay**: đọc một file mã bình thường vẫn CHẠY.

### PHA B — Chạy lệnh trong danh sách TRẮNG

- `run_command` — **write tool**, đi qua `proposeAction`/`confirmAction`.
- **Danh sách TRẮNG, không phải danh sách đen.** Danh sách đen luôn có phần tử thứ N+1; repo này
  đã bị khuôn N+1 cắn nhiều lần và có hẳn một tên gọi cho nó. Trắng: `npm run check`,
  `npm run check:tests`, `npx vitest run <đường>`, `npm run build`, `git status`, `git diff`.
- **`git checkout`, `git reset`, `rm`, `DROP` KHÔNG bao giờ vào danh sách trắng** — xem §3 mục 1.
- Hạn thời gian, hạn kích thước đầu ra, chạy trong thư mục repo, **không có mạng**.

**Cổng ra:** đột biến — thêm một lệnh ngoài danh sách trắng ⇒ ĐỎ; hạn thời gian bị gỡ ⇒ ĐỎ.

### PHA C — Ghi tệp qua NGƯỜI DUYỆT

- `apply_diff` — **write tool**, và **không bao giờ tự chạy**: nó dựng một *đề xuất*, người bấm
  duyệt, rồi mới chạm đĩa. Dùng lại `HunkDiffView.tsx` + `diffHunks.ts` đã có.
- **Điều kiện tiên quyết, không thương lượng:** trước khi ghi, kiểm `git status`. **Tệp có thay
  đổi chưa commit ⇒ TỪ CHỐI**, kèm câu nói rõ vì sao. Đây là hàng rào cho đúng sự cố đã xảy ra
  hôm nay.
- Mỗi lượt ghi vào **nhật ký WORM** (`audit_logs`): ai, tệp nào, băm trước/sau.

**Cổng ra:** âm đối xứng — đề xuất chưa duyệt **không** chạm đĩa (kiểm băm tệp), đã duyệt thì
chạm; tệp bẩn ⇒ từ chối; đột biến gỡ phép kiểm `git status` ⇒ ĐỎ.

### PHA D — Không gian làm việc

Chỉ làm **sau khi** A–C xanh. Giao diện là phần dễ nhất và ít giá trị nhất; làm trước là bẫy.

- Khung ba phần: cây tệp · trình soạn thảo + diff · hội thoại tác nhân.
- Dòng chảy: hỏi → tác nhân đọc → đề xuất diff → người duyệt → chạy test → **đọc lỗi thật rồi
  sửa tiếp** (nhịp này mới là thứ tạo cảm giác "như Claude Code").
- Dùng lại `ProgrammingCopilotDock`/`Panel`, `EngineeringWorkspace`, `engineeringStream.ts`.

---

## 5. Cái KHÔNG làm, và vì sao

- **Không cho tác nhân tự commit/push.** Con người commit. Hôm nay repo có ~300 tệp chưa commit
  suốt nhiều giờ; một tác nhân tự commit trong trạng thái ấy là không thể xem lại được.
- **Không cho chạy lệnh tuỳ ý** kể cả sau xác nhận. Danh sách trắng là danh sách trắng.
- **Không huấn luyện lại model.** Doc 76 đã đo: nút thắt không nằm ở model.
- **Không làm giao diện trước.** Xem §4 PHA D.

---

## 6. Chi phí và thứ tự

| Pha | Khối lượng | Rủi ro | Giá trị |
|---|---|---|---|
| A — đọc | nhỏ | **thấp** | mở khoá mọi thứ sau |
| B — chạy lệnh | nhỏ | trung bình | nối được nhịp "đọc lỗi thật" |
| C — ghi tệp | trung bình | **CAO** | nối được vòng khép kín |
| D — giao diện | lớn | thấp | trải nghiệm |

Đề nghị: **làm A trước, dùng thử một tuần, rồi mới quyết B.** Riêng A đã đủ để trợ lý trả lời
"hàm này gọi ở đâu, đổi nó gãy chỗ nào" bằng mã THẬT thay vì bằng mảnh RAG — và đó là câu hỏi kỹ
sư hỏi nhiều nhất.

---

## 7. Ba câu cần chủ dự án quyết

1. **Có chấp nhận cho AI ghi tệp không?** Nếu KHÔNG, dừng ở pha A+B: trợ lý đọc được mã thật và
   chạy được test, người vẫn chép tay bản vá. Vẫn hơn hôm nay rất nhiều, và **rủi ro gần bằng 0**. 
   -> CÓ cho ghi
2. **Hộp cát là repo này, hay một bản sao (worktree) riêng?** Bản sao an toàn hơn hẳn nhưng kỹ sư
   phải tự trộn ngược. Tôi nghiêng về **repo này + hàng rào "tệp bẩn thì từ chối"** vì bản sao sẽ
   ít người dùng.
   ->  **repo này + hàng rào "tệp bẩn thì từ chối"**
3. **Ai được dùng?** Đề nghị ghim theo vai (`engineer`/`admin`), đi qua đúng `requiredPermission`
   mà 56 tool hiện có đang dùng, chứ không mở cho mọi tài khoản đăng nhập.
   -> Đồng ý
