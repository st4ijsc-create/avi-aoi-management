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
};
