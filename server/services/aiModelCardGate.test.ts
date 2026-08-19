/**
 * D3 (doc69 Giai đoạn 4/Wave 3) — card-required activation gate + model-lifecycle
 * governance audit.
 *
 * ── Why `../db/ai` is partially mocked ────────────────────────────────────────────
 * `ai_model_cards` (migration 0303) is NOT applied by this task — the brief is explicit
 * it must ship unapplied. To exercise BOTH "table missing" (42P01, degrade to OFF) and
 * "table present with card X" scenarios WITHOUT ever running that migration against the
 * shared dev/test DB, only `getModelCardByModelId` is mocked (via `importOriginal` +
 * override) — every OTHER `../db/ai` export (createAiModel, createModelVersion,
 * getModelVersionById, updateModelVersion, updateAiModel, …) stays REAL, so
 * activateModelVersionManual's model/version reads/writes run against the actual
 * isolated test DB exactly like aiActivateGate.test.ts. Because aiModelCardGate.ts also
 * imports `getModelCardByModelId` from `../db/ai`, the mock transparently covers its
 * `evaluateCardGate`/`getModelCardStatus` too — no second-order mocking needed.
 *
 * `./auditTrailService` is similarly partially mocked (only `logCrudOperation`
 * overridden) so the governance-audit tests can assert exact call shape and simulate a
 * write failure (fail-safe requirement) without depending on real DB timing.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { eq, inArray } from "drizzle-orm";

// Disable the global audit-mutation middleware for the router-level (Part E/F) tests
// below — they now succeed past the role+2FA gates and reach real `roleProcedure`
// middleware chain, which would otherwise fire an async fire-and-forget audit write
// against the real test DB. Must be set before `_core/trpc.ts` is imported (hoisted) —
// mirrors parameterGuardrailRouter.test.ts's identical need.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

const getModelCardByModelIdMock = vi.fn();
const createModelCardMock = vi.fn();
vi.mock("../db/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/ai")>();
  return {
    ...actual,
    getModelCardByModelId: (...args: unknown[]) => getModelCardByModelIdMock(...args),
    createModelCard: (...args: unknown[]) => createModelCardMock(...args),
  };
});

const logCrudOperationMock = vi.fn(async () => ({ id: 1 }));
vi.mock("./auditTrailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auditTrailService")>();
  return {
    ...actual,
    logCrudOperation: (...args: unknown[]) => logCrudOperationMock(...args),
  };
});

import { getDb } from "../db/connection";
import { aiModels, modelVersions, modelRollbackEvents, auditLogs, type AiModelCard } from "../../drizzle/schema";
import { createAiModel, createModelVersion } from "../db/ai";
import { activateModelVersionManual } from "./aiModelService";
import { manualRollback } from "./ai/modelAutoRollback";
import {
  isModelCardRequired,
  isCardComplete,
  isCardApproved,
  evaluateCardGate,
  REQUIRED_CARD_FIELDS,
} from "./aiModelCardGate";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "./auditTrailService";
import { aiModelRouter } from "../routers/aiModelRouter";

const PASSING_GATE = { gate: { pass: true, reason: "ok", accuracyDelta: 0.01, epsilon: 0 }, candidate: { accuracy: 0.97 } };

function makeCard(overrides: Partial<AiModelCard> = {}): AiModelCard {
  return {
    id: 1,
    modelId: 1,
    intendedUse: "Defect classification on line A",
    trainingDataDesc: "2026-Q1 golden samples, 12k images",
    evalSummary: "F1 0.94 vs baseline 0.91",
    limitations: "Not validated for low-light stations",
    riskClass: "medium",
    owner: "quality-team",
    approvedBy: null,
    approvedAt: null,
    notes: null,
    createdBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AiModelCard;
}

function missingTableError(): Error & { code: string } {
  return Object.assign(new Error('relation "ai_model_cards" does not exist'), { code: "42P01" });
}

// ─── Part A — pure completeness/approval predicates ────────────────────────────────
describe("isCardComplete / isCardApproved (pure)", () => {
  it("REQUIRED_CARD_FIELDS excludes approvedBy/approvedAt/notes", () => {
    expect(REQUIRED_CARD_FIELDS).not.toContain("approvedBy");
    expect(REQUIRED_CARD_FIELDS).not.toContain("approvedAt");
    expect(REQUIRED_CARD_FIELDS).not.toContain("notes");
  });

  it("null/undefined card is neither complete nor approved", () => {
    expect(isCardComplete(null)).toBe(false);
    expect(isCardComplete(undefined)).toBe(false);
    expect(isCardApproved(null)).toBe(false);
  });

  it("a fully-populated card is complete", () => {
    expect(isCardComplete(makeCard())).toBe(true);
  });

  it("missing any single required field makes it incomplete", () => {
    for (const field of REQUIRED_CARD_FIELDS) {
      expect(isCardComplete(makeCard({ [field]: null } as Partial<AiModelCard>))).toBe(false);
      expect(isCardComplete(makeCard({ [field]: "   " } as Partial<AiModelCard>))).toBe(false);
    }
  });

  it("complete but unapproved is NOT approved", () => {
    expect(isCardApproved(makeCard())).toBe(false);
  });

  it("approvedBy + approvedAt both set ⇒ approved", () => {
    expect(isCardApproved(makeCard({ approvedBy: 7, approvedAt: new Date() }))).toBe(true);
  });

  it("only one of approvedBy/approvedAt set ⇒ NOT approved", () => {
    expect(isCardApproved(makeCard({ approvedBy: 7, approvedAt: null }))).toBe(false);
    expect(isCardApproved(makeCard({ approvedBy: null, approvedAt: new Date() }))).toBe(false);
  });
});

// ─── Part B — evaluateCardGate() against the mocked DB layer ───────────────────────
describe("evaluateCardGate()", () => {
  const ORIGINAL_FLAG = process.env.AI_MODEL_CARD_REQUIRED;

  beforeEach(() => {
    getModelCardByModelIdMock.mockReset();
  });
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.AI_MODEL_CARD_REQUIRED;
    else process.env.AI_MODEL_CARD_REQUIRED = ORIGINAL_FLAG;
  });

  it("flag OFF (default) ⇒ enforced:false, satisfied:true, NEVER touches the DB", async () => {
    delete process.env.AI_MODEL_CARD_REQUIRED;
    expect(isModelCardRequired()).toBe(false);
    const result = await evaluateCardGate(999);
    expect(result).toMatchObject({ enforced: false, satisfied: true });
    expect(getModelCardByModelIdMock).not.toHaveBeenCalled();
  });

  it("flag ON + table missing (42P01) ⇒ degrades to enforced:false, satisfied:true", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockRejectedValueOnce(missingTableError());
    const result = await evaluateCardGate(1);
    expect(result.enforced).toBe(false);
    expect(result.satisfied).toBe(true);
  });

  it("flag ON + some OTHER db error ⇒ rethrown, not swallowed", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(evaluateCardGate(1)).rejects.toThrow(/connection reset/);
  });

  it("flag ON + table present + NO card row ⇒ enforced:true, satisfied:false", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    const result = await evaluateCardGate(1);
    expect(result).toMatchObject({ enforced: true, satisfied: false });
    expect(result.reason).toMatch(/no model card/i);
  });

  it("flag ON + incomplete card ⇒ enforced:true, satisfied:false", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(makeCard({ limitations: null }));
    const result = await evaluateCardGate(1);
    expect(result).toMatchObject({ enforced: true, satisfied: false });
    expect(result.reason).toMatch(/incomplete/i);
  });

  it("flag ON + complete but unapproved ⇒ enforced:true, satisfied:false", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(makeCard());
    const result = await evaluateCardGate(1);
    expect(result).toMatchObject({ enforced: true, satisfied: false });
    expect(result.reason).toMatch(/not been approved/i);
  });

  it("flag ON + complete + approved ⇒ enforced:true, satisfied:true", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(makeCard({ approvedBy: 3, approvedAt: new Date() }));
    const result = await evaluateCardGate(1);
    expect(result).toMatchObject({ enforced: true, satisfied: true });
  });
});

// ─── Part C/D — activateModelVersionManual integration + governance audit ──────────
describe("activateModelVersionManual — D3 card gate + governance audit (real DB for models/versions)", () => {
  let modelId: number;
  const versionIds: number[] = [];
  const ORIGINAL_FLAG = process.env.AI_MODEL_CARD_REQUIRED;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("This test requires a live test DB — see vitest.setup.ts (DATABASE_URL → *_test clone).");
    const model = await createAiModel({
      code: `t3-card-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "D3 card-gate test model",
      modelType: "classification",
    } as any);
    modelId = model.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    // audit_logs is append-only (WORM) — intentionally not cleaned up (see aiActivateGate.test.ts).
    await db.delete(modelRollbackEvents).where(eq(modelRollbackEvents.modelId, modelId));
    if (versionIds.length > 0) {
      await db.delete(modelVersions).where(inArray(modelVersions.id, versionIds));
    }
    if (modelId) await db.delete(aiModels).where(eq(aiModels.id, modelId));
    if (ORIGINAL_FLAG === undefined) delete process.env.AI_MODEL_CARD_REQUIRED;
    else process.env.AI_MODEL_CARD_REQUIRED = ORIGINAL_FLAG;
  });

  beforeEach(() => {
    getModelCardByModelIdMock.mockReset();
    logCrudOperationMock.mockReset();
    logCrudOperationMock.mockResolvedValue({ id: 1 });
    delete process.env.AI_MODEL_CARD_REQUIRED;
  });

  async function seedVersion(version: string) {
    const v = await createModelVersion({
      modelId,
      version,
      status: "READY",
      evalReport: PASSING_GATE as any,
    } as any);
    versionIds.push(v.id);
    return v;
  }

  async function readStatus(versionId: number): Promise<string> {
    const db = await getDb();
    const [row] = await db!.select().from(modelVersions).where(eq(modelVersions.id, versionId));
    return row!.status;
  }

  it("flag OFF (default) — activates on a passing eval gate WITHOUT ever calling the card DB", async () => {
    const v = await seedVersion("1.0.0-flag-off");
    await activateModelVersionManual(modelId, v.id, { actorUserId: 1 });
    expect(await readStatus(v.id)).toBe("ACTIVE");
    expect(getModelCardByModelIdMock).not.toHaveBeenCalled();
  });

  it("flag ON + table missing (simulated 42P01) — degrades safely, activates without force", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockRejectedValueOnce(missingTableError());
    const v = await seedVersion("1.1.0-table-missing");
    await activateModelVersionManual(modelId, v.id, { actorUserId: 1 });
    expect(await readStatus(v.id)).toBe("ACTIVE");
  });

  it("flag ON + table present + no card — REFUSED without force", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    const v = await seedVersion("1.2.0-no-card");
    await expect(
      activateModelVersionManual(modelId, v.id, { actorUserId: 1 }),
    ).rejects.toThrow(/model card/i);
    expect(await readStatus(v.id)).not.toBe("ACTIVE");
  });

  it("flag ON + complete + approved card — ALLOWED without force", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(makeCard({ modelId, approvedBy: 2, approvedAt: new Date() }));
    const v = await seedVersion("1.3.0-card-ok");
    await activateModelVersionManual(modelId, v.id, { actorUserId: 1 });
    expect(await readStatus(v.id)).toBe("ACTIVE");
  });

  it("flag ON + missing card + {force:true, reason} — ALLOWED, and the SAME override audit is extended with card fields", async () => {
    process.env.AI_MODEL_CARD_REQUIRED = "true";
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    const v = await seedVersion("1.4.0-force-card");
    await activateModelVersionManual(modelId, v.id, {
      actorUserId: 8,
      force: true,
      reason: "Bootstrap model — card being authored in parallel",
    });
    expect(await readStatus(v.id)).toBe("ACTIVE");

    const db = await getDb();
    const logs = await db!.select().from(auditLogs).where(eq(auditLogs.entityId, v.id));
    const entry = logs.find((l) => l.action === "ai_model_version.activate_override");
    expect(entry).toBeTruthy();
    const details = JSON.parse(entry!.details ?? "{}");
    expect(details.cardGateEnforced).toBe(true);
    expect(details.cardGateOverridden).toBe(true);
    expect(details.cardGateHadSatisfied).toBe(false);
  });

  it("governance audit: successful (non-forced) activation writes AI_MODEL_GOVERNANCE with the right shape", async () => {
    const v = await seedVersion("1.5.0-governance-shape");
    await activateModelVersionManual(modelId, v.id, { actorUserId: 4 });

    expect(logCrudOperationMock).toHaveBeenCalled();
    const call = logCrudOperationMock.mock.calls.find(
      (c: any[]) => c[1]?.action === AUDIT_ACTIONS.AI_MODEL_GOVERNANCE,
    );
    expect(call).toBeTruthy();
    const [ctxArg, entryArg] = call as any[];
    expect(ctxArg.userId).toBe(4);
    expect(entryArg.entityType).toBe(ENTITY_TYPES.MODEL_VERSION);
    expect(entryArg.entityId).toBe(v.id);
    expect(entryArg.details.metadata).toMatchObject({
      modelId,
      versionId: v.id,
      action: "activate",
      evalGatePass: true,
      forced: false,
    });
    expect(entryArg.details.metadata.cardGate).toMatchObject({ enforced: false, satisfied: true });
  });

  it("governance audit: force-override activation is flagged forced:true in the governance row", async () => {
    const v = await seedVersion("1.6.0-governance-forced");
    await activateModelVersionManual(modelId, v.id, {
      actorUserId: 5,
      force: true,
      reason: "manual override for governance shape test",
    });

    const call = logCrudOperationMock.mock.calls.find(
      (c: any[]) => c[1]?.action === AUDIT_ACTIONS.AI_MODEL_GOVERNANCE && c[1]?.entityId === v.id,
    );
    expect(call).toBeTruthy();
    const [, entryArg] = call as any[];
    expect(entryArg.details.metadata.forced).toBe(true);
    expect(entryArg.details.metadata.reason).toMatch(/governance shape test/);
  });

  it("governance audit is FAIL-SAFE: a write failure never blocks activation", async () => {
    logCrudOperationMock.mockRejectedValueOnce(new Error("audit sink unreachable"));
    const v = await seedVersion("1.7.0-audit-failsafe");
    await expect(
      activateModelVersionManual(modelId, v.id, { actorUserId: 1 }),
    ).resolves.toBeTruthy();
    expect(await readStatus(v.id)).toBe("ACTIVE");
  });

  it("manualRollback labels the governance audit row action:'rollback'", async () => {
    const target = await seedVersion("1.8.0-rollback-target");
    // Give it a passing gate baseline so the gate doesn't block; force not needed.
    const outcome = await manualRollback(modelId, target.id, 6, "governance rollback labelling check");
    expect(outcome.rolledBack).toBe(true);

    const call = logCrudOperationMock.mock.calls.find(
      (c: any[]) => c[1]?.action === AUDIT_ACTIONS.AI_MODEL_GOVERNANCE && c[1]?.entityId === target.id,
    );
    expect(call).toBeTruthy();
    const [, entryArg] = call as any[];
    expect(entryArg.details.metadata.action).toBe("rollback");
  });
});

// ─── Part E — card CRUD RBAC (router-level, no DB touched on rejection) ────────────
describe("aiModelRouter card CRUD — admin/engineer RBAC", () => {
  function callerFor(role: string) {
    return aiModelRouter.createCaller({ user: { id: 1, role, name: "Tester", twoFactorEnabled: true } } as any);
  }

  it("operator cannot createCard", async () => {
    await expect(
      callerFor("operator").createCard({
        modelId: 1,
        intendedUse: "x",
        trainingDataDesc: "x",
        evalSummary: "x",
        limitations: "x",
        riskClass: "low",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("viewer cannot approveCard", async () => {
    await expect(callerFor("viewer").approveCard({ modelId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quality_inspector (not admin/engineer) cannot updateCard", async () => {
    await expect(
      callerFor("quality_inspector").updateCard({ modelId: 1, owner: "someone" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── Part F — card CRUD 2FA (D3 reviewer FIX 1) ─────────────────────────────────────
// create/update/approve are governance TRUST decisions (approve authorizes
// activation) — admin/engineer are PRIVILEGED_ROLES in _core/trpc.ts, so writes must
// require 2FA the same way supervisorProcedure/qualityProcedure/actuationProcedure do.
// getCard (read) must stay reachable WITHOUT 2FA so the editor can load an existing
// card before step-up.
describe("aiModelRouter card CRUD — 2FA required for admin/engineer WRITES only", () => {
  function callerForUser(user: Record<string, unknown>) {
    return aiModelRouter.createCaller({ user } as any);
  }

  const cardInput = (modelId: number) => ({
    modelId,
    intendedUse: "x",
    trainingDataDesc: "x",
    evalSummary: "x",
    limitations: "x",
    riskClass: "low" as const,
  });

  beforeEach(() => {
    getModelCardByModelIdMock.mockReset();
  });

  it("admin WITHOUT 2FA is FORBIDDEN on createCard, and the DB is never touched", async () => {
    await expect(
      callerForUser({ id: 1, role: "admin", name: "Admin", twoFactorEnabled: false }).createCard(cardInput(1)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getModelCardByModelIdMock).not.toHaveBeenCalled();
  });

  it("engineer WITHOUT 2FA is FORBIDDEN on approveCard", async () => {
    await expect(
      callerForUser({ id: 2, role: "engineer", name: "Eng", twoFactorEnabled: false }).approveCard({ modelId: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITHOUT 2FA is FORBIDDEN on updateCard", async () => {
    await expect(
      callerForUser({ id: 1, role: "admin", name: "Admin", twoFactorEnabled: false }).updateCard({ modelId: 1, owner: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITH 2FA clears the auth gate on createCard (fails downstream on a real NOT_FOUND model, not FORBIDDEN)", async () => {
    // modelId does not exist in the test DB — proves the request reached business
    // logic (db.getAiModelById), i.e. BOTH the role check and the 2FA check passed.
    await expect(
      callerForUser({ id: 1, role: "admin", name: "Admin", twoFactorEnabled: true }).createCard(cardInput(999_999_999)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("engineer WITH 2FA clears the auth gate on approveCard (fails downstream on NOT_FOUND card, not FORBIDDEN)", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    await expect(
      callerForUser({ id: 2, role: "engineer", name: "Eng", twoFactorEnabled: true }).approveCard({ modelId: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("engineer WITH 2FA clears the auth gate on updateCard (fails downstream on NOT_FOUND card, not FORBIDDEN)", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    await expect(
      callerForUser({ id: 2, role: "engineer", name: "Eng", twoFactorEnabled: true }).updateCard({ modelId: 1, owner: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getCard (read) does NOT require 2FA — even a privileged user without 2FA can still load the card", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    const result = await callerForUser({ id: 1, role: "admin", name: "Admin", twoFactorEnabled: false }).getCard({ modelId: 1 });
    expect(result.card).toBeNull();
  });
});

// ─── Part G — createCard concurrent double-create race (D3 reviewer FIX 2) ─────────
// The check-then-insert in createCard is not transactional; a concurrent second
// create can race past the `existing` check and hit the DB's own unique constraint
// on INSERT. That must surface as the SAME tRPC CONFLICT the check-then-insert path
// returns, not a raw 500.
describe("aiModelRouter.createCard — concurrent double-create race maps 23505 → CONFLICT", () => {
  let raceModelId: number;
  const CONFLICT_MESSAGE = "A model card already exists for this model — use update instead.";

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("This test requires a live test DB — see vitest.setup.ts (DATABASE_URL → *_test clone).");
    const model = await createAiModel({
      code: `t3-card-race-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "D3 card-race test model",
      modelType: "classification",
    } as any);
    raceModelId = model.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db || !raceModelId) return;
    await db.delete(aiModels).where(eq(aiModels.id, raceModelId));
  });

  beforeEach(() => {
    getModelCardByModelIdMock.mockReset();
    createModelCardMock.mockReset();
  });

  function adminCaller() {
    return aiModelRouter.createCaller({ user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any);
  }

  const cardInput = (modelId: number) => ({
    modelId,
    intendedUse: "x",
    trainingDataDesc: "x",
    evalSummary: "x",
    limitations: "x",
    riskClass: "low" as const,
  });

  it("maps a raced raw-driver 23505 on INSERT to the SAME CONFLICT the check-then-insert path returns", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null); // the check saw no existing row
    createModelCardMock.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint "ai_model_cards_model_id_unique"'),
        { code: "23505" },
      ),
    );
    await expect(adminCaller().createCard(cardInput(raceModelId))).rejects.toMatchObject({
      code: "CONFLICT",
      message: CONFLICT_MESSAGE,
    });
  });

  it("also maps a drizzle-wrapped 23505 (driver error nested in err.cause) to CONFLICT", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    const driverErr = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    createModelCardMock.mockRejectedValueOnce(
      Object.assign(new Error("Failed query: INSERT INTO ai_model_cards ..."), { cause: driverErr }),
    );
    await expect(adminCaller().createCard(cardInput(raceModelId))).rejects.toMatchObject({
      code: "CONFLICT",
      message: CONFLICT_MESSAGE,
    });
  });

  it("does NOT swallow an unrelated INSERT error as a false CONFLICT (only 23505/42P01 are mapped)", async () => {
    getModelCardByModelIdMock.mockResolvedValueOnce(null);
    createModelCardMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(adminCaller().createCard(cardInput(raceModelId))).rejects.toThrow(/connection reset/);
  });
});
