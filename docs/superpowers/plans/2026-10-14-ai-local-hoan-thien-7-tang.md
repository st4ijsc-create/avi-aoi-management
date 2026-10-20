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

### Đợt 7 — Đa model hoán đổi theo vai trò (M) — thêm 2026-10-20 (D1)
Spec `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §3, kế hoạch pha 7.0
`docs/superpowers/plans/2026-10-20-ai-local-dot7-pha0-so-model-vai-tro.md`. Pha: 7.0 sổ model + vai trò + định tuyến
tầng 1–3 (**XONG 2026-10-20**) · 7.1 bộ giám sát khe nặng (hàng đợi ái lực, :8091 vào VRAM broker) · 7.2 bộ đo
`plc-st-v1` + toolchain ST · 7.3 đo ứng viên `code.plc` + định tuyến ngữ nghĩa · 7.4 Trung tâm Model (UI).
Giữ Q5 (1 × 64k): không thêm llama-server.

### Đợt 8 — Luồng AI kiểu n8n, xây trong nhà trên FOE (L) — thêm 2026-10-20 (D1, D2, D4)
Spec cùng tệp §4. Pha 8.0 tách `shared/flow` + hàng đợi Postgres bền · 8.1 node lõi + 3 mẫu luồng · 8.2 phân hạng tác dụng
phụ + bí mật + runner cách ly · 8.3 Flow Studio · 8.4 `ai.agent` + `ai.sinhMa` + MCP + mô tả → luồng · 8.5 node OT chế độ
mô phỏng (D4). Dải migration 0400–0419 (D3).

## 3. Thứ tự và phụ thuộc

```
Q1 (ngay) ─► Đợt 0 ─► Đợt 1 ─┬─► Đợt 2 ─► Đợt 3
                              ├─► Đợt 4 (4.3 ghost-text làm được ngay sau Đợt 0)
                              └─► Đợt 6
                    Đợt 2 + 5.1 ─► Đợt 5
         Đợt 1 ─► Đợt 7 (7.0 ─► 7.1 ─► 7.2 ∥ 8.0 ─► 7.3 ─► 7.4)
         Đợt 1 + 7.0 ─► Đợt 8 (8.0 ─► 8.1 ─► 8.2 ─► 8.3 ─► 8.4 ─► 8.5)
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

### Đợt 1 — CỔNG ĐẠT (2026-10-17, build `b55ae63c2` trên `:3010`)
| Cổng | Ngưỡng | Kết quả | Nền |
|---|---|---|---|
| A2 (2 lỗi / 2 tệp) qua chế độ agent `tu-dong`, 12 lượt | ≥ 70 % | **12/12 = 100 %** (trung vị 13 s) | 4/12 = 33 % (vòng tự trị cũ) |
| A1 × 12 | — | 12/12 | 12/12 |
| Bộ F (6 bài tính năng nhiều tệp TS/JS/Py/C#) × 3 | ≥ 60 % | **14/18 = 78 %** (4/6 · 5/6 · 5/6) | 0 % (không đường nào làm được) |
| Chế độ Hỏi H 12 × 3 | không tụt quá ±3 | **30/36 = 83 %** | 27/36 |
| Tệp test bị sửa | phải bị bắt | 1/18 lượt (py-dang-ky lượt 1) — thước bắt, tính TRƯỢT | — |

Trượt còn lại: `py-dang-ky` 13/14 ổn định — model thêm bản dịch Anh cho khoá mà bảng đề bài KHÔNG liệt kê (không bám đặc tả;
thước công bằng, giữ). Lượt 3 `cs-dat-phong` bị huỷ nhầm bởi chính chủ dự án ⇒ chạy bù (ĐẠT).

Lỗi sản phẩm thật lộ ra khi đo sống (đã vá, mỗi cái có lưới đỏ trước):
1. Watchdog spawn PowerShell `detached` ⇒ không console ⇒ thoát 0 không chạy gì (cổng giết-server 300 s) ⇒ vá: phục hồi 31 s.
2. Qwen3.6 phát tool call (khuôn XML) TRONG `reasoning_content` ⇒ 0 tool call ⇒ G5-D chẩn đoán sai ⇒ lượt agent chết. Bản đầu
   VỚT khối đó; rà bảo mật bác 3 lần (tiêm khi trích dữ liệu · vi sai bộ phân tích · ReDoS) ⇒ chốt: chữ suy luận KHÔNG BAO GIỜ
   thành hành động; phát hiện + hỏi lại lượt đó với nghĩ TẮT.
3. Hộp cát chặn `.py` (và Java/Go/Rust/C/C++…) ⇒ 2/2 bài Python trượt ⇒ mở danh sách đuôi ngôn ngữ nguồn văn bản.
4. `git status` gộp stderr `warning:` ⇒ tạo tệp mới trong thư mục con mới bị coi là "tệp bẩn".
5. Cuộc đua lý do bác (bộ kiểm 1 s thắng bus) ⇒ model nhận "rejected" mất lý do.
Rà bảo mật tự động mỗi commit còn bắt: nhãn tin cậy "đầu ra lệnh" giả được · lệnh tự chạy ở tu-dong lỏng hơn vòng cũ · manifest
hoàn tác nằm trong vùng agent ghi được (nay ngoài repo + ký HMAC) — tất cả đã vá.

### Đợt 2 + 4A — mã xong (`de591c868`), chờ đo
Đợt 2: tool `find_symbol` / `search_code` / `search_docs` / `remember` (đề xuất, người duyệt mới ghi), tệp quy ước dự án, chỉ mục
mã theo dự án (mig 0391, pgvector). Đợt 4A: token cá nhân `/v1` + device flow (mig 0392) — đang vá 3 phát hiện rà bảo mật trước
khi áp dev. Đang làm song song: 3a dự án cho kỹ sư, 3c cài/chạy/xem trước, 4B extension v0.2 chạy lõi agent.

### Đợt 2 — ĐO CỔNG (2026-10-17, build `efb9ff532` trên `:3010`; chỉ mục repo trọn 5.911 tệp / 59.906 đoạn)
| Cổng | Ngưỡng | Bật tool mới | Tắt (`AI_AGENT_AN_CONG_CU`) |
|---|---|---|---|
| (1) Tìm mã đúng tệp:dòng, 15 câu × 3 | ≥ 80 % | **41/45 = 91 % — ĐẠT** | 39/45 = 87 % |
| (2) Số tool trung vị GIẢM | bật < tắt | **5 = 5 — CHƯA ĐẠT theo định nghĩa** | 5 |
| Hồi quy F × 3 | không tụt | **15/18 = 83 %** (5/6 × 3; Đợt 1: 14/18) | — |

Đọc số cho đúng (không đổi tiêu chí sau khi thấy dữ liệu — ghi ra để lần sau đặt cổng cho đúng): tác dụng nằm ở ĐUÔI và ở repo
LỚN. 9 câu repo chính × 3: tổng tool 205 → **116** (−43 %), p90 tool 20 → 7, p90 thời gian 51 s → 20 s, token ra 59k → 27k,
đúng 21 → 24/27; trung vị vẫn 3 = 3 (câu dễ grep 2–3 lượt là xong). 6 câu dự án nhỏ agent-f: tool mới gần như không được gọi
(`list_dir` đủ) ⇒ không đổi. Cổng (2) nên là "tổng tool / p90 trên repo lớn" — ghi nhận, KHÔNG tính lại là đạt.
Câu R5 (giá trị 30 lượt trong `GIOI_HAN_MAC_DINH`) 0/3 ở cả hai nhánh: model không tìm ra `soLuotToiDa: 30` — trượt thật.

Lỗi sản phẩm/thiết bị đo lộ ra khi đo cổng Đợt 2 (đã vá):
1. `trangThaiChiMuc` = "sẵn sàng" khi CÓ BẤT KỲ hàng nào ⇒ chỉ mục chết giữa chừng (393 đoạn) mãi "sẵn sàng" ⇒ sổ trạng thái
   lượt dựng (mig 0395, `44932d984`): sẵn sàng CHỈ khi lượt dựng ghi `xong`; trần 45 phút ⇒ `do-dang`, lượt sau đi tiếp theo băm.
2. Bảo vệ "mệnh lệnh trong dữ liệu" DỪNG CẢ LƯỢT khi agent đọc mã an toàn/lời nhắc của chính repo (7/45 lượt câu trả lời rỗng) ⇒
   `efb9ff532`: không dừng; cảnh báo + cờ trên thẻ duyệt; `tu-dong` HẠ tự trị một chiều (thi hành ở cả hai bộ thực thi).
3. Thước chấm bỏ sót dạng `- **Dòng**: **86**` (âm tính giả) ⇒ `9711e64fb` + kiểu viết thứ 6 trong kiểm thước.
4. Máy: `python` trên PATH người dùng trỏ stub WindowsApps (treo) vì `…\Programs\Python\Python314\` rỗng đứng trước ⇒ bài Python
   bị VỨT đúng cách. Không sửa PATH máy; `:3010` + bộ đo đặt PATH theo tiến trình (`…\Local\Python\bin` trước).

### Đợt 3/4/5 — mã đã commit trong ngày 2026-10-17 (chưa có số cổng trừ ghi chú)
3a dự án cá nhân (mig 0393) · 3b bảng Git + 3d UX (`77b5134cb`) · 3c chạy/xem trước — xem trước bắt buộc HOST khác site
(`d1b5d289d`, `9efc29ffb`, cookie-tossing) · 4A token + device flow (mig 0392/0394) · 4B extension v0.2 + sổ áp tệp Bearer
(`126de672b`, mig 0396, `6369a1703`) · 4C ghost-text (`22e81add4`; FIM base q8_0: dòng đầu 43,8 % vs Instruct 37,5 %, +8/−0) ·
bảo mật extension (`655e4a77f`, `84ab2a301` mẫu bí mật chung) · 5.1/5.2/5.4 (`092bb4ec2`, mig 0397). Migration 0390–0397 đã áp dev.
Bộ đo cổng Đợt 4 `scripts/ai-eval/vscode-e2e/` (`c682ccf70`): 21 bài (14 nhiều tệp), kiểm thước 9/9.

### Đợt 4 — CỔNG ĐẠT (2026-10-17, extension chạy headless bằng đúng mã thật; `:3010`)
| Lượt | Build | ĐẠT (21 × 3) | Nhiều tệp | Ghi ngoài | Rò `.env` | Sổ lệch | Ghi chú |
|---|---|---|---|---|---|---|---|
| V-dot4-1 | `84ab2a301` | 55/63 = 87 % | 34/42 | 0 | 0 | 0 | harness bác `node --test`/`pytest` (danh sách cũ) ⇒ chặn dưới |
| V-dot4-2 | `84ab2a301` | 55/63 = 87 % | 36/42 | 0 (model thử 2, lọt 0) | 0 | 0 | 4 lượt `loi-model` |
| **V-dot4-3** | `9ff2ba9f3` | **56/63 = 89 %** | **36/42** | 0 | 0 | 0 | 0 lượt `loi-model` |
Ghost-text (đo ngoại tuyến trên GGUF, chưa qua `/v1`): p50 142 ms ≤ 300; dòng đầu 43,8 % ≥ nền 37,5 %.
Trượt ổn định: `py-dang-ky` 0/3 (cùng bài trượt bên trình duyệt). Lỗi sản phẩm lộ ra và đã vá: `ghp_` trong tệp mã rò 21/21
(⇒ mẫu bí mật chung), allowlist thiếu lệnh test, lớp "trả lời nằm trong suy luận chưa đóng" không được hỏi lại ở `/v1` +
extension (5/6 lượt `loi-model`; thông điệp lỗi bị bộ đo cắt 160 ký tự che mất nguyên nhân). Còn mở: llama-server HTTP 500
"Failed to parse tool call arguments" khi tham số tool quá dài (1/63). Chưa kiểm bằng tay trong VSCode thật.

### Đợt 5.1 phía VSCode + Đợt 6 đổi model — XONG + đo sống (2026-10-17)
- 5.1 VSCode `6f846cc09` (mig 0398 đã áp dev): phiếu cho lượt extension CỤC BỘ qua `POST /api/ai/client-feedback`
  (Bearer, văn bản do client gửi ⇒ che + trần; cột `nguon` — bộ xuất JSONL CHỈ đọc nguồn `web`). Nút web `f685c233f`.
- Đợt 6 `1b04f2abd` + `4ec67d529`: đổi model llama-server qua API (admin + 2FA), lựa chọn bền ở
  `%LOCALAPPDATA%\avi-aoi-ai\llama-server-lua-chon.json` (KHÔNG ghi `.env`). Đo SỐNG trên :8091:
  Qwen3.6-35B → Qwen3-Coder-30B 43 s → về 13 s, `/props` khớp, sinh thử OK, dòng lệnh giữ `--reasoning-budget 12000`.
  Lần đo đầu (tiến trình gọi chết giữa lượt) lộ LỖ: lựa chọn ghi TRƯỚC khi kiểm + tạm dừng/khoá mồ côi ⇒ vá: `-Model`
  tường minh, lựa chọn chỉ bền SAU `/props` + sinh thử; `phucHoiLuotMoCoi`. Đo sống lại bằng GIẾT tiến trình gọi giữa
  `khoi-dong`: lựa chọn bền giữ nguyên, phục hồi gỡ khoá PID chết + đúng tạm dừng của nó, cảnh báo server chạy model chưa
  kiểm (chỉ lệch nhãn) ⇒ lượt đổi thường đưa về Qwen3.6 ĐẠT. Task Scheduler chạy ps1 của repo chính ⇒ hiệu lực sau gộp.

### Đợt 5 — ĐO CỔNG: CHƯA ĐẠT (2026-10-17, Eval mã Studio, corpus `csharp-dotnet` 964 đoạn)
| Bộ bài | TẮT | BẬT | Biên | Lượt BẬT có đoạn | Kết luận |
|---|---|---|---|---|---|
| tasks-hard 12 × 3 | 25/36 | 27/36 | ±3 | 6/36 (lạc đề) | trong nhiễu (tập con có đoạn 3 → 2/6) |
| tasks-api 6 × 3 (ADO.NET, bản đo trong tmp) | 14/18 | 13/18 | ±2 | 18/18 | trong nhiễu |
Bảng `ai_agent_feedback`: 0 hàng (chưa ai dùng thật). Corpus giúp 1 bài (namespace `SqlDbType` 1/3 → 3/3), hại 1 bài, thiếu
trang `SqlBulkCopyOptions` (bài A-cs6 5/6 trượt cả hai nhánh). Sau đo (`bc5b67343`): thước tập con "bài có đoạn" + bộ
`tasks-api` vào repo + nhánh đối chứng A/A để đo nhiễu riêng — đo lại cổng cần: chạy A/A, bổ sung corpus, dữ liệu phản hồi thật.

Đo lại 2026-10-18 (bộ `tasks-api` trong repo, 6 bài × 3 — dịch vụ ghim trần `TRAN_SO_LAP` = 3 dù xin 5):
| Lượt | TẮT | BẬT | Biên | Kết luận dịch vụ |
|---|---|---|---|---|
| A/A đối chứng (cùng prompt) | 12/18 | 11/18 | ±2 | nhiễu ±1 |
| A/B lần 2 | 10/18 | 13/18 | ±2 | **nâng** |
| A/B lần 3 | 12/18 | 14/18 | ±2 | trong nhiễu (+2 = biên) |
Tác dụng THẬT và lặp lại được nằm ở MỘT bài: A-cs3 (namespace `SqlDbType`) TẮT 2/9 · BẬT 8/9 qua ba lượt A/B. Tổng thể: 1/3 lượt
"nâng" ⇒ chưa đủ để ghi cổng ĐẠT (không gộp số sau khi thấy dữ liệu). Phần "bảng phản hồi có hàng dùng thật" vẫn 0 hàng.

### Việc còn lại sau 2026-10-17
- (xong) 5.1 phía VSCode.
- Cổng Đợt 5: cần dữ liệu dùng thật (bảng phản hồi) + một lượt Eval mã A/B corpus trong Studio.
- Đợt 6 còn: dọn kho model ~89 GB + ổ C: (XOÁ tệp ⇒ hỏi chủ dự án trước); model lên NVMe.
- Gộp về main: phối hợp phiên engineering; số census gộp (VRAM 221 + 15 eng = 236; REST registrar 60/30; phamViTuyen tong 250, dòng tĩnh index.ts thay đổi khi gộp ⇒ đo lại).
