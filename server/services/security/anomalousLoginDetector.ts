/**
 * Anomalous-login detection (doc 44 G5.18 · SYNAPSE_Tang5 Ch.11-12 IAM).
 *
 * Flags a SUCCESSFUL login that looks unusual for the account:
 *   • new source IP (never seen in this user's recent successful logins),
 *   • unusual hour-of-day (outside the user's historical login hours),
 *   • success right after a BURST of recent failures (credential-stuffing tell),
 *   • optional geo/country change (only when a country is supplied).
 *
 * The scoring core (`scoreLogin`) is PURE + deterministic (history in → verdict
 * out) so it is fully unit-testable. `checkLoginAnomaly()` is the thin DB-backed
 * hook: it reads the user's recent login history from the EXISTING audit_log,
 * scores, and — on an anomaly — records a `anomalous_login` audit event + a SIEM
 * export (+ optional alert). It NEVER throws and NEVER blocks the login.
 *
 * FAIL-SAFE / NON-BREAKING: gated by ANOMALOUS_LOGIN_ENABLED (default OFF →
 * checkLoginAnomaly is an immediate no-op).
 */

// ─── Config ───────────────────────────────────────────────────────────────────
function envStr(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[name] ?? "").trim();
}

export function anomalousLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = envStr("ANOMALOUS_LOGIN_ENABLED", env).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function failBurstThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(envStr("ANOMALOUS_LOGIN_FAIL_BURST", env), 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

// ─── Pure scoring core ────────────────────────────────────────────────────────
export interface LoginHistory {
  /** Distinct source IPs seen in prior SUCCESSFUL logins. */
  knownIps: string[];
  /** Hours-of-day (0-23, local) of prior SUCCESSFUL logins. */
  typicalHours: number[];
  /** Number of consecutive/recent FAILED attempts immediately preceding this success. */
  recentFailures: number;
  /** Countries seen before (optional; only used when `country` is supplied). */
  knownCountries?: string[];
  /** True when this account has NO prior successful-login history (first login). */
  firstEverLogin?: boolean;
}

export interface LoginObservation {
  ip?: string;
  /** Epoch ms of the login. */
  at: number;
  country?: string;
}

export interface AnomalyResult {
  anomalous: boolean;
  /** 0..1 heuristic score. */
  score: number;
  reasons: string[];
  severity: "info" | "warning" | "critical";
}

/**
 * Score a successful login against the account's history. Pure + deterministic.
 * A brand-new account (firstEverLogin) is NOT flagged for "new IP/hour" (there is
 * no baseline yet) — only a preceding failure burst is still meaningful.
 */
export function scoreLogin(
  obs: LoginObservation,
  history: LoginHistory,
  opts: { failBurst?: number } = {},
): AnomalyResult {
  const reasons: string[] = [];
  let score = 0;
  const failBurst = opts.failBurst ?? 3;
  const hasBaseline = !history.firstEverLogin && (history.knownIps.length > 0 || history.typicalHours.length > 0);

  // Signal 1 — new source IP.
  if (hasBaseline && obs.ip && history.knownIps.length > 0 && !history.knownIps.includes(obs.ip)) {
    reasons.push(`new source IP ${obs.ip}`);
    score += 0.5;
  }

  // Signal 2 — unusual hour-of-day.
  if (hasBaseline && history.typicalHours.length >= 3) {
    const hour = new Date(obs.at).getHours();
    if (!history.typicalHours.includes(hour)) {
      reasons.push(`unusual hour ${hour}:00 (typical: ${uniqSorted(history.typicalHours).join(",")})`);
      score += 0.3;
    }
  }

  // Signal 3 — success after a burst of failures.
  if (history.recentFailures >= failBurst) {
    reasons.push(`${history.recentFailures} failed attempts immediately before success`);
    score += 0.5;
  }

  // Signal 4 — geo/country change (only when country data is present).
  if (
    obs.country &&
    history.knownCountries &&
    history.knownCountries.length > 0 &&
    !history.knownCountries.includes(obs.country)
  ) {
    reasons.push(`new country ${obs.country} (known: ${history.knownCountries.join(",")})`);
    score += 0.4;
  }

  score = Math.min(1, score);
  const anomalous = reasons.length > 0 && score >= 0.5;
  const severity: AnomalyResult["severity"] =
    score >= 0.9 ? "critical" : anomalous ? "warning" : "info";
  return { anomalous, score: round2(score), reasons, severity };
}

function uniqSorted(arr: number[]): number[] {
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── DB-backed history + hook ─────────────────────────────────────────────────
interface AuditLogRow {
  action: string;
  status: "success" | "failure";
  ipAddress: string | null;
  createdAt: Date;
  details?: string | null;
}

/**
 * Derive a LoginHistory for a user from their recent audit_log login rows.
 * `recentFailures` = count of failures AFTER the most recent prior success
 * (i.e. the current unbroken failure streak).
 */
export function deriveHistoryFromAuditRows(rows: AuditLogRow[]): LoginHistory {
  // rows expected newest-first.
  const successes = rows.filter((r) => r.status === "success");
  const knownIps = Array.from(new Set(successes.map((r) => r.ipAddress).filter((v): v is string => !!v)));
  const typicalHours = Array.from(
    new Set(successes.map((r) => new Date(r.createdAt).getHours())),
  );
  // Current failure streak: leading failures before the first success (newest-first).
  let recentFailures = 0;
  for (const r of rows) {
    if (r.status === "failure") recentFailures += 1;
    else break;
  }
  const knownCountries = Array.from(
    new Set(
      successes
        .map((r) => parseCountry(r.details))
        .filter((v): v is string => !!v),
    ),
  );
  return {
    knownIps,
    typicalHours,
    recentFailures,
    knownCountries: knownCountries.length ? knownCountries : undefined,
    firstEverLogin: successes.length === 0,
  };
}

function parseCountry(details?: string | null): string | undefined {
  if (!details) return undefined;
  try {
    const d = JSON.parse(details) as { country?: string };
    return typeof d.country === "string" ? d.country : undefined;
  } catch {
    return undefined;
  }
}

export interface LoginContext {
  userId: number;
  username: string;
  ip?: string | null;
  at?: number;
  country?: string;
  userAgent?: string | null;
}

export interface AnomalyHookResult extends AnomalyResult {
  checked: boolean;
  reason?: string;
}

/**
 * Evaluate a just-succeeded login for anomalies. No-op (checked:false) when the
 * flag is off. Best-effort: any DB/SIEM error is swallowed — this must never
 * break or block the login flow.
 */
export async function checkLoginAnomaly(
  ctx: LoginContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AnomalyHookResult> {
  const at = ctx.at ?? Date.now();
  if (!anomalousLoginEnabled(env)) {
    return { checked: false, reason: "flag-off", anomalous: false, score: 0, reasons: [], severity: "info" };
  }
  try {
    const db = await import("../../db");
    // Pull recent login rows for THIS user (successes + failures), newest-first.
    const { logs } = await db.getAuditLogs({ userId: ctx.userId, action: "login", limit: 50 });
    const history = deriveHistoryFromAuditRows(logs as unknown as AuditLogRow[]);
    const result = scoreLogin(
      { ip: ctx.ip ?? undefined, at, country: ctx.country },
      history,
      { failBurst: failBurstThreshold(env) },
    );

    if (result.anomalous) {
      // 1) Record a dedicated security audit event (goes into the same tamper-
      //    evident audit_log the SIEM already reads).
      await db
        .createAuditLog({
          userId: ctx.userId,
          userName: ctx.username,
          action: "anomalous_login",
          entityType: "auth",
          status: "failure", // flagged/suspicious — surfaced as failure severity
          ipAddress: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          details: { reasons: result.reasons, score: result.score, severity: result.severity },
        })
        .catch(() => { /* never block */ });

      // 2) Forward to SIEM (no-op when SIEM_EXPORT_ENABLED off).
      try {
        const { exportSiemEvent } = await import("./siemExporter");
        await exportSiemEvent({
          ts: at,
          category: "auth",
          action: "anomalous_login",
          outcome: "failure",
          actor: ctx.username,
          ip: ctx.ip ?? undefined,
          severity: result.severity === "critical" ? 3 : 4,
          detail: { reasons: result.reasons, score: result.score },
        });
      } catch { /* siem best-effort */ }

      console.warn(
        `[security/anomalousLogin] flagged login for ${ctx.username} (score=${result.score}): ${result.reasons.join("; ")}`,
      );
    }
    return { checked: true, ...result };
  } catch (err) {
    console.warn("[security/anomalousLogin] check failed (ignored):", (err as Error)?.message ?? err);
    return { checked: false, reason: "error", anomalous: false, score: 0, reasons: [], severity: "info" };
  }
}
