/**
 * Product-code identity & DUAL-ACCEPT (REBRAND R-2, doc 44 §11).
 *
 * The platform was rebranded AVI-AOI Management → SYNAPSE Platform. Licenses already
 * issued in the field carry the OLD product codes, so validation must accept BOTH
 * families during the grace period:
 *   - NEW  : SYNAPSE-PLATFORM (canonical), SYNAPSE-PROD (.env example convention)
 *   - LEGACY: AVI-AOI-MANAGEMENT, AOI-MANAGEMENT, AVI-AOI-PROD (+ their lowercase
 *     variants — comparison is case-insensitive; the field .env used lowercase)
 *
 * The NEW code is the default for everything we ISSUE/GENERATE from now on
 * (SDK client, offline activation requests, module export). LICENSE_PRODUCT_CODE
 * in .env always wins when set.
 *
 * Wire/DB identifiers (MQTT topics `avi/...`, DB names, EMQX cookie) are explicitly
 * OUT of scope here (kept until W7 per decision D3/D4).
 */

import { ENV } from '../_core/env';

/** Canonical product code after the SYNAPSE rebrand. Default for NEW issuance. */
export const CURRENT_PRODUCT_CODE = 'SYNAPSE-PLATFORM';

/** New-family codes (accepted alongside the canonical one). */
export const SYNAPSE_PRODUCT_CODES: readonly string[] = [
  'SYNAPSE-PLATFORM',
  'SYNAPSE-PROD',
];

/**
 * Legacy product codes still accepted (dual-accept) — licenses issued before the
 * rebrand MUST NOT die. Remove only in W7 after all field licenses are re-issued.
 */
export const LEGACY_PRODUCT_CODES: readonly string[] = [
  'AVI-AOI-MANAGEMENT', // historic default in licenseRouter + client UI (lowercase in field .env)
  'AOI-MANAGEMENT',     // historic fallback default in license-service
  'AVI-AOI-PROD',       // historic .env.example value
];

const norm = (code: string | null | undefined): string => (code ?? '').trim().toUpperCase();

/**
 * Default product code used when GENERATING/ISSUING anything new
 * (SDK client identity, offline activation request, module export).
 * LICENSE_PRODUCT_CODE from .env always wins; otherwise the NEW canonical code.
 */
export function getDefaultProductCode(): string {
  return ENV.licenseProductCode || CURRENT_PRODUCT_CODE;
}

/**
 * The full accepted family (normalized upper-case): configured env code +
 * new SYNAPSE codes + legacy AVI-AOI codes.
 * `configured` is injectable for tests; defaults to the env value.
 */
export function acceptedProductCodes(
  configured: string | undefined = ENV.licenseProductCode,
): ReadonlySet<string> {
  const family = new Set<string>([
    ...SYNAPSE_PRODUCT_CODES.map(norm),
    ...LEGACY_PRODUCT_CODES.map(norm),
  ]);
  const cfg = norm(configured);
  if (cfg) family.add(cfg);
  return family;
}

/** Is this product code accepted (new OR legacy OR the configured one)? Case-insensitive. */
export function isAcceptedProductCode(
  code: string | null | undefined,
  configured?: string,
): boolean {
  const n = norm(code);
  if (!n) return false;
  return acceptedProductCodes(configured).has(n);
}

/**
 * Do two product codes "match" for validation purposes?
 * TRUE when equal (case-insensitive) OR when BOTH belong to the accepted family
 * (so a license stored as AVI-AOI-MANAGEMENT validates against SYNAPSE-PLATFORM
 * input and vice versa). A foreign code on either side never matches.
 */
export function productCodesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
  configured?: string,
): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const family = acceptedProductCodes(configured);
  return family.has(na) && family.has(nb);
}
