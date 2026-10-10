/**
 * doc 81 Đợt 4 final wave R-4-x — is a robot ENABLED right now (its `robots.isEnabled` row), read at MOTION time.
 *
 * The dispatcher sends to the active set loaded at BOOT (robotManager.getActiveRobot) and robot.setEnabled only updates
 * the row, so a robot disabled after boot used to keep receiving motion. The robot dispatcher now asks this module before
 * any MOTION driver call (never for a STOP). Bounded by STOP_DB_STEP_DEADLINE_MS (the robot DB-step deadline, R-1C-h).
 * Own module so suites that do not measure this gate can replace it explicitly (one named vi.mock), instead of each fake DB
 * having to model the robots table.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robots } from "../../../drizzle/schema";
import { DbUnavailableError } from "../../_core/dbErrors";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

/** true / false (false also for a missing row) or `{ error }` when the DB did not answer — the caller refuses motion. */
export async function readRobotEnabledForMotion(robotId: number): Promise<boolean | { error: string }> {
  try {
    const read = (async () => {
      const db = await getDb();
      if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
      const [row] = await db.select({ isEnabled: robots.isEnabled }).from(robots).where(eq(robots.id, robotId)).limit(1);
      return row?.isEnabled === true;
    })();
    return await withDeadline(read, STOP_DB_STEP_DEADLINE_MS, `robot ${robotId} enabled check`);
  } catch (err) {
    return { error: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}
