/**
 * Sprint F1.1 — stubDriver unit tests (fake timers for subscribe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StubDriver } from "./stubDriver";
import type { OtSample, OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "temp", address: "DB1.0", dataType: "float", scale: 10, offset: 5 },
  { tagKey: "run", address: "M0.0", dataType: "bool" },
];

describe("StubDriver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connect sets connected; disconnect clears it", async () => {
    const d = new StubDriver();
    expect(d.isConnected()).toBe(false);
    await d.connect({ endpoint: "stub://x" });
    expect(d.isConnected()).toBe(true);
    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("readTags throws when not connected", async () => {
    const d = new StubDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  it("readTags returns one good sample per tag with correct value types", async () => {
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://x" });
    const samples = await d.readTags(tags);
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.quality === "good")).toBe(true);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(typeof temp.value).toBe("number");
    expect(typeof run.value).toBe("boolean");
  });

  it("subscribe emits samples on the interval and stops after close", async () => {
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://x" });
    const received: OtSample[] = [];
    const handle = await d.subscribe(tags, (s) => { received.push(s); }, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(received.length).toBe(2); // one tick × 2 tags

    await handle.close();
    received.length = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(received.length).toBe(0);
  });

  it("writeTags is disabled in F1.1 (ok:false)", async () => {
    const d = new StubDriver();
    const res = await d.writeTags([{ tagKey: "run", address: "M0.0", value: true }]);
    expect(res).toHaveLength(1);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/disabled in F1.1/);
  });

  it("health reflects connection state", async () => {
    const d = new StubDriver();
    let h = await d.health();
    expect(h.connected).toBe(false);
    expect(h.protocol).toBe("stub");
    await d.connect({ endpoint: "stub://x" });
    h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.lastOkAt).toBeInstanceOf(Date);
  });
});
