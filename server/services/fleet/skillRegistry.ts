/**
 * Khối 2 (doc 16 §7 part c / §15 G2) — Operation → Skill → Program registry.
 * Flag: FLEET_RESOURCE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * resolveOperation(code) turns a MES operation code into the orchestration shape
 * the allocator needs:
 *     { requiredCapability, requiredSkillIds, qualifiedPrograms[] }
 *
 *   • requiredCapability  — the canonical capabilityModel command verb the realising
 *                           DEVICE must support (HARD filter, exactly like G1).
 *   • requiredSkillIds    — masterdata.skills.id[] an OPERATOR (human) realisation
 *                           needs; matched against userCertifications.
 *   • qualifiedPrograms[] — program_projects rows mapped (compatible=true) to this
 *                           operation, optionally filtered by deviceKind — i.e. which
 *                           versioned robot programs / URDF artifacts may run it.
 *
 * deviceSupportsOperation() and operatorMeetsSkills() are PURE helpers so they are
 * trivially unit-testable and reusable by the allocator's flag-gated refinement.
 *
 * INTEGRATION: this module is READ-ONLY. It resolves/queries; it never assigns or
 * commands. The allocator consumes resolveOperation() ADDITIVELY (see taskAllocator
 * refineByOperation) and only when FLEET_RESOURCE_ENABLED is on — with the flag off,
 * G1 behaviour is byte-for-byte unchanged.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray, gt, isNull, or } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { operationCodes, operationProgramMap } from "../../../drizzle/schema/fleetResource";
import { userCertifications } from "../../../drizzle/schema/masterdata";
import { programProjects } from "../../../drizzle/schema/programming";
import { getDefaultCapability } from "../equipment/capabilityModel";
import { robotKindToCapabilityClass } from "./taskAllocator";

/** Flag — default OFF (mirrors fleetOrchEnabled). */
export function fleetResourceEnabled(): boolean {
  return process.env.FLEET_RESOURCE_ENABLED === "true" || process.env.FLEET_RESOURCE_ENABLED === "1";
}

export interface QualifiedProgram {
  programProjectId: number;
  programCode?: string;
  programName?: string;
  deviceKind?: string | null;
}

export interface ResolvedOperation {
  operationCodeId: number;
  code: string;
  requiredCapability: string;
  requiredSkillIds: number[];
  toolType: string | null;
  estimatedCycleMs: number | null;
  qualifiedPrograms: QualifiedProgram[];
}

/**
 * Resolve an operation code into capability + skills + qualified programs.
 * Returns null when the operation does not exist (caller treats as "no refinement").
 *
 * @param deviceKind optional — when given, qualifiedPrograms is filtered to programs
 *                   mapped for that deviceKind (or kind-agnostic rows with NULL kind).
 */
export async function resolveOperation(code: string, deviceKind?: string | null): Promise<ResolvedOperation | null> {
  const db = await getDb();
  if (!db) return null;

  const [op] = await db.select().from(operationCodes).where(eq(operationCodes.code, code)).limit(1);
  if (!op) return null;

  // Mapped programs (compatible only). The map is small per operation; join in code.
  const maps = await db
    .select()
    .from(operationProgramMap)
    .where(and(eq(operationProgramMap.operationCodeId, op.id), eq(operationProgramMap.compatible, true)));

  const filteredMaps = deviceKind
    ? maps.filter((m) => m.deviceKind == null || m.deviceKind === deviceKind)
    : maps;

  const qualifiedPrograms: QualifiedProgram[] = [];
  for (const m of filteredMaps) {
    const [proj] = await db.select().from(programProjects).where(eq(programProjects.id, m.programProjectId)).limit(1);
    qualifiedPrograms.push({
      programProjectId: m.programProjectId,
      programCode: proj?.code,
      programName: proj?.name,
      deviceKind: m.deviceKind ?? null,
    });
  }

  return {
    operationCodeId: op.id,
    code: op.code,
    requiredCapability: op.requiredCapability,
    requiredSkillIds: Array.isArray(op.requiredSkillIds) ? op.requiredSkillIds : [],
    toolType: op.toolType ?? null,
    estimatedCycleMs: op.estimatedCycleMs ?? null,
    qualifiedPrograms,
  };
}

/**
 * PURE — does a device of `capabilityClass` support the operation's required
 * capability verb? (Same gate as the G1 allocator's hard capability filter.)
 */
export function deviceSupportsCapability(capabilityClass: string, requiredCapability: string): boolean {
  return getDefaultCapability(capabilityClass).supportedCommands.some((c) => c.name === requiredCapability);
}

/** Convenience: device support keyed by a robots.kind (maps kind → capability class). */
export function robotSupportsOperation(robotKind: string | null | undefined, requiredCapability: string): boolean {
  return deviceSupportsCapability(robotKindToCapabilityClass(robotKind), requiredCapability);
}

/**
 * PURE — does the set of skill ids an operator holds (currently valid) cover every
 * required skill for an operation? Empty requirement → always true.
 */
export function operatorMeetsSkills(operatorSkillIds: number[], requiredSkillIds: number[]): boolean {
  if (!requiredSkillIds.length) return true;
  const held = new Set(operatorSkillIds);
  return requiredSkillIds.every((s) => held.has(s));
}

/**
 * DB helper — does a user (operator) hold the required skills via active, unexpired
 * userCertifications? Reuses masterdata.userCertifications (no new skill store).
 */
export async function operatorQualifiesForOperation(userId: number, operationCode: string): Promise<{ qualifies: boolean; missing: number[] }> {
  const db = await getDb();
  if (!db) return { qualifies: false, missing: [] };
  const op = await resolveOperation(operationCode);
  if (!op || op.requiredSkillIds.length === 0) return { qualifies: true, missing: [] };

  const now = new Date();
  const certs = await db
    .select()
    .from(userCertifications)
    .where(
      and(
        eq(userCertifications.userId, userId),
        eq(userCertifications.isActive, true),
        inArray(userCertifications.skillId, op.requiredSkillIds),
        // not expired: expiresAt is null (no expiry) OR in the future
        or(isNull(userCertifications.expiresAt), gt(userCertifications.expiresAt, now)),
      ),
    );
  const held = certs.map((c) => c.skillId);
  const missing = op.requiredSkillIds.filter((s) => !held.includes(s));
  return { qualifies: missing.length === 0, missing };
}
