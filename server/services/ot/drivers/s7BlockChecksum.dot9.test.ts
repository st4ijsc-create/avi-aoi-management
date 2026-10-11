/**
 * doc 81 Đợt 9 task T1 + T2 (+ rulings R-9-a and "weak-integrity-binding") — S7 program checksum through the documented
 * S7comm functions, tested against the in-process simulator (__s7commSim.ts, 127.0.0.1 port 0, closed in afterAll).
 * Never a real device or shared service.
 *
 * Oracles independent of the product client:
 *   • request BYTES are compared with fixed vectors transcribed from Snap7 s7_micro_client.cpp (opReadSZL,
 *     opListBlocks, opListBlocksOfType, opAgBlockInfo) and s7_isotcp.cpp (BuildControlPDU) — not produced by the client;
 *   • the expected program checksum is recomputed HERE from the documented formula (s7BlockChecksum.ts header,
 *     "s7-blockinfo-v2"), over what the simulated controller holds (its program, identity, block list, endpoint);
 *   • hangs are asserted with explicit wall-clock bounds, never the vitest timeout.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import net from "node:net";
import { createHash } from "node:crypto";
import { startS7commSim, simBlockDefaults, SIM_IDENTITY, type S7commSim, type SimBlock, type SimFault, type SimIdentity } from "./__s7commSim";
import { combineS7ProgramSnapshot, readS7ProgramSnapshot, readS7ProgramChecksum, S7_CHECKSUM_SOURCE, S7_PROGRAM_CHECKSUM_DEADLINE_MS } from "./s7BlockChecksum";
import { S7Driver } from "./s7Driver";
import { programChecksumCapable, readAdapterProgramCheck } from "../programChecksum";

const PROGRAM: SimBlock[] = [
  { type: "FB", number: 10, loadSize: 512, mc7Size: 300, checksum: 0x1a2b },
  { type: "OB", number: 1, loadSize: 400, mc7Size: 250, checksum: 0xbeef },
  { type: "DB", number: 2, loadSize: 120, mc7Size: 40, checksum: 0x0007 },
  { type: "FC", number: 3, loadSize: 230, mc7Size: 150, checksum: 0x4000 },
  { type: "DB", number: 1, loadSize: 100, mc7Size: 36, checksum: 0xffff },
  { type: "OB", number: 100, loadSize: 90, mc7Size: 20, checksum: 0x0000 },
  { type: "SDB", number: 0, loadSize: 300, mc7Size: 0, checksum: 0x1111, author: "", family: "", name: "" },
  { type: "SFC", number: 46, loadSize: 0, mc7Size: 0, checksum: 0x2222, version: 0x10 },
  { type: "SFB", number: 4, loadSize: 0, mc7Size: 0, checksum: 0x3333, flags: 0x00 },
];
const ALL_CODES = [0x38, 0x45, 0x43, 0x46, 0x44, 0x41, 0x42]; // the order the simulator lists by default
const CODE: Record<string, number> = { OB: 0x38, DB: 0x41, SDB: 0x42, FC: 0x43, SFC: 0x44, FB: 0x45, SFB: 0x46 };

/** The documented formula ("s7-blockinfo-v2"), written out independently of the client. */
function expectedChecksum(
  blocks: SimBlock[],
  o: { identity?: SimIdentity; port?: number; rack?: number; slot?: number; listedCodes?: number[] } = {},
): string {
  const strip = (v: string) => v.replace(/[\0 ]+$/, "");
  const codes = [...(o.listedCodes ?? ALL_CODES)].sort((a, b) => a - b);
  const id = o.identity ?? SIM_IDENTITY;
  const canonical = [
    "s7-blockinfo-v2",
    ["endpoint", "127.0.0.1", o.port ?? sim.port, o.rack ?? 0, o.slot ?? 1],
    ["identity", strip(id.orderNumber), strip(id.serialNumber), strip(id.moduleName)],
    ["list", ...codes.map((c) => [c, blocks.filter((b) => CODE[b.type] === c).length])],
    ...[...blocks]
      .sort((a, b) => CODE[a.type]! - CODE[b.type]! || a.number - b.number)
      .map((b) => {
        const f = simBlockDefaults(b);
        return ["block", f.type, f.number, f.loadSize, f.mc7Size, f.checksum, f.version, f.flags, f.language, f.security, f.codeMs, f.codeDays, f.interfaceMs, f.interfaceDays, f.ssbSize, f.addSize, f.localDataSize, strip(f.author), strip(f.family), strip(f.name)];
      }),
  ];
  return "s7:sha256:" + createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
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
const withPatch = (type: SimBlock["type"], number: number, patch: Partial<SimBlock>) => PROGRAM.map((b) => (b.type === type && b.number === number ? { ...b, ...patch } : b));

beforeAll(async () => {
  sim = await startS7commSim({ program: PROGRAM, rack: 0, slot: 1 });
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => {
  sim.setProgram(PROGRAM);
  sim.setIdentity(SIM_IDENTITY);
  sim.setFault(null);
  sim.setListChunk(50);
  sim.setSzlChunk(100);
  sim.setListAllOrder(ALL_CODES);
  sim.pdus.length = 0;
  sim.connectRequests.length = 0;
});

describe("T1 — request bytes match the documented telegrams (Snap7 vectors)", () => {
  it("★ COTP CR, setup communication, read SZL 0x0011 / 0x001C, list all, list of type (first + follow-up), block info", async () => {
    sim.setProgram([{ type: "DB", number: 1, loadSize: 1, mc7Size: 1, checksum: 1 }, { type: "DB", number: 7, loadSize: 2, mc7Size: 2, checksum: 2 }]);
    sim.setListChunk(1); // forces one follow-up telegram for the DB list
    await readS7ProgramChecksum(target());
    // BuildControlPDU: TPKT 03 00 00 16 · LI 0x11 · CR 0xE0 · dst ref 0000 · src ref 0001 · class 00 · C0 01 0A · C1 02 0100 · C2 02 (PG<<8)+rack*32+slot
    expect(hex(sim.connectRequests[0]!)).toBe("0300001611e00000000100c0010ac1020100c2020101");
    const p = sim.pdus.map((x) => masked(x.bytes));
    // setup communication: job, param 8, data 0 · F0 00 · AmQ 0001 0001 · PDU 01E0 (480)
    expect(p[0]).toBe("32010000000000080000" + "f0000001000101e0");
    // opReadSZL first telegram: userdata, param 8, data 8 · 00 01 12 04 11 44 01 00 · FF 09 0004 <ID> <Index 0000>
    expect(p[1]).toBe("32070000000000080008" + "0001120411440100" + "ff090004" + "0011" + "0000");
    expect(p[2]).toBe("32070000000000080008" + "0001120411440100" + "ff090004" + "001c" + "0000");
    // opListBlocks: userdata, param 8, data 4 · 00 01 12 04 11 43 01 00 · 0A 00 00 00
    expect(p[3]).toBe("32070000000000080004" + "0001120411430100" + "0a000000");
    // opListBlocksOfType (DB, first): param 8, data 6 · 00 01 12 04 11 43 02 00 · FF 09 0002 30 41
    expect(p[4]).toBe("32070000000000080006" + "0001120411430200" + "ff0900023041");
    // follow-up: param 12, data 4 · 00 01 12 08 11 43 02 <seq of the PLC's answer> 00000000 · 0A 00 00 00
    const seq = sim.pdus[5]!.bytes[17]!;
    expect(seq).toBeGreaterThan(0);
    expect(p[5]).toBe("3207000000000" + "00c0004" + "00011208114302" + seq.toString(16).padStart(2, "0") + "00000000" + "0a000000");
    // opAgBlockInfo (DB 1 / DB 7): param 8, data 12 · 00 01 12 04 11 43 03 00 · FF 09 0008 30 41 '0000n' 'A'
    expect(p[6]).toBe("3207000000000008000c" + "0001120411430300" + "ff0900083041" + "3030303031" + "41");
    expect(p[7]).toBe("3207000000000008000c" + "0001120411430300" + "ff0900083041" + "3030303037" + "41");
    expect(p).toHaveLength(8);
  });

  it("★ a fragmented SZL answer is followed with opReadSZL's follow-up telegram (plen 8, syntax 0x12, the answer's sequence)", async () => {
    sim.setSzlChunk(1);
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum(PROGRAM));
    const followUps = sim.pdus.filter((x) => x.bytes[1] === 0x07 && x.bytes[15] === 0x44 && x.bytes[13] === 0x08);
    expect(followUps.length).toBe(2 + 5); // SZL 0x0011: 3 records ⇒ 2 follow-ups; 0x001C: 6 records ⇒ 5
    const f = followUps[0]!.bytes;
    expect(masked(f)).toBe("32070000000000" + "0c0004" + "00011208124401" + f[17]!.toString(16).padStart(2, "0") + "00000000" + "0a000000");
  });
});

describe("T1 — the program checksum (documented formula s7-blockinfo-v2)", () => {
  it("★ equals the formula recomputed independently over the simulated controller; the connection is released afterwards", async () => {
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum(PROGRAM));
    expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
  });

  it("the snapshot holds what the documentation lays out (identity, the full list, every block's fields)", async () => {
    const s = await readS7ProgramSnapshot(target());
    expect(s.identity).toEqual({ orderNumber: "6ES7 315-2EH14-0AB0", serialNumber: "S C-X4U421302009", moduleName: "CPU 315-2 PN/DP" });
    expect(s.endpoint).toEqual(target());
    expect([...s.listed].sort((a, b) => a.code - b.code)).toEqual([0x38, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46].map((c) => ({ code: c, count: PROGRAM.filter((b) => CODE[b.type] === c).length })));
    expect(s.blocks).toHaveLength(PROGRAM.length);
    expect(s.blocks).toContainEqual(simBlockDefaults(PROGRAM[0]!));
    expect(s.blocks).toContainEqual({ ...simBlockDefaults(PROGRAM[6]!), author: "", family: "", name: "" });
  });

  // R-9-a (1): the 16-bit block checksum is not cryptographic ⇒ every reported field of a block is in the SHA-256 input.
  const FIELDS: Array<[keyof SimBlock, unknown]> = [
    ["checksum", 0x1a2c], ["loadSize", 513], ["mc7Size", 301], ["version", 0x02], ["flags", 0x03], ["language", 0x01],
    ["codeMs", 3_600_001], ["codeDays", 14_001], ["interfaceMs", 1_800_001], ["interfaceDays", 13_991],
    ["ssbSize", 2], ["addSize", 2], ["localDataSize", 20], ["author", "EVIL"], ["family", "X"], ["name", "FB10b"],
  ];
  for (const [field, value] of FIELDS) {
    it(`★ R-9-a (1): changing ONE block's ${String(field)} ⇒ a different program checksum`, async () => {
      const base = expectedChecksum(PROGRAM);
      sim.patchBlock("FB", 10, { [field]: value } as Partial<SimBlock>);
      const changed = await readS7ProgramChecksum(target());
      expect(changed).not.toBe(base);
      expect(changed).toBe(expectedChecksum(withPatch("FB", 10, { [field]: value } as Partial<SimBlock>)));
    });
  }

  it("★ R-9-a (1): a crafted 16-bit collision (same block checksum, same lengths) with a new code timestamp is still detected", async () => {
    const base = await readS7ProgramChecksum(target());
    sim.patchBlock("OB", 1, { codeMs: 1, codeDays: 15_000, interfaceMs: 2, interfaceDays: 15_000 });
    expect(await readS7ProgramChecksum(target())).not.toBe(base);
  });

  it("★ R-9-a (2) coverage: SDB / SFC / SFB blocks are covered (a change there changes the checksum)", async () => {
    const base = await readS7ProgramChecksum(target());
    for (const [type, number] of [["SDB", 0], ["SFC", 46], ["SFB", 4]] as const) {
      sim.setProgram(PROGRAM);
      sim.patchBlock(type, number, { checksum: 0x9999 });
      expect(await readS7ProgramChecksum(target())).not.toBe(base);
    }
  });

  it("★ R-9-a (3): a block added or deleted ⇒ a different checksum (the list is part of the hash)", async () => {
    const base = await readS7ProgramChecksum(target());
    sim.setProgram([...PROGRAM, { type: "FC", number: 4, loadSize: 1, mc7Size: 1, checksum: 1 }]);
    expect(await readS7ProgramChecksum(target())).not.toBe(base);
    sim.setProgram(PROGRAM.filter((b) => !(b.type === "SFB")));
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum(PROGRAM.filter((b) => b.type !== "SFB")));
    expect(await readS7ProgramChecksum(target())).not.toBe(base);
  });

  it("★ R-9-a (3): the block LIST itself is hashed — a listed type with count 0 present or absent gives different checksums", async () => {
    const noSdb = PROGRAM.filter((b) => b.type !== "SDB");
    sim.setProgram(noSdb);
    const withEntry = await readS7ProgramChecksum(target()); // SDB listed with count 0
    sim.setListAllOrder(ALL_CODES.filter((c) => c !== 0x42));
    const withoutEntry = await readS7ProgramChecksum(target());
    expect(withoutEntry).not.toBe(withEntry);
    expect(withoutEntry).toBe(expectedChecksum(noSdb, { listedCodes: ALL_CODES.filter((c) => c !== 0x42) }));
  });

  it("deterministic: the order of the controller's lists does not matter", async () => {
    const base = await readS7ProgramChecksum(target());
    sim.setListAllOrder([...ALL_CODES].reverse());
    sim.setProgram([...PROGRAM].reverse());
    expect(await readS7ProgramChecksum(target())).toBe(base);
    const snap = await readS7ProgramSnapshot(target());
    expect(combineS7ProgramSnapshot({ ...snap, blocks: [...snap.blocks].reverse(), listed: [...snap.listed].reverse() })).toBe(base);
  });

  it("★ fragmented 'list blocks of type' answers (last data unit = 0x01) are followed until the end", async () => {
    const many: SimBlock[] = Array.from({ length: 130 }, (_, i) => ({ type: "DB" as const, number: i + 1, loadSize: 50 + i, mc7Size: 10 + i, checksum: (i * 977) & 0xffff }));
    const prog = [...PROGRAM.filter((b) => b.type !== "DB"), ...many];
    sim.setProgram(prog);
    sim.setListChunk(7);
    expect(await readS7ProgramChecksum(target(), { deadlineMs: 5000 })).toBe(expectedChecksum(prog));
  });

  it("a type with no blocks gets no list-of-type request, and an empty program still has a checksum", async () => {
    sim.setProgram([]);
    expect(await readS7ProgramChecksum(target())).toBe(expectedChecksum([]));
    expect(sim.pdus.filter((x) => x.bytes[1] === 0x07 && x.bytes[15] === 0x43 && x.bytes[16] === 0x02)).toHaveLength(0);
  });
});

describe("T1 — bound to the controller's identity (SZL) and the adapter's endpoint", () => {
  for (const field of ["orderNumber", "serialNumber", "moduleName"] as const) {
    it(`★ another controller (${field} differs) with the SAME program ⇒ a different checksum`, async () => {
      const base = await readS7ProgramChecksum(target());
      const other = { ...SIM_IDENTITY, [field]: SIM_IDENTITY[field].slice(0, -1) + "Z" };
      sim.setIdentity(other);
      const swapped = await readS7ProgramChecksum(target());
      expect(swapped).not.toBe(base);
      expect(swapped).toBe(expectedChecksum(PROGRAM, { identity: other }));
    });
  }

  for (const [fault, why] of [
    ["szlRefuse", /error code 0xd401/],
    ["szlNoSerial", /no serial number record/],
    ["szlWrongId", /SZL answer is not 0x11/],
    ["szlRecLen30", /record length 30/],
    ["szlCountWrong", /SZL 0x1c length inconsistent/],
  ] as const) {
    it(`★ identity unreadable (${fault}) ⇒ rejected (never a checksum without identity)`, async () => {
      sim.setFault(fault);
      await expect(readS7ProgramChecksum(target())).rejects.toThrow(why);
    });
  }

  it("★ an empty identity field ⇒ rejected", async () => {
    sim.setIdentity({ ...SIM_IDENTITY, serialNumber: "" });
    await expect(readS7ProgramChecksum(target())).rejects.toThrow(/empty serial number/);
  });

  it("★ the same controller (program + identity) behind another endpoint (port) ⇒ a different checksum", async () => {
    const twin = await startS7commSim({ program: PROGRAM, rack: 0, slot: 1 });
    try {
      const a = await readS7ProgramChecksum(target());
      const b = await readS7ProgramChecksum({ host: "127.0.0.1", port: twin.port, rack: 0, slot: 1 });
      expect(b).not.toBe(a);
      expect(b).toBe(expectedChecksum(PROGRAM, { port: twin.port }));
    } finally {
      await twin.close();
    }
  });

  it("★ rack / slot are in the called TSAP and in the checksum: a controller at rack 1 / slot 3", async () => {
    const other = await startS7commSim({ program: PROGRAM, rack: 1, slot: 3 });
    try {
      expect(await readS7ProgramChecksum({ host: "127.0.0.1", port: other.port, rack: 1, slot: 3 })).toBe(expectedChecksum(PROGRAM, { port: other.port, rack: 1, slot: 3 }));
      expect(hex(other.connectRequests[0]!).slice(-8)).toBe("c2020123"); // (0x01 << 8) + 1 * 0x20 + 3
      await expect(readS7ProgramChecksum({ host: "127.0.0.1", port: other.port, rack: 0, slot: 3 })).rejects.toThrow(/s7/);
    } finally {
      await other.close();
    }
  });

  it("the pure combiner: the endpoint's rack and slot are inputs", async () => {
    const snap = await readS7ProgramSnapshot(target());
    const base = combineS7ProgramSnapshot(snap);
    expect(combineS7ProgramSnapshot({ ...snap, endpoint: { ...snap.endpoint, rack: 1 } })).not.toBe(base);
    expect(combineS7ProgramSnapshot({ ...snap, endpoint: { ...snap.endpoint, slot: 2 } })).not.toBe(base);
    expect(combineS7ProgramSnapshot({ ...snap, endpoint: { ...snap.endpoint, host: "127.0.0.2" } })).not.toBe(base);
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
    ["listUnknownType", /listed block type 0x47 cannot be read/],
  ];
  for (const [fault, why] of faults) {
    it(`★ ${fault} ⇒ rejected, connection released`, async () => {
      sim.setFault(fault);
      await expect(readS7ProgramChecksum(target())).rejects.toThrow(why);
      expect(await waitFor(() => sim.stats().open === 0)).toBe(true);
    });
  }

  for (const [type, number] of [["FB", 10], ["SFC", 46], ["SDB", 0]] as const) {
    it(`★ R-9-a (2): a know-how-protected ${type} ⇒ the WHOLE checksum is rejected (the block is never skipped)`, async () => {
      sim.patchBlock(type, number, { security: 3 });
      await expect(readS7ProgramChecksum(target())).rejects.toThrow(new RegExp(`${type} ${number} is protected \\(block security 3\\)`));
      // refused AT that block: no block info is requested after it (read order: type code, then number)
      const order = [...PROGRAM].sort((a, b) => CODE[a.type]! - CODE[b.type]! || a.number - b.number);
      const at = order.findIndex((b) => b.type === type && b.number === number);
      expect(sim.pdus.filter((x) => x.bytes[1] === 0x07 && x.bytes[15] === 0x43 && x.bytes[16] === 0x03)).toHaveLength(at + 1);
    });
  }

  it("★ R-9-a (2): any other block security value is rejected too (only 0 = none passes)", async () => {
    sim.patchBlock("DB", 2, { security: 1 });
    await expect(readS7ProgramChecksum(target())).rejects.toThrow(/protected \(block security 1\)/);
  });

  it("the pure combiner refuses too: duplicate block, protected block, count ≠ list, empty identity, missing program type", async () => {
    const snap = await readS7ProgramSnapshot(target());
    expect(() => combineS7ProgramSnapshot({ ...snap, blocks: [...snap.blocks, { ...snap.blocks[0]! }] })).toThrow(/duplicate block/);
    expect(() => combineS7ProgramSnapshot({ ...snap, blocks: snap.blocks.map((b, i) => (i === 0 ? { ...b, security: 3 } : b)) })).toThrow(/protected/);
    expect(() => combineS7ProgramSnapshot({ ...snap, blocks: snap.blocks.slice(1) })).toThrow(/says/);
    expect(() => combineS7ProgramSnapshot({ ...snap, identity: { ...snap.identity, moduleName: "" } })).toThrow(/identity/);
    expect(() => combineS7ProgramSnapshot({ ...snap, listed: snap.listed.filter((l) => l.code !== 0x45), blocks: snap.blocks.filter((b) => b.type !== "FB") })).toThrow(/snapshot has no FB list entry/);
    expect(() => combineS7ProgramSnapshot({ ...snap, listed: [...snap.listed, { code: 0x47, count: 1 }] })).toThrow(/unknown block type/);
  });

  it("a block list without one of the program block types (here FB) ⇒ rejected (never read as 'no FB')", async () => {
    sim.setListAllOrder(ALL_CODES.filter((c) => c !== 0x45));
    await expect(readS7ProgramChecksum(target())).rejects.toThrow(/block list has no FB entry/);
  });

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
    sim.setFault(null);
    sim.patchBlock("FC", 3, { security: 3 });
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
