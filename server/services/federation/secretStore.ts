/**
 * Federation per-site secret store (doc 13 §6).
 *
 * Site read tokens are NEVER persisted raw in the `sites` table — only a
 * reference (`authTokenRef`) is stored. The actual secret is resolved here from
 * the environment, mirroring the MASTER_API_KEY pattern:
 *
 *     SITE_TOKEN_<CODE>   (CODE = sites.code, upper-cased, non-alphanumerics → "_")
 *
 * This keeps secrets out of the DB (a dump leaks nothing) and lets each site's
 * token be rotated/revoked independently via env/secret-manager. Upgrading to a
 * real KMS/Vault later is a swap of this single module.
 */

/** Canonical env-var name that holds the read token for a given site code. */
export function siteTokenEnvVar(code: string): string {
  const sanitized = String(code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  return `SITE_TOKEN_${sanitized}`;
}

/**
 * Resolve the read token for a site from the environment.
 *
 * For a local self-enrolled site (isLocal=true) the deployment's own
 * MASTER_API_KEY is used as a fallback so probe works on a single deployment
 * without extra config. Returns undefined when no secret is configured.
 */
export function resolveSiteToken(
  code: string,
  opts?: { isLocal?: boolean },
): string | undefined {
  const direct = process.env[siteTokenEnvVar(code)];
  if (direct && direct.trim()) return direct.trim();

  if (opts?.isLocal) {
    const master = (process.env.MASTER_API_KEY ?? "").trim();
    if (master) return master;
  }
  return undefined;
}

/** True when a (non-empty) read token is configured for this site. */
export function hasSiteToken(code: string, opts?: { isLocal?: boolean }): boolean {
  return !!resolveSiteToken(code, opts);
}
