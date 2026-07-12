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
import { and, desc, eq, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure, moduleGate, actuationProcedure as actuationBase } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
// Doc 38 Đợt Q — license-gate the whole programming surface behind MOD_ENGINEERING
// (moduleGate is pass-through until the deployment's SKU is configured — no-brick).
// Shadows `protectedProcedure`; per-action RBAC is unchanged.
const protectedProcedure = moduleProcedure("MOD_ENGINEERING");
// Deploy/rollback of a built program to a device is an ACTUATION path → role-floor
// (admin/supervisor/engineer) + 2FA, plus the same MOD_ENGINEERING license gate.
const actuationProcedure = actuationBase.use(moduleGate("MOD_ENGINEERING"));
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  programSymbols,
  users,
  permissions,
} from "../../drizzle/schema";
import {
  programmingRegistry,
  PROGRAMMING_KINDS,
  type ProgrammingKind,
} from "../services/programming/programmingAdapter";
import {
  validateArtifact,
  reviewArtifact,
  buildArtifact,
  simulateBuild,
  deployBuild,
  requestDeployApproval,
  approveDeployment,
  rejectDeployment,
  rollbackDeployment,
  hashContent,
  dpcDeployEnabled,
  dpcStreamingEnabled,
  dpcForceEnabled,
  dpcVersionReviewEnabled,
  dpcDeployApprovalEnabled,
  type DpcUser,
} from "../services/programming/programmingService";
import {
  suggestProgram,
  explainProgram,
  copilotEnabled,
  generateProgram,
} from "../services/programming/aiProgrammingCopilot";
// ── doc 40 W5 §11 — fleet program rollout (canary) + machine×version matrix ──
import { deployToFleet, fleetVersionMatrix } from "../services/programming/fleetRollout";
// ── D6 (doc 25 T4) — Online Monitor: watch-session manager bound to the socket room ──
import { getEngineeringStreamManager } from "../services/programming/engineeringStream";
// ── P4 (doc 24 Wave-3) — structured IEC 61131-3 POU (LAD/FBD/SFC) + PLCopen XML round-trip ──
import { pouProjectSchema } from "../services/programming/iec61131/pouModel";
import { lintPouProject } from "../services/programming/iec61131/pouLinter";
import { previewPouTranspile, summarisePouProject } from "../services/programming/iec61131/iec61131Adapter";
import { exportPlcopenXml, importPlcopenXml } from "../services/programming/iec61131/plcopenXml";

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
      // doc 38 T-2 — four-eyes-at-version gate state (UI shows the review step when on).
      versionReviewEnabled: dpcVersionReviewEnabled(),
      // doc 40 ENG-F2 — when on, PRODUCTION deploy goes via the Approval Inbox (request→approve)
      // instead of the requester picking an approver + self-deploying (four-eyes formality).
      deployApprovalEnabled: dpcDeployApprovalEnabled(),
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

  /**
   * doc 38 T-2 — FOUR-EYES AT THE VERSION. Record a review decision (approve/reject) on an
   * artifact version. Gated to APPROVER authority (machine_control / canCreate — the same
   * floor as listApprovers). SoD is enforced in the service: the reviewer (ctx.user) must
   * differ from the author. Build/deploy of an unapproved version is blocked when
   * DPC_VERSION_REVIEW_ENABLED is on (default OFF).
   */
  reviewArtifact: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ artifactId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) }))
    .mutation(async ({ input, ctx }) => reviewArtifact(input.artifactId, input.decision, toDpcUser(ctx.user))),

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

  deployBuild: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        buildId: z.number().int().positive(),
        stage: z.enum(["staging", "production"]).default("staging"),
        idempotencyKey: z.string().min(1).max(128),
        deviceId: z.number().int().positive().optional(),
        /** HITL sign-off: the confirming (second) user. */
        confirmedBy: z.number().int().positive().optional(),
        actionId: z.string().min(1).max(128),
        /** W2-9 — lý do duyệt (bắt buộc ở UI cho deploy production); lưu vào detailJson. */
        reason: z.string().max(2000).optional(),
      })
        // Doc 38 Đợt Q — four-eyes enforced AT THE SCHEMA for the sensitive path: a
        // PRODUCTION deploy must name a confirming approver (staging may self-sign).
        // The service layer additionally rejects the requester self-approving.
        .refine((v) => v.stage !== "production" || v.confirmedBy != null, {
          message: "Deploy production bắt buộc có người ký duyệt (four-eyes): thiếu confirmedBy.",
          path: ["confirmedBy"],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      return deployBuild(
        {
          buildId: input.buildId,
          stage: input.stage,
          idempotencyKey: input.idempotencyKey,
          deviceId: input.deviceId,
          hitl: {
            actionId: input.actionId,
            requestedBy: ctx.user.id,
            confirmedBy: input.confirmedBy,
            reason: input.reason,
          },
        },
        toDpcUser(ctx.user),
      );
    }),

  /**
   * doc 40 ENG-F2 — PHIÊN 1: gửi YÊU CẦU deploy production (request→approve). KHÔNG chạm
   * thiết bị: tạo hàng 'awaiting_approval' + pending record để một người thứ hai ký duyệt ở
   * Approval Inbox. Không phải actuation (không ghi HW) → chỉ cần machine_control/canCreate +
   * license gate. Người yêu cầu KHÔNG tự chọn approver nữa (đóng lỗ four-eyes hình thức).
   */
  requestDeployApproval: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        buildId: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(128),
        deviceId: z.number().int().positive().optional(),
        // Lý do bắt buộc cho deploy production (lưu vào detailJson, hiển thị cho approver).
        reason: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      requestDeployApproval(
        { buildId: input.buildId, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId, reason: input.reason },
        toDpcUser(ctx.user),
      ),
    ),

  /**
   * doc 40 ENG-F2 — inbox source: các yêu cầu deploy đang CHỜ DUYỆT (status='awaiting_approval').
   * Kèm đủ ngữ cảnh để approver quyết định TRƯỚC khi ký: dự án, phiên bản + hash dự kiến, build,
   * kết quả sim gần nhất, nội dung artifact (để diff với bản đã deploy trước), người yêu cầu.
   * Chỉ đọc (machine_monitoring/canView).
   */
  listDeployApprovals: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const pending = await d
        .select()
        .from(programDeployments)
        .where(
          input?.projectId
            ? and(eq(programDeployments.status, "awaiting_approval"), eq(programDeployments.projectId, input.projectId))
            : eq(programDeployments.status, "awaiting_approval"),
        )
        .orderBy(desc(programDeployments.id));

      const out = [];
      for (const dep of pending) {
        const [b] = await d.select().from(programBuilds).where(eq(programBuilds.id, dep.buildId)).limit(1);
        const [art] = b
          ? await d.select().from(programArtifacts).where(eq(programArtifacts.id, b.artifactId)).limit(1)
          : [undefined];
        const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, dep.projectId)).limit(1);
        const [latestSim] = b
          ? await d
              .select()
              .from(programSimRuns)
              .where(eq(programSimRuns.buildId, b.id))
              .orderBy(desc(programSimRuns.id))
              .limit(1)
          : [undefined];
        // Nội dung bản đã deploy TRƯỚC (để diff): lần deploy 'deployed'/'verified' gần nhất
        // của cùng project+production trước hàng chờ này.
        const priorDeploys = await d
          .select()
          .from(programDeployments)
          .where(and(eq(programDeployments.projectId, dep.projectId), eq(programDeployments.stage, "production")))
          .orderBy(desc(programDeployments.id));
        const prev = priorDeploys.find(
          (h) => h.id < dep.id && (h.status === "deployed" || h.status === "verified"),
        );
        let prevContent: string | null = null;
        if (prev) {
          const [pb] = await d.select().from(programBuilds).where(eq(programBuilds.id, prev.buildId)).limit(1);
          const [pa] = pb
            ? await d.select().from(programArtifacts).where(eq(programArtifacts.id, pb.artifactId)).limit(1)
            : [undefined];
          prevContent = pa?.content ?? null;
        }
        const [requester] = dep.requestedBy != null
          ? await d
              .select({ id: users.id, username: users.username, name: users.name })
              .from(users)
              .where(eq(users.id, dep.requestedBy))
              .limit(1)
          : [undefined];
        const detail = (dep.detailJson ?? {}) as Record<string, unknown>;
        out.push({
          deployment: dep,
          project: proj ? { id: proj.id, code: proj.code, name: proj.name, kind: proj.kind } : null,
          build: b ? { id: b.id, ok: b.ok, status: b.status } : null,
          artifact: art
            ? { id: art.id, version: art.version, branch: art.branch, contentHash: art.contentHash, content: art.content }
            : null,
          prevContent,
          latestSim: latestSim ? { ok: latestSim.ok, warnings: (latestSim.warningsJson ?? []) as string[] } : null,
          requestedByUser: requester ?? null,
          approvalReason: typeof detail.approvalReason === "string" ? detail.approvalReason : null,
        });
      }
      return out;
    }),

  /**
   * doc 40 ENG-F2 — PHIÊN 2: DUYỆT & deploy. Đây là ACTUATION (kích hoạt ghi HW thật) →
   * actuationProcedure (role-floor admin/supervisor/engineer + 2FA) + machine_control/canCreate
   * + license gate. approver ký bằng session CỦA CHÍNH HỌ; service enforced SoD (approver ≠
   * requester) và chạy đúng mọi gate cũ (sim/verify/version) với actionId THẬT.
   */
  approveDeployment: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        deploymentId: z.number().int().positive(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      approveDeployment(input.deploymentId, toDpcUser(ctx.user), { reason: input.reason }),
    ),

  /**
   * doc 40 ENG-F2 — TỪ CHỐI / rút một yêu cầu deploy chờ duyệt. An toàn (không chạm HW) →
   * chỉ cần machine_control/canCreate + license gate. Cho cả approver lẫn người yêu cầu.
   */
  rejectDeployment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        deploymentId: z.number().int().positive(),
        reason: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      rejectDeployment(input.deploymentId, toDpcUser(ctx.user), input.reason),
    ),

  /**
   * W2-9 (doc 25 T6) — danh sách người đủ quyền KÝ DUYỆT deploy (second-approver).
   * = admin (được cấp toàn quyền) hoặc user có quyền machine_control (canCreate).
   * Chỉ đọc; client dùng để render picker "người ký duyệt" cho deploy production.
   */
  listApprovers: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await db();
      return d
        .select({ id: users.id, username: users.username, name: users.name, role: users.role })
        .from(users)
        .leftJoin(
          permissions,
          and(eq(permissions.userId, users.id), eq(permissions.moduleName, "machine_control")),
        )
        .where(and(eq(users.isActive, true), or(eq(users.role, "admin"), eq(permissions.canCreate, true))))
        .orderBy(users.username);
    }),

  rollbackDeployment: actuationProcedure
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

  // ── doc 40 W5 §11 — FLEET ROLLOUT (canary) + MACHINE × VERSION MATRIX ──
  //
  // deployToFleet đẩy MỘT build ra NHIỀU máy TUẦN TỰ qua ĐÚNG deployBuild (mỗi máy 1 hàng
  // audit riêng, GIỮ NGUYÊN mọi cổng: sim-gate / four-eyes / SoD / verify-after-download).
  // Là ACTUATION (kích hoạt ghi HW thật) → actuationProcedure (role-floor + 2FA) +
  // machine_control/canCreate + MOD_ENGINEERING. Cùng ràng buộc four-eyes ở schema như
  // deployBuild: production phải có confirmedBy (người ký ≠ người yêu cầu, service tái kiểm).
  deployToFleet: actuationProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        buildId: z.number().int().positive(),
        deviceIds: z.array(z.number().int().positive()).min(1).max(200),
        stage: z.enum(["staging", "production"]).default("staging"),
        strategy: z.object({
          canaryCount: z.number().int().min(1).max(200).default(1),
          promoteOnVerified: z.boolean().default(false),
          autoRollbackOnMismatch: z.boolean().default(true),
        }),
        idempotencyKeyPrefix: z.string().min(1).max(96),
        actionId: z.string().min(1).max(96),
        confirmedBy: z.number().int().positive().optional(),
        reason: z.string().max(2000).optional(),
      })
        // Four-eyes AT THE SCHEMA cho đường nhạy cảm: rollout production phải có approver.
        .refine((v) => v.stage !== "production" || v.confirmedBy != null, {
          message: "Rollout production bắt buộc có người ký duyệt (four-eyes): thiếu confirmedBy.",
          path: ["confirmedBy"],
        }),
    )
    .mutation(async ({ input, ctx }) =>
      deployToFleet(
        {
          buildId: input.buildId,
          deviceIds: input.deviceIds,
          stage: input.stage,
          strategy: input.strategy,
          idempotencyKeyPrefix: input.idempotencyKeyPrefix,
          actionId: input.actionId,
          confirmedBy: input.confirmedBy,
          reason: input.reason,
        },
        toDpcUser(ctx.user),
      ),
    ),

  /**
   * MA TRẬN MÁY × VERSION (read-only): máy nào đang chạy artifact/hash nào. Chỉ đọc
   * program_deployments → không chạm thiết bị. Gated machine_monitoring/canView.
   */
  fleetVersionMatrix: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          projectId: z.number().int().positive().optional(),
          deviceIds: z.array(z.number().int().positive()).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => fleetVersionMatrix(input)),

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

  // ── Online Monitor (D6, doc 25 T4) — open/close a high-rate WATCH session ──
  //
  // READ-ONLY: a watch only READS the chosen symbols and pushes samples to the socket room
  // `engineering:{machineId}` (see emitEngineeringSamples). NO device write (force() is a
  // separate, heavily-gated path). Gated by DPC_STREAMING_ENABLED — a no-op when off. The
  // default sample source returns [] without a reachable device, so the loop is HONEST:
  // it never fabricates values (real OPC-UA / MC fast-scan source lands after HW validation).
  startWatch: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        projectId: z.number().int().positive(),
        symbols: z.array(z.string().min(1).max(128)).min(1).max(200),
        intervalMs: z.number().int().min(100).max(5000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!dpcStreamingEnabled()) {
        return { started: false as const, reason: "streaming_disabled" as const, machineId: null };
      }
      const d = await db();
      const [proj] = await d.select().from(programProjects).where(eq(programProjects.id, input.projectId)).limit(1);
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });
      const machineId = proj.deviceId;
      // Không gắn thiết bị → không có nguồn để đọc (báo trung thực về UI).
      if (machineId == null) {
        return { started: false as const, reason: "no_device" as const, machineId: null };
      }
      const started = getEngineeringStreamManager().startWatch({
        sessionId: `proj-${input.projectId}`,
        machineId,
        symbols: input.symbols,
        intervalMs: input.intervalMs,
      });
      return { started, reason: started ? null : ("not_started" as const), machineId };
    }),

  stopWatch: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      getEngineeringStreamManager().stopWatch(`proj-${input.projectId}`);
      return { ok: true as const };
    }),

  // ── AI Engineering Copilot (D7) — ADVISORY ONLY (HITL absolute; no deploy path) ──
  copilotStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: copilotEnabled() })),

  /** Propose a VALIDATED skeleton program. The human reviews + saves it as a version. */
  copilotSuggest: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ kind: KIND, intent: z.string().min(1).max(2000), lang: z.enum(["vi", "en", "zh"]).optional() }))
    .mutation(async ({ input }) => suggestProgram(input)),

  copilotExplain: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ kind: KIND, source: z.string().max(2_000_000) }))
    .query(({ input }) => explainProgram(input.kind, input.source)),

  /**
   * Doc 34 · P2 — LLM CODE COPILOT (generate / complete / translate / review / explain).
   *
   * ADVISORY + DISPLAY-ONLY: generateProgram runs every generated program through the SAME
   * programmingAdapter validate()/compile() gate before it is returned (PROG_CODEGEN_VALIDATE_
   * REQUIRED, default true), HARD-REFUSES safety-function requests, attaches RAG citations, and
   * opens NO device path — nothing is deployed. The engineer reviews the result and saves it via
   * createArtifact (machine_control / canCreate) to enter the existing gated build/deploy
   * pipeline. Read-gated exactly like copilotSuggest (machine_monitoring / canView) — a
   * proposal, not a control action; saving the proposal is the write.
   */
  copilotGenerate: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        kind: KIND,
        request: z.string().min(1).max(4000),
        mode: z.enum(["generate", "complete", "translate", "review", "explain"]).optional(),
        vendor: z.string().max(64).optional(),
        contextCode: z.string().max(2_000_000).optional(),
        targetKind: KIND.optional(),
      }),
    )
    .mutation(async ({ input }) => generateProgram(input)),

  // ── IEC 61131-3 structured POU (LAD/FBD/SFC) — P4 (doc 24 Wave-3) ──
  //
  // All four procedures are PURE transforms over an in-request POU model / PLCopen XML —
  // NO persistence, NO device path (the same safety posture as ir.transpilePreview). A POU
  // is persisted + built + deployed through the EXISTING gated pipeline by creating an
  // artifact of kind "iec61131-pou" (content = POU JSON) and calling buildArtifact /
  // deployBuild above. Read-gated (machine_monitoring / canView).

  /** Run the SEMANTIC linter on an ad-hoc POU project (undeclared var / type mismatch / unreachable step). */
  pouLint: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ project: pouProjectSchema }))
    .query(({ input }) => lintPouProject(input.project)),

  /**
   * Lint + lower a POU project → Structured Text (with `(* [IEC ...] *)` provenance markers).
   * The linter is the HARD GATE: any error blocks codegen (ok:false, code null). Pure.
   */
  pouTranspilePreview: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ project: pouProjectSchema }))
    .query(({ input }) => ({ ...previewPouTranspile(input.project), summary: summarisePouProject(input.project) })),

  /** Export a POU project → PLCopen TC6 XML (the vendor-neutral interchange format). Pure. */
  plcopenExport: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ project: pouProjectSchema }))
    .query(({ input }) => ({ xml: exportPlcopenXml(input.project) })),

  /**
   * Import PLCopen TC6 XML → the POU model, then lint it. Pure (no persistence): the client
   * reviews the model + diagnostics and may save it as an "iec61131-pou" artifact via
   * createArtifact (content = JSON.stringify(project)).
   */
  plcopenImport: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ xml: z.string().min(1).max(5_000_000) }))
    .query(({ input }) => {
      const res = importPlcopenXml(input.xml);
      if (!res.ok) return { ok: false as const, errors: res.errors };
      return {
        ok: true as const,
        project: res.project,
        summary: summarisePouProject(res.project),
        lint: lintPouProject(res.project),
      };
    }),
});
