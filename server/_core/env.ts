const clean = (value?: string) => (value ? value.trim() : "");

export const ENV = {
  appId: clean(process.env.VITE_APP_ID),
  cookieSecret: clean(process.env.JWT_SECRET),
  databaseUrl: clean(process.env.DATABASE_URL),
  oAuthServerUrl: clean(process.env.OAUTH_SERVER_URL),
  oAuthPortalUrl: clean(process.env.VITE_OAUTH_PORTAL_URL),
  ownerOpenId: clean(process.env.OWNER_OPEN_ID),
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: clean(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: clean(process.env.BUILT_IN_FORGE_API_KEY),
  googleClientId: clean(process.env.GOOGLE_CLIENT_ID),
  googleClientSecret: clean(process.env.GOOGLE_CLIENT_SECRET),
  microsoftClientId: clean(process.env.MICROSOFT_CLIENT_ID),
  microsoftClientSecret: clean(process.env.MICROSOFT_CLIENT_SECRET),
  githubClientId: clean(process.env.GITHUB_CLIENT_ID),
  githubClientSecret: clean(process.env.GITHUB_CLIENT_SECRET),
  // License Management
  licenseServerUrl: clean(process.env.LICENSE_SERVER_URL),
  licenseProductCode: clean(process.env.LICENSE_PRODUCT_CODE),
  licenseEncryptionSecret: clean(process.env.LICENSE_ENCRYPTION_SECRET),
  licenseFilePath: clean(process.env.LICENSE_FILE_PATH),
  /** Set LICENSE_BYPASS=true in .env to skip all license checks (offline deployment) */
  licenseBypass: process.env.LICENSE_BYPASS === 'true',

  // ── P2 (doc 12) — Unified Telemetry Bus: protocol enable flags ──────────────
  // Honest defaults: every protocol reader is OFF unless explicitly enabled, and
  // an enabled reader with no endpoint/device opens NO stream + fabricates NO data.
  // (Services read process.env directly; these are the canonical, centralized view.)
  otGatewayEnabled: process.env.OT_GATEWAY_ENABLED === "true",
  opcuaGatewayEnabled: process.env.OPCUA_GATEWAY_ENABLED === "true",
  mtconnectEnabled: process.env.MTCONNECT_ENABLED === "true",
  secsGemEnabled: process.env.SECS_GEM_ENABLED === "true",
  sparkplugEnabled: process.env.UNS_SPARKPLUG_ENABLED === "true",
  otIngestToUns: process.env.OT_INGEST_TO_UNS === "true",

  // ── Federation (doc 13 / F1) — core aggregator (pull, read-only) ────────────
  // OFF by default: an enabled-but-misconfigured aggregator never fabricates data.
  // When enabled it polls each enrolled site's /api/external/* on an interval and
  // lands aggregate KPIs in site_kpi_rollup. The core NEVER writes to a site.
  federationAggregatorEnabled: process.env.FEDERATION_AGGREGATOR_ENABLED === "true",
  // Global cron tick (seconds): how often a cycle wakes up to consider sites.
  // A site is only polled when its own pollIntervalSec has elapsed since lastSyncAt.
  federationAggregatorTickSec: (() => {
    const n = Number(process.env.FEDERATION_AGGREGATOR_TICK_SEC);
    return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 60;
  })(),
  // Per-site HTTP timeout (ms) for each /api/external/* GET (AbortController).
  federationFetchTimeoutMs: (() => {
    const n = Number(process.env.FEDERATION_FETCH_TIMEOUT_MS);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 15_000;
  })(),
  // Circuit breaker: open after this many consecutive failures, …
  federationCircuitThreshold: (() => {
    const n = Number(process.env.FEDERATION_CIRCUIT_THRESHOLD);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
  })(),
  // … and keep it open (skip the site) for this cooldown (seconds).
  federationCircuitCooldownSec: (() => {
    const n = Number(process.env.FEDERATION_CIRCUIT_COOLDOWN_SEC);
    return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 600;
  })(),
  // Max sites polled concurrently per cycle (per-site isolation via allSettled).
  federationConcurrency: (() => {
    const n = Number(process.env.FEDERATION_CONCURRENCY);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
  })(),
};
