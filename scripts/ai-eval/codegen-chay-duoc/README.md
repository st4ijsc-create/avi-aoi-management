# Bộ đo "SINH ĐƯỢC MÃ **CHẠY ĐƯỢC**" — hai trục, bốn ngôn ngữ, ba dự án thật

Sinh ra từ audit `docs/superpowers/audits/2026-09-21-ai-local-lap-trinh-audit.md`; mở rộng 2026-09-22.
Trả lời đúng một câu hỏi, và trả lời bằng **máy chạy test**, không bằng người đọc mã:

> *Model/đường ống này có sinh ra mã **chạy được** không?*

---

## Vì sao HAI TRỤC

Chủ dự án nêu (2026-09-21): *"với các model mới cần thay harness hoặc cập nhật code, nên đo theo
hiện tại có khi không phù hợp."* Đúng — và nếu không tách, ta sẽ **đo cái harness rồi đổ lỗi cho model**.

| Trục | Lệnh | Đo cái gì |
|---|---|---|
| **M — model thuần** | `--config raw --raw-url …` | model trên harness CỦA NÓ (chat template, ctx, trần token riêng) |
| **H — đường sản phẩm** | `--config pipeline` | `/api/ai/local-kb/stream` thật: RAG + vòng tool + repo context |

**`H − M` = giá trị (hoặc NỢ) của đường ống ta**, tách khỏi giới hạn model. Đo 2026-09-22 trên
Qwen3.6-27B: **M = 83 %, H = 8 %** trước bản vá G18 — 10/12 lượt chết vì trần token của đường ống,
không vì model. Sau G18: H = 67 %. Không tách hai trục thì "model dốt" và "đường ống bóp" là một.

---

## LUẬT SỐ 1 — CON SỐ KHÔNG CÓ SỐ BÀI CỤT LÀ CON SỐ CHƯA XONG

Model **biết nghĩ** viết cả chuỗi `<think>` vào trần token trước khi phát ký tự mã đầu tiên.
Trần hẹp ⇒ bài **cụt** ⇒ trượt ⇒ **con số THẤP GIẢ**. Đã cắn **ba lần** trong hai ngày:

| Model | Trần hẹp ⇒ số giả | Trần đủ ⇒ số thật |
|---|---|---|
| Qwen3.8-27B | 4k ⇒ 22 % (7/9 cụt) | 12k ⇒ 67 % |
| Qwen3.6-27B | 4k ⇒ 2/12 (10/12 cụt) | 16k ⇒ 83 % (0 cụt) |
| Qwen3.8-27B | 16k ⇒ 75 % (7/36 cụt) | **32k** (trần phần cứng) ⇒ xem `M-q38-32k-*` |

Runner in `genTok`; `so-sanh.mjs` in `tok/bài`. **Mọi báo cáo phải ghi `cụt N/M`; N ≠ 0 ⇒ chặn dưới.**
Dưới tiêu chí *"đúng trước nhanh"* của chủ dự án, đây là kiểu sai nguy hiểm nhất: loại oan model tốt nhất.

Trần phần cứng cho model DÀY 27B trên RTX 5090 32 GB: ctx/slot **32.768** (65k không đủ VRAM với KV f16)
⇒ `max_tokens` tối đa ≈ 32.768 − prompt − 256. Tính bằng `/tokenize` thật, đừng đoán (prompt dài nhất
của bộ khó = 195 token ⇒ 32.253).

## Hai trục NGHĨ — `--khong-nghi`

Model biết nghĩ có **hai** con số, và một con số đơn lẻ luôn giấu một trong hai:

| Cấu hình | Trả lời câu hỏi |
|---|---|
| nghĩ BẬT + trần rộng (`--max-tokens 16000`) | trần CHẤT LƯỢNG của model |
| nghĩ TẮT + trần hẹp (`--khong-nghi --max-tokens 2500`) | thứ dùng được trong vòng lặp lập trình |

`--khong-nghi` gửi `chat_template_kwargs: { enable_thinking: false }` — đường chính thống của llama-server.
**KHÔNG** chèn `/no_think` vào prompt: template Qwen3.6/3.8 không có nhánh ấy ⇒ hỏng trong im lặng.
Kiểm template có đọc cờ không: header GGUF nằm ở ~10,9 MB — đọc **≥48 MB** (đọc 6 MB kết luận sai).

---

## KIỂM THƯỚC ĐO TRƯỚC — bắt buộc, không phải tuỳ chọn

```bash
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --fake fake-hard.json --config fake-ok   # PHẢI 12/12
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --fake fake-hard.json --config fake-bad  # PHẢI 0/12
```

`fake-ok` nạp lời giải **đúng**, `fake-bad` nạp lời giải **sai nhưng VẪN BIÊN DỊCH ĐƯỢC**.
Không thoả 12/12 và 0/12 ⇒ **bộ đo hỏng, vứt mọi số của lượt đó.** Đây là thứ phân biệt một phép đo
HÀNH VI với một phép đo CÚ PHÁP. Khi thêm bài mới, `fake-bad` **phải trượt** — H-cpp2 từng lọt vì với
chu trình *thuần* Kahn trả rỗng một cách tình cờ; phải thêm ca "chu trình LẪN thành phần sắp được".

## CỔNG SỨC KHOẺ — canh ĐÚNG endpoint đang đo

Runner kiểm sức khoẻ **trước VÀ sau** mỗi lượt; không khoẻ ⇒ `exit 2`, không sinh số. Cổng theo URL:
`:8091/health` (llama-server) hoặc `:11434/api/tags` (Ollama — Devstral chỉ chạy được ở đây vì llama.cpp
b9814 không nạp `mistral3` có tháp thị giác). Lý do có cổng: `llama-server` từng **chết giữa chừng** và
4 vòng đo suýt được báo cáo là *"0/9, 79 lượt OOM"* — hiện vật của công cụ.

---

## Chạy

```bash
# đăng nhập lấy vé (một lần)
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"<user>","password":"<pass>"}' -c tmp/audit-ai/ck.txt

# đổi model trên :8091 — MỘT đường, kết thúc bằng phép dò sức khoẻ THÀNH CÔNG (không phải "đã gọi lệnh")
powershell -NoProfile -File scripts/ai-eval/codegen-chay-duoc/doi-model.ps1 -Model "D:\SOURCES\16.AI\<model>.gguf" -Ctx 32768
#   ⚠ -Ctx: MoE 30B-A3B gánh 65536; model DÀY 27B dùng 32768 (KV f16 ở 65k nuốt hết VRAM).

# trục M — model thuần, hai trục nghĩ
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config raw --max-tokens 16000 --label M-<nhãn>-1
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config raw --khong-nghi --max-tokens 2500 --label M-<nhãn>nt-1
#   Ollama: thêm --raw-url http://127.0.0.1:11434/v1/chat/completions --model devstral-small-2:latest

# trục H — đường sản phẩm
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config pipeline --label H-<nhãn>-1

# bảng so sánh — gom nhiều lượt, in KÈM số lượt; khớp <nhãn><số>.json (không nuốt nhãn anh em)
node scripts/ai-eval/codegen-chay-duoc/so-sanh.mjs M-coder12- M-q36moe- M-q36- M-q38-
node scripts/ai-eval/codegen-chay-duoc/so-sanh.mjs --truc H H-q36-truoc- H-q36-sau-

# ba dự án THẬT (C#+SQL Server · C#+SQL Server · PostgreSQL+React/Node)
node scripts/ai-eval/codegen-chay-duoc/duan.mjs --label duan-1
```

Tham số `run.mjs`: `--tasks` · `--config raw|pipeline|fake-ok|fake-bad` · `--fake` · `--raw-url` · `--model` ·
`--max-tokens` · `--khong-nghi` · `--only <id,…|lang>` · `--label` · `--cookie`.
Báo cáo JSON: `reports/<label>.json`. **Nhãn luôn kết thúc bằng số lượt** (`-1`, `-2`, …) để `so-sanh.mjs` gom được.

## Bộ bài

| Bộ | n | Dùng khi |
|---|---|---|
| `tasks.json` | 11 (5 TS · 3 Py · 3 C#) | hàm thuần — **ĐÃ BÃO HOÀ**, không còn phân định được đỉnh; chỉ còn làm lưới hồi quy |
| `tasks-hard.json` | **12** (3 TS · 3 Py · 3 C# · **3 C++**) | LRU+TTL · gộp khoảng · topo+chu trình (TS: **nhỏ nhất theo từ điển + đúng nút TRONG chu trình**) · rate-limit · SemVer · CSV RFC4180 · ring buffer · biểu thức · ca UTC · **C++: cửa sổ trượt biên MỞ · topo+chu trình · biểu thức chia cắt-về-0** |
| `duan.mjs` | 3 đơn hàng | **hiện vật có biên dịch/phân tích được không**: T-SQL qua ScriptDom (offline) · PostgreSQL cục bộ, lược đồ tạm · `dotnet build` · `node --check`/esbuild |

C++ đi qua **CMake → MSVC** (`cpp-template/`): CMake tự dò MSVC qua registry, không cần `vcvars64`.
Máy này: msys2 có nhưng **chưa cài toolchain**; MSVC 14.51 (VS 2026) có đủ.

⚠ `duan.mjs` ghim **Postgres cục bộ** (`aoi@127.0.0.1:5434`) + lược đồ tạm `DROP … CASCADE`. Bản đầu đọc
`DATABASE_URL` từ `.env` — trỏ tới **Supabase từ xa** — tức DDL do model sinh chạy lên một DB không nằm trên
máy này. Không hại là MAY MẮN, không phải thiết kế. Đích chấm bài phải **dùng xong vứt được**.

## Đường cơ sở đã đo — bộ KHÓ 12 bài, 3 lượt, RTX 5090, llama.cpp b9814

Xếp theo **tính đúng đắn** (tiêu chí chủ dự án 2026-09-22: *"đúng trước nhanh"*). Cụt = số bài chạm trần.

| Trục M · model thuần | Chạy được | Cụt | ms/bài | ghi chú |
|---|---|---|---|---|
| **Qwen3.6-35B-A3B** · nghĩ BẬT 16k | **30/36 = 83 %** | 0 | 30.346 | MoE 3B hoạt động; `qwen35moe` nạp được; giải H-ts3 3/3 |
| **Qwen3.6-27B** · nghĩ BẬT 16k | **30/36 = 83 %** | 0 | 79.826 | bằng MoE về đúng, chậm 2,6× |
| Qwen3.8-27B · nghĩ BẬT 16k | 27/36 = 75 % | **7** | 109.578 | **chặn dưới** — xem `M-q38-32k-*` |
| Qwen3.6-27B · nghĩ TẮT 2.5k | 26/36 = 72 % | 0 | 12.844 | |
| Qwen3.8-27B · nghĩ TẮT 2.5k | 26/36 = 72 % | 0 | 8.580 | |
| Qwen3.6-35B-A3B · nghĩ TẮT 2.5k | 25/36 = 69 % | 1 | 5.342 | |
| Devstral Small 2 (Ollama) | 14/27 = 52 % *(bộ 9)* | 0 | 5.097 | chỉ chạy trên Ollama; đo lại bộ 12 |
| Qwen3-Coder-30B-A3B *(đang dùng)* | 11/36 = 31 % | 0 | 1.702 | không nghĩ |

| Trục H · đường ống, Qwen3.6-27B nghĩ BẬT | Chạy được | Lượt chết vì đường ống (G5-D) |
|---|---|---|
| trước G18 (trần `MAX_TOKENS_SINH = 3_000`) | 1/12 = 8 % | 10/12 |
| sau G18 (trần theo lớp model, thử lại 1 lần) | 24/36 = 67 % | 0/36 |

Khoảng cách H 67 % ↔ M 83 % là chi phí đường ống (ngữ cảnh repo + persona) — **chưa vá**, đã ghi.

Bài **không** model nào giải: không còn (H-ts3 từng là bài ấy — MoE có nghĩ giải 3/3).
Bài ổn định khó nhất: H-cs2 (biểu thức C#), H-py3 (CSV RFC4180), H-ts3.

## Thêm một model mới — checklist

1. Đọc header GGUF **≥48 MB**: kiến trúc, tháp thị giác, template có `enable_thinking`. `mistral3` có thị giác
   ⇒ b9814 không nạp ⇒ dùng Ollama.
2. `doi-model.ps1` với `-Ctx` đúng lớp (MoE 65536 · dày 32768). Kết quả phải là `SAN SANG`, không phải "đã chạy lệnh".
3. Trục M **cả hai trục nghĩ**, ≥3 lượt mỗi trục. Ghi `cụt`; ≠ 0 ⇒ nâng trần (tới trần phần cứng) rồi đo lại.
4. So bằng `so-sanh.mjs` trên **cùng tệp bài**. **Không** so với số benchmark của nhà phát hành.
5. Model thắng ⇒ đo **trục H** trên chính nó. M cao mà H thấp = đường ống bóp, không phải model kém.
