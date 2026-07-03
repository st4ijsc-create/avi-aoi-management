/**
 * W5-21 (doc 25) — ISA-18.2 / EEMUA-191 Master Alarm service. Flag: EQ_GOVERN_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The RATIONALIZATION + PERFORMANCE core the alarm system was missing. Three pure,
 * unit-testable pieces plus their DB loaders:
 *
 *   1. PRIORITY DERIVATION (EEMUA-191) — priority is NOT entered by hand; it is a
 *      deterministic function of the CONSEQUENCE severity × the TIME the operator has
 *      to respond. derivePriority() implements the standard matrix.
 *
 *   2. RUNTIME RESOLUTION — loadAlarmMappings() returns SEED ∪ DB taxonomy so a
 *      user-authored mapping actually reaches the runtime Andon path; isAlarmSuppressed()
 *      tells the bridge whether a resolved alarm is SHELVED (temporary) or SUPPRESSED
 *      (design) so a shelved alarm raises NOTHING.
 *
 *   3. ALARM KPIs (EEMUA-191 performance metrics) — computeAlarmKpis() derives, from
 *      the existing Andon history, the standard metrics: alarms/operator/hour, flood
 *      windows, chattering alarms, standing/stale alarms, and the top bad-actors.
 *
 * PURE / FAIL-SAFE: every compute function is pure over its inputs (trivially testable);
 * every DB loader degrades to the SEED / empty result on no-DB / error. Nothing here
 * opens a control path — shelving only suppresses a SIGNAL (an Andon).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { getDb } from "../../db/connection";
import { alarmTaxonomy, masterAlarms, type MasterAlarm } from "../../../drizzle/schema/equipmentStandards";
import {
  SEED_ALARM_MAPPINGS,
  asSeverity,
  normalizeVendor,
  type AlarmMapping,
} from "./alarmTaxonomy";

// ════════════════════════════════════════════════════════════════════════════
// 1. PRIORITY DERIVATION — EEMUA-191 consequence × time-to-respond matrix.
// ════════════════════════════════════════════════════════════════════════════

/** Consequence band if the operator does NOT respond. */
export type AlarmConsequence = "none" | "minor" | "major" | "severe";
/** DERIVED alarm priority (distinct from taxonomy severity). */
export type AlarmPriority = "low" | "medium" | "high" | "critical";
/** Time-available band (from timeToRespond minutes). */
export type TimeBand = "short" | "medium" | "long";

export const ALARM_CONSEQUENCES = ["none", "minor", "major", "severe"] as const;
export const ALARM_PRIORITIES = ["low", "medium", "high", "critical"] as const;

/** Narrow arbitrary input → a canonical consequence band ('critical' aliases 'severe'). */
export function normalizeConsequence(raw: unknown): AlarmConsequence {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "severe" || s === "critical") return "severe";
  if (s === "major" || s === "high") return "major";
  if (s === "none" || s === "diagnostic") return "none";
  return "minor"; // fail-safe default (minor, never silently 'none')
}

/**
 * Time-available band from minutes-to-respond.
 *   short  : < 10 min  (act now)
 *   medium : 10–30 min
 *   long   : > 30 min
 * Null/unknown → 'medium' (conservative middle).
 */
export function timeBand(minutes: number | null | undefined): TimeBand {
  if (minutes == null || !Number.isFinite(minutes)) return "medium";
  if (minutes < 10) return "short";
  if (minutes <= 30) return "medium";
  return "long";
}

// EEMUA-191 style priority matrix [consequence][timeBand]. Higher consequence and less
// time → higher priority. Documented, deterministic and directly unit-tested per cell.
const PRIORITY_MATRIX: Record<AlarmConsequence, Record<TimeBand, AlarmPriority>> = {
  severe: { short: "critical", medium: "critical", long: "high" },
  major: { short: "high", medium: "high", long: "medium" },
  minor: { short: "medium", medium: "low", long: "low" },
  none: { short: "low", medium: "low", long: "low" },
};

/**
 * DERIVE the ISA-18.2 priority from the consequence severity and the minutes the
 * operator has to respond. Pure + deterministic (the master alarm stores the result so
 * it is auditable). This is the piece "severity nhập tay" was missing.
 */
export function derivePriority(
  consequence: unknown,
  timeToRespondMinutes: number | null | undefined,
): AlarmPriority {
  return PRIORITY_MATRIX[normalizeConsequence(consequence)][timeBand(timeToRespondMinutes)];
}

// ════════════════════════════════════════════════════════════════════════════
// 2. RUNTIME RESOLUTION — SEED ∪ DB taxonomy + shelving/suppression check.
// ════════════════════════════════════════════════════════════════════════════

/** The minimal alarm_taxonomy row shape merged over the seed. */
export interface DbAlarmTaxonomyRow {
  vendor: string;
  nativeCode: string;
  standardCode: string;
  severity: string;
  machineType?: string | null;
  deviceTypeKey?: string | null;
  description?: string | null;
  recommendedAction?: string | null;
}

function taxKey(vendor: string, nativeCode: string): string {
  return `${normalizeVendor(vendor)}::${nativeCode}`;
}

/**
 * PURE merge: SEED ∪ DB rows, DB rows OVERRIDE the seed by (vendor, nativeCode). Exposed
 * for unit-testing loadAlarmMappings without a DB. Mirrors the router's original inline
 * merge exactly.
 */
export function mergeAlarmMappings(dbRows: DbAlarmTaxonomyRow[]): AlarmMapping[] {
  const merged = new Map<string, AlarmMapping>();
  for (const m of SEED_ALARM_MAPPINGS) merged.set(taxKey(m.vendor, m.nativeCode), m);
  for (const r of dbRows) {
    merged.set(taxKey(r.vendor, r.nativeCode), {
      vendor: r.vendor,
      machineType: r.machineType ?? null,
      deviceTypeKey: r.deviceTypeKey ?? null,
      nativeCode: r.nativeCode,
      standardCode: r.standardCode,
      severity: asSeverity(r.severity),
      description: r.description ?? undefined,
      recommendedAction: r.recommendedAction ?? undefined,
    });
  }
  return Array.from(merged.values());
}

/**
 * Load the full alarm mapping set = SEED ∪ persisted alarm_taxonomy rows. FAIL-SAFE:
 * no DB / query error → the pure seed. This is what the runtime bridge + cockpit call
 * so a user-authored mapping actually reaches the Andon path.
 */
export async function loadAlarmMappings(): Promise<AlarmMapping[]> {
  try {
    const d = await getDb();
    if (!d) return SEED_ALARM_MAPPINGS;
    const rows = await d.select().from(alarmTaxonomy);
    return mergeAlarmMappings(rows as DbAlarmTaxonomyRow[]);
  } catch {
    return SEED_ALARM_MAPPINGS; // fail-safe — never break the alarm path on a DB error
  }
}

/** Load all master alarm rows. FAIL-SAFE: no DB / missing table → []. */
export async function loadMasterAlarms(): Promise<MasterAlarm[]> {
  try {
    const d = await getDb();
    if (!d) return [];
    return await d.select().from(masterAlarms);
  } catch {
    return []; // table absent (migration 0169 not run) → treat as "no master alarms"
  }
}

/** The subset of a master alarm the shelving check needs (loosened for testability). */
export interface ShelveCheckable {
  alarmKey: string;
  assetType?: string | null;
  vendor?: string | null;
  nativeCode?: string | null;
  isSuppressed?: boolean | null;
  shelvedUntil?: Date | string | number | null;
}

/** What identifies the alarm being raised (resolved standard code + raw vendor code). */
export interface AlarmTarget {
  standardCode: string;
  vendor?: string | null;
  nativeCode?: string | null;
  assetType?: string | null;
}

export interface SuppressionResult {
  suppressed: boolean;
  reason: "shelved" | "suppressed" | null;
  master: ShelveCheckable | null;
}

function toMillis(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Does a master row apply to this target? (by standardCode, or by vendor+nativeCode). */
function masterMatches(m: ShelveCheckable, target: AlarmTarget): boolean {
  const byKey = m.alarmKey && target.standardCode
    && m.alarmKey.toLowerCase() === target.standardCode.toLowerCase();
  const byVendor = m.vendor && target.vendor && m.nativeCode && target.nativeCode
    && normalizeVendor(m.vendor) === normalizeVendor(target.vendor)
    && m.nativeCode === target.nativeCode;
  if (!byKey && !byVendor) return false;
  // Asset-type scope: null master assetType = applies to all; else must match target.
  if (m.assetType && target.assetType && m.assetType.toLowerCase() !== target.assetType.toLowerCase()) {
    return false;
  }
  return true;
}

/**
 * PURE: is this alarm SHELVED (shelvedUntil in the future) or SUPPRESSED (design
 * out-of-service)? Among all matching master rows, the FIRST suppressing one wins
 * (isSuppressed takes precedence over a shelve window). No match → not suppressed.
 * The runtime bridge uses this to SKIP raising an Andon.
 */
export function isAlarmSuppressed(
  masters: ShelveCheckable[],
  target: AlarmTarget,
  now: number = Date.now(),
): SuppressionResult {
  for (const m of masters) {
    if (!masterMatches(m, target)) continue;
    if (m.isSuppressed) return { suppressed: true, reason: "suppressed", master: m };
    const until = toMillis(m.shelvedUntil ?? null);
    if (until != null && until > now) return { suppressed: true, reason: "shelved", master: m };
  }
  return { suppressed: false, reason: null, master: null };
}

/** Bundled runtime context: SEED∪DB taxonomy + master alarms. FAIL-SAFE. */
export async function loadRuntimeAlarmContext(): Promise<{
  entries: AlarmMapping[];
  masters: MasterAlarm[];
}> {
  const [entries, masters] = await Promise.all([loadAlarmMappings(), loadMasterAlarms()]);
  return { entries, masters };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. ALARM KPIs — EEMUA-191 performance metrics over the Andon history.
// ════════════════════════════════════════════════════════════════════════════

/** ONE alarm occurrence fed to the KPI engine (from andon_events). */
export interface AlarmKpiEvent {
  /** Stable identity of the alarm point (for chattering + bad-actor grouping). */
  key: string;
  machineId?: number | null;
  /** Epoch ms the alarm was raised. */
  raisedAt: number;
  /** Epoch ms it was resolved, or null if still standing. */
  resolvedAt?: number | null;
}

export interface AlarmKpiOptions {
  /** Operator positions covering the window (for alarms/operator/hour). Default 1. */
  operatorCount?: number;
  /** Flood window size (ms). EEMUA default 10 min. */
  floodWindowMs?: number;
  /** Alarms in a flood window above which it counts as a FLOOD. EEMUA default 10. */
  floodThreshold?: number;
  /** Chattering look-back window (ms). Default 60 min. */
  chatterWindowMs?: number;
  /** Occurrences of the SAME key within the window to count as CHATTERING. Default 3. */
  chatterThreshold?: number;
  /** A still-active alarm older than this (ms) is STANDING/STALE. Default 24 h. */
  standingMs?: number;
  /** "Now" for standing-alarm age (epoch ms). Default Date.now(). */
  now?: number;
  /** Cap on bad-actor list. Default 10. */
  badActorLimit?: number;
}

export interface AlarmKpiResult {
  totalAlarms: number;
  windowHours: number;
  alarmsPerHour: number;
  alarmsPerOperatorHour: number;
  /** Count of flood windows (>= floodThreshold in a floodWindow). */
  floodWindowCount: number;
  /** Peak alarms observed in any single flood window. */
  peakWindowCount: number;
  /** Alarm points that recurred >= chatterThreshold within chatterWindow. */
  chattering: Array<{ key: string; occurrences: number }>;
  /** Currently-standing (unresolved, older than standingMs) alarms. */
  standing: Array<{ key: string; ageHours: number }>;
  standingCount: number;
  /** Top bad-actor alarm points by occurrence (EEMUA "bad actors"). */
  badActors: Array<{ key: string; count: number; share: number }>;
}

const DEFAULTS = {
  operatorCount: 1,
  floodWindowMs: 10 * 60_000,
  floodThreshold: 10,
  chatterWindowMs: 60 * 60_000,
  chatterThreshold: 3,
  standingMs: 24 * 60 * 60_000,
  badActorLimit: 10,
};

/**
 * PURE — derive the EEMUA-191 alarm KPIs from a list of alarm occurrences. Deterministic
 * over its inputs (no I/O), so it is trivially unit-testable on a fixture.
 */
export function computeAlarmKpis(events: AlarmKpiEvent[], opts: AlarmKpiOptions = {}): AlarmKpiResult {
  const operatorCount = Math.max(1, opts.operatorCount ?? DEFAULTS.operatorCount);
  const floodWindowMs = opts.floodWindowMs ?? DEFAULTS.floodWindowMs;
  const floodThreshold = opts.floodThreshold ?? DEFAULTS.floodThreshold;
  const chatterWindowMs = opts.chatterWindowMs ?? DEFAULTS.chatterWindowMs;
  const chatterThreshold = opts.chatterThreshold ?? DEFAULTS.chatterThreshold;
  const standingMs = opts.standingMs ?? DEFAULTS.standingMs;
  const badActorLimit = opts.badActorLimit ?? DEFAULTS.badActorLimit;
  const now = opts.now ?? Date.now();

  const sorted = [...events].filter((e) => Number.isFinite(e.raisedAt)).sort((a, b) => a.raisedAt - b.raisedAt);
  const totalAlarms = sorted.length;

  // Window span (first→last raise, min 1 h so a short burst does not divide by ~0).
  const spanMs = totalAlarms >= 2 ? sorted[totalAlarms - 1].raisedAt - sorted[0].raisedAt : 0;
  const windowHours = Math.max(1, spanMs / 3_600_000);
  const alarmsPerHour = totalAlarms / windowHours;
  const alarmsPerOperatorHour = alarmsPerHour / operatorCount;

  // ── Flood windows — slide a fixed window over the timeline (bucketed by floor). ──
  const bucketCounts = new Map<number, number>();
  for (const e of sorted) {
    const b = Math.floor(e.raisedAt / floodWindowMs);
    bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
  }
  let floodWindowCount = 0;
  let peakWindowCount = 0;
  for (const c of bucketCounts.values()) {
    if (c >= floodThreshold) floodWindowCount += 1;
    if (c > peakWindowCount) peakWindowCount = c;
  }

  // ── Bad actors + chattering — group by key. ──
  const byKey = new Map<string, number[]>(); // key → sorted raise times
  for (const e of sorted) {
    const arr = byKey.get(e.key) ?? [];
    arr.push(e.raisedAt);
    byKey.set(e.key, arr);
  }
  const badActors = Array.from(byKey.entries())
    .map(([key, times]) => ({ key, count: times.length, share: totalAlarms ? times.length / totalAlarms : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, badActorLimit);

  // Chattering: a key with >= chatterThreshold occurrences inside ANY chatterWindow.
  const chattering: Array<{ key: string; occurrences: number }> = [];
  for (const [key, times] of byKey.entries()) {
    if (times.length < chatterThreshold) continue;
    let maxInWindow = 0;
    let start = 0;
    for (let end = 0; end < times.length; end++) {
      while (times[end] - times[start] > chatterWindowMs) start++;
      maxInWindow = Math.max(maxInWindow, end - start + 1);
    }
    if (maxInWindow >= chatterThreshold) chattering.push({ key, occurrences: times.length });
  }
  chattering.sort((a, b) => b.occurrences - a.occurrences);

  // ── Standing / stale — still unresolved AND older than standingMs. ──
  const standing = sorted
    .filter((e) => (e.resolvedAt == null) && now - e.raisedAt >= standingMs)
    .map((e) => ({ key: e.key, ageHours: (now - e.raisedAt) / 3_600_000 }))
    .sort((a, b) => b.ageHours - a.ageHours);

  return {
    totalAlarms,
    windowHours,
    alarmsPerHour,
    alarmsPerOperatorHour,
    floodWindowCount,
    peakWindowCount,
    chattering,
    standing,
    standingCount: standing.length,
    badActors,
  };
}
