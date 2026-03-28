/**
 * License Manager Client SDK for Node.js
 * Supports both online and offline license validation with module management
 */
export interface LicenseClientOptions {
    serverUrl: string;
    productCode: string;
    timeout?: number;
    enableSecurityFeatures?: boolean;
}
export interface ActivationRequest {
    licenseKey: string;
    machineName?: string;
}
export interface SecurityWarning {
    message: string;
}
export interface SecurityResult {
    blocked?: boolean;
    securityFlags?: string[];
    securityWarnings?: string[];
    retryAfter?: number;
}
export interface FeatureInfo {
    code: string;
    name: string;
    type: "boolean" | "limit" | "config";
    enabled: boolean;
    value: string | null;
}
export interface ModuleInfo {
    code: string;
    name: string;
    description?: string;
    isCore: boolean;
    features?: FeatureInfo[];
}
export interface ActivationResult {
    success: boolean;
    activationCode?: string;
    activatedAt?: number;
    expiresAt?: number;
    offlineLicenseBase64?: string;
    modules: ModuleInfo[];
    moduleCodes: string[];
    error?: string;
    blocked?: boolean;
    securityFlags?: string[];
    securityWarnings?: string[];
    retryAfter?: number;
    hasModule(moduleCode: string): boolean;
    hasFeature(moduleCode: string, featureCode: string): boolean;
    getFeatureValue(moduleCode: string, featureCode: string): string | null;
}
export interface ValidationResult {
    isValid: boolean;
    licenseKey?: string;
    productCode?: string;
    licenseType?: string;
    status?: string;
    expiresAt?: number;
    remainingActivations?: number;
    modules: ModuleInfo[];
    moduleCodes: string[];
    error?: string;
    blocked?: boolean;
    securityFlags?: string[];
    securityWarnings?: string[];
    hasModule(moduleCode: string): boolean;
    hasFeature(moduleCode: string, featureCode: string): boolean;
    getFeatureValue(moduleCode: string, featureCode: string): string | null;
}
export interface ModuleListResult {
    success: boolean;
    licenseKey?: string;
    productCode?: string;
    status?: string;
    expiresAt?: number;
    modules: ModuleInfo[];
    moduleCodes: string[];
    error?: string;
    hasModule(moduleCode: string): boolean;
    hasFeature(moduleCode: string, featureCode: string): boolean;
    getFeatureValue(moduleCode: string, featureCode: string): string | null;
}
export interface ModuleCheckResult {
    allowed: boolean;
    module?: ModuleInfo;
    error?: string;
}
export interface ModuleSyncResult {
    success: boolean;
    allowedModules: string[];
    deniedModules: string[];
    allLicensedModules: ModuleInfo[];
    error?: string;
}
export interface ProductModulesResult {
    success: boolean;
    productCode?: string;
    productName?: string;
    modules: ModuleInfo[];
    error?: string;
}
export interface FloatingCheckoutResult {
    success: boolean;
    sessionId?: string;
    expiresAt?: number;
    availableSeats: number;
    totalSeats: number;
    error?: string;
}
export interface FloatingStatusResult {
    success: boolean;
    isFloating: boolean;
    maxConcurrentUsers: number;
    currentActiveUsers: number;
    availableSeats: number;
    error?: string;
}
export interface GracePeriodResult {
    success: boolean;
    isInGracePeriod: boolean;
    graceEndsAt?: number;
    daysRemaining: number;
    disabledFeatures: string[];
    error?: string;
}
export interface HardwareFingerprintData {
    cpuId: string;
    macAddress: string;
    diskSerial: string;
    motherboardSerial: string;
    hash: string;
}
export declare class HardwareFingerprint {
    cpuId: string;
    macAddress: string;
    diskSerial: string;
    motherboardSerial: string;
    hash: string;
    private constructor();
    static generate(): Promise<HardwareFingerprint>;
    private static getCpuId;
    private static getMacAddress;
    private static getDiskSerial;
    private static getMotherboardSerial;
    toString(): string;
}
export declare class LicenseClient {
    private serverUrl;
    private productCode;
    private timeout;
    private publicKey;
    private cachedModules;
    private cachedLicenseKey;
    private enableSecurityFeatures;
    private periodicValidationTimer;
    constructor(options: LicenseClientOptions);
    /**
     * Generate a unique request ID for replay attack prevention
     */
    private generateRequestId;
    /**
     * Get current timestamp for time manipulation detection
     */
    private getClientTimestamp;
    /**
     * Add security headers to request payload
     */
    private addSecurityFields;
    activate(request: ActivationRequest): Promise<ActivationResult>;
    validateOnline(licenseKey: string): Promise<ValidationResult>;
    validateOffline(offlineLicenseBase64: string): Promise<ValidationResult>;
    getAllowedModules(licenseKey: string): Promise<ModuleListResult>;
    isModuleAllowed(licenseKey: string, moduleCode: string): Promise<ModuleCheckResult>;
    isModuleAllowedOffline(moduleCode: string): boolean;
    syncModules(licenseKey: string, clientModules: Array<{
        code: string;
        version?: string;
    }>): Promise<ModuleSyncResult>;
    getProductModules(): Promise<ProductModulesResult>;
    checkoutFloatingLicense(licenseKey: string): Promise<FloatingCheckoutResult>;
    checkinFloatingLicense(licenseKey: string, sessionId: string): Promise<boolean>;
    sendFloatingHeartbeat(licenseKey: string, sessionId: string): Promise<boolean>;
    getFloatingStatus(licenseKey: string): Promise<FloatingStatusResult>;
    checkGracePeriod(licenseKey: string): Promise<GracePeriodResult>;
    loadPublicKey(): Promise<boolean>;
    private getCacheDir;
    private computeHash;
    private saveModulesToCache;
    private loadModulesFromCache;
    /**
     * Start periodic license validation to detect tampering or revocation
     * @param licenseKey - The license key to validate
     * @param intervalMs - Validation interval in milliseconds (default: 1 hour)
     * @param callback - Callback function called after each validation
     */
    startPeriodicValidation(licenseKey: string, intervalMs?: number, callback?: (result: ValidationResult) => void): void;
    /**
     * Stop periodic license validation
     */
    stopPeriodicValidation(): void;
    /**
     * Check if periodic validation is running
     */
    isPeriodicValidationRunning(): boolean;
}
export default LicenseClient;
//# sourceMappingURL=index.d.ts.map