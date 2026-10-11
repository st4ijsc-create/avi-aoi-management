/**
 * doc 81 Đợt 9 task T2 — an IN-PROCESS S7comm protocol SIMULATOR for tests (never a real device).
 *
 * Written from the protocol documentation, independently of the product client (it imports nothing from it):
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

export type SimBlockType = "OB" | "DB" | "FC" | "FB";
export interface SimBlock {
  type: SimBlockType;
  number: number;
  loadSize: number;
  mc7Size: number;
  checksum: number;
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
  | "lenField"; // userdata data part whose length field says 2 bytes more than are sent

export interface S7commSim {
  port: number;
  /** Replace the whole simulated program. */
  setProgram(blocks: SimBlock[]): void;
  /** Change one block (what a vendor tool would do when downloading a modified block). */
  patchBlock(type: SimBlockType, number: number, patch: Partial<Omit<SimBlock, "type" | "number">>): void;
  setFault(f: SimFault): void;
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

const TYPE_CODE: Record<SimBlockType, number> = { OB: 0x38, DB: 0x41, FC: 0x43, FB: 0x45 }; // Snap7 Block_*
const SUB_TYPE: Record<SimBlockType, number> = { OB: 0x08, DB: 0x0a, FC: 0x0c, FB: 0x0e }; // Wireshark SUBBLKTYPE_*
const ALL_TYPES = [0x38, 0x45, 0x43, 0x46, 0x44, 0x41, 0x42]; // OB FB FC SFB SFC DB SDB — 7 entries (Snap7 expects 28 bytes)

export async function startS7commSim(opts: { program?: SimBlock[]; rack?: number; slot?: number; pdu?: number } = {}): Promise<S7commSim> {
  let program: SimBlock[] = (opts.program ?? []).map((b) => ({ ...b }));
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
    const sendUd = (ref: number, subfn: number, seq: number, last: number, errCode: number, ret: number, ts: number, payload: Buffer) => {
      const param = Buffer.from([0x00, 0x01, 0x12, 0x08, 0x12, 0x80 | 0x03, subfn, seq, 0x00, last, errCode >> 8, errCode & 0xff]);
      const declared = fault === "lenField" ? payload.length + 2 : payload.length;
      const data = Buffer.concat([Buffer.from([ret, ts, declared >> 8, declared & 0xff]), payload]);
      sendS7(0x07, fault === "wrongRef" ? (ref + 1) & 0xffff : ref, param, data);
    };
    const listFrom = (numbers: number[], ref: number, seq: number) => {
      const chunk = numbers.slice(0, listChunk);
      const rest = numbers.slice(listChunk);
      const payload = Buffer.alloc(chunk.length * 4);
      chunk.forEach((n, i) => {
        payload.writeUInt16BE(n, i * 4);
        payload[i * 4 + 2] = 0x22; // flags (Wireshark: "kind of flags?")
        payload[i * 4 + 3] = 0x05; // language
      });
      pendingList = rest.length > 0 ? { numbers: rest, seq } : null;
      sendUd(ref, 0x02, seq, rest.length > 0 ? 0x01 : 0x00, 0, 0xff, 0x09, payload);
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
        return sendUd(ref, 0x01, seq, 0x00, 0, 0xff, 0x09, payload);
      }
      if (subfn === 0x02) {
        const followUp = param[3] === 0x08;
        if (followUp) {
          const pend = pendingList as { numbers: number[]; seq: number } | null;
          if (!pend || pend.seq !== seq) return sendUd(ref, 0x02, seq, 0x00, 0xd401, 0x0a, 0x00, Buffer.alloc(0));
          return listFrom(pend.numbers, ref, pend.seq);
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
        const p = Buffer.alloc(78);
        p[0] = 0x30;
        p[1] = code!;
        p.writeUInt16BE(78, 2); // info length
        p.writeUInt16BE(0x0001, 4);
        p.write("pp", 6, "ascii");
        p[8] = 0x00;
        p[9] = 0x01; // flags
        p[10] = 0x05; // language
        p[11] = fault === "wrongType" ? (b.type === "FC" ? 0x0e : 0x0c) : SUB_TYPE[b.type];
        p.writeUInt16BE(fault === "wrongNumber" ? (b.number + 1) & 0xffff : b.number, 12);
        p.writeUInt32BE(b.loadSize, 14);
        // 18..21 security, 22..27 code timestamp, 28..33 interface timestamp: zero
        p.writeUInt16BE(0, 34); // SSB
        p.writeUInt16BE(0, 36); // ADD
        p.writeUInt16BE(0, 38); // local data
        p.writeUInt16BE(b.mc7Size, 40);
        p.write("SIM", 42, "ascii"); // author
        p.write("TEST", 50, "ascii"); // family
        p.write(`${b.type}${b.number}`.slice(0, 8), 58, "ascii"); // name
        p[66] = 0x01; // version
        p.writeUInt16BE(b.checksum, 68);
        return sendUd(ref, 0x03, seq, 0x00, 0, 0xff, 0x09, fault === "shortInfo" ? p.subarray(0, 40) : fault === "infoLen72" ? p.subarray(0, 72) : p);
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
