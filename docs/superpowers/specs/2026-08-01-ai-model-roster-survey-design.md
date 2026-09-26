# Đợt 0 — Khảo sát roster model AI rồi mới quyết

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** khảo sát-trước-quyết-sau, **không đổi hành vi hệ thống**

---

## 1. Vì sao đợt này tồn tại

Chủ dự án muốn làm bốn hướng: thị giác vào vòng quyết định · dự báo năng suất · sinh PLC/robot có kiểm chứng · máy chủ AI tại chỗ. **Cả bốn tranh nhau đúng 32,6 GB VRAM.** Nếu mỗi hướng tự giành, cả bốn cùng chậm.

Đo được, không suy đoán:

| Đo | Kết quả |
|---|---|
| GPU | RTX 5090, **32.607 MiB** |
| CPU | **i9-12900K**, 16 nhân / 24 luồng |
| RAM | **64 GB** |
| Kho model | 46 GB / 9 model tại `D:/SOURCES/16.AI` |

⚠ Ba số này **khác memory đã ghi** (memory ghi i7-12700KF / 48 GB). Máy mạnh hơn hồ sơ.

**Vấn đề gốc:** `Qwen3-30B-A3B-Instruct` (17 GB) + `Qwen3-Coder-30B-A3B` (17 GB) = **34 GB > 32,6 GB**. Hai bộ não 30B **không bao giờ cùng thường trú được**. Engine không lỗi — nó **đuổi** (`aiGgufEngine.ts:295-366`, LRU + VRAM guard). Mỗi lần agent chuyển giữa suy-luận và viết-mã là một lần **nạp lại 17 GB từ đĩa**.

Phép cộng cho thấy dư địa: **một** 30B (17) + VL-8B (5,9) + embedding (1,2) + reranker (0,6) = **24,7 GB**, còn ~7,9 GB cho KV cache.

## 2. Nguyên tắc của đợt này — do chủ dự án chốt

> *"Khảo sát kỹ trước, chắc chắn rồi mới quyết. Điều tôi muốn vẫn cần dựa vào thực tế hệ thống. Đảm bảo hệ sinh thái không bị vỡ và hỏng."*

Ba hệ quả bắt buộc:

**(a) Quyết định là ĐẦU RA của khảo sát, không phải đầu vào.** Ưu tiên "nghiêng về model chuyên code" của chủ dự án là **tiêu chí phá hoà khi số liệu ngang nhau**, không phải mệnh lệnh áp lên số liệu. Nếu đo ra kết quả ngược, báo cáo trung thực và trình bày lại.

**(b) Đợt này KHÔNG đổi hành vi hệ thống.** Chỉ đo, chỉ đọc. Mọi thay đổi cấu hình chỉ diễn ra ở môi trường đo và **hoàn nguyên ngay sau**. Không xoá model nào khỏi đĩa.

**(c) Mọi kết luận phải quay lui được trong một dòng cấu hình.** Không thay đổi nào được phép khiến việc quay về trạng thái hôm nay tốn hơn một dòng `.env` + restart.

## 3. Phát hiện đã có, trước cả khi khảo sát

### 3.1 ⚠ `mxbai-embed-large` KHÔNG phải mã chết — và có bẫy im lặng

Suy đoán ban đầu (của tôi) là nó chết vì kho RAG dùng `Qwen3-Embedding-0.6B-f16` (`embeddings-meta.json`, 5.687 chunk). **Sai.** `aiImageSearchRouter.ts:153` dùng nó cho tìm-ảnh-theo-ảnh, `aiGgufEngine.ts:173` chốt kích thước 1024.

**Bẫy thật, nghiêm trọng hơn:** **cả hai embedder đều ra vector 1024 chiều.** Phép canh kích thước **về nguyên lý không thể** phát hiện việc trộn nhầm hai không gian nhúng khác nhau — nó sẽ cho qua, và kết quả tìm kiếm sai **âm thầm**, không lỗi, không cổng nào đỏ.

Đây là nợ **tiền tồn tại**, không do đổi roster gây ra. Khảo sát phải trả lời: có đường chạy nào nhúng bằng một model rồi tìm bằng model kia không?

### 3.2 Tên model ghim cứng trong mã

`aiModelCard.ts:71` ghim `"Qwen3-30B-A3B-Instruct-2507"`, `:90` ghim `"Qwen3-4B-Instruct-2507"`, `:108` `"Qwen3-VL-8B-Instruct"`, `:126` `"Qwen3-Embedding-0.6B"`.
⇒ Gỡ model khỏi `.env` mà quên chỗ này thì hệ **khai báo một model không còn tồn tại** — đúng lớp lỗi "mã khẳng định điều không đúng" mà sprint trước bắt được 8 lần.

### 3.3 Đếm file ≠ đếm lượt gọi

Quét sơ bộ: code/coder 20 file · default/chat 16 · vision 12 · fim 5. **Con số này chưa đủ để kết luận** — một file có thể gọi liên tục hoặc gần như không bao giờ. Khảo sát phải đo **lưu lượng thật**.

## 4. Sáu phép đo

Mỗi phép trả lời đúng một câu hỏi, và **mỗi phép phải nêu rõ đo bằng lệnh gì** để lần sau kiểm lại được.

**Đ1 — Lưu lượng thật theo tier.** Bao nhiêu lượt gọi mỗi tier? Trả lời: tier nào xứng đáng thường trú.
*Định nghĩa "điển hình" cho khỏi mơ hồ:* một phiên có đủ **cả bốn nhóm việc** — một lượt hỏi trợ lý tri thức · một lượt RCA · một lượt sinh/sửa mã · một lượt xử lý ảnh. Nếu có log lưu lượng sẵn thì dùng số thật thay vì phiên dựng.

**Đ2 — A/B chất lượng tiếng Việt.** Cùng prompt (RCA · báo cáo điều hành · cố vấn ngưỡng · trợ lý tri thức) chạy qua `Qwen3-Coder-30B` và `Qwen3-30B-Instruct`, in **cạnh nhau**.
⚠ **Chủ dự án chấm, KHÔNG để agent tự chấm.** Cả sprint trước đã chứng minh tự nghiệm thu là chỗ dễ tự lừa nhất. Agent chỉ được trình bày, không được kết luận "đạt".

**Đ3 — Chứng minh hết tráo model.** Đây là toàn bộ lý do đợt này tồn tại. Chạy một phiên agent điển hình, đọc log evict của `aiGgufEngine` (`:366` có ghi), khẳng định **số lần evict = 0** ở roster đề xuất, và **> 0** ở roster hiện tại. Phải cho thấy **cả hai chiều**, không chỉ chiều tốt.

**Đ4 — KV cache còn đủ không.** 7,9 GB nghe nhiều nhưng agent nhiều lượt ăn context rất nhanh. Đo bằng **phiên agent dài nhất mà hệ thực sự hỗ trợ** (đọc giới hạn context đang cấu hình, chạy tới sát giới hạn đó), ghi lại VRAM đỉnh và mốc bắt đầu thiếu — không đo bằng phiên ngắn rồi ngoại suy.

**Đ5 — Độ trễ FIM.** `Qwen3-Coder-30B` (hỗ trợ FIM) so với `Qwen2.5-Coder-1.5B` hiện dùng, đo bằng mili-giây ở độ trễ cỡ gõ phím. **Không đổi vì "mới hơn thì tốt hơn"** — chỉ đổi nếu số liệu ủng hộ.

**Đ6 — Toàn vẹn không gian nhúng.** Có đường chạy nào trộn hai embedder không (xem §3.1)? Cùng truy vấn RAG và tìm-ảnh trước/sau mọi thay đổi phải cho **cùng thứ hạng**.

## 5. Ba roster ứng viên

Khảo sát so ba phương án, **không chốt trước**:

| | Thường trú GPU | Tổng | Đánh đổi |
|---|---|---|---|
| **A** | Coder-30B làm mọi tier + VL + embed + rerank | 24,7 GB | Đơn giản nhất, KV cache rộng nhất. Rủi ro: văn xuôi tiếng Việt khô, lẫn thuật ngữ Anh |
| **B** | Coder-30B + Qwen3-4B (tier general) + VL + embed + rerank | 27,1 GB | Mọi tier nóng, độ trễ thấp nhất. Rủi ro: 4B viết tiếng Việt kém 30B rõ rệt |
| **C** | Coder-30B trên GPU, General-30B đẩy sang RAM 64 GB | 24,7 GB GPU | Giữ chất lượng tiếng Việt. Rủi ro: tier general chậm hẳn — chấp nhận được với báo cáo nền, khó chịu với hỏi-đáp |

**Chủ dự án nghiêng về A.** Nhưng theo §2(a), A chỉ thắng nếu Đ2 cho thấy chất lượng tiếng Việt chấp nhận được. Nếu Đ2 cho thấy A viết tệ, **B và C phải được trình bày lại một cách công bằng**.

## 6. Đảm bảo hệ sinh thái không vỡ

Chủ dự án nêu đây là ràng buộc, không phải mong muốn. Cụ thể:

- **Không xoá model khỏi đĩa.** Gỡ khỏi cấu hình ≠ xoá. 17 GB là cái giá rẻ cho khả năng quay lui.
- **Quét toàn repo tìm mọi chỗ ghim cứng tên model** trước khi đổi (§3.2), không chỉ sửa `.env`.
- **Không đụng kho nhúng.** Mọi thay đổi embedder đều phải nhúng lại toàn bộ — ngoài phạm vi đợt này. Nếu khảo sát phát hiện cần đổi embedder, đó là **đợt riêng**, có kế hoạch nhúng lại và đối chiếu thứ hạng.
- **Mỗi phép đo chạy trên môi trường đo, hoàn nguyên ngay sau.** Không để lại cấu hình tạm.
- **Rủi ro lớn nhất không phải hiệu năng mà là ÂM THẦM**: nếu model mới trả lời tệ hơn ở tiếng Việt, không cổng nào đỏ, không test nào bắt — người vận hành chỉ đọc phải câu khó hiểu rồi dần bỏ dùng. Đó là lý do Đ2 do người chấm.

## 7. Nghiệm thu

Đợt 0 xong khi có **báo cáo khảo sát** trả lời đủ sáu phép đo, kèm bằng chứng chạy được, và **một khuyến nghị roster kèm lý do bằng số liệu** — chứ không phải khi đã đổi roster.

Việc đổi roster là **quyết định của chủ dự án sau khi đọc báo cáo**, và sẽ là một đợt riêng, nhỏ, quay lui được trong một dòng.

## 8. Ngoài phạm vi (YAGNI có chủ ý)

- **Không** đổi embedder (kéo theo nhúng lại toàn bộ).
- **Không** tải model mới về. Nếu khảo sát cho thấy nên xét model ngoài kho hiện có, **ghi vào báo cáo** để chủ dự án quyết — kiến thức của tôi về model mới dừng khoảng 5/2026 nên không tự tin khuyến nghị.
- **Không** đụng bốn hướng Đợt 1-4. Chúng có spec riêng sau khi roster chốt.
- **Không** sửa bẫy trộn không gian nhúng (§3.1) — chỉ **đo và báo cáo**. Sửa là đợt riêng vì có thể phải nhúng lại.
