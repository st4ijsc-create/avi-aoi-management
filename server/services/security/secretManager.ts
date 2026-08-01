/**
 * Secret manager (doc 44 G5.23 · SYNAPSE_Tang5 Ch.12) — OpenBao / HashiCorp Vault
 * KV v2 over the plain HTTP API with an HONEST `process.env` fallback.
 *
 * NO SDK / NO new dependency: talks to OpenBao/Vault via the built-in `fetch`
 * (Node ≥18). One module is the single upgrade seam — swap this for a real KMS
 * later without touching call sites.
 *
 * FAIL-SAFE / NON-BREAKING (cờ OFF = hành vi cũ):
 *   • SECRET_MANAGER_ENABLED unset/false  → getSecret() reads `process.env[key]`
 *     exactly as before. Zero network, zero behaviour change.
 *   • enabled + configured                → reads `secret/data/<path>` (KV v2) once,
 *     caches the whole bundle (TTL), and serves keys from it. A miss OR any Vault
 *     error transparently FALLS BACK to `process.env[key]` (logged once) — the app
 *     never loses a secret because Vault hiccupped.
 *
 * Sync vs async:
 *   • getSecret(key)      — async; may hit Vault, then cache, then env.
 *   • getSecretSync(key)  — never touches the network: returns a cached Vault value
 *     if one was warmed, else `process.env[key]`. Lets synchronous call sites adopt
 *     the manager with identical OFF behaviour.
 *
 * Rotation: refreshSecret()/refreshAll() drop the cache so the next read re-fetches.
 */

// ─── Config (read at call-time so a flag flip needs no module reload) ─────────
function envStr(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[name] ?? "").trim();
}

/** Is the external secret manager ENABLED? Default OFF (pure env fallback). */
export function secretManagerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = envStr("SECRET_MANAGER_ENABLED", env).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Enabled AND the minimum Vault coordinates (addr+token) are present. */
export function secretManagerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return secretManagerEnabled(env) && !!envStr("VAULT_ADDR", env) && !!envStr("VAULT_TOKEN", env);
}

interface VaultConfig {
  addr: string;
  token: string;
  mount: string;
  path: string;
  namespace?: string;
  ttlMs: number;
  timeoutMs: number;
}

function readVaultConfig(env: NodeJS.ProcessEnv = process.env): VaultConfig {
  const ttl = parseInt(envStr("SECRET_MANAGER_TTL_MS", env), 10);
  const timeout = parseInt(envStr("SECRET_MANAGER_TIMEOUT_MS", env), 10);
  return {
    addr: envStr("VAULT_ADDR", env).replace(/\/+$/, ""),
    token: envStr("VAULT_TOKEN", env),
    mount: envStr("VAULT_KV_MOUNT", env) || "secret",
    path: envStr("VAULT_SECRET_PATH", env) || "avi-aoi/prod",
    namespace: envStr("VAULT_NAMESPACE", env) || undefined,
    ttlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : 5 * 60_000,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 3_000,
  };
}

// ─── In-process bundle cache ──────────────────────────────────────────────────
interface Bundle {
  path: string;
  data: Record<string, string>;
  fetchedAt: number;
}
let _bundle: Bundle | null = null;
let _inFlight: Promise<Bundle | null> | null = null;
let _warnedFallback = false;

function bundleFresh(cfg: VaultConfig): boolean {
  return (
    !!_bundle &&
    _bundle.path === `${cfg.mount}/${cfg.path}` &&
    Date.now() - _bundle.fetchedAt < cfg.ttlMs
  );
}

/**
 * Fetch the KV v2 secret bundle: GET {addr}/v1/{mount}/data/{path}.
 * Returns the field map, or null on ANY failure (caller falls back to env).
 */
async function fetchBundle(cfg: VaultConfig): Promise<Bundle | null> {
  const url = `${cfg.addr}/v1/${cfg.mount}/data/${cfg.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const headers: Record<string, string> = { "X-Vault-Token": cfg.token };
    if (cfg.namespace) headers["X-Vault-Namespace"] = cfg.namespace;
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      warnFallbackOnce(`Vault returned HTTP ${res.status} for ${cfg.mount}/${cfg.path}`);
      return null;
    }
    const json = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const raw = json?.data?.data;
    if (!raw || typeof raw !== "object") {
      warnFallbackOnce("Vault response missing data.data (not a KV v2 secret?)");
      return null;
    }
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v != null) data[k] = String(v);
    }
    return { path: `${cfg.mount}/${cfg.path}`, data, fetchedAt: Date.now() };
  } catch (err) {
    warnFallbackOnce(`Vault fetch failed: ${(err as Error)?.message ?? err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function warnFallbackOnce(msg: string): void {
  if (!_warnedFallback) {
    console.warn(`[security/secretManager] ${msg} — falling back to process.env (honest fallback).`);
    _warnedFallback = true;
  }
}

/** Ensure a fresh bundle is loaded (coalesces concurrent callers). */
async function ensureBundle(cfg: VaultConfig): Promise<Bundle | null> {
  if (bundleFresh(cfg)) return _bundle;
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    const b = await fetchBundle(cfg);
    if (b) _bundle = b;
    return b;
  })();
  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export interface GetSecretOptions {
  /** Override the env used for config + fallback (tests). */
  env?: NodeJS.ProcessEnv;
  /** Env var to fall back to when Vault has no value. Defaults to `key`. */
  fallbackEnv?: string;
}

/**
 * Resolve a secret by key.
 *   enabled+configured → Vault bundle → (miss) env fallback.
 *   otherwise          → env fallback (identical to the pre-manager behaviour).
 * Returns undefined only when neither source has the key.
 */
export async function getSecret(key: string, opts: GetSecretOptions = {}): Promise<string | undefined> {
  const env = opts.env ?? process.env;
  const fallbackKey = opts.fallbackEnv ?? key;
  if (!secretManagerConfigured(env)) {
    return envValue(env, fallbackKey);
  }
  const cfg = readVaultConfig(env);
  const bundle = await ensureBundle(cfg);
  const fromVault = bundle?.data[key];
  if (fromVault != null && fromVault !== "") return fromVault;
  return envValue(env, fallbackKey);
}

/**
 * Synchronous resolve — NEVER hits the network. Serves a warmed Vault value if
 * present, else the env fallback. Use for sync call sites; call getSecret()/
 * warmSecrets() at startup to populate the cache when the manager is enabled.
 */
export function getSecretSync(key: string, opts: GetSecretOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const fallbackKey = opts.fallbackEnv ?? key;
  if (secretManagerConfigured(env) && _bundle) {
    const v = _bundle.data[key];
    if (v != null && v !== "") return v;
  }
  return envValue(env, fallbackKey);
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v != null && v !== "" ? v : undefined;
}

/**
 * Pre-load the bundle so getSecretSync() serves Vault values. No-op (and no
 * network) when the manager is disabled/unconfigured. Best-effort: never throws.
 */
export async function warmSecrets(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!secretManagerConfigured(env)) return false;
  const b = await ensureBundle(readVaultConfig(env));
  return !!b;
}

/** Rotation: drop the cache so the next read re-fetches the (rotated) secret. */
export async function refreshSecret(_key?: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  _bundle = null;
  if (secretManagerConfigured(env)) await ensureBundle(readVaultConfig(env));
}

/** Rotation: drop the whole cache. */
export function refreshAll(): void {
  _bundle = null;
}

/** Health/status snapshot for a readiness surface. */
export function secretManagerStatus(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  configured: boolean;
  cached: boolean;
  cachedKeys: number;
  ageMs: number | null;
} {
  return {
    enabled: secretManagerEnabled(env),
    configured: secretManagerConfigured(env),
    cached: !!_bundle,
    cachedKeys: _bundle ? Object.keys(_bundle.data).length : 0,
    ageMs: _bundle ? Date.now() - _bundle.fetchedAt : null,
  };
}

/** Test helper — clears cache + one-shot warn latch. */
export function _resetSecretManager(): void {
  _bundle = null;
  _inFlight = null;
  _warnedFallback = false;
}

/** Test helper — seed the bundle cache without a network call. */
export function _primeSecretBundle(data: Record<string, string>, env: NodeJS.ProcessEnv = process.env): void {
  const cfg = readVaultConfig(env);
  _bundle = { path: `${cfg.mount}/${cfg.path}`, data: { ...data }, fetchedAt: Date.now() };
}
