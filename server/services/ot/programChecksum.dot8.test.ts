/**
 * doc 81 Đợt 8 task O1 — controller program checksum capability.
 *
 * Oracles independent of product code:
 *   • the sim program "abc" ⇒ the FIPS 180-2 SHA-256 test vector ba7816bf…15ad (a fixed constant, not recomputed here);
 *   • "unsupported" is decided from the ADAPTER ROW alone (protocol + configuration): the driver lookup spy proves no
 *     device I/O happens for an adapter that cannot report a program checksum;
 *   • a hang is asserted with an explicit bounded wall-clock limit, never the vitest timeout.
 */
import { describe, it, expect, vi } from "vitest";
import { StubDriver } from "./drivers/stubDriver";
import { PROGRAM_CHECKSUM_READ_DEADLINE_MS, programChecksumCapable, readAdapterProgramCheck } from "./programChecksum";
import type { OtDriver } from "./otDriver";

const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // FIPS 180-2 B.1
const SHA256_ABD = "a52d159f262b2c6ddb724a61840befc36eb30c88877a4030b65cbe86298449c9"; // sha256("abd")

async function simDriver(program: string | undefined): Promise<StubDriver> {
  const d = new StubDriver();
  await d.connect({ endpoint: "stub://o1", options: program === undefined ? {} : { simProgram: program } });
  return d;
}
const simRow = (id = 1, program: string | null = "abc") => ({
  id,
  code: `SIM-${id}`,
  name: `sim ${id}`,
  protocol: "stub",
  connectionOptions: program === null ? {} : { simProgram: program },
});

describe("O1 — sim driver readProgramChecksum()", () => {
  it("★ a simulated program ⇒ supported, sha256 of the program text (fixed vector)", async () => {
    const d = await simDriver("abc");
    expect(await d.readProgramChecksum()).toEqual({ supported: true, checksum: `sha256:${SHA256_ABC}`, source: "sim" });
  });

  it("★ a program loaded into the sim controller afterwards (vendor tool, not this server) ⇒ a different checksum", async () => {
    const d = await simDriver("abc");
    d.simLoadProgram("abd");
    expect((await d.readProgramChecksum()).checksum).toBe(`sha256:${SHA256_ABD}`);
  });

  it("no simulated program configured ⇒ supported:false (stated plainly, never a checksum)", async () => {
    const d = await simDriver(undefined);
    const r = await d.readProgramChecksum();
    expect(r.supported).toBe(false);
    expect(r.checksum).toBeUndefined();
  });

  it("not connected ⇒ throws (never a value)", async () => {
    const d = await simDriver("abc");
    await d.disconnect();
    await expect(d.readProgramChecksum()).rejects.toThrow();
  });

  it("fault 'error' ⇒ throws; fault cleared ⇒ reads again", async () => {
    const d = await simDriver("abc");
    d.simSetProgramReadFault("error");
    await expect(d.readProgramChecksum()).rejects.toThrow();
    d.simSetProgramReadFault(null);
    expect((await d.readProgramChecksum()).checksum).toBe(`sha256:${SHA256_ABC}`);
  });
});

describe("O1 — readAdapterProgramCheck (the framework every consumer uses)", () => {
  it("default deadline is bounded (≤ the STOP DB-step deadline, 1000 ms)", () => {
    expect(PROGRAM_CHECKSUM_READ_DEADLINE_MS).toBeGreaterThan(0);
    expect(PROGRAM_CHECKSUM_READ_DEADLINE_MS).toBeLessThanOrEqual(1000);
  });

  for (const protocol of ["modbus", "opcua", "s7", "mitsubishi-mc", "ethernet-ip", "slmp", "plugin-x", undefined]) {
    it(`★ every other adapter (${String(protocol)}) ⇒ unsupported, decided from the row: no driver lookup at all`, async () => {
      const driverOf = vi.fn(() => undefined);
      const r = await readAdapterProgramCheck({ id: 7, code: "A7", name: "a7", protocol, connectionOptions: { simProgram: "abc" } }, { driverOf });
      expect(r).toMatchObject({ target: "adapter", id: 7, status: "unsupported" });
      expect(r.checksum).toBeUndefined();
      expect(driverOf).not.toHaveBeenCalled();
    });
  }

  it("a sim adapter WITHOUT a simulated program ⇒ unsupported (no lookup)", async () => {
    const driverOf = vi.fn(() => undefined);
    expect(programChecksumCapable(simRow(2, null))).toBe(false);
    expect((await readAdapterProgramCheck(simRow(2, null), { driverOf })).status).toBe("unsupported");
    expect(driverOf).not.toHaveBeenCalled();
  });

  it("★ supported + live sim driver ⇒ verified with the checksum", async () => {
    const d = await simDriver("abc");
    const r = await readAdapterProgramCheck(simRow(3), { driverOf: () => d });
    expect(r).toMatchObject({ target: "adapter", id: 3, label: "SIM-3", status: "verified", checksum: `sha256:${SHA256_ABC}`, source: "sim" });
  });

  it("★ FAIL CLOSED: supported but no live driver ⇒ unreadable (notConnected) — never 'unsupported'", async () => {
    const r = await readAdapterProgramCheck(simRow(4), { driverOf: () => undefined });
    expect(r).toMatchObject({ status: "unreadable", reason: "notConnected" });
    expect(r.checksum).toBeUndefined();
  });

  it("★ FAIL CLOSED: the read hangs ⇒ unreadable (timeout) within the deadline (bounded wall clock)", async () => {
    const d = await simDriver("abc");
    d.simSetProgramReadFault("hang");
    const t0 = Date.now();
    const r = await readAdapterProgramCheck(simRow(5), { driverOf: () => d, deadlineMs: 60 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ status: "unreadable", reason: "timeout" });
  });

  it("★ FAIL CLOSED: the read throws ⇒ unreadable (error); the error text (may name a host) is not carried", async () => {
    const d = await simDriver("abc");
    d.simSetProgramReadFault("error");
    const r = await readAdapterProgramCheck(simRow(6), { driverOf: () => d });
    expect(r).toMatchObject({ status: "unreadable", reason: "error" });
    expect(JSON.stringify(r)).not.toMatch(/fault|192\.|tcp:/i);
  });

  const odd = (impl: () => unknown): OtDriver => ({ isConnected: () => true, readProgramChecksum: impl }) as unknown as OtDriver;
  for (const [what, driver, reason] of [
    ["the driver has no readProgramChecksum", { isConnected: () => true } as unknown as OtDriver, "inconsistent"],
    ["the driver says supported:false although the adapter declares support", odd(async () => ({ supported: false, source: "x" })), "inconsistent"],
    ["supported without a checksum", odd(async () => ({ supported: true, source: "x" })), "invalid"],
    ["an empty checksum", odd(async () => ({ supported: true, checksum: "", source: "x" })), "invalid"],
    ["a non-string checksum", odd(async () => ({ supported: true, checksum: 42, source: "x" })), "invalid"],
    ["an oversized checksum", odd(async () => ({ supported: true, checksum: "a".repeat(300), source: "x" })), "invalid"],
    ["a null answer", odd(async () => null), "invalid"],
    ["a synchronous throw", odd(() => { throw new Error("boom"); }), "error"],
  ] as const) {
    it(`FAIL CLOSED: ${what} ⇒ unreadable (${reason})`, async () => {
      const r = await readAdapterProgramCheck(simRow(8), { driverOf: () => driver });
      expect(r).toMatchObject({ status: "unreadable", reason });
      expect(r.checksum).toBeUndefined();
    });
  }
});
