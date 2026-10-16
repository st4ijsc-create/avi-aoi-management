# Kế hoạch hoàn thiện AI Local theo 7 tầng (2026-10-14)

Đầu vào: `docs/superpowers/audits/2026-10-14-ai-local-khao-sat-7-tang.md` (điểm hiện tại: trình duyệt ≈ 50 %,
VSCode ≈ 33 %). Kế hoạch theo đợt; mỗi đợt có **cổng ra bằng số đo** viết TRƯỚC khi làm, theo luật đã có của dự án:
đo hai trục M/H, ≥ 3 lượt (A2 ≥ 12 lượt), nhiễu H ±3 bài, ablation trước khi nối dây, đúng hơn nhanh.

## 0. Nguyên tắc thiết kế

1. **Một lõi agent, nhiều bề mặt.** Trình duyệt, VSCode, CLI dùng chung một vòng *model gọi tool → quan sát → gọi
   tiếp*; khác nhau ở **bộ thực thi** (hộp cát server vs workspace VSCode), không ở logic.
2. **Hàng rào giữ nguyên, phạm vi mở rộng.** Mọi lượt ghi vẫn qua điểm ghi duy nhất + duyệt + audit; lượt ghi
   **tạm dừng** vòng chờ duyệt rồi đi tiếp, không kết thúc vòng.
3. **Có điểm quay về trước khi có tự chủ.** Checkpoint/hoàn tác theo lượt phải xong trước khi mở rộng tự ghi.
4. **Tri thức đi vào qua công cụ, không qua top‑K theo câu hỏi** (đã bị số bác 0/12).
5. **Offline là ràng buộc cứng.** Cài phụ thuộc, git, preview phải chạy được không có internet.

## 1. Quyết định cần chủ dự án (trước Đợt 1)

| # | Quyết định | Đề xuất |
|---|---|---|
| Q1 | **Ngay bây giờ:** `.env` đang bật `AI_CODING_TU_TRI_GHI=1` + `AI_CODING_AUTOLOOP=1`, danh sách dự án gồm cả repo chính, chưa có checkpoint | Loại repo chính khỏi tự ghi tới khi Đợt 1 có checkpoint (giữ cho dự án hộp cát) | -> Đồng ý loại
| Q2 | Lõi agent chạy ở đâu cho VSCode | **(A) Gói dùng chung `shared/agentCore`**: server chạy nó cho trình duyệt, extension host chạy nó cho VSCode và gọi `/v1` (tool-calling gốc) bằng token theo người dùng — giống kiến trúc Claude Code, không giữ phiên chờ ở server. Phương án (B): vòng ở server, tool chạy ở client qua giao thức hỏi-đáp — một nơi audit nhưng phải giữ phiên mở và đi vòng mạng mỗi tool | -> CHọn A
| Q3 | Kỹ sư tự tạo dự án | Thư mục gốc được quản lý (vd `D:\AI-Projects\<người dùng>\`), hạn mức, không cần admin; repo chính và đường ngoài gốc vẫn cần admin | -> Đồng ý
| Q4 | Cài phụ thuộc khi offline | Kho gói nội bộ (Verdaccio cho npm, thư mục wheel cho pip, NuGet cache cục bộ) + lệnh cài nằm trong allowlist, có duyệt | -> Đồng ý
| Q5 | Slot model | Giữ 1 × 64k cho model chính + **một llama-server nhỏ thứ hai** (4B fast + FIM, ~4–5 GB) để ghost-text và câu vận hành không xếp hàng sau agent; hoặc `-np 2 × 32k` (đã đo H tụt khi ctx 32k) | -> Chọn giữ 1x64
| Q6 | Preview web app | Dev server trong hộp cát trên dải cổng riêng, xem qua proxy iframe có xác thực |-> Đồng ý

## 2. Các đợt

### Đợt 0 — Nền vận hành và đo lại nền (S)
| Việc | Chi tiết |
|---|---|
| 0.1 Giám sát llama-server | Watchdog trong app: `/health` hỏng ⇒ chạy `start-llama-server.ps1`, cảnh báo trên thanh trạng thái + System Health; bỏ lùi in-process **im lặng** cho model chính (fail-closed có thông báo, hoặc lùi có banner) |
| 0.2 Khớp `node-llama-cpp` | 3.19.0 vs `@node-llama-cpp/win-x64-cuda` 3.18.1 — đo `getLlama().gpu` trước/sau |
| 0.3 Hàng đợi ưu tiên | Ở cổng: người đang thao tác > agent nền > cron; đo lại độ trễ câu vận hành khi có lượt lập trình (nền 20–24 s) |
| 0.4 Đo lại nền trên HEAD | H 12×3 · A2 ×12 · `duan.mjs` ×3 · `eval-vscode-route.mjs` — 3 tuần không đo |
| 0.5 Sửa nhỏ đã thấy | Nhãn sai "Mã do model viết" trên đầu ra lệnh; cột số dòng "1"; README trong VSIX lỗi thời; chú thích "65536 không nạp nổi"; đường lùi Ollama trỏ model không tồn tại |

**Cổng:** giết llama-server ⇒ phục vụ lại ≤ 90 s, UI báo đúng trong lúc chết; bảng nền mới có đủ 4 bộ đo kèm số lượt.

### Đợt 1 — Lõi agent dùng chung (L) — đòn bẩy lớn nhất
| Việc | Chi tiết |
|---|---|
| 1.1 `shared/agentCore` | Vòng tool-calling gốc (`nativeToolCalls`), sự kiện chuẩn: `plan` · `tool_call` · `tool_result` · `can_duyet` · `checkpoint` · `usage`; giao diện `BoThucThi` (hộp cát / VSCode); trần lượt · thời gian · token; huỷ lan tới lệnh đang chạy và vòng tự trị (hiện chưa lan) |
| 1.2 Bộ tool | đọc/liệt kê/grep · **sửa nhiều tệp** (vá theo khối) · **tạo / xoá / đổi tên** · `chay_lenh` (allowlist) · `lay_chan_doan` (lỗi build/test có cấu trúc) · `ghi_ke_hoach` (todo) · `nho` · `tra_tai_lieu` (Đợt 2 nối) |
| 1.3 Duyệt tạm dừng/tiếp tục | Trạng thái vòng lưu DB; duyệt ⇒ vòng chạy tiếp; bác + lý do ⇒ quay về model |
| 1.4 Checkpoint/hoàn tác | Mỗi lượt ghi tạo điểm quay về bằng git plumbing trên ref riêng (`refs/ai-checkpoints/*`, không dùng stash — hook repo chặn); dự án không có git ⇒ kho bóng ngoài thư mục dự án; hoàn tác theo lượt |
| 1.5 Chế độ | "Hỏi" giữ các đường ống hiện có (đã đo 83–86 %); "Agent" đi lõi mới — A/B được, không phá số cũ |
| 1.6 Bộ đo mới | **Bộ F**: ≥ 6 tác vụ tính năng nhiều tệp (React+Node, C#, Python), chấm bằng test do máy chạy; bộ "dự án mới từ mô tả" |

**Cổng:** A2 ≥ 70 % trên 12 lượt (nền ≈ 44 %); F ≥ 60 % ×3; H chế độ Hỏi không tụt quá ±3; census 0 lượt ghi ngoài
hộp cát; hoàn tác trả đĩa về đúng byte (kiểm băm).

### Đợt 2 — Ngữ cảnh và trí nhớ (M–L)
| Việc | Chi tiết |
|---|---|
| 2.1 Index theo dự án | Dựng khi đăng ký dự án, cập nhật theo băm sau mỗi lượt ghi (tái dùng nhúng gia tăng); bật pgvector (`KB_PGVECTOR_ENABLED`) khóa theo dự án; gỡ cổng `khac-goc` khi index tách theo `projectRoot` |
| 2.2 Ký hiệu | Tool `tim_ky_hieu` (định nghĩa/tham chiếu) bằng tree-sitter cho ts/js/py/cs; VSCode dùng LSP sẵn có |
| 2.3 Tệp quy ước dự án | Nạp `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` vào mọi lượt |
| 2.4 Một kho trí nhớ | DB, phạm vi người dùng × dự án, dùng chung web/VSCode/CLI; đề xuất bài học **theo sự kiện** (diff bị bác kèm lý do, lỗi build lặp, người sửa lại diff) — người xác nhận mới ghi |
| 2.5 Lịch sử dài | Tóm tắt khi quá N lượt thay vì chỉ giữ 8 lượt cuối |
| 2.6 Tri thức vào sinh mã | Tool `tra_tai_lieu` (corpus Studio theo dự án) + tra theo **ký hiệu trong mã nháp** cho lớp lỗi API (ca D1 `GetInt32`) |

**Cổng:** H trên một dự án ngoài repo chính ≥ mức repo chính −3; ablation index bật/tắt có chênh ngoài nhiễu;
D1 3/3; bài học đề xuất ≥ 1 / 5 phiên, đo tỉ lệ được chấp nhận; câu hỏi ngoài corpus không kéo đoạn Studio vào prompt.

### Đợt 3 — Trình duyệt: vòng đời dự án (L)
| Việc | Chi tiết |
|---|---|
| 3.1 Dự án | Kỹ sư tạo/mở dự án trong gốc quản lý (Q3); dự án mới từ mô tả ⇒ **thư mục mới**; nhập zip / git từ máy chủ nội bộ; cài đặt theo dự án |
| 3.2 Bề mặt agent | Bộ chọn Hỏi/Sửa/Agent; bảng kế hoạch/todo sống; duyệt nhiều tệp theo tệp + hunk; dòng thời gian checkpoint + hoàn tác |
| 3.3 Chạy | Cài phụ thuộc offline (Q4); chạy app + preview (Q6); terminal chạy lệnh đã duyệt **không** đi vòng qua model |
| 3.4 Git | Trạng thái, diff, commit (gợi ý thông điệp), nhánh — có duyệt |
| 3.5 Tiện ích | Nút tạo/xoá/đổi tên tệp; màn quản lý trí nhớ; đặt tên phiên; dán ảnh lỗi |

**Cổng:** hành trình 8/8 bước cho 3 stack bằng tài khoản kỹ sư không phải admin, ×3 lượt, có Playwright e2e.

### Đợt 4 — Extension VSCode v0.2 (L)
| Việc | Chi tiết |
|---|---|
| 4.1 Lõi agent | Chạy `shared/agentCore` với bộ thực thi VSCode: `WorkspaceEdit` nhiều tệp + create/delete/rename qua `apBanVa` (vẫn là điểm ghi duy nhất); kết quả lệnh và `getDiagnostics` quay về model; gỡ trần 900 token / kênh hỏi-đáp |
| 4.2 Kênh | `/v1` tool-calling gốc; đăng nhập đổi lấy token theo người dùng (tương thích 2FA); bỏ một khoá dùng chung + CORS `*` |
| 4.3 Ghost-text | `InlineCompletionItemProvider` qua `/v1/completions` FIM; đổi sang model FIM bản **base**; bộ đo độ đúng FIM |
| 4.4 Giao diện | Markdown + nút áp dụng/chèn/chép khối mã; Ctrl+I sửa tại chỗ theo hunk; duyệt nhiều tệp; checkpoint |
| 4.5 Ngữ cảnh | @folder · @symbol · @problems · @git diff · @terminal; tệp quy ước dự án; lệnh slash `/fix /test /explain /commit`; chọn model/chế độ nghĩ + đồng hồ token |
| 4.6 Tích hợp | CodeAction "Sửa bằng AI", sinh thông điệp commit; i18n giao diện; README đúng |
| 4.7 An toàn | Từ chối diff đưa chuỗi `[REDACTED_*]` vào tệp khi bản gốc không có (kiểm rủi ro [SUY] ở báo cáo §6 trước) |

**Cổng:** bộ đầu-cuối VSCode mới ≥ 20 tác vụ (≥ 8 tác vụ ghi nhiều tệp) ≥ 70 %; ghost-text p50 ≤ 300 ms và độ đúng
FIM ≥ nền trên tập giữ lại; 0 lượt ghi ngoài workspace; lưới che bí mật không rò.

### Đợt 5 — Training làm AI thông minh hơn (M)
| Việc | Chi tiết |
|---|---|
| 5.1 Phản hồi | 👍/👎 + lý do ở trình duyệt và VSCode; lưu diff duyệt/bác + ngữ cảnh thành bộ dữ liệu xuất được |
| 5.2 Eval mã | Trong Studio: "câu hỏi → mã → biên dịch/test" với corpus bật/tắt (A/B); cổng chặn khi eval tụt |
| 5.3 Corpus | Gắn dự án/miền; loại corpus thử nghiệm khỏi truy hồi; job nền có huỷ + %; nạp repo mã, CSV/xlsx, pptx, crawl URL |
| 5.4 Sửa lời UI | Bỏ các câu hứa quá khả năng thật ("có ích thật", "đưa vào prompt") cho tới khi 5.2 có số |
| 5.5 LoRA — chỉ mở khi đủ điều kiện | ≥ ~2.000 cặp đã duyệt từ 5.1 **và** eval cho thấy lỗi kiểu "quy ước/API của dự án" chiếm phần đáng kể (G9). Khi mở: dữ liệu cặp chỉ dẫn/mã, eval biên dịch/test, phục vụ `--lora`, rollback, ngân sách VRAM |

**Cổng:** A/B corpus nâng H trên bộ bài nặng API ngoài nhiễu; bảng phản hồi có hàng từ dùng thật.

### Đợt 6 — Vận hành và mở rộng (M, chạy song song từ sau Đợt 1)
API đổi model có kiểm `/props` thay cho `doi-model.ps1` (công cụ đo, không dùng cho sản phẩm); server nhỏ thứ hai (Q5);
model lên NVMe; dọn ổ C:; dọn kho model không dùng (~89 GB).

## 3. Thứ tự và phụ thuộc

```
Q1 (ngay) ─► Đợt 0 ─► Đợt 1 ─┬─► Đợt 2 ─► Đợt 3
                              ├─► Đợt 4 (4.3 ghost-text làm được ngay sau Đợt 0)
                              └─► Đợt 6
                    Đợt 2 + 5.1 ─► Đợt 5
```

## 4. Mức kỳ vọng sau từng đợt (dự kiến, đo lại ở mỗi cổng)

| Sau | Trình duyệt | VSCode |
|---|---:|---:|
| Hiện tại | ~50 % | ~33 % |
| Đợt 0 | 52 % | 35 % (sửa nhỏ) |
| Đợt 1 | 65 % | 40 % (lõi có, chưa nối) |
| Đợt 2 | 72 % | 45 % |
| Đợt 3 | 85 % | 45 % |
| Đợt 4 | 85 % | 80 % |
| Đợt 5 | 90 % | 85 % |

Các con số này là mục tiêu chấm theo cùng danh mục của báo cáo khảo sát; chỉ được ghi là "đạt" khi cổng của đợt đo xong.

## 5. Trạng thái thực thi (cập nhật liên tục)

Làm trong worktree riêng `D:/SOURCES/_ai7_wt`, nhánh `feat/ai-local-7-tang`, server thử `:3010` (cùng DB dev).
Chủ dự án giao toàn quyền (2026-10-14); Q1–Q6 đã trả lời (Q5: giữ 1 × 64k, không thêm server thứ hai).

### Đợt 0 — XONG về mã (`088c9ee4f`), chờ đo sống cổng giết-server
| Việc | Kết quả |
|---|---|
| 0.1 | `giamSatLlamaServer`: chết = ECONNREFUSED 2 nhịp × 15 s ⇒ khởi động lại tách rời, khoá liên tiến trình, trần 3 lần/30 phút, tệp tạm dừng (`doi-model.ps1` tự tạo); model chính fail-closed (chờ ≤ 120 s rồi `LLAMA_SERVER_DOWN`); trạng thái lên `/api/health/ai`, thanh trạng thái, System Health |
| 0.2 | **Đóng bằng đo**: node-llama-cpp 3.19.0 + gói cuda 3.18.1 vẫn nạp `cuda prebuilt` — lo ngại Vulkan của khảo sát là sai |
| 0.3 | `hangDoiUuTienLlm` (tương tác > agent > nền, chống đói 120 s, huỷ khi chờ); 6 nguồn nền bọc ở điểm vào. Sự kiện SSE "đang chờ lượt" chuyển sang chế độ agent (Đợt 1) |
| 0.4 | Nền đo lại (bảng dưới) |
| 0.5 | Nhãn đầu ra lệnh (+ vá giả nhãn `ec85a97e6` sau rà bảo mật), số dòng khối mã, README extension, chú thích 1 × 64k, Ollama lùi kiểm `/api/tags`, CLI không ghim model |
| Q1 | Vòng tự ghi từ chối tệp đích trong repo chính ngoài `sandbox-projects/` (realpath); ghi đè `AI_CODING_TU_TRI_GHI_REPO_CHINH=1` |

**Nền 2026-10-14/17 (HEAD trước thay đổi, `:3010`, Qwen3.6-35B-A3B 1 × 64k, nghĩ 12k):**

| Bộ đo | Kết quả |
|---|---|
| H 12 bài khó × 3 | **27/36 = 75 %** (11 · 8 · 8; mốc tháng 9: 30–31/36, nhiễu ±3) |
| A1 (1 lỗi / 1 tệp) × 12 | 12/12 |
| A2 (2 lỗi / 2 tệp) × 12, vòng tự trị cũ | **4/12 = 33 %** (tháng 9: ≈ 44 %) |
| Ba dự án thật × 3 | 21/21 hiện vật |
| Kiểm thước | fake-ok 12/12 · fake-bad 0/12 · F: mẫu 6/6, gốc 0/6, gian lận 0/6 |

Hai lần thiết bị đo sinh số giả trong lượt này, đã vứt số: (1) worktree mới thiếu `knowledge/` sinh ra ⇒ KB rỗng ⇒ H 7/12;
(2) `.env` chép trỏ gốc dự án "repo" vào worktree chính ⇒ A1/A2 0/24 ở 150 ms và ghi nhầm 2 tệp hộp cát của worktree chính (đã trả HEAD).

### Đợt 1 — đang làm
T1 `shared/agentCore` (`a74304749`, 92 ca) · T2 `delete_file`/`rename_file`/`find_files` (`03ecad270`) + vá `git status` warning
làm "tạo tệp mới trong thư mục mới" bị coi là tệp bẩn · T6 bộ F (`c05b9848b`) · T3 checkpoint, T4 runtime server + API + mig 0390,
T5 UI chế độ agent: đang làm.
**Lệch kế hoạch có chủ ý:** checkpoint dùng ảnh chụp byte ngoài dự án thay cho git plumbing (chạy cả dự án không có git; hook repo chặn stash).
