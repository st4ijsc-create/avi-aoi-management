/**
 * doc 24 Wave-4 · T5 — DISCRETE-EVENT THROUGHPUT SIMULATION ENGINE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A PURE, DETERMINISTIC discrete-event simulator (DES) for a manufacturing line:
 * parts/jobs (entities) flow through an ordered list of STATIONS; each station has
 * a QUEUE/BUFFER + one or more parallel RESOURCES (machines/operators) of a given
 * CAPACITY; processing times are STOCHASTIC (seeded distributions) and each station
 * has a YIELD (good/scrap/rework). The engine advances a virtual clock over an
 * EVENT QUEUE (min-heap keyed by time, deterministic tie-break by insertion seq)
 * and collects throughput, per-station utilization, queue lengths, the bottleneck,
 * WIP and a cycle-time distribution.
 *
 * WHY IT REPLACES AD-HOC RULES: pages like RfTestCellSim hard-code a "1 defect every
 * 8 DUTs" rule and cannot answer capacity/staffing what-if. This engine models the
 * real queueing + resource contention so a planner can ask "add a station / change a
 * rate / change yield → what happens to throughput and the bottleneck".
 *
 * ABSOLUTE PROPERTIES (non-negotiable):
 *   • PURE: no DB, no network, no dispatch, no side-effects. Import-free of app code.
 *   • DETERMINISTIC: a VIRTUAL clock starting at 0 (no Date.now) + a SEEDED PRNG
 *     (mulberry32). NO Math.random anywhere. Same seed → byte-identical result.
 *   • FAIL-SAFE / DEGRADE-SAFE: never throws. An empty/degenerate model returns a
 *     `{ ok:false, degraded:true, notes:[…] }` result, not an exception.
 *
 * The classic analytic anchor the engine reproduces EXACTLY (deterministic times,
 * single-capacity serial stations, unlimited buffers, all N parts released at t=0):
 *     makespan = Σ tᵢ + (N − 1)·max(tᵢ)          [permutation flow-shop makespan]
 *     steady-state throughput → 1 / max(tᵢ/capᵢ)  [the bottleneck rate]
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── Seeded PRNG (mulberry32 — small, fast, deterministic) ─────────────────────────

/** A deterministic pseudo-random stream. NEVER uses Math.random. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Exponential with the given mean (mean = 1/rate). */
  exponential(mean: number): number;
  /** Normal(mean, std) via Box–Muller (cached spare), never returns < `floor`. */
  normal(mean: number, std: number, floor?: number): number;
  /** Symmetric triangular on [mean·(1−spread), mean·(1+spread)] with mode mean. */
  triangular(mean: number, spread: number): number;
  /** True with probability p (a Bernoulli trial). */
  bernoulli(p: number): boolean;
}

/** Build a mulberry32-backed Rng from a 32-bit seed. */
export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 1;
  let spare: number | null = null; // cached Box–Muller normal
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    exponential(mean: number): number {
      const m = mean > 0 ? mean : 0;
      // -mean * ln(1-u); guard u→1 so we never take ln(0).
      const u = 1 - next();
      return -m * Math.log(u <= 0 ? Number.MIN_VALUE : u);
    },
    normal(mean: number, std: number, floor = 0): number {
      if (spare !== null) {
        const z = spare;
        spare = null;
        return Math.max(floor, mean + std * z);
      }
      // Box–Muller: two uniforms → two independent standard normals.
      let u1 = next();
      const u2 = next();
      if (u1 <= 0) u1 = Number.MIN_VALUE;
      const r = Math.sqrt(-2 * Math.log(u1));
      const z0 = r * Math.cos(2 * Math.PI * u2);
      const z1 = r * Math.sin(2 * Math.PI * u2);
      spare = z1;
      return Math.max(floor, mean + std * z0);
    },
    triangular(mean: number, spread: number): number {
      const s = Math.min(Math.max(spread, 0), 0.999);
      const low = mean * (1 - s);
      const high = mean * (1 + s);
      const mode = mean;
      const u = next();
      const fc = high > low ? (mode - low) / (high - low) : 0.5;
      if (u < fc) return low + Math.sqrt(u * (high - low) * (mode - low));
      return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
    },
    bernoulli(p: number): boolean {
      return next() < p;
    },
  };
}

// ── Model types (the sim model — built from topology + routings by desModel.ts) ───

/** A processing-time distribution for a station. */
export type ProcessDist = "deterministic" | "exponential" | "normal" | "triangular";

/** What to do with a part that FAILS a station's yield check. */
export type OnFail = "scrap" | "rework";

/** ONE station: a queue/buffer + `capacity` parallel resources + stochastic service + yield. */
export interface StationSpec {
  /** Stable id (e.g. a station code or `station:5`). */
  id: string;
  /** Human label. */
  name?: string;
  /** Parallel resource units (machines/operators). Coerced to ≥ 1. */
  capacity: number;
  /** Mean processing time PER PART, in seconds (> 0). */
  processTimeSec: number;
  /** Service-time distribution (default "deterministic"). */
  processDist?: ProcessDist;
  /** Coefficient of variation (std = mean·cv for normal; spread for triangular). */
  processCV?: number;
  /** Probability a part is GOOD at this station (0..1, default 1). */
  yield?: number;
  /** Disposition of a failed part (default "scrap"). */
  onFail?: OnFail;
  /** Max rework attempts before a failed part is scrapped (default 1). */
  maxRework?: number;
  /** Input-buffer capacity (max queue length). Omit/Infinity → unbounded (no blocking). */
  bufferCapacity?: number;
}

/** How parts enter the line. */
export type SourceSpec =
  | { kind: "batch"; count: number } // release `count` parts at t=0 (measures line capacity)
  | { kind: "interarrival"; meanSec: number; dist?: ProcessDist; cv?: number; count?: number };

/** The full sim model: an ordered serial routing of stations + a source. */
export interface LineModel {
  id: string;
  name?: string;
  /** Ordered process routing (stations[0] is the first operation). */
  stations: StationSpec[];
  source: SourceSpec;
}

/** Tunable run knobs (all optional; deterministic defaults). */
export interface SimConfig {
  /** PRNG seed (default 0x5eed). */
  seed?: number;
  /** Stop time (s) for interarrival/saturated runs. Ignored by pure `batch` runs. */
  horizonSec?: number;
  /** Warm-up (s) excluded from time-weighted stats (default 0). */
  warmupSec?: number;
  /** Safety cap on processed events (default 2,000,000) — guards pathological loops. */
  maxEvents?: number;
}

// ── Result types ──────────────────────────────────────────────────────────────────

/** Per-station collected statistics. */
export interface StationStat {
  id: string;
  name: string;
  capacity: number;
  /** Fraction of resource-time busy over the observed window (0..1). */
  utilization: number;
  /** Time-average input-queue length over the observed window. */
  avgQueueLen: number;
  /** Peak input-queue length observed. */
  maxQueueLen: number;
  /** Parts that started service here. */
  started: number;
  /** Parts that finished service here (any disposition). */
  processed: number;
  /** Parts scrapped at this station. */
  scrapped: number;
  /** Rework passes performed at this station. */
  reworked: number;
  /** Blocking-time integral (s·servers) when a finished part could not move downstream. */
  blockedTime: number;
}

/** Cycle-time (flow-time) distribution across completed good parts. */
export interface CycleTimeStat {
  count: number;
  meanSec: number;
  p50Sec: number;
  p95Sec: number;
  minSec: number;
  maxSec: number;
  /** Coarse histogram buckets [fromSec, toSec, count]. */
  histogram: Array<{ fromSec: number; toSec: number; count: number }>;
}

/** The full DES result. */
export interface DesResult {
  ok: boolean;
  /** True when the model was empty/degenerate and results are best-effort. */
  degraded: boolean;
  /** Human-facing assumptions / degradation notes (honest reporting). */
  notes: string[];
  seed: number;
  /** Observed window length (s) over which rates/utilization are computed. */
  observedSec: number;
  /** Wall-clock span of the run (s) — for a batch run this is the makespan. */
  makespanSec: number;
  /** Parts released into the system. */
  released: number;
  /** GOOD parts completed (passed the final station). */
  goodCompleted: number;
  /** Parts scrapped anywhere. */
  scrapped: number;
  /** Total rework passes across all stations. */
  reworked: number;
  /** Good throughput (good parts / hour) over the observed window. */
  throughputPerHour: number;
  /** Total exits (good + scrap) per hour — the raw processing rate. */
  totalExitsPerHour: number;
  /** Time-average parts-in-system (WIP). */
  wipAvg: number;
  /** Per-station statistics (routing order). */
  stations: StationStat[];
  /** Station id with the highest utilization (the bottleneck), or null if none. */
  bottleneckStationId: string | null;
  /** The bottleneck's analytic effective service time (processTime/capacity), seconds. */
  bottleneckEffServiceSec: number | null;
  /** Cycle-time distribution of completed good parts. */
  cycleTime: CycleTimeStat;
}

// ── Internal simulation state ──────────────────────────────────────────────────────

interface Part {
  id: number;
  /** System-entry time (release into station 0). */
  enteredAt: number;
  /** Per-station rework counter (index → count). */
  rework: number[];
}

type EventKind = "arrival" | "endService";

interface SimEvent {
  time: number;
  seq: number; // deterministic tie-break (FIFO among equal times)
  kind: EventKind;
  part: Part;
  /** For "arrival" events with interarrival source: schedule the next arrival too. */
  stationIdx: number;
}

/** Runtime station state. */
interface StationRT {
  spec: Required<Omit<StationSpec, "name" | "processDist" | "onFail">> & {
    name: string;
    processDist: ProcessDist;
    onFail: OnFail;
  };
  queue: Part[]; // input buffer (FIFO)
  busy: number; // occupied servers (incl. finished-but-blocked)
  /** Parts finished here but blocked from moving downstream (still hold a server). */
  blockedOut: Array<{ part: Part; destIdx: number }>;
  // Time-weighted accumulators.
  busyIntegral: number; // Σ busy · Δt
  queueIntegral: number; // Σ queueLen · Δt
  blockedIntegral: number; // Σ blockedCount · Δt
  maxQueueLen: number;
  started: number;
  processed: number;
  scrapped: number;
  reworked: number;
}

const DEST_COMPLETE = -1; // pass through the final station → completed good
const DEST_SCRAP = -2; // scrapped (leaves the system)

// ── Min-heap event queue (deterministic) ────────────────────────────────────────────

class EventHeap {
  private a: SimEvent[] = [];
  get size(): number {
    return this.a.length;
  }
  push(e: SimEvent): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): SimEvent | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as SimEvent;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && less(a[l], a[m])) m = l;
        if (r < n && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Order events by time, then by insertion sequence (stable, deterministic). */
function less(x: SimEvent, y: SimEvent): boolean {
  if (x.time !== y.time) return x.time < y.time;
  return x.seq < y.seq;
}

// ── Model normalization (degrade-safe coercion + notes) ─────────────────────────────

function normalizeStation(s: StationSpec, idx: number, notes: string[]): StationRT["spec"] {
  const name = s.name ?? s.id ?? `station-${idx}`;
  let capacity = Math.floor(s.capacity);
  if (!Number.isFinite(capacity) || capacity < 1) {
    notes.push(`Station "${name}" capacity ${s.capacity} coerced to 1.`);
    capacity = 1;
  }
  let processTimeSec = Number(s.processTimeSec);
  if (!Number.isFinite(processTimeSec) || processTimeSec <= 0) {
    notes.push(`Station "${name}" processTimeSec ${s.processTimeSec} coerced to 0.001s.`);
    processTimeSec = 0.001;
  }
  let yieldP = s.yield === undefined ? 1 : Number(s.yield);
  if (!Number.isFinite(yieldP) || yieldP < 0 || yieldP > 1) {
    notes.push(`Station "${name}" yield ${s.yield} clamped to [0,1].`);
    yieldP = Math.min(1, Math.max(0, Number.isFinite(yieldP) ? yieldP : 1));
  }
  let cv = s.processCV === undefined ? 0 : Number(s.processCV);
  if (!Number.isFinite(cv) || cv < 0) cv = 0;
  const buffer =
    s.bufferCapacity === undefined || !Number.isFinite(s.bufferCapacity)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(s.bufferCapacity));
  let maxRework = s.maxRework === undefined ? 1 : Math.floor(s.maxRework);
  if (!Number.isFinite(maxRework) || maxRework < 0) maxRework = 1;
  return {
    id: s.id,
    name,
    capacity,
    processTimeSec,
    processDist: s.processDist ?? "deterministic",
    processCV: cv,
    yield: yieldP,
    onFail: s.onFail ?? "scrap",
    maxRework,
    bufferCapacity: buffer,
  };
}

// ── Core engine ──────────────────────────────────────────────────────────────────

/**
 * Run the discrete-event simulation. PURE + DETERMINISTIC + DEGRADE-SAFE.
 * Returns collected KPIs; never throws.
 */
export function runDes(model: LineModel, config: SimConfig = {}): DesResult {
  const notes: string[] = [];
  const seed = Number.isFinite(config.seed) ? (config.seed as number) : 0x5eed;
  const warmup = Math.max(0, Number(config.warmupSec) || 0);
  const maxEvents = Number.isFinite(config.maxEvents) ? (config.maxEvents as number) : 2_000_000;

  const emptyResult = (extraNote: string): DesResult => {
    notes.push(extraNote);
    return {
      ok: false,
      degraded: true,
      notes,
      seed,
      observedSec: 0,
      makespanSec: 0,
      released: 0,
      goodCompleted: 0,
      scrapped: 0,
      reworked: 0,
      throughputPerHour: 0,
      totalExitsPerHour: 0,
      wipAvg: 0,
      stations: [],
      bottleneckStationId: null,
      bottleneckEffServiceSec: null,
      cycleTime: { count: 0, meanSec: 0, p50Sec: 0, p95Sec: 0, minSec: 0, maxSec: 0, histogram: [] },
    };
  };

  if (!model || !Array.isArray(model.stations) || model.stations.length === 0) {
    return emptyResult("Model has no stations — nothing to simulate (degraded).");
  }

  const rng = makeRng(seed);
  const rt: StationRT[] = model.stations.map((s, i) => ({
    spec: normalizeStation(s, i, notes),
    queue: [],
    busy: 0,
    blockedOut: [],
    busyIntegral: 0,
    queueIntegral: 0,
    blockedIntegral: 0,
    maxQueueLen: 0,
    started: 0,
    processed: 0,
    scrapped: 0,
    reworked: 0,
  }));
  const nStations = rt.length;

  const heap = new EventHeap();
  let seq = 0;
  const push = (time: number, kind: EventKind, part: Part, stationIdx: number): void => {
    heap.push({ time, seq: seq++, kind, part, stationIdx });
  };

  // Source: parts waiting to enter station 0 (unbounded pre-line supply).
  const sourceQueue: Part[] = [];
  let partSeq = 0;
  const mkPart = (enteredAt: number): Part => ({
    id: partSeq++,
    enteredAt,
    rework: new Array<number>(nStations).fill(0),
  });

  // Time-weighted stats bookkeeping.
  let clock = 0;
  let lastStatTime = 0;
  let wip = 0; // parts currently in the system (released, not yet exited)
  let wipIntegral = 0;
  let released = 0;
  let goodCompleted = 0;
  let scrapped = 0;
  let reworked = 0;
  const cycleTimes: number[] = [];

  /** Fold time-weighted areas up to `now` (clamped to exclude the warm-up window). */
  const accumulate = (now: number): void => {
    const from = Math.max(lastStatTime, warmup);
    const to = Math.max(now, warmup);
    const dt = to - from;
    if (dt > 0) {
      wipIntegral += wip * dt;
      for (const st of rt) {
        st.busyIntegral += st.busy * dt;
        st.queueIntegral += st.queue.length * dt;
        st.blockedIntegral += st.blockedOut.length * dt;
      }
    }
    lastStatTime = now;
  };

  const sampleService = (st: StationRT): number => {
    const { processTimeSec: m, processCV: cv, processDist } = st.spec;
    switch (processDist) {
      case "exponential":
        return rng.exponential(m);
      case "normal":
        return rng.normal(m, m * cv, m * 0.01);
      case "triangular":
        return rng.triangular(m, cv);
      case "deterministic":
      default:
        return m;
    }
  };

  /** Determine where a finished part goes after station `idx`. */
  const dispositionAfter = (st: StationRT, idx: number, part: Part): number => {
    const good = st.spec.yield >= 1 ? true : rng.bernoulli(st.spec.yield);
    if (good) {
      return idx + 1 >= nStations ? DEST_COMPLETE : idx + 1;
    }
    // failed
    if (st.spec.onFail === "rework" && part.rework[idx] < st.spec.maxRework) {
      part.rework[idx] += 1;
      st.reworked += 1;
      reworked += 1;
      return idx; // reprocess at the same station
    }
    return DEST_SCRAP;
  };

  /**
   * Fixed-point relaxation at time `now`: (1) push blocked-out parts into any
   * downstream buffer that now has space; (2) start service wherever a server is
   * free and its input queue is non-empty; (3) feed the source into station 0.
   * Repeats until no change. Deterministic: stations iterate in index order,
   * source last; sampling happens only at (2) in a fixed order.
   */
  const settle = (now: number): void => {
    let changed = true;
    let guard = 0;
    const guardMax = 200_000 + partSeq * 8;
    while (changed && guard++ < guardMax) {
      changed = false;

      // (1) Move blocked-out parts downstream if a buffer slot opened.
      for (let i = 0; i < nStations; i++) {
        const st = rt[i];
        if (st.blockedOut.length === 0) continue;
        for (let k = 0; k < st.blockedOut.length; ) {
          const { part, destIdx } = st.blockedOut[k];
          const dst = rt[destIdx];
          if (dst.queue.length < dst.spec.bufferCapacity) {
            st.blockedOut.splice(k, 1);
            st.busy -= 1; // the blocked server is finally released
            dst.queue.push(part);
            if (dst.queue.length > dst.maxQueueLen) dst.maxQueueLen = dst.queue.length;
            changed = true;
          } else {
            k++;
          }
        }
      }

      // (2) Start service where capacity is free.
      for (let i = 0; i < nStations; i++) {
        const st = rt[i];
        while (st.busy < st.spec.capacity && st.queue.length > 0) {
          const part = st.queue.shift() as Part;
          st.busy += 1;
          st.started += 1;
          const dur = sampleService(st);
          push(now + Math.max(0, dur), "endService", part, i);
          changed = true;
        }
      }

      // (3) Feed the source into station 0 while its buffer has room.
      const s0 = rt[0];
      while (sourceQueue.length > 0 && s0.queue.length < s0.spec.bufferCapacity) {
        const part = sourceQueue.shift() as Part;
        part.enteredAt = now;
        released += 1;
        wip += 1;
        s0.queue.push(part);
        if (s0.queue.length > s0.maxQueueLen) s0.maxQueueLen = s0.queue.length;
        changed = true;
      }
    }
    if (guard >= guardMax) {
      notes.push("Settle relaxation hit its iteration guard — result may be truncated (degraded).");
    }
  };

  // ── Seed the source ──────────────────────────────────────────────────────────────
  let horizon = Number.isFinite(config.horizonSec) ? (config.horizonSec as number) : Number.POSITIVE_INFINITY;
  const src = model.source;
  if (src.kind === "batch") {
    const n = Math.max(0, Math.floor(src.count));
    if (n === 0) notes.push("Batch source count is 0 — no parts released (degraded).");
    for (let i = 0; i < n; i++) sourceQueue.push(mkPart(0));
    settle(0);
  } else {
    // interarrival: schedule the first arrival; each arrival enqueues one part + schedules the next.
    const meanSec = src.meanSec > 0 ? src.meanSec : 1;
    if (!Number.isFinite(horizon)) {
      // A pull source with no horizon would run forever — impose a safe default.
      horizon = meanSec * 1000;
      notes.push(`Interarrival source without horizonSec — defaulting horizon to ${horizon}s (degraded).`);
    }
    const firstPart = mkPart(0);
    push(0, "arrival", firstPart, 0);
  }

  // ── Event loop ────────────────────────────────────────────────────────────────────
  let processedEvents = 0;
  let arrivalsRemaining =
    src.kind === "interarrival" && src.count !== undefined ? Math.max(0, Math.floor(src.count)) : Infinity;

  for (;;) {
    const ev = heap.pop();
    if (!ev) break;
    if (Number.isFinite(horizon) && ev.time > horizon) break;
    if (++processedEvents > maxEvents) {
      notes.push(`Event budget (${maxEvents}) exhausted — result truncated (degraded).`);
      break;
    }
    accumulate(ev.time);
    clock = ev.time;

    if (ev.kind === "arrival") {
      // interarrival source: enqueue this part, then schedule the next arrival.
      sourceQueue.push(ev.part);
      arrivalsRemaining -= 1;
      if (src.kind === "interarrival" && arrivalsRemaining > 0) {
        const dist = src.dist ?? "exponential";
        const cv = src.cv ?? 1;
        let gap: number;
        switch (dist) {
          case "deterministic":
            gap = src.meanSec;
            break;
          case "normal":
            gap = rng.normal(src.meanSec, src.meanSec * cv, 0);
            break;
          case "triangular":
            gap = rng.triangular(src.meanSec, cv);
            break;
          case "exponential":
          default:
            gap = rng.exponential(src.meanSec);
            break;
        }
        const nextT = ev.time + Math.max(0, gap);
        if (!Number.isFinite(horizon) || nextT <= horizon) {
          push(nextT, "arrival", mkPart(nextT), 0);
        }
      }
      settle(ev.time);
      continue;
    }

    // endService at station idx.
    const idx = ev.stationIdx;
    const st = rt[idx];
    st.processed += 1;
    const dest = dispositionAfter(st, idx, ev.part);

    if (dest === DEST_COMPLETE) {
      st.busy -= 1;
      wip -= 1;
      goodCompleted += 1;
      cycleTimes.push(ev.time - ev.part.enteredAt);
    } else if (dest === DEST_SCRAP) {
      st.busy -= 1;
      wip -= 1;
      scrapped += 1;
      st.scrapped += 1;
    } else {
      // Move to destination station `dest` if its buffer has room, else block the server.
      const dst = rt[dest];
      if (dst.queue.length < dst.spec.bufferCapacity) {
        st.busy -= 1;
        dst.queue.push(ev.part);
        if (dst.queue.length > dst.maxQueueLen) dst.maxQueueLen = dst.queue.length;
      } else {
        st.blockedOut.push({ part: ev.part, destIdx: dest }); // server stays occupied (blocked)
      }
    }
    settle(ev.time);
  }

  // Final fold to the end of the observed window.
  const endTime = Number.isFinite(horizon) ? Math.min(horizon, Math.max(clock, warmup)) : clock;
  accumulate(endTime);

  const observedSec = Math.max(0, endTime - warmup);
  const makespanSec = clock;

  // Per-station stats.
  const stations: StationStat[] = rt.map((st) => ({
    id: st.spec.id,
    name: st.spec.name,
    capacity: st.spec.capacity,
    utilization: observedSec > 0 ? Math.min(1, st.busyIntegral / (st.spec.capacity * observedSec)) : 0,
    avgQueueLen: observedSec > 0 ? st.queueIntegral / observedSec : 0,
    maxQueueLen: st.maxQueueLen,
    started: st.started,
    processed: st.processed,
    scrapped: st.scrapped,
    reworked: st.reworked,
    blockedTime: st.blockedIntegral,
  }));

  // Bottleneck = highest utilization; tie → highest analytic effective service time.
  let bottleneckStationId: string | null = null;
  let bottleneckEffServiceSec: number | null = null;
  let bestUtil = -1;
  let bestEff = -1;
  for (const st of rt) {
    const eff = st.spec.processTimeSec / st.spec.capacity;
    const util = observedSec > 0 ? st.busyIntegral / (st.spec.capacity * observedSec) : 0;
    if (util > bestUtil + 1e-9 || (Math.abs(util - bestUtil) <= 1e-9 && eff > bestEff)) {
      bestUtil = util;
      bestEff = eff;
      bottleneckStationId = st.spec.id;
      bottleneckEffServiceSec = eff;
    }
  }

  const throughputPerHour = observedSec > 0 ? (goodCompleted / observedSec) * 3600 : 0;
  const totalExitsPerHour = observedSec > 0 ? ((goodCompleted + scrapped) / observedSec) * 3600 : 0;
  const wipAvg = observedSec > 0 ? wipIntegral / observedSec : 0;

  return {
    ok: true,
    degraded: notes.length > 0,
    notes,
    seed,
    observedSec,
    makespanSec,
    released,
    goodCompleted,
    scrapped,
    reworked,
    throughputPerHour,
    totalExitsPerHour,
    wipAvg,
    stations,
    bottleneckStationId,
    bottleneckEffServiceSec,
    cycleTime: summarizeCycleTimes(cycleTimes),
  };
}

// ── Cycle-time distribution summary ─────────────────────────────────────────────────

function summarizeCycleTimes(values: number[]): CycleTimeStat {
  const n = values.length;
  if (n === 0) {
    return { count: 0, meanSec: 0, p50Sec: 0, p95Sec: 0, minSec: 0, maxSec: 0, histogram: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const q = (p: number): number => {
    const i = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))));
    return sorted[i];
  };
  const min = sorted[0];
  const max = sorted[n - 1];
  // Coarse fixed-bucket histogram (8 buckets across [min, max]).
  const buckets = 8;
  const span = max - min || 1;
  const width = span / buckets;
  const hist: Array<{ fromSec: number; toSec: number; count: number }> = [];
  for (let b = 0; b < buckets; b++) {
    hist.push({ fromSec: min + b * width, toSec: min + (b + 1) * width, count: 0 });
  }
  for (const v of sorted) {
    let b = Math.floor((v - min) / width);
    if (b < 0) b = 0;
    if (b >= buckets) b = buckets - 1;
    hist[b].count += 1;
  }
  return {
    count: n,
    meanSec: sum / n,
    p50Sec: q(0.5),
    p95Sec: q(0.95),
    minSec: min,
    maxSec: max,
    histogram: hist,
  };
}
