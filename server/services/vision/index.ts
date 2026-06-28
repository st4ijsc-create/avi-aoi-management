/**
 * Vision / Inspection Adapter framework entrypoint.
 *
 * Importing this module has the SIDE-EFFECT of registering every built-in vendor
 * adapter into the registry (mirrors server/services/ot/index.ts). Add new vendors
 * (Cognex, Keyence, TRI, Omron …) by writing an adapter in ./adapters and registering
 * it here.
 */
import { registerVisionAdapter } from "./visionAdapterRegistry";
import { createGenericJsonAdapter } from "./adapters/genericJson";
import { createKohYoungAdapter } from "./adapters/kohYoung";

registerVisionAdapter("generic-json", createGenericJsonAdapter);
registerVisionAdapter("koh-young", createKohYoungAdapter);

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
