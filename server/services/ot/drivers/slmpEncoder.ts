/**
 * doc 40 Wave 5 — OT-F8 / CTL-04 / MTX: SLMP (SeamLess Message Protocol) 3E/4E BINARY
 * encoder/decoder — THUẦN trên Buffer (node:net-friendly, KHÔNG npm dep, KHÔNG I/O).
 *
 * ── VÌ SAO CÓ FILE NÀY ────────────────────────────────────────────────────────
 * `mcprotocol` (dùng ở mitsubishiMcDriver.ts) chỉ mã hoá 1E frame (A-compatible),
 * KHÔNG nói được SLMP 3E/4E — mà iQ-R/iQ-F/FX5U MẶC ĐỊNH SLMP 3E frame (SH-081227
 * §"Message Format" / SLMP Reference SH-080956ENG §3E-4E). File này tự mã hoá 3E
 * (và 4E) nhị phân theo đúng spec đã transcribe trong mitsubishiMcDriver.ts dòng
 * 26-47, dùng bảng device-code hex ở mcAddress.ts.
 *
 * ── ĐỊNH DẠNG 3E REQUEST (little-endian mọi trường số nhiều byte) ─────────────
 *   [50 00]        subheader 3E request
 *   [netNo 1B]     network No.            (mặc định 00 = host)
 *   [pcNo 1B]      PC No. / station        (mặc định FF = host)
 *   [moduleIo 2B]  request dest module I/O (mặc định 03FFH = host CPU)
 *   [multidrop 1B] request dest multidrop station No. (mặc định 00)
 *   [dataLen 2B]   request-data length = số byte SAU trường này
 *   ── body (dài dataLen byte) ──
 *   [timer 2B]     monitoring timer        (00 00 = chờ vô hạn)
 *   [cmd 2B]       command                 (0401H batch-read / 1401H batch-write)
 *   [subcmd 2B]    subcommand              (0000H word-unit / 0001H bit-unit)
 *   [devNo 3B]     head device No.
 *   [devCode 1B]   device code (D=A8, M=90, X=9C…)
 *   [points 2B]    số điểm
 *   [writeData …]  (chỉ write) word: points*2 byte; bit: đóng gói 2 điểm/byte
 *
 * 3E RESPONSE OK: [D0 00][netNo][pcNo][moduleIo 2B][multidrop][dataLen 2B]
 *                 [endCode 2B = 00 00][data…]. dataLen = 2(endCode) + len(data).
 *
 * ── 4E = 3E + serial ─────────────────────────────────────────────────────────
 *   Request subheader 54 00; SAU subheader chèn [serialNo 2B][0000 2B]. Response
 *   subheader D4 00 + echo serial. Phần còn lại y hệt 3E.
 *
 * ── BIT PACKING (binary bit-unit) ─────────────────────────────────────────────
 *   2 điểm / byte; điểm SỐ THẤP HƠN nằm ở NIBBLE CAO (bit 4-7), điểm kế ở nibble
 *   thấp; mỗi nibble = 0x1 (ON) / 0x0 (OFF). Điểm lẻ cuối → nibble thấp = 0.
 *   (SH-081227 / SH-080956 "Bit units, binary": lower device No. in the upper bits.)
 *   ⚠️ FAT: thứ tự nibble là điểm CẦN xác minh trên thiết bị thật; encode↔decode ở
 *   đây là CẶP nhất quán (round-trip test) — đủ cho HW-FAT, KHÔNG tuyên bố đã-validate.
 *
 * scale/offset KHÔNG áp ở đây (driver áp sau — nhất quán modbus/mc).
 */

export type SlmpFrame = "3E" | "4E";

/** Cấu hình access-route + framing cho SLMP. Mọi trường tuỳ chọn có mặc định host. */
export interface SlmpConfig {
  /** Khung bản tin. Mặc định "3E". */
  frame?: SlmpFrame;
  /** Network No. (byte). Mặc định 0x00 = host. */
  networkNo?: number;
  /** PC No. / station (byte). Mặc định 0xFF = host trực tiếp. */
  stationNo?: number;
  /** Request dest module I/O No. Mặc định 0x03FF = host CPU. */
  moduleIo?: number;
  /** Request dest multidrop station No. Mặc định 0x00. */
  multidropStation?: number;
  /** Monitoring timer (đơn vị 250ms). Mặc định 0 = chờ vô hạn. */
  monitoringTimer?: number;
  /**
   * Dòng FX (FX5U) đánh địa chỉ X/Y HỆ BÁT PHÂN; Q/L/iQ-R HỆ 16. true → parse số
   * X/Y theo base-8. Mặc định false (hệ 16 cho X/Y như Q/iQ-R).
   */
  octalInputOutput?: boolean;
  /** Serial No. cho 4E frame (driver tăng dần). Bỏ qua với 3E. */
  serial?: number;
}

/**
 * ── BẢNG DEVICE-CODE 1 BYTE (Q/L series, subcommand 0000/0001) ───────────────
 * Nguồn: MELSEC Communication Protocol Ref (SH-081227ENG) §8.1 p68 + SLMP Ref
 * (SH-080956ENG) §5.2 p35-36 — CÙNG bảng đã ghi ở mcAddress.ts.
 */
export const SLMP_DEVICE_CODES: Record<string, number> = {
  SM: 0x91, SD: 0xa9, X: 0x9c, Y: 0x9d, M: 0x90, L: 0x92, F: 0x93, V: 0x94,
  B: 0xa0, D: 0xa8, W: 0xb4, TS: 0xc1, TC: 0xc0, TN: 0xc2,
  SS: 0xc7, SC: 0xc6, SN: 0xc8, CS: 0xc4, CC: 0xc3, CN: 0xc5,
  SB: 0xa1, SW: 0xb5, S: 0x98, DX: 0xa2, DY: 0xa3, Z: 0xcc, R: 0xaf, ZR: 0xb0,
};

/** Device có SỐ viết HỆ 16 (Notation=Hexadecimal, SH-081227 p68). Còn lại hệ 10. */
export const SLMP_HEX_DEVICES = new Set(["X", "Y", "B", "W", "SB", "SW", "DX", "DY", "Z"]);

/** Device kiểu BIT (đọc/ghi bit-unit trả boolean). */
export const SLMP_BIT_DEVICES = new Set([
  "X", "Y", "M", "L", "F", "V", "B", "SM", "SB", "DX", "DY", "S", "TS", "TC", "CS", "CC",
]);

/** Device CHỈ ĐỌC (input relay / direct input) — không cho ghi. */
export const SLMP_READ_ONLY_DEVICES = new Set(["X", "DX"]);

export interface ParsedSlmpDevice {
  device: string;
  head: number;
  code: number;
  isBit: boolean;
  isReadOnly: boolean;
}

/**
 * Parse + validate địa chỉ SLMP ("D100", "M200", "X1A", "Y10"…). Số device theo
 * hệ 16 cho X/Y/B/W/SB/SW/DX/DY/Z (hoặc bát-phân cho X/Y nếu octalIO), hệ 10 còn lại.
 * Sai định dạng / device lạ → throw.
 */
export function parseSlmpDevice(address: string, octalIO = false): ParsedSlmpDevice {
  const a = String(address ?? "").trim().toUpperCase();
  if (!a) throw new Error(`invalid SLMP address: ${address}`);
  const m = a.match(/^([A-Z]+)([0-9A-F]+)$/);
  if (!m) throw new Error(`invalid SLMP address: ${address}`);

  const device = m[1];
  const numPart = m[2];
  const code = SLMP_DEVICE_CODES[device];
  if (code === undefined) throw new Error(`unknown SLMP device: ${device} (in ${address})`);

  let radix = 10;
  if (octalIO && (device === "X" || device === "Y")) radix = 8;
  else if (SLMP_HEX_DEVICES.has(device)) radix = 16;

  if (radix === 10 && /[A-F]/.test(numPart)) {
    throw new Error(`invalid SLMP address (decimal device with hex digit): ${address}`);
  }
  if (radix === 8 && /[89A-F]/.test(numPart)) {
    throw new Error(`invalid SLMP address (octal device with non-octal digit): ${address}`);
  }
  const head = parseInt(numPart, radix);
  if (!Number.isFinite(head) || head < 0 || head > 0xffffff) {
    throw new Error(`SLMP device number out of range (0..0xFFFFFF): ${address}`);
  }

  return {
    device,
    head,
    code,
    isBit: SLMP_BIT_DEVICES.has(device),
    isReadOnly: SLMP_READ_ONLY_DEVICES.has(device),
  };
}

const CMD_BATCH_READ = 0x0401;
const CMD_BATCH_WRITE = 0x1401;
const SUB_WORD = 0x0000;
const SUB_BIT = 0x0001;

/** Dựng phần header (tới hết trường dataLen) cho 3E/4E; điền dataLen sau. */
function buildHeaderAndBody(cfg: SlmpConfig, body: Buffer): Buffer {
  const frame = cfg.frame ?? "3E";
  const netNo = cfg.networkNo ?? 0x00;
  const pcNo = cfg.stationNo ?? 0xff;
  const moduleIo = cfg.moduleIo ?? 0x03ff;
  const multidrop = cfg.multidropStation ?? 0x00;

  if (frame === "4E") {
    const header = Buffer.alloc(13);
    header[0] = 0x54;
    header[1] = 0x00;
    header.writeUInt16LE((cfg.serial ?? 0) & 0xffff, 2);
    header.writeUInt16LE(0x0000, 4); // reserved
    header[6] = netNo;
    header[7] = pcNo;
    header.writeUInt16LE(moduleIo, 8);
    header[10] = multidrop;
    header.writeUInt16LE(body.length, 11);
    return Buffer.concat([header, body]);
  }

  // 3E
  const header = Buffer.alloc(9);
  header[0] = 0x50;
  header[1] = 0x00;
  header[2] = netNo;
  header[3] = pcNo;
  header.writeUInt16LE(moduleIo, 4);
  header[6] = multidrop;
  header.writeUInt16LE(body.length, 7);
  return Buffer.concat([header, body]);
}

/** Body chung: timer + cmd + subcmd + head-device(3B) + devCode(1B) + points(2B). */
function deviceBody(cmd: number, sub: number, dev: ParsedSlmpDevice, points: number, cfg: SlmpConfig): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt16LE((cfg.monitoringTimer ?? 0) & 0xffff, 0);
  b.writeUInt16LE(cmd, 2);
  b.writeUInt16LE(sub, 4);
  b.writeUIntLE(dev.head, 6, 3);
  b[9] = dev.code;
  b.writeUInt16LE(points & 0xffff, 10);
  return b;
}

/** Đóng gói bit → byte (2 điểm/byte, điểm thấp ở nibble cao). */
export function packBits(bits: boolean[]): Buffer {
  const out = Buffer.alloc(Math.ceil(bits.length / 2));
  for (let i = 0; i < bits.length; i++) {
    const byteIdx = i >> 1;
    const hi = (i & 1) === 0; // điểm chẵn → nibble cao
    if (bits[i]) out[byteIdx] |= hi ? 0x10 : 0x01;
  }
  return out;
}

export interface SlmpRequest {
  request: Buffer;
  /** Serial đã dùng (chỉ 4E) — driver dùng để đối chiếu response. */
  serial?: number;
}

/** Batch-read WORD (command 0401H, subcommand 0000H). count = số WORD. */
export function buildBatchReadWord(address: string, count: number, cfg: SlmpConfig = {}): SlmpRequest {
  const dev = parseSlmpDevice(address, cfg.octalInputOutput);
  const body = deviceBody(CMD_BATCH_READ, SUB_WORD, dev, count, cfg);
  return { request: buildHeaderAndBody(cfg, body), serial: cfg.frame === "4E" ? (cfg.serial ?? 0) & 0xffff : undefined };
}

/** Batch-read BIT (command 0401H, subcommand 0001H). count = số ĐIỂM bit. */
export function buildBatchReadBit(address: string, count: number, cfg: SlmpConfig = {}): SlmpRequest {
  const dev = parseSlmpDevice(address, cfg.octalInputOutput);
  const body = deviceBody(CMD_BATCH_READ, SUB_BIT, dev, count, cfg);
  return { request: buildHeaderAndBody(cfg, body), serial: cfg.frame === "4E" ? (cfg.serial ?? 0) & 0xffff : undefined };
}

/** Batch-write WORD (command 1401H, subcommand 0000H). words = giá trị 16-bit (LE). */
export function buildBatchWriteWord(address: string, words: number[], cfg: SlmpConfig = {}): SlmpRequest {
  const dev = parseSlmpDevice(address, cfg.octalInputOutput);
  const head = deviceBody(CMD_BATCH_WRITE, SUB_WORD, dev, words.length, cfg);
  const data = Buffer.alloc(words.length * 2);
  for (let i = 0; i < words.length; i++) data.writeUInt16LE(words[i] & 0xffff, i * 2);
  const body = Buffer.concat([head, data]);
  return { request: buildHeaderAndBody(cfg, body), serial: cfg.frame === "4E" ? (cfg.serial ?? 0) & 0xffff : undefined };
}

/** Batch-write BIT (command 1401H, subcommand 0001H). bits = mảng boolean. */
export function buildBatchWriteBit(address: string, bits: boolean[], cfg: SlmpConfig = {}): SlmpRequest {
  const dev = parseSlmpDevice(address, cfg.octalInputOutput);
  const head = deviceBody(CMD_BATCH_WRITE, SUB_BIT, dev, bits.length, cfg);
  const body = Buffer.concat([head, packBits(bits)]);
  return { request: buildHeaderAndBody(cfg, body), serial: cfg.frame === "4E" ? (cfg.serial ?? 0) & 0xffff : undefined };
}

export interface SlmpResponse {
  endCode: number;
  data: Buffer;
  serial?: number;
}

/**
 * Chiều dài đầy đủ (byte) một response frame trong `buf`, hay -1 nếu chưa đủ header
 * để đọc trường dataLen (driver dùng để gộp chunk TCP tới khi đủ 1 frame).
 */
export function expectedFrameLength(buf: Buffer, frame: SlmpFrame): number {
  if (frame === "4E") {
    if (buf.length < 13) return -1;
    return 13 + buf.readUInt16LE(11);
  }
  if (buf.length < 9) return -1;
  return 9 + buf.readUInt16LE(7);
}

/**
 * Parse response frame: kiểm subheader (D0 00 / D4 00), tách endCode + data. KHÔNG
 * kiểm endCode (caller quyết định quality theo endCode !== 0). Frame sai → throw.
 */
export function parseResponse(buf: Buffer, frame: SlmpFrame): SlmpResponse {
  if (frame === "4E") {
    if (buf.length < 15) throw new Error(`SLMP 4E response too short: ${buf.length} bytes`);
    if (buf[0] !== 0xd4 || buf[1] !== 0x00) {
      throw new Error(`SLMP 4E bad subheader: ${buf[0].toString(16)} ${buf[1].toString(16)}`);
    }
    const serial = buf.readUInt16LE(2);
    const dataLen = buf.readUInt16LE(11);
    const endCode = buf.readUInt16LE(13);
    const data = buf.subarray(15, 13 + dataLen);
    return { endCode, data, serial };
  }
  if (buf.length < 11) throw new Error(`SLMP 3E response too short: ${buf.length} bytes`);
  if (buf[0] !== 0xd0 || buf[1] !== 0x00) {
    throw new Error(`SLMP 3E bad subheader: ${buf[0].toString(16)} ${buf[1].toString(16)}`);
  }
  const dataLen = buf.readUInt16LE(7);
  const endCode = buf.readUInt16LE(9);
  const data = buf.subarray(11, 9 + dataLen);
  return { endCode, data };
}

/** Giải mã `count` word (unsigned 16-bit LE) từ data. */
export function decodeWordsUnsigned(data: Buffer, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(data.readUInt16LE(i * 2));
  return out;
}

/** Giải mã 1 word signed 16-bit (D-register mặc định signed). */
export function decodeInt16(data: Buffer): number {
  return data.readInt16LE(0);
}

/** Giải mã float 32-bit từ 2 word (word-thấp trước — MELSEC LE). */
export function decodeFloat32(data: Buffer): number {
  return data.readFloatLE(0);
}

/** Mã hoá float 32-bit → 2 word (word-thấp trước). */
export function encodeFloat32(value: number): number[] {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value, 0);
  return [b.readUInt16LE(0), b.readUInt16LE(2)];
}

/** Giải mã `count` bit từ data (2 điểm/byte, điểm thấp ở nibble cao). */
export function decodeBits(data: Buffer, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const byte = data[i >> 1] ?? 0;
    const nibble = (i & 1) === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
    out.push((nibble & 0x1) === 0x1);
  }
  return out;
}
