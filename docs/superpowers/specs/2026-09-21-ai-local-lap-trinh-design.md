# BẢN THIẾT KẾ — AI LOCAL CHO LẬP TRÌNH

**Ngày** 2026-09-21 · **Trạng thái**: CHỜ CHỦ DỰ ÁN DUYỆT
**Căn cứ**: [audit 2026-09-21](../audits/2026-09-21-ai-local-lap-trinh-audit.md) — mọi con số dưới đây
là đo sống, không suy từ mã.

**Mục tiêu chủ dự án**: *"AI local phải dùng để code được, phải sinh được code tự động và phải chạy được."*

---

## 0. BỐN NGUYÊN TẮC RÀNG BUỘC MỌI QUYẾT ĐỊNH DƯỚI ĐÂY

1. **Không tin thứ chưa đo.** Mỗi gói việc mang theo *cổng ra bằng số*, và cổng ra phải **biết kêu**
   trên một ca hỏng đã biết trước khi được dùng để tuyên bố thành công.
2. **Đo model tách khỏi đo đường ống.** Model mới có thể cần harness mới; nếu không tách hai trục,
   ta sẽ đổ lỗi cho model vì nợ của mình (yêu cầu tường minh của chủ dự án).
3. **Không phá hàng rào đang chắc.** `.env`/bí mật · danh sách TRẮNG lệnh · thẻ duyệt mỗi lượt ghi ·
   "im lặng là nói dối" — audit đã xác nhận bốn thứ này **đang hoạt động đúng**.
4. **Bịa đặt là lỗi nặng hơn từ chối.** Một câu trả lời sai mà tự tin đắt hơn nhiều một câu "tôi
   không đọc được".

---

## 1. KIẾN TRÚC ĐÍCH — BA BẬC MODEL TRÊN MỘT CARD

### 1.1 Vì sao ba bậc

Đo được (§3.3 audit) cho thấy **không model nào thắng mọi mặt**:

| Bậc | Model | Chạy được | Token/bài | ms/bài | Dùng khi |
|---|---|---|---|---|---|
| T1 nhanh | Qwen3-4B-Instruct | — | — | ~0,3 s | câu điều hướng/phân loại, **không** sinh mã |
| **T2 mặc định** | **Qwen3-Coder-30B-A3B** | 82 % thuần · **91 % qua đường ống, 10/10/10** | 133 | ~0,7 s | **mọi tác vụ lập trình** |
| T3 sâu | Qwen3.6-27B (`qwen35`, thinking) | **100 %** (22/22, 2 lượt) | ~2.000 | ~28 s | bài khó, hoặc **sau khi T2 trượt test** |

### 1.2 Ràng buộc VRAM và cách giải

Card 32.607 MiB. `llama-server` hiện giữ ~23,5 GB (16,5 trọng số + ~7 KV f16 @ 64K) ⇒ còn 2,6 GB.

**Quyết định**: giữ **một** model 30B thường trú, và nó phải là **Coder**.
- `LLAMA_SERVER_MODEL` = `Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`
- `AI_CODING_MODEL_TASK=code`
- Đây chính là cấu hình "một model duy nhất" mà mã nguồn đã lường trước (`GGUF_CODE_MODEL == LLAMA_SERVER_MODEL`).
- VRAM **không đổi** (16,5 ↔ 16,5 GB).

**T3 không thường trú.** Nó được nạp **theo yêu cầu** bằng một bộ đổi model có sổ sách, và chỉ khi
người dùng chọn hoặc vòng tự động leo thang. Để có chỗ, hạ KV-cache xuống `-ctk q8_0 -ctv q8_0`
(ước giải phóng ~3,5 GB — **phải đo lại, đây là ước tính**).

⚠ **Đánh đổi phải nói rõ**: `/ai-chat` sẽ chạy trên model Coder. Cần đo riêng trước khi chốt (G1.3).

---

## 2. GÓI VIỆC

Sắp theo **giá trị trên mỗi đồng công sức**, tính từ số đo.

### G1 — ĐỔI SANG MODEL CODER  ✅ **ĐÃ THỰC THI 2026-09-21**
Vá **P1**. Đã áp và đã xác nhận sống (`modelDangDung` = `task:code, tier:2, modelId:Coder`).

1. `.env`: `LLAMA_SERVER_MODEL` → Coder; **`GGUF_DEFAULT_MODEL` → Coder** (bản thiết kế đầu THIẾU
   dòng này — thiếu nó thì mọi đường deep/chat vẫn hỏi model cũ ⇒ nạp in-process 16,7 GB ⇒
   **OOM 79 lần**, 34–93 s/lượt); thêm `AI_CODING_MODEL_TASK=code`; `GGUF_CODE_CTX` → 32768.
2. Khởi động lại `llama-server` + tiến trình node.
3. **G1.3 — đo tác dụng phụ**: chạy bộ bài chat/RAG hiện có trên `/ai-chat` TRƯỚC và SAU. Nếu tụt
   quá 5 điểm %, dừng và báo cáo thay vì âm thầm chấp nhận.

**Cổng ra**: bộ đo §3 cho ≥ 90 %, **và** 3 lượt liên tiếp không dao động quá 1 bài;
`modelDangDung` trả `Qwen3-Coder-…`; `/ai-chat` không tụt > 5 điểm %.

### G2 — ✅ **ĐÃ THỰC THI 2026-09-21** · cổng trung thực: cấm bịa khi không đọc được
Vá **P2** — lỗi nặng nhất. Gốc rễ đã định vị: **một chuỗi phục vụ hai người đọc ngược nhau**.

1. **Tách hai kênh** trong `ketQuaTuChoiHopCat`: `textNguoi` (trấn an người) và `textModel` (mệnh lệnh
   cho model). Model **chỉ** nhận `textModel`. Mẫu bắt buộc:
   > "KHÔNG có nội dung tệp X trong lượt này. Bạn **KHÔNG được** mô tả, tóm tắt hay suy đoán nội dung
   > của nó. Hãy nói thẳng rằng bạn chưa đọc được, và nêu lý do."

   Bỏ hẳn cụm *"không phải một sự cố"* khỏi kênh model — nó là nguyên nhân trực tiếp.
2. **Cầu chì hậu kiểm**: nếu trong lượt có tool đọc **trả từ chối** cho đường `X`, mà câu trả lời lại
   chứa khẳng định về nội dung `X` (khối mã gán cho X, hoặc mô tả cấu trúc X), thì **chặn và thay bằng
   lời từ chối trung thực**. Đây là hàng rào thứ hai, không phụ thuộc model nghe lời.
3. Áp cùng khuôn cho `DENIED_SECRET` (nguyên nhân B05 đoán cổng 5432).

**Cổng ra** — *ablation phải phân biệt*:
- 10/10 lượt hỏi nội dung tệp khi ngân sách CẠN ⇒ **0 lượt** chứa mô tả bịa; 10/10 nói rõ không đọc được.
- 10/10 lượt **cùng câu hỏi** khi ngân sách CÒN ⇒ vẫn trả lời đúng (cầu chì không giết ca lành).
- Ca chuẩn hồi quy: hỏi `server/routers.ts` khi cạn ngân sách **không được** xuất hiện chữ "Express".

### G3 — ✅ **ĐÃ THỰC THI 2026-09-21** · ngân sách nhìn thấy được và đủ dùng
Vá **P3**.

1. **Đồng hồ ngân sách** trên thanh màn lập trình: `đã dùng / trần · đặt lại sau N phút`. Cảnh báo ở 80 %.
2. **Nâng trần** cho phiên lập trình có xác thực. Đề xuất **8 MiB / 15 phút** — nhưng **phải đo trước
   khi chốt con số**: chạy 5 phiên lập trình thật, ghi phân bố byte/phiên, rồi đặt trần ở phân vị 90.
   *Không lấy 8 MiB làm mặc định vì nó nghe hợp lý — lấy vì số đo nói thế.*
3. Giữ nguyên **đơn vị đếm** (byte RỜI hộp cát): lý lẽ chống rò của bản gốc là **đúng**, không đụng vào.
4. Khi còn < 20 %, tác nhân phải **ưu tiên đọc**: grep có đích thay vì đọc cả tệp.

**Cổng ra**: một phiên lập trình 30 lượt hoàn thành **không** chạm trần; đồng hồ khớp số server
(sai lệch < 5 %); vẫn từ chối đúng khi vượt trần thật.

### G4 — ✅ **ĐÃ THỰC THI 2026-09-21** · bộ chọn model
Vá **P4** — yêu cầu tường minh của chủ dự án.

1. Bộ chọn trong màn lập trình: **Nhanh (4B)** · **Coder 30B (mặc định)** · **Suy luận sâu 27B** · **Tự động**.
2. Lựa chọn đi theo **từng yêu cầu** (`context.modelTask`), **không** qua biến môi trường ⇒ **không
   cần khởi động lại**. `AI_CODING_MODEL_TASK` lùi về vai *mặc định của hệ*.
3. Chọn T3 mà nó chưa thường trú ⇒ nói thẳng "đang nạp model sâu, ~N giây", có thể huỷ.
4. Thay huy hiệu `model: T1` bằng **tên model thật + lý do chọn**, và tính theo **câu thật** chứ không
   theo text rỗng (sửa `repoWorkspaceRouter.ts:464`).

**Cổng ra**: đổi model giữa hai câu liên tiếp, **không** khởi động lại, và `tokenLuotCuoi` xác nhận
đúng model đã chạy; huy hiệu khớp model thật 10/10 lượt.

### G5 — ✅ **PYTHON XONG 2026-09-21** · C++ HOÃN theo chỉ đạo chủ dự án
Vá **P6**, **P7**. Hiện 2/5 đích của chủ dự án **không thể chạy**.

1. Thêm vào `DANH_SACH_TRANG`, cùng khuôn ba lớp đang có (đường bắt buộc, hạn giờ, cắt đầu ra):
   - `python -m pytest <đường>` · `python -m unittest <đường>`
   - `cmake --build <đường>` · `ctest --test-dir <đường>`
2. Chỉ `pytest`/`unittest`/`ctest` vào **tập KIỂM CHỨNG**; `cmake --build` **phải cân nhắc riêng** vì
   nó **ghi ra đĩa** — cùng lý lẽ đã loại `dotnet format`. Đề xuất: **để ngoài** tập tự động.
3. **Cài chuỗi công cụ C++** (MSVC Build Tools hoặc MinGW-w64 + CMake). Không có bước này thì G5
   **không thể nghiệm thu** — máy hiện **không có** `g++`/`gcc`/`cl`/`cmake`.
4. Mở rộng bộ bài §3 thêm 3 bài Python + 3 bài C++ có test thực thi.

**Cổng ra**: bộ bài mở rộng chạy được cả 5 ngôn ngữ; đột biến thêm `cmake --build` vào tập kiểm chứng ⇒ lưới ĐỎ.

### G2b — ✅ **ĐÃ THỰC THI 2026-09-21** · đường ống trả 0 khối mã trên bài khó
Vá **P11** (xem phụ lục audit). Đo: đường ống **0/9** bộ bài khó với **cả hai** model, trong khi
model thuần đạt 44–56 %. **6/9 bài** trả về **0 khối mã** — câu trả lời là **nguyên văn tệp repo**.

1. Chế độ coding phải **phân biệt** tác vụ *cần repo* với tác vụ *tự chứa*. Câu "viết một lớp LRU"
   KHÔNG cần đọc `toolRegistry.ts`.
2. **Cầu chì đầu ra**: nếu câu hỏi đòi sinh mã mà câu trả lời **không có khối mã nào**, đó là
   THẤT BẠI — phải sinh lại (không tool) chứ không trả tệp repo cho người dùng.
3. Kết quả tool **không được** trở thành câu trả lời cuối; nó là *đầu vào* cho lượt sinh chữ.

**Cổng ra**: ≥ 8/9 bài bộ KHÓ trả về ≥1 khối mã, và tỷ lệ chạy-được của đường ống **≥** model thuần
(hiện đang THẤP HƠN 44 điểm %). Ablation: bài *cần repo* vẫn phải đọc tệp (cầu chì không giết ca lành).

### G6 — HARNESS TÁC NHÂN ĐỦ DÀI ĐỂ LÀM VIỆC THẬT  🟠 lớn · công sức: tuần
Khoảng cách lớn nhất về *hình dạng* so với Claude/Cursor: **≤3 vòng, trần 20 s**.

1. Nâng trần theo **hạng tác vụ**, không nâng đồng loạt: hỏi-đáp giữ 20 s; **tác vụ sửa mã: 8 vòng /
   180 s**, có huỷ và có hiện tiến độ từng vòng.
2. **Bộ bài agentic nhiều tệp** — thứ bộ bài hiện tại **chưa chạm**: "sửa lỗi này, chạy test, sửa tiếp
   đến khi xanh" trên `sandbox-projects/`. Đây mới là phép đo so được với Cursor/Claude.
3. Leo thang T2 → T3 khi lượt đầu **trượt test**, có trần lượt.

**Cổng ra**: ≥ 70 % bài agentic nhiều tệp kết thúc **xanh thật** (test chạy, không phải model tự khai).
⚠ Ngưỡng 70 % là **giả định chưa có cơ sở đo** — lượt chạy đầu sẽ thiết lập đường cơ sở, rồi mới chốt ngưỡng.

### G7 — VRAM BROKER NÓI ĐÚNG SỰ THẬT  🟠 lớn · công sức: ngày
Vá **P8**. Broker khai 27,88 GiB trống khi card còn 2,6 GiB ⇒ sẽ cấp phép cho lượt nạp chắc chắn OOM —
và G4 (nạp T3 theo yêu cầu) **dựa vào** con số này nên phải sửa trước.

1. Khi `baseline.verified=false`, headroom phải lấy **số của thiết bị** (`nvidia-smi`), không lấy sổ cái.
2. Tính cả VRAM của tiến trình **ngoài sổ** (`llama-server` mồ côi là ca thật đã gặp).
3. Cổng nạp phải **từ chối** khi `trọng số + KV dự kiến > trống thật × hệ số an toàn`.

**Cổng ra**: với `llama-server` đang chạy, headroom khai **không lệch quá 10 %** so với `nvidia-smi`;
thử nạp một model 16 GB khi còn 2,6 GB ⇒ **bị từ chối trước khi cấp phát**, không OOM.

### G8 — ✅ **ĐÃ THỰC THI 2026-09-21** · bộ đo thường trực hai trục
Trả lời trực tiếp mối lo của chủ dự án: *"model mới cần harness khác"*.

1. Đưa bộ đo từ `tmp/audit-ai/bench/` vào `scripts/ai-eval/codegen-chay-duoc/` **có phiên bản**.
2. Mỗi model khai một **hồ sơ harness**: chat template · trần token · stop token · ctx · thẻ thinking.
   ⇒ model mới được đo bằng harness **của nó**, không bị trừ điểm oan.
3. Giữ nguyên `fake-ok`/`fake-bad` làm **phép kiểm thước đo**; CI chặn nếu fake-ok ≠ 100 % hoặc
   fake-bad ≠ 0 %.
4. Lệnh một dòng: `npx tsx scripts/ai-eval/codegen-chay-duoc --model <hồ sơ> --config raw|pipeline`.

**Cổng ra**: đo được một model **chưa từng thấy** mà không sửa runner — chỉ thêm hồ sơ.

### G9 — HỌC TỪ REPO: LÀM ĐÚNG CẦN GẠT  🟡 vừa · công sức: tuần+
Vá **P5**, nhưng **có điều kiện** và phải nói thẳng điều này:

⚠ **Training Studio hiện tại KHÔNG phục vụ mục tiêu này**, và chính nó đã đo ra điều đó:
*"nạp tài liệu cho miền lập trình web/app KHÔNG dạy thêm gì… đã đo 2/2 ca sai."*
⇒ **Đừng đổ công vào RAG tài liệu cho lập trình.** Ba cần gạt đúng, theo thứ tự chắc chắn:

1. **Đã chứng minh** — model tốt hơn (G1) và ngữ cảnh repo tốt hơn. Đây là nơi có bằng chứng.
2. **Có cơ sở, chưa đo** — ngữ cảnh mã **nhận biết mã** (chỉ mục ký hiệu, đồ thị gọi) thay cho RAG
   tài liệu. Lỗi chú thích lạc đề (P9, 3/3 lượt) là triệu chứng của việc dùng sai loại truy hồi.
3. **Chưa chứng minh** — LoRA trên mã repo. Nối UI ↔ `kbStudio.startFinetune`, khai `LLM_FINETUNE_CMD`.
   **Nhưng chỉ làm sau khi (1) và (2) xong**, và phải gác bằng một câu hỏi trả lời được bằng số:
   *"LoRA có nâng tỷ lệ chạy-được trên bộ bài §3 không?"* Không nâng ⇒ **không triển khai**.

Trước mắt, sửa chữ trong tab "Xây dựng mô hình" — nó đang nói *"chưa được xây dựng"* trong khi
endpoint server **đã có**; đó là lời khai đã lạc hậu.

**Cổng ra cho (3)**: LoRA nâng ≥ 5 điểm % trên bộ bài §3 **và** không tụt ở bộ bài an toàn. Không đạt ⇒ ghi nhận âm tính, đóng gói việc, không giữ cờ bật.

### G10 — HAI LỖI VỪA  🟡 vừa · công sức: giờ
- **P9** chú thích nguồn lạc đề: chỉ liệt kê tệp khi nó **thật sự** đóng góp vào câu trả lời (ngưỡng
  điểm tương đồng + có trích dẫn). Thà **không** chú thích còn hơn chú thích sai.
- **P10** nhầm ý định "viết test" → "chạy test": thêm ca này vào bộ lưới phân loại ý định
  (`intentClassifier`), sửa, và **kiểm nhánh kia** (đừng để "chạy test" biến thành "viết test").

---

## 3. THỨ TỰ THỰC HIỆN

```
Đợt 1 (chặn)   : G1 ✅ → G2b ✅ → G2 ✅ → G3 ✅   ⇒ ĐỢT 1 XONG
Đợt 2 (nền)    : G4 ✅ → G8 ✅ → G7 (CÒN MỞ)   ⇒ G7 cố ý hoãn: cần vòng đo riêng
Đợt 3 (mở rộng): G5 ✅(Python) → G10 ✅(P10) → G6 (CÒN MỞ, quy mô tuần)
Đợt 4 (có điều kiện): G9             ⇒ chỉ khi Đợt 1-3 xong và số đo còn khoảng trống
```

G7 **phải trước** G4: bộ chọn model sẽ nạp model theo yêu cầu, và nó dựa vào headroom mà broker đang khai sai.

---

## 4. ĐIỀU BẢN THIẾT KẾ NÀY **KHÔNG** HỨA

Nói ra để không tạo kỳ vọng sai:

- **Không hứa ngang Claude/Cursor.** Bộ bài hiện tại là **hàm thuần một tệp**. Năng lực sửa lỗi
  nhiều tệp trong repo thật **chưa được đo** — G6 mới tạo ra phép đo đó.
- **Số SWE-bench của Devstral (68 %) không so được** với 91 % ở đây: khác bộ bài hoàn toàn. Muốn so
  thì phải tải về, chạy cùng bộ đo.
- **Ngưỡng 70 % ở G6 và trần 8 MiB ở G3 là giả định**, chưa có cơ sở đo. Cả hai phải được thay bằng
  số đo từ lượt chạy đường cơ sở trước khi chốt.
- **Qwen3.6-27B đạt 100 % qua 22/22 (2 lượt, 0 trượt)** — vững hơn n=1 ban đầu, nhưng vẫn trên bộ bài HÀM THUẦN; chưa nói gì về tác vụ nhiều tệp.
- **G9 (3) có thể ra kết quả âm tính** — và nếu thế thì đó là kết quả **đúng**, không phải thất bại.

---

## 5. VIỆC CẦN CHỦ DỰ ÁN QUYẾT

1. **Đổi model thường trú sang Coder** — chấp nhận `/ai-chat` chạy trên model coder (G1.3 sẽ đo)?
2. **Cài chuỗi công cụ C++** trên máy này — nếu không, đích C++ phải rút khỏi phạm vi.
3. **Trần ngân sách byte**: giữ nguyên tinh thần chống rò, nhưng nâng trần theo số đo — duyệt hướng này?
4. **Tải Devstral Small 2** (~14 GB) để đo trục M — duyệt không?
5. **Thứ tự đợt** ở §3 — đồng ý hay đảo?
6. **Dọn hiện vật audit**: xoá 2 tài khoản `ai_audit_*` ngay, hay giữ để tôi đo tiếp?
