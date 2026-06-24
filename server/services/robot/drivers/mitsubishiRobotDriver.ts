/**
 * Phase 3 — Mitsubishi MELFA robot driver (scaffold).
 *
 * Integration approach (CR series controllers):
 *   - TCP socket to the controller (Real-time external control / MXT), or
 *   - SLMP for I/O + status, or the MELFA "Data Link" command channel.
 * Wire the real client here (lazy-import its lib) and replace the throw.
 */
import { NotImplementedRobotDriver } from "./notImplementedRobotDriver";
import type { RobotDriver } from "../robotDriver";

export const createMitsubishiRobotDriver = (): RobotDriver =>
  new NotImplementedRobotDriver("mitsubishi", "MELFA TCP/SLMP client not wired (Phase 3 scaffold)");
