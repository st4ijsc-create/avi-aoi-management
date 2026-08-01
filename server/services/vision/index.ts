/**
 * Vision / Inspection Adapter framework entrypoint.
 *
 * Importing this module has the SIDE-EFFECT of registering every built-in vendor
 * adapter into the registry (mirrors server/services/ot/index.ts). Add new vendors
 * (Omron, CyberOptics, ViTrox, Parmi, Pemtron …) by writing an adapter in ./adapters
 * and registering it here.
 *
 * Adapter tiers (doc 27 C2/C6 + decision #3):
 *   • st4i-standard — NORMATIVE: the published ST4I Standard Inspection Feed (doc 28,
 *     JSON/CSV/XML) that custom machines build against; strictly zod-validated.
 *   • generic-json — simplest ad-hoc JSON onboarding path.
 *   • koh-young / cognex / keyence / tri / saki-aoi / mirtec / ict-aoi — representative
 *     vendor shapes, honestly marked in each adapter header as PENDING validation against
 *     real machine export files; golden fixtures live in ./adapters/__fixtures__/.
 */
import { registerVisionAdapter } from "./visionAdapterRegistry";
import { createGenericJsonAdapter } from "./adapters/genericJson";
import { createKohYoungAdapter } from "./adapters/kohYoung";
import { createCognexAdapter } from "./adapters/cognex";
import { createKeyenceAdapter } from "./adapters/keyence";
import { createTriAdapter } from "./adapters/tri";
import { createSt4iStandardAdapter } from "./adapters/st4iStandard";
import { createIctAoiAdapter } from "./adapters/ictAoi";
import { createSakiAoiAdapter } from "./adapters/sakiAoi";
import { createMirtecAdapter } from "./adapters/mirtec";

registerVisionAdapter("generic-json", createGenericJsonAdapter);
registerVisionAdapter("koh-young", createKohYoungAdapter);
registerVisionAdapter("cognex", createCognexAdapter);
registerVisionAdapter("keyence", createKeyenceAdapter);
registerVisionAdapter("tri", createTriAdapter);
registerVisionAdapter("st4i-standard", createSt4iStandardAdapter);
registerVisionAdapter("ict-aoi", createIctAoiAdapter);
registerVisionAdapter("saki-aoi", createSakiAoiAdapter);
registerVisionAdapter("mirtec", createMirtecAdapter);

export {
  registerVisionAdapter,
  getVisionAdapter,
  listVisionAdapters,
} from "./visionAdapterRegistry";
export type {
  VisionAdapter,
  VisionAdapterFactory,
  VisionNormalizeContext,
  CanonicalInspection,
  CanonicalMeasurement,
  CanonicalResult,
} from "./visionAdapterRegistry";
