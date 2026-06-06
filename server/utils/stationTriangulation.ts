/**
 * P4.C G15 — Station triangulation analytics.
 *
 * Cross-station correlation across SPI / AOI_PRE / REFLOW / AOI_POST /
 * AXI / ICT / FCT. Used to:
 *  - Build per-serial trace (what stations a unit visited, in order)
 *  - Detect "escape" stations (NG downstream after OK upstream)
 *  - Compute Pearson correlation across stations sharing a lot
 *  - Attribute first-defect station per serial
 *
 * Pure functions: callers pass already-fetched samples / inspection rows.
 */

export type SampleRow = {
  serialNumber: string | null;
  stationCode: string | null;
  isOk: boolean | null;
  value: number | string | null;
  sampledAt: Date;
  pointDefId?: number;
  lotCode?: string | null;
};

export type TraceSummary = {
  serialNumber: string;
  stationsTouched: string[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstDefectStation: string | null;
  firstEscapeStation: string | null;
  totalDefects: number;
  totalEscapes: number;
  perStation: Record<
    string,
    { ok: number; ng: number; firstAt: Date | null; lastAt: Date | null }
  >;
};

/** Standard SMT line ordering used for "downstream" detection. */
export const STATION_ORDER = [
  "SPI",
  "AOI_PRE",
  "REFLOW",
  "AOI_POST",
  "AXI",
  "ICT",
  "FCT",
] as const;

function stationRank(code: string | null): number {
  if (!code) return 999;
  const i = (STATION_ORDER as readonly string[]).indexOf(code);
  return i === -1 ? 999 : i;
}

/** Build a trace summary for one serial from its sample rows. */
export function summariseSerial(serialNumber: string, samples: SampleRow[]): TraceSummary {
  const sorted = [...samples].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  const perStation: TraceSummary["perStation"] = {};
  const visitedOrder: string[] = [];

  let firstDefectStation: string | null = null;
  let totalDefects = 0;

  for (const s of sorted) {
    const code = s.stationCode ?? "UNKNOWN";
    if (!perStation[code]) {
      perStation[code] = { ok: 0, ng: 0, firstAt: null, lastAt: null };
      visitedOrder.push(code);
    }
    const bucket = perStation[code];
    if (s.isOk === false) {
      bucket.ng += 1;
      totalDefects += 1;
      if (firstDefectStation === null) firstDefectStation = code;
    } else if (s.isOk === true) {
      bucket.ok += 1;
    }
    if (!bucket.firstAt || s.sampledAt < bucket.firstAt) bucket.firstAt = s.sampledAt;
    if (!bucket.lastAt || s.sampledAt > bucket.lastAt) bucket.lastAt = s.sampledAt;
  }

  // Escape detection: an upstream station was OK overall, but a strictly
  // downstream station was NG. Earliest such downstream station is the escape.
  let firstEscapeStation: string | null = null;
  let totalEscapes = 0;
  const visitedRanked = visitedOrder
    .map((code) => ({ code, rank: stationRank(code) }))
    .sort((a, b) => a.rank - b.rank);

  for (let i = 0; i < visitedRanked.length; i++) {
    const downstream = visitedRanked[i];
    const dBucket = perStation[downstream.code];
    if (!dBucket || dBucket.ng === 0) continue;
    // Look upstream for any OK without prior NG
    const upstreamOk = visitedRanked
      .slice(0, i)
      .some((u) => {
        const ub = perStation[u.code];
        return ub && ub.ok > 0 && ub.ng === 0;
      });
    if (upstreamOk) {
      totalEscapes += dBucket.ng;
      if (firstEscapeStation === null) firstEscapeStation = downstream.code;
    }
  }

  return {
    serialNumber,
    stationsTouched: visitedRanked.map((v) => v.code),
    firstSeenAt: sorted.length ? sorted[0].sampledAt : null,
    lastSeenAt: sorted.length ? sorted[sorted.length - 1].sampledAt : null,
    firstDefectStation,
    firstEscapeStation,
    totalDefects,
    totalEscapes,
    perStation,
  };
}

/** Group sample rows by serialNumber and summarise each. */
export function summariseLot(samples: SampleRow[]): TraceSummary[] {
  const bySerial = new Map<string, SampleRow[]>();
  for (const s of samples) {
    if (!s.serialNumber) continue;
    const arr = bySerial.get(s.serialNumber) ?? [];
    arr.push(s);
    bySerial.set(s.serialNumber, arr);
  }
  return Array.from(bySerial.entries()).map(([sn, rows]) => summariseSerial(sn, rows));
}

/** Pearson correlation of two equal-length numeric arrays. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]; const y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return 0;
  return num / den;
}

/**
 * Build a station-by-station NG-rate correlation matrix for a lot.
 *
 * For each serial, compute NG rate per station (ng / (ok+ng)).
 * Then pearson-correlate vectors across serials.
 */
export function stationCorrelationMatrix(traces: TraceSummary[]): {
  stations: string[];
  matrix: number[][];
} {
  const stationSet = new Set<string>();
  for (const t of traces) for (const s of t.stationsTouched) stationSet.add(s);
  const stations = Array.from(stationSet).sort(
    (a, b) => stationRank(a) - stationRank(b),
  );

  // Build vectors: stations[k] -> array of NG-rate per serial
  const vecs: Record<string, number[]> = {};
  for (const st of stations) vecs[st] = [];
  for (const t of traces) {
    for (const st of stations) {
      const b = t.perStation[st];
      const total = b ? b.ok + b.ng : 0;
      vecs[st].push(total > 0 ? b!.ng / total : 0);
    }
  }
  const matrix: number[][] = stations.map((a) =>
    stations.map((b) => (a === b ? 1 : pearson(vecs[a], vecs[b]))),
  );
  return { stations, matrix };
}

/** Aggregate escape counts per station across many traces. */
export function escapeAttribution(traces: TraceSummary[]): Array<{
  station: string;
  escapes: number;
  defects: number;
  escapeRate: number;
}> {
  const map = new Map<string, { escapes: number; defects: number }>();
  for (const t of traces) {
    if (t.firstEscapeStation) {
      const cur = map.get(t.firstEscapeStation) ?? { escapes: 0, defects: 0 };
      cur.escapes += 1;
      map.set(t.firstEscapeStation, cur);
    }
    if (t.firstDefectStation) {
      const cur = map.get(t.firstDefectStation) ?? { escapes: 0, defects: 0 };
      cur.defects += 1;
      map.set(t.firstDefectStation, cur);
    }
  }
  return Array.from(map.entries())
    .map(([station, v]) => ({
      station,
      escapes: v.escapes,
      defects: v.defects,
      escapeRate: v.defects + v.escapes > 0 ? v.escapes / (v.defects + v.escapes) : 0,
    }))
    .sort((a, b) => b.escapes - a.escapes);
}
