/**
 * X-EDGE-ABORT-TUOI (bản 3 C-b) — the three routes hand the services what the node asked for: `x-edge-node-accepts` carrying the exact token
 * `answer.abort_age` ⇒ `{ tuoiAbort: true }`; absent, or a token that only looks like it ⇒ `{ tuoiAbort: false }` (central answers as before).
 * Pure: the services are mocks that record their arguments; the router is a stand-in that keeps each route's last handler (the auth middleware
 * before it is not run: the request carries its node already). No DB, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const goi = vi.hoisted(() => ({ ds: [] as Array<{ ham: string; args: unknown[] }> }));
const tra = { http: 200, data: {} };
vi.mock("../../services/edge/edgeExecutionCentral", () => ({
  pullForNodeV2: async (...args: unknown[]) => (goi.ds.push({ ham: "pullForNodeV2", args }), tra),
  progressForNodeV2: async (...args: unknown[]) => (goi.ds.push({ ham: "progressForNodeV2", args }), tra),
  pullForNode: async (...args: unknown[]) => (goi.ds.push({ ham: "pullForNode", args }), tra),
  progressForNode: async (...args: unknown[]) => (goi.ds.push({ ham: "progressForNode", args }), tra),
}));
vi.mock("../../services/edge/edgeAuthorizeCentral", () => ({
  authorizeForNode: async (...args: unknown[]) => (goi.ds.push({ ham: "authorizeForNode", args }), tra),
}));
vi.mock("../../services/edge/edgeCentralCommon", () => ({ centralDb: async () => ({}), nodeProtocolVersion: async () => 2 })); // a v2 node (isV2)

import { registerEdgeNodeRoutes } from "./edgeNodeRoutes";

type Handler = (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown;
const tuyen = new Map<string, Handler>();
const ghi = (path: string, ...h: Handler[]) => void tuyen.set(path, h[h.length - 1]!);
registerEdgeNodeRoutes(new Proxy({}, { get: () => ghi }) as never);

const NUT = { credentialId: 1, nodeId: 7, nodeCode: "EDGE-A", factoryCode: null };
async function chay(path: string, header: string | undefined): Promise<{ ham: string; args: unknown[] }> {
  const req = { header: (n: string) => (n.toLowerCase() === "x-edge-node-accepts" ? header : undefined), body: { claimSeq: 1 }, params: { runId: "9" }, edgeNode: NUT };
  const res = { setHeader: () => res, status: () => res, json: () => res, send: () => res, headersSent: false };
  let loi: unknown;
  await tuyen.get(path)!(req, res, (e?: unknown) => void (loi = e));
  if (loi) throw loi;
  const g = goi.ds.pop();
  if (!g) throw new Error(`${path}: no service was called`);
  return g;
}

beforeEach(() => {
  goi.ds.length = 0;
});

describe("X-EDGE-ABORT-TUOI — the routes pass what the node asked for (nhanTuoiAbort)", () => {
  const TUYEN: Array<[string, string]> = [
    ["/edge/node/pull", "pullForNodeV2"],
    ["/edge/node/runs/:runId/progress", "progressForNodeV2"],
    ["/edge/node/runs/:runId/authorize", "authorizeForNode"],
  ];
  it.each(TUYEN)("★ ROUTE-TUOI %s — the exact token ⇒ { tuoiAbort: true }; absent ⇒ false; a look-alike token ⇒ false", async (path, ham) => {
    const co = await chay(path, "answer.abort_age");
    expect([co.ham, co.args[co.args.length - 1]], `${path}: with the token`).toEqual([ham, { tuoiAbort: true }]);
    const vang = await chay(path, undefined);
    expect([vang.ham, vang.args[vang.args.length - 1]], `${path}: no header`).toEqual([ham, { tuoiAbort: false }]);
    const gia = await chay(path, "answer.abort_agex, x.answer.abort_age");
    expect([gia.ham, gia.args[gia.args.length - 1]], `${path}: look-alike`).toEqual([ham, { tuoiAbort: false }]);
  });
});
