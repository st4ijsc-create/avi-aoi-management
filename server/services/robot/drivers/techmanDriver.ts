/**
 * Phase 3 — Techman (TM) cobot driver (scaffold).
 *
 * Integration approach (TM Robot / TMflow):
 *   - Modbus TCP server on the controller for state/I/O, and
 *   - TMflow "Listen Node" (Ethernet socket, TMSCT/TMSTA external-script
 *     protocol) for motion scripting.
 * Wire the real client here (lazy-import its lib) and replace the throw.
 */
import { NotImplementedRobotDriver } from "./notImplementedRobotDriver";
import type { RobotDriver } from "../robotDriver";

export const createTechmanDriver = (): RobotDriver =>
  new NotImplementedRobotDriver("techman", "TM Modbus-TCP/Listen-Node client not wired (Phase 3 scaffold)");
