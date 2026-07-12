/**
 * doc 46 FE-W3.4 — client-side genealogy aggregation for the carton/pallet
 * (IPC-1782 "container") view and the forward/recall search.
 *
 * HONEST-DEGRADATION NOTE
 * -----------------------
 * The SYNAPSE backend has NO dedicated carton/pallet pack-out table. There is
 * no carton_id / pallet_id / shipment_id column on wip_tracking, lot_disposition
 * or genealogy_chain (verified 2026-07-13 against the live DB). The only real
 * "container" keys that exist on a genealogy row are:
 *   • lotCode        — genealogy_chain.lotCode (production batch, e.g.
 *                      SIM-BATCH-L1-YYYYMMDD; or a component/supplier lot on
 *                      `merge` events, e.g. SIM-LOT-U-YYYYMMDD)
 *   • parentSerial   — genealogy_chain.parentSerial (panel / parent-unit; NULL
 *                      in the current SIM dataset — no depanel hierarchy seeded)
 *
 * So this module aggregates REAL genealogy_chain rows (via genealogy.getByLot /
 * genealogy.getBySerial) into a container tree using whatever key is present,
 * degrading honestly: lot → (parent-unit carton, when present) → serial. It
 * never fabricates a carton/pallet identifier.
 */

/** A genealogy_chain row as returned by genealogy.getByLot / getBySerial. */
export interface ChainRow {
  id: number;
  serialNumber: string;
  parentSerial: string | null;
  eventType: string; // born | station | merge | split | rework | scrap | ship | custom
  stationCode: string | null;
  lotCode: string | null;
  productModelId: number | null;
  payload: Record<string, unknown>;
  recordedAt: string | Date;
}

export type Verdict = "ship" | "scrap" | "rework" | "ng" | "in_process";

export interface StationHit {
  station: string;
  result: string; // PASS | FAIL | NTF | ...
  at: string;
}

export interface MergeHit {
  componentCode?: string;
  lot?: string;
  refDes?: string;
  at: string;
}

/** Per-serial roll-up derived from that serial's chain events. */
export interface SerialSummary {
  serialNumber: string;
  parentSerial: string | null;
  bornAt: string | null;
  product: string | null;
  line: string | null;
  shift: string | null;
  stations: StationHit[];
  merges: MergeHit[];
  shipped: boolean;
  shipDisposition: string | null;
  scrapped: boolean;
  reworked: boolean;
  stationFails: number;
  ntf: boolean;
  verdict: Verdict;
  /** All events for this serial, oldest first (for the inline timeline). */
  events: ChainRow[];
}

/** Roll-up for one container (a parent-unit carton, or the whole lot). */
export interface ContainerRollup {
  key: string;
  label: string;
  isUngrouped: boolean;
  total: number;
  shipped: number;
  scrapped: number;
  ng: number;
  rework: number;
  inProcess: number;
  /** First-pass yield: shipped with zero station FAILs, as a whole percent. */
  fpyPct: number;
  serials: SerialSummary[];
}

export type LotType = "batch" | "component" | "empty";

export interface LotAggregate {
  lotCode: string;
  /**
   * batch     — has station/ship events (a production batch of finished units)
   * component — only merge (component-install) events → looks like a
   *             component/supplier lot; use the forward/recall view instead
   * empty     — no rows
   */
  lotType: LotType;
  /** True when at least one serial carries a parentSerial (real carton key). */
  hasParentKey: boolean;
  totalSerials: number;
  /** Overall roll-up across every serial in the lot. */
  overall: Omit<ContainerRollup, "key" | "label" | "isUngrouped" | "serials">;
  /** Container tree: one entry per parent-unit carton, or a single lot bucket. */
  containers: ContainerRollup[];
  serials: SerialSummary[];
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Collapse one serial's ordered events into a verdict + facts. */
export function summarizeSerial(serialNumber: string, rowsIn: ChainRow[]): SerialSummary {
  const events = [...rowsIn].sort(
    (a, b) => new Date(toIso(a.recordedAt)).getTime() - new Date(toIso(b.recordedAt)).getTime(),
  );

  let bornAt: string | null = null;
  let product: string | null = null;
  let line: string | null = null;
  let shift: string | null = null;
  let parentSerial: string | null = null;
  const stations: StationHit[] = [];
  const merges: MergeHit[] = [];
  let shipped = false;
  let shipDisposition: string | null = null;
  let scrapped = false;
  let reworked = false;
  let stationFails = 0;
  let ntf = false;

  for (const e of events) {
    if (e.parentSerial && !parentSerial) parentSerial = e.parentSerial;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.eventType) {
      case "born": {
        bornAt = toIso(e.recordedAt);
        product = str(p.product) ?? product;
        line = str(p.line) ?? line;
        shift = str(p.shift) ?? shift;
        break;
      }
      case "station": {
        const result = (str(p.result) ?? "").toUpperCase();
        stations.push({ station: e.stationCode ?? str(p.station) ?? "?", result, at: toIso(e.recordedAt) });
        if (result === "FAIL" || result === "NG") stationFails += 1;
        if (result === "NTF") ntf = true;
        break;
      }
      case "merge": {
        merges.push({
          componentCode: str(p.componentCode),
          lot: str(p.lot) ?? e.lotCode ?? undefined,
          refDes: str(p.refDesignator),
          at: toIso(e.recordedAt),
        });
        break;
      }
      case "ship": {
        shipped = true;
        shipDisposition = str(p.disposition) ?? "ship";
        if (shipDisposition.includes("ntf")) ntf = true;
        break;
      }
      case "scrap":
        scrapped = true;
        break;
      case "rework":
        reworked = true;
        break;
      default:
        break;
    }
  }

  const verdict: Verdict = scrapped
    ? "scrap"
    : shipped
      ? "ship"
      : stationFails > 0
        ? "ng"
        : reworked
          ? "rework"
          : "in_process";

  return {
    serialNumber,
    parentSerial,
    bornAt,
    product: product ?? null,
    line: line ?? null,
    shift: shift ?? null,
    stations,
    merges,
    shipped,
    shipDisposition,
    scrapped,
    reworked,
    stationFails,
    ntf,
    verdict,
    events,
  };
}

function emptyCounts() {
  return { total: 0, shipped: 0, scrapped: 0, ng: 0, rework: 0, inProcess: 0, fpyPct: 0 };
}

function tally(serials: SerialSummary[]) {
  const c = emptyCounts();
  let firstPass = 0;
  for (const s of serials) {
    c.total += 1;
    if (s.verdict === "ship") c.shipped += 1;
    else if (s.verdict === "scrap") c.scrapped += 1;
    else if (s.verdict === "ng") c.ng += 1;
    else if (s.verdict === "rework") c.rework += 1;
    else c.inProcess += 1;
    if (s.shipped && s.stationFails === 0) firstPass += 1;
  }
  c.fpyPct = c.total > 0 ? Math.round((firstPass / c.total) * 100) : 0;
  return c;
}

const UNGROUPED_KEY = "__ungrouped__";

/**
 * Aggregate all genealogy_chain rows for one lot into a container tree.
 * Groups by parentSerial when that key is present (real carton/parent-unit),
 * otherwise presents a single lot-level container (honest degradation).
 */
export function aggregateLot(lotCode: string, rows: ChainRow[]): LotAggregate {
  const bySerial = new Map<string, ChainRow[]>();
  for (const r of rows) {
    const arr = bySerial.get(r.serialNumber);
    if (arr) arr.push(r);
    else bySerial.set(r.serialNumber, [r]);
  }

  const serials: SerialSummary[] = [];
  for (const [sn, evs] of bySerial) serials.push(summarizeSerial(sn, evs));
  serials.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));

  const eventTypes = new Set(rows.map((r) => r.eventType));
  const lotType: LotType =
    serials.length === 0
      ? "empty"
      : eventTypes.has("station") || eventTypes.has("ship")
        ? "batch"
        : "component";

  const hasParentKey = serials.some((s) => s.parentSerial != null);

  let containers: ContainerRollup[];
  if (hasParentKey) {
    const groups = new Map<string, SerialSummary[]>();
    for (const s of serials) {
      const key = s.parentSerial ?? UNGROUPED_KEY;
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    containers = [...groups.entries()]
      .sort((a, b) => (a[0] === UNGROUPED_KEY ? 1 : b[0] === UNGROUPED_KEY ? -1 : a[0].localeCompare(b[0])))
      .map(([key, ss]) => ({
        key,
        label: key,
        isUngrouped: key === UNGROUPED_KEY,
        serials: ss,
        ...tally(ss),
      }));
  } else {
    // No carton/parent-unit key — one lot-level container (honest degradation).
    containers = [
      {
        key: lotCode,
        label: lotCode,
        isUngrouped: true,
        serials,
        ...tally(serials),
      },
    ];
  }

  return {
    lotCode,
    lotType,
    hasParentKey,
    totalSerials: serials.length,
    overall: tally(serials),
    containers,
    serials,
  };
}

/**
 * Extract the distinct affected serials for a forward/recall search over a lot's
 * genealogy rows. Returns them sorted, plus a per-product/line breakdown for a
 * quick scope readout.
 */
export interface AffectedScope {
  serials: string[];
  byLine: { line: string; count: number }[];
  byProduct: { product: string; count: number }[];
}

export function affectedFromRows(rows: ChainRow[]): AffectedScope {
  const serials = new Set<string>();
  const lineCounts = new Map<string, Set<string>>();
  const productCounts = new Map<string, Set<string>>();
  for (const r of rows) {
    serials.add(r.serialNumber);
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const line = str(p.line);
    const product = str(p.product);
    if (line) {
      const set = lineCounts.get(line) ?? new Set<string>();
      set.add(r.serialNumber);
      lineCounts.set(line, set);
    }
    if (product) {
      const set = productCounts.get(product) ?? new Set<string>();
      set.add(r.serialNumber);
      productCounts.set(product, set);
    }
  }
  return {
    serials: [...serials].sort((a, b) => a.localeCompare(b)),
    byLine: [...lineCounts.entries()].map(([line, s]) => ({ line, count: s.size })).sort((a, b) => b.count - a.count),
    byProduct: [...productCounts.entries()].map(([product, s]) => ({ product, count: s.size })).sort((a, b) => b.count - a.count),
  };
}
