// WS-G3: LLM inference is now routed 100% through the local GGUF engine via
// aiProviderRouter (no cloud / forge call). The signature (InvokeParams →
// InvokeResult) is preserved so existing callers (inspectionRouters,
// annotationRouters) need no change. Vision is delegated to
// aiProviderRouter.describeImage (real output once the G2 vision sidecar is
// wired; fallback text until then).
import { appError } from "./appError";
import {
  generateNarrative,
  generateInsightJson,
  describeImage,
} from "../services/aiProviderRouter";
import { resolveSafeImagePath } from "../utils/safeImagePath";
import fs from "fs";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
  /** G2-B — mắt xích GIỮA của vòng đời tool-call: lượt `assistant` đã phát ra tool_calls nào. */
  tool_calls?: ToolCall[];
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /**
   * doc69 G2-1 — optional caller user id, threaded straight into aiProviderRouter's
   * gateway plan (per-user rate-limit + metrics attribution). No current caller
   * (inspectionRouters/annotationRouters) passes this yet — it is purely additive so a
   * future ctx-aware caller can supply it without any other signature change. Omitted →
   * undefined → the gateway treats it as a system/anonymous caller (tolerated, verified).
   */
  userId?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// ─── GGUF routing helpers (WS-G3) ──────────────────────────────

type SplitMessages = {
  systemPrompt: string;
  prompt: string;
  images: Buffer[];
};

/** Resolve an image_url url field to a Buffer. Supports:
 *  - data: URIs (base64 decode)
 *  - http(s): URLs (fetch → Buffer)
 *  - storage keys / relative paths (read from the uploads dir via safeImagePath)
 */
async function resolveImageUrlToBuffer(url: string): Promise<Buffer | null> {
  if (!url) return null;

  // data: URI → decode base64 payload
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    const meta = url.slice(5, comma);
    const data = url.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      return Buffer.from(data, "base64");
    }
    return Buffer.from(decodeURIComponent(data), "utf8");
  }

  // http(s) → fetch
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch image_url (${res.status} ${res.statusText})`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }

  // Otherwise treat as a storage key / relative path under the uploads dir.
  // Strip a leading "/uploads/" prefix if present so safeImagePath confines it.
  const key = url.replace(/^\/?uploads\//i, "").replace(/^\/+/, "");
  const resolved = resolveSafeImagePath(key);
  if (!fs.existsSync(resolved)) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "image" }, `Image not found for image_url: ${url}`);
  }
  return fs.readFileSync(resolved);
}

/** Flatten OpenAI-style messages into a single system prompt, a user prompt,
 * and the list of resolved image Buffers. */
async function splitMessages(messages: Message[]): Promise<SplitMessages> {
  const systemParts: string[] = [];
  const promptParts: string[] = [];
  const images: Buffer[] = [];

  for (const message of messages) {
    const parts = ensureArray(message.content);
    for (const rawPart of parts) {
      const part = normalizeContentPart(rawPart);
      if (part.type === "text") {
        if (!part.text) continue;
        if (message.role === "system") {
          systemParts.push(part.text);
        } else {
          promptParts.push(part.text);
        }
      } else if (part.type === "image_url") {
        const buf = await resolveImageUrlToBuffer(part.image_url.url);
        if (buf) images.push(buf);
      }
      // file_url parts are unsupported by the local engine → ignored.
    }
  }

  return {
    systemPrompt: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
    images,
  };
}

/**
 * Wrap a plain string + optional token counts into the OpenAI-shaped InvokeResult.
 *
 * ★★★ G2-B — **Ô `tool_calls` KHÔNG CÒN ĐƯỢC GÁN Ở ĐÂY.**
 * Bản cũ gán `tool_calls: []` như một **HẰNG SỐ**, và dòng ấy là lời nói dối trung tâm của cả
 * nhiệm vụ này: nó cho ra hình dạng *"model đã cân nhắc và quyết định KHÔNG gọi tool nào"* cho
 * một sự thật hoàn toàn khác — *"đường này chưa bao giờ biết gọi tool, và `params.tools` của bạn
 * đã bị vứt đi không một lời"*. Người gọi không có cách nào phân biệt hai chuyện đó.
 *
 * Nay: ô chỉ MỌC RA khi có tool-call thật (xem `boToolCallVaoKetQua`), còn đường không hỗ trợ thì
 * **NÉM** (`LoiKhongHoTroToolCall`). Không có trạng thái thứ ba nào im lặng.
 */
function wrapAsInvokeResult(
  content: string,
  opts: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    toolCalls?: ToolCall[];
    finishReason?: string;
  } = {}
): InvokeResult {
  const promptTokens = opts.promptTokens ?? 0;
  const completionTokens = opts.completionTokens ?? 0;
  const toolCalls = opts.toolCalls ?? [];
  return {
    id: `gguf-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: opts.model ?? "gguf-local",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length ? "tool_calls" : (opts.finishReason ?? "stop"),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * ★★★ G2-B — *"đường này chưa hỗ trợ tool-calling"*, nói thành lời thay vì trả mảng rỗng.
 * ⚠ Chỉ ném khi caller THẬT SỰ nêu `tools`. Mọi lượt `invokeLLM` cũ (không tool) giữ nguyên
 * hành vi từng bit.
 */
export class LoiKhongHoTroToolCall extends Error {
  readonly code = "tool_calls_unsupported";
  constructor(lyDo: string) {
    super(`[llm] invokeLLM không phục vụ được yêu cầu có \`tools\`: ${lyDo}`);
    this.name = "LoiKhongHoTroToolCall";
  }
}

/** Chuẩn hoá `toolChoice`/`tool_choice` của `InvokeParams` về thứ engine cưỡng chế được. */
function chuanHoaToolChoiceNoiBo(choice: ToolChoice | undefined): "auto" | "none" {
  if (choice === undefined || choice === "auto") return "auto";
  if (choice === "none") return "none";
  // "required" và dạng theo TÊN: engine cục bộ KHÔNG cưỡng chế được (đo sống — xem
  // `services/ai/nativeToolCalls.ts`). Im lặng coi chúng như "auto" là bỏ qua một ràng buộc mà
  // caller đã nêu ra; đó chính là hình dạng hỏng-trong-im-lặng G2-B xoá bỏ.
  const ten =
    typeof choice === "object" && choice !== null
      ? ("name" in choice ? choice.name : choice.function?.name)
      : String(choice);
  throw new LoiKhongHoTroToolCall(
    `tool_choice ${JSON.stringify(ten ?? choice)} không cưỡng chế được trên engine GGUF cục bộ ` +
      `(llama.cpp b9814 bỏ qua "required" và tool_choice theo tên — đo sống 2026-08-17). Dùng "auto".`
  );
}

/** `Message[]` (khuôn OpenAI của file này) → `GgufChatMessage[]`, GIỮ vai `tool`. */
function veChatMessages(messages: Message[]): GgufChatMessageLocal[] {
  return messages.map((m) => {
    const role: GgufChatMessageLocal["role"] =
      m.role === "system"
        ? "system"
        : m.role === "assistant"
          ? "assistant"
          : m.role === "tool" || m.role === "function"
            ? "tool"
            : "user";
    const parts = ensureArray(m.content).map(normalizeContentPart);
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    const ra: GgufChatMessageLocal = { role, content: text };
    if (role === "tool" && m.tool_call_id) ra.tool_call_id = m.tool_call_id;
    if (role === "assistant" && m.tool_calls?.length) ra.tool_calls = m.tool_calls;
    return ra;
  });
}

/** Hình dạng tối thiểu của `GgufChatMessage` mà file này cần — khai tại chỗ để không kéo cả
 * `aiGgufEngine` vào đồ thị import TĨNH của `_core` (engine được `import()` động bên dưới). */
type GgufChatMessageLocal = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

/**
 * invokeLLM — local-only inference via the GGUF engine (WS-G3).
 *
 * Signature is unchanged. Routing:
 *  - vision (any image_url present) → describeImage; if a json_schema is also
 *    requested, the description is then coerced to JSON via generateInsightJson.
 *  - json_schema / json_object response_format → generateInsightJson.
 *  - otherwise → generateNarrative (free text).
 *
 * ★★★ G2-B — `params.tools` KHÔNG CÒN BỊ VỨT ĐI TRONG IM LẶNG.
 * Câu tự khai cũ ngay tại chỗ này — *"tools / tool_choice are accepted for backward compatibility
 * but native tool-calling is not performed locally"* — mô tả đúng hành vi, và đó chính là vấn đề:
 * "accepted … but not performed" cộng với `tool_calls: []` ở `wrapAsInvokeResult` cho ra một đáp
 * ứng KHÔNG PHÂN BIỆT ĐƯỢC với "model quyết định không gọi tool". Nay có `tools` ⇒ đi đường
 * tool-calling GỐC (llama-server, xem `aiGgufEngine.chatCompletion`); đường nào không phục vụ
 * được thì **NÉM** `LoiKhongHoTroToolCall`.
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    maxTokens,
    max_tokens,
    userId,
  } = params;

  const { systemPrompt, prompt, images } = await splitMessages(messages);

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  const wantsJsonSchema =
    normalizedResponseFormat?.type === "json_schema";
  const wantsJsonObject =
    normalizedResponseFormat?.type === "json_object";
  const jsonSchema =
    normalizedResponseFormat?.type === "json_schema"
      ? normalizedResponseFormat.json_schema.schema
      : undefined;

  const effectiveMaxTokens = maxTokens ?? max_tokens;

  // ─── ★★★ G2-B — NHÁNH TOOL-CALLING GỐC ────────────────────────
  // Đứng TRƯỚC cả nhánh vision lẫn nhánh JSON: `tools` là một yêu cầu về HÌNH DẠNG ĐẦU RA mà hai
  // nhánh kia không thể thoả (chúng trả chữ / trả JSON theo schema, không trả `tool_calls`). Rơi
  // xuống dưới = quay lại đúng hành vi cũ.
  const toolsYeuCau = params.tools;
  if (toolsYeuCau?.length) {
    const choice = chuanHoaToolChoiceNoiBo(params.toolChoice ?? params.tool_choice);

    // Hai tổ hợp KHÔNG phục vụ được — nói ra, không degrade:
    if (images.length > 0) {
      throw new LoiKhongHoTroToolCall(
        "yêu cầu có ảnh (vision) VÀ `tools`: đường vision đi qua sidecar mô tả ảnh, không qua chat template có khối <tools>."
      );
    }
    if (normalizedResponseFormat && normalizedResponseFormat.type !== "text") {
      throw new LoiKhongHoTroToolCall(
        `yêu cầu vừa \`tools\` vừa response_format="${normalizedResponseFormat.type}": không ép được decoder theo HAI ràng buộc cùng lúc (grammar JSON vs khuôn tool-call).`
      );
    }

    // `import()` ĐỘNG — giữ `aiGgufEngine` (và cả cây VRAM/node-llama-cpp của nó) ngoài đồ thị
    // import tĩnh của `_core`, đúng như `aiProviderRouter` vẫn được nạp qua router ở trên.
    const engine = await import("../services/aiGgufEngine");
    const kq = await engine.chatCompletion({
      messages: veChatMessages(messages),
      maxTokens: effectiveMaxTokens,
      // ⚠ `choice === "none"` ⇒ KHÔNG truyền tools xuống. Đó là cách DUY NHẤT cưỡng chế được
      // "none" trên llama.cpp b9814 (gửi kèm `tool_choice:"none"` thì tools vẫn vào prompt và
      // `<tool_call>` nguyên văn rò vào `content`) — xem `services/ai/nativeToolCalls.ts`.
      ...(choice === "auto"
        ? { tools: toolsYeuCau as unknown as NonNullable<Parameters<typeof engine.chatCompletion>[0]["tools"]>, toolChoice: "auto" as const }
        : {}),
    });

    return wrapAsInvokeResult(kq.text, {
      model: kq.modelId,
      promptTokens: kq.tokensPrompt,
      completionTokens: kq.tokensGenerated,
      toolCalls: kq.toolCalls as ToolCall[] | undefined,
      finishReason: kq.finishReason,
    });
  }

  // ─── Vision branch ───────────────────────────────────────────
  if (images.length > 0) {
    const description = await describeImage({
      image: images[0]!,
      prompt: prompt || systemPrompt,
      systemPrompt: systemPrompt || undefined,
      maxTokens: effectiveMaxTokens,
      userId,
    });

    // Vision + structured output → coerce the description into the schema.
    if (jsonSchema) {
      const insight = await generateInsightJson({
        jsonSchema,
        prompt: `${prompt}\n\n[Image analysis]\n${description.text}`,
        systemPrompt: systemPrompt || undefined,
        maxTokens: effectiveMaxTokens,
        userId,
      });
      return wrapAsInvokeResult(insight.raw, { model: insight.model });
    }

    return wrapAsInvokeResult(description.text, { model: description.model });
  }

  // ─── JSON branch (schema or json_object) ─────────────────────
  if (jsonSchema || wantsJsonObject) {
    const insight = await generateInsightJson({
      // json_object has no schema → use an open object schema.
      jsonSchema: jsonSchema ?? { type: "object" },
      prompt,
      systemPrompt: systemPrompt || undefined,
      maxTokens: effectiveMaxTokens,
      userId,
    });
    return wrapAsInvokeResult(insight.raw, { model: insight.model });
  }

  // ─── Text branch ─────────────────────────────────────────────
  void wantsJsonSchema; // (covered above; kept for readability)
  const narrative = await generateNarrative({
    prompt,
    systemPrompt: systemPrompt || undefined,
    maxTokens: effectiveMaxTokens,
    userId,
  });
  return wrapAsInvokeResult(narrative.text, {
    model: narrative.model,
    promptTokens: narrative.tokensPrompt,
    completionTokens: narrative.tokensGenerated,
  });
}
