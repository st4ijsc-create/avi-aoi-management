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
// doc 35 W2-C — structured honest health (mode: framework-only, liveIngest: false)
export { getSecsGemHealth, type SecsGemHealth } from "./secsGemRegistry";
// Full SECS-II item codec (all standard format codes) + the standard S1 messages
// built on it. `encodeItem`/`decodeItem` are aliased to avoid colliding with the
// legacy skeleton codec re-exported from ./secsMessages.
export {
  Secs2Format,
  I as Secs2ItemFactory,
  encodeItem as encodeSecs2Item,
  decodeItem as decodeSecs2Item,
  decodeItemWithLength as decodeSecs2ItemWithLength,
  type Secs2Item,
  type Secs2FormatCode,
} from "./secs2Codec";
// S1 builders/parsers on the new codec. The s1f* builders here return the new
// `Secs2Message` type; they are exported under `secs2`-prefixed names to avoid
// colliding with the legacy `secsMessages.ts` s1f* factories (which return the
// legacy `SecsMessage`). Parsers keep their own unambiguous names.
export {
  s1f1 as secs2S1F1,
  s1f2 as secs2S1F2,
  s1f13 as secs2S1F13,
  s1f14 as secs2S1F14,
  s1f17 as secs2S1F17,
  s1f18 as secs2S1F18,
  parseS1F2,
  parseS1F13,
  parseS1F14,
  parseS1F18,
  encodeBody as encodeSecs2Body,
  decodeBody as decodeSecs2Body,
  COMMACK,
  ONLACK,
  type Secs2Message,
  type OnlineData,
  type EstablishCommsAck,
  type OnlineAck,
} from "./s1Messages";
// E30 Communication + Control state models (pure reducers + observable holder).
export {
  nextCommState,
  nextControlState,
  isCommunicating,
  isOnline,
  controlSuperState,
  GemStateMachine,
  type GemCommState as E30CommState,
  type GemCommEvent,
  type GemControlState as E30ControlState,
  type GemControlEvent,
  type GemStateListeners,
  type CommStateChange,
  type ControlStateChange,
} from "./gemStateModel";
export {
  isSecsGemEnabled,
  registerSecsGem,
  createSecsGem,
  listSecsGemKeys,
  createSkeletonSecsGem,
  type SecsGemConnector,
  type SecsGemFactory,
} from "./secsGemRegistry";
// GEM300 message-stream layer (S2 equipment control + S7 process program/recipe),
// built on the SECS-II codec. Exposed under a namespace to avoid name collisions
// with the legacy skeleton codec's re-exported `encodeItem`/`decodeItem`. Flag:
// GEM300_ENABLED (default OFF). Host commands are gated HITL proposals — never
// ungated actuations (see gem300.ts header). PP = a versioned recipe (reuses recipe
// storage; no migration).
export * as gem300 from "./gem300";
