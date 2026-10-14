/**
 * doc 81 Đợt 12 final fix wave (R-12-e M-1) — the DEFAULT alert sink of a key-missing episode: console + alert stream once (a new
 * episode), and NO inbox rows from the ops-alert path (the rows are written once per episode by otStopEpochKeyEpisode — before,
 * raiseOpsAlert wrote an inbox row to every admin on every boot). A continuing episode raises nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const H = vi.hoisted(() => ({ ops: [] as Array<Record<string, unknown>> }));
vi.mock("../ops/pgChannelListener", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ops/pgChannelListener")>();
  return { ...orig, raiseOpsAlert: async (a: Record<string, unknown>) => void H.ops.push(a) };
});

import { startOtStopEpochSync } from "./otStopEpochSync";

const io = (open: boolean) => ({
  recipients: async () => [1],
  latest: async () => new Map<number, "no_key" | "key_restored">(open ? [[1, "no_key"]] : []),
  write: async () => undefined,
});
let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (stop) await stop();
  stop = null;
  H.ops.length = 0;
});
const until = async (c: () => boolean, ms = 2_000) => {
  const t0 = Date.now();
  while (!c() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 2));
  return c();
};

describe("R-12-e M-1 — default no_key alert", () => {
  it("a NEW episode: one ops alert, high severity, inbox false (the episode rows are the inbox)", async () => {
    stop = await startOtStopEpochSync({ env: {} as NodeJS.ProcessEnv, keyEpisodeIo: io(false) } as never);
    expect(await until(() => H.ops.length > 0)).toBe(true);
    expect(H.ops).toEqual([expect.objectContaining({ kind: "ot_stop_epoch_sync", severity: "high", inbox: false, metadata: { problem: "no_key" } })]);
    expect(String(H.ops[0].message)).toMatch(/OT_STOP_EPOCH_HMAC_KEY/);
  });
  it("a continuing episode: no ops alert at all", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    stop = await startOtStopEpochSync({ env: {} as NodeJS.ProcessEnv, keyEpisodeIo: io(true) } as never);
    expect(await until(() => logs.some((l) => /already alerted/.test(l)))).toBe(true);
    expect(H.ops).toEqual([]);
    vi.restoreAllMocks();
  });
});
