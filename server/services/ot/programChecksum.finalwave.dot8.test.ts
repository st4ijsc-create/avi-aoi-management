/**
 * doc 81 Đợt 8 final wave — controller program checksum reads (review of Group O):
 *   • M4 — a read is CANCELLED at its deadline: the real simulation driver (StubDriver, "hang" fault = a controller that
 *     never answers) is left with ZERO pending reads (oracle: the driver's own pending counter);
 *   • M1 — SINGLE-FLIGHT: concurrent reads of one adapter on one driver make ONE controller read; a settled read is never
 *     reused (no cache);
 *   • M3 — the source label is the DRIVER's own (sanitised), never hardcoded "sim".
 */
import { describe, it, expect } from "vitest";
import { readAdapterProgramCheck, sanitiseSource } from "./programChecksum";
import { StubDriver } from "./drivers/stubDriver";
import type { OtDriver } from "./otDriver";

const ROW = { id: 41, code: "A41", protocol: "stub", connectionOptions: { simProgram: "abc" } };

describe("final wave O M4 — cancellable checksum reads (no leaked pending read)", () => {
  it("★ a hung controller: the read ends 'unreadable/timeout' at the deadline AND the driver has nothing left pending", async () => {
    const sim = new StubDriver();
    await sim.connect({ endpoint: "stub://m4", options: { simProgram: "abc" } });
    sim.simSetProgramReadFault("hang");
    const t0 = Date.now();
    const c = await readAdapterProgramCheck(ROW, { deadlineMs: 60, driverOf: () => sim as unknown as OtDriver });
    expect(c).toMatchObject({ status: "unreadable", reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 0));
    expect(sim.simPendingReads).toBe(0);
    // 20 polls of a hung controller still leave nothing pending
    for (let i = 0; i < 20; i++) await readAdapterProgramCheck(ROW, { deadlineMs: 5, driverOf: () => sim as unknown as OtDriver });
    expect(sim.simPendingReads).toBe(0);
  });

  it("the driver receives an AbortSignal that is aborted exactly at the deadline (not before)", async () => {
    let seen: AbortSignal | undefined;
    const driver = {
      readProgramChecksum: (o?: { signal?: AbortSignal }) => {
        seen = o?.signal;
        return new Promise(() => undefined);
      },
    } as unknown as OtDriver;
    const p = readAdapterProgramCheck({ ...ROW, id: 42 }, { deadlineMs: 40, driverOf: () => driver });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen?.aborted).toBe(false);
    await p;
    expect(seen?.aborted).toBe(true);
  });
});

describe("final wave O M1 — single-flight per (driver, adapter)", () => {
  it("★ 5 concurrent reads ⇒ ONE controller read, all get its answer; the next read (after it settled) reads again", async () => {
    let calls = 0;
    let release: (v: unknown) => void = () => undefined;
    const driver = {
      readProgramChecksum: () => {
        calls++;
        return new Promise((r) => (release = r));
      },
    } as unknown as OtDriver;
    const reads = Array.from({ length: 5 }, () => readAdapterProgramCheck({ ...ROW, id: 43 }, { driverOf: () => driver }));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);
    release({ supported: true, checksum: "sha256:aa", source: "sim" });
    const out = await Promise.all(reads);
    expect(out.every((c) => c.status === "verified" && c.checksum === "sha256:aa")).toBe(true);
    const again = readAdapterProgramCheck({ ...ROW, id: 43 }, { driverOf: () => driver });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(2); // no cache of a settled read
    release({ supported: true, checksum: "sha256:bb", source: "sim" });
    expect((await again).checksum).toBe("sha256:bb");
  });

  it("different adapters / different drivers never share a read", async () => {
    let calls = 0;
    const mk = () => ({ readProgramChecksum: async () => (calls++, { supported: true, checksum: "sha256:cc", source: "sim" }) }) as unknown as OtDriver;
    const d1 = mk();
    const d2 = mk();
    await Promise.all([
      readAdapterProgramCheck({ ...ROW, id: 44 }, { driverOf: () => d1 }),
      readAdapterProgramCheck({ ...ROW, id: 45 }, { driverOf: () => d1 }),
      readAdapterProgramCheck({ ...ROW, id: 44 }, { driverOf: () => d2 }),
    ]);
    expect(calls).toBe(3);
  });
});

describe("final wave O M3 — the source label comes from the driver (sanitised)", () => {
  it("★ the real simulation driver says 'sim'; another driver's label is passed through; a host-like label is never shown", async () => {
    const sim = new StubDriver();
    await sim.connect({ endpoint: "stub://m3", options: { simProgram: "abc" } });
    expect((await readAdapterProgramCheck({ ...ROW, id: 46 }, { driverOf: () => sim as unknown as OtDriver })).source).toBe("sim");
    const real = { readProgramChecksum: async () => ({ supported: true, checksum: "sha256:dd", source: "s7-plus" }) } as unknown as OtDriver;
    expect((await readAdapterProgramCheck({ ...ROW, id: 47 }, { driverOf: () => real })).source).toBe("s7-plus");
    const leaky = { readProgramChecksum: async () => ({ supported: true, checksum: "sha256:ee", source: "plc@10.0.0.7:102" }) } as unknown as OtDriver;
    expect((await readAdapterProgramCheck({ ...ROW, id: 48 }, { driverOf: () => leaky })).source).toBe("unknown");
    expect(sanitiseSource(undefined)).toBe("unknown");
    expect(sanitiseSource("x".repeat(33))).toBe("unknown");
  });
});
