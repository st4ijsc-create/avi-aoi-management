/**
 * doc 81 Đợt 12 final fix wave (ruling R-12-e M-1) — the "no HMAC key" EPISODE of the cross-replica STOP sync, persisted across boots.
 *
 * Without OT_STOP_EPOCH_HMAC_KEY / SECRET_ENCRYPTION_KEY the sync is DISABLED on a replica (fail closed, otStopEpochSync). That used
 * to raise a high-severity alert + an inbox row on EVERY boot. Now ONE alert per key-missing EPISODE: the episode is remembered in the
 * alert rows themselves (the Đợt 11 worm-size pattern — notifications.metadata {kind:"ot_stop_epoch_sync", problem}), per admin:
 *   • a boot WITHOUT a key: an admin whose latest such row is `no_key` already holds this episode ⇒ nothing; every other active admin
 *     gets ONE `no_key` row and the console / alert stream say it once ("new episode"). All admins hold it ⇒ one console line only.
 *   • a boot WITH a key: the admins whose latest row is `no_key` get ONE `key_restored` row — the episode is closed; the next boot
 *     without a key opens a new one.
 * A read failure ⇒ the caller alerts (fail toward telling). No admin at all ⇒ nothing can be remembered: alerted on that boot.
 * Rows carry env NAMES only, never a value. Read-only except the notification rows it sends. Never throws to the STOP path (it is
 * not on it: boot only).
 */
import { sql } from "drizzle-orm";

export const OT_STOP_EPOCH_ALERT_KIND = "ot_stop_epoch_sync";
export type KeyEpisodeProblem = "no_key" | "key_restored";
export type KeyEpisodeOutcome = "new_episode" | "episode_continues" | "episode_closed" | "nothing";

type Executor = { execute: (q: unknown) => Promise<unknown> };
function rowsOf(r: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
}

/** What the episode needs from the database (tests inject an in-memory one). */
export interface KeyEpisodeIo {
  /** active admins (recipients) */
  recipients(): Promise<number[]>;
  /** per admin, the problem of the LATEST no_key / key_restored row (absent: none) */
  latest(): Promise<Map<number, KeyEpisodeProblem>>;
  /** send one row per user (metadata {kind, problem}) */
  write(userIds: number[], problem: KeyEpisodeProblem, title: string, message: string): Promise<void>;
}

/** The persisted episode state, read from the notification rows (DISTINCT ON the newest row per admin). */
export async function readKeyEpisodeLatest(db: Executor): Promise<Map<number, KeyEpisodeProblem>> {
  const r = rowsOf(
    await db.execute(sql`
      SELECT DISTINCT ON ("userId") "userId" AS uid, metadata->>'problem' AS problem
        FROM public.notifications
       WHERE metadata->>'kind' = ${OT_STOP_EPOCH_ALERT_KIND}
         AND metadata->>'problem' IN ('no_key', 'key_restored')
       ORDER BY "userId", id DESC`),
  );
  const m = new Map<number, KeyEpisodeProblem>();
  for (const x of r) {
    const uid = Number(x.uid);
    if (Number.isSafeInteger(uid) && uid > 0 && (x.problem === "no_key" || x.problem === "key_restored")) m.set(uid, x.problem);
  }
  return m;
}

/** The default io: the app DB + notificationService (NORMAL priority, own kind, no cap exemption — R-11-b). */
export function defaultKeyEpisodeIo(): KeyEpisodeIo {
  const db = async (): Promise<Executor> => {
    const d = (await (await import("../../db/connection")).getDb()) as unknown as Executor | null;
    if (!d) {
      const { DbUnavailableError } = await import("../../_core/dbErrors");
      throw new DbUnavailableError("database unavailable");
    }
    return d;
  };
  return {
    recipients: async () =>
      rowsOf(await (await db()).execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role = 'admin'`))
        .map((x) => Number(x.id))
        .filter((x) => Number.isSafeInteger(x) && x > 0),
    latest: async () => readKeyEpisodeLatest(await db()),
    write: async (userIds, problem, title, message) => {
      const { sendNotification } = await import("../notificationService");
      for (const userId of userIds) {
        await sendNotification(userId, { type: "ALERT", priority: "NORMAL", title, message, entityType: "system", metadata: { kind: OT_STOP_EPOCH_ALERT_KIND, problem } }).catch(() => undefined);
      }
    },
  };
}

/** The env NAMES an operator sets; never a value. */
export const NO_KEY_FIX = "Set OT_STOP_EPOCH_HMAC_KEY (at least 32 characters, the same on every central replica) or SECRET_ENCRYPTION_KEY.";

/**
 * Settle this boot against the persisted episode. `keyPresent` false ⇒ open the episode for the admins that do not hold it (rows
 * written) and say whether this is a NEW episode (the caller raises the console / stream alert then, and only then). true ⇒ close
 * the episode for the admins that hold it. Throws only when the episode cannot be read (the caller alerts).
 */
export async function settleKeyEpisode(keyPresent: boolean, reason: string | null, io: KeyEpisodeIo): Promise<{ outcome: KeyEpisodeOutcome; recipients: number[] }> {
  const latest = await io.latest();
  if (keyPresent) {
    const open = [...latest].filter(([, p]) => p === "no_key").map(([u]) => u);
    if (open.length === 0) return { outcome: "nothing", recipients: [] };
    await io.write(open, "key_restored", "OT STOP sync between central replicas enabled again", "Cross-replica STOP sync: an HMAC key is configured again on a central replica — the sync is enabled there (the earlier \"disabled: no HMAC key\" alert is resolved for that replica).");
    return { outcome: "episode_closed", recipients: open };
  }
  const admins = await io.recipients();
  if (admins.length === 0) return { outcome: "new_episode", recipients: [] }; // nobody to remember it for: said on this boot
  const need = admins.filter((u) => latest.get(u) !== "no_key");
  // an episode is open when ANY admin holds it: an admin added meanwhile gets the row, the console / stream do not repeat it
  const anyOpen = [...latest.values()].includes("no_key");
  if (need.length === 0) return { outcome: "episode_continues", recipients: [] };
  await io.write(
    need,
    "no_key",
    "OT STOP sync between central replicas DISABLED: no HMAC key",
    `Cross-replica STOP sync is DISABLED on a central replica (${reason ?? "no HMAC key"}): a STOP sent by one replica does not cancel writes still in another replica's checks. Harmless with ONE central process. ${NO_KEY_FIX} This alert is raised once per episode, not on every restart.`,
  );
  return { outcome: anyOpen ? "episode_continues" : "new_episode", recipients: need };
}
