/**
 * SECS-II binary item codec (SEMI E5) — bounded, self-contained, round-trippable.
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This file implements the SECS-II ITEM layer ONLY: the binary encode/decode of
 * data items and the standard format codes. It is deliberately BOUNDED:
 *   - It is a complete, round-trippable SECS-II *item* codec (encode∘decode ==
 *     identity for every supported format, including nested lists of lists).
 *   - It is NOT a GEM (SEMI E30) implementation: no control-state model, no
 *     dynamic event/report linking (S2F33/F35/F37), no spooling, no timers
 *     T3–T8, no equipment-constant negotiation. A handful of standard S1
 *     messages are provided (see s1Messages.ts) purely for connectivity bring-up.
 *   - JIS-8 (format 0o21) is intentionally NOT implemented (rare; A/ASCII covers
 *     the connectivity messages this framework exchanges).
 *
 * ── SECS-II ITEM WIRE FORMAT (SEMI E5) ───────────────────────────────────────
 * Every item is: [format-byte][length-bytes...][data...].
 *   - The format byte's high 6 bits are the FORMAT CODE; the low 2 bits give the
 *     NUMBER OF LENGTH BYTES that follow (1, 2, or 3 — 0 is illegal).
 *   - The length value (big-endian, 1..3 bytes) is the BYTE COUNT of the data
 *     that follows — EXCEPT for List (L), where it is the ELEMENT COUNT.
 *   - Numeric multi-byte values are BIG-ENDIAN (network order).
 *
 * Format codes (the 6-bit value; the SEMI spec quotes them in octal):
 *   L       0o00 (0)   list       — length = child element count
 *   B       0o10 (8)   binary     — raw bytes (0..255 each)
 *   BOOLEAN 0o11 (9)   1 byte/elem (0x00 = false, non-zero = true → 0x01)
 *   A       0o20 (16)  ASCII string
 *   I8      0o30 (24)  signed   64-bit  (bigint)
 *   I1      0o31 (25)  signed    8-bit
 *   I2      0o32 (26)  signed   16-bit
 *   I4      0o34 (28)  signed   32-bit
 *   F8      0o40 (32)  IEEE-754 double (8 bytes)
 *   F4      0o44 (36)  IEEE-754 single (4 bytes)
 *   U8      0o50 (40)  unsigned 64-bit  (bigint)
 *   U1      0o51 (41)  unsigned  8-bit
 *   U2      0o52 (42)  unsigned 16-bit
 *   U4      0o54 (44)  unsigned 32-bit
 *
 * 64-bit ints (I8/U8) use `bigint`, since a JS number cannot represent the full
 * 64-bit range without precision loss. All other numerics use `number`.
 */

/** SECS-II item format codes (the 6-bit value, NOT octal-shifted). */
export const Secs2Format = {
  L: 0o00, // 0  — list
  B: 0o10, // 8  — binary
  BOOLEAN: 0o11, // 9
  A: 0o20, // 16 — ASCII
  I8: 0o30, // 24
  I1: 0o31, // 25
  I2: 0o32, // 26
  I4: 0o34, // 28
  F8: 0o40, // 32
  F4: 0o44, // 36
  U8: 0o50, // 40
  U1: 0o51, // 41
  U2: 0o52, // 42
  U4: 0o54, // 44
} as const;

export type Secs2FormatCode = (typeof Secs2Format)[keyof typeof Secs2Format];

/**
 * A SECS-II data item — a discriminated union mirroring the SEMI E5 item tree.
 * `L` (list) is recursive. Multi-element numeric items carry a JS array (one
 * entry per element). I8/U8 carry `bigint[]`; all other numerics carry `number[]`.
 */
export type Secs2Item =
  | { format: "L"; value: Secs2Item[] }
  | { format: "A"; value: string }
  | { format: "B"; value: number[] } // each 0..255
  | { format: "BOOLEAN"; value: boolean[] }
  | { format: "I1"; value: number[] }
  | { format: "I2"; value: number[] }
  | { format: "I4"; value: number[] }
  | { format: "I8"; value: bigint[] }
  | { format: "U1"; value: number[] }
  | { format: "U2"; value: number[] }
  | { format: "U4"; value: number[] }
  | { format: "U8"; value: bigint[] }
  | { format: "F4"; value: number[] }
  | { format: "F8"; value: number[] };

/** Convenience constructors (keep call-sites declarative). */
export const I = {
  L: (...items: Secs2Item[]): Secs2Item => ({ format: "L", value: items }),
  A: (value: string): Secs2Item => ({ format: "A", value }),
  B: (...value: number[]): Secs2Item => ({ format: "B", value }),
  BOOLEAN: (...value: boolean[]): Secs2Item => ({ format: "BOOLEAN", value }),
  I1: (...value: number[]): Secs2Item => ({ format: "I1", value }),
  I2: (...value: number[]): Secs2Item => ({ format: "I2", value }),
  I4: (...value: number[]): Secs2Item => ({ format: "I4", value }),
  I8: (...value: bigint[]): Secs2Item => ({ format: "I8", value }),
  U1: (...value: number[]): Secs2Item => ({ format: "U1", value }),
  U2: (...value: number[]): Secs2Item => ({ format: "U2", value }),
  U4: (...value: number[]): Secs2Item => ({ format: "U4", value }),
  U8: (...value: bigint[]): Secs2Item => ({ format: "U8", value }),
  F4: (...value: number[]): Secs2Item => ({ format: "F4", value }),
  F8: (...value: number[]): Secs2Item => ({ format: "F8", value }),
} as const;

// ─── format ⇄ code lookup ─────────────────────────────────────────────────────

const FMT_TO_CODE: Record<Secs2Item["format"], number> = {
  L: Secs2Format.L,
  A: Secs2Format.A,
  B: Secs2Format.B,
  BOOLEAN: Secs2Format.BOOLEAN,
  I1: Secs2Format.I1,
  I2: Secs2Format.I2,
  I4: Secs2Format.I4,
  I8: Secs2Format.I8,
  U1: Secs2Format.U1,
  U2: Secs2Format.U2,
  U4: Secs2Format.U4,
  U8: Secs2Format.U8,
  F4: Secs2Format.F4,
  F8: Secs2Format.F8,
};

const CODE_TO_FMT = new Map<number, Secs2Item["format"]>(
  Object.entries(FMT_TO_CODE).map(([fmt, code]) => [code, fmt as Secs2Item["format"]]),
);

/** Byte width of a fixed-width numeric format. */
const NUM_WIDTH: Record<string, number> = {
  I1: 1,
  I2: 2,
  I4: 4,
  I8: 8,
  U1: 1,
  U2: 2,
  U4: 4,
  U8: 8,
  F4: 4,
  F8: 8,
};

// ─── header encode/decode ─────────────────────────────────────────────────────

/**
 * Encode the [format-byte][length-bytes] header for a format code + length value.
 * Picks the smallest length-byte width (1..3) that holds the length.
 * Throws if the length exceeds the 3-byte maximum (0xFFFFFF).
 */
function encodeHeader(formatCode: number, length: number): Buffer {
  if (length < 0 || length > 0xffffff) {
    throw new Error(`secs2Codec: item length ${length} exceeds SECS-II 3-byte maximum`);
  }
  let nLenBytes: number;
  if (length <= 0xff) nLenBytes = 1;
  else if (length <= 0xffff) nLenBytes = 2;
  else nLenBytes = 3;

  const head = Buffer.alloc(1 + nLenBytes);
  head[0] = ((formatCode & 0x3f) << 2) | (nLenBytes & 0x03);
  for (let i = 0; i < nLenBytes; i++) {
    head[nLenBytes - i] = (length >>> (8 * i)) & 0xff; // big-endian
  }
  return head;
}

// ─── range checks (explicit failures, not silent truncation) ──────────────────

const INT_RANGE: Record<string, [bigint, bigint]> = {
  I1: [-0x80n, 0x7fn],
  I2: [-0x8000n, 0x7fffn],
  I4: [-0x80000000n, 0x7fffffffn],
  I8: [-(2n ** 63n), 2n ** 63n - 1n],
  U1: [0n, 0xffn],
  U2: [0n, 0xffffn],
  U4: [0n, 0xffffffffn],
  U8: [0n, 2n ** 64n - 1n],
};

function checkIntRange(fmt: string, v: bigint): void {
  const [lo, hi] = INT_RANGE[fmt];
  if (v < lo || v > hi) {
    throw new Error(`secs2Codec: value ${v} out of range for ${fmt} [${lo}, ${hi}]`);
  }
}

// ─── numeric element encode ───────────────────────────────────────────────────

/** Write one fixed-width numeric element (big-endian) into `data` at `off`. */
function writeNumeric(fmt: Secs2Item["format"], v: number | bigint, data: Buffer, off: number): void {
  switch (fmt) {
    case "U1":
      checkIntRange("U1", BigInt(v as number));
      data.writeUInt8(v as number, off);
      return;
    case "U2":
      checkIntRange("U2", BigInt(v as number));
      data.writeUInt16BE(v as number, off);
      return;
    case "U4":
      checkIntRange("U4", BigInt(v as number));
      data.writeUInt32BE(v as number, off);
      return;
    case "U8":
      checkIntRange("U8", v as bigint);
      data.writeBigUInt64BE(v as bigint, off);
      return;
    case "I1":
      checkIntRange("I1", BigInt(v as number));
      data.writeInt8(v as number, off);
      return;
    case "I2":
      checkIntRange("I2", BigInt(v as number));
      data.writeInt16BE(v as number, off);
      return;
    case "I4":
      checkIntRange("I4", BigInt(v as number));
      data.writeInt32BE(v as number, off);
      return;
    case "I8":
      checkIntRange("I8", v as bigint);
      data.writeBigInt64BE(v as bigint, off);
      return;
    case "F4":
      data.writeFloatBE(v as number, off);
      return;
    case "F8":
      data.writeDoubleBE(v as number, off);
      return;
    default:
      throw new Error(`secs2Codec: writeNumeric called for non-numeric format ${fmt}`);
  }
}

/** Read one fixed-width numeric element (big-endian) from `data` at `off`. */
function readNumeric(fmt: Secs2Item["format"], data: Buffer, off: number): number | bigint {
  switch (fmt) {
    case "U1":
      return data.readUInt8(off);
    case "U2":
      return data.readUInt16BE(off);
    case "U4":
      return data.readUInt32BE(off);
    case "U8":
      return data.readBigUInt64BE(off);
    case "I1":
      return data.readInt8(off);
    case "I2":
      return data.readInt16BE(off);
    case "I4":
      return data.readInt32BE(off);
    case "I8":
      return data.readBigInt64BE(off);
    case "F4":
      return data.readFloatBE(off);
    case "F8":
      return data.readDoubleBE(off);
    default:
      throw new Error(`secs2Codec: readNumeric called for non-numeric format ${fmt}`);
  }
}

// ─── encode ───────────────────────────────────────────────────────────────────

/**
 * Encode a SECS-II item tree to a Buffer. Pure; throws (never truncates) on an
 * out-of-range numeric so encode failures are explicit and test-visible.
 */
export function encodeItem(item: Secs2Item): Buffer {
  const formatCode = FMT_TO_CODE[item.format];

  if (item.format === "L") {
    const children = item.value.map(encodeItem);
    // List length = ELEMENT count (not byte count).
    return Buffer.concat([encodeHeader(formatCode, item.value.length), ...children]);
  }

  if (item.format === "A") {
    // SECS-II A is Latin-1/ASCII: one byte per code unit. "latin1" preserves 0..255.
    const data = Buffer.from(item.value, "latin1");
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  if (item.format === "BOOLEAN") {
    const data = Buffer.from(item.value.map((b) => (b ? 0x01 : 0x00)));
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  if (item.format === "B") {
    const data = Buffer.from(
      item.value.map((n) => {
        if (!Number.isInteger(n) || n < 0 || n > 0xff) {
          throw new Error(`secs2Codec: binary byte ${n} out of range [0,255]`);
        }
        return n;
      }),
    );
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  // Fixed-width numeric formats (I*/U*/F*).
  const width = NUM_WIDTH[item.format];
  const values = item.value as Array<number | bigint>;
  const data = Buffer.alloc(values.length * width);
  values.forEach((v, idx) => writeNumeric(item.format, v, data, idx * width));
  return Buffer.concat([encodeHeader(formatCode, data.length), data]);
}

// ─── decode ───────────────────────────────────────────────────────────────────

/** Decode one item at `buf[offset]`; returns the item + the next offset. */
function decodeItemAt(buf: Buffer, offset: number): { item: Secs2Item; next: number } {
  if (offset >= buf.length) {
    throw new Error(`secs2Codec: truncated item — no format byte at offset ${offset}`);
  }
  const formatByte = buf[offset];
  const formatCode = (formatByte >>> 2) & 0x3f;
  const nLenBytes = formatByte & 0x03;
  if (nLenBytes < 1 || nLenBytes > 3) {
    throw new Error(`secs2Codec: illegal length-byte count ${nLenBytes} at offset ${offset}`);
  }
  if (offset + 1 + nLenBytes > buf.length) {
    throw new Error(`secs2Codec: truncated length bytes at offset ${offset}`);
  }
  let length = 0;
  for (let i = 0; i < nLenBytes; i++) {
    length = (length << 8) | buf[offset + 1 + i];
  }
  let cursor = offset + 1 + nLenBytes;

  const fmt = CODE_TO_FMT.get(formatCode);
  if (!fmt) {
    throw new Error(`secs2Codec: unsupported format code ${formatCode} (0o${formatCode.toString(8)}) at offset ${offset}`);
  }

  if (fmt === "L") {
    const value: Secs2Item[] = [];
    for (let i = 0; i < length; i++) {
      const { item, next } = decodeItemAt(buf, cursor);
      value.push(item);
      cursor = next;
    }
    return { item: { format: "L", value }, next: cursor };
  }

  if (cursor + length > buf.length) {
    throw new Error(`secs2Codec: truncated data for ${fmt} (need ${length} bytes) at offset ${cursor}`);
  }
  const data = buf.subarray(cursor, cursor + length);
  cursor += length;

  switch (fmt) {
    case "A":
      return { item: { format: "A", value: data.toString("latin1") }, next: cursor };
    case "B":
      return { item: { format: "B", value: [...data] }, next: cursor };
    case "BOOLEAN":
      return { item: { format: "BOOLEAN", value: [...data].map((b) => b !== 0) }, next: cursor };
    default:
      break;
  }

  // Fixed-width numeric formats.
  const width = NUM_WIDTH[fmt];
  if (length % width !== 0) {
    throw new Error(`secs2Codec: ${fmt} byte-count ${length} is not a multiple of element width ${width}`);
  }
  const count = length / width;
  if (fmt === "I8" || fmt === "U8") {
    const value: bigint[] = [];
    for (let i = 0; i < count; i++) value.push(readNumeric(fmt, data, i * width) as bigint);
    return { item: { format: fmt, value }, next: cursor };
  }
  const value: number[] = [];
  for (let i = 0; i < count; i++) value.push(readNumeric(fmt, data, i * width) as number);
  return { item: { format: fmt, value } as Secs2Item, next: cursor };
}

/** Decode a single root SECS-II item from a Buffer. */
export function decodeItem(buf: Buffer): Secs2Item {
  return decodeItemAt(buf, 0).item;
}

/**
 * Decode a single root item AND report how many bytes it consumed. Useful when a
 * message body buffer may carry trailing bytes (it should not, for a well-formed
 * single-item body, but callers can assert `consumed === buf.length`).
 */
export function decodeItemWithLength(buf: Buffer): { item: Secs2Item; consumed: number } {
  const { item, next } = decodeItemAt(buf, 0);
  return { item, consumed: next };
}
