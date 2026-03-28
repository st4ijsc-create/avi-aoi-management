/**
 * AI Vision-Language Model Service
 *
 * Uses GPT-4o Vision API to provide natural language analysis of
 * inspection images — defect description, image comparison, and QA report generation.
 *
 * Requires OPENAI_API_KEY env var. Falls back to basic label-based descriptions
 * when the API key is not configured.
 */
import OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────

export interface DefectDescription {
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  location: string;
  possibleCauses: string[];
  suggestedActions: string[];
}

export interface ImageComparison {
  summary: string;
  differences: Array<{
    area: string;
    description: string;
    severity: "low" | "medium" | "high";
  }>;
  overallSimilarity: number; // 0-1
  isAcceptable: boolean;
}

export interface QAReport {
  title: string;
  summary: string;
  inspections: Array<{
    imageIndex: number;
    verdict: "OK" | "NG" | "BORDERLINE";
    defects: string[];
    notes: string;
  }>;
  overallVerdict: "PASS" | "FAIL" | "REVIEW_NEEDED";
  recommendations: string[];
}

// ─── Client ──────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
}

function imageToDataUrl(imageBuffer: Buffer, mimeType = "image/jpeg"): string {
  return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
}

// ─── Describe Defect ─────────────────────────────────────────────

/**
 * Analyze a single inspection image and describe defects in natural language.
 */
export async function describeDefect(
  imageBuffer: Buffer,
  context?: {
    productModel?: string;
    machineCode?: string;
    inspectionPoint?: string;
    existingLabels?: string[];
  },
): Promise<DefectDescription> {
  const client = getClient();
  if (!client) {
    return buildFallbackDescription(context?.existingLabels);
  }

  const contextLines: string[] = [];
  if (context?.productModel) contextLines.push(`Product model: ${context.productModel}`);
  if (context?.machineCode) contextLines.push(`Machine: ${context.machineCode}`);
  if (context?.inspectionPoint) contextLines.push(`Inspection point: ${context.inspectionPoint}`);
  if (context?.existingLabels?.length) contextLines.push(`AI labels detected: ${context.existingLabels.join(", ")}`);

  const prompt = `You are an expert AOI (Automated Optical Inspection) quality engineer.
Analyze this inspection image and describe any defects found.

${contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}\n` : ""}
Respond with ONLY valid JSON matching this exact schema:
{
  "description": "<detailed natural language description of the defect(s) seen>",
  "severity": "<low|medium|high|critical>",
  "location": "<where on the component the defect is located>",
  "possibleCauses": ["<cause1>", "<cause2>"],
  "suggestedActions": ["<action1>", "<action2>"]
}

If no defect is found, set description to "No defect detected", severity to "low", and empty arrays for causes/actions.`;

  try {
    const response = await client.chat.completions.create({
      model: getVisionModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageToDataUrl(imageBuffer), detail: "high" },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as DefectDescription;
    if (!parsed.description) return buildFallbackDescription(context?.existingLabels);
    return parsed;
  } catch (err) {
    console.error("[aiVisionLanguage] describeDefect failed:", err);
    return buildFallbackDescription(context?.existingLabels);
  }
}

// ─── Compare Images ──────────────────────────────────────────────

/**
 * Compare two inspection images and describe differences.
 * Useful for before/after, golden sample vs current, etc.
 */
export async function compareImages(
  imageA: Buffer,
  imageB: Buffer,
  context?: {
    productModel?: string;
    comparisonType?: "golden_vs_current" | "before_after" | "side_by_side";
  },
): Promise<ImageComparison> {
  const client = getClient();
  if (!client) {
    return buildFallbackComparison();
  }

  const compType = context?.comparisonType ?? "side_by_side";
  const compLabel =
    compType === "golden_vs_current"
      ? "Image A is the GOLDEN SAMPLE (reference standard). Image B is the CURRENT inspection."
      : compType === "before_after"
        ? "Image A is BEFORE. Image B is AFTER."
        : "Compare Image A and Image B.";

  const prompt = `You are an expert AOI (Automated Optical Inspection) quality engineer.
${compLabel}
${context?.productModel ? `Product model: ${context.productModel}` : ""}

Analyze both images and describe the differences.

Respond with ONLY valid JSON matching this exact schema:
{
  "summary": "<2-3 sentence overview of the comparison>",
  "differences": [
    { "area": "<location on component>", "description": "<what is different>", "severity": "<low|medium|high>" }
  ],
  "overallSimilarity": <0.0-1.0 score>,
  "isAcceptable": <true if differences are within acceptable quality range>
}

If the images look identical, return empty differences array, similarity 1.0, and isAcceptable true.`;

  try {
    const response = await client.chat.completions.create({
      model: getVisionModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageToDataUrl(imageA), detail: "high" },
            },
            {
              type: "image_url",
              image_url: { url: imageToDataUrl(imageB), detail: "high" },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as ImageComparison;
    if (!parsed.summary) return buildFallbackComparison();
    return parsed;
  } catch (err) {
    console.error("[aiVisionLanguage] compareImages failed:", err);
    return buildFallbackComparison();
  }
}

// ─── Generate QA Report ──────────────────────────────────────────

/**
 * Generate a QA inspection report from multiple images.
 * Max 10 images per report to stay within token limits.
 */
export async function generateQAReport(
  images: Array<{
    buffer: Buffer;
    label?: string;
    inspectionPoint?: string;
  }>,
  context?: {
    productModel?: string;
    machineCode?: string;
    batchId?: string;
    date?: string;
  },
): Promise<QAReport> {
  const client = getClient();
  if (!client) {
    return buildFallbackReport(images.length);
  }

  // Limit to 10 images
  const imageSlice = images.slice(0, 10);

  const contextLines: string[] = [];
  if (context?.productModel) contextLines.push(`Product: ${context.productModel}`);
  if (context?.machineCode) contextLines.push(`Machine: ${context.machineCode}`);
  if (context?.batchId) contextLines.push(`Batch: ${context.batchId}`);
  if (context?.date) contextLines.push(`Date: ${context.date}`);

  const imageDescriptions = imageSlice
    .map((img, i) => {
      const parts = [`Image ${i + 1}`];
      if (img.label) parts.push(`(label: ${img.label})`);
      if (img.inspectionPoint) parts.push(`at ${img.inspectionPoint}`);
      return parts.join(" ");
    })
    .join("\n");

  const prompt = `You are an expert AOI quality engineer generating a formal QA inspection report.

${contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}\n` : ""}
Images provided:
${imageDescriptions}

Analyze ALL images and generate a comprehensive QA report.

Respond with ONLY valid JSON matching this exact schema:
{
  "title": "<Report title>",
  "summary": "<3-5 sentence executive summary>",
  "inspections": [
    {
      "imageIndex": <0-based index>,
      "verdict": "<OK|NG|BORDERLINE>",
      "defects": ["<defect description>"],
      "notes": "<additional notes>"
    }
  ],
  "overallVerdict": "<PASS|FAIL|REVIEW_NEEDED>",
  "recommendations": ["<recommendation1>", "<recommendation2>"]
}

Include one entry in inspections for each image. Be specific and technical.`;

  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
  ];
  for (const img of imageSlice) {
    content.push({
      type: "image_url",
      image_url: { url: imageToDataUrl(img.buffer), detail: "auto" },
    });
  }

  try {
    const response = await client.chat.completions.create({
      model: getVisionModel(),
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const respContent = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(respContent) as QAReport;
    if (!parsed.title || !Array.isArray(parsed.inspections)) {
      return buildFallbackReport(images.length);
    }
    return parsed;
  } catch (err) {
    console.error("[aiVisionLanguage] generateQAReport failed:", err);
    return buildFallbackReport(images.length);
  }
}

// ─── Fallbacks ───────────────────────────────────────────────────

function buildFallbackDescription(labels?: string[]): DefectDescription {
  const hasLabels = labels && labels.length > 0;
  return {
    description: hasLabels
      ? `AI classification detected: ${labels.join(", ")}. Detailed VLM description unavailable (OPENAI_API_KEY not configured).`
      : "VLM analysis unavailable. Configure OPENAI_API_KEY to enable natural language defect descriptions.",
    severity: "medium",
    location: "Unknown — requires VLM analysis",
    possibleCauses: hasLabels
      ? ["Automated classification detected potential issues — manual verification recommended"]
      : [],
    suggestedActions: ["Configure OPENAI_API_KEY for detailed VLM analysis", "Review image manually"],
  };
}

function buildFallbackComparison(): ImageComparison {
  return {
    summary: "Image comparison unavailable. Configure OPENAI_API_KEY to enable VLM-powered image comparison.",
    differences: [],
    overallSimilarity: 0,
    isAcceptable: false,
  };
}

function buildFallbackReport(imageCount: number): QAReport {
  return {
    title: "QA Inspection Report (Limited)",
    summary: `Report covers ${imageCount} inspection image(s). Detailed VLM analysis unavailable — configure OPENAI_API_KEY for full reports.`,
    inspections: Array.from({ length: imageCount }, (_, i) => ({
      imageIndex: i,
      verdict: "BORDERLINE" as const,
      defects: [],
      notes: "VLM analysis not available",
    })),
    overallVerdict: "REVIEW_NEEDED",
    recommendations: [
      "Configure OPENAI_API_KEY to enable AI-powered QA reports",
      "Review all images manually",
    ],
  };
}
