/**
 * doc 81 Đợt 8 task Q1 — INSTRUMENT: the EDGE half of the central abort (Đợt 7 I1: edgeRuntime.setCentralSync /
 * executeAssignedRun) is LATENT — it has no production caller, and this file measures that instead of asserting it in prose.
 *
 * Why it is latent (measured 2026-10-11 at 86bb46e26, not assumed):
 *   • the production edge process (`server/edge/edgeGatewayMain.ts` → `edgeGatewayRuntime.bootstrapEdgeGateway`) runs ONLY the
 *     southbound OT collectors, the northbound UNS bridge, store-and-forward and the node registry/heartbeat — "READ + publish +
 *     buffer; it opens no new control path" (its header, docs/EDGE_GATEWAY.md §3 safety boundary);
 *   • central has NO endpoint from which an edge could fetch the runs assigned to it (`assignRun` only records `edgeNodeId`;
 *     `nodeStatus` is a session-authenticated read for people; `/api/v1/edge/*` has only `POST /edge/sync`);
 *   • the edge deployment (`deploy/edge/docker-compose.edge.yml`) carries no API key / central URL for a sync transport.
 * Wiring run execution into the gateway would open a NEW actuation path on the edge — an owner decision, not a leftover.
 * Until then `executeAssignedRun` also refuses to start anything on a host that never wired `setCentralSync` (edge.test.ts Q1).
 *
 * PROCEDURE when an edge host is wired: the caller must call setCentralSync (a real transport answering `abortRequested`)
 * BEFORE executeAssignedRun; add the caller to WIRED below with a dated note, and update doc 81 (Đợt 7 I1 "latent").
 *
 * ★ RE-PIN 2026-10-12 (doc 81 Đợt 9 task S, owner decision "edge workflow execution — do it fully"): edge run execution IS now
 *   wired — but NOT through this module. The gateway (edgeGatewayRuntime.bootstrapEdgeGateway, flag EDGE_EXECUTION_ENABLED,
 *   default OFF) starts `edgeExecutionAgent`, which pulls the runs assigned to its node over the authenticated per-node protocol
 *   (`/api/v1/edge/node/*`, edgeNodeRoutes.ts) and walks THE CENTRAL RUN itself under a claim (foeEngine.driveEdgeClaimedRun).
 *   `executeAssignedRun` (the Đợt 7 COPY-run model: a new local run synced back through /edge/sync) must stay UNCALLED: a copy
 *   would break the S1 ID mapping and bypass the claim. So WIRED stays [] and the tests below now pin the NEW shape: the
 *   gateway loads only the agent (behind its flag), never edgeRuntime / foeEngine directly, and central's edge routes are
 *   /edge/sync + exactly the six node-protocol routes, each behind the node credential.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../../..");
const WIRED: string[] = []; // production files that call executeAssignedRun (none: latent) — see PROCEDURE

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(e.name) && !/\.(test|spec)\.|__/.test(e.name)) out.push(p);
  }
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
/** The identifiers a file USES in code (TypeScript parser — comments and strings never count; edgeCoordinator.ts:326 names it in a comment). */
function identifiersOf(src: string, fileName = "x.ts"): Set<string> {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const callsTheEdgeHalf = (src: string, fileName?: string) => {
  const ids = identifiersOf(src, fileName);
  return ids.has("executeAssignedRun") || ids.has("setCentralSync");
};

describe("doc 81 Đợt 8 Q1 — the edge half of the central abort is LATENT (measured)", () => {
  const files: string[] = [];
  for (const d of ["server", "scripts", "deploy", "shared"]) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d), files);

  it("the scan sees the production edge entry and the runtime itself (instrument check: a scan that sees nothing proves nothing)", () => {
    const seen = files.map(rel);
    // the parser keeps real code and drops comments / strings
    expect(callsTheEdgeHalf(fs.readFileSync(path.join(ROOT, "server/services/edge/edgeRuntime.ts"), "utf8"))).toBe(true);
    expect(callsTheEdgeHalf("// executeAssignedRun(x)\n/* setCentralSync(y) */\nconst u = 'http://h executeAssignedRun';")).toBe(false);
    expect(callsTheEdgeHalf("import { executeAssignedRun as go } from './edgeRuntime'; go(r);")).toBe(true);
    expect(callsTheEdgeHalf("const m = await import('./edgeRuntime'); m.setCentralSync(f);")).toBe(true);
    expect(seen).toContain("server/edge/edgeGatewayMain.ts");
    expect(seen).toContain("server/services/edge/edgeGatewayRuntime.ts");
    expect(seen).toContain("server/services/edge/edgeRuntime.ts");
  });

  it("★ executeAssignedRun / setCentralSync have no production caller outside edgeRuntime.ts (else: PROCEDURE above)", () => {
    const callers = files
      .filter((f) => rel(f) !== "server/services/edge/edgeRuntime.ts")
      .filter((f) => callsTheEdgeHalf(fs.readFileSync(f, "utf8"), f))
      .map(rel)
      .sort();
    expect(callers).toEqual(WIRED);
  });

  it("★ the production edge gateway does not load the run-execution runtime (read + publish + buffer only)", () => {
    const importsOf = (src: string): string[] => {
      const sf = ts.createSourceFile("g.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
      const out: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
        if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push(n.arguments[0].text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    };
    const gatewayImports = ["server/edge/edgeGatewayMain.ts", "server/services/edge/edgeGatewayRuntime.ts"].flatMap((f) =>
      importsOf(fs.readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(gatewayImports).toContain("./edgeCoordinator"); // instrument check: its real (registry / heartbeat) imports are seen
    expect(gatewayImports.filter((m) => /(^|\/)edgeRuntime$|foeEngine|orchestration\//.test(m))).toEqual([]);
    // 2026-10-12 doc 81 Đợt 9 S — the ONE execution door of the gateway: the node agent, loaded only behind its flag
    expect(gatewayImports.filter((m) => /edgeExecution/.test(m)).sort()).toEqual(["./edgeExecutionAgent", "./edgeExecutionAgent"]); // start + stop
    const rt = fs.readFileSync(path.join(ROOT, "server/services/edge/edgeGatewayRuntime.ts"), "utf8");
    expect(rt).toMatch(/if \(process\.env\.EDGE_EXECUTION_ENABLED === "true" \|\| process\.env\.EDGE_EXECUTION_ENABLED === "1"\) \{[\s\S]*?startEdgeExecutionFromEnv\(\)/);
  });

  // 2026-10-12 doc 81 Đợt 9 S — re-pinned (was: "only POST /edge/sync"): the node protocol now exists, in its own file, and EVERY
  // one of its routes is behind the node credential (requireEdgeNode — never an API key). Scans BOTH files (the old pin read
  // router.ts only and would have stayed green while edgeNodeRoutes.ts opened routes).
  it("★ central's edge routes: POST /edge/sync (API key) + exactly the six node-protocol routes, each behind the node credential", () => {
    const routesOf = (rel: string) => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      return [...src.matchAll(/\.(get|post|put|patch|delete)\(\s*["'](\/edge\/[^"']*)["'],\s*([\w.]+)/g)].map((m) => ({ route: `${m[1].toUpperCase()} ${m[2]}`, first: m[3] }));
    };
    expect(routesOf("server/api/v1/router.ts").map((r) => r.route)).toEqual(["POST /edge/sync"]);
    const node = routesOf("server/api/v1/edgeNodeRoutes.ts");
    expect(node.map((r) => r.route)).toEqual([
      "POST /edge/node/pull",
      "POST /edge/node/runs/:runId/claim",
      "POST /edge/node/runs/:runId/progress",
      "POST /edge/node/runs/:runId/complete",
      "POST /edge/node/runs/:runId/release",
      "POST /edge/node/runs/:runId/interrupted",
    ]);
    expect(node.every((r) => r.first === "auth")).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, "server/api/v1/edgeNodeRoutes.ts"), "utf8")).toMatch(/const auth = requireEdgeNode\(\);/);
  });

  // doc 81 Đợt 8 final wave (review Q #5) — the REST pin above sees only `/api/v1` `/edge/*` string routes. A node's runs ARE
  // listed by the tRPC procedure `edgeRuntime.nodeStatus`, but for PEOPLE only: a session `protectedProcedure` (machine_monitoring
  // canView, scope-filtered), never an API key. This pins that, so a future API-key / edge-callable variant trips here; the
  // production-caller census (`WIRED = []`) stays the real guard that no edge executes assigned runs.
  it("★ the tRPC edgeRuntime.nodeStatus listing is a SESSION procedure for people (not an API-key / edge-callable door)", () => {
    const r = fs.readFileSync(path.join(ROOT, "server/routers/edgeRuntimeRouter.ts"), "utf8");
    const m = r.match(/\n\s*nodeStatus:\s*(\w+)/);
    expect(m?.[1]).toBe("protectedProcedure");
    expect(r).not.toMatch(/apiKey|ApiKey|publicProcedure/);
  });
});
