/**
 * Factory Alert System - Auth Service
 * Service xử lý đăng nhập API server
 * 
 * Login endpoint: POST /api/external/auth/login
 * Body: { username, password } → Nhận { token, user }
 * Sau đó gọi API với header: Authorization: Bearer <token>
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_STORAGE_KEY = '@factory_alert_auth_session';

/** Server user info returned by /api/external/auth/login (doc 27 MB5). */
export interface AuthUser {
  id: number | null;
  name: string | null;
  email?: string | null;
  role: string | null; // 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'viewer' | 'user'
}

export interface AuthSession {
  token: string;
  username: string;
  loginAt: string;
  /** Real identity from the server — absent on sessions saved by older app versions. */
  user?: AuthUser;
}

export interface LoginResult {
  success: boolean;
  message: string;
  session?: AuthSession;
}

export interface ApiTestResult {
  step: string;
  success: boolean;
  status?: number;
  message: string;
  duration: number;
  details?: string;
}

class AuthService {
  private static instance: AuthService;
  private session: AuthSession | null = null;
  private cookies: string = '';

  private constructor() {}

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Load saved session from storage
   */
  async loadSession(): Promise<AuthSession | null> {
    try {
      const saved = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        this.session = JSON.parse(saved);
        return this.session;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Get current session
   */
  getSession(): AuthSession | null {
    return this.session;
  }

  /**
   * Get stored cookies
   */
  getCookies(): string {
    return this.cookies;
  }

  /**
   * Check if we have an active session
   */
  isAuthenticated(): boolean {
    return !!this.session?.token || !!this.cookies;
  }

  /**
   * Build auth headers for API requests
   * Sends both cookie and token for maximum compatibility
   */
  getAuthHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {};

    // Session token from login
    if (this.session?.token) {
      headers['Authorization'] = `Bearer ${this.session.token}`;
    }

    // Cookie from login response
    if (this.cookies) {
      headers['Cookie'] = this.cookies;
    }

    // Master API key – send under both header names so that every
    // endpoint (tRPC uses x-master-key, external APIs use x-api-key)
    // receives the key it expects.
    if (apiKey) {
      headers['x-master-key'] = apiKey;
      headers['x-api-key'] = apiKey;
    }

    return headers;
  }

  /**
   * Login to API server
   * Server external API yêu cầu Master API Key ở header x-api-key cho mọi request
   */
  async login(apiBaseUrl: string, username: string, password: string, apiKey?: string): Promise<LoginResult> {
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/api/external/auth/login`;
    console.log('[Auth] Logging in to:', url, 'as:', username);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
        credentials: 'include',
      });

      clearTimeout(timeoutId);

      // Capture cookies from response
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.cookies = setCookie;
        console.log('[Auth] Got cookies from server');
      }

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = json?.error?.message || json?.message || `HTTP ${response.status}`;
        console.error('[Auth] Login failed:', errorMsg);
        return { success: false, message: errorMsg };
      }

      // Extract token from response
      // Expected format: { token: "...", user: {...} }
      // Also handle tRPC wrapper as fallback: { result: { data: { json: {...} } } }
      const data = json?.result?.data?.json || json?.result?.data || json;
      const token = data?.token || data?.accessToken || data?.sessionToken || '';

      // MB5 (doc 27): capture the REAL identity (id/name/role) from the server —
      // ack/resolve payloads use it instead of the old 'mobile_user' placeholder.
      const rawUser = data?.user;
      const user: AuthUser | undefined = rawUser && typeof rawUser === 'object'
        ? {
            id: typeof rawUser.id === 'number' ? rawUser.id : null,
            name: rawUser.name || null,
            email: rawUser.email || null,
            role: rawUser.role || null,
          }
        : undefined;

      const session: AuthSession = {
        token,
        username,
        loginAt: new Date().toISOString(),
        user,
      };

      this.session = session;

      // Persist session
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session)).catch(() => {});

      console.log('[Auth] Login successful, token:', token ? 'present' : 'none (using cookies)');

      return {
        success: true,
        message: 'Đăng nhập thành công',
        session,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return { success: false, message: 'Hết thời gian kết nối (timeout 15s)' };
      }
      return { success: false, message: error.message || 'Lỗi kết nối' };
    }
  }

  /**
   * MB5 (doc 27): human-readable actor identity for ack/resolve payloads.
   * Priority: server user name → login username → saved apiUsername → null.
   * NEVER returns the old 'mobile_user' placeholder.
   */
  getActorName(): string | null {
    if (this.session?.user?.name) return this.session.user.name;
    if (this.session?.username) return this.session.username;
    try {
      // Lazy require avoids a static store↔service import cycle
      const { useSettingsStore } = require('../store/settingsStore');
      const apiUsername = useSettingsStore.getState().settings.app.apiUsername;
      if (apiUsername) return apiUsername;
    } catch {
      // store unavailable (tests) — fall through
    }
    return null;
  }

  /** Role from the current session, or null when unknown (master-key-only mode). */
  getRole(): string | null {
    return this.session?.user?.role || null;
  }

  /**
   * MB5 client-side role gate — parity with the web UI:
   * the web's mqttAlert.resolve is a protectedProcedure (any authenticated
   * user may ack/resolve, no role check), so the mobile mirrors that and only
   * excludes read-only 'viewer'. Unknown role (master-key mode / legacy
   * session) keeps legacy full access.
   */
  canAcknowledgeAlerts(): boolean {
    const role = this.getRole();
    return role !== 'viewer';
  }

  canResolveAlerts(): boolean {
    const role = this.getRole();
    return role !== 'viewer';
  }

  /**
   * Logout - clear session
   */
  async logout(): Promise<void> {
    this.session = null;
    this.cookies = '';
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY).catch(() => {});
    console.log('[Auth] Logged out');
  }

  /**
   * Test API connection with detailed diagnostics
   */
  async testConnection(apiBaseUrl: string, apiKey?: string): Promise<ApiTestResult[]> {
    const results: ApiTestResult[] = [];
    const baseUrl = apiBaseUrl.replace(/\/+$/, '');

    // Step 1: Basic connectivity
    const step1Start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      // A5/A6: probe the health endpoint — /api/external/auth/me may not exist
      // on the server, so use the reliable /api/external/health reachability probe.
      const response = await fetch(`${baseUrl}/api/external/health`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      results.push({
        step: 'Kết nối mạng',
        success: true,
        status: response.status,
        message: `Server phản hồi (${response.status})`,
        duration: Date.now() - step1Start,
      });
    } catch (error: any) {
      results.push({
        step: 'Kết nối mạng',
        success: false,
        message: error.name === 'AbortError' ? 'Timeout 10s' : error.message,
        duration: Date.now() - step1Start,
      });
      return results; // Can't continue without network
    }

    // Step 2: Test auth.me (check session)
    const step2Start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      Object.assign(headers, this.getAuthHeaders(apiKey));

      const response = await fetch(`${baseUrl}/api/external/health`, {
        method: 'GET',
        headers,
        signal: controller.signal,
        credentials: 'include',
      });
      clearTimeout(timeoutId);

      const json = await response.json().catch(() => null);
      // Support both direct response and tRPC wrapper
      const userData = json?.result?.data?.json || json?.user || json?.data;
      const hasUser = userData && typeof userData === 'object' && (userData?.username || userData?.name || userData?.id);
      const isLoggedIn = response.ok && !!hasUser;

      results.push({
        step: 'Xác thực (auth.me)',
        success: isLoggedIn,
        status: response.status,
        message: isLoggedIn ? `Đã đăng nhập: ${userData?.username || userData?.name || 'OK'}` : 'Chưa đăng nhập',
        duration: Date.now() - step2Start,
        details: JSON.stringify(json).substring(0, 200),
      });
    } catch (error: any) {
      results.push({
        step: 'Xác thực (auth.me)',
        success: false,
        message: error.message,
        duration: Date.now() - step2Start,
      });
    }

    // Step 3: Test hierarchy tree fetch
    const step3Start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      Object.assign(headers, this.getAuthHeaders(apiKey));

      const response = await fetch(`${baseUrl}/api/external/hierarchy/tree`, {
        method: 'GET',
        headers,
        signal: controller.signal,
        credentials: 'include',
      });
      clearTimeout(timeoutId);

      const json = await response.json().catch(() => null);

      if (response.ok) {
        // Support direct array, { data: [...] }, or tRPC wrapper
        const arr = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : json?.result?.data?.json);
        const count = Array.isArray(arr) ? arr.length : 'unknown';
        results.push({
          step: 'Tải cây phân cấp',
          success: true,
          status: response.status,
          message: `Thành công (${count} factory)`,
          duration: Date.now() - step3Start,
        });
      } else {
        const errMsg = json?.error?.message || json?.message || `HTTP ${response.status}`;
        results.push({
          step: 'Tải cây phân cấp',
          success: false,
          status: response.status,
          message: errMsg,
          duration: Date.now() - step3Start,
          details: JSON.stringify(json).substring(0, 200),
        });
      }
    } catch (error: any) {
      results.push({
        step: 'Tải cây phân cấp',
        success: false,
        message: error.message,
        duration: Date.now() - step3Start,
      });
    }

    return results;
  }
}

export const authService = AuthService.getInstance();
export default authService;
