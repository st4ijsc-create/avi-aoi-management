/**
 * doc 81 Đợt 9 task T fix 1 (review #3) — GOLDEN ANSWER FRAMES that do not come from this group's offset table.
 *
 * No Snap7 server binary and no S7comm capture exist offline in the repo or the npm cache (searched node_modules + the
 * npm cache index: only `nodes7`). The answers below are therefore transcribed BY HAND, byte for byte, from a Snap7
 * SERVER source — the SCADACS FORK of Snap7 (it carries the FragmentMap / DURN code; not a release by the Snap7 author) —
 * the side that answers, independent of this client — fetched 2026-10-12:
 *   • src/core/s7_firmware.h (sha256 0274b0f4…dbf4a6): SZL_ID_0011_IDX_XXXX[124] and SZL_ID_001C_IDX_XXXX[352], the data
 *     parts Snap7 answers "from a physical CPU" (CPU 315-2 PN/DP) — copied VERBATIM (the arrays below);
 *   • src/core/s7_server.cpp (sha256 a0999b46…3444b5):
 *       – SZLSetup: answer params 00 01 12 08 12 84 01 <seq> + resvd + err;
 *       – SZLSendAnswer / SZLPrepareAnswerHeader: with PDU 240 a long answer is split — first telegram data
 *         FF 09 <len> ID Index + first (240-22-8)=210 bytes from LENTHDR on, "more follows"; follow-ups FF 09 <len> + the
 *         next ≤ (240-22-4)=214 bytes, same sequence number (GetNextSeqNr); every telegram of a FRAGMENTED answer carries
 *         resvd = 0x01<<8 | DURN (Đợt 10 F2, re-review N2): params byte 8 = the data-unit reference number (non-zero,
 *         DURN_FRAGMENTED below), byte 9 = "more follows" — this client ignores byte 8 (the test proves it does);
 *       – BLK_ListAll: one telegram, params 00 01 12 08 12 83 01 <seq> 0000 0000, data FF 09 00 1C + 7 entries in the
 *         order OB FB FC DB SDB SFC SFB;
 *       – BLK_ListBoT: data FF 09 <len> + {number, 0x12 (DB), BlockLangDB 0x05};
 *       – the LIVE BLK_GetBlkInfo (the DB answer; `BLK_DoBlockInfo_GetBlkInfo`, which answers BlkType 0x00, is dead code in
 *         that file — re-review N1): Cst_b 0x01, BlkType = the requested type 0x41, Cst_w1 = 0x4A00 / Cst_w2 = 0x0022 / SbbLen = 0x1400
 *         stored WITHOUT SwapWord (little-endian host ⇒ wire bytes 00 4A / 22 00 / 00 14), Cst_pp 0x7070, Unknown_1 0x01,
 *         BlkFlags 0x01, BlkLang 0x05, SubBlkType 0x0A, CodeTime_dy = IntfTime_dy = SwapWord(5800), BlkNumber,
 *         MC7Len = Size, LenLoadMem = Size + 92, Version 0x01, checksum 0x0000; always 78 bytes;
 *       – PerformFunctionNegotiate: ack_data, F0 00, AmQ echoed, PDU length.
 *   • The COTP CC is built from ITU-T X.224 (CC 0xD0, references, class 0, TPDU size / TSAP parameters).
 * The expected checksum is computed HERE from the documented formula over the values those Snap7 bytes encode (named
 * field by field below) — not by parsing the frames with any product code.
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { createHash } from "node:crypto";
import { readS7ProgramChecksum } from "./s7BlockChecksum";

const h = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex");
const bytes = (a: number[]) => Buffer.from(a);

// ── Snap7 s7_firmware.h, verbatim ───────────────────────────────────────────────────────────────────────────────────
const SZL_ID_0011_IDX_XXXX = bytes([
  0xFF,0x09,0x00,0x78,0x00,0x11,0x00,0x00,0x00,0x1C,0x00,0x04,0x00,0x01,0x36,0x45,0x53,0x37,0x20,
  0x33,0x31,0x35,0x2D,0x32,0x45,0x48,0x31,0x34,0x2D,0x30,0x41,0x42,0x30,0x20,0x00,0xC0,0x00,0x04,
  0x00,0x01,0x00,0x06,0x36,0x45,0x53,0x37,0x20,0x33,0x31,0x35,0x2D,0x32,0x45,0x48,0x31,0x34,0x2D,
  0x30,0x41,0x42,0x30,0x20,0x00,0xC0,0x00,0x04,0x00,0x01,0x00,0x07,0x20,0x20,0x20,0x20,0x20,0x20,
  0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x00,0xC0,0x56,0x03,0x02,
  0x06,0x00,0x81,0x42,0x6F,0x6F,0x74,0x20,0x4C,0x6F,0x61,0x64,0x65,0x72,0x20,0x20,0x20,0x20,0x20,
  0x20,0x20,0x20,0x20,0x00,0x00,0x41,0x20,0x09,0x09,
]);
const SZL_ID_001C_IDX_XXXX = bytes([
  0xFF,0x09,0x01,0x5C,0x00,0x1C,0x00,0x00,0x00,0x22,0x00,0x0A,0x00,0x01,0x53,0x4E,0x41,0x50,0x37,
  0x2D,0x53,0x45,0x52,0x56,0x45,0x52,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x43,0x50,0x55,0x20,0x33,0x31,0x35,0x2D,0x32,
  0x20,0x50,0x4E,0x2F,0x44,0x50,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x04,0x4F,0x72,0x69,0x67,0x69,0x6E,0x61,0x6C,0x20,0x53,0x69,0x65,0x6D,0x65,0x6E,0x73,0x20,
  0x45,0x71,0x75,0x69,0x70,0x6D,0x65,0x6E,0x74,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x05,0x53,0x20,
  0x43,0x2D,0x43,0x32,0x55,0x52,0x32,0x38,0x39,0x32,0x32,0x30,0x31,0x32,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x07,0x43,0x50,0x55,0x20,0x33,0x31,
  0x35,0x2D,0x32,0x20,0x50,0x4E,0x2F,0x44,0x50,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x08,0x4D,0x4D,0x43,0x20,0x32,0x36,0x37,0x46,0x46,0x31,
  0x31,0x46,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x09,0x00,0x2A,0xF6,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x0A,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0B,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
]);

/** One S7 userdata answer (Snap7 TS7ResHeader17 + TS7Params7 / TResFunGetBlockInfo): 10-byte header, 12-byte params. */
/** Snap7 (SCADACS fork) SZLPrepareAnswerHeader — a fragmented answer's params byte 8 is its data-unit reference number. */
const DURN_FRAGMENTED = 0x01;
function udAnswer(group: number, subfn: number, seq: number, last: number, data: Buffer, durn = 0x00): Buffer {
  const header = h(`32 07 0000 0000 000C ${data.length.toString(16).padStart(4, "0")}`);
  const params = Buffer.from([0x00, 0x01, 0x12, 0x08, 0x12, 0x80 | group, subfn, seq, durn, last, 0x00, 0x00]);
  return Buffer.concat([h("02 F0 80"), header, params, data]);
}
const tpkt = (payload: Buffer) => Buffer.concat([Buffer.from([0x03, 0x00, (payload.length + 4) >> 8, (payload.length + 4) & 0xff]), payload]);

// X.224 CC (LI 0x11, CC 0xD0, dst ref 0001, src ref 0044, class 0, C0 01 0A, C1 02 0100, C2 02 0101)
const CC = h("11 D0 0001 0044 00 C0010A C1020100 C2020101");
// Snap7 PerformFunctionNegotiate: ack_data 32 03 …, error 0000, params F0 00 0001 0001 00F0 (PDU 240, as an S7-300)
const SETUP_ACK = Buffer.concat([h("02 F0 80"), h("32 03 0000 0000 0008 0000 00 00"), h("F0 00 0001 0001 00F0")]);
// Snap7 BLK_ListAll: OB 0, FB 0, FC 0, DB 1, SDB 0, SFC 0, SFB 0
const LIST_ALL = (last = 0x00) => udAnswer(0x03, 0x01, 0x00, last, h("FF 09 001C 3038 0000 3045 0000 3043 0000 3041 0001 3042 0000 3044 0000 3046 0000"));
// Snap7 BLK_ListBoT for DB: item {0001, 0x12, BlockLangDB 0x05}
const LIST_DB = udAnswer(0x03, 0x02, 0x00, 0x00, h("FF 09 0004 0001 12 05"));
// Snap7 BLK_DoBlockInfo for DB 1 of Size 100 (MC7Len 0x0064, LenLoadMem 100 + 92 = 0x000000C0), 78 bytes
const DB1_INFO = udAnswer(
  0x03, 0x03, 0x00, 0x00,
  h(`FF 09 004E
     01 41 004A 2200 7070 01 01 05 0A 0001
     000000C0 00000000 00000000 16A8 00000000 16A8
     0014 0000 0000 0064
     0000000000000000 0000000000000000 0000000000000000
     01 00 0000 00000000 00000000`),
);

/** Snap7 SZLSendAnswer with PDU 240: first telegram = FF 09 len ID Index + 210 bytes; follow-ups ≤ 214 bytes, same seq. */
function szlTelegrams(array: Buffer, seq: number): Buffer[] {
  const idIndex = array.subarray(4, 8);
  const buffer = array.subarray(8); // from LENTHDR on (Snap7: SZLSendAnswer(p + 8, len - 8))
  const first = 240 - 22 - 8;
  const follow = 240 - 22 - 4;
  if (buffer.length <= first) return [udAnswer(0x04, 0x01, 0x00, 0x00, array)];
  const out: Buffer[] = [];
  const firstData = buffer.subarray(0, first);
  let rest = buffer.subarray(first);
  out.push(udAnswer(0x04, 0x01, seq, 0x01, Buffer.concat([h("FF 09"), Buffer.from([(firstData.length + 4) >> 8, (firstData.length + 4) & 0xff]), idIndex, firstData]), DURN_FRAGMENTED));
  while (rest.length > 0) {
    const part = rest.subarray(0, follow);
    rest = rest.subarray(part.length);
    out.push(udAnswer(0x04, 0x01, seq, rest.length > 0 ? 0x01 : 0x00, Buffer.concat([h("FF 09"), Buffer.from([part.length >> 8, part.length & 0xff]), part]), DURN_FRAGMENTED));
  }
  return out;
}

/** A scripted server: answers the n-th S7 request with the n-th golden answer (PDU reference copied from the request). */
async function goldenServer(answers: Buffer[]): Promise<{ port: number; close: () => Promise<void>; requests: Buffer[] }> {
  const requests: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    let i = 0;
    sock.on("data", (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      while (buf.length >= 4 && buf.length >= buf.readUInt16BE(2)) {
        const frame = buf.subarray(0, buf.readUInt16BE(2));
        buf = buf.subarray(frame.length);
        requests.push(Buffer.from(frame));
        if (frame[5] === 0xe0) {
          sock.write(tpkt(CC));
          continue;
        }
        const ans = answers[i++];
        if (!ans) return;
        const a = Buffer.from(ans);
        a[7] = frame[11]!; // PDU reference (S7 header bytes 4..5) echoed, as Snap7 does (Header.Sequence = PDUH_in->Sequence)
        a[8] = frame[12]!;
        sock.write(tpkt(a));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    requests,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** The formula, over the values the Snap7 bytes above encode (read off field by field, not parsed by product code). */
function expected(port: number): string {
  const canonical = [
    "s7-blockinfo-v3",
    ["endpoint", "127.0.0.1", port, 0, 1],
    // SZL 0x0011 rec 0x0001 MlfB "6ES7 315-2EH14-0AB0 " (trailing space removed); rec 0x0007 BGTyp 00C0 Ausbg 5603 Ausbe 0206
    // SZL 0x001C rec 0x0005 "S C-C2UR28922012", rec 0x0002 "CPU 315-2 PN/DP"
    ["identity", "6ES7 315-2EH14-0AB0", "S C-C2UR28922012", "CPU 315-2 PN/DP", "00c0.5603.0206"],
    ["list", [0x38, 0], [0x41, 1], [0x42, 0], [0x43, 0], [0x44, 0], [0x45, 0], [0x46, 0]],
    // DB 1: load 192, MC7 100, crc 0, version 1, flags 1, language 5, security 0, code 0 ms / day 5800, interface 0 / 5800,
    //       SSB 0x0014 = 20, ADD 0, local 0, author / family / name empty
    ["block", "DB", 1, 192, 100, 0, 1, 1, 5, 0, 0, 5800, 0, 5800, 20, 0, 0, "", "", ""],
  ];
  return "s7:sha256:" + createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

let srv: Awaited<ReturnType<typeof goldenServer>> | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("T fix 1 (#3) — golden ANSWER frames from the Snap7 server (CPU 315-2 PN/DP data)", () => {
  it("★ the client reads the Snap7-server answers (block info bytes 0..1 = 01 00, SZL from a physical CPU) ⇒ the documented checksum", async () => {
    srv = await goldenServer([SETUP_ACK, ...szlTelegrams(SZL_ID_0011_IDX_XXXX, 0x01), ...szlTelegrams(SZL_ID_001C_IDX_XXXX, 0x02), LIST_ALL(), LIST_DB, DB1_INFO]);
    expect(await readS7ProgramChecksum({ host: "127.0.0.1", port: srv.port, rack: 0, slot: 1 })).toBe(expected(srv.port));
    // SZL 0x001C (352 bytes) did not fit one PDU-240 telegram: one follow-up request was sent, with the answer's sequence 0x02
    const followUps = srv.requests.filter((r) => r[8] === 0x07 && r[22] === 0x44 && r[20] === 0x08);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]![24]).toBe(0x02);
  });

  it("★ review I1 on golden frames: the same list-all answer flagged 'more follows' ⇒ refused", async () => {
    srv = await goldenServer([SETUP_ACK, ...szlTelegrams(SZL_ID_0011_IDX_XXXX, 0x01), ...szlTelegrams(SZL_ID_001C_IDX_XXXX, 0x02), LIST_ALL(0x01), LIST_DB, DB1_INFO]);
    await expect(readS7ProgramChecksum({ host: "127.0.0.1", port: srv.port, rack: 0, slot: 1 })).rejects.toThrow(/more follows/);
  });

  it("★ review #5 on golden frames: an SZL follow-up answer carrying another sequence number ⇒ refused", async () => {
    const t = szlTelegrams(SZL_ID_001C_IDX_XXXX, 0x02);
    const bad = Buffer.from(t[1]!);
    bad[3 + 10 + 7] = 0x03; // params byte 7 (sequence) of the follow-up answer
    srv = await goldenServer([SETUP_ACK, ...szlTelegrams(SZL_ID_0011_IDX_XXXX, 0x01), t[0]!, bad, LIST_ALL(), LIST_DB, DB1_INFO]);
    await expect(readS7ProgramChecksum({ host: "127.0.0.1", port: srv.port, rack: 0, slot: 1 })).rejects.toThrow(/SZL follow-up answer sequence 0x3/);
  });

  it("the golden data is what Snap7 says it is (self-check of the transcription)", () => {
    expect(SZL_ID_0011_IDX_XXXX).toHaveLength(124);
    expect(SZL_ID_001C_IDX_XXXX).toHaveLength(352);
    expect(SZL_ID_0011_IDX_XXXX.readUInt16BE(2)).toBe(124 - 4);
    expect(SZL_ID_001C_IDX_XXXX.readUInt16BE(2)).toBe(352 - 4);
    expect(DB1_INFO.readUInt16BE(3 + 8)).toBe(4 + 78); // header data length = 82 (Snap7 BLK_GetBlkInfo: DataLen 82)
  });
});
