/**
 * Phase 3 — FANUC robot driver (scaffold).
 *
 * Integration approach (R-30iB / R-30iB Plus controllers):
 *   - RMI (Robot Motion Interface): TCP socket JSON-ish command API, or
 *   - KAREL socket messaging / PC Interface, or EtherNet/IP for I/O + state.
 * Wire the real client here (lazy-import its lib) and replace the throw.
 */
import { NotImplementedRobotDriver } from "./notImplementedRobotDriver";
import type { RobotDriver } from "../robotDriver";

export const createFanucDriver = (): RobotDriver =>
  new NotImplementedRobotDriver("fanuc", "FANUC RMI/KAREL client not wired (Phase 3 scaffold)");
