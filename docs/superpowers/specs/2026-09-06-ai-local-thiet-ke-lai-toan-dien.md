# AI Local — thiết kế lại toàn diện (sau audit 4 mảng)

**Ngày:** 2026-09-06 · **Trạng thái:** ★ **BẢN THẢO CHỜ CHỦ DỰ ÁN DUYỆT** — chưa thực thi gì
**Nguồn:** 4 audit song song, báo cáo đầy đủ tại `.superpowers/sdd/2026-09-06-audit-ai-local/`

> **Quy tắc:** mỗi khẳng định gắn nhãn **[ĐO]** (đo trên máy này) · **[MÃ]** (đọc từ mã nguồn) ·
> **[NGOÀI]** (tham khảo, chưa kiểm) · **[ĐỀ XUẤT]** (chưa làm, chưa chứng minh).

---

# 1. Kết luận lớn nhất — và nó đổi hẳn hướng nâng cấp

**AI Local có nhiều năng lực hơn hẳn thứ nó phơi ra. Vấn đề chính không phải THIẾU, mà là CHƯA NỐI.**

Bốn audit độc lập, mỗi audit tìm ra **một năng lực lớn đã tồn tại, có mã, có lưới, mà không dùng được**:

| Năng lực | Trạng thái thật | Vì sao chưa dùng được |
|---|---|---|
| **Chạy lệnh: `dotnet test`, `vitest run`, `git diff`** | **[MÃ]** `repoCommandSandbox.ts` — **9 lệnh whitelist**, RBAC `ai_repo_exec/canCreate`, HITL qua `run_command` | **chưa nối vào giao diện extension** |
| **Model chuyên lập trình `Qwen3-Coder-30B`** | **[ĐO]** có trên đĩa 16,5GB, cùng kiến trúc MoE ⇒ **cùng tốc độ** | `chatCompletion()` **thiếu nhánh gọi llama-server** ⇒ rơi xuống nạp bản thứ hai ⇒ OOM ⇒ cầu chì chặn |
| **Tri thức 6 hãng thiết bị** | **[ĐO]** 124.990 chunk đã nhúng | *(đã nối ngày 04/09 — trước đó route vscode không thấy)* |
| **Nạp tài liệu tự phục vụ** | **[ĐO]** Training Studio 5 tab, parse→chunk→nhúng trong 1 giao dịch | *(đã thêm hướng dẫn ngày 05/09)* |

★★★ **Hệ quả cho lộ trình:** phần lớn giá trị lớn nhất **không đến từ viết mới**, mà từ **nối dây**
những thứ đã có và đã được kiểm thử. Đây là tin tốt: rẻ hơn, ít rủi ro hơn, và không phá bất biến.

---

# 2. Trả lời ba câu hỏi của chủ dự án

## 2.1 Đổi sang Qwen3.8-27B? → **KHÔNG** (có điều kiện xem lại)

**[ĐO]** Hai vòng A/B kiểm soát biến (16–17/08), qua đúng `llama-server`:

| | Qwen3-30B-A3B *(đang dùng)* | Qwen3.8-27B |
|---|---|---|
| Sinh chữ | **275,8 tok/s** | **71,5 tok/s** — chậm **3,9×** |
| Prefill | — | chậm **3,2×** |
| Prefix-cache | hoạt động | **HỎNG** (xử lý lại 516 token thay vì 1) |
| Chọn tool | — | +0,03 |
| Câu tiếng Việt không dấu | — | +0,17 |
| Sinh mã hợp lệ | — | +0,125 |
| VRAM | — | tiết kiệm 2,76GB |

⇒ **Đổi 3,9× tốc độ lấy vài phần trăm chất lượng.** Model hiện đã mất 3–58s/lượt; chậm thêm bốn
lần là không dùng được cho công việc thật.

★ Nếu vẫn muốn đổi: **bắt buộc `-rea off`** — thiếu cờ đó sinh mã tụt **8/8 → 3/8** **[ĐO]**; và
phải vá ngưỡng router + thêm retry `disableThinking`.

★ **Xem lại khi nào:** nếu khối lượng công việc đổi sang **câu ngắn, nhiều lượt gọi tool** thay vì
sinh đoạn mã dài — lúc đó tốc độ sinh mất giá trị và độ chính xác chọn tool lên ngôi.

## 2.2 Frontend chưa clear → **đã tìm ra lý do cụ thể**

**[MÃ]** `src/ui/htmlBang.ts:436-457` — bấm Gửi tạo bong bóng AI **hoàn toàn rỗng**
(`themLuot("ai","")`). **Không spinner, không dấu chấm động, không animation nào trong cả 705 dòng.**

**[ĐO]** Model mất **3–58 giây**/lượt. ⇒ Người dùng bấm Gửi rồi nhìn **khung trắng đứng yên cả
phút** — không cách nào phân biệt "đang nghĩ" với "đã treo".

★★★ Đây không phải khiếm khuyết thẩm mỹ. Đây là **người dùng không biết hệ thống còn sống không** —
và nó giải thích cảm giác "chưa clear" chính xác hơn mọi phỏng đoán.

Hai vấn đề đi kèm:
- **[MÃ]** `htmlBang.ts:161` — khung rỗng lần đầu **không một dòng hướng dẫn**; Claude Code có
  walkthrough 4 bước.
- **[MÃ]** `package.json:54-172` — **6/10 lệnh không nằm trong menu nào** (đăng nhập, đăng xuất,
  MCP servers, nhớ điều này, đổi máy chủ). Chỉ gõ đúng tên trong Command Palette mới ra.
  ★ Đúng lớp lỗi *"đã cài ≠ nhìn thấy được"* đã cắn dự án **hai lần** trước.

## 2.3 Thiếu tool/skill/plugin → **phần lớn đã có, chưa nối**

**[MÃ]** Đối chiếu trực tiếp với Claude Code 2.1.259 đang cài trên máy:

| Năng lực | AI Local | Claude Code |
|---|---|---|
| Đọc / liệt kê / grep | ✅ `doc_tep`/`liet_ke`/`grep` | ✅ `Read`/`Glob`/`Grep` |
| Sửa tệp có duyệt | ✅ **1 điểm ghi duy nhất** (chặt hơn) | ✅ Edit/Write/MultiEdit (tự do hơn) |
| **Chạy lệnh, đọc lỗi build/test** | **[MÃ] CÓ ở máy chủ, CHƯA nối UI** | ✅ Bash |
| **git diff / status** | **[MÃ] CÓ trong whitelist, CHƯA nối UI** | ✅ |
| MCP client | ✅ lõi (bắt tay thật) | ✅ + UX `mcp add/list/get` |
| Skill | ❌ chưa có cho model cục bộ | ✅ |
| Ghost-text / FIM | ❌ | ❌ *(cả hai đều không có)* |

★ **[MÃ]** `repoCommandSandbox.ts` whitelist **9 lệnh** gồm `dotnet test`, `vitest run`, `git diff`,
có RBAC riêng (`ai_repo_exec/canCreate`) và HITL qua `run_command`. **Không thiếu năng lực — thiếu dây.**

---

# 3. Hiện trạng đo được — bốn tầng

## 3.1 Extension (frontend)
**[ĐO]** 118 tệp TS · ~19.400 dòng · **853 ca lưới xanh** · census **22/22** · `ext:check` sạch ·
real-host VSCode thật 23+17 xanh.
**[MÃ]** `htmlBang.ts` **705 dòng** dồn markup + CSS + ~480 dòng script webview vào một template
string. Không có đoạn lặp thật; rủi ro là **"tất cả trong một tệp"**.
**[MÃ]** Trợ năng ổn (13 `aria-label`, 0 `tabindex` lệch). **Chưa đo:** bề rộng 290px thật, tương
phản màu runtime — *không tự mở VSCode chụp ảnh vì việc đó từng làm treo máy chủ dự án*.

## 3.2 Máy chủ (backend)
**[ĐO]** `aiLocalKnowledgeService.ts` = **6.895 dòng, 115 hàm cấp cao nhất** — **God object thật**,
gộp RAG vận hành + truy hồi 3 kho + chấm điểm + dựng prompt + gọi model + cache + RBAC + toàn bộ
đường sinh mã (~34% số dòng).
★ **Nhưng ranh giới tách rõ theo tên hàm** (`streamCoding*` gần như độc lập) ⇒ **tách được**, không
phải mớ bòng bong.
**[ĐO]** Rẽ nhánh theo `route`: **5 nhánh thật** (+11 bình luận) — đều có chủ đích, đều khoá vào
**một trường duy nhất**. Nợ nằm ở **tầng nhận đầu vào**, không ở tầng dùng.
**[ĐO]** **46/64** biến `KB_*`/`PROG_KB_*` **không có trong `.env.example`**.
**[ĐO]** Không có DB trực tiếp trong service, không import vòng giữa 3 kho.

## 3.3 Model & RAG
**[ĐO]** Đang chạy: `Qwen3-30B-A3B-Instruct` · port 8091 · ctx 65.536 · 2 slot · flash-attention ·
full GPU. Tốc độ sinh thật hôm nay **163,46 tok/s**.
★ **[ĐO]** `n_busy_slots_per_decode = 1,04` ⇒ **hai slot gần như chưa bao giờ cùng bận**.
★ **[ĐO] ĐÍNH CHÍNH:** RAG **đã hợp nhất MỘT không gian nhúng** — cả kho vận hành (8.327 chunk) lẫn
kho lập trình (124.990 chunk) đều dùng `Qwen3-Embedding-0.6B`. "mxbai" chỉ còn là **bình luận chết**.
Hai ngưỡng 0,5 / 0,18 là **hiệu chỉnh nhiễu hợp lý, không phải nợ kỹ thuật**.
**[ĐO]** Reranker chạy **CPU** (0 byte VRAM), tốn ~4,7 lõi — **lợi ích chất lượng CHƯA TỪNG được đo**.
**[ĐO]** VL-8B (~7,8GB) **không thể đồng trú** với bất kỳ ứng viên 27B nào ở ctx 32k.

## 3.4 Chất lượng đầu-cuối
**[ĐO]** Bộ `scripts/ai-eval/eval-vscode-route.mjs` (đăng nhập + POST + SSE thật):
**10 ĐẠT / 0 SAI / 1 CHẶN-ĐÚNG** trên 11 ca. Nhiễm trích dẫn nhầm hãng **0/40**.
⚠ **Tiêu chí chấm còn dễ dãi** (≥1 trích dẫn đúng = ĐẠT) — đã ghi là nợ.

---

# 4. Rủi ro an toàn phát hiện trong audit

## 4.1 ★★ `route` không được xác thực GIÁ TRỊ *(lần thứ 5 cùng họ lỗi)*

**[MÃ]** `server/routes/aiLocalKnowledgeApi.ts:63-72` — `parseContext` lọc `context.route` theo
**hình dạng** (chuỗi ≤200 ký tự), **không theo giá trị** — trong khi `uiLanguage`, `codingMode`,
`projectId` **ngay cạnh đó đều có whitelist giá trị**.

⇒ Bất kỳ client đã đăng nhập nào (**vai gì cũng được**) gửi `context:{route:"vscode"}` kèm câu hỏi
vận hành sẽ: **tắt vòng tool · ép `intent="general"` · đổi ngân sách token**.

★ **Không phải lỗ RBAC** (`callerRole` luôn lấy server-side — đã kiểm). Là **đường chọn nhầm định tuyến**.
★ **Nguyên nhân:** chính bản vá tách miền đã biến `route` thành trường chịu lực **mà không xác thực nó**.
★ **Vá:** thêm enum `VALID_ROUTES` theo đúng khuôn `VALID_UI_LANGUAGES` đã có sẵn ngay cạnh. **Nhỏ.**

## 4.2 Bất biến an toàn hiện có — phải giữ nguyên qua mọi thay đổi

- **Đúng MỘT điểm ghi đĩa** (`ui/apBanVa.ts`), census **22/22**, lệnh ghi `fs.*` = **0**
- `.env`, khoá riêng, `.git/**` **không rời máy** qua bất kỳ đường nào **[ĐO trên đĩa thật]**
- Kết quả tool ngoài & nội dung bộ nhớ **không bao giờ được quét tìm lệnh** ⇒ không tiêm lệnh được
- `chi_doc` chặn **tại điểm ghi**, không phải ẩn nút; `tu_ghi` bỏ **bước hỏi**, không bỏ **hàng rào**
- `scope:"machine"` cho `mcpServers` (repo thù địch không ghi đè được)

---

# 5. ★ THIẾT KẾ MỚI — bốn tầng, ranh giới rõ

```
┌─ TẦNG 1 · GIAO DIỆN (extension VSCode) ────────────────────────┐
│  Panel chat · trạng thái chạy · thẻ duyệt · quyền · bộ nhớ     │
│  ★ MỚI: chỉ báo đang chạy · khung rỗng có hướng dẫn ·          │
│         mọi lệnh vào menu · bảng điều khiển MCP                │
├─ TẦNG 2 · TÁC NHÂN (client, trong extension) ──────────────────┤
│  Vòng lặp · buocKeTiep (điểm dừng DUY NHẤT) · giao thức        │
│  avi-tool · 3 tool ĐỌC · MCP client · ★ MỚI: tool CHẠY LỆNH    │
│  ★ MỚI: cơ chế SKILL (văn bản nạp có điều kiện)                │
├─ TẦNG 3 · TRI THỨC & ĐỊNH TUYẾN (máy chủ) ─────────────────────┤
│  ★ TÁCH aiLocalKnowledgeService (6.895 dòng) thành:            │
│    · dinhTuyen/   — parseContext + VALID_ROUTES + chọn miền    │
│    · truyHoi/     — 3 kho, 1 không gian nhúng, ngưỡng riêng    │
│    · dungPrompt/  — giáo cụ, ngân sách token, ngôn ngữ         │
│    · sinhChu/     — llama-server + streaming + cache           │
├─ TẦNG 4 · MODEL (llama-server) ────────────────────────────────┤
│  ★ MỚI: chatCompletion() có nhánh llama-server                 │
│  ⇒ đổi model = đổi cấu hình, KHÔNG nạp tiến trình thứ hai      │
└────────────────────────────────────────────────────────────────┘
```

**Nguyên tắc kiến trúc — rút từ những lần đã trả giá:**

1. ★★★ **Đầu vào người dùng KHÔNG được điều khiển định tuyến máy chủ** — đã vi phạm **5 lần**.
   Mọi trường ảnh hưởng định tuyến phải whitelist **giá trị**, không chỉ hình dạng.
2. ★★★ **Một sự thật một nguồn** — đã bị cắn 5 lần (`daBiTuChoiGhi`, `MA_GHI_MOT_PHAN`,
   `NHAN_HANG_RAO`, danh sách hãng, danh sách định dạng).
3. ★★★ **Chặn bằng kiến trúc, không bằng bộ lọc** — `classifyIntent` **không được gọi** cho route
   vscode, thay vì lọc kết quả sau khi gọi.
4. ★★★ **Đo KẾT CỤC, không đo cơ chế** — đã suýt ship một bản vá làm chỉ số đẹp mà người dùng nhận
   được lời từ chối.
5. **Một miền một corpus** — trộn miền là nguồn của sự cố lớn nhất tuần qua.

---

# 6. Lộ trình đề xuất — xếp theo **giá trị / chi phí**

## Đợt I — nối dây thứ đã có *(rẻ nhất, giá trị cao nhất)*

| # | Việc | Giá phải trả | Bất biến |
|---|---|---|---|
| I-1 | **Chỉ báo đang chạy** trong khung chat | vài giờ UI | không đụng |
| I-2 | **Xác thực giá trị `route`** (`VALID_ROUTES`) | ~10 dòng + lưới | củng cố |
| I-3 | **Nối UI → `run_command`** (`dotnet test`, `vitest`, lỗi build) | công sức UI, **0 tool mới** | HITL + RBAC **đã có** |
| I-4 | **Nối UI → `git diff`/`status`** | gần 0, cùng dây I-3 | như trên |
| I-5 | **Khung rỗng có hướng dẫn** + đưa 6 lệnh còn thiếu vào menu | nhỏ | không đụng |

## Đợt K — model & hiệu năng

| # | Việc | Giá phải trả |
|---|---|---|
| K-1 | **`chatCompletion()` thêm nhánh llama-server** ⇒ mở đường dùng **Qwen3-Coder-30B** | **[ĐỀ XUẤT]** thay đổi kiến trúc nhỏ; phải đo lại 11 ca trước/sau |
| K-2 | **Đo lift của reranker** — đang tốn 4,7 lõi CPU mà chưa ai biết nó đáng không | chỉ công đo |
| K-3 | Cân nhắc `-np 1` (2 slot gần như không dùng: 1,04) | đo trước, có thể trả VRAM |
| K-4 | ❌ **KHÔNG đổi Qwen3.8-27B** — xem §2.1 | — |

## Đợt L — tính năng mới *(đắt hơn, cần quyết định)*

| # | Việc | Giá phải trả |
|---|---|---|
| L-1 | **Cơ chế skill** cho model cục bộ (tái dùng `doc_tep`) | thiết kế nhỏ, 0 tool mới |
| L-2 | **UX MCP**: đăng ký/liệt kê/gỡ lỗi server ngoài | vừa |
| L-3 | Nạp tài liệu **PLC ladder** (thanh ghi Mitsubishi/Omron) | thời gian nạp, 0 hạ tầng mới |
| L-4 | **Techman/TMscript** RAG + mở đuôi tệp cho `apply_diff` | ⚠ **phải xác nhận trước**: chương trình Techman lưu dạng tệp text hay chỉ trên pendant? |
| L-5 | **Tách God object** thành 4 module (§5) | lớn; làm sau khi I/K ổn định |
| L-6 | **Ghost-text/FIM** bằng `Qwen2.5-Coder-1.5B` (có trên đĩa) | **một đợt tính năng**: cần llama-server **thứ hai** + đo độ trễ + debounce UI |
| L-7 | ⚠ **MCP điều khiển PLC/robot THẬT** | ★★★ **ĐÒI PHÁ BẤT BIẾN** — ghi thanh ghi/ra lệnh chuyển động không có HITL tương đương, **rủi ro an toàn vật lý**. Nêu để chủ dự án quyết; **tôi không tự làm** |

## Nợ kỹ thuật cần dọn *(song song, rẻ)*

- `.env.example` thiếu **46/64** biến `KB_*`/`PROG_KB_*`
- i18n cho chuỗi hướng dẫn Training Studio (viết nội tuyến khi locale bị khoá)
- `embed-programming.mjs` **báo VRAM sai** (in 27GB khi thật còn 6GB)
- `kbStudioService.createJob` đôi khi trả `jobId:null`
- Tiêu chí chấm eval quá dễ dãi (≥1 trích dẫn = ĐẠT)
- `de_xuat_nho` **0/5** — nghi tầng chú ý model, chưa có đường vá đo được

---

# 7. Phần CHƯA xác minh — nói thẳng

1. **Chưa đo bề rộng 290px và tương phản màu thật** — không tự mở VSCode chụp ảnh vì việc đó từng
   làm treo extension host của chủ dự án. **Cần chủ dự án nhìn bằng mắt.**
2. **Chưa tự nạp thử model 27B/Coder hôm nay** — chỉ còn ~4,7GB VRAM; số liệu 27B lấy từ hai vòng
   A/B **có sẵn** (16–17/08), không phải đo mới.
3. **Lift của reranker chưa từng đo** — `--rerank` chưa chạy lần nào.
4. **`Qwen3-Coder-30B` mới nạp thử thành công MỘT lần** (16.638 MiB, PASS ca đầu); eval đầy đủ
   **chưa xong** do bug harness thoát ngầm.
5. **Định dạng dự án GX Works / CX-Programmer / TMscript chưa kiểm** — mọi đề xuất tool cho PLC/robot
   đứng trên giả định chúng là tệp text đọc được. **Cần xác nhận.**
6. **MCP công nghiệp bên thứ ba chưa khảo sát** — không biết có server MCP sẵn cho PLC/robot không.
7. Copilot Chat **không cài trên máy này** ⇒ chỉ đối chiếu được với Claude Code.

---

# 8. Chủ dự án cần quyết

1. **Duyệt bỏ Qwen3.8-27B?** (đo: chậm 3,9× đổi lấy vài % chất lượng)
2. **Duyệt Đợt I** (nối dây thứ đã có) làm trước? — rẻ nhất, giá trị cao nhất, không phá bất biến
3. **K-1** (nhánh llama-server ⇒ mở đường Qwen3-Coder-30B): làm ngay hay sau Đợt I?
4. **L-4**: chương trình Techman lưu dạng **tệp text** hay chỉ nằm **trên pendant**?
5. **L-7** (MCP điều khiển thiết bị thật): có muốn đi hướng đó không? — đây là quyết định **an toàn
   vật lý**, không phải quyết định kỹ thuật
6. **Ghost-text/FIM (L-6)**: có đáng một đợt riêng không?
