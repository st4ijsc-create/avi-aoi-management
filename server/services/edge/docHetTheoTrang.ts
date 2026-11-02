/**
 * SCADA R1b-2b-2a A2(j) — read a list on the STOP / abort path TO THE END, page by page, on an ascending unique id (keyset cursor).
 *
 * Why: the edge lists that carry a STOP or an abort signal (the claims of a node with `abortRequested`, the aborted runs whose STOPs must be re-sent,
 * the STOP requests not acknowledged in time) used a bare `LIMIT n` — past n rows the rest was silently never seen (L-7). An alert cannot deliver an
 * abort signal, so "cap + 1 ⇒ alert" is not enough there: every row is read.
 *
 * Load bound: each page is `id > cursor ORDER BY id LIMIT coTrang` (rows inserted while reading are either picked up or left to the next pass —
 * never read twice, no endless loop: the cursor must strictly increase, else the read throws). A very large page budget (`soTrangToiDa`) stops a
 * runaway read; reaching it ⇒ `catBot: true` — the caller still processes EVERYTHING already read, raises an alert (`baoDocCatBot`) and tells the
 * controller (e.g. `runStateUnavailable`).
 */

import { EDGE_PULL_CLAIMS_MAX, EDGE_PULL_STOPS_UNCONFIRMED_MAX } from "./edgeProtocol";

/** Rows per page (one round trip each). */
export const CO_TRANG_DOC_HET = 200;
/** Page budget of one read: 1000 pages × 200 = 200 000 rows — far beyond any real list on these paths. */
export const SO_TRANG_DOC_HET_TOI_DA = 1000;

/** An internal invariant of the reader broke (the page query did not honour `id > cursor ORDER BY id LIMIT n`) — never a user-facing error. */
export class LoiDocHetTheoTrang extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiDocHetTheoTrang";
  }
}

export interface KetQuaDocHet<T> {
  hang: T[];
  /** true ⇔ the page budget ran out while rows were still there (the list is NOT complete) */
  catBot: boolean;
}

/**
 * `docTrang(sau, n)` must return at most `n` rows with key > `sau` (null = from the start), ordered by that key ascending.
 */
export async function docHetTheoTrang<T>(
  docTrang: (sau: number | null, n: number) => Promise<T[]>,
  khoa: (r: T) => number,
  opts: { coTrang?: number; soTrangToiDa?: number } = {},
): Promise<KetQuaDocHet<T>> {
  const coTrang = Math.max(1, Math.floor(opts.coTrang ?? CO_TRANG_DOC_HET));
  const soTrangToiDa = Math.max(1, Math.floor(opts.soTrangToiDa ?? SO_TRANG_DOC_HET_TOI_DA));
  const hang: T[] = [];
  let sau: number | null = null;
  for (let trang = 0; trang < soTrangToiDa; trang++) {
    const rows = await docTrang(sau, coTrang);
    if (rows.length > coTrang) throw new LoiDocHetTheoTrang(`docHetTheoTrang: a page returned ${rows.length} rows (> ${coTrang})`);
    for (const r of rows) {
      const k = khoa(r);
      if (!Number.isFinite(k) || (sau !== null && k <= sau)) throw new LoiDocHetTheoTrang(`docHetTheoTrang: the key did not increase (${sau} → ${k}) — refusing an endless read`);
      sau = k;
      hang.push(r);
    }
    if (rows.length < coTrang) return { hang, catBot: false };
  }
  // budget spent on full pages: is anything left? (one row probe — the answer decides catBot, the row itself is not taken)
  const conLai = await docTrang(sau, 1);
  return { hang, catBot: conLai.length > 0 };
}

const daBao = new Map<string, number>();
/** Tests only. */
export function _quenBaoDocCatBotChoTest(): void {
  daBao.clear();
}

/**
 * ONE alert (per `dedupKey`, 24 h in this process; the inbox row is deduped durably by raiseCriticalStopAlert `khuTrungBenVung`) to every active
 * admin that a list on the STOP / abort path could not be read to the end. Fire-and-forget, never throws.
 */
export function baoDocCatBot(a: { kind: string; title: string; message: string; dedupKey: string }): void {
  const now = Date.now();
  const luc = daBao.get(a.dedupKey);
  if (luc !== undefined && now - luc < 24 * 3_600_000) return;
  if (daBao.size >= 5_000) daBao.clear();
  daBao.set(a.dedupKey, now);
  console.error(`[EdgeList] ${a.message}`);
  void (async () => {
    try {
      let recipients: number[] = [];
      try {
        const { getDb } = await import("../../db/connection");
        const { sql } = await import("drizzle-orm");
        const db = (await getDb()) as unknown as { execute: (q: unknown) => Promise<unknown> } | null;
        const r = db ? await db.execute(sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true`) : [];
        recipients = ((Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: unknown }>).map((x) => Number(x.id)).filter((x) => Number.isSafeInteger(x) && x > 0);
      } catch {
        recipients = [];
      }
      const { raiseCriticalStopAlert } = await import("../robot/criticalStopAlert");
      await raiseCriticalStopAlert({ kind: a.kind, title: a.title, message: a.message, recipients, dedupKey: a.dedupKey, source: "ot", entityType: "edge_node", khuTrungBenVung: {} });
    } catch (err) {
      console.error(`[EdgeList] alert failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
  })();
}

/** Rotation offsets per (node, list, tier): more than one answer can carry ⇒ a different window each pull, so none starves. */
const xoay = new Map<string, number>();
/** Tests only. */
export function __resetStopsUnconfirmedRotationForTests(): void {
  xoay.clear();
}

/** `n` items of `list` starting where the previous pull of `khoa` stopped (contiguous windows ⇒ all covered in ⌈len / n⌉ pulls). */
function cuaSoXoay<T>(list: readonly T[], n: number, khoa: string | null): T[] {
  if (n <= 0 || list.length === 0) return [];
  if (list.length <= n) return [...list];
  if (khoa === null) return list.slice(0, n);
  const lan = xoay.get(khoa) ?? 0;
  xoay.set(khoa, lan + 1);
  if (xoay.size > 20_000) xoay.clear();
  const start = (lan * n) % list.length;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[(start + i) % list.length]!);
  return out;
}

/**
 * SCADA R1b-2b-2a A2(j) (+ AMENDMENT 1) — fit a v2 pull list into the protocol's limit (EDGE_PULL_CLAIMS_MAX / EDGE_PULL_STOPS_UNCONFIRMED_MAX: a
 * longer list makes the WHOLE answer invalid on the edge — its STOP commands included) WITHOUT dropping a STOP / abort for good:
 *   • `uuTien` (claims: abortRequested) — the priority items come first; if they alone exceed `max`, a ROTATING window over them (every abort
 *     signal reaches the node within ⌈aborts / max⌉ pulls); otherwise all of them + a rotating window over the rest;
 *   • no `uuTien` (unconfirmed STOPs) — a rotating window over the list (every STOP within ⌈n / max⌉ pulls).
 * Rotation is per `xoay` key (node + list). `vuot` ⇒ the caller sets `runStateUnavailable` and raises the overflow alert (chonClaimsChoTraLoi /
 * chonStopsChoTraLoi do both).
 */
export function chonTrongGioiHanGiaoThuc<T>(list: readonly T[], max: number, opts: { uuTien?: (x: T) => boolean; xoay?: number | string } = {}): { chon: T[]; vuot: boolean } {
  if (list.length <= max) return { chon: [...list], vuot: false };
  const khoa = opts.xoay === undefined ? null : String(opts.xoay);
  if (!opts.uuTien) return { chon: cuaSoXoay(list, max, khoa), vuot: true };
  const uu = list.filter((x) => opts.uuTien!(x));
  const con = list.filter((x) => !opts.uuTien!(x));
  if (uu.length >= max) return { chon: cuaSoXoay(uu, max, khoa === null ? null : `${khoa}:uu`), vuot: true };
  return { chon: [...uu, ...cuaSoXoay(con, max - uu.length, khoa === null ? null : `${khoa}:con`)], vuot: true };
}

type NutTraLoi = { nodeId: number; nodeCode: string };

function baoTran(node: NutTraLoi, loai: "claims" | "stops" | "assert", n: number, max: number): void {
  const ten = loai === "claims" ? "current claims (abort signals first)" : loai === "stops" ? "aborted runs with an unconfirmed STOP" : "answer lists";
  baoDocCatBot({
    kind: "edge_pull_overflow",
    title: `Edge node ${node.nodeCode}: more ${loai === "claims" ? "claims" : "unconfirmed STOPs"} than one pull answer carries`,
    message:
      `Edge node ${node.nodeCode}: ${n} ${ten} — more than one pull answer carries (${max}). They are delivered across successive pulls (rotating); ` +
      `meanwhile the node holds every non-STOP work (runStateUnavailable). Check why so many runs are claimed / aborted on this node; use the machines' E-STOP where needed.`,
    dedupKey: `edge_pull_overflow:${loai}:${node.nodeId}`,
  });
}

/** The claims of ONE v2 answer: aborts first, within EDGE_PULL_CLAIMS_MAX, rotating on overflow (+ alert). `vuot` ⇒ runStateUnavailable. */
export function chonClaimsChoTraLoi<C extends { abortRequested: boolean }>(node: NutTraLoi, list: readonly C[]): { chon: C[]; vuot: boolean } {
  const r = chonTrongGioiHanGiaoThuc(list, EDGE_PULL_CLAIMS_MAX, { uuTien: (c) => c.abortRequested, xoay: `${node.nodeId}:claims` });
  if (r.vuot) baoTran(node, "claims", list.length, EDGE_PULL_CLAIMS_MAX);
  return r;
}

/** The unconfirmed STOPs of ONE v2 answer: within EDGE_PULL_STOPS_UNCONFIRMED_MAX, rotating on overflow (+ alert). `vuot` ⇒ runStateUnavailable. */
export function chonStopsChoTraLoi<S>(node: NutTraLoi, list: readonly S[]): { chon: S[]; vuot: boolean } {
  const r = chonTrongGioiHanGiaoThuc(list, EDGE_PULL_STOPS_UNCONFIRMED_MAX, { xoay: `${node.nodeId}:stops` });
  if (r.vuot) baoTran(node, "stops", list.length, EDGE_PULL_STOPS_UNCONFIRMED_MAX);
  return r;
}

/**
 * SCADA R1b-2b-2a A2(j) AMENDMENT 1 — THE assertion where a v2 pull answer is built: central NEVER returns more claims / unconfirmed STOPs than the
 * schema carries (the edge would drop the WHOLE answer, STOPs included). Over the limit (a bug upstream — the selectors above already fit) ⇒ cut to
 * the limit, `runStateUnavailable: true`, an error log and the overflow alert — never an over-limit answer. Also fixes the order inside the answer:
 * STOPs first (the signed commands, then `stopsUnconfirmed`), then the claims with every abort-carrying claim first, then the rest (`runs`, …) —
 * the order the edge acts on them (its STOP fast path runs before the work phase).
 */
export function giuTrongGioiHanTraLoi<D extends { claims: Array<{ abortRequested: boolean }>; stopsUnconfirmed: unknown[]; runs: unknown[]; runStateUnavailable?: true }>(
  node: NutTraLoi,
  data: D,
): D & { runStateUnavailable?: true } {
  const { claims, stopsUnconfirmed, runs, runStateUnavailable, ...rest } = data;
  const claimsXep = [...claims.filter((c) => c.abortRequested), ...claims.filter((c) => !c.abortRequested)];
  const vuot = claimsXep.length > EDGE_PULL_CLAIMS_MAX || stopsUnconfirmed.length > EDGE_PULL_STOPS_UNCONFIRMED_MAX;
  if (vuot) {
    console.error(
      `[EdgeExec] ASSERTION: the v2 pull answer for node ${node.nodeCode} had ${claimsXep.length} claims / ${stopsUnconfirmed.length} unconfirmed STOPs ` +
        `(limits ${EDGE_PULL_CLAIMS_MAX} / ${EDGE_PULL_STOPS_UNCONFIRMED_MAX}) — cut to the limits, runStateUnavailable set`,
    );
    baoTran(node, "assert", Math.max(claimsXep.length, stopsUnconfirmed.length), Math.min(EDGE_PULL_CLAIMS_MAX, EDGE_PULL_STOPS_UNCONFIRMED_MAX));
  }
  return {
    ...rest,
    stopsUnconfirmed: stopsUnconfirmed.slice(0, EDGE_PULL_STOPS_UNCONFIRMED_MAX),
    claims: claimsXep.slice(0, EDGE_PULL_CLAIMS_MAX),
    runs,
    ...(runStateUnavailable || vuot ? { runStateUnavailable: true as const } : {}),
  } as unknown as D & { runStateUnavailable?: true };
}
