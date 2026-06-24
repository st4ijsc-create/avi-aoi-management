/**
 * Phase 3 — Delta robot driver (scaffold).
 *
 * Integration approach (Delta DRV/DRA robots + controllers):
 *   - Modbus TCP for I/O + status/registers, or
 *   - Delta ASCII protocol / DMCNET via the controller.
 * Wire the real client here (lazy-import its lib) and replace the throw.
 */
import { NotImplementedRobotDriver } from "./notImplementedRobotDriver";
import type { RobotDriver } from "../robotDriver";

export const createDeltaRobotDriver = (): RobotDriver =>
  new NotImplementedRobotDriver("delta", "Delta Modbus-TCP/DMCNET client not wired (Phase 3 scaffold)");
