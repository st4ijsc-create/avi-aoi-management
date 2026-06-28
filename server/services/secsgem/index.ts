/**
 * SECS/GEM Connectivity FRAMEWORK — entrypoint (SEMI E4/E5/E30/E37).
 *
 * ── HONESTY ──────────────────────────────────────────────────────────────────
 * This is a FLAG-GATED FRAMEWORK, not a certified production GEM driver. Going
 * live requires REAL equipment plus validation of the full SECS-II binary codec
 * and the GEM state machine against that equipment (or a vetted SECS library such
 * as `secs-gem`). See per-file headers (secsMessages / hsmsClient / gemModel).
 *
 * Importing this module has the SIDE-EFFECT of registering the built-in "secsgem"
 * connector (mirrors server/services/ot/index.ts). Registration opens NO sockets;
 * the master flag SECS_GEM_ENABLED (default OFF) gates any real connection.
 */
import { registerSecsGem, createSkeletonSecsGem } from "./secsGemRegistry";

// Side-effect: register the built-in skeleton connector.
registerSecsGem("secsgem", createSkeletonSecsGem);

export * from "./secsMessages";
export * from "./hsmsClient";
export * from "./gemModel";
export {
  isSecsGemEnabled,
  registerSecsGem,
  createSecsGem,
  listSecsGemKeys,
  createSkeletonSecsGem,
  type SecsGemConnector,
  type SecsGemFactory,
} from "./secsGemRegistry";
