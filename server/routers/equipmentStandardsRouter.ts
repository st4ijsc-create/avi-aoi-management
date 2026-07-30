/**
 * E1 (doc 16 §10 / §15) — EQUIPMENT STANDARDS & GOVERNANCE router.
 * Flag: EQ_GOVERN_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the Khối 5 governance layer:
 *   • E1-a Device Type hierarchy tree + resolveType (versioned, multi-level inherit)
 *   • E1-b ISA-18.2 alarm taxonomy: list + map(vendor, nativeCode)
 *   • E1-c Equipment Standards Board change-requests: submit → review → publish
 *   • E1-d conformance run (across seeded types / capability profiles)
 *   • E1-e compliance metrics
 *
 * The persisted device_types rows OVERLAY/extend the in-memory SEED built from
 * capabilityModel (deviceTypeRegistry.buildSeedTypes) — the seed is always present so
 * the registry is consistent with today's profiles even before any board publish.
 *
 * SAFETY / NO-OP: every write here is GOVERNANCE METADATA only (versioning, taxonomy,
 *   change-requests). It opens NO device-control path. Mutating actions additionally
 *   require EQ_GOVERN_ENABLED (off → CONFLICT).
 *
 * RBAC (module-level, mirrors fleetRouter / safetyRouter):
 *   • read  ops → machine_monitoring / canView
 *   • mutations → machine_control   / canCreate  (+ EQ_GOVERN_ENABLED)
 * ctx.user is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { machines, andonEvents } from "../../drizzle/schema";
import {
  deviceTypes,
  alarmTaxonomy,
  deviceTypeChangeRequests,
  masterAlarms,
  type DeviceType,
} from "../../drizzle/schema/equipmentStandards";
import {
  loadAlarmMappings,
  loadMasterAlarms,
  computeAlarmKpis,
  derivePriority,
  ALARM_CONSEQUENCES,
  type AlarmKpiEvent,
} from "../services/standards/alarmMasterService";
import {
  eqGovernEnabled,
  buildSeedTypes,
  buildTree,
  resolveType,
  resolveForMachineType,
  type DeviceTypeNode,
} from "../services/standards/deviceTypeRegistry";
import {
  mapAlarm,
  listVendors,
  SEED_ALARM_MAPPINGS,
  ALARM_SEVERITIES,
} from "../services/standards/alarmTaxonomy";
import {
  runConformance,
  subjectFromResolved,
  runConformanceAcrossSeed,
  runConformanceAcrossCapabilityProfiles,
} from "../services/standards/conformanceTest";
import {
  generateCrKey,
  nextStatus,
  enforcePublish,
  buildPublishedNode,
  applyProposalToNodes,
  type CrStatus,
  type SemverBump,
} from "../services/standards/governanceService";
import { computeCompliance } from "../services/standards/complianceService";
import { recordAuditEvent } from "../services/audit/controlAuditService";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Guard mutating actions behind the flag (matches fleetRouter/safetyRouter discipline). */
function requireFlag() {
  if (!eqGovernEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Equipment governance disabled (set EQ_GOVERN_ENABLED=true)" });
  }
}

/** Convert a persisted device_types row into an in-memory DeviceTypeNode. */
function rowToNode(r: DeviceType): DeviceTypeNode {
  return {
    typeKey: r.typeKey,
    parentTypeKey: r.parentTypeKey ?? null,
    version: r.version,
    status: (r.status as DeviceTypeNode["status"]) ?? "draft",
    label: r.label ?? undefined,
    description: r.description ?? undefined,
    attributesSchema: (r.attributesSchema ?? []) as DeviceTypeNode["attributesSchema"],
    supportedCommands: (r.supportedCommands ?? []) as DeviceTypeNode["supportedCommands"],
    supportedStates: (r.supportedStates ?? []) as DeviceTypeNode["supportedStates"],
    extensionFields: (r.extensionFields ?? {}) as Record<string, unknown>,
    mappedMachineTypes: (r.mappedMachineTypes ?? []) as string[],
    adapterKind: r.adapterKind ?? undefined,
  };
}

/**
 * Load the full node set = SEED ∪ persisted rows. Persisted rows are appended; the
 * registry's preferNode() picks published>draft and the highest SemVer per typeKey, so
 * a board-published version naturally supersedes the seed when present.
 */
async function loadNodeSet(): Promise<DeviceTypeNode[]> {
  const seed = buildSeedTypes();
  const d = await getDb();
  if (!d) return seed;
  const rows = await d.select().from(deviceTypes);
  return [...seed, ...rows.map(rowToNode)];
}

/**
 * Compute the conformance gate for a CR ON THE SERVER (never trust a client attestation):
 * overlay the CR's proposedSchema onto the live node set, RESOLVE the merged type with
 * inheritance, and run the standard conformance rule set. Returns 'pass' | 'fail'.
 */
function computeCrConformanceStatus(
  targetTypeKey: string,
  proposedSchema: Record<string, unknown> | null | undefined,
  nodes: DeviceTypeNode[],
): "pass" | "fail" {
  const overlay = applyProposalToNodes(targetTypeKey, proposedSchema, nodes);
  const resolved = resolveType(targetTypeKey, overlay);
  if (!resolved) return "fail";
  return runConformance(subjectFromResolved(resolved)).pass ? "pass" : "fail";
}

const SEVERITY_ENUM = z.enum(ALARM_SEVERITIES as unknown as [string, ...string[]]);
const CONSEQUENCE_ENUM = z.enum(ALARM_CONSEQUENCES as unknown as [string, ...string[]]);

export const equipmentStandardsRouter = router({
  /** UI gating hint — is the governance flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: eqGovernEnabled() })),

  // ── E1-a — Device Type hierarchy (read) ─────────────────────────────────────
  /** The full device-type hierarchy as a tree (SEED ∪ published rows). */
  hierarchyTree: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const nodes = await loadNodeSet();
      return { tree: buildTree(nodes), typeCount: new Set(nodes.map((n) => n.typeKey)).size };
    }),

  /** Resolve a typeKey → fully-merged device type (multi-level inheritance). */
  resolveType: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ typeKey: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const nodes = await loadNodeSet();
      const resolved = resolveType(input.typeKey, nodes);
      if (!resolved) throw new TRPCError({ code: "NOT_FOUND", message: `Device type '${input.typeKey}' not found` });
      return resolved;
    }),

  /** Given an equipment/machineType, return its resolved DeviceType (consistent w/ capabilityModel). */
  resolveForMachineType: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineType: z.string().min(1).max(32) }))
    .query(async ({ input }) => {
      const nodes = await loadNodeSet();
      return resolveForMachineType(input.machineType, nodes);
    }),

  // ── E1-b — Alarm taxonomy ────────────────────────────────────────────────────
  /** List alarm mappings (SEED ∪ persisted), optionally filtered by vendor. */
  listAlarmMappings: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ vendor: z.string().max(48).optional() }).optional())
    .query(async ({ input }) => {
      const entries = await loadAlarmMappings();
      const v = input?.vendor?.trim().toLowerCase();
      return {
        vendors: listVendors(entries),
        mappings: v ? entries.filter((e) => e.vendor.toLowerCase() === v) : entries,
      };
    }),

  /** Normalize a vendor native alarm code → standard code + severity + action. */
  mapAlarm: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ vendor: z.string().min(1).max(48), nativeCode: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const entries = await loadAlarmMappings();
      return mapAlarm(input.vendor, input.nativeCode, entries);
    }),

  /** Upsert an alarm mapping (vendor+nativeCode unique). */
  upsertAlarmMapping: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      vendor: z.string().min(1).max(48),
      nativeCode: z.string().min(1).max(64),
      standardCode: z.string().min(1).max(64),
      severity: SEVERITY_ENUM,
      machineType: z.string().max(32).optional(),
      deviceTypeKey: z.string().max(64).optional(),
      description: z.string().optional(),
      recommendedAction: z.string().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const vendor = input.vendor.trim().toLowerCase();
      const [existing] = await d.select().from(alarmTaxonomy)
        .where(and(eq(alarmTaxonomy.vendor, vendor), eq(alarmTaxonomy.nativeCode, input.nativeCode))).limit(1);
      const values = {
        vendor, nativeCode: input.nativeCode, standardCode: input.standardCode,
        severity: input.severity, machineType: input.machineType, deviceTypeKey: input.deviceTypeKey,
        description: input.description, recommendedAction: input.recommendedAction,
        scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        createdBy: ctx.user.id, updatedAt: new Date(),
      };
      if (existing) {
        const [row] = await d.update(alarmTaxonomy).set(values).where(eq(alarmTaxonomy.id, existing.id)).returning();
        return row;
      }
      const [row] = await d.insert(alarmTaxonomy).values(values).returning();
      return row;
    }),

  // ── W5-21 — ISA-18.2 master alarm DB + rationalization + shelving ────────────
  /** List rationalized master alarms (optionally filtered by alarmKey / assetType). */
  listMasterAlarms: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ alarmKey: z.string().max(64).optional(), assetType: z.string().max(48).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await loadMasterAlarms();
      const now = Date.now();
      let filtered = rows;
      if (input?.alarmKey) filtered = filtered.filter((r) => r.alarmKey.toLowerCase() === input.alarmKey!.toLowerCase());
      if (input?.assetType) filtered = filtered.filter((r) => (r.assetType ?? "").toLowerCase() === input.assetType!.toLowerCase());
      // Đính kèm cờ 'đang bị shelve' đã tính sẵn (shelvedUntil > now) cho UI.
      return filtered
        .map((r) => ({ ...r, isShelvedNow: r.shelvedUntil != null && new Date(r.shelvedUntil).getTime() > now }))
        .sort((a, b) => a.alarmKey.localeCompare(b.alarmKey));
    }),

  /**
   * Upsert a master alarm. PRIORITY is DERIVED on the server from consequence ×
   * timeToRespond (EEMUA-191) — never trusted from the client. Keyed by (alarmKey, assetType).
   */
  upsertMasterAlarm: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      alarmKey: z.string().min(1).max(64),
      assetType: z.string().max(48).optional(),
      vendor: z.string().max(48).optional(),
      nativeCode: z.string().max(64).optional(),
      label: z.string().max(128).optional(),
      consequence: CONSEQUENCE_ENUM,
      timeToRespond: z.number().int().min(0).max(100000).optional(),
      setpoint: z.string().max(96).optional(),
      deadband: z.string().max(96).optional(),
      rationalization: z.string().optional(),
      // doc 63 DEP-06 — ISA-18.2 field #4 "probable cause" (authored at rationalization).
      cause: z.string().max(4000).optional(),
      shelvedUntil: z.string().datetime().optional(),
      isSuppressed: z.boolean().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const assetType = input.assetType?.trim() || null;
      // Priority suy diễn ở server (không tin client) theo consequence × time-to-respond.
      const priority = derivePriority(input.consequence, input.timeToRespond ?? null);
      const values = {
        alarmKey: input.alarmKey.trim(),
        assetType,
        vendor: input.vendor?.trim().toLowerCase() || null,
        nativeCode: input.nativeCode?.trim() || null,
        label: input.label,
        priority,
        consequence: input.consequence,
        timeToRespond: input.timeToRespond ?? null,
        setpoint: input.setpoint,
        deadband: input.deadband,
        rationalization: input.rationalization,
        cause: input.cause,
        shelvedUntil: input.shelvedUntil ? new Date(input.shelvedUntil) : null,
        isSuppressed: input.isSuppressed ?? false,
        scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        createdBy: ctx.user.id, updatedAt: new Date(),
      };
      const [existing] = await d.select().from(masterAlarms)
        .where(assetType
          ? and(eq(masterAlarms.alarmKey, values.alarmKey), eq(masterAlarms.assetType, assetType))
          : and(eq(masterAlarms.alarmKey, values.alarmKey), isNull(masterAlarms.assetType)))
        .limit(1);
      let row;
      if (existing) {
        [row] = await d.update(masterAlarms).set(values).where(eq(masterAlarms.id, existing.id)).returning();
      } else {
        [row] = await d.insert(masterAlarms).values(values).returning();
      }
      // Audit bất biến: upsert master alarm (rationalization / shelving).
      await recordAuditEvent(d, { entityType: "master_alarm", entityId: row.id, action: existing ? "update" : "create", actorId: ctx.user.id, before: existing ?? null, after: row });
      return row;
    }),

  /** Shelve / un-shelve a master alarm (ISA-18.2 temporary silence). shelvedUntil=null clears. */
  shelveMasterAlarm: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ id: z.number().int().positive(), shelvedUntil: z.string().datetime().nullable() }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [before] = await d.select().from(masterAlarms).where(eq(masterAlarms.id, input.id)).limit(1);
      if (!before) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "masterAlarm" }, `Master alarm ${input.id} not found`);
      const [row] = await d.update(masterAlarms)
        .set({ shelvedUntil: input.shelvedUntil ? new Date(input.shelvedUntil) : null, updatedAt: new Date() })
        .where(eq(masterAlarms.id, input.id)).returning();
      await recordAuditEvent(d, { entityType: "master_alarm", entityId: input.id, action: input.shelvedUntil ? "shelve" : "unshelve", actorId: ctx.user.id, before, after: row });
      return row;
    }),

  /** Delete a master alarm. */
  deleteMasterAlarm: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [before] = await d.select().from(masterAlarms).where(eq(masterAlarms.id, input.id)).limit(1);
      if (!before) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "masterAlarm" }, `Master alarm ${input.id} not found`);
      await d.delete(masterAlarms).where(eq(masterAlarms.id, input.id));
      await recordAuditEvent(d, { entityType: "master_alarm", entityId: input.id, action: "delete", actorId: ctx.user.id, before, after: null });
      return { id: input.id, deleted: true };
    }),

  /**
   * Alarm performance KPIs (EEMUA-191) computed from the Andon history over a window:
   * alarms/operator/hour, flood windows, chattering, standing/stale, top bad-actors.
   */
  alarmKpis: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      windowDays: z.number().int().min(1).max(90).default(7),
      operatorCount: z.number().int().min(1).max(500).default(1),
    }).optional())
    .query(async ({ input }) => {
      const windowDays = input?.windowDays ?? 7;
      const operatorCount = input?.operatorCount ?? 1;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const d = await getDb();
      const events: AlarmKpiEvent[] = [];
      if (d) {
        try {
          const rows = await d
            .select({
              reason: andonEvents.reason, title: andonEvents.title, machineId: andonEvents.machineId,
              raisedAt: andonEvents.raisedAt, resolvedAt: andonEvents.resolvedAt,
            })
            .from(andonEvents)
            .where(gte(andonEvents.raisedAt, since))
            .orderBy(desc(andonEvents.raisedAt))
            .limit(20000);
          for (const r of rows) {
            const raised = r.raisedAt instanceof Date ? r.raisedAt.getTime() : new Date(r.raisedAt as never).getTime();
            events.push({
              key: (r.title || r.reason || "UNKNOWN").toString(),
              machineId: r.machineId ?? null,
              raisedAt: raised,
              resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).getTime() : null,
            });
          }
        } catch { /* andon table absent → empty KPIs */ }
      }
      const kpis = computeAlarmKpis(events, { operatorCount });
      return { windowDays, since: since.getTime(), ...kpis };
    }),

  // ── E1-a — register a device type (draft) ────────────────────────────────────
  registerDeviceType: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      typeKey: z.string().min(1).max(64),
      parentTypeKey: z.string().max(64).optional(),
      version: z.string().max(24).default("1.0.0"),
      label: z.string().max(128).optional(),
      description: z.string().optional(),
      attributesSchema: z.array(z.any()).optional(),
      supportedCommands: z.array(z.any()).optional(),
      supportedStates: z.array(z.string()).optional(),
      extensionFields: z.record(z.string(), z.any()).optional(),
      mappedMachineTypes: z.array(z.string()).optional(),
      adapterKind: z.string().max(32).optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [row] = await d.insert(deviceTypes).values({
        typeKey: input.typeKey, parentTypeKey: input.parentTypeKey, version: input.version,
        status: "draft", origin: "manual", label: input.label, description: input.description,
        attributesSchema: (input.attributesSchema ?? []) as never,
        supportedCommands: (input.supportedCommands ?? []) as never,
        supportedStates: (input.supportedStates ?? []) as never,
        extensionFields: (input.extensionFields ?? {}) as never,
        mappedMachineTypes: (input.mappedMachineTypes ?? []) as never,
        adapterKind: input.adapterKind,
        scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
        createdBy: ctx.user.id,
      }).returning();
      // Audit bất biến: đăng ký device type (draft).
      await recordAuditEvent(d, { entityType: "device_type", entityId: row.id, action: "register", actorId: ctx.user.id, before: null, after: row });
      return row;
    }),

  // ── E1-c — Equipment Standards Board change-requests ─────────────────────────
  listChangeRequests: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ status: z.string().max(16).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const rows = await d.select().from(deviceTypeChangeRequests)
        .where(input?.status ? eq(deviceTypeChangeRequests.status, input.status) : undefined)
        .orderBy(desc(deviceTypeChangeRequests.createdAt))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  submitChangeRequest: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      targetTypeKey: z.string().min(1).max(64),
      kind: z.enum(["new_type", "modify", "deprecate"]),
      proposedSchema: z.record(z.string(), z.any()).default({}),
      semverBump: z.enum(["major", "minor", "patch"]).optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [row] = await d.insert(deviceTypeChangeRequests).values({
        crKey: generateCrKey(), targetTypeKey: input.targetTypeKey, kind: input.kind,
        proposedSchema: input.proposedSchema as never, requestedBy: ctx.user.id,
        status: "pending", conformanceStatus: "pending", stage: "none", semverBump: input.semverBump,
        scope: input.scope, corporateCode: input.corporateCode, factoryId: input.factoryId,
      }).returning();
      // Audit bất biến: submit change-request (dùng crKey làm entityId).
      await recordAuditEvent(d, { entityType: "device_type_cr", entityId: row.crKey, action: "submit", actorId: ctx.user.id, before: null, after: row });
      return row;
    }),

  /**
   * Move a CR through review (in_review → approved | rejected). On APPROVE the
   * conformance gate is computed ON THE SERVER from the proposed schema (no client
   * self-attestation — the old `conformanceStatus` input has been removed).
   */
  reviewChangeRequest: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      crId: z.number().int().positive(),
      to: z.enum(["in_review", "approved", "rejected"]),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      const [cr] = await d.select().from(deviceTypeChangeRequests).where(eq(deviceTypeChangeRequests.id, input.crId)).limit(1);
      if (!cr) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTypeChangeRequest" }, `Change request ${input.crId} not found`);
      // Doc 54 Wave B — Separation of Duties: the reviewer (reviewedBy=ctx.user) MUST
      // differ from the requester (requestedBy). A requester cannot self-review/approve.
      if (cr.requestedBy != null && cr.requestedBy === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tách biệt trách nhiệm (SoD): người tạo change-request không được tự review/duyệt." });
      }
      const ns = nextStatus(cr.status as CrStatus, input.to);
      if (!ns) throw new TRPCError({ code: "CONFLICT", message: `Illegal CR transition ${cr.status} → ${input.to}` });
      // Conformance được tính ở SERVER khi duyệt — bỏ hoàn toàn self-attest từ client.
      let conformanceStatus = cr.conformanceStatus;
      if (ns === "approved") {
        const nodes = await loadNodeSet();
        conformanceStatus = computeCrConformanceStatus(cr.targetTypeKey, cr.proposedSchema as Record<string, unknown>, nodes);
      }
      const [row] = await d.update(deviceTypeChangeRequests).set({
        status: ns, reviewedBy: ctx.user.id, reviewNotes: input.reviewNotes,
        conformanceStatus,
        reviewedAt: new Date(), updatedAt: new Date(),
      }).where(eq(deviceTypeChangeRequests.id, input.crId)).returning();
      // Audit bất biến: review/approve/reject — action = trạng thái đích (in_review|approved|rejected).
      await recordAuditEvent(d, { entityType: "device_type_cr", entityId: cr.crKey, action: ns, actorId: ctx.user.id, before: cr, after: row, reason: input.reviewNotes ?? null });
      return row;
    }),

  /**
   * Publish an APPROVED CR → create a NEW published device_types version. Enforces:
   *   • conformance gate must be 'pass'
   *   • backward-compat: declared semverBump >= required bump (breaking → major or REJECT).
   */
  publishChangeRequest: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ crId: z.number().int().positive(), stage: z.enum(["staging", "production"]).default("staging") }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const d = await db();
      // Node set (SEED ∪ published) đọc ngoài TX — dùng để tính conformance ở server.
      const nodes = await loadNodeSet();
      // Toàn bộ publish là ATOMIC + optimistic-lock (SELECT … FOR UPDATE khoá dòng CR
      // để hai publish đồng thời không cùng tạo phiên bản / mất-cập-nhật).
      const result = await d.transaction(async (tx) => {
        const [cr] = await tx.select().from(deviceTypeChangeRequests)
          .where(eq(deviceTypeChangeRequests.id, input.crId)).for("update").limit(1);
        if (!cr) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTypeChangeRequest" }, `Change request ${input.crId} not found`);
        // Doc 54 Wave B — Separation of Duties: the publisher (ctx.user) MUST differ
        // from the requester (requestedBy). A requester cannot self-publish their CR.
        if (cr.requestedBy != null && cr.requestedBy === ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Tách biệt trách nhiệm (SoD): người tạo change-request không được tự publish." });
        }
        if (cr.status !== "approved") {
          throw new TRPCError({ code: "CONFLICT", message: `CR must be 'approved' to publish (is '${cr.status}')` });
        }
        const proposed = (cr.proposedSchema ?? {}) as Record<string, unknown>;
        // Conformance được TÍNH LẠI ở server ngay trước publish (không tin cờ đã lưu).
        const conformance = computeCrConformanceStatus(cr.targetTypeKey, proposed, nodes);

        // current published version for this type (highest published SemVer), else 1.0.0 baseline.
        const existing = await tx.select().from(deviceTypes)
          .where(and(eq(deviceTypes.typeKey, cr.targetTypeKey), eq(deviceTypes.status, "published")));
        const seed = buildSeedTypes().find((n) => n.typeKey === cr.targetTypeKey);
        let currentVersion = seed?.version ?? "1.0.0";
        let publishedAttrs = seed?.attributesSchema ?? [];
        for (const e of existing) {
          publishedAttrs = (e.attributesSchema ?? publishedAttrs) as never;
          currentVersion = e.version;
        }
        const proposedAttrs = (proposed.attributesSchema ?? []) as never;
        const declaredBump = (cr.semverBump as SemverBump) ?? "minor";

        const decision = enforcePublish({
          currentVersion, declaredBump, conformance,
          publishedAttrs, proposedAttrs,
        });
        if (!decision.ok) {
          throw new TRPCError({ code: "CONFLICT", message: `Publish rejected: ${decision.rejection}` });
        }
        // archive prior published rows of this type
        if (existing.length) {
          await tx.update(deviceTypes).set({ status: "archived", updatedAt: new Date() })
            .where(and(eq(deviceTypes.typeKey, cr.targetTypeKey), eq(deviceTypes.status, "published")));
        }
        const node = buildPublishedNode({ targetTypeKey: cr.targetTypeKey, newVersion: decision.newVersion, proposed });
        const [row] = await tx.insert(deviceTypes).values({
          typeKey: node.typeKey, parentTypeKey: node.parentTypeKey, version: node.version,
          status: "published", origin: "manual", label: node.label, description: node.description,
          attributesSchema: node.attributesSchema as never, supportedCommands: node.supportedCommands as never,
          supportedStates: node.supportedStates as never, extensionFields: node.extensionFields as never,
          mappedMachineTypes: node.mappedMachineTypes as never, adapterKind: node.adapterKind,
          changelog: `Published from ${cr.crKey} (${decision.effectiveBump}). ${decision.reasons.join("; ")}`,
          publishedAt: new Date(), scope: cr.scope, corporateCode: cr.corporateCode, factoryId: cr.factoryId,
        }).returning();
        // Optimistic-lock: chỉ chuyển sang published nếu CR VẪN 'approved' (chống race).
        const updated = await tx.update(deviceTypeChangeRequests).set({
          status: "published", stage: input.stage, publishedVersion: decision.newVersion,
          conformanceStatus: conformance,
          backwardIncompatible: decision.breaking ? "true" : "false", publishedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(deviceTypeChangeRequests.id, input.crId), eq(deviceTypeChangeRequests.status, "approved"))).returning();
        if (updated.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "CR was concurrently modified — publish aborted" });
        }
        return { cr, deviceType: row, decision };
      });
      // Audit bất biến: publish CR → phiên bản device type mới (sau khi TX commit).
      await recordAuditEvent(d, { entityType: "device_type_cr", entityId: result.cr.crKey, action: "publish", actorId: ctx.user.id, before: result.cr, after: { deviceType: result.deviceType, decision: result.decision } });
      return { deviceType: result.deviceType, decision: result.decision };
    }),

  // ── E1-d — conformance ───────────────────────────────────────────────────────
  /** Run conformance across the seeded device types (+ capability profiles). */
  runConformance: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => {
      const seed = runConformanceAcrossSeed();
      const profiles = runConformanceAcrossCapabilityProfiles();
      return {
        seed,
        profiles,
        pass: seed.every((r) => r.pass) && profiles.every((r) => r.pass),
        failingTypes: [...seed, ...profiles].filter((r) => !r.pass).map((r) => r.typeKey),
      };
    }),

  // ── E1-e — compliance metrics ─────────────────────────────────────────────────
  complianceMetrics: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await getDb();
      const machineTypes: string[] = [];
      const publishedTypeKeys = new Set<string>();
      const mappedVendors = new Set<string>();
      const crStatuses: string[] = [];
      // seed types count as published (origin seed, status published)
      for (const n of buildSeedTypes()) if (n.status === "published") publishedTypeKeys.add(n.typeKey);
      for (const m of SEED_ALARM_MAPPINGS) mappedVendors.add(m.vendor.toLowerCase());
      if (d) {
        const ms = await d.select({ machineType: machines.machineType }).from(machines);
        for (const m of ms) machineTypes.push(m.machineType);
        const dts = await d.select().from(deviceTypes).where(eq(deviceTypes.status, "published"));
        for (const t of dts) publishedTypeKeys.add(t.typeKey);
        const at = await d.select({ vendor: alarmTaxonomy.vendor }).from(alarmTaxonomy);
        for (const a of at) mappedVendors.add(a.vendor.toLowerCase());
        const crs = await d.select({ status: deviceTypeChangeRequests.status }).from(deviceTypeChangeRequests);
        for (const c of crs) crStatuses.push(c.status);
      }
      return computeCompliance({
        machineTypes,
        publishedTypeKeys: Array.from(publishedTypeKeys),
        crStatuses,
        mappedVendors: Array.from(mappedVendors),
      });
    }),
});
