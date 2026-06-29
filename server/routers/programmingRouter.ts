/**
 * Doc 09 / Phase D0 — Device Programming & Control (DPC): the PROGRAMMING router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the programming service + program_* tables: manage projects,
 * author versioned artifacts, validate/build/simulate, and (gated) deploy/rollback.
 *
 * SAFETY (ABSOLUTE): deploy is gated by DPC_DEPLOY_ENABLED + HITL sign-off inside
 * programmingService — this router opens NO device path. validate/build/simulate are
 * always safe. Reuses the control-plane RBAC modules:
 *   • read ops  → machine_monitoring / canView.
 *   • write ops → machine_control / canCreate|canEdit|canDelete.
 * The session user (ctx.user) is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  programSymbols,
} from "../../drizzle/schema";
import {
  programmingRegistry,
  PROGRAMMING_KINDS,
  type ProgrammingKind,
} from "../services/programming/programmingAdapter";
import {
  validateArtifact,
  buildArtifact,
  simulateBuild,
  deployBuild,
  rollbackDeployment,
  hashContent,
  dpcDeployEnabled,
  dpcStreamingEnabled,
  dpcForceEnabled,
  type DpcUser,
} from "../services/programming/programmingService";

const KIND = z.enum(PROGRAMMING_KINDS as [ProgrammingKind, ...ProgrammingKind[]]);

function toDpcUser(user: { id: number; role: string; name?: string | null }): DpcUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

export const programmingRouter = router({
  /** DPC flag/capability snapshot (UI gating hint). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      deployEnabled: dpcDeployEnabled(),
      streamingEnabled: dpcStreamingEnabled(),
      forceEnabled: dpcForceEnabled(),
      adapters: programmingRegistry.listAdapters(),
    })),

  // ── Projects ──
  listProjects: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d.select().from(programProjects).orderBy(desc(programProjects.updatedAt)).limit(input?.limit ?? 200);
    }),

  getProject: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(programProjects).where(eq(programProjects.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
      return row;
    }),

  createProject: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(128),
        name: z.string().min(1).max(255),
        kind: KIND,
        deviceId: z.number().int().positive().optional(),
        description: z.string().max(2000).optional(),
        defaultBranch: z.string().min(1).max(64).default("main"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const code = input.code.trim();
      const [clash] = await d.select().from(programProjects).where(eq(programProjects.code, code)).limit(1);
      if (clash) throw new TRPCError({ code: "CONFLICT", message: `A project with code "${code}" already exists.` });
      const [row] = await d
        .insert(programProjects)
        .values({
          code,
          name: input.name.trim(),
          kind: input.kind,
          deviceId: input.deviceId ?? null,
          description: input.description ?? null,
          defaultBranch: input.defaultBranch,
          createdBy: ctx.user.id,
        })
        .returning();
      return row;
    }),

  updateProject: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        deviceId: z.number().int().positive().nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
        defaultBranch: z.string().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.deviceId !== undefined) patch.deviceId = input.deviceId;
      if (input.description !== undefined) patch.description = input.description;
      if (input.defaultBranch !== undefined) patch.defaultBranch = input.defaultBranch;
      const [row] = await d.update(programProjects).set(patch).where(eq(programProjects.id, input.id)).returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
      return row;
    }),

  deleteProject: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      // Clean child rows (artifacts/builds/sim/symbols) — deployments are append-only
      // audit and are RETAINED (orphan-safe; they reference projectId for history only).
      const arts = await d.select().from(programArtifacts).where(eq(programArtifacts.projectId, input.id));
      for (const a of arts) {
        const builds = await d.select().from(programBuilds).where(eq(programBuilds.artifactId, a.id));
        for (const b of builds) {
          await d.delete(programSimRuns).where(eq(programSimRuns.buildId, b.id));
        }
        await d.delete(programBuilds).where(eq(programBuilds.artifactId, a.id));
      }
      await d.delete(programArtifacts).where(eq(programArtifacts.projectId, input.id));
      await d.delete(programSymbols).where(eq(programSymbols.projectId, input.id));
      await d.delete(programProjects).where(eq(programProjects.id, input.id));
      return { ok: true, id: input.id, retainedDeployAudit: true };
    }),

  // ── Artifacts (versioned source) ──
  listArtifacts: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive(), branch: z.string().max(64).optional() }))
    .query(async ({ input }) => {
      const d = await db();
      const rows = await d
        .select()
        .from(programArtifacts)
        .where(eq(programArtifacts.projectId, input.projectId))
        .orderBy(desc(programArtifacts.version));
      return input.branch ? rows.filter((r) => r.branch === input.branch) : rows;
    }),

  getArtifact: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(programArtifacts).where(eq(programArtifacts.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Artifact ${input.id} not found` });
      return row;
    }),

  /** Create a NEW version of a project's program on a branch (append-version). */
  createArtifact: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        projectId: z.number().int().positive(),
        branch: z.string().min(1).max(64).default("main"),
        language: z.string().min(1).max(32),
        content: z.string().max(2_000_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, input.projectId)).limit(1);
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });

      // Next version on this branch.
      const existing = await d.select().from(programArtifacts).where(eq(programArtifacts.projectId, input.projectId));
      const onBranch = existing.filter((a) => a.branch === input.branch);
      const nextVersion = onBranch.reduce((m, a) => Math.max(m, a.version), 0) + 1;

      const [row] = await d
        .insert(programArtifacts)
        .values({
          projectId: input.projectId,
          branch: input.branch,
          version: nextVersion,
          kind: proj.kind,
          language: input.language,
          content: input.content,
          contentHash: hashContent(input.content),
          status: "draft",
          createdBy: ctx.user.id,
        })
        .returning();
      return row;
    }),

  validateArtifact: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .mutation(async ({ input }) => validateArtifact(input.artifactId)),

  // ── Builds ──
  listBuilds: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      return d.select().from(programBuilds).where(eq(programBuilds.artifactId, input.artifactId)).orderBy(desc(programBuilds.id));
    }),

  buildArtifact: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ artifactId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => buildArtifact(input.artifactId, toDpcUser(ctx.user))),

  // ── Simulation (always safe) ──
  simulateBuild: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        buildId: z.number().int().positive(),
        scenario: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ input, ctx }) => simulateBuild(input.buildId, input.scenario, toDpcUser(ctx.user))),

  // ── Deployments (GATED: DPC_DEPLOY_ENABLED + HITL sign-off in the service) ──
  listDeployments: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(programDeployments)
        .where(eq(programDeployments.projectId, input.projectId))
        .orderBy(desc(programDeployments.id));
    }),

  deployBuild: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        buildId: z.number().int().positive(),
        stage: z.enum(["staging", "production"]).default("staging"),
        idempotencyKey: z.string().min(1).max(128),
        deviceId: z.number().int().positive().optional(),
        /** HITL sign-off: the confirming user. Required for a REAL deploy. */
        confirmedBy: z.number().int().positive().optional(),
        actionId: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return deployBuild(
        {
          buildId: input.buildId,
          stage: input.stage,
          idempotencyKey: input.idempotencyKey,
          deviceId: input.deviceId,
          hitl: { actionId: input.actionId, requestedBy: ctx.user.id, confirmedBy: input.confirmedBy },
        },
        toDpcUser(ctx.user),
      );
    }),

  rollbackDeployment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        deploymentId: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(128),
        actionId: z.string().min(1).max(128),
        confirmedBy: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return rollbackDeployment(
        input.deploymentId,
        toDpcUser(ctx.user),
        { actionId: input.actionId, requestedBy: ctx.user.id, confirmedBy: input.confirmedBy },
        input.idempotencyKey,
      );
    }),

  // ── Symbols (variable/tag table; feeds Online Monitor in D6) ──
  listSymbols: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      return d.select().from(programSymbols).where(eq(programSymbols.projectId, input.projectId)).orderBy(programSymbols.name);
    }),

  upsertSymbol: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(
      z.object({
        projectId: z.number().int().positive(),
        name: z.string().min(1).max(128),
        address: z.string().max(128).optional(),
        dataType: z.string().max(32).optional(),
        comment: z.string().max(500).optional(),
        watchable: z.boolean().default(true),
        forceable: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [row] = await d
        .insert(programSymbols)
        .values({
          projectId: input.projectId,
          name: input.name.trim(),
          address: input.address ?? null,
          dataType: input.dataType ?? null,
          comment: input.comment ?? null,
          watchable: input.watchable,
          forceable: input.forceable,
        })
        .onConflictDoUpdate({
          target: [programSymbols.projectId, programSymbols.name],
          set: {
            address: input.address ?? null,
            dataType: input.dataType ?? null,
            comment: input.comment ?? null,
            watchable: input.watchable,
            forceable: input.forceable,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    }),

  deleteSymbol: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      await d.delete(programSymbols).where(eq(programSymbols.id, input.id));
      return { ok: true, id: input.id };
    }),
});
