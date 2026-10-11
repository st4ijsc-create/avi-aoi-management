/**
 * doc 81 Đợt 9 task T1 + T2 — S7 program checksum through the documented S7comm block functions, tested against the
 * in-process simulator (__s7commSim.ts, 127.0.0.1 port 0, closed in afterAll). Never a real device or shared service.
 *
 * Oracles independent of the product client:
 *   • request BYTES are compared with fixed vectors transcribed from Snap7 s7_micro_client.cpp (opListBlocks,
 *     opListBlocksOfType, opAgBlockInfo) and s7_isotcp.cpp (BuildControlPDU) — not produced by the client;
 *   • the expected program checksum is recomputed HERE from the documented formula (s7BlockChecksum.ts header), over the
 *     simulator's own program (what the simulated controller holds), with node:crypto;
 *   • hangs are asserted with explicit wall-clock bounds, never the vitest timeout.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import net from "node:net";
import { createHash } from "node:crypto";
import { startS7commSim, type S7commSim, type SimBlock, type SimFault } from "./__s7commSim";
import { combineS7BlockChecksums, readS7ProgramBlocks, readS7ProgramChecksum, S7_CHECKSUM_SOURCE, S7_PROGRAM_CHECKSUM_DEADLINE_MS } from "./s7BlockChecksum";
import { S7Driver } from "./s7Driver";
import { programChecksumCapable, readAdapterProgramCheck } from "../programChecksum";

const PROGRAM: SimBlock[] = [
  { type: "FB", number: 10, loadSize: 512, mc7Size: 300, checksum: 0x1a2b },
  { type: "OB", number: 1, loadSize: 400, mc7Size: 250, checksum: 0xbeef },
  { type: "DB", number: 2, loadSize: 120, mc7Size: 40, checksum: 0x0007 },
  { type: "FC", number: 3, loadSize: 230, mc7Size: 150, checksum: 0x4000 },
  { type: "DB", number: 1, loadSize: 100, mc7Size: 36, checksum: 0xffff },
  { type: "OB", number: 100, loadSize: 90, mc7Size: 20, checksum: 0x0000 },
];

/** The documented formula, written out independently: sort by type code (OB 0x38, DB 0x41, FC 0x43, FB 0x45), then number. */
function expectedChecksum(blocks: SimBlock[]): string {
  const order: Record<string, number> = { OB: 0x38, DB: 0x41, FC: 0x43, FB: 0x45 };
  const lines = [...blocks]
    .sort((a, b) => order[a.type]! - order[b.type]! || a.number - b.number)
    .map((b) => `${b.type} ${b.number} load=${b.loadSize} mc7=${b.mc7Size} crc=${b.checksum.toString(16).padStart(4, "0")}`);
  return "s7:sha256:" + createHash("sha256").update(["s7-blockinfo-v1", ...lines].join("\n"), "utf8").digest("hex");
}

let sim: S7commSim;
const target = () => ({ host: "127.0.0.1", port: sim.port, rack: 0, slot: 1 });
const hex = (b: Buffer) => b.toString("hex");
/** S7 PDU bytes with the 2-byte PDU reference (offsets 4..5) masked — the reference is the client's own counter. */
const masked = (b: Buffer) => {
  const c = Buffer.from(b);
  c[4] = 0;
  c[5] = 0;
  return hex(c);
};
async function waitFor(cond: () => boolean, ms = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}

beforeAll(async () => {
  sim = await startS7commSim({ program: PROGRAM, rack: 0, slot: 1 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => {
  sim.setProgram(PROGRAM);
  sim.setFault(null);
  sim.setListChunk(50);
  sim.setListAllOrder([0x38, 0x45, 0x43, 0x46, 0x44, 0x41, 0x42]);
  sim.pdus.length = 0;
  sim.connectRequests.length = 0;
});

describe("T1 — request bytes match the documented telegrams (Snap7 vectors)", () => {
  it("★ COTP CR, setup communication, list all, list of type (first + follow-up), block info", async () => {
    sim.setProgram([{ type: "DB", number: 1, loadSize: 1, mc7Size: 1, checksum: 1 }, { type: "DB", number: 7, loadSize: 2, mc7Size: 2, checksum: 2 }]);
    sim.setListChunk(1); // forces one follow-up telegram for the DB list
    await readS7ProgramChecksum(target());
    // BuildControlPDU: TPKT 03 00 00 16 · LI 0x11 · CR 0xE0 · dst ref 0000 · src ref 0001 · class 00 · C0 01 0A · C1 02 0100 · C2 02 (PG<<8)+rack*32+slot
    expect(hex(sim.connectRequests[0]!)).toBe("0300001611e00000000100c0010ac1020100c2020101");
    const p = sim.pdus.map((x) => masked(x.bytes));
    // setup communication: job, param 8, data 0 · F0 00 · AmQ 0001 0001 · PDU 01E0 (480)
    expect(p[0]).toBe("320100000000000800" + "00" + "f0000001000101e0");
    // opListBlocks: userdata, param 8, data 4 · 00 01 12 04 11 43 01 00 · 0A 00 00 00
    expect(p[1]).toBe("3207000000000008000400011204114301000a000000");
    // opListBlocksOfType (DB, first): param 8, data 6 · 00 01 12 04 11 43 02 00 · FF 09 0002 30 41
    expect(p[2]).toBe("320700000000000800060001120411430200ff0900023041");
    // follow-up: param 12, data 4 · 00 01 12 08 11 43 02 <seq of the PLC's answer> 00000000 · 0A 00 00 00
    const seq = sim.pdus[3]!.bytes[17]!;
    expect(seq).toBeGreaterThan(0);
    expect(p[3]).toBe("32070000000000" + "0c0004" + "00011208114302" + seq.toString(16).padStart(2, "0") + "00000000" + "0a000000");
    // opAgBlockInfo (DB 1): param 8, data 12 · 00 01 12 04 11 43 03 00 · FF 09 0008 30 41 '00001' 'A'
    expect(p[4]).toBe("320700000000000800" + "0c" + "0001120411430300" + "ff0900083041" + "3030303031" + "41");
    expect(p[5]).toBe("320700000000000800" + "0c" + "0001120411430300" + "ff0900083041" + "3030303037" + "41");
    expect(p).toHaveLength(6);
  });
});

describe("T1 — the program checksum (documented formula)", () => {
  it("★ equals the formula recomputed independently over the simulated program; the connection is released afterwards", async () => {
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum(PROGRAM));
    expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
  });

  it("the called TSAP carries rack and slot (PG connection): a controller at rack 1 / slot 3 answers only to that", async () => {
    const other = await startS7commSim({ program: PROGRAM, rack: 1, slot: 3 });
    try {
      expect(await readS7ProgramChecksum({ host: "127.0.0.1", port: other.port, rack: 1, slot: 3 })).toBe(expectedChecksum(PROGRAM));
      expect(hex(other.connectRequests[0]!).slice(-8)).toBe("c2020123"); // (0x01 << 8) + 1 * 0x20 + 3
      await expect(readS7ProgramChecksum({ host: "127.0.0.1", port: other.port, rack: 0, slot: 3 })).rejects.toThrow(/s7/);
    } finally {
      await other.close();
    }
  });

  it("a block list without one of the program block types (here FB) ⇒ rejected (never read as 'no FB')", async () => {
    sim.setListAllOrder([0x38, 0x43, 0x46, 0x44, 0x41, 0x42]);
    await expect(readS7ProgramChecksum(target())).rejects.toThrow(/no FB entry/);
  });

  it("the block infos are read as the documentation lays them out (load size, MC7 size, checksum)", async () => {
    const blocks = await readS7ProgramBlocks(target());
    expect(blocks).toHaveLength(PROGRAM.length);
    for (const b of PROGRAM) expect(blocks).toContainEqual(b);
  });

  it("★ T2: changing ONE block (its checksum, load size or MC7 size) ⇒ a different program checksum; restoring it ⇒ the same again", async () => {
    const base = await readS7ProgramChecksum(target());
    for (const patch of [{ checksum: 0x1a2c }, { loadSize: 513 }, { mc7Size: 301 }]) {
      sim.setProgram(PROGRAM);
      sim.patchBlock("FB", 10, patch);
      const changed = await readS7ProgramChecksum(target());
      expect(changed).not.toBe(base);
      expect(changed).toBe(expectedChecksum(PROGRAM.map((b) => (b.type === "FB" ? { ...b, ...patch } : b))));
    }
    sim.setProgram(PROGRAM);
    expect(await readS7ProgramChecksum(target())).toBe(base);
  });

  it("a block added or deleted ⇒ a different checksum", async () => {
    const base = await readS7ProgramChecksum(target());
    sim.setProgram([...PROGRAM, { type: "FC", number: 4, loadSize: 1, mc7Size: 1, checksum: 1 }]);
    expect(await readS7ProgramChecksum(target())).not.toBe(base);
    sim.setProgram(PROGRAM.slice(1));
    expect(await readS7ProgramChecksum(target())).not.toBe(base);
  });

  it("deterministic: the order of the controller's lists does not matter", async () => {
    const base = await readS7ProgramChecksum(target());
    sim.setListAllOrder([0x42, 0x41, 0x44, 0x46, 0x43, 0x45, 0x38]);
    sim.setProgram([...PROGRAM].reverse());
    expect(await readS7ProgramChecksum(target())).toBe(base);
    expect(combineS7BlockChecksums([...PROGRAM].reverse())).toBe(base);
  });

  it("★ fragmented 'list blocks of type' answers (last data unit = 0x01) are followed until the end", async () => {
    const many: SimBlock[] = Array.from({ length: 130 }, (_, i) => ({ type: "DB" as const, number: i + 1, loadSize: 50 + i, mc7Size: 10 + i, checksum: (i * 977) & 0xffff }));
    sim.setProgram([...PROGRAM.filter((b) => b.type !== "DB"), ...many]);
    sim.setListChunk(7);
    const t0 = Date.now();
    expect(await readS7ProgramChecksum(target(), { deadlineMs: 5000 })).toBe(expectedChecksum([...PROGRAM.filter((b) => b.type !== "DB"), ...many]));
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("a type with no blocks is not listed (no list-of-type request), and an empty program still has a checksum", async () => {
    sim.setProgram([]);
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum([]));
    expect(sim.pdus.filter((x) => x.bytes[1] === 0x07 && x.bytes[16] === 0x02)).toHaveLength(0);
  });

  it("a duplicate block cannot be combined (thrown, never a checksum)", () => {
    expect(() => combineS7BlockChecksums([PROGRAM[0]!, { ...PROGRAM[0]! }])).toThrow(/duplicate/);
  });
});

describe("T1 — fail closed: every unexpected answer THROWS (never a checksum, never 'unsupported')", () => {
  const faults: Array<[Exclude<SimFault, null | "hang">, RegExp]> = [
    ["refuse", /error code 0x8104/],
    ["wrongNumber", /does not match/],
    ["shortInfo", /too short|length/],
    ["countMismatch", /inconsistent/],
    ["closeOnInfo", /closed|link error/],
    ["notExist", /return code 0x0a/],
    ["wrongType", /does not match/],
    ["wrongRef", /PDU reference mismatch/],
    ["infoLen72", /too short/],
    ["lenField", /data length inconsistent/],
  ];
  for (const [fault, why] of faults) {
    it(`★ ${fault} ⇒ rejected, connection released`, async () => {
      sim.setFault(fault);
      await expect(readS7ProgramChecksum(target())).rejects.toThrow(why);
      expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
    });
  }

  it("★ a controller that never answers ⇒ rejected at the deadline (bounded), socket destroyed", async () => {
    sim.setFault("hang");
    const t0 = Date.now();
    await expect(readS7ProgramChecksum(target(), { deadlineMs: 300 })).rejects.toThrow(/timeout after 300ms/);
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(1500);
    expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
  });

  it("the default deadline is the framework's bound (≤ 1000 ms)", () => {
    expect(S7_PROGRAM_CHECKSUM_DEADLINE_MS).toBeGreaterThan(0);
    expect(S7_PROGRAM_CHECKSUM_DEADLINE_MS).toBeLessThanOrEqual(1000);
  });

  it("★ cancelled by the caller's AbortSignal ⇒ rejected promptly, socket destroyed (nothing pending)", async () => {
    sim.setFault("hang");
    const ac = new AbortController();
    const p = readS7ProgramChecksum(target(), { signal: ac.signal, deadlineMs: 10_000 });
    expect(await waitFor(() => sim.stats().blockRequests > 0 && sim.stats().open === 1)).toBe(true);
    const t0 = Date.now();
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
  });

  it("an already-aborted signal ⇒ rejected without connecting", async () => {
    const before = sim.stats().accepted;
    const ac = new AbortController();
    ac.abort();
    await expect(readS7ProgramChecksum(target(), { signal: ac.signal })).rejects.toThrow(/aborted/);
    expect(sim.stats().accepted).toBe(before);
  });

  it("wrong rack / slot (the simulator does not confirm the connection) ⇒ rejected", async () => {
    await expect(readS7ProgramChecksum({ ...target(), slot: 2 })).rejects.toThrow(/s7/);
  });

  it("connection refused (nothing listening) ⇒ rejected", async () => {
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
    const port = (tmp.address() as net.AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));
    await expect(readS7ProgramChecksum({ host: "127.0.0.1", port, rack: 0, slot: 1 })).rejects.toThrow(/s7/);
  });
});

describe("T1 — S7Driver.readProgramChecksum (real nodes7 session against the simulator)", () => {
  let driver: S7Driver;
  beforeEach(async () => {
    driver = new S7Driver();
    await driver.connect({ endpoint: `127.0.0.1:${sim.port}`, options: { rack: 0, slot: 1 }, timeoutMs: 2000 });
  });

  it("★ supported, the documented checksum, source label 's7-blockinfo' — over a SEPARATE connection", async () => {
    const before = sim.stats().accepted;
    const r = await driver.readProgramChecksum();
    expect(r).toEqual({ supported: true, checksum: expectedChecksum(PROGRAM), source: S7_CHECKSUM_SOURCE });
    expect(S7_CHECKSUM_SOURCE).toBe("s7-blockinfo");
    expect(sim.stats().accepted).toBe(before + 1); // its own ISO-on-TCP connection, not the nodes7 one
    await driver.disconnect();
  });

  it("★ L-7: a STOP write is not delayed by a hanging checksum read (no shared queue)", async () => {
    sim.setFault("hang");
    const ac = new AbortController();
    const read = driver.readProgramChecksum({ signal: ac.signal });
    read.catch(() => undefined);
    expect(await waitFor(() => sim.stats().blockRequests > 0)).toBe(true);
    const writesBefore = sim.stats().writes;
    const t0 = Date.now();
    const res = await driver.writeTags([{ tagKey: "stop", address: "M0.0", dataType: "bool", value: true }]);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res).toEqual([{ tagKey: "stop", ok: true }]);
    expect(sim.stats().writes).toBe(writesBefore + 1);
    const t1 = Date.now();
    ac.abort();
    await expect(read).rejects.toThrow(/aborted/);
    expect(Date.now() - t1).toBeLessThan(300); // the driver passes the caller's signal down (cancelled, not timed out)
    await driver.disconnect();
  });

  it("not connected ⇒ throws, and nothing is sent to the controller", async () => {
    await driver.disconnect();
    const before = sim.stats().blockRequests;
    await expect(driver.readProgramChecksum()).rejects.toThrow();
    expect(sim.stats().blockRequests).toBe(before);
  });

  it("★ framework: an S7 adapter that opts in ⇒ 'verified' with the driver's source; the controller hanging ⇒ 'unreadable' (timeout), bounded", async () => {
    const row = { id: 9, code: "S7-PLC", protocol: "s7", connectionOptions: { rack: 0, slot: 1, programChecksum: "blockInfo" } };
    const ok = await readAdapterProgramCheck(row, { driverOf: () => driver });
    expect(ok).toEqual({ target: "adapter", id: 9, label: "S7-PLC", status: "verified", checksum: expectedChecksum(PROGRAM), source: "s7-blockinfo" });
    sim.setFault("hang");
    const t0 = Date.now();
    const bad = await readAdapterProgramCheck(row, { driverOf: () => driver, deadlineMs: 300 });
    expect(bad).toMatchObject({ status: "unreadable", reason: "timeout", source: "s7" });
    expect(bad.checksum).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(await waitFor(() => sim.stats().open === 1)).toBe(true); // only the nodes7 session is left
    sim.setFault("refuse");
    expect(await readAdapterProgramCheck(row, { driverOf: () => driver })).toMatchObject({ status: "unreadable", reason: "error" });
    await driver.disconnect();
  });
});

describe("T1 — which S7 adapters are expected to report a checksum (decided from the configuration row)", () => {
  it("★ S7 opts in with programChecksum; absent / false / 'off' / null ⇒ unsupported (no I/O)", async () => {
    expect(programChecksumCapable({ protocol: "s7", connectionOptions: { programChecksum: "blockInfo" } })).toBe(true);
    expect(programChecksumCapable({ protocol: "s7", connectionOptions: { programChecksum: "blockinfo-typo" } })).toBe(true); // a typo never silently disables
    expect(programChecksumCapable({ protocol: "s7", connectionOptions: { programChecksum: true } })).toBe(true);
    for (const opts of [{}, null, undefined, { programChecksum: false }, { programChecksum: "off" }, { programChecksum: null }, { simProgram: "abc" }]) {
      expect(programChecksumCapable({ protocol: "s7", connectionOptions: opts })).toBe(false);
    }
    // the flag means nothing on another protocol
    expect(programChecksumCapable({ protocol: "modbus", connectionOptions: { programChecksum: "blockInfo" } })).toBe(false);
    let looked = 0;
    const r = await readAdapterProgramCheck({ id: 3, protocol: "s7", connectionOptions: {} }, { driverOf: () => (looked++, undefined) });
    expect(r).toMatchObject({ status: "unsupported", source: "s7" });
    expect(looked).toBe(0);
  });

  it("★ opted in but not connected ⇒ 'unreadable' (notConnected), never 'unsupported'", async () => {
    const r = await readAdapterProgramCheck({ id: 4, protocol: "s7", connectionOptions: { programChecksum: "blockInfo" } }, { driverOf: () => undefined });
    expect(r).toMatchObject({ status: "unreadable", reason: "notConnected" });
  });
});
