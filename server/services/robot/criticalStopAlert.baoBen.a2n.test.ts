/**
 * SCADA R1b-2b-2a A2(n) T2 — raiseCriticalStopAlert's `baoBen`: the one answer the end of a latched run will rest on. true ⇔ every recipient has the inbox row, and there is at least
 * one recipient (M4). Another call writing the same row is no proof (Q-7, G12). Pure: sendNotification and the alert stream are recorders, getDb answers the durable pre-check from a list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  /** what sendNotification answers for this call (default: the row landed) */
  gui: null as null | ((userId: number, lan: number) => Promise<unknown>),
  sent: [] as Array<{ userId: number; key: string | undefined }>,
  /** the recipients the durable pre-check finds a row for */
  daCo: [] as number[],
}));
vi.mock("../notificationService", () => ({
  sendNotification: vi.fn(async (userId: number, _p: unknown, opts: { dedupKey?: string }) => {
    H.sent.push({ userId, key: opts.dedupKey });
    return H.gui ? H.gui(userId, H.sent.length) : { id: H.sent.length };
  }),
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: vi.fn() }));
vi.mock("../../db/connection", () => ({
  getDb: async () => ({ selectDistinct: () => ({ from: () => ({ where: async () => H.daCo.map((userId) => ({ userId })) }) }) }),
}));

import { CRITICAL_STOP_ALERT_DEADLINE_MS, __quenBoNhoKhuTrungChoTest, raiseCriticalStopAlert } from "./criticalStopAlert";

const KHOA = "foe_outcome_unknown_run_end:9:m:-:chot";
type Goi = Parameters<typeof raiseCriticalStopAlert>[0];
const nghe: Array<[string, boolean]> = [];
const bao = (ten: string, x: Partial<Goi> = {}) =>
  raiseCriticalStopAlert({ kind: "k", title: "t", message: "m", recipients: [7], dedupKey: KHOA, khuTrungBenVung: {}, baoBen: (b) => nghe.push([ten, b]), ...x });
/** a write that answers when the test says so */
function treo() {
  let tra!: (v: unknown) => void;
  const p = new Promise((r) => (tra = r));
  return { p, tra };
}

beforeEach(() => {
  H.gui = null;
  H.sent = [];
  H.daCo = [];
  nghe.length = 0;
  __quenBoNhoKhuTrungChoTest();
});

describe("A2(n) T2 — baoBen: is the URGENT stored?", () => {
  it("every recipient's row landed: true, once", async () => {
    await bao("a", { recipients: [7, 8] });
    expect(nghe).toEqual([["a", true]]);
    expect(H.sent.map((x) => x.userId)).toEqual([7, 8]);
  });

  it("no row (null, a refused write): false", async () => {
    H.gui = async () => null;
    await bao("null");
    H.gui = async () => {
      throw new Error("db down (test)");
    };
    await bao("nem");
    expect(nghe).toEqual([
      ["null", false],
      ["nem", false],
    ]);
  });

  it("one recipient's row did not land: false, the others keep theirs", async () => {
    H.gui = async (u) => (u === 8 ? null : { id: 1 });
    await bao("a", { recipients: [7, 8] });
    expect(nghe).toEqual([["a", false]]);
  });

  it("M4 no recipient: not durable, nothing written, whatever the ids", async () => {
    await bao("rong", { recipients: [] });
    await bao("sai", { recipients: [0, -1, Number.NaN] });
    expect(nghe).toEqual([
      ["rong", false],
      ["sai", false],
    ]);
    expect(H.sent).toEqual([]);
  });

  it("a duplicate on a row that IS durable: true, no second row (the fixed key)", async () => {
    H.daCo = [7, 8];
    await bao("a", { recipients: [7, 8] });
    expect(nghe).toEqual([["a", true]]);
    expect(H.sent).toEqual([]);
  });

  it("a duplicate in this process, the pre-check finding nothing: true, no second row", async () => {
    await bao("a");
    await bao("b");
    expect(nghe).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(H.sent).toHaveLength(1);
  });

  it("a new recipient on a durable key: only the new row, true once it landed", async () => {
    H.daCo = [7];
    await bao("a", { recipients: [7, 8] });
    expect(H.sent.map((x) => x.userId)).toEqual([8]);
    expect(nghe).toEqual([["a", true]]);
  });

  it("the deadline passes on a write that never answers: false, and the caller is released", async () => {
    await bao("nong"); // loads the lazy modules: a fake clock does not run an import
    __quenBoNhoKhuTrungChoTest();
    nghe.length = 0;
    H.gui = () => new Promise(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const p = bao("a");
      await vi.advanceTimersByTimeAsync(CRITICAL_STOP_ALERT_DEADLINE_MS + 1);
      await p;
    } finally {
      vi.useRealTimers();
    }
    expect(nghe).toEqual([["a", false]]);
  });

  it("told after the first try, not before it, and a later retry does not answer again", async () => {
    const w = treo();
    let lan = 0;
    H.gui = async () => (++lan === 1 ? w.p : { id: 2 });
    const p = bao("a", { retryUntilPersisted: { everyMs: 5, attempts: 3 } });
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    expect(nghe).toEqual([]);
    w.tra(null);
    await p;
    expect(nghe).toEqual([["a", false]]);
    await vi.waitFor(() => expect(H.sent).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(nghe).toEqual([["a", false]]);
  });

  it("a listener that throws loses neither the promise nor the retry", async () => {
    H.gui = async (_u, lan) => (lan === 1 ? null : { id: 2 });
    await expect(
      bao("a", {
        retryUntilPersisted: { everyMs: 5, attempts: 3 },
        baoBen: () => {
          throw new Error("listener (test)");
        },
      }),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(H.sent).toHaveLength(2));
  });

  it("an alert with no listener behaves as before", async () => {
    await expect(raiseCriticalStopAlert({ kind: "k", title: "t", message: "m", recipients: [7], dedupKey: KHOA })).resolves.toBeUndefined();
    expect(H.sent).toHaveLength(1);
  });
});

describe("A2(n) T2 — Q-7: another call writing is no proof", () => {
  it("G12 two calls on one key, the first fails: not durable", async () => {
    const w = treo();
    H.gui = () => w.p;
    const a = bao("A");
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    await bao("B");
    expect(nghe).toEqual([["B", false]]); // before A's answer: B has no row to speak of
    w.tra(null);
    await a;
    expect(nghe).toEqual([
      ["B", false],
      ["A", false],
    ]);
    expect(H.sent).toHaveLength(1);
  });

  it("G12b the first lands: B stays 'not yet' (it saw no row), A true, one row", async () => {
    const w = treo();
    H.gui = () => w.p;
    const a = bao("A");
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    await bao("B");
    w.tra({ id: 1 });
    await a;
    expect(nghe).toEqual([
      ["B", false],
      ["A", true],
    ]);
    expect(H.sent).toHaveLength(1);
  });

  it("G12c the first lands: the retry of the call that stepped aside writes no second row", async () => {
    const w = treo();
    H.gui = () => w.p;
    const a = bao("A");
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    const b = bao("B", { retryUntilPersisted: { everyMs: 5, attempts: 2 } });
    await b;
    w.tra({ id: 1 });
    await a;
    await new Promise((r) => setTimeout(r, 40));
    expect(H.sent).toHaveLength(1);
  });

  it("G12d the first fails: the retry of the call that stepped aside writes the row, under its retry key", async () => {
    const w = treo();
    H.gui = async (_u, lan) => (lan === 1 ? w.p : { id: 2 });
    const a = bao("A");
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    await bao("B", { retryUntilPersisted: { everyMs: 20, attempts: 3 } });
    w.tra(null);
    await a;
    await vi.waitFor(() => expect(H.sent).toHaveLength(2));
    expect(H.sent.map((x) => x.key)).toEqual([KHOA, `${KHOA}:retry1`]);
  });

  it("G12e a row landed by a retry counts for every call: the other's retry writes no third row", async () => {
    const w = treo();
    H.gui = async (_u, lan) => (lan === 1 ? w.p : { id: 2 });
    const a = bao("A", { retryUntilPersisted: { everyMs: 5, attempts: 2 } });
    await vi.waitFor(() => expect(H.sent).toHaveLength(1));
    await bao("B", { retryUntilPersisted: { everyMs: 5, attempts: 2 } });
    await vi.waitFor(() => expect(H.sent).toHaveLength(2)); // B's retry, A still writing: a write that never answers must not block the rescue
    w.tra(null);
    await a;
    await new Promise((r) => setTimeout(r, 40));
    expect(H.sent).toHaveLength(2);
  });
});
