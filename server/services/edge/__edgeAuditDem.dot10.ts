/**
 * Test support (not a test file): the count of EDGE_ANOMALY seq_conflict audit rows of ONE edge node, filtered EXACTLY by the
 * entity columns `auditNode` fills for this anomaly (edgeReportsCentral: entity { type: "edge_node", id: node.nodeId }).
 * The old filter `details::text LIKE '%<nodeId>%'` matched a 5-digit id by chance inside a run id, a hex epoch or a hash of ANOTHER
 * node's row (false red in the serial gate). Imported by edgeExecution / edgeAttack dot10 e2e and edgeAuditDem.a2test.db.
 */
import type postgres from "postgres";

type SqlLike = postgres.Sql | postgres.TransactionSql;

export async function countSeqConflictsOfNode(sql: SqlLike, nodeId: number, sinceMinutes?: number): Promise<number> {
  const rows =
    sinceMinutes === undefined
      ? await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityType" = 'edge_node' AND "entityId" = ${nodeId} AND details LIKE '%"anomaly":"seq_conflict"%'`
      : await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityType" = 'edge_node' AND "entityId" = ${nodeId} AND details LIKE '%"anomaly":"seq_conflict"%' AND "createdAt" > now() - make_interval(mins => ${sinceMinutes})`;
  return Number((rows[0] as { n: number }).n);
}
