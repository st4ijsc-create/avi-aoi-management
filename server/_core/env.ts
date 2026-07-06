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
  /**
   * Doc 37 P0-3 / Doc 38 Đợt Q — SERVER-SIDE per-module license enforcement (moduleGate).
   * DEFAULT ON (set LICENSE_MODULE_GATE_ENABLED="false" to disable). A tRPC call into a
   * NOT-licensed optional module (MOD_*) is refused with FORBIDDEN. Core modules (CORE_*)
   * and LICENSE_BYPASS are always allowed. NO-BRICK guarantee (see moduleGate.ts): the
   * gate enforces ONLY when the deployment's SKU is explicitly populated (≥1 license row
   * lists allowed_modules); a system that never declared its modules fails OPEN, so
   * flipping this on can never lock out an unconfigured deployment.
   */
  licenseModuleGate: process.env.LICENSE_MODULE_GATE_ENABLED !== 'false',

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

  // ── Federation (doc 13 / F3) — UNS subscribe-only streaming ─────────────────
  // OFF by default. When enabled, the core opens a SUBSCRIBE-ONLY MQTT connection
  // to each enrolled site that has unsBrokerUrl, listens on normalized Sparkplug
  // DDATA/DBIRTH topics, and lands near-real-time KPIs in site_kpi_rollup with
  // source='uns' (complementing F1's pull path). The core NEVER publishes to a
  // site broker — there is no command/control direction. Safe no-op when OFF or
  // when no site has a broker URL; never blocks boot, never fabricates data.
  federationUnsEnabled: process.env.FEDERATION_UNS_ENABLED === "true",
  // MQTT reconnect period (ms) for each per-site subscribe connection.
  federationUnsReconnectMs: (() => {
    const n = Number(process.env.FEDERATION_UNS_RECONNECT_MS);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 5_000;
  })(),
  // MQTT connect timeout (ms) for each per-site subscribe connection.
  federationUnsConnectTimeoutMs: (() => {
    const n = Number(process.env.FEDERATION_UNS_CONNECT_TIMEOUT_MS);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 30_000;
  })(),
  // Sparkplug topic namespace the core subscribes under (must match sites' UNS).
  federationUnsNamespace: clean(process.env.FEDERATION_UNS_NAMESPACE) || "spBv1.0",
};
