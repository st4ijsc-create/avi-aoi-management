/**
 * Vision → Defect Proposal (P4-F "vision-close-loop")
 *
 * Closes the loop between the bolt-on vision tools (advanced vision lab /
 * anomaly / segmentation / image search / vision-language) and the inspection
 * data. A vision/anomaly finding can PROPOSE a defect record. The proposal
 * NEVER writes directly — it goes through the existing HITL lifecycle
 * (aiCopilotActions.proposeAction → aiCopilot.confirmAction → execute), so the
 * defect is only written into measurement_results AFTER a human approves.
 *
 * Two write modes (both gated by quality-level rights = the same RBAC the
 * inspectionRouters.classifyDefect mutation uses, see mapping below):
 *
 *   1. ATTACH  — input.measurementResultId given → set defectCatalogId
 *                (+ severity + optional bbox) on an EXISTING result.
 *                Mirrors measurementResult.classifyDefect (NG-only).
 *   2. CREATE  — input.inspectionId + input.pointDefId given → INSERT a new
 *                NG measurement_results row carrying the mapped defect code.
 *
 * Defect-code mapping: a vision finding carries a free-text suggested type
 * (e.g. "bridging", "missing component"). mapVisionFindingToDefect() does a
 * best-effort match against defect_catalog (code / name / category, keyword
 * heuristics for common IPC-A-610 defects). The user can ALWAYS override the
 * resolved code in the confirm dialog (defectCatalogId is part of the args the
 * preview is computed from, so an override re-proposes with the chosen code).
 *
 * RBAC: requiredPermission mirrors quality-inspector rights. The HITL flow
 * checks it twice (propose + execute); read-only roles get a denied result and
 * nothing is written.
 */

import { z } from "zod";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "./aiLocalTools/toolRegistry";
import type { AuditChangeField } from "./auditTrailService";
import { listDefectCatalog, getDefectCatalogById } from "../db/product";
import {
  getMeasurementResultById,
  createMeasurementResult,
  getInspectionById,
} from "../db/inspection";
import { getDb } from "../db/connection";

// ─── Defect-code mapping (vision finding text → defect_catalog entry) ─────────

export interface DefectCatalogLite {
  id: number;
  code: string;
  name: string;
  nameVi?: string | null;
  category: string;
  severity: string;
  ipcReference?: string | null;
}

export interface DefectMatch {
  catalog: DefectCatalogLite;
  score: number; // 0..1 confidence of the text→code match
  matchedOn: "code" | "name" | "keyword" | "category";
}

/**
 * Keyword → catalog-code hints for common AOI/AVI defects. Lowercased.
 * Best-effort only; the resolved code is always user-overridable in confirm.
 */
const KEYWORD_HINTS: Array<{ keywords: string[]; codes: string[] }> = [
  { keywords: ["bridge", "bridging", "short", "cầu chì hàn", "chập"], codes: ["BRIDGING", "SOLDER_BRIDGE", "SHORT"] },
  { keywords: ["tombstone", "tombstoning", "dựng đứng"], codes: ["TOMBSTONING", "TOMBSTONE"] },
  { keywords: ["missing", "absent", "thiếu", "mất linh kiện"], codes: ["MISSING_COMPONENT", "MISSING", "MISSING_PART"] },
  { keywords: ["insufficient", "insufficient solder", "thiếu thiếc", "ít thiếc"], codes: ["INSUFFICIENT_SOLDER", "INSUFFICIENT"] },
  { keywords: ["solder ball", "ball", "bi thiếc"], codes: ["SOLDER_BALL", "SOLDERBALL"] },
  { keywords: ["void", "voids", "rỗ", "bọt khí"], codes: ["VOID", "VOIDING"] },
  { keywords: ["lifted", "lift", "lifted lead", "chân nhấc"], codes: ["LIFTED_LEAD", "LIFTED"] },
  { keywords: ["offset", "shift", "misalign", "lệch", "xê dịch"], codes: ["OFFSET", "MISALIGNMENT", "SHIFT"] },
  { keywords: ["polarity", "reversed", "wrong polarity", "ngược cực"], codes: ["WRONG_POLARITY", "POLARITY", "REVERSED"] },
  { keywords: ["scratch", "scratches", "trầy", "xước"], codes: ["SCRATCH", "SCRATCHES"] },
  { keywords: ["crack", "cracked", "nứt", "vỡ"], codes: ["CRACK", "CRACKED"] },
  { keywords: ["contamination", "dirty", "foreign", "bẩn", "dị vật"], codes: ["CONTAMINATION", "FOREIGN_MATERIAL"] },
  { keywords: ["wrong", "wrong part", "incorrect", "sai linh kiện"], codes: ["WRONG_COMPONENT", "WRONG_PART"] },
  { keywords: ["cold", "cold joint", "mối hàn nguội"], codes: ["COLD_JOINT", "COLD_SOLDER"] },
];

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Best-effort map a free-text vision finding to a defect_catalog entry.
 * Returns ranked matches (highest first). Empty when the catalog has no
 * plausible entry — the UI then asks the user to pick one explicitly.
 */
export async function mapVisionFindingToDefect(
  findingText: string,
  opts?: { category?: string; limit?: number },
): Promise<DefectMatch[]> {
  const text = norm(findingText);
  if (!text) return [];

  const catalogRaw = await listDefectCatalog({ category: opts?.category });
  const catalog: DefectCatalogLite[] = catalogRaw.map((c: any) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    nameVi: c.nameVi ?? null,
    category: c.category,
    severity: c.severity,
    ipcReference: c.ipcReference ?? null,
  }));
  if (catalog.length === 0) return [];

  const byCode = new Map(catalog.map((c) => [norm(c.code), c]));
  const matches: DefectMatch[] = [];
  const seen = new Set<number>();

  const push = (catalog: DefectCatalogLite, score: number, matchedOn: DefectMatch["matchedOn"]) => {
    if (seen.has(catalog.id)) return;
    seen.add(catalog.id);
    matches.push({ catalog, score, matchedOn });
  };

  // 1. Exact / substring code match (highest confidence).
  for (const c of catalog) {
    const code = norm(c.code);
    if (code === text) push(c, 1, "code");
    else if (text.includes(code) || code.includes(text)) push(c, 0.85, "code");
  }

  // 2. Keyword hints → catalog codes.
  for (const hint of KEYWORD_HINTS) {
    if (hint.keywords.some((kw) => text.includes(kw))) {
      for (const code of hint.codes) {
        const c = byCode.get(norm(code));
        if (c) push(c, 0.75, "keyword");
      }
    }
  }

  // 3. Name / nameVi substring match.
  for (const c of catalog) {
    const name = norm(c.name);
    const nameVi = c.nameVi ? norm(c.nameVi) : "";
    if ((name && (text.includes(name) || name.includes(text))) ||
        (nameVi && (text.includes(nameVi) || nameVi.includes(text)))) {
      push(c, 0.6, "name");
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, opts?.limit ?? 5);
}

// ─── Write tool: propose_defect_from_vision (HITL) ───────────────────────────

const proposeParams = z
  .object({
    // Target — exactly one mode:
    //  attach: provide measurementResultId
    //  create: provide inspectionId + pointDefId
    measurementResultId: z.number().int().positive().nullable().optional(),
    inspectionId: z.number().int().positive().nullable().optional(),
    pointDefId: z.number().int().positive().nullable().optional(),

    // Classification — resolved/overridden by the user in the confirm dialog.
    defectCatalogId: z.number().int().positive(),

    // Provenance — which vision tool produced this finding (for audit/remark).
    source: z
      .enum(["advanced_vision", "anomaly", "segmentation", "image_search", "vision_language"])
      .default("advanced_vision"),
    findingText: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),

    // Optional defect location on the board image (pixels).
    bbox: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      })
      .nullable()
      .optional(),
    imageKey: z.string().max(255).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => !!v.measurementResultId || (!!v.inspectionId && !!v.pointDefId),
    { message: "Provide measurementResultId (attach) OR inspectionId + pointDefId (create)" },
  );

type ProposeParams = z.infer<typeof proposeParams>;

function srcLabel(source: ProposeParams["source"]): string {
  switch (source) {
    case "anomaly": return "Anomaly detection";
    case "segmentation": return "Segmentation";
    case "image_search": return "Image search";
    case "vision_language": return "Vision-language";
    case "advanced_vision":
    default: return "Advanced vision";
  }
}

function summarize(p: ProposeParams, lang: ToolLang): string {
  const mode = p.measurementResultId ? `result #${p.measurementResultId}` : `inspection #${p.inspectionId}`;
  switch (lang) {
    case "en":
      return `Classify a vision finding (${srcLabel(p.source)}) as defect code #${p.defectCatalogId} on ${mode}.`;
    case "zh":
      return `将视觉发现 (${srcLabel(p.source)}) 分类为缺陷代码 #${p.defectCatalogId}，目标 ${mode}。`;
    case "vi":
    default:
      return `Phân loại phát hiện thị giác (${srcLabel(p.source)}) thành mã lỗi #${p.defectCatalogId} cho ${mode}.`;
  }
}

async function preview(p: ProposeParams, _ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];

  const catalog = await getDefectCatalogById(p.defectCatalogId);
  if (!catalog) {
    warnings.push(`Không tìm thấy mã lỗi #${p.defectCatalogId} trong defect_catalog.`);
  }
  const defectName = catalog ? `${catalog.code} — ${catalog.name}` : `#${p.defectCatalogId}`;
  const severity = catalog?.severity ?? null;

  const changes: AuditChangeField[] = [];

  if (p.measurementResultId) {
    // ATTACH mode — mirror classifyDefect (NG-only guard).
    const result = await getMeasurementResultById(p.measurementResultId);
    if (!result) {
      warnings.push(`Không tìm thấy measurement result #${p.measurementResultId}.`);
    } else {
      if (result.result === "OK") {
        warnings.push("Result hiện đang OK — chỉ NG/NTF mới gắn được mã lỗi. Xác nhận sẽ chuyển sang NG.");
      }
      changes.push({
        field: "defectCatalogId",
        oldValue: result.defectCatalogId ?? null,
        newValue: p.defectCatalogId,
        displayName: "Defect code",
      });
      if (result.result === "OK") {
        changes.push({ field: "result", oldValue: result.result, newValue: "NG", displayName: "Result" });
      }
      if (severity) {
        changes.push({ field: "defectSeverity", oldValue: result.defectSeverity ?? null, newValue: severity, displayName: "Severity" });
      }
    }
    return {
      entityType: "measurement_result",
      entityId: p.measurementResultId,
      entityName: defectName,
      changes,
      warnings,
      humanSummary: summarize(p, _ctx.lang),
    };
  }

  // CREATE mode — new NG measurement_results row.
  const inspection = await getInspectionById(p.inspectionId!);
  if (!inspection) {
    warnings.push(`Không tìm thấy inspection #${p.inspectionId}.`);
  }
  changes.push(
    { field: "inspectionId", oldValue: null, newValue: p.inspectionId, displayName: "Inspection" },
    { field: "pointDefId", oldValue: null, newValue: p.pointDefId, displayName: "Measurement point" },
    { field: "result", oldValue: null, newValue: "NG", displayName: "Result" },
    { field: "defectCatalogId", oldValue: null, newValue: p.defectCatalogId, displayName: "Defect code" },
  );
  if (severity) {
    changes.push({ field: "defectSeverity", oldValue: null, newValue: severity, displayName: "Severity" });
  }
  return {
    entityType: "measurement_result",
    // no entityId — this is a CREATE
    entityName: defectName,
    changes,
    warnings,
    humanSummary: summarize(p, _ctx.lang),
  };
}

async function execute(p: ProposeParams, ctx: ToolExecContext) {
  const db = await getDb();
  if (!db) {
    return {
      type: "action_result" as const,
      title: "Không thể ghi lỗi",
      data: { ok: false, reason: "DB_UNAVAILABLE" },
      textSummary: "Database không khả dụng.",
    };
  }

  const catalog = await getDefectCatalogById(p.defectCatalogId);
  if (!catalog) {
    return {
      type: "action_result" as const,
      title: "Mã lỗi không hợp lệ",
      data: { ok: false, reason: "DEFECT_NOT_FOUND" },
      textSummary: `Không tìm thấy mã lỗi #${p.defectCatalogId}.`,
    };
  }
  const severity = catalog.severity ?? null;
  const remark = [
    `[vision:${p.source}]`,
    p.findingText ? p.findingText.slice(0, 200) : null,
    p.confidence != null ? `conf=${p.confidence.toFixed(3)}` : null,
  ].filter(Boolean).join(" ");

  if (p.measurementResultId) {
    // ATTACH — set defectCatalogId (+ severity, bbox, force NG) on existing row.
    const { measurementResults } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const existing = await getMeasurementResultById(p.measurementResultId);
    const setVals: Record<string, unknown> = {
      defectCatalogId: p.defectCatalogId,
      defectSeverity: severity,
    };
    if (existing && existing.result === "OK") setVals.result = "NG";
    if (p.bbox) {
      setVals.defectBboxX = p.bbox.x;
      setVals.defectBboxY = p.bbox.y;
      setVals.defectBboxW = p.bbox.w;
      setVals.defectBboxH = p.bbox.h;
    }
    if (p.imageKey) setVals.defectCropKey = p.imageKey;
    if (remark) {
      setVals.remark = existing?.remark ? `${existing.remark}\n${remark}` : remark;
    }
    await db.update(measurementResults).set(setVals).where(eq(measurementResults.id, p.measurementResultId));

    return {
      type: "action_result" as const,
      title: `Đã gắn mã lỗi ${catalog.code} cho result #${p.measurementResultId}`,
      data: { ok: true, mode: "attach", measurementResultId: p.measurementResultId, defectCatalogId: p.defectCatalogId, defectCode: catalog.code, defectSeverity: severity },
      textSummary: summarize(p, ctx.lang),
    };
  }

  // CREATE — new NG measurement_results row.
  const newId = await createMeasurementResult({
    inspectionId: p.inspectionId!,
    pointDefId: p.pointDefId!,
    result: "NG",
    defectCatalogId: p.defectCatalogId,
    defectSeverity: severity,
    aiConfidence: p.confidence != null ? p.confidence.toFixed(4) : null,
    imageKey: p.imageKey ?? null,
    defectBboxX: p.bbox?.x ?? null,
    defectBboxY: p.bbox?.y ?? null,
    defectBboxW: p.bbox?.w ?? null,
    defectBboxH: p.bbox?.h ?? null,
    remark: remark || null,
  } as any);

  return {
    type: "action_result" as const,
    title: `Đã tạo NG result #${newId} (${catalog.code})`,
    data: { ok: true, mode: "create", measurementResultId: newId, inspectionId: p.inspectionId, defectCatalogId: p.defectCatalogId, defectCode: catalog.code, defectSeverity: severity },
    textSummary: summarize(p, ctx.lang),
  };
}

/**
 * Write tool. requiredPermission mirrors the quality-inspector rights used by
 * inspectionRouters.classifyDefect (qualityProcedure). The HITL flow enforces
 * it twice; read-only roles cannot propose.
 */
export const proposeDefectFromVisionTool: Tool<ProposeParams, { ok: boolean }> = {
  name: "propose_defect_from_vision",
  description:
    "Đề xuất một bản ghi lỗi (defect) từ phát hiện thị giác/anomaly. WRITE-ACTION qua HITL: " +
    "gắn defectCatalogId vào measurement result hiện có, hoặc tạo NG result mới. " +
    "Chỉ ghi sau khi người dùng xác nhận.",
  parameters: proposeParams,
  triggers: [
    "propose defect", "đề xuất lỗi", "gắn lỗi", "classify defect from vision",
    "tạo lỗi từ ảnh", "vision defect",
  ],
  kind: "write",
  // Same RBAC surface as inspection result correction / classification
  // (history_correct = admin/supervisor/quality_inspector, mirrors qualityProcedure).
  requiredPermission: { module: "history_correct", action: "canEdit" },
  summarize,
  preview,
  execute,
};

registerTool(proposeDefectFromVisionTool);
