/**
 * LicenseService - Server-side license management service
 * 
 * Tích hợp Official License SDK (@lms/license-sdk) cho:
 *   - Online activation, validation via License Server
 *   - Hardware fingerprint generation (cpuId, macAddress, diskSerial, motherboardSerial)
 *   - Module checking (online + offline cached)
 *   - Floating license management
 *   - Grace period checking
 *   - Periodic validation
 *   - Security features (anti-tampering, replay attack prevention)
 * 
 * Vẫn giữ:
 *   - RSA key pair management (cho local offline generation)
 *   - Local DB storage (licenses, activations, sync logs)
 *   - Offline license file generation (LIC-V2 format)
 *   - Local-only activation fallback
 *   - CRL management
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'node:module';
import * as db from '../db';
import { ENV } from '../_core/env';

// Official License SDK — type-only imports (erased at compile time)
import type {
  ActivationResult as SDKActivationResult,
  ValidationResult as SDKValidationResult,
  ModuleListResult,
  ModuleCheckResult,
  ModuleSyncResult,
  ProductModulesResult,
  FloatingCheckoutResult,
  FloatingStatusResult,
  GracePeriodResult,
  ModuleInfo,
  LicenseClient as LicenseClientType,
  HardwareFingerprint as HardwareFingerPrintType,
} from './sdk/index.d.ts';

// Runtime SDK loader — uses createRequire to load CJS at runtime,
// avoiding esbuild's "Dynamic require of X is not supported" in ESM output.
let _sdkModule: any = null;
function loadSDK(): { LicenseClient: typeof LicenseClientType; HardwareFingerprint: typeof HardwareFingerPrintType } {
  if (!_sdkModule) {
    const cjsRequire = createRequire(import.meta.url);
    _sdkModule = cjsRequire('./index.cjs');
  }
  return _sdkModule;
}


// ═══════════════════════════════════════════════════════════════
// SUPERJSON FETCH INTERCEPTOR
// ═══════════════════════════════════════════════════════════════
//
// The SDK sends raw JSON to tRPC endpoints, but the License Server
// uses superjson transformer. superjson expects:
//   - POST body:  {"json": {…actualInput…}}
//   - GET query:  ?input={"json":{…actualInput…}}
//   - Response:   {"result":{"data":{"json":{…actualData…}}}}
//
// This interceptor transparently wraps/unwraps the superjson layer
// so the SDK works correctly with the License Server.
// ═══════════════════════════════════════════════════════════════

let _fetchInterceptorInstalled = false;

function installSuperJsonFetchInterceptor(serverUrl: string): void {
  if (_fetchInterceptorInstalled) return;
  _fetchInterceptorInstalled = true;

  const originalFetch = globalThis.fetch;
  const trpcPrefix = serverUrl.replace(/\/$/, '') + '/api/trpc/';

  globalThis.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Only intercept calls to the License Server's tRPC endpoints
    if (!url.startsWith(trpcPrefix)) {
      return originalFetch(input, init);
    }

    let modifiedInput: RequestInfo | URL = input;
    let modifiedInit = init;

    // ── POST mutations: wrap body in {"json": …} ──
    if (init?.method === 'POST' && init.body && typeof init.body === 'string') {
      try {
        const rawBody = JSON.parse(init.body);
        modifiedInit = { ...init, body: JSON.stringify({ json: rawBody }) };
      } catch {
        // not JSON → pass through
      }
    }

    // ── GET queries: wrap ?input in {"json": …} ──
    if (!init?.method || init.method === 'GET') {
      try {
        const urlObj = new URL(url);
        const inputParam = urlObj.searchParams.get('input');
        if (inputParam) {
          const rawInput = JSON.parse(inputParam);
          urlObj.searchParams.set('input', JSON.stringify({ json: rawInput }));
          modifiedInput = urlObj.toString();
        }
      } catch {
        // not parseable → pass through
      }
    }

    const response = await originalFetch(modifiedInput, modifiedInit);

    // ── Unwrap superjson from response ──
    // Read the body text, transform it, and return a new Response.
    // We MUST NOT use Proxy on Response because Response has private
    // fields (#state) that are inaccessible through a Proxy.
    const bodyText = await response.text();
    let transformedBody = bodyText;

    try {
      const data = JSON.parse(bodyText);
      let changed = false;
      // Unwrap success: result.data.json → result.data
      if (data?.result?.data?.json !== undefined) {
        data.result.data = data.result.data.json;
        changed = true;
      }
      // Unwrap error: error.json → merge into error
      if (data?.error?.json !== undefined) {
        data.error = data.error.json;
        changed = true;
      }
      if (changed) {
        transformedBody = JSON.stringify(data);
      }
    } catch {
      // not JSON → pass through as-is
    }

    return new Response(transformedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } as typeof fetch;

  console.log(`[License] SuperJSON fetch interceptor installed for ${trpcPrefix}`);
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface LicenseFileV2 {
  header: {
    formatVersion: 'LIC-V2';
    licenseKey: string;
    productCode: string;
    customerName: string;
    licenseType: string;
    issuedAt: number;
    expiresAt: number | null;
  };
  payload: string; // encrypted base64
  security: {
    headerSignature: string;
    payloadSignature: string;
    publicKey: string;
    fileChecksum: string;
  };
  offlinePolicy: {
    maxOfflineDays: number;
    gracePeriodDays: number;
    requireHardwareBinding: boolean;
    allowedModules: string[];
  };
}

export interface ActivateInput {
  licenseKey: string;
  productCode: string;
  hardwareFingerprint?: string;
  machineName?: string;
  clientVersion?: string;
  ipAddress?: string;
}

export interface ActivateResult {
  success: boolean;
  error?: string;
  activationCode?: string;
  offlineLicenseBase64?: string;
  moduleCodes: string[];
  modules?: ModuleInfo[];
  expiresAt?: number | null;
  /** From License Server passthrough (not in SDK type) */
  customerName?: string;
  /** From License Server passthrough (not in SDK type) */
  licenseType?: string;
  // Security fields from SDK
  blocked?: boolean;
  securityFlags?: string[];
  securityWarnings?: string[];
  retryAfter?: number;
}

export interface ValidateInput {
  licenseKey: string;
  productCode: string;
  hardwareFingerprint?: string;
}

export interface ValidateResult {
  isValid: boolean;
  error?: string;
  status?: string;
  customerName?: string;
  licenseType?: string;
  expiresAt?: number | null;
  moduleCodes?: string[];
  modules?: ModuleInfo[];
  maxUsers?: number | null;
  // SDK extended fields
  isOfflineMode?: boolean;
  blocked?: boolean;
  securityFlags?: string[];
  securityWarnings?: string[];
}

// Re-export SDK types for consumers
export type {
  ModuleInfo, ModuleListResult, ModuleCheckResult, ModuleSyncResult,
  ProductModulesResult, FloatingCheckoutResult, FloatingStatusResult,
  GracePeriodResult
} from './sdk/index.d.ts';


export interface SyncInput {
  licenseKey: string;
  productCode: string;
  hardwareFingerprint?: string;
  clientVersion?: string;
  lastSyncAt?: number;
  ipAddress?: string;
}

// ═══════════════════════════════════════════════════════════════
// LICENSE STATE CACHE (disk-based resilience)
// ═══════════════════════════════════════════════════════════════

export interface LicenseStateCache {
  /** Guard state at time of caching */
  state: string;
  /** License key */
  licenseKey: string | null;
  /** Customer name */
  customerName: string | null;
  /** License type */
  licenseType: string | null;
  /** Expiry epoch ms */
  expiresAt: number | null;
  /** Allowed module codes (the most critical field) */
  allowedModules: string[];
  /** Timestamp when this cache was written */
  cachedAt: number;
  /** Last successful online check timestamp */
  lastSuccessfulOnlineCheck: number | null;
  /** Human-readable message */
  message: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class LicenseService {
  private privateKey: string | null = null;
  private publicKey: string | null = null;
  private keyDir: string;
  private encryptionSecret: string;
  private sdkClient: InstanceType<typeof LicenseClientType> | null = null;

  /** Path to the disk-based license state cache */
  private stateCachePath: string;

  constructor() {
    this.keyDir = path.join(process.cwd(), 'server', 'license', 'keys');
    this.encryptionSecret = process.env.LICENSE_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'default-license-secret';
    this.stateCachePath = path.join(process.cwd(), 'server', 'license', 'license-state-cache.json');
  }

  // ─── License State Cache (disk-based) ──────────────────────

  /**
   * Save license state to disk for resilience across restarts.
   * Called after every successful license check.
   */
  saveLicenseStateCache(cache: LicenseStateCache): void {
    try {
      fs.writeFileSync(this.stateCachePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err: any) {
      console.warn(`[License] Failed to save state cache: ${err.message}`);
    }
  }

  /**
   * Load last-known-good license state from disk.
   * Used on startup when online + offline validation both fail.
   */
  loadLicenseStateCache(): LicenseStateCache | null {
    try {
      if (!fs.existsSync(this.stateCachePath)) return null;
      const raw = fs.readFileSync(this.stateCachePath, 'utf8');
      const cache: LicenseStateCache = JSON.parse(raw);
      // Basic validation
      if (!cache.cachedAt || !Array.isArray(cache.allowedModules)) return null;
      console.log(`[License] Loaded state cache from disk (cached at ${new Date(cache.cachedAt).toLocaleString()})`);
      return cache;
    } catch (err: any) {
      console.warn(`[License] Failed to load state cache: ${err.message}`);
      return null;
    }
  }

  // ─── SDK Client ────────────────────────────────────────────

  /**
   * Get or create the SDK LicenseClient instance (singleton)
   */
  getSDKClient(): InstanceType<typeof LicenseClientType> {
    if (!this.sdkClient) {
      const serverUrl = ENV.licenseServerUrl;
      if (!serverUrl) {
        throw new Error('LICENSE_SERVER_URL not configured — cannot create SDK client');
      }

      // Install fetch interceptor to bridge SDK's raw JSON ↔ License Server's superjson
      installSuperJsonFetchInterceptor(serverUrl);

      const { LicenseClient } = loadSDK();
      this.sdkClient = new LicenseClient({
        serverUrl,
        productCode: ENV.licenseProductCode || 'AOI-MANAGEMENT',
        timeout: 30000,
        enableSecurityFeatures: true,
      });
    }
    return this.sdkClient;
  }

  /**
   * Check if SDK client can be created (server URL configured)
   */
  hasSDKClient(): boolean {
    return !!ENV.licenseServerUrl;
  }

  // ─── Key Management ────────────────────────────────────────

  /**
   * Initialize RSA key pair - generate if not exists
   */
  async initializeKeys(): Promise<void> {
    const privateKeyPath = path.join(this.keyDir, 'private.pem');
    const publicKeyPath = path.join(this.keyDir, 'public.pem');

    // Create directory if not exists
    if (!fs.existsSync(this.keyDir)) {
      fs.mkdirSync(this.keyDir, { recursive: true });
    }

    if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
      this.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      console.log('[License] RSA key pair loaded');
    } else {
      console.log('[License] Generating new RSA-2048 key pair...');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      fs.writeFileSync(privateKeyPath, privateKey, 'utf8');
      fs.writeFileSync(publicKeyPath, publicKey, 'utf8');

      this.privateKey = privateKey;
      this.publicKey = publicKey;
      console.log('[License] RSA key pair generated and saved');
    }

    // Initialize SDK client if server URL is configured
    if (this.hasSDKClient()) {
      try {
        const client = this.getSDKClient();
        console.log(`[License] SDK client initialized (server: ${ENV.licenseServerUrl})`);
      } catch (err: any) {
        console.warn(`[License] SDK client init failed: ${err.message}`);
      }
    }
  }

  getPublicKey(): string {
    if (!this.publicKey) {
      throw new Error('License keys not initialized. Call initializeKeys() first.');
    }
    return this.publicKey;
  }

  // ─── Activate ──────────────────────────────────────────────

  /**
   * Activate a license - tries SDK online first, falls back to local DB
   */
  async activate(input: ActivateInput): Promise<ActivateResult> {
    // Try online activation via SDK if License Server URL is configured
    if (this.hasSDKClient()) {
      try {
        console.log(`[License] Activating online via SDK (${ENV.licenseServerUrl})...`);
        const onlineResult = await this._activateWithSDK(input);
        return onlineResult;
      } catch (err: any) {
        console.error(`[License] SDK activation failed:`, err.message);
        // Fall through to local activation for network errors
        const localResult = await this._activateLocal(input);
        if (!localResult.success) {
          return {
            success: false,
            error: `Không kết nối được License Server (${ENV.licenseServerUrl}): ${err.message}. Local DB: ${localResult.error}`,
            moduleCodes: [],
          };
        }
        return localResult;
      }
    }

    // No server configured → local only
    return this._activateLocal(input);
  }

  // ─── Online Activation via SDK ──────────────────────────────

  /**
   * Activate via SDK LicenseClient
   * SDK handles: tRPC call, hardware fingerprint, superjson serialization
   */
  private async _activateWithSDK(input: ActivateInput): Promise<ActivateResult> {
    const client = this.getSDKClient();

    // SDK handles hardware fingerprint internally via HardwareFingerprint.generate()
    const sdkResult: SDKActivationResult = await client.activate({
      licenseKey: input.licenseKey,
      machineName: input.machineName || os.hostname(),
    });

    if (!sdkResult.success) {
      return {
        success: false,
        error: sdkResult.error || 'Kích hoạt thất bại',
        moduleCodes: [],
        blocked: sdkResult.blocked,
        securityFlags: sdkResult.securityFlags,
        securityWarnings: sdkResult.securityWarnings,
        retryAfter: sdkResult.retryAfter,
      };
    }

    // Get hardware fingerprint for local storage
    let fingerprint = input.hardwareFingerprint;
    if (!fingerprint) {
      try {
        const { HardwareFingerprint } = loadSDK();
        const fp = await HardwareFingerprint.generate();
        fingerprint = fp.hash;
      } catch {
        fingerprint = this._getFallbackFingerprint();
      }
    }

    // Store license data in local DB
    // Note: customerName/licenseType are NOT in SDK's ActivationResult type,
    // but the License Server may pass them through at runtime.
    const extra = sdkResult as any;
    await this._storeLicenseLocally(input, {
      ...sdkResult,
      customerName: extra.customerName || 'Unknown',
      moduleCodes: sdkResult.moduleCodes || [],
    }, fingerprint);

    console.log(`[License] SDK activation successful for key: ${input.licenseKey}`);

    return {
      success: true,
      activationCode: sdkResult.activationCode,
      offlineLicenseBase64: sdkResult.offlineLicenseBase64,
      moduleCodes: sdkResult.moduleCodes || [],
      modules: sdkResult.modules,
      expiresAt: sdkResult.expiresAt,
      customerName: extra.customerName,
      licenseType: extra.licenseType,
      blocked: sdkResult.blocked,
      securityFlags: sdkResult.securityFlags,
      securityWarnings: sdkResult.securityWarnings,
    };
  }

  /**
   * Store license data from License Server into local DB & file
   */
  private async _storeLicenseLocally(
    input: ActivateInput,
    serverResult: any,
    fingerprint: string,
  ): Promise<void> {
    // Upsert license in local DB
    const existing = await db.getLicenseByKey(input.licenseKey);
    let licenseId: number;

    if (!existing) {
      const created = await db.createLicense({
        licenseKey: input.licenseKey,
        productCode: input.productCode,
        customerName: serverResult.customerName || 'Unknown',
        customerEmail: serverResult.customerEmail || null,
        companyName: serverResult.companyName || null,
        licenseType: serverResult.licenseType || 'standard',
        status: 'active',
        allowedModules: serverResult.moduleCodes || [],
        expiresAt: serverResult.expiresAt ? new Date(serverResult.expiresAt) : null,
        maxActivations: serverResult.maxActivations || 5,
        currentActivations: 1,
        lastActivatedAt: new Date(),
      });
      licenseId = created.id;
    } else {
      await db.updateLicenseByKey(input.licenseKey, {
        status: 'active',
        allowedModules: serverResult.moduleCodes || [],
        expiresAt: serverResult.expiresAt ? new Date(serverResult.expiresAt) : null,
        lastActivatedAt: new Date(),
        customerName: serverResult.customerName || existing.customerName,
        licenseType: serverResult.licenseType || existing.licenseType,
      });
      licenseId = existing.id;
    }

    // Save offline license file if provided
    if (serverResult.offlineLicenseBase64) {
      try {
        const licensePath = ENV.licenseFilePath || path.join(process.cwd(), 'license.lic');
        const content = Buffer.from(serverResult.offlineLicenseBase64, 'base64').toString('utf8');
        fs.writeFileSync(licensePath, content, 'utf8');
        console.log(`[License] Offline license file saved to ${licensePath}`);
      } catch (err: any) {
        console.warn(`[License] Failed to save offline license file: ${err.message}`);
      }

      // Also save raw base64 for offline fallback when server goes down
      try {
        const rawPath = (ENV.licenseFilePath || path.join(process.cwd(), 'license.lic')) + '.b64';
        fs.writeFileSync(rawPath, serverResult.offlineLicenseBase64, 'utf8');
        console.log(`[License] Offline license base64 saved to ${rawPath}`);
      } catch (err: any) {
        console.warn(`[License] Failed to save offline license base64: ${err.message}`);
      }
    }

    // Create/update activation record
    if (fingerprint) {
      const activationExists = await db.getActivationByFingerprint(input.licenseKey, fingerprint);
      if (!activationExists) {
        await db.createLicenseActivation({
          licenseId,
          licenseKey: input.licenseKey,
          machineName: input.machineName || null,
          hardwareFingerprint: fingerprint,
          ipAddress: input.ipAddress || null,
          clientVersion: input.clientVersion || null,
          osInfo: `${os.platform()} ${os.release()}`,
          isActive: true,
        });
      } else {
        await db.updateActivationLastSeen(activationExists.id);
      }
    }

    // Log sync
    await db.createSyncLog({
      licenseId,
      licenseKey: input.licenseKey,
      hardwareFingerprint: fingerprint || null,
      syncType: 'activate',
      syncResult: 'success',
      clientVersion: input.clientVersion || null,
      ipAddress: input.ipAddress || null,
    });
  }

  // ─── Local Activation (Offline Fallback) ───────────────────

  /**
   * Activate from local DB only (when License Server is unreachable)
   */
  private async _activateLocal(input: ActivateInput): Promise<ActivateResult> {
    // 1. Find license
    const license = await db.getLicenseByKey(input.licenseKey);
    if (!license) {
      return { success: false, error: 'License key không tồn tại', moduleCodes: [] };
    }

    // 2. Check product code
    if (license.productCode !== input.productCode) {
      return { success: false, error: 'Product code không khớp', moduleCodes: [] };
    }

    // 3. Check status
    if (license.status === 'revoked') {
      return { success: false, error: 'License đã bị thu hồi', moduleCodes: [] };
    }
    if (license.status === 'expired') {
      return { success: false, error: 'License đã hết hạn', moduleCodes: [] };
    }
    if (license.status === 'suspended') {
      return { success: false, error: 'License đang bị tạm ngưng', moduleCodes: [] };
    }

    // 4. Check expiry
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await db.updateLicenseByKey(input.licenseKey, { status: 'expired' });
      return { success: false, error: 'License đã hết hạn', moduleCodes: [] };
    }

    // 5. Check activation limit
    if (input.hardwareFingerprint) {
      const existing = await db.getActivationByFingerprint(input.licenseKey, input.hardwareFingerprint);
      if (existing && existing.isActive) {
        // Already activated on this machine → update & re-generate file
        await db.updateActivationLastSeen(existing.id);
      } else if (!existing) {
        // New activation
        const activeCount = await db.getActiveActivationCount(input.licenseKey);
        if (activeCount >= license.maxActivations) {
          return {
            success: false,
            error: `Đã đạt giới hạn ${license.maxActivations} thiết bị. Vui lòng deactivate thiết bị khác trước.`,
            moduleCodes: [],
          };
        }
      }
    }

    // 6. Create/update activation record
    if (input.hardwareFingerprint) {
      const existing = await db.getActivationByFingerprint(input.licenseKey, input.hardwareFingerprint);
      if (!existing) {
        await db.createLicenseActivation({
          licenseId: license.id,
          licenseKey: input.licenseKey,
          machineName: input.machineName || null,
          hardwareFingerprint: input.hardwareFingerprint,
          ipAddress: input.ipAddress || null,
          clientVersion: input.clientVersion || null,
          osInfo: `${os.platform()} ${os.release()}`,
          isActive: true,
        });

        // Increment activation count
        await db.updateLicenseByKey(input.licenseKey, {
          currentActivations: license.currentActivations + 1,
          lastActivatedAt: new Date(),
        });
      }
    }

    // 7. Generate offline license file
    const licenseFile = this._generateLicenseFile(license, input.hardwareFingerprint);
    const licenseFileJson = JSON.stringify(licenseFile, null, 2);
    const offlineLicenseBase64 = Buffer.from(licenseFileJson, 'utf8').toString('base64');

    // 8. Log sync
    await db.createSyncLog({
      licenseId: license.id,
      licenseKey: input.licenseKey,
      hardwareFingerprint: input.hardwareFingerprint || null,
      syncType: 'activate',
      syncResult: 'success',
      clientVersion: input.clientVersion || null,
      ipAddress: input.ipAddress || null,
    });

    return {
      success: true,
      offlineLicenseBase64,
      moduleCodes: (license.allowedModules as string[]) || [],
      expiresAt: license.expiresAt ? new Date(license.expiresAt).getTime() : null,
      customerName: license.customerName,
      licenseType: license.licenseType,
    };
  }

  // ─── Validate ──────────────────────────────────────────────

  /**
   * Validate a license online
   */
  async validate(input: ValidateInput): Promise<ValidateResult> {
    const license = await db.getLicenseByKey(input.licenseKey);
    if (!license) {
      return { isValid: false, error: 'License không tồn tại' };
    }

    // Check revocation
    const isRevoked = await db.isLicenseRevoked(input.licenseKey);
    if (isRevoked) {
      return { isValid: false, error: 'License đã bị thu hồi', status: 'revoked' };
    }

    // Check expiry
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await db.updateLicenseByKey(input.licenseKey, { status: 'expired' });
      return { isValid: false, error: 'License đã hết hạn', status: 'expired' };
    }

    // Check status
    if (license.status !== 'active') {
      return { isValid: false, error: `License status: ${license.status}`, status: license.status };
    }

    // Check hardware binding
    if (input.hardwareFingerprint && license.requireHardwareBinding) {
      const activation = await db.getActivationByFingerprint(input.licenseKey, input.hardwareFingerprint);
      if (!activation || !activation.isActive) {
        return { isValid: false, error: 'Thiết bị chưa được kích hoạt', status: 'not_activated' };
      }
      await db.updateActivationLastSeen(activation.id);
    }

    return {
      isValid: true,
      status: 'active',
      customerName: license.customerName,
      licenseType: license.licenseType,
      expiresAt: license.expiresAt ? new Date(license.expiresAt).getTime() : null,
      moduleCodes: (license.allowedModules as string[]) || [],
      maxUsers: license.maxUsers,
    };
  }

  // ─── Sync ──────────────────────────────────────────────────

  /**
   * Sync operation - client heartbeat & CRL update
   */
  async sync(input: SyncInput) {
    const license = await db.getLicenseByKey(input.licenseKey);
    if (!license) {
      return { success: false, error: 'License không tồn tại' };
    }

    // Update activation last seen
    if (input.hardwareFingerprint) {
      const activation = await db.getActivationByFingerprint(input.licenseKey, input.hardwareFingerprint);
      if (activation) {
        await db.updateActivationLastSeen(activation.id);
      }
    }

    // Get CRL
    const revokedKeys = await db.getRevokedKeys();

    // Check if license itself is revoked
    const isRevoked = revokedKeys.includes(input.licenseKey);

    // Generate updated license file if needed
    let updatedLicense: string | undefined;
    if (!isRevoked && license.status === 'active') {
      const licenseFile = this._generateLicenseFile(license, input.hardwareFingerprint);
      const licenseFileJson = JSON.stringify(licenseFile, null, 2);
      updatedLicense = Buffer.from(licenseFileJson, 'utf8').toString('base64');
    }

    // Log sync
    await db.createSyncLog({
      licenseId: license.id,
      licenseKey: input.licenseKey,
      hardwareFingerprint: input.hardwareFingerprint || null,
      syncType: 'heartbeat',
      syncResult: isRevoked ? 'revoked' : 'success',
      clientVersion: input.clientVersion || null,
      ipAddress: input.ipAddress || null,
    });

    return {
      success: true,
      isRevoked,
      revokedKeys,
      updatedLicense,
      serverTime: Date.now(),
    };
  }

  // ─── CRL ──────────────────────────────────────────────────

  /**
   * Get Certificate Revocation List
   */
  async getCRL() {
    const revokedKeys = await db.getRevokedKeys();
    return {
      revokedKeys,
      updatedAt: Date.now(),
    };
  }

  // ─── License Key Generator ─────────────────────────────────

  /**
   * Generate a unique license key (format: XXXX-XXXX-XXXX-XXXX-XXXX)
   */
  generateLicenseKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = 5;
    const segmentLength = 4;

    const parts: string[] = [];
    for (let i = 0; i < segments; i++) {
      let segment = '';
      for (let j = 0; j < segmentLength; j++) {
        segment += chars[crypto.randomInt(chars.length)];
      }
      parts.push(segment);
    }

    return parts.join('-');
  }

  // ─── Download License File ─────────────────────────────────

  /**
   * Generate downloadable license file for a specific license & activation
   */
  async downloadLicenseFile(licenseKey: string, hardwareFingerprint?: string): Promise<string> {
    const license = await db.getLicenseByKey(licenseKey);
    if (!license) throw new Error('License không tồn tại');
    if (license.status !== 'active') throw new Error(`License status: ${license.status}`);

    const licenseFile = this._generateLicenseFile(license, hardwareFingerprint);
    const licenseFileJson = JSON.stringify(licenseFile, null, 2);
    return Buffer.from(licenseFileJson, 'utf8').toString('base64');
  }

  // ─── Hardware Fingerprint (SDK) ──────────────────────────────

  /**
   * Get hardware fingerprint hash via SDK (with fallback)
   */
  async getHardwareFingerprint(): Promise<string> {
    try {
      const { HardwareFingerprint } = loadSDK();
      const fp = await HardwareFingerprint.generate();
      return fp.hash;
    } catch (err: any) {
      console.warn(`[License] SDK fingerprint failed, using fallback: ${err.message}`);
      return this._getFallbackFingerprint();
    }
  }

  /**
   * Get detailed hardware fingerprint via SDK
   */
  async getHardwareFingerprintDetailed(): Promise<{
    hash: string;
    cpuId: string;
    macAddress: string;
    diskSerial: string;
    motherboardSerial: string;
  }> {
    const { HardwareFingerprint } = loadSDK();
    const fp = await HardwareFingerprint.generate();
    return {
      hash: fp.hash,
      cpuId: fp.cpuId,
      macAddress: fp.macAddress,
      diskSerial: fp.diskSerial,
      motherboardSerial: fp.motherboardSerial,
    };
  }

  /**
   * Fallback fingerprint (when SDK's HardwareFingerprint fails)
   */
  private _getFallbackFingerprint(): string {
    const interfaces = os.networkInterfaces();
    const macs: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          macs.push(iface.mac);
        }
      }
    }
    const cpus = os.cpus();
    const raw = `${macs.sort().join(',')}|${cpus[0]?.model || ''}|${os.hostname()}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  }

  // ─── Online Validation (SDK) ───────────────────────────────

  /**
   * Validate license online via SDK
   */
  async validateOnline(licenseKey: string): Promise<ValidateResult> {
    const client = this.getSDKClient();
    const sdkResult: SDKValidationResult = await client.validateOnline(licenseKey);

    if (!sdkResult.isValid) {
      // Sync status to local DB if server says invalid
      if (sdkResult.status && ['revoked', 'expired', 'suspended'].includes(sdkResult.status)) {
        await db.updateLicenseByKey(licenseKey, { status: sdkResult.status as any });
      }
      return {
        isValid: false,
        error: sdkResult.error || 'License không hợp lệ',
        status: sdkResult.status,
        blocked: sdkResult.blocked,
        securityFlags: sdkResult.securityFlags,
        securityWarnings: sdkResult.securityWarnings,
      };
    }

    // Sync server data to local DB
    // Note: customerName is NOT in SDK's ValidationResult type,
    // but the License Server may pass it through at runtime.
    const extra = sdkResult as any;
    await db.updateLicenseByKey(licenseKey, {
      status: 'active',
      allowedModules: sdkResult.moduleCodes || [],
      expiresAt: sdkResult.expiresAt ? new Date(sdkResult.expiresAt) : undefined,
      customerName: extra.customerName,
      licenseType: sdkResult.licenseType,
    });

    return {
      isValid: true,
      status: sdkResult.status || 'active',
      customerName: extra.customerName,
      licenseType: sdkResult.licenseType,
      expiresAt: sdkResult.expiresAt,
      moduleCodes: sdkResult.moduleCodes || [],
      modules: sdkResult.modules,
      blocked: sdkResult.blocked,
      securityFlags: sdkResult.securityFlags,
      securityWarnings: sdkResult.securityWarnings,
    };
  }

  /**
   * Validate license offline via SDK (using offline license base64)
   */
  async validateOffline(offlineLicenseBase64: string): Promise<ValidateResult> {
    const client = this.getSDKClient();
    const sdkResult: SDKValidationResult = await client.validateOffline(offlineLicenseBase64);

    return {
      isValid: sdkResult.isValid,
      error: sdkResult.error,
      status: sdkResult.status,
      customerName: sdkResult.customerName,
      licenseType: sdkResult.licenseType,
      expiresAt: sdkResult.expiresAt,
      moduleCodes: sdkResult.moduleCodes || [],
      modules: sdkResult.modules,
      isOfflineMode: true,
    };
  }

  // ─── Module Management (SDK) ───────────────────────────────

  /**
   * Get allowed modules from License Server
   */
  async getAllowedModulesFromServer(licenseKey: string): Promise<ModuleListResult> {
    const client = this.getSDKClient();
    return client.getAllowedModules(licenseKey);
  }

  /**
   * Check if a specific module is allowed (online)
   */
  async isModuleAllowedOnServer(licenseKey: string, moduleCode: string): Promise<ModuleCheckResult> {
    const client = this.getSDKClient();
    return client.isModuleAllowed(licenseKey, moduleCode);
  }

  /**
   * Check if a module is allowed offline (cached)
   * SDK returns boolean from internal cache
   */
  isModuleAllowedOffline(moduleCode: string): boolean {
    const client = this.getSDKClient();
    return client.isModuleAllowedOffline(moduleCode);
  }

  /**
   * Sync local module list with server
   * SDK expects Array<{ code: string; version?: string }>
   */
  async syncModulesWithServer(
    licenseKey: string,
    clientModules: Array<{ code: string; version?: string }>,
  ): Promise<ModuleSyncResult> {
    const client = this.getSDKClient();
    return client.syncModules(licenseKey, clientModules);
  }

  /**
   * Get all product modules from server
   */
  async getProductModulesFromServer(): Promise<ProductModulesResult> {
    const client = this.getSDKClient();
    return client.getProductModules();
  }

  // ─── Floating License (SDK) ────────────────────────────────

  /**
   * Checkout a floating license seat
   */
  async checkoutFloatingLicense(licenseKey: string): Promise<FloatingCheckoutResult> {
    const client = this.getSDKClient();
    return client.checkoutFloatingLicense(licenseKey);
  }

  /**
   * Checkin (release) a floating license seat
   * SDK returns boolean indicating success
   */
  async checkinFloatingLicense(licenseKey: string, sessionId: string): Promise<{ success: boolean }> {
    const client = this.getSDKClient();
    const success = await client.checkinFloatingLicense(licenseKey, sessionId);
    return { success };
  }

  /**
   * Send heartbeat for floating license session
   * SDK returns boolean indicating success
   */
  async sendFloatingHeartbeat(licenseKey: string, sessionId: string): Promise<{ success: boolean }> {
    const client = this.getSDKClient();
    const success = await client.sendFloatingHeartbeat(licenseKey, sessionId);
    return { success };
  }

  /**
   * Get floating license status (seats info)
   */
  async getFloatingStatus(licenseKey: string): Promise<FloatingStatusResult> {
    const client = this.getSDKClient();
    return client.getFloatingStatus(licenseKey);
  }

  // ─── Grace Period (SDK) ────────────────────────────────────

  /**
   * Check grace period status for a license
   */
  async checkGracePeriod(licenseKey: string): Promise<GracePeriodResult> {
    const client = this.getSDKClient();
    return client.checkGracePeriod(licenseKey);
  }

  // ─── Periodic Validation (SDK) ─────────────────────────────

  /**
   * Start SDK periodic validation (callbacks on validation results)
   */
  startPeriodicValidation(
    licenseKey: string,
    intervalMs: number = 3600000, // 1 hour
    callback?: (result: SDKValidationResult) => void,
  ): void {
    const client = this.getSDKClient();
    client.startPeriodicValidation(licenseKey, intervalMs, callback || ((result) => {
      if (!result.isValid) {
        console.warn(`[License] Periodic validation: license invalid — ${result.error}`);
      } else {
        console.log(`[License] Periodic validation: OK (status=${result.status})`);
      }
    }));
    console.log(`[License] SDK periodic validation started (interval=${intervalMs}ms)`);
  }

  /**
   * Stop SDK periodic validation
   */
  stopPeriodicValidation(): void {
    try {
      const client = this.getSDKClient();
      client.stopPeriodicValidation();
      console.log('[License] SDK periodic validation stopped');
    } catch {
      // Client not initialized, nothing to stop
    }
  }

  /**
   * Check if periodic validation is running
   */
  isPeriodicValidationRunning(): boolean {
    try {
      const client = this.getSDKClient();
      return client.isPeriodicValidationRunning();
    } catch {
      return false;
    }
  }

  /**
   * Load the server's public key via SDK
   * SDK returns boolean indicating if the key was loaded successfully
   */
  async loadServerPublicKey(): Promise<boolean> {
    const client = this.getSDKClient();
    return client.loadPublicKey();
  }

  // ─── Offline Activation Flow ───────────────────────────────

  /**
   * Step 1: Generate an offline activation request
   * Creates a base64-encoded JSON containing:
   *   - licenseKey
   *   - hardwareFingerprint (from SDK)
   *   - productCode
   *   - timestamp
   *
   * The admin copies this request data and submits it to the License Server
   * (via License Server admin panel → offlineActivation.generatePackage)
   * to get a signed offline license package.
   */
  async generateOfflineActivationRequest(licenseKey: string): Promise<{
    requestBase64: string;
    hardwareFingerprint: string;
    productCode: string;
    timestamp: number;
  }> {
    // Generate hardware fingerprint via SDK
    let fingerprint: string;
    try {
      const { HardwareFingerprint } = loadSDK();
      const fp = await HardwareFingerprint.generate();
      fingerprint = fp.hash;
    } catch (err: any) {
      console.warn(`[License] SDK fingerprint failed for offline request, using fallback: ${err.message}`);
      fingerprint = this._getFallbackFingerprint();
    }

    const productCode = ENV.licenseProductCode || 'AOI-MANAGEMENT';
    const timestamp = Date.now();

    const requestPayload = {
      licenseKey,
      hardwareFingerprint: fingerprint,
      productCode,
      timestamp,
    };

    const requestBase64 = Buffer.from(JSON.stringify(requestPayload), 'utf8').toString('base64');

    console.log(`[License] Generated offline activation request for key: ${licenseKey} (fingerprint: ${fingerprint.substring(0, 12)}...)`);

    return {
      requestBase64,
      hardwareFingerprint: fingerprint,
      productCode,
      timestamp,
    };
  }

  /**
   * Step 3: Apply an offline license package received from the License Server
   *
   * Flow:
   *   1. Load the License Server public key (for signature verification)
   *   2. Call SDK validateOffline() with the signed package
   *   3. If valid → store license in local DB
   *   4. Save offline license file (.lic) to disk
   *   5. Force LicenseGuard re-check
   *
   * @param offlinePackageBase64 - The signed offline license package (base64)
   * @param licenseKey - The license key (for DB storage reference)
   */
  async applyOfflineLicense(
    offlinePackageBase64: string,
    licenseKey: string,
  ): Promise<{
    success: boolean;
    error?: string;
    validationResult?: ValidateResult;
  }> {
    try {
      const client = this.getSDKClient();

      // Step 3a: Load the server's public key for offline signature verification
      try {
        const keyLoaded = await client.loadPublicKey();
        if (!keyLoaded) {
          console.warn('[License] Could not load server public key — trying with bundled/cached key');
        } else {
          console.log('[License] Server public key loaded for offline verification');
        }
      } catch (err: any) {
        console.warn(`[License] loadPublicKey failed (server unreachable?): ${err.message}`);
        // Continue anyway — SDK may have cached key from a previous session
      }

      // Step 3b: Validate the offline package using SDK
      const sdkResult: SDKValidationResult = await client.validateOffline(offlinePackageBase64);

      if (!sdkResult.isValid) {
        return {
          success: false,
          error: sdkResult.error || 'Gói license offline không hợp lệ',
          validationResult: {
            isValid: false,
            error: sdkResult.error,
            status: sdkResult.status,
            isOfflineMode: true,
          },
        };
      }

      console.log(`[License] Offline license validated OK — status: ${sdkResult.status}`);

      // Step 3c: Get hardware fingerprint for local storage
      let fingerprint: string;
      try {
        const { HardwareFingerprint } = loadSDK();
        const fp = await HardwareFingerprint.generate();
        fingerprint = fp.hash;
      } catch {
        fingerprint = this._getFallbackFingerprint();
      }

      // Step 3d: Store in local DB
      const extra = sdkResult as any;
      const productCode = ENV.licenseProductCode || 'AOI-MANAGEMENT';
      const existing = await db.getLicenseByKey(licenseKey);
      let licenseId: number;

      if (!existing) {
        const created = await db.createLicense({
          licenseKey,
          productCode,
          customerName: extra.customerName || 'Offline Activation',
          customerEmail: null,
          companyName: null,
          licenseType: sdkResult.licenseType || 'standard',
          status: 'active',
          allowedModules: sdkResult.moduleCodes || [],
          expiresAt: sdkResult.expiresAt ? new Date(sdkResult.expiresAt) : null,
          maxActivations: 1,
          currentActivations: 1,
          lastActivatedAt: new Date(),
        });
        licenseId = created.id;
      } else {
        await db.updateLicenseByKey(licenseKey, {
          status: 'active',
          allowedModules: sdkResult.moduleCodes || [],
          expiresAt: sdkResult.expiresAt ? new Date(sdkResult.expiresAt) : null,
          lastActivatedAt: new Date(),
          customerName: extra.customerName || existing.customerName,
          licenseType: sdkResult.licenseType || existing.licenseType,
        });
        licenseId = existing.id;
      }

      // Create/update activation record
      const activationExists = await db.getActivationByFingerprint(licenseKey, fingerprint);
      if (!activationExists) {
        await db.createLicenseActivation({
          licenseId,
          licenseKey,
          machineName: os.hostname(),
          hardwareFingerprint: fingerprint,
          ipAddress: null,
          clientVersion: null,
          osInfo: `${os.platform()} ${os.release()}`,
          isActive: true,
        });
      } else {
        await db.updateActivationLastSeen(activationExists.id);
      }

      // Step 3e: Save offline license file to disk
      try {
        const licensePath = ENV.licenseFilePath || path.join(process.cwd(), 'license.lic');
        const content = Buffer.from(offlinePackageBase64, 'base64').toString('utf8');
        fs.writeFileSync(licensePath, content, 'utf8');
        console.log(`[License] Offline license file saved to ${licensePath}`);
      } catch (err: any) {
        console.warn(`[License] Failed to save offline license file: ${err.message}`);
      }

      // Also save the raw base64 for future offline startups
      try {
        const rawPath = (ENV.licenseFilePath || path.join(process.cwd(), 'license.lic')) + '.b64';
        fs.writeFileSync(rawPath, offlinePackageBase64, 'utf8');
        console.log(`[License] Offline license base64 saved to ${rawPath}`);
      } catch (err: any) {
        console.warn(`[License] Failed to save offline license base64: ${err.message}`);
      }

      // Log sync
      await db.createSyncLog({
        licenseId,
        licenseKey,
        hardwareFingerprint: fingerprint,
        syncType: 'activate',
        syncResult: 'success',
        clientVersion: null,
        ipAddress: null,
      });

      const validationResult: ValidateResult = {
        isValid: true,
        status: sdkResult.status || 'active',
        customerName: extra.customerName,
        licenseType: sdkResult.licenseType,
        expiresAt: sdkResult.expiresAt,
        moduleCodes: sdkResult.moduleCodes || [],
        modules: sdkResult.modules,
        isOfflineMode: true,
      };

      console.log(`[License] Offline license applied successfully for key: ${licenseKey}`);

      return {
        success: true,
        validationResult,
      };
    } catch (err: any) {
      console.error(`[License] applyOfflineLicense failed:`, err.message);
      return {
        success: false,
        error: `Lỗi áp dụng license offline: ${err.message}`,
      };
    }
  }

  /**
   * Step 4: Load saved offline license from disk for daily validation
   * Used by LicenseGuard when server is unreachable
   */
  async validateSavedOfflineLicense(): Promise<ValidateResult | null> {
    try {
      // Look for the saved base64 file
      const rawPath = (ENV.licenseFilePath || path.join(process.cwd(), 'license.lic')) + '.b64';
      if (!fs.existsSync(rawPath)) {
        console.log('[License] No saved offline license base64 found');
        return null;
      }

      const offlineBase64 = fs.readFileSync(rawPath, 'utf8').trim();
      if (!offlineBase64) return null;

      const client = this.getSDKClient();

      // Try loading public key (may fail if server is unreachable, but SDK might have it cached)
      try {
        await client.loadPublicKey();
      } catch {
        // Continue — SDK may have cached the key from a previous online session
      }

      const sdkResult: SDKValidationResult = await client.validateOffline(offlineBase64);

      return {
        isValid: sdkResult.isValid,
        error: sdkResult.error,
        status: sdkResult.status,
        customerName: (sdkResult as any).customerName,
        licenseType: sdkResult.licenseType,
        expiresAt: sdkResult.expiresAt,
        moduleCodes: sdkResult.moduleCodes || [],
        modules: sdkResult.modules,
        isOfflineMode: true,
      };
    } catch (err: any) {
      console.warn(`[License] validateSavedOfflineLicense failed: ${err.message}`);
      return null;
    }
  }

  // ─── Private Helpers ───────────────────────────────────────

  private _generateLicenseFile(license: any, hardwareFingerprint?: string | null): LicenseFileV2 {
    if (!this.privateKey || !this.publicKey) {
      throw new Error('License keys not initialized');
    }

    // Header
    const header: LicenseFileV2['header'] = {
      formatVersion: 'LIC-V2',
      licenseKey: license.licenseKey,
      productCode: license.productCode,
      customerName: license.customerName,
      licenseType: license.licenseType,
      issuedAt: new Date(license.issuedAt).getTime(),
      expiresAt: license.expiresAt ? new Date(license.expiresAt).getTime() : null,
    };

    // Payload (encrypted)
    const payloadData = {
      customerName: license.customerName,
      customerEmail: license.customerEmail,
      companyName: license.companyName,
      licenseType: license.licenseType,
      modules: license.allowedModules || [],
      maxUsers: license.maxUsers,
      maxMachines: license.maxMachines,
      hardwareFingerprint: hardwareFingerprint || null,
      generatedAt: Date.now(),
      customData: license.customData,
    };

    const payload = this._encryptPayload(JSON.stringify(payloadData));

    // Sign header
    const headerJson = JSON.stringify(header);
    const headerSignature = this._sign(headerJson);

    // Sign payload
    const payloadSignature = this._sign(payload);

    // Checksum
    const checksumData = headerJson + payload;
    const fileChecksum = crypto.createHash('sha256').update(checksumData, 'utf8').digest('hex');

    // Offline policy
    const offlinePolicy: LicenseFileV2['offlinePolicy'] = {
      maxOfflineDays: license.maxOfflineDays || 30,
      gracePeriodDays: license.gracePeriodDays || 7,
      requireHardwareBinding: license.requireHardwareBinding ?? true,
      allowedModules: license.allowedModules || [],
    };

    return {
      header,
      payload,
      security: {
        headerSignature,
        payloadSignature,
        publicKey: this.publicKey,
        fileChecksum,
      },
      offlinePolicy,
    };
  }

  private _encryptPayload(plaintext: string): string {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(this.encryptionSecret, salt, 10000, 32, 'sha1');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // Combine: salt(16) + iv(16) + ciphertext
    const combined = Buffer.concat([salt, iv, encrypted]);
    return combined.toString('base64');
  }

  private _sign(data: string): string {
    if (!this.privateKey) throw new Error('Private key not available');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data, 'utf8');
    sign.end();
    return sign.sign(this.privateKey, 'base64');
  }
}

// Singleton instance
export const licenseService = new LicenseService();
