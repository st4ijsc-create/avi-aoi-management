/**
 * doc 81 Đợt 10 task F2 — ruling R-10-s: the admin CLI around D's changeDeviceOwner. Unit level (fakes for the DB parts):
 * argv refusals (secrets in any spelling, self-asserted actor), admin PROVEN before any write (default path = the real
 * verifyCredentialAdmin module, mocked here), every assign / release audited (done AND refused), the cross-factory refusal
 * named clearly. The real-DB path (rolled back on _test) is edge-device-owner.dot10.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ verifyCalls: [] as unknown[], verifyThrows: null as null | { code: string; message: string }, otpThenOk: false }));
vi.mock("../server/services/edge/edgeNodeCredentials", () => {
  class EdgeCredentialError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return {
    EdgeCredentialError,
    verifyCredentialAdmin: vi.fn(async (login: { username: string; password: string | null; otp: string | null }) => {
      H.verifyCalls.push(login);
      if (H.otpThenOk && !login.otp) throw new EdgeCredentialError("otpRequired", "2FA code required");
      if (H.verifyThrows) throw new EdgeCredentialError(H.verifyThrows.code, H.verifyThrows.message);
      return { userId: 42, name: "Admin Nguyen" };
    }),
  };
});

import { runEdgeDeviceOwnerCli, type OwnerCliDeps } from "./edge-device-owner";

function io(env: Record<string, string> = { EDGE_OWNER_ADMIN_PASSWORD: "pw" }, prompts: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, promptSecret: async () => prompts.shift() ?? null } };
}
function deps(over: Partial<OwnerCliDeps> = {}) {
  const calls = { change: [] as unknown[], audit: [] as Array<{ action: string; status: string; details: Record<string, unknown> }>, nodeIdOf: [] as string[] };
  const d: OwnerCliDeps = {
    nodeIdOf: async (c) => (calls.nodeIdOf.push(c), c === "edge-line1" ? 7 : null),
    changeOwner: async (a) => (calls.change.push(a), { ok: true, ownerEpoch: 3, toEdgeNodeId: a.toEdgeNodeId, centralStops: null }),
    audit: async (e) => void calls.audit.push({ action: e.action, status: e.status, details: e.details }),
    listOwned: async () => [{ kind: "robot", id: 12, code: "R12", edgeNodeId: 7, nodeCode: "edge-line1", ownerEpoch: 3 }],
    ...over,
  };
  return { d, calls };
}
beforeEach(() => {
  H.verifyCalls.length = 0;
  H.verifyThrows = null;
  H.otpThenOk = false;
});

describe("R-10-s — argv: no secret and no self-asserted actor, in any spelling", () => {
  for (const bad of ["--password=x", "--password", "--PASSWORD=x", "--pass=x", "--pwd", "--otp=123456", "--otp", "--totp=1", "--2fa=1", "--secret=s", "--token=t"]) {
    it(`${bad} ⇒ exit 2, nothing proven, nothing changed`, async () => {
      const t = io();
      const { d, calls } = deps();
      expect(await runEdgeDeviceOwnerCli(["assign", "--robot", "12", "--node", "edge-line1", "--actor", "a", "--reason", "commission", bad], t.io, d)).toBe(2);
      expect(t.err.join("\n")).toMatch(/never taken from the command line/);
      expect(H.verifyCalls).toHaveLength(0);
      expect(calls.change).toHaveLength(0);
    });
  }
  for (const bad of ["--by", "--by=admin", "--actor-user-id", "--actor-user-id=1", "--user-id=1"]) {
    it(`${bad} ⇒ exit 2 (self-asserted actor)`, async () => {
      const t = io();
      const { d, calls } = deps();
      expect(await runEdgeDeviceOwnerCli(["release", "--robot", "12", "--actor", "a", "--reason", "replaced", bad, "1"], t.io, d)).toBe(2);
      expect(t.err.join(" | ")).toMatch(/self-asserted actor/);
      expect(calls.change).toHaveLength(0);
    });
  }
  it("bad shapes ⇒ exit 2: no device / both devices / non-integer id / assign without --node / release with --node / no actor / short reason / unknown option", async () => {
    const { d, calls } = deps();
    const cases = [
      ["assign", "--node", "edge-line1", "--actor", "a", "--reason", "abc"],
      ["assign", "--robot", "1", "--adapter", "2", "--node", "edge-line1", "--actor", "a", "--reason", "abc"],
      ["assign", "--robot", "1.5", "--node", "edge-line1", "--actor", "a", "--reason", "abc"],
      ["assign", "--robot", "1", "--actor", "a", "--reason", "abc"],
      ["release", "--robot", "1", "--node", "edge-line1", "--actor", "a", "--reason", "abc"],
      ["assign", "--robot", "1", "--node", "edge-line1", "--reason", "abc"],
      ["assign", "--robot", "1", "--node", "edge-line1", "--actor", "a", "--reason", "ab"],
      ["assign", "--robot", "1", "--node", "edge-line1", "--actor", "a", "--reason", "abc", "--force"],
      ["move", "--robot", "1"],
    ];
    for (const c of cases) expect(await runEdgeDeviceOwnerCli(c, io().io, d), c.join(" ")).toBe(2);
    expect(H.verifyCalls).toHaveLength(0);
    expect(calls.change).toHaveLength(0);
  });
});

describe("R-10-s — the admin is PROVEN (verifyCredentialAdmin) before any write", () => {
  it("default path: verifyCredentialAdmin({username, password from env, otp from env}) then changeDeviceOwner with the PROVEN id", async () => {
    const t = io({ EDGE_OWNER_ADMIN_PASSWORD: "pw", EDGE_OWNER_ADMIN_OTP: "123456" });
    const { d, calls } = deps();
    const { verifyAdmin: _omit, ...noVerify } = d;
    expect(await runEdgeDeviceOwnerCli(["assign", "--robot", "12", "--node", "edge-line1", "--actor", "admin.nguyen", "--reason", "commission line 1"], t.io, noVerify)).toBe(0);
    expect(H.verifyCalls).toEqual([{ username: "admin.nguyen", password: "pw", otp: "123456" }]);
    expect(calls.change).toEqual([{ kind: "robot", deviceId: 12, toEdgeNodeId: 7, actorUserId: 42, actorName: "Admin Nguyen — commission line 1" }]);
    expect(t.out.join("\n")).toMatch(/robot 12 is now owned by edge node "edge-line1" \(owner epoch 3\)/);
  });
  it("2FA on, no code in env ⇒ asked once on the terminal, then proven", async () => {
    H.otpThenOk = true;
    const t = io({ EDGE_OWNER_ADMIN_PASSWORD: "pw" }, ["654321"]);
    const { d, calls } = deps();
    const { verifyAdmin: _o, ...noVerify } = d;
    expect(await runEdgeDeviceOwnerCli(["release", "--adapter", "5", "--actor", "a", "--reason", "replaced"], t.io, noVerify)).toBe(0);
    expect((H.verifyCalls as Array<{ otp: string | null }>).map((c) => c.otp)).toEqual([null, "654321"]);
    expect(calls.change).toHaveLength(1);
  });
  it("refused login ⇒ exit 1, NO node read, NO change, NO audit by this CLI (the login itself is audited by verifyCredentials)", async () => {
    H.verifyThrows = { code: "notVerified", message: "Admin login refused (invalid)." };
    const t = io();
    const { d, calls } = deps();
    const { verifyAdmin: _o, ...noVerify } = d;
    expect(await runEdgeDeviceOwnerCli(["assign", "--robot", "12", "--node", "edge-line1", "--actor", "a", "--reason", "commission"], t.io, noVerify)).toBe(1);
    expect(t.err.join("\n")).toMatch(/refused \(notVerified\).*nothing was changed/);
    expect(calls.nodeIdOf).toHaveLength(0);
    expect(calls.change).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
  });
  it("a proof returning no user id ⇒ refused", async () => {
    const t = io();
    const { d, calls } = deps({ verifyAdmin: async () => ({ userId: 0, name: "" }) });
    expect(await runEdgeDeviceOwnerCli(["release", "--robot", "1", "--actor", "a", "--reason", "abc"], t.io, d)).toBe(1);
    expect(calls.change).toHaveLength(0);
  });
});

describe("R-10-s — outcomes are audited and the cross-factory refusal is named", () => {
  it("assign done ⇒ audit EDGE_DEVICE_OWNER_ASSIGN success with reason + epoch", async () => {
    const { d, calls } = deps({ verifyAdmin: async () => ({ userId: 42, name: "A" }) });
    expect(await runEdgeDeviceOwnerCli(["assign", "--adapter", "9", "--node", "edge-line1", "--actor", "a", "--reason", "commission"], io().io, d)).toBe(0);
    expect(calls.audit).toEqual([{ action: "EDGE_DEVICE_OWNER_ASSIGN", status: "success", details: expect.objectContaining({ kind: "adapter", deviceId: 9, toNode: "edge-line1", reason: "commission", outcome: "done", ownerEpoch: 3 }) }]);
  });
  it("release done with owed STOPs ⇒ the STOP outcome is printed and audited", async () => {
    const t = io();
    const { d, calls } = deps({
      verifyAdmin: async () => ({ userId: 42, name: "A" }),
      changeOwner: async () => ({ ok: true, ownerEpoch: 4, toEdgeNodeId: null, centralStops: { requestIds: [31, 32], outcome: "done", sent: "sent", detail: "", ackErrors: [] } }),
    });
    expect(await runEdgeDeviceOwnerCli(["release", "--robot", "12", "--actor", "a", "--reason", "gateway replaced"], t.io, d)).toBe(0);
    expect(t.out.join("\n")).toMatch(/owed STOP\(s\) 31, 32: done \(sent\)/);
    expect(calls.audit[0]).toMatchObject({ action: "EDGE_DEVICE_OWNER_RELEASE", status: "success", details: { centralStops: { requestIds: [31, 32], outcome: "done", sent: "sent" } } });
  });
  it("cross-factory (R-10-am) ⇒ exit 1, 'refused (cross-factory, R-10-am)' + how to fix, audited failure crossFactory", async () => {
    const t = io();
    const { d, calls } = deps({
      verifyAdmin: async () => ({ userId: 42, name: "A" }),
      changeOwner: async () => ({ ok: false, reason: "refused", detail: "robot 12 belongs to factory FA; edge node 7 serves factory FB — refused" }),
    });
    expect(await runEdgeDeviceOwnerCli(["assign", "--robot", "12", "--node", "edge-line1", "--actor", "a", "--reason", "commission"], t.io, d)).toBe(1);
    expect(t.err[0]).toBe("refused (cross-factory, R-10-am): robot 12 belongs to factory FA; edge node 7 serves factory FB — refused");
    expect(t.err[1]).toMatch(/ITS OWN factory/);
    expect(calls.audit).toEqual([{ action: "EDGE_DEVICE_OWNER_ASSIGN", status: "failure", details: expect.objectContaining({ outcome: "crossFactory" }) }]);
  });
  it("in-flight refusal / not found / unavailable / unknown node ⇒ exit 1 and audited failure", async () => {
    for (const [r, outcome] of [[{ ok: false, reason: "refused", detail: "device_adapters: adapter 9 has an in-flight command — ownership cannot change now" }, "refused"], [{ ok: false, reason: "not_found", detail: "robot 99 not found" }, "not_found"], [{ ok: false, reason: "unavailable", detail: "database unavailable" }, "unavailable"]] as const) {
      const t = io();
      const { d, calls } = deps({ verifyAdmin: async () => ({ userId: 42, name: "A" }), changeOwner: async () => r as never });
      expect(await runEdgeDeviceOwnerCli(["release", "--adapter", "9", "--actor", "a", "--reason", "abc"], t.io, d)).toBe(1);
      expect(calls.audit[0]).toMatchObject({ status: "failure", details: { outcome } });
      if (outcome === "refused") expect(t.err[0]).toMatch(/orphaned write intent/);
    }
    const t = io();
    const { d, calls } = deps({ verifyAdmin: async () => ({ userId: 42, name: "A" }) });
    expect(await runEdgeDeviceOwnerCli(["assign", "--robot", "1", "--node", "nope", "--actor", "a", "--reason", "abc"], t.io, d)).toBe(1);
    expect(t.err[0]).toMatch(/edge node "nope" is not registered/);
    expect(calls.change).toHaveLength(0);
    expect(calls.audit[0]).toMatchObject({ status: "failure", details: { outcome: "nodeNotFound" } });
  });
  it("an audit write failure never hides the outcome (warning, exit code of the change)", async () => {
    const t = io();
    const { d } = deps({ verifyAdmin: async () => ({ userId: 42, name: "A" }), audit: async () => Promise.reject(new Error("db down")) });
    expect(await runEdgeDeviceOwnerCli(["release", "--robot", "1", "--actor", "a", "--reason", "abc"], t.io, d)).toBe(0);
    expect(t.err.join("\n")).toMatch(/WARNING: audit row not written/);
  });
  it("list needs no admin and prints the owned devices", async () => {
    const t = io({});
    const { d } = deps();
    expect(await runEdgeDeviceOwnerCli(["list", "--node", "edge-line1"], t.io, d)).toBe(0);
    expect(t.out).toEqual(["robot\t12\tR12\tnode=edge-line1\townerEpoch=3"]);
    expect(H.verifyCalls).toHaveLength(0);
  });
});
