/**
 * useAIStream — React hook for SSE-based AI chat streaming
 *
 * Connects to /api/ai/stream/chat via fetch + ReadableStream,
 * accumulates tokens in real-time, and returns the streaming state.
 */

import { useState, useRef, useCallback } from "react";

interface StreamMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  jsonMode?: boolean;
}

interface StreamResult {
  fullText: string;
  tokensGenerated?: number;
  tokensPrompt?: number;
  totalTimeMs?: number;
  tokensPerSecond?: number;
  modelId?: string;
}

export function useAIStream() {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    async (
      messages: StreamMessage[],
      options?: StreamOptions,
    ): Promise<StreamResult | null> => {
      setIsStreaming(true);
      setStreamingText("");
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/ai/stream/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messages, ...options }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            errBody.error || `Stream failed (${response.status})`,
          );
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";
        let result: StreamResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              if (chunk.type === "token") {
                fullText += chunk.token;
                setStreamingText(fullText);
              } else if (chunk.type === "done") {
                result = {
                  fullText: chunk.fullText ?? fullText,
                  tokensGenerated: chunk.tokensGenerated,
                  tokensPrompt: chunk.tokensPrompt,
                  totalTimeMs: chunk.totalTimeMs,
                  tokensPerSecond: chunk.tokensPerSecond,
                  modelId: chunk.modelId,
                };
              } else if (chunk.type === "error") {
                throw new Error(chunk.error);
              }
            } catch (parseErr: any) {
              if (parseErr.message && !parseErr.message.includes("JSON")) {
                throw parseErr;
              }
              // Ignore JSON parse errors for malformed chunks
            }
          }
        }

        setIsStreaming(false);
        return result ?? { fullText };
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message);
        }
        setIsStreaming(false);
        return null;
      }
    },
    [],
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { streamingText, isStreaming, error, startStream, stopStream };
}
