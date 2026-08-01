/**
 * doc 54 P2.5 — Recursive genealogy lineage.
 *
 * The genealogy ledger (`genealogy_chain`) records parent→child edges via
 * (serialNumber, parentSerial). Until now the only reads were SHALLOW — one
 * serial's own events (genealogyRouter.getBySerial) or a one-level WIP hop
 * (traceabilityRouter.bySerial). This service walks the lineage RECURSIVELY:
 *
 *   • descendants — parent→child→grandchild… (a component's assemblies)
 *   • ancestors   — child→parent→grandparent… (a unit's source components/lots)
 *
 * The walk is a cycle-safe recursive CTE (path-array guard) bounded by `maxDepth`,
 * and the tree is assembled in a PURE, unit-testable helper (`buildLineageTree`).
 * HONEST: a serial with no edges returns a single-node tree (itself) — never a
 * fabricated relationship.
 */
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { executeRows } from "../utils/kpi";

export type LineageDirection = "ancestors" | "descendants" | "both";

export interface LineageEdge {
  child: string;
  parent: string;
}

export interface LineageNode {
  serialNumber: string;
  depth: number;
  /** Downstream children (descendants) or upstream parents (ancestors). */
  children: LineageNode[];
  eventCount?: number;
  lastEventType?: string | null;
  productModelId?: number | null;
}

export interface LineageTree {
  root: LineageNode;
  nodeCount: number; // distinct related serials, EXCLUDING the root
  truncated: boolean; // a branch hit maxDepth with more edges available
}

export interface LineageResult {
  rootSerial: string;
  direction: LineageDirection;
  maxDepth: number;
  found: boolean; // the root appears anywhere in the chain
  descendants: LineageTree | null;
  ancestors: LineageTree | null;
}

/**
 * PURE — build a lineage tree rooted at `root` from a flat (child, parent) edge set.
 *   • descendants: a node's children are edges whose parent == node (parent→child).
 *   • ancestors:   a node's children are edges whose child  == node (child→parent).
 * Cycle-safe (a serial is never expanded twice on one path) and depth-bounded.
 */
export function buildLineageTree(
  edges: LineageEdge[],
  root: string,
  direction: "ancestors" | "descendants",
  maxDepth: number,
  meta?: Map<string, { eventCount: number; lastEventType: string | null; productModelId: number | null }>,
): LineageTree {
  // Adjacency in the requested walk direction.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.child || !e.parent) continue;
    const [from, to] = direction === "descendants" ? [e.parent, e.child] : [e.child, e.parent];
    const list = adj.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    adj.set(from, list);
  }

  const counted = new Set<string>();
  let truncated = false;

  const attachMeta = (node: LineageNode): LineageNode => {
    const m = meta?.get(node.serialNumber);
    if (m) {
      node.eventCount = m.eventCount;
      node.lastEventType = m.lastEventType;
      node.productModelId = m.productModelId;
    }
    return node;
  };

  const build = (serial: string, depth: number, pathSeen: Set<string>): LineageNode => {
    const node: LineageNode = { serialNumber: serial, depth, children: [] };
    attachMeta(node);
    const neighbours = adj.get(serial) ?? [];
    if (neighbours.length === 0) return node;
    if (depth >= maxDepth) {
      truncated = true; // more edges exist below but we stop at the depth bound
      return node;
    }
    for (const next of neighbours) {
      if (pathSeen.has(next)) continue; // cycle guard
      counted.add(next);
      const childPath = new Set(pathSeen);
      childPath.add(next);
      node.children.push(build(next, depth + 1, childPath));
    }
    // stable order for deterministic output/tests
    node.children.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
    return node;
  };

  const rootNode = build(root, 0, new Set([root]));
  return { root: rootNode, nodeCount: counted.size, truncated };
}

/** Fetch cycle-safe lineage edges for one direction via a recursive CTE. */
async function fetchLineageEdges(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rootSerial: string,
  direction: "ancestors" | "descendants",
  maxDepth: number,
): Promise<LineageEdge[]> {
  // `e` is the DISTINCT edge relation (child = unit, parent = its parent).
  // descendants: descend from the root by matching e.parent = current child.
  // ancestors:   ascend  from the root by matching e.child  = current parent.
  const seed = direction === "descendants"
    ? sql`SELECT child, parent, 1 AS depth, ARRAY[parent, child] AS path FROM e WHERE parent = ${rootSerial}`
    : sql`SELECT child, parent, 1 AS depth, ARRAY[child, parent] AS path FROM e WHERE child = ${rootSerial}`;
  const step = direction === "descendants"
    ? sql`SELECT e.child, e.parent, w.depth + 1, w.path || e.child
          FROM e JOIN w ON e.parent = w.child
          WHERE w.depth < ${maxDepth} AND NOT (e.child = ANY(w.path))`
    : sql`SELECT e.child, e.parent, w.depth + 1, w.path || e.parent
          FROM e JOIN w ON e.child = w.parent
          WHERE w.depth < ${maxDepth} AND NOT (e.parent = ANY(w.path))`;

  const rows = executeRows(await db.execute(sql`
    WITH RECURSIVE e AS (
      SELECT DISTINCT "serialNumber" AS child, "parentSerial" AS parent
      FROM genealogy_chain
      WHERE "parentSerial" IS NOT NULL AND btrim("parentSerial") <> ''
    ),
    w AS (
      ${seed}
      UNION ALL
      ${step}
    )
    SELECT DISTINCT child, parent FROM w
  `)) as Array<{ child: string; parent: string }>;

  return rows.map((r) => ({ child: String(r.child), parent: String(r.parent) }));
}

/** Per-serial metadata (event count, last event type, last product model) for tree nodes. */
async function fetchNodeMeta(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  serials: string[],
): Promise<Map<string, { eventCount: number; lastEventType: string | null; productModelId: number | null }>> {
  const out = new Map<string, { eventCount: number; lastEventType: string | null; productModelId: number | null }>();
  if (serials.length === 0) return out;
  const inList = sql.join(serials.map((s) => sql`${s}`), sql`, `);
  const rows = executeRows(await db.execute(sql`
    SELECT "serialNumber" AS serial,
           COUNT(*)::int AS event_count,
           (ARRAY_AGG("eventType"      ORDER BY "recordedAt" DESC, "id" DESC))[1] AS last_event_type,
           (ARRAY_AGG("productModelId" ORDER BY "recordedAt" DESC, "id" DESC))[1] AS product_model_id
    FROM genealogy_chain
    WHERE "serialNumber" IN (${inList})
    GROUP BY "serialNumber"
  `)) as Array<{ serial: string; event_count: number; last_event_type: string | null; product_model_id: number | null }>;
  for (const r of rows) {
    out.set(String(r.serial), {
      eventCount: Number(r.event_count) || 0,
      lastEventType: r.last_event_type ?? null,
      productModelId: r.product_model_id != null ? Number(r.product_model_id) : null,
    });
  }
  return out;
}

/**
 * Recursively walk the genealogy lineage of a serial. `direction`:
 *   • "descendants" — parent→child→… (what this unit became part of)
 *   • "ancestors"   — child→parent→… (what this unit was built from)
 *   • "both"        — both trees.
 * Returns honest empties (single-node tree) when the serial has no edges.
 */
export async function getGenealogyLineage(params: {
  rootSerial: string;
  direction?: LineageDirection;
  maxDepth?: number;
}): Promise<LineageResult> {
  const direction = params.direction ?? "both";
  const maxDepth = Math.min(Math.max(1, params.maxDepth ?? 20), 100);
  const rootSerial = params.rootSerial;

  const base: LineageResult = {
    rootSerial, direction, maxDepth, found: false, descendants: null, ancestors: null,
  };
  const db = await getDb();
  if (!db) return base;

  const wantDown = direction === "descendants" || direction === "both";
  const wantUp = direction === "ancestors" || direction === "both";

  const [downEdges, upEdges] = await Promise.all([
    wantDown ? fetchLineageEdges(db, rootSerial, "descendants", maxDepth) : Promise.resolve([]),
    wantUp ? fetchLineageEdges(db, rootSerial, "ancestors", maxDepth) : Promise.resolve([]),
  ]);

  // Collect every serial touched (+ the root) for one metadata fetch.
  const serials = new Set<string>([rootSerial]);
  for (const e of downEdges) { serials.add(e.child); serials.add(e.parent); }
  for (const e of upEdges) { serials.add(e.child); serials.add(e.parent); }
  const meta = await fetchNodeMeta(db, [...serials]);

  const descendants = wantDown ? buildLineageTree(downEdges, rootSerial, "descendants", maxDepth, meta) : null;
  const ancestors = wantUp ? buildLineageTree(upEdges, rootSerial, "ancestors", maxDepth, meta) : null;

  // "found" = the root itself appears in the chain (has metadata) OR has any edge.
  const found = meta.has(rootSerial) || downEdges.length > 0 || upEdges.length > 0;

  return { rootSerial, direction, maxDepth, found, descendants, ancestors };
}
