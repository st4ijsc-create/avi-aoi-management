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
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
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

/** Flag: the IR-specific MUTATIONS require DPC_IR_V2_ENABLED (default OFF). */
export function dpcIrV2Enabled(): boolean {
  return process.env.DPC_IR_V2_ENABLED === "true" || process.env.DPC_IR_V2_ENABLED === "1";
}

function requireFlag() {
  if (!dpcIrV2Enabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "IR programming disabled (set DPC_IR_V2_ENABLED=true)" });
  }
}

function toDpcUser(user: { id: number; role: string; name?: string | null }): DpcUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

const TARGET = z.enum(TRANSPILE_TARGETS as [TranspileTarget, ...TranspileTarget[]]);

/** Parse an ir-flow artifact's content → Flow (or a 400). */
function parseOrThrow(content: string | null): Flow {
  const parsed = parseFlowJson(content ?? "");
  if (!parsed.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid IR flow: ${parsed.errors.map((e) => `${e.path || "<root>"}: ${e.message}`).join("; ")}`,
    });
  }
  return parsed.flow;
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
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Artifact ${input.artifactId} not found` });
      if (row.kind !== "ir-flow") throw new TRPCError({ code: "BAD_REQUEST", message: `Artifact ${input.artifactId} is not an ir-flow.` });
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

  // ── MUTATIONS (gated: DPC_IR_V2_ENABLED + the EXISTING programming gate) ──

  /**
   * Create/append an ir-flow ARTIFACT (content = IR JSON) on a project, then validate it
   * via the EXISTING programmingService (shape + semantic linter). REUSES the gated
   * programming path — no new gate. Requires the project to be of kind "ir-flow".
   */
  saveFlow: protectedProcedure
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
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });
      if (proj.kind !== "ir-flow") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Project ${input.projectId} is kind "${proj.kind}", not "ir-flow".` });
      }

      const content = JSON.stringify(input.flow);
      // Next version on this branch (mirrors programmingRouter.createArtifact).
      const existing = await d.select().from(programArtifacts).where(eq(programArtifacts.projectId, input.projectId));
      const onBranch = existing.filter((a) => a.branch === input.branch);
      const nextVersion = onBranch.reduce((m, a) => Math.max(m, a.version), 0) + 1;

      const [row] = await d
        .insert(programArtifacts)
        .values({
          projectId: input.projectId,
          branch: input.branch,
          version: nextVersion,
          kind: "ir-flow",
          language: "ir-json",
          content,
          contentHash: hashContent(content),
          status: "draft",
          createdBy: ctx.user.id,
        })
        .returning();

      // Validate through the EXISTING service (persists diagnostics + status).
      const validation = await validateArtifact(row.id);
      return { artifact: row, validation };
    }),

  /**
   * Compile (transpile) an ir-flow artifact via the EXISTING buildArtifact service. The
   * semantic-linter HARD GATE runs inside the IR adapter's compile() — an error blocks
   * codegen and yields a non-ok build (which the deploy gate then refuses).
   */
  requestBuild: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [art] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, input.artifactId)).limit(1);
      if (!art) throw new TRPCError({ code: "NOT_FOUND", message: `Artifact ${input.artifactId} not found` });
      if (art.kind !== "ir-flow") throw new TRPCError({ code: "BAD_REQUEST", message: `Artifact ${input.artifactId} is not an ir-flow.` });
      // Shape-check early so we return a clean 400 rather than a failed build for garbage.
      parseOrThrow(art.content);
      return buildArtifact(input.artifactId, toDpcUser(ctx.user));
    }),
});
