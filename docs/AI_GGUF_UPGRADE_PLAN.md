# Kế hoạch Nâng cấp Module AI — GGUF Integration
# AI Module Upgrade Plan — GGUF Model Integration

> **Ngày tạo**: 2025-07-15
> **Model hiện tại**: Gemma 4 26B-A4B (MXFP4 MOE) — llama.cpp b8770
> **Engine**: node-llama-cpp 3.18.1 (rebuilt from source)
> **Build**: MSVC 19.50, AVX2+FMA, GPU auto (CUDA/Vulkan)

---

## Tổng quan Hệ thống AI hiện tại

| Thành phần | File | Dòng code | GGUF Status |
|---|---|---|---|
| GGUF Engine | `aiGgufEngine.ts` | ~640 | ✅ Core engine |
| Provider Manager | `aiProviderManager.ts` | ~60 | ✅ OpenAI→GGUF→Offline |
| Chat Assistant | `aiChatAssistant.ts` | ~600 | ⚠️ Keyword-only |
| Insights/RCA | `aiInsightsService.ts` | ~400 | ✅ Proper fallback |
| Report Generator | `aiReportGenerator.ts` | ~500 | ✅ Proper fallback |
| Vision Language | `aiVisionLanguage.ts` | ~300 | ❌ OpenAI-only |
| Smart Alert Router | `aiSmartAlertRouter.ts` | ~200 | ❌ No LLM |
| Quality Gate | `aiQualityGate.ts` | ~400 | ✅ ONNX (OK as-is) |
| Inspection Analytics | `aiInspectionAnalytics.ts` | ~500 | ❌ No narration |
| GGUF Router | `aiGgufRouter.ts` | ~200 | ⚠️ No streaming |

---

## PHASE 1 — Core Engine Upgrade (Nền tảng)

### 1.1 Streaming Support cho aiGgufEngine
**File**: `server/services/aiGgufEngine.ts`
**Mức độ**: 🔴 P0 CRITICAL
**Thời gian ước tính**: 4-6h

**Hiện trạng**: Tất cả API trả về `Promise<Result>` — không có streaming. Comment nói có streaming nhưng chưa implement.

**Thay đổi**:
```typescript
// Thêm hàm streaming text generation
export async function* generateTextStream(
  options: GgufGenerateOptions,
  modelId?: string
): AsyncGenerator<{ token: string; done: boolean }> {
  const { modelId: resolvedId, loaded } = await getOrLoadModel(modelId);
  const { LlamaChatSession } = await import("node-llama-cpp");
  const sequence = loaded.context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });

  try {
    const responseStream = await session.prompt(fullPrompt, {
      maxTokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      // ... other params
      onTextChunk: undefined, // sẽ dùng promptWithMeta
    });
    // Sử dụng session.promptWithMeta() để lấy từng token
    // yield { token, done: false } cho mỗi chunk
    // yield { token: '', done: true } khi hoàn thành
  } finally {
    sequence.dispose();
  }
}

// Thêm streaming cho chat completion
export async function* chatCompletionStream(
  options: GgufChatOptions,
  modelId?: string
): AsyncGenerator<{ token: string; done: boolean }> { ... }
```

**Kiểm tra**: node-llama-cpp `session.prompt()` hỗ trợ callback `onTextChunk` hoặc dùng `session.promptWithMeta()` trả về async iterable.

---

### 1.2 Streaming Endpoint cho aiGgufRouter
**File**: `server/routers/aiGgufRouter.ts`
**Mức độ**: 🔴 P0 CRITICAL
**Thời gian ước tính**: 3-4h

**Hiện trạng**: Router chỉ có `generate` (mutation) và `chat` (mutation) — không streaming.

**Thay đổi**:
```typescript
// tRPC subscription/observable cho streaming
generateStream: publicProcedure
  .input(z.object({ prompt: z.string(), ... }))
  .subscription(async function* ({ input }) {
    for await (const chunk of generateTextStream(input)) {
      yield chunk;
    }
  }),

chatStream: publicProcedure
  .input(z.object({ messages: z.array(...), ... }))
  .subscription(async function* ({ input }) {
    for await (const chunk of chatCompletionStream(input)) {
      yield chunk;
    }
  }),
```

**Client side**: Sử dụng tRPC subscription hoặc SSE adapter.

---

### 1.3 Token Counting chính xác
**File**: `server/services/aiGgufEngine.ts`
**Mức độ**: 🟡 P2 LOW
**Thời gian ước tính**: 1h

**Hiện trạng**: Đếm token bằng `Math.ceil(text.length / 4)` — rất thiếu chính xác.

**Thay đổi**: Dùng model tokenizer từ node-llama-cpp:
```typescript
const tokens = loaded.model.tokenize(text);
const tokensPrompt = tokens.length;
```

---

## PHASE 2 — Critical Gap Fix (Sửa lỗ hổng quan trọng)

### 2.1 aiVisionLanguage — GGUF Fallback
**File**: `server/services/aiVisionLanguage.ts`
**Mức độ**: 🔴 P0 CRITICAL
**Thời gian ước tính**: 6-8h

**Hiện trạng**: 100% phụ thuộc GPT-4o Vision. Khi không có OpenAI API key → trả kết quả vô nghĩa ("No defect detected", empty arrays).

**Chiến lược**: GGUF model không xử lý hình ảnh trực tiếp (Gemma 4 text-only). Thay vào đó, sử dụng metadata + AI labels có sẵn trong DB làm input cho GGUF text analysis.

**Thay đổi**:

```typescript
// Hàm mới: describeDefect với GGUF fallback
export async function describeDefect(imageBuffer, context?) {
  // 1. Thử GPT-4o Vision (hiện tại)
  const client = getClient();
  if (client) {
    return describeDefectWithVision(imageBuffer, context);
  }

  // 2. Fallback GGUF: Phân tích dựa trên metadata (không cần hình ảnh)
  return describeDefectWithGguf(context);
}

async function describeDefectWithGguf(context?) {
  const { generateText } = await import("./aiGgufEngine");
  const prompt = buildDefectAnalysisPrompt(context);
  // context bao gồm: existingLabels, productModel, machineCode,
  // inspectionPoint, measuredValue, confidence score từ ONNX
  const result = await generateText({
    systemPrompt: "You are an AOI quality expert...",
    prompt,
    maxTokens: 512,
    temperature: 0.3,
    jsonMode: true,
  });
  return parseDefectDescription(result.text);
}
```

**3 hàm cần fallback**:
| Hàm | Input thay thế cho GGUF |
|---|---|
| `describeDefect()` | AI labels + measurement data + confidence |
| `compareImages()` | Measurement delta + time series + machine status |
| `generateQAReport()` | Batch inspection stats + defect distribution |

**Lưu ý**: GGUF vision-less fallback sẽ ít chính xác hơn GPT-4o Vision, nhưng vẫn hữu ích hơn fallback hiện tại (trả về chuỗi rỗng/generic).

---

### 2.2 aiChatAssistant — LLM-Driven Tool Selection
**File**: `server/services/aiChatAssistant.ts`
**Mức độ**: 🔴 P1 HIGH
**Thời gian ước tính**: 6-8h

**Hiện trạng**: GGUF path dùng hardcoded regex pattern matching:
```typescript
// Hiện tại (keyword matching)
if (/thống kê|statistic|inspection stat/i.test(msg)) → query_inspection_stats
if (/xu hướng|trend|defect trend/i.test(msg)) → get_defect_trends
// ... v.v.
```
→ Kém linh hoạt, không hiểu ngữ cảnh, dễ miss ý người dùng.

**Thay đổi — 2 phương án**:

#### Phương án A (Khuyến nghị): Two-Step GGUF Inference
```typescript
async function handleGgufChat(messages, userMessage, language) {
  // Step 1: Tool Selection — GGUF chọn tool dựa trên ngữ cảnh
  const toolSelectionPrompt = buildToolSelectionPrompt(userMessage, TOOL_DESCRIPTIONS);
  const selection = await generateText({
    systemPrompt: "Select the most appropriate tool...",
    prompt: toolSelectionPrompt,
    jsonMode: true,
    temperature: 0.1, // Low temp for deterministic selection
    maxTokens: 256,
  });
  const { tool, params } = JSON.parse(selection.text);

  // Step 2: Execute tool → get data
  const toolResult = await executeToolByName(tool, params);

  // Step 3: Generate natural language response
  const responsePrompt = buildResponsePrompt(userMessage, tool, toolResult, language);
  const response = await generateText({
    systemPrompt: "Manufacturing quality assistant...",
    prompt: responsePrompt,
    temperature: 0.7,
    maxTokens: 1024,
  });

  return { reply: response.text, toolsUsed: [tool] };
}
```

#### Phương án B: Single-Step with Grammar Constraint
Dùng node-llama-cpp grammar để constrain output format → ít inference hơn nhưng phức tạp hơn.

**Khuyến nghị**: Phương án A — dễ debug, dễ mở rộng, reliability cao hơn.

---

## PHASE 3 — Module Integration (Tích hợp vào module khác)

### 3.1 NG Rate Alert + GGUF Root Cause
**File**: `server/services/ngRateAlertService.ts`
**Mức độ**: 🟠 P1 HIGH
**Thời gian ước tính**: 4-6h

**Hiện trạng**: Trigger alert khi NG rate vượt threshold → chỉ gửi số liệu thô.

**Thay đổi**:
```typescript
// Khi trigger alert, thêm GGUF analysis
async function enrichAlertWithAI(alertData) {
  try {
    const { generateText } = await import("./aiGgufEngine");
    const analysis = await generateText({
      systemPrompt: "Manufacturing quality expert...",
      prompt: `NG rate spike detected:
        - Current: ${alertData.ngRate}% (threshold: ${alertData.threshold}%)
        - Machine: ${alertData.machineCode}
        - Top defects: ${alertData.topDefects.join(', ')}
        - Time: ${alertData.timestamp}
        Analyze root cause and suggest corrective actions.`,
      maxTokens: 512,
      temperature: 0.3,
      jsonMode: true,
    });
    return JSON.parse(analysis.text);
    // → { likelyCause, confidence, suggestedActions[], estimatedImpact }
  } catch {
    return null; // Non-blocking — alert vẫn gửi dù AI fail
  }
}
```

**Quan trọng**: AI enrichment phải NON-BLOCKING — alert vẫn gửi ngay, AI bổ sung sau.

---

### 3.2 Smart Alert Router + GGUF Reasoning
**File**: `server/services/aiSmartAlertRouter.ts`
**Mức độ**: 🟠 P2 MEDIUM
**Thời gian ước tính**: 3-4h

**Hiện trạng**: Pure rule-based routing. Không có context/reasoning.

**Thay đổi**:
```typescript
// Thêm GGUF reasoning layer
async function enrichRoutingWithAI(event: SmartAlertEvent, routingResult: RoutingResult) {
  const { generateText } = await import("./aiGgufEngine");
  const enriched = await generateText({
    systemPrompt: "Alert routing expert in manufacturing factory...",
    prompt: `Alert: ${event.type}, Severity: ${event.severity}
      Message: ${event.message}
      Data: ${JSON.stringify(event.data)}
      Current routing: ${routingResult.targets.map(t => t.role).join(', ')}
      Explain WHY this severity and WHO should handle it.`,
    maxTokens: 256,
    temperature: 0.3,
    jsonMode: true,
  });
  // → { reasoning, suggestedRootCause, urgencyExplanation }
  routingResult.suggestedAction = enriched.reasoning;
}
```

---

### 3.3 Inspection Analytics + Narration Layer
**File**: `server/services/aiInspectionAnalytics.ts`
**Mức độ**: 🟠 P2 MEDIUM
**Thời gian ước tính**: 3-4h

**Hiện trạng**: Output thuần JSON (trends, Pareto, correlations, risk scores). Người dùng phải tự đọc số liệu.

**Thay đổi**: Thêm hàm wrapper cho mỗi analysis function:
```typescript
// Wrapper narration
export async function getTrendAnalysisWithNarration(params) {
  const data = await getTrendAnalysis(params); // existing function
  const narration = await narrateAnalysis("trend", data);
  return { ...data, narration };
}

async function narrateAnalysis(type: string, data: any) {
  try {
    const { generateText } = await import("./aiGgufEngine");
    const result = await generateText({
      systemPrompt: "Manufacturing data analyst...",
      prompt: `Explain this ${type} analysis in 2-3 sentences:
        ${JSON.stringify(data)}`,
      maxTokens: 256,
      temperature: 0.5,
    });
    return result.text;
  } catch {
    return null; // Fallback: no narration, data vẫn trả đầy đủ
  }
}
```

**Các hàm cần narration**:
- `getTrendAnalysis()` — "Xu hướng NG tăng 12% trong 3 ngày qua, tập trung ở máy M-003..."
- `getParetoAnalysis()` — "80% lỗi đến từ 3 loại: Solder Bridge (42%), Missing (25%), Tombstone (13%)..."
- `getCorrelationAnalysis()` — "Measurement A và B có tương quan 0.82 — khả năng cùng nguyên nhân."
- `getRiskScoreAnalysis()` — "Máy M-005 risk score 8.7/10 — cần bảo trì preventive."

---

### 3.4 Pareto Analysis + Action Recommendations
**File**: `server/services/paretoAnalysisService.ts`
**Mức độ**: 🟡 P2 MEDIUM
**Thời gian ước tính**: 2-3h

**Hiện trạng**: Trả kết quả Pareto thuần thống kê (80% from N defects).

**Thay đổi**: Sau khi tính Pareto, gọi GGUF sinh khuyến nghị:
```typescript
// "Fix Solder Bridge first — estimated 2,400 units/quarter recovered"
// "Tombstone has high correlation with Feeder #3 — check feeder calibration"
```

---

### 3.5 SPC Violation Narration
**File**: `server/services/spcService.ts` (nếu có) hoặc module liên quan
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 4-6h

**Hiện trạng**: SPC có trong schema nhưng chưa có narration layer.

**Thay đổi**: Khi detect Western Electric rule violation → GGUF giải thích:
- "6 điểm liên tiếp tăng → quá trình có systematic shift, KHÔNG phải random"
- "2/3 điểm > 2σ → process capability đang giảm, cần kiểm tra thiết bị"

---

### 3.6 Notification Content Personalization
**File**: `server/services/notificationService.ts`
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 2-3h

**Hiện trạng**: Template-based, cùng message cho mọi role.

**Thay đổi**: GGUF personalize nội dung theo role:
- **Operator**: "NG rate cao ở vị trí đo X. Kiểm tra feeder #3."
- **Supervisor**: "NG spike 8.2% (baseline 2%). 3 máy bị ảnh hưởng. Ước tính mất 450 unit/giờ."
- **Manager**: "Executive: yield drop 5% hôm nay. Root cause: humidity sensor. ETA fix: 2h."

---

### 3.7 Data Comparison Narrative
**File**: `server/services/dataComparisonService.ts`
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 2-3h

**Hiện trạng**: So sánh 2 period trả numeric delta. Không giải thích.

**Thay đổi**: GGUF giải thích ý nghĩa so sánh + suy đoán nguyên nhân thay đổi.

---

### 3.8 Downtime Root Cause Analysis
**File**: `server/services/downtimeDetectionService.ts`
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 3-4h

**Thay đổi**: Khi detect downtime → GGUF phân tích nguyên nhân có thể, predict thời gian recovery.

---

### 3.9 Production Scheduling Explanation
**File**: `server/services/productionSchedulingService.ts`
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 3-4h

**Thay đổi**: GGUF giải thích conflict trong schedule, risk scores, recovery recommendations.

---

## PHASE 4 — Client-Side Integration

### 4.1 Chat UI Streaming
**File**: `client/src/pages/ai-chat/` hoặc tương đương
**Mức độ**: 🟠 P1 HIGH
**Thời gian ước tính**: 4-6h

**Thay đổi**: Hiện chat nhận full response → chuyển sang streaming token-by-token. Dùng tRPC subscription + React state update per chunk.

### 4.2 Inline AI Suggestions trên Dashboard
**Mức độ**: 🟡 P3 LATER
**Thời gian ước tính**: 6-8h

**Thay đổi**: Widget "AI Insights" trên dashboard chính — auto-generate summary mỗi khi load page.

---

## Tổng hợp Roadmap

### Sprint 1 (Tuần 1-2): Nền tảng & Critical Fixes
| # | Task | Priority | Est. |
|---|---|---|---|
| 1.1 | Streaming support cho aiGgufEngine | P0 | 4-6h |
| 1.2 | Streaming endpoint cho aiGgufRouter | P0 | 3-4h |
| 2.1 | aiVisionLanguage GGUF fallback | P0 | 6-8h |
| 2.2 | aiChatAssistant LLM tool selection | P1 | 6-8h |
| | **Subtotal** | | **19-26h** |

### Sprint 2 (Tuần 3-4): Module Integration
| # | Task | Priority | Est. |
|---|---|---|---|
| 3.1 | NG Rate Alert + AI root cause | P1 | 4-6h |
| 3.2 | Smart Alert Router + reasoning | P2 | 3-4h |
| 3.3 | Inspection Analytics narration | P2 | 3-4h |
| 3.4 | Pareto action recommendations | P2 | 2-3h |
| 4.1 | Chat UI streaming | P1 | 4-6h |
| | **Subtotal** | | **16-23h** |

### Sprint 3 (Tuần 5-6): Polish & Extend
| # | Task | Priority | Est. |
|---|---|---|---|
| 1.3 | Accurate token counting | P2 | 1h |
| 3.5 | SPC violation narration | P3 | 4-6h |
| 3.6 | Notification personalization | P3 | 2-3h |
| 3.7 | Data comparison narrative | P3 | 2-3h |
| 3.8 | Downtime root cause | P3 | 3-4h |
| 3.9 | Production scheduling explanation | P3 | 3-4h |
| 4.2 | Dashboard AI insights widget | P3 | 6-8h |
| | **Subtotal** | | **21-29h** |

### **Tổng cộng**: ~56-78h (~2-3 tuần full-time)

---

## Nguyên tắc Thiết kế

1. **Non-blocking**: Mọi AI enrichment phải non-blocking. Data/alert gửi trước, AI bổ sung sau.
2. **Graceful degradation**: OpenAI → GGUF → Rule-based → Raw data. Không bao giờ fail hoàn toàn.
3. **Lazy loading**: GGUF model chỉ load khi cần lần đầu (singleton pattern đã có).
4. **Bilingual**: Mọi prompt hỗ trợ `language: "en" | "vi"` (đã có pattern trong aiGgufEngine).
5. **JSON mode**: Khi cần structured output, luôn dùng `jsonMode: true` + try/catch parse.
6. **Temperature phù hợp**: Analysis/tool selection = 0.1-0.3 (deterministic), narrative = 0.5-0.7 (creative).
7. **Max tokens tiết kiệm**: Alert enrichment = 256, RCA = 512, Report = 1024.

---

## Kiến trúc Tổng thể sau Nâng cấp

```
┌─────────────────────────────────────────────────────────┐
│                     Client (React)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ Chat UI  │ │Dashboard │ │Analytics │ │  Reports   │ │
│  │(Stream)  │ │(Insights)│ │(Narrate) │ │(Narrative) │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
└───────┼─────────────┼───────────┼──────────────┼────────┘
        │ tRPC        │           │              │
┌───────┼─────────────┼───────────┼──────────────┼────────┐
│       ▼             ▼           ▼              ▼        │
│  ┌─────────────────────────────────────────────────┐    │
│  │              aiProviderManager                   │    │
│  │         OpenAI → GGUF → Offline/Rules           │    │
│  └──────────┬──────────────┬──────────────┬────────┘    │
│             │              │              │             │
│  ┌──────────▼───┐ ┌───────▼──────┐ ┌─────▼─────────┐  │
│  │   OpenAI     │ │ aiGgufEngine │ │  Rule-based   │  │
│  │  GPT-4o/mini │ │ Gemma4 26B   │ │  Fallback     │  │
│  │  Vision API  │ │ + Streaming  │ │               │  │
│  └──────────────┘ └──────────────┘ └───────────────┘  │
│                                                         │
│  Consumers (với AI enrichment):                         │
│  ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │
│  │NG Rate     │ │Smart Alert │ │ Inspection         │  │
│  │Alert +RCA  │ │Router +AI  │ │ Analytics +Narrate │  │
│  ├────────────┤ ├────────────┤ ├────────────────────┤  │
│  │Pareto      │ │Downtime    │ │ Production         │  │
│  │+Actions    │ │+Root Cause │ │ Schedule +Explain  │  │
│  ├────────────┤ ├────────────┤ ├────────────────────┤  │
│  │SPC         │ │Notification│ │ Data Comparison    │  │
│  │+Narration  │ │+Personal   │ │ +Narrative         │  │
│  └────────────┘ └────────────┘ └────────────────────┘  │
│                         Server                          │
└─────────────────────────────────────────────────────────┘
```

---

## Bắt đầu từ đâu?

**Khuyến nghị bắt đầu theo thứ tự**:
1. **1.1 + 1.2**: Streaming — nền tảng cho mọi tính năng real-time
2. **2.2**: Chat Assistant tool selection — cải thiện trải nghiệm chatbot ngay lập tức
3. **2.1**: Vision fallback — loại bỏ hard dependency vào OpenAI
4. **3.1**: NG Alert enrichment — giá trị kinh doanh cao nhất (operator biết ngay nguyên nhân)
5. **4.1**: Chat streaming UI — UX improvement lớn nhất

Mỗi task độc lập, có thể implement song song nếu có nhiều developer.
