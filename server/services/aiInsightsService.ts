import OpenAI from "openai";

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

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/**
 * Generate LLM-powered root cause analysis insights.
 * Falls back to rule-based insights when OPENAI_API_KEY is not configured.
 */
export async function generateRCAInsights(
  topFactors: TopFactor[],
  stats: DefectStats,
): Promise<RCAInsight> {
  const client = getClient();
  if (!client) {
    // Try GGUF before rule-based fallback
    const ggufResult = await tryGgufRCA(topFactors, stats, prompt);
    if (ggufResult) return ggufResult;
    return buildFallbackInsights(topFactors, stats);
  }

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
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as RCAInsight;

    // Validate required fields exist
    if (!parsed.summary || !Array.isArray(parsed.rootCauses)) {
      return buildFallbackInsights(topFactors, stats);
    }

    return parsed;
  } catch (err) {
    console.error("[aiInsightsService] LLM call failed, using fallback:", err);
    return buildFallbackInsights(topFactors, stats);
  }
}

/**
 * Try GGUF-powered RCA insights when OpenAI is unavailable.
 */
async function tryGgufRCA(
  topFactors: TopFactor[],
  stats: DefectStats,
  prompt: string,
): Promise<RCAInsight | null> {
  try {
    const { isGgufAvailable, generateText } = await import("./aiGgufEngine");
    if (!(await isGgufAvailable())) return null;

    const result = await generateText({
      systemPrompt: "You are an AOI quality engineering expert. Respond ONLY with valid JSON.",
      prompt,
      maxTokens: 1024,
      temperature: 0.2,
      jsonMode: true,
    });

    const parsed = JSON.parse(result.text) as RCAInsight;
    if (!parsed.summary || !Array.isArray(parsed.rootCauses)) return null;
    return parsed;
  } catch (err) {
    console.error("[aiInsightsService] GGUF RCA failed:", err);
    return null;
  }
}

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
