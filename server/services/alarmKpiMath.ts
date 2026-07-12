/**
 * doc 44 W6-1 (G5.11 phần đo) — ISA-18.2 alarm KPI math (PURE, unit-testable).
 *
 * KHÔNG import db/schema. alarmKpiRouter nạp andon_events + predictive_alerts,
 * chuẩn hóa về AlarmEventLite rồi gọi summarizeAlarmKpi() ở đây.
 *
 * Chuẩn thị trường (ISA-18.2, benchmark doc 44):
 *   • ~6 alarm/giờ/operator (mục tiêu), tối đa 12 (chấp nhận được ngắn hạn).
 *   • Flood: >10 alarm trong 10 phút (bất kỳ cửa sổ nào) = giai đoạn "ngập" báo động.
 *   • Standing/stale: <5 báo động "đứng yên" (chưa xử lý quá lâu).
 *   • Phân bố ưu tiên mục tiêu ~80/15/5 (low/medium/high — high nhất chiếm ~5%).
 */

export type AlarmPriority = "low" | "medium" | "high" | "critical";

export interface AlarmEventLite {
  id: string;
  source: "andon" | "predictive" | string;
  priority: AlarmPriority;
  /** epoch ms khi báo động phát sinh. */
  raisedAt: number;
  /** epoch ms khi được acknowledge (null = chưa). */
  acknowledgedAt: number | null;
  /** epoch ms khi được resolve (null = còn tồn). */
  resolvedAt: number | null;
  /** Khóa gom "bad actor" (asset/máy/trạm) + nhãn hiển thị. */
  actorKey: string | null;
  actorLabel: string | null;
  title: string;
}

// ─── Ngưỡng ISA-18.2 (benchmark doc 44) ──────────────────────────────────────
export const ISA_182 = {
  ratePerOperatorTarget: 6,   // alarm/giờ/operator mục tiêu
  ratePerOperatorMax: 12,     // trần chấp nhận được
  floodWindowMs: 10 * 60_000, // 10 phút
  floodThreshold: 10,         // >10 trong cửa sổ = flood
  standingThresholdMs: 24 * 3600_000, // báo động tồn >24h = "standing/stale"
  standingCountMax: 5,        // <5 standing alarms
  // Phân bố mục tiêu (fraction) — high (gồm critical) ~5%.
  distributionTarget: { low: 0.8, medium: 0.15, high: 0.05 } as const,
} as const;

// ─── Chuẩn hóa ưu tiên từ nguồn khác nhau về 4 mức ISA ────────────────────────

/** predictive_alerts.severity (LOW/MEDIUM/HIGH/CRITICAL) → AlarmPriority. */
export function normalizePredictiveSeverity(sev: string | null | undefined): AlarmPriority {
  switch (String(sev ?? "").toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "low";
  }
}

/** andon_events.state (green/yellow/red/call) → AlarmPriority (đèn Andon → mức báo động). */
export function normalizeAndonState(state: string | null | undefined): AlarmPriority {
  switch (String(state ?? "").toLowerCase()) {
    case "call": return "critical"; // gọi trợ giúp khẩn
    case "red": return "high";      // trạm lỗi / dừng
    case "yellow": return "medium"; // cảnh báo
    case "green":
    default: return "low";
  }
}

/** Gộp high+critical thành "high bucket" cho so sánh phân bố 80/15/5. */
export function priorityBucket(p: AlarmPriority): "low" | "medium" | "high" {
  return p === "critical" || p === "high" ? "high" : p;
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

export interface AlarmRate {
  count: number;
  windowHours: number;
  operatorCount: number;
  alarmsPerHour: number;
  alarmsPerHourPerOperator: number;
  /** 'ok' ≤ target, 'warning' ≤ max, 'critical' > max (ISA-18.2). */
  status: "ok" | "warning" | "critical";
}

/** Tần suất báo động: /giờ và /giờ/operator, xếp hạng theo ngưỡng ISA-18.2. */
export function computeAlarmRate(
  events: readonly AlarmEventLite[],
  windowMs: number,
  operatorCount: number,
): AlarmRate {
  const hours = Math.max(windowMs / 3600_000, 1e-9);
  const ops = Math.max(operatorCount, 1);
  const perHour = events.length / hours;
  const perHourPerOp = perHour / ops;
  const status: AlarmRate["status"] =
    perHourPerOp > ISA_182.ratePerOperatorMax ? "critical"
      : perHourPerOp > ISA_182.ratePerOperatorTarget ? "warning"
        : "ok";
  return {
    count: events.length,
    windowHours: windowMs / 3600_000,
    operatorCount: ops,
    alarmsPerHour: round2(perHour),
    alarmsPerHourPerOperator: round2(perHourPerOp),
    status,
  };
}

export interface FloodResult {
  /** Số báo động lớn nhất trong BẤT KỲ cửa sổ trượt 10 phút nào. */
  maxInWindow: number;
  /** Số cửa sổ (bucket rời) bị flood. */
  floodBucketCount: number;
  totalBuckets: number;
  /** % thời gian ở trạng thái flood (bucket flood / tổng bucket). */
  floodPercent: number;
  isFlooding: boolean;
  windowMinutes: number;
  threshold: number;
}

/**
 * Flood detection (ISA-18.2): >threshold báo động trong cửa sổ windowMs.
 *   • maxInWindow: quét cửa sổ TRƯỢT — với mỗi báo động, đếm số báo động trong
 *     [t, t+window). Đây là đỉnh thực (không phụ thuộc mốc bucket).
 *   • floodPercent: chia [min..max] thành bucket rời `windowMs`, đếm bucket flood.
 */
export function computeFlood(
  events: readonly AlarmEventLite[],
  windowMs = ISA_182.floodWindowMs,
  threshold = ISA_182.floodThreshold,
): FloodResult {
  const base: Omit<FloodResult, "maxInWindow" | "floodBucketCount" | "totalBuckets" | "floodPercent" | "isFlooding"> = {
    windowMinutes: windowMs / 60_000,
    threshold,
  };
  if (events.length === 0) {
    return { maxInWindow: 0, floodBucketCount: 0, totalBuckets: 0, floodPercent: 0, isFlooding: false, ...base };
  }
  const ts = events.map((e) => e.raisedAt).sort((a, b) => a - b);

  // Cửa sổ trượt: đỉnh số báo động trong [ts[i], ts[i]+window).
  let maxInWindow = 0;
  let j = 0;
  for (let i = 0; i < ts.length; i++) {
    if (j < i) j = i;
    while (j + 1 < ts.length && ts[j + 1] - ts[i] < windowMs) j++;
    maxInWindow = Math.max(maxInWindow, j - i + 1);
  }

  // Bucket rời để tính % thời gian flood.
  const first = ts[0];
  const last = ts[ts.length - 1];
  const totalBuckets = Math.max(1, Math.floor((last - first) / windowMs) + 1);
  const counts = new Array(totalBuckets).fill(0);
  for (const t of ts) {
    const b = Math.min(totalBuckets - 1, Math.floor((t - first) / windowMs));
    counts[b]++;
  }
  const floodBucketCount = counts.filter((c) => c > threshold).length;
  const floodPercent = round2((floodBucketCount / totalBuckets) * 100);
  return {
    maxInWindow,
    floodBucketCount,
    totalBuckets,
    floodPercent,
    isFlooding: maxInWindow > threshold,
    ...base,
  };
}

export interface StandingResult {
  count: number;
  thresholdHours: number;
  status: "ok" | "warning";
  /** Top báo động đứng yên lâu nhất (id + tuổi giờ). */
  worst: Array<{ id: string; title: string; ageHours: number; priority: AlarmPriority; actorLabel: string | null }>;
}

/**
 * Standing/stale alarms (ISA-18.2): báo động CHƯA resolve và đã tồn quá
 * standingThresholdMs. status='warning' khi count ≥ standingCountMax.
 */
export function computeStanding(
  events: readonly AlarmEventLite[],
  now: number,
  thresholdMs = ISA_182.standingThresholdMs,
): StandingResult {
  const standing = events
    .filter((e) => e.resolvedAt == null && now - e.raisedAt >= thresholdMs)
    .map((e) => ({
      id: e.id,
      title: e.title,
      ageHours: round2((now - e.raisedAt) / 3600_000),
      priority: e.priority,
      actorLabel: e.actorLabel,
    }))
    .sort((a, b) => b.ageHours - a.ageHours);
  return {
    count: standing.length,
    thresholdHours: thresholdMs / 3600_000,
    status: standing.length >= ISA_182.standingCountMax ? "warning" : "ok",
    worst: standing.slice(0, 10),
  };
}

export interface BadActor {
  actorKey: string;
  actorLabel: string;
  count: number;
  percent: number;
}

/** Top-N "bad actors": gom theo actorKey, đếm, sắp giảm dần (ISA-18.2 §mục tiêu). */
export function computeBadActors(events: readonly AlarmEventLite[], topN = 10): BadActor[] {
  const total = events.length || 1;
  const byKey = new Map<string, { label: string; count: number }>();
  for (const e of events) {
    const key = e.actorKey ?? "unknown";
    const label = e.actorLabel ?? "(không rõ)";
    const cur = byKey.get(key) ?? { label, count: 0 };
    cur.count++;
    byKey.set(key, cur);
  }
  return [...byKey.entries()]
    .map(([actorKey, v]) => ({ actorKey, actorLabel: v.label, count: v.count, percent: round2((v.count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export interface PriorityDistribution {
  counts: { low: number; medium: number; high: number };
  percent: { low: number; medium: number; high: number };
  total: number;
  target: { low: number; medium: number; high: number };
  /** True khi "high bucket" vượt xa mục tiêu (>2× target) → phân bố lệch xấu. */
  highOverTarget: boolean;
}

/** Phân bố ưu tiên (gộp high+critical), so với mục tiêu 80/15/5. */
export function computePriorityDistribution(events: readonly AlarmEventLite[]): PriorityDistribution {
  const counts = { low: 0, medium: 0, high: 0 };
  for (const e of events) counts[priorityBucket(e.priority)]++;
  const total = events.length;
  const pct = (n: number) => (total > 0 ? round2((n / total) * 100) : 0);
  const target = {
    low: ISA_182.distributionTarget.low * 100,
    medium: ISA_182.distributionTarget.medium * 100,
    high: ISA_182.distributionTarget.high * 100,
  };
  return {
    counts,
    percent: { low: pct(counts.low), medium: pct(counts.medium), high: pct(counts.high) },
    total,
    target,
    highOverTarget: total > 0 && pct(counts.high) > target.high * 2,
  };
}

export interface AlarmKpiSummary {
  windowMs: number;
  now: number;
  operatorCount: number;
  totalAlarms: number;
  rate: AlarmRate;
  flood: FloodResult;
  standing: StandingResult;
  badActors: BadActor[];
  distribution: PriorityDistribution;
  /** Cờ vi phạm tổng hợp (để hiển thị cảnh báo trực quan). */
  breaches: string[];
}

/** Tổng hợp toàn bộ KPI ISA-18.2 cho một tập báo động trong cửa sổ. */
export function summarizeAlarmKpi(
  events: readonly AlarmEventLite[],
  opts: { windowMs: number; now: number; operatorCount: number },
): AlarmKpiSummary {
  const rate = computeAlarmRate(events, opts.windowMs, opts.operatorCount);
  const flood = computeFlood(events);
  const standing = computeStanding(events, opts.now);
  const badActors = computeBadActors(events);
  const distribution = computePriorityDistribution(events);

  const breaches: string[] = [];
  if (rate.status !== "ok") breaches.push("rate");
  if (flood.isFlooding) breaches.push("flood");
  if (standing.status !== "ok") breaches.push("standing");
  if (distribution.highOverTarget) breaches.push("distribution");

  return {
    windowMs: opts.windowMs,
    now: opts.now,
    operatorCount: opts.operatorCount,
    totalAlarms: events.length,
    rate,
    flood,
    standing,
    badActors,
    distribution,
    breaches,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
