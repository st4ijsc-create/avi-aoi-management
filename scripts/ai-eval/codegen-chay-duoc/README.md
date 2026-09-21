# Bộ đo "SINH ĐƯỢC MÃ **CHẠY ĐƯỢC**" — hai trục

Sinh ra từ audit `docs/superpowers/audits/2026-09-21-ai-local-lap-trinh-audit.md`.
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

**`H − M` = giá trị (hoặc NỢ) của đường ống ta**, tách khỏi giới hạn model.
Số đo 2026-09-21 cho thấy khoảng cách ấy có thể là **±48 điểm phần trăm** — nên đừng bỏ qua nó.

⚠ **Model *thinking* phải nâng trần token** (`--max-tokens 4000`): đo Qwen3.6-27B cho ~2.000
token/bài so với 133 của Qwen3-Coder. Dùng trần 1.400 là **chấm oan** nó.

---

## KIỂM THƯỚC ĐO TRƯỚC — bắt buộc, không phải tuỳ chọn

```bash
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config fake-ok   # PHẢI 9/9
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config fake-bad  # PHẢI 0/9
```

`fake-ok` nạp lời giải **đúng**, `fake-bad` nạp lời giải **sai nhưng VẪN BIÊN DỊCH ĐƯỢC**.
Không thoả 9/9 và 0/9 ⇒ **bộ đo hỏng, vứt mọi số của lượt đó.** Đây là thứ phân biệt một phép đo
HÀNH VI với một phép đo CÚ PHÁP.

## CỔNG SỨC KHOẺ — bài học đắt nhất của phiên gốc

Runner kiểm `:8091/health` **trước VÀ sau** mỗi lượt; không khoẻ ⇒ `exit 2`, không sinh số.
Lý do: trong phiên audit, `llama-server` **chết giữa chừng** và 4 vòng đo tiếp theo suýt được báo
cáo là *"đường ống + Coder = 0/9, 79 lượt OOM"* — trong khi đó là **hiện vật của công cụ**.

---

## Chạy

```bash
# đăng nhập lấy vé (một lần)
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"<user>","password":"<pass>"}' -c tmp/audit-ai/ck.txt

# trục H — đường sản phẩm
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config pipeline --label H-<nhãn>

# trục M — model thuần
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config raw \
  --raw-url http://127.0.0.1:8091/v1/chat/completions --max-tokens 2500 --label M-<nhãn>
```

Tham số: `--tasks` (`tasks.json` dễ · `tasks-hard.json` khó) · `--config` · `--raw-url` ·
`--max-tokens` · `--only <id|lang>` · `--label` · `--cookie`.
Báo cáo JSON: `scripts/ai-eval/codegen-chay-duoc/reports/<label>.json`.

## Hai bộ bài

| Bộ | n | Dùng khi |
|---|---|---|
| `tasks.json` | 11 (5 TS · 3 Py · 3 C#) | hàm thuần — **ĐÃ BÃO HOÀ**, 10/11 bài đạt 3/3, không còn phân định được đỉnh |
| `tasks-hard.json` | 9 (3 TS · 3 Py · 3 C#) | LRU+TTL · gộp khoảng biên mở/đóng · topo+chu trình · rate-limit cửa sổ trượt · SemVer · CSV RFC4180 · ring buffer · máy tính biểu thức · gom ca UTC vắt nửa đêm |

**Dùng `tasks-hard.json` để so model.** Bộ dễ chỉ còn dùng làm lưới chống hồi quy.

## Thêm một model mới

1. Nạp nó lên một cổng (`llama-server -m <model> --port <p> …`).
2. Chạy trục M với `--raw-url` của cổng đó và **trần token phù hợp với model** (thinking ⇒ ≥4000).
3. So với bảng dưới. **Không so với số SWE-bench của nhà phát hành** — khác bộ bài hoàn toàn.

## Đường cơ sở đã đo (2026-09-21, RTX 5090, llama.cpp b9814)

| Cấu hình | Bộ DỄ | Bộ KHÓ | token/bài | ghi chú |
|---|---|---|---|---|
| raw Qwen3-30B-A3B-**Instruct** | 22/33 = 67 % | 4/9 = 44 % | — | |
| raw Qwen3-**Coder**-30B-A3B | 27/33 = 82 % | 12/27 = 44 % | 133 | 190 tok/s |
| raw **Qwen3.6-27B** (`qwen35`, thinking) | 22/22 = **100 %** | chưa đo | **~2.000** | ~28 s/bài (×40) |
| pipeline + Coder — **TRƯỚC** G2b | 89 % | **0/27 = 0 %** | — | 6/9 bài trả **0 khối mã** |
| pipeline + Coder — **SAU** G2b | 82 % | **13/27 = 48 %** | — | 27/27 bài có khối mã |

⚠ **Chưa đo**: Qwen3.8-27B (có trên đĩa) · Devstral Small 2 · tác vụ agentic NHIỀU TỆP
(bộ bài này là **hàm thuần một tệp** — nó KHÔNG nói được gì về năng lực sửa lỗi nhiều tệp).
