# THIẾT KẾ "TECHNICIAN COPILOT" — AI hỗ trợ triệt để: Cài máy · Đặt ngưỡng/thông số · Tìm nguyên nhân lỗi
### Mục tiêu: AI phân tích đầy đủ → trình MỘT khuyến nghị quyết-định-sẵn → kỹ thuật chỉ **Quyết định & Đồng ý**
**Ngày:** 2026-06-28 · **Trạng thái:** ⏳ Thiết kế — chờ phê duyệt trước khi code

> Nối tiếp [doc 05 minimal-effort UX](./05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md). Nguyên tắc: với 3 việc lõi của kỹ thuật, AI làm hết phần *phân tích/tính toán/chẩn đoán*, đưa ra **1 khuyến nghị có sẵn giá trị + lý do + before/after**, kỹ thuật chỉ **duyệt** (mọi ghi qua HITL propose→confirm; thiếu dữ liệu → nói rõ, không bịa).

---

## 0. Hạ tầng đã có (xây LÊN TRÊN, không làm lại)

| Khối | Đã có | File |
|---|---|---|
| Gợi ý ngưỡng thống kê | `suggestThresholds` (percentile + parametric + Bayesian shrinkage → LSL/USL/target) | `server/utils/thresholdSuggestion.ts`, `thresholdSuggestionRouter` |
| Duyệt ngưỡng | `thresholdApprovalRouter` | router |
| Cpk / năng lực quá trình | `aiSpcCpk`, `aiInspectionAnalytics` | services |
| Write-tools kỹ thuật (HITL) | adjust_ng_threshold · configure_inspection_param · create_ng_threshold · update_product_quality_target | `aiLocalTools/writeHandlers/engineering.ts` |
| Đồ thị nhân-quả | `aiCausalGraph` (machine↔defect↔cause↔action, hybridDefectContext) | service + `knowledge/causal-graph.json` |
| GraphRAG + reranker | `aiLocalKnowledgeService` + `aiReranker` | services |
| RCA | `rootCauseRouter`, `aiBatchRcaScheduler`, `downtimeDetectionService.analyzeDowntimeRootCause`, watcher | services |
| Vision lỗi | `aiVisionLanguage`, `aiAdvancedVision` (mô tả + ROI) | services |
| Setup máy | `MachineOnboardingWizard` (Step1 Info → Step5 Verify) | `client/src/pages/MachineOnboardingWizard.tsx` |
| Bề mặt "duyệt 1 chạm" | **AI Action Inbox** + HITL confirm card | đã xây (doc 05) |

**Kết luận:** 3 luồng dưới đây = **lớp điều phối** gom các khối trên thành "khuyến nghị quyết-định-sẵn", + nút Đồng ý đẩy vào HITL/Inbox.

---

# LUỒNG ③ — RCA COPILOT (ưu tiên 1: giá trị cao nhất)

> *Khi có lỗi, AI tự chẩn đoán đầy đủ và đề xuất cách sửa; kỹ thuật chỉ duyệt.*

## ③.1 Kích hoạt (AI tự chạy — push)
RCA tự chạy khi: NG-burst (đã có trigger), SPC-critical, anomaly vượt ngưỡng, hoặc kỹ thuật bấm **"Chẩn đoán"** trên một máy/lỗi. (Watcher + auto-proposer đã có sẵn đường event.)

## ③.2 Pipeline chẩn đoán (service mới `aiRcaCopilot.ts`)
```
1) THU THẬP BẰNG CHỨNG (song song, đều từ service đã có):
   • Pareto lỗi NG gần đây (paretoByDefectType) theo máy/điểm
   • SPC: điểm out-of-control + Cpk (aiSpcCpk)
   • Anomaly score + ảnh nghi ngờ → mô tả lỗi (aiVisionLanguage)
   • Tham số máy hiện tại + thay đổi cấu hình gần đây (audit)
   • Sự cố tương tự trong quá khứ (GraphRAG: RCA cũ + SOP, có reranker)
2) ĐỒ THỊ NHÂN-QUẢ: defect → ứng viên nguyên nhân → hành động khắc phục
   (aiCausalGraph.hybridDefectContext: vector + graph)
3) TỔNG HỢP (deep model Qwen3-30B, task="rca", GBNF JSON):
   → hypotheses[] xếp hạng: { cause, confidence, evidence[], recommendedFix }
   → mỗi fix gắn loại: WRITE (map tới write-tool) | MANUAL (việc tay) | INVESTIGATE
4) GHI: root_cause_analysis + 1 InboxItem type="rca"
```

## ③.3 Thẻ "Chẩn đoán RCA" (quyết-định-sẵn)
```
┌── 🔍 Chẩn đoán: Máy 5 — cụm lỗi "chân chì" (NG 42%) ────────────┐
│ Nguyên nhân khả dĩ #1 (tin cậy 86%): Lượng kem hàn dư             │
│  Bằng chứng: Pareto chân-chì↑3×; Cpk 0.7 (<1.0); 12 ảnh ROI       │
│   cho thấy cầu chì; sự cố tương tự 2026-04 cùng nguyên nhân.      │
│  → Đề xuất sửa: giảm khẩu độ stencil / chỉnh ngưỡng NG 5%→4%      │
│     [✅ Đồng ý áp dụng]  [Xem chi tiết]  [Không đúng → #2]        │
│ #2 (61%): Lệch đặt linh kiện · #3 (40%): Nhiệt reflow             │
└──────────────────────────────────────────────────────────────────┘
```
- **WRITE fix** (vd chỉnh ngưỡng) → "Đồng ý" = `proposeAction(adjust_ng_threshold, argsAI)` → HITL confirm (đã có). 1 chạm.
- **MANUAL fix** (vd vệ sinh stencil) → "Đồng ý" = tạo task/đánh dấu + hiện SOP từng bước (playbook).
- **"Không đúng → #2"**: 1 chạm chuyển sang giả thuyết kế tiếp (vòng phản hồi → học active-learning).

## ③.4 Đầu ra & an toàn
- Xếp hạng + confidence + **bằng chứng trích dẫn được** (không bịa); thiếu dữ liệu → "chưa đủ dữ liệu để chẩn đoán chắc chắn".
- Mọi WRITE qua HITL. Phản hồi đúng/sai → `ai_feedback` (cải thiện causal graph + model).

---

# LUỒNG ② — THRESHOLD/PARAM ADVISOR (ưu tiên 2)

> *AI tính giá trị ngưỡng/thông số đúng từ dữ liệu; kỹ thuật chỉ duyệt.*

## ②.1 Bề mặt: nút "🤖 AI đề xuất" trên mọi màn cấu hình
Đặt cạnh ô nhập, ở: ngưỡng NG (warning/critical), LSL/USL/target điểm đo, thông số kiểm tra (minSampleSize/cooldown), target yield.

## ②.2 Service mới `aiThresholdAdvisor.ts` (gói các estimator đã có)
| Loại cấu hình | Cơ sở tính (đã có) | Khuyến nghị trả về |
|---|---|---|
| LSL/USL/target điểm đo | `suggestThresholds` (percentile+parametric+Bayesian) + Cpk | {LSL, USL, target, Cpk hiện tại→dự kiến, n mẫu, độ tin cậy} |
| Ngưỡng NG warning/critical | phân phối NG-rate gần đây (p-percentile + margin) | {warning%, critical%} trong min/max của tool |
| minSampleSize / cooldown | throughput + phương sai NG | {giá trị + lý do} |
| target/min yield | xu hướng FPY + năng lực | {target%, min%} |

## ②.3 Thẻ khuyến nghị (quyết-định-sẵn)
```
┌── 🤖 AI đề xuất ngưỡng — Điểm đo "Cao độ chân chì" ──────────────┐
│ Hiện tại: LSL 0.10  USL 0.30  (Cpk 0.78 — DƯỚI 1.0, rủi ro)      │
│ Đề xuất:  LSL 0.08  USL 0.34  → Cpk dự kiến 1.42                  │
│  Cơ sở: 1.180 mẫu / 30 ngày · p0.135–p99.865 · shrinkage 0.2     │
│  [✅ Áp dụng]   [Chỉnh tay]   [Vì sao?]                           │
└──────────────────────────────────────────────────────────────────┘
```
- "Áp dụng" → write qua tool/endpoint approval đã có (HITL). 1 chạm.
- "Vì sao?" → giải thích bằng `aiExplainability` (phân phối, Cpk, số mẫu).
- **Degrade:** n mẫu < ngưỡng tối thiểu → "Chưa đủ mẫu (cần ≥N), tạm dùng template/đề xuất thận trọng".

## ②.4 Chủ động (tùy chọn)
Cron/Anomaly thấy Cpk < 1.0 hoặc NG-rate trôi → tự sinh thẻ đề xuất vào **Inbox** (không chờ kỹ thuật mở màn cấu hình). Nối với auto-proposer đã có.

---

# LUỒNG ① — SETUP ADVISOR (ưu tiên 3)

> *AI tự điền sẵn cấu hình máy mới từ máy/sản phẩm tương tự; kỹ thuật review + duyệt.*

## ①.1 Tích hợp vào `MachineOnboardingWizard`
Thêm bước/nút **"🤖 AI điền sẵn cấu hình"** sau Step1 (chọn loại máy + sản phẩm).

## ①.2 Service mới `aiSetupAdvisor.ts`
```
1) TÌM TƯƠNG TỰ: máy/sản phẩm giống nhất (cùng machineType + productModel +
   tập điểm đo) trong hệ thống → "template".
2) LẮP BỘ CẤU HÌNH đề xuất:
   • Điểm đo + loại đo (copy từ template)
   • Ngưỡng: nếu template có dữ liệu → suggestThresholds; nếu không → copy + cờ
     "sẽ tự tinh chỉnh khi đủ dữ liệu" (cron rebuild đã có cho anomaly; tương tự cho ngưỡng)
   • Thông số kiểm tra, mapping trạm, lựa chọn model triển khai (Step4)
3) TRẢ bundle → wizard PRE-FILL mọi field; kỹ thuật chỉ sửa ngoại lệ + Duyệt.
```

## ①.3 Thẻ (quyết-định-sẵn)
```
┌── 🤖 Đề xuất cấu hình cho máy mới "AOI-12" ──────────────────────┐
│ Dựa trên máy tương tự: AOI-07 (cùng loại, SP "Board-X")          │
│ • 14 điểm đo (sao chép)   • 14 cặp ngưỡng (8 từ dữ liệu, 6 copy) │
│ • Thông số kiểm tra, mapping trạm Line-2, model DINOv2-small      │
│  [✅ Dùng & tiếp tục]   [Xem từng mục]   [Bỏ qua, nhập tay]       │
└──────────────────────────────────────────────────────────────────┘
```
- "Dùng & tiếp tục" → pre-fill toàn wizard, kỹ thuật bấm qua các Step để xác nhận. Giảm từ "nhập tay hàng chục field" → "review + duyệt".

---

## A. Bề mặt gom: "Technician Copilot"
Ba luồng xuất hiện **đúng nơi làm việc** (không bắt đi tìm):
- ③ RCA → **Inbox** (push khi có lỗi) + nút "Chẩn đoán" trên trang máy/lỗi.
- ② Advisor → nút "AI đề xuất" ngay trên màn cấu hình + (chủ động) Inbox.
- ① Setup → trong wizard onboarding.
Tùy chọn: 1 trang `/technician-copilot` tổng hợp cho kỹ thuật (cùng style AI Action Inbox).

## B. An toàn & HITL (không nới lỏng)
- Mọi WRITE (ngưỡng/param/setup/fix) qua `proposeAction → confirmAction` (RBAC, TTL, args từ DB).
- Khuyến nghị là **advisory** tới khi duyệt. Bounds của tool luôn ràng buộc.
- **Degrade trung thực:** thiếu dữ liệu/độ tin cậy thấp → nói rõ, đề xuất thận trọng hoặc "cần người xem".
- Phản hồi đúng/sai → `ai_feedback` → vòng học (active-learning đã có).

## C. Kế hoạch xây (theo ưu tiên đã chốt ③→②→①)
| Phase | Hạng mục | Service mới | Tái dùng | Flag |
|---|---|---|---|---|
| C1 | **③ RCA Copilot** | `aiRcaCopilot.ts` + router + thẻ RCA (Inbox + nút Chẩn đoán) | causal graph, RAG, vision, SPC, deep model, auto-proposer | `AI_RCA_COPILOT_ENABLED` |
| C2 | **② Threshold Advisor** | `aiThresholdAdvisor.ts` + router + nút "AI đề xuất" trên màn cấu hình | suggestThresholds, Cpk, write-tools | `AI_THRESHOLD_ADVISOR_ENABLED` |
| C3 | **① Setup Advisor** | `aiSetupAdvisor.ts` + tích hợp wizard | onboarding wizard, suggestThresholds | `AI_SETUP_ADVISOR_ENABLED` |
| C4 | (tùy chọn) trang `/technician-copilot` gom 3 luồng | — | Inbox UI | — |

Mỗi phase: additive · flag-gated · HITL · có test · tsc xanh · commit riêng.

## D. KPI
- % việc cấu hình/ sửa lỗi hoàn thành chỉ bằng **review + 1 chạm Đồng ý** (mục tiêu ≥ 70%).
- Thời gian chẩn đoán 1 lỗi: trước (thủ công) → sau (AI) — mục tiêu giảm ≥ 5×.
- % khuyến nghị ngưỡng được duyệt không chỉnh tay (đo độ đúng).
- Cpk trung bình các điểm đo sau khi áp đề xuất (mục tiêu ≥ 1.33).

## E.0 ✅ QUYẾT ĐỊNH ĐÃ CHỐT (2026-06-28)
1. **RCA fix = MỞ RỘNG tool ghi:** ngoài chỉnh ngưỡng/param, thêm write-tool **tạo lệnh bảo trì** + **chỉnh tham số máy qua OT** (tái dùng `machineControl.set_machine_param` HITL đã có; thêm `create_maintenance_workorder` nếu có bảng phù hợp). OT vẫn dry-run trừ khi `ROBOT_CONTROL_ENABLED`/OT bật; mọi thứ qua HITL + kiểm thử an toàn.
2. **Setup ngưỡng: COPY từ máy template + cron tự tinh chỉnh** (giống cron rebuild anomaly bank) khi đủ dữ liệu. Máy mới có ngưỡng bảo vệ ngay.
3. **Thêm trang `/technician-copilot`** (C4) gom cả 3 luồng, song song với nhúng-tại-chỗ.
4. Ngưỡng tối thiểu số mẫu để AI đề xuất (mặc định **≥300 mẫu/điểm**, env-tunable); dưới ngưỡng → copy template/thận trọng + nói rõ.

## E. (Câu hỏi gốc — đã trả lời ở E.0)
1. RCA "fix tự động" tới đâu: chỉ **đề xuất write-tool có sẵn** (ngưỡng/param) hay mở rộng tool (vd tạo lệnh bảo trì, chỉnh tham số máy qua OT)? *(khuyến nghị: giai đoạn đầu chỉ tool có sẵn + MANUAL guidance.)*
2. Ngưỡng tối thiểu số mẫu để AI dám đề xuất (vd ≥300 mẫu/điểm)? Dưới ngưỡng → thận trọng/copy template.
3. Setup: cho phép AI **tự copy ngưỡng** từ máy template khi máy mới chưa có dữ liệu (rồi cron tinh chỉnh), hay luôn để trống chờ dữ liệu?
4. Có cần trang gom `/technician-copilot` (C4) hay nhúng tại chỗ là đủ?

---

*(Thiết kế — chưa code. Chờ anh/chị duyệt/điều chỉnh để triển khai C1→C3.)*
