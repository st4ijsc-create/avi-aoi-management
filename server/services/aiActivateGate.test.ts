/**
 * W0-2 (doc 69) — MANUAL model-activation eval quality gate.
 *
 * BUG this closes: the automated training pipeline (aiTrainingPipeline.runTrainingPipeline)
 * already refuses to activate a version whose quality gate failed (see Stage 5/6,
 * `promotionAllowed`). But the MANUAL path — aiModelRouter.ts `activateVersion`
 * (adminProcedure, used by the AI Model Management UI) — called the raw
 * aiModelService.activateModelVersion() directly with NO gate check: an admin could
 * flip ANY version (never evaluated, or one that FAILED the gate) to ACTIVE and start
 * serving it for production inference.
 *
 * Real integration test against the test DB (vitest.setup.ts points DATABASE_URL at
 * the isolated `${dbname}_test` clone) — seeds real ai_models / model_versions rows.
 *
 * Verified field path: model_versions.evalReport is the persisted CompareReport
 * (aiEvalHarness.compareBeforeAfter), so the gate lives at `evalReport.gate.pass`
 * (QualityGateResult.pass, aiEvalHarness.ts). This is the SAME field path
 * modelStagePipeline.evalGatePassedOf already reads for the canary→production gate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiModels, modelVersions, modelRollbackEvents, auditLogs } from "../../drizzle/schema";
import { createAiModel, createModelVersion } from "../db/ai";
import { activateModelVersionManual } from "./aiModelService";
import { manualRollback } from "./ai/modelAutoRollback";

describe("activateModelVersionManual — eval quality gate on MANUAL activation", () => {
  let modelId: number;
  const versionIds: number[] = [];

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("This test requires a live test DB — see vitest.setup.ts (DATABASE_URL → *_test clone).");
    const model = await createAiModel({
      code: `t2-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "W0-2 gate test model",
      modelType: "classification",
    } as any);
    modelId = model.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    // NOTE: audit_logs is append-only at the DB-role permission level (WORM — the app
    // role has no DELETE grant on it, confirmed live: "permission denied for table
    // audit_logs"), so the audit rows this suite writes are intentionally NOT cleaned
    // up here — harmless leftovers in the isolated *_test DB.
    await db.delete(modelRollbackEvents).where(eq(modelRollbackEvents.modelId, modelId));
    if (versionIds.length > 0) {
      await db.delete(modelVersions).where(inArray(modelVersions.id, versionIds));
    }
    if (modelId) {
      await db.delete(aiModels).where(eq(aiModels.id, modelId));
    }
  });

  async function seedVersion(version: string, evalReport: unknown) {
    const v = await createModelVersion({
      modelId,
      version,
      status: "READY",
      evalReport: evalReport as any,
    } as any);
    versionIds.push(v.id);
    return v;
  }

  async function readStatus(versionId: number): Promise<string> {
    const db = await getDb();
    const [row] = await db!.select().from(modelVersions).where(eq(modelVersions.id, versionId));
    return row!.status;
  }

  // ── (a) REJECTED — no gate / failing gate ───────────────────────────────────
  describe("(a) rejects manual activation without a passing evalReport.gate.pass", () => {
    it("rejects when evalReport is entirely absent (never evaluated)", async () => {
      const v = await seedVersion("0.1.0-no-eval", null);
      await expect(
        activateModelVersionManual(modelId, v.id, { actorUserId: 1 }),
      ).rejects.toThrow(/quality gate/i);
      expect(await readStatus(v.id)).not.toBe("ACTIVE");
    });

    it("rejects when evalReport.gate.pass is false (failed the gate)", async () => {
      const v = await seedVersion("0.2.0-fail-gate", {
        gate: { pass: false, reason: "regressed", accuracyDelta: -0.2, epsilon: 0 },
        candidate: { accuracy: 0.5 },
      });
      await expect(
        activateModelVersionManual(modelId, v.id, { actorUserId: 1 }),
      ).rejects.toThrow(/quality gate/i);
      expect(await readStatus(v.id)).not.toBe("ACTIVE");
    });

    it("rejects when evalReport exists but has no gate at all (malformed/legacy)", async () => {
      const v = await seedVersion("0.25.0-no-gate-field", { candidate: { accuracy: 0.9 } });
      await expect(
        activateModelVersionManual(modelId, v.id, { actorUserId: 1 }),
      ).rejects.toThrow(/quality gate/i);
    });
  });

  // ── (b) SUCCEEDS — passing gate ──────────────────────────────────────────────
  it("(b) activates when evalReport.gate.pass === true", async () => {
    const v = await seedVersion("0.3.0-pass-gate", {
      gate: { pass: true, reason: "ok", accuracyDelta: 0.01, epsilon: 0 },
      candidate: { accuracy: 0.97 },
    });
    const result = await activateModelVersionManual(modelId, v.id, { actorUserId: 1 });
    expect(result.id).toBe(v.id);
    expect(await readStatus(v.id)).toBe("ACTIVE");
  });

  // ── (c) force:true + reason — activates AND audits ───────────────────────────
  it("(c) force:true with a reason activates a failing-gate version AND writes an audit entry", async () => {
    const v = await seedVersion("0.4.0-force-with-reason", {
      gate: { pass: false, reason: "regressed", accuracyDelta: -0.1, epsilon: 0 },
    });

    await activateModelVersionManual(modelId, v.id, {
      actorUserId: 7,
      force: true,
      reason: "Bootstrap: first model registered for this product, no baseline to compare against yet.",
    });

    expect(await readStatus(v.id)).toBe("ACTIVE");

    const db = await getDb();
    const logs = await db!
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, v.id));
    const entry = logs.find((l) => l.action === "ai_model_version.activate_override");
    expect(entry).toBeTruthy();
    expect(entry!.userId).toBe(7);
    expect(entry!.entityType).toBe("model_version");
    const details = JSON.parse(entry!.details ?? "{}");
    expect(details.reason).toMatch(/bootstrap/i);
    expect(details.modelId).toBe(modelId);
    expect(details.versionId).toBe(v.id);
    expect(details.gateOverridden).toBe(true);
  });

  // ── (d) force:true WITHOUT a reason — rejected, no activation, no audit ──────
  it("(d) force:true without a reason is rejected (no activation, no audit entry)", async () => {
    const v = await seedVersion("0.5.0-force-no-reason", {
      gate: { pass: false, reason: "regressed" },
    });

    await expect(
      activateModelVersionManual(modelId, v.id, { actorUserId: 1, force: true }),
    ).rejects.toThrow(/reason/i);
    // Blank/whitespace-only reason must be rejected the same way.
    await expect(
      activateModelVersionManual(modelId, v.id, { actorUserId: 1, force: true, reason: "   " }),
    ).rejects.toThrow(/reason/i);

    expect(await readStatus(v.id)).not.toBe("ACTIVE");

    const db = await getDb();
    const logs = await db!.select().from(auditLogs).where(eq(auditLogs.entityId, v.id));
    expect(logs.find((l) => l.action === "ai_model_version.activate_override")).toBeUndefined();
  });

  // ── doc69 W0-2 follow-up — manualRollback() enforces the SAME gate policy ─────
  //
  // BUG this closes: modelAutoRollback.manualRollback() (called by aiRobotAnomalyRouter's
  // `manualRollback` — a live protectedProcedure, flag-independent, a human picks ANY
  // target version via the RobotModelHealth "Manual rollback" dialog) called the RAW
  // ungated activateModelVersion() directly — the exact same bypass W0-2 closed for
  // `activateVersion`. manualRollback() now delegates the status flip to the SAME
  // activateModelVersionManual() gate above, so the policy (and audit trail) is
  // identical. The AUTOMATED runRollbackForModel safety net is deliberately NOT
  // gated here (untouched — still calls the raw activateModelVersion) since its
  // target is already constrained by pickRollbackTarget and it must not be blocked
  // by missing eval history.
  describe("manualRollback — eval quality gate on HUMAN-triggered rollback (doc69 W0-2 follow-up)", () => {
    it("rejects a rollback target without a passing evalReport.gate.pass (no force) — no event, no activation", async () => {
      const v = await seedVersion("0.6.0-rollback-fail-gate", {
        gate: { pass: false, reason: "regressed", accuracyDelta: -0.2 },
      });
      const outcome = await manualRollback(modelId, v.id, 1, "trying to roll back to an unvetted build");
      expect(outcome.rolledBack).toBe(false);
      expect(outcome.reason).toMatch(/quality gate/i);
      expect(await readStatus(v.id)).not.toBe("ACTIVE");

      const db = await getDb();
      const events = await db!.select().from(modelRollbackEvents).where(eq(modelRollbackEvents.toVersionId, v.id));
      expect(events).toHaveLength(0);
    });

    it("rejects a rollback target with no evalReport at all (no force)", async () => {
      const v = await seedVersion("0.65.0-rollback-no-eval", null);
      const outcome = await manualRollback(modelId, v.id, 1, "rolling back");
      expect(outcome.rolledBack).toBe(false);
      expect(outcome.reason).toMatch(/quality gate/i);
      expect(await readStatus(v.id)).not.toBe("ACTIVE");
    });

    it("succeeds rolling back to a target whose evalReport.gate.pass === true (no force needed)", async () => {
      const v = await seedVersion("0.7.0-rollback-pass-gate", {
        gate: { pass: true, reason: "ok", accuracyDelta: 0.01 },
      });
      const outcome = await manualRollback(modelId, v.id, 1, "rolling back to a known-good build");
      expect(outcome.rolledBack).toBe(true);
      expect(await readStatus(v.id)).toBe("ACTIVE");

      const db = await getDb();
      const events = await db!.select().from(modelRollbackEvents).where(eq(modelRollbackEvents.toVersionId, v.id));
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].trigger).toBe("manual");

      const logs = await db!.select().from(auditLogs).where(eq(auditLogs.entityId, v.id));
      expect(logs.find((l) => l.action === "ai_model_version.activate_override")).toBeUndefined();
    });

    it("force:true rolls back to a failing-gate target AND writes the SAME audit override entry", async () => {
      const v = await seedVersion("0.8.0-rollback-force", {
        gate: { pass: false, reason: "regressed", accuracyDelta: -0.15 },
      });
      const outcome = await manualRollback(
        modelId, v.id, 9, "Known incident — target predates eval-gate tracking, verified stable manually",
        { force: true },
      );
      expect(outcome.rolledBack).toBe(true);
      expect(await readStatus(v.id)).toBe("ACTIVE");

      const db = await getDb();
      const events = await db!.select().from(modelRollbackEvents).where(eq(modelRollbackEvents.toVersionId, v.id));
      expect(events.length).toBeGreaterThanOrEqual(1);

      const logs = await db!.select().from(auditLogs).where(eq(auditLogs.entityId, v.id));
      const entry = logs.find((l) => l.action === "ai_model_version.activate_override");
      expect(entry).toBeTruthy();
      expect(entry!.userId).toBe(9); // acting user id threaded through as triggeredBy → actorUserId
      expect(entry!.entityType).toBe("model_version");
    });

    it("no-target / no-db outcomes are unaffected (pre-existing contract preserved)", async () => {
      const outcome = await manualRollback(modelId, 99999999, 1, "bogus target");
      expect(outcome.rolledBack).toBe(false);
      expect(outcome.reason).toMatch(/not found/i);
    });
  });
});
