/**
 * Unified AI Provider Manager
 * Determines which AI backend is available and provides a consistent interface
 * for querying AI provider status across all system services.
 *
 * WS-G3: cloud (OpenAI) inference removed. Priority: GGUF > Offline (rule-based).
 * The `openai` status field is retained (always available:false) for UI
 * backward-compatibility (AIGgufModelsPage / AIHub reference it).
 */

export type AIProvider = "openai" | "gguf" | "offline";

export interface AIProviderStatus {
  activeProvider: AIProvider;
  openai: { available: boolean; model: string | null };
  gguf: { available: boolean; modelName: string | null; gpuEnabled: boolean };
}

/** Check which AI providers are currently available and return status */
export async function getAIProviderStatus(): Promise<AIProviderStatus> {
  const status: AIProviderStatus = {
    activeProvider: "offline",
    openai: { available: false, model: null },
    gguf: { available: false, modelName: null, gpuEnabled: false },
  };

  // Cloud (OpenAI) inference removed in WS-G3 — openai stays available:false.

  // Check GGUF (local, primary)
  try {
    const { isGgufAvailable, getLoadedGgufModels } = await import("./aiGgufEngine");
    if (await isGgufAvailable()) {
      const loaded = await getLoadedGgufModels();
      status.gguf.available = true;
      status.gguf.modelName = loaded[0]?.modelName ?? null;
      status.gguf.gpuEnabled = process.env.GGUF_GPU !== "false";
      status.activeProvider = "gguf";
    }
  } catch {
    // GGUF module not available
  }

  return status;
}

/** Get the highest-priority available provider (WS-G3: GGUF > offline). */
export async function getActiveProvider(): Promise<AIProvider> {
  try {
    const { isGgufAvailable } = await import("./aiGgufEngine");
    if (await isGgufAvailable()) return "gguf";
  } catch {
    // ignore
  }

  return "offline";
}

/** Human-readable label for each provider */
export function getProviderLabel(provider: AIProvider, lang: string = "vi"): string {
  const labels: Record<AIProvider, Record<string, string>> = {
    openai: { vi: "OpenAI API", en: "OpenAI API", zh: "OpenAI API" },
    gguf: { vi: "Local LLM (GGUF)", en: "Local LLM (GGUF)", zh: "本地 LLM (GGUF)" },
    offline: { vi: "Offline (quy tắc)", en: "Offline (rule-based)", zh: "离线（规则）" },
  };
  return labels[provider][lang] ?? labels[provider]["en"]!;
}
