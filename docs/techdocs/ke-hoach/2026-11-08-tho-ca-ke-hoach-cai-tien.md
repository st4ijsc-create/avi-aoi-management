# Thợ Cả (AI local) — Kế hoạch cải tiến hoàn chỉnh

| | |
|---|---|
| Phiên bản | **v1.1 — 2026‑11‑11** (bổ sung §9: lô NC ngữ cảnh dài · AC chia phiên/agent con · SM sửa‑viết nhanh và chuẩn · HA harness, theo chỉ đạo chủ dự án 11/11; chủ dự án kiểm chứng sau) · v1.0 — ĐÃ DUYỆT 2026‑11‑08 (chủ dự án: "Duyệt kế hoạch; chu-du-an-HST là chủ dự án uỷ quyền, có quyền quyết tất cả để đạt kết quả cao nhất; chủ dự án kiểm chứng lại sau khi hoàn thành") |
| Nguồn | (1) `D:\SOURCES\AI Local\AI Local improvement\Kế hoạch tối ưu Qwen3.6-35B-A3B cho lập trình.pdf` (34 tr, 24/10 — gọi tắt **KH**, dẫn theo chương "KH Ch.x" và bài kiểm "T6.x"); (2) `…\Yêu cầu trải nghiệm người dùng — Forge Desktop và extension VS Code.pdf` (13 tr — gọi tắt **UX**, mã UX‑C/D/V/S/P/A); (3) `…\Forge — AI Local cho lập trình.html` (canvas 9 màn — gọi tắt **Canvas**); (4) hiện trạng đo 08/11 trên main `1b4930fa9` (kiểm kê từ spec Đợt 11/12, git, extension 0.6.0, runtime agent, `scripts/ai-eval`, `.env` chỉ tên khoá). |
| Liên hệ TechDocs | [80-ai.md](../80-ai.md) (một cổng / một runtime / một phiên / một duyệt, F0–F6), [90-platform.md](../90-platform.md) (vỏ, P3), [50-control.md](../50-control.md) (tool thiết bị → `command_request`), [00-INDEX.md](../00-INDEX.md) lộ trình 5 pha; gói pilot `D:\SOURCES\_tho_ca_pilot\ke-hoach.md`. |
| Nguyên tắc | **Máy kiểm chứng, người quyết định** (UX nguyên tắc 3); **đúng hơn nhanh** (tiêu chí chủ dự án 2026‑10); **đo trước – đổi sau** (mọi cờ đổi hành vi model mặc định TẮT, có A/B GPU); không ghi gì vào repo khi chưa duyệt; dữ liệu không phải mệnh lệnh. |

---

## 0. Tóm tắt điều hành

1. **Hiện trạng**: lõi đã có và tốt hơn ba tài liệu giả định — runtime agent Đợt 1–12 (vòng 19 tool, checkpoint trước khi ghi, cổng duyệt lệnh/ghi/kế hoạch, khoá cứng, kill switch, L‑7), extension 0.6.0 (status bar, badge chờ duyệt, Workspace Trust, terminal chỉ đọc, sửa inline + linter), bộ eval 9 ngôn ngữ, ghi/phát lại không GPU, harness 8 công tắc. Pilot "Thợ Cả nhận việc" 3/4 việc **đạt lần 1**, đột biến 9/9 · 8/8 · 9/9. Vấn đề không phải thiếu mà là: **(a)** tri thức dự án cho model gần như rỗng (`AGENTS.md`/repo map/vendor docs chưa có trên main; `luat-du-an.md` 22 dòng chỉ ở worktree pilot); **(b)** kiểm chứng tự động còn trong tay model (bộ chạy không tự chạy lệnh kiểm; TC‑03 ghim lỗi thành kỳ vọng); **(c)** đo lường chưa chuẩn (không pass@k tự động, báo cáo nằm ngoài repo); **(d)** 7/8 công tắc harness chưa có số đo GPU; **(e)** nhiều bản của mỗi thứ (80‑ai §1: 6 transport, 3 thế hệ agent, 6 bảng phiên, 13 thẻ duyệt).
2. **Kế hoạch** chia **7 layer** (L0 runtime/model · L1 tri thức dự án · L2 bộ chạy & an toàn · L3 kiểm chứng tự động · L4 suy luận & quy trình · L5 bề mặt (web/extension) · L6 đo lường) và **7 lô A–G** có số đo, chạy trên vòng lặp *giao việc → đánh giá theo layer → vá layer → phát lại hồi quy* mà chủ dự án đã chỉ đạo 08/11.
3. **Không làm / hoãn có lý do**: LoRA (KH Ch.5) — chỉ sau khi baseline T6.6 với đủ L1–L3 cho thấy khoảng hổng về *quy ước*, và chỉ trên GPU thuê (quyết định riêng của chủ dự án); OpenCode/Continue/Aider (KH Ch.3) — dùng runtime và extension của ta (QĐ 80 §2.1‑2); Forge Desktop như ứng dụng Windows riêng — thay bằng **vùng Thợ Cả 6 màn trong web app** (80 §4) + extension; Ollama — gỡ (80 F1).
4. **Việc chỉ chủ dự án làm**: §7.
5. **v1.1 (11/11)**: sau lô 1 pilot (TC‑05…14), bốn lô mới ở §9 nhắm đúng các hổng đã đo: nén ngữ cảnh hiện chỉ cụt kết quả tool, agent con có mã nhưng chưa từng đo, model tự xin chạy lệnh kiểm 4/5 việc và bị từ chối, bộ chạy không áp ngân sách của thẻ. Thứ tự: đợt 1 không cần GPU (HA‑3, HA‑4, SM‑1, SM‑3, HA‑5, NC‑3, SM‑8, AC‑2) → pilot lô 2 → đợt 2 A/B trên GPU.

---

## 1. Hiện trạng đo được (08/11, main `1b4930fa9`)

### 1.1 Những gì đã có — theo layer

| Layer | Đã có (bằng chứng) | Thiếu / nợ |
|---|---|---|
| **L0 runtime/model** | llama‑server `:8091`, Qwen3.6‑35B‑A3B UD‑Q4_K_XL, ctx 64k + `LLAMA_SERVER_REASONING_BUDGET` 12000, `preserve_thinking` mặc định BẬT (`0eb20abf9`: agent‑f 14→15/18, token ra −55 %, thời gian −56 %); sidecar thị giác `:8081`; VRAM broker PHA 1–9; đo nền Đợt 11.0 (`9de9aa2fd`): VRAM đỉnh 64k 27 157 MiB · 98k 27 825 · 131k 28 497 (có mmproj); 131k sinh 166 tok/s vs 186 ở 64k; `-b 4096 -ub 1024` prefill +32 %, VRAM +132 MiB (chưa đo đúng/sai). | `--alias`, `--api-key-file`, lệnh khởi động hiện/khớp (KH Ch.2, UX‑D05) chưa có; `-b/-ub` chưa đổi; KV q8_0 (T6.2) chưa đo; broker đọc **GPU 0 duy nhất** (`vramProbe.ts:111`), không ghim thiết bị ⇒ chưa sẵn sàng 2 card. |
| **L1 tri thức dự án** | `tepQuyUocAgent.ts:24` đọc `AGENTS.md`/`CLAUDE.md`/`.cursorrules` 8 KB, lọc chỉ thị nhúng; agent đặt tên `.thoca/agents/*.md`; tool `search_docs`, `lookup_api`, `find_symbol`, `search_code` (chỉ mục mã 60 975 chunk, 479 MB, **không chỉ mục vector**); KB 187 tệp + 3 bộ vàng (111 + 12 + 151 câu). | **Không có `AGENTS.md` trên main** (22 dòng `luat-du-an.md` chỉ ở `_tho_ca_wt`, bị exclude); `docs/ai/repo-map.md`, `docs/ai/db/`, `docs/ai/vendor/` chưa có (Đợt 11.2 chưa bắt đầu); `/tokenize` chỉ dùng cho RAG, không cho thước ngữ cảnh. |
| **L2 bộ chạy & an toàn** | Vòng agent `chayVongAgent` (19 tool), trần 30 lượt/20 phút/120k token ra; checkpoint tệp trước khi ghi; duyệt lệnh/ghi qua `proposeAction`→`confirmAction` (một hàm, 9 lối vào); khoá cứng `lenhKhoaCung.ts`; kill switch fail‑closed; cổng kế hoạch 11.3‑C (`AI_AGENT_CONG_KE_HOACH`, TẮT); L‑7 5 chỗ; phạm vi nhà máy `aiAgentPhamVi`; delegate/agent con (cờ TẮT); bộ chạy pilot (`_tho_ca_dev`, `feat/tho-ca-pilot-runner`): thẻ việc, vùng cấm theo đoạn thư mục, duyệt từng lượt ghi, kết cục sticky, khoá bí mật riêng, 67/67 test. | Bộ chạy **không tự chạy lệnh kiểm**; không chống "ghim lỗi thành kỳ vọng"; `ai_pending_actions` gánh cả OT (→ 50 `command_request`, 80 F2); H1.4 không ghi đè tệp chưa đọc, H1.5 timeout tool: **mã xong, cờ TẮT, chưa A/B**; H6 (duyệt có lý do, giam ghi HĐH) chưa bắt đầu. |
| **L3 kiểm chứng tự động** | Lệnh kiểm trong thẻ việc (người đặt); đột biến do dieu‑phoi đặt tay; H4.1 LLM giả (`server/testing/llmGia.ts`), H4.2 ghi/phát lại 6 fixture; linter sau sửa inline (extension, `linterSauSua.ts`). | Không có lớp bắt buộc "chạy lệnh kiểm → đọc kết quả → đối chiếu lời khai"; đột biến chưa tự động; không có kịch bản "phát lại việc cũ và so". |
| **L4 suy luận & quy trình** | Nén ngữ cảnh ngưỡng 0,7 (`nguCanh.ts`), H1.1 nén mốc thấp (68→17 lần nén, token xử lý lại 86 %→26 % — cờ TẮT), H1.3 cứu tràn (BẬT), `todo_write`, cổng kế hoạch (TẮT), `preserve_thinking` BẬT, định tuyến tầng 0–4 theo 11 vai trò. | Ước lượng token 2,8 ký tự/token (đếm thật `NEN_SO_THAT` TẮT); H1.6 bộ dấu kết cục / H1.7 nhắc trước khi dừng vì lặp chưa có; H5.2 bàn giao kiểu Ralph chưa A/B; prompt hệ thống chưa buộc "báo hành vi lạ, không ghi thành kỳ vọng". |
| **L5 bề mặt** | Web: `AICodingWorkspace` (đa tệp, diff, dòng thời gian agent, CURSOR‑PARITY), 9 chat UI, 13 thẻ duyệt (80 §1.3); extension 0.6.0: 14 lệnh, status bar (model · %ctx · tok/s · badge), diff native, `Ctrl+Alt+K` sửa inline + linter, terminal chỉ đọc, Workspace Trust `limited`, ghost‑text FIM, ô chọn model; kho phiên `workspaceState` (chưa dùng phiên server). | So UX: xem §2.2 — 23/31 P0 đã có ít nhất một phần; thiếu rõ: UX‑C06 cảnh báo 80 % + tóm tắt `NOTES.md` (cờ `AI_AGENT_TOM_TAT_80` TẮT), UX‑C09 lịch sử chung web↔VS Code, UX‑D02/D03 kế hoạch + dòng hoạt động có trạng thái (một phần), UX‑S03 phát hiện chỉ thị nhúng ở **dữ liệu** (mới lọc ở tệp luật), UX‑S04 quét bí mật trước khi vào ngữ cảnh, UX‑S05 nhật ký duyệt xuất CSV, UX‑S09 nhãn thư mục điều khiển thiết bị, UX‑A03 trình đọc màn hình; 6 màn Thợ Cả (80 F5) chưa bắt đầu. |
| **L6 đo lường** | `scripts/ai-eval`: codegen‑chay‑duoc (30 + 12 khó + agent‑f 6), ngau‑nhien 72+ bài 9 ngôn ngữ (py/sql/js‑ts/cs/java/cpp/go/rs/**st**), FIM 2×64, st‑hanh‑vi (MATIEC), toolcall 82 ca, RAG P@5/MRR/nDCG, specialist 8, phát lại; kết quả Đợt 11.0: tasks‑hard **H 54/72 (75 %) · M 58/72 (81 %)**, tasks‑api2 **41/90 (46 %)** — yếu nhất OT‑Node/.NET, ts‑lib, T‑SQL. Pilot GĐ1: TC‑02/03/04 đạt lần 1 (105–209 s, 15–17 vòng). | **Không pass@k tự động** (chỉ cột pass@1 ở `multipl-e/run.mjs:136`); báo cáo JSON gitignore ⇒ không có lịch sử trong repo; 7/8 công tắc harness **chưa có số đo GPU**; dạng bài chưa thống nhất với KH Ch.6 (`prompt.md + repo + check.sh`). |

### 1.2 Trạng thái các đợt trước (để không làm lại)

| Đợt / lô | Trạng thái | Bằng chứng |
|---|---|---|
| 11.0 đo nền | XONG | `cc25df1fc`, `9de9aa2fd`, `d55d30115` |
| 11.1 Model Center (alias/api‑key/lệnh khởi động/tok/s thật/UX‑D07) | CHƯA | 0 hit `--alias`, `--api-key-file`, `predicted_per_second` |
| 11.2 ngữ cảnh codebase (repo map, `schema_db`, thước `/tokenize`, vendor) | CHƯA | `docs/ai/*` không có trên main |
| 11.3 A/B/C màn agent & duyệt | XONG (cổng kế hoạch cờ TẮT, mig 0444) | `5ac1ab6c0`, `e45d1fb01`, `f0c8066c0`, `8dd23baf7`, `40c8d3973`; chưa thấy: thẻ package có giấy phép/lockfile, quét bí mật nội dung, nhãn thư mục điều khiển thiết bị |
| 11.4 extension | MỘT PHẦN | status bar `22fa9dab0`, badge `e3c3f4ab3`, Trust `77fd8e12e`, terminal `fd2c7eaca`, inline+linter `e349fa02a`; chưa: thông báo HĐH, Ctrl+I/xung đột phím |
| 11.5 eval pass@k + sandbox DB + T6.3 | CHƯA | — |
| 11.6 dữ liệu fine‑tune | CHƯA (LoRA: không làm) | — |
| 11.7 tên "Thợ Cả" | XONG | `64bb5e553`… |
| 11.8 phiên · agent đặt tên · agent con | XONG (delegate `AI_AGENT_GIAO_VIEC` TẮT; `AI_AGENT_TOM_TAT_80` TẮT) | `f5063d349` (mig 0443), `a9160d769`, `635f8d82e` (mig 0442) |
| Đợt 12 H0 | XONG | `a3e27387b`, `814576074`, `f34e40e1e` |
| H1.1/1.2/1.4/1.5 | Mã XONG, cờ TẮT, chờ A/B | `ab50c519d`, `f118bfc73`, `80d96b411`, `7e0225ade` |
| H1.3 cứu tràn | XONG, **BẬT** | `a2bb15ec5` |
| H1.6/H1.7 | CHƯA | — |
| H2 extension env/giết cây | XONG (ext 0.5.1) | `f38543a1d`, `933d8d3e0` |
| H3.1/3.2/3.3 | XONG (ngoài sau cờ) | `d97f81c99`, `4643b7c4a`, `3d3024fff` |
| H4.1/4.2 LLM giả + phát lại | XONG | `e20c9e1a1`, `c09f944a1` |
| H5.1/5.3/5.4 | Mã XONG, cờ TẮT (mig 0450) | `ad89be214`, `883de3a93`, `4e3a5ad38` |
| H5.2 Ralph A/B, H6, H7 | CHƯA | — |
| 80‑ai F0 | MỘT PHẦN (router chết −55 procedure; `vram_events` xoá một lần, job TẮT) | 80 §8 |
| 80‑ai F1–F6 | CHƯA | — |
| Pilot GĐ1 | TC‑02/03/04 ĐẠT (TC‑01 lỗi thẻ); chưa xác nhận lên main | `_tho_ca_pilot/ket-qua/` |
| Pilot GĐ2 | ĐANG (08/11): L3a bộ chạy tự kiểm → TC‑05 → L3b | thẻ TC‑05 đã duyệt; 11 đột biến |

Ghi chú vận hành: `:3000` lúc restart **unset** 6 biến `AI_AGENT_*`/`AI_GHI_LUOT_DIR`/`AI_REPO_SANDBOX_ROOTS` ⇒ cờ Đợt 12 trên `:3000` chạy theo mặc định; `.env` có `AI_AGENT_NEN_MOC` khai (giá trị chưa đọc) — cần đối chiếu với "chỉ `CUU_TRAN` bật" `[cần kiểm — do-model]`.

---

## 2. Đối chiếu ba tài liệu với hiện trạng

Ký hiệu: **✔** đã có · **◐** một phần · **✘** chưa · **—** không áp dụng (có lý do).

### 2.1 KH — Kế hoạch tối ưu Qwen3.6 (7 chương)

| KH | Nội dung | Trạng thái | Việc còn lại → lô |
|---|---|---|---|
| Ch.1 WSL2/CUDA/build | runtime llama.cpp, `.wslconfig` | ✔ (đang chạy) | nếu build lại: `CMAKE_CUDA_ARCHITECTURES` phải gồm card thứ hai (§6) → **D** |
| Ch.2 tham số server | `--alias`, `-c 131072`, `-np 1`, `-fa`, `-b/-ub`, `--jinja`, sampling 0.6/0.95/20, `preserve_thinking`, MTP `draft-mtp 2`, `-ctk/-ctv`, `--api-key`, `--metrics` | ◐ | 11.1 còn lại; đo T6.1 131k đã có (28,5 GB) nhưng chủ dự án chọn 64k + budget 12000 ("đúng hơn nhanh"); KV q8_0 T6.2 chưa đo → **D** |
| Ch.2.3 hai hồ sơ `coder-think`/`coder-fast` | ghi đè tham số theo request | ◐ (11 vai trò, định tuyến tầng 0–4, `AI_THINKING_TIER_ENABLED`) | ánh xạ hai hồ sơ vào vai trò; `coder-fast` **chỉ** cho autocomplete/i18n/giải thích ngắn → **D** |
| Ch.3.1 chọn agent (OpenCode/Continue/Cline/Aider) | — | **—** | QĐ 80 §2.1‑2: một runtime của ta; extension của ta (UX‑V) |
| Ch.3.2 quy trình một tác vụ | nhánh riêng → `AGENTS.md`+repo map → **kế hoạch được duyệt** → bước nhỏ + test → người xem diff → không push | ◐ (bộ chạy pilot: nhánh `pilot/*`, thẻ, duyệt từng lượt; cổng kế hoạch có nhưng TẮT) | bật cổng kế hoạch cho việc > 1 tệp; bước nhỏ = kiểm sau mỗi bước (L3a) → **A, C** |
| Ch.3.3 quyền agent | đọc/test tự động; ghi qua diff; cài package hỏi; cấm push/reset/xoá ngoài repo/DB thật | ✔ (khoá cứng, allowlist, Trust) | thẻ package (giấy phép/lockfile) chưa → **E** |
| Ch.4.1 bốn lớp ngữ cảnh | `AGENTS.md` ≤ 3k token; repo map ctags; DDL chỉ cấu trúc; vendor docs đúng phiên bản | ✘ | **B** (toàn bộ) |
| Ch.4.2 vòng kiểm chứng theo ngôn ngữ | lệnh build/test/lint ghi trong `AGENTS.md` | ✘ | **B** (TS: `vitest run`, `tsc -p tsconfig.tests.json`, `eslint`, `i18n:check`; SQL: `--test-only` trên `_test`; ST: MATIEC `compile_st`; C#: `dotnet build -warnaserror` cho simulator) |
| Ch.4.3 DB sandbox container | agent chỉ ghi DB tạm; DB thật chỉ đọc qua MCP | ◐ (`_test` clone + MCP chỉ đọc `mcp_chi_doc`) | giữ `_test` thay container; luật "chỉ `_test`, ROLLBACK" đã có → **—** phần container |
| Ch.5 LoRA | bf16 trên GPU thuê, dataset 5 loại, rejection sampling, cổng T6.5 | **hoãn** | chỉ chuẩn bị **dữ liệu từ việc đạt** (lượt ghi) khi T6.6 cho thấy hổng quy ước; quyết định thuê GPU = chủ dự án → **G** |
| Ch.6 eval | `eval/tasks/<stack>/<id>/{prompt.md,repo,check.sh}`, pass@1×3, baseline theo stack, T6.1–T6.6 | ◐ (bộ eval phong phú nhưng khác dạng; T6.1/T6.6 đã đo một lần) | thống nhất dạng + pass@k tự động + lịch sử trong repo → **C** |
| Ch.7 ranh giới an toàn (12) | bind 127.0.0.1 + api‑key; nhánh agent/*; người duyệt diff; DB container; không bí mật vào prompt/dataset; gitleaks; không ghi đè GGUF gốc; mã điều khiển thiết bị phải qua review nhà máy | ✔ 10/12 (L‑7, vùng cấm, khoá cứng, `.env` bị chặn, DB `_test`) | `--api-key` cho `:8091` (Ch.7‑1) và quét bí mật trước khi tệp vào ngữ cảnh (Ch.7‑7) → **D, F** |

### 2.2 UX — Yêu cầu trải nghiệm (P0 trước)

| Mã | Yêu cầu (rút gọn) | Trạng thái | Lô |
|---|---|---|---|
| C01 | trạng thái model alias + Sẵn sàng/Bận/Nạp/Mất ≤ 2 s | ◐ (status bar ext; web `ThanhTrangThaiAi` dự kiến) | E |
| C02 | 3 chế độ Agent/Hỏi đáp/Sửa nhanh + 2 hồ sơ | ◐ (`BoChonCheDoChat`, vai trò) | D, E |
| C03 | streaming + Dừng ≤ 1 s | ✔ | — |
| C05 | danh sách tệp ngữ cảnh + thanh token **từ server** | ◐ (ước 2,8 ký tự/token) | B (thước `/tokenize`), E |
| C06 | cảnh báo 80 % + tóm tắt `NOTES.md` + phiên mới | ◐ (ngưỡng 80 % có; `AI_AGENT_TOM_TAT_80` TẮT) | A (A/B), E |
| C07 | mọi thay đổi qua diff, chấp nhận/từ chối theo khối | ✔ (web `TheDuyetDiff`, ext diff native) | — |
| C08 | khối code: Sao chép/Chèn/Áp dụng → mở diff | ◐ | E |
| C09 | lịch sử phiên chung web↔VS Code | ✘ (ext dùng `workspaceState`) | E (= 80 F6) |
| C11 | bộ trạng thái dùng chung, mỗi lỗi ≥ 1 hành động | ◐ (H3.1 mã lỗi ổn định) | E |
| D02 | agent trình kế hoạch trước; bước đang làm/xong | ◐ (cổng kế hoạch TẮT; `DongThoiGianAgent`) | A, E |
| D03 | dòng hoạt động biểu tượng + động từ + đối tượng + kết quả | ◐ | E |
| D04 | màn duyệt: tệp đã xem, J/K/A/R, kết quả kiểm, "Cần bạn kiểm tra", commit do người | ✔ (11.3‑B) | — |
| D05 | Model & Server: VRAM phân rã, lệnh khởi động khớp 100 %, đo MTP, log | ◐ (`TrungTamModel`, `VramBrokerPanel`) | D |
| D06 | model fine‑tune khoá tới khi qua T6.5 | — (không có fine‑tune) | G |
| D07 | thiết lập lần đầu: Phải sửa/Nên sửa | ✘ | D (script kiểm, không màn riêng) |
| V01–V04, V06–V10 | activity bar + badge, status bar, chat kèm tệp, sửa inline + lint, agent trong VS Code, theme, Remote‑WSL, chạy nền, Trust | ✔ 8/9 (V08 Remote‑WSL **—**: Windows native, `127.0.0.1:8091`) | — |
| V05 | tiền tố "Thợ Cả:" + phát hiện xung đột phím | ◐ (Ctrl+Alt+K) | E |
| S01 | hộp duyệt lệnh nguyên văn; Enter = một lần | ✔ (11.3‑A) | — |
| S02 | khoá cứng hiện biểu tượng, không đổi được | ✔ | — |
| S03 | phát hiện chỉ thị nhúng trong **dữ liệu** (tệp/web/kết quả tool) | ◐ (chỉ lọc tệp luật) | F |
| S04 | danh sách không đọc `.env*`, `**/secrets/**` + quét bí mật trước khi vào ngữ cảnh | ◐ (`.env` chặn; chưa quét nội dung) | F |
| S05 | nhật ký duyệt xuất CSV, không chứa nội dung tệp | ◐ (`ai_pending_actions` có; chưa xuất) | F |
| S06 | internet của công cụ tắt mặc định, bật phải xác nhận + chỉ báo | ✔ (`AI_NGOAI_ENABLED` tắt; tool không ra mạng) | — |
| S07 | DB: chỉ sandbox ghi; nút "Thử lệnh ghi" T6.4 | ◐ (`mcp_chi_doc`, `_test`) | C (T6.4 tự động) |
| S09 | thư mục "điều khiển thiết bị": nhãn review nhà máy, không commit nếu chưa tích | ✘ (vùng cấm chặn hẳn — chặt hơn, nhưng thiếu nhãn khi người sửa qua Thợ Cả) | F |
| P01–P05, A01–A05 | phản hồi ≤ 100 ms, tok/s từ `timings`, extension không làm chậm khởi động, tương phản 4,5:1, bàn phím, NVDA, tiếng Việt | ◐ (A01/A02 theo token 90; A03 chưa) | E (đo bằng kiem‑dinh như mockup) |
| Usability K1–K7 | 5 người thử, SUS ≥ 75 | ✘ | E (vòng thử sau 6 màn; người thử = kỹ sư nội bộ) |
| Câu hỏi mở UX | tên (đã chốt "Thợ Cả"); phím inline; nơi lưu lịch sử (→ `ai_session` server, QĐ 80); công nghệ Desktop (→ web app); LAN nhiều người (→ `:8091` chỉ 127.0.0.1, server app xếp hàng — **giữ**); danh sách thư mục thiết bị (→ chu-du-an-HST duy trì ở 50‑control + vùng cấm) | | |

### 2.3 Canvas 9 màn → 6 màn Thợ Cả (80 §4)

| Canvas | Về đâu | Ghi chú |
|---|---|---|
| App 1 Phiên agent | `/tho-ca` Workspace (`ChatPanel` + dòng thời gian + ngăn ngữ cảnh) | UX‑C01–C05, D01–D03, D08–D09 |
| App 2 Duyệt thay đổi | `/tho-ca/duyet` Hộp duyệt (`ActionCard` biến thể diff) | UX‑C07, D04, S09 |
| App 3 Model & Server | `/tho-ca/model` (Sổ model · Khe/đổi · VRAM · Ngoài · Thiết bị/khoá) | UX‑D05, D06, P03 |
| App 4 Quyền & An toàn | tab trong `/tho-ca/model` + 90 Settings (khoá cứng, DB, phạm vi, mạng, nhật ký duyệt) | UX‑S02, S04–S07 |
| App 5 Thiết lập lần đầu | **không màn riêng**: script `scripts/ai/kiem-he-thong.mjs` (do‑model) + thẻ "Phải sửa/Nên sửa" trong tab Model | UX‑D07 |
| VS Code 1/2/3 | extension (đã có phần lớn) | UX‑V |
| Trạng thái dùng chung | `shared/ai/trangThai.ts` (9 trạng thái + hành động) dùng cho web + extension | UX‑C11, S03, S08 |

---

## 3. Mô hình 7 layer và cách đo

| Layer | Định nghĩa | Chỉ số (đo bởi) | Người sửa |
|---|---|---|---|
| **L0** runtime/model | llama‑server, model, ctx, sampling, VRAM, 1–2 GPU | T6.1 VRAM đỉnh/tok/s/TTFT; tỉ lệ nhận draft MTP; OOM = 0 (do‑model) | do‑model |
| **L1** tri thức dự án | `AGENTS.md`, repo map, DDL, vendor docs, KB, chỉ mục mã | số lỗi **L1** trong `danh-gia.md` (đọc sai API/đường dẫn/quy ước) trước→sau; lần gọi `lookup_api`/`search_docs` trúng | tho‑ca‑agent |
| **L2** bộ chạy & an toàn | vòng agent, tool, duyệt, khoá cứng, L‑7, bộ chạy pilot | lỗi **L2** (tool lỗi, vùng cấm sai, kết cục sai); 0 ghi ngoài thẻ; 0 lệnh thiết bị | tho‑ca‑agent |
| **L3** kiểm chứng tự động | bộ chạy tự chạy lệnh kiểm, đột biến tự động, chống ghim lỗi, đối chiếu lời khai | % việc `bao-sai` = 0; đột biến sống → 0; `ghim-nghi-ngo` được đọc 100 % | tho‑ca‑agent + dieu‑phoi |
| **L4** suy luận & quy trình | kế hoạch trước, bước nhỏ, nén/đếm token, dấu kết cục, prompt hệ thống | **đạt lần 1 %**, số vòng, token/việc, lỗi **L4** (bịa API, test yếu, lặp) | tho‑ca‑agent (+ do‑model A/B) |
| **L5** bề mặt | web 6 màn, extension, trạng thái dùng chung | P0 UX đạt/tổng; K1–K7; SUS | luong‑ui (+ kiem‑dinh đo) |
| **L6** đo lường | eval chuẩn Ch.6, pass@k, phát lại, lịch sử | pass@1×3 theo stack; hồi quy = 0 việc cũ rớt | do‑model + kiem‑dinh |

**Vòng lặp cải thiện** (chỉ đạo 08/11): mỗi việc Thợ Cả làm ⇒ `danh-gia.md` ghi (a) đạt lần 1? vòng/giây/token, (b) lỗi phân theo L1–L4, (c) hành động vá layer ⇒ tho‑ca‑agent vá ⇒ **phát lại việc cũ** (fixture H4.2) phải vẫn ĐẠT ⇒ việc mới khó hơn một bậc.

---

## 4. Lộ trình theo lô

Thứ tự ưu tiên: **A → B → C** (nền cho mọi thứ khác, không cần GPU dài), **D** chạy xen trong cửa sổ GPU của do‑model, **E/F** theo nhịp TechDocs 80 F5/F6 và 90‑P3, **G** chỉ khi C có baseline.

### Lô A — Pilot giai đoạn 2: kiểm chứng tự động (L3) + việc thật (ĐANG CHẠY)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| A1 L3a | bộ chạy **tự chạy LỆNH KIỂM** sau khi driver xong; parse "Test Files"/"Tests"; kết cục mới `xong | kiem-do | test-rong | bao-sai | dot-bien-song | vi-pham` (sticky) | test bộ chạy + đột biến bộ chạy; TC‑05 chạy trên L3a | tho‑ca‑agent |
| A2 L3b | đột biến khai trong thẻ (`DOT BIEN: tệp|tìm|thay`) áp trên bản sao, revert sạch, model không biết; `KHÔNG ĐƯỢC KHẲNG ĐỊNH`; cảnh báo `ghim-nghi-ngo` | đột biến tay của dieu‑phoi → tự động; TC‑03 phát lại ra `ghim-nghi-ngo` | tho‑ca‑agent |
| A3 L4 | prompt buộc chạy lệnh kiểm + dán "Tests N passed (M files)"; luật "hành vi lạ: BÁO, không ghi thành kỳ vọng"; **bật cổng kế hoạch** cho việc > 1 tệp (thẻ: "in danh sách hành vi ≤ 12 dòng, chờ duyệt") | `bao-sai` = 0 trên lô 1 | tho‑ca‑agent + dieu‑phoi |
| A4 lô 1 việc | TC‑05/06/07 test; **TC‑11** sửa `withParams`; **TC‑12** simulator unitID (test đơn vị, không chạy simulator thật); TC‑13 test ROLLBACK (lượt `_test`); TC‑14 script so manifest bundle | ≥ 5/7 đạt lần 1; đột biến ≥ 90 % bị bắt; 0 ghi ngoài thẻ | dieu‑phoi (thẻ, cổng) · chu‑du‑an‑HST (rà thẻ, đọc diff) |
| A5 ghi lượt | `AI_GHI_LUOT_DIR=D:/DO-AI/ghi-luot/pilot2` từ TC‑05; đóng gói fixture phát lại | mỗi việc đạt có fixture | do‑model |
| A6 báo cáo | bảng số lô 1 + phân lỗi layer + đề xuất lô 2 (việc pha 1: migration add‑only nhỏ, test DB với `_test`, i18n) | chủ dự án quyết mở rộng | chu‑du‑an‑HST |

### Lô B — Tri thức dự án (L1, KH Ch.4) — sau A1

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| B1 `AGENTS.md` | nâng `luat-du-an.md` thành `AGENTS.md` ở gốc repo (≤ 3 000 token): stack + phiên bản đọc từ `package.json`; **lệnh kiểm bắt buộc theo ngôn ngữ** (TS: `npx vitest run <tệp>`, `tsc -p tsconfig.tests.json` với `NODE_OPTIONS=--max-old-space-size=12288`, `eslint`, `npm run i18n:check`; SQL: chỉ `_test`, `--test-only`, ROLLBACK; ST: `compile_st`; C# simulator: `dotnet build -warnaserror`); quy ước đặt tên (Việt không dấu, `*.unit.test.ts`/`*.test.ts`, không "Pha N" trong test, LF, i18n đủ vi/en/zh); cấm (push, `.env*`, DB thật, ghim lỗi); trỏ tới repo map/DDL/vendor | `tepQuyUocAgent` nạp được (≤ 8 KB); lỗi L1 trong lô 1→lô 2 giảm ≥ 50 % | tho‑ca‑agent (soạn) · chu‑du‑an‑HST (duyệt nội dung) |
| B2 repo map | `scripts/ai/repo-map.mjs` (ctags hoặc ts‑morph) → `docs/ai/repo-map.md` chỉ symbol công khai theo module 10–90; hook `post-merge` hoặc job | `find_symbol`/`search_code` có nguồn; map < 150 kB | tho‑ca‑agent |
| B3 DDL | **không xuất từ DB**: `docs/ai/db/README.md` dẫn `drizzle/schema/*` theo module + 5 bất biến (WORM, RLS `site_id`, `avi_app`); tool `schema_db(bảng)` đọc từ drizzle | 0 lần model đoán tên cột trong lô 2 | tho‑ca‑agent |
| B4 vendor docs | `docs/ai/vendor/{react19,trpc11,drizzle,tailwind4,vite7,vitest}.md` trích từ `node_modules/*/README|CHANGELOG` đúng phiên bản lockfile; **không tải internet** | `lookup_api` trúng ≥ 80 % trên 20 câu | tho‑ca‑agent |
| B5 thước token | `/tokenize` cho thước ngữ cảnh (UX‑C05) + bật `NEN_SO_THAT` sau A/B | sai số ước lượng < 5 % | tho‑ca‑agent + do‑model |
| B6 KB mã | HNSW `ai_code_chunk` + pre‑filter project (80 F3 N5: p95 < 300 ms) | bench trước/sau | tho‑ca‑agent (migration qua dieu‑phoi) |

### Lô C — Đo lường chuẩn (L6, KH Ch.6) — song song B

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| C1 dạng bài | `scripts/ai-eval/tasks/<stack>/<id>/{prompt.md, repo/ hoặc commit‑ref, check.mjs}` — `check` trả 0; chuyển TC‑xx đạt + 12 bài khó + agent‑f sang dạng này (giữ bộ cũ chạy được) | 100 % TC + hard ở dạng mới | do‑model |
| C2 pass@k | `run-eval.mjs --samples 3` → pass@1 trung bình theo stack; báo cáo JSON **vào repo** `docs/ai/eval/<ngày>.json` + bảng md | chạy được trong cửa sổ GPU đêm ≤ 3 h | do‑model |
| C3 baseline T6.6 | theo stack: ts‑client, ts‑server, sql‑drizzle, st, cs‑simulator, i18n; ghi số 0 (hiện: hard 75–81 %, api2 46 %) | bảng baseline có hash model + cờ | do‑model |
| C4 T6.3/T6.4 tự động | tool‑call hợp lệ ≥ 95 %, không lặp > 3; `mcp_chi_doc` thử INSERT/UPDATE/DROP bị DB từ chối (bài kiểm thật trên `_test`) | xanh trong census AI | kiem‑dinh |
| C5 hồi quy | mỗi vá layer ⇒ phát lại fixture (H4.2) **không GPU** + chạy lại 1 mẫu/bài trên GPU khi đổi model/cờ | 0 bài cũ rớt | do‑model |
| C6 A/B 7 công tắc | agent‑f + G6 + bộ khó cho từng cờ TẮT (NEN_MOC, NEN_SO_THAT, DOC_TRUOC_KHI_GHI, TOOL_TIMEOUT, CON_BAO_CAO, DAU_RA_DAI, TIEP_TUC, TOM_TAT_80, CONG_KE_HOACH) → đổi mặc định chỉ khi không tụt | runbook Đợt 12 cập nhật | do‑model |

### Lô D — Runtime/model (L0, KH Ch.1–2) — trong cửa sổ GPU

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| D1 11.1 | `--alias thoca-coder`, `--api-key-file`, `--metrics`; lệnh khởi động sinh từ cấu hình và **hiện khớp 100 %** (UX‑D05); tok/s từ `timings` (UX‑P03) | `GET /v1/models` ra alias; extension/web dùng khoá | do‑model + luong‑ui |
| D2 T6.2 | KV q8_0 vs f16; `presence_penalty` 0 vs 0,5 | giữ q8_0 chỉ khi pass@1 giảm ≤ 2 điểm | do‑model |
| D3 hồ sơ | `coder-think` (mặc định) / `coder-fast` (autocomplete, giải thích ngắn, i18n) ánh xạ vào vai trò; **không** giảm budget cho agent ("đúng hơn nhanh") | định tuyến đúng ≥ 95 % (`dinh-tuyen-vai-tro`) | do‑model |
| D4 `-b/-ub` | 4096/1024 đo đúng/sai (T6.1b đã +32 % prefill) | pass@1 không tụt | do‑model |
| D5 kiểm hệ thống | `scripts/ai/kiem-he-thong.mjs`: GPU, driver, VRAM trống, cổng, model file sha, ctx vs VRAM dự kiến (> 30,5 GB ⇒ đỏ) — "Phải sửa/Nên sửa" (UX‑D07) | chạy lúc boot + nút trong tab Model | do‑model |
| D6 (tuỳ chọn) card thứ hai | nếu chủ dự án cắm RTX 3070 8 GB: broker đo **theo từng GPU** (`nvidia-smi --id`), biến chọn card cho llama‑server/sidecar/nhúng (`CUDA_VISIBLE_DEVICES`), model nhỏ `coder-fast` (Qwen3 4B/8B Q4) trên 3070 ⇒ hết xếp hàng một slot; sidecar VL **đo vừa 8 GB?**; build llama.cpp arch `86;120`; PSU ≥ 1000 W | hai slot song song; agent 35B trên 5090 không đổi tốc độ | do‑model (đo trước khi mua) |

### Lô E — Bề mặt (L5, UX) — theo 80 F5/F6 + 90‑P3

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| E1 trạng thái dùng chung | `shared/ai/trangThai.ts`: 9 trạng thái (mất kết nối, đang nạp, OOM, ngữ cảnh đầy, vòng lặp, output hỏng, chỉ thị nhúng, hoàn tất, phiên trống) + ≥ 1 hành động mỗi lỗi, dùng cho web + extension (UX‑C11) | test hợp đồng; 0 thông báo lỗi chỉ có "Đóng" | luong‑ui |
| E2 Workspace `/tho-ca` | một `ChatPanel`, kế hoạch trước (UX‑D02), dòng hoạt động (UX‑D03), thước token từ server (UX‑C05), cảnh báo 80 % + tóm tắt + phiên mới (UX‑C06) | 80 N7; P0 UX‑C/D đạt (kiem‑dinh đo) | luong‑ui |
| E3 Hộp duyệt | một `ActionCard` (+ biến thể diff/kế hoạch/lệnh/package có giấy phép‑lockfile); "Cần bạn kiểm tra"; nhãn thư mục điều khiển thiết bị (UX‑S09) | 13 thẻ → 1 | luong‑ui |
| E4 Model & An toàn | tab Model (VRAM phân rã, lệnh khởi động khớp, đo MTP, log, kiểm hệ thống), tab An toàn (khoá cứng có biểu tượng, DB, phạm vi, mạng, nhật ký duyệt xuất CSV) | UX‑D05/S02/S05 | luong‑ui + do‑model |
| E5 extension 0.7 | phiên server `ai_session` thay `workspaceState` (UX‑C09, 80 F6); tiền tố "Thợ Cả:" + phát hiện xung đột phím (UX‑V05); thông báo HĐH khi cần duyệt (UX‑D08); `aria-live`/`alertdialog` (UX‑A03) | phiên tạo ở ext thấy ở web ≤ 5 s (N11) | luong‑ui |
| E6 usability | K1–K7 với 5 kỹ sư nội bộ chưa dùng Thợ Cả, think‑aloud, SUS | ≥ 4/5 mỗi kịch bản; SUS ≥ 75 | kiem‑dinh tổ chức; chủ dự án chọn người |

Ràng buộc: **không viết mã vỏ trước 90‑P3**; E2–E4 dùng `token.css`/`shell.css` đã duyệt; mockup 5 màn Thợ Cả (như 5 màn hệ sinh thái) **trước** khi viết, kiem‑dinh đo tương phản/vùng chạm/reduced‑motion.

### Lô F — An toàn dữ liệu & chỉ thị nhúng (UX‑S, KH Ch.7)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| F1 chỉ thị nhúng | bộ dò trên **mọi** dữ liệu vào ngữ cảnh (tệp, kết quả tool, trang web nếu có): mẫu mệnh lệnh cho AI, token điều khiển; gắn thẻ "nghi vấn + nguồn", agent không làm theo, ghi `ai_agent_run_event` (UX‑S03) | bài kiểm K7: 5/5 nhận ra; 0 lệnh từ dữ liệu được thực thi | tho‑ca‑agent |
| F2 quét bí mật | danh sách không đọc (`.env*`, `**/secrets/**`, chứng chỉ, `cookies.txt`) + quét nội dung (mẫu khoá/connection string) **trước** khi tệp vào ngữ cảnh/lượt ghi/fixture; lý do hiện khi `@`‑mention (UX‑S04) | fixture phát lại 0 bí mật (census) | tho‑ca‑agent + kiem‑dinh |
| F3 nhật ký duyệt | xuất CSV từ `ai_pending_actions`/`ai_action` (thời điểm, phiên, hành động nguyên văn, kết quả; không nội dung tệp) (UX‑S05) | admin tải được; 0 cột nội dung | luong‑ui |
| F4 nhãn thiết bị | danh sách thư mục "điều khiển thiết bị" (`services/ot/**`, `services/scada/**`, `services/edge/**`, `commandDispatcher`, interlock…) duy trì ở 50‑control; mọi diff chạm vào hiện nhãn "review theo quy trình nhà máy", không commit nếu chưa tích (UX‑S09) — vùng cấm pilot vẫn chặn hẳn | test: diff chạm `ot/` ⇒ nhãn + chặn commit | tho‑ca‑agent + chu‑du‑an‑HST (danh sách) |
| F5 `--api-key` `:8091` | khoá tệp, client đọc từ `.env` (tên khoá `LLAMA_SERVER_API_KEY_FILE`) | tiến trình lạ gọi `:8091` bị 401 | do‑model |

### Lô G — Tự cải thiện có kiểm soát (KH Ch.5, chỉ sau C3)

| Việc | Nội dung | Điều kiện | Ai |
|---|---|---|---|
| G1 dữ liệu từ việc đạt | mỗi việc ĐẠT + fixture ⇒ mẫu (yêu cầu, ngữ cảnh, diff, lời giải có suy luận) vào `D:\DO-AI\mau\` ngoài repo; quét bí mật F2; không dùng cho gì khác | A/B lô 1–2 xong | do‑model |
| G2 phân tích hổng | so pass@1 theo stack (C3) trước/sau L1–L3; nếu lỗi còn lại là **quy ước/phong cách** (không phải suy luận) ⇒ ghi nhận hổng | 2 chu kỳ đo | chu‑du‑an‑HST |
| G3 quyết định LoRA | **chỉ chủ dự án**: thuê GPU 80 GB, bf16 LoRA (KH Ch.5.3), xuất GGUF alias riêng, cổng T6.5 (nội bộ +5 điểm, hồi quy ≤ 2) — mặc định **KHÔNG** (G9 2026‑09‑21: lỗi còn lại là suy luận) | G2 cho thấy hổng quy ước | chủ dự án |

---

## 5. Chỉ số & cổng nghiệm thu toàn kế hoạch

| # | Chỉ số | Hiện (08/11) | Mục tiêu sau lô A–C | Sau D–F |
|---|---|---|---|---|
| M1 | Việc pilot **đạt lần 1** | 3/4 (việc test nhỏ) | ≥ 70 % trên lô việc thật (sửa mã, test DB, script) | ≥ 80 % |
| M2 | Đột biến bị bắt | 9/9 · 8/8 · 9/9 (tay) | ≥ 90 % tự động | ≥ 95 % |
| M3 | `bao-sai` (lời khai ≠ kết quả) | không đo được | 0 | 0 |
| M4 | pass@1×3 tasks‑hard (12) | M 73,6 % (baseline 08/11, 6 mẫu); **H 61,1 % (22/36, baseline 09/11 `:3013`+`_test`, 0750a413c; 0 điểm H‑cs2/H‑py3/H‑ts3)**; H 75 % (11.0) là điều kiện khác (DEV, nhúng GPU, Node cũ) ⇒ **không phải tụt 14 điểm**, chỉ tham khảo; mốc M4 là 61,1 % | H ≥ 85 % với L1 đầy đủ; M không tụt | giữ |
| M5 | pass@1×3 tasks‑api2 (30) — **trục H** (qua đường sản phẩm: **một lượt gọi model sinh mã** `/api/ai/local-kb/stream` codingMode → `streamCodingGenerate` (`aiLocalKnowledgeCodingSinhMa.ts:61`, audit `kb_sinh_ma`), ngữ cảnh = **mã repo** qua `codingRepoContext.ts` (cờ `AI_CODING_REPO_CONTEXT`), **bỏ qua `retrieveKnowledge`** và vòng tool; `:3013` + `_test`; KHÔNG phải agent có tool — đính chính 10/11, do‑model xác nhận bằng `ai_llm_audit` 127 hàng `kb_sinh_ma`/0 loại khác. ⚠ **Điều kiện cho M5**: B4 vendor docs phải tới được đường `streamCodingGenerate` (hiện không qua RAG tài liệu) — B4 kiểm trước khi hứa số) | M 40 % (baseline 08/11); **H 44,4 % (40/90, baseline 09/11, 0750a413c)** | ≥ 60 % trục H (ưu tiên nhóm yếu ot‑node/.NET, ts‑lib, T‑SQL bằng vendor docs B4 — B4 chỉ tới model qua trục H, không đổi số M); trục M giữ không tụt | ≥ 70 % H |
| M6 | Lỗi L1 trên mỗi việc | chưa phân loại | −50 % so lô 1 | −75 % |
| M7 | Công tắc harness có số đo GPU | 1/8 | 8/8 (C6) | mặc định đổi theo số |
| M8 | P0 UX đạt | ≈ 23/31 một phần | — | 31/31 (kiem‑dinh đo) |
| M9 | Phiên chung web↔ext | ✘ | — | ≤ 5 s (N11) |
| M10 | Bí mật trong fixture/lượt ghi | chưa quét | 0 (census) | 0 |
| M11 | SUS | — | — | ≥ 75 |
| M12 | VRAM đỉnh / OOM | 27,2 GB @64k / 0 | giữ | ≤ 30,5 GB / 0 (kể cả 2 card) |

Cổng chung mỗi lô: lưới bàn giao đầy đủ của tho‑ca‑agent (agentCore + `services/ai` + routes + client ai + extension + census toàn cây + `check:tests`), kiem‑dinh ĐẠT TRỌN, cổng gộp của dieu‑phoi, cờ đổi hành vi model mặc định TẮT cho tới khi có A/B.

---

## 6. Rủi ro

| Rủi ro | Giảm |
|---|---|
| `:8091` một slot ⇒ pilot làm Thợ Cả trong VS Code của chủ dự án xếp hàng | lịch do‑model, báo giờ trước; D6 card thứ hai là lối thoát nếu có sẵn phần cứng |
| Bộ chạy tự chạy lệnh kiểm chạm DB/`_test` ngoài lượt | thẻ ghi rõ lệnh thuần; test DB cần lượt `_test` do dieu‑phoi cấp (luật 06/11) |
| Đột biến khai trong thẻ lọt vào ngữ cảnh model | áp trên bản sao sau khi model xong; không nằm trong worktree lúc model chạy; kiểm `git diff` sau revert = 0 |
| `AGENTS.md` phình, model bỏ qua | ≤ 3 000 token, đo bằng `/tokenize`; phần dài để repo map/vendor và để tool kéo |
| Vendor docs trích sai phiên bản | sinh từ `node_modules` theo lockfile bằng script, ghi phiên bản trong tiêu đề |
| A/B trên GPU chiếm cửa sổ đêm | mỗi cờ ≤ 1 cửa sổ; ưu tiên NEN_MOC, TOM_TAT_80, CONG_KE_HOACH |
| Mã UI viết trước vỏ 90‑P3 | mockup trước, kiem‑dinh đo, gộp sau P3 |
| Chạm dữ liệu/bí mật khi ghi lượt | F2 quét trước khi ghi; lượt ghi ngoài repo (`D:\DO-AI`) |

---

## 7. Việc chỉ chủ dự án làm

1. **Duyệt kế hoạch này** (hoặc sửa thứ tự lô; mặc định A→B→C, D xen, E/F theo TechDocs, G chờ).
2. Cửa sổ GPU cho C2/C3/C6 (đêm) — do‑model xin từng lần.
3. Quyết định **card thứ hai** (D6): đo trước khi mua; nếu đã có thì cho phép cắm thử.
4. Chọn 5 kỹ sư nội bộ cho usability E6 (khi 6 màn có).
5. Bật/tắt cờ sau khi có A/B: `AI_AGENT_CONG_KE_HOACH`, `AI_AGENT_TOM_TAT_80`, `AI_AGENT_NEN_MOC`, `AI_AGENT_GIAO_VIEC`, `TIEP_TUC` (vận hành).
6. **LoRA (G3)**: quyết định riêng, chỉ khi G2 cho thấy hổng quy ước; mặc định không.
7. Danh sách thư mục "điều khiển thiết bị" (F4): xác nhận bản do chu‑du‑an‑HST soạn từ 50‑control.

---

## 9. Bổ sung v1.1 (2026‑11‑11) — bốn hướng chủ dự án chỉ đạo

Chỉ đạo 11/11: Thợ Cả phải (1) **gom và tổng hợp ngữ cảnh để làm việc dài hơn**, (2) **chia phiên và dùng agent con**, (3) **sửa và viết mã nhanh, chuẩn hơn**, (4) **harness mạnh hơn, thông minh hơn, logic tốt hơn**. Phần này thêm bốn lô **NC · AC · SM · HA** vào (đặt tên hai chữ để không trùng mã H0–H7 của Đợt 12 và mã H của SCADA) lộ trình §4; không thay lô A–G. Mọi cờ đổi hành vi model vẫn mặc định TẮT và chỉ đổi mặc định sau A/B.

### 9.1 Hiện trạng đo được cho bốn hướng (main `833a9f2ce`)

| Hướng | Đã có (đọc mã 11/11) | Hổng |
|---|---|---|
| Ngữ cảnh dài | `shared/agentCore/nguCanh.ts` (168 dòng): `nenLichSu` ở 70 % ngân sách **thay nội dung kết quả tool cũ bằng dòng cụt**, `nenManh` khi tràn; ước lượng 2,8 ký tự/token; `AI_AGENT_NEN_MOC`, `NEN_SO_THAT`, `DAU_RA_DAI` (kho + `read_output`), `TOM_TAT_80` (chỉ **nhắc** model tự ghi NOTES.md), `TIEP_TUC` (mig 0450) — tất cả TẮT trừ `CUU_TRAN`; ctx 64k; `read_file` trần 11 000 ký tự; chỉ mục mã 60 975 chunk không vector | Không có **tóm tắt bằng model** có cấu trúc; không có **sổ tay lượt** sống sót qua nén; đọc lại tệp không đổi vẫn tốn token; chưa đo tỉ lệ cache tiền tố trên GPU; việc > 30 lượt model chưa từng hoàn tất (TC‑14 `het-luot`) |
| Phiên & agent con | `delegate` trong lõi (`giaoViec.ts`: ≤ 4 con/lượt chạy, ≤ 2 lần giao/lượt model, con ≤ 12 lượt, sâu ≤ 2, tóm tắt ≤ 1 500 ký tự, con không bao giờ `tu-dong`), tool `report` cho con, agent đặt tên `.thoca/agents/*.md` tin‑lần‑đầu, phiên hợp nhất `aiPhien` | `AI_AGENT_GIAO_VIEC` + `CON_BAO_CAO` **TẮT, chưa có số đo nào**; con chạy **tuần tự** (`await chayVongAgent`, `:8091` một slot); chưa có vai con chuẩn; chưa chia việc dài thành phiên theo bước kế hoạch |
| Sửa/viết nhanh & chuẩn | `edit_file` (nhiều `old_string/new_string`, `replace_all`), `write_file`, `rename/delete_file`, mọi ghi qua thẻ `apply_diff`; `DOC_TRUOC_KHI_GHI` (TẮT); T1 `AI_CHAT_TU_KIEM_MA` cho chat (TẮT, chờ nghiệm thu); L3a/L3c ở bộ chạy pilot | Lô 1: model **tự gọi lệnh kiểm 4/5 việc và bị từ chối**; mỗi lượt ghi chờ người 33–121 s; 0–4 thẻ bị từ chối mỗi việc; lỗi kiểu chỉ lộ ở cuối (L3c) chứ không ngay sau khi ghi; lỗi L1 lặp (`@ts-expect-error` trên import .mjs ×2, `typeof import()`); trục H api2 44,4 %, ot‑node 2/15 |
| Harness | trần 30 lượt/20 phút/120k token; dừng `lap-lai`; cổng kế hoạch 11.3‑C (TẮT); `KIEM_DAC_TA` (BẬT); `todo_write`; sự kiện `buoc-do` | H1.6/H1.7 chưa có; "8 vòng" trong thẻ không được áp; tsc không chạy khi lượt không xong; đuôi đầu ra lệnh kiểm 3 000 ký tự; lỗi công cụ không dẫn đường (`NOT_A_DIRECTORY`, `DENIED_DIR`, `CHI_MUC_CHUA_CO`, `GREP_DEADLINE`); mẫu L4 đo được: tự in "ĐÃ DUYỆT" 3/5, mô tả đột biến trong danh sách 2/5, né ca đỏ bằng đổi đầu vào, sửa mã theo test sai |

### 9.2 Lô NC — Ngữ cảnh dài hơn bằng gom và tổng hợp (L4 + L1)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| NC‑1 sổ tay lượt | Khối có cấu trúc do host giữ ở đầu ngữ cảnh, **không bị nén**: mục tiêu · quyết định đã chốt · tệp đã chạm (đường + một dòng) · điều đã thử và thất bại · việc còn lại. Model cập nhật qua tool `note_write` (≤ 1 500 token, host cắt). Cờ `AI_AGENT_SO_TAY` | sau 3 lần nén, model trả lời đúng 5/5 câu hỏi về việc đã làm (bài kiểm phát lại, không GPU cho phần host) | tho‑ca‑agent |
| NC‑2 tóm tắt có cấu trúc | Ở mốc nén: một lượt model riêng, prompt cố định, đầu ra có khoá (đã làm · bằng chứng đường:dòng · đang dở · lỗi đang gặp nguyên văn). Thay cho việc cụt kết quả tool. Giữ nguyên văn 2 lượt cuối + sổ tay + todo. Kết quả tool gốc chuyển vào kho `DAU_RA_DAI`, mang mã để `read_output` kéo lại. Cờ `AI_AGENT_TOM_TAT_NEN` | A/B với `NEN_MOC` và hiện trạng trên bộ việc dài (NC‑8): đạt không tụt, token xử lý lại ≤ 30 % | tho‑ca‑agent + do‑model |
| NC‑3 đọc tiết kiệm | `read_file` theo khoảng dòng + chế độ `outline` (ký hiệu và số dòng) cho tệp > 400 dòng; đọc lại tệp không đổi trả "không đổi từ lần đọc trước" kèm khoảng dòng đã có; `grep` có ngữ cảnh ±n; đầu ra lệnh giữ đầu + đuôi + mọi dòng lỗi | token vào/việc −25 % trên phát lại lô 1; 0 việc rớt | tho‑ca‑agent |
| NC‑4 gói ngữ cảnh mở đầu | Host dựng tất định theo thẻ việc: tệp đích, nơi gọi (từ `find_symbol`), test láng giềng, mục `AGENTS.md` liên quan; ≤ 6 000 token; thay cho 3–6 lượt model đi tìm. Dựa trên repo map (B2) và HNSW (B6) khi có | số lượt model trước lần ghi đầu −30 % | tho‑ca‑agent |
| NC‑5 đếm token thật | = B5 (`/tokenize`, `NEN_SO_THAT`), kéo lên trước NC‑2 vì mọi ngưỡng dựa vào nó | sai số < 5 % | tho‑ca‑agent + do‑model |
| NC‑6 tiền tố ổn định (**ĐÃ ĐO 11/11: đạt ở việc ngắn; nén là nguồn phá cache ⇒ NC‑2 nén ít lần và sâu; khối chèn đặt cuối lịch sử**) | Thứ tự cố định system → luật → tool → sổ tay; nén chỉ ở mốc để không phá cache; đo `cacheN/promptN` từ `buoc-do` trên GPU | tỉ lệ cache ≥ 80 % giữa hai lượt liền nhau | do‑model |
| NC‑7 ctx 98k cho vai agent | VRAM đã đo 27 825 MiB. Đo đúng/sai và tok/s so 64k, giữ budget suy nghĩ 12 000; chat và autocomplete giữ 64k | chỉ đổi nếu bộ việc dài tăng và bộ khó không tụt | do‑model |
| NC‑8 bộ việc dài | 4 bài đã duyệt 11/11 (`sandbox-projects/agent-f`): ts‑tach‑module, py‑doi‑chu‑ky, js‑loi‑3‑lop, py‑doi‑soat — định nghĩa theo ≥ 5 tệp hoặc độ sâu (bỏ điều kiện 40 lượt vì trần hiện 30); đo hai nhánh: trần 30 và trần nâng (chờ núm HA‑3) | có baseline trước khi bật bất kỳ cờ NC nào | do‑model + chu‑du‑an‑HST (đề) |
| NC‑9 bàn giao giữa phiên | Ở ≥ 85 % hoặc hết lượt: viết tệp bàn giao có cấu trúc rồi mở phiên mới bằng `TIEP_TUC`; A/B với tóm tắt tại chỗ (H5.2 cũ) | việc dài hoàn tất qua ≥ 1 lần bàn giao | tho‑ca‑agent + do‑model |

### 9.3 Lô AC — Chia phiên và agent con (L2 + L4)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| AC‑1 đo delegate | Bật `AI_AGENT_GIAO_VIEC` + `CON_BAO_CAO` trên `:3013`, A/B trên bộ việc dài (NC‑8) và agent‑f | ngữ cảnh cha −40 % ở bài khảo sát; đạt không tụt; 0 ghi ngoài phạm vi cha | do‑model |
| AC‑2 ba vai con chuẩn | `.thoca/agents/tham-tu.md` (chỉ đọc: tìm nơi gọi, đọc tài liệu, trả báo cáo có đường:dòng) · `kiem-chung.md` (chạy lệnh kiểm, đọc lỗi, không sửa) · `ra-soat.md` (đọc diff so thẻ, tìm lỗi, không sửa). Trong repo, tin‑lần‑đầu như hiện nay | mỗi vai có 3 bài kiểm phát lại; báo cáo ≤ 1 500 ký tự có bằng chứng | tho‑ca‑agent |
| AC‑3 phiên theo bước kế hoạch | Việc > 3 tệp: kế hoạch được duyệt (11.3‑C) ⇒ mỗi bước một phiên con với ngân sách riêng, đầu ra = diff + báo cáo; cha chỉ giữ sổ tay và kế hoạch | việc 6 tệp hoàn tất mà ngữ cảnh cha < 50 % | tho‑ca‑agent |
| AC‑4 song song | Hiện tuần tự vì một slot. Đo hai phương án: `LLAMA_SERVER_SLOTS=2` (mỗi slot nửa ngữ cảnh, chỉ cho con chỉ đọc) và D6 card thứ hai chạy model nhỏ cho `tham-tu` | quyết theo số: thời gian tường −30 % mà đạt không tụt | do‑model |
| AC‑5 rà soát trước thẻ | Con `ra-soat` chạy trước khi thẻ ghi tới người duyệt; phát hiện đính kèm thẻ | số thẻ bị người từ chối/việc ≤ 1 (lô 1: 0–4) | tho‑ca‑agent |
| AC‑6 bề mặt | Cây phiên cha–con trong dòng thời gian; mở báo cáo con | sau 90‑P3 | luong‑ui |

Bất biến giữ nguyên: con ⊆ quyền cha, con không bao giờ `tu-dong`, báo cáo con là dữ liệu không tin cậy, thẻ của con duyệt tại `confirmAction`.

### 9.4 Lô SM — Sửa và viết mã nhanh, chuẩn hơn (L2 + L3)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| SM‑1 `run_check` | Tool chạy **đúng lệnh kiểm của thẻ hoặc của `AGENTS.md` §2** (so khớp nguyên văn, danh sách trắng theo thẻ), không cần người duyệt, đầu ra cắt thông minh (NC‑3). Lệnh khác vẫn qua duyệt | lô 2: 0 lần `TU_CHOI_BO_CHAY` cho lệnh kiểm; số lượt model/việc −20 % | tho‑ca‑agent |
| SM‑2 kiểm ngay sau ghi | Sau mỗi `edit_file`/`write_file` được chấp nhận, host chạy kiểm cú pháp/kiểu nhanh cho đúng tệp đó (dùng lại `bienDichMa` của T1: tsc, `node --check`, `py_compile`, `dotnet build`) và trả lỗi vào kết quả tool. Cờ `AI_AGENT_KIEM_SAU_GHI`. **Giới hạn đo đêm 13/11 (do‑model, 5daecb392):** `python -I -m py_compile` chỉ kiểm cú pháp — H‑py3 tự kiểm báo sạch 9/9 mà test đỏ 6/9; với Python (và JS thuần), SM‑2 không được coi là tín hiệu đúng/sai, tín hiệu thật là SM‑1 chạy test. T1 chưa nghiệm thu (25/36 so 23/36, không tách được) | lỗi kiểu ở L3c cuối lượt → 0 trên lô 2 | tho‑ca‑agent |
| SM‑3 `edit_file` bền | Khớp chịu CRLF và khoảng trắng cuối dòng; không khớp ⇒ trả 3 dòng gần nhất và số dòng; nhiều khớp ⇒ trả vị trí từng khớp | tỉ lệ `edit_file` lỗi/lần gọi −50 % (đo từ `buoc-do`) | tho‑ca‑agent |
| SM‑4 gộp thẻ ghi | Các ghi cùng một bước kế hoạch gộp thành một thẻ, duyệt theo khối trong thẻ | giây chờ duyệt/việc −40 % | tho‑ca‑agent + luong‑ui |
| SM‑5 T1 rồi T2 chat | Nghiệm thu T1 đêm 11/11 (4 bài, 9 mẫu/nhánh); đạt thì bật `theo-luot` cho extension; T2 (tự viết ca thử, chạy có giới hạn) sau | H‑cs2 trục H tăng; bài đối chứng không tụt | do‑model + tho‑ca‑agent |
| SM‑6 tri thức thư viện | B4 thẻ vendor theo tên gói (đã duyệt) **trước** B2/B3; thêm thẻ cho import ESM `.mjs` từ test `.ts` | ot‑node trục H 2/15 → ≥ 8/15; M5 ≥ 60 % | tho‑ca‑agent + do‑model |
| SM‑7 tốc độ | D3 hồ sơ `coder-fast` cho việc ngắn; D4 `-b/-ub`; NC‑6 cache; đo TTFT, tok/s, giây tường/việc | giây tường/việc cùng loại −30 %, đạt không tụt | do‑model |
| SM‑8 sổ tay cách làm | `AGENTS.md` thêm mục thứ tự chẩn đoán khi test đỏ (đọc assert → xác định bên sai → không đổi đầu vào để qua → sửa bên sai), và mẫu cho bốn loại việc (viết test, sửa lỗi, tách module, script) | lỗi L4 "né ca đỏ" và "sửa mã theo test sai" = 0 ở lô 2 | tho‑ca‑agent, chu‑du‑an‑HST duyệt chữ |

Bất biến bí mật (kiem‑dinh 11/11, lỗi chặn `--cho-phep-db`): lệnh kiểm nào chạy với bí mật trong env (ví dụ URL CSDL `_test`) thì **đầu ra về model chỉ gồm số (Test Files/Tests, mã thoát) và tên ca đỏ** — lọc regex không đủ (5/9 cách né lọt). Đầu ra đầy đủ chỉ dành cho lệnh kiểm thuần chạy với env đã lọc và DB chết. Áp cho SM‑1, SM‑2 và HA‑3.

Bất biến thực thi (dieu‑phoi 11/11): lệnh kiểm chạy mã do model viết dưới cùng tài khoản HĐH với bộ chạy, nên mã đó đọc được `.env` của repo chính (URL vai ứng dụng, nối được DEV). Vì vậy **mã model viết chỉ được thực thi sau khi (a) người duyệt đã chấp nhận diff chứa nó, hoặc (b) tiến trình chạy dưới tài khoản HĐH cách ly không đọc được `.env` và thư mục bí mật**. SM‑1, SM‑2 và chế độ `tu-dong` phải giữ bất biến này; trước khi có (b), pilot không dùng `tu-dong` cho việc có test hoặc script. Áp cả cho tự kiểm mã: **T1 chỉ BIÊN DỊCH (không thực thi) nên được phép chạy trước duyệt; T2 (chạy ca thử do model viết) và mọi bước "chạy" của SM‑2 chỉ được bật khi có (b)**; không đưa T1/T2 vào host agent (`quanLyLuotChay`) theo cách làm mã chạy trước duyệt. Đã xác nhận bằng đọc mã (dieu‑phoi, tip cf4d9b807): `driverHost.ts` lọc `locTruocKhiCho` rồi `duyetQuaTep`, lượt `cheDo: "sua"`, host agent không có spawn/exec, diff bị từ chối không chạm đĩa.

### 9.5 Lô HA — Harness mạnh hơn, logic hơn (L2 + L3 + L4)

| Việc | Nội dung | Tiêu chí | Ai |
|---|---|---|---|
| HA‑1 máy trạng thái việc | KHẢO SÁT → KẾ HOẠCH (duyệt) → THỰC HIỆN từng bước → TỰ KIỂM → BÁO CÁO. Host kiểm điều kiện chuyển: không vào BÁO CÁO khi chưa có kết quả kiểm xanh của chính lượt này | `bao-sai` = 0; việc 2 lượt tay của pilot thành một lượt có cổng | tho‑ca‑agent |
| HA‑2 thoát bế tắc | H1.6 dấu kết cục thống nhất; H1.7 nhắc trước khi dừng vì lặp; cùng một lỗi 3 lần ⇒ buộc đổi chiến lược (đọc lại đề và assert, hoặc gọi con `ra-soat`) trước khi tiêu thêm lượt | `het-luot` và `lap-lai` trên lô 2 = 0 | tho‑ca‑agent |
| HA‑3 ngân sách theo thẻ | Biến `AI_AGENT_SO_LUOT_TOI_DA` (mặc định 30, kẹp trần cứng; kèm phút và token ra) vì giới hạn hiện là hằng `GIOI_HAN_MAC_DINH` không có núm (do‑model 11/11); số vòng, phút, token đọc từ thẻ và ghi vào JSON; cảnh báo cho model ở 70 %; lệnh kiểm và tsc **luôn chạy trên cây cuối** dù lượt không xong; đuôi đầu ra giữ đầu + đuôi + dòng lỗi | ba lỗi bộ chạy của TC‑14 đóng | tho‑ca‑agent |
| HA‑4 lỗi công cụ dẫn đường | `NOT_A_DIRECTORY` ⇒ trả danh sách thư mục; `DENIED_DIR` ⇒ nêu vùng được đọc; `CHI_MUC_CHUA_CO` ⇒ tự dựng chỉ mục cho worktree hoặc chỉ sang `grep`; `GREP_DEADLINE` ⇒ gợi ý thu hẹp | lỗi công cụ/việc 1–4 → 0 | tho‑ca‑agent |
| HA‑5 bộ dò mẫu L4 | Host phát hiện: đầu ra chứa chữ khoá duyệt; danh sách hành vi chứa mô tả đột biến; ca đỏ được làm xanh bằng đổi đầu vào/kỳ vọng mà không đổi mã (`ne-ca-do`); test chép bảng dữ liệu của mã nguồn. Cảnh báo vào thẻ duyệt, không tự chặn | bốn mẫu lô 1 được gắn cờ 100 % trên phát lại | tho‑ca‑agent |
| HA‑6 đột biến sau sửa | Khối ĐỘT BIẾN cờ `sau-sua`: kiểm chuỗi trên cây sau lượt cuối; tự sinh đột biến số học/biên cho hàm thuần khi thẻ không khai | L3b tay của TC‑11/12/14 thành tự động | tho‑ca‑agent |
| HA‑6b kiểm hậu quả | Thẻ khai `KIỂM HẬU QUẢ:` — phép đo do HOST chạy trước và sau lệnh kiểm, model không thấy cách đo (ví dụ đếm hàng theo tag ở các bảng cho việc chạm CSDL; `git status` sạch; không tệp ngoài thư mục tạm). Lệch ⇒ kết cục `hau-qua-xau` dù test xanh. Căn cứ: TC‑13 lượt 3 (13/11) 141/141 xanh mà mỗi lần chạy rò thêm một bộ hàng vì giao dịch lồng COMMIT giao dịch ngoài | TC‑13 phát lại ra `hau-qua-xau`; 0 việc chạm DB được chấm đạt khi tag tăng | tho‑ca‑agent |
| HA‑7 hồi quy | Mỗi thay đổi lô NC/AC/SM/HA: phát lại fixture lô 1 không GPU; lô 2 chạy lại 3 việc lô 1 với B1 để đo L1 trước/sau | 0 việc cũ rớt | do‑model + dieu‑phoi |
| HA‑8 bảng việc tự động | `buoc-do` thêm: giây chờ duyệt, lỗi công cụ theo mã, token trước/sau nén, số thẻ bị từ chối ⇒ sinh phần số của `danh-gia.md` | phần (a) của đánh giá không còn viết tay | tho‑ca‑agent + do‑model |
| HA‑9 quét tĩnh diff + cách ly | Bộ quét cảnh báo trên thẻ chờ duyệt: đường tuyệt đối ngoài worktree/thư mục tạm, `.env`, `bi-mat`, `DATABASE_URL`/`process.env` ngoài danh sách của thẻ, `child_process`/`spawn`/`exec`, ghi tệp ngoài thư mục tạm, mạng ngoài `127.0.0.1:5434`, `eval`/`Function`/import động. Người duyệt vẫn quyết. Bước sau: chạy lệnh kiểm dưới tài khoản HĐH cách ly (chủ dự án tạo tài khoản + ACL) | 9 mẫu có ca test + đột biến; sau cách ly: mã test đọc `.env` bị từ chối ở mức HĐH | tho‑ca‑agent; cách ly = chủ dự án + dieu‑phoi |
| HA‑10 phủ danh sách đã duyệt | Trước khi nhận "xong", host yêu cầu và kiểm bảng "dòng danh sách đã duyệt → tên ca test": dòng không có ca ⇒ không cho kết thúc (hoặc kết cục `thieu-phu`); test xanh chỉ là điều kiện cần. Căn cứ: TC‑11R lô 2 (13/11) — được tự chạy lệnh kiểm, model dừng ngay khi 72/72 xanh, không thêm ca nào, lỗi cài bị bắt 6/12 (lô 1 12/12; lượt bị nhiễm, đang chạy lặp để xác nhận) | TC‑11R phát lại ra `thieu-phu`; việc sửa mã ở lô 2b có ≥ 1 ca cho mỗi dòng đã duyệt | tho‑ca‑agent |
| HA‑11 che đầu ra lệnh kiểm (thêm 14/11) | Đầu ra LỆNH KIỂM khi KHÔNG có cờ DB đang đi nguyên văn vào đuôi 1 800 ký tự gửi model (`kiemChung.ts:395–438`, `driverHost.ts:167–179`); nhánh có cờ DB chỉ lọc URL postgres + mật khẩu `_test`. Vá: gọi bộ che dùng **chính `shared/mauBiMat`** (một nguồn, không regex riêng) cho cả hai nhánh và cho `locLoi`. Cam kết đổi từ "cờ tắt ⇒ không đổi một byte" thành "không có mẫu bí mật ⇒ không đổi một byte" (ca ghim). Làm sau khi bản vá `mauBiMat` của do‑model gộp; không áp cho runner đóng băng dda806ac9 | khoá giả trong fixture → 0 lần tới model; ca ghim byte‑y‑hệt xanh | tho‑ca‑agent |
| HA‑6c hậu quả luôn được đo (thêm 14/11) | Runner đếm và ghi KIỂM HẬU QUẢ cả khi kết cục đã đỏ vì lý do khác (kiem-do, het-luot…): kết cục giữ nguyên, thêm trường hậu quả vào JSON và thẻ duyệt. Căn cứ: `chayMotViec.ts:805` chỉ đếm khi `ketCuc === "xong"` ⇒ lượt vừa lỗi kiểu vừa rò hàng chỉ báo lỗi kiểu (TC‑13 1b07a2cd7). Kèm: bộ đếm nhận VIEW và báo đúng nguyên nhân khi không đếm được | Phát lại TC‑13 nguyên bản ra `kiem-do` KÈM số hàng rò; phải gộp trước mọi việc pilot mới có chạm DB | tho‑ca‑agent |

### 9.6 Thứ tự và chỉ số mới

**Đợt 1 — không cần GPU, làm ngay sau TC‑13:** HA‑3, HA‑4, SM‑1, SM‑3, HA‑5, NC‑3, SM‑8, AC‑2. Sau đó **pilot lô 2** (luật B1 + chế độ `--luat-cach ghep`) đo hiệu quả.
**Đợt 2 — cần cửa sổ GPU:** nghiệm thu T1 (SM‑5), NC‑8 baseline việc dài, NC‑5/NC‑6, NC‑1/NC‑2 A/B, AC‑1 A/B, SM‑2, B4 đo tắt/bật.
**Đợt 3:** NC‑7 (98k), NC‑9, AC‑3, AC‑4, AC‑5, SM‑4, HA‑1, HA‑2, HA‑6, HA‑8; AC‑6 theo 90‑P3.

| # | Chỉ số | Hiện (lô 1, 11/11) | Mục tiêu |
|---|---|---|---|
| M13 | Việc dài (≥ 5 tệp hoặc ≥ 40 lượt model) hoàn tất | chưa có bộ; TC‑14 `het-luot` ở 30 | ≥ 3/4 bài NC‑8 |
| M14 | Tỉ lệ cache tiền tố / token xử lý lại | **đo 11/11 trên 54 lượt agent‑f (việc ngắn): cache 0,913, trung vị lượt 0,953**; 94,2 % token tiền tố mất là do NÉN; system/tools 0 lần đổi băm | việc ngắn: giữ ≥ 0,90; **việc dài (`agent-dai`): cache ≥ 0,80, ≤ 2 lần nén/lượt** |
| M15 | Thẻ bị người từ chối mỗi việc | 0–4 (TC‑06 0, TC‑07 2, TC‑11 2, TC‑12 1, TC‑14 4) | ≤ 1 |
| M16 | Giây tường lượt thực hiện, việc cùng loại | 87–250 s (trong đó chờ duyệt 33–75 s) | −30 % |
| M17 | Lỗi công cụ mỗi việc | 1–4 | 0 |
| M18 | Agent con: ngữ cảnh cha tiết kiệm ở bài khảo sát | chưa đo | ≥ 40 %, đạt không tụt |

**Ràng buộc vận hành (dieu‑phoi, 11/11):** NC‑7 đổi cấu hình `llama-server` `:8091` (VRAM, `.env`) ⇒ do‑model đo trên cửa sổ GPU và viết hướng dẫn, **chủ dự án tự đặt `.env`**, dieu‑phoi restart `:8091` rồi `:3000`; không phiên nào tự đổi. Đợt 1 đi trên nhánh runner, mỗi commit nhỏ qua kiem‑dinh rồi mới gộp; lô nào thêm `spawn`/`child_process` thì kiem‑dinh chạy riêng `vramAllocationSites.test.ts` (bài học 428684a37). Pilot lô 2 chỉ mở sau TC‑13, khi dieu‑phoi đã chuyển AGENTS.md pilot ra khỏi `_tho_ca_wt` và cho nó nhận main.

Rủi ro thêm: tóm tắt bằng model có thể **bịa hoặc bỏ sót** ⇒ NC‑2 bắt buộc kèm bằng chứng đường:dòng và giữ bản gốc trong kho; agent con tốn lượt trên một slot ⇒ AC‑1 đo thời gian tường chứ không chỉ đo đạt; `run_check` không duyệt ⇒ chỉ khớp nguyên văn lệnh của thẻ, không nhận tham số từ model.

---

## 8. Nhật ký

| Ngày | Ai | Việc | Mig |
|---|---|---|---|
| 2026-11-08 | chu-du-an-HST | v1.0 dự thảo từ 3 tài liệu chủ dự án + kiểm kê hiện trạng (spec Đợt 11/12, git 163 commit AI từ 27/10, extension 0.6.0, runtime, ai-eval, `.env` tên khoá). Pilot GĐ2 = lô A đang chạy (L3a → TC‑05). Câu hỏi 2 card: trả lời ở D6 | — |
| 2026-11-08 | chủ dự án | **DUYỆT v1.0**; uỷ quyền chu-du-an-HST quyết mọi việc trong kế hoạch (kể cả §7 mục 2–5, 7) để đạt kết quả cao nhất; chủ dự án kiểm chứng sau. Giữ nguyên: xoá dữ liệu/tệp, LoRA thuê GPU (§7‑6), bật `AI_OT_CONTROL_ENABLED`/`AI_NGOAI_ENABLED` vẫn hỏi chủ dự án. Khởi động lô B + C ngay; D theo cửa sổ GPU | — |
| 2026-11-09 | chu-du-an-HST | Sửa M4/M5 theo do-model: `run-eval` hiện chỉ đo **trục M** (gọi thẳng model, không tool) nên vendor docs B4 không thể đổi số M ⇒ M5 nghiệm thu theo **trục H** (đường sản phẩm `:3013` + `_test`, do-model thêm đo H vào `run-eval` cùng đêm agent-f); baseline M 08/11: khó 73,6 %, api2 40 %. ot‑node 7 mẫu lỗi đã gửi tho-ca-agent cho B4 | — |
| 2026-11-10 | chu-du-an-HST | Điền baseline trục H (đêm 09/11, do-model 0750a413c): M4 bộ khó 22/36 = 61,1 % (mục tiêu ≥ 85 %, cách ~24 điểm); M5 api2 40/90 = 44,4 % (mục tiêu ≥ 60 %). agent‑f ×3 12/18, py‑dang‑ky 0/3. Hai trục khác máy chủ/số mẫu ⇒ không so M với H. |
| 2026-11-10 | chu-du-an-HST | Đính chính M5: trục H là chat coding một lượt (RAG), không phải agent có tool (tho-ca-agent đọc mã). AGENTS.md chỉ được nạp ở đường agent (`quanLyLuotChay.ts:92`) ⇒ B1 chỉ tác dụng cho agent/pilot/Thợ Cả, không tới trục H. Vá H‑cs2 ở trục H = T1 biên dịch (`AI_CHAT_TU_KIEM_MA`, mặc định TẮT), không thêm luật vào lời nhắc chat lúc này. |
| 2026-11-10 | chu-du-an-HST | do‑model xác nhận trục H = một lượt `streamCodingGenerate`, ngữ cảnh mã repo, không RAG tài liệu, không tool (9bd9f6f6d sửa chú thích run-eval). Hệ quả: vòng tự sửa T1 đặt ở `streamCodingGenerate`; **B4 vendor docs cần đường tới sinh‑mã** (kiểm trước, nếu không M5 không thể nhúc nhích). py‑dang‑ky test đổi c99b21d79 (khoá ẩn chỉ có vi, monkeypatch; mẫu 1/1, gốc 0/1, gian lận 0/1). |
| 2026-11-10 | chu-du-an-HST | B1 nháp duyệt (3 sửa: dòng TS viết dạng chung, bỏ dòng Python, bỏ `eslint` vì repo không có script lint). T1 `AI_CHAT_TU_KIEM_MA` xong 01de40b45 chờ kiem‑dinh; thêm giá trị `theo-luot` cho A/B cùng máy chủ. B4 duyệt phương án thẻ tóm tắt theo tên gói, cờ `AI_CODING_VENDOR_DOCS` TẮT; kiểm trigger trên đề ot‑node trước khi viết. |
| 2026-11-11 | chu-du-an-HST | Đêm 10/11 (do-model 56e33affb): agent‑f baseline **trước 12/18 (test cũ, 09/11) / sau 15/18 (test py‑dang‑ky mới, NEN_MOC=0)** — chênh do đổi test, không phải model; `NEN_MOC` 0 vs 0,5 = 15/18 vs 13/18 (p 0,69) không kết luận, giữ mặc định; H‑cs2 ngữ cảnh repo 5/6 vs 4/6 không phân biệt — đóng câu hỏi, vá bằng T1. Việc L2 mới: phân loại lệnh `LENH_CAN_DUYET_TAY` ở lượt C#. |
| 2026-11-11 | chu-du-an-HST | ⚠ **Đính chính**: số agent‑f 12/18 (09/11) và 15/18 (10/11) chứa 6 lượt C# là **âm tính giả của thiết bị đo** (`:3013` thiếu `ProgramFiles` ⇒ NuGet lỗi 68/68). Số dùng được: **4 bài không C# = 12/12 ở cả NEN_MOC 0 và 0,5**; baseline C# agent‑f CHƯA CÓ — đo lại đêm 11/11 sau khi `may.mts` sửa (commit đính chính của do‑model, chờ hash). |
| 2026-11-11 | chủ dự án → chu-du-an-HST | **v1.1**: chủ dự án chỉ đạo xem lại và cập nhật để Thợ Cả gom/tổng hợp ngữ cảnh (làm việc dài hơn), chia phiên và agent con, sửa/viết mã nhanh và chuẩn hơn, harness mạnh và logic hơn ⇒ thêm §9 (lô NC 9 việc · AC 6 · SM 8 · HA 8, chỉ số M13–M18, ba đợt). Căn cứ: đọc `shared/agentCore/{nguCanh,giaoViec,vongAgent,congCu}.ts` + số lô 1 pilot. Lô A–G giữ nguyên. Lúc ghi không có phiên nào khác đang chạy ⇒ việc giao nằm ở tệp bàn giao bộ nhớ, chờ các phiên mở lại; tệp này CHƯA commit. |
