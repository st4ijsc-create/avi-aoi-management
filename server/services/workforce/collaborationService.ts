/**
 * S1-a (doc 16 §8 d / §15 S1) — Human↔Robot handover handshake.  Flag: WORKFORCE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A small, ADVISORY state machine coordinating a human↔robot handover for one
 * task/operation. Phases are FORWARD-ONLY:
 *
 *     human_prep ──advance──▶ robot_work ──advance──▶ human_verify ──advance──▶ done
 *          └────────────────── abort (any non-done phase) ──────────────────▶ done
 *
 * handshakeState tracks the per-phase signal (pending → ack → clear) — it must reach
 * `clear` before a phase may `advance`. This is COORDINATION metadata only.
 *
 * SAFETY / HONESTY: this is ADVISORY. The handshake is NOT a safety interlock and is
 * NOT safety-rated; it never commands a device and provides no timing guarantee. It
 * exists so the human and robot agree on whose turn it is, reducing space/time
 * conflicts — a hardware-rated guard is deferred to S2. No-op (enabled:false) unless
 * WORKFORCE_ENABLED.
 *
 * The transition rules are a PURE function (nextPhase / canAdvance) so they are
 * unit-testable without a DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { collaborationSessions, type CollaborationSession } from "../../../drizzle/schema";
import { workforceEnabled } from "./workforceService";
import { recordAuditEvent } from "../audit/controlAuditService";

export type CollabPhase = "human_prep" | "robot_work" | "human_verify" | "done";
export type HandshakeState = "pending" | "ack" | "clear";

const PHASE_ORDER: CollabPhase[] = ["human_prep", "robot_work", "human_verify", "done"];

/** PURE — the phase that follows `phase` on advance (clamps at done). */
export function nextPhase(phase: CollabPhase): CollabPhase {
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return "done";
  return PHASE_ORDER[i + 1];
}

/** PURE — may we advance out of `phase`? Only when the handshake is `clear` and not done. */
export function canAdvance(phase: CollabPhase, handshakeState: HandshakeState): boolean {
  return phase !== "done" && handshakeState === "clear";
}

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

export interface StartCollabInput {
  taskId?: number | null;
  operationCode?: string | null;
  humanOperatorId?: number | null;
  robotDeviceId?: number | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

/** Start a handover session in phase human_prep / handshake pending. */
export async function startCollaboration(input: StartCollabInput): Promise<{ ok: boolean; enabled: boolean; session?: CollaborationSession; message?: string }> {
  if (!workforceEnabled()) return { ok: false, enabled: false, message: "WORKFORCE_ENABLED off" };
  const d = await db();
  const [session] = await d
    .insert(collaborationSessions)
    .values({
      taskId: input.taskId ?? null,
      operationCode: input.operationCode ?? null,
      humanOperatorId: input.humanOperatorId ?? null,
      robotDeviceId: input.robotDeviceId ?? null,
      phase: "human_prep",
      handshakeState: "pending",
      scope: input.scope ?? null,
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();
  return { ok: true, enabled: true, session };
}

/** Set the handshake signal for the CURRENT phase (pending → ack → clear). */
export async function signalHandshake(sessionId: number, state: HandshakeState): Promise<CollaborationSession | null> {
  if (!workforceEnabled()) return null;
  const d = await db();
  const [current] = await d.select().from(collaborationSessions).where(eq(collaborationSessions.id, sessionId)).limit(1);
  if (!current) return null;
  if (current.phase === "done") return current; // terminal — no more signals
  const [row] = await d
    .update(collaborationSessions)
    .set({ handshakeState: state, updatedAt: new Date() })
    .where(eq(collaborationSessions.id, sessionId))
    .returning();
  return row ?? null;
}

/**
 * Advance to the next phase. Requires the current handshake to be `clear` (else a
 * no-op return of the unchanged row). On reaching `done`, stamps endedAt. Resets the
 * handshake to `pending` for the new phase.
 */
export async function advancePhase(sessionId: number): Promise<{ ok: boolean; session: CollaborationSession | null; reason?: string }> {
  if (!workforceEnabled()) return { ok: false, session: null, reason: "WORKFORCE_ENABLED off" };
  const d = await db();
  const [current] = await d.select().from(collaborationSessions).where(eq(collaborationSessions.id, sessionId)).limit(1);
  if (!current) return { ok: false, session: null, reason: "not found" };
  if (!canAdvance(current.phase as CollabPhase, current.handshakeState as HandshakeState)) {
    return { ok: false, session: current, reason: current.phase === "done" ? "already done" : "handshake not clear" };
  }
  const np = nextPhase(current.phase as CollabPhase);
  const [row] = await d
    .update(collaborationSessions)
    .set({
      phase: np,
      handshakeState: np === "done" ? "clear" : "pending",
      endedAt: np === "done" ? new Date() : current.endedAt,
      updatedAt: new Date(),
    })
    .where(eq(collaborationSessions.id, sessionId))
    .returning();
  return { ok: true, session: row ?? null };
}

/** Abort a session → jump straight to done. Stamps abortedBy + ghi audit bất biến. */
export async function abortCollaboration(sessionId: number, reason?: string, abortedBy?: number | null): Promise<CollaborationSession | null> {
  if (!workforceEnabled()) return null;
  const d = await db();
  const [current] = await d.select().from(collaborationSessions).where(eq(collaborationSessions.id, sessionId)).limit(1);
  if (!current) return null;
  if (current.phase === "done") return current;
  const before = { ...current }; // snapshot bất biến TRƯỚC khi update (tránh alias mutation)
  const [row] = await d
    .update(collaborationSessions)
    .set({ phase: "done", handshakeState: "clear", endedAt: new Date(), abortedBy: abortedBy ?? null, notes: reason ?? current.notes, updatedAt: new Date() })
    .where(eq(collaborationSessions.id, sessionId))
    .returning();
  await recordAuditEvent(d, {
    entityType: "collaboration_session",
    entityId: sessionId,
    action: "abort",
    actorId: abortedBy ?? null,
    before,
    after: row ?? null,
    reason: reason ?? null,
  });
  return row ?? null;
}
