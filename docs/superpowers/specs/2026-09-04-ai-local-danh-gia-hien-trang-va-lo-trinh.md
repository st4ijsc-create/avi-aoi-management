# AI Local cho lập trình viên — đánh giá hiện trạng, giới hạn, và lộ trình

**Ngày:** 2026-09-04 · **Người viết:** phiên điều phối extension VSCode
**Mục đích:** để chủ dự án nhìn thấy AI Local **làm được gì**, **đến đâu**, **cần gì tiếp**, và
**huấn luyện thế nào** — rồi quyết định.

> **Quy tắc của tài liệu này:** mọi con số đều **đo được**, kèm chỗ đo. Chỗ nào chưa đo, ghi thẳng
> là **chưa đo**. Không có câu nào là ước lượng trình bày như sự thật.

---

# 1. Kết luận ngắn (đọc phần này là đủ để quyết định)

**AI Local hôm nay là một trợ lý đọc-mã trong VSCode chạy được, nhưng đang phục vụ SAI KHO TRI THỨC.**

Extension đã có gần đủ bộ khung của một công cụ như Claude Code: thanh bên, chat nhiều vòng, đọc
tệp, `@`-mention, đính kèm, lịch sử, bộ nhớ, ba mức quyền, gọi plugin MCP, cửa duyệt trước khi ghi
đĩa. **844 ca lưới xanh**, census an toàn **22/22**, chạy thật trong VSCode host (23+17 ca).

Nhưng **tỉ lệ hoàn thành tác vụ đầu-cuối đo được chỉ 6/11 (≈55%)**, và gốc rễ **không phải model
yếu** — mà là **lệch miền**:

| | Extension phục vụ | Máy chủ biết |
|---|---|---|
| Dự án | **bất kỳ** repo đang mở trong VSCode | **chỉ** repo `avi-aoi-management` |
| Ngôn ngữ | bất kỳ (đọc được cả `.cs`) | `.ts .tsx .js .mjs .cjs .sql` — **0 chunk C#** |
| Miền | mã nguồn của lập trình viên | vận hành nhà máy + mã của repo này |

Anh mở `machine-simulator` (C#/.NET) và hỏi "tóm tắt dự án" — **máy chủ không có một dòng nào về dự
án đó**, nên nó trả lời bằng thứ nó có: tri thức nhà máy. Đó là lý do gốc của phần lớn câu trả lời
sai, kể cả sự cố "từ chối quyền OEE" hôm nay.

**Khuyến nghị: đừng huấn luyện model vội.** Việc đáng làm trước là **cho AI đúng ngữ cảnh** —
rẻ hơn, nhanh hơn, và giải quyết đúng nguyên nhân đã đo được. Chi tiết ở §7-§8.

---

# 2. Hệ thống hiện tại — đo được

## 2.1 Model và phần cứng

| Thành phần | Giá trị đo được |
|---|---|
| Model sinh chữ | `qwen3-30b-a3b-instruct` (GGUF, llama.cpp) |
| Model nhúng | `mxbai-embed-large` |
| Phần cứng | RTX 5090 32GB · i7-12700KF · 48GB RAM |
| Ràng buộc | 32GB VRAM ⇒ **một** instance 30B tại một thời điểm (đã đo ở các đợt VRAM) |

## 2.2 Kho tri thức (RAG)

**8.225 chunk · 173MB embeddings.** Thành phần đo được:

| `sourceType` | Số chunk | Ghi chú |
|---|---|---|
| `doc` | 4.792 (58%) | từ `docs/` (4.593) + `apidocs/` |
| `service` | 1.325 | mã `server/` |
| `type` | 1.022 | kiểu TS |
| `router` | 393 | |
| `operational` | 193 | thẻ vận hành nhà máy |
| `feature`/`domain`/`schema_table`/… | ~300 | |

Theo thư mục gốc: `docs` 4.593 · `server` 2.432 · `knowledge` 525 · **`client` chỉ 241** ·
`drizzle` 210 · `shared` 25.

★ **Kho này là về CHÍNH repo `avi-aoi-management`**, và nghiêng nặng về **tài liệu + backend**.
Frontend gần như vắng mặt (241/8.225 ≈ 3%).

## 2.3 Đường sinh kho tri thức

`scripts/ai-kb/extract-codebase-knowledge.mjs` → `kb:chunk` → `kb:embed`:

- `ROOT = process.cwd()` ⇒ **quét đúng repo mà anh chạy lệnh trong đó** — pipeline **không gắn
  cứng** vào repo này, nên **chạy được cho dự án khác** (điểm mấu chốt của §7).
- `TARGET_DIRS = ["server","client","shared","drizzle"]` · `DOC_DIRS = ["docs","apidocs"]`
- Đuôi nhận: `.ts .tsx .js .mjs .cjs .sql` — ★ **không có `.cs`, không có `.py`, `.java`, `.cpp`**
- Đo xác nhận: `grep -c '\.cs"' knowledge/chunks.jsonl` ⇒ **0**

## 2.4 Hạ tầng huấn luyện — **có thật**, không phải khung rỗng

- `server/services/aiLlmFinetuneSidecar.ts` (**có lưới**) — LoRA fine-tune sidecar
- `server/routers/kbStudioRouter.ts` phơi: `listCorpora` · `createCorpus` · `deleteCorpus` ·
  `ingestDocumentJob` · `ingestUrlJob` · `corpusPreview` · **`startFinetune`**
- Cổng: **admin/engineer + 2FA**, kỷ luật **không bao giờ tự kích hoạt bản mới**
- ★ Docblock của chính nó đã ghi câu khung đúng: **"LoRA = phong cách, không phải sự kiện"**
- ⚠ `ModelBuilderTab.tsx` phía client **CHƯA nối** vào endpoint này (nợ đã ghi rõ trong mã)

---

# 3. Extension làm được gì HÔM NAY

Tất cả đều có lưới và phần lớn đã đo live.

**Đọc và hiểu mã**
- Ba tool CHỈ ĐỌC: `doc_tep` · `liet_ke` · `grep` — chạy trên **workspace đang mở**, **mọi ngôn ngữ**
  (lưới của chính nó dùng `Calculator.cs`)
- Vòng tác nhân nhiều lượt, trần 3 vòng, có nút Dừng cắt được thật
- `@`-mention + nút đính kèm tệp; thanh trạng thái ngữ cảnh

**Sửa mã (có cửa duyệt)**
- Đề xuất diff → thẻ duyệt → ghi đĩa qua **đúng MỘT điểm ghi** (`apBanVa.ts`)
- Ba mức quyền: **Chỉ đọc** · **Hỏi trước khi ghi** (mặc định) · **Tự ghi trong workspace**
- Cmd+K sửa đoạn đang bôi đen

**Hạ tầng**
- Thanh bên (cả `activitybar` lẫn `secondarySidebar` như Claude Code)
- Đăng nhập một lần, tự khôi phục phiên
- Lịch sử hội thoại bền theo dự án; bộ nhớ dài hạn xem/xoá được
- **MCP client**: gọi được plugin ngoài (đã bắt tay thật với `npx @modelcontextprotocol/server-everything`, 13 tool)

**Hàng rào an toàn — chặn bằng KIẾN TRÚC, không bằng bộ lọc**
- `.env`, khoá riêng, `.git/**` **không rời máy** qua bất kỳ đường nào (đã đo trên đĩa thật)
- Kết quả tool ngoài và nội dung bộ nhớ **không bao giờ được quét tìm lệnh** ⇒ không tiêm lệnh được
- `chi_doc` chặn tại **điểm ghi**, không phải ẩn nút; `tu_ghi` chỉ bỏ bước **hỏi**, không bỏ **hàng rào**
- Tệp EOL lẫn lộn **fail-closed** (VSCode chuẩn hoá cả tệp lúc `save()`)

---

# 4. Làm được ĐẾN ĐÂU — số đo thật

| Chỉ số | Giá trị | Nguồn |
|---|---|---|
| **Hoàn thành tác vụ đầu-cuối** | **6/11 (≈55%)** | H4, N=11, mẫu độc lập |
| Tuân thủ giao thức ĐỌC | **5/6** | H4/H5/H6 |
| Gọi tool MCP (`mcp_goi`) | **2/3 đúng + 1/3 gần đúng** | H6 |
| Đề xuất nhớ (`de_xuat_nho`) | **0/5** | H4, H5, H6 — **chưa từng chạy** |
| Rò rác giao thức ra giao diện | **0/42** | vòng PDCA 2 |
| Tên tool lạ trong câu trả lời | **0/57** | vòng PDCA 7 |
| Thời gian mỗi lượt (trung vị) | **3.792ms** (trước: 8.623ms) | vòng PDCA 6 |
| Lưới đơn vị / census / host thật | **844 / 22-22 / 23+17** | hôm nay |

★ Lịch sử con số đầu-cuối: đường cơ sở thật **1/11 (9%)** → vá rò giao thức **5/11** → vá tác vụ
viết mã **7/11** → đo lại N=11 với mẫu độc lập **6/11**. Dao động 6↔7 nằm trong nhiễu của model
(hai tác vụ đo được là **DAO ĐỘNG**, không ổn định).

---

# 5. Cần phải làm gì tiếp — theo thứ tự giá trị

## 5.1 ★★★ Lệch miền tri thức (nguyên nhân gốc, chưa xử)

**Triệu chứng đã gặp:** hỏi "tóm tắt dự án đang mở" ⇒ trả lời về quyền OEE nhà máy.

**Bốn lần cùng một họ lỗi đã đo được** — giáo cụ hoặc mã của người dùng làm nhiễu bộ định tuyến
phía máy chủ:
1. `intentClassifier` hiểu giáo cụ thành câu hỏi vận hành ⇒ chạy tool nhà máy sai
2. `boDauTiengViet` gộp **"kỹ"** và **"kỳ"** thành `"ky"` ⇒ trúng trigger `get_ng_compare`
3. `"Liệt kê một thư mục:"` trong giáo cụ khớp `LIST_INTENT_RE` ⇒ ép **mọi** câu VSCode thành `intent:"list"`
4. **Hôm nay:** `performance` / `quality` / `yield` là trigger của công cụ OEE — mà đó là **từ vựng
   lập trình bình thường**. Một dòng `// improve performance later` trong mã anh là đủ kích hoạt.
   ⚠ **Đã vá** (`90285e7a`) nhưng **chưa build lại `dist/index.js` trên cổng 3003** ⇒ anh vẫn gặp lỗi.

**Ba rủi ro cùng loại đã ghi, chưa vá** (chưa có tái hiện thật): trigger `availability` ·
`bottleneck` trần trong `LINE_BALANCE_INTENT` · va chạm `"yield trend"` với `get_defect_trend`.

## 5.2 ★★ Kho tri thức không biết dự án của người dùng

Anh mở `machine-simulator` (C#) — KB có **0 chunk C#**. AI chỉ biết dự án đó qua **ba tool đọc**
của extension, tức phải đọc từng tệp một trong trần 3 vòng. Với một solution lớn, đó là **không đủ
để "tóm tắt tổng quan"**.

## 5.3 ★★ `de_xuat_nho` chưa từng chạy (0/5)

Đã thử hai đường (dạy đầu prompt, nhắc cuối prompt) — **ablation cho thấy tác dụng bằng không**.
Nghi giới hạn **tầng chú ý của model**, không phải định tuyến. **Chưa nên vá mò tiếp.**

## 5.4 ★ Nợ cũ còn mở

Cmd+K hiện thẻ duyệt **1/5** (nguyên nhân mới: va chạm `"lời"`/`"lỗi"` sau bỏ dấu ⇒ ép
`intent:"troubleshoot"`) · chưa tạo được tệp mới · tệp EOL lẫn lộn bị từ chối theo thiết kế.

---

# 6. Huấn luyện thế nào — và **khi nào KHÔNG nên huấn luyện**

## 6.1 Ba tầng "dạy", từ rẻ tới đắt

| Tầng | Dạy được gì | Chi phí | Đảo ngược |
|---|---|---|---|
| **1. Ngữ cảnh / prompt** | quy tắc, giao thức, định dạng | phút | tức thì |
| **2. RAG (kho tri thức)** | **SỰ KIỆN** về mã, tài liệu, quyết định | giờ | xoá corpus |
| **3. LoRA fine-tune** | **PHONG CÁCH**, giọng văn, thói quen định dạng | ngày + VRAM | đổi bản model |

★★★ **Nguyên tắc đã ghi sẵn trong mã dự án này:** *"LoRA = phong cách, không phải sự kiện."*
Fine-tune **không** làm model biết mã của anh. Muốn nó biết mã ⇒ **RAG**, không phải LoRA.

## 6.2 Vì sao **chưa** nên fine-tune bây giờ

- Vấn đề đo được là **lệch miền** và **định tuyến sai** — cả hai **không** phải thứ LoRA sửa được.
- 32GB VRAM đang đủ cho **một** instance 30B; huấn luyện sẽ tranh chấp tài nguyên với chính dịch vụ
  đang chạy.
- Chưa có **bộ đánh giá** để biết bản fine-tune tốt hơn hay tệ hơn. Huấn luyện mà không có thước đo
  là đổi một hệ thống đo được lấy một hệ thống không đo được.
- `ModelBuilderTab.tsx` **chưa nối** vào `startFinetune` ⇒ còn việc kỹ thuật trước khi bấm được.

## 6.3 Khi nào **nên** fine-tune

Khi cả ba điều sau đúng: (a) RAG đã đúng miền và tỉ lệ đầu-cuối đã ổn định trên **80%**;
(b) vấn đề còn lại là **phong cách** (giọng văn, định dạng, thói quen tiếng Việt) chứ không phải
kiến thức; (c) đã có bộ đánh giá ≥30 tác vụ để so bản cũ/bản mới.

---

# 7. Tài liệu huấn luyện lấy từ đâu

## 7.1 Nguồn đã có sẵn, chỉ cần dùng đúng

| Nguồn | Quy mô | Trạng thái |
|---|---|---|
| `docs/` + `apidocs/` của repo này | 4.792 chunk | ✅ đã trong KB |
| Mã `server/`, `shared/`, `drizzle/` | 2.432 chunk | ✅ đã trong KB |
| Mã `client/` | 241 chunk | ⚠ **thiếu nặng** (3%) |
| Thẻ vận hành | 193 chunk | ✅ |
| **Mã dự án KHÁC** (machine-simulator, C#) | **0** | ❌ **chưa có** |
| KB Studio: `ingestDocumentJob` / `ingestUrlJob` | — | ✅ có sẵn, ít dùng |

## 7.2 ★★★ Điểm mấu chốt: pipeline đã **repo-agnostic**

`extract-codebase-knowledge.mjs` dùng `ROOT = process.cwd()`. Nghĩa là **chạy nó trong thư mục dự
án nào thì nó học dự án đó** — không cần viết lại kiến trúc.

Việc cần làm chỉ là **hai thứ nhỏ**:
1. Thêm đuôi tệp: `.cs`, và các ngôn ngữ khác anh dùng
2. Cho phép **nhiều corpus** (KB Studio đã có `createCorpus`) và chọn corpus theo workspace đang mở

## 7.3 Nguồn nên bổ sung

- **Tài liệu nội bộ** đã có trong `docs/handoff`, `docs/plans` của từng dự án
- **Lịch sử quyết định**: các tệp `owner-decisions*.md` anh đang có trong machine-simulator
- **Tài liệu chuẩn ngành** (ISA-101, OPC UA…) qua `ingestUrlJob` — ⚠ nhà máy **không có internet**,
  nên phải tải về máy dev rồi nạp bằng `ingestDocumentJob`

---

# 8. Giải pháp tốt nhất — đề xuất theo thứ tự

## Việc 0 — làm ngay hôm nay (phút)

★ **Build lại `dist/index.js` và khởi động lại cổng 3003** để bản vá `90285e7a` có hiệu lực.
Không làm thì anh vẫn gặp đúng lỗi từ chối quyền OEE. **Cần anh cho phép** vì đó là tiến trình
đang phục vụ phiên của anh.

## Việc 1 — cho AI biết dự án đang mở (giá trị cao nhất, chi phí trung bình)

1. Thêm `.cs` (và ngôn ngữ khác) vào `SOURCE_EXT`
2. Chạy `kb:extract` + `kb:chunk` + `kb:embed` **trong thư mục `machine-simulator`** ⇒ corpus riêng
3. Extension gửi kèm **định danh workspace**; máy chủ chọn **đúng corpus**, và **không có corpus
   thì không ghép KB** thay vì ghép nhầm kho nhà máy

★ Đây là thứ trực tiếp sửa "hỏi về dự án, trả lời về OEE".

★★★ **ĐÃ LÀM PHẦN "TÀI LIỆU HÃNG"** (2026-09-04, `.superpowers/sdd/2026-09-03-vscode-extension-
dot-g/task-v1-report.md`) — **SỬA CHÍNH tài liệu này**: §7.1 ghi "Mã dự án KHÁC — 0 — ❌ chưa có" và
§10 ghi "toàn bộ §8 Việc 1 là đề xuất chưa kiểm" **SAI cho phần tài liệu hãng** — B1 (đo trước khi
sửa) phát hiện hạ tầng đa-corpus RIÊNG (`knowledge/programming/*`, `aiProgrammingKnowledgeService.ts`,
doc 34 P1) **đã tồn tại từ commit `a75bc8f9`, TRƯỚC CẢ tài liệu này**, với 91.678 chunk đã embedding
sẵn cho cả 6 hãng — brief mô tả hiện trạng như thể chưa có gì; đọc mã mới lộ ra khác. Việc thật đã
làm ở vòng này: (a) B3 — nạp nốt 16 PDF còn thiếu (thêm vào đĩa sau lượt 07-05, phát hiện qua so
khớp `sourcePath`) cho 4/6 hãng, **91.678 → 124.990 chunk (+36%), 53/53 PDF, 0 tệp scan/không đọc
được** — 33.312 chunk mới CHƯA embed (quyết định có chủ đích, tránh tranh VRAM với người dùng đang
dùng — xem CÒN MỞ #1 của report); (b) B4 — nối `route:"vscode"` (`retrieveKnowledge` trong
`aiLocalKnowledgeService.ts`) vào `searchProgrammingKb` bằng MỘT gate ở đầu hàm, TRƯỚC
`ensureDataLoaded()`, nên route vscode không chạm kho vận hành một byte nào (đo bằng spy trên
`fs.readFileSync`, 0 lần gọi) — đóng đúng CÒN MỞ #5 mà Việc 2 để lại; (c) B5 — 6/6 câu hỏi thật
("Modbus Delta", "SDK Universal Robots status", "RS232 C# Delta ASDA", "MELSERVO J4 error code",
"EtherNet/IP Omron NJ", "FANUC KAREL variable") dẫn được citation ĐÚNG file/trang thật (keyword-only,
score 0,716–0,922 — đo an toàn VRAM, không gọi GGUF), trước đó cấu trúc KHÔNG THỂ (kho vận hành 0
chunk vendor); (d) phát hiện + vá thêm ngoài kế hoạch: câu hỏi vận hành thuần vẫn nhận NHIỄU điểm
thấp (0,29–0,35) từ ĐÚNG corpus lập trình — thêm ngưỡng `MIN_PROG_KB_CITATION_SCORE=0.5` để trả RỖNG
thay vì nhồi nhiễu; (e) B2 — `.cs .py .java .cpp .st .scl` đã thêm vào `SOURCE_EXT` của
`extract-codebase-knowledge.mjs` (script `kb:chunk` cho kho VẬN HÀNH/repo-của-chính-nó, KHÁC corpus
tài liệu hãng) — 0 chunk đổi trên CHÍNH repo này (0 tệp các đuôi đó), có tác dụng khi chạy script
TRONG một repo C# khác (vd `machine-simulator` — CHƯA làm, xem dưới). Ablation 2 lượt (gate route +
ngưỡng nhiễu) đều xác nhận load-bearing — chi tiết đầy đủ trong report. **CÒN MỞ, CHƯA LÀM**: mục 2/3
ở trên (chạy `kb:extract` TRONG `machine-simulator`, chọn corpus theo workspace mở) **VẪN CHƯA LÀM**
— phạm vi vòng này chỉ xử tài liệu HÃNG (PDF), không xử MÃ DỰ ÁN RIÊNG của người dùng; 33.312 chunk
mới chưa embed; `dist/index.js` cổng 3003 chưa build lại (cần go-ahead, người dùng đang dùng thật).

## Việc 2 — tách hẳn hai miền (giá trị cao, chi phí thấp)

Với `route:"vscode"`: **không** dùng bộ trigger công cụ nhà máy, **không** ghép KB vận hành khi độ
liên quan dưới ngưỡng. Bốn sự cố ở §5.1 đều là cùng một nguyên nhân: **hai miền dùng chung một bộ
định tuyến**. Vá từng trigger là **chữa triệu chứng**; tách miền là **chữa gốc**.

★★★ **ĐÃ LÀM** (2026-09-04, `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-v2-report.md`,
`aiLocalKnowledgeService.ts`) — hai điểm sửa, cả hai khoá vào `context.route==="vscode"`: (1)
`streamAnswer` không còn gọi `tryExecuteToolLoop`/bộ chọn tool vận hành cho route vscode NỮA, kể cả
khi bóc giáo cụ thành công (khác vòng 8 trước đó — vòng 8 vẫn cho tool chạy trên phần câu hỏi thật);
(2) `retrieveKnowledge` ép `intent="general"` cho route vscode, vô hiệu hoá cả 6 regex `*_INTENT`
cùng lúc (gốc rễ sự cố 3, và cũng vá luôn "Cmd+K chỉ hiện thẻ duyệt 1/5" — va chạm "lời"/"lỗi" ép
`troubleshoot`). **Cơ chế chống tái diễn**: một trigger/regex MỚI ở bất kỳ đâu trong 54 tool nhà máy
không còn CÁCH NÀO chạm route vscode nữa, vì hai hàm đọc chúng (`classifyToolIntent`/`classifyIntent`)
không còn được GỌI cho route này — không phải bị lọc sau khi chạy. Đo: lưới `aiLocalKnowledge.
vscodeRouteGate.test.ts` 28/28 xanh (0→9 đỏ khi ablation gỡ 2 điều kiện, dán output thật trong báo
cáo); phạm vi hồi quy hẹp (aiLocalTools/ + 4 tệp liên quan) 1148→1153/1153 xanh, 0 đỏ; `tsc --noEmit`
0 lỗi. **CÒN MỞ**: `dist/index.js` cổng 3003 chưa build lại (cần go-ahead vì server đang phục vụ
người dùng thật) ⇒ chưa đo LIVE qua HTTP; đánh đổi có chủ đích — câu hỏi vận hành gõ thẳng vào panel
LOCAL không còn được tool trả lời qua route vscode nữa; Việc 1 (KB đúng theo workspace) vẫn CHƯA làm,
route vscode vẫn quét chung kho KB vận hành.

## Việc 3 — dựng bộ đánh giá trước khi nghĩ tới huấn luyện

≥30 tác vụ thật trên dự án thật, chấm theo **kết cục người dùng nhận được**, chạy được lặp lại.
Không có thước này thì mọi cải tiến sau đều là lời khai.

★★★ **ĐÃ LÀM** (2026-09-04, `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-v3-report.md`)
— B1 (đo trước khi thêm gì) phát hiện: **7/10 lệnh eval hiện có chạy được hôm nay** (toolcall
regex 0,942 accuracy trên registry 83 tool — không phải 77 như README 08-16; rag-operational
baseline hitRate@5 0,982/precision@5 0,493, ép CPU an toàn qua `GGUF_GPU=false` chiếm ĐÚNG 0 byte
VRAM; GraphRAG lift +0,000 xác nhận lại 08-16). **3/10 KHÔNG chạy được, lý do cụ thể đã đo**:
`--rerank` (model KHÁC model server đang giữ, GPU 97,5% đầy, mẫu con 2 ca không xong trong 120s
trên CPU), `eval-codegen.mjs` đầy đủ (GGUF_CODE_MODEL≠LLAMA_SERVER_MODEL, cần thêm ~18-20GB VRAM
không có), `eval-specialist.mjs` đầy đủ (an toàn VRAM vì dùng CHUNG model với server, nhưng 8 ca
không mẫu-con-được và chiếm hàng chục phút hàng đợi suy luận của người dùng thật — cần xin phép).

B2 (đối chiếu miền) phát hiện điều **quan trọng hơn cả 4 miền brief hỏi**: sau Việc 1+2, tool-loop
tắt hẳn cho route vscode và corpus vận hành route vscode không còn đọc ⇒ **200/218 ca offline hiện
có (`toolcall-cases.json` 82 + `codegen-cases.json` 29 + 4 bộ rag-operational* 92) đo một cơ chế
route vscode KHÔNG CÒN CHẠM TỚI** — chỉ `rag-cases.json` đo đúng corpus, nhưng có `vendor` lọc sẵn
mà route thật không nhận được từ client, bỏ qua bước "model tự đoán hãng". Bốn miền người dùng:
**C# = 0 ca, Web/IoT module = 0 ca, RS232/serial = 0 ca thật** (case "serial" trong toolcall/rag-
operational là tra cứu SỐ SERI sản phẩm, KHÔNG PHẢI giao tiếp cổng RS232 — nhầm lẫn thuật ngữ của
brief, đã sửa); PLC/Robot phủ trung bình, Delta/Fanuc/Omron yếu nhất (2 ca RAG-only, 0 oracle sinh
mã mỗi hãng), 4 ca "robot" (`robot-tm`) thực ra kiểm hãng **Techman**, ngoài 6 hãng brief nêu.

B3: **+6 ca** vào `rag-cases.json` (15→21), một ca/hãng, miền RS232/serial — mỗi ca **verify tay**
trên chunk thật (`docTitle`+trang+từ khoá xác nhận có trong `text`, không đoán từ tên tài liệu).
Đo ngay: 20/21 hit (0,952), 1 miss thật (`serial-mitsubishi-rs232-melsec`, không sửa cho đẹp điểm).

B4 (★★★ trọng tâm): bộ MỚI `scripts/ai-eval/eval-vscode-route.mjs` +
`scripts/ai-eval/vscode-route-cases.json` — POST **thật** `/api/ai/local-kb/stream` qua login thật
(`engineer1`/`User@123`) với `context:{route:"vscode", codingMode:false}` (khớp "chế độ LOCAL" thật
của extension). Chấm theo SSE thật (citation + answer), không suy diễn từ mã. Chống cache
(`answerCache` khoá KHÔNG có `route`, mỗi câu mang token `[ts=...]`) — bằng chứng mẫu độc lập: câu
hỏi grounded lặp lại 3 lần KHÔNG token: 3567ms→28ms(cached:true)→13ms(cached:true). Bắt được MỘT
bug trong chính harness mới (so khớp hãng "universal-robots" vs "Universal Robots" — đã sửa) và
HAI phát hiện chất lượng KHÔNG bộ cũ nào bắt được (đều nhờ route thật KHÔNG lọc `vendor` sẵn):
(a) câu hỏi UR ("URScript movel") nhận 5/5 citation từ tài liệu robot của **Delta** (hãng khác),
score 0,747-0,775 — nhầm hãng thật; (b) câu hỏi web/IoT (gap-probe, không có nguồn thật) vẫn nhận 5
citation Mitsubishi CPU manual **score 0,85-0,91**, TRÊN xa ngưỡng lọc 0,5 — model không dùng
(trả lời trung thực "không có thông tin") nhưng citation vẫn đính kèm, có thể gây hiểu lầm nếu UI
hiển thị như nguồn thật.

B5 (đường cơ sở mới, lặp lại được — `node scripts/ai-eval/eval-vscode-route.mjs`): **11 ca — 7 ĐẠT
/ 3 SAI / 1 CHẶN-ĐÚNG, elapsedMs trung bình 3.014ms** — con số ĐẦU TIÊN đo "kết cục người dùng nhận
được qua route thật" (trước Việc 3: 0/218 ca cũ đo đúng cơ chế này, xem B2). ⚠ **Không đạt mốc "≥30
tác vụ thật" của mục tiêu gốc bên trên** — quyết định có chủ đích: 11 ca route-thật (chất lượng ưu
tiên hơn số lượng, mỗi ca cạnh tranh hàng đợi suy luận với người dùng thật đang dùng) + 21 ca
`rag-cases.json` offline (không đi qua route, nhưng verify tay từng chunk) = 32 ca CÓ GROUNDING
thật, nhưng chỉ 11/32 đi qua đúng đường HTTP. Vòng sau nên mở rộng bộ B4 (thêm ca cho Delta/Fanuc/
Omron — hiện yếu nhất) nếu muốn chạm mốc 30 ca **qua route thật**.

**CÒN MỞ**: ngưỡng `MIN_PROG_KB_CITATION_SCORE=0,5` không tổng quát hoá cho câu lạc-miền-kiểu-khác
(phát hiện b ở trên); VSC-08 nhầm hãng UR↔Delta chưa vá; `eval-vscode-route.mjs` chưa có cổng CI
(cố ý — gọi model 30B thật qua HTTP, không hợp CI tự động); nghi ngại chưa truy tới cùng:
`eval-rag-programming.mjs` với `GGUF_GPU=false` (không ép lệch tên model) thoát êm exit 0 sau ~30s
không in kết quả — không gây hại (đã kiểm GPU/server), nghi `vramBroker`/ước lượng VRAM có
`process.exit()` trần hoặc một Promise không settle, chưa truy vì ngoài phạm vi và GPU đang chia
sẻ với người dùng thật; đầy đủ trong `task-v3-report.md`.

## Việc 4 — chỉ khi Việc 1-3 xong: cân nhắc LoRA cho **phong cách**

Và chỉ khi đo được rằng phần còn thiếu là phong cách, không phải kiến thức.

---

# 9. Anh cần quyết định

1. **Cho phép khởi động lại cổng 3003 bây giờ?** (Việc 0 — bản vá hôm nay chưa ăn nếu không)
2. **Ưu tiên Việc 1 (nạp dự án của anh vào KB) hay Việc 2 (tách hai miền) trước?**
   → Khuyến nghị của tôi: **Việc 2 trước** (rẻ hơn, sửa gốc bốn sự cố đã đo), rồi Việc 1.
3. **Những dự án nào cần AI Local biết?** Cho tôi danh sách thư mục, tôi dựng corpus.
4. **Có muốn tôi dựng bộ đánh giá 30 tác vụ (Việc 3) không?** — nó là điều kiện cần trước khi bàn
   chuyện huấn luyện.

---

# 10. Phần CHƯA đo — nói thẳng

- **Chưa nghiệm thu bằng mắt người dùng** cho Đợt G/H (đã cài, chờ anh dùng và phản hồi).
- **Chưa đo** AI Local trên một dự án C# thật (chỉ có lưới với một tệp `Calculator.cs` tổng hợp).
- **Chưa đo** chất lượng RAG sau khi nạp corpus mới — toàn bộ §8 Việc 1 là **đề xuất chưa kiểm**.
- **Chưa biết** trần thực tế của `qwen3-30b` với ngữ cảnh mã lớn; trần 3 vòng đọc là **chọn**, chưa
  phải kết quả tối ưu hoá.
- Server đang chạy với `KB_QA_CACHE_TTL_MS` **không mặc định** ở một tiến trình (dùng cho đo) —
  cần trả lại trước khi kết luận về hiệu năng thật.

---

# 11. ★★★ ĐÍNH CHÍNH (2026-09-04, sau khi thực thi Việc 1)

**§2.2 và §7 của tài liệu này SAI ở một điểm chịu lực.** Tôi đo `knowledge/chunks.jsonl` — kho
**vận hành** — rồi kết luận về **cả hệ thống**. Đo một kho, kết luận về hai.

**Sự thật đo được sau đó:** một hạ tầng **đa-corpus riêng cho tài liệu hãng ĐÃ TỒN TẠI từ trước**
(`knowledge/programming/*`, `server/services/aiProgrammingKnowledgeService.ts`, doc 34 P1, commit
`a75bc8f9`), với **91.678 chunk đã nhúng cho cả sáu hãng**, và `PROG_KB_ENABLED=true` bật sẵn
trong `.env`.

⇒ Lỗ hổng thật **chưa bao giờ** là "chưa có corpus tài liệu hãng". Nó là: **route `vscode` chưa
được nối vào corpus đó** — đúng món CÒN MỞ #5 mà chính báo cáo Việc 2 đã ghi.

★ Bài học lặp lại lần thứ mười ba trong dự án: **brief của người điều phối phải được kiểm lại bằng
mã trước khi thực thi.** Agent đã kiểm và bác bỏ tiền đề của tôi — đúng.

## Đã làm được (đo được, đã triển khai lên cổng 3003)

| Việc | Kết quả đo |
|---|---|
| Thêm `.cs .py .java .cpp .st .scl` vào bộ trích xuất | +0 chunk **trên repo này** (không có tệp loại đó ở đây) — có tác dụng khi quét dự án của người dùng |
| 16 PDF hãng thêm sau lần nạp 05/07 chưa từng được nạp | đã nạp: **91.678 → 124.990 chunk (+36%)**, phủ **53/53 PDF**, **0 tệp là ảnh quét** |
| Nối route `vscode` vào corpus lập trình | `retrieveProgrammingKnowledgeForVscode()` + cổng đầu `retrieveKnowledge` |
| Ngưỡng trích dẫn | thêm `MIN_PROG_KB_CITATION_SCORE=0.5` (câu hỏi vận hành từng lấy trích dẫn nhiễu điểm thấp) |
| **Chất lượng miền người dùng** | **6/6** câu hỏi thật dẫn đúng nguồn hãng (điểm 0,716–0,922); **trước đó 0/6 về mặt cấu trúc** |
| Nghiệm thu LIVE trên 3003 | 3/3 câu (PLC Delta · SDK Universal Robots · RS232) trả **5 trích dẫn PDF** đúng hãng |
| Đường **web** | **không đổi** (đo bằng spy: 0 lần đọc kho vận hành cho route vscode) |
| Ablation | gỡ cổng ⇒ 4/5 ca đỏ (có rò kho vận hành thật); gỡ ngưỡng ⇒ 1/7 đỏ |

## CÒN MỞ sau Việc 1

1. ★★ **33.312 chunk mới CHƯA NHÚNG** — cần GPU, mà GPU đang phục vụ model 30B của người dùng.
   **Cần quyết định của chủ dự án** về thời điểm chạy. Cho tới lúc đó, 16 PDF mới **chưa tìm được**.
2. `MIN_PROG_KB_CITATION_SCORE=0.5` là **một ngưỡng chọn**, chưa tối ưu hoá bằng đo.
3. Việc 2 làm câu hỏi **vận hành** gõ trong panel VSCode **không còn được tool trả lời** — đúng chủ
   ý tách miền, nhưng là đánh đổi người dùng sẽ cảm nhận được.
