/**
 * Plugin signature enforcement — SYNAPSE §6.4.4/§6.4.5 (doc 33 F3 · P4).
 *
 * "Plugin không ký không được load ở production." An out-of-process plugin artifact is signed
 * (Ed25519) over its identity + manifest + artifact hash; the Hub verifies before spawning it.
 * Reuses the F4 Ed25519 primitive. Fail-closed in production; a signature-verification failure
 * means the Hub REFUSES to spawn (never runs unsigned/tampered code).
 */
import { verifyLicenseEd25519 } from "../../../license/ed25519License";

export interface SignedPlugin {
  pluginId: string;
  version: string;
  /** sha256 of the plugin artifact (binary/bundle). */
  artifactSha256: string;
  /** Base64 Ed25519 signature over {pluginId, version, artifactSha256}. */
  signature?: string;
}

export interface SignatureVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Verify a plugin's signature against a trusted publisher public key.
 * `requireSignature` (default: production) → an unsigned plugin is REJECTED.
 */
export function verifyPluginSignature(
  plugin: SignedPlugin,
  publisherPublicKeyPem: string | null,
  opts: { requireSignature?: boolean } = {},
): SignatureVerdict {
  const requireSignature = opts.requireSignature ?? process.env.NODE_ENV === "production";
  if (!plugin.signature) {
    return requireSignature
      ? { ok: false, reason: "unsigned plugin rejected (production requires a signature)" }
      : { ok: true, reason: "unsigned plugin allowed (non-production)" };
  }
  if (!publisherPublicKeyPem) {
    return { ok: false, reason: "no trusted publisher key to verify against" };
  }
  const claims = {
    pluginId: plugin.pluginId,
    version: plugin.version,
    artifactSha256: plugin.artifactSha256,
  };
  const valid = verifyLicenseEd25519(claims, plugin.signature, publisherPublicKeyPem);
  return valid
    ? { ok: true, reason: "signature valid" }
    : { ok: false, reason: "signature INVALID — refusing to spawn (tampered or wrong key)" };
}
