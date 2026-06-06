/**
 * P4.C G13 — Monte-Carlo defect propagation Sankey.
 *
 * Models the SMT line as a Markov-style chain over STATION_ORDER. For each
 * station we have a per-station defect rate and a detection rate; defects that
 * escape upstream may be caught at downstream stations or escape entirely.
 *
 * Pure functions only; deterministic given the seed.
 */
import { STATION_ORDER } from "./stationTriangulation";

export interface StationParams {
  station: string;
  /** Probability a unit becomes defective at this station (0..1). */
  injectRate: number;
  /** Probability an existing defect is detected at this station (0..1). */
  detectRate: number;
  /** Probability a detected defect is reworked back to OK (0..1). Default 0.8. */
  reworkRate?: number;
}

export interface SankeyNode {
  id: string;
  label: string;
}
export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}
export interface SankeyResult {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totals: {
    units: number;
    shipped: number;
    scrapped: number;
    reworked: number;
    escapes: number;
  };
}

/** Mulberry32 — small, fast, seedable PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run a Monte-Carlo simulation of N units flowing through the line.
 * Returns a Sankey graph showing OK / DEFECT / REWORK / SCRAP flows
 * between consecutive stations plus terminal SHIP / ESCAPE nodes.
 */
export function simulateLine(opts: {
  units: number;
  params: StationParams[];
  seed?: number;
  /** If a defect is detected, fraction NOT reworked goes to scrap. */
  defaultReworkRate?: number;
  /** Override station order; defaults to STATION_ORDER. */
  stations?: readonly string[];
}): SankeyResult {
  const stations = opts.stations ?? STATION_ORDER;
  const units = Math.max(0, Math.floor(opts.units));
  const rand = mulberry32(opts.seed ?? 0xC0FFEE);
  const defaultRework = opts.defaultReworkRate ?? 0.8;

  // Build a param lookup with safe defaults for missing stations.
  const paramFor = new Map<string, StationParams>();
  for (const p of opts.params) paramFor.set(p.station, p);
  function get(station: string): StationParams {
    return paramFor.get(station) ?? {
      station,
      injectRate: 0,
      detectRate: 0,
      reworkRate: defaultRework,
    };
  }

  // Edge accumulator — keyed by `${src}->${tgt}` for stable aggregation.
  const edges = new Map<string, number>();
  function addEdge(src: string, tgt: string, n = 1) {
    if (n <= 0) return;
    const k = `${src}->${tgt}`;
    edges.set(k, (edges.get(k) ?? 0) + n);
  }

  let shipped = 0;
  let scrapped = 0;
  let reworked = 0;
  let escapes = 0;

  for (let i = 0; i < units; i++) {
    let isDefective = false;
    let prevNode: string | null = null;
    let alive = true;

    for (let s = 0; s < stations.length; s++) {
      const station = stations[s];
      const p = get(station);
      const okNode = `${station}:OK`;
      const defNode = `${station}:DEFECT`;

      // Inject new defect?
      if (!isDefective && rand() < p.injectRate) isDefective = true;
      const node = isDefective ? defNode : okNode;

      // Flow into this station
      if (prevNode === null) {
        addEdge("START", node);
      } else {
        addEdge(prevNode, node);
      }

      // Detection?
      if (isDefective && rand() < p.detectRate) {
        const reworkRate = p.reworkRate ?? defaultRework;
        if (rand() < reworkRate) {
          // Reworked → continues as OK
          addEdge(node, `${station}:REWORK`);
          addEdge(`${station}:REWORK`, okNode);
          isDefective = false;
          reworked++;
          prevNode = okNode;
        } else {
          // Scrapped → unit leaves the line
          addEdge(node, "SCRAP");
          scrapped++;
          alive = false;
          break;
        }
      } else {
        prevNode = node;
      }
    }

    if (alive) {
      const terminal = isDefective ? "ESCAPE" : "SHIP";
      addEdge(prevNode ?? "START", terminal);
      if (isDefective) escapes++;
      else shipped++;
    }
  }

  // Build node list from observed edges
  const nodeSet = new Set<string>();
  for (const k of edges.keys()) {
    const [src, tgt] = k.split("->");
    nodeSet.add(src);
    nodeSet.add(tgt);
  }
  const nodes: SankeyNode[] = [...nodeSet].map((id) => ({ id, label: id }));
  const links: SankeyLink[] = [...edges.entries()].map(([k, v]) => {
    const [source, target] = k.split("->");
    return { source, target, value: v };
  });

  return {
    nodes,
    links,
    totals: { units, shipped, scrapped, reworked, escapes },
  };
}
