import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import bcrypt from "bcryptjs";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // Local login route
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        res.status(400).json({ error: "Tên đăng nhập và mật khẩu là bắt buộc" });
        return;
      }
      
      // Find user by username
      const user = await db.getUserByUsername(username);
      if (!user) {
        res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng" });
        return;
      }
      
      // Check if user is active
      if (!user.isActive) {
        res.status(403).json({ error: "Tài khoản đã bị vô hiệu hóa" });
        return;
      }
      
      // Check if user has password (local account)
      if (!user.passwordHash) {
        res.status(400).json({ error: "Tài khoản này không hỗ trợ đăng nhập bằng mật khẩu" });
        return;
      }
      
      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng" });
        return;
      }
      
      // Check if 2FA is enabled
      const twoFAStatus = await db.get2FAStatus(user.id);
      if (twoFAStatus?.twoFactorEnabled) {
        // Return requires2FA flag instead of logging in
        res.json({ 
          requires2FA: true,
          userId: user.id,
          message: "Vui lòng nhập mã xác thực 2 bước"
        });
        return;
      }
      
      // Update last signed in
      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });
      
      // Create session token
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      
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
      
      // Verify OTP token using speakeasy
      const speakeasy = await import('speakeasy');
      const verified = speakeasy.default.totp.verify({
        secret: twoFAStatus.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 1, // Allow 1 step before/after for clock drift
      });
      
      if (!verified) {
        // Try backup code if TOTP fails
        const isBackupCode = await db.verifyBackupCode(userId, token);
        if (!isBackupCode) {
          res.status(401).json({ error: "Mã xác thực không hợp lệ" });
          return;
        }
      }
      
      // Update last signed in
      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });
      
      // Create session token
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      
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
