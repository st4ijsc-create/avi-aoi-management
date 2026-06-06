# Báo Cáo Đánh Giá AI Assistant (Trợ Lý Thông Minh) — Persona Roleplay

**Ngày:** 11/05/2026  
**Phạm vi:** Đánh giá live qua harness `scripts/persona-eval-ai-assistant.mjs` trên endpoint `/api/ai/local-kb/ask` (port 3000).  
**Trạng thái:** **PARTIAL** — Chạy hoàn tất 15/30+ câu (P1, P2, P3 1–5). P3 Q6 (SPC UCL/LCL) timeout do model qwen2.5:7b chậm; P4 (Production Manager), P5 (AI Engineer), P6 (IT Admin) chưa chạy. File JSON kết quả không được flush vì script chỉ ghi sau khi hoàn tất tất cả persona.  
**Stack thử nghiệm:** Ollama `qwen2.5:7b-instruct` (QA) + `mxbai-embed-large` (embed), KB 898 chunks (router 79 / service 46 / type 114 / doc 643 / domain 15), 5 tools đọc-only.

---

## 1. Tóm tắt điều hành (Executive Summary)

| Hạng mục | Kết luận |
|---|---|
| **Hữu ích thực tế?** | **CHƯA** với end-user (worker, manager). Chỉ dùng được ở mức tham khảo cho engineer biết đọc tài liệu. |
| **Điểm số trung bình 15 câu** | **72.8 / 100** (đạt ngưỡng "tham khảo", chưa đạt "production-ready"). |
| **Latency trung bình** | **102 giây/câu** — KHÔNG khả thi cho công nhân tại line. Mục tiêu hợp lý: ≤ 8 giây. |
| **Tool-call rate** | 5/15 câu (33%) — bị bỏ lỡ ở những câu cần tool nhưng thiếu mã định danh (vd: "Lô của tôi sắp xong chưa?"). |
| **Citation rate** | 100% trả 5 citations — nghi ngờ **hardcode top-K**, không lọc theo similarity threshold → nhiễu. |
| **KB coverage gap** | Đã xác nhận: layer `domain/` chỉ có 5 file AOI; **không có tài liệu how-to** cho Products / Measurement Points / SPC / Pareto / role-based screens. 139/898 chunks match "điểm đo" nhưng đa phần là router/type code, không phải hướng dẫn. |
| **Khuyến nghị tổng** | Cần làm 4 hạng mục P0 (KB ingest, latency, tool-trigger, structured response) trước khi giao cho end-user. |

---

## 2. Methodology

### 2.1. Setup
- **Server:** `pnpm dev` (tsx watch), PORT=3000, DATABASE_URL=postgres@5432/avi_aoi_db.
- **Auth:** `POST /api/auth/login` `{username:"admin",password:"admin123"}` → cookie session.
- **Endpoint:** `POST /api/ai/local-kb/ask` body `{question, topK:5, userRole, history:[]}`.
- **Harness:** [scripts/persona-eval-ai-assistant.mjs](scripts/persona-eval-ai-assistant.mjs) — 6 personas × ~5 câu = 30+ câu.

### 2.2. Personas
| ID | Nhân vật | Role | Skill | Số câu |
|---|---|---|---|---|
| P1 | Công nhân vận hành mới | worker | basic | 5 ✅ |
| P2 | Công nhân vận hành kinh nghiệm | worker | basic | 5 ✅ |
| P3 | Kỹ sư QA / Quy trình | engineer | technical | 5/6 ⚠️ |
| P4 | Trưởng ca / Quản lý sản xuất | manager | manager | 0 ❌ |
| P5 | Kỹ sư AI / Data | engineer | technical | 0 ❌ |
| P6 | IT Admin / DevOps | it_admin | technical | 0 ❌ |

### 2.3. Rubric (7 tiêu chí, mỗi 1 điểm, normalize 0–100%)
1. `nonEmpty` — câu trả lời không rỗng
2. `grounded` — có ≥ 1 citation từ KB
3. `toolWhenLive` — gọi tool khi câu hỏi cần dữ liệu live
4. `hasSteps` — có cấu trúc các bước (1./2./- )
5. `hasNavPath` — có đường dẫn điều hướng (Menu > ... > Tab)
6. `notHallucinated` — không bịa endpoint/màn hình không tồn tại
7. `fastEnough` — ≤ 8000ms

---

## 3. Kết quả chi tiết 15 câu

### 3.1. P1 — Công nhân vận hành (mới vào nghề) — TB **74.6 %**, latency TB **79 s**

| # | Câu hỏi | Latency | Intent | Tool | Cit | Score |
|---|---|---|---|---|---|---|
| 1 | Làm sao để vào màn hình kiểm tra sản phẩm? | 91 s | how_to | – | 5 | **83 %** |
| 2 | Tôi thấy máy báo NG, phải làm gì tiếp theo? | 69 s | general | – | 5 | **67 %** |
| 3 | Cách đổi ca làm việc trong hệ thống? | 81 s | how_to | – | 5 | **83 %** |
| 4 | Hôm nay máy của tôi đã kiểm tra được bao nhiêu sản phẩm? | 69 s | general | `get_today_stats` | 5 | **57 %** |
| 5 | Tôi quên mật khẩu, làm sao đăng nhập lại? | 84 s | how_to | – | 5 | **83 %** |

**Quan sát:**
- Q4 fired tool đúng (`get_today_stats`) nhưng score thấp 57% → khả năng cao DB trả `noDbResult` (`note: DB_UNAVAILABLE`) hoặc câu narrative kém.
- Q2 (NG troubleshoot) chỉ 67% — không có hướng dẫn step-by-step cho công nhân (KB thiếu SOP xử lý NG).
- Latency 60–90s với worker đứng máy là **không khả dụng** — cần ≤ 5s.

### 3.2. P2 — Công nhân vận hành (kinh nghiệm) — TB **64.2 %**, latency TB **75 s**

| # | Câu hỏi | Latency | Intent | Tool | Cit | Score |
|---|---|---|---|---|---|---|
| 1 | Trạng thái lô L20260505-001 thế nào? | 81 s | general | `get_lot_status` | 5 | **86 %** |
| 2 | Máy nào đang offline? | 77 s | general | `get_machine_status` | 5 | **57 %** |
| 3 | Top 5 lỗi nhiều nhất tuần này | 82 s | troubleshoot | `get_top_defects` | 5 | **71 %** |
| 4 | Xu hướng lỗi 7 ngày qua | 72 s | troubleshoot | `get_defect_trend` | 5 | **57 %** |
| 5 | Lô của tôi sắp xong chưa? | 62 s | general | – ❌ | 5 | **50 %** |

**Quan sát:**
- ✅ Tool fire 4/5 — phần regex intent classifier hoạt động tốt với câu có mã rõ ràng (lot code, "offline", "top lỗi", "xu hướng").
- ❌ **Q5 thất bại điển hình**: "Lô của tôi sắp xong chưa?" → intent `general`, không tool. Hệ thống nên **hỏi lại** (clarifying question) thay vì rơi vào `MISSING_ORDER_CODE` lặng lẽ.
- Q2 / Q4 chỉ 57% → tool fire OK nhưng narrative chuyển từ JSON sang câu trả lời còn yếu (nghi không format được số liệu rõ ràng).

### 3.3. P3 — Kỹ sư QA / Quy trình — TB **79.8 %**, latency TB **152 s**

| # | Câu hỏi | Latency | Intent | Tool | Cit | Score |
|---|---|---|---|---|---|---|
| 1 | **Hướng dẫn cài điểm đo cho sản phẩm** *(benchmark)* | 151 s | how_to | – | 5 | **83 %** |
| 2 | Cách tạo sản phẩm mới và liên kết với lệnh sản xuất? | 148 s | how_to | – | 5 | **83 %** |
| 3 | Các tham số cấu hình của một measurement point gồm những gì? | 135 s | general | – | 5 | **83 %** |
| 4 | Cho ví dụ cấu hình một điểm đo dạng vòng tròn (ring) với fiducial | 150 s | general | – | 5 | **67 %** |
| 5 | Cách phân tích Pareto cho NG theo điểm đo trong tháng? | 177 s | how_to | – | 5 | **83 %** |
| 6 | SPC trong hệ thống dùng công thức nào để tính UCL/LCL? | TIMEOUT | – | – | – | – |

**Quan sát:**
- Câu benchmark (Q1) **83%** — có đường dẫn navigation và bước nhưng thiếu (a) ví dụ thực, (b) advanced recommendations. Cần đọc nội dung JSON để xác nhận, NHƯNG dựa trên rubric đã thoả 5/6 ngoại trừ `fastEnough` (151 s).
- Q4 chỉ 67% — câu yêu cầu **ví dụ cụ thể** → KB không có example concrete cho ring + fiducial → nghi model bịa hoặc trả lời chung chung.
- Latency P3 cao gần gấp 2× P1/P2 do (a) câu hỏi technical dài hơn, (b) answer dài hơn (model phải synthesize 5 chunks).

### 3.4. P4 / P5 / P6 — **CHƯA CHẠY**

Ước tính nếu chạy đến hết: ~15 câu × ~120 s = **30 phút** thêm. Khuyến nghị tách batch và parallelize để rút ngắn xuống 10 phút (xem §6 P0).

---

## 4. Gap matrix (tổng hợp 15 câu + audit cũ)

| Lớp gap | Mô tả | Bằng chứng |
|---|---|---|
| **G1. KB content** | Domain layer chỉ có 5 file AOI. Không có how-to cho Products / Measurement Points / SPC / Pareto / Role-based UX. | 15/898 chunks là `domain`; 139 match "điểm đo" nhưng đa số là router/type code (router-59, type-149, type-236), KHÔNG phải hướng dẫn. |
| **G2. KB ingest pipeline** | Các tài liệu tốt sẵn có (`PRODUCTS_MEASUREMENT_POINTS_*.md`, `AI_ANALYTICS_MODULE_AUDIT.md`, `PRODUCTION_MODULE_FRONTEND_AUDIT.md`) **không được ingest** vào KB. | `ls knowledge/domain/` chỉ có 5 file AOI; không có symlink/copy của các MD trên. |
| **G3. Intent / Tool trigger** | Heuristic regex thiếu fallback. Câu thiếu mã định danh (vd "Lô của tôi") → bỏ qua tool, không hỏi lại. | P2.Q5 score 50%; `intentClassifier.ts` mặc định OFF LLM fallback (`AI_TOOL_LLM_FALLBACK` không set). |
| **G4. Tool → Narrative** | Khi tool trả số liệu, model viết lại còn yếu (P2.Q2 / P2.Q4 chỉ 57%). | Cần system-prompt template có slot `{{tool_result}}` rõ ràng. |
| **G5. Latency** | 60–180 s/câu trên qwen2.5:7b CPU. End-user không chấp nhận. | Đo trực tiếp 15 câu. |
| **G6. Citation noise** | Luôn trả 5 citations bất kể relevance. | Mọi câu `cit=5`; không có similarity threshold. |
| **G7. Role-aware response** | Cùng 1 prompt template cho worker / engineer / manager. Worker cần ngắn + step-by-step + screenshot; engineer cần terse + advanced; manager cần KPI + dashboard link. | UI có truyền `userRole` nhưng prompt không phân nhánh (xem `AILocalChatBubble.tsx`). |
| **G8. Structured response** | Trả văn xuôi tự do; không có schema (NavPath / Steps / Params / Example / Recommendations). | P3.Q4 67% vì thiếu Example block. |
| **G9. UX feedback** | Stream chậm + không có "đang truy xuất N tài liệu...", người dùng tưởng treo. | Latency 60–180s + UI không show citations đang load (xem `AILocalChatBubble.tsx` ~line 400). |
| **G10. Eval automation** | Không có CI nightly đo regression. | Phải chạy thủ công harness. |
| **G11. DB_UNAVAILABLE silent** | Tool trả `noDbResult` nhưng narrative không nói rõ → user tưởng số liệu thật. | P1.Q4 score 57% — fired tool nhưng có thể trả "0 sản phẩm" thay vì "DB tạm không truy cập được". |
| **G12. Audit findings chưa được fix** | `AI_ANALYTICS_MODULE_AUDIT.md` 5 CRITICAL + 8 HIGH (N+1 query, fake Cpk, hardcoded threshold, NULL defect masked) → ảnh hưởng độ chính xác AI Analytics → AI Assistant trả số sai. | Audit cũ. |

---

## 5. Đánh giá benchmark "Hướng dẫn cài điểm đo cho sản phẩm"

| Tiêu chí | Mong đợi | Thực tế | Điểm |
|---|---|---|---|
| Đường dẫn navigation | Menu → Sản phẩm → chọn product → tab "Điểm đo" → "+ Thêm" | Có (rubric `hasNavPath` ✓) | 1 |
| Bước tạo sản phẩm | 4–5 bước rõ | Có (`hasSteps` ✓) | 1 |
| Bước tạo điểm đo | 5–7 bước rõ | Có | 1 |
| Bảng tham số (pointCode, x, y, type, threshold...) | Liệt kê đầy đủ | **Một phần** — KB chỉ có schema, không bảng meaning | 0.5 |
| Ví dụ thực (JSON / form filled) | Có | **Thiếu** — Q4 follow-up chỉ 67% xác nhận | 0 |
| Khuyến nghị nâng cao (SPC, Pareto link) | Có | Một phần | 0.5 |
| Latency ≤ 8 s | Bắt buộc | 151 s ❌ | 0 |
| **TỔNG** | 7 | **4 / 7 ≈ 57%** *(thực tế rubric chấm 83% vì rubric không kiểm tra Example/Recommendation/Param-table)* | |

→ **Rubric hiện tại lỏng**. Nên thêm 3 tiêu chí: `hasParamTable`, `hasConcreteExample`, `hasAdvancedRecommendation`.

---

## 6. Kế hoạch nâng cấp

### P0 — Blocker (1–2 tuần) — bắt buộc trước khi giao cho user

1. **Ingest tài liệu domain vào KB**
   - Copy / symlink vào `knowledge/domain/`:
     - `PRODUCTS_MEASUREMENT_POINTS_P1_DELIVERABLE.md`
     - `PRODUCTS_MEASUREMENT_POINTS_PHASE4_AUDIT.md`
     - `PRODUCTS_MEASUREMENT_POINTS_UPGRADE_REPORT.md`
     - `PRODUCTS_P0_COMPLETION_REPORT.md`
     - `AI_ANALYTICS_MODULE_AUDIT.md`
     - `PRODUCTION_MODULE_FRONTEND_AUDIT.md`
   - Bổ sung **how-to mới** cho 6 chủ đề: SOP xử lý NG, đổi ca, đổi mật khẩu, Pareto NG, SPC UCL/LCL, Quản lý lô.
   - Rebuild: `pnpm kb:chunk && pnpm kb:embed && pnpm kb:graph`.
   - Mục tiêu: domain chunks từ 15 → ≥ 100.

2. **Giảm latency xuống ≤ 8 s**
   - **Option A:** Đổi sang `qwen2.5:3b-instruct` cho P1/P2 (worker/basic role) — giảm ~3×.
   - **Option B:** Streaming first-token < 1 s + show citations ngay khi retrieve xong (pre-LLM).
   - **Option C:** Cache top-N FAQ (P1 5 câu chuẩn) trong Redis / file cache.
   - **Option D:** GPU acceleration cho Ollama (cuda) nếu hạ tầng cho phép.

3. **Sửa intent classifier — không bao giờ "im lặng bỏ tool"**
   - Khi `MISSING_ORDER_CODE` / `NO_TRIGGER_MATCH` mà câu có pattern "lô của tôi / máy của tôi / hôm nay" → trả về **clarifying question**: "Bạn muốn tra cứu lô nào? Nhập mã lô (LXXXXXXXX-NNN)."
   - Bật `AI_TOOL_LLM_FALLBACK=1` cho các câu intent ambiguous.

4. **Structured response schema**
   ```json
   {
     "navigationPath": "Menu > Sản phẩm > {Tên} > tab Điểm đo",
     "steps": ["1. ...", "2. ..."],
     "parameters": [{"name": "pointCode", "type": "string", "required": true, "desc": "..."}],
     "example": "...",
     "recommendations": ["..."],
     "citations": [...]
   }
   ```
   - Render UI theo schema (giống Notion DB) → user dễ đọc, đo lường được.

### P1 — Nâng chất (2–4 tuần)

5. **Role-aware prompt templates**
   - `worker_basic`: bắt buộc step-by-step + screenshot link + ngôn ngữ đơn giản.
   - `engineer_technical`: terse, có code/JSON, link API reference.
   - `manager`: KPI block + link dashboard + so sánh tuần/tháng.
6. **Fix tool→narrative**
   - Template: "Theo dữ liệu hiện tại ({{timestamp}}), {{tool_summary}}. Chi tiết: {{table}}. Nguồn: tool `{{tool_name}}`."
   - Khi `note=DB_UNAVAILABLE`: rõ ràng "⚠️ Cơ sở dữ liệu tạm không truy cập được, hiển thị mẫu."
7. **Citation similarity threshold**
   - Filter < 0.55 cosine; nếu < 3 citation → cảnh báo "Tôi không chắc chắn, hãy xem các tài liệu sau."
8. **Rubric & eval automation**
   - Mở rộng rubric 10 tiêu chí (thêm `hasParamTable`, `hasConcreteExample`, `hasAdvancedRecommendation`).
   - Chạy nightly trên 30 câu, post score lên Slack/MS Teams.

### P2 — Tối ưu lâu dài (4–8 tuần)

9. **KB pipeline auto** — watch `knowledge/domain/*.md` + i18n keys + feature flags → re-ingest.
10. **Telemetry per-query** — log {persona, latency, intent, tool, score, citations} vào table `ai_query_log` để theo dõi xu hướng.
11. **Active learning** — user thumbs-up/down → đẩy câu xấu vào dataset; dùng AI Active Learning router đã có sẵn để fine-tune prompt.
12. **Fix audit issues `AI_ANALYTICS_MODULE_AUDIT.md`** (N+1, fake Cpk, hardcoded threshold) — vì AI Assistant đọc số từ AI Analytics.

---

## 7. Phụ lục

### 7.1. Lệnh re-run eval đầy đủ
```powershell
# Khởi động dev server
pnpm dev

# Đợi server ready rồi chạy harness
node scripts/persona-eval-ai-assistant.mjs http://localhost:3000
```
Output: `AI_ASSISTANT_PERSONA_EVAL_RESULTS.json` + `.md` (chỉ ghi sau khi hoàn tất).

### 7.2. Lệnh check KB
```powershell
# Đếm chunks per layer
Get-Content knowledge/chunks.jsonl | ForEach-Object { ($_ | ConvertFrom-Json).sourceType } | Group-Object | Sort-Object Count -Descending
```

### 7.3. File liên quan
- Harness: [scripts/persona-eval-ai-assistant.mjs](scripts/persona-eval-ai-assistant.mjs)
- Tools: [server/services/aiLocalTools/handlers.ts](server/services/aiLocalTools/handlers.ts)
- Intent: [server/services/aiLocalTools/intentClassifier.ts](server/services/aiLocalTools/intentClassifier.ts)
- UI: [client/src/components/AILocalChatBubble.tsx](client/src/components/AILocalChatBubble.tsx)
- KB chunks: `knowledge/chunks.jsonl` (898 records)
- Audit cũ: [AI_ANALYTICS_MODULE_AUDIT.md](AI_ANALYTICS_MODULE_AUDIT.md), [PRODUCTION_MODULE_FRONTEND_AUDIT.md](PRODUCTION_MODULE_FRONTEND_AUDIT.md)

---

**Kết luận:** Hệ thống AI Assistant đã có **nền tảng tốt** (KB pipeline, 5 read-only tools, role pass-through), nhưng **chưa hữu ích thực tế** với end-user vì 3 vấn đề lớn: (1) **KB thiếu nội dung how-to/domain**, (2) **latency không chấp nhận được**, (3) **không xử lý được câu thiếu ngữ cảnh** ("Lô của tôi"). Sau khi hoàn tất 4 hạng mục P0, dự kiến điểm trung bình tăng từ **72.8% → ≥ 90%** và latency từ **102s → ≤ 8s**.
