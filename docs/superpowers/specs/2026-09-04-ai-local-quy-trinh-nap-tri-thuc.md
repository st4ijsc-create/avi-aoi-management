# AI Local — quy trình nạp tri thức (PDF · web · và các loại tài liệu khác)

**Ngày:** 2026-09-04 · **Cho:** chủ dự án, để tự nạp tài liệu mới cho AI Local
**Quy tắc:** mọi định dạng và lệnh dưới đây đều **đã kiểm trong mã**, không phải khuyến nghị chung chung.

---

# 1. Trước hết: "training" ở đây nghĩa là gì

Có **ba tầng** dạy AI, và chúng dạy được những thứ **khác nhau**. Chọn nhầm tầng là tốn công vô ích.

| Tầng | Dạy được | Chi phí | Đảo ngược |
|---|---|---|---|
| **1. Ngữ cảnh / lời nhắc** | quy tắc, giọng văn, định dạng trả lời | phút | tức thì |
| **2. RAG — nạp tài liệu** | ★ **SỰ KIỆN**: thông số, mã lệnh, sơ đồ chân, quy trình | giờ | xoá corpus |
| **3. LoRA fine-tune** | **PHONG CÁCH**, thói quen diễn đạt | ngày + GPU | đổi bản model |

★★★ **Muốn AI biết tài liệu hãng, biết mã của anh, biết thông số máy — đó là tầng 2, KHÔNG phải
fine-tune.** Docblock của chính hệ thống này đã ghi: *"LoRA = phong cách, không phải sự kiện."*

⇒ **Toàn bộ tài liệu này nói về tầng 2.** Đó là thứ anh cần và là thứ rẻ nhất.

---

# 2. Định dạng nạp được — đo trong `kbDocParser.ts`

| Loại | Nạp được | Cách xử lý |
|---|---|---|
| **PDF** | ✅ | `pdf-parse` bóc chữ |
| **DOCX** (Word) | ✅ | bóc chữ |
| **Markdown / TXT** | ✅ | đọc thẳng |
| **Trang web (URL)** | ✅ | `kbWebFetcher.ts` tải → `html-to-text` bóc chữ |
| **Video** | ✅ | `kbVideoTranscriber.ts`: ffmpeg tách audio → **whisper.cpp** chép lời |
| **Ảnh** (png/jpg/webp) | ✅ | `kbImageDescriber.ts`: model **thị giác** mô tả nội dung |
| Excel / CSV | ❌ | chưa hỗ trợ — chuyển sang CSV→MD hoặc TXT trước |
| CHM, ZIP, DLL | ❌ | phải giải nén / chuyển đổi trước |

★ Cả năm dịch vụ trên **đều có lưới kiểm thử**. Đây không phải tính năng hứa hẹn.

⚠ **PDF quét ảnh** (scan) thì `pdf-parse` **không đọc được chữ** — nó trả về rỗng và bạn sẽ nạp
một corpus rỗng mà không biết. **Luôn kiểm bước 5.1.**

---

# 3. Hai đường nạp — chọn đúng đường

## Đường A — CLI, cho **thư mục PDF theo hãng** (đang dùng)

Dành cho: tài liệu hãng thiết bị, mỗi hãng một thư mục con.

```
D:\SOURCES\AI Local\Manual\
  Delta\        *.pdf
  Fanuc\        *.pdf
  Mitsubishi\   *.pdf
  ...
```

```bash
# 1. Nạp PDF → chunk
node scripts/ai-kb/ingest-manuals.mjs

# 2. Nhúng (tăng dần — bỏ qua chunk đã có, chạy lại an toàn)
node scripts/ai-kb/embed-programming.mjs
#    --only <hãng>      chỉ một hãng
#    --measure 150      đo tốc độ, không ghi
```

⚠ **Đường này CHỈ nhận `.pdf`** (đo: `ingest-manuals.mjs` lọc `.endsWith(".pdf")`). Word, web,
video, ảnh phải đi Đường B.

## Đường B — KB Studio, cho **mọi loại còn lại**

Giao diện web, cổng **admin/engineer + 2FA**. Các thao tác:
`createCorpus` · `ingestDocumentJob` (tải tệp lên) · `ingestUrlJob` (dán URL) · `corpusPreview` ·
`listCorpora`.

⚠ **Nhà máy KHÔNG có internet.** Nên với trang web: **tải trên máy có mạng trước**, mang tệp về,
rồi nạp bằng `ingestDocumentJob`. `ingestUrlJob` chỉ dùng được ở nơi ra được mạng.

---

# 4. ★★★ Bốn quy tắc quyết định chất lượng

Đây là phần quan trọng nhất. Nạp nhiều **không** đồng nghĩa với tốt hơn.

## 4.1 Rác vào làm kết quả TỆ ĐI, không phải trung tính

Đã đo hôm nay: câu hỏi **ngoài miền** vẫn nhận **5 trích dẫn điểm 0,85–0,91** từ tài liệu hãng
không liên quan. Corpus càng nhiều tài liệu lạc đề, càng nhiều câu trả lời bị kéo sai hướng.

⇒ **Chỉ nạp tài liệu anh thật sự sẽ hỏi tới.** Một corpus 100 trang đúng trọng tâm tốt hơn 1000
trang tạp nham.

## 4.2 Một corpus cho một miền — đừng trộn

Cả sự cố lớn nhất tuần này (hỏi về mã, nhận câu từ chối quyền OEE nhà máy) là do **hai miền dùng
chung một đường**. Tài liệu PLC, tài liệu robot, tài liệu vận hành nhà máy, mã dự án — **để riêng**.

## 4.3 Nạp xong PHẢI nhúng, không thì chỉ tìm được bằng từ khoá

Tìm kiếm là **lai**: cosine (0,72) + từ khoá (0,28). Chunk chưa nhúng chỉ tìm được bằng từ khoá —
tức tìm được khi anh gõ **đúng chữ**, không tìm được khi anh hỏi **cùng ý khác chữ**.

Hôm nay đo được: nhúng đủ đã sửa lỗi **nhầm hãng** (hỏi Universal Robots mà nhận trích dẫn hãng
khác) — chỉ bằng cách nhúng, không sửa dòng mã nào.

## 4.4 Đặt tên tệp cho tử tế

Tên tệp trở thành `docTitle` trong trích dẫn. `ASDA-A2_UserManual_EN.pdf` giúp anh biết nguồn;
`scan001.pdf` thì không. Anh sẽ đọc tên này mỗi lần AI dẫn nguồn.

---

# 5. Quy trình chuẩn — sáu bước

## 5.1 Kiểm tài liệu ĐỌC ĐƯỢC trước khi nạp

```bash
node scripts/ai-kb/ingest-manuals.mjs --dry-run   # nếu có; hoặc nạp 1 hãng nhỏ trước
```
Nhìn số chunk mỗi tệp. **Tệp ra 0 chunk = PDF quét ảnh**, phải OCR trước hoặc bỏ.

## 5.2 Nạp

Đường A hoặc B tuỳ loại (mục 3).

## 5.3 Nhúng — ★ chọn đúng lúc

```bash
node scripts/ai-kb/embed-programming.mjs
```

⚠⚠ **Đo được hôm nay, quan trọng:**
- GPU rảnh: **~53 chunk/giây** → 10.000 chunk mất ~3 phút
- CPU (`GGUF_GPU=false`): **0,2 chunk/giây** → cùng số đó mất **~14 giờ**. Chênh **320 lần**.
- **Chạy khi không có job nặng nào khác trên GPU.** Ba lần job chết vì CUDA OOM đều do tranh chấp
  với tiến trình khác, **không** phải thiếu VRAM thật.
- ★ **Đừng tin con số VRAM script tự in ra** — nó báo "còn 27GB" trong khi `nvidia-smi` nói 6GB.
  Kiểm bằng `nvidia-smi` hoặc Task Manager.
- Script **nhúng tăng dần**: chết giữa chừng thì chạy lại, nó tiếp tục, không mất gì.

## 5.4 Khởi động lại máy chủ

```bash
npm run build
# rồi khởi động lại tiến trình, GIỮ NGUYÊN hai biến:
#   PORT=3003   NODE_ENV=production
```
⚠ Thiếu `NODE_ENV=production` thì `/api/health` trả **500** (đã mắc lỗi này hôm nay).

## 5.5 ★★★ ĐO — bước không được bỏ

```bash
node scripts/ai-eval/eval-vscode-route.mjs
```

Bộ này đăng nhập thật, POST thật, chấm theo **kết cục người dùng nhận được**. Ghi lại con số
**trước** và **sau** khi nạp. Không đo thì anh không biết corpus mới làm tốt lên hay tệ đi — và
mục 4.1 cho thấy **tệ đi là có thật**.

⚠ **Cache 10 phút đang bật.** Mọi câu hỏi đo phải khác nhau (thêm dấu thời gian), nếu không anh
đang đo lại câu trả lời cũ. Bộ đo đã tự kiểm điều này: lượt 1 mất 6.794ms, lượt 2 mất **11ms** —
đó là cache, không phải cải thiện.

## 5.6 Hỏi thử một câu anh BIẾT TRƯỚC đáp án

Cách nhanh nhất phát hiện corpus hỏng: hỏi một chi tiết anh tự tra được trong tài liệu (ví dụ giá
trị một thanh ghi). Nếu AI dẫn đúng số và đúng tệp, corpus sống. Nếu nó nói chung chung, corpus
chưa vào hoặc chưa nhúng.

---

# 6. Khi nào mới nên nghĩ tới fine-tune

Chỉ khi **cả ba** điều sau đúng:

1. RAG đã đúng miền và tỉ lệ đầu-cuối ổn định **trên 80%** (hiện nay: **8/11 ≈ 73%**)
2. Phần còn thiếu là **phong cách** (giọng văn, cách trình bày), **không phải kiến thức**
3. Đã có bộ đánh giá ≥30 tác vụ chạy lặp lại được, để so bản cũ với bản mới

★ Chưa đủ ba điều đó thì fine-tune là **đổi một hệ thống đo được lấy một hệ thống không đo được**.

Hạ tầng LoRA **đã có sẵn** (`aiLlmFinetuneSidecar.ts`, sau cổng 2FA) nên khi tới lúc thì làm được
ngay — không phải xây mới.

---

# 7. Bảng tra nhanh

| Anh có | Làm gì |
|---|---|
| Thư mục PDF theo hãng | Đường A → nhúng → build → đo |
| Một tệp Word/Markdown/TXT | KB Studio → `ingestDocumentJob` |
| Một trang web | Máy có mạng: `ingestUrlJob`. Nhà máy: tải về rồi nạp như tệp |
| Video hướng dẫn | KB Studio → tự chép lời bằng whisper.cpp |
| Ảnh sơ đồ, ảnh chụp màn hình | KB Studio → model thị giác tự mô tả |
| Excel / CSV | Chuyển sang TXT hoặc Markdown trước |
| PDF quét ảnh | OCR trước, hoặc bỏ — `pdf-parse` đọc ra rỗng |

---

# 8. Ba lỗi tôi đã mắc hôm nay, để anh khỏi mắc lại

1. **Đo một kho rồi kết luận về cả hệ thống** — tôi đọc `knowledge/chunks.jsonl` (kho vận hành) và
   kết luận hệ thống không có tri thức hãng, trong khi `knowledge/programming/` đã có 91.678 chunk.
   ⇒ **Kiểm cả hai kho trước khi kết luận.**
2. **Tin con số VRAM của script** thay vì `nvidia-smi` ⇒ chẩn đoán sai nguyên nhân OOM ba lần.
3. **Chạy CPU vì tưởng GPU hết chỗ** ⇒ suýt tốn 14 giờ cho việc 3 phút. Nguyên nhân thật là tranh
   chấp với một job khác, không phải thiếu VRAM.
