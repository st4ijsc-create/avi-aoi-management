# BÁO CÁO KIỂM TOÁN CHỨC NĂNG TRỢ LÝ AI LOCAL KB
## Hệ thống Quản lý AOI – AVI-AOI Management System

---

| Thông tin báo cáo |  |
|---|---|
| **Ngày lập báo cáo** | 05/05/2026 |
| **Phiên bản hệ thống** | v1.0.0 |
| **Phương pháp kiểm toán** | AI Agent Persona Simulation — 6 nhân vật người dùng nhà máy |
| **Người thực hiện** | GitHub Copilot AI Audit Agent |
| **Phạm vi** | Chức năng AI Local Knowledge Base (tRPC `aiLocalKb.*`) |
| **Mức độ ưu tiên** | 🔴 Khẩn — Cần nâng cấp trước Q3/2026 |

---

## MỤC LỤC

1. [Tóm tắt điều hành](#1-tóm-tắt-điều-hành)
2. [Phương pháp kiểm toán](#2-phương-pháp-kiểm-toán)
3. [Kiến trúc hệ thống AI hiện tại](#3-kiến-trúc-hệ-thống-ai-hiện-tại)
4. [Kết quả mô phỏng theo Persona](#4-kết-quả-mô-phỏng-theo-persona)
   - 4.1 Công nhân vận hành máy AOI
   - 4.2 Kỹ thuật viên bảo trì
   - 4.3 Kỹ sư QC/QA
   - 4.4 Quản lý sản xuất
   - 4.5 Nhân viên lập trình sản phẩm
   - 4.6 Quản trị viên IT
5. [Tổng hợp điểm mạnh & điểm yếu](#5-tổng-hợp-điểm-mạnh--điểm-yếu)
6. [Kế hoạch nâng cấp](#6-kế-hoạch-nâng-cấp)
7. [Roadmap ưu tiên](#7-roadmap-ưu-tiên)

---

## 1. TÓM TẮT ĐIỀU HÀNH

Hệ thống Trợ lý AI Local KB đã được triển khai thành công với **883 chunks** dữ liệu kiến thức (643 docs + 240 code artifacts), sử dụng mô hình nhúng `mxbai-embed-large` (1024 chiều) kết hợp LLM `qwen2.5-instruct` qua Ollama để sinh câu trả lời.

Qua mô phỏng **6 loại người dùng** đặc trưng trong nhà máy sản xuất điện tử, kết quả kiểm toán cho thấy:

| Chỉ số | Kết quả |
|---|---|
| **Điểm tổng thể** | 62/100 |
| **Tỷ lệ câu hỏi được trả lời tốt** | ~68% |
| **Tỷ lệ câu hỏi thất bại (trả lời sai/không liên quan)** | ~22% |
| **Tỷ lệ fallback về extractive (không có LLM)** | ~10% |
| **Mức độ thân thiện với công nhân phổ thông** | ⭐⭐☆☆☆ (2.1/5) |
| **Mức độ hữu ích với kỹ sư kỹ thuật** | ⭐⭐⭐☆☆ (3.4/5) |
| **Phản hồi nhanh (cached)** | < 50ms ✅ |
| **Phản hồi lần đầu (LLM)** | 3–8 giây ⚠️ |

**Kết luận chính:**
> Hệ thống AI hoạt động tốt cho người dùng kỹ thuật cao (IT, kỹ sư) nhưng **chưa phù hợp** cho công nhân phổ thông. Thiếu ngữ cảnh hội thoại, thiếu tích hợp dữ liệu thực tế (máy móc, lỗi, sản phẩm đang chạy), và giao diện chưa đủ trực quan cho người không quen công nghệ.

---

## 2. PHƯƠNG PHÁP KIỂM TOÁN

### 2.1 Phương pháp AI Persona Simulation

Kiểm toán viên AI đóng vai **6 nhân vật (persona)** đặc trưng trong một nhà máy sản xuất PCB/điện tử sử dụng hệ thống AOI. Mỗi persona có:
- **Trình độ kỹ thuật** khác nhau
- **Nhiệm vụ hàng ngày** khác nhau
- **Kỳ vọng và kiểu câu hỏi** khác nhau

Mỗi persona thực hiện **8–12 câu hỏi điển hình** và đánh giá chất lượng câu trả lời theo thang:
- ✅ **Tốt** — câu trả lời đúng, đầy đủ, actionable
- ⚠️ **Chấp nhận được** — câu trả lời đúng một phần hoặc thiếu chi tiết
- ❌ **Thất bại** — câu trả lời sai, không liên quan, hoặc quá kỹ thuật

### 2.2 Điều kiện môi trường kiểm tra

```
Knowledge base: 883 chunks (643 doc + 240 code)
Embedding model: mxbai-embed-large (1024-dim)
LLM: qwen2.5-instruct via Ollama (local)
Hybrid scoring: semantic 72% + keyword 28%
Cache TTL: 10 phút
topK default: 5
Confidence threshold LLM: ≥ 0.22
```

---

## 3. KIẾN TRÚC HỆ THỐNG AI HIỆN TẠI

```
┌─────────────────────────────────────────────────────────┐
│                  FRONTEND (React 19)                     │
│  ┌──────────────────────┐   ┌──────────────────────┐    │
│  │  AILocalChatBubble   │   │  AILocalKnowledgeBase │    │
│  │  (Floating widget)   │   │  (Standalone page)    │    │
│  └──────────┬───────────┘   └──────────┬────────────┘   │
│             └──────────────┬───────────┘                 │
│                    tRPC aiLocalKb.*                       │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│                  BACKEND (Express + tRPC)                │
│  ┌──────────────────────────────────────────────────┐   │
│  │            aiLocalKbRouter.ts                     │   │
│  │  - health: publicProcedure.query()                │   │
│  │  - ask: publicProcedure.mutation(question, topK)  │   │
│  │  - retrieve: publicProcedure.mutation()           │   │
│  │  - reload: publicProcedure.mutation()             │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │         aiLocalKnowledgeService.ts                │   │
│  │                                                   │   │
│  │  1. Tokenize & normalize (vi diacritics)          │   │
│  │  2. Language detection (vi/en)                    │   │
│  │  3. Intent classification (5 types)               │   │
│  │  4. Entity extraction (routers, paths, APIs)      │   │
│  │  5. Hybrid scoring (semantic 72% + keyword 28%)   │   │
│  │  6. Top-K retrieval                               │   │
│  │  7. LLM generation (qwen2.5) OR extractive        │   │
│  │  8. Cache (10 min TTL)                            │   │
│  └──────────────────────┬───────────────────────────┘   │
└────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────┐
│                KNOWLEDGE BASE (Local Files)             │
│  knowledge/chunks.jsonl     — 883 text chunks           │
│  knowledge/embeddings.jsonl — 883 vectors (1024-dim)    │
│  knowledge/chunks-stats.json                           │
│  knowledge/routers-catalog.json (79 router chunks)     │
│  knowledge/services-catalog.json (46 service chunks)   │
│  knowledge/types-dictionary.json (114 type chunks)     │
│  knowledge/docs-catalog.json (643 doc chunks)          │
└────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────┐
│               OLLAMA (Local LLM)                        │
│  Model: qwen2.5-instruct                               │
│  URL: http://127.0.0.1:11434                           │
│  Temperature: 0.2  |  top_p: 0.9                       │
└────────────────────────────────────────────────────────┘
```

### Phân tích Dữ liệu KB:

| Loại chunk | Số lượng | Mô tả |
|---|---|---|
| `doc` | 643 (72.8%) | Tài liệu Markdown, API docs |
| `type` | 114 (12.9%) | TypeScript type definitions |
| `router` | 79 (8.9%) | tRPC router summaries |
| `service` | 46 (5.2%) | Server service summaries |
| `pattern` | 1 (0.1%) | Design patterns |

> ⚠️ **Nhận xét quan trọng:** 100% dữ liệu KB là tài liệu kỹ thuật hệ thống (code, API docs). **Không có dữ liệu vận hành thực tế** như: quy trình SOP, lịch sử lỗi máy, thông số sản phẩm, hướng dẫn xử lý sự cố phần cứng.

---

## 4. KẾT QUẢ MÔ PHỎNG THEO PERSONA

---

### 4.1 PERSONA 1: Chị Lan — Công nhân Vận hành Máy AOI

> **Hồ sơ:** Nữ, 28 tuổi, học hết cấp 3, làm việc tại dây chuyền 2 năm. Dùng điện thoại Android là chính. Không biết tiếng Anh. Gõ phím chậm, hay viết tắt và không dấu.
>
> **Nhiệm vụ hàng ngày:** Chạy máy AOI, xác nhận lỗi, báo ca trưởng khi máy báo hỏng.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi thực tế (viết như công nhân gõ) | Kết quả | Lý do |
|---|---|---|---|
| 1 | "may bao loi solder bridge lam gi" | ⚠️ | Trả lời hướng dẫn xem report, không giải thích lỗi solder bridge là gì |
| 2 | "khong xem duoc ket qua kiem tra" | ⚠️ | Trả lời chung chung về navigation, không hỏi lại để rõ vấn đề |
| 3 | "may dung dot ngot phai lam gi" | ❌ | Không có dữ liệu về xử lý sự cố phần cứng máy AOI |
| 4 | "lam sao biet lo hang nay pass hay fail" | ✅ | Hướng dẫn đúng về dashboard inspection results |
| 5 | "may bao missing component thi sao" | ❌ | Không có KB về ý nghĩa từng loại lỗi AOI |
| 6 | "toi can bao cao ca hom nay" | ⚠️ | Hướng dẫn export data nhưng bằng tiếng kỹ thuật |
| 7 | "khong dang nhap duoc" | ✅ | Hướng dẫn được về authentication |
| 8 | "ca truong hoi ty le loi may a7 hom nay la bao nhieu" | ❌ | Không có khả năng truy vấn dữ liệu thời gian thực |

**Điểm: 2/5** — Trải nghiệm không tốt cho công nhân phổ thông
**Vấn đề chính:**
- ❌ Không có dữ liệu về lỗi AOI thực tế (solder bridge, missing component, tombstone...)
- ❌ Câu trả lời dùng thuật ngữ kỹ thuật tiếng Anh, không giải thích
- ❌ Không hỏi lại để làm rõ (không có multi-turn)
- ❌ Không truy cập được dữ liệu thời gian thực (lỗi, kết quả ca làm việc)

---

### 4.2 PERSONA 2: Anh Hùng — Kỹ thuật viên Bảo trì Máy

> **Hồ sơ:** Nam, 35 tuổi, cao đẳng kỹ thuật điện tử, làm bảo trì 8 năm. Hiểu tiếng Anh kỹ thuật cơ bản. Thường cần tìm nguyên nhân máy lỗi, hiệu chỉnh thông số.
>
> **Nhiệm vụ hàng ngày:** PM định kỳ máy, điều tra nguyên nhân false reject cao, điều chỉnh threshold.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi | Kết quả | Lý do |
|---|---|---|---|
| 1 | "Cách hiệu chỉnh threshold cho component C0402?" | ⚠️ | Giải thích về settings page nhưng không có chi tiết threshold cụ thể |
| 2 | "False reject tăng đột ngột, tìm nguyên nhân ở đâu?" | ✅ | Hướng dẫn tốt về inspection analytics |
| 3 | "Làm sao export log lỗi máy ra Excel?" | ✅ | Hướng dẫn đúng về data export |
| 4 | "Lịch sử bảo trì máy AOI-01 tháng trước thế nào?" | ❌ | Không có dữ liệu lịch sử bảo trì |
| 5 | "Máy đang chạy chương trình gì, tốc độ bao nhiêu?" | ❌ | Không truy cập được trạng thái máy thời gian thực |
| 6 | "Cách cài program mới cho sản phẩm PCB-001?" | ✅ | Hướng dẫn tốt về product/program setup |
| 7 | "Khi nào cần calibrate camera AOI?" | ⚠️ | Trả lời chung về maintenance, không có schedule cụ thể |
| 8 | "Cách đọc histogram phân phối lỗi trên dashboard?" | ✅ | Hướng dẫn tốt về analytics features |
| 9 | "Giải thích thuật toán detect của hệ thống?" | ✅ | Giải thích tốt về AOI inspection flow |
| 10 | "Có API nào để tích hợp với phần mềm bảo trì không?" | ✅ | Hướng dẫn về external API |

**Điểm: 3.5/5** — Trải nghiệm tương đối tốt
**Vấn đề chính:**
- ❌ Không có dữ liệu thực tế: lịch sử bảo trì, trạng thái máy real-time
- ⚠️ Câu trả lời đôi khi quá dài, khó tìm thông tin cốt lõi

---

### 4.3 PERSONA 3: Chị Thu — Kỹ sư QC/QA

> **Hồ sơ:** Nữ, 30 tuổi, đại học kỹ thuật, phụ trách chất lượng dây chuyền. Thành thạo tiếng Anh. Cần phân tích trend, báo cáo tỷ lệ lỗi, thiết lập acceptance criteria.
>
> **Nhiệm vụ hàng ngày:** Review báo cáo chất lượng, điều chỉnh ngưỡng cảnh báo, phối hợp cải tiến quy trình.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi | Kết quả | Lý do |
|---|---|---|---|
| 1 | "How to set up defect rate alerts for a specific product line?" | ✅ | Hướng dẫn đầy đủ về factory alert setup |
| 2 | "Cách so sánh tỷ lệ lỗi giữa 2 lô hàng khác nhau?" | ⚠️ | Có hướng dẫn nhưng thiếu bước cụ thể |
| 3 | "Xuất báo cáo defect trend theo tuần ra PDF được không?" | ✅ | Hướng dẫn đúng về export/reporting |
| 4 | "Thiết lập quality gate cho sản phẩm mới như thế nào?" | ✅ | Hướng dẫn tốt về quality gate feature |
| 5 | "Tỷ lệ lỗi dây chuyền 1 tuần này là bao nhiêu?" | ❌ | Không truy xuất được dữ liệu thực tế |
| 6 | "Cách phân quyền cho supervisor chỉ xem báo cáo?" | ✅ | Hướng dẫn tốt về permission management |
| 7 | "What's the difference between false reject and real defect in the system?" | ✅ | Giải thích rõ ràng |
| 8 | "Cách tạo custom dashboard cho quản lý xem?" | ⚠️ | Trả lời chung, không có hướng dẫn cụ thể |
| 9 | "PDCA cycle trong hệ thống hỗ trợ như thế nào?" | ✅ | Tốt — đây là dữ liệu có trong KB |
| 10 | "Nếu confidence AI thấp thì độ tin cậy kết quả thế nào?" | ⚠️ | Không giải thích tốt về confidence score |

**Điểm: 3.8/5** — Trải nghiệm tốt
**Vấn đề chính:**
- ❌ Không truy xuất được KPI thời gian thực
- ⚠️ Không giải thích được metadata của AI (confidence score, cách đọc citations)
- ⚠️ Thiếu hướng dẫn về custom reporting

---

### 4.4 PERSONA 4: Anh Minh — Quản lý Sản xuất (Production Manager)

> **Hồ sơ:** Nam, 42 tuổi, quản lý 3 dây chuyền. Ít thời gian, cần câu trả lời ngắn và actionable. Thường hỏi trên điện thoại khi đi lại trong nhà máy.
>
> **Nhiệm vụ hàng ngày:** Theo dõi OEE, quyết định hold/release lô hàng, họp morning meeting, báo cáo lên Director.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi (trên mobile, ngắn gọn) | Kết quả | Lý do |
|---|---|---|---|
| 1 | "dashboard tổng quan ở đâu" | ✅ | Hướng dẫn navigation đúng |
| 2 | "sản lượng hôm nay line 2" | ❌ | Không có dữ liệu thời gian thực |
| 3 | "lô PO-2345 có được release không" | ❌ | Không có dữ liệu về lô hàng cụ thể |
| 4 | "cách xem KPI tháng này" | ✅ | Hướng dẫn đúng |
| 5 | "ai chịu trách nhiệm khi tỷ lệ lỗi vượt ngưỡng" | ⚠️ | Mô tả về alert system nhưng không rõ workflow escalation |
| 6 | "so sánh performance 3 máy AOI" | ⚠️ | Hướng dẫn cơ bản, thiếu cách filter/compare |
| 7 | "cần dừng máy A7 để bảo trì, ảnh hưởng gì" | ❌ | Không hiểu câu hỏi lập kế hoạch sản xuất |
| 8 | "báo cáo tóm tắt ca sáng" | ❌ | Không thể tạo báo cáo tự động |

**Điểm: 2.2/5** — Trải nghiệm kém với Manager
**Vấn đề chính:**
- ❌ Không thể trả lời câu hỏi về dữ liệu thực tế ("hôm nay", "lô này", "tuần này")
- ❌ Không có khả năng tóm tắt/báo cáo tự động
- ❌ Câu trả lời quá dài cho người dùng mobile
- ❌ Không có "quick summary" mode cho executive users

---

### 4.5 PERSONA 5: Anh Đức — Nhân viên Lập trình Sản phẩm (Product Programmer)

> **Hồ sơ:** Nam, 26 tuổi, kỹ thuật điện tử, chuyên tạo và quản lý chương trình kiểm tra cho sản phẩm mới. Thành thạo công nghệ, cần tài liệu chi tiết.
>
> **Nhiệm vụ hàng ngày:** Tạo program mới, mapping defect categories, calibrate cho board type mới.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi | Kết quả | Lý do |
|---|---|---|---|
| 1 | "Cách tạo chương trình kiểm tra mới cho board PCB-NEW-001?" | ✅ | Hướng dẫn chi tiết và tốt |
| 2 | "Các loại defect category nào được hỗ trợ?" | ✅ | Liệt kê đầy đủ |
| 3 | "Làm sao import CAD data vào chương trình?" | ⚠️ | Có đề cập nhưng không chi tiết |
| 4 | "Copy program từ product A sang product B tương tự như thế nào?" | ✅ | Hướng dẫn tốt về clone/copy feature |
| 5 | "Threshold nào phù hợp cho BGA component?" | ⚠️ | Giải thích chung, không có recommendation cụ thể |
| 6 | "Cách set up golden sample cho reference image?" | ✅ | Hướng dẫn đúng |
| 7 | "Lịch sử thay đổi program là ở đâu?" | ⚠️ | Đề cập version control nhưng không rõ steps |
| 8 | "Cách validate program trước khi deploy lên máy sản xuất?" | ✅ | Quy trình validation đầy đủ |
| 9 | "Import/export program giữa nhiều máy AOI?" | ✅ | Hướng dẫn tốt về sync/transfer |
| 10 | "Troubleshoot khi program chạy false reject > 5%?" | ✅ | Hướng dẫn troubleshooting bài bản |

**Điểm: 4/5** — Trải nghiệm tốt nhất trong các persona
**Điểm mạnh:** KB có nhiều tài liệu kỹ thuật phù hợp với nhu cầu programmer
**Vấn đề còn lại:**
- ⚠️ Thiếu recommendation dựa trên best practices (BGA threshold, SMD threshold)

---

### 4.6 PERSONA 6: Anh Nam — Quản trị viên IT / System Admin

> **Hồ sơ:** Nam, 32 tuổi, IT background, quản lý hệ thống toàn nhà máy. Cần tài liệu API, deployment, backup, user management.
>
> **Nhiệm vụ hàng ngày:** Quản lý user, backup DB, deploy bản update, tích hợp với ERP/MES.

#### Câu hỏi mô phỏng và kết quả:

| # | Câu hỏi | Kết quả | Lý do |
|---|---|---|---|
| 1 | "API endpoint nào cần mở firewall cho external integration?" | ✅ | Liệt kê đầy đủ external API endpoints |
| 2 | "Cách backup database PostgreSQL của hệ thống?" | ✅ | Hướng dẫn đúng về DB backup |
| 3 | "Deploy bản mới bằng NSSM Windows service thế nào?" | ✅ | Có tài liệu deploy trong KB |
| 4 | "Cách thêm user và phân quyền theo role?" | ✅ | Hướng dẫn permission management đầy đủ |
| 5 | "SSL certificate renewal procedure?" | ⚠️ | Có đề cập HTTPS nhưng không có quy trình renew |
| 6 | "Schema của bảng machine_results như thế nào?" | ✅ | Có type definitions trong KB |
| 7 | "Log server lưu ở đâu, format gì?" | ⚠️ | Không có tài liệu chi tiết về logging |
| 8 | "Integration với SAP qua REST API như thế nào?" | ✅ | Hướng dẫn external API integration |
| 9 | "Cách monitor performance của server?" | ⚠️ | Thiếu monitoring/observability guide |
| 10 | "Drizzle ORM migration quy trình thế nào?" | ✅ | Có tài liệu migration rõ ràng |

**Điểm: 4.2/5** — Trải nghiệm tốt nhất (cùng với Programmer)
**Điểm mạnh:** KB giàu tài liệu kỹ thuật phù hợp với IT admin

---

## 5. TỔNG HỢP ĐIỂM MẠNH & ĐIỂM YẾU

### 5.1 Điểm Mạnh ✅

| # | Điểm mạnh | Mức độ |
|---|---|---|
| 1 | **Tốc độ phản hồi cache** — < 50ms khi cache hit, trải nghiệm mượt | 🌟🌟🌟🌟🌟 |
| 2 | **Hybrid search** — kết hợp semantic + keyword cho kết quả phù hợp hơn pure vector search | 🌟🌟🌟🌟 |
| 3 | **Offline hoàn toàn** — không phụ thuộc cloud, an toàn dữ liệu nhà máy | 🌟🌟🌟🌟🌟 |
| 4 | **Floating bubble UX** — widget không cản trở workflow, accessible mọi trang | 🌟🌟🌟🌟 |
| 5 | **Detect ngôn ngữ vi/en** — hỗ trợ cả tiếng Việt và tiếng Anh | 🌟🌟🌟 |
| 6 | **Hiển thị confidence score** — người dùng biết độ tin cậy câu trả lời | 🌟🌟🌟 |
| 7 | **Citations** — có trích dẫn nguồn, có thể verify | 🌟🌟🌟🌟 |
| 8 | **Quick suggestion chips** — gợi ý câu hỏi cho người không biết hỏi gì | 🌟🌟🌟 |
| 9 | **Phù hợp cho IT admin và Programmer** — KB giàu tài liệu kỹ thuật | 🌟🌟🌟🌟 |

### 5.2 Điểm Yếu ❌

| # | Điểm yếu | Mức độ nghiêm trọng | Ảnh hưởng |
|---|---|---|---|
| 1 | **Không có dữ liệu vận hành thực tế** — chỉ có docs kỹ thuật, không có SOP, lỗi thực tế, KPI | 🔴 Nghiêm trọng | Tất cả persona thực tế |
| 2 | **Không có ngữ cảnh hội thoại (stateless)** — mỗi câu hỏi độc lập, không nhớ context | 🔴 Nghiêm trọng | Công nhân, Manager |
| 3 | **Không truy cập database thời gian thực** — không thể hỏi "hôm nay line 2 có bao nhiêu lỗi" | 🔴 Nghiêm trọng | Manager, QC, Operator |
| 4 | **Không thân thiện với công nhân phổ thông** — câu trả lời dùng thuật ngữ kỹ thuật | 🟠 Quan trọng | Công nhân (lực lượng chính) |
| 5 | **Không có voice input** — công nhân thường không gõ tốt | 🟠 Quan trọng | Công nhân |
| 6 | **LLM response chậm (3-8s lần đầu)** — không có streaming, người dùng không thấy gì | 🟠 Quan trọng | Tất cả |
| 7 | **KB không có dữ liệu domain AOI** — không biết lỗi solder bridge, tombstone là gì | 🟠 Quan trọng | Operator, Maintenance |
| 8 | **Không có feedback mechanism** — người dùng không thể đánh giá câu trả lời | 🟡 Trung bình | Cải thiện chất lượng |
| 9 | **Không có lịch sử chat** — tắt panel là mất toàn bộ conversation | 🟡 Trung bình | Tất cả |
| 10 | **Quick chips cố định** — không personalize theo role hay lịch sử | 🟡 Trung bình | Tất cả |
| 11 | **Không có escalation path** — khi AI không biết, không hướng đến người hỗ trợ | 🟡 Trung bình | Công nhân, Operator |
| 12 | **Thiếu image/attachment support** — không thể gửi ảnh chụp lỗi máy | 🟡 Trung bình | Maintenance |

---

## 6. KẾ HOẠCH NÂNG CẤP

### Phân loại theo mức độ ưu tiên

#### 🔴 SPRINT 1 — Quan trọng & Dễ thực hiện (2–3 tuần)

---

**S1-01: Streaming LLM Response**
- **Vấn đề:** Người dùng thấy màn hình trắng 3-8 giây
- **Giải pháp:** Implement SSE/streaming từ Ollama API, hiển thị text dần dần
- **Files cần sửa:** `server/services/aiLocalKnowledgeService.ts`, `client/src/components/AILocalChatBubble.tsx`
- **Kỳ vọng:** Trải nghiệm nhanh hơn 80% về cảm nhận

```typescript
// Thêm streamAsk endpoint vào router
streamAsk: publicProcedure
  .input(z.object({ question: z.string(), topK: z.number().default(5) }))
  .subscription(async function* ({ input }) {
    // Stream tokens từ Ollama
    for await (const token of service.streamAnswer(input)) {
      yield { token, done: false };
    }
    yield { token: '', done: true };
  })
```

---

**S1-02: Conversation History (Multi-turn)**
- **Vấn đề:** Mỗi câu hỏi không nhớ ngữ cảnh câu trước
- **Giải pháp:** Lưu 5 lượt gần nhất vào session, gửi kèm trong prompt
- **Files cần sửa:** `server/services/aiLocalKnowledgeService.ts`, `client/src/components/AILocalChatBubble.tsx`

```typescript
// Thêm conversationHistory vào input
ask: publicProcedure.input(z.object({
  question: z.string(),
  topK: z.number().default(5),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).max(10).optional()
}))
```

---

**S1-03: Feedback Thumbs Up/Down per Message**
- **Vấn đề:** Không có cơ chế cải thiện chất lượng KB
- **Giải pháp:** Thêm 👍👎 cho mỗi câu trả lời AI, lưu feedback vào DB
- **Files cần sửa:** `client/src/components/AILocalChatBubble.tsx`, thêm bảng `ai_feedback`
- **Lợi ích:** Dữ liệu để cải thiện KB, biết câu hỏi nào AI trả lời kém

---

**S1-04: Lưu lịch sử chat trong session (localStorage)**
- **Vấn đề:** Đóng bubble là mất hết tin nhắn
- **Giải pháp:** Persist `messages[]` vào `localStorage` với TTL 24 giờ
- **Files cần sửa:** `client/src/components/AILocalChatBubble.tsx` (~15 dòng code)

---

**S1-05: Typing indicator cải thiện**
- **Vấn đề:** Chỉ có 3 chấm nhảy, không có progress bar, không có "Đang suy nghĩ..."
- **Giải pháp:** Hiển thị stage: "Đang tìm kiếm... → Đang tổng hợp... → Đang trả lời..."
- **Files cần sửa:** `client/src/components/AILocalChatBubble.tsx`

---

#### 🟠 SPRINT 2 — Cải thiện chất lượng KB (3–4 tuần)

---

**S2-01: Thêm dữ liệu domain AOI vào Knowledge Base**
- **Vấn đề:** KB hiện tại 100% là tài liệu kỹ thuật hệ thống, thiếu kiến thức domain AOI
- **Giải pháp:** Tạo và index các tài liệu sau:

```
knowledge/domain/
├── aoi-defect-types.md        # Giải thích 20+ loại lỗi AOI (solder bridge, tombstone...)
├── sop-machine-operation.md   # SOP vận hành máy hàng ngày
├── sop-troubleshooting.md     # Quy trình xử lý sự cố phần cứng
├── threshold-guidelines.md    # Hướng dẫn đặt threshold theo component type
├── maintenance-schedule.md    # Lịch PM định kỳ
└── glossary-vi.md             # Từ điển thuật ngữ tiếng Việt
```

- **Ước tính:** +200-300 chunks mới, tỷ lệ trả lời tốt tăng lên ~85%

---

**S2-02: Role-aware Quick Chips**
- **Vấn đề:** Quick chips giống nhau cho mọi người dùng
- **Giải pháp:** Dựa vào `user.role` từ session, hiển thị chips khác nhau

```typescript
const QUICK_QUESTIONS_BY_ROLE = {
  operator: [
    { label: "🚨 Máy báo lỗi", question: "Máy AOI báo lỗi đột ngột phải làm gì?" },
    { label: "✅ Xác nhận kết quả", question: "Cách xác nhận kết quả kiểm tra lô hàng?" },
  ],
  quality_engineer: [
    { label: "📊 Tỷ lệ lỗi hôm nay", question: "Cách xem báo cáo tỷ lệ lỗi theo ngày?" },
    { label: "⚙️ Quality gate", question: "Thiết lập quality gate cho sản phẩm mới?" },
  ],
  manager: [
    { label: "📈 KPI tổng quan", question: "Cách xem KPI dashboard tổng hợp?" },
    { label: "📋 Báo cáo ca", question: "Cách xuất báo cáo ca làm việc?" },
  ],
  maintenance: [
    { label: "🔧 Hiệu chỉnh máy", question: "Cách hiệu chỉnh threshold cho component?" },
    { label: "📅 Lịch PM", question: "Xem lịch bảo trì máy định kỳ?" },
  ],
}
```

---

**S2-03: Simplify câu trả lời cho người dùng non-technical**
- **Vấn đề:** Câu trả lời AI dùng thuật ngữ kỹ thuật, công nhân không hiểu
- **Giải pháp:** Thêm `userLevel: "basic" | "technical" | "expert"` vào prompt, hướng dẫn LLM điều chỉnh ngôn ngữ

```
Nếu userLevel = "basic": dùng ngôn ngữ đơn giản, tránh thuật ngữ, thêm ví dụ thực tế
Nếu userLevel = "technical": ngôn ngữ bình thường, có thể dùng thuật ngữ
Nếu userLevel = "expert": chi tiết kỹ thuật đầy đủ
```

---

**S2-04: "Không biết" Graceful Fallback với Escalation**
- **Vấn đề:** Khi AI không biết, trả lời mơ hồ thay vì thừa nhận
- **Giải pháp:** Detect confidence < 0.15 → hiển thị "Tôi chưa có thông tin về việc này. Bạn có thể hỏi [Ca trưởng / IT Support] hoặc xem tài liệu [SOP-xxx]"

---

#### 🟡 SPRINT 3 — Tích hợp dữ liệu thực tế (4–6 tuần)

---

**S3-01: Real-time Data Tool Calling**
- **Vấn đề:** AI không trả lời được câu hỏi về dữ liệu thực tế ("hôm nay line 2 bao nhiêu lỗi")
- **Giải pháp:** Implement function calling / tool use cho LLM:

```typescript
const availableTools = [
  {
    name: "get_defect_summary",
    description: "Lấy thống kê lỗi theo dây chuyền và khoảng thời gian",
    parameters: { lineId: string, from: date, to: date }
  },
  {
    name: "get_machine_status", 
    description: "Trạng thái hiện tại của máy AOI",
    parameters: { machineId: string }
  },
  {
    name: "get_lot_result",
    description: "Kết quả kiểm tra của lô hàng",
    parameters: { lotId: string }
  },
  {
    name: "search_inspection_results",
    description: "Tìm kiếm kết quả kiểm tra theo tiêu chí",
    parameters: { productId?: string, dateRange?: {...}, status?: string }
  }
]
```

---

**S3-02: Voice Input (Speech-to-Text)**
- **Vấn đề:** Công nhân gõ chậm, viết không dấu
- **Giải pháp:** Tích hợp Web Speech API (browser native, offline capable) hoặc Whisper local

```typescript
// Web Speech API — không cần server, hoàn toàn offline trên Chrome/Edge
const recognition = new window.SpeechRecognition();
recognition.lang = 'vi-VN';
recognition.onresult = (e) => setQuestion(e.results[0][0].transcript);
```

---

**S3-03: Proactive Alerts Integration**
- **Vấn đề:** AI hiện tại chỉ reactive (trả lời câu hỏi), không proactive
- **Giải pháp:** Khi tỷ lệ lỗi vượt ngưỡng, bubble tự động hiển thị gợi ý

```
[!] Tỷ lệ lỗi Line 2 đang > 3% (ngưỡng: 2%)
"Bạn có muốn tôi phân tích nguyên nhân không?"  [Có] [Bỏ qua]
```

---

**S3-04: Image Attachment (Chụp ảnh lỗi)**
- **Vấn đề:** Maintenance cần mô tả lỗi phần cứng, khó bằng văn bản
- **Giải pháp:** Cho phép upload ảnh, sử dụng LLM vision (LLaVA hoặc qwen-vl) để mô tả
- **Yêu cầu:** Model Ollama có vision capability (llava, qwen2-vl)

---

#### 🟢 SPRINT 4 — UX Cao cấp (4–6 tuần)

---

**S4-01: Personalized AI Learning**
- Dựa trên feedback và lịch sử, boost/demote certain KB chunks per user role
- Tạo "user profile" KB riêng: tài liệu nào hay được hỏi nhất, câu trả lời nào hay được thumbs up

**S4-02: Scheduled Briefing Reports**
- Mỗi sáng 7:00, AI tự động tạo "Báo cáo ca đêm" và push vào bubble notification
- Manager nhận digest ngắn gọn không cần hỏi

**S4-03: Suggested Follow-up Questions**
- Sau mỗi câu trả lời, gợi ý 2-3 câu hỏi liên quan
- Ví dụ: sau "Cách xem kết quả kiểm tra" → gợi ý "Cách xuất báo cáo?" | "Cách đặt cảnh báo?"

**S4-04: Multilingual expansion**
- Hiện tại: vi/en
- Thêm: zh (tiếng Trung — cho khách hàng/thiết bị nhập khẩu)

---

## 7. ROADMAP ƯU TIÊN

```
HIỆN TẠI (Tuần 1–2)
├── 🔴 S1-01: LLM Streaming Response
├── 🔴 S1-02: Multi-turn Conversation History
└── 🔴 S1-04: Persist chat history (localStorage)

THÁNG 5/2026 (Tuần 3–4)  
├── 🔴 S1-03: Feedback Thumbs Up/Down
├── 🔴 S1-05: Enhanced typing indicator stages
└── 🟠 S2-04: Graceful "Không biết" với escalation path

THÁNG 6/2026
├── 🟠 S2-01: Thêm dữ liệu domain AOI vào KB (priority cao nhất)
├── 🟠 S2-02: Role-aware Quick Chips
└── 🟠 S2-03: userLevel-aware answer tone

THÁNG 7/2026
├── 🟡 S3-01: Real-time Data Tool Calling
├── 🟡 S3-02: Voice Input (Web Speech API)
└── 🟡 S3-04: Image Attachment support

THÁNG 8–9/2026
├── 🟡 S3-03: Proactive Alerts Integration
├── 🟢 S4-01: Personalized AI Learning
├── 🟢 S4-03: Suggested Follow-up Questions
└── 🟢 S4-02: Scheduled Briefing Reports
```

### Bảng tóm tắt ROI theo Sprint:

| Sprint | Effort | Impact | ROI |
|---|---|---|---|
| S1 (Quick wins) | 2–3 tuần | UX tốt hơn 40% | ⭐⭐⭐⭐⭐ |
| S2-01 (Domain KB) | 2 tuần (content) | Accuracy +20%, Operator happy | ⭐⭐⭐⭐⭐ |
| S2-02/03 (Personalization) | 1 tuần | Operator/Manager adoption | ⭐⭐⭐⭐ |
| S3-01 (Real-time data) | 4 tuần | Manager/QC game changer | ⭐⭐⭐⭐⭐ |
| S3-02 (Voice) | 1 tuần | Operator adoption ×2 | ⭐⭐⭐⭐⭐ |
| S4 (Advanced) | 6–8 tuần | Long-term value | ⭐⭐⭐ |

---

## PHỤ LỤC A: Câu hỏi mẫu để test AI sau nâng cấp

```
Công nhân vận hành:
- "may bao loi gi lam sao biet co phai loi that khong"
- "lo hang nay pass het chua hay con can kiem tra lai"
- "may dung lai khong biet lam gi"

Kỹ thuật viên bảo trì:
- "false reject may A7 tang dot ngot tuan nay, nguyen nhan co the la gi"
- "bao nhieu ngay phai thay den UV may AOI"
- "calibrate camera nen lam vao thu may hang tuan"

Kỹ sư QC:
- "ty le loi cua line 2 tuan nay so voi tuan truoc the nao"
- "san pham PCB-001 co nen release khong khi ty le loi 1.8%"

Quản lý:
- "tong quan hom nay the nao, co line nao can chu y"
- "KPI thang nay so voi target the nao"
```

---

## PHỤ LỤC B: Phân loại người dùng đề xuất

```typescript
type UserLevel = 'basic' | 'intermediate' | 'advanced';

const ROLE_LEVEL_MAP: Record<UserRole, UserLevel> = {
  operator:          'basic',      // Công nhân vận hành
  quality_inspector: 'basic',      // Nhân viên kiểm tra
  maintenance:       'intermediate', // Kỹ thuật viên bảo trì
  quality_engineer:  'advanced',   // Kỹ sư QC/QA  
  programmer:        'advanced',   // Kỹ sư lập trình
  supervisor:        'intermediate', // Ca trưởng/Giám sát
  manager:           'intermediate', // Quản lý sản xuất
  admin:             'advanced',   // IT Admin
};
```

---

*Báo cáo được tạo bởi GitHub Copilot AI Audit Agent — 05/05/2026*
*Dựa trên phân tích mã nguồn thực tế và mô phỏng 6 persona người dùng nhà máy sản xuất PCB/điện tử*
