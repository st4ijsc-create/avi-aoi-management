# AI Local — kế hoạch nâng cấp theo bộ báo cáo "AI Local improvement" (Đợt 11)

> Ngày: 2026-10-27 · Người viết: dieu-phoi · Trạng thái: **DỰ THẢO chờ chủ dự án** (5 câu hỏi ở §6).
> Nguồn: `D:\SOURCES\AI Local\AI Local improvement\` — (1) *Kế hoạch tối ưu Qwen3.6-35B-A3B cho lập trình* (34 tr., ký hiệu **KH**, bài kiểm T6.1–T6.6);
> (2) *Yêu cầu trải nghiệm người dùng — Forge Desktop và extension VS Code* (13 tr., mã **UX-C/D/V/S/P/A**, kịch bản K1–K7);
> (3) *Forge — AI Local cho lập trình* (bảng 9 màn hình mẫu). "Forge" chỉ là tên ví dụ — tên thật do chủ dự án chọn (§6 Q1).
> Đối chiếu với mã: khảo sát 30 hạng mục trên main 2f0a99fc0 (file:dòng trong phụ lục A).

## 0. Nguyên tắc của kế hoạch

1. **Đo trước, đổi sau — tiêu chí ĐÚNG hơn NHANH.** Báo cáo viết từ tài liệu chính hãng; một số khuyến nghị đã được ĐO trên máy này và cho kết quả khác.
   Những mục đó không áp dụng mù — chỉ đo lại khi có thay đổi làm số cũ hết hiệu lực (bản llama.cpp mới, model mới), và cổng là điểm đúng (bộ KHÓ "H"), không chỉ tốc độ.
2. **Dùng lại cái đã có.** Hệ thống hiện có nhiều phần báo cáo đề xuất (che bí mật, cảnh báo chỉ thị nhúng, chống lặp, phát hiện output hỏng, hồ sơ sampling,
   AGENTS.md, đánh giá chạy-được, MCP DB chỉ đọc). Kế hoạch lấp KHOẢNG TRỐNG, không làm lại.
3. **Không có thay đổi âm thầm** (UX nguyên tắc 2) và **máy kiểm chứng, người quyết định** (nguyên tắc 3) là hai bất biến cho mọi đợt.

## 1. Mục đã đo trên máy này — KHÁC khuyến nghị của báo cáo

| Báo cáo khuyến nghị | Đã đo (memory/số liệu) | Quyết định Đợt 11 |
|---|---|---|
| Build llama.cpp trong **WSL2**, CUDA 13.1/13.3 | Chạy **Windows gốc** b9814 (`D:/SOURCES/16.AI/llama-cuda`); WSL từng làm cạn bộ nhớ ảo (page cache) ⇒ llama-server chết | **Giữ Windows gốc.** Thêm kiểm tra hệ thống: bản CUDA/driver, cảnh báo nếu CUDA 13.2 (output rác — KH 1.2.2). |
| **MTP** `--spec-type draft-mtp --spec-draft-n-max 2` | B5 (2026-09-22): nhanh 9 % nhưng H 31/36 → 27/36 ⇒ BỎ | **Không bật.** Đo lại (T6.1 + H ×6 lượt) chỉ khi nâng bản llama.cpp; cổng = H không tụt, KHÔNG phải "≥10 % nhanh hơn" như KH. |
| Sampling chính hãng 0.6/0.95/20/min_p 0 | A/B B2: không hơn hồ sơ hiện tại (M 78/83, H 67/69) | **Giữ** `hien-tai`; cần gạt `AI_SAMPLING_PROFILE=chinh-hang` vẫn có. |
| ctx **131 072** (thử 262 144) | B3: 64k ⇒ H 86 % (từ 75 %); KV f16 đo 80 KiB/token; VRAM nay còn chứa mmproj + embed + reranker | **Đo VRAM thật** với 96k/131k (T6.1). Chỉ nâng nếu đỉnh VRAM ≤ 30,5 GB VÀ H không tụt. |
| KV `q8_0` khi 262K | Launcher cố ý từ chối q8_0 (`start-llama-server.ps1:17-19`) | Giữ f16. Không thử 262K. |
| `preserve_thinking:true` | Ta cắt phần nghĩ khỏi lịch sử để tiết kiệm ngữ cảnh | **Đo** trên bài agent nhiều lượt (agent-f + G6) — bật nếu H agent tăng mà ctx không vượt 85 %. |
| Không nạp `mmproj` khi chỉ code | Đo 2026-10-24: 35B + mmproj thắng sidecar VL-8B (12,7/13, 3,3 s) | **Giữ mmproj** (trợ lý lập trình đọc ảnh). |
| Không FIM inline | Đang có ghost-text; `.env` đặt `GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B` nạp TRONG tiến trình :3000 cùng GPU | **Đo VRAM** khi FIM nạp; nếu đẩy tổng > 30,5 GB ⇒ chuyển FIM sang CPU hoặc tắt mặc định. |
| LoRA bf16 trên GPU thuê 80 GB | G9 (2026-09-21): KHÔNG làm; Đợt 10 chọn bài học + người duyệt | **Chỉ chuẩn bị dữ liệu** (local). Thuê GPU = mã nguồn rời máy ⇒ chủ dự án quyết (§6 Q2). |

## 2. Đối chiếu yêu cầu ↔ hiện trạng (rút gọn)

Ký hiệu: ✅ có · ◐ một phần · ✗ chưa có. Chi tiết file:dòng ở phụ lục A.

| Nhóm | ✅ đã có | ◐ một phần | ✗ chưa có |
|---|---|---|---|
| Máy chủ / model | hồ sơ nghĩ/nhanh theo lượt; phát hiện output hỏng (`generationGuard`) | cờ khởi động thiếu `--alias`, `--api-key-file`, `--jinja` tường minh, `-b/-ub`; Model Center không hiện lệnh khởi động, phân rã VRAM, chỉnh ctx/KV; tok/s tính theo đồng hồ, không lấy `timings` | kiểm tra hệ thống lần đầu (GPU/driver/CUDA/đĩa) kiểu UX-D07 |
| Ngữ cảnh | AGENTS.md tự nạp | chỉ mục ký hiệu có, chưa có repo map trong ngữ cảnh; đồng hồ ngữ cảnh 85 % (KH 80 %), VS Code còn ước tính | ngữ cảnh schema DB (`docs/ai/db`, công cụ schema); tóm tắt sang NOTES.md + phiên mới |
| An toàn | cảnh báo chỉ thị nhúng; chặn lệnh theo danh sách cho phép; sổ audit (máy chủ) | danh sách tệp cấm có, chưa quét bí mật kiểu gitleaks trên NỘI DUNG; khoá cứng push/reset là ngầm (do allowlist), không hiển thị | nhãn "thư mục điều khiển thiết bị" + ô "Đã review theo quy trình" (UX-S09 — khớp L-7) |
| Agent & duyệt | chống lặp 3 lần (dừng) | chấp nhận theo khối có; thiếu phím J/K/A/R, mục "Cần bạn kiểm tra" (nơi gọi bị ảnh hưởng); kiểm chứng chạy nhưng không đặt cạnh diff / không chặn commit; thẻ cài gói thiếu giấy phép + trạng thái lockfile | cổng DUYỆT KẾ HOẠCH trước khi sửa trong agent lập trình; quy ước nhánh `agent/*` |
| VS Code | lệnh có tiền tố | thanh trạng thái chỉ bật/tắt ghost-text; sửa inline Ctrl+Alt+K mở `vscode.diff`, chưa chạy lint | huy hiệu "n việc cần duyệt"; thông báo; Problems + terminal chỉ đọc; Workspace Trust; lịch sử phiên chung web ↔ VS Code |
| Đánh giá | bộ chạy-được (ts/py/cs/cpp/tsql/pgsql/ps1 ~65 bài + agent-f 6 + FIM 128) | lặp ×3 bằng tay, chưa có pass@k tự động; T-SQL chỉ phân tích cú pháp; Postgres tạm bằng initdb | MySQL, MongoDB, SQL Server thật (container sandbox) |
| Dữ liệu huấn luyện | xuất JSONL từ đánh giá người dùng | sidecar LoRA có cổng | bộ sinh dữ liệu từ commit git + lấy mẫu loại bỏ (chỉ giữ lời giải qua test) |

## 3. Lộ trình — Đợt 11 (mỗi lô: kế hoạch → kiem-dinh rà → làm → cổng gộp)

### 11.0 Đo nền (do-model) — làm TRƯỚC mọi thay đổi
- **T6.1 thật trên máy này:** đỉnh VRAM với cấu hình hiện tại (35B + mmproj + embed + reranker + FIM nếu nạp) ở 64k / 96k / 131k; tốc độ prefill/decode từ `timings`; ghi bảng.
- **T6.6 baseline theo stack:** chạy bộ chạy-được hiện có ×3 → pass@1 tách theo ngôn ngữ; ghi nhóm thấp nhất (đưa vào ưu tiên ngữ cảnh 11.2).
- Kết quả quyết: ctx mặc định (giữ 64k nếu 131k không đạt), có giữ FIM trên GPU không, `-b/-ub`.
- Cổng: số đo ghi vào báo cáo; không đổi `.env` ở lô này.

### 11.1 Máy chủ & Trung tâm Model (do-model máy chủ, luong-ui giao diện)
- Cờ khởi động tường minh: `--alias` (tên cố định cho mọi client), `--jinja`, `--api-key-file` (khoá không lộ qua danh sách tiến trình), `-b/-ub` theo 11.0.
- Trung tâm Model (UX-D05): **lệnh khởi động sẽ chạy** (khớp 100 % lệnh thật — sinh từ CÙNG hàm), phân rã VRAM **đo** (không ước tính), chọn ctx trong danh sách đã qua T6.1, cảnh báo đỏ khi dự kiến > 30,5 GB; log máy chủ lọc cảnh báo/lỗi.
- tok/s lấy từ `timings.predicted_per_second` (UX-P03) — chưa đo thì hiện "—".
- Kiểm tra hệ thống (UX-D07, bản Windows): GPU/VRAM, driver, bản CUDA của build, đĩa trống, `.wslconfig`/bộ nhớ ảo (bài học page cache); mỗi lỗi kèm lệnh sửa; "Phải sửa" / "Nên sửa".
- Model tinh chỉnh khoá cho tới khi qua cổng đánh giá (UX-D06) — dùng sẵn cổng "≥1 lượt đo + giấy phép" của sổ model.

### 11.2 Ngữ cảnh codebase (do-model)
- **Repo map** sinh từ chỉ mục ký hiệu sẵn có (`chiMucMa/kyHieu.ts`) — tệp `docs/ai/repo-map.md` + nạp theo ngân sách (giữ "4k là điểm ngọt" — đo lại với repo map trong ngân sách).
- **Ngữ cảnh schema DB:** công cụ agent `schema_db` đọc qua vai trò chỉ-đọc `mcp_chi_doc` (đã có, ẩn cột nhạy cảm) + tệp `docs/ai/db/` sinh bằng `pg_dump --schema-only`; KHÔNG bao giờ dữ liệu thật.
- **Đồng hồ ngữ cảnh** đếm bằng `/tokenize` của máy chủ (UX-C05); cảnh báo 80 % (thống nhất với KH; hiện 85 %) + **tóm tắt sang NOTES.md và mở phiên mới**, người xem tóm tắt trước (UX-C06).
- Tài liệu framework theo phiên bản (KH 4.1.4): thư mục `docs/ai/vendor/` cho thư viện đổi API sau mốc huấn luyện của model; không tra mạng mặc định.
- Cổng: H và M không tụt; T6.6 nhóm thấp nhất tăng.

### 11.3 Agent & màn duyệt (luong-ui + do-model; kiem-dinh rà an toàn)
- **Cổng duyệt kế hoạch** trước khi agent lập trình ghi tệp/chạy lệnh (UX-D02) — kế hoạch hiện bước đang làm, giờ duyệt ghi sổ.
- **Màn duyệt thay đổi** (UX-D04): danh sách tệp đã/chưa xem, gộp/song song, phím J/K/A/R, **kết quả kiểm chứng cạnh diff** (build/test/lint), mục **"Cần bạn kiểm tra"** = nơi gọi hàm bị đổi chữ ký/ném lỗi mới (từ chỉ mục ký hiệu), nút commit chỉ bật khi mọi khối đã quyết; KHÔNG có nút push.
- Hộp duyệt lệnh (UX-S01): Enter = "Cho phép một lần"; hiện thư mục chạy + quy tắc áp dụng; khoá cứng `git push`, `reset --hard`, xoá ngoài repo, ghi DB thật **hiển thị** biểu tượng khoá (UX-S02).
- Thẻ cài gói: tên, phiên bản, **giấy phép**, có trong lockfile chưa (UX-S01/K4).
- Quét bí mật trên **nội dung** tệp trước khi vào ngữ cảnh (UX-S04) — dùng bộ che tuyến tính Đợt 10 + mẫu kiểu gitleaks; tệp bị chặn hiện lý do khi @-nhắc.
- **Thư mục điều khiển thiết bị** (UX-S09 + KH 7.12, khớp hàng rào L-7): nhãn trên diff + ô "Đã review theo quy trình" bắt buộc trước commit; danh sách thư mục do chủ dự án chỉ định (§6 Q5).
- Agent làm trên nhánh `agent/*`, không bao giờ push (đã không có thao tác push — thêm quy ước + kiểm).

### 11.4 Extension VS Code (luong-ui)
- Thanh trạng thái: model · % ngữ cảnh · tok/s đo thật; bấm ⇒ đổi hồ sơ / mở web (UX-V02).
- Huy hiệu số việc cần duyệt (UX-V01); thông báo khi agent cần duyệt/xong (UX-D08 phía VS Code).
- Sửa inline: phím (Ctrl+I nếu không trùng — phát hiện xung đột khi cài, UX-V05), diff inline, **chạy linter của ngôn ngữ** trước khi chấp nhận (UX-V04).
- Lỗi đẩy vào **Problems**; terminal "Agent" chỉ đọc (UX-V06); **Workspace Trust**: workspace chưa tin ⇒ chỉ Hỏi đáp (UX-V10).
- **Lịch sử phiên chung** web ↔ VS Code cùng repo (UX-C09) — lưu phía máy chủ (đã có kho phiên của web).

### 11.5 Đánh giá (do-model; kiem-dinh rà tính hợp lệ)
- pass@k tự động (mỗi bài 3 mẫu) + bảng theo stack (KH 6.1); nguồn bài = lỗi/tính năng thật đã đóng, KHÔNG nằm trong dữ liệu huấn luyện/bài học.
- **Container sandbox DB** (KH D.4): SQL Server 2022 thật (thay kiểm cú pháp), MySQL 8.4, MongoDB 8 — chỉ bind 127.0.0.1, không volume; Postgres giữ initdb tạm.
- T6.3 (gọi công cụ ≥ 95 % hợp lệ, không lặp > 3) chạy trên agent của ta + qua `/v1` cho client ngoài (OpenCode/Continue/Cline — hỗ trợ qua cổng OpenAI-compatible sẵn có, ghi hướng dẫn).
- T6.4 mở rộng ra MySQL/Mongo/SQL Server khi có sandbox (Postgres đã đạt qua `mcp_chi_doc`).
- Đánh giá câu trả lời (hữu ích/thử lại) xuất được thành bài đánh giá (UX-C12) — nối với hàng chờ bài học Đợt 10.5.

### 11.6 Dữ liệu tinh chỉnh (do-model) — CHỈ chuẩn bị, không huấn luyện
- Bộ sinh mẫu từ commit git (KH 5.2/E.3) + **lấy mẫu loại bỏ** bằng model đang chạy (chỉ giữ lời giải qua test) + quét bí mật + chia tập theo commit mới nhất.
- Huấn luyện LoRA trên GPU thuê: chờ §6 Q2. Nếu duyệt: cổng T6.5 (nội bộ +5 điểm, hồi quy chung −≤2) trước khi dùng; GGUF gốc không bao giờ bị ghi đè.

### 11.7 Đặt tên "Thợ Cả" (luong-ui) — chủ dự án chọn 2026-10-27
- Đổi **tên hiển thị** thành "Thợ Cả" (en: "ThoCa"; zh: giữ "Thợ Cả" kèm chú thích) (giao diện, tiêu đề extension, tiền tố lệnh, tài liệu); GIỮ mã định danh (`st4i.avi-ai-local`, `aviAiLocal.*`) để không phải cài lại / mất cài đặt.

## 4. Không làm (khác báo cáo) — có lý do
- **Ứng dụng desktop riêng:** màn `/ai-coding-workspace` (web) đóng vai "Desktop"; không dựng ứng dụng Windows thứ hai (câu hỏi mở số 4 của báo cáo).
- **Agent ngoài (OpenCode, Continue, Aider, Claude Code) làm agent chính:** ta có agent riêng + extension; client ngoài vẫn dùng được qua `/v1` — chỉ viết hướng dẫn.
- **Chia sẻ máy chủ cho đồng nghiệp trong LAN:** giữ 127.0.0.1 (KH 7.1) trừ khi chủ dự án quyết khác (§6 Q4).

## 5. Phân công & thứ tự
1. 11.0 (do-model) — 1 lô, không đổi cấu hình.
2. Song song sau 11.0: 11.1 + 11.2 (do-model, luong-ui phần giao diện) · 11.3 (luong-ui + do-model) · 11.4 (luong-ui).
3. 11.5 xen kẽ (do-model). 11.6 sau khi chủ dự án trả lời Q2. 11.7 khi có tên.
- kiem-dinh rà độc lập mọi lô 11.3 (an toàn) + tính hợp lệ của số đo 11.0/11.5.
- Dải migration nếu cần: báo dieu-phoi trước (AI còn 0417–0419).
- Nghiệm thu đợt: P0 của UX đạt tiêu chí; K1–K7 làm theo phiên bản web + VS Code với 5 người dùng (UX §9) khi giao diện xong.

## 6. Câu hỏi cho chủ dự án
1. ~~**Tên** cho AI Local~~ — **ĐÃ QUYẾT 2026-10-27: "Thợ Cả"** (tiếng Anh hiển thị: "ThoCa"). Áp dụng ở 11.7.
2. **Huấn luyện LoRA trên GPU thuê** (mã nguồn rời máy, cần chọn nhà cung cấp có cam kết dữ liệu) — có làm không?
3. **ctx 131k**: nếu đo cho thấy chỉ đạt khi tắt mmproj (mất đọc ảnh) thì chọn ctx dài hay đọc ảnh?
4. **Chia sẻ máy chủ trong LAN** cho đồng nghiệp — giữ chỉ máy này?
5. **Danh sách thư mục "điều khiển thiết bị"** (PLC/robot/interlock) và ai duy trì.

## Phụ lục A — bằng chứng đối chiếu (khảo sát 2026-10-27)
Xem báo cáo khảo sát 30 mục do dieu-phoi ghi; các điểm chính: lệnh khởi động `scripts/ai/start-llama-server.ps1:204-254`; tok/s theo đồng hồ `repoWorkspaceRouter.ts:755`;
output hỏng `generationGuard.ts:187,283`; chống lặp `shared/agentCore/vongAgent.ts:580-591`; AGENTS.md `server/services/ai/agent/tepQuyUocAgent.ts:24`; chỉ thị nhúng `shared/quetMenhLenh.ts`;
tệp cấm `repoSandbox.ts:145-159`; chấp nhận theo khối `client/src/components/diff/HunkDiffView.tsx`; kiểm chứng `server/services/aiCodingVerify.ts`; allowlist lệnh `vscode-extension/src/loi/lenhChoPhep.ts`;
bộ chạy-được `scripts/ai-eval/codegen-chay-duoc/` (tasks/tasks-hard/tasks-api/tasks-api2/agent-f); FIM `aiGgufEngine.ts:1099,2737`.
