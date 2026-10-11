/**
 * doc 81 Đợt 9 task T1 — Siemens S7 PROGRAM CHECKSUM, read through the documented S7comm functions (READ-ONLY):
 * "block functions" (block list + block info) and "CPU functions / read SZL" (controller identity).
 *
 * ── STATUS — say it plainly ──────────────────────────────────────────────────────────────────────────────────────────
 *   • Built from the PROTOCOL DOCUMENTATION below and tested against an in-process simulator written from the same
 *     documentation (drivers/__s7commSim.ts). NOT verified on a real S7 controller (owner decision 2026-10-12: "not
 *     verified on a real device" until FAT).
 *   • It is CHANGE DETECTION PER PROTOCOL DATA, NOT TAMPER-PROOF against an attacker with PLC write access (ruling
 *     R-9-a (4)): every value hashed here is what the controller REPORTS about itself (the S7 block checksum is a 16-bit,
 *     non-cryptographic value; lengths, timestamps, version, flags and the identity strings are reported fields). Someone
 *     who can write to the PLC can make a modified program report the same values. What it does detect: any program
 *     change made through normal engineering tools (a downloaded / added / deleted block changes its reported checksum,
 *     length, timestamps or the block list), a different controller (identity), and a re-pointed adapter (endpoint).
 *   The approval screen shows both statements next to every S7 checksum (source label `S7_CHECKSUM_SOURCE`).
 *
 * ── SOURCES (T3) ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *  [RFC1006]  RFC 1006 "ISO Transport Service on top of the TCP" — TPKT header: version 0x03, reserved 0x00, 16-bit
 *             big-endian length of the whole packet (header included). TCP port 102.
 *  [X224]     ITU-T X.224 / ISO 8073 class 0 — COTP TPDUs: CR 0xE0, CC 0xD0, DT 0xF0 (+ EOT bit 0x80); CR parameters
 *             0xC0 TPDU size, 0xC1 calling TSAP, 0xC2 called TSAP.
 *  [WS]       Wireshark S7comm dissector (Thomas Wiens), epan/dissectors/packet-s7comm.c (sha256 0ddad2cf…773691),
 *             packet-s7comm.h (83e98614…efee4c), packet-s7comm_szl_ids.c (9f359b61…fa2231), fetched 2026-10-11:
 *               • header: S7COMM_PROT_ID 0x32; ROSCTR JOB 0x01 / ACK_DATA 0x03 (12-byte header: + error class, error
 *                 code) / USERDATA 0x07 (10-byte header); PDU reference; parameter length; data length;
 *               • S7COMM_SERV_SETUPCOMM 0xF0 (max AmQ calling, max AmQ called, PDU length);
 *               • userdata parameter (s7comm_decode_ud): 0x00 0x01 0x12, varspec length (4 | 8), syntax id
 *                 (0x11 short | 0x12 ext), type = top 2 bits (S7COMM_UD_TYPE_REQ 1 / RES 2), function group = low 6 bits
 *                 (S7COMM_UD_FUNCGROUP_BLOCK 0x03, S7COMM_UD_FUNCGROUP_CPU 0x04), subfunction, sequence number; ext only:
 *                 data unit reference, last data unit (S7COMM_UD_LASTDATAUNIT_YES 0x00 / NO 0x01), error code (16 bit);
 *               • userdata data part (s7comm_decode_ud_data): return code (S7COMM_ITEM_RETVAL_DATA_OK 0xFF,
 *                 DATA_ERR 0x0A "Object does not exist"), transport size (NULL 0x00 / OCTET STRING 0x09), length;
 *               • S7COMM_UD_SUBF_BLOCK_LIST 0x01 (response: n × {block type '0'+X (2 bytes ASCII), count (16 bit)}),
 *                 S7COMM_UD_SUBF_BLOCK_LISTTYPE 0x02 (request: block type; response: n × {number (16 bit), flags,
 *                 language}), S7COMM_UD_SUBF_BLOCK_BLOCKINFO 0x03 (request: type (2), number as 5 ASCII digits,
 *                 file system 'A'; response "78 Bytes": type (2), info length (2), unknown (2), const "pp" (2),
 *                 unknown (1), "Block flags" (1), "Block language" (1), sub block type (1), number (2),
 *                 "Length load memory" (4), "Block Security" (4: S7COMM_BLOCKSECURITY_OFF 0, _KNOWHOWPROTECT 3),
 *                 "Code timestamp" (6: ms of day u32 + days since 1984-01-01 u16), "Interface timestamp" (6), SSB (2),
 *                 ADD (2), local data (2), "MC7 code length" (2), author (8), family (8), name (8), version (1),
 *                 unknown (1), "Block checksum" s7comm.blockinfo.checksum FT_UINT16 (2), reserved (4), reserved (4));
 *               • block types S7COMM_BLOCKTYPE_OB 0x3038 '08', DB '0A', SDB '0B', FC '0C', SFC '0D', FB '0E', SFB '0F';
 *                 sub block types OB 0x08, DB 0x0A, SDB 0x0B, FC 0x0C, SFC 0x0D, FB 0x0E, SFB 0x0F;
 *               • S7COMM_UD_SUBF_CPU_READSZL 0x01: SZL-ID, index, partial list length, partial list count, records;
 *                 SZL 0x0011 "Module identification" record (s7comm_decode_szl_id_0111_idx_0001): index (2), MlfB =
 *                 order number (20 ASCII), BGTyp (2), Ausbg (2), Ausbe (2); SZL 0x001C "Component Identification"
 *                 record (s7comm_decode_szl_id_xy1c_idx_000x): index (2) + 32 bytes — index 0x0002 module name (24
 *                 ASCII), 0x0005 serial number of the module (24 ASCII).
 *  [SNAP7]    Snap7 1.3.0 (Davide Nardella), src/core/s7_types.h + s7_micro_client.cpp + s7_isotcp.cpp, fetched
 *             2026-10-11 (sha256 5bdc72ce…bd6e5 / f4f4f190…1a00a / d5630274…0dc0dc):
 *               • Block_OB 0x38, Block_DB 0x41, Block_SDB 0x42, Block_FC 0x43, Block_SFC 0x44, Block_FB 0x45,
 *                 Block_SFB 0x46; grBlocksInfo 0x43, grSZL 0x44; SFun_ListAll 0x01, SFun_ListBoT 0x02,
 *                 SFun_BlkInfo 0x03, SFun_ReadSZL 0x01; TS_ResOctet 0x09;
 *               • opListBlocks: params 00 01 12 04 11 43 01 00, data 0A 00 00 00; answer length must be 28 (7 types);
 *               • opListBlocksOfType: first telegram params plen 4 + data FF 09 00 02 30 <type>; following telegrams
 *                 params plen 8 (syntax 0x11) with the sequence number taken from the PLC's answer + 4 zero bytes, data
 *                 0A 00 00 00; done when the answer's "last data unit" byte is 0x00;
 *               • opAgBlockInfo: data FF 09 00 08 30 <type> <5 ASCII digits> 41; TResDataBlockInfo (the 78-byte layout
 *                 above: BlkFlags, BlkLang, SubBlkType, BlkNumber, LenLoadMem, BlkSec, CodeTime_ms/_dy,
 *                 IntfTime_ms/_dy, SbbLen, AddLen, LocDataLen, MC7Len, Author, Family, Header, Version, BlkChksum);
 *               • opReadSZL: first telegram params 00 01 12 04 11 44 01 00, data FF 09 00 04 <ID> <Index>; following
 *                 telegrams params plen 8 (syntax 0x12) + sequence of the answer + 4 zero bytes, data 0A 00 00 00; the
 *                 first answer's data = ID, Index, LENTHDR, N_DR, records; opGetOrderCode = SZL 0x0011 index 0
 *                 (order code at record 1 + 2), opGetCpuInfo = SZL 0x001C index 0 (module name, serial number …);
 *               • TIsoTcpSocket::BuildControlPDU: CR = TPDU size 0xC0 + calling TSAP 0xC1 + called TSAP 0xC2;
 *                 remote TSAP = (ConnectionType << 8) + Rack * 0x20 + Slot, ConnectionType PG = 0x01, local 0x0100.
 *
 * ── THE PROGRAM CHECKSUM (formula "s7-blockinfo-v2", rulings R-9-a + "weak-integrity-binding") ───────────────────────
 *   1. Identity: SZL 0x0011 index 0 → the record with index 0x0001 → order number (MlfB); SZL 0x001C index 0 → index
 *      0x0002 module name, index 0x0005 serial number. Each must be present and non-empty, else UNREADABLE.
 *   2. Block list (SFun_ListAll): every listed type with its count. The four program types (OB, DB, FC, FB) must be
 *      listed; SDB / SFC / SFB are covered whenever listed; a type code outside these seven with a count > 0 ⇒
 *      UNREADABLE (it cannot be read and is never skipped).
 *   3. For every listed type with count > 0: the block numbers (SFun_ListBoT, all telegrams) — exactly `count`, unique.
 *   4. For every block: its block info (SFun_BlkInfo) — the answer must name the requested type and number, be ≥ 78
 *      bytes, and report "Block Security" 0 (none). A know-how-protected block (or any other security value), a refused
 *      / missing / short answer ⇒ the WHOLE checksum is UNREADABLE (a block is never skipped).
 *   5. Canonical value = JSON.stringify of the array
 *        [ "s7-blockinfo-v2",
 *          ["endpoint", host, port, rack, slot],                       ← the adapter's configured endpoint
 *          ["identity", orderNumber, serialNumber, moduleName],
 *          ["list", [code, count], …]                                  ← every listed type, ascending type code
 *          ["block", TYPE, number, loadSize, mc7Size, checksum, version, flags, language, security,
 *                    codeMs, codeDays, interfaceMs, interfaceDays, ssbSize, addSize, localDataSize,
 *                    author, family, name], …                          ← ascending type code, then number
 *        ]
 *      (strings: ASCII / Latin-1 with trailing NUL and spaces removed; JSON quoting makes the encoding unambiguous).
 *   6. Program checksum = "s7:sha256:" + lower-case hex SHA-256 of the canonical value (UTF-8).
 *
 * ── L-7 / FAIL CLOSED ───────────────────────────────────────────────────────────────────────────────────────────────
 *   • READ-ONLY: only READ requests (setup, read SZL, list blocks, list blocks of type, block info) are sent; nothing is
 *     written and the controller's mode is never touched.
 *   • A SEPARATE ISO-on-TCP connection is opened for every read and closed after it, so it never queues behind or ahead
 *     of the nodes7 connection that carries writes (a STOP write never waits for a checksum read).
 *   • Every read is bounded by ONE deadline (connect + every request) and is cancelled by the caller's AbortSignal; on
 *     deadline / abort the socket is destroyed, so nothing stays pending.
 *   • Anything unexpected THROWS — the caller (programChecksum.readAdapterProgramCheck) then reports "unreadable" and the
 *     approval digest is null (fail-closed ⇒ the action is refused). It never answers "unsupported".
 */
import net from "node:net";
import { createHash } from "node:crypto";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

/** Source label ⇒ the screen says "per protocol documentation — not verified on a real device" + "not tamper-proof". */
export const S7_CHECKSUM_SOURCE = "s7-blockinfo";
/** Version tag of the canonical value (step 5 of the formula). */
export const S7_PROGRAM_CHECKSUM_FORMULA = "s7-blockinfo-v2";
/** Upper bound of one whole read (connect + all requests); equal to programChecksum.PROGRAM_CHECKSUM_READ_DEADLINE_MS. */
export const S7_PROGRAM_CHECKSUM_DEADLINE_MS = 1000;

/** Block types: [SNAP7] Block_*, [WS] S7COMM_BLOCKTYPE_* (low byte) / SUBBLKTYPE_*. `program` ⇒ must be listed. */
export const S7_BLOCK_TYPES = [
  { name: "OB", code: 0x38, sub: 0x08, program: true },
  { name: "DB", code: 0x41, sub: 0x0a, program: true },
  { name: "SDB", code: 0x42, sub: 0x0b, program: false },
  { name: "FC", code: 0x43, sub: 0x0c, program: true },
  { name: "SFC", code: 0x44, sub: 0x0d, program: false },
  { name: "FB", code: 0x45, sub: 0x0e, program: true },
  { name: "SFB", code: 0x46, sub: 0x0f, program: false },
] as const;
export type S7BlockTypeName = (typeof S7_BLOCK_TYPES)[number]["name"];
type S7BlockType = (typeof S7_BLOCK_TYPES)[number];

/** Every defined field of one block info answer ([WS] / [SNAP7] TResDataBlockInfo), reserved / unknown bytes excluded. */
export interface S7BlockInfo {
  type: S7BlockTypeName;
  number: number;
  loadSize: number;
  mc7Size: number;
  /** "Block checksum", 16 bit — NOT cryptographic. */
  checksum: number;
  version: number;
  flags: number;
  language: number;
  /** "Block Security": 0 none, 3 know-how protect. Only 0 is ever accepted. */
  security: number;
  codeMs: number;
  codeDays: number;
  interfaceMs: number;
  interfaceDays: number;
  ssbSize: number;
  addSize: number;
  localDataSize: number;
  author: string;
  family: string;
  name: string;
}

export interface S7ControllerIdentity {
  orderNumber: string;
  serialNumber: string;
  moduleName: string;
}

export interface S7ChecksumTarget {
  host: string;
  port: number;
  rack: number;
  slot: number;
}

/** Everything the checksum is computed from. */
export interface S7ProgramSnapshot {
  endpoint: S7ChecksumTarget;
  identity: S7ControllerIdentity;
  /** The block list as listed: type code → count. */
  listed: Array<{ code: number; count: number }>;
  blocks: S7BlockInfo[];
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
const UD_FUNCGROUP_CPU = 0x04;
const UD_TYPE_REQ = 0x1;
const UD_TYPE_RES = 0x2;
const SUBF_LIST = 0x01;
const SUBF_LISTTYPE = 0x02;
const SUBF_BLOCKINFO = 0x03;
const SUBF_READSZL = 0x01;
const RETVAL_OK = 0xff;
const TS_OCTET = 0x09;
const BLOCKINFO_LEN = 78; // [WS] "78 Bytes"
const BLOCKSECURITY_OFF = 0; // [WS] S7COMM_BLOCKSECURITY_OFF
const SZL_MODULE_ID = 0x0011; // [WS] "Module identification", record 28 bytes
const SZL_COMPONENT_ID = 0x001c; // [WS] "Component Identification", record 34 bytes
const LOCAL_TSAP = 0x0100; // [SNAP7] default local TSAP
const CONN_TYPE_PG = 0x01; // [SNAP7] CONNTYPE_PG
const REQUESTED_PDU = 480; // [SNAP7] default negotiated PDU length
const MAX_TELEGRAMS = 4096; // bound of any multi-telegram answer (the deadline bounds it too)

const fail = (why: string): never => {
  throw new DeviceUnreachableError("s7", `program checksum: ${why}`);
};

/** ASCII / Latin-1 field without trailing NUL bytes and spaces. */
function text(b: Buffer): string {
  return b.toString("latin1").replace(/[\0 ]+$/, "");
}

/**
 * The program checksum of a snapshot (formula above). Pure; the order of `listed` / `blocks` does not matter.
 * Throws (fail-closed) on: an empty identity field, a duplicate block, a block whose type is not listed, a block count
 * that differs from the list, a know-how-protected block, a listed unknown type with a count.
 */
export function combineS7ProgramSnapshot(s: S7ProgramSnapshot): string {
  const typeOf = new Map<string, S7BlockType>(S7_BLOCK_TYPES.map((t) => [t.name, t]));
  for (const k of ["orderNumber", "serialNumber", "moduleName"] as const) {
    if (typeof s.identity[k] !== "string" || s.identity[k].length === 0) fail(`controller identity has no ${k}`);
  }
  const listed = [...s.listed].sort((a, b) => a.code - b.code);
  for (let i = 1; i < listed.length; i++) if (listed[i]!.code === listed[i - 1]!.code) fail("block list has a duplicate type");
  const countOf = new Map(listed.map((l) => [l.code, l.count]));
  for (const t of S7_BLOCK_TYPES) if (t.program && !countOf.has(t.code)) fail(`snapshot has no ${t.name} list entry`);
  for (const l of listed) if (l.count > 0 && !S7_BLOCK_TYPES.some((t) => t.code === l.code)) fail(`unknown block type 0x${l.code.toString(16)} listed`);
  const blocks = [...s.blocks].sort((a, b) => (typeOf.get(a.type)?.code ?? 0) - (typeOf.get(b.type)?.code ?? 0) || a.number - b.number);
  const seen = new Map<number, number>();
  let prev = "";
  for (const b of blocks) {
    const t = typeOf.get(b.type);
    if (!t) fail(`unknown block type ${String(b.type)}`);
    const key = `${b.type} ${b.number}`;
    if (key === prev) fail(`duplicate block ${key}`);
    prev = key;
    if (b.security !== BLOCKSECURITY_OFF) fail(`${key} is protected (block security ${b.security}) — its content is not covered`);
    seen.set(t!.code, (seen.get(t!.code) ?? 0) + 1);
  }
  for (const l of listed) if ((seen.get(l.code) ?? 0) !== l.count) fail(`block list says ${l.count} of type 0x${l.code.toString(16)}, ${seen.get(l.code) ?? 0} read`);
  for (const [code] of seen) if (!countOf.has(code)) fail(`blocks of an unlisted type 0x${code.toString(16)}`);
  const e = s.endpoint;
  const canonical: unknown[] = [
    S7_PROGRAM_CHECKSUM_FORMULA,
    ["endpoint", e.host, e.port, e.rack, e.slot],
    ["identity", s.identity.orderNumber, s.identity.serialNumber, s.identity.moduleName],
    ["list", ...listed.map((l) => [l.code, l.count])],
    ...blocks.map((b) => [
      "block", b.type, b.number, b.loadSize, b.mc7Size, b.checksum, b.version, b.flags, b.language, b.security,
      b.codeMs, b.codeDays, b.interfaceMs, b.interfaceDays, b.ssbSize, b.addSize, b.localDataSize, b.author, b.family, b.name,
    ]),
  ];
  return `s7:sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`;
}

/** Reads the identity, the block list and every listed block's info over one bounded, separate connection. */
export async function readS7ProgramSnapshot(target: S7ChecksumTarget, opts: S7ChecksumReadOptions = {}): Promise<S7ProgramSnapshot> {
  const session = new S7InfoSession(target, opts.deadlineMs ?? S7_PROGRAM_CHECKSUM_DEADLINE_MS, opts.signal);
  try {
    await session.open();
    const identity = await session.identity();
    const listed = await session.listAll();
    const blocks: S7BlockInfo[] = [];
    for (const l of [...listed].sort((a, b) => a.code - b.code)) {
      if (l.count === 0) continue;
      const t = S7_BLOCK_TYPES.find((x) => x.code === l.code);
      if (!t) session.fail(`listed block type 0x${l.code.toString(16)} cannot be read`);
      const numbers = await session.listOfType(t!.code, l.count);
      if (numbers.length !== l.count || new Set(numbers).size !== numbers.length) {
        session.fail(`${t!.name} list inconsistent (listed ${l.count}, received ${numbers.length})`);
      }
      for (const n of numbers) blocks.push(await session.blockInfo(t!, n));
    }
    return { endpoint: { ...target }, identity, listed, blocks };
  } finally {
    session.close();
  }
}

/** The program checksum of the controller at `target` (formula above). Throws when it cannot be read (fail-closed). */
export async function readS7ProgramChecksum(target: S7ChecksumTarget, opts: S7ChecksumReadOptions = {}): Promise<string> {
  return combineS7ProgramSnapshot(await readS7ProgramSnapshot(target, opts));
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

  /** SZL 0x0011 + 0x001C ⇒ order number, serial number, module name (each required, non-empty). */
  async identity(): Promise<S7ControllerIdentity> {
    const mod = await this.readSzl(SZL_MODULE_ID, 28);
    const comp = await this.readSzl(SZL_COMPONENT_ID, 34);
    const field = (records: Map<number, Buffer>, idx: number, from: number, len: number, what: string): string => {
      const r = records.get(idx);
      if (!r) this.fail(`controller identity: no ${what} record`);
      const v = text(r!.subarray(from, from + len));
      if (v.length === 0) this.fail(`controller identity: empty ${what}`);
      return v;
    };
    return {
      orderNumber: field(mod, 0x0001, 2, 20, "order number"),
      serialNumber: field(comp, 0x0005, 2, 24, "serial number"),
      moduleName: field(comp, 0x0002, 2, 24, "module name"),
    };
  }

  /**
   * Read SZL, index 0 (all telegrams) ⇒ records keyed by their EXACT index. ([WS] notes that redundant H-CPUs may set
   * upper index bits; such a controller then has no exact 0x0002 / 0x0005 record ⇒ unreadable, fail-closed.)
   */
  private async readSzl(id: number, recordLen: number): Promise<Map<number, Buffer>> {
    let r = await this.userdata(UD_FUNCGROUP_CPU, SUBF_READSZL, 0x00, null, Buffer.from([RETVAL_OK, TS_OCTET, 0x00, 0x04, id >> 8, id & 0xff, 0x00, 0x00]));
    const first = r.payload;
    if (first.length < 8) this.fail(`SZL 0x${id.toString(16)} answer too short`);
    if (first.readUInt16BE(0) !== id || first.readUInt16BE(2) !== 0x0000) this.fail(`SZL answer is not 0x${id.toString(16)}`);
    const lenthdr = first.readUInt16BE(4);
    const count = first.readUInt16BE(6);
    if (lenthdr !== recordLen) this.fail(`SZL 0x${id.toString(16)} record length ${lenthdr}`);
    const parts = [first.subarray(8)];
    for (let telegrams = 1; r.lastDataUnit !== 0x00; telegrams++) {
      if (telegrams > MAX_TELEGRAMS) this.fail("SZL answer does not end");
      r = await this.userdata(UD_FUNCGROUP_CPU, SUBF_READSZL, r.seq, 0x12, Buffer.from([0x0a, 0x00, 0x00, 0x00]));
      parts.push(r.payload);
    }
    const all = Buffer.concat(parts);
    if (all.length !== lenthdr * count) this.fail(`SZL 0x${id.toString(16)} length inconsistent`);
    const records = new Map<number, Buffer>();
    for (let i = 0; i < all.length; i += lenthdr) {
      const rec = all.subarray(i, i + lenthdr);
      if (records.has(rec.readUInt16BE(0))) this.fail(`SZL 0x${id.toString(16)} duplicate record`);
      records.set(rec.readUInt16BE(0), rec);
    }
    return records;
  }

  /** SFun_ListAll ⇒ every listed type with its count. */
  async listAll(): Promise<Array<{ code: number; count: number }>> {
    const r = await this.userdata(UD_FUNCGROUP_BLOCK, SUBF_LIST, 0x00, null, Buffer.from([0x0a, 0x00, 0x00, 0x00]));
    const d = r.payload;
    if (d.length % 4 !== 0) this.fail("block list length invalid");
    const listed: Array<{ code: number; count: number }> = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== 0x30) this.fail("block list entry invalid");
      if (listed.some((l) => l.code === d[i + 1])) this.fail("block list has a duplicate type");
      listed.push({ code: d[i + 1]!, count: d.readUInt16BE(i + 2) });
    }
    for (const t of S7_BLOCK_TYPES) if (t.program && !listed.some((l) => l.code === t.code)) this.fail(`block list has no ${t.name} entry`);
    return listed;
  }

  /** SFun_ListBoT (multi-telegram) ⇒ the block numbers of one type. */
  async listOfType(typeCode: number, expected: number): Promise<number[]> {
    const numbers: number[] = [];
    let r = await this.userdata(UD_FUNCGROUP_BLOCK, SUBF_LISTTYPE, 0x00, null, Buffer.from([RETVAL_OK, TS_OCTET, 0x00, 0x02, 0x30, typeCode]));
    // A telegram carries ≥ 1 entry (except a final empty one); bound the loop by the listed count.
    for (let telegrams = 1; ; telegrams++) {
      const d = r.payload;
      if (d.length % 4 !== 0) this.fail("block-of-type list length invalid");
      for (let i = 0; i < d.length; i += 4) numbers.push(d.readUInt16BE(i));
      if (r.lastDataUnit === 0x00) break;
      if (telegrams > expected + 1) this.fail("block-of-type list does not end");
      r = await this.userdata(UD_FUNCGROUP_BLOCK, SUBF_LISTTYPE, r.seq, 0x11, Buffer.from([0x0a, 0x00, 0x00, 0x00]));
    }
    return numbers;
  }

  /** SFun_BlkInfo ⇒ every defined field; the answer must name the requested block, be complete and unprotected. */
  async blockInfo(t: S7BlockType, number: number): Promise<S7BlockInfo> {
    if (!Number.isInteger(number) || number < 0 || number > 65535) this.fail("block number out of range");
    const ascii = Buffer.from(String(number).padStart(5, "0"), "ascii");
    const r = await this.userdata(UD_FUNCGROUP_BLOCK, SUBF_BLOCKINFO, 0x00, null, Buffer.concat([Buffer.from([RETVAL_OK, TS_OCTET, 0x00, 0x08, 0x30, t.code]), ascii, Buffer.from([0x41])]));
    const p = r.payload;
    if (p.length < BLOCKINFO_LEN) this.fail(`block info of ${t.name} ${number} too short`);
    if (p[0] !== 0x30 || p[1] !== t.code || p[11] !== t.sub || p.readUInt16BE(12) !== number) {
      this.fail(`block info answer does not match ${t.name} ${number}`);
    }
    const security = p.readUInt32BE(18);
    if (security !== BLOCKSECURITY_OFF) this.fail(`${t.name} ${number} is protected (block security ${security}) — its content is not covered`);
    return {
      type: t.name,
      number,
      flags: p[9]!,
      language: p[10]!,
      loadSize: p.readUInt32BE(14),
      security,
      codeMs: p.readUInt32BE(22),
      codeDays: p.readUInt16BE(26),
      interfaceMs: p.readUInt32BE(28),
      interfaceDays: p.readUInt16BE(32),
      ssbSize: p.readUInt16BE(34),
      addSize: p.readUInt16BE(36),
      localDataSize: p.readUInt16BE(38),
      mc7Size: p.readUInt16BE(40),
      author: text(p.subarray(42, 50)),
      family: text(p.subarray(50, 58)),
      name: text(p.subarray(58, 66)),
      version: p[66]!,
      checksum: p.readUInt16BE(68),
    };
  }

  /**
   * One userdata request; validates the answer's parameter and data headers. `followUp` = the syntax byte of a
   * follow-up telegram ([SNAP7]: 0x11 for list blocks of type, 0x12 for read SZL), null for a first telegram.
   */
  private async userdata(group: number, subfn: number, seq: number, followUp: number | null, data: Buffer): Promise<{ payload: Buffer; seq: number; lastDataUnit: number }> {
    // [SNAP7] TReqFunTypedParams: 00 01 12 plen <syntax> <type|group> subfn seq (+ 4 zero bytes on a follow-up, plen 8).
    const head = Buffer.from([0x00, 0x01, 0x12, followUp === null ? 0x04 : 0x08, followUp ?? 0x11, (UD_TYPE_REQ << 6) | group, subfn, seq]);
    const param = followUp === null ? head : Buffer.concat([head, Buffer.alloc(4)]);
    const r = await this.exchange(ROSCTR_USERDATA, param, data);
    const p = r.param;
    if (r.rosctr !== ROSCTR_USERDATA || p.length < 12 || p[0] !== 0x00 || p[1] !== 0x01 || p[2] !== 0x12 || p[3] !== 0x08) this.fail("userdata answer header invalid");
    if (p[5]! >> 6 !== UD_TYPE_RES || (p[5]! & 0x3f) !== group || p[6] !== subfn) this.fail("userdata answer is not the requested function's response");
    const errorCode = p.readUInt16BE(10);
    if (errorCode !== 0) this.fail(`function refused (error code 0x${errorCode.toString(16).padStart(4, "0")})`);
    const d = r.data;
    if (d.length < 4) this.fail("userdata answer has no data part");
    if (d[0] !== RETVAL_OK) this.fail(`function return code 0x${d[0]!.toString(16).padStart(2, "0")}`);
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
