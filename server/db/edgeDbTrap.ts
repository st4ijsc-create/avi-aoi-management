/**
 * doc 81 Đợt 10 task A (design §2.15) — THE edge-role DB trap, shared by EVERY place that constructs a postgres client
 * (fix review 1, I2: connection.ts getDb / getJobsDb / getReadDb, and the raw `postgres()` constructions in timescale.ts,
 * safetyPlcPollerLeader.ts, workerLeader.ts, healthProbes.ts, backupService.ts). The edge gateway
 * (server/edge/edgeGatewayMain.ts sets AVI_PROCESS_ROLE=edge before any import) holds NO central DB login — in that role no
 * accessor may construct a client, whatever DATABASE_URL / TSDB_URL / DATABASE_READ_URL say:
 *   • default (production): `edgeDbRefused(accessor)` returns true (the caller returns null / "not configured"), logs loudly
 *     ONCE, counts every attempt (edgeDbTrapCount — the E2E asserts 0);
 *   • EDGE_DB_TRAP=throw (tests / CI): it throws EdgeDbTrapError (code EDGE_DB_TRAP).
 * Any other EDGE_DB_TRAP value is the default — there is no "allow". No imports: a module that mocks connection.ts still
 * gets the real trap. The census test server/db/edgeDbTrap.census.dot10.test.ts fails on any `postgres(` construction under
 * server/ that is not preceded by an `edgeDbRefused(` call.
 */
export class EdgeDbTrapError extends Error {
  readonly code = "EDGE_DB_TRAP";
  constructor(readonly accessor: string) {
    super(`EDGE_DB_TRAP: ${accessor}() called in an edge process (AVI_PROCESS_ROLE=edge) — the edge has no central DB`);
  }
}

const state = { count: 0, logged: false, byAccessor: {} as Record<string, number> };

export function isEdgeProcessRole(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AVI_PROCESS_ROLE ?? "").trim().toLowerCase() === "edge";
}
export function edgeDbTrapCount(): number {
  return state.count;
}
export function edgeDbTrapStats(): { count: number; byAccessor: Record<string, number> } {
  return { count: state.count, byAccessor: { ...state.byAccessor } };
}

/**
 * Call RIGHT BEFORE constructing a postgres client. true ⇔ the caller must not construct it (edge role, default mode):
 * return null / "not configured" instead. Throws EdgeDbTrapError under EDGE_DB_TRAP=throw. false ⇔ not an edge process.
 */
export function edgeDbRefused(accessor: string): boolean {
  if (!isEdgeProcessRole()) return false;
  state.count++;
  state.byAccessor[accessor] = (state.byAccessor[accessor] ?? 0) + 1;
  if (!state.logged) {
    state.logged = true;
    console.error(`[Database] EDGE_DB_TRAP: ${accessor}() called in an edge process — refused (no central DB on the edge). Further attempts are only counted.`);
  }
  if (String(process.env.EDGE_DB_TRAP ?? "").trim().toLowerCase() === "throw") throw new EdgeDbTrapError(accessor);
  return true;
}
