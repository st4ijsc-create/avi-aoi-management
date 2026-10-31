# Harness Thợ Cả — học từ DeepSeek Harness (Đợt 12)

Ngày: 2026-10-31 · Người lập: dieu-phoi · Nguồn tham khảo: `D:\LocalAIHarness\deepseek-harness-master` (MIT, © 2026 DeepSeek; chỉ ĐỌC, không chạy mã).
Ba lượt khảo sát song song: (A) công cụ · phê duyệt · sandbox · bí mật; (B) vòng agent · ngữ cảnh · phiên · agent con · kế hoạch; (C) tầng model · MCP · kiểm thử/đo.

## 0. Kết luận chung

- Lõi của ta đã mạnh hơn DeepSeek ở: quản trị dữ liệu ra ngoài (ghepPhan + cổng ngoài), không có shell (argv mẫu chính xác, `shell:false`), lệnh khoá cứng thắng mọi phê duyệt, kiểm đường dẫn (realpath + hard-link + 8.3), che bí mật/PII trong kết quả công cụ + quét chỉ thị chèn, cổng duyệt kế hoạch CỨNG (DeepSeek chỉ là lời nhắc), lan truyền "đáng ngờ" lên cha, ngân sách con trừ từ cha, bộ đo đánh giá trung thực (M/H, "cụt N/M").
- Thứ đáng học là MƯỜI MẤY ý nhỏ, đo được — KHÔNG học kiến trúc (Cordis, shell + sandbox HĐH, agent con song song).
- Nguyên tắc: ĐO TRƯỚC (H0) rồi mới đổi nén ngữ cảnh / nhắc nhở; mọi thay đổi hành vi model sau cờ + A/B trong cửa sổ GPU; chép mã thì giữ thông báo MIT.

## 1. KHÔNG áp dụng (và lý do)

| Ý của DeepSeek | Lý do không |
|---|---|
| Mở rộng wire `dsh_session_log`, `dsh_plugin_packages`, header danh tính | Mặc định gửi nhật ký phiên/prompt/kết quả tool ra `baseURL` — trái luật "không dữ liệu rời nhà máy" |
| Cordis + Typert + HMR (kiến trúc plugin) | Viết lại cả ngăn xếp tRPC/Express, lợi ít |
| `bash -c` sau sandbox HĐH | Trái thiết kế không-shell của ta |
| Agent con nền/song song, đội agent, `send_message` | Một khe GPU — không song song thật |
| Reviewer LLM thay người duyệt | Model cục bộ không đủ tin cậy, chính nó là đích chèn lệnh |
| `run_code` (ptc-runtime), workflow script do model viết | Bề mặt tấn công lớn, model nhỏ viết script kém |
| System message giữa hội thoại | Template Qwen từ chối |
| Thử lại vô hạn (`always`) | Thử lại cả lỗi xác thực/hết quota |
| Danh mục skill trong mọi yêu cầu | Ăn vào điểm ngọt ~4k ngữ cảnh |
| Headroom mặc định 65 536 token | Không vừa cửa sổ 64k |

## 2. Các lô (chủ · cỡ · điều kiện)

### H0 — ĐO (làm trước, mọi lô sau dựa vào) · do-model + tho-ca-agent · S
1. Tách `cache_n` (tái dùng) và `prompt_n` (xử lý lại) — hiện `aiLlamaServerClient.ts` cộng làm một `tokensPrompt` ⇒ mất tỉ lệ trúng cache. (C-P7, B-P8)
2. Bản ghi MỖI BƯỚC agent: băm system+tools, số tin, token ước lượng vs thật (`vao`), cache_n/prompt_n, hành động nén, lời nhắc đã chèn. (B-P8)
3. Mỗi lời nhắc/khối chèn ghi rõ "model thấy gì · token · ảnh hưởng cache" trong chú thích mã (theo lệ README DeepSeek).

### H1 — Lõi agent, nhỏ, rủi ro thấp · tho-ca-agent · S mỗi mục
1. **Nén xuống mốc thấp** (B-P1): khi vượt ngưỡng, nén tới ~45–50 % ngân sách (không chỉ vừa dưới 70 %) ⇒ lịch sử chỉ-nối-thêm vài bước, mỗi lần nén chỉ mất cache một lần. Đo bằng H0 trước/sau.
2. **Đếm ngữ cảnh bằng số thật** (B-P2): neo `vao` + `ra` lượt trước + ước lượng phần thêm; bỏ dựa thuần 2,8 ký tự/token.
3. **Cứu khi tràn ngữ cảnh** (B-P3): `laLoiTranNguCanh` ⇒ mã `CONTEXT_OVERFLOW` (không còn `MODEL_LOI`), lõi nén mạnh (bỏ mọi nghĩ cũ, rút mọi kết quả tool trước bước cuối) rồi thử lại MỘT lần chỉ khi ước lượng thực sự giảm.
4. **Không ghi đè tệp chưa đọc / đã đổi từ lúc đọc** (A-P1): `docTep` ghi băm; `ghiTep`/`suaTep` từ chối khi tệp đã có mà chưa đọc hoặc băm đổi (bảo vệ sửa tay của người trong IDE). Agent con dùng chung sổ.
5. **Hạn giờ theo công cụ** (A-P8): `search_code`/`search_docs`/`lookup_api`… có `timeoutMs` riêng ⇒ `TOOL_TIMEOUT` có cấu trúc (không tính thời gian chờ duyệt).
6. **Bộ dấu thống nhất cho từ chối/kết cục** (A-P5): `[bị chính sách chặn — đừng thử đường khác]`, `[có thể xin duyệt]`, `[mã thoát N]`, `[hết giờ]` — SAU CỜ (đổi byte prompt ⇒ A/B).
7. **Nhắc trước khi dừng vì lặp** (A-P4): nhắc ở 2, chi tiết ở 3, dừng ở 5 — SAU CỜ, đo agent-f/G6 (khảo sát B cho rằng giá trị thấp ⇒ chỉ giữ nếu số đo tốt hơn).

### H2 — Extension ngang máy chủ · luong-ui · S
Theo A-P6: `vscode-extension/src/mang/chayLenhCucBo.ts` và `mcpClient.ts` hiện truyền nguyên `process.env` (token/khoá đám mây của dev lọt vào tiến trình chạy mã model viết), `cp.kill()` không giết cây tiến trình trên Windows, đầu ra chỉ giữ 2 MB đầu. Đưa helper máy chủ (`moiTruongDaLoc`, `gietCayTienTrinh`, `BoDemDauRa`) về module thuần dùng chung; phía extension lọc theo danh sách cấm tên bí mật + cho phép JAVA_HOME/GOPATH/proxy; MCP server được env riêng sau khi lọc. Vào 0.5.x.

### H3 — Tầng model · do-model · S–M
1. **Mã lỗi ổn định + chính sách thử lại** (C-P1): `QUOTA` / `RATE_LIMIT` / `EMPTY_RESPONSE` / `TIMEOUT` / `TRANSPORT` / `CONTEXT_WINDOW_EXCEEDED`; KHÔNG thử lại 429 `insufficient_quota` (hiện ta thử lại và giữ chỗ ngân sách lần nữa); backoff + jitter + tôn trọng `Retry-After`; 503 khi llama đang nạp ⇒ backoff.
2. **Một mô tả khai báo cho mỗi model** (C-P4): ctx, kiểu nghĩ, `chat_template_kwargs`, trường ngân sách nghĩ, max tokens… thay cho biến môi trường + mã rải rác ⇒ đổi model = đổi dữ liệu.
3. **Adapter ngoài lên chuẩn client llama** (C-P6): stream, lịch sử tool gốc, phân loại tràn ngữ cảnh, đọc `retry-after`/`request-id` — bộ che phải phủ tham số/kết quả tool trong khối gốc. Sau L3.

### H4 — Hạ tầng kiểm thử không cần GPU · kiem-dinh (mock) + do-model (ghi/phát lại) · M–L
1. **Máy chủ LLM giả tiêm lỗi qua HTTP thật** (C-P2): kịch bản `connection_reset`, `stall`, `empty`, `malformed_json`, `rate_limit`, `context_overflow`, 503 đang nạp, tool call nằm trong reasoning, đáp án kẹt trong reasoning (G5-D), `<think>` không đóng — nói OpenAI `/v1/chat/completions` SSE có `reasoning_content` + `timings`; chạy xuyên `quanLyLuotChay → goiModelMayChu → aiLlamaServerClient`.
2. **Ghi một lượt thật — phát lại mãi không GPU** (C-P3): luồng model ghi lại đẩy qua vòng + công cụ THẬT, so nhật ký + cây workspace kỳ vọng; thay system/tool schema bằng token để fixture không vỡ khi đổi prompt; `assertConsumed`. Cửa sổ GPU dành cho đo mới.

### H5 — Việc dài · tho-ca-agent · M (sau H0/H1)
1. **Agent con trả JSON có kiểm** (B-P6): công cụ `report` `{status, findings[], files[], evidence[]}` thay văn bản tự do cắt 1500 ký tự; giữ nhãn UNTRUSTED.
2. **Tiếp tục trong ngữ cảnh mới với bàn giao có kiểm (kiểu Ralph)** (B-P5) — A/B với **tóm tắt trong vòng 8 phần tái dùng cache** (B-P4): khi chạm trần lượt/áp lực ngữ cảnh, mở vòng mới mang nhiệm vụ gốc + báo cáo `{status, summary, evidence[], nextSteps[], blocker}` + todo + tệp đã đổi DỰNG TỪ MÃ; trần số vòng, người thấy & dừng được. Kỳ vọng hợp model nhỏ hơn (giữ gần điểm ngọt ~4k).
3. **Đầu ra dài lưu tệp riêng đọc lại được** (A-P2): chỉ bản ĐÃ CHE, thư mục tạm riêng ngoài gốc dự án, `wx` + `0o600`, chỉ chính lượt đọc, dọn khi lượt xong.
4. **Lưu lịch sử model mỗi bước + tiếp tục lượt** (B-P7): `tinNhan` phía máy chủ lưu (có trần) vào `ai_agent_runs` ở ranh giới bước; "tiếp tục lượt" chỉ máy chủ, tool dở ⇒ `[kết cục không rõ]`; không bao giờ nhận lịch sử từ client. Cần migration.

### H6 — An toàn lớn · điều tra trước, quyết sau
1. **Xin duyệt một lần có lý do thay vì từ chối cụt** (A-P3) ở chế độ tự động: lệnh khoá cứng không bao giờ leo thang; trần số lần mỗi lượt; lý do hiện nhãn "do AI viết"; lượt đã đáng ngờ ⇒ đánh dấu. Thêm chính sách `never` cho chạy đo/không người.
2. **Giam ghi ở mức HĐH cho lệnh chế độ tự động trên Windows** (A-P7) — đóng rủi ro lớn nhất đã biết ("mã test do model viết chạy với quyền tiến trình server"). Thành phần DeepSeek port (`windows-acl-restrict-poc`) KHÔNG có trong THIRD_PARTY_NOTICES ⇒ kiểm giấy phép trước; so với phương án runner Docker (như `compile_st`). Chỉ điều tra + đề xuất, chưa làm.

### H7 — Sau cùng
- Đưa lời gọi model của agent qua một điểm chặn chung (gateway: quota/an toàn/giấy phép/định tuyến vai trò) (C-P5) — giữ thứ tự bơm ưu tiên.
- Client MCP cho agent có giám sát nối lại, tên `mcp__server__tool`, `isError` lộ rõ, nạp schema theo nhu cầu (C-P8).

## 3. Thứ tự & cổng

H0 → H1 (1–5 gộp từng mục; 6–7 sau cờ + A/B) và H2 song song → H3.1 → H4.1 → H5.1 → (H5.2 A/B H5 tóm tắt) → H4.2/H3.2/H5.3/H5.4 → H6 điều tra → H7.
Mỗi mục: test + đột biến + kiem-dinh rà; đổi hành vi model ⇒ cờ mặc định giữ hành vi cũ tới khi có số đo trong cửa sổ GPU; migration ⇒ SQL qua dieu-phoi trước DEV; census toàn cây trước bàn giao.
