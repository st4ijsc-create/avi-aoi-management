/**
 * doc 81 Đợt 12 final fix wave (R-12-e M-1) — the persisted "no HMAC key" episode: the rule (in-memory rows) and the dedup query on
 * the REAL schema (_test, read-only: notifications.metadata is json, as for the Đợt 11 worm-size dedup).
 */
import { describe, it, expect } from "vitest";
import { settleKeyEpisode, readKeyEpisodeLatest, NO_KEY_FIX, type KeyEpisodeIo, type KeyEpisodeProblem } from "./otStopEpochKeyEpisode";

function io(admins: number[], rows: Array<{ uid: number; problem: KeyEpisodeProblem; msg?: string }> = []): KeyEpisodeIo & { rows: typeof rows } {
  return {
    rows,
    recipients: async () => admins,
    latest: async () => new Map(rows.map((r) => [r.uid, r.problem] as const)),
    write: async (uids, problem, _t, msg) => void uids.forEach((uid) => rows.push({ uid, problem, msg })),
  };
}

describe("settleKeyEpisode", () => {
  it("no key: a new episode writes one no_key row per admin; it continues while any admin holds it; a key closes it for those who hold it", async () => {
    const x = io([1, 2]);
    expect(await settleKeyEpisode(false, "neither OT_STOP_EPOCH_HMAC_KEY nor SECRET_ENCRYPTION_KEY is set", x)).toEqual({ outcome: "new_episode", recipients: [1, 2] });
    expect(x.rows[0].msg).toContain(NO_KEY_FIX);
    expect(await settleKeyEpisode(false, "r", x)).toEqual({ outcome: "episode_continues", recipients: [] });
    expect(x.rows).toHaveLength(2);
    expect(await settleKeyEpisode(true, null, x)).toEqual({ outcome: "episode_closed", recipients: [1, 2] });
    expect(await settleKeyEpisode(true, null, x)).toEqual({ outcome: "nothing", recipients: [] });
    expect(await settleKeyEpisode(false, "r", x)).toEqual({ outcome: "new_episode", recipients: [1, 2] });
  });
  it("no admin at all: alerted on that boot (nothing can be remembered); an unreadable store throws (the caller alerts)", async () => {
    expect((await settleKeyEpisode(false, "r", io([]))).outcome).toBe("new_episode");
    const bad: KeyEpisodeIo = { recipients: async () => [1], latest: async () => Promise.reject(new Error("db down")), write: async () => undefined };
    await expect(settleKeyEpisode(false, "r", bad)).rejects.toThrow(/db down/);
  });
  it("the rows name env variables only, never a value", async () => {
    const x = io([1]);
    await settleKeyEpisode(false, "OT_STOP_EPOCH_HMAC_KEY is set but shorter than 32 characters", x);
    expect(x.rows[0].msg).toMatch(/OT_STOP_EPOCH_HMAC_KEY/);
    expect(x.rows[0].msg).not.toMatch(/=/);
  });
});

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
describe.skipIf(!onTest)("readKeyEpisodeLatest on the real _test schema", () => {
  it("the dedup query runs (read-only) and returns a per-admin map", async () => {
    const { getDb } = await import("../../db/connection");
    const m = await readKeyEpisodeLatest((await getDb()) as never);
    expect(m instanceof Map).toBe(true);
    for (const v of m.values()) expect(["no_key", "key_restored"]).toContain(v);
  }, 60_000);
});
