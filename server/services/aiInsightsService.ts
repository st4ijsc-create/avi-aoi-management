import { createHash } from "crypto";
import { generateInsightJson } from "./aiProviderRouter";

function hashKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

export interface TopFactor {
  factor: string;
  contribution: number;
  description: string;
}

export interface DefectStats {
  totalInspections: number;
  ngCount: number;
  defectRate: number;
  analysisType: string;
  machineCode?: string | null;
  productModelCode?: string | null;
}

export interface RCAInsight {
  summary: string;
  rootCauses: Array<{
    cause: string;
    probability: number;
    evidence: string;
  }>;
  recommendations: string[];
  preventiveMeasures: string[];
}

/**
 * Generate LLM-powered root cause analysis insights.
 * WS-G3: routes through aiProviderRouter (local GGUF only — cloud removed).
 * Falls back to rule-based insights when the local model is unavailable.
 */
export async function generateRCAInsights(
  topFactors: TopFactor[],
  stats: DefectStats,
): Promise<RCAInsight> {
  const factorsSummary = topFactors
    .slice(0, 5)
    .map((f, i) => `${i + 1}. ${f.factor} — ${f.contribution.toFixed(1)}% contribution: ${f.description}`)
    .join("\n");

  const prompt = `You are an AOI (Automated Optical Inspection) quality engineering expert.
Analyze the following defect data and provide root cause insights in JSON format.

Analysis type: ${stats.analysisType}
Machine: ${stats.machineCode ?? "all"}
Product model: ${stats.productModelCode ?? "all"}
Total inspections: ${stats.totalInspections}
Defect count: ${stats.ngCount}
Defect rate: ${stats.defectRate.toFixed(2)}%

Top contributing factors:
${factorsSummary || "No factors identified."}

Respond with ONLY valid JSON matching this exact schema (no markdown, no extra keys):
{
  "summary": "<2-3 sentence overview of the defect situation>",
  "rootCauses": [
    { "cause": "<name>", "probability": <0.0-1.0>, "evidence": "<one sentence>" }
  ],
  "recommendations": ["<actionable recommendation>", ...],
  "preventiveMeasures": ["<preventive measure>", ...]
}

Rules:
- rootCauses: 2-4 items, probability must sum ≤ 1.0
- recommendations: 3-5 concrete, specific actions
- preventiveMeasures: 3-4 systematic controls`;

  try {
    const systemPrompt = "You are an AOI quality engineering expert. Respond ONLY with valid JSON.";
    // doc 48 R1 — PIN the deep model the router chose for RCA (Tier 2). Grammar-constrained JSON
    // from the resident EMBEDDING model is structurally valid but semantically garbage; passing
    // decision.modelId lands this on a real generative model, mirroring aiRcaCopilot.
    const { route } = await import("./aiModelRouter");
    const decision = route({ task: "rca", requiredQuality: "high" });
    const result = await generateInsightJson<RCAInsight>({
      systemPrompt,
      prompt,
      modelId: decision.modelId,
      maxTokens: 1024,
      temperature: 0.2,
      jsonSchema: RCA_INSIGHT_SCHEMA,
      cacheKey: "rca:" + hashKey(systemPrompt, prompt),
    });

    const parsed = result.data;
    if (!parsed?.summary || !Array.isArray(parsed.rootCauses)) {
      return buildFallbackInsights(topFactors, stats);
    }
    return parsed;
  } catch (err) {
    console.error("[aiInsightsService] Provider router failed, using rule-based fallback:", err);
    return buildFallbackInsights(topFactors, stats);
  }
}

const RCA_INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    rootCauses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cause: { type: "string" },
          probability: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["cause", "probability", "evidence"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
    preventiveMeasures: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "rootCauses", "recommendations", "preventiveMeasures"],
} as const;

function buildFallbackInsights(topFactors: TopFactor[], stats: DefectStats): RCAInsight {
  const top = topFactors[0];
  const defectPct = stats.defectRate.toFixed(1);

  return {
    summary: `Analysis of ${stats.totalInspections} inspections found ${stats.ngCount} defects (${defectPct}% defect rate).${top ? ` The primary contributing factor is ${top.factor} at ${top.contribution.toFixed(1)}%.` : ""}`,
    rootCauses: topFactors.slice(0, 3).map((f) => ({
      cause: f.factor,
      probability: Math.min(f.contribution / 100, 0.99),
      evidence: f.description,
    })),
    recommendations: [
      top
        ? `Prioritize quality control on "${top.factor}" which accounts for ${top.contribution.toFixed(1)}% of defects`
        : "Continue monitoring all factors",
      "Implement preventive maintenance schedule for high-defect machines",
      "Review and standardize operator inspection procedures",
      "Set up automated alerts for defect rate thresholds",
    ],
    preventiveMeasures: [
      "Regular calibration of measurement and optical equipment",
      "Standardize inspection procedures with visual work instructions",
      "Implement Statistical Process Control (SPC) charts",
      "Conduct root cause analysis reviews after defect rate spikes",
    ],
  };
}
