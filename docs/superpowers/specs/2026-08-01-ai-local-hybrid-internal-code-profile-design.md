# Hồ sơ Hybrid — bắt đầu bằng hồ sơ NỘI BỘ thiên hướng code

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** đào sâu, tiếp nối spec chiến lược

**Tài liệu mẹ:** `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` — đọc §2 (số đo nền) và §4 (kiến trúc) trước.
**Nguồn số liệu:** Đợt 0, `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`.

---

## 1. Vì sao NỘI BỘ trước — lý do mạnh hơn "ít rủi ro"

Lý do hiển nhiên là an toàn: hỏng thì hỏng với đội mình, không hỏng với khách. Nhưng có một lý do **mạnh hơn nhiều**, và nó đến từ số đo:

> **Tier code/fim hiện VÔ HÌNH với đo lường.** `aiProgrammingCopilot.ts` gọi thẳng `aiGgufEngine` (6 điểm gọi), **không qua `aiGateway`** ⇒ **0 dòng** trong `ai_gateway_metrics`; `ai_model_metrics` cũng **0 dòng** — không có nguồn thay thế.

⇒ Ưu tiên "nghiêng về model chuyên code" của chủ dự án **hiện không có dữ liệu nào chứng minh hay bác bỏ**. Không phải vì tier đó ít dùng — mà vì **không ai đo được nó**.

⇒ **Chạy nội bộ trước là cách DUY NHẤT lấy được dữ liệu đó**, vì đội phát triển chính là người dùng tier code nhiều nhất. Sau vài tuần, con số sẽ nói: ưu tiên code là đúng, hay chỉ là cảm giác.

**Đây không phải giai đoạn thử nghiệm — đây là giai đoạn ĐO thứ chưa đo được.**

---

## 2. Hồ sơ `internal-code` — cấu hình cụ thể

### 2.1 Ngân sách

| Thành phần | VRAM (MiB) | Ghi chú |
|---|---|---|
| Nền hệ điều hành | 1.200 | |
| Qwen3-Coder-30B-A3B (deep **=** code **=** fim) | **17.698** | một file, ba vai |
| Qwen3-Embedding-0.6B | 5.664 | ⚠ 4,5 GB là buffer — xem §5 |
| **Lúc nghỉ** | **24.562** | **75,3%** |
| + vision sidecar khi thức | 7.821 | tự tắt sau 10 phút idle |
| **Đỉnh khi có ảnh** | **32.383** | **99,3%** — sát trần |

**Vì sao hồ sơ này hợp với nội bộ:** đội phát triển viết PLC/robot, **hiếm khi xử lý ảnh AOI**. Nên đỉnh 99,3% là **sự kiện hiếm** ở đúng hồ sơ mà nó nguy hiểm nhất. Ở khách hàng nặng AOI thì ngược lại — đó là lý do hồ sơ này **không** dùng cho họ.

### 2.2 Ba dòng `.env`

```bash
GGUF_DEFAULT_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf   # đổi từ Qwen3-30B-A3B-Instruct
GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf      # giữ nguyên
GGUF_FIM_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf       # đổi từ Qwen2.5-Coder-1.5B
```

**Quay lui:** khôi phục ba dòng + restart. ⚠ `.env` **không git-track** ⇒ `git checkout -- .env` **vô tác dụng**. Phải `cp .env .env.backup` **trước khi sửa**.

### 2.3 Vì sao gộp FIM vào Coder-30B

| | Qwen2.5-Coder-1.5B (hiện tại) | Qwen3-Coder-30B |
|---|---|---|
| TTFT, ngữ cảnh 153 token | **13,2 ms** | 39,5 ms |
| TTFT, ngữ cảnh 533 token | 26,8 ms | **76,6 ms** |
| Tổng tới gợi ý 32 token | 84-89 ms | 149-188 ms |
| VRAM thêm | +1.774 MiB | **0** (dùng lại model đã nạp) |

Đối chiếu chuẩn có nguồn (Miller 1968 / Nielsen: **0,1 s = tức thì**): trường hợp xấu nhất **76,6 ms = 77% ngân sách 0,1 s** ⇒ **không có lý do bằng số để từ chối**.

⚠ **Nhưng đây là MỘT đánh đổi có hai mặt, không phải hai lựa chọn.** Engine **cache theo tên file** (`aiGgufEngine.ts:593-599`) ⇒ trỏ FIM vào cùng file với code là **một hành động duy nhất** vừa cho lợi (0 ms nạp, tiết kiệm 1.774 MiB) vừa tạo rủi ro (**chia sẻ instance**). Ghost-text bắn liên tục khi gõ; sinh code là lượt dài hàng chục giây.

**Vì sao chấp nhận được ở nội bộ:** semaphore FIFO toàn cục cho **4 lượt đồng thời** (`GGUF_MAX_CONCURRENCY=4`) và mỗi context có 4 sequence. Với đội vài người, xếp hàng khó xảy ra. **Với khách hàng đông người dùng thì phải đo lại** — §6.

⚠ **Mức chậm thêm khi ghost-text và sinh code chạy đồng thời: CHƯA ĐO.** `bench.mjs` đo cô lập, không mô phỏng tải đồng thời.

---

## 3. Điều kiện BẮT BUỘC trước khi bật hồ sơ này

| # | Điều kiện | Vì sao |
|---|---|---|
| 1 | **Vá race double-warm** | Chưa vá thì app **không nạp nổi 30B** — 45/45 lượt lỗi, tái hiện 100% mọi lần boot. Bật hồ sơ mà chưa vá là đo lỗi hạ tầng, không đo hồ sơ |
| 2 | **Nối `aiProgrammingCopilot` qua `aiGateway`** | Không nối thì **mục đích chính của giai đoạn nội bộ — lấy dữ liệu tier code — không đạt được** |
| 3 | **Canh 4 dòng cảnh báo trong log** | Xem §4 |
| 4 | **Chấm 3 cặp A/B tiếng Việt** | Nếu Coder-30B viết tiếng Việt quá tệ thì hồ sơ này **sai từ gốc** — phải chuyển sang `balanced` |

Điều kiện 1 và 2 **cần sửa mã** — không thuộc phạm vi tài liệu này, mỗi cái một đợt riêng.

---

## 4. Bốn dòng log phải canh

Hệ **không báo lỗi** khi thiếu VRAM — nó **suy giảm âm thầm**. Bốn dấu vết duy nhất:

| Dòng log | Nghĩa |
|---|---|
| `evicted LRU model "<id>" before loading` | Đã đuổi model — lần dùng sau tốn 8,8-41 giây nạp lại |
| `no idle model to evict — deferring/allowing load with OOM risk` | **Nguy nhất** — hết chỗ mà không đuổi được gì |
| `At capacity (4/4)` | Đã chạm trần `GGUF_MAX_LOADED_MODELS` |
| cảnh báo ở nhánh `catch` khi nạp lỗi | **Nguy hiểm nhất**: engine **lặng lẽ nạp lại với `gpuLayers:"auto"`** ⇒ tier tụt xuống tốc độ kiểu roster C (**2,9 tok/s — 500 token ≈ 172 giây**) mà **không báo lỗi gì** |

⚠ Dòng thứ tư là kiểu hỏng tệ nhất: người dùng thấy AI "chậm bất thường", không ai biết vì sao, và không có gì đỏ.

---

## 5. Đo gì trong giai đoạn nội bộ

Đây là **mục đích thật** của giai đoạn này. Bốn thứ, mỗi thứ trả lời một câu hỏi chưa có đáp án:

| Đo | Trả lời câu hỏi | Cách |
|---|---|---|
| **Lưu lượng tier code/fim thật** | Ưu tiên "nghiêng code" **đúng hay chỉ là cảm giác**? | `ai_gateway_metrics` sau khi nối điều kiện 2 |
| **Số lần vision thức / ngày** | Đỉnh 99,3% là hiếm hay thường? | đếm lượt khởi sidecar trong log |
| **Bốn dòng cảnh báo §4 có xuất hiện không** | Hồ sơ có thật sự vừa không, hay chỉ vừa trên giấy | grep log |
| **Ghost-text có bị xếp hàng sau sinh code không** | Đánh đổi §2.3 có chấp nhận được không | đo TTFT thật lúc có người đang sinh code |

**Và một điều tra riêng, giá trị cao nhất:** **4,5 GB buffer của embedding**. Model 0.6B (file 1,2 GB) mà chiếm 5.664 MiB — biết có, **chưa truy nguyên nhân**. Nếu chỉnh được như sidecar `-np 1`, hồ sơ này từ 75,3% xuống ~61%, và **đỉnh khi vision thức từ 99,3% xuống ~85%** — đổi hẳn bảng đánh đổi của cả ba hồ sơ.

---

## 6. Tiêu chí tốt nghiệp — khi nào đem ra khách hàng

Không đem ra khách khi chưa có đủ bốn thứ:

1. **Bốn dòng cảnh báo §4 không xuất hiện** trong một chu kỳ vận hành đại diện.
2. **Chất lượng tiếng Việt được chấp nhận** — chủ dự án đã chấm, không phải agent tự đánh giá.
3. **Ghost-text không bị xếp hàng** ở tải nội bộ — và **đo lại ở tải khách hàng** vì đội vài người ≠ nhà máy nhiều ca.
4. **Lưu lượng tier code thật** xác nhận (hoặc bác bỏ) ưu tiên nghiêng code. **Nếu bác bỏ — đổi hồ sơ, đừng giữ vì đã lỡ chọn.**

## 7. Ba hồ sơ khách hàng — phác thảo, chưa thiết kế

Tài liệu này **chỉ đào sâu hồ sơ nội bộ**. Ba hồ sơ khách hàng ghi ở đây để thấy hướng, **chưa phải thiết kế**:

| Hồ sơ | Cấu hình | Lúc nghỉ | Hợp với |
|---|---|---|---|
| `code-heavy` | = `internal-code` | 24.562 (75,3%) | nhà máy nặng tự động hoá, ít ảnh |
| `vision-heavy` | vision thường trú + Coder-30B + embedding | 32.383 (99,3%) | nhà máy nặng AOI ⚠ **sát trần, cần §5 trước** |
| `balanced` | Coder-30B + Qwen3-4B general + embedding, vision theo yêu cầu | **28.026 (86%)** | nhà máy nặng báo cáo/vận hành ⚠ **§4 chưa đo model 4B** |

⚠ Cả `vision-heavy` lẫn `balanced` đều có lỗ hổng bằng chứng. **Đừng chốt chúng dựa trên bảng này** — chúng cần spec riêng sau khi giai đoạn nội bộ xong.

---

## 8. Điều tài liệu này KHÔNG trả lời

- **Chất lượng tiếng Việt của Coder-30B** — chờ chấm; là biến quyết định hồ sơ này đúng hay sai từ gốc.
- **Mức chậm khi ghost-text + sinh code đồng thời** — chưa đo.
- **Nguyên nhân 4,5 GB buffer embedding** — chưa truy.
- **Hiệu quả `-np 1` cho sidecar** — chưa đo, cần sửa mã.
- **Cơ chế hồ sơ** (chọn/chuyển/kiểm tra hồ sơ lúc triển khai) — chưa thiết kế, là spec riêng.
