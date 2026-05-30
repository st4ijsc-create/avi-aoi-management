# WS-G3 — Thay điểm gọi cloud LLM bằng GGUF local

## Mục tiêu
Loại mọi đường LLM cloud cho AI inference, route 100% qua `aiGgufEngine`↔`aiProviderRouter`. Giữ chữ ký nội bộ (caller không đổi), offline-first, đa ngôn ngữ. Phần vision uỷ thác G2.

## Hiện trạng (file:line)
1. `_core/llm.ts:268-332` `invokeLLM()` POST `forge.manus.im/v1/chat/completions` (gemini-2.5-flash), key `ENV.forgeApiKey`. Hỗ trợ tools/response_format/vision. **Gốc rễ.**
2. `inspectionRouters.ts:416-445` — invokeLLM vision+json_schema (ảnh inspection).
3. `annotationRouters.ts:602-670` — invokeLLM vision+json_schema (annotation).
4. `aiVisionLanguage.ts:~181 compareImages` (GPT-4o) — **vision, phối hợp G2**.
5. `aiVisionLanguage.ts:~295 generateQAReport` (GPT-4o) — **vision, phối hợp G2**.
6. `aiChatAssistant.ts:159-177` ưu tiên OpenAI khi có key (có GGUF path `:254-339` + offline `:910-1009`).
- Dead code: `aiInsightsService.ts:34-43` (`_client`/`getClient`, 0 callsite, runtime đã GGUF).
- Status: `aiProviderManager.ts:26-30,52-53` ưu tiên openai.
- **Ngoài phạm vi (hạ tầng cloud khác, KHÔNG qua invokeLLM):** imageGeneration/voiceTranscription/notification/dataApi/map gọi forge trực tiếp — chỉ ghi chú; `forgeApiKey` vẫn cần cho chúng → KHÔNG xoá khỏi env.ts.

## Thiết kế — giữ chữ ký invokeLLM (khuyến nghị)
Viết lại thân `invokeLLM` route qua GGUF, giữ `InvokeParams`→`InvokeResult`:
1. `splitMessages` → `{systemPrompt, prompt, images[]}` (gộp text, decode/resolve image_url).
2. Text/JSON: `json_schema`→`aiProviderRouter.generateInsightJson({jsonSchema,...})` (grammar); `text`→`generateNarrative`.
3. Vision (có image_url) — **phụ thuộc G2**: resolve url→Buffer (tái dùng `loadImage` ở `aiVisionLanguageRouter.ts:22`), gọi `describeImage`; nếu JSON+vision → 2 bước (describe → `generateInsightJson` ép schema).
4. Đóng gói `InvokeResult` (choices/usage/finish_reason); `tool_calls` rỗng.
5. Bỏ `assertApiKey`/`resolveApiUrl`/`fetch` forge; giữ type exports + `normalizeResponseFormat`.

Trade-off: giữ chữ ký = sửa tập trung 1 file, 2 router không đụng (giảm hồi quy) nhưng phải mô phỏng shape OpenAI. (Đổi caller trực tiếp rõ nghĩa hơn nhưng rủi ro hồi quy cao — để giai đoạn sau.)

## Bước thực hiện
1. `_core/llm.ts`: `splitMessages` + `wrapAsInvokeResult` + định tuyến text/json/vision; bỏ fetch forge.
2. `inspectionRouters.ts`/`annotationRouters.ts`: giữ callsite (adapter trả content JSON khớp schema).
3. `aiChatAssistant.ts`: xoá import/`getOpenAIClient`/`processOpenAIChat`/kiểu `OpenAI.Chat`; `processChat` thứ tự = GGUF→offline; sửa footer offline đa ngôn ngữ; giữ intent/JSON tool-selection (tool-calling thật = phối hợp G1).
4. `aiInsightsService.ts`: xoá dead code OpenAI + sửa comment.
5. `aiProviderManager.ts`: gỡ ưu tiên openai (giữ field `available:false` nếu UI tham chiếu — kiểm callers trước khi xoá).
6. Env: GIỮ `forgeApiKey` (image-gen/STT/notification/map vẫn dùng); chỉ ngừng cho inference.

## Files
`server/_core/llm.ts` (chính) · `aiChatAssistant.ts` · `aiInsightsService.ts` · `aiProviderManager.ts` · `inspectionRouters.ts` · `annotationRouters.ts` · (tham khảo) `aiVisionLanguageRouter.ts:22 loadImage`.

## Tests / Nghiệm thu
invokeLLM trả text/JSON từ GGUF (mock router); vision gọi describeImage với Buffer; không cần API key (regression); `processChat` ưu tiên GGUF dù có OPENAI_API_KEY; offline reply en/vi; tĩnh: 0 `new OpenAI` trong inference path; `getActiveProvider()` trả `gguf`. Nghiệm thu: inspection/annotation/chat/RCA chạy offline; grep 0 `forge.../chat/completions` + 0 `new OpenAI` inference; build/typecheck pass.

## Rủi ro
R1 vision phụ thuộc G2 (làm text/JSON trước, vision sau cờ). R2 JSON schema strict vs GBNF (enum/additionalProperties) → fallback prompt+validate. R3 JSON+vision 2 bước giảm độ chính xác/latency. R4 mất tool-calling native (phối hợp G1). R7 KHÔNG xoá forgeApiKey (vỡ image-gen/STT).

## Critical files
`server/_core/llm.ts` · `aiChatAssistant.ts` · `aiProviderManager.ts` · `aiInsightsService.ts` · `aiProviderRouter.ts`
