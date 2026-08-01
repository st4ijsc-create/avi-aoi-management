/**
 * Developer Portal — SYNAPSE R3 / Open-APIs + DX attributes (doc 33 §3.8 / P6).
 *
 * The public face for third-party integrators: published OpenAPI/AsyncAPI specs, the extension
 * points, a `synapse plugin new` template, a conformance checklist, and a manifest validator +
 * sandbox check — so a partner integrates "chỉ bằng tài liệu công bố" and reaches first-plugin in
 * ≤ 1 day (KPI). Pure orchestration over F2 (manifest) + F7 (specs). Flag DEV_PORTAL.
 */
import { PLUGIN_API_VERSION, validateManifest, type PluginManifest } from "@shared/plugin/manifest";
import { buildSeedSpecs } from "../contracts/apiSpec";
import { EXTENSION_POINTS, conformanceChecklist, newPluginManifest } from "./pluginTemplate";

export interface PortalIndex {
  title: string;
  pluginApiVersion: string;
  extensionPoints: typeof EXTENSION_POINTS;
  specs: { openapiPaths: number; asyncapiChannels: number };
  authoringSteps: string[];
  kpi: { timeToFirstPluginTargetDays: number };
  marketplace: { status: "internal-registry" | "public"; note: string };
}

/** Build the portal landing payload. */
export function buildPortalIndex(): PortalIndex {
  const { openapi, asyncapi } = buildSeedSpecs();
  return {
    title: "SYNAPSE Developer Portal",
    pluginApiVersion: PLUGIN_API_VERSION,
    extensionPoints: EXTENSION_POINTS,
    specs: {
      openapiPaths: Object.keys((openapi.paths as object) ?? {}).length,
      asyncapiChannels: Object.keys((asyncapi.channels as object) ?? {}).length,
    },
    authoringSteps: [
      "1. `synapse plugin new` → chọn extension point → sinh manifest scaffold + configSchema",
      "2. Cài đặt logic (connector: Discover/Configure/Validate/Run/Drain) theo Connector SDK",
      "3. Chạy conformance suite local (mọi mục trong checklist phải xanh)",
      "4. Ký Ed25519 + đính SBOM → nộp vào registry (R4: marketplace công khai)",
    ],
    kpi: { timeToFirstPluginTargetDays: 1 },
    marketplace: { status: "internal-registry", note: "R4 mở marketplace công khai cho plugin bên thứ ba đã chứng nhận." },
  };
}

export interface SandboxResult {
  ok: boolean;
  errors: string[];
  hasConfigForm: boolean;
  conformance: string[];
}

/**
 * Sandbox check for a submitted manifest: validate against the contract + apiVersion gate, note
 * whether it ships an auto-form config schema, and return the conformance checklist to pass.
 */
export function sandboxCheck(manifest: Partial<PluginManifest>): SandboxResult {
  const v = validateManifest(manifest, { requireSignature: false });
  return {
    ok: v.ok,
    errors: v.errors,
    hasConfigForm: !!manifest.configSchema,
    conformance: manifest.kind ? conformanceChecklist(manifest.kind) : [],
  };
}

export { newPluginManifest, conformanceChecklist };
