import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import * as db from "../db";
import { establishSession, LoginError, verifyCredentials } from "./authService";
import { getSessionCookieOptions } from "./cookies";
import {
  getConfiguredProvider,
  listEnabledSsoMethods,
  type ConfiguredOAuthProvider,
  type ExternalOAuthProvider,
  type OAuthUserProfile,
} from "./oauthProviders";
import { registerSamlRoutes } from "./samlProvider";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

type OAuthStateEntry = {
  provider: ExternalOAuthProvider;
  redirectPath: string;
  expiresAt: number;
};

type ExternalTokenResponse = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
};

const STATE_TTL_MS = 5 * 60 * 1000;
const oauthStateStore = new Map<string, OAuthStateEntry>();
const externalProviderSet = new Set<ExternalOAuthProvider>([
  "google",
  "microsoft",
  "github",
]);

const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [key, entry] of oauthStateStore.entries()) {
    if (entry.expiresAt <= now) {
      oauthStateStore.delete(key);
    }
  }
};

const scheduleCleanup = () => {
  const interval = setInterval(cleanupExpiredStates, STATE_TTL_MS);
  if (typeof interval.unref === "function") {
    interval.unref();
  }
};

scheduleCleanup();

const createStateEntry = (
  provider: ExternalOAuthProvider,
  redirectPath: string
) => {
  cleanupExpiredStates();
  const state = crypto.randomBytes(32).toString("hex");
  oauthStateStore.set(state, {
    provider,
    redirectPath,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  return state;
};

const consumeStateEntry = (
  state: string,
  provider: ExternalOAuthProvider
) => {
  const entry = oauthStateStore.get(state);
  if (!entry || entry.provider !== provider || entry.expiresAt < Date.now()) {
    throw new Error("Invalid OAuth state");
  }
  oauthStateStore.delete(state);
  return entry.redirectPath;
};

const isExternalProvider = (value: string): value is ExternalOAuthProvider =>
  externalProviderSet.has(value as ExternalOAuthProvider);

const buildBaseUrl = (req: Request) => `${req.protocol}://${req.get("host")}`;

const normalizeRedirectPath = (redirectParam?: string | null) => {
  if (!redirectParam || typeof redirectParam !== "string") return "/";
  return redirectParam.startsWith("/") ? redirectParam : "/";
};

async function exchangeCodeForProvider(
  providerId: ExternalOAuthProvider,
  config: ConfiguredOAuthProvider,
  code: string,
  redirectUri: string
): Promise<ExternalTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  if (providerId !== "github") {
    params.set("grant_type", "authorization_code");
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `[OAuth] Token exchange failed for ${providerId}: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  return (await response.json()) as ExternalTokenResponse;
}

async function fetchUserProfileFromProvider(
  providerId: ExternalOAuthProvider,
  config: ConfiguredOAuthProvider,
  accessToken: string
): Promise<OAuthUserProfile> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  const fetchJson = async (url: string) => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `[OAuth] Failed to fetch profile from ${providerId}: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }
    return response.json() as Promise<Record<string, any>>;
  };

  if (providerId === "github") {
    headers["User-Agent"] = "synapse-platform";
    const profile = await fetchJson(config.userInfoUrl!);
    let email = profile.email ?? null;

    if (!email) {
      const emailResponse = await fetchJson("https://api.github.com/user/emails");
      const emails = Array.isArray(emailResponse) ? emailResponse : [];
      const primary =
        emails.find((item: any) => item.primary && item.verified) ??
        emails.find((item: any) => item.primary) ??
        emails[0];
      email = primary?.email ?? null;
    }

    if (!profile.id) {
      throw new Error("GitHub profile is missing id");
    }

    return {
      id: String(profile.id),
      name: profile.name ?? profile.login ?? null,
      email,
      avatarUrl: profile.avatar_url ?? null,
    };
  }

  if (!config.userInfoUrl) {
    throw new Error(`Provider ${providerId} does not define a userInfoUrl`);
  }

  const profile = await fetchJson(config.userInfoUrl);

  if (providerId === "google") {
    const id = profile.sub ?? profile.id;
    if (!id) throw new Error("Google profile missing sub");
    const derivedName = `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim();
    return {
      id: String(id),
      name: profile.name ?? (derivedName || null),
      email: profile.email ?? null,
      avatarUrl: profile.picture ?? null,
    };
  }

  // Microsoft
  const id = profile.sub ?? profile.oid ?? profile.id;
  if (!id) throw new Error("Microsoft profile missing sub");
  const email = profile.email ?? profile.preferred_username ?? profile.unique_name ?? null;
  return {
    id: String(id),
    name: profile.name ?? profile.given_name ?? null,
    email,
  };
}

export function registerOAuthRoutes(app: Express) {
  // doc 44 W6-4 (G5.19) — SAML SP routes (metadata + login + ACS) alongside OAuth.
  // All 404 when SAML is disabled → zero surface by default. Never touches OAuth.
  registerSamlRoutes(app);

  app.get("/api/oauth/providers", (_req: Request, res: Response) => {
    res.json(listEnabledSsoMethods());
  });

  app.get("/api/oauth/:provider/login", (req: Request, res: Response) => {
    const providerParam = req.params.provider;
    if (!isExternalProvider(providerParam)) {
      res.status(404).json({ error: "Unsupported OAuth provider" });
      return;
    }

    const config = getConfiguredProvider(providerParam);
    if (!config) {
      res.status(400).json({ error: `${providerParam} OAuth is not configured` });
      return;
    }

    const redirectPath = normalizeRedirectPath(getQueryParam(req, "redirect"));
    const callbackUrl = `${buildBaseUrl(req)}/api/oauth/${providerParam}/callback`;
    const state = createStateEntry(providerParam, redirectPath);

    const authorizeUrl = new URL(config.authorizeUrl);
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", config.scope.join(" "));
    authorizeUrl.searchParams.set("state", state);
    Object.entries(config.extraAuthParams ?? {}).forEach(([key, value]) => {
      authorizeUrl.searchParams.set(key, value);
    });

    res.redirect(authorizeUrl.toString());
  });

  app.get("/api/oauth/:provider/callback", async (req: Request, res: Response) => {
    const providerParam = req.params.provider;
    if (!isExternalProvider(providerParam)) {
      res.status(404).json({ error: "Unsupported OAuth provider" });
      return;
    }

    const config = getConfiguredProvider(providerParam);
    if (!config) {
      res.status(400).json({ error: `${providerParam} OAuth is not configured` });
      return;
    }

    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    let redirectPath = "/";
    try {
      redirectPath = consumeStateEntry(state, providerParam);
    } catch (error) {
      console.error(`[OAuth] Invalid state for ${providerParam}`, error);
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    try {
      const callbackUrl = `${buildBaseUrl(req)}/api/oauth/${providerParam}/callback`;
      const tokenResponse = await exchangeCodeForProvider(providerParam, config, code, callbackUrl);

      if (!tokenResponse.access_token) {
        throw new Error("Access token missing in response");
      }

      const profile = await fetchUserProfileFromProvider(
        providerParam,
        config,
        tokenResponse.access_token
      );
      const openId = `${providerParam}:${profile.id}`;
      const displayName = profile.name || profile.email || config.name;

      await db.upsertUser({
        openId,
        name: displayName ?? null,
        email: profile.email ?? null,
        loginMethod: providerParam,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: displayName ?? "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, redirectPath || "/");
    } catch (error) {
      console.error(`[OAuth] ${providerParam} callback failed`, error);
      res.status(500).json({ error: `${config.name} OAuth callback failed` });
    }
  });

  // Local login route.
  // NOTE: the React UI logs in via tRPC `auth.login` (not this route). This
  // Express endpoint is kept for non-tRPC clients and now delegates to the SAME
  // shared auth service (verifyCredentials + establishSession) so brute-force
  // lockout and login audit logging behave identically everywhere — no more
  // divergent duplicate copies of the security logic (audit A bug #1).
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({ error: "Tên đăng nhập và mật khẩu là bắt buộc" });
        return;
      }

      let user;
      try {
        user = await verifyCredentials(username, password, req);
      } catch (err) {
        if (err instanceof LoginError) {
          const httpStatus: Record<LoginError["code"], number> = {
            INVALID_CREDENTIALS: 401,
            ACCOUNT_DISABLED: 403,
            PASSWORD_UNSUPPORTED: 400,
            ACCOUNT_LOCKED: 429,
          };
          res.status(httpStatus[err.code]).json({ error: err.message, ...(err.meta ?? {}) });
          return;
        }
        throw err;
      }

      // Check if 2FA is enabled — defer session until the 2FA step.
      const twoFAStatus = await db.get2FAStatus(user.id);
      if (twoFAStatus?.twoFactorEnabled) {
        res.json({
          requires2FA: true,
          userId: user.id,
          message: "Vui lòng nhập mã xác thực 2 bước"
        });
        return;
      }

      await establishSession(user, req, res, { method: "password" });

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      });
    } catch (error) {
      console.error("[Auth] Local login failed", error);
      res.status(500).json({ error: "Đăng nhập thất bại" });
    }
  });

  // 2FA verification route for login
  app.post("/api/auth/verify-2fa", async (req: Request, res: Response) => {
    try {
      const { userId, token } = req.body;
      
      if (!userId || !token) {
        res.status(400).json({ error: "User ID và mã xác thực là bắt buộc" });
        return;
      }
      
      // Get user
      const user = await db.getUserById(userId);
      if (!user) {
        res.status(404).json({ error: "Không tìm thấy người dùng" });
        return;
      }
      
      // Get 2FA status
      const twoFAStatus = await db.get2FAStatus(userId);
      if (!twoFAStatus?.twoFactorEnabled || !twoFAStatus.twoFactorSecret) {
        res.status(400).json({ error: "2FA chưa được bật cho tài khoản này" });
        return;
      }
      
      // Verify OTP token — và TIÊU MÃ (★★★ Pha 6 Task 6, chống phát lại).
      // ⚠ Đây là cửa vào **REST**, không qua tRPC: một mã trộm được tiêu lại ở đây đổi thẳng ra
      //   MỘT PHIÊN ĐĂNG NHẬP (`establishSession` bên dưới). Nó phải đứng trên cùng cuốn sổ với
      //   đường step-up, nếu không thì bịt một cửa và để mở cửa kia.
      const { verifyTotpOnce } = await import('./totpOnce');
      const verified = verifyTotpOnce({
        userId: user.id,
        secret: twoFAStatus.twoFactorSecret,
        token: token,
      }).hopLe;
      
      if (!verified) {
        // Try backup code if TOTP fails
        const isBackupCode = await db.verifyBackupCode(userId, token);
        if (!isBackupCode) {
          await db.createAuditLog({ userId: user.id, userName: user.name, action: 'login_2fa', entityType: 'auth', status: 'failure', ipAddress: req.ip ?? req.socket.remoteAddress, userAgent: req.headers['user-agent'] }).catch(() => {});
          res.status(401).json({ error: "Mã xác thực không hợp lệ" });
          return;
        }
      }
      
      // 2FA passed → create session (cookie + user_sessions row) and audit the
      // successful login via the shared service.
      await establishSession(user, req, res, { method: "2fa" });

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      });
    } catch (error) {
      console.error("[Auth] 2FA verification failed", error);
      res.status(500).json({ error: "Xác thực 2FA thất bại" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
