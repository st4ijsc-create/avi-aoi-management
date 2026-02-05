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
};
