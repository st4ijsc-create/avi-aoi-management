/**
 * AI Vision-Language Model Service
 *
 * Provides natural-language analysis of inspection images — defect description,
 * image comparison, and QA report generation.
 *
 * WS-G2: vision runs 100% offline through the LOCAL llama-server mtmd sidecar
 * (Qwen2-VL GGUF + mmproj on 127.0.0.1), routed via aiProviderRouter.describeImage /
 * llamaVisionSidecar.describeImageViaSidecar. When the sidecar is not configured the
 * service degrades honestly to GGUF text-only (metadata) or static fallbacks — it
 * never fabricates a vision result.
 */
import { describeImage as routerDescribeImage } from "./aiProviderRouter";

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
    /** Force cloud (true) or local LLaVA (false). Default follows AI_PRIMARY_PROVIDER. */
    useCloudVision?: boolean;
  },
): Promise<DefectDescription> {
  const contextLines: string[] = [];
  if (context?.productModel) contextLines.push(`Product model: ${context.productModel}`);
  if (context?.machineCode) contextLines.push(`Machine: ${context.machineCode}`);
  if (context?.inspectionPoint) contextLines.push(`Inspection point: ${context.inspectionPoint}`);
  if (context?.existingLabels?.length) contextLines.push(`AI labels detected: ${context.existingLabels.join(", ")}`);

  const prompt = `You are an expert AOI (Automated Optical Inspection) quality engineer.
Analyze this inspection image and describe any defects found.

${contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}\n` : ""}
Respond with ONLY valid JSON matching this exact schema (no markdown fences, no commentary):
{
  "description": "<detailed natural language description of the defect(s) seen>",
  "severity": "<low|medium|high|critical>",
  "location": "<where on the component the defect is located>",
  "possibleCauses": ["<cause1>", "<cause2>"],
  "suggestedActions": ["<action1>", "<action2>"]
}

If no defect is found, set description to "No defect detected", severity to "low", and empty arrays for causes/actions.`;

  // Route through provider router (local LLaVA / GGUF vision sidecar only).
  // If vision is not configured, degrade to text-only GGUF or a static description.
  try {
    const result = await routerDescribeImage({
      image: imageBuffer,
      prompt,
      maxTokens: 800,
      temperature: 0.2,
      useCloudVision: context?.useCloudVision,
    });

    // Extract JSON (the local LLaVA model may add extra prose around the object)
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object in vision response");
    const parsed = JSON.parse(jsonMatch[0]) as DefectDescription;
    if (!parsed.description) throw new Error("Vision response missing 'description'");

    // Annotate provenance for downstream UI / audit
    if (result.provider === "gguf") {
      parsed.description += " (Local LLaVA vision)";
    }
    return parsed;
  } catch (err) {
    console.warn("[aiVisionLanguage] router describeImage failed, falling back to text-only GGUF:", err);
    const ggufResult = await ggufFallbackDescription(context);
    return ggufResult ?? buildStaticFallbackDescription(context?.existingLabels);
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
  // WS-G2: route to the LOCAL llama-server mtmd sidecar (100% offline vision).
  // Qwen2-VL / mtmd llama-server accepts multiple image_url parts in one message, so we
  // send both images together and ask for a single comparison JSON. If the sidecar is not
  // configured we degrade honestly to a static fallback (no fabricated comparison).
  const { isVisionSidecarAvailable, describeImageViaSidecar } = await import("./llamaVisionSidecar");
  if (!isVisionSidecarAvailable()) {
    return buildStaticFallbackComparison();
  }

  const compType = context?.comparisonType ?? "side_by_side";
  const compLabel =
    compType === "golden_vs_current"
      ? "The FIRST image is the GOLDEN SAMPLE (reference standard). The SECOND image is the CURRENT inspection."
      : compType === "before_after"
        ? "The FIRST image is BEFORE. The SECOND image is AFTER."
        : "Compare the FIRST and SECOND images.";

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
    const result = await describeImageViaSidecar({
      images: [imageA, imageB],
      prompt,
      maxTokens: 1024,
      temperature: 0.2,
    });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return buildStaticFallbackComparison();
    const parsed = JSON.parse(jsonMatch[0]) as ImageComparison;
    if (!parsed.summary) return buildStaticFallbackComparison();
    return parsed;
  } catch (err) {
    console.error("[aiVisionLanguage] compareImages failed:", err);
    return buildStaticFallbackComparison();
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
  // WS-G2: route to the LOCAL llama-server mtmd sidecar (100% offline vision).
  // When the sidecar is unavailable, fall back to the GGUF text-only report (metadata
  // based, clearly labelled) and finally a static report — never a fabricated VLM result.
  const { isVisionSidecarAvailable, describeImageViaSidecar } = await import("./llamaVisionSidecar");
  if (!isVisionSidecarAvailable()) {
    const ggufResult = await ggufFallbackReport(images, context);
    return ggufResult ?? buildStaticFallbackReport(images.length);
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

  try {
    const result = await describeImageViaSidecar({
      images: imageSlice.map((img) => img.buffer),
      prompt,
      maxTokens: 2048,
      temperature: 0.2,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const ggufResult = await ggufFallbackReport(images, context);
      return ggufResult ?? buildStaticFallbackReport(images.length);
    }
    const parsed = JSON.parse(jsonMatch[0]) as QAReport;
    if (!parsed.title || !Array.isArray(parsed.inspections)) {
      const ggufResult = await ggufFallbackReport(images, context);
      return ggufResult ?? buildStaticFallbackReport(images.length);
    }
    return parsed;
  } catch (err) {
    console.error("[aiVisionLanguage] generateQAReport failed:", err);
    const ggufResult = await ggufFallbackReport(images, context);
    return ggufResult ?? buildStaticFallbackReport(images.length);
  }
}

// ─── GGUF Text-based Fallbacks ────────────────────────────────────

/**
 * Use local GGUF model to generate a rich defect description from metadata.
 * Can't analyze images, but can reason about defect types from labels/context.
 */
async function ggufFallbackDescription(
  context?: {
    productModel?: string;
    machineCode?: string;
    inspectionPoint?: string;
    existingLabels?: string[];
  },
): Promise<DefectDescription | null> {
  const hasLabels = context?.existingLabels && context.existingLabels.length > 0;
  if (!hasLabels && !context?.inspectionPoint) return null; // Not enough metadata

  try {
    const { chatCompletion, isGgufAvailable } = await import("./aiGgufEngine");
    if (!(await isGgufAvailable())) return null;

    const contextLines: string[] = [];
    if (context?.productModel) contextLines.push(`Product model: ${context.productModel}`);
    if (context?.machineCode) contextLines.push(`Machine: ${context.machineCode}`);
    if (context?.inspectionPoint) contextLines.push(`Inspection point: ${context.inspectionPoint}`);
    if (hasLabels) contextLines.push(`AI classification labels: ${context!.existingLabels!.join(", ")}`);

    const prompt = `You are an AOI quality engineer. Based on the metadata below, provide a defect analysis.
Note: You cannot see the image, your analysis is based on the metadata only.

${contextLines.join("\n")}

Respond with ONLY valid JSON:
{
  "description": "<detailed analysis based on the metadata>",
  "severity": "<low|medium|high|critical>",
  "location": "<likely location based on inspection point>",
  "possibleCauses": ["<cause1>", "<cause2>"],
  "suggestedActions": ["<action1>", "<action2>"]
}`;

    const result = await chatCompletion({
      messages: [
        { role: "system", content: "You are a manufacturing quality expert. Output ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      maxTokens: 512,
      temperature: 0.2,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as DefectDescription;
    if (!parsed.description) return null;
    parsed.description += " (Analysis based on metadata — local LLM, no image analysis)";
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Use local GGUF model to generate a QA report from image labels/metadata.
 */
async function ggufFallbackReport(
  images: Array<{ label?: string; inspectionPoint?: string }>,
  context?: {
    productModel?: string;
    machineCode?: string;
    batchId?: string;
    date?: string;
  },
): Promise<QAReport | null> {
  const hasAnyLabels = images.some(img => img.label || img.inspectionPoint);
  if (!hasAnyLabels) return null;

  try {
    const { chatCompletion, isGgufAvailable } = await import("./aiGgufEngine");
    if (!(await isGgufAvailable())) return null;

    const contextLines: string[] = [];
    if (context?.productModel) contextLines.push(`Product: ${context.productModel}`);
    if (context?.machineCode) contextLines.push(`Machine: ${context.machineCode}`);
    if (context?.batchId) contextLines.push(`Batch: ${context.batchId}`);
    if (context?.date) contextLines.push(`Date: ${context.date}`);

    const imageDescriptions = images
      .slice(0, 10)
      .map((img, i) => {
        const parts = [`Image ${i + 1}`];
        if (img.label) parts.push(`label: ${img.label}`);
        if (img.inspectionPoint) parts.push(`point: ${img.inspectionPoint}`);
        return parts.join(", ");
      })
      .join("\n");

    const prompt = `You are an AOI quality engineer generating a QA report from metadata.
Note: You cannot see the images, your report is based on labels and metadata only.

${contextLines.length > 0 ? `Context:\n${contextLines.join("\n")}\n` : ""}
Image metadata:
${imageDescriptions}

Generate a QA report as ONLY valid JSON:
{
  "title": "<Report title>",
  "summary": "<summary based on available metadata>",
  "inspections": [
    {"imageIndex": 0, "verdict": "<OK|NG|BORDERLINE>", "defects": ["<from label>"], "notes": "<analysis>"}
  ],
  "overallVerdict": "<PASS|FAIL|REVIEW_NEEDED>",
  "recommendations": ["<recommendation>"]
}`;

    const result = await chatCompletion({
      messages: [
        { role: "system", content: "You are a manufacturing quality expert. Output ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      maxTokens: 1024,
      temperature: 0.3,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as QAReport;
    if (!parsed.title || !Array.isArray(parsed.inspections)) return null;
    parsed.summary += " (Report based on metadata — local LLM, no image analysis)";
    return parsed;
  } catch {
    return null;
  }
}

// ─── Static Fallbacks ────────────────────────────────────────────

function buildStaticFallbackDescription(labels?: string[]): DefectDescription {
  const hasLabels = labels && labels.length > 0;
  return {
    description: hasLabels
      ? `AI classification detected: ${labels.join(", ")}. Detailed VLM description unavailable.`
      : "VLM analysis unavailable. Configure OPENAI_API_KEY or load a GGUF model for defect descriptions.",
    severity: "medium",
    location: "Unknown — requires VLM analysis",
    possibleCauses: hasLabels
      ? ["Automated classification detected potential issues — manual verification recommended"]
      : [],
    suggestedActions: ["Configure OPENAI_API_KEY for detailed VLM analysis", "Review image manually"],
  };
}

function buildStaticFallbackComparison(): ImageComparison {
  return {
    summary: "Image comparison unavailable. Configure OPENAI_API_KEY to enable VLM-powered image comparison.",
    differences: [],
    overallSimilarity: 0,
    isAcceptable: false,
  };
}

function buildStaticFallbackReport(imageCount: number): QAReport {
  return {
    title: "QA Inspection Report (Limited)",
    summary: `Report covers ${imageCount} inspection image(s). Detailed VLM analysis unavailable — configure OPENAI_API_KEY or load a GGUF model for full reports.`,
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
