/**
 * Khối 1 (doc 16 §5 / §15 X1-e) — COMMAND-LEVEL AUTHORIZATION.  Flag: FIELD_V2_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Enforces a CommandDescriptor's `requiredPermission` at the DISPATCHER boundary, as
 * an ADDITIVE guard layered on top of the existing safety gates. It does NOT replace
 * or relax any of them:
 *
 *   existing gates (UNCHANGED, still run): idempotency → HITL (confirmedBy) →
 *   active/connected driver → MODE GATE (dry-run unless *_CONTROL_ENABLED) → write.
 *
 *   this guard ADDS: when a command's descriptor declares requiredPermission AND
 *   FIELD_V2_ENABLED is on, the caller (resolved from the dispatch's requestedBy/
 *   confirmedBy user) must actually hold that `${module}/${action}` permission — else
 *   the command is DENIED before any write, with a clear error (for the dispatcher to
 *   record an append-only audit row).
 *
 * FLAG SEMANTICS (no breakage):
 *   • FIELD_V2_ENABLED off (DEFAULT) → authorizeCommand returns { ok:true } ALWAYS
 *     (current behaviour preserved; the descriptor permission is advisory only).
 *   • FIELD_V2_ENABLED on            → STRICT: deny when the caller lacks the permission.
 *
 * SAFETY: this can only ever DENY a command (tighten), never permit one that the
 * existing gates would block. It opens NO new control path and never touches HITL /
 * dry-run logic — those gates run independently in the dispatcher.
 *
 * The descriptor resolution (`requiredPermissionForVerb`) is PURE + unit-tested.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { getDefaultCapability, type EquipmentClass } from "../equipment/capabilityModel";
import { fieldV2Enabled } from "./fieldHealthService";

export { fieldV2Enabled };

export interface PermissionTuple {
  module: string;
  action: "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport";
}

/** PURE — parse a descriptor `requiredPermission` ("machine_control/canCreate"). */
export function parsePermission(requiredPermission: string | undefined | null): PermissionTuple | null {
  if (!requiredPermission || typeof requiredPermission !== "string") return null;
  const [module, action] = requiredPermission.split("/");
  if (!module || !action) return null;
  const valid = ["canView", "canCreate", "canEdit", "canDelete", "canExport"];
  if (!valid.includes(action)) return null;
  return { module, action: action as PermissionTuple["action"] };
}

/**
 * PURE — resolve the requiredPermission for a command verb on an equipment class, from
 * the canonical capability model. Returns null when the class doesn't declare that verb
 * (no descriptor → no extra requirement; the existing gates still apply). Side-effect
 * free + unit-testable.
 */
export function requiredPermissionForVerb(equipmentClass: string, verb: string): PermissionTuple | null {
  const cap = getDefaultCapability(equipmentClass as EquipmentClass);
  const cmd = cap.supportedCommands.find((c) => c.name === verb);
  if (!cmd) return null;
  return parsePermission(cmd.requiredPermission);
}

export interface AuthorizeInput {
  equipmentClass: string;
  /** Canonical command verb (== CommandDescriptor.name). */
  verb: string;
  /** The user whose permission is checked (the confirming/requesting actor). */
  userId: number;
  userRole: string;
}

export interface AuthorizeResult {
  ok: boolean;
  /** True when the flag was off → guard skipped (current behaviour). */
  skipped: boolean;
  requiredPermission?: string;
  reason?: string;
}

/**
 * Authorize a command at the dispatcher boundary. NEVER throws.
 *   • flag off → { ok:true, skipped:true } (current behaviour, no denial).
 *   • flag on  → resolve descriptor permission; admin always passes; otherwise consult
 *     checkPermission(); deny with a clear reason when the caller lacks it.
 *   • a verb with no descriptor permission → allow (nothing extra to enforce).
 */
export async function authorizeCommand(input: AuthorizeInput): Promise<AuthorizeResult> {
  if (!fieldV2Enabled()) return { ok: true, skipped: true };

  const perm = requiredPermissionForVerb(input.equipmentClass, input.verb);
  if (!perm) return { ok: true, skipped: false }; // no declared permission → nothing to add

  const required = `${perm.module}/${perm.action}`;
  try {
    const { checkPermission } = await import("../../_core/accessControl");
    const allowed = await checkPermission(input.userId, input.userRole, perm.module, perm.action);
    if (allowed) return { ok: true, skipped: false, requiredPermission: required };
    return {
      ok: false,
      skipped: false,
      requiredPermission: required,
      reason: `command "${input.verb}" requires permission ${required}`,
    };
  } catch (err) {
    // Fail-CLOSED under the strict flag: if we cannot verify the permission, deny.
    return {
      ok: false,
      skipped: false,
      requiredPermission: required,
      reason: `permission check failed: ${(err as Error)?.message || String(err)}`,
    };
  }
}
