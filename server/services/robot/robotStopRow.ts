/**
 * doc 81 Đợt 10 task D fix review 4 (R-10-av, NF-2) — the robot row a transient-session STOP needs (vendor, endpoint, connection
 * options), read under ONE STOP bound that starts when the read is STARTED. The console STOP of a robot this process holds no
 * session for starts this read at request entry, in PARALLEL with the owner read (both under the same 1 s), and hands the promise
 * to the transient STOP: the send starts ≤ 1 s after the request, never after two sequential bounds. Never rejects.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

export type RobotStopRow = { vendor: string; endpoint: string; connectionOptions: unknown };
export type RobotStopRowRead = { ok: true; row: RobotStopRow | undefined } | { ok: false; error: string };

export function prefetchRobotStopRow(robotId: number, boundMs: number = STOP_DB_STEP_DEADLINE_MS): Promise<RobotStopRowRead> {
  return withDeadline(
    (async () => {
      const { robots } = await import("../../../drizzle/schema"); // inside the bound (a cold import counts too)
      const db = await getDb();
      if (!db) throw new DbUnavailableError("database unavailable (robot row)");
      const [r] = await db.select().from(robots).where(eq(robots.id, robotId)).limit(1);
      return r ? { vendor: String(r.vendor), endpoint: String(r.endpoint), connectionOptions: r.connectionOptions } : undefined;
    })(),
    boundMs,
    `robot ${robotId} row for a transient STOP`,
  ).then(
    (row): RobotStopRowRead => ({ ok: true, row }),
    (err): RobotStopRowRead => ({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) }),
  );
}
