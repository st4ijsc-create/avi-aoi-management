/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — IR PROGRAMMING router.  Flag: DPC_IR_V2_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the IR programming layer. IR flows are a program KIND ("ir-flow")
 * stored in the EXISTING program_artifacts.content (as JSON) and driven through the
 * EXISTING programmingService gate. This router adds IR-SPECIFIC affordances:
 *
 *   READS (machine_monitoring / canView):
 *     • status              — flag snapshot.
 *     • listFlows           — list ir-flow artifacts (summarised).
 *     • getFlow             — fetch one ir-flow artifact + its parsed summary.
 *     • lint(flow)          — run the semantic safety linter on an ad-hoc flow.
 *     • transpilePreview    — lint + transpile a flow → { code, diagnostics, irCommentMap }.
 *
 *   MUTATIONS (machine_control + requireFlag(DPC_IR_V2_ENABLED)):
 *     • saveFlow            — create/append an ir-flow ARTIFACT (content = IR JSON) then
 *                             validate it via the EXISTING programmingService (shape +
 *                             linter). REUSES the gated programming path; NO new gate.
 *     • requestBuild        — compile (transpile) an ir-flow artifact via the EXISTING
 *                             buildArtifact service (linter hard-gate lives in the adapter).
 *
 * SAFETY (ABSOLUTE): this router opens NO device path. A real deploy/rollback of an IR
 * build still goes through the EXISTING programmingRouter.deployBuild / rollbackDeployment
 * (DPC_DEPLOY_ENABLED + HITL sign-off in programmingService) — deliberately NOT re-exposed
 * here. lint/transpilePreview are PURE (no persistence, no device I/O). ctx.user is the
 * source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, writeProcedure as writeBase } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_ENGINEERING (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_ENGINEERING");
// Doc 54 Wave B — IR authoring writes (saveFlow/requestBuild) get a write floor
// (blocks read-only roles viewer/user) so a stray machine_control bit can't
// author+compile, plus the same MOD_ENGINEERING license gate. The per-user
// `requirePermission("machine_control", ...)` bit still composes on top.
const writeProcedure = writeBase.use(moduleGate("MOD_ENGINEERING"));
import { requirePermission } from "../_core/accessControl";
import { isUniqueViolation } from "../_core/dbErrors";
import { getDb } from "../db/connection";
import { programProjects, programArtifacts } from "../../drizzle/schema";
import {
  validateArtifact,
  buildArtifact,
  hashContent,
  type DpcUser,
} from "../services/programming/programmingService";
import {
  flowSchema,
  parseFlowJson,
  type Flow,
} from "../services/programming/ir/irModel";
import { lintFlow } from "../services/programming/ir/irSafetyLinter";
import { previewTranspile, summariseFlow } from "../services/programming/ir/irAdapter";
import { TRANSPILE_TARGETS, type TranspileTarget } from "../services/programming/ir/transpilers/registry";
import { diffFlows } from "../services/programming/ir/irDiff";
import { mergeFlows } from "../services/programming/ir/irMerge";
import { recordAuditEvent } from "../services/audit/controlAuditService";

/** Flag: the IR-specific MUTATIONS require DPC_IR_V2_ENABLED (default OFF). */
export function dpcIrV2Enabled(): boolean {
  return process.env.DPC_IR_V2_ENABLED === "true" || process.env.DPC_IR_V2_ENABLED === "1";
}

function requireFlag() {
  if (!dpcIrV2Enabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "irProgramming" }, "IR programming disabled (set DPC_IR_V2_ENABLED=true)");
  }
}

function toDpcUser(user: { id: number; role: string; name?: string | null }): DpcUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

const TARGET = z.enum(TRANSPILE_TARGETS as [TranspileTarget, ...TranspileTarget[]]);

/** Parse an ir-flow artifact's content → Flow (or a 400). */
function parseOrThrow(content: string | null): Flow {
  const parsed = parseFlowJson(content ?? "");
  if (!parsed.ok) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "irFlow" },
      `Invalid IR flow: ${parsed.errors.map((e) => `${e.path || "<root>"}: ${e.message}`).join("; ")}`,
    );
  }
  return parsed.flow;
}

/** Load one ir-flow artifact + its parsed Flow (NOT_FOUND / BAD_REQUEST on mismatch). */
async function loadArtifactFlow(
  d: Awaited<ReturnType<typeof db>>,
  artifactId: number,
): Promise<{ flow: Flow; branch: string; version: number; projectId: number }> {
  const [row] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${artifactId} not found`);
  if (row.kind !== "ir-flow") throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "artifactKind" }, `Artifact ${artifactId} is not an ir-flow.`);
  return { flow: parseOrThrow(row.content), branch: row.branch, version: row.version, projectId: row.projectId };
}

export const irRouter = router({
  /** UI gating hint — is the IR flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: dpcIrV2Enabled(), targets: TRANSPILE_TARGETS })),

  /** List ir-flow artifacts (optionally scoped to a project), summarised. */
  listFlows: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      let rows = await d
        .select()
        .from(programArtifacts)
        .where(eq(programArtifacts.kind, "ir-flow"))
        .orderBy(desc(programArtifacts.id))
        .limit(input?.limit ?? 200);
      if (input?.projectId) rows = rows.filter((r) => r.projectId === input.projectId);
      return rows.map((r) => {
        const parsed = parseFlowJson(r.content ?? "");
        return {
          id: r.id,
          projectId: r.projectId,
          branch: r.branch,
          version: r.version,
          status: r.status,
          summary: parsed.ok ? summariseFlow(parsed.flow) : null,
        };
      });
    }),

  /** Fetch one ir-flow artifact + a parsed summary. */
  getFlow: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, input.artifactId)).limit(1);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${input.artifactId} not found`);
      if (row.kind !== "ir-flow") throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "artifactKind" }, `Artifact ${input.artifactId} is not an ir-flow.`);
      const parsed = parseFlowJson(row.content ?? "");
      return { artifact: row, flow: parsed.ok ? parsed.flow : null, summary: parsed.ok ? summariseFlow(parsed.flow) : null };
    }),

  /** Run the SEMANTIC safety linter on an ad-hoc flow (pure; no persistence). */
  lint: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ flow: flowSchema }))
    .query(({ input }) => lintFlow(input.flow)),

  /**
   * Lint + transpile a flow → { code, diagnostics, irCommentMap }. The linter is the HARD
   * GATE: errors block codegen (ok:false, code null). Pure — no persistence, no device I/O.
   */
  transpilePreview: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ flow: flowSchema, target: TARGET.optional() }))
    .query(({ input }) => previewTranspile(input.flow, input.target)),

  // ── P5: block-level DIFF + dry-run 3-way MERGE (pure reads; no persistence) ──

  /**
   * Block-level diff of two ad-hoc flows (e.g. the in-editor draft vs a saved version).
   * PURE — no persistence, no device I/O. Deterministic.
   */
  diff: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ before: flowSchema, after: flowSchema }))
    .query(({ input }) => diffFlows(input.before, input.after)),

  /**
   * Block-level diff of two STORED ir-flow versions (by artifact id). Reuses the existing
   * append-only version storage — no new tables, no writes.
   */
  diffVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ beforeArtifactId: z.number().int().positive(), afterArtifactId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const before = await loadArtifactFlow(d, input.beforeArtifactId);
      const after = await loadArtifactFlow(d, input.afterArtifactId);
      return {
        diff: diffFlows(before.flow, after.flow),
        before: { artifactId: input.beforeArtifactId, branch: before.branch, version: before.version },
        after: { artifactId: input.afterArtifactId, branch: after.branch, version: after.version },
      };
    }),

  /**
   * Dry-run 3-way merge of three ad-hoc flows (base + ours + theirs) → merged flow +
   * conflicts. PURE — no persistence, no device I/O. Nothing is written; the caller decides
   * whether to save the merged flow via the (gated) saveFlow path.
   */
  merge: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ base: flowSchema, ours: flowSchema, theirs: flowSchema }))
    .query(({ input }) => mergeFlows(input.base, input.ours, input.theirs)),

  /**
   * Dry-run 3-way merge of two STORED branches against a common ancestor (all by artifact
   * id). Reuses the existing version storage; NOTHING is written — this is a preview so a
   * human can review conflicts before saving.
   */
  mergeVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      baseArtifactId: z.number().int().positive(),
      oursArtifactId: z.number().int().positive(),
      theirsArtifactId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const d = await db();
      const base = await loadArtifactFlow(d, input.baseArtifactId);
      const ours = await loadArtifactFlow(d, input.oursArtifactId);
      const theirs = await loadArtifactFlow(d, input.theirsArtifactId);
      return {
        result: mergeFlows(base.flow, ours.flow, theirs.flow),
        base: { artifactId: input.baseArtifactId, branch: base.branch, version: base.version },
        ours: { artifactId: input.oursArtifactId, branch: ours.branch, version: ours.version },
        theirs: { artifactId: input.theirsArtifactId, branch: theirs.branch, version: theirs.version },
      };
    }),

  // ── MUTATIONS (gated: DPC_IR_V2_ENABLED + the EXISTING programming gate) ──

  /**
   * Create/append an ir-flow ARTIFACT (content = IR JSON) on a project, then validate it
   * via the EXISTING programmingService (shape + semantic linter). REUSES the gated
   * programming path — no new gate. Requires the project to be of kind "ir-flow".
   */
  saveFlow: writeProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      projectId: z.number().int().positive(),
      branch: z.string().min(1).max(64).default("main"),
      flow: flowSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, input.projectId)).limit(1);
      if (!proj) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingProject" }, `Project ${input.projectId} not found`);
      if (proj.kind !== "ir-flow") {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "projectKind" }, `Project ${input.projectId} is kind "${proj.kind}", not "ir-flow".`);
      }

      const content = JSON.stringify(input.flow);
      const contentHash = hashContent(content);

      // Next version on this branch = max(existing)+1 (mirrors programmingRouter.createArtifact).
      // doc 54 Wave C — the read-max-then-insert is NOT atomic: two concurrent saveFlow
      // calls on the same (projectId, branch) compute the same version and one loses on the
      // unique index uq_prog_artifact_version (previously a raw 500). Recompute the max and
      // retry the insert on a unique violation (bounded); monotonic max+1 SEMANTICS are
      // unchanged. After MAX_ATTEMPTS collisions we surface a clean CONFLICT.
      const insertVersioned = async () => {
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const existing = await d.select().from(programArtifacts).where(eq(programArtifacts.projectId, input.projectId));
          const onBranch = existing.filter((a) => a.branch === input.branch);
          const version = onBranch.reduce((m, a) => Math.max(m, a.version), 0) + 1;
          try {
            const [inserted] = await d
              .insert(programArtifacts)
              .values({
                projectId: input.projectId,
                branch: input.branch,
                version,
                kind: "ir-flow",
                language: "ir-json",
                content,
                contentHash,
                status: "draft",
                createdBy: ctx.user.id,
              })
              .returning();
            return { row: inserted, version };
          } catch (err) {
            if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue; // recompute max + retry
            if (isUniqueViolation(err)) {
              throw appError(
                "CONFLICT",
                "OPERATION_FAILED",
                { operation: "createProgramArtifactVersion" },
                `Không thể cấp phiên bản mới cho nhánh "${input.branch}" do có lưu đồng thời — vui lòng thử lại.`,
              );
            }
            throw err;
          }
        }
        // Unreachable: the loop always returns or throws.
        throw appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "createProgramArtifactVersion" },
          `Không thể cấp phiên bản mới cho nhánh "${input.branch}" — vui lòng thử lại.`,
        );
      };
      const { row, version: nextVersion } = await insertVersioned();

      // Validate through the EXISTING service (persists diagnostics + status).
      const validation = await validateArtifact(row.id);

      // W4-19: audit bất biến cho lần LƯU flow (ai · artifact nào · tóm tắt sau).
      await recordAuditEvent(d, {
        entityType: "ir_flow",
        entityId: row.id,
        action: "save",
        actorId: ctx.user.id,
        before: null,
        after: {
          artifactId: row.id,
          projectId: input.projectId,
          branch: input.branch,
          version: nextVersion,
          contentHash: row.contentHash,
          summary: summariseFlow(input.flow),
          validationOk: validation?.ok ?? null,
        },
        reason: validation?.ok === false ? "saved with lint issues" : null,
      });

      return { artifact: row, validation };
    }),

  /**
   * Compile (transpile) an ir-flow artifact via the EXISTING buildArtifact service. The
   * semantic-linter HARD GATE runs inside the IR adapter's compile() — an error blocks
   * codegen and yields a non-ok build (which the deploy gate then refuses).
   */
  requestBuild: writeProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, input.artifactId)).limit(1);
      if (!art) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "programmingArtifact" }, `Artifact ${input.artifactId} not found`);
      if (art.kind !== "ir-flow") throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "artifactKind" }, `Artifact ${input.artifactId} is not an ir-flow.`);
      // Shape-check early so we return a clean 400 rather than a failed build for garbage.
      parseOrThrow(art.content);
      const build = await buildArtifact(input.artifactId, toDpcUser(ctx.user));

      // W4-19: audit bất biến cho lần YÊU CẦU BUILD (transpile) — kết quả ok/không.
      const buildOk = (build as { ok?: boolean } | null)?.ok ?? null;
      await recordAuditEvent(d, {
        entityType: "ir_flow",
        entityId: input.artifactId,
        action: "request_build",
        actorId: ctx.user.id,
        before: null,
        after: { artifactId: input.artifactId, projectId: art.projectId, branch: art.branch, version: art.version, buildOk },
        reason: buildOk === false ? "build did not pass linter/transpile" : null,
      });

      return build;
    }),
});
