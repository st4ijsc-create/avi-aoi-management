/**
 * doc 81 Đợt 9 task T1 — Siemens S7 PROGRAM CHECKSUM, read through the documented S7comm "block functions" (READ-ONLY).
 *
 * ── STATUS ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Built from the PROTOCOL DOCUMENTATION below and tested against an in-process simulator written from the same
 * documentation (drivers/__s7commSim.ts). It has NOT been verified on a real S7 controller (owner decision 2026-10-12:
 * "not verified on a real device" until FAT). The approval screen says so next to every S7 checksum (source label
 * `S7_CHECKSUM_SOURCE`).
 *
 * ── SOURCES (T3) ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *  [RFC1006]  RFC 1006 "ISO Transport Service on top of the TCP" — TPKT header: version 0x03, reserved 0x00, 16-bit
 *             big-endian length of the whole packet (header included). TCP port 102.
 *  [X224]     ITU-T X.224 / ISO 8073 class 0 — COTP TPDUs: CR 0xE0, CC 0xD0, DT 0xF0 (+ EOT bit 0x80); CR parameters
 *             0xC0 TPDU size, 0xC1 calling TSAP, 0xC2 called TSAP.
 *  [WS]       Wireshark S7comm dissector, epan/dissectors/packet-s7comm.c + packet-s7comm.h (Thomas Wiens), fetched
 *             2026-10-11, sha256 0ddad2cf…773691 (.c) — field definitions used here:
 *               • header: S7COMM_PROT_ID 0x32; ROSCTR JOB 0x01 / ACK_DATA 0x03 (12-byte header: + error class, error
 *                 code) / USERDATA 0x07 (10-byte header); PDU reference; parameter length; data length;
 *               • S7COMM_SERV_SETUPCOMM 0xF0 (max AmQ calling, max AmQ called, PDU length);
 *               • userdata parameter (s7comm_decode_ud): 0x00 0x01 0x12, varspec length (4 | 8), syntax id
 *                 (0x11 short | 0x12 ext), type = top 2 bits (S7COMM_UD_TYPE_REQ 1 / RES 2), function group = low 6 bits
 *                 (S7COMM_UD_FUNCGROUP_BLOCK 0x03), subfunction, sequence number; ext only: data unit reference, last
 *                 data unit (S7COMM_UD_LASTDATAUNIT_YES 0x00 / NO 0x01), error code (16 bit);
 *               • userdata data part (s7comm_decode_ud_data): return code (S7COMM_ITEM_RETVAL_DATA_OK 0xFF,
 *                 DATA_ERR 0x0A "Object does not exist"), transport size (NULL 0x00 / OCTET STRING 0x09), length;
 *               • S7COMM_UD_SUBF_BLOCK_LIST 0x01 (response: n × {block type '0'+X (2 bytes ASCII), count (16 bit)}),
 *                 S7COMM_UD_SUBF_BLOCK_LISTTYPE 0x02 (request: block type; response: n × {number (16 bit), flags,
 *                 language}), S7COMM_UD_SUBF_BLOCK_BLOCKINFO 0x03 (request: type (2), number as 5 ASCII digits,
 *                 file system 'A'; response "78 Bytes": type (2), info length (2), unknown (2), const "pp" (2),
 *                 unknown (1), flags (1), language (1), sub block type (1), number (2), "Length load memory" (4),
 *                 security (4), code timestamp (6), interface timestamp (6), SSB (2), ADD (2), local data (2),
 *                 "MC7 code length" (2), author (8), family (8), name (8), version (1), unknown (1),
 *                 "Block checksum" s7comm.blockinfo.checksum FT_UINT16 (2), reserved (4), reserved (4));
 *               • block types S7COMM_BLOCKTYPE_OB 0x3038 '08', DB 0x3041 '0A', FC 0x3043 '0C', FB 0x3045 '0E';
 *                 sub block types OB 0x08, DB 0x0A, FC 0x0C, FB 0x0E.
 *  [SNAP7]    Snap7 1.3.0 (Davide Nardella), src/core/s7_types.h + s7_micro_client.cpp + s7_isotcp.cpp, fetched
 *             2026-10-11 (sha256 5bdc72ce…bd6e5 / f4f4f190…1a00a / d5630274…0dc0dc):
 *               • Block_OB 0x38, Block_DB 0x41, Block_FC 0x43, Block_FB 0x45; grBlocksInfo 0x43; SFun_ListAll 0x01,
 *                 SFun_ListBoT 0x02, SFun_BlkInfo 0x03; TS_ResOctet 0x09;
 *               • opListBlocks: params 00 01 12 04 11 43 01 00, data 0A 00 00 00; answer length must be 28 (7 types);
 *               • opListBlocksOfType: first telegram params plen 4 + data FF 09 00 02 30 <type>; following telegrams
 *                 params plen 8 with the sequence number taken from the PLC's answer + 4 zero bytes, data 0A 00 00 00;
 *                 done when the answer's "last data unit" byte is 0x00;
 *               • opAgBlockInfo: data FF 09 00 08 30 <type> <5 ASCII digits> 41; TResDataBlockInfo (the 78-byte layout
 *                 above) — TS7BlockInfo.LoadSize = LenLoadMem, MC7Size = MC7Len, CheckSum = BlkChksum;
 *               • TIsoTcpSocket::BuildControlPDU: CR = TPDU size 0xC0 + calling TSAP 0xC1 + called TSAP 0xC2;
 *                 remote TSAP = (ConnectionType << 8) + Rack * 0x20 + Slot, ConnectionType PG = 0x01, local 0x0100.
 *
 * ── THE PROGRAM CHECKSUM (formula, version "s7-blockinfo-v1") ───────────────────────────────────────────────────────
 *   1. Read the block list (SFun_ListAll) and, for OB / FB / FC / DB, the block numbers (SFun_ListBoT); the numbers must
 *      match the listed count and be unique.
 *   2. Read the block info of every such block (SFun_BlkInfo) — the answer must name the requested type and number.
 *   3. Sort by block type code (OB 0x38 < DB 0x41 < FC 0x43 < FB 0x45), then by block number (ascending).
 *   4. Canonical text = "s7-blockinfo-v1" followed by one line per block, "\n"-separated:
 *        `<TYPE> <number> load=<LenLoadMem> mc7=<MC7Len> crc=<BlkChksum as 4 lower-case hex digits>`
 *   5. Program checksum = "s7:sha256:" + lower-case hex SHA-256 of the canonical text (UTF-8).
 *   System blocks (SFC / SFB) and system data (SDB) are not part of the user program and are left out.
 *
 * ── L-7 / FAIL CLOSED ───────────────────────────────────────────────────────────────────────────────────────────────
 *   • READ-ONLY: only block-function READ requests (list, list of type, info) are sent; nothing is written and the
 *     controller's mode is never touched.
 *   • A SEPARATE ISO-on-TCP connection is opened for every read and closed after it, so it never queues behind or ahead
 *     of the nodes7 connection that carries writes (a STOP write never waits for a checksum read).
 *   • Every read is bounded by ONE deadline (connect + every request) and is cancelled by the caller's AbortSignal; on
 *     deadline / abort the socket is destroyed, so nothing stays pending.
 *   • Anything unexpected (refused function, error code, wrong type / number / length, duplicate or missing block,
 *     closed connection) THROWS — the caller (programChecksum.readAdapterProgramCheck) then reports "unreadable" and the
 *     approval digest is null (fail-closed). It never answers "unsupported".
 */
import net from "node:net";
import { createHash } from "node:crypto";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

/** Source label shown on the approval screen ⇒ "checksum per protocol documentation — not yet verified on a real device". */
export const S7_CHECKSUM_SOURCE = "s7-blockinfo";
/** Version tag of the canonical text (step 4 of the formula). */
export const S7_PROGRAM_CHECKSUM_FORMULA = "s7-blockinfo-v1";
/** Upper bound of one whole read (connect + all requests); equal to programChecksum.PROGRAM_CHECKSUM_READ_DEADLINE_MS. */
export const S7_PROGRAM_CHECKSUM_DEADLINE_MS = 1000;

/** User-program block types read for the checksum: [SNAP7] Block_*, [WS] S7COMM_BLOCKTYPE_* (low byte) / SUBBLKTYPE_*. */
export const S7_PROGRAM_BLOCK_TYPES = [
  { name: "OB", code: 0x38, sub: 0x08 },
  { name: "DB", code: 0x41, sub: 0x0a },
  { name: "FC", code: 0x43, sub: 0x0c },
  { name: "FB", code: 0x45, sub: 0x0e },
] as const;
export type S7BlockTypeName = (typeof S7_PROGRAM_BLOCK_TYPES)[number]["name"];

export interface S7BlockInfo {
  type: S7BlockTypeName;
  number: number;
  /** "Length load memory" (LenLoadMem / TS7BlockInfo.LoadSize). */
  loadSize: number;
  /** "MC7 code length" (MC7Len / TS7BlockInfo.MC7Size). */
  mc7Size: number;
  /** "Block checksum" (BlkChksum / TS7BlockInfo.CheckSum), 16 bit. */
  checksum: number;
}

export interface S7ChecksumTarget {
  host: string;
  port: number;
  rack: number;
  slot: number;
}

export interface S7ChecksumReadOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
}

// ── constants from the sources ──────────────────────────────────────────────────────────────────────────────────────
const TPKT_VERSION = 0x03; // [RFC1006]
const COTP_CR = 0xe0; // [X224] / [SNAP7] pdu_type_CR
const COTP_CC = 0xd0; // pdu_type_CC
const COTP_DT = 0xf0; // pdu_type_DT
const COTP_EOT = 0x80; // pdu_EoT
const S7_PROT_ID = 0x32; // [WS] S7COMM_PROT_ID
const ROSCTR_JOB = 0x01;
const ROSCTR_ACK_DATA = 0x03;
const ROSCTR_USERDATA = 0x07;
const SERV_SETUPCOMM = 0xf0;
const UD_FUNCGROUP_BLOCK = 0x03;
const UD_TYPE_REQ = 0x1;
const UD_TYPE_RES = 0x2;
const SUBF_LIST = 0x01;
const SUBF_LISTTYPE = 0x02;
const SUBF_BLOCKINFO = 0x03;
const RETVAL_OK = 0xff;
const TS_OCTET = 0x09;
const BLOCKINFO_LEN = 78; // [WS] "78 Bytes"
const LOCAL_TSAP = 0x0100; // [SNAP7] default local TSAP
const CONN_TYPE_PG = 0x01; // [SNAP7] CONNTYPE_PG
const REQUESTED_PDU = 480; // [SNAP7] default negotiated PDU length

/**
 * The program checksum of a set of block infos (formula above). Pure; the order of `blocks` does not matter.
 * Throws on a duplicate (type, number) — a program cannot contain the same block twice.
 */
export function combineS7BlockChecksums(blocks: readonly S7BlockInfo[]): string {
  const code = new Map<string, number>(S7_PROGRAM_BLOCK_TYPES.map((t) => [t.name, t.code]));
  const sorted = [...blocks].sort((a, b) => code.get(a.type)! - code.get(b.type)! || a.number - b.number);
  const lines: string[] = [S7_PROGRAM_CHECKSUM_FORMULA];
  let prev = "";
  for (const b of sorted) {
    if (!code.has(b.type)) throw new DeviceUnreachableError("s7", `program checksum: unknown block type ${String(b.type)}`);
    const key = `${b.type} ${b.number}`;
    if (key === prev) throw new DeviceUnreachableError("s7", `program checksum: duplicate block ${key}`);
    prev = key;
    lines.push(`${key} load=${b.loadSize} mc7=${b.mc7Size} crc=${b.checksum.toString(16).padStart(4, "0")}`);
  }
  return `s7:sha256:${createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")}`;
}

/** Reads the user-program block infos (OB / DB / FC / FB) over one bounded, separate connection. */
export async function readS7ProgramBlocks(target: S7ChecksumTarget, opts: S7ChecksumReadOptions = {}): Promise<S7BlockInfo[]> {
  const session = new S7InfoSession(target, opts.deadlineMs ?? S7_PROGRAM_CHECKSUM_DEADLINE_MS, opts.signal);
  try {
    await session.open();
    const counts = await session.listAll();
    const blocks: S7BlockInfo[] = [];
    for (const t of S7_PROGRAM_BLOCK_TYPES) {
      const expected = counts.get(t.code);
      if (expected === undefined) session.fail(`block list has no ${t.name} entry`);
      if (expected === 0) continue;
      const numbers = await session.listOfType(t.code, expected!);
      if (numbers.length !== expected || new Set(numbers).size !== numbers.length) {
        session.fail(`${t.name} list inconsistent (listed ${expected}, received ${numbers.length})`);
      }
      for (const n of numbers) blocks.push(await session.blockInfo(t, n));
    }
    return blocks;
  } finally {
    session.close();
  }
}

/** The program checksum of the controller at `target` (formula above). Throws when it cannot be read (fail-closed). */
export async function readS7ProgramChecksum(target: S7ChecksumTarget, opts: S7ChecksumReadOptions = {}): Promise<string> {
  return combineS7BlockChecksums(await readS7ProgramBlocks(target, opts));
}

interface S7Pdu {
  rosctr: number;
  errClass: number;
  errCode: number;
  param: Buffer;
  data: Buffer;
}

/** One ISO-on-TCP connection, one deadline for everything, at most ONE request in flight. */
class S7InfoSession {
  private socket: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private waiter: { resolve: (f: Buffer) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pduRef = 0;
  private readonly onAbort = () => this.failWith(new DeviceUnreachableError("s7", "program checksum read aborted"));

  constructor(
    private readonly target: S7ChecksumTarget,
    private readonly deadlineMs: number,
    private readonly signal?: AbortSignal,
  ) {}

  async open(): Promise<void> {
    if (this.signal?.aborted) this.onAbort();
    this.signal?.addEventListener("abort", this.onAbort, { once: true });
    this.timer = setTimeout(
      () => this.failWith(new DeviceUnreachableError("s7", `program checksum timeout after ${this.deadlineMs}ms`)),
      Math.max(1, this.deadlineMs),
    );
    this.throwIfFailed();
    const socket = net.connect({ host: this.target.host, port: this.target.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (e: Error) => this.failWith(new DeviceUnreachableError("s7", `program checksum link error (${(e as NodeJS.ErrnoException).code ?? "socket"})`)));
    socket.on("close", () => this.failWith(new DeviceUnreachableError("s7", "program checksum connection closed")));
    await new Promise<void>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      socket.once("connect", resolve);
      this.waiter = { resolve: () => resolve(), reject };
    });
    this.waiter = null;

    // COTP connection request [X224] / [SNAP7 BuildControlPDU]; called TSAP = PG, rack, slot.
    const remoteTsap = (CONN_TYPE_PG << 8) + this.target.rack * 0x20 + this.target.slot;
    const cotp = Buffer.from([
      0x11, COTP_CR, 0x00, 0x00, 0x00, 0x01, 0x00,
      0xc0, 0x01, 0x0a,
      0xc1, 0x02, (LOCAL_TSAP >> 8) & 0xff, LOCAL_TSAP & 0xff,
      0xc2, 0x02, (remoteTsap >> 8) & 0xff, remoteTsap & 0xff,
    ]);
    const cc = await this.exchangeRaw(tpkt(cotp));
    if (cc.length < 7 || cc[5] !== COTP_CC) this.fail("connection not confirmed (COTP CC expected)");

    // Setup communication [WS] S7COMM_SERV_SETUPCOMM: max AmQ calling 1, called 1, PDU 480.
    const setup = await this.exchange(ROSCTR_JOB, Buffer.from([SERV_SETUPCOMM, 0x00, 0x00, 0x01, 0x00, 0x01, REQUESTED_PDU >> 8, REQUESTED_PDU & 0xff]), Buffer.alloc(0));
    if (setup.rosctr !== ROSCTR_ACK_DATA || setup.errClass !== 0 || setup.errCode !== 0 || setup.param.length < 8 || setup.param[0] !== SERV_SETUPCOMM) {
      this.fail("setup communication refused");
    }
  }

  /** SFun_ListAll ⇒ block type code → count. */
  async listAll(): Promise<Map<number, number>> {
    const r = await this.userdata(SUBF_LIST, 0x00, false, Buffer.from([0x0a, 0x00, 0x00, 0x00]));
    const d = r.payload;
    if (d.length % 4 !== 0) this.fail("block list length invalid");
    const counts = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== 0x30) this.fail("block list entry invalid");
      if (counts.has(d[i + 1]!)) this.fail("block list has a duplicate type");
      counts.set(d[i + 1]!, d.readUInt16BE(i + 2));
    }
    return counts;
  }

  /** SFun_ListBoT (multi-telegram) ⇒ the block numbers of one type. */
  async listOfType(typeCode: number, expected: number): Promise<number[]> {
    const numbers: number[] = [];
    let r = await this.userdata(SUBF_LISTTYPE, 0x00, false, Buffer.from([RETVAL_OK, TS_OCTET, 0x00, 0x02, 0x30, typeCode]));
    // A telegram carries ≥ 1 entry (except a final empty one); bound the loop by the listed count.
    for (let telegrams = 1; ; telegrams++) {
      const d = r.payload;
      if (d.length % 4 !== 0) this.fail("block-of-type list length invalid");
      for (let i = 0; i < d.length; i += 4) numbers.push(d.readUInt16BE(i));
      if (r.lastDataUnit === 0x00) break;
      if (telegrams > expected + 1) this.fail("block-of-type list does not end");
      r = await this.userdata(SUBF_LISTTYPE, r.seq, true, Buffer.from([0x0a, 0x00, 0x00, 0x00]));
    }
    return numbers;
  }

  /** SFun_BlkInfo ⇒ the block's lengths and checksum; the answer must name the requested block. */
  async blockInfo(t: (typeof S7_PROGRAM_BLOCK_TYPES)[number], number: number): Promise<S7BlockInfo> {
    if (!Number.isInteger(number) || number < 0 || number > 65535) this.fail("block number out of range");
    const ascii = Buffer.from(String(number).padStart(5, "0"), "ascii");
    const r = await this.userdata(SUBF_BLOCKINFO, 0x00, false, Buffer.concat([Buffer.from([RETVAL_OK, TS_OCTET, 0x00, 0x08, 0x30, t.code]), ascii, Buffer.from([0x41])]));
    const p = r.payload;
    if (p.length < BLOCKINFO_LEN) this.fail(`block info of ${t.name} ${number} too short`);
    if (p[0] !== 0x30 || p[1] !== t.code || p[11] !== t.sub || p.readUInt16BE(12) !== number) {
      this.fail(`block info answer does not match ${t.name} ${number}`);
    }
    return { type: t.name, number, loadSize: p.readUInt32BE(14), mc7Size: p.readUInt16BE(40), checksum: p.readUInt16BE(68) };
  }

  /** One userdata request of function group "block functions"; validates the answer's parameter and data headers. */
  private async userdata(subfn: number, seq: number, followUp: boolean, data: Buffer): Promise<{ payload: Buffer; seq: number; lastDataUnit: number }> {
    // [SNAP7] TReqFunTypedParams: 00 01 12 plen 11 43 subfn seq (+ 4 zero bytes on a follow-up telegram, plen 8).
    const head = Buffer.from([0x00, 0x01, 0x12, followUp ? 0x08 : 0x04, 0x11, (UD_TYPE_REQ << 6) | UD_FUNCGROUP_BLOCK, subfn, seq]);
    const param = followUp ? Buffer.concat([head, Buffer.alloc(4)]) : head;
    const r = await this.exchange(ROSCTR_USERDATA, param, data);
    const p = r.param;
    if (r.rosctr !== ROSCTR_USERDATA || p.length < 12 || p[0] !== 0x00 || p[1] !== 0x01 || p[2] !== 0x12 || p[3] !== 0x08) this.fail("userdata answer header invalid");
    if (p[5]! >> 6 !== UD_TYPE_RES || (p[5]! & 0x3f) !== UD_FUNCGROUP_BLOCK || p[6] !== subfn) this.fail("userdata answer is not a block-function response");
    const errorCode = p.readUInt16BE(10);
    if (errorCode !== 0) this.fail(`block function refused (error code 0x${errorCode.toString(16).padStart(4, "0")})`);
    const d = r.data;
    if (d.length < 4) this.fail("userdata answer has no data part");
    if (d[0] !== RETVAL_OK) this.fail(`block function return code 0x${d[0]!.toString(16).padStart(2, "0")}`);
    const len = d.readUInt16BE(2);
    if (4 + len !== d.length) this.fail("userdata data length inconsistent");
    return { payload: d.subarray(4), seq: p[7]!, lastDataUnit: p[9]! };
  }

  /** One S7 PDU over COTP DT; the answer must carry the same PDU reference and consistent lengths. */
  private async exchange(rosctr: number, param: Buffer, data: Buffer): Promise<S7Pdu> {
    this.pduRef = (this.pduRef + 1) & 0xffff || 1;
    const header = Buffer.from([S7_PROT_ID, rosctr, 0x00, 0x00, this.pduRef >> 8, this.pduRef & 0xff, param.length >> 8, param.length & 0xff, data.length >> 8, data.length & 0xff]);
    const frame = await this.exchangeRaw(tpkt(Buffer.concat([Buffer.from([0x02, COTP_DT, COTP_EOT]), header, param, data])));
    if (frame.length < 7 + 10 || frame[4] !== 0x02 || frame[5] !== COTP_DT) this.fail("COTP data TPDU expected");
    if ((frame[6]! & COTP_EOT) === 0) this.fail("fragmented COTP data is not supported");
    const s = frame.subarray(7);
    if (s[0] !== S7_PROT_ID) this.fail("not an S7comm PDU");
    const ack = s[1] === 0x02 || s[1] === ROSCTR_ACK_DATA;
    const hdr = ack ? 12 : 10;
    if (s.length < hdr) this.fail("S7comm header truncated");
    const pl = s.readUInt16BE(6);
    const dl = s.readUInt16BE(8);
    if (hdr + pl + dl !== s.length) this.fail("S7comm lengths inconsistent");
    if (s.readUInt16BE(4) !== this.pduRef) this.fail("S7comm PDU reference mismatch");
    return { rosctr: s[1]!, errClass: ack ? s[10]! : 0, errCode: ack ? s[11]! : 0, param: s.subarray(hdr, hdr + pl), data: s.subarray(hdr + pl) };
  }

  private exchangeRaw(packet: Buffer): Promise<Buffer> {
    this.throwIfFailed();
    return new Promise<Buffer>((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.socket!.write(packet);
      this.drain();
    });
  }

  private onData(chunk: Buffer): void {
    if (this.failure) return;
    this.buf = Buffer.concat([this.buf, chunk]);
    this.drain();
  }

  /** Hands the next complete TPKT frame to the waiting request; an unexpected frame is a protocol error. */
  private drain(): void {
    if (this.buf.length < 4) return;
    if (this.buf[0] !== TPKT_VERSION) return this.failWith(new DeviceUnreachableError("s7", "program checksum: not a TPKT frame"));
    const len = this.buf.readUInt16BE(2);
    if (len < 7) return this.failWith(new DeviceUnreachableError("s7", "program checksum: TPKT length invalid"));
    if (this.buf.length < len) return;
    const frame = this.buf.subarray(0, len);
    this.buf = this.buf.subarray(len);
    const w = this.waiter;
    if (!w) return this.failWith(new DeviceUnreachableError("s7", "program checksum: unsolicited frame"));
    this.waiter = null;
    w.resolve(frame);
  }

  fail(why: string): never {
    const e = new DeviceUnreachableError("s7", `program checksum: ${why}`);
    this.failWith(e);
    throw e;
  }

  private failWith(e: Error): void {
    if (this.failure) return;
    this.failure = e;
    this.socket?.destroy();
    const w = this.waiter;
    this.waiter = null;
    w?.reject(e);
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.signal?.removeEventListener("abort", this.onAbort);
    if (!this.failure) this.failure = new DeviceUnreachableError("s7", "program checksum session closed");
    this.socket?.destroy();
    this.socket = null;
  }
}

/** [RFC1006] TPKT: 03 00 <length incl. header>. */
function tpkt(payload: Buffer): Buffer {
  const len = payload.length + 4;
  return Buffer.concat([Buffer.from([TPKT_VERSION, 0x00, len >> 8, len & 0xff]), payload]);
}
