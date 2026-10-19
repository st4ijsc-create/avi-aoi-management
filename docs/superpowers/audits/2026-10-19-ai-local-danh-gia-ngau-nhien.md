# Đánh giá lại AI Local bằng bài NGẪU NHIÊN — độ chính xác, độ hoàn thiện, khả năng (2026-10-19)

Mục tiêu chủ dự án: "AI code được, tự sinh code và **chạy được**", trọng tâm ngôn ngữ lập trình + platform.
Model: Qwen3.6-35B-A3B Q4 (llama-server :8091, 1 × 64k, nghĩ 12k), RTX 5090 32 GB. Server thử `:3010`, nhánh
`feat/ai-local-7-tang`. Mọi số dưới đây là **đo**, mỗi lượt có báo cáo JSON trong `scripts/ai-eval/**/reports/`.

## 1. Thước đo

| Bộ | Nội dung | Ghi chú |
|---|---|---|
| **Ngẫu nhiên** `scripts/ai-eval/ngau-nhien/` | 72 bài MỚI: py, js, ts, cs, java, cpp, sql, go, rs × (thuật toán / thư viện-platform / ứng dụng nhiều tệp); 217 test hiển thị + 688 test ẩn | rút phân tầng theo seed (27 bài/lượt); không ai chỉnh theo kết quả; kiểm thước 8/8 mỗi ngôn ngữ |
| **API2** `codegen-chay-duoc/tasks-api2.json` | 30 bài bắt dùng API THẬT đúng phiên bản: zod 4, drizzle, React 19, node-opcua/mqtt/modbus-serial, MQTTnet/NModbus/OPC UA .NET, PostgreSQL 18 + SQL Server LocalDB chạy thật, PowerShell 5.1 | kiểm thước 30/30 · 0/30 |
| Bộ quen H / F / vscode-e2e | 12 bài khó · 6 tính năng nhiều tệp · 21 bài extension | hệ thống ĐÃ được chỉnh theo các bộ này |
| MultiPL-E (công khai) | HumanEval/MBPP dịch 8 ngôn ngữ | **nhiễm** dữ liệu huấn luyện — báo riêng |

Nhiễu đo được: ±3 bài/27 giữa hai lượt cùng seed (agent); A/A Studio ±1/18.

## 2. Kết quả chính

| Đường | Bài lạ (ngẫu nhiên) | Bộ quen | Công khai |
|---|---|---|---|
| Một lượt, model thô (5 seed, 135 bài) | **52/135 = 39 %** | — | MultiPL-E 68/80 = 85 % |
| Một lượt, đường sản phẩm sau vá định tuyến (seed d, e) | 24/54 = 44 % (thô 23/54) | H 54/72 = 75 % | — |
| **Agent máy chủ (tự đọc/ghi/biên dịch/chạy test)**, bản cuối | **58/81 = 72 %** (22 · 18 · 18) | F 14/18 = 78 % | — |
| Extension VSCode headless | lát 8 bài ứng dụng: 5/8 | 55/63 = 87 % | — |
| API2 (30 bài API thật) — một lượt | thô 30/60 = 50 % · sản phẩm 27/60 = 45 % | — | — |

Đọc số:
1. **Bộ quen thổi phồng**: 75–87 % trên bộ đã chỉnh vs **39–44 %** một lượt trên bài lạ; công khai 85 % vì nhiễm.
2. **"Chạy được" đến từ VÒNG agent, không từ một lượt**: agent bản cuối 72 % ≈ gấp đôi một lượt (39 %).
3. Model thay thế **Qwen3-Coder-30B (không suy luận) kém hẳn**: một lượt 6/54 = 11 %, agent 3/27 = 11 % (cùng bài
   Qwen3.6: 43 % / 44 %) ⇒ giữ Qwen3.6; "đúng hơn nhanh" được xác nhận lại.

### Theo ngôn ngữ (agent bản cuối, 3 seed × 3 bài)
Rust 9/9 · TypeScript 8/9 · Python 7/9 · C# 7/9 (sau vá restore) · Go 7/9 · SQL 6/9 · Java 5/9 · JavaScript 5/9 ·
**C++ 4/9**. Theo mức: thuật toán 23/27 · thư viện 19/27 · **ứng dụng nhiều tệp 16/27** (yếu nhất).

### Theo platform (API2, sản phẩm + thô, 4 lượt)
React 19 15/16 · PowerShell 12/20 · SQL thật 12/24 · TS thư viện 6/16 · OT .NET 8/24 · **OT Node 4/20** ⇒ thư viện công
nghiệp (OPC UA/MQTT/Modbus) là điểm yếu nhất — đúng miền của dự án nhà máy.

## 3. Lỗi SẢN PHẨM do bộ ngẫu nhiên lộ ra — đã vá (mỗi cái có test đỏ trước)

| # | Lỗi | Hậu quả đo được | Commit |
|---|---|---|---|
| 1 | Định tuyến chat bằng regex "nuốt" đặc tả sinh mã sang cửa SỬA/TỰ TRỊ (tên tệp + "sửa"/"cho tới khi") | sản phẩm thua model thô −7/54; 28/81 câu bị nuốt | `7f0f7ce1a` |
| 2 | Agent không chạy được Java/C++/Go/Rust | không tự kiểm 4/9 ngôn ngữ | `241e1880f` |
| 3 | Lỗ cũ: ô đường dẫn lệnh nhận CỜ (`--update`, `--inspect-brk`, `@rsp`) | bảo mật | `241e1880f` |
| 4 | .NET: `--no-restore` + restore bị cấm + môi trường thiếu `ProgramFiles` (restore CHƯA TỪNG chạy được) | C# 0/3 | `2d0c0008d` |
| 5 | Chữ `</tool_call>` (nghĩ chạm trần) bị coi là câu trả lời cuối | lượt chết | `2d0c0008d` |
| 6 | Tham số tool call hỏng (cắt ở trần) đầu độc lịch sử ⇒ llama-server 500 mọi lượt sau | lượt chết | `9eacba9d5` |
| 7 | `finish_reason: length` bị đổi thành `tool_calls` ⇒ agent không biết lượt bị cắt | ghi tệp cụt | `cc7732b89` |
| 8 | Agent dừng NGAY sau lần test hiển thị xanh (25/36 bài trượt = xanh hiển thị, trượt ẩn) | — | `627ab942f`: agent 50–55 % → **72 %** |

Bẫy THIẾT BỊ ĐO (số vô giá trị, đã vứt): gốc bài trong repo ⇒ cổng Q1 chặn ghi (0/27 giả); dự án không git ⇒ công cụ ghi
fail-closed (0/27 giả); `run.mjs --config raw` trần 1.400 token ⇒ nghĩ hết, 0 mã (API2 0/30 giả).

## 4. Khả năng hiện có (độ hoàn thiện)
- Sinh mã một lượt 9 ngôn ngữ; agent tự đọc/ghi/biên dịch/chạy test cả 9 (toolchain di động Go/Rust); extension VSCode
  sửa dự án trực tiếp, có sổ kiểm toán, 0 rò bí mật, 0 ghi ngoài workspace.
- Tra API cục bộ 259k ký hiệu (.NET/ASP.NET/NuGet OT/TS/JDK/Python) + tự gắn gợi ý khi lỗi "không tìm thấy" (`90b351d8b`).
- Chưa có: chỉ mục API cho Go/Rust; tài liệu web OT; dữ liệu huấn luyện riêng.

## 5. Nguồn học & huấn luyện (chi tiết: `2026-10-18-ai-local-nguon-hoc-code.md`)
Fine-tune model chính KHÔNG khả thi trên 32 GB (LoRA bf16 ~74 GB). Đường đúng: hệ thống = model + tra tài liệu đúng
phiên bản + vòng biên dịch/test. Thứ tự đề xuất tiếp:
1. **OT trước** (điểm yếu nhất, đúng miền): đưa `.d.ts` node-opcua/mqtt/modbus-serial + XML OPC UA .NET vào gợi ý tự động
   và lời nhắc agent; đo bằng API2 nhóm OT (agent, không chỉ một lượt).
2. Harness agent cho API2 (hiện chỉ một lượt) — để đo `lookup_api`/gợi ý tự động đúng chỗ chúng có tác dụng.
3. Nâng trần lượt/token agent có kiểm soát (17/27 lượt seed f dừng vì trần) — đo chi phí/lợi ích.
4. Vòng tự sinh dữ liệu có kiểm biên dịch/test (từ agent + phản hồi 👍/👎) ⇒ nguồn cho LoRA khi đủ ~2.000 cặp; LoRA FIM
   1.5B trên mã repo cần duyệt cài Unsloth (WSL2/Docker).
