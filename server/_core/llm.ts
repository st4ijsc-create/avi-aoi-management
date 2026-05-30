// WS-G3: LLM inference is now routed 100% through the local GGUF engine via
// aiProviderRouter (no cloud / forge call). The signature (InvokeParams →
// InvokeResult) is preserved so existing callers (inspectionRouters,
// annotationRouters) need no change. Vision is delegated to
// aiProviderRouter.describeImage (real output once the G2 vision sidecar is
// wired; fallback text until then).
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
    throw new Error(`Image not found for image_url: ${url}`);
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

/** Wrap a plain string + optional token counts into the OpenAI-shaped InvokeResult. */
function wrapAsInvokeResult(
  content: string,
  opts: { model?: string; promptTokens?: number; completionTokens?: number } = {}
): InvokeResult {
  const promptTokens = opts.promptTokens ?? 0;
  const completionTokens = opts.completionTokens ?? 0;
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
          tool_calls: [],
        },
        finish_reason: "stop",
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
 * invokeLLM — local-only inference via the GGUF engine (WS-G3).
 *
 * Signature is unchanged. Routing:
 *  - vision (any image_url present) → describeImage; if a json_schema is also
 *    requested, the description is then coerced to JSON via generateInsightJson.
 *  - json_schema / json_object response_format → generateInsightJson.
 *  - otherwise → generateNarrative (free text).
 *
 * params.tools / tool_choice are accepted for backward compatibility but
 * native tool-calling is not performed locally (no current caller uses it).
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

  // ─── Vision branch ───────────────────────────────────────────
  if (images.length > 0) {
    const description = await describeImage({
      image: images[0]!,
      prompt: prompt || systemPrompt,
      systemPrompt: systemPrompt || undefined,
      maxTokens: effectiveMaxTokens,
    });

    // Vision + structured output → coerce the description into the schema.
    if (jsonSchema) {
      const insight = await generateInsightJson({
        jsonSchema,
        prompt: `${prompt}\n\n[Image analysis]\n${description.text}`,
        systemPrompt: systemPrompt || undefined,
        maxTokens: effectiveMaxTokens,
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
    });
    return wrapAsInvokeResult(insight.raw, { model: insight.model });
  }

  // ─── Text branch ─────────────────────────────────────────────
  void wantsJsonSchema; // (covered above; kept for readability)
  const narrative = await generateNarrative({
    prompt,
    systemPrompt: systemPrompt || undefined,
    maxTokens: effectiveMaxTokens,
  });
  return wrapAsInvokeResult(narrative.text, {
    model: narrative.model,
    promptTokens: narrative.tokensPrompt,
    completionTokens: narrative.tokensGenerated,
  });
}
