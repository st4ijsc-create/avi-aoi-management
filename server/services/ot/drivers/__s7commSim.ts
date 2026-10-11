/**
 * doc 81 Đợt 9 task T2 — an IN-PROCESS S7comm protocol SIMULATOR for tests (never a real device).
 *
 * Written from the protocol documentation, independently of the product client (it imports nothing from it). Also
 * answers read SZL (CPU functions group 4, subfunction 0x01) for 0x0011 module identification (order number) and 0x001C
 * component identification (module name, serial number), per Wireshark packet-s7comm_szl_ids.c and Snap7 opReadSZL.
 *   • RFC 1006 TPKT (03 00 <len>), ISO 8073 / X.224 class 0 COTP: CR 0xE0 → CC 0xD0 (parameters echoed: 0xC0 TPDU size,
 *     0xC1 calling TSAP, 0xC2 called TSAP), DT 0xF0 + EOT 0x80;
 *   • Wireshark packet-s7comm.c / .h (field definitions): S7 header 0x32, ROSCTR job 1 / ack_data 3 (+ error class /
 *     code) / userdata 7; setup communication 0xF0; write var 0x05 (ack_data: function, item count; data: one return
 *     code 0xFF per item); userdata parameter 00 01 12 <len> <syntax> <type|group> <subfunction> <seq>
 *     [<data unit ref> <last data unit> <error code>]; block functions (group 3): list blocks 0x01, list blocks of type
 *     0x02 (fragmented answers: "last data unit" 0x01 = more follow), get block info 0x03 (78-byte answer);
 *     return code 0xFF success / 0x0A object does not exist;
 *   • Snap7 s7_types.h TResDataBlockInfo (byte layout of the block info answer), Block_* type codes, and
 *     s7_micro_client.cpp opListBlocksOfType (follow-up telegrams carry the sequence number of the PLC's answer).
 *
 * Listens on 127.0.0.1, port 0 (OS-assigned). Every socket is closed by close(). Faults can be injected to exercise the
 * client's fail-closed paths. The simulator records every received S7 PDU for byte-level assertions.
 */
import net from "node:net";

export type SimBlockType = "OB" | "DB" | "SDB" | "FC" | "SFC" | "FB" | "SFB";
export interface SimBlock {
  type: SimBlockType;
  number: number;
  loadSize: number;
  mc7Size: number;
  checksum: number;
  /** Optional block-info fields (defaults: simBlockDefaults). */
  version?: number;
  flags?: number;
  language?: number;
  /** "Block Security": 0 none, 3 know-how protect. */
  security?: number;
  codeMs?: number;
  codeDays?: number;
  interfaceMs?: number;
  interfaceDays?: number;
  ssbSize?: number;
  addSize?: number;
  localDataSize?: number;
  author?: string;
  family?: string;
  name?: string;
}

/** The values the simulator answers for fields a SimBlock leaves out (tests use the same table for their oracle). */
export const simBlockDefaults = (b: SimBlock): Required<SimBlock> => ({
  version: 0x01,
  flags: 0x01,
  language: 0x05,
  security: 0,
  codeMs: 3_600_000,
  codeDays: 14_000,
  interfaceMs: 1_800_000,
  interfaceDays: 13_990,
  ssbSize: 0,
  addSize: 0,
  localDataSize: 0,
  author: "SIM",
  family: "TEST",
  name: `${b.type}${b.number}`.slice(0, 8),
  ...b,
});

/** Controller identity answered through SZL 0x0011 (order number) and 0x001C (module name, serial number). */
export interface SimIdentity {
  orderNumber: string;
  serialNumber: string;
  moduleName: string;
  /** SZL 0x0011 record 0x0007 ("basic firmware"): BGTyp, Ausbg, Ausbe (default 0x00C0, 0x5603, 0x0206 as in Snap7 s7_firmware.h). */
  firmware?: [number, number, number];
}

/** Fault modes (all affect block-function userdata only; the COTP / setup / write path keeps answering). */
export type SimFault =
  | null
  | "hang" // never answer a block-function request
  | "refuse" // parameter error code 0x8104 (function not supported) on every block function
  | "wrongNumber" // block info answers with another block number
  | "shortInfo" // block info answer truncated to 40 bytes
  | "countMismatch" // the block list announces one more DB than the list of type returns
  | "closeOnInfo" // close the connection when a block info is requested
  | "notExist" // block info return code 0x0A (object does not exist)
  | "wrongType" // block info answers with another sub block type (FC instead of the requested one)
  | "wrongRef" // every userdata answer carries another PDU reference than the request
  | "infoLen72" // block info answer of 72 bytes: the checksum field is present but the documented 78 bytes are not
  | "lenField" // userdata data part whose length field says 2 bytes more than are sent
  | "szlRefuse" // read SZL refused (error code 0xD401) - the identity cannot be read
  | "szlNoSerial" // SZL 0x001C without the serial-number record (index 0x0005)
  | "listUnknownType" // the block list names an extra, undocumented type code 0x47 with one block
  | "szlWrongId" // the SZL answer names another SZL-ID (0x0012) than requested
  | "szlRecLen30" // SZL 0x0011 answered with 30-byte records (LENTHDR 30) instead of the documented 28
  | "szlCountWrong" // SZL 0x001C announces one record more (N_DR) than it sends
  | "listAllMore" // the list-all answer is flagged "last data unit = 0x01" (more follows)
  | "infoMore" // every block info answer is flagged "more follows"
  | "followSeqWrong" // every follow-up answer (list of type, SZL) carries another sequence number than the one in flight
  | "noFirmware"; // SZL 0x0011 without the "basic firmware" record 0x0007

export interface S7commSim {
  port: number;
  /** Replace the whole simulated program. */
  setProgram(blocks: SimBlock[]): void;
  /** Change one block (what a vendor tool would do when downloading a modified block). */
  patchBlock(type: SimBlockType, number: number, patch: Partial<Omit<SimBlock, "type" | "number">>): void;
  setFault(f: SimFault): void;
  setIdentity(id: SimIdentity): void;
  /** How many SZL records one telegram carries (forces SZL fragmentation). */
  setSzlChunk(n: number): void;
  /** How many block numbers one "list blocks of type" telegram carries (forces fragmentation). */
  setListChunk(n: number): void;
  /** The order in which the list-all answer names the block types (tests that the client does not depend on it). */
  setListAllOrder(codes: number[]): void;
  /** Every S7 PDU received (from the 0x32 byte on), with the connection index. */
  readonly pdus: Array<{ conn: number; bytes: Buffer }>;
  /** Raw COTP connection requests (TPKT included). */
  readonly connectRequests: Buffer[];
  /** Number of TCP connections accepted, currently open, and write jobs answered. */
  stats(): { accepted: number; open: number; writes: number; blockRequests: number };
  close(): Promise<void>;
}

const TYPE_CODE: Record<SimBlockType, number> = { OB: 0x38, DB: 0x41, SDB: 0x42, FC: 0x43, SFC: 0x44, FB: 0x45, SFB: 0x46 }; // Snap7 Block_*
const SUB_TYPE: Record<SimBlockType, number> = { OB: 0x08, DB: 0x0a, SDB: 0x0b, FC: 0x0c, SFC: 0x0d, FB: 0x0e, SFB: 0x0f }; // Wireshark SUBBLKTYPE_*
const ALL_TYPES = [0x38, 0x45, 0x43, 0x46, 0x44, 0x41, 0x42]; // OB FB FC SFB SFC DB SDB — 7 entries (Snap7 expects 28 bytes)

export const SIM_IDENTITY: SimIdentity = { orderNumber: "6ES7 315-2EH14-0AB0", serialNumber: "S C-X4U421302009", moduleName: "CPU 315-2 PN/DP" };

export async function startS7commSim(opts: { program?: SimBlock[]; rack?: number; slot?: number; pdu?: number; identity?: SimIdentity } = {}): Promise<S7commSim> {
  let program: SimBlock[] = (opts.program ?? []).map((b) => ({ ...b }));
  let identity: SimIdentity = { ...(opts.identity ?? SIM_IDENTITY) };
  let szlChunk = 100;
  let fault: SimFault = null;
  let listChunk = 50;
  let listAllOrder = ALL_TYPES.slice();
  const pdus: Array<{ conn: number; bytes: Buffer }> = [];
  const connectRequests: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  let accepted = 0;
  let writes = 0;
  let blockRequests = 0;
  const expectedTsapLow = (opts.rack ?? 0) * 0x20 + (opts.slot ?? 1);

  const server = net.createServer((sock) => {
    const conn = accepted++;
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    // pending fragmented "list of type" answer of this connection: remaining numbers + the sequence number handed out.
    let pendingList: { numbers: number[]; seq: number } | null = null;
    let pendingSzl: { bytes: Buffer; seq: number } | null = null;
    let szlChunkBytes = 0;
    let seqCounter = 0x20;

    const send = (payload: Buffer) => {
      const len = payload.length + 4;
      sock.write(Buffer.concat([Buffer.from([0x03, 0x00, len >> 8, len & 0xff]), payload]));
    };
    const sendS7 = (rosctr: number, ref: number, param: Buffer, data: Buffer, err?: [number, number]) => {
      const h = [0x32, rosctr, 0x00, 0x00, ref >> 8, ref & 0xff, param.length >> 8, param.length & 0xff, data.length >> 8, data.length & 0xff];
      if (rosctr === 0x02 || rosctr === 0x03) h.push(err?.[0] ?? 0, err?.[1] ?? 0);
      send(Buffer.concat([Buffer.from([0x02, 0xf0, 0x80]), Buffer.from(h), param, data]));
    };
    /** userdata answer: 00 01 12 08 12 <0x80|group> <subfn> <seq> <dur> <ldu> <err hi> <err lo> + data part. */
    const sendUd = (ref: number, subfn: number, seq: number, last: number, errCode: number, ret: number, ts: number, payload: Buffer, group = 0x03) => {
      const param = Buffer.from([0x00, 0x01, 0x12, 0x08, 0x12, 0x80 | group, subfn, seq, 0x00, last, errCode >> 8, errCode & 0xff]);
      const declared = fault === "lenField" ? payload.length + 2 : payload.length;
      const data = Buffer.concat([Buffer.from([ret, ts, declared >> 8, declared & 0xff]), payload]);
      sendS7(0x07, fault === "wrongRef" ? (ref + 1) & 0xffff : ref, param, data);
    };
    const listFrom = (numbers: number[], ref: number, seq: number, followUp = false) => {
      const chunk = numbers.slice(0, listChunk);
      const rest = numbers.slice(listChunk);
      const payload = Buffer.alloc(chunk.length * 4);
      chunk.forEach((n, i) => {
        payload.writeUInt16BE(n, i * 4);
        payload[i * 4 + 2] = 0x22; // flags (Wireshark: "kind of flags?")
        payload[i * 4 + 3] = 0x05; // language
      });
      pendingList = rest.length > 0 ? { numbers: rest, seq } : null;
      sendUd(ref, 0x02, followUp && fault === "followSeqWrong" ? (seq + 1) & 0xff : seq, rest.length > 0 ? 0x01 : 0x00, 0, 0xff, 0x09, payload);
    };

    /** Read SZL (Wireshark S7COMM_UD_SUBF_CPU_READSZL; Snap7 opReadSZL): ID, index, LENTHDR, N_DR, records; fragmented. */
    const szlRecords = (id: number): { len: number; recs: Buffer[] } | null => {
      const rec = (len: number, index: number, value: string, width: number) => {
        const r = Buffer.alloc(len);
        r.writeUInt16BE(index, 0);
        r.write(value.slice(0, width), 2, "latin1");
        return r;
      };
      if (id === 0x0011) {
        // record: index, MlfB (20 ASCII, space padded), BGTyp, Ausbg, Ausbe
        const l = fault === "szlRecLen30" ? 30 : 28;
        const fwRec = rec(l, 0x0007, "".padEnd(20, " "), 20);
        const [bg, ausbg, ausbe] = identity.firmware ?? [0x00c0, 0x5603, 0x0206];
        fwRec.writeUInt16BE(bg, 22);
        fwRec.writeUInt16BE(ausbg, 24);
        fwRec.writeUInt16BE(ausbe, 26);
        const recs = [rec(l, 0x0001, identity.orderNumber.padEnd(20, " "), 20), rec(l, 0x0006, identity.orderNumber.padEnd(20, " "), 20)];
        if (fault !== "noFirmware") recs.push(fwRec);
        return { len: l, recs };
      }
      if (id === 0x001c) {
        const recs = [rec(34, 0x0001, "SIM STATION", 24), rec(34, 0x0002, identity.moduleName, 24), rec(34, 0x0003, "", 32), rec(34, 0x0004, "Original Siemens Equipment", 26)];
        if (fault !== "szlNoSerial") recs.push(rec(34, 0x0005, identity.serialNumber, 24));
        recs.push(rec(34, 0x0007, "CPU 315-2 PN/DP", 32));
        return { len: 34, recs };
      }
      return null;
    };
    const onSzl = (ref: number, seq: number, followUp: boolean, data: Buffer) => {
      blockRequests++;
      if (fault === "hang") return;
      if (fault === "szlRefuse") return sendUd(ref, 0x01, seq, 0x00, 0xd401, 0x0a, 0x00, Buffer.alloc(0), 0x04);
      if (followUp) {
        const pend = pendingSzl as { bytes: Buffer; seq: number } | null;
        if (!pend || pend.seq !== seq) return sendUd(ref, 0x01, seq, 0x00, 0xd401, 0x0a, 0x00, Buffer.alloc(0), 0x04);
        const now = pend.bytes.subarray(0, szlChunkBytes);
        const rest = pend.bytes.subarray(now.length);
        pendingSzl = rest.length > 0 ? { bytes: rest, seq } : null;
        return sendUd(ref, 0x01, fault === "followSeqWrong" ? (seq + 1) & 0xff : seq, rest.length > 0 ? 0x01 : 0x00, 0, 0xff, 0x09, now, 0x04);
      }
      const id = data.readUInt16BE(4);
      const index = data.readUInt16BE(6);
      const sz = szlRecords(id);
      if (!sz || index !== 0) return sendUd(ref, 0x01, seq, 0x00, 0, 0x0a, 0x00, Buffer.alloc(0), 0x04);
      const all = Buffer.concat(sz.recs);
      const head = Buffer.alloc(8);
      head.writeUInt16BE(fault === "szlWrongId" ? 0x0012 : id, 0);
      head.writeUInt16BE(index, 2);
      head.writeUInt16BE(sz.len, 4);
      head.writeUInt16BE(sz.recs.length + (fault === "szlCountWrong" && id === 0x001c ? 1 : 0), 6);
      szlChunkBytes = szlChunk * sz.len;
      const now = all.subarray(0, szlChunkBytes);
      const rest = all.subarray(now.length);
      const mySeq = ++seqCounter & 0xff;
      pendingSzl = rest.length > 0 ? { bytes: rest, seq: mySeq } : null;
      return sendUd(ref, 0x01, mySeq, rest.length > 0 ? 0x01 : 0x00, 0, 0xff, 0x09, Buffer.concat([head, now]), 0x04);
    };

    const onPdu = (s: Buffer) => {
      pdus.push({ conn, bytes: Buffer.from(s) });
      const rosctr = s[1];
      const ref = s.readUInt16BE(4);
      const pl = s.readUInt16BE(6);
      const hdr = rosctr === 0x02 || rosctr === 0x03 ? 12 : 10;
      const param = s.subarray(hdr, hdr + pl);
      const data = s.subarray(hdr + pl);
      if (rosctr === 0x01 && param[0] === 0xf0) {
        const want = param.readUInt16BE(6);
        const pdu = Math.min(want, opts.pdu ?? 480);
        sendS7(0x03, ref, Buffer.from([0xf0, 0x00, 0x00, 0x01, 0x00, 0x01, pdu >> 8, pdu & 0xff]), Buffer.alloc(0));
        return;
      }
      if (rosctr === 0x01 && param[0] === 0x05) {
        writes++;
        const items = param[1] ?? 1;
        sendS7(0x03, ref, Buffer.from([0x05, items]), Buffer.alloc(items, 0xff));
        return;
      }
      if (rosctr !== 0x07 || param[0] !== 0x00 || param[1] !== 0x01 || param[2] !== 0x12) return; // not handled: no answer
      const group = param[5]! & 0x3f;
      const subfn = param[6]!;
      const seq = param[7]!;
      if (group === 0x04 && subfn === 0x01) return onSzl(ref, seq, param[3] === 0x08, data);
      if (group !== 0x03) return;
      blockRequests++;
      if (fault === "hang") return;
      if (fault === "refuse") return sendUd(ref, subfn, seq, 0x00, 0x8104, 0x0a, 0x00, Buffer.alloc(0));
      if (subfn === 0x01) {
        const payload = Buffer.alloc(listAllOrder.length * 4);
        listAllOrder.forEach((code, i) => {
          let n = program.filter((b) => TYPE_CODE[b.type] === code).length;
          if (fault === "countMismatch" && code === 0x41) n += 1;
          payload[i * 4] = 0x30;
          payload[i * 4 + 1] = code;
          payload.writeUInt16BE(n, i * 4 + 2);
        });
        if (fault === "listUnknownType") return sendUd(ref, 0x01, seq, 0x00, 0, 0xff, 0x09, Buffer.concat([payload, Buffer.from([0x30, 0x47, 0x00, 0x01])]));
        return sendUd(ref, 0x01, seq, fault === "listAllMore" ? 0x01 : 0x00, 0, 0xff, 0x09, payload);
      }
      if (subfn === 0x02) {
        const followUp = param[3] === 0x08;
        if (followUp) {
          const pend = pendingList as { numbers: number[]; seq: number } | null;
          if (!pend || pend.seq !== seq) return sendUd(ref, 0x02, seq, 0x00, 0xd401, 0x0a, 0x00, Buffer.alloc(0));
          return listFrom(pend.numbers, ref, pend.seq, true);
        }
        const code = data[5];
        const numbers = program.filter((b) => TYPE_CODE[b.type] === code).map((b) => b.number).sort((a, b) => a - b);
        return listFrom(numbers, ref, ++seqCounter & 0xff);
      }
      if (subfn === 0x03) {
        if (fault === "closeOnInfo") {
          sock.destroy();
          return;
        }
        const code = data[5];
        const number = Number(data.subarray(6, 11).toString("ascii"));
        const b = program.find((x) => TYPE_CODE[x.type] === code && x.number === number);
        if (!b || fault === "notExist") return sendUd(ref, 0x03, seq, 0x00, 0, 0x0a, 0x00, Buffer.alloc(0));
        const f = simBlockDefaults(b);
        // Snap7 TResDataBlockInfo / Wireshark "78 Bytes" layout
        const p = Buffer.alloc(78);
        p[0] = 0x30;
        p[1] = code!;
        p.writeUInt16BE(78, 2); // info length
        p.writeUInt16BE(0x0001, 4);
        p.write("pp", 6, "ascii");
        p[8] = 0x00;
        p[9] = f.flags;
        p[10] = f.language;
        p[11] = fault === "wrongType" ? (b.type === "FC" ? 0x0e : 0x0c) : SUB_TYPE[b.type];
        p.writeUInt16BE(fault === "wrongNumber" ? (b.number + 1) & 0xffff : b.number, 12);
        p.writeUInt32BE(f.loadSize, 14);
        p.writeUInt32BE(f.security, 18);
        p.writeUInt32BE(f.codeMs, 22);
        p.writeUInt16BE(f.codeDays, 26);
        p.writeUInt32BE(f.interfaceMs, 28);
        p.writeUInt16BE(f.interfaceDays, 32);
        p.writeUInt16BE(f.ssbSize, 34);
        p.writeUInt16BE(f.addSize, 36);
        p.writeUInt16BE(f.localDataSize, 38);
        p.writeUInt16BE(f.mc7Size, 40);
        p.write(f.author.slice(0, 8), 42, "latin1");
        p.write(f.family.slice(0, 8), 50, "latin1");
        p.write(f.name.slice(0, 8), 58, "latin1");
        p[66] = f.version;
        p.writeUInt16BE(f.checksum, 68);
        return sendUd(ref, 0x03, seq, fault === "infoMore" ? 0x01 : 0x00, 0, 0xff, 0x09, fault === "shortInfo" ? p.subarray(0, 40) : fault === "infoLen72" ? p.subarray(0, 72) : p);
      }
    };

    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt16BE(2);
        if (buf[0] !== 0x03 || len < 7) {
          sock.destroy();
          return;
        }
        if (buf.length < len) return;
        const frame = buf.subarray(0, len);
        buf = buf.subarray(len);
        const code = frame[5];
        if (code === 0xe0) {
          connectRequests.push(Buffer.from(frame));
          // called TSAP low byte must be rack * 32 + slot; anything else ⇒ no confirm (connection dropped)
          const params = frame.subarray(11);
          let calledLow: number | undefined;
          for (let i = 0; i + 1 < params.length; ) {
            const id = params[i]!;
            const l = params[i + 1]!;
            if (id === 0xc2 && l === 2) calledLow = params[i + 3];
            i += 2 + l;
          }
          if (calledLow !== expectedTsapLow) {
            sock.destroy();
            return;
          }
          const cc = Buffer.from(frame.subarray(4));
          cc[1] = 0xd0;
          cc.writeUInt16BE(frame.readUInt16BE(8), 2); // dst ref = caller's src ref
          cc.writeUInt16BE(0x0044, 4); // own src ref
          send(cc);
        } else if (code === 0xf0) {
          onPdu(frame.subarray(7));
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    setProgram: (blocks) => {
      program = blocks.map((b) => ({ ...b }));
    },
    patchBlock: (type, number, patch) => {
      const b = program.find((x) => x.type === type && x.number === number);
      if (b) Object.assign(b, patch);
    },
    setFault: (f) => {
      fault = f;
    },
    setIdentity: (id) => {
      identity = { ...id };
    },
    setSzlChunk: (n) => {
      szlChunk = Math.max(1, n);
    },
    setListChunk: (n) => {
      listChunk = Math.max(1, n);
    },
    setListAllOrder: (codes) => {
      listAllOrder = codes.slice();
    },
    pdus,
    connectRequests,
    stats: () => ({ accepted, open: sockets.size, writes, blockRequests }),
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
