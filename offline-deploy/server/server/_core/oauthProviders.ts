import { ENV } from "./env";

export type ExternalOAuthProvider = "google" | "microsoft" | "github";

export interface OAuthUserProfile {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface OAuthProviderDefinition {
  id: ExternalOAuthProvider;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string[];
  userInfoUrl?: string;
  extraAuthParams?: Record<string, string>;
}

const providerDefinitions: Record<ExternalOAuthProvider, OAuthProviderDefinition> = {
  google: {
    id: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scope: ["openid", "email", "profile"],
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: ["openid", "profile", "email"],
    extraAuthParams: {
      response_mode: "query",
    },
  },
  github: {
    id: "github",
    name: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scope: ["read:user", "user:email"],
    extraAuthParams: {
      allow_signup: "false",
    },
  },
};

const providerCredentials: Record<ExternalOAuthProvider, { clientId: string; clientSecret: string }> = {
  google: {
    clientId: ENV.googleClientId,
    clientSecret: ENV.googleClientSecret,
  },
  microsoft: {
    clientId: ENV.microsoftClientId,
    clientSecret: ENV.microsoftClientSecret,
  },
  github: {
    clientId: ENV.githubClientId,
    clientSecret: ENV.githubClientSecret,
  },
};

export type ConfiguredOAuthProvider = OAuthProviderDefinition & {
  clientId: string;
  clientSecret: string;
};

export function getConfiguredProvider(
  provider: ExternalOAuthProvider
): ConfiguredOAuthProvider | null {
  const creds = providerCredentials[provider];
  if (!creds?.clientId || !creds?.clientSecret) {
    return null;
  }
  return {
    ...providerDefinitions[provider],
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  };
}

export function listEnabledExternalProviders(): ExternalOAuthProvider[] {
  return (Object.keys(providerDefinitions) as ExternalOAuthProvider[]).filter(
    (key) => {
      const creds = providerCredentials[key];
      return Boolean(creds?.clientId && creds?.clientSecret);
    }
  );
}

export function isManusOAuthEnabled() {
  return Boolean(ENV.oAuthServerUrl && ENV.oAuthPortalUrl);
}